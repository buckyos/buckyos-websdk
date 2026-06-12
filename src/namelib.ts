// namelib: TypeScript mirror of buckyos-base/src/name-lib (identity documents,
// DID, Ed25519 keys and EdDSA JWT encode/decode).
//
// Format hard constraints (must stay aligned with the Rust implementation):
// - Keys: Ed25519. Private key is PKCS8 PEM, public key is JWK
//   {"kty":"OKP","crv":"Ed25519","x":"<base64url 32B, no padding>"}
// - JWT: header is {"alg":"EdDSA"} (typ omitted, see Rust `header.typ = None`),
//   base64url without padding. Device documents are signed by the OWNER key.
// - JSON field names/values follow Rust serde output; payload objects are built
//   in Rust struct declaration order so that JWTs are byte-identical for the
//   same key + payload (Ed25519 signatures are deterministic).
//
// This module is universal (browser + node): node:crypto is loaded lazily and
// WebCrypto is used when the node runtime is unavailable.

import {
  BuckyOSDeviceDocument,
  BuckyOSDeviceMiniDocument,
  BuckyOSNodeIdentityConfig,
  BuckyOSOwnerConfigDocument,
  BuckyOSZoneBootConfig,
  BuckyOSZoneDocument,
  DIDContext,
  Ed25519Jwk,
  DID as DIDString,
} from './types'

export const DID_CORE_CONTEXT = 'https://www.w3.org/ns/did/v1'
export const BUCKYOS_CONTEXT_BASE = 'https://buckyos.org/ns'
export const DID_DOC_AUTHKEY = '#auth-key'
// Mirrors Rust name-lib DEFAULT_EXPIRE_TIME (5 years).
export const DEFAULT_EXPIRE_TIME = 3600 * 24 * 365 * 5
const DEFAULT_DOC_EXPIRE_TIME = 3600 * 24 * 365 * 10

export function buckyosContext(docType: string): DIDContext {
  return [DID_CORE_CONTEXT, `${BUCKYOS_CONTEXT_BASE}/${docType}/v1`]
}

export function buckyosGetUnixTimestamp(): number {
  return Math.floor(Date.now() / 1000)
}

// ============================================================================
// base64url helpers (browser-safe, no Buffer dependency)
// ============================================================================

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function bytesToBase64(bytes: Uint8Array): string {
  let result = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0
    result += BASE64_CHARS[b0 >> 2]
    result += BASE64_CHARS[((b0 & 0x03) << 4) | (b1 >> 4)]
    result += i + 1 < bytes.length ? BASE64_CHARS[((b1 & 0x0f) << 2) | (b2 >> 6)] : '='
    result += i + 2 < bytes.length ? BASE64_CHARS[b2 & 0x3f] : '='
  }
  return result
}

function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '')
  const length = Math.floor((clean.length * 3) / 4)
  const bytes = new Uint8Array(length)
  let byteIndex = 0
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = BASE64_CHARS.indexOf(clean[i])
    const c1 = BASE64_CHARS.indexOf(clean[i + 1])
    const c2 = i + 2 < clean.length ? BASE64_CHARS.indexOf(clean[i + 2]) : -1
    const c3 = i + 3 < clean.length ? BASE64_CHARS.indexOf(clean[i + 3]) : -1
    bytes[byteIndex++] = (c0 << 2) | (c1 >> 4)
    if (c2 >= 0) {
      bytes[byteIndex++] = ((c1 & 0x0f) << 4) | (c2 >> 2)
    }
    if (c3 >= 0) {
      bytes[byteIndex++] = ((c2 & 0x03) << 6) | c3
    }
  }
  return bytes.subarray(0, byteIndex)
}

export function base64UrlEncodeBytes(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function base64UrlDecodeToBytes(value: string): Uint8Array {
  return base64ToBytes(value.replace(/-/g, '+').replace(/_/g, '/'))
}

function utf8Encode(value: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value)
  }
  const bytes: number[] = []
  for (let i = 0; i < value.length; i++) {
    let code = value.codePointAt(i)!
    if (code > 0xffff) {
      i++
    }
    if (code < 0x80) {
      bytes.push(code)
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      )
    }
  }
  return new Uint8Array(bytes)
}

