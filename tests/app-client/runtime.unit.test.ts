/** @jest-environment node */

import { generateKeyPairSync } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BuckyOSRuntime, parseSessionTokenClaims, RuntimeType } from '../../src/runtime'

function makeJwt(payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>) => Buffer.from(JSON.stringify(value))
    .toString('base64url')
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.signature`
}

async function createAppClientRoot(options: {
  zoneDid?: string
  zoneName?: string
  userConfigZoneDid?: string
  userId?: string
  deviceName?: string
  withUserKey?: boolean
  withDeviceKey?: boolean
} = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'buckyos-websdk-appclient-'))
  const {
    zoneDid,
    zoneName,
    userConfigZoneDid,
    userId,
    deviceName,
    withUserKey = false,
    withDeviceKey = false,
  } = options

  if (withUserKey) {
    const { privateKey } = generateKeyPairSync('ed25519')
    await writeFile(
      join(root, 'user_private_key.pem'),
      privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
      'utf8',
    )
  }

  if (withDeviceKey) {
    const { privateKey } = generateKeyPairSync('ed25519')
    await mkdir(join(root, 'etc'), { recursive: true })
    await writeFile(
      join(root, 'etc', 'node_private_key.pem'),
      privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
      'utf8',
    )
  }

  if (zoneDid || zoneName || deviceName) {
    await mkdir(join(root, 'etc'), { recursive: true })
    await writeFile(
      join(root, 'etc', 'node_identity.json'),
      JSON.stringify({
        zone_did: zoneDid,
        zone_name: zoneName,
        device_mini_doc_jwt: deviceName
          ? makeJwt({ n: deviceName, sub: deviceName })
          : undefined,
      }),
      'utf8',
    )
  }

  if (userConfigZoneDid || userId) {
    await writeFile(
      join(root, 'user_config.json'),
      JSON.stringify({
        '@context': 'https://www.w3.org/ns/did/v1',
        id: `did:bns:${userId ?? 'unknown-user'}`,
        verificationMethod: [],
        authentication: [],
        exp: 2200000000,
        iat: 1700000000,
        name: userId ?? 'unknown-user',
        full_name: `${userId ?? 'unknown-user'}@example`,
        default_zone_did: userConfigZoneDid,
      }),
      'utf8',
    )
  }

  return root
}

describe('runtime unit behavior', () => {
  const originalEnv = { ...process.env }
  const rootsToCleanup: string[] = []

  afterEach(async () => {
    process.env = { ...originalEnv }
    await Promise.all(rootsToCleanup.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('parseSessionTokenClaims decodes valid claims and ignores malformed tokens', () => {
    const token = makeJwt({ appid: 'buckycli', sub: 'root', exp: 123 })

    expect(parseSessionTokenClaims(token)).toEqual(expect.objectContaining({
      appid: 'buckycli',
      sub: 'root',
      exp: 123,
    }))
    expect(parseSessionTokenClaims('not-a-jwt')).toBeNull()
    expect(parseSessionTokenClaims(null)).toBeNull()
  })

  it('AppClient initialize loads local signing material and resolves zone host from search roots', async () => {
    const root = await createAppClientRoot({
      userId: 'alice',
      userConfigZoneDid: 'did:web:test.buckyos.io',
      withUserKey: true,
    })
    rootsToCleanup.push(root)

    const runtime = new BuckyOSRuntime({
      appId: 'buckycli',
      userid: 'alice',
      runtimeType: RuntimeType.AppClient,
      zoneHost: '',
      defaultProtocol: 'https://',
      privateKeySearchPaths: [root],
      autoRenew: false,
    })

    await runtime.initialize()
    const claims = parseSessionTokenClaims(runtime.getSessionToken())

    expect(runtime.getZoneHostName()).toBe('test.buckyos.io')
    expect(runtime.getConfig().ownerUserId).toBe('alice')
    expect(claims).toEqual(expect.objectContaining({
      appid: 'buckycli',
      iss: 'alice',
      sub: 'alice',
    }))
  })

  it('AppClient without ownerUserId falls back to BUCKYOS_ROOT/etc node key and device name', async () => {
    const root = await createAppClientRoot({
      zoneName: 'test.buckyos.io',
      deviceName: 'ood1',
      withDeviceKey: true,
    })
    rootsToCleanup.push(root)

    const runtime = new BuckyOSRuntime({
      appId: 'buckycli',
      runtimeType: RuntimeType.AppClient,
      rootDir: root,
      zoneHost: '',
      defaultProtocol: 'https://',
      autoRenew: false,
    })

    await runtime.initialize()
    const claims = parseSessionTokenClaims(runtime.getSessionToken())

    expect(runtime.getConfig().ownerUserId).toBe('ood1')
    expect(claims).toEqual(expect.objectContaining({
      iss: 'ood1',
      sub: 'ood1',
      userid: 'ood1',
    }))
  })

  it('AppClient explicit zone host takes precedence over local config fallback', async () => {
    const root = await createAppClientRoot({
      zoneName: 'ignored.test.buckyos.io',
      userId: 'alice',
      withUserKey: true,
    })
    rootsToCleanup.push(root)

    const runtime = new BuckyOSRuntime({
      appId: 'buckycli',
      ownerUserId: 'alice',
      runtimeType: RuntimeType.AppClient,
      zoneHost: 'explicit.test.buckyos.io',
      defaultProtocol: 'https://',
      privateKeySearchPaths: [root],
      autoRenew: false,
    })

    await runtime.initialize()

    expect(runtime.getZoneHostName()).toBe('explicit.test.buckyos.io')
  })

  it('AppClient ownerUserId prefers device key when it matches the device name', async () => {
    const root = await createAppClientRoot({
      userId: 'ood1',
      deviceName: 'ood1',
      withUserKey: true,
      withDeviceKey: true,
    })
    rootsToCleanup.push(root)

    const runtime = new BuckyOSRuntime({
      appId: 'buckycli',
      ownerUserId: 'ood1',
      runtimeType: RuntimeType.AppClient,
      zoneHost: 'test.buckyos.io',
      defaultProtocol: 'https://',
      rootDir: root,
      privateKeySearchPaths: [root],
      autoRenew: false,
    })

    await runtime.initialize()
    const claims = parseSessionTokenClaims(runtime.getSessionToken())

    expect(claims).toEqual(expect.objectContaining({
      iss: 'ood1',
      sub: 'ood1',
    }))
  })

  it('AppClient initialize keeps ownerUserId on the user key path instead of resolving to device name', async () => {
    const root = await createAppClientRoot({
      userId: 'devtest',
      userConfigZoneDid: 'did:web:test.buckyos.io',
      deviceName: 'ood1',
      withUserKey: true,
      withDeviceKey: true,
    })
    rootsToCleanup.push(root)

    const runtime = new BuckyOSRuntime({
      appId: 'buckycli',
      ownerUserId: 'devtest',
      runtimeType: RuntimeType.AppClient,
      zoneHost: '',
      defaultProtocol: 'https://',
      rootDir: root,
      privateKeySearchPaths: [root],
      autoRenew: false,
    })

    await runtime.initialize()
    const claims = parseSessionTokenClaims(runtime.getSessionToken())

    expect(runtime.getConfig().ownerUserId).toBe('devtest')
    expect(runtime.getZoneHostName()).toBe('test.buckyos.io')
    expect(claims).toEqual(expect.objectContaining({
      iss: 'devtest',
      sub: 'devtest',
      userid: 'devtest',
    }))
    expect(claims).not.toEqual(expect.objectContaining({
      iss: 'ood1',
    }))
  })

  it('AppClient ownerUserId rejects mismatched user_private_key directories', async () => {
    const root = await createAppClientRoot({
      userId: 'alice',
      withUserKey: true,
    })
    rootsToCleanup.push(root)

    const runtime = new BuckyOSRuntime({
      appId: 'buckycli',
      ownerUserId: 'bob',
      runtimeType: RuntimeType.AppClient,
      zoneHost: 'test.buckyos.io',
      defaultProtocol: 'https://',
      privateKeySearchPaths: [root],
      autoRenew: false,
    })

    await expect(runtime.initialize()).rejects.toThrow('failed to find AppClient private key for userid=bob')
  })

  it('AppClient service URL helpers use the zone host directly', () => {
    const runtime = new BuckyOSRuntime({
      appId: 'demo-app',
      ownerUserId: 'devtest',
      runtimeType: RuntimeType.AppClient,
      zoneHost: 'test.buckyos.io',
      defaultProtocol: 'https://',
      autoRenew: false,
    })

    expect(runtime.getZoneServiceURL('verify-hub')).toBe(
      'https://test.buckyos.io/kapi/verify-hub',
    )
    expect(runtime.getZoneServiceURL('task-manager')).toBe(
      'https://test.buckyos.io/kapi/task-manager',
    )
    expect(runtime.getSystemConfigServiceURL()).toBe(
      'https://test.buckyos.io/kapi/system_config',
    )
  })
})
