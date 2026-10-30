/**
 * AI Workspace extension controls (buckyos src/frame/aiworkspace/README.md “Extension controls”), shared by the
 * Desktop and the CLI: a control's source lives in a (flat) home folder of the Zone file service; `build` lists it
 * over NFSP and hands each file's object to `ext.build`, `pull` writes a Workspace snapshot back, `watch` rebuilds on
 * change; bundles (the AIWS manifest plus `controls/<dir>/<file>`) are what exports, packages and the library carry.
 * Runs in browsers and Deno (fetch, crypto.subtle); no dependencies.
 */
import type { AiWorkspaceClient } from './aiworkspace_client'
import type { NfspClient, WireRef } from './nfsp'

/** The two service calls these drivers make (an `AiWorkspaceClient`, or a host's own session with the same shape). */
export type AiwsExtRpc = Pick<AiWorkspaceClient, 'extBuild' | 'extExport'>

export const AIWS_COMPONENT_FILE = 'component.json'
export const AIWS_MANIFEST_FILE = 'aiws-manifest.json'
/** A client's own record of the base it last built or pulled (never part of the source snapshot: dot files are not). */
export const AIWS_BUILD_STATE_FILE = '.aiws-build.json'
/** The newest component.json / AIWS manifest version this module reads (older ones stay readable, Q19). */
export const AIWS_MANIFEST_VERSION = 1
/** The HTML Block host API (`window.aiws` v2) and the declarative interpreter version. */
export const AIWS_HTML_API_VERSION = 2
export const AIWS_DECLARATIVE_API_VERSION = 1
export const AIWS_MAX_SOURCE_FILES = 64

/**
 * One file of a source folder. `obj_id` is set when the file service holds it as a named-store FileObject (`cyfile:`):
 * the service then reads it by reference. Files of a native home folder have none (their `obj_id`, when the file
 * service reports one, is a `sha256:` content hash the service cannot fetch): their bytes travel with the build.
 */
export interface AiwsSourceFile { name: string; obj_id?: string; node_id?: string; etag?: string; size?: number }
export interface AiwsDiagnostic {
  file: string
  line?: number
  col?: number
  severity: 'error' | 'warning'
  message: string
  /** Cells whose contract a rebuild would break. */
  instances?: { entity_id: string; title?: string | null }[]
}
export interface AiwsBuildState { workspace_id: string; def_entity_id: string; def_rev: number; dir_rev: number; ident?: string; at?: string }
export interface AiwsManifestControl { ident: string; name: string; kind: string; version: number; digest: string; dir: string; title?: string; description?: string; catalog?: Record<string, unknown> }
export interface AiwsManifest { manifest_version: number; purpose: 'aiws'; host_api?: Record<string, number>; controls: AiwsManifestControl[]; workspace_templates: unknown[] }
export interface AiwsBundle { manifest: AiwsManifest; files: Map<string, Uint8Array> }

