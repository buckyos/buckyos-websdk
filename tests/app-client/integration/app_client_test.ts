/** @jest-environment node */

import {
  configureInsecureTlsIfNeeded,
  getEnv,
  getServiceUrl,
  installInsecureNodeFetchIfNeeded,
  shouldRunIntegrationTests,
  shouldRunOptionalIntegration,
} from '../../helpers/test_env'

jest.setTimeout(30000)

const describeIntegration = shouldRunIntegrationTests() ? describe : describe.skip
const describeOptionalOpenDan = shouldRunIntegrationTests() && shouldRunOptionalIntegration('BUCKYOS_RUN_OPENDAN_INTEGRATION_TESTS')
  ? describe
  : describe.skip

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describeIntegration('AppClient runtime integration', () => {
  const appId = getEnv('BUCKYOS_TEST_APP_ID', 'buckycli') as string
  const zoneHost = getEnv('BUCKYOS_TEST_ZONE_HOST', 'test.buckyos.io') as string
  const verifyHubServiceUrl = getEnv('BUCKYOS_TEST_VERIFY_HUB_URL', getServiceUrl(appId, zoneHost, 'verify-hub')) as string
  const systemConfigServiceUrl = getEnv('BUCKYOS_TEST_SYSTEM_CONFIG_URL', getServiceUrl(appId, zoneHost, 'system-config')) as string
  const privateKeySearchPaths = [
    getEnv('BUCKYOS_TEST_APP_CLIENT_DIR'),
    '/opt/buckyos/etc/.buckycli',
    '/opt/buckyos/etc',
    `${process.env.HOME ?? ''}/.buckycli`,
    `${process.env.HOME ?? ''}/.buckyos`,
  ].filter((item): item is string => Boolean(item))

  beforeAll(() => {
    configureInsecureTlsIfNeeded(zoneHost)
  })

  beforeAll(async () => {
    await installInsecureNodeFetchIfNeeded(zoneHost)
  })

  afterEach(async () => {
    const { buckyos } = await import('../../../src/index')
    if (buckyos.getBuckyOSConfig()) {
      buckyos.logout(false)
    }
  })

  it('logs in with local signing material and reads system_config', async () => {
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

    await sleep(1100)
    const accountInfo = await buckyos.login()
    const bootConfig = await buckyos.getSystemConfigClient().get('boot/config')
    const tokenClaims = parseSessionTokenClaims(accountInfo?.session_token ?? null)
    const parsedBootConfig = JSON.parse(bootConfig.value) as Record<string, unknown>

    expect(accountInfo).not.toBeNull()
    expect(accountInfo?.session_token).toBeTruthy()
    expect(tokenClaims).toEqual(expect.objectContaining({
      appid: appId,
    }))
    expect(accountInfo?.user_id).toBe(tokenClaims?.sub ?? tokenClaims?.userid)
    expect(parsedBootConfig).toEqual(expect.any(Object))
    expect(Object.keys(parsedBootConfig).length).toBeGreaterThan(0)
  })

  it('writes and reads back a namespaced system_config key', async () => {
    const { buckyos, RuntimeType } = await import('../../../src/index')

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

    await sleep(1100)
    await buckyos.login()
    const client = buckyos.getSystemConfigClient()
    const key = `test/websdk/${appId}/${Date.now()}`
    const value = JSON.stringify({ ok: true, key })

    await client.set(key, value)
    await expect(client.get(key)).resolves.toEqual(expect.objectContaining({ value }))
  })

  it('creates, updates, queries, and deletes a namespaced task', async () => {
    const { buckyos, RuntimeType } = await import('../../../src/index')

    await buckyos.initBuckyOS(appId, {
      appId,
      runtimeType: RuntimeType.AppClient,
      zoneHost,
      defaultProtocol: 'https://',
      verifyHubServiceUrl,
      privateKeySearchPaths,
      autoRenew: false,
    })

    await sleep(1100)
    const accountInfo = await buckyos.login()
    const client = buckyos.getTaskManagerClient()
    const name = `test-websdk-${Date.now()}`
    const created = await client.createTask({
      name,
      taskType: 'test',
      data: { createdBy: 'websdk' },
      userId: accountInfo?.user_id ?? 'root',
      appId,
    })

    try {
      await client.updateTaskProgress(created.id, 1, 2)
      await client.updateTaskData(created.id, { createdBy: 'websdk', updated: true })
      await client.updateTaskStatus(created.id, 'Completed' as never)

      const fetched = await client.getTask(created.id)
      const filtered = await client.listTasks({ filter: { root_id: String(created.id) } })

      expect(fetched.status).toBe('Completed')
      expect(fetched.progress).toBe(50)
      expect(filtered.map((task) => task.id)).toContain(created.id)
    } finally {
      await client.deleteTask(created.id)
    }
  })
})

describeOptionalOpenDan('OpenDan integration', () => {
  const appId = getEnv('BUCKYOS_TEST_APP_ID', 'buckycli') as string
  const zoneHost = getEnv('BUCKYOS_TEST_ZONE_HOST', 'test.buckyos.io') as string
  const verifyHubServiceUrl = getEnv('BUCKYOS_TEST_VERIFY_HUB_URL', getServiceUrl(appId, zoneHost, 'verify-hub')) as string
  const privateKeySearchPaths = [
    getEnv('BUCKYOS_TEST_APP_CLIENT_DIR'),
    '/opt/buckyos/etc/.buckycli',
    '/opt/buckyos/etc',
  ].filter((item): item is string => Boolean(item))

  beforeAll(() => {
    configureInsecureTlsIfNeeded(zoneHost)
  })

  beforeAll(async () => {
    await installInsecureNodeFetchIfNeeded(zoneHost)
  })

  it('lists agents when OpenDan is enabled in the shared environment', async () => {
    const { buckyos, RuntimeType } = await import('../../../src/index')

    await buckyos.initBuckyOS(appId, {
      appId,
      runtimeType: RuntimeType.AppClient,
      zoneHost,
      defaultProtocol: 'https://',
      verifyHubServiceUrl,
      privateKeySearchPaths,
      autoRenew: false,
    })

    await sleep(1100)
    await buckyos.login()
    const result = await buckyos.getOpenDanClient().listAgents({ limit: 1 })

    expect(Array.isArray(result.items)).toBe(true)
  })
})
