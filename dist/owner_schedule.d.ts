import { type Json } from './aiws_schedule';
type Slot = 'calendar' | 'todo';
type Params = Record<string, Json | undefined>;
interface Invocation {
    idempotency_key?: string;
    method: string;
    params: Params;
}
interface Host {
    context: {
        owner_did: string;
        zone_did: string;
        tz?: string;
    };
    call<T>(method: string, params: Record<string, unknown>): Promise<T>;
}
export declare function instant(value: Json | undefined, field: string): number;
export declare function scheduleAction(slot: Slot, request: Invocation, host: Host): Promise<{
    result: unknown;
    error?: undefined;
} | {
    error: {
        code: string;
        message: string;
        details: {} | null;
    };
    result?: undefined;
}>;
export {};
//# sourceMappingURL=owner_schedule.d.ts.map