/** @jest-environment node */

import {
  configureInsecureTlsIfNeeded,
  getEnv,
  getServiceUrl,
  installInsecureNodeFetchIfNeeded,
  shouldRunIntegrationTests,
} from './test_env'

jest.setTimeout(30000)

const describeIntegration = shouldRunIntegrationTests() ? describe : describe.skip

describeIntegration('VerifyHub integration', () => {
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

  it('logs in with the shared test account and verifies the returned token', async () => {
    const { hashPassword } = await import('../../src/account')
    const { kRPCClient } = await import('../../src/krpc_client')
    const { parseSessionTokenClaims } = await import('../../src/runtime')
    const { VerifyHubClient } = await import('../../src/verify-hub-client')
    const nonce = Date.now()
    const client = new VerifyHubClient(new kRPCClient(verifyHubServiceUrl, null, nonce))
    const response = await client.loginByPassword({
      username,
      password: hashPassword(username, password, nonce),
      appid: appId,
    })
    const normalized = VerifyHubClient.normalizeLoginResponse(response)
    const claims = parseSessionTokenClaims(normalized.session_token)

    expect(normalized.user_id).toBeTruthy()
    expect(normalized.session_token).toBeTruthy()
    expect(normalized.refresh_token).toBeTruthy()
    expect(claims).toEqual(expect.objectContaining({
      appid: appId,
    }))

    const verifyClient = new VerifyHubClient(new kRPCClient(
      verifyHubServiceUrl,
      normalized.session_token,
      Date.now(),
    ))
    await expect(verifyClient.verifyToken({
      session_token: normalized.session_token,
      appid: appId,
    })).resolves.toBe(true)
  })

  it('refreshes the session token when a refresh token is available', async () => {
    const { hashPassword } = await import('../../src/account')
    const { kRPCClient } = await import('../../src/krpc_client')
    const { VerifyHubClient } = await import('../../src/verify-hub-client')
    const nonce = Date.now()
    const client = new VerifyHubClient(new kRPCClient(verifyHubServiceUrl, null, nonce))
    const response = VerifyHubClient.normalizeLoginResponse(await client.loginByPassword({
      username,
      password: hashPassword(username, password, nonce),
      appid: appId,
    }))

    const refreshClient = new VerifyHubClient(new kRPCClient(
      verifyHubServiceUrl,
      response.session_token,
      Date.now(),
    ))
    const refreshed = await refreshClient.refreshToken({
      refresh_token: response.refresh_token as string,
    })

    expect(refreshed.session_token).toBeTruthy()
    expect(refreshed.session_token).not.toBe(response.session_token)
    expect(refreshed.refresh_token).toBeTruthy()
  })
})
