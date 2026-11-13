import { canonicalJson, encodeObjQueryComponent, normalizeObjectUrl, objectSegments, objServiceUrl, parseObjectUrl } from './object_url'
import type { kRPCClient } from './krpc_client'

export const AIWORKSPACE_SERVICE_NAME = 'aiworkspace'

/** Business results of the AI Workspace service: `{ ok, ... }`, `{ ok: false, error }`, or a three-state commit result. */
export interface AiwsError { code: string; retryable: boolean; detail: string; sub_code?: string; data?: unknown }
export type AiwsResult<T> = (T & { ok: true }) | { ok: false; error: AiwsError }

export class AiwsFailure extends Error {
  readonly code: string
  readonly subCode?: string
  readonly data?: unknown
  constructor(error: AiwsError) {
    super(`${error.code}${error.sub_code ? `/${error.sub_code}` : ''}: ${error.detail}`)
    this.name = 'AiwsFailure'
    this.code = error.code
    this.subCode = error.sub_code
    this.data = error.data
  }
}

/** A reference object (内核架构改进 D10): where, and which version. */
export interface AiwsReference {
  zone?: string
  workspace_id?: string
  entity_id: string
  selector?: Record<string, unknown>
  mode: 'live' | 'fixed'
  version?: { epoch: string; seq: number } | { content_root: string; path?: string }
}

/**
 * The Object URL of a Reference (buckyos doc/key url.md §6): the default
 * `obj://aiworkspace/<ws>/entities/<entity_id>` for a live reference without
 * selector; `mode=fixed`, `selector` and `version` go into the query as canonical
 * JSON, so one Reference has exactly one URL. Same rules as buckyos-api `aiws_reference_url`.
 */
export function aiwsReferenceUrl(reference: AiwsReference, workspaceId?: string): string {
  const ws = reference.workspace_id ?? workspaceId
  if (!ws) throw new Error('reference names no workspace')
  const query: string[] = []
  if (reference.mode === 'fixed') query.push('mode=fixed')
  if (reference.selector != null) query.push(`selector=${encodeObjQueryComponent(canonicalJson(reference.selector))}`)
  if (reference.version != null) query.push(`version=${encodeObjQueryComponent(canonicalJson(reference.version))}`)
  const base = objServiceUrl('aiworkspace', [ws, 'entities', reference.entity_id])
  return normalizeObjectUrl(query.length ? `${base}?${query.join('&')}` : base)
}

/** The Reference an `obj://aiworkspace/<ws>/entities/<entity_id>[?...]` URL projects. */
export function parseAiwsReferenceUrl(url: string): AiwsReference {
  const parsed = parseObjectUrl(url)
  const segments = objectSegments(parsed)
  if (parsed.kind !== 'obj' || parsed.host.name !== 'aiworkspace' || segments.length !== 3 || segments[1] !== 'entities') {
    throw new Error(`${url} is not an AI Workspace entity url`)
  }
  const reference: AiwsReference = {
    workspace_id: segments[0],
    entity_id: segments[2],
    mode: parsed.query.mode === 'fixed' ? 'fixed' : 'live',
  }
  if (parsed.query.selector !== undefined) reference.selector = JSON.parse(parsed.query.selector)
  if (parsed.query.version !== undefined) reference.version = JSON.parse(parsed.query.version)
  return reference
}

/** An entity argument: a path (`/data/销售`, `~<entity_id>/…`, from the Workspace root or an entity) or an entity id. */
export function aiwsTarget(target: string): { path: string } | { entity_id: string } {
  return target.startsWith('/') || target.startsWith('~') ? { path: target } : { entity_id: target }
}

/** Type filters of `doc.list` / `doc.find` / a text query: short types (`table`, `richtext`, `record`, `annotation`,
 * `block`, `container`, `asset`, `dir`, `wish`, `def`, `viewport`, `path`, `task`, `response`, `result`) or
 * `container:<kind>`, as a comma string or an array. */
