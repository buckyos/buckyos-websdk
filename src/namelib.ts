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
  BuckyOSAgentDocument,
  BuckyOSDeviceDocument,
  BuckyOSDeviceMiniDocument,
  BuckyOSDIDDocument,
  BuckyOSDIDObjectCard,
  BuckyOSNodeIdentityConfig,
  BuckyOSOwnerDocument,
  BuckyOSZoneBootDocument,
  BuckyOSZoneDocument,
  DidDocType,
  DIDContext,
  DID_OBJECT_SERVICE_TYPE,
  Ed25519Jwk,
  isBuckyOSDIDObjectCard,
  W3CDIDDocumentBase,
  W3CService,
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
      const withoutSuffix = hostName.slice(0, -'.did'.length)
      const separator = withoutSuffix.lastIndexOf('.')
      if (separator > 0 && separator < withoutSuffix.length - 1) {
        return new DID(withoutSuffix.slice(separator + 1), withoutSuffix.slice(0, separator))
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
      const withoutSuffix = hostName.slice(0, -'.did'.length)
      const separator = withoutSuffix.lastIndexOf('.')
      if (separator > 0 && separator < withoutSuffix.length - 1) {
        return new DID(withoutSuffix.slice(separator + 1), withoutSuffix.slice(0, separator))
      }
    }

    return new DID('web', hostName)
  }

  toString(): DIDString {
    return `did:${this.method}:${this.id}`
  }

  isNamedObjId(): boolean {
    return this.method === 'dev'
  }

  getPathFromId(): string | null {
    const parts = this.id.split(':')
    if (parts.length > 1) {
      return parts.slice(1).join('/')
    }
    return null
  }

  // Mirrors Rust DID::upper_did: strip the left-most name label to get the
  // parent DID. Ports (%3A-encoded) and path segments do not take part in the
  // name hierarchy. Returns null when the parent is not independently
  // resolvable (top-level domain, IP address, first-level bns name, key DIDs).
  upperDid(): DID | null {
    const name = (this.id.split(':')[0] ?? '').split('%')[0] ?? ''
    switch (this.method) {
      case 'web': {
        if (isValidIpAddress(name)) {
          return null
        }
        const dotIndex = name.indexOf('.')
        if (dotIndex < 0) {
          return null
        }
        const upper = name.slice(dotIndex + 1)
        // Domains have at least one dot: when only the TLD remains there is
        // no queryable parent.
        if (!upper.includes('.')) {
          return null
        }
        return new DID('web', upper)
      }
      case 'bns': {
        const dotIndex = name.indexOf('.')
        if (dotIndex < 0) {
          return null
        }
        return new DID('bns', name.slice(dotIndex + 1))
      }
      default:
        return null
    }
  }

  // Mirrors Rust DID::to_filename: percent-encode the raw host uri so it is a
  // safe single-path-component file name.
  toFilename(): string {
    const HEX = '0123456789ABCDEF'
    const rawHostUri = this.toRawHostUri()
    const bytes = utf8Encode(rawHostUri)
    let filename = ''
    for (const byte of bytes) {
      const ch = String.fromCharCode(byte)
      if (/[A-Za-z0-9._-]/.test(ch)) {
        filename += ch
      } else {
        filename += `%${HEX[byte >> 4]}${HEX[byte & 0x0f]}`
      }
    }
    return filename
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

  toRawHostUri(): string {
    const hostname = this.toRawHostName()
    const path = this.getPathFromId()
    return path ? `${hostname}/${path}` : hostname
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

export interface NewOwnerDocumentParams {
  did: DID | DIDString
  name: string
  displayName: string
  publicKeyJwk: Ed25519Jwk
  now?: number
}

// Mirrors Rust OwnerDocument::new. Field insertion order follows the Rust
// struct so the serialized JSON / JWT payload is byte-compatible.
export function newOwnerDocument(params: NewOwnerDocumentParams): BuckyOSOwnerDocument {
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
    display_name: params.displayName,
  }
}

// Mirrors Rust OwnerDocument::new_by_pkx. pkx is either just the base64url x
// of an Ed25519 public key, or "<x>:<did method>:<did id>[...]".
export function newOwnerDocumentByPkx(pkx: string, hostname: string): BuckyOSOwnerDocument {
  const parts = pkx.split(':')
  if (parts.length === 0 || !parts[0]) {
    throw new Error('namelib: invalid pkx: empty x')
  }
  const x = parts[0]
  if (!/^[A-Za-z0-9_-]+$/.test(x)) {
    throw new Error('namelib: invalid pkx: x must be base64url')
  }
  if (base64UrlDecodeToBytes(x).length !== 32) {
    throw new Error(`namelib: invalid pkx: x length must be 32 bytes`)
  }
  const jwk = createJwkByX(x)
  if (parts.length === 1) {
    const ownerDid = DID.fromStr(hostname)
    const ownerName = ownerDid.id
    return newOwnerDocument({
      did: ownerDid,
      name: ownerName,
      displayName: `${ownerName}@${hostname}`,
      publicKeyJwk: jwk,
    })
  }
  if (parts.length >= 3) {
    const ownerName = parts[2]
    return newOwnerDocument({
      did: new DID(parts[1], parts[2]),
      name: ownerName,
      displayName: `${ownerName}@${hostname}`,
      publicKeyJwk: jwk,
    })
  }
  throw new Error(`namelib: invalid pkx: ${pkx}`)
}

// Mirrors Rust OwnerDocument::set_default_zone_did: the default zone is the
// FIRST entry of binded_zone_list and the "#lastDoc" service is replaced.
export function ownerDocumentSetDefaultZoneDid(ownerDoc: BuckyOSOwnerDocument, defaultZoneDid: DID | DIDString): void {
  const zoneDid = asDid(defaultZoneDid)
  const zoneDidStr = zoneDid.toString()
  const bindedZoneList = (ownerDoc.binded_zone_list ?? []).filter(did => did !== zoneDidStr)
  bindedZoneList.unshift(zoneDidStr)
  ownerDoc.binded_zone_list = bindedZoneList

  const lastDocServiceId = `${ownerDoc.id}#lastDoc`
  const services: W3CService[] = (ownerDoc.service ?? []).filter(service => service.id !== lastDocServiceId)
  services.push({
    id: lastDocServiceId,
    type: 'DIDDoc',
    serviceEndpoint: `https://${zoneDid.toHostName()}/resolve/${ownerDoc.id}`,
  })
  ownerDoc.service = services
}

// Mirrors Rust OwnerDocument::get_default_zone_did.
export function ownerDocumentGetDefaultZoneDid(ownerDoc: BuckyOSOwnerDocument): DIDString | null {
  return ownerDoc.binded_zone_list?.[0] ?? null
}

// Mirrors Rust OwnerDocument::is_bound_to_zone.
export function ownerDocumentIsBoundToZone(ownerDoc: BuckyOSOwnerDocument, zoneDid: DID | DIDString): boolean {
  const zoneDidStr = asDid(zoneDid).toString()
  return (ownerDoc.binded_zone_list ?? []).includes(zoneDidStr)
}

// Mirrors Rust OwnerDocument::get_historical_keys: every verification method
// except #main_key, for fallback verification right after a key rotation.
export function ownerDocumentGetHistoricalKeys(ownerDoc: BuckyOSOwnerDocument): Array<[string, Ed25519Jwk]> {
  return ownerDoc.verificationMethod
    .filter(method => method.id !== '#main_key')
    .map(method => [method.id, method.publicKeyJwk as Ed25519Jwk])
}

// Mirrors Rust OwnerDocument::validate_jwt_revocation: an owner document can
// declare mini_version_seq / valid_iat to revoke previously issued JWTs.
export function ownerDocumentValidateJwtRevocation(
  ownerDoc: BuckyOSOwnerDocument,
  docType: string,
  doc: EncodedDocument,
): void {
  if (ownerDoc.mini_version_seq === undefined && ownerDoc.valid_iat === undefined) {
    return
  }
  if (doc.type !== 'jwt') {
    return
  }
  const docValue = encodedDocumentToJsonValue(doc)
  if (ownerDoc.mini_version_seq !== undefined) {
    const versionSeq = typeof docValue?.version_seq === 'number' ? docValue.version_seq : undefined
    if (versionSeq === undefined) {
      throw new Error(`namelib: ${docType} JWT missing version_seq required by owner revocation policy`)
    }
    if (versionSeq <= ownerDoc.mini_version_seq) {
      throw new Error(
        `namelib: ${docType} JWT version_seq ${versionSeq} is not greater than owner mini_version_seq ${ownerDoc.mini_version_seq}`,
      )
    }
  }
  if (ownerDoc.valid_iat !== undefined) {
    const iat = typeof docValue?.iat === 'number' ? docValue.iat : undefined
    if (iat === undefined) {
      throw new Error(`namelib: ${docType} JWT missing iat required by owner revocation policy`)
    }
    if (iat <= ownerDoc.valid_iat) {
      throw new Error(
        `namelib: ${docType} JWT iat ${iat} is not greater than owner valid_iat ${ownerDoc.valid_iat}`,
      )
    }
  }
}

export interface NewZoneDocumentParams {
  id: DID | DIDString
  ownerDid: DID | DIDString
  publicKeyJwk: Ed25519Jwk
  now?: number
}

// Mirrors Rust ZoneDocument::new.
export function newZoneDocument(params: NewZoneDocumentParams): BuckyOSZoneDocument {
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

// Mirrors Rust ZoneDocument::get_default_zone_gateway.
export function zoneDocumentGetDefaultGateway(zoneDoc: BuckyOSZoneDocument): string | null {
  for (const oodString of zoneDoc.oods) {
    const ood = parseOODDescription(oodString)
    if (oodNodeTypeIsGateway(ood.nodeType)) {
      return ood.name
    }
  }
  return null
}

// Mirrors Rust ZoneDocument::get_sn_api_url.
export function zoneDocumentGetSnApiUrl(zoneDoc: BuckyOSZoneDocument): string | null {
  return zoneDoc.sn !== undefined ? `https://${zoneDoc.sn}/kapi/sn` : null
}

export interface NewZoneBootDocumentParams {
  id?: DID | DIDString
  oods: string[]
  sn?: string
  exp: number
  owner?: DID | DIDString
  ownerKey?: Ed25519Jwk
}

export function newZoneBootDocument(params: NewZoneBootDocumentParams): BuckyOSZoneBootDocument {
  return pruneUndefined({
    id: params.id !== undefined ? asDid(params.id).toString() : undefined,
    oods: [...params.oods],
    sn: params.sn,
    exp: params.exp,
    owner: params.owner !== undefined ? asDid(params.owner).toString() : undefined,
    owner_key: params.ownerKey,
  })
}

// Mirrors Rust ZoneBootDocument::encode: sign the boot document as an EdDSA
// JWT. Payload key order: id?, oods, sn?, exp, owner?, owner_key?.
export async function encodeZoneBootDocument(bootDoc: BuckyOSZoneBootDocument, ownerPrivateKeyPem: string): Promise<string> {
  const { id, oods, sn, exp, owner, owner_key, ...extra } = bootDoc
  const payload = pruneUndefined({ id, oods, sn, exp, owner, ...extra, owner_key })
  return signJwtEdDSA(payload, ownerPrivateKeyPem)
}

export async function decodeZoneBootDocument(jwt: string, publicKeyJwk?: Ed25519Jwk): Promise<BuckyOSZoneBootDocument> {
  const payload = publicKeyJwk ? await verifyJwtEdDSA(jwt, publicKeyJwk) : decodeJwtClaimWithoutVerify(jwt)
  return payload as BuckyOSZoneBootDocument
}

// Mirrors Rust ZoneBootDocument::get_gateway_name.
export function zoneBootDocumentGetGatewayName(bootDoc: BuckyOSZoneBootDocument): string {
  for (const oodString of bootDoc.oods) {
    const ood = parseOODDescription(oodString)
    if (oodNodeTypeIsGateway(ood.nodeType)) {
      return ood.name
    }
  }
  return ''
}

// Mirrors Rust ZoneBootDocument::to_zone_document.
export function zoneBootDocumentToZoneDocument(bootDoc: BuckyOSZoneBootDocument, bootJwt: string): BuckyOSZoneDocument {
  if (!bootDoc.id || !bootDoc.owner_key) {
    throw new Error('namelib: zone boot document needs id and owner_key to build zone document')
  }
  const ownerDid = bootDoc.owner ? DID.fromStr(bootDoc.owner) : DID.undefined()
  const zoneDoc = newZoneDocument({
    id: bootDoc.id,
    ownerDid,
    publicKeyJwk: bootDoc.owner_key,
  })
  zoneDoc.boot_jwt = bootJwt
  zoneDoc.oods = [...bootDoc.oods]
  if (bootDoc.sn !== undefined) {
    zoneDoc.sn = bootDoc.sn
  } else {
    delete zoneDoc.sn
  }
  zoneDoc.exp = bootDoc.exp
  zoneDoc.iat = bootDoc.exp - DEFAULT_EXPIRE_TIME
  zoneDoc.version_seq = 0
  zoneDoc.owner = bootDoc.owner ?? DID.undefined().toString()
  return zoneDoc
}

export interface NewDeviceDocumentParams {
  name: string
  // base64url Ed25519 public key (the "x" of the device JWK)
  pkx: string
  now?: number
}

// Mirrors Rust DeviceDocument::new.
export function newDeviceDocument(params: NewDeviceDocumentParams): BuckyOSDeviceDocument {
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

// Mirrors Rust DeviceDocument::new_by_jwk.
export function newDeviceDocumentByJwk(name: string, publicKeyJwk: Ed25519Jwk, now?: number): BuckyOSDeviceDocument {
  return newDeviceDocument({ name, pkx: getXFromJwk(publicKeyJwk), now })
}

// Mirrors Rust DeviceDocument::new_by_mini_document.
export function newDeviceDocumentByMiniDocument(
  miniDocJwt: string,
  miniDoc: BuckyOSDeviceMiniDocument,
  zoneDid: DID | DIDString,
  ownerDid: DID | DIDString,
): BuckyOSDeviceDocument {
  const did = `did:dev:${miniDoc.x}`
  const deviceDoc: BuckyOSDeviceDocument = {
    '@context': buckyosContext('device'),
    id: did,
    verificationMethod: [
      {
        type: 'Ed25519VerificationKey2020',
        id: '#main_key',
        controller: did,
        publicKeyJwk: createJwkByX(miniDoc.x),
      },
    ],
    authentication: ['#main_key'],
    assertion_method: ['#main_key'],
    capabilityInvocation: ['#main_key'],
    exp: miniDoc.exp,
    iat: miniDoc.exp - DEFAULT_EXPIRE_TIME,
    version_seq: 0,
    zone_did: asDid(zoneDid).toString(),
    owner: asDid(ownerDid).toString(),
    device_type: 'ood',
    device_mini_document_jwt: miniDocJwt,
    name: miniDoc.n,
  }
  if (miniDoc.p !== undefined) {
    deviceDoc.rtcp_port = miniDoc.p
  }
  return deviceDoc
}

// Serialize a DeviceDocument payload in Rust struct order and sign it.
// NOTE: device documents are signed by the OWNER private key, not the device key.
export async function encodeDeviceDocument(deviceDoc: BuckyOSDeviceDocument, ownerPrivateKeyPem: string): Promise<string> {
  if (deviceDoc.version_seq === undefined) {
    throw new Error('namelib: DeviceDocument version_seq is required when encoding as JWT')
  }
  return signJwtEdDSA(deviceDocumentPayload(deviceDoc), ownerPrivateKeyPem)
}

// Rebuild the payload in Rust DeviceDocument serde order, applying the same
// skip_serializing_if rules (support_container is skipped when true).
function deviceDocumentPayload(doc: BuckyOSDeviceDocument): Record<string, unknown> {
  const {
    '@context': context, id, verificationMethod, authentication,
    assertion_method, capabilityInvocation, service, exp, iat, version_seq,
    keyScope, 'buckyos:scopes': buckyosScopes,
    zone_did, owner, device_type, device_mini_document_jwt, name, rtcp_port,
    ips, net_id, ddns_sn_url, support_container, capbilities, ...extra
  } = doc as Record<string, any>
  const keyScopeValue = keyScope ?? buckyosScopes
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
    keyScope: keyScopeValue && Object.keys(keyScopeValue).length > 0 ? keyScopeValue : undefined,
    zone_did,
    owner,
    device_type,
    device_mini_document_jwt,
    name,
    rtcp_port,
    ips: ips && ips.length > 0 ? ips : undefined,
    net_id,
    ddns_sn_url,
    support_container: support_container === false ? false : undefined,
    capbilities: capbilities && Object.keys(capbilities).length > 0 ? capbilities : undefined,
  })
}

export async function decodeDeviceDocument(jwt: string, publicKeyJwk?: Ed25519Jwk): Promise<BuckyOSDeviceDocument> {
  const payload = publicKeyJwk ? await verifyJwtEdDSA(jwt, publicKeyJwk) : decodeJwtClaimWithoutVerify(jwt)
  if (payload.version_seq === undefined) {
    throw new Error('namelib: DeviceDocument version_seq is required when decoding from JWT')
  }
  return payload as BuckyOSDeviceDocument
}

export interface NewDeviceMiniDocumentParams {
  name: string
  x: string
  rtcpPort?: number
  exp: number
}

export function newDeviceMiniDocument(params: NewDeviceMiniDocumentParams): BuckyOSDeviceMiniDocument {
  return pruneUndefined({
    n: params.name,
    x: params.x,
    p: params.rtcpPort,
    exp: params.exp,
  })
}

// Mirrors Rust DeviceMiniDocument::new_by_device_document.
export function newDeviceMiniDocumentByDeviceDocument(deviceDoc: BuckyOSDeviceDocument): BuckyOSDeviceMiniDocument {
  const defaultKey = deviceDoc.verificationMethod.find(method => method.id === '#main_key')
  if (!defaultKey) {
    throw new Error('namelib: device document has no #main_key verification method')
  }
  return newDeviceMiniDocument({
    name: deviceDoc.name,
    x: getXFromJwk(defaultKey.publicKeyJwk),
    rtcpPort: deviceDoc.rtcp_port,
    exp: deviceDoc.exp,
  })
}

// Mirrors Rust DeviceMiniDocument::to_jwt (signed by owner key).
// Payload key order: n, x, p?, exp.
export async function deviceMiniDocumentToJwt(miniDoc: BuckyOSDeviceMiniDocument, ownerPrivateKeyPem: string): Promise<string> {
  const { n, x, p, exp, ...extra } = miniDoc
  const payload = pruneUndefined({ n, x, p, exp, ...extra })
  return signJwtEdDSA(payload, ownerPrivateKeyPem)
}

export async function deviceMiniDocumentFromJwt(jwt: string, publicKeyJwk?: Ed25519Jwk): Promise<BuckyOSDeviceMiniDocument> {
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

// Serialize an OwnerDocument payload in Rust struct order and sign it.
export async function encodeOwnerDocument(ownerDoc: BuckyOSOwnerDocument, privateKeyPem: string): Promise<string> {
  if (ownerDoc.version_seq === undefined) {
    throw new Error('namelib: OwnerDocument version_seq is required when encoding as JWT')
  }
  return signJwtEdDSA(ownerDocumentPayload(ownerDoc), privateKeyPem)
}

function ownerDocumentPayload(doc: BuckyOSOwnerDocument): Record<string, unknown> {
  const {
    '@context': context, id, verificationMethod, authentication,
    assertion_method, capabilityInvocation, service, exp, iat,
    version_seq, mini_version_seq, valid_iat,
    keyScope, 'buckyos:scopes': buckyosScopes,
    name, display_name, avatar, meta, binded_zone_list, wallets, ...extra
  } = doc as Record<string, any>
  const keyScopeValue = keyScope ?? buckyosScopes
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
    keyScope: keyScopeValue && Object.keys(keyScopeValue).length > 0 ? keyScopeValue : undefined,
    name,
    display_name,
    avatar,
    meta,
    binded_zone_list: binded_zone_list && binded_zone_list.length > 0 ? binded_zone_list : undefined,
    wallets: wallets && Object.keys(wallets).length > 0 ? wallets : undefined,
  })
}

