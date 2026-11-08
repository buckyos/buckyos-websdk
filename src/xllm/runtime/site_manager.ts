// Dispatcher of page-provided tools: arguments are checked against the spec,
// results become observations (a plain value, or an AgentToolResult
// envelope with hints / dedup / a pending task), and a call a previous
// executor may have started is recovered by call id (idempotent tools run
// again, the rest get `unresolved` with the runtime's account).

import type { AiToolCall, JsonValue, Observation, ToolSpecLite } from '../core/types'
import type { ToolCallCtx } from '../core/deps'
import { validateJson } from '../core/json_check'
import { canonicalJson, isObject } from '../core/json'
import { utf8Length } from '../core/tokenizer'
import { nowMs } from '../core/messages'
import type { RunBinding, RunToolManager, SiteTool, SiteToolCtx } from './types'
import { asToolResult, observationText, toHost } from './tool_result'
import type { AgentToolResult } from './tool_result'
import { HINT_NS_DEDUP, MemoryHintLedger, applyHints, renderWithHints } from './hints'
import type { HintLedger } from './hints'
import { DEFAULT_TASK_WAIT_MS, inCallWaitMs, taskStateObservation, waitUntilMs } from './task_model'
import type { RunningTaskResolver, TaskState } from './task_model'
import { rustTrim } from '../core/rust_text'

function resultText(value: unknown): string {
  if (value === undefined || value === null) return 'ok'
  if (typeof value === 'string') return value
  try {
    const text = canonicalJson(value)
    return text === undefined ? String(value) : text
  } catch {
    return String(value)
  }
}

export function isIdempotent(tool: SiteTool, args: Record<string, JsonValue>): boolean {
  return typeof tool.idempotent === 'function' ? tool.idempotent(args) : tool.idempotent === true
}

function causeName(cause: string | undefined): string {
  return cause === 'deadline' ? 'Deadline' : cause === 'finishing' ? 'Finishing' : 'Interrupted'
}

/** The observation of an envelope, hints shown after its text (`map_result_to_observation_with_hints`). */
export function envelopeObservation(callId: string, result: AgentToolResult, hints: string[]): Observation {
  const host = toHost(result)
  const text = renderWithHints(observationText(result), hints)
  if (result.status === 'error') return { kind: 'error', call_id: callId, message: text, host }
  const truncated = isObject(result.detail) && result.detail.output_truncated === true
  return { kind: 'success', call_id: callId, content: text, bytes: utf8Length(text), truncated, host }
}

export interface SiteManagerOptions {
  /** The run's task backend (`XllmDeps.tasks`): pending results are waited for through it. */
  tasks?: RunningTaskResolver
  /** In-call wait budget for a pending task (`runtime.task_wait_ms`). */
  taskWaitMs?: number
  hints?: HintLedger
}

export class SiteToolManager implements RunToolManager {
  private binding: RunBinding = { run_id: '' }
  private recovering: { callId: string; reason: string } | undefined
  private readonly ledger: HintLedger
  private readonly taskWaitMs: number

  constructor(private readonly tools: Map<string, SiteTool>, private readonly options: SiteManagerOptions = {}) {
    this.ledger = options.hints ?? new MemoryHintLedger()
    this.taskWaitMs = options.taskWaitMs ?? DEFAULT_TASK_WAIT_MS
  }

  bindRun(binding: RunBinding) {
    this.binding = { ...binding }
  }

  setRecovering(callId: string, reason: string) {
    this.recovering = { callId, reason }
  }

  artifacts(): string[] {
    return []
  }

  has(name: string): boolean {
    return this.tools.has(name)
  }

  hintLedger(): HintLedger {
    return this.ledger
  }

  clearDedup() {
    this.ledger.clear(HINT_NS_DEDUP)
  }

  taskResolver(): RunningTaskResolver | undefined {
    return this.options.tasks
  }

  listToolSpecs(): ToolSpecLite[] {
    return [...this.tools.entries()].map(([name, t]) => ({ name, description: t.spec.description, args_schema: t.spec.args_schema }))
  }

  private takeRecovering(callId: string): string | undefined {
    if (this.recovering?.callId !== callId) return undefined
    const reason = this.recovering.reason
    this.recovering = undefined
    return reason
  }

