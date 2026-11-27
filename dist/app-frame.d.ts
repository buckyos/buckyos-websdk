import { type ContentHints, type ContentOpenTarget, type OpenRequest, type SelectDialogParams, type SelectDialogResult, type SystemDialogErrorCode, type TransferableContentRef, type TransferableSessionContext } from './content';
import { type AppOpenRequest } from './open_app';
import { type RuntimeContainer } from './runtime_env';
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
    /** `tab`: the App fills a tab of the host, which has its own navigation, so the App leaves out its outer one. */
    presentation?: 'window' | 'tab';
    container?: RuntimeContainer;
}
export type CloseDecision = 'allow' | 'deny' | 'pending';
export type AppOpenErrorCode = 'not_found' | 'denied' | 'unsupported';
export type AppOpenReply = {
    ok: true;
} | {
    ok: false;
    code: AppOpenErrorCode;
};
export interface HeaderItem {
    id: string;
    label: string;
    active?: boolean;
}
/** `icon`: the name of an icon, or the address of an image. */
export interface HeaderMenuItem {
    id: string;
    label: string;
    icon?: string;
    danger?: boolean;
}
/**
 * What an App puts into the header the host draws above it (mobile containers; elsewhere it is ignored). A field left
 * out keeps its value; an empty list, or `null` for the search, removes it.
 */
export interface HeaderState {
    title?: string;
    /** A second row below the title, such as tabs. Only a `standard` header has room for it. */
    second_row?: HeaderItem[];
    search?: {
        placeholder?: string;
        value?: string;
    } | null;
    menu?: HeaderMenuItem[];
    /** Whether the back button applies inside the App; pressing it arrives as `frame.back`. */
    back?: boolean;
}
/** `search`: `value` is the text; `item` and `menu`: `id` is the entry that was chosen. */
export interface HeaderEvent {
    kind: 'search' | 'item' | 'menu';
    id?: string;
    value?: string;
}
/**
 * A channel to one peer that the platform has already identified. The native client's bridge is one: it knows which
 * view a message comes from, so there is no origin to check.
 */
export interface AppFrameTransport {
    /** `transfer`: objects moved with the message (a window transport only: the `MessagePort` of `transfer.connect`). */
    post(message: AppFrameMessage, transfer?: Transferable[]): void;
    /** `ports`: the ports that came with the message (a window transport only). */
    onMessage(cb: (message: unknown, ports?: readonly MessagePort[]) => void): () => void;
}
/** The capability both sides list to deliver content through the Shell. */
export declare const TRANSFER_CAPABILITY = "transfer.v1";
export type TransferItemKind = 'zone-file' | 'zone-folder' | 'local-file' | 'text' | 'object';
export type TransferOperationKind = 'copy' | 'move' | 'link';
export type TransferOfferPurpose = 'copy' | 'cut' | 'drag';
/** `unsupported`: an unknown version or no common representation; `stale`: the selection or document changed;
 * `denied`: refused by permission or policy. */
export type TransferErrorCode = 'unsupported' | 'stale' | 'denied';
export declare const TRANSFER_ERROR_CODES: readonly TransferErrorCode[];
/** A transfer request failed: one of the protocol codes, or `timeout` when no answer came in time. */
export declare class TransferError extends Error {
    code: TransferErrorCode | 'timeout';
    constructor(code: TransferErrorCode | 'timeout', message?: string);
}
/** One item of a selection an App offers: what it is and which registered formats (§2.1 names, no `web ` prefix) and
 * operations it can give. `inline`: small string representations the Shell may keep and deliver without asking back. */
export interface TransferOfferItem {
    kind: TransferItemKind;
    formats: string[];
    operations: TransferOperationKind[];
    inline?: Record<string, string>;
}
/** `transfer.offer` (App → Shell): registers a selection under the App's own high-entropy `offerId`. `generation`
 * counts the App's selections; `transfer.read` gives it back so the App can answer `stale` for an older one. */
export interface TransferOfferMessage {
    offerId: string;
    purpose: TransferOfferPurpose;
    generation: number;
    items: TransferOfferItem[];
    scope?: Record<string, string>;
}
/** One item as a probe shows it: its key in the selection (`0`, `1`, …), kind, formats and operations only. */
export interface TransferProbeItem {
    itemKey: string;
    kind: TransferItemKind;
    formats: string[];
    operations: TransferOperationKind[];
}
/** A point in the App's page (CSS pixels of its viewport), or its current focus (a paste command). */
export type TransferPoint = {
    x: number;
    y: number;
} | 'focus';
/** `transfer.probe` (Shell → target): what would you do with these items here? Nothing may be read or changed. */
export interface TransferProbe {
    operationId: string;
    seq: number;
    items: TransferProbeItem[];
    at: TransferPoint;
}
/** A probe's answer: the target's own id for the drop place, the representation and operation per accepted item, and
 * the action the user is shown ("Insert at the cursor"). */
