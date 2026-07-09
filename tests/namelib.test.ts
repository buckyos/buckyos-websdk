import * as fs from 'fs'
import * as path from 'path'
import { Buffer } from 'buffer'

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
  DEFAULT_EXPIRE_TIME,
  newOwnerDocument,
  newOwnerDocumentByPkx,
  ownerDocumentSetDefaultZoneDid,
  ownerDocumentGetDefaultZoneDid,
  ownerDocumentValidateJwtRevocation,
  newZoneDocument,
  newZoneBootDocument,
  encodeZoneBootDocument,
  decodeZoneBootDocument,
  newDeviceDocumentByJwk,
  newDeviceDocumentByMiniDocument,
  encodeDeviceDocument,
  decodeDeviceDocument,
  newDeviceMiniDocument,
  newDeviceMiniDocumentByDeviceDocument,
  deviceMiniDocumentToJwt,
  deviceDocumentToOrderedJson,
  resetKnownWeb3BridgeConfigForTest,
  setKnownWeb3BridgeConfig,
  parseDidDoc,
  getKeyByScope,
  isKeyAllowedInScope,
  KEY_SCOPE_CONTENT_CREATE,
  KEY_SCOPE_MANUAL,
} from '../src/namelib'
import { buildDeviceDid, newDeviceDocumentByJwkWithDid } from '../src/device_identity'
import {
  DEV_TEST_EVM_SEED_SENDER,
  DEV_TEST_KEYS,
  deriveDevTestEvmAccount,
  deriveDevTestEvmAccountFromMnemonic,
  deriveDevTestKeyPair,
  deriveDevTestKeyPairFromMnemonic,
  devTestKeccak256,
  getDevTestEvmAccountByUsername,
  getDevTestKeyPairById,
} from '../src/dev_test_keys'
import { BuckyOSOwnerDocument, BuckyOSZoneDocument } from '../src/types'

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

  test('to_raw_host_uri keeps DID method raw host semantics', () => {
    setKnownWeb3BridgeConfig({ bns: 'web3.buckyos.io' })

    expect(DID.fromStr('did:web:example.com:user:alice').toRawHostUri()).toBe('example.com/user/alice')
    expect(DID.fromStr('did:bns:app1.waterflier').toRawHostUri()).toBe('app1.waterflier.bns.did')
  })

  test('upper_did (mirror of did.rs test_upper_did)', () => {
    const upper = (s: string) => DID.fromStr(s).upperDid()?.toString() ?? null

    expect(upper('did:web:ood1.example.com')).toBe('did:web:example.com')
    expect(upper('did:web:a.b.example.com')).toBe('did:web:b.example.com')
    // ports and paths do not take part in the name hierarchy
    expect(upper('did:web:ood1.example.com%3A8080')).toBe('did:web:example.com')
    expect(upper('did:web:ood1.example.com:devices:cam01')).toBe('did:web:example.com')
    // only the TLD would remain -> no upper
    expect(upper('did:web:example.com')).toBeNull()
    // IPs have no name hierarchy
    expect(upper('did:web:127.0.0.1')).toBeNull()
    expect(upper('did:web:127.0.0.1%3A3200')).toBeNull()
    // bns: first-level names are roots
    expect(upper('did:bns:app1.alice')).toBe('did:bns:alice')
    expect(upper('did:bns:alice')).toBeNull()
    // key DIDs have no name hierarchy
    expect(upper('did:dev:5bUuyWLOKyCre9az_IhJVIuOw8bA0gyKjstcYGHbaPE')).toBeNull()
  })

  test('to_filename (mirror of did.rs test_did_to_filename)', () => {
    expect(DID.fromStr('did:web:node1.example.com').toFilename()).toBe('node1.example.com')
    expect(DID.fromStr('did:web:example.com:user:alice').toFilename()).toBe('example.com%2Fuser%2Falice')
    expect(DID.fromStr('did:web:example.com%3A3000:user:alice').toFilename()).toBe('example.com%253A3000%2Fuser%2Falice')
    expect(new DID('web', 'example.com:user:é').toFilename()).toBe('example.com%2Fuser%2F%C3%A9')
    expect(DID.fromStr('did:bns:waterflier').toFilename()).toBe('waterflier.bns.did')
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
  test('mnemonic derivation matches Rust name-lib vectors', () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
    const vectors = [
      {
        index: 0,
        privateKeyPem: '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIF4xu8hmb1YxptX7yh/UJuIXJ6yjmUdUkL8kwVfOTjzu\n-----END PRIVATE KEY-----\n',
        publicKeyX: 'TFCczaH036J93MRNk0bMMy5zpAha29uNOO7WgcWnrWo',
        privateKeyHex: '1ab42cc412b618bdea3a599e3c9bae199ebf030895b039e9db1e30dafb12b727',
        publicKeyCompressedHex: '0237b0bb7a8288d38ed49a524b5dc98cff3eb5ca824c9f9dc0dfdb3d9cd600f299',
        publicKeyUncompressedHex: '0437b0bb7a8288d38ed49a524b5dc98cff3eb5ca824c9f9dc0dfdb3d9cd600f299a6179912b7451c09896c4098eca7ce6b2e58330672795e847c4d6af44e024230',
        address: '0x9858EfFD232B4033E47d90003D41EC34EcaEda94',
      },
      {
        index: 1,
        privateKeyPem: '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIJbxfiEsg4DzfDJyFvla6OaxgJkUhxw6CO7iOUdwB/11\n-----END PRIVATE KEY-----\n',
        publicKeyX: 'QTDEn2PegzU07spmHCZaX-3vaDdX22U8kgBkK_IMTuE',
        privateKeyHex: '9a983cb3d832fbde5ab49d692b7a8bf5b5d232479c99333d0fc8e1d21f1b55b6',
        publicKeyCompressedHex: '039fd0991d0222b4e1339c1a1a5b5f6d9f6a96672a3247b638ee6156d9ea877a2f',
        publicKeyUncompressedHex: '049fd0991d0222b4e1339c1a1a5b5f6d9f6a96672a3247b638ee6156d9ea877a2f1735e3a9260940e4c2225c344a8cea6c7b6a6057d0eb90a9a875f446c131031d',
        address: '0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0',
      },
    ]

    for (const vector of vectors) {
      expect(deriveDevTestKeyPairFromMnemonic(mnemonic, undefined, vector.index)).toEqual({
        privateKeyPem: vector.privateKeyPem,
        publicKeyX: vector.publicKeyX,
      })
      expect(deriveDevTestEvmAccountFromMnemonic(mnemonic, undefined, vector.index)).toMatchObject({
        derivationPath: `m/44'/60'/0'/0/${vector.index}`,
        privateKeyHex: vector.privateKeyHex,
        privateKey: `0x${vector.privateKeyHex}`,
        publicKeyCompressedHex: vector.publicKeyCompressedHex,
        publicKeyUncompressedHex: vector.publicKeyUncompressedHex,
        address: vector.address,
      })
    }
  })

  test('fixed dev mnemonic derives the default Bucky key', () => {
    expect(deriveDevTestKeyPair(0)).toEqual({
      privateKeyPem: '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIDxBv2ry9DlYbSGjzEcJ3SwOFnKnjjZa1W021xFZpZgV\n-----END PRIVATE KEY-----\n',
      publicKeyX: 'R-swHRG5T5L_310J-LsvidbkzKdUndd8usMY6Loo6e4',
    })
  })

  test('EVM derivation matches Anvil fixed mnemonic accounts', () => {
    expect(devTestKeccak256(Buffer.alloc(0)).toString('hex'))
      .toBe('c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470')
    expect(DEV_TEST_EVM_SEED_SENDER).toMatchObject({
      derivationPath: "m/44'/60'/0'/0/0",
      address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    })
    expect(deriveDevTestEvmAccount(1)).toMatchObject({
      derivationPath: "m/44'/60'/0'/0/1",
      address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    })
    expect(getDevTestEvmAccountByUsername('dave')).toMatchObject({
      address: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
      privateKey: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
    })
  })

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
})

