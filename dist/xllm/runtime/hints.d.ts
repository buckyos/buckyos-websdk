import type { AgentToolResult } from './tool_result';
export declare const HINT_NS_ONCE = "once";
export declare const HINT_NS_DEDUP = "dedup";
export interface HintLedger {
    /** The call that showed `key` (`''` when unknown); `undefined`: not shown. */
    origin(ns: string, key: string): string | undefined;
    seen(ns: string, key: string): boolean;
    mark(ns: string, key: string, origin: string): void;
    clear(ns: string): void;
    keys(ns: string): string[];
}
export declare class MemoryHintLedger implements HintLedger {
    private readonly inner;
    static seeded(ns: string, keys: Iterable<string>): MemoryHintLedger;
    origin(ns: string, key: string): string | undefined;
    seen(ns: string, key: string): boolean;
    mark(ns: string, key: string, origin: string): void;
    clear(ns: string): void;
    keys(ns: string): string[];
}
/** `dedup_text`: what replaces a result shown in full before by call `origin`. */
export declare function dedupText(hint: string, origin: string): string;
/** Apply the ledger to the result of call `callId` (mutated): dedup replacement, `once` filtering; returns the hint texts to show. */
export declare function applyHints(result: AgentToolResult, ledger: HintLedger, callId: string): string[];
export declare function renderHintBlock(hints: string[]): string;
/** The result text with the hints after it (`<output>` / `<runtime_hints>`). */
export declare function renderWithHints(text: string, hints: string[]): string;
//# sourceMappingURL=hints.d.ts.map