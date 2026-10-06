import { isOpenRequest, type OpenRequest } from './content'
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
    onContentOpen?: (request: OpenRequest, target: 'default' | 'preview', newWindow: boolean) => void
  }) { window.addEventListener('message', this.listener) }
  private receive(event: MessageEvent): void {
    if (event.source !== this.options.target() || event.origin !== this.options.origin || !isMessage(event.data)) return
    const m = event.data
    const p = m.payload as Record<string, unknown>
    if (m.type === 'frame.hello') {
      if (p.nonce !== this.options.init.nonce || !Array.isArray(p.appCapabilities)) return
      this.ready = true
      this.capabilities = p.appCapabilities.filter((c): c is string => typeof c === 'string')
      this.send('frame.init', this.options.init)
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
    if (m.type === 'content.open' && (p.target === 'default' || p.target === 'preview')) {
      const request = { ...(p.request as object), requestId: crypto.randomUUID() }
      if (!isOpenRequest(request)) return
      this.opens = this.opens.filter(t => t > Date.now() - 10000)
      if (this.opens.length >= 5) return
      this.opens.push(Date.now())
      this.options.onContentOpen?.(request, p.target, p.newWindow === true)
    }
  }
  update(init: Partial<FrameInit>): void { this.options.init = { ...this.options.init, ...init } }
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
export class AppFrameClient {
  init?: FrameInit
  private helloTimer?: ReturnType<typeof setInterval>
  private helloDeadline?: ReturnType<typeof setTimeout>
  private readonly nonce: string | null
  private readonly origin: string
  private readonly listener = (event: MessageEvent) => { void this.receive(event) }
  constructor(private options: {
    shellOrigin: string
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
      this.options.onInit?.(this.init)
      return
    }
    if (!this.init) return
    const reply = (payload: unknown) => window.parent.postMessage(envelope(m.type + 'Result', payload, { replyTo: m.id }), this.origin)
    try {
      if (m.type === 'frame.open' && isOpenRequest(p.request)) reply(await this.options.onOpen?.(p.request) ?? { accepted: false })
      if (m.type === 'frame.beforeClose') reply({ decision: await this.options.onBeforeClose?.(p.reason as 'user') ?? 'allow' })
      if (m.type === 'frame.back') reply({ handled: await this.options.onBack?.() ?? false })
      if (m.type === 'frame.themeChanged' && (p.mode === 'dark' || p.mode === 'light')) this.options.onTheme?.(p as FrameInit['theme'])
      if (m.type === 'frame.localeChanged' && typeof p.locale === 'string') this.options.onLocale?.(p.locale)
      if (m.type === 'frame.focusChanged') this.options.onFocus?.(p.focused === true)
    } catch {
      if (m.type === 'frame.open') reply({ accepted: false, fallback: 'preview' })
      if (m.type === 'frame.beforeClose') reply({ decision: 'deny' })
    }
  }
  send(type: string, payload: unknown): void {
    if (this.init) window.parent.postMessage(envelope(type, payload), this.origin)
  }
  setTitle(title: string, dirty = false): void { this.send('window.setTitle', { title, dirty }) }
  requestClose(): void { this.send('window.requestClose', {}) }
  openContent(request: Omit<OpenRequest, 'requestId'>, target: 'default' | 'preview' = 'default', newWindow = false): void {
    this.send('content.open', { request, target, newWindow })
  }
  dispose(): void { clearInterval(this.helloTimer); clearTimeout(this.helloDeadline); window.removeEventListener('message', this.listener) }
}
