/**
 * ndm_proxy - NamedDataMgr Proxy Protocol client for trusted runtimes.
 *
 * This module targets AppClient/AppService style runtimes that talk to the
 * `/ndm/proxy/v1` protocol. Browser-oriented import/upload flows remain in
 * `ndm_client`.
 */

import {
    getActiveRuntimeType,
    getActiveSessionToken,
    getActiveZoneGatewayOrigin,
} from './sdk_core'
import { RuntimeType } from './runtime'

export const NDM_PROXY_V1_PATH = '/ndm/proxy/v1'

export interface NdmProxyRequestOptions {
    /**
     * Base origin for the NDM proxy endpoint, for example
     * `http://host.docker.internal:3180` or `http://127.0.0.1:3180`.
     */
    endpoint?: string
    fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    headers?: Record<string, string>
    credentials?: RequestCredentials
    sessionToken?: string | null
}

export interface NdmProxyErrorBody {
    error?: string
    message?: string
    [key: string]: unknown
}

export class NdmProxyApiError extends Error {
    public readonly status: number
    public readonly errorCode?: string
    public readonly responseBody?: unknown

    constructor(status: number, errorCode?: string, message?: string, responseBody?: unknown) {
        super(message ?? `NDM proxy request failed with status ${status}`)
        this.name = 'NdmProxyApiError'
        this.status = status
        this.errorCode = errorCode
        this.responseBody = responseBody
    }
}

export type NdmProxyErrorCode =
    | 'PROXY_API_NOT_SUPPORTED_IN_RUNTIME'
    | 'PROXY_API_ENDPOINT_REQUIRED'
    | 'PROXY_API_CHUNK_SIZE_REQUIRED'

export class NdmProxyError extends Error {
    public readonly code: NdmProxyErrorCode

    constructor(code: NdmProxyErrorCode, message?: string) {
        super(message ?? code)
        this.name = 'NdmProxyError'
        this.code = code
    }
}

// ============================================================
// Protocol types
// ============================================================

export interface GetObjectRequest {
    obj_id: string
}

export interface GetObjectResponse {
    obj_id: string
    obj_data: string
}

export interface ObjIdWithInnerPathRequest {
    obj_id: string
    inner_path?: string | null
}

export interface OpenObjectResponse {
    obj_data: string
}

export interface GetDirChildRequest {
    dir_obj_id: string
    item_name: string
}

export interface GetDirChildResponse {
    obj_id: string
}

export interface IsObjectStoredResponse {
    stored: boolean
}

export interface IsObjectExistResponse {
    exists: boolean
}

export type QueryObjectByIdResponse =
    | { state: 'not_exist' }
    | { state: 'object'; obj_data: string }

export interface PutObjectRequest {
    obj_id: string
    obj_data: string
}

export interface ChunkIdRequest {
    chunk_id: string
}

export interface HaveChunkResponse {
    exists: boolean
}

export interface ChunkStateLocalInfoRange {
    start: number
    end: number
}

export interface ChunkStateLocalInfo {
    qcid: string
    last_modify_time: number
    range?: ChunkStateLocalInfoRange
}

export type QueryChunkStateResponse =
    | { state: 'new'; chunk_size: number }
    | { state: 'completed'; chunk_size: number }
    | { state: 'disabled'; chunk_size: number }
    | { state: 'not_exist'; chunk_size: number }
    | { state: 'local_link'; chunk_size: number; local_info: ChunkStateLocalInfo }
    | { state: 'same_as'; chunk_size: number; same_as: string }

export interface AddChunkBySameAsRequest {
    big_chunk_id: string
    chunk_list_id: string
    big_chunk_size: number
}

export type PinScope = 'recursive' | 'skeleton' | 'lease' | string

export interface EdgeMsg {
    op: 'add' | 'remove' | string
    referee: string
    referrer: string
    target_epoch: number
}

export interface PinRequest {
    obj_id: string
    owner: string
    scope: PinScope
    ttl_secs?: number
}

export interface UnpinRequest {
    obj_id: string
    owner: string
}

export interface OwnerRequest {
    owner: string
}

export interface CountResponse {
    count: number
}

