import { isOpenRequest, isTransferableRef, isTransferableSession, readContentHints, readSelectDialogResult, systemOpenUrl, SELECT_DIALOG_PATH, SystemDialogError, SYSTEM_DIALOG_ERROR_CODES, type ContentHints, type ContentOpenTarget, type OpenRequest, type SelectDialogParams, type SelectDialogResult, type SystemDialogErrorCode, type TransferableContentRef, type TransferableSessionContext } from './content'
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
}
export type CloseDecision = 'allow' | 'deny' | 'pending'
const envelope = (type: string, payload: unknown, extra: { id?: string; replyTo?: string } = {}): AppFrameMessage =>
  ({ protocol: 'buckyos.app-frame', version: 1, type, payload, ...extra })
const isMessage = (value: unknown): value is AppFrameMessage => {
  if (!value || typeof value !== 'object') return false
  const v = value as AppFrameMessage
  return v.protocol === 'buckyos.app-frame' && v.version === 1 && typeof v.type === 'string' && !!v.payload && typeof v.payload === 'object'
}
export class AppFrameHost {
  ready = false
  capabilities: string[] = []
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout>; type: string }>()
  private listener = (event: MessageEvent) => this.receive(event)
  private opens: number[] = []
  constructor(private options: {
    target: () => Window | null; origin: string; init: FrameInit
    onReady?: () => void
    onTitle?: (title: string, dirty: boolean) => void
    onRequestClose?: () => void
    onContentOpen?: (request: OpenRequest, target: ContentOpenTarget, options: { newWindow: boolean; hints: ContentHints }) => void
    /** Shows a system dialog the App asked for (`sysdlg.open`). `params` is untrusted input: validate it. */
    onSystemDialog?: (path: string, params: unknown) => Promise<SystemDialogReply>
  }) { window.addEventListener('message', this.listener) }
  private focused?: boolean
  private dialogOpen = false
  private async systemDialog(id: string, path: unknown, params: unknown): Promise<void> {
    const reply = (payload: SystemDialogReply) => { if (this.ready) this.options.target()?.postMessage(envelope('sysdlg.openResult', payload, { replyTo: id }), this.options.origin) }
    if (!this.options.onSystemDialog || typeof path !== 'string') return reply({ ok: false, code: 'unsupported' })
    if (this.dialogOpen) return reply({ ok: false, code: 'busy' })
    this.dialogOpen = true
    try { reply(await this.options.onSystemDialog(path, params)) }
    catch (error) { reply({ ok: false, code: error instanceof SystemDialogError ? error.code : 'closed' }) }
    finally { this.dialogOpen = false }
  }
  private receive(event: MessageEvent): void {
    if (event.source !== this.options.target() || event.origin !== this.options.origin || !isMessage(event.data)) return
    const m = event.data
    const p = m.payload as Record<string, unknown>
    if (m.type === 'frame.hello') {
      if (p.nonce !== this.options.init.nonce || !Array.isArray(p.appCapabilities)) return
      this.ready = true
      this.capabilities = p.appCapabilities.filter((c): c is string => typeof c === 'string')
      this.send('frame.init', this.options.init)
      if (this.focused !== undefined) this.send('frame.focusChanged', { focused: this.focused })
      this.options.onReady?.()
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
    if (m.type === 'window.setTitle' && typeof p.title === 'string') this.options.onTitle?.(p.title.slice(0, 256), p.dirty === true)
    if (m.type === 'window.requestClose') this.options.onRequestClose?.()
    if (m.type === 'sysdlg.open' && typeof m.id === 'string') void this.systemDialog(m.id, p.path, p.params)
    if (m.type === 'content.open' && (p.target === 'default' || p.target === 'preview' || p.target === 'chooser')) {
      const request = { ...(p.request as object), requestId: crypto.randomUUID() }
      if (!isOpenRequest(request)) return
      this.opens = this.opens.filter(t => t > Date.now() - 10000)
      if (this.opens.length >= 5) return
      this.opens.push(Date.now())
      this.options.onContentOpen?.(request, p.target, { newWindow: p.newWindow === true, hints: readContentHints(p.hints) })
    }
  }
  update(init: Partial<FrameInit>): void { this.options.init = { ...this.options.init, ...init } }
  /** Reports whether the App's window is the focused one; only a change is sent. */
  setFocused(focused: boolean): void {
    if (this.focused === focused) return
    this.focused = focused
    this.send('frame.focusChanged', { focused })
  }
  send(type: string, payload: unknown): void {
    if (this.ready) this.options.target()?.postMessage(envelope(type, payload), this.options.origin)
  }
  request(type: string, payload: unknown, timeout = 3000): Promise<unknown> {
    if (!this.ready) return Promise.reject(new Error('App frame is not ready'))
    const id = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('App frame timed out')) }, timeout)
      this.pending.set(id, { resolve, reject, timer, type })
      this.options.target()?.postMessage(envelope(type, payload, { id }), this.options.origin)
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
  dispose(): void {
    window.removeEventListener('message', this.listener)
    this.pending.forEach(p => { clearTimeout(p.timer); p.reject(new Error('App frame disposed')) })
    this.pending.clear(); this.ready = false
  }
}
/**
 * Origin of the window embedding this page, when `accept` admits it. `location.ancestorOrigins` names the real
 * parent even after the frame navigated through other pages (a sign-in round trip); the referrer is the fallback.
 */
