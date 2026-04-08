import http from 'node:http'
import { buckyos, RuntimeType, parseSessionTokenClaims } from '../src/node'

type AppInstanceIdentity = {
  appId: string
  ownerUserId: string
}

type JsonObject = Record<string, unknown>

function getEnv(name: string): string | null {
  const value = process.env[name]
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function getPort(): number {
  const rawPort = getEnv('PORT') ?? getEnv('APP_SERVICE_PORT') ?? '10176'
  const port = Number.parseInt(rawPort, 10)
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`invalid port: ${rawPort}`)
  }
  return port
}

function parseAppInstanceIdentity(appInstanceConfig: string): AppInstanceIdentity {
  const parsed = JSON.parse(appInstanceConfig) as {
    app_spec?: {
      user_id?: unknown
      app_doc?: {
        name?: unknown
      }
    }
  }

  const appId = typeof parsed.app_spec?.app_doc?.name === 'string' ? parsed.app_spec.app_doc.name.trim() : ''
  const ownerUserId = typeof parsed.app_spec?.user_id === 'string' ? parsed.app_spec.user_id.trim() : ''
  if (!appId || !ownerUserId) {
    throw new Error('app_instance_config is missing app_spec.user_id or app_spec.app_doc.name')
  }

  return { appId, ownerUserId }
}

function getRustStyleAppServiceTokenEnvKey(identity: AppInstanceIdentity): string {
  return `${identity.ownerUserId}-${identity.appId}`.toUpperCase().replace(/-/g, '_') + '_TOKEN'
}

function getCompatTokenEnvKey(appId: string): string {
  return `${appId.toUpperCase().replace(/-/g, '_')}_TOKEN`
}

function ensureDebugEnvironment(): AppInstanceIdentity {
  const appInstanceConfig = getEnv('app_instance_config')
  if (!appInstanceConfig) {
    throw new Error('missing app_instance_config; start this demo through service_debug.tsx')
  }

  const identity = parseAppInstanceIdentity(appInstanceConfig)
  const expectedTokenKey = getRustStyleAppServiceTokenEnvKey(identity)
  const hasOwnerScopedToken = Boolean(getEnv(expectedTokenKey))
  const compatTokenKey = getCompatTokenEnvKey(identity.appId)
  const hasCompatToken = Boolean(getEnv(compatTokenKey))

  if (!hasOwnerScopedToken && !hasCompatToken) {
    throw new Error(
      `missing app service token env; service_debug.tsx should inject ${expectedTokenKey} (preferred) or ${compatTokenKey}`,
    )
  }

  return identity
}

function serializeSettingValue(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  return JSON.stringify(value)
}

async function readJsonBody(request: http.IncomingMessage): Promise<JsonObject> {
  const chunks: Buffer[] = []
  let totalSize = 0
  for await (const chunk of request) {
    const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    chunks.push(bufferChunk)
    totalSize += bufferChunk.length
    if (totalSize > 1024 * 1024) {
      throw new Error('request body too large')
    }
  }

  if (chunks.length === 0) {
    return {}
  }

  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (!text) {
    return {}
  }

  const parsed = JSON.parse(text) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('request body must be a JSON object')
  }
  return parsed as JsonObject
}

