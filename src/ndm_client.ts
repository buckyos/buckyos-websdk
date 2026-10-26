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
import { isHashWorkerAvailable, hashFileInWorker } from './internal/hash_worker'

// ============================================================
// Public types
// ============================================================

export type ImportMode = 'single_file' | 'multi_file' | 'single_dir' | 'mixed'

export type MaterializationStatus = 'ok' | 'on_cache' | 'all_in_store'

export type UploadStatus = 'not_started' | 'uploading' | 'completed' | 'failed' | 'not_required' | 'cancelled'

export type ObjectStatus = 'pending' | 'finalizing' | 'ready' | 'failed' | 'cancelled'

export type MaterializationPhase = 'qcid_lookup' | 'materializing' | 'thumbnail'

/**
 * Progress information emitted during the materialization (hashing) phase
 * of `pickupAndImport`.  Web developers can use this to drive progress bars
 * or status text while files are being processed.
 */
export interface MaterializationProgress {
    phase: MaterializationPhase
    /** 0-based index of the file currently being processed. */
    fileIndex: number
    /** Total number of files selected by the user. */
    fileCount: number
    /** Name of the file currently being processed. */
    fileName: string
    /** Bytes hashed so far for the current file (materializing phase only). */
    bytesProcessed?: number
    /** Total bytes of the current file. */
    fileTotalBytes?: number
}

// ---- Error codes ----

export type NdmErrorCode =
    | 'USER_CANCELLED'
    | 'INVALID_IMPORT_PATH'
    | 'IMPORT_PATH_CONFLICT'
    | 'EMPTY_DIRECTORY_UNAVAILABLE'
    | 'OBJECT_NOT_READY'
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
    endpoint?: string
    sessionToken?: string | null
    headers?: Record<string, string>
    fetcher?: NdmStoreRequestOptions['fetcher']
    signal?: AbortSignal
    /** Per-call provider; selected files should use importFiles instead. */
    provider?: ImportProvider
    /**
     * Optional callback invoked during the materialization (hashing) phase.
     * Use this to drive a progress bar while large files are being processed.
     */
    onProgress?: (progress: MaterializationProgress) => void
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
    objectStatus: ObjectStatus
    error?: string
    warnings: string[]
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

/** Where `finalize` bound the single imported root (`StartUploadOptions.bind`). */
export interface UploadBinding {
    bucket_id: string
    key: string
    obj_id: string
    version: number
    etag: string
    created: boolean
}

export interface ImportSessionStatus {
    sessionId: string
    binding?: UploadBinding
    materializationStatus: MaterializationStatus
    uploadStatus: UploadStatus
    objectStatus: ObjectStatus
    error?: string
    warnings: string[]
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
    signal?: AbortSignal
    headers?: Record<string, string>
    fetcher?: NdmStoreRequestOptions['fetcher']
    onProgress?: (progress: UploadProgress) => void
    priority?: 'foreground' | 'background'
    /**
     * Override the NDM service base URL for TUS uploads. When omitted the
     * SDK will try to derive it from the zone host; the final TUS endpoint
     * is `${endpoint}/ndm/v1/uploads`.
     */
    endpoint?: string
    /**
     * Session token sent as `Authorization: Bearer` with every TUS request.
     * Defaults to the active runtime's session (renewed per chunk); `null`
     * sends cookies only.
     */
    sessionToken?: string | null
    /**
     * Bind the imported root (exactly one) into an application object bucket
     * as part of finalize; success means the content is retained by the bucket.
     */
    bind?: {
        bucketId: string
        key: string
        contentType?: string
        metadata?: Record<string, string>
        tags?: Record<string, string>
        expiresAt?: number
        origin?: { author: string; source: string; collected_at: number; proof?: string }
        ifNoneMatch?: string
        ifMatch?: string
    }
    extra?: Record<string, unknown>
}

export interface UploadProgress {
    sessionId: string
    uploadStatus: UploadStatus
    objectStatus: ObjectStatus
    error?: string
    warnings: string[]
    totalBytes: number
    uploadedBytes: number
    /** Actual chunk payload bytes sent; excludes deduplicated logical progress. */
    transmittedBytes: number
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
    signal?: AbortSignal
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
    reusable?: boolean
    object_id: string
    scope: NdmLookupScope
    exists: boolean
}

