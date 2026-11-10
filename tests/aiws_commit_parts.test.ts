import { AiWorkspaceClient, commitOverLimit, commitWithParts, splitCommitOperations, AIWS_COMMIT_MAX_OPERATIONS } from '../src/aiworkspace_client'

type Call = { method: string; params: Record<string, unknown> }

function recorder(answer: (call: Call, calls: Call[]) => unknown) {
  const calls: Call[] = []
  const call = async (method: string, params: Record<string, unknown>) => {
    const entry = { method, params }
    calls.push(entry)
    return answer(entry, calls)
  }
  return { calls, call }
}

const op = (i: number, text = 'x'.repeat(80)) => ({ op: 'entity.create', entity_id: `e${i}`, text })
const request = (operations: unknown[]) => ({ protocol_version: '1.0', workspace_id: 'ws_1', epoch: 'ep', idempotency_key: 'k1', session_id: 's', operations })
const stageOk = (c: Call) => (c.method === 'doc.stage' ? { ok: true, part: c.params.part, digest: `d${c.params.part}` } : { status: 'accepted', commit_id: 'cm', seq: 1 })

describe('AI Workspace commit in parts', () => {
  it('sends a small request as one doc.commit, unchanged', async () => {
    const { calls, call } = recorder(stageOk)
    const req = request([op(0), op(1)])
    const result = await commitWithParts(call, req)
    expect(result).toEqual({ status: 'accepted', commit_id: 'cm', seq: 1 })
    expect(calls).toEqual([{ method: 'doc.commit', params: req }])
  })

  it('cuts by serialized bytes, in order, counting UTF-8', () => {
    const ops = Array.from({ length: 10 }, (_, i) => op(i))
    const size = JSON.stringify(op(0)).length
    const parts = splitCommitOperations(ops, 2 + 3 * (size + 1))
    expect(parts.map((p) => p.length)).toEqual([3, 3, 3, 1])
    expect(parts.flat()).toEqual(ops)
    // 汉 is 3 bytes: the same number of characters fills a part three times as fast
    const wide = Array.from({ length: 4 }, (_, i) => op(i, '汉'.repeat(80)))
    expect(splitCommitOperations(wide, 2 + 3 * (size + 1)).map((p) => p.length)).toEqual([1, 1, 1, 1])
    // an operation larger than a part travels alone
    expect(splitCommitOperations([op(0), op(1, 'y'.repeat(5000)), op(2)], 300).map((p) => p.length)).toEqual([1, 1, 1])
    expect(splitCommitOperations([], 100)).toEqual([[]])
  })

  it('stages the leading parts and names their digests in the final commit', async () => {
    const { calls, call } = recorder(stageOk)
    const ops = Array.from({ length: 7 }, (_, i) => op(i))
    const size = JSON.stringify(op(0)).length
    const seen: [number, number][] = []
    const result = await commitWithParts(call, request(ops), { partBytes: 2 + 3 * (size + 1), onPart: (part, total) => seen.push([part, total]) })
    expect((result as { status: string }).status).toBe('accepted')
    expect(calls.map((c) => c.method)).toEqual(['doc.stage', 'doc.stage', 'doc.commit'])
    expect(calls[0].params).toEqual({ workspace_id: 'ws_1', epoch: 'ep', idempotency_key: 'k1', part: 0, operations: ops.slice(0, 3) })
    expect(calls[1].params.operations).toEqual(ops.slice(3, 6))
    expect(calls[2].params).toEqual({ ...request(ops.slice(6)), staged: ['d0', 'd1'] })
    expect(seen).toEqual([[1, 3], [2, 3], [3, 3]])
  })

  it('stages everything once more when the parts are gone, and only once', async () => {
    let commits = 0
    const { calls, call } = recorder((c) => {
      if (c.method === 'doc.stage') return { ok: true, digest: `d${c.params.part}` }
      commits += 1
      return commits === 1 ? { status: 'rejected', code: 'SNAPSHOT_EXPIRED', sub_code: 'STAGED_PARTS_MISSING', retryable: true, errors: [] } : { status: 'accepted', commit_id: 'cm', seq: 2 }
    })
    const ops = Array.from({ length: 4 }, (_, i) => op(i))
    const size = JSON.stringify(op(0)).length
    const result = await commitWithParts(call, request(ops), { partBytes: 2 + 2 * (size + 1) })
    expect((result as { status: string }).status).toBe('accepted')
    expect(calls.map((c) => c.method)).toEqual(['doc.stage', 'doc.commit', 'doc.stage', 'doc.commit'])

    const always = recorder((c) => (c.method === 'doc.stage' ? { ok: true, digest: 'd' } : { status: 'rejected', code: 'SNAPSHOT_EXPIRED', sub_code: 'STAGED_PARTS_MISSING', retryable: true, errors: [] }))
    const refused = await commitWithParts(always.call, request(ops), { partBytes: 2 + 2 * (size + 1) })
    expect((refused as { sub_code: string }).sub_code).toBe('STAGED_PARTS_MISSING')
    expect(always.calls).toHaveLength(4)
  })

  it('turns a refused doc.stage into a rejected result and sends nothing after it', async () => {
    const { calls, call } = recorder(() => ({ ok: false, error: { code: 'QUOTA_EXCEEDED', retryable: true, detail: 'over quota' } }))
    const ops = Array.from({ length: 4 }, (_, i) => op(i))
    const result = await commitWithParts(call, request(ops), { partBytes: 150 }) as { status: string; code: string; errors: unknown[] }
    expect([result.status, result.code]).toEqual(['rejected', 'QUOTA_EXCEEDED'])
    expect(calls).toHaveLength(1)
  })

  it('goes through the client for commit and prepare', async () => {
    const { calls, call } = recorder(stageOk)
    const client = new AiWorkspaceClient({ call } as never)
    const ops = Array.from({ length: 4 }, (_, i) => op(i))
    await client.commit('ws_1', { epoch: 'ep', idempotency_key: 'k1', operations: ops }, { partBytes: 2 + 2 * (JSON.stringify(op(0)).length + 1) })
    expect(calls.map((c) => c.method)).toEqual(['doc.stage', 'doc.commit'])
    expect(calls[1].params.workspace_id).toBe('ws_1')
    calls.length = 0
    await client.prepare('ws_1', { epoch: 'ep', idempotency_key: 'k2', operations: [op(0)] })
    expect(calls.map((c) => c.method)).toEqual(['doc.prepare'])
  })

  it('tells which limit an import passes before anything is sent', () => {
    expect(commitOverLimit([op(0)])).toBeNull()
    expect(commitOverLimit(new Array(AIWS_COMMIT_MAX_OPERATIONS + 1).fill({}))).toMatchObject({ limit: 'operations' })
    const big = { t: 'x'.repeat(1024 * 1024) }
    expect(commitOverLimit(new Array(33).fill(big))).toMatchObject({ limit: 'bytes' })
  })
})