export interface TransferProbeAnswer {
    targetId: string;
    accept: Array<{
        itemKey: string;
        format: string;
        operation: TransferOperationKind;
    }>;
    action: string;
}
/** `transfer.read` (Shell → source), once the user let go on or chose a destination. */
export interface TransferReadRequest {
    operationId: string;
    offerId: string;
    generation: number;
    items: Array<{
        itemKey: string;
        format: string;
    }>;
}
export type TransferReadValue = {
    itemKey: string;
    format: string;
    value: unknown;
} | {
    itemKey: string;
    format: string;
    error: TransferErrorCode | 'failed';
};
/**
 * A representation's value: a string for text and JSON formats; for `application/vnd.buckyos.content-refs+json` the
 * item's `ZoneContent`; for `files` a `File`; a `Blob` for binary formats (`image/png`).
 */
export interface TransferDeliveryItem {
    itemKey: string;
    format: string;
    value: unknown;
}
/** `transfer.deliver` (Shell → the chosen target). The target checks the place, version and permissions again and
 * commits once per `operationId`. */
export interface TransferDelivery {
    operationId: string;
    targetId: string;
    operation: TransferOperationKind;
    at: TransferPoint;
    items: TransferDeliveryItem[];
}
export type TransferItemStatus = 'done' | 'accepted' | 'skipped' | 'failed' | 'cancelled';
/** `done`: committed; `accepted`: taken, waiting for the user (a draft, an import dialog); `cancelled`; `failed`. */
export interface TransferDeliveryResult {
    status: 'done' | 'accepted' | 'cancelled' | 'failed';
    items: Array<{
        itemKey: string;
        status: TransferItemStatus;
        error?: string;
    }>;
}
/** Checks a `transfer.offer` an App sent; undefined when it does not follow the schema. */
export declare function readTransferOffer(value: unknown): TransferOfferMessage | undefined;
/** Checks a `transfer.probe`. */
export declare function readTransferProbe(value: unknown): TransferProbe | undefined;
/** Checks a probe's answer against the probe: only items it showed, in formats and operations it allowed, once each.
 * Null when nothing valid is accepted. */
export declare function readTransferProbeAnswer(value: unknown, probe: Pick<TransferProbe, 'items'>): TransferProbeAnswer | null;
/** Checks a `transfer.read`. */
export declare function readTransferReadRequest(value: unknown): TransferReadRequest | undefined;
/**
 * A representation's value as it crosses a window, checked by its format; undefined when it does not fit. Content
 * references come back as a clean `ZoneContent` (a one-item reference list string is also taken).
 */
export declare function readTransferValue(format: string, value: unknown): unknown;
/** Checks a `transfer.deliver`. */
export declare function readTransferDelivery(value: unknown): TransferDelivery | undefined;
/** Checks a delivery's result: one entry per delivered item (missing ones count as failed). */
export declare function readTransferDeliveryResult(value: unknown, delivered: Array<{
    itemKey: string;
}>): TransferDeliveryResult | undefined;
export interface AppFrameHostCallbacks {
    onReady?: () => void;
    onTitle?: (title: string, dirty: boolean) => void;
    onRequestClose?: () => void;
    onContentOpen?: (request: OpenRequest, target: ContentOpenTarget, options: {
        newWindow: boolean;
        hints: ContentHints;
    }) => void;
    /** Opens another App, or a page of one (`app.open`). Without a `zone` the request is for the App's own Zone. */
    onAppOpen?: (request: AppOpenRequest) => Promise<AppOpenReply> | AppOpenReply;
    /** The header the App wants now (`header.set`), with everything it set so far. */
    onHeader?: (header: HeaderState) => void;
    /** Shows a system dialog the App asked for (`sysdlg.open`). `params` is untrusted input: validate it. */
    onSystemDialog?: (path: string, params: unknown) => Promise<SystemDialogReply>;
    /** `transfer.v1`: a document of the App connected its transfer link (after each handshake of a new document). */
    onTransferConnect?: (documentId: string) => void;
    /** The link of that document is gone (reload, navigation, a new connect, dispose): its offers and requests are void. */
    onTransferDisconnect?: (documentId: string) => void;
    /** The App registers a selection. `offer` passed the schema; the host rejects an `offerId` it already has. */
    onTransferOffer?: (offer: TransferOfferMessage, documentId: string) => Promise<{
        ok: true;
    } | {
        ok: false;
        code: TransferErrorCode;
    }> | {
        ok: true;
    } | {
        ok: false;
        code: TransferErrorCode;
    };
    /** The App withdrew a selection it offered (`transfer.cancel { offerId }`). */
    onTransferWithdraw?: (offerId: string, documentId: string) => void;
}
/** The iframe name the host sets so an App can use its own URL fragment. */
export declare function appFrameName(nonce: string): string;
/**
 * `target` and `origin`: the App runs in an iframe named with `appFrameName(init.nonce)` or opened with `#bfp=<init.nonce>`. `transport`: the
 * platform connects this host to the App's view; the App picks the nonce and the host answers with it.
 */
