import { type RowLike } from './aiws_schedule';
export declare function freeBusy(input: {
    rows: RowLike[];
    from: string;
    to: string;
    tz?: string;
    truncated?: boolean;
}): {
    intervals: {
        start: string;
        end: string;
    }[];
    coverage: string;
};
//# sourceMappingURL=owner_availability.d.ts.map