export interface FsAnchorRequest {
    obj_id: string
    inode_id: number
    field_tag: number
}

export interface InodeRequest {
    inode_id: number
}

export type AnchorStateValue = 'Pending' | 'Materializing' | string

export interface AnchorStateResponse {
    state: AnchorStateValue
}

export interface ForcedGcUntilRequest {
    target_bytes: number
}

export interface ForcedGcUntilResponse {
    freed_bytes: number
}

export interface OpenChunkReaderRequest {
    chunk_id: string
    offset?: number
}

export interface GetChunkPieceRequest {
    chunk_id: string
    offset: number
    piece_size: number
}

export interface OpenChunkListReaderRequest {
    chunk_list_id: string
    offset?: number
}

export interface OpenReaderRequest {
    obj_id: string
    inner_path?: string | null
}

export type NdmProxyReaderKind = 'chunk' | 'chunklist' | 'object' | string

export interface NdmProxyReadResult {
    response: Response
    body: ReadableStream<Uint8Array> | null
    totalSize: number | null
    resolvedObjectId?: string
    readerKind?: NdmProxyReaderKind
    contentLength: number | null
    offset: number | null
}

export type ChunkWriteOutcome = 'written' | 'already_exists' | string

export interface PutChunkByReaderOptions extends NdmProxyRequestOptions {
    chunkSize?: number
}

export interface PutChunkResponse {
    chunkSize: number | null
    outcome?: ChunkWriteOutcome
    chunkObjectId?: string
}

// ============================================================
// Shared transport helpers
// ============================================================

function defaultProxyFetcher(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
        return window.fetch(input, init)
    }

    if (typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function') {
        return globalThis.fetch(input, init)
    }

    throw new Error('fetch is not available in this runtime')
}

function normalizeEndpoint(endpoint: string): string {
    return endpoint.replace(/\/+$/, '')
}

function ensureProxyApiSupportedRuntime(): void {
    const runtimeType = getActiveRuntimeType()
    if (runtimeType === RuntimeType.Browser || runtimeType === RuntimeType.AppRuntime) {
        throw new NdmProxyError(
            'PROXY_API_NOT_SUPPORTED_IN_RUNTIME',
            'NDM proxy APIs are not available in Browser/AppRuntime; use ndm_client for browser import/upload flows',
        )
    }
}

function resolveProxyEndpoint(options?: NdmProxyRequestOptions): string {
    if (options?.endpoint) {
        return normalizeEndpoint(options.endpoint)
    }

    const activeOrigin = getActiveZoneGatewayOrigin()
    if (activeOrigin) {
        return normalizeEndpoint(activeOrigin)
    }

    throw new NdmProxyError(
        'PROXY_API_ENDPOINT_REQUIRED',
        'NDM proxy endpoint is unknown; pass options.endpoint or call initBuckyOS first',
    )
}

async function buildHeaders(
    options: NdmProxyRequestOptions | undefined,
    baseHeaders: Record<string, string>,
): Promise<Record<string, string>> {
    const sessionToken = options?.sessionToken !== undefined
        ? options.sessionToken
        : await getActiveSessionToken()

    const headers: Record<string, string> = {
        ...baseHeaders,
        ...(options?.headers ?? {}),
    }

    if (sessionToken && !headers.Authorization) {
        headers.Authorization = `Bearer ${sessionToken}`
    }

    return headers
}

async function parseErrorResponse(response: Response): Promise<never> {
    const contentType = response.headers.get('content-type') ?? ''
    const isJsonResponse = contentType.includes('application/json')
    const responseBody = isJsonResponse
        ? await response.json() as unknown
        : await response.text()

    const errorBody = responseBody && typeof responseBody === 'object' && !Array.isArray(responseBody)
        ? responseBody as NdmProxyErrorBody
        : null

    throw new NdmProxyApiError(
        response.status,
        errorBody?.error,
        errorBody?.message ?? (typeof responseBody === 'string' && responseBody.length > 0
            ? responseBody
            : `NDM proxy request failed with status ${response.status}`),
        responseBody,
    )
}

