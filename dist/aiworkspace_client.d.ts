import type { kRPCClient } from './krpc_client';
export declare const AIWORKSPACE_SERVICE_NAME = "aiworkspace";
/** Business results of the AI Workspace service: `{ ok, ... }`, `{ ok: false, error }`, or a three-state commit result. */
export interface AiwsError {
    code: string;
    retryable: boolean;
    detail: string;
    sub_code?: string;
    data?: unknown;
}
export type AiwsResult<T> = (T & {
    ok: true;
}) | {
    ok: false;
    error: AiwsError;
};
export declare class AiwsFailure extends Error {
    readonly code: string;
    readonly subCode?: string;
    readonly data?: unknown;
    constructor(error: AiwsError);
}
/** A reference object (内核架构改进 D10): where, and which version. */
export interface AiwsReference {
    zone?: string;
    workspace_id?: string;
    entity_id: string;
    selector?: Record<string, unknown>;
    mode: 'live' | 'fixed';
    version?: {
        epoch: string;
        seq: number;
    } | {
        content_root: string;
        path?: string;
    };
}
/**
 * The Object URL of a Reference (buckyos doc/key url.md §6): the default
 * `obj://aiworkspace/<ws>/entities/<entity_id>` for a live reference without
 * selector; `mode=fixed`, `selector` and `version` go into the query as canonical
 * JSON, so one Reference has exactly one URL. Same rules as buckyos-api `aiws_reference_url`.
 */
export declare function aiwsReferenceUrl(reference: AiwsReference, workspaceId?: string): string;
/** The Reference an `obj://aiworkspace/<ws>/entities/<entity_id>[?...]` URL projects. */
export declare function parseAiwsReferenceUrl(url: string): AiwsReference;
export interface AiwsExtBuildParams {
    files: ({
        name: string;
        obj_id: string;
    } | {
        name: string;
        base64: string;
    })[];
    folder_id?: string;
    expect?: {
        def_rev: number;
        dir_rev: number;
    };
    force?: boolean;
    dry_run?: boolean;
    provenance?: {
        pkg_id?: string;
        version?: string;
        digest?: string;
    };
    idempotency_key?: string;
}
/** `ext.build` / `ext.import`: one entry per control (`created | rebuilt | unchanged | satisfied`), the first also at the top. */
export interface AiwsExtBuildResult {
    status: 'accepted' | 'unchanged' | 'checked';
    commit_id?: string;
    seq?: number;
    unchanged?: boolean;
    ident?: string;
    def_entity_id?: string;
    dir_entity_id?: string;
    version?: number;
    def_rev?: number;
    dir_rev?: number;
    action?: string;
    build?: {
        input_digest: string;
        builder_version: string;
        built_at: string;
    };
    controls: Record<string, unknown>[];
    diagnostics: Record<string, unknown>[];
}
export interface AiwsLibraryPackage {
    pkg_id: string;
    version: string;
    title: string;
    author: string;
    mode: string;
    installed_at: string;
    controls: {
        ident: string;
        name: string;
        kind: string;
        version: number;
        digest: string;
        dir: string;
        title?: string;
        description?: string;
        catalog?: Record<string, unknown>;
        deps?: string[];
    }[];
}
/** `ext.pack`: the `.pikg` the service wrote into the caller's `exports` bucket. */
export interface AiwsExtPackResult {
    bucket_id: string;
    key: string;
    obj_id: string;
    size: number;
    digest: string;
    app_doc_object_id: string;
    app_did: string;
    pkg_id: string;
    version: string;
    /** The bucket binding with a read token (as `doc.export`'s `download`). */
    download: {
        bucket_id: string;
        key: string;
        version: number;
        obj_id: string;
        token: string;
    };
}
/** What an executor outside the service reports for a run (M3): results in the Mock executor's shape, or an analysis. */
export interface AiwsRunReport {
    run_id: string;
    attempt: number;
    progress?: Record<string, unknown>;
    error?: {
        code: string;
        detail: string;
    };
    results?: Record<string, unknown>[];
    read_set?: Record<string, unknown>[];
    summary?: string;
    warnings?: string[];
    assumptions?: string[];
    analysis?: Record<string, unknown>;
}
/**
 * kRPC client of the AI Workspace service (`/kapi/aiworkspace`). Every method takes the business result out of
 * `result` and throws `AiwsFailure` on `{ ok: false }`; commits return the three-state result as it is.
 * Stable methods: see `src/frame/aiworkspace/README.md` (Protocol, method levels).
 */
