// Behavior loop: the outer scheduler of `context_loop.rs`. Each step runs a
// fresh function-call LLMContext (parser and renderer stripped) to one
// response, parses it into a step (actions, report, next_behavior), runs the
// actions in document order (the first failure stops the step) and
// sediments the step; the rendered step history is the next inner prompt.
// A step that yields (no action, no final report, no hand-over) ends the
// run with `done`: the loop never waits.

import type {
  AiMessage, AiResponse, AiToolCall, CancelCause, HistorySummaryRecord, LLMBehaviorResult, LLMComputeError, LLMContextOutcome,
  LLMContextRequest, LLMContextSnapshot, LLMContextState, Observation, StepRecord,
} from './types'
import type { LLMContextDeps, StepRenderer } from './deps'
import { LLMContext } from './loop'
import { behaviorDecision, resultFromStep, stepFromResult, syntheticErrorStep, validateBehaviorResult } from './behavior_result'
import { innerTranscriptOf } from './suspension'
import { cloneJson } from './json'
import { nowMs, textContent, textMessage } from './messages'
import { rustTrim } from './rust_text'

const FINISHING_SKIP_REASON = 'not executed: the run is finishing'
const INTERRUPTED_SKIP_REASON = 'not executed: the run was interrupted'

/** `StepRenderer::render_inherited` default. */
export function defaultRenderInherited(step: StepRecord): AiMessage {
  const summary = rustTrim(step.thought ?? '') ? step.thought : rustTrim(step.assistant_text)
  return textMessage('user', `history step record:\nbehavior: ${step.meta.behavior_name ?? ''}\nindex: ${step.meta.step_index}\nsummary: ${summary}`)
}

/** `StepRenderer::render_summary` default. */
export function defaultRenderSummary(s: HistorySummaryRecord): AiMessage {
  return textMessage('user', `history summary:\nsteps: ${s.start_step_index}..${s.end_step_index}\ncount: ${s.step_count}\nbehaviors: ${(s.behavior_names ?? []).join(', ')}\nsummary: ${s.summary}`)
}

/**
 * `StepRenderer::render_history`: the renderer's own when it has one, else
 * the trait default — summaries, then each step (steps of another behavior
 * as inherited records).
 */
export function renderStepHistory(r: StepRenderer, steps: StepRecord[], currentBehavior: string, summaries: HistorySummaryRecord[]): AiMessage[] {
  if (r.renderHistory) return r.renderHistory(steps, currentBehavior, summaries)
  const out: AiMessage[] = []
  for (const s of summaries) out.push(r.renderSummary ? r.renderSummary(s) : defaultRenderSummary(s))
  for (const step of steps) {
    if (currentBehavior && (step.meta.behavior_name ?? '') !== currentBehavior) {
      out.push(r.renderInherited ? r.renderInherited(step) : defaultRenderInherited(step))
    } else {
      out.push(...r.render(step))
    }
  }
  return out
}

/** The behavior prompt without the inner transcript of the step in progress. */
export function materializeHistory(request: LLMContextRequest, state: LLMContextState, r: StepRenderer): AiMessage[] {
  const messages = cloneJson(request.input)
  const steps = state.steps ?? []
  const summaries = state.history_summaries ?? []
  const behavior = request.behavior_name ?? ''
  messages.push(...renderStepHistory(r, steps, behavior, summaries))
  if (state.last_step) messages.push(...r.render(state.last_step))
  return messages
}

/** The history a scheduler rewrites for a `context_limit_reached` snapshot (`LLMContext::rewritable_history`). */
export function rewritableHistory(snapshot: LLMContextSnapshot, deps: LLMContextDeps): AiMessage[] {
  if (deps.resultParser && deps.stepRenderer) return materializeHistory(snapshot.request, snapshot.state, deps.stepRenderer)
  return cloneJson(snapshot.state.accumulated)
}

