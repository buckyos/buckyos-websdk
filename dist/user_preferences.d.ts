export interface UserPreferences {
    theme?: 'light' | 'dark';
    /** `#rrggbb`; null is the Zone's default colour. */
    accent?: string | null;
    /** A BCP 47 tag (`en`, `zh-CN`). */
    locale?: string;
    /** What the user made public of their profile (name, avatar, …). */
    profile?: Record<string, unknown>;
    /** The whole profile, unpublished fields included: only for pages of system services. */
    private_profile?: Record<string, unknown>;
}
/** The appearance a host's frame gives the page (`frame.init`, `frame.themeChanged`, `frame.localeChanged`). */
export interface FrameAppearance {
    theme: 'light' | 'dark';
    accent?: string | null;
    locale: string;
}
/** The usable fields of an answer; anything missing or invalid is left out. */
export declare function readUserPreferences(value: unknown): UserPreferences;
/** Called by `AppFrameClient` as its host gives or changes the appearance; null when the page leaves the frame. */
export declare function setFrameAppearance(appearance: FrameAppearance | null): void;
type Listener = (preferences: UserPreferences) => void;
export declare class UserPreferencesStore {
    /** The Zone's answer; `{}` when there is none (signed out, not reachable). */
    private readonly read;
    /** Calls back whenever the page comes back to the foreground; answers how to stop. */
    private readonly onForeground;
    private zone;
    private reading;
    private shown;
    private readonly listeners;
    private detachPage;
    constructor(
    /** The Zone's answer; `{}` when there is none (signed out, not reachable). */
    read: () => Promise<UserPreferences>, 
    /** Calls back whenever the page comes back to the foreground; answers how to stop. */
    onForeground?: ((callback: () => void) => () => void) | undefined);
    /** The settings now: read from the Zone, the host's appearance over them in a frame. */
    get(): Promise<UserPreferences>;
    /** `listener` hears each change after this call; the returned function stops it. */
    subscribe(listener: Listener): () => void;
    /** Reads the Zone again (one read at a time); a failed read keeps what was known. */
    refresh(): Promise<void>;
    private view;
    private announce;
    private attach;
    private detach;
}
export {};
//# sourceMappingURL=user_preferences.d.ts.map