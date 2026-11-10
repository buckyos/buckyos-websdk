// The LLMContext waist (`llm_context/src/context_loop.rs`): runs one bounded
// LLM execution to an outcome. A Round is one inference; a tool iteration is
// one completed native tool batch (or one behavior step with actions).
//
// - Provider failures end the run; the waist never re-infers on its own.
// - Output-protocol violations, tool business failures and policy
//   rejections are fed back for bounded self-correction.
// - Runtime failures (checkpoint, dispatch) stop further side effects, keep
//   the results obtained and hand the run back with the snapshot intact.
// - The calls of one response are dispatched in order, each after a
//   checkpoint; a resumed snapshot dispatches the calls without a result
//   again and the tool manager decides by call id what that means.
// - Nothing waits inside the loop: every tool call returns a terminal
//   observation.

import type {
  AiMessage, AiResponse, AiToolCall, AiUsage, CancelCause, ContextLimitKind, ContextOutput, ContextRunTrace, Injection,
  InjectionPosition, LLMBehaviorResult, LLMComputeError, LLMContextOutcome, LLMContextRequest, LLMContextSnapshot, LLMContextState,
  LlmInferenceRequest, Observation, ResumeFill, StepRecord, Suspension, ToolExecRecord, ToolExecStatus, ToolSpecLite,
} from './types'
import type { JsonValue } from './types'
import {
  MAX_INJECTIONS_PER_BOUNDARY, ResolvedDeps, ToolCallCtx, ToolDispatchException, resolveDeps, resolveToolSpecs,
} from './deps'
import type { LLMContextDeps } from './deps'
import { AbortState, LLMContextInterruptHandle } from './interrupt'
import { checkLimits, contextLimitsOf, estimateRequest, limitsActive } from './context_window'
import { LLMComputeException, asComputeError, computeErrorMessage, llmCorrectable } from './errors'
import { validateBehaviorResult } from './behavior_result'
import { applyFill, hasContinuation } from './suspension'
import { cloneJson, jsonEqual } from './json'
import { mergeUsage, nowMs, textContent, textMessage, toolCalls, toolObservationMessage, validateResponse } from './messages'
import { checkReply, repairMessage } from './json_check'
import { runBehavior } from './behavior_loop'

/** Current snapshot format; `resume` accepts only this version. */
export const SNAPSHOT_FORMAT_VERSION = 6
export const DEFAULT_WRAP_UP_ROUNDS = 2

const FINISHING_SKIP_REASON = 'not executed: the run is finishing'
const INTERRUPTED_SKIP_REASON = 'not executed: the run was interrupted'

export function stateFromRequest(req: LLMContextRequest, startedAtMs: number): LLMContextState {
  return {
    accumulated: cloneJson(req.input),
    usage: {},
    tool_iterations_left: req.tool_policy.max_tool_iterations,
    started_at_ms: startedAtMs,
    cost_units: 0,
    consecutive_errors: 0,
    report_end: false,
    next_step_index: 0,
    next_action_id: 0,
    snapshot_version: SNAPSHOT_FORMAT_VERSION,
  }
}

function emptyTrace(): ContextRunTrace {
  return { trace_id: '', latency_ms: 0 }
}

type Timer = ReturnType<typeof setTimeout>

export class LLMContext {
  /** @internal */ request: LLMContextRequest
  /** @internal */ state: LLMContextState
  /** @internal */ readonly deps: ResolvedDeps
  /** @internal */ toolTrace: ToolExecRecord[] = []
  /** @internal */ lastResponse: AiResponse = { message: textMessage('assistant', '') }
  /** @internal */ readonly abort: AbortState
  /** @internal Behavior step inner contexts: parser of native reports, outer hook and parent snapshot. */
  nativeResultParser?: ResolvedDeps['resultParser']
  /** @internal */ toolCheckpointHook?: ResolvedDeps['checkpointHook']
  /** @internal */ innerParent?: { parent: LLMContextSnapshot; prefixLen: number }

  constructor(request: LLMContextRequest, deps: LLMContextDeps, abort?: AbortState) {
    if (deps.resultParser && !deps.stepRenderer) throw new Error('LLMContext: resultParser requires stepRenderer')
    this.request = cloneJson(request)
    this.state = stateFromRequest(this.request, nowMs())
    this.deps = resolveDeps(deps)
    this.abort = abort ?? new AbortState()
  }

