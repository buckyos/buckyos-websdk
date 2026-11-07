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
    calculateQcidFromFile,
    getImportSessionStatus,
    getUploadProgress,
    startUpload,
    ImportProvider,
    RuntimeCapabilities,
    PickupAndImportOptions,
    ImportedFileObject,
    ImportedDirObject,
} from '../src/ndm_client'
import { probeFileMeta } from '../src/file_meta'

import {
    sha256Bytes,
    ChunkId,
    FileObject as NdnFileObject,
    DirObject as NdnDirObject,
    SimpleChunkList,
    ObjId,
} from '../src/ndn_types'

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

export const MEDIA_ELEMENT_FALLBACK_CASE = 'probeFileMeta falls back to media elements for what the bytes cannot tell'

const FALLBACK_WEBM = 'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAYmEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggEnTbuMU6uEHFO7a1OsggYQ7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjEuNy4xMDNXQYxMYXZmNjEuNy4xMDNEiYhAeQAAAAAAABZUrmvMrgEAAAAAAABD14EBc8WIZYzTgCeBa/mcgQAitZyDdW5kiIEAhoVWX1ZQOYOBASPjg4QL68IA4JSwgSC6gRiagQJVsIhVsYEAVbmBAhJUw2dAf3Nzn2PAgGfImUWjh0VOQ09ERVJEh4xMYXZmNjEuNy4xMDNzc9pjwItjxYhljNOAJ4Fr+WfIpUWjh0VOQ09ERVJEh5hMYXZjNjEuMTkuMTAxIGxpYnZweC12cDlnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAwLjQwMDAwMDAwMAAfQ7Z1RF7ngQCjQ7WBAACAokmDQuAB8AF2CDgkHBhCAAAwcAAAfwK/0f///iy74B/2Jm4/eyDW/JhuapGE9e7FRpAg05iU0lZjizXISKvyhemhpNx8av////E6X////GrHs1ph5kOgzeeznzDJN//7VGY2Vfeyxrt2gL4V6BorFO7/oFfLvP9AQvj////xOl////xzJfL1by7BOTtoW+xieeX///m+qj///xAH/z7f/Bca5HlI8eA/82vMsgGPf0O2SlhfMhRmHn//w1OhYAFc5KAb//i0eenMOXJLB///3IIDt/RJ3Wim2P3XMF////ioAVv//+5BAdv6JO60U2x+65gv///8TpAHqyRAfwex3ZUzv/qP///+w/gU3///sTUOH///2H8f////YmoedTf//hDWMbj2XvR/j+5/6XV38Ep++lv//60q/0NdRH5T9guX/V/P/7mao268////9ccYlKUeOfyv9Lf3/9M/v7Z9/8qn/9sr///3e07n0aYTf/8v1+BrP/Mf9Q0y53///TaymsQgsP9//DP7/+3IUj0+4+uv///7D+P////W2n//73Kdz6NMJv/+X6/A1n/mP+oaZaZufPcFVv+VihPmbiFELX4ik6kv/deGtj/yKNkdHr//IEXr12zb5t+xzxtkK/qc6Af////6pOefOTgu//xMbv3xP1bl26t///8ZDf9eK0eL//suSG7gPFUF///+TCvnDWWwu///59xJTaoPmbNI///+Y746R3Nh///4AnGjf////9fqTH//9FV//6mrfw0dTAXEZ5Reui+yF4d384N////yN0AGz////Ltn/of71////9Gwoj/3yOH6gMI4v///+zAlj9jQMpGdv//6DW9laf///i5mbf/aL9N93kof5ts/8h5///1K///xfP9Jc///n8yH/oHf//N4f8cY/wA4v64vpWf///DNyH//AlyO4ocAoP8////y/XvqTB6Qa9j/wGd////8jkANv////Luf2gOmdf///ocrh//2sHocaJqh+kU241///8Io/+Pn/9a6f//7vyn3wf//P5f/fsv8BGRcVf/8sP/80d/RX//w6///Az8lmqO/3r3TxzLLQTUjLQSKtJw6Ug/3//+ni+EQV////MUWV8u//3n/94Zu///Rtf/99M3oz/sHu2iAeCyhsFVK9gxGqsnsJP/7D/9IQh3///RisYEf//+KFsNycP/+0J8fXf//5s///5sxzv///5Fv//5FvvQ8BV/2D/KsNLiQQc2sZr97Dq34e4//2iAAo0CggQDIAKYAQJKcEElAAANgAAB1GE//+IR//7wOIryQJwg+GX7Q43//8Tnv/+pMuyVhy6x/FN4iPOf/6Pkn+aH2ntv456Tc4fHIo/8BIX+aH0ytk9MVmzCNFz//52U//nKSgyA9SPb6nRCJd16P//7h3H/+eBJUWN9Ta/WGviTkH/+vD9/4fWmWHyHzg9db4Xkf/Xgbf4fW0+HEYba3THcAABxTu2uRu4+zgQC3iveBAfGCAazwgQM='
const FALLBACK_MP3 = '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'

