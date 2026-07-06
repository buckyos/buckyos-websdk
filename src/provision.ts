// provision: node-only TypeScript mirror of the buckycli provision commands
// (buckyos/src/kernel/buckyos-api/src/test_config.rs + buckycli set_pkg_meta).
//
// This module builds the dev/test environment files consumed by node_daemon:
//   createUserEnv      <-> buckycli create_user_env
//   createNodeConfigs  <-> buckycli create_node_configs
//   createSnConfigs    <-> buckycli create_sn_configs
//   registerUserToSn   <-> buckycli register_user_to_sn
//   registerDeviceToSn <-> buckycli register_device_to_sn
//   setPkgMeta         <-> buckycli set_pkg_meta
//   buildDidDocs       <-> buckycli build_did_docs
//
// Node identity uses schema v2 (see device_identity.ts): createNodeConfigs
// writes node_identity.json (metadata only) + node_gateway_params.json into
// the node dir, and the device document / jwts / private key into the
// identity-roots layout under <nodeDir>/local/identity and <nodeDir>/security.
// Device DIDs are name-based (did:bns:ood1.alice), built by buildDeviceDid.
//
// Runtime requirements: Node >= 22.13 or Deno >= 2.2 (node:sqlite). Never
// import this module from a browser bundle.

import {
  DID,
  parseOODDescription,
  oodDescriptionToString,
  createJwkByX,
  newOwnerDocument,
  newZoneDocument,
  newZoneBootDocument,
  encodeZoneBootDocument,
  zoneDocumentInitByBootDocument,
  newDeviceDocumentByMiniDocument,
  encodeDeviceDocument,
  newDeviceMiniDocument,
  newDeviceMiniDocumentByDeviceDocument,
  deviceMiniDocumentToJwt,
  decodeJwtClaimWithoutVerify,
  verifyJwtEdDSA,
  buckyosGetUnixTimestamp,
  ownerDocumentToOrderedJson,
  zoneDocumentToOrderedJson,
  deviceDocumentToOrderedJson,
} from './namelib'
import {
  buildDeviceDid,
  deviceIdentityPathsForRoots,
  loadLocalNodeIdentityConfig,
  newDeviceDocumentByJwkWithDid,
  newLocalNodeIdentityConfig,
  saveLocalDeviceIdentityForRoots,
} from './device_identity'
import { IdentityRoots } from './cert'
import { DEV_TEST_KEYS, DevTestKeyPair, getDevTestKeyPairById } from './dev_test_keys'
import { buildNamedObjectByJson } from './ndn_types'
import {
  BuckyOSDeviceDocument,
  BuckyOSZoneDocument,
  BuckyOSZoneTxtRecord,
  Ed25519Jwk,
} from './types'

// v2 device identity layout helpers (mirror buckyos-api device_identity.rs).
export {
  NODE_IDENTITY_SCHEMA_V2,
  DEVICE_DOC_JWT_FILE_NAME,
  DEVICE_MINI_DOC_JWT_FILE_NAME,
  NODE_GATEWAY_PARAMS_FILE_NAME,
  buildDeviceDid,
  bindDeviceDocumentDid,
  newDeviceDocumentByJwkWithDid,
  newLocalNodeIdentityConfig,
  loadLocalNodeIdentityConfig,
  deviceIdentityPathsForRoots,
  saveLocalDeviceIdentityForRoots,
  saveNodeGatewayParams,
  loadDeviceDocJwtForRoots,
  loadDeviceMiniDocJwtForRoots,
  loadLocalDeviceDocumentForRoots,
  decodeDeviceDocumentWithoutVerify,
} from './device_identity'
export type { BuckyOSLocalNodeIdentityConfig, DeviceIdentityPaths, NewLocalNodeIdentityConfigParams } from './device_identity'

// TLS CA / certificate generation (Phase 3, replaces python CertManager)
export {
  IdentityRoots,
  IDENTITY_MATERIALS,
  IDENTITY_USAGES,
  createCa,
  createCertFromCa,
  createIdentityCertFromCa,
  didWebDocumentUrl,
  encodeIdentityDirName,
  ensureCa,
  identityDirName,
  identityFileName,
  identityRawHostUri,
} from './cert'
export type {
  CreateCaResult,
  CreateCertResult,
  CreateIdentityCertFromCaOptions,
  CreateIdentityCertResult,
  IdentityDirMatch,
  IdentityMatchType,
  IdentityMaterial,
  IdentityRootsOptions,
  IdentityUsage,
  X509PathMatch,
  X509Paths,
} from './cert'

// Dev-only deterministic keys/accounts; never use in production.
export {
  DEV_TEST_EVM_ACCOUNTS,
  DEV_TEST_EVM_SEED_SENDER,
  DEV_TEST_EVM_SEED_SENDER_INDEX,
  DEV_TEST_EVM_USER_INDEXES,
  DEV_TEST_KEY_INDEXES,
  DEV_TEST_KEYS,
  DEV_TEST_MNEMONIC,
  deriveDevTestEvmAccount,
  deriveDevTestEvmAccountFromMnemonic,
  deriveDevTestKeyPair,
  deriveDevTestKeyPairFromMnemonic,
  devTestKeccak256,
  getDevTestEvmAccountByIndex,
  getDevTestEvmAccountByUsername,
  getDevTestKeyPairById,
  getDevTestKeyPairByIndex,
} from './dev_test_keys'
export type { DevTestEvmAccount, DevTestKeyPair } from './dev_test_keys'

