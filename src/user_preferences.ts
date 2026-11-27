/* ── The signed-in user's settings, for a page of an App or of a system service ──
 *
 * The theme, colour and language the system uses, and the user's profile, so a page looks like the rest of the
 * system wherever it is shown (buckyos `notepads/user-preferences-api-todo.md`):
 *
 * - in a host's frame (a Desktop window, the BuckyOS client) the appearance is the host's, which may show the page
 *   otherwise than the account says (an embedding App fixing the theme); the host pushes its changes;
 * - alone in a tab, on the page's own origin, the Zone answers (`control-panel` `user.preferences.get`) as much as the
 *   page may see: an App the appearance and the public profile, a system service's page the private profile too.
 *   While someone listens, the answer is read again whenever the page comes back to the foreground.
 */

export interface UserPreferences {
  theme?: 'light' | 'dark'
  /** `#rrggbb`; null is the Zone's default colour. */
  accent?: string | null
  /** A BCP 47 tag (`en`, `zh-CN`). */
  locale?: string
  /** What the user made public of their profile (name, avatar, …). */
  profile?: Record<string, unknown>
  /** The whole profile, unpublished fields included: only for pages of system services. */
  private_profile?: Record<string, unknown>
}

/** The appearance a host's frame gives the page (`frame.init`, `frame.themeChanged`, `frame.localeChanged`). */
export interface FrameAppearance {
  theme: 'light' | 'dark'
  accent?: string | null
  locale: string
}

const HEX_COLOUR = /^#[0-9a-f]{6}$/i
const LOCALE_TAG = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The usable fields of an answer; anything missing or invalid is left out. */
export function readUserPreferences(value: unknown): UserPreferences {
  if (!isRecord(value)) return {}
  const result: UserPreferences = {}
  if (value.theme === 'light' || value.theme === 'dark') result.theme = value.theme
  if (value.accent === null) result.accent = null
  else if (typeof value.accent === 'string' && HEX_COLOUR.test(value.accent)) result.accent = value.accent.toLowerCase()
  if (typeof value.locale === 'string' && LOCALE_TAG.test(value.locale)) result.locale = value.locale
  if (isRecord(value.profile)) result.profile = value.profile
  if (isRecord(value.private_profile)) result.private_profile = value.private_profile
  return result
}

let frameAppearance: FrameAppearance | null = null
const frameListeners = new Set<() => void>()

/** Called by `AppFrameClient` as its host gives or changes the appearance; null when the page leaves the frame. */
export function setFrameAppearance(appearance: FrameAppearance | null): void {
  frameAppearance = appearance
  frameListeners.forEach((listener) => listener())
}

const sameValue = (a: UserPreferences, b: UserPreferences) => JSON.stringify(a) === JSON.stringify(b)

/** A browser page comes back: shown again (another tab or app was in front), or its window focused. */
const browserForeground = typeof window === 'undefined' || typeof document === 'undefined'
  ? undefined
  : (callback: () => void) => {
      const visible = () => { if (document.visibilityState !== 'hidden') callback() }
      document.addEventListener('visibilitychange', visible)
      window.addEventListener('focus', callback)
      return () => {
        document.removeEventListener('visibilitychange', visible)
        window.removeEventListener('focus', callback)
      }
    }

type Listener = (preferences: UserPreferences) => void

export class UserPreferencesStore {
  private zone: UserPreferences = {}
  private reading: Promise<void> | null = null
  private shown: UserPreferences | null = null
  private readonly listeners = new Set<Listener>()
  private detachPage: (() => void) | null = null

  constructor(
    /** The Zone's answer; `{}` when there is none (signed out, not reachable). */
    private readonly read: () => Promise<UserPreferences>,
    /** Calls back whenever the page comes back to the foreground; answers how to stop. */
    private readonly onForeground: ((callback: () => void) => () => void) | undefined = browserForeground,
  ) {}

  /** The settings now: read from the Zone, the host's appearance over them in a frame. */
  async get(): Promise<UserPreferences> {
    await this.refresh()
    return this.view()
  }

  /** `listener` hears each change after this call; the returned function stops it. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    if (this.listeners.size === 1) this.attach()
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) this.detach()
    }
  }

  /** Reads the Zone again (one read at a time); a failed read keeps what was known. */
  refresh(): Promise<void> {
    this.reading ??= this.read()
      .then((answer) => { this.zone = answer }, () => {})
      .finally(() => {
        this.reading = null
        this.announce()
      })
    return this.reading
  }

  private view(): UserPreferences {
    const view = { ...this.zone }
    if (frameAppearance) {
      view.theme = frameAppearance.theme
      view.accent = frameAppearance.accent ?? null
      view.locale = frameAppearance.locale
    }
    return view
  }

  private announce = () => {
    const view = this.view()
    if (this.shown && sameValue(this.shown, view)) return
    const first = this.shown === null
    this.shown = view
    // the first read is what the page started with, not a change
    if (!first) this.listeners.forEach((listener) => listener(view))
  }

  private attach() {
    frameListeners.add(this.announce)
    // the shown value is what listeners compare with: read it once if nobody did yet
    if (!this.shown) void this.refresh()
    this.detachPage = this.onForeground?.(() => { void this.refresh() }) ?? null
  }

  private detach() {
    frameListeners.delete(this.announce)
    this.detachPage?.()
    this.detachPage = null
  }
}