  /**
   * Resume from a snapshot. `fill` must match the snapshot's suspension;
   * everything is validated before the context exists (rejects with an
   * `LLMComputeException` carrying `snapshot_corrupted`).
   */
  static resume(snapshot: LLMContextSnapshot, fill: ResumeFill, deps: LLMContextDeps): LLMContext {
    const request = cloneJson(snapshot.request)
    const state = cloneJson(snapshot.state)
    if (state.snapshot_version !== SNAPSHOT_FORMAT_VERSION) {
      throw new LLMComputeException({
        kind: 'snapshot_corrupted',
        message: `unsupported snapshot format version ${state.snapshot_version} (this build only supports ${SNAPSHOT_FORMAT_VERSION})`,
      })
    }
    applyFill(request, state, cloneJson(fill), !!deps.resultParser, nowMs())
    const ctx = new LLMContext(request, deps)
    ctx.request = request
    ctx.state = state
    return ctx
  }

  interruptHandle(): LLMContextInterruptHandle {
    return new LLMContextInterruptHandle(this.abort)
  }

  snapshot(): LLMContextSnapshot {
    const state = cloneJson(this.state)
    state.snapshot_version = SNAPSHOT_FORMAT_VERSION
    return { request: cloneJson(this.request), state }
  }

  suspension(): Suspension | undefined {
    return this.state.suspended
  }

  hostMeta(): JsonValue | undefined {
    return this.state.host
  }

  setHostMeta(host: JsonValue | undefined) {
    this.state.host = host
  }

  /** @internal */ isBehaviorMode(): boolean {
    return !!this.deps.resultParser
  }

  /**
   * Append user messages to the live context (between runs, or from the
   * checkpoint hook at an inference boundary). Only valid at an inference
   * boundary: suspended or mid-batch, nothing is placed.
   */
  inject(injection: Injection): InjectionPosition {
    if (this.state.suspended || hasContinuation(this.state)) return { kind: 'none' }
    if (injection.host !== undefined) this.state.host = injection.host
    const messages = injection.messages.filter(m => m.content.length > 0)
    if (messages.length === 0) return { kind: 'none' }
    if (!this.isBehaviorMode()) {
      const at = this.state.accumulated.length
      this.state.accumulated.push(...cloneJson(messages))
      return { kind: 'accumulated', at }
    }
    const behaviorName = this.request.behavior_name ?? ''
    let target: StepRecord | undefined = this.state.last_step
    if (!target) {
      const last = this.state.steps?.[this.state.steps.length - 1]
      if (last && (last.meta.behavior_name ?? '') === behaviorName) target = last
    }
    if (target) {
      const base = target.next_user_message ?? (this.deps.stepRenderer ? this.deps.stepRenderer.render(target)[1] : textMessage('user', ''))
      const merged: AiMessage = { role: base.role, content: [...base.content] }
      for (const m of messages) merged.content.push(...cloneJson(m.content))
      target.next_user_message = merged
      return { kind: 'step', step_index: target.meta.step_index }
    }
    const at = this.request.input.length
    const prefixOk = this.state.accumulated.length >= at && jsonEqual(this.state.accumulated.slice(0, at), this.request.input)
    this.request.input.push(...cloneJson(messages))
    if (prefixOk) {
      const tail = this.state.accumulated.splice(at)
      this.state.accumulated.push(...cloneJson(messages), ...tail)
    }
    return { kind: 'request_input', at }
  }

  /** @internal Run the checkpoint hook at an inference boundary; an outcome stops the run. */
  async runCheckpointHook(): Promise<LLMContextOutcome | undefined> {
    const hook = this.deps.checkpointHook
    if (!hook) return undefined
    let injections = 0
    for (;;) {
      let result: Injection | undefined
      try {
        result = await hook.beforeInference(this.snapshot())
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        await this.emit({ kind: 'checkpoint_failed', trace_id: this.request.trace, stage: 'before_inference', error: message })
        return this.finishError({ kind: 'checkpoint', stage: 'before_inference', message })
      }
      if (!result) return undefined
      injections += 1
      if (injections > MAX_INJECTIONS_PER_BOUNDARY) {
        return this.finishError({
          kind: 'checkpoint',
          stage: 'before_inference',
          message: `checkpoint hook injected more than ${MAX_INJECTIONS_PER_BOUNDARY} times at one boundary`,
        })
      }
      this.inject(result)
    }
  }