// Mirrors test_config.rs constants.
export const PROVISION_BASE_TIME = 1743478939 // 2025-04-01
const DEFAULT_EXP_YEARS = 10
export const PROVISION_DEFAULT_EXP = PROVISION_BASE_TIME + 3600 * 24 * 365 * DEFAULT_EXP_YEARS
const ADMIN_PASSWORD_HASH = 'o8XyToejrbCYou84h/VkF4Tht0BeQQbuX3XKG+8+GQ4=' // bucky2025

const MIN_NODE_MAJOR = 22
const MIN_NODE_MINOR = 13

// ============================================================================
// runtime guard (T2.1)
// ============================================================================

function parseVersion(version: string): [number, number] {
  const parts = version.split('.')
  return [Number(parts[0]) || 0, Number(parts[1]) || 0]
}

export function assertProvisionRuntime(): void {
  const globals = globalThis as {
    Deno?: { version?: { deno?: string } }
    process?: { versions?: { node?: string } }
  }
  const denoVersion = globals.Deno?.version?.deno
  if (denoVersion) {
    const [major, minor] = parseVersion(denoVersion)
    if (major > 2 || (major === 2 && minor >= 2)) {
      return
    }
    throw new Error(`buckyos provision requires Deno >= 2.2 (node:sqlite), current: ${denoVersion}`)
  }
  const nodeVersion = globals.process?.versions?.node
  if (nodeVersion) {
    const [major, minor] = parseVersion(nodeVersion)
    if (major > MIN_NODE_MAJOR || (major === MIN_NODE_MAJOR && minor >= MIN_NODE_MINOR)) {
      return
    }
    throw new Error(`buckyos provision requires Node >= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR} (node:sqlite), current: ${nodeVersion}`)
  }
  throw new Error('buckyos provision requires a Node >= 22.13 or Deno >= 2.2 runtime (browser is not supported)')
}

function requireNode(moduleName: string): any {
  assertProvisionRuntime()
  // process.getBuiltinModule works in both CJS and ESM on Node >= 22.3 and
  // Deno >= 2; fall back to require for older bundler/CJS environments.
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
  throw new Error(`buckyos provision cannot load builtin module ${moduleName} in this runtime`)
}

// ============================================================================
// fs helpers (mirror write_file / write_json in test_config.rs)
// ============================================================================

function writeFileWithLog(filePath: string, content: string): void {
  const fs = requireNode('node:fs')
  const path = requireNode('node:path')
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
  console.log(`# Write file: ${filePath}`)
}

// serde_json::to_string_pretty equivalent: 2-space indent, no trailing newline.
function writeJsonWithLog(filePath: string, data: unknown): void {
  writeFileWithLog(filePath, JSON.stringify(data, null, 2))
}

function readJson(filePath: string): any {
  const fs = requireNode('node:fs')
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

// Sort object keys recursively; matches serde_json::Value (BTreeMap) output
// used by Rust for json!-literal configs (start_config/params/did docs).
function sortKeysDeep(value: any): any {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep)
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, any> = {}
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortKeysDeep(value[key])
    }
    return sorted
  }
  return value
}

// ============================================================================
// key lookup (mirror TestKeys::get_key_pair_by_id usage in test_config.rs)
// ============================================================================

function resolveOwnerKeyPair(username: string, override?: DevTestKeyPair): DevTestKeyPair {
  if (override) {
    return override
  }
  if (DEV_TEST_KEYS[username]) {
    return DEV_TEST_KEYS[username]
  }
  if (DEV_TEST_KEYS[`${username}.owner`]) {
    return DEV_TEST_KEYS[`${username}.owner`]
  }
  console.log(`Warning: Key pair for user ${username} not found, using devtest key pair`)
  return getDevTestKeyPairById('devtest')
}

function resolveDeviceKeyPair(username: string, deviceName: string, override?: DevTestKeyPair): DevTestKeyPair {
  if (override) {
    return override
  }
  return getDevTestKeyPairById(`${username}.${deviceName}`)
}

// ============================================================================
// createUserEnv (T2.2, mirror cmd_create_user_env + UserEnvScope)
// ============================================================================

export interface CreateUserEnvParams {
  username: string
  hostname: string
  // ood description string, supports "name", "name@netid", "name:ip@netid"...
  oodName: string
  // base host name for SN; SN is only used when it contains a '.'
  snBaseHost?: string
  rtcpPort?: number
  outputDir: string
  // optional key overrides; default to DEV_TEST_KEYS (dev only)
  ownerKeyPair?: DevTestKeyPair
  deviceKeyPair?: DevTestKeyPair
}

