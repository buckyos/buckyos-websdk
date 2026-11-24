import { type ContentHints, type ContentOpenTarget, type OpenRequest, type SelectDialogParams, type SelectDialogResult, type SystemDialogErrorCode, type TransferableContentRef, type TransferableSessionContext } from './content';
export type SystemDialogReply = {
    ok: true;
    result: unknown;
} | {
    ok: false;
    code: SystemDialogErrorCode;
};
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
        /** Shows a system dialog the App asked for (`sysdlg.open`). `params` is untrusted input: validate it. */
        onSystemDialog?: (path: string, params: unknown) => Promise<SystemDialogReply>;
    });
    private focused?;
    private dialogOpen;
    private systemDialog;
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
    private dialogs;
    private embedAbort?;
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
    /**
     * Shows the system file picker (`sysdlg/select`) and resolves with what the user chose; cancelling resolves with
     * `{ action: 'cancelled' }`. Embedded in the shell the shell draws the dialog over this App's window; in a
     * standalone tab the picker page of the Zone's system entry (`systemOrigin`) is framed over this page. Rejects
     * with a `SystemDialogError` when no picker is available or the request did not complete.
     */
    selectContent(params?: SelectDialogParams, options?: {
        signal?: AbortSignal;
        theme?: 'light' | 'dark';
        locale?: string;
    }): Promise<SelectDialogResult>;
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
    private ready;
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
export declare const SELECT_EMBED_PATH = "/embed/sysdlg/select";
export interface SelectEmbedInit {
    nonce: string;
    params: unknown;
    theme: 'light' | 'dark';
    locale: string;
}
/** App side of `buckyos.sysdlg-embed`: the full-page layer that frames the picker. One at a time per page. */
export declare function openSelectEmbed(systemOrigin: string, params: SelectDialogParams, options?: {
    signal?: AbortSignal;
    theme?: 'light' | 'dark';
    locale?: string;
}): Promise<SelectDialogResult>;
/** System side: the picker page at `SELECT_EMBED_PATH`. Works only for an embedding page whose origin `accept` admits. */
export declare class SelectEmbedHost {
    private options;
    readonly parentOrigin: string | null;
    private readonly nonce;
    private ready;
    private readonly hello?;
    private readonly listener;
    constructor(options: {
        accept: (origin: string) => boolean;
        onInit: (init: SelectEmbedInit) => void;
    });
    private receive;
    private post;
    result(result: SelectDialogResult): void;
    error(code: SystemDialogErrorCode): void;
    dispose(): void;
}
export declare const CONVERSATION_EMBED_PATH = "/embed/conversation";
/**
 * `agent`: the conversation with this Agent (the owner's default Agent when `agentDid` is left out) that this App
 * started; without one, the first message starts it. With a `memoryMode`, only a conversation in that mode counts, and
 * the one the first message starts has it (`normal` when left out). `session`: an existing conversation, when the
 * system allows this App to open it.
 */
export type ConversationEmbedTarget = {
    kind: 'agent';
    agentDid?: string;
    memoryMode?: ConversationMemoryMode;
} | {
    kind: 'session';
    sessionId: string;
};
/**
 * Whether what is said in a conversation with an Agent, and what the work it starts finds, reaches the Agent's
 * long-term memory (`no_write`: it does not), and whether that memory reaches the conversation (`no_read_write`:
 * neither way).
 */
export type ConversationMemoryMode = 'normal' | 'no_write' | 'no_read_write';
export interface ConversationEmbedInit {
    nonce: string;
    target: ConversationEmbedTarget;
    theme: 'light' | 'dark';
    locale: string;
    /** The composer's placeholder. */
    placeholder?: string;
}
/** What the system page receives: `target` is untrusted input it validates itself. */
export type ConversationEmbedHostInit = Omit<ConversationEmbedInit, 'target'> & {
    target: unknown;
};
/** A message the App sends in the user's name; `attachments` are content the user can read in the Zone. */
export interface ConversationEmbedSend {
    text: string;
    attachments?: TransferableContentRef[];
}
export interface ConversationEmbedState {
    status: 'loading' | 'ready' | 'error';
    /** The conversation shown, once there is one. */
    sessionId?: string;
    error?: string;
}
/**
 * What the conversation in front is doing: `idle`; `running` while the Agent handles the message in front,
 * `interrupted` after a restart in the middle of it, `paused`; `answer` while a question of the Agent waits for the
 * user's answer.
 */
export type ConversationEmbedTurnMode = 'idle' | 'running' | 'interrupted' | 'paused' | 'answer';
export declare const CONVERSATION_EMBED_ERROR_CODES: readonly ["invalid_params", "not_found", "denied"];
export type ConversationEmbedErrorCode = typeof CONVERSATION_EMBED_ERROR_CODES[number];
/** App side: owns the iframe that shows the system conversation. */
export declare class ConversationEmbed {
    private options;
    readonly url: string;
    private readonly nonce;
    private readonly origin;
    private readonly listener;
    private init;
    private ready;
    private outbox;
    constructor(options: {
        systemOrigin: string;
        frame: () => HTMLIFrameElement | null;
        init: Omit<ConversationEmbedInit, 'nonce'>;
        onState?: (state: ConversationEmbedState) => void;
        onTurn?: (mode: ConversationEmbedTurnMode) => void;
        onError?: (code: ConversationEmbedErrorCode) => void;
    });
    private post;
    private receive;
    update(patch: Partial<Pick<ConversationEmbedInit, 'theme' | 'locale'>>): void;
    /** Sends a message in the user's name. Before the handshake it waits and goes out right after `embed.init`. */
    send(message: ConversationEmbedSend): void;
    dispose(): void;
}
/** System side: the component-only page at `CONVERSATION_EMBED_PATH`. Accepts one embedding App whose origin `accept` admits. */
export declare class ConversationEmbedHost {
    private options;
    readonly parentOrigin: string | null;
    private readonly nonce;
    private ready;
    private readonly hello?;
    private readonly listener;
    constructor(options: {
        accept: (origin: string) => boolean;
        onInit: (init: ConversationEmbedHostInit) => void;
        onUpdate?: (patch: Partial<Pick<ConversationEmbedInit, 'theme' | 'locale'>>) => void;
        onSend?: (message: ConversationEmbedSend) => void;
    });
    private receive;
    private post;
    state(state: ConversationEmbedState): void;
    turn(mode: ConversationEmbedTurnMode): void;
    error(code: ConversationEmbedErrorCode): void;
    dispose(): void;
}
//# sourceMappingURL=app-frame.d.ts.map