export type LookupObjectChunkStateResponse =
    | ({ object_id: string; scope: NdmLookupScope; reusable?: boolean } & { state: 'new'; chunk_size: number })
    | ({ object_id: string; scope: NdmLookupScope; reusable?: boolean } & { state: 'completed'; chunk_size: number })
    | ({ object_id: string; scope: NdmLookupScope; reusable?: boolean } & { state: 'disabled'; chunk_size: number })
    | ({ object_id: string; scope: NdmLookupScope; reusable?: boolean } & { state: 'not_exist'; chunk_size: number })
    | ({
        object_id: string
        reusable?: boolean
        scope: NdmLookupScope
        state: 'local_link'
        chunk_size: number
        local_info: ChunkStateLocalInfo
    })
    | ({
        object_id: string
        reusable?: boolean
        scope: NdmLookupScope
        state: 'same_as'
        chunk_size: number
        same_as: string
    })

export type LookupObjectResponse = LookupObjectExistsResponse | LookupObjectChunkStateResponse

// ============================================================
// Default chunk size for splitting files (32 MiB)
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
    objectStatus: ObjectStatus
    error?: string
    warnings: string[]
    manifest: Map<string, PutObjectRequest>
    qcidLinks: Array<{ qcid: string; content_id: string; size: number }>
    requestOptions: NdmStoreRequestOptions
    uploadPromise?: Promise<void>
    transmittedBytes: number
    onProgress?: (progress: UploadProgress) => void
    uploadStartTime?: number
    /** Abort controller for cancelling in-flight uploads. */
    abortController?: AbortController
    bind?: StartUploadOptions['bind']
    binding?: UploadBinding
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
            const cleanup = () => {
                window.removeEventListener('focus', onFocus)
                options.signal?.removeEventListener('abort', onAbort)
            }
            const fail = (error: NdmError) => {
                if (settled) return
                settled = true
                cleanup()
                reject(error)
            }
            const onAbort = () => fail(new NdmError('USER_CANCELLED', 'Import cancelled'))
            const onFocus = () => {
                setTimeout(() => {
                    if (!settled) fail(new NdmError('USER_CANCELLED', 'User cancelled file selection'))
                }, 500)
            }
            input.addEventListener('change', () => {
                if (settled) return
                const files = input.files
                if (!files || files.length === 0) {
                    fail(new NdmError(options.mode === 'single_dir' ? 'EMPTY_DIRECTORY_UNAVAILABLE' : 'USER_CANCELLED', options.mode === 'single_dir' ? 'FileList cannot represent an empty directory; use a directory-tree provider' : 'No files selected'))
                    return
                }
                settled = true
                cleanup()
                resolve(Array.from(files))
            })
            input.addEventListener('cancel', onAbort)
            window.addEventListener('focus', onFocus)
            if (options.signal?.aborted) { onAbort(); return }
            options.signal?.addEventListener('abort', onAbort, { once: true })

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
        signal: options?.signal,
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
        signal: options?.signal,
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
    signal?: AbortSignal,
): Promise<{ objectId: string; chunks: ObjectUploadState['chunks']; fileObject: Record<string, unknown>; objects: PutObjectRequest[] }> {
    throwIfCancelled(signal)
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
        const [objId, objData] = fileObj.genObjId()
        throwIfCancelled(signal)
        return { objectId: objId.toString(), chunks, fileObject: fileObj.toJSON(), objects: [{ obj_id: objId.toString(), obj_data: objData }] }
    }

    // Multi-chunk: split file, hash each chunk, build ChunkList
    const chunkList = new SimpleChunkList()
    let offset = 0
    while (offset < fileSize) {
        throwIfCancelled(signal)
        const end = Math.min(offset + chunkSize, fileSize)
        const slice = new Uint8Array(await file.slice(offset, end).arrayBuffer())
        const hash = sha256Bytes(slice)
        const chunkId = ChunkId.fromMix256Result(slice.length, hash)
        chunkList.appendChunk(chunkId)
        chunks.push({ chunkId: chunkId.toString(), offset, length: slice.length, uploaded: false })
        offset = end
    }

    const [chunkListObjId, chunkListData] = chunkList.genObjId()
    const fileObj = new NdnFileObject(file.name, fileSize, chunkListObjId.toString())
    const [objId, objData] = fileObj.genObjId()
    throwIfCancelled(signal)
    return { objectId: objId.toString(), chunks, fileObject: fileObj.toJSON(), objects: [
        { obj_id: chunkListObjId.toString(), obj_data: chunkListData },
        { obj_id: objId.toString(), obj_data: objData },
    ] }
}

/**
 * Worker-based variant of `materializeFile`.  Offloads file reading and
 * SHA-256 hashing to a Web Worker so the UI thread stays responsive.
 * Falls back to the main-thread implementation when Workers are unavailable.
 */
