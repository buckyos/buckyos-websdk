import {
  BnsClient,
  BnsClientError,
  BnsRpcErrorInfo,
  canonicalBnsName,
  canonicalDocType,
  didBnsFromName,
  nameFromDidBns,
  normalizeBnsIndexerUrl,
  normalizeBnsServerUrl,
  normalizeRawTx,
  ZERO_HASH,
} from '../src/bns_client'

function makeResponse(body: unknown, ok: boolean = true, status: number = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response
}

function okEnvelope(result: unknown) {
  return { ok: true, result, error: null }
}

function errEnvelope(code: string, message: string, context: Partial<BnsRpcErrorInfo> = {}) {
  return {
    ok: false,
    result: null,
    error: { code, message, name: null, doc_type: null, expected: null, actual: null, ...context },
  }
}

// Echoes the request seq back so the kRPC layer accepts the response, and
// routes the BNS envelope through `handler(method, params)`.
function bnsFetcher(handler: (method: string, params: any) => unknown) {
  return jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse((init as RequestInit).body as string)
    return makeResponse({ result: handler(body.method, body.params), sys: [body.sys[0]] })
  })
}

function requestBody(fetcher: jest.Mock, callIndex: number = 0) {
  return JSON.parse((fetcher.mock.calls[callIndex][1] as RequestInit).body as string)
}

const NAME_STATE = {
  name: 'alice',
  asset_owner: '0x0123456789abcdef0123456789abcdef01234567',
  semantic_owner: { kind: 'unset', value: '' },
  effective_owner: { kind: 'chain_account', value: '0x0123456789abcdef0123456789abcdef01234567' },
  owner_source: 'asset_owner_fallback',
  standard_transfer_enabled: true,
  status: 'active',
  registered_at: 1,
  expire_at: 2,
  grace_until: 3,
  updated_at: 4,
  name_seq: 5,
  owner_document_version: 1,
  min_document_iat: 0,
  owner_policy_seq: 0,
  lineage_epoch: 1,
  renewable: true,
  transferable: true,
  allow_delegated_subnames: false,
  namespace_policy_hash: ZERO_HASH,
  payment_policy_hash: ZERO_HASH,
  alias_state_hash: ZERO_HASH,
}

describe('BNS URL normalization', () => {
  it('appends the default path to bare hosts only', () => {
    expect(normalizeBnsServerUrl('https://bns.example.com')).toBe('https://bns.example.com/kapi/bns')
    expect(normalizeBnsServerUrl('http://127.0.0.1:18080/')).toBe('http://127.0.0.1:18080/kapi/bns')
    expect(normalizeBnsServerUrl('http://127.0.0.1:18080/custom/rpc/')).toBe('http://127.0.0.1:18080/custom/rpc')
    expect(normalizeBnsIndexerUrl('http://127.0.0.1:18080')).toBe('http://127.0.0.1:18080/kapi/bns-indexer')
    expect(normalizeBnsIndexerUrl('http://127.0.0.1:18080/kapi/bns')).toBe('http://127.0.0.1:18080/kapi/bns')
  })

  it('is applied by the constructor and forIndexer', async () => {
    const fetcher = bnsFetcher(() => okEnvelope(null))

    await new BnsClient('http://127.0.0.1:18080', null, { fetcher }).queryNameState('alice')
    expect(fetcher.mock.calls[0][0]).toBe('http://127.0.0.1:18080/kapi/bns')

    await BnsClient.forIndexer('http://127.0.0.1:18080', null, { fetcher }).queryNameState('alice')
    expect(fetcher.mock.calls[1][0]).toBe('http://127.0.0.1:18080/kapi/bns-indexer')
  })
})