async function callProxyRpc<TRequest, TResponse>(
    methodName: string,
    requestBody: TRequest,
    options?: NdmProxyRequestOptions,
): Promise<TResponse> {
    ensureProxyApiSupportedRuntime()

    const endpoint = resolveProxyEndpoint(options)
    const fetcher = options?.fetcher ?? defaultProxyFetcher
    const headers = await buildHeaders(options, {
        Accept: 'application/json',
        'Content-Type': 'application/json',
    })

    const response = await fetcher(`${endpoint}${NDM_PROXY_V1_PATH}/rpc/${methodName}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        credentials: options?.credentials ?? 'include',
    })

    if (!response.ok) {
        return parseErrorResponse(response)
    }

    if (response.status === 204) {
        await response.body?.cancel()
        return undefined as TResponse
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json')) {
        const text = await response.text()
        throw new NdmProxyApiError(
            response.status,
            'invalid_data',
            text.length > 0 ? text : 'NDM proxy JSON RPC returned a non-JSON response',
            text,
        )
    }

    return await response.json() as TResponse
}

function parseNullableNumberHeader(headers: Headers, name: string): number | null {
    const value = headers.get(name)
    if (value === null || value.trim() === '') {
        return null
    }

    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
}

async function postProxyRead(
    path: string,
    requestBody: unknown,
    options?: NdmProxyRequestOptions,
): Promise<NdmProxyReadResult> {
    ensureProxyApiSupportedRuntime()

    const endpoint = resolveProxyEndpoint(options)
    const fetcher = options?.fetcher ?? defaultProxyFetcher
    const headers = await buildHeaders(options, {
        Accept: 'application/octet-stream',
        'Content-Type': 'application/json',
    })

    const response = await fetcher(`${endpoint}${NDM_PROXY_V1_PATH}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        credentials: options?.credentials ?? 'include',
    })

    if (!response.ok) {
        return parseErrorResponse(response)
    }

    return {
        response,
        body: response.body,
        totalSize: parseNullableNumberHeader(response.headers, 'NDM-Total-Size'),
        resolvedObjectId: response.headers.get('NDM-Resolved-Object-ID') ?? undefined,
        readerKind: response.headers.get('NDM-Reader-Kind') ?? undefined,
        contentLength: parseNullableNumberHeader(response.headers, 'Content-Length'),
        offset: parseNullableNumberHeader(response.headers, 'NDM-Offset'),
    }
}

async function readResponseBytes(result: NdmProxyReadResult): Promise<Uint8Array> {
    const buffer = await result.response.arrayBuffer()
    return new Uint8Array(buffer)
}

function bodyLength(body: BodyInit): number | null {
    if (body instanceof Uint8Array) {
        return body.byteLength
    }

    if (body instanceof ArrayBuffer) {
        return body.byteLength
    }

    if (typeof Blob !== 'undefined' && body instanceof Blob) {
        return body.size
    }

    if (typeof body === 'string') {
        return new TextEncoder().encode(body).byteLength
    }

    return null
}

function chunkWritePath(chunkId: string): string {
    return `${NDM_PROXY_V1_PATH}/write/chunk/${encodeURIComponent(chunkId)}`
}

// ============================================================
// Layered clients
// ============================================================

export class NdmProxyRpcClient {
    private readonly options?: NdmProxyRequestOptions

    constructor(options?: NdmProxyRequestOptions) {
        this.options = options
    }

    getObject(request: GetObjectRequest, options?: NdmProxyRequestOptions): Promise<GetObjectResponse> {
        return getObject(request, { ...this.options, ...options })
    }

    openObject(request: ObjIdWithInnerPathRequest, options?: NdmProxyRequestOptions): Promise<OpenObjectResponse> {
        return openObject(request, { ...this.options, ...options })
    }

    getDirChild(request: GetDirChildRequest, options?: NdmProxyRequestOptions): Promise<GetDirChildResponse> {
        return getDirChild(request, { ...this.options, ...options })
    }

    isObjectStored(request: ObjIdWithInnerPathRequest, options?: NdmProxyRequestOptions): Promise<IsObjectStoredResponse> {
        return isObjectStored(request, { ...this.options, ...options })
    }

    isObjectExist(request: GetObjectRequest, options?: NdmProxyRequestOptions): Promise<IsObjectExistResponse> {
        return isObjectExist(request, { ...this.options, ...options })
    }