function sediment(ctx: LLMContext, step: StepRecord) {
  const prev = ctx.state.last_step
  ctx.state.last_step = step
  if (prev) ctx.state.steps = [...(ctx.state.steps ?? []), prev]
}

function prepareStep(ctx: LLMContext, step: StepRecord, startedAtMs: number): StepRecord {
  const stepIndex = ctx.state.next_step_index
  ctx.state.next_step_index += 1
  for (const a of step.actions ?? []) {
    ctx.state.next_action_id += 1
    a.call_id = String(ctx.state.next_action_id)
  }
  step.meta = { step_index: stepIndex, started_at_ms: startedAtMs, compression_level: 'full' }
  if (ctx.request.behavior_name) step.meta.behavior_name = ctx.request.behavior_name
  return step
}

function finishStep(step: StepRecord) {
  step.meta.ended_at_ms = nowMs()
}

function setInnerTranscript(ctx: LLMContext, tail: AiMessage[]) {
  ctx.state.accumulated = [...cloneJson(ctx.request.input), ...tail]
}

function clearInnerTranscript(ctx: LLMContext) {
  if (innerTranscriptOf(ctx.request, ctx.state).length > 0) ctx.state.accumulated = ctx.state.accumulated.slice(0, ctx.request.input.length)
}

function skipActions(ctx: LLMContext, remaining: AiToolCall[], reason: string): Observation[] {
  return remaining.map(a => {
    ctx.recordTool(a, 'not_executed', 0, reason)
    return { kind: 'unresolved', call_id: a.call_id, reason, effect_unknown: false }
  })
}

function finishDoneBehavior(ctx: LLMContext, step: StepRecord, response: AiResponse): LLMContextOutcome {
  finishStep(step)
  const behaviorResult = resultFromStep(step)
  const steps = ctx.state.steps ?? []
  if (ctx.state.last_step) steps.push(ctx.state.last_step)
  ctx.state.last_step = undefined
  steps.push(step)
  ctx.state.steps = steps
  return {
    kind: 'done', output: { kind: 'text', content: textContent(response.message) }, usage: cloneJson(ctx.state.usage), response,
    trace: ctx.takeTrace(), behavior_result: behaviorResult,
  }
}

function abortStep(ctx: LLMContext, failed: Observation, skipReason: string, err: LLMComputeError): LLMContextOutcome {
  const active = ctx.state.action_step
  ctx.state.action_step = undefined
  if (active) {
    const step = active.step
    const results = [...(step.action_results ?? []), failed]
    const actions = step.actions ?? []
    results.push(...skipActions(ctx, actions.slice(Math.min(results.length, actions.length)), skipReason))
    step.action_results = results
    finishStep(step)
    sediment(ctx, step)
  }
  return ctx.finishError(err)
}

function settleStep(ctx: LLMContext, cancelled: Observation | undefined, cause: CancelCause): LLMContextOutcome {
  const active = ctx.state.action_step
  ctx.state.action_step = undefined
  if (active) {
    const step = active.step
    const results = [...(step.action_results ?? [])]
    if (cancelled) results.push(cancelled)
    const actions = step.actions ?? []
    const rest = actions.slice(Math.min(results.length, actions.length))
    if (cause === 'finishing') {
      for (const a of rest) {
        ctx.recordTool(a, 'not_executed', 0, FINISHING_SKIP_REASON)
        results.push({ kind: 'cancelled', call_id: a.call_id, reason: FINISHING_SKIP_REASON, effect_unknown: false })
      }
    } else {
      results.push(...skipActions(ctx, rest, INTERRUPTED_SKIP_REASON))
    }
    step.action_results = results
    finishStep(step)
    sediment(ctx, step)
  }
  return ctx.stopAfterCancel(cause)
}