export function embedderOrigin(accept: (origin: string) => boolean): string | null {
  if (window.parent === window) return null
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
  private readonly nonce: string | null
  private readonly origin: string
  private readonly listener = (event: MessageEvent) => { void this.receive(event) }
  private dialogs = new Map<string, { resolve: (result: SelectDialogResult) => void; reject: (error: Error) => void; allowLocal: boolean }>()
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
  }) {
    this.origin = new URL(options.shellOrigin).origin
    this.nonce = new URLSearchParams(window.location.hash.slice(1)).get('bfp')
    window.addEventListener('message', this.listener)
    if (window.parent !== window && this.nonce) {
      const hello = () => window.parent.postMessage(envelope('frame.hello', { nonce: this.nonce, appCapabilities: [
        ...options.onOpen ? ['open'] : [], ...options.onBeforeClose ? ['beforeClose'] : [], ...options.onBack ? ['back'] : [],
      ] }), this.origin)
      hello()
      this.helloTimer = setInterval(hello, 250)
      this.helloDeadline = setTimeout(() => clearInterval(this.helloTimer), 1500)
    }
  }
  private async receive(event: MessageEvent): Promise<void> {
    if (event.source !== window.parent || event.origin !== this.origin || !isMessage(event.data)) return
    const m = event.data
    const p = m.payload as Record<string, unknown>
    if (m.type === 'frame.init') {
      if (!this.nonce || p.nonce !== this.nonce || typeof p.locale !== 'string' || !p.theme || typeof p.windowId !== 'string' || p.launch && !isOpenRequest(p.launch)) return
      clearInterval(this.helloTimer); clearTimeout(this.helloDeadline)
      this.init = p as unknown as FrameInit
      this.title = undefined; this.focused = undefined
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
    const reply = (payload: unknown) => window.parent.postMessage(envelope(m.type + 'Result', payload, { replyTo: m.id }), this.origin)
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
    if (this.init) window.parent.postMessage(envelope(type, payload), this.origin)
  }
  setTitle(title: string, dirty = false): void {
    const key = JSON.stringify([title, dirty])
    if (!this.init || key === this.title) return
    this.title = key
    this.send('window.setTitle', { title, dirty })
  }
  requestClose(): void { this.send('window.requestClose', {}) }
  /**
   * Asks the system to open content: with its default app, in Preview, or by letting the user choose (`chooser`).
   * Embedded in the shell the request goes over the frame; in a standalone tab it opens the Zone's system entry
   * (`systemOrigin`) in a new tab. Returns false when neither is available.
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
   * standalone tab the picker page of the Zone's system entry (`systemOrigin`) is framed over this page. Rejects
   * with a `SystemDialogError` when no picker is available or the request did not complete.
   */
  selectContent(params: SelectDialogParams = {}, options: { signal?: AbortSignal; theme?: 'light' | 'dark'; locale?: string } = {}): Promise<SelectDialogResult> {
    if (this.init) {
      if (!this.init.shellCapabilities.includes(SELECT_DIALOG_PATH)) return Promise.reject(new SystemDialogError('unsupported'))
      if (this.dialogs.size) return Promise.reject(new SystemDialogError('busy'))
      const id = crypto.randomUUID()
      return new Promise((resolve, reject) => {
        this.dialogs.set(id, { resolve, reject, allowLocal: params.allowLocal === true })
        window.parent.postMessage(envelope('sysdlg.open', { path: SELECT_DIALOG_PATH, params }, { id }), this.origin)
      })
    }
    if (!this.options.systemOrigin) return Promise.reject(new SystemDialogError('unsupported'))
    const abort = this.embedAbort = new AbortController()
    options.signal?.addEventListener('abort', () => abort.abort(), { once: true })
    if (options.signal?.aborted) abort.abort()
    return openSelectEmbed(this.options.systemOrigin, params, { ...options, signal: abort.signal })
  }
  dispose(): void {
    clearInterval(this.helloTimer); clearTimeout(this.helloDeadline); window.removeEventListener('message', this.listener)
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