/** A source directory that cannot be built as it is (not a service refusal: `diagnostics` say why). */
export class AiwsSourceError extends Error {
  readonly diagnostics: AiwsDiagnostic[]
  constructor(diagnostics: AiwsDiagnostic[]) {
    super(diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.file ? `${d.file}: ` : ''}${d.message}`).join('; ') || 'invalid control source')
    this.name = 'AiwsSourceError'
    this.diagnostics = diagnostics
  }
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function joinPath(dir: string, name: string): string {
  return `${dir.replace(/\/+$/, '')}/${name}`
}

/** A Workspace title as one folder name (no `/`, no leading dot). */
export function folderName(title: string): string {
  const cleaned = title.replace(/[/\\\u0000-\u001f]/g, ' ').replace(/^\.+/, '').trim()
  return cleaned.slice(0, 80) || 'Workspace'
}

/** The suggested home folder of a control (README: a suggestion; the definition never stores it). */
export function homeControlDir(owner: string, workspaceTitle: string, name: string): string {
  return `/home/${owner}/AI Workspace/${folderName(workspaceTitle)}/controls/${name}`
}

/** Where a client writes an export bundle before packing it. */
export function homeExportDir(owner: string, pkg: string): string {
  return `/home/${owner}/AI Workspace/exports/${pkg}`
}

/** `user_state` key under which each person remembers the home folder of a definition. */
export function sourceStateKey(defEntityId: string): string {
  return `aiws:src:${defEntityId}`
}

// ---- digests (same canonical forms as the service: store/src/ext.rs)

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** `sha256:` over `[[name, sha256 hex of its bytes], …]` sorted by name: a control's content digest. */
export async function aiwsContentDigest(files: Iterable<[string, Uint8Array]>): Promise<string> {
  const pairs: [string, string][] = []
  for (const [name, bytes] of files) pairs.push([name, await sha256Hex(bytes)])
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return `sha256:${await sha256Hex(encoder.encode(JSON.stringify(pairs)))}`
}

/** What a set of sources is, for "nothing changed since the last build" (names, objects or versions). */
export function sourcesKey(files: AiwsSourceFile[]): string {
  return JSON.stringify([...files].sort((a, b) => a.name.localeCompare(b.name)).map((f) => [f.name, f.obj_id ?? f.etag ?? '']))
}

/** Bytes a single build may carry inline (the service's limit). */
export const AIWS_MAX_INLINE_BYTES = 4 * 1024 * 1024

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** The `files` of `ext.build`: FileObjects by reference, everything else read over the file service and sent inline. */
export async function buildFiles(nfsp: NfspClient, files: AiwsSourceFile[]): Promise<({ name: string; obj_id: string } | { name: string; base64: string })[]> {
  const out: ({ name: string; obj_id: string } | { name: string; base64: string })[] = []
  let inline = 0
  for (const f of files) {
    if (f.obj_id?.startsWith('cyfile:')) { out.push({ name: f.name, obj_id: f.obj_id }); continue }
    if (!f.node_id) throw new AiwsSourceError([{ file: f.name, severity: 'error', message: 'the file service did not name this file' }])
    const bytes = new Uint8Array(await (await nfsp.readFile(f.node_id)).arrayBuffer())
    inline += bytes.length
    if (inline > AIWS_MAX_INLINE_BYTES) throw new AiwsSourceError([{ file: f.name, severity: 'error', message: `a control's files are limited to ${AIWS_MAX_INLINE_BYTES} bytes per build` }])
    out.push({ name: f.name, base64: base64(bytes) })
  }
  return out
}

// ---- component.json pre-check (the service's composer is authoritative; this catches the usual mistakes early)

const COMPONENT_KEYS = ['manifest_version', 'ident', 'kind', 'title', 'description', 'host_api', 'accepts', 'allow_no_source', 'default_size', 'config_schema', 'bindings', 'entry', 'assets', 'catalog', 'agent', 'deps']
const SCHEMA_KEYWORDS = ['type', 'enum', 'default', 'required', 'title', 'description', 'minimum', 'maximum', 'minLength', 'maxLength', 'properties', 'items']
const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/
const DID = /^did:[a-z0-9]+:[^/#\s]+$/
const BINDING = /^[a-z][a-z0-9_]{0,31}$/

function schemaProblems(v: unknown, path: string, out: string[]): void {
  if (!v || typeof v !== 'object' || Array.isArray(v)) { out.push(`${path}: a schema is an object`); return }
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (!SCHEMA_KEYWORDS.includes(k)) { out.push(`${path}/${k}: keyword ${k} is outside the supported subset`); continue }
    if (k === 'properties' && x && typeof x === 'object') for (const [n, s] of Object.entries(x as Record<string, unknown>)) schemaProblems(s, `${path}/properties/${n}`, out)
    if (k === 'items') schemaProblems(x, `${path}/items`, out)
  }
}

