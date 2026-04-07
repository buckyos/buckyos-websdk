/** @jest-environment node */

import { buckyos, RuntimeType } from '../../../src/index'
import {
  getEnv,
  getRustStyleAppServiceTokenEnvKey,
  shouldRunIntegrationTests,
} from '../../helpers/test_env'

jest.setTimeout(30000)

const appId = getEnv('BUCKYOS_TEST_APP_ID')
const ownerUserId = getEnv('BUCKYOS_TEST_OWNER_USER_ID')
const appServiceToken = getEnv('BUCKYOS_TEST_APP_SERVICE_TOKEN')
const appInstanceConfig = getEnv('BUCKYOS_TEST_APP_INSTANCE_CONFIG')
const hostGateway = getEnv('BUCKYOS_TEST_HOST_GATEWAY', getEnv('BUCKYOS_HOST_GATEWAY', 'host.docker.internal'))
const canRunAppServiceIntegration = shouldRunIntegrationTests()
  && Boolean(appId && ownerUserId && appServiceToken)

const describeAppService = canRunAppServiceIntegration ? describe : describe.skip

describeAppService('AppService runtime integration', () => {
  beforeAll(() => {
    process.env.app_instance_config = appInstanceConfig ?? JSON.stringify({
      app_spec: {
        user_id: ownerUserId,
        app_doc: {
          name: appId,
        },
      },
    })

    process.env.BUCKYOS_HOST_GATEWAY = hostGateway as string
    process.env[getRustStyleAppServiceTokenEnvKey(appId as string, ownerUserId as string)] = appServiceToken as string
  })

  afterEach(() => {
    if (buckyos.getBuckyOSConfig()) {
      buckyos.logout(false)
    }
  })

  it('reads app settings through the local gateway route', async () => {
    await buckyos.initBuckyOS(appId as string, {
      appId: appId as string,
      ownerUserId: ownerUserId as string,
      runtimeType: RuntimeType.AppService,
      zoneHost: '',
      defaultProtocol: 'https://',
      autoRenew: false,
    })

    await buckyos.login()
    const settings = await buckyos.getAppSetting()

    expect(settings === undefined || settings === null || typeof settings === 'object').toBe(true)
  })
})
