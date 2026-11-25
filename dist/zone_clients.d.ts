import { ContentRegistryClient } from './content';
import { kRPCClient, type KRPCClientOptions } from './krpc_client';
import { MsgCenterClient } from './msg_center_client';
import { SystemConfigClient } from './system_config_client';
import { TaskManagerClient } from './task_mgr_client';
import { VerifyHubClient } from './verify-hub-client';
export interface ZoneClientsOptions {
    /** Host of the Zone, with a port when it is not 443. */
    zoneHost: string;
    /** Who the calls are made as; only kept here for the caller. */
    userId?: string;
    ownerDid?: string;
    /** Carries every request. It may add the session itself (the native client does, so no token reaches the page). */
    fetcher: NonNullable<KRPCClientOptions['fetcher']>;
    sessionTokenProvider?: KRPCClientOptions['sessionTokenProvider'];
}
export interface ZoneClients {
    readonly zoneHost: string;
    readonly userId?: string;
    readonly ownerDid?: string;
    /** A kRPC client of any service of this Zone. */
    rpc(service: string): kRPCClient;
    readonly msgCenter: MsgCenterClient;
    readonly taskManager: TaskManagerClient;
    readonly verifyHub: VerifyHubClient;
    readonly systemConfig: SystemConfigClient;
    /** Which Apps handle which content, with this user's preferences (`userId` of the options by default). */
    contentRegistry(userId?: string): ContentRegistryClient;
}
/**
 * Clients of one Zone. Unlike `initBuckyOS`, which binds the page to one Zone, any number of Zones can be used side by
 * side: nothing here reads the global runtime.
 */
export declare function createZoneClients(options: ZoneClientsOptions): ZoneClients;
//# sourceMappingURL=zone_clients.d.ts.map