import type { JsonValue } from '../core/types';
export declare const AGENT_TOOL_PROTOCOL_VERSION = "1";
export type AgentToolStatus = 'success' | 'error' | 'pending';
export interface ResultHint {
    text: string;
    /** Shown once while a result that showed it is in the context (`hints_once` in run.json). */
    once?: string;
}
export interface ResultDedup {
    key: string;
    hint: string;
}
export interface AgentToolResult {
    agent_tool_protocol: string;
    tool?: string;
    cmd_name?: string;
    status: AgentToolStatus;
    task_id?: string;
    pending_reason?: string;
    /** Seconds after which the caller should look again; a runtime only uses it to shorten its wait. */
    check_after?: number;
    estimated_wait?: string;
    title?: string;
    summary: string;
    detail: JsonValue;
    cmd_args?: string;
    return_code?: number;
    partial_output?: string;
    output?: string;
    hints?: ResultHint[];
    dedup?: ResultDedup;
}
/** A return value that is an AgentToolResult envelope (`agent_tool_protocol: "1"`). */
export declare function asToolResult(value: unknown): AgentToolResult | undefined;
/**
 * `result_view::full_text`: what a result shows in full, the same in both
 * loops: the output, else a string detail, the summary, the title; a
 * structured detail only when none of them is there (compact JSON within the
 * per-result budget). An error shows its summary with its output.
 */
export declare function fullText(isError: boolean, output: string | undefined, detail: JsonValue | undefined, summary: string, title: string): string;
/** The text the model sees (`AgentToolResult::observation_text`). */
export declare function observationText(r: AgentToolResult): string;
/**
 * `fit_result_budget`: keep `r` (mutated) within `budget` tokens before the
 * dispatcher maps it; the summary takes at most a quarter. A result cut here
 * is not shown in full, so its dedup key is dropped.
 */
export declare function fitResultBudget(r: AgentToolResult, budget?: number): void;
/** The envelope as `Observation.host` (`to_host`). */
export declare function toHost(r: AgentToolResult): JsonValue;
//# sourceMappingURL=tool_result.d.ts.map