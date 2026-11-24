import { isOpenRequest, isTransferableRef, isTransferableSession, readContentHints, readSelectDialogResult, systemOpenUrl, SELECT_DIALOG_PATH, SystemDialogError, SYSTEM_DIALOG_ERROR_CODES, type ContentHints, type ContentOpenTarget, type OpenRequest, type SelectDialogParams, type SelectDialogResult, type SystemDialogErrorCode, type TransferableContentRef, type TransferableSessionContext } from './content'
import { readAppOpenRequest, systemOpenAppUrl, type AppOpenRequest } from './open_app'
import { getBuckyApi, type BuckyApi, type RuntimeContainer } from './runtime_env'
export type SystemDialogReply = { ok: true; result: unknown } | { ok: false; code: SystemDialogErrorCode }
const dialogErrorCode = (value: unknown): SystemDialogErrorCode =>
  SYSTEM_DIALOG_ERROR_CODES.includes(value as SystemDialogErrorCode) ? value as SystemDialogErrorCode : 'protocol'
export interface AppFrameMessage<T extends string = string, P = unknown> {
  protocol: 'buckyos.app-frame'; version: 1; type: T; id?: string; replyTo?: string; payload: P
}
export interface FrameInit {
  nonce: string
  windowId: string
  formFactor: 'desktop' | 'mobile'
  theme: { mode: 'light' | 'dark'; accent?: string }
  locale: string
  launch?: OpenRequest
  shellCapabilities: string[]
  /** `tab`: the App fills a tab of the host, which has its own navigation, so the App leaves out its outer one. */
  presentation?: 'window' | 'tab'
  container?: RuntimeContainer
}
export type CloseDecision = 'allow' | 'deny' | 'pending'
export type AppOpenErrorCode = 'not_found' | 'denied' | 'unsupported'
export type AppOpenReply = { ok: true } | { ok: false; code: AppOpenErrorCode }
export interface HeaderItem { id: string; label: string; active?: boolean }
/** `icon`: the name of an icon, or the address of an image. */
export interface HeaderMenuItem { id: string; label: string; icon?: string; danger?: boolean }
/**
 * What an App puts into the header the host draws above it (mobile containers; elsewhere it is ignored). A field left
 * out keeps its value; an empty list, or `null` for the search, removes it.
 */
export interface HeaderState {
  title?: string
  /** A second row below the title, such as tabs. Only a `standard` header has room for it. */
  second_row?: HeaderItem[]
  search?: { placeholder?: string; value?: string } | null
  menu?: HeaderMenuItem[]
  /** Whether the back button applies inside the App; pressing it arrives as `frame.back`. */
  back?: boolean
}
/** `search`: `value` is the text; `item` and `menu`: `id` is the entry that was chosen. */
export interface HeaderEvent { kind: 'search' | 'item' | 'menu'; id?: string; value?: string }
const text = (value: unknown, max: number): string | undefined => typeof value === 'string' ? value.slice(0, max) : undefined
function readHeaderList<T extends HeaderMenuItem | HeaderItem>(value: unknown, read: (v: Record<string, unknown>, base: { id: string; label: string }) => T): T[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 32).flatMap((entry: unknown) => {
    const v = entry as Record<string, unknown> | null
    if (!v || typeof v !== 'object' || typeof v.id !== 'string' || !v.id || v.id.length > 128 || typeof v.label !== 'string') return []
    return [read(v, { id: v.id, label: v.label.slice(0, 128) })]
  })
}
/** Reads the header an App asks for; only the fields it gave are in the result. */
function readHeader(p: Record<string, unknown>): HeaderState {
  const header: HeaderState = {}
  const title = text(p.title, 256)
  if (title !== undefined) header.title = title
  if (Array.isArray(p.second_row)) header.second_row = readHeaderList<HeaderItem>(p.second_row, (v, base) => ({ ...base, ...(v.active === true ? { active: true } : {}) }))
  if (Array.isArray(p.menu)) header.menu = readHeaderList<HeaderMenuItem>(p.menu, (v, base) => ({ ...base, ...(typeof v.icon === 'string' ? { icon: v.icon.slice(0, 2048) } : {}), ...(v.danger === true ? { danger: true } : {}) }))
  if (p.search === null) header.search = null
  else if (p.search && typeof p.search === 'object') {
    const search = p.search as Record<string, unknown>
    const placeholder = text(search.placeholder, 128), value = text(search.value, 1024)
    header.search = { ...(placeholder !== undefined ? { placeholder } : {}), ...(value !== undefined ? { value } : {}) }
  }
  if (typeof p.back === 'boolean') header.back = p.back
  return header
}
/**
 * A channel to one peer that the platform has already identified. The native client's bridge is one: it knows which
 * view a message comes from, so there is no origin to check.
 */
export interface AppFrameTransport {
  post(message: AppFrameMessage): void
  onMessage(cb: (message: unknown) => void): () => void
}
/** The channel to another window: messages count only when they come from that window and that origin. */
function windowTransport(peer: () => Window | null, origin: string): AppFrameTransport {
  return {
    post: message => peer()?.postMessage(message, origin),
    onMessage: cb => {
      const own = window
      const listener = (event: MessageEvent) => { if (event.source === peer() && event.origin === origin) cb(event.data) }
      own.addEventListener('message', listener)
      return () => own.removeEventListener('message', listener)
    },
  }
}
function bridgeTransport(api: BuckyApi): AppFrameTransport {
  return {
    post: message => { void Promise.resolve(api.call('frame.post', message)).catch(() => {}) },
    onMessage: cb => api.on('frame.message', cb),
  }
}
const envelope = (type: string, payload: unknown, extra: { id?: string; replyTo?: string } = {}): AppFrameMessage =>
  ({ protocol: 'buckyos.app-frame', version: 1, type, payload, ...extra })
const isMessage = (value: unknown): value is AppFrameMessage => {
  if (!value || typeof value !== 'object') return false
  const v = value as AppFrameMessage
  return v.protocol === 'buckyos.app-frame' && v.version === 1 && typeof v.type === 'string' && !!v.payload && typeof v.payload === 'object'
}
export interface AppFrameHostCallbacks {
  onReady?: () => void
  onTitle?: (title: string, dirty: boolean) => void
  onRequestClose?: () => void
  onContentOpen?: (request: OpenRequest, target: ContentOpenTarget, options: { newWindow: boolean; hints: ContentHints }) => void
  /** Opens another App, or a page of one (`app.open`). Without a `zone` the request is for the App's own Zone. */
  onAppOpen?: (request: AppOpenRequest) => Promise<AppOpenReply> | AppOpenReply
  /** The header the App wants now (`header.set`), with everything it set so far. */
  onHeader?: (header: HeaderState) => void
  /** Shows a system dialog the App asked for (`sysdlg.open`). `params` is untrusted input: validate it. */
  onSystemDialog?: (path: string, params: unknown) => Promise<SystemDialogReply>
}
/**
 * `target` and `origin`: the App runs in a frame of this page, opened with `#bfp=<init.nonce>`. `transport`: the
 * platform connects this host to the App's view; the App picks the nonce and the host answers with it.
 */