function utf8Decode(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder().decode(bytes)
  }
  let result = ''
  for (let i = 0; i < bytes.length;) {
    const b0 = bytes[i]
    if (b0 < 0x80) {
      result += String.fromCharCode(b0)
      i += 1
    } else if (b0 < 0xe0) {
      result += String.fromCharCode(((b0 & 0x1f) << 6) | (bytes[i + 1] & 0x3f))
      i += 2
    } else if (b0 < 0xf0) {
      result += String.fromCharCode(((b0 & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f))
      i += 3
    } else {
      const code = ((b0 & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f)
      result += String.fromCodePoint(code)
      i += 4
    }
  }
  return result
}

export function base64UrlEncodeString(value: string): string {
  return base64UrlEncodeBytes(utf8Encode(value))
}

export function base64UrlDecodeToString(value: string): string {
  return utf8Decode(base64UrlDecodeToBytes(value))
}

// ============================================================================
// crypto runtime (node:crypto preferred, WebCrypto fallback)
// ============================================================================

function hasNodeRuntime(): boolean {
  const runtimeProcess = (globalThis as { process?: { versions?: { node?: string } } }).process
  return Boolean(runtimeProcess?.versions?.node)
}

async function importNodeModule(moduleName: string): Promise<any> {
  if (typeof require === 'function') {
    return require(moduleName)
  }
  const dynamicImport = Function('name', 'return import(name)')
  return dynamicImport(moduleName) as Promise<any>
}

async function getNodeCrypto(): Promise<any | null> {
  if (!hasNodeRuntime()) {
    return null
  }
  try {
    return await importNodeModule('node:crypto')
  } catch {
    return null
  }
}

function getSubtleCrypto(): SubtleCrypto {
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle
  if (!subtle) {
    throw new Error('namelib: no crypto backend available (need node:crypto or WebCrypto with Ed25519 support)')
  }
  return subtle
}

const PKCS8_PEM_HEADER = '-----BEGIN PRIVATE KEY-----'
const PKCS8_PEM_FOOTER = '-----END PRIVATE KEY-----'
// SPKI DER prefix for an Ed25519 public key (RFC 8410), followed by the raw 32-byte key.
const ED25519_SPKI_PREFIX = new Uint8Array([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
])

export function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '')
  return base64ToBytes(body)
}

export function derToPkcs8Pem(der: Uint8Array): string {
  const base64 = bytesToBase64(der)
  const lines: string[] = []
  for (let i = 0; i < base64.length; i += 64) {
    lines.push(base64.slice(i, i + 64))
  }
  return `${PKCS8_PEM_HEADER}\n${lines.join('\n')}\n${PKCS8_PEM_FOOTER}\n`
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length + b.length)
  result.set(a, 0)
  result.set(b, a.length)
  return result
}

function ed25519JwkToSpkiDer(jwk: Ed25519Jwk): Uint8Array {
  const x = base64UrlDecodeToBytes(jwk.x)
  if (x.length !== 32) {
    throw new Error(`namelib: invalid Ed25519 jwk, x must be 32 bytes, got ${x.length}`)
  }
  return concatBytes(ED25519_SPKI_PREFIX, x)
}

async function ed25519Sign(data: Uint8Array, privateKeyPem: string): Promise<Uint8Array> {
  const nodeCrypto = await getNodeCrypto()
  if (nodeCrypto) {
    const key = nodeCrypto.createPrivateKey({ key: privateKeyPem, format: 'pem' })
    return new Uint8Array(nodeCrypto.sign(null, data, key))
  }
  const subtle = getSubtleCrypto()
  const der = pemToDer(privateKeyPem)
  const key = await subtle.importKey('pkcs8', der as unknown as ArrayBuffer, { name: 'Ed25519' } as Algorithm, false, ['sign'])
  const signature = await subtle.sign({ name: 'Ed25519' } as Algorithm, key, data as unknown as ArrayBuffer)
  return new Uint8Array(signature)
}

async function ed25519Verify(data: Uint8Array, signature: Uint8Array, publicKeyJwk: Ed25519Jwk): Promise<boolean> {
  const nodeCrypto = await getNodeCrypto()
  if (nodeCrypto) {
    const key = nodeCrypto.createPublicKey({
      key: { kty: publicKeyJwk.kty, crv: publicKeyJwk.crv, x: publicKeyJwk.x },
      format: 'jwk',
    })
    return nodeCrypto.verify(null, data, key, signature)
  }
  const subtle = getSubtleCrypto()
  const der = ed25519JwkToSpkiDer(publicKeyJwk)
  const key = await subtle.importKey('spki', der as unknown as ArrayBuffer, { name: 'Ed25519' } as Algorithm, false, ['verify'])
  return subtle.verify({ name: 'Ed25519' } as Algorithm, key, signature as unknown as ArrayBuffer, data as unknown as ArrayBuffer)
}

export interface Ed25519KeyPair {
  privateKeyPem: string
  publicKeyJwk: Ed25519Jwk
}

// Mirrors Rust name-lib generate_ed25519_key_pair():
// returns (PKCS8 PEM private key, {"kty","crv","x"} public JWK).
export async function generateEd25519KeyPair(): Promise<Ed25519KeyPair> {
  const nodeCrypto = await getNodeCrypto()
  if (nodeCrypto) {
    const { privateKey, publicKey } = nodeCrypto.generateKeyPairSync('ed25519')
    const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    const jwk = publicKey.export({ format: 'jwk' }) as { x: string }
    return { privateKeyPem, publicKeyJwk: createJwkByX(jwk.x) }
  }
  const subtle = getSubtleCrypto()
  const keyPair = (await subtle.generateKey({ name: 'Ed25519' } as Algorithm, true, ['sign', 'verify'])) as CryptoKeyPair
  const pkcs8 = new Uint8Array(await subtle.exportKey('pkcs8', keyPair.privateKey))
  const jwk = (await subtle.exportKey('jwk', keyPair.publicKey)) as { x?: string }
  if (!jwk.x) {
    throw new Error('namelib: WebCrypto did not return Ed25519 public jwk')
  }
  return { privateKeyPem: derToPkcs8Pem(pkcs8), publicKeyJwk: createJwkByX(jwk.x) }
}