  /** Run the loop until an outcome is produced. */
  async run(): Promise<LLMContextOutcome> {
    await this.emit({ kind: 'llm_started', trace_id: this.request.trace, model: this.request.model_policy.preferred })
    let outcome: LLMContextOutcome
    const limits = contextLimitsOf(this.request)
    if (this.state.suspended) {
      outcome = this.refuse('run() on a context suspended by ContextLimitReached; resume it with a rewritten history')
    } else if (typeof limits === 'string') {
      outcome = this.refuse(`invalid context limits: ${limits}`)
    } else if (this.isBehaviorMode()) {
      outcome = await runBehavior(this)
    } else {
      outcome = await this.runInner()
    }
    await this.emit({ kind: 'llm_finished', trace_id: this.request.trace, ok: outcome.kind === 'done' })
    return outcome
  }

  /** @internal The function call loop. */
  async runInner(): Promise<LLMContextOutcome> {
    for (;;) {
      if (this.state.tool_batch) {
        const outcome = await this.runToolBatch()
        if (outcome) return outcome
        continue
      }
      if (this.abort.isFinishing() && !this.abort.isAborted()) return this.finishSettled()
      const budget = this.checkWallclockBudget()
      if (budget) return budget
      const hooked = await this.runCheckpointHook()
      if (hooked) return hooked

      const before = this.snapshot()
      if (this.abort.isAborted()) return this.finishInterrupted(before, nowMs())

      const req = this.buildInferenceRequest()
      const limits = contextLimitsOf(this.request)
      if (typeof limits !== 'string' && limitsActive(limits)) {
        const estimated = estimateRequest(this.deps.tokenizer, req)
        const which = checkLimits(limits, estimated)
        if (which) return this.suspendContextLimit(which, estimated, cloneJson(this.state.accumulated))
      }

      const result = await this.infer(req)
      if (result.kind === 'aborted') return this.finishInterrupted(before, nowMs())
      if (result.kind === 'error') {
        if (this.abort.isAborted()) return this.finishInterrupted(before, nowMs())
        await this.emit({ kind: 'llm_inference_failed', trace_id: this.request.trace, error: computeErrorMessage(result.error) })
        if (result.error.kind === 'provider' && result.error.failure === 'context_limit') {
          return this.suspendContextLimit('provider_refused', undefined, cloneJson(this.state.accumulated))
        }
        return this.finishError(result.error)
      }
      const response = result.response
      const invalid = validateResponse(response)
      if (invalid) return this.finishError({ kind: 'internal', message: `invalid LLM response: ${invalid}` })

      this.accountResponse(response)
      this.lastResponse = response
      const tokens = this.checkTokenBudget()
      if (tokens) return tokens

      const calls = toolCalls(response.message)
      const assistantText = textContent(response.message)

      if (calls.length > 0 && this.nativeResultParser) {
        let message: string | undefined
        try {
          const parsed = this.nativeResultParser.parse(response)
          const invalidResult = validateBehaviorResult(parsed)
          if (invalidResult) throw new Error(invalidResult)
          await this.acceptNativeReport(parsed)
        } catch (e) {
          message = e instanceof Error ? e.message : String(e)
        }
        if (message !== undefined) {
          this.rejectToolBatch(response.message, calls, message)
          await this.emit({ kind: 'output_parse_failed', trace_id: this.request.trace, error: message })
          const out = this.bumpConsecutiveErrors({ kind: 'output_parse', message })
          if (out) return out
          continue
        }
      }

      if (calls.length === 0 || this.request.tool_policy.mode === 'none') {
        const done = await this.finishDone(response)
        if (done) return done
        continue
      }

      if (this.state.tool_iterations_left === 0 && !this.admitsWrapUp(calls.map(c => c.name))) {
        return {
          kind: 'budget_exhausted',
          which: 'tool_iterations',
          partial: { kind: 'text', content: assistantText },
          usage: cloneJson(this.state.usage),
        }
      }

      if (calls.length > this.request.tool_policy.max_calls_per_round) {
        const reason = `tool calls ${calls.length} exceed max_calls_per_round ${this.request.tool_policy.max_calls_per_round}`
        this.rejectToolBatch(response.message, calls, reason)
        const out = this.handleError({ kind: 'policy_rejected', message: reason })
        if (out) return out
        continue
      }

      let gated: AiToolCall[]
      try {
        gated = await this.deps.policy.gateToolCalls(this.request, cloneJson(calls))
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        this.rejectToolBatch(response.message, calls, `policy rejected: ${msg}`)
        const out = this.handleError({ kind: 'policy_rejected', message: msg })
        if (out) return out
        continue
      }

      if (this.state.tool_iterations_left === 0) this.state.wrap_up_rounds_used = (this.state.wrap_up_rounds_used ?? 0) + 1
      this.state.accumulated.push(cloneJson(response.message))
      this.state.tool_batch = { remaining: gated }
    }
  }

