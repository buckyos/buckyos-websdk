export type DID = string
export type JwkLike = Record<string, unknown>

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
  '@context': string
  id: DID
  verificationMethod: W3CVerificationMethod[]
  authentication: string[]
  assertionMethod?: string[]
  assertion_method?: string[]
  service?: W3CService[]
  exp: number
  iat: number
  [key: string]: unknown
}

export type W3CDIDDocument = W3CDIDDocumentBase

export interface BuckyOSOwnerConfigDocument extends W3CDIDDocumentBase {
  name: string
  full_name: string
  meta?: unknown
  default_zone_did?: DID
}

export interface BuckyOSDeviceMiniDocument {
  n: string
  x?: string
  p?: number
  exp?: number
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

export interface BuckyOSZoneDocument extends W3CDIDDocumentBase {
  hostname: string
  owner: DID
  oods: unknown[]
  boot_jwt: string
  devices?: Record<string, BuckyOSDeviceDocument>
  sn?: string
  docker_repo_base_url?: string
  verify_hub_info?: Record<string, unknown>
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

export function isW3CDIDDocumentBase(value: unknown): value is W3CDIDDocumentBase {
  if (!isRecord(value)) {
    return false
  }

  return typeof value['@context'] === 'string'
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
  return isRecord(value) && typeof value.n === 'string'
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
