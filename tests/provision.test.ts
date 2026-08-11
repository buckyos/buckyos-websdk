import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

import {
  assertProvisionRuntime,
  buildDeviceDid,
  createUserEnv,
  createNodeConfigs,
  createSnConfigs,
  registerUserToSn,
  registerDeviceToSn,
  DevSnDb,
  MetaIndexDb,
  setPkgMeta,
  versionToInt,
  calcPkgMetaObjId,
  uniqueNameToDid,
  buildDidDocs,
} from '../src/provision'
import {
  createJwkByX,
  DID,
  getPublicKeyXFromPrivatePem,
  verifyJwtEdDSA,
} from '../src/namelib'
import { getDevTestKeyPairById } from '../src/dev_test_keys'

// node:sqlite is available on the runtimes provision supports (Node >= 22.13)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DatabaseSync } = require('node:sqlite')

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'provision')

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

let consoleSpy: jest.SpyInstance
beforeAll(() => {
  consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
})
afterAll(() => {
  consoleSpy.mockRestore()
})

test('runtime guard accepts current runtime', () => {
  expect(() => assertProvisionRuntime()).not.toThrow()
})

describe('createUserEnv (T2.2)', () => {
  describe.each([
    ['alice', 'alice.bns.did', 'ood1', 'devtests.org', 2980, 'alice.bns.did'],
    ['charlie', 'charlie.me', 'ood1@portmap', 'devtests.org', 2981, 'charlie.me'],
    ['devtest', 'test.buckyos.io', 'ood1@wan', '', 2980, 'test.buckyos.io'],
  ] as Array<[string, string, string, string, number, string]>)(
    '%s env',
    (username, hostname, oodName, snBaseHost, rtcpPort, zoneHostName) => {
      const outDir = tmpDir(`provision-${username}-`)

      beforeAll(async () => {
        await createUserEnv({ username, hostname, oodName, snBaseHost, rtcpPort, outputDir: outDir })
      })

      test('outputs use the mnemonic-derived dev owner key', async () => {
        const ownerKey = getDevTestKeyPairById(username)
        const privateKeyPem = fs.readFileSync(path.join(outDir, 'user_private_key.pem'), 'utf8')
        expect(privateKeyPem).toBe(ownerKey.privateKeyPem)
        await expect(getPublicKeyXFromPrivatePem(privateKeyPem)).resolves.toBe(ownerKey.publicKeyX)

        const userConfig = readJson(path.join(outDir, 'user_config.json'))
        expect(userConfig).toMatchObject({
          id: `did:bns:${username}`,
          name: username,
          display_name: username,
        })
        expect(userConfig.verificationMethod[0].publicKeyJwk.x).toBe(ownerKey.publicKeyX)

        const zoneRecord = readJson(path.join(outDir, 'zone_txt_record.json'))
        expect(zoneRecord.pkx).toBe(ownerKey.publicKeyX)
        await expect(verifyJwtEdDSA(zoneRecord.boot_config_jwt, createJwkByX(ownerKey.publicKeyX)))
          .resolves.toMatchObject({ exp: 2058838939 })

        const bootConfig = readJson(path.join(outDir, `${zoneHostName}.zone.json`))
        expect(bootConfig.exp).toBe(2058838939)
        expect(readJson(path.join(outDir, 'zone_config.json')).boot_jwt).toBe(zoneRecord.boot_config_jwt)
      })
    },
  )

  test('wan_dyn ood gets ddns_sn_url and drops the boot sn host', async () => {
    consoleSpy.mockClear()
    const outDir = tmpDir('provision-bob-')
    await createUserEnv({
      username: 'bob',
      hostname: 'bob.bns.did',
      oodName: 'ood1@wan_dyn',
      snBaseHost: 'devtests.org',
      outputDir: outDir,
    })
    const bootConfig = readJson(path.join(outDir, 'bob.bns.did.zone.json'))
    expect(bootConfig.sn).toBeUndefined()
    // the device config is only printed (mirror of Rust): find it in the log
    const deviceConfigLog = consoleSpy.mock.calls
      .map(call => String(call[0]))
      .find(line => line.startsWith('ood1 device config:'))
    expect(deviceConfigLog).toBeDefined()
    const deviceConfig = JSON.parse(deviceConfigLog!.slice('ood1 device config:'.length))
    expect(deviceConfig.ddns_sn_url).toBe('https://sn.devtests.org/kapi/sn')
    expect(deviceConfig.net_id).toBe('wan_dyn')
    expect(deviceConfig.id).toBe('did:bns:ood1.bob')
  })
})

