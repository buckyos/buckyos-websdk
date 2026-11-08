import type { LLMContextSnapshot, RunRecord, RunsDirSetting } from '../../core/types';
import type { ExportedRun, RunLock, RunStore } from '../../core/store';
/** `DEFAULT_RUNS_DIR` / `DEFAULT_LOCK_DIR`. */
export declare const DEFAULT_RUNS_DIR = "~/.xllm/runs";
export declare const DEFAULT_LOCK_DIR = "~/.xllm/locks";
/** `resolve_config_path`: `~` is the home directory, an absolute path stays, a relative one is under `baseDir`. */
export declare function resolveHostPath(raw: string, baseDir: string): string;
/**
 * Where the runs of a configuration go: `runs_dir` of the `.llm_context`
 * (`none` → `undefined`, a memory store), else `~/.xllm/runs`. `origin` is
 * the configuration's path (relative `runs_dir` is relative to its
 * directory).
 */
export declare function runsDirOf(setting: RunsDirSetting | undefined, origin: string): string | undefined;
/** A held flock; `release` (or process exit) frees it. */
export declare class FileLock implements RunLock {
    private readonly file;
    readonly path: string;
    private released;
    private constructor();
    /** Non-blocking (`FileLock::try_acquire`): `null` when another open file holds it. */
    static tryAcquire(path: string): Promise<FileLock | null>;
    release(): Promise<void>;
}
/** Some open file holds the flock at `path` (`is_run_live`). */
export declare function isLocked(path: string): Promise<boolean>;
export declare class FileRunStore implements RunStore {
    readonly persistent = true;
    private readonly dir;
    /** `runsDir`: absolute, or relative to the current directory; `~` is the home directory. */
    constructor(runsDir: string);
    runsDir(): string;
    runDir(runId: string): string;
    /** The runs directory can be created and written (`ensure_writable`). */
    ensureWritable(): Promise<void>;
    createRun(): Promise<string>;
    writeRecord(record: RunRecord): Promise<void>;
    /** Rejects with `run_not_found`, `not_resumable` (another record version, like Rust) or `corrupted_run`. */
    readRecord(runId: string): Promise<RunRecord>;
    listRecords(): Promise<RunRecord[]>;
    putSnapshot(runId: string, snapshot: LLMContextSnapshot): Promise<number>;
    getSnapshot(runId: string, idx: number): Promise<LLMContextSnapshot>;
    listSnapshots(runId: string): Promise<number[]>;
    /** The run's execution lock (`<run>/.lock`), `null` when another process (or open file) holds it. */
    lockRun(runId: string): Promise<FileLock | null>;
    /** Some process holds the run's `.lock` (`is_run_live`). */
    isRunLive(runId: string): Promise<boolean>;
    /** Delete the run directory; the caller holds its lock and has nothing unreconciled in flight. */
    removeRun(runId: string): Promise<void>;
    /** Write a run exported from another store: same id, same snapshot indices. */
    importRun(run: ExportedRun): Promise<void>;
}
/**
 * `XllmDeps.lockWorkdir` of a host with a filesystem: the flock
 * `<lockDir>/<blake3(workdir)[..24]>.lock`, the run id written into it.
 */
export declare function workdirLocker(lockDir?: string): (workdir: string, runId: string) => Promise<RunLock | null>;
/** `XllmDeps.workdirExists`. */
export declare function workdirExists(workdir: string): Promise<boolean>;
//# sourceMappingURL=store.d.ts.map