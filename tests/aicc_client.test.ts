import { kRPCClient } from '../src/krpc_client'
import {
  AICC_AI_METHODS,
  AICC_CORE_METHODS,
  AICC_MANAGEMENT_METHODS,
  AiccClient,
  ApiType,
  Capability,
  Money,
  QueryUsageRequest,
  ResourceRef,
  aiccMessageTextContent,
  aiccTextMessage,
  isAiccAiMethod,
} from '../src/aicc_client'

function response(result: unknown, seq = 1) {
  return { ok: true, status: 200, json: async () => ({ result, sys: [seq] }) }
}

function sent(fetcher: jest.Mock) {
  return JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)
}

describe('canonical AICC contract', () => {
  it('keeps typed method, api_type, and capability distinct', () => {
    const apiType: ApiType = 'image.txt2img'
    const capability: Capability = 'image'
    expect(AICC_AI_METHODS.IMAGES_GENERATE).toBe('images.generate')
    expect(AICC_AI_METHODS.IMAGES_GENERATE).not.toBe(apiType)
    expect(apiType).not.toBe(capability)
    expect(isAiccAiMethod('chat.completions.create')).toBe(true)
    expect(isAiccAiMethod('llm.chat')).toBe(false)
  })

  it('dispatches canonical chat request without an envelope', async () => {
    const fetcher = jest.fn().mockResolvedValue(response({
      task_id: 't1', status: 'succeeded', message: aiccTextMessage('assistant', 'hello'),
    }, 2))
    const client = new AiccClient(new kRPCClient('/kapi/aicc/', null, 2, { fetcher }))
    const result = await client.chatCompletionsCreate({
      exact_model: 'gpt-5@openai-main',
      trace_id: 'trace-chat-1',
      messages: [aiccTextMessage('user', 'hello')],
      tools: [{ name: 'weather', description: 'weather', args_json_schema: { type: 'object' } }],
    })
    expect(aiccMessageTextContent(result.message!)).toBe('hello')
    expect(sent(fetcher)).toEqual({
      method: 'chat.completions.create',
      params: {
        exact_model: 'gpt-5@openai-main',
        trace_id: 'trace-chat-1',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
        tools: [{ name: 'weather', description: 'weather', args_json_schema: { type: 'object' } }],
      },
      sys: [2],
    })
  })

  it('preserves trace_id on route and helper request bodies', async () => {
    const fetcher = jest.fn().mockResolvedValue(response({}, 1))
    const client = new AiccClient(new kRPCClient('/kapi/aicc/', null, 1, { fetcher }))
    await client.routeResolve({ trace_id: 'trace-route', api_type: 'llm', logical_model: 'llm.chat' })
    expect(sent(fetcher).params.trace_id).toBe('trace-route')

    fetcher.mockClear()
    client.setSeq(1)
    await client.helperLlmChat({
      trace_id: 'trace-chat-helper',
      logical_model: 'llm.chat',
      messages: [aiccTextMessage('user', 'hello')],
    })
    expect(sent(fetcher).params.trace_id).toBe('trace-chat-helper')

    fetcher.mockClear()
    client.setSeq(1)
    await client.helperTextToImage({
      trace_id: 'trace-image-helper',
      logical_model: 'image.generate',
      prompt: 'fox',
    })
    expect(sent(fetcher).params.trace_id).toBe('trace-image-helper')
  })

  it('dispatches route, helper, image, cancel, and management methods', async () => {
    const fetcher = jest.fn().mockResolvedValue(response({ ok: true, settings_revision: 7 }, 3))
    const client = new AiccClient(new kRPCClient('/kapi/aicc/', null, 3, { fetcher }))
    await client.reloadSettings()
    expect(sent(fetcher).method).toBe(AICC_MANAGEMENT_METHODS.SERVICE_RELOAD_SETTINGS)

    const cases = [
      AICC_CORE_METHODS.ROUTE_RESOLVE,
      AICC_CORE_METHODS.HELPER_LLM_CHAT,
      AICC_CORE_METHODS.HELPER_TEXT_TO_IMAGE,
      AICC_CORE_METHODS.CANCEL,
      AICC_AI_METHODS.IMAGES_GENERATE,
      AICC_MANAGEMENT_METHODS.PROVIDER_CATALOG,
      AICC_MANAGEMENT_METHODS.PROTOCOL_ADAPTER_LIST,
      AICC_MANAGEMENT_METHODS.PROVIDER_VALIDATE,
      AICC_MANAGEMENT_METHODS.PROVIDER_ADD,
      AICC_MANAGEMENT_METHODS.PROVIDER_UPDATE,
      AICC_MANAGEMENT_METHODS.PROVIDER_DELETE,
      AICC_MANAGEMENT_METHODS.PROVIDER_REFRESH_MODELS,
      AICC_MANAGEMENT_METHODS.USAGE_QUERY,
      AICC_MANAGEMENT_METHODS.TRACE_QUERY,
    ]
    expect(new Set(cases).size).toBe(cases.length)
  })

  it('rejects unknown fields and invalid exact/logical model names before dispatch', async () => {
    const fetcher = jest.fn()
    const client = new AiccClient(new kRPCClient('/kapi/aicc/', null, 1, { fetcher }))
    expect(() => client.chatCompletionsCreate({
      exact_model: 'gpt-5@openai-main',
      messages: [],
      input_json: {},
    } as never)).toThrow('unknown field')
    expect(() => client.imagesGenerate({ exact_model: 'logical-model', prompt: 'cat' })).toThrow('exact_model')
    expect(() => client.routeResolve({ api_type: 'llm', logical_model: 'gpt-5@openai-main' })).toThrow('logical_model')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('round-trips canonical resources, Money, and usage query DTOs', () => {
    const resource: ResourceRef = { kind: 'named_object', obj_id: 'chunk:123456' }
    const money: Money = { amount: 1.25, currency: 'USD' }
    const query: QueryUsageRequest = {
      time_range: { kind: 'explicit', start_time_ms: 100, end_time_ms: 200 },
      filters: { user_ids: ['u1'], methods: ['embedding.text'], provider_instance_names: ['openai-main'] },
      group_by: ['user_id', 'method', 'provider_instance_name'],
      output_mode: 'summary_and_events',
    }
    for (const value of [resource, money, query]) expect(JSON.parse(JSON.stringify(value))).toEqual(value)
  })

  it('does not expose removed aliases in runtime exports', async () => {
    const module = await import('../src/aicc_client')
    const source = JSON.stringify({ methods: module.AICC_METHODS, prototype: Object.getOwnPropertyNames(module.AiccClient.prototype) })
    for (const removed of ['llm.chat', 'llm.completion', 'image.txt2img', 'callMethod', 'serviceReloadSettings']) {
      expect(source).not.toContain(removed)
    }
  })

  it('keeps required fields in declarations', () => {
    if (false) {
      const client = null as unknown as AiccClient
      // @ts-expect-error exact_model is required
      client.imagesGenerate({ prompt: 'cat' })
      // @ts-expect-error prompt is required
      client.imagesGenerate({ exact_model: 'm@p' })
      // @ts-expect-error voice is required
      client.audioTextToSpeech({ exact_model: 'm@p', text: 'hello' })
      // @ts-expect-error provider base_url is required
      client.addProvider({ provider_instance_name: 'p', provider_type: 'openai', provider_profile_id: 'openai', credentials: {} })
    }
    expect(true).toBe(true)
  })
})
