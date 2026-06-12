import * as fs from 'fs'
import * as path from 'path'

import {
  DID,
  parseOODDescription,
  oodDescriptionToString,
  generateEd25519KeyPair,
  getPublicKeyXFromPrivatePem,
  getXFromJwk,
  createJwkByX,
  getDeviceDidFromJwk,
  signJwtEdDSA,
  verifyJwtEdDSA,
  decodeJwtClaimWithoutVerify,
  decodeJwtHeaderWithoutVerify,
  newOwnerConfig,
  setOwnerDefaultZoneDid,
  newZoneConfig,
  newZoneBootConfig,
  encodeZoneBootConfig,
  decodeZoneBootConfig,
  zoneConfigInitByBootConfig,
  newDeviceConfigByJwk,
  newDeviceConfigByMiniConfig,
  encodeDeviceConfig,
  decodeDeviceConfig,
  newDeviceMiniConfig,
  newDeviceMiniConfigByDeviceConfig,
  deviceMiniConfigToJwt,
  newNodeIdentityConfig,
  resetKnownWeb3BridgeConfigForTest,
  setKnownWeb3BridgeConfig,
} from '../src/namelib'
import { DEV_TEST_KEYS, getDevTestKeyPairById } from '../src/dev_test_keys'
import { BuckyOSZoneDocument } from '../src/types'

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'provision')

function readFixtureJson(...segments: string[]): any {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, ...segments), 'utf8'))
}

function readFixtureText(...segments: string[]): string {
  return fs.readFileSync(path.join(FIXTURE_DIR, ...segments), 'utf8')
}

afterEach(() => {
  resetKnownWeb3BridgeConfigForTest()
})

describe('DID (mirror of did.rs unit tests)', () => {
  test('from_str basic schemes', () => {
    const did = DID.fromStr('did:bns:waterflier')
    expect(did.method).toBe('bns')
    expect(did.id).toBe('waterflier')

    const did2 = DID.fromStr('did:bns:waterflier:sssn.did')
    expect(did2.method).toBe('bns')
    expect(did2.id).toBe('waterflier:sssn.did')
  })

  test('bridge config resolution', () => {
    setKnownWeb3BridgeConfig({ bns: 'web3.buckyos.io' })

    const did = DID.fromStr('web3.buckyos.io')
    expect(did.method).toBe('web')
    expect(did.id).toBe('web3.buckyos.io')

    const did2 = DID.fromStr('did:web:web3.buckyos.io:users:bob')
    expect(did2.method).toBe('web')
    expect(did2.id).toBe('web3.buckyos.io:users:bob')
    expect(did2.toHostName()).toBe('web3.buckyos.io')
    expect(did2.getPathFromId()).toBe('users/bob')
    expect(did2.toHostUri()).toBe('web3.buckyos.io/users/bob')

    const did3 = DID.fromHostName('waterflier.web3.buckyos.io')!
    expect(did3.method).toBe('bns')
    expect(did3.id).toBe('waterflier')
    expect(did3.toHostName()).toBe('waterflier.web3.buckyos.io')

    const did4 = DID.fromStr('did:bns:app1.waterflier')
    expect(did4.toString()).toBe('did:bns:app1.waterflier')
    expect(did4.toHostName()).toBe('app1.waterflier.web3.buckyos.io')
  })

  test('web scheme and paths', () => {
    const did = DID.fromStr('did:web:example.com:user:alice')
    expect(did.toHostName()).toBe('example.com')
    expect(did.getPathFromId()).toBe('user/alice')
    expect(did.toHostUri()).toBe('example.com/user/alice')

    expect(DID.fromStr('did:web:example.com').toHostUri()).toBe('example.com')

    const zhicong = DID.fromHostName('zhicong.me')!
    expect(zhicong.method).toBe('web')
    expect(zhicong.id).toBe('zhicong.me')

    const buckyos = DID.fromStr('buckyos.ai')
    expect(buckyos.method).toBe('web')
    expect(buckyos.toHostName()).toBe('buckyos.ai')
    expect(buckyos.toString()).toBe('did:web:buckyos.ai')
  })

  test('dev scheme via .did hostname', () => {
    const did = DID.fromStr('abcdef.dev.did')
    expect(did.method).toBe('dev')
    expect(did.id).toBe('abcdef')
    expect(did.toString()).toBe('did:dev:abcdef')
  })

  test('from_host_name_by_bridge', () => {
    const did = DID.fromHostNameByBridge('app1.waterflier.web3.buckyos.io', 'bns', 'web3.buckyos.io')
    expect(did.method).toBe('bns')
    expect(did.id).toBe('app1.waterflier')
    expect(did.toHostNameByBridge('web3.buckyos.io')).toBe('app1.waterflier.web3.buckyos.io')

    const did2 = DID.fromHostNameByBridge('waterflier.buckyos.io', 'bns', 'web3.buckyos.io')
    expect(did2.method).toBe('web')
    expect(did2.id).toBe('waterflier.buckyos.io')
    expect(did2.toHostNameByBridge('web3.buckyos.io')).toBe('waterflier.buckyos.io')

    const did3 = DID.fromHostNameByBridge('alice.bns.did', 'bns', 'web3.devtests.org')
    expect(did3.method).toBe('bns')
    expect(did3.id).toBe('alice')

    const did4 = DID.fromHostNameByBridge('charlie.me', 'bns', 'web3.devtests.org')
    expect(did4.method).toBe('web')
    expect(did4.id).toBe('charlie.me')
  })

  test('to_raw_host_name', () => {
    expect(DID.fromStr('did:bns:alice').toRawHostName()).toBe('alice.bns.did')
    expect(DID.fromStr('did:web:test.buckyos.io').toRawHostName()).toBe('test.buckyos.io')
  })
})