// Serialize a ZoneDocument payload in Rust struct order and sign it.
export async function encodeZoneDocument(zoneDoc: BuckyOSZoneDocument, ownerPrivateKeyPem: string): Promise<string> {
  if (zoneDoc.version_seq === undefined) {
    throw new Error('namelib: ZoneDocument version_seq is required when encoding as JWT')
  }
  return signJwtEdDSA(zoneDocumentPayload(zoneDoc), ownerPrivateKeyPem)
}

function zoneDocumentPayload(doc: BuckyOSZoneDocument): Record<string, unknown> {
  const {
    '@context': context, id, verificationMethod, authentication,
    assertionMethod, capabilityInvocation, service, exp, iat, version_seq,
    keyScope, 'buckyos:scopes': buckyosScopes,
    hostname, owner, oods, boot_jwt, mini_device_jwts, devices, sn,
    ...extra
  } = doc as Record<string, any>
  const keyScopeValue = keyScope ?? buckyosScopes
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
    keyScope: keyScopeValue && Object.keys(keyScopeValue).length > 0 ? keyScopeValue : undefined,
    hostname,
    owner,
    oods,
    boot_jwt,
    mini_device_jwts: mini_device_jwts && Object.keys(mini_device_jwts).length > 0 ? mini_device_jwts : undefined,
    devices: devices && Object.keys(devices).length > 0 ? devices : undefined,
    sn,
  })
}

