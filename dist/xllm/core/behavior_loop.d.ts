import type { AiMessage, HistorySummaryRecord, LLMContextOutcome, LLMContextRequest, LLMContextSnapshot, LLMContextState, StepRecord } from './types';
import type { LLMContextDeps, StepRenderer } from './deps';
import { LLMContext } from './loop';
/** `StepRenderer::render_inherited` default. */
export declare function defaultRenderInherited(step: StepRecord): AiMessage;
/** `StepRenderer::render_summary` default. */
export declare function defaultRenderSummary(s: HistorySummaryRecord): AiMessage;
/**
 * `StepRenderer::render_history`: the renderer's own when it has one, else
 * the trait default — summaries, then each step (steps of another behavior
 * as inherited records).
 */
export declare function renderStepHistory(r: StepRenderer, steps: StepRecord[], currentBehavior: string, summaries: HistorySummaryRecord[]): AiMessage[];
/** The behavior prompt without the inner transcript of the step in progress. */
export declare function materializeHistory(request: LLMContextRequest, state: LLMContextState, r: StepRenderer): AiMessage[];
/** The history a scheduler rewrites for a `context_limit_reached` snapshot (`LLMContext::rewritable_history`). */
export declare function rewritableHistory(snapshot: LLMContextSnapshot, deps: LLMContextDeps): AiMessage[];
/** The behavior outer loop (`LLMContext::run_behavior`). */
export declare function runBehavior(ctx: LLMContext): Promise<LLMContextOutcome>;
//# sourceMappingURL=behavior_loop.d.ts.map