// Derive the public key x value from an Ed25519 PKCS8 PEM private key.
export async function getPublicKeyXFromPrivatePem(privateKeyPem: string): Promise<string> {
  const nodeCrypto = await getNodeCrypto()
  if (nodeCrypto) {
    const privateKey = nodeCrypto.createPrivateKey({ key: privateKeyPem, format: 'pem' })
    const publicKey = nodeCrypto.createPublicKey(privateKey)
    const jwk = publicKey.export({ format: 'jwk' }) as { x: string }
    return jwk.x
  }
  const subtle = getSubtleCrypto()
  const der = pemToDer(privateKeyPem)
  const key = await subtle.importKey('pkcs8', der as unknown as ArrayBuffer, { name: 'Ed25519' } as Algorithm, true, ['sign'])
  const jwk = (await subtle.exportKey('jwk', key)) as { x?: string }
  if (!jwk.x) {
    throw new Error('namelib: cannot derive public key from private pem')
  }
  return jwk.x
}

// ============================================================================
// JWK helpers (mirror utility.rs)
// ============================================================================

export function getXFromJwk(jwk: Ed25519Jwk | Record<string, unknown>): string {
  const x = (jwk as Record<string, unknown>).x
  if (typeof x !== 'string' || x.length === 0) {
    throw new Error('namelib: invalid jwk, missing x')
  }
  return x
}

export function createJwkByX(x: string): Ed25519Jwk {
  return { kty: 'OKP', crv: 'Ed25519', x }
}

export function getDeviceDidFromJwk(jwk: Ed25519Jwk | Record<string, unknown>): string {
  return `did:dev:${getXFromJwk(jwk)}`
}

// ============================================================================
// JWT encode/decode (EdDSA / Ed25519)
// ============================================================================

// Sign a JWT the way Rust name-lib does: header {"alg":"EdDSA"} with typ
// omitted, payload serialized with JSON.stringify (callers must build the
// payload object in Rust struct field order to get byte-identical JWTs).
export async function signJwtEdDSA(payload: unknown, privateKeyPem: string, header?: Record<string, unknown>): Promise<string> {
  const headerJson = JSON.stringify(header ?? { alg: 'EdDSA' })
  const signingInput = `${base64UrlEncodeString(headerJson)}.${base64UrlEncodeString(JSON.stringify(payload))}`
  const signature = await ed25519Sign(utf8Encode(signingInput), privateKeyPem)
  return `${signingInput}.${base64UrlEncodeBytes(signature)}`
}

// Mirrors Rust decode_jwt_claim_without_verify.
export function decodeJwtClaimWithoutVerify(jwt: string): any {
  const parts = jwt.split('.')
  if (parts.length !== 3) {
    throw new Error('namelib: invalid jwt, parts.len != 3')
  }
  return JSON.parse(base64UrlDecodeToString(parts[1]))
}

export function decodeJwtHeaderWithoutVerify(jwt: string): any {
  const parts = jwt.split('.')
  if (parts.length !== 3) {
    throw new Error('namelib: invalid jwt, parts.len != 3')
  }
  return JSON.parse(base64UrlDecodeToString(parts[0]))
}

// Verify the EdDSA signature with the given public JWK and return the decoded
// claims. Mirrors Rust decode_json_from_jwt_with_default_pk (aud not checked).
export async function verifyJwtEdDSA(jwt: string, publicKeyJwk: Ed25519Jwk): Promise<any> {
  const parts = jwt.split('.')
  if (parts.length !== 3) {
    throw new Error('namelib: invalid jwt, parts.len != 3')
  }
  const header = JSON.parse(base64UrlDecodeToString(parts[0]))
  if (header.alg !== 'EdDSA') {
    throw new Error(`namelib: unsupported jwt alg: ${header.alg}`)
  }
  const signingInput = `${parts[0]}.${parts[1]}`
  const ok = await ed25519Verify(utf8Encode(signingInput), base64UrlDecodeToBytes(parts[2]), publicKeyJwk)
  if (!ok) {
    throw new Error('namelib: jwt signature verify failed')
  }
  return JSON.parse(base64UrlDecodeToString(parts[1]))
}

// Mirrors Rust EncodedDocument: a did document is either a JSON-LD value or a JWT string.
export type EncodedDocument =
  | { type: 'json'; value: any }
  | { type: 'jwt'; jwt: string }

export function encodedDocumentFromStr(docStr: string): EncodedDocument {
  if (docStr.startsWith('{') || docStr.startsWith('[')) {
    return { type: 'json', value: JSON.parse(docStr) }
  }
  return { type: 'jwt', jwt: docStr }
}

export function encodedDocumentToJsonValue(doc: EncodedDocument): any {
  if (doc.type === 'jwt') {
    return decodeJwtClaimWithoutVerify(doc.jwt)
  }
  return doc.value
}

export function encodedDocumentToString(doc: EncodedDocument): string {
  if (doc.type === 'jwt') {
    return doc.jwt
  }
  return JSON.stringify(doc.value)
}

