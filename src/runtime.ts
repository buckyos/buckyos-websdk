import { kRPCClient } from './krpc_client'
import { VerifyHubClient } from './verify-hub-client'
import { TaskManagerClient } from './task_mgr_client'
import { SystemConfigClient } from './system_config_client'
import { AiccClient } from './aicc_client'
import { MsgQueueClient } from './msg_queue_client'
import { MsgCenterClient } from './msg_center_client'
import { RepoClient } from './repo_client'
import { BrowserUserInfo, getBrowserUserInfo, saveBrowserUserInfo } from './account'
import { parseDeviceMiniConfig, parseOwnerConfigDocument } from './types'

declare const require: undefined | ((name: string) => any)

const DEFAULT_NODE_GATEWAY_PORT = 3180
const DEFAULT_SESSION_TOKEN_TTL_SECONDS = 15 * 60
const DEFAULT_RENEW_INTERVAL_MS = 5_000
const BUCKYOS_HOST_GATEWAY_ENV = 'BUCKYOS_HOST_GATEWAY'
const DEFAULT_DOCKER_HOST_GATEWAY = 'host.docker.internal'

interface BrowserSSORefreshResponse {
  access_token?: unknown
  session_token?: unknown
  user_info?: unknown
}

export enum RuntimeType {
  Browser = 'Browser',
  NodeJS = 'NodeJS',
  AppRuntime = 'AppRuntime',
  AppClient = 'AppClient',
  AppService = 'AppService',
  Unknown = 'Unknown',
}

export interface SessionTokenClaims {
  appid?: string
  aud?: string
  sub?: string
  iss?: string
  exp?: number
  jti?: string
  session?: number
  token_type?: string
  userid?: string
  [key: string]: unknown
}

export interface BuckyOSConfig {
  zoneHost: string
  appId: string
  defaultProtocol: string
  runtimeType: RuntimeType
  userid?: string | null
  ownerUserId?: string | null
  rootDir?: string
  sessionToken?: string | null
  refreshToken?: string | null
  privateKeySearchPaths?: string[]
  systemConfigServiceUrl?: string
  verifyHubServiceUrl?: string
  nodeGatewayPort?: number
  autoRenew?: boolean
  renewIntervalMs?: number
}

export const DEFAULT_CONFIG: BuckyOSConfig = {
  zoneHost: '',
  appId: '',
  defaultProtocol: 'http://',
  runtimeType: RuntimeType.Unknown,
  userid: null,
  ownerUserId: null,
  rootDir: '',
  sessionToken: null,
  refreshToken: null,
  privateKeySearchPaths: [],
  systemConfigServiceUrl: '',
  verifyHubServiceUrl: '',
  nodeGatewayPort: DEFAULT_NODE_GATEWAY_PORT,
  autoRenew: true,
  renewIntervalMs: DEFAULT_RENEW_INTERVAL_MS,
}

interface LocalSigningMaterial {
  keyPem: string
  issuer: string
  subject: string
  sourcePath: string
}

interface NodeIdentityMetadata {
  deviceName: string | null
  zoneDid: string | null
  zoneName: string | null
}

function getProcessEnv(): Record<string, string | undefined> {
  const runtimeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  return runtimeProcess?.env ?? {}
}

function hasNodeRuntime(): boolean {
  const runtimeProcess = (globalThis as { process?: { versions?: { node?: string } } }).process
  return Boolean(runtimeProcess?.versions?.node)
}

function hasBrowserStorage(): boolean {
  return typeof localStorage !== 'undefined'
}

function hasFetchRuntime(): boolean {
  return typeof fetch === 'function'
}

function ensureBuffer(): {
  from: (input: string | Uint8Array, encoding?: string) => { toString: (encoding: string) => string }
} {
  const bufferCtor = (globalThis as { Buffer?: unknown }).Buffer
  if (!bufferCtor || typeof bufferCtor !== 'function') {
    throw new Error('Buffer is not available in this runtime')
  }
  return bufferCtor as unknown as {
    from: (input: string | Uint8Array, encoding?: string) => { toString: (encoding: string) => string }
  }
}

function base64UrlEncode(value: string | Uint8Array): string {
  const BufferCtor = ensureBuffer()
  const base64 = typeof value === 'string'
    ? BufferCtor.from(value, 'utf8').toString('base64')
    : BufferCtor.from(value).toString('base64')
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlDecode(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)

  if (typeof atob === 'function') {
    return atob(padded)
  }

  const BufferCtor = ensureBuffer()
  return BufferCtor.from(padded, 'base64').toString('utf8')
}

export function parseSessionTokenClaims(token: string | null | undefined): SessionTokenClaims | null {
  if (!token) {
    return null
  }

  const parts = token.split('.')
  if (parts.length < 2) {
    return null
  }

  try {
    return JSON.parse(base64UrlDecode(parts[1])) as SessionTokenClaims
  } catch {
    return null
  }
}

function trimToNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeServicePath(serviceName: string): string {
  if (serviceName === 'system-config') {
    return 'system_config'
  }
  return serviceName
}

function getFullAppId(appId: string, ownerUserId: string): string {
  return `${ownerUserId}-${appId}`
}

function getAppHostPrefix(appId: string, ownerUserId: string | null | undefined): string {
  if (!ownerUserId) {
    return appId
  }
  return `${appId}-${ownerUserId}`
}

function getSessionTokenEnvKey(appFullId: string, isAppService: boolean): string {
  const normalized = appFullId.toUpperCase().replace(/-/g, '_')
  return isAppService ? `${normalized}_TOKEN` : `${normalized}_SESSION_TOKEN`
}

function resolveZoneHostFromDid(zoneDid: string | null | undefined): string | null {
  const normalized = trimToNull(zoneDid)
  if (!normalized) {
    return null
  }

  if (normalized.startsWith('did:web:')) {
    return normalized.slice('did:web:'.length).replace(/:/g, '.')
  }

  if (normalized.startsWith('did:bns:')) {
    return normalized.slice('did:bns:'.length)
  }

  return null
}

function parseAppIdentityFromInstanceConfig(appInstanceConfig: string): {
  appId: string
  ownerUserId: string
} | null {
  try {
    const parsed = JSON.parse(appInstanceConfig) as {
      app_spec?: {
        user_id?: unknown
        app_doc?: {
          name?: unknown
        }
      }
    }
    const appId = typeof parsed.app_spec?.app_doc?.name === 'string' ? parsed.app_spec.app_doc.name.trim() : ''
    const ownerUserId = typeof parsed.app_spec?.user_id === 'string' ? parsed.app_spec.user_id.trim() : ''
    if (!appId || !ownerUserId) {
      return null
    }
    return { appId, ownerUserId }
  } catch {
    return null
  }
}

async function importNodeModule(moduleName: string): Promise<any> {
  if (hasNodeRuntime() && typeof require === 'function') {
    return require(moduleName)
  }

  const dynamicImport = Function('name', 'return import(name)')
  return dynamicImport(moduleName) as Promise<any>
}

interface RuntimeProfile {
  initialize(runtime: BuckyOSRuntime): Promise<void>
  login(runtime: BuckyOSRuntime): Promise<void>
  getZoneServiceURL(runtime: BuckyOSRuntime, servicePath: string): string
  getSystemConfigServiceURL(runtime: BuckyOSRuntime): string
  getMySettingsPath(runtime: BuckyOSRuntime): string
  supportsManagedSessionRenewal(): boolean
  shouldSkipVerifyHubRenewal(runtime: BuckyOSRuntime): boolean
  getVerifyHubLoginJwt(runtime: BuckyOSRuntime, sessionToken: string): Promise<string>
}

abstract class BaseRuntimeProfile implements RuntimeProfile {
  async initialize(runtime: BuckyOSRuntime): Promise<void> {
    runtime.resolveNodeIdentityFromEnv()
    await runtime.resolveZoneHostFromLocalConfig()
  }

  async login(runtime: BuckyOSRuntime): Promise<void> {
    await runtime.initialize()
    runtime.startAutoRenewIfNeeded()
  }

  supportsManagedSessionRenewal(): boolean {
    return false
  }

  shouldSkipVerifyHubRenewal(_runtime: BuckyOSRuntime): boolean {
    return false
  }

  async getVerifyHubLoginJwt(_runtime: BuckyOSRuntime, sessionToken: string): Promise<string> {
    return sessionToken
  }

  abstract getZoneServiceURL(runtime: BuckyOSRuntime, servicePath: string): string

  abstract getSystemConfigServiceURL(runtime: BuckyOSRuntime): string

  abstract getMySettingsPath(runtime: BuckyOSRuntime): string
}

class BrowserRuntimeProfile extends BaseRuntimeProfile {
  getRelativeZoneServiceURL(servicePath: string): string {
    return `/kapi/${servicePath}/`
  }

  getRelativeSystemConfigServiceURL(): string {
    return '/kapi/system_config'
  }

  getServiceSettingsPath(runtime: BuckyOSRuntime): string {
    return `services/${runtime.getAppId()}/settings`
  }

  getZoneServiceURL(_runtime: BuckyOSRuntime, servicePath: string): string {
    return this.getRelativeZoneServiceURL(servicePath)
  }

  getSystemConfigServiceURL(_runtime: BuckyOSRuntime): string {
    return this.getRelativeSystemConfigServiceURL()
  }

  getMySettingsPath(runtime: BuckyOSRuntime): string {
    return this.getServiceSettingsPath(runtime)
  }
}

class AppRuntimeProfile extends BrowserRuntimeProfile {}

