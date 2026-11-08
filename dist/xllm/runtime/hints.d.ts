import type { AgentToolResult } from './tool_result';
export declare const HINT_NS_ONCE = "once";
export declare const HINT_NS_DEDUP = "dedup";
export interface HintLedger {
    seen(ns: string, key: string): boolean;
    mark(ns: string, key: string): void;
    clear(ns: string): void;
    keys(ns: string): string[];
}
export declare class MemoryHintLedger implements HintLedger {
    private readonly inner;
    static seeded(ns: string, keys: Iterable<string>): MemoryHintLedger;
    seen(ns: string, key: string): boolean;
    mark(ns: string, key: string): void;
    clear(ns: string): void;
    keys(ns: string): string[];
}
/** Apply the ledger to `result` (mutated): dedup replacement, `once` filtering; returns the hint texts to show. */
export declare function applyHints(result: AgentToolResult, ledger: HintLedger): string[];
export declare function renderHintBlock(hints: string[]): string;
/** The result text with the hints after it (`<output>` / `<runtime_hints>`). */
export declare function renderWithHints(text: string, hints: string[]): string;
//# sourceMappingURL=hints.d.ts.map