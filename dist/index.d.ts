declare interface AccountInfo {
    user_name: string;
    user_id: string;
    user_type: string;
    session_token: string;
}

declare function attachEvent(event_name: string, callback: Function): void;

declare class AuthClient {
    zone_hostname: string;
    clientId: string;
    cookieOptions: any;
    authWindow: Window | null;
    constructor(zone_base_url: string, appId: string);
    login(redirect_uri?: string | null): Promise<AccountInfo | null>;
    request(action: string, params: any): Promise<void>;
    _openAuthWindow(redirect_uri?: string | null): Promise<string>;
}

export declare const BS_SERVICE_VERIFY_HUB = "verify-hub";

export declare const buckyos: {
    kRPCClient: typeof kRPCClient;
    AuthClient: typeof AuthClient;
    initBuckyOS: typeof initBuckyOS;
    getBuckyOSConfig: typeof getBuckyOSConfig;
    getRuntimeType: typeof getRuntimeType;
    getAppId: typeof getAppId;
    attachEvent: typeof attachEvent;
    removeEvent: typeof removeEvent;
    getAccountInfo: typeof getAccountInfo;
    doLogin: typeof doLogin;
    login: typeof login;
    logout: typeof logout;
    hashPassword: typeof hashPassword;
    getAppSetting: typeof getAppSetting;
    setAppSetting: typeof setAppSetting;
    getCurrentWalletUser: typeof getCurrentWalletUser;
    walletSignWithActiveDid: typeof walletSignWithActiveDid;
    getZoneHostName: typeof getZoneHostName;
    getZoneServiceURL: typeof getZoneServiceURL;
    getServiceRpcClient: typeof getServiceRpcClient;
    getVerifyHubClient: typeof getVerifyHubClient;
};

export declare interface BuckyOSConfig {
    zoneHost: string;
    appId: string;
    defaultProtocol: string;
    runtimeType: RuntimeType;
}

declare function doLogin(username: string, password: string): Promise<AccountInfo | null>;

declare type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

declare function getAccountInfo(): AccountInfo | null;

declare function getAppId(): string | null;

declare function getAppSetting(setting_name?: string | null): void;

declare function getBuckyOSConfig(): BuckyOSConfig | null;

declare function getCurrentWalletUser(): Promise<any>;

declare function getRuntimeType(): RuntimeType;

declare function getServiceRpcClient(service_name: string): kRPCClient;

declare function getVerifyHubClient(): VerifyHubClient;

declare function getZoneHostName(): string | null;

declare function getZoneServiceURL(service_name: string): string;

declare function hashPassword(username: string, password: string, nonce?: number | null): string;

declare function initBuckyOS(appid: string, config?: BuckyOSConfig | null): Promise<void>;

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

declare interface LegacyLoginByPasswordResponse {
    user_name: string;
    user_id: string;
    user_type: string;
    session_token: string;
    refresh_token?: string;
}

declare function login(auto_login?: boolean): Promise<AccountInfo | null>;

declare interface LoginByJwtParams {
    jwt: string;
    login_params?: Record<string, unknown>;
}

declare interface LoginByPasswordParams {
    username: string;
    password: string;
    appid: string;
    source_url?: string;
}

declare interface LoginByPasswordResponse {
    user_info: VerifyHubUserInfo;
    session_token: string;
    refresh_token: string;
}

declare function logout(clean_account_info?: boolean): void;

declare interface RefreshTokenParams {
    refresh_token: string;
}

declare function removeEvent(cookie_id: string): void;

export declare enum RuntimeType {
    Browser = "Browser",
    NodeJS = "NodeJS",
    AppRuntime = "AppRuntime",
    Unknown = "Unknown"
}

declare function setAppSetting(setting_name: string | null | undefined, setting_value: string): void;

declare interface TokenPair {
    session_token: string;
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

declare interface VerifyHubUserInfo {
    show_name: string;
    user_id: string;
    user_type: string;
    state?: string;
}

declare interface VerifyTokenParams {
    session_token: string;
    appid?: string;
}

declare function walletSignWithActiveDid(payloads: Record<string, unknown>[]): Promise<string[] | null>;

export declare const WEB3_BRIDGE_HOST = "web3.buckyos.ai";

export { }