export type AppFrameHostOptions = AppFrameHostCallbacks & (
  | { target: () => Window | null; origin: string; init: FrameInit; transport?: undefined }
  | { transport: AppFrameTransport; init: Omit<FrameInit, 'nonce'>; target?: undefined; origin?: undefined })
/** Opening requests an App may send in ten seconds, for each kind. */
const OPEN_LIMIT = 5
export class AppFrameHost {
  ready = false
  capabilities: string[] = []
  header: HeaderState = {}
  private init: FrameInit
  private readonly framed: boolean
  private readonly channel: AppFrameTransport
  private readonly detach: () => void
  private readonly callbacks: AppFrameHostCallbacks
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout>; type: string }>()
  private opens = new Map<string, number[]>()
  constructor(options: AppFrameHostOptions) {
    this.callbacks = options
    this.framed = !options.transport
    this.init = options.transport ? { ...options.init, nonce: '' } : options.init
    this.channel = options.transport ?? windowTransport(options.target, options.origin)
    this.detach = this.channel.onMessage(message => this.receive(message))
  }
  private focused?: boolean
  private dialogOpen = false
  private limited(type: string): boolean {
    const recent = (this.opens.get(type) ?? []).filter(t => t > Date.now() - 10000)
    this.opens.set(type, recent)
    if (recent.length >= OPEN_LIMIT) return true
    recent.push(Date.now())
    return false
  }
  private async appOpen(id: string, payload: unknown): Promise<void> {
    const reply = (result: AppOpenReply) => { if (this.ready) this.channel.post(envelope('app.openResult', result, { replyTo: id })) }
    if (!this.callbacks.onAppOpen) return reply({ ok: false, code: 'unsupported' })
    const request = readAppOpenRequest(payload)
    if (!request || this.limited('app.open')) return reply({ ok: false, code: 'denied' })
    try { reply(await this.callbacks.onAppOpen(request)) }
    catch { reply({ ok: false, code: 'denied' }) }
  }
  private async systemDialog(id: string, path: unknown, params: unknown): Promise<void> {
    const reply = (payload: SystemDialogReply) => { if (this.ready) this.channel.post(envelope('sysdlg.openResult', payload, { replyTo: id })) }
    if (!this.callbacks.onSystemDialog || typeof path !== 'string') return reply({ ok: false, code: 'unsupported' })
    if (this.dialogOpen) return reply({ ok: false, code: 'busy' })
    this.dialogOpen = true
    try { reply(await this.callbacks.onSystemDialog(path, params)) }
    catch (error) { reply({ ok: false, code: error instanceof SystemDialogError ? error.code : 'closed' }) }
    finally { this.dialogOpen = false }
  }
  private receive(m: unknown): void {
    if (!isMessage(m)) return
    const p = m.payload as Record<string, unknown>
    if (m.type === 'frame.hello') {
      if (!Array.isArray(p.appCapabilities)) return
      if (this.framed) { if (p.nonce !== this.init.nonce) return }
      else {
        if (typeof p.nonce !== 'string' || !p.nonce || p.nonce.length > 128) return
        // Another document took the view over: the one before it will not answer any more.
        if (p.nonce !== this.init.nonce) this.failPending('App frame reloaded')
        this.init = { ...this.init, nonce: p.nonce }
      }
      this.ready = true
      this.capabilities = p.appCapabilities.filter((c): c is string => typeof c === 'string')
      this.send('frame.init', this.init)
      if (this.focused !== undefined) this.send('frame.focusChanged', { focused: this.focused })
      if (Object.keys(this.header).length) { this.header = {}; this.callbacks.onHeader?.({}) }
      this.callbacks.onReady?.()
      return
    }
    if (!this.ready) return
    if (m.replyTo) {
      const pending = this.pending.get(m.replyTo)
      if (pending && m.type === pending.type + 'Result') {
        clearTimeout(pending.timer); this.pending.delete(m.replyTo); pending.resolve(m.payload)
      }
      return
    }
    if (m.type === 'window.setTitle' && typeof p.title === 'string') this.callbacks.onTitle?.(p.title.slice(0, 256), p.dirty === true)
    if (m.type === 'window.requestClose') this.callbacks.onRequestClose?.()
    if (m.type === 'header.set') { this.header = { ...this.header, ...readHeader(p) }; this.callbacks.onHeader?.(this.header) }
    if (m.type === 'app.open' && typeof m.id === 'string') void this.appOpen(m.id, p)
    if (m.type === 'sysdlg.open' && typeof m.id === 'string') void this.systemDialog(m.id, p.path, p.params)
    if (m.type === 'content.open' && (p.target === 'default' || p.target === 'preview' || p.target === 'chooser')) {
      const request = { ...(p.request as object), requestId: crypto.randomUUID() }
      if (!isOpenRequest(request) || this.limited('content.open')) return
      this.callbacks.onContentOpen?.(request, p.target, { newWindow: p.newWindow === true, hints: readContentHints(p.hints) })
    }
  }
  update(init: Partial<FrameInit>): void { this.init = { ...this.init, ...init } }
  /** Reports whether the App's window is the focused one; only a change is sent. */
  setFocused(focused: boolean): void {
    if (this.focused === focused) return
    this.focused = focused
    this.send('frame.focusChanged', { focused })
  }
  /** Tells the App what happened in the header the host draws for it. */
  headerEvent(event: HeaderEvent): void { this.send('header.event', event) }
  send(type: string, payload: unknown): void {
    if (this.ready) this.channel.post(envelope(type, payload))
  }
  request(type: string, payload: unknown, timeout = 3000): Promise<unknown> {
    if (!this.ready) return Promise.reject(new Error('App frame is not ready'))
    const id = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('App frame timed out')) }, timeout)
      this.pending.set(id, { resolve, reject, timer, type })
      this.channel.post(envelope(type, payload, { id }))
    })
  }
  async open(request: OpenRequest): Promise<{ accepted: boolean; fallback?: 'preview' }> {
    if (!this.capabilities.includes('open')) return { accepted: false }
    return await this.request('frame.open', { request }) as { accepted: boolean; fallback?: 'preview' }
  }
  async beforeClose(reason: 'user' | 'logout' | 'shell' = 'user'): Promise<CloseDecision> {
    if (!this.ready || !this.capabilities.includes('beforeClose')) return 'allow'
    const r = await this.request('frame.beforeClose', { reason }) as { decision?: CloseDecision }
    return r.decision === 'allow' || r.decision === 'pending' ? r.decision : 'deny'
  }
  async back(): Promise<boolean> {
    if (!this.capabilities.includes('back')) return false
    return (await this.request('frame.back', {}) as { handled?: boolean }).handled === true
  }
  private failPending(reason: string): void {
    this.pending.forEach(p => { clearTimeout(p.timer); p.reject(new Error(reason)) })
    this.pending.clear()
  }
  dispose(): void {
    this.detach()
    this.failPending('App frame disposed')
    this.ready = false
  }
}
/**
 * Origin of the window embedding this page, when `accept` admits it. `location.ancestorOrigins` names the real
 * parent even after the frame navigated through other pages (a sign-in round trip); the referrer is the fallback.
 * In the BuckyOS client the page is the top document and its host is the client itself, reached over the bridge: the
 * answer is the page's own origin, so that code which connects only when it is embedded connects there too.
 */
