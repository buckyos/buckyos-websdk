export { extensionOf, mediaTypeFromExtension, TEXT_CODE_EXTENSIONS } from './content_mime';
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
//# sourceMappingURL=content.d.ts.map