/** @jest-environment node */

import { BuckyOSRuntime, RuntimeType } from '../../src/runtime'

function makeJwt(payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>) => Buffer.from(JSON.stringify(value))
    .toString('base64url')
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.signature`
}

const APP_DID = 'did:web:notes.example.com'
const APP_ID = 'notes.example.com'
const OWNER_USER_ID = 'owner-user'
const APP_INSTANCE_ID = `${APP_ID}@${OWNER_USER_ID}`
const DATA_DIR = '/tmp/buckyos-websdk-notes-data'

function setAppServiceEnv(overrides: Record<string, string> = {}) {
  Object.assign(process.env, {
    BUCKYOS_APP_DID: APP_DID,
    BUCKYOS_APP_ID: APP_ID,
    BUCKYOS_APP_INSTANCE_ID: APP_INSTANCE_ID,
    BUCKYOS_OWNER_USER_ID: OWNER_USER_ID,
    BUCKYOS_DATA_DIR: DATA_DIR,
    BUCKYOS_APP_TOKEN: makeJwt({
      appid: APP_ID,
      sub: OWNER_USER_ID,
      app_instance_id: APP_INSTANCE_ID,
      app_owner_user_id: OWNER_USER_ID,
    }),
    ...overrides,
  })
}

function createRuntime(config: Partial<ConstructorParameters<typeof BuckyOSRuntime>[0]> = {}) {
  return new BuckyOSRuntime({
    appId: '',
    runtimeType: RuntimeType.AppService,
    zoneHost: '',
    defaultProtocol: 'https://',
    autoRenew: false,
    ...config,
  })
}

describe('AppService runtime behavior', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('resolves identity and token from the fixed app_loader environment contract', async () => {
    setAppServiceEnv()
    const runtime = createRuntime()

    await runtime.initialize()

    expect(runtime.getAppDid()).toBe(APP_DID)
    expect(runtime.getAppId()).toBe(APP_ID)
    expect(runtime.getAppInstanceId()).toBe(APP_INSTANCE_ID)
    expect(runtime.getOwnerUserId()).toBe(OWNER_USER_ID)
    expect(runtime.getDataDir()).toBe(DATA_DIR)
    expect(runtime.getSessionToken()).toBe(process.env.BUCKYOS_APP_TOKEN)
  })

  it('uses host.docker.internal by default, matching Rust app_loader env', async () => {
    setAppServiceEnv()
    const runtime = createRuntime({ zoneHost: 'test.buckyos.io' })

    await runtime.initialize()

    expect(runtime.getSystemConfigServiceURL()).toBe(
      'http://host.docker.internal:3180/kapi/system_config',
    )
    expect(runtime.getZoneServiceURL('task-manager')).toBe(
      'http://host.docker.internal:3180/kapi/task-manager',
    )
  })

  it('rejects an incomplete app identity environment', async () => {
    setAppServiceEnv()
    delete process.env.BUCKYOS_APP_DID

    await expect(createRuntime().initialize()).rejects.toThrow(
      'BUCKYOS_APP_DID is required for AppService runtime',
    )
  })

  it('rejects inconsistent app instance identity', async () => {
    setAppServiceEnv({
      BUCKYOS_APP_INSTANCE_ID: `${APP_ID}@another-owner`,
    })

    await expect(createRuntime().initialize()).rejects.toThrow(
      'AppService identity environment variables are inconsistent',
    )
  })

  it('rejects a token issued for another app instance', async () => {
    setAppServiceEnv({
      BUCKYOS_APP_TOKEN: makeJwt({
        appid: APP_ID,
        sub: OWNER_USER_ID,
        app_instance_id: `${APP_ID}@another-owner`,
        app_owner_user_id: OWNER_USER_ID,
      }),
    })

    await expect(createRuntime().initialize()).rejects.toThrow(
      `session token app_instance_id mismatch: ${APP_ID}@another-owner != ${APP_INSTANCE_ID}`,
    )
  })

  it('rejects an opaque token because its instance claims cannot be validated', async () => {
    setAppServiceEnv({ BUCKYOS_APP_TOKEN: 'opaque-token' })

    await expect(createRuntime().initialize()).rejects.toThrow(
      'AppService session token must be a JWT with identity claims',
    )
  })

  it('uses BUCKYOS_HOST_GATEWAY when present', async () => {
    setAppServiceEnv({ BUCKYOS_HOST_GATEWAY: '127.0.0.1' })
    const runtime = createRuntime({ zoneHost: 'test.buckyos.io' })

    await runtime.initialize()

    expect(runtime.getSystemConfigServiceURL()).toBe('http://127.0.0.1:3180/kapi/system_config')
    expect(runtime.getZoneServiceURL('verify-hub')).toBe('http://127.0.0.1:3180/kapi/verify-hub')
  })
})
