// System URL rules: syntax normalization, obj:// host checks, RBAC resource key,
// object-event kevent key, path DID. The spec is buckyos `doc/key url.md` part one;
// buckyos-api `object_url.rs` implements the same rules and both sides share
// `object_url_vectors.json`. Discovery that needs I/O (Card, service lookup,
// mount mapping) is not here.

import { ObjId } from './ndn_types'

/** Current-zone service names registered in key url.md §4.1. */
export const OBJ_SERVICE_NAMES = [
  'config',
  'dfs',
  'taskmgr',
  'kmsg',
  'bucket',
  'ndm',
  'msg-center',
  'aiworkspace',
  'homestation',
  'opendan',
  'aicc',
] as const

export const OBJECT_EVENT_PREFIX = '/obj'

export class ObjectUrlError extends Error {}

export type ObjHost = { kind: 'service' | 'entity'; name: string }

export type ObjectUrl =
  | { kind: 'file'; deviceId: string | null; path: string }
  | { kind: 'cyfs_path'; zone: string | null; path: string }
  | { kind: 'cyfs_object'; objId: ObjId; sourceZone: string | null; innerPath: string }
  | { kind: 'obj'; host: ObjHost; path: string; query: Record<string, string> }
  | { kind: 'web'; url: string }
  | { kind: 'buckyos'; url: string }

export function isObjServiceName(name: string): boolean {
  return (OBJ_SERVICE_NAMES as readonly string[]).includes(name)
}

/** Strict parse and normalize. Shorthands are expanded by `expandInputShorthand`. */
export function parseObjectUrl(input: string): ObjectUrl {
  input = input.trim()
  const sep = input.indexOf('://')
  if (sep < 0) throw new ObjectUrlError(`'${input}' has no scheme`)
  const scheme = input.slice(0, sep).toLowerCase()
  const rest = input.slice(sep + 3)
  switch (scheme) {
    case 'https':
    case 'http': {
      try {
        return { kind: 'web', url: new URL(input).toString() }
      } catch (e) {
        throw new ObjectUrlError(`invalid web url '${input}': ${e}`)
      }
    }
    case 'buckyos':
      return { kind: 'buckyos', url: input }
    case 'file': {
      const { authority, path, query } = splitAuthority(rest)
      if (query !== null) throw new ObjectUrlError('file url does not take query or fragment')
      const host = authority.toLowerCase()
      let deviceId: string | null
      if (host === '' || host === 'localhost') deviceId = null
      else if (isHostname(host)) deviceId = host
      else throw new ObjectUrlError(`invalid device id '${host}' in file url`)
      if (path === '') throw new ObjectUrlError('file url requires an absolute path')
      return { kind: 'file', deviceId, path: normalizePath(path, false) }
    }
    case 'cyfs': {
      const { authority: rawAuthority, path, query } = splitAuthority(rest)
      if (query !== null) throw new ObjectUrlError('cyfs url does not take query or fragment')
      const authority = rawAuthority.toLowerCase()
      if (authority === '' || authority === '_') {
        if (path === '') throw new ObjectUrlError('cyfs path url requires a path')
        return { kind: 'cyfs_path', zone: null, path: normalizePath(path, false) }
      }
      const dot = authority.indexOf('.')
      const firstLabel = dot < 0 ? authority : authority.slice(0, dot)
      const restLabels = dot < 0 ? null : authority.slice(dot + 1)
      const objId = strictObjIdLabel(firstLabel)
      if (objId) {
        if (restLabels !== null && !isHostname(restLabels)) {
          throw new ObjectUrlError(`invalid source zone '${restLabels}'`)
        }
        return {
          kind: 'cyfs_object',
          objId,
          sourceZone: restLabels,
          innerPath: path === '' || path === '/' ? '' : normalizePath(path, false),
        }
      }
      if (!isHostname(authority) || !authority.includes('.')) {
        throw new ObjectUrlError(`'${authority}' is neither a zone host nor an ObjId`)
      }
      if (path === '') throw new ObjectUrlError('cyfs path url requires a path')
      return { kind: 'cyfs_path', zone: authority, path: normalizePath(path, false) }
    }
    case 'obj': {
      const { authority, path, query } = splitAuthority(rest)
      const host = parseObjHost(authority.toLowerCase())
      return {
        kind: 'obj',
        host,
        path: path === '' || path === '/' ? '' : normalizePath(path, true),
        query: query === null ? {} : parseQuery(query),
      }
    }
    default:
      throw new ObjectUrlError(`unsupported scheme '${scheme}'`)
  }
}

