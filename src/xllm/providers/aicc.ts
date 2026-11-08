// AICC as an `LlmClient` (Rust `AiccLlmClient`). The client is the page's own
// `AiccClient` (`getAiccClient()`): calls run under the page's session; xllm
// never touches it.
//
// Error table (same order as Rust `aicc_provider_failure` /
// `provider_error_from_rpc`, no matching on message text):
//   quota_exhausted / quota_budget_exceeded / resource_not_permitted /
//     attribution_unavailable              → refused { code }
//   quota_unavailable                       → transient
//   context_length_exceeded, http_status 413 → context_limit
//   timeout, retriable                      → transient
//   kRPC http_error: 413 → context_limit, 408 / 504 → transient,
//     401 / 403 → refused { credentials }, other → unknown
//   transport failure                       → transient
//   anything else                           → unknown

import type {
  AiccClient, AiccError, AiToolSpec, HelperModelRequirement, LlmChatHelperRequest, LlmChatInvokeRequest,
  LlmChatInvokeResponse, LlmResponseFormat, ModelDisable,
} from '../../aicc_client'
import { RPC_HTTP_ERROR_CODE, RPC_TRANSPORT_ERROR_CODE } from '../../krpc_client'
import type { RPCError } from '../../krpc_client'
import type { AiResponse, JsonValue, LlmClient, LlmInferenceRequest, ProviderFailure } from '../core/types'
import { LLMComputeException, providerError } from '../core/errors'
import { isObject } from '../core/json'

export const REFUSED_QUOTA_EXHAUSTED = 'quota_exhausted'
export const REFUSED_QUOTA_BUDGET_EXCEEDED = 'quota_budget_exceeded'
export const REFUSED_RESOURCE_NOT_PERMITTED = 'resource_not_permitted'
export const REFUSED_ATTRIBUTION_UNAVAILABLE = 'attribution_unavailable'
/** The service refused the caller's credentials: sign in again, then resume. */
export const REFUSED_CREDENTIALS = 'credentials'

const REFUSAL_CODES = [REFUSED_QUOTA_EXHAUSTED, REFUSED_QUOTA_BUDGET_EXCEEDED, REFUSED_RESOURCE_NOT_PERMITTED, REFUSED_ATTRIBUTION_UNAVAILABLE]

/** `force_json` without a schema: any JSON object (a bare `{"type":"object"}` gets `{}` from Gemini). */
export function anyJsonObjectSchema(): JsonValue {
  return { type: 'object', additionalProperties: true }
}

function refused(code: string): ProviderFailure {
  return { refused: { code } }
}

/** Failure class of an AICC error, `undefined` when the error does not say. */
export function aiccProviderFailure(error: Partial<AiccError>): ProviderFailure | undefined {
  const code = error.code as string | undefined
  if (code && REFUSAL_CODES.includes(code)) return refused(code)
  if (code === 'quota_unavailable') return 'transient'
  const httpStatus = isObject(error.details) ? error.details.http_status : undefined
  if (code === 'context_length_exceeded' || httpStatus === 413) return 'context_limit'
  if (code === 'timeout' || error.retriable === true) return 'transient'
  return undefined
}

/** A failed AICC call (a rejected kRPC call) as a provider error. */
export function providerErrorFromRpc(context: string, err: unknown): LLMComputeException {
  const message = err instanceof Error ? err.message : String(err)
  const text = `${context}: ${message}`
  // Read the structured fields of an `RPCError` without `instanceof`: the
  // page's AICC client may come from another bundle of this SDK.
  const code = typeof err === 'object' && err !== null ? (err as Partial<RPCError>).code : undefined
  if (typeof code !== 'string' || !code) return providerError('unknown', text)
  const rawData = (err as Partial<RPCError>).data
  const data = isObject(rawData) ? rawData : undefined
  const fromAicc = aiccProviderFailure({ ...(data as Partial<AiccError> | undefined), code: code as AiccError['code'] })
  if (fromAicc) return providerError(fromAicc, text)
  if (code === RPC_HTTP_ERROR_CODE) {
    const status = typeof data?.status === 'number' ? data.status : undefined
    if (status === 413) return providerError('context_limit', text)
    if (status === 408 || status === 504) return providerError('transient', text)
    if (status === 401 || status === 403) return providerError(refused(REFUSED_CREDENTIALS), text)
    return providerError('unknown', text)
  }
  if (code === RPC_TRANSPORT_ERROR_CODE) return providerError('transient', text)
  return providerError('unknown', text)
}

