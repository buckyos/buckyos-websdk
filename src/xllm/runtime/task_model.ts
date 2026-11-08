// Tasks a tool's work became (`agent_tool/src/task_model.rs`). The loop never
// waits: a tool that returns `pending` + `task_id` is waited for inside the
// call, until the task ends, the runtime's wait budget (shortened, never
// lengthened, by the tool's `check_after`), the 30 minute cap or the run
// deadline — then the task's state comes back as an ordinary result.

import type { JsonValue, Observation } from '../core/types'
import { utf8Length } from '../core/tokenizer'
import { AGENT_TOOL_PROTOCOL_VERSION } from './tool_result'
import { rustTrim, rustTrimEnd } from '../core/rust_text'

export const MAX_IN_TOOL_WAIT_MS = 30 * 60_000
export const DEFAULT_TASK_WAIT_MS = 25_000

export interface TaskResult {
  success: boolean
  output: string
  tool_result?: JsonValue
}

export type TaskState =
  | { kind: 'running'; brief: string; elapsed_ms: number; output_tail?: string; cancellable: boolean }
  | ({ kind: 'finished' } & TaskResult)
  | { kind: 'unknown'; reason: string }

export interface TaskBrief {
  task_id: string
  brief: string
  status: string
  elapsed_ms: number
  last_line?: string
  cancellable: boolean
}

/** How the model follows a task that is still running. */
export type TaskFollowup = { kind: 'tools' } | { kind: 'command'; cli: string } | { kind: 'input'; cli?: string }

/** The task backend of a run (host-provided; `RunningTaskResolver`). */
export interface RunningTaskResolver {
  state(taskId: string): Promise<TaskState>
  /** Wait until the task ends or `untilMs` (epoch ms) passes. */
  wait(taskId: string, untilMs: number | undefined, signal?: AbortSignal): Promise<TaskState>
  cancel?(taskId: string): Promise<TaskState>
  /** Tasks of this run; a `running` one at a function-call reply pauses the run (`tasks_running`). */
  active(): Promise<TaskBrief[]>
  watch?(taskId: string): void
  followup?(): TaskFollowup
}

export function followupHint(f: TaskFollowup, taskId: string, cancellable: boolean): string {
  if (f.kind === 'tools') {
    let s = `Call \`wait_task\` with task_id="${taskId}" to keep waiting (wait_ms up to ${MAX_IN_TOOL_WAIT_MS / 60_000} min), or \`get_task_state\` to check later.`
    if (cancellable) s += ` \`cancel_task\` with task_id="${taskId}" stops it.`
    return s
  }
  if (f.kind === 'command') {
    let s = `Run \`${f.cli} wait ${taskId} --wait-ms <ms>\` to keep waiting (give the shell call a larger wait_ms than that), or \`${f.cli} state ${taskId}\` to check later.`
    if (cancellable) s += ` \`${f.cli} cancel ${taskId}\` stops it.`
    return s
  }
  let s = 'Its end comes back to you as input: do not check on it again. Reply with where things stand (that ends your turn), or go on with other work meanwhile.'
  if (cancellable) s += f.cli !== undefined ? ` \`${f.cli} cancel ${taskId}\` stops it.` : ` \`cancel_task\` with task_id="${taskId}" stops it.`
  return s
}

export function followupGeneralHint(f: TaskFollowup): string {
  if (f.kind === 'tools') {
    return `A task is followed with \`wait_task\` (task_id, wait_ms up to ${MAX_IN_TOOL_WAIT_MS / 60_000} min) to keep waiting, or \`get_task_state\` to check it later; \`cancel_task\` stops a cancellable task.`
  }
  if (f.kind === 'command') {
    return `A task is followed with \`${f.cli} wait <task_id> --wait-ms <ms>\` to keep waiting (give the shell call a larger wait_ms than that), or \`${f.cli} state <task_id>\` to check it later; \`${f.cli} cancel <task_id>\` stops a cancellable task.`
  }
  let s = "A task's end comes back to you as input with its full result, and its new output is shown to you before you answer: do not wait for it or check on it in a loop. When nothing else is to be done now, reply with where things stand — that ends your turn; the task's end starts the next one."
  s += f.cli !== undefined
    ? ` \`${f.cli} state <task_id>\` shows a task's output once when you need it; \`${f.cli} cancel <task_id>\` stops a cancellable one.`
    : ' `cancel_task` stops a cancellable one.'
  return s
}

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
}

