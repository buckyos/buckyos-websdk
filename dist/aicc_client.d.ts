import { kRPCClient } from './krpc_client';
export declare const AICC_SERVICE_NAME = "aicc";
export type AiccCapability = 'llm_router' | 'text2_image' | 'text2_video' | 'text2_voice' | 'image2_text' | 'voice2_text' | 'video2_text';
export type AiccCompleteStatus = 'succeeded' | 'running' | 'failed';
export interface AiccModelSpec {
    alias: string;
    provider_model_hint?: string;
}
export interface AiccRequirements {
    must_features?: string[];
    max_latency_ms?: number;
    max_cost_usd?: number;
    resp_foramt?: 'text' | 'json';
    extra?: unknown;
}
export interface AiccMessage {
    role: string;
    content: string;
}
export interface AiccPayload {
    text?: string;
    messages?: AiccMessage[];
    tool_specs?: unknown[];
    resources?: unknown[];
    input_json?: unknown;
    options?: unknown;
}
export interface AiccCompleteTaskOptions {
    parent_id?: number;
}
export interface AiccCompleteRequest {
    capability: AiccCapability;
    model: AiccModelSpec;
    requirements: AiccRequirements;
    payload: AiccPayload;
    idempotency_key?: string;
    task_options?: AiccCompleteTaskOptions;
}
export interface AiccUsage {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
}
export interface AiccCost {
    amount: number;
    currency: string;
}
export interface AiccResponseSummary {
    text?: string;
    tool_calls?: unknown[];
    artifacts?: unknown[];
    usage?: AiccUsage;
    cost?: AiccCost;
    finish_reason?: string;
    provider_task_ref?: string;
    extra?: unknown;
}
export interface AiccCompleteResponse {
    task_id: string;
    status: AiccCompleteStatus;
    result?: AiccResponseSummary;
    event_ref?: string;
}
export interface AiccCancelResponse {
    task_id: string;
    accepted: boolean;
}
export declare class AiccClient {
    private rpcClient;
    constructor(rpcClient: kRPCClient);
    setSeq(seq: number): void;
    complete(request: AiccCompleteRequest): Promise<AiccCompleteResponse>;
    cancel(taskId: string): Promise<AiccCancelResponse>;
}
//# sourceMappingURL=aicc_client.d.ts.map