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
/** What `ext.upgrade` / `ext.build` rewrite on the instances of a definition whose new version narrows what they rely
 * on (schemas/migration.schema.json, Q30). */
export interface AiwsMigration {
    config?: {
        rename?: Record<string, string>;
        drop?: string[];
        fill?: Record<string, unknown>;
    };
    bindings?: {
        rename?: Record<string, string>;
        drop?: string[];
        fill?: Record<string, {
            entity_id: string;
        }>;
    };
    slots?: {
        rename?: Record<string, string>;
        move?: Record<string, string>;
    };
    events?: {
        rename?: Record<string, string>;
        drop?: string[];
    };
}
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
    /** With `provenance`: rebuild an identity the folder holds from another source (an upgrade across Zones, Q30). */
    upgrade?: boolean;
    /** `{ <ident>: Migration }` for a build that narrows what instances rely on. */
    migration?: Record<string, AiwsMigration>;
    idempotency_key?: string;
}
export interface AiwsExtUpgradeParams {
    workspace_id: string;
    /** `pkg_id` default: the package the definition was imported from (`provenance.pkg_id`). */
    items: {
        def_entity_id: string;
        pkg_id?: string;
    }[];
    migration?: Record<string, AiwsMigration>;
    force?: boolean;
    dry_run?: boolean;
    idempotency_key?: string;
}
export interface AiwsExtUpgradeResult {
    status: 'accepted' | 'unchanged' | 'checked';
    commit_id?: string;
    seq?: number;
    controls: {
        ident: string;
        def_entity_id: string;
        action: 'upgraded' | 'unchanged';
        from?: string;
        to?: string;
        migrated?: string[];
    }[];
    /** `dry_run`: what the migration writes on each instance. */
    plan?: {
        instance: string;
        ops: Record<string, unknown>[];
    }[];
}
export interface AiwsTemplateParam {
    type: 'string' | 'number' | 'boolean';
    title?: string;
    default?: string | number | boolean;
}
/** A Workspace template of a control package (aiws-manifest.json `workspace_templates`, schemas/template.schema.json,
 * Q32): a snapshot under `templates/<id>/` and the controls of the same package it needs. */
export interface AiwsTemplateItem {
    id: string;
    title: string;
    description?: string;
    snapshot: string;
    digest: string;
    requires: {
        host_api?: {
            html?: number;
            declarative?: number;
        };
        controls: string[];
    };
    params?: Record<string, AiwsTemplateParam>;
    reset?: {
        tables?: string[];
    };
}
/** One template to export (`ext.export_template`, `ext.pack` / `ext.install` `templates`): chosen Surfaces (and data
 * entities) of the Workspace. */
export interface AiwsTemplateExport {
    surfaces: string[];
    data?: string[];
    template: {
        id: string;
        title: string;
        description?: string;
        params?: Record<string, AiwsTemplateParam>;
        reset?: {
            tables: string[];
        };
    };
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
    /** The package's manifest_version is above what the service reads: listed, not importable. */
    needs_newer?: boolean;
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
    templates?: {
        id: string;
        title: string;
        description?: string;
        params?: Record<string, AiwsTemplateParam>;
        requires: AiwsTemplateItem['requires'];
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
/** One request of `doc.stage` / `doc.commit` stays under the service's 8 MiB body limit. */
export declare const AIWS_COMMIT_PART_BYTES: number;
/** What one Commit may hold once its parts are assembled (aiworkspace-core `Limits`). */
export declare const AIWS_COMMIT_MAX_BYTES: number;
export declare const AIWS_COMMIT_MAX_OPERATIONS = 50000;
export type AiwsCall = (method: string, params: Record<string, unknown>) => Promise<unknown>;
export interface AiwsCommitPartsOptions {
    /** Largest serialized size of the operations of one request (default `AIWS_COMMIT_PART_BYTES`). */
    partBytes?: number;
    /** Called before request `part` of `total` is sent (1-based; the last one is the commit itself). Only when
     * the Commit is sent in more than one request. */
    onPart?: (part: number, total: number) => void;
    /** `doc.prepare` instead of `doc.commit` (the parts it stages expire on their own). */
    method?: 'doc.commit' | 'doc.prepare';
}
/** `operations` cut into runs of at most `partBytes` serialized bytes, in order; an operation larger than that
 * is a run of its own. */
export declare function splitCommitOperations<T>(operations: T[], partBytes?: number): T[][];
/** Whether a Commit of these operations is within what the service assembles (`null`), or which limit it passes. */
export declare function commitOverLimit(operations: unknown[]): {
    limit: 'operations' | 'bytes';
    value: number;
    max: number;
} | null;
/**
 * Send one Commit, whatever its size: a request whose operations fit `partBytes` is one `doc.commit`; a larger one
 * has its leading parts held by `doc.stage` and the last part sent as `doc.commit { staged: [digests] }`, which the
 * service assembles into the same single Commit (one transaction, one undo unit). Every call stages all parts again,
 * so resending the same request after an unknown result is safe. The three-state result is returned as it is; a
 * refused `doc.stage` comes back as a `rejected` result.
 */
export declare function commitWithParts<T = Record<string, unknown>>(call: AiwsCall, request: Record<string, unknown>, options?: AiwsCommitPartsOptions): Promise<T>;
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
    private raw;
    prepare(workspace_id: string, request: Record<string, unknown>): Promise<Record<string, unknown>>;
    /** The three-state commit result (`status: accepted | conflict | rejected`), never thrown. One call per Commit
     * whatever its size (up to `AIWS_COMMIT_MAX_BYTES` / `AIWS_COMMIT_MAX_OPERATIONS`): a large one is sent in parts. */
    commit(workspace_id: string, request: Record<string, unknown>, options?: Pick<AiwsCommitPartsOptions, 'partBytes' | 'onPart'>): Promise<Record<string, unknown>>;
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
            templates?: AiwsTemplateExport[];
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
    /** Pack definitions (and what they build on, and templates of the Workspace) as an `aiws` `.pikg` into the caller's
     * `exports` bucket (unsigned). */
    extPack(workspace_id: string, entity_ids: string[], pkg: {
        name: string;
        version?: string;
        title?: string;
    }, templates?: AiwsTemplateExport[]): Promise<AiwsExtPackResult>;
    /** Rebuild imported definitions from the caller's library (same Zone; across Zones `ext.build { provenance, upgrade }`):
     * `EXT_LOCAL_CHANGES` when the snapshot was built locally since, unless `force`. */
    extUpgrade(params: AiwsExtUpgradeParams): Promise<AiwsExtUpgradeResult>;
    /** Chosen Surfaces as a template snapshot: the manifest item, the definitions it needs and the files (base64) of
     * `templates/<id>/`. */
    extExportTemplate(params: {
        workspace_id: string;
    } & AiwsTemplateExport): Promise<{
        template: AiwsTemplateItem;
        controls: Record<string, unknown>[];
        files: {
            path: string;
            base64: string;
        }[];
    }>;
    /** A new Workspace from a template of the caller's library (installing a template never creates one). */
    extCreateFromTemplate(params: {
        pkg_id: string;
        template_id: string;
        title?: string;
        params?: Record<string, string | number | boolean>;
    }): Promise<{
        workspace_id: string;
    }>;
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