    queryObjectById(request: GetObjectRequest, options?: NdmProxyRequestOptions): Promise<QueryObjectByIdResponse> {
        return queryObjectById(request, { ...this.options, ...options })
    }

    putObject(request: PutObjectRequest, options?: NdmProxyRequestOptions): Promise<void> {
        return putObject(request, { ...this.options, ...options })
    }

    removeObject(request: GetObjectRequest, options?: NdmProxyRequestOptions): Promise<void> {
        return removeObject(request, { ...this.options, ...options })
    }

    haveChunk(request: ChunkIdRequest, options?: NdmProxyRequestOptions): Promise<HaveChunkResponse> {
        return haveChunk(request, { ...this.options, ...options })
    }

    queryChunkState(request: ChunkIdRequest, options?: NdmProxyRequestOptions): Promise<QueryChunkStateResponse> {
        return queryChunkState(request, { ...this.options, ...options })
    }

    removeChunk(request: ChunkIdRequest, options?: NdmProxyRequestOptions): Promise<void> {
        return removeChunk(request, { ...this.options, ...options })
    }

    addChunkBySameAs(request: AddChunkBySameAsRequest, options?: NdmProxyRequestOptions): Promise<void> {
        return addChunkBySameAs(request, { ...this.options, ...options })
    }

    applyEdge(request: EdgeMsg, options?: NdmProxyRequestOptions): Promise<void> {
        return applyEdge(request, { ...this.options, ...options })
    }

    pin(request: PinRequest, options?: NdmProxyRequestOptions): Promise<void> {
        return pin(request, { ...this.options, ...options })
    }

    unpin(request: UnpinRequest, options?: NdmProxyRequestOptions): Promise<void> {
        return unpin(request, { ...this.options, ...options })
    }

    unpinOwner(request: OwnerRequest, options?: NdmProxyRequestOptions): Promise<CountResponse> {
        return unpinOwner(request, { ...this.options, ...options })
    }

    fsAcquire(request: FsAnchorRequest, options?: NdmProxyRequestOptions): Promise<void> {
        return fsAcquire(request, { ...this.options, ...options })
    }

    fsRelease(request: FsAnchorRequest, options?: NdmProxyRequestOptions): Promise<void> {
        return fsRelease(request, { ...this.options, ...options })
    }

    fsReleaseInode(request: InodeRequest, options?: NdmProxyRequestOptions): Promise<CountResponse> {
        return fsReleaseInode(request, { ...this.options, ...options })
    }

    fsAnchorState(request: FsAnchorRequest, options?: NdmProxyRequestOptions): Promise<AnchorStateResponse> {
        return fsAnchorState(request, { ...this.options, ...options })
    }

    forcedGcUntil(request: ForcedGcUntilRequest, options?: NdmProxyRequestOptions): Promise<ForcedGcUntilResponse> {
        return forcedGcUntil(request, { ...this.options, ...options })
    }

    outboxCount(options?: NdmProxyRequestOptions): Promise<CountResponse> {
        return outboxCount({ ...this.options, ...options })
    }

    debugDumpExpandState<TResponse = unknown>(
        request: GetObjectRequest,
        options?: NdmProxyRequestOptions,
    ): Promise<TResponse> {
        return debugDumpExpandState<TResponse>(request, { ...this.options, ...options })
    }

    anchorState(request: UnpinRequest, options?: NdmProxyRequestOptions): Promise<AnchorStateResponse> {
        return anchorState(request, { ...this.options, ...options })
    }
}

export class NdmProxyReaderClient {
    private readonly options?: NdmProxyRequestOptions

    constructor(options?: NdmProxyRequestOptions) {
        this.options = options
    }

    openChunkReader(request: OpenChunkReaderRequest, options?: NdmProxyRequestOptions): Promise<NdmProxyReadResult> {
        return openChunkReader(request, { ...this.options, ...options })
    }

    getChunkData(request: ChunkIdRequest, options?: NdmProxyRequestOptions): Promise<Uint8Array> {
        return getChunkData(request, { ...this.options, ...options })
    }

