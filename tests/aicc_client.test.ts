import { kRPCClient } from '../src/krpc_client'
import { AICC_AI_METHODS, AiccClient } from '../src/aicc_client'

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
  it('llmChat builds a typed llm.chat request', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      task_id: 'task-chat',
      status: 'succeeded',
      result: {
        text: 'hello',
        extra: {
          route_trace: {
            attempts: [],
            final_model: 'llm.plan.default@mock',
          },
        },
      },
    }, 2))

    const rpcClient = new kRPCClient('/kapi/aicc/', null, 2, { fetcher })
    const client = new AiccClient(rpcClient)

    const response = await client.llmChat({
      model: 'llm.plan.default',
      input: {
        messages: [{ role: 'user', content: 'hello' }],
        tools: [
          {
            type: 'function',
            name: 'get_weather',
            description: 'Get weather by city.',
            args_json_schema: {
              type: 'object',
              properties: { city: { type: 'string' } },
              required: ['city'],
            },
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'answer',
            schema: {
              type: 'object',
              properties: { summary: { type: 'string' } },
              required: ['summary'],
            },
          },
        },
      },
      requirements: { must_features: ['tool_calling', 'json_output'] },
    })

    expect(response.result?.extra?.route_trace?.final_model).toBe('llm.plan.default@mock')
    expect(JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      method: 'llm.chat',
      params: {
        capability: 'llm',
        model: { alias: 'llm.plan.default' },
        requirements: { must_features: ['tool_calling', 'json_output'] },
        payload: {
          input_json: {
            messages: [{ role: 'user', content: 'hello' }],
            tools: [
              {
                type: 'function',
                name: 'get_weather',
                description: 'Get weather by city.',
                args_json_schema: {
                  type: 'object',
                  properties: { city: { type: 'string' } },
                  required: ['city'],
                },
              },
            ],
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: 'answer',
                schema: {
                  type: 'object',
                  properties: { summary: { type: 'string' } },
                  required: ['summary'],
                },
              },
            },
          },
          resources: [],
          options: {},
        },
      },
      sys: [2],
    })
  })

  it('typed convenience methods constrain required input fields', async () => {
    const fetcher = jest.fn()
    const rpcClient = new kRPCClient('/kapi/aicc/', null, 1, { fetcher })
    const client = new AiccClient(rpcClient)

    if (false) {
      client.llmChat({
        model: 'llm.plan.default',
        // @ts-expect-error llm.chat requires input.messages
        input: {},
      })

      client.imageTxt2img({
        model: 'image.txt2img.default',
        // @ts-expect-error image.txt2img requires input.prompt
        input: { n: 1 },
      })

      client.audioAsr({
        model: 'audio.asr.default',
        // @ts-expect-error audio.asr requires input.audio
        input: { language: 'zh-CN' },
      })
    }

    expect(fetcher).not.toHaveBeenCalled()
  })

  it('callMethod forwards the AI method and canonical payload shape', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      task_id: 'task-001',
      status: 'succeeded',
      result: {
        text: 'mock',
        usage: {
          tokens: { input: 4, output: 8, total: 12 },
          request_units: 1,
        },
        cost: { amount: 0.001, currency: 'USD' },
        finish_reason: 'stop',
      },
      event_ref: 'task://task-001/events',
    }, 5))

    const rpcClient = new kRPCClient('/kapi/aicc/', null, 5, { fetcher })
    const client = new AiccClient(rpcClient)

    const response = await client.callMethod(AICC_AI_METHODS.LLM_CHAT, {
      capability: 'llm',
      model: { alias: 'llm.plan.default' },
      requirements: {
        must_features: ['plan'],
        max_latency_ms: 3000,
        resp_format: 'json',
      },
      payload: {
        input_json: {
          messages: [{ role: 'user', content: 'summarize this commit' }],
          temperature: 0.3,
        },
        resources: [
          { kind: 'url', url: 'cyfs://example/object/1', mime_hint: 'text/plain' },
          { kind: 'named_object', obj_id: 'chunk:123456' },
        ],
      },
      policy: {
        profile: 'balanced',
        allow_fallback: true,
        runtime_failover: true,
        explain: false,
      },
      idempotency_key: 'idem-1',
    })

    expect(response.task_id).toBe('task-001')
    expect(response.status).toBe('succeeded')
    expect(response.result?.usage?.tokens?.total).toBe(12)
    expect(response.event_ref).toBe('task://task-001/events')

    expect(fetcher).toHaveBeenCalledTimes(1)
    const sent = JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)
    expect(sent).toEqual({
      method: 'llm.chat',
      params: {
        capability: 'llm',
        model: { alias: 'llm.plan.default' },
        requirements: {
          must_features: ['plan'],
          max_latency_ms: 3000,
          resp_format: 'json',
        },
        payload: {
          input_json: {
            messages: [{ role: 'user', content: 'summarize this commit' }],
            temperature: 0.3,
          },
          resources: [
            { kind: 'url', url: 'cyfs://example/object/1', mime_hint: 'text/plain' },
            { kind: 'named_object', obj_id: 'chunk:123456' },
          ],
          options: {},
        },
        policy: {
          profile: 'balanced',
          allow_fallback: true,
          runtime_failover: true,
          explain: false,
        },
        idempotency_key: 'idem-1',
      },
      sys: [5],
    })
  })

  it('fills default payload protocol fields', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      task_id: 'task-002',
      status: 'running',
      result: null,
      event_ref: 'task://task-002/events',
    }, 3))

    const rpcClient = new kRPCClient('/kapi/aicc/', null, 3, { fetcher })
    const client = new AiccClient(rpcClient)

    await client.callMethod(AICC_AI_METHODS.IMAGE_TXT2IMG, {
      capability: 'image',
      model: { alias: 'image.txt2img.default' },
      requirements: {},
      payload: {},
    })

    const sent = JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)
    expect(sent.params.payload).toEqual({
      input_json: {},
      resources: [],
      options: {},
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

  it('queryQuota uses the quota.query control method', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      quota: {
        state: 'normal',
        remaining_request_units: 1000,
        remaining_cost_usd: 12.5,
        reset_at: '2026-04-26T00:00:00Z',
      },
    }, 11))

    const rpcClient = new kRPCClient('/kapi/aicc/', null, 11, { fetcher })
    const client = new AiccClient(rpcClient)

    await expect(client.queryQuota({ capability: 'audio', method: 'audio.asr' })).resolves.toEqual({
      quota: {
        state: 'normal',
        remaining_request_units: 1000,
        remaining_cost_usd: 12.5,
        reset_at: '2026-04-26T00:00:00Z',
      },
    })

    expect(JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      method: 'quota.query',
      params: { capability: 'audio', method: 'audio.asr' },
      sys: [11],
    })
  })

  it('callMethod validates required model fields up front', async () => {
    const fetcher = jest.fn()
    const rpcClient = new kRPCClient('/kapi/aicc/', null, 1, { fetcher })
    const client = new AiccClient(rpcClient)

    await expect(
      client.callMethod(AICC_AI_METHODS.LLM_CHAT, {
        capability: 'llm',
        // @ts-expect-error model.alias missing
        model: {},
        requirements: {},
        payload: {},
      }),
    ).rejects.toThrow('AiccMethodRequest.model.alias is required')

    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects removed request fields', async () => {
    const fetcher = jest.fn()
    const rpcClient = new kRPCClient('/kapi/aicc/', null, 1, { fetcher })
    const client = new AiccClient(rpcClient)

    await expect(
      client.callMethod(AICC_AI_METHODS.LLM_CHAT, {
        capability: 'llm',
        model: { alias: 'm' },
        // @ts-expect-error resp_foramt was removed from the protocol
        requirements: { resp_foramt: 'json' },
        payload: {},
      }),
    ).rejects.toThrow('resp_foramt is no longer supported')

    await expect(
      client.callMethod(AICC_AI_METHODS.LLM_CHAT, {
        capability: 'llm',
        model: { alias: 'm' },
        requirements: {},
        // @ts-expect-error messages must now live under payload.input_json
        payload: { messages: [{ role: 'user', content: 'hello' }] },
      }),
    ).rejects.toThrow('AiccPayload.messages is no longer supported')

    expect(fetcher).not.toHaveBeenCalled()
  })

  it('cancel validates non-empty task_id', async () => {
    const fetcher = jest.fn()
    const rpcClient = new kRPCClient('/kapi/aicc/', null, 1, { fetcher })
    const client = new AiccClient(rpcClient)

    await expect(client.cancel('')).rejects.toThrow('non-empty task_id')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('throws when method response is missing task_id', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({ status: 'running' }, 1))
    const rpcClient = new kRPCClient('/kapi/aicc/', null, 1, { fetcher })
    const client = new AiccClient(rpcClient)

    await expect(
      client.callMethod(AICC_AI_METHODS.LLM_CHAT, {
        capability: 'llm',
        model: { alias: 'm' },
        requirements: {},
        payload: {},
      }),
    ).rejects.toThrow('AiccMethodResponse missing task_id')
  })
})
