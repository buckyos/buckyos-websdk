// cert: node-only TLS CA / server certificate generation for dev environments.
// TypeScript replacement of buckyos_devkit CertManager (cert_mgr.py), built on
// @peculiar/x509 (pure JS + WebCrypto, no native dependency, no openssl).
//
// Legacy behavior contract (mirrors cert_mgr.py):
// - createCa(outputDir, name): RSA-4096 self-signed CA, 3650 days,
//   subject C=US/ST=California/L=San Jose/O={name}'s Dev Test Environment/OU=Test/CN={name},
//   files {name}_ca_cert.pem + {name}_ca_key.pem
// - createCertFromCa(caDir, hostname, targetDir, hostnames?): finds the single
//   *_ca_cert.pem in caDir, issues an RSA-2048 server cert for 365 days with
//   CN=hostnames[0], SAN DNS entries (wildcards like *.zone supported),
//   keyUsage critical digitalSignature+keyEncipherment, extendedKeyUsage
//   serverAuth; files {safeHostname}.crt + {safeHostname}.key
//
// Identity path helpers follow
// buckyos-base/doc/did-identity-certificate-manager.md:
//   public identity root / {encoded raw host URI} / {usage}.{material}.{ext}
//   security root        / {encoded raw host URI} / {usage}.{material}.{ext}

import * as x509 from '@peculiar/x509'
import { DID } from './namelib'

function requireNode(moduleName: string): any {
  // process.getBuiltinModule works in both CJS and ESM on Node >= 22.3 and Deno >= 2.
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
  throw new Error(`buckyos cert cannot load builtin module ${moduleName} in this runtime`)
}

function getCrypto(): Crypto {
  const webcrypto = (globalThis as { crypto?: Crypto }).crypto
  if (webcrypto?.subtle) {
    return webcrypto
  }
  const nodeCrypto = requireNode('node:crypto')
  return nodeCrypto.webcrypto as Crypto
}

const CA_SIGNING_ALG: RsaHashedKeyGenParams = {
  name: 'RSASSA-PKCS1-v1_5',
  hash: 'SHA-256',
  publicExponent: new Uint8Array([1, 0, 1]),
  modulusLength: 4096,
}

const SERVER_SIGNING_ALG: RsaHashedKeyGenParams = {
  ...CA_SIGNING_ALG,
  modulusLength: 2048,
}

const CA_VALIDITY_DAYS = 3650
const CERT_VALIDITY_DAYS = 365
const DEFAULT_BUCKYOS_ROOT = '/opt/buckyos'
const KEYREF_SCHEMA = 'buckyos.identity.keyref.v1'
const X509_METADATA_SCHEMA = 'buckyos.identity.x509.metadata.v1'

export const IDENTITY_USAGES = [
  'server',
  'client',
  'authentication',
  'assertion',
  'key-agreement',
  'capability',
] as const

export type IdentityUsage = typeof IDENTITY_USAGES[number]

export const IDENTITY_MATERIALS = [
  'did-json',
  'did-meta',
  'cert',
  'chain',
  'fullchain',
  'ca',
  'public',
  'csr',
  'meta',
  'private',
  'keyref',
  'verification-method',
] as const

export type IdentityMaterial = typeof IDENTITY_MATERIALS[number]

export type IdentityMatchType = 'exact' | 'wildcard'

export interface IdentityRootsOptions {
  publicRoot?: string
  securityRoot?: string
  buckyosRoot?: string
}

export interface X509Paths {
  cert: string
  chain: string
  fullchain: string
  ca: string
  metadata: string
  keyref: string
  privateKey: string
}

export interface IdentityDirMatch {
  type: IdentityMatchType
  rawHostUri: string
  dirName: string
  publicDir: string
  securityDir: string
  host?: string
  hostPattern?: string
}

export interface X509PathMatch {
  match: IdentityDirMatch
  paths: X509Paths
}

export interface CreateIdentityCertFromCaOptions {
  usage?: Extract<IdentityUsage, 'server' | 'client'>
  hostnames?: string[]
  uriSans?: string[]
}

