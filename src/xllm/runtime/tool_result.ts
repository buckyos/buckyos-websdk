// The AgentToolResult envelope (`agent_tool/src/lib.rs`, protocol "1"): a
// tool may return it instead of a plain value to say it is still running as a
// task (`status: pending` + `task_id`), to attach hints, or to mark a result
// the model already saw (`dedup`). The observation carries it verbatim in
// `host`; the waist never reads it.

import type { JsonValue } from '../core/types'
import { canonicalJson, isObject } from '../core/json'
import { rustTrim } from '../core/rust_text'

export const AGENT_TOOL_PROTOCOL_VERSION = '1'

export type AgentToolStatus = 'success' | 'error' | 'pending'

export interface ResultHint {
  text: string
  /** Shown once per run (`hints_once` in run.json). */
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

/** The text the model sees (`AgentToolResult::observation_text`). */
export function observationText(r: AgentToolResult): string {
  if (r.status === 'error') {
    const summary = rustTrim(r.summary)
    const output = rustTrim(r.output ?? '') || undefined
    if (summary && output) return `${summary}\n${output}`
    if (summary) return summary
    if (output) return output
    return 'tool error'
  }
  if (r.output !== undefined && rustTrim(r.output)) return r.output
  return rustTrim(r.summary) ? r.summary : canonicalJson(r.detail)
}

/** The envelope as `Observation.host` (`to_host`). */
export function toHost(r: AgentToolResult): JsonValue {
  return JSON.parse(JSON.stringify(r))
}