describe('parseDidDoc (mirror of did.rs parse_did_doc)', () => {
  const ownerKeys = getDevTestKeyPairById('devtest')

  test('routes owner/device/zone documents by shape', () => {
    const ownerDoc = newOwnerDocument({
      did: 'did:bns:alice',
      name: 'alice',
      displayName: 'alice',
      publicKeyJwk: createJwkByX(ownerKeys.publicKeyX),
    })
    expect(parseDidDoc(JSON.stringify(ownerDoc)).docType).toBe('owner')

    const deviceDoc = newDeviceDocumentByJwk('ood1', createJwkByX(ownerKeys.publicKeyX))
    expect(parseDidDoc(JSON.stringify(deviceDoc)).docType).toBe('device')

    const zoneDoc = newZoneDocument({
      id: 'did:bns:alice',
      ownerDid: 'did:bns:alice',
      publicKeyJwk: createJwkByX(ownerKeys.publicKeyX),
    })
    expect(parseDidDoc(JSON.stringify(zoneDoc)).docType).toBe('zone')

    const card = {
      '@context': 'https://www.w3.org/ns/did/v1',
      id: 'did:bns:photo.alice',
      service: [{ id: '#did-object', type: 'DIDObjectService', serviceEndpoint: 'https://x', profile: 'p' }],
    }
    expect(parseDidDoc(JSON.stringify(card)).docType).toBe('did-object')

    expect(() => parseDidDoc('{"hello":"world"}')).toThrow('unknown did document')
  })

  test('owner routing accepts full_name / displayName aliases', () => {
    const base = {
      '@context': 'https://www.w3.org/ns/did/v1',
      id: 'did:bns:alice',
      verificationMethod: [],
      name: 'alice',
    }
    expect(parseDidDoc(JSON.stringify({ ...base, full_name: 'a' })).docType).toBe('owner')
    expect(parseDidDoc(JSON.stringify({ ...base, displayName: 'a' })).docType).toBe('owner')
  })

  test('JWT documents must carry version_seq', async () => {
    const ownerDoc = newOwnerDocument({
      did: 'did:bns:alice',
      name: 'alice',
      displayName: 'alice',
      publicKeyJwk: createJwkByX(ownerKeys.publicKeyX),
    })
    delete (ownerDoc as Record<string, unknown>).version_seq
    const jwt = await signJwtEdDSA(ownerDoc, ownerKeys.privateKeyPem)
    expect(() => parseDidDoc(jwt)).toThrow('version_seq')
  })
})