export function embedderOrigin(accept: (origin: string) => boolean): string | null {
  if (window.parent === window) return getBuckyApi() && accept(window.location.origin) ? window.location.origin : null
  const candidates = [window.location.ancestorOrigins?.[0], document.referrer]
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      const origin = new URL(candidate).origin
      if (accept(origin)) return origin
    } catch {}
  }
  return null
}
export const originInZone = (origin: string, zoneHost: string): boolean => {
  try {
    const url = new URL(origin)
    return url.protocol === window.location.protocol && (url.hostname === zoneHost || url.hostname.endsWith(`.${zoneHost}`))
  } catch { return false }
}
export class AppFrameClient {
  init?: FrameInit
  private title?: string
  private focused?: boolean
  private helloTimer?: ReturnType<typeof setInterval>
  private helloDeadline?: ReturnType<typeof setTimeout>
  private header: HeaderState = {}
  private readonly nonce: string | null
  /** The page is a top document of the BuckyOS client: its host is reached over the bridge. */
  private readonly native: boolean
  private readonly channel: AppFrameTransport
  private readonly detach: () => void
  private dialogs = new Map<string, { resolve: (result: SelectDialogResult) => void; reject: (error: Error) => void; allowLocal: boolean }>()
  private appOpens = new Map<string, (reply: AppOpenReply) => void>()
  private embedAbort?: AbortController
  constructor(private options: {
    shellOrigin: string
    /** The Zone's system entry (its root origin): where content is opened when this page is not embedded in the shell. */
    systemOrigin?: string
    /** This App's id, so the system does not offer the content back to it. */
    appId?: string
    onInit?: (init: FrameInit) => void
    onOpen?: (request: OpenRequest) => Promise<{ accepted: boolean; fallback?: 'preview' }> | { accepted: boolean; fallback?: 'preview' }
    onBeforeClose?: (reason: 'user' | 'logout' | 'shell') => Promise<CloseDecision> | CloseDecision
    onBack?: () => Promise<boolean> | boolean
    onTheme?: (theme: FrameInit['theme']) => void
    onLocale?: (locale: string) => void
    onFocus?: (focused: boolean) => void
    /** The user used the header this App set with `setHeader`. */
    onHeaderEvent?: (event: HeaderEvent) => void
  }) {
    const origin = new URL(options.shellOrigin).origin
    const bridge = window.parent === window ? getBuckyApi() : undefined
    this.native = !!bridge
    this.nonce = new URLSearchParams(window.location.hash.slice(1)).get('bfp') ?? (bridge ? crypto.randomUUID() : null)
    this.channel = bridge ? bridgeTransport(bridge) : windowTransport(() => window.parent, origin)
    this.detach = this.channel.onMessage(message => { void this.receive(message) })
    if ((bridge || window.parent !== window) && this.nonce) {
      const hello = () => this.channel.post(envelope('frame.hello', { nonce: this.nonce, appCapabilities: [
        ...options.onOpen ? ['open'] : [], ...options.onBeforeClose ? ['beforeClose'] : [], ...options.onBack ? ['back'] : [],
      ] }))
      hello()
      this.helloTimer = setInterval(hello, 250)
      // A native host may only be set up after the view has loaded.
      this.helloDeadline = setTimeout(() => clearInterval(this.helloTimer), bridge ? 10000 : 1500)
    }
  }
  private async receive(m: unknown): Promise<void> {
    if (!isMessage(m)) return
    const p = m.payload as Record<string, unknown>
    if (m.type === 'frame.init') {
      if (!this.nonce || p.nonce !== this.nonce || typeof p.locale !== 'string' || !p.theme || typeof p.windowId !== 'string' || p.launch && !isOpenRequest(p.launch)) return
      clearInterval(this.helloTimer); clearTimeout(this.helloDeadline)
      this.init = p as unknown as FrameInit
      this.title = undefined; this.focused = undefined
      if (Object.keys(this.header).length) this.send('header.set', this.header)
      this.options.onInit?.(this.init)
      return
    }
    if (!this.init) return
    if (m.type === 'sysdlg.openResult') {
      const pending = m.replyTo ? this.dialogs.get(m.replyTo) : undefined
      if (!pending) return
      this.dialogs.delete(m.replyTo!)
      if (p.ok !== true) return pending.reject(new SystemDialogError(dialogErrorCode(p.code)))
      const result = readSelectDialogResult(p.result, { allowLocal: pending.allowLocal })
      if (result) pending.resolve(result)
      else pending.reject(new SystemDialogError('protocol'))
      return
    }
    if (m.type === 'app.openResult') {
      const code = p.code === 'not_found' || p.code === 'denied' ? p.code : 'unsupported'
      if (m.replyTo) this.appOpens.get(m.replyTo)?.(p.ok === true ? { ok: true } : { ok: false, code })
      return
    }
    if (m.type === 'header.event') {
      if (p.kind !== 'search' && p.kind !== 'item' && p.kind !== 'menu') return
      this.options.onHeaderEvent?.({ kind: p.kind, ...(typeof p.id === 'string' ? { id: p.id } : {}), ...(typeof p.value === 'string' ? { value: p.value } : {}) })
      return
    }
    const reply = (payload: unknown) => this.channel.post(envelope(m.type + 'Result', payload, { replyTo: m.id }))
    try {
      if (m.type === 'frame.open' && isOpenRequest(p.request)) reply(await this.options.onOpen?.(p.request) ?? { accepted: false })
      if (m.type === 'frame.beforeClose') reply({ decision: await this.options.onBeforeClose?.(p.reason as 'user') ?? 'allow' })
      if (m.type === 'frame.back') reply({ handled: await this.options.onBack?.() ?? false })
      if (m.type === 'frame.themeChanged' && (p.mode === 'dark' || p.mode === 'light')) this.options.onTheme?.(p as FrameInit['theme'])
      if (m.type === 'frame.localeChanged' && typeof p.locale === 'string') this.options.onLocale?.(p.locale)
      if (m.type === 'frame.focusChanged' && this.focused !== (p.focused === true)) { this.focused = p.focused === true; this.options.onFocus?.(this.focused) }
    } catch {
      if (m.type === 'frame.open') reply({ accepted: false, fallback: 'preview' })
      if (m.type === 'frame.beforeClose') reply({ decision: 'deny' })
    }
  }
  send(type: string, payload: unknown): void {
    if (this.init) this.channel.post(envelope(type, payload))
  }
  setTitle(title: string, dirty = false): void {
    const key = JSON.stringify([title, dirty])
    if (!this.init || key === this.title) return
    this.title = key
    this.send('window.setTitle', { title, dirty })
  }
  requestClose(): void { this.send('window.requestClose', {}) }
  /** Sets what the host shows in the header above this App. It may be called before the handshake. */
  setHeader(header: HeaderState): void {
    this.header = { ...this.header, ...header }
    this.send('header.set', header)
  }
  /**
   * Opens another App, or a page of one, in this App's Zone (or in `zone`). The host decides between a new window and
   * an open one. In a standalone tab it opens the Zone's system entry (`systemOrigin`) in a new tab, which only reaches
   * this App's own Zone. Never rejects.
   */
  openApp(request: AppOpenRequest): Promise<AppOpenReply> {
    const clean = readAppOpenRequest(request)
    if (!clean) return Promise.resolve({ ok: false, code: 'denied' })
    if (this.init) {
      if (!this.init.shellCapabilities.includes('app.open')) return Promise.resolve({ ok: false, code: 'unsupported' })
      const id = crypto.randomUUID()
      return new Promise(resolve => {
        const settle = (reply: AppOpenReply) => { clearTimeout(timer); this.appOpens.delete(id); resolve(reply) }
        const timer = setTimeout(() => settle({ ok: false, code: 'unsupported' }), 30000)
        this.appOpens.set(id, settle)
        this.channel.post(envelope('app.open', clean, { id }))
      })
    }
    if (!this.options.systemOrigin || clean.zone) return Promise.resolve({ ok: false, code: 'unsupported' })
    window.open(systemOpenAppUrl(this.options.systemOrigin, clean), '_blank', 'noopener')
    return Promise.resolve({ ok: true })
  }
  /**
   * Asks the system to open content: with its default app, in Preview, or by letting the user choose (`chooser`).
   * Inside the shell or the BuckyOS client the request goes to the host; in a standalone tab it opens the Zone's system
   * entry (`systemOrigin`) in a new tab. Returns false when neither is available.
   */
  openContent(request: Omit<OpenRequest, 'requestId'>, target: ContentOpenTarget = 'default', options: { newWindow?: boolean; hints?: ContentHints } = {}): boolean {
    const hints = options.hints ?? {}
    if (this.init) { this.send('content.open', { request, target, newWindow: options.newWindow === true, hints }); return true }
    if (!this.options.systemOrigin) return false
    window.open(systemOpenUrl(this.options.systemOrigin, { request, target, hints, from: this.options.appId }), '_blank', 'noopener')
    return true
  }
  /**
   * Shows the system file picker (`sysdlg/select`) and resolves with what the user chose; cancelling resolves with
   * `{ action: 'cancelled' }`. Embedded in the shell the shell draws the dialog over this App's window; in a
   * standalone tab, and in the BuckyOS client unless it lists the dialog, the picker page of the Zone's system entry
   * (`systemOrigin`) is framed over this page. Rejects with a `SystemDialogError` when no picker is available or the
   * request did not complete.
   */
  selectContent(params: SelectDialogParams = {}, options: { signal?: AbortSignal; theme?: 'light' | 'dark'; locale?: string } = {}): Promise<SelectDialogResult> {
    const offered = this.init?.shellCapabilities.includes(SELECT_DIALOG_PATH)
    if (this.init && (offered || !this.native)) {
      if (!offered) return Promise.reject(new SystemDialogError('unsupported'))
      if (this.dialogs.size) return Promise.reject(new SystemDialogError('busy'))
      const id = crypto.randomUUID()
      return new Promise((resolve, reject) => {
        this.dialogs.set(id, { resolve, reject, allowLocal: params.allowLocal === true })
        this.channel.post(envelope('sysdlg.open', { path: SELECT_DIALOG_PATH, params }, { id }))
      })
    }
    if (!this.options.systemOrigin) return Promise.reject(new SystemDialogError('unsupported'))
    const abort = this.embedAbort = new AbortController()
    options.signal?.addEventListener('abort', () => abort.abort(), { once: true })
    if (options.signal?.aborted) abort.abort()
    return openSelectEmbed(this.options.systemOrigin, params, { ...options, signal: abort.signal })
  }
  dispose(): void {
    clearInterval(this.helloTimer); clearTimeout(this.helloDeadline); this.detach()
    this.appOpens.forEach(settle => settle({ ok: false, code: 'unsupported' }))
    this.dialogs.forEach(pending => pending.reject(new SystemDialogError('closed')))
    this.dialogs.clear(); this.embedAbort?.abort()
  }
}

