import { kRPCClient } from './krpc_client'
import { AuthClient } from './auth_client'
import {
  hashPassword,
  AccountInfo,
  cleanLocalAccountInfo,
  getLocalAccountInfo,
  saveLocalAccountInfo,
} from './account'
import {
  BuckyOSRuntime,
  BuckyOSConfig,
  DEFAULT_CONFIG,
  RuntimeType,
  parseSessionTokenClaims,
} from './runtime'
import { VerifyHubClient } from './verify-hub-client'
import { TaskManagerClient } from './task_mgr_client'
import { OpenDanClient } from './opendan_client'
import { SystemConfigClient } from './system_config_client'

export const WEB3_BRIDGE_HOST = 'web3.buckyos.ai'

export const BS_SERVICE_VERIFY_HUB = 'verify-hub'
export const BS_SERVICE_TASK_MANAGER = 'task-manager'
export const BS_SERVICE_OPENDAN = 'opendan'

export type SDKTarget = 'universal' | 'browser' | 'node'

export interface WalletSignWithActiveDidResult {
  signatures: (string | null)[]
  pwd_hash: string | null
}

function isBrowserRuntime(): boolean {
  return typeof window !== 'undefined'
}

function getNodeEnv(): Record<string, string | undefined> {
  const runtimeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  return runtimeProcess?.env ?? {}
}

function trimToNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isBrowserStorageAvailable(): boolean {
  return typeof localStorage !== 'undefined'
}

function getSettingsPathSegments(settingName: string | null | undefined): string[] {
  if (!settingName) {
    return []
  }

  return settingName
    .split(/[./]/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
}

function getSettingValue(settings: unknown, settingName: string | null | undefined): unknown {
  const segments = getSettingsPathSegments(settingName)
  if (segments.length === 0) {
    return settings
  }

  let current: unknown = settings
  for (const segment of segments) {
    if (!current || typeof current !== 'object' || Array.isArray(current) || !(segment in current)) {
      return undefined
    }
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function setSettingValue(settings: Record<string, unknown>, settingName: string | null | undefined, value: unknown): Record<string, unknown> {
  const segments = getSettingsPathSegments(settingName)
  if (segments.length === 0) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('settingValue must be a JSON object when settingName is null')
    }
    return value as Record<string, unknown>
  }

  const nextSettings = Array.isArray(settings) ? {} : { ...settings }
  let current: Record<string, unknown> = nextSettings
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index]
    const previous = current[segment]
    const next = previous && typeof previous === 'object' && !Array.isArray(previous)
      ? { ...(previous as Record<string, unknown>) }
      : {}
    current[segment] = next
    current = next
  }

  current[segments[segments.length - 1]] = value
  return nextSettings
}

function parseSettingValue(settingValue: string): unknown {
  try {
    return JSON.parse(settingValue) as unknown
  } catch {
    return settingValue
  }
}

function inferNodeRuntimeType(): RuntimeType {
  const env = getNodeEnv()
  if (trimToNull(env.app_instance_config)) {
    return RuntimeType.AppService
  }
  return RuntimeType.AppClient
}

export class BuckyOSSDK {
  private currentRuntime: BuckyOSRuntime | null = null
  private currentAccountInfo: AccountInfo | null = null
  private readonly target: SDKTarget

  constructor(target: SDKTarget) {
    this.target = target
  }

  async initBuckyOS(appid: string, config: BuckyOSConfig | null = null): Promise<void> {
    const finalConfig = this.buildRuntimeConfig(appid, config)

    if (this.target !== 'node' && isBrowserRuntime() && !config) {
      let zoneHostName = localStorage.getItem('zone_host_name')
      if (zoneHostName) {
        finalConfig.zoneHost = zoneHostName
      } else {
        zoneHostName = await this.tryGetZoneHostName(appid, window.location.host, finalConfig.defaultProtocol)
        localStorage.setItem('zone_host_name', zoneHostName)
        finalConfig.zoneHost = zoneHostName
      }
    }

    this.currentRuntime?.stopAutoRenew()
    this.currentRuntime = new BuckyOSRuntime(finalConfig)
    await this.currentRuntime.initialize()
    this.syncCurrentAccountInfoFromRuntime()
  }

