type KRPCSys = [number] | [number, string]

interface KRPCRequest<TParams> {
  method: string
  params: TParams
  sys: KRPCSys
}

interface KRPCSuccessResponse<TResult> {
  result: TResult
  sys?: KRPCSys
  error?: undefined
}

interface KRPCErrorResponse {
  error: string
  sys?: KRPCSys
  result?: undefined
}

type KRPCResponse<TResult> = KRPCSuccessResponse<TResult> | KRPCErrorResponse

enum RPCProtocolType {
  HttpPostJson = 'HttpPostJson',
}

class RPCError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RPCError'
  }
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
type SessionTokenProvider = () => Promise<string | null | undefined> | string | null | undefined
type SessionTokenListener = (token: string | null) => void

interface KRPCCallOptions {
  sessionToken?: string | null
}

interface KRPCClientOptions {
  fetcher?: Fetcher
  sessionTokenProvider?: SessionTokenProvider
  onSessionTokenChanged?: SessionTokenListener
}

const defaultFetcher: Fetcher = async (input, init) => {
  if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
    return window.fetch(input, init)
  }

  if (typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function') {
    return globalThis.fetch(input, init)
  }

  throw new RPCError('fetch is not available in this runtime')
}

class kRPCClient {
  private serverUrl: string
  private protocolType: RPCProtocolType
  private seq: number
  private sessionToken: string | null
  private initToken: string | null
  private fetcher: Fetcher
  private sessionTokenProvider: SessionTokenProvider | null
  private onSessionTokenChanged: SessionTokenListener | null
  private sessionTokenOverride: string | null | undefined

  constructor(url: string, token: string | null = null, seq: number | null = null, options: KRPCClientOptions = {}) {
    this.serverUrl = url
    this.protocolType = RPCProtocolType.HttpPostJson
    this.seq = seq ?? Date.now()
    this.sessionToken = token || null
    this.initToken = token || null
    this.fetcher = options.fetcher ?? defaultFetcher
    this.sessionTokenProvider = options.sessionTokenProvider ?? null
    this.onSessionTokenChanged = options.onSessionTokenChanged ?? null
    this.sessionTokenOverride = undefined
  }

  async call<TResult, TParams>(method: string, params: TParams, options: KRPCCallOptions = {}): Promise<TResult> {
    return this._call<TResult, TParams>(method, params, options)
  }

  async callWithSessionToken<TResult, TParams>(
    sessionToken: string | null,
    method: string,
    params: TParams,
  ): Promise<TResult> {
    return this._call<TResult, TParams>(method, params, { sessionToken })
  }

  setSeq(seq: number) {
    this.seq = seq
  }

  resetSessionToken() {
    this.sessionToken = this.initToken
    this.sessionTokenOverride = undefined
  }

  setSessionToken(token: string | null) {
    this.sessionToken = token || null
    this.sessionTokenOverride = token || null
  }

  getSessionToken(): string | null {
    return this.sessionToken
  }

  private buildRequest<TParams>(
    method: string,
    params: TParams,
    seq: number,
    sessionToken: string | null,
  ): KRPCRequest<TParams> {
    const sys: KRPCSys = sessionToken ? [seq, sessionToken] : [seq]
    return {
      method,
      params,
      sys,
    }
  }

  private parseSys(sys: unknown, currentSeq: number): string | null {
    if (sys === undefined || sys === null) {
      return null
    }

    if (!Array.isArray(sys)) {
      throw new RPCError('sys is not array')
    }

    if (sys.length < 1) {
      throw new RPCError('sys is empty')
    }

    const responseSeq = sys[0]
    if (typeof responseSeq !== 'number') {
      throw new RPCError('sys[0] is not number')
    }
    if (responseSeq !== currentSeq) {
      throw new RPCError(`seq not match: ${responseSeq}!=${currentSeq}`)
    }

    if (sys.length >= 2) {
      const token = sys[1]
      if (typeof token !== 'string') {
        throw new RPCError('sys[1] is not string')
      }
      return token
    }

    return null
  }

  private hasCallSessionToken(options: KRPCCallOptions): boolean {
    return Object.prototype.hasOwnProperty.call(options, 'sessionToken')
  }

  private async prepareSessionToken(options: KRPCCallOptions): Promise<{
    sessionToken: string | null
    isTemporary: boolean
    isOverride: boolean
  }> {
    if (this.hasCallSessionToken(options)) {
      return {
        sessionToken: options.sessionToken || null,
        isTemporary: true,
        isOverride: false,
      }
    }

    if (this.sessionTokenOverride !== undefined) {
      return {
        sessionToken: this.sessionTokenOverride,
        isTemporary: false,
        isOverride: true,
      }
    }

    if (this.sessionTokenProvider) {
      const preparedToken = await this.sessionTokenProvider()
      if (preparedToken !== undefined) {
        this.sessionToken = preparedToken || null
      }
    }

    return {
      sessionToken: this.sessionToken,
      isTemporary: false,
      isOverride: false,
    }
  }

  private async _call<TResult, TParams>(
    method: string,
    params: TParams,
    options: KRPCCallOptions,
  ): Promise<TResult> {
    const preparedSession = await this.prepareSessionToken(options)
    const currentSeq = this.seq
    this.seq += 1
    const requestBody = this.buildRequest(method, params, currentSeq, preparedSession.sessionToken)

    try {
      const response = await this.fetcher(this.serverUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        throw new RPCError(`RPC call error: ${response.status}`)
      }

      const rpcResponse: KRPCResponse<TResult> = await response.json()

      const updatedToken = this.parseSys(rpcResponse.sys, currentSeq)
      if (updatedToken) {
        if (preparedSession.isOverride) {
          this.sessionToken = updatedToken
          this.sessionTokenOverride = updatedToken
        } else if (preparedSession.isTemporary) {
          // Per-call temporary tokens must not replace the managed client token.
        } else {
          this.sessionToken = updatedToken
          if (this.onSessionTokenChanged) {
            this.onSessionTokenChanged(updatedToken)
          }
        }
      }

      if ('error' in rpcResponse && rpcResponse.error) {
        throw new RPCError(`RPC call error: ${rpcResponse.error}`)
      }

      if (!('result' in rpcResponse) || rpcResponse.result === undefined) {
        throw new RPCError('RPC response missing result')
      }

      return rpcResponse.result
    } catch (error) {
      if (error instanceof RPCError) {
        throw error
      }
      const message = error instanceof Error ? error.message : String(error)
      throw new RPCError(`RPC call failed: ${message}`)
    }
  }
}

export { kRPCClient, RPCProtocolType, RPCError }
export type { KRPCRequest, KRPCResponse, KRPCSys, KRPCCallOptions, KRPCClientOptions }
