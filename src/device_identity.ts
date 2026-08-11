// device_identity: node-only TypeScript mirror of
// buckyos/src/kernel/buckyos-api/src/device_identity.rs.
//
// Since node_identity schema v2 ("buckyos.node_identity.v2"):
// - node_identity.json only carries identity METADATA (device_name/device_did),
//   no longer the device jwts themselves
// - the device document json/jwts and the device private key live in the
//   identity-roots layout (see cert.ts IdentityRoots):
//     <publicRoot>/<device raw host name>/did.json
//     <publicRoot>/<device raw host name>/device_doc.jwt
//     <publicRoot>/<device raw host name>/device_mini_doc.jwt
//     <securityRoot>/<device raw host name>/authentication.private.pem
// - device DIDs are name-based (did:bns:ood1.alice / did:web:ood1.example.com)
//   instead of key-based did:dev DIDs
//
// Never import this module from a browser bundle.

import { IdentityRoots } from './cert'
import {
  DID,
  decodeJwtClaimWithoutVerify,
  deviceDocumentToOrderedJson,
  newDeviceDocumentByJwk,
  verifyJwtEdDSA,
} from './namelib'
import {
  BuckyOSDeviceDocument,
  BuckyOSLocalNodeIdentityConfig,
  Ed25519Jwk,
  NODE_IDENTITY_SCHEMA_V2,
  DID as DIDString,
} from './types'

export { NODE_IDENTITY_SCHEMA_V2 } from './types'
export type { BuckyOSLocalNodeIdentityConfig } from './types'

export const DEVICE_DOC_JWT_FILE_NAME = 'device_doc.jwt'
export const DEVICE_MINI_DOC_JWT_FILE_NAME = 'device_mini_doc.jwt'
export const NODE_GATEWAY_PARAMS_FILE_NAME = 'node_gateway_params.json'

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
  throw new Error(`buckyos device_identity cannot load builtin module ${moduleName} in this runtime`)
}

function asDid(value: DID | DIDString): DID {
  return value instanceof DID ? value : DID.fromStr(value)
}

// serde_json::to_string_pretty equivalent: 2-space indent, no trailing newline.
function writeJsonPretty(filePath: string, value: unknown): void {
  const fs = requireNode('node:fs')
  const path = requireNode('node:path')
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2))
}

export interface NewLocalNodeIdentityConfigParams {
  zoneDid: DID | DIDString
  ownerDid: DID | DIDString
  ownerPublicKey: Ed25519Jwk
  deviceName: string
  deviceDid: DID | DIDString
  zoneIat: number
}

// Mirrors Rust LocalNodeIdentityConfig::new (field order follows the struct).
export function newLocalNodeIdentityConfig(params: NewLocalNodeIdentityConfigParams): BuckyOSLocalNodeIdentityConfig {
  return {
    schema: NODE_IDENTITY_SCHEMA_V2,
    zone_did: asDid(params.zoneDid).toString(),
    owner_did: asDid(params.ownerDid).toString(),
    owner_public_key: params.ownerPublicKey,
    device_name: params.deviceName,
    device_did: asDid(params.deviceDid).toString(),
    zone_iat: params.zoneIat,
  }
}

// Mirrors Rust load_local_node_identity_config: rejects non-v2 schemas.
export function loadLocalNodeIdentityConfig(filePath: string): BuckyOSLocalNodeIdentityConfig {
  const fs = requireNode('node:fs')
  const config = JSON.parse(fs.readFileSync(filePath, 'utf8')) as BuckyOSLocalNodeIdentityConfig
  if (config.schema !== NODE_IDENTITY_SCHEMA_V2) {
    throw new Error(
      `unsupported node_identity schema '${config.schema}', expected '${NODE_IDENTITY_SCHEMA_V2}'`,
    )
  }
  return config
}

export interface DeviceIdentityPaths {
  publicDir: string
  securityDir: string
  didJson: string
  deviceDocJwt: string
  deviceMiniDocJwt: string
  authenticationPrivateKey: string
}

// Mirrors Rust device_identity_paths_for_roots.
export function deviceIdentityPathsForRoots(roots: IdentityRoots, deviceDid: DID | DIDString): DeviceIdentityPaths {
  const path = requireNode('node:path')
  const deviceDidStr = asDid(deviceDid).toString()
  const publicDir = roots.publicDir(deviceDidStr)
  return {
    publicDir,
    securityDir: roots.securityDir(deviceDidStr),
    didJson: roots.publicFile(deviceDidStr, 'authentication', 'did-json'),
    deviceDocJwt: path.join(publicDir, DEVICE_DOC_JWT_FILE_NAME),
    deviceMiniDocJwt: path.join(publicDir, DEVICE_MINI_DOC_JWT_FILE_NAME),
    authenticationPrivateKey: roots.securityFile(deviceDidStr, 'authentication', 'private'),
  }
}

// Mirrors Rust build_device_did: the device DID reuses the zone DID method and
// prefixes the device name onto the zone name, e.g.
//   ("ood1", did:bns:alice)            -> did:bns:ood1.alice
//   ("ood1", did:web:test.buckyos.io)  -> did:web:ood1.test.buckyos.io
export function buildDeviceDid(deviceName: string, zoneDid: DID | DIDString): DID {
  const trimmedName = deviceName.trim()
  if (!trimmedName) {
    throw new Error('device name is empty')
  }
  const zone = asDid(zoneDid)
  const zoneName = zone.method === 'web'
    ? zone.toRawHostName()
    : (zone.id.split(':')[0] ?? zone.id)
  if (!zoneName.trim()) {
    throw new Error(`zone DID ${zone.toString()} has empty host/name`)
  }
  return new DID(zone.method, `${trimmedName}.${zoneName}`)
}