export interface CreateIdentityCertResult {
  did: string
  rawHostUri: string
  dirName: string
  paths: X509Paths
  certPath: string
  chainPath: string
  fullchainPath: string
  caPath: string
  keyPath: string
  keyRefPath: string
  metadataPath: string
}

function randomSerialNumber(): string {
  const bytes = new Uint8Array(16)
  getCrypto().getRandomValues(bytes)
  bytes[0] &= 0x7f // keep the serial positive
  bytes[0] |= 0x01
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 3600 * 1000)
}

async function exportPrivateKeyPem(key: CryptoKey): Promise<string> {
  const der = new Uint8Array(await getCrypto().subtle.exportKey('pkcs8', key))
  return x509.PemConverter.encode(der as unknown as ArrayBuffer, 'PRIVATE KEY')
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

async function sha256Fingerprint(bytes: Uint8Array): Promise<string> {
  const digest = await getCrypto().subtle.digest('SHA-256', bytes as unknown as ArrayBuffer)
  return `sha256:${bytesToHex(new Uint8Array(digest))}`
}

function encodeUtf8(value: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value)
  }
  const buffer = requireNode('node:buffer').Buffer
  return new Uint8Array(buffer.from(value, 'utf8'))
}

export function encodeIdentityDirName(rawHostUri: string): string {
  const keep = (byte: number) =>
    (byte >= 0x41 && byte <= 0x5a)
    || (byte >= 0x61 && byte <= 0x7a)
    || (byte >= 0x30 && byte <= 0x39)
    || byte === 0x2e
    || byte === 0x5f
    || byte === 0x2d

  let encoded = ''
  for (const byte of encodeUtf8(rawHostUri)) {
    if (keep(byte)) {
      encoded += String.fromCharCode(byte)
    } else {
      encoded += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
    }
  }
  if (!encoded || encoded === '.' || encoded === '..' || /[\\/]/.test(encoded) || encoded.includes('\0')) {
    throw new Error(`Invalid encoded identity directory name for raw host URI: ${rawHostUri}`)
  }
  return encoded
}

function normalizeWildcardInput(didOrHostname: string): string {
  if (didOrHostname.startsWith('did:web:*.')) {
    return `did:web:_.${didOrHostname.slice('did:web:*.'.length)}`
  }
  if (didOrHostname.startsWith('*.')) {
    return `_.${didOrHostname.slice(2)}`
  }
  return didOrHostname
}

function canonicalIdentityDid(didOrHostname: string): DID {
  const trimmed = didOrHostname.trim()
  if (!trimmed) {
    throw new Error('identity DID or hostname is empty')
  }
  return DID.fromStr(normalizeWildcardInput(trimmed))
}

export function identityRawHostUri(didOrHostname: string): string {
  return canonicalIdentityDid(didOrHostname).toRawHostUri()
}

export function identityDirName(didOrHostname: string): string {
  return encodeIdentityDirName(identityRawHostUri(didOrHostname))
}

export function didWebDocumentUrl(didOrHostname: string): string | null {
  const did = canonicalIdentityDid(didOrHostname)
  if (did.method !== 'web') {
    return null
  }
  const host = did.toRawHostName()
  const pathFromId = did.getPathFromId()
  if (pathFromId) {
    return `https://${host}/${pathFromId}/did.json`
  }
  return `https://${host}/.well-known/did.json`
}

function assertIdentityUsage(usage: IdentityUsage): void {
  if (!(IDENTITY_USAGES as readonly string[]).includes(usage)) {
    throw new Error(`Unsupported identity usage: ${usage}`)
  }
}

function assertIdentityMaterial(material: IdentityMaterial): void {
  if (!(IDENTITY_MATERIALS as readonly string[]).includes(material)) {
    throw new Error(`Unsupported identity material: ${material}`)
  }
}

