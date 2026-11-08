import type { LLMContextSnapshot, RunRecord } from './types';
export declare const RUN_RECORD_VERSION = 7;
/** Held while a run executes; releasing it lets another executor take the run. */
export interface RunLock {
    release(): void | Promise<void>;
}
/** A run with every snapshot, as moved between stores. */
export interface ExportedRun {
    record: RunRecord;
    /** `[index, snapshot]`, ascending. */
    snapshots: [number, LLMContextSnapshot][];
}
export interface RunStore {
    /** Runs survive this process (a directory, IndexedDB …). */
    readonly persistent: boolean;
    runsDir(): string | undefined;
    runDir(runId: string): string | undefined;
    createRun(): Promise<string>;
    writeRecord(record: RunRecord): Promise<void>;
    /** Rejects with `run_not_found` / `not_resumable` (other version) / `corrupted_run`. */
    readRecord(runId: string): Promise<RunRecord>;
    listRecords(): Promise<RunRecord[]>;
    /** Stores the next snapshot and returns its index (1, 2, …). */
    putSnapshot(runId: string, snapshot: LLMContextSnapshot): Promise<number>;
    getSnapshot(runId: string, idx: number): Promise<LLMContextSnapshot>;
    listSnapshots(runId: string): Promise<number[]>;
    /** The run's execution lock, `null` when another executor holds it. */
    lockRun(runId: string): Promise<RunLock | null>;
    /** Some executor holds the run's lock. */
    isRunLive(runId: string): Promise<boolean>;
    removeRun(runId: string): Promise<void>;
    /** Write a run exported from another store (same id, same snapshot indices). */
    importRun(run: ExportedRun): Promise<void>;
}
/** `YYYYMMDD-HHMMSS-<6 hex>`: local time for reading, a random suffix against collisions. */
export declare function generateRunId(now?: Date): string;
export declare function exportRun(store: RunStore, runId: string): Promise<ExportedRun>;
export declare function importRun(store: RunStore, run: ExportedRun): Promise<void>;
export declare class MemoryRunStore implements RunStore {
    readonly persistent = false;
    private readonly records;
    private readonly snapshots;
    private readonly locks;
    runsDir(): string | undefined;
    runDir(): string | undefined;
    createRun(): Promise<string>;
    writeRecord(record: RunRecord): Promise<void>;
    readRecord(runId: string): Promise<RunRecord>;
    listRecords(): Promise<RunRecord[]>;
    putSnapshot(runId: string, snapshot: LLMContextSnapshot): Promise<number>;
    getSnapshot(runId: string, idx: number): Promise<LLMContextSnapshot>;
    listSnapshots(runId: string): Promise<number[]>;
    lockRun(runId: string): Promise<RunLock | null>;
    isRunLive(runId: string): Promise<boolean>;
    removeRun(runId: string): Promise<void>;
    importRun(run: ExportedRun): Promise<void>;
    /** `exportRun` on this store. */
    exportRun(runId: string): Promise<ExportedRun>;
}
//# sourceMappingURL=store.d.ts.map