export type AiwsTypeFilter = string | string[]

export interface AiwsListItem {
  entity_id: string
  name: string
  path: string
  type: string
  type_id: string
  kind?: string | null
  title: string | null
  children: number
  content_rev: number
  body: { state: string; format: string | null }
  schema_id?: string | null
  scope?: string
  /** A personal entity a shared one of the same name hides: reach it as `~<entity_id>`. */
  shadowed?: boolean
}

export interface AiwsListParams {
  /** A path or an entity id (default `/`). */
  at?: string
  type?: AiwsTypeFilter
  not_type?: AiwsTypeFilter
  schema?: string
  limit?: number
  cursor?: string
}

export interface AiwsListResult {
  at: { entity_id: string; path: string }
  items: AiwsListItem[]
  next_cursor?: string | null
  head_seq: number
}

export interface AiwsFindParams extends AiwsListParams {
  depth?: number
  /** A literal, case-insensitive, in the name or the title. */
  name?: string
}

export interface AiwsFindResult {
  at: { entity_id: string; path: string }
  items: (AiwsListItem & { match?: 'name' | 'title' })[]
  complete: boolean
  visited: number
  next_cursor?: string | null
  head_seq: number
}

export interface AiwsTextQueryParams {
  case?: boolean
  at?: string
  depth?: number
  type?: AiwsTypeFilter
  not_type?: AiwsTypeFilter
  limit?: number
  cursor?: string
}

export interface AiwsTextHit {
  entity_id: string
  path: string
  type: string
  on: 'name' | 'title' | 'body'
  selector?: Record<string, unknown>
  snippet: string
  more?: number
}

export interface AiwsTextQueryResult {
  hits: AiwsTextHit[]
  /** An empty result means “none” only when `complete`. */
  coverage: { complete: boolean; scanned: number; bytes: number; skipped: { entity_id: string; reason: string }[] }
  at: { entity_id: string; path: string }
  next_cursor?: string | null
  head_seq: number
}

export interface AiwsSqlParams {
  /** Positional parameters (`?`). */
  params?: unknown[]
  /** `{ alias: path | entity_id }`: only these tables, named by their alias in the SQL. */
  tables?: Record<string, string>
  /** ≤ 5000 (default 1000). */
  max_rows?: number
  /** Run only on this head (`SNAPSHOT_EXPIRED` / `HEAD_MISMATCH` otherwise). */
  expect_head?: { epoch: string; seq: number }
}

export interface AiwsSqlResult {
  columns: string[]
  rows: unknown[][]
  truncated: boolean
  read: { table: string; entity_id: string; path: string; content_rev: number }[]
  head_seq: number
}

/** `doc.source_query`: rows of a URL table (`data_mode: url_query`) from its remote source. */
export interface AiwsSourceQueryParams {
  filter?: unknown
  sorts?: unknown[]
  fields?: string[]
  limit: number
  cursor?: string
  consistency?: string
  source_revision?: string
}

/** `doc.read { as: "meta" }`: what an entity is, without scanning its content. */
export interface AiwsMeta {
  entity_id: string
  path: string
  name: string
  name_follows: boolean
  title: string | null
  type: string
  type_id: string
  kind: string | null
  schema_id: string | null
  schema_version: number
  scope: string
  parent: { entity_id: string; path: string } | null
  version: { content_rev: number; meta_rev: number; life_rev: number; struct_rev: number; epoch: string; head_seq: number }
  body: { state: string; format: string | null; format_version: number; etag: string; records: number | null; bytes: number | null; reason?: string }
  data?: Record<string, unknown>
  children: number
  capabilities: string[]
  ops: string[]
  shows?: Record<string, unknown> | null
  definition?: Record<string, unknown>
  ref: AiwsReference
  head_seq: number
}

export interface AiwsBodyParams {
  selector?: Record<string, unknown>
  cursor?: string
  /** 64…262 144 (default 32 768). */
  max_bytes?: number
  /** Each part's selector and its offsets in `text`. */
  parts?: boolean
}

