import { AppFrameClient, AppFrameHost, TransferError, readTransferOffer, type AppFrameHostCallbacks, type AppFrameTransferHandlers, type AppFrameTransport, type FrameInit, type TransferOfferMessage } from '../src/app-frame'
import { CONTENT_REFS_FORMAT } from '../src/transfer'

const globals = globalThis as { window?: unknown }
const original = globals.window
afterEach(() => { globals.window = original })
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setTimeout(resolve, 0)) }
const envelope = (type: string, payload: unknown, extra: object = {}) => ({ protocol: 'buckyos.app-frame', version: 1, type, payload, ...extra })
const init = (shellCapabilities = ['transfer.v1']): FrameInit => ({ nonce: 'nonce-1', windowId: 'w1', formFactor: 'desktop', theme: { mode: 'light' }, locale: 'en', shellCapabilities })
const ref = { origin: 'zone', kind: 'file', source: { kind: 'cyfs-path', path: 'cyfs:///home/alice/notes.md' }, hints: { name: 'notes.md' } }
const opId = (n: number) => `operation-${String(n).padStart(8, '0')}`

/** A window of the test: messages to it arrive as from its peer, with the ports moved along. */
class FakeWindow {
  peer!: FakeWindow
  parent: FakeWindow = this
  name = ''
  readonly location: { origin: string; hash: string; protocol: string }
  private listeners = new Set<(event: unknown) => void>()
  constructor(readonly origin: string, hash = '') { this.location = { origin, hash, protocol: 'https:' } }
  addEventListener(_: string, fn: (event: unknown) => void) { this.listeners.add(fn) }
  removeEventListener(_: string, fn: (event: unknown) => void) { this.listeners.delete(fn) }
  deliver(data: unknown, source: unknown, from: string, ports: MessagePort[] = []) { this.listeners.forEach(fn => fn({ data, source, origin: from, ports })) }
  postMessage(data: unknown, targetOrigin: string, transfer: Transferable[] = []) {
    if (targetOrigin !== this.origin) return
    const ports = transfer.filter((t): t is MessagePort => t instanceof MessagePort)
    queueMicrotask(() => this.deliver(data, this.peer, this.peer.origin, ports))
  }
}

function framed(options: { host?: AppFrameHostCallbacks; transfer?: AppFrameTransferHandlers; shellCapabilities?: string[] } = {}) {
  const shell = new FakeWindow('https://zone.example'), app = new FakeWindow('https://notes.zone.example', '#bfp=nonce-1')
  shell.peer = app; app.peer = shell; app.parent = shell
  const events: string[] = []
  const offers = new Map<string, TransferOfferMessage>()
  globals.window = shell
  const host = new AppFrameHost({
    target: () => app as unknown as Window, origin: app.origin, init: init(options.shellCapabilities),
    onTransferConnect: id => events.push(`connect:${id}`), onTransferDisconnect: id => events.push(`disconnect:${id}`),
    onTransferOffer: offer => {
      if (offers.has(offer.offerId)) return { ok: false, code: 'denied' }
      offers.set(offer.offerId, offer)
      return { ok: true }
    },
    onTransferWithdraw: offerId => { offers.delete(offerId); events.push(`withdraw:${offerId}`) },
    ...options.host,
  })
  const connect = (transfer: AppFrameTransferHandlers = options.transfer ?? {}) => {
    globals.window = app
    const client = new AppFrameClient({ shellOrigin: 'https://zone.example', transfer })
    globals.window = shell
    return client
  }
  return { shell, app, host, events, offers, connect }
}