describe('BnsClient reads', () => {
  it('unwraps the envelope and sends canonical method names', async () => {
    const fetcher = bnsFetcher((method, params) => {
      expect(method).toBe('name.query_state')
      expect(params).toEqual({ name: 'alice' })
      return okEnvelope(NAME_STATE)
    })
    const client = new BnsClient('http://bns.test', null, { fetcher })

    const state = await client.queryNameState('alice')
    expect(state).toEqual(NAME_STATE)
  })

  it('treats ok:true result:null as null for nullable reads', async () => {
    const fetcher = bnsFetcher(() => okEnvelope(null))
    const client = new BnsClient('http://bns.test', null, { fetcher })

    await expect(client.queryNameState('missing')).resolves.toBeNull()
    await expect(client.getAuthorityKey('alice', 'kid-1')).resolves.toBeNull()
    await expect(client.getDocumentVersion('alice', 'owner', 9)).resolves.toBeNull()
    await expect(client.latestCheckpoint()).resolves.toBeNull()
  })

  it('rejects a missing result for non-nullable reads', async () => {
    const fetcher = bnsFetcher(() => okEnvelope(null))
    const client = new BnsClient('http://bns.test', null, { fetcher })

    await expect(client.resolveOwner('alice')).rejects.toMatchObject({
      name: 'BnsClientError',
      kind: 'invalid_response',
      code: 'INVALID_RESPONSE',
    })
  })

  it('maps envelope errors to registry BnsClientError', async () => {
    const fetcher = bnsFetcher(() => errEnvelope('NAME_NOT_FOUND', 'name `alice` was not found', { name: 'alice' }))
    const client = new BnsClient('http://bns.test', null, { fetcher })

    const error: BnsClientError = await client.resolveOwner('alice').then(
      () => {
        throw new Error('expected rejection')
      },
      (e) => e,
    )
    expect(error).toBeInstanceOf(BnsClientError)
    expect(error.kind).toBe('registry')
    expect(error.code).toBe('NAME_NOT_FOUND')
    expect(error.isRegistryCode('NAME_NOT_FOUND')).toBe(true)
    expect(error.info?.name).toBe('alice')
  })

  it('maps kRPC-level failures to transport errors', async () => {
    const fetcher = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse((init as RequestInit).body as string)
      return makeResponse({ error: 'unknown method: name.query_state', sys: [body.sys[0]] })
    })
    const client = new BnsClient('http://bns.test', null, { fetcher })

    await expect(client.queryNameState('alice')).rejects.toMatchObject({
      kind: 'transport',
      code: 'RPC_TRANSPORT_ERROR',
    })
  })

  it('rejects malformed envelopes', async () => {
    const fetcher = bnsFetcher(() => ({ unexpected: true }))
    const client = new BnsClient('http://bns.test', null, { fetcher })

    await expect(client.queryNameState('alice')).rejects.toMatchObject({ kind: 'invalid_response' })
  })

  it('serializes document and event query params in snake_case', async () => {
    const fetcher = bnsFetcher((method) => {
      if (method === 'document.resolve') {
        return okEnvelope({ dummy: true })
      }
      if (method === 'document.get_version') {
        return okEnvelope(null)
      }
      return okEnvelope([])
    })
    const client = new BnsClient('http://bns.test', null, { fetcher })

    await client.resolveDocument('alice', 'owner')
    await client.getDocumentVersion('alice', 'owner', 2)
    await client.listEvents(100, 50)

    expect(requestBody(fetcher, 0)).toMatchObject({
      method: 'document.resolve',
      params: { name: 'alice', doc_type: 'owner' },
    })
    expect(requestBody(fetcher, 1)).toMatchObject({
      method: 'document.get_version',
      params: { name: 'alice', doc_type: 'owner', version: 2 },
    })
    expect(requestBody(fetcher, 2)).toMatchObject({
      method: 'events.list',
      params: { from_seq: 100, limit: 50 },
    })
  })
})

describe('BnsClient address pagination', () => {
  it('sends address/cursor/limit and follows next_cursor in iterNamesByAddress', async () => {
    const pages: Record<string, { names: string[]; next_cursor: string | null }> = {
      '': { names: ['alice', 'bob'], next_cursor: 'bob' },
      bob: { names: ['carol'], next_cursor: null },
    }
    const fetcher = bnsFetcher((method, params) => {
      expect(method).toBe('name.query_by_addr')
      return okEnvelope(pages[params.cursor ?? ''])
    })
    const client = new BnsClient('http://bns.test', null, { fetcher })

    const names: string[] = []
    for await (const name of client.iterNamesByAddress('0x0123456789abcdef0123456789abcdef01234567', 2)) {
      names.push(name)
    }

    expect(names).toEqual(['alice', 'bob', 'carol'])
    expect(requestBody(fetcher, 0).params).toEqual({
      address: '0x0123456789abcdef0123456789abcdef01234567',
      cursor: null,
      limit: 2,
    })
    expect(requestBody(fetcher, 1).params).toMatchObject({ cursor: 'bob' })
  })
})

