import { createSDKModule, RuntimeType } from '../src/sdk_core'
import {
    createNdmProxyClient,
    getChunkData,
    openChunkReader,
    putChunk,
    queryChunkState,
    NdmProxyApiError,
} from '../src/ndm_proxy'

describe('ndm_proxy', () => {
    const sdk = createSDKModule('universal')
    const originalFetch = global.fetch

    afterEach(() => {
        global.fetch = originalFetch
    })

    async function initAppService() {
        await sdk.initBuckyOS('test-app', {
            appId: 'test-app',
            runtimeType: RuntimeType.AppService,
            sessionToken: 'session-token-123',
            ownerUserId: 'alice',
            zoneHost: 'example.com',
            defaultProtocol: 'https://',
        })
    }

    it('sends JSON RPC requests to /ndm/proxy/v1/rpc and attaches session token', async () => {
        await initAppService()

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
            'https://gateway.example.com/ndm/proxy/v1/rpc/query_chunk_state',
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

    it('exposes a composed client with rpc, reader, and writer groups', async () => {
        await initAppService()

        const fetchMock = jest.fn().mockImplementation(async () => (
            new Response(JSON.stringify({ exists: true }), {
                status: 200,
                headers: {
                    'content-type': 'application/json',
                },
            })
        ))
        global.fetch = fetchMock as typeof fetch

        const client = createNdmProxyClient({
            endpoint: 'https://gateway.example.com',
            sessionToken: null,
        })

        await expect(client.rpc.haveChunk({
            chunk_id: 'chunk:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        })).resolves.toEqual({ exists: true })

        await expect(client.haveChunk({
            chunk_id: 'chunk:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        })).resolves.toEqual({ exists: true })
    })

    it('returns reader metadata for streaming read endpoints', async () => {
        await initAppService()

        const fetchMock = jest.fn().mockResolvedValue(
            new Response(new Uint8Array([1, 2, 3]), {
                status: 200,
                headers: {
                    'content-type': 'application/octet-stream',
                    'NDM-Total-Size': '10',
                    'NDM-Offset': '7',
                    'NDM-Reader-Kind': 'chunk',
                    'Content-Length': '3',
                },
            }),
        )
        global.fetch = fetchMock as typeof fetch

        const result = await openChunkReader({
            chunk_id: 'chunk:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
            offset: 7,
        }, {
            endpoint: 'https://gateway.example.com',
            sessionToken: null,
        })

        expect(result.totalSize).toBe(10)
        expect(result.offset).toBe(7)
        expect(result.contentLength).toBe(3)
        expect(result.readerKind).toBe('chunk')
        expect(fetchMock).toHaveBeenCalledWith(
            'https://gateway.example.com/ndm/proxy/v1/read/chunk/open',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({
                    chunk_id: 'chunk:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
                    offset: 7,
                }),
                headers: expect.objectContaining({
                    Accept: 'application/octet-stream',
                    'Content-Type': 'application/json',
                }),
            }),
        )
    })

    it('reads complete chunk data into bytes', async () => {
        await initAppService()

        const fetchMock = jest.fn().mockResolvedValue(
            new Response(new Uint8Array([9, 8, 7]), {
                status: 200,
                headers: {
                    'content-type': 'application/octet-stream',
                    'NDM-Total-Size': '3',
                },
            }),
        )
        global.fetch = fetchMock as typeof fetch

        const result = await getChunkData({
            chunk_id: 'chunk:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        }, {
            endpoint: 'https://gateway.example.com',
            sessionToken: null,
        })

        expect(Array.from(result)).toEqual([9, 8, 7])
        expect(fetchMock).toHaveBeenCalledWith(
            'https://gateway.example.com/ndm/proxy/v1/read/chunk/data',
            expect.objectContaining({
                method: 'POST',
            }),
        )
    })

    it('writes chunks with the proxy write route and protocol headers', async () => {
        await initAppService()

        const fetchMock = jest.fn().mockResolvedValue(
            new Response(null, {
                status: 201,
                headers: {
                    'NDM-Chunk-Size': '3',
                    'NDM-Chunk-Write-Outcome': 'written',
                    'NDM-Chunk-Object-ID': 'chunk:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
                },
            }),
        )
        global.fetch = fetchMock as typeof fetch

        const data = new Uint8Array([1, 2, 3])
        const result = await putChunk(
            'chunk:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
            data,
            {
                endpoint: 'https://gateway.example.com',
                sessionToken: null,
            },
        )

        expect(result).toEqual({
            chunkSize: 3,
            outcome: 'written',
            chunkObjectId: 'chunk:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        })
        expect(fetchMock).toHaveBeenCalledWith(
            'https://gateway.example.com/ndm/proxy/v1/write/chunk/chunk%3Aeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
            expect.objectContaining({
                method: 'PUT',
                body: data,
                headers: expect.objectContaining({
                    Accept: 'application/json',
                    'Content-Type': 'application/octet-stream',
                    'Content-Length': '3',
                    'NDM-Chunk-Size': '3',
                }),
            }),
        )
    })

    it('surfaces JSON protocol errors with status and error code', async () => {
        await initAppService()

        const fetchMock = jest.fn().mockResolvedValue(
            new Response(JSON.stringify({
                error: 'not_found',
                message: 'chunk not found',
            }), {
                status: 404,
                headers: {
                    'content-type': 'application/json',
                },
            }),
        )
        global.fetch = fetchMock as typeof fetch

        await expect(
            getChunkData({
                chunk_id: 'chunk:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
            }, {
                endpoint: 'https://gateway.example.com',
            }),
        ).rejects.toEqual(expect.objectContaining({
            name: 'NdmProxyApiError',
            status: 404,
            errorCode: 'not_found',
            message: 'chunk not found',
        } satisfies Partial<NdmProxyApiError>))
    })

    it('rejects pure Browser runtime calls', async () => {
        await sdk.initBuckyOS('test-app', {
            appId: 'test-app',
            runtimeType: RuntimeType.Browser,
            zoneHost: 'example.com',
            defaultProtocol: 'https://',
        })

        await expect(
            queryChunkState({
                chunk_id: 'chunk:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            }, {
                endpoint: 'https://gateway.example.com',
            }),
        ).rejects.toMatchObject({
            code: 'PROXY_API_NOT_SUPPORTED_IN_RUNTIME',
        })
    })

    it('rejects AppRuntime calls because proxy is for AppClient/AppService runtimes', async () => {
        await sdk.initBuckyOS('test-app', {
            appId: 'test-app',
            runtimeType: RuntimeType.AppRuntime,
            zoneHost: 'example.com',
            defaultProtocol: 'https://',
        })

        await expect(
            queryChunkState({
                chunk_id: 'chunk:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            }, {
                endpoint: 'https://gateway.example.com',
            }),
        ).rejects.toMatchObject({
            code: 'PROXY_API_NOT_SUPPORTED_IN_RUNTIME',
        })
    })
})