export function identityFileName(usage: IdentityUsage, material: IdentityMaterial): string {
  assertIdentityUsage(usage)
  assertIdentityMaterial(material)
  switch (material) {
    case 'did-json':
      return 'did.json'
    case 'did-meta':
      return 'did.meta.json'
    case 'cert':
      return `${usage}.cert.pem`
    case 'chain':
      return `${usage}.chain.pem`
    case 'fullchain':
      return `${usage}.fullchain.pem`
    case 'ca':
      return `${usage}.ca.pem`
    case 'public':
      return usage === 'server' || usage === 'client'
        ? `${usage}.public.pem`
        : `${usage}.public.jwk`
    case 'csr':
      return `${usage}.csr.pem`
    case 'meta':
      return `${usage}.meta.json`
    case 'private':
      return `${usage}.private.pem`
    case 'keyref':
      return `${usage}.keyref.json`
    case 'verification-method':
      return `${usage}.verification-method.json`
  }
}

function getProcessEnv(): Record<string, string | undefined> {
  const runtimeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  return runtimeProcess?.env ?? {}
}

function trimToNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function x509PathsForDirs(publicDir: string, securityDir: string, usage: IdentityUsage): X509Paths {
  const path = requireNode('node:path')
  return {
    cert: path.join(publicDir, identityFileName(usage, 'cert')),
    chain: path.join(publicDir, identityFileName(usage, 'chain')),
    fullchain: path.join(publicDir, identityFileName(usage, 'fullchain')),
    ca: path.join(publicDir, identityFileName(usage, 'ca')),
    metadata: path.join(publicDir, identityFileName(usage, 'meta')),
    keyref: path.join(securityDir, identityFileName(usage, 'keyref')),
    privateKey: path.join(securityDir, identityFileName(usage, 'private')),
  }
}

export class IdentityRoots {
  publicRoot: string
  securityRoot: string

  constructor(publicRoot: string, securityRoot: string) {
    const path = requireNode('node:path')
    this.publicRoot = path.resolve(publicRoot)
    this.securityRoot = path.resolve(securityRoot)
  }

  static fromEnvOrBuckyosRoot(options: IdentityRootsOptions = {}): IdentityRoots {
    const path = requireNode('node:path')
    const env = getProcessEnv()
    const buckyosRoot = trimToNull(options.buckyosRoot) ?? trimToNull(env.BUCKYOS_ROOT) ?? DEFAULT_BUCKYOS_ROOT
    const publicRoot = trimToNull(options.publicRoot) ?? trimToNull(env.BUCKYOS_IDENTITY_ROOT) ?? path.join(buckyosRoot, 'local', 'identity')
    const securityRoot = trimToNull(options.securityRoot) ?? trimToNull(env.BUCKYOS_SECURITY_ROOT) ?? path.join(buckyosRoot, 'security')
    return new IdentityRoots(publicRoot, securityRoot)
  }

  rawHostUri(didOrHostname: string): string {
    return identityRawHostUri(didOrHostname)
  }

  dirName(didOrHostname: string): string {
    return identityDirName(didOrHostname)
  }

  publicDir(didOrHostname: string): string {
    const path = requireNode('node:path')
    return path.join(this.publicRoot, this.dirName(didOrHostname))
  }

  securityDir(didOrHostname: string): string {
    const path = requireNode('node:path')
    return path.join(this.securityRoot, this.dirName(didOrHostname))
  }

  publicFile(didOrHostname: string, usage: IdentityUsage, material: IdentityMaterial): string {
    const path = requireNode('node:path')
    return path.join(this.publicDir(didOrHostname), identityFileName(usage, material))
  }

  securityFile(didOrHostname: string, usage: IdentityUsage, material: IdentityMaterial): string {
    const path = requireNode('node:path')
    return path.join(this.securityDir(didOrHostname), identityFileName(usage, material))
  }

  x509Paths(didOrHostname: string, usage: Extract<IdentityUsage, 'server' | 'client'> = 'server'): X509Paths {
    return x509PathsForDirs(this.publicDir(didOrHostname), this.securityDir(didOrHostname), usage)
  }