async function materializeFileViaWorker(
    file: File,
    onHashProgress?: (bytesHashed: number) => void,
    chunkSize: number = DEFAULT_CHUNK_SIZE,
    signal?: AbortSignal,
): Promise<{ objectId: string; chunks: ObjectUploadState['chunks']; fileObject: Record<string, unknown>; objects: PutObjectRequest[] }> {
    if (!isHashWorkerAvailable() || file.size === 0) {
        const result = await materializeFile(file, chunkSize, signal)
        onHashProgress?.(file.size)
        return result
    }

    let hashResults: Awaited<ReturnType<typeof hashFileInWorker>['result']>
    let timer: ReturnType<typeof setTimeout> | undefined
    const worker = hashFileInWorker(file, chunkSize, signal)
    try {
        if (onHashProgress) worker.onProgress(onHashProgress)
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => { worker.cancel(); reject(new Error('hash worker timeout')) }, 5 * 60 * 1000)
        })
        hashResults = await Promise.race([worker.result, timeout])
    } catch {
        throwIfCancelled(signal)
        return materializeFile(file, chunkSize, signal)
    } finally {
        if (timer) clearTimeout(timer)
    }
    throwIfCancelled(signal)
    const fileSize = file.size
    const chunks: ObjectUploadState['chunks'] = []

    if (hashResults.length === 1) {
        // Single-chunk file
        const r = hashResults[0]
        const chunkId = ChunkId.fromMix256Result(r.length, r.hash)
        const chunkIdStr = chunkId.toString()
        chunks.push({ chunkId: chunkIdStr, offset: 0, length: r.length, uploaded: false })

        const fileObj = new NdnFileObject(file.name, fileSize, chunkIdStr)
        const [objId, objData] = fileObj.genObjId()
        throwIfCancelled(signal)
        return { objectId: objId.toString(), chunks, fileObject: fileObj.toJSON(), objects: [{ obj_id: objId.toString(), obj_data: objData }] }
    }

    // Multi-chunk: build ChunkList from worker results
    const chunkList = new SimpleChunkList()
    for (const r of hashResults) {
        const chunkId = ChunkId.fromMix256Result(r.length, r.hash)
        chunkList.appendChunk(chunkId)
        chunks.push({ chunkId: chunkId.toString(), offset: r.offset, length: r.length, uploaded: false })
    }

    const [chunkListObjId, chunkListData] = chunkList.genObjId()
    const fileObj = new NdnFileObject(file.name, fileSize, chunkListObjId.toString())
    const [objId, objData] = fileObj.genObjId()
    throwIfCancelled(signal)
    return { objectId: objId.toString(), chunks, fileObject: fileObj.toJSON(), objects: [
        { obj_id: chunkListObjId.toString(), obj_data: chunkListData },
        { obj_id: objId.toString(), obj_data: objData },
    ] }
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
    // A full read is cheaper for tiny files; reserve early lookup for samples.
    return file.size < MIN_QCID_FILE_SIZE ? null : calculateQcidFromFile(file)
}

/**
 * Canonical ndn-lib QCID: hash the entire file below 12 KiB, otherwise hash
 * three 4096-byte samples at head, centered midpoint, and tail.
 */
export async function calculateQcidFromFile(file: File): Promise<string> {
    const fileSize = file.size
    let sampled: Uint8Array
    if (fileSize < MIN_QCID_FILE_SIZE) {
        sampled = new Uint8Array(await file.arrayBuffer())
    } else {
        sampled = new Uint8Array(QCID_HASH_PIECE_SIZE * 3)
        const offsets = [0, Math.floor((fileSize - QCID_HASH_PIECE_SIZE) / 2), fileSize - QCID_HASH_PIECE_SIZE]
        for (let index = 0; index < offsets.length; index++) {
            sampled.set(new Uint8Array(await file.slice(offsets[index], offsets[index] + QCID_HASH_PIECE_SIZE).arrayBuffer()), index * QCID_HASH_PIECE_SIZE)
        }
    }
    return ChunkId.fromMixHashResult(fileSize, sha256Bytes(sampled), 'qcid').toString()
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
    options: NdmStoreRequestOptions,
    warnings: string[],
): Promise<{ objectId: string; fileObject: Record<string, unknown>; locality: 'store'; qcid: string } | null> {
    const endpoint = options.endpoint ?? resolveImportLookupEndpoint()
    if (!endpoint) return null
    const qcid = await tryCalculateQcidFromFile(file)
    throwIfCancelled(options.signal)
    if (!qcid) return null
    try {
        // Only authenticated, app-scoped hits authorize reuse. Global presence
        // is not an upload grant and must never suppress byte transfer.
        const response = await lookupObject({ scope: 'app', quick_hash: qcid }, { ...options, endpoint })
        if (response.reusable !== true || !('state' in response) || !['completed', 'same_as', 'local_link'].includes(response.state)) return null
        if (response.chunk_size !== file.size) return null
        const contentId = extractLookupContentId(response, qcid)
        if (!contentId || !(ObjId.fromString(contentId).isChunk() || ObjId.fromString(contentId).isChunkList()) || contentId.startsWith('qcid:')) return null
        return { ...buildFileObjectFromContentId(file.name, file.size, contentId), locality: 'store', qcid }
    } catch (error) {
        throwIfCancelled(options.signal)
        if (!(error instanceof NdmStoreApiError && error.status === 404)) {
            warnings.push(`QCID lookup for ${file.name}: ${errorMessage(error)}`)
        }
        return null
    }
}

