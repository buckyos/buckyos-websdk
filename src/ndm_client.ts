/**
 * ndm_client - Unified import & upload client for BuckyOS WebSDK.
 *
 * Provides `pickupAndImport` and companion session/upload APIs that hide
 * runtime differences (pure browser, NDM Cache, NDM Store) behind a single
 * provider-based abstraction, plus structured `/ndm/v1/store/*` helpers for
 * trusted runtimes.
 */

import {
    sha256Bytes,
    ChunkId,
    SimpleChunkList,
    FileObject as NdnFileObject,
    DirObject as NdnDirObject,
    ObjId,
    OBJ_TYPE_FILE,
    OBJ_TYPE_DIR,
    SimpleMapItem,
} from './ndn_types'
import {
    getActiveRuntimeType,
    getActiveSessionToken,
    getActiveZoneGatewayOrigin,
} from './sdk_core'
import { RuntimeType } from './runtime'

// ============================================================
// Public types
// ============================================================

export type ImportMode = 'single_file' | 'multi_file' | 'single_dir' | 'mixed'

export type MaterializationStatus = 'ok' | 'on_cache' | 'all_in_store'

export type UploadStatus = 'not_started' | 'uploading' | 'completed' | 'failed' | 'not_required'

// ---- Error codes ----

export type NdmErrorCode =
    | 'USER_CANCELLED'
    | 'MODE_NOT_SUPPORTED_IN_RUNTIME'
    | 'DIRECTORY_NOT_SUPPORTED'
    | 'INVALID_ACCEPT_FILTER'
    | 'SESSION_NOT_FOUND'
    | 'UPLOAD_FAILED'
    | 'THUMBNAIL_GENERATION_FAILED'
    | 'STORE_API_NOT_SUPPORTED_IN_RUNTIME'
    | 'STORE_API_ENDPOINT_REQUIRED'

export class NdmError extends Error {
    public readonly code: NdmErrorCode
    constructor(code: NdmErrorCode, message?: string) {
        super(message ?? code)
        this.code = code
        this.name = 'NdmError'
    }
}

// ---- Thumbnail ----

export interface ThumbnailOptions {
    enabled?: boolean
    forTypes?: string[]
    maxWidth?: number
    maxHeight?: number
    eager?: boolean
}

export interface ThumbnailResult {
    available: boolean
    url?: string
    width?: number
    height?: number
    mimeType?: string
    errorCode?: string
}

// ---- Imported object model ----

export interface BaseImportedObject {
    objectId: string
    name: string
    relativePath?: string
    sourcePath?: string
    locality?: 'local_only' | 'cache' | 'store'
}

export interface ImportedFileObject extends BaseImportedObject {
    kind: 'file'
    size: number
    mimeType?: string
    thumbnail?: ThumbnailResult
    /** The browser File handle, kept for upload. */
    _file?: File
    /** The canonical NDN FileObject JSON used for parent DirObject hashing. */
    _ndnFileObject?: Record<string, unknown>
}

export interface ImportedDirObject extends BaseImportedObject {
    kind: 'dir'
    children?: Array<ImportedFileObject | ImportedDirObject>
}

// ---- Options & results ----

export interface PickupAndImportOptions<TMode extends ImportMode = ImportMode> {
    mode: TMode
    accept?: string[]
    thumbnails?: ThumbnailOptions
    autoStartUpload?: boolean
}

export interface ImportSessionSummary {
    totalObjects: number
    totalFiles: number
    totalDirs: number
    totalBytes: number
}

export interface ImportSessionSnapshot<TSelection> {
    sessionId: string
    selection: TSelection
    items: Array<ImportedFileObject | ImportedDirObject>
    materializationStatus: MaterializationStatus
    uploadStatus: UploadStatus
    summary: ImportSessionSummary
}

export type PickupAndImportResult<TMode extends ImportMode> =
    TMode extends 'single_file' ? ImportSessionSnapshot<ImportedFileObject> :
    TMode extends 'multi_file' ? ImportSessionSnapshot<ImportedFileObject[]> :
    TMode extends 'single_dir' ? ImportSessionSnapshot<ImportedDirObject> :
    ImportSessionSnapshot<Array<ImportedFileObject | ImportedDirObject>>

// ---- Session status ----

export interface PerObjectProgress {
    objectId: string
    uploadedBytes: number
    totalBytes: number
    state: 'pending' | 'uploading' | 'completed' | 'failed'
}

export interface ImportSessionStatus {
    sessionId: string
    materializationStatus: MaterializationStatus
    uploadStatus: UploadStatus
    summary: ImportSessionSummary
    progress: {
        uploadedBytes: number
        uploadedObjects: number
        totalBytes: number
        totalObjects: number
    }
    perObjectProgress?: Record<string, PerObjectProgress>
}

// ---- Upload ----

export interface StartUploadOptions {
    concurrency?: number
    priority?: 'foreground' | 'background'
    /**
     * Override the NDM service base URL for TUS uploads. When omitted the
     * SDK will try to derive it from the zone host; the final TUS endpoint
     * is `${endpoint}/ndm/v1/uploads`.
     */
    endpoint?: string
    extra?: Record<string, unknown>
}

export interface UploadProgress {
    sessionId: string
    uploadStatus: UploadStatus
    totalBytes: number
    uploadedBytes: number
    totalObjects: number
    uploadedObjects: number
    speedBps?: number
    elapsedMs?: number
    estimatedRemainingMs?: number
    perObjectProgress?: Record<string, PerObjectProgress>
}

// ---- Provider abstraction ----

export interface RuntimeCapabilities {
    canRevealRealPath: boolean
    canUseNDMCache: boolean
    canUseNDMStore: boolean
    canPickDirectory: boolean
    canPickMixed: boolean
}

export interface ImportProvider {
    getCapabilities(): RuntimeCapabilities
    pickFiles(options: PickupAndImportOptions): Promise<File[]>
}

