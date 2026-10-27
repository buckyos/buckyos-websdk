const mockTusUpload = jest.fn()

jest.mock('tus-js-client', () => ({
    Upload: class MockTusUpload {
        private readonly file: Blob
        private readonly options: {
            onProgress?: (bytesUploaded: number, bytesTotal: number) => void
            onSuccess?: () => void
            onError?: (error: Error) => void
            metadata?: Record<string, string>
        }

        constructor(file: Blob, options: {
            onProgress?: (bytesUploaded: number, bytesTotal: number) => void
            onSuccess?: () => void
            onError?: (error: Error) => void
            metadata?: Record<string, string>
        }) {
            this.file = file
            this.options = options
            mockTusUpload(file, options)
        }

        start() {
            try {
                this.options.onProgress?.(this.file.size, this.file.size)
                this.options.onSuccess?.()
            } catch (error) {
                this.options.onError?.(error instanceof Error ? error : new Error(String(error)))
            }
        }

        abort() {
            return undefined
        }
    },
}))

// Jest wrapper around the runtime-agnostic ndm_client test cases.
//
// The actual test logic lives in tests/ndm_client_cases.ts so that the same
// cases can be executed in any runtime — node (jest, here), browser (via
// tests/browser/real-browser/ndm_client.html + playwright), and any future
// host that needs to validate the ndm_client layer end-to-end.

import { NDM_CLIENT_TEST_CASES, defaultAsyncTap } from './ndm_client_cases'
import {
    setImportProvider,
    getImportProvider,
    pickupAndImport,
    startUpload,
    ensureUploaded,
    importFiles,
    importDirectory,
    getUploadProgress,
    cancelImportSession,
    releaseImportSession,
    getImportSessionStatus,
    calculateQcidFromFile,
    ImportProvider,
    RuntimeCapabilities,
    ImportedFileObject,
    getObject,
    lookupObject,
    queryChunkState,
    outboxCount,
    removeChunk,
    NdmStoreApiError,
} from '../src/ndm_client'
import { createSDKModule, RuntimeType } from '../src/sdk_core'
import { FileObject as NdnFileObject, ObjId } from '../src/ndn_types'
import {
    installTestAppServiceEnv,
    TEST_APP_SERVICE_TOKEN,
} from './helpers/app_service_env'

describe('ndm_client (shared cases)', () => {
    for (const c of NDM_CLIENT_TEST_CASES) {
        it(c.name, async () => {
            await c.run(defaultAsyncTap)
        })
    }
})

// ============================================================
// Jest-only tests that are too heavy for the browser runner
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
        pickFiles: jest.fn().mockResolvedValue(files),
    }
}