export async function createUserEnv(params: CreateUserEnvParams): Promise<BuckyOSZoneTxtRecord> {
  assertProvisionRuntime()
  const path = requireNode('node:path')
  const rtcpPort = params.rtcpPort ?? 2980
  const userDir = params.outputDir
  const exp = PROVISION_DEFAULT_EXP

  const keyPair = resolveOwnerKeyPair(params.username, params.ownerKeyPair)
  const ownerDid = new DID('bns', params.username)

  // zone did resolution, mirror of cmd_create_user_env
  let zoneDid = new DID('web', params.hostname)
  let snHost: string | undefined
  if (params.snBaseHost && params.snBaseHost.includes('.')) {
    const web3Bns = `web3.${params.snBaseHost}`
    zoneDid = DID.fromHostNameByBridge(params.hostname, 'bns', web3Bns)
    snHost = `sn.${params.snBaseHost}`
  }

  // create_owner_config
  writeFileWithLog(path.join(userDir, 'user_private_key.pem'), keyPair.privateKeyPem)
  const ownerJwk = createJwkByX(keyPair.publicKeyX)
  const ownerDoc = newOwnerDocument({
    did: ownerDid,
    name: params.username,
    displayName: params.username,
    publicKeyJwk: ownerJwk,
  })
  writeJsonWithLog(path.join(userDir, 'user_config.json'), ownerDocumentToOrderedJson(ownerDoc))
  console.log(`Created owner config for ${params.username}`)

  // create_zone_boot_config_jwt
  const ood = parseOODDescription(params.oodName)
  const deviceKeyPair = resolveDeviceKeyPair(params.username, ood.name, params.deviceKeyPair)

  let ddnsSnUrl: string | undefined
  let realSnHost = snHost
  if (ood.netId) {
    if (ood.netId.startsWith('wan')) {
      realSnHost = undefined
    }
    if (ood.netId.startsWith('wan_dyn') && snHost) {
      ddnsSnUrl = `https://${snHost}/kapi/sn`
    }
  }

  const oodString = oodDescriptionToString(ood)
  const zoneBoot = newZoneBootDocument({ oods: [oodString], sn: realSnHost, exp })
  const zoneHostName = zoneDid.toRawHostName()
  writeJsonWithLog(path.join(userDir, `${zoneHostName}.zone.json`), zoneBoot)

  zoneBoot.id = zoneDid.toString()
  const zoneDoc = newZoneDocument({ id: zoneDid, ownerDid, publicKeyJwk: ownerJwk })
  const bootJwt = await encodeZoneBootDocument(zoneBoot, keyPair.privateKeyPem)
  zoneDocumentInitByBootDocument(zoneDoc, zoneBoot, bootJwt)
  writeJsonWithLog(path.join(userDir, 'zone_config.json'), zoneDocumentToOrderedJson(zoneDoc))

  const pkx = keyPair.publicKeyX
  console.log(`=> ${zoneHostName} TXT Record(${bootJwt.length + 6}): BOOT=${bootJwt};`)
  console.log(`=> ${zoneHostName} TXT Record(${pkx.length + 5}): PKX=${pkx};`)

  const realRtcpPort = rtcpPort === 2980 ? undefined : rtcpPort
  const miniDoc = newDeviceMiniDocument({
    name: ood.name,
    x: deviceKeyPair.publicKeyX,
    rtcpPort: realRtcpPort,
    exp,
  })
  const miniJwt = await deviceMiniDocumentToJwt(miniDoc, keyPair.privateKeyPem)
  console.log(`=> ${zoneHostName} TXT Record(${miniJwt.length + 5}): DEV=${miniJwt};`)

  // Device configuration is only printed here (mirror of Rust); the actual
  // identity files are produced by createNodeConfigs in the v2 layout.
  const deviceDid = buildDeviceDid(ood.name, zoneDid)
  const deviceDoc = newDeviceDocumentByJwkWithDid(ood.name, createJwkByX(deviceKeyPair.publicKeyX), deviceDid)
  deviceDoc.support_container = true
  if (ood.netId !== undefined) {
    deviceDoc.net_id = ood.netId
  }
  deviceDoc.owner = ownerDid.toString()
  deviceDoc.zone_did = zoneDid.toString()
  if (ddnsSnUrl !== undefined) {
    deviceDoc.ddns_sn_url = ddnsSnUrl
  }
  console.log(`${ood.name} device config: ${JSON.stringify(deviceDocumentToOrderedJson(deviceDoc), null, 2)}`)

  const zoneTxtRecord: BuckyOSZoneTxtRecord = {
    boot_config_jwt: bootJwt,
    device_mini_doc_jwt: miniJwt,
    pkx,
  }
  writeJsonWithLog(path.join(userDir, 'zone_txt_record.json'), zoneTxtRecord)
  console.log(`Successfully created user environment configuration: ${params.username}`)
  return zoneTxtRecord
}

// ============================================================================
// createNodeConfigs (T2.3, mirror cmd_create_node_configs + create_node_config)
// ============================================================================

export interface CreateNodeConfigsParams {
  deviceName: string
  // user env dir created by createUserEnv
  envDir: string
  netId?: string
  ownerKeyPair?: DevTestKeyPair
  deviceKeyPair?: DevTestKeyPair
  // device document iat override (defaults to the current time, like Rust)
  now?: number
}

// Mirrors Rust test_config.rs test_identity_roots: node-local identity roots
// under the node dir.
export function nodeTestIdentityRoots(nodeDir: string): IdentityRoots {
  const path = requireNode('node:path')
  return new IdentityRoots(path.join(nodeDir, 'local', 'identity'), path.join(nodeDir, 'security'))
}

