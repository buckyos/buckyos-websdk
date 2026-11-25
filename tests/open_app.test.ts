import vectors from './open_app_vectors.json'
import {
  appWindowId, formatAppOpenUrl, isAppPath, parseAppOpenUrl, parseAppWindowId, parseBuckyosUrl, parseSystemOpenApp, readAppOpenRequest,
  readAppWindowDeclaration, resolveOpenApp, systemOpenAppUrl, type OpenAppRequest, type OpenAppWindow,
} from '../src/open_app'

describe('resolveOpenApp', () => {
  it.each(vectors.resolve.map(v => [v.name, v] as const))('%s', (_name, v) => {
    expect(resolveOpenApp(v.request as OpenAppRequest, v.appInstance, readAppWindowDeclaration(v.declaration), v.windows as OpenAppWindow[])).toEqual(v.expected)
  })
  it('focuses a window by the id it has, whatever made it', () => {
    const window = { id: 'legacy-1', zone: 'did:bns:alice', appInstance: 'files', windowPath: '', lastActive: 1 }
    expect(resolveOpenApp({ zone: 'did:bns:alice', app: 'files' }, 'files', readAppWindowDeclaration(undefined), [window])).toEqual({ action: 'focus', windowId: 'legacy-1' })
  })
})

describe('window declarations', () => {
  it.each(vectors.declarations.map(v => [v.name, v] as const))('%s', (_name, v) => {
    expect(readAppWindowDeclaration(v.value)).toEqual(v.expected)
  })
})

describe('window ids', () => {
  it('encodes each part and reads it back', () => {
    for (const { id, ...parts } of vectors.window_ids) {
      expect(appWindowId(parts.zone, parts.appInstance, parts.windowPath)).toBe(id)
      expect(parseAppWindowId(id)).toEqual(parts)
    }
    expect(appWindowId('did:bns:alice', 'files')).toBe(appWindowId('did:bns:alice', 'files', ''))
  })
  it.each(vectors.invalid_window_ids)('rejects %p', id => { expect(parseAppWindowId(id)).toBeUndefined() })
})

describe('buckyos:// addresses', () => {
  it('round-trips an address', () => {
    for (const { link, url } of vectors.app_urls) {
      expect(formatAppOpenUrl(link)).toBe(url)
      expect(parseAppOpenUrl(url)).toEqual(link)
    }
  })
  it.each(vectors.accepted_app_urls.map(v => [v.name, v] as const))('accepts %s', (_name, v) => { expect(parseAppOpenUrl(v.url)).toEqual(v.link) })
  it.each(vectors.rejected_app_urls.map(v => [v.name, v] as const))('rejects %s', (_name, v) => { expect(parseAppOpenUrl(v.url)).toBeUndefined() })
  it('reads any action', () => {
    const parsed = parseBuckyosUrl('buckyos://sign.payload?v=1&request_url=https%3A%2F%2Fexample.com#x')
    expect(parsed).toMatchObject({ action: 'sign.payload', version: 1 })
    expect(parsed?.params.get('request_url')).toBe('https://example.com')
    expect(parseBuckyosUrl('buckyos://intent?v=1')?.action).toBe('intent')
    expect(parseBuckyosUrl('buckyos://?v=1')).toBeUndefined()
    expect(parseBuckyosUrl('buckyos://app..open?v=1')).toBeUndefined()
    expect(parseBuckyosUrl('buckyos://app.open?v=x')).toBeUndefined()
  })
})

describe('requests that cross a window boundary', () => {
  it('keeps the known fields of a valid request', () => {
    expect(readAppOpenRequest({ app: 'files', path: '/a', window: 'w', mode: 'new', zone: 'did:bns:bob', token: 'x' }))
      .toEqual({ app: 'files', path: '/a', window: 'w', mode: 'new', zone: 'did:bns:bob' })
    expect(readAppOpenRequest({ app: 'files' })).toEqual({ app: 'files' })
  })
  it('rejects the rest', () => {
    for (const value of [null, 'files', {}, { app: '' }, { app: 'a b' }, { app: 'files', path: 'a' }, { app: 'files', path: '//evil' }, { app: 'files', path: '/\\evil' },
      { app: 'files', window: 1 }, { app: 'files', window: '\ud800' }, { app: 'files', mode: 'tab' }, { app: 'files', zone: '' }]) {
      expect(readAppOpenRequest(value)).toBeUndefined()
    }
  })
  it('knows a page inside the App', () => {
    expect(isAppPath('/')).toBe(true)
    expect(isAppPath('/a/b?x=//y#z')).toBe(true)
    for (const path of ['', 'a', '//a', '/\\a', '/\t/a', 'https://a', undefined, `/${'x'.repeat(5000)}`]) expect(isAppPath(path)).toBe(false)
  })
  it('round-trips through the Zone root address', () => {
    const request = { app: 'messagehub', path: '/?notify=n1', window: 'a b', mode: 'new' as const }
    const url = new URL(systemOpenAppUrl('https://zone.example/ignored', request))
    expect(url.origin + url.pathname).toBe('https://zone.example/')
    expect(parseSystemOpenApp(url.searchParams)).toEqual(request)
    expect(parseSystemOpenApp(new URL(systemOpenAppUrl('https://zone.example', { app: 'files' })).searchParams)).toEqual({ app: 'files' })
    expect(parseSystemOpenApp(new URLSearchParams('open=cyfs:///a'))).toBeUndefined()
  })
})
