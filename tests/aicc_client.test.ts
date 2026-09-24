import { kRPCClient } from '../src/krpc_client'
import {
  AICC_AI_METHODS,
  AICC_CORE_METHODS,
  AICC_EXECUTION_MODES,
  AICC_MANAGEMENT_METHODS,
  AICC_METHODS,
  AiccError,
  AiccClient,
  AiccRouteOverlay,
  AiccRouteTraceEvent,
  ApiType,
  Capability,
  InferenceResponse,
  Money,
  ProviderInstanceView,
  QueryUsageRequest,
  RouteResolveResponse,
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

function lastSent(fetcher: jest.Mock) {
  const call = fetcher.mock.calls[fetcher.mock.calls.length - 1]
  return JSON.parse((call[1] as RequestInit).body as string)
}

function echoingFetcher(result: unknown) {
  return jest.fn().mockImplementation(async (_url: string, init: RequestInit) => {
    const request = JSON.parse(init.body as string)
    return response(result, request.sys[0])
  })
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
      execution_mode: AICC_EXECUTION_MODES.STREAM,
      session_id: 'session-chat-1',
      messages: [aiccTextMessage('user', 'hello')],
      tools: [{ name: 'weather', description: 'weather', args_json_schema: { type: 'object' } }],
    })
    expect(aiccMessageTextContent(result.message!)).toBe('hello')
    expect(sent(fetcher)).toEqual({
      method: 'chat.completions.create',
      params: {
        exact_model: 'gpt-5@openai-main',
        trace_id: 'trace-chat-1',
        execution_mode: 'stream',
        session_id: 'session-chat-1',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
        tools: [{ name: 'weather', description: 'weather', args_json_schema: { type: 'object' } }],
      },
      sys: [2],
    })
  })

  it('preserves trace_id and session_id on route and helper request bodies', async () => {
    const fetcher = jest.fn().mockResolvedValue(response({}, 1))
    const client = new AiccClient(new kRPCClient('/kapi/aicc/', null, 1, { fetcher }))
    await client.routeResolve({ trace_id: 'trace-route', execution_mode: 'stream', api_type: 'llm', logical_model: 'llm.chat', session_id: 'session-route' })
    expect(sent(fetcher).params.trace_id).toBe('trace-route')
    expect(sent(fetcher).params.execution_mode).toBe('stream')
    expect(sent(fetcher).params.session_id).toBe('session-route')

    fetcher.mockClear()
    client.setSeq(1)
    await client.helperLlmChat({
      trace_id: 'trace-chat-helper',
      execution_mode: 'stream',
      logical_model: 'llm.chat',
      session_id: 'session-chat-helper',
      messages: [aiccTextMessage('user', 'hello')],
    })
    expect(sent(fetcher).params.trace_id).toBe('trace-chat-helper')
    expect(sent(fetcher).params.execution_mode).toBe('stream')
    expect(sent(fetcher).params.session_id).toBe('session-chat-helper')

    fetcher.mockClear()
    client.setSeq(1)
    await client.helperTextToImage({
      trace_id: 'trace-image-helper',
      execution_mode: 'stream',
      logical_model: 'image.generate',
      prompt: 'fox',
      session_id: 'session-image-helper',
    })
    expect(sent(fetcher).params.trace_id).toBe('trace-image-helper')
    expect(sent(fetcher).params.execution_mode).toBe('stream')
    expect(sent(fetcher).params.session_id).toBe('session-image-helper')
  })

  it('dispatches every canonical typed inference method', async () => {
    const fetcher = echoingFetcher({ task_id: 't', status: 'succeeded' })
    const client = new AiccClient(new kRPCClient('/kapi/aicc/', null, 1, { fetcher }))
    const ref: ResourceRef = { kind: 'url', url: 'https://example.test/resource' }
    const inferenceCases: Array<[string, () => Promise<unknown>]> = [
      [AICC_AI_METHODS.CHAT_COMPLETIONS_CREATE, () => client.chatCompletionsCreate({ exact_model: 'm@p', messages: [] })],
      [AICC_AI_METHODS.IMAGES_GENERATE, () => client.imagesGenerate({ exact_model: 'm@p', prompt: 'cat' })],
      [AICC_AI_METHODS.EMBEDDING_TEXT, () => client.embeddingText({ exact_model: 'm@p', items: [{ type: 'text', text: 'cat' }] })],
      [AICC_AI_METHODS.EMBEDDING_MULTIMODAL, () => client.embeddingMultimodal({ exact_model: 'm@p', items: [{ id: '1', text: 'cat' }] })],
      [AICC_AI_METHODS.RERANK, () => client.rerank({ exact_model: 'm@p', query: 'cat', documents: [{ id: '1', text: 'cat' }] })],
      [AICC_AI_METHODS.IMAGE_IMG2IMG, () => client.imageToImage({ exact_model: 'm@p', images: [ref], prompt: 'cat' })],
      [AICC_AI_METHODS.IMAGE_INPAINT, () => client.imageInpaint({ exact_model: 'm@p', image: ref, mask: ref, prompt: 'cat' })],
      [AICC_AI_METHODS.IMAGE_UPSCALE, () => client.imageUpscale({ exact_model: 'm@p', image: ref })],
      [AICC_AI_METHODS.IMAGE_BG_REMOVE, () => client.imageBackgroundRemove({ exact_model: 'm@p', image: ref })],
      [AICC_AI_METHODS.VISION_OCR, () => client.visionOcr({ exact_model: 'm@p', document: ref })],
      [AICC_AI_METHODS.VISION_CAPTION, () => client.visionCaption({ exact_model: 'm@p', image: ref })],
      [AICC_AI_METHODS.VISION_DETECT, () => client.visionDetect({ exact_model: 'm@p', image: ref })],
      [AICC_AI_METHODS.VISION_SEGMENT, () => client.visionSegment({ exact_model: 'm@p', image: ref, prompt: { type: 'text', text: 'cat' } })],
      [AICC_AI_METHODS.AUDIO_TTS, () => client.audioTextToSpeech({ exact_model: 'm@p', text: 'cat', voice: {} })],
      [AICC_AI_METHODS.AUDIO_ASR, () => client.audioSpeechRecognition({ exact_model: 'm@p', audio: ref })],
      [AICC_AI_METHODS.AUDIO_MUSIC, () => client.audioMusic({ exact_model: 'm@p', prompt: 'cat' })],
      [AICC_AI_METHODS.AUDIO_ENHANCE, () => client.audioEnhance({ exact_model: 'm@p', audio: ref, task: 'denoise' })],
      [AICC_AI_METHODS.VIDEO_TXT2VIDEO, () => client.videoTextToVideo({ exact_model: 'm@p', prompt: 'cat' })],
      [AICC_AI_METHODS.VIDEO_IMG2VIDEO, () => client.videoImageToVideo({ exact_model: 'm@p', image: ref, prompt: 'cat' })],
      [AICC_AI_METHODS.VIDEO_VIDEO2VIDEO, () => client.videoToVideo({ exact_model: 'm@p', video: ref, prompt: 'cat' })],
      [AICC_AI_METHODS.VIDEO_EXTEND, () => client.videoExtend({ exact_model: 'm@p', video: ref, prompt: 'cat' })],
      [AICC_AI_METHODS.VIDEO_UPSCALE, () => client.videoUpscale({ exact_model: 'm@p', video: ref, target_resolution: '1080p' })],
      [AICC_AI_METHODS.AGENT_COMPUTER_USE, () => client.computerUse({ exact_model: 'm@p', task: 'click', environment: {
        environment_id: 'e', session_id: 's', screenshot: ref, viewport: { width: 1, height: 1 },
      }, allowed_actions: ['left_click'] })],
    ]
    expect(inferenceCases.map(([method]) => method)).toEqual(Object.values(AICC_AI_METHODS))
    for (const [method, invoke] of inferenceCases) {
      await invoke()
      expect(lastSent(fetcher).method).toBe(method)
      expect(lastSent(fetcher).params.execution_mode).toBe('immediate')
    }
  })

  it('dispatches every canonical core and management method', async () => {
    const fetcher = echoingFetcher({ ok: true, settings_revision: 7 })
    const client = new AiccClient(new kRPCClient('/kapi/aicc/', null, 1, { fetcher }))
    const coreAndManagementCases: Array<[string, () => Promise<unknown>]> = [
      [AICC_CORE_METHODS.ROUTE_RESOLVE, () => client.routeResolve({ api_type: 'llm', logical_model: 'llm.chat' })],
      [AICC_CORE_METHODS.HELPER_LLM_CHAT, () => client.helperLlmChat({ logical_model: 'llm.chat', messages: [] })],
      [AICC_CORE_METHODS.HELPER_TEXT_TO_IMAGE, () => client.helperTextToImage({ logical_model: 'image.generate', prompt: 'cat' })],
      [AICC_CORE_METHODS.CANCEL, () => client.cancel('task-1')],
      [AICC_MANAGEMENT_METHODS.SERVICE_RELOAD_SETTINGS, () => client.reloadSettings()],
      [AICC_MANAGEMENT_METHODS.QUOTA_QUERY, () => client.queryQuota()],
      [AICC_MANAGEMENT_METHODS.USAGE_QUERY, () => client.queryUsage({ time_range: { kind: 'last1d' } })],
      [AICC_MANAGEMENT_METHODS.TRACE_QUERY, () => client.queryTrace()],
      [AICC_MANAGEMENT_METHODS.ROUTING_GET, () => client.getRouting()],
      [AICC_MANAGEMENT_METHODS.ROUTING_UPDATE, () => client.updateRouting({ settings_revision: 1, provider_weights: {} })],
      [AICC_MANAGEMENT_METHODS.PROVIDER_CATALOG, () => client.providerCatalog()],
      [AICC_MANAGEMENT_METHODS.PROTOCOL_ADAPTER_LIST, () => client.listProtocolAdapters()],
      [AICC_MANAGEMENT_METHODS.PROVIDER_VALIDATE, () => client.validateProvider({ provider_type: 'openai', provider_profile_id: 'openai', base_url: 'https://example.test', credentials: {} })],
      [AICC_MANAGEMENT_METHODS.PROVIDER_ADD, () => client.addProvider({ provider_instance_name: 'p', provider_type: 'openai', provider_profile_id: 'openai', base_url: 'https://example.test', credentials: {} })],
      [AICC_MANAGEMENT_METHODS.PROVIDER_LIST, () => client.listProviders()],
      [AICC_MANAGEMENT_METHODS.PROVIDER_HEALTH, () => client.providerHealth({ exact_model: 'm@p' })],
      [AICC_MANAGEMENT_METHODS.PROVIDER_UPDATE, () => client.updateProvider({ provider_instance_name: 'p', settings_revision: 1 })],
      [AICC_MANAGEMENT_METHODS.PROVIDER_DELETE, () => client.deleteProvider({ provider_instance_name: 'p' })],
      [AICC_MANAGEMENT_METHODS.PROVIDER_REFRESH_MODELS, () => client.refreshProviderModels({ provider_instance_name: 'p' })],
      [AICC_MANAGEMENT_METHODS.MODELS_LIST, () => client.listModels()],
      [AICC_MANAGEMENT_METHODS.DRIVER_METADATA_UPDATE_GET, () => client.getDriverMetadataUpdate()],
      [AICC_MANAGEMENT_METHODS.DRIVER_METADATA_UPDATE_SET, () => client.setDriverMetadataUpdate({ enabled: true })],
    ]
    expect(coreAndManagementCases.map(([method]) => method)).toEqual([
      ...Object.values(AICC_CORE_METHODS), ...Object.values(AICC_MANAGEMENT_METHODS),
    ])
    for (const [method, invoke] of coreAndManagementCases) {
      await invoke()
      expect(lastSent(fetcher).method).toBe(method)
      if (Object.values(AICC_CORE_METHODS).slice(0, 3).includes(method as never)) {
        expect(lastSent(fetcher).params.execution_mode).toBe('immediate')
      }
    }
    expect(new Set(Object.values(AICC_METHODS)).size).toBe(Object.values(AICC_METHODS).length)
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
    expect(() => client.embeddingText({
      exact_model: 'embedding@provider', items: [], execution_mode: 'native_task',
    } as never)).toThrow('execution_mode')
    expect(() => client.routeResolve({
      api_type: 'llm', logical_model: 'llm.chat', session_id: '',
    })).toThrow('session_id')
    expect(() => client.routeResolve({
      api_type: 'llm', logical_model: 'llm.chat', session_id: '界'.repeat(171),
    })).toThrow('session_id')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('round-trips canonical resources, routing, responses, errors, provider, usage, and trace DTOs', () => {
    const resource: ResourceRef = { kind: 'named_object', obj_id: 'chunk:123456' }
    const money: Money = { amount: 1.25, currency: 'USD' }
    const query: QueryUsageRequest = {
      time_range: { kind: 'explicit', start_time_ms: 100, end_time_ms: 200 },
      filters: { user_ids: ['u1'], methods: ['embedding.text'], provider_instance_names: ['openai-main'] },
      group_by: ['user_id', 'method', 'provider_instance_name'],
      output_mode: 'summary_and_events',
    }
    const overlay: AiccRouteOverlay = {
      logical_tree: { llm: { children: { chat: { items: { primary: { target: 'gpt-5@openai-main', weight: 2 } } } } } },
      policy: { profile: { value: 'quality_first', locked: true }, max_estimated_cost: money },
      provider_weights: { 'openai-main': 1 },
    }
    const route: RouteResolveResponse = {
      selected_exact_model: 'gpt-5@openai-main', selected_model_uid: 'uid', provider_instance_name: 'openai-main',
      provider_profile_id: 'openai', protocol_adapter_id: 'openai-responses', model_driver_id: 'openai',
      origin_model_id: 'gpt-5', provider_model_id: 'gpt-5', operation: 'responses.create', inventory_revision: 'r1',
    }
    const inference: InferenceResponse = { task_id: 'task-1', status: 'failed', error: {
      code: 'provider_error', message: 'failed', retriable: true,
    } }
    const error: AiccError = { code: 'settings_revision_conflict', message: 'conflict',
      details: { expected_revision: 1, actual_revision: 2 } }
    const provider: ProviderInstanceView = { provider_instance_name: 'openai-main', provider_type: 'openai',
      provider_profile_id: 'openai', protocol_adapter_id: 'openai-responses', base_url: 'https://example.test', enabled: true,
      auth: { mode: 'api_key', configured: true }, inventory: { state: 'loaded', model_count: 1 },
      health: { state: 'healthy' } }
    const trace: AiccRouteTraceEvent = { trace_id: 'trace-1', tenant_id: 'tenant-1', task_id: 'task-1',
      request_model: 'llm.chat', api_type: 'llm', route_trace_json: { attempts: [] }, created_at_ms: 1 }
    for (const value of [resource, money, query, overlay, route, inference, error, provider, trace]) {
      expect(JSON.parse(JSON.stringify(value))).toEqual(value)
    }
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
      // @ts-expect-error removed all-in-one request export
      const legacyRequest = null as unknown as import('../src/aicc_client').AiccMethodRequest
      // @ts-expect-error removed payload export
      const legacyPayload = null as unknown as import('../src/aicc_client').AiccPayload
      // @ts-expect-error removed all-in-one client method
      client.callMethod(legacyRequest, legacyPayload)
    }
    expect(true).toBe(true)
  })
})
