import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as x509 from '@peculiar/x509'
import { execFileSync } from 'child_process'
import { webcrypto } from 'crypto'
import { createSecureContext } from 'tls'

import {
  IdentityRoots,
  createCa,
  createCertFromCa,
  createIdentityCertFromCa,
  didWebDocumentUrl,
  encodeIdentityDirName,
  ensureCa,
  identityDirName,
  identityFileName,
  identityRawHostUri,
} from '../src/cert'

jest.setTimeout(60000)

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function opensslAvailable(): boolean {
  try {
    execFileSync('openssl', ['version'], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

async function writeInvalidCaWithoutBasicConstraints(dir: string, name: string): Promise<string> {
  x509.cryptoProvider.set(webcrypto as unknown as Crypto)
  fs.mkdirSync(dir, { recursive: true })

  const keys = await webcrypto.subtle.generateKey({
    name: 'RSASSA-PKCS1-v1_5',
    hash: 'SHA-256',
    publicExponent: new Uint8Array([1, 0, 1]),
    modulusLength: 2048,
  }, true, ['sign', 'verify'])

  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: '01020304',
    name: `CN=${name}`,
    notBefore: new Date(),
    notAfter: new Date(Date.now() + 24 * 3600 * 1000),
    signingAlgorithm: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    keys: keys as unknown as CryptoKeyPair,
  })

  const caCertPath = path.join(dir, `${name}_ca_cert.pem`)
  const caKeyPath = path.join(dir, `${name}_ca_key.pem`)
  const keyDer = await webcrypto.subtle.exportKey('pkcs8', keys.privateKey)
  fs.writeFileSync(caCertPath, cert.toString('pem'))
  fs.writeFileSync(caKeyPath, x509.PemConverter.encode(keyDer, 'PRIVATE KEY'))
  return caCertPath
}

let consoleSpy: jest.SpyInstance
beforeAll(() => {
  consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
})
afterAll(() => {
  consoleSpy.mockRestore()
})

describe('cert (T3.1, replaces python CertManager)', () => {
  const caDir = tmpDir('cert-ca-')
  const certDir = tmpDir('cert-out-')
  const zone = 'test.buckyos.io'

  test('identity path helpers follow encoded raw host URI convention', () => {
    const roots = new IdentityRoots('/buckyos/local/identity', '/buckyos/security')

    expect(identityRawHostUri('did:web:example.com:user:alice')).toBe('example.com/user/alice')
    expect(encodeIdentityDirName('example.com/user/alice')).toBe('example.com%2Fuser%2Falice')
    expect(identityDirName('did:web:example.com:user:alice')).toBe('example.com%2Fuser%2Falice')
    expect(identityRawHostUri('did:bns:waterflier')).toBe('waterflier.bns.did')
    expect(identityDirName('*.example.com')).toBe('_.example.com')
    expect(didWebDocumentUrl('did:web:example.com:user:alice')).toBe('https://example.com/user/alice/did.json')
    expect(identityFileName('server', 'fullchain')).toBe('server.fullchain.pem')
    expect(identityFileName('authentication', 'public')).toBe('authentication.public.jwk')

    const paths = roots.x509Paths('did:web:example.com:user:alice')
    expect(paths.fullchain).toBe(path.join('/buckyos/local/identity', 'example.com%2Fuser%2Falice', 'server.fullchain.pem'))
    expect(paths.privateKey).toBe(path.join('/buckyos/security', 'example.com%2Fuser%2Falice', 'server.private.pem'))
  })

  test('IdentityRoots resolves explicit roots, env roots, and BUCKYOS_ROOT defaults', () => {
    const before = {
      BUCKYOS_IDENTITY_ROOT: process.env.BUCKYOS_IDENTITY_ROOT,
      BUCKYOS_SECURITY_ROOT: process.env.BUCKYOS_SECURITY_ROOT,
      BUCKYOS_ROOT: process.env.BUCKYOS_ROOT,
    }
    try {
      delete process.env.BUCKYOS_IDENTITY_ROOT
      delete process.env.BUCKYOS_SECURITY_ROOT
      process.env.BUCKYOS_ROOT = '/tmp/buckyos'

      let roots = IdentityRoots.fromEnvOrBuckyosRoot()
      expect(roots.publicRoot).toBe(path.resolve('/tmp/buckyos/local/identity'))
      expect(roots.securityRoot).toBe(path.resolve('/tmp/buckyos/security'))

      process.env.BUCKYOS_IDENTITY_ROOT = '/tmp/public-identities'
      process.env.BUCKYOS_SECURITY_ROOT = '/tmp/secure-identities'
      roots = IdentityRoots.fromEnvOrBuckyosRoot()
      expect(roots.publicRoot).toBe(path.resolve('/tmp/public-identities'))
      expect(roots.securityRoot).toBe(path.resolve('/tmp/secure-identities'))

      roots = IdentityRoots.fromEnvOrBuckyosRoot({
        publicRoot: '/explicit/public',
        securityRoot: '/explicit/security',
      })
      expect(roots.publicRoot).toBe(path.resolve('/explicit/public'))
      expect(roots.securityRoot).toBe(path.resolve('/explicit/security'))
    } finally {
      for (const [key, value] of Object.entries(before)) {
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
      }
    }
  })

  test('createCa writes {name}_ca_cert.pem / {name}_ca_key.pem', async () => {
    const { caCertPath, caKeyPath } = await createCa(caDir, 'buckyos_test_ca')
    expect(path.basename(caCertPath)).toBe('buckyos_test_ca_ca_cert.pem')
    expect(path.basename(caKeyPath)).toBe('buckyos_test_ca_ca_key.pem')
    expect(fs.readFileSync(caCertPath, 'utf8')).toContain('BEGIN CERTIFICATE')
    expect(fs.readFileSync(caKeyPath, 'utf8')).toContain('BEGIN PRIVATE KEY')
  })

  test('ensureCa reuses an existing CA', async () => {
    const before = fs.readFileSync(path.join(caDir, 'buckyos_test_ca_ca_cert.pem'), 'utf8')
    const { caCertPath } = await ensureCa(caDir, 'buckyos_test_ca')
    expect(fs.readFileSync(caCertPath, 'utf8')).toBe(before)
  })

  test('ensureCa regenerates an existing certificate that is not a valid CA', async () => {
    const invalidCaDir = tmpDir('cert-invalid-ca-')
    const caCertPath = await writeInvalidCaWithoutBasicConstraints(invalidCaDir, 'legacy')
    const before = fs.readFileSync(caCertPath, 'utf8')

    const { caCertPath: regeneratedCaCertPath } = await ensureCa(invalidCaDir, 'legacy')
    const after = fs.readFileSync(regeneratedCaCertPath, 'utf8')
    expect(after).not.toBe(before)

    const caCert = new x509.X509Certificate(after)
    const basicConstraints = caCert.extensions.find(
      (extension): extension is x509.BasicConstraintsExtension => extension instanceof x509.BasicConstraintsExtension,
    )
    expect(basicConstraints?.ca).toBe(true)

    const outDir = tmpDir('cert-regenerated-out-')
    const { certPath } = await createCertFromCa(invalidCaDir, zone, outDir)
    if (opensslAvailable()) {
      const verify = execFileSync('openssl', ['verify', '-CAfile', regeneratedCaCertPath, certPath]).toString()
      expect(verify).toContain('OK')
    }
  })

  test('createCertFromCa issues a SAN cert signed by the CA', async () => {
    const { certPath, keyPath } = await createCertFromCa(caDir, zone, certDir, [zone, `*.${zone}`])
    expect(path.basename(certPath)).toBe('test_buckyos_io.crt')
    expect(path.basename(keyPath)).toBe('test_buckyos_io.key')

    // the cert/key pair must be loadable by the node TLS stack
    expect(() => createSecureContext({
      cert: fs.readFileSync(certPath, 'utf8'),
      key: fs.readFileSync(keyPath, 'utf8'),
    })).not.toThrow()

    if (!opensslAvailable()) {
      console.warn('openssl not available, skipping openssl checks')
      return
    }
    const text = execFileSync('openssl', ['x509', '-in', certPath, '-text', '-noout']).toString()
    expect(text).toContain(`DNS:${zone}`)
    expect(text).toContain(`DNS:*.${zone}`)
    expect(text).toContain('TLS Web Server Authentication')
    expect(text).toContain('Digital Signature, Key Encipherment')
    expect(text).toContain(`CN=${zone}`)

    // chain verification against the CA
    const verify = execFileSync('openssl', [
      'verify', '-CAfile', path.join(caDir, 'buckyos_test_ca_ca_cert.pem'), certPath,
    ]).toString()
    expect(verify).toContain('OK')
  })

  test('createIdentityCertFromCa installs server materials using identity path protocol', async () => {
    const publicRoot = tmpDir('identity-public-')
    const securityRoot = tmpDir('identity-security-')
    const roots = new IdentityRoots(publicRoot, securityRoot)
    const did = 'did:web:example.com:user:alice'

    const result = await createIdentityCertFromCa(caDir, did, roots)
    expect(result.did).toBe(did)
    expect(result.rawHostUri).toBe('example.com/user/alice')
    expect(result.dirName).toBe('example.com%2Fuser%2Falice')
    expect(result.fullchainPath).toBe(path.join(publicRoot, 'example.com%2Fuser%2Falice', 'server.fullchain.pem'))
    expect(result.keyPath).toBe(path.join(securityRoot, 'example.com%2Fuser%2Falice', 'server.private.pem'))

    for (const filePath of [
      result.paths.cert,
      result.paths.chain,
      result.paths.fullchain,
      result.paths.ca,
      result.paths.metadata,
      result.paths.keyref,
      result.paths.privateKey,
    ]) {
      expect(fs.existsSync(filePath)).toBe(true)
    }
    expect(fs.existsSync(path.join(publicRoot, result.dirName, 'server.private.pem'))).toBe(false)

    expect(() => createSecureContext({
      cert: fs.readFileSync(result.paths.fullchain, 'utf8'),
      key: fs.readFileSync(result.paths.privateKey, 'utf8'),
    })).not.toThrow()

    const keyref = JSON.parse(fs.readFileSync(result.paths.keyref, 'utf8'))
    expect(keyref).toMatchObject({
      schema: 'buckyos.identity.keyref.v1',
      kind: 'key',
      did,
      usage: 'server',
      algorithm: 'RSA-2048',
      mode: 'file',
      exportable: true,
      ref: {
        type: 'file',
        path: result.paths.privateKey,
        format: 'pkcs8-pem',
      },
    })
    expect(keyref.public_key_fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)

    const metadata = JSON.parse(fs.readFileSync(result.paths.metadata, 'utf8'))
    expect(metadata).toMatchObject({
      schema: 'buckyos.identity.x509.metadata.v1',
      did,
      raw_host_uri: 'example.com/user/alice',
      dir_name: 'example.com%2Fuser%2Falice',
      usage: 'server',
      match: { type: 'exact', host: 'example.com/user/alice' },
      san: {
        dns: ['example.com'],
        uri: [did],
      },
      paths: {
        cert: 'server.cert.pem',
        chain: 'server.chain.pem',
        fullchain: 'server.fullchain.pem',
        ca: 'server.ca.pem',
        key_ref: result.paths.keyref,
      },
      did_binding: {
        type: 'did-web-domain',
        did,
        web_origin: 'https://example.com',
        did_document_url: 'https://example.com/user/alice/did.json',
      },
    })
    expect(metadata.certificate.not_after).toEqual(expect.any(String))
    expect(metadata.certificate.fingerprint_sha256).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(metadata.certificate.public_key_fingerprint).toBe(keyref.public_key_fingerprint)

    if (opensslAvailable()) {
      const verify = execFileSync('openssl', [
        'verify', '-CAfile', result.paths.ca, result.paths.cert,
      ]).toString()
      expect(verify).toContain('OK')

      const text = execFileSync('openssl', ['x509', '-in', result.paths.cert, '-text', '-noout']).toString()
      expect(text).toContain('DNS:example.com')
      expect(text).toContain(`URI:${did}`)
    }
  })

  test('findX509Paths prefers exact identity dir before wildcard dir', () => {
    const publicRoot = tmpDir('identity-match-public-')
    const securityRoot = tmpDir('identity-match-security-')
    const roots = new IdentityRoots(publicRoot, securityRoot)
    const wildcardFullchain = roots.publicFile('*.example.com', 'server', 'fullchain')
    fs.mkdirSync(path.dirname(wildcardFullchain), { recursive: true })
    fs.writeFileSync(wildcardFullchain, 'wildcard')

    let match = roots.findX509Paths('api.example.com')
    expect(match?.match.type).toBe('wildcard')
    expect(match?.match.rawHostUri).toBe('_.example.com')
    expect(match?.paths.fullchain).toBe(wildcardFullchain)

    expect(roots.findX509Paths('example.com')).toBeNull()
    expect(roots.findX509Paths('a.b.example.com')).toBeNull()

    const exactFullchain = roots.publicFile('api.example.com', 'server', 'fullchain')
    fs.mkdirSync(path.dirname(exactFullchain), { recursive: true })
    fs.writeFileSync(exactFullchain, 'exact')

    match = roots.findX509Paths('api.example.com')
    expect(match?.match.type).toBe('exact')
    expect(match?.paths.fullchain).toBe(exactFullchain)
  })

  test('wildcard primary hostname maps to a safe filename', async () => {
    const outDir = tmpDir('cert-wild-')
    const { certPath } = await createCertFromCa(caDir, `*.web3.devtests.org`, outDir)
    expect(path.basename(certPath)).toBe('wildcard_web3_devtests_org.crt')
  })

  test('errors when the CA directory has no CA', async () => {
    const emptyDir = tmpDir('cert-empty-')
    await expect(createCertFromCa(emptyDir, 'a.com', emptyDir)).rejects.toThrow('No CA certificate found')
  })
})
