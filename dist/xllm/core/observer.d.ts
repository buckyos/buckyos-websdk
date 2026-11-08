import type { RunObserver, WorkEvent } from './types';
import type { WorklogSink } from './deps';
export declare const noopObserver: RunObserver;
export declare class ObserverWorklog implements WorklogSink {
    private readonly runId;
    private readonly observer;
    private llmStartedAt;
    private readonly commands;
    constructor(runId: string, observer: RunObserver);
    emit(event: WorkEvent): void;
    private map;
    private takeCommand;
}
//# sourceMappingURL=observer.d.ts.map