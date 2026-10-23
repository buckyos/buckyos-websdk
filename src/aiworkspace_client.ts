import type { kRPCClient } from './krpc_client'

export const AIWORKSPACE_SERVICE_NAME = 'aiworkspace'

/** Business results of the AI Workspace service: `{ ok, ... }`, `{ ok: false, error }`, or a three-state commit result. */
export interface AiwsError { code: string; retryable: boolean; detail: string; sub_code?: string; data?: unknown }
export type AiwsResult<T> = (T & { ok: true }) | { ok: false; error: AiwsError }

export class AiwsFailure extends Error {
  readonly code: string
  readonly subCode?: string
  readonly data?: unknown
  constructor(error: AiwsError) {
    super(`${error.code}${error.sub_code ? `/${error.sub_code}` : ''}: ${error.detail}`)
    this.name = 'AiwsFailure'
    this.code = error.code
    this.subCode = error.sub_code
    this.data = error.data
  }
}

/** A reference object (内核架构改进 D10): where, and which version. */
export interface AiwsReference {
  zone?: string
  workspace_id?: string
  entity_id: string
  selector?: Record<string, unknown>
  mode: 'live' | 'fixed'
  version?: { epoch: string; seq: number } | { content_root: string; path?: string }
}

/** What an executor outside the service reports for a run (M3): results in the Mock executor's shape, or an analysis. */
export interface AiwsRunReport {
  run_id: string
  attempt: number
  progress?: Record<string, unknown>
  error?: { code: string; detail: string }
  results?: Record<string, unknown>[]
  read_set?: Record<string, unknown>[]
  summary?: string
  warnings?: string[]
  assumptions?: string[]
  analysis?: Record<string, unknown>
}

/**
 * kRPC client of the AI Workspace service (`/kapi/aiworkspace`). Every method takes the business result out of
 * `result` and throws `AiwsFailure` on `{ ok: false }`; commits return the three-state result as it is.
 * Stable methods: see `src/frame/aiworkspace/README.md` (Protocol, method levels).
 */
export class AiWorkspaceClient {
  constructor(private rpcClient: kRPCClient) {}

  async call<T = Record<string, unknown>>(method: string, params: Record<string, unknown>): Promise<T> {
    const raw = await this.rpcClient.call<AiwsResult<T>, Record<string, unknown>>(method, params)
    if (raw && typeof raw === 'object' && (raw as { ok?: unknown }).ok === false) throw new AiwsFailure((raw as { error: AiwsError }).error)
    return raw as T
  }

  // ---- workspace
  list() { return this.call('ws.list', {}) }
  info(workspace_id: string) { return this.call('ws.get_info', { workspace_id }) }
  getUserState(workspace_id: string) { return this.call('ws.get_user_state', { workspace_id }) }
  setUserState(workspace_id: string, entries: Record<string, unknown>, expect?: Record<string, number>) {
    return this.call('ws.set_user_state', { workspace_id, entries, ...(expect ? { expect } : {}) })
  }

  // ---- document
  resolve(workspace_id: string, reference: AiwsReference | Record<string, unknown>) { return this.call('doc.resolve', { workspace_id, reference }) }
  resolvePath(workspace_id: string, path: string) { return this.call('doc.resolve', { workspace_id, path }) }
  read(workspace_id: string, entity_id: string, selector?: Record<string, unknown>) {
    return this.call('doc.read', { workspace_id, entity_id, ...(selector ? { selector } : {}) })
  }
  query(workspace_id: string, params: Record<string, unknown>) { return this.call('doc.query', { workspace_id, ...params }) }
  outline(workspace_id: string) { return this.call('doc.outline', { workspace_id }) }
  prepare(workspace_id: string, request: Record<string, unknown>) {
    return this.rpcClient.call<Record<string, unknown>, Record<string, unknown>>('doc.prepare', { workspace_id, ...request })
  }
  /** The three-state commit result (`status: accepted | conflict | rejected`), never thrown. */
  commit(workspace_id: string, request: Record<string, unknown>) {
    return this.rpcClient.call<Record<string, unknown>, Record<string, unknown>>('doc.commit', { workspace_id, ...request })
  }
  getSubmission(workspace_id: string, epoch: string, idempotency_key: string) { return this.call('doc.get_submission', { workspace_id, epoch, idempotency_key }) }

  // ---- runs (M3 executor protocol)
  runStart(workspace_id: string, program: string, params: Record<string, unknown>, idempotency_key: string) {
    return this.call('proc.start', { workspace_id, program, params, idempotency_key })
  }
  runGet(workspace_id: string, run_id: string, choices?: Record<string, unknown>) {
    return this.call('proc.get', { workspace_id, run_id, ...(choices ? { choices } : {}) })
  }
  runList(workspace_id: string, wish_id?: string, limit?: number) {
    return this.call('proc.list', { workspace_id, ...(wish_id ? { wish_id } : {}), ...(limit ? { limit } : {}) })
  }
  runClaim(workspace_id: string, run_id: string, claim_token: string, executor?: Record<string, unknown>) {
    return this.call<{ run_id: string; attempt: number; run_token: string; lease_until: string; lease_ms: number }>('proc.claim', { workspace_id, run_id, claim_token, ...(executor ? { executor } : {}) })
  }
  runHeartbeat(workspace_id: string, run_id: string, attempt: number, progress?: Record<string, unknown>) {
    return this.call('proc.heartbeat', { workspace_id, run_id, attempt, ...(progress ? { progress } : {}) })
  }
  runReport(workspace_id: string, report: AiwsRunReport) { return this.call('proc.report', { workspace_id, ...report }) }
  runApply(workspace_id: string, run_id: string, plan_digest: string, session_id?: string) {
    return this.call('proc.apply', { workspace_id, run_id, plan_digest, ...(session_id ? { session_id } : {}) })
  }
  runCancel(workspace_id: string, run_id: string) { return this.call('proc.cancel', { workspace_id, run_id }) }
}
