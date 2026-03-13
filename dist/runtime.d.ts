import { kRPCClient } from './krpc_client';
import { VerifyHubClient } from './verify-hub-client';
import { TaskManagerClient } from './task_mgr_client';
import { OpenDanClient } from './opendan_client';
import { SystemConfigClient } from './system_config_client';
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
    constructor(config: BuckyOSConfig);
    initialize(): Promise<void>;
    setConfig(config: BuckyOSConfig): void;
    getConfig(): BuckyOSConfig;
    getAppId(): string;
    getOwnerUserId(): string | null;
    getFullAppId(): string;
    getZoneHostName(): string;
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
    getOpenDanClient(): OpenDanClient;
    renewTokenFromVerifyHub(): Promise<void>;
    private resolveNodeIdentityFromEnv;
    private resolveZoneHostFromLocalConfig;
    private validateSessionToken;
    private needsRenew;
    private startAutoRenewIfNeeded;
    private loadAppServiceSessionTokenFromEnv;
    private createAppClientSessionToken;
    private loadLocalSigningMaterial;
    private getPrivateKeySearchRoots;
    private tryResolveDeviceNameFromSearchRoots;
    private tryResolveZoneHostFromSearchRoots;
    private signJwtWithEd25519;
}
//# sourceMappingURL=runtime.d.ts.map