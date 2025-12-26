import { kRPCClient } from "./krpc_client";
import { AuthClient } from "./auth_client";
import { hashPassword, AccountInfo, doLogin } from "./account";
export declare enum RuntimeType {
    Browser = "Browser",
    NodeJS = "NodeJS",
    AppRuntime = "AppRuntime",
    Unknown = "Unknown"
}
export interface BuckyOSConfig {
    zoneHost: string;
    appId: string;
    defaultProtocol: string;
    runtimeType: RuntimeType;
}
export declare const WEB3_BRIDGE_HOST = "web3.buckyos.ai";
export declare const BS_SERVICE_VERIFY_HUB = "verify-hub";
declare function initBuckyOS(appid: string, config?: BuckyOSConfig | null): Promise<void>;
declare function getRuntimeType(): RuntimeType;
declare function attachEvent(event_name: string, callback: Function): void;
declare function removeEvent(cookie_id: string): void;
declare function getAccountInfo(): AccountInfo | null;
declare function login(auto_login?: boolean): Promise<AccountInfo | null>;
declare function logout(clean_account_info?: boolean): void;
declare function getAppSetting(setting_name?: string | null): void;
declare function setAppSetting(setting_name: string | null | undefined, setting_value: string): void;
declare function getZoneHostName(): string | null;
declare function getZoneServiceURL(service_name: string): string;
declare function getServiceRpcClient(service_name: string): kRPCClient;
declare function getAppId(): string | null;
declare function getBuckyOSConfig(): BuckyOSConfig | null;
declare function getCurrentWalletUser(): Promise<any>;
declare function walletSignWithActiveDid(payloads: Record<string, unknown>[]): Promise<string[] | null>;
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
};
export {};
//# sourceMappingURL=index.d.ts.map