describe('transfer.v1 over an App frame', () => {
  it('binds one port per document after the handshake, only from the checked window and origin', async () => {
    const { shell, app, host, events, connect } = framed()
    const client = connect()
    await flush()
    expect(client.transferAvailable).toBe(true)
    const documentId = host.transferDocument
    expect(documentId).toMatch(/^[A-Za-z0-9_-]{8,}$/)
    expect(events).toEqual([`connect:${documentId}`])
    // Another window, another origin, or no port: not taken, the bound link stays.
    const stray = new MessageChannel()
    shell.deliver(envelope('transfer.connect', { documentId: 'other-document-1' }), new FakeWindow(app.origin), app.origin, [stray.port1])
    shell.deliver(envelope('transfer.connect', { documentId: 'other-document-1' }), app, 'https://evil.example', [stray.port1])
    shell.deliver(envelope('transfer.connect', { documentId: 'other-document-1' }), app, app.origin)
    expect(host.transferDocument).toBe(documentId)
    // A transfer message on the window channel instead of the port is ignored.
    shell.deliver(envelope('transfer.offer', { offerId: 'x'.repeat(22), purpose: 'drag', generation: 1, items: [{ kind: 'text', formats: ['text/plain'], operations: ['copy'] }] }, { id: '1' }), app, app.origin)
    await flush()
    expect(events).toEqual([`connect:${documentId}`])
    stray.port1.close(); stray.port2.close()
    host.dispose(); client.dispose()
    expect(events).toEqual([`connect:${documentId}`, `disconnect:${documentId}`])
  })

  it('stays off unless both sides list the capability', async () => {
    const off = framed({ shellCapabilities: [] })
    const client = off.connect()
    await flush()
    expect(client.transferAvailable).toBe(false)
    expect(off.host.transferDocument).toBeUndefined()
    expect(await client.offerTransfer({ purpose: 'drag', items: [{ kind: 'text', formats: ['text/plain'], operations: ['copy'] }] })).toEqual({ ok: false, code: 'unsupported' })
    off.host.dispose(); client.dispose()
    const plain = framed()
    globals.window = plain.app
    const legacy = new AppFrameClient({ shellOrigin: 'https://zone.example' })
    globals.window = plain.shell
    await flush()
    expect(plain.host.ready).toBe(true)
    expect(plain.host.capabilities).not.toContain('transfer.v1')
    expect(plain.host.transferDocument).toBeUndefined()
    plain.host.dispose(); legacy.dispose()
  })

  it('registers offers by their own id, checks them by schema and withdraws them', async () => {
    const { host, offers, events, connect } = framed()
    const client = connect()
    await flush()
    const item = { kind: 'zone-file' as const, formats: [CONTENT_REFS_FORMAT, 'text/plain'], operations: ['copy' as const, 'link' as const], inline: { 'text/plain': 'notes.md' } }
    const reply = await client.offerTransfer({ purpose: 'drag', items: [item] })
    expect(reply.ok).toBe(true)
    const offerId = (reply as { offerId: string }).offerId
    expect(offerId).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(offers.get(offerId)).toEqual({ offerId, purpose: 'drag', generation: 1, items: [item] })
    // Not a registered format name, an inline value for a format not offered, no operation.
    expect(await client.offerTransfer({ purpose: 'drag', items: [{ kind: 'text', formats: ['Text Plain'], operations: ['copy'] }] })).toEqual({ ok: false, code: 'unsupported' })
    expect(readTransferOffer({ offerId, purpose: 'drag', generation: 1, items: [{ kind: 'text', formats: ['text/plain'], operations: ['copy'], inline: { 'text/html': '<b>' } }] })).toBeUndefined()
    expect(readTransferOffer({ offerId, purpose: 'drag', generation: 1, items: [{ kind: 'text', formats: ['text/plain'], operations: [] }] })).toBeUndefined()
    expect(readTransferOffer({ offerId: 'short', purpose: 'drag', generation: 1, items: [{ kind: 'text', formats: ['text/plain'], operations: ['copy'] }] })).toBeUndefined()
    client.withdrawTransfer(offerId)
    await flush()
    expect(offers.has(offerId)).toBe(false)
    expect(events).toContain(`withdraw:${offerId}`)
    host.dispose(); client.dispose()
  })

  it('passes the shell refusing an offer back to the App', async () => {
    const { host, connect } = framed()
    const seen = new Set<string>()
    const client = connect()
    await flush()
    // The host decides about collisions; the same id coming back is refused.
    ;(host as unknown as { callbacks: AppFrameHostCallbacks }).callbacks.onTransferOffer = offer => {
      if (seen.has('taken')) return { ok: false, code: 'denied' }
      seen.add('taken'); void offer
      return { ok: true }
    }
    const item = { kind: 'text' as const, formats: ['text/plain'], operations: ['copy' as const] }
    expect((await client.offerTransfer({ purpose: 'copy', items: [item] })).ok).toBe(true)
    expect(await client.offerTransfer({ purpose: 'copy', items: [item] })).toEqual({ ok: false, code: 'denied' })
    host.dispose(); client.dispose()
  })

  it('probes with kinds and formats only, reads from the source and delivers to the target', async () => {
    const probes: unknown[] = [], reads: unknown[] = [], delivered: unknown[] = []
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })
    const { host, connect } = framed()
    const client = connect({
      onProbe: probe => { probes.push(probe); return { targetId: 'cursor', action: 'Insert at the cursor', accept: [
        { itemKey: '0', format: 'text/plain', operation: 'copy' }, { itemKey: '0', format: 'text/html', operation: 'copy' },
        { itemKey: '7', format: 'text/plain', operation: 'copy' }, { itemKey: '1', format: 'files', operation: 'move' },
      ] } },
      onRead: read => { reads.push(read); return [{ itemKey: '0', format: 'text/plain', value: 'Hello' }, { itemKey: '1', format: 'files', value: file }, { itemKey: '9', format: 'text/plain', value: 'not asked' }] },
      onDeliver: delivery => { delivered.push(delivery); return { status: 'done', items: delivery.items.map(item => ({ itemKey: item.itemKey, status: 'done' as const })) } },
    })
    await flush()
    const items = [{ itemKey: '0', kind: 'text' as const, formats: ['text/plain'], operations: ['copy' as const] }, { itemKey: '1', kind: 'local-file' as const, formats: ['files'], operations: ['copy' as const] }]
    const answer = await host.transferProbe({ operationId: opId(1), seq: 1, items, at: { x: 10, y: 20 } })
    // Only the item shown, in a format and operation it offers, once.
    expect(answer).toEqual({ targetId: 'cursor', action: 'Insert at the cursor', accept: [{ itemKey: '0', format: 'text/plain', operation: 'copy' }] })
    expect(probes).toEqual([{ operationId: opId(1), seq: 1, items, at: { x: 10, y: 20 } }])
    const values = await host.transferRead({ operationId: opId(1), offerId: 'o'.repeat(22), generation: 1, items: [{ itemKey: '0', format: 'text/plain' }, { itemKey: '1', format: 'files' }, { itemKey: '2', format: 'text/plain' }] })
    expect(values[0]).toEqual({ itemKey: '0', format: 'text/plain', value: 'Hello' })
    expect((values[1] as { value: File }).value).toBeInstanceOf(File)
    expect((values[1] as { value: File }).value.name).toBe('hello.txt')
    expect(values[2]).toEqual({ itemKey: '2', format: 'text/plain', error: 'failed' })
    const result = await host.transferDeliver({ operationId: opId(1), targetId: 'cursor', operation: 'copy', at: { x: 10, y: 20 }, items: [
      { itemKey: '0', format: 'text/plain', value: 'Hello' }, { itemKey: '1', format: CONTENT_REFS_FORMAT, value: ref },
    ] })
    expect(result).toEqual({ status: 'done', items: [{ itemKey: '0', status: 'done' }, { itemKey: '1', status: 'done' }] })
    expect((delivered[0] as { items: Array<{ value: unknown }> }).items[1].value).toEqual(ref)
    // A delivery whose value does not fit its format never reaches the App.
    await expect(host.transferDeliver({ operationId: opId(2), targetId: 'cursor', operation: 'copy', at: 'focus', items: [{ itemKey: '0', format: CONTENT_REFS_FORMAT, value: { origin: 'zone' } }] }))
      .rejects.toMatchObject({ code: 'unsupported' })
    expect(delivered).toHaveLength(1)
    host.dispose(); client.dispose()
  })

  it('commits a delivery once per operation and answers status and retries with the first result', async () => {
    let calls = 0
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const { host, connect } = framed()
    const client = connect({ onDeliver: async delivery => { calls += 1; await gate; return { status: 'accepted', items: delivery.items.map(item => ({ itemKey: item.itemKey, status: 'accepted' as const })) } } })
    await flush()
    const delivery = { operationId: opId(3), targetId: 'draft', operation: 'copy' as const, at: 'focus' as const, items: [{ itemKey: '0', format: 'text/plain', value: 'x' }] }
    const first = host.transferDeliver(delivery)
    const second = host.transferDeliver(delivery)
    await flush()
    expect(calls).toBe(1)
    release()
    const expected = { status: 'accepted', items: [{ itemKey: '0', status: 'accepted' }] }
    expect(await first).toEqual(expected)
    expect(await second).toEqual(expected)
    expect(await host.transferDeliver(delivery)).toEqual(expected)
    expect(calls).toBe(1)
    expect(await host.transferStatus(opId(3), delivery.items)).toEqual(expected)
    expect(await host.transferStatus(opId(4), delivery.items)).toBeNull()
    host.dispose(); client.dispose()
  })

  it('drops the port of a document that reloaded: its pending requests fail stale and the new one binds', async () => {
    const { shell, app, host, events, connect } = framed()
    const first = connect({ onRead: () => new Promise(() => {}) })
    await flush()
    const old = host.transferDocument!
    const pending = host.transferRead({ operationId: opId(5), offerId: 'o'.repeat(22), generation: 1, items: [{ itemKey: '0', format: 'text/plain' }] })
    await flush()
    // The same frame loads again: same nonce (the iframe name survives), another document.
    first.dispose()
    const second = connect({ onRead: () => [{ itemKey: '0', format: 'text/plain', value: 'new' }] })
    await expect(pending).rejects.toBeInstanceOf(TransferError)
    await expect(pending).rejects.toMatchObject({ code: 'stale' })
    await flush()
    const now = host.transferDocument!
    expect(now).not.toBe(old)
    expect(events).toEqual([`connect:${old}`, `disconnect:${old}`, `connect:${now}`])
    expect(await host.transferRead({ operationId: opId(6), offerId: 'o'.repeat(22), generation: 1, items: [{ itemKey: '0', format: 'text/plain' }] }))
      .toEqual([{ itemKey: '0', format: 'text/plain', value: 'new' }])
    // A page without transfer.v1 loading in the frame (no document id in its hello) also drops the link.
    second.dispose()
    shell.deliver(envelope('frame.hello', { nonce: 'nonce-1', appCapabilities: [] }), app, app.origin)
    expect(host.transferDocument).toBeUndefined()
    expect(events.at(-1)).toBe(`disconnect:${now}`)
    host.dispose()
  })

  it('times out and reports errors from the App with their codes', async () => {
    const { host, connect } = framed()
    const client = connect({
      onProbe: () => new Promise(() => {}),
      onRead: () => { throw new TransferError('stale') },
    })
    await flush()
    const items = [{ itemKey: '0', kind: 'text' as const, formats: ['text/plain'], operations: ['copy' as const] }]
    await expect(host.transferProbe({ operationId: opId(7), seq: 1, items, at: 'focus' }, 30)).rejects.toMatchObject({ code: 'timeout' })
    await expect(host.transferRead({ operationId: opId(7), offerId: 'o'.repeat(22), generation: 1, items: [{ itemKey: '0', format: 'text/plain' }] })).rejects.toMatchObject({ code: 'stale' })
    // No handler: unsupported.
    await expect(host.transferDeliver({ operationId: opId(7), targetId: 't', operation: 'copy', at: 'focus', items: [{ itemKey: '0', format: 'text/plain', value: 'x' }] })).rejects.toMatchObject({ code: 'unsupported' })
    host.dispose(); client.dispose()
  })
})