describe('OODDescriptionString (mirror of zone.rs)', () => {
  test.each([
    ['ood1', { name: 'ood1', nodeType: 'OOD' }],
    ['ood1@lan1', { name: 'ood1', nodeType: 'OOD', netId: 'lan1' }],
    ['ood1@wan', { name: 'ood1', nodeType: 'OOD', netId: 'wan' }],
    ['ood1:210.35.234.21', { name: 'ood1', nodeType: 'OOD', netId: 'wan', ip: '210.35.234.21' }],
    ['ood1:192.168.1.100@lan1', { name: 'ood1', nodeType: 'OOD', netId: 'lan1', ip: '192.168.1.100' }],
    ['#gate1:210.35.0.22', { name: 'gate1', nodeType: 'Gateway', netId: 'wan', ip: '210.35.0.22' }],
    ['$ood1:210.35.234.21', { name: 'ood1', nodeType: 'OODOnly', netId: 'wan', ip: '210.35.234.21' }],
  ])('parse %s', (input, expected) => {
    expect(parseOODDescription(input)).toEqual(expected)
  })

  test('round trip', () => {
    for (const s of ['ood1', 'ood1@lan1', 'ood1:210.35.234.21', 'ood1:192.168.1.100@lan1', '#gate1', '$ood1@lan2']) {
      expect(oodDescriptionToString(parseOODDescription(s))).toBe(s)
    }
  })

  test('rejects empty name and bad ip', () => {
    expect(() => parseOODDescription('@lan1')).toThrow()
    expect(() => parseOODDescription('ood1:notanip')).toThrow()
  })
})

describe('Ed25519 keygen & JWK utils (T1.2)', () => {
  test('generated key pair format matches Rust TestKeys shape', async () => {
    const { privateKeyPem, publicKeyJwk } = await generateEd25519KeyPair()
    const lines = privateKeyPem.trim().split('\n')
    expect(lines[0]).toBe('-----BEGIN PRIVATE KEY-----')
    expect(lines[lines.length - 1]).toBe('-----END PRIVATE KEY-----')
    // PKCS8 ed25519 private key is exactly 48 bytes -> a single 64-char base64 line
    expect(lines.length).toBe(3)
    expect(lines[1]).toHaveLength(64)
    expect(lines[1].startsWith('MC4CAQAwBQYDK2VwBCIEI')).toBe(true)

    expect(publicKeyJwk.kty).toBe('OKP')
    expect(publicKeyJwk.crv).toBe('Ed25519')
    expect(Object.keys(publicKeyJwk)).toEqual(['kty', 'crv', 'x'])
    // x is base64url of 32 bytes, no padding
    expect(publicKeyJwk.x).toMatch(/^[A-Za-z0-9_-]{43}$/)

    // private pem and public jwk belong together
    expect(await getPublicKeyXFromPrivatePem(privateKeyPem)).toBe(publicKeyJwk.x)
  })

  test('jwk helpers', () => {
    const jwk = createJwkByX('T4Quc1L6Ogu4N2tTKOvneV1yYnBcmhP89B_RsuFsJZ8')
    expect(getXFromJwk(jwk)).toBe('T4Quc1L6Ogu4N2tTKOvneV1yYnBcmhP89B_RsuFsJZ8')
    expect(getDeviceDidFromJwk(jwk)).toBe('did:dev:T4Quc1L6Ogu4N2tTKOvneV1yYnBcmhP89B_RsuFsJZ8')
  })
})

