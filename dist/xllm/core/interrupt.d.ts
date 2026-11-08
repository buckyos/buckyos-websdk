export declare class AbortState {
    private abortedFlag;
    private finishingFlag;
    private reasonText;
    private readonly controller;
    private abortWaiters;
    private stopWaiters;
    /** Aborts on interrupt (not on a graceful finish). */
    get signal(): AbortSignal;
    set(reason: string): boolean;
    setFinishing(reason: string): boolean;
    isAborted(): boolean;
    isFinishing(): boolean;
    reason(): string | undefined;
    /** Resolves once interrupted. */
    aborted(): Promise<void>;
    /** Resolves once interrupted or finishing. */
    stopping(): Promise<void>;
    private wake;
}
/** The scheduler's handle on a run (`LLMContextInterruptHandle`). */
export declare class LLMContextInterruptHandle {
    private readonly state;
    constructor(state: AbortState);
    static standalone(): LLMContextInterruptHandle;
    interrupt(reason: string): boolean;
    finish(reason: string): boolean;
    reason(): string | undefined;
}
export declare function sleep(ms: number): Promise<void>;
//# sourceMappingURL=interrupt.d.ts.map