  identityDirMatch(didOrHostname: string): IdentityDirMatch {
    const rawHostUri = this.rawHostUri(didOrHostname)
    const dirName = encodeIdentityDirName(rawHostUri)
    return {
      type: rawHostUri.startsWith('_.') ? 'wildcard' : 'exact',
      rawHostUri,
      dirName,
      publicDir: this.publicDir(didOrHostname),
      securityDir: this.securityDir(didOrHostname),
      ...(rawHostUri.startsWith('_.')
        ? { hostPattern: `*.${rawHostUri.slice(2)}` }
        : { host: rawHostUri }),
    }
  }

  findX509Paths(didOrHostname: string, usage: Extract<IdentityUsage, 'server' | 'client'> = 'server'): X509PathMatch | null {
    const fs = requireNode('node:fs')
    const exact = this.identityDirMatch(didOrHostname)
    const exactPaths = x509PathsForDirs(exact.publicDir, exact.securityDir, usage)
    if (fs.existsSync(exactPaths.fullchain) || fs.existsSync(exactPaths.cert)) {
      return { match: exact, paths: exactPaths }
    }

    const did = canonicalIdentityDid(didOrHostname)
    if (did.method !== 'web') {
      return null
    }
    const host = did.toRawHostName()
    const labels = host.split('.')
    if (labels.length < 3) {
      return null
    }
    const wildcardHost = `_.${labels.slice(1).join('.')}`
    const wildcardDirName = encodeIdentityDirName(wildcardHost)
    const path = requireNode('node:path')
    const publicDir = path.join(this.publicRoot, wildcardDirName)
    const securityDir = path.join(this.securityRoot, wildcardDirName)
    const wildcardPaths = x509PathsForDirs(publicDir, securityDir, usage)
    if (!fs.existsSync(wildcardPaths.fullchain) && !fs.existsSync(wildcardPaths.cert)) {
      return null
    }
    return {
      match: {
        type: 'wildcard',
        rawHostUri: wildcardHost,
        dirName: wildcardDirName,
        publicDir,
        securityDir,
        hostPattern: `*.${labels.slice(1).join('.')}`,
      },
      paths: wildcardPaths,
    }
  }
}