    getChunkPiece(request: GetChunkPieceRequest, options?: NdmProxyRequestOptions): Promise<Uint8Array> {
        return getChunkPiece(request, { ...this.options, ...options })
    }

    openChunkListReader(request: OpenChunkListReaderRequest, options?: NdmProxyRequestOptions): Promise<NdmProxyReadResult> {
        return openChunkListReader(request, { ...this.options, ...options })
    }

    openReader(request: OpenReaderRequest, options?: NdmProxyRequestOptions): Promise<NdmProxyReadResult> {
        return openReader(request, { ...this.options, ...options })
    }
}

export class NdmProxyWriterClient {
    private readonly options?: NdmProxyRequestOptions

    constructor(options?: NdmProxyRequestOptions) {
        this.options = options
    }

    putChunkByReader(
        chunkId: string,
        body: BodyInit,
        options?: PutChunkByReaderOptions,
    ): Promise<PutChunkResponse> {
        return putChunkByReader(chunkId, body, { ...this.options, ...options })
    }

    putChunk(
        chunkId: string,
        data: Uint8Array | ArrayBuffer,
        options?: PutChunkByReaderOptions,
    ): Promise<PutChunkResponse> {
        return putChunk(chunkId, data, { ...this.options, ...options })
    }
}

export class NdmProxyClient {
    public readonly rpc: NdmProxyRpcClient
    public readonly reader: NdmProxyReaderClient
    public readonly writer: NdmProxyWriterClient
    private readonly options?: NdmProxyRequestOptions

    constructor(options?: NdmProxyRequestOptions) {
        this.options = options
        this.rpc = new NdmProxyRpcClient(options)
        this.reader = new NdmProxyReaderClient(options)
        this.writer = new NdmProxyWriterClient(options)
    }

    getObject(request: GetObjectRequest, options?: NdmProxyRequestOptions): Promise<GetObjectResponse> {
        return this.rpc.getObject(request, options)
    }

    openObject(request: ObjIdWithInnerPathRequest, options?: NdmProxyRequestOptions): Promise<OpenObjectResponse> {
        return this.rpc.openObject(request, options)
    }

    getDirChild(request: GetDirChildRequest, options?: NdmProxyRequestOptions): Promise<GetDirChildResponse> {
        return this.rpc.getDirChild(request, options)
    }

    isObjectStored(request: ObjIdWithInnerPathRequest, options?: NdmProxyRequestOptions): Promise<IsObjectStoredResponse> {
        return this.rpc.isObjectStored(request, options)
    }

    isObjectExist(request: GetObjectRequest, options?: NdmProxyRequestOptions): Promise<IsObjectExistResponse> {
        return this.rpc.isObjectExist(request, options)
    }

    queryObjectById(request: GetObjectRequest, options?: NdmProxyRequestOptions): Promise<QueryObjectByIdResponse> {
        return this.rpc.queryObjectById(request, options)
    }

    putObject(request: PutObjectRequest, options?: NdmProxyRequestOptions): Promise<void> {
        return this.rpc.putObject(request, options)
    }

    removeObject(request: GetObjectRequest, options?: NdmProxyRequestOptions): Promise<void> {
        return this.rpc.removeObject(request, options)
    }

    haveChunk(request: ChunkIdRequest, options?: NdmProxyRequestOptions): Promise<HaveChunkResponse> {
        return this.rpc.haveChunk(request, options)
    }

    queryChunkState(request: ChunkIdRequest, options?: NdmProxyRequestOptions): Promise<QueryChunkStateResponse> {
        return this.rpc.queryChunkState(request, options)
    }

    removeChunk(request: ChunkIdRequest, options?: NdmProxyRequestOptions): Promise<void> {
        return this.rpc.removeChunk(request, options)
    }

    addChunkBySameAs(request: AddChunkBySameAsRequest, options?: NdmProxyRequestOptions): Promise<void> {
        return this.rpc.addChunkBySameAs(request, options)
    }

    applyEdge(request: EdgeMsg, options?: NdmProxyRequestOptions): Promise<void> {
        return this.rpc.applyEdge(request, options)
    }

    pin(request: PinRequest, options?: NdmProxyRequestOptions): Promise<void> {
        return this.rpc.pin(request, options)
    }