/**
 * Build directory tree from flat file list (for webkitdirectory results).
 */
export type ImportTreeEntry = { kind: 'file'; file: File } | ImportDirectoryEntry
export interface ImportDirectoryEntry { kind: 'dir'; name: string; children: ImportTreeEntry[] }

function validateName(name: string): void {
    if (!name || name === '.' || name === '..' || /[\\/\x00-\x1f]/.test(name) || /^[a-z]:/i.test(name)) {
        throw new NdmError('INVALID_IMPORT_PATH', `Invalid file or directory name: ${name}`)
    }
}

function validatePath(path: string): string[] {
    const parts = path.split('/')
    parts.forEach(validateName)
    return parts
}

function buildDirTree(files: File[], fileObjects: ImportedFileObject[]): ImportedDirObject {
    if (files.length === 0) throw new NdmError('EMPTY_DIRECTORY_UNAVAILABLE', 'FileList cannot represent an empty directory; use importDirectory with directory nodes')
    const paths = files.map(file => validatePath(file.webkitRelativePath || file.name))
    if (paths.some(parts => parts.length < 2 || parts[0] !== paths[0][0])) {
        throw new NdmError('INVALID_IMPORT_PATH', 'Folder selection must contain one root directory in webkitRelativePath')
    }
    const root: ImportedDirObject = { kind: 'dir', objectId: '', name: paths[0][0], children: [] }
    for (let index = 0; index < paths.length; index++) {
        const parts = paths[index].slice(1)
        let dir = root
        for (let i = 0; i < parts.length; i++) {
            const name = parts[i]
            const existing = dir.children!.find(child => child.name === name)
            if (i === parts.length - 1) {
                if (existing) throw new NdmError('IMPORT_PATH_CONFLICT', `Duplicate file or directory: ${paths[index].join('/')}`)
                if (name !== fileObjects[index].name) throw new NdmError('INVALID_IMPORT_PATH', 'Relative path basename must match File.name')
                dir.children!.push(fileObjects[index])
            } else {
                if (existing?.kind === 'file') throw new NdmError('IMPORT_PATH_CONFLICT', `File used as directory: ${name}`)
                const child = existing as ImportedDirObject | undefined ?? { kind: 'dir' as const, objectId: '', name, relativePath: parts.slice(0, i + 1).join('/'), children: [] }
                if (!existing) dir.children!.push(child)
                dir = child
            }
        }
    }
    return root
}

interface ComputedDirState {
    objectId: string
    totalSize: number
    fileCount: number
    fileSize: number
}

function computeDirObjectIds(dir: ImportedDirObject, manifest: Map<string, PutObjectRequest>): ComputedDirState {
    const ndnDir = new NdnDirObject(dir.name)

    if (dir.children) {
        for (const child of dir.children) {
            if (child.kind === 'file') {
                if (!child._ndnFileObject) {
                    throw new NdmError('UPLOAD_FAILED', `Missing NDN FileObject for ${child.name}`)
                }
                ndnDir.addFile(child.name, child._ndnFileObject, child.size)
            } else {
                const childState = computeDirObjectIds(child, manifest)
                ndnDir.addDirectory(child.name, ObjId.fromString(childState.objectId), childState.totalSize)
            }
        }
    }

    const [objId, objData] = ndnDir.genObjId()
    dir.objectId = objId.toString()
    manifest.set(dir.objectId, { obj_id: dir.objectId, obj_data: objData })
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
    const provider = options.provider ?? currentProvider
    const caps = provider.getCapabilities()
    if (options.mode === 'single_dir' && !caps.canPickDirectory) throw new NdmError('DIRECTORY_NOT_SUPPORTED')
    if (options.mode === 'mixed' && !caps.canPickMixed) throw new NdmError('MODE_NOT_SUPPORTED_IN_RUNTIME')
    throwIfCancelled(options.signal)
    const files = await provider.pickFiles(options)
    return importFiles(files, options)
}