  getBuckyOSConfig(): BuckyOSConfig | null {
    return this.currentRuntime?.getConfig() ?? null
  }

  getRuntimeType(): RuntimeType {
    if (this.currentRuntime) {
      return this.currentRuntime.getConfig().runtimeType
    }
    return this.detectEnvironmentRuntimeType()
  }

  getAppId(): string | null {
    if (this.currentRuntime) {
      return this.currentRuntime.getAppId()
    }

    console.error('BuckyOS WebSDK is not initialized,call initBuckyOS first')
    return null
  }

  attachEvent(eventName: string, callback: Function) {
    const ignoredEventName = eventName
    const ignoredCallback = callback
    void ignoredEventName
    void ignoredCallback
  }

  removeEvent(cookieId: string) {
    const ignoredCookieId = cookieId
    void ignoredCookieId
  }

  getAccountInfo(): AccountInfo | null {
    this.syncCurrentAccountInfoFromRuntime()
    return this.currentAccountInfo
  }

  async doLogin(username: string, password: string): Promise<AccountInfo | null> {
    const appId = this.getAppId()
    if (appId == null) {
      console.error('BuckyOS WebSDK is not initialized,call initBuckyOS first')
      return null
    }

    const loginNonce = Date.now()
    const passwordHash = hashPassword(username, password, loginNonce)
    if (isBrowserStorageAvailable()) {
      localStorage.removeItem(`buckyos.account_info.${appId}`)
    }

    try {
      const verifyHubClient = this.getVerifyHubClient()
      verifyHubClient.setSeq(loginNonce)
      const accountResponse = await verifyHubClient.loginByPassword({
        username,
        password: passwordHash,
        appid: appId,
        source_url: typeof window !== 'undefined' ? window.location.href : undefined,
      })

      const normalized = VerifyHubClient.normalizeLoginResponse(accountResponse)
      const accountInfo: AccountInfo = {
        user_name: normalized.user_name,
        user_id: normalized.user_id,
        user_type: normalized.user_type,
        session_token: normalized.session_token,
        refresh_token: normalized.refresh_token,
      }

      if (isBrowserStorageAvailable()) {
        saveLocalAccountInfo(appId, accountInfo)
      }
      this.currentAccountInfo = accountInfo
      this.currentRuntime?.setSessionToken(accountInfo.session_token)
      this.currentRuntime?.setRefreshToken(accountInfo.refresh_token ?? null)
      return accountInfo
    } catch (error) {
      console.error('login failed: ', error)
      throw error
    }
  }

  async login(autoLogin: boolean = true): Promise<AccountInfo | null> {
    if (this.currentRuntime == null) {
      console.error('BuckyOS WebSDK is not initialized,call initBuckyOS first')
      return null
    }

    const runtimeType = this.currentRuntime.getConfig().runtimeType
    if (runtimeType === RuntimeType.AppClient || runtimeType === RuntimeType.AppService) {
      await this.currentRuntime.login()
      this.syncCurrentAccountInfoFromRuntime()
      return this.currentAccountInfo
    }

    const appId = this.getAppId()
    if (appId == null) {
      console.error('BuckyOS WebSDK is not initialized,call initBuckyOS first')
      return null
    }

    if (autoLogin && isBrowserStorageAvailable()) {
      const accountInfo = getLocalAccountInfo(appId)
      if (accountInfo) {
        this.currentAccountInfo = accountInfo
        this.currentRuntime.setSessionToken(accountInfo.session_token)
        this.currentRuntime.setRefreshToken(accountInfo.refresh_token ?? null)
        return this.currentAccountInfo
      }
    }

    if (isBrowserStorageAvailable()) {
      cleanLocalAccountInfo(appId)
    }

    const zoneHostName = this.getZoneHostName()
    if (zoneHostName == null) {
      console.error('BuckyOS WebSDK is not initialized,call initBuckyOS first')
      return null
    }

    try {
      const authClient = new AuthClient(zoneHostName, appId)
      const accountInfo = await authClient.login()
      if (accountInfo) {
        if (isBrowserStorageAvailable()) {
          saveLocalAccountInfo(appId, accountInfo)
        }
        this.currentAccountInfo = accountInfo
        this.currentRuntime.setSessionToken(accountInfo.session_token)
        this.currentRuntime.setRefreshToken(accountInfo.refresh_token ?? null)
      }
      return accountInfo
    } catch (error) {
      console.error('login failed: ', error)
      throw error
    }
  }