/**
 * Preview embed protocol (`buckyos.preview-embed` v1): an App shows the system Preview component inside its own UI.
 * The App frames `<systemOrigin>/embed/preview` (component only, no shell) and hands it a content reference; the
 * system page reads the content with its own Zone-root session, so no token crosses origins. Open With goes back
 * through the App to the shell (`AppFrameClient.openContent(…, 'chooser')`).
 */
export type PreviewEmbedSource = TransferableContentRef | { kind: 'blob'; blob: Blob; name: string }
export interface PreviewEmbedInit {
  nonce: string
  source: PreviewEmbedSource
  session?: TransferableSessionContext
  theme: 'light' | 'dark'
  locale: string
}
export interface PreviewEmbedState {
  status: 'loading' | 'ready' | 'error'
  /** Preview error kind (`unsupported`, `not-found`, `permission-denied`, `timeout`, `error`, …) and code. */
  error?: { kind: string; code: string }
  title?: string
  mediaType?: string
}
export interface PreviewEmbedOpenWith { request: Omit<OpenRequest, 'requestId'>; hints: ContentHints }
const PREVIEW_EMBED = 'buckyos.preview-embed'
const embedEnvelope = (type: string, payload: unknown, protocol = PREVIEW_EMBED) => ({ protocol, version: 1, type, payload })
const isEmbedMessage = (value: unknown, protocol = PREVIEW_EMBED): value is { type: string; payload: Record<string, unknown> } => {
  const v = value as { protocol?: unknown; version?: unknown; type?: unknown; payload?: unknown } | null
  return !!v && v.protocol === protocol && v.version === 1 && typeof v.type === 'string' && !!v.payload && typeof v.payload === 'object'
}
const isEmbedSource = (value: unknown): value is PreviewEmbedSource =>
  isTransferableRef(value) || (!!value && typeof value === 'object' && (value as { kind?: unknown }).kind === 'blob' &&
    typeof Blob !== 'undefined' && (value as { blob?: unknown }).blob instanceof Blob && typeof (value as { name?: unknown }).name === 'string')
