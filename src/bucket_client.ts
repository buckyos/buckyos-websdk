import type { kRPCClient } from './krpc_client'

// Application object buckets (BuckyOS doc/arch/应用对象桶 Bucket 设计.md).
// Mirrors ../../buckyos/src/kernel/buckyos-api/src/bucket_client.rs; the model
// lives in cyfs-ndn `bucket_store`, nfs-server hosts kRPC `bucket.*` and the
// data plane `/bucket/v1/<bucket_id>/<key>`.

export const BUCKET_SERVICE_NAME = 'nfs-server'
export const BUCKET_DATA_PATH = '/bucket/v1/'
/** Largest single-request PUT; bigger files go through `ndm.startUpload({ bind })`. */
export const BUCKET_MAX_PUT_BYTES = 32 * 1024 * 1024

export type BucketKind = 'data' | 'object'
export type DataPolicy = 'documents' | 'app_data' | 'collected' | 'ambient' | 'temp' | 'cache'
export type BucketScope = 'user' | 'zone'
export type BucketAction = 'list' | 'read' | 'create' | 'write' | 'delete' | 'manage'
export type Availability = 'local' | 'evicted' | 'remote'

export type LifecycleRule =
  | { rule: 'expire'; prefix?: string; days: number }
  | { rule: 'noncurrent_expire'; days: number }
  | { rule: 'expired_delete_marker' }

/** `install_config.buckets.<name>`. */
export interface BucketDecl {
  kind: BucketKind
  data_policy: DataPolicy
  scope?: BucketScope
  versioning?: boolean
  quota_mib?: number
  max_objects?: number
  default_ttl_days?: number
  lifecycle?: LifecycleRule[]
}

export interface BucketInfo {
  bucket_id: string
  kind: BucketKind
  data_policy: DataPolicy
  scope: BucketScope
  appid: string
  owner: string
  name: string
  versioning: boolean
  quota_bytes?: number
  max_objects?: number
  default_ttl_secs?: number
  lifecycle?: LifecycleRule[]
  unique_bytes: number
  key_bytes: number
  key_count: number
  version_count: number
  snapshot_only_bytes: number
  orphaned_at?: number
  created_at: number
}

export interface Origin {
  author: string
  source: string
  collected_at: number
  proof?: string
}

export interface Binding {
  bucket_id: string
  key: string
  version: number
  is_current: boolean
  is_delete_marker?: boolean
  obj_id?: string
  obj_type?: string
  size: number
  etag: string
  etag_md5?: string
  content_type?: string
  metadata?: Record<string, string>
  tags?: Record<string, string>
  http_headers?: Record<string, string>
  expires_at?: number
  origin?: Origin
  last_access_at?: number
  created_at: number
  created_by: string
}

export interface Conditions {
  if_none_match?: string
  if_match?: string
  if_version?: number
}

export interface PutRequest extends Conditions {
  key: string
  obj_id: string
  content_type?: string
  metadata?: Record<string, string>
  tags?: Record<string, string>
  http_headers?: Record<string, string>
  expires_at?: number
  origin?: Origin
}

export interface PutResult {
  version: number
  etag: string
  created: boolean
}

export interface DeleteResult {
  deleted: boolean
  version?: number
  delete_marker?: boolean
}

export interface ListRequest {
  prefix?: string
  delimiter?: string
  start_after?: string
  limit?: number
}

export interface ListResult {
  items: Binding[]
  common_prefixes: string[]
  next_start_after?: string
}

export interface CopyRequest extends Conditions {
  src_bucket_id: string
  src_key: string
  src_version?: number
  dst_bucket_id: string
  dst_key: string
  metadata_directive?: 'copy' | 'replace'
  content_type?: string
  metadata?: Record<string, string>
  tags?: Record<string, string>
  origin?: Origin
}

export type BatchOp =
  | ({ op: 'put' } & PutRequest)
  | { op: 'delete'; key: string; version?: number; if_match?: string }

export type BatchResult = ({ op: 'put' } & PutResult) | ({ op: 'delete' } & DeleteResult)