describe('createNodeConfigs (T2.3)', () => {
  test.each([
    ['alice', 'alice.bns.did', 'ood1', 'devtests.org', 'lan'],
    ['charlie', 'charlie.me', 'ood1@portmap', 'devtests.org', 'portmap'],
    ['devtest', 'test.buckyos.io', 'ood1@wan', '', 'wan'],
    ['dave', 'dave.bns.did', 'ood1@wan', 'devtests.org', 'wan'],
  ] as Array<[string, string, string, string, string]>)(
    '%s/ood1 node files use mnemonic-derived owner and device keys',
    async (username, hostname, oodName, snBaseHost, netId) => {
      const envDir = tmpDir(`provision-node-${username}-`)
      await createUserEnv({
        username,
        hostname,
        oodName,
        snBaseHost,
        rtcpPort: 2980,
        outputDir: envDir,
      })
      await createNodeConfigs({ deviceName: 'ood1', envDir, netId, now: 123456 })

      const ownerKey = getDevTestKeyPairById(username)
      const deviceKey = getDevTestKeyPairById(`${username}.ood1`)
      const nodeDir = path.join(envDir, 'ood1')
      const nodeIdentity = readJson(path.join(nodeDir, 'node_identity.json'))
      const identityDirName = DID.fromStr(nodeIdentity.device_did).toFilename()
      const identitySubdir = path.join('local', 'identity', identityDirName)
      const didJson = readJson(path.join(nodeDir, identitySubdir, 'did.json'))

      expect(nodeIdentity.owner_public_key.x).toBe(ownerKey.publicKeyX)
      expect(nodeIdentity.device_did).toBe(buildDeviceDid('ood1', nodeIdentity.zone_did).toString())
      expect(didJson.verificationMethod[0].publicKeyJwk.x).toBe(deviceKey.publicKeyX)
      expect(fs.readFileSync(path.join(nodeDir, 'security', identityDirName, 'authentication.private.pem'), 'utf8'))
        .toBe(deviceKey.privateKeyPem)

      const deviceDocJwt = fs.readFileSync(path.join(nodeDir, identitySubdir, 'device_doc.jwt'), 'utf8')
      const verifiedDeviceDoc = await verifyJwtEdDSA(deviceDocJwt, createJwkByX(ownerKey.publicKeyX))
      expect(verifiedDeviceDoc).toMatchObject({
        id: nodeIdentity.device_did,
        owner: `did:bns:${username}`,
        name: 'ood1',
      })
      expect(verifiedDeviceDoc.verificationMethod[0].publicKeyJwk.x).toBe(deviceKey.publicKeyX)

      const miniJwt = fs.readFileSync(path.join(nodeDir, identitySubdir, 'device_mini_doc.jwt'), 'utf8')
      await expect(verifyJwtEdDSA(miniJwt, createJwkByX(ownerKey.publicKeyX)))
        .resolves.toMatchObject({ n: 'ood1', x: deviceKey.publicKeyX })
    },
  )

  test('buildDeviceDid mirrors buckyos-api build_device_did', () => {
    expect(buildDeviceDid('ood1', 'did:bns:alice').toString()).toBe('did:bns:ood1.alice')
    expect(buildDeviceDid('ood1', 'did:web:test.buckyos.io').toString()).toBe('did:web:ood1.test.buckyos.io')
    expect(buildDeviceDid('cam01', 'did:bns:app1.alice').toString()).toBe('did:bns:cam01.app1.alice')
    expect(() => buildDeviceDid('  ', 'did:bns:alice')).toThrow()
  })
})

