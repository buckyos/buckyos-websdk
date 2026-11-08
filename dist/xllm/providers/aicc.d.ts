import type { AiccClient, AiccError } from '../../aicc_client';
import type { AiResponse, JsonValue, LlmClient, LlmInferenceRequest, ProviderFailure } from '../core/types';
import { LLMComputeException } from '../core/errors';
export declare const REFUSED_QUOTA_EXHAUSTED = "quota_exhausted";
export declare const REFUSED_QUOTA_BUDGET_EXCEEDED = "quota_budget_exceeded";
export declare const REFUSED_RESOURCE_NOT_PERMITTED = "resource_not_permitted";
export declare const REFUSED_ATTRIBUTION_UNAVAILABLE = "attribution_unavailable";
/** The service refused the caller's credentials: sign in again, then resume. */
export declare const REFUSED_CREDENTIALS = "credentials";
/** `force_json` without a schema: any JSON object (a bare `{"type":"object"}` gets `{}` from Gemini). */
export declare function anyJsonObjectSchema(): JsonValue;
/** Failure class of an AICC error, `undefined` when the error does not say. */
export declare function aiccProviderFailure(error: Partial<AiccError>): ProviderFailure | undefined;
/** A failed AICC call (a rejected kRPC call) as a provider error. */
export declare function providerErrorFromRpc(context: string, err: unknown): LLMComputeException;
/** `LlmClient` over the page's AICC client. */
export declare class AiccLlmClient implements LlmClient {
    private readonly client;
    constructor(client: AiccClient);
    infer(req: LlmInferenceRequest): Promise<AiResponse>;
}
//# sourceMappingURL=aicc.d.ts.map