// Accepts PKCS8 ("PRIVATE KEY", what we generate) and PKCS1 ("RSA PRIVATE
// KEY", what openssl genrsa produced for pre-existing CAs).
async function importRsaPrivateKeyPem(pem: string): Promise<CryptoKey> {
  const crypto = getCrypto()
  if (pem.includes('BEGIN RSA PRIVATE KEY')) {
    const pkcs1 = new Uint8Array(x509.PemConverter.decode(pem)[0])
    const pkcs8 = wrapRsaPkcs1InPkcs8(pkcs1)
    return crypto.subtle.importKey('pkcs8', pkcs8 as unknown as ArrayBuffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  }
  const der = new Uint8Array(x509.PemConverter.decode(pem)[0])
  return crypto.subtle.importKey('pkcs8', der as unknown as ArrayBuffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
}

// Minimal DER wrap: PKCS8 = SEQ{ ver=0, SEQ{rsaEncryption OID, NULL}, OCTET STRING { pkcs1 } }.
function wrapRsaPkcs1InPkcs8(pkcs1: Uint8Array): Uint8Array {
  const algorithmIdentifier = new Uint8Array([
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
  ])
  const version = new Uint8Array([0x02, 0x01, 0x00])
  const octetString = derTlv(0x04, pkcs1)
  const body = new Uint8Array(version.length + algorithmIdentifier.length + octetString.length)
  body.set(version, 0)
  body.set(algorithmIdentifier, version.length)
  body.set(octetString, version.length + algorithmIdentifier.length)
  return derTlv(0x30, body)
}

function derTlv(tag: number, value: Uint8Array): Uint8Array {
  let header: number[]
  if (value.length < 0x80) {
    header = [tag, value.length]
  } else if (value.length < 0x100) {
    header = [tag, 0x81, value.length]
  } else {
    header = [tag, 0x82, value.length >> 8, value.length & 0xff]
  }
  const result = new Uint8Array(header.length + value.length)
  result.set(header, 0)
  result.set(value, header.length)
  return result
}

function getCaValidationFailure(cert: x509.X509Certificate): string | undefined {
  const basicConstraints = cert.extensions.find(
    (extension): extension is x509.BasicConstraintsExtension => extension instanceof x509.BasicConstraintsExtension,
  )
  if (!basicConstraints?.ca) {
    return 'missing basicConstraints CA:TRUE'
  }

  const keyUsages = cert.extensions.find(
    (extension): extension is x509.KeyUsagesExtension => extension instanceof x509.KeyUsagesExtension,
  )
  if (keyUsages && (keyUsages.usages & x509.KeyUsageFlags.keyCertSign) === 0) {
    return 'keyUsage does not allow certificate signing'
  }

  return undefined
}

function getCaPemValidationFailure(pem: string): string | undefined {
  try {
    return getCaValidationFailure(new x509.X509Certificate(pem))
  } catch (error) {
    return error instanceof Error ? `cannot parse CA certificate: ${error.message}` : 'cannot parse CA certificate'
  }
}

export interface CreateCaResult {
  caCertPath: string
  caKeyPath: string
}

// Mirror CertManager.create_ca.
export async function createCa(outputDir: string, name = 'devtest'): Promise<CreateCaResult> {
  const fs = requireNode('node:fs')
  const path = requireNode('node:path')
  const crypto = getCrypto()
  x509.cryptoProvider.set(crypto)

  fs.mkdirSync(outputDir, { recursive: true })
  const caKeyPath = path.join(outputDir, `${name}_ca_key.pem`)
  const caCertPath = path.join(outputDir, `${name}_ca_cert.pem`)

  const organization = `${name}'s Dev Test Environment`
  const subject = `C=US, ST=California, L=San Jose, O=${organization}, OU=Test, CN=${name}`

  const keys = await crypto.subtle.generateKey(CA_SIGNING_ALG, true, ['sign', 'verify'])
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: randomSerialNumber(),
    name: subject,
    notBefore: new Date(),
    notAfter: daysFromNow(CA_VALIDITY_DAYS),
    signingAlgorithm: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    keys,
    extensions: [
      new x509.BasicConstraintsExtension(true, undefined, true),
      new x509.KeyUsagesExtension(
        x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign | x509.KeyUsageFlags.digitalSignature,
        true,
      ),
      await x509.SubjectKeyIdentifierExtension.create(keys.publicKey),
    ],
  })

  fs.writeFileSync(caKeyPath, await exportPrivateKeyPem(keys.privateKey))
  fs.writeFileSync(caCertPath, cert.toString('pem'))
  console.log(`CA certificate created: ${caCertPath}`)
  return { caCertPath, caKeyPath }
}

// Mirror make_config _check_or_generate_ca: reuse the CA when it already exists.
export async function ensureCa(caDir: string, name = 'devtest'): Promise<CreateCaResult> {
  const fs = requireNode('node:fs')
  const path = requireNode('node:path')
  const caCertPath = path.join(caDir, `${name}_ca_cert.pem`)
  const caKeyPath = path.join(caDir, `${name}_ca_key.pem`)
  if (fs.existsSync(caCertPath) && fs.existsSync(caKeyPath)) {
    const validationFailure = getCaPemValidationFailure(fs.readFileSync(caCertPath, 'utf8'))
    if (validationFailure) {
      console.log(`Existing CA at ${caCertPath} is invalid (${validationFailure}); regenerating`)
      return createCa(caDir, name)
    }
    console.log(`Use existing CA at: ${caCertPath}`)
    return { caCertPath, caKeyPath }
  }
  return createCa(caDir, name)
}

