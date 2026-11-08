// Resume validation of a snapshot (`llm_context/src/suspension.rs`).

import type { AiContent, AiMessage, LLMContextRequest, LLMContextSnapshot, LLMContextState, ResumeFill, StepRecord } from './types'
import { LLMComputeException } from './errors'
import { jsonEqual } from './json'

function corrupted(message: string): LLMComputeException {
  return new LLMComputeException({ kind: 'snapshot_corrupted', message })
}

export function hasContinuation(state: LLMContextState): boolean {
  return state.tool_batch !== undefined || state.action_step !== undefined
}

export function applyFill(request: LLMContextRequest, state: LLMContextState, fill: ResumeFill, behavior: boolean, nowMs: number) {
  if (state.tool_batch && state.action_step) throw corrupted('snapshot has both a tool batch and a behavior step in progress')
  if (state.action_step && !behavior) {
    throw corrupted('snapshot has a behavior step in progress but the context is not in behavior mode')
  }
  const suspended = state.suspended
  state.suspended = undefined
  if (suspended && fill.kind === 'rewritten_history' && !behavior) {
    rewriteHistory(request, state, fill.history)
    resumeClock(state, suspended.at_ms, nowMs)
  } else if (suspended && fill.kind === 'rewritten_steps' && behavior) {
    rewriteSteps(request, state, fill.input, fill.history_summaries ?? [], fill.steps ?? [], fill.last_step)
    resumeClock(state, suspended.at_ms, nowMs)
  } else if (!suspended && fill.kind === 'resume_from_mid_run') {
    // nothing to rewrite
  } else {
    const fillName = fill.kind
    const suspension = !suspended ? 'a running (not suspended)' : behavior ? 'a behavior context_limit' : 'a function call context_limit'
    throw corrupted(`${fillName} fill does not match ${suspension} snapshot`)
  }
  const unanswered = unansweredToolCalls(state.accumulated).sort()
  const expected = (state.tool_batch?.remaining ?? []).map(c => c.call_id).sort()
  if (unanswered.join('\u0000') !== expected.join('\u0000')) {
    throw corrupted(`accumulated history has unanswered tool calls: ${unanswered.join(', ')}`)
  }
}

function resumeClock(state: LLMContextState, atMs: number, nowMs: number) {
  state.started_at_ms = state.started_at_ms + Math.max(0, nowMs - atMs)
}

function rewriteHistory(request: LLMContextRequest, state: LLMContextState, history: AiMessage[]) {
  if (hasContinuation(state)) throw corrupted('cannot rewrite history while a tool batch is in progress')
  history = stripThinking(history)
  if (history.length === 0) throw corrupted('rewritten history is empty')
  checkPaired(history)
  request.input = history.slice()
  state.accumulated = history.slice()
}

function rewriteSteps(request: LLMContextRequest, state: LLMContextState, input: AiMessage[],
  historySummaries: NonNullable<LLMContextState['history_summaries']>, steps: StepRecord[], lastStep: StepRecord | undefined) {
  if (hasContinuation(state)) throw corrupted('cannot rewrite history while a tool batch or step is in progress')
  input = stripThinking(input)
  if (input.length === 0) throw corrupted('rewritten input is empty')
  checkPaired(input)
  const known = new Set([...(state.steps ?? []), ...(state.last_step ? [state.last_step] : [])].map(s => s.meta.step_index))
  let prev: number | undefined
  for (const s of steps) {
    const idx = s.meta.step_index
    if (!known.has(idx)) throw corrupted(`rewritten steps keep step ${idx}, which is not in the snapshot`)
    if (prev !== undefined && idx <= prev) throw corrupted('rewritten steps are not in step order')
    prev = idx
  }
  if (lastStep) {
    const idx = lastStep.meta.step_index
    if (state.last_step?.meta.step_index !== idx) throw corrupted(`rewritten last_step ${idx} is not the snapshot's hot step`)
    if (prev !== undefined && prev >= idx) throw corrupted('rewritten steps must precede the hot step')
  }
  for (const s of [...steps, ...(lastStep ? [lastStep] : [])]) stripStepThinking(s)
  const tail = stripThinking(innerTranscriptOf(request, state))
  request.input = input.slice()
  state.accumulated = [...input, ...tail]
  state.history_summaries = historySummaries.length ? historySummaries : undefined
  state.steps = steps.length ? steps : undefined
  state.last_step = lastStep
}

/** Messages of `accumulated` after `request.input` (the inner transcript of a behavior step). */
export function innerTranscriptOf(request: LLMContextRequest, state: LLMContextState): AiMessage[] {
  const prefix = request.input.length
  if (state.accumulated.length <= prefix || !jsonEqual(state.accumulated.slice(0, prefix), request.input)) return []
  return state.accumulated.slice(prefix)
}

export function unansweredToolCalls(messages: AiMessage[]): string[] {
  let open: string[] = []
  for (const m of messages) {
    for (const b of m.content) {
      if (b.type === 'tool_use') open.push(b.call_id)
      else if (b.type === 'tool_result') open = open.filter(id => id !== b.call_id)
    }
  }
  return open
}

export function checkPaired(messages: AiMessage[]) {
  const open: string[] = []
  for (const m of messages) {
    for (const b of m.content) {
      if (b.type === 'tool_use') open.push(b.call_id)
      else if (b.type === 'tool_result') {
        const i = open.indexOf(b.call_id)
        if (i < 0) throw corrupted(`rewritten history has a tool result \`${b.call_id}\` without its tool call`)
        open.splice(i, 1)
      }
    }
  }
  if (open.length) throw corrupted(`rewritten history has unanswered tool calls: ${open.join(', ')}`)
}

export function isThinking(part: AiContent): boolean {
  if (part.type === 'thinking') return true
  if (part.type === 'provider_state') {
    const t = (part.value as { type?: unknown } | null)?.type
    return t === 'redacted_thinking' || t === 'reasoning'
  }
  return false
}

/** Thinking blocks are only valid under the prefix they were produced with; a rewritten history drops them. */
export function stripThinking(messages: AiMessage[]): AiMessage[] {
  const out: AiMessage[] = []
  for (const m of messages) {
    const content = m.content.filter(p => !isThinking(p))
    if (m.content.length > 0 && content.length === 0) continue
    out.push({ ...m, content })
  }
  return out
}

export function stripStepThinking(step: StepRecord) {
  const m = step.assistant_message
  if (!m) return
  const content = m.content.filter(p => !isThinking(p))
  if (m.content.length > 0 && content.length === 0) step.assistant_message = undefined
  else step.assistant_message = { ...m, content }
}

export function stripSnapshotThinking(snapshot: LLMContextSnapshot) {
  snapshot.request.input = stripThinking(snapshot.request.input)
  const s = snapshot.state
  s.accumulated = stripThinking(s.accumulated)
  for (const step of [...(s.steps ?? []), ...(s.last_step ? [s.last_step] : []), ...(s.action_step ? [s.action_step.step] : [])]) {
    stripStepThinking(step)
  }
}