// Ordered JSON views (Rust serde struct order). Use these when writing a
// document to disk that must be byte-identical to Rust serde_json output.
export function ownerDocumentToOrderedJson(doc: BuckyOSOwnerDocument): Record<string, unknown> {
  return ownerDocumentPayload(doc)
}

export function zoneDocumentToOrderedJson(doc: BuckyOSZoneDocument): Record<string, unknown> {
  return zoneDocumentPayload(doc)
}

export function deviceDocumentToOrderedJson(doc: BuckyOSDeviceDocument): Record<string, unknown> {
  return deviceDocumentPayload(doc)
}

// ============================================================================
// key scopes (mirror key_scope.rs)
// ============================================================================

export const KEY_SCOPE_MANUAL = 'manual'
export const KEY_SCOPE_ZONE_PUBLISH = 'zone:publish'
export const KEY_SCOPE_MESSAGE_CREATE = 'message:create'
export const KEY_SCOPE_CONTENT_CREATE = 'content:create'
export const KEY_SCOPE_AGENT_SPEND = 'agent:spend'
export const KEY_SCOPE_AGENT_RECEIVE = 'agent:receive'
export const KEY_SCOPE_AGENT_CREATE_CONTENT = 'agent:create-content'

// ============================================================================
// DIDDocumentTrait helpers (mirror did.rs trait default methods)
//
// These operate on the serialized JSON form of any BuckyOS did document
// (owner / zone / device / agent / did-object card).
// ============================================================================

