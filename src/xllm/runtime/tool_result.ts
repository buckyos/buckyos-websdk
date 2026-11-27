// The AgentToolResult envelope (`agent_tool/src/lib.rs`, protocol "1"): a
// tool may return it instead of a plain value to say it is still running as a
// task (`status: pending` + `task_id`), to attach hints, or to mark a result
// the model already saw (`dedup`). The observation carries it verbatim in
// `host`; the waist never reads it.

import type { JsonValue } from '../core/types'
import { canonicalJson, isObject } from '../core/json'
import { rustTrim } from '../core/rust_text'
import { RESULT_BUDGET_TOKENS, clipToBudget, clipToDefaultBudget } from './text_budget'

export const AGENT_TOOL_PROTOCOL_VERSION = '1'

export type AgentToolStatus = 'success' | 'error' | 'pending'

export interface ResultHint {
  text: string
  /** Shown once while a result that showed it is in the context (`hints_once` in run.json). */
  once?: string
}

export interface ResultDedup {
  key: string
  hint: string
}

export interface AgentToolResult {
  agent_tool_protocol: string
  tool?: string
  cmd_name?: string
  status: AgentToolStatus
  task_id?: string
  pending_reason?: string
  /** Seconds after which the caller should look again; a runtime only uses it to shorten its wait. */
  check_after?: number
  estimated_wait?: string
  title?: string
  summary: string
  detail: JsonValue
  cmd_args?: string
  return_code?: number
  partial_output?: string
  output?: string
  hints?: ResultHint[]
  dedup?: ResultDedup
}

/** A return value that is an AgentToolResult envelope (`agent_tool_protocol: "1"`). */
export function asToolResult(value: unknown): AgentToolResult | undefined {
  if (!isObject(value) || value.agent_tool_protocol !== AGENT_TOOL_PROTOCOL_VERSION) return undefined
  const status = value.status ?? 'success'
  if (status !== 'success' && status !== 'error' && status !== 'pending') return undefined
  return {
    ...(value as unknown as AgentToolResult),
    status,
    summary: typeof value.summary === 'string' ? value.summary : '',
    detail: value.detail === undefined ? {} : value.detail,
  }
}

/**
 * `result_view::full_text`: what a result shows in full, the same in both
 * loops: the output, else a string detail, the summary, the title; a
 * structured detail only when none of them is there (compact JSON within the
 * per-result budget). An error shows its summary with its output.
 */
export function fullText(isError: boolean, output: string | undefined, detail: JsonValue | undefined, summary: string, title: string): string {
  const out = output !== undefined && rustTrim(output) !== '' ? output : undefined
  const summaryT = rustTrim(summary)
  const titleT = rustTrim(title)
  const detailText = typeof detail === 'string' && rustTrim(detail) !== '' ? detail : undefined
  const detailJson = (): string | undefined => {
    if (detail === undefined || detail === null) return undefined
    if (isObject(detail) && Object.keys(detail).length === 0) return undefined
    return clipToDefaultBudget(canonicalJson(detail))[0]
  }
  if (isError) {
    if (summaryT && out !== undefined) return `${summaryT}\n${rustTrim(out)}`
    if (summaryT) return summaryT
    if (out !== undefined) return rustTrim(out)
    return detailText ?? (titleT || undefined) ?? detailJson() ?? 'tool error'
  }
  if (out !== undefined) return out
  return detailText ?? (summaryT ? summary : undefined) ?? (titleT || undefined) ?? detailJson() ?? 'Success'
}

/** The text the model sees (`AgentToolResult::observation_text`). */
export function observationText(r: AgentToolResult): string {
  return fullText(r.status === 'error', r.output, r.detail, r.summary, r.title ?? '')
}

const RESULT_BUDGET_MORE = 'narrow the call (a range, a filter, less output) to see the rest'

const tokensOf = (s: string) => Math.ceil(new TextEncoder().encode(s).length / 4)

/**
 * `fit_result_budget`: keep `r` (mutated) within `budget` tokens before the
 * dispatcher maps it; the summary takes at most a quarter. A result cut here
 * is not shown in full, so its dedup key is dropped.
 */
export function fitResultBudget(r: AgentToolResult, budget = RESULT_BUDGET_TOKENS): void {
  if (tokensOf(observationText(r)) <= budget) return
  const summaryBudget = Math.floor(budget / 4)
  if (tokensOf(r.summary) > summaryBudget) r.summary = clipToBudget(r.summary, summaryBudget)[0]
  if (r.status === 'error') {
    const rest = Math.max(0, budget - (tokensOf(rustTrim(r.summary)) + 1))
    if (r.output !== undefined) r.output = clipToBudget(r.output, rest, RESULT_BUDGET_MORE)[0]
  } else {
    r.output = clipToBudget(observationText(r), budget, RESULT_BUDGET_MORE)[0]
  }
  delete r.dedup
}

/** The envelope as `Observation.host` (`to_host`). */
export function toHost(r: AgentToolResult): JsonValue {
  return JSON.parse(JSON.stringify(r))
}
