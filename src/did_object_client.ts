// A minimal DID Object HTTP client (buckyos-base `DIDObjectHttpServer`):
// `GET <endpoint>` is the Card, `?type=profile` the Profile, `props/<name>` a
// property, `POST methods/<name>` with `{ method, params }` an action. The
// endpoint of `obj://<host>/<p>` is `<origin>/kapi/<host>/obj/<p>`. Requests run
// under the page's own session: the SSO cookie (same origin) or a bearer token.

import { ObjectUrlError, objectEndpoint, parseObjectUrl } from './object_url'

export class DIDObjectError extends Error {
  readonly code: string
  readonly status: number
  readonly details?: unknown

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message)
    this.name = 'DIDObjectError'
    this.code = code
    this.status = status
    this.details = details
  }
}

export interface DIDObjectCard {
  id: string
  alsoKnownAs?: string[]
  controller?: string
  service?: unknown[]
  [key: string]: unknown
}

export interface DIDObjectClientOptions {
  /** Gateway origin, e.g. `location.origin`. */
  origin: string
  currentZone?: string | null
  fetch?: typeof fetch
  /** A bearer token; without it same-origin requests carry the SSO cookie. */
  sessionToken?: () => string | null | undefined | Promise<string | null | undefined>
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

export class DIDObjectClient {
  constructor(private readonly options: DIDObjectClientOptions) {}

  /** HTTP endpoint of an object URL (`obj://…`, or http(s) as it is). */
  endpoint(objectUrl: string): string {
    let url
    try {
      url = parseObjectUrl(objectUrl)
    } catch (e) {
      throw new DIDObjectError('bad_request', e instanceof ObjectUrlError ? e.message : String(e), 400)
    }
    const endpoint = objectEndpoint(url, this.options.origin, this.options.currentZone)
    if (!endpoint) throw new DIDObjectError('bad_request', `'${objectUrl}' has no DID Object endpoint`, 400)
    return endpoint
  }

  card(objectUrl: string): Promise<DIDObjectCard> {
    return this.request('GET', this.endpoint(objectUrl)) as Promise<DIDObjectCard>
  }

  profile(objectUrl: string): Promise<Json> {
    const e = this.endpoint(objectUrl)
    return this.request('GET', `${e}${e.includes('?') ? '&' : '?'}type=profile`)
  }

  readProperty(objectUrl: string, name: string): Promise<Json> {
    return this.request('GET', `${this.split(objectUrl)}/props/${encodeURIComponent(name)}`)
  }

  async invoke(objectUrl: string, method: string, params: Json): Promise<Json> {
    const body = await this.request('POST', `${this.split(objectUrl)}/methods/${encodeURIComponent(method)}`, { method, params })
    if (body && typeof body === 'object' && !Array.isArray(body) && 'error' in body && body.error) {
      const err = body.error as { code?: string; message?: string; details?: unknown }
      throw new DIDObjectError(err.code ?? 'error', err.message ?? 'action failed', 200, err.details)
    }
    return body && typeof body === 'object' && !Array.isArray(body) ? (body.result ?? null) : body
  }

  /** The endpoint without its query (property and method paths go before it). */
  private split(objectUrl: string): string {
    const e = this.endpoint(objectUrl)
    const q = e.indexOf('?')
    return q < 0 ? e : e.slice(0, q)
  }

  private async request(method: 'GET' | 'POST', url: string, body?: unknown): Promise<Json> {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (body !== undefined) headers['content-type'] = 'application/json'
    const token = await this.options.sessionToken?.()
    if (token) headers.authorization = `Bearer ${token}`
    const f = this.options.fetch ?? globalThis.fetch.bind(globalThis)
    const response = await f(url, {
      method, headers, credentials: 'same-origin', ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    const text = await response.text()
    let parsed: Json = null
    if (text) {
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new DIDObjectError('invalid_response', `${method} ${url}: not JSON (HTTP ${response.status})`, response.status)
      }
    }
    if (!response.ok) {
      const err = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? ('error' in parsed && parsed.error && typeof parsed.error === 'object' ? parsed.error : parsed) : {}) as { code?: string; message?: string; details?: unknown }
      throw new DIDObjectError(err.code ?? `http_${response.status}`, err.message ?? `${method} ${url}: HTTP ${response.status}`, response.status, err.details)
    }
    return parsed
  }
}