export type AnyBuckyOSDIDDocument = W3CDIDDocumentBase | BuckyOSDIDObjectCard

// keyScope map (serde: rename "keyScope", deserialize alias "buckyos:scopes").
export function getDocumentKeyScope(doc: AnyBuckyOSDIDDocument): Record<string, string[]> {
  const keyScope = (doc.keyScope ?? doc['buckyos:scopes']) as Record<string, string[]> | undefined
  return keyScope ?? {}
}

// Mirrors get_auth_key: kid undefined means the first verification method.
export function getDocumentAuthKey(doc: AnyBuckyOSDIDDocument, kid?: string): Ed25519Jwk | null {
  const methods = doc.verificationMethod ?? []
  if (methods.length === 0) {
    return null
  }
  if (kid === undefined) {
    return methods[0].publicKeyJwk as Ed25519Jwk
  }
  const method = methods.find(item => item.id === kid)
  return method ? (method.publicKeyJwk as Ed25519Jwk) : null
}

// Mirrors get_default_key (owner/zone/device/agent): the #main_key entry.
export function getDocumentDefaultKey(doc: AnyBuckyOSDIDDocument): Ed25519Jwk | null {
  const method = (doc.verificationMethod ?? []).find(item => item.id === '#main_key')
  return method ? (method.publicKeyJwk as Ed25519Jwk) : null
}

