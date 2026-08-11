/** @jest-environment node */

import { BuckyOSRuntime, RuntimeType } from '../../src/runtime'

function makeJwt(payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>) => Buffer.from(JSON.stringify(value))
    .toString('base64url')
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.signature`
}

describe('AppService runtime behavior', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('resolves app identity from app_instance_config and loads owner-specific token env', async () => {
    process.env.app_instance_config = JSON.stringify({
      app_spec: {
        user_id: 'owner-user',
        app_doc: {
          name: 'notes-app',
        },
      },
    })
    process.env.OWNER_USER_NOTES_APP_TOKEN = makeJwt({
      appid: 'notes-app',
      sub: 'service-owner',
    })

    const runtime = new BuckyOSRuntime({
      appId: '',
      runtimeType: RuntimeType.AppService,
      zoneHost: '',
      defaultProtocol: 'https://',
      autoRenew: false,
    })

    await runtime.initialize()

    expect(runtime.getAppId()).toBe('notes-app')
    expect(runtime.getOwnerUserId()).toBe('owner-user')
    expect(runtime.getSessionToken()).toBe(process.env.OWNER_USER_NOTES_APP_TOKEN)
  })

  it('uses host.docker.internal by default, matching Rust app_loader env', async () => {
    process.env.OWNER_USER_NOTES_APP_TOKEN = makeJwt({
      appid: 'notes-app',
      sub: 'service-owner',
    })

    const runtime = new BuckyOSRuntime({
      appId: 'notes-app',
      ownerUserId: 'owner-user',
      runtimeType: RuntimeType.AppService,
      zoneHost: 'test.buckyos.io',
      defaultProtocol: 'https://',
      autoRenew: false,
    })

    await runtime.initialize()

    expect(runtime.getSessionToken()).toBe(process.env.OWNER_USER_NOTES_APP_TOKEN)
    expect(runtime.getSystemConfigServiceURL()).toBe(
      'http://host.docker.internal:3180/kapi/system_config',
    )
    expect(runtime.getZoneServiceURL('task-manager')).toBe(
      'http://host.docker.internal:3180/kapi/task-manager',
    )
  })

  it('keeps app-only token env as a compatibility fallback', async () => {
    process.env.NOTES_APP_TOKEN = makeJwt({
      appid: 'notes-app',
      sub: 'service-owner',
    })

    const runtime = new BuckyOSRuntime({
      appId: 'notes-app',
      ownerUserId: 'owner-user',
      runtimeType: RuntimeType.AppService,
      zoneHost: 'test.buckyos.io',
      defaultProtocol: 'https://',
      autoRenew: false,
    })

    await runtime.initialize()

    expect(runtime.getSessionToken()).toBe(process.env.NOTES_APP_TOKEN)
  })

  it('uses BUCKYOS_HOST_GATEWAY when present', () => {
    process.env.BUCKYOS_HOST_GATEWAY = '127.0.0.1'

    const runtime = new BuckyOSRuntime({
      appId: 'notes-app',
      ownerUserId: 'owner-user',
      runtimeType: RuntimeType.AppService,
      zoneHost: 'test.buckyos.io',
      defaultProtocol: 'https://',
      sessionToken: makeJwt({
        appid: 'notes-app',
        sub: 'service-owner',
      }),
      autoRenew: false,
    })

    expect(runtime.getSystemConfigServiceURL()).toBe('http://127.0.0.1:3180/kapi/system_config')
    expect(runtime.getZoneServiceURL('verify-hub')).toBe('http://127.0.0.1:3180/kapi/verify-hub')
  })
})
