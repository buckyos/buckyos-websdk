export declare const RESULT_BUDGET_TOKENS: number;
/** `clip_to_budget` with the 4-bytes-a-token estimate: `[text, clipped]`. */
export declare function clipToBudget(text: string, budget: number, more?: string): [string, boolean];
export declare function clipToDefaultBudget(text: string, more?: string): [string, boolean];
//# sourceMappingURL=text_budget.d.ts.map