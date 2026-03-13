/** @jest-environment node */

jest.setTimeout(30000)

function getEnv(name: string): string | null {
  const value = process.env[name]
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

describe('AppClient runtime integration', () => {
  it('uses local private key to access a real system_config service', async () => {
    const appId = getEnv('BUCKYOS_TEST_APP_ID') ?? 'buckycli'
    const systemConfigServiceUrl = getEnv('BUCKYOS_SYSTEM_CONFIG_URL') ?? 'http://127.0.0.1:3200/kapi/system_config'

    const probeResponse = await fetch(systemConfigServiceUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        method: 'sys_config_get',
        params: { key: 'boot/config' },
        sys: [1],
      }),
    })

    if (!probeResponse.ok) {
      throw new Error(`system_config probe failed: ${probeResponse.status} ${probeResponse.statusText}`)
    }

    const { buckyos, RuntimeType } = await import('../src/index')
    const { parseSessionTokenClaims } = await import('../src/runtime')

    await buckyos.initBuckyOS(appId, {
      appId,
      runtimeType: RuntimeType.AppClient,
      zoneHost: '',
      defaultProtocol: 'https://',
      systemConfigServiceUrl,
      privateKeySearchPaths: [
        '/opt/buckyos/etc',
        '/opt/buckyos',
        `${process.env.HOME ?? ''}/.buckycli`,
        `${process.env.HOME ?? ''}/.buckyos`,
      ],
    })

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

    buckyos.logout(false)
  })
})
