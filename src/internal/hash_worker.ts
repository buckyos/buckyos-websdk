/**
 * Inline Web Worker for SHA-256 hashing of file chunks.
 *
 * The worker receives a File and a chunk size, reads each chunk via
 * `Blob.slice().arrayBuffer()`, hashes it with `crypto.subtle.digest`,
 * and posts back per-chunk results and progress updates so that the main
 * thread stays unblocked.
 */

// ---- Worker source (stringified and loaded via Blob URL) ----

const WORKER_SOURCE = /* js */ `
"use strict";
self.onmessage = async function (e) {
    var file = e.data.file;
    var chunkSize = e.data.chunkSize;
    var fileSize = file.size;
    try {
        var offset = 0;
        var index = 0;
        while (offset < fileSize) {
            var end = Math.min(offset + chunkSize, fileSize);
            var buf = await file.slice(offset, end).arrayBuffer();
            var hashBuf = await crypto.subtle.digest("SHA-256", buf);
            var hash = new Uint8Array(hashBuf);
            self.postMessage(
                { type: "chunk", index: index, hash: hash, offset: offset, length: end - offset },
                [hashBuf]
            );
            offset = end;
            index++;
        }
        self.postMessage({ type: "done" });
    } catch (err) {
        self.postMessage({ type: "error", message: err && err.message ? err.message : String(err) });
    }
};
`

// ---- Public helpers ----

export interface ChunkHashResult {
    index: number
    hash: Uint8Array
    offset: number
    length: number
}

export interface WorkerHashSession {
    /**
     * A promise that resolves with all chunk hashes in order once the
     * worker finishes processing the file.
     */
    result: Promise<ChunkHashResult[]>
    /**
     * Register a callback that fires after each chunk is hashed.
     * The callback receives the cumulative bytes hashed so far.
     */
    onProgress: (cb: (bytesHashed: number) => void) => void
}

let cachedWorkerUrl: string | null = null

function getWorkerBlobUrl(): string {
    if (!cachedWorkerUrl) {
        const blob = new Blob([WORKER_SOURCE], { type: 'application/javascript' })
        cachedWorkerUrl = URL.createObjectURL(blob)
    }
    return cachedWorkerUrl
}

/**
 * Check whether inline Blob-URL workers are available in the current
 * environment (browser with Worker + crypto.subtle support).
 */
export function isHashWorkerAvailable(): boolean {
    return (
        typeof Worker !== 'undefined' &&
        typeof Blob !== 'undefined' &&
        typeof URL !== 'undefined' &&
        typeof URL.createObjectURL === 'function' &&
        typeof crypto !== 'undefined' &&
        typeof crypto.subtle !== 'undefined'
    )
}

/**
 * Hash a file's chunks in a Web Worker.  Returns a session object whose
 * `.result` promise resolves with all chunk hashes, and whose
 * `.onProgress()` method lets callers observe per-chunk progress.
 */
export function hashFileInWorker(file: File, chunkSize: number): WorkerHashSession {
    let progressCb: ((bytesHashed: number) => void) | null = null
    let cumulativeBytes = 0
    const chunks: ChunkHashResult[] = []

    const result = new Promise<ChunkHashResult[]>((resolve, reject) => {
        let worker: Worker
        try {
            worker = new Worker(getWorkerBlobUrl())
        } catch {
            reject(new Error('Failed to create hash worker'))
            return
        }

        worker.onmessage = (e: MessageEvent) => {
            const msg = e.data
            if (msg.type === 'chunk') {
                const r: ChunkHashResult = {
                    index: msg.index,
                    hash: msg.hash,
                    offset: msg.offset,
                    length: msg.length,
                }
                chunks.push(r)
                cumulativeBytes += r.length
                if (progressCb) progressCb(cumulativeBytes)
            } else if (msg.type === 'done') {
                worker.terminate()
                resolve(chunks)
            } else if (msg.type === 'error') {
                worker.terminate()
                reject(new Error(msg.message ?? 'Worker hash error'))
            }
        }

        worker.onerror = (err) => {
            worker.terminate()
            reject(new Error(err.message ?? 'Worker error'))
        }

        worker.postMessage({ file, chunkSize })
    })

    return {
        result,
        onProgress(cb) {
            progressCb = cb
        },
    }
}