describe('key scopes (mirror of user.rs key scope tests)', () => {
  const ownerKeys = getDevTestKeyPairById('devtest')

  function buildOwnerDoc(): BuckyOSOwnerDocument {
    return newOwnerDocument({
      did: 'did:bns:lzc',
      name: 'lzc',
      displayName: 'zhicong liu',
      publicKeyJwk: createJwkByX(ownerKeys.publicKeyX),
      now: 1743478939,
    })
  }

  test('documents without keyScope fall back to standard scope keys', () => {
    const ownerDoc = buildOwnerDoc()
    expect(isKeyAllowedInScope(ownerDoc, KEY_SCOPE_CONTENT_CREATE, '#main_key')).toBe(true)
    expect(getKeyByScope(ownerDoc, KEY_SCOPE_CONTENT_CREATE)?.[0]).toBe('#main_key')
  })

  test('documents with a keyScope map deny unlisted scopes', () => {
    const ownerDoc = buildOwnerDoc()
    const mainKeyId = `${ownerDoc.id}#main_key`
    ownerDoc.keyScope = { [KEY_SCOPE_MANUAL]: [mainKeyId] }

    expect(isKeyAllowedInScope(ownerDoc, KEY_SCOPE_CONTENT_CREATE, '#main_key')).toBe(false)
    expect(getKeyByScope(ownerDoc, KEY_SCOPE_CONTENT_CREATE)).toBeNull()

    expect(isKeyAllowedInScope(ownerDoc, KEY_SCOPE_MANUAL, '#main_key')).toBe(true)
    expect(isKeyAllowedInScope(ownerDoc, KEY_SCOPE_MANUAL, mainKeyId)).toBe(true)
    expect(getKeyByScope(ownerDoc, KEY_SCOPE_MANUAL)?.[0]).toBe(mainKeyId)
  })

  test('accepts the buckyos:scopes alias', () => {
    const ownerDoc = buildOwnerDoc() as BuckyOSOwnerDocument & Record<string, unknown>
    ownerDoc['buckyos:scopes'] = { [KEY_SCOPE_CONTENT_CREATE]: ['did:bucky:lzc#identity-cold'] }

    expect(isKeyAllowedInScope(ownerDoc, KEY_SCOPE_CONTENT_CREATE, 'did:bucky:lzc#identity-cold')).toBe(true)
    expect(isKeyAllowedInScope(ownerDoc, KEY_SCOPE_MANUAL, '#main_key')).toBe(false)
  })
})

