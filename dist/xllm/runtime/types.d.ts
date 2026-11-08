import type { AiToolCall, EffectiveTools, JsonValue, LoopModel, RuntimeConfig, RuntimeDescriptor, RuntimeInfo, ToolsConfig } from '../core/types';
import type { ToolManager } from '../core/deps';
import type { HintLedger } from './hints';
import type { RunningTaskResolver } from './task_model';
/** The run a tool set is bound to; `run_dir` only where runs live in a directory. */
export interface RunBinding {
    run_id: string;
    run_dir?: string;
}
export interface RuntimeOpenCtx {
    workdir: string;
    run_id: string;
    loop_model: LoopModel;
    /** Field → where it was decided (`EffectiveTools.sources`). */
    sources: Record<string, string>;
    env: Record<string, string>;
    /** The run's task backend (`XllmDeps.tasks`). */
    tasks?: RunningTaskResolver;
    /** In-call wait budget for tasks (`runtime.task_wait_ms`). */
    task_wait_ms: number;
}
/** The tool dispatcher of one run (Rust `XllmToolManager` / `Sandbox`). */
export interface RunToolManager extends ToolManager {
    /** Bind the tools to the run once its id is known. */
    bindRun(binding: RunBinding): void;
    /**
     * Resume: `callId` may have been started by a previous executor; `reason`
     * is the runtime's account of it. When the waist dispatches it again the
     * manager looks for its result first, runs it again only when the tool is
     * idempotent, and otherwise answers `unresolved` with `reason`.
     */
    setRecovering(callId: string, reason: string): void;
    /** Paths written by the run's tools (`RunRecord.artifacts`). */
    artifacts(): string[];
    /** Names this manager can dispatch. */
    has(name: string): boolean;
    /** What the model was shown of results' hints (`hints_once` in run.json, `dedup` per history). */
    hintLedger(): HintLedger;
    /** The history was rewritten (compaction): results shown before are shown again. */
    clearDedup(): void;
    /** Tasks of this run; a running one at a function-call reply pauses the run. */
    taskResolver(): RunningTaskResolver | undefined;
}
export interface OpenedTools {
    tools: EffectiveTools;
    manager: RunToolManager;
}
export interface AgentRuntime {
    /** Identity of the execution target; a resume requires it equal to the saved one. */
    descriptor(): RuntimeDescriptor;
    /** The configuration the runtime was opened with (saved in run.json). */
    config(): RuntimeConfig;
    /** Environment facts for prompts (`{{runtime.*}}`). */
    info(): Promise<RuntimeInfo>;
    /** The tools of one run; `tools` (the configuration) can only select from what the runtime has. */
    open(ctx: RuntimeOpenCtx, tools: ToolsConfig): Promise<OpenedTools>;
    /** The account given to the model for a call that may have run before the previous executor stopped. */
    describeInterrupted(run: RunBinding, call: AiToolCall): Promise<string>;
    /** `{{env.NAME}}`: only what the runtime was given explicitly. */
    env?(name: string): string | undefined;
}
/** Text shown for a call (other than `shell`) a previous executor may have started. */
export declare function unresolvedReason(tool: string): string;
/** Context of one site tool call. */
export interface SiteToolCtx {
    run_id: string;
    call_id: string;
    /** Aborts on interrupt (and when the run deadline passed). */
    signal: AbortSignal;
}
export interface SiteToolSpec {
    description: string;
    /** JSON Schema of the arguments (an object schema). */
    args_schema: JsonValue;
}
/**
 * A tool the page provides: a plain JS function of the page. Its return value
 * is the result (a string as is, anything else as JSON); a thrown error is a
 * failed call the model sees.
 */
export interface SiteTool {
    spec: SiteToolSpec;
    call(args: Record<string, JsonValue>, ctx: SiteToolCtx): unknown;
    /**
     * Running it again with the same arguments has no further effect (or the
     * tool deduplicates by `call_id`): on resume an interrupted call is run
     * again. Otherwise it gets `unresolved` with `describeInterrupted`'s text.
     */
    idempotent?: boolean | ((args: Record<string, JsonValue>) => boolean);
    /** What became of an interrupted call (read the page's state); default: a generic "effect unknown". */
    describeInterrupted?(args: Record<string, JsonValue>, ctx: SiteToolCtx): string | Promise<string>;
    /**
     * The tool stops its work when `ctx.signal` aborts and then rejects: its
     * effect is known (not done). Without it an interrupted call is abandoned
     * and its effect is unknown.
     */
    cancellable?: boolean;
}
//# sourceMappingURL=types.d.ts.map