describe('DEV_TEST_KEYS (T1.7)', () => {
  test('every preset private pem derives the recorded public x', async () => {
    for (const [id, keyPair] of Object.entries(DEV_TEST_KEYS)) {
      const derivedX = await getPublicKeyXFromPrivatePem(keyPair.privateKeyPem)
      expect({ id, x: derivedX }).toEqual({ id, x: keyPair.publicKeyX })
    }
  })

  test('jwt signed by a test key verifies with its public jwk', async () => {
    const keyPair = getDevTestKeyPairById('devtest')
    const jwt = await signJwtEdDSA({ hello: 'world', exp: 123 }, keyPair.privateKeyPem)
    const payload = await verifyJwtEdDSA(jwt, createJwkByX(keyPair.publicKeyX))
    expect(payload).toEqual({ hello: 'world', exp: 123 })
  })

  test('unknown id throws', () => {
    expect(() => getDevTestKeyPairById('no-such-key')).toThrow()
  })
})

describe('JWT encode/decode (T1.3)', () => {
  test('header matches Rust (typ omitted)', async () => {
    const keyPair = getDevTestKeyPairById('devtest')
    const jwt = await signJwtEdDSA({ a: 1 }, keyPair.privateKeyPem)
    expect(decodeJwtHeaderWithoutVerify(jwt)).toEqual({ alg: 'EdDSA' })
  })

  test('verify rejects tampered payloads', async () => {
    const keyPair = getDevTestKeyPairById('devtest')
    const jwt = await signJwtEdDSA({ a: 1 }, keyPair.privateKeyPem)
    const parts = jwt.split('.')
    const tampered = `${parts[0]}.eyJhIjoyfQ.${parts[2]}`
    await expect(verifyJwtEdDSA(tampered, createJwkByX(keyPair.publicKeyX))).rejects.toThrow()
  })

  test('decodes a real Rust-produced device jwt (golden, from test_config.rs)', () => {
    const deviceJwt = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJAY29udGV4dCI6Imh0dHBzOi8vd3d3LnczLm9yZy9ucy9kaWQvdjEiLCJpZCI6ImRpZDpkZXY6VzU3MEpiUlBxSDFrdWttemNCX003eDVud0FvWS1pVTVHcnIyUlhjZjdHSSIsInZlcmlmaWNhdGlvbk1ldGhvZCI6W3sidHlwZSI6IkVkMjU1MTlWZXJpZmljYXRpb25LZXkyMDIwIiwiaWQiOiIjbWFpbl9rZXkiLCJjb250cm9sbGVyIjoiZGlkOmRldjpXNTcwSmJSUHFIMWt1a216Y0JfTTd4NW53QW9ZLWlVNUdycjJSWGNmN0dJIiwicHVibGljS2V5SndrIjp7Imt0eSI6Ik9LUCIsImNydiI6IkVkMjU1MTkiLCJ4IjoiVzU3MEpiUlBxSDFrdWttemNCX003eDVud0FvWS1pVTVHcnIyUlhjZjdHSSJ9fV0sImF1dGhlbnRpY2F0aW9uIjpbIiNtYWluX2tleSJdLCJhc3NlcnRpb25fbWV0aG9kIjpbIiNtYWluX2tleSJdLCJleHAiOjIwNTk0MTIyMTIsImlhdCI6MTc0NDA1MjIxMiwiZGV2aWNlX3R5cGUiOiJvb2QiLCJuYW1lIjoib29kMSIsIm5ldF9pZCI6IndhbiIsImlzcyI6ImJ1Y2t5In0.WT95o5617N-JCIgH6wEVDkt7uLW-NWtzIB8L9SZHl7sZEf269DLQ73oEp3PJ990uCzLcSFW-WJ12hppTr4A8CQ'
    const payload = decodeJwtClaimWithoutVerify(deviceJwt)
    expect(payload.id).toBe('did:dev:W570JbRPqH1kukmzcB_M7x5nwAoY-iU5Grr2RXcf7GI')
    expect(payload.device_type).toBe('ood')
    expect(payload.name).toBe('ood1')
    expect(payload.net_id).toBe('wan')
  })
})