function findCaFiles(caDir: string): { caCertPath: string; caKeyPath: string } {
  const fs = requireNode('node:fs')
  const path = requireNode('node:path')
  const certFiles = (fs.readdirSync(caDir) as string[]).filter(f => f.endsWith('_ca_cert.pem'))
  if (certFiles.length === 0) {
    throw new Error(`No CA certificate found matching *_ca_cert.pem pattern in ${caDir}`)
  }
  if (certFiles.length > 1) {
    throw new Error(`Multiple CA certificates found in ${caDir}: ${certFiles.join(', ')}`)
  }
  const caCertPath = path.join(caDir, certFiles[0])
  const caKeyPath = path.join(caDir, certFiles[0].replace('_ca_cert.pem', '_ca_key.pem'))
  if (!fs.existsSync(caKeyPath)) {
    throw new Error(`CA key not found: ${caKeyPath}`)
  }
  return { caCertPath, caKeyPath }
}

interface IssuedX509Cert {
  cert: x509.X509Certificate
  certPem: string
  privateKeyPem: string
  caCert: x509.X509Certificate
  caCertPem: string
  caCertPath: string
  publicKeyFingerprint: string
}

async function issueX509CertFromCa(
  caDir: string,
  dnsNames: string[],
  uriSans: string[] = [],
  usage: Extract<IdentityUsage, 'server' | 'client'> = 'server',
): Promise<IssuedX509Cert> {
  const fs = requireNode('node:fs')
  const crypto = getCrypto()
  x509.cryptoProvider.set(crypto)

  const { caCertPath, caKeyPath } = findCaFiles(caDir)
  const caCertPem = fs.readFileSync(caCertPath, 'utf8')
  const caCert = new x509.X509Certificate(caCertPem)
  const validationFailure = getCaValidationFailure(caCert)
  if (validationFailure) {
    throw new Error(`Invalid CA certificate at ${caCertPath}: ${validationFailure}`)
  }
  const caKey = await importRsaPrivateKeyPem(fs.readFileSync(caKeyPath, 'utf8'))
  const commonName = dnsNames[0]
  if (!commonName) {
    throw new Error('At least one DNS SAN is required when creating an X.509 certificate')
  }

  const keys = await crypto.subtle.generateKey(SERVER_SIGNING_ALG, true, ['sign', 'verify'])
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', keys.publicKey))
  const publicKeyFingerprint = await sha256Fingerprint(spki)
  const sanNames = [
    ...dnsNames.map(dns => ({ type: 'dns' as const, value: dns })),
    ...uriSans.map(uri => ({ type: 'url' as const, value: uri })),
  ]

  const cert = await x509.X509CertificateGenerator.create({
    serialNumber: randomSerialNumber(),
    subject: `CN=${commonName}`,
    issuer: caCert.subject,
    notBefore: new Date(),
    notAfter: daysFromNow(CERT_VALIDITY_DAYS),
    signingAlgorithm: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    publicKey: keys.publicKey,
    signingKey: caKey,
    extensions: [
      new x509.KeyUsagesExtension(
        x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.keyEncipherment,
        true,
      ),
      new x509.ExtendedKeyUsageExtension([
        usage === 'client' ? x509.ExtendedKeyUsage.clientAuth : x509.ExtendedKeyUsage.serverAuth,
      ]),
      new x509.SubjectAlternativeNameExtension(sanNames),
      await x509.SubjectKeyIdentifierExtension.create(keys.publicKey),
      await x509.AuthorityKeyIdentifierExtension.create(caCert),
    ],
  })

  return {
    cert,
    certPem: cert.toString('pem'),
    privateKeyPem: await exportPrivateKeyPem(keys.privateKey),
    caCert,
    caCertPem,
    caCertPath,
    publicKeyFingerprint,
  }
}

export interface CreateCertResult {
  certPath: string
  keyPath: string
}

