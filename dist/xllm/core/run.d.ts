import type { AiContent, AiMessage, BudgetKind, EffectiveConfig, EffectiveTools, FileStagePlan, HostPromptSections, HostProtocolFlavor, InputRecord, JsonValue, LLMComputeError, LLMContextOutcome, LLMContextRequest, LLMContextSnapshot, LlmClient, LoopModel, PromptPlan, RunErrorRecord, RunLimits, RunObserver, RunRecord, RunStatus, Tokenizer, ToolPolicy } from './types';
import { LLMContext, DEFAULT_WRAP_UP_ROUNDS } from './loop';
import { TemplateEnv } from './prompt';
import type { RunLock, RunStore } from './store';
import type { TaskInput, TaskOverrides } from './prepare';
import type { AgentRuntime, RunToolManager } from '../runtime/types';
import type { RunningTaskResolver } from '../runtime/task_model';
export declare const REFUSED_CREDENTIALS = "credentials";
export declare const HOST_PROMPT_SECTIONS_ALL: HostPromptSections;
export declare const HOST_PROMPT_SECTIONS_NONE: HostPromptSections;
/** What a run executes with; `llm` and `runtime` come from the host (the page), never from configuration. */
export interface XllmDeps {
    llm: LlmClient;
    runtime: AgentRuntime;
    store: RunStore;
    observer?: RunObserver;
    tokenizer?: Tokenizer;
    /** Sections a hosted run appends after the host's system text (default: all). */
    hostPromptSections?: HostPromptSections | 'NONE' | 'ALL';
    /** Opening of a hosted run's runtime protocol (default one-shot). */
    hostProtocol?: HostProtocolFlavor;
    /** Process id written to run.json (0 where there is none, e.g. a browser page). */
    pid?: number;
    /** Working-directory lock of tool-enabled runs (hosts with a filesystem). */
    lockWorkdir?(workdir: string, runId: string): Promise<RunLock | null>;
    /** The control-side working directory still exists (hosts with a filesystem; default: yes). */
    workdirExists?(workdir: string): Promise<boolean>;
    /** The run's task backend: pending tool results are waited for through it (runtime layer). */
    tasks?: RunningTaskResolver;
}
/** A host-assembled task: the host's system text, xllm's sections after it (`prepare_hosted`). */
export interface HostedTask {
    readonly kind: 'hosted';
    readonly origin: string;
    readonly workdir: string;
    readonly config: EffectiveConfig;
    readonly prompt: PromptPlan;
    /** @internal */
    readonly manager: RunToolManager;
}
/** A task xllm assembled itself (`prepare`): its user input is part of it. */
export interface PreparedTask {
    readonly kind: 'prepared';
    readonly workdir: string;
    readonly config: EffectiveConfig;
    readonly prompt: PromptPlan;
    readonly input: InputRecord;
    readonly summary: string;
    readonly initialMessages: AiMessage[];
    readonly mainUserParts: AiContent[];
    readonly fileStage?: FileStagePlan;
    /** @internal */
    readonly manager: RunToolManager;
}
/** The waist tool policy of a run (`hosted_request` / `build_initial_context`). */
export declare function runToolPolicy(cfg: EffectiveConfig): ToolPolicy;
/** The waist request of a run. `hosted`: a JSON reply is a contract with one repair (`hosted_request`). */
export declare function runRequest(cfg: EffectiveConfig, owner: JsonValue, trace: string, objective: string, behaviorName: string, input: AiMessage[], hosted: boolean): LLMContextRequest;
/** The loop a hosted run may use (`check_hosted_loop`). */
export declare function checkHostedLoop(origin: string, sections: HostPromptSections, loopModel: LoopModel, json: boolean): void;
/**
 * A hosted run's system prompt (`assemble_hosted_system`): the host's text
 * rendered with `env` (no `current_time` / `timezone`), then the sections.
 */
export declare function assembleHostedSystem(hostSystem: string, origin: string, env: TemplateEnv, sections: HostPromptSections, flavor: HostProtocolFlavor, loopModel: LoopModel, tools: EffectiveTools, json: boolean): {
    system_prompt: string;
    runtime_protocol: string;
    rendered_host: string;
    template_vars: Record<string, string>;
};
export declare function limitReason(which: BudgetKind, limits: Pick<RunLimits, 'max_tool_iterations' | 'timeout_secs'>): string;
/**
 * Run state an outcome ends a function-call run in when nothing else applies
 * (no running task, nothing to compact) — Rust `run_step` + `RunStep::status`.
 */