    unpin(request: UnpinRequest, options?: NdmProxyRequestOptions): Promise<void> {
        return this.rpc.unpin(request, options)
    }

    unpinOwner(request: OwnerRequest, options?: NdmProxyRequestOptions): Promise<CountResponse> {
        return this.rpc.unpinOwner(request, options)
    }

    fsAcquire(request: FsAnchorRequest, options?: NdmProxyRequestOptions): Promise<void> {
        return this.rpc.fsAcquire(request, options)
    }

    fsRelease(request: FsAnchorRequest, options?: NdmProxyRequestOptions): Promise<void> {
        return this.rpc.fsRelease(request, options)
    }

    fsReleaseInode(request: InodeRequest, options?: NdmProxyRequestOptions): Promise<CountResponse> {
        return this.rpc.fsReleaseInode(request, options)
    }

    fsAnchorState(request: FsAnchorRequest, options?: NdmProxyRequestOptions): Promise<AnchorStateResponse> {
        return this.rpc.fsAnchorState(request, options)
    }

    forcedGcUntil(request: ForcedGcUntilRequest, options?: NdmProxyRequestOptions): Promise<ForcedGcUntilResponse> {
        return this.rpc.forcedGcUntil(request, options)
    }

    outboxCount(options?: NdmProxyRequestOptions): Promise<CountResponse> {
        return this.rpc.outboxCount(options)
    }

    debugDumpExpandState<TResponse = unknown>(
        request: GetObjectRequest,
        options?: NdmProxyRequestOptions,
    ): Promise<TResponse> {
        return this.rpc.debugDumpExpandState<TResponse>(request, options)
    }

    anchorState(request: UnpinRequest, options?: NdmProxyRequestOptions): Promise<AnchorStateResponse> {
        return this.rpc.anchorState(request, options)
    }

    openChunkReader(request: OpenChunkReaderRequest, options?: NdmProxyRequestOptions): Promise<NdmProxyReadResult> {
        return this.reader.openChunkReader(request, options)
    }

    getChunkData(request: ChunkIdRequest, options?: NdmProxyRequestOptions): Promise<Uint8Array> {
        return this.reader.getChunkData(request, options)
    }

    getChunkPiece(request: GetChunkPieceRequest, options?: NdmProxyRequestOptions): Promise<Uint8Array> {
        return this.reader.getChunkPiece(request, options)
    }

    openChunkListReader(request: OpenChunkListReaderRequest, options?: NdmProxyRequestOptions): Promise<NdmProxyReadResult> {
        return this.reader.openChunkListReader(request, options)
    }

    openReader(request: OpenReaderRequest, options?: NdmProxyRequestOptions): Promise<NdmProxyReadResult> {
        return this.reader.openReader(request, options)
    }

    putChunkByReader(
        chunkId: string,
        body: BodyInit,
        options?: PutChunkByReaderOptions,
    ): Promise<PutChunkResponse> {
        return this.writer.putChunkByReader(chunkId, body, options)
    }

    putChunk(
        chunkId: string,
        data: Uint8Array | ArrayBuffer,
        options?: PutChunkByReaderOptions,
    ): Promise<PutChunkResponse> {
        return this.writer.putChunk(chunkId, data, options)
    }

    withOptions(options: NdmProxyRequestOptions): NdmProxyClient {
        return new NdmProxyClient({ ...this.options, ...options })
    }
}

// ============================================================
// RPC helpers
// ============================================================

export function createNdmProxyClient(options?: NdmProxyRequestOptions): NdmProxyClient {
    return new NdmProxyClient(options)
}

export async function getObject(
    request: GetObjectRequest,
    options?: NdmProxyRequestOptions,
): Promise<GetObjectResponse> {
    return callProxyRpc<GetObjectRequest, GetObjectResponse>('get_object', request, options)
}

export async function openObject(
    request: ObjIdWithInnerPathRequest,
    options?: NdmProxyRequestOptions,
): Promise<OpenObjectResponse> {
    return callProxyRpc<ObjIdWithInnerPathRequest, OpenObjectResponse>('open_object', request, options)
}