/** `doc.read { as: "body" }`: one page of the entity's plain-text rendering. */
export interface AiwsBody {
  entity_id: string
  path: string
  text: string
  format: string
  format_version: number
  etag: string
  state: string
  complete: boolean
  next_cursor?: string | null
  parts?: { selector: Record<string, unknown>; start: number; end: number; partial?: boolean }[]
}

/** What `ext.upgrade` / `ext.build` rewrite on the instances of a definition whose new version narrows what they rely
 * on (schemas/migration.schema.json, Q30). */
export interface AiwsMigration {
  config?: { rename?: Record<string, string>; drop?: string[]; fill?: Record<string, unknown> }
  bindings?: { rename?: Record<string, string>; drop?: string[]; fill?: Record<string, { entity_id: string }> }
  slots?: { rename?: Record<string, string>; move?: Record<string, string> }
  events?: { rename?: Record<string, string>; drop?: string[] }
}

export interface AiwsExtBuildParams {
  files: ({ name: string; obj_id: string } | { name: string; base64: string })[]
  folder_id?: string
  expect?: { def_rev: number; dir_rev: number }
  force?: boolean
  dry_run?: boolean
  provenance?: { pkg_id?: string; version?: string; digest?: string }
  /** With `provenance`: rebuild an identity the folder holds from another source (an upgrade across Zones, Q30). */
  upgrade?: boolean
  /** `{ <ident>: Migration }` for a build that narrows what instances rely on. */
  migration?: Record<string, AiwsMigration>
  idempotency_key?: string
}

export interface AiwsExtUpgradeParams {
  workspace_id: string
  /** `pkg_id` default: the package the definition was imported from (`provenance.pkg_id`). */
  items: { def_entity_id: string; pkg_id?: string }[]
  migration?: Record<string, AiwsMigration>
  force?: boolean
  dry_run?: boolean
  idempotency_key?: string
}

export interface AiwsExtUpgradeResult {
  status: 'accepted' | 'unchanged' | 'checked'
  commit_id?: string
  seq?: number
  controls: { ident: string; def_entity_id: string; action: 'upgraded' | 'unchanged'; from?: string; to?: string; migrated?: string[] }[]
  /** `dry_run`: what the migration writes on each instance. */
  plan?: { instance: string; ops: Record<string, unknown>[] }[]
}

export interface AiwsTemplateParam { type: 'string' | 'number' | 'boolean'; title?: string; default?: string | number | boolean }

/** A Workspace template of a control package (aiws-manifest.json `workspace_templates`, schemas/template.schema.json,
 * Q32): a snapshot under `templates/<id>/` and the controls of the same package it needs. */
export interface AiwsTemplateItem {
  id: string
  title: string
  description?: string
  snapshot: string
  digest: string
  requires: { host_api?: { html?: number; declarative?: number }; controls: string[] }
  params?: Record<string, AiwsTemplateParam>
  reset?: { tables?: string[] }
}

/** One template to export (`ext.export_template`, `ext.pack` / `ext.install` `templates`): chosen Surfaces (and data
 * entities) of the Workspace. */
export interface AiwsTemplateExport {
  surfaces: string[]
  data?: string[]
  template: { id: string; title: string; description?: string; params?: Record<string, AiwsTemplateParam>; reset?: { tables: string[] } }
}

/** `ext.build` / `ext.import`: one entry per control (`created | rebuilt | unchanged | satisfied`), the first also at the top. */
export interface AiwsExtBuildResult {
  status: 'accepted' | 'unchanged' | 'checked'
  commit_id?: string
  seq?: number
  unchanged?: boolean
  ident?: string
  def_entity_id?: string
  dir_entity_id?: string
  version?: number
  def_rev?: number
  dir_rev?: number
  action?: string
  build?: { input_digest: string; builder_version: string; built_at: string }
  controls: Record<string, unknown>[]
  diagnostics: Record<string, unknown>[]
}

