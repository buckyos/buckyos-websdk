import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createPublicKey, verify as cryptoVerify } from 'crypto'

import {
  ACTIVATION_LOCK_FILE_NAME,
  ActivationError,
  activateOfflineZone,
  checkOfflineActivation,
  hashAdminPassword,
  inspectActivationRoot,
  validateOwnerName,
  validateZoneDomain,
} from '../src/provision'
import { hashPassword } from '../src/account'

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function decodeJwt(jwt: string): Record<string, any> {
  const parts = jwt.split('.')
  expect(parts).toHaveLength(3)
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
}

function verifyJwt(jwt: string, publicJwk: Record<string, unknown>): boolean {
  const parts = jwt.split('.')
  return cryptoVerify(
    null,
    Buffer.from(`${parts[0]}.${parts[1]}`, 'utf8'),
    createPublicKey({ key: publicJwk as any, format: 'jwk' }),
    Buffer.from(parts[2], 'base64url'),
  )
}

function listFiles(rootDir: string): string[] {
  const result: string[] = []
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const entryPath = path.join(rootDir, entry.name)
    if (entry.isDirectory()) result.push(...listFiles(entryPath))
    else if (entry.isFile()) result.push(entryPath)
  }
  return result
}

function makeInstalledRoot(sandbox: string): string {
  const rootDir = path.join(sandbox, 'root')
  fs.mkdirSync(path.join(rootDir, 'bin'), { recursive: true })
  fs.mkdirSync(path.join(rootDir, 'etc'), { recursive: true })
  return rootDir
}

async function expectActivationError(run: () => Promise<unknown>, code: string): Promise<ActivationError> {
  try {
    await run()
  } catch (error) {
    expect(error).toBeInstanceOf(ActivationError)
    expect((error as ActivationError).code).toBe(code)
    return error as ActivationError
  }
  throw new Error(`expected ActivationError ${code}`)
}

