import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

import {
  assertProvisionRuntime,
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
import { decodeJwtClaimWithoutVerify } from '../src/namelib'

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

function withAlignedTimestamps(produced: any, fixture: any): any {
  return { ...fixture, iat: produced.iat, exp: produced.exp }
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

describe('createUserEnv (T2.2) vs buckycli fixtures', () => {
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

      test('deterministic outputs are identical to the Rust outputs', () => {
        // boot config / txt record / zone config use fixed BASE_TIME-derived exp
        expect(readJson(path.join(outDir, `${zoneHostName}.zone.json`)))
          .toEqual(readJson(path.join(FIXTURE_DIR, username, `${zoneHostName}.zone.json`)))
        expect(readJson(path.join(outDir, 'zone_txt_record.json')))
          .toEqual(readJson(path.join(FIXTURE_DIR, username, 'zone_txt_record.json')))
        expect(readJson(path.join(outDir, 'zone_config.json')))
          .toEqual(readJson(path.join(FIXTURE_DIR, username, 'zone_config.json')))
        expect(fs.readFileSync(path.join(outDir, 'user_private_key.pem'), 'utf8'))
          .toBe(fs.readFileSync(path.join(FIXTURE_DIR, username, 'user_private_key.pem'), 'utf8'))
      })

      test('time-dependent outputs match after aligning iat/exp', () => {
        const producedUser = readJson(path.join(outDir, 'user_config.json'))
        const fixtureUser = readJson(path.join(FIXTURE_DIR, username, 'user_config.json'))
        expect(producedUser).toEqual(withAlignedTimestamps(producedUser, fixtureUser))

        const producedDevice = readJson(path.join(outDir, 'ood1', 'node_device_config.json'))
        const fixtureDevice = readJson(path.join(FIXTURE_DIR, username, 'ood1', 'node_device_config.json'))
        expect(producedDevice).toEqual(withAlignedTimestamps(producedDevice, fixtureDevice))
      })
    },
  )

  test('wan_dyn ood gets ddns_sn_url and drops the boot sn host', async () => {
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
    const deviceConfig = readJson(path.join(outDir, 'ood1', 'node_device_config.json'))
    expect(deviceConfig.ddns_sn_url).toBe('https://sn.devtests.org/kapi/sn')
    expect(deviceConfig.net_id).toBe('wan_dyn')
  })
})

describe('createNodeConfigs (T2.3) on the fixture env (byte-level golden)', () => {
  test.each(['alice', 'charlie', 'devtest'])('%s/ood1 node files are byte-identical', async (username) => {
    // copy the fixture env so createNodeConfigs sees exactly what buckycli saw
    const envDir = tmpDir(`provision-node-${username}-`)
    for (const name of ['user_config.json', 'zone_config.json']) {
      fs.copyFileSync(path.join(FIXTURE_DIR, username, name), path.join(envDir, name))
    }
    fs.mkdirSync(path.join(envDir, 'ood1'), { recursive: true })
    fs.copyFileSync(
      path.join(FIXTURE_DIR, username, 'ood1', 'node_device_config.json'),
      path.join(envDir, 'ood1', 'node_device_config.json'),
    )

    await createNodeConfigs({ deviceName: 'ood1', envDir })

    for (const name of ['node_private_key.pem', 'device_mini_config.jwt', 'node_identity.json', 'start_config.json']) {
      const produced = fs.readFileSync(path.join(envDir, 'ood1', name), 'utf8')
      const fixture = fs.readFileSync(path.join(FIXTURE_DIR, username, 'ood1', name), 'utf8')
      expect({ name, content: produced }).toEqual({ name, content: fixture })
    }
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

describe('createSnConfigs (T2.5) vs buckycli fixture', () => {
  const outDir = tmpDir('provision-sn-')

  beforeAll(async () => {
    await createSnConfigs({ outputDir: outDir, snIp: '192.168.64.84', snBaseHost: 'devtests.org' })
  })

  test('deterministic outputs match', () => {
    expect(readJson(path.join(outDir, 'sn_server', 'params.json')))
      .toEqual(readJson(path.join(FIXTURE_DIR, 'sn', 'sn_server', 'params.json')))
    expect(readJson(path.join(outDir, 'sn_server', 'sn_device_config.json')))
      .toEqual(readJson(path.join(FIXTURE_DIR, 'sn', 'sn_server', 'sn_device_config.json')))
    expect(fs.readFileSync(path.join(outDir, 'sn_server', 'sn_private_key.pem'), 'utf8'))
      .toBe(fs.readFileSync(path.join(FIXTURE_DIR, 'sn', 'sn_server', 'sn_private_key.pem'), 'utf8'))
    expect(fs.readFileSync(path.join(outDir, 'sn_server', '.buckycli', 'user_private_key.pem'), 'utf8'))
      .toBe(fs.readFileSync(path.join(FIXTURE_DIR, 'sn', 'sn_server', '.buckycli', 'user_private_key.pem'), 'utf8'))
  })

  test('sn admin user_config matches after aligning iat/exp', () => {
    const produced = readJson(path.join(outDir, 'sn_server', '.buckycli', 'user_config.json'))
    const fixture = readJson(path.join(FIXTURE_DIR, 'sn', 'sn_server', '.buckycli', 'user_config.json'))
    expect(produced).toEqual(withAlignedTimestamps(produced, fixture))
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
    fs.mkdirSync(path.join(envDir, 'ood1'), { recursive: true })
    for (const name of ['user_config.json', 'zone_config.json', 'zone_txt_record.json']) {
      fs.copyFileSync(path.join(FIXTURE_DIR, 'alice', name), path.join(envDir, name))
    }
    fs.copyFileSync(
      path.join(FIXTURE_DIR, 'alice', 'ood1', 'node_identity.json'),
      path.join(envDir, 'ood1', 'node_identity.json'),
    )

    const dbPath = path.join(rootDir, 'sn_db.sqlite3')
    new DevSnDb(dbPath).initializeDatabase()

    await registerUserToSn(rootDir, 'alice.bns.did', dbPath)
    await registerDeviceToSn(rootDir, 'alice.bns.did', 'ood1', dbPath)

    const txtRecord = readJson(path.join(FIXTURE_DIR, 'alice', 'zone_txt_record.json'))
    const nodeIdentity = readJson(path.join(FIXTURE_DIR, 'alice', 'ood1', 'node_identity.json'))
    const expectedDeviceDid = decodeJwtClaimWithoutVerify(nodeIdentity.device_doc_jwt).id

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
        did: expectedDeviceDid,
        mini_config_jwt: nodeIdentity.device_mini_doc_jwt,
      })
      const description = JSON.parse(device.description as string)
      expect(description.name).toBe('ood1')
      expect(description.state).toBe('Ready')
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
