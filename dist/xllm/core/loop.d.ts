import type { AiMessage, AiResponse, AiToolCall, AiUsage, CancelCause, ContextLimitKind, ContextRunTrace, Injection, InjectionPosition, LLMComputeError, LLMContextOutcome, LLMContextRequest, LLMContextSnapshot, LLMContextState, LlmInferenceRequest, Observation, ResumeFill, Suspension, ToolExecRecord, ToolExecStatus } from './types';
import type { JsonValue } from './types';
import { ResolvedDeps, ToolCallCtx, ToolDispatchException } from './deps';
import type { LLMContextDeps } from './deps';
import { AbortState, LLMContextInterruptHandle } from './interrupt';
/** Current snapshot format; `resume` accepts only this version. */
export declare const SNAPSHOT_FORMAT_VERSION = 6;
export declare const DEFAULT_WRAP_UP_ROUNDS = 2;
export declare function stateFromRequest(req: LLMContextRequest, startedAtMs: number): LLMContextState;
export declare class LLMContext {
    /** @internal */ request: LLMContextRequest;
    /** @internal */ state: LLMContextState;
    /** @internal */ readonly deps: ResolvedDeps;
    /** @internal */ toolTrace: ToolExecRecord[];
    /** @internal */ lastResponse: AiResponse;
    /** @internal */ readonly abort: AbortState;
    /** @internal Behavior step inner contexts: parser of native reports, outer hook and parent snapshot. */
    nativeResultParser?: ResolvedDeps['resultParser'];
    /** @internal */ toolCheckpointHook?: ResolvedDeps['checkpointHook'];
    /** @internal */ innerParent?: {
        parent: LLMContextSnapshot;
        prefixLen: number;
    };
    constructor(request: LLMContextRequest, deps: LLMContextDeps, abort?: AbortState);
    /**
     * Resume from a snapshot. `fill` must match the snapshot's suspension;
     * everything is validated before the context exists (rejects with an
     * `LLMComputeException` carrying `snapshot_corrupted`).
     */
    static resume(snapshot: LLMContextSnapshot, fill: ResumeFill, deps: LLMContextDeps): LLMContext;
    interruptHandle(): LLMContextInterruptHandle;
    snapshot(): LLMContextSnapshot;
    suspension(): Suspension | undefined;
    hostMeta(): JsonValue | undefined;
    setHostMeta(host: JsonValue | undefined): void;
    /** @internal */ isBehaviorMode(): boolean;
    /**
     * Append user messages to the live context (between runs, or from the
     * checkpoint hook at an inference boundary). Only valid at an inference
     * boundary: suspended or mid-batch, nothing is placed.
     */
    inject(injection: Injection): InjectionPosition;
    /** @internal Run the checkpoint hook at an inference boundary; an outcome stops the run. */
    runCheckpointHook(): Promise<LLMContextOutcome | undefined>;
    /** Run the loop until an outcome is produced. */
    run(): Promise<LLMContextOutcome>;
    /** @internal The function call loop. */
    runInner(): Promise<LLMContextOutcome>;
    /** @internal One inference raced against the interrupt. */
    infer(req: LlmInferenceRequest): Promise<{
        kind: 'ok';
        response: AiResponse;
    } | {
        kind: 'error';
        error: LLMComputeError;
    } | {
        kind: 'aborted';
    }>;
    private acceptNativeReport;
    /** @internal The outer snapshot handed to the hook before a tool call. */
    toolCheckpointSnapshot(): LLMContextSnapshot;
    /** @internal */
    checkpointBeforeToolCall(): Promise<LLMContextOutcome | undefined>;
    /**
     * Dispatch `state.tool_batch` serially, each call after a checkpoint.
     * Business errors do not stop the batch; infrastructure failures do and
     * the calls that never ran are answered as `unresolved`.
     */
    private runToolBatch;
    /** @internal End the batch in progress, returning its undispatched calls. */
    takeBatchRest(): AiToolCall[];
    /** @internal Context of one tool call; `release` clears its timers. */
    toolCallCtx(): {
        ctx: ToolCallCtx;
        release: () => void;
    };
    /**
     * Dispatch one call. A graceful finish requested while the tool runs
     * becomes an interrupt once `finish_grace_ms` passed without the tool
     * returning.
     */
    dispatchTool(call: AiToolCall, ctx: ToolCallCtx): Promise<{
        ok: Observation;
    } | {
        err: ToolDispatchException;
    }>;
    /** @internal After a legitimate inline `cancelled`: end the run according to `cause`. */
    stopAfterCancel(cause: CancelCause): LLMContextOutcome;
    /** @internal */
    finishInterruptedAfterTool(): LLMContextOutcome;
    /** @internal */
    finishSettled(): LLMContextOutcome;
    /** @internal Answer `remaining` with `cancelled { effect_unknown: false }` (never started). */
    cancelToolBatch(remaining: AiToolCall[], reason: string): void;
    /** @internal Suspend with `context_limit_reached` at an inference boundary. */
    suspendContextLimit(which: ContextLimitKind, estimated: number | undefined, history: AiMessage[]): LLMContextOutcome;
    /** @internal An `error` for a run that must not start; leaves the state untouched. */
    refuse(message: string): LLMContextOutcome;
    /** @internal */
    recordTool(call: AiToolCall, status: ToolExecStatus, durationMs: number, error?: string): void;
    /** @internal Answer `remaining` with `unresolved { effect_unknown: false }`. */
    abortToolBatch(remaining: AiToolCall[], reason: string): void;
    private abortStartedCall;
    /** @internal Push the assistant message and answer each call with an error carrying `reason`. */
    rejectToolBatch(message: AiMessage, calls: AiToolCall[], reason: string): void;
    /** @internal */
    buildInferenceRequest(): LlmInferenceRequest;
    /** @internal Wrap-up mode: tool iterations used up, wrap-up batches left. */
    inWrapUp(): boolean;
    /** @internal A batch of only wrap-up tools may run without a tool iteration. */
    admitsWrapUp(names: string[]): boolean;
    /** @internal */
    accountResponse(response: AiResponse): void;
    /** @internal */
    checkWallclockBudget(): LLMContextOutcome | undefined;
    /** @internal */
    checkTokenBudget(): LLMContextOutcome | undefined;
    /** @internal `interrupted` from the pre-inference snapshot: resuming retries that inference. */
    finishInterrupted(snapshot: LLMContextSnapshot, requestedAtMs: number): LLMContextOutcome;
    /** @internal */
    takeTrace(): ContextRunTrace;
    /** @internal Terminal `error` carrying the audit trace of this run. */
    finishError(error: LLMComputeError): LLMContextOutcome;
    /** `undefined` when the reply must be corrected and another inference run. */
    private finishDone;
    /** @internal */
    handleError(error: LLMComputeError): LLMContextOutcome | undefined;
    /** @internal Count one failed iteration; an outcome when the cap is exceeded. */
    bumpConsecutiveErrors(error: LLMComputeError): LLMContextOutcome | undefined;
    /** @internal */
    emit(event: Parameters<ResolvedDeps['worklog']['emit']>[0]): Promise<void>;
    /** @internal Usage of this context so far. */
    usage(): AiUsage;
}
//# sourceMappingURL=loop.d.ts.map