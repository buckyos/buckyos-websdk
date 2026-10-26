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
    query(locator: ExecutorOperationLocator, channel?: 'stdout' | 'stderr' | 'content', offset?: number, wait_ms?: number): Promise<ExecutorReply>;
    cancel(locator: ExecutorOperationLocator): Promise<ExecutorReply>;
}
//# sourceMappingURL=executor_client.d.ts.map