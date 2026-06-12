// cert: node-only TLS CA / server certificate generation for dev environments.
// TypeScript replacement of buckyos_devkit CertManager (cert_mgr.py), built on
// @peculiar/x509 (pure JS + WebCrypto, no native dependency, no openssl).
//
// Behavior contract (mirrors cert_mgr.py):
// - createCa(outputDir, name): RSA-4096 self-signed CA, 3650 days,
//   subject C=US/ST=California/L=San Jose/O={name}'s Dev Test Environment/OU=Test/CN={name},
//   files {name}_ca_cert.pem + {name}_ca_key.pem
// - createCertFromCa(caDir, hostname, targetDir, hostnames?): finds the single
//   *_ca_cert.pem in caDir, issues an RSA-2048 server cert for 365 days with
//   CN=hostnames[0], SAN DNS entries (wildcards like *.zone supported),
//   keyUsage critical digitalSignature+keyEncipherment, extendedKeyUsage
//   serverAuth; files {safeHostname}.crt + {safeHostname}.key

import * as x509 from '@peculiar/x509'

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
  const crypto = getCrypto()
  x509.cryptoProvider.set(crypto)

  const { caCertPath, caKeyPath } = findCaFiles(caDir)
  const caCert = new x509.X509Certificate(fs.readFileSync(caCertPath, 'utf8'))
  const caKey = await importRsaPrivateKeyPem(fs.readFileSync(caKeyPath, 'utf8'))

  const dnsNames = hostnames && hostnames.length > 0 ? hostnames : [hostname]
  const commonName = dnsNames[0]

  const safeHostname = commonName.replace(/\*/g, 'wildcard').replace(/\./g, '_')
  fs.mkdirSync(targetDir, { recursive: true })
  const certPath = path.join(targetDir, `${safeHostname}.crt`)
  const keyPath = path.join(targetDir, `${safeHostname}.key`)

  const keys = await crypto.subtle.generateKey(SERVER_SIGNING_ALG, true, ['sign', 'verify'])
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
      new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.serverAuth]),
      new x509.SubjectAlternativeNameExtension(dnsNames.map(dns => ({ type: 'dns' as const, value: dns }))),
      await x509.SubjectKeyIdentifierExtension.create(keys.publicKey),
      await x509.AuthorityKeyIdentifierExtension.create(caCert),
    ],
  })

  fs.writeFileSync(keyPath, await exportPrivateKeyPem(keys.privateKey))
  fs.writeFileSync(certPath, cert.toString('pem'))
  console.log(`Certificate created: ${certPath}`)
  return { certPath, keyPath }
}