// Mirror CertManager.create_cert_from_ca.
export async function createCertFromCa(
  caDir: string,
  hostname: string,
  targetDir: string,
  hostnames?: string[],
): Promise<CreateCertResult> {
  const fs = requireNode('node:fs')
  const path = requireNode('node:path')

  const dnsNames = hostnames && hostnames.length > 0 ? hostnames : [hostname]
  const commonName = dnsNames[0]

  const safeHostname = commonName.replace(/\*/g, 'wildcard').replace(/\./g, '_')
  fs.mkdirSync(targetDir, { recursive: true })
  const certPath = path.join(targetDir, `${safeHostname}.crt`)
  const keyPath = path.join(targetDir, `${safeHostname}.key`)

  const issued = await issueX509CertFromCa(caDir, dnsNames)
  fs.writeFileSync(keyPath, issued.privateKeyPem)
  fs.writeFileSync(certPath, issued.certPem)
  console.log(`Certificate created: ${certPath}`)
  return { certPath, keyPath }
}

function normalizePem(pem: string): string {
  return `${pem.trimEnd()}\n`
}

function writeFileAtomicSync(filePath: string, content: string, mode?: number): void {
  const fs = requireNode('node:fs')
  const path = requireNode('node:path')
  const dir = path.dirname(filePath)
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`)
  try {
    fs.writeFileSync(tempPath, content, mode === undefined ? undefined : { mode })
    try {
      const fd = fs.openSync(tempPath, 'r')
      try {
        fs.fsyncSync(fd)
      } finally {
        fs.closeSync(fd)
      }
    } catch {
      // Some runtimes/filesystems do not allow fsync here; rename still keeps
      // callers from observing a partially written file.
    }
    fs.renameSync(tempPath, filePath)
  } catch (error) {
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath)
      }
    } catch {
      // ignore cleanup errors
    }
    throw error
  }
}

function writeJsonAtomicSync(filePath: string, value: unknown, mode?: number): void {
  writeFileAtomicSync(filePath, `${JSON.stringify(value, null, 2)}\n`, mode)
}

function resolveIdentityRoots(roots: IdentityRoots | IdentityRootsOptions): IdentityRoots {
  return roots instanceof IdentityRoots ? roots : IdentityRoots.fromEnvOrBuckyosRoot(roots)
}

function x509DnsNameForDid(did: DID): string {
  const rawHostName = did.toRawHostName()
  if (rawHostName.startsWith('_.')) {
    return `*.${rawHostName.slice(2)}`
  }
  return rawHostName
}

function getSubjectAlternativeNames(cert: x509.X509Certificate): { dns: string[]; uri: string[] } {
  const sanExtension = cert.extensions.find(
    (extension): extension is x509.SubjectAlternativeNameExtension => extension instanceof x509.SubjectAlternativeNameExtension,
  )
  const names = (sanExtension?.names.toJSON() ?? []) as Array<{ type: string; value: string }>
  return {
    dns: names.filter(name => name.type === 'dns').map(name => name.value),
    uri: names.filter(name => name.type === 'url').map(name => name.value),
  }
}

async function certificateFingerprint(cert: x509.X509Certificate): Promise<string> {
  const thumbprint = await cert.getThumbprint('SHA-256', getCrypto())
  return `sha256:${bytesToHex(new Uint8Array(thumbprint))}`
}

function buildDidBinding(did: DID): Record<string, unknown> | undefined {
  if (did.method !== 'web' || did.toRawHostName().startsWith('_.')) {
    return undefined
  }
  const didString = did.toString()
  return {
    type: 'did-web-domain',
    did: didString,
    web_origin: `https://${did.toRawHostName()}`,
    did_document_url: didWebDocumentUrl(didString),
  }
}