/** Import an already selected FileList without modifying the global picker. */
export async function importFiles<TMode extends ImportMode>(
    selectedFiles: readonly File[],
    options: PickupAndImportOptions<TMode>,
): Promise<PickupAndImportResult<TMode>> {
    return importSelectedFiles(selectedFiles, options)
}

export async function importDirectory(
    tree: ImportDirectoryEntry,
    options: Omit<PickupAndImportOptions<'single_dir'>, 'mode'> = {},
): Promise<PickupAndImportResult<'single_dir'>> {
    return importSelectedFiles([], { ...options, mode: 'single_dir' }, tree)
}

async function importSelectedFiles<TMode extends ImportMode>(
    selectedFiles: readonly File[],
    options: PickupAndImportOptions<TMode>,
    tree?: ImportDirectoryEntry,
): Promise<PickupAndImportResult<TMode>> {
    throwIfCancelled(options.signal)
    const files = [...selectedFiles]
    const treePaths: string[] = []
    if (tree) {
        const walk = (dir: ImportDirectoryEntry, parent: string) => {
            validateName(dir.name)
            const names = new Set<string>()
            for (const child of dir.children) {
                const name = child.kind === 'file' ? child.file.name : child.name
                validateName(name)
                if (names.has(name)) throw new NdmError('IMPORT_PATH_CONFLICT', `Duplicate child: ${parent}/${name}`)
                names.add(name)
                if (child.kind === 'file') { files.push(child.file); treePaths.push(`${parent}/${name}`) }
                else walk(child, `${parent}/${child.name}`)
            }
        }
        walk(tree, tree.name)
    }
    if (!tree && files.length === 0) throw new NdmError(options.mode === 'single_dir' ? 'EMPTY_DIRECTORY_UNAVAILABLE' : 'USER_CANCELLED', options.mode === 'single_dir' ? 'FileList cannot represent empty directories; use importDirectory' : 'No files selected')
    if (options.mode === 'single_file' && files.length !== 1) throw new NdmError('INVALID_IMPORT_PATH', 'single_file requires exactly one file')
    // Validate before any hashing or remote requests.
    files.forEach(file => { validateName(file.name); if (file.webkitRelativePath) validatePath(file.webkitRelativePath) })
    if (!tree && options.mode === 'single_dir') buildDirTree(files, files.map(file => ({ kind: 'file', objectId: '', name: file.name, size: file.size })))
    const warnings: string[] = []
    if (!tree && options.mode === 'single_dir') warnings.push('FileList selections cannot preserve empty directories')
    const manifest = new Map<string, PutObjectRequest>()
    const qcidLinks: ImportSession['qcidLinks'] = []
    const requestOptions: NdmStoreRequestOptions = { endpoint: options.endpoint, sessionToken: options.sessionToken, fetcher: options.fetcher, headers: options.headers, signal: options.signal }

    // Materialize each file
    const fileObjects: ImportedFileObject[] = []
    const objectStates = new Map<string, ObjectUploadState>()
    let allFilesAlreadyStored = true

    const onProgress = options.onProgress
    const fileCount = files.length

    for (let fi = 0; fi < files.length; fi++) {
        const file = files[fi]
        throwIfCancelled(options.signal)
        const relativePath = treePaths[fi] || file.webkitRelativePath || undefined

        // Phase 1: QCID fast-path lookup (skips full hash when server already has the file)
        if (onProgress) {
            onProgress({ phase: 'qcid_lookup', fileIndex: fi, fileCount, fileName: file.name, fileTotalBytes: file.size })
        }
        const lookupHit = await lookupFileByQcid(file, requestOptions, warnings)

        // Phase 2: Full materialization (worker-based when available)
        let materialized: Awaited<ReturnType<typeof materializeFile>> | null = null
        if (!lookupHit) {
            if (onProgress) {
                onProgress({ phase: 'materializing', fileIndex: fi, fileCount, fileName: file.name, bytesProcessed: 0, fileTotalBytes: file.size })
            }
            materialized = await materializeFileViaWorker(
                file,
                onProgress
                    ? (bytesHashed) => {
                        onProgress({ phase: 'materializing', fileIndex: fi, fileCount, fileName: file.name, bytesProcessed: bytesHashed, fileTotalBytes: file.size })
                    }
                    : undefined,
                DEFAULT_CHUNK_SIZE,
                options.signal,
            )
        }

        const objectId = lookupHit?.objectId ?? materialized!.objectId
        const fileObject = lookupHit?.fileObject ?? materialized!.fileObject
        const chunks = lookupHit ? [] : materialized!.chunks
        if (materialized) for (const object of materialized.objects) manifest.set(object.obj_id, object)
        else {
            const [, objData] = new NdnFileObject(file.name, file.size, fileObject.content as string).genObjId()
            manifest.set(objectId, { obj_id: objectId, obj_data: objData })
        }
        const qcid = lookupHit?.qcid ?? await tryCalculateQcidFromFile(file)
        if (qcid) qcidLinks.push({ qcid, content_id: fileObject.content as string, size: file.size })
        throwIfCancelled(options.signal)

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

        // Phase 3: Thumbnail
        if (shouldGenerateThumbnail(file, options.thumbnails)) {
            if (onProgress) {
                onProgress({ phase: 'thumbnail', fileIndex: fi, fileCount, fileName: file.name, fileTotalBytes: file.size })
            }
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
        let index = 0
        const rebuild = (node: ImportDirectoryEntry): ImportedDirObject => ({ kind: 'dir', name: node.name, objectId: '', children: node.children.map(child => child.kind === 'file' ? fileObjects[index++] : rebuild(child)) })
        const dirObj = tree ? rebuild(tree) : buildDirTree(files, fileObjects)
        computeDirObjectIds(dirObj, manifest)
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

    // Runtime capabilities and QCID hits do not prove that named-object
    // metadata (including a renamed FileObject or parent DirObject) exists.
    const materializationStatus: MaterializationStatus = allFilesAlreadyStored ? 'all_in_store' : 'ok'
    const uploadStatus: UploadStatus = 'not_started'

    const session: ImportSession = {
        sessionId,
        items,
        materializationStatus,
        uploadStatus,
        summary,
        objectStates,
        objectStatus: 'pending',
        warnings, manifest, qcidLinks, requestOptions, transmittedBytes: 0,
    }

    sessionRegistry.set(sessionId, session)

    const snapshot: ImportSessionSnapshot<unknown> = {
        sessionId,
        selection,
        items,
        objectStatus: 'pending',
        warnings,
        materializationStatus,
        uploadStatus,
        summary,
    }

    // Auto-start upload if requested
    if (options.autoStartUpload && uploadStatus === 'not_started') {
        // Fire and forget — the session transitions to 'uploading'
        startUpload(sessionId, { endpoint: options.endpoint, sessionToken: options.sessionToken, fetcher: options.fetcher, headers: options.headers, signal: options.signal }).catch(() => { /* session state already tracks failure */ })
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

    const collect = (items: ImportSession['items']) => {
        for (const item of items) {
            if (item.kind === 'dir') { collect(item.children ?? []); continue }
            const state = session.objectStates.get(item.objectId)!
            perObjectProgress[item.objectId] = { objectId: item.objectId, uploadedBytes: state.uploadedBytes, totalBytes: state.size, state: state.state }
            uploadedBytes += state.uploadedBytes
            if (state.state === 'completed') uploadedObjects++
        }
    }
    collect(session.items)

    return {
        sessionId,
        ...(session.binding ? { binding: session.binding } : {}),
        materializationStatus: session.materializationStatus,
        uploadStatus: session.uploadStatus,
        objectStatus: session.objectStatus,
        error: session.error,
        warnings: [...session.warnings],
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
        objectStatus: status.objectStatus,
        error: status.error,
        warnings: status.warnings,
        transmittedBytes: requireSession(sessionId).transmittedBytes,
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
    fileHash: string,
    sessionToken: string | null,
    extraHeaders: Record<string, string> | undefined,
    onProgress: (uploaded: number) => void,
    signal?: AbortSignal,
): Promise<string> {
    const slice = file.slice(chunkInfo.offset, chunkInfo.offset + chunkInfo.length)
    const chunkData = new Uint8Array(await slice.arrayBuffer())
    const logicalPath = chunkInfo.chunkId

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
            ...(typeof XMLHttpRequest === 'undefined' ? { httpStack: tusModule.fetchHttpStack } : {}),
            headers: { ...extraHeaders, ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}) },
            chunkSize: chunkData.length,
            retryDelays: [0, 1000, 3000, 5000],
            storeFingerprintForResuming: false,
            metadata: {
                logical_path: logicalPath,
                file_name: file.name,
                file_size: String(file.size),
                file_hash: fileHash,
                chunk_index: String(chunkIndex),
                chunk_hash: chunkInfo.chunkId,
                mime_type: file.type || 'application/octet-stream',
            },
            onProgress: (bytesUploaded: number) => {
                onProgress(bytesUploaded)
            },
            onSuccess: () => {
                onProgress(chunkData.length)
                signal?.removeEventListener('abort', onAbort)
                resolve(chunkInfo.chunkId)
            },
            onError: (error: Error) => {
                signal?.removeEventListener('abort', onAbort)
                reject(new NdmError('UPLOAD_FAILED', error.message))
            },
        })

        const onAbort = () => {
            void Promise.resolve(upload.abort(true)).catch(() => undefined)
            reject(new NdmError('USER_CANCELLED', 'Upload cancelled'))
        }
        signal?.addEventListener('abort', onAbort, { once: true })

        upload.start()
    })
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
function throwIfCancelled(signal?: AbortSignal): void {
    if (signal?.aborted) throw new NdmError('USER_CANCELLED', 'Import cancelled')
}
function requireSession(sessionId: string): ImportSession {
    const session = sessionRegistry.get(sessionId)
    if (!session) throw new NdmError('SESSION_NOT_FOUND', `Session ${sessionId} not found`)
    return session
}