abstract class ManagedSessionRuntimeProfile extends BaseRuntimeProfile {
  async login(runtime: BuckyOSRuntime): Promise<void> {
    await runtime.initialize()
    await runtime.renewTokenFromVerifyHub()
    runtime.startAutoRenewIfNeeded()
  }

  supportsManagedSessionRenewal(): boolean {
    return true
  }
}

class AppClientRuntimeProfile extends ManagedSessionRuntimeProfile {
  async initialize(runtime: BuckyOSRuntime): Promise<void> {
    await super.initialize(runtime)
    await runtime.ensureAppClientSessionToken()
  }

  getScopedAppZoneServiceURL(runtime: BuckyOSRuntime, servicePath: string): string {
    const zoneHost = trimToNull(runtime.getZoneHostName())
    if (!zoneHost) {
      throw new Error('zoneHost is required in AppClient mode')
    }
    const appHostPrefix = getAppHostPrefix(runtime.getAppId(), runtime.getOwnerUserId())
    return `${runtime.getDefaultProtocol()}${appHostPrefix}.${zoneHost}/kapi/${servicePath}`
  }

  getZoneSystemConfigURL(runtime: BuckyOSRuntime): string {
    const zoneHost = trimToNull(runtime.getZoneHostName())
    if (!zoneHost) {
      throw new Error('zoneHost is required in AppClient mode')
    }
    return `${runtime.getDefaultProtocol()}${zoneHost}/kapi/system_config`
  }

  getZoneServiceURL(runtime: BuckyOSRuntime, servicePath: string): string {
    return this.getScopedAppZoneServiceURL(runtime, servicePath)
  }

  getSystemConfigServiceURL(runtime: BuckyOSRuntime): string {
    return this.getZoneSystemConfigURL(runtime)
  }

  getMySettingsPath(): string {
    throw new Error('AppClient not support getMySettingsPath')
  }

  shouldSkipVerifyHubRenewal(runtime: BuckyOSRuntime): boolean {
    return !trimToNull(runtime.getZoneHostName()) && !runtime.getConfiguredVerifyHubServiceUrl()
  }

  async getVerifyHubLoginJwt(runtime: BuckyOSRuntime, _sessionToken: string): Promise<string> {
    return runtime.createAppClientSessionToken()
  }
}

class AppServiceRuntimeProfile extends ManagedSessionRuntimeProfile {
  async initialize(runtime: BuckyOSRuntime): Promise<void> {
    await super.initialize(runtime)
    runtime.ensureAppServiceSessionToken()
  }

  getNodeGatewayServiceURL(runtime: BuckyOSRuntime, servicePath: string): string {
    const port = runtime.getNodeGatewayPort()
    return `http://${runtime.resolveAppServiceGatewayHost()}:${port}/kapi/${servicePath}`
  }

  getNodeGatewaySystemConfigURL(runtime: BuckyOSRuntime): string {
    const port = runtime.getNodeGatewayPort()
    return `http://${runtime.resolveAppServiceGatewayHost()}:${port}/kapi/system_config`
  }

  getUserAppSettingsPath(runtime: BuckyOSRuntime): string {
    const ownerUserId = runtime.getOwnerUserId()
    if (!ownerUserId) {
      throw new Error('ownerUserId is required for AppService settings')
    }
    return `users/${ownerUserId}/apps/${runtime.getAppId()}/settings`
  }

  getZoneServiceURL(runtime: BuckyOSRuntime, servicePath: string): string {
    return this.getNodeGatewayServiceURL(runtime, servicePath)
  }

  getSystemConfigServiceURL(runtime: BuckyOSRuntime): string {
    return this.getNodeGatewaySystemConfigURL(runtime)
  }

  getMySettingsPath(runtime: BuckyOSRuntime): string {
    return this.getUserAppSettingsPath(runtime)
  }
}

function createRuntimeProfile(runtimeType: RuntimeType): RuntimeProfile {
  switch (runtimeType) {
    case RuntimeType.AppClient:
      return new AppClientRuntimeProfile()
    case RuntimeType.AppService:
      return new AppServiceRuntimeProfile()
    case RuntimeType.AppRuntime:
      return new AppRuntimeProfile()
    case RuntimeType.Browser:
    case RuntimeType.NodeJS:
    case RuntimeType.Unknown:
    default:
      return new BrowserRuntimeProfile()
  }
}

export class BuckyOSRuntime {
  private config: BuckyOSConfig
  private sessionToken: string | null
  //在browser runtime里，总是取不到的
  private refreshToken: string | null
  private renewTimer: ReturnType<typeof setInterval> | null
  private initialized: boolean
  private profile: RuntimeProfile