async function completeStep(ctx: LLMContext, step: StepRecord, response: AiResponse): Promise<LLMContextOutcome | undefined> {
  const actions = step.actions ?? []
  const results = step.action_results ?? []
  let errorToBump: LLMComputeError | undefined
  for (let i = 0; i < Math.min(actions.length, results.length); i++) {
    const o = results[i]
    if (o.kind === 'error') {
      errorToBump = { kind: 'tool_failed', tool: actions[i].name, call_id: actions[i].call_id, message: o.message }
      break
    }
  }
  if (!errorToBump) ctx.state.consecutive_errors = 0
  if (step.report_end || step.next_behavior !== undefined) return finishDoneBehavior(ctx, step, response)
  finishStep(step)
  sediment(ctx, step)
  if (errorToBump) return ctx.bumpConsecutiveErrors(errorToBump)
  return undefined
}

/** Dispatch the actions of `state.action_step` in order; the first non-success stops the step. */
async function runStepActions(ctx: LLMContext): Promise<LLMContextOutcome | undefined> {
  for (;;) {
    const active = ctx.state.action_step
    if (!active) return undefined
    const step = active.step
    const results = step.action_results ?? []
    const stopped = results.length > 0 && results[results.length - 1].kind !== 'success'
    const action = (step.actions ?? [])[results.length]
    if (!action || stopped) break
    if (ctx.abort.isFinishing() && !ctx.abort.isAborted()) return settleStep(ctx, undefined, 'finishing')
    const cp = await ctx.checkpointBeforeToolCall()
    if (cp) return cp
    const started = nowMs()
    await ctx.emit({ kind: 'tool_call_planned', trace_id: ctx.request.trace, tool: action.name, call_id: action.call_id, args: action.args })
    const { ctx: callCtx, release } = ctx.toolCallCtx()
    let dispatched
    try {
      dispatched = await ctx.dispatchTool(action, callCtx)
    } finally {
      release()
    }
    const duration = nowMs() - started
    if ('err' in dispatched) {
      const d = dispatched.err
      await ctx.emit({ kind: 'tool_dispatch_failed', trace_id: ctx.request.trace, tool: action.name, call_id: action.call_id,
        message: d.message, effect_unknown: d.effect_unknown })
      ctx.recordTool(action, d.effect_unknown ? 'unknown' : 'not_executed', duration, d.message)
      return abortStep(ctx, { kind: 'unresolved', call_id: action.call_id, reason: d.message, effect_unknown: d.effect_unknown },
        'not executed: dispatch of an earlier action in this step failed',
        { kind: 'tool_runtime', tool: action.name, call_id: action.call_id, message: d.message, effect_unknown: d.effect_unknown })
    }
    const obs = dispatched.ok
    if (obs.kind === 'success') {
      ctx.recordTool(action, 'succeeded', duration)
      await ctx.emit({ kind: 'tool_call_finished', trace_id: ctx.request.trace, tool: action.name, call_id: action.call_id, ok: true, duration_ms: duration })
    } else if (obs.kind === 'error') {
      ctx.recordTool(action, 'failed', duration, obs.message)
      await ctx.emit({ kind: 'tool_call_failed', trace_id: ctx.request.trace, tool: action.name, call_id: action.call_id, message: obs.message })
    } else if (obs.kind === 'cancelled') {
      const cause = callCtx.cause()
      if (!cause) {
        const message = 'behavior loop: tool returned Cancelled inline without an interrupt, finish or deadline'
        ctx.recordTool(action, 'unknown', duration, message)
        return abortStep(ctx, { kind: 'unresolved', call_id: action.call_id, reason: message, effect_unknown: true },
          'not executed: an earlier action in this step broke the observation contract', { kind: 'internal', message })
      }
      ctx.recordTool(action, 'cancelled', duration, obs.reason)
      return settleStep(ctx, obs, cause)
    } else {
      ctx.recordTool(action, obs.effect_unknown ? 'unknown' : 'not_executed', duration, obs.reason)
    }
    const a = ctx.state.action_step
    if (a) a.step.action_results = [...(a.step.action_results ?? []), obs]
  }
  const active = ctx.state.action_step
  ctx.state.action_step = undefined
  if (!active) return undefined
  const { step, response } = active
  const results = step.action_results ?? []
  const actions = step.actions ?? []
  if (results.length < actions.length) {
    const reason = results[results.length - 1]?.kind === 'error'
      ? 'not executed: an earlier action in this step failed'
      : 'not executed: an earlier action in this step did not complete'
    step.action_results = [...results, ...skipActions(ctx, actions.slice(results.length), reason)]
  }
  return completeStep(ctx, step, response)
}

