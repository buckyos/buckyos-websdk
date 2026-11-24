import { SystemDialogError } from '../src/content'
import { AppFrameClient, AppFrameHost, embedderOrigin, originInZone, type AppFrameHostCallbacks, type AppFrameMessage, type AppFrameTransport, type FrameInit, type HeaderEvent, type HeaderState } from '../src/app-frame'

const globals = globalThis as { window?: unknown; document?: unknown }
const original = { window: globals.window, document: globals.document }
const setWindow = (win: unknown) => { globals.window = win }
afterEach(() => { globals.window = original.window; globals.document = original.document; jest.useRealTimers() })
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const envelope = (type: string, payload: unknown, extra: object = {}) => ({ protocol: 'buckyos.app-frame', version: 1, type, payload, ...extra })
const source = { kind: 'cyfs-path' as const, path: 'cyfs:///home/a.txt' }

/** A view of the client: its bridge, and the transport the client gives the host for it. Messages are copied as JSON. */
class NativeView {
  readonly calls: Array<{ name: string; payload: unknown }> = []
  readonly toApp = new Set<(payload: unknown) => void>()
  readonly toHost = new Set<(message: unknown) => void>()
  readonly opened: string[] = []
  readonly windowListeners: unknown[] = []
  readonly window: Record<string, unknown>
  readonly transport: AppFrameTransport = {
    post: message => { const copy = JSON.parse(JSON.stringify(message)); queueMicrotask(() => this.toApp.forEach(cb => cb(copy))) },
    onMessage: cb => { this.toHost.add(cb); return () => { this.toHost.delete(cb) } },
  }
  constructor(hash = '') {
    this.window = {
      location: { origin: 'https://notes.zone.example', hash, protocol: 'https:' },
      addEventListener: (_: string, fn: unknown) => { this.windowListeners.push(fn) },
      removeEventListener: () => {},
      open: (url: string) => { this.opened.push(url); return null },
      BuckyApi: {
        env: { container: 'desktop-app', formFactor: 'desktop', platform: 'linux', clientVersion: '1', capabilities: [] },
        call: async (name: string, payload: unknown) => {
          this.calls.push({ name, payload })
          if (name === 'frame.post') this.toHost.forEach(cb => cb(JSON.parse(JSON.stringify(payload))))
        },
        on: (event: string, cb: (payload: unknown) => void) => { if (event === 'frame.message') this.toApp.add(cb); return () => { this.toApp.delete(cb) } },
      },
    }
    this.window.parent = this.window
  }
}
const init = (extra: Partial<FrameInit> = {}): Omit<FrameInit, 'nonce'> => ({
  windowId: 'w1', formFactor: 'desktop', theme: { mode: 'light', accent: '#336699' }, locale: 'en', shellCapabilities: ['content.open', 'app.open', 'beforeClose', 'back'],
  presentation: 'window', container: 'desktop-app', ...extra,
})
function native(options: { host?: AppFrameHostCallbacks; init?: Partial<FrameInit>; client?: Partial<ConstructorParameters<typeof AppFrameClient>[0]>; hash?: string } = {}) {
  const view = new NativeView(options.hash)
  setWindow(view.window)
  const host = new AppFrameHost({ transport: view.transport, init: init(options.init), ...options.host })
  const client = new AppFrameClient({ shellOrigin: 'https://zone.example', ...options.client })
  return { view, host, client }
}