export async function getDirChild(
    request: GetDirChildRequest,
    options?: NdmProxyRequestOptions,
): Promise<GetDirChildResponse> {
    return callProxyRpc<GetDirChildRequest, GetDirChildResponse>('get_dir_child', request, options)
}

export async function isObjectStored(
    request: ObjIdWithInnerPathRequest,
    options?: NdmProxyRequestOptions,
): Promise<IsObjectStoredResponse> {
    return callProxyRpc<ObjIdWithInnerPathRequest, IsObjectStoredResponse>('is_object_stored', request, options)
}

export async function isObjectExist(
    request: GetObjectRequest,
    options?: NdmProxyRequestOptions,
): Promise<IsObjectExistResponse> {
    return callProxyRpc<GetObjectRequest, IsObjectExistResponse>('is_object_exist', request, options)
}

export async function queryObjectById(
    request: GetObjectRequest,
    options?: NdmProxyRequestOptions,
): Promise<QueryObjectByIdResponse> {
    return callProxyRpc<GetObjectRequest, QueryObjectByIdResponse>('query_object_by_id', request, options)
}

export async function putObject(
    request: PutObjectRequest,
    options?: NdmProxyRequestOptions,
): Promise<void> {
    return callProxyRpc<PutObjectRequest, void>('put_object', request, options)
}

export async function removeObject(
    request: GetObjectRequest,
    options?: NdmProxyRequestOptions,
): Promise<void> {
    return callProxyRpc<GetObjectRequest, void>('remove_object', request, options)
}

export async function haveChunk(
    request: ChunkIdRequest,
    options?: NdmProxyRequestOptions,
): Promise<HaveChunkResponse> {
    return callProxyRpc<ChunkIdRequest, HaveChunkResponse>('have_chunk', request, options)
}

export async function queryChunkState(
    request: ChunkIdRequest,
    options?: NdmProxyRequestOptions,
): Promise<QueryChunkStateResponse> {
    return callProxyRpc<ChunkIdRequest, QueryChunkStateResponse>('query_chunk_state', request, options)
}

export async function removeChunk(
    request: ChunkIdRequest,
    options?: NdmProxyRequestOptions,
): Promise<void> {
    return callProxyRpc<ChunkIdRequest, void>('remove_chunk', request, options)
}

export async function addChunkBySameAs(
    request: AddChunkBySameAsRequest,
    options?: NdmProxyRequestOptions,
): Promise<void> {
    return callProxyRpc<AddChunkBySameAsRequest, void>('add_chunk_by_same_as', request, options)
}

export async function applyEdge(
    request: EdgeMsg,
    options?: NdmProxyRequestOptions,
): Promise<void> {
    return callProxyRpc<EdgeMsg, void>('apply_edge', request, options)
}

export async function pin(
    request: PinRequest,
    options?: NdmProxyRequestOptions,
): Promise<void> {
    return callProxyRpc<PinRequest, void>('pin', request, options)
}

export async function unpin(
    request: UnpinRequest,
    options?: NdmProxyRequestOptions,
): Promise<void> {
    return callProxyRpc<UnpinRequest, void>('unpin', request, options)
}

export async function unpinOwner(
    request: OwnerRequest,
    options?: NdmProxyRequestOptions,
): Promise<CountResponse> {
    return callProxyRpc<OwnerRequest, CountResponse>('unpin_owner', request, options)
}

export async function fsAcquire(
    request: FsAnchorRequest,
    options?: NdmProxyRequestOptions,
): Promise<void> {
    return callProxyRpc<FsAnchorRequest, void>('fs_acquire', request, options)
}

export async function fsRelease(
    request: FsAnchorRequest,
    options?: NdmProxyRequestOptions,
): Promise<void> {
    return callProxyRpc<FsAnchorRequest, void>('fs_release', request, options)
}

export async function fsReleaseInode(
    request: InodeRequest,
    options?: NdmProxyRequestOptions,
): Promise<CountResponse> {
    return callProxyRpc<InodeRequest, CountResponse>('fs_release_inode', request, options)
}