function sendJson(response: http.ServerResponse, statusCode: number, payload: unknown) {
  const body = JSON.stringify(payload, null, 2)
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

function buildRuntimeSummary(identity: AppInstanceIdentity) {
  const accountInfo = buckyos.getAccountInfo()
  const tokenClaims = parseSessionTokenClaims(accountInfo?.session_token ?? null)

  return {
    mode: 'app-service-local-debug',
    appId: identity.appId,
    ownerUserId: identity.ownerUserId,
    runtimeType: RuntimeType.AppService,
    zoneHost: buckyos.getZoneHostName(),
    serviceUrls: {
      verifyHub: buckyos.getZoneServiceURL('verify-hub'),
      taskManager: buckyos.getZoneServiceURL('task-manager'),
      systemConfig: buckyos.getZoneServiceURL('system-config'),
    },
    accountInfo: accountInfo
      ? {
        userId: accountInfo.user_id,
        userType: accountInfo.user_type,
      }
      : null,
    tokenClaims,
    expectedTokenEnvKey: getRustStyleAppServiceTokenEnvKey(identity),
    hostGateway: getEnv('BUCKYOS_HOST_GATEWAY') ?? 'host.docker.internal',
    routes: {
      health: 'GET /healthz',
      runtime: 'GET /debug/runtime',
      settingsGet: 'GET /debug/settings?name=foo.bar',
      settingsSet: 'POST /debug/settings {"name":"foo.bar","value":{"hello":"world"}}',
      systemConfig: 'GET /debug/system-config?key=boot/config',
    },
  }
}

async function bootstrapSdk(identity: AppInstanceIdentity) {
  await buckyos.initBuckyOS('', {
    appId: '',
    ownerUserId: identity.ownerUserId,
    runtimeType: RuntimeType.AppService,
    zoneHost: getEnv('BUCKYOS_ZONE_HOST') ?? '',
    defaultProtocol: 'https://',
  })

  await buckyos.login()
}

function createServer(identity: AppInstanceIdentity): http.Server {
  return http.createServer(async (request, response) => {
    try {
      const method = request.method ?? 'GET'
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')

      if (method === 'GET' && url.pathname === '/healthz') {
        sendJson(response, 200, { ok: true })
        return
      }

      if (method === 'GET' && (url.pathname === '/' || url.pathname === '/debug/runtime')) {
        sendJson(response, 200, buildRuntimeSummary(identity))
        return
      }

      if (method === 'GET' && url.pathname === '/debug/settings') {
        const name = url.searchParams.get('name')
        const settings = await buckyos.getAppSetting(name)
        sendJson(response, 200, {
          ok: true,
          name,
          value: settings,
        })
        return
      }

      if (method === 'POST' && url.pathname === '/debug/settings') {
        const body = await readJsonBody(request)
        const name = typeof body.name === 'string' ? body.name : null
        const nextValue = Object.prototype.hasOwnProperty.call(body, 'value') ? body.value : null
        if (name == null && (!nextValue || typeof nextValue !== 'object' || Array.isArray(nextValue))) {
          throw new Error('POST /debug/settings requires an object value when name is null')
        }
        await buckyos.setAppSetting(name, serializeSettingValue(nextValue))
        const savedValue = await buckyos.getAppSetting(name)
        sendJson(response, 200, {
          ok: true,
          name,
          value: savedValue,
        })
        return
      }

      if (method === 'GET' && url.pathname === '/debug/system-config') {
        const key = url.searchParams.get('key') ?? 'boot/config'
        const result = await buckyos.getSystemConfigClient().get(key)
        sendJson(response, 200, {
          ok: true,
          key,
          version: result.version,
          isChanged: result.is_changed,
          value: tryParseJson(result.value),
        })
        return
      }

      sendJson(response, 404, {
        ok: false,
        error: `route not found: ${method} ${url.pathname}`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      sendJson(response, 500, {
        ok: false,
        error: message,
      })
    }
  })
}

async function main(): Promise<void> {
  const host = getEnv('HOST') ?? '0.0.0.0'
  const port = getPort()
  const identity = ensureDebugEnvironment()

  await bootstrapSdk(identity)

  const server = createServer(identity)
  server.listen(port, host, () => {
    console.log('AppService local debug demo is ready')
    console.log(JSON.stringify({
      host,
      port,
      appId: identity.appId,
      ownerUserId: identity.ownerUserId,
      expectedTokenEnvKey: getRustStyleAppServiceTokenEnvKey(identity),
      hostGateway: getEnv('BUCKYOS_HOST_GATEWAY') ?? 'host.docker.internal',
      exampleUrls: {
        root: `http://127.0.0.1:${port}/`,
        health: `http://127.0.0.1:${port}/healthz`,
        settings: `http://127.0.0.1:${port}/debug/settings`,
        systemConfig: `http://127.0.0.1:${port}/debug/system-config?key=boot/config`,
      },
    }, null, 2))
  })

  const shutdown = () => {
    buckyos.logout(false)
    server.close(() => {
      process.exit(0)
    })
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((error) => {
  console.error('AppService local debug demo failed')
  console.error(error)
  process.exitCode = 1
})