describe('App Frame over the bridge of the client', () => {
  it('shakes hands without a frame, an origin or a nonce in the address', async () => {
    const inits: FrameInit[] = []
    let ready = 0
    const { view, host, client } = native({ host: { onReady: () => { ready += 1 } }, client: { onInit: value => inits.push(value), onBack: () => true, onBeforeClose: () => 'deny', onOpen: () => ({ accepted: true }) } })
    await flush()
    expect(ready).toBe(1)
    expect(host.capabilities).toEqual(['open', 'beforeClose', 'back'])
    expect(inits[0]).toMatchObject({ windowId: 'w1', presentation: 'window', container: 'desktop-app', theme: { accent: '#336699' } })
    expect(client.init?.nonce).toBeTruthy()
    expect(view.windowListeners).toEqual([])
    expect(await host.back()).toBe(true)
    expect(await host.beforeClose()).toBe('deny')
    expect(await host.open({ requestId: 'r', source })).toEqual({ accepted: true })
    host.dispose(); client.dispose()
    expect(view.toHost.size + view.toApp.size).toBe(0)
  })

  it('carries titles, focus, theme and content requests', async () => {
    const titles: unknown[] = [], opens: unknown[] = [], themes: unknown[] = [], focus: boolean[] = []
    const { host, client, view } = native({
      host: { onTitle: (title, dirty) => titles.push([title, dirty]), onContentOpen: (request, target, extra) => opens.push([request.source, target, extra]) },
      client: { systemOrigin: 'https://zone.example', onTheme: theme => themes.push(theme), onFocus: value => focus.push(value) },
    })
    await flush()
    client.setTitle('Notes', true)
    expect(client.openContent({ source }, 'preview', { newWindow: true, hints: { name: 'a.txt' } })).toBe(true)
    host.setFocused(true)
    host.send('frame.themeChanged', { mode: 'dark', accent: '#112233' })
    await flush()
    expect(titles).toEqual([['Notes', true]])
    expect(opens).toEqual([[source, 'preview', { newWindow: true, hints: { name: 'a.txt' } }]])
    expect(view.opened).toEqual([])
    expect(focus).toEqual([true])
    expect(themes).toEqual([{ mode: 'dark', accent: '#112233' }])
    host.dispose(); client.dispose()
  })

  it('answers a new document and gives up on the one before it', async () => {
    const { view, host, client } = native({ client: { onBeforeClose: () => new Promise<never>(() => {}) } })
    await flush()
    const closing = host.beforeClose()
    client.dispose()
    setWindow(view.window)
    const next = new AppFrameClient({ shellOrigin: 'https://zone.example', onBeforeClose: () => 'allow' })
    await expect(closing).rejects.toThrow('reloaded')
    await flush()
    expect(next.init?.windowId).toBe('w1')
    expect(next.init?.nonce).not.toBe(client.init?.nonce)
    expect(await host.beforeClose()).toBe('allow')
    host.dispose(); next.dispose()
  })

  it('ignores an init for another document and messages of the wrong shape', async () => {
    const view = new NativeView()
    setWindow(view.window)
    const client = new AppFrameClient({ shellOrigin: 'https://zone.example' })
    const deliver = (message: unknown) => view.toApp.forEach(cb => cb(message))
    deliver(envelope('frame.init', { ...init(), nonce: 'other' }))
    deliver(null); deliver('x'); deliver({ type: 'frame.init', payload: {} })
    expect(client.init).toBeUndefined()
    const hello = view.calls.find(call => call.name === 'frame.post')?.payload as AppFrameMessage<string, { nonce: string }>
    deliver(envelope('frame.init', { ...init(), nonce: hello.payload.nonce }))
    expect(client.init?.windowId).toBe('w1')
    client.dispose()

    const errors = jest.fn()
    const host = new AppFrameHost({ transport: view.transport, init: init(), onReady: errors })
    view.toHost.forEach(cb => { cb(envelope('frame.hello', { appCapabilities: [] })); cb(envelope('frame.hello', { nonce: 'x'.repeat(200), appCapabilities: [] })); cb(envelope('frame.hello', { nonce: 'n' })); cb({}) })
    expect(errors).not.toHaveBeenCalled()
    expect(host.ready).toBe(false)
    host.dispose()
  })

  it('keeps saying hello until the host is there', async () => {
    jest.useFakeTimers()
    const view = new NativeView()
    setWindow(view.window)
    const client = new AppFrameClient({ shellOrigin: 'https://zone.example' })
    jest.advanceTimersByTime(4000)
    const host = new AppFrameHost({ transport: view.transport, init: init() })
    jest.advanceTimersByTime(250)
    await flush()
    expect(client.init?.windowId).toBe('w1')
    const sent = view.calls.length
    jest.advanceTimersByTime(20000)
    expect(view.calls.length).toBe(sent)
    host.dispose(); client.dispose()
  })

  it('uses the host\'s picker when it has one, and the embedded page otherwise', async () => {
    const dialog = native({ init: { shellCapabilities: ['sysdlg/select'] }, host: { onSystemDialog: async () => ({ ok: true, result: { action: 'cancelled' } }) } })
    await flush()
    await expect(dialog.client.selectContent()).resolves.toEqual({ action: 'cancelled' })
    dialog.client.dispose(); dialog.host.dispose()

    const bare = native()
    await flush()
    await expect(bare.client.selectContent()).rejects.toMatchObject({ code: 'unsupported' })
    bare.client.dispose(); bare.host.dispose()

    const page = native({ client: { systemOrigin: 'https://zone.example' } })
    await flush()
    // the embedded picker is drawn into this document, which is all that can be seen of it here
    const drawn = new Error('drawn into this document')
    globals.document = new Proxy({}, { get: () => { throw drawn } })
    await expect(page.client.selectContent({}, { theme: 'light' })).rejects.toBe(drawn)
    expect(page.view.calls.some(call => (call.payload as AppFrameMessage).type === 'sysdlg.open')).toBe(false)
    page.client.dispose(); page.host.dispose()
  })

  it('names the page itself as the embedder, inside the Zone only', () => {
    const view = new NativeView()
    setWindow(view.window)
    expect(embedderOrigin(origin => originInZone(origin, 'zone.example'))).toBe('https://notes.zone.example')
    expect(embedderOrigin(origin => originInZone(origin, 'other.example'))).toBeNull()
    delete view.window.BuckyApi
    expect(embedderOrigin(() => true)).toBeNull()
  })
})

