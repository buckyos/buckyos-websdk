/**
 * Opening an App. Whatever starts it (an icon, a notification, another App, an external link) becomes one
 * `OpenAppRequest`; `resolveOpenApp` decides between a new window and one that is already open. The shell and the
 * native client share these rules, and `tests/open_app_vectors.json` holds the cases both run.
 */
export interface OpenAppRequest {
  /** Zone DID. Required: there is no implicit "current Zone". */
  zone: string
  /** App id; a system App uses its id in the system App list (`files`, `messagehub`, …). */
  app: string
  /** The page inside the App, with its query and fragment. */
  path?: string
  /** Window path, named by the App: the same path is the same window. Empty is the App's main window. */
  window?: string
  /** Defaults to `reuse`. `new` only applies to Apps that declare several windows. */
  mode?: 'reuse' | 'new'
}

/** `window` of an AppDoc and of an entry in the system App list. */
export interface AppWindowDeclaration {
  instance: 'single' | 'multi'
  default_mode: 'windowed' | 'maximized'
  width?: number
  height?: number
  min_width?: number
  min_height?: number
  resizable: boolean
  allow_minimize: boolean
  allow_maximize: boolean
  mobile_header: 'standard' | 'compact'
}

/** Reads a declaration leniently: a missing or invalid field takes its default. */
export function readAppWindowDeclaration(value: unknown): AppWindowDeclaration {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const declaration: AppWindowDeclaration = {
    instance: v.instance === 'multi' ? 'multi' : 'single',
    default_mode: v.default_mode === 'maximized' ? 'maximized' : 'windowed',
    resizable: v.resizable !== false,
    allow_minimize: v.allow_minimize !== false,
    allow_maximize: v.allow_maximize !== false,
    mobile_header: v.mobile_header === 'compact' ? 'compact' : 'standard',
  }
  for (const key of ['width', 'height', 'min_width', 'min_height'] as const) {
    const size = v[key]
    if (typeof size === 'number' && Number.isFinite(size) && size >= 1) declaration[key] = Math.round(size)
  }
  return declaration
}

/** `<zone>|<appInstance>|<windowPath>`, each part percent-encoded. */
export function appWindowId(zone: string, appInstance: string, windowPath = ''): string {
  return [zone, appInstance, windowPath].map(encodeURIComponent).join('|')
}

export function parseAppWindowId(id: string): { zone: string; appInstance: string; windowPath: string } | undefined {
  const parts = id.split('|')
  if (parts.length !== 3) return undefined
  try {
    const [zone, appInstance, windowPath] = parts.map(decodeURIComponent)
    return zone && appInstance ? { zone, appInstance, windowPath } : undefined
  } catch {
    return undefined
  }
}

export interface OpenAppWindow {
  id: string
  zone: string
  appInstance: string
  windowPath: string
  /** The page shown now, when it is known. */
  path?: string
  /** When the window was last used; only compared with that of other windows. */
  lastActive: number
}

export type OpenAppDecision =
  | { action: 'create'; windowId: string; windowPath: string; path?: string }
  /** `navigate`: the page to go to inside that window. */
  | { action: 'focus'; windowId: string; navigate?: string }

/**
 * Where a request goes. `appInstance` is what the caller resolved `request.app` to; `windows` are all open windows
 * (those of other Zones and Apps are ignored here). A window path given as `''` names the main window, which is not
 * the same as giving none.
 */
export function resolveOpenApp(request: OpenAppRequest, appInstance: string, declaration: AppWindowDeclaration, windows: OpenAppWindow[]): OpenAppDecision {
  const own = windows.filter(w => w.zone === request.zone && w.appInstance === appInstance)
  const path = request.path || undefined
  const create = (windowPath: string): OpenAppDecision =>
    ({ action: 'create', windowId: appWindowId(request.zone, appInstance, windowPath), windowPath, ...(path ? { path } : {}) })
  const focus = (window: OpenAppWindow): OpenAppDecision =>
    ({ action: 'focus', windowId: window.id, ...(path && path !== window.path ? { navigate: path } : {}) })
  const multi = declaration.instance === 'multi'

  if (multi && request.mode === 'new') {
    const taken = new Set(own.map(w => w.windowPath))
    const base = request.window ?? ''
    let windowPath = base
    for (let n = 2; taken.has(windowPath); n++) windowPath = `${base}~${n}`
    return create(windowPath)
  }
  if (multi && request.window !== undefined) {
    const existing = own.find(w => w.windowPath === request.window)
    return existing ? focus(existing) : create(request.window)
  }
  const latest = own.reduce<OpenAppWindow | undefined>((best, w) => !best || w.lastActive > best.lastActive ? w : best, undefined)
  return latest ? focus(latest) : create('')
}

