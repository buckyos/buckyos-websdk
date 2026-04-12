/**
 * Inline Web Worker for SHA-256 hashing of file chunks.
 *
 * The worker receives a File and a chunk size, reads each chunk via
 * `Blob.slice().arrayBuffer()`, hashes it with `crypto.subtle.digest`,
 * and posts back per-chunk results and progress updates so that the main
 * thread stays unblocked.
 */
export interface ChunkHashResult {
    index: number;
    hash: Uint8Array;
    offset: number;
    length: number;
}
export interface WorkerHashSession {
    /**
     * A promise that resolves with all chunk hashes in order once the
     * worker finishes processing the file.
     */
    result: Promise<ChunkHashResult[]>;
    /**
     * Register a callback that fires after each chunk is hashed.
     * The callback receives the cumulative bytes hashed so far.
     */
    onProgress: (cb: (bytesHashed: number) => void) => void;
}
/**
 * Check whether inline Blob-URL workers are available in the current
 * environment (browser with Worker + crypto.subtle support).
 */
export declare function isHashWorkerAvailable(): boolean;
/**
 * Hash a file's chunks in a Web Worker.  Returns a session object whose
 * `.result` promise resolves with all chunk hashes, and whose
 * `.onProgress()` method lets callers observe per-chunk progress.
 */
export declare function hashFileInWorker(file: File, chunkSize: number): WorkerHashSession;
//# sourceMappingURL=hash_worker.d.ts.map