export interface SystemConfigValue {
    value: string;
    version: number;
    is_changed: boolean;
}
export declare class SystemConfigClient {
    private rpcClient;
    constructor(serviceUrl: string, sessionToken?: string | null);
    get(key: string): Promise<SystemConfigValue>;
    set(key: string, value: string): Promise<number>;
}
//# sourceMappingURL=system_config_client.d.ts.map