  /** @internal One inference raced against the interrupt. */
  async infer(req: LlmInferenceRequest): Promise<
    { kind: 'ok'; response: AiResponse } | { kind: 'error'; error: LLMComputeError } | { kind: 'aborted' }
  > {
    const aborted = this.abort.aborted().then(() => ({ kind: 'aborted' as const }))
    let call: Promise<AiResponse>
    try {
      call = Promise.resolve(this.deps.llm.infer(req))
    } catch (e) {
      call = Promise.reject(e)
    }
    const settled = call.then(
      response => ({ kind: 'ok' as const, response }),
      error => ({ kind: 'error' as const, error: asComputeError(error) }),
    )
    return Promise.race([aborted, settled])
  }

  private async acceptNativeReport(result: LLMBehaviorResult): Promise<void> {
    if (result.self_report === undefined || !this.innerParent) return
    const snapshot = this.toolCheckpointSnapshot()
    if (this.toolCheckpointHook?.validateReport) {
      await this.toolCheckpointHook.validateReport(snapshot, result, snapshot.state.next_step_index)
    }
    const step: StepRecord = {
      meta: {
        behavior_name: snapshot.request.behavior_name || undefined,
        step_index: snapshot.state.next_step_index,
        started_at_ms: nowMs(),
        ended_at_ms: nowMs(),
        compression_level: 'full',
      },
      assistant_text: result.assistant_text,
      observation: result.observation,
      thought: result.thought,
      self_report: result.self_report,
      report_end: result.report_end,
      report_result: result.report_result,
    }
    const parent = this.innerParent.parent
    parent.state.next_step_index += 1
    parent.state.last_report = step.self_report
    parent.state.report_end = false
    const steps = parent.state.steps ?? []
    if (parent.state.last_step) {
      steps.push(parent.state.last_step)
      parent.state.last_step = undefined
    }
    steps.push(step)
    parent.state.steps = steps
    await this.emit({ kind: 'self_report_set', trace_id: this.request.trace, chars: [...(step.self_report ?? '')].length })
  }

  /** @internal The outer snapshot handed to the hook before a tool call. */
  toolCheckpointSnapshot(): LLMContextSnapshot {
    if (!this.innerParent) return this.snapshot()
    const outer = cloneJson(this.innerParent.parent)
    outer.state.accumulated = outer.state.accumulated.slice(0, outer.request.input.length)
    outer.state.accumulated.push(...cloneJson(this.state.accumulated.slice(this.innerParent.prefixLen)))
    outer.state.tool_batch = cloneJson(this.state.tool_batch)
    outer.state.usage = cloneJson(this.state.usage)
    outer.state.consecutive_errors = this.state.consecutive_errors
    outer.state.tool_iterations_left = this.state.tool_iterations_left
    outer.state.wrap_up_rounds_used = this.state.wrap_up_rounds_used
    return outer
  }

  /** @internal */
  async checkpointBeforeToolCall(): Promise<LLMContextOutcome | undefined> {
    const hook = this.toolCheckpointHook ?? this.deps.checkpointHook
    if (!hook?.beforeToolCall) return undefined
    try {
      await hook.beforeToolCall(this.toolCheckpointSnapshot())
      return undefined
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return this.finishError({ kind: 'checkpoint', stage: 'before_tool_call', message })
    }
  }

