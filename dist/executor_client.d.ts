import { KRPCClientOptions } from './krpc_client';
export type ExecutorOperation = 'open_stream' | 'describe' | 'exec' | 'read' | 'write' | 'edit' | 'mkdir' | 'stat' | 'rename' | 'remove' | 'computer_inspect' | 'computer_observe' | 'computer_act' | 'query' | 'cancel';
export interface ExecutorProfile {
    run_as?: {
        uid: number;
        gid: number;
    };
    workdir_roots: string[];
    env?: Record<string, string>;
    principals: string[];
    ops: ExecutorOperation[];
}
export interface ExecutorDevice {
    executor_id: string;
    name: string;
    owner_user_id: string;
    enabled: boolean;
    expires_at_ms: number | null;
    generation: number;
    profiles: Record<string, ExecutorProfile>;
    limits: Record<string, number>;
    created_at_ms: number;
}
export interface ExecutorOnlineTarget {
    executor_id: string;
    name: string;
    generation: number;
    store_id: string;
    profiles: string[];
    capabilities: Record<string, unknown>;
    expires_at_ms: number | null;
}
export interface ExecutorTarget {
    executor_id: string;
    generation: number;
    profile_id: string;
    store_id: string;
}
export interface ExecutorRoute {
    executor_id: string;
    generation: number;
    profile_id: string;
    stream_id: string;
    ws_url: string;
    ticket: string;
    expires_at_ms: number;
}
export interface ExecutorAccess {
    device: ExecutorDevice;
    access_url: string;
    start_command: string;
}
export interface ExecutorOperationLocator extends ExecutorTarget {
    op_id: string;
    run_id: string;
    call_id: string;
}
export interface ExecutorReply {
    type: string;
    request_id?: string;
    store_id?: string;
    op?: {
        state: string;
        [key: string]: unknown;
    };
    chunk?: {
        data_b64: string;
        offset: number;
        eof: boolean;
    } | null;
    error?: {
        code: string;
        message: string;
        effect_unknown?: boolean;
    };
    [key: string]: unknown;
}
export declare const COMPUTER_SEMANTIC_FORMAT = "outline-v1";
export declare const COMPUTER_ROLES: readonly ["window", "dialog", "document", "group", "toolbar", "heading", "button", "link", "tab", "tablist", "menu", "menubar", "menuitem", "checkbox", "radio", "switch", "textbox", "combobox", "slider", "list", "listitem", "tree", "treeitem", "table", "row", "cell", "image", "text", "generic"];
export declare const COMPUTER_ELEMENT_STATES: readonly ["disabled", "focused", "selected", "checked", "mixed", "expanded", "collapsed", "readonly"];
export declare const COMPUTER_ELEMENT_ACTIONS: readonly ["focus", "invoke", "set_value", "toggle", "select", "expand", "collapse", "scroll_into_view"];
export type ComputerRole = typeof COMPUTER_ROLES[number];
export type ComputerElementState = typeof COMPUTER_ELEMENT_STATES[number];
export type ComputerElementAction = typeof COMPUTER_ELEMENT_ACTIONS[number];
export type ComputerObservationMode = 'visual' | 'auto' | 'semantic' | 'hybrid';
export type ComputerTarget = {
    kind: 'point';
    observation_id: string;
    x: number;
    y: number;
    space: 'screenshot';
} | {
    kind: 'focus';
    observation_id: string;
} | {
    kind: 'element';
    observation_id: string;
    ref: string;
};
export type ComputerObserveScope = {
    kind: 'foreground';
} | {
    kind: 'window';
    observation_id: string;
    ref: string;
};
interface ComputerActionOptions {
    binding_id: string;
    target: ComputerTarget;
    feedback?: 'after' | 'none';
    feedback_mode?: ComputerObservationMode;
    execution_timeout_ms?: number;
}
export type ComputerRequest = {
    command: 'inspect';
    binding_id: string;
} | {
    command: 'observe';
    binding_id: string;
    mode?: ComputerObservationMode;
    scope?: ComputerObserveScope;
} | ({
    command: 'click';
    button?: 'left' | 'right' | 'middle';
    count?: 1 | 2;
    modifiers?: string[];
} & ComputerActionOptions) | ({
    command: 'type';
    text: string;
    delivery?: 'text' | 'keys';
} & ComputerActionOptions) | ({
    command: 'keypress';
    keys: string[];
} & ComputerActionOptions) | ({
    command: 'scroll';
    delta_x: number;
    delta_y: number;
    unit: 'pixel' | 'line';
} & ComputerActionOptions) | ({
    command: 'wait_for';
    condition: {
        kind: 'delay';
        duration_ms: number;
    };
} & ComputerActionOptions) | ({
    command: 'invoke' | 'toggle' | 'select' | 'expand' | 'collapse';
} & ComputerActionOptions) | ({
    command: 'set_value';
    value: string;
} & ComputerActionOptions);
export interface ComputerBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface ComputerWindow {
    ref: string;
    title: string;
    process: string;
    pid: number;
    bounds: ComputerBounds;
    foreground: boolean;
    accessible: boolean;
}
export interface ComputerSemantic {
    format: typeof COMPUTER_SEMANTIC_FORMAT;
    text: string;
    windows: ComputerWindow[];
    coverage: {
        visited: number;
        returned: number;
        truncated: boolean;
        reason?: string;
    };
    captured_at_ms: number;
}
export interface ComputerScreenshot {
    artifact_ref: string;
    mime_type: string;
    width: number;
    height: number;
    space: 'screenshot';
    interactive: boolean;
    captured_at_ms: number;
}
export interface ComputerObservation {
    observation_id: string;
    binding_id: string;
    surface_id: string;
    surface_epoch: number;
    interaction_revision: number;
    requested_mode: ComputerObservationMode;
    effective_mode: ComputerObservationMode;
    selection_reason: string;
    capture_started_at_ms: number;
    capture_completed_at_ms: number;
    consistency: string;
    screenshot?: ComputerScreenshot;
    semantic?: ComputerSemantic;
    focus_guard: string;
    expires_at_ms: number;
    warnings: string[];
}
export declare class ExecutorClient {
    private readonly rpc;
    constructor(serviceUrl: string, token?: string | null, options?: KRPCClientOptions);
    syncSessionToken(token: string | null): void;
    createDevice(input: {
        name: string;
        profiles: Record<string, ExecutorProfile>;
        limits?: Record<string, number>;
        expires_at_ms?: number;
    }): Promise<ExecutorAccess>;
    listDevices(): Promise<{
        devices: Array<{
            device: ExecutorDevice;
            online: ExecutorOnlineTarget | null;
        }>;
    }>;
    issueAccess(executor_id: string, expires_at_ms?: number): Promise<ExecutorAccess>;
    revokeAccess(executor_id: string): Promise<Record<string, never>>;
    deleteDevice(executor_id: string): Promise<Record<string, never>>;
    listOnline(): Promise<{
        executors: ExecutorOnlineTarget[];
    }>;
    watchOnline(signal?: AbortSignal, intervalMs?: number): AsyncGenerator<ExecutorOnlineTarget[]>;
    openRoute(target: ExecutorTarget): Promise<ExecutorRoute>;
    connect(target: ExecutorTarget, sessionToken: string, runtimeId: string, runId: string): Promise<ExecutorCommandStream>;
}
export declare class ExecutorStreamError extends Error {
    readonly code: string;
    readonly effectUnknown: boolean;
    constructor(message: string, code?: string, effectUnknown?: boolean);
}
export declare function encodeExecutorControl(message: Record<string, unknown>): Uint8Array;
export declare class ExecutorCommandStream {
    private readonly socket;
    readonly target: ExecutorTarget;
    readonly runId: string;
    private buffer;
    private sequence;
    private readonly pending;
    private closed;
    private constructor();
    static connect(route: ExecutorRoute, target: ExecutorTarget, token: string, runtimeId: string, runId: string): Promise<ExecutorCommandStream>;
    private receive;
    private fail;
    close(): void;
    request(type: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<ExecutorReply>;
    private operation;
    private fresh;
    describe(workdir?: string): Promise<ExecutorReply>;
    exec(locator: ExecutorOperationLocator, cmd: string, cwd: string, env_overrides?: Record<string, string>, execution_timeout_ms?: number): Promise<ExecutorReply>;
    read(locator: ExecutorOperationLocator, path: string): Promise<ExecutorReply>;
    edit(locator: ExecutorOperationLocator, path: string, edits: Array<{
        old_string: string;
        new_string: string;
        replace_all?: boolean;
    }>): Promise<ExecutorReply>;
    write(locator: ExecutorOperationLocator, path: string, content: Uint8Array, mode?: 'replace' | 'append' | 'create_new'): Promise<ExecutorReply>;
    computer(locator: ExecutorOperationLocator, request: ComputerRequest): Promise<ExecutorReply>;
    query(locator: ExecutorOperationLocator, channel?: 'stdout' | 'stderr' | 'content', offset?: number, wait_ms?: number): Promise<ExecutorReply>;
    cancel(locator: ExecutorOperationLocator): Promise<ExecutorReply>;
}
export {};
//# sourceMappingURL=executor_client.d.ts.map