  logout(cleanAccountInfo: boolean = true) {
    if (this.currentRuntime == null) {
      console.error('BuckyOS WebSDK is not initialized,call initBuckyOS first')
      return
    }

    const appId = this.getAppId()
    if (appId == null) {
      console.error('BuckyOS WebSDK is not initialized,call initBuckyOS first')
      return
    }

    if (cleanAccountInfo && isBrowserStorageAvailable()) {
      cleanLocalAccountInfo(appId)
    }

    this.currentAccountInfo = null
    this.currentRuntime.clearAuthState()
  }

  async getAppSetting(settingName: string | null = null): Promise<unknown> {
    if (this.currentRuntime == null) {
      throw new Error('BuckyOS WebSDK is not initialized,call initBuckyOS first')
    }

    const settings = await this.currentRuntime.getMySettings()
    return getSettingValue(settings, settingName)
  }

  async setAppSetting(settingName: string | null = null, settingValue: string): Promise<void> {
    if (this.currentRuntime == null) {
      throw new Error('BuckyOS WebSDK is not initialized,call initBuckyOS first')
    }

    const currentSettings = await this.currentRuntime.getMySettings()
    const nextSettings = setSettingValue(
      currentSettings && typeof currentSettings === 'object' && !Array.isArray(currentSettings)
        ? { ...(currentSettings as Record<string, unknown>) }
        : {},
      settingName,
      parseSettingValue(settingValue),
    )
    await this.currentRuntime.updateAllMySettings(nextSettings)
  }

  getCurrentWalletUser(): Promise<any> {
    if (typeof window === 'undefined') {
      throw new Error('BuckyApi is only available in browser runtime')
    }

    return (async () => {
      const result: any = await (window as any).BuckyApi.getCurrentUser()
      if (result.code === 0) {
        return result.data
      }

      console.error('BuckyApi.getCurrentUser failed: ', result.message)
      return null
    })()
  }

  walletSignWithActiveDid(payloads: Record<string, unknown>[]): Promise<WalletSignWithActiveDidResult | null> {
    if (typeof window === 'undefined') {
      throw new Error('BuckyApi is only available in browser runtime')
    }

    return (async () => {
      const result: any = await (window as any).BuckyApi.signJsonWithActiveDid(payloads)
      if (result.code === 0) {
        return {
          signatures: Array.isArray(result.data?.signatures) ? result.data.signatures : [],
          pwd_hash: typeof result.data?.pwd_hash === 'string' ? result.data.pwd_hash : null,
        }
      }

      console.error('BuckyApi.signWithActiveDid failed: ', result.message)
      return null
    })()
  }

  async openExternalUrl(url: string): Promise<void> {
    if (typeof window === 'undefined') {
      throw new Error('openExternalUrl is only available in browser runtime')
    }

    const buckyApi = (window as unknown as {
      BuckyApi?: { openExternalUrl?: (targetUrl: string) => Promise<unknown> | unknown }
    }).BuckyApi
    if (typeof buckyApi?.openExternalUrl === 'function') {
      await buckyApi.openExternalUrl(url)
      return
    }

    window.open(url, '_blank', 'noopener,noreferrer')
  }

  getZoneHostName(): string | null {
    if (this.currentRuntime == null) {
      console.error('BuckyOS WebSDK is not initialized,call initBuckyOS first')
      return null
    }
    return this.currentRuntime.getZoneHostName()
  }