describe('transfer.v1 over the bridge of the client', () => {
  it('uses the bridge instead of a port and keeps local files out', async () => {
    const toApp = new Set<(payload: unknown) => void>(), toHost = new Set<(message: unknown) => void>()
    const transport: AppFrameTransport = {
      post: message => { const copy = JSON.parse(JSON.stringify(message)); queueMicrotask(() => toApp.forEach(cb => cb(copy))) },
      onMessage: cb => { toHost.add(cb); return () => { toHost.delete(cb) } },
    }
    const view: Record<string, unknown> = {
      location: { origin: 'https://notes.zone.example', hash: '', protocol: 'https:' }, addEventListener: () => {}, removeEventListener: () => {},
      BuckyApi: {
        env: { container: 'desktop-app', formFactor: 'desktop', platform: 'linux', clientVersion: '1', capabilities: [] },
        call: async (name: string, payload: unknown) => { if (name === 'frame.post') toHost.forEach(cb => cb(JSON.parse(JSON.stringify(payload)))) },
        on: (event: string, cb: (payload: unknown) => void) => { if (event === 'frame.message') toApp.add(cb); return () => { toApp.delete(cb) } },
      },
    }
    view.parent = view
    globals.window = view
    const connected: string[] = []
    const host = new AppFrameHost({ transport, init: { windowId: 'w1', formFactor: 'desktop', theme: { mode: 'light' }, locale: 'en', shellCapabilities: ['transfer.v1'] }, onTransferConnect: id => connected.push(id), onTransferOffer: () => ({ ok: true }) })
    const client = new AppFrameClient({ shellOrigin: 'https://zone.example', transfer: {
      onRead: () => [{ itemKey: '0', format: 'files', value: new File(['x'], 'x.txt') }, { itemKey: '1', format: 'text/plain', value: 'text' }],
    } })
    await flush()
    expect(connected).toHaveLength(1)
    expect(client.transferAvailable).toBe(true)
    expect((await client.offerTransfer({ purpose: 'drag', items: [{ kind: 'local-file', formats: ['files'], operations: ['copy'] }] })).ok).toBe(true)
    expect(await host.transferRead({ operationId: opId(8), offerId: 'o'.repeat(22), generation: 1, items: [{ itemKey: '0', format: 'files' }, { itemKey: '1', format: 'text/plain' }] }))
      .toEqual([{ itemKey: '0', format: 'files', error: 'unsupported' }, { itemKey: '1', format: 'text/plain', value: 'text' }])
    await expect(host.transferDeliver({ operationId: opId(8), targetId: 't', operation: 'copy', at: 'focus', items: [{ itemKey: '0', format: 'files', value: new File(['x'], 'x.txt') }] }))
      .rejects.toMatchObject({ code: 'unsupported' })
    host.dispose(); client.dispose()
  })
})