/** Check a `component.json` text against the files of its directory. Errors make a build fail; warnings do not. */
export function checkComponent(text: string, fileNames: string[]): AiwsDiagnostic[] {
  const out: AiwsDiagnostic[] = []
  const f = AIWS_COMPONENT_FILE
  const error = (message: string) => out.push({ file: f, severity: 'error', message })
  let c: Record<string, unknown>
  try {
    const parsed = JSON.parse(text) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { error('must be a JSON object'); return out }
    c = parsed as Record<string, unknown>
  } catch (e) {
    error(e instanceof Error ? e.message : String(e))
    return out
  }
  for (const k of Object.keys(c)) if (!COMPONENT_KEYS.includes(k)) error(`unknown key ${k}`)
  const mv = c.manifest_version
  if (typeof mv !== 'number' || !Number.isInteger(mv) || mv < 1) error('manifest_version (1) required')
  else if (mv > AIWS_MANIFEST_VERSION) error(`manifest_version ${mv} is newer than this client reads (${AIWS_MANIFEST_VERSION})`)
  const ident = c.ident as Record<string, unknown> | undefined
  if (!ident || typeof ident !== 'object') error('ident { author_did, name } required')
  else {
    if (typeof ident.author_did !== 'string' || !DID.test(ident.author_did)) error('ident.author_did must be a DID (did:<method>:<id>)')
    if (typeof ident.name !== 'string' || !NAME.test(ident.name)) error('ident.name must be [a-z0-9][a-z0-9._-]{0,63}')
    if (typeof ident.author_did === 'string' && typeof ident.name === 'string' && encoder.encode(`${ident.author_did}#${ident.name}`).length > 128) error('an identity is at most 128 bytes')
  }
  if (c.kind !== 'declarative' && c.kind !== 'html') error('kind must be declarative or html')
  if (typeof c.title !== 'string' || !c.title || c.title.length > 256) error('title: 1…256 characters')
  if (c.config_schema !== undefined) { const p: string[] = []; schemaProblems(c.config_schema, 'config_schema', p); p.forEach(error) }
  if (c.bindings !== undefined) {
    if (!c.bindings || typeof c.bindings !== 'object') error('bindings must be an object')
    else for (const n of Object.keys(c.bindings as object)) if (!BINDING.test(n) || n === 'props') error(`binding name ${n}: [a-z][a-z0-9_]{0,31}, not props`)
  }
  if (Array.isArray(c.deps) && c.deps.length > 0) error('deps must be empty: dependencies between controls come in a later version')
  const has = (n: unknown) => typeof n === 'string' && fileNames.includes(n)
  const named = new Set([f])
  if (c.kind === 'html') {
    const e = c.entry as Record<string, unknown> | undefined
    if (!e || typeof e !== 'object' || typeof e.html !== 'string') error('entry must be { html, css?, js? }')
    else for (const [k, n] of Object.entries(e)) { if (!has(n)) error(`entry.${k} ${JSON.stringify(n)} is not in the directory`); else named.add(String(n)) }
    if (c.host_api !== undefined && c.host_api !== AIWS_HTML_API_VERSION) error(`host_api: the HTML Block host speaks API ${AIWS_HTML_API_VERSION}`)
  } else if (c.kind === 'declarative') {
    if (!has(c.entry)) error(`entry ${JSON.stringify(c.entry)} is not in the directory`)
    else named.add(String(c.entry))
  }
  for (const a of Array.isArray(c.assets) ? c.assets : []) { if (!has(a)) error(`asset ${JSON.stringify(a)} is not in the directory`); else named.add(String(a)) }
  if (c.agent !== undefined) { if (!has(c.agent)) error(`agent ${JSON.stringify(c.agent)} is not in the directory`); else named.add(String(c.agent)) }
  for (const n of fileNames) if (!named.has(n)) out.push({ file: n, severity: 'warning', message: 'not named by component.json: kept in the source snapshot only' })
  return out
}

// ---- bundles (exports, the `aiws` sub-package of a PIKG)

/** Read an AIWS manifest of any supported version as the current one (Q19); a newer one is refused. */
export function compatManifest(value: unknown): AiwsManifest {
  if (!value || typeof value !== 'object') throw new AiwsSourceError([{ file: AIWS_MANIFEST_FILE, severity: 'error', message: 'must be a JSON object' }])
  const m = value as Record<string, unknown>
  const version = m.manifest_version
  if (typeof version !== 'number' || version < 1) throw new AiwsSourceError([{ file: AIWS_MANIFEST_FILE, severity: 'error', message: 'manifest_version required' }])
  if (version > AIWS_MANIFEST_VERSION) throw new AiwsSourceError([{ file: AIWS_MANIFEST_FILE, severity: 'error', message: `manifest_version ${version} needs a newer client (this one reads ${AIWS_MANIFEST_VERSION})` }])
  if (m.purpose !== 'aiws') throw new AiwsSourceError([{ file: AIWS_MANIFEST_FILE, severity: 'error', message: 'purpose must be aiws' }])
  if (!Array.isArray(m.controls)) throw new AiwsSourceError([{ file: AIWS_MANIFEST_FILE, severity: 'error', message: 'controls must be an array' }])
  return { manifest_version: version, purpose: 'aiws', host_api: (m.host_api as Record<string, number>) ?? {}, controls: m.controls as AiwsManifestControl[], workspace_templates: Array.isArray(m.workspace_templates) ? m.workspace_templates : [] }
}

