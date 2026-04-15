/** @jest-environment node */

import { generateKeyPairSync } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createSDKModule } from '../../src/sdk_core'
import { parseSessionTokenClaims, RuntimeType } from '../../src/runtime'

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
  const root = await mkdtemp(join(tmpdir(), 'buckyos-websdk-appclient-account-'))
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

describe('AppClient getAccountInfo unit behavior', () => {
  const originalEnv = { ...process.env }
  const rootsToCleanup: string[] = []

  afterEach(async () => {
    process.env = { ...originalEnv }
    await Promise.all(rootsToCleanup.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('getAccountInfo after init uses the user bootstrap token claims instead of the device name', async () => {
    const root = await createAppClientRoot({
      userId: 'devtest',
      userConfigZoneDid: 'did:web:test.buckyos.io',
      deviceName: 'ood1',
      withUserKey: true,
      withDeviceKey: true,
    })
    rootsToCleanup.push(root)

    const sdk = createSDKModule('node')
    await sdk.initBuckyOS('buckycli', {
      appId: 'buckycli',
      ownerUserId: 'devtest',
      runtimeType: RuntimeType.AppClient,
      zoneHost: '',
      defaultProtocol: 'https://',
      rootDir: root,
      privateKeySearchPaths: [root],
      autoRenew: false,
    })

    const accountInfo = await sdk.getAccountInfo()
    const claims = parseSessionTokenClaims(accountInfo?.session_token ?? null)

    expect(accountInfo).toEqual(expect.objectContaining({
      user_name: 'devtest',
      user_id: 'devtest',
      user_type: 'root',
    }))
    expect(claims).toEqual(expect.objectContaining({
      iss: 'devtest',
      sub: 'devtest',
      userid: 'devtest',
    }))
    expect(claims).not.toEqual(expect.objectContaining({
      iss: 'ood1',
    }))
  })

  it('getAccountInfo after init falls back to the device bootstrap token when ownerUserId is missing', async () => {
    const root = await createAppClientRoot({
      zoneName: 'test.buckyos.io',
      deviceName: 'ood1',
      withDeviceKey: true,
    })
    rootsToCleanup.push(root)

    const sdk = createSDKModule('node')
    await sdk.initBuckyOS('buckycli', {
      appId: 'buckycli',
      runtimeType: RuntimeType.AppClient,
      zoneHost: '',
      defaultProtocol: 'https://',
      rootDir: root,
      autoRenew: false,
    })

    const accountInfo = await sdk.getAccountInfo()
    const claims = parseSessionTokenClaims(accountInfo?.session_token ?? null)

    expect(accountInfo).toEqual(expect.objectContaining({
      user_name: 'ood1',
      user_id: 'ood1',
      user_type: 'root',
    }))
    expect(claims).toEqual(expect.objectContaining({
      iss: 'ood1',
      sub: 'ood1',
      userid: 'ood1',
    }))
  })
})
