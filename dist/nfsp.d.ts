/**
 * NFSP v0 client for nfs_server (buckyos/src/frame/nfs_server).
 *
 * Speaks the control plane (`POST /nfs/v1/{method}`), the data plane
 * (`GET /nfs/v1/read/{node_id}`), the minimal tus upload area
 * (`PATCH|HEAD /nfs/v1/uploads/{fb}`) and the watch SSE stream
 * (`GET /nfs/v1/watch`).
 *
 * Protocol references:
 * - cyfs-ndn/doc/NamedFileSystem_Protocol_v0.md (NFSP v0)
 * - buckyos/product/bucky_file/nfs_server.md
 * - buckyos/src/frame/nfs_server/README.md (v1 降级契约)
 *
 * Client contract highlights (nfs_server README §4.2):
 * - `revision` is an opaque equality token: only compare, never order.
 * - Write ops require `seq` (exactly-once); the client auto-assigns one per
 *   write and replays with the SAME seq on network retry.
 * - Leases are advisory versus server-local bypass writers: commit may fail
 *   with TARGET_MISMATCH{reason:"bypass_modified"} — surface, don't retry.
 * - watch is lossy: any `resync` event means "re-list what you care about".
 *
 * Uses only fetch/WHATWG streams, so it runs in the browser and in Node ≥ 18.
 */