export function getKeyIdsByScope(doc: AnyBuckyOSDIDDocument, scope: string): string[] | null {
  return getDocumentKeyScope(doc)[scope] ?? null
}

export function hasKeyScope(doc: AnyBuckyOSDIDDocument): boolean {
  return Object.keys(getDocumentKeyScope(doc)).length > 0
}

// Mirrors get_standard_scope_key_ids: capabilityInvocation, then
// authentication (DID Object Cards also fall back to assertionMethod).
export function getStandardScopeKeyIds(doc: AnyBuckyOSDIDDocument): string[] | null {
  const capabilityInvocation = doc.capabilityInvocation
  if (Array.isArray(capabilityInvocation) && capabilityInvocation.length > 0) {
    return capabilityInvocation
  }
  const authentication = doc.authentication
  if (Array.isArray(authentication) && authentication.length > 0) {
    return authentication
  }
  if (isBuckyOSDIDObjectCard(doc)) {
    const assertionMethod = doc.assertionMethod
    if (Array.isArray(assertionMethod) && assertionMethod.length > 0) {
      return assertionMethod
    }
  }
  return null
}

// Mirrors normalize_key_id_for_local_lookup: "<doc id>#key" -> "#key".
export function normalizeKeyIdForLocalLookup(doc: AnyBuckyOSDIDDocument, keyId: string): string {
  const documentId = doc.id
  if (keyId.startsWith(documentId)) {
    const localKeyId = keyId.slice(documentId.length)
    if (localKeyId.startsWith('#')) {
      return localKeyId
    }
  }
  return keyId
}