describe('golden fixtures (T1.8, generated by buckycli, see fixtures README)', () => {
  describe.each([
    ['alice', 'did:bns:alice', 'alice.bns.did', 'ood1', 'sn.devtests.org', 2980],
    ['charlie', 'did:web:charlie.me', 'charlie.me', 'ood1@portmap', 'sn.devtests.org', 2981],
    ['devtest', 'did:web:test.buckyos.io', 'test.buckyos.io', 'ood1@wan', undefined, 2980],
  ] as Array<[string, string, string, string, string | undefined, number]>)(
    '%s env',
    (username, zoneDidStr, zoneHostName, oodDesc, snHost, rtcpPort) => {
      const ownerKeys = getDevTestKeyPairById(username)
      const deviceKeys = getDevTestKeyPairById(`${username}.ood1`)
      const ood = parseOODDescription(oodDesc)
      // mirror of create_zone_boot_config_jwt: wan oods drop the SN host
      const realSnHost = ood.netId?.startsWith('wan') ? undefined : snHost

      test('user_config.json matches newOwnerConfig', () => {
        const fixture = readFixtureJson(username, 'user_config.json')
        const rebuilt = newOwnerConfig({
          did: `did:bns:${username}`,
          name: username,
          fullName: username,
          publicKeyJwk: createJwkByX(ownerKeys.publicKeyX),
          now: fixture.iat,
        })
        expect(rebuilt).toEqual(fixture)
      })

      test('{zone}.zone.json matches newZoneBootConfig (without id)', () => {
        const fixture = readFixtureJson(username, `${zoneHostName}.zone.json`)
        const rebuilt = newZoneBootConfig({
          oods: [oodDesc],
          sn: realSnHost,
          exp: fixture.exp,
        })
        expect(rebuilt).toEqual(fixture)
      })

      test('boot_config_jwt is byte-identical to the Rust-signed JWT', async () => {
        const txtRecord = readFixtureJson(username, 'zone_txt_record.json')
        const bootPayload = decodeJwtClaimWithoutVerify(txtRecord.boot_config_jwt)
        const bootConfig = newZoneBootConfig({
          id: zoneDidStr,
          oods: [oodDesc],
          sn: realSnHost,
          exp: bootPayload.exp,
        })
        const jwt = await encodeZoneBootConfig(bootConfig, ownerKeys.privateKeyPem)
        expect(jwt).toBe(txtRecord.boot_config_jwt)
        // and it verifies with the published pkx
        await expect(decodeZoneBootConfig(jwt, createJwkByX(txtRecord.pkx))).resolves.toEqual(bootPayload)
      })

      test('zone_txt_record mini jwt is byte-identical', async () => {
        const txtRecord = readFixtureJson(username, 'zone_txt_record.json')
        expect(txtRecord.pkx).toBe(ownerKeys.publicKeyX)
        const miniPayload = decodeJwtClaimWithoutVerify(txtRecord.device_mini_doc_jwt)
        const mini = newDeviceMiniConfig({
          name: ood.name,
          x: deviceKeys.publicKeyX,
          rtcpPort: rtcpPort === 2980 ? undefined : rtcpPort,
          exp: miniPayload.exp,
        })
        const jwt = await deviceMiniConfigToJwt(mini, ownerKeys.privateKeyPem)
        expect(jwt).toBe(txtRecord.device_mini_doc_jwt)
      })

      test('zone_config.json matches newZoneConfig + initByBootConfig', () => {
        const fixture = readFixtureJson(username, 'zone_config.json') as BuckyOSZoneDocument
        const txtRecord = readFixtureJson(username, 'zone_txt_record.json')
        const zoneConfig = newZoneConfig({
          id: zoneDidStr,
          ownerDid: `did:bns:${username}`,
          publicKeyJwk: createJwkByX(ownerKeys.publicKeyX),
        })
        const bootConfig = newZoneBootConfig({
          id: zoneDidStr,
          oods: [oodDesc],
          sn: realSnHost,
          exp: fixture.exp,
        })
        zoneConfigInitByBootConfig(zoneConfig, bootConfig, txtRecord.boot_config_jwt)
        expect(zoneConfig).toEqual(fixture)
      })

      test('node_device_config.json matches device config constructor', () => {
        const fixture = readFixtureJson(username, 'ood1', 'node_device_config.json')
        const deviceConfig = newDeviceConfigByJwk('ood1', createJwkByX(deviceKeys.publicKeyX), fixture.iat)
        deviceConfig.net_id = ood.netId
        deviceConfig.owner = `did:bns:${username}`
        deviceConfig.zone_did = zoneDidStr
        // support_container=true is skipped by Rust serde, so it is absent in both
        expect(JSON.parse(JSON.stringify(deviceConfig))).toEqual(fixture)
      })

      test('node_identity.json: device jwts are byte-identical, structure matches', async () => {
        const fixture = readFixtureJson(username, 'ood1', 'node_identity.json')
        const deviceFixture = readFixtureJson(username, 'ood1', 'node_device_config.json')

        const deviceJwt = await encodeDeviceConfig(deviceFixture, ownerKeys.privateKeyPem)
        expect(deviceJwt).toBe(fixture.device_doc_jwt)

        const mini = newDeviceMiniConfigByDeviceConfig(deviceFixture)
        const miniJwt = await deviceMiniConfigToJwt(mini, ownerKeys.privateKeyPem)
        expect(miniJwt).toBe(fixture.device_mini_doc_jwt)

        const rebuilt = newNodeIdentityConfig({
          zoneDid: zoneDidStr,
          ownerPublicKey: createJwkByX(ownerKeys.publicKeyX),
          ownerDid: `did:bns:${username}`,
          deviceDocJwt: deviceJwt,
          deviceMiniDocJwt: miniJwt,
          zoneIat: fixture.zone_iat,
        })
        expect(rebuilt).toEqual(fixture)

        // device doc decodes + verifies with the owner public key (signed by owner!)
        const decoded = await decodeDeviceConfig(fixture.device_doc_jwt, createJwkByX(ownerKeys.publicKeyX))
        expect(decoded).toEqual(deviceFixture)
      })

      test('node_private_key.pem is the preset device key', () => {
        const pem = readFixtureText(username, 'ood1', 'node_private_key.pem')
        expect(pem.trim()).toBe(deviceKeys.privateKeyPem.trim())
      })
    },
  )

  test('device config built by mini config matches sn_device_config.json', async () => {
    const fixture = readFixtureJson('sn', 'sn_server', 'sn_device_config.json')
    const ownerKeys = getDevTestKeyPairById('sn_owner')
    const deviceKeys = getDevTestKeyPairById('sn_server')

    const mini = newDeviceMiniConfig({ name: 'sn', x: deviceKeys.publicKeyX, exp: fixture.exp })
    const miniJwt = await deviceMiniConfigToJwt(mini, ownerKeys.privateKeyPem)
    expect(miniJwt).toBe(fixture.device_mini_config_jwt)

    const deviceConfig = newDeviceConfigByMiniConfig(miniJwt, mini, 'did:web:sn.devtests.org', 'did:bns:sn')
    deviceConfig.net_id = 'wan'
    expect(JSON.parse(JSON.stringify(deviceConfig))).toEqual(fixture)
  })

  test('sn params.json jwts are reproducible', async () => {
    const fixture = readFixtureJson('sn', 'sn_server', 'params.json').params
    const ownerKeys = getDevTestKeyPairById('sn_owner')
    expect(fixture.sn_owner_pk).toBe(ownerKeys.publicKeyX)

    const bootPayload = decodeJwtClaimWithoutVerify(fixture.sn_boot_jwt)
    const bootConfig = newZoneBootConfig({ oods: ['sn'], exp: bootPayload.exp })
    const bootJwt = await encodeZoneBootConfig(bootConfig, ownerKeys.privateKeyPem)
    expect(bootJwt).toBe(fixture.sn_boot_jwt)
  })

  test('owner config with default zone did round trips', async () => {
    const ownerKeys = getDevTestKeyPairById('devtest')
    const ownerConfig = newOwnerConfig({
      did: 'did:bns:lzc',
      name: 'lzc',
      fullName: 'zhicong liu',
      publicKeyJwk: createJwkByX(ownerKeys.publicKeyX),
      now: 1743478939,
    })
    setOwnerDefaultZoneDid(ownerConfig, 'did:bns:waterflier')
    expect(ownerConfig.default_zone_did).toBe('did:bns:waterflier')
    expect(ownerConfig.service).toEqual([
      {
        id: 'did:bns:lzc#lastDoc',
        type: 'DIDDoc',
        serviceEndpoint: 'https://waterflier.bns.did/resolve/did:bns:lzc',
      },
    ])

    const jwt = await signJwtEdDSA(ownerConfig, ownerKeys.privateKeyPem)
    const payload = await verifyJwtEdDSA(jwt, createJwkByX(ownerKeys.publicKeyX))
    expect(payload.name).toBe('lzc')
  })
})