function fromBase64(value: string): Uint8Array {
    const binary = atob(value)
    return Uint8Array.from(binary, c => c.charCodeAt(0))
}

/**
 * The FileObject the SDK should build for a plain file of these tests: the bytes
 * say nothing and `makeFile` declares nothing, so only the extension decides
 * `mime`, and `.bin` has none.
 */
function expectedFileObject(name: string, size: number, content: string): NdnFileObject {
    const fileObj = new NdnFileObject(name, size, content)
    if (name.endsWith('.txt')) fileObj.meta.mime = 'text/x-txt'
    return fileObj
}

function makeFile(name: string, content: Uint8Array | string, type = 'application/octet-stream'): File {
    const data = typeof content === 'string' ? new TextEncoder().encode(content) : content
    return new File([data], name, { type })
}

/**
 * Independently compute the expected objectId for a single-chunk file
 * using ndn_types primitives. This mirrors the logic in
 * ndm_client.ts materializeFile() but is written independently so the
 * test can cross-verify the two implementations.
 */
function computeExpectedFileObjectId(name: string, content: Uint8Array): string {
    const hash = sha256Bytes(content)
    const chunkId = ChunkId.fromMix256Result(content.length, hash)
    const fileObj = expectedFileObject(name, content.length, chunkId.toString())
    const [objId] = fileObj.genObjId()
    return objId.toString()
}

/**
 * Independently compute the expected ChunkId string for a data buffer.
 */
function computeExpectedChunkId(content: Uint8Array): string {
    const hash = sha256Bytes(content)
    return ChunkId.fromMix256Result(content.length, hash).toString()
}

/**
 * Independently compute the expected objectId for a multi-chunk file.
 */
function computeExpectedMultiChunkFileObjectId(
    name: string,
    content: Uint8Array,
    chunkSize: number,
): string {
    const chunkList = new SimpleChunkList()
    let offset = 0
    while (offset < content.length) {
        const end = Math.min(offset + chunkSize, content.length)
        const slice = content.slice(offset, end)
        const hash = sha256Bytes(slice)
        chunkList.appendChunk(ChunkId.fromMix256Result(slice.length, hash))
        offset = end
    }
    const [chunkListObjId] = chunkList.genObjId()
    const fileObj = expectedFileObject(name, content.length, chunkListObjId.toString())
    const [objId] = fileObj.genObjId()
    return objId.toString()
}

