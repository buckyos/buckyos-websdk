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
    getZoneHostName: typeof getZoneHostName;
    getZoneServiceURL: typeof getZoneServiceURL;
    getServiceRpcClient: typeof getServiceRpcClient;
};

export declare interface BuckyOSConfig {
    zoneHost: string;
    appId: string;
    defaultProtocol: string;
    runtimeType: RuntimeType;
}

declare function doLogin(username: string, password: string): Promise<AccountInfo | null>;

declare function getAccountInfo(): AccountInfo | null;

declare function getAppId(): string | null;

declare function getAppSetting(setting_name?: string | null): void;

declare function getBuckyOSConfig(): BuckyOSConfig | null;

declare function getRuntimeType(): RuntimeType;

declare function getServiceRpcClient(service_name: string): kRPCClient;

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
    constructor(url: string, token?: string | null, seq?: number | null);
    call(method: string, params: any): Promise<any>;
    setSeq(seq: number): void;
    private _call;
}

declare function login(auto_login?: boolean): Promise<AccountInfo | null>;

declare function logout(clean_account_info?: boolean): void;

declare function removeEvent(cookie_id: string): void;

export declare enum RuntimeType {
    Browser = "Browser",
    NodeJS = "NodeJS",
    AppRuntime = "AppRuntime",
    Unknown = "Unknown"
}

declare function setAppSetting(setting_name: string | null | undefined, setting_value: string): void;

export declare const WEB3_BRIDGE_HOST = "web3.buckyos.ai";

export { }
