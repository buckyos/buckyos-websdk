import { PreviewEmbed } from '../src/app-frame'

describe('PreviewEmbed (App side)', () => {
  const original = (globalThis as { window?: unknown }).window
  afterEach(() => { (globalThis as { window?: unknown }).window = original })

  it('posts nothing before the handshake, and embed.init carries what changed meanwhile', () => {
    const listeners = new Set<(event: unknown) => void>()
    ;(globalThis as { window?: unknown }).window = {
      location: { origin: 'https://app.zone.example' },
      addEventListener: (_: string, fn: (event: unknown) => void) => { listeners.add(fn) },
      removeEventListener: (_: string, fn: (event: unknown) => void) => { listeners.delete(fn) },
    }
    const posted: Array<{ data: { type: string; payload: Record<string, unknown> }; origin: string }> = []
    // Until the frame commits the system page it is about:blank with the App's origin, where any post fails.
    const contentWindow = { postMessage: (data: never, origin: string) => { posted.push({ data, origin }) } }
    const embed = new PreviewEmbed({
      systemOrigin: 'https://zone.example',
      frame: () => ({ contentWindow }) as unknown as HTMLIFrameElement,
      init: { source: { kind: 'blob', blob: new Blob(['x']), name: 'x.png' }, theme: 'light', locale: 'en' },
    })
    embed.update({ theme: 'dark' })
    expect(posted).toEqual([])

    const nonce = new URLSearchParams(embed.url.split('#')[1]).get('bpe')
    const hello = { protocol: 'buckyos.preview-embed', version: 1, type: 'embed.hello', payload: { nonce } }
    listeners.forEach(fn => fn({ origin: 'https://zone.example', source: contentWindow, data: hello }))
    expect(posted).toHaveLength(1)
    expect(posted[0].origin).toBe('https://zone.example')
    expect(posted[0].data).toMatchObject({ type: 'embed.init', payload: { nonce, theme: 'dark', locale: 'en' } })

    embed.update({ locale: 'zh-CN' })
    expect(posted).toHaveLength(2)
    expect(posted[1].data).toMatchObject({ type: 'embed.update', payload: { locale: 'zh-CN' } })
    embed.dispose()
  })
})