export const PREVIEW_EMBED_PATH = '/embed/preview'

/** App side: owns the iframe that shows the system Preview. */
export class PreviewEmbed {
  readonly url: string
  private readonly nonce = crypto.randomUUID()
  private readonly origin: string
  private readonly listener = (event: MessageEvent) => this.receive(event)
  private init: Omit<PreviewEmbedInit, 'nonce'>
  private ready = false
  constructor(private options: {
    systemOrigin: string
    frame: () => HTMLIFrameElement | null
    init: Omit<PreviewEmbedInit, 'nonce'>
    onState?: (state: PreviewEmbedState) => void
    onOpenWith?: (open: PreviewEmbedOpenWith) => void
    onExit?: () => void
  }) {
    this.origin = new URL(options.systemOrigin).origin
    this.init = options.init
    this.url = `${this.origin}${PREVIEW_EMBED_PATH}#bpe=${this.nonce}&po=${encodeURIComponent(window.location.origin)}`
    window.addEventListener('message', this.listener)
  }
  private post(type: string, payload: unknown): void {
    this.options.frame()?.contentWindow?.postMessage(embedEnvelope(type, payload), this.origin)
  }
  private receive(event: MessageEvent): void {
    if (event.origin !== this.origin || event.source !== this.options.frame()?.contentWindow || !isEmbedMessage(event.data)) return
    const { type, payload: p } = event.data
    if (type === 'embed.hello') { if (p.nonce === this.nonce) { this.ready = true; this.post('embed.init', { ...this.init, nonce: this.nonce }) } return }
    if (type === 'embed.state' && (p.status === 'loading' || p.status === 'ready' || p.status === 'error')) {
      const error = p.error as { kind?: unknown; code?: unknown } | undefined
      this.options.onState?.({ status: p.status,
        error: error && typeof error.kind === 'string' && typeof error.code === 'string' ? { kind: error.kind, code: error.code } : undefined,
        title: typeof p.title === 'string' ? p.title.slice(0, 256) : undefined, mediaType: typeof p.mediaType === 'string' ? p.mediaType.slice(0, 128) : undefined })
    }
    if (type === 'embed.openWith') {
      const request = p.request as Omit<OpenRequest, 'requestId'> | undefined
      if (request && isTransferableRef(request.source) && (request.session === undefined || isTransferableSession(request.session))) {
        this.options.onOpenWith?.({ request: { source: request.source, session: request.session }, hints: readContentHints(p.hints) })
      }
    }
    if (type === 'embed.exit') this.options.onExit?.()
  }
  update(patch: Partial<Pick<PreviewEmbedInit, 'theme' | 'locale'>>): void {
    this.init = { ...this.init, ...patch }
    // Before the handshake the frame still holds its initial about:blank (this App's origin, so the browser rejects
    // the target origin); `embed.init` carries the patch.
    if (this.ready) this.post('embed.update', patch)
  }
  dispose(): void { window.removeEventListener('message', this.listener) }
}

/** System side: the component-only page at `PREVIEW_EMBED_PATH`. Accepts one embedding App whose origin `accept` admits. */
export class PreviewEmbedHost {
  readonly parentOrigin: string | null
  private readonly nonce: string | null
  private ready = false
  private readonly hello?: ReturnType<typeof setInterval>
  private readonly listener = (event: MessageEvent) => this.receive(event)
  constructor(private options: {
    accept: (origin: string) => boolean
    onInit: (init: PreviewEmbedInit) => void
    onUpdate?: (patch: Partial<Pick<PreviewEmbedInit, 'theme' | 'locale'>>) => void
  }) {
    const params = new URLSearchParams(window.location.hash.slice(1))
    this.nonce = params.get('bpe')
    let parentOrigin: string | null = null
    try { parentOrigin = new URL(params.get('po') ?? '').origin } catch {}
    this.parentOrigin = window.parent !== window && this.nonce && parentOrigin && options.accept(parentOrigin) ? parentOrigin : null
    if (!this.parentOrigin) return
    window.addEventListener('message', this.listener)
    const hello = () => window.parent.postMessage(embedEnvelope('embed.hello', { nonce: this.nonce }), this.parentOrigin!)
    hello()
    this.hello = setInterval(() => { if (!this.ready) hello() }, 250)
  }
  private receive(event: MessageEvent): void {
    if (event.source !== window.parent || event.origin !== this.parentOrigin || !isEmbedMessage(event.data)) return
    const { type, payload: p } = event.data
    if (type === 'embed.init') {
      if (p.nonce !== this.nonce || !isEmbedSource(p.source) || (p.session !== undefined && !isTransferableSession(p.session)) || typeof p.locale !== 'string') return
      this.ready = true; clearInterval(this.hello)
      this.options.onInit({ nonce: String(p.nonce), source: p.source, session: p.session as TransferableSessionContext | undefined, theme: p.theme === 'dark' ? 'dark' : 'light', locale: p.locale })
      return
    }
    if (type === 'embed.update' && this.ready) {
      const patch: Partial<Pick<PreviewEmbedInit, 'theme' | 'locale'>> = {}
      if (p.theme === 'dark' || p.theme === 'light') patch.theme = p.theme
      if (typeof p.locale === 'string') patch.locale = p.locale
      this.options.onUpdate?.(patch)
    }
  }
  private post(type: string, payload: unknown): void {
    if (this.ready && this.parentOrigin) window.parent.postMessage(embedEnvelope(type, payload), this.parentOrigin)
  }
  state(state: PreviewEmbedState): void { this.post('embed.state', state) }
  openWith(open: PreviewEmbedOpenWith): void { this.post('embed.openWith', open) }
  exit(): void { this.post('embed.exit', {}) }
  dispose(): void { clearInterval(this.hello); window.removeEventListener('message', this.listener) }
}

