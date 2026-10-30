import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import {
  canonicalJson,
  configKeyFromUrl,
  expandInputShorthand,
  formatObjectUrl,
  objectDid,
  objectEndpoint,
  objectEventKey,
  objServiceUrl,
  parseObjectUrl,
  rbacResourceKey,
} from '../src/object_url'
import { ObjId } from '../src/ndn_types'

type Vector = {
  input: string
  shorthand?: boolean
  error?: boolean
  canonical?: string
  kind?: string
  resource_key?: string
  event?: string
  event_key?: string
  endpoint?: string
  no_endpoint?: boolean
}

const fixture = join(__dirname, 'fixtures', 'object_url_vectors.json')
const vectors: Vector[] = JSON.parse(readFileSync(fixture, 'utf8'))

function kindOf(url: ReturnType<typeof parseObjectUrl>): string {
  if (url.kind === 'obj') return url.host.kind === 'service' ? 'obj_service' : 'obj_entity'
  return url.kind
}

describe('object_url shared vectors', () => {
  it('matches the buckyos-api copy when the sibling repo is present', () => {
    const upstream = join(__dirname, '..', '..', 'buckyos', 'src', 'kernel', 'buckyos-api', 'testdata', 'object_url_vectors.json')
    if (existsSync(upstream)) {
      expect(JSON.parse(readFileSync(upstream, 'utf8'))).toEqual(vectors)
    }
  })

  for (const v of vectors) {
    it(v.input, () => {
      const input = v.shorthand ? expandInputShorthand(v.input) : v.input
      if (v.error) {
        expect(() => parseObjectUrl(input)).toThrow()
        return
      }
      const parsed = parseObjectUrl(input)
      if (v.canonical) {
        expect(formatObjectUrl(parsed)).toBe(v.canonical)
        expect(formatObjectUrl(parseObjectUrl(v.canonical))).toBe(v.canonical)
      }
      if (v.kind) expect(kindOf(parsed)).toBe(v.kind)
      if (v.resource_key) expect(rbacResourceKey(parsed, 'test.buckyos.io')).toBe(v.resource_key)
      if (v.event && v.event_key) expect(objectEventKey(parsed, v.event)).toBe(v.event_key)
      if (v.endpoint) expect(objectEndpoint(parsed, 'http://gw:3180', 'test.buckyos.io')).toBe(v.endpoint)
      if (v.no_endpoint) expect(objectEndpoint(parsed, 'http://gw:3180', 'test.buckyos.io')).toBeNull()
    })
  }
})

describe('object_url helpers', () => {
  it('round-trips an ObjId host', () => {
    const objId = new ObjId('cyfile', new Uint8Array(32).fill(7))
    const url = `cyfs://${objId.toBase32()}.test.buckyos.io/a/b.txt`
    expect(formatObjectUrl(parseObjectUrl(url))).toBe(url)
    expect(() => parseObjectUrl(`obj://${objId.toBase32()}/x`)).toThrow()
  })

  it('derives path DIDs and builds urls', () => {
    expect(objectDid(parseObjectUrl('obj://homestation/home/alice/feed'), 'did:web:test.buckyos.io')).toBe(
      'did:web:test.buckyos.io:homestation:home:alice:feed',
    )
    expect(objectDid(parseObjectUrl('obj://xiaobai.test.buckyos.io/sessions/s1'), 'did:web:test.buckyos.io')).toBe(
      'did:web:xiaobai.test.buckyos.io:sessions:s1',
    )
    expect(objServiceUrl('msg-center', ['owners', 'did:bns:alice', 'sessions', 'a b'])).toBe(
      'obj://msg-center/owners/did:bns:alice/sessions/a%20b',
    )
    expect(configKeyFromUrl('obj://config/users/alice/settings')).toBe('users/alice/settings')
    expect(canonicalJson({ b: 1, a: true })).toBe('{"a":true,"b":1}')
  })
})