export type AppFrameHostOptions = AppFrameHostCallbacks & ({
    target: () => Window | null;
    origin: string;
    init: FrameInit;
    transport?: undefined;
} | {
    transport: AppFrameTransport;
    init: Omit<FrameInit, 'nonce'>;
    target?: undefined;
    origin?: undefined;
});
export declare class AppFrameHost {
    ready: boolean;
    capabilities: string[];
    header: HeaderState;
    private init;
    private readonly framed;
    private readonly channel;
    private readonly detach;
    private readonly callbacks;
    private pending;
    private opens;
    constructor(options: AppFrameHostOptions);
    private focused?;
    private dialogOpen;
    private transferLink?;
    private transferPending;
    /** The App document whose transfer link is bound (`transfer.v1`); undefined when none is. */
    get transferDocument(): string | undefined;
    private limited;
    private appOpen;
    private systemDialog;
    private receive;
    update(init: Partial<FrameInit>): void;
    /** Reports whether the App's window is the focused one; only a change is sent. */
    setFocused(focused: boolean): void;
    /** Tells the App what happened in the header the host draws for it. */
    headerEvent(event: HeaderEvent): void;
    send(type: string, payload: unknown): void;
    request(type: string, payload: unknown, timeout?: number): Promise<unknown>;
    open(request: OpenRequest): Promise<{
        accepted: boolean;
        fallback?: 'preview';
    }>;
    beforeClose(reason?: 'user' | 'logout' | 'shell'): Promise<CloseDecision>;
    back(): Promise<boolean>;
    private failPending;
    /** Binds the transfer link of the document that just shook hands: its port (framed) or the bridge. */
    private connectTransfer;
    /** Drops the transfer link: every request waiting on it fails `stale`, its offers are void. */
    private dropTransfer;
    private receiveTransfer;
    private transferRequest;
    /** Asks the App what it would do with these items at a point of its page or at its focus; null when nothing. */
    transferProbe(probe: TransferProbe, timeout?: number): Promise<TransferProbeAnswer | null>;
    /** Reads representations of a selection the App offered. Each value is checked by its format. */
    transferRead(read: TransferReadRequest, timeout?: number): Promise<TransferReadValue[]>;
    /** Hands the chosen representations to the App; a retry with the same `operationId` must not commit twice. */
    transferDeliver(delivery: TransferDelivery, timeout?: number): Promise<TransferDeliveryResult>;
    /** The final result of a delivery, by its `operationId`; null when the App does not know it. */
    transferStatus(operationId: string, delivered: Array<{
        itemKey: string;
    }>, timeout?: number): Promise<TransferDeliveryResult | null>;
    /** Tells the App an operation it took part in was dropped before it committed. */
    transferCancel(operationId: string): void;
    dispose(): void;
}
/**
 * Origin of the window embedding this page, when `accept` admits it. `location.ancestorOrigins` names the real
 * parent even after the frame navigated through other pages (a sign-in round trip); the referrer is the fallback.
 * In the BuckyOS client the page is the top document and its host is the client itself, reached over the bridge: the
 * answer is the page's own origin, so that code which connects only when it is embedded connects there too.
 */
