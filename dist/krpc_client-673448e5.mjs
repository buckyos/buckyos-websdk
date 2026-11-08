const RPC_HTTP_ERROR_CODE = "http_error";
const RPC_TRANSPORT_ERROR_CODE = "transport";
class RPCError extends Error {
  constructor(message, code, data) {
    super(message);
    this.name = "RPCError";
    this.code = code;
    this.data = data;
  }
}
const defaultFetcher = async (input, init) => {
  if (typeof window !== "undefined" && typeof window.fetch === "function") {
    return window.fetch(input, init);
  }
  if (typeof globalThis !== "undefined" && typeof globalThis.fetch === "function") {
    return globalThis.fetch(input, init);
  }
  throw new RPCError("fetch is not available in this runtime");
};
class kRPCClient {
  constructor(url, token = null, seq = null, options = {}) {
    this.serverUrl = url;
    this.protocolType = "HttpPostJson";
    this.seq = seq ?? Date.now();
    this.sessionToken = token || null;
    this.initToken = token || null;
    this.traceId = options.traceId || null;
    this.fetcher = options.fetcher ?? defaultFetcher;
    this.sessionTokenProvider = options.sessionTokenProvider ?? null;
    this.sessionTokenOverride = void 0;
  }
  async call(method, params, options = {}) {
    return this._call(method, params, options);
  }
  async callWithSessionToken(sessionToken, method, params) {
    return this._call(method, params, { sessionToken });
  }
  setSeq(seq) {
    this.seq = seq;
  }
  resetSessionToken() {
    this.sessionToken = this.initToken;
    this.sessionTokenOverride = void 0;
  }
  setSessionToken(token) {
    this.sessionToken = token || null;
    this.sessionTokenOverride = token || null;
  }
  getSessionToken() {
    return this.sessionToken;
  }
  // Trace id attached to subsequent requests (request sys trace slot), for
  // correlating a call chain across services. Pass null to clear.
  setTraceId(traceId) {
    this.traceId = traceId || null;
  }
  getTraceId() {
    return this.traceId;
  }
  buildRequest(method, params, seq, sessionToken, traceId) {
    let sys;
    if (traceId) {
      sys = [seq, sessionToken, traceId];
    } else {
      sys = sessionToken ? [seq, sessionToken] : [seq];
    }
    return {
      method,
      params,
      sys
    };
  }
  // Validates a response sys tuple and returns its trace id (if any). The
  // trace id is only checked for well-formedness; it must never be stored as
  // a session token.
  parseResponseSys(sys, currentSeq) {
    if (sys === void 0 || sys === null) {
      return null;
    }
    if (!Array.isArray(sys)) {
      throw new RPCError("sys is not array");
    }
    if (sys.length < 1) {
      throw new RPCError("sys is empty");
    }
    const responseSeq = sys[0];
    if (typeof responseSeq !== "number") {
      throw new RPCError("sys[0] is not number");
    }
    if (responseSeq !== currentSeq) {
      throw new RPCError(`seq not match: ${responseSeq}!=${currentSeq}`);
    }
    if (sys.length >= 2) {
      const traceId = sys[1];
      if (typeof traceId !== "string") {
        throw new RPCError("sys[1] trace_id is not string");
      }
      return traceId;
    }
    return null;
  }
  async prepareSessionToken(options) {
    if (Object.prototype.hasOwnProperty.call(options, "sessionToken")) {
      return options.sessionToken || null;
    }
    if (this.sessionTokenOverride !== void 0) {
      return this.sessionTokenOverride;
    }
    if (this.sessionTokenProvider) {
      const preparedToken = await this.sessionTokenProvider();
      if (preparedToken !== void 0) {
        this.sessionToken = preparedToken || null;
      }
    }
    return this.sessionToken;
  }
  prepareTraceId(options) {
    if (Object.prototype.hasOwnProperty.call(options, "traceId")) {
      return options.traceId || null;
    }
    return this.traceId;
  }
  async _call(method, params, options) {
    const sessionToken = await this.prepareSessionToken(options);
    const traceId = this.prepareTraceId(options);
    const currentSeq = this.seq;
    this.seq += 1;
    const requestBody = this.buildRequest(method, params, currentSeq, sessionToken, traceId);
    try {
      const response = await this.fetcher(this.serverUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
      });
      if (!response.ok) {
        throw new RPCError(`RPC call error: ${response.status}`, RPC_HTTP_ERROR_CODE, { status: response.status });
      }
      let rpcResponse;
      try {
        rpcResponse = await response.json();
      } catch (error) {
        throw new RPCError(`RPC call failed: invalid response body: ${error instanceof Error ? error.message : String(error)}`);
      }
      this.parseResponseSys(rpcResponse.sys, currentSeq);
      if ("error" in rpcResponse && rpcResponse.error) {
        throw new RPCError(
          `RPC call error: ${rpcResponse.error}`,
          typeof rpcResponse.code === "string" ? rpcResponse.code : void 0,
          rpcResponse.data
        );
      }
      if (!("result" in rpcResponse) || rpcResponse.result === void 0) {
        throw new RPCError("RPC response missing result");
      }
      return rpcResponse.result;
    } catch (error) {
      if (error instanceof RPCError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new RPCError(`RPC call failed: ${message}`, RPC_TRANSPORT_ERROR_CODE);
    }
  }
}
export {
  RPCError as R,
  RPC_HTTP_ERROR_CODE as a,
  RPC_TRANSPORT_ERROR_CODE as b,
  kRPCClient as k
};
//# sourceMappingURL=krpc_client-673448e5.mjs.map
