import type { AiToolCall, JsonValue, Observation, ToolSpecLite } from '../core/types';
import type { ToolCallCtx } from '../core/deps';
import type { RunBinding, RunToolManager, SiteTool } from './types';
import type { AgentToolResult } from './tool_result';
import type { HintLedger } from './hints';
import type { RunningTaskResolver } from './task_model';
export declare function isIdempotent(tool: SiteTool, args: Record<string, JsonValue>): boolean;
/** The observation of an envelope, hints shown after its text (`map_result_to_observation_with_hints`). */
export declare function envelopeObservation(callId: string, result: AgentToolResult, hints: string[]): Observation;
export interface SiteManagerOptions {
    /** The run's task backend (`XllmDeps.tasks`): pending results are waited for through it. */
    tasks?: RunningTaskResolver;
    /** In-call wait budget for a pending task (`runtime.task_wait_ms`). */
    taskWaitMs?: number;
    hints?: HintLedger;
}
export declare class SiteToolManager implements RunToolManager {
    private readonly tools;
    private readonly options;
    private binding;
    private recovering;
    private readonly ledger;
    private readonly taskWaitMs;
    constructor(tools: Map<string, SiteTool>, options?: SiteManagerOptions);
    bindRun(binding: RunBinding): void;
    setRecovering(callId: string, reason: string): void;
    artifacts(): string[];
    has(name: string): boolean;
    hintLedger(): HintLedger;
    clearDedup(): void;
    taskResolver(): RunningTaskResolver | undefined;
    listToolSpecs(): ToolSpecLite[];
    private takeRecovering;
    callTool(call: AiToolCall, ctx: ToolCallCtx): Promise<Observation>;
    /** A pending result: wait in the call within the budget, then the task's state. */
    private waitPending;
}
//# sourceMappingURL=site_manager.d.ts.map