  /**
   * Dispatch `state.tool_batch` serially, each call after a checkpoint.
   * Business errors do not stop the batch; infrastructure failures do and
   * the calls that never ran are answered as `unresolved`.
   */
  private async runToolBatch(): Promise<LLMContextOutcome | undefined> {
    for (;;) {
      if (this.abort.isFinishing() && !this.abort.isAborted()) {
        this.cancelToolBatch(this.takeBatchRest(), FINISHING_SKIP_REASON)
        return this.finishSettled()
      }
      if ((this.state.tool_batch?.remaining ?? []).length > 0) {
        const out = await this.checkpointBeforeToolCall()
        if (out) return out
      }
      const batch = this.state.tool_batch
      if (!batch || !batch.remaining || batch.remaining.length === 0) break
      const call = batch.remaining.shift() as AiToolCall
      if (batch.remaining.length === 0) delete batch.remaining
      const started = nowMs()
      await this.emit({ kind: 'tool_call_planned', trace_id: this.request.trace, tool: call.name, call_id: call.call_id, args: call.args })
      const { ctx, release } = this.toolCallCtx()
      let dispatched: { ok: Observation } | { err: ToolDispatchException }
      try {
        dispatched = await this.dispatchTool(call, ctx)
      } finally {
        release()
      }
      const duration = nowMs() - started

      if ('err' in dispatched) {
        const d = dispatched.err
        await this.emit({
          kind: 'tool_dispatch_failed', trace_id: this.request.trace, tool: call.name, call_id: call.call_id,
          message: d.message, effect_unknown: d.effect_unknown,
        })
        this.recordTool(call, d.effect_unknown ? 'unknown' : 'not_executed', duration, d.message)
        this.state.accumulated.push(toolObservationMessage(call.call_id, {
          kind: 'unresolved', call_id: call.call_id, reason: d.message, effect_unknown: d.effect_unknown,
        }))
        this.abortToolBatch(this.takeBatchRest(), 'not executed: dispatch of an earlier call in this batch failed')
        return this.finishError({
          kind: 'tool_runtime', tool: call.name, call_id: call.call_id, message: d.message, effect_unknown: d.effect_unknown,
        })
      }

      const observation = dispatched.ok
      switch (observation.kind) {
        case 'success':
          this.state.accumulated.push(toolObservationMessage(call.call_id, observation))
          this.recordTool(call, 'succeeded', duration)
          await this.emit({ kind: 'tool_call_finished', trace_id: this.request.trace, tool: call.name, call_id: call.call_id, ok: true, duration_ms: duration })
          break
        case 'error':
          this.state.accumulated.push(toolObservationMessage(call.call_id, observation))
          this.recordTool(call, 'failed', duration, observation.message)
          await this.emit({ kind: 'tool_call_failed', trace_id: this.request.trace, tool: call.name, call_id: call.call_id, message: observation.message })
          if (this.state.tool_batch && !this.state.tool_batch.batch_error) {
            this.state.tool_batch.batch_error = { kind: 'tool_failed', tool: call.name, call_id: call.call_id, message: observation.message }
          }
          break
        case 'cancelled': {
          const cause = ctx.cause()
          if (!cause) {
            const message = 'tool returned Cancelled inline without an interrupt, finish or deadline'
            this.abortStartedCall(call, this.takeBatchRest(), message, duration)
            return this.finishError({ kind: 'internal', message })
          }
          this.state.accumulated.push(toolObservationMessage(call.call_id, observation))
          this.recordTool(call, 'cancelled', duration, observation.reason)
          const rest = this.takeBatchRest()
          if (cause === 'finishing') this.cancelToolBatch(rest, FINISHING_SKIP_REASON)
          else this.abortToolBatch(rest, INTERRUPTED_SKIP_REASON)
          return this.stopAfterCancel(cause)
        }
        case 'unresolved':
          this.state.accumulated.push(toolObservationMessage(call.call_id, observation))
          this.recordTool(call, observation.effect_unknown ? 'unknown' : 'not_executed', duration, observation.reason)
          break
      }
    }
    const batch = this.state.tool_batch ?? {}
    this.state.tool_batch = undefined
    if (batch.batch_error) {
      const out = this.bumpConsecutiveErrors(batch.batch_error)
      if (out) return out
    } else {
      this.state.consecutive_errors = 0
    }
    this.state.tool_iterations_left = Math.max(0, this.state.tool_iterations_left - 1)
    return undefined
  }

  /** @internal End the batch in progress, returning its undispatched calls. */
  takeBatchRest(): AiToolCall[] {
    const rest = this.state.tool_batch?.remaining ?? []
    this.state.tool_batch = undefined
    return rest
  }

