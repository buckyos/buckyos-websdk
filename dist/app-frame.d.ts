import { type OpenRequest } from './content';
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
        onContentOpen?: (request: OpenRequest, target: 'default' | 'preview', newWindow: boolean) => void;
    });
    private receive;
    update(init: Partial<FrameInit>): void;
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
export declare class AppFrameClient {
    private options;
    init?: FrameInit;
    private helloTimer?;
    private helloDeadline?;
    private readonly nonce;
    private readonly origin;
    private readonly listener;
    constructor(options: {
        shellOrigin: string;
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
    openContent(request: Omit<OpenRequest, 'requestId'>, target?: 'default' | 'preview', newWindow?: boolean): void;
    dispose(): void;
}
//# sourceMappingURL=app-frame.d.ts.map