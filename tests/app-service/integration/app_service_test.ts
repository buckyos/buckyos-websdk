/** @jest-environment node */

/**
 * AppService runtime integration test.
 *
 * Follows the three-phase structure from tests/测试用例组织.md:
 *   1) init phase: inject `app_instance_config`, `BUCKYOS_HOST_GATEWAY` and
 *      the Rust-style `<OWNER>_<APP>_TOKEN` env var, then initialize the
 *      SDK in AppService mode and call `login()` to start the refresh loop.
 *   2) shared ServiceClient suite.
 *   3) AppService-specific assertions.
 */

import {
  configureInsecureTlsIfNeeded,
  getEnv,
  getRustStyleAppServiceTokenEnvKey,
  installInsecureNodeFetchIfNeeded,
  shouldRunIntegrationTests,
  shouldRunOptionalIntegration,
} from '../../helpers/test_env'
import { defineSharedServiceClientSuite } from '../../helpers/service_client_suite'

jest.setTimeout(30000)

const appId = getEnv('BUCKYOS_TEST_APP_ID')
const ownerUserId = getEnv('BUCKYOS_TEST_OWNER_USER_ID')
const appServiceToken = getEnv('BUCKYOS_TEST_APP_SERVICE_TOKEN')
const appInstanceConfig = getEnv('BUCKYOS_TEST_APP_INSTANCE_CONFIG')
const zoneHost = getEnv('BUCKYOS_TEST_ZONE_HOST', 'test.buckyos.io') as string
const hostGateway = getEnv(
  'BUCKYOS_TEST_HOST_GATEWAY',
  getEnv('BUCKYOS_HOST_GATEWAY', 'host.docker.internal'),
)
const runOpenDan = shouldRunIntegrationTests()
  && shouldRunOptionalIntegration('BUCKYOS_RUN_OPENDAN_INTEGRATION_TESTS')

const canRunAppServiceIntegration = shouldRunIntegrationTests()
  && Boolean(appId && ownerUserId && appServiceToken)
const describeAppService = canRunAppServiceIntegration ? describe : describe.skip

describeAppService('AppService runtime integration', () => {
  let buckyosRef: typeof import('../../../src/index')['buckyos']

  beforeAll(async () => {
    configureInsecureTlsIfNeeded(zoneHost)
    await installInsecureNodeFetchIfNeeded(zoneHost)

    // Phase 1: runtime-specific environment preparation.
    process.env.app_instance_config = appInstanceConfig ?? JSON.stringify({
      app_spec: {
        user_id: ownerUserId,
        app_doc: {
          name: appId,
        },
      },
    })
    process.env.BUCKYOS_HOST_GATEWAY = hostGateway as string
    process.env[getRustStyleAppServiceTokenEnvKey(appId as string, ownerUserId as string)] =
      appServiceToken as string

    const { buckyos, RuntimeType } = await import('../../../src/index')

    await buckyos.initBuckyOS(appId as string, {
      appId: appId as string,
      ownerUserId: ownerUserId as string,
      runtimeType: RuntimeType.AppService,
      zoneHost: '',
      defaultProtocol: 'https://',
      autoRenew: false,
    })

    await buckyos.login()
    buckyosRef = buckyos
  })

  afterAll(() => {
    if (buckyosRef && buckyosRef.getBuckyOSConfig()) {
      buckyosRef.logout(false)
    }
  })

  // Phase 2: shared ServiceClient tests.
  defineSharedServiceClientSuite({
    getSdk: () => buckyosRef,
    getAppId: () => appId as string,
    getUserId: () => ownerUserId as string,
    runOpenDan,
  })

  // Phase 3: AppService-specific assertions.
  describe('AppService specific', () => {
    it('reads app settings through the local gateway route', async () => {
      const settings = await buckyosRef.getAppSetting()
      expect(
        settings === undefined || settings === null || typeof settings === 'object',
      ).toBe(true)
    })

    it('uses the injected BUCKYOS_HOST_GATEWAY for service URLs', () => {
      const verifyHubUrl = buckyosRef.getZoneServiceURL('verify-hub')
      expect(verifyHubUrl).toContain(hostGateway as string)
    })
  })
})