// ============================================================================
// DID (mirror did.rs)
// ============================================================================

let knownWeb3BridgeConfig: Record<string, string> | null = null

// Mirrors Rust KNOWN_WEB3_BRIDGE_CONFIG (OnceCell semantics: first set wins).
export function setKnownWeb3BridgeConfig(config: Record<string, string>): boolean {
  if (knownWeb3BridgeConfig !== null) {
    return false
  }
  knownWeb3BridgeConfig = { ...config }
  return true
}

export function getKnownWeb3BridgeConfig(): Record<string, string> | null {
  return knownWeb3BridgeConfig
}

// Test-only escape hatch; Rust OnceCell cannot be reset, production code must not use this.
export function resetKnownWeb3BridgeConfigForTest(): void {
  knownWeb3BridgeConfig = null
}

export class DID {
  method: string
  id: string

  constructor(method: string, id: string) {
    this.method = method
    this.id = id
  }

  static undefined(): DID {
    return new DID('undefined', 'undefined')
  }

  isUndefined(): boolean {
    return this.method === 'undefined'
  }

  isValid(): boolean {
    return this.method !== 'undefined'
  }

  static isDid(did: string): boolean {
    return did.startsWith('did:')
  }

  static fromStr(did: string): DID {
    const parts = did.split(':')
    if (parts[0] !== 'did') {
      // this is a host name
      const result = DID.fromHostName(did)
      if (result) {
        return result
      }
      throw new Error(`namelib: invalid did ${did}`)
    }
    return new DID(parts[1], parts.slice(2).join(':'))
  }

  static fromHostName(hostName: string): DID | null {
    if (hostName.endsWith('.did')) {
      const parts = hostName.split('.')
      if (parts.length === 3) {
        return new DID(parts[1], parts[0])
      }
    }

    if (knownWeb3BridgeConfig) {
      for (const method of Object.keys(knownWeb3BridgeConfig)) {
        const bridgeBaseHostname = knownWeb3BridgeConfig[method]
        if (hostName.endsWith(bridgeBaseHostname)) {
          if (hostName === bridgeBaseHostname) {
            break
          }
          const id = hostName.slice(0, hostName.length - bridgeBaseHostname.length - 1)
          return new DID(method, id)
        }
      }
    }

    return new DID('web', hostName)
  }

  static fromHostNameByBridge(hostName: string, method: string, bridgeBaseHostname: string): DID {
    if (hostName.endsWith(bridgeBaseHostname) && hostName !== bridgeBaseHostname) {
      const id = hostName.slice(0, hostName.length - bridgeBaseHostname.length - 1)
      return new DID(method, id)
    }

    if (hostName.endsWith('.did')) {
      const parts = hostName.split('.')
      if (parts.length === 3) {
        return new DID(parts[1], parts[0])
      }
    }

    return new DID('web', hostName)
  }

  toString(): DIDString {
    return `did:${this.method}:${this.id}`
  }

  getPathFromId(): string | null {
    const parts = this.id.split(':')
    if (parts.length > 1) {
      return parts.slice(1).join('/')
    }
    return null
  }

  // For did:dev the id is the base64url Ed25519 public key.
  getEd25519AuthKey(): Uint8Array | null {
    if (this.method === 'dev') {
      return base64UrlDecodeToBytes(this.id)
    }
    return null
  }

  getAuthKeyJwk(): Ed25519Jwk | null {
    if (this.method === 'dev') {
      return createJwkByX(this.id)
    }
    return null
  }

  toRawHostName(): string {
    const realId = this.id.split(':')[0]
    if (this.method === 'web') {
      return realId
    }
    return `${realId}.${this.method}.did`
  }

  toHostNameByBridge(bridgeBaseHostname: string): string {
    const realId = this.id.split(':')[0]
    if (this.method === 'web') {
      return realId
    }
    return `${realId}.${bridgeBaseHostname}`
  }

  toHostName(): string {
    const realId = this.id.split(':')[0]
    if (this.method === 'web') {
      return realId
    }

    if (knownWeb3BridgeConfig) {
      const bridgeBaseHostname = knownWeb3BridgeConfig[this.method]
      if (bridgeBaseHostname) {
        return `${realId}.${bridgeBaseHostname}`
      }
    }
    return `${realId}.${this.method}.did`
  }

  toHostUri(): string {
    const hostname = this.toHostName()
    const path = this.getPathFromId()
    return path ? `${hostname}/${path}` : hostname
  }

  equals(other: DID): boolean {
    return this.method === other.method && this.id === other.id
  }
}

// ============================================================================
// OODDescriptionString (mirror zone.rs)
// ============================================================================

export type DeviceNodeType = 'OOD' | 'Gateway' | 'OODOnly' | 'Server' | 'Device' | 'Sensor' | 'IoTController'

export interface OODDescription {
  name: string
  nodeType: DeviceNodeType
  netId?: string
  ip?: string
}