async function buildX509Metadata(
  did: DID,
  usage: IdentityUsage,
  paths: X509Paths,
  rawHostUri: string,
  dirName: string,
  issued: IssuedX509Cert,
): Promise<Record<string, unknown>> {
  const san = getSubjectAlternativeNames(issued.cert)
  const certFingerprint = await certificateFingerprint(issued.cert)
  const isWildcard = rawHostUri.startsWith('_.')
  const updatedAt = new Date().toISOString()
  return {
    schema: X509_METADATA_SCHEMA,
    did: did.toString(),
    raw_host_uri: rawHostUri,
    dir_name: dirName,
    usage,
    match: isWildcard
      ? { type: 'wildcard', host_pattern: `*.${rawHostUri.slice(2)}` }
      : { type: 'exact', host: rawHostUri },
    certificate: {
      serial_number: issued.cert.serialNumber,
      issuer: issued.cert.issuer,
      subject: issued.cert.subject,
      not_before: issued.cert.notBefore.toISOString(),
      not_after: issued.cert.notAfter.toISOString(),
      fingerprint_sha256: certFingerprint,
      public_key_fingerprint: issued.publicKeyFingerprint,
    },
    san,
    paths: {
      cert: identityFileName(usage, 'cert'),
      chain: identityFileName(usage, 'chain'),
      fullchain: identityFileName(usage, 'fullchain'),
      ca: identityFileName(usage, 'ca'),
      key_ref: paths.keyref,
    },
    did_binding: buildDidBinding(did),
    updated_at: updatedAt,
    generation: `${updatedAt.replace(/[-:.]/g, '')}-${certFingerprint}`,
  }
}

function buildFileKeyRef(
  did: DID,
  usage: IdentityUsage,
  privateKeyPath: string,
  publicKeyFingerprint: string,
): Record<string, unknown> {
  return {
    schema: KEYREF_SCHEMA,
    kind: 'key',
    did: did.toString(),
    usage,
    algorithm: 'RSA-2048',
    public_key_fingerprint: publicKeyFingerprint,
    mode: 'file',
    exportable: true,
    ref: {
      type: 'file',
      path: privateKeyPath,
      format: 'pkcs8-pem',
    },
  }
}

export async function createIdentityCertFromCa(
  caDir: string,
  didOrHostname: string,
  rootsInput: IdentityRoots | IdentityRootsOptions,
  options: CreateIdentityCertFromCaOptions = {},
): Promise<CreateIdentityCertResult> {
  const fs = requireNode('node:fs')
  const roots = resolveIdentityRoots(rootsInput)
  const usage = options.usage ?? 'server'
  const did = canonicalIdentityDid(didOrHostname)
  const rawHostUri = did.toRawHostUri()
  const dirName = encodeIdentityDirName(rawHostUri)
  const publicDir = roots.publicDir(did.toString())
  const securityDir = roots.securityDir(did.toString())
  const paths = x509PathsForDirs(publicDir, securityDir, usage)
  const dnsNames = options.hostnames && options.hostnames.length > 0
    ? options.hostnames
    : [x509DnsNameForDid(did)]
  const uriSans = options.uriSans ?? [did.toString()]

  fs.mkdirSync(publicDir, { recursive: true, mode: 0o755 })
  fs.mkdirSync(securityDir, { recursive: true, mode: 0o700 })

  const issued = await issueX509CertFromCa(caDir, dnsNames, uriSans, usage)
  const certPem = normalizePem(issued.certPem)
  const caPem = normalizePem(issued.caCertPem)
  const chainPem = caPem
  const fullchainPem = `${certPem}${chainPem}`

  writeFileAtomicSync(paths.privateKey, issued.privateKeyPem, 0o600)
  writeJsonAtomicSync(paths.keyref, buildFileKeyRef(did, usage, paths.privateKey, issued.publicKeyFingerprint), 0o600)
  writeFileAtomicSync(paths.cert, certPem, 0o644)
  writeFileAtomicSync(paths.chain, chainPem, 0o644)
  writeFileAtomicSync(paths.fullchain, fullchainPem, 0o644)
  writeFileAtomicSync(paths.ca, caPem, 0o644)
  writeJsonAtomicSync(paths.metadata, await buildX509Metadata(did, usage, paths, rawHostUri, dirName, issued), 0o644)

  console.log(`Identity certificate created: ${paths.fullchain}`)
  return {
    did: did.toString(),
    rawHostUri,
    dirName,
    paths,
    certPath: paths.cert,
    chainPath: paths.chain,
    fullchainPath: paths.fullchain,
    caPath: paths.ca,
    keyPath: paths.privateKey,
    keyRefPath: paths.keyref,
    metadataPath: paths.metadata,
  }
}
