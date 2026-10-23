import { type ContentHints, type ContentOpenTarget, type OpenRequest, type TransferableContentRef, type TransferableSessionContext } from './content';
export interface AppFrameMessage<T extends string = string, P = unknown> {
    protocol: 'buckyos.app-frame';
    version: 1;
    type: T;
    id?: string;
    replyTo?: string;
    payload: P;
}
export interface FrameInit {
    nonce: string;
    windowId: string;
    formFactor: 'desktop' | 'mobile';
    theme: {
        mode: 'light' | 'dark';
        accent?: string;
    };
    locale: string;
    launch?: OpenRequest;
    shellCapabilities: string[];
}
export type CloseDecision = 'allow' | 'deny' | 'pending';
export declare class AppFrameHost {
    private options;
    ready: boolean;
    capabilities: string[];
    private pending;
    private listener;
    private opens;
    constructor(options: {
        target: () => Window | null;
        origin: string;
        init: FrameInit;
        onReady?: () => void;
        onTitle?: (title: string, dirty: boolean) => void;
        onRequestClose?: () => void;
        onContentOpen?: (request: OpenRequest, target: ContentOpenTarget, options: {
            newWindow: boolean;
            hints: ContentHints;
        }) => void;
    });
    private focused?;
    private receive;
    update(init: Partial<FrameInit>): void;
    /** Reports whether the App's window is the focused one; only a change is sent. */
    setFocused(focused: boolean): void;
    send(type: string, payload: unknown): void;
    request(type: string, payload: unknown, timeout?: number): Promise<unknown>;
    open(request: OpenRequest): Promise<{
        accepted: boolean;
        fallback?: 'preview';
    }>;
    beforeClose(reason?: 'user' | 'logout' | 'shell'): Promise<CloseDecision>;
    back(): Promise<boolean>;
    dispose(): void;
}
/**
 * Origin of the window embedding this page, when `accept` admits it. `location.ancestorOrigins` names the real
 * parent even after the frame navigated through other pages (a sign-in round trip); the referrer is the fallback.
 */
export declare function embedderOrigin(accept: (origin: string) => boolean): string | null;
export declare const originInZone: (origin: string, zoneHost: string) => boolean;
export declare class AppFrameClient {
    private options;
    init?: FrameInit;
    private title?;
    private focused?;
    private helloTimer?;
    private helloDeadline?;
    private readonly nonce;
    private readonly origin;
    private readonly listener;
    constructor(options: {
        shellOrigin: string;
        /** The Zone's system entry (its root origin): where content is opened when this page is not embedded in the shell. */
        systemOrigin?: string;
        /** This App's id, so the system does not offer the content back to it. */
        appId?: string;
        onInit?: (init: FrameInit) => void;
        onOpen?: (request: OpenRequest) => Promise<{
            accepted: boolean;
            fallback?: 'preview';
        }> | {
            accepted: boolean;
            fallback?: 'preview';
        };
        onBeforeClose?: (reason: 'user' | 'logout' | 'shell') => Promise<CloseDecision> | CloseDecision;
        onBack?: () => Promise<boolean> | boolean;
        onTheme?: (theme: FrameInit['theme']) => void;
        onLocale?: (locale: string) => void;
        onFocus?: (focused: boolean) => void;
    });
    private receive;
    send(type: string, payload: unknown): void;
    setTitle(title: string, dirty?: boolean): void;
    requestClose(): void;
    /**
     * Asks the system to open content: with its default app, in Preview, or by letting the user choose (`chooser`).
     * Embedded in the shell the request goes over the frame; in a standalone tab it opens the Zone's system entry
     * (`systemOrigin`) in a new tab. Returns false when neither is available.
     */
    openContent(request: Omit<OpenRequest, 'requestId'>, target?: ContentOpenTarget, options?: {
        newWindow?: boolean;
        hints?: ContentHints;
    }): boolean;
    dispose(): void;
}
/**
 * Preview embed protocol (`buckyos.preview-embed` v1): an App shows the system Preview component inside its own UI.
 * The App frames `<systemOrigin>/embed/preview` (component only, no shell) and hands it a content reference; the
 * system page reads the content with its own Zone-root session, so no token crosses origins. Open With goes back
 * through the App to the shell (`AppFrameClient.openContent(…, 'chooser')`).
 */
export type PreviewEmbedSource = TransferableContentRef | {
    kind: 'blob';
    blob: Blob;
    name: string;
};
export interface PreviewEmbedInit {
    nonce: string;
    source: PreviewEmbedSource;
    session?: TransferableSessionContext;
    theme: 'light' | 'dark';
    locale: string;
}
export interface PreviewEmbedState {
    status: 'loading' | 'ready' | 'error';
    /** Preview error kind (`unsupported`, `not-found`, `permission-denied`, `timeout`, `error`, …) and code. */
    error?: {
        kind: string;
        code: string;
    };
    title?: string;
    mediaType?: string;
}
export interface PreviewEmbedOpenWith {
    request: Omit<OpenRequest, 'requestId'>;
    hints: ContentHints;
}
export declare const PREVIEW_EMBED_PATH = "/embed/preview";
/** App side: owns the iframe that shows the system Preview. */
export declare class PreviewEmbed {
    private options;
    readonly url: string;
    private readonly nonce;
    private readonly origin;
    private readonly listener;
    private init;
    constructor(options: {
        systemOrigin: string;
        frame: () => HTMLIFrameElement | null;
        init: Omit<PreviewEmbedInit, 'nonce'>;
        onState?: (state: PreviewEmbedState) => void;
        onOpenWith?: (open: PreviewEmbedOpenWith) => void;
        onExit?: () => void;
    });
    private post;
    private receive;
    update(patch: Partial<Pick<PreviewEmbedInit, 'theme' | 'locale'>>): void;
    dispose(): void;
}
/** System side: the component-only page at `PREVIEW_EMBED_PATH`. Accepts one embedding App whose origin `accept` admits. */
export declare class PreviewEmbedHost {
    private options;
    readonly parentOrigin: string | null;
    private readonly nonce;
    private ready;
    private readonly hello?;
    private readonly listener;
    constructor(options: {
        accept: (origin: string) => boolean;
        onInit: (init: PreviewEmbedInit) => void;
        onUpdate?: (patch: Partial<Pick<PreviewEmbedInit, 'theme' | 'locale'>>) => void;
    });
    private receive;
    private post;
    state(state: PreviewEmbedState): void;
    openWith(open: PreviewEmbedOpenWith): void;
    exit(): void;
    dispose(): void;
}
//# sourceMappingURL=app-frame.d.ts.map