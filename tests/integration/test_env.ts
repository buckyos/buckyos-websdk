export function getEnv(name: string, fallback: string | null = null): string | null {
  const value = process.env[name]
  if (typeof value !== 'string') {
    return fallback
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : fallback
}

export function shouldRunIntegrationTests(): boolean {
  return getEnv('BUCKYOS_RUN_INTEGRATION_TESTS') === '1'
}

export function shouldRunOptionalIntegration(flag: string): boolean {
  return getEnv(flag) === '1'
}

export function configureInsecureTlsIfNeeded(zoneHost: string) {
  if (zoneHost === 'test.buckyos.io' || zoneHost.endsWith('.test.buckyos.io')) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  }
}

export async function installInsecureNodeFetchIfNeeded(zoneHost: string) {
  if (zoneHost !== 'test.buckyos.io' && !zoneHost.endsWith('.test.buckyos.io')) {
    return
  }

  const http = await import('node:http')
  const https = await import('node:https')

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : String(input))
    const requestImpl = url.protocol === 'https:' ? https.request : http.request
    const body = typeof init?.body === 'string'
      ? init.body
      : init?.body
        ? Buffer.from(init.body as ArrayBuffer).toString()
        : undefined

    return new Promise<Response>((resolve, reject) => {
      const request = requestImpl({
        method: init?.method ?? 'GET',
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        headers: init?.headers as Record<string, string> | undefined,
        rejectUnauthorized: false,
      }, (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        })
        response.on('end', () => {
          const textBody = Buffer.concat(chunks).toString('utf8')
          const status = response.statusCode ?? 0
          const result = {
            ok: status >= 200 && status < 300,
            status,
            statusText: response.statusMessage ?? '',
            json: async () => JSON.parse(textBody) as unknown,
            text: async () => textBody,
          }
          resolve(result as Response)
        })
      })

      request.on('error', reject)
      if (body) {
        request.write(body)
      }
      request.end()
    })
  }) as typeof fetch
}

export function getAppHostPrefix(appId: string, ownerUserId?: string | null): string {
  if (!ownerUserId) {
    return appId
  }
  return `${appId}-${ownerUserId}`
}

export function getRustStyleFullAppId(appId: string, ownerUserId: string): string {
  return `${ownerUserId}-${appId}`
}

export function getRustStyleAppServiceTokenEnvKey(appId: string, ownerUserId: string): string {
  return `${getRustStyleFullAppId(appId, ownerUserId).toUpperCase().replace(/-/g, '_')}_TOKEN`
}

export function getServiceUrl(
  appId: string,
  zoneHost: string,
  serviceName: string,
  ownerUserId?: string | null,
): string {
  const servicePath = serviceName === 'system-config' ? 'system_config' : serviceName
  return `https://${getAppHostPrefix(appId, ownerUserId)}.${zoneHost}/kapi/${servicePath}/`
}
