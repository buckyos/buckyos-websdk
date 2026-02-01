type KRPCSys = [number] | [number, string];
interface KRPCRequest<TParams> {
    method: string;
    params: TParams;
    sys: KRPCSys;
}
interface KRPCSuccessResponse<TResult> {
    result: TResult;
    sys?: KRPCSys;
    error?: undefined;
}
interface KRPCErrorResponse {
    error: string;
    sys?: KRPCSys;
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
declare class kRPCClient {
    private serverUrl;
    private protocolType;
    private seq;
    private sessionToken;
    private initToken;
    private fetcher;
    constructor(url: string, token?: string | null, seq?: number | null, fetcher?: Fetcher);
    call<TResult, TParams>(method: string, params: TParams): Promise<TResult>;
    setSeq(seq: number): void;
    resetSessionToken(): void;
    setSessionToken(token: string | null): void;
    getSessionToken(): string | null;
    private buildRequest;
    private parseSys;
    private _call;
}
export { kRPCClient, RPCProtocolType, RPCError };
export type { KRPCRequest, KRPCResponse, KRPCSys };
//# sourceMappingURL=krpc_client.d.ts.map