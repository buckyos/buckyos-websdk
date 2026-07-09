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

async function captureError(promise: Promise<unknown>): Promise<BnsClientError> {
  return promise.then(
    () => {
      throw new Error('expected rejection')
    },
    (e) => e,
  )
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

const RESOLVE_RESULT = {
  name_state: NAME_STATE,
  document_state: {
    name: 'alice',
    doc_type: 'owner',
    version: 1,
    previous_version: 0,
    status: 'active',
    document: {
      storage_type: 'inline',
      uri: '',
      inline_document: [123, 125],
      content_hash: ZERO_HASH,
      schema: '',
      codec: 'json',
      extra_hash: ZERO_HASH,
    },
    controller: { kind: 'chain_account', value: NAME_STATE.asset_owner },
    beneficiary: { kind: 'unset', value: '' },
    payment_target: '',
    valid_from: 1,
    expire_at: 0,
    revoked_at: 0,
    controller_policy_hash: ZERO_HASH,
    payment_policy_hash: ZERO_HASH,
    split_policy_hash: ZERO_HASH,
    price_policy_hash: ZERO_HASH,
    rights_policy_hash: ZERO_HASH,
    document_state_hash: ZERO_HASH,
  },
  owner: {
    effective_owner: NAME_STATE.effective_owner,
    source: NAME_STATE.owner_source,
    authority_root: ZERO_HASH,
    authority_seq: 0,
  },
  effective_controller: { kind: 'chain_account', value: NAME_STATE.asset_owner },
  status: 'active',
  alias_kind: 'none',
  alias_target_did: '',
  proof_root: ZERO_HASH,
}

const EVENT_RECORD = {
  seq: 7,
  event_type: 'name_registered',
  observed_at: 1700000000,
  event_hash: ZERO_HASH,
  previous_log_root: ZERO_HASH,
  log_root: ZERO_HASH,
  event: {
    type: 'name_registered',
    data: { name: 'alice', asset_owner: NAME_STATE.asset_owner, expire_at: 2, lineage_epoch: 1, name_seq: 5 },
  },
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

  it('rejects a missing result field even for nullable reads', async () => {
    const fetcher = bnsFetcher(() => ({ ok: true }))
    const client = new BnsClient('http://bns.test', null, { fetcher })

    await expect(client.queryNameState('alice')).rejects.toMatchObject({
      kind: 'invalid_response',
      code: 'INVALID_RESPONSE',
    })
    await expect(client.latestCheckpoint()).rejects.toMatchObject({ kind: 'invalid_response' })
    await expect(client.resolveOwner('alice')).rejects.toMatchObject({ kind: 'invalid_response' })
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

  it('accepts error info with omitted optional fields', async () => {
    const fetcher = bnsFetcher(() => ({ ok: false, error: { code: 'NAME_NOT_FOUND', message: 'gone' } }))
    const client = new BnsClient('http://bns.test', null, { fetcher })

    const error = await captureError(client.resolveOwner('alice'))
    expect(error.kind).toBe('registry')
    expect(error.code).toBe('NAME_NOT_FOUND')
    expect(error.info).toEqual({
      code: 'NAME_NOT_FOUND',
      message: 'gone',
      name: null,
      doc_type: null,
      expected: null,
      actual: null,
    })
  })

  it('falls back to UNKNOWN_BNS_ERROR when the error is missing', async () => {
    const fetcher = bnsFetcher(() => ({ ok: false }))
    const client = new BnsClient('http://bns.test', null, { fetcher })

    const error = await captureError(client.resolveOwner('alice'))
    expect(error.kind).toBe('registry')
    expect(error.code).toBe('UNKNOWN_BNS_ERROR')
  })

  it('rejects malformed error info as INVALID_RESPONSE', async () => {
    const cases: unknown[] = [
      { ok: false, result: null, error: { code: 123, message: 'boom' } },
      { ok: false, result: null, error: { message: 'no code' } },
      { ok: false, result: null, error: 'boom' },
      { ok: false, result: null, error: { code: 'X', message: 'y', expected: -1 } },
    ]
    for (const envelope of cases) {
      const fetcher = bnsFetcher(() => envelope)
      const client = new BnsClient('http://bns.test', null, { fetcher })
      await expect(client.resolveOwner('alice')).rejects.toMatchObject({ kind: 'invalid_response' })
    }
  })

  it('rejects inconsistent ok/result/error combinations', async () => {
    const successWithError = bnsFetcher(() =>
      ({ ok: true, result: NAME_STATE, error: { code: 'X', message: 'y' } }))
    await expect(
      new BnsClient('http://bns.test', null, { fetcher: successWithError }).queryNameState('alice'),
    ).rejects.toMatchObject({ kind: 'invalid_response' })

    const failureWithResult = bnsFetcher(() =>
      ({ ok: false, result: NAME_STATE, error: { code: 'X', message: 'y' } }))
    await expect(
      new BnsClient('http://bns.test', null, { fetcher: failureWithResult }).queryNameState('alice'),
    ).rejects.toMatchObject({ kind: 'invalid_response' })
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
        return okEnvelope(RESOLVE_RESULT)
      }
      if (method === 'document.get_version') {
        return okEnvelope(null)
      }
      return okEnvelope([])
    })
    const client = new BnsClient('http://bns.test', null, { fetcher })

    await expect(client.resolveDocument('alice', 'owner')).resolves.toEqual(RESOLVE_RESULT)
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

  it('sends the configured trace id in the kRPC request sys', async () => {
    const fetcher = bnsFetcher(() => okEnvelope(null))
    const client = new BnsClient('http://bns.test', null, { fetcher })

    client.setTraceId('tr-bns-1')
    expect(client.getTraceId()).toBe('tr-bns-1')
    await client.queryNameState('alice')

    const sys = requestBody(fetcher, 0).sys
    expect(sys.length).toBe(3)
    expect(sys[1]).toBeNull()
    expect(sys[2]).toBe('tr-bns-1')
  })
})

describe('BnsClient result decoding', () => {
  it('rejects structurally invalid results', async () => {
    const missingField = { ...RESOLVE_RESULT.owner } as Record<string, unknown>
    delete missingField.authority_seq
    const fetcher = bnsFetcher(() => okEnvelope(missingField))
    const client = new BnsClient('http://bns.test', null, { fetcher })

    const error = await captureError(client.resolveOwner('alice'))
    expect(error.kind).toBe('invalid_response')
    expect(error.message).toContain('authority_seq')
  })

  it('rejects invalid field values that serde would refuse', async () => {
    const cases = [
      { ...NAME_STATE, expire_at: -1 },
      { ...NAME_STATE, registered_at: 1.5 },
      { ...NAME_STATE, status: 'weird' },
      { ...NAME_STATE, renewable: 'yes' },
      { ...NAME_STATE, semantic_owner: { kind: 'unset' } },
    ]
    for (const state of cases) {
      const fetcher = bnsFetcher(() => okEnvelope(state))
      const client = new BnsClient('http://bns.test', null, { fetcher })
      await expect(client.queryNameState('alice')).rejects.toMatchObject({ kind: 'invalid_response' })
    }
  })

  it('accepts u64 values beyond Number.MAX_SAFE_INTEGER (known lossy wire format)', async () => {
    const fetcher = bnsFetcher(() => okEnvelope({ ...NAME_STATE, expire_at: 18446744073709551615 }))
    const client = new BnsClient('http://bns.test', null, { fetcher })

    const state = await client.queryNameState('alice')
    expect(state?.expire_at).toBe(18446744073709551615)
  })

  it('defaults serde(default) fields when missing', async () => {
    const partial = { ...NAME_STATE } as Record<string, unknown>
    delete partial.min_document_iat
    delete partial.owner_policy_seq
    const fetcher = bnsFetcher(() => okEnvelope(partial))
    const client = new BnsClient('http://bns.test', null, { fetcher })

    const state = await client.queryNameState('alice')
    expect(state?.min_document_iat).toBe(0)
    expect(state?.owner_policy_seq).toBe(0)
  })

  it('decodes event log records including the owner_iat_floor_updated outer tag', async () => {
    const iatRecord = {
      ...EVENT_RECORD,
      seq: 8,
      // Outer tag intentionally differs from the inner serde tag; both are
      // valid on the wire.
      event_type: 'owner_iat_floor_updated',
      event: {
        type: 'owner_document_iat_floor_updated',
        data: {
          name: 'alice',
          previous_min_document_iat: 0,
          new_min_document_iat: 100,
          owner_policy_seq: 1,
          name_seq: 6,
          reason_hash: ZERO_HASH,
        },
      },
    }
    const fetcher = bnsFetcher(() => okEnvelope([EVENT_RECORD, iatRecord]))
    const client = new BnsClient('http://bns.test', null, { fetcher })

    await expect(client.listEvents(7, 10)).resolves.toEqual([EVENT_RECORD, iatRecord])
  })

  it('rejects unknown event types like serde', async () => {
    const fetcher = bnsFetcher(() =>
      okEnvelope([{ ...EVENT_RECORD, event: { type: 'mystery_event', data: {} } }]))
    const client = new BnsClient('http://bns.test', null, { fetcher })

    const error = await captureError(client.listEvents(0, 10))
    expect(error.kind).toBe('invalid_response')
    expect(error.message).toContain('mystery_event')
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

  it('waitTx rejects non-integer options before any RPC', async () => {
    const fetcher = bnsFetcher(() => okEnvelope(null))
    const client = new BnsClient('http://bns.test', null, { fetcher })

    const invalidOptions: Array<Record<string, number>> = [
      { confirmations: -1 },
      { confirmations: 1.5 },
      { confirmations: NaN },
      { confirmations: Infinity },
      { intervalMs: -10 },
      { intervalMs: 0.5 },
      { timeoutMs: -1 },
      { timeoutMs: NaN },
      { timeoutMs: -Infinity },
    ]
    for (const options of invalidOptions) {
      await expect(client.waitTx('0x1', options)).rejects.toMatchObject({
        kind: 'serialization',
        code: 'SERIALIZATION_ERROR',
      })
    }
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('waitTx clamps confirmations 0 to 1 like Rust wait_for_receipt', async () => {
    const states = [
      { tx_hash: '0x1', state: 'succeeded', block_number: 10, confirmations: 0 },
      { tx_hash: '0x1', state: 'succeeded', block_number: 10, confirmations: 1 },
    ]
    let index = 0
    const fetcher = bnsFetcher(() => okEnvelope(states[Math.min(index++, states.length - 1)]))
    const client = new BnsClient('http://bns.test', null, { fetcher })

    const finalState = await client.waitTx('0x1', { confirmations: 0, intervalMs: 1 })
    expect(finalState.confirmations).toBe(1)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('waitTx clamps timeoutMs 0 to 1ms instead of disabling the timeout', async () => {
    const fetcher = bnsFetcher(() =>
      okEnvelope({ tx_hash: '0x1', state: 'pending', block_number: null, confirmations: 0 }),
    )
    const client = new BnsClient('http://bns.test', null, { fetcher })

    await expect(client.waitTx('0x1', { intervalMs: 1, timeoutMs: 0 })).rejects.toMatchObject({
      kind: 'timeout',
      code: 'TX_WAIT_TIMEOUT',
    })
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
