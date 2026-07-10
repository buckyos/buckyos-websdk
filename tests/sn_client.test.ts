import {
  generateSnDeviceToken,
  normalizeSnUrl,
  SnClient,
  SnClientError,
  SN_AUTH_PATH,
  SN_BNS_PROXY_PATH,
  SN_DEVICEINFO_PATH,
  SN_DEVICE_TOKEN_AUD,
  SN_ERROR_CODES,
} from '../src/sn_client'
import { decodeJwtHeaderWithoutVerify, generateEd25519KeyPair, verifyJwtEdDSA } from '../src/namelib'

function makeResponse(body: unknown, ok: boolean = true, status: number = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response
}

// Echoes the request seq back so the kRPC layer accepts the response, and
// routes the SN payload through `handler(method, params, url)`. Unlike BNS
// there is no business envelope: the handler return value IS the kRPC result.
function snFetcher(handler: (method: string, params: any, url: string) => unknown) {
  return jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse((init as RequestInit).body as string)
    return makeResponse({ result: handler(body.method, body.params, String(url)), sys: [body.sys[0]] })
  })
}

// Rejects every call with a kRPC error string (RPCResult::Failed).
function snErrorFetcher(error: string) {
  return jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse((init as RequestInit).body as string)
    return makeResponse({ error, sys: [body.sys[0]] })
  })
}

function requestBody(fetcher: jest.Mock, callIndex: number = 0) {
  return JSON.parse((fetcher.mock.calls[callIndex][1] as RequestInit).body as string)
}

async function captureError(promise: Promise<unknown>): Promise<SnClientError> {
  const error = await promise.then(
    () => {
      throw new Error('expected rejection')
    },
    (e) => e,
  )
  expect(error).toBeInstanceOf(SnClientError)
  return error as SnClientError
}

describe('SN URL normalization', () => {
  it('routes every known base to the requested target (mirrors the Rust test)', () => {
    const knownBases = [
      'https://sn.example',
      'https://sn.example/kapi/sn',
      'https://sn.example/kapi/sn/',
      'https://sn.example/kapi/sn/auth',
      'https://sn.example/kapi/sn/deviceinfo',
      'https://sn.example/kapi/sn/bns-proxy',
      'https://sn.example/kapi/sn/bns',
    ]

    for (const base of knownBases) {
      expect(normalizeSnUrl(base, 'auth')).toBe('https://sn.example/kapi/sn/auth')
      expect(normalizeSnUrl(base, 'deviceinfo')).toBe('https://sn.example/kapi/sn/deviceinfo')
      expect(normalizeSnUrl(base, 'bns-proxy')).toBe('https://sn.example/kapi/sn/bns-proxy')
    }
  })

  it('keeps unknown prefixes and appends the target path', () => {
    expect(normalizeSnUrl('https://sn.example/prefix', 'auth')).toBe('https://sn.example/prefix/kapi/sn/auth')
    expect(normalizeSnUrl('https://sn.example/prefix/kapi/sn/bns-proxy', 'deviceinfo')).toBe(
      'https://sn.example/prefix/kapi/sn/deviceinfo',
    )
  })
})

describe('SnClient path routing', () => {
  it('sends each method group to its required path', async () => {
    const urls: string[] = []
    const fetcher = snFetcher((_method, _params, url) => {
      urls.push(url)
      return { code: 0 }
    })
    const client = new SnClient('https://sn.example/kapi/sn', null, { fetcher })

    await client.checkUsername('alice')
    await client.getDeviceOnline({ device_name: 'ood1' })
    await client.publishDnsTxt({ name: 'alice', mode: 'add', value: 'pkx=abc' })

    expect(urls).toEqual([
      `https://sn.example${SN_AUTH_PATH}`,
      `https://sn.example${SN_DEVICEINFO_PATH}`,
      `https://sn.example${SN_BNS_PROXY_PATH}`,
    ])
  })

  it('sends the session token to every channel after syncSessionToken', async () => {
    const fetcher = snFetcher(() => ({ code: 0 }))
    const client = new SnClient('https://sn.example', null, { fetcher })
    client.syncSessionToken('token-1')

    await client.me()
    await client.listDevicesOnline()
    await client.publishDocument({ name: 'alice', doc_type: 'zone', document: { gateway: 'ood1' } })

    for (let call = 0; call < 3; call++) {
      const sys = requestBody(fetcher, call).sys
      expect(sys[1]).toBe('token-1')
    }
    expect(client.getSessionToken()).toBe('token-1')
  })
})

