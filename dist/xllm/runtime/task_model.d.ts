import type { JsonValue, Observation } from '../core/types';
export declare const MAX_IN_TOOL_WAIT_MS: number;
export declare const DEFAULT_TASK_WAIT_MS = 25000;
export interface TaskResult {
    success: boolean;
    output: string;
    tool_result?: JsonValue;
}
export type TaskState = {
    kind: 'running';
    brief: string;
    elapsed_ms: number;
    output_tail?: string;
    cancellable: boolean;
} | ({
    kind: 'finished';
} & TaskResult) | {
    kind: 'unknown';
    reason: string;
};
export interface TaskBrief {
    task_id: string;
    brief: string;
    status: string;
    elapsed_ms: number;
    last_line?: string;
    cancellable: boolean;
}
/** How the model follows a task that is still running. */
export type TaskFollowup = {
    kind: 'tools';
} | {
    kind: 'command';
    cli: string;
} | {
    kind: 'input';
    cli?: string;
};
/** The task backend of a run (host-provided; `RunningTaskResolver`). */
export interface RunningTaskResolver {
    state(taskId: string): Promise<TaskState>;
    /** Wait until the task ends or `untilMs` (epoch ms) passes. */
    wait(taskId: string, untilMs: number | undefined, signal?: AbortSignal): Promise<TaskState>;
    cancel?(taskId: string): Promise<TaskState>;
    /** Tasks of this run; a `running` one at a function-call reply pauses the run (`tasks_running`). */
    active(): Promise<TaskBrief[]>;
    watch?(taskId: string): void;
    followup?(): TaskFollowup;
}
export declare function followupHint(f: TaskFollowup, taskId: string, cancellable: boolean): string;
export declare function followupGeneralHint(f: TaskFollowup): string;
/**
 * A result as `ToolResultView` serializes it (`into_host`): only the view's
 * fields, `title` / `summary` / `hints` omitted when empty, `detail` when
 * null or `{}`, the protocol version filled in.
 */
export declare function resultView(fields: Record<string, JsonValue | undefined>): JsonValue;
/** The observation of a task's state (`task_state_observation_via`). */
export declare function taskStateObservation(callId: string, taskId: string, state: TaskState, followup: TaskFollowup): Observation;
/** When an in-call wait ends: the budget, capped at 30 minutes and the run deadline. */
export declare function waitUntilMs(nowMs: number, waitMs: number | undefined, deadlineMs: number | undefined): number;
/** The in-call wait for a pending result: `min(check_after, budget)` (check_after only shortens). */
export declare function inCallWaitMs(checkAfterSecs: number | undefined, budgetMs: number): number;
//# sourceMappingURL=task_model.d.ts.map