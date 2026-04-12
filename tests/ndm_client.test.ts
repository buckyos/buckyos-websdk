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

    beforeAll(() => { originalProvider = getImportProvider() })
    afterEach(() => {
        setImportProvider(originalProvider)
        global.fetch = originalFetch
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
        await sdk.initBuckyOS('test-app', {
            appId: 'test-app',
            runtimeType: RuntimeType.AppService,
            sessionToken: 'session-token-123',
            ownerUserId: 'alice',
            zoneHost: 'example.com',
            defaultProtocol: 'https://',
        })

        const size = 33 * 1024 * 1024
        const data = new Uint8Array(size)
        for (let i = 0; i < size; i++) data[i] = i & 0xff

        setImportProvider(mockProvider({}, [makeFile('big-upload.bin', data)]))
        const result = await pickupAndImport({ mode: 'single_file' })

        await startUpload(result.sessionId, {
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
        expect(firstMetadata.logical_path).toBe(`default/${firstMetadata.chunk_hash}`)
        expect(secondMetadata.logical_path).toBe(`default/${secondMetadata.chunk_hash}`)
        expect(firstMetadata.chunk_hash).not.toBe(secondMetadata.chunk_hash)
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
        const chunkListId = 'chunklist:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
        const expectedFileObj = new NdnFileObject(file.name, file.size, chunkListId)
        const [expectedObjId] = expectedFileObj.genObjId()

        const fetchMock = jest.fn().mockResolvedValue(
            new Response(JSON.stringify({
                object_id: qcid,
                scope: 'app',
                state: 'same_as',
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

        const result = await pickupAndImport({ mode: 'single_file' })
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
        expect(result.uploadStatus).toBe('not_required')
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
        await sdk.initBuckyOS('test-app', {
            appId: 'test-app',
            runtimeType: RuntimeType.AppService,
            sessionToken: 'session-token-123',
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
                    Authorization: 'Bearer session-token-123',
                }),
            }),
        )
    })

    it('structured store APIs derive endpoint from active runtime when omitted', async () => {
        await sdk.initBuckyOS('test-app', {
            appId: 'test-app',
            runtimeType: RuntimeType.AppService,
            sessionToken: 'service-token',
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
        await sdk.initBuckyOS('test-app', {
            appId: 'test-app',
            runtimeType: RuntimeType.AppService,
            sessionToken: 'service-token',
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
