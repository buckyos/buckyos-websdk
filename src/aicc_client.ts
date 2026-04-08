import { kRPCClient, RPCError } from './krpc_client'

// AICC (AI Compute Center) client.
//
// Mirrors ../../buckyos/src/kernel/buckyos-api/src/aicc_client.rs.
// The Rust client carries large structured request/response types
// (Capability / ResourceRef / AiPayload / Requirements / ...). On the JS side
// we keep these as pass-through structural types so callers can populate
// them with the same JSON shapes that the Rust server already accepts via
// serde — we deliberately do NOT re-define every nested struct, since that
// would just create drift with no extra safety (the wire format is JSON
// either way).

export const AICC_SERVICE_NAME = 'aicc'

export type AiccCapability =
  | 'llm_router'
  | 'text2_image'
  | 'text2_video'
  | 'text2_voice'
  | 'image2_text'
  | 'voice2_text'
  | 'video2_text'

export type AiccCompleteStatus = 'succeeded' | 'running' | 'failed'

export interface AiccModelSpec {
  alias: string
  provider_model_hint?: string
}

export interface AiccRequirements {
  must_features?: string[]
  max_latency_ms?: number
  max_cost_usd?: number
  resp_foramt?: 'text' | 'json'
  extra?: unknown
}

export interface AiccMessage {
  role: string
  content: string
}

export interface AiccPayload {
  text?: string
  messages?: AiccMessage[]
  tool_specs?: unknown[]
  resources?: unknown[]
  input_json?: unknown
  options?: unknown
}

export interface AiccCompleteTaskOptions {
  parent_id?: number
}

export interface AiccCompleteRequest {
  capability: AiccCapability
  model: AiccModelSpec
  requirements: AiccRequirements
  payload: AiccPayload
  idempotency_key?: string
  task_options?: AiccCompleteTaskOptions
}

export interface AiccUsage {
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
}

export interface AiccCost {
  amount: number
  currency: string
}

export interface AiccResponseSummary {
  text?: string
  tool_calls?: unknown[]
  artifacts?: unknown[]
  usage?: AiccUsage
  cost?: AiccCost
  finish_reason?: string
  provider_task_ref?: string
  extra?: unknown
}

export interface AiccCompleteResponse {
  task_id: string
  status: AiccCompleteStatus
  result?: AiccResponseSummary
  event_ref?: string
}

export interface AiccCancelResponse {
  task_id: string
  accepted: boolean
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RPCError('Invalid RPC response format')
  }
  return value as Record<string, unknown>
}

export class AiccClient {
  private rpcClient: kRPCClient

  constructor(rpcClient: kRPCClient) {
    this.rpcClient = rpcClient
  }

  setSeq(seq: number) {
    this.rpcClient.setSeq(seq)
  }

  async complete(request: AiccCompleteRequest): Promise<AiccCompleteResponse> {
    if (!request.capability) {
      throw new RPCError('AiccCompleteRequest.capability is required')
    }
    if (!request.model || !request.model.alias) {
      throw new RPCError('AiccCompleteRequest.model.alias is required')
    }
    const result = await this.rpcClient.call<unknown, AiccCompleteRequest>('complete', request)
    const record = asRecord(result)
    if (typeof record.task_id !== 'string') {
      throw new RPCError('AiccCompleteResponse missing task_id')
    }
    if (typeof record.status !== 'string') {
      throw new RPCError('AiccCompleteResponse missing status')
    }
    return record as unknown as AiccCompleteResponse
  }

  async cancel(taskId: string): Promise<AiccCancelResponse> {
    if (!taskId) {
      throw new RPCError('AiccClient.cancel requires a non-empty task_id')
    }
    const result = await this.rpcClient.call<unknown, { task_id: string }>('cancel', { task_id: taskId })
    const record = asRecord(result)
    if (typeof record.task_id !== 'string' || typeof record.accepted !== 'boolean') {
      throw new RPCError('Invalid cancel response')
    }
    return { task_id: record.task_id, accepted: record.accepted }
  }
}