// Mirrors expand_local_key_id: "#key" -> "<doc id>#key".
export function expandLocalKeyId(doc: AnyBuckyOSDIDDocument, keyId: string): string {
  if (keyId.startsWith('#')) {
    return `${doc.id}${keyId}`
  }
  return keyId
}

export function isSameDocumentKeyId(doc: AnyBuckyOSDIDDocument, left: string, right: string): boolean {
  return left === right
    || normalizeKeyIdForLocalLookup(doc, left) === normalizeKeyIdForLocalLookup(doc, right)
    || expandLocalKeyId(doc, left) === expandLocalKeyId(doc, right)
}

// Mirrors get_key_from_key_ids: first key id that resolves to a key.
export function getKeyFromKeyIds(doc: AnyBuckyOSDIDDocument, keyIds: string[]): [string, Ed25519Jwk] | null {
  for (const keyId of keyIds) {
    const localKeyId = normalizeKeyIdForLocalLookup(doc, keyId)
    const jwk = getDocumentAuthKey(doc, localKeyId)
    if (jwk) {
      return [keyId, jwk]
    }
  }
  return null
}

// Mirrors get_key_by_scope: an explicit scope entry wins; a document WITH a
// keyScope map denies unlisted scopes; a document WITHOUT one falls back to
// the standard scope key ids, then to the default auth key.
export function getKeyByScope(doc: AnyBuckyOSDIDDocument, scope: string): [string, Ed25519Jwk] | null {
  const scopedKeyIds = getKeyIdsByScope(doc, scope)
  if (scopedKeyIds) {
    return getKeyFromKeyIds(doc, scopedKeyIds)
  }
  if (hasKeyScope(doc)) {
    return null
  }
  const standardKeyIds = getStandardScopeKeyIds(doc)
  if (standardKeyIds) {
    const key = getKeyFromKeyIds(doc, standardKeyIds)
    if (key) {
      return key
    }
  }
  const authKey = getDocumentAuthKey(doc)
  return authKey ? ['', authKey] : null
}

