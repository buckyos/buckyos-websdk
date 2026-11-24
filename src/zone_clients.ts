import { ContentRegistryClient } from './content'
import { kRPCClient, type KRPCClientOptions } from './krpc_client'
import { MsgCenterClient } from './msg_center_client'
import { SystemConfigClient } from './system_config_client'
import { TaskManagerClient } from './task_mgr_client'
import { VerifyHubClient } from './verify-hub-client'

export interface ZoneClientsOptions {
  /** Host of the Zone, with a port when it is not 443. */
  zoneHost: string
  /** Who the calls are made as; only kept here for the caller. */
  userId?: string
  ownerDid?: string
  /** Carries every request. It may add the session itself (the native client does, so no token reaches the page). */
  fetcher: NonNullable<KRPCClientOptions['fetcher']>
  sessionTokenProvider?: KRPCClientOptions['sessionTokenProvider']
}

export interface ZoneClients {
  readonly zoneHost: string
  readonly userId?: string
  readonly ownerDid?: string
  /** A kRPC client of any service of this Zone. */
  rpc(service: string): kRPCClient
  readonly msgCenter: MsgCenterClient
  readonly taskManager: TaskManagerClient
  readonly verifyHub: VerifyHubClient
  readonly systemConfig: SystemConfigClient
  /** Which Apps handle which content, with this user's preferences (`userId` of the options by default). */
  contentRegistry(userId?: string): ContentRegistryClient
}

/**
 * Clients of one Zone. Unlike `initBuckyOS`, which binds the page to one Zone, any number of Zones can be used side by
 * side: nothing here reads the global runtime.
 */
export function createZoneClients(options: ZoneClientsOptions): ZoneClients {
  const { zoneHost, userId, ownerDid, fetcher, sessionTokenProvider } = options
  const url = (service: string) => `https://${zoneHost}/kapi/${service}`
  const rpcOptions: KRPCClientOptions = { fetcher, sessionTokenProvider }
  const rpc = (service: string) => new kRPCClient(url(service), null, null, rpcOptions)
  const systemConfig = new SystemConfigClient(url('system_config'), null, rpcOptions)
  return {
    zoneHost, userId, ownerDid, rpc, systemConfig,
    msgCenter: new MsgCenterClient(rpc('msg-center')),
    taskManager: new TaskManagerClient(rpc('task-manager')),
    // Signing in and renewing carry their own credential: a session token from the provider does not belong there.
    verifyHub: new VerifyHubClient(new kRPCClient(url('verify-hub'), null, null, { fetcher })),
    contentRegistry: (user = userId) => {
      if (!user) throw new Error('contentRegistry requires a user id')
      return new ContentRegistryClient(systemConfig, user)
    },
  }
}
