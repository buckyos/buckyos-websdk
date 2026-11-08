import type { LLMBehaviorResult, StepDecision, StepRecord } from './types';
/** Checks a parsed step before it takes effect; the error is fed back to the model. */
export declare function validateBehaviorResult(r: LLMBehaviorResult): string | undefined;
/** `handover` / `yield` for a step without actions that does not end; `undefined` otherwise. */
export declare function behaviorDecision(r: LLMBehaviorResult): StepDecision | undefined;
export declare function stepFromResult(r: LLMBehaviorResult): StepRecord;
export declare function resultFromStep(step: StepRecord): LLMBehaviorResult;
export declare function syntheticErrorStep(message: string): StepRecord;
/** A step that only corrects a parse / policy failure. */
export declare function isCorrectionStep(step: StepRecord): boolean;
//# sourceMappingURL=behavior_result.d.ts.map