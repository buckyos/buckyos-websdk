export type DID = string
export type JwkLike = Record<string, unknown>

// Mirrors Rust name-lib DIDContext: "@context" is either the DID core context
// string or an array starting with it (serde: string-or-array untagged enum).
export type DIDContext = string | string[]

// Ed25519 public key JWK, aligned with Rust jsonwebtoken::jwk::Jwk output.
export interface Ed25519Jwk {
  kty: string
  crv: string
  x: string
  [key: string]: unknown
}

export interface W3CVerificationMethod {
  type: string
  id: string
  controller: string
  publicKeyJwk: JwkLike
  [key: string]: unknown
}

export interface W3CService {
  id: string
  type: string
  serviceEndpoint: string
  [key: string]: unknown
}

// Mirrors Rust name-lib DidDocType (serialized form). Custom doc types are
// plain strings; `(string & {})` keeps literal completion without widening.
export type DidDocType =
  | 'zone'
  | 'owner'
  | 'info'
  | 'boot'
  | 'user'
  | 'device'
  | 'did-object'
  | 'agent'
  | (string & {})

export interface W3CDIDDocumentBase {
  '@context': DIDContext
  id: DID
  verificationMethod: W3CVerificationMethod[]
  authentication: string[]
  assertionMethod?: string[]
  assertion_method?: string[]
  capabilityInvocation?: string[]
  service?: W3CService[]
  exp: number
  iat: number
  version_seq?: number
  // Rust serde: rename "keyScope", deserialize alias "buckyos:scopes".
  keyScope?: Record<string, string[]>
  'buckyos:scopes'?: Record<string, string[]>
  [key: string]: unknown
}

export type W3CDIDDocument = W3CDIDDocumentBase

export interface OwnerWallet {
  type: string
  address: string
}

// Mirrors Rust name-lib OwnerDocument (user.rs).
// Breaking changes vs the old BuckyOSOwnerConfigDocument:
// - full_name -> display_name (Rust deserialize aliases: full_name, displayName)
// - default_zone_did -> binded_zone_list (the default zone is the first entry)
// - new optional avatar
export interface BuckyOSOwnerDocument extends W3CDIDDocumentBase {
  mini_version_seq?: number
  valid_iat?: number
  name: string
  display_name: string
  avatar?: string
  meta?: unknown
  zone_binding_model_version?: number
  binded_zone_list?: DID[]
  wallets?: Record<string, OwnerWallet>
}

// Mirrors Rust name-lib DeviceMiniDocument: {"n", "x", "p"?, "exp"}.
export interface BuckyOSDeviceMiniDocument {
  n: string
  x: string
  p?: number
  exp: number
  [key: string]: unknown
}

// Mirrors Rust name-lib DeviceDocument (device.rs).
// Breaking change: device_mini_config_jwt -> device_mini_document_jwt.
export interface BuckyOSDeviceDocument extends W3CDIDDocumentBase {
  zone_did?: DID
  owner: DID
  device_type: string
  device_mini_document_jwt?: string
  name: string
  rtcp_port?: number
  ips?: string[]
  net_id?: string
  ddns_sn_url?: string
  support_container?: boolean
  capbilities?: Record<string, number>
}

export interface BuckyOSAgentContactInfo {
  telegram?: string
  [key: string]: unknown
}

export interface BuckyOSAgentHttpServicePorts {
  send_msg?: number
  [key: string]: unknown
}

export interface BuckyOSAgentDocument extends W3CDIDDocumentBase {
  support_public_access: boolean
  contact: BuckyOSAgentContactInfo
  owner: DID
  eth_address?: string
  public_description?: string
  httpServicePorts: BuckyOSAgentHttpServicePorts
}

export interface BuckyOSVerifyHubInfo {
  public_key: Ed25519Jwk
}

// Mirrors Rust name-lib ZoneDocument (zone.rs).
// Breaking changes vs the old shape:
// - docker_repo_base_url / verify_hub_info moved to the buckyos-api
//   BuckyOSZoneConfig wrapper (see below)
// - new mini_device_jwts map (device name -> device mini doc jwt)
export interface BuckyOSZoneDocument extends W3CDIDDocumentBase {
  hostname: string
  owner: DID
  // OOD description strings, e.g. "ood1", "ood1@wan", "ood1:192.168.1.2@lan1"
  oods: string[]
  boot_jwt: string
  mini_device_jwts?: Record<string, string>
  devices?: Record<string, BuckyOSDeviceDocument>
  sn?: string
}