  getZoneServiceURL(serviceName: string): string {
    if (this.currentRuntime == null) {
      throw new Error('BuckyOS WebSDK is not initialized,call initBuckyOS first')
    }
    return this.currentRuntime.getZoneServiceURL(serviceName)
  }

  getServiceRpcClient(serviceName: string): kRPCClient {
    if (this.currentRuntime == null) {
      console.error('BuckyOS WebSDK is not initialized,call initBuckyOS first')
      throw new Error('BuckyOS WebSDK is not initialized,call initBuckyOS first')
    }

    this.syncCurrentAccountInfoFromRuntime()
    return this.currentRuntime.getServiceRpcClient(serviceName)
  }

  getVerifyHubClient(): VerifyHubClient {
    if (this.currentRuntime == null) {
      console.error('BuckyOS WebSDK is not initialized,call initBuckyOS first')
      throw new Error('BuckyOS WebSDK is not initialized,call initBuckyOS first')
    }
    return this.currentRuntime.getVerifyHubClient()
  }

  getSystemConfigClient(): SystemConfigClient {
    if (this.currentRuntime == null) {
      console.error('BuckyOS WebSDK is not initialized,call initBuckyOS first')
      throw new Error('BuckyOS WebSDK is not initialized,call initBuckyOS first')
    }
    return this.currentRuntime.getSystemConfigClient()
  }

  getTaskManagerClient(): TaskManagerClient {
    if (this.currentRuntime == null) {
      console.error('BuckyOS WebSDK is not initialized,call initBuckyOS first')
      throw new Error('BuckyOS WebSDK is not initialized,call initBuckyOS first')
    }
    return this.currentRuntime.getTaskManagerClient()
  }

  getOpenDanClient(): OpenDanClient {
    if (this.currentRuntime == null) {
      console.error('BuckyOS WebSDK is not initialized,call initBuckyOS first')
      throw new Error('BuckyOS WebSDK is not initialized,call initBuckyOS first')
    }
    return this.currentRuntime.getOpenDanClient()
  }

  private buildRuntimeConfig(appid: string, config: BuckyOSConfig | null): BuckyOSConfig {
    if (config) {
      let runtimeType = config.runtimeType
      if (runtimeType === RuntimeType.NodeJS && this.target !== 'browser') {
        runtimeType = inferNodeRuntimeType()
      }

      return {
        ...DEFAULT_CONFIG,
        ...config,
        appId: config.appId || appid,
        runtimeType,
      }
    }

    if (this.target === 'browser') {
      return {
        ...DEFAULT_CONFIG,
        appId: appid,
        runtimeType: this.detectEnvironmentRuntimeType(),
        defaultProtocol: typeof window !== 'undefined' ? window.location.protocol + '//' : 'http://',
      }
    }

    if (this.target === 'node') {
      return {
        ...DEFAULT_CONFIG,
        appId: appid,
        runtimeType: inferNodeRuntimeType(),
        defaultProtocol: 'https://',
        zoneHost: trimToNull(getNodeEnv().BUCKYOS_ZONE_HOST) ?? '',
      }
    }

    if (isBrowserRuntime()) {
      return {
        ...DEFAULT_CONFIG,
        appId: appid,
        runtimeType: this.detectEnvironmentRuntimeType(),
        defaultProtocol: window.location.protocol + '//',
      }
    }

    return {
      ...DEFAULT_CONFIG,
      appId: appid,
      runtimeType: inferNodeRuntimeType(),
      defaultProtocol: 'https://',
      zoneHost: trimToNull(getNodeEnv().BUCKYOS_ZONE_HOST) ?? '',
    }
  }

  private async tryGetZoneHostName(appid: string, host: string, defaultProtocol: string): Promise<string> {
    const ignoredAppId = appid
    void ignoredAppId

    let zoneDocUrl = defaultProtocol + host + '/1.0/identifiers/self'
    let response = await fetch(zoneDocUrl)
    if (response.status === 200) {
      return host
    }

    const upHost = host.split('.').slice(1).join('.')
    if (!upHost) {
      return host
    }

    zoneDocUrl = defaultProtocol + upHost + '/1.0/identifiers/self'
    response = await fetch(zoneDocUrl)
    if (response.status === 200) {
      return upHost
    }

    return host
  }

