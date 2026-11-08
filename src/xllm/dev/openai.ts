// OpenAI-compatible Chat Completions client (Rust `OpenAiLlmClient`), for
// development and mocks. Only page code can inject it; configuration cannot
// select it. CORS is the endpoint's business.

import type { AiContent, AiMessage, AiResponse, AiToolCall, JsonValue, LlmClient, LlmInferenceRequest, ProviderFailure } from '../core/types'
import { LLMComputeException, providerError } from '../core/errors'
import { textContent, toolCalls } from '../core/messages'
import { anyJsonObjectSchema } from '../providers/aicc'

/** Failure class of a non-2xx response (Rust `openai_http_failure` after T2-0). */
export function openaiHttpFailure(status: number, body: string): ProviderFailure {
  let code: unknown
  try {
    code = (JSON.parse(body) as { error?: { code?: unknown } })?.error?.code
  } catch {
    code = undefined
  }
  if (code === 'context_length_exceeded') return 'context_limit'
  if (status === 401 || status === 403) return { refused: { code: 'credentials' } }
  if ([400, 404, 422].includes(status)) return 'permanent'
  if ([408, 409, 425, 429, 500, 502, 503, 504].includes(status)) return 'transient'
  return 'unknown'
}

function contentToOpenai(content: AiContent[]): JsonValue {
  const parts: JsonValue[] = []
  for (const c of content) {
    if (c.type === 'text') parts.push({ type: 'text', text: c.text })
    else if (c.type === 'image') {
      const s = c.source
      const url = s.kind === 'url' ? s.url : s.kind === 'base64' ? `data:${s.mime};base64,${s.data_base64}` : s.obj_id
      parts.push({ type: 'image_url', image_url: { url } })
    } else if (c.type === 'document') {
      const label = c.title ?? 'document'
      const desc = c.source.kind === 'url' ? c.source.url : '(inline document omitted)'
      parts.push({ type: 'text', text: `[${label}: ${desc}]` })
    }
  }
  const only = parts[0] as { type?: string; text?: string } | undefined
  if (parts.length === 1 && only?.type === 'text') return only.text as string
  return parts
}

export function messagesToOpenai(messages: AiMessage[]): JsonValue[] {
  const out: JsonValue[] = []
  for (const m of messages) {
    if (m.role === 'system' || m.role === 'developer') out.push({ role: 'system', content: textContent(m) })
    else if (m.role === 'user') out.push({ role: 'user', content: contentToOpenai(m.content) })
    else if (m.role === 'assistant') {
      const text = textContent(m)
      const calls = toolCalls(m).map(c => ({ id: c.call_id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } }))
      const obj: { [k: string]: JsonValue } = { role: 'assistant', content: text === '' ? null : text }
      if (calls.length) obj.tool_calls = calls
      out.push(obj)
    } else {
      for (const b of m.content) {
        if (b.type === 'tool_result') {
          out.push({ role: 'tool', tool_call_id: b.call_id, content: b.content.filter(c => c.type === 'text').map(c => (c as { text: string }).text).join('\n') })
        }
      }
    }
  }
  return out
}

function truncateChars(s: string, max: number): string {
  const chars = [...s]
  return chars.length <= max ? s : chars.slice(0, max).join('') + '…'
}

export interface OpenAiLlmOptions {
  baseUrl?: string
  apiKey: string
  headers?: Record<string, string>
  fetch?: typeof fetch
}

export class OpenAiLlmClient implements LlmClient {
  private readonly baseUrl: string

  constructor(private readonly options: OpenAiLlmOptions) {
    this.baseUrl = (options.baseUrl?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '')
    if (!options.apiKey?.trim()) throw new Error('openai provider: no API key')
  }

  async infer(req: LlmInferenceRequest): Promise<AiResponse> {
    const body: { [k: string]: JsonValue } = { model: req.model_alias, messages: messagesToOpenai(req.messages) }
    if (req.temperature !== undefined) body.temperature = req.temperature
    if (req.max_completion_tokens !== undefined) body.max_tokens = req.max_completion_tokens
    if (req.allow_tool_calls && req.tool_specs.length) {
      body.tools = req.tool_specs.map(s => ({ type: 'function', function: { name: s.name, description: s.description, parameters: s.args_schema } }))
      body.tool_choice = 'auto'
    }
    if (req.force_json) body.response_format = { type: 'json_schema', json_schema: { name: 'xllm_result', schema: req.json_schema ?? anyJsonObjectSchema() } }
    if (req.provider_options && typeof req.provider_options === 'object' && !Array.isArray(req.provider_options)) {
      Object.assign(body, req.provider_options)
    }
    const f = this.options.fetch ?? globalThis.fetch.bind(globalThis)
    let response: Response
    try {
      response = await f(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.options.apiKey}`, ...(this.options.headers ?? {}) },
        body: JSON.stringify(body),
        signal: req.signal,
      })
    } catch (e) {
      if (req.signal.aborted) throw new LLMComputeException({ kind: 'cancelled' })
      throw providerError('transient', `openai request failed: ${e instanceof Error ? e.message : String(e)}`)
    }
    let text: string
    try {
      text = await response.text()
    } catch (e) {
      throw providerError('transient', `openai read body failed: ${e instanceof Error ? e.message : String(e)}`)
    }
    if (!response.ok) throw providerError(openaiHttpFailure(response.status, text), `openai http ${response.status}: ${truncateChars(text, 512)}`)
    let parsed: { choices?: { message?: { content?: unknown; tool_calls?: unknown[] }; finish_reason?: unknown }[]; usage?: Record<string, unknown>; model?: unknown }
    try {
      parsed = JSON.parse(text)
    } catch (e) {
      throw providerError('unknown', `openai invalid JSON: ${e instanceof Error ? e.message : String(e)}`)
    }
    const choice = parsed.choices?.[0]
    if (!choice) throw providerError('unknown', 'openai response has no choices')
    const message = choice.message ?? {}
    const content: AiMessage['content'] = []
    if (typeof message.content === 'string') content.push({ type: 'text', text: message.content })
    for (const c of (message.tool_calls ?? []) as { id?: string; function?: { name?: string; arguments?: string } }[]) {
      let args: AiToolCall['args'] = {}
      try {
        const v = JSON.parse(c.function?.arguments ?? '{}')
        if (v && typeof v === 'object' && !Array.isArray(v)) args = v
      } catch {
        args = {}
      }
      content.push({ type: 'tool_use', call_id: c.id ?? '', name: c.function?.name ?? '', args })
    }
    if (content.length === 0) content.push({ type: 'text', text: '' })
    const out: AiResponse = { message: { role: 'assistant', content } }
    if (typeof choice.finish_reason === 'string') out.finish_reason = choice.finish_reason
    const u = parsed.usage
    if (u) {
      out.usage = { request_units: 1 }
      if (typeof u.prompt_tokens === 'number') out.usage.input_tokens = u.prompt_tokens
      if (typeof u.completion_tokens === 'number') out.usage.output_tokens = u.completion_tokens
      if (typeof u.total_tokens === 'number') out.usage.total_tokens = u.total_tokens
    }
    if (typeof parsed.model === 'string') out.extra = { model: parsed.model }
    return out
  }
}