// Mirrors Rust buckyos-api ZoneConfig (system_config.rs): the value stored in
// system_config, wrapping the zone document string (jwt or json-ld) plus the
// zone runtime settings that were removed from ZoneDocument.
export interface BuckyOSZoneConfig {
  zone_document: string
  docker_repo_base_url?: string
  verify_hub_info?: BuckyOSVerifyHubInfo
}

// Mirrors Rust name-lib ZoneBootDocument (the payload stored in the zone DNS
// TXT record / boot JWT). owner_key is stored separately in TXT records.
export interface BuckyOSZoneBootDocument {
  id?: DID
  oods: string[]
  sn?: string
  exp: number
  owner?: DID
  owner_key?: Ed25519Jwk
  [key: string]: unknown
}

// Mirrors Rust name-lib DIDObjectCard (did_object_card.rs).
export const DID_OBJECT_SERVICE_TYPE = 'DIDObjectService'
export const DID_OBJECT_SERVICE_ID = '#did-object'

export interface BuckyOSDIDObjectService {
  id: string
  type: string
  serviceEndpoint: string
  profile: string
  kind?: string
  [key: string]: unknown
}

export interface BuckyOSDIDObjectCard {
  '@context': DIDContext
  id: DID
  alsoKnownAs?: string[]
  controller?: DID
  verificationMethod?: W3CVerificationMethod[]
  authentication?: string[]
  assertionMethod?: string[]
  capabilityInvocation?: string[]
  service?: BuckyOSDIDObjectService[]
  exp?: number
  iat?: number
  version_seq?: number
  keyScope?: Record<string, string[]>
  [key: string]: unknown
}

// Mirrors Rust name-lib NodeIdentityConfig (lib.rs). Legacy v1 shape kept for
// reading old node_identity.json files; new deployments use
// BuckyOSLocalNodeIdentityConfig (schema v2).
export interface BuckyOSNodeIdentityConfig {
  zone_did: DID
  owner_public_key: Ed25519Jwk
  owner_did: DID
  device_doc_jwt: string
  device_mini_doc_jwt: string
  zone_iat: number
}

// Mirrors Rust buckyos-api LocalNodeIdentityConfig (device_identity.rs).
// The device jwts / private key now live in the identity-roots layout and are
// no longer embedded in node_identity.json.
export const NODE_IDENTITY_SCHEMA_V2 = 'buckyos.node_identity.v2'

export interface BuckyOSLocalNodeIdentityConfig {
  schema: string
  zone_did: DID
  owner_did: DID
  owner_public_key: Ed25519Jwk
  device_name: string
  device_did: DID
  zone_iat: number
}

// Mirrors Rust buckyos-api ZoneTxtRecord (zone_txt_record.json).
export interface BuckyOSZoneTxtRecord {
  boot_config_jwt: string
  device_mini_doc_jwt: string
  pkx: string
}

export type BuckyOSDIDDocument =
  | BuckyOSOwnerDocument
  | BuckyOSAgentDocument
  | BuckyOSDeviceDocument
  | BuckyOSZoneDocument
  | BuckyOSDIDObjectCard

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isVerificationMethodArray(value: unknown): value is W3CVerificationMethod[] {
  return Array.isArray(value)
}

function isServiceArray(value: unknown): value is W3CService[] {
  return value === undefined || Array.isArray(value)
}