describe('app.open', () => {
  it('asks the host and returns its answer', async () => {
    const requests: unknown[] = []
    const { client, host } = native({ host: { onAppOpen: async request => { requests.push(request); return request.app === 'files' ? { ok: true } : { ok: false, code: 'not_found' } } } })
    await flush()
    expect(await client.openApp({ app: 'files', path: '/app/files', window: 'w', mode: 'new' })).toEqual({ ok: true })
    expect(await client.openApp({ app: 'gone', zone: 'did:bns:bob' })).toEqual({ ok: false, code: 'not_found' })
    expect(requests).toEqual([{ app: 'files', path: '/app/files', window: 'w', mode: 'new' }, { app: 'gone', zone: 'did:bns:bob' }])
    host.dispose(); client.dispose()
  })

  it('refuses a malformed request, too many of them, and one the host cannot serve', async () => {
    const onAppOpen = jest.fn(async () => ({ ok: true as const }))
    const { client, host, view } = native({ host: { onAppOpen } })
    await flush()
    expect(await client.openApp({ app: 'files', path: '//evil.example' })).toEqual({ ok: false, code: 'denied' })
    const replies: unknown[] = []
    view.toApp.add(message => { const m = message as AppFrameMessage; if (m.type === 'app.openResult') replies.push(m.payload) })
    view.toHost.forEach(cb => { cb(envelope('app.open', { app: '../x' }, { id: 'raw' })); cb(envelope('app.open', { app: 'files' })) })
    await flush()
    expect(replies).toEqual([{ ok: false, code: 'denied' }])
    expect(onAppOpen).not.toHaveBeenCalled()
    for (let i = 0; i < 5; i++) expect(await client.openApp({ app: 'files' })).toEqual({ ok: true })
    expect(await client.openApp({ app: 'files' })).toEqual({ ok: false, code: 'denied' })
    expect(onAppOpen).toHaveBeenCalledTimes(5)
    host.dispose(); client.dispose()

    const unsupported = native({ init: { shellCapabilities: [] }, host: { onAppOpen } })
    await flush()
    expect(await unsupported.client.openApp({ app: 'files' })).toEqual({ ok: false, code: 'unsupported' })
    unsupported.host.dispose(); unsupported.client.dispose()

    const without = native()
    await flush()
    expect(await without.client.openApp({ app: 'files' })).toEqual({ ok: false, code: 'unsupported' })
    without.host.dispose(); without.client.dispose()
  })

  it('counts content requests separately', async () => {
    const opens: unknown[] = []
    const { client, host } = native({ host: { onAppOpen: () => ({ ok: true }), onContentOpen: request => opens.push(request.source) } })
    await flush()
    for (let i = 0; i < 5; i++) await client.openApp({ app: 'files' })
    for (let i = 0; i < 7; i++) client.openContent({ source })
    await flush()
    expect(opens).toHaveLength(5)
    host.dispose(); client.dispose()
  })

  it('does not wait for a host that never answers, or past dispose', async () => {
    jest.useFakeTimers()
    const { client, host } = native({ host: { onAppOpen: () => new Promise<never>(() => {}) } })
    await flush()
    const first = client.openApp({ app: 'files' }), second = client.openApp({ app: 'files' })
    jest.advanceTimersByTime(29000)
    jest.advanceTimersByTime(2000)
    await expect(first).resolves.toEqual({ ok: false, code: 'unsupported' })
    const third = client.openApp({ app: 'files' })
    client.dispose()
    await expect(third).resolves.toEqual({ ok: false, code: 'unsupported' })
    await second
    host.dispose()
  })

  it('opens the Zone\'s system entry from a standalone tab', async () => {
    const view = new NativeView()
    delete view.window.BuckyApi
    setWindow(view.window)
    const client = new AppFrameClient({ shellOrigin: 'https://zone.example', systemOrigin: 'https://zone.example' })
    expect(await client.openApp({ app: 'files', path: '/a?b#c', window: 'w 1' })).toEqual({ ok: true })
    expect(view.opened).toEqual(['https://zone.example/?open-app=files&path=%2Fa%3Fb%23c&window=w%201'])
    expect(await client.openApp({ app: 'files', zone: 'did:bns:bob' })).toEqual({ ok: false, code: 'unsupported' })
    expect(await new AppFrameClient({ shellOrigin: 'https://zone.example' }).openApp({ app: 'files' })).toEqual({ ok: false, code: 'unsupported' })
  })
})

