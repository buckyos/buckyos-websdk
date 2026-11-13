export declare const TODO_SCHEMA_ID = "buckyos.todo@1";
export declare const CALENDAR_SCHEMA_ID = "buckyos.calendar@1";
export declare const SCHEDULE_WORKSPACE_NAME = "schedule";
export declare const SCHEDULE_TODO_ID = "todo";
export declare const SCHEDULE_CALENDAR_ID = "calendar";
export declare const SCHEDULE_SURFACE_ID = "schedule-board";
export declare const TODO_DONE = "done";
export declare const AIWS_PROTOCOL_VERSION = "1.2";
export type Json = null | boolean | number | string | Json[] | {
    [key: string]: Json;
};
export type Op = Record<string, Json>;
export type ScheduleLocale = 'zh' | 'en';
export interface FieldDef {
    field_id: string;
    name: string;
    type: string;
    required?: boolean;
    nullable?: boolean;
    options?: {
        option_id: string;
        label: string;
    }[];
}
export declare function scheduleLabel(locale: ScheduleLocale, key: string): string;
/** The standard fields of a to-do table (`buckyos.todo@1`). */
export declare function todoFields(locale?: ScheduleLocale): FieldDef[];
/** The standard fields of a calendar table (`buckyos.calendar@1`). */
export declare function calendarFields(locale?: ScheduleLocale): FieldDef[];
/** `entity.create` of a standard table. */
export declare function standardTableOp(kind: 'todo' | 'calendar', args: {
    entity_id: string;
    parent_id: string;
    order_key: string;
    name?: string;
    locale?: ScheduleLocale;
}): Op;
export declare function isOrderKey(k: unknown): k is string;
/** A key strictly between `a` and `b` (null: open end), as the core computes it. */
export declare function orderKeyBetween(a?: string | null, b?: string | null): string;
/** `count` keys spread between `a` and `b`, in order. */
export declare function orderKeysBetween(a: string | null, b: string | null, count: number): string[];
/** A record as `doc.read` (`table_record`) and the SQL `_record` column answer it. */
export interface RowLike {
    record_id: string;
    rev?: number;
    revs?: Record<string, number>;
    values: Record<string, Json | undefined>;
    /** The record's rich-text body (notes), when it has one. */
    body_ref?: {
        entity_id: string;
    };
}
/** A record id: `r` + time + a counter + randomness (lower case, ≤ 64). */
export declare function newRecordId(prefix?: string): string;
/** `table.set_values` / `table.unset_values` of `changes` (null or undefined unsets), each cell expected at the rev the
 * row was read with — the core requires it: concurrent writers of other cells merge, the same cell conflicts. */
export declare function setValuesOps(sourceId: string, row: RowLike, changes: Record<string, Json | undefined>): Op[];
export declare function insertRecordOp(sourceId: string, records: {
    record_id: string;
    values: Record<string, Json | undefined>;
}[]): Op;
/** `table.delete_records` of rows as read (each expected at its record rev, as the core requires). */
export declare function deleteRecordsOp(sourceId: string, rows: RowLike[]): Op;
/** An original start as the series writes it: a date as it is, an instant as canonical UTC (`ext` keeps what was
 * written, any RFC 3339 offset). */
export declare function canonicalOriginal(x: string): string;
export interface TodoValues {
    title?: string;
    status?: string;
    due?: string | null;
    order?: string | null;
    done_at?: string | null;
    ext?: Record<string, Json> | null;
}
/** A to-do as the controls read it; still the record it came from (`values`, `revs`), so the operations take it. */
export interface TodoItem extends RowLike {
    title: string;
    status: string;
    due: string | null;
    order: string | null;
    done: boolean;
    done_at: string | null;
    ext: Record<string, Json>;
}
export declare function todoItem(row: RowLike): TodoItem;
/** To-do items in list order: by `order`, items without one last (by id, stable). */
export declare function sortTodos<T extends {
    order: string | null;
    record_id: string;
}>(items: T[]): T[];
/** Add a to-do: `order` between its neighbours (`after` / `before` keys, default: at the end of `items`). */
export declare function todoAddOps(sourceId: string, input: TodoValues & {
    title: string;
    record_id?: string;
}, place?: {
    after?: string | null;
    before?: string | null;
    items?: {
        order: string | null;
    }[];
}): {
    record_id: string;
    ops: Op[];
    order: string;
};
/** Complete (or reopen) a to-do: status `done` and `done_at`, or back to `reopenStatus` (default `todo`). */
export declare function todoCompleteOps(sourceId: string, row: RowLike, done: boolean, opts?: {
    now?: string;
    reopenStatus?: string;
}): Op[];
/** Move a to-do: to another status (column) and / or a new place (`order`). Completing by moving to `done` stamps
 * `done_at`, leaving it clears it. */