describe('DevSnDb (T2.4)', () => {
  test('schema matches the rusqlite-created fixture database', () => {
    const dbPath = path.join(tmpDir('provision-sndb-'), 'sn_db.sqlite3')
    new DevSnDb(dbPath).initializeDatabase()

    const normalize = (rows: Array<{ name: string; sql: string }>) =>
      rows
        .filter(row => row.sql)
        .map(row => ({ name: row.name, sql: row.sql.replace(/\s+/g, ' ').trim() }))
        .sort((a, b) => a.name.localeCompare(b.name))

    const produced = new DatabaseSync(dbPath)
    const fixture = new DatabaseSync(path.join(FIXTURE_DIR, 'sn', 'sn_server', 'sn_db.sqlite3'))
    const query = "SELECT name, sql FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%'"
    try {
      expect(normalize(produced.prepare(query).all())).toEqual(normalize(fixture.prepare(query).all()))
    } finally {
      produced.close()
      fixture.close()
    }
  })

  test('registerUserDirectly / registerDevice rows match the Rust column layout', () => {
    const dbPath = path.join(tmpDir('provision-snrows-'), 'sn_db.sqlite3')
    const db = new DevSnDb(dbPath)
    db.initializeDatabase()
    db.registerUserDirectly('alice', '{"crv":"Ed25519","kty":"OKP","x":"xxx"}', 'jwt-string', undefined)
    db.registerDevice('alice', 'ood1', 'did:dev:abc', 'mini-jwt', '192.168.1.2', '{"info":1}')

    const raw = new DatabaseSync(dbPath)
    try {
      const user = raw.prepare('SELECT * FROM users').get()
      expect(user).toMatchObject({
        username: 'alice',
        state: 'active',
        public_key: '{"crv":"Ed25519","kty":"OKP","x":"xxx"}',
        activation_code: 'DIRECT',
        zone_config: 'jwt-string',
        self_cert: 1,
        user_domain: null,
        sn_ips: null,
      })
      const device = raw.prepare('SELECT * FROM devices').get()
      expect(device).toMatchObject({
        owner: 'alice',
        device_name: 'ood1',
        did: 'did:dev:abc',
        ip: '192.168.1.2',
        description: '{"info":1}',
        mini_config_jwt: 'mini-jwt',
      })
    } finally {
      raw.close()
    }
  })
})

describe('createSnConfigs (T2.5)', () => {
  const outDir = tmpDir('provision-sn-')

  beforeAll(async () => {
    await createSnConfigs({ outputDir: outDir, snIp: '192.168.64.84', snBaseHost: 'devtests.org' })
  })

  test('outputs use the mnemonic-derived sn owner and device keys', async () => {
    const snDir = path.join(outDir, 'sn_server')
    const ownerKey = getDevTestKeyPairById('sn_owner')
    const deviceKey = getDevTestKeyPairById('sn_server')
    expect(fs.readFileSync(path.join(snDir, '.buckycli', 'user_private_key.pem'), 'utf8'))
      .toBe(ownerKey.privateKeyPem)
    expect(fs.readFileSync(path.join(snDir, 'sn_private_key.pem'), 'utf8'))
      .toBe(deviceKey.privateKeyPem)

    const userConfig = readJson(path.join(snDir, '.buckycli', 'user_config.json'))
    expect(userConfig.verificationMethod[0].publicKeyJwk.x).toBe(ownerKey.publicKeyX)

    const params = readJson(path.join(snDir, 'params.json')).params
    expect(params.sn_owner_pk).toBe(ownerKey.publicKeyX)
    await expect(verifyJwtEdDSA(params.sn_boot_jwt, createJwkByX(ownerKey.publicKeyX)))
      .resolves.toMatchObject({ oods: ['sn'], exp: 2058838939 })
    await expect(verifyJwtEdDSA(params.sn_device_jwt, createJwkByX(ownerKey.publicKeyX)))
      .resolves.toMatchObject({ n: 'sn', x: deviceKey.publicKeyX, exp: 2058838939 })

    const deviceConfig = readJson(path.join(snDir, 'sn_device_config.json'))
    expect(deviceConfig.verificationMethod[0].publicKeyJwk.x).toBe(deviceKey.publicKeyX)
  })

  test('sn_db contains the dev activation codes', () => {
    const raw = new DatabaseSync(path.join(outDir, 'sn_server', 'sn_db.sqlite3'))
    try {
      const codes = raw.prepare('SELECT code, used FROM activation_codes ORDER BY code').all()
      expect(codes).toEqual(
        Array.from({ length: 9 }, (_, i) => ({ code: `sndevtest${i}`, used: 0 })),
      )
    } finally {
      raw.close()
    }
  })
})

