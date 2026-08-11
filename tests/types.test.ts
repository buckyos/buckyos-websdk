import {
  DID_OBJECT_SERVICE_TYPE,
  getDidIdentifier,
  getDidMethod,
  isBuckyOSDIDObjectCard,
  isBuckyOSLocalNodeIdentityConfig,
  isBuckyOSZoneConfig,
  isW3CDIDDocumentBase,
  NODE_IDENTITY_SCHEMA_V2,
  parseBuckyOSDIDDocument,
  parseBuckyOSDeviceMiniDocument,
  parseBuckyOSOwnerDocument,
} from '../src/types'

describe('buckyos did document types', () => {
  it('parses OwnerDocument using the standard document shape', () => {
    const ownerDoc = {
      '@context': 'https://www.w3.org/ns/did/v1',
      id: 'did:bns:alice',
      verificationMethod: [],
      authentication: [],
      exp: 2200000000,
      iat: 1700000000,
      name: 'alice',
      display_name: 'alice@example',
      binded_zone_list: ['did:web:test.buckyos.io'],
    }

    expect(parseBuckyOSOwnerDocument(ownerDoc)).toEqual(ownerDoc)
    expect(parseBuckyOSDIDDocument(ownerDoc)).toEqual(ownerDoc)
    expect(isW3CDIDDocumentBase(ownerDoc)).toBe(true)
  })

  it('accepts the legacy full_name / displayName aliases when routing', () => {
    const base = {
      '@context': 'https://www.w3.org/ns/did/v1',
      id: 'did:bns:alice',
      verificationMethod: [],
      authentication: [],
      exp: 2200000000,
      iat: 1700000000,
      name: 'alice',
    }
    expect(parseBuckyOSOwnerDocument({ ...base, full_name: 'alice' })).not.toBeNull()
    expect(parseBuckyOSOwnerDocument({ ...base, displayName: 'alice' })).not.toBeNull()
    expect(parseBuckyOSOwnerDocument(base)).toBeNull()
  })

  it('routes device and zone did documents by shape', () => {
    const deviceDoc = {
      '@context': 'https://www.w3.org/ns/did/v1',
      id: 'did:bns:ood1.alice',
      verificationMethod: [],
      authentication: [],
      exp: 2200000000,
      iat: 1700000000,
      owner: 'did:bns:alice',
      device_type: 'ood',
      name: 'ood1',
    }
    const zoneDoc = {
      '@context': 'https://www.w3.org/ns/did/v1',
      id: 'did:bns:test',
      verificationMethod: [],
      authentication: [],
      exp: 2200000000,
      iat: 1700000000,
      hostname: 'test.buckyos.io',
      owner: 'did:bns:alice',
      oods: ['ood1'],
      boot_jwt: 'boot-jwt',
    }

    expect(parseBuckyOSDIDDocument(deviceDoc)).toEqual(deviceDoc)
    expect(parseBuckyOSDIDDocument(zoneDoc)).toEqual(zoneDoc)
  })

  it('routes DID Object Cards by their DIDObjectService service entry', () => {
    const card = {
      '@context': 'https://www.w3.org/ns/did/v1',
      id: 'did:bns:photo.alice',
      service: [
        {
          id: '#did-object',
          type: DID_OBJECT_SERVICE_TYPE,
          serviceEndpoint: 'https://alice.bns.did/objects/photo',
          profile: 'photo',
        },
      ],
    }
    expect(isBuckyOSDIDObjectCard(card)).toBe(true)
    expect(parseBuckyOSDIDDocument(card)).toEqual(card)
  })

  it('parses DeviceMiniDocument and basic DID helpers', () => {
    expect(parseBuckyOSDeviceMiniDocument({ n: 'ood1', x: 'pkx', exp: 1 })).toEqual({
      n: 'ood1',
      x: 'pkx',
      exp: 1,
    })
    expect(getDidMethod('did:web:test.buckyos.io')).toBe('web')
    expect(getDidIdentifier('did:web:test.buckyos.io')).toBe('test.buckyos.io')
    expect(getDidMethod('not-a-did')).toBeNull()
  })

  it('recognizes node identity schema v2 and the ZoneConfig wrapper', () => {
    expect(
      isBuckyOSLocalNodeIdentityConfig({
        schema: NODE_IDENTITY_SCHEMA_V2,
        zone_did: 'did:bns:alice',
        owner_did: 'did:bns:alice',
        owner_public_key: { kty: 'OKP', crv: 'Ed25519', x: 'x' },
        device_name: 'ood1',
        device_did: 'did:bns:ood1.alice',
        zone_iat: 1743478939,
      }),
    ).toBe(true)
    // v1 identity files (embedded jwts, no schema) are NOT v2
    expect(
      isBuckyOSLocalNodeIdentityConfig({
        zone_did: 'did:bns:alice',
        owner_public_key: { kty: 'OKP', crv: 'Ed25519', x: 'x' },
        owner_did: 'did:bns:alice',
        device_doc_jwt: 'jwt',
        device_mini_doc_jwt: 'jwt',
        zone_iat: 1743478939,
      }),
    ).toBe(false)

    expect(isBuckyOSZoneConfig({ zone_document: '{"id":"did:bns:alice"}' })).toBe(true)
    expect(
      isBuckyOSZoneConfig({
        zone_document: 'jwt-string',
        docker_repo_base_url: 'https://repo.buckyos.io',
        verify_hub_info: { public_key: { kty: 'OKP', crv: 'Ed25519', x: 'x' } },
      }),
    ).toBe(true)
    expect(isBuckyOSZoneConfig({})).toBe(false)
  })
})
