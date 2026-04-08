/**
 * Browser runtime integration test (jsdom flavor).
 *
 * Follows the three-phase structure from tests/测试用例组织.md:
 *   1) init phase: initialize the SDK in Browser mode and log in via
 *      password against verify-hub. Starting 2026-04-06 the authoritative
 *      browser flow is the SSO click path driven by playwright in
 *      tests/browser/real-browser/playwright.spec.js; this jsdom test
 *      keeps the password login path as a backward-compat smoke test
 *      against the DV environment.
 *   2) shared ServiceClient suite.
 *   3) Browser-specific assertions (localStorage/cookie persistence).
 */

import {
  configureInsecureTlsIfNeeded,
  getEnv,
  installInsecureNodeFetchIfNeeded,
  shouldRunIntegrationTests,
  shouldRunOptionalIntegration,
} from '../../helpers/test_env'
import { defineSharedServiceClientSuite } from '../../helpers/service_client_suite'

jest.setTimeout(30000)

const describeIntegration = shouldRunIntegrationTests() ? describe : describe.skip
const runOpenDan = shouldRunIntegrationTests()
  && shouldRunOptionalIntegration('BUCKYOS_RUN_OPENDAN_INTEGRATION_TESTS')

describeIntegration('Browser runtime integration', () => {
  const appId = getEnv('BUCKYOS_TEST_APP_ID', 'buckycli') as string
  const zoneHost = getEnv('BUCKYOS_TEST_ZONE_HOST', 'test.buckyos.io') as string
  const username = getEnv('BUCKYOS_TEST_USERNAME', 'devtest') as string
  const password = getEnv('BUCKYOS_TEST_PASSWORD', 'bucky2025') as string

  let buckyosRef: typeof import('../../../src/index')['buckyos']
  let accountUserId = ''

  beforeAll(async () => {
    configureInsecureTlsIfNeeded(zoneHost)
    await installInsecureNodeFetchIfNeeded(zoneHost)

    window.localStorage.clear()
    document.cookie = ''

    // Phase 1: runtime-specific initialization. The real SSO click flow
    // is covered by tests/browser/real-browser/playwright.spec.js; here
    // we fall back to password login so the jsdom-based test still
    // reaches the service clients against the DV environment.
    const { buckyos, RuntimeType } = await import('../../../src/index')

    await buckyos.initBuckyOS(appId, {
      appId,
      runtimeType: RuntimeType.Browser,
      zoneHost,
      defaultProtocol: 'https://',
      autoRenew: false,
    })

    const accountInfo = await buckyos.loginByPassword(username, password)
    if (!accountInfo?.session_token) {
      throw new Error('Browser loginByPassword did not return a session token')
    }
    buckyosRef = buckyos
    accountUserId = accountInfo.user_id
  })

  afterAll(() => {
    if (buckyosRef && buckyosRef.getBuckyOSConfig()) {
      buckyosRef.logout(true)
    }
  })

  // Phase 2: shared ServiceClient tests.
  defineSharedServiceClientSuite({
    getSdk: () => buckyosRef,
    getAppId: () => appId,
    getUserId: () => accountUserId,
    runOpenDan,
  })

  // Phase 3: Browser-specific assertions.
  describe('Browser specific', () => {
    it('persists scoped account info in localStorage and cookie after login', () => {
      const stored = window.localStorage.getItem(`buckyos.account_info.${appId}`)
      expect(stored).toContain('"session_token"')
      expect(document.cookie).toContain(`${appId}_token=`)
    })
  })
})
