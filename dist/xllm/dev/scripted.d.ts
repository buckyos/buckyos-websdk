import type { AiMessage, AiResponse, AiToolCall, AiUsage, LLMComputeError, LlmClient, LlmInferenceRequest } from '../core/types';
export interface ScriptedCall {
    name: string;
    args?: AiToolCall['args'];
    /** Default `call_<reply#>_<n>`. */
    call_id?: string;
}
export type ScriptedReply = {
    text?: string;
    tool_calls?: ScriptedCall[];
    usage?: AiUsage;
} | {
    message: AiMessage;
    usage?: AiUsage;
} | {
    error: LLMComputeError;
}
/** Never resolves (until the request signal aborts): an inference in flight. */
 | {
    hang: true;
}
/** Resolves after `ms` with `then`. */
 | {
    delay_ms: number;
    then: ScriptedReply;
};
export type ScriptedStep = ScriptedReply | ((req: LlmInferenceRequest, index: number) => ScriptedReply | Promise<ScriptedReply>);
export interface ScriptedLlmOptions {
    /** Reply when the script is exhausted (default: an `internal` error). */
    fallback?: ScriptedReply;
    /** Usage reported for every reply without its own (default `{ total_tokens: 10, request_units: 1 }`). */
    usage?: AiUsage;
}
export declare class ScriptedLlmClient implements LlmClient {
    private readonly script;
    private readonly options;
    /** Every request received, in order. */
    readonly requests: LlmInferenceRequest[];
    private index;
    constructor(script: ScriptedStep[], options?: ScriptedLlmOptions);
    /** Number of inferences requested so far. */
    get calls(): number;
    infer(req: LlmInferenceRequest): Promise<AiResponse>;
    private play;
}
//# sourceMappingURL=scripted.d.ts.map