export declare function todoMoveOps(sourceId: string, row: RowLike, to: {
    status?: string;
    order?: string | null;
}, opts?: {
    now?: string;
}): Op[];
/** Change fields of a to-do (title, due, ext …). `ext` is merged into the stored one (null removes a key). */
export declare function todoUpdateOps(sourceId: string, row: RowLike, changes: TodoValues & {
    ext_merge?: Record<string, Json | null>;
}): Op[];
/** The order key for placing an item at `index` among `items` (sorted, the moved one excluded). */
export declare function orderAt(items: {
    order: string | null;
}[], index: number): string;
export interface EventValues {
    title?: string;
    all_day?: boolean;
    start?: string | null;
    end?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    status?: string | null;
    ext?: Record<string, Json> | null;
}
/** One shown occurrence of an event: a single event, an occurrence of a series, or the record overriding one. */
export interface EventOccurrence {
    /** `record_id`, or `<master>@<original>` for an occurrence of a series. */
    id: string;
    /** The record holding what is shown (the master, or the override). */
    row: RowLike;
    /** The series' master when this is an occurrence of a series. */
    master?: RowLike;
    /** The occurrence's original start (its identity in the series). */
    original?: string;
    title: string;
    allDay: boolean;
    /** Timed: instants (ms). */
    startMs?: number;
    endMs?: number;
    /** All-day: dates, end inclusive. */
    startDate?: string;
    endDate?: string;
    status: string | null;
    ext: Record<string, Json>;
    /** The record repeats (a master or an occurrence of one). */
    recurring: boolean;
    /** The record overrides one occurrence of a series (`ext.recurrence_id`). */
    override: boolean;
    /** Shown from `ext.occurrences` an Agent wrote (a rule the subset cannot express). */
    agentWritten: boolean;
}
/** The date of an instant on a zone's calendar. */
export declare function localDate(ms: number, tz: string): string;
export declare function viewerTimeZone(): string;
/** Every occurrence of the calendar's records overlapping `[fromMs, toMs)`: single events, expanded series (EXDATE
 * removed, overridden occurrences replaced by their override records), and the occurrences an Agent wrote for rules
 * outside the subset. Sorted by start. A series whose rule cannot be read shows its first occurrence only. */
export declare function calendarOccurrences(rows: RowLike[], window: {
    fromMs: number;
    toMs: number;
}, opts?: {
    viewerTz?: string;
    limit?: number;
}): EventOccurrence[];
/** A new event: timed (`start` / `end` ISO) or all-day (`start_date` / `end_date`). */
export declare function eventAddOps(sourceId: string, input: EventValues & {
    title: string;
    record_id?: string;
}): {
    record_id: string;
    ops: Op[];
};
/** When an event happens: timed or all-day. */
export type EventTimes = {
    allDay: false;
    start: string;
    end: string;
} | {
    allDay: true;
    startDate: string;
    endDate: string;
};
/** What an edit of one occurrence changes: its times and / or other fields. */
export interface EventChange {
    times?: EventTimes;
    values?: Omit<EventValues, 'all_day' | 'start' | 'end' | 'start_date' | 'end_date'>;
    /** Keys merged into `ext` (null removes). */
    ext_merge?: Record<string, Json | null>;
    /** A new rule (`null`: stop repeating); only for `all` / `following`. */
    rrule?: string | null;
}
export type RecurrenceScope = 'one' | 'following' | 'all';
export interface CalendarContext {
    /** Every record of the calendar (or at least the series' master and its overrides). */
    rows: RowLike[];
    newRecordId?: () => string;
}
/** The ops of a change of one occurrence of an event (or of a single event): `one` overrides just that occurrence
 * (“仅此一次”), `following` splits the series there (“此后全部”), `all` changes the series (“全部”), shifting its
 * start, its exclusions and its overrides by the same amount. */
export declare function eventEditOps(sourceId: string, occ: Pick<EventOccurrence, 'row' | 'master' | 'original' | 'allDay' | 'startMs' | 'startDate'>, change: EventChange, scope: RecurrenceScope, ctx: CalendarContext): {
    ops: Op[];
    record_id: string;
};
/** Remove one occurrence (“今天不用了”: an exclusion, and its override goes), this and the following ones (the series
 * ends before it), or the whole series with its overrides. A single event is deleted. */
