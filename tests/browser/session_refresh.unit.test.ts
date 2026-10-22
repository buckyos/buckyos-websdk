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
    return this.store.get(key) ?? null
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

function makeJwt(payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>) => Buffer.from(JSON.stringify(value))
    .toString('base64url')
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.signature`
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

const ALICE_IDENTITY = {
  kind: 'account',
  user_id: 'alice',
  did: 'did:bns:alice.test',
  user_type: 'user',
  show_name: 'Alice',
  zone_host: 'test.buckyos.io',
  auth_method: 'password',
  restricted: false,
  password_set: true,
}

const EXTERNAL_IDENTITY = {
  kind: 'external',
  did: 'did:bns:bob',
  show_name: 'Bob',
  zone_host: 'test.buckyos.io',
  auth_method: 'did_federation',
  restricted: true,
  scopes: ['msg_group', 'aiworkspace', 'homestation'],
}

function ssoRefreshResponse(sessionToken: string, identity: unknown = ALICE_IDENTITY): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ session_token: sessionToken, identity }),
  } as Response
}

describe('web runtime session refresh', () => {
  const restoreCallbacks: Array<() => void> = []

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
    for (const restore of restoreCallbacks.splice(0).reverse()) {
      restore()
    }
    jest.restoreAllMocks()
  })

  it.each([RuntimeType.Browser, RuntimeType.AppRuntime])(
    '%s getAccountInfo refreshes the in-memory token and stores the returned identity',
    async (runtimeType) => {
      const localStorage = new MemoryStorage()
      const sessionToken = makeJwt({
        appid: 'demo-app',
        iss: 'verify-hub',
        sub: 'alice',
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
      const fetchMock = jest.fn(async () => ssoRefreshResponse(sessionToken)) as unknown as typeof fetch

      restoreCallbacks.push(installGlobal('localStorage', localStorage))
      restoreCallbacks.push(installGlobal('fetch', fetchMock))
      localStorage.setItem('user_info', JSON.stringify({
        user_id: 'mallory',
        user_name: 'Mallory',
        user_type: 'admin',
      }))

      const sdk = createSDKModule('universal')
      await sdk.initBuckyOS('demo-app', {
        appId: 'demo-app',
        runtimeType,
        zoneHost: 'test.buckyos.io',
        defaultProtocol: 'https://',
        autoRenew: false,
      })

      await expect(sdk.getAccountInfo()).resolves.toEqual({
        user_id: 'alice',
        user_name: 'Alice',
        user_type: 'user',
        session_token: sessionToken,
        refresh_token: undefined,
      })
      await expect(sdk.getCurrentIdentity()).resolves.toEqual(ALICE_IDENTITY)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledWith('/sso_refresh', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
      })
    },
  )

  it('reports an External session as an identity without account info', async () => {
    const localStorage = new MemoryStorage()
    const sessionToken = makeJwt({
      appid: 'control-panel',
      iss: 'verify-hub',
      sub: 'did:bns:bob',
      external: true,
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
    const fetchMock = jest.fn(async () => ssoRefreshResponse(sessionToken, EXTERNAL_IDENTITY)) as unknown as typeof fetch
    restoreCallbacks.push(installGlobal('localStorage', localStorage))
    restoreCallbacks.push(installGlobal('fetch', fetchMock))
    localStorage.setItem('user_info', JSON.stringify({ user_id: 'alice', user_name: 'Alice', user_type: 'user' }))

    const sdk = createSDKModule('universal')
    await sdk.initBuckyOS('control-panel', {
      appId: 'control-panel',
      runtimeType: RuntimeType.Browser,
      zoneHost: 'test.buckyos.io',
      defaultProtocol: 'https://',
      autoRenew: false,
    })

    await expect(sdk.getCurrentIdentity()).resolves.toEqual(EXTERNAL_IDENTITY)
    await expect(sdk.getAccountInfo()).resolves.toBeNull()
    expect(localStorage.getItem('user_info')).toBeNull()
  })

  it('does not report an identity that belongs to another subject than the token', async () => {
    const localStorage = new MemoryStorage()
    const sessionToken = makeJwt({ appid: 'demo-app', iss: 'verify-hub', sub: 'bob', exp: Math.floor(Date.now() / 1000) + 3600 })
    const fetchMock = jest.fn(async () => ssoRefreshResponse(sessionToken, ALICE_IDENTITY)) as unknown as typeof fetch
    restoreCallbacks.push(installGlobal('localStorage', localStorage))
    restoreCallbacks.push(installGlobal('fetch', fetchMock))

    const sdk = createSDKModule('universal')
    await sdk.initBuckyOS('demo-app', {
      appId: 'demo-app',
      runtimeType: RuntimeType.Browser,
      zoneHost: 'test.buckyos.io',
      defaultProtocol: 'https://',
      autoRenew: false,
    })

    await expect(sdk.getCurrentIdentity()).resolves.toEqual({ kind: 'anonymous' })
  })

  it('never falls back to a cached identity when the refresh response has none', async () => {
    const localStorage = new MemoryStorage()
    const sessionToken = makeJwt({ appid: 'demo-app', iss: 'verify-hub', sub: 'alice', exp: Math.floor(Date.now() / 1000) + 3600 })
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ session_token: sessionToken }),
    } as Response)) as unknown as typeof fetch
    restoreCallbacks.push(installGlobal('localStorage', localStorage))
    restoreCallbacks.push(installGlobal('fetch', fetchMock))
    localStorage.setItem('user_info', JSON.stringify({ user_id: 'alice', user_name: 'Alice', user_type: 'user' }))
    localStorage.setItem('buckyos.identity', JSON.stringify(ALICE_IDENTITY))

    const sdk = createSDKModule('universal')
    await sdk.initBuckyOS('demo-app', {
      appId: 'demo-app',
      runtimeType: RuntimeType.Browser,
      zoneHost: 'test.buckyos.io',
      defaultProtocol: 'https://',
      autoRenew: false,
    })

    await expect(sdk.getAccountInfo()).resolves.toBeNull()
    await expect(sdk.getCurrentIdentity()).resolves.toEqual({ kind: 'anonymous' })
  })

  it('does not report a cached browser user as logged in when sso_refresh fails', async () => {
    const localStorage = new MemoryStorage()
    const fetchMock = jest.fn(async () => ({
      ok: false,
      status: 401,
    } as Response)) as unknown as typeof fetch

    restoreCallbacks.push(installGlobal('localStorage', localStorage))
    restoreCallbacks.push(installGlobal('fetch', fetchMock))
    localStorage.setItem('user_info', JSON.stringify({
      user_id: 'alice',
      user_name: 'Alice',
      user_type: 'people',
    }))

    const sdk = createSDKModule('universal')
    await sdk.initBuckyOS('demo-app', {
      appId: 'demo-app',
      runtimeType: RuntimeType.Browser,
      zoneHost: 'test.buckyos.io',
      defaultProtocol: 'https://',
      autoRenew: false,
    })

    await expect(sdk.getAccountInfo()).resolves.toBeNull()
  })

  it('automatically refreshes a web session near expiry without duplicate requests', async () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-08-17T00:00:00.000Z'))

    const localStorage = new MemoryStorage()
    const nowSeconds = Math.floor(Date.now() / 1000)
    const initialSessionToken = makeJwt({
      appid: 'demo-app',
      iss: 'verify-hub',
      sub: 'alice',
      exp: nowSeconds + 31,
    })
    const renewedSessionToken = makeJwt({
      appid: 'demo-app',
      iss: 'verify-hub',
      sub: 'alice',
      exp: nowSeconds + 3600,
    })
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(ssoRefreshResponse(initialSessionToken))
      .mockResolvedValueOnce(ssoRefreshResponse(renewedSessionToken)) as unknown as jest.MockedFunction<typeof fetch>

    restoreCallbacks.push(installGlobal('localStorage', localStorage))
    restoreCallbacks.push(installGlobal('fetch', fetchMock))
    localStorage.setItem('user_info', JSON.stringify({
      user_id: 'alice',
      user_name: 'Alice',
      user_type: 'people',
    }))

    const sdk = createSDKModule('universal')
    await sdk.initBuckyOS('demo-app', {
      appId: 'demo-app',
      runtimeType: RuntimeType.Browser,
      zoneHost: 'test.buckyos.io',
      defaultProtocol: 'https://',
      autoRenew: true,
      renewIntervalMs: 1000,
    })

    const [initialAccountInfo, concurrentAccountInfo] = await Promise.all([
      sdk.getAccountInfo(),
      sdk.getAccountInfo(),
    ])
    expect(initialAccountInfo?.session_token).toBe(initialSessionToken)
    expect(concurrentAccountInfo?.session_token).toBe(initialSessionToken)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await jest.advanceTimersByTimeAsync(1000)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const renewedAccountInfo = await sdk.getAccountInfo()
    expect(renewedAccountInfo?.session_token).toBe(renewedSessionToken)

    await jest.advanceTimersByTimeAsync(5000)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    sdk.logout(false)
  })
})
