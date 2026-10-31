/**
 * AI Workspace extension controls (buckyos src/frame/aiworkspace/README.md “Extension controls”), shared by the
 * Desktop and the CLI: a control's source lives in a home folder of the Zone file service (files may sit in
 * sub-folders: their names are relative paths, Q23); `build` lists it over NFSP and hands each file's object to
 * `ext.build`, `pull` writes a Workspace snapshot back, `watch` rebuilds on change; bundles (the AIWS manifest plus
 * `controls/<dir>/<path>`) are what exports, packages and the library carry.
 * Runs in browsers and Deno (fetch, crypto.subtle); no dependencies.
 */
import type { AiWorkspaceClient } from './aiworkspace_client';
import type { NfspClient, WireRef } from './nfsp';
/** The two service calls these drivers make (an `AiWorkspaceClient`, or a host's own session with the same shape). */
export type AiwsExtRpc = Pick<AiWorkspaceClient, 'extBuild' | 'extExport'>;
/** Puts bytes into the Zone's named store as a FileObject the caller may read and answers its `cyfile:` id (the
 * Desktop's asset upload, the CLI's NDM upload): what a build sends by reference when inline bytes would exceed the
 * service's limit (Q22). */
export type AiwsUploader = (name: string, bytes: Uint8Array) => Promise<string>;
export declare const AIWS_COMPONENT_FILE = "component.json";
/** The entry of a composite control (P1). */
export declare const AIWS_COMPOSITION_FILE = "composition.json";
export declare const AIWS_MANIFEST_FILE = "aiws-manifest.json";
/** A client's own record of the base it last built or pulled (never part of the source snapshot: dot files are not). */
export declare const AIWS_BUILD_STATE_FILE = ".aiws-build.json";
/** The newest component.json / AIWS manifest version this module reads (older ones stay readable, Q19). Version 2
 * adds `kind: composite` and non-empty `deps`. */
export declare const AIWS_MANIFEST_VERSION = 2;
/** The HTML Block host API (`window.aiws` v2) and the declarative interpreter version. */
export declare const AIWS_HTML_API_VERSION = 2;
export declare const AIWS_DECLARATIVE_API_VERSION = 1;
export declare const AIWS_MAX_SOURCE_FILES = 64;
/**
 * One file of a source folder. `obj_id` is set when the file service holds it as a named-store FileObject (`cyfile:`):
 * the service then reads it by reference. Files of a native home folder have none (their `obj_id`, when the file
 * service reports one, is a `sha256:` content hash the service cannot fetch): their bytes travel with the build.
 */
export interface AiwsSourceFile {
    name: string;
    obj_id?: string;
    node_id?: string;
    etag?: string;
    size?: number;
}
export interface AiwsDiagnostic {
    file: string;
    line?: number;
    col?: number;
    severity: 'error' | 'warning';
    message: string;
    /** `DEP_MISSING`: a `deps` entry or a slot's `cell:<ident>` names no definition of the Workspace. */
    code?: string;
    /** Blocks whose contract a rebuild would break. */
    instances?: {
        entity_id: string;
        title?: string | null;
    }[];
    /** Definitions that build on the one a rebuild would narrow. */
    dependents?: {
        ident: string;
        def_entity_id: string;
    }[];
}
export interface AiwsBuildState {
    workspace_id: string;
    def_entity_id: string;
    def_rev: number;
    dir_rev: number;
    ident?: string;
    at?: string;
}
export interface AiwsManifestControl {
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
}
export interface AiwsManifest {
    manifest_version: number;
    purpose: 'aiws';
    host_api?: Record<string, number>;
    controls: AiwsManifestControl[];
    workspace_templates: unknown[];
}
export interface AiwsBundle {
    manifest: AiwsManifest;
    files: Map<string, Uint8Array>;
}
/** A source directory that cannot be built as it is (not a service refusal: `diagnostics` say why). */
export declare class AiwsSourceError extends Error {
    readonly diagnostics: AiwsDiagnostic[];
    constructor(diagnostics: AiwsDiagnostic[]);
}
export declare function joinPath(dir: string, name: string): string;
/** A Workspace title as one folder name (no `/`, no leading dot). */
export declare function folderName(title: string): string;
/** The suggested home folder of a control (README: a suggestion; the definition never stores it). */
export declare function homeControlDir(owner: string, workspaceTitle: string, name: string): string;
/** Where a client writes an export bundle before packing it. */
export declare function homeExportDir(owner: string, pkg: string): string;
/** `user_state` key under which each person remembers the home folder of a definition. */
export declare function sourceStateKey(defEntityId: string): string;
/** `sha256:` over `[[name, sha256 hex of its bytes], …]` sorted by name: a control's content digest. */
export declare function aiwsContentDigest(files: Iterable<[string, Uint8Array]>): Promise<string>;
/** What a set of sources is, for "nothing changed since the last build" (names, objects or versions). */
export declare function sourcesKey(files: AiwsSourceFile[]): string;
/** Bytes a single build may carry inline (the service's limit). */
export declare const AIWS_MAX_INLINE_BYTES: number;
export type AiwsBuildFile = {
    name: string;
    obj_id: string;
} | {
    name: string;
    base64: string;
};
/**
 * The `files` of `ext.build` from bytes the client holds: inline while the total stays within the service's limit;
 * beyond it, the largest files go to the named store through `upload` and are sent by reference (Q22) — without an
 * uploader the build is refused. `byRef` are files already held as FileObjects.
 */
