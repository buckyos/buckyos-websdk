import { handlerOfApp, parseSystemOpen, readContentHints, systemOpenUrl } from '../src/content'

describe('system content open entry', () => {
  const source = { kind: 'cyfs-path' as const, path: 'cyfs:///home/alice/pics/a b#1.png' }

  it('round-trips a chooser request through the Zone root URL', () => {
    const url = new URL(systemOpenUrl('https://zone.example', {
      request: { source, session: { kind: 'container', container: { kind: 'cyfs-path', path: 'cyfs:///home/alice/pics' }, current: source } },
      target: 'chooser',
      hints: { name: 'a b#1.png', mime: 'image/png', size: 42 },
      from: 'text-editor.buckyos.bns.did',
    }))
    expect(url.origin).toBe('https://zone.example')
    expect(url.pathname).toBe('/')
    const parsed = parseSystemOpen(url.searchParams)
    expect(parsed).toEqual({
      request: { source, session: { kind: 'container', container: { kind: 'cyfs-path', path: 'cyfs:///home/alice/pics' }, current: source } },
      target: 'chooser',
      hints: { name: 'a b#1.png', mime: 'image/png', size: 42 },
      from: 'text-editor.buckyos.bns.did',
    })
  })

  it('keeps the old default/preview deep links and rejects foreign references', () => {
    expect(parseSystemOpen(new URLSearchParams('open=obj://chunk:abc&intent=preview'))).toMatchObject({ request: { source: { kind: 'object-id', objectId: 'chunk:abc' } }, target: 'preview' })
    expect(parseSystemOpen(new URLSearchParams('open=cyfs:///home/a.txt'))?.target).toBe('default')
    expect(parseSystemOpen(new URLSearchParams('open=https://evil.example/x'))).toBeUndefined()
    expect(parseSystemOpen(new URLSearchParams('open=cyfs:///a&from=x"y'))?.from).toBeUndefined()
  })

  it('accepts only well-formed hints', () => {
    expect(readContentHints({ name: '../x', mime: 'text/html; charset=utf-8', size: -1 })).toEqual({})
    expect(readContentHints({ name: 'r.pdf', mime: 'Application/PDF', size: '7' })).toEqual({ name: 'r.pdf', mime: 'application/pdf', size: 7 })
  })

  it('matches every handler of the same App, whatever instance', () => {
    expect(handlerOfApp({ appInstanceId: 'text-editor.buckyos.bns.did@devtest' }, 'text-editor.buckyos.bns.did')).toBe(true)
    expect(handlerOfApp({ appInstanceId: 'text-editor.buckyos.bns.did@bob' }, 'text-editor.buckyos.bns.did@devtest')).toBe(true)
    expect(handlerOfApp({ appInstanceId: 'notes.fixture.bns.did@owner' }, 'text-editor.buckyos.bns.did')).toBe(false)
    expect(handlerOfApp({}, 'text-editor.buckyos.bns.did')).toBe(false)
  })
})
