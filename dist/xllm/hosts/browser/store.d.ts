import type { LLMContextSnapshot, RunRecord } from '../../core/types';
import type { ExportedRun, RunLock, RunStore } from '../../core/store';
export declare const XLLM_RUNS_DB = "xllm-runs";
interface LockLike {
    request(name: string, options: {
        ifAvailable: boolean;
    }, cb: (lock: unknown) => Promise<void>): Promise<void>;
    query(): Promise<{
        held?: {
            name?: string;
        }[];
    }>;
}
export declare class IndexedDbRunStore implements RunStore {
    private readonly options;
    readonly persistent = true;
    private db;
    private readonly localLocks;
    constructor(options?: {
        dbName?: string;
        idb?: IDBFactory;
        locks?: LockLike | null;
    });
    private open;
    private locks;
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
}
export {};
//# sourceMappingURL=store.d.ts.map