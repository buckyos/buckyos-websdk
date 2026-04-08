/** @jest-environment node */

/**
 * AppClient runtime integration test.
 *
 * Follows the three-phase structure from tests/测试用例组织.md:
 *   1) init phase: load the local private key, initialize the SDK in
 *      AppClient mode and generate a local JWT via `login()`.
 *   2) shared ServiceClient suite.
 *   3) AppClient-specific assertions.
 */

import {
  configureInsecureTlsIfNeeded,
  getEnv,
  getServiceUrl,
  installInsecureNodeFetchIfNeeded,
  shouldRunIntegrationTests,
} from '../../helpers/test_env'
import { defineSharedServiceClientSuite } from '../../helpers/service_client_suite'

jest.setTimeout(30000)

const describeIntegration = shouldRunIntegrationTests() ? describe : describe.skip

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describeIntegration('AppClient runtime integration', () => {
  const appId = getEnv('BUCKYOS_TEST_APP_ID', 'buckycli') as string
  const zoneHost = getEnv('BUCKYOS_TEST_ZONE_HOST', 'test.buckyos.io') as string
  const verifyHubServiceUrl = getEnv(
    'BUCKYOS_TEST_VERIFY_HUB_URL',
    getServiceUrl(appId, zoneHost, 'verify-hub'),
  ) as string
  const systemConfigServiceUrl = getEnv(
    'BUCKYOS_TEST_SYSTEM_CONFIG_URL',
    getServiceUrl(appId, zoneHost, 'system-config'),
  ) as string
  const privateKeySearchPaths = [
    getEnv('BUCKYOS_TEST_APP_CLIENT_DIR'),
    '/opt/buckyos/etc/.buckycli',
    '/opt/buckyos/etc',
    `${process.env.HOME ?? ''}/.buckycli`,
    `${process.env.HOME ?? ''}/.buckyos`,
  ].filter((item): item is string => Boolean(item))

  // Shared state captured by phase 1 and reused by phases 2 & 3.
  let buckyosRef: typeof import('../../../src/index')['buckyos']
  let sessionTokenClaims: Record<string, unknown> | null = null
  let accountUserId = ''

  beforeAll(async () => {
    configureInsecureTlsIfNeeded(zoneHost)
    await installInsecureNodeFetchIfNeeded(zoneHost)

    // Phase 1: runtime-specific initialization.
    const { buckyos, RuntimeType } = await import('../../../src/index')
    const { parseSessionTokenClaims } = await import('../../../src/runtime')

    await buckyos.initBuckyOS(appId, {
      appId,
      runtimeType: RuntimeType.AppClient,
      zoneHost,
      defaultProtocol: 'https://',
      verifyHubServiceUrl,
      systemConfigServiceUrl,
      privateKeySearchPaths,
      autoRenew: false,
    })

    // Small delay so the locally generated JWT is valid.
    await sleep(1100)
    const accountInfo = await buckyos.login()

    if (!accountInfo?.session_token) {
      throw new Error('AppClient login failed to produce a session token')
    }

    buckyosRef = buckyos
    sessionTokenClaims = parseSessionTokenClaims(accountInfo.session_token) as
      | Record<string, unknown>
      | null
    accountUserId = accountInfo.user_id
      ?? (sessionTokenClaims?.sub as string | undefined)
      ?? (sessionTokenClaims?.userid as string | undefined)
      ?? 'root'
  })

  afterAll(() => {
    if (buckyosRef && buckyosRef.getBuckyOSConfig()) {
      buckyosRef.logout(false)
    }
  })

  // Phase 2: shared ServiceClient tests.
  defineSharedServiceClientSuite({
    getSdk: () => buckyosRef,
    getAppId: () => appId,
    getUserId: () => accountUserId,
    // AppClient is a system-level client; the runtime intentionally does not
    // expose a per-app `getMySettingsPath`, so the settings round-trip case
    // does not apply here.
    skipSettings: true,
  })

  // Phase 3: AppClient-specific assertions.
  describe('AppClient specific', () => {
    it('the locally generated session token carries the expected appid claim', () => {
      expect(sessionTokenClaims).toEqual(
        expect.objectContaining({
          appid: appId,
        }),
      )
    })

    it('the account user_id matches the session token subject', () => {
      const expectedSubject = (sessionTokenClaims?.sub as string | undefined)
        ?? (sessionTokenClaims?.userid as string | undefined)
      expect(accountUserId).toBe(expectedSubject)
    })
  })
})
