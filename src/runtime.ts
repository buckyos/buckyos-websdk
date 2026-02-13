import { kRPCClient } from './krpc_client'
import { VerifyHubClient } from './verify-hub-client'
import { TaskManagerClient } from './task_mgr_client'
import { OpenDanClient } from './opendan_client'

export enum RuntimeType {
  Browser = 'Browser',
  NodeJS = 'NodeJS',
  AppRuntime = 'AppRuntime',
  Unknown = 'Unknown',
}

export interface BuckyOSConfig {
  zoneHost: string
  appId: string
  defaultProtocol: string
  runtimeType: RuntimeType
}

export const DEFAULT_CONFIG: BuckyOSConfig = {
  zoneHost: '',
  appId: '',
  defaultProtocol: 'http://',
  runtimeType: RuntimeType.Unknown,
}

export class BuckyOSRuntime {
  private config: BuckyOSConfig
  private sessionToken: string | null
  private refreshToken: string | null

  constructor(config: BuckyOSConfig) {
    this.config = config
    this.sessionToken = null
    this.refreshToken = null
  }

  setConfig(config: BuckyOSConfig) {
    this.config = config
  }

  getConfig(): BuckyOSConfig {
    return this.config
  }

  getAppId(): string {
    return this.config.appId
  }

  getZoneHostName(): string {
    return this.config.zoneHost
  }

  getZoneServiceURL(serviceName: string): string {
    return `/kapi/${serviceName}/`
  }

  setSessionToken(token: string | null) {
    this.sessionToken = token
  }

  setRefreshToken(token: string | null) {
    this.refreshToken = token
  }

  getSessionToken(): string | null {
    return this.sessionToken
  }

  getRefreshToken(): string | null {
    return this.refreshToken
  }

  getServiceRpcClient(serviceName: string): kRPCClient {
    return new kRPCClient(this.getZoneServiceURL(serviceName), this.sessionToken)
  }

  getVerifyHubClient(): VerifyHubClient {
    const rpcClient = this.getServiceRpcClient('verify-hub')
    return new VerifyHubClient(rpcClient)
  }

  getTaskManagerClient(): TaskManagerClient {
    const rpcClient = this.getServiceRpcClient('task-manager')
    return new TaskManagerClient(rpcClient)
  }

  getOpenDanClient(): OpenDanClient {
    const rpcClient = this.getServiceRpcClient('opendan')
    return new OpenDanClient(rpcClient)
  }
}