describe('the header of a mobile container', () => {
  const tabs = [{ id: 'all', label: 'All', active: true }, { id: 'mine', label: 'Mine' }]

  it('merges what the App sets and reports what the user does', async () => {
    const headers: HeaderState[] = [], events: HeaderEvent[] = []
    const { client, host } = native({ host: { onHeader: header => headers.push(header) }, client: { onHeaderEvent: event => events.push(event) } })
    client.setHeader({ title: 'Notes', search: { placeholder: 'Search' } })
    await flush()
    client.setHeader({ second_row: tabs, menu: [{ id: 'del', label: 'Delete', icon: 'trash', danger: true }], back: true })
    client.setHeader({ search: null })
    host.headerEvent({ kind: 'search', value: 'x' })
    host.headerEvent({ kind: 'item', id: 'mine' })
    host.send('header.event', { kind: 'swipe', id: 'mine' })
    await flush()
    expect(headers).toEqual([
      { title: 'Notes', search: { placeholder: 'Search' } },
      { title: 'Notes', search: { placeholder: 'Search' }, second_row: tabs, menu: [{ id: 'del', label: 'Delete', icon: 'trash', danger: true }], back: true },
      { title: 'Notes', search: null, second_row: tabs, menu: [{ id: 'del', label: 'Delete', icon: 'trash', danger: true }], back: true },
    ])
    expect(events).toEqual([{ kind: 'search', value: 'x' }, { kind: 'item', id: 'mine' }])
    host.dispose(); client.dispose()
  })

  it('drops what is not valid', async () => {
    const headers: HeaderState[] = []
    const { view, host, client } = native({ host: { onHeader: header => headers.push(header) } })
    await flush()
    view.toHost.forEach(cb => cb(envelope('header.set', {
      title: 'x'.repeat(300), search: 'on', back: 'yes', extra: 1,
      second_row: [{ id: 'a', label: 'A', active: 'yes', html: '<b>' }, { id: '', label: 'B' }, null, 'c', { id: 'd' }],
      menu: Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, label: 'M' })),
    })))
    expect(headers).toHaveLength(1)
    expect(headers[0].title).toHaveLength(256)
    expect(headers[0].second_row).toEqual([{ id: 'a', label: 'A' }])
    expect(headers[0].menu).toHaveLength(32)
    expect(Object.keys(headers[0]).sort()).toEqual(['menu', 'second_row', 'title'])
    host.dispose(); client.dispose()
  })

  it('starts empty for a new document, which sets its own', async () => {
    const headers: HeaderState[] = []
    const { view, host, client } = native({ host: { onHeader: header => headers.push(header) } })
    await flush()
    client.setHeader({ title: 'One' })
    await flush()
    client.dispose()
    setWindow(view.window)
    const next = new AppFrameClient({ shellOrigin: 'https://zone.example' })
    next.setHeader({ back: true })
    await flush()
    expect(headers).toEqual([{ title: 'One' }, {}, { back: true }])
    host.dispose(); next.dispose()
  })
})

