import type { AiMessage, ContextLimitKind, LLMContextRequest, LlmInferenceRequest, Tokenizer } from './types';
export declare const MESSAGE_OVERHEAD_TOKENS = 4;
export declare const MEDIA_PART_TOKENS = 1024;
export interface ContextLimits {
    threshold?: number;
    window?: number;
    reserve: number;
}
/** The limits of `request`, or an error message for an invalid configuration. */
export declare function contextLimitsOf(request: LLMContextRequest): ContextLimits | string;
export declare function limitsActive(l: ContextLimits): boolean;
export declare function checkLimits(l: ContextLimits, estimated: number): ContextLimitKind | undefined;
export declare function estimateMessages(tok: Tokenizer, messages: AiMessage[]): number;
export declare function estimateRequest(tok: Tokenizer, req: LlmInferenceRequest): number;
//# sourceMappingURL=context_window.d.ts.map