// Mirrors is_key_allowed_in_scope.
export function isKeyAllowedInScope(doc: AnyBuckyOSDIDDocument, scope: string, keyId: string): boolean {
  const scopedKeyIds = getKeyIdsByScope(doc, scope)
  if (scopedKeyIds) {
    return scopedKeyIds.some(allowedKeyId => isSameDocumentKeyId(doc, allowedKeyId, keyId))
  }
  if (hasKeyScope(doc)) {
    return false
  }
  const standardKeyIds = getStandardScopeKeyIds(doc)
  if (standardKeyIds) {
    return standardKeyIds.some(allowedKeyId => isSameDocumentKeyId(doc, allowedKeyId, keyId))
  }
  return getDocumentAuthKey(doc, normalizeKeyIdForLocalLookup(doc, keyId)) !== null
}

// ============================================================================
// parse_did_doc (mirror did.rs parse_did_doc: route by document shape)
// ============================================================================

export type ParsedDidDocument =
  | { docType: 'owner'; doc: BuckyOSOwnerDocument }
  | { docType: 'agent'; doc: BuckyOSAgentDocument }
  | { docType: 'device'; doc: BuckyOSDeviceDocument }
  | { docType: 'zone'; doc: BuckyOSZoneDocument }
  | { docType: 'did-object'; doc: BuckyOSDIDObjectCard }

