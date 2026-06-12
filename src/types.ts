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
  keyScope?: Record<string, string[]>
  [key: string]: unknown
}

export type W3CDIDDocument = W3CDIDDocumentBase

export interface OwnerWallet {
  type: string
  address: string
}

export interface BuckyOSOwnerConfigDocument extends W3CDIDDocumentBase {
  name: string
  full_name: string
  meta?: unknown
  default_zone_did?: DID
  mini_version_seq?: number
  valid_iat?: number
  wallets?: Record<string, OwnerWallet>
}

// Mirrors Rust name-lib DeviceMiniConfig: {"n", "x", "p"?, "exp"}.
export interface BuckyOSDeviceMiniDocument {
  n: string
  x: string
  p?: number
  exp: number
  [key: string]: unknown
}

export interface BuckyOSDeviceDocument extends W3CDIDDocumentBase {
  zone_did?: DID
  owner: DID
  device_type: string
  device_mini_config_jwt?: string
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

export interface BuckyOSZoneDocument extends W3CDIDDocumentBase {
  hostname: string
  owner: DID
  // OOD description strings, e.g. "ood1", "ood1@wan", "ood1:192.168.1.2@lan1"
  oods: string[]
  boot_jwt: string
  devices?: Record<string, BuckyOSDeviceDocument>
  sn?: string
  docker_repo_base_url?: string
  verify_hub_info?: BuckyOSVerifyHubInfo
}

// Mirrors Rust name-lib ZoneBootConfig (the payload stored in the zone DNS
// TXT record / boot JWT). owner_key is stored separately in TXT records.
export interface BuckyOSZoneBootConfig {
  id?: DID
  oods: string[]
  sn?: string
  exp: number
  owner?: DID
  owner_key?: Ed25519Jwk
  [key: string]: unknown
}

// Mirrors Rust name-lib NodeIdentityConfig (node_identity.json).
export interface BuckyOSNodeIdentityConfig {
  zone_did: DID
  owner_public_key: Ed25519Jwk
  owner_did: DID
  device_doc_jwt: string
  device_mini_doc_jwt: string
  zone_iat: number
}

// Mirrors Rust buckyos-api ZoneTxtRecord (zone_txt_record.json).
export interface BuckyOSZoneTxtRecord {
  boot_config_jwt: string
  device_mini_doc_jwt: string
  pkx: string
}

export type BuckyOSDIDDocument =
  | BuckyOSOwnerConfigDocument
  | BuckyOSAgentDocument
  | BuckyOSDeviceDocument
  | BuckyOSZoneDocument

// Backward-compatible aliases for existing callers.
export type VerificationMethodNode = W3CVerificationMethod
export type ServiceNode = W3CService
export type DIDDocumentBase = W3CDIDDocumentBase
export type OwnerConfigDocument = BuckyOSOwnerConfigDocument
export type UserDocument = BuckyOSOwnerConfigDocument
export type DeviceMiniConfig = BuckyOSDeviceMiniDocument
export type DeviceDocument = BuckyOSDeviceDocument
export type AgentContactInfo = BuckyOSAgentContactInfo
export type AgentHttpServicePorts = BuckyOSAgentHttpServicePorts
export type AgentDocument = BuckyOSAgentDocument
export type ZoneDocument = BuckyOSZoneDocument

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

export function isBuckyOSOwnerConfigDocument(value: unknown): value is BuckyOSOwnerConfigDocument {
  return isW3CDIDDocumentBase(value)
    && typeof value.name === 'string'
    && typeof value.full_name === 'string'
}

export function isUserDocument(value: unknown): value is UserDocument {
  return isBuckyOSOwnerConfigDocument(value)
}

export function isBuckyOSDeviceMiniDocument(value: unknown): value is BuckyOSDeviceMiniDocument {
  return isRecord(value)
    && typeof value.n === 'string'
    && typeof value.x === 'string'
    && typeof value.exp === 'number'
}

export function isBuckyOSZoneBootConfig(value: unknown): value is BuckyOSZoneBootConfig {
  return isRecord(value)
    && Array.isArray(value.oods)
    && value.oods.every(item => typeof item === 'string')
    && typeof value.exp === 'number'
}

export function isBuckyOSNodeIdentityConfig(value: unknown): value is BuckyOSNodeIdentityConfig {
  return isRecord(value)
    && typeof value.zone_did === 'string'
    && isRecord(value.owner_public_key)
    && typeof value.owner_did === 'string'
    && typeof value.device_doc_jwt === 'string'
    && typeof value.device_mini_doc_jwt === 'string'
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

export function isDIDDocumentBase(value: unknown): value is DIDDocumentBase {
  return isW3CDIDDocumentBase(value)
}

export function isOwnerConfigDocument(value: unknown): value is OwnerConfigDocument {
  return isBuckyOSOwnerConfigDocument(value)
}

export function isDeviceMiniConfig(value: unknown): value is DeviceMiniConfig {
  return isBuckyOSDeviceMiniDocument(value)
}

export function isDeviceDocument(value: unknown): value is DeviceDocument {
  return isBuckyOSDeviceDocument(value)
}

export function isAgentDocument(value: unknown): value is AgentDocument {
  return isBuckyOSAgentDocument(value)
}

export function isZoneDocument(value: unknown): value is ZoneDocument {
  return isBuckyOSZoneDocument(value)
}

export function parseW3CDIDDocumentBase(value: unknown): W3CDIDDocumentBase | null {
  return isW3CDIDDocumentBase(value) ? value : null
}

export function parseBuckyOSOwnerConfigDocument(value: unknown): BuckyOSOwnerConfigDocument | null {
  return isBuckyOSOwnerConfigDocument(value) ? value : null
}

export function parseOwnerConfigDocument(value: unknown): OwnerConfigDocument | null {
  return parseBuckyOSOwnerConfigDocument(value)
}

export function parseBuckyOSDeviceMiniDocument(value: unknown): BuckyOSDeviceMiniDocument | null {
  return isBuckyOSDeviceMiniDocument(value) ? value : null
}

export function parseDeviceMiniConfig(value: unknown): DeviceMiniConfig | null {
  return parseBuckyOSDeviceMiniDocument(value)
}

export function parseBuckyOSDIDDocument(value: unknown): BuckyOSDIDDocument | null {
  if (isBuckyOSOwnerConfigDocument(value)) {
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