/** What an App does as a source and a target of `transfer.v1`. Giving any of these declares the capability. */
export interface AppFrameTransferHandlers {
    /** What this App would do with the items at a point of its page or at its focus; null when it takes none. It must
     * not read, import, change layout or start uploads. */
    onProbe?: (probe: TransferProbe) => TransferProbeAnswer | null | Promise<TransferProbeAnswer | null>;
    /** Commits a delivery after checking the place, version and permissions again. The SDK answers a repeated
     * `operationId` with the first result, so this runs once per operation. */
    onDeliver?: (delivery: TransferDelivery) => TransferDeliveryResult | Promise<TransferDeliveryResult>;
    /** The representations of a selection this App offered. Throw a `TransferError('stale')` for an older generation. */
    onRead?: (read: TransferReadRequest) => TransferReadValue[] | Promise<TransferReadValue[]>;
    /** The Shell dropped an operation before it was committed (the user cancelled, a timeout). */
    onCancel?: (operationId: string) => void;
    /** The Shell can (true) or can no longer (false) take offers. */
    onAvailable?: (available: boolean) => void;
}
export declare function embedderOrigin(accept: (origin: string) => boolean): string | null;
export declare const originInZone: (origin: string, zoneHost: string) => boolean;
export declare class AppFrameClient {
    private options;
    init?: FrameInit;
    /** What the host shows the page in: `getUserPreferences` answers with it while the page is in this frame. */
    private appearance?;
    private title?;
    private focused?;
    private helloTimer?;
    private helloDeadline?;
    private header;
    private readonly nonce;
    /** The page is a top document of the BuckyOS client: its host is reached over the bridge. */
    private readonly native;
    private readonly channel;
    private readonly detach;
    private dialogs;
    private appOpens;
    private embedAbort?;
    /** This document, for `transfer.v1`: a reload of the same frame is another document with the same nonce. */
    private readonly documentId;
    private transferLink?;
    private transferPending;
    private deliveries;
    private generation;
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
        /** The user used the header this App set with `setHeader`. */
        onHeaderEvent?: (event: HeaderEvent) => void;
        /** `transfer.v1`: content delivered through the Shell to and from other Apps. */
        transfer?: AppFrameTransferHandlers;
    });
    private receive;
    send(type: string, payload: unknown): void;
    setTitle(title: string, dirty?: boolean): void;
    requestClose(): void;
    /** Sets what the host shows in the header above this App. It may be called before the handshake. */
    setHeader(header: HeaderState): void;
    /**
     * Opens another App, or a page of one, in this App's Zone (or in `zone`). The host decides between a new window and
     * an open one. In a standalone tab it opens the Zone's system entry (`systemOrigin`) in a new tab, which only reaches
     * this App's own Zone. Never rejects.
     */
    openApp(request: AppOpenRequest): Promise<AppOpenReply>;
    /**
     * Asks the system to open content: with its default app, in Preview, or by letting the user choose (`chooser`).
     * Inside the shell or the BuckyOS client the request goes to the host; in a standalone tab it opens the Zone's system
     * entry (`systemOrigin`) in a new tab. Returns false when neither is available.
     */
    openContent(request: Omit<OpenRequest, 'requestId'>, target?: ContentOpenTarget, options?: {
        newWindow?: boolean;
        hints?: ContentHints;
    }): boolean;
    /**
     * Shows the system file picker (`sysdlg/select`) and resolves with what the user chose; cancelling resolves with
     * `{ action: 'cancelled' }`. Embedded in the shell the shell draws the dialog over this App's window; in a
     * standalone tab, and in the BuckyOS client unless it lists the dialog, the picker page of the Zone's system entry
     * (`systemOrigin`) is framed over this page. Rejects with a `SystemDialogError` when no picker is available or the
     * request did not complete.
     */
    selectContent(params?: SelectDialogParams, options?: {
        signal?: AbortSignal;
        theme?: 'light' | 'dark';
        locale?: string;
    }): Promise<SelectDialogResult>;
    /** Whether the Shell takes offers from this document (`transfer.v1` on both sides, link connected). */
    get transferAvailable(): boolean;
    /** Once per document, after the first `frame.init` that lists `transfer.v1`: one port, to the exact Shell origin. */
    private connectTransfer;
    private receiveTransfer;
    /**
     * Registers a selection with the Shell so another App can receive it (the Shell's drag handle, "Paste desktop
     * object…"). The offer id is generated here; withdraw it when the selection goes away. Never rejects.
     */
    offerTransfer(offer: {
        purpose: TransferOfferPurpose;
        items: TransferOfferItem[];
        scope?: Record<string, string>;
        generation?: number;
    }): Promise<{
        ok: true;
        offerId: string;
    } | {
        ok: false;
        code: TransferErrorCode;
    }>;
    /** Withdraws a selection offered with `offerTransfer`. */
    withdrawTransfer(offerId: string): void;
    private showAppearance;
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