/** A request from an App: without a Zone it means the App's own. */
export type AppOpenRequest = Omit<OpenAppRequest, 'zone'> & { zone?: string }

const wellFormed = (value: string): boolean => {
  if (/[\x00-\x1f\x7f]/.test(value)) return false
  try { encodeURIComponent(value) } catch { return false }
  return true
}
const isAppId = (value: unknown): value is string => typeof value === 'string' && /^[\w.@-]{1,255}$/.test(value)
const isWindowPath = (value: unknown): value is string => typeof value === 'string' && value.length <= 512 && wellFormed(value)
const isZoneHost = (value: string): boolean => /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i.test(value)

/** A page inside an App: `/…` that cannot leave the App's origin when it is resolved against it. */
export function isAppPath(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 4096 && /^\/(?![\/\\])/.test(value) && wellFormed(value)
}

/** Checks a request that crossed a window boundary and returns a clean copy. */
export function readAppOpenRequest(value: unknown): AppOpenRequest | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  if (!isAppId(v.app)) return undefined
  const request: AppOpenRequest = { app: v.app }
  if (v.zone !== undefined) {
    if (typeof v.zone !== 'string' || !v.zone || v.zone.length > 255 || !wellFormed(v.zone)) return undefined
    request.zone = v.zone
  }
  if (v.path !== undefined) {
    if (!isAppPath(v.path)) return undefined
    request.path = v.path
  }
  if (v.window !== undefined) {
    if (!isWindowPath(v.window)) return undefined
    request.window = v.window
  }
  if (v.mode !== undefined) {
    if (v.mode !== 'reuse' && v.mode !== 'new') return undefined
    request.mode = v.mode
  }
  return request
}

const query = (params: Array<[string, string | undefined]>): string =>
  params.flatMap(([key, value]) => value === undefined ? [] : [`${key}=${encodeURIComponent(value)}`]).join('&')

/** The Zone root page that opens an App: where a standalone tab sends the user. */
export function systemOpenAppUrl(systemOrigin: string, request: Omit<AppOpenRequest, 'zone'>): string {
  return `${new URL('/', systemOrigin).href}?${query([
    ['open-app', request.app], ['path', request.path], ['window', request.window], ['mode', request.mode === 'new' ? 'new' : undefined],
  ])}`
}

/** Inverse of `systemOpenAppUrl`; the Zone is the one serving the page. */
export function parseSystemOpenApp(params: URLSearchParams): Omit<AppOpenRequest, 'zone'> | undefined {
  return readAppOpenRequest({
    app: params.get('open-app') ?? undefined, path: params.get('path') ?? undefined,
    window: params.get('window') ?? undefined, mode: params.get('mode') === 'new' ? 'new' : undefined,
  })
}

/** `buckyos://<action>?v=<version>&…`. Undefined when it is not a well-formed BuckyOS address. */
export function parseBuckyosUrl(url: string): { action: string; version: number; params: URLSearchParams } | undefined {
  const match = /^buckyos:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)*)\/?(?:\?([^#]*))?(?:#.*)?$/i.exec(url.trim())
  if (!match) return undefined
  const params = new URLSearchParams(match[2] ?? '')
  const version = params.get('v') ?? ''
  if (!/^[1-9]\d{0,8}$/.test(version)) return undefined
  return { action: match[1].toLowerCase(), version: Number(version), params }
}

export interface AppOpenLink {
  zoneHost: string
  app: string
  path?: string
  window?: string
}

export const APP_OPEN_ACTION = 'app.open'

export function formatAppOpenUrl(link: AppOpenLink): string {
  return `buckyos://${APP_OPEN_ACTION}?${query([['v', '1'], ['zone', link.zoneHost], ['app', link.app], ['path', link.path], ['window', link.window]])}`
}

export function parseAppOpenUrl(url: string): AppOpenLink | undefined {
  const parsed = parseBuckyosUrl(url)
  if (!parsed || parsed.action !== APP_OPEN_ACTION || parsed.version !== 1) return undefined
  const zoneHost = parsed.params.get('zone')?.toLowerCase()
  if (!zoneHost || !isZoneHost(zoneHost)) return undefined
  const request = readAppOpenRequest({
    app: parsed.params.get('app') ?? undefined, path: parsed.params.get('path') ?? undefined, window: parsed.params.get('window') ?? undefined,
  })
  if (!request) return undefined
  return { zoneHost, app: request.app, ...(request.path !== undefined ? { path: request.path } : {}), ...(request.window !== undefined ? { window: request.window } : {}) }
}