/** Only for inputs that declare the shorthand syntax (CLI, prompt environment), key url.md §8. */
export function expandInputShorthand(input: string): string {
  input = input.trim()
  if (input.startsWith('//')) {
    const rest = input.slice(2)
    const service = rest.split(/[/?]/)[0] ?? ''
    return isObjServiceName(service) ? `obj://${rest}` : input
  }
  if (input.startsWith('/')) return `file://${input}`
  return input
}

export function parseObjHost(host: string): ObjHost {
  if (host === '') throw new ObjectUrlError('obj url requires a host')
  if (isObjServiceName(host)) return { kind: 'service', name: host }
  if (!host.includes('.')) {
    throw new ObjectUrlError(
      `'${host}' is not a registered obj:// service name; type shorthands are not supported`,
    )
  }
  if (!isHostname(host)) throw new ObjectUrlError(`'${host}' is not a valid entity hostname`)
  const firstLabel = host.split('.')[0]
  if (isObjServiceName(firstLabel)) {
    throw new ObjectUrlError(
      `'${host}' expands a service name; write obj://${firstLabel}/ for the current zone or use https across zones`,
    )
  }
  if (strictObjIdLabel(firstLabel)) {
    throw new ObjectUrlError('NamedObject ids do not go into obj:// host; use cyfs://<objid>/')
  }
  return { kind: 'entity', name: host }
}

export function formatObjectUrl(url: ObjectUrl): string {
  switch (url.kind) {
    case 'file':
      return `file://${url.deviceId ?? ''}${url.path}`
    case 'cyfs_path':
      return `cyfs://${url.zone ?? ''}${url.path}`
    case 'cyfs_object':
      return `cyfs://${url.objId.toBase32()}${url.sourceZone ? `.${url.sourceZone}` : ''}${url.innerPath || '/'}`
    case 'obj': {
      const keys = Object.keys(url.query).sort()
      const query = keys.map((k) => `${encodeObjQueryComponent(k)}=${encodeObjQueryComponent(url.query[k])}`).join('&')
      return `obj://${url.host.name}${url.path}${query ? `?${query}` : ''}`
    }
    case 'web':
    case 'buckyos':
      return url.url
  }
}

/**
 * DID Object endpoint (TODO §1.4): `obj://<host>/<p>?<q>` is `<origin>/kapi/<host>/obj/<p>?<q>`; a path-type cyfs URL
 * of the current Zone is its DFS object `<origin>/kapi/dfs/obj/<p>`; https / http as is. `origin` is a gateway
 * origin (the Zone host or a node gateway). Anything else (files, ObjIds, paths of other Zones) has none.
 */
export function objectEndpoint(url: ObjectUrl, origin: string, currentZone?: string | null): string | null {
  const base = origin.replace(/\/+$/, '')
  if (url.kind === 'obj') return `${base}/kapi/${url.host.name}/obj${formatObjectUrl(url).slice(`obj://${url.host.name}`.length)}`
  if (url.kind === 'cyfs_path' && (url.zone === null || url.zone === currentZone)) return `${base}/kapi/dfs/obj${url.path.replace(/\/+$/, '')}`
  if (url.kind === 'web') return url.url
  return null
}

export function normalizeObjectUrl(input: string): string {
  return formatObjectUrl(parseObjectUrl(input))
}

/** RBAC resource key: unique after alias normalization, without query. */
export function rbacResourceKey(url: ObjectUrl, currentZone?: string): string | null {
  if (url.kind === 'obj') return `obj://${url.host.name}${url.path}`
  if (url.kind === 'cyfs_path') {
    const local =
      url.zone === null || (currentZone !== undefined && url.zone === currentZone.toLowerCase())
    return local ? `obj://dfs${url.path}` : null
  }
  return null
}