export interface AiwsLibraryPackage {
  pkg_id: string
  version: string
  title: string
  author: string
  mode: string
  installed_at: string
  /** The package's manifest_version is above what the service reads: listed, not importable. */
  needs_newer?: boolean
  controls: { ident: string; name: string; kind: string; version: number; digest: string; dir: string; title?: string; description?: string; catalog?: Record<string, unknown>; deps?: string[] }[]
  templates?: { id: string; title: string; description?: string; params?: Record<string, AiwsTemplateParam>; requires: AiwsTemplateItem['requires'] }[]
}

/** `ext.pack`: the `.pikg` the service wrote into the caller's `exports` bucket. */
export interface AiwsExtPackResult {
  bucket_id: string
  key: string
  obj_id: string
  size: number
  digest: string
  app_doc_object_id: string
  app_did: string
  pkg_id: string
  version: string
  /** The bucket binding with a read token (as `doc.export`'s `download`). */
  download: { bucket_id: string; key: string; version: number; obj_id: string; token: string }
}

/** What an executor outside the service reports for a run (M3): results in the Mock executor's shape, or an analysis. */
export interface AiwsRunReport {
  run_id: string
  attempt: number
  progress?: Record<string, unknown>
  error?: { code: string; detail: string }
  results?: Record<string, unknown>[]
  read_set?: Record<string, unknown>[]
  summary?: string
  warnings?: string[]
  assumptions?: string[]
  analysis?: Record<string, unknown>
}

/** One request of `doc.stage` / `doc.commit` stays under the service's 8 MiB body limit. */
export const AIWS_COMMIT_PART_BYTES = 6 * 1024 * 1024
/** What one Commit may hold once its parts are assembled (aiworkspace-core `Limits`). */
export const AIWS_COMMIT_MAX_BYTES = 32 * 1024 * 1024
export const AIWS_COMMIT_MAX_OPERATIONS = 50_000

export type AiwsCall = (method: string, params: Record<string, unknown>) => Promise<unknown>

export interface AiwsCommitPartsOptions {
  /** Largest serialized size of the operations of one request (default `AIWS_COMMIT_PART_BYTES`). */
  partBytes?: number
  /** Called before request `part` of `total` is sent (1-based; the last one is the commit itself). Only when
   * the Commit is sent in more than one request. */
  onPart?: (part: number, total: number) => void
  /** `doc.prepare` instead of `doc.commit` (the parts it stages expire on their own). */
  method?: 'doc.commit' | 'doc.prepare'
}

const utf8 = new TextEncoder()

function jsonBytes(value: unknown): number {
  const text = JSON.stringify(value)
  // a JSON string is at most 3 UTF-8 bytes per UTF-16 unit: only count when that bound does not settle it
  return text.length
    + (/[^\x00-\x7f]/.test(text) ? utf8.encode(text).length - text.length : 0)
}

/** `operations` cut into runs of at most `partBytes` serialized bytes, in order; an operation larger than that
 * is a run of its own. */
export function splitCommitOperations<T>(operations: T[], partBytes = AIWS_COMMIT_PART_BYTES): T[][] {
  const parts: T[][] = []
  let current: T[] = []
  let size = 2
  for (const op of operations) {
    const bytes = jsonBytes(op) + 1
    if (current.length > 0 && size + bytes > partBytes) {
      parts.push(current)
      current = []
      size = 2
    }
    current.push(op)
    size += bytes
  }
  if (current.length > 0 || parts.length === 0) parts.push(current)
  return parts
}