export async function createNodeConfigs(params: CreateNodeConfigsParams): Promise<string> {
  assertProvisionRuntime()
  const path = requireNode('node:path')
  const rootDir = params.envDir

  const userConfig = readJson(path.join(rootDir, 'user_config.json'))
  const username: string = userConfig.name
  if (typeof username !== 'string' || !username) {
    throw new Error('user_config.json missing name field')
  }

  const zoneConfig = readJson(path.join(rootDir, 'zone_config.json')) as BuckyOSZoneDocument
  const zoneDid = DID.fromStr(zoneConfig.id)

  const keyPair = resolveOwnerKeyPair(username, params.ownerKeyPair)
  const deviceKeyPair = resolveDeviceKeyPair(username, params.deviceName, params.deviceKeyPair)
  const nodeDir = path.join(rootDir, params.deviceName)
  const ownerDid = new DID('bns', username)

  // 1. device document (name-based device DID, signed by the OWNER key)
  const deviceDid = buildDeviceDid(params.deviceName, zoneDid)
  const deviceDoc = newDeviceDocumentByJwkWithDid(
    params.deviceName,
    createJwkByX(deviceKeyPair.publicKeyX),
    deviceDid,
    params.now,
  )
  deviceDoc.support_container = true
  delete (deviceDoc as Record<string, unknown>).support_container // true is the serde default and is skipped
  if (params.netId !== undefined) {
    deviceDoc.net_id = params.netId
  }
  deviceDoc.owner = ownerDid.toString()
  deviceDoc.zone_did = zoneDid.toString()
  console.log(`input net_id: ${params.netId}, device_config.net_id: ${deviceDoc.net_id}`)

  const deviceJwt = await encodeDeviceDocument(deviceDoc, keyPair.privateKeyPem)
  console.log(`${params.deviceName} device jwt: ${deviceJwt}`)

  const deviceMiniDoc = newDeviceMiniDocumentByDeviceDocument(deviceDoc)
  const deviceMiniJwt = await deviceMiniDocumentToJwt(deviceMiniDoc, keyPair.privateKeyPem)
  writeFileWithLog(path.join(nodeDir, 'device_mini_config.jwt'), deviceMiniJwt)

  // 2. node identity configuration (schema v2) + identity-roots layout:
  //    node_identity.json / node_gateway_params.json / did.json /
  //    device_doc.jwt / device_mini_doc.jwt / authentication.private.pem
  const identityConfig = newLocalNodeIdentityConfig({
    zoneDid,
    ownerDid,
    ownerPublicKey: createJwkByX(keyPair.publicKeyX),
    deviceName: params.deviceName,
    deviceDid,
    zoneIat: PROVISION_BASE_TIME,
  })
  const roots = nodeTestIdentityRoots(nodeDir)
  saveLocalDeviceIdentityForRoots(
    nodeDir,
    roots,
    identityConfig,
    deviceDoc,
    deviceJwt,
    deviceMiniJwt,
    deviceKeyPair.privateKeyPem,
  )

  // 3. startup configuration (only for OOD nodes); json!-literal -> sorted keys
  if (params.deviceName.startsWith('ood')) {
    const startConfig = sortKeysDeep({
      admin_password_hash: ADMIN_PASSWORD_HASH,
      device_private_key: deviceKeyPair.privateKeyPem,
      device_public_key: createJwkByX(deviceKeyPair.publicKeyX),
      ood_jwt: deviceJwt,
      friend_passcode: 'sdfsdfsdf',
      gateway_type: 'PortForward',
      guest_access: true,
      private_key: keyPair.privateKeyPem,
      public_key: createJwkByX(keyPair.publicKeyX),
      user_name: username,
      zone_name: zoneDid.toHostName(),
      BUCKYOS_ROOT: '/opt/buckyos',
    })
    writeJsonWithLog(path.join(nodeDir, 'start_config.json'), startConfig)
  }

  console.log(`Successfully created node configuration: ${username}.${params.deviceName}`)
  // return device self-signed JWT (for verification), mirroring Rust
  return encodeDeviceDocument(deviceDoc, deviceKeyPair.privateKeyPem)
}

// ============================================================================
// DevSnDb (T2.4, mirror DevSnDb in test_config.rs, node:sqlite)
// ============================================================================

export class DevSnDb {
  private readonly dbPath: string

  constructor(dbPath: string) {
    assertProvisionRuntime()
    this.dbPath = dbPath
  }

  private connect(): any {
    const { DatabaseSync } = requireNode('node:sqlite')
    return new DatabaseSync(this.dbPath)
  }

  // Schema is byte-for-byte the SQL used by Rust DevSnDb::initialize_database.
  initializeDatabase(): void {
    const db = this.connect()
    try {
      db.exec(
        `CREATE TABLE IF NOT EXISTS activation_codes (code TEXT PRIMARY KEY, used INTEGER);
             CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, state TEXT, public_key TEXT, activation_code TEXT, zone_config TEXT, self_cert boolean, user_domain TEXT, sn_ips TEXT);
             CREATE TABLE IF NOT EXISTS user_auth_v2 (username TEXT PRIMARY KEY, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, password_algo TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_login_at INTEGER NULL);
             CREATE TABLE IF NOT EXISTS devices (owner TEXT, device_name TEXT, did TEXT PRIMARY KEY, ip TEXT, description TEXT, mini_config_jwt TEXT, created_at INTEGER, updated_at INTEGER);
             CREATE TABLE IF NOT EXISTS user_dns_records (id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT, domain TEXT, record_type TEXT, record TEXT, ttl INTEGER, created_at INTEGER, updated_at INTEGER);
             CREATE UNIQUE INDEX IF NOT EXISTS idx_user_domain_record_type ON user_dns_records (owner, domain, record_type);
             CREATE INDEX IF NOT EXISTS user_dns_records_domain_index ON user_dns_records (domain, id);
             CREATE TABLE IF NOT EXISTS user_domain_history (domain TEXT PRIMARY KEY, owner TEXT NOT NULL, created_at INTEGER NOT NULL);
             CREATE TABLE IF NOT EXISTS did_documents (id INTEGER PRIMARY KEY AUTOINCREMENT, obj_id TEXT, owner_user TEXT, obj_name TEXT, did_document TEXT, doc_type TEXT, update_time INTEGER);
             CREATE INDEX IF NOT EXISTS idx_did_documents_owner_obj ON did_documents (owner_user, obj_name, update_time);`,
      )
    } finally {
      db.close()
    }
  }

