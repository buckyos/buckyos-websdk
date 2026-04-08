import { kRPCClient } from '../src/krpc_client'
import { AiccClient } from '../src/aicc_client'

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

describe('AiccClient', () => {
  it('complete forwards the request body and parses the response', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      task_id: 'task-001',
      status: 'succeeded',
      result: {
        text: 'mock',
        usage: { input_tokens: 4, output_tokens: 8, total_tokens: 12 },
        cost: { amount: 0.001, currency: 'USD' },
        finish_reason: 'stop',
      },
      event_ref: 'task://task-001/events',
    }, 5))

    const rpcClient = new kRPCClient('/kapi/aicc/', null, 5, { fetcher })
    const client = new AiccClient(rpcClient)

    const response = await client.complete({
      capability: 'llm_router',
      model: { alias: 'llm.plan.default' },
      requirements: { must_features: ['plan'], max_latency_ms: 3000 },
      payload: {
        text: 'write a release note',
        messages: [{ role: 'user', content: 'summarize this commit' }],
      },
      idempotency_key: 'idem-1',
    })

    expect(response.task_id).toBe('task-001')
    expect(response.status).toBe('succeeded')
    expect(response.result?.usage?.total_tokens).toBe(12)
    expect(response.event_ref).toBe('task://task-001/events')

    expect(fetcher).toHaveBeenCalledTimes(1)
    const sent = JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)
    expect(sent).toEqual({
      method: 'complete',
      params: {
        capability: 'llm_router',
        model: { alias: 'llm.plan.default' },
        requirements: { must_features: ['plan'], max_latency_ms: 3000 },
        payload: {
          text: 'write a release note',
          messages: [{ role: 'user', content: 'summarize this commit' }],
        },
        idempotency_key: 'idem-1',
      },
      sys: [5],
    })
  })

  it('cancel forwards task_id and parses cancel response', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      task_id: 'task-001',
      accepted: true,
    }, 9))

    const rpcClient = new kRPCClient('/kapi/aicc/', null, 9, { fetcher })
    const client = new AiccClient(rpcClient)

    await expect(client.cancel('task-001')).resolves.toEqual({
      task_id: 'task-001',
      accepted: true,
    })

    expect(JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      method: 'cancel',
      params: { task_id: 'task-001' },
      sys: [9],
    })
  })

  it('complete validates required model fields up front', async () => {
    const fetcher = jest.fn()
    const rpcClient = new kRPCClient('/kapi/aicc/', null, 1, { fetcher })
    const client = new AiccClient(rpcClient)

    await expect(
      client.complete({
        capability: 'llm_router',
        // @ts-expect-error model.alias missing
        model: {},
        requirements: {},
        payload: {},
      }),
    ).rejects.toThrow('AiccCompleteRequest.model.alias is required')

    expect(fetcher).not.toHaveBeenCalled()
  })

  it('cancel validates non-empty task_id', async () => {
    const fetcher = jest.fn()
    const rpcClient = new kRPCClient('/kapi/aicc/', null, 1, { fetcher })
    const client = new AiccClient(rpcClient)

    await expect(client.cancel('')).rejects.toThrow('non-empty task_id')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('throws when complete response is missing task_id', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({ status: 'running' }, 1))
    const rpcClient = new kRPCClient('/kapi/aicc/', null, 1, { fetcher })
    const client = new AiccClient(rpcClient)

    await expect(
      client.complete({
        capability: 'llm_router',
        model: { alias: 'm' },
        requirements: {},
        payload: {},
      }),
    ).rejects.toThrow('AiccCompleteResponse missing task_id')
  })
})