function isDIDContext(value: unknown): value is DIDContext {
  if (typeof value === 'string') {
    return true
  }
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

export function isW3CDIDDocumentBase(value: unknown): value is W3CDIDDocumentBase {
  if (!isRecord(value)) {
    return false
  }

  return isDIDContext(value['@context'])
    && typeof value.id === 'string'
    && isVerificationMethodArray(value.verificationMethod)
    && Array.isArray(value.authentication)
    && typeof value.exp === 'number'
    && typeof value.iat === 'number'
    && isServiceArray(value.service)
}

// Shape check mirrors Rust parse_did_doc owner routing:
// verificationMethod + name + (display_name | displayName | full_name).
export function isBuckyOSOwnerDocument(value: unknown): value is BuckyOSOwnerDocument {
  return isW3CDIDDocumentBase(value)
    && typeof value.name === 'string'
    && (typeof value.display_name === 'string'
      || typeof value.displayName === 'string'
      || typeof value.full_name === 'string')
}

export function isBuckyOSDeviceMiniDocument(value: unknown): value is BuckyOSDeviceMiniDocument {
  return isRecord(value)
    && typeof value.n === 'string'
    && typeof value.x === 'string'
    && typeof value.exp === 'number'
}

export function isBuckyOSZoneBootDocument(value: unknown): value is BuckyOSZoneBootDocument {
  return isRecord(value)
    && Array.isArray(value.oods)
    && value.oods.every(item => typeof item === 'string')
    && typeof value.exp === 'number'
}

// Legacy v1 node_identity.json (embedded jwts).
export function isBuckyOSNodeIdentityConfig(value: unknown): value is BuckyOSNodeIdentityConfig {
  return isRecord(value)
    && typeof value.zone_did === 'string'
    && isRecord(value.owner_public_key)
    && typeof value.owner_did === 'string'
    && typeof value.device_doc_jwt === 'string'
    && typeof value.device_mini_doc_jwt === 'string'
    && typeof value.zone_iat === 'number'
}

export function isBuckyOSLocalNodeIdentityConfig(value: unknown): value is BuckyOSLocalNodeIdentityConfig {
  return isRecord(value)
    && value.schema === NODE_IDENTITY_SCHEMA_V2
    && typeof value.zone_did === 'string'
    && typeof value.owner_did === 'string'
    && isRecord(value.owner_public_key)
    && typeof value.device_name === 'string'
    && typeof value.device_did === 'string'
    && typeof value.zone_iat === 'number'
}

export function isBuckyOSDeviceDocument(value: unknown): value is BuckyOSDeviceDocument {
  return isW3CDIDDocumentBase(value)
    && typeof value.owner === 'string'
    && typeof value.device_type === 'string'
    && typeof value.name === 'string'
}

export function isBuckyOSAgentDocument(value: unknown): value is BuckyOSAgentDocument {
  return isW3CDIDDocumentBase(value)
    && typeof value.owner === 'string'
    && isRecord(value.httpServicePorts)
}

export function isBuckyOSZoneDocument(value: unknown): value is BuckyOSZoneDocument {
  return isW3CDIDDocumentBase(value)
    && typeof value.hostname === 'string'
    && typeof value.owner === 'string'
    && Array.isArray(value.oods)
    && typeof value.boot_jwt === 'string'
}

// Shape check mirrors Rust parse_did_doc DID Object Card routing: at least one
// service entry of type DID_OBJECT_SERVICE_TYPE.
export function isBuckyOSDIDObjectCard(value: unknown): value is BuckyOSDIDObjectCard {
  if (!isRecord(value) || !isDIDContext(value['@context']) || typeof value.id !== 'string') {
    return false
  }
  const services = value.service
  return Array.isArray(services)
    && services.some(service => isRecord(service) && service.type === DID_OBJECT_SERVICE_TYPE)
}

export function isBuckyOSZoneConfig(value: unknown): value is BuckyOSZoneConfig {
  return isRecord(value) && typeof value.zone_document === 'string'
}

export function parseW3CDIDDocumentBase(value: unknown): W3CDIDDocumentBase | null {
  return isW3CDIDDocumentBase(value) ? value : null
}

export function parseBuckyOSOwnerDocument(value: unknown): BuckyOSOwnerDocument | null {
  return isBuckyOSOwnerDocument(value) ? value : null
}

export function parseBuckyOSDeviceMiniDocument(value: unknown): BuckyOSDeviceMiniDocument | null {
  return isBuckyOSDeviceMiniDocument(value) ? value : null
}

// Mirrors Rust parse_did_doc routing order (did.rs): owner -> agent -> device
// -> zone -> did-object card.
export function parseBuckyOSDIDDocument(value: unknown): BuckyOSDIDDocument | null {
  if (isBuckyOSOwnerDocument(value)) {
    return value
  }
  if (isBuckyOSAgentDocument(value)) {
    return value
  }
  if (isBuckyOSDeviceDocument(value)) {
    return value
  }
  if (isBuckyOSZoneDocument(value)) {
    return value
  }
  if (isBuckyOSDIDObjectCard(value)) {
    return value
  }
  return null
}

export function getDidMethod(did: DID): string | null {
  if (typeof did !== 'string' || !did.startsWith('did:')) {
    return null
  }

  const parts = did.split(':')
  return parts.length >= 3 ? parts[1] : null
}

export function getDidIdentifier(did: DID): string | null {
  if (typeof did !== 'string' || !did.startsWith('did:')) {
    return null
  }

  const parts = did.split(':')
  return parts.length >= 3 ? parts.slice(2).join(':') : null
}
