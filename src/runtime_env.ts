/** Where a page runs: an ordinary browser, or a window or container of the BuckyOS client. */
export type RuntimeContainer = 'browser' | 'desktop-app' | 'mobile-app'
export type RuntimeFormFactor = 'desktop' | 'mobile'
export type RuntimePlatform = 'windows' | 'macos' | 'linux' | 'android' | 'ios'

/** What the BuckyOS client tells a page about itself; readable synchronously. */
export interface BuckyApiEnv {
  container: Exclude<RuntimeContainer, 'browser'>
  formFactor: RuntimeFormFactor
  platform: RuntimePlatform
  clientVersion: string
  /** `window.native`, `notify.system`, `app.open`, `audio.background`, `audio.record`, `media.session`, … */
  capabilities: string[]
  /** Who this view belongs to, as the client determined it. */
  zone?: string
  app?: string
  appInstance?: string
  windowId?: string
}

/** Result of the wallet methods of the bridge; `code` 0 is success. */
export interface BuckyApiResult<T = unknown> { code: number; data?: T; message?: string }

/** `window.BuckyApi`, injected by the BuckyOS client. Absent in a browser. */
export interface BuckyApi {
  readonly env: BuckyApiEnv
  /** Resolves with the data; rejects with an Error that carries a `code` string. */
  call(name: string, payload?: unknown): Promise<unknown>
  /** Returns the function that stops listening. */
  on(event: string, handler: (payload: unknown) => void): () => void
  getPublicKey(): Promise<BuckyApiResult>
  getCurrentUser(): Promise<BuckyApiResult>
  signJsonWithActiveDid(payloads: Record<string, unknown>[]): Promise<BuckyApiResult>
  resolve_did(did: string, docType?: string | null): Promise<BuckyApiResult>
  openExternalUrl(url: string): Promise<BuckyApiResult>
}

/** The bridge of the BuckyOS client, when this page runs in one that has `env`, `call` and `on`. */
export function getBuckyApi(): BuckyApi | undefined {
  if (typeof window === 'undefined') return undefined
  const api = (window as unknown as { BuckyApi?: Partial<BuckyApi> }).BuckyApi
  const env = api?.env
  return api && env && (env.container === 'desktop-app' || env.container === 'mobile-app') &&
    typeof api.call === 'function' && typeof api.on === 'function' ? api as BuckyApi : undefined
}

export interface RuntimeEnvironment {
  container: RuntimeContainer
  formFactor: RuntimeFormFactor
  /** What works here. An App decides by this list what to offer, not by the platform. */
  capabilities: string[]
  /** Only known in the BuckyOS client. */
  platform?: RuntimePlatform
}

const mediaRecording = (): boolean => typeof MediaRecorder !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function'

function browserFormFactor(): RuntimeFormFactor {
  // A frame's own size says nothing about the device it is on.
  if (window.parent !== window) return Math.min(window.screen?.width ?? 1024, window.screen?.height ?? 1024) <= 768 ? 'mobile' : 'desktop'
  return window.matchMedia?.('(max-width: 768px)').matches ? 'mobile' : 'desktop'
}

/**
 * The environment this page runs in. In a browser the list holds only what the page can do by itself (through this
 * SDK's fallbacks); what the shell around it offers is in `FrameInit.shellCapabilities`.
 */
export function getRuntimeEnvironment(): RuntimeEnvironment {
  if (typeof window === 'undefined') throw new Error('getRuntimeEnvironment is only available in browser runtime')
  const env = getBuckyApi()?.env
  if (env) {
    return {
      container: env.container, platform: env.platform, formFactor: env.formFactor === 'mobile' ? 'mobile' : 'desktop',
      capabilities: Array.isArray(env.capabilities) ? env.capabilities.filter((c): c is string => typeof c === 'string') : [],
    }
  }
  const capabilities: string[] = []
  if (typeof navigator !== 'undefined') {
    if (mediaRecording()) capabilities.push('audio.record')
    if ('mediaSession' in navigator) capabilities.push('media.session')
  }
  return { container: 'browser', formFactor: browserFormFactor(), capabilities }
}
