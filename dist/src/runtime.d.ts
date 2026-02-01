import { kRPCClient } from './krpc_client';
import { VerifyHubClient } from './verify-hub-client';
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
export declare const DEFAULT_CONFIG: BuckyOSConfig;
export declare class BuckyOSRuntime {
    private config;
    private sessionToken;
    private refreshToken;
    constructor(config: BuckyOSConfig);
    setConfig(config: BuckyOSConfig): void;
    getConfig(): BuckyOSConfig;
    getAppId(): string;
    getZoneHostName(): string;
    getZoneServiceURL(serviceName: string): string;
    setSessionToken(token: string | null): void;
    setRefreshToken(token: string | null): void;
    getSessionToken(): string | null;
    getRefreshToken(): string | null;
    getServiceRpcClient(serviceName: string): kRPCClient;
    getVerifyHubClient(): VerifyHubClient;
}
//# sourceMappingURL=runtime.d.ts.map