export declare class AiWorkspaceClient {
    private rpcClient;
    constructor(rpcClient: kRPCClient);
    call<T = Record<string, unknown>>(method: string, params: Record<string, unknown>): Promise<T>;
    list(): Promise<Record<string, unknown>>;
    info(workspace_id: string): Promise<Record<string, unknown>>;
    getUserState(workspace_id: string): Promise<Record<string, unknown>>;
    setUserState(workspace_id: string, entries: Record<string, unknown>, expect?: Record<string, number>): Promise<Record<string, unknown>>;
    resolve(workspace_id: string, reference: AiwsReference | Record<string, unknown>): Promise<Record<string, unknown>>;
    resolvePath(workspace_id: string, path: string): Promise<Record<string, unknown>>;
    read(workspace_id: string, entity_id: string, selector?: Record<string, unknown>): Promise<Record<string, unknown>>;
    query(workspace_id: string, params: Record<string, unknown>): Promise<Record<string, unknown>>;
    outline(workspace_id: string): Promise<Record<string, unknown>>;
    prepare(workspace_id: string, request: Record<string, unknown>): Promise<Record<string, unknown>>;
    /** The three-state commit result (`status: accepted | conflict | rejected`), never thrown. */
    commit(workspace_id: string, request: Record<string, unknown>): Promise<Record<string, unknown>>;
    getSubmission(workspace_id: string, epoch: string, idempotency_key: string): Promise<Record<string, unknown>>;
    /** Changes after `after_seq` (`filter.detail: "touched"` for the touched entities only). */
    getChanges(workspace_id: string, epoch: string, after_seq: number, opts?: {
        limit?: number;
        touchedOnly?: boolean;
    }): Promise<Record<string, unknown>>;
    /** Long poll until the head passes `after_seq` (or `timeout_ms`). */
    waitChanges(workspace_id: string, after_seq: number, opts?: {
        epoch?: string;
        timeout_ms?: number;
    }): Promise<{
        epoch: string;
        head_seq: number;
        timed_out: boolean;
    }>;
    /** A whole-Workspace package (`.bcanvas`): `download` names it in the owner's exports bucket. */
    exportDoc(workspace_id: string, mode: 'share' | 'personal_backup', self_contained: boolean, include_notes?: boolean): Promise<Record<string, unknown>>;
    /** Register a FileObject as a staged asset: `{ bucket_id, key }` (the uploader's binding) or `{ obj_id }`. */
    assetImportObject(workspace_id: string, source: {
        bucket_id: string;
        key: string;
    } | {
        obj_id: string;
    }): Promise<{
        object_id: string;
        media_type: string;
        size: number;
    }>;
    controlsList(): Promise<Record<string, unknown>>;
    controlsDescribe(kind: string): Promise<Record<string, unknown>>;
    controlsImport(workspace_id: string, params: Record<string, unknown>): Promise<Record<string, unknown>>;
    controlsExport(workspace_id: string, entity_id: string, format?: 'markdown' | 'opml'): Promise<Record<string, unknown>>;
    /** Build one control's source files into the Workspace; `BUILD_FAILED` carries `data.diagnostics`. */
    extBuild(workspace_id: string, params: AiwsExtBuildParams): Promise<AiwsExtBuildResult>;
    /** The bundle of definitions (`purpose: pull` needs read only and synthesizes the source of never-built ones). */
    extExport(workspace_id: string, entity_ids: string[], purpose?: 'package' | 'pull'): Promise<{
        manifest: Record<string, unknown>;
        controls: Record<string, unknown>[];
        files: {
            path: string;
            obj_id?: string;
            size: number;
            text?: string;
        }[];
    }>;
    /** Into the caller's library: a `.pikg` object or one bound into the caller's `exports` bucket (consumed), or
     * definitions of a Workspace (`from` + `package`). */
    extInstall(params: {
        pikg?: {
            obj_id: string;
        } | {
            bucket_id: string;
            key: string;
        };
        from?: {
            workspace_id: string;
            entity_ids: string[];
        };
        package?: {
            name: string;
            version?: string;
            title?: string;
        };
        mode?: 'dev';
    }): Promise<{
        pkg_id: string;
        version: string;
        action: string;
        controls: Record<string, unknown>[];
    }>;
    /** Pack definitions (and what they build on) as an `aiws` `.pikg` into the caller's `exports` bucket (unsigned). */
    extPack(workspace_id: string, entity_ids: string[], pkg: {
        name: string;
        version?: string;
        title?: string;
    }): Promise<AiwsExtPackResult>;
    extListLibrary(): Promise<{
        packages: AiwsLibraryPackage[];
    }>;
    extUninstall(pkg_id: string): Promise<Record<string, unknown>>;
    /** A library package's controls with their bytes (base64): what a client relays into a Workspace of another Zone. */
    extLibraryBundle(pkg_id: string, idents?: string[]): Promise<{
        pkg_id: string;
        controls: Record<string, unknown>[];
    }>;
    /** Bring library controls into a Workspace of this Zone (one Commit). */
    extImport(workspace_id: string, items: {
        pkg_id: string;
        ident: string;
    }[], opts?: {
        folder_id?: string;
    }): Promise<AiwsExtBuildResult>;
    runStart(workspace_id: string, program: string, params: Record<string, unknown>, idempotency_key: string): Promise<Record<string, unknown>>;
    runGet(workspace_id: string, run_id: string, choices?: Record<string, unknown>): Promise<Record<string, unknown>>;
    runList(workspace_id: string, wish_id?: string, limit?: number): Promise<Record<string, unknown>>;
    runClaim(workspace_id: string, run_id: string, claim_token: string, executor?: Record<string, unknown>): Promise<{
        run_id: string;
        attempt: number;
        run_token: string;
        lease_until: string;
        lease_ms: number;
    }>;
    runHeartbeat(workspace_id: string, run_id: string, attempt: number, progress?: Record<string, unknown>): Promise<Record<string, unknown>>;
    runReport(workspace_id: string, report: AiwsRunReport): Promise<Record<string, unknown>>;
    runApply(workspace_id: string, run_id: string, plan_digest: string, session_id?: string): Promise<Record<string, unknown>>;
    runCancel(workspace_id: string, run_id: string): Promise<Record<string, unknown>>;
}
//# sourceMappingURL=aiworkspace_client.d.ts.map