/**
 * System dialog embed protocol (`buckyos.sysdlg-embed` v1): a standalone App page (no shell) shows the system file
 * picker by framing `<systemOrigin>/embed/sysdlg/select` over itself. The handshake is the Preview embed's
 * (`embed.hello` → `embed.init`); the system page browses with its own Zone-root session and answers with
 * `embed.result`. No token crosses origins, and every message names its exact target origin.
 */
const SYSDLG_EMBED = 'buckyos.sysdlg-embed'
export const SELECT_EMBED_PATH = '/embed/sysdlg/select'
export interface SelectEmbedInit { nonce: string; params: unknown; theme: 'light' | 'dark'; locale: string }
let selectEmbedOpen = false

/** App side of `buckyos.sysdlg-embed`: the full-page layer that frames the picker. One at a time per page. */
export function openSelectEmbed(systemOrigin: string, params: SelectDialogParams, options: { signal?: AbortSignal; theme?: 'light' | 'dark'; locale?: string } = {}): Promise<SelectDialogResult> {
  if (options.signal?.aborted) return Promise.reject(new SystemDialogError('closed'))
  if (selectEmbedOpen) return Promise.reject(new SystemDialogError('busy'))
  selectEmbedOpen = true
  const origin = new URL(systemOrigin).origin
  const locale = options.locale ?? navigator.language ?? 'en'
  const theme = options.theme ?? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  const zh = locale.toLowerCase().startsWith('zh')
  return new Promise((resolve, reject) => {
    const body = document.body
    const html = document.documentElement
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const scroll = { x: window.scrollX, y: window.scrollY }
    const saved = { body: body.getAttribute('style'), html: html.getAttribute('style') }
    const siblings = Array.from(body.children).filter((el): el is HTMLElement => el instanceof HTMLElement)
      .map(el => ({ el, inert: el.inert, hidden: el.getAttribute('aria-hidden') }))
    const root = document.createElement('div')
    root.setAttribute('data-buckyos-sysdlg', 'select')
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true')
    root.setAttribute('aria-label', zh ? '文件选择器' : 'File picker')
    root.style.cssText = 'position:fixed;inset:0;height:100vh;height:100dvh;z-index:2147483647;background:rgba(0,0,0,.32);display:flex;align-items:center;justify-content:center'
    let frame: HTMLIFrameElement | undefined
    let nonce = ''
    let timer: ReturnType<typeof setTimeout> | undefined
    let done = false
    const block = (event: Event) => { if (!root.contains(event.target as Node)) { event.stopPropagation(); event.preventDefault() } }
    const blocked = ['keydown', 'pointerdown', 'mousedown', 'touchstart', 'wheel'] as const
    const cleanup = () => {
      if (done) return false
      done = true; selectEmbedOpen = false
      clearTimeout(timer)
      window.removeEventListener('message', receive)
      options.signal?.removeEventListener('abort', abort)
      if (!('inert' in HTMLElement.prototype)) blocked.forEach(type => document.removeEventListener(type, block, true))
      root.remove()
      siblings.forEach(({ el, inert, hidden }) => { el.inert = inert; if (hidden === null) el.removeAttribute('aria-hidden'); else el.setAttribute('aria-hidden', hidden) })
      if (saved.body === null) body.removeAttribute('style'); else body.setAttribute('style', saved.body)
      if (saved.html === null) html.removeAttribute('style'); else html.setAttribute('style', saved.html)
      window.scrollTo(scroll.x, scroll.y)
      focused?.focus({ preventScroll: true })
      return true
    }
    const finish = (result: SelectDialogResult) => { if (cleanup()) resolve(result) }
    const fail = (code: SystemDialogErrorCode) => { if (cleanup()) reject(new SystemDialogError(code)) }
    const abort = () => fail('closed')
    const showFailure = () => {
      frame?.remove(); frame = undefined
      const panel = document.createElement('div')
      panel.setAttribute('role', 'alert')
      panel.style.cssText = `max-width:22rem;margin:1rem;padding:1.25rem;border-radius:16px;font:14px/1.6 system-ui,sans-serif;background:${theme === 'dark' ? '#1f2329' : '#fff'};color:${theme === 'dark' ? '#f2f3f5' : '#1f2329'};box-shadow:0 24px 64px rgba(0,0,0,.24)`
      const text = document.createElement('p')
      text.style.margin = '0 0 1rem'
      text.textContent = zh ? '无法加载文件选择器' : 'Unable to load the file picker'
      const actions = document.createElement('div')
      actions.style.cssText = 'display:flex;gap:.5rem;justify-content:flex-end'
      const button = (label: string, action: () => void) => {
        const el = document.createElement('button')
        el.type = 'button'; el.textContent = label
        el.style.cssText = 'min-height:2.25rem;padding:0 1rem;font:inherit;border-radius:999px;border:1px solid currentColor;background:transparent;color:inherit;cursor:pointer'
        el.addEventListener('click', action); actions.append(el); return el
      }
      button(zh ? '取消' : 'Cancel', () => fail('load_failed'))
      const retry = button(zh ? '重试' : 'Retry', () => { panel.remove(); load() })
      panel.append(text, actions); root.append(panel); retry.focus()
    }
    const load = () => {
      nonce = crypto.randomUUID()
      frame = document.createElement('iframe')
      frame.title = zh ? '文件选择器' : 'File picker'
      frame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent;color-scheme:normal'
      frame.setAttribute('allowtransparency', 'true')
      frame.addEventListener('error', showFailure)
      frame.src = `${origin}${SELECT_EMBED_PATH}#bse=${nonce}&po=${encodeURIComponent(window.location.origin)}`
      root.append(frame)
      timer = setTimeout(showFailure, 10000)
    }
    const receive = (event: MessageEvent) => {
      if (!frame || event.origin !== origin || event.source !== frame.contentWindow || !isEmbedMessage(event.data, SYSDLG_EMBED)) return
      const { type, payload: p } = event.data
      if (type === 'embed.hello') {
        if (p.nonce !== nonce) return
        clearTimeout(timer)
        frame.contentWindow?.postMessage(embedEnvelope('embed.init', { nonce, params, theme, locale } satisfies SelectEmbedInit, SYSDLG_EMBED), origin)
        frame.focus()
      }
      if (type === 'embed.error') fail(dialogErrorCode(p.code))
      if (type === 'embed.result') {
        const result = readSelectDialogResult(p.result, { allowLocal: params.allowLocal === true })
        if (result) finish(result)
        else fail('protocol')
      }
    }
    window.addEventListener('message', receive)
    options.signal?.addEventListener('abort', abort, { once: true })
    if ('inert' in HTMLElement.prototype) siblings.forEach(({ el }) => { el.inert = true })
    else { siblings.forEach(({ el }) => el.setAttribute('aria-hidden', 'true')); blocked.forEach(type => document.addEventListener(type, block, true)) }
    // `overflow: hidden` alone does not stop the page behind from scrolling on iOS; pinning the body does.
    html.style.overflow = 'hidden'
    body.style.position = 'fixed'; body.style.top = `${-scroll.y}px`; body.style.left = `${-scroll.x}px`; body.style.right = '0'; body.style.overflow = 'hidden'
    body.append(root)
    load()
  })
}