const DISABLE_FEATURES: Record<string, keyof ModelDisable> = {
  tool_call: 'tool_call', json_schema: 'json_schema', web_search: 'web_search', vision: 'vision',
  image_generation: 'image_generation', streaming: 'streaming',
}

function aiccErrorText(e: AiccError | undefined): string {
  return e ? ` (${e.code}: ${e.message})` : ''
}

/** `LlmClient` over the page's AICC client. */
export class AiccLlmClient implements LlmClient {
  constructor(private readonly client: AiccClient) {}

  async infer(req: LlmInferenceRequest): Promise<AiResponse> {
    const tools: AiToolSpec[] = req.allow_tool_calls
      ? req.tool_specs.map(s => ({ type: 'function', name: s.name, description: s.description, args_json_schema: s.args_schema }))
      : []
    const disable: ModelDisable = {}
    for (const f of req.disable_capabilities) {
      const key = DISABLE_FEATURES[f]
      if (key) (disable as Record<string, boolean>)[key] = true
    }
    let responseFormat: LlmResponseFormat | undefined
    if (req.force_json) {
      responseFormat = req.json_schema !== undefined
        ? { type: 'json_schema', json_schema: { name: 'llm_response', schema: req.json_schema } }
        : { type: 'json_schema', json_schema: { name: 'llm_response', schema: anyJsonObjectSchema(), strict: false } }
    }
    const common = {
      messages: req.messages,
      ...(tools.length ? { tools } : {}),
      ...(responseFormat ? { response_format: responseFormat } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.max_completion_tokens !== undefined ? { max_output_tokens: req.max_completion_tokens } : {}),
      ...(req.trace_id ? { trace_id: req.trace_id } : {}),
      execution_mode: 'immediate' as const,
    }
    const exact = req.model_alias.includes('@')
    const method = exact ? 'chat.completions.create' : 'helper.llm_chat'
    let response: LlmChatInvokeResponse
    try {
      if (exact) {
        const r: LlmChatInvokeRequest = { exact_model: req.model_alias, ...common }
        response = await this.client.chatCompletionsCreate(r)
      } else {
        const requirements: HelperModelRequirement = {}
        if (req.allow_tool_calls && tools.length > 0) requirements.tool_call = true
        if (req.force_json) requirements.json_schema = true
        const r: LlmChatHelperRequest = {
          logical_model: req.model_alias, ...common,
          ...(Object.keys(requirements).length ? { requirements } : {}),
          ...(Object.keys(disable).length ? { disable } : {}),
        }
        response = await this.client.helperLlmChat(r)
      }
    } catch (e) {
      if (e instanceof LLMComputeException) throw e
      throw providerErrorFromRpc(`aicc ${method} failed`, e)
    }
    if (response.status === 'succeeded') {
      if (!response.message) throw providerError('unknown', `aicc ${method} succeeded but message is empty`)
      const out: AiResponse = { message: response.message }
      if (response.usage) out.usage = response.usage
      if (response.cost) out.cost = response.cost
      if (response.finish_reason) out.finish_reason = response.finish_reason
      if (response.provider_task_ref) out.provider_task_ref = response.provider_task_ref
      const model = response.route_trace?.final_model
      if (model) out.extra = { model }
      return out
    }
    if (response.status === 'failed') {
      const failure = (response.error && aiccProviderFailure(response.error)) ?? 'unknown'
      throw providerError(failure,
        `aicc ${method} failed${aiccErrorText(response.error)}: task_id=${response.task_id}, event_ref=${response.event_ref ?? ''}`)
    }
    throw providerError('permanent',
      `aicc ${method} returned async task \`${response.task_id}\`; xllm does not poll async tasks — use a synchronous-capable model`)
  }
}