  constructor(config: BuckyOSConfig) {
    const normalizedOwnerUserId = trimToNull(config.ownerUserId) ?? trimToNull(config.userid)
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      appId: config.appId,
      userid: normalizedOwnerUserId,
      ownerUserId: normalizedOwnerUserId,
      zoneHost: config.zoneHost ?? '',
      defaultProtocol: config.defaultProtocol ?? DEFAULT_CONFIG.defaultProtocol,
    }
    this.sessionToken = trimToNull(config.sessionToken)
    this.refreshToken = trimToNull(config.refreshToken)
    this.renewTimer = null
    this.initialized = false
    this.profile = createRuntimeProfile(this.config.runtimeType)
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }

    await this.profile.initialize(this)
    this.validateSessionToken()
    this.initialized = true
  }

  async login(): Promise<void> {
    await this.profile.login(this)
  }

  setConfig(config: BuckyOSConfig) {
    const normalizedOwnerUserId = trimToNull(config.ownerUserId) ?? trimToNull(config.userid)
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      appId: config.appId,
      userid: normalizedOwnerUserId,
      ownerUserId: normalizedOwnerUserId,
    }
    this.profile = createRuntimeProfile(this.config.runtimeType)
  }

  getConfig(): BuckyOSConfig {
    return { ...this.config }
  }

  getAppId(): string {
    return this.config.appId
  }

  getOwnerUserId(): string | null {
    return trimToNull(this.config.ownerUserId)
  }

  getFullAppId(): string {
    const ownerUserId = this.getOwnerUserId()
    if (!ownerUserId) {
      return this.config.appId
    }
    return getFullAppId(this.config.appId, ownerUserId)
  }

  getZoneHostName(): string {
    return this.config.zoneHost
  }

  getDefaultProtocol(): string {
    return this.config.defaultProtocol
  }

  getNodeGatewayPort(): number {
    return this.config.nodeGatewayPort ?? DEFAULT_NODE_GATEWAY_PORT
  }

  getConfiguredVerifyHubServiceUrl(): string | null {
    return trimToNull(this.config.verifyHubServiceUrl)
  }

  getZoneServiceURL(serviceName: string): string {
    const servicePath = normalizeServicePath(serviceName)
    return this.profile.getZoneServiceURL(this, servicePath)
  }

  getSystemConfigServiceURL(): string {
    const configuredUrl = this.getConfiguredSystemConfigServiceUrl()
    if (configuredUrl) {
      return configuredUrl
    }
    return this.profile.getSystemConfigServiceURL(this)
  }

  setSessionToken(token: string | null) {
    this.sessionToken = trimToNull(token)
  }

  setRefreshToken(token: string | null) {
    this.refreshToken = trimToNull(token)
  }

  getSessionToken(): string | null {
    return this.sessionToken
  }

  getRefreshToken(): string | null {
    return this.refreshToken
  }

  clearAuthState() {
    this.sessionToken = null
    this.refreshToken = null
    this.stopAutoRenew()
  }

  stopAutoRenew() {
    if (this.renewTimer) {
      clearInterval(this.renewTimer)
      this.renewTimer = null
    }
  }

  getServiceRpcClient(serviceName: string): kRPCClient {
    return new kRPCClient(this.getZoneServiceURL(serviceName), this.sessionToken, null, {
      sessionTokenProvider: this.ensureSessionTokenReady.bind(this),
      onSessionTokenChanged: this.setSessionToken.bind(this),
    })
  }

  getSystemConfigClient(): SystemConfigClient {
    return new SystemConfigClient(this.getSystemConfigServiceURL(), this.sessionToken, {
      sessionTokenProvider: this.ensureSessionTokenReady.bind(this),
      onSessionTokenChanged: this.setSessionToken.bind(this),
    })
  }

  getVerifyHubClient(): VerifyHubClient {
    const configuredUrl = this.getConfiguredVerifyHubServiceUrl()
    const rpcClient = new kRPCClient(configuredUrl ?? this.getZoneServiceURL('verify-hub'), this.sessionToken)
    return new VerifyHubClient(rpcClient)
  }

  getTaskManagerClient(): TaskManagerClient {
    const rpcClient = this.getServiceRpcClient('task-manager')
    return new TaskManagerClient(rpcClient)
  }

  getAiccClient(): AiccClient {
    return new AiccClient(this.getServiceRpcClient('aicc'))
  }

  getMsgQueueClient(): MsgQueueClient {
    return new MsgQueueClient(this.getServiceRpcClient('kmsg'))
  }

  getMsgCenterClient(): MsgCenterClient {
    return new MsgCenterClient(this.getServiceRpcClient('msg-center'))
  }

  getRepoClient(): RepoClient {
    return new RepoClient(this.getServiceRpcClient('repo-service'))
  }

  async getMySettings(): Promise<unknown> {
    const settingsPath = this.getMySettingsPath()
    const settingsValue = await this.getSystemConfigClient().get(settingsPath)
    return JSON.parse(settingsValue.value) as unknown
  }

  async updateMySettings(jsonPath: string, settings: unknown): Promise<void> {
    const settingsPath = this.getMySettingsPath()
    const settingsValue = JSON.stringify(settings)
    await this.getSystemConfigClient().setByJsonPath(settingsPath, jsonPath, settingsValue)
  }

  async updateAllMySettings(settings: unknown): Promise<void> {
    const settingsPath = this.getMySettingsPath()
    const settingsValue = JSON.stringify(settings)
    await this.getSystemConfigClient().set(settingsPath, settingsValue)
  }

  async renewTokenFromVerifyHub(): Promise<void> {
    if (!this.profile.supportsManagedSessionRenewal()) {
      return
    }

    const sessionToken = this.sessionToken
    if (!sessionToken) {
      return
    }

    const claims = parseSessionTokenClaims(sessionToken)
    if (!claims || !this.needsRenew(claims)) {
      return
    }

    if (this.profile.shouldSkipVerifyHubRenewal(this)) {
      return
    }

    const verifyHubClient = this.getVerifyHubClient()
    const tokenPair = claims.iss === 'verify-hub'
      ? this.refreshToken
        ? await verifyHubClient.refreshToken({ refresh_token: this.refreshToken })
        : await verifyHubClient.loginByJwt({
          jwt: await this.profile.getVerifyHubLoginJwt(this, sessionToken),
        })
      : await verifyHubClient.loginByJwt({ jwt: sessionToken })

    this.sessionToken = trimToNull(tokenPair.session_token)
    this.refreshToken = trimToNull(tokenPair.refresh_token)
    this.validateSessionToken()
  }

  async ensureSessionTokenReady(): Promise<string | null> {
    if (this.config.runtimeType === RuntimeType.Browser) {
      return this.ensureBrowserSessionToken()
    }

    if (this.profile.supportsManagedSessionRenewal()) {
      await this.renewTokenFromVerifyHub()
    }
    return this.sessionToken
  }

  ensureAppServiceSessionToken() {
    if (!this.sessionToken) {
      this.sessionToken = this.loadAppServiceSessionTokenFromEnv()
    }
  }

  async ensureAppClientSessionToken(): Promise<void> {
    if (!this.sessionToken) {
      this.sessionToken = await this.createAppClientSessionToken()
    }
  }

  resolveNodeIdentityFromEnv() {
    if (!hasNodeRuntime()) {
      return
    }

    if (this.config.runtimeType !== RuntimeType.AppService) {
      return
    }

    const env = getProcessEnv()
    const appInstanceConfig = trimToNull(env.app_instance_config)
    if (!appInstanceConfig) {
      return
    }

    const identity = parseAppIdentityFromInstanceConfig(appInstanceConfig)
    if (!identity) {
      return
    }

    if (!this.config.appId) {
      this.config.appId = identity.appId
    }
    if (!trimToNull(this.config.ownerUserId)) {
      this.config.ownerUserId = identity.ownerUserId
    }
  }

  async resolveZoneHostFromLocalConfig(): Promise<void> {
    if (!hasNodeRuntime()) {
      return
    }

    if (trimToNull(this.config.zoneHost)) {
      return
    }

    const roots = await this.getPrivateKeySearchRoots()
    const zoneHost = await this.tryResolveZoneHostFromSearchRoots(roots)
    if (zoneHost) {
      this.config.zoneHost = zoneHost
    }
  }

  private validateSessionToken() {
    if (!this.sessionToken) {
      return
    }

    const claims = parseSessionTokenClaims(this.sessionToken)
    const tokenAppId = typeof claims?.appid === 'string'
      ? claims.appid
      : typeof claims?.aud === 'string'
        ? claims.aud
        : null

    if (tokenAppId && tokenAppId !== this.config.appId) {
      throw new Error(`session token appid mismatch: ${tokenAppId} != ${this.config.appId}`)
    }
  }

  private async ensureBrowserSessionToken(): Promise<string | null> {
    const claims = parseSessionTokenClaims(this.sessionToken)
    if (this.sessionToken && claims && !this.needsRenew(claims)) {
      return this.sessionToken
    }

    return this.refreshBrowserSessionToken()
  }

  private normalizeBrowserUserInfo(raw: unknown): BrowserUserInfo | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return null
    }

    const parsed = raw as {
      show_name?: unknown
      user_name?: unknown
      user_id?: unknown
      user_type?: unknown
    }
    const userId = typeof parsed.user_id === 'string' ? parsed.user_id.trim() : ''
    const userType = typeof parsed.user_type === 'string' ? parsed.user_type.trim() : ''
    const userName = typeof parsed.user_name === 'string'
      ? parsed.user_name.trim()
      : typeof parsed.show_name === 'string'
        ? parsed.show_name.trim()
        : ''

    if (!userId || !userType) {
      return null
    }

    return {
      user_name: userName || userId,
      user_id: userId,
      user_type: userType,
    }
  }

  async refreshBrowserSession(): Promise<BrowserUserInfo | null> {
    const sessionToken = await this.refreshBrowserSessionToken()
    if (!sessionToken) {
      return null
    }

    return hasBrowserStorage()
      ? getBrowserUserInfo()
      : null
  }

  private async refreshBrowserSessionToken(): Promise<string | null> {
    if (!hasFetchRuntime()) {
      return this.sessionToken
    }

    const cachedUserInfo = hasBrowserStorage()
      ? getBrowserUserInfo()
      : null

    try {
      const response = await fetch('/sso_refresh', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
      })

      if (!response.ok) {
        this.sessionToken = null
        return null
      }

      const payload = await response.json() as BrowserSSORefreshResponse
      const sessionToken = trimToNull(
        typeof payload.access_token === 'string'
          ? payload.access_token
          : typeof payload.session_token === 'string'
            ? payload.session_token
            : null,
      )
      const userInfo = this.normalizeBrowserUserInfo(payload.user_info) ?? cachedUserInfo
      if (!sessionToken || !userInfo) {
        this.sessionToken = null
        return null
      }

      this.sessionToken = sessionToken
      this.refreshToken = null
      saveBrowserUserInfo(userInfo)
      this.validateSessionToken()
      return this.sessionToken
    } catch (error) {
      console.warn('BuckyOS browser sso_refresh failed:', error)
      this.sessionToken = null
      return null
    }
  }

  private needsRenew(claims: SessionTokenClaims): boolean {
    if (claims.iss && claims.iss !== 'verify-hub') {
      return true
    }

    if (typeof claims.exp !== 'number') {
      return false
    }

    const now = Math.floor(Date.now() / 1000)
    return now >= claims.exp - 30
  }

  startAutoRenewIfNeeded() {
    if (!this.profile.supportsManagedSessionRenewal() || this.config.autoRenew === false) {
      return
    }

    if (this.renewTimer) {
      return
    }

    const interval = this.config.renewIntervalMs ?? DEFAULT_RENEW_INTERVAL_MS
    const tick = async () => {
      try {
        await this.renewTokenFromVerifyHub()
      } catch (error) {
        console.warn('BuckyOS token renew failed:', error)
      }
    }

    void tick()
    this.renewTimer = setInterval(() => {
      void tick()
    }, interval)
  }

  private loadAppServiceSessionTokenFromEnv(): string {
    const env = getProcessEnv()
    const ownerUserId = this.getOwnerUserId()
    const sessionTokenKeys: string[] = []

    if (ownerUserId) {
      sessionTokenKeys.push(getSessionTokenEnvKey(getFullAppId(this.config.appId, ownerUserId), true))
    }
    sessionTokenKeys.push(getSessionTokenEnvKey(this.config.appId, true))

    const uniqueKeys = Array.from(new Set(sessionTokenKeys))
    for (const key of uniqueKeys) {
      const token = trimToNull(env[key])
      if (token) {
        return token
      }
    }

    throw new Error(`failed to load app-service session token, tried keys: ${uniqueKeys.join(', ')}`)
  }

  async createAppClientSessionToken(): Promise<string> {
    if (!hasNodeRuntime()) {
      throw new Error('AppClient mode requires Node.js')
    }

    const material = await this.loadLocalSigningMaterial()
    const now = Math.floor(Date.now() / 1000)
    const claims: SessionTokenClaims = {
      token_type: 'Normal',
      appid: this.config.appId,
      jti: String(now),
      session: now,
      sub: material.subject,
      userid: material.subject,
      iss: material.issuer,
      exp: now + DEFAULT_SESSION_TOKEN_TTL_SECONDS,
      extra: {},
    }

    return this.signJwtWithEd25519({
      alg: 'EdDSA',
      kid: material.issuer,
    }, claims, material.keyPem)
  }

  private async loadLocalSigningMaterial(): Promise<LocalSigningMaterial> {
    const fs = await importNodeModule('node:fs/promises')
    const path = await importNodeModule('node:path')
    const configuredUserId = this.getOwnerUserId()
    if (!configuredUserId) {
      const etcDir = await this.getBuckyOSEtcDir()
      const deviceName = await this.readDeviceNameFromNodeIdentityPath(path.join(etcDir, 'node_identity.json'))
      if (!deviceName) {
        throw new Error(`failed to resolve userid from ${path.join(etcDir, 'node_identity.json')} device_mini_doc_jwt`)
      }

      const keyPem = await this.readPemFile(path.join(etcDir, 'node_private_key.pem'))
      if (!keyPem) {
        throw new Error(`failed to load node_private_key.pem from ${etcDir}`)
      }

      this.config.userid = deviceName
      this.config.ownerUserId = deviceName
      return {
        keyPem,
        issuer: deviceName,
        subject: deviceName,
        sourcePath: path.join(etcDir, 'node_private_key.pem'),
      }
    }

    const roots = await this.getPrivateKeySearchRoots()
    const deviceMaterial = await this.tryLoadDeviceSigningMaterial(configuredUserId, roots)
    if (deviceMaterial) {
      return deviceMaterial
    }

    const userMaterial = await this.tryLoadUserSigningMaterial(configuredUserId, roots)
    if (userMaterial) {
      return userMaterial
    }

    throw new Error(`failed to find AppClient private key for userid=${configuredUserId} in search roots: ${roots.join(', ')}`)
  }

  private async getPrivateKeySearchRoots(): Promise<string[]> {
    const env = getProcessEnv()
    const path = await importNodeModule('node:path')
    const os = await importNodeModule('node:os')
    const roots: string[] = []

    for (const item of this.config.privateKeySearchPaths ?? []) {
      const trimmed = trimToNull(item)
      if (trimmed) {
        roots.push(trimmed)
      }
    }

    const explicitClientDir = trimToNull(env.BUCKYOS_APP_CLIENT_DIR)
    if (explicitClientDir) {
      roots.push(explicitClientDir)
    }

    const homeDir = trimToNull(env.HOME) ?? trimToNull(env.USERPROFILE) ?? trimToNull(os.homedir?.())
    if (homeDir) {
      roots.push(path.join(homeDir, '.buckyos'))
      roots.push(path.join(homeDir, '.buckycli'))
    }

    const rootDir = trimToNull(this.config.rootDir) ?? trimToNull(env.BUCKYOS_ROOT) ?? '/opt/buckyos'
    roots.push(rootDir)
    roots.push(path.join(rootDir, 'etc'))

    return Array.from(new Set(roots))
  }

  private async getBuckyOSRootDir(): Promise<string> {
    const env = getProcessEnv()
    return trimToNull(this.config.rootDir) ?? trimToNull(env.BUCKYOS_ROOT) ?? '/opt/buckyos'
  }

  private async getBuckyOSEtcDir(): Promise<string> {
    const path = await importNodeModule('node:path')
    return path.join(await this.getBuckyOSRootDir(), 'etc')
  }

  private async readPemFile(filePath: string): Promise<string | null> {
    const fs = await importNodeModule('node:fs/promises')
    try {
      const keyPem = (await fs.readFile(filePath, 'utf8')).trim()
      return keyPem || null
    } catch {
      return null
    }
  }

  private async readNodeIdentityMetadata(nodeIdentityPath: string): Promise<NodeIdentityMetadata | null> {
    const fs = await importNodeModule('node:fs/promises')
    try {
      const raw = await fs.readFile(nodeIdentityPath, 'utf8')
      const parsed = JSON.parse(raw) as {
        zone_did?: unknown
        zone_name?: unknown
        device_mini_doc_jwt?: unknown
        device_doc_jwt?: unknown
      }

      const deviceName = this.extractDeviceNameFromIdentityPayload(parsed)
      return {
        deviceName,
        zoneDid: typeof parsed.zone_did === 'string' ? parsed.zone_did.trim() || null : null,
        zoneName: typeof parsed.zone_name === 'string' ? parsed.zone_name.trim() || null : null,
      }
    } catch {
      return null
    }
  }

  private extractDeviceNameFromIdentityPayload(payload: {
    device_mini_doc_jwt?: unknown
    device_doc_jwt?: unknown
  }): string | null {
    const miniDocJwt = typeof payload.device_mini_doc_jwt === 'string' ? payload.device_mini_doc_jwt : null
    const miniDocClaims = parseDeviceMiniConfig(parseSessionTokenClaims(miniDocJwt))
    if (miniDocClaims?.n.trim().length) {
      return miniDocClaims.n.trim()
    }

    const deviceDocJwt = typeof payload.device_doc_jwt === 'string' ? payload.device_doc_jwt : null
    const deviceDocClaims = parseSessionTokenClaims(deviceDocJwt)
    for (const claimKey of ['name', 'sub'] as const) {
      const claimValue = deviceDocClaims?.[claimKey]
      const candidate = typeof claimValue === 'string' ? claimValue.trim() : ''
      if (candidate) {
        return candidate
      }
    }

    return null
  }

  private async readDeviceNameFromNodeIdentityPath(nodeIdentityPath: string): Promise<string | null> {
    const metadata = await this.readNodeIdentityMetadata(nodeIdentityPath)
    return metadata?.deviceName ?? null
  }

  private async tryLoadDeviceSigningMaterial(userId: string, roots: string[]): Promise<LocalSigningMaterial | null> {
    const path = await importNodeModule('node:path')

    const candidateDirs = [
      await this.getBuckyOSEtcDir(),
      ...roots.filter((root) => !root.endsWith('.pem')),
    ]

    for (const dir of Array.from(new Set(candidateDirs))) {
      const deviceName = await this.readDeviceNameFromNodeIdentityPath(path.join(dir, 'node_identity.json'))
      if (!deviceName || deviceName !== userId) {
        continue
      }

      const keyPath = path.join(dir, 'node_private_key.pem')
      const keyPem = await this.readPemFile(keyPath)
      if (!keyPem) {
        continue
      }

      return {
        keyPem,
        issuer: deviceName,
        subject: deviceName,
        sourcePath: keyPath,
      }
    }

    return null
  }

  private async tryLoadUserSigningMaterial(userId: string, roots: string[]): Promise<LocalSigningMaterial | null> {
    const fs = await importNodeModule('node:fs/promises')
    const path = await importNodeModule('node:path')

    for (const root of roots) {
      const userKeyPath = root.endsWith('.pem') ? root : path.join(root, 'user_private_key.pem')
      const userConfigDir = root.endsWith('.pem') ? path.dirname(root) : root
      const userConfigPath = path.join(userConfigDir, 'user_config.json')

      try {
        const raw = await fs.readFile(userConfigPath, 'utf8')
        const ownerConfig = parseOwnerConfigDocument(JSON.parse(raw))
        const configUserId = ownerConfig?.name?.trim()
        if (!configUserId || configUserId !== userId) {
          continue
        }

        const keyPem = await this.readPemFile(userKeyPath)
        if (!keyPem) {
          continue
        }

        return {
          keyPem,
          issuer: userId,
          subject: userId,
          sourcePath: userKeyPath,
        }
      } catch {
        // Ignore malformed or missing user configs.
      }
    }

    return null
  }

  private async tryResolveDeviceNameFromSearchRoots(roots: string[]): Promise<string | null> {
    const path = await importNodeModule('node:path')
    const env = getProcessEnv()

    const fromEnv = trimToNull(env.BUCKYOS_THIS_DEVICE_NAME)
    if (fromEnv) {
      return fromEnv
    }

    for (const key of ['BUCKYOS_THIS_DEVICE', 'BUCKYOS_THIS_DEVICE_INFO']) {
      const raw = trimToNull(env[key])
      if (!raw) {
        continue
      }
      try {
        const parsed = JSON.parse(raw) as { name?: unknown }
        if (typeof parsed.name === 'string' && parsed.name.trim().length > 0) {
          return parsed.name.trim()
        }
      } catch {
        // Ignore malformed env payloads.
      }
    }

    for (const root of roots) {
      const nodeIdentityPath = path.join(root, 'node_identity.json')
      const deviceName = await this.readDeviceNameFromNodeIdentityPath(nodeIdentityPath)
      if (deviceName) {
        return deviceName
      }
    }

    return null
  }

  private async tryResolveZoneHostFromSearchRoots(roots: string[]): Promise<string | null> {
    const fs = await importNodeModule('node:fs/promises')
    const path = await importNodeModule('node:path')
    const env = getProcessEnv()

    const fromEnv = trimToNull(env.BUCKYOS_ZONE_HOST)
    if (fromEnv) {
      return fromEnv
    }

    for (const root of roots) {
      const nodeIdentityPath = path.join(root, 'node_identity.json')
      const metadata = await this.readNodeIdentityMetadata(nodeIdentityPath)
      if (!metadata) {
        continue
      }

      if (metadata.zoneName) {
        return metadata.zoneName
      }

      if (!metadata.zoneDid) {
        continue
      }

      return resolveZoneHostFromDid(metadata.zoneDid)
    }

    for (const root of roots) {
      const userConfigPath = path.join(root, 'user_config.json')
      try {
        const raw = await fs.readFile(userConfigPath, 'utf8')
        const ownerConfig = parseOwnerConfigDocument(JSON.parse(raw))
        const zoneHost = resolveZoneHostFromDid(ownerConfig?.default_zone_did)
        if (!zoneHost) {
          continue
        }
        return zoneHost
      } catch {
        // Ignore missing user config files.
      }
    }

    return null
  }

  private getMySettingsPath(): string {
    return this.profile.getMySettingsPath(this)
  }

  private getConfiguredSystemConfigServiceUrl(): string | null {
    return trimToNull(this.config.systemConfigServiceUrl)
  }

  resolveAppServiceGatewayHost(): string {
    return trimToNull(getProcessEnv()[BUCKYOS_HOST_GATEWAY_ENV]) ?? DEFAULT_DOCKER_HOST_GATEWAY
  }

  private async signJwtWithEd25519(header: Record<string, unknown>, payload: Record<string, unknown>, privateKeyPem: string): Promise<string> {
    const crypto = await importNodeModule('node:crypto')
    const BufferCtor = ensureBuffer()

    const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`
    const signature = crypto.sign(
      null,
      BufferCtor.from(signingInput, 'utf8'),
      crypto.createPrivateKey({
        key: privateKeyPem,
        format: 'pem',
      }),
    ) as Uint8Array

    return `${signingInput}.${base64UrlEncode(signature)}`
  }
}
