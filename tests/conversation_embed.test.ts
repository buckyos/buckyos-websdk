import { ConversationEmbed, ConversationEmbedHost, CONVERSATION_EMBED_PATH, type ConversationEmbedHostInit, type ConversationEmbedSend } from '../src/app-frame'

/** A fake window: what is posted to it is delivered to its listeners with its peer as the sender. */
class FakeWindow {
  peer!: FakeWindow
  parent: FakeWindow = this
  readonly location: { origin: string; hash: string }
  readonly posted: Array<{ type: string; payload: Record<string, unknown> }> = []
  private listeners = new Set<(event: unknown) => void>()
  constructor(readonly origin: string, hash = '') { this.location = { origin, hash } }
  addEventListener(_: string, fn: (event: unknown) => void) { this.listeners.add(fn) }
  removeEventListener(_: string, fn: (event: unknown) => void) { this.listeners.delete(fn) }
  deliver(data: unknown, source: unknown, from: string) { this.listeners.forEach(fn => fn({ data, source, origin: from })) }
  postMessage(data: { type: string; payload: Record<string, unknown> }, targetOrigin: string) {
    if (targetOrigin !== this.origin) return
    this.posted.push(data)
    queueMicrotask(() => this.deliver(data, this.peer, this.peer.origin))
  }
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
const envelope = (type: string, payload: unknown) => ({ protocol: 'buckyos.conversation-embed', version: 1, type, payload })

describe('conversation embed', () => {
  const original = (globalThis as { window?: unknown }).window
  const setWindow = (win: unknown) => { (globalThis as { window?: unknown }).window = win }
  afterEach(() => setWindow(original))

  /** The App frames the system page; `accept` is the system page's check of the embedder. */
  function connect(accept: (origin: string) => boolean = origin => origin === 'https://app.zone.example') {
    const app = new FakeWindow('https://app.zone.example')
    setWindow(app)
    const states: unknown[] = [], turns: unknown[] = [], errors: unknown[] = []
    let system: FakeWindow | null = null
    const embed = new ConversationEmbed({
      systemOrigin: 'https://zone.example/ignored',
      frame: () => (system ? { contentWindow: system } : null) as unknown as HTMLIFrameElement,
      init: { target: { kind: 'agent' }, theme: 'light', locale: 'en', placeholder: 'Ask about this document' },
      onState: state => states.push(state),
      onTurn: mode => turns.push(mode),
      onError: code => errors.push(code),
    })
    const url = new URL(embed.url)
    system = new FakeWindow(url.origin, url.hash)
    system.peer = app; app.peer = system; system.parent = app
    setWindow(system)
    const inits: ConversationEmbedHostInit[] = [], sends: ConversationEmbedSend[] = [], updates: unknown[] = []
    const host = new ConversationEmbedHost({ accept, onInit: init => inits.push(init), onUpdate: patch => updates.push(patch), onSend: message => sends.push(message) })
    return { app, system, embed, host, url, states, turns, errors, inits, sends, updates }
  }

  it('frames the system page with a nonce and the embedder origin, and hands over the target after the handshake', async () => {
    const { embed, host, url, system, inits } = connect()
    expect(url.origin + url.pathname).toBe(`https://zone.example${CONVERSATION_EMBED_PATH}`)
    const params = new URLSearchParams(url.hash.slice(1))
    expect(params.get('po')).toBe('https://app.zone.example')
    expect(host.parentOrigin).toBe('https://app.zone.example')
    await flush()
    expect(inits).toEqual([{ nonce: params.get('bce'), target: { kind: 'agent' }, theme: 'light', locale: 'en', placeholder: 'Ask about this document' }])
    expect(system.posted.filter(message => message.type === 'embed.init')).toHaveLength(1)
    embed.dispose(); host.dispose()
  })

  it('queues sends until the handshake and passes theme changes on', async () => {
    const { embed, host, sends, updates } = connect()
    embed.send({ text: 'What does section 2 mean?', attachments: [{ kind: 'cyfs-path', path: 'cyfs:///home/notes.md' }] })
    expect(sends).toEqual([])
    await flush()
    expect(sends).toEqual([{ text: 'What does section 2 mean?', attachments: [{ kind: 'cyfs-path', path: 'cyfs:///home/notes.md' }] }])
    embed.send({ text: 'And section 3?' })
    embed.update({ theme: 'dark' })
    await flush()
    expect(sends[1]).toEqual({ text: 'And section 3?' })
    expect(updates).toEqual([{ theme: 'dark' }])
    embed.dispose(); host.dispose()
  })

  it('reports state, Turn and errors to the App, and nothing that is not in the protocol', async () => {
    const { embed, host, states, turns, errors, app, system } = connect()
    await flush()
    host.state({ status: 'ready', sessionId: 's-1' })
    host.turn('running')
    host.error('denied')
    app.deliver(envelope('embed.turn', { mode: 'leaked' }), system, system.origin)
    app.deliver(envelope('embed.state', { status: 'ready', sessionId: 'forged' }), {}, system.origin)
    await flush()
    expect(states).toEqual([{ status: 'ready', sessionId: 's-1', error: undefined }])
    expect(turns).toEqual(['running'])
    expect(errors).toEqual(['denied'])
    embed.dispose(); host.dispose()
  })

  it('rejects malformed sends and ignores messages before the handshake or from other windows', async () => {
    const { embed, host, sends, system, app } = connect()
    system.deliver(envelope('embed.send', { text: 'early' }), app, app.origin)
    await flush()
    expect(sends).toEqual([])
    system.deliver(envelope('embed.send', { text: 'x', attachments: [{ kind: 'url', href: 'https://evil.example' }] }), app, app.origin)
    system.deliver(envelope('embed.send', { text: 'from elsewhere' }), {}, app.origin)
    await flush()
    expect(sends).toEqual([])
    expect(app.posted.filter(message => message.type === 'embed.error').map(message => message.payload)).toEqual([{ code: 'invalid_params' }])
    embed.dispose(); host.dispose()
  })

  it('does not answer an embedder the system page does not accept', async () => {
    const { embed, host, inits, app } = connect(() => false)
    expect(host.parentOrigin).toBeNull()
    await flush()
    expect(inits).toEqual([])
    expect(app.posted).toEqual([])
    embed.dispose(); host.dispose()
  })
})