export async function fsAnchorState(
    request: FsAnchorRequest,
    options?: NdmProxyRequestOptions,
): Promise<AnchorStateResponse> {
    return callProxyRpc<FsAnchorRequest, AnchorStateResponse>('fs_anchor_state', request, options)
}

export async function forcedGcUntil(
    request: ForcedGcUntilRequest,
    options?: NdmProxyRequestOptions,
): Promise<ForcedGcUntilResponse> {
    return callProxyRpc<ForcedGcUntilRequest, ForcedGcUntilResponse>('forced_gc_until', request, options)
}

export async function outboxCount(
    options?: NdmProxyRequestOptions,
): Promise<CountResponse> {
    return callProxyRpc<Record<string, never>, CountResponse>('outbox_count', {}, options)
}

export async function debugDumpExpandState<TResponse = unknown>(
    request: GetObjectRequest,
    options?: NdmProxyRequestOptions,
): Promise<TResponse> {
    return callProxyRpc<GetObjectRequest, TResponse>('debug_dump_expand_state', request, options)
}

export async function anchorState(
    request: UnpinRequest,
    options?: NdmProxyRequestOptions,
): Promise<AnchorStateResponse> {
    return callProxyRpc<UnpinRequest, AnchorStateResponse>('anchor_state', request, options)
}

// ============================================================
// Reader helpers
// ============================================================

export async function openChunkReader(
    request: OpenChunkReaderRequest,
    options?: NdmProxyRequestOptions,
): Promise<NdmProxyReadResult> {
    return postProxyRead('/read/chunk/open', request, options)
}

export async function getChunkData(
    request: ChunkIdRequest,
    options?: NdmProxyRequestOptions,
): Promise<Uint8Array> {
    return readResponseBytes(await postProxyRead('/read/chunk/data', request, options))
}

export async function getChunkPiece(
    request: GetChunkPieceRequest,
    options?: NdmProxyRequestOptions,
): Promise<Uint8Array> {
    return readResponseBytes(await postProxyRead('/read/chunk/piece', request, options))
}

export async function openChunkListReader(
    request: OpenChunkListReaderRequest,
    options?: NdmProxyRequestOptions,
): Promise<NdmProxyReadResult> {
    return postProxyRead('/read/chunklist/open', request, options)
}

export async function openReader(
    request: OpenReaderRequest,
    options?: NdmProxyRequestOptions,
): Promise<NdmProxyReadResult> {
    return postProxyRead('/read/object/open', request, options)
}

// ============================================================
// Writer helpers
// ============================================================

export async function putChunkByReader(
    chunkId: string,
    body: BodyInit,
    options?: PutChunkByReaderOptions,
): Promise<PutChunkResponse> {
    ensureProxyApiSupportedRuntime()

    const endpoint = resolveProxyEndpoint(options)
    const fetcher = options?.fetcher ?? defaultProxyFetcher
    const inferredSize = bodyLength(body)
    const chunkSize = options?.chunkSize ?? inferredSize

    if (chunkSize === null) {
        throw new NdmProxyError(
            'PROXY_API_CHUNK_SIZE_REQUIRED',
            'chunkSize is required when the request body length cannot be inferred',
        )
    }

    const headers = await buildHeaders(options, {
        Accept: 'application/json',
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(chunkSize),
        'NDM-Chunk-Size': String(chunkSize),
    })

    const response = await fetcher(`${endpoint}${chunkWritePath(chunkId)}`, {
        method: 'PUT',
        headers,
        body,
        credentials: options?.credentials ?? 'include',
    })

    if (!response.ok) {
        return parseErrorResponse(response)
    }

    await response.body?.cancel()

    return {
        chunkSize: parseNullableNumberHeader(response.headers, 'NDM-Chunk-Size'),
        outcome: response.headers.get('NDM-Chunk-Write-Outcome') ?? undefined,
        chunkObjectId: response.headers.get('NDM-Chunk-Object-ID') ?? undefined,
    }
}

export async function putChunk(
    chunkId: string,
    data: Uint8Array | ArrayBuffer,
    options?: PutChunkByReaderOptions,
): Promise<PutChunkResponse> {
    return putChunkByReader(chunkId, data, {
        ...options,
        chunkSize: options?.chunkSize ?? data.byteLength,
    })
}
