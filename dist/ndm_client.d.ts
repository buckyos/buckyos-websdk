/**
 * ndm_client - Unified import & upload client for BuckyOS WebSDK.
 *
 * Provides `pickupAndImport` and companion session/upload APIs that hide
 * runtime differences (pure browser, NDM Cache, NDM Store) behind a single
 * provider-based abstraction, plus structured `/ndm/v1/store/*` helpers for
 * trusted runtimes.
 */
export type ImportMode = 'single_file' | 'multi_file' | 'single_dir' | 'mixed';
export type MaterializationStatus = 'ok' | 'on_cache' | 'all_in_store';
export type UploadStatus = 'not_started' | 'uploading' | 'completed' | 'failed' | 'not_required';
export type NdmErrorCode = 'USER_CANCELLED' | 'MODE_NOT_SUPPORTED_IN_RUNTIME' | 'DIRECTORY_NOT_SUPPORTED' | 'INVALID_ACCEPT_FILTER' | 'SESSION_NOT_FOUND' | 'UPLOAD_FAILED' | 'THUMBNAIL_GENERATION_FAILED' | 'STORE_API_NOT_SUPPORTED_IN_RUNTIME' | 'STORE_API_ENDPOINT_REQUIRED';
export declare class NdmError extends Error {
    readonly code: NdmErrorCode;
    constructor(code: NdmErrorCode, message?: string);
}
export interface ThumbnailOptions {
    enabled?: boolean;
    forTypes?: string[];
    maxWidth?: number;
    maxHeight?: number;
    eager?: boolean;
}
export interface ThumbnailResult {
    available: boolean;
    url?: string;
    width?: number;
    height?: number;
    mimeType?: string;
    errorCode?: string;
}
export interface BaseImportedObject {
    objectId: string;
    name: string;
    relativePath?: string;
    sourcePath?: string;
    locality?: 'local_only' | 'cache' | 'store';
}
export interface ImportedFileObject extends BaseImportedObject {
    kind: 'file';
    size: number;
    mimeType?: string;
    thumbnail?: ThumbnailResult;
    /** The browser File handle, kept for upload. */
    _file?: File;
    /** The canonical NDN FileObject JSON used for parent DirObject hashing. */
    _ndnFileObject?: Record<string, unknown>;
}
export interface ImportedDirObject extends BaseImportedObject {
    kind: 'dir';
    children?: Array<ImportedFileObject | ImportedDirObject>;
}
export interface PickupAndImportOptions<TMode extends ImportMode = ImportMode> {
    mode: TMode;
    accept?: string[];
    thumbnails?: ThumbnailOptions;
    autoStartUpload?: boolean;
}
export interface ImportSessionSummary {
    totalObjects: number;
    totalFiles: number;
    totalDirs: number;
    totalBytes: number;
}
export interface ImportSessionSnapshot<TSelection> {
    sessionId: string;
    selection: TSelection;
    items: Array<ImportedFileObject | ImportedDirObject>;
    materializationStatus: MaterializationStatus;
    uploadStatus: UploadStatus;
    summary: ImportSessionSummary;
}
export type PickupAndImportResult<TMode extends ImportMode> = TMode extends 'single_file' ? ImportSessionSnapshot<ImportedFileObject> : TMode extends 'multi_file' ? ImportSessionSnapshot<ImportedFileObject[]> : TMode extends 'single_dir' ? ImportSessionSnapshot<ImportedDirObject> : ImportSessionSnapshot<Array<ImportedFileObject | ImportedDirObject>>;
export interface PerObjectProgress {
    objectId: string;
    uploadedBytes: number;
    totalBytes: number;
    state: 'pending' | 'uploading' | 'completed' | 'failed';
}
export interface ImportSessionStatus {
    sessionId: string;
    materializationStatus: MaterializationStatus;
    uploadStatus: UploadStatus;
    summary: ImportSessionSummary;
    progress: {
        uploadedBytes: number;
        uploadedObjects: number;
        totalBytes: number;
        totalObjects: number;
    };
    perObjectProgress?: Record<string, PerObjectProgress>;
}
export interface StartUploadOptions {
    concurrency?: number;
    priority?: 'foreground' | 'background';
    /**
     * Override the NDM service base URL for TUS uploads. When omitted the
     * SDK will try to derive it from the zone host; the final TUS endpoint
     * is `${endpoint}/ndm/v1/uploads`.
     */
    endpoint?: string;
    extra?: Record<string, unknown>;
}
export interface UploadProgress {
    sessionId: string;
    uploadStatus: UploadStatus;
    totalBytes: number;
    uploadedBytes: number;
    totalObjects: number;
    uploadedObjects: number;
    speedBps?: number;
    elapsedMs?: number;
    estimatedRemainingMs?: number;
    perObjectProgress?: Record<string, PerObjectProgress>;
}
export interface RuntimeCapabilities {
    canRevealRealPath: boolean;
    canUseNDMCache: boolean;
    canUseNDMStore: boolean;
    canPickDirectory: boolean;
    canPickMixed: boolean;
}
export interface ImportProvider {
    getCapabilities(): RuntimeCapabilities;
    pickFiles(options: PickupAndImportOptions): Promise<File[]>;
}
export interface NdmStoreRequestOptions {
    /**
     * Base origin for the zone gateway, for example `https://app.zone.example`
     * or `http://host.docker.internal:3180`.
     */
    endpoint?: string;
    fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    headers?: Record<string, string>;
    credentials?: RequestCredentials;
    sessionToken?: string | null;
}
export interface NdmLookupRequestOptions extends NdmStoreRequestOptions {
}
export interface NdmStoreErrorBody {
    error?: string;
    message?: string;
    [key: string]: unknown;
}
export declare class NdmStoreApiError extends Error {
    readonly status: number;
    readonly errorCode?: string;
    readonly responseBody?: unknown;
    constructor(status: number, errorCode?: string, message?: string, responseBody?: unknown);
}
export interface GetObjectRequest {
    obj_id: string;
}
export interface GetObjectResponse {
    obj_id: string;
    obj_data: string;
}
export interface ObjIdWithInnerPathRequest {
    obj_id: string;
    inner_path?: string;
}
export interface OpenObjectResponse {
    obj_data: string;
}
export interface GetDirChildRequest {
    dir_obj_id: string;
    item_name: string;
}
export interface GetDirChildResponse {
    obj_id: string;
}
export interface IsObjectStoredResponse {
    stored: boolean;
}
export interface IsObjectExistResponse {
    exists: boolean;
}
export type QueryObjectByIdResponse = {
    state: 'not_exist';
} | {
    state: 'object';
    obj_data: string;
};
export interface PutObjectRequest {
    obj_id: string;
    obj_data: string;
}
export interface ChunkIdRequest {
    chunk_id: string;
}
export interface HaveChunkResponse {
    exists: boolean;
}
export interface ChunkStateLocalInfoRange {
    start: number;
    end: number;
}
export interface ChunkStateLocalInfo {
    qcid: string;
    last_modify_time: number;
    range?: ChunkStateLocalInfoRange;
}
export type QueryChunkStateResponse = {
    state: 'new';
    chunk_size: number;
} | {
    state: 'completed';
    chunk_size: number;
} | {
    state: 'disabled';
    chunk_size: number;
} | {
    state: 'not_exist';
    chunk_size: number;
} | {
    state: 'local_link';
    chunk_size: number;
    local_info: ChunkStateLocalInfo;
} | {
    state: 'same_as';
    chunk_size: number;
    same_as: string;
};
export interface AddChunkBySameAsRequest {
    big_chunk_id: string;
    chunk_list_id: string;
    big_chunk_size: number;
}
export type PinScope = 'recursive' | 'skeleton' | 'lease';
export interface EdgeMsg {
    op: 'add' | 'remove';
    referee: string;
    referrer: string;
    target_epoch: number;
}
export interface PinRequest {
    obj_id: string;
    owner: string;
    scope: PinScope;
    ttl_secs?: number;
}
export interface UnpinRequest {
    obj_id: string;
    owner: string;
}
export interface OwnerRequest {
    owner: string;
}
export interface CountResponse {
    count: number;
}
export interface FsAnchorRequest {
    obj_id: string;
    inode_id: number;
    field_tag: number;
}
export interface InodeRequest {
    inode_id: number;
}
export type AnchorStateValue = 'Pending' | 'Materializing' | string;
export interface AnchorStateResponse {
    state: AnchorStateValue;
}
export interface ForcedGcUntilRequest {
    target_bytes: number;
}
export interface ForcedGcUntilResponse {
    freed_bytes: number;
}
export type NdmLookupScope = 'app' | 'global';
export interface LookupObjectRequest {
    scope: NdmLookupScope;
    quick_hash: string;
    inner_path?: string;
}
export interface LookupObjectExistsResponse {
    object_id: string;
    scope: NdmLookupScope;
    exists: boolean;
}
export type LookupObjectChunkStateResponse = ({
    object_id: string;
    scope: NdmLookupScope;
} & {
    state: 'new';
    chunk_size: number;
}) | ({
    object_id: string;
    scope: NdmLookupScope;
} & {
    state: 'completed';
    chunk_size: number;
}) | ({
    object_id: string;
    scope: NdmLookupScope;
} & {
    state: 'disabled';
    chunk_size: number;
}) | ({
    object_id: string;
    scope: NdmLookupScope;
} & {
    state: 'not_exist';
    chunk_size: number;
}) | ({
    object_id: string;
    scope: NdmLookupScope;
    state: 'local_link';
    chunk_size: number;
    local_info: ChunkStateLocalInfo;
}) | ({
    object_id: string;
    scope: NdmLookupScope;
    state: 'same_as';
    chunk_size: number;
    same_as: string;
});
export type LookupObjectResponse = LookupObjectExistsResponse | LookupObjectChunkStateResponse;
export declare function setImportProvider(provider: ImportProvider): void;
export declare function getImportProvider(): ImportProvider;
export declare function lookupObject(request: LookupObjectRequest, options?: NdmLookupRequestOptions): Promise<LookupObjectResponse>;
export declare function getObject(request: GetObjectRequest, options?: NdmStoreRequestOptions): Promise<GetObjectResponse>;
export declare function openObject(request: ObjIdWithInnerPathRequest, options?: NdmStoreRequestOptions): Promise<OpenObjectResponse>;
export declare function getDirChild(request: GetDirChildRequest, options?: NdmStoreRequestOptions): Promise<GetDirChildResponse>;
export declare function isObjectStored(request: ObjIdWithInnerPathRequest, options?: NdmStoreRequestOptions): Promise<IsObjectStoredResponse>;
export declare function isObjectExist(request: GetObjectRequest, options?: NdmStoreRequestOptions): Promise<IsObjectExistResponse>;
export declare function queryObjectById(request: GetObjectRequest, options?: NdmStoreRequestOptions): Promise<QueryObjectByIdResponse>;
export declare function putObject(request: PutObjectRequest, options?: NdmStoreRequestOptions): Promise<void>;
export declare function removeObject(request: GetObjectRequest, options?: NdmStoreRequestOptions): Promise<void>;
export declare function haveChunk(request: ChunkIdRequest, options?: NdmStoreRequestOptions): Promise<HaveChunkResponse>;
export declare function queryChunkState(request: ChunkIdRequest, options?: NdmStoreRequestOptions): Promise<QueryChunkStateResponse>;
export declare function removeChunk(request: ChunkIdRequest, options?: NdmStoreRequestOptions): Promise<void>;
export declare function addChunkBySameAs(request: AddChunkBySameAsRequest, options?: NdmStoreRequestOptions): Promise<void>;
export declare function applyEdge(request: EdgeMsg, options?: NdmStoreRequestOptions): Promise<void>;
export declare function pin(request: PinRequest, options?: NdmStoreRequestOptions): Promise<void>;
export declare function unpin(request: UnpinRequest, options?: NdmStoreRequestOptions): Promise<void>;
export declare function unpinOwner(request: OwnerRequest, options?: NdmStoreRequestOptions): Promise<CountResponse>;
export declare function fsAcquire(request: FsAnchorRequest, options?: NdmStoreRequestOptions): Promise<void>;
export declare function fsRelease(request: FsAnchorRequest, options?: NdmStoreRequestOptions): Promise<void>;
export declare function fsReleaseInode(request: InodeRequest, options?: NdmStoreRequestOptions): Promise<CountResponse>;
export declare function fsAnchorState(request: FsAnchorRequest, options?: NdmStoreRequestOptions): Promise<AnchorStateResponse>;
export declare function forcedGcUntil(request: ForcedGcUntilRequest, options?: NdmStoreRequestOptions): Promise<ForcedGcUntilResponse>;
export declare function outboxCount(options?: NdmStoreRequestOptions): Promise<CountResponse>;
export declare function debugDumpExpandState<TResponse = unknown>(request: GetObjectRequest, options?: NdmStoreRequestOptions): Promise<TResponse>;
export declare function anchorState(request: UnpinRequest, options?: NdmStoreRequestOptions): Promise<AnchorStateResponse>;
/**
 * Calculate a QCID for a File using the same quick-hash rule as ndn-lib:
 * SHA-256(first 4096 bytes + middle 4096 bytes), encoded as ChunkType `qcid`.
 */
export declare function calculateQcidFromFile(file: File): Promise<string>;
/**
 * Initiate a user file/directory selection and materialize the chosen items
 * into NDN objects. Returns a session snapshot with objectIds ready to use.
 */
export declare function pickupAndImport<TMode extends ImportMode>(options: PickupAndImportOptions<TMode>): Promise<PickupAndImportResult<TMode>>;
/**
 * Query the current status of an import session.
 */
export declare function getImportSessionStatus(sessionId: string): Promise<ImportSessionStatus>;
/**
 * Query upload progress for an import session (focused view for progress bars).
 */
export declare function getUploadProgress(sessionId: string): Promise<UploadProgress>;
/**
 * Explicitly start uploading the objects in an import session.
 */
export declare function startUpload(sessionId: string, options?: StartUploadOptions): Promise<ImportSessionStatus>;
//# sourceMappingURL=ndm_client.d.ts.map