export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
/** Weekdays as RRULE writes them; index 0 is Monday. */
export declare const WEEKDAYS: readonly ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
export type Weekday = (typeof WEEKDAYS)[number];
export interface ByDay {
    weekday: number;
    ordinal?: number;
}
export interface RRule {
    freq: Freq;
    interval: number;
    count?: number;
    /** `YYYY-MM-DD` (a date) or an ISO UTC instant. */
    until?: string;
    byDay?: ByDay[];
    byMonthDay?: number[];
    byMonth?: number[];
    bySetPos?: number;
    /** Week start, 0 = Monday (the default). */
    wkst: number;
}
export declare class RRuleError extends Error {
    constructor(message: string);
}
/** Parse a rule of the subset (an optional `RRULE:` prefix is accepted). Throws `RRuleError` naming the part. */
export declare function parseRRule(text: string): RRule;
/** The rule as RRULE text, parts in a fixed order. */
export declare function formatRRule(rule: RRule): string;
export declare function isDate(s: string): boolean;
export declare const isLeap: (y: number) => boolean;
export declare function daysInMonth(y: number, m: number): number;
export declare const dayNumber: (y: number, m: number, d: number) => number;
export declare function dayOf(date: string): number;
export declare function dateOf(day: number): string;
export declare function ymdOf(day: number): {
    y: number;
    m: number;
    d: number;
};
/** Weekday of a day number, 0 = Monday. */
export declare const weekdayOf: (day: number) => number;
/** Is `tz` a time zone this runtime knows? */
export declare function isTimeZone(tz: string): boolean;
/** The wall clock of `ms` in `tz`. */
export declare function zonedParts(ms: number, tz: string): {
    y: number;
    m: number;
    d: number;
    h: number;
    mi: number;
    s: number;
};
/** The instant of a wall clock in `tz` (a time skipped by a clock change moves forward by the change). */
export declare function zonedToUtc(day: number, minuteOfDay: number, secondOfMinute: number, tz: string): number;
/** The local date (day number) of an instant in `tz`. */
export declare function localDay(ms: number, tz: string): number;
/** Where a series starts: an all-day date, or an instant with the zone it repeats in. */
export type SeriesStart = {
    kind: 'date';
    date: string;
} | {
    kind: 'datetime';
    utc: string;
    tz: string;
};
export interface Occurrence {
    /** The occurrence's identity within its series: its original start as the event writes it (a date, or an ISO UTC instant). */
    original: string;
    /** All-day: the date. */
    date?: string;
    /** Timed: the instant (ms). */
    startMs?: number;
}
export interface ExpandOptions {
    /** Originals excluded from the series (`ext.exdate`). */
    exdate?: readonly string[];
    /** Length of one occurrence (timed: ms, all-day: days − 1), so one that started before the window but overlaps it is kept. */
    durationMs?: number;
    durationDays?: number;
    /** The viewer's zone: all-day occurrences are dates on the viewer's calendar. Default UTC. */
    viewerTz?: string;
    /** At most this many occurrences (default 2000). */
    limit?: number;
}
/** The occurrences of a series overlapping the window `[fromMs, toMs)`, in order. DTSTART is always the first
 * occurrence (as mainstream calendars show it), counted by COUNT. Excluded originals (EXDATE) are left out but still
 * counted, as RFC 5545 says. */
export declare function expandSeries(rule: RRule, start: SeriesStart, window: {
    fromMs: number;
    toMs: number;
}, opts?: ExpandOptions): Occurrence[];
/** The series of an event record's values (`start` / `start_date`, `ext.tz`), or null when it does not repeat. */
export declare function seriesStartOf(values: {
    all_day?: unknown;
    start?: unknown;
    start_date?: unknown;
}, tz: string | undefined, fallbackTz?: string): SeriesStart | null;
/** The original of the occurrence that starts at `ms` (timed) or on `date` (all-day): its identity in `ext.exdate` /
 * `ext.recurrence_id.original`. */
export declare function originalOf(occ: {
    date?: string;
    startMs?: number;
}): string;
/** `<record_id>@<original>`: an occurrence's id, apart from where it is planned (D4 §5.5). */
export declare function occurrenceId(recordId: string, original: string): string;
export declare function parseOccurrenceId(id: string): {
    recordId: string;
    original: string | null;
};
export type RecurrenceLocale = 'zh' | 'en';
/** A sentence for a rule ("每个工作日", "每月最后一个周五", "every 2 weeks on Monday, Wednesday, 10 times"). */
export declare function describeRRule(rule: RRule, locale?: RecurrenceLocale): string;
export interface RecurrencePreset {
    id: 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly_day' | 'monthly_nth' | 'monthly_last' | 'yearly';
    label: string;
    /** null: does not repeat. */
    rrule: string | null;
}
/** The choices of a mainstream calendar's "repeat" menu for an event starting on `date` (`YYYY-MM-DD`, local). */
export declare function recurrencePresets(date: string, locale?: RecurrenceLocale): RecurrencePreset[];
//# sourceMappingURL=aiws_rrule.d.ts.map