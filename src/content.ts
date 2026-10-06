import { extensionOf, mediaTypeFromExtension } from './content_mime'
export { extensionOf, mediaTypeFromExtension, TEXT_CODE_EXTENSIONS } from './content_mime'

export type TransferableContentRef =
  | { kind: 'cyfs-path'; path: string; version?: string }
  | { kind: 'object-id'; objectId: string; version?: string }
export type TransferableSessionContext =
  | { kind: 'single' }
  | { kind: 'container'; container: TransferableContentRef; current: TransferableContentRef; sort?: unknown; navigation?: 'wrap' | 'bounded' }
  | { kind: 'list'; sessionId?: string; version?: string; items: Array<{ id?: string; source: TransferableContentRef; title?: string }>; currentIndex: number; navigation?: 'wrap' | 'bounded' }
export interface OpenRequest {
  requestId: string
  source: TransferableContentRef
  session?: TransferableSessionContext
  mode?: 'view' | 'edit'
  origin?: { appInstanceId?: string; windowId?: string; hostContext?: string }
}
export interface ContentSelector {
  objType?: string | string[]
  mime?: string | string[]
  schema?: string | string[]
  ext?: string[]
  maxSize?: number
}
export interface ContentDescriptor {
  source: TransferableContentRef
  objType?: string
  mime?: string
  schema?: string
  ext?: string
  name?: string
  size?: number
}
export interface OpenBinding {
  entry: { type: 'web'; path: string } | { type: 'builtin'; target: string }
  modes?: Array<'view' | 'edit'>
  fidelity?: 'full' | 'partial'
  window?: 'reuse' | 'new'
  multiSource?: boolean
  priority?: number
}
export interface ContentHandlerEntry {
  provider: 'app' | 'system'
  app_instance_id?: string
  app_doc_object_id?: string
  app_version?: string
  handler_id: string
  handler_version: number
  selectors: ContentSelector[]
  intents: { open?: OpenBinding }
  permissions?: string[]
  enabled: boolean
  registered_at?: number
}
export interface ContentRegistry { schema_version: 1; updated_at?: number; handlers: Record<string, ContentHandlerEntry> }
export interface ContentDefaults { schema_version: 1; defaults: { open?: Record<string, string> }; disabled: string[] }
export interface HandlerPlan {
  handlerKey: string
  handlerRef: string
  appInstanceId?: string
  appDocObjectId?: string
  handlerVersion: number
  intent: 'open'
  binding: OpenBinding
  matched: { selector: ContentSelector; specificity: number }
  reason: 'user-default' | 'system-default' | 'ranked'
}
export const previewHandler: ContentHandlerEntry = {
  provider: 'system', handler_id: 'preview', handler_version: 1,
  selectors: [{ mime: '*/*' }], enabled: true,
  intents: { open: { entry: { type: 'builtin', target: 'preview' }, modes: ['view'], fidelity: 'partial', window: 'reuse', priority: 90 } },
}
export const emptyDefaults = (): ContentDefaults => ({ schema_version: 1, defaults: {}, disabled: [] })
export const contentRefString = (ref: TransferableContentRef): string => ref.kind === 'cyfs-path' ? ref.path : `obj://${ref.objectId}`
export function isTransferableRef(value: unknown): value is TransferableContentRef {
  if (!value || typeof value !== 'object') return false
  const v = value as TransferableContentRef
  return (v.kind === 'cyfs-path' && typeof v.path === 'string' && /^cyfs:\/\/\/[^\0]*$/.test(v.path)) ||
    (v.kind === 'object-id' && typeof v.objectId === 'string' && /^[\w.-]+:[\w-]+$/.test(v.objectId))
}
export function isOpenRequest(value: unknown): value is OpenRequest {
  if (!value || typeof value !== 'object') return false
  const v = value as OpenRequest
  return typeof v.requestId === 'string' && isTransferableRef(v.source) &&
    (v.mode === undefined || v.mode === 'view' || v.mode === 'edit') &&
    (v.session === undefined || isTransferableSession(v.session))
}
export function isTransferableSession(value: unknown): value is TransferableSessionContext {
  if (!value || typeof value !== 'object') return false
  const v = value as TransferableSessionContext
  return v.kind === 'single' ||
    (v.kind === 'container' && isTransferableRef(v.container) && isTransferableRef(v.current)) ||
    (v.kind === 'list' && Array.isArray(v.items) && v.items.every(i => i && isTransferableRef(i.source)) &&
      Number.isInteger(v.currentIndex) && v.currentIndex >= 0 && v.currentIndex < v.items.length)
}
export function contentDescriptor(source: TransferableContentRef, hints: { name?: string; mime?: string; size?: number } = {}): ContentDescriptor {
  const name = hints.name ?? contentRefString(source).split('/').pop() ?? ''
  const ext = extensionOf(name)
  return { source, name, size: hints.size, ext: ext ? `.${ext}` : undefined,
    objType: source.kind === 'cyfs-path' ? 'cyfile' : source.objectId.split(':')[0],
    mime: hints.mime || mediaTypeFromExtension(ext) || 'application/octet-stream' }
}
const values = (v?: string | string[]) => v === undefined ? [] : Array.isArray(v) ? v : [v]
export function matchSelector(s: ContentSelector, d: ContentDescriptor): number {
  if (s.maxSize !== undefined && d.size !== undefined && d.size > s.maxSize) return 0
  if (s.objType && !values(s.objType).includes(d.objType ?? '')) return 0
  let score = s.objType ? 2 : 1
  if (s.schema) {
    const matches = values(s.schema).filter(v => v.endsWith('*') ? d.schema?.startsWith(v.slice(0, -1)) : d.schema === v)
    if (!matches.length) return 0
    score = matches.some(v => v === d.schema) ? 7 : 6
  }
  if (s.mime) {
    const mime = (d.mime ?? '').toLowerCase().split(';')[0].trim()
    const scores = values(s.mime).map(v => {
      v = v.toLowerCase()
      if (v === '*/*') return 1
      if (v.split(';')[0].trim() === mime) return s.objType ? 6 : 5
      if (v.includes('/*+') && mime.startsWith(v.split('/')[0] + '/') && mime.endsWith(v.slice(v.indexOf('+')))) return 4
      if (v.endsWith('/*') && mime.startsWith(v.slice(0, -1))) return 3
      return 0
    })
    const best = Math.max(...scores, 0)
    if (!best) return 0
    score = Math.max(score, best)
  }
  if (!s.mime && !s.objType && !s.schema && !s.ext?.includes(d.ext ?? '')) return 0
  return score
}
function compactSelector(value: string): ContentSelector {
  const out: ContentSelector = {}
  for (const part of value.split(';')) {
    const i = part.indexOf(':'); const key = part.slice(0, i); const v = part.slice(i + 1)
    if (key === 'obj') out.objType = v
    else if (key === 'mime') out.mime = v
    else if (key === 'schema') out.schema = v
    else if (key === 'ext') out.ext = [v]
    else return {}
  }
  return out
}
export function resolveContentHandlers(registry: ContentRegistry, defaults: ContentDefaults, descriptor: ContentDescriptor,
  intent: 'open' = 'open', _host: unknown = {}, availableApps: Iterable<string> = []): HandlerPlan[] {
  const visible = new Set(availableApps)
  const handlers = { ...registry.handlers, 'system#preview': previewHandler }
  const preferred = Object.entries(defaults.defaults.open ?? {})
    .map(([s, key]) => ({ key, score: matchSelector(compactSelector(s), descriptor) }))
    .filter(v => v.score > 0).sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
  const matches = Object.entries(handlers).flatMap(([key, h]) => {
    const binding = h.intents[intent]
    if (!binding || !h.enabled || (key !== 'system#preview' && defaults.disabled.includes(key))) return []
    if (h.provider === 'app' && (!h.app_instance_id || !visible.has(h.app_instance_id) || binding.entry.type !== 'web')) return []
    const selectors = h.selectors.map(selector => ({ selector, specificity: matchSelector(selector, descriptor) }))
      .filter(s => s.specificity > 0).sort((a, b) => b.specificity - a.specificity)
    if (!selectors.length) return []
    return [{ key, h, binding, matched: selectors[0] }]
  })
  const preferredKey = preferred.find(p => matches.some(m => m.key === p.key))?.key
  matches.sort((a, b) => Number(b.key === preferredKey) - Number(a.key === preferredKey) ||
    Number(b.matched.specificity > 1 || b.h.provider === 'system') - Number(a.matched.specificity > 1 || a.h.provider === 'system') ||
    b.matched.specificity - a.matched.specificity || (b.binding.priority ?? 0) - (a.binding.priority ?? 0) ||
    Number(b.h.provider === 'system') - Number(a.h.provider === 'system') ||
    (a.h.registered_at ?? 0) - (b.h.registered_at ?? 0) || a.key.localeCompare(b.key))
  return matches.map(m => ({ handlerKey: m.key, handlerRef: `${m.h.app_instance_id?.split('@')[0] ?? 'system'}#${m.h.handler_id}`,
    appInstanceId: m.h.app_instance_id, appDocObjectId: m.h.app_doc_object_id, handlerVersion: m.h.handler_version,
    intent, binding: m.binding, matched: m.matched,
    reason: m.key === preferredKey ? 'user-default' : m.h.provider === 'system' ? 'system-default' : 'ranked' }))
}
export function parentSource(source: TransferableContentRef): TransferableContentRef | undefined {
  if (source.kind !== 'cyfs-path') return undefined
  const i = source.path.lastIndexOf('/')
  return i >= 7 ? { kind: 'cyfs-path', path: source.path.slice(0, i) || 'cyfs:///' } : undefined
}
export function encodeSession(session: TransferableSessionContext | undefined, source: TransferableContentRef): string {
  if (!session) return ''
  const encode = (v: TransferableSessionContext) => btoa(Array.from(new TextEncoder().encode(JSON.stringify(v)), b => String.fromCharCode(b)).join(''))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const encoded = encode(session)
  if (encoded.length <= 2048 || session.kind !== 'list') return encoded
  const parent = parentSource(source)
  if (parent && session.items.every(i => contentRefString(parentSource(i.source) ?? i.source) === contentRefString(parent))) {
    return encode({ kind: 'container', container: parent, current: source })
  }
  return ''
}
export function expandOpenPath(path: string, request: OpenRequest, modes: Array<'view' | 'edit'> = ['view', 'edit']): string {
  if (!path.startsWith('/') || path.startsWith('//') || /(?:\.\.|\\|[\r\n])/.test(decodeURIComponent(path))) throw new Error('Invalid App entry path')
  const params: Record<string, string> = { source: contentRefString(request.source), mode: request.mode ?? (modes.includes('edit') ? 'edit' : 'view'), session: encodeSession(request.session, request.source) }
  const expanded = path.replace(/\{(source|mode|session)\}/g, (_, key: string) => encodeURIComponent(params[key]))
  return expanded + (expanded.includes('?') ? '&' : '?') + 'requestId=' + encodeURIComponent(request.requestId)
}
export class ContentRegistryClient {
  registry: ContentRegistry = { schema_version: 1, handlers: {} }
  defaults = emptyDefaults()
  updatedAt = 0
  private listeners = new Set<() => void>()
  constructor(private config: { get(key: string): Promise<{ value: string }>; set(key: string, value: string): Promise<unknown> }, private userId: string) {}
  async refresh(): Promise<void> {
    const [registry, defaults] = await Promise.all([this.config.get('system/content_registry'), this.config.get(`users/${this.userId}/content_defaults`).catch(error => { if (/not found|not_found/i.test(String(error))) return null; throw error })])
    this.registry = JSON.parse(registry.value)
    this.defaults = defaults ? JSON.parse(defaults.value) : emptyDefaults()
    this.updatedAt = Date.now()
    this.listeners.forEach(cb => cb())
  }
  async setDefault(intent: 'open', selector: string, handlerKey: string | null): Promise<void> {
    await this.refresh()
    const next = { ...this.defaults.defaults[intent] }
    if (handlerKey) next[selector] = handlerKey
    else delete next[selector]
    await this.persist({ ...this.defaults, defaults: { ...this.defaults.defaults, [intent]: next } })
  }
  async setEnabled(key: string, enabled: boolean): Promise<void> {
    await this.refresh()
    await this.persist({ ...this.defaults, disabled: [...new Set([...this.defaults.disabled.filter(k => k !== key), ...enabled ? [] : [key]])] })
  }
  onChanged(cb: () => void): () => void { this.listeners.add(cb); return () => this.listeners.delete(cb) }
  private async persist(next: ContentDefaults): Promise<void> {
    await this.config.set(`users/${this.userId}/content_defaults`, JSON.stringify(next))
    this.defaults = next
    this.listeners.forEach(cb => cb())
  }
}
