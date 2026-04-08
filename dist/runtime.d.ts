import { kRPCClient } from './krpc_client';
import { VerifyHubClient } from './verify-hub-client';
import { TaskManagerClient } from './task_mgr_client';
import { SystemConfigClient } from './system_config_client';
import { AiccClient } from './aicc_client';
import { MsgQueueClient } from './msg_queue_client';
import { MsgCenterClient } from './msg_center_client';
import { RepoClient } from './repo_client';
import { BrowserUserInfo } from './account';
export declare enum RuntimeType {
    Browser = "Browser",
    NodeJS = "NodeJS",
    AppRuntime = "AppRuntime",
    AppClient = "AppClient",
    AppService = "AppService",
    Unknown = "Unknown"
}
export interface SessionTokenClaims {
    appid?: string;
    aud?: string;
    sub?: string;
    iss?: string;
    exp?: number;
    jti?: string;
    session?: number;
    token_type?: string;
    userid?: string;
    [key: string]: unknown;
}
export interface BuckyOSConfig {
    zoneHost: string;
    appId: string;
    defaultProtocol: string;
    runtimeType: RuntimeType;
    ownerUserId?: string | null;
    rootDir?: string;
    sessionToken?: string | null;
    refreshToken?: string | null;
    privateKeySearchPaths?: string[];
    systemConfigServiceUrl?: string;
    verifyHubServiceUrl?: string;
    nodeGatewayPort?: number;
    autoRenew?: boolean;
    renewIntervalMs?: number;
}
export declare const DEFAULT_CONFIG: BuckyOSConfig;
export declare function parseSessionTokenClaims(token: string | null | undefined): SessionTokenClaims | null;
export declare class BuckyOSRuntime {
    private config;
    private sessionToken;
    private refreshToken;
    private renewTimer;
    private initialized;
    private profile;
    constructor(config: BuckyOSConfig);
    initialize(): Promise<void>;
    login(): Promise<void>;
    setConfig(config: BuckyOSConfig): void;
    getConfig(): BuckyOSConfig;
    getAppId(): string;
    getOwnerUserId(): string | null;
    getFullAppId(): string;
    getZoneHostName(): string;
    getDefaultProtocol(): string;
    getNodeGatewayPort(): number;
    getConfiguredVerifyHubServiceUrl(): string | null;
    getZoneServiceURL(serviceName: string): string;
    getSystemConfigServiceURL(): string;
    setSessionToken(token: string | null): void;
    setRefreshToken(token: string | null): void;
    getSessionToken(): string | null;
    getRefreshToken(): string | null;
    clearAuthState(): void;
    stopAutoRenew(): void;
    getServiceRpcClient(serviceName: string): kRPCClient;
    getSystemConfigClient(): SystemConfigClient;
    getVerifyHubClient(): VerifyHubClient;
    getTaskManagerClient(): TaskManagerClient;
    getAiccClient(): AiccClient;
    getMsgQueueClient(): MsgQueueClient;
    getMsgCenterClient(): MsgCenterClient;
    getRepoClient(): RepoClient;
    getMySettings(): Promise<unknown>;
    updateMySettings(jsonPath: string, settings: unknown): Promise<void>;
    updateAllMySettings(settings: unknown): Promise<void>;
    renewTokenFromVerifyHub(): Promise<void>;
    ensureSessionTokenReady(): Promise<string | null>;
    ensureAppServiceSessionToken(): void;
    ensureAppClientSessionToken(): Promise<void>;
    resolveNodeIdentityFromEnv(): void;
    resolveZoneHostFromLocalConfig(): Promise<void>;
    private validateSessionToken;
    private ensureBrowserSessionToken;
    private normalizeBrowserUserInfo;
    refreshBrowserSession(): Promise<BrowserUserInfo | null>;
    private refreshBrowserSessionToken;
    private needsRenew;
    startAutoRenewIfNeeded(): void;
    private loadAppServiceSessionTokenFromEnv;
    createAppClientSessionToken(): Promise<string>;
    private loadLocalSigningMaterial;
    private getPrivateKeySearchRoots;
    private tryResolveDeviceNameFromSearchRoots;
    private tryResolveZoneHostFromSearchRoots;
    private getMySettingsPath;
    private getConfiguredSystemConfigServiceUrl;
    resolveAppServiceGatewayHost(): string;
    private signJwtWithEd25519;
}
//# sourceMappingURL=runtime.d.ts.map