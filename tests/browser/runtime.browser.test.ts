import { createSDKModule, RuntimeType } from '../../src/sdk_core'
import { BuckyOSRuntime } from '../../src/runtime'
import { saveBrowserUserInfo } from '../../src/account'

describe('browser runtime behavior', () => {
  const originalBuckyApi = (window as unknown as { BuckyApi?: unknown }).BuckyApi

  beforeEach(() => {
    window.localStorage.clear()
    ;(window as unknown as { BuckyApi?: unknown }).BuckyApi = undefined
  })

  afterAll(() => {
    ;(window as unknown as { BuckyApi?: unknown }).BuckyApi = originalBuckyApi
  })

  it('infers Browser runtime when BuckyApi is absent', () => {
    const sdkModule = createSDKModule('browser')

    expect(sdkModule.getRuntimeType()).toBe(RuntimeType.Browser)
  })

  it('infers AppRuntime when BuckyApi is present', () => {
    ;(window as unknown as { BuckyApi?: unknown }).BuckyApi = {}
    const sdkModule = createSDKModule('browser')

    expect(sdkModule.getRuntimeType()).toBe(RuntimeType.AppRuntime)
  })

  it('uses cached zone host from localStorage during init', async () => {
    window.localStorage.setItem('zone_host_name', 'test.buckyos.io')

    const sdkModule = createSDKModule('browser')
    await sdkModule.initBuckyOS('web-demo')

    expect(sdkModule.getZoneHostName()).toBe('test.buckyos.io')
    expect(sdkModule.getZoneServiceURL('verify-hub')).toBe('/kapi/verify-hub/')
  })

  it('refreshes browser session token through /sso_refresh before kRPC when runtime token is empty', async () => {
    saveBrowserUserInfo({
      user_name: 'devtest',
      user_id: 'devtest',
      user_type: 'user',
    })
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            session_token: 'header.eyJhcHBpZCI6IndlYi1kZW1vIiwiZXhwIjo0MTAyNDQ0ODAwfQ.signature',
            user_info: {
              show_name: 'devtest',
              user_id: 'devtest',
              user_type: 'user',
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            result: { value: '{"ok":true}', version: 1 },
          }),
        }),
    })

    const runtime = new BuckyOSRuntime({
      zoneHost: 'test.buckyos.io',
      appId: 'web-demo',
      defaultProtocol: 'https://',
      runtimeType: RuntimeType.Browser,
      autoRenew: false,
    })
    const client = runtime.getServiceRpcClient('system_config')

    await client.call('sys_config_get', { key: 'services/web-demo/settings' })

    expect(runtime.getSessionToken()).toBe('header.eyJhcHBpZCI6IndlYi1kZW1vIiwiZXhwIjo0MTAyNDQ0ODAwfQ.signature')
    expect(globalThis.fetch).toHaveBeenNthCalledWith(1, '/sso_refresh', {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
    })
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      '/kapi/system_config/',
      expect.objectContaining({
        method: 'POST',
      }),
    )
    const rpcCallArgs = (globalThis.fetch as jest.Mock).mock.calls[1][1]
    expect(JSON.parse(rpcCallArgs.body as string).sys[1]).toBe(
      'header.eyJhcHBpZCI6IndlYi1kZW1vIiwiZXhwIjo0MTAyNDQ0ODAwfQ.signature',
    )
  })
})
