import { kRPCClient } from './krpc_client'
import { VerifyHubClient } from './verify-hub-client'
import { TaskManagerClient } from './task_mgr_client'
import { OpenDanClient } from './opendan_client'
import { SystemConfigClient } from './system_config_client'

declare const require: undefined | ((name: string) => any)

const DEFAULT_NODE_GATEWAY_PORT = 3180
const DEFAULT_SESSION_TOKEN_TTL_SECONDS = 15 * 60
const DEFAULT_RENEW_INTERVAL_MS = 5_000

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

function getProcessEnv(): Record<string, string | undefined> {
  const runtimeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  return runtimeProcess?.env ?? {}
}

function hasNodeRuntime(): boolean {
  const runtimeProcess = (globalThis as { process?: { versions?: { node?: string } } }).process
  return Boolean(runtimeProcess?.versions?.node)
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

export class BuckyOSRuntime {
  private config: BuckyOSConfig
  private sessionToken: string | null
  private refreshToken: string | null
  private renewTimer: ReturnType<typeof setInterval> | null
  private initialized: boolean

  constructor(config: BuckyOSConfig) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      appId: config.appId,
      zoneHost: config.zoneHost ?? '',
      defaultProtocol: config.defaultProtocol ?? DEFAULT_CONFIG.defaultProtocol,
    }
    this.sessionToken = trimToNull(config.sessionToken)
    this.refreshToken = trimToNull(config.refreshToken)
    this.renewTimer = null
    this.initialized = false
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }

    this.resolveNodeIdentityFromEnv()
    await this.resolveZoneHostFromLocalConfig()

    if (!this.sessionToken) {
      if (this.config.runtimeType === RuntimeType.AppClient) {
        this.sessionToken = await this.createAppClientSessionToken()
      } else if (this.config.runtimeType === RuntimeType.AppService) {
        this.sessionToken = this.loadAppServiceSessionTokenFromEnv()
      }
    }

    this.validateSessionToken()
    this.startAutoRenewIfNeeded()
    this.initialized = true
  }

  setConfig(config: BuckyOSConfig) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      appId: config.appId,
    }
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

  getZoneServiceURL(serviceName: string): string {
    const servicePath = normalizeServicePath(serviceName)

    if (this.config.runtimeType === RuntimeType.AppService) {
      const port = this.config.nodeGatewayPort ?? DEFAULT_NODE_GATEWAY_PORT
      return `http://127.0.0.1:${port}/kapi/${servicePath}`
    }

    if (this.config.runtimeType === RuntimeType.AppClient) {
      if (!this.config.zoneHost) {
        throw new Error('zoneHost is required in AppClient mode')
      }
      const appHostPrefix = getAppHostPrefix(this.config.appId, this.getOwnerUserId())
      return `${this.config.defaultProtocol}${appHostPrefix}.${this.config.zoneHost}/kapi/${servicePath}`
    }

    return `/kapi/${servicePath}/`
  }

  getSystemConfigServiceURL(): string {
    const configuredUrl = trimToNull(this.config.systemConfigServiceUrl)
    if (configuredUrl) {
      return configuredUrl
    }

    if (this.config.runtimeType === RuntimeType.AppService) {
      const port = this.config.nodeGatewayPort ?? DEFAULT_NODE_GATEWAY_PORT
      return `http://127.0.0.1:${port}/kapi/system_config`
    }

    if (this.config.runtimeType === RuntimeType.AppClient) {
      if (!this.config.zoneHost) {
        throw new Error('zoneHost is required in AppClient mode')
      }
      return `${this.config.defaultProtocol}${this.config.zoneHost}/kapi/system_config`
    }

    return '/kapi/system_config'
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
    return new kRPCClient(this.getZoneServiceURL(serviceName), this.sessionToken)
  }

  getSystemConfigClient(): SystemConfigClient {
    return new SystemConfigClient(this.getSystemConfigServiceURL(), this.sessionToken)
  }

  getVerifyHubClient(): VerifyHubClient {
    const configuredUrl = trimToNull(this.config.verifyHubServiceUrl)
    const rpcClient = new kRPCClient(configuredUrl ?? this.getZoneServiceURL('verify-hub'), this.sessionToken)
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

  async renewTokenFromVerifyHub(): Promise<void> {
    if (this.config.runtimeType !== RuntimeType.AppService) {
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

    const verifyHubClient = this.getVerifyHubClient()
    const tokenPair = claims.iss === 'verify-hub' && this.refreshToken
      ? await verifyHubClient.refreshToken({ refresh_token: this.refreshToken })
      : await verifyHubClient.loginByJwt({ jwt: sessionToken })

    this.sessionToken = trimToNull(tokenPair.session_token)
    this.refreshToken = trimToNull(tokenPair.refresh_token)
    this.validateSessionToken()
  }

  private resolveNodeIdentityFromEnv() {
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

  private async resolveZoneHostFromLocalConfig(): Promise<void> {
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

  private startAutoRenewIfNeeded() {
    if (this.config.runtimeType !== RuntimeType.AppService || this.config.autoRenew === false) {
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

  private async createAppClientSessionToken(): Promise<string> {
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
    const env = getProcessEnv()

    const roots = await this.getPrivateKeySearchRoots()
    for (const root of roots) {
      const userKeyPath = root.endsWith('.pem') ? root : path.join(root, 'user_private_key.pem')
      try {
        const keyPem = (await fs.readFile(userKeyPath, 'utf8')).trim()
        if (keyPem) {
          return {
            keyPem,
            issuer: 'root',
            subject: 'root',
            sourcePath: userKeyPath,
          }
        }
      } catch {
        // Skip missing key files.
      }
    }

    const deviceName = trimToNull(env.BUCKYOS_DEVICE_NAME) ?? await this.tryResolveDeviceNameFromSearchRoots(roots)
    if (!deviceName) {
      throw new Error('failed to find user_private_key.pem and no device name is available for node_private_key.pem fallback')
    }

    for (const root of roots) {
      const deviceKeyPath = root.endsWith('.pem') ? root : path.join(root, 'node_private_key.pem')
      try {
        const keyPem = (await fs.readFile(deviceKeyPath, 'utf8')).trim()
        if (keyPem) {
          return {
            keyPem,
            issuer: deviceName,
            subject: deviceName,
            sourcePath: deviceKeyPath,
          }
        }
      } catch {
        // Skip missing key files.
      }
    }

    throw new Error(`failed to find private key in AppClient search roots: ${roots.join(', ')}`)
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

  private async tryResolveDeviceNameFromSearchRoots(roots: string[]): Promise<string | null> {
    const fs = await importNodeModule('node:fs/promises')
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
      try {
        const raw = await fs.readFile(nodeIdentityPath, 'utf8')
        const parsed = JSON.parse(raw) as { device_doc_jwt?: unknown }
        if (typeof parsed.device_doc_jwt !== 'string') {
          continue
        }
        const claims = parseSessionTokenClaims(parsed.device_doc_jwt)
        if (typeof claims?.name === 'string' && claims.name.trim().length > 0) {
          return claims.name.trim()
        }
        if (typeof claims?.sub === 'string' && claims.sub.trim().length > 0) {
          return claims.sub.trim()
        }
      } catch {
        // Ignore missing node identity files.
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
      try {
        const raw = await fs.readFile(nodeIdentityPath, 'utf8')
        const parsed = JSON.parse(raw) as { zone_did?: unknown; zone_name?: unknown }

        if (typeof parsed.zone_name === 'string' && parsed.zone_name.trim().length > 0) {
          return parsed.zone_name.trim()
        }

        if (typeof parsed.zone_did !== 'string') {
          continue
        }

        if (parsed.zone_did.startsWith('did:web:')) {
          return parsed.zone_did.slice('did:web:'.length).replace(/:/g, '.')
        }

        if (parsed.zone_did.startsWith('did:bns:')) {
          return parsed.zone_did.slice('did:bns:'.length)
        }
      } catch {
        // Ignore missing node identity files.
      }
    }

    return null
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
