import {
  configureInsecureTlsIfNeeded,
  getEnv,
  getServiceUrl,
  installInsecureNodeFetchIfNeeded,
  shouldRunIntegrationTests,
} from './test_env'

jest.setTimeout(30000)

const describeIntegration = shouldRunIntegrationTests() ? describe : describe.skip

describeIntegration('Web runtime integration', () => {
  const appId = getEnv('BUCKYOS_TEST_APP_ID', 'buckycli') as string
  const zoneHost = getEnv('BUCKYOS_TEST_ZONE_HOST', 'test.buckyos.io') as string
  const username = getEnv('BUCKYOS_TEST_USERNAME', 'devtest') as string
  const password = getEnv('BUCKYOS_TEST_PASSWORD', 'bucky2025') as string
  const verifyHubServiceUrl = getEnv('BUCKYOS_TEST_VERIFY_HUB_URL', getServiceUrl(appId, zoneHost, 'verify-hub')) as string

  beforeAll(() => {
    configureInsecureTlsIfNeeded(zoneHost)
  })

  beforeAll(async () => {
    await installInsecureNodeFetchIfNeeded(zoneHost)
  })

  beforeEach(() => {
    window.localStorage.clear()
    document.cookie = ''
  })

  it('initializes browser runtime and logs in via password', async () => {
    const { buckyos, RuntimeType } = await import('../../src/index')

    await buckyos.initBuckyOS(appId, {
      appId,
      runtimeType: RuntimeType.Browser,
      zoneHost,
      defaultProtocol: 'https://',
      verifyHubServiceUrl,
      autoRenew: false,
    })

    const accountInfo = await buckyos.doLogin(username, password)
    const stored = window.localStorage.getItem(`buckyos.account_info.${appId}`)

    expect(accountInfo?.user_id).toBeTruthy()
    expect(accountInfo?.session_token).toBeTruthy()
    expect(accountInfo?.refresh_token).toBeTruthy()
    expect(stored).toContain('"session_token"')
    expect(document.cookie).toContain(`${appId}_token=`)
  })
})