/** Whether a Commit of these operations is within what the service assembles (`null`), or which limit it passes. */
export function commitOverLimit(operations: unknown[]): { limit: 'operations' | 'bytes'; value: number; max: number } | null {
  if (operations.length > AIWS_COMMIT_MAX_OPERATIONS) return { limit: 'operations', value: operations.length, max: AIWS_COMMIT_MAX_OPERATIONS }
  let bytes = 2
  for (const op of operations) bytes += jsonBytes(op) + 1
  // the envelope of the final request counts too
  return bytes + 4096 > AIWS_COMMIT_MAX_BYTES ? { limit: 'bytes', value: bytes, max: AIWS_COMMIT_MAX_BYTES } : null
}

/**
 * Send one Commit, whatever its size: a request whose operations fit `partBytes` is one `doc.commit`; a larger one
 * has its leading parts held by `doc.stage` and the last part sent as `doc.commit { staged: [digests] }`, which the
 * service assembles into the same single Commit (one transaction, one undo unit). Every call stages all parts again,
 * so resending the same request after an unknown result is safe. The three-state result is returned as it is; a
 * refused `doc.stage` comes back as a `rejected` result.
 */
export async function commitWithParts<T = Record<string, unknown>>(call: AiwsCall, request: Record<string, unknown>, options: AiwsCommitPartsOptions = {}): Promise<T> {
  const method = options.method ?? 'doc.commit'
  const operations = Array.isArray(request.operations) ? request.operations as unknown[] : []
  const parts = splitCommitOperations(operations, options.partBytes ?? AIWS_COMMIT_PART_BYTES)
  if (parts.length <= 1) return await call(method, request) as T
  const { workspace_id, epoch, idempotency_key } = request
  for (let attempt = 0; ; attempt++) {
    const staged: string[] = []
    for (let part = 0; part < parts.length - 1; part++) {
      options.onPart?.(part + 1, parts.length)
      const held = await call('doc.stage', { workspace_id, epoch, idempotency_key, part, operations: parts[part] }) as { ok?: boolean; digest?: string; error?: AiwsError }
      if (!held || held.ok === false || typeof held.digest !== 'string') {
        const error = held?.error ?? { code: 'STORAGE_IO_ERROR', retryable: true, detail: 'doc.stage returned no digest' }
        return { status: 'rejected', code: error.code, retryable: error.retryable, detail: error.detail, ...(error.sub_code ? { sub_code: error.sub_code } : {}), errors: [error] } as T
      }
      staged.push(held.digest)
    }
    options.onPart?.(parts.length, parts.length)
    const result = await call(method, { ...request, staged, operations: parts[parts.length - 1] }) as { status?: string; sub_code?: string }
    // the parts expired (or another send of this key consumed them) between staging and the commit: once more
    if (attempt === 0 && result?.status === 'rejected' && result.sub_code === 'STAGED_PARTS_MISSING') continue
    return result as T
  }
}

/**
 * kRPC client of the AI Workspace service (`/kapi/aiworkspace`). Every method takes the business result out of
 * `result` and throws `AiwsFailure` on `{ ok: false }`; commits return the three-state result as it is.
 * Stable methods: see `src/frame/aiworkspace/README.md` (Protocol, method levels).
 */
export class AiWorkspaceClient {
  constructor(private rpcClient: kRPCClient) {}

  async call<T = Record<string, unknown>>(method: string, params: Record<string, unknown>): Promise<T> {
    const raw = await this.rpcClient.call<AiwsResult<T>, Record<string, unknown>>(method, params)
    if (raw && typeof raw === 'object' && (raw as { ok?: unknown }).ok === false) throw new AiwsFailure((raw as { error: AiwsError }).error)
    return raw as T
  }

