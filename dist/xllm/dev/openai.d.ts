import type { AiMessage, AiResponse, JsonValue, LlmClient, LlmInferenceRequest, ProviderFailure } from '../core/types';
/** Failure class of a non-2xx response (Rust `openai_http_failure` after T2-0). */
export declare function openaiHttpFailure(status: number, body: string): ProviderFailure;
export declare function messagesToOpenai(messages: AiMessage[]): JsonValue[];
export interface OpenAiLlmOptions {
    baseUrl?: string;
    apiKey: string;
    headers?: Record<string, string>;
    fetch?: typeof fetch;
}
export declare class OpenAiLlmClient implements LlmClient {
    private readonly options;
    private readonly baseUrl;
    constructor(options: OpenAiLlmOptions);
    infer(req: LlmInferenceRequest): Promise<AiResponse>;
}
//# sourceMappingURL=openai.d.ts.map