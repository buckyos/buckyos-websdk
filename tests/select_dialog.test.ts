import { readSelectDialogResult, SystemDialogError } from '../src/content'
import { AppFrameClient, AppFrameHost } from '../src/app-frame'

/** A fake window: what is posted to it is delivered to its listeners with its peer as the sender. */
class FakeWindow {
  peer!: FakeWindow
  parent: FakeWindow = this
  readonly location: { origin: string; hash: string; protocol: string }
  private listeners = new Set<(event: unknown) => void>()
  constructor(readonly origin: string, hash = '') { this.location = { origin, hash, protocol: 'https:' } }
  addEventListener(_: string, fn: (event: unknown) => void) { this.listeners.add(fn) }
  removeEventListener(_: string, fn: (event: unknown) => void) { this.listeners.delete(fn) }
  deliver(data: unknown, source: unknown, from: string) { this.listeners.forEach(fn => fn({ data, source, origin: from })) }
  postMessage(data: unknown, targetOrigin: string) { if (targetOrigin === this.origin) queueMicrotask(() => this.deliver(data, this.peer, this.peer.origin)) }
}
function wire() {
  const shell = new FakeWindow('https://zone.example'), app = new FakeWindow('https://app.zone.example', '#bfp=nonce-1')
  shell.peer = app; app.peer = shell; app.parent = shell
  return { shell, app }
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
const zoneFile = { origin: 'zone', kind: 'file', source: { kind: 'cyfs-path', path: 'cyfs:///home/a.txt' }, hints: { name: 'a.txt', size: 3 } }

describe('select dialog result validation', () => {
  it('accepts the contract shapes and returns clean copies', () => {
    expect(readSelectDialogResult({ action: 'cancelled', extra: 1 })).toEqual({ action: 'cancelled' })
    expect(readSelectDialogResult({ action: 'selected', items: [{ ...zoneFile, objId: 'cyfile:abc', token: 'x' }] }))
      .toEqual({ action: 'selected', items: [{ ...zoneFile, objId: 'cyfile:abc' }] })
    expect(readSelectDialogResult({ action: 'save', parent: { kind: 'cyfs-path', path: 'cyfs:///home' }, name: 'n.md', overwrite: true }))
      .toEqual({ action: 'save', parent: { kind: 'cyfs-path', path: 'cyfs:///home' }, name: 'n.md', overwrite: true })
  })
  it('rejects malformed results', () => {
    expect(readSelectDialogResult(null)).toBeUndefined()
    expect(readSelectDialogResult({ action: 'selected', items: [] })).toBeUndefined()
    expect(readSelectDialogResult({ action: 'selected', items: [{ ...zoneFile, source: { kind: 'cyfs-path', path: 'https://evil.example/x' } }] })).toBeUndefined()
    expect(readSelectDialogResult({ action: 'selected', items: [{ ...zoneFile, objId: 'not an id' }] })).toBeUndefined()
    expect(readSelectDialogResult({ action: 'save', parent: { kind: 'cyfs-path', path: 'cyfs:///home' }, name: '../x', overwrite: false })).toBeUndefined()
    expect(readSelectDialogResult({ action: 'save', parent: { kind: 'object-id', objectId: 'cyfile:abc' }, name: 'x', overwrite: false })).toBeUndefined()
  })
  it('admits items from this device only when asked for, and never mixed with Zone items', () => {
    const file = new File(['abc'], 'local.txt')
    const local = { origin: 'local', kind: 'file', file, hints: { name: 'local.txt' } }
    expect(readSelectDialogResult({ action: 'selected', items: [local] })).toBeUndefined()
    expect(readSelectDialogResult({ action: 'selected', items: [local] }, { allowLocal: true })).toEqual({ action: 'selected', items: [local] })
    expect(readSelectDialogResult({ action: 'selected', items: [local, zoneFile] }, { allowLocal: true })).toBeUndefined()
    expect(readSelectDialogResult({ action: 'selected', items: [{ ...local, file: { name: 'fake' } }] }, { allowLocal: true })).toBeUndefined()
    const folder = { origin: 'local', kind: 'folder', name: 'album', files: [{ file, relativePath: 'album/in/local.txt' }] }
    expect(readSelectDialogResult({ action: 'selected', items: [folder] }, { allowLocal: true })).toEqual({ action: 'selected', items: [folder] })
    expect(readSelectDialogResult({ action: 'selected', items: [{ ...folder, files: [{ file, relativePath: 'other/local.txt' }] }] }, { allowLocal: true })).toBeUndefined()
    expect(readSelectDialogResult({ action: 'selected', items: [{ ...folder, files: [{ file, relativePath: 'album/../x' }] }] }, { allowLocal: true })).toBeUndefined()
  })
})

describe('sysdlg.open over the App Frame', () => {
  const original = (globalThis as { window?: unknown }).window
  afterEach(() => { (globalThis as { window?: unknown }).window = original })

  const setWindow = (win: unknown) => { (globalThis as { window?: unknown }).window = win }
  /** The host registers its listener on the shell window; afterwards `window` is the App's, as in the App's own page. */
  function connect(options: { capabilities?: string[]; onSystemDialog?: (path: string, params: unknown) => Promise<{ ok: true; result: unknown } | { ok: false; code: 'unsupported' | 'invalid_params' }> } = {}) {
    const { shell, app } = wire()
    setWindow(shell)
    const host = new AppFrameHost({
      target: () => app as unknown as Window, origin: app.origin,
      init: { nonce: 'nonce-1', windowId: 'w1', formFactor: 'desktop', theme: { mode: 'light' }, locale: 'en', shellCapabilities: options.capabilities ?? ['sysdlg/select'] },
      onSystemDialog: options.onSystemDialog,
    })
    setWindow(app)
    const client = new AppFrameClient({ shellOrigin: shell.origin })
    return { host, client, shell, app }
  }

  it('pairs a request with its answer and validates the result', async () => {
    const calls: unknown[] = []
    const { client } = connect({ onSystemDialog: async (path, params) => { calls.push([path, params]); return { ok: true, result: { action: 'selected', items: [zoneFile] } } } })
    await flush()
    expect(client.init?.shellCapabilities).toContain('sysdlg/select')
    const result = await client.selectContent({ mode: 'open', multiple: true })
    expect(result).toEqual({ action: 'selected', items: [zoneFile] })
    expect(calls).toEqual([['sysdlg/select', { mode: 'open', multiple: true }]])
  })
  it('rejects with the shell\'s code, and with `protocol` for a result of the wrong shape', async () => {
    let answer: { ok: true; result: unknown } | { ok: false; code: 'invalid_params' } = { ok: false, code: 'invalid_params' }
    const { client } = connect({ onSystemDialog: async () => answer })
    await flush()
    await expect(client.selectContent({ limit: 9999 })).rejects.toMatchObject({ code: 'invalid_params' })
    answer = { ok: true, result: { action: 'selected', items: [{ origin: 'zone' }] } }
    await expect(client.selectContent()).rejects.toMatchObject({ code: 'protocol' })
    // items from this device were not asked for
    answer = { ok: true, result: { action: 'selected', items: [{ origin: 'local', kind: 'file', file: new File(['x'], 'x.txt'), hints: {} }] } }
    await expect(client.selectContent()).rejects.toMatchObject({ code: 'protocol' })
    await expect(client.selectContent({ allowLocal: true })).resolves.toMatchObject({ action: 'selected' })
  })
  it('is unsupported without a handshake, without the capability, and without a handler on the shell', async () => {
    setWindow(new FakeWindow('https://app.zone.example'))
    const lone = new AppFrameClient({ shellOrigin: 'https://zone.example' })
    await expect(lone.selectContent()).rejects.toBeInstanceOf(SystemDialogError)
    await expect(lone.selectContent()).rejects.toMatchObject({ code: 'unsupported' })

    const old = connect({ capabilities: ['content.open'], onSystemDialog: async () => ({ ok: true, result: { action: 'cancelled' } }) })
    await flush()
    await expect(old.client.selectContent()).rejects.toMatchObject({ code: 'unsupported' })

    const bare = connect()
    await flush()
    await expect(bare.client.selectContent()).rejects.toMatchObject({ code: 'unsupported' })
  })
  it('allows one dialog at a time and rejects the open request with `closed` on dispose', async () => {
    let release: (value: { ok: true; result: unknown }) => void = () => {}
    const { client, host, app, shell } = connect({ onSystemDialog: () => new Promise(resolve => { release = resolve }) })
    await flush()
    const first = client.selectContent()
    await expect(client.selectContent()).rejects.toMatchObject({ code: 'busy' })
    // a second request on the wire (an App not using the SDK) is refused by the shell
    const replies: unknown[] = []
    app.addEventListener('message', (event: unknown) => { const data = (event as { data: { type: string; payload: unknown } }).data; if (data.type === 'sysdlg.openResult') replies.push(data.payload) })
    shell.deliver({ protocol: 'buckyos.app-frame', version: 1, type: 'sysdlg.open', id: 'raw-1', payload: { path: 'sysdlg/select', params: {} } }, app, app.origin)
    await flush()
    expect(replies).toEqual([{ ok: false, code: 'busy' }])
    release({ ok: true, result: { action: 'cancelled' } })
    await expect(first).resolves.toEqual({ action: 'cancelled' })

    const pending = client.selectContent()
    await flush()
    client.dispose()
    await expect(pending).rejects.toMatchObject({ code: 'closed' })
    host.dispose()
  })
})

describe('ensureObjId', () => {
  it('returns the ID a Zone item already carries and refuses to invent one', async () => {
    const { ensureObjId } = await import('../src/content_objid')
    const item = { origin: 'zone' as const, kind: 'file' as const, source: { kind: 'cyfs-path' as const, path: 'cyfs:///home/a.txt' }, hints: {} }
    const known = await ensureObjId({ ...item, objId: 'cyfile:abc' })
    expect(known.objId).toBe('cyfile:abc')
    known.release()
    await expect(ensureObjId(item)).rejects.toMatchObject({ code: 'unsupported' })
  })
})