export function objectSegments(url: ObjectUrl): string[] {
  return url.kind === 'obj' ? decodedSegments(url.path) : []
}

/** `/obj/<host>/<seg...>/<event>`; segments outside `[A-Za-z0-9_-]` (or starting with `x`) become `x` + hex. */
export function objectEventKey(url: ObjectUrl, event: string): string {
  if (url.kind !== 'obj') throw new ObjectUrlError('object events are only defined for obj:// urls')
  if (!/^[A-Za-z0-9_-]+$/.test(event) || event.startsWith('x')) {
    throw new ObjectUrlError(`invalid object event name '${event}'`)
  }
  const key = `${objectEventBase(url.host, url.path)}/${event}`
  if (key.length > 256 || key.split('/').length - 1 > 8) {
    throw new ObjectUrlError(`object event key too long: ${key}`)
  }
  return key
}

export function objectEventPattern(url: ObjectUrl): string {
  if (url.kind !== 'obj') throw new ObjectUrlError('object events are only defined for obj:// urls')
  return `${objectEventBase(url.host, url.path)}/**`
}

export function keventSegment(segment: string): string {
  if (segment !== '' && /^[A-Za-z0-9_-]+$/.test(segment) && !segment.startsWith('x')) return segment
  let out = 'x'
  for (const byte of new TextEncoder().encode(segment)) out += byte.toString(16).padStart(2, '0')
  return out
}

/** Object-event kevent key built from an obj:// host and decoded segments, without parsing. */
export function objEventKey(host: string, segments: string[], event: string): string {
  return `${objEventBase(host, segments)}/${event}`
}

export function objEventPattern(host: string, segments: string[]): string {
  return `${objEventBase(host, segments)}/**`
}

function objEventBase(host: string, segments: string[]): string {
  return [OBJECT_EVENT_PREFIX, keventSegment(host), ...segments.map(keventSegment)].join('/')
}

/** Path DID (D8): service object `<zoneDid>:<service>:<seg...>`, entity object `<entityDid>:<seg...>`. */
export function objectDid(url: ObjectUrl, zoneDid: string, entityDid?: string): string | null {
  if (url.kind !== 'obj') return null
  const segments = url.path
    .split('/')
    .filter((s) => s !== '')
    .map((s) => s.replace(/:/g, '%3A'))
  const base = url.host.kind === 'service' ? zoneDid : entityDid ?? `did:web:${url.host.name}`
  const all = url.host.kind === 'service' ? [url.host.name, ...segments] : segments
  return all.length ? `${base}:${all.join(':')}` : base
}

export function objServiceUrl(service: string, segments: string[]): string {
  return `obj://${service}${segments.map((s) => `/${encodeObjSegment(s)}`).join('')}`
}

export function objEntityUrl(entityHost: string, segments: string[]): string {
  return `obj://${entityHost}${segments.map((s) => `/${encodeObjSegment(s)}`).join('')}`
}

/** `obj://config/<key>`, `/config/<key>`, `/<key>` → system-config key. */
export function configKeyFromUrl(input: string): string {
  let key = input.startsWith('obj://config/') ? input.slice('obj://config/'.length) : input
  if (key.startsWith('/config/')) key = key.slice('/config/'.length)
  return key.replace(/^[/\\]+/, '')
}

/** Canonical JSON: sorted object keys, no whitespace (selector and other JSON query values). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

export function encodeObjSegment(segment: string): string {
  return encodeWith(segment, (b) => isUnreserved(b) || "!$&'()*+,;=:@".includes(String.fromCharCode(b)))
}

/** Canonical encoding of a query key or value. */
export function encodeObjQueryComponent(component: string): string {
  return encodeWith(component, (b) => isUnreserved(b) || "!$'()*,;:@/".includes(String.fromCharCode(b)))
}

function encodeWith(input: string, keep: (byte: number) => boolean): string {
  let out = ''
  for (const byte of new TextEncoder().encode(input)) {
    out += keep(byte) ? String.fromCharCode(byte) : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
  }
  return out
}