describe('offline activation API', () => {
  let sandbox: string
  beforeEach(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'provision-activate-'))
  })
  afterEach(() => {
    fs.rmSync(sandbox, { recursive: true, force: true })
  })

  test('status reports not_installed and unactivated roots', async () => {
    expect((await inspectActivationRoot(path.join(sandbox, 'missing'))).state).toBe('not_installed')
    const partialInstall = path.join(sandbox, 'no-bin')
    fs.mkdirSync(path.join(partialInstall, 'etc'), { recursive: true })
    expect((await inspectActivationRoot(partialInstall)).state).toBe('not_installed')

    const rootDir = makeInstalledRoot(sandbox)
    // make_config's unactivated placeholder must not count as activation material
    fs.writeFileSync(
      path.join(rootDir, 'etc', 'node_gateway_params.json'),
      JSON.stringify({ params: { device_did: 'did:bns:unactivated.local' } }),
    )
    const status = await inspectActivationRoot(rootDir)
    expect(status.state).toBe('unactivated')
    expect(status.startupRequired).toBe(false)
    expect(status.problems).toEqual([])
    expect(status.lock).toBeNull()
  })

  test('check is read-only and reports the planned activation', async () => {
    const rootDir = makeInstalledRoot(sandbox)
    const backupDir = path.join(sandbox, 'backup')
    fs.mkdirSync(backupDir)
    const before = listFiles(sandbox)
    const precheck = await checkOfflineActivation({
      rootDir,
      domain: 'Corp.Example.com.',
      ownerName: 'Admin',
      ownerKeyBackupPath: path.join(backupDir, 'owner.pem'),
      publicIp: '2001:db8::10',
    })
    expect(listFiles(sandbox)).toEqual(before)
    expect(precheck.ready).toBe(true)
    expect(precheck.state).toBe('unactivated')
    expect(precheck.domain).toBe('corp.example.com')
    expect(precheck.ownerName).toBe('admin')
    expect(precheck.ownerDid).toBe('did:web:corp.example.com')
    expect(precheck.zoneDid).toBe('did:web:corp.example.com')
    expect(precheck.deviceDid).toBe('did:web:ood1.corp.example.com')
    expect(precheck.rtcpPort).toBe(2980)
    expect(precheck.guestAccess).toBe(false)
    expect(precheck.dnsRecords).toEqual([{ type: 'AAAA', name: 'corp.example.com', value: '2001:db8::10' }])
    expect(precheck.ownerKeyBackup).toEqual({
      path: path.join(backupDir, 'owner.pem'),
      directoryExists: true,
      exists: false,
    })
    expect(precheck.plannedFiles.map(file => file.path)).toEqual([
      'security/ood1.corp.example.com/authentication.private.pem',
      'local/identity/ood1.corp.example.com/did.json',
      'local/identity/ood1.corp.example.com/device_doc.jwt',
      'local/identity/ood1.corp.example.com/device_mini_doc.jwt',
      'etc/corp.example.com.zone.json',
      'etc/zone_document.jwt',
      'etc/zone_dns_records.json',
      'etc/start_config.json',
      'etc/node_gateway_params.json',
      'etc/node_identity.json',
    ])
    expect(precheck.plannedFiles.filter(file => file.secret).map(file => file.path)).toEqual([
      'security/ood1.corp.example.com/authentication.private.pem',
    ])
  })

  test('check reports backup and target problems without throwing', async () => {
    const rootDir = makeInstalledRoot(sandbox)
    const existing = path.join(sandbox, 'existing.pem')
    fs.writeFileSync(existing, 'x')
    const precheck = await checkOfflineActivation({
      rootDir,
      domain: 'corp.example.com',
      ownerName: 'admin',
      ownerKeyBackupPath: existing,
    })
    expect(precheck.ready).toBe(false)
    expect(precheck.problems.map(problem => problem.code)).toEqual(['OWNER_KEY_BACKUP_EXISTS'])

    const missingDir = await checkOfflineActivation({
      rootDir: path.join(sandbox, 'nowhere'),
      domain: 'corp.example.com',
      ownerName: 'admin',
      ownerKeyBackupPath: path.join(sandbox, 'no-such-dir', 'owner.pem'),
    })
    expect(missingDir.problems.map(problem => problem.code)).toEqual([
      'TARGET_NOT_INSTALLED',
      'OWNER_KEY_BACKUP_DIRECTORY_MISSING',
    ])
  })

  test('parameter validation mirrors active.ts', async () => {
    expect(validateZoneDomain('HOME.Example.com.')).toBe('home.example.com')
    for (const invalid of ['localhost', '-home.example.com', 'home_example.com', '']) {
      expect(() => validateZoneDomain(invalid)).toThrow(ActivationError)
    }
    expect(validateOwnerName(' Alice ')).toBe('alice')
    expect(() => validateOwnerName('-alice')).toThrow(ActivationError)
    expect(hashAdminPassword('alice', 'test-password')).toBe(hashPassword('alice', 'test-password', null))

    const rootDir = makeInstalledRoot(sandbox)
    const base = { rootDir, domain: 'corp.example.com', ownerName: 'admin', ownerKeyBackupPath: path.join(sandbox, 'o.pem') }
    await expectActivationError(() => checkOfflineActivation({ ...base, rtcpPort: 70000 }), 'INVALID_ARGUMENT')
    await expectActivationError(() => checkOfflineActivation({ ...base, publicIp: '999.1.1.1' }), 'INVALID_ARGUMENT')
    await expectActivationError(
      () => activateOfflineZone({ ...base, adminPassword: 'short' }),
      'INVALID_ARGUMENT',
    )
    expect(listFiles(sandbox)).toEqual([])
  })

  test('activation writes a self-contained did:web identity and refuses to repeat', async () => {
    const rootDir = makeInstalledRoot(sandbox)
    const backupDir = path.join(sandbox, 'backup')
    fs.mkdirSync(backupDir)
    const ownerKeyBackupPath = path.join(backupDir, 'owner.pem')
    const before = Math.floor(Date.now() / 1000)
    const result = await activateOfflineZone({
      rootDir,
      domain: 'Home.Example.com.',
      ownerName: 'alice',
      adminPassword: 'test-password',
      ownerKeyBackupPath,
      publicIp: '203.0.113.10',
      rtcpPort: 2981,
      traceId: 'trace-1',
    })
    const after = Math.floor(Date.now() / 1000)

    expect(result.state).toBe('configured')
    expect(result.startupRequired).toBe(true)
    expect(result.ownerDid).toBe('did:web:home.example.com')
    expect(result.zoneDid).toBe(result.ownerDid)
    expect(result.deviceDid).toBe('did:web:ood1.home.example.com')
    expect(result.accessHostname).toBe('home.example.com')
    expect(result.ownerKeyBackup).toEqual({ path: ownerKeyBackupPath, saved: true })
    expect(result.dnsRecords).toEqual([{ type: 'A', name: 'home.example.com', value: '203.0.113.10' }])
    expect(result.warnings).toEqual([])
    expect(result.committedFiles.map(file => file.path).at(-1)).toBe('etc/node_identity.json')
    expect(result.committedFiles.find(file => file.secret)?.sha256).toBeNull()
    for (const file of result.committedFiles.filter(file => !file.secret)) {
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/)
    }
    expect(fs.existsSync(path.join(rootDir, 'etc', ACTIVATION_LOCK_FILE_NAME))).toBe(false)
    expect(JSON.stringify(result)).not.toContain('PRIVATE KEY')
    expect(JSON.stringify(result)).not.toContain('test-password')

    // owner key backup: private, matches the owner document key
    const backupPem = fs.readFileSync(ownerKeyBackupPath, 'utf8')
    expect(backupPem).toContain('PRIVATE KEY')
    if (process.platform !== 'win32') {
      expect(fs.statSync(ownerKeyBackupPath).mode & 0o777).toBe(0o600)
    }

    const startConfig = readJson(path.join(rootDir, 'etc', 'start_config.json'))
    expect(startConfig.user_name).toBe('alice')
    expect(startConfig.zone_name).toBe(result.zoneDid)
    expect(startConfig.access_hostname).toBe('home.example.com')
    expect(startConfig.owner_document.id).toBe(result.ownerDid)
    expect(startConfig.owner_document.name).toBe('alice')
    expect(startConfig.owner_document.binded_zone_list).toEqual([result.zoneDid])
    expect(startConfig.owner_document.zone_binding_model_version).toBe(2)
    expect(startConfig.owner_document.verificationMethod[0].controller).toBe(result.ownerDid)
    expect(startConfig.admin_password_hash).toBe(hashAdminPassword('alice', 'test-password'))
    expect(startConfig.guest_access).toBe(false)
    expect(startConfig.friend_passcode).toBe('')
    expect(startConfig.enabled_features).toEqual({})
    expect(startConfig.ood_jwt).toBe(startConfig.device_doc_jwt)
    for (const key of ['private_key', 'device_private_key', 'sn_access_token', 'bns_evm_private_key']) {
      expect(startConfig).not.toHaveProperty(key)
    }
    const ownerPublicJwk = startConfig.owner_document.verificationMethod[0].publicKeyJwk
    const backupPublicJwk = createPublicKey(backupPem).export({ format: 'jwk' }) as { x: string }
    expect(ownerPublicJwk.x).toBe(backupPublicJwk.x)

    const boot = decodeJwt(startConfig.boot_config_jwt)
    const device = decodeJwt(startConfig.device_doc_jwt)
    const mini = decodeJwt(startConfig.device_mini_doc_jwt)
    const zone = decodeJwt(startConfig.zone_document_jwt)
    for (const jwt of [
      startConfig.boot_config_jwt,
      startConfig.device_doc_jwt,
      startConfig.device_mini_doc_jwt,
      startConfig.zone_document_jwt,
    ]) {
      expect(verifyJwt(jwt, ownerPublicJwk)).toBe(true)
    }
    expect(Object.keys(boot).sort()).toEqual(['exp', 'id', 'oods'])
    expect(boot.id).toBe(result.zoneDid)
    expect(boot.oods).toEqual(['ood1@wan'])
    expect(boot.exp).toBeGreaterThan(after)
    const bootOverride = readJson(path.join(rootDir, 'etc', 'home.example.com.zone.json'))
    expect(JSON.stringify(bootOverride)).toBe(JSON.stringify(boot))

    expect(device.id).toBe(result.deviceDid)
    expect(device.owner).toBe(result.ownerDid)
    expect(device.zone_did).toBe(result.zoneDid)
    expect(device.net_id).toBe('wan')
    expect(device.rtcp_port).toBe(2981)
    expect(device).not.toHaveProperty('ddns_sn_url')
    expect(mini).toMatchObject({ n: 'ood1', x: device.verificationMethod[0].publicKeyJwk.x, p: 2981 })
    expect(zone.id).toBe(result.zoneDid)
    expect(zone.owner).toBe(result.ownerDid)
    expect(zone.hostname).toBe('home.example.com')
    expect(zone.boot_jwt).toBe(startConfig.boot_config_jwt)
    expect(zone.devices.ood1.id).toBe(result.deviceDid)
    expect(zone.mini_device_jwts.ood1).toBe(startConfig.device_mini_doc_jwt)
    expect(zone).not.toHaveProperty('sn')
    for (const document of [device, mini, zone]) {
      expect(document.iat).toBeGreaterThanOrEqual(before)
      expect(document.iat).toBeLessThanOrEqual(after)
      expect(document.exp).toBeGreaterThan(document.iat)
    }
    expect(fs.readFileSync(path.join(rootDir, 'etc', 'zone_document.jwt'), 'utf8')).toBe(startConfig.zone_document_jwt)

    const nodeIdentity = readJson(path.join(rootDir, 'etc', 'node_identity.json'))
    expect(nodeIdentity).toEqual({
      schema: 'buckyos.node_identity.v2',
      zone_did: result.zoneDid,
      owner_did: result.ownerDid,
      owner_public_key: ownerPublicJwk,
      device_name: 'ood1',
      device_did: result.deviceDid,
      zone_iat: zone.iat,
    })
    expect(readJson(path.join(rootDir, 'etc', 'node_gateway_params.json'))).toEqual({
      params: { device_did: result.deviceDid },
    })
    const identityDir = path.join(rootDir, 'local', 'identity', 'ood1.home.example.com')
    expect(readJson(path.join(identityDir, 'did.json')).id).toBe(result.deviceDid)
    expect(fs.readFileSync(path.join(identityDir, 'device_doc.jwt'), 'utf8')).toBe(startConfig.device_doc_jwt)
    expect(fs.readFileSync(path.join(identityDir, 'device_mini_doc.jwt'), 'utf8')).toBe(startConfig.device_mini_doc_jwt)
    const privateKeyPath = path.join(rootDir, 'security', 'ood1.home.example.com', 'authentication.private.pem')
    const devicePublicJwk = createPublicKey(fs.readFileSync(privateKeyPath, 'utf8')).export({ format: 'jwk' }) as { x: string }
    expect(devicePublicJwk.x).toBe(device.verificationMethod[0].publicKeyJwk.x)
    if (process.platform !== 'win32') {
      expect(fs.statSync(privateKeyPath).mode & 0o777).toBe(0o600)
      expect(fs.statSync(path.dirname(privateKeyPath)).mode & 0o777).toBe(0o700)
    }

    const dns = readJson(path.join(rootDir, 'etc', 'zone_dns_records.json'))
    expect(dns).toEqual({ hostname: 'home.example.com', records: result.dnsRecords })
    for (const filePath of listFiles(rootDir)) {
      const content = fs.readFileSync(filePath, 'utf8')
      expect(content).not.toContain('did:bns:')
      expect(content).not.toContain('test-password')
    }
    expect(fs.existsSync(path.join(rootDir, 'etc', '.buckycli'))).toBe(false)

    const status = await inspectActivationRoot(rootDir)
    expect(status.state).toBe('configured')
    expect(status.startupRequired).toBe(true)
    expect(status.problems).toEqual([])
    expect(status.warnings).toEqual([])
    expect(status.zoneDid).toBe(result.zoneDid)
    expect(status.ownerDid).toBe(result.ownerDid)
    expect(status.deviceDid).toBe(result.deviceDid)
    expect(status.accessHostname).toBe('home.example.com')
    expect(status.files.every(file => file.present)).toBe(true)

    const repeated = await expectActivationError(
      () =>
        activateOfflineZone({
          rootDir,
          domain: 'home.example.com',
          ownerName: 'alice',
          adminPassword: 'test-password',
          ownerKeyBackupPath: path.join(backupDir, 'second.pem'),
        }),
      'TARGET_ALREADY_ACTIVATED',
    )
    expect(repeated.details.state).toBe('configured')
    expect(fs.existsSync(path.join(backupDir, 'second.pem'))).toBe(false)
  })

  test('status distinguishes partial and invalid material', async () => {
    const rootDir = makeInstalledRoot(sandbox)
    await activateOfflineZone({
      rootDir,
      domain: 'corp.example.com',
      ownerName: 'admin',
      adminPassword: 'test-password',
      ownerKeyBackupPath: path.join(sandbox, 'owner.pem'),
    })
    const startConfigPath = path.join(rootDir, 'etc', 'start_config.json')
    const startConfig = readJson(startConfigPath)
    startConfig.zone_name = 'did:web:other.example.com'
    fs.writeFileSync(startConfigPath, JSON.stringify(startConfig))
    const invalid = await inspectActivationRoot(rootDir)
    expect(invalid.state).toBe('invalid')
    expect(invalid.startupRequired).toBe(false)
    expect(invalid.problems.map(problem => problem.code)).toContain('START_CONFIG_ZONE')
    await expectActivationError(
      () =>
        checkOfflineActivation({
          rootDir,
          domain: 'corp.example.com',
          ownerName: 'admin',
          ownerKeyBackupPath: path.join(sandbox, 'again.pem'),
        }).then(precheck => {
          if (!precheck.ready) throw new ActivationError(precheck.problems[0].code, precheck.problems[0].message)
        }),
      'TARGET_ALREADY_ACTIVATED',
    )

    fs.rmSync(path.join(rootDir, 'etc', 'node_identity.json'))
    const partial = await inspectActivationRoot(rootDir)
    expect(partial.state).toBe('partial')
    expect(partial.zoneDid).toBe('did:web:corp.example.com')
    expect(partial.files.find(file => file.role === 'node_identity')?.present).toBe(false)
    expect(partial.problems.map(problem => problem.code)).toEqual(['FILE_MISSING'])
    const precheck = await checkOfflineActivation({
      rootDir,
      domain: 'corp.example.com',
      ownerName: 'admin',
      ownerKeyBackupPath: path.join(sandbox, 'again.pem'),
    })
    expect(precheck.problems.map(problem => problem.code)).toEqual(['TARGET_PARTIALLY_ACTIVATED'])
  })

  test('a held lock blocks concurrent activation and shows up in status', async () => {
    const rootDir = makeInstalledRoot(sandbox)
    const lockPath = path.join(rootDir, 'etc', ACTIVATION_LOCK_FILE_NAME)
    fs.writeFileSync(lockPath, JSON.stringify({ schema_version: 1, stage: 'locked', committed: [], trace_id: 'other' }))
    const status = await inspectActivationRoot(rootDir)
    expect(status.state).toBe('partial')
    expect(status.lock).toMatchObject({ path: lockPath, stage: 'locked', traceId: 'other', corrupt: false })
    const error = await expectActivationError(
      () =>
        activateOfflineZone({
          rootDir,
          domain: 'corp.example.com',
          ownerName: 'admin',
          adminPassword: 'test-password',
          ownerKeyBackupPath: path.join(sandbox, 'owner.pem'),
        }),
      'ACTIVATION_IN_PROGRESS',
    )
    expect(error.details.state).toBe('partial')
    expect(fs.existsSync(path.join(sandbox, 'owner.pem'))).toBe(false)
    expect(listFiles(rootDir)).toEqual([lockPath])
  })

  test('a commit failure keeps the backup, the committed files and the lock', async () => {
    const rootDir = makeInstalledRoot(sandbox)
    // A regular file where the public identity root must be created passes the
    // precheck (nothing looks like activation material) and fails the commit
    // right after the device private key was written.
    fs.mkdirSync(path.join(rootDir, 'local'))
    fs.writeFileSync(path.join(rootDir, 'local', 'identity'), 'not a directory')
    const ownerKeyBackupPath = path.join(sandbox, 'owner.pem')
    const error = await expectActivationError(
      () =>
        activateOfflineZone({
          rootDir,
          domain: 'corp.example.com',
          ownerName: 'admin',
          adminPassword: 'test-password',
          ownerKeyBackupPath,
        }),
      'ACTIVATION_COMMIT_FAILED',
    )
    expect(error.details.stage).toBe('local/identity/ood1.corp.example.com/did.json')
    expect(error.details.owner_key_backup).toEqual({ path: ownerKeyBackupPath, saved: true })
    const committed = (error.details.committed_files as Array<{ path: string }>).map(file => file.path)
    expect(committed).toEqual(['security/ood1.corp.example.com/authentication.private.pem'])
    expect(Array.isArray(error.details.recovery)).toBe(true)
    expect(JSON.stringify(error.details)).not.toContain('PRIVATE KEY')
    expect(fs.existsSync(ownerKeyBackupPath)).toBe(true)
    expect(fs.existsSync(path.join(rootDir, 'etc', 'node_identity.json'))).toBe(false)
    const lock = readJson(path.join(rootDir, 'etc', ACTIVATION_LOCK_FILE_NAME))
    expect(lock.stage).toBe('committing')
    expect(lock.committed).toEqual(committed)

    const status = await inspectActivationRoot(rootDir)
    expect(status.state).toBe('partial')
    expect(status.lock?.committedFiles).toEqual(committed)
    const precheck = await checkOfflineActivation({
      rootDir,
      domain: 'corp.example.com',
      ownerName: 'admin',
      ownerKeyBackupPath: path.join(sandbox, 'second.pem'),
    })
    expect(precheck.problems.map(problem => problem.code)).toEqual(['ACTIVATION_IN_PROGRESS'])
  })
})
