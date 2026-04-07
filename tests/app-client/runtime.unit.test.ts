/** @jest-environment node */

import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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
} = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'buckyos-websdk-appclient-'))
  const { privateKey } = generateKeyPairSync('ed25519')

  await writeFile(
    join(root, 'user_private_key.pem'),
    privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    'utf8',
  )

  if (options.zoneDid || options.zoneName) {
    await writeFile(
      join(root, 'node_identity.json'),
      JSON.stringify({
        zone_did: options.zoneDid,
        zone_name: options.zoneName,
      }),
      'utf8',
    )
  }

  if (options.userConfigZoneDid) {
    await writeFile(
      join(root, 'user_config.json'),
      JSON.stringify({
        default_zone_did: options.userConfigZoneDid,
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
      userConfigZoneDid: 'did:web:test.buckyos.io',
    })
    rootsToCleanup.push(root)

    const runtime = new BuckyOSRuntime({
      appId: 'buckycli',
      runtimeType: RuntimeType.AppClient,
      zoneHost: '',
      defaultProtocol: 'https://',
      privateKeySearchPaths: [root],
      autoRenew: false,
    })

    await runtime.initialize()
    const claims = parseSessionTokenClaims(runtime.getSessionToken())

    expect(runtime.getZoneHostName()).toBe('test.buckyos.io')
    expect(claims).toEqual(expect.objectContaining({
      appid: 'buckycli',
      iss: 'root',
      sub: 'root',
    }))
  })

  it('AppClient explicit zone host takes precedence over local config fallback', async () => {
    const root = await createAppClientRoot({
      zoneName: 'ignored.test.buckyos.io',
    })
    rootsToCleanup.push(root)

    const runtime = new BuckyOSRuntime({
      appId: 'buckycli',
      runtimeType: RuntimeType.AppClient,
      zoneHost: 'explicit.test.buckyos.io',
      defaultProtocol: 'https://',
      privateKeySearchPaths: [root],
      autoRenew: false,
    })

    await runtime.initialize()

    expect(runtime.getZoneHostName()).toBe('explicit.test.buckyos.io')
  })

  it('AppClient service URL helpers use the app host prefix and zone host', () => {
    const runtime = new BuckyOSRuntime({
      appId: 'demo-app',
      ownerUserId: 'devtest',
      runtimeType: RuntimeType.AppClient,
      zoneHost: 'test.buckyos.io',
      defaultProtocol: 'https://',
      autoRenew: false,
    })

    expect(runtime.getZoneServiceURL('verify-hub')).toBe(
      'https://demo-app-devtest.test.buckyos.io/kapi/verify-hub',
    )
    expect(runtime.getZoneServiceURL('task-manager')).toBe(
      'https://demo-app-devtest.test.buckyos.io/kapi/task-manager',
    )
    expect(runtime.getSystemConfigServiceURL()).toBe(
      'https://test.buckyos.io/kapi/system_config',
    )
  })
})
