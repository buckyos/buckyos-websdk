import { kRPCClient } from './krpc_client'

export interface SystemConfigValue {
  value: string
  version: number
  is_changed: boolean
}

export class SystemConfigClient {
  private rpcClient: kRPCClient

  constructor(serviceUrl: string, sessionToken: string | null = null) {
    this.rpcClient = new kRPCClient(serviceUrl, sessionToken)
  }

  async get(key: string): Promise<SystemConfigValue> {
    const result = await this.rpcClient.call<string | null, { key: string }>('sys_config_get', { key })
    if (typeof result !== 'string') {
      throw new Error(`system_config key not found: ${key}`)
    }

    return {
      value: result,
      version: Date.now(),
      is_changed: true,
    }
  }

  async set(key: string, value: string): Promise<number> {
    await this.rpcClient.call<unknown, { key: string; value: string }>('sys_config_set', { key, value })
    return 0
  }
}