/**
 * One inner function-call context for the current step: seeded with the
 * outer usage, clock, error count and an inner tool batch in progress, and
 * handing them back afterwards. An outcome other than `done` becomes the
 * outer outcome.
 */
async function runInnerForStep(ctx: LLMContext): Promise<{ response: AiResponse; native: AiMessage[] } | { outer: LLMContextOutcome }> {
  const renderer = ctx.deps.stepRenderer as StepRenderer
  const transcript = innerTranscriptOf(ctx.request, ctx.state)
  const input = [...materializeHistory(ctx.request, ctx.state, renderer), ...cloneJson(transcript)]
  const innerRequest = { ...cloneJson(ctx.request), input }
  const prefixLen = input.length - transcript.length
  const innerDeps: LLMContextDeps = { ...ctx.deps, resultParser: undefined, stepRenderer: undefined, checkpointHook: undefined }
  const inner = new LLMContext(innerRequest, innerDeps, ctx.abort)
  inner.nativeResultParser = ctx.deps.resultParser
  inner.toolCheckpointHook = ctx.deps.checkpointHook
  inner.innerParent = { parent: ctx.snapshot(), prefixLen }
  inner.state.usage = cloneJson(ctx.state.usage)
  inner.state.started_at_ms = ctx.state.started_at_ms
  inner.state.consecutive_errors = ctx.state.consecutive_errors
  inner.state.tool_iterations_left = ctx.state.tool_iterations_left
  inner.state.wrap_up_rounds_used = ctx.state.wrap_up_rounds_used
  inner.state.tool_batch = ctx.state.tool_batch
  ctx.state.tool_batch = undefined
  const outcome = await inner.runInner()
  const parent = inner.innerParent?.parent
  inner.innerParent = undefined
  if (parent) {
    ctx.state.steps = parent.state.steps
    ctx.state.last_step = parent.state.last_step
    ctx.state.last_report = parent.state.last_report
    ctx.state.report_end = parent.state.report_end
    ctx.state.next_step_index = parent.state.next_step_index
  }
  ctx.toolTrace.push(...inner.toolTrace)
  inner.toolTrace = []
  ctx.state.consecutive_errors = inner.state.consecutive_errors
  ctx.state.tool_iterations_left = inner.state.tool_iterations_left
  ctx.state.wrap_up_rounds_used = inner.state.wrap_up_rounds_used
  ctx.state.usage = cloneJson(inner.state.usage)
  if (outcome.kind !== 'done') {
    setInnerTranscript(ctx, cloneJson(inner.state.accumulated.slice(prefixLen)))
    ctx.state.tool_batch = inner.state.tool_batch
    inner.state.tool_batch = undefined
  }
  const absorb = (trace: { tool_trace?: typeof ctx.toolTrace }) => ctx.toolTrace.push(...(trace.tool_trace ?? []))
  switch (outcome.kind) {
    case 'done': {
      absorb(outcome.trace)
      const native = cloneJson(inner.state.accumulated.slice(prefixLen))
      native.pop()
      clearInnerTranscript(ctx)
      return { response: outcome.response, native }
    }
    case 'settled':
      absorb(outcome.trace)
      return { outer: { kind: 'settled', reason: outcome.reason, usage: cloneJson(ctx.state.usage), snapshot: ctx.snapshot(), trace: ctx.takeTrace() } }
    case 'context_limit_reached': {
      absorb(outcome.trace)
      ctx.state.suspended = inner.state.suspended
      inner.state.suspended = undefined
      const history = outcome.accumulated.slice(0, prefixLen)
      return {
        outer: {
          kind: 'context_limit_reached', which: outcome.which, usage: cloneJson(ctx.state.usage), accumulated: history,
          snapshot: ctx.snapshot(), trace: ctx.takeTrace(),
        },
      }
    }
    case 'interrupted':
      return { outer: { kind: 'interrupted', reason: outcome.reason, usage: cloneJson(ctx.state.usage), snapshot: ctx.snapshot(), abort: outcome.abort } }
    case 'error':
      absorb(outcome.trace)
      return { outer: ctx.finishError(outcome.error) }
    case 'budget_exhausted':
      return { outer: { kind: 'budget_exhausted', which: outcome.which, ...(outcome.partial ? { partial: outcome.partial } : {}), usage: cloneJson(ctx.state.usage) } }
  }
}