describe('SnClient auth serialization', () => {
  it('register serializes initial documents like the Rust client', async () => {
    const fetcher = snFetcher((method) => {
      expect(method).toBe('auth.register')
      return { code: 0, access_token: 'a', refresh_token: 'r', need_bind_owner_key: false }
    })
    const client = new SnClient('https://sn.example', null, { fetcher })

    await client.register({
      name: 'alice',
      email: 'alice@example.com',
      pwd_hash: 'hash',
      active_code: 'code',
      request_id: 'sn:register:alice',
      asset_owner: '0x0000000000000000000000000000000000000001',
      owner_config: { display_name: 'Alice' },
      initial_documents: {
        zone: { gateway: 'ood1' },
        dns_txt: [{ ttl: 600, value: 'pkx=alice' }],
      },
    })

    // Same wire fixture as the Rust register_request_serializes_initial_documents test.
    expect(requestBody(fetcher).params).toEqual({
      name: 'alice',
      email: 'alice@example.com',
      pwd_hash: 'hash',
      active_code: 'code',
      request_id: 'sn:register:alice',
      asset_owner: '0x0000000000000000000000000000000000000001',
      owner_config: { display_name: 'Alice' },
      initial_documents: {
        zone: { gateway: 'ood1' },
        dns_txt: [{ ttl: 600, value: 'pkx=alice' }],
      },
    })
  })

  it('register drops unknown initial_documents keys (server is deny_unknown_fields)', async () => {
    const fetcher = snFetcher(() => ({ code: 0, access_token: 'a', refresh_token: 'r', need_bind_owner_key: true }))
    const client = new SnClient('https://sn.example', null, { fetcher })

    await client.register({
      name: 'alice',
      email: 'alice@example.com',
      pwd_hash: 'hash',
      active_code: 'code',
      initial_documents: {
        boot: { sn: 'sn.example' },
        extra: { nope: true },
      } as never,
    })

    expect(requestBody(fetcher).params).toEqual({
      name: 'alice',
      email: 'alice@example.com',
      pwd_hash: 'hash',
      active_code: 'code',
      initial_documents: { boot: { sn: 'sn.example' } },
    })
  })

  it('login/refresh/logout use the documented params', async () => {
    const fetcher = snFetcher(() => ({ code: 0, access_token: 'a', refresh_token: 'r', need_bind_owner_key: false }))
    const client = new SnClient('https://sn.example', null, { fetcher })

    await client.login('Alice', 'pwd-hash')
    await client.refresh('refresh-1')
    await client.logout()

    expect(requestBody(fetcher, 0)).toMatchObject({
      method: 'auth.login',
      params: { name: 'Alice', pwd_hash: 'pwd-hash' },
    })
    expect(requestBody(fetcher, 1)).toMatchObject({
      method: 'auth.refresh',
      params: { refresh_token: 'refresh-1' },
    })
    expect(requestBody(fetcher, 2)).toMatchObject({
      method: 'auth.logout',
      params: { refresh_token: null },
    })
  })
})

