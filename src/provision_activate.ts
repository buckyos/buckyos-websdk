// provision_activate: production offline activation API for an installed,
// not yet activated BuckyOS root (single OOD, did:web, no SN/BNS).
//
// This is the library form of buckyos/src/active.ts. It is consumed by the
// `buckyos provision` Tool commands and can be reused by installers; it never
// imports sibling-repository scripts or dev/test provisioning defaults.
//
//   inspectActivationRoot    <-> provision status   (read-only)
//   checkOfflineActivation   <-> provision check    (read-only precheck, no password)
//   activateOfflineZone      <-> provision activate (privileged, writes the root)
//
// Commit protocol (see doc/modules/provision.md):
//   1. precheck (parameters, target state, backup target)
//   2. build every document/JWT/key in memory with random keys and the current time
//   3. create <root>/etc/provision_activation.lock (O_EXCL) and re-check the target
//   4. save the owner private-key backup (O_EXCL, 0600)
//   5. commit files one by one (temp + rename, never overwrite), recording each
//      committed file in the lock; etc/node_identity.json is written LAST because
//      node_daemon treats its presence as "activated"
//   6. remove the lock
// A failure after step 4 leaves the lock and the committed files in place and is
// reported as ACTIVATION_COMMIT_FAILED with the backup status, the committed file
// list and manual recovery steps; nothing is deleted or regenerated automatically.
//
// Runtime: Node >= 22.13 or Deno >= 2.2. Never import from a browser bundle.

import { hashPassword } from './account'
import { IdentityRoots } from './cert'
import {
  buildDeviceDid,
  deviceIdentityPathsForRoots,
  newDeviceDocumentByJwkWithDid,
  newLocalNodeIdentityConfig,
} from './device_identity'
import {
  buckyosGetUnixTimestamp,
  createJwkByX,
  decodeJwtClaimWithoutVerify,
  DEFAULT_EXPIRE_TIME,
  deviceDocumentToOrderedJson,
  deviceMiniDocumentToJwt,
  DID,
  encodeDeviceDocument,
  encodeZoneBootDocument,
  encodeZoneDocument,
  getPublicKeyXFromPrivatePem,
  getXFromJwk,
  newDeviceMiniDocumentByDeviceDocument,
  newOwnerDocument,
  newZoneBootDocument,
  newZoneDocument,
  oodDescriptionToString,
  ownerDocumentSetDefaultZoneDid,
  ownerDocumentToOrderedJson,
  parseOODDescription,
  verifyJwtEdDSA,
} from './namelib'
import { NODE_IDENTITY_SCHEMA_V2 } from './types'
import type {
  BuckyOSDeviceDocument,
  BuckyOSLocalNodeIdentityConfig,
  BuckyOSOwnerDocument,
  BuckyOSZoneDocument,
  Ed25519Jwk,
} from './types'

// ============================================================================
// constants
// ============================================================================

export const ACTIVATION_DEVICE_NAME = 'ood1'
export const ACTIVATION_NET_ID = 'wan'
export const ACTIVATION_DEFAULT_RTCP_PORT = 2980
export const ACTIVATION_DOCUMENT_VALIDITY_SECONDS = DEFAULT_EXPIRE_TIME
export const ACTIVATION_MIN_PASSWORD_LENGTH = 8
export const ACTIVATION_LOCK_FILE_NAME = 'provision_activation.lock'
export const ZONE_DNS_RECORDS_FILE_NAME = 'zone_dns_records.json'
export const ZONE_DOCUMENT_JWT_FILE_NAME = 'zone_document.jwt'

const UNACTIVATED_GATEWAY_DEVICE_DID = 'did:bns:unactivated.local'
const MAX_INLINE_DOCUMENT_BYTES = 4096
const ACTIVATION_LOCK_SCHEMA_VERSION = 1

// ============================================================================
// public types
// ============================================================================

export type ActivationState = 'not_installed' | 'unactivated' | 'partial' | 'configured' | 'invalid'

export type ActivationFileRole =
  | 'device_private_key'
  | 'device_document'
  | 'device_document_jwt'
  | 'device_mini_document_jwt'
  | 'zone_boot_override'
  | 'zone_document_jwt'
  | 'dns_records'
  | 'start_config'
  | 'gateway_params'
  | 'node_identity'

export type ActivationLockStage = 'locked' | 'backup_saved' | 'committing' | 'committed'

export interface ActivationProblem {
  code: string
  message: string
}

export interface ProvisionKeyPair {
  privateKeyPem: string
  publicKeyX: string
}

export interface ActivationDnsRecord {
  type: 'A' | 'AAAA'
  name: string
  value: string
}

export interface ActivationFileEntry {
  // path relative to the target root, always '/'-separated
  path: string
  role: ActivationFileRole
  required: boolean
  secret: boolean
}

export interface ObservedActivationFile extends ActivationFileEntry {
  present: boolean
}

export interface CommittedActivationFile extends ActivationFileEntry {
  // sha256 hex of the committed content; null for secret files
  sha256: string | null
}

export interface ActivationLockInfo {
  path: string
  schemaVersion: number | null
  traceId: string | null
  startedAt: number | null
  domain: string | null
  stage: ActivationLockStage | null
  committedFiles: string[]
  ownerKeyBackupPath: string | null
  corrupt: boolean
}

export interface ActivationStatus {
  rootDir: string
  state: ActivationState
  // configured only means the first-boot material is complete and internally
  // consistent; the Zone still has to be started
  startupRequired: boolean
  observedAt: number
  zoneDid: string | null
  ownerDid: string | null
  deviceDid: string | null
  deviceName: string | null
  accessHostname: string | null
  files: ObservedActivationFile[]
  problems: ActivationProblem[]
  warnings: string[]
  lock: ActivationLockInfo | null
}

export interface OfflineActivationCheckOptions {
  rootDir: string
  domain: string
  ownerName: string
  ownerKeyBackupPath: string
  rtcpPort?: number
  guestAccess?: boolean
  publicIp?: string
}

export interface OfflineActivationOptions extends OfflineActivationCheckOptions {
  adminPassword: string
  // Installer-provided keys. When omitted, fresh random Ed25519 keys are generated.
  ownerKeyPair?: ProvisionKeyPair
  deviceKeyPair?: ProvisionKeyPair
  // Recorded in the lock file for audit correlation only.
  traceId?: string
}

export interface OwnerKeyBackupTarget {
  path: string
  directoryExists: boolean
  exists: boolean
}

export interface OfflineActivationPrecheck {
  ready: boolean
  rootDir: string
  state: ActivationState
  domain: string
  ownerName: string
  ownerDid: string
  zoneDid: string
  deviceDid: string
  deviceName: string
  accessHostname: string
  rtcpPort: number
  guestAccess: boolean
  publicIp: string | null
  dnsRecords: ActivationDnsRecord[]
  ownerKeyBackup: OwnerKeyBackupTarget
  plannedFiles: ActivationFileEntry[]
  problems: ActivationProblem[]
  status: ActivationStatus
}

export interface OfflineActivationResult {
  rootDir: string
  state: 'configured'
  startupRequired: true
  domain: string
  ownerName: string
  ownerDid: string
  zoneDid: string
  deviceDid: string
  deviceName: string
  accessHostname: string
  rtcpPort: number
  guestAccess: boolean
  publicIp: string | null
  documentIat: number
  documentExp: number
  ownerKeyBackup: { path: string; saved: true }
  dnsRecords: ActivationDnsRecord[]
  committedFiles: CommittedActivationFile[]
  warnings: string[]
}

