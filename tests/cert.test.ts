import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as x509 from '@peculiar/x509'
import { execFileSync } from 'child_process'
import { webcrypto } from 'crypto'
import { createSecureContext } from 'tls'

import { createCa, ensureCa, createCertFromCa } from '../src/cert'

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