describe('SnClient device serialization', () => {
  it('device.list serializes documented values like the Rust client', async () => {
    const fetcher = snFetcher((method) => {
      expect(method).toBe('device.list')
      return { code: 0, items: [] }
    })
    const client = new SnClient('https://sn.example', null, { fetcher })

    await client.listDevicesOnline({ state: 'stale', offset: 10, limit: 20 })
    expect(requestBody(fetcher).params).toEqual({ state: 'stale', offset: 10, limit: 20 })

    await client.listDevicesOnline()
    expect(requestBody(fetcher, 1).params).toEqual({})
  })

  it('device online reports omit absent optional fields', async () => {
    const fetcher = snFetcher(() => ({ code: 0 }))
    const client = new SnClient('https://sn.example', null, { fetcher })

    await client.updateDeviceOnline({
      device_name: 'ood1',
      device_ip: '203.0.113.10',
      device_info: { hostname: 'ood1' },
    })
    expect(requestBody(fetcher).params).toEqual({
      device_name: 'ood1',
      device_ip: '203.0.113.10',
      device_info: { hostname: 'ood1' },
    })

    await client.registerDeviceOnline({
      device_name: 'ood1',
      device_did: 'did:dev:abc',
      device_ip: '203.0.113.10',
      device_info: { hostname: 'ood1' },
      endpoints: [
        {
          endpoint_id: 'rtcp-public-1',
          protocol: 'rtcp',
          host: '203.0.113.10',
          port: 8080,
          scope: 'public',
          priority: 100,
          source: 'device_report',
        },
      ],
      ttl: 300,
    })
    expect(requestBody(fetcher, 1)).toMatchObject({
      method: 'device.register',
      params: {
        device_did: 'did:dev:abc',
        endpoints: [{ endpoint_id: 'rtcp-public-1', protocol: 'rtcp', port: 8080 }],
        ttl: 300,
      },
    })
  })

  it('resolve_ood queries are anonymous single-field requests', async () => {
    const fetcher = snFetcher((method) => {
      expect(method.startsWith('deviceinfo.resolve_ood_by_')).toBe(true)
      return { did_hostname: 'ood1.alice', owner_id: 'alice', self_cert: false, state: 'active' }
    })
    const client = new SnClient('https://sn.example', null, { fetcher })

    const byDid = await client.resolveOodByDid('did:dev:abc')
    expect(byDid.state).toBe('active')
    expect(requestBody(fetcher, 0).params).toEqual({ source_device_id: 'did:dev:abc' })

    await client.resolveOodByHostname('ood1.alice.web3.sn.example')
    expect(requestBody(fetcher, 1).params).toEqual({ dest_host: 'ood1.alice.web3.sn.example' })
  })
})

