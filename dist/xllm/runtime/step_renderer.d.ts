import type { AiMessage, HistorySummaryRecord, JsonValue, StepRecord } from '../core/types';
import type { StepRenderer } from '../core/deps';
export type ToolResultStatusView = 'success' | 'error' | 'pending';
export interface HintView {
    text: string;
    once?: string;
}
/** Rendering view of the AgentToolResult envelope in `Observation.host` (`result_view.rs`). */
export interface ToolResultView {
    agent_tool_protocol?: string;
    status: ToolResultStatusView;
    cmd_name?: string;
    cmd_args?: string;
    title: string;
    summary: string;
    output?: string;
    /** `null` and `{}` read as absent. */
    detail?: JsonValue;
    return_code?: number;
    task_id?: string;
    partial_output?: string;
    pending_reason?: string;
    check_after?: number;
    hints: HintView[];
}
/**
 * `ToolResultView::from_host`: any object host reads as a view (every field
 * is optional, unknown fields are ignored); a field of the wrong type makes
 * the host unreadable, as serde's deserialization does.
 */
export declare function toolResultViewFromHost(host: JsonValue | undefined): ToolResultView | undefined;
export interface XmlStepRendererOptions {
    /** Rust's `summary_chars` knob (default 280); no rendering path reads it there either. */
    summaryChars?: number;
    /** Cap on a current-behavior step's result body (default 4096 chars); `0` disables it. */
    maxResultChars?: number;
    /** Render `started_at_ms` / `ended_at_ms` into history records (default true). */
    timestamps?: boolean;
}
/** Default renderer of the XML behavior protocol (`XmlStepRenderer`). Stateless; share one across runs. */
export declare class XmlStepRenderer implements StepRenderer {
    readonly summaryChars: number;
    readonly maxResultChars: number;
    readonly timestamps: boolean;
    constructor(options?: XmlStepRendererOptions);
    /** History records without wall-clock timestamps (a byte-stable prefix; hosted runs use it). */
    withoutTimestamps(): XmlStepRenderer;
    render(step: StepRecord): [AiMessage, AiMessage];
    renderInherited(step: StepRecord): AiMessage;
    renderSummary(summary: HistorySummaryRecord): AiMessage;
    renderHistory(steps: StepRecord[], currentBehavior: string, summaries: HistorySummaryRecord[]): AiMessage[];
    private renderFull;
}
//# sourceMappingURL=step_renderer.d.ts.map