  // ---- workspace
  /** A new Workspace; `name` (unique among the caller's, fixed) answers `NAME_CONFLICT` when the caller already uses it. */
  create(title: string, opts: { workspace_id?: string; name?: string } = {}) {
    return this.call<{ workspace_id: string; epoch: string; head_seq: number; title: string; name?: string }>('ws.create', { title, ...opts })
  }
  /** The caller's Workspace named `name`, created (titled `title`, else the name) when it has none. */
  ensure(name: string, title?: string) {
    return this.call<{ workspace_id: string; epoch: string; head_seq: number; title: string; name: string; created: boolean }>('ws.ensure', { name, ...(title === undefined ? {} : { title }) })
  }
  /** The service clock (unix ms): calibrate against half the round trip. */
  time() { return this.call<{ server_ms: number }>('ws.time', {}) }
  list() { return this.call('ws.list', {}) }
  info(workspace_id: string) { return this.call('ws.get_info', { workspace_id }) }
  getUserState(workspace_id: string) { return this.call('ws.get_user_state', { workspace_id }) }
  setUserState(workspace_id: string, entries: Record<string, unknown>, expect?: Record<string, number>) {
    return this.call('ws.set_user_state', { workspace_id, entries, ...(expect ? { expect } : {}) })
  }

  // ---- document
  resolve(workspace_id: string, reference: AiwsReference | Record<string, unknown>) { return this.call('doc.resolve', { workspace_id, reference }) }
  resolvePath(workspace_id: string, path: string) { return this.call('doc.resolve', { workspace_id, path }) }
  /** The native content (`target`: a path or an entity id, see `aiwsTarget`). */
  read(workspace_id: string, target: string, selector?: Record<string, unknown>) {
    return this.call('doc.read', { workspace_id, ...aiwsTarget(target), ...(selector ? { selector } : {}) })
  }
  readMeta(workspace_id: string, target: string) {
    return this.call<AiwsMeta>('doc.read', { workspace_id, ...aiwsTarget(target), as: 'meta' })
  }
  /** One page of the plain-text body; follow `next_cursor` (bound to `etag`) for the rest. */
  readBody(workspace_id: string, target: string, params: AiwsBodyParams = {}) {
    return this.call<AiwsBody>('doc.read', { workspace_id, ...aiwsTarget(target), as: 'body', ...params })
  }
  /** `doc.list`: the readable direct children of `at` (default `/`), in tree order. */
  listEntities(workspace_id: string, params: AiwsListParams = {}) { return this.call<AiwsListResult>('doc.list', { workspace_id, ...params }) }
  /** `doc.find`: a pre-order walk under `at` by name / title, type and schema. */
  findEntities(workspace_id: string, params: AiwsFindParams = {}) { return this.call<AiwsFindResult>('doc.find', { workspace_id, ...params }) }
  /** `doc.query { text }`: a literal (1–256 characters) in names, titles and bodies. */
  textQuery(workspace_id: string, text: string, params: AiwsTextQueryParams = {}) {
    return this.call<AiwsTextQueryResult>('doc.query', { workspace_id, text, ...params })
  }
  /** `doc.query { sql }`: one SELECT over the logical tables (`FROM "/data/销售"`, `"~<entity_id>"`, an alias of `tables`). */
  sql(workspace_id: string, sql: string, params: AiwsSqlParams = {}) {
    return this.call<AiwsSqlResult>('doc.query', { workspace_id, sql, ...params })
  }
  /** `doc.source_query`: rows of a URL table from its remote source. */
  sourceQuery(workspace_id: string, source_id: string, params: AiwsSourceQueryParams) {
    return this.call('doc.source_query', { workspace_id, source_id, ...params })
  }
  outline(workspace_id: string) { return this.call('doc.outline', { workspace_id }) }
  private raw: AiwsCall = (method, params) => this.rpcClient.call<Record<string, unknown>, Record<string, unknown>>(method, params)
  prepare(workspace_id: string, request: Record<string, unknown>) {
    return commitWithParts(this.raw, { workspace_id, ...request }, { method: 'doc.prepare' })
  }
  /** The three-state commit result (`status: accepted | conflict | rejected`), never thrown. One call per Commit
   * whatever its size (up to `AIWS_COMMIT_MAX_BYTES` / `AIWS_COMMIT_MAX_OPERATIONS`): a large one is sent in parts. */
  commit(workspace_id: string, request: Record<string, unknown>, options: Pick<AiwsCommitPartsOptions, 'partBytes' | 'onPart'> = {}) {
    return commitWithParts(this.raw, { workspace_id, ...request }, options)
  }
  getSubmission(workspace_id: string, epoch: string, idempotency_key: string) { return this.call('doc.get_submission', { workspace_id, epoch, idempotency_key }) }
  /** Changes after `after_seq` (`filter.detail: "touched"` for the touched entities only). */
  getChanges(workspace_id: string, epoch: string, after_seq: number, opts: { limit?: number; touchedOnly?: boolean } = {}) {
    return this.call('doc.get_changes', { workspace_id, epoch, after_seq, ...(opts.limit ? { limit: opts.limit } : {}), ...(opts.touchedOnly ? { filter: { detail: 'touched' } } : {}) })
  }
  /** Long poll until the head passes `after_seq` (or `timeout_ms`). */
  waitChanges(workspace_id: string, after_seq: number, opts: { epoch?: string; timeout_ms?: number } = {}) {
    return this.call<{ epoch: string; head_seq: number; timed_out: boolean; server_ms: number }>('doc.wait_changes', { workspace_id, after_seq, ...opts })
  }
  /** A whole-Workspace package (`.bcanvas`): `download` names it in the owner's exports bucket. */
  exportDoc(workspace_id: string, mode: 'share' | 'personal_backup', self_contained: boolean, include_notes?: boolean) {
    return this.call('doc.export', { workspace_id, mode, self_contained, ...(include_notes === undefined ? {} : { include_notes }) })
  }

