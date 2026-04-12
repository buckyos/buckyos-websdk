/**
 * ndm_client - Unified import & upload client for BuckyOS WebSDK.
 *
 * Provides `pickupAndImport` and companion session/upload APIs that hide
 * runtime differences (pure browser, NDM Cache, NDM Store) behind a single
 * provider-based abstraction.
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

// ============================================================
// Default chunk size for splitting files (4 MiB)
// ============================================================

const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024

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
): Promise<{ objectId: string; chunks: ObjectUploadState['chunks'] }> {
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
        return { objectId: objId.toString(), chunks }
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
    return { objectId: objId.toString(), chunks }
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

function computeDirObjectIds(dir: ImportedDirObject): string {
    const ndnDir = new NdnDirObject(dir.name)

    if (dir.children) {
        for (const child of dir.children) {
            if (child.kind === 'file') {
                const fileObj = new NdnFileObject(child.name, child.size, '')
                ndnDir.addFile(child.name, fileObj.toJSON(), child.size)
            } else {
                const childObjId = computeDirObjectIds(child)
                ndnDir.addDirectory(child.name, ObjId.fromString(childObjId), 0)
            }
        }
    }

    const [objId] = ndnDir.genObjId()
    dir.objectId = objId.toString()
    return dir.objectId
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

    for (const file of files) {
        const relativePath = (file as any).webkitRelativePath || undefined
        const { objectId, chunks } = await materializeFile(file)

        const imported: ImportedFileObject = {
            kind: 'file',
            objectId,
            name: file.name,
            size: file.size,
            mimeType: file.type || undefined,
            relativePath,
            locality: 'local_only',
            _file: file,
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

        objectStates.set(objectId, {
            objectId,
            name: file.name,
            size: file.size,
            file,
            uploadedBytes: 0,
            state: 'pending',
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
    if (caps.canUseNDMStore) {
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
 * Uses tus-js-client when available, falls back to manual fetch-based TUS.
 */
async function uploadChunkViaTus(
    endpoint: string,
    file: File,
    chunkInfo: ObjectUploadState['chunks'][0],
    appId: string,
    logicalPath: string,
    fileHash: string,
    onProgress: (uploaded: number) => void,
    signal?: AbortSignal,
): Promise<string> {
    const slice = file.slice(chunkInfo.offset, chunkInfo.offset + chunkInfo.length)
    const chunkData = new Uint8Array(await slice.arrayBuffer())

    // Try to use tus-js-client if available
    let tus: typeof import('tus-js-client') | undefined
    try {
        tus = await import('tus-js-client')
    } catch {
        // tus-js-client not available, use manual fetch
    }

    if (tus != null) {
        const tusModule = tus
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
                    chunk_index: '0',
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

    // Manual TUS implementation via fetch
    return await manualTusUpload(endpoint, chunkData, chunkInfo, appId, logicalPath, fileHash, onProgress, signal)
}

async function manualTusUpload(
    endpoint: string,
    chunkData: Uint8Array,
    chunkInfo: ObjectUploadState['chunks'][0],
    appId: string,
    logicalPath: string,
    fileHash: string,
    onProgress: (uploaded: number) => void,
    signal?: AbortSignal,
): Promise<string> {
    const tusResumable = '1.0.0'

    const metadata = `app_id=${appId},logical_path=${logicalPath},chunk_index=0,file_hash=${fileHash}`

    // POST: create upload session
    const createResp = await fetch(`${endpoint}/ndm/v1/uploads`, {
        method: 'POST',
        headers: {
            'tus-resumable': tusResumable,
            'upload-length': String(chunkData.length),
            'upload-metadata': metadata,
        },
        signal,
    })

    if (createResp.status !== 201 && createResp.status !== 200) {
        await createResp.body?.cancel()
        throw new NdmError('UPLOAD_FAILED', `TUS create failed with status ${createResp.status}`)
    }

    const location = createResp.headers.get('location')
    if (!location) {
        await createResp.body?.cancel()
        throw new NdmError('UPLOAD_FAILED', 'TUS create did not return location header')
    }
    await createResp.body?.cancel()

    // Check current offset (in case of resume)
    const headResp = await fetch(`${endpoint}${location}`, {
        method: 'HEAD',
        headers: { 'tus-resumable': tusResumable },
        signal,
    })
    const currentOffset = parseInt(headResp.headers.get('upload-offset') ?? '0', 10)
    await headResp.body?.cancel()

    if (currentOffset >= chunkData.length) {
        // Already fully uploaded
        onProgress(chunkData.length)
        return chunkInfo.chunkId
    }

    // PATCH: upload remaining data
    const patchResp = await fetch(`${endpoint}${location}`, {
        method: 'PATCH',
        headers: {
            'tus-resumable': tusResumable,
            'upload-offset': String(currentOffset),
            'content-type': 'application/offset+octet-stream',
        },
        body: chunkData.slice(currentOffset),
        signal,
    })

    if (patchResp.status !== 204) {
        await patchResp.body?.cancel()
        throw new NdmError('UPLOAD_FAILED', `TUS PATCH failed with status ${patchResp.status}`)
    }
    await patchResp.body?.cancel()

    onProgress(chunkData.length)
    return chunkInfo.chunkId
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

    for (const chunk of state.chunks) {
        if (chunk.uploaded) continue

        await uploadChunkViaTus(
            endpoint,
            state.file,
            chunk,
            'default',
            state.name,
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
