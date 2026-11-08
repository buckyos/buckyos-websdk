import type { AiMessage, EffectiveConfig, JsonValue, LlmClient, RunLimits, Tokenizer } from '../core/types';
/** AICC alias of the summary model. */
export declare const SUMMARIZE_MODEL_ALIAS = "llm.summarize";
/** Model-written fields (assistant text, tool call arguments) reach the summarizer up to this many chars each. */
export declare const REPORT_CHARS = 4096;
/** Rendered history one summary call takes at most; a larger range is folded chunk by chunk. */
export declare const DEFAULT_SUMMARY_CHUNK_TOKENS = 100000;
/** `max_completion_tokens` of one summary call; also what a rewrite reserves for the summary block. */
export declare const SUMMARY_MAX_TOKENS = 6144;
/** Upper bound of the rendered keep_exact block. */
export declare const KEEP_EXACT_MAX_TOKENS = 2048;
export declare const MAX_FOLD_PASSES = 4;
/** A behavior step's results message (user role) belongs to the step's round. */
export declare const STEP_RESULTS_PREFIX = "<<last_step_action_results";
/** Compaction target when the window is unknown. */
export declare const DEFAULT_AUTO_COMPRESS_TARGET_TOKENS = 32768;
/** With a known window, compaction lands at 30% of it. */
export declare const DEFAULT_CONTEXT_TARGET_RATIO = 0.3;
/** What one compression aims at (`CompressOptions`). */
export interface CompressOptions {
    /** Estimated tokens (the waist's estimator) the returned history should fit in. */
    target_token_budget: number;
    model_alias: string;
    /** Appended to the summarizer's system prompt. */
    extra_focus_prompt?: string;
    /** A fixed line rendered after the keep_exact block (never summarized). */
    note?: string;
    summary_chunk_tokens: number;
}
/** `CompressOptions::new`. */
export declare function compressOptions(targetTokenBudget: number, modelAlias: string): CompressOptions;
/** The summary block: summary text plus the strings kept verbatim (omitted when none). */
export interface CompressedSummary {
    summary: string;
    keep_exact?: string[];
}
export type CompressStrategy = 'unchanged' | 'llm' | 'no_range';
/** What a compression did (Rust logs it as `llm_compress.completed`). */
export interface CompressReport {
    /** `unchanged` (within the target) | `llm` | `no_range` (nothing between head and tail, or the system prefix alone is over the target). */
    strategy: CompressStrategy;
    prompt_version: string;
    model_alias: string;
    target_tokens: number;
    tokens_before: number;
    tokens_after: number;
    head_messages: number;
    head_tokens: number;
    /** Input messages folded into the summary: `[range_start, range_end)`. */
    range_start: number;
    range_end: number;
    range_rounds: number;
    range_tokens: number;
    previous_summary: boolean;
    tail_rounds: number;
    tail_tokens: number;
    summary_calls: number;
    summary_tokens: number;
    keep_exact: number;
    memory_candidates: number;
    reached_target: boolean;
    elapsed_ms: number;
}
export interface CompressOutcome {
    messages: AiMessage[];
    /** Input messages `[..head_end]` are kept as they are (system prefix + head). */
    head_end: number;
    /** Input messages `[tail_start..]` are kept as they are (raw tail). */
    tail_start: number;
    /** The new summary block (absent: nothing was summarized). */
    summary?: CompressedSummary;
    /** keep_exact entries pushed out by the cap, and the summarizer's memory candidates. */
    memory_candidates: JsonValue[];
    report: CompressReport;
}
/** What compression uses of the context's deps (an `LLMContextDeps` fits). */
export interface CompressDeps {
    llm: LlmClient;
    tokenizer?: Tokenizer;
    /** Aborts the summary inferences; Rust gives them no interrupt handle (default: never aborts). */
    signal?: AbortSignal;
}
export type UnitKind = 'round' | 'summary';
export interface Unit {
    start: number;
    end: number;
    kind: UnitKind;
}
/** Compress `history` to `targetTokenBudget`; the messages only (`compress`). */
export declare function compress(history: AiMessage[], deps: CompressDeps, targetTokenBudget: number, modelAlias: string, extraFocusPrompt?: string): Promise<AiMessage[]>;
/**
 * Compress `history` into `system + head + [summary] + keep_exact + note +
 * raw tail` within `opts.target_token_budget` (`compress_history`).
 *
 * Returned as is: an empty history, one within the target, or one with
 * nothing between head and tail to summarize (`no_range`). A summarizer
 * failure (provider error, empty summary) rejects with its `LLMComputeException`.
 */
export declare function compressHistory(history: AiMessage[], deps: CompressDeps, opts: CompressOptions): Promise<CompressOutcome>;
/** The summary block as one user message (`summary_message`). */
export declare function summaryMessage(summary: CompressedSummary, note?: string): AiMessage;
/** The summary block of a message rendered by `summaryMessage` (`parse_summary_message`). */
export declare function parseSummaryMessage(message: AiMessage): CompressedSummary | undefined;
/** A user message whose first text block opens a summary block (`is_summary_message`). */
export declare function isSummaryMessage(message: AiMessage): boolean;
/** `render_keep_exact`. */
export declare function renderKeepExact(entries: string[]): string;
/**
 * Rounds and summary messages of `history` from `start` (after the system
 * prefix). A round is an assistant message with its tool results (or a
 * behavior step with its results message) and the user input right after
 * them; leading user messages (the opening input) join the first round, and
 * a user message after an assistant's final reply opens a new round.
 */
export declare function segment(history: AiMessage[], start: number): Unit[];
/**
 * Append new verbatim entries to `keep` (whitespace normalized, exact
 * duplicates skipped); the oldest entries beyond the cap become memory
 * candidates (`merge_keep_exact`).
 */
export declare function mergeKeepExact(keep: string[], entries: Iterable<string>, tokenizer: Tokenizer, candidates: JsonValue[]): void;
/**
 * The run's compactor (`LlmSummarizeCompressor`): summarizes with the run's
 * client and appends the note that the run's files are intact. A failure
 * rejects with an `XllmError` of kind `compressor`.
 */
export declare class LlmSummarizeCompressor {
    readonly llm: LlmClient;
    readonly modelAlias: string;
    readonly targetTokenBudget: number;
    readonly tokenizer: Tokenizer;
    /** The run's workdir, named in the note (Rust: the `dir` of `Compressor::compress`). */
    readonly workdir: string;
    readonly signal?: AbortSignal | undefined;
    constructor(llm: LlmClient, modelAlias: string, targetTokenBudget: number, tokenizer: Tokenizer, 
    /** The run's workdir, named in the note (Rust: the `dir` of `Compressor::compress`). */
    workdir: string, signal?: AbortSignal | undefined);
    compress(history: AiMessage[]): Promise<AiMessage[]>;
}
/**
 * Compaction target of a run (`compaction_target_tokens`): 30% of the
 * window, at most `DEFAULT_AUTO_COMPRESS_TARGET_TOKENS` and at most half the
 * yield threshold, so a compaction lands well below the line that triggered
 * it. The ratios are f32 in Rust; `Math.fround` reproduces the rounding.
 */
export declare function compactionTargetTokens(limits: Pick<RunLimits, 'context_window_tokens' | 'context_yield_ratio'>): number;
/** The summary model of a run (`EffectiveConfig::summary_model`): `llm.summarize` via AICC, the run's model for OpenAI. */
export declare function summaryModel(config: Pick<EffectiveConfig, 'provider' | 'model'>): string;
//# sourceMappingURL=compress.d.ts.map