export interface Grantee {
  kind: 'app' | 'user' | 'group' | 'zone_users' | 'agent'
  id?: string
}

export interface GrantRequest {
  grantee: Grantee
  prefix?: string
  actions: BucketAction[]
  expires_at?: number
}

export interface Grant extends GrantRequest {
  grant_id: string
  bucket_id: string
  granted_by: string
  created_at: number
}

export interface TokenRequest {
  key?: string
  prefix?: string
  actions: BucketAction[]
  expires_at: number
  max_uses?: number
  bind_user_id?: string
  bind_app_id?: string
}

export interface IssuedToken {
  token_id: string
  token: string
  path: string
  expires_at: number
}

export interface AccessCheck {
  allowed: boolean
  via?: { kind: 'identity' } | { kind: 'grant'; id: string } | { kind: 'token'; id: string }
}

export interface QuotaUpdate {
  max_bytes?: number
  soft_bytes?: number
  max_objects?: number
  max_object_bytes?: number
  warn_percent?: number[]
}

export interface SnapshotInfo {
  snapshot_id: string
  bucket_id: string
  label?: string
  root_obj_id: string
  manifest_obj_id: string
  tree_obj_id: string
  key_count: number
  unique_bytes: number
  snapshot_only_bytes: number
  created_at: number
  created_by: string
}

export type Reference = { key: string; version?: number } | { obj_id: string }

/** An S3 access key of the S3 compatible face (`https://<zone>/s3` or `https://s3.<zone>`), bound to (user, app). */
export interface S3Key {
  access_key_id: string
  /** Only in the result of `createS3Key`. */
  secret?: string
  user_id: string
  appid: string
  scope?: { buckets?: string[]; prefix?: string; actions?: BucketAction[] }
  expires_at?: number
  revoked_at?: number
  created_at: number
}

export interface BucketPutOptions extends Conditions {
  contentType?: string
  metadata?: Record<string, string>
  tags?: Record<string, string>
  /** Deletion time (ms since epoch); HTTP `Expires` stays a caching header. */
  expiresAt?: number
  origin?: Origin
}

export interface BucketClientOptions {
  /** Origin + path prefix of the data plane, e.g. `https://zone.example` or `''` for same origin. */
  dataPlaneBase: string
  sessionTokenProvider?: () => Promise<string | null>
  fetcher?: typeof fetch
}

export class BucketError extends Error {
  constructor(readonly code: string, message: string, readonly status?: number, readonly data?: unknown) {
    super(message)
    this.name = 'BucketError'
  }
}

/** Derives the data-plane base from a service kRPC URL (`…/kapi/nfs-server`). */
export function bucketDataPlaneBase(serviceUrl: string): string {
  const at = serviceUrl.indexOf('/kapi/')
  return at >= 0 ? serviceUrl.slice(0, at) : ''
}

export function bucketObjectPath(bucketId: string, key: string): string {
  return `${BUCKET_DATA_PATH}${bucketId}/${key.split('/').map(encodeURIComponent).join('/')}`
}

/** kRPC client of the bucket service plus the `/bucket/v1` data plane. */
export class BucketClient {
  constructor(private rpcClient: kRPCClient, private options: BucketClientOptions = { dataPlaneBase: '' }) {}