/** Begin or retry upload. Completion includes canonical metadata and readiness. */
export async function startUpload(sessionId: string, options: StartUploadOptions = {}): Promise<ImportSessionStatus> {
    const session = requireSession(sessionId)
    if (session.objectStatus === 'ready' || session.uploadPromise) return getImportSessionStatus(sessionId)
    const concurrency = options.concurrency ?? 3
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new NdmError('UPLOAD_FAILED', 'concurrency must be a positive integer')
    throwIfCancelled(options.signal)
    session.requestOptions = { ...session.requestOptions, ...Object.fromEntries(Object.entries({ endpoint: options.endpoint, sessionToken: options.sessionToken, fetcher: options.fetcher, headers: options.headers }).filter(([, value]) => value !== undefined)) }
    const endpoint = session.requestOptions.endpoint ?? resolveImportLookupEndpoint()
    if (!endpoint) throw new NdmError('STORE_API_ENDPOINT_REQUIRED', 'Pass endpoint or initialize the SDK before uploading')
    session.requestOptions.endpoint = normalizeEndpoint(endpoint)
    session.abortController = new AbortController()
    const cancel = () => session.abortController?.abort()
    options.signal?.addEventListener('abort', cancel, { once: true })
    session.requestOptions.signal = session.abortController.signal
    session.uploadStatus = 'uploading'
    session.objectStatus = 'pending'
    session.error = undefined
    session.onProgress = options.onProgress
    if (options.bind) {
        if (session.items.length !== 1) throw new NdmError('UPLOAD_FAILED', 'bind needs exactly one imported root')
        session.bind = options.bind
    }
    session.uploadStartTime = Date.now()
    session.uploadPromise = doUpload(session, concurrency).catch(error => {
        session.error = errorMessage(error)
        const cancelled = session.abortController?.signal.aborted
        session.uploadStatus = cancelled ? 'cancelled' : 'failed'
        session.objectStatus = cancelled ? 'cancelled' : 'failed'
        throw error
    }).finally(() => {
        session.uploadPromise = undefined
        options.signal?.removeEventListener('abort', cancel)
        emitProgress(session)
    })
    // startUpload intentionally starts background work; ensureUploaded observes
    // the same promise and propagates registration/readiness failures.
    void session.uploadPromise.catch(() => undefined)
    return getImportSessionStatus(sessionId)
}

