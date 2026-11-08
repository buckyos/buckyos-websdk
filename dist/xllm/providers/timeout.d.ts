import type { AiResponse, LlmClient, LlmInferenceRequest } from '../core/types';
export declare class TimeoutLlmClient implements LlmClient {
    private readonly inner;
    private readonly timeoutMs;
    private callCount;
    private model;
    constructor(inner: LlmClient, timeoutMs: number);
    calls(): number;
    lastModel(): string | undefined;
    infer(req: LlmInferenceRequest): Promise<AiResponse>;
}
//# sourceMappingURL=timeout.d.ts.map