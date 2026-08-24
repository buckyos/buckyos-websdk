import { createSDKModule, RuntimeType } from '../src/sdk_core'

function makeResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  }
}

describe('BuckyOSSDK.loginByPassword', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('forwards the configured target app instance to verify-hub', async () => {
    const fetcher = jest.fn().mockImplementation(async (_url, init: RequestInit) => {
      const request = JSON.parse(init.body as string)
      return makeResponse({
        result: {
          user_info: {
            show_name: 'Alice',
            user_id: 'alice',
            user_type: 'user',
          },
          session_token: 'session-token',
          refresh_token: 'refresh-token',
        },
        sys: [request.sys[0]],
      })
    })
    global.fetch = fetcher as typeof fetch
    const sdk = createSDKModule('universal')
    const appId = 'notes.example.com'
    const appInstanceId = `${appId}@alice`
    await sdk.initBuckyOS(appId, {
      appId,
      appInstanceId,
      runtimeType: RuntimeType.Browser,
      zoneHost: 'example.com',
      defaultProtocol: 'https://',
    })

    await expect(sdk.loginByPassword('alice', 'password')).resolves.toMatchObject({
      user_id: 'alice',
      session_token: 'session-token',
    })

    const body = JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)
    expect(body.params).toMatchObject({
      type: 'password',
      username: 'alice',
      appid: appId,
      app_instance_id: appInstanceId,
    })
  })

  it('fails before sending a request when no target app instance is configured', async () => {
    const fetcher = jest.fn()
    global.fetch = fetcher as typeof fetch
    const sdk = createSDKModule('universal')
    await sdk.initBuckyOS('notes.example.com', {
      appId: 'notes.example.com',
      runtimeType: RuntimeType.Browser,
      zoneHost: 'example.com',
      defaultProtocol: 'https://',
    })

    await expect(sdk.loginByPassword('alice', 'password')).rejects.toThrow(
      'loginByPassword requires BuckyOSConfig.appInstanceId',
    )
    expect(fetcher).not.toHaveBeenCalled()
  })
})