// Parses "ood1" | "#gw1" | "$ood1" | "ood1:192.168.1.8@lan" | "ood1@wan" ...
export function parseOODDescription(s: string): OODDescription {
  let nodeType: DeviceNodeType = 'OOD'
  let rest = s
  if (s.startsWith('#')) {
    nodeType = 'Gateway'
    rest = s.slice(1)
  } else if (s.startsWith('$')) {
    nodeType = 'OODOnly'
    rest = s.slice(1)
  }

  let netId: string | undefined
  const atIndex = rest.lastIndexOf('@')
  let beforeNetId = rest
  if (atIndex >= 0) {
    beforeNetId = rest.slice(0, atIndex)
    netId = rest.slice(atIndex + 1)
  }

  let ip: string | undefined
  let name = beforeNetId
  const colonIndex = beforeNetId.indexOf(':')
  if (colonIndex >= 0) {
    name = beforeNetId.slice(0, colonIndex)
    ip = beforeNetId.slice(colonIndex + 1)
    if (!isValidIpAddress(ip)) {
      throw new Error(`namelib: invalid ip addr: ${ip}`)
    }
  }

  // If IP is present but net_id is not, automatically set to wan
  if (ip !== undefined && netId === undefined) {
    netId = 'wan'
  }

  if (!name) {
    throw new Error('namelib: name in OODDescriptionString is empty')
  }

  return pruneUndefined({ name, nodeType, netId, ip })
}

export function oodDescriptionToString(desc: OODDescription): string {
  let result: string
  switch (desc.nodeType) {
    case 'OOD':
      result = desc.name
      break
    case 'Gateway':
      result = `#${desc.name}`
      break
    case 'OODOnly':
      result = `$${desc.name}`
      break
    default:
      throw new Error('namelib: node type is not allow in oods')
  }

  if (desc.ip !== undefined) {
    result += `:${desc.ip}`
    if (desc.netId !== undefined && desc.netId !== 'wan') {
      result += `@${desc.netId}`
    }
    return result
  }

  if (desc.netId !== undefined) {
    result += `@${desc.netId}`
  }
  return result
}

export function oodNodeTypeIsOod(nodeType: DeviceNodeType): boolean {
  return nodeType === 'OOD' || nodeType === 'OODOnly'
}

export function oodNodeTypeIsGateway(nodeType: DeviceNodeType): boolean {
  return nodeType === 'Gateway' || nodeType === 'OOD'
}

function isValidIpAddress(value: string): boolean {
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
  const match = value.match(ipv4)
  if (match) {
    return match.slice(1).every(part => Number(part) <= 255)
  }
  // permissive IPv6 check
  return /^[0-9a-fA-F:]+$/.test(value) && value.includes(':')
}

// ============================================================================
// document constructors (mirror user.rs / zone.rs / device.rs)
// ============================================================================

function pruneUndefined<T extends Record<string, any>>(obj: T): T {
  for (const key of Object.keys(obj)) {
    if (obj[key] === undefined) {
      delete obj[key]
    }
  }
  return obj
}

function asDid(value: DID | DIDString): DID {
  return value instanceof DID ? value : DID.fromStr(value)
}

export interface NewOwnerConfigParams {
  did: DID | DIDString
  name: string
  fullName: string
  publicKeyJwk: Ed25519Jwk
  now?: number
}

// Mirrors Rust OwnerConfig::new. Field insertion order follows the Rust struct
// so the serialized JSON / JWT payload is byte-compatible.
export function newOwnerConfig(params: NewOwnerConfigParams): BuckyOSOwnerConfigDocument {
  const did = asDid(params.did)
  const now = params.now ?? buckyosGetUnixTimestamp()
  const didStr = did.toString()
  return {
    '@context': buckyosContext('owner'),
    id: didStr,
    verificationMethod: [
      {
        type: 'Ed25519VerificationKey2020',
        id: '#main_key',
        controller: didStr,
        publicKeyJwk: params.publicKeyJwk,
      },
    ],
    authentication: ['#main_key'],
    assertion_method: ['#main_key'],
    capabilityInvocation: ['#main_key'],
    exp: now + DEFAULT_DOC_EXPIRE_TIME,
    iat: now,
    version_seq: 0,
    name: params.name,
    full_name: params.fullName,
  }
}

// Mirrors Rust OwnerConfig::set_default_zone_did.
export function setOwnerDefaultZoneDid(ownerConfig: BuckyOSOwnerConfigDocument, defaultZoneDid: DID | DIDString): void {
  const zoneDid = asDid(defaultZoneDid)
  ownerConfig.default_zone_did = zoneDid.toString()
  const services = (ownerConfig.service ?? []) as Array<Record<string, unknown>>
  services.push({
    id: `${ownerConfig.id}#lastDoc`,
    type: 'DIDDoc',
    serviceEndpoint: `https://${zoneDid.toHostName()}/resolve/${ownerConfig.id}`,
  })
  ownerConfig.service = services as BuckyOSOwnerConfigDocument['service']
}

export interface NewZoneConfigParams {
  id: DID | DIDString
  ownerDid: DID | DIDString
  publicKeyJwk: Ed25519Jwk
  now?: number
}

