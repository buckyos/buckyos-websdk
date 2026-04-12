// Runtime-agnostic ndm_client test cases.
//
// These cases are written against an async Tap interface so they can be
// driven from any runtime: jest (node) wraps each case as `it(...)`, and
// the browser runner in tests/browser/real-browser/ndm_client_runner.ts
// provides its own harness that records pass/fail to the DOM.
//
// Only the pure-browser runtime path is exercised. Cases that require
// NDM Cache, NDM Store, or a live upload endpoint are skipped.

import {
    NdmError,
    setImportProvider,
    getImportProvider,
    pickupAndImport,
    getImportSessionStatus,
    getUploadProgress,
    startUpload,
    ImportProvider,
    RuntimeCapabilities,
    PickupAndImportOptions,
    ImportedFileObject,
    ImportedDirObject,
} from '../src/ndm_client'

// ============================================================
// AsyncTap — minimal cross-runtime assertion interface
// ============================================================

export interface AsyncTap {
    eq<T>(actual: T, expected: T, msg?: string): void
    deepEq(actual: unknown, expected: unknown, msg?: string): void
    truthy(value: unknown, msg?: string): void
    falsy(value: unknown, msg?: string): void
    isNull(value: unknown, msg?: string): void
    throws(fn: () => unknown, kind?: string, msg?: string): void
    rejects(fn: () => Promise<unknown>, code?: string, msg?: string): Promise<void>
}

export interface NdmClientTestCase {
    name: string
    run(t: AsyncTap): Promise<void>
}

// Default tap implementation: throws plain Errors with descriptive messages.
function fmt(value: unknown): string {
    if (value instanceof Uint8Array) {
        return `Uint8Array[${Array.from(value).join(',')}]`
    }
    try {
        return JSON.stringify(value)
    } catch {
        return String(value)
    }
}

function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true
    if (a == null || b == null) return false
    if (typeof a !== typeof b) return false
    if (Array.isArray(a)) {
        if (!Array.isArray(b) || a.length !== b.length) return false
        return a.every((v, i) => deepEqual(v, (b as unknown[])[i]))
    }
    if (typeof a === 'object') {
        const ka = Object.keys(a as object).sort()
        const kb = Object.keys(b as object).sort()
        if (ka.length !== kb.length) return false
        return ka.every((k, i) => k === kb[i] && deepEqual(
            (a as Record<string, unknown>)[k],
            (b as Record<string, unknown>)[k],
        ))
    }
    return false
}

export const defaultAsyncTap: AsyncTap = {
    eq(actual, expected, msg) {
        if (actual !== expected) {
            throw new Error(msg ?? `eq failed: ${fmt(actual)} !== ${fmt(expected)}`)
        }
    },
    deepEq(actual, expected, msg) {
        if (!deepEqual(actual, expected)) {
            throw new Error(msg ?? `deepEq failed:\n  actual:   ${fmt(actual)}\n  expected: ${fmt(expected)}`)
        }
    },
    truthy(value, msg) {
        if (!value) throw new Error(msg ?? `truthy failed: ${fmt(value)}`)
    },
    falsy(value, msg) {
        if (value) throw new Error(msg ?? `falsy failed: ${fmt(value)}`)
    },
    isNull(value, msg) {
        if (value !== null) throw new Error(msg ?? `isNull failed: ${fmt(value)}`)
    },
    throws(fn, kind, msg) {
        let threw = false
        try { fn() } catch (e: any) {
            threw = true
            if (kind && e?.code !== kind) {
                throw new Error(msg ?? `throws: expected code ${kind}, got ${e?.code}`)
            }
        }
        if (!threw) throw new Error(msg ?? 'throws: function did not throw')
    },
    async rejects(fn, code, msg) {
        let threw = false
        try { await fn() } catch (e: any) {
            threw = true
            if (code && e?.code !== code) {
                throw new Error(msg ?? `rejects: expected code ${code}, got ${e?.code}`)
            }
        }
        if (!threw) throw new Error(msg ?? 'rejects: promise did not reject')
    },
}

// ============================================================
// Helpers
// ============================================================

function makeFile(name: string, content: Uint8Array | string, type = 'application/octet-stream'): File {
    const data = typeof content === 'string' ? new TextEncoder().encode(content) : content
    return new File([data], name, { type })
}

function mockProvider(
    caps: Partial<RuntimeCapabilities> = {},
    files: File[] = [],
): ImportProvider {
    return {
        getCapabilities() {
            return {
                canRevealRealPath: false,
                canUseNDMCache: false,
                canUseNDMStore: false,
                canPickDirectory: false,
                canPickMixed: false,
                ...caps,
            }
        },
        async pickFiles() { return files },
    }
}