describe('App Frame in an iframe', () => {
  class FakeWindow {
    peer!: FakeWindow
    parent: FakeWindow = this
    readonly location: { origin: string; hash: string; protocol: string }
    readonly received: unknown[] = []
    private listeners = new Set<(event: unknown) => void>()
    constructor(readonly origin: string, hash = '') { this.location = { origin, hash, protocol: 'https:' } }
    addEventListener(_: string, fn: (event: unknown) => void) { this.listeners.add(fn) }
    removeEventListener(_: string, fn: (event: unknown) => void) { this.listeners.delete(fn) }
    deliver(data: unknown, source: unknown, from: string) { this.received.push(data); this.listeners.forEach(fn => fn({ data, source, origin: from })) }
    postMessage(data: unknown, targetOrigin: string) { if (targetOrigin === this.origin) queueMicrotask(() => this.deliver(data, this.peer, this.peer.origin)) }
  }
  const hello = (nonce: string) => envelope('frame.hello', { nonce, appCapabilities: [] })
  function connect(callbacks: AppFrameHostCallbacks = {}) {
    const shell = new FakeWindow('https://zone.example'), app = new FakeWindow('https://app.zone.example', '#bfp=nonce-1')
    shell.peer = app; app.peer = shell; app.parent = shell
    setWindow(shell)
    const host = new AppFrameHost({ target: () => app as unknown as Window, origin: app.origin, init: { ...init({ shellCapabilities: ['app.open'] }), nonce: 'nonce-1' }, ...callbacks })
    return { shell, app, host }
  }

  it('still checks the window, the origin and the nonce', async () => {
    const { shell, app, host } = connect()
    shell.deliver(hello('nonce-1'), new FakeWindow('https://app.zone.example'), app.origin)
    shell.deliver(hello('nonce-1'), app, 'https://evil.example')
    shell.deliver(hello('nonce-2'), app, app.origin)
    expect(host.ready).toBe(false)
    shell.deliver(hello('nonce-1'), app, app.origin)
    expect(host.ready).toBe(true)
    host.dispose()
    expect(host.ready).toBe(false)
  })

  it('does not use the bridge inside a frame, even when there is one', async () => {
    const { app, host } = connect()
    const call = jest.fn()
    ;(app as unknown as { BuckyApi: unknown }).BuckyApi = { env: { container: 'desktop-app', formFactor: 'desktop', platform: 'linux', clientVersion: '1', capabilities: [] }, call, on: call }
    setWindow(app)
    const client = new AppFrameClient({ shellOrigin: 'https://zone.example' })
    await flush()
    expect(client.init?.nonce).toBe('nonce-1')
    expect(call).not.toHaveBeenCalled()
    host.dispose(); client.dispose()
  })

  it('carries app.open and the header to the shell', async () => {
    const opens: unknown[] = [], headers: unknown[] = []
    const { app, host } = connect({ onAppOpen: request => { opens.push(request); return { ok: true } }, onHeader: header => headers.push(header) })
    setWindow(app)
    const client = new AppFrameClient({ shellOrigin: 'https://zone.example' })
    await flush()
    expect(await client.openApp({ app: 'messagehub', path: '/messagehub?notify=1' })).toEqual({ ok: true })
    client.setHeader({ title: 'T' })
    await flush()
    expect(opens).toEqual([{ app: 'messagehub', path: '/messagehub?notify=1' }])
    expect(headers).toEqual([{ title: 'T' }])
    // a reply from another origin does not count
    const pending = client.openApp({ app: 'files' })
    app.deliver(envelope('app.openResult', { ok: false, code: 'denied' }, { replyTo: 'x' }), app.parent, 'https://evil.example')
    await expect(pending).resolves.toEqual({ ok: true })
    host.dispose(); client.dispose()
  })

  it('has no picker of its own when the shell offers none', async () => {
    const { app, host } = connect()
    setWindow(app)
    const client = new AppFrameClient({ shellOrigin: 'https://zone.example', systemOrigin: 'https://zone.example' })
    await flush()
    await expect(client.selectContent()).rejects.toBeInstanceOf(SystemDialogError)
    host.dispose(); client.dispose()
  })
})