// Mirrors Rust ZoneConfig::new.
export function newZoneConfig(params: NewZoneConfigParams): BuckyOSZoneDocument {
  const id = asDid(params.id)
  const ownerDid = asDid(params.ownerDid)
  const now = params.now ?? buckyosGetUnixTimestamp()
  const idStr = id.toString()
  return {
    '@context': buckyosContext('zone'),
    id: idStr,
    verificationMethod: [
      {
        type: 'Ed25519VerificationKey2020',
        id: '#main_key',
        controller: ownerDid.toString(),
        publicKeyJwk: params.publicKeyJwk,
      },
    ],
    authentication: ['#main_key'],
    assertionMethod: ['#main_key'],
    capabilityInvocation: ['#main_key'],
    service: [
      {
        id: `${idStr}#lastDoc`,
        type: 'DIDDoc',
        serviceEndpoint: `https://${id.toHostName()}/resolve/this_zone`,
      },
    ],
    exp: now + DEFAULT_DOC_EXPIRE_TIME,
    iat: now,
    version_seq: 0,
    hostname: id.toHostName(),
    owner: ownerDid.toString(),
    oods: [],
    boot_jwt: '',
  }
}

// Mirrors Rust ZoneConfig::init_by_boot_config.
export function zoneConfigInitByBootConfig(
  zoneConfig: BuckyOSZoneDocument,
  bootConfig: BuckyOSZoneBootConfig,
  bootJwt: string,
): void {
  zoneConfig.boot_jwt = bootJwt
  zoneConfig.id = bootConfig.id ?? zoneConfig.id
  zoneConfig.oods = [...bootConfig.oods]
  if (bootConfig.sn !== undefined) {
    zoneConfig.sn = bootConfig.sn
  } else {
    delete zoneConfig.sn
  }
  zoneConfig.exp = bootConfig.exp
  zoneConfig.iat = bootConfig.exp - DEFAULT_EXPIRE_TIME
  zoneConfig.version_seq = 0
  zoneConfig.owner = bootConfig.owner ?? DID.undefined().toString()
  if (bootConfig.owner_key !== undefined) {
    zoneConfig.verificationMethod[0].publicKeyJwk = bootConfig.owner_key
  }
}

export interface NewZoneBootConfigParams {
  id?: DID | DIDString
  oods: string[]
  sn?: string
  exp: number
  owner?: DID | DIDString
  ownerKey?: Ed25519Jwk
}

export function newZoneBootConfig(params: NewZoneBootConfigParams): BuckyOSZoneBootConfig {
  return pruneUndefined({
    id: params.id !== undefined ? asDid(params.id).toString() : undefined,
    oods: [...params.oods],
    sn: params.sn,
    exp: params.exp,
    owner: params.owner !== undefined ? asDid(params.owner).toString() : undefined,
    owner_key: params.ownerKey,
  })
}

// Mirrors Rust ZoneBootConfig::encode: sign the boot config as an EdDSA JWT.
// Payload key order: id?, oods, sn?, exp, owner?, owner_key?.
export async function encodeZoneBootConfig(bootConfig: BuckyOSZoneBootConfig, ownerPrivateKeyPem: string): Promise<string> {
  const { id, oods, sn, exp, owner, owner_key, ...extra } = bootConfig
  const payload = pruneUndefined({ id, oods, sn, exp, owner, ...extra, owner_key })
  return signJwtEdDSA(payload, ownerPrivateKeyPem)
}

export async function decodeZoneBootConfig(jwt: string, publicKeyJwk?: Ed25519Jwk): Promise<BuckyOSZoneBootConfig> {
  const payload = publicKeyJwk ? await verifyJwtEdDSA(jwt, publicKeyJwk) : decodeJwtClaimWithoutVerify(jwt)
  return payload as BuckyOSZoneBootConfig
}

// Mirrors Rust ZoneBootConfig::to_zone_config.
export function zoneBootConfigToZoneConfig(bootConfig: BuckyOSZoneBootConfig, bootJwt: string): BuckyOSZoneDocument {
  if (!bootConfig.id || !bootConfig.owner_key) {
    throw new Error('namelib: zone boot config needs id and owner_key to build zone config')
  }
  const ownerDid = bootConfig.owner ? DID.fromStr(bootConfig.owner) : DID.undefined()
  const zoneConfig = newZoneConfig({
    id: bootConfig.id,
    ownerDid,
    publicKeyJwk: bootConfig.owner_key,
  })
  zoneConfigInitByBootConfig(zoneConfig, bootConfig, bootJwt)
  return zoneConfig
}

export interface NewDeviceConfigParams {
  name: string
  // base64url Ed25519 public key (the "x" of the device JWK)
  pkx: string
  now?: number
}

// Mirrors Rust DeviceConfig::new.
export function newDeviceConfig(params: NewDeviceConfigParams): BuckyOSDeviceDocument {
  const now = params.now ?? buckyosGetUnixTimestamp()
  const did = `did:dev:${params.pkx}`
  return {
    '@context': buckyosContext('device'),
    id: did,
    verificationMethod: [
      {
        type: 'Ed25519VerificationKey2020',
        id: '#main_key',
        controller: did,
        publicKeyJwk: createJwkByX(params.pkx),
      },
    ],
    authentication: ['#main_key'],
    assertion_method: ['#main_key'],
    capabilityInvocation: ['#main_key'],
    exp: now + DEFAULT_EXPIRE_TIME,
    iat: now,
    version_seq: 0,
    owner: DID.undefined().toString(),
    device_type: 'ood',
    name: params.name,
  }
}

