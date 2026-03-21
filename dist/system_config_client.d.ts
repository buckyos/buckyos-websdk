export interface SystemConfigValue {
    value: string;
    version: number;
    is_changed: boolean;
}
export type SystemConfigTxAction = {
    action: 'create' | 'update' | 'append';
    value: string;
} | {
    action: 'set_by_path';
    all_set: Record<string, unknown>;
} | {
    action: 'remove';
};
export declare class SystemConfigClient {
    private static readonly configCache;
    private rpcClient;
    constructor(serviceUrl: string, sessionToken?: string | null);
    private needCache;
    private getUnixTimestamp;
    private getConfigCache;
    private setConfigCache;
    private removeConfigCache;
    get(key: string): Promise<SystemConfigValue>;
    set(key: string, value: string): Promise<number>;
    setByJsonPath(key: string, jsonPath: string, value: string): Promise<number>;
    create(key: string, value: string): Promise<number>;
    delete(key: string): Promise<number>;
    append(key: string, value: string): Promise<number>;
    list(key: string): Promise<string[]>;
    execTx(actions: Record<string, SystemConfigTxAction>, mainKey?: [string, number]): Promise<number>;
    dumpConfigsForScheduler(): Promise<unknown>;
    refreshTrustKeys(): Promise<void>;
}
//# sourceMappingURL=system_config_client.d.ts.map