// ============================================================
// Test cases
// ============================================================

export const NDM_CLIENT_TEST_CASES: NdmClientTestCase[] = [
    // ---- NdmError ----
    {
        name: 'NdmError carries code and message',
        async run(t) {
            const err = new NdmError('USER_CANCELLED', 'cancelled')
            t.eq(err.code, 'USER_CANCELLED')
            t.eq(err.message, 'cancelled')
            t.eq(err.name, 'NdmError')
            t.truthy(err instanceof Error)
        },
    },
    {
        name: 'NdmError defaults message to code',
        async run(t) {
            const err = new NdmError('SESSION_NOT_FOUND')
            t.eq(err.message, 'SESSION_NOT_FOUND')
        },
    },

    // ---- Provider management ----
    {
        name: 'setImportProvider / getImportProvider round trip',
        async run(t) {
            const saved = getImportProvider()
            try {
                const custom = mockProvider()
                setImportProvider(custom)
                t.eq(getImportProvider(), custom)
            } finally {
                setImportProvider(saved)
            }
        },
    },

    // ---- Single file materialization ----
    {
        name: 'single_file: materializes one file with correct objectId',
        async run(t) {
            const saved = getImportProvider()
            try {
                const file = makeFile('hello.txt', 'hello world')
                setImportProvider(mockProvider({}, [file]))

                const result = await pickupAndImport({ mode: 'single_file' })

                t.truthy(result.sessionId.startsWith('import-'), 'sessionId prefix')
                t.eq(result.materializationStatus, 'ok')
                t.eq(result.uploadStatus, 'not_started')

                const sel = result.selection as ImportedFileObject
                t.eq(sel.kind, 'file')
                t.eq(sel.name, 'hello.txt')
                t.eq(sel.size, file.size)
                t.truthy(sel.objectId, 'objectId is non-empty')
                t.truthy(sel.objectId.includes(':'), 'objectId contains type separator')

                t.eq(result.summary.totalFiles, 1)
                t.eq(result.summary.totalDirs, 0)
                t.eq(result.summary.totalBytes, file.size)
                t.eq(result.items.length, 1)
            } finally {
                setImportProvider(saved)
            }
        },
    },

    // ---- Multi file ----
    {
        name: 'multi_file: materializes multiple files',
        async run(t) {
            const saved = getImportProvider()
            try {
                const f1 = makeFile('a.bin', new Uint8Array([1, 2, 3]))
                const f2 = makeFile('b.bin', new Uint8Array([4, 5, 6, 7]))
                setImportProvider(mockProvider({}, [f1, f2]))

                const result = await pickupAndImport({ mode: 'multi_file' })

                const sel = result.selection as ImportedFileObject[]
                t.eq(sel.length, 2)
                t.eq(sel[0].name, 'a.bin')
                t.eq(sel[1].name, 'b.bin')
                t.eq(result.summary.totalFiles, 2)
                t.eq(result.summary.totalBytes, 7)
            } finally {
                setImportProvider(saved)
            }
        },
    },

    // ---- Deterministic objectId ----
    {
        name: 'same content + name produces same objectId',
        async run(t) {
            const saved = getImportProvider()
            try {
                setImportProvider(mockProvider({}, [makeFile('same.bin', 'same-content')]))
                const r1 = await pickupAndImport({ mode: 'single_file' })

                setImportProvider(mockProvider({}, [makeFile('same.bin', 'same-content')]))
                const r2 = await pickupAndImport({ mode: 'single_file' })

                const id1 = (r1.selection as ImportedFileObject).objectId
                const id2 = (r2.selection as ImportedFileObject).objectId
                t.eq(id1, id2, 'objectIds must match for identical content')
            } finally {
                setImportProvider(saved)
            }
        },
    },
    {
        name: 'different content produces different objectId',
        async run(t) {
            const saved = getImportProvider()
            try {
                setImportProvider(mockProvider({}, [makeFile('f.txt', 'aaa')]))
                const r1 = await pickupAndImport({ mode: 'single_file' })

                setImportProvider(mockProvider({}, [makeFile('f.txt', 'bbb')]))
                const r2 = await pickupAndImport({ mode: 'single_file' })

                const id1 = (r1.selection as ImportedFileObject).objectId
                const id2 = (r2.selection as ImportedFileObject).objectId
                t.truthy(id1 !== id2, 'objectIds must differ for different content')
            } finally {
                setImportProvider(saved)
            }
        },
    },

    // ---- Directory tree ----
    {
        name: 'single_dir: builds directory tree from webkitRelativePath',
        async run(t) {
            const saved = getImportProvider()
            try {
                const f1 = makeFile('a.txt', 'aaa')
                Object.defineProperty(f1, 'webkitRelativePath', { value: 'mydir/a.txt' })
                const f2 = makeFile('b.txt', 'bbb')
                Object.defineProperty(f2, 'webkitRelativePath', { value: 'mydir/sub/b.txt' })

                setImportProvider(mockProvider({ canPickDirectory: true }, [f1, f2]))
                const result = await pickupAndImport({ mode: 'single_dir' })

                const dir = result.selection as ImportedDirObject
                t.eq(dir.kind, 'dir')
                t.eq(dir.name, 'mydir')
                t.truthy(dir.objectId, 'dir objectId is non-empty')
                t.truthy(dir.children !== undefined, 'dir has children')

                const childNames = dir.children!.map((c) => c.name)
                t.truthy(childNames.includes('a.txt'), 'contains a.txt')
                t.truthy(childNames.includes('sub'), 'contains sub/')

                const subDir = dir.children!.find((c) => c.name === 'sub') as ImportedDirObject
                t.eq(subDir.kind, 'dir')
                t.eq(subDir.children!.length, 1)
                t.eq(subDir.children![0].name, 'b.txt')

                t.eq(result.summary.totalFiles, 2)
                t.eq(result.summary.totalDirs, 2)
            } finally {
                setImportProvider(saved)
            }
        },
    },

    // ---- Error paths ----
    {
        name: 'throws DIRECTORY_NOT_SUPPORTED when canPickDirectory is false',
        async run(t) {
            const saved = getImportProvider()
            try {
                setImportProvider(mockProvider({ canPickDirectory: false }, []))
                await t.rejects(
                    () => pickupAndImport({ mode: 'single_dir' }),
                    'DIRECTORY_NOT_SUPPORTED',
                )
            } finally {
                setImportProvider(saved)
            }
        },
    },
    {
        name: 'throws MODE_NOT_SUPPORTED_IN_RUNTIME for mixed',
        async run(t) {
            const saved = getImportProvider()
            try {
                setImportProvider(mockProvider({ canPickMixed: false }, []))
                await t.rejects(
                    () => pickupAndImport({ mode: 'mixed' }),
                    'MODE_NOT_SUPPORTED_IN_RUNTIME',
                )
            } finally {
                setImportProvider(saved)
            }
        },
    },
    {
        name: 'throws USER_CANCELLED when provider returns empty list',
        async run(t) {
            const saved = getImportProvider()
            try {
                setImportProvider(mockProvider({}, []))
                await t.rejects(
                    () => pickupAndImport({ mode: 'single_file' }),
                    'USER_CANCELLED',
                )
            } finally {
                setImportProvider(saved)
            }
        },
    },

    // ---- Session queries ----
    {
        name: 'getImportSessionStatus throws SESSION_NOT_FOUND',
        async run(t) {
            await t.rejects(
                () => getImportSessionStatus('nonexistent'),
                'SESSION_NOT_FOUND',
            )
        },
    },
    {
        name: 'getImportSessionStatus returns correct state after import',
        async run(t) {
            const saved = getImportProvider()
            try {
                const file = makeFile('status.bin', new Uint8Array([10, 20, 30]))
                setImportProvider(mockProvider({}, [file]))

                const snapshot = await pickupAndImport({ mode: 'single_file' })
                const status = await getImportSessionStatus(snapshot.sessionId)

                t.eq(status.sessionId, snapshot.sessionId)
                t.eq(status.materializationStatus, 'ok')
                t.eq(status.uploadStatus, 'not_started')
                t.eq(status.summary.totalFiles, 1)
                t.eq(status.progress.uploadedBytes, 0)
                t.eq(status.progress.totalBytes, file.size)
                t.eq(status.progress.uploadedObjects, 0)
                t.eq(status.progress.totalObjects, 1)

                const objId = (snapshot.selection as ImportedFileObject).objectId
                t.truthy(status.perObjectProgress !== undefined, 'has perObjectProgress')
                t.truthy(status.perObjectProgress![objId] !== undefined, 'has entry for objectId')
                t.eq(status.perObjectProgress![objId].state, 'pending')
            } finally {
                setImportProvider(saved)
            }
        },
    },
    {
        name: 'getUploadProgress throws SESSION_NOT_FOUND',
        async run(t) {
            await t.rejects(
                () => getUploadProgress('nope'),
                'SESSION_NOT_FOUND',
            )
        },
    },
    {
        name: 'getUploadProgress returns progress for valid session',
        async run(t) {
            const saved = getImportProvider()
            try {
                const file = makeFile('prog.bin', new Uint8Array(100))
                setImportProvider(mockProvider({}, [file]))

                const snapshot = await pickupAndImport({ mode: 'single_file' })
                const progress = await getUploadProgress(snapshot.sessionId)

                t.eq(progress.sessionId, snapshot.sessionId)
                t.eq(progress.uploadStatus, 'not_started')
                t.eq(progress.totalBytes, 100)
                t.eq(progress.uploadedBytes, 0)
                t.eq(progress.totalObjects, 1)
                t.eq(progress.uploadedObjects, 0)
            } finally {
                setImportProvider(saved)
            }
        },
    },

    // ---- startUpload error ----
    {
        name: 'startUpload throws SESSION_NOT_FOUND',
        async run(t) {
            await t.rejects(
                () => startUpload('no-such-session'),
                'SESSION_NOT_FOUND',
            )
        },
    },

    // ---- NDM Store / Cache capability ----
    {
        name: 'NDM Store: uploadStatus is not_required',
        async run(t) {
            const saved = getImportProvider()
            try {
                setImportProvider(mockProvider({ canUseNDMStore: true }, [makeFile('s.bin', 'data')]))
                const result = await pickupAndImport({ mode: 'single_file' })
                t.eq(result.materializationStatus, 'all_in_store')
                t.eq(result.uploadStatus, 'not_required')
            } finally {
                setImportProvider(saved)
            }
        },
    },
    {
        name: 'NDM Cache: materializationStatus is on_cache',
        async run(t) {
            const saved = getImportProvider()
            try {
                setImportProvider(mockProvider({ canUseNDMCache: true }, [makeFile('c.bin', 'data')]))
                const result = await pickupAndImport({ mode: 'single_file' })
                t.eq(result.materializationStatus, 'on_cache')
                t.eq(result.uploadStatus, 'not_started')
            } finally {
                setImportProvider(saved)
            }
        },
    },

    // ---- MIME type ----
    {
        name: 'propagates file type as mimeType',
        async run(t) {
            const saved = getImportProvider()
            try {
                setImportProvider(mockProvider({}, [makeFile('photo.png', 'png-data', 'image/png')]))
                const result = await pickupAndImport({ mode: 'single_file' })
                t.eq((result.selection as ImportedFileObject).mimeType, 'image/png')
            } finally {
                setImportProvider(saved)
            }
        },
    },
    {
        name: 'omits mimeType when file.type is empty',
        async run(t) {
            const saved = getImportProvider()
            try {
                setImportProvider(mockProvider({}, [makeFile('unknown', 'data', '')]))
                const result = await pickupAndImport({ mode: 'single_file' })
                t.falsy((result.selection as ImportedFileObject).mimeType, 'mimeType should be undefined')
            } finally {
                setImportProvider(saved)
            }
        },
    },

    // ---- Session uniqueness ----
    {
        name: 'generates distinct sessionIds across calls',
        async run(t) {
            const saved = getImportProvider()
            try {
                const ids = new Set<string>()
                for (let i = 0; i < 5; i++) {
                    setImportProvider(mockProvider({}, [makeFile(`f${i}.txt`, `content-${i}`)]))
                    const r = await pickupAndImport({ mode: 'single_file' })
                    ids.add(r.sessionId)
                }
                t.eq(ids.size, 5, 'all 5 sessionIds must be unique')
            } finally {
                setImportProvider(saved)
            }
        },
    },
]

// ============================================================
// Runner — used by the browser harness
// ============================================================

export interface NdmClientCaseResult {
    name: string
    ok: boolean
    error?: string
}

export interface NdmClientRunResult {
    ok: boolean
    total: number
    failed: number
    results: NdmClientCaseResult[]
}

export async function runNdmClientCases(
    tap: AsyncTap = defaultAsyncTap,
): Promise<NdmClientRunResult> {
    const results: NdmClientCaseResult[] = []
    let failed = 0

    for (const c of NDM_CLIENT_TEST_CASES) {
        try {
            await c.run(tap)
            results.push({ name: c.name, ok: true })
        } catch (e: any) {
            failed++
            results.push({ name: c.name, ok: false, error: e?.message ?? String(e) })
        }
    }

    return {
        ok: failed === 0,
        total: NDM_CLIENT_TEST_CASES.length,
        failed,
        results,
    }
}
