// Context-window checks at an inference boundary (Rust: the `context_window` module of llm_context).

import type { AiContent, AiMessage, ContextLimitKind, LLMContextRequest, LlmInferenceRequest, Tokenizer } from './types'
import { canonicalJson } from './json'

export const MESSAGE_OVERHEAD_TOKENS = 4
export const MEDIA_PART_TOKENS = 1024

export interface ContextLimits {
  threshold?: number
  window?: number
  reserve: number
}

/** The limits of `request`, or an error message for an invalid configuration. */
export function contextLimitsOf(request: LLMContextRequest): ContextLimits | string {
  const budget = request.budget
  const window = budget.context_window_tokens ?? undefined
  if (window === 0) return 'context_window_tokens must be > 0'
  const reserve = request.model_policy.max_completion_tokens ?? 0
  if (window !== undefined && reserve >= window) {
    return `max_completion_tokens ${reserve} leaves no room in context_window_tokens ${window}`
  }
  let threshold: number | undefined
  const t = budget.context_yield_threshold
  if (t) {
    if (t.kind === 'absolute_tokens') {
      if (t.value === 0) return 'AbsoluteTokens threshold must be > 0'
      threshold = t.value
    } else {
      if (!Number.isFinite(t.value) || t.value <= 0 || t.value > 1) return `Ratio threshold ${t.value} is outside (0, 1]`
      if (window === undefined) return 'Ratio threshold requires context_window_tokens'
      threshold = Math.max(Math.floor(window * Math.fround(t.value)), 1)
    }
  }
  return { threshold, window, reserve }
}

export function limitsActive(l: ContextLimits): boolean {
  return l.threshold !== undefined || l.window !== undefined
}

export function checkLimits(l: ContextLimits, estimated: number): ContextLimitKind | undefined {
  if (l.window !== undefined && estimated + l.reserve > l.window) return 'hard_limit'
  if (l.threshold !== undefined && estimated >= l.threshold) return 'approaching_window'
  return undefined
}

function partTokens(tok: Tokenizer, part: AiContent): number {
  switch (part.type) {
    case 'text': return tok.countTokens(part.text)
    case 'image': case 'document': return MEDIA_PART_TOKENS
    case 'tool_use': return tok.countTokens(part.name) + tok.countTokens(canonicalJson(part.args ?? {}))
    case 'tool_result':
      return part.content.reduce((n, c) => n + (c.type === 'text' ? tok.countTokens(c.text) : MEDIA_PART_TOKENS), 0)
    case 'thinking': return (part.summary ? tok.countTokens(part.summary) : 0) + (part.text ? tok.countTokens(part.text) : 0)
    case 'provider_state': return tok.countTokens(canonicalJson(part.value))
  }
}

export function estimateMessages(tok: Tokenizer, messages: AiMessage[]): number {
  return messages.reduce((n, m) => n + MESSAGE_OVERHEAD_TOKENS + m.content.reduce((k, p) => k + partTokens(tok, p), 0), 0)
}

export function estimateRequest(tok: Tokenizer, req: LlmInferenceRequest): number {
  let total = estimateMessages(tok, req.messages)
  if (req.allow_tool_calls) {
    for (const spec of req.tool_specs) {
      total += tok.countTokens(spec.name) + tok.countTokens(spec.description) + tok.countTokens(canonicalJson(spec.args_schema))
    }
  }
  if (req.force_json && req.json_schema !== undefined) total += tok.countTokens(canonicalJson(req.json_schema))
  return total
}
