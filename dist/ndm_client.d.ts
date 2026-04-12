/**
 * ndm_client - Unified import & upload client for BuckyOS WebSDK.
 *
 * Provides `pickupAndImport` and companion session/upload APIs that hide
 * runtime differences (pure browser, NDM Cache, NDM Store) behind a single
 * provider-based abstraction.
 */
export type ImportMode = 'single_file' | 'multi_file' | 'single_dir' | 'mixed';
export type MaterializationStatus = 'ok' | 'on_cache' | 'all_in_store';
export type UploadStatus = 'not_started' | 'uploading' | 'completed' | 'failed' | 'not_required';
export type NdmErrorCode = 'USER_CANCELLED' | 'MODE_NOT_SUPPORTED_IN_RUNTIME' | 'DIRECTORY_NOT_SUPPORTED' | 'INVALID_ACCEPT_FILTER' | 'SESSION_NOT_FOUND' | 'UPLOAD_FAILED' | 'THUMBNAIL_GENERATION_FAILED';
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
export declare function setImportProvider(provider: ImportProvider): void;
export declare function getImportProvider(): ImportProvider;
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