export interface ActivationErrorDetails {
  [key: string]: unknown
}

export class ActivationError extends Error {
  readonly code: string
  readonly details: ActivationErrorDetails

  constructor(code: string, message: string, details: ActivationErrorDetails = {}) {
    super(message)
    this.name = 'ActivationError'
    this.code = code
    this.details = details
  }
}

// ============================================================================
// runtime helpers
// ============================================================================

function requireNode(moduleName: string): any {
  const proc = (globalThis as { process?: { getBuiltinModule?: (name: string) => any } }).process
  if (typeof proc?.getBuiltinModule === 'function') {
    const builtin = proc.getBuiltinModule(moduleName)
    if (builtin) {
      return builtin
    }
  }
  if (typeof require === 'function') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(moduleName)
  }
  throw new ActivationError(
    'RUNTIME_UNSUPPORTED',
    `buckyos provision cannot load builtin module ${moduleName} in this runtime (Node >= 22.13 or Deno >= 2.2 is required)`,
  )
}

function isWindows(): boolean {
  return (globalThis as { process?: { platform?: string } }).process?.platform === 'win32'
}

function toPosixRelative(rootDir: string, filePath: string): string {
  const path = requireNode('node:path')
  return path.relative(rootDir, filePath).split(path.sep).join('/')
}

function sha256Hex(content: string): string {
  const crypto = requireNode('node:crypto')
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex')
}

function randomSuffix(): string {
  const crypto = requireNode('node:crypto')
  return crypto.randomBytes(6).toString('hex')
}

function lstatOrNull(filePath: string): any | null {
  const fs = requireNode('node:fs')
  try {
    return fs.lstatSync(filePath)
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return null
    throw error
  }
}

function statOrNull(filePath: string): any | null {
  const fs = requireNode('node:fs')
  try {
    return fs.statSync(filePath)
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT' || (error as { code?: string }).code === 'ENOTDIR') {
      return null
    }
    throw error
  }
}

function isDirectory(filePath: string): boolean {
  return statOrNull(filePath)?.isDirectory() === true
}

function isFile(filePath: string): boolean {
  return statOrNull(filePath)?.isFile() === true
}

