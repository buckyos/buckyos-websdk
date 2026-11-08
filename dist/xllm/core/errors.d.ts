import type { ErrorSource, LLMComputeError, ProviderFailure, RunStatus } from './types';
/** A rejected `LlmClient.infer` (or any waist dependency) carries its `LLMComputeError`. */
export declare class LLMComputeException extends Error {
    readonly error: LLMComputeError;
    constructor(error: LLMComputeError);
}
export declare function providerError(failure: ProviderFailure, message: string): LLMComputeException;
/** What a dependency rejected with, as an `LLMComputeError`. A foreign error is a provider failure of unknown class. */
export declare function asComputeError(error: unknown): LLMComputeError;
/** Same text as Rust's `Display for LLMComputeError` (run.json `last_error.message`). */
export declare function computeErrorMessage(e: LLMComputeError): string;
export declare function errorSource(e: LLMComputeError): ErrorSource;
/** Feeding the error back to the model is a meaningful recovery; everything else ends the run. */
export declare function llmCorrectable(e: LLMComputeError): boolean;
export declare function infraRetrySafe(e: LLMComputeError): boolean;
export declare function refusedCode(failure: ProviderFailure): string | undefined;
/** Pre-run errors of the SDK (`XllmError` in Rust): once a run exists, results come back as a `RunOutcome`. */
export type XllmErrorDetail = {
    kind: 'config';
    file: string;
    field: string;
    reason: string;
} | {
    kind: 'input';
    message: string;
} | {
    kind: 'capability';
    message: string;
} | {
    kind: 'runtime_mismatch';
    message: string;
} | {
    kind: 'recovery_blocked';
    message: string;
} | {
    kind: 'tools';
    message: string;
} | {
    kind: 'template';
    origin: string;
    reason: string;
} | {
    kind: 'run_not_found';
    run_id: string;
    runs_dir: string;
} | {
    kind: 'run_busy';
    run_id: string;
} | {
    kind: 'workdir_busy';
    workdir: string;
    run_id: string;
} | {
    kind: 'run_terminal';
    run_id: string;
    status: RunStatus;
    hint: string;
} | {
    kind: 'not_resumable';
    run_id: string;
    reason: string;
} | {
    kind: 'corrupted_run';
    run_id: string;
    reason: string;
} | {
    kind: 'storage';
    message: string;
} | {
    kind: 'extract';
    message: string;
} | {
    kind: 'compressor';
    message: string;
} | {
    kind: 'other';
    message: string;
};
export type XllmErrorKind = XllmErrorDetail['kind'];
export declare class XllmError extends Error {
    readonly detail: XllmErrorDetail;
    constructor(detail: XllmErrorDetail);
    get kind(): XllmErrorKind;
    static config(file: string, field: string, reason: string): XllmError;
    static input(message: string): XllmError;
    static capability(message: string): XllmError;
    static runtimeMismatch(message: string): XllmError;
    static tools(message: string): XllmError;
    static template(origin: string, reason: string): XllmError;
    static notResumable(runId: string, reason: string): XllmError;
    static storage(message: string): XllmError;
    static other(message: string): XllmError;
}
//# sourceMappingURL=errors.d.ts.map