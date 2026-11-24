/** Where a page runs: an ordinary browser, or a window or container of the BuckyOS client. */
export type RuntimeContainer = 'browser' | 'desktop-app' | 'mobile-app';
export type RuntimeFormFactor = 'desktop' | 'mobile';
export type RuntimePlatform = 'windows' | 'macos' | 'linux' | 'android' | 'ios';
/** What the BuckyOS client tells a page about itself; readable synchronously. */
export interface BuckyApiEnv {
    container: Exclude<RuntimeContainer, 'browser'>;
    formFactor: RuntimeFormFactor;
    platform: RuntimePlatform;
    clientVersion: string;
    /** `window.native`, `notify.system`, `app.open`, `audio.background`, `audio.record`, `media.session`, … */
    capabilities: string[];
    /** Who this view belongs to, as the client determined it. */
    zone?: string;
    app?: string;
    appInstance?: string;
    windowId?: string;
}
/** Result of the wallet methods of the bridge; `code` 0 is success. */
export interface BuckyApiResult<T = unknown> {
    code: number;
    data?: T;
    message?: string;
}
/** `window.BuckyApi`, injected by the BuckyOS client. Absent in a browser. */
export interface BuckyApi {
    readonly env: BuckyApiEnv;
    /** Resolves with the data; rejects with an Error that carries a `code` string. */
    call(name: string, payload?: unknown): Promise<unknown>;
    /** Returns the function that stops listening. */
    on(event: string, handler: (payload: unknown) => void): () => void;
    getPublicKey(): Promise<BuckyApiResult>;
    getCurrentUser(): Promise<BuckyApiResult>;
    signJsonWithActiveDid(payloads: Record<string, unknown>[]): Promise<BuckyApiResult>;
    resolve_did(did: string, docType?: string | null): Promise<BuckyApiResult>;
    openExternalUrl(url: string): Promise<BuckyApiResult>;
}
/** The bridge of the BuckyOS client, when this page runs in one that has `env`, `call` and `on`. */
export declare function getBuckyApi(): BuckyApi | undefined;
export interface RuntimeEnvironment {
    container: RuntimeContainer;
    formFactor: RuntimeFormFactor;
    /** What works here. An App decides by this list what to offer, not by the platform. */
    capabilities: string[];
    /** Only known in the BuckyOS client. */
    platform?: RuntimePlatform;
}
/**
 * The environment this page runs in. In a browser the list holds only what the page can do by itself (through this
 * SDK's fallbacks); what the shell around it offers is in `FrameInit.shellCapabilities`.
 */
export declare function getRuntimeEnvironment(): RuntimeEnvironment;
//# sourceMappingURL=runtime_env.d.ts.map