describe('ndm_client (jest-only)', () => {
    let originalProvider: ImportProvider
    const sdk = createSDKModule('universal')
    const originalFetch = global.fetch
    const originalEnv = { ...process.env }

    beforeAll(() => { originalProvider = getImportProvider() })
    afterEach(() => {
        setImportProvider(originalProvider)
        global.fetch = originalFetch
        process.env = { ...originalEnv }
        mockTusUpload.mockReset()
    })

    it('materializes a file larger than 32 MiB into multiple chunks', async () => {
        // 33 MiB exceeds the 32 MiB default chunk size
        const size = 33 * 1024 * 1024
        const data = new Uint8Array(size)
        for (let i = 0; i < size; i++) data[i] = i & 0xff

        setImportProvider(mockProvider({}, [makeFile('big.bin', data)]))
        const result = await pickupAndImport({ mode: 'single_file' })

        const sel = result.selection as ImportedFileObject
        expect(sel.kind).toBe('file')
        expect(sel.size).toBe(size)
        expect(sel.objectId).toBeTruthy()
        expect(sel.objectId).toContain(':')
    })

    it('uploads multi-chunk files with distinct chunk_index metadata per chunk session', async () => {
        installTestAppServiceEnv()
        await sdk.initBuckyOS('test-app', {
            appId: 'test-app',
            runtimeType: RuntimeType.AppService,
            sessionToken: TEST_APP_SERVICE_TOKEN,
            ownerUserId: 'alice',
            zoneHost: 'example.com',
            defaultProtocol: 'https://',
        })

        global.fetch = jest.fn(async (input, init) => {
            if (String(input).endsWith('/import/finalize')) {
                const request = JSON.parse(init!.body as string)
                return jsonResponse({ ready: true, roots: request.roots.map((obj_id: string) => ({ obj_id, ready: true })) })
            }
            return jsonResponse({ state: 'not_exist', reusable: false, chunk_size: 0 })
        }) as typeof fetch
        const size = 33 * 1024 * 1024
        const data = new Uint8Array(size)
        for (let i = 0; i < size; i++) data[i] = i & 0xff

        setImportProvider(mockProvider({}, [makeFile('big-upload.bin', data)]))
        const result = await pickupAndImport({ mode: 'single_file' })

        await ensureUploaded(result.sessionId, {
            endpoint: 'https://gateway.example.com',
            concurrency: 1,
        })

        for (let i = 0; i < 10; i++) {
            const status = await getImportSessionStatus(result.sessionId)
            if (status.uploadStatus === 'completed') {
                break
            }
            await new Promise((resolve) => setTimeout(resolve, 0))
        }

        const status = await getImportSessionStatus(result.sessionId)
        expect(status.uploadStatus).toBe('completed')
        expect(mockTusUpload).toHaveBeenCalledTimes(2)

        const firstMetadata = mockTusUpload.mock.calls[0][1].metadata
        const secondMetadata = mockTusUpload.mock.calls[1][1].metadata

        expect(firstMetadata.chunk_index).toBe('0')
        expect(secondMetadata.chunk_index).toBe('1')
        expect(firstMetadata.chunk_hash).toBeTruthy()
        expect(secondMetadata.chunk_hash).toBeTruthy()
        expect(firstMetadata.logical_path).toBe(firstMetadata.chunk_hash)
        expect(secondMetadata.logical_path).toBe(secondMetadata.chunk_hash)
        expect(firstMetadata.chunk_hash).not.toBe(secondMetadata.chunk_hash)
        expect(mockTusUpload.mock.calls[0][1].headers.Authorization).toMatch(/^Bearer \S+/)
    })

    it('pickupAndImport reuses lookup hit resolved by QCID before local materialization', async () => {
        await sdk.initBuckyOS('test-app', {
            appId: 'test-app',
            runtimeType: RuntimeType.Browser,
            zoneHost: 'example.com',
            defaultProtocol: 'https://',
        })

        const data = new Uint8Array(20000)
        for (let i = 0; i < data.length; i++) data[i] = (i * 29) & 0xff
        const file = makeFile('lookup-hit.bin', data)
        const qcid = await calculateQcidFromFile(file)
        const chunkListId = 'clist:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
        const expectedFileObj = new NdnFileObject(file.name, file.size, chunkListId)
        const [expectedObjId] = expectedFileObj.genObjId()

        const fetchMock = jest.fn().mockResolvedValue(
            new Response(JSON.stringify({
                object_id: qcid,
                scope: 'app',
                state: 'same_as',
                reusable: true,
                chunk_size: file.size,
                same_as: chunkListId,
            }), {
                status: 200,
                headers: {
                    'content-type': 'application/json',
                },
            }),
        )
        global.fetch = fetchMock as typeof fetch
        setImportProvider(mockProvider({}, [file]))

        const result = await pickupAndImport({ mode: 'single_file', sessionToken: null })
        const selection = result.selection as ImportedFileObject

        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining(`/ndm/v1/objects/lookup?scope=app&quick_hash=${qcid}`),
            expect.objectContaining({
                method: 'GET',
            }),
        )
        expect(selection.objectId).toBe(expectedObjId.toString())
        expect(selection.locality).toBe('store')
        expect(result.materializationStatus).toBe('all_in_store')
        expect(result.uploadStatus).toBe('not_started')
        expect(result.objectStatus).toBe('pending')
    })

    it('structured store APIs reject pure Browser runtime', async () => {
        await sdk.initBuckyOS('test-app', {
            appId: 'test-app',
            runtimeType: RuntimeType.Browser,
            zoneHost: 'example.com',
            defaultProtocol: 'https://',
        })

        await expect(
            getObject(
                { obj_id: 'file:1111111111111111111111111111111111111111111111111111111111111111' },
                { endpoint: 'https://gateway.example.com' },
            ),
        ).rejects.toMatchObject({
            code: 'STORE_API_NOT_SUPPORTED_IN_RUNTIME',
        })
    })

    it('structured store APIs send POST JSON and attach session token when available', async () => {
        installTestAppServiceEnv()
        await sdk.initBuckyOS('test-app', {
            appId: 'test-app',
            runtimeType: RuntimeType.AppService,
            sessionToken: TEST_APP_SERVICE_TOKEN,
            ownerUserId: 'alice',
            zoneHost: 'example.com',
            defaultProtocol: 'https://',
        })

        const fetchMock = jest.fn().mockResolvedValue(
            new Response(JSON.stringify({
                state: 'completed',
                chunk_size: 37,
            }), {
                status: 200,
                headers: {
                    'content-type': 'application/json',
                },
            }),
        )
        global.fetch = fetchMock as typeof fetch

        const result = await queryChunkState({
            chunk_id: 'chunk:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        }, {
            endpoint: 'https://gateway.example.com/',
        })

        expect(result).toEqual({
            state: 'completed',
            chunk_size: 37,
        })
        expect(fetchMock).toHaveBeenCalledWith(
            'https://gateway.example.com/ndm/v1/store/query_chunk_state',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({
                    chunk_id: 'chunk:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                }),
                headers: expect.objectContaining({
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${TEST_APP_SERVICE_TOKEN}`,
                }),
            }),
        )
    })

    it('structured store APIs derive endpoint from active runtime when omitted', async () => {
        installTestAppServiceEnv()
        await sdk.initBuckyOS('test-app', {
            appId: 'test-app',
            runtimeType: RuntimeType.AppService,
            sessionToken: TEST_APP_SERVICE_TOKEN,
            ownerUserId: 'alice',
            zoneHost: 'example.com',
            defaultProtocol: 'https://',
        })

        const fetchMock = jest.fn().mockResolvedValue(
            new Response(JSON.stringify({ count: 7 }), {
                status: 200,
                headers: {
                    'content-type': 'application/json',
                },
            }),
        )
        global.fetch = fetchMock as typeof fetch

        const result = await outboxCount()

        expect(result).toEqual({ count: 7 })
        expect(fetchMock).toHaveBeenCalledWith(
            'http://host.docker.internal:3180/ndm/v1/store/outbox_count',
            expect.objectContaining({
                method: 'POST',
                body: '{}',
            }),
        )
    })

    it('structured store APIs surface JSON errors with status and error code', async () => {
        installTestAppServiceEnv()
        await sdk.initBuckyOS('test-app', {
            appId: 'test-app',
            runtimeType: RuntimeType.AppService,
            sessionToken: TEST_APP_SERVICE_TOKEN,
            ownerUserId: 'alice',
            zoneHost: 'example.com',
            defaultProtocol: 'https://',
        })

        const fetchMock = jest.fn().mockResolvedValue(
            new Response(JSON.stringify({
                error: 'invalid_id',
                message: 'invalid chunk_id: not a chunk object id',
            }), {
                status: 400,
                headers: {
                    'content-type': 'application/json',
                },
            }),
        )
        global.fetch = fetchMock as typeof fetch

        await expect(
            removeChunk({
                chunk_id: 'file:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            }),
        ).rejects.toEqual(expect.objectContaining({
            name: 'NdmStoreApiError',
            status: 400,
            errorCode: 'invalid_id',
            message: 'invalid chunk_id: not a chunk object id',
        }))

        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('lookupObject returns same_as chunk state for qcid quick_hash', async () => {
        await sdk.initBuckyOS('test-app', {
            appId: 'test-app',
            runtimeType: RuntimeType.Browser,
            zoneHost: 'example.com',
            defaultProtocol: 'https://',
        })

        const fetchMock = jest.fn().mockResolvedValue(
            new Response(JSON.stringify({
                object_id: 'qcid:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
                scope: 'global',
                state: 'same_as',
                chunk_size: 4194304,
                same_as: 'chunklist:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
            }), {
                status: 200,
                headers: {
                    'content-type': 'application/json',
                },
            }),
        )
        global.fetch = fetchMock as typeof fetch

        const result = await lookupObject({
            scope: 'global',
            quick_hash: 'qcid:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        }, {
            endpoint: 'https://example.com',
            sessionToken: null,
        })

        expect(result).toEqual({
            object_id: 'qcid:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
            scope: 'global',
            state: 'same_as',
            chunk_size: 4194304,
            same_as: 'chunklist:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        })
        expect(fetchMock).toHaveBeenCalledWith(
            'https://example.com/ndm/v1/objects/lookup?scope=global&quick_hash=qcid:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
            expect.objectContaining({
                method: 'GET',
                headers: expect.objectContaining({
                    Accept: 'application/json',
                }),
            }),
        )
    })

    it('lookupObject keeps non-chunk lookup response as exists boolean', async () => {
        await sdk.initBuckyOS('test-app', {
            appId: 'test-app',
            runtimeType: RuntimeType.Browser,
            zoneHost: 'example.com',
            defaultProtocol: 'https://',
        })

        const fetchMock = jest.fn().mockResolvedValue(
            new Response(JSON.stringify({
                object_id: 'file:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
                scope: 'app',
                exists: true,
            }), {
                status: 200,
                headers: {
                    'content-type': 'application/json',
                },
            }),
        )
        global.fetch = fetchMock as typeof fetch

        const result = await lookupObject({
            scope: 'app',
            quick_hash: 'file:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        }, {
            endpoint: 'https://example.com',
            sessionToken: null,
        })

        expect(result).toEqual({
            object_id: 'file:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
            scope: 'app',
            exists: true,
        })
    })

    it('lookupObject accepts base32 objid in quick_hash parameters', async () => {
        await sdk.initBuckyOS('test-app', {
            appId: 'test-app',
            runtimeType: RuntimeType.Browser,
            zoneHost: 'example.com',
            defaultProtocol: 'https://',
        })

        const canonicalChunkId = 'qcid:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
        const quickHash = ObjId.fromString(canonicalChunkId).toBase32()

        const fetchMock = jest.fn().mockResolvedValue(
            new Response(JSON.stringify({
                object_id: quickHash,
                scope: 'global',
                state: 'completed',
                chunk_size: 1048576,
            }), {
                status: 200,
                headers: {
                    'content-type': 'application/json',
                },
            }),
        )
        global.fetch = fetchMock as typeof fetch

        const result = await lookupObject({
            scope: 'global',
            quick_hash: quickHash,
        }, {
            endpoint: 'https://example.com',
            sessionToken: null,
        })

        expect(result).toEqual({
            object_id: quickHash,
            scope: 'global',
            state: 'completed',
            chunk_size: 1048576,
        })
        expect(fetchMock).toHaveBeenCalledWith(
            `https://example.com/ndm/v1/objects/lookup?scope=global&quick_hash=${quickHash}`,
            expect.objectContaining({
                method: 'GET',
            }),
        )
    })
})


function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('unified import lifecycle', () => {
    const sessions: string[] = []
    const originalFetch = global.fetch
    afterEach(() => {
        sessions.splice(0).forEach(releaseImportSession)
        global.fetch = originalFetch
        mockTusUpload.mockClear()
    })
    const remember = <T extends { sessionId: string }>(value: T): T => { sessions.push(value.sessionId); return value }
    const finalizations: any[] = []
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        if (String(input).endsWith('/import/finalize')) {
            const body = JSON.parse(init!.body as string)
            finalizations.push(body)
            return jsonResponse({ ready: true, roots: body.roots.map((obj_id: string) => ({ obj_id, ready: true })), warnings: [] })
        }
        return jsonResponse({ state: 'not_exist', chunk_size: 0, reusable: false })
    }
    const options = { endpoint: 'https://ndm.example', sessionToken: 'test-token', headers: { 'X-Auth': 'business-token', Authorization: 'ignored-token' }, fetcher }
    beforeEach(() => { finalizations.length = 0 })

    it('keeps concurrent selected-file imports isolated from the picker provider', async () => {
        const provider = getImportProvider()
        const [a, b] = await Promise.all([
            importFiles([makeFile('a.txt', 'A')], { ...options, mode: 'single_file' }),
            importFiles([makeFile('b.txt', 'B')], { ...options, mode: 'single_file' }),
        ])
        remember(a); remember(b)
        expect(a.selection.name).toBe('a.txt')
        expect(b.selection.name).toBe('b.txt')
        expect(getImportProvider()).toBe(provider)
    })

    it('registers ChunkList, FileObject and DirObjects in dependency order, preserving empty directories', async () => {
        const result = remember(await importDirectory({ kind: 'dir', name: '根目录', children: [
            { kind: 'file', file: makeFile('large.bin', new Uint8Array(33 * 1024 * 1024)) },
            { kind: 'dir', name: '空 目录', children: [] },
        ] }, options))
        const status = await ensureUploaded(result.sessionId)
        expect(status.objectStatus).toBe('ready')
        const objects = finalizations[0].objects
        expect(objects.map((object: any) => object.obj_id.split(':')[0])).toEqual(['clist', 'cyfile', 'cydir', 'cydir'])
        const file = JSON.parse(objects[1].obj_data)
        expect(file.content).toBe(objects[0].obj_id)
        expect(JSON.parse(objects[3].obj_data).body['空 目录']).toBe(objects[2].obj_id)
        expect(status.summary).toMatchObject({ totalFiles: 1, totalDirs: 2 })
    })

    it('QCID hit reads only samples, skips all TUS bytes but still registers renamed metadata', async () => {
        const file = makeFile('renamed.bin', new Uint8Array(20000))
        const arrayBuffer = jest.spyOn(file, 'arrayBuffer')
        const { ChunkId, sha256Bytes } = await import('../src/ndn_types')
        const contentId = ChunkId.fromMix256Result(file.size, sha256Bytes(new Uint8Array(file.size))).toString()
        const hitFetcher = async (input: RequestInfo | URL, init?: RequestInit) => String(input).endsWith('/import/finalize')
            ? fetcher(input, init)
            : jsonResponse({ object_id: contentId, scope: 'app', state: 'same_as', same_as: contentId, chunk_size: file.size, reusable: true })
        const result = remember(await importFiles([file], { ...options, fetcher: hitFetcher, mode: 'single_file' }))
        expect(arrayBuffer).not.toHaveBeenCalled()
        expect(result.objectStatus).toBe('pending')
        await ensureUploaded(result.sessionId)
        expect(mockTusUpload).not.toHaveBeenCalled()
        expect(JSON.parse(finalizations[0].objects[0].obj_data).name).toBe('renamed.bin')
        expect((await getUploadProgress(result.sessionId)).transmittedBytes).toBe(0)
        expect(finalizations[0].qcid_links).toHaveLength(1)
    })

    it('does not reuse presence without an explicit authorization grant', async () => {
        const file = makeFile('private.bin', new Uint8Array(20000))
        const arrayBuffer = jest.spyOn(file, 'arrayBuffer')
        const deniedFetcher = async (input: RequestInfo | URL, init?: RequestInit) => String(input).endsWith('/import/finalize')
            ? fetcher(input, init)
            : jsonResponse({ state: 'completed', object_id: 'chunk:abc', chunk_size: file.size, reusable: false })
        const result = remember(await importFiles([file], { ...options, fetcher: deniedFetcher, mode: 'single_file' }))
        await ensureUploaded(result.sessionId)
        expect(arrayBuffer).toHaveBeenCalledTimes(1)
        expect(mockTusUpload).toHaveBeenCalledTimes(1)
    })

    it('retries lost finalize responses without sending completed chunks again', async () => {
        let attempts = 0
        const flaky = async (input: RequestInfo | URL, init?: RequestInit) => {
            if (String(input).endsWith('/import/finalize') && attempts++ === 0) throw new Error('response lost')
            return fetcher(input, init)
        }
        const result = remember(await importFiles([makeFile('retry.txt', 'retry')], { ...options, fetcher: flaky, mode: 'single_file' }))
        await expect(ensureUploaded(result.sessionId)).rejects.toThrow('response lost')
        expect((await getImportSessionStatus(result.sessionId)).objectStatus).toBe('failed')
        await ensureUploaded(result.sessionId)
        expect(mockTusUpload).toHaveBeenCalledTimes(1)
        expect(mockTusUpload.mock.calls[0][1].headers).toEqual({ 'X-Auth': 'business-token', Authorization: 'Bearer test-token' })
        expect(attempts).toBe(2)
        expect((await getImportSessionStatus(result.sessionId)).objectStatus).toBe('ready')
    })

    it('autoStartUpload passes bind to finalize and requires the binding back', async () => {
        const binding = { bucket_id: 'user/app/alice/assets', key: 'k/a.txt', obj_id: '', version: 1, etag: '', created: true }
        const binder = async (input: RequestInfo | URL, init?: RequestInit) => {
            if (!String(input).endsWith('/import/finalize')) return fetcher(input, init)
            const body = JSON.parse(init!.body as string)
            finalizations.push(body)
            const root = body.roots[0]
            return jsonResponse({ ready: true, roots: [{ obj_id: root, ready: true }], warnings: [], ...(body.auto_bind ? { binding: { ...binding, obj_id: root, etag: root } } : {}) })
        }
        const bind = { bucketId: 'user/app/alice/assets', key: 'k/a.txt', ifNoneMatch: '*' }
        const result = remember(await importFiles([makeFile('a.txt', 'A')], { ...options, fetcher: binder, mode: 'single_file', autoStartUpload: true, bind }))
        const status = await ensureUploaded(result.sessionId)
        expect(finalizations[0].auto_bind).toEqual({ bucket_id: 'user/app/alice/assets', key: 'k/a.txt', if_none_match: '*' })
        expect(status.binding?.obj_id).toBe(result.selection.objectId)
        const second = remember(await importFiles([makeFile('b.txt', 'B')], { ...options, mode: 'single_file' }))
        await expect(ensureUploaded(second.sessionId, { bind })).rejects.toThrow('finalize did not bind')
    })

    it('never marks incomplete dependencies ready', async () => {
        const incomplete = async (input: RequestInfo | URL, init?: RequestInit) => String(input).endsWith('/import/finalize')
            ? jsonResponse({ ready: false, roots: [] }) : fetcher(input, init)
        const result = remember(await importFiles([makeFile('missing.txt', 'missing')], { ...options, fetcher: incomplete, mode: 'single_file' }))
        await expect(ensureUploaded(result.sessionId)).rejects.toMatchObject({ code: 'OBJECT_NOT_READY' })
        expect((await getImportSessionStatus(result.sessionId)).objectStatus).toBe('failed')
    })

    it('deduplicates identical leaves without losing directory progress', async () => {
        const result = remember(await importDirectory({ kind: 'dir', name: 'root', children: ['a', 'b'].map(name => ({
            kind: 'dir', name, children: [{ kind: 'file', file: makeFile('same.txt', 'same') }],
        })) }, options))
        await ensureUploaded(result.sessionId)
        const progress = await getUploadProgress(result.sessionId)
        expect(progress.uploadedObjects).toBe(2)
        expect(progress.uploadedBytes).toBe(8)
        expect(progress.transmittedBytes).toBe(4)
        expect(mockTusUpload).toHaveBeenCalledTimes(1)
    })

    it('rejects path traversal and file/directory collisions before I/O', async () => {
        const file = makeFile('evil.txt', 'x')
        Object.defineProperty(file, 'webkitRelativePath', { value: 'root/../evil.txt' })
        await expect(importFiles([file], { ...options, mode: 'single_dir' })).rejects.toMatchObject({ code: 'INVALID_IMPORT_PATH' })
        await expect(importDirectory({ kind: 'dir', name: 'root', children: [
            { kind: 'file', file: makeFile('same', 'x') }, { kind: 'dir', name: 'same', children: [] },
        ] }, options)).rejects.toMatchObject({ code: 'IMPORT_PATH_CONFLICT' })
        await expect(importFiles([], { ...options, mode: 'single_dir' })).rejects.toMatchObject({ code: 'EMPTY_DIRECTORY_UNAVAILABLE' })
        expect(mockTusUpload).not.toHaveBeenCalled()
    })

    it('aborts an in-flight lookup without finalizing, then retries with the same File handles', async () => {
        let signalReady: () => void
        const started = new Promise<void>(resolve => { signalReady = resolve })
        const controller = new AbortController()
        const waiting = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            signalReady!()
            return new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
        }
        const result = remember(await importFiles([makeFile('interrupt.txt', 'data')], { ...options, mode: 'single_file' }))
        const upload = ensureUploaded(result.sessionId, { fetcher: waiting, signal: controller.signal })
        await started
        controller.abort()
        await expect(upload).rejects.toMatchObject({ code: 'USER_CANCELLED' })
        expect((await getImportSessionStatus(result.sessionId)).objectStatus).toBe('cancelled')
        expect(finalizations).toHaveLength(0)
        await ensureUploaded(result.sessionId, { fetcher })
        expect((await getImportSessionStatus(result.sessionId)).objectStatus).toBe('ready')
    })

    it('cancels pending work and permits retry, then releases the session', async () => {
        const result = remember(await importFiles([makeFile('cancel.txt', 'cancel')], { ...options, mode: 'single_file' }))
        cancelImportSession(result.sessionId)
        expect((await getImportSessionStatus(result.sessionId)).objectStatus).toBe('cancelled')
        await ensureUploaded(result.sessionId)
        expect((await getImportSessionStatus(result.sessionId)).objectStatus).toBe('ready')
        releaseImportSession(result.sessionId)
        sessions.splice(sessions.indexOf(result.sessionId), 1)
        await expect(getImportSessionStatus(result.sessionId)).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' })
        expect(result.selection._file).toBeUndefined()
    })
})