describe('owner document revocation policy (mirror of user.rs replay guard)', () => {
  test('rejects stale version_seq / iat jwts', async () => {
    const ownerKeys = getDevTestKeyPairById('devtest')
    const ownerDoc = newOwnerDocument({
      did: 'did:bns:lzc',
      name: 'lzc',
      displayName: 'zhicong liu',
      publicKeyJwk: createJwkByX(ownerKeys.publicKeyX),
    })
    ownerDoc.mini_version_seq = 3
    ownerDoc.valid_iat = 100

    const freshJwt = await signJwtEdDSA({ version_seq: 4, iat: 101, exp: 1000 }, ownerKeys.privateKeyPem)
    expect(() =>
      ownerDocumentValidateJwtRevocation(ownerDoc, 'ZoneDocument', { type: 'jwt', jwt: freshJwt }),
    ).not.toThrow()

    const staleVersionJwt = await signJwtEdDSA({ version_seq: 3, iat: 101, exp: 1000 }, ownerKeys.privateKeyPem)
    expect(() =>
      ownerDocumentValidateJwtRevocation(ownerDoc, 'ZoneDocument', { type: 'jwt', jwt: staleVersionJwt }),
    ).toThrow('mini_version_seq')

    const staleIatJwt = await signJwtEdDSA({ version_seq: 4, iat: 100, exp: 1000 }, ownerKeys.privateKeyPem)
    expect(() =>
      ownerDocumentValidateJwtRevocation(ownerDoc, 'ZoneDocument', { type: 'jwt', jwt: staleIatJwt }),
    ).toThrow('valid_iat')
  })
})

describe('newOwnerDocumentByPkx (mirror of user.rs new_by_pkx tests)', () => {
  const validX = 'T4Quc1L6Ogu4N2tTKOvneV1yYnBcmhP89B_RsuFsJZ8'

  test('accepts single-part pkx', () => {
    const doc = newOwnerDocumentByPkx(validX, 'did:web:example.com')
    expect(doc.id).toBe('did:web:example.com')
    expect(doc.name).toBe('example.com')
    expect(doc.display_name).toBe('example.com@did:web:example.com')
  })

  test('accepts three-part pkx', () => {
    const doc = newOwnerDocumentByPkx(`${validX}:bns:user1:xxxx`, 'bridge.buckyos.org')
    expect(doc.id).toBe('did:bns:user1')
    expect(doc.name).toBe('user1')
    expect(doc.display_name).toBe('user1@bridge.buckyos.org')
  })

  test('rejects two-part / malformed pkx', () => {
    expect(() => newOwnerDocumentByPkx('abc123:onlytwo', 'did:web:example.com')).toThrow()
    expect(() => newOwnerDocumentByPkx('not_base64!:bns:user1', 'bridge.buckyos.org')).toThrow()
    expect(() => newOwnerDocumentByPkx('AQ:bns:user1', 'bridge.buckyos.org')).toThrow()
  })
})