  private syncCurrentAccountInfoFromRuntime() {
    if (this.currentRuntime == null) {
      return
    }

    const sessionToken = this.currentRuntime.getSessionToken()
    if (!sessionToken) {
      return
    }

    const claims = parseSessionTokenClaims(sessionToken)
    const userId = typeof claims?.sub === 'string'
      ? claims.sub
      : typeof claims?.userid === 'string'
        ? claims.userid
        : this.currentRuntime.getOwnerUserId() ?? 'root'

    this.currentAccountInfo = {
      user_name: userId,
      user_id: userId,
      user_type: this.currentRuntime.getConfig().runtimeType === RuntimeType.AppService ? 'service' : 'root',
      session_token: sessionToken,
      refresh_token: this.currentRuntime.getRefreshToken() ?? undefined,
    }
  }

  private detectEnvironmentRuntimeType(): RuntimeType {
    if (this.target === 'browser') {
      if (typeof window !== 'undefined' && (window as unknown as { BuckyApi?: unknown }).BuckyApi) {
        return RuntimeType.AppRuntime
      }
      return typeof window !== 'undefined' ? RuntimeType.Browser : RuntimeType.Unknown
    }

    if (this.target === 'node') {
      const runtimeProcess = (globalThis as { process?: { versions?: { node?: string } } }).process
      if (runtimeProcess?.versions?.node) {
        return inferNodeRuntimeType()
      }
      return RuntimeType.Unknown
    }

    if (typeof window !== 'undefined') {
      if ((window as unknown as { BuckyApi?: unknown }).BuckyApi) {
        return RuntimeType.AppRuntime
      }
      return RuntimeType.Browser
    }

    const runtimeProcess = (globalThis as { process?: { versions?: { node?: string } } }).process
    if (runtimeProcess?.versions?.node) {
      return RuntimeType.NodeJS
    }

    return RuntimeType.Unknown
  }
}

export function createSDKModule(target: SDKTarget) {
  const sdk = new BuckyOSSDK(target)

  const api = {
    initBuckyOS: sdk.initBuckyOS.bind(sdk),
    getBuckyOSConfig: sdk.getBuckyOSConfig.bind(sdk),
    getRuntimeType: sdk.getRuntimeType.bind(sdk),
    getAppId: sdk.getAppId.bind(sdk),
    attachEvent: sdk.attachEvent.bind(sdk),
    removeEvent: sdk.removeEvent.bind(sdk),
    getAccountInfo: sdk.getAccountInfo.bind(sdk),
    doLogin: sdk.doLogin.bind(sdk),
    login: sdk.login.bind(sdk),
    logout: sdk.logout.bind(sdk),
    getAppSetting: sdk.getAppSetting.bind(sdk),
    setAppSetting: sdk.setAppSetting.bind(sdk),
    getCurrentWalletUser: sdk.getCurrentWalletUser.bind(sdk),
    walletSignWithActiveDid: sdk.walletSignWithActiveDid.bind(sdk),
    openExternalUrl: sdk.openExternalUrl.bind(sdk),
    getZoneHostName: sdk.getZoneHostName.bind(sdk),
    getZoneServiceURL: sdk.getZoneServiceURL.bind(sdk),
    getServiceRpcClient: sdk.getServiceRpcClient.bind(sdk),
    getVerifyHubClient: sdk.getVerifyHubClient.bind(sdk),
    getSystemConfigClient: sdk.getSystemConfigClient.bind(sdk),
    getTaskManagerClient: sdk.getTaskManagerClient.bind(sdk),
    getOpenDanClient: sdk.getOpenDanClient.bind(sdk),
  }

  return {
    ...api,
    buckyos: {
      kRPCClient,
      AuthClient,
      ...api,
      hashPassword,
    },
  }
}

export type { BuckyOSConfig }
export { RuntimeType }
export { parseSessionTokenClaims }
export { VerifyHubClient }
export { SystemConfigClient }
export { TaskManagerClient }
export { OpenDanClient }