  /** @internal Context of one tool call; `release` clears its timers. */
  toolCallCtx(): { ctx: ToolCallCtx; release: () => void } {
    const abort = this.abort
    const maxWall = this.request.budget.max_wallclock_ms
    const deadline = maxWall === null || maxWall === undefined ? undefined : this.state.started_at_ms + maxWall
    const controller = new AbortController()
    const timers: Timer[] = []
    const onAbort = () => controller.abort()
    if (abort.signal.aborted) controller.abort()
    else abort.signal.addEventListener('abort', onAbort)
    let deadlineHit: Promise<void> = new Promise(() => {})
    // The timer can fire up to ~1 ms before `nowMs()` reaches `deadline`
    // (timer clock and Date.now() round differently), so `cause()` trusts the
    // timer too; otherwise the deadline abort reads as a cancel with no cause.
    let deadlineFired = false
    if (deadline !== undefined) {
      deadlineHit = new Promise(resolve => {
        timers.push(setTimeout(() => {
          deadlineFired = true
          controller.abort()
          resolve()
        }, Math.max(0, deadline - nowMs())))
      })
    }
    const cause = (): CancelCause | undefined => {
      if (abort.isAborted()) return 'interrupted'
      if (deadline !== undefined && (deadlineFired || nowMs() >= deadline)) return 'deadline'
      if (abort.isFinishing()) return 'finishing'
      return undefined
    }
    const ctx: ToolCallCtx = {
      signal: controller.signal,
      deadline_ms: deadline,
      cause,
      cancelled: () => Promise.race([abort.stopping(), deadlineHit]).then(() => cause() ?? 'interrupted'),
      cancelledHard: () => Promise.race([abort.aborted(), deadlineHit]).then(() => (abort.isAborted() ? 'interrupted' : 'deadline')),
    }
    return {
      ctx,
      release: () => {
        timers.forEach(t => clearTimeout(t))
        abort.signal.removeEventListener('abort', onAbort)
      },
    }
  }

  /**
   * Dispatch one call. A graceful finish requested while the tool runs
   * becomes an interrupt once `finish_grace_ms` passed without the tool
   * returning.
   */
  async dispatchTool(call: AiToolCall, ctx: ToolCallCtx): Promise<{ ok: Observation } | { err: ToolDispatchException }> {
    const abort = this.abort
    const grace = this.request.tool_policy.finish_grace_ms
    let timer: Timer | undefined
    let done = false
    abort.stopping().then(() => {
      if (done || abort.isAborted()) return
      timer = setTimeout(() => {
        if (!done && !abort.isAborted()) abort.set('graceful finish: the running tool did not stop in time')
      }, grace)
    })
    try {
      return { ok: await this.deps.tools.callTool(cloneJson(call), ctx) }
    } catch (e) {
      if (e instanceof ToolDispatchException) return { err: e }
      return { err: new ToolDispatchException(e instanceof Error ? e.message : String(e), true) }
    } finally {
      done = true
      if (timer) clearTimeout(timer)
    }
  }

  /** @internal After a legitimate inline `cancelled`: end the run according to `cause`. */
  stopAfterCancel(cause: CancelCause): LLMContextOutcome {
    if (cause === 'interrupted') return this.finishInterruptedAfterTool()
    if (cause === 'deadline') return { kind: 'budget_exhausted', which: 'wallclock', usage: cloneJson(this.state.usage) }
    return this.finishSettled()
  }

  /** @internal */
  finishInterruptedAfterTool(): LLMContextOutcome {
    const now = nowMs()
    const reason = this.abort.reason() ?? 'interrupted'
    this.takeTrace()
    return {
      kind: 'interrupted', reason, usage: cloneJson(this.state.usage), snapshot: this.snapshot(),
      abort: { reason, requested_at_ms: now, observed_at_ms: now, provider_cancel_supported: true },
    }
  }

  /** @internal */
  finishSettled(): LLMContextOutcome {
    const reason = this.abort.reason() ?? 'finished'
    const trace = this.takeTrace()
    return { kind: 'settled', reason, usage: cloneJson(this.state.usage), snapshot: this.snapshot(), trace }
  }

  /** @internal Answer `remaining` with `cancelled { effect_unknown: false }` (never started). */
  cancelToolBatch(remaining: AiToolCall[], reason: string) {
    for (const call of remaining) {
      this.recordTool(call, 'not_executed', 0, reason)
      this.state.accumulated.push(toolObservationMessage(call.call_id, { kind: 'cancelled', call_id: call.call_id, reason, effect_unknown: false }))
    }
  }

  /** @internal Suspend with `context_limit_reached` at an inference boundary. */
  suspendContextLimit(which: ContextLimitKind, estimated: number | undefined, history: AiMessage[]): LLMContextOutcome {
    this.state.suspended = estimated === undefined ? { which, at_ms: nowMs() } : { which, estimated_tokens: estimated, at_ms: nowMs() }
    const trace = this.takeTrace()
    return {
      kind: 'context_limit_reached', which, usage: cloneJson(this.state.usage), accumulated: history, snapshot: this.snapshot(), trace,
    }
  }

  /** @internal An `error` for a run that must not start; leaves the state untouched. */
  refuse(message: string): LLMContextOutcome {
    return { kind: 'error', error: { kind: 'internal', message }, usage: cloneJson(this.state.usage), trace: emptyTrace() }
  }

