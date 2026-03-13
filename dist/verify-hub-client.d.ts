import { kRPCClient } from './krpc_client';
export interface TokenPair {
    session_token: string;
    refresh_token: string;
}
export interface VerifyHubUserInfo {
    show_name: string;
    user_id: string;
    user_type: string;
    state?: string;
}
export interface LoginByPasswordResponse {
    user_info: VerifyHubUserInfo;
    session_token: string;
    refresh_token: string;
}
export interface LegacyLoginByPasswordResponse {
    user_name: string;
    user_id: string;
    user_type: string;
    session_token: string;
    refresh_token?: string;
}
export interface LoginByJwtParams {
    jwt: string;
    login_params?: Record<string, unknown>;
}
export interface LoginByPasswordParams {
    username: string;
    password: string;
    appid: string;
    source_url?: string;
}
export interface VerifyTokenParams {
    session_token: string;
    appid?: string;
}
export interface RefreshTokenParams {
    refresh_token: string;
}
export declare class VerifyHubClient {
    private rpcClient;
    constructor(rpcClient: kRPCClient);
    setSeq(seq: number): void;
    loginByJwt(params: LoginByJwtParams): Promise<TokenPair>;
    loginByPassword(params: LoginByPasswordParams): Promise<LoginByPasswordResponse | LegacyLoginByPasswordResponse>;
    refreshToken(params: RefreshTokenParams): Promise<TokenPair>;
    verifyToken(params: VerifyTokenParams): Promise<boolean>;
    static normalizeLoginResponse(response: LoginByPasswordResponse | LegacyLoginByPasswordResponse): LegacyLoginByPasswordResponse;
}
export type { KRPCResponse } from './krpc_client';
//# sourceMappingURL=verify-hub-client.d.ts.map