function computeExpectedQcid(content: Uint8Array): string {
    const samples = content.length < 12288 ? content : new Uint8Array([
        ...content.slice(0, 4096),
        ...content.slice(Math.floor((content.length - 4096) / 2), Math.floor((content.length - 4096) / 2) + 4096),
        ...content.slice(-4096),
    ])
    return ChunkId.fromMixHashResult(content.length, sha256Bytes(samples), 'qcid').toString()
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
    {
        name: 'calculateQcidFromFile matches ndn-lib quick-hash rule',
        async run(t) {
            for (const size of [0, 3, 12287, 12288, 12289, 20000, 32769]) {
                const data = Uint8Array.from({ length: size }, (_, i) => (i * 17 + Math.floor(i / 251)) & 0xff)
                t.eq(await calculateQcidFromFile(makeFile('qcid.bin', data)), computeExpectedQcid(data))
            }
        },
    },

    {
        name: 'QCID agrees with ndn-lib canonical boundary vectors',
        async run(t) {
            const vectors: Array<[number, string]> = [
                [0, 'qcid:00e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
                [1, 'qcid:016e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d'],
                [4095, 'qcid:ff1f45de2924756389e3ccab98bdaacbef8a81cdeb651b59f916a6d6385b4f7b999d'],
                [4096, 'qcid:8020d67c656e01756650d77717b0839985a056ec28ffe174601d690fc407a2ceffca'],
                [12287, 'qcid:ff5f78ac95e2a27d63518fe831893f210699f7d6d6091071e6d5adccaaa476caf39c'],
                [12288, 'qcid:80602ffe74f47a7bb7350e913f6b9259080cbe3cee97b2d313d5e2fe2942108d98e9'],
                [12289, 'qcid:8160e526e1336f9c56d5012c520783dba4c96852a49a515a988447b940253faa28f1'],
            ]
            for (const [size, expected] of vectors) {
                t.eq(await calculateQcidFromFile(makeFile('qcid.bin', Uint8Array.from({ length: size }, (_, i) => i % 251))), expected)
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

    // ---- objectId available before upload ----
    {
        name: 'objectId is fully computed before upload starts',
        async run(t) {
            const saved = getImportProvider()
            try {
                const content = new TextEncoder().encode('pre-upload objectId check')
                const fileName = 'precheck.txt'
                const expected = computeExpectedFileObjectId(fileName, content)

                setImportProvider(mockProvider({}, [makeFile(fileName, content)]))
                const snapshot = await pickupAndImport({
                    mode: 'single_file',
                    autoStartUpload: false,
                })

                // Upload has NOT started
                t.eq(snapshot.uploadStatus, 'not_started',
                    'upload must not have started yet')

                // But objectId is already present and correct
                const sel = snapshot.selection as ImportedFileObject
                t.eq(sel.objectId, expected,
                    'objectId must be fully computed before upload')

                // Also verify via items array
                t.eq(snapshot.items.length, 1)
                t.eq(snapshot.items[0].objectId, expected,
                    'items[0].objectId must match')

                // And via session status query
                const status = await getImportSessionStatus(snapshot.sessionId)
                t.eq(status.uploadStatus, 'not_started')
                const progressEntries = Object.values(status.perObjectProgress ?? {})
                t.eq(progressEntries.length, 1)
                t.eq(progressEntries[0].objectId, expected,
                    'session perObjectProgress objectId must match')
                t.eq(progressEntries[0].state, 'pending',
                    'object upload state must be pending')
                t.eq(progressEntries[0].uploadedBytes, 0,
                    'no bytes uploaded yet')
            } finally {
                setImportProvider(saved)
            }
        },
    },
    {
        name: 'multi-file: all objectIds available before upload starts',
        async run(t) {
            const saved = getImportProvider()
            try {
                const contentA = new Uint8Array([10, 20, 30])
                const contentB = new Uint8Array([40, 50, 60, 70])
                const expectedA = computeExpectedFileObjectId('x.bin', contentA)
                const expectedB = computeExpectedFileObjectId('y.bin', contentB)

                setImportProvider(mockProvider({}, [
                    makeFile('x.bin', contentA),
                    makeFile('y.bin', contentB),
                ]))
                const snapshot = await pickupAndImport({
                    mode: 'multi_file',
                    autoStartUpload: false,
                })

                t.eq(snapshot.uploadStatus, 'not_started')

                const sel = snapshot.selection as ImportedFileObject[]
                t.eq(sel.length, 2)
                t.eq(sel[0].objectId, expectedA, 'x.bin objectId ready before upload')
                t.eq(sel[1].objectId, expectedB, 'y.bin objectId ready before upload')
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

    // ---- Cross-verify objectId against ndn_types ----
    {
        name: 'objectId matches independent ndn_types computation (small file)',
        async run(t) {
            const saved = getImportProvider()
            try {
                const content = new TextEncoder().encode('hello world')
                const fileName = 'hello.txt'

                // Independently compute expected objectId
                const expected = computeExpectedFileObjectId(fileName, content)

                // Get objectId from pickupAndImport
                setImportProvider(mockProvider({}, [makeFile(fileName, content)]))
                const result = await pickupAndImport({ mode: 'single_file' })
                const actual = (result.selection as ImportedFileObject).objectId

                t.eq(actual, expected, `objectId mismatch: got ${actual}, expected ${expected}`)
            } finally {
                setImportProvider(saved)
            }
        },
    },
    {
        name: 'objectId matches independent ndn_types computation (binary data)',
        async run(t) {
            const saved = getImportProvider()
            try {
                const content = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd, 0x80, 0x7f])
                const fileName = 'data.bin'

                const expected = computeExpectedFileObjectId(fileName, content)

                setImportProvider(mockProvider({}, [makeFile(fileName, content)]))
                const result = await pickupAndImport({ mode: 'single_file' })
                const actual = (result.selection as ImportedFileObject).objectId

                t.eq(actual, expected, `objectId mismatch for binary data`)
            } finally {
                setImportProvider(saved)
            }
        },
    },
    {
        name: 'objectId changes when file name differs (same content)',
        async run(t) {
            const saved = getImportProvider()
            try {
                const content = new TextEncoder().encode('same content')

                // ndn_types: FileObject includes name in ObjId derivation
                const expectedA = computeExpectedFileObjectId('a.txt', content)
                const expectedB = computeExpectedFileObjectId('b.txt', content)
                t.truthy(expectedA !== expectedB, 'ndn_types: different names should produce different objectIds')

                setImportProvider(mockProvider({}, [makeFile('a.txt', content)]))
                const rA = await pickupAndImport({ mode: 'single_file' })

                setImportProvider(mockProvider({}, [makeFile('b.txt', content)]))
                const rB = await pickupAndImport({ mode: 'single_file' })

                t.eq((rA.selection as ImportedFileObject).objectId, expectedA)
                t.eq((rB.selection as ImportedFileObject).objectId, expectedB)
            } finally {
                setImportProvider(saved)
            }
        },
    },
    {
        name: 'ChunkId in session matches independent ndn_types computation',
        async run(t) {
            const saved = getImportProvider()
            try {
                const content = new TextEncoder().encode('chunk verification test')
                const expectedChunkId = computeExpectedChunkId(content)

                setImportProvider(mockProvider({}, [makeFile('chunk.txt', content)]))
                const result = await pickupAndImport({ mode: 'single_file' })
                const status = await getImportSessionStatus(result.sessionId)

                // The session's perObjectProgress should contain exactly one object
                const entries = Object.values(status.perObjectProgress ?? {})
                t.eq(entries.length, 1, 'should have exactly 1 object in progress')

                // Verify the objectId in session matches ndn_types derivation
                const objId = entries[0].objectId
                const expectedObjId = computeExpectedFileObjectId('chunk.txt', content)
                t.eq(objId, expectedObjId, `session objectId mismatch`)
            } finally {
                setImportProvider(saved)
            }
        },
    },
    {
        name: 'multi-file: each objectId matches independent computation',
        async run(t) {
            const saved = getImportProvider()
            try {
                const contentA = new Uint8Array([1, 2, 3])
                const contentB = new Uint8Array([4, 5, 6, 7])

                const expectedA = computeExpectedFileObjectId('a.bin', contentA)
                const expectedB = computeExpectedFileObjectId('b.bin', contentB)

                setImportProvider(mockProvider({}, [
                    makeFile('a.bin', contentA),
                    makeFile('b.bin', contentB),
                ]))
                const result = await pickupAndImport({ mode: 'multi_file' })
                const sel = result.selection as ImportedFileObject[]

                t.eq(sel[0].objectId, expectedA, 'a.bin objectId mismatch')
                t.eq(sel[1].objectId, expectedB, 'b.bin objectId mismatch')
            } finally {
                setImportProvider(saved)
            }
        },
    },
    {
        name: 'directory objectId matches independent ndn_types DirObject computation',
        async run(t) {
            const saved = getImportProvider()
            try {
                const contentA = new TextEncoder().encode('aaa')
                const contentB = new TextEncoder().encode('bbb')

                // Compute expected dir objectId bottom-up using ndn_types
                const fileObjA = expectedFileObject('a.txt', contentA.length, computeExpectedChunkId(contentA))
                const fileObjB = expectedFileObject('b.txt', contentB.length, computeExpectedChunkId(contentB))

                const subDir = new NdnDirObject('sub')
                subDir.addFile('b.txt', fileObjB.toJSON(), contentB.length)
                const [subDirObjId] = subDir.genObjId()

                const rootDir = new NdnDirObject('mydir')
                rootDir.addFile('a.txt', fileObjA.toJSON(), contentA.length)
                rootDir.addDirectory('sub', subDirObjId, subDir.total_size)
                const [expectedRootObjId] = rootDir.genObjId()

                // Now do the same via pickupAndImport
                const f1 = makeFile('a.txt', contentA)
                Object.defineProperty(f1, 'webkitRelativePath', { value: 'mydir/a.txt' })
                const f2 = makeFile('b.txt', contentB)
                Object.defineProperty(f2, 'webkitRelativePath', { value: 'mydir/sub/b.txt' })

                setImportProvider(mockProvider({ canPickDirectory: true }, [f1, f2]))
                const result = await pickupAndImport({ mode: 'single_dir' })
                const dir = result.selection as ImportedDirObject

                t.eq(dir.objectId, expectedRootObjId.toString(),
                    `root dir objectId mismatch: got ${dir.objectId}, expected ${expectedRootObjId.toString()}`)

                // Also verify sub-dir objectId
                const subDirResult = dir.children!.find(c => c.name === 'sub') as ImportedDirObject
                t.eq(subDirResult.objectId, subDirObjId.toString(),
                    `sub dir objectId mismatch`)
            } finally {
                setImportProvider(saved)
            }
        },
    },
    {
        name: 'directory objectId changes when nested file content changes with same size',
        async run(t) {
            const saved = getImportProvider()
            try {
                const f1 = makeFile('a.txt', 'abc')
                Object.defineProperty(f1, 'webkitRelativePath', { value: 'mydir/a.txt' })
                const f2 = makeFile('b.txt', 'bbb')
                Object.defineProperty(f2, 'webkitRelativePath', { value: 'mydir/sub/b.txt' })

                setImportProvider(mockProvider({ canPickDirectory: true }, [f1, f2]))
                const first = await pickupAndImport({ mode: 'single_dir' })

                const f3 = makeFile('a.txt', 'xyz')
                Object.defineProperty(f3, 'webkitRelativePath', { value: 'mydir/a.txt' })
                const f4 = makeFile('b.txt', 'bbb')
                Object.defineProperty(f4, 'webkitRelativePath', { value: 'mydir/sub/b.txt' })

                setImportProvider(mockProvider({ canPickDirectory: true }, [f3, f4]))
                const second = await pickupAndImport({ mode: 'single_dir' })

                t.falsy(
                    (first.selection as ImportedDirObject).objectId === (second.selection as ImportedDirObject).objectId,
                    'directory objectId should change when child file content changes',
                )
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
        name: 'NDM Store capability alone does not establish object readiness',
        async run(t) {
            const saved = getImportProvider()
            try {
                setImportProvider(mockProvider({ canUseNDMStore: true }, [makeFile('s.bin', 'data')]))
                const result = await pickupAndImport({ mode: 'single_file' })
                t.eq(result.materializationStatus, 'ok')
                t.eq(result.uploadStatus, 'not_started')
                t.eq(result.objectStatus, 'pending')
            } finally {
                setImportProvider(saved)
            }
        },
    },
    {
        name: 'NDM Cache capability alone does not prove materialization',
        async run(t) {
            const saved = getImportProvider()
            try {
                setImportProvider(mockProvider({ canUseNDMCache: true }, [makeFile('c.bin', 'data')]))
                const result = await pickupAndImport({ mode: 'single_file' })
                t.eq(result.materializationStatus, 'ok')
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
        name: 'mimeType and the FileObject follow the magic bytes, not file.type',
        async run(t) {
            const saved = getImportProvider()
            try {
                // A 2x3 GIF named and declared as something else.
                const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 2, 0, 3, 0, 0, 0, 0])
                setImportProvider(mockProvider({}, [makeFile('photo.txt', gif, 'text/plain')]))
                const result = await pickupAndImport({ mode: 'single_file' })
                const selection = result.selection as ImportedFileObject
                t.eq(selection.mimeType, 'image/gif')
                t.eq(selection._ndnFileObject?.mime, 'image/gif')
                t.eq(selection._ndnFileObject?.width, 2)
                t.eq(selection._ndnFileObject?.height, 3)
            } finally {
                setImportProvider(saved)
            }
        },
    },
    {
        name: 'a malformed media file still imports',
        async run(t) {
            const saved = getImportProvider()
            try {
                const broken = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0x45])
                setImportProvider(mockProvider({}, [makeFile('broken.jpg', broken)]))
                const result = await pickupAndImport({ mode: 'single_file' })
                const selection = result.selection as ImportedFileObject
                t.eq(selection.mimeType, 'image/jpeg')
                t.eq(selection._ndnFileObject?.mime, 'image/jpeg')
                t.eq(selection._ndnFileObject?.width, undefined)
            } finally {
                setImportProvider(saved)
            }
        },
    },
    {
        name: 'fileMeta with a mime replaces the probe, without one it is merged over the probe',
        async run(t) {
            const saved = getImportProvider()
            try {
                const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 2, 0, 3, 0, 0, 0, 0])
                setImportProvider(mockProvider({}, [makeFile('a.gif', gif)]))
                const known = await pickupAndImport({
                    mode: 'single_file',
                    fileMeta: () => ({ mime: 'image/x-known', width: 9 }),
                })
                const knownObject = (known.selection as ImportedFileObject)._ndnFileObject
                t.eq(knownObject?.mime, 'image/x-known')
                t.eq(knownObject?.width, 9)
                t.eq(knownObject?.height, undefined)

                setImportProvider(mockProvider({}, [makeFile('a.gif', gif)]))
                const merged = await pickupAndImport({
                    mode: 'single_file',
                    fileMeta: () => ({ captured_at: '2024-01-02T03:04:05', camera: { make: 'X' } }),
                })
                const mergedObject = (merged.selection as ImportedFileObject)._ndnFileObject
                t.eq(mergedObject?.mime, 'image/gif')
                t.eq(mergedObject?.width, 2)
                t.eq(mergedObject?.captured_at, '2024-01-02T03:04:05')
                t.deepEq(mergedObject?.camera, { make: 'X' })
            } finally {
                setImportProvider(saved)
            }
        },
    },
    {
        name: 'omits mimeType when nothing tells the type',
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

    // ---- Media element fallback (real browser only) ----
    {
        name: MEDIA_ELEMENT_FALLBACK_CASE,
        async run(t) {
            if (typeof document === 'undefined') return
            // Formats whose size or duration the byte parsers do not read: a 3x2 BMP,
            // a 32x24 WebM and an MP3 of 0.4 s, both written by ffmpeg.
            const bmpHeader = new Uint8Array(54)
            const bmp = new DataView(bmpHeader.buffer)
            bmpHeader.set([0x42, 0x4d])
            bmp.setUint32(2, 54 + 24, true)
            bmp.setUint32(10, 54, true)
            bmp.setUint32(14, 40, true)
            bmp.setInt32(18, 3, true)
            bmp.setInt32(22, 2, true)
            bmp.setUint16(26, 1, true)
            bmp.setUint16(28, 24, true)
            const image = await probeFileMeta(new Blob([bmpHeader, new Uint8Array(24)]))
            t.deepEq(image, { mime: 'image/bmp', width: 3, height: 2 }, 'bmp')

            const video = await probeFileMeta(new Blob([fromBase64(FALLBACK_WEBM)]))
            t.eq(video.mime, 'video/webm')
            t.eq(video.width, 32)
            t.eq(video.height, 24)
            t.truthy(video.duration_ms === undefined || (video.duration_ms >= 300 && video.duration_ms <= 500), 'webm duration')

            const audio = await probeFileMeta(new Blob([fromBase64(FALLBACK_MP3)]))
            t.eq(audio.mime, 'audio/mpeg')
            t.truthy(audio.duration_ms !== undefined && audio.duration_ms >= 300 && audio.duration_ms <= 600, 'mp3 duration')

            // The bytes win: a parsed size never reaches a media element, even a broken one.
            const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 7, 0, 5, 0])
            t.deepEq(await probeFileMeta(new Blob([gif])), { mime: 'image/gif', width: 7, height: 5 }, 'gif')

            // What no browser can decode just stays unknown.
            const broken = await probeFileMeta(new Blob([new TextEncoder().encode('not an image')], { type: 'image/x-nothing' }))
            t.deepEq(broken, { mime: 'image/x-nothing' }, 'undecodable')
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
