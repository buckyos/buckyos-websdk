import { kRPCClient } from './krpc_client';
import { VerifyHubClient } from './verify-hub-client';
import { TaskManagerClient } from './task_mgr_client';
import { WorkflowClient } from './workflow_client';
import { SystemConfigClient } from './system_config_client';
import { AiccClient } from './aicc_client';
import { MsgQueueClient } from './msg_queue_client';
import { MsgCenterClient } from './msg_center_client';
import { RepoClient } from './repo_client';
import { BrowserUserInfo } from './account';
import { AppDID, AppId, AppInstanceId } from './app_identity';
export declare const BUCKYOS_APP_DID_ENV = "BUCKYOS_APP_DID";
export declare const BUCKYOS_APP_ID_ENV = "BUCKYOS_APP_ID";
export declare const BUCKYOS_APP_INSTANCE_ID_ENV = "BUCKYOS_APP_INSTANCE_ID";
export declare const BUCKYOS_OWNER_USER_ID_ENV = "BUCKYOS_OWNER_USER_ID";
export declare const BUCKYOS_DATA_DIR_ENV = "BUCKYOS_DATA_DIR";
export declare const BUCKYOS_APP_TOKEN_ENV = "BUCKYOS_APP_TOKEN";
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
    app_instance_id?: string;
    app_owner_user_id?: string;
    [key: string]: unknown;
}
export interface BuckyOSConfig {
    zoneHost: string;
    appId: AppId;
    appDid?: AppDID | null;
    appInstanceId?: AppInstanceId | null;
    dataDir?: string | null;
    defaultProtocol: string;
    runtimeType: RuntimeType;
    userid?: string | null;
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
    private browserRefreshPromise;
    private authStateRevision;
    private initialized;
    private profile;
    constructor(config: BuckyOSConfig);
    initialize(): Promise<void>;
    login(): Promise<void>;
    setConfig(config: BuckyOSConfig): void;
    getConfig(): BuckyOSConfig;
    getAppId(): AppId;
    getOwnerUserId(): string | null;
    getAppDid(): AppDID | null;
    getAppInstanceId(): AppInstanceId | null;
    getDataDir(): string | null;
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
    getWorkflowClient(): WorkflowClient;
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
    resolveAppServiceIdentityFromEnv(): Promise<void>;
    resolveZoneHostFromLocalConfig(): Promise<void>;
    private validateSessionToken;
    private ensureBrowserSessionToken;
    private normalizeBrowserUserInfo;
    refreshBrowserSession(): Promise<BrowserUserInfo | null>;
    logoutBrowserSSO(): Promise<void>;
    private refreshBrowserSessionToken;
    private requestBrowserSessionToken;
    private usesBrowserSessionRefresh;
    private needsRenew;
    startAutoRenewIfNeeded(): void;
    private loadAppServiceSessionTokenFromEnv;
    private loadAppClientSessionTokenFromEnv;
    createAppClientSessionToken(): Promise<string>;
    private loadLocalSigningMaterial;
    private getPrivateKeySearchRoots;
    private getBuckyOSRootDir;
    private getBuckyOSEtcDir;
    private readPemFile;
    private readNodeIdentityMetadata;
    private extractDeviceNameFromIdentityPayload;
    private readDeviceNameFromNodeIdentityPath;
    private tryLoadDeviceSigningMaterial;
    private deviceKeyPathCandidates;
    private tryLoadUserSigningMaterial;
    private tryResolveDeviceNameFromSearchRoots;
    private tryResolveZoneHostFromSearchRoots;
    private getMySettingsPath;
    private getConfiguredSystemConfigServiceUrl;
    resolveAppServiceGatewayHost(): string;
    private signJwtWithEd25519;
}
//# sourceMappingURL=runtime.d.ts.map