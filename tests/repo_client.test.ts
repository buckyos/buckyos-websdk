import { kRPCClient } from '../src/krpc_client'
import { RepoClient, RepoProof } from '../src/repo_client'

function makeResponse(body: unknown, seq: number = 1) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      result: body,
      sys: [seq],
    }),
  }
}

function bodyOf(fetcher: jest.Mock, callIdx = 0) {
  return JSON.parse((fetcher.mock.calls[callIdx][1] as RequestInit).body as string)
}

describe('RepoClient', () => {
  it('store forwards content_id and parses ObjId string', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse('obj://abc', 1))
    const client = new RepoClient(new kRPCClient('/kapi/repo-service/', null, 1, { fetcher }))

    const objId = await client.store('content-1')

    expect(objId).toBe('obj://abc')
    expect(bodyOf(fetcher)).toEqual({
      method: 'store',
      params: { content_id: 'content-1' },
      sys: [1],
    })
  })

  it('collect forwards meta and optional referral_proof', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse('content-xyz', 2))
    const client = new RepoClient(new kRPCClient('/kapi/repo-service/', null, 2, { fetcher }))

    const id = await client.collect({ name: 'pkg' }, { signature: 'abc' })

    expect(id).toBe('content-xyz')
    expect(bodyOf(fetcher).params).toEqual({
      content_meta: { name: 'pkg' },
      referral_proof: { signature: 'abc' },
    })
  })

  it('collect omits referral_proof when not provided', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse('content-xyz', 3))
    const client = new RepoClient(new kRPCClient('/kapi/repo-service/', null, 3, { fetcher }))

    await client.collect({ name: 'pkg' })

    expect(bodyOf(fetcher).params).toEqual({ content_meta: { name: 'pkg' } })
  })

  it('pin / unpin / uncollect / announce return booleans', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(makeResponse(true, 1))
      .mockResolvedValueOnce(makeResponse(true, 2))
      .mockResolvedValueOnce(makeResponse(false, 3))
      .mockResolvedValueOnce(makeResponse(true, 4))
    const client = new RepoClient(new kRPCClient('/kapi/repo-service/', null, 1, { fetcher }))

    expect(await client.pin('cid', { sig: 'x' })).toBe(true)
    expect(await client.unpin('cid', true)).toBe(true)
    expect(await client.uncollect('cid')).toBe(false)
    expect(await client.announce('cid')).toBe(true)

    expect(bodyOf(fetcher, 0).params).toEqual({
      content_id: 'cid',
      download_proof: { sig: 'x' },
    })
    expect(bodyOf(fetcher, 1).params).toEqual({ content_id: 'cid', force: true })
    expect(bodyOf(fetcher, 2).params).toEqual({ content_id: 'cid', force: false })
    expect(bodyOf(fetcher, 3).params).toEqual({ content_id: 'cid' })
  })

  it('addProof serializes RepoProof tagged-enum kind/value shape', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse('proof-id-1', 5))
    const client = new RepoClient(new kRPCClient('/kapi/repo-service/', null, 5, { fetcher }))

    await client.addProof(RepoProof.action({ method: 'download', sig: 'abc' }))

    expect(bodyOf(fetcher)).toEqual({
      method: 'add_proof',
      params: {
        proof: {
          kind: 'Action',
          value: { method: 'download', sig: 'abc' },
        },
      },
      sys: [5],
    })
  })

  it('RepoProof.collection produces a Collection-tagged proof', () => {
    expect(RepoProof.collection({ root: 'r' })).toEqual({
      kind: 'Collection',
      value: { root: 'r' },
    })
  })

  it('getProofs forwards content_id with optional filter and parses RepoProof[]', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse([
      { kind: 'Action', value: { method: 'download' } },
      { kind: 'Collection', value: { root: 'r' } },
    ], 6))
    const client = new RepoClient(new kRPCClient('/kapi/repo-service/', null, 6, { fetcher }))

    const proofs = await client.getProofs('cid', { proof_type: 'download_proof' })

    expect(proofs).toHaveLength(2)
    expect(proofs[0].kind).toBe('Action')
    expect(proofs[1].kind).toBe('Collection')
    expect(bodyOf(fetcher).params).toEqual({
      content_id: 'cid',
      filter: { proof_type: 'download_proof' },
    })
  })

  it('getProofs throws on unknown proof kind', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse([{ kind: 'Bogus', value: {} }], 7))
    const client = new RepoClient(new kRPCClient('/kapi/repo-service/', null, 7, { fetcher }))

    await expect(client.getProofs('cid')).rejects.toThrow(
      'RepoProof[0] has unknown kind: Bogus',
    )
  })

  it('resolve returns string ObjId list', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse(['obj://a', 'obj://b'], 8))
    const client = new RepoClient(new kRPCClient('/kapi/repo-service/', null, 8, { fetcher }))

    const ids = await client.resolve('pkg-name')

    expect(ids).toEqual(['obj://a', 'obj://b'])
    expect(bodyOf(fetcher).params).toEqual({ content_name: 'pkg-name' })
  })

  it('list forwards filter and parses RepoRecord array', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse([{
      content_id: 'c1',
      content_name: 'pkg',
      status: 'pinned',
      origin: 'local',
      meta: { tag: 'v1' },
      access_policy: 'free',
      content_size: 1024,
      pinned_at: 1700,
    }], 9))
    const client = new RepoClient(new kRPCClient('/kapi/repo-service/', null, 9, { fetcher }))

    const records = await client.list({ status: 'pinned' })

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      content_id: 'c1',
      status: 'pinned',
      origin: 'local',
      access_policy: 'free',
      content_size: 1024,
      pinned_at: 1700,
    })
    expect(bodyOf(fetcher).params).toEqual({ filter: { status: 'pinned' } })
  })

  it('list omits filter when not provided', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse([], 10))
    const client = new RepoClient(new kRPCClient('/kapi/repo-service/', null, 10, { fetcher }))

    await client.list()

    expect(bodyOf(fetcher).params).toEqual({})
  })

  it('stat parses all numeric fields', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      total_objects: 10,
      collected_objects: 5,
      pinned_objects: 3,
      local_objects: 8,
      remote_objects: 2,
      total_content_bytes: 1234567,
      total_proofs: 7,
    }, 11))
    const client = new RepoClient(new kRPCClient('/kapi/repo-service/', null, 11, { fetcher }))

    const stat = await client.stat()

    expect(stat).toEqual({
      total_objects: 10,
      collected_objects: 5,
      pinned_objects: 3,
      local_objects: 8,
      remote_objects: 2,
      total_content_bytes: 1234567,
      total_proofs: 7,
    })
    expect(bodyOf(fetcher)).toEqual({
      method: 'stat',
      params: {},
      sys: [11],
    })
  })

  it('serve forwards request_context and parses an accepted result', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      status: 'ok',
      content_ref: { content_id: 'cid', access_url: 'https://x', metadata: { v: 1 } },
      download_proof: { sig: 'abc' },
    }, 12))
    const client = new RepoClient(new kRPCClient('/kapi/repo-service/', null, 12, { fetcher }))

    const result = await client.serve('cid', {
      requester_did: 'did:bns:user',
      receipt: { token: 't' },
    })

    expect(result.status).toBe('ok')
    expect(result.content_ref?.access_url).toBe('https://x')
    expect(result.download_proof).toEqual({ sig: 'abc' })
    expect(bodyOf(fetcher).params).toEqual({
      content_id: 'cid',
      request_context: {
        requester_did: 'did:bns:user',
        receipt: { token: 't' },
      },
    })
  })

  it('serve parses a rejected result', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      status: 'reject',
      reject_code: 'no_receipt',
      reject_reason: 'missing receipt',
    }, 13))
    const client = new RepoClient(new kRPCClient('/kapi/repo-service/', null, 13, { fetcher }))

    const result = await client.serve('cid', {})

    expect(result.status).toBe('reject')
    expect(result.reject_code).toBe('no_receipt')
    expect(result.reject_reason).toBe('missing receipt')
    expect(result.content_ref).toBeUndefined()
    expect(result.download_proof).toBeUndefined()
  })

  it('store throws on a non-string response', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({ unexpected: true }, 14))
    const client = new RepoClient(new kRPCClient('/kapi/repo-service/', null, 14, { fetcher }))

    await expect(client.store('cid')).rejects.toThrow('expected ObjId to be a string')
  })

  it('pin throws on a non-boolean response', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse('ok', 15))
    const client = new RepoClient(new kRPCClient('/kapi/repo-service/', null, 15, { fetcher }))

    await expect(client.pin('cid', {})).rejects.toThrow('expected pin response to be a boolean')
  })
})
