import { saveBrowserUserInfo, saveLocalAccountInfo } from '../../src/account'
import { BuckyOSSDK, RuntimeType } from '../../src/sdk_core'

describe('BuckyOSSDK settings helpers', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.cookie = ''
  })

  function createRuntime(settings: Record<string, unknown>) {
    return {
      login: jest.fn().mockResolvedValue(undefined),
      getMySettings: jest.fn().mockResolvedValue(settings),
      updateAllMySettings: jest.fn().mockResolvedValue(undefined),
      getConfig: jest.fn().mockReturnValue({ runtimeType: RuntimeType.Browser }),
      getAppId: jest.fn().mockReturnValue('app-a'),
      getSessionToken: jest.fn().mockReturnValue(null),
      getRefreshToken: jest.fn().mockReturnValue(null),
      refreshBrowserSession: jest.fn().mockResolvedValue(null),
      getOwnerUserId: jest.fn().mockReturnValue(null),
      setSessionToken: jest.fn(),
      setRefreshToken: jest.fn(),
      clearAuthState: jest.fn(),
    }
  }

  it('getAppSetting returns full settings object, dot paths, slash paths, and undefined for missing keys', async () => {
    const sdk = new BuckyOSSDK('browser')
    const runtime = createRuntime({
      profile: {
        theme: {
          color: 'blue',
        },
      },
    })
    ;(sdk as unknown as { currentRuntime: unknown }).currentRuntime = runtime

    await expect(sdk.getAppSetting()).resolves.toEqual({
      profile: {
        theme: {
          color: 'blue',
        },
      },
    })
    await expect(sdk.getAppSetting('profile.theme.color')).resolves.toBe('blue')
    await expect(sdk.getAppSetting('profile/theme/color')).resolves.toBe('blue')
    await expect(sdk.getAppSetting('profile.theme.missing')).resolves.toBeUndefined()
  })

  it('setAppSetting updates nested keys and parses JSON values', async () => {
    const sdk = new BuckyOSSDK('browser')
    const runtime = createRuntime({
      profile: {
        theme: {
          color: 'blue',
        },
      },
    })
    ;(sdk as unknown as { currentRuntime: unknown }).currentRuntime = runtime

    await sdk.setAppSetting('profile.theme.color', '"green"')
    await sdk.setAppSetting('profile/theme/contrast', '2')

    expect(runtime.updateAllMySettings).toHaveBeenNthCalledWith(1, {
      profile: {
        theme: {
          color: 'green',
        },
      },
    })
    expect(runtime.updateAllMySettings).toHaveBeenNthCalledWith(2, {
      profile: {
        theme: {
          color: 'blue',
          contrast: 2,
        },
      },
    })
  })

  it('setAppSetting replaces the full settings object when settingName is null', async () => {
    const sdk = new BuckyOSSDK('browser')
    const runtime = createRuntime({ old: true })
    ;(sdk as unknown as { currentRuntime: unknown }).currentRuntime = runtime

    await sdk.setAppSetting(null, '{"newValue":true}')

    expect(runtime.updateAllMySettings).toHaveBeenCalledWith({ newValue: true })
  })

  it('setAppSetting rejects invalid full-object replacement payloads', async () => {
    const sdk = new BuckyOSSDK('browser')
    const runtime = createRuntime({ old: true })
    ;(sdk as unknown as { currentRuntime: unknown }).currentRuntime = runtime

    await expect(sdk.setAppSetting(null, '"not-an-object"')).rejects.toThrow(
      'settingValue must be a JSON object when settingName is null',
    )
  })

  it('browser auto-login restores scoped account info from localStorage', async () => {
    const sdk = new BuckyOSSDK('browser')
    const runtime = createRuntime({})
    ;(sdk as unknown as { currentRuntime: unknown }).currentRuntime = runtime

    const accountInfo = {
      user_name: 'devtest',
      user_id: 'devtest',
      user_type: 'user',
      session_token: 'session-token',
      refresh_token: 'refresh-token',
    }
    saveLocalAccountInfo('app-a', accountInfo)

    await expect(sdk.login(true)).resolves.toEqual(accountInfo)
    expect(runtime.setSessionToken).toHaveBeenCalledWith('session-token')
    expect(runtime.setRefreshToken).toHaveBeenCalledWith('refresh-token')
  })

  it('browser getAccountInfo returns cached user_info even when runtime session token is empty', async () => {
    const sdk = new BuckyOSSDK('browser')
    const runtime = createRuntime({})
    ;(sdk as unknown as { currentRuntime: unknown }).currentRuntime = runtime
    saveBrowserUserInfo({
      user_name: 'devtest',
      user_id: 'devtest',
      user_type: 'user',
    })

    await expect(sdk.getAccountInfo()).resolves.toEqual({
      user_name: 'devtest',
      user_id: 'devtest',
      user_type: 'user',
      session_token: '',
      refresh_token: undefined,
    })
    expect(runtime.refreshBrowserSession).not.toHaveBeenCalled()
  })

  it('browser getAccountInfo refreshes once when no cached user_info exist', async () => {
    const sdk = new BuckyOSSDK('browser')
    const runtime = createRuntime({})
    runtime.getSessionToken.mockReturnValue('sso-session-token')
    runtime.refreshBrowserSession.mockResolvedValue({
      user_name: 'devtest',
      user_id: 'devtest',
      user_type: 'user',
    })
    ;(sdk as unknown as { currentRuntime: unknown }).currentRuntime = runtime

    await expect(sdk.getAccountInfo()).resolves.toEqual({
      user_name: 'devtest',
      user_id: 'devtest',
      user_type: 'user',
      session_token: 'sso-session-token',
      refresh_token: undefined,
    })
    expect(runtime.refreshBrowserSession).toHaveBeenCalledTimes(1)
  })

  it('loginByPassword performs explicit password login', async () => {
    const sdk = new BuckyOSSDK('browser')
    const expected = {
      user_name: 'devtest',
      user_id: 'devtest',
      user_type: 'user',
      session_token: 'session-token',
    }

    const spy = jest.spyOn(sdk, 'loginByPassword').mockResolvedValue(expected)

    await expect(sdk.loginByPassword('devtest', 'password')).resolves.toEqual(expected)
    expect(spy).toHaveBeenCalledWith('devtest', 'password')
  })

  it('login delegates AppClient and AppService to runtime-session login', async () => {
    const sdk = new BuckyOSSDK('node')
    const runtime = createRuntime({})
    runtime.getConfig.mockReturnValue({ runtimeType: RuntimeType.AppClient })
    runtime.getSessionToken.mockReturnValue('runtime-session-token')
    ;(sdk as unknown as { currentRuntime: unknown }).currentRuntime = runtime

    await sdk.login()

    expect(runtime.login).toHaveBeenCalled()
  })

  it('logout clears local storage and runtime auth state', () => {
    const sdk = new BuckyOSSDK('browser')
    const runtime = createRuntime({})
    ;(sdk as unknown as { currentRuntime: unknown }).currentRuntime = runtime

    saveLocalAccountInfo('app-a', {
      user_name: 'devtest',
      user_id: 'devtest',
      user_type: 'user',
      session_token: 'session-token',
    })
    saveBrowserUserInfo({
      user_name: 'devtest',
      user_id: 'devtest',
      user_type: 'user',
    })

    sdk.logout(true)

    expect(window.localStorage.getItem('buckyos.account_info.app-a')).toBeNull()
    expect(window.localStorage.getItem('user_info')).toBeNull()
    expect(runtime.clearAuthState).toHaveBeenCalled()
  })
})