  // ---- assets
  /** Register a FileObject as a staged asset: `{ bucket_id, key }` (the uploader's binding) or `{ obj_id }`. */
  assetImportObject(workspace_id: string, source: { bucket_id: string; key: string } | { obj_id: string }) {
    return this.call<{ object_id: string; media_type: string; size: number }>('asset.import_object', { workspace_id, ...source })
  }

  // ---- Block-controls (code-registered layouts such as the mind map)
  controlsList() { return this.call('control.list', {}) }
  controlsDescribe(kind: string) { return this.call('control.describe', { kind }) }
  controlsImport(workspace_id: string, params: Record<string, unknown>) { return this.call('control.import', { workspace_id, ...params }) }
  controlsExport(workspace_id: string, entity_id: string, format?: 'markdown' | 'opml') { return this.call('control.export', { workspace_id, entity_id, ...(format ? { format } : {}) }) }

  // ---- extension controls (README “Extension controls”; buckyos-websdk src/aiws_ext.ts drives them)
  /** Build one control's source files into the Workspace; `BUILD_FAILED` carries `data.diagnostics`. */
  extBuild(workspace_id: string, params: AiwsExtBuildParams) { return this.call<AiwsExtBuildResult>('ext.build', { workspace_id, ...params }) }
  /** The bundle of definitions (`purpose: pull` needs read only and synthesizes the source of never-built ones). */
  extExport(workspace_id: string, entity_ids: string[], purpose: 'package' | 'pull' = 'package') {
    return this.call<{ manifest: Record<string, unknown>; controls: Record<string, unknown>[]; files: { path: string; obj_id?: string; size: number; text?: string }[] }>('ext.export', { workspace_id, entity_ids, purpose })
  }
  /** Into the caller's library: a `.pikg` object or one bound into the caller's `exports` bucket (consumed), or
   * definitions of a Workspace (`from` + `package`). */
  extInstall(params: { pikg?: { obj_id: string } | { bucket_id: string; key: string }; from?: { workspace_id: string; entity_ids: string[]; templates?: AiwsTemplateExport[] }; package?: { name: string; version?: string; title?: string }; mode?: 'dev' }) {
    return this.call<{ pkg_id: string; version: string; action: string; controls: Record<string, unknown>[] }>('ext.install', params)
  }
  /** Pack definitions (and what they build on, and templates of the Workspace) as an `aiws` `.pikg` into the caller's
   * `exports` bucket (unsigned). */
  extPack(workspace_id: string, entity_ids: string[], pkg: { name: string; version?: string; title?: string }, templates?: AiwsTemplateExport[]) {
    return this.call<AiwsExtPackResult>('ext.pack', { workspace_id, entity_ids, package: pkg, ...(templates ? { templates } : {}) })
  }
  /** Rebuild imported definitions from the caller's library (same Zone; across Zones `ext.build { provenance, upgrade }`):
   * `EXT_LOCAL_CHANGES` when the snapshot was built locally since, unless `force`. */
  extUpgrade(params: AiwsExtUpgradeParams) { return this.call<AiwsExtUpgradeResult>('ext.upgrade', { ...params }) }
  /** Chosen Surfaces as a template snapshot: the manifest item, the definitions it needs and the files (base64) of
   * `templates/<id>/`. */
  extExportTemplate(params: { workspace_id: string } & AiwsTemplateExport) {
    return this.call<{ template: AiwsTemplateItem; controls: Record<string, unknown>[]; files: { path: string; base64: string }[] }>('ext.export_template', { ...params })
  }
  /** A new Workspace from a template of the caller's library (installing a template never creates one). */
  extCreateFromTemplate(params: { pkg_id: string; template_id: string; title?: string; params?: Record<string, string | number | boolean> }) {
    return this.call<{ workspace_id: string }>('ext.create_from_template', params)
  }
  extListLibrary() { return this.call<{ packages: AiwsLibraryPackage[] }>('ext.list_library', {}) }
  extUninstall(pkg_id: string) { return this.call('ext.uninstall', { pkg_id }) }
  /** A library package's controls with their bytes (base64): what a client relays into a Workspace of another Zone. */
  extLibraryBundle(pkg_id: string, idents?: string[]) { return this.call<{ pkg_id: string; controls: Record<string, unknown>[] }>('ext.library_bundle', { pkg_id, ...(idents ? { idents } : {}) }) }
  /** Bring library controls into a Workspace of this Zone (one Commit). */
  extImport(workspace_id: string, items: { pkg_id: string; ident: string }[], opts: { folder_id?: string } = {}) {
    return this.call<AiwsExtBuildResult>('ext.import', { workspace_id, items, ...opts })
  }