export declare function eventDeleteOps(sourceId: string, occ: Pick<EventOccurrence, 'row' | 'master' | 'original'>, scope: RecurrenceScope, ctx: CalendarContext): Op[];
/** Skip one occurrence (D4: the notification's “skip”). */
export declare const eventSkipOps: (sourceId: string, occ: Pick<EventOccurrence, 'row' | 'master' | 'original'>, ctx: CalendarContext) => Op[];
/** Postpone one occurrence by `minutes` (D4: the notification's “snooze”): an override of that occurrence. */
export declare function eventPostponeOps(sourceId: string, occ: Pick<EventOccurrence, 'row' | 'master' | 'original' | 'allDay' | 'startMs' | 'endMs' | 'startDate' | 'endDate'>, minutes: number, ctx: CalendarContext): {
    ops: Op[];
    record_id: string;
};
export interface ScheduleHandle {
    workspace_id: string;
    epoch: string;
    created: boolean;
    todo: string;
    calendar: string;
}
/** How the schedule talks to the service: one kRPC call whose business failure (`ok: false`) throws — an
 * `AiWorkspaceClient`, or the CLI's service call. */
export interface ScheduleTransport {
    call<T = Record<string, unknown>>(method: string, params: Record<string, unknown>): Promise<T>;
}
/** The person's private schedule (Q5): one Workspace named `schedule`, its to-do table `todo` and calendar table
 * `calendar` (fixed ids), and a page showing both, created the first time. Agents and commands use it by name. */
export declare class ScheduleClient {
    readonly aiws: ScheduleTransport;
    private handle;
    private readonly locale;
    constructor(aiws: ScheduleTransport, opts?: {
        locale?: ScheduleLocale;
    });
    /** The schedule Workspace with its two tables (created when missing; concurrent first uses converge). */
    ensure(): Promise<ScheduleHandle>;
    private commitTo;
    /** Commit operations into the schedule; a refusal or conflict throws with the service's reason. */
    commit(operations: Op[], message: string): Promise<CommitResult>;
    /** Every live record of a table, as `doc.read` answers one (the SQL `_record` column), by record id. */
    rows(sourceId: string): Promise<RowLike[]>;
    row(sourceId: string, recordId: string): Promise<RowLike>;
    todos(opts?: {
        includeDone?: boolean;
    }): Promise<TodoItem[]>;
    addTodo(input: TodoValues & {
        title: string;
    }, place?: {
        after?: string;
        before?: string;
    }): Promise<TodoItem>;
    completeTodo(recordId: string, done?: boolean): Promise<void>;
    updateTodo(recordId: string, changes: TodoValues & {
        ext_merge?: Record<string, Json | null>;
    }): Promise<void>;
    /** Move a to-do before / after another one, and / or into another status. */
    moveTodo(recordId: string, to: {
        status?: string;
        before?: string;
        after?: string;
    }): Promise<void>;
    removeTodos(recordIds: string[]): Promise<void>;
    events(window: {
        fromMs: number;
        toMs: number;
    }, opts?: {
        viewerTz?: string;
    }): Promise<EventOccurrence[]>;
    addEvent(input: EventValues & {
        title: string;
    }): Promise<string>;
    /** The occurrence an id names (`record_id` or `<master>@<original>`), from all rows. */
    occurrence(id: string): Promise<{
        occ: EventOccurrence;
        rows: RowLike[];
    }>;
    editEvent(id: string, change: EventChange, scope?: RecurrenceScope): Promise<string>;
    deleteEvent(id: string, scope?: RecurrenceScope): Promise<void>;
}
export interface CommitResult {
    status: 'accepted' | 'conflict' | 'rejected' | 'saved_locally';
    seq?: number;
    commit_id?: string;
    code?: string;
    sub_code?: string;
    detail?: string;
    errors?: {
        code: string;
        sub_code?: string;
        detail?: string;
    }[];
    error?: {
        code: string;
        sub_code?: string;
        detail: string;
        retryable: boolean;
    };
    conflicts?: {
        selector?: unknown;
        entity_id?: string;
        code?: string;
    }[];
}
/** The occurrence an id names among a calendar's rows: a record id, or `<master>@<original>` (an occurrence of a
 * series, overridden or not). */
export declare function findOccurrence(rows: RowLike[], id: string): EventOccurrence;
/** The schedule page of the private Workspace: a Surface with the calendar and the to-do list side by side. */
export declare function scheduleBoardOps(locale?: ScheduleLocale): Op[];
export { isDate } from './aiws_rrule';
//# sourceMappingURL=aiws_schedule.d.ts.map