import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execFileSync } from 'child_process'
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