export declare const NFSP_VERSION = "nfsp/0";
/** `{"type":"live",...}` or `{"type":"object",...}` (NFSP §3.1.2). */
export type LiveRef = {
    type: 'live';
    node_id: string;
    gen?: number;
};
export type ObjectRef = {
    type: 'object';
    obj_id: string;
    inner_path?: string;
};
export type WireRef = LiveRef | ObjectRef;
export declare const liveRef: (nodeId: string, gen?: number) => LiveRef;
/** The `at` locator: ref > uri > path (NFSP §3.4). */
export interface Locator {
    realm?: string;
    path?: string;
    uri?: string;
    ref?: WireRef;
}
/** Sugar: accept a dfs path string, a `xxx://` uri, a WireRef or a Locator. */
export type LocatorLike = string | WireRef | Locator;
export declare const toLocator: (at: LocatorLike) => Locator;
export type WantGroup = 'base' | 'ident' | 'access' | 'meta';
export type NodeKind = 'dir' | 'file' | 'symlink' | 'view' | 'collection' | 'group';
export interface Capabilities {
    list: boolean;
    read: boolean;
    accepts_content: boolean;
    accepts_references: boolean;
    remove_semantics: 'destroy' | 'unlink' | 'none';
    ordered: boolean;
}
/** resolve/stat result (fields beyond `base` appear per the `want` mask). */
export interface NodeInfo {
    kind: NodeKind;
    state: string;
    ref: WireRef;
    copy_ref?: WireRef | null;
    capabilities: Capabilities;
    revision?: string;
    locations?: unknown[];
    name?: string;
    size?: number;
    mtime?: number;
    ctime?: number;
    flags?: string[];
    node_id?: string;
    gen?: number;
    etag?: string;
    obj_id?: string;
    access_urls?: {
        kind: string;
        url: string;
    }[];
    meta_summary?: Record<string, number>;
    view_id?: string;
    collection_id?: string;
    title?: string;
    origin?: string;
    stale?: boolean;
}
export type EntryBinding = 'native' | 'reference' | 'member' | 'derived';
/** Compact target of a listing entry (not a full NodeInfo). */
export interface EntryTarget {
    ref: WireRef;
    copy_ref?: WireRef | null;
    kind: NodeKind;
    /** Attribute groups per the `want` mask: base → size/mtime/flags, ident → etag/obj_id, access → access_urls. */
    attrs?: {
        size?: number;
        mtime?: number;
        flags?: string[];
        etag?: string;
        obj_id?: string;
        access_urls?: {
            kind: string;
            url: string;
        }[];
    } & Record<string, unknown>;
    /** `stale` when a referenced target no longer resolves. */
    target_state?: string;
}
export interface Entry {
    name: string;
    binding: EntryBinding;
    entry_ref?: string;
    target: EntryTarget;
    canonical_path?: string;
    context?: {
        count?: number;
        provenance?: Record<string, unknown>;
    } & Record<string, unknown>;
}
export interface Listing {
    container: NodeInfo;
    entries: Entry[];
    truncated?: boolean;
    next_cursor?: string;
    revision_changed?: boolean;
    watch_token?: string;
    /** Same-name virtual bindings shadowed by native entries (`native_shadow`). */
    conflicts?: {
        name: string;
        reason: string;
        entry_ref?: string;
        target?: EntryTarget;
    }[];
}
export interface ListOptions {
    cursor?: string;
    limit?: number;
    order?: 'name' | 'mtime' | 'size' | 'manual';
    filter?: {
        kind?: NodeKind[];
        name_glob?: string;
    };
}
export interface HelloResult {
    version: string;
    session: string;
    features: string[];
    limits: {
        max_batch: number;
        max_list: number;
        replay_window: number;
        attr_ttl_ms: number;
    };
    realms: {
        id: string;
        writable: boolean;
    }[];
}
export type BatchOp = {
    m: 'walk';
    args: {
        name?: string;
        names?: string[];
        entry_ref?: string;
    };
} | {
    m: 'stat' | 'resolve';
    args?: {
        name?: string;
    };
    want?: WantGroup[];
} | {
    m: 'list';
    args?: ListOptions;
    want?: WantGroup[];
};
export interface BatchResult {
    completed: number;
    results: ({
        ok: true;
        result: unknown;
    } | {
        ok: false;
        error: NfspErrorBody;
    })[];
}
export interface OpenWriteResult {
    fb_handle: string;
    upload_url: string;
    lease: {
        lease_id: string;
        seq: number;
        ttl_ms: number;
    };
    target: {
        path: string;
        exists: boolean;
    };
}
export interface CommitResult {
    ref: WireRef;
    entry_ref: string;
    revision: string;
    obj: {
        sha256: string;
        size: number;
    };
}
export interface MetaRecord {
    ns: string;
    key: string;
    value: unknown;
    source?: unknown;
    confidence?: number;
    anchor?: string;
    visibility?: string;
}
export interface SearchHit {
    copy_ref?: WireRef | null;
    match_source: string;
    canonical_path: string;
    explain?: Record<string, unknown>;
    [k: string]: unknown;
}
export interface SearchResult {
    hits: SearchHit[];
    partial: boolean;
    sources: {
        mode: string;
        state: string;
        took_ms?: number;
        reason?: string;
    }[];
    next_cursor?: string;
}
export interface GrantResult {
    cap_id: string;
    token: string;
    subtree: string;
    ops: string[];
    expires_at?: number;
}
export type CollectionPatchOp = {
    add_ref: {
        target_ref: WireRef;
        name?: string;
        position?: number;
        parent_entry_ref?: string;
    };
} | {
    remove_entry: {
        entry_ref: string;
    };
} | {
    move_entries: {
        entry_refs: string[];
        to_index: number;
    };
} | {
    create_group: {
        name: string;
        position?: number;
    };
} | {
    rename_group: {
        entry_ref: string;
        name: string;
    };
};
export interface WatchEvent {
    /** `resync` | `container_changed` | `meta_changed` (extensible). */
    event: string;
    /** Parsed JSON payload of the SSE `data:` line. */
    data: Record<string, unknown>;
    /** SSE `id:` (the server_rev), when present. */
    id?: string;
}
/** Structured NFSP error body (§8 plus implementation extensions). */
export interface NfspErrorBody {
    code: string;
    message: string;
    [k: string]: unknown;
}
export declare class NfspError extends Error {
    readonly code: string;
    readonly httpStatus: number;
    /** Extra structured fields (reason, holder_session, obj_id, expected, ...). */
    readonly details: Record<string, unknown>;
    constructor(body: NfspErrorBody, httpStatus: number);
}
export interface NfspClientOptions {
    sessionToken?: () => Promise<string | null>;
    /** e.g. `http://127.0.0.1:3260` — no trailing slash needed. */
    baseUrl: string;
    /** Override fetch (tests, custom auth wrappers). Defaults to global fetch. */
    fetch?: typeof fetch;
    /** tus PATCH chunk size; server guidance is 4–16 MB. Default 8 MB. */
    uploadChunkSize?: number;
}
interface EnvelopeExtras {
    at?: Locator;
    want?: WantGroup[];
    args?: Record<string, unknown>;
}
export declare class NfspClient {
    private readonly sessionToken?;
    readonly baseUrl: string;
    private readonly fetchFn;
    private readonly chunkSize;
    private session;
    private seq;
    private helloResult;
    constructor(opts: NfspClientOptions);
    get sessionId(): string | null;
    /** Features advertised by the server in hello (empty before hello). */
    get features(): string[];
    get limits(): HelloResult['limits'] | null;
    hello(clientFeatures?: string[]): Promise<HelloResult>;
    bye(): Promise<void>;
    resolve(at: LocatorLike, want?: WantGroup[]): Promise<NodeInfo>;
    /** stat with an optional child `name` step (server-side walk). */
    stat(at: LocatorLike, opts?: {
        name?: string;
        want?: WantGroup[];
    }): Promise<NodeInfo>;
    list(at: LocatorLike, opts?: ListOptions, want?: WantGroup[]): Promise<Listing>;
    batch(start: LocatorLike, ops: BatchOp[], onError?: 'abort' | 'continue'): Promise<BatchResult>;
    /**
     * Ref form: create one child under `parent` (optional CAS via
     * `expectedRevision`). Path form: pass a dfs path string and no name —
     * behaves like `mkdir -p` (idempotent, no CAS).
     */
    mkdir(parent: LocatorLike, name?: string, opts?: {
        expectedRevision?: string;
    }): Promise<{
        ref: WireRef;
        existed: boolean;
        revision?: string;
    }>;
    move(from: {
        parentRef: WireRef;
        name: string;
    }, to: {
        parentRef: WireRef;
        name: string;
    }, opts?: {
        expectedFromRevision?: string;
        expectedToRevision?: string;
    }): Promise<{
        from_revision: string;
        to_revision: string;
    }>;
    /** Destroys a native entry. Reference entries must use `unlink` instead. */
    delete(parent: LocatorLike, name: string, opts?: {
        recursive?: boolean;
        expectedRevision?: string;
    }): Promise<{
        revision: string;
    }>;
    bindRef(parentRef: WireRef, name: string, targetRef: WireRef, opts?: {
        expectedRevision?: string;
    }): Promise<{
        entry_ref: string;
        revision: string;
    }>;
    /** Removes a reference entry (`be_*`) only; the target is never touched. */
    unlink(entryRef: string, opts?: {
        expectedRevision?: string;
    }): Promise<{
        revision: string;
    }>;
    openWrite(target: {
        parentRef: WireRef;
        name: string;
        size?: number;
    } | {
        ref: WireRef;
    }): Promise<OpenWriteResult>;
    /** Current upload offset (tus HEAD) — resume point after interruption. */
    uploadOffset(fbHandle: string): Promise<number>;
    /** One tus PATCH. Returns the new offset. */
    uploadChunk(fbHandle: string, offset: number, chunk: Uint8Array): Promise<number>;
    /** Uploads a whole buffer in chunks, resuming from the server's offset. */
    uploadContent(fbHandle: string, content: Uint8Array, onProgress?: (sent: number, total: number) => void): Promise<void>;
    abortWrite(leaseId: string): Promise<void>;
    private authHeaders;
    commitFile(parent: LocatorLike, name: string, source: {
        fbHandle: string;
        leaseId?: string;
    } | {
        hash: string;
    }, opts?: {
        overwrite?: boolean;
        expectedRevision?: string;
    }): Promise<CommitResult>;
    /** Which of these digests must be uploaded (§ probe / 秒传). */
    probe(digests: {
        hash: string;
        size?: number;
    }[]): Promise<{
        missing: {
            hash: string;
            size?: number;
        }[];
    }>;
    /**
     * Convenience: open_write + chunked tus upload + commit_file.
     * Overwrites an existing file only when `opts.overwrite` is set.
     */
    uploadFile(parentRef: WireRef, name: string, content: Uint8Array, opts?: {
        overwrite?: boolean;
        onProgress?: (sent: number, total: number) => void;
    }): Promise<CommitResult>;
    /** URL for `GET /nfs/v1/read/{node_id}` (usable in <img>, <a download>, …). */
    readUrl(nodeId: string, opts?: {
        download?: boolean;
        name?: string;
    }): string;
    /** Reads file content; `range` is inclusive byte positions. */
    readFile(nodeId: string, opts?: {
        range?: {
            start: number;
            end?: number;
        };
        ifNoneMatch?: string;
    }): Promise<Response>;
    getMeta(target: LocatorLike, ns?: string[]): Promise<{
        records: MetaRecord[];
    }>;
    /** v1: only `ns: "user"` records are writable. */
    setMeta(target: LocatorLike, records: {
        ns: string;
        key: string;
        value: unknown;
        visibility?: string;
    }[]): Promise<{
        updated: number;
    }>;
    search(q: string, opts?: {
        limit?: number;
        cursor?: string;
        scope?: LocatorLike;
        modes?: string[];
    }, want?: WantGroup[]): Promise<SearchResult>;
    openView(viewId: string, want?: WantGroup[]): Promise<NodeInfo>;
    createCollection(title: string, collectionId?: string, want?: WantGroup[]): Promise<NodeInfo>;
    openCollection(collectionId: string, want?: WantGroup[]): Promise<NodeInfo>;
    collectionPatch(ref: WireRef, ops: CollectionPatchOp[], opts?: {
        expectedRevision?: string;
    }): Promise<{
        revision: string;
    }>;
    grant(subtree: LocatorLike, opts?: {
        ops?: string[];
        ttl?: number;
        audience?: string;
        maxUses?: number;
    }): Promise<GrantResult>;
    revoke(capId: string): Promise<{
        revoked: string;
    }>;
    /**
     * Opens the watch stream. `tokens` filters to specific containers using the
     * `watch_token` returned by list. The stream is lossy by contract: on any
     * `resync` event, re-list watched containers.
     */
    watch(opts?: {
        tokens?: string[];
        signal?: AbortSignal;
    }): AsyncIterableIterator<WatchEvent> & {
        close: () => void;
    };
    /** Read-path call: no seq. Throws NfspError on `ok:false`. */
    call(method: string, extras: EnvelopeExtras): Promise<unknown>;
    /**
     * Write-path call: assigns the next seq once and reuses it across network
     * retries so the server's replay window guarantees exactly-once.
     */
    write(method: string, extras: EnvelopeExtras, retries?: number): Promise<unknown>;
    private envelope;
    private post;
    private httpError;
}
export {};
//# sourceMappingURL=nfsp.d.ts.map