// Dependencies injected into an LLMContext (`llm_context/src/deps.rs`): the
// waist only sees these interfaces; implementations live above it.

import type {
  AiMessage, AiResponse, AiToolCall, CancelCause, DecisionVerdict, HistorySummaryRecord, Injection, LLMBehaviorResult,
  LLMContextRequest, LLMContextSnapshot, LlmClient, Observation, StepDecision, StepRecord, Tokenizer, ToolPolicy, ToolSpecLite,
  WorkEvent,
} from './types'
import type { JsonValue } from './types'
import { ByteHeuristicTokenizer } from './tokenizer'

/** Per-call context handed to `ToolManager.callTool`: the run's interrupt / finish signals and deadline. */
export interface ToolCallCtx {
  /** Aborts on interrupt or once the run deadline passed (not on a graceful finish). */
  readonly signal: AbortSignal
  /** Epoch ms by which the run's wallclock budget ends, if any. */
  readonly deadline_ms?: number
  /** The cause currently in force, if any (`deadline` only once it passed). */
  cause(): CancelCause | undefined
  /** Resolves when the call should stop: interrupt, graceful finish or deadline. */
  cancelled(): Promise<CancelCause>
  /** Resolves on interrupt or deadline only. */
  cancelledHard(): Promise<CancelCause>
}

/** A dispatch infrastructure failure (`Err(ToolDispatchError)`); `effect_unknown` whenever the call may have started. */
export class ToolDispatchException extends Error {
  readonly effect_unknown: boolean

  constructor(message: string, effectUnknown: boolean) {
    super(message)
    this.name = 'ToolDispatchException'
    this.effect_unknown = effectUnknown
  }
}

/**
 * Effect-side dispatcher. Resolves with a terminal observation (`error` is a
 * business failure the model can react to); rejects with a
 * `ToolDispatchException` for an infrastructure failure. On resume a call of
 * an unfinished batch is dispatched again with the same `call_id`: the
 * manager looks for the earlier work first and answers `unresolved` instead
 * of running a non-idempotent tool again.
 */
export interface ToolManager {
  callTool(call: AiToolCall, ctx: ToolCallCtx): Promise<Observation>
  listToolSpecs(): ToolSpecLite[]
}

/** Policy gate; a rejection (a thrown message) is fed back as a correctable error. */
export interface PolicyEngine {
  gateToolCalls(request: LLMContextRequest, calls: AiToolCall[]): Promise<AiToolCall[]>
  gateActionCalls?(request: LLMContextRequest, calls: AiToolCall[]): Promise<AiToolCall[]>
}

export interface WorklogSink {
  emit(event: WorkEvent): void | Promise<void>
}

/**
 * The host's checkpoint hook, always called with the outer snapshot:
 * `beforeToolCall` before every tool call / action, `beforeInference` at
 * every inference boundary (resolve with an injection to add input; reject
 * to stop the run with a checkpoint error).
 */
export interface CheckpointHook {
  beforeToolCall?(snapshot: LLMContextSnapshot): Promise<void>
  beforeInference(snapshot: LLMContextSnapshot): Promise<Injection | undefined>
  validateReport?(snapshot: LLMContextSnapshot, result: LLMBehaviorResult, stepIndex: number): Promise<void>
  reviewDecision?(snapshot: LLMContextSnapshot, result: LLMBehaviorResult, stepIndex: number,
    decision: StepDecision): Promise<DecisionVerdict | undefined>
}

/** Host check of a reply that met the reply contract's schema; reject with the message the model should fix. */
export interface OutputValidator {
  validate(reply: JsonValue): Promise<void>
}

/** Behavior loop: structured parser for model responses (rejects with the parse error). */
export interface LLMResultParser {
  parse(response: AiResponse): LLMBehaviorResult
}

/** Behavior loop: renders sedimented steps back into messages for the next inference. */
export interface StepRenderer {
  render(step: StepRecord): [AiMessage, AiMessage]
  renderInherited?(step: StepRecord): AiMessage
  renderSummary?(summary: HistorySummaryRecord): AiMessage
  /** The sedimented history; without it: summaries, then each step (another behavior's as inherited records). */
  renderHistory?(steps: StepRecord[], currentBehavior: string, summaries: HistorySummaryRecord[]): AiMessage[]
}

export const MAX_INJECTIONS_PER_BOUNDARY = 4

export interface LLMContextDeps {
  llm: LlmClient
  tools: ToolManager
  policy?: PolicyEngine
  worklog?: WorklogSink
  tokenizer?: Tokenizer
  resultParser?: LLMResultParser
  stepRenderer?: StepRenderer
  checkpointHook?: CheckpointHook
  outputValidator?: OutputValidator
}

export interface ResolvedDeps {
  llm: LlmClient
  tools: ToolManager
  policy: PolicyEngine
  worklog: WorklogSink
  tokenizer: Tokenizer
  resultParser?: LLMResultParser
  stepRenderer?: StepRenderer
  checkpointHook?: CheckpointHook
  outputValidator?: OutputValidator
}

export const allowAllPolicy: PolicyEngine = {
  async gateToolCalls(_request, calls) {
    return calls
  },
}

export const noopWorklog: WorklogSink = { emit() {} }

export function resolveDeps(d: LLMContextDeps): ResolvedDeps {
  return {
    ...d,
    policy: d.policy ?? allowAllPolicy,
    worklog: d.worklog ?? noopWorklog,
    tokenizer: d.tokenizer ?? new ByteHeuristicTokenizer(),
  }
}

/** Specs the adapter may advertise, filtered by `ToolPolicy.mode` / `whitelist`. */
export function resolveToolSpecs(policy: ToolPolicy, tools: ToolManager): ToolSpecLite[] {
  if (policy.mode === 'none') return []
  const specs = tools.listToolSpecs()
  if (policy.mode === 'all') return specs
  return specs.filter(s => policy.whitelist.includes(s.name))
}
