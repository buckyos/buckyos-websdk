/** @jest-environment node */

import { AuthClient } from '../../src/auth_client'

describe('AuthClient outside SSO browser environment', () => {
  it('cannot be created in node runtime', () => {
    expect(() => new AuthClient('test.buckyos.io')).toThrow(
      'AuthClient can only be created in browser SSO environments',
    )
  })
})

describe('AuthClient login URL', () => {
  const originalWindow = globalThis.window

  beforeEach(() => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        location: {
          protocol: 'https:',
          href: 'https://demo.test.buckyos.io/path?from=app#section',
        },
      },
    })
  })

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as Record<string, unknown>).window
      return
    }
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    })
  })

  it('identifies the SSO target using only redirect_url', () => {
    const authClient = new AuthClient('test.buckyos.io')
    const loginUrl = new URL(authClient.buildLoginURL())

    expect(loginUrl.origin).toBe('https://sys.test.buckyos.io')
    expect(loginUrl.pathname).toBe('/login')
    expect(Array.from(loginUrl.searchParams.keys())).toEqual(['redirect_url'])
    expect(loginUrl.searchParams.get('redirect_url')).toBe(
      'https://demo.test.buckyos.io/path?from=app#section',
    )
  })
})
