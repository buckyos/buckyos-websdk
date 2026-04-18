export interface KEvent {
    eventid: string;
    source_node: string;
    source_pid: number;
    ingress_node?: string | null;
    timestamp: number;
    data: unknown;
}
export type KEventFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type KEventSessionTokenProvider = () => Promise<string | null | undefined> | string | null | undefined;
export type KEventTransportMode = 'browser' | 'native';
export type KEventPatternInput = string | string[];
export type KEventCallback = (event: KEvent) => void | Promise<void>;
export interface KEventReaderOptions {
    keepaliveMs?: number;
    signal?: AbortSignal;
}
export interface KEventSubscribeOptions extends KEventReaderOptions {
    reconnectDelayMs?: number;
}
export interface KEventSubscription {
    close(): Promise<void>;
}
export interface KEventClientOptions {
    mode: KEventTransportMode;
    streamUrl?: string;
    nativeHost?: string;
    nativePort?: number;
    nativeConnectTimeoutMs?: number;
    fetcher?: KEventFetcher;
    sessionTokenProvider?: KEventSessionTokenProvider;
    nativeConnector?: KEventNativeConnector;
}
export interface KEventNativeSocket {
    write(data: Uint8Array, callback?: (error?: Error | null) => void): boolean;
    end(callback?: () => void): void;
    destroy(error?: Error): void;
    setNoDelay?(noDelay?: boolean): void;
    once(event: string, listener: (...args: any[]) => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
    off?(event: string, listener: (...args: any[]) => void): this;
    removeListener?(event: string, listener: (...args: any[]) => void): this;
}
export type KEventNativeConnector = (host: string, port: number, connectTimeoutMs: number) => Promise<KEventNativeSocket>;
export declare abstract class KEventReader {
    private readonly queue;
    private closed;
    private closePromise;
    pullEvent(timeoutMs?: number): Promise<KEvent | null>;
    pull_event(timeoutMs?: number): Promise<KEvent | null>;
    protected enqueue(event: KEvent): void;
    protected isClosed(): boolean;
    protected markClosed(): void;
    close(): Promise<void>;
    protected abstract closeTransport(): Promise<void>;
}
export declare class KEventClient {
    private readonly mode;
    private readonly streamUrl;
    private readonly nativeHost;
    private readonly nativePort;
    private readonly nativeConnectTimeoutMs;
    private readonly fetcher;
    private readonly sessionTokenProvider;
    private readonly nativeConnector;
    constructor(options: KEventClientOptions);
    createEventReader(patterns: KEventPatternInput, options?: KEventReaderOptions): Promise<KEventReader>;
    create_event_reader(patterns: KEventPatternInput, options?: KEventReaderOptions): Promise<KEventReader>;
    subscribe(patterns: KEventPatternInput, callback: KEventCallback, options?: KEventSubscribeOptions): Promise<KEventSubscription>;
}
//# sourceMappingURL=kevent_client.d.ts.map