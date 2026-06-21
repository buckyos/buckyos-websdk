/** @jest-environment node */

import { createSDKModule } from '../../src/sdk_core'
import { RuntimeType } from '../../src/runtime'

class MemoryStorage implements Storage {
  private readonly store = new Map<string, string>()

  get length(): number {
    return this.store.size
  }

  clear(): void {
    this.store.clear()
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key) ?? null : null
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
}

function installGlobal<K extends keyof typeof globalThis>(key: K, value: (typeof globalThis)[K]) {
  const hadOwnValue = Object.prototype.hasOwnProperty.call(globalThis, key)
  const previous = globalThis[key]

  Object.defineProperty(globalThis, key, {
    configurable: true,
    value,
  })

  return () => {
    if (hadOwnValue) {
      Object.defineProperty(globalThis, key, {
        configurable: true,
        value: previous,
      })
      return
    }

    delete (globalThis as Record<string, unknown>)[key as string]
  }
}

describe('browser logout', () => {
  const restoreCallbacks: Array<() => void> = []

  afterEach(() => {
    for (const restore of restoreCallbacks.splice(0).reverse()) {
      restore()
    }
    jest.restoreAllMocks()
  })

  it('calls sso_logout and clears local browser login state by default', async () => {
    const localStorage = new MemoryStorage()
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
    })) as unknown as typeof fetch
    const documentMock = { cookie: '' } as Document

    restoreCallbacks.push(installGlobal('localStorage', localStorage))
    restoreCallbacks.push(installGlobal('fetch', fetchMock))
    restoreCallbacks.push(installGlobal('document', documentMock))

    localStorage.setItem('buckyos.account_info.demo-app', '{"session_token":"token"}')
    localStorage.setItem('user_info', '{"user_id":"alice","user_type":"people","user_name":"Alice"}')

    const sdk = createSDKModule('universal')
    await sdk.initBuckyOS('demo-app', {
      appId: 'demo-app',
      runtimeType: RuntimeType.Browser,
      zoneHost: 'test.buckyos.io',
      defaultProtocol: 'https://',
      autoRenew: false,
    })

    sdk.logout()

    expect(fetchMock).toHaveBeenCalledWith('/sso_logout', {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      keepalive: true,
    })
    expect(localStorage.getItem('buckyos.account_info.demo-app')).toBeNull()
    expect(localStorage.getItem('user_info')).toBeNull()
    expect(documentMock.cookie).toContain('demo-app_token=')
    expect(documentMock.cookie).toContain('expires=')
  })

  it('keeps cleanAccountInfo=false as a local runtime-only logout', async () => {
    const localStorage = new MemoryStorage()
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
    })) as unknown as typeof fetch
    const documentMock = { cookie: '' } as Document

    restoreCallbacks.push(installGlobal('localStorage', localStorage))
    restoreCallbacks.push(installGlobal('fetch', fetchMock))
    restoreCallbacks.push(installGlobal('document', documentMock))

    localStorage.setItem('buckyos.account_info.demo-app', '{"session_token":"token"}')
    localStorage.setItem('user_info', '{"user_id":"alice","user_type":"people","user_name":"Alice"}')

    const sdk = createSDKModule('universal')
    await sdk.initBuckyOS('demo-app', {
      appId: 'demo-app',
      runtimeType: RuntimeType.Browser,
      zoneHost: 'test.buckyos.io',
      defaultProtocol: 'https://',
      autoRenew: false,
    })

    sdk.logout(false)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(localStorage.getItem('buckyos.account_info.demo-app')).toBe('{"session_token":"token"}')
    expect(localStorage.getItem('user_info')).toBe('{"user_id":"alice","user_type":"people","user_name":"Alice"}')
    expect(documentMock.cookie).toBe('')
  })
})