export interface NdmStoreRequestOptions {
    /**
     * Base origin for the zone gateway, for example `https://app.zone.example`
     * or `http://host.docker.internal:3180`.
     */
    endpoint?: string
    fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    headers?: Record<string, string>
    credentials?: RequestCredentials
    sessionToken?: string | null
}

export interface NdmLookupRequestOptions extends NdmStoreRequestOptions {}

export interface NdmStoreErrorBody {
    error?: string
    message?: string
    [key: string]: unknown
}

export class NdmStoreApiError extends Error {
    public readonly status: number
    public readonly errorCode?: string
    public readonly responseBody?: unknown

    constructor(status: number, errorCode?: string, message?: string, responseBody?: unknown) {
        super(message ?? `NDM store API request failed with status ${status}`)
        this.name = 'NdmStoreApiError'
        this.status = status
        this.errorCode = errorCode
        this.responseBody = responseBody
    }
}

export interface GetObjectRequest {
    obj_id: string
}

export interface GetObjectResponse {
    obj_id: string
    obj_data: string
}

export interface ObjIdWithInnerPathRequest {
    obj_id: string
    inner_path?: string
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

export type PinScope = 'recursive' | 'skeleton' | 'lease'

export interface EdgeMsg {
    op: 'add' | 'remove'
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

export type NdmLookupScope = 'app' | 'global'

export interface LookupObjectRequest {
    scope: NdmLookupScope
    quick_hash: string
    inner_path?: string
}

export interface LookupObjectExistsResponse {
    object_id: string
    scope: NdmLookupScope
    exists: boolean
}

export type LookupObjectChunkStateResponse =
    | ({ object_id: string; scope: NdmLookupScope } & { state: 'new'; chunk_size: number })
    | ({ object_id: string; scope: NdmLookupScope } & { state: 'completed'; chunk_size: number })
    | ({ object_id: string; scope: NdmLookupScope } & { state: 'disabled'; chunk_size: number })
    | ({ object_id: string; scope: NdmLookupScope } & { state: 'not_exist'; chunk_size: number })
    | ({
        object_id: string
        scope: NdmLookupScope
        state: 'local_link'
        chunk_size: number
        local_info: ChunkStateLocalInfo
    })
    | ({
        object_id: string
        scope: NdmLookupScope
        state: 'same_as'
        chunk_size: number
        same_as: string
    })

export type LookupObjectResponse = LookupObjectExistsResponse | LookupObjectChunkStateResponse

// ============================================================
// Default chunk size for splitting files (4 MiB)
// ============================================================

const DEFAULT_CHUNK_SIZE = 32 * 1024 * 1024
const QCID_HASH_PIECE_SIZE = 4096
const MIN_QCID_FILE_SIZE = QCID_HASH_PIECE_SIZE * 3

// ============================================================
// Internal session storage
// ============================================================

interface ObjectUploadState {
    objectId: string
    name: string
    size: number
    file: File
    uploadedBytes: number
    state: 'pending' | 'uploading' | 'completed' | 'failed'
    /** Chunks that need to be uploaded for this file. */
    chunks: Array<{
        chunkId: string
        offset: number
        length: number
        uploaded: boolean
    }>
}

interface ImportSession {
    sessionId: string
    items: Array<ImportedFileObject | ImportedDirObject>
    materializationStatus: MaterializationStatus
    uploadStatus: UploadStatus
    summary: ImportSessionSummary
    objectStates: Map<string, ObjectUploadState>
    uploadStartTime?: number
    /** Abort controller for cancelling in-flight uploads. */
    abortController?: AbortController
}

const sessionRegistry = new Map<string, ImportSession>()

let sessionCounter = 0
function generateSessionId(): string {
    sessionCounter += 1
    return `import-${Date.now()}-${sessionCounter}`
}

// ============================================================
// Browser-basic provider
// ============================================================

const browserProvider: ImportProvider = {
    getCapabilities(): RuntimeCapabilities {
        return {
            canRevealRealPath: false,
            canUseNDMCache: false,
            canUseNDMStore: false,
            canPickDirectory: typeof HTMLInputElement !== 'undefined' && 'webkitdirectory' in HTMLInputElement.prototype,
            canPickMixed: false,
        }
    },

    pickFiles(options: PickupAndImportOptions): Promise<File[]> {
        return new Promise<File[]>((resolve, reject) => {
            const input = document.createElement('input')
            input.type = 'file'

            if (options.mode === 'single_dir') {
                if (!this.getCapabilities().canPickDirectory) {
                    reject(new NdmError('DIRECTORY_NOT_SUPPORTED', 'This browser does not support directory selection'))
                    return
                }
                (input as any).webkitdirectory = true
            } else if (options.mode === 'multi_file' || options.mode === 'mixed') {
                input.multiple = true
            }

            if (options.accept && options.accept.length > 0 && options.mode !== 'single_dir') {
                input.accept = options.accept.join(',')
            }

            let settled = false

            input.addEventListener('change', () => {
                if (settled) return
                settled = true
                const files = input.files
                if (!files || files.length === 0) {
                    reject(new NdmError('USER_CANCELLED', 'No files selected'))
                    return
                }
                resolve(Array.from(files))
            })

            // Detect cancel: when user focuses back on window without selecting
            const onFocus = () => {
                setTimeout(() => {
                    if (!settled) {
                        settled = true
                        reject(new NdmError('USER_CANCELLED', 'User cancelled file selection'))
                    }
                    window.removeEventListener('focus', onFocus)
                }, 500)
            }
            window.addEventListener('focus', onFocus)

            input.click()
        })
    },
}

// Allow custom provider injection
let currentProvider: ImportProvider = browserProvider

export function setImportProvider(provider: ImportProvider): void {
    currentProvider = provider
}

export function getImportProvider(): ImportProvider {
    return currentProvider
}

function defaultStoreFetcher(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
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

function isChunkQuickHash(quickHash: string): boolean {
    try {
        return ObjId.fromString(quickHash).isChunk()
    } catch {
        return false
    }
}

function encodeLookupQueryValue(value: string): string {
    // The current gateway query parser is still in debug mode and does not
    // URL-decode values, so keep the colon literal for ids like `qcid:...`.
    return encodeURIComponent(value).replace(/%3A/gi, ':')
}

function ensureStoreApiSupportedRuntime(): void {
    if (getActiveRuntimeType() === RuntimeType.Browser) {
        throw new NdmError(
            'STORE_API_NOT_SUPPORTED_IN_RUNTIME',
            'NDM structured store APIs are not available in pure Browser runtime',
        )
    }
}

function resolveStoreEndpoint(options?: NdmStoreRequestOptions): string {
    if (options?.endpoint) {
        return normalizeEndpoint(options.endpoint)
    }

    const activeOrigin = getActiveZoneGatewayOrigin()
    if (activeOrigin) {
        return normalizeEndpoint(activeOrigin)
    }

    throw new NdmError(
        'STORE_API_ENDPOINT_REQUIRED',
        'NDM structured store endpoint is unknown; pass options.endpoint or call initBuckyOS first',
    )
}

async function callStoreApi<TRequest, TResponse>(
    methodName: string,
    requestBody: TRequest,
    options?: NdmStoreRequestOptions,
): Promise<TResponse> {
    ensureStoreApiSupportedRuntime()

    const endpoint = resolveStoreEndpoint(options)
    const fetcher = options?.fetcher ?? defaultStoreFetcher
    const sessionToken = options?.sessionToken !== undefined
        ? options.sessionToken
        : await getActiveSessionToken()

    const headers: Record<string, string> = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(options?.headers ?? {}),
    }

    if (sessionToken && !headers.Authorization) {
        headers.Authorization = `Bearer ${sessionToken}`
    }

    const response = await fetcher(`${endpoint}/ndm/v1/store/${methodName}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        credentials: options?.credentials ?? 'include',
    })

    if (response.status === 204) {
        await response.body?.cancel()
        return undefined as TResponse
    }

    const contentType = response.headers.get('content-type') ?? ''
    const isJsonResponse = contentType.includes('application/json')
    const responseBody = isJsonResponse
        ? await response.json() as unknown
        : await response.text()

    if (!response.ok) {
        const errorBody = responseBody && typeof responseBody === 'object' && !Array.isArray(responseBody)
            ? responseBody as NdmStoreErrorBody
            : null
        throw new NdmStoreApiError(
            response.status,
            errorBody?.error,
            errorBody?.message ?? (typeof responseBody === 'string' && responseBody.length > 0
                ? responseBody
                : `NDM store API request failed with status ${response.status}`),
            responseBody,
        )
    }

    return responseBody as TResponse
}

async function getZoneGatewayJson<TResponse>(
    pathWithQuery: string,
    options?: NdmStoreRequestOptions,
): Promise<TResponse> {
    const endpoint = resolveStoreEndpoint(options)
    const fetcher = options?.fetcher ?? defaultStoreFetcher
    const sessionToken = options?.sessionToken !== undefined
        ? options.sessionToken
        : await getActiveSessionToken()

    const headers: Record<string, string> = {
        Accept: 'application/json',
        ...(options?.headers ?? {}),
    }

    if (sessionToken && !headers.Authorization) {
        headers.Authorization = `Bearer ${sessionToken}`
    }

    const response = await fetcher(`${endpoint}${pathWithQuery}`, {
        method: 'GET',
        headers,
        credentials: options?.credentials ?? 'include',
    })

    const contentType = response.headers.get('content-type') ?? ''
    const isJsonResponse = contentType.includes('application/json')
    const responseBody = isJsonResponse
        ? await response.json() as unknown
        : await response.text()

    if (!response.ok) {
        const errorBody = responseBody && typeof responseBody === 'object' && !Array.isArray(responseBody)
            ? responseBody as NdmStoreErrorBody
            : null
        throw new NdmStoreApiError(
            response.status,
            errorBody?.error,
            errorBody?.message ?? (typeof responseBody === 'string' && responseBody.length > 0
                ? responseBody
                : `NDM zone gateway request failed with status ${response.status}`),
            responseBody,
        )
    }

    return responseBody as TResponse
}

export async function lookupObject(
    request: LookupObjectRequest,
    options?: NdmLookupRequestOptions,
): Promise<LookupObjectResponse> {
    const query: string[] = [
        `scope=${encodeLookupQueryValue(request.scope)}`,
        `quick_hash=${encodeLookupQueryValue(request.quick_hash)}`,
    ]

    if (request.inner_path) {
        query.push(`inner_path=${encodeLookupQueryValue(request.inner_path)}`)
    }

    const response = await getZoneGatewayJson<LookupObjectResponse>(
        `/ndm/v1/objects/lookup?${query.join('&')}`,
        options,
    )

    if (isChunkQuickHash(request.quick_hash)) {
        return response as LookupObjectChunkStateResponse
    }

    return response as LookupObjectExistsResponse
}

export async function getObject(
    request: GetObjectRequest,
    options?: NdmStoreRequestOptions,
): Promise<GetObjectResponse> {
    return callStoreApi<GetObjectRequest, GetObjectResponse>('get_object', request, options)
}

export async function openObject(
    request: ObjIdWithInnerPathRequest,
    options?: NdmStoreRequestOptions,
): Promise<OpenObjectResponse> {
    return callStoreApi<ObjIdWithInnerPathRequest, OpenObjectResponse>('open_object', request, options)
}

export async function getDirChild(
    request: GetDirChildRequest,
    options?: NdmStoreRequestOptions,
): Promise<GetDirChildResponse> {
    return callStoreApi<GetDirChildRequest, GetDirChildResponse>('get_dir_child', request, options)
}

export async function isObjectStored(
    request: ObjIdWithInnerPathRequest,
    options?: NdmStoreRequestOptions,
): Promise<IsObjectStoredResponse> {
    return callStoreApi<ObjIdWithInnerPathRequest, IsObjectStoredResponse>('is_object_stored', request, options)
}

export async function isObjectExist(
    request: GetObjectRequest,
    options?: NdmStoreRequestOptions,
): Promise<IsObjectExistResponse> {
    return callStoreApi<GetObjectRequest, IsObjectExistResponse>('is_object_exist', request, options)
}

export async function queryObjectById(
    request: GetObjectRequest,
    options?: NdmStoreRequestOptions,
): Promise<QueryObjectByIdResponse> {
    return callStoreApi<GetObjectRequest, QueryObjectByIdResponse>('query_object_by_id', request, options)
}

export async function putObject(
    request: PutObjectRequest,
    options?: NdmStoreRequestOptions,
): Promise<void> {
    return callStoreApi<PutObjectRequest, void>('put_object', request, options)
}

export async function removeObject(
    request: GetObjectRequest,
    options?: NdmStoreRequestOptions,
): Promise<void> {
    return callStoreApi<GetObjectRequest, void>('remove_object', request, options)
}

export async function haveChunk(
    request: ChunkIdRequest,
    options?: NdmStoreRequestOptions,
): Promise<HaveChunkResponse> {
    return callStoreApi<ChunkIdRequest, HaveChunkResponse>('have_chunk', request, options)
}

export async function queryChunkState(
    request: ChunkIdRequest,
    options?: NdmStoreRequestOptions,
): Promise<QueryChunkStateResponse> {
    return callStoreApi<ChunkIdRequest, QueryChunkStateResponse>('query_chunk_state', request, options)
}

export async function removeChunk(
    request: ChunkIdRequest,
    options?: NdmStoreRequestOptions,
): Promise<void> {
    return callStoreApi<ChunkIdRequest, void>('remove_chunk', request, options)
}

export async function addChunkBySameAs(
    request: AddChunkBySameAsRequest,
    options?: NdmStoreRequestOptions,
): Promise<void> {
    return callStoreApi<AddChunkBySameAsRequest, void>('add_chunk_by_same_as', request, options)
}

export async function applyEdge(
    request: EdgeMsg,
    options?: NdmStoreRequestOptions,
): Promise<void> {
    return callStoreApi<EdgeMsg, void>('apply_edge', request, options)
}

export async function pin(
    request: PinRequest,
    options?: NdmStoreRequestOptions,
): Promise<void> {
    return callStoreApi<PinRequest, void>('pin', request, options)
}

export async function unpin(
    request: UnpinRequest,
    options?: NdmStoreRequestOptions,
): Promise<void> {
    return callStoreApi<UnpinRequest, void>('unpin', request, options)
}

export async function unpinOwner(
    request: OwnerRequest,
    options?: NdmStoreRequestOptions,
): Promise<CountResponse> {
    return callStoreApi<OwnerRequest, CountResponse>('unpin_owner', request, options)
}

export async function fsAcquire(
    request: FsAnchorRequest,
    options?: NdmStoreRequestOptions,
): Promise<void> {
    return callStoreApi<FsAnchorRequest, void>('fs_acquire', request, options)
}

export async function fsRelease(
    request: FsAnchorRequest,
    options?: NdmStoreRequestOptions,
): Promise<void> {
    return callStoreApi<FsAnchorRequest, void>('fs_release', request, options)
}

export async function fsReleaseInode(
    request: InodeRequest,
    options?: NdmStoreRequestOptions,
): Promise<CountResponse> {
    return callStoreApi<InodeRequest, CountResponse>('fs_release_inode', request, options)
}

export async function fsAnchorState(
    request: FsAnchorRequest,
    options?: NdmStoreRequestOptions,
): Promise<AnchorStateResponse> {
    return callStoreApi<FsAnchorRequest, AnchorStateResponse>('fs_anchor_state', request, options)
}

export async function forcedGcUntil(
    request: ForcedGcUntilRequest,
    options?: NdmStoreRequestOptions,
): Promise<ForcedGcUntilResponse> {
    return callStoreApi<ForcedGcUntilRequest, ForcedGcUntilResponse>('forced_gc_until', request, options)
}

export async function outboxCount(
    options?: NdmStoreRequestOptions,
): Promise<CountResponse> {
    return callStoreApi<Record<string, never>, CountResponse>('outbox_count', {}, options)
}

export async function debugDumpExpandState<TResponse = unknown>(
    request: GetObjectRequest,
    options?: NdmStoreRequestOptions,
): Promise<TResponse> {
    return callStoreApi<GetObjectRequest, TResponse>('debug_dump_expand_state', request, options)
}

export async function anchorState(
    request: UnpinRequest,
    options?: NdmStoreRequestOptions,
): Promise<AnchorStateResponse> {
    return callStoreApi<UnpinRequest, AnchorStateResponse>('anchor_state', request, options)
}

// ============================================================
// Object materialization helpers
// ============================================================

/**
 * Read a File into an ArrayBuffer, compute SHA-256, and produce an objectId.
 * For large files, the file is split into chunks and a ChunkList object is built.
 */
async function materializeFile(
    file: File,
    chunkSize: number = DEFAULT_CHUNK_SIZE,
): Promise<{ objectId: string; chunks: ObjectUploadState['chunks']; fileObject: Record<string, unknown> }> {
    const fileSize = file.size
    const chunks: ObjectUploadState['chunks'] = []

    if (fileSize <= chunkSize) {
        // Single-chunk file
        const buf = new Uint8Array(await file.arrayBuffer())
        const hash = sha256Bytes(buf)
        const chunkId = ChunkId.fromMix256Result(buf.length, hash)
        const chunkIdStr = chunkId.toString()

        chunks.push({ chunkId: chunkIdStr, offset: 0, length: buf.length, uploaded: false })

        // Build a FileObject to derive the objectId
        const fileObj = new NdnFileObject(file.name, fileSize, chunkIdStr)
        const [objId] = fileObj.genObjId()
        return { objectId: objId.toString(), chunks, fileObject: fileObj.toJSON() }
    }

    // Multi-chunk: split file, hash each chunk, build ChunkList
    const chunkList = new SimpleChunkList()
    let offset = 0
    while (offset < fileSize) {
        const end = Math.min(offset + chunkSize, fileSize)
        const slice = new Uint8Array(await file.slice(offset, end).arrayBuffer())
        const hash = sha256Bytes(slice)
        const chunkId = ChunkId.fromMix256Result(slice.length, hash)
        chunkList.appendChunk(chunkId)
        chunks.push({ chunkId: chunkId.toString(), offset, length: slice.length, uploaded: false })
        offset = end
    }

    const [chunkListObjId] = chunkList.genObjId()
    const fileObj = new NdnFileObject(file.name, fileSize, chunkListObjId.toString())
    const [objId] = fileObj.genObjId()
    return { objectId: objId.toString(), chunks, fileObject: fileObj.toJSON() }
}

function buildFileObjectFromContentId(
    name: string,
    size: number,
    contentId: string,
): { objectId: string; fileObject: Record<string, unknown> } {
    const fileObj = new NdnFileObject(name, size, contentId)
    const [objId] = fileObj.genObjId()
    return {
        objectId: objId.toString(),
        fileObject: fileObj.toJSON(),
    }
}

function resolveImportLookupEndpoint(): string | undefined {
    const activeOrigin = getActiveZoneGatewayOrigin()
    if (activeOrigin) {
        return normalizeEndpoint(activeOrigin)
    }

    if (typeof window !== 'undefined' && window.location?.origin) {
        return normalizeEndpoint(window.location.origin)
    }

    return undefined
}

async function tryCalculateQcidFromFile(file: File): Promise<string | null> {
    const fileSize = file.size
    if (fileSize < MIN_QCID_FILE_SIZE) {
        return null
    }

    const beginBytes = new Uint8Array(await file.slice(0, QCID_HASH_PIECE_SIZE).arrayBuffer())
    const midOffset = Math.floor(fileSize / 2)
    const midBytes = new Uint8Array(
        await file.slice(midOffset, midOffset + QCID_HASH_PIECE_SIZE).arrayBuffer(),
    )

    const combined = new Uint8Array(beginBytes.length + midBytes.length)
    combined.set(beginBytes, 0)
    combined.set(midBytes, beginBytes.length)

    const hash = sha256Bytes(combined)
    return ChunkId.fromMixHashResult(fileSize, hash, 'qcid').toString()
}

/**
 * Calculate a QCID for a File using the same quick-hash rule as ndn-lib:
 * SHA-256(first 4096 bytes + middle 4096 bytes), encoded as ChunkType `qcid`.
 */
export async function calculateQcidFromFile(file: File): Promise<string> {
    const qcid = await tryCalculateQcidFromFile(file)
    if (!qcid) {
        throw new Error(`QCID requires file size >= ${MIN_QCID_FILE_SIZE} bytes`)
    }
    return qcid
}

function extractLookupContentId(
    response: LookupObjectResponse,
    quickHash: string,
): string | undefined {
    const body = response as LookupObjectResponse & Record<string, unknown>

    if (typeof body.same_as === 'string' && body.same_as.length > 0) {
        return body.same_as
    }

    const directContentKeys = [
        'chunk_list_id',
        'chunklistid',
        'chunk_id',
        'chunkid',
        'content_id',
        'content',
    ]
    for (const key of directContentKeys) {
        const value = body[key]
        if (typeof value === 'string' && value.length > 0) {
            return value
        }
    }

    if (typeof body.object_id === 'string' && body.object_id.length > 0 && body.object_id !== quickHash) {
        return body.object_id
    }

    return undefined
}

async function lookupFileByQcid(
    file: File,
): Promise<{ objectId: string; fileObject: Record<string, unknown>; locality: 'store' } | null> {
    const endpoint = resolveImportLookupEndpoint()
    if (!endpoint) {
        return null
    }

    const qcid = await tryCalculateQcidFromFile(file)
    if (!qcid) {
        return null
    }

    for (const scope of ['app', 'global'] as const) {
        try {
            const response = await lookupObject(
                { scope, quick_hash: qcid },
                {
                    endpoint,
                    sessionToken: getActiveRuntimeType() === RuntimeType.Browser ? null : undefined,
                },
            )

            const contentId = extractLookupContentId(response, qcid)
            if (!contentId) {
                continue
            }

            return {
                ...buildFileObjectFromContentId(file.name, file.size, contentId),
                locality: 'store',
            }
        } catch (error) {
            if (error instanceof NdmStoreApiError && error.status === 404) {
                continue
            }

            // QCID lookup is an optimization. Fall back to local materialization
            // when the gateway is unavailable or returns an incompatible shape.
            return null
        }
    }

    return null
}

/**
 * Build directory tree from flat file list (for webkitdirectory results).
 */
function buildDirTree(
    files: File[],
    fileObjects: ImportedFileObject[],
): ImportedDirObject {
    // Determine the common root directory name
    const firstPath = (files[0] as any).webkitRelativePath as string | undefined
    const rootName = firstPath ? firstPath.split('/')[0] : 'directory'

    const root: ImportedDirObject = {
        kind: 'dir',
        objectId: '', // will be computed later
        name: rootName,
        children: [],
    }

    const dirMap = new Map<string, ImportedDirObject>()
    dirMap.set('', root)

    for (const fileObj of fileObjects) {
        const relPath = fileObj.relativePath ?? fileObj.name
        const parts = relPath.split('/')
        // Skip the root dir name itself
        const pathParts = parts.length > 1 ? parts.slice(1) : parts

        // Ensure intermediate directories exist
        let currentDir = root
        for (let i = 0; i < pathParts.length - 1; i++) {
            const dirName = pathParts[i]
            const dirPath = pathParts.slice(0, i + 1).join('/')
            let dir = dirMap.get(dirPath)
            if (!dir) {
                dir = {
                    kind: 'dir',
                    objectId: '',
                    name: dirName,
                    relativePath: dirPath,
                    children: [],
                }
                dirMap.set(dirPath, dir)
                currentDir.children!.push(dir)
            }
            currentDir = dir
        }
        currentDir.children!.push(fileObj)
    }

    // Compute directory objectIds bottom-up
    computeDirObjectIds(root)

    return root
}

interface ComputedDirState {
    objectId: string
    totalSize: number
    fileCount: number
    fileSize: number
}

function computeDirObjectIds(dir: ImportedDirObject): ComputedDirState {
    const ndnDir = new NdnDirObject(dir.name)

    if (dir.children) {
        for (const child of dir.children) {
            if (child.kind === 'file') {
                if (!child._ndnFileObject) {
                    throw new NdmError('UPLOAD_FAILED', `Missing NDN FileObject for ${child.name}`)
                }
                ndnDir.addFile(child.name, child._ndnFileObject, child.size)
            } else {
                const childState = computeDirObjectIds(child)
                ndnDir.addDirectory(child.name, ObjId.fromString(childState.objectId), childState.totalSize)
            }
        }
    }

    const [objId] = ndnDir.genObjId()
    dir.objectId = objId.toString()
    return {
        objectId: dir.objectId,
        totalSize: ndnDir.total_size,
        fileCount: ndnDir.file_count,
        fileSize: ndnDir.file_size,
    }
}

// ============================================================
// Thumbnail generation (browser)
// ============================================================

function shouldGenerateThumbnail(file: File, options?: ThumbnailOptions): boolean {
    if (!options || !options.enabled) return false
    if (!options.forTypes || options.forTypes.length === 0) {
        // Default: only images
        return file.type.startsWith('image/')
    }
    for (const filter of options.forTypes) {
        if (filter.endsWith('/*')) {
            const prefix = filter.slice(0, -1)
            if (file.type.startsWith(prefix)) return true
        } else if (filter.startsWith('.')) {
            if (file.name.toLowerCase().endsWith(filter.toLowerCase())) return true
        } else {
            if (file.type === filter) return true
        }
    }
    return false
}

async function generateThumbnail(
    file: File,
    options: ThumbnailOptions,
): Promise<ThumbnailResult> {
    const maxWidth = options.maxWidth ?? 256
    const maxHeight = options.maxHeight ?? 256

    try {
        if (file.type.startsWith('image/')) {
            return await generateImageThumbnail(file, maxWidth, maxHeight)
        }
        // For video/pdf etc., could add more handlers in the future
        return { available: false, errorCode: 'UNSUPPORTED_TYPE' }
    } catch {
        return { available: false, errorCode: 'THUMBNAIL_GENERATION_FAILED' }
    }
}

function generateImageThumbnail(
    file: File,
    maxWidth: number,
    maxHeight: number,
): Promise<ThumbnailResult> {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(file)
        const img = new Image()
        img.onload = () => {
            let w = img.naturalWidth
            let h = img.naturalHeight
            if (w > maxWidth || h > maxHeight) {
                const scale = Math.min(maxWidth / w, maxHeight / h)
                w = Math.round(w * scale)
                h = Math.round(h * scale)
            }
            const canvas = document.createElement('canvas')
            canvas.width = w
            canvas.height = h
            const ctx = canvas.getContext('2d')!
            ctx.drawImage(img, 0, 0, w, h)
            const thumbUrl = canvas.toDataURL('image/jpeg', 0.8)
            URL.revokeObjectURL(url)
            resolve({ available: true, url: thumbUrl, width: w, height: h, mimeType: 'image/jpeg' })
        }
        img.onerror = () => {
            URL.revokeObjectURL(url)
            resolve({ available: false, errorCode: 'THUMBNAIL_GENERATION_FAILED' })
        }
        img.src = url
    })
}

// ============================================================
// Collect summary helpers
// ============================================================

function collectSummary(items: Array<ImportedFileObject | ImportedDirObject>): ImportSessionSummary {
    let totalFiles = 0
    let totalDirs = 0
    let totalBytes = 0

    function walk(list: Array<ImportedFileObject | ImportedDirObject>) {
        for (const item of list) {
            if (item.kind === 'file') {
                totalFiles++
                totalBytes += item.size
            } else {
                totalDirs++
                if (item.children) walk(item.children)
            }
        }
    }
    walk(items)

    return { totalObjects: totalFiles + totalDirs, totalFiles, totalDirs, totalBytes }
}

// ============================================================
// Public API
// ============================================================

/**
 * Initiate a user file/directory selection and materialize the chosen items
 * into NDN objects. Returns a session snapshot with objectIds ready to use.
 */
export async function pickupAndImport<TMode extends ImportMode>(
    options: PickupAndImportOptions<TMode>,
): Promise<PickupAndImportResult<TMode>> {
    const caps = currentProvider.getCapabilities()

    // Validate mode against runtime capabilities
    if (options.mode === 'single_dir' && !caps.canPickDirectory) {
        throw new NdmError('DIRECTORY_NOT_SUPPORTED', 'Current runtime does not support directory selection')
    }
    if (options.mode === 'mixed' && !caps.canPickMixed) {
        throw new NdmError('MODE_NOT_SUPPORTED_IN_RUNTIME', 'Current runtime does not support mixed file/directory selection')
    }

    // Pick files via provider
    const files = await currentProvider.pickFiles(options)
    if (files.length === 0) {
        throw new NdmError('USER_CANCELLED', 'No files selected')
    }

    // Materialize each file
    const fileObjects: ImportedFileObject[] = []
    const objectStates = new Map<string, ObjectUploadState>()
    let allFilesAlreadyStored = true

    for (const file of files) {
        const relativePath = (file as any).webkitRelativePath || undefined
        const lookupHit = await lookupFileByQcid(file)
        const materialized = lookupHit ? null : await materializeFile(file)
        const objectId = lookupHit?.objectId ?? materialized!.objectId
        const fileObject = lookupHit?.fileObject ?? materialized!.fileObject
        const chunks = lookupHit ? [] : materialized!.chunks

        const imported: ImportedFileObject = {
            kind: 'file',
            objectId,
            name: file.name,
            size: file.size,
            mimeType: file.type || undefined,
            relativePath,
            locality: lookupHit?.locality ?? 'local_only',
            _file: file,
            _ndnFileObject: fileObject,
        }

        // Thumbnail
        if (shouldGenerateThumbnail(file, options.thumbnails)) {
            const eager = options.thumbnails?.eager !== false
            if (eager) {
                imported.thumbnail = await generateThumbnail(file, options.thumbnails!)
            } else {
                // Lazy: mark as pending, generate in background
                imported.thumbnail = { available: false }
                generateThumbnail(file, options.thumbnails!).then((result) => {
                    imported.thumbnail = result
                })
            }
        }

        fileObjects.push(imported)

        if (!lookupHit) {
            allFilesAlreadyStored = false
        }

        objectStates.set(objectId, {
            objectId,
            name: file.name,
            size: file.size,
            file,
            uploadedBytes: lookupHit ? file.size : 0,
            state: lookupHit ? 'completed' : 'pending',
            chunks,
        })
    }

    // Build result items and selection based on mode
    let items: Array<ImportedFileObject | ImportedDirObject>
    let selection: unknown

    if (options.mode === 'single_dir') {
        const dirObj = buildDirTree(files, fileObjects)
        items = [dirObj]
        selection = dirObj
    } else {
        items = fileObjects
        if (options.mode === 'single_file') {
            selection = fileObjects[0]
        } else {
            selection = fileObjects
        }
    }

    const summary = collectSummary(items)
    const sessionId = generateSessionId()

    // Determine initial materialization status
    let materializationStatus: MaterializationStatus = 'ok'
    if (allFilesAlreadyStored || caps.canUseNDMStore) {
        materializationStatus = 'all_in_store'
    } else if (caps.canUseNDMCache) {
        materializationStatus = 'on_cache'
    }

    const uploadStatus: UploadStatus =
        materializationStatus === 'all_in_store' ? 'not_required' : 'not_started'

    const session: ImportSession = {
        sessionId,
        items,
        materializationStatus,
        uploadStatus,
        summary,
        objectStates,
    }

    sessionRegistry.set(sessionId, session)

    const snapshot: ImportSessionSnapshot<unknown> = {
        sessionId,
        selection,
        items,
        materializationStatus,
        uploadStatus,
        summary,
    }

    // Auto-start upload if requested
    if (options.autoStartUpload && uploadStatus === 'not_started') {
        // Fire and forget — the session transitions to 'uploading'
        startUpload(sessionId).catch(() => { /* session state already tracks failure */ })
        snapshot.uploadStatus = 'uploading'
    }

    return snapshot as PickupAndImportResult<TMode>
}

/**
 * Query the current status of an import session.
 */
export async function getImportSessionStatus(sessionId: string): Promise<ImportSessionStatus> {
    const session = sessionRegistry.get(sessionId)
    if (!session) {
        throw new NdmError('SESSION_NOT_FOUND', `Session ${sessionId} not found`)
    }

    const perObjectProgress: Record<string, PerObjectProgress> = {}
    let uploadedBytes = 0
    let uploadedObjects = 0

    for (const [id, state] of session.objectStates) {
        perObjectProgress[id] = {
            objectId: state.objectId,
            uploadedBytes: state.uploadedBytes,
            totalBytes: state.size,
            state: state.state,
        }
        uploadedBytes += state.uploadedBytes
        if (state.state === 'completed') uploadedObjects++
    }

    return {
        sessionId,
        materializationStatus: session.materializationStatus,
        uploadStatus: session.uploadStatus,
        summary: session.summary,
        progress: {
            uploadedBytes,
            uploadedObjects,
            totalBytes: session.summary.totalBytes,
            totalObjects: session.summary.totalFiles,
        },
        perObjectProgress,
    }
}

/**
 * Query upload progress for an import session (focused view for progress bars).
 */
export async function getUploadProgress(sessionId: string): Promise<UploadProgress> {
    const status = await getImportSessionStatus(sessionId)
    const result: UploadProgress = {
        sessionId,
        uploadStatus: status.uploadStatus,
        totalBytes: status.progress.totalBytes,
        uploadedBytes: status.progress.uploadedBytes,
        totalObjects: status.progress.totalObjects,
        uploadedObjects: status.progress.uploadedObjects,
        perObjectProgress: status.perObjectProgress,
    }

    const session = sessionRegistry.get(sessionId)!
    if (session.uploadStartTime && status.uploadStatus === 'uploading') {
        result.elapsedMs = Date.now() - session.uploadStartTime
        if (result.uploadedBytes > 0 && result.elapsedMs > 0) {
            result.speedBps = Math.round((result.uploadedBytes * 1000) / result.elapsedMs)
            const remaining = result.totalBytes - result.uploadedBytes
            result.estimatedRemainingMs = Math.round((remaining * 1000) / result.speedBps)
        }
    }

    return result
}

// ============================================================
// Upload engine (tus-based)
// ============================================================

/**
 * Upload a single chunk to the NDM zone gateway using the TUS protocol.
 * Loads tus-js-client lazily from a local wrapper so the dependency is still
 * resolved and bundled at build time.
 */
async function uploadChunkViaTus(
    endpoint: string,
    file: File,
    chunkInfo: ObjectUploadState['chunks'][0],
    chunkIndex: number,
    appId: string,
    logicalPath: string,
    fileHash: string,
    onProgress: (uploaded: number) => void,
    signal?: AbortSignal,
): Promise<string> {
    const slice = file.slice(chunkInfo.offset, chunkInfo.offset + chunkInfo.length)
    const chunkData = new Uint8Array(await slice.arrayBuffer())

    // Load a local wrapper so the dependency is resolved and bundled at build
    // time, while the runtime can still lazy-load the chunk on demand.
    let tusModule: typeof import('./internal/tus_client')
    try {
        tusModule = await import('./internal/tus_client')
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new NdmError('UPLOAD_FAILED', `Failed to load tus-js-client: ${message}`)
    }

    return new Promise<string>((resolve, reject) => {
        if (signal?.aborted) { reject(new NdmError('UPLOAD_FAILED', 'Upload aborted')); return }

        const blob = new Blob([chunkData])
        const upload = new tusModule.Upload(blob, {
            endpoint: `${endpoint}/ndm/v1/uploads`,
            chunkSize: chunkData.length,
            retryDelays: [0, 1000, 3000, 5000],
            metadata: {
                app_id: appId,
                logical_path: logicalPath,
                chunk_index: String(chunkIndex),
                chunk_hash: chunkInfo.chunkId,
                file_hash: fileHash,
            },
            onProgress: (bytesUploaded: number) => {
                onProgress(bytesUploaded)
            },
            onSuccess: () => {
                onProgress(chunkData.length)
                resolve(chunkInfo.chunkId)
            },
            onError: (error: Error) => {
                reject(new NdmError('UPLOAD_FAILED', error.message))
            },
        })

        if (signal) {
            signal.addEventListener('abort', () => {
                upload.abort(true)
                reject(new NdmError('UPLOAD_FAILED', 'Upload aborted'))
            })
        }

        upload.start()
    })
}

/**
 * Explicitly start uploading the objects in an import session.
 */
export async function startUpload(
    sessionId: string,
    options?: StartUploadOptions,
): Promise<ImportSessionStatus> {
    const session = sessionRegistry.get(sessionId)
    if (!session) {
        throw new NdmError('SESSION_NOT_FOUND', `Session ${sessionId} not found`)
    }

    // Idempotent: already completed or not required
    if (session.uploadStatus === 'completed' || session.uploadStatus === 'not_required') {
        return getImportSessionStatus(sessionId)
    }

    // Idempotent: already uploading
    if (session.uploadStatus === 'uploading') {
        return getImportSessionStatus(sessionId)
    }

    // all_in_store => no-op success
    if (session.materializationStatus === 'all_in_store') {
        session.uploadStatus = 'not_required'
        return getImportSessionStatus(sessionId)
    }

    session.uploadStatus = 'uploading'
    session.uploadStartTime = Date.now()
    session.abortController = new AbortController()

    const concurrency = options?.concurrency ?? 3

    // Determine the NDM upload base URL.
    // TUS requests go to `${endpoint}/ndm/v1/uploads`, so `endpoint` should
    // be the origin of the zone gateway that routes /ndm/*.
    let endpoint: string
    if (options?.endpoint) {
        endpoint = options.endpoint.replace(/\/+$/, '')
    } else {
        endpoint = typeof window !== 'undefined' ? window.location.origin : ''
    }

    // Start upload in background
    doUpload(session, endpoint, concurrency).catch(() => {
        // Error state is already tracked in session
    })

    return getImportSessionStatus(sessionId)
}

async function doUpload(
    session: ImportSession,
    endpoint: string,
    concurrency: number,
): Promise<void> {
    const states = Array.from(session.objectStates.values())
        .filter((s) => s.state !== 'completed')

    // Simple semaphore for concurrency control
    let running = 0
    let idx = 0
    let hasError = false

    await new Promise<void>((resolve, reject) => {
        function next() {
            if (hasError) return
            if (idx >= states.length && running === 0) {
                // All done
                const allCompleted = Array.from(session.objectStates.values())
                    .every((s) => s.state === 'completed')
                session.uploadStatus = allCompleted ? 'completed' : 'failed'
                resolve()
                return
            }
            while (running < concurrency && idx < states.length) {
                const state = states[idx++]
                running++
                uploadSingleObject(session, endpoint, state)
                    .then(() => {
                        running--
                        next()
                    })
                    .catch(() => {
                        running--
                        if (!hasError) {
                            hasError = true
                            session.uploadStatus = 'failed'
                            reject(new NdmError('UPLOAD_FAILED', `Upload of ${state.name} failed`))
                        }
                    })
            }
        }
        next()
    })
}

async function uploadSingleObject(
    session: ImportSession,
    endpoint: string,
    state: ObjectUploadState,
): Promise<void> {
    state.state = 'uploading'

    for (const [chunkIndex, chunk] of state.chunks.entries()) {
        if (chunk.uploaded) continue

        await uploadChunkViaTus(
            endpoint,
            state.file,
            chunk,
            chunkIndex,
            'default',
            `default/${chunk.chunkId}`,
            state.objectId,
            (uploaded) => {
                // Update byte-level progress
                const prevChunkBytes = state.chunks
                    .filter((c) => c !== chunk && c.uploaded)
                    .reduce((sum, c) => sum + c.length, 0)
                state.uploadedBytes = prevChunkBytes + uploaded
            },
            session.abortController?.signal,
        )

        chunk.uploaded = true
    }

    state.uploadedBytes = state.size
    state.state = 'completed'
}