export declare function packBuildFiles(files: {
    name: string;
    bytes: Uint8Array;
}[], upload?: AiwsUploader, byRef?: {
    name: string;
    obj_id: string;
}[]): Promise<AiwsBuildFile[]>;
/** The `files` of `ext.build`: FileObjects by reference, everything else read over the file service and sent inline
 * (or, past the inline limit, uploaded through `upload`). */
export declare function buildFiles(nfsp: NfspClient, files: AiwsSourceFile[], upload?: AiwsUploader): Promise<AiwsBuildFile[]>;
/** A file name of a source folder: a relative path whose parts are non-empty and do not start with `.` (Q23). */
export declare function isSourcePath(name: string): boolean;
/** A composite's `composition.json` (K3): what the slots accept and their counts, the layout and the Chrome. */
export interface AiwsComposition {
    layout: {
        algorithm: 'stack' | 'fixed';
        direction?: 'column' | 'row';
        spacing?: number | string;
        padding?: number | string | {
            t?: number;
            r?: number;
            b?: number;
            l?: number;
        };
    };
    slots: Record<string, {
        accepts?: string[];
        min?: number;
        max?: number;
        placement?: 'stack' | 'top' | 'bottom' | 'free';
        title?: string;
    }>;
    chrome?: {
        background?: string;
        radius?: number | string;
        border?: string;
        title?: {
            text: string;
            slot?: string;
        };
        empty?: string;
    };
}
/**
 * Check a `composition.json` the way `ext.build` does (store/src/ext.rs `check_composition`): `layout` is `stack` or
 * `fixed`, at most 16 slots named `[a-z][a-z0-9_]{0,31}` accepting `cell:<ident>`, a view type or `container`, the
 * Chrome's strings, and `{{config.<key>}}` naming properties of `config_schema`. `events` is refused (P2).
 */
export declare function checkComposition(text: string, configSchema?: unknown, file?: string): AiwsDiagnostic[];
/**
 * Check a `component.json` text against the files of its directory (and, for a composite, its composition when
 * `readText` gives the entry's text). Errors make a build fail; warnings do not.
 */
export declare function checkComponent(text: string, fileNames: string[], readText?: (name: string) => string | undefined): AiwsDiagnostic[];
/** The identities a composition's slots accept as `cell:<ident>`. */
export declare function slotCells(composition: AiwsComposition): string[];
/** Read an AIWS manifest of any supported version as the current one (Q19); a newer one is refused. */
export declare function compatManifest(value: unknown): AiwsManifest;
/** Verify a bundle the way an installer does: manifest, each control's digest and component.json, no stray files. */
export declare function verifyBundle(files: Map<string, Uint8Array>): Promise<{
    manifest: AiwsManifest;
    diagnostics: AiwsDiagnostic[];
}>;
/** The bundle of Workspace definitions (`ext.export`): the manifest plus every file's bytes. */
export declare function exportBundle(client: AiwsExtRpc, workspaceId: string, entityIds: string[], fetchAsset: (workspaceId: string, objId: string) => Promise<Uint8Array>): Promise<AiwsBundle & {
    controls: Record<string, unknown>[];
}>;
/** Make sure a folder exists, creating each missing level below the realm root (`/home`); answers its ref. Levels
 * are looked up by listing their parent, so a missing one is not a failed request. */