  insertActivationCode(code: string): void {
    const db = this.connect()
    try {
      db.prepare('INSERT INTO activation_codes (code, used) VALUES (?, 0)').run(code)
    } finally {
      db.close()
    }
  }

  // Mirror register_user_directly: state="active", activation_code="DIRECT", self_cert=true.
  registerUserDirectly(username: string, publicKey: string, zoneConfig: string, userDomain?: string): void {
    const db = this.connect()
    try {
      db.prepare(
        'INSERT INTO users (username, state, public_key, activation_code, zone_config, user_domain, self_cert, sn_ips) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(username, 'active', publicKey, 'DIRECT', zoneConfig, userDomain ?? null, 1, null)
    } finally {
      db.close()
    }
  }

  registerDevice(
    username: string,
    deviceName: string,
    did: string,
    miniConfigJwt: string,
    ip: string,
    description: string,
  ): void {
    const now = buckyosGetUnixTimestamp()
    const db = this.connect()
    try {
      db.prepare(
        'INSERT INTO devices (owner, device_name, did, ip, description, mini_config_jwt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(username, deviceName, did, ip, description, miniConfigJwt, now, now)
    } finally {
      db.close()
    }
  }
}

// ============================================================================
// createSnConfigs (T2.5, mirror cmd_create_sn_configs / create_sn_config)
// ============================================================================

export interface CreateSnConfigsParams {
  outputDir: string
  snIp: string
  snBaseHost: string
}

export async function createSnConfigs(params: CreateSnConfigsParams): Promise<void> {
  assertProvisionRuntime()
  const path = requireNode('node:path')
  const snDir = path.join(params.outputDir, 'sn_server')
  const ownerKeys = getDevTestKeyPairById('sn_owner')
  const deviceKeys = getDevTestKeyPairById('sn_server')
  const exp = PROVISION_DEFAULT_EXP

  // owner config for sn admin under .buckycli
  writeFileWithLog(path.join(snDir, '.buckycli', 'user_private_key.pem'), ownerKeys.privateKeyPem)
  const ownerDoc = newOwnerDocument({
    did: new DID('bns', 'sn'),
    name: 'root',
    displayName: 'sn admin',
    publicKeyJwk: createJwkByX(ownerKeys.publicKeyX),
  })
  writeJsonWithLog(path.join(snDir, '.buckycli', 'user_config.json'), ownerDocumentToOrderedJson(ownerDoc))
  console.log('- Created owner config for sn admin.')

  // device JWT (zone/owner dids are fixed in the Rust implementation)
  const miniDoc = newDeviceMiniDocument({ name: 'sn', x: deviceKeys.publicKeyX, exp })
  const miniJwt = await deviceMiniDocumentToJwt(miniDoc, ownerKeys.privateKeyPem)

  const deviceDoc = newDeviceDocumentByMiniDocument(miniJwt, miniDoc, 'did:web:sn.devtests.org', 'did:bns:sn')
  deviceDoc.net_id = 'wan'
  writeJsonWithLog(path.join(snDir, 'sn_device_config.json'), deviceDocumentToOrderedJson(deviceDoc))
  writeFileWithLog(path.join(snDir, 'sn_private_key.pem'), deviceKeys.privateKeyPem)
  console.log('- Created sn device config & private key.')

  // ZoneBootDocument + params.json (json!-literal -> sorted keys)
  const zoneBoot = newZoneBootDocument({ oods: ['sn'], exp })
  const zoneBootJwt = await encodeZoneBootDocument(zoneBoot, ownerKeys.privateKeyPem)
  const paramsJson = sortKeysDeep({
    params: {
      sn_boot_jwt: zoneBootJwt,
      sn_owner_pk: ownerKeys.publicKeyX,
      sn_device_jwt: miniJwt,
      sn_host: params.snBaseHost,
      sn_ip: params.snIp,
      sn_cer: 'fullchain.cert',
      sn_pem: 'fullchain.pem',
      web3_cer: 'fullchain.cert',
      web3_pem: 'fullchain.pem',
    },
  })
  writeJsonWithLog(path.join(snDir, 'params.json'), paramsJson)
  console.log('- Created params.json.')

  // initial database with dev activation codes
  const db = new DevSnDb(path.join(snDir, 'sn_db.sqlite3'))
  db.initializeDatabase()
  for (let i = 0; i < 9; i++) {
    const code = `sndevtest${i}`
    console.log(`insert activation code: ${code}`)
    db.insertActivationCode(code)
  }
  console.log('- Created SN database.')
  console.log('Successfully created SN configuration')
}

// ============================================================================
// SN registration (mirror register_user_to_sn / register_device_to_sn)
// ============================================================================

export async function registerUserToSn(rootDir: string, userZoneId: string, snDbPath: string): Promise<void> {
  assertProvisionRuntime()
  const path = requireNode('node:path')
  const userConfig = readJson(path.join(rootDir, userZoneId, 'user_config.json'))
  const username: string = userConfig.name
  if (typeof username !== 'string' || !username) {
    throw new Error('user_config.json missing name field')
  }

  const zoneConfig = readJson(path.join(rootDir, userZoneId, 'zone_config.json')) as BuckyOSZoneDocument
  const zoneDid = DID.fromStr(zoneConfig.id)
  let userDomain: string | undefined
  if (zoneDid.method !== 'bns') {
    userDomain = zoneDid.toHostName()
  }

  const zoneRecord = readJson(path.join(rootDir, userZoneId, 'zone_txt_record.json')) as BuckyOSZoneTxtRecord

  const db = new DevSnDb(snDbPath)
  // Rust serializes the public key via json! (BTreeMap) -> sorted compact JSON.
  const publicKeyJson = JSON.stringify(sortKeysDeep({ kty: 'OKP', crv: 'Ed25519', x: zoneRecord.pkx }))
  db.registerUserDirectly(username, publicKeyJson, zoneRecord.boot_config_jwt, userDomain)
  console.log(`Successfully registered user ${username}@${userZoneId} to SN database at ${snDbPath}`)
}

function currentArch(): string {
  const arch = (globalThis as { process?: { arch?: string } }).process?.arch ?? ''
  if (arch === 'x64') return 'amd64'
  if (arch === 'arm64') return 'aarch64'
  return arch
}

function currentOsType(): string {
  const platform = (globalThis as { process?: { platform?: string } }).process?.platform ?? ''
  if (platform === 'darwin') return 'apple'
  if (platform === 'win32') return 'windows'
  return platform
}

function collectLocalIps(): string[] {
  const os = requireNode('node:os')
  const result: string[] = []
  const interfaces = os.networkInterfaces() as Record<string, Array<{ address: string; internal: boolean; family: string }>>
  for (const list of Object.values(interfaces)) {
    for (const item of list ?? []) {
      if (item.internal) continue
      if (item.family === 'IPv6' && item.address.startsWith('fe80')) continue
      if (!result.includes(item.address)) {
        result.push(item.address)
      }
    }
  }
  return result
}

export async function registerDeviceToSn(
  rootDir: string,
  userZoneId: string,
  deviceName: string,
  snDbPath: string,
): Promise<void> {
  assertProvisionRuntime()
  const path = requireNode('node:path')
  const fs = requireNode('node:fs')
  const os = requireNode('node:os')

  const deviceDir = path.join(rootDir, userZoneId, deviceName)
  const nodeIdentityPath = path.join(deviceDir, 'node_identity.json')
  if (!fs.existsSync(nodeIdentityPath)) {
    throw new Error(`Device config not found: ${nodeIdentityPath}`)
  }
  const nodeIdentity = loadLocalNodeIdentityConfig(nodeIdentityPath)
  const username = DID.fromStr(nodeIdentity.owner_did).id

  // read the device jwts from the identity-roots layout, verify the device
  // doc with the owner public key, then take its DID
  const identityPaths = deviceIdentityPathsForRoots(nodeTestIdentityRoots(deviceDir), nodeIdentity.device_did)
  const deviceDocJwt: string = fs.readFileSync(identityPaths.deviceDocJwt, 'utf8')
  const deviceMiniDocJwt: string = fs.readFileSync(identityPaths.deviceMiniDocJwt, 'utf8')
  const deviceDoc = await verifyJwtEdDSA(deviceDocJwt, nodeIdentity.owner_public_key as Ed25519Jwk)
  const deviceDid: string = deviceDoc.id

  // ood description from zone_config (fallback: parse the device name, or a
  // plain Device entry when even that fails — mirrors Rust)
  let oodDesc
  try {
    oodDesc = parseOODDescription(deviceName)
  } catch {
    oodDesc = { name: deviceName, nodeType: 'Device' as const }
  }
  try {
    const zoneConfig = readJson(path.join(rootDir, userZoneId, 'zone_config.json')) as BuckyOSZoneDocument
    const matched = zoneConfig.oods
      .map(parseOODDescription)
      .find(item => item.name === deviceName)
    if (matched) {
      oodDesc = matched
    }
  } catch {
    // keep fallback
  }

  // lightweight DeviceInfo (the Rust version fills detailed system info; the
  // description column is informational runtime data, not a strict format)
  const allIp = collectLocalIps()
  const baseDevice: Record<string, unknown> = {
    ...(deviceDoc as Record<string, unknown>),
  }
  if (oodDesc.ip) {
    baseDevice.ips = [oodDesc.ip]
  }
  if (oodDesc.netId !== undefined) {
    baseDevice.net_id = oodDesc.netId
  }
  const deviceInfo = {
    ...baseDevice,
    arch: currentArch(),
    os: currentOsType(),
    update_time: buckyosGetUnixTimestamp(),
    state: 'Ready',
    sys_hostname: os.hostname(),
    base_os_info: `${os.type()} ${os.release()}`,
    all_ip: allIp,
    cpu_num: os.cpus().length,
    total_mem: os.totalmem(),
    mem_usage: os.totalmem() - os.freemem(),
  }

  let deviceIp = '127.0.0.1'
  if (allIp.length > 0) {
    deviceIp = allIp[0]
  }
  if (oodDesc.ip) {
    deviceIp = oodDesc.ip
  }

  const db = new DevSnDb(snDbPath)
  db.registerDevice(
    username,
    deviceName,
    deviceDid,
    deviceMiniDocJwt,
    deviceIp,
    JSON.stringify(deviceInfo, null, 2),
  )
  console.log(`Successfully registered device ${username}.${deviceName} (DID: ${deviceDid}) to SN database at ${snDbPath}`)
}

// ============================================================================
// MetaIndexDb + setPkgMeta (T2.6, mirror package-lib meta_index_db.rs +
// buckycli package_cmd.rs set_pkg_meta)
// ============================================================================

export interface PackageMetaNode {
  metaJwt: string
  pkgName: string
  version: string
  tag?: string
  author: string
  authorPk: string
}

// Mirror of VersionExp::version_to_int: (major<<56)|(minor<<40)|(patch<<24)|build.
// Returns bigint because the result can exceed Number.MAX_SAFE_INTEGER.
export function versionToInt(version: string): bigint {
  const buildPos = version.search(/[-+]/)
  const versionCore = buildPos >= 0 ? version.slice(0, buildPos) : version
  const parts: string[] = versionCore.split('.')
  if (parts.length < 1 || parts.length > 4) {
    throw new Error(`invalid version format: ${version}`)
  }
  if (parts.length === 3 && buildPos >= 0) {
    parts.push(version.slice(buildPos))
  }

  const leadingDigits = (value: string | undefined): bigint => {
    if (value === undefined) return 0n
    const digitsOnly = value.replace(/^[^0-9]*/, '')
    const match = digitsOnly.match(/^\d+/)
    if (!match) return 0n
    return BigInt(match[0])
  }
  const parseNum = (value: string | undefined): bigint => {
    if (value === undefined) return 0n
    return /^\d+$/.test(value) ? BigInt(value) : 0n
  }

  const major = leadingDigits(parts[0])
  if (major > 0xffn) throw new Error(`major version out of range: ${version}`)
  const minor = parseNum(parts[1])
  if (minor > 0xffffn) throw new Error(`minor version out of range: ${version}`)
  const patch = parseNum(parts[2])
  if (patch > 0xffffn) throw new Error(`patch version out of range: ${version}`)
  const build = leadingDigits(parts[3])
  if (build > 0xffffffn) throw new Error(`build number out of range: ${version}`)

  return (major << 56n) | (minor << 40n) | (patch << 24n) | build
}

// Normalize a pkg_meta JSON the way Rust PackageMeta serde round-trips it
// before hashing (gen_obj_id): default-valued fields are dropped
// (skip_serializing_if), unknown fields are preserved via flatten.
export function normalizePackageMetaForObjId(meta: Record<string, any>): Record<string, any> {
  const normalized: Record<string, any> = { ...meta }
  const dropIf = (key: string, shouldDrop: (v: any) => boolean) => {
    if (key in normalized && shouldDrop(normalized[key])) {
      delete normalized[key]
    }
  }
  // BaseContentObject
  dropIf('did', v => v === null || v === undefined)
  dropIf('name', v => v === '')
  dropIf('author', v => v === '')
  dropIf('owner', v => v === null || v === undefined || v === 'did:undefined:undefined')
  dropIf('copyright', v => v === null || v === undefined)
  dropIf('tags', v => Array.isArray(v) && v.length === 0)
  dropIf('categories', v => Array.isArray(v) && v.length === 0)
  dropIf('base_on', v => v === null || v === undefined)
  dropIf('directory', v => v && typeof v === 'object' && Object.keys(v).length === 0)
  dropIf('references', v => v && typeof v === 'object' && Object.keys(v).length === 0)
  dropIf('exp', v => v === 0)
  // FileObject
  dropIf('size', v => v === 0)
  dropIf('content', v => v === '')
  // PackageMeta
  dropIf('version_tag', v => v === null || v === undefined)
  dropIf('deps', v => v && typeof v === 'object' && Object.keys(v).length === 0)
  return normalized
}

// Compute the meta object id exactly like Rust PackageMeta::gen_obj_id().
export function calcPkgMetaObjId(metaJson: Record<string, any>): string {
  const normalized = normalizePackageMetaForObjId(metaJson)
  const [objId] = buildNamedObjectByJson('pkg', normalized)
  return objId.toString()
}

export class MetaIndexDb {
  readonly dbPath: string

  constructor(dbPath: string) {
    assertProvisionRuntime()
    this.dbPath = dbPath
  }

  private connect(): any {
    const { DatabaseSync } = requireNode('node:sqlite')
    return new DatabaseSync(this.dbPath)
  }

  // Unlike make_config.py-era flows, the TS implementation always creates the
  // tables itself (schema identical to package-lib meta_index_db.rs).
  initializeDatabase(): void {
    const db = this.connect()
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS pkg_metas (
                metaobjid TEXT PRIMARY KEY,
                pkg_meta TEXT NOT NULL,
                author TEXT NOT NULL,
                author_pk TEXT NOT NULL,
                update_time INTEGER NOT NULL
            )`)
      db.exec(`CREATE TABLE IF NOT EXISTS pkg_versions (
                pkg_name TEXT NOT NULL,
                author TEXT ,
                version TEXT NOT NULL,
                version_int INTEGER NOT NULL,
                metaobjid TEXT NOT NULL,
                tag TEXT,
                update_time INTEGER NOT NULL,
                PRIMARY KEY (pkg_name, version)
            )`)
      db.exec(`CREATE TABLE IF NOT EXISTS author_info (
                author_name TEXT PRIMARY KEY,
                author_owner_config TEXT,
                author_zone_config TEXT
            )`)
      db.exec('CREATE INDEX IF NOT EXISTS idx_pkg_versions_pkgname ON pkg_versions (pkg_name)')
      db.exec('CREATE INDEX IF NOT EXISTS idx_pkg_metas_author ON pkg_metas (author)')
      db.exec('CREATE INDEX IF NOT EXISTS idx_pkg_versions_version_int ON pkg_versions (pkg_name, version_int)')
    } finally {
      db.close()
    }
  }

  // Mirror add_pkg_meta_batch: writes BOTH pkg_metas and pkg_versions in one
  // transaction (insert-or-replace meta, insert-or-update version row).
  addPkgMetaBatch(pkgMetaMap: Record<string, PackageMetaNode>): void {
    const db = this.connect()
    try {
      const currentTime = buckyosGetUnixTimestamp()
      db.exec('BEGIN')
      try {
        for (const [metaObjId, metaNode] of Object.entries(pkgMetaMap)) {
          db.prepare(
            'INSERT OR REPLACE INTO pkg_metas (metaobjid, pkg_meta, author, author_pk, update_time) VALUES (?, ?, ?, ?, ?)',
          ).run(metaObjId, metaNode.metaJwt, metaNode.author, metaNode.authorPk, currentTime)

          const versionInt = versionToInt(metaNode.version)
          const exists = db.prepare(
            'SELECT 1 FROM pkg_versions WHERE pkg_name = ? AND author = ? AND version = ?',
          ).get(metaNode.pkgName, metaNode.author, metaNode.version)

          if (exists) {
            db.prepare(
              'UPDATE pkg_versions SET metaobjid = ?, tag = ?, update_time = ? WHERE pkg_name = ? AND author = ? AND version = ?',
            ).run(metaObjId, metaNode.tag ?? null, currentTime, metaNode.pkgName, metaNode.author, metaNode.version)
          } else {
            db.prepare(
              'INSERT INTO pkg_versions (pkg_name, author, version, version_int, metaobjid, tag, update_time) VALUES (?, ?, ?, ?, ?, ?, ?)',
            ).run(metaNode.pkgName, metaNode.author, metaNode.version, versionInt, metaObjId, metaNode.tag ?? null, currentTime)
          }
        }
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    } finally {
      db.close()
    }
  }
}

// Mirror buckycli set_pkg_meta: parse the meta file, compute the obj id, then
// write pkg_metas + pkg_versions (the raw file content is stored as pkg_meta).
export async function setPkgMeta(metaPath: string, dbPath: string): Promise<string> {
  assertProvisionRuntime()
  const fs = requireNode('node:fs')
  if (!fs.existsSync(metaPath)) {
    throw new Error(`meta_path ${metaPath} does not exist`)
  }
  if (!fs.existsSync(dbPath)) {
    throw new Error(`db_path ${dbPath} does not exist`)
  }
  const metaContent: string = fs.readFileSync(metaPath, 'utf8')
  const metaJson = metaContent.trimStart().startsWith('{')
    ? JSON.parse(metaContent)
    : decodeJwtClaimWithoutVerify(metaContent.trim())

  const metaObjId = calcPkgMetaObjId(metaJson)
  const metaDb = new MetaIndexDb(dbPath)
  metaDb.initializeDatabase()
  metaDb.addPkgMetaBatch({
    [metaObjId]: {
      metaJwt: metaContent,
      pkgName: metaJson.name,
      version: metaJson.version,
      tag: metaJson.version_tag ?? undefined,
      author: metaJson.author,
      authorPk: '',
    },
  })
  return metaObjId
}

// ============================================================================
// buildDidDocs (T2.7, mirror gen_kernel_service_docs + build_did_docs)
// ============================================================================

interface KernelServiceTemplate {
  uniqueId: string
  showName: string
  description: string
  selectorType: 'random' | 'single'
}

// Templates copied from buckyos-api generate_*_service_doc().
const KERNEL_SERVICE_TEMPLATES: KernelServiceTemplate[] = [
  { uniqueId: 'verify-hub', showName: 'Verify Hub', description: 'Verify Hub', selectorType: 'random' },
  { uniqueId: 'scheduler', showName: 'Scheduler', description: 'Scheduler', selectorType: 'single' },
  { uniqueId: 'smb-service', showName: 'Samba Service', description: 'Samba Service', selectorType: 'random' },
  { uniqueId: 'msg-center', showName: 'Message Center', description: 'Message Center', selectorType: 'single' },
  { uniqueId: 'opendan', showName: 'OpenDAN Runtime', description: 'OpenDAN Runtime', selectorType: 'single' },
  { uniqueId: 'workflow', showName: 'Workflow Service', description: 'Workflow Service', selectorType: 'single' },
]

// Default mirrors the buckyos-api crate version that generates these docs.
export const KERNEL_SERVICE_DOC_VERSION = '0.7.0'

// Mirror PackageId::unique_name_to_did.
export function uniqueNameToDid(uniqueName: string): DID {
  const parts = uniqueName.split('_')
  if (parts.length === 2) {
    // did:bns:module_name.author
    return DID.fromStr(`did:bns:${parts[1]}.${parts[0]}`)
  }
  return DID.fromStr(`did:bns:${uniqueName}`)
}

export interface BuildDidDocsOptions {
  version?: string
  now?: number
}

export function buildDidDocs(outputDir: string, options?: BuildDidDocsOptions): string[] {
  assertProvisionRuntime()
  const path = requireNode('node:path')
  const version = options?.version ?? KERNEL_SERVICE_DOC_VERSION
  const now = options?.now ?? buckyosGetUnixTimestamp()
  const written: string[] = []

  for (const template of KERNEL_SERVICE_TEMPLATES) {
    const did = uniqueNameToDid(template.uniqueId)
    const doc = sortKeysDeep({
      name: template.uniqueId,
      show_name: template.showName,
      version,
      author: 'did:bns:buckyos',
      owner: 'did:bns:buckyos',
      create_time: now,
      last_update_time: now,
      description: { detail: { en: template.description } },
      categories: ['service'],
      selector_type: template.selectorType,
      install_config_tips: {
        data_mount_point: [],
        local_cache_mount_point: [],
        rdb_instances: {},
        service_ports: {},
      },
      pkg_list: {},
    })
    const filePath = path.join(outputDir, `${did.toRawHostName()}.doc.json`)
    writeJsonWithLog(filePath, doc)
    written.push(filePath)
  }
  return written
}
