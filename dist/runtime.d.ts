import { AiWorkspaceClient } from './aiworkspace_client';
import { BucketClient } from './bucket_client';
import { kRPCClient } from './krpc_client';
import { AuthTarget, VerifyHubClient } from './verify-hub-client';
import { TaskManagerClient } from './task_mgr_client';
import { WorkflowClient } from './workflow_client';
import { SystemConfigClient } from './system_config_client';
import { AiccClient } from './aicc_client';
import { MsgQueueClient } from './msg_queue_client';
import { MsgCenterClient } from './msg_center_client';
import { RepoClient } from './repo_client';
import { BrowserUserInfo } from './account';
import { CurrentIdentity } from './hybrid_sso';
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
/**
 * Account type of a Zone account record (`UserType` in buckyos-api
 * control_panel.rs). `root` marks the Zone owner record and never logs in;
 * `limited` accounts carry no business permission until an admin adds them to
 * system user groups. Anonymous visitors and External users have no record.
 */
export type ZoneUserType = 'admin' | 'user' | 'limited' | 'root';
export declare const ZONE_USER_TYPES: readonly ZoneUserType[];
/** A known account type, or null for anything else (callers decide; never throws). */
export declare function parseZoneUserType(value: unknown): ZoneUserType | null;
/** `principal_kind` claim of verify-hub tokens. */
export type TokenPrincipalKind = 'user' | 'device' | 'app' | 'system' | 'agent';
/**
 * Boolean claim of a `user` token whose subject is an External user: an
 * authenticated DID without an account record in this Zone (`sub` is that DID).
 */
export declare const EXTERNAL_PRINCIPAL_CLAIM = "external";
export declare function isExternalPrincipal(claims: SessionTokenClaims | null | undefined): boolean;
export interface SessionTokenClaims {
    /** See {@link TokenPrincipalKind}; absent in tokens not issued by verify-hub. */
    principal_kind?: string;
    /** `true` on a `user` token of an External user (no account record here); see {@link isExternalPrincipal}. */
    external?: boolean;
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
    authTarget?: AuthTarget;
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
    getAuthTarget(): AuthTarget;
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
    getAiWorkspaceClient(): AiWorkspaceClient;
    getBucketClient(): BucketClient;
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
    private storeBrowserIdentity;
    /**
     * Whom the browser session speaks for; `anonymous` without a session.
     * Account, External and anonymous visitors are told apart here, never by
     * guessing from a cached user record.
     */
    getCurrentIdentity(): Promise<CurrentIdentity>;
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
    private tryLoadDeviceSigningMaterial;
    private loadDeviceSigningMaterial;
    private tryLoadUserSigningMaterial;
    private tryResolveZoneHostFromSearchRoots;
    private getMySettingsPath;
    private getConfiguredSystemConfigServiceUrl;
    resolveAppServiceGatewayHost(): string;
    private signJwtWithEd25519;
}
//# sourceMappingURL=runtime.d.ts.map