function isRecord(v: unknown): v is Record<string, JsonValue> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const VIEW_OPTIONAL = ['cmd_name', 'cmd_args', 'output', 'return_code', 'task_id', 'partial_output', 'pending_reason', 'check_after']

/**
 * A result as `ToolResultView` serializes it (`into_host`): only the view's
 * fields, `title` / `summary` / `hints` omitted when empty, `detail` when
 * null or `{}`, the protocol version filled in.
 */
export function resultView(fields: Record<string, JsonValue | undefined>): JsonValue {
  const out: Record<string, JsonValue> = {
    agent_tool_protocol: typeof fields.agent_tool_protocol === 'string' ? fields.agent_tool_protocol : AGENT_TOOL_PROTOCOL_VERSION,
    status: fields.status === 'error' || fields.status === 'pending' ? fields.status : 'success',
  }
  for (const k of VIEW_OPTIONAL) {
    const v = fields[k]
    if (v !== undefined && v !== null) out[k] = v
  }
  if (typeof fields.title === 'string' && fields.title !== '') out.title = fields.title
  if (typeof fields.summary === 'string' && fields.summary !== '') out.summary = fields.summary
  const d = fields.detail
  if (d !== undefined && d !== null && !(isRecord(d) && Object.keys(d).length === 0)) out.detail = d
  if (Array.isArray(fields.hints) && fields.hints.length > 0) {
    out.hints = fields.hints.map(h => {
      const o: Record<string, JsonValue> = { text: isRecord(h) && typeof h.text === 'string' ? h.text : '' }
      if (isRecord(h) && typeof h.once === 'string') o.once = h.once
      return o
    })
  }
  return out
}

/** The observation of a task's state (`task_state_observation_via`). */
export function taskStateObservation(callId: string, taskId: string, state: TaskState, followup: TaskFollowup): Observation {
  if (state.kind === 'running') {
    let text = `task ${taskId} is still running (${fmtElapsed(state.elapsed_ms)}): ${state.brief}`
    const tail = state.output_tail ?? ''
    if (rustTrim(tail)) text += `\n--- output so far (tail) ---\n${rustTrimEnd(tail)}`
    text += `\n${followupHint(followup, taskId, state.cancellable)}`
    return {
      kind: 'success', call_id: callId, content: text, bytes: utf8Length(text), truncated: false,
      host: resultView({ status: 'success', summary: `task ${taskId} still running`, task_id: taskId, partial_output: tail || undefined }),
    }
  }
  if (state.kind === 'finished') {
    const base: Record<string, JsonValue> = isRecord(state.tool_result) ? { ...state.tool_result } : {}
    base.task_id = taskId
    if (state.success) {
      base.status = 'success'
      return { kind: 'success', call_id: callId, content: state.output, bytes: utf8Length(state.output), truncated: false, host: resultView(base) }
    }
    base.status = 'error'
    return { kind: 'error', call_id: callId, message: rustTrim(state.output) ? state.output : `task ${taskId} failed`, host: resultView(base) }
  }
  return {
    kind: 'error', call_id: callId,
    message: `task ${taskId}: state unknown (${state.reason}). Its result was not recorded; check the actual state (files, processes, logs) before repeating the work.`,
    host: resultView({ status: 'error', summary: `task ${taskId} state unknown`, task_id: taskId }),
  }
}

/** When an in-call wait ends: the budget, capped at 30 minutes and the run deadline. */
export function waitUntilMs(nowMs: number, waitMs: number | undefined, deadlineMs: number | undefined): number {
  let until = nowMs + (waitMs ?? MAX_IN_TOOL_WAIT_MS)
  until = Math.min(until, nowMs + MAX_IN_TOOL_WAIT_MS)
  if (deadlineMs !== undefined) until = Math.min(until, deadlineMs)
  return until
}

/** The in-call wait for a pending result: `min(check_after, budget)` (check_after only shortens). */
export function inCallWaitMs(checkAfterSecs: number | undefined, budgetMs: number): number {
  return checkAfterSecs === undefined ? budgetMs : Math.min(checkAfterSecs * 1000, budgetMs)
}
