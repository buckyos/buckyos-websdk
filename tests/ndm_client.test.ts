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
    ImportProvider,
    RuntimeCapabilities,
    ImportedFileObject,
    getObject,
    queryChunkState,
    outboxCount,
    removeChunk,
    NdmStoreApiError,
} from '../src/ndm_client'
import { createSDKModule, RuntimeType } from '../src/sdk_core'

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
})