/** System side: the picker page at `SELECT_EMBED_PATH`. Works only for an embedding page whose origin `accept` admits. */
export class SelectEmbedHost {
  readonly parentOrigin: string | null
  private readonly nonce: string | null
  private ready = false
  private readonly hello?: ReturnType<typeof setInterval>
  private readonly listener = (event: MessageEvent) => this.receive(event)
  constructor(private options: { accept: (origin: string) => boolean; onInit: (init: SelectEmbedInit) => void }) {
    const params = new URLSearchParams(window.location.hash.slice(1))
    this.nonce = params.get('bse')
    let parentOrigin: string | null = null
    try { parentOrigin = new URL(params.get('po') ?? '').origin } catch {}
    this.parentOrigin = window.parent !== window && this.nonce && parentOrigin && options.accept(parentOrigin) ? parentOrigin : null
    if (!this.parentOrigin) return
    window.addEventListener('message', this.listener)
    const hello = () => window.parent.postMessage(embedEnvelope('embed.hello', { nonce: this.nonce }, SYSDLG_EMBED), this.parentOrigin!)
    hello()
    this.hello = setInterval(() => { if (!this.ready) hello() }, 250)
  }
  private receive(event: MessageEvent): void {
    if (event.source !== window.parent || event.origin !== this.parentOrigin || !isEmbedMessage(event.data, SYSDLG_EMBED)) return
    const { type, payload: p } = event.data
    if (type !== 'embed.init' || this.ready || p.nonce !== this.nonce || typeof p.locale !== 'string') return
    this.ready = true; clearInterval(this.hello)
    this.options.onInit({ nonce: String(p.nonce), params: p.params, theme: p.theme === 'dark' ? 'dark' : 'light', locale: p.locale })
  }
  private post(type: string, payload: unknown): void {
    if (this.ready && this.parentOrigin) window.parent.postMessage(embedEnvelope(type, payload, SYSDLG_EMBED), this.parentOrigin)
  }
  result(result: SelectDialogResult): void { this.post('embed.result', { result }) }
  error(code: SystemDialogErrorCode): void { this.post('embed.error', { code }) }
  dispose(): void { clearInterval(this.hello); window.removeEventListener('message', this.listener) }
}

/**
 * Conversation embed protocol (`buckyos.conversation-embed` v1): an App shows a conversation of the user with an
 * Agent inside its own layout, rendered by the system conversation component. The App frames
 * `<systemOrigin>/embed/conversation` (component only, no shell); the handshake is the Preview embed's
 * (`embed.hello` → `embed.init`). The system page works with its own Zone-root session and derives the App from the
 * embedder's origin, never from anything the App says: no token crosses origins, and message contents never travel
 * back to the App (it reads them with its own session if it needs them).
 */
const CONVERSATION_EMBED = 'buckyos.conversation-embed'
export const CONVERSATION_EMBED_PATH = '/embed/conversation'
/**
 * `agent`: the conversation with this Agent (the owner's default Agent when `agentDid` is left out) that this App
 * started; without one, the first message starts it. With a `memoryMode`, only a conversation in that mode counts, and
 * the one the first message starts has it (`normal` when left out). `session`: an existing conversation, when the
 * system allows this App to open it.
 */
export type ConversationEmbedTarget = { kind: 'agent'; agentDid?: string; memoryMode?: ConversationMemoryMode } | { kind: 'session'; sessionId: string }
/**
 * Whether what is said in a conversation with an Agent, and what the work it starts finds, reaches the Agent's
 * long-term memory (`no_write`: it does not), and whether that memory reaches the conversation (`no_read_write`:
 * neither way).
 */
export type ConversationMemoryMode = 'normal' | 'no_write' | 'no_read_write'
export interface ConversationEmbedInit {
  nonce: string
  target: ConversationEmbedTarget
  theme: 'light' | 'dark'
  locale: string
  /** The composer's placeholder. */
  placeholder?: string
}
/** What the system page receives: `target` is untrusted input it validates itself. */
export type ConversationEmbedHostInit = Omit<ConversationEmbedInit, 'target'> & { target: unknown }
/** A message the App sends in the user's name; `attachments` are content the user can read in the Zone. */
export interface ConversationEmbedSend { text: string; attachments?: TransferableContentRef[] }
export interface ConversationEmbedState {
  status: 'loading' | 'ready' | 'error'
  /** The conversation shown, once there is one. */
  sessionId?: string
  error?: string
}
/**
 * What the conversation in front is doing: `idle`; `running` while the Agent handles the message in front,
 * `interrupted` after a restart in the middle of it, `paused`; `answer` while a question of the Agent waits for the
 * user's answer.
 */
export type ConversationEmbedTurnMode = 'idle' | 'running' | 'interrupted' | 'paused' | 'answer'
export const CONVERSATION_EMBED_ERROR_CODES = ['invalid_params', 'not_found', 'denied'] as const
export type ConversationEmbedErrorCode = typeof CONVERSATION_EMBED_ERROR_CODES[number]
const TURN_MODES: readonly ConversationEmbedTurnMode[] = ['idle', 'running', 'interrupted', 'paused', 'answer']
const MAX_EMBED_TEXT = 64 * 1024
const MAX_EMBED_ATTACHMENTS = 32
const readEmbedSend = (p: Record<string, unknown>): ConversationEmbedSend | null => {
  if (typeof p.text !== 'string' || p.text.length > MAX_EMBED_TEXT) return null
  if (p.attachments === undefined) return { text: p.text }
  if (!Array.isArray(p.attachments) || p.attachments.length > MAX_EMBED_ATTACHMENTS || !p.attachments.every(isTransferableRef)) return null
  return { text: p.text, attachments: p.attachments as TransferableContentRef[] }
}