  // ---- runs (M3 executor protocol)
  runStart(workspace_id: string, program: string, params: Record<string, unknown>, idempotency_key: string) {
    return this.call('proc.start', { workspace_id, program, params, idempotency_key })
  }
  runGet(workspace_id: string, run_id: string, choices?: Record<string, unknown>) {
    return this.call('proc.get', { workspace_id, run_id, ...(choices ? { choices } : {}) })
  }
  runList(workspace_id: string, wish_id?: string, limit?: number) {
    return this.call('proc.list', { workspace_id, ...(wish_id ? { wish_id } : {}), ...(limit ? { limit } : {}) })
  }
  runClaim(workspace_id: string, run_id: string, claim_token: string, executor?: Record<string, unknown>) {
    return this.call<{ run_id: string; attempt: number; run_token: string; lease_until: string; lease_ms: number }>('proc.claim', { workspace_id, run_id, claim_token, ...(executor ? { executor } : {}) })
  }
  runHeartbeat(workspace_id: string, run_id: string, attempt: number, progress?: Record<string, unknown>) {
    return this.call('proc.heartbeat', { workspace_id, run_id, attempt, ...(progress ? { progress } : {}) })
  }
  runReport(workspace_id: string, report: AiwsRunReport) { return this.call('proc.report', { workspace_id, ...report }) }
  runApply(workspace_id: string, run_id: string, plan_digest: string, session_id?: string) {
    return this.call('proc.apply', { workspace_id, run_id, plan_digest, ...(session_id ? { session_id } : {}) })
  }
  runCancel(workspace_id: string, run_id: string) { return this.call('proc.cancel', { workspace_id, run_id }) }
}