/** Verify a bundle the way an installer does: manifest, each control's digest and component.json, no stray files. */
export async function verifyBundle(files: Map<string, Uint8Array>): Promise<{ manifest: AiwsManifest; diagnostics: AiwsDiagnostic[] }> {
  const raw = files.get(AIWS_MANIFEST_FILE)
  if (!raw) throw new AiwsSourceError([{ file: AIWS_MANIFEST_FILE, severity: 'error', message: 'missing' }])
  let parsed: unknown
  try { parsed = JSON.parse(decoder.decode(raw)) } catch (e) { throw new AiwsSourceError([{ file: AIWS_MANIFEST_FILE, severity: 'error', message: String(e) }]) }
  const manifest = compatManifest(parsed)
  const diagnostics: AiwsDiagnostic[] = []
  if (manifest.workspace_templates.length > 0) diagnostics.push({ file: AIWS_MANIFEST_FILE, severity: 'error', message: 'Workspace templates are not supported yet' })
  if (manifest.controls.length === 0) diagnostics.push({ file: AIWS_MANIFEST_FILE, severity: 'error', message: 'lists no control' })
  const dirs = new Set<string>()
  for (const c of manifest.controls) {
    if (typeof c.dir !== 'string' || !/^controls\/[a-z0-9][a-z0-9._-]{0,70}\/$/.test(c.dir) || dirs.has(c.dir)) { diagnostics.push({ file: AIWS_MANIFEST_FILE, severity: 'error', message: `control ${c.ident}: bad or repeated dir` }); continue }
    dirs.add(c.dir)
    const own: [string, Uint8Array][] = [...files].filter(([p]) => p.startsWith(c.dir)).map(([p, b]) => [p.slice(c.dir.length), b])
    if (own.some(([n]) => n.includes('/'))) diagnostics.push({ file: c.dir, severity: 'error', message: 'a control directory is flat' })
    if (await aiwsContentDigest(own) !== c.digest) diagnostics.push({ file: c.dir, severity: 'error', message: 'the files do not match the manifest digest' })
    const component = own.find(([n]) => n === AIWS_COMPONENT_FILE)
    if (!component) { diagnostics.push({ file: `${c.dir}${AIWS_COMPONENT_FILE}`, severity: 'error', message: 'missing' }); continue }
    for (const d of checkComponent(decoder.decode(component[1]), own.map(([n]) => n))) diagnostics.push({ ...d, file: `${c.dir}${d.file}` })
    try {
      const comp = JSON.parse(decoder.decode(component[1])) as { ident?: { author_did?: string; name?: string }; kind?: string }
      if (`${comp.ident?.author_did}#${comp.ident?.name}` !== c.ident || comp.kind !== c.kind) diagnostics.push({ file: c.dir, severity: 'error', message: 'ident and kind must match its component.json' })
    } catch { /* reported above */ }
  }
  for (const p of files.keys()) if (p !== AIWS_MANIFEST_FILE && ![...dirs].some((d) => p.startsWith(d))) diagnostics.push({ file: p, severity: 'error', message: 'belongs to no control of the manifest' })
  return { manifest, diagnostics }
}

/** The bundle of Workspace definitions (`ext.export`): the manifest plus every file's bytes. */
export async function exportBundle(client: AiwsExtRpc, workspaceId: string, entityIds: string[], fetchAsset: (workspaceId: string, objId: string) => Promise<Uint8Array>): Promise<AiwsBundle & { controls: Record<string, unknown>[] }> {
  const r = await client.extExport(workspaceId, entityIds, 'package')
  const files = new Map<string, Uint8Array>()
  files.set(AIWS_MANIFEST_FILE, encoder.encode(`${JSON.stringify(r.manifest, null, 2)}\n`))
  for (const f of r.files) files.set(f.path, f.text !== undefined ? encoder.encode(f.text) : await fetchAsset(workspaceId, String(f.obj_id)))
  return { manifest: compatManifest(r.manifest), files, controls: r.controls }
}