  /** @internal */
  recordTool(call: AiToolCall, status: ToolExecStatus, durationMs: number, error?: string) {
    const rec: ToolExecRecord = { tool_name: call.name, call_id: call.call_id, status, duration_ms: durationMs }
    if (error !== undefined) rec.error = error
    this.toolTrace.push(rec)
  }

  /** @internal Answer `remaining` with `unresolved { effect_unknown: false }`. */
  abortToolBatch(remaining: AiToolCall[], reason: string) {
    for (const call of remaining) {
      this.recordTool(call, 'not_executed', 0, reason)
      this.state.accumulated.push(toolObservationMessage(call.call_id, { kind: 'unresolved', call_id: call.call_id, reason, effect_unknown: false }))
    }
  }

  private abortStartedCall(call: AiToolCall, rest: AiToolCall[], message: string, durationMs: number) {
    this.recordTool(call, 'unknown', durationMs, message)
    this.state.accumulated.push(toolObservationMessage(call.call_id, { kind: 'unresolved', call_id: call.call_id, reason: message, effect_unknown: true }))
    this.abortToolBatch(rest, 'not executed: an earlier call in this batch broke the observation contract')
  }

  /** @internal Push the assistant message and answer each call with an error carrying `reason`. */
  rejectToolBatch(message: AiMessage, calls: AiToolCall[], reason: string) {
    this.state.accumulated.push(cloneJson(message))
    for (const call of calls) {
      this.recordTool(call, 'not_executed', 0, reason)
      this.state.accumulated.push(toolObservationMessage(call.call_id, { kind: 'error', call_id: call.call_id, message: reason }))
    }
  }

  /** @internal */
  buildInferenceRequest(): LlmInferenceRequest {
    let specs: ToolSpecLite[] = resolveToolSpecs(this.request.tool_policy, this.deps.tools)
    const native = this.request.tool_policy.mode !== 'none'
    let allow: boolean
    if (this.inWrapUp()) {
      const wrapUp = this.request.tool_policy.wrap_up_tools ?? []
      specs = specs.filter(s => wrapUp.includes(s.name))
      allow = native && specs.length > 0
    } else {
      allow = native && this.state.tool_iterations_left > 0
    }
    const output = this.request.output
    const mp = this.request.model_policy
    const req: LlmInferenceRequest = {
      trace_id: this.request.trace,
      messages: cloneJson(this.state.accumulated),
      model_alias: mp.preferred,
      fallbacks: [...mp.fallbacks],
      force_json: output.kind === 'json',
      disable_capabilities: [...this.request.tool_policy.disable_capabilities],
      tool_specs: specs,
      allow_tool_calls: allow,
      signal: this.abort.signal,
    }
    if (mp.temperature !== null && mp.temperature !== undefined) req.temperature = mp.temperature
    if (mp.max_completion_tokens !== null && mp.max_completion_tokens !== undefined) req.max_completion_tokens = mp.max_completion_tokens
    if (mp.provider_options !== null && mp.provider_options !== undefined) req.provider_options = mp.provider_options
    if (output.kind === 'json' && output.schema !== undefined) req.json_schema = output.schema
    return req
  }

  /** @internal Wrap-up mode: tool iterations used up, wrap-up batches left. */
  inWrapUp(): boolean {
    const p = this.request.tool_policy
    return this.state.tool_iterations_left === 0 && (p.wrap_up_tools ?? []).length > 0
      && (this.state.wrap_up_rounds_used ?? 0) < (p.wrap_up_rounds ?? DEFAULT_WRAP_UP_ROUNDS)
  }

  /** @internal A batch of only wrap-up tools may run without a tool iteration. */
  admitsWrapUp(names: string[]): boolean {
    const wrapUp = this.request.tool_policy.wrap_up_tools ?? []
    return this.inWrapUp() && names.every(n => wrapUp.includes(n))
  }

  /** @internal */
  accountResponse(response: AiResponse) {
    if (response.usage) this.state.usage = mergeUsage(this.state.usage, response.usage)
  }

  /** @internal */
  checkWallclockBudget(): LLMContextOutcome | undefined {
    const max = this.request.budget.max_wallclock_ms
    if (max === null || max === undefined) return undefined
    if (nowMs() - this.state.started_at_ms > max) {
      return { kind: 'budget_exhausted', which: 'wallclock', usage: cloneJson(this.state.usage) }
    }
    return undefined
  }