describe('SN registration (mirror register_user_to_sn / register_device_to_sn)', () => {
  test('registers the fixture alice env into a fresh sn_db', async () => {
    const rootDir = tmpDir('provision-reg-')
    const envDir = path.join(rootDir, 'alice.bns.did')
    fs.mkdirSync(envDir, { recursive: true })
    for (const name of ['user_config.json', 'zone_config.json', 'zone_txt_record.json']) {
      fs.copyFileSync(path.join(FIXTURE_DIR, 'alice', name), path.join(envDir, name))
    }
    // v2 layout: node_identity.json + the identity-roots tree under the node dir
    fs.cpSync(path.join(FIXTURE_DIR, 'alice', 'ood1'), path.join(envDir, 'ood1'), { recursive: true })

    const dbPath = path.join(rootDir, 'sn_db.sqlite3')
    new DevSnDb(dbPath).initializeDatabase()

    await registerUserToSn(rootDir, 'alice.bns.did', dbPath)
    await registerDeviceToSn(rootDir, 'alice.bns.did', 'ood1', dbPath)

    const txtRecord = readJson(path.join(FIXTURE_DIR, 'alice', 'zone_txt_record.json'))
    const nodeIdentity = readJson(path.join(FIXTURE_DIR, 'alice', 'ood1', 'node_identity.json'))
    const identityDirName = DID.fromStr(nodeIdentity.device_did).toFilename()
    const expectedMiniJwt = fs.readFileSync(
      path.join(FIXTURE_DIR, 'alice', 'ood1', 'local', 'identity', identityDirName, 'device_mini_doc.jwt'),
      'utf8',
    )

    const raw = new DatabaseSync(dbPath)
    try {
      const user = raw.prepare('SELECT * FROM users').get()
      expect(user).toMatchObject({
        username: 'alice',
        state: 'active',
        activation_code: 'DIRECT',
        zone_config: txtRecord.boot_config_jwt,
        // bns zone -> no user_domain (mirrors Rust)
        user_domain: null,
        self_cert: 1,
      })
      expect(JSON.parse(user.public_key as string)).toEqual({ crv: 'Ed25519', kty: 'OKP', x: txtRecord.pkx })

      const device = raw.prepare('SELECT * FROM devices').get()
      expect(device).toMatchObject({
        owner: 'alice',
        device_name: 'ood1',
        did: nodeIdentity.device_did,
        mini_config_jwt: expectedMiniJwt,
      })
      const description = JSON.parse(device.description as string)
      expect(description.name).toBe('ood1')
      expect(description.state).toBe('Ready')
      expect(description.id).toBe('did:bns:ood1.alice')
    } finally {
      raw.close()
    }
  })

  test('web zone registers user_domain', async () => {
    const rootDir = tmpDir('provision-reg-web-')
    const envDir = path.join(rootDir, 'charlie.me')
    fs.mkdirSync(envDir, { recursive: true })
    for (const name of ['user_config.json', 'zone_config.json', 'zone_txt_record.json']) {
      fs.copyFileSync(path.join(FIXTURE_DIR, 'charlie', name), path.join(envDir, name))
    }
    const dbPath = path.join(rootDir, 'sn_db.sqlite3')
    new DevSnDb(dbPath).initializeDatabase()
    await registerUserToSn(rootDir, 'charlie.me', dbPath)

    const raw = new DatabaseSync(dbPath)
    try {
      const user = raw.prepare('SELECT username, user_domain FROM users').get()
      expect(user).toEqual({ username: 'charlie', user_domain: 'charlie.me' })
    } finally {
      raw.close()
    }
  })
})

