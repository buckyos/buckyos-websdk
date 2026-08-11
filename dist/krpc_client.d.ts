type KRPCRequestSys = [number] | [number, string] | [number, string | null, string];
type KRPCResponseSys = [number] | [number, string];
type KRPCSys = KRPCRequestSys;
interface KRPCRequest<TParams> {
    method: string;
    params: TParams;
    sys: KRPCRequestSys;
}
interface KRPCSuccessResponse<TResult> {
    result: TResult;
    sys?: KRPCResponseSys;
    error?: undefined;
}
interface KRPCErrorResponse {
    error: string;
    sys?: KRPCResponseSys;
    result?: undefined;
}
type KRPCResponse<TResult> = KRPCSuccessResponse<TResult> | KRPCErrorResponse;
declare enum RPCProtocolType {
    HttpPostJson = "HttpPostJson"
}
declare class RPCError extends Error {
    constructor(message: string);
}
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type SessionTokenProvider = () => Promise<string | null | undefined> | string | null | undefined;
type SessionTokenListener = (token: string | null) => void;
interface KRPCCallOptions {
    sessionToken?: string | null;
    traceId?: string | null;
}
interface KRPCClientOptions {
    fetcher?: Fetcher;
    sessionTokenProvider?: SessionTokenProvider;
    onSessionTokenChanged?: SessionTokenListener;
    traceId?: string | null;
}
declare class kRPCClient {
    private serverUrl;
    private protocolType;
    private seq;
    private sessionToken;
    private initToken;
    private traceId;
    private fetcher;
    private sessionTokenProvider;
    private sessionTokenOverride;
    constructor(url: string, token?: string | null, seq?: number | null, options?: KRPCClientOptions);
    call<TResult, TParams>(method: string, params: TParams, options?: KRPCCallOptions): Promise<TResult>;
    callWithSessionToken<TResult, TParams>(sessionToken: string | null, method: string, params: TParams): Promise<TResult>;
    setSeq(seq: number): void;
    resetSessionToken(): void;
    setSessionToken(token: string | null): void;
    getSessionToken(): string | null;
    setTraceId(traceId: string | null): void;
    getTraceId(): string | null;
    private buildRequest;
    private parseResponseSys;
    private prepareSessionToken;
    private prepareTraceId;
    private _call;
}
export { kRPCClient, RPCProtocolType, RPCError };
export type { KRPCRequest, KRPCResponse, KRPCSys, KRPCRequestSys, KRPCResponseSys, KRPCCallOptions, KRPCClientOptions, };
//# sourceMappingURL=krpc_client.d.ts.map