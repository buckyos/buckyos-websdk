import {
  getDidIdentifier,
  getDidMethod,
  isW3CDIDDocumentBase,
  parseBuckyOSDIDDocument,
  parseBuckyOSOwnerConfigDocument,
  parseDeviceMiniConfig,
  parseOwnerConfigDocument,
} from '../src/types'

describe('buckyos did document types', () => {
  it('parses OwnerConfig using the standard document shape', () => {
    const ownerConfig = {
      '@context': 'https://www.w3.org/ns/did/v1',
      id: 'did:bns:alice',
      verificationMethod: [],
      authentication: [],
      exp: 2200000000,
      iat: 1700000000,
      name: 'alice',
      full_name: 'alice@example',
      default_zone_did: 'did:web:test.buckyos.io',
    }

    expect(parseOwnerConfigDocument(ownerConfig)).toEqual(ownerConfig)
    expect(parseBuckyOSOwnerConfigDocument(ownerConfig)).toEqual(ownerConfig)
    expect(parseBuckyOSDIDDocument(ownerConfig)).toEqual(ownerConfig)
    expect(isW3CDIDDocumentBase(ownerConfig)).toBe(true)
  })

  it('routes device and zone did documents by shape', () => {
    const deviceDoc = {
      '@context': 'https://www.w3.org/ns/did/v1',
      id: 'did:dev:abc',
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

  it('parses DeviceMiniConfig and basic DID helpers', () => {
    expect(parseDeviceMiniConfig({ n: 'ood1', x: 'pkx', exp: 1 })).toEqual({
      n: 'ood1',
      x: 'pkx',
      exp: 1,
    })
    expect(getDidMethod('did:web:test.buckyos.io')).toBe('web')
    expect(getDidIdentifier('did:web:test.buckyos.io')).toBe('test.buckyos.io')
    expect(getDidMethod('not-a-did')).toBeNull()
  })
})
