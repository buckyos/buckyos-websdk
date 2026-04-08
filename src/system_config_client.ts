import { kRPCClient, KRPCClientOptions } from './krpc_client'

export interface SystemConfigValue {
  value: string
  version: number
  is_changed: boolean
}

type SysConfigGetResponse = {
  value: string
  version: number
}

export type SystemConfigTxAction =
  | { action: 'create' | 'update' | 'append'; value: string }
  | { action: 'set_by_path'; all_set: Record<string, unknown> }
  | { action: 'remove' }

const CONFIG_CACHE_TIME_SECONDS = 10
const CACHE_KEY_PREFIXES = ['services/', 'system/rbac/']

type ConfigCacheEntry = {
  value: string
  version: number
  cachedAt: number
}

export class SystemConfigClient {
  private rpcClient: kRPCClient
  // Cache is per-client-instance to mirror the Rust SystemConfigClient
  // (../../buckyos/src/kernel/buckyos-api/src/system_config.rs). A static
  // cache would leak across logins / different RBAC contexts.
  private readonly configCache = new Map<string, ConfigCacheEntry>()

  constructor(serviceUrl: string, sessionToken: string | null = null, options: KRPCClientOptions = {}) {
    this.rpcClient = new kRPCClient(serviceUrl, sessionToken, null, options)
  }

  setSeq(seq: number) {
    this.rpcClient.setSeq(seq)
  }

  async syncSessionToken(token: string | null): Promise<void> {
    this.rpcClient.setSessionToken(token)
  }

  getSessionToken(): string | null {
    return this.rpcClient.getSessionToken()
  }

  private needCache(key: string): boolean {
    return CACHE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))
  }

  private getUnixTimestamp(): number {
    return Math.floor(Date.now() / 1000)
  }

  private getConfigCache(key: string): ConfigCacheEntry | null {
    const cached = this.configCache.get(key)
    if (!cached) {
      return null
    }

    if (cached.cachedAt + CONFIG_CACHE_TIME_SECONDS < this.getUnixTimestamp()) {
      this.configCache.delete(key)
      return null
    }

    return cached
  }

  private setConfigCache(key: string, value: string, version: number): boolean {
    if (!this.needCache(key)) {
      return true
    }

    const previous = this.configCache.get(key)
    this.configCache.set(key, {
      value,
      version,
      cachedAt: this.getUnixTimestamp(),
    })
    if (!previous) {
      return true
    }
    return previous.value !== value || previous.version !== version
  }

  private removeConfigCache(key: string) {
    this.configCache.delete(key)
  }

  async get(key: string): Promise<SystemConfigValue> {
    const cachedValue = this.getConfigCache(key)
    if (cachedValue != null) {
      return {
        value: cachedValue.value,
        version: cachedValue.version,
        is_changed: false,
      }
    }

    const result = await this.rpcClient.call<SysConfigGetResponse | null, { key: string }>('sys_config_get', { key })
    if (result == null) {
      throw new Error(`system_config key not found: ${key}`)
    }

    if (typeof result.value !== 'string' || typeof result.version !== 'number') {
      throw new Error(`invalid sys_config_get response for key: ${key}`)
    }

    const isChanged = this.setConfigCache(key, result.value, result.version)

    return {
      value: result.value,
      version: result.version,
      is_changed: isChanged,
    }
  }

  async set(key: string, value: string): Promise<number> {
    if (!key || !value) {
      throw new Error('key or value is empty')
    }
    if (key.includes(':')) {
      throw new Error("key can not contain ':'")
    }

    await this.rpcClient.call<unknown, { key: string; value: string }>('sys_config_set', { key, value })
    this.removeConfigCache(key)
    return 0
  }

  async setByJsonPath(key: string, jsonPath: string, value: string): Promise<number> {
    await this.rpcClient.call<unknown, { key: string; json_path: string; value: string }>(
      'sys_config_set_by_json_path',
      { key, json_path: jsonPath, value },
    )
    this.removeConfigCache(key)
    return 0
  }

  async create(key: string, value: string): Promise<number> {
    await this.rpcClient.call<unknown, { key: string; value: string }>('sys_config_create', { key, value })
    this.removeConfigCache(key)
    return 0
  }

  async delete(key: string): Promise<number> {
    await this.rpcClient.call<unknown, { key: string }>('sys_config_delete', { key })
    this.removeConfigCache(key)
    return 0
  }

  async append(key: string, value: string): Promise<number> {
    await this.rpcClient.call<unknown, { key: string; append_value: string }>('sys_config_append', {
      key,
      append_value: value,
    })
    this.removeConfigCache(key)
    return 0
  }

  async list(key: string): Promise<string[]> {
    return this.rpcClient.call<string[], { key: string }>('sys_config_list', { key })
  }

  async execTx(actions: Record<string, SystemConfigTxAction>, mainKey?: [string, number]): Promise<number> {
    const params: Record<string, unknown> = { actions }
    if (mainKey) {
      params.main_key = `${mainKey[0]}:${mainKey[1]}`
    }
    await this.rpcClient.call<unknown, Record<string, unknown>>('sys_config_exec_tx', params)
    for (const key of Object.keys(actions)) {
      this.removeConfigCache(key)
    }
    return 0
  }

  async dumpConfigsForScheduler(): Promise<unknown> {
    return this.rpcClient.call<unknown, Record<string, never>>('dump_configs_for_scheduler', {})
  }

  async refreshTrustKeys(): Promise<void> {
    await this.rpcClient.call<unknown, Record<string, never>>('sys_refresh_trust_keys', {})
  }
}
