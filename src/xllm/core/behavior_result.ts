// `LLMBehaviorResult` / `StepRecord` helpers (`llm_context/src/behavior_loop.rs`).

import type { LLMBehaviorResult, StepDecision, StepRecord } from './types'
import { rustTrim } from './rust_text'

/** Checks a parsed step before it takes effect; the error is fed back to the model. */
export function validateBehaviorResult(r: LLMBehaviorResult): string | undefined {
  const next = rustTrim(r.next_behavior ?? '')
  if (next !== undefined && (next.toUpperCase() === 'END' || next.toLowerCase() === 'done')) {
    return 'next_behavior END/done is invalid; submit <report end="true"> to finish'
  }
  if (r.self_report === undefined && r.report_result !== undefined) return 'a report result requires a report in the same response'
  if (r.report_end) {
    if (!rustTrim(r.self_report ?? '')) return 'an ending report must contain non-empty text'
    if ((r.do_actions ?? []).length > 0) return 'an ending report cannot contain actions or native tool_calls'
    if (rustTrim(r.next_behavior ?? '')) return 'an ending report cannot contain next_behavior'
  }
  return undefined
}

/** `handover` / `yield` for a step without actions that does not end; `undefined` otherwise. */
export function behaviorDecision(r: LLMBehaviorResult): StepDecision | undefined {
  if ((r.do_actions ?? []).length > 0 || r.report_end) return undefined
  if (rustTrim(r.next_behavior ?? '')) return 'handover'
  return 'yield'
}

export function stepFromResult(r: LLMBehaviorResult): StepRecord {
  const step: StepRecord = {
    meta: { step_index: 0, started_at_ms: 0, compression_level: 'full' },
    assistant_text: r.assistant_text,
    report_end: r.report_end,
  }
  if (r.observation !== undefined) step.observation = r.observation
  if (r.thought !== undefined) step.thought = r.thought
  if (r.do_actions?.length) step.actions = r.do_actions
  if (r.next_behavior !== undefined) step.next_behavior = r.next_behavior
  if (r.self_report !== undefined) step.self_report = r.self_report
  if (r.report_result !== undefined) step.report_result = r.report_result
  return step
}

export function resultFromStep(step: StepRecord): LLMBehaviorResult {
  const r: LLMBehaviorResult = { assistant_text: step.assistant_text, report_end: step.report_end }
  if (step.actions?.length) r.do_actions = step.actions
  if (step.next_behavior !== undefined) r.next_behavior = step.next_behavior
  if (step.observation !== undefined) r.observation = step.observation
  if (step.thought !== undefined) r.thought = step.thought
  if (step.self_report !== undefined) r.self_report = step.self_report
  if (step.report_result !== undefined) r.report_result = step.report_result
  return r
}

export function syntheticErrorStep(message: string): StepRecord {
  return {
    meta: { step_index: 0, started_at_ms: 0, compression_level: 'full' },
    assistant_text: '',
    report_end: false,
    action_results: [{ kind: 'error', call_id: '', message }],
  }
}

/** A step that only corrects a parse / policy failure. */
export function isCorrectionStep(step: StepRecord): boolean {
  const results = step.action_results ?? []
  return (step.actions ?? []).length === 0 && results.length === 1 && results[0].kind === 'error' && results[0].call_id === ''
}
