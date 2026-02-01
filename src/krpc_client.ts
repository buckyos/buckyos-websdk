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

const hasWindowFetch = typeof window !== 'undefined' && typeof window.fetch === 'function'
const hasGlobalFetch = typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function'

const defaultFetcher: Fetcher = hasWindowFetch
  ? window.fetch.bind(window)
  : hasGlobalFetch
    ? globalThis.fetch.bind(globalThis)
    : async () => {
        throw new RPCError('fetch is not available in this runtime')
      }

class kRPCClient {
  private serverUrl: string
  private protocolType: RPCProtocolType
  private seq: number
  private sessionToken: string | null
  private initToken: string | null
  private fetcher: Fetcher

  constructor(url: string, token: string | null = null, seq: number | null = null, fetcher: Fetcher = defaultFetcher) {
    this.serverUrl = url
    this.protocolType = RPCProtocolType.HttpPostJson
    this.seq = seq ?? Date.now()
    this.sessionToken = token || null
    this.initToken = token || null
    this.fetcher = fetcher
  }

  async call<TResult, TParams>(method: string, params: TParams): Promise<TResult> {
    return this._call<TResult, TParams>(method, params)
  }

  setSeq(seq: number) {
    this.seq = seq
  }

  resetSessionToken() {
    this.sessionToken = this.initToken
  }

  setSessionToken(token: string | null) {
    this.sessionToken = token
  }

  getSessionToken(): string | null {
    return this.sessionToken
  }

  private buildRequest<TParams>(method: string, params: TParams, seq: number): KRPCRequest<TParams> {
    const sys: KRPCSys = this.sessionToken ? [seq, this.sessionToken] : [seq]
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

  private async _call<TResult, TParams>(method: string, params: TParams): Promise<TResult> {
    const currentSeq = this.seq
    this.seq += 1
    const requestBody = this.buildRequest(method, params, currentSeq)

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
        this.sessionToken = updatedToken
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
export type { KRPCRequest, KRPCResponse, KRPCSys }
