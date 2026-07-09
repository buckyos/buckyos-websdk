// kRPC JSON protocol client. Wire contract: buckyos-base/src/kRPC/src/protocol.rs
// (Beta2.2). `sys` carries the protocol metadata tuple:
// - request:  [seq] | [seq, session_token] | [seq, null, trace_id] | [seq, session_token, trace_id]
// - response: [seq] | [seq, trace_id]
// The second element of a *response* sys is the trace id echoed by the server.
// It is NOT a session token: Beta2.2 responses never rotate tokens, so nothing
// from a response may be written back into the session token state.

// Request sys tuple; the token slot is kept as null when only a trace id is
// present (mirrors RPCRequest::serialize).
type KRPCRequestSys = [number] | [number, string] | [number, string | null, string]

// Response sys tuple: [seq] or [seq, trace_id] (mirrors RPCResponse::serialize).
type KRPCResponseSys = [number] | [number, string]

type KRPCSys = KRPCRequestSys

interface KRPCRequest<TParams> {
  method: string
  params: TParams
  sys: KRPCRequestSys
}

interface KRPCSuccessResponse<TResult> {
  result: TResult
  sys?: KRPCResponseSys
  error?: undefined
}

interface KRPCErrorResponse {
  error: string
  sys?: KRPCResponseSys
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
  // Per-call trace id: `undefined` uses the client-level trace id, `null`
  // (or '') suppresses it for this call.
  traceId?: string | null
}

interface KRPCClientOptions {
  fetcher?: Fetcher
  sessionTokenProvider?: SessionTokenProvider
  // Retained for API compatibility with pre-Beta2.2 callers. Beta2.2 kRPC
  // responses carry a trace id (not a rotated session token) in sys[1], so
  // the client never invokes this listener anymore.
  onSessionTokenChanged?: SessionTokenListener
  // Initial trace id sent with every request (see setTraceId()).
  traceId?: string | null
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
  private traceId: string | null
  private fetcher: Fetcher
  private sessionTokenProvider: SessionTokenProvider | null
  private sessionTokenOverride: string | null | undefined

  constructor(url: string, token: string | null = null, seq: number | null = null, options: KRPCClientOptions = {}) {
    this.serverUrl = url
    this.protocolType = RPCProtocolType.HttpPostJson
    this.seq = seq ?? Date.now()
    this.sessionToken = token || null
    this.initToken = token || null
    this.traceId = options.traceId || null
    this.fetcher = options.fetcher ?? defaultFetcher
    this.sessionTokenProvider = options.sessionTokenProvider ?? null
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

  // Trace id attached to subsequent requests (request sys trace slot), for
  // correlating a call chain across services. Pass null to clear.
  setTraceId(traceId: string | null) {
    this.traceId = traceId || null
  }

  getTraceId(): string | null {
    return this.traceId
  }

  private buildRequest<TParams>(
    method: string,
    params: TParams,
    seq: number,
    sessionToken: string | null,
    traceId: string | null,
  ): KRPCRequest<TParams> {
    let sys: KRPCRequestSys
    if (traceId) {
      sys = [seq, sessionToken, traceId]
    } else {
      sys = sessionToken ? [seq, sessionToken] : [seq]
    }
    return {
      method,
      params,
      sys,
    }
  }

  // Validates a response sys tuple and returns its trace id (if any). The
  // trace id is only checked for well-formedness; it must never be stored as
  // a session token.
  private parseResponseSys(sys: unknown, currentSeq: number): string | null {
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
      const traceId = sys[1]
      if (typeof traceId !== 'string') {
        throw new RPCError('sys[1] trace_id is not string')
      }
      return traceId
    }

    return null
  }

  private async prepareSessionToken(options: KRPCCallOptions): Promise<string | null> {
    if (Object.prototype.hasOwnProperty.call(options, 'sessionToken')) {
      return options.sessionToken || null
    }

    if (this.sessionTokenOverride !== undefined) {
      return this.sessionTokenOverride
    }

    if (this.sessionTokenProvider) {
      const preparedToken = await this.sessionTokenProvider()
      if (preparedToken !== undefined) {
        this.sessionToken = preparedToken || null
      }
    }

    return this.sessionToken
  }

  private prepareTraceId(options: KRPCCallOptions): string | null {
    if (Object.prototype.hasOwnProperty.call(options, 'traceId')) {
      return options.traceId || null
    }
    return this.traceId
  }

  private async _call<TResult, TParams>(
    method: string,
    params: TParams,
    options: KRPCCallOptions,
  ): Promise<TResult> {
    const sessionToken = await this.prepareSessionToken(options)
    const traceId = this.prepareTraceId(options)
    const currentSeq = this.seq
    this.seq += 1
    const requestBody = this.buildRequest(method, params, currentSeq, sessionToken, traceId)

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

      this.parseResponseSys(rpcResponse.sys, currentSeq)

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
export type {
  KRPCRequest,
  KRPCResponse,
  KRPCSys,
  KRPCRequestSys,
  KRPCResponseSys,
  KRPCCallOptions,
  KRPCClientOptions,
}