/** App side: owns the iframe that shows the system conversation. */
export class ConversationEmbed {
  readonly url: string
  private readonly nonce = crypto.randomUUID()
  private readonly origin: string
  private readonly listener = (event: MessageEvent) => this.receive(event)
  private init: Omit<ConversationEmbedInit, 'nonce'>
  private ready = false
  private outbox: ConversationEmbedSend[] = []
  constructor(private options: {
    systemOrigin: string
    frame: () => HTMLIFrameElement | null
    init: Omit<ConversationEmbedInit, 'nonce'>
    onState?: (state: ConversationEmbedState) => void
    onTurn?: (mode: ConversationEmbedTurnMode) => void
    onError?: (code: ConversationEmbedErrorCode) => void
  }) {
    this.origin = new URL(options.systemOrigin).origin
    this.init = options.init
    this.url = `${this.origin}${CONVERSATION_EMBED_PATH}#bce=${this.nonce}&po=${encodeURIComponent(window.location.origin)}`
    window.addEventListener('message', this.listener)
  }
  private post(type: string, payload: unknown): void {
    this.options.frame()?.contentWindow?.postMessage(embedEnvelope(type, payload, CONVERSATION_EMBED), this.origin)
  }
  private receive(event: MessageEvent): void {
    if (event.origin !== this.origin || event.source !== this.options.frame()?.contentWindow || !isEmbedMessage(event.data, CONVERSATION_EMBED)) return
    const { type, payload: p } = event.data
    if (type === 'embed.hello') {
      if (p.nonce !== this.nonce) return
      this.ready = true
      this.post('embed.init', { ...this.init, nonce: this.nonce })
      const queued = this.outbox
      this.outbox = []
      queued.forEach(message => this.post('embed.send', message))
      return
    }
    if (type === 'embed.state' && (p.status === 'loading' || p.status === 'ready' || p.status === 'error')) {
      this.options.onState?.({ status: p.status,
        sessionId: typeof p.sessionId === 'string' ? p.sessionId.slice(0, 512) : undefined,
        error: typeof p.error === 'string' ? p.error.slice(0, 128) : undefined })
    }
    if (type === 'embed.turn' && TURN_MODES.includes(p.mode as ConversationEmbedTurnMode)) this.options.onTurn?.(p.mode as ConversationEmbedTurnMode)
    if (type === 'embed.error' && CONVERSATION_EMBED_ERROR_CODES.includes(p.code as ConversationEmbedErrorCode)) this.options.onError?.(p.code as ConversationEmbedErrorCode)
  }
  update(patch: Partial<Pick<ConversationEmbedInit, 'theme' | 'locale'>>): void {
    this.init = { ...this.init, ...patch }
    if (this.ready) this.post('embed.update', patch)
  }
  /** Sends a message in the user's name. Before the handshake it waits and goes out right after `embed.init`. */
  send(message: ConversationEmbedSend): void {
    const payload: ConversationEmbedSend = { text: message.text, ...(message.attachments?.length ? { attachments: message.attachments } : {}) }
    if (this.ready) this.post('embed.send', payload)
    else this.outbox.push(payload)
  }
  dispose(): void { window.removeEventListener('message', this.listener); this.outbox = [] }
}

/** System side: the component-only page at `CONVERSATION_EMBED_PATH`. Accepts one embedding App whose origin `accept` admits. */
export class ConversationEmbedHost {
  readonly parentOrigin: string | null
  private readonly nonce: string | null
  private ready = false
  private readonly hello?: ReturnType<typeof setInterval>
  private readonly listener = (event: MessageEvent) => this.receive(event)
  constructor(private options: {
    accept: (origin: string) => boolean
    onInit: (init: ConversationEmbedHostInit) => void
    onUpdate?: (patch: Partial<Pick<ConversationEmbedInit, 'theme' | 'locale'>>) => void
    onSend?: (message: ConversationEmbedSend) => void
  }) {
    const params = new URLSearchParams(window.location.hash.slice(1))
    this.nonce = params.get('bce')
    let parentOrigin: string | null = null
    try { parentOrigin = new URL(params.get('po') ?? '').origin } catch {}
    this.parentOrigin = window.parent !== window && this.nonce && parentOrigin && options.accept(parentOrigin) ? parentOrigin : null
    if (!this.parentOrigin) return
    window.addEventListener('message', this.listener)
    const hello = () => window.parent.postMessage(embedEnvelope('embed.hello', { nonce: this.nonce }, CONVERSATION_EMBED), this.parentOrigin!)
    hello()
    this.hello = setInterval(() => { if (!this.ready) hello() }, 250)
  }
  private receive(event: MessageEvent): void {
    if (event.source !== window.parent || event.origin !== this.parentOrigin || !isEmbedMessage(event.data, CONVERSATION_EMBED)) return
    const { type, payload: p } = event.data
    if (type === 'embed.init') {
      if (this.ready || p.nonce !== this.nonce || typeof p.locale !== 'string') return
      this.ready = true; clearInterval(this.hello)
      this.options.onInit({ nonce: String(p.nonce), target: p.target, theme: p.theme === 'dark' ? 'dark' : 'light', locale: p.locale,
        ...(typeof p.placeholder === 'string' ? { placeholder: p.placeholder.slice(0, 200) } : {}) })
      return
    }
    if (!this.ready) return
    if (type === 'embed.update') {
      const patch: Partial<Pick<ConversationEmbedInit, 'theme' | 'locale'>> = {}
      if (p.theme === 'dark' || p.theme === 'light') patch.theme = p.theme
      if (typeof p.locale === 'string') patch.locale = p.locale
      this.options.onUpdate?.(patch)
    }
    if (type === 'embed.send') {
      const message = readEmbedSend(p)
      if (message) this.options.onSend?.(message)
      else this.error('invalid_params')
    }
  }
  private post(type: string, payload: unknown): void {
    if (this.ready && this.parentOrigin) window.parent.postMessage(embedEnvelope(type, payload, CONVERSATION_EMBED), this.parentOrigin)
  }
  state(state: ConversationEmbedState): void { this.post('embed.state', state) }
  turn(mode: ConversationEmbedTurnMode): void { this.post('embed.turn', { mode }) }
  error(code: ConversationEmbedErrorCode): void { this.post('embed.error', { code }) }
  dispose(): void { clearInterval(this.hello); window.removeEventListener('message', this.listener) }
}