  /** @internal */
  checkTokenBudget(): LLMContextOutcome | undefined {
    const max = this.request.budget.max_total_tokens
    if (max === null || max === undefined) return undefined
    if ((this.state.usage.total_tokens ?? 0) > max) {
      return { kind: 'budget_exhausted', which: 'tokens', usage: cloneJson(this.state.usage) }
    }
    return undefined
  }

  /** @internal `interrupted` from the pre-inference snapshot: resuming retries that inference. */
  finishInterrupted(snapshot: LLMContextSnapshot, requestedAtMs: number): LLMContextOutcome {
    const reason = this.abort.reason() ?? 'interrupted'
    return {
      kind: 'interrupted', reason, usage: cloneJson(snapshot.state.usage), snapshot,
      abort: { reason, requested_at_ms: requestedAtMs, observed_at_ms: nowMs(), provider_cancel_supported: true },
    }
  }

  /** @internal */
  takeTrace(): ContextRunTrace {
    const trace: ContextRunTrace = { trace_id: this.request.trace ?? '', latency_ms: Math.max(0, nowMs() - this.state.started_at_ms) }
    if (this.toolTrace.length) trace.tool_trace = this.toolTrace
    this.toolTrace = []
    return trace
  }

  /** @internal Terminal `error` carrying the audit trace of this run. */
  finishError(error: LLMComputeError): LLMContextOutcome {
    return { kind: 'error', error, usage: cloneJson(this.state.usage), trace: this.takeTrace() }
  }

  /** `undefined` when the reply must be corrected and another inference run. */
  private async finishDone(response: AiResponse): Promise<LLMContextOutcome | undefined> {
    const text = textContent(response.message)
    const spec = this.request.output
    let output: ContextOutput
    if (spec.kind === 'text') {
      output = { kind: 'text', content: text }
    } else if (spec.max_repairs !== undefined && spec.max_repairs !== null) {
      const max = spec.max_repairs
      const checked = await checkReply(text, spec.schema, this.deps.outputValidator)
      if (checked.ok) {
        output = { kind: 'json', content: checked.value }
      } else {
        await this.emit({ kind: 'output_parse_failed', trace_id: this.request.trace, error: checked.error })
        if ((this.state.output_repairs ?? 0) < max) {
          this.state.output_repairs = (this.state.output_repairs ?? 0) + 1
          this.state.accumulated.push(cloneJson(response.message))
          this.state.accumulated.push(textMessage('user', repairMessage(checked.error, spec.schema)))
          return undefined
        }
        output = { kind: 'invalid', content: text, error: checked.error }
      }
    } else {
      let value: JsonValue | undefined
      let parseError: string | undefined
      try {
        value = JSON.parse(text)
      } catch (e) {
        parseError = e instanceof Error ? e.message : String(e)
      }
      if (parseError === undefined) {
        output = { kind: 'json', content: value as JsonValue }
      } else if (spec.strict) {
        await this.emit({ kind: 'output_parse_failed', trace_id: this.request.trace, error: parseError })
        this.state.accumulated.push(cloneJson(response.message))
        this.state.accumulated.push(textMessage('user',
          `error: llm output parse failed: ${parseError}\nReply again with exactly one valid JSON value and nothing else.`))
        return this.bumpConsecutiveErrors({ kind: 'output_parse', message: parseError })
      } else {
        output = { kind: 'text', content: text }
      }
    }
    const trace = this.takeTrace()
    this.state.accumulated.push(cloneJson(response.message))
    return { kind: 'done', output, usage: cloneJson(this.state.usage), response, trace }
  }

  /** @internal */
  handleError(error: LLMComputeError): LLMContextOutcome | undefined {
    if (!llmCorrectable(error)) return this.finishError(error)
    return this.bumpConsecutiveErrors(error)
  }

  /** @internal Count one failed iteration; an outcome when the cap is exceeded. */
  bumpConsecutiveErrors(error: LLMComputeError): LLMContextOutcome | undefined {
    this.state.consecutive_errors += 1
    const cap = this.request.error_policy.max_consecutive_errors
    if (cap > 0 && this.state.consecutive_errors > cap) return this.finishError(error)
    return undefined
  }

  /** @internal */
  async emit(event: Parameters<ResolvedDeps['worklog']['emit']>[0]) {
    await this.deps.worklog.emit(event)
  }

  /** @internal Usage of this context so far. */
  usage(): AiUsage {
    return cloneJson(this.state.usage)
  }
}
