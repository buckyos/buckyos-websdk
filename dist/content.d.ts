export { extensionOf, heifImageSize, isoBoxes, mediaTypeFromExtension, sniffMagic, stripMediaTypeParams, TEXT_CODE_EXTENSIONS } from './content_mime';
export type { IsoBox } from './content_mime';
export type TransferableContentRef = {
    kind: 'cyfs-path';
    path: string;
    version?: string;
} | {
    kind: 'object-id';
    objectId: string;
    version?: string;
};
export type TransferableSessionContext = {
    kind: 'single';
} | {
    kind: 'container';
    container: TransferableContentRef;
    current: TransferableContentRef;
    sort?: unknown;
    navigation?: 'wrap' | 'bounded';
} | {
    kind: 'list';
    sessionId?: string;
    version?: string;
    items: Array<{
        id?: string;
        source: TransferableContentRef;
        title?: string;
    }>;
    currentIndex: number;
    navigation?: 'wrap' | 'bounded';
};
export interface OpenRequest {
    requestId: string;
    source: TransferableContentRef;
    session?: TransferableSessionContext;
    mode?: 'view' | 'edit';
    origin?: {
        appInstanceId?: string;
        windowId?: string;
        hostContext?: string;
    };
}
export type ContentOpenTarget = 'default' | 'preview' | 'chooser';
export interface ContentHints {
    name?: string;
    mime?: string;
    size?: number;
}
export declare function readContentHints(value: unknown): ContentHints;
export interface ContentSelector {
    objType?: string | string[];
    mime?: string | string[];
    schema?: string | string[];
    ext?: string[];
    maxSize?: number;
}
export interface ContentDescriptor {
    source: TransferableContentRef;
    objType?: string;
    mime?: string;
    schema?: string;
    ext?: string;
    name?: string;
    size?: number;
}
export interface OpenBinding {
    entry: {
        type: 'web';
        path: string;
    } | {
        type: 'builtin';
        target: string;
    };
    modes?: Array<'view' | 'edit'>;
    fidelity?: 'full' | 'partial';
    window?: 'reuse' | 'new';
    multiSource?: boolean;
    priority?: number;
}
export interface ContentHandlerEntry {
    provider: 'app' | 'system';
    app_instance_id?: string;
    app_doc_object_id?: string;
    app_version?: string;
    handler_id: string;
    handler_version: number;
    selectors: ContentSelector[];
    intents: {
        open?: OpenBinding;
    };
    permissions?: string[];
    enabled: boolean;
    registered_at?: number;
}
export interface ContentRegistry {
    schema_version: 1;
    updated_at?: number;
    handlers: Record<string, ContentHandlerEntry>;
}
export interface ContentDefaults {
    schema_version: 1;
    defaults: {
        open?: Record<string, string>;
    };
    disabled: string[];
}
export interface HandlerPlan {
    handlerKey: string;
    handlerRef: string;
    appInstanceId?: string;
    appDocObjectId?: string;
    handlerVersion: number;
    intent: 'open';
    binding: OpenBinding;
    matched: {
        selector: ContentSelector;
        specificity: number;
    };
    reason: 'user-default' | 'system-default' | 'ranked';
}
export declare const previewHandler: ContentHandlerEntry;
export declare const emptyDefaults: () => ContentDefaults;
export declare const contentRefString: (ref: TransferableContentRef) => string;
export declare function isTransferableRef(value: unknown): value is TransferableContentRef;
export declare function isOpenRequest(value: unknown): value is OpenRequest;
export declare function isTransferableSession(value: unknown): value is TransferableSessionContext;
export declare function contentDescriptor(source: TransferableContentRef, hints?: {
    name?: string;
    mime?: string;
    size?: number;
}): ContentDescriptor;
export declare function matchSelector(s: ContentSelector, d: ContentDescriptor): number;
export declare function resolveContentHandlers(registry: ContentRegistry, defaults: ContentDefaults, descriptor: ContentDescriptor, intent?: 'open', _host?: unknown, availableApps?: Iterable<string>): HandlerPlan[];
export declare function parentSource(source: TransferableContentRef): TransferableContentRef | undefined;
export declare function encodeSession(session: TransferableSessionContext | undefined, source: TransferableContentRef): string;
export declare function expandOpenPath(path: string, request: OpenRequest, modes?: Array<'view' | 'edit'>): string;
export interface SystemOpenRequest {
    request: Omit<OpenRequest, 'requestId'>;
    target: ContentOpenTarget;
    hints: ContentHints;
    /** AppId of the App asking the system to open this content; its own handlers are not offered back to it. */
    from?: string;
}
export declare function systemOpenUrl(systemOrigin: string, open: SystemOpenRequest): string;
export declare function parseSystemOpen(params: URLSearchParams): SystemOpenRequest | undefined;
/** Whether a handler belongs to the App identified by `appId` (an AppId, or an AppInstanceId `<appId>@<owner>`). */
export declare const handlerOfApp: (plan: Pick<HandlerPlan, 'appInstanceId'>, appId: string) => boolean;
export declare class ContentRegistryClient {
    private config;
    private userId;
    registry: ContentRegistry;
    defaults: ContentDefaults;
    updatedAt: number;
    private listeners;
    constructor(config: {
        get(key: string): Promise<{
            value: string;
        }>;
        set(key: string, value: string): Promise<unknown>;
    }, userId: string);
    refresh(): Promise<void>;
    setDefault(intent: 'open', selector: string, handlerKey: string | null): Promise<void>;
    setEnabled(key: string, enabled: boolean): Promise<void>;
    onChanged(cb: () => void): () => void;
    private persist;
}
/** The system file picker (`sysdlg/select`): one dialog for choosing files, a folder, or where to save. */
export declare const SELECT_DIALOG_PATH: "sysdlg/select";
export interface SelectDialogParams {
    /** open: choose existing files; folder: choose one folder; save: choose a folder and a file name. Defaults to open. */
    mode?: 'open' | 'folder' | 'save';
    title?: string;
    confirmLabel?: string;
    /** Where to start. A folder is opened; a file opens its folder with the file selected. Only `cyfs-path`. */
    start?: TransferableContentRef;
    /** open: allow several items. */
    multiple?: boolean;
    /** open with `multiple`: the most items that can be chosen (1–500, default 100). */
    limit?: number;
    /** open: an item is selectable when it matches any of these (at most 16). */
    accept?: ContentSelector[];
    /** folder: only a folder that can be written to. */
    writable?: boolean;
    /** folder, save: folders that cannot be the target, with everything below them (at most 1000; only `cyfs-path`). */
    exclude?: TransferableContentRef[];
    /** save: the suggested file name. */
    suggestedName?: string;
    /** open, folder: also allow files or a folder from this device. Defaults to false (Zone content only). */
    allowLocal?: boolean;
}
/** A file or folder in the Zone. */
export interface ZoneContent {
    origin: 'zone';
    kind: 'file' | 'folder';
    /** The reference the user chose. A `cyfs-path` follows later changes of the file. */
    source: TransferableContentRef;
    /** The object ID of the content at the moment of confirmation, when it is known. */
    objId?: string;
    hints: ContentHints;
}
/** A file from this device. */
export interface LocalFile {
    origin: 'local';
    kind: 'file';
    file: File;
    hints: ContentHints;
}
/** A folder from this device: every file below it, each with its path relative to (and starting with) the folder. */
export interface LocalFolder {
    origin: 'local';
    kind: 'folder';
    name: string;
    files: Array<{
        file: File;
        relativePath: string;
    }>;
}
export type SelectedContent = ZoneContent | LocalFile | LocalFolder;
export type SelectDialogResult = {
    action: 'selected';
    items: SelectedContent[];
} | {
    action: 'save';
    parent: TransferableContentRef;
    name: string;
    overwrite: boolean;
} | {
    action: 'cancelled';
};
export type SystemDialogErrorCode = 'unsupported' | 'invalid_params' | 'busy' | 'closed' | 'load_failed' | 'protocol';
export declare const SYSTEM_DIALOG_ERROR_CODES: readonly SystemDialogErrorCode[];
/** A system dialog could not be shown or did not complete. Cancelling is a normal result, not this error. */
export declare class SystemDialogError extends Error {
    code: SystemDialogErrorCode;
    constructor(code: SystemDialogErrorCode, message?: string);
}
/**
 * Checks a result that crossed a window boundary and returns a clean copy, or undefined when its shape is not valid.
 * Items of one result share an origin; items from this device are only valid when the caller asked for `allowLocal`.
 */
export declare function readSelectDialogResult(value: unknown, options?: {
    allowLocal?: boolean;
}): SelectDialogResult | undefined;
//# sourceMappingURL=content.d.ts.map