export async function ensureUploaded(sessionId: string, options: StartUploadOptions = {}): Promise<ImportSessionStatus> {
    await startUpload(sessionId, options)
    const session = requireSession(sessionId)
    await session.uploadPromise
    if (session.objectStatus !== 'ready') throw new NdmError('OBJECT_NOT_READY', session.error ?? 'Objects are not ready')
    return getImportSessionStatus(sessionId)
}

/** Cancels only this import; shared stored objects are never deleted. */
export function cancelImportSession(sessionId: string): void {
    const session = requireSession(sessionId)
    if (session.objectStatus === 'ready') return
    session.abortController?.abort()
    session.uploadStatus = 'cancelled'
    session.objectStatus = 'cancelled'
}

/** Release local File handles after consuming the result. A refresh requires reselection. */
export function releaseImportSession(sessionId: string): void {
    const session = requireSession(sessionId)
    cancelImportSession(sessionId)
    sessionRegistry.delete(sessionId)
    const release = (items: ImportSession['items']) => items.forEach(item => {
        if (item.kind === 'dir') release(item.children ?? [])
        else { delete item._file; delete item._ndnFileObject }
    })
    release(session.items)
}

function emitProgress(session: ImportSession): void {
    if (session.onProgress && sessionRegistry.has(session.sessionId)) {
        void getUploadProgress(session.sessionId).then(progress => session.onProgress?.(progress)).catch(() => undefined)
    }
}