// Mirrors Rust bind_device_config_did: rebind the document id and every
// verification method controller onto the given device DID.
export function bindDeviceDocumentDid(deviceDoc: BuckyOSDeviceDocument, deviceDid: DID | DIDString): BuckyOSDeviceDocument {
  const deviceDidStr = asDid(deviceDid).toString()
  deviceDoc.id = deviceDidStr
  if (!Array.isArray(deviceDoc.verificationMethod)) {
    throw new Error('device document verificationMethod is missing')
  }
  for (const method of deviceDoc.verificationMethod) {
    method.controller = deviceDidStr
  }
  return deviceDoc
}

// Mirrors Rust new_device_config_by_jwk_with_did.
export function newDeviceDocumentByJwkWithDid(
  name: string,
  publicKeyJwk: Ed25519Jwk,
  deviceDid: DID | DIDString,
  now?: number,
): BuckyOSDeviceDocument {
  return bindDeviceDocumentDid(newDeviceDocumentByJwk(name, publicKeyJwk, now), deviceDid)
}

export function loadDeviceDocJwtForRoots(roots: IdentityRoots, deviceDid: DID | DIDString): string {
  const fs = requireNode('node:fs')
  return fs.readFileSync(deviceIdentityPathsForRoots(roots, deviceDid).deviceDocJwt, 'utf8')
}

export function loadDeviceMiniDocJwtForRoots(roots: IdentityRoots, deviceDid: DID | DIDString): string {
  const fs = requireNode('node:fs')
  return fs.readFileSync(deviceIdentityPathsForRoots(roots, deviceDid).deviceMiniDocJwt, 'utf8')
}

// Mirrors Rust load_local_device_config: read device_doc.jwt from the identity
// roots, optionally verify it against the owner public key, and check that the
// document id matches node_identity.device_did.
export async function loadLocalDeviceDocumentForRoots(
  roots: IdentityRoots,
  nodeIdentity: BuckyOSLocalNodeIdentityConfig,
  verify: boolean,
): Promise<[string, BuckyOSDeviceDocument]> {
  const deviceDocJwt = loadDeviceDocJwtForRoots(roots, nodeIdentity.device_did)
  const deviceDoc = verify
    ? ((await verifyJwtEdDSA(deviceDocJwt, nodeIdentity.owner_public_key)) as BuckyOSDeviceDocument)
    : decodeDeviceDocumentWithoutVerify(deviceDocJwt)
  if (deviceDoc.id !== nodeIdentity.device_did) {
    throw new Error(
      `device_doc.jwt id ${deviceDoc.id} does not match node_identity device_did ${nodeIdentity.device_did}`,
    )
  }
  return [deviceDocJwt, deviceDoc]
}

// Mirrors Rust save_node_gateway_params.
export function saveNodeGatewayParams(etcDir: string, deviceDid: DID | DIDString): void {
  const path = requireNode('node:path')
  writeJsonPretty(path.join(etcDir, NODE_GATEWAY_PARAMS_FILE_NAME), {
    params: {
      device_did: asDid(deviceDid).toString(),
    },
  })
}

// Mirrors Rust save_local_device_identity_for_roots: writes
//   <etcDir>/node_identity.json          (LocalNodeIdentityConfig v2)
//   <etcDir>/node_gateway_params.json
//   <publicDir>/did.json                 (device document, serde field order)
//   <publicDir>/device_doc.jwt
//   <publicDir>/device_mini_doc.jwt
//   <securityDir>/authentication.private.pem
export function saveLocalDeviceIdentityForRoots(
  etcDir: string,
  roots: IdentityRoots,
  nodeIdentity: BuckyOSLocalNodeIdentityConfig,
  deviceDoc: BuckyOSDeviceDocument,
  deviceDocJwt: string,
  deviceMiniDocJwt: string,
  devicePrivateKeyPem: string,
): DeviceIdentityPaths {
  const fs = requireNode('node:fs')
  const path = requireNode('node:path')
  const paths = deviceIdentityPathsForRoots(roots, nodeIdentity.device_did)
  fs.mkdirSync(paths.publicDir, { recursive: true })
  fs.mkdirSync(paths.securityDir, { recursive: true })

  writeJsonPretty(path.join(etcDir, 'node_identity.json'), nodeIdentity)
  saveNodeGatewayParams(etcDir, nodeIdentity.device_did)
  writeJsonPretty(paths.didJson, deviceDocumentToOrderedJson(deviceDoc))
  fs.writeFileSync(paths.deviceDocJwt, deviceDocJwt)
  fs.writeFileSync(paths.deviceMiniDocJwt, deviceMiniDocJwt)
  fs.writeFileSync(paths.authenticationPrivateKey, devicePrivateKeyPem)
  return paths
}

// Mirrors Rust decode_device_config_without_verify.
export function decodeDeviceDocumentWithoutVerify(deviceDocJwt: string): BuckyOSDeviceDocument {
  return decodeJwtClaimWithoutVerify(deviceDocJwt) as BuckyOSDeviceDocument
}