describe('BnsClient tx methods', () => {
  it('normalizes raw TX input before submitting', async () => {
    const fetcher = bnsFetcher((method, params) => {
      expect(method).toBe('tx.submit_raw')
      expect(params).toEqual({ raw_tx: '0x02f901' })
      return okEnvelope({ tx_hash: '0xabc' })
    })
    const client = new BnsClient('http://bns.test', null, { fetcher })

    await expect(client.submitRawTx(new Uint8Array([0x02, 0xf9, 0x01]))).resolves.toEqual({ tx_hash: '0xabc' })

    expect(normalizeRawTx('02f901')).toBe('0x02f901')
    expect(normalizeRawTx(' 0x02f901 ')).toBe('0x02f901')
  })

  it('rejects invalid raw TX hex locally', async () => {
    const fetcher = bnsFetcher(() => okEnvelope({ tx_hash: '0xabc' }))
    const client = new BnsClient('http://bns.test', null, { fetcher })

    await expect(client.submitRawTx('')).rejects.toMatchObject({ kind: 'serialization' })
    await expect(client.submitRawTx('0x123')).rejects.toMatchObject({ kind: 'serialization' })
    await expect(client.submitRawTx('0xzz')).rejects.toMatchObject({ kind: 'serialization' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('waitTx polls until enough confirmations', async () => {
    const states = [
      { tx_hash: '0x1', state: 'pending', block_number: null, confirmations: 0 },
      { tx_hash: '0x1', state: 'succeeded', block_number: 10, confirmations: 1 },
      { tx_hash: '0x1', state: 'succeeded', block_number: 10, confirmations: 2 },
    ]
    let index = 0
    const fetcher = bnsFetcher((method, params) => {
      expect(method).toBe('tx.query_state')
      expect(params).toEqual({ tx_hash: '0x1' })
      return okEnvelope(states[Math.min(index++, states.length - 1)])
    })
    const client = new BnsClient('http://bns.test', null, { fetcher })

    const finalState = await client.waitTx('0x1', { confirmations: 2, intervalMs: 1 })
    expect(finalState.confirmations).toBe(2)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('waitTx returns reverted state immediately and times out on pending', async () => {
    const revertedFetcher = bnsFetcher(() =>
      okEnvelope({ tx_hash: '0x1', state: 'reverted', block_number: 10, confirmations: 1 }),
    )
    const reverted = await new BnsClient('http://bns.test', null, { fetcher: revertedFetcher }).waitTx('0x1', {
      intervalMs: 1,
    })
    expect(reverted.state).toBe('reverted')
    expect(revertedFetcher).toHaveBeenCalledTimes(1)

    const pendingFetcher = bnsFetcher(() =>
      okEnvelope({ tx_hash: '0x1', state: 'pending', block_number: null, confirmations: 0 }),
    )
    await expect(
      new BnsClient('http://bns.test', null, { fetcher: pendingFetcher }).waitTx('0x1', {
        intervalMs: 1,
        timeoutMs: 10,
      }),
    ).rejects.toMatchObject({ kind: 'timeout', code: 'TX_WAIT_TIMEOUT' })
  })
})

describe('canonical helpers', () => {
  it('accepts canonical names and doc types', () => {
    expect(canonicalBnsName('alice')).toBe('alice')
    expect(canonicalBnsName('bob.example')).toBe('bob.example')
    expect(canonicalDocType('owner')).toBe('owner')
    expect(canonicalDocType('zone_config-v1')).toBe('zone_config-v1')
  })

  it('rejects invalid names with INVALID_NAME registry errors', () => {
    const cases = ['', ' alice', 'did:bns:alice', 'Alice', 'a..b', '-alice', 'alice-', 'a'.repeat(254)]
    for (const name of cases) {
      let thrown: unknown = null
      try {
        canonicalBnsName(name)
      } catch (e) {
        thrown = e
      }
      expect(thrown).toBeInstanceOf(BnsClientError)
      expect((thrown as BnsClientError).isRegistryCode('INVALID_NAME')).toBe(true)
    }
  })

  it('rejects invalid doc types with INVALID_DOC_TYPE registry errors', () => {
    for (const docType of ['', 'Owner', 'a'.repeat(33), 'a.b']) {
      let thrown: unknown = null
      try {
        canonicalDocType(docType)
      } catch (e) {
        thrown = e
      }
      expect(thrown).toBeInstanceOf(BnsClientError)
      expect((thrown as BnsClientError).isRegistryCode('INVALID_DOC_TYPE')).toBe(true)
    }
  })

  it('converts between names and did:bns DIDs', () => {
    expect(didBnsFromName('alice')).toBe('did:bns:alice')
    expect(nameFromDidBns('did:bns:alice')).toBe('alice')
    expect(() => nameFromDidBns('did:web:alice')).toThrow(BnsClientError)
  })
})
