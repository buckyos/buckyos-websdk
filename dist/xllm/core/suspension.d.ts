import type { AiContent, AiMessage, LLMContextRequest, LLMContextSnapshot, LLMContextState, ResumeFill, StepRecord } from './types';
export declare function hasContinuation(state: LLMContextState): boolean;
export declare function applyFill(request: LLMContextRequest, state: LLMContextState, fill: ResumeFill, behavior: boolean, nowMs: number): void;
/** Messages of `accumulated` after `request.input` (the inner transcript of a behavior step). */
export declare function innerTranscriptOf(request: LLMContextRequest, state: LLMContextState): AiMessage[];
export declare function unansweredToolCalls(messages: AiMessage[]): string[];
export declare function checkPaired(messages: AiMessage[]): void;
export declare function isThinking(part: AiContent): boolean;
/** Thinking blocks are only valid under the prefix they were produced with; a rewritten history drops them. */
export declare function stripThinking(messages: AiMessage[]): AiMessage[];
export declare function stripStepThinking(step: StepRecord): void;
export declare function stripSnapshotThinking(snapshot: LLMContextSnapshot): void;
//# sourceMappingURL=suspension.d.ts.map