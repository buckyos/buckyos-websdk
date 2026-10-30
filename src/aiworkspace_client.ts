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

export interface AiwsExtBuildParams {
  files: ({ name: string; obj_id: string } | { name: string; base64: string })[]
  folder_id?: string
  expect?: { def_rev: number; dir_rev: number }
  force?: boolean
  dry_run?: boolean
  provenance?: { pkg_id?: string; version?: string; digest?: string }
  idempotency_key?: string
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
  controls: { ident: string; name: string; kind: string; version: number; digest: string; dir: string; title?: string; description?: string; catalog?: Record<string, unknown> }[]
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
  list() { return this.call('ws.list', {}) }
  info(workspace_id: string) { return this.call('ws.get_info', { workspace_id }) }
  getUserState(workspace_id: string) { return this.call('ws.get_user_state', { workspace_id }) }
  setUserState(workspace_id: string, entries: Record<string, unknown>, expect?: Record<string, number>) {
    return this.call('ws.set_user_state', { workspace_id, entries, ...(expect ? { expect } : {}) })
  }

  // ---- document
  resolve(workspace_id: string, reference: AiwsReference | Record<string, unknown>) { return this.call('doc.resolve', { workspace_id, reference }) }
  resolvePath(workspace_id: string, path: string) { return this.call('doc.resolve', { workspace_id, path }) }
  read(workspace_id: string, entity_id: string, selector?: Record<string, unknown>) {
    return this.call('doc.read', { workspace_id, entity_id, ...(selector ? { selector } : {}) })
  }
  query(workspace_id: string, params: Record<string, unknown>) { return this.call('doc.query', { workspace_id, ...params }) }
  outline(workspace_id: string) { return this.call('doc.outline', { workspace_id }) }
  prepare(workspace_id: string, request: Record<string, unknown>) {
    return this.rpcClient.call<Record<string, unknown>, Record<string, unknown>>('doc.prepare', { workspace_id, ...request })
  }
  /** The three-state commit result (`status: accepted | conflict | rejected`), never thrown. */
  commit(workspace_id: string, request: Record<string, unknown>) {
    return this.rpcClient.call<Record<string, unknown>, Record<string, unknown>>('doc.commit', { workspace_id, ...request })
  }
  getSubmission(workspace_id: string, epoch: string, idempotency_key: string) { return this.call('doc.get_submission', { workspace_id, epoch, idempotency_key }) }
  /** Changes after `after_seq` (`filter.detail: "touched"` for the touched entities only). */
  getChanges(workspace_id: string, epoch: string, after_seq: number, opts: { limit?: number; touchedOnly?: boolean } = {}) {
    return this.call('doc.get_changes', { workspace_id, epoch, after_seq, ...(opts.limit ? { limit: opts.limit } : {}), ...(opts.touchedOnly ? { filter: { detail: 'touched' } } : {}) })
  }
  /** Long poll until the head passes `after_seq` (or `timeout_ms`). */
  waitChanges(workspace_id: string, after_seq: number, opts: { epoch?: string; timeout_ms?: number } = {}) {
    return this.call<{ epoch: string; head_seq: number; timed_out: boolean }>('doc.wait_changes', { workspace_id, after_seq, ...opts })
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
  /** Into the caller's library: a `.pikg` object, or definitions of a Workspace (`from` + `package`). */
  extInstall(params: { pikg?: { obj_id: string }; from?: { workspace_id: string; entity_ids: string[] }; package?: { name: string; version?: string; title?: string }; mode?: 'dev' }) {
    return this.call<{ pkg_id: string; version: string; action: string; controls: Record<string, unknown>[] }>('ext.install', params)
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