describe('SnClient bns-proxy requests', () => {
  it('publish_dns_txt sends only the fields relevant to the mode', async () => {
    const fetcher = snFetcher((method) => {
      expect(method).toBe('bns.publish_dns_txt')
      return { code: 0, request_id: 'x', operation: 'publish_dns_txt', name: 'alice', status: 'submitted', reused: false }
    })
    const client = new SnClient('https://sn.example', null, { fetcher })

    await client.publishDnsTxt({ name: 'alice', mode: 'add', value: 'pkx=abc', ttl: 300 })
    expect(requestBody(fetcher, 0).params).toEqual({ name: 'alice', mode: 'add', value: 'pkx=abc', ttl: 300 })

    // ttl/records are irrelevant to mode=remove and must stay unsent.
    await client.publishDnsTxt({ name: 'alice', mode: 'remove', value: 'pkx=abc', ttl: 300, records: [] })
    expect(requestBody(fetcher, 1).params).toEqual({ name: 'alice', mode: 'remove', value: 'pkx=abc' })

    // Same wire fixture as the Rust bns_and_device_requests_serialize_documented_values test.
    await client.publishDnsTxt({ name: 'alice', mode: 'replace', records: [{ ttl: 300, value: 'hello' }] })
    expect(requestBody(fetcher, 2).params).toEqual({
      name: 'alice',
      mode: 'replace',
      records: [{ ttl: 300, value: 'hello' }],
    })

    await client.publishDnsTxt({ name: 'alice', mode: 'replace', records: [{ value: 'no-ttl' }], request_id: 'req-1' })
    expect(requestBody(fetcher, 3).params).toEqual({
      name: 'alice',
      mode: 'replace',
      request_id: 'req-1',
      records: [{ value: 'no-ttl' }],
    })
  })

  it('rejects invalid publish_dns_txt combinations locally', async () => {
    const fetcher = snFetcher(() => ({ code: 0 }))
    const client = new SnClient('https://sn.example', null, { fetcher })

    await expect(client.publishDnsTxt({ name: 'alice', mode: 'add' })).rejects.toMatchObject({
      name: 'SnClientError',
      kind: 'validation',
    })
    await expect(client.publishDnsTxt({ name: 'alice', mode: 'remove' })).rejects.toMatchObject({
      kind: 'validation',
    })
    await expect(client.publishDnsTxt({ name: 'alice', mode: 'replace' })).rejects.toMatchObject({
      kind: 'validation',
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects non-object publish_document documents locally', async () => {
    const fetcher = snFetcher(() => ({ code: 0 }))
    const client = new SnClient('https://sn.example', null, { fetcher })

    await expect(
      client.publishDocument({ name: 'alice', doc_type: 'zone', document: [1, 2] as never }),
    ).rejects.toMatchObject({ kind: 'validation' })
    expect(fetcher).not.toHaveBeenCalled()

    await client.publishDocument({ name: 'alice', doc_type: 'zone', document: { gateway: 'ood1' } })
    expect(requestBody(fetcher).params).toEqual({
      name: 'alice',
      doc_type: 'zone',
      document: { gateway: 'ood1' },
    })
  })
})

describe('SN error mapping', () => {
  it('exposes the registration email error codes', () => {
    expect(SN_ERROR_CODES.invalid_email).toBe(1028)
    expect(SN_ERROR_CODES.email_already_bound).toBe(1029)
  })

  it('parses [SN:code:name] tagged business errors', async () => {
    const fetcher = snErrorFetcher('Parse Request Error: [SN:1002:username_already_exists] username alice already exists')
    const client = new SnClient('https://sn.example', null, { fetcher })

    const error = await captureError(client.checkUsername('alice'))
    expect(error.kind).toBe('sn')
    expect(error.code).toBe(SN_ERROR_CODES.username_already_exists)
    expect(error.codeName).toBe('username_already_exists')
    expect(error.isSnError('username_already_exists')).toBe(true)
    expect(error.detail).toBe('username alice already exists')
    expect(error.message).toContain('auth.check_username failed:')
  })

  it('exposes the domain_proof_failed JSON detail', async () => {
    const proof = {
      domain: 'home.alice.example.com',
      pkx_record_name: '_pkx.home.alice.example.com',
      pkx: 'PKX(abc)',
      retryable: true,
      reason: 'expected PKX TXT record not found',
    }
    const fetcher = snErrorFetcher(`Parse Request Error: [SN:1016:domain_proof_failed] ${JSON.stringify(proof)}`)
    const client = new SnClient('https://sn.example', null, { fetcher })

    const error = await captureError(client.bindDomain('home.alice.example.com'))
    expect(error.code).toBe(1016)
    expect(error.domainProofInfo()).toEqual(proof)
    expect(error.bnsWriteInfo()).toBeNull()
  })

  it('exposes the bns write failure JSON detail', async () => {
    const info = { bns_code: 'NAME_ALREADY_EXISTS', expected: null, actual: null, message: 'name `alice` already exists' }
    const fetcher = snErrorFetcher(`Failed due to reason: [SN:1024:bns_name_already_exists] ${JSON.stringify(info)}`)
    const client = new SnClient('https://sn.example', null, { fetcher })

    const error = await captureError(
      client.publishDocument({ name: 'alice', doc_type: 'zone', document: {} }),
    )
    expect(error.isSnError('bns_name_already_exists')).toBe(true)
    expect(error.bnsWriteInfo()).toEqual(info)
    expect(error.domainProofInfo()).toBeNull()
  })

  it('maps untagged kRPC failures to transport errors', async () => {
    const fetcher = snErrorFetcher('Unknown method: auth.check_username')
    const client = new SnClient('https://sn.example', null, { fetcher })

    const error = await captureError(client.checkUsername('alice'))
    expect(error.kind).toBe('transport')
    expect(error.code).toBeNull()
    expect(error.codeName).toBeNull()
  })
})

describe('generateSnDeviceToken', () => {
  it('signs sub/iss/aud/exp claims with the device key', async () => {
    const { privateKeyPem, publicKeyJwk } = await generateEd25519KeyPair()
    const before = Math.floor(Date.now() / 1000)
    const token = await generateSnDeviceToken('did:dev:device-x', 'did:bns:ood1.alice', privateKeyPem)

    expect(decodeJwtHeaderWithoutVerify(token)).toEqual({ alg: 'EdDSA' })
    const claims = await verifyJwtEdDSA(token, publicKeyJwk)
    expect(claims.sub).toBe('did:dev:device-x')
    expect(claims.iss).toBe('did:bns:ood1.alice')
    expect(claims.aud).toBe(SN_DEVICE_TOKEN_AUD)
    expect(claims.exp).toBeGreaterThanOrEqual(before + 600)
    expect(claims.exp).toBeLessThanOrEqual(before + 602)

    const shortLived = await generateSnDeviceToken('did:dev:device-x', 'did:bns:ood1.alice', privateKeyPem, 60)
    const shortClaims = await verifyJwtEdDSA(shortLived, publicKeyJwk)
    expect(shortClaims.exp).toBeLessThanOrEqual(before + 62)
  })
})
