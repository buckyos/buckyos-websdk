declare enum RPCProtocolType {
    HttpPostJson = "HttpPostJson"
}
declare class RPCError extends Error {
    constructor(message: string);
}
declare class kRPCClient {
    private serverUrl;
    private protocolType;
    private seq;
    private sessionToken;
    private initToken;
    constructor(url: string, token?: string | null, seq?: number | null);
    call(method: string, params: any): Promise<any>;
    setSeq(seq: number): void;
    private _call;
}
export { kRPCClient, RPCProtocolType, RPCError };
//# sourceMappingURL=krpc_client.d.ts.map