describe('golden fixtures (generated by buckycli, see fixtures README)', () => {
  describe.each([
    ['alice', 'did:bns:alice', 'alice.bns.did', 'ood1', 'sn.devtests.org', 2980],
    ['charlie', 'did:web:charlie.me', 'charlie.me', 'ood1@portmap', 'sn.devtests.org', 2981],
    ['devtest', 'did:web:test.buckyos.io', 'test.buckyos.io', 'ood1@wan', undefined, 2980],
  ] as Array<[string, string, string, string, string | undefined, number]>)(
    '%s env',
    (username, zoneDidStr, zoneHostName, oodDesc, snHost, rtcpPort) => {
      const ood = parseOODDescription(oodDesc)
      // mirror of create_zone_boot_config_jwt: wan oods drop the SN host
      const realSnHost = ood.netId?.startsWith('wan') ? undefined : snHost
      const deviceDid = buildDeviceDid('ood1', DID.fromStr(zoneDidStr))
      const identityDirName = deviceDid.toFilename()
      const ownerKeys = {
        privateKeyPem: readFixtureText(username, 'user_private_key.pem'),
        publicKeyX: readFixtureJson(username, 'zone_txt_record.json').pkx,
      }
      const fixtureDeviceDoc = readFixtureJson(username, 'ood1', 'local', 'identity', identityDirName, 'did.json')
      const deviceKeys = {
        privateKeyPem: readFixtureText(username, 'ood1', 'security', identityDirName, 'authentication.private.pem'),
        publicKeyX: fixtureDeviceDoc.verificationMethod[0].publicKeyJwk.x,
      }

      test('user_config.json matches newOwnerDocument', () => {
        const fixture = readFixtureJson(username, 'user_config.json')
        const rebuilt = newOwnerDocument({
          did: `did:bns:${username}`,
          name: username,
          displayName: username,
          publicKeyJwk: createJwkByX(ownerKeys.publicKeyX),
          now: fixture.iat,
        })
        expect(rebuilt).toEqual(fixture)
      })

      test('{zone}.zone.json matches newZoneBootDocument (without id)', () => {
        const fixture = readFixtureJson(username, `${zoneHostName}.zone.json`)
        const rebuilt = newZoneBootDocument({
          oods: [oodDesc],
          sn: realSnHost,
          exp: fixture.exp,
        })
        expect(rebuilt).toEqual(fixture)
      })

      test('boot_config_jwt is byte-identical to the Rust-signed JWT', async () => {
        const txtRecord = readFixtureJson(username, 'zone_txt_record.json')
        const bootPayload = decodeJwtClaimWithoutVerify(txtRecord.boot_config_jwt)
        const bootDoc = newZoneBootDocument({
          id: zoneDidStr,
          oods: [oodDesc],
          sn: realSnHost,
          exp: bootPayload.exp,
        })
        const jwt = await encodeZoneBootDocument(bootDoc, ownerKeys.privateKeyPem)
        expect(jwt).toBe(txtRecord.boot_config_jwt)
        // and it verifies with the published pkx
        await expect(decodeZoneBootDocument(jwt, createJwkByX(txtRecord.pkx))).resolves.toEqual(bootPayload)
      })

      test('zone_txt_record mini jwt is byte-identical', async () => {
        const txtRecord = readFixtureJson(username, 'zone_txt_record.json')
        expect(txtRecord.pkx).toBe(ownerKeys.publicKeyX)
        const miniPayload = decodeJwtClaimWithoutVerify(txtRecord.device_mini_doc_jwt)
        const mini = newDeviceMiniDocument({
          name: ood.name,
          x: deviceKeys.publicKeyX,
          rtcpPort: rtcpPort === 2980 ? undefined : rtcpPort,
          exp: miniPayload.exp,
        })
        const jwt = await deviceMiniDocumentToJwt(mini, ownerKeys.privateKeyPem)
        expect(jwt).toBe(txtRecord.device_mini_doc_jwt)
      })

      test('zone_config.json matches newZoneDocument + boot document fields', () => {
        const fixture = readFixtureJson(username, 'zone_config.json') as BuckyOSZoneDocument
        const txtRecord = readFixtureJson(username, 'zone_txt_record.json')
        const zoneDoc = newZoneDocument({
          id: zoneDidStr,
          ownerDid: `did:bns:${username}`,
          publicKeyJwk: createJwkByX(ownerKeys.publicKeyX),
        })
        const bootDoc = newZoneBootDocument({
          id: zoneDidStr,
          oods: [oodDesc],
          sn: realSnHost,
          exp: fixture.exp,
        })
        zoneDoc.boot_jwt = txtRecord.boot_config_jwt
        zoneDoc.id = bootDoc.id ?? zoneDoc.id
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
        if (bootDoc.owner_key !== undefined) {
          zoneDoc.verificationMethod[0].publicKeyJwk = bootDoc.owner_key
        }
        expect(zoneDoc).toEqual(fixture)
      })

      test('identity did.json matches the name-based device document', () => {
        const fixture = readFixtureJson(username, 'ood1', 'local', 'identity', identityDirName, 'did.json')
        expect(fixture.id).toBe(deviceDid.toString())

        const deviceDoc = newDeviceDocumentByJwkWithDid(
          'ood1',
          createJwkByX(deviceKeys.publicKeyX),
          deviceDid,
          fixture.iat,
        )
        deviceDoc.net_id = fixture.net_id
        deviceDoc.owner = `did:bns:${username}`
        deviceDoc.zone_did = zoneDidStr
        // support_container=true is skipped by Rust serde, so it is absent in both
        expect(deviceDocumentToOrderedJson(deviceDoc)).toEqual(fixture)
        // ordered view is byte-identical to serde_json::to_string_pretty output
        expect(JSON.stringify(deviceDocumentToOrderedJson(deviceDoc), null, 2))
          .toBe(readFixtureText(username, 'ood1', 'local', 'identity', identityDirName, 'did.json'))
      })

      test('device_doc.jwt / device_mini_doc.jwt are byte-identical, signed by owner', async () => {
        const didJson = readFixtureJson(username, 'ood1', 'local', 'identity', identityDirName, 'did.json')
        const deviceDocJwt = readFixtureText(username, 'ood1', 'local', 'identity', identityDirName, 'device_doc.jwt')
        const deviceMiniDocJwt = readFixtureText(username, 'ood1', 'local', 'identity', identityDirName, 'device_mini_doc.jwt')
        const nodeMiniJwt = readFixtureText(username, 'ood1', 'device_mini_config.jwt')

        const rebuiltJwt = await encodeDeviceDocument(didJson, ownerKeys.privateKeyPem)
        expect(rebuiltJwt).toBe(deviceDocJwt)

        const mini = newDeviceMiniDocumentByDeviceDocument(didJson)
        const rebuiltMiniJwt = await deviceMiniDocumentToJwt(mini, ownerKeys.privateKeyPem)
        expect(rebuiltMiniJwt).toBe(deviceMiniDocJwt)
        expect(rebuiltMiniJwt).toBe(nodeMiniJwt)

        // device doc decodes + verifies with the owner public key (signed by owner!)
        const decoded = await decodeDeviceDocument(deviceDocJwt, createJwkByX(ownerKeys.publicKeyX))
        expect(decoded).toEqual(didJson)
      })

      test('node_identity.json is schema v2 with the name-based device did', () => {
        const fixture = readFixtureJson(username, 'ood1', 'node_identity.json')
        expect(fixture).toEqual({
          schema: 'buckyos.node_identity.v2',
          zone_did: zoneDidStr,
          owner_did: `did:bns:${username}`,
          owner_public_key: createJwkByX(ownerKeys.publicKeyX),
          device_name: 'ood1',
          device_did: deviceDid.toString(),
          zone_iat: 1743478939,
        })
      })

      test('authentication.private.pem matches the fixture device public key', async () => {
        const pem = readFixtureText(username, 'ood1', 'security', identityDirName, 'authentication.private.pem')
        await expect(getPublicKeyXFromPrivatePem(pem)).resolves.toBe(deviceKeys.publicKeyX)
      })
    },
  )

  test('device document built by mini document matches sn_device_config.json', async () => {
    const fixture = readFixtureJson('sn', 'sn_server', 'sn_device_config.json')
    const params = readFixtureJson('sn', 'sn_server', 'params.json').params
    const ownerKeys = {
      privateKeyPem: readFixtureText('sn', 'sn_server', '.buckycli', 'user_private_key.pem'),
      publicKeyX: params.sn_owner_pk,
    }
    const deviceKeys = {
      privateKeyPem: readFixtureText('sn', 'sn_server', 'sn_private_key.pem'),
      publicKeyX: fixture.verificationMethod[0].publicKeyJwk.x,
    }

    const mini = newDeviceMiniDocument({ name: 'sn', x: deviceKeys.publicKeyX, exp: fixture.exp })
    const miniJwt = await deviceMiniDocumentToJwt(mini, ownerKeys.privateKeyPem)
    expect(miniJwt).toBe(fixture.device_mini_document_jwt)

    const deviceDoc = newDeviceDocumentByMiniDocument(miniJwt, mini, 'did:web:sn.devtests.org', 'did:bns:sn')
    deviceDoc.net_id = 'wan'
    expect(deviceDocumentToOrderedJson(deviceDoc)).toEqual(fixture)
  })

  test('sn params.json jwts are reproducible', async () => {
    const fixture = readFixtureJson('sn', 'sn_server', 'params.json').params
    const ownerKeys = {
      privateKeyPem: readFixtureText('sn', 'sn_server', '.buckycli', 'user_private_key.pem'),
      publicKeyX: fixture.sn_owner_pk,
    }
    expect(fixture.sn_owner_pk).toBe(ownerKeys.publicKeyX)

    const bootPayload = decodeJwtClaimWithoutVerify(fixture.sn_boot_jwt)
    const bootDoc = newZoneBootDocument({ oods: ['sn'], exp: bootPayload.exp })
    const bootJwt = await encodeZoneBootDocument(bootDoc, ownerKeys.privateKeyPem)
    expect(bootJwt).toBe(fixture.sn_boot_jwt)
  })

  test('owner document with default zone did round trips', async () => {
    const ownerKeys = getDevTestKeyPairById('devtest')
    const ownerDoc = newOwnerDocument({
      did: 'did:bns:lzc',
      name: 'lzc',
      displayName: 'zhicong liu',
      publicKeyJwk: createJwkByX(ownerKeys.publicKeyX),
      now: 1743478939,
    })
    ownerDocumentSetDefaultZoneDid(ownerDoc, 'did:bns:waterflier')
    expect(ownerDoc.binded_zone_list).toEqual(['did:bns:waterflier'])
    expect(ownerDocumentGetDefaultZoneDid(ownerDoc)).toBe('did:bns:waterflier')
    expect(ownerDoc.service).toEqual([
      {
        id: 'did:bns:lzc#lastDoc',
        type: 'DIDDoc',
        serviceEndpoint: 'https://waterflier.bns.did/resolve/did:bns:lzc',
      },
    ])

    // setting a new default moves it to the front and replaces the service
    ownerDocumentSetDefaultZoneDid(ownerDoc, 'did:bns:zone2')
    expect(ownerDoc.binded_zone_list).toEqual(['did:bns:zone2', 'did:bns:waterflier'])
    expect(ownerDoc.service).toHaveLength(1)
    expect(ownerDoc.service?.[0].serviceEndpoint).toBe('https://zone2.bns.did/resolve/did:bns:lzc')

    const jwt = await signJwtEdDSA(ownerDoc, ownerKeys.privateKeyPem)
    const payload = await verifyJwtEdDSA(jwt, createJwkByX(ownerKeys.publicKeyX))
    expect(payload.name).toBe('lzc')
  })
})