// ---- the home folder over NFSP

/** The entry `name` of a folder, found with a filtered listing (no request fails for a missing name). */
async function child(nfsp: NfspClient, folder: WireRef | string, name: string) {
  const glob = /[*?[\]\\]/.test(name) ? undefined : name
  const page = await nfsp.list(typeof folder === 'string' ? folder : { ref: folder }, { limit: glob ? 10 : 1000, ...(glob ? { filter: { name_glob: glob } } : {}) }, ['base', 'ident'])
  return page.entries.find((e) => e.name === name)
}

/** Make sure a folder exists, creating each missing level below the realm root (`/home`); answers its ref. Levels
 * are looked up by listing their parent, so a missing one is not a failed request. */
export async function ensureFolder(nfsp: NfspClient, path: string): Promise<WireRef> {
  const parts = path.split('/').filter(Boolean)
  if (parts.length === 0) throw new Error(`not a folder path: ${path}`)
  let ref = (await nfsp.stat(`/${parts[0]}`)).ref
  for (const name of parts.slice(1)) {
    const hit = await child(nfsp, ref, name)
    if (hit && hit.target.kind !== 'dir') throw new AiwsSourceError([{ file: name, severity: 'error', message: `${name} in ${path} is not a folder` }])
    ref = hit ? hit.target.ref : (await nfsp.mkdir({ ref }, name)).ref
  }
  return ref
}

/** A folder's ref, or null when it (or a level above it) does not exist — found without failed requests. */
export async function findFolder(nfsp: NfspClient, path: string): Promise<WireRef | null> {
  const parts = path.split('/').filter(Boolean)
  if (parts.length === 0) return null
  let ref = (await nfsp.stat(`/${parts[0]}`)).ref
  for (const name of parts.slice(1)) {
    const hit = await child(nfsp, ref, name)
    if (!hit || hit.target.kind !== 'dir') return null
    ref = hit.target.ref
  }
  return ref
}

/** Whether a folder holds a control source (its component.json). */
export async function hasControlSource(nfsp: NfspClient, dir: string): Promise<boolean> {
  const ref = await findFolder(nfsp, dir)
  return ref !== null && (await child(nfsp, ref, AIWS_COMPONENT_FILE)) !== undefined
}

/** Write one file into a folder (replacing it). */
export async function writeHomeFile(nfsp: NfspClient, dir: string | WireRef, name: string, bytes: Uint8Array): Promise<void> {
  const ref = typeof dir === 'string' ? await ensureFolder(nfsp, dir) : dir
  await nfsp.uploadFile(ref, name, bytes, { overwrite: true })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** The files of a control's source folder (flat; dot files are the client's own and skipped). */