  async callTool(call: AiToolCall, ctx: ToolCallCtx): Promise<Observation> {
    const callId = call.call_id
    const tool = this.tools.get(call.name)
    if (!tool) {
      return {
        kind: 'error', call_id: callId,
        message: `tool \`${call.name}\` is not available in this run (available: ${[...this.tools.keys()].join(', ')})`,
      }
    }
    const args = call.args ?? {}
    const invalid = validateJson(tool.spec.args_schema, args)
    if (invalid) return { kind: 'error', call_id: callId, message: `invalid arguments for \`${call.name}\`: ${invalid}` }
    const recovering = this.takeRecovering(callId)
    if (recovering !== undefined && !isIdempotent(tool, args)) {
      return { kind: 'unresolved', call_id: callId, reason: recovering, effect_unknown: true }
    }
    const toolCtx: SiteToolCtx = { run_id: this.binding.run_id, call_id: callId, signal: ctx.signal }
    let running: Promise<{ ok: unknown } | { err: unknown }>
    try {
      running = Promise.resolve(tool.call(args, toolCtx)).then(ok => ({ ok }), err => ({ err }))
    } catch (err) {
      running = Promise.resolve({ err })
    }
    let settled: { ok: unknown } | { err: unknown }
    if (tool.cancellable) {
      settled = await running
      if ('err' in settled && ctx.signal.aborted) {
        return { kind: 'cancelled', call_id: callId, reason: `tool \`${call.name}\` was cancelled (${causeName(ctx.cause())})`, effect_unknown: false }
      }
    } else {
      const hard = ctx.cancelledHard().then(cause => ({ cancelled: cause }))
      const first = await Promise.race([running, hard])
      if ('cancelled' in first) {
        return {
          kind: 'cancelled', call_id: callId,
          reason: `tool \`${call.name}\` was abandoned while running (${causeName(first.cancelled)}); it cannot be cancelled, so its effect is unknown`,
          effect_unknown: true,
        }
      }
      settled = first
    }
    if ('err' in settled) {
      const e = settled.err
      return { kind: 'error', call_id: callId, message: e instanceof Error ? e.message : String(e) }
    }
    const envelope = asToolResult(settled.ok)
    if (!envelope) {
      const text = resultText(settled.ok)
      return { kind: 'success', call_id: callId, content: text, bytes: utf8Length(text), truncated: false }
    }
    const observation = envelope.status === 'pending'
      ? await this.waitPending(call.name, callId, envelope, ctx)
      : envelopeObservation(callId, envelope, applyHints(envelope, this.ledger))
    const host = observation.kind === 'success' || observation.kind === 'error' ? observation.host : undefined
    const taskId = isObject(host) && typeof host.task_id === 'string' ? rustTrim(host.task_id) : ''
    if (taskId) this.options.tasks?.watch?.(taskId)
    return observation
  }

  /** A pending result: wait in the call within the budget, then the task's state. */
  private async waitPending(tool: string, callId: string, result: AgentToolResult, ctx: ToolCallCtx): Promise<Observation> {
    const taskId = rustTrim(result.task_id ?? '')
    if (!taskId) {
      return { kind: 'error', call_id: callId, message: `tool \`${tool}\` returned a pending result without a task_id`, host: toHost(result) }
    }
    const tasks = this.options.tasks
    const followup = tasks?.followup?.() ?? { kind: 'tools' as const }
    if (!tasks) {
      return taskStateObservation(callId, taskId, { kind: 'unknown', reason: 'this runtime has no task backend' }, followup)
    }
    const until = waitUntilMs(nowMs(), inCallWaitMs(result.check_after, this.taskWaitMs), ctx.deadline_ms)
    const stop = new AbortController()
    const waited = tasks.wait(taskId, until, stop.signal).then(state => ({ state }), e => ({
      state: { kind: 'unknown', reason: e instanceof Error ? e.message : String(e) } as TaskState,
    }))
    const first = await Promise.race([waited, ctx.cancelled().then(cause => ({ cause }))])
    if ('cause' in first) {
      stop.abort()
      return {
        kind: 'cancelled', call_id: callId,
        reason: `stopped waiting for task ${taskId} (${causeName(first.cause)}); the task itself continues`, effect_unknown: false,
      }
    }
    return taskStateObservation(callId, taskId, first.state, followup)
  }
}