function isUnreserved(byte: number): boolean {
  const ch = String.fromCharCode(byte)
  return /[A-Za-z0-9]/.test(ch) || '-._~'.includes(ch)
}

function objectEventBase(host: ObjHost, path: string): string {
  return objEventBase(host.name, decodedSegments(path))
}

function splitAuthority(rest: string): { authority: string; path: string; query: string | null } {
  const qpos = rest.search(/[?#]/)
  const beforeQuery = qpos < 0 ? rest : rest.slice(0, qpos)
  let query: string | null = null
  if (qpos >= 0) {
    const q = rest.slice(qpos).split('#')[0]
    query = q.startsWith('?') ? q.slice(1) : q
    if (query === '') query = null
  }
  const slash = beforeQuery.indexOf('/')
  return slash < 0
    ? { authority: beforeQuery, path: '', query }
    : { authority: beforeQuery.slice(0, slash), path: beforeQuery.slice(slash), query }
}

function normalizePath(path: string, trimTrailingSlash: boolean): string {
  if (!path.startsWith('/')) throw new ObjectUrlError(`path '${path}' must be absolute`)
  let body = path.slice(1)
  if (trimTrailingSlash && body.endsWith('/')) body = body.slice(0, -1)
  const raw = body.split('/')
  let out = ''
  raw.forEach((segment, index) => {
    if (segment === '' && index === raw.length - 1 && !trimTrailingSlash) {
      out += '/'
      return
    }
    const decoded = percentDecode(segment)
    if (decoded === '' || decoded === '.' || decoded === '..') {
      throw new ObjectUrlError(`ambiguous path segment in '${path}'`)
    }
    out += `/${encodeObjSegment(decoded)}`
  })
  return out
}

function decodedSegments(path: string): string[] {
  return path
    .split('/')
    .filter((s) => s !== '')
    .map((s) => {
      try {
        return percentDecode(s)
      } catch {
        return s
      }
    })
}

function parseQuery(query: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const pair of query.split('&')) {
    if (pair === '') continue
    const eq = pair.indexOf('=')
    const key = percentDecode((eq < 0 ? pair : pair.slice(0, eq)).replace(/\+/g, ' '))
    let value = percentDecode((eq < 0 ? '' : pair.slice(eq + 1)).replace(/\+/g, ' '))
    if (key === 'selector') {
      try {
        value = canonicalJson(JSON.parse(value))
      } catch (e) {
        throw new ObjectUrlError(`selector must be JSON: ${e}`)
      }
    }
    if (Object.prototype.hasOwnProperty.call(out, key)) {
      throw new ObjectUrlError(`query key '${key}' repeats`)
    }
    out[key] = value
  }
  return out
}

function percentDecode(input: string): string {
  const raw = new TextEncoder().encode(input)
  const bytes: number[] = []
  for (let i = 0; i < raw.length; ) {
    if (raw[i] === 0x25) {
      const hex = String.fromCharCode(raw[i + 1] ?? 0, raw[i + 2] ?? 0)
      if (!/^[0-9A-Fa-f]{2}$/.test(hex)) throw new ObjectUrlError(`invalid escape in '${input}'`)
      bytes.push(parseInt(hex, 16))
      i += 3
    } else {
      bytes.push(raw[i])
      i += 1
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes))
  } catch {
    throw new ObjectUrlError(`'${input}' is not UTF-8`)
  }
}

function isHostname(host: string): boolean {
  return (
    host !== '' &&
    host.length <= 253 &&
    host
      .split('.')
      .every((label) => label !== '' && label.length <= 63 && /^[a-z0-9-]+$/.test(label) && !label.startsWith('-') && !label.endsWith('-'))
  )
}

function strictObjIdLabel(label: string): ObjId | null {
  if (label.length < 26) return null
  try {
    const objId = ObjId.fromString(label)
    const typeOk = /^[a-z0-9_-]+$/.test(objId.objType)
    return typeOk && objId.objHash.length >= 16 && objId.toBase32() === label ? objId : null
  } catch {
    return null
  }
}