export declare function outcomeRunStatus(outcome: LLMContextOutcome, limits: Pick<RunLimits, 'max_tool_iterations' | 'timeout_secs'>): {
    status: RunStatus;
    kind?: string;
    limit_reason?: string;
};
export declare class XllmTask {
    /**
     * Prepare a task xllm assembles itself (`XllmTask::prepare`): `llmContext`
     * is the one JSON configuration (no discovery), `overrides` the explicit
     * arguments, `input` the request, materials and images.
     */
    static prepare(llmContext: JsonValue | undefined, origin: string, input: TaskInput, overrides: TaskOverrides, deps: XllmDeps): Promise<PreparedTask>;
    /**
     * Prepare a host-assembled task (`prepare_hosted`): `llmContext` is the
     * JSON form of an `.llm_context` (strict keys; `origin` names it in
     * diagnostics), `hostSystem` the host's system text; xllm appends its
     * `capabilities` / `cmd_manual` / `runtime_protocol` sections as
     * `deps.hostPromptSections` allows.
     */
    static prepareHosted(llmContext: JsonValue | undefined, origin: string, hostSystem: string, deps: XllmDeps): Promise<HostedTask>;
}
export interface RunOutcome {
    status: RunStatus;
    record: RunRecord;
}
export interface ResumeLimits {
    max_tokens?: number;
    max_tool_iterations?: number;
    timeout_secs?: number;
    llm_timeout_secs?: number;
}
export type ResumeStart = {
    kind: 'terminal';
    record: RunRecord;
} | {
    kind: 'run';
    run: XllmRun;
};
/** External interrupt handle of a run (Ctrl-C semantics; `finish` settles gracefully). */
export declare class XllmInterrupter {
    /** @internal */ requested: string | undefined;
    /** @internal */ handle: {
        interrupt(r: string): boolean;
        finish(r: string): boolean;
    } | undefined;
    interrupt(reason: string): void;
    finish(reason: string): void;
}
export interface StartOptions {
    /** The user input of a hosted task (text or messages). */
    input?: string | AiMessage[];
    /** Task summary in run.json (default: the first line of the input). */
    summary?: string;
}
/** One run's execution handle. */
export declare class XllmRun {
    private readonly store;
    private readonly deps;
    private readonly manager;
    readonly runId: string;
    private record;
    private ctx;
    private limitSnapshot;
    private readonly interrupterState;
    private readonly llm;
    private countedCalls;
    private lock;
    private workdirLock;
    private readonly waistDeps;
    private readonly hosted;
    private initialMessages;
    private fileStage;
    private mainUserParts;
    private constructor();
    /** Create the run: allocate its id, take its locks, write run.json before the first model request. */
    static start(task: HostedTask | PreparedTask, deps: XllmDeps, options?: StartOptions): Promise<XllmRun>;
    /**
     * Take a run back (`XllmRun::resume`). A terminal run only returns its
     * record. Records and snapshots from a store are not trusted: the tools
     * they name must be tools of this runtime, the model is the host's client.
     */
    static resume(store: RunStore, runId: string, limits: ResumeLimits, deps: XllmDeps): Promise<ResumeStart>;
    /** The current run record. */
    currentRecord(): RunRecord;
    interrupter(): XllmInterrupter;
    /**
     * Give a paused or interrupted run a new input (`XllmRun::inject_input` /
     * `xllm --resume "<message>"`): appended at the boundary the run stopped
     * at and committed before the run continues.
     */
    injectInput(text: string): Promise<void>;
    /** Release the run's locks without executing (a run that will not continue in this executor). */
    release(): Promise<void>;
    /** Drive the run to this command's stopping point. */
    execute(): Promise<RunOutcome>;
    private executeLocked;
    private handleOutcome;
    /**
     * Compact a context suspended at the context limit and resume it (at most
     * 3 compactions per run). The compacted context is committed before it
     * runs; an outcome ends this command.
     */
    private compactContext;
    private buildInitialContext;
    /** The file-model stage: images analysed by `file_model`; the main model gets the analysis instead of the images. */
    private runFileStage;
    private finishWithResponse;
    private interrupted;
    /** @internal */
    setCtx(ctx: LLMContext): void;
    private addCalls;
    private outcome;
    private update;
    private commit;
    private emit;
}
export declare function isTerminal(s: RunStatus): boolean;
/** The call a resumed snapshot dispatches first that the previous executor may have started (`in_flight_call`). */
export declare function inFlightCall(snapshot: LLMContextSnapshot): import("./types").AiToolCall | undefined;
/** Run error of a waist error (`classify_error`): kind, whether `resume` can fix it, and how. */
export declare function classifyError(err: LLMComputeError): RunErrorRecord;
export { DEFAULT_WRAP_UP_ROUNDS };
//# sourceMappingURL=run.d.ts.map