async function doUpload(session: ImportSession, concurrency: number): Promise<void> {
    const states = [...session.objectStates.values()]
    const chunkTasks = new Map<string, Promise<void>>()
    let index = 0
    let failure: unknown
    const workers = Array.from({ length: Math.min(concurrency, states.length) }, async () => {
        while (index < states.length && !failure) {
            const state = states[index++]
            try {
                throwIfCancelled(session.abortController?.signal)
                if (state.state === 'completed') continue
                state.state = 'uploading'
                for (const [chunkIndex, chunk] of state.chunks.entries()) {
                    throwIfCancelled(session.abortController?.signal)
                    if (chunk.uploaded) continue
                    let task = chunkTasks.get(chunk.chunkId)
                    if (!task) {
                        task = uploadMissingChunk(session, state, chunk, chunkIndex)
                        chunkTasks.set(chunk.chunkId, task)
                    }
                    await task
                    chunk.uploaded = true
                    state.uploadedBytes = state.chunks.filter(c => c.uploaded).reduce((sum, c) => sum + c.length, 0)
                    emitProgress(session)
                }
                state.uploadedBytes = state.size
                state.state = 'completed'
            } catch (error) { state.state = 'failed'; failure = error }
        }
    })
    await Promise.all(workers)
    if (failure) throw failure
    throwIfCancelled(session.abortController?.signal)
    session.objectStatus = 'finalizing'
    emitProgress(session)
    const options = session.requestOptions
    const token = options.sessionToken !== undefined ? options.sessionToken : await getActiveSessionToken()
    const response = await (options.fetcher ?? defaultStoreFetcher)(`${options.endpoint}/ndm/v1/import/finalize`, {
        method: 'POST', credentials: 'include', signal: options.signal,
        headers: { ...options.headers, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
            objects: [...session.manifest.values()],
            roots: session.items.map(item => item.objectId),
            qcid_links: session.qcidLinks,
            ...(session.bind ? { auto_bind: autoBindBody(session.bind) } : {}),
        }),
    })
    const body = await response.json()
    if (!response.ok) throw new NdmStoreApiError(response.status, body.error, body.message ?? 'Object registration failed', body)
    throwIfCancelled(options.signal)
    if (Array.isArray(body.warnings)) session.warnings.push(...body.warnings.map(String))
    if (body.ready !== true || !Array.isArray(body.roots) || session.items.some(item => !body.roots.some((root: { obj_id: string; ready: boolean }) => root.obj_id === item.objectId && root.ready === true))) {
        throw new NdmError('OBJECT_NOT_READY', 'NDM did not confirm all root objects and their dependencies are ready')
    }
    if (session.bind) session.binding = body.binding as UploadBinding
    session.objectStatus = 'ready'
    session.uploadStatus = session.transmittedBytes === 0 ? 'not_required' : 'completed'
    session.materializationStatus = 'all_in_store'
    emitProgress(session)
}

function autoBindBody(bind: NonNullable<StartUploadOptions['bind']>): Record<string, unknown> {
    const body: Record<string, unknown> = { bucket_id: bind.bucketId, key: bind.key }
    if (bind.contentType !== undefined) body.content_type = bind.contentType
    if (bind.metadata !== undefined) body.metadata = bind.metadata
    if (bind.tags !== undefined) body.tags = bind.tags
    if (bind.expiresAt !== undefined) body.expires_at = bind.expiresAt
    if (bind.origin !== undefined) body.origin = bind.origin
    if (bind.ifNoneMatch !== undefined) body.if_none_match = bind.ifNoneMatch
    if (bind.ifMatch !== undefined) body.if_match = bind.ifMatch
    return body
}

async function uploadMissingChunk(session: ImportSession, state: ObjectUploadState, chunk: ObjectUploadState['chunks'][number], chunkIndex: number): Promise<void> {
    try {
        const found = await lookupObject({ scope: 'app', quick_hash: chunk.chunkId }, session.requestOptions)
        if (found.reusable === true && 'state' in found && ['completed', 'same_as', 'local_link'].includes(found.state) && found.chunk_size === chunk.length) return
    } catch (error) {
        throwIfCancelled(session.abortController?.signal)
        if (!(error instanceof NdmStoreApiError && error.status === 404)) session.warnings.push(`Chunk lookup: ${errorMessage(error)}`)
    }
    const token = session.requestOptions.sessionToken !== undefined ? session.requestOptions.sessionToken : await getActiveSessionToken()
    await uploadChunkViaTus(session.requestOptions.endpoint!, state.file, chunk, chunkIndex, state.objectId, token, session.requestOptions.headers,
        uploaded => {
            state.uploadedBytes = state.chunks.filter(c => c.uploaded).reduce((sum, c) => sum + c.length, 0) + uploaded
            emitProgress(session)
        }, session.abortController?.signal)
    session.transmittedBytes += chunk.length
}