export async function collectSources(nfsp: NfspClient, dir: string): Promise<AiwsSourceFile[]> {
  const out: AiwsSourceFile[] = []
  const problems: AiwsDiagnostic[] = []
  let cursor: string | undefined
  do {
    const page = await nfsp.list(dir, { limit: 500, ...(cursor ? { cursor } : {}) }, ['base', 'ident'])
    for (const e of page.entries) {
      if (e.name.startsWith('.')) continue
      if (e.target.kind !== 'file') { problems.push({ file: e.name, severity: 'error', message: 'a control source folder is flat: move files out of sub-folders' }); continue }
      const ref = e.target.ref
      const objId = ref.type === 'object' ? ref.obj_id : typeof e.target.attrs?.obj_id === 'string' ? e.target.attrs.obj_id : undefined
      out.push({
        name: e.name,
        ...(objId ? { obj_id: objId } : {}),
        ...(ref.type === 'live' ? { node_id: ref.node_id } : {}),
        ...(typeof e.target.attrs?.etag === 'string' ? { etag: e.target.attrs.etag } : {}),
        ...(typeof e.target.attrs?.size === 'number' ? { size: e.target.attrs.size } : {}),
      })
    }
    cursor = page.truncated ? page.next_cursor : undefined
  } while (cursor)
  if (out.length === 0) problems.push({ file: '', severity: 'error', message: `${dir} holds no files` })
  if (out.length > AIWS_MAX_SOURCE_FILES) problems.push({ file: '', severity: 'error', message: `a control holds at most ${AIWS_MAX_SOURCE_FILES} files` })
  if (problems.some((p) => p.severity === 'error')) throw new AiwsSourceError(problems)
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export async function readBuildState(nfsp: NfspClient, dir: string): Promise<AiwsBuildState | null> {
  try {
    const entry = await child(nfsp, dir, AIWS_BUILD_STATE_FILE)
    const nodeId = entry?.target.ref.type === 'live' ? entry.target.ref.node_id : undefined
    if (!nodeId) return null
    const response = await nfsp.readFile(nodeId)
    return (await response.json()) as AiwsBuildState
  } catch {
    return null
  }
}

export async function writeBuildState(nfsp: NfspClient, dir: string, state: AiwsBuildState): Promise<void> {
  await writeHomeFile(nfsp, dir, AIWS_BUILD_STATE_FILE, encoder.encode(`${JSON.stringify(state, null, 2)}\n`))
}

export interface AiwsBuildOptions { folderId?: string; force?: boolean; dryRun?: boolean }

/**
 * Build the control in `dir` into a Workspace: collect the files, call `ext.build` with the base recorded in
 * `.aiws-build.json` (when it is this Workspace's), and record the new base. Service refusals throw `AiwsFailure`
 * (`BUILD_FAILED` carries `data.diagnostics`); source problems throw `AiwsSourceError`.
 */
export async function buildControl(client: AiwsExtRpc, nfsp: NfspClient, workspaceId: string, dir: string, opts: AiwsBuildOptions = {}): Promise<Record<string, unknown> & { files: AiwsSourceFile[] }> {
  const files = await collectSources(nfsp, dir)
  const state = await readBuildState(nfsp, dir)
  const base = state && state.workspace_id === workspaceId ? { def_rev: state.def_rev, dir_rev: state.dir_rev } : undefined
  const result = await client.extBuild(workspaceId, {
    files: await buildFiles(nfsp, files),
    ...(opts.folderId ? { folder_id: opts.folderId } : {}),
    ...(base ? { expect: base } : {}),
    ...(opts.force ? { force: true } : {}),
    ...(opts.dryRun ? { dry_run: true } : {}),
  })
  if (!opts.dryRun && typeof result.def_entity_id === 'string' && typeof result.def_rev === 'number') {
    await writeBuildState(nfsp, dir, { workspace_id: workspaceId, def_entity_id: result.def_entity_id, def_rev: result.def_rev, dir_rev: Number(result.dir_rev ?? 0), ident: String(result.ident ?? ''), at: new Date().toISOString() })
  }
  return { ...result, files }
}

/**
 * Write a definition's Workspace snapshot into `outDir` (a definition never built from source gets synthesized
 * files) and record it as the base of the next build.
 */
export async function pullControl(client: AiwsExtRpc, nfsp: NfspClient, workspaceId: string, defEntityId: string, outDir: string, fetchAsset: (workspaceId: string, objId: string) => Promise<Uint8Array>): Promise<{ files: string[]; state: AiwsBuildState }> {
  const r = await client.extExport(workspaceId, [defEntityId], 'pull')
  const control = r.controls[0] as { entity_id: string; ident: string; def_rev: number; dir_rev: number; files: { name: string; obj_id?: string; text?: string }[] }
  const ref = await ensureFolder(nfsp, outDir)
  for (const f of control.files) await writeHomeFile(nfsp, ref, f.name, f.text !== undefined ? encoder.encode(f.text) : await fetchAsset(workspaceId, String(f.obj_id)))
  const state: AiwsBuildState = { workspace_id: workspaceId, def_entity_id: control.entity_id, def_rev: control.def_rev, dir_rev: control.dir_rev, ident: control.ident, at: new Date().toISOString() }
  await writeBuildState(nfsp, outDir, state)
  return { files: control.files.map((f) => f.name), state }
}

/**
 * Rebuild whenever the folder changes: NFSP watch events (lossy: a `resync` lists again), debounced, and only when
 * the files' objects differ from the last build. Returns when `signal` aborts.
 */
export async function watchControl(nfsp: NfspClient, dir: string, onChange: (files: AiwsSourceFile[]) => Promise<void>, opts: { debounceMs?: number; signal?: AbortSignal } = {}): Promise<void> {
  let last = ''
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = Promise.resolve()
  const check = () => {
    running = running.then(async () => {
      let files: AiwsSourceFile[]
      try { files = await collectSources(nfsp, dir) } catch { return }
      const key = sourcesKey(files)
      if (key === last) return
      last = key
      await onChange(files)
    }).catch(() => undefined)
  }
  check()
  while (!opts.signal?.aborted) {
    const listing = await nfsp.list(dir, { limit: 1 }, ['base'])
    const stream = nfsp.watch({ tokens: listing.watch_token ? [listing.watch_token] : [], signal: opts.signal })
    try {
      for await (const _ of stream) {
        if (timer) clearTimeout(timer)
        timer = setTimeout(check, opts.debounceMs ?? 500)
      }
    } catch {
      if (opts.signal?.aborted) break
      await sleep(2_000)
    } finally {
      stream.close()
    }
  }
  if (timer) clearTimeout(timer)
  await running
}

// ---- skeletons

export interface AiwsSkeletonOptions { authorDid: string; name: string; title?: string; kind?: 'declarative' | 'html' }

/** The files of a new control: a minimal working declarative or HTML control with one optional binding. */
export function controlSkeleton(opts: AiwsSkeletonOptions): Record<string, string> {
  const title = opts.title ?? opts.name
  const base = {
    manifest_version: AIWS_MANIFEST_VERSION,
    ident: { author_did: opts.authorDid, name: opts.name },
    kind: opts.kind ?? 'declarative',
    title,
    description: `${title}: a control of this Workspace`,
    accepts: ['buckyos.table-source', 'buckyos.record'],
    allow_no_source: true,
    default_size: { w: 260, h: 140 },
    config_schema: { type: 'object', properties: { label: { type: 'string', title: 'Label', default: title } } },
    bindings: { data: { accepts: ['buckyos.table-source'], title: 'Data', description: 'The table this control summarizes' } },
    catalog: { group: 'custom', description: `${title}` },
    agent: 'AGENT.md',
  }
  const agent = `# ${title}\n\nBind \`data\` to a table. Config: \`label\` (text).\n`
  if (opts.kind === 'html') {
    return {
      [AIWS_COMPONENT_FILE]: `${JSON.stringify({ ...base, host_api: AIWS_HTML_API_VERSION, entry: { html: 'view.html', css: 'style.css', js: 'behavior.js' } }, null, 2)}\n`,
      'view.html': '<div class="card"><div class="label" id="label"></div><div class="value" id="value">—</div></div>\n',
      'style.css': '.card{font:14px system-ui;padding:12px}.label{opacity:.7}.value{font-size:28px;font-weight:600}\n',
      'behavior.js': "document.getElementById('label').textContent = (aiws.context.config || {}).label || ''\nif (aiws.bindings.data) aiws.input('data').rows().then(function (rows) { document.getElementById('value').textContent = String(rows.length) })\n",
      'AGENT.md': agent,
    }
  }
  return {
    [AIWS_COMPONENT_FILE]: `${JSON.stringify({ ...base, entry: 'declarative.json' }, null, 2)}\n`,
    'declarative.json': `${JSON.stringify({ layout: 'stack', items: [{ kind: 'metric', label: title, bind: 'data.count', format: 'number' }, { kind: 'text', text: 'Rows of the bound table' }] }, null, 2)}\n`,
    'AGENT.md': agent,
  }
}

/** Create a control's source folder from a skeleton (refuses to overwrite a folder that has a component.json). */
export async function createControlSource(nfsp: NfspClient, dir: string, files: Record<string, string>): Promise<WireRef> {
  const ref = await ensureFolder(nfsp, dir)
  const existing = await nfsp.list({ ref }, { limit: 500 }, ['base']).catch(() => null)
  if (existing?.entries.some((e) => e.name === AIWS_COMPONENT_FILE)) throw new AiwsSourceError([{ file: AIWS_COMPONENT_FILE, severity: 'error', message: `${dir} already holds a control` }])
  for (const [name, text] of Object.entries(files)) await writeHomeFile(nfsp, ref, name, encoder.encode(text))
  return ref
}