function correctionStep(ctx: LLMContext, message: string, startedAt: number, from: { text: string; message?: AiMessage; native?: AiMessage[] }) {
  const step = prepareStep(ctx, syntheticErrorStep(`parse failed: ${message}`), startedAt)
  step.assistant_text = from.text
  if (from.message) step.assistant_message = from.message
  if (from.native?.length) step.native_messages = from.native
  finishStep(step)
  sediment(ctx, step)
}

async function parseStep(ctx: LLMContext, response: AiResponse): Promise<LLMBehaviorResult> {
  const parser = ctx.deps.resultParser
  if (!parser) throw new Error('behavior mode requires result_parser')
  const result = parser.parse(response)
  const invalid = validateBehaviorResult(result)
  if (invalid) throw new Error(invalid)
  const hook = ctx.deps.checkpointHook
  if (result.self_report !== undefined && hook?.validateReport) await hook.validateReport(ctx.snapshot(), result, ctx.state.next_step_index)
  const decision = behaviorDecision(result)
  if (decision && hook?.reviewDecision) {
    const verdict = await hook.reviewDecision(ctx.snapshot(), result, ctx.state.next_step_index, decision)
    if (verdict && 'refuse' in verdict) throw new Error(verdict.refuse)
  }
  return result
}

/** The behavior outer loop (`LLMContext::run_behavior`). */
export async function runBehavior(ctx: LLMContext): Promise<LLMContextOutcome> {
  if (ctx.state.report_end) {
    const steps = ctx.state.steps ?? []
    const last = steps[steps.length - 1]
    const step = cloneJson(ctx.state.action_step?.step ?? (last?.report_end ? last : undefined)
      ?? (ctx.state.last_step?.report_end ? ctx.state.last_step : undefined))
    if (!step) return ctx.finishError({ kind: 'snapshot_corrupted', message: 'report_end requires its final report Step' })
    const result = resultFromStep(step)
    let failure = validateBehaviorResult(result)
    if (failure === undefined && ctx.deps.checkpointHook?.validateReport) {
      try {
        await ctx.deps.checkpointHook.validateReport(ctx.snapshot(), result, step.meta.step_index)
      } catch (e) {
        failure = e instanceof Error ? e.message : String(e)
      }
    }
    if (failure !== undefined) {
      ctx.state.report_end = false
      ctx.state.action_step = undefined
      ctx.state.steps = (ctx.state.steps ?? []).filter(s => s.meta.step_index !== step.meta.step_index)
      if (ctx.state.last_step?.meta.step_index === step.meta.step_index) ctx.state.last_step = undefined
      const reports = [...(ctx.state.steps ?? []), ...(ctx.state.last_step ? [ctx.state.last_step] : [])].map(s => s.self_report).filter((r): r is string => r !== undefined)
      ctx.state.last_report = reports[reports.length - 1]
      correctionStep(ctx, failure, nowMs(), { text: step.assistant_text, message: step.assistant_message, native: step.native_messages })
      const out = ctx.bumpConsecutiveErrors({ kind: 'output_parse', message: failure })
      if (out) return out
    } else if (!ctx.state.action_step) {
      const message = step.assistant_message ?? { role: 'assistant' as const, content: [{ type: 'text' as const, text: step.assistant_text }] }
      return {
        kind: 'done', output: { kind: 'text', content: step.assistant_text }, usage: cloneJson(ctx.state.usage), response: { message },
        trace: ctx.takeTrace(), behavior_result: result,
      }
    }
  }
  for (;;) {
    if (ctx.state.action_step) {
      const out = await runStepActions(ctx)
      if (out) return out
      continue
    }
    if (ctx.abort.isFinishing() && !ctx.abort.isAborted() && !ctx.state.tool_batch) return ctx.finishSettled()
    if (!ctx.state.tool_batch) {
      const budget = ctx.checkWallclockBudget()
      if (budget) return budget
      const hooked = await ctx.runCheckpointHook()
      if (hooked) return hooked
    }
    const startedAt = nowMs()
    const inner = await runInnerForStep(ctx)
    if ('outer' in inner) return inner.outer
    const { response, native } = inner
    let result: LLMBehaviorResult
    try {
      result = await parseStep(ctx, response)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      await ctx.emit({ kind: 'output_parse_failed', trace_id: ctx.request.trace, error: message })
      correctionStep(ctx, message, startedAt, { text: textContent(response.message), message: response.message, native })
      const out = ctx.bumpConsecutiveErrors({ kind: 'output_parse', message })
      if (out) return out
      continue
    }
    const step = prepareStep(ctx, stepFromResult(result), startedAt)
    step.assistant_message = response.message
    if (native.length) step.native_messages = native
    const actions = step.actions ?? []
    if (actions.length > 0 && ctx.state.tool_iterations_left === 0 && !ctx.admitsWrapUp(actions.map(a => a.name))) {
      setInnerTranscript(ctx, step.native_messages ?? [])
      return { kind: 'budget_exhausted', which: 'tool_iterations', partial: { kind: 'text', content: textContent(response.message) }, usage: cloneJson(ctx.state.usage) }
    }
    if (ctx.request.forbid_next_behavior) delete step.next_behavior
    if (step.self_report !== undefined) {
      ctx.state.last_report = step.self_report
      ctx.state.report_end = step.report_end
      await ctx.emit({ kind: 'self_report_set', trace_id: ctx.request.trace, chars: [...step.self_report].length })
    }
    if (actions.length === 0 && !step.report_end && step.next_behavior === undefined) return finishDoneBehavior(ctx, step, response)
    const hadActions = actions.length > 0
    let gated: AiToolCall[]
    try {
      const policy = ctx.deps.policy
      gated = policy.gateActionCalls ? await policy.gateActionCalls(ctx.request, cloneJson(actions)) : await policy.gateToolCalls(ctx.request, cloneJson(actions))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const errStep = prepareStep(ctx, syntheticErrorStep(`policy rejected: ${msg}`), startedAt)
      errStep.assistant_text = textContent(response.message)
      errStep.assistant_message = response.message
      if (step.native_messages?.length) errStep.native_messages = step.native_messages
      finishStep(errStep)
      sediment(ctx, errStep)
      const out = ctx.bumpConsecutiveErrors({ kind: 'policy_rejected', message: msg })
      if (out) return out
      continue
    }
    if (gated.length) step.actions = gated
    else delete step.actions
    if (hadActions) delete step.next_behavior
    if (gated.length > 0) {
      if (ctx.state.tool_iterations_left === 0) ctx.state.wrap_up_rounds_used = (ctx.state.wrap_up_rounds_used ?? 0) + 1
      else ctx.state.tool_iterations_left -= 1
    }
    ctx.state.action_step = { step, response }
  }
}