// Mirrors Rust parse_did_doc. Routing order: owner (verificationMethod + name
// + display name in any casing) -> agent (httpServicePorts) -> device
// (device_type) -> zone (oods) -> DID Object Card (DIDObjectService service).
// Documents decoded from a JWT must carry version_seq (revocation policy).
export function parseDidDoc(doc: EncodedDocument | string): ParsedDidDocument {
  const encoded = typeof doc === 'string' ? encodedDocumentFromStr(doc) : doc
  const isJwt = encoded.type === 'jwt'
  const value = encodedDocumentToJsonValue(encoded)
  if (typeof value !== 'object' || value === null) {
    throw new Error('namelib: unknown did document')
  }
  const ensureVersionSeqForJwt = (docTypeName: string) => {
    if (isJwt && typeof value.version_seq !== 'number') {
      throw new Error(`namelib: ${docTypeName} version_seq is required when encoding as JWT`)
    }
  }

  if (value.verificationMethod !== undefined && value.name !== undefined
    && (value.display_name !== undefined || value.displayName !== undefined || value.full_name !== undefined)) {
    ensureVersionSeqForJwt('OwnerDocument')
    return { docType: 'owner', doc: value as BuckyOSOwnerDocument }
  }
  if (value.httpServicePorts !== undefined) {
    ensureVersionSeqForJwt('AgentDocument')
    return { docType: 'agent', doc: value as BuckyOSAgentDocument }
  }
  if (value.device_type !== undefined) {
    ensureVersionSeqForJwt('DeviceDocument')
    return { docType: 'device', doc: value as BuckyOSDeviceDocument }
  }
  if (value.oods !== undefined) {
    ensureVersionSeqForJwt('ZoneDocument')
    return { docType: 'zone', doc: value as BuckyOSZoneDocument }
  }
  if (Array.isArray(value.service)
    && value.service.some((service: any) => service?.type === DID_OBJECT_SERVICE_TYPE)) {
    ensureVersionSeqForJwt('DIDObjectCard')
    return { docType: 'did-object', doc: value as BuckyOSDIDObjectCard }
  }
  throw new Error('namelib: unknown did document')
}

// Mirrors DIDDocumentTrait::get_doc_type for the parseDidDoc result.
export function getDidDocType(parsed: ParsedDidDocument): DidDocType {
  return parsed.docType
}

export function parseDidDocAs<T extends BuckyOSDIDDocument>(
  doc: EncodedDocument | string,
  docType: ParsedDidDocument['docType'],
): T {
  const parsed = parseDidDoc(doc)
  if (parsed.docType !== docType) {
    throw new Error(`namelib: expected ${docType} document, got ${parsed.docType}`)
  }
  return parsed.doc as T
}