  call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    return this.rpcClient.call<T, Record<string, unknown>>(method, params)
  }

  list(filter: { scope?: BucketScope; appid?: string } = {}): Promise<BucketInfo[]> {
    return this.call('bucket.list', { ...filter })
  }

  stat(bucketId: string): Promise<BucketInfo & { issues: unknown[] }> {
    return this.call('bucket.stat', { bucket_id: bucketId })
  }

  put(bucketId: string, req: PutRequest): Promise<PutResult> {
    return this.call('bucket.put', { bucket_id: bucketId, ...req })
  }

  get(bucketId: string, key: string, version?: number): Promise<Binding> {
    return this.call('bucket.get', { bucket_id: bucketId, key, version })
  }

  head(bucketId: string, key: string, version?: number): Promise<{ binding: Binding; availability: Availability }> {
    return this.call('bucket.head', { bucket_id: bucketId, key, version })
  }

  delete(bucketId: string, key: string, options: { version?: number; ifMatch?: string } = {}): Promise<DeleteResult> {
    return this.call('bucket.delete', { bucket_id: bucketId, key, version: options.version, if_match: options.ifMatch })
  }

  listObjects(bucketId: string, req: ListRequest = {}): Promise<ListResult> {
    return this.call('bucket.list_objects', { bucket_id: bucketId, ...req })
  }

  listVersions(bucketId: string, key: string): Promise<Binding[]> {
    return this.call('bucket.list_versions', { bucket_id: bucketId, key })
  }

  copy(req: CopyRequest): Promise<PutResult> {
    return this.call('bucket.copy', { ...req })
  }

  batch(bucketId: string, ops: BatchOp[]): Promise<BatchResult[]> {
    return this.call('bucket.batch', { bucket_id: bucketId, ops })
  }

  setMetadata(bucketId: string, key: string, update: { content_type?: string; metadata?: Record<string, string>; tags?: Record<string, string> }): Promise<Binding> {
    return this.call('bucket.set_metadata', { bucket_id: bucketId, key, ...update })
  }

  grant(bucketId: string, req: GrantRequest): Promise<Grant> {
    return this.call('bucket.grant', { bucket_id: bucketId, ...req })
  }

  revoke(grantId: string): Promise<{ revoked: boolean }> {
    return this.call('bucket.revoke', { grant_id: grantId })
  }

  listGrants(bucketId: string): Promise<Grant[]> {
    return this.call('bucket.list_grants', { bucket_id: bucketId })
  }

  createAccessToken(bucketId: string, req: TokenRequest): Promise<IssuedToken> {
    return this.call('bucket.create_access_token', { bucket_id: bucketId, ...req })
  }

  revokeAccessToken(tokenId: string): Promise<{ revoked: boolean }> {
    return this.call('bucket.revoke_access_token', { token_id: tokenId })
  }

  listAccessTokens(bucketId: string): Promise<Record<string, unknown>[]> {
    return this.call('bucket.list_access_tokens', { bucket_id: bucketId })
  }

  checkAccess(bucketId: string, action: BucketAction, target: { key?: string; prefix?: string } = {}): Promise<AccessCheck> {
    return this.call('bucket.check_access', { bucket_id: bucketId, action, ...target })
  }

  getQuota(bucketId: string): Promise<Record<string, unknown>> {
    return this.call('bucket.get_quota', { bucket_id: bucketId })
  }

  setQuota(bucketId: string, update: QuotaUpdate): Promise<Record<string, unknown>> {
    return this.call('bucket.set_quota', { bucket_id: bucketId, ...update })
  }

  getPoolQuota(kind: 'user' | 'app', id: string): Promise<Record<string, unknown>> {
    return this.call('bucket.get_pool_quota', { kind, id })
  }

  usageReport(kind: 'user' | 'app' | 'zone', id?: string, days?: number): Promise<Record<string, unknown>> {
    return this.call('bucket.usage_report', { kind, id, days })
  }

  getLifecycle(bucketId: string): Promise<LifecycleRule[]> {
    return this.call('bucket.get_lifecycle', { bucket_id: bucketId })
  }

  setLifecycle(bucketId: string, rules: LifecycleRule[]): Promise<LifecycleRule[]> {
    return this.call('bucket.set_lifecycle', { bucket_id: bucketId, rules })
  }

  snapshot(bucketId: string, options: { label?: string; includeNoncurrent?: boolean } = {}): Promise<SnapshotInfo> {
    return this.call('bucket.snapshot', { bucket_id: bucketId, label: options.label, include_noncurrent: options.includeNoncurrent })
  }

  listSnapshots(bucketId: string): Promise<SnapshotInfo[]> {
    return this.call('bucket.list_snapshots', { bucket_id: bucketId })
  }

  deleteSnapshot(bucketId: string, snapshotId: string): Promise<{ deleted: boolean }> {
    return this.call('bucket.delete_snapshot', { bucket_id: bucketId, snapshot_id: snapshotId })
  }

  restoreFromSnapshot(bucketId: string, rootObjId: string): Promise<{ restored: number; missing: unknown[] }> {
    return this.call('bucket.restore_from_snapshot', { bucket_id: bucketId, root_obj_id: rootObjId })
  }

  exportSnapshot(bucketId: string, snapshotId: string, target: string): Promise<{ target: string }> {
    return this.call('bucket.export', { bucket_id: bucketId, snapshot_id: snapshotId, target })
  }

  verifyReferences(bucketId: string, refs: Reference[]): Promise<Reference[]> {
    return this.call('bucket.verify_references', { bucket_id: bucketId, refs })
  }

  /** Issues an S3 access key for the signed-in user and `appid` (the user's own session only). */
  createS3Key(appid: string, options: { scope?: S3Key['scope']; expiresAt?: number } = {}): Promise<S3Key> {
    return this.call('bucket.create_s3_key', { appid, scope: options.scope, expires_at: options.expiresAt })
  }

  listS3Keys(): Promise<S3Key[]> {
    return this.call('bucket.list_s3_keys', {})
  }

  revokeS3Key(accessKeyId: string): Promise<{ revoked: boolean }> {
    return this.call('bucket.revoke_s3_key', { access_key_id: accessKeyId })
  }

  /** URL of a key on the data plane; same-origin browser pages read it with the SSO cookie. */
  objectUrl(bucketId: string, key: string, options: { version?: number; token?: string } = {}): string {
    const query = new URLSearchParams()
    if (options.version !== undefined) query.set('version', String(options.version))
    if (options.token) query.set('token', options.token)
    const qs = query.toString()
    return `${this.options.dataPlaneBase}${bucketObjectPath(bucketId, key)}${qs ? `?${qs}` : ''}`
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = this.options.sessionTokenProvider ? await this.options.sessionTokenProvider() : null
    return token ? { Authorization: `Bearer ${token}` } : {}
  }

  /** `PUT /bucket/v1/...`: stores up to 32 MiB and binds it; success means it is retained. */
  async putBytes(bucketId: string, key: string, body: Blob | ArrayBuffer | Uint8Array | string, options: BucketPutOptions = {}): Promise<PutResult & { obj_id: string }> {
    const headers: Record<string, string> = { ...(await this.authHeaders()) }
    if (options.contentType) headers['Content-Type'] = options.contentType
    for (const [k, v] of Object.entries(options.metadata ?? {})) headers[`x-bucky-meta-${k}`] = v
    if (options.tags) headers['x-bucky-tags'] = JSON.stringify(options.tags)
    if (options.expiresAt !== undefined) headers['x-bucky-expires-at'] = String(options.expiresAt)
    if (options.origin) headers['x-bucky-origin'] = JSON.stringify(options.origin)
    if (options.if_none_match) headers['If-None-Match'] = options.if_none_match
    if (options.if_match) headers['If-Match'] = options.if_match
    if (options.if_version !== undefined) headers['x-bucky-if-version'] = String(options.if_version)
    const response = await (this.options.fetcher ?? fetch)(this.objectUrl(bucketId, key), {
      method: 'PUT',
      credentials: 'include',
      headers,
      body: body as BodyInit,
    })
    return this.json(response)
  }

  /** Reads a key's content (a `Response` to stream or `.blob()`). */
  async fetchObject(bucketId: string, key: string, options: { version?: number; token?: string; range?: string } = {}): Promise<Response> {
    const headers: Record<string, string> = options.token ? {} : await this.authHeaders()
    if (options.range) headers.Range = options.range
    const response = await (this.options.fetcher ?? fetch)(this.objectUrl(bucketId, key, options), { credentials: 'include', headers })
    if (!response.ok) await this.json(response)
    return response
  }

  private async json<T>(response: Response): Promise<T> {
    const text = await response.text()
    const body = text ? JSON.parse(text) : {}
    if (!response.ok) {
      throw new BucketError(String(body.error ?? response.status), String(body.message ?? response.statusText), response.status, body.data)
    }
    return body as T
  }
}
