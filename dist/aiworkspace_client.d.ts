import type { kRPCClient } from './krpc_client';
export declare const AIWORKSPACE_SERVICE_NAME = "aiworkspace";
/** Business results of the AI Workspace service: `{ ok, ... }`, `{ ok: false, error }`, or a three-state commit result. */
export interface AiwsError {
    code: string;
    retryable: boolean;
    detail: string;
    sub_code?: string;
    data?: unknown;
}
export type AiwsResult<T> = (T & {
    ok: true;
}) | {
    ok: false;
    error: AiwsError;
};
export declare class AiwsFailure extends Error {
    readonly code: string;
    readonly subCode?: string;
    readonly data?: unknown;
    constructor(error: AiwsError);
}
/** A reference object (内核架构改进 D10): where, and which version. */
export interface AiwsReference {
    zone?: string;
    workspace_id?: string;
    entity_id: string;
    selector?: Record<string, unknown>;
    mode: 'live' | 'fixed';
    version?: {
        epoch: string;
        seq: number;
    } | {
        content_root: string;
        path?: string;
    };
}
/** What an executor outside the service reports for a run (M3): results in the Mock executor's shape, or an analysis. */
export interface AiwsRunReport {
    run_id: string;
    attempt: number;
    progress?: Record<string, unknown>;
    error?: {
        code: string;
        detail: string;
    };
    results?: Record<string, unknown>[];
    read_set?: Record<string, unknown>[];
    summary?: string;
    warnings?: string[];
    assumptions?: string[];
    analysis?: Record<string, unknown>;
}
/**
 * kRPC client of the AI Workspace service (`/kapi/aiworkspace`). Every method takes the business result out of
 * `result` and throws `AiwsFailure` on `{ ok: false }`; commits return the three-state result as it is.
 * Stable methods: see `src/frame/aiworkspace/README.md` (Protocol, method levels).
 */
export declare class AiWorkspaceClient {
    private rpcClient;
    constructor(rpcClient: kRPCClient);
    call<T = Record<string, unknown>>(method: string, params: Record<string, unknown>): Promise<T>;
    list(): Promise<Record<string, unknown>>;
    info(workspace_id: string): Promise<Record<string, unknown>>;
    getUserState(workspace_id: string): Promise<Record<string, unknown>>;
    setUserState(workspace_id: string, entries: Record<string, unknown>, expect?: Record<string, number>): Promise<Record<string, unknown>>;
    resolve(workspace_id: string, reference: AiwsReference | Record<string, unknown>): Promise<Record<string, unknown>>;
    resolvePath(workspace_id: string, path: string): Promise<Record<string, unknown>>;
    read(workspace_id: string, entity_id: string, selector?: Record<string, unknown>): Promise<Record<string, unknown>>;
    query(workspace_id: string, params: Record<string, unknown>): Promise<Record<string, unknown>>;
    outline(workspace_id: string): Promise<Record<string, unknown>>;
    prepare(workspace_id: string, request: Record<string, unknown>): Promise<Record<string, unknown>>;
    /** The three-state commit result (`status: accepted | conflict | rejected`), never thrown. */
    commit(workspace_id: string, request: Record<string, unknown>): Promise<Record<string, unknown>>;
    getSubmission(workspace_id: string, epoch: string, idempotency_key: string): Promise<Record<string, unknown>>;
    runStart(workspace_id: string, program: string, params: Record<string, unknown>, idempotency_key: string): Promise<Record<string, unknown>>;
    runGet(workspace_id: string, run_id: string, choices?: Record<string, unknown>): Promise<Record<string, unknown>>;
    runList(workspace_id: string, wish_id?: string, limit?: number): Promise<Record<string, unknown>>;
    runClaim(workspace_id: string, run_id: string, claim_token: string, executor?: Record<string, unknown>): Promise<{
        run_id: string;
        attempt: number;
        run_token: string;
        lease_until: string;
        lease_ms: number;
    }>;
    runHeartbeat(workspace_id: string, run_id: string, attempt: number, progress?: Record<string, unknown>): Promise<Record<string, unknown>>;
    runReport(workspace_id: string, report: AiwsRunReport): Promise<Record<string, unknown>>;
    runApply(workspace_id: string, run_id: string, plan_digest: string, session_id?: string): Promise<Record<string, unknown>>;
    runCancel(workspace_id: string, run_id: string): Promise<Record<string, unknown>>;
}
//# sourceMappingURL=aiworkspace_client.d.ts.map