// Mirrors Rust DeviceConfig::new_by_jwk.
export function newDeviceConfigByJwk(name: string, publicKeyJwk: Ed25519Jwk, now?: number): BuckyOSDeviceDocument {
  return newDeviceConfig({ name, pkx: getXFromJwk(publicKeyJwk), now })
}

// Mirrors Rust DeviceConfig::new_by_mini_config.
export function newDeviceConfigByMiniConfig(
  miniConfigJwt: string,
  miniConfig: BuckyOSDeviceMiniDocument,
  zoneDid: DID | DIDString,
  ownerDid: DID | DIDString,
): BuckyOSDeviceDocument {
  const did = `did:dev:${miniConfig.x}`
  const config: BuckyOSDeviceDocument = {
    '@context': buckyosContext('device'),
    id: did,
    verificationMethod: [
      {
        type: 'Ed25519VerificationKey2020',
        id: '#main_key',
        controller: did,
        publicKeyJwk: createJwkByX(miniConfig.x),
      },
    ],
    authentication: ['#main_key'],
    assertion_method: ['#main_key'],
    capabilityInvocation: ['#main_key'],
    exp: miniConfig.exp,
    iat: miniConfig.exp - DEFAULT_EXPIRE_TIME,
    version_seq: 0,
    zone_did: asDid(zoneDid).toString(),
    owner: asDid(ownerDid).toString(),
    device_type: 'ood',
    device_mini_config_jwt: miniConfigJwt,
    name: miniConfig.n,
  }
  if (miniConfig.p !== undefined) {
    config.rtcp_port = miniConfig.p
  }
  return config
}

// Serialize a DeviceConfig payload in Rust struct order and sign it.
// NOTE: device documents are signed by the OWNER private key, not the device key.
export async function encodeDeviceConfig(deviceConfig: BuckyOSDeviceDocument, ownerPrivateKeyPem: string): Promise<string> {
  if (deviceConfig.version_seq === undefined) {
    throw new Error('namelib: DeviceConfig version_seq is required when encoding as JWT')
  }
  return signJwtEdDSA(deviceConfigPayload(deviceConfig), ownerPrivateKeyPem)
}

// Rebuild the payload in Rust DeviceConfig serde order, applying the same
// skip_serializing_if rules (support_container is skipped when true).
function deviceConfigPayload(config: BuckyOSDeviceDocument): Record<string, unknown> {
  const {
    '@context': context, id, verificationMethod, authentication,
    assertion_method, capabilityInvocation, service, exp, iat, version_seq, keyScope,
    zone_did, owner, device_type, device_mini_config_jwt, name, rtcp_port,
    ips, net_id, ddns_sn_url, support_container, capbilities, ...extra
  } = config as Record<string, any>
  return pruneUndefined({
    '@context': context,
    id,
    verificationMethod,
    authentication,
    assertion_method: assertion_method && assertion_method.length > 0 ? assertion_method : undefined,
    capabilityInvocation: capabilityInvocation && capabilityInvocation.length > 0 ? capabilityInvocation : undefined,
    service: service && service.length > 0 ? service : undefined,
    exp,
    iat,
    version_seq,
    ...extra,
    keyScope: keyScope && Object.keys(keyScope).length > 0 ? keyScope : undefined,
    zone_did,
    owner,
    device_type,
    device_mini_config_jwt,
    name,
    rtcp_port,
    ips: ips && ips.length > 0 ? ips : undefined,
    net_id,
    ddns_sn_url,
    support_container: support_container === false ? false : undefined,
    capbilities: capbilities && Object.keys(capbilities).length > 0 ? capbilities : undefined,
  })
}

export async function decodeDeviceConfig(jwt: string, publicKeyJwk?: Ed25519Jwk): Promise<BuckyOSDeviceDocument> {
  const payload = publicKeyJwk ? await verifyJwtEdDSA(jwt, publicKeyJwk) : decodeJwtClaimWithoutVerify(jwt)
  if (payload.version_seq === undefined) {
    throw new Error('namelib: DeviceConfig version_seq is required when decoding from JWT')
  }
  return payload as BuckyOSDeviceDocument
}

export interface NewDeviceMiniConfigParams {
  name: string
  x: string
  rtcpPort?: number
  exp: number
}

export function newDeviceMiniConfig(params: NewDeviceMiniConfigParams): BuckyOSDeviceMiniDocument {
  return pruneUndefined({
    n: params.name,
    x: params.x,
    p: params.rtcpPort,
    exp: params.exp,
  })
}

// Mirrors Rust DeviceMiniConfig::new_by_device_config.
export function newDeviceMiniConfigByDeviceConfig(deviceConfig: BuckyOSDeviceDocument): BuckyOSDeviceMiniDocument {
  const defaultKey = deviceConfig.verificationMethod.find(method => method.id === '#main_key')
  if (!defaultKey) {
    throw new Error('namelib: device config has no #main_key verification method')
  }
  return newDeviceMiniConfig({
    name: deviceConfig.name,
    x: getXFromJwk(defaultKey.publicKeyJwk),
    rtcpPort: deviceConfig.rtcp_port,
    exp: deviceConfig.exp,
  })
}

