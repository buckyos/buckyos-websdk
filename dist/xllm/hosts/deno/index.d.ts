import type { JsonValue, LlmClient, RunObserver, Tokenizer } from '../../core/types';
import type { RunStore } from '../../core/store';
import type { PreparedTask, ResumeLimits, ResumeStart, XllmDeps } from '../../core/run';
import type { TaskInput, TaskOverrides } from '../../core/prepare';
import type { AgentRuntime } from '../../runtime/types';
export { FileLock, FileRunStore, DEFAULT_LOCK_DIR, DEFAULT_RUNS_DIR, isLocked, resolveHostPath, runsDirOf, workdirExists, workdirLocker } from './store';
export { HOST_ID_ENV, blake3Hex, deriveRuntimeId, nativeHostId, nativeHostIdFrom, nativeTarget, runtimeIdOf, targetText, workdirLockPath, } from './identity';
export type { HostIdInputs } from './identity';
export { LOCAL_PROBE, NATIVE_KIND, NativeToolManager, createNativeRuntime, interruptedShellText, localProbe, nativeDescriptor, parseProbe, readExecDir, } from './native_runtime';
export type { ExecDirFacts, NativeRuntime, NativeRuntimeOptions, Probe } from './native_runtime';
export { BASH_GROUP_TOOLS, EDIT_FILE_SPEC, EXEC_MAX_OUTPUT_BYTES, NATIVE_WRAPPER, READ_FILE_SPEC, WRITE_FILE_SPEC, execDirFor, fmtElapsed, sanitizeCallId, shellSpec, } from './native_tools';
export { SESSION_TOKEN_ENV, createLlmClient, credentialsRefusedClient, resolveSecret } from './provider';
export interface NativeHostOptions {
    /** The model client; default: built from the run's provider configuration (`createLlmClient`). */
    llm?: LlmClient;
    observer?: RunObserver;
    tokenizer?: Tokenizer;
    /** Directory of the working-directory locks (default `~/.xllm/locks`). */
    lockDir?: string;
}
/** `XllmDeps` of a native run on this host: flock working-directory locks, this process's pid. */
export declare function nativeDeps(runtime: AgentRuntime, store: RunStore, llm: LlmClient, options?: NativeHostOptions): XllmDeps;
export interface NativeTaskOptions extends NativeHostOptions {
    /** The control-side working directory: where `runtime.workdir` defaults to (default: the current directory). */
    workdir?: string;
    /** Default: the configuration's `runs_dir` (`none` → memory), else `~/.xllm/runs`. */
    store?: RunStore;
}
/**
 * Prepare a new native task (`XllmTask.prepare` with this host's runtime,
 * store and model client): one JSON configuration (`origin` names it and
 * anchors relative paths), the input and explicit overrides.
 */
export declare function prepareNativeTask(llmContext: JsonValue | undefined, origin: string, input: TaskInput, overrides: TaskOverrides, options?: NativeTaskOptions): Promise<{
    task: PreparedTask;
    deps: XllmDeps;
}>;
/**
 * Take a run back on this host (`XllmRun.resume` with the native runtime
 * rebuilt from the saved `config.runtime`, the saved tool sources and specs,
 * and a model client from the saved provider). Works the same for runs a
 * Rust executor started: whether it can be taken over is decided by the
 * resume gate — record and snapshot versions, protocol, lock, descriptor
 * equality, rebuildable tools — not by who wrote it.
 */
export declare function resumeNativeRun(store: RunStore, runId: string, limits?: ResumeLimits, options?: NativeHostOptions): Promise<ResumeStart>;
//# sourceMappingURL=index.d.ts.map