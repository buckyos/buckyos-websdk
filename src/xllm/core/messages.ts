import type { AiCost, AiMessage, AiRole } from '../../aicc_client'
import type { AiResponse, AiToolCall, AiUsage, JsonValue, Observation } from './types'
import { canonicalJson } from './json'
import { rustTextContent, rustTrim } from './rust_text'

export function nowMs(): number {
  return Date.now()
}

export function textMessage(role: AiRole, text: string): AiMessage {
  return { role, content: [{ type: 'text', text }] }
}

/** All text blocks joined by `\n` (`AiMessage::text_content`). */
export function textContent(message: AiMessage): string {
  return rustTextContent(message)
}

/** Tool-use blocks as calls, in message order (`AiMessage::tool_calls`). */
export function toolCalls(message: AiMessage): AiToolCall[] {
  const out: AiToolCall[] = []
  for (const b of message.content) {
    if (b.type === 'tool_use') out.push({ name: b.name, args: b.args ?? {}, call_id: b.call_id })
  }
  return out
}

/** `AiResponse::validate`: an assistant message with blocks allowed for the role and tool calls with ids. */
export function validateResponse(response: AiResponse): string | undefined {
  const m = response.message
  if (!m || m.role !== 'assistant') return `invalid block response_message for role ${m?.role}`
  for (const b of m.content ?? []) {
    if (!['text', 'image', 'document', 'tool_use', 'thinking', 'provider_state'].includes(b.type)) {
      return `invalid block ${b.type} for role assistant`
    }
    if (b.type === 'tool_use' && !rustTrim(b.call_id ?? '')) return 'tool call without call_id'
  }
  return undefined
}

/** The tool-role message carrying one observation back to the model. */
export function toolObservationMessage(callId: string, observation: Observation): AiMessage {
  let text: string
  let isError: boolean
  switch (observation.kind) {
    case 'success':
      text = typeof observation.content === 'string' ? observation.content : canonicalJson(observation.content)
      isError = false
      break
    case 'error':
      text = observation.message
      isError = true
      break
    case 'cancelled':
      if (observation.effect_unknown) {
        text = `[cancelled, result unknown] ${observation.reason}`
        isError = true
      } else {
        text = `[cancelled] ${observation.reason}`
        isError = false
      }
      break
    case 'unresolved':
      text = observation.effect_unknown ? `[unresolved: result unknown] ${observation.reason}` : `[not executed] ${observation.reason}`
      isError = true
      break
  }
  const block: AiMessage['content'][number] = isError
    ? { type: 'tool_result', call_id: callId, content: [{ type: 'text', text }], is_error: true }
    : { type: 'tool_result', call_id: callId, content: [{ type: 'text', text }] }
  return { role: 'tool', content: [block] }
}

const USAGE_COUNTERS: (keyof AiUsage)[] = [
  'input_tokens', 'output_tokens', 'total_tokens', 'cache_read_input_tokens', 'cache_write_input_tokens',
  'cache_write_1h_input_tokens', 'reasoning_tokens', 'image_units', 'audio_seconds', 'video_seconds', 'reference_images',
  'request_units', 'characters', 'audio_input_tokens', 'image_input_tokens', 'audio_output_tokens', 'image_output_tokens',
]

/** Sum of two usages (`merge_usage`): counters add, `cost` adds per currency, `reported_cost` is dropped. */
export function mergeUsage(left: AiUsage, right: AiUsage): AiUsage {
  const out: AiUsage = {}
  for (const k of USAGE_COUNTERS) {
    const a = left[k] as number | undefined
    const b = right[k] as number | undefined
    if (a !== undefined || b !== undefined) (out as Record<string, number>)[k] = (a ?? 0) + (b ?? 0)
  }
  const cost = addCost(left.cost, right.cost)
  if (cost) out.cost = cost
  return out
}

function addCost(a?: AiCost, b?: AiCost): AiCost | undefined {
  if (a && b) return a.currency === b.currency ? { amount: a.amount + b.amount, currency: a.currency } : undefined
  return a ?? b
}

/** `add_usage` of the run record: input / output / total tokens and request units. */
export function addRecordUsage(base: AiUsage | undefined, extra: AiUsage): AiUsage {
  const cur: AiUsage = { ...(base ?? {}) }
  for (const k of ['input_tokens', 'output_tokens', 'total_tokens', 'request_units'] as const) {
    if (extra[k] !== undefined) cur[k] = (cur[k] ?? 0) + (extra[k] as number)
  }
  return cur
}

export function argsOf(args: Record<string, JsonValue> | undefined): Record<string, JsonValue> {
  return args ?? {}
}
