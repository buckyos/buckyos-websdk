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
export interface AppAuthTarget {
    kind: 'app';
    app_instance_id: string;
}
export interface SystemAuthTarget {
    kind: 'system';
    service_id: string;
}
export type AuthTarget = AppAuthTarget | SystemAuthTarget;
export declare function getAuthTargetAppId(target: AuthTarget): string;
export interface LoginByJwtParams {
    jwt: string;
    target: AuthTarget;
}
export interface LoginByPasswordParams {
    username: string;
    password: string;
    target: AuthTarget;
    login_nonce?: number;
    source_url?: string;
}
export interface SudoByPasswordParams {
    username: string;
    password: string;
    target: AuthTarget;
    aud?: string;
    login_nonce?: number;
}
export interface SudoByPasswordResponse {
    session_token: string;
}
export interface VerifyTokenParams {
    session_token: string;
    expected_target?: AuthTarget;
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
    sudoByPassword(params: SudoByPasswordParams): Promise<SudoByPasswordResponse>;
    refreshToken(params: RefreshTokenParams): Promise<TokenPair>;
    verifyToken(params: VerifyTokenParams): Promise<boolean>;
    static normalizeLoginResponse(response: LoginByPasswordResponse | LegacyLoginByPasswordResponse): LegacyLoginByPasswordResponse;
}
export type { KRPCResponse } from './krpc_client';
//# sourceMappingURL=verify-hub-client.d.ts.map