// Mirrors Rust DeviceMiniConfig::to_jwt (signed by owner key).
// Payload key order: n, x, p?, exp.
export async function deviceMiniConfigToJwt(miniConfig: BuckyOSDeviceMiniDocument, ownerPrivateKeyPem: string): Promise<string> {
  const { n, x, p, exp, ...extra } = miniConfig
  const payload = pruneUndefined({ n, x, p, exp, ...extra })
  return signJwtEdDSA(payload, ownerPrivateKeyPem)
}

export async function deviceMiniConfigFromJwt(jwt: string, publicKeyJwk?: Ed25519Jwk): Promise<BuckyOSDeviceMiniDocument> {
  const payload = publicKeyJwk ? await verifyJwtEdDSA(jwt, publicKeyJwk) : decodeJwtClaimWithoutVerify(jwt)
  return payload as BuckyOSDeviceMiniDocument
}

export interface NewNodeIdentityConfigParams {
  zoneDid: DID | DIDString
  ownerPublicKey: Ed25519Jwk
  ownerDid: DID | DIDString
  deviceDocJwt: string
  deviceMiniDocJwt: string
  zoneIat: number
}

// Mirrors Rust NodeIdentityConfig (field order follows the Rust struct).
export function newNodeIdentityConfig(params: NewNodeIdentityConfigParams): BuckyOSNodeIdentityConfig {
  return {
    zone_did: asDid(params.zoneDid).toString(),
    owner_public_key: params.ownerPublicKey,
    owner_did: asDid(params.ownerDid).toString(),
    device_doc_jwt: params.deviceDocJwt,
    device_mini_doc_jwt: params.deviceMiniDocJwt,
    zone_iat: params.zoneIat,
  }
}

// Serialize an OwnerConfig payload in Rust struct order and sign it.
export async function encodeOwnerConfig(ownerConfig: BuckyOSOwnerConfigDocument, privateKeyPem: string): Promise<string> {
  if (ownerConfig.version_seq === undefined) {
    throw new Error('namelib: OwnerConfig version_seq is required when encoding as JWT')
  }
  return signJwtEdDSA(ownerConfigPayload(ownerConfig), privateKeyPem)
}

function ownerConfigPayload(config: BuckyOSOwnerConfigDocument): Record<string, unknown> {
  const {
    '@context': context, id, verificationMethod, authentication,
    assertion_method, capabilityInvocation, service, exp, iat,
    version_seq, mini_version_seq, valid_iat, keyScope,
    name, full_name, meta, default_zone_did, wallets, ...extra
  } = config as Record<string, any>
  return pruneUndefined({
    '@context': context,
    id,
    verificationMethod,
    authentication,
    assertion_method: assertion_method && assertion_method.length > 0 ? assertion_method : undefined,
    capabilityInvocation: capabilityInvocation && capabilityInvocation.length > 0 ? capabilityInvocation : undefined,
    service: service && service.length > 0 ? service : undefined,
    exp,
    iat,
    version_seq,
    mini_version_seq,
    valid_iat,
    ...extra,
    keyScope: keyScope && Object.keys(keyScope).length > 0 ? keyScope : undefined,
    name,
    full_name,
    meta,
    default_zone_did,
    wallets: wallets && Object.keys(wallets).length > 0 ? wallets : undefined,
  })
}

// Serialize a ZoneConfig payload in Rust struct order and sign it.
export async function encodeZoneConfig(zoneConfig: BuckyOSZoneDocument, ownerPrivateKeyPem: string): Promise<string> {
  if (zoneConfig.version_seq === undefined) {
    throw new Error('namelib: ZoneConfig version_seq is required when encoding as JWT')
  }
  return signJwtEdDSA(zoneConfigPayload(zoneConfig), ownerPrivateKeyPem)
}

function zoneConfigPayload(config: BuckyOSZoneDocument): Record<string, unknown> {
  const {
    '@context': context, id, verificationMethod, authentication,
    assertionMethod, capabilityInvocation, service, exp, iat, version_seq, keyScope,
    hostname, owner, oods, boot_jwt, devices, sn, docker_repo_base_url, verify_hub_info,
    ...extra
  } = config as Record<string, any>
  return pruneUndefined({
    '@context': context,
    id,
    verificationMethod,
    authentication,
    assertionMethod: assertionMethod && assertionMethod.length > 0 ? assertionMethod : undefined,
    capabilityInvocation: capabilityInvocation && capabilityInvocation.length > 0 ? capabilityInvocation : undefined,
    service: service && service.length > 0 ? service : undefined,
    exp,
    iat,
    version_seq,
    ...extra,
    keyScope: keyScope && Object.keys(keyScope).length > 0 ? keyScope : undefined,
    hostname,
    owner,
    oods,
    boot_jwt,
    devices: devices && Object.keys(devices).length > 0 ? devices : undefined,
    sn,
    docker_repo_base_url,
    verify_hub_info,
  })
}