export declare function ensureFolder(nfsp: NfspClient, path: string): Promise<WireRef>;
/** A folder's ref, or null when it (or a level above it) does not exist — found without failed requests. */
export declare function findFolder(nfsp: NfspClient, path: string): Promise<WireRef | null>;
/** Whether a folder holds a control source (its component.json). */
export declare function hasControlSource(nfsp: NfspClient, dir: string): Promise<boolean>;
/** Write one file into a folder (replacing it). */
export declare function writeHomeFile(nfsp: NfspClient, dir: string | WireRef, name: string, bytes: Uint8Array): Promise<void>;
/** The files of a control's source folder, sub-folders included (names are relative paths, Q23); dot files and dot
 * folders are the client's own and skipped. */
export declare function collectSources(nfsp: NfspClient, dir: string): Promise<AiwsSourceFile[]>;
/** Write a source file whose name may be a relative path (its sub-folders are created). */
export declare function writeSourceFile(nfsp: NfspClient, dir: string, name: string, bytes: Uint8Array): Promise<void>;
/** The content digest of a home folder's sources (what `ext.export` answers as a control's `digest`). */
export declare function sourcesDigest(nfsp: NfspClient, files: AiwsSourceFile[]): Promise<string>;
/**
 * Does the home folder of a definition hold changes that were not built (P0 遗留 L3)? Compares its sources with the
 * Workspace snapshot (`ext.export { purpose: pull }`). `null` when the folder holds no control.
 */
export declare function unbuiltChanges(client: AiwsExtRpc, nfsp: NfspClient, workspaceId: string, defEntityId: string, dir: string): Promise<{
    changed: boolean;
    home: string;
    built: string;
} | null>;
export declare function readBuildState(nfsp: NfspClient, dir: string): Promise<AiwsBuildState | null>;
export declare function writeBuildState(nfsp: NfspClient, dir: string, state: AiwsBuildState): Promise<void>;
export interface AiwsBuildOptions {
    folderId?: string;
    force?: boolean;
    dryRun?: boolean;
    upload?: AiwsUploader;
}
/**
 * Build the control in `dir` into a Workspace: collect the files, call `ext.build` with the base recorded in
 * `.aiws-build.json` (when it is this Workspace's), and record the new base. Service refusals throw `AiwsFailure`
 * (`BUILD_FAILED` carries `data.diagnostics`); source problems throw `AiwsSourceError`.
 */
export declare function buildControl(client: AiwsExtRpc, nfsp: NfspClient, workspaceId: string, dir: string, opts?: AiwsBuildOptions): Promise<Record<string, unknown> & {
    files: AiwsSourceFile[];
}>;
/**
 * Write a definition's Workspace snapshot into `outDir` (a definition never built from source gets synthesized
 * files) and record it as the base of the next build.
 */
export declare function pullControl(client: AiwsExtRpc, nfsp: NfspClient, workspaceId: string, defEntityId: string, outDir: string, fetchAsset: (workspaceId: string, objId: string) => Promise<Uint8Array>): Promise<{
    files: string[];
    state: AiwsBuildState;
}>;
/**
 * Rebuild whenever the folder changes: NFSP watch events (lossy: a `resync` lists again), debounced, and only when
 * the files' objects differ from the last build. Returns when `signal` aborts.
 */
export declare function watchControl(nfsp: NfspClient, dir: string, onChange: (files: AiwsSourceFile[]) => Promise<void>, opts?: {
    debounceMs?: number;
    signal?: AbortSignal;
}): Promise<void>;
export interface AiwsSkeletonOptions {
    authorDid: string;
    name: string;
    title?: string;
    kind?: 'declarative' | 'html' | 'composite';
    /** A composite's slots (default: one `items` slot taking any Block) and what it builds on. */
    slots?: AiwsComposition['slots'];
    deps?: string[];
    algorithm?: 'stack' | 'fixed';
}
/** The files of a new control: a minimal working declarative or HTML control with one optional binding, or a composite
 * that stacks (or keeps in place) the Blocks of its slots under a titled frame. */
export declare function controlSkeleton(opts: AiwsSkeletonOptions): Record<string, string>;
/** Create a control's source folder from a skeleton (refuses to overwrite a folder that has a component.json). */
export declare function createControlSource(nfsp: NfspClient, dir: string, files: Record<string, string>): Promise<WireRef>;
//# sourceMappingURL=aiws_ext.d.ts.map