describe('setPkgMeta + MetaIndexDb (T2.6) vs buckycli fixture', () => {
  const expected = readJson(path.join(FIXTURE_DIR, 'pkg_meta', 'expected.json'))
  const metaFixturePath = path.join(FIXTURE_DIR, 'pkg_meta', 'node-daemon.pkg_meta.json')

  test('versionToInt mirrors VersionExp::version_to_int', () => {
    expect(versionToInt('0.4.1')).toBe(4398063288320n)
    expect(versionToInt('0.4.1')).toBe((0n << 56n) | (4n << 40n) | (1n << 24n) | 0n)
    expect(versionToInt('1.2.3')).toBe((1n << 56n) | (2n << 40n) | (3n << 24n))
    expect(versionToInt('0.5.1-build123')).toBe((5n << 40n) | (1n << 24n) | 123n)
    expect(() => versionToInt('300.0.0')).toThrow()
  })

  test('meta obj id matches the Rust-computed metaobjid', () => {
    const metaJson = readJson(metaFixturePath)
    expect(calcPkgMetaObjId(metaJson)).toBe(expected.metaobjid)
  })

  test('setPkgMeta writes pkg_metas AND pkg_versions like buckycli', async () => {
    const dir = tmpDir('provision-meta-')
    const dbPath = path.join(dir, 'meta_index.db')
    fs.writeFileSync(dbPath, '') // make_config touches the file first; we must handle it
    const metaObjId = await setPkgMeta(metaFixturePath, dbPath)
    expect(metaObjId).toBe(expected.metaobjid)

    const raw = new DatabaseSync(dbPath)
    try {
      const meta = raw.prepare('SELECT metaobjid, pkg_meta, author, author_pk FROM pkg_metas').get()
      expect(meta).toEqual({
        metaobjid: expected.metaobjid,
        pkg_meta: fs.readFileSync(metaFixturePath, 'utf8'),
        author: expected.author,
        author_pk: expected.author_pk,
      })
      const version = raw.prepare('SELECT pkg_name, author, version, version_int, metaobjid, tag FROM pkg_versions').get()
      expect(version).toEqual({
        pkg_name: expected.pkg_name,
        author: expected.author,
        version: expected.version,
        version_int: expected.version_int,
        metaobjid: expected.metaobjid,
        tag: expected.tag,
      })
    } finally {
      raw.close()
    }
  })

  test('updating the same version replaces instead of duplicating', async () => {
    const dir = tmpDir('provision-meta-up-')
    const dbPath = path.join(dir, 'meta_index.db')
    fs.writeFileSync(dbPath, '')
    await setPkgMeta(metaFixturePath, dbPath)
    await setPkgMeta(metaFixturePath, dbPath)
    const raw = new DatabaseSync(dbPath)
    try {
      expect(raw.prepare('SELECT COUNT(*) AS c FROM pkg_versions').get()).toEqual({ c: 1 })
      expect(raw.prepare('SELECT COUNT(*) AS c FROM pkg_metas').get()).toEqual({ c: 1 })
    } finally {
      raw.close()
    }
  })

  test('schema matches package-lib meta_index_db.rs', () => {
    const dir = tmpDir('provision-meta-schema-')
    const dbPath = path.join(dir, 'meta_index.db')
    new MetaIndexDb(dbPath).initializeDatabase()
    const fixtureDb = new DatabaseSync(path.join(FIXTURE_DIR, 'pkg_meta', 'meta_index.db'))
    const producedDb = new DatabaseSync(dbPath)
    const query = "SELECT name, sql FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%'"
    const normalize = (rows: Array<{ name: string; sql: string }>) =>
      rows.map(row => ({ name: row.name, sql: row.sql.replace(/\s+/g, ' ').trim() })).sort((a, b) => a.name.localeCompare(b.name))
    try {
      expect(normalize(producedDb.prepare(query).all())).toEqual(normalize(fixtureDb.prepare(query).all()))
    } finally {
      producedDb.close()
      fixtureDb.close()
    }
  })
})

describe('buildDidDocs (T2.7) vs buckycli fixture', () => {
  test('unique_name_to_did mirrors package-lib', () => {
    expect(uniqueNameToDid('verify-hub').toString()).toBe('did:bns:verify-hub')
    expect(uniqueNameToDid('author_module').toString()).toBe('did:bns:module.author')
  })

  test('all six kernel service docs match (ignoring generation timestamps)', () => {
    const outDir = tmpDir('provision-docs-')
    const written = buildDidDocs(outDir)
    expect(written).toHaveLength(6)

    const fixtureFiles = fs.readdirSync(path.join(FIXTURE_DIR, 'did_docs')).filter(f => f.endsWith('.doc.json'))
    expect(written.map(f => path.basename(f)).sort()).toEqual(fixtureFiles.sort())

    for (const fileName of fixtureFiles) {
      const produced = readJson(path.join(outDir, fileName))
      const fixture = readJson(path.join(FIXTURE_DIR, 'did_docs', fileName))
      fixture.create_time = produced.create_time
      fixture.last_update_time = produced.last_update_time
      expect({ fileName, doc: produced }).toEqual({ fileName, doc: fixture })
      // key order is sorted like serde_json::Value output
      expect(Object.keys(produced)).toEqual(Object.keys(fixture))
    }
  })
})
