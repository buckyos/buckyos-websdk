/**
 * ndm_proxy - NamedDataMgr Proxy Protocol client for trusted runtimes.
 *
 * This module targets AppClient/AppService style runtimes that talk to the
 * `/ndm/proxy/v1` protocol. Browser-oriented import/upload flows remain in
 * `ndm_client`.
 */
export declare const NDM_PROXY_V1_PATH = "/ndm/proxy/v1";
export interface NdmProxyRequestOptions {
    /**
     * Base origin for the NDM proxy endpoint, for example
     * `http://host.docker.internal:3180` or `http://127.0.0.1:3180`.
     */
    endpoint?: string;
    fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    headers?: Record<string, string>;
    credentials?: RequestCredentials;
    sessionToken?: string | null;
}
export interface NdmProxyErrorBody {
    error?: string;
    message?: string;
    [key: string]: unknown;
}
export declare class NdmProxyApiError extends Error {
    readonly status: number;
    readonly errorCode?: string;
    readonly responseBody?: unknown;
    constructor(status: number, errorCode?: string, message?: string, responseBody?: unknown);
}
export type NdmProxyErrorCode = 'PROXY_API_NOT_SUPPORTED_IN_RUNTIME' | 'PROXY_API_ENDPOINT_REQUIRED' | 'PROXY_API_CHUNK_SIZE_REQUIRED';
export declare class NdmProxyError extends Error {
    readonly code: NdmProxyErrorCode;
    constructor(code: NdmProxyErrorCode, message?: string);
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
    inner_path?: string | null;
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
export type PinScope = 'recursive' | 'skeleton' | 'lease' | string;
export interface EdgeMsg {
    op: 'add' | 'remove' | string;
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
export interface OpenChunkReaderRequest {
    chunk_id: string;
    offset?: number;
}
export interface GetChunkPieceRequest {
    chunk_id: string;
    offset: number;
    piece_size: number;
}
export interface OpenChunkListReaderRequest {
    chunk_list_id: string;
    offset?: number;
}
export interface OpenReaderRequest {
    obj_id: string;
    inner_path?: string | null;
}
export type NdmProxyReaderKind = 'chunk' | 'chunklist' | 'object' | string;
export interface NdmProxyReadResult {
    response: Response;
    body: ReadableStream<Uint8Array> | null;
    totalSize: number | null;
    resolvedObjectId?: string;
    readerKind?: NdmProxyReaderKind;
    contentLength: number | null;
    offset: number | null;
}
export type ChunkWriteOutcome = 'written' | 'already_exists' | string;
export interface PutChunkByReaderOptions extends NdmProxyRequestOptions {
    chunkSize?: number;
}
export interface PutChunkResponse {
    chunkSize: number | null;
    outcome?: ChunkWriteOutcome;
    chunkObjectId?: string;
}
export declare class NdmProxyRpcClient {
    private readonly options?;
    constructor(options?: NdmProxyRequestOptions);
    getObject(request: GetObjectRequest, options?: NdmProxyRequestOptions): Promise<GetObjectResponse>;
    openObject(request: ObjIdWithInnerPathRequest, options?: NdmProxyRequestOptions): Promise<OpenObjectResponse>;
    getDirChild(request: GetDirChildRequest, options?: NdmProxyRequestOptions): Promise<GetDirChildResponse>;
    isObjectStored(request: ObjIdWithInnerPathRequest, options?: NdmProxyRequestOptions): Promise<IsObjectStoredResponse>;
    isObjectExist(request: GetObjectRequest, options?: NdmProxyRequestOptions): Promise<IsObjectExistResponse>;
    queryObjectById(request: GetObjectRequest, options?: NdmProxyRequestOptions): Promise<QueryObjectByIdResponse>;
    putObject(request: PutObjectRequest, options?: NdmProxyRequestOptions): Promise<void>;
    removeObject(request: GetObjectRequest, options?: NdmProxyRequestOptions): Promise<void>;
    haveChunk(request: ChunkIdRequest, options?: NdmProxyRequestOptions): Promise<HaveChunkResponse>;
    queryChunkState(request: ChunkIdRequest, options?: NdmProxyRequestOptions): Promise<QueryChunkStateResponse>;
    removeChunk(request: ChunkIdRequest, options?: NdmProxyRequestOptions): Promise<void>;
    addChunkBySameAs(request: AddChunkBySameAsRequest, options?: NdmProxyRequestOptions): Promise<void>;
    applyEdge(request: EdgeMsg, options?: NdmProxyRequestOptions): Promise<void>;
    pin(request: PinRequest, options?: NdmProxyRequestOptions): Promise<void>;
    unpin(request: UnpinRequest, options?: NdmProxyRequestOptions): Promise<void>;
    unpinOwner(request: OwnerRequest, options?: NdmProxyRequestOptions): Promise<CountResponse>;
    fsAcquire(request: FsAnchorRequest, options?: NdmProxyRequestOptions): Promise<void>;
    fsRelease(request: FsAnchorRequest, options?: NdmProxyRequestOptions): Promise<void>;
    fsReleaseInode(request: InodeRequest, options?: NdmProxyRequestOptions): Promise<CountResponse>;
    fsAnchorState(request: FsAnchorRequest, options?: NdmProxyRequestOptions): Promise<AnchorStateResponse>;
    forcedGcUntil(request: ForcedGcUntilRequest, options?: NdmProxyRequestOptions): Promise<ForcedGcUntilResponse>;
    outboxCount(options?: NdmProxyRequestOptions): Promise<CountResponse>;
    debugDumpExpandState<TResponse = unknown>(request: GetObjectRequest, options?: NdmProxyRequestOptions): Promise<TResponse>;
    anchorState(request: UnpinRequest, options?: NdmProxyRequestOptions): Promise<AnchorStateResponse>;
}
export declare class NdmProxyReaderClient {
    private readonly options?;
    constructor(options?: NdmProxyRequestOptions);
    openChunkReader(request: OpenChunkReaderRequest, options?: NdmProxyRequestOptions): Promise<NdmProxyReadResult>;
    getChunkData(request: ChunkIdRequest, options?: NdmProxyRequestOptions): Promise<Uint8Array>;
    getChunkPiece(request: GetChunkPieceRequest, options?: NdmProxyRequestOptions): Promise<Uint8Array>;
    openChunkListReader(request: OpenChunkListReaderRequest, options?: NdmProxyRequestOptions): Promise<NdmProxyReadResult>;
    openReader(request: OpenReaderRequest, options?: NdmProxyRequestOptions): Promise<NdmProxyReadResult>;
}
export declare class NdmProxyWriterClient {
    private readonly options?;
    constructor(options?: NdmProxyRequestOptions);
    putChunkByReader(chunkId: string, body: BodyInit, options?: PutChunkByReaderOptions): Promise<PutChunkResponse>;
    putChunk(chunkId: string, data: Uint8Array | ArrayBuffer, options?: PutChunkByReaderOptions): Promise<PutChunkResponse>;
}
export declare class NdmProxyClient {
    readonly rpc: NdmProxyRpcClient;
    readonly reader: NdmProxyReaderClient;
    readonly writer: NdmProxyWriterClient;
    private readonly options?;
    constructor(options?: NdmProxyRequestOptions);
    getObject(request: GetObjectRequest, options?: NdmProxyRequestOptions): Promise<GetObjectResponse>;
    openObject(request: ObjIdWithInnerPathRequest, options?: NdmProxyRequestOptions): Promise<OpenObjectResponse>;
    getDirChild(request: GetDirChildRequest, options?: NdmProxyRequestOptions): Promise<GetDirChildResponse>;
    isObjectStored(request: ObjIdWithInnerPathRequest, options?: NdmProxyRequestOptions): Promise<IsObjectStoredResponse>;
    isObjectExist(request: GetObjectRequest, options?: NdmProxyRequestOptions): Promise<IsObjectExistResponse>;
    queryObjectById(request: GetObjectRequest, options?: NdmProxyRequestOptions): Promise<QueryObjectByIdResponse>;
    putObject(request: PutObjectRequest, options?: NdmProxyRequestOptions): Promise<void>;
    removeObject(request: GetObjectRequest, options?: NdmProxyRequestOptions): Promise<void>;
    haveChunk(request: ChunkIdRequest, options?: NdmProxyRequestOptions): Promise<HaveChunkResponse>;
    queryChunkState(request: ChunkIdRequest, options?: NdmProxyRequestOptions): Promise<QueryChunkStateResponse>;
    removeChunk(request: ChunkIdRequest, options?: NdmProxyRequestOptions): Promise<void>;
    addChunkBySameAs(request: AddChunkBySameAsRequest, options?: NdmProxyRequestOptions): Promise<void>;
    applyEdge(request: EdgeMsg, options?: NdmProxyRequestOptions): Promise<void>;
    pin(request: PinRequest, options?: NdmProxyRequestOptions): Promise<void>;
    unpin(request: UnpinRequest, options?: NdmProxyRequestOptions): Promise<void>;
    unpinOwner(request: OwnerRequest, options?: NdmProxyRequestOptions): Promise<CountResponse>;
    fsAcquire(request: FsAnchorRequest, options?: NdmProxyRequestOptions): Promise<void>;
    fsRelease(request: FsAnchorRequest, options?: NdmProxyRequestOptions): Promise<void>;
    fsReleaseInode(request: InodeRequest, options?: NdmProxyRequestOptions): Promise<CountResponse>;
    fsAnchorState(request: FsAnchorRequest, options?: NdmProxyRequestOptions): Promise<AnchorStateResponse>;
    forcedGcUntil(request: ForcedGcUntilRequest, options?: NdmProxyRequestOptions): Promise<ForcedGcUntilResponse>;
    outboxCount(options?: NdmProxyRequestOptions): Promise<CountResponse>;
    debugDumpExpandState<TResponse = unknown>(request: GetObjectRequest, options?: NdmProxyRequestOptions): Promise<TResponse>;
    anchorState(request: UnpinRequest, options?: NdmProxyRequestOptions): Promise<AnchorStateResponse>;
    openChunkReader(request: OpenChunkReaderRequest, options?: NdmProxyRequestOptions): Promise<NdmProxyReadResult>;
    getChunkData(request: ChunkIdRequest, options?: NdmProxyRequestOptions): Promise<Uint8Array>;
    getChunkPiece(request: GetChunkPieceRequest, options?: NdmProxyRequestOptions): Promise<Uint8Array>;
    openChunkListReader(request: OpenChunkListReaderRequest, options?: NdmProxyRequestOptions): Promise<NdmProxyReadResult>;
    openReader(request: OpenReaderRequest, options?: NdmProxyRequestOptions): Promise<NdmProxyReadResult>;
    putChunkByReader(chunkId: string, body: BodyInit, options?: PutChunkByReaderOptions): Promise<PutChunkResponse>;
    putChunk(chunkId: string, data: Uint8Array | ArrayBuffer, options?: PutChunkByReaderOptions): Promise<PutChunkResponse>;
    withOptions(options: NdmProxyRequestOptions): NdmProxyClient;
}
export declare function createNdmProxyClient(options?: NdmProxyRequestOptions): NdmProxyClient;
export declare function getObject(request: GetObjectRequest, options?: NdmProxyRequestOptions): Promise<GetObjectResponse>;
export declare function openObject(request: ObjIdWithInnerPathRequest, options?: NdmProxyRequestOptions): Promise<OpenObjectResponse>;
export declare function getDirChild(request: GetDirChildRequest, options?: NdmProxyRequestOptions): Promise<GetDirChildResponse>;
export declare function isObjectStored(request: ObjIdWithInnerPathRequest, options?: NdmProxyRequestOptions): Promise<IsObjectStoredResponse>;
export declare function isObjectExist(request: GetObjectRequest, options?: NdmProxyRequestOptions): Promise<IsObjectExistResponse>;
export declare function queryObjectById(request: GetObjectRequest, options?: NdmProxyRequestOptions): Promise<QueryObjectByIdResponse>;
export declare function putObject(request: PutObjectRequest, options?: NdmProxyRequestOptions): Promise<void>;
export declare function removeObject(request: GetObjectRequest, options?: NdmProxyRequestOptions): Promise<void>;
export declare function haveChunk(request: ChunkIdRequest, options?: NdmProxyRequestOptions): Promise<HaveChunkResponse>;
export declare function queryChunkState(request: ChunkIdRequest, options?: NdmProxyRequestOptions): Promise<QueryChunkStateResponse>;
export declare function removeChunk(request: ChunkIdRequest, options?: NdmProxyRequestOptions): Promise<void>;
export declare function addChunkBySameAs(request: AddChunkBySameAsRequest, options?: NdmProxyRequestOptions): Promise<void>;
export declare function applyEdge(request: EdgeMsg, options?: NdmProxyRequestOptions): Promise<void>;
export declare function pin(request: PinRequest, options?: NdmProxyRequestOptions): Promise<void>;
export declare function unpin(request: UnpinRequest, options?: NdmProxyRequestOptions): Promise<void>;
export declare function unpinOwner(request: OwnerRequest, options?: NdmProxyRequestOptions): Promise<CountResponse>;
export declare function fsAcquire(request: FsAnchorRequest, options?: NdmProxyRequestOptions): Promise<void>;
export declare function fsRelease(request: FsAnchorRequest, options?: NdmProxyRequestOptions): Promise<void>;
export declare function fsReleaseInode(request: InodeRequest, options?: NdmProxyRequestOptions): Promise<CountResponse>;
export declare function fsAnchorState(request: FsAnchorRequest, options?: NdmProxyRequestOptions): Promise<AnchorStateResponse>;
export declare function forcedGcUntil(request: ForcedGcUntilRequest, options?: NdmProxyRequestOptions): Promise<ForcedGcUntilResponse>;
export declare function outboxCount(options?: NdmProxyRequestOptions): Promise<CountResponse>;
export declare function debugDumpExpandState<TResponse = unknown>(request: GetObjectRequest, options?: NdmProxyRequestOptions): Promise<TResponse>;
export declare function anchorState(request: UnpinRequest, options?: NdmProxyRequestOptions): Promise<AnchorStateResponse>;
export declare function openChunkReader(request: OpenChunkReaderRequest, options?: NdmProxyRequestOptions): Promise<NdmProxyReadResult>;
export declare function getChunkData(request: ChunkIdRequest, options?: NdmProxyRequestOptions): Promise<Uint8Array>;
export declare function getChunkPiece(request: GetChunkPieceRequest, options?: NdmProxyRequestOptions): Promise<Uint8Array>;
export declare function openChunkListReader(request: OpenChunkListReaderRequest, options?: NdmProxyRequestOptions): Promise<NdmProxyReadResult>;
export declare function openReader(request: OpenReaderRequest, options?: NdmProxyRequestOptions): Promise<NdmProxyReadResult>;
export declare function putChunkByReader(chunkId: string, body: BodyInit, options?: PutChunkByReaderOptions): Promise<PutChunkResponse>;
export declare function putChunk(chunkId: string, data: Uint8Array | ArrayBuffer, options?: PutChunkByReaderOptions): Promise<PutChunkResponse>;
//# sourceMappingURL=ndm_proxy.d.ts.map