function readJsonObjectOrThrow(filePath: string): Record<string, unknown> {
  const fs = requireNode('node:fs')
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${filePath} is not a JSON object`)
  }
  return value as Record<string, unknown>
}

function jsonPretty(value: unknown): string {
  // serde_json::to_string_pretty equivalent: 2-space indent, no trailing newline.
  return JSON.stringify(value, null, 2)
}

// Write a file atomically next to its destination; the destination must not
// exist. Used for every committed file except the O_EXCL owner backup.
function commitFile(filePath: string, content: string, mode: number, dirMode: number): void {
  const fs = requireNode('node:fs')
  const path = requireNode('node:path')
  const directory = path.dirname(filePath)
  fs.mkdirSync(directory, { recursive: true, mode: dirMode })
  if (!isWindows()) {
    fs.chmodSync(directory, dirMode)
  }
  if (lstatOrNull(filePath)) {
    throw new Error(`refusing to overwrite existing file: ${filePath}`)
  }
  const temporary = path.join(directory, `.${path.basename(filePath)}.provision-${randomSuffix()}`)
  try {
    fs.writeFileSync(temporary, content, { mode, flag: 'wx' })
    if (!isWindows()) {
      fs.chmodSync(temporary, mode)
    }
    fs.renameSync(temporary, filePath)
  } finally {
    if (lstatOrNull(temporary)) {
      fs.rmSync(temporary, { force: true })
    }
  }
}

// ============================================================================
// parameter validation (mirror active.ts)
// ============================================================================

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, '')
}

export function validateZoneDomain(value: string): string {
  const domain = normalizeDomain(String(value ?? ''))
  if (
    domain.length === 0 ||
    domain.length > 253 ||
    !domain.includes('.') ||
    domain.split('.').some(label =>
      label.length === 0 ||
      label.length > 63 ||
      label.startsWith('-') ||
      label.endsWith('-') ||
      !/^[a-z0-9-]+$/.test(label)
    )
  ) {
    throw new ActivationError('INVALID_ARGUMENT', `invalid did:web domain: ${value}`, { field: 'domain' })
  }
  return domain
}

export function validateOwnerName(value: string): string {
  const name = String(value ?? '').trim().toLowerCase()
  if (name.length === 0 || name.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(name)) {
    throw new ActivationError(
      'INVALID_ARGUMENT',
      'owner name must be a lowercase DNS label (letters, digits, and hyphens)',
      { field: 'owner_name' },
    )
  }
  return name
}

export function validateRtcpPort(value: number | undefined): number {
  const port = value ?? ACTIVATION_DEFAULT_RTCP_PORT
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ActivationError('INVALID_ARGUMENT', `invalid RTCP port: ${String(value)}`, { field: 'rtcp_port' })
  }
  return port
}

export function validatePublicIp(value: string | undefined): string | undefined {
  const publicIp = value?.trim() || undefined
  if (publicIp === undefined) return undefined
  const net = requireNode('node:net')
  if (net.isIP(publicIp) === 0) {
    throw new ActivationError('INVALID_ARGUMENT', `invalid public IP address: ${publicIp}`, { field: 'public_ip' })
  }
  return publicIp
}

export function validateAdminPassword(value: string): string {
  if (typeof value !== 'string' || value.length < ACTIVATION_MIN_PASSWORD_LENGTH) {
    throw new ActivationError(
      'INVALID_ARGUMENT',
      `administrator password must contain at least ${ACTIVATION_MIN_PASSWORD_LENGTH} characters`,
      { field: 'admin_password' },
    )
  }
  return value
}

// First-boot password encoding consumed by scheduler: base64 SHA-256(password +
// ownerName + ".buckyos"), identical to the SDK hashPassword branch without nonce.
export function hashAdminPassword(ownerName: string, password: string): string {
  return hashPassword(ownerName, password, null)
}

export function buildActivationDnsRecords(domain: string, publicIp?: string): ActivationDnsRecord[] {
  const records: ActivationDnsRecord[] = []
  if (publicIp) {
    const net = requireNode('node:net')
    records.push({ type: net.isIP(publicIp) === 6 ? 'AAAA' : 'A', name: domain, value: publicIp })
  }
  return records
}

export function generateProvisionKeyPair(): ProvisionKeyPair {
  const crypto = requireNode('node:crypto')
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
  const jwk = publicKey.export({ format: 'jwk' }) as { x?: string }
  if (typeof jwk.x !== 'string' || jwk.x.length === 0) {
    throw new ActivationError('KEY_GENERATION_FAILED', 'generated Ed25519 public key has no x coordinate')
  }
  return {
    privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    publicKeyX: jwk.x,
  }
}

interface NormalizedActivationParams {
  rootDir: string
  domain: string
  ownerName: string
  ownerKeyBackupPath: string
  rtcpPort: number
  guestAccess: boolean
  publicIp: string | undefined
  ownerDid: DID
  zoneDid: DID
  deviceDid: DID
}

function normalizeActivationParams(options: OfflineActivationCheckOptions): NormalizedActivationParams {
  const path = requireNode('node:path')
  if (typeof options.rootDir !== 'string' || options.rootDir.trim().length === 0) {
    throw new ActivationError('INVALID_ARGUMENT', 'target root is required', { field: 'root' })
  }
  if (typeof options.ownerKeyBackupPath !== 'string' || options.ownerKeyBackupPath.trim().length === 0) {
    throw new ActivationError('INVALID_ARGUMENT', 'owner key backup path is required', { field: 'owner_key_backup' })
  }
  const domain = validateZoneDomain(options.domain)
  const zoneDid = new DID('web', domain)
  return {
    rootDir: path.resolve(options.rootDir),
    domain,
    ownerName: validateOwnerName(options.ownerName),
    ownerKeyBackupPath: path.resolve(options.ownerKeyBackupPath),
    rtcpPort: validateRtcpPort(options.rtcpPort),
    guestAccess: options.guestAccess ?? false,
    publicIp: validatePublicIp(options.publicIp),
    ownerDid: zoneDid,
    zoneDid,
    deviceDid: buildDeviceDid(ACTIVATION_DEVICE_NAME, zoneDid),
  }
}

// ============================================================================
// file layout
// ============================================================================

interface ActivationLayout {
  etcDir: string
  lockPath: string
  nodeIdentityPath: string
  startConfigPath: string
  zoneDocumentJwtPath: string
  gatewayParamsPath: string
  dnsRecordsPath: string
  zoneBootOverridePath: string
  didJsonPath: string
  deviceDocJwtPath: string
  deviceMiniDocJwtPath: string
  devicePrivateKeyPath: string
  publicDir: string
  securityDir: string
}

function identityRootsFor(rootDir: string): IdentityRoots {
  const path = requireNode('node:path')
  return new IdentityRoots(path.join(rootDir, 'local', 'identity'), path.join(rootDir, 'security'))
}

function layoutFor(rootDir: string, zoneDid: DID, deviceDid: DID): ActivationLayout {
  const path = requireNode('node:path')
  const etcDir = path.join(rootDir, 'etc')
  const paths = deviceIdentityPathsForRoots(identityRootsFor(rootDir), deviceDid)
  return {
    etcDir,
    lockPath: path.join(etcDir, ACTIVATION_LOCK_FILE_NAME),
    nodeIdentityPath: path.join(etcDir, 'node_identity.json'),
    startConfigPath: path.join(etcDir, 'start_config.json'),
    zoneDocumentJwtPath: path.join(etcDir, ZONE_DOCUMENT_JWT_FILE_NAME),
    gatewayParamsPath: path.join(etcDir, 'node_gateway_params.json'),
    dnsRecordsPath: path.join(etcDir, ZONE_DNS_RECORDS_FILE_NAME),
    zoneBootOverridePath: path.join(etcDir, `${zoneDid.toRawHostName()}.zone.json`),
    didJsonPath: paths.didJson,
    deviceDocJwtPath: paths.deviceDocJwt,
    deviceMiniDocJwtPath: paths.deviceMiniDocJwt,
    devicePrivateKeyPath: paths.authenticationPrivateKey,
    publicDir: paths.publicDir,
    securityDir: paths.securityDir,
  }
}

interface PlannedFile extends ActivationFileEntry {
  absolutePath: string
  mode: number
  dirMode: number
}

// Commit order. node_identity.json is the activation gate read by node_daemon
// and therefore the last file written.
function plannedFiles(rootDir: string, layout: ActivationLayout): PlannedFile[] {
  const entry = (
    absolutePath: string,
    role: ActivationFileRole,
    required: boolean,
    secret: boolean,
  ): PlannedFile => ({
    path: toPosixRelative(rootDir, absolutePath),
    role,
    required,
    secret,
    absolutePath,
    mode: secret ? 0o600 : 0o644,
    dirMode: secret ? 0o700 : 0o755,
  })
  return [
    entry(layout.devicePrivateKeyPath, 'device_private_key', true, true),
    entry(layout.didJsonPath, 'device_document', true, false),
    entry(layout.deviceDocJwtPath, 'device_document_jwt', true, false),
    entry(layout.deviceMiniDocJwtPath, 'device_mini_document_jwt', true, false),
    entry(layout.zoneBootOverridePath, 'zone_boot_override', true, false),
    entry(layout.zoneDocumentJwtPath, 'zone_document_jwt', true, false),
    entry(layout.dnsRecordsPath, 'dns_records', false, false),
    entry(layout.startConfigPath, 'start_config', true, false),
    entry(layout.gatewayParamsPath, 'gateway_params', true, false),
    entry(layout.nodeIdentityPath, 'node_identity', true, false),
  ]
}

function publicEntry(file: ActivationFileEntry): ActivationFileEntry {
  return { path: file.path, role: file.role, required: file.required, secret: file.secret }
}

// ============================================================================
// lock file
// ============================================================================

interface ActivationLockRecord {
  schema_version: number
  trace_id: string | null
  started_at: number
  domain: string
  owner_key_backup: string
  stage: ActivationLockStage
  committed: string[]
}

function readLock(lockPath: string): ActivationLockInfo | null {
  if (!lstatOrNull(lockPath)) return null
  const base: ActivationLockInfo = {
    path: lockPath,
    schemaVersion: null,
    traceId: null,
    startedAt: null,
    domain: null,
    stage: null,
    committedFiles: [],
    ownerKeyBackupPath: null,
    corrupt: false,
  }
  try {
    const value = readJsonObjectOrThrow(lockPath)
    const stage = value.stage
    return {
      ...base,
      schemaVersion: typeof value.schema_version === 'number' ? value.schema_version : null,
      traceId: typeof value.trace_id === 'string' ? value.trace_id : null,
      startedAt: typeof value.started_at === 'number' ? value.started_at : null,
      domain: typeof value.domain === 'string' ? value.domain : null,
      stage: stage === 'locked' || stage === 'backup_saved' || stage === 'committing' || stage === 'committed'
        ? stage
        : null,
      committedFiles: Array.isArray(value.committed)
        ? value.committed.filter((item): item is string => typeof item === 'string')
        : [],
      ownerKeyBackupPath: typeof value.owner_key_backup === 'string' ? value.owner_key_backup : null,
    }
  } catch {
    return { ...base, corrupt: true }
  }
}

function acquireLock(lockPath: string, record: ActivationLockRecord): void {
  const fs = requireNode('node:fs')
  try {
    fs.writeFileSync(lockPath, jsonPretty(record), { mode: 0o600, flag: 'wx' })
  } catch (error) {
    if ((error as { code?: string }).code === 'EEXIST') {
      throw new ActivationError(
        'ACTIVATION_IN_PROGRESS',
        `another activation holds the lock ${lockPath}; inspect it with provision status`,
        { lock_file: lockPath, lock: readLock(lockPath) },
      )
    }
    throw error
  }
}

function updateLock(lockPath: string, record: ActivationLockRecord): void {
  const fs = requireNode('node:fs')
  const path = requireNode('node:path')
  const temporary = path.join(path.dirname(lockPath), `.${ACTIVATION_LOCK_FILE_NAME}.${randomSuffix()}`)
  try {
    fs.writeFileSync(temporary, jsonPretty(record), { mode: 0o600, flag: 'wx' })
    fs.renameSync(temporary, lockPath)
  } finally {
    if (lstatOrNull(temporary)) {
      fs.rmSync(temporary, { force: true })
    }
  }
}

// ============================================================================
// status (provision status)
// ============================================================================

interface ObservedIdentity {
  nodeIdentity: BuckyOSLocalNodeIdentityConfig | null
  zoneDid: DID | null
  deviceDid: DID | null
}

function listSubdirectories(dirPath: string): string[] {
  const fs = requireNode('node:fs')
  if (!isDirectory(dirPath)) return []
  return (fs.readdirSync(dirPath, { withFileTypes: true }) as Array<{ name: string; isDirectory(): boolean }>)
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
}

function listFilesMatching(dirPath: string, predicate: (name: string) => boolean): string[] {
  const fs = requireNode('node:fs')
  if (!isDirectory(dirPath)) return []
  return (fs.readdirSync(dirPath, { withFileTypes: true }) as Array<{ name: string; isFile(): boolean }>)
    .filter(entry => entry.isFile() && predicate(entry.name))
    .map(entry => entry.name)
    .sort()
}

function observeIdentity(nodeIdentityPath: string, problems: ActivationProblem[]): ObservedIdentity {
  if (!isFile(nodeIdentityPath)) return { nodeIdentity: null, zoneDid: null, deviceDid: null }
  try {
    const value = readJsonObjectOrThrow(nodeIdentityPath) as unknown as BuckyOSLocalNodeIdentityConfig
    if (value.schema !== NODE_IDENTITY_SCHEMA_V2) {
      problems.push({
        code: 'NODE_IDENTITY_SCHEMA',
        message: `etc/node_identity.json schema '${String(value.schema)}' is not ${NODE_IDENTITY_SCHEMA_V2}`,
      })
      return { nodeIdentity: value, zoneDid: null, deviceDid: null }
    }
    const zoneDid = DID.fromStr(String(value.zone_did))
    const deviceDid = DID.fromStr(String(value.device_did))
    return { nodeIdentity: value, zoneDid, deviceDid }
  } catch (error) {
    problems.push({
      code: 'NODE_IDENTITY_UNREADABLE',
      message: `etc/node_identity.json cannot be parsed: ${error instanceof Error ? error.message : String(error)}`,
    })
    return { nodeIdentity: null, zoneDid: null, deviceDid: null }
  }
}

function gatewayParamsIsPlaceholder(gatewayParamsPath: string): boolean {
  try {
    const value = readJsonObjectOrThrow(gatewayParamsPath)
    const params = value.params
    return !!params && typeof params === 'object' &&
      (params as Record<string, unknown>).device_did === UNACTIVATED_GATEWAY_DEVICE_DID
  } catch {
    return false
  }
}

async function validateActivationMaterials(
  rootDir: string,
  layout: ActivationLayout,
  identity: ObservedIdentity,
  problems: ActivationProblem[],
): Promise<{ ownerDid: string | null; accessHostname: string | null }> {
  const fs = requireNode('node:fs')
  const nodeIdentity = identity.nodeIdentity
  if (!nodeIdentity || !identity.zoneDid || !identity.deviceDid) {
    return { ownerDid: null, accessHostname: null }
  }
  const problem = (code: string, message: string) => problems.push({ code, message })
  const zoneDid = identity.zoneDid
  const deviceDid = identity.deviceDid
  const ownerDid = String(nodeIdentity.owner_did)
  const ownerKey = nodeIdentity.owner_public_key as Ed25519Jwk

  if (zoneDid.method !== 'web') {
    problem('IDENTITY_NOT_DID_WEB', `zone DID ${zoneDid.toString()} is not a did:web identity`)
  }
  if (ownerDid !== zoneDid.toString()) {
    problem('OWNER_ZONE_MISMATCH', `owner DID ${ownerDid} differs from zone DID ${zoneDid.toString()}`)
  }
  const expectedDeviceDid = buildDeviceDid(String(nodeIdentity.device_name), zoneDid).toString()
  if (deviceDid.toString() !== expectedDeviceDid) {
    problem('DEVICE_DID_MISMATCH', `device DID ${deviceDid.toString()} is not ${expectedDeviceDid}`)
  }
  if (!ownerKey || typeof ownerKey !== 'object' || typeof (ownerKey as { x?: unknown }).x !== 'string') {
    problem('OWNER_KEY_MISSING', 'etc/node_identity.json owner_public_key is not an Ed25519 JWK')
    return { ownerDid, accessHostname: null }
  }

  let startConfig: Record<string, unknown> | null = null
  try {
    startConfig = readJsonObjectOrThrow(layout.startConfigPath)
  } catch (error) {
    problem('START_CONFIG_UNREADABLE', `etc/start_config.json cannot be parsed: ${error instanceof Error ? error.message : String(error)}`)
  }
  let accessHostname: string | null = null
  const jwts: Record<string, string> = {}
  if (startConfig) {
    for (const key of ['user_name', 'zone_name', 'access_hostname', 'admin_password_hash']) {
      if (typeof startConfig[key] !== 'string' || (startConfig[key] as string).length === 0) {
        problem('START_CONFIG_FIELD', `etc/start_config.json is missing ${key}`)
      }
    }
    for (const key of ['boot_config_jwt', 'device_doc_jwt', 'device_mini_doc_jwt', 'zone_document_jwt', 'ood_jwt']) {
      if (typeof startConfig[key] === 'string' && (startConfig[key] as string).length > 0) {
        jwts[key] = startConfig[key] as string
      } else {
        problem('START_CONFIG_FIELD', `etc/start_config.json is missing ${key}`)
      }
    }
    if (startConfig.zone_name !== zoneDid.toString()) {
      problem('START_CONFIG_ZONE', `etc/start_config.json zone_name is not ${zoneDid.toString()}`)
    }
    if (typeof startConfig.access_hostname === 'string') {
      accessHostname = startConfig.access_hostname
      if (accessHostname !== zoneDid.toRawHostName()) {
        problem('START_CONFIG_HOSTNAME', `etc/start_config.json access_hostname is not ${zoneDid.toRawHostName()}`)
      }
    }
    const ownerDocument = startConfig.owner_document as BuckyOSOwnerDocument | undefined
    if (!ownerDocument || typeof ownerDocument !== 'object') {
      problem('START_CONFIG_OWNER', 'etc/start_config.json is missing owner_document')
    } else {
      if (ownerDocument.id !== ownerDid) {
        problem('START_CONFIG_OWNER', `owner_document id ${String(ownerDocument.id)} is not ${ownerDid}`)
      }
      const method = Array.isArray(ownerDocument.verificationMethod)
        ? ownerDocument.verificationMethod.find(item => item && item.id === '#main_key')
        : undefined
      if (!method || getXFromJwkSafe(method.publicKeyJwk) !== ownerKey.x) {
        problem('START_CONFIG_OWNER_KEY', 'owner_document #main_key differs from node_identity owner_public_key')
      }
    }
    if (jwts.ood_jwt && jwts.device_doc_jwt && jwts.ood_jwt !== jwts.device_doc_jwt) {
      problem('START_CONFIG_OOD_JWT', 'etc/start_config.json ood_jwt differs from device_doc_jwt')
    }
    for (const [key, secret] of [['private_key', true], ['device_private_key', true], ['sn_access_token', true], ['bns_evm_private_key', true]] as const) {
      if (secret && key in startConfig) problem('START_CONFIG_SECRET', `etc/start_config.json must not contain ${key}`)
    }
  }

  const readText = (filePath: string, label: string): string | null => {
    try {
      return String(fs.readFileSync(filePath, 'utf8'))
    } catch (error) {
      problem('FILE_UNREADABLE', `${label} cannot be read: ${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }
  const zoneDocumentJwt = readText(layout.zoneDocumentJwtPath, 'etc/zone_document.jwt')?.trim() ?? null
  const deviceDocJwt = readText(layout.deviceDocJwtPath, toPosixRelative(rootDir, layout.deviceDocJwtPath))?.trim() ?? null
  const deviceMiniDocJwt = readText(layout.deviceMiniDocJwtPath, toPosixRelative(rootDir, layout.deviceMiniDocJwtPath))?.trim() ?? null
  if (zoneDocumentJwt && jwts.zone_document_jwt && zoneDocumentJwt !== jwts.zone_document_jwt) {
    problem('ZONE_DOCUMENT_MISMATCH', 'etc/zone_document.jwt differs from start_config zone_document_jwt')
  }
  if (deviceDocJwt && jwts.device_doc_jwt && deviceDocJwt !== jwts.device_doc_jwt) {
    problem('DEVICE_DOCUMENT_MISMATCH', 'device_doc.jwt differs from start_config device_doc_jwt')
  }
  if (deviceMiniDocJwt && jwts.device_mini_doc_jwt && deviceMiniDocJwt !== jwts.device_mini_doc_jwt) {
    problem('DEVICE_MINI_DOCUMENT_MISMATCH', 'device_mini_doc.jwt differs from start_config device_mini_doc_jwt')
  }

  const verify = async (jwt: string | null, label: string): Promise<Record<string, unknown> | null> => {
    if (!jwt) return null
    try {
      return (await verifyJwtEdDSA(jwt, ownerKey)) as Record<string, unknown>
    } catch (error) {
      problem('JWT_SIGNATURE', `${label} is not signed by the owner key: ${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }
  const boot = await verify(jwts.boot_config_jwt ?? null, 'boot_config_jwt')
  const device = await verify(deviceDocJwt ?? jwts.device_doc_jwt ?? null, 'device_doc.jwt')
  const mini = await verify(deviceMiniDocJwt ?? jwts.device_mini_doc_jwt ?? null, 'device_mini_doc.jwt')
  const zone = await verify(zoneDocumentJwt ?? jwts.zone_document_jwt ?? null, 'zone_document.jwt')
  const now = buckyosGetUnixTimestamp()

  if (boot) {
    if (boot.id !== zoneDid.toString()) problem('BOOT_DOCUMENT', 'boot document id differs from zone DID')
    if (!Array.isArray(boot.oods) || boot.oods.length === 0) problem('BOOT_DOCUMENT', 'boot document has no oods')
    if ('sn' in boot) problem('BOOT_DOCUMENT', 'boot document must not reference an SN in offline mode')
    if (typeof boot.exp !== 'number' || boot.exp <= now) problem('BOOT_DOCUMENT', 'boot document has expired')
    try {
      const override = readJsonObjectOrThrow(layout.zoneBootOverridePath)
      if (JSON.stringify(override) !== JSON.stringify(boot)) {
        problem('BOOT_OVERRIDE_MISMATCH', `${toPosixRelative(rootDir, layout.zoneBootOverridePath)} differs from boot_config_jwt`)
      }
    } catch (error) {
      problem('BOOT_OVERRIDE_UNREADABLE', `local boot override cannot be parsed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  let deviceKeyX: string | null = null
  if (device) {
    if (device.id !== deviceDid.toString()) problem('DEVICE_DOCUMENT', 'device document id differs from node_identity device_did')
    if (device.owner !== ownerDid) problem('DEVICE_DOCUMENT', 'device document owner differs from owner DID')
    if (device.zone_did !== zoneDid.toString()) problem('DEVICE_DOCUMENT', 'device document zone_did differs from zone DID')
    if (typeof device.exp !== 'number' || device.exp <= now) problem('DEVICE_DOCUMENT', 'device document has expired')
    const method = Array.isArray(device.verificationMethod)
      ? (device.verificationMethod as Array<Record<string, any>>).find(item => item && item.id === '#main_key')
      : undefined
    deviceKeyX = method ? getXFromJwkSafe(method.publicKeyJwk) : null
    if (!deviceKeyX) problem('DEVICE_DOCUMENT', 'device document has no #main_key')
    try {
      const didJson = readJsonObjectOrThrow(layout.didJsonPath)
      if (didJson.id !== deviceDid.toString()) {
        problem('DEVICE_DID_JSON', `${toPosixRelative(rootDir, layout.didJsonPath)} id differs from node_identity device_did`)
      }
    } catch (error) {
      problem('DEVICE_DID_JSON', `device did.json cannot be parsed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (mini && deviceKeyX && mini.x !== deviceKeyX) {
    problem('DEVICE_MINI_DOCUMENT', 'device mini document key differs from device document key')
  }
  if (zone) {
    if (zone.id !== zoneDid.toString()) problem('ZONE_DOCUMENT', 'zone document id differs from zone DID')
    if (zone.owner !== ownerDid) problem('ZONE_DOCUMENT', 'zone document owner differs from owner DID')
    if (jwts.boot_config_jwt && zone.boot_jwt !== jwts.boot_config_jwt) {
      problem('ZONE_DOCUMENT', 'zone document boot_jwt differs from start_config boot_config_jwt')
    }
    if ('sn' in zone) problem('ZONE_DOCUMENT', 'zone document must not reference an SN in offline mode')
  }
  if (deviceKeyX) {
    try {
      const pem = String(fs.readFileSync(layout.devicePrivateKeyPath, 'utf8'))
      const x = await getPublicKeyXFromPrivatePem(pem)
      if (x !== deviceKeyX) problem('DEVICE_PRIVATE_KEY', 'device private key does not match the device document key')
    } catch (error) {
      problem('DEVICE_PRIVATE_KEY', `device private key cannot be loaded: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!isWindows()) {
      const stats = lstatOrNull(layout.devicePrivateKeyPath)
      if (stats && (stats.mode & 0o077) !== 0) {
        problem('DEVICE_PRIVATE_KEY_MODE', 'device private key is readable by other users')
      }
    }
  }
  return { ownerDid, accessHostname }
}

function getXFromJwkSafe(jwk: unknown): string | null {
  try {
    return getXFromJwk(jwk as Ed25519Jwk)
  } catch {
    return null
  }
}

export async function inspectActivationRoot(rootDir: string): Promise<ActivationStatus> {
  const path = requireNode('node:path')
  const root = path.resolve(String(rootDir ?? ''))
  const observedAt = buckyosGetUnixTimestamp()
  const problems: ActivationProblem[] = []
  const warnings: string[] = []
  const base = (state: ActivationState): ActivationStatus => ({
    rootDir: root,
    state,
    startupRequired: state === 'configured',
    observedAt,
    zoneDid: null,
    ownerDid: null,
    deviceDid: null,
    deviceName: null,
    accessHostname: null,
    files: [],
    problems,
    warnings,
    lock: null,
  })

  if (!isDirectory(root)) {
    problems.push({ code: 'ROOT_MISSING', message: `BUCKYOS_ROOT does not exist: ${root}` })
    return base('not_installed')
  }
  const missingDirs = ['bin', 'etc'].filter(name => !isDirectory(path.join(root, name)))
  if (missingDirs.length > 0) {
    for (const name of missingDirs) {
      problems.push({ code: 'INSTALL_INCOMPLETE', message: `installed BuckyOS directory is missing: ${path.join(root, name)}` })
    }
    return base('not_installed')
  }

  const etcDir = path.join(root, 'etc')
  const lock = readLock(path.join(etcDir, ACTIVATION_LOCK_FILE_NAME))
  const identity = observeIdentity(path.join(etcDir, 'node_identity.json'), problems)

  // Resolve the device identity directories: from node_identity when it is
  // readable, otherwise from whatever exists on disk (partial activations).
  let zoneDid = identity.zoneDid
  let deviceDid = identity.deviceDid
  const publicDirs = listSubdirectories(path.join(root, 'local', 'identity'))
  const securityDirs = listSubdirectories(path.join(root, 'security'))
  const zoneJsonFiles = listFilesMatching(etcDir, name => name.endsWith('.zone.json'))
  if (!zoneDid && zoneJsonFiles.length > 0) {
    const host = zoneJsonFiles[0].slice(0, -'.zone.json'.length)
    if (!host.endsWith('.did')) zoneDid = new DID('web', host)
  }
  if (!deviceDid && zoneDid) deviceDid = buildDeviceDid(ACTIVATION_DEVICE_NAME, zoneDid)
  const strayIdentityDirs = [...publicDirs, ...securityDirs].filter(name =>
    !deviceDid || name !== path.basename(deviceIdentityPathsForRoots(identityRootsFor(root), deviceDid).publicDir)
  )

  const files: ObservedActivationFile[] = []
  let layout: ActivationLayout | null = null
  if (zoneDid && deviceDid) {
    layout = layoutFor(root, zoneDid, deviceDid)
    for (const planned of plannedFiles(root, layout)) {
      files.push({ ...publicEntry(planned), present: isFile(planned.absolutePath) })
    }
  } else {
    // Without a zone we can only observe the fixed etc files.
    for (const [name, role, required] of [
      ['node_identity.json', 'node_identity', true],
      ['start_config.json', 'start_config', true],
      [ZONE_DOCUMENT_JWT_FILE_NAME, 'zone_document_jwt', true],
      ['node_gateway_params.json', 'gateway_params', true],
      [ZONE_DNS_RECORDS_FILE_NAME, 'dns_records', false],
    ] as Array<[string, ActivationFileRole, boolean]>) {
      files.push({ path: `etc/${name}`, role, required, secret: false, present: isFile(path.join(etcDir, name)) })
    }
    for (const name of zoneJsonFiles) {
      files.push({ path: `etc/${name}`, role: 'zone_boot_override', required: true, secret: false, present: true })
    }
  }
  const gatewayEntry = files.find(file => file.role === 'gateway_params')
  const gatewayPlaceholder = gatewayEntry?.present === true &&
    gatewayParamsIsPlaceholder(path.join(etcDir, 'node_gateway_params.json'))
  if (gatewayEntry && gatewayPlaceholder) gatewayEntry.present = false

  const markers = files.filter(file => file.present && file.role !== 'dns_records')
  const requiredMissing = files.filter(file => file.required && !file.present)
  const status = base('unactivated')
  status.files = files
  status.lock = lock
  status.zoneDid = zoneDid?.toString() ?? null
  status.deviceDid = deviceDid?.toString() ?? null
  status.deviceName = identity.nodeIdentity ? String(identity.nodeIdentity.device_name) : (deviceDid ? ACTIVATION_DEVICE_NAME : null)
  status.ownerDid = identity.nodeIdentity ? String(identity.nodeIdentity.owner_did) : null

  if (lock) {
    warnings.push(
      lock.corrupt
        ? `activation lock ${lock.path} exists but cannot be parsed`
        : `activation lock ${lock.path} exists (stage=${lock.stage ?? 'unknown'}, committed=${lock.committedFiles.length})`,
    )
  }
  for (const name of strayIdentityDirs) {
    warnings.push(`unexpected identity directory: ${name}`)
  }

  if (markers.length === 0 && strayIdentityDirs.length === 0 && !lock && problems.length === 0) {
    status.state = 'unactivated'
    return status
  }
  if (requiredMissing.length > 0 || !layout || strayIdentityDirs.length > 0 && markers.length === 0) {
    for (const file of requiredMissing) {
      problems.push({ code: 'FILE_MISSING', message: `${file.path} is missing` })
    }
    status.state = 'partial'
    return status
  }
  const validated = await validateActivationMaterials(root, layout, identity, problems)
  status.ownerDid = validated.ownerDid ?? status.ownerDid
  status.accessHostname = validated.accessHostname ?? (zoneDid ? zoneDid.toRawHostName() : null)
  if (lock && lock.stage !== 'committed') {
    problems.push({
      code: 'ACTIVATION_INTERRUPTED',
      message: `activation lock is still at stage ${lock.stage ?? 'unknown'}; the commit did not finish cleanly`,
    })
  }
  status.state = problems.length === 0 ? 'configured' : 'invalid'
  status.startupRequired = status.state === 'configured'
  return status
}

// ============================================================================
// check (provision check)
// ============================================================================

function inspectOwnerKeyBackupTarget(backupPath: string, problems: ActivationProblem[]): OwnerKeyBackupTarget {
  const path = requireNode('node:path')
  const directory = path.dirname(backupPath)
  const directoryExists = isDirectory(directory)
  const exists = lstatOrNull(backupPath) !== null
  if (!directoryExists) {
    problems.push({
      code: 'OWNER_KEY_BACKUP_DIRECTORY_MISSING',
      message: `owner key backup directory does not exist: ${directory}`,
    })
  }
  if (exists) {
    problems.push({ code: 'OWNER_KEY_BACKUP_EXISTS', message: `owner key backup already exists: ${backupPath}` })
  }
  return { path: backupPath, directoryExists, exists }
}

function targetStateProblem(status: ActivationStatus): ActivationProblem | null {
  if (status.lock) {
    return {
      code: 'ACTIVATION_IN_PROGRESS',
      message: `activation lock exists: ${status.lock.path} (stage=${status.lock.stage ?? 'unknown'})`,
    }
  }
  switch (status.state) {
    case 'unactivated':
      return null
    case 'not_installed':
      return { code: 'TARGET_NOT_INSTALLED', message: `BuckyOS is not installed at ${status.rootDir}` }
    case 'configured':
      return { code: 'TARGET_ALREADY_ACTIVATED', message: `BuckyOS is already activated at ${status.rootDir}` }
    case 'invalid':
      return {
        code: 'TARGET_ALREADY_ACTIVATED',
        message: `BuckyOS activation material exists but is invalid at ${status.rootDir}; it is not overwritten`,
      }
    case 'partial':
      return {
        code: 'TARGET_PARTIALLY_ACTIVATED',
        message: `BuckyOS is partially activated at ${status.rootDir}; remove the partial material or reinstall`,
      }
  }
}

export async function checkOfflineActivation(
  options: OfflineActivationCheckOptions,
): Promise<OfflineActivationPrecheck> {
  const params = normalizeActivationParams(options)
  const status = await inspectActivationRoot(params.rootDir)
  const problems: ActivationProblem[] = []
  const stateProblem = targetStateProblem(status)
  if (stateProblem) problems.push(stateProblem)
  const ownerKeyBackup = inspectOwnerKeyBackupTarget(params.ownerKeyBackupPath, problems)
  const layout = layoutFor(params.rootDir, params.zoneDid, params.deviceDid)
  return {
    ready: problems.length === 0,
    rootDir: params.rootDir,
    state: status.state,
    domain: params.domain,
    ownerName: params.ownerName,
    ownerDid: params.ownerDid.toString(),
    zoneDid: params.zoneDid.toString(),
    deviceDid: params.deviceDid.toString(),
    deviceName: ACTIVATION_DEVICE_NAME,
    accessHostname: params.domain,
    rtcpPort: params.rtcpPort,
    guestAccess: params.guestAccess,
    publicIp: params.publicIp ?? null,
    dnsRecords: buildActivationDnsRecords(params.domain, params.publicIp),
    ownerKeyBackup,
    plannedFiles: plannedFiles(params.rootDir, layout).map(publicEntry),
    problems,
    status,
  }
}

function precheckError(precheck: OfflineActivationPrecheck): ActivationError {
  const first = precheck.problems[0]
  return new ActivationError(
    precheck.problems.length === 1 ? first.code : 'ACTIVATION_PRECHECK_FAILED',
    precheck.problems.length === 1 ? first.message : `activation precheck failed: ${precheck.problems.map(item => item.message).join('; ')}`,
    { state: precheck.state, problems: precheck.problems },
  )
}

// ============================================================================
// document generation
// ============================================================================

interface GeneratedMaterial {
  documentIat: number
  documentExp: number
  ownerDocument: Record<string, unknown>
  bootDocument: Record<string, unknown>
  bootJwt: string
  deviceDocument: Record<string, unknown>
  deviceDocJwt: string
  deviceMiniDocJwt: string
  zoneDocumentJwt: string
  nodeIdentity: BuckyOSLocalNodeIdentityConfig
  startConfig: Record<string, unknown>
  gatewayParams: Record<string, unknown>
  dnsRecords: ActivationDnsRecord[]
}

async function generateMaterial(
  params: NormalizedActivationParams,
  adminPassword: string,
  ownerKeyPair: ProvisionKeyPair,
  deviceKeyPair: ProvisionKeyPair,
): Promise<GeneratedMaterial> {
  const now = buckyosGetUnixTimestamp()
  const exp = now + ACTIVATION_DOCUMENT_VALIDITY_SECONDS
  const ownerJwk = createJwkByX(ownerKeyPair.publicKeyX)
  const deviceJwk = createJwkByX(deviceKeyPair.publicKeyX)
  const ownerDidStr = params.ownerDid.toString()
  const zoneDidStr = params.zoneDid.toString()
  const deviceDidStr = params.deviceDid.toString()

  // OwnerDocument (Owner DID == Zone DID), bound to the zone like the
  // node_daemon web activation path does (binding model v2).
  const ownerDoc = newOwnerDocument({
    did: params.ownerDid,
    name: params.ownerName,
    displayName: params.ownerName,
    publicKeyJwk: ownerJwk,
    now,
  })
  ownerDoc.exp = exp
  ownerDocumentSetDefaultZoneDid(ownerDoc, params.zoneDid)
  const ownerDocument = ownerDocumentToOrderedJson(ownerDoc)

  // Minimal ZoneBootDocument: id / oods / exp only (no owner, owner_key, iat, sn).
  const oodString = oodDescriptionToString(parseOODDescription(`${ACTIVATION_DEVICE_NAME}@${ACTIVATION_NET_ID}`))
  const bootJwt = await encodeZoneBootDocument(
    newZoneBootDocument({ id: params.zoneDid, oods: [oodString], exp }),
    ownerKeyPair.privateKeyPem,
  )
  const bootDocument = decodeJwtClaimWithoutVerify(bootJwt) as Record<string, unknown>

  // DeviceDocument signed by the owner key.
  const deviceDoc: BuckyOSDeviceDocument = newDeviceDocumentByJwkWithDid(
    ACTIVATION_DEVICE_NAME,
    deviceJwk,
    params.deviceDid,
    now,
  )
  delete (deviceDoc as Record<string, unknown>).support_container
  deviceDoc.owner = ownerDidStr
  deviceDoc.zone_did = zoneDidStr
  deviceDoc.net_id = ACTIVATION_NET_ID
  deviceDoc.rtcp_port = params.rtcpPort
  deviceDoc.iat = now
  deviceDoc.exp = exp
  deviceDoc.version_seq = 0
  const deviceDocument = deviceDocumentToOrderedJson(deviceDoc)
  const deviceDocJwt = await encodeDeviceDocument(deviceDoc, ownerKeyPair.privateKeyPem)
  const miniDoc = newDeviceMiniDocumentByDeviceDocument(deviceDoc)
  miniDoc.iat = now
  const deviceMiniDocJwt = await deviceMiniDocumentToJwt(miniDoc, ownerKeyPair.privateKeyPem)

  // ZoneDocument embedding the boot JWT and the device.
  const zoneDoc: BuckyOSZoneDocument = newZoneDocument({
    id: params.zoneDid,
    ownerDid: params.ownerDid,
    publicKeyJwk: ownerJwk,
    now,
  })
  zoneDoc.hostname = params.domain
  zoneDoc.owner = ownerDidStr
  zoneDoc.oods = [oodString]
  zoneDoc.boot_jwt = bootJwt
  zoneDoc.devices = { [ACTIVATION_DEVICE_NAME]: deviceDocument as unknown as BuckyOSDeviceDocument }
  zoneDoc.mini_device_jwts = { [ACTIVATION_DEVICE_NAME]: deviceMiniDocJwt }
  zoneDoc.iat = now
  zoneDoc.exp = exp
  zoneDoc.version_seq = 0
  delete zoneDoc.sn
  const zoneDocumentJwt = await encodeZoneDocument(zoneDoc, ownerKeyPair.privateKeyPem)
  if (new TextEncoder().encode(zoneDocumentJwt).length >= MAX_INLINE_DOCUMENT_BYTES) {
    throw new ActivationError(
      'ZONE_DOCUMENT_TOO_LARGE',
      `zone document JWT exceeds the ${MAX_INLINE_DOCUMENT_BYTES} byte inline limit`,
    )
  }

  const nodeIdentity = newLocalNodeIdentityConfig({
    zoneDid: params.zoneDid,
    ownerDid: params.ownerDid,
    ownerPublicKey: ownerJwk,
    deviceName: ACTIVATION_DEVICE_NAME,
    deviceDid: params.deviceDid,
    zoneIat: now,
  })

  // Same field set as node_daemon active_server build_start_config.
  const startConfig: Record<string, unknown> = {
    user_name: params.ownerName,
    owner_document: ownerDocument,
    zone_name: zoneDidStr,
    access_hostname: params.domain,
    zone_document_jwt: zoneDocumentJwt,
    boot_config_jwt: bootJwt,
    device_doc_jwt: deviceDocJwt,
    device_mini_doc_jwt: deviceMiniDocJwt,
    ood_jwt: deviceDocJwt,
    admin_password_hash: hashAdminPassword(params.ownerName, adminPassword),
    guest_access: params.guestAccess,
    friend_passcode: '',
    enabled_features: {},
    ai_provider_config: {},
    jarvis_msg_tunnel_config: {},
  }

  return {
    documentIat: now,
    documentExp: exp,
    ownerDocument,
    bootDocument,
    bootJwt,
    deviceDocument,
    deviceDocJwt,
    deviceMiniDocJwt,
    zoneDocumentJwt,
    nodeIdentity,
    startConfig,
    gatewayParams: { params: { device_did: deviceDidStr } },
    dnsRecords: buildActivationDnsRecords(params.domain, params.publicIp),
  }
}

function fileContent(file: PlannedFile, material: GeneratedMaterial, deviceKeyPair: ProvisionKeyPair, domain: string): string {
  switch (file.role) {
    case 'device_private_key':
      return deviceKeyPair.privateKeyPem
    case 'device_document':
      return jsonPretty(material.deviceDocument)
    case 'device_document_jwt':
      return material.deviceDocJwt
    case 'device_mini_document_jwt':
      return material.deviceMiniDocJwt
    case 'zone_boot_override':
      return jsonPretty(material.bootDocument)
    case 'zone_document_jwt':
      return material.zoneDocumentJwt
    case 'dns_records':
      return jsonPretty({ hostname: domain, records: material.dnsRecords })
    case 'start_config':
      return jsonPretty(material.startConfig)
    case 'gateway_params':
      return jsonPretty(material.gatewayParams)
    case 'node_identity':
      return jsonPretty(material.nodeIdentity)
  }
}

// ============================================================================
// activate (provision activate)
// ============================================================================

function saveOwnerKeyBackup(backupPath: string, privateKeyPem: string): void {
  const fs = requireNode('node:fs')
  // O_EXCL: never overwrite, never follow a pre-existing symlink.
  fs.writeFileSync(backupPath, privateKeyPem, { mode: 0o600, flag: 'wx' })
  if (!isWindows()) {
    fs.chmodSync(backupPath, 0o600)
  }
}

function recoverySteps(lockPath: string, backupPath: string, committed: string[]): string[] {
  return [
    `inspect the target with: buckyos provision status --root <root>`,
    committed.length > 0
      ? `the following files were committed and are left in place: ${committed.join(', ')}`
      : 'no activation file was committed to the target root',
    `the owner private key backup was saved at ${backupPath}; keep it or delete it before retrying (the backup path must not exist)`,
    `remove the committed files and the lock file ${lockPath} (or reinstall BuckyOS), then run provision check again`,
    'the generated identity is not deleted or regenerated automatically',
  ]
}

export async function activateOfflineZone(options: OfflineActivationOptions): Promise<OfflineActivationResult> {
  const fs = requireNode('node:fs')
  const params = normalizeActivationParams(options)
  const adminPassword = validateAdminPassword(options.adminPassword)
  const precheck = await checkOfflineActivation(options)
  if (!precheck.ready) throw precheckError(precheck)

  const ownerKeyPair = options.ownerKeyPair ?? generateProvisionKeyPair()
  const deviceKeyPair = options.deviceKeyPair ?? generateProvisionKeyPair()
  const material = await generateMaterial(params, adminPassword, ownerKeyPair, deviceKeyPair)
  const layout = layoutFor(params.rootDir, params.zoneDid, params.deviceDid)
  const files = plannedFiles(params.rootDir, layout)
  const warnings: string[] = []

  const lockRecord: ActivationLockRecord = {
    schema_version: ACTIVATION_LOCK_SCHEMA_VERSION,
    trace_id: options.traceId ?? null,
    started_at: buckyosGetUnixTimestamp(),
    domain: params.domain,
    owner_key_backup: params.ownerKeyBackupPath,
    stage: 'locked',
    committed: [],
  }
  acquireLock(layout.lockPath, lockRecord)

  // Re-check the target while holding the lock: a concurrent activation may
  // have committed between the precheck and the lock acquisition.
  const releaseLock = () => {
    try {
      fs.rmSync(layout.lockPath, { force: true })
    } catch {
      // reported by the caller through the thrown error
    }
  }
  let recheck: OfflineActivationPrecheck
  try {
    recheck = await checkOfflineActivation(options)
  } catch (error) {
    releaseLock()
    throw error
  }
  const recheckProblems = recheck.problems.filter(problem => problem.code !== 'ACTIVATION_IN_PROGRESS')
  if (recheckProblems.length > 0) {
    releaseLock()
    throw precheckError({ ...recheck, problems: recheckProblems })
  }
  for (const file of files) {
    if (lstatOrNull(file.absolutePath)) {
      releaseLock()
      throw new ActivationError(
        'TARGET_PARTIALLY_ACTIVATED',
        `activation file already exists: ${file.path}`,
        { state: 'partial', problems: [{ code: 'FILE_EXISTS', message: `${file.path} already exists` }] },
      )
    }
  }

  // Owner key backup first: if it cannot be saved nothing else is written.
  try {
    saveOwnerKeyBackup(params.ownerKeyBackupPath, ownerKeyPair.privateKeyPem)
  } catch (error) {
    releaseLock()
    const code = (error as { code?: string }).code
    throw new ActivationError(
      code === 'EEXIST' ? 'OWNER_KEY_BACKUP_EXISTS' : 'OWNER_KEY_BACKUP_FAILED',
      `owner key backup could not be saved: ${error instanceof Error ? error.message : String(error)}`,
      { owner_key_backup: { path: params.ownerKeyBackupPath, saved: false }, committed_files: [] },
    )
  }
  lockRecord.stage = 'backup_saved'
  const committed: CommittedActivationFile[] = []
  const failCommit = (error: unknown, stage: string): never => {
    throw new ActivationError(
      'ACTIVATION_COMMIT_FAILED',
      `activation commit failed at ${stage}: ${error instanceof Error ? error.message : String(error)}`,
      {
        stage,
        owner_key_backup: { path: params.ownerKeyBackupPath, saved: true },
        committed_files: committed,
        lock_file: layout.lockPath,
        recovery: recoverySteps(layout.lockPath, params.ownerKeyBackupPath, committed.map(file => file.path)),
      },
    )
  }
  try {
    updateLock(layout.lockPath, lockRecord)
  } catch (error) {
    failCommit(error, 'lock:backup_saved')
  }

  lockRecord.stage = 'committing'
  for (const file of files) {
    const content = fileContent(file, material, deviceKeyPair, params.domain)
    try {
      commitFile(file.absolutePath, content, file.mode, file.dirMode)
    } catch (error) {
      failCommit(error, file.path)
    }
    committed.push({ ...publicEntry(file), sha256: file.secret ? null : sha256Hex(content) })
    lockRecord.committed = committed.map(item => item.path)
    try {
      updateLock(layout.lockPath, lockRecord)
    } catch (error) {
      failCommit(error, `lock:${file.path}`)
    }
  }
  lockRecord.stage = 'committed'
  try {
    updateLock(layout.lockPath, lockRecord)
    fs.rmSync(layout.lockPath, { force: true })
  } catch (error) {
    warnings.push(
      `activation completed but the lock ${layout.lockPath} could not be removed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  return {
    rootDir: params.rootDir,
    state: 'configured',
    startupRequired: true,
    domain: params.domain,
    ownerName: params.ownerName,
    ownerDid: params.ownerDid.toString(),
    zoneDid: params.zoneDid.toString(),
    deviceDid: params.deviceDid.toString(),
    deviceName: ACTIVATION_DEVICE_NAME,
    accessHostname: params.domain,
    rtcpPort: params.rtcpPort,
    guestAccess: params.guestAccess,
    publicIp: params.publicIp ?? null,
    documentIat: material.documentIat,
    documentExp: material.documentExp,
    ownerKeyBackup: { path: params.ownerKeyBackupPath, saved: true },
    dnsRecords: material.dnsRecords,
    committedFiles: committed,
    warnings,
  }
}
