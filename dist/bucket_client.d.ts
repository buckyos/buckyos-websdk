import type { kRPCClient } from './krpc_client';
export declare const BUCKET_SERVICE_NAME = "nfs-server";
export declare const BUCKET_DATA_PATH = "/bucket/v1/";
/** Largest single-request PUT; bigger files go through `ndm.startUpload({ bind })`. */
export declare const BUCKET_MAX_PUT_BYTES: number;
export type BucketKind = 'data' | 'object';
export type DataPolicy = 'documents' | 'app_data' | 'collected' | 'ambient' | 'temp' | 'cache';
export type BucketScope = 'user' | 'zone';
export type BucketAction = 'list' | 'read' | 'create' | 'write' | 'delete' | 'manage';
export type Availability = 'local' | 'evicted' | 'remote';
export type LifecycleRule = {
    rule: 'expire';
    prefix?: string;
    days: number;
} | {
    rule: 'noncurrent_expire';
    days: number;
} | {
    rule: 'expired_delete_marker';
};
/** `install_config.buckets.<name>`. */
export interface BucketDecl {
    kind: BucketKind;
    data_policy: DataPolicy;
    scope?: BucketScope;
    versioning?: boolean;
    quota_mib?: number;
    max_objects?: number;
    default_ttl_days?: number;
    lifecycle?: LifecycleRule[];
}
export interface BucketInfo {
    bucket_id: string;
    kind: BucketKind;
    data_policy: DataPolicy;
    scope: BucketScope;
    appid: string;
    owner: string;
    name: string;
    versioning: boolean;
    quota_bytes?: number;
    max_objects?: number;
    default_ttl_secs?: number;
    lifecycle?: LifecycleRule[];
    unique_bytes: number;
    key_bytes: number;
    key_count: number;
    version_count: number;
    snapshot_only_bytes: number;
    orphaned_at?: number;
    created_at: number;
}
export interface Origin {
    author: string;
    source: string;
    collected_at: number;
    proof?: string;
}
export interface Binding {
    bucket_id: string;
    key: string;
    version: number;
    is_current: boolean;
    is_delete_marker?: boolean;
    obj_id?: string;
    obj_type?: string;
    size: number;
    etag: string;
    etag_md5?: string;
    content_type?: string;
    metadata?: Record<string, string>;
    tags?: Record<string, string>;
    http_headers?: Record<string, string>;
    expires_at?: number;
    origin?: Origin;
    last_access_at?: number;
    created_at: number;
    created_by: string;
}
export interface Conditions {
    if_none_match?: string;
    if_match?: string;
    if_version?: number;
}
export interface PutRequest extends Conditions {
    key: string;
    obj_id: string;
    content_type?: string;
    metadata?: Record<string, string>;
    tags?: Record<string, string>;
    http_headers?: Record<string, string>;
    expires_at?: number;
    origin?: Origin;
}
export interface PutResult {
    version: number;
    etag: string;
    created: boolean;
}
export interface DeleteResult {
    deleted: boolean;
    version?: number;
    delete_marker?: boolean;
}
export interface ListRequest {
    prefix?: string;
    delimiter?: string;
    start_after?: string;
    limit?: number;
}
export interface ListResult {
    items: Binding[];
    common_prefixes: string[];
    next_start_after?: string;
}
export interface CopyRequest extends Conditions {
    src_bucket_id: string;
    src_key: string;
    src_version?: number;
    dst_bucket_id: string;
    dst_key: string;
    metadata_directive?: 'copy' | 'replace';
    content_type?: string;
    metadata?: Record<string, string>;
    tags?: Record<string, string>;
    origin?: Origin;
}
export type BatchOp = ({
    op: 'put';
} & PutRequest) | {
    op: 'delete';
    key: string;
    version?: number;
    if_match?: string;
};
export type BatchResult = ({
    op: 'put';
} & PutResult) | ({
    op: 'delete';
} & DeleteResult);
export interface Grantee {
    kind: 'app' | 'user' | 'group' | 'zone_users' | 'agent';
    id?: string;
}
export interface GrantRequest {
    grantee: Grantee;
    prefix?: string;
    actions: BucketAction[];
    expires_at?: number;
}
export interface Grant extends GrantRequest {
    grant_id: string;
    bucket_id: string;
    granted_by: string;
    created_at: number;
}
export interface TokenRequest {
    key?: string;
    prefix?: string;
    actions: BucketAction[];
    expires_at: number;
    max_uses?: number;
    bind_user_id?: string;
    bind_app_id?: string;
}
export interface IssuedToken {
    token_id: string;
    token: string;
    path: string;
    expires_at: number;
}
export interface AccessCheck {
    allowed: boolean;
    via?: {
        kind: 'identity';
    } | {
        kind: 'grant';
        id: string;
    } | {
        kind: 'token';
        id: string;
    };
}
export interface QuotaUpdate {
    max_bytes?: number;
    soft_bytes?: number;
    max_objects?: number;
    max_object_bytes?: number;
    warn_percent?: number[];
}
export interface SnapshotInfo {
    snapshot_id: string;
    bucket_id: string;
    label?: string;
    root_obj_id: string;
    manifest_obj_id: string;
    tree_obj_id: string;
    key_count: number;
    unique_bytes: number;
    snapshot_only_bytes: number;
    created_at: number;
    created_by: string;
}
export type Reference = {
    key: string;
    version?: number;
} | {
    obj_id: string;
};
/** An S3 access key of the S3 compatible face (`https://<zone>/s3` or `https://s3.<zone>`), bound to (user, app). */
export interface S3Key {
    access_key_id: string;
    /** Only in the result of `createS3Key`. */
    secret?: string;
    user_id: string;
    appid: string;
    scope?: {
        buckets?: string[];
        prefix?: string;
        actions?: BucketAction[];
    };
    expires_at?: number;
    revoked_at?: number;
    created_at: number;
}
export interface BucketPutOptions extends Conditions {
    contentType?: string;
    metadata?: Record<string, string>;
    tags?: Record<string, string>;
    /** Deletion time (ms since epoch); HTTP `Expires` stays a caching header. */
    expiresAt?: number;
    origin?: Origin;
}
export interface BucketClientOptions {
    /** Origin + path prefix of the data plane, e.g. `https://zone.example` or `''` for same origin. */
    dataPlaneBase: string;
    sessionTokenProvider?: () => Promise<string | null>;
    fetcher?: typeof fetch;
}
export declare class BucketError extends Error {
    readonly code: string;
    readonly status?: number | undefined;
    readonly data?: unknown;
    constructor(code: string, message: string, status?: number | undefined, data?: unknown);
}
/** Derives the data-plane base from a service kRPC URL (`…/kapi/nfs-server`). */
export declare function bucketDataPlaneBase(serviceUrl: string): string;
export declare function bucketObjectPath(bucketId: string, key: string): string;
/** kRPC client of the bucket service plus the `/bucket/v1` data plane. */
export declare class BucketClient {
    private rpcClient;
    private options;
    constructor(rpcClient: kRPCClient, options?: BucketClientOptions);
    call<T>(method: string, params: Record<string, unknown>): Promise<T>;
    list(filter?: {
        scope?: BucketScope;
        appid?: string;
    }): Promise<BucketInfo[]>;
    stat(bucketId: string): Promise<BucketInfo & {
        issues: unknown[];
    }>;
    put(bucketId: string, req: PutRequest): Promise<PutResult>;
    get(bucketId: string, key: string, version?: number): Promise<Binding>;
    head(bucketId: string, key: string, version?: number): Promise<{
        binding: Binding;
        availability: Availability;
    }>;
    delete(bucketId: string, key: string, options?: {
        version?: number;
        ifMatch?: string;
    }): Promise<DeleteResult>;
    listObjects(bucketId: string, req?: ListRequest): Promise<ListResult>;
    listVersions(bucketId: string, key: string): Promise<Binding[]>;
    copy(req: CopyRequest): Promise<PutResult>;
    batch(bucketId: string, ops: BatchOp[]): Promise<BatchResult[]>;
    setMetadata(bucketId: string, key: string, update: {
        content_type?: string;
        metadata?: Record<string, string>;
        tags?: Record<string, string>;
    }): Promise<Binding>;
    grant(bucketId: string, req: GrantRequest): Promise<Grant>;
    revoke(grantId: string): Promise<{
        revoked: boolean;
    }>;
    listGrants(bucketId: string): Promise<Grant[]>;
    createAccessToken(bucketId: string, req: TokenRequest): Promise<IssuedToken>;
    revokeAccessToken(tokenId: string): Promise<{
        revoked: boolean;
    }>;
    listAccessTokens(bucketId: string): Promise<Record<string, unknown>[]>;
    checkAccess(bucketId: string, action: BucketAction, target?: {
        key?: string;
        prefix?: string;
    }): Promise<AccessCheck>;
    getQuota(bucketId: string): Promise<Record<string, unknown>>;
    setQuota(bucketId: string, update: QuotaUpdate): Promise<Record<string, unknown>>;
    getPoolQuota(kind: 'user' | 'app', id: string): Promise<Record<string, unknown>>;
    usageReport(kind: 'user' | 'app' | 'zone', id?: string, days?: number): Promise<Record<string, unknown>>;
    getLifecycle(bucketId: string): Promise<LifecycleRule[]>;
    setLifecycle(bucketId: string, rules: LifecycleRule[]): Promise<LifecycleRule[]>;
    snapshot(bucketId: string, options?: {
        label?: string;
        includeNoncurrent?: boolean;
    }): Promise<SnapshotInfo>;
    listSnapshots(bucketId: string): Promise<SnapshotInfo[]>;
    deleteSnapshot(bucketId: string, snapshotId: string): Promise<{
        deleted: boolean;
    }>;
    restoreFromSnapshot(bucketId: string, rootObjId: string): Promise<{
        restored: number;
        missing: unknown[];
    }>;
    exportSnapshot(bucketId: string, snapshotId: string, target: string): Promise<{
        target: string;
    }>;
    verifyReferences(bucketId: string, refs: Reference[]): Promise<Reference[]>;
    /** Issues an S3 access key for the signed-in user and `appid` (the user's own session only). */
    createS3Key(appid: string, options?: {
        scope?: S3Key['scope'];
        expiresAt?: number;
    }): Promise<S3Key>;
    listS3Keys(): Promise<S3Key[]>;
    revokeS3Key(accessKeyId: string): Promise<{
        revoked: boolean;
    }>;
    /** URL of a key on the data plane; same-origin browser pages read it with the SSO cookie. */
    objectUrl(bucketId: string, key: string, options?: {
        version?: number;
        token?: string;
    }): string;
    private authHeaders;
    /** `PUT /bucket/v1/...`: stores up to 32 MiB and binds it; success means it is retained. */
    putBytes(bucketId: string, key: string, body: Blob | ArrayBuffer | Uint8Array | string, options?: BucketPutOptions): Promise<PutResult & {
        obj_id: string;
    }>;
    /** Reads a key's content (a `Response` to stream or `.blob()`). */
    fetchObject(bucketId: string, key: string, options?: {
        version?: number;
        token?: string;
        range?: string;
    }): Promise<Response>;
    private json;
}
//# sourceMappingURL=bucket_client.d.ts.map