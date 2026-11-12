/* The standard to-do and calendar data of AI Workspace (buckyos aiworkspace control mechanism TODO G8–G11): the two
 * table schemas (`buckyos.todo@1`, `buckyos.calendar@1`, the contract is buckyos src/frame/aiworkspace/schemas/
 * standard-tables.md, checked by the core at admission), the operations that read and change them — add, complete,
 * move, reschedule one / following / all occurrences, skip, postpone — and the person's private schedule Workspace
 * (`ws.ensure { name: "schedule" }`, fixed table ids `todo` and `calendar`). The official controls, the Agent commands
 * and notification buttons all use these builders: one meaning per action (07). Pure functions build operations; the
 * `ScheduleClient` at the end commits them over an `AiWorkspaceClient`. */

import { AiwsFailure } from './aiworkspace_client'
import { dayOf, dateOf, expandSeries, formatRRule, isDate, occurrenceId, parseRRule, seriesStartOf, type Occurrence, type RRule } from './aiws_rrule'

export const TODO_SCHEMA_ID = 'buckyos.todo@1'
export const CALENDAR_SCHEMA_ID = 'buckyos.calendar@1'
export const SCHEDULE_WORKSPACE_NAME = 'schedule'
export const SCHEDULE_TODO_ID = 'todo'
export const SCHEDULE_CALENDAR_ID = 'calendar'
export const SCHEDULE_SURFACE_ID = 'schedule-board'
export const TODO_DONE = 'done'
export const AIWS_PROTOCOL_VERSION = '1.1'

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type Op = Record<string, Json>
export type ScheduleLocale = 'zh' | 'en'

export interface FieldDef {
  field_id: string
  name: string
  type: string
  required?: boolean
  nullable?: boolean
  options?: { option_id: string; label: string }[]
}

const LABELS: Record<ScheduleLocale, Record<string, string>> = {
  zh: {
    title: '标题', status: '状态', due: '截止', order: '顺序', done_at: '完成时间', ext: '扩展',
    todo: '待办', doing: '进行中', done: '已完成',
    all_day: '全天', start: '开始', end: '结束', start_date: '开始日期', end_date: '结束日期',
    confirmed: '已确认', tentative: '暂定', cancelled: '已取消',
    todo_table: '待办', calendar_table: '日程', workspace: '我的日程', board: '日程',
  },
  en: {
    title: 'Title', status: 'Status', due: 'Due', order: 'Order', done_at: 'Completed', ext: 'Extension',
    todo: 'To do', doing: 'In progress', done: 'Done',
    all_day: 'All day', start: 'Start', end: 'End', start_date: 'Start date', end_date: 'End date',
    confirmed: 'Confirmed', tentative: 'Tentative', cancelled: 'Cancelled',
    todo_table: 'To-do', calendar_table: 'Calendar', workspace: 'My schedule', board: 'Schedule',
  },
}

export function scheduleLabel(locale: ScheduleLocale, key: string): string {
  return LABELS[locale][key] ?? LABELS.en[key] ?? key
}

/** The standard fields of a to-do table (`buckyos.todo@1`). */
export function todoFields(locale: ScheduleLocale = 'zh'): FieldDef[] {
  const l = (k: string) => scheduleLabel(locale, k)
  return [
    { field_id: 'title', name: l('title'), type: 'text', required: true },
    { field_id: 'status', name: l('status'), type: 'select', required: true, options: ['todo', 'doing', 'done'].map((id) => ({ option_id: id, label: l(id) })) },
    { field_id: 'due', name: l('due'), type: 'date', nullable: true },
    { field_id: 'order', name: l('order'), type: 'text', nullable: true },
    { field_id: 'done_at', name: l('done_at'), type: 'datetime', nullable: true },
    { field_id: 'ext', name: l('ext'), type: 'json', nullable: true },
  ]
}

/** The standard fields of a calendar table (`buckyos.calendar@1`). */
export function calendarFields(locale: ScheduleLocale = 'zh'): FieldDef[] {
  const l = (k: string) => scheduleLabel(locale, k)
  return [
    { field_id: 'title', name: l('title'), type: 'text', required: true },
    { field_id: 'all_day', name: l('all_day'), type: 'boolean', nullable: true },
    { field_id: 'start', name: l('start'), type: 'datetime', nullable: true },
    { field_id: 'end', name: l('end'), type: 'datetime', nullable: true },
    { field_id: 'start_date', name: l('start_date'), type: 'date', nullable: true },
    { field_id: 'end_date', name: l('end_date'), type: 'date', nullable: true },
    { field_id: 'status', name: l('status'), type: 'select', nullable: true, options: ['confirmed', 'tentative', 'cancelled'].map((id) => ({ option_id: id, label: l(id) })) },
    { field_id: 'ext', name: l('ext'), type: 'json', nullable: true },
  ]
}

/** `entity.create` of a standard table. */
export function standardTableOp(kind: 'todo' | 'calendar', args: { entity_id: string; parent_id: string; order_key: string; name?: string; locale?: ScheduleLocale }): Op {
  const locale = args.locale ?? 'zh'
  return {
    op: 'entity.create', entity_id: args.entity_id, type_id: 'buckyos.table-source', parent_id: args.parent_id, order_key: args.order_key,
    schema_id: kind === 'todo' ? TODO_SCHEMA_ID : CALENDAR_SCHEMA_ID,
    name: args.name ?? scheduleLabel(locale, kind === 'todo' ? 'todo_table' : 'calendar_table'),
    payload: { title_field_id: 'title', fields: (kind === 'todo' ? todoFields(locale) : calendarFields(locale)) as unknown as Json },
  }
}

// ---- order keys (the core's `order_key_between`, core/src/order_key.rs: base-36, never ending in 0, ≤ 64)

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz'
const MAX_KEY_LEN = 64
const APPEND_WIDTH = 8

export function isOrderKey(k: unknown): k is string {
  return typeof k === 'string' && k.length > 0 && k.length <= MAX_KEY_LEN && /^[0-9a-z]+$/.test(k) && !k.endsWith('0')
}

function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0
    while (n < b.length && (a[n] ?? '0') === b[n]) n++
    if (n > 0) return b.slice(0, n) + midpoint(a.length > n ? a.slice(n) : '', b.slice(n))
  }
  const da = a.length ? DIGITS.indexOf(a[0]) : 0
  const db = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length
  if (db - da > 1) return DIGITS[Math.floor((da + db + 1) / 2)]
  if (b !== null && b.length > 1) return b[0]
  return DIGITS[da] + midpoint(a.length > 1 ? a.slice(1) : '', null)
}

function after(a: string): string {
  const out = a.padEnd(Math.max(a.length, APPEND_WIDTH), '0').split('')
  let i = out.length - 1
  while (i >= 0 && out[i] === 'z') i--
  if (i >= 0) {
    out[i] = DIGITS[DIGITS.indexOf(out[i]) + 1]
    for (let j = i + 1; j < out.length; j++) out[j] = '0'
    if (out[out.length - 1] === '0') out[out.length - 1] = '1'
    return out.join('')
  }
  if (out.length >= MAX_KEY_LEN) throw new Error('order key space exhausted; rebalance')
  const longer = out.join('').padEnd(Math.min(out.length + APPEND_WIDTH, MAX_KEY_LEN), '0')
  return longer.slice(0, -1) + '1'
}

/** A key strictly between `a` and `b` (null: open end), as the core computes it. */
export function orderKeyBetween(a?: string | null, b?: string | null): string {
  const lo = a ?? null, hi = b ?? null
  if (lo !== null && hi !== null && lo >= hi) throw new Error('orderKeyBetween requires a < b')
  const key = lo !== null && hi === null ? after(lo) : midpoint(lo ?? '', hi)
  if (!isOrderKey(key)) throw new Error('order key space exhausted; rebalance')
  return key
}

/** `count` keys spread between `a` and `b`, in order. */
export function orderKeysBetween(a: string | null, b: string | null, count: number): string[] {
  const out: string[] = []
  let lo = a
  for (let i = 0; i < count; i++) {
    lo = orderKeyBetween(lo, b)
    out.push(lo)
  }
  return out
}

// ---- records

/** A record as `doc.query` / `doc.read` answer it. */
export interface RowLike {
  record_id: string
  rev?: number
  revs?: Record<string, number>
  values: Record<string, Json | undefined>
  /** The record's rich-text body (notes), when it has one. */
  body_ref?: { entity_id: string }
}

let counter = 0
/** A record id: `r` + time + a counter + randomness (lower case, ≤ 64). */
export function newRecordId(prefix = 'r'): string {
  counter = (counter + 1) % 1296
  const rand = Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, '0')
  return `${prefix}${Date.now().toString(36)}${counter.toString(36).padStart(2, '0')}${rand}`
}

/** `table.set_values` / `table.unset_values` of `changes` (null or undefined unsets), each cell expected at the rev the
 * row was read with — the core requires it: concurrent writers of other cells merge, the same cell conflicts. */
export function setValuesOps(sourceId: string, row: RowLike, changes: Record<string, Json | undefined>): Op[] {
  const set: Op[] = []
  const unset: Op[] = []
  for (const [field, value] of Object.entries(changes)) {
    const cell: Op = { record_id: row.record_id, field_id: field, expect: { rev: row.revs?.[field] ?? 0 } }
    if (value === null || value === undefined) {
      if (row.values[field] !== undefined && row.values[field] !== null) unset.push(cell)
    } else {
      set.push({ ...cell, value })
    }
  }
  const out: Op[] = []
  if (set.length) out.push({ op: 'table.set_values', source_id: sourceId, values: set })
  if (unset.length) out.push({ op: 'table.unset_values', source_id: sourceId, values: unset })
  return out
}

export function insertRecordOp(sourceId: string, records: { record_id: string; values: Record<string, Json | undefined> }[]): Op {
  return {
    op: 'table.insert_records', source_id: sourceId,
    records: records.map((r) => ({ record_id: r.record_id, values: Object.fromEntries(Object.entries(r.values).filter(([, v]) => v !== undefined && v !== null)) as Json })),
  }
}

/** `table.delete_records` of rows as read (each expected at its record rev, as the core requires). */
export function deleteRecordsOp(sourceId: string, rows: RowLike[]): Op {
  return { op: 'table.delete_records', source_id: sourceId, records: rows.map((r): Json => ({ record_id: r.record_id, expect: { rev: r.rev ?? 0 } })) }
}

/** An original start as the series writes it: a date as it is, an instant as canonical UTC (`ext` keeps what was
 * written, any RFC 3339 offset). */
export function canonicalOriginal(x: string): string {
  if (isDate(x)) return x
  const t = Date.parse(x)
  return Number.isFinite(t) ? new Date(t).toISOString() : x
}
const originals = (v: Json | undefined): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map(canonicalOriginal) : [])

const extOf = (row: RowLike | undefined): Record<string, Json> => {
  const e = row?.values.ext
  return e && typeof e === 'object' && !Array.isArray(e) ? { ...(e as Record<string, Json>) } : {}
}

// ---- to-do

export interface TodoValues {
  title?: string
  status?: string
  due?: string | null
  order?: string | null
  done_at?: string | null
  ext?: Record<string, Json> | null
}

/** A to-do as the controls read it; still the record it came from (`values`, `revs`), so the operations take it. */
export interface TodoItem extends RowLike {
  title: string
  status: string
  due: string | null
  order: string | null
  done: boolean
  done_at: string | null
  ext: Record<string, Json>
}

export function todoItem(row: RowLike): TodoItem {
  const v = row.values
  const status = typeof v.status === 'string' ? v.status : 'todo'
  return {
    record_id: row.record_id, rev: row.rev, revs: row.revs, values: row.values,
    title: typeof v.title === 'string' ? v.title : '', status,
    due: typeof v.due === 'string' ? v.due : null, order: isOrderKey(v.order) ? v.order : null,
    done: status === TODO_DONE, done_at: typeof v.done_at === 'string' ? v.done_at : null, ext: extOf(row),
  }
}

/** To-do items in list order: by `order`, items without one last (by id, stable). */
export function sortTodos<T extends { order: string | null; record_id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.order === b.order ? a.record_id.localeCompare(b.record_id) : a.order === null ? 1 : b.order === null ? -1 : a.order < b.order ? -1 : 1))
}

/** Add a to-do: `order` between its neighbours (`after` / `before` keys, default: at the end of `items`). */
export function todoAddOps(sourceId: string, input: TodoValues & { title: string; record_id?: string }, place: { after?: string | null; before?: string | null; items?: { order: string | null }[] } = {}): { record_id: string; ops: Op[]; order: string } {
  const record_id = input.record_id ?? newRecordId('t')
  let order = input.order ?? null
  if (!order) {
    if (place.after !== undefined || place.before !== undefined) order = orderKeyBetween(place.after ?? null, place.before ?? null)
    else {
      const last = (place.items ?? []).map((i) => i.order).filter(isOrderKey).sort().pop() ?? null
      order = orderKeyBetween(last, null)
    }
  }
  const status = input.status ?? 'todo'
  const values: Record<string, Json | undefined> = {
    title: input.title, status, order,
    due: input.due ?? undefined, ext: input.ext && Object.keys(input.ext).length ? input.ext : undefined,
    done_at: status === TODO_DONE ? (input.done_at ?? new Date().toISOString()) : undefined,
  }
  return { record_id, order, ops: [insertRecordOp(sourceId, [{ record_id, values }])] }
}

/** Complete (or reopen) a to-do: status `done` and `done_at`, or back to `reopenStatus` (default `todo`). */
export function todoCompleteOps(sourceId: string, row: RowLike, done: boolean, opts: { now?: string; reopenStatus?: string } = {}): Op[] {
  if (done) return setValuesOps(sourceId, row, { status: TODO_DONE, done_at: opts.now ?? new Date().toISOString() })
  return setValuesOps(sourceId, row, { status: opts.reopenStatus ?? 'todo', done_at: null })
}

/** Move a to-do: to another status (column) and / or a new place (`order`). Completing by moving to `done` stamps
 * `done_at`, leaving it clears it. */
export function todoMoveOps(sourceId: string, row: RowLike, to: { status?: string; order?: string | null }, opts: { now?: string } = {}): Op[] {
  const changes: Record<string, Json | undefined> = {}
  const was = typeof row.values.status === 'string' ? row.values.status : undefined
  if (to.status !== undefined && to.status !== was) {
    changes.status = to.status
    if (to.status === TODO_DONE) changes.done_at = opts.now ?? new Date().toISOString()
    else if (was === TODO_DONE) changes.done_at = null
  }
  if (to.order !== undefined && to.order !== row.values.order) changes.order = to.order
  return Object.keys(changes).length ? setValuesOps(sourceId, row, changes) : []
}

/** Change fields of a to-do (title, due, ext …). `ext` is merged into the stored one (null removes a key). */
export function todoUpdateOps(sourceId: string, row: RowLike, changes: TodoValues & { ext_merge?: Record<string, Json | null> }): Op[] {
  const out: Record<string, Json | undefined> = {}
  for (const k of ['title', 'status', 'due', 'order', 'done_at'] as const) if (changes[k] !== undefined) out[k] = changes[k] as Json
  if (changes.ext !== undefined) out.ext = changes.ext && Object.keys(changes.ext).length ? changes.ext : null
  if (changes.ext_merge) {
    const ext = extOf(row)
    for (const [k, v] of Object.entries(changes.ext_merge)) if (v === null) delete ext[k]; else ext[k] = v
    out.ext = Object.keys(ext).length ? ext : null
  }
  if (out.status !== undefined && out.status !== row.values.status && out.done_at === undefined) {
    if (out.status === TODO_DONE) out.done_at = new Date().toISOString()
    else if (row.values.status === TODO_DONE) out.done_at = null
  }
  return setValuesOps(sourceId, row, out)
}

/** The order key for placing an item at `index` among `items` (sorted, the moved one excluded). */
export function orderAt(items: { order: string | null }[], index: number): string {
  const keys = items.map((i) => i.order)
  const before = index > 0 ? keys[index - 1] : null
  const afterKey = index < keys.length ? keys[index] : null
  if (before !== null && !isOrderKey(before)) return orderKeyBetween(null, null)
  if (afterKey !== null && isOrderKey(afterKey) && (before === null || before < afterKey)) return orderKeyBetween(before, afterKey)
  return orderKeyBetween(before, null)
}

// ---- calendar

export interface EventValues {
  title?: string
  all_day?: boolean
  start?: string | null
  end?: string | null
  start_date?: string | null
  end_date?: string | null
  status?: string | null
  ext?: Record<string, Json> | null
}

/** One shown occurrence of an event: a single event, an occurrence of a series, or the record overriding one. */
export interface EventOccurrence {
  /** `record_id`, or `<master>@<original>` for an occurrence of a series. */
  id: string
  /** The record holding what is shown (the master, or the override). */
  row: RowLike
  /** The series' master when this is an occurrence of a series. */
  master?: RowLike
  /** The occurrence's original start (its identity in the series). */
  original?: string
  title: string
  allDay: boolean
  /** Timed: instants (ms). */
  startMs?: number
  endMs?: number
  /** All-day: dates, end inclusive. */
  startDate?: string
  endDate?: string
  status: string | null
  ext: Record<string, Json>
  /** The record repeats (a master or an occurrence of one). */
  recurring: boolean
  /** The record overrides one occurrence of a series (`ext.recurrence_id`). */
  override: boolean
  /** Shown from `ext.occurrences` an Agent wrote (a rule the subset cannot express). */
  agentWritten: boolean
}

const DEFAULT_EVENT_MS = 3600_000

function rowTimes(row: RowLike): { allDay: boolean; startMs?: number; endMs?: number; startDate?: string; endDate?: string } | null {
  const v = row.values
  if (v.all_day === true) {
    if (typeof v.start_date !== 'string' || !isDate(v.start_date)) return null
    const endDate = typeof v.end_date === 'string' && isDate(v.end_date) && v.end_date >= v.start_date ? v.end_date : v.start_date
    return { allDay: true, startDate: v.start_date, endDate }
  }
  if (typeof v.start !== 'string') return null
  const startMs = Date.parse(v.start)
  if (!Number.isFinite(startMs)) return null
  const end = typeof v.end === 'string' ? Date.parse(v.end) : NaN
  return { allDay: false, startMs, endMs: Number.isFinite(end) && end >= startMs ? end : startMs + DEFAULT_EVENT_MS }
}

function addDays(date: string, n: number): string {
  return dateOf(dayOf(date) + n)
}
const daysBetween = (a: string, b: string) => dayOf(b) - dayOf(a)

function occurrenceOf(row: RowLike, times: NonNullable<ReturnType<typeof rowTimes>>, extra: Partial<EventOccurrence>): EventOccurrence {
  const ext = extOf(row)
  return {
    id: row.record_id, row, title: typeof row.values.title === 'string' ? row.values.title : '', allDay: times.allDay,
    startMs: times.startMs, endMs: times.endMs, startDate: times.startDate, endDate: times.endDate,
    status: typeof row.values.status === 'string' ? row.values.status : null, ext,
    recurring: false, override: false, agentWritten: false, ...extra,
  }
}

/** Does an occurrence overlap the window (all-day dates are compared on the viewer's calendar)? */
function overlaps(o: { allDay: boolean; startMs?: number; endMs?: number; startDate?: string; endDate?: string }, window: { fromMs: number; toMs: number }, viewerTz: string): boolean {
  if (!o.allDay) return o.startMs! < window.toMs && Math.max(o.endMs!, o.startMs! + 1) > window.fromMs
  const from = localDate(window.fromMs, viewerTz), to = localDate(window.toMs - 1, viewerTz)
  return o.startDate! <= to && o.endDate! >= from
}

/** The date of an instant on a zone's calendar. */
export function localDate(ms: number, tz: string): string {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
  return f.format(new Date(ms))
}

export function viewerTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' }
}

/** Every occurrence of the calendar's records overlapping `[fromMs, toMs)`: single events, expanded series (EXDATE
 * removed, overridden occurrences replaced by their override records), and the occurrences an Agent wrote for rules
 * outside the subset. Sorted by start. A series whose rule cannot be read shows its first occurrence only. */
export function calendarOccurrences(rows: RowLike[], window: { fromMs: number; toMs: number }, opts: { viewerTz?: string; limit?: number } = {}): EventOccurrence[] {
  const viewerTz = opts.viewerTz ?? viewerTimeZone()
  const out: EventOccurrence[] = []
  const overrides = new Map<string, RowLike>()
  for (const row of rows) {
    const rid = extOf(row).recurrence_id
    if (rid && typeof rid === 'object' && !Array.isArray(rid) && typeof rid.master === 'string' && typeof rid.original === 'string') overrides.set(`${rid.master}@${canonicalOriginal(rid.original)}`, row)
  }
  const byId = new Map(rows.map((r) => [r.record_id, r]))
  for (const row of rows) {
    const times = rowTimes(row)
    if (!times) continue
    const ext = extOf(row)
    const rid = ext.recurrence_id as Record<string, Json> | undefined
    if (rid && typeof rid === 'object') {
      // an override is shown in place of its occurrence (also when its master is gone: it is an event of its own then)
      const master = typeof rid.master === 'string' ? byId.get(rid.master) : undefined
      const original = typeof rid.original === 'string' ? canonicalOriginal(rid.original) : undefined
      const occ = occurrenceOf(row, times, { id: master && original ? occurrenceId(master.record_id, original) : row.record_id, master, original, recurring: Boolean(master), override: true })
      if (overlaps(occ, window, viewerTz)) out.push(occ)
      continue
    }
    const duration = times.allDay ? daysBetween(times.startDate!, times.endDate!) : times.endMs! - times.startMs!
    const shift = (o: Occurrence): EventOccurrence | null => {
      const key = `${row.record_id}@${o.original}`
      if (overrides.has(key)) return null
      if (times.allDay) return occurrenceOf(row, { allDay: true, startDate: o.date!, endDate: addDays(o.date!, duration) }, { id: key, master: row, original: o.original, recurring: true })
      return occurrenceOf(row, { allDay: false, startMs: o.startMs!, endMs: o.startMs! + duration }, { id: key, master: row, original: o.original, recurring: true })
    }
    let rule: RRule | null = null
    if (typeof ext.rrule === 'string') {
      try { rule = parseRRule(ext.rrule) } catch { rule = null }
    }
    if (rule) {
      const start = seriesStartOf(row.values, typeof ext.tz === 'string' ? ext.tz : undefined, viewerTz)
      if (!start) continue
      const exdate = originals(ext.exdate)
      const occs = expandSeries(rule, start, window, { exdate, viewerTz, durationMs: times.allDay ? undefined : duration, durationDays: times.allDay ? duration : undefined, limit: opts.limit })
      for (const o of occs) { const s = shift(o); if (s) out.push(s) }
      continue
    }
    if (Array.isArray(ext.occurrences) && ext.occurrences.length > 0) {
      const exdate = new Set(originals(ext.exdate))
      for (const raw of ext.occurrences) {
        if (typeof raw !== 'string') continue
        const x = canonicalOriginal(raw)
        if (exdate.has(x)) continue
        const o: Occurrence = times.allDay ? { original: x, date: x } : { original: x, startMs: Date.parse(x) }
        if (!times.allDay && !Number.isFinite(o.startMs)) continue
        if (times.allDay && !isDate(x)) continue
        const s = shift(o)
        if (s && overlaps(s, window, viewerTz)) out.push({ ...s, agentWritten: true })
      }
      continue
    }
    const occ = occurrenceOf(row, times, {})
    if (overlaps(occ, window, viewerTz)) out.push(occ)
  }
  return out.sort((a, b) => sortKey(a) - sortKey(b) || a.id.localeCompare(b.id))
}

const sortKey = (o: EventOccurrence) => (o.allDay ? Date.parse(`${o.startDate}T00:00:00Z`) : o.startMs!)

/** A new event: timed (`start` / `end` ISO) or all-day (`start_date` / `end_date`). */
export function eventAddOps(sourceId: string, input: EventValues & { title: string; record_id?: string }): { record_id: string; ops: Op[] } {
  const record_id = input.record_id ?? newRecordId('e')
  const values: Record<string, Json | undefined> = { title: input.title, status: input.status ?? undefined, ext: input.ext && Object.keys(input.ext).length ? input.ext : undefined }
  if (input.all_day) {
    values.all_day = true
    values.start_date = input.start_date ?? undefined
    values.end_date = input.end_date && input.end_date !== input.start_date ? input.end_date : undefined
  } else {
    values.start = input.start ?? undefined
    values.end = input.end ?? undefined
  }
  return { record_id, ops: [insertRecordOp(sourceId, [{ record_id, values }])] }
}

/** When an event happens: timed or all-day. */
export type EventTimes = { allDay: false; start: string; end: string } | { allDay: true; startDate: string; endDate: string }

function timesChanges(times: EventTimes): Record<string, Json | undefined> {
  return times.allDay
    ? { all_day: true, start_date: times.startDate, end_date: times.endDate !== times.startDate ? times.endDate : null, start: null, end: null }
    : { all_day: null, start: times.start, end: times.end, start_date: null, end_date: null }
}

/** What an edit of one occurrence changes: its times and / or other fields. */
export interface EventChange {
  times?: EventTimes
  values?: Omit<EventValues, 'all_day' | 'start' | 'end' | 'start_date' | 'end_date'>
  /** Keys merged into `ext` (null removes). */
  ext_merge?: Record<string, Json | null>
  /** A new rule (`null`: stop repeating); only for `all` / `following`. */
  rrule?: string | null
}

export type RecurrenceScope = 'one' | 'following' | 'all'

export interface CalendarContext {
  /** Every record of the calendar (or at least the series' master and its overrides). */
  rows: RowLike[]
  newRecordId?: () => string
}

function overridesOf(rows: RowLike[], masterId: string): RowLike[] {
  return rows.filter((r) => {
    const rid = extOf(r).recurrence_id as Record<string, Json> | undefined
    return rid && typeof rid === 'object' && rid.master === masterId
  })
}

const isoShift = (iso: string, deltaMs: number) => new Date(Date.parse(iso) + deltaMs).toISOString()
/** Shift an original (date or instant) by a time change. */
function shiftOriginal(original: string, allDay: boolean, deltaMs: number, deltaDays: number): string {
  return allDay ? addDays(original, deltaDays) : isoShift(original, deltaMs)
}

/** A weekly / monthly rule follows its series to another day: BYDAY weekdays and BYMONTHDAY days move with it. */
function shiftRule(rule: RRule, deltaDays: number): RRule {
  if (!deltaDays) return rule
  const next = { ...rule }
  if (rule.byDay && rule.byDay.every((d) => d.ordinal === undefined) && (rule.freq === 'WEEKLY' || rule.freq === 'DAILY')) {
    next.byDay = rule.byDay.map((d) => ({ weekday: (((d.weekday + deltaDays) % 7) + 7) % 7 }))
  } else if (rule.byDay && rule.freq === 'MONTHLY' && rule.byDay.length === 1 && rule.bySetPos === undefined && Math.abs(deltaDays) < 7) {
    next.byDay = [{ ...rule.byDay[0], weekday: (((rule.byDay[0].weekday + deltaDays) % 7) + 7) % 7 }]
  } else if (rule.byMonthDay && rule.byMonthDay.length === 1 && rule.byMonthDay[0] > 0) {
    const d = rule.byMonthDay[0] + deltaDays
    if (d >= 1 && d <= 28) next.byMonthDay = [d]
  }
  return next
}

/** The ops of a change of one occurrence of an event (or of a single event): `one` overrides just that occurrence
 * (“仅此一次”), `following` splits the series there (“此后全部”), `all` changes the series (“全部”), shifting its
 * start, its exclusions and its overrides by the same amount. */
export function eventEditOps(sourceId: string, occ: Pick<EventOccurrence, 'row' | 'master' | 'original' | 'allDay' | 'startMs' | 'startDate'>, change: EventChange, scope: RecurrenceScope, ctx: CalendarContext): { ops: Op[]; record_id: string } {
  const newId = ctx.newRecordId ?? (() => newRecordId('e'))
  const fieldChanges = (row: RowLike): Record<string, Json | undefined> => {
    const out: Record<string, Json | undefined> = { ...(change.values as Record<string, Json | undefined> | undefined) }
    if (change.ext_merge) {
      const ext = extOf(row)
      for (const [k, v] of Object.entries(change.ext_merge)) if (v === null) delete ext[k]; else ext[k] = v
      out.ext = Object.keys(ext).length ? ext : null
    }
    return out
  }
  const master = occ.master
  // a single event, or an override edited as itself
  if (!master || (occ.row !== master && scope === 'one')) {
    const row = occ.row
    const changes = { ...fieldChanges(row), ...(change.times ? timesChanges(change.times) : {}) }
    if (change.rrule !== undefined && !master) {
      const ext = (changes.ext as Record<string, Json> | null | undefined) ?? extOf(row)
      const next = { ...(ext ?? {}) }
      if (change.rrule === null) delete next.rrule; else next.rrule = formatRRule(parseRRule(change.rrule))
      if (change.rrule === null) delete next.exdate
      changes.ext = Object.keys(next).length ? next : null
    }
    return { ops: setValuesOps(sourceId, row, changes), record_id: row.record_id }
  }
  const original = occ.original!
  const masterTimes = rowTimes(master)!
  const masterExt = extOf(master)
  if (scope === 'one') {
    // a new override from the master's values for this occurrence
    const id = newId()
    const ext: Record<string, Json> = { ...masterExt, recurrence_id: { master: master.record_id, original } }
    delete ext.rrule; delete ext.exdate; delete ext.occurrences; delete ext.rule_text; delete ext.covered_until; delete ext.maintenance
    const base: Record<string, Json | undefined> = { title: master.values.title, status: master.values.status, ext }
    const times: EventTimes = change.times ?? (occ.allDay
      ? { allDay: true, startDate: occ.startDate!, endDate: addDays(occ.startDate!, daysBetween(masterTimes.startDate!, masterTimes.endDate!)) }
      : { allDay: false, start: new Date(occ.startMs!).toISOString(), end: new Date(occ.startMs! + (masterTimes.endMs! - masterTimes.startMs!)).toISOString() })
    const values = { ...base, ...fieldChanges({ record_id: id, values: { ext } }), ...timesChanges(times) }
    if (!values.ext) values.ext = ext
    return { ops: [insertRecordOp(sourceId, [{ record_id: id, values }])], record_id: id }
  }
  // the time change the edit makes to this occurrence (from where the series puts it), applied to the series
  let deltaMs = 0, deltaDays = 0
  let durationMs = masterTimes.allDay ? 0 : masterTimes.endMs! - masterTimes.startMs!
  let durationDays = masterTimes.allDay ? daysBetween(masterTimes.startDate!, masterTimes.endDate!) : 0
  if (change.times) {
    if (change.times.allDay !== masterTimes.allDay) throw new Error('changing a series between all-day and timed: edit the series itself (scope all) with new times')
    if (change.times.allDay) {
      deltaDays = daysBetween(original, change.times.startDate)
      durationDays = daysBetween(change.times.startDate, change.times.endDate)
    } else {
      deltaMs = Date.parse(change.times.start) - Date.parse(original)
      deltaDays = Math.round(deltaMs / 86_400_000)
      durationMs = Date.parse(change.times.end) - Date.parse(change.times.start)
    }
  }
  const rule = typeof masterExt.rrule === 'string' ? parseRRule(masterExt.rrule) : null
  const overrides = overridesOf(ctx.rows, master.record_id)
  const exdate = originals(masterExt.exdate)
  const isFirst = masterTimes.allDay ? original === masterTimes.startDate : original === new Date(masterTimes.startMs!).toISOString()
  const seriesTimes = (startMs: number | undefined, startDate: string | undefined): EventTimes => (masterTimes.allDay
    ? { allDay: true, startDate: addDays(startDate!, deltaDays), endDate: addDays(addDays(startDate!, deltaDays), durationDays) }
    : { allDay: false, start: new Date(startMs! + deltaMs).toISOString(), end: new Date(startMs! + deltaMs + durationMs).toISOString() })
  const nextRule = (r: RRule | null): string | null => {
    if (change.rrule !== undefined) return change.rrule === null ? null : formatRRule(parseRRule(change.rrule))
    return r ? formatRRule(shiftRule(r, deltaDays)) : null
  }
  const ops: Op[] = []
  if (scope === 'all' || isFirst) {
    const times = seriesTimes(masterTimes.startMs, masterTimes.startDate)
    const ext = { ...masterExt }
    const r = nextRule(rule)
    if (r) ext.rrule = r; else { delete ext.rrule; delete ext.exdate }
    if (r && exdate.length) ext.exdate = exdate.map((x) => shiftOriginal(x, masterTimes.allDay, deltaMs, deltaDays))
    const fc = fieldChanges({ record_id: master.record_id, values: { ext } })
    const extOut = fc.ext !== undefined ? fc.ext : ext
    ops.push(...setValuesOps(sourceId, master, { ...fc, ...timesChanges(times), ext: extOut && Object.keys(extOut as object).length ? extOut : null }))
    for (const o of overrides) {
      const oext = extOf(o)
      const rid = oext.recurrence_id as Record<string, Json>
      if (!r) { ops.push(deleteRecordsOp(sourceId, [o])); continue }
      if (deltaMs || deltaDays) ops.push(...setValuesOps(sourceId, o, { ext: { ...oext, recurrence_id: { ...rid, original: shiftOriginal(String(rid.original), masterTimes.allDay, deltaMs, deltaDays) } } }))
    }
    return { ops, record_id: master.record_id }
  }
  // following: the master ends before this occurrence, a new series starts here
  if (!rule) throw new Error('not a repeating event')
  const id = newId()
  const before = (x: string) => (masterTimes.allDay ? x < original : Date.parse(x) < Date.parse(original))
  let headRule: RRule = { ...rule }
  let tailRule: RRule = { ...rule }
  if (rule.count !== undefined) {
    const start = seriesStartOf(master.values, typeof masterExt.tz === 'string' ? masterExt.tz : undefined)!
    const fromMs = masterTimes.allDay ? Date.parse(`${masterTimes.startDate}T00:00:00Z`) - 86_400_000 * 2 : masterTimes.startMs!
    const toMs = masterTimes.allDay ? Date.parse(`${original}T00:00:00Z`) : Date.parse(original)
    const done = expandSeries(rule, start, { fromMs, toMs }, { viewerTz: 'UTC' }).filter((o) => before(o.original)).length
    headRule = { ...rule, count: Math.max(1, done) }
    tailRule = { ...rule, count: Math.max(1, rule.count - done) }
  } else {
    headRule = { ...rule, until: masterTimes.allDay ? addDays(original, -1) : new Date(Date.parse(original) - 1000).toISOString().replace(/\.\d{3}Z$/, '.000Z') }
  }
  const headExt: Record<string, Json> = { ...masterExt, rrule: formatRRule(headRule) }
  const headEx = exdate.filter(before)
  if (headEx.length) headExt.exdate = headEx; else delete headExt.exdate
  ops.push(...setValuesOps(sourceId, master, { ext: headExt }))
  const tailExt: Record<string, Json> = { ...masterExt }
  const tr = nextRule(tailRule)
  if (tr) tailExt.rrule = tr; else delete tailExt.rrule
  const tailEx = exdate.filter((x) => !before(x)).map((x) => shiftOriginal(x, masterTimes.allDay, deltaMs, deltaDays))
  if (tailEx.length && tr) tailExt.exdate = tailEx; else delete tailExt.exdate
  const times = seriesTimes(masterTimes.allDay ? undefined : Date.parse(original), masterTimes.allDay ? original : undefined)
  const fc = fieldChanges({ record_id: id, values: { ext: tailExt } })
  const values: Record<string, Json | undefined> = { title: master.values.title, status: master.values.status, ...fc, ...timesChanges(times) }
  values.ext = (fc.ext !== undefined ? fc.ext : tailExt) ?? undefined
  ops.push(insertRecordOp(sourceId, [{ record_id: id, values }]))
  for (const o of overrides) {
    const oext = extOf(o)
    const rid = oext.recurrence_id as Record<string, Json>
    if (before(String(rid.original))) continue
    if (!tr) { ops.push(deleteRecordsOp(sourceId, [o])); continue }
    ops.push(...setValuesOps(sourceId, o, { ext: { ...oext, recurrence_id: { master: id, original: shiftOriginal(String(rid.original), masterTimes.allDay, deltaMs, deltaDays) } } }))
  }
  return { ops, record_id: id }
}

/** Remove one occurrence (“今天不用了”: an exclusion, and its override goes), this and the following ones (the series
 * ends before it), or the whole series with its overrides. A single event is deleted. */
export function eventDeleteOps(sourceId: string, occ: Pick<EventOccurrence, 'row' | 'master' | 'original'>, scope: RecurrenceScope, ctx: CalendarContext): Op[] {
  const master = occ.master
  if (!master) return [deleteRecordsOp(sourceId, [occ.row])]
  const original = occ.original!
  const masterExt = extOf(master)
  const masterTimes = rowTimes(master)!
  const overrides = overridesOf(ctx.rows, master.record_id)
  const isFirst = masterTimes.allDay ? original === masterTimes.startDate : original === new Date(masterTimes.startMs!).toISOString()
  if (scope === 'all' || (scope === 'following' && isFirst)) return [deleteRecordsOp(sourceId, [master, ...overrides])]
  const ops: Op[] = []
  if (scope === 'one') {
    const exdate = originals(masterExt.exdate)
    if (!exdate.includes(original)) ops.push(...setValuesOps(sourceId, master, { ext: { ...masterExt, exdate: [...exdate, original].sort() } }))
    const own = overrides.filter((o) => canonicalOriginal(String((extOf(o).recurrence_id as Record<string, Json>).original)) === original)
    if (own.length) ops.push(deleteRecordsOp(sourceId, own))
    return ops
  }
  const rule = typeof masterExt.rrule === 'string' ? parseRRule(masterExt.rrule) : null
  if (!rule) return [deleteRecordsOp(sourceId, [occ.row])]
  const before = (x: string) => (masterTimes.allDay ? x < original : Date.parse(x) < Date.parse(original))
  const head: RRule = { ...rule, count: undefined, until: masterTimes.allDay ? addDays(original, -1) : new Date(Date.parse(original) - 1000).toISOString() }
  const ext: Record<string, Json> = { ...masterExt, rrule: formatRRule(head) }
  if (Array.isArray(masterExt.exdate)) {
    const keep = originals(masterExt.exdate).filter(before)
    if (keep.length) ext.exdate = keep; else delete ext.exdate
  }
  ops.push(...setValuesOps(sourceId, master, { ext }))
  const gone = overrides.filter((o) => !before(String((extOf(o).recurrence_id as Record<string, Json>).original)))
  if (gone.length) ops.push(deleteRecordsOp(sourceId, gone))
  return ops
}

/** Skip one occurrence (D4: the notification's “skip”). */
export const eventSkipOps = (sourceId: string, occ: Pick<EventOccurrence, 'row' | 'master' | 'original'>, ctx: CalendarContext) => eventDeleteOps(sourceId, occ, 'one', ctx)

/** Postpone one occurrence by `minutes` (D4: the notification's “snooze”): an override of that occurrence. */
export function eventPostponeOps(sourceId: string, occ: Pick<EventOccurrence, 'row' | 'master' | 'original' | 'allDay' | 'startMs' | 'endMs' | 'startDate' | 'endDate'>, minutes: number, ctx: CalendarContext): { ops: Op[]; record_id: string } {
  const times: EventTimes = occ.allDay
    ? { allDay: true, startDate: addDays(occ.startDate!, Math.max(1, Math.round(minutes / 1440))), endDate: addDays(occ.endDate!, Math.max(1, Math.round(minutes / 1440))) }
    : { allDay: false, start: new Date(occ.startMs! + minutes * 60_000).toISOString(), end: new Date(occ.endMs! + minutes * 60_000).toISOString() }
  return eventEditOps(sourceId, occ, { times }, 'one', ctx)
}

// ---- the private schedule Workspace

export interface ScheduleHandle {
  workspace_id: string
  epoch: string
  created: boolean
  todo: string
  calendar: string
}

/** How the schedule talks to the service: one kRPC call whose business failure (`ok: false`) throws — an
 * `AiWorkspaceClient`, or the CLI's service call. */
export interface ScheduleTransport {
  call<T = Record<string, unknown>>(method: string, params: Record<string, unknown>): Promise<T>
}

/** The person's private schedule (Q5): one Workspace named `schedule`, its to-do table `todo` and calendar table
 * `calendar` (fixed ids), and a page showing both, created the first time. Agents and commands use it by name. */
export class ScheduleClient {
  private handle: ScheduleHandle | null = null
  private readonly locale: ScheduleLocale

  constructor(readonly aiws: ScheduleTransport, opts: { locale?: ScheduleLocale } = {}) {
    this.locale = opts.locale ?? 'zh'
  }

  /** The schedule Workspace with its two tables (created when missing; concurrent first uses converge). */
  async ensure(): Promise<ScheduleHandle> {
    if (this.handle) return this.handle
    const ws = await this.aiws.call<{ workspace_id: string; epoch: string; created: boolean }>('ws.ensure', { name: SCHEDULE_WORKSPACE_NAME, title: scheduleLabel(this.locale, 'workspace') })
    const handle: ScheduleHandle = { workspace_id: ws.workspace_id, epoch: ws.epoch, created: ws.created, todo: SCHEDULE_TODO_ID, calendar: SCHEDULE_CALENDAR_ID }
    // what is there already (`doc.read` is stable; the outline is the Desktop's)
    const have = new Set<string>()
    for (const id of [SCHEDULE_TODO_ID, SCHEDULE_CALENDAR_ID, SCHEDULE_SURFACE_ID]) {
      try {
        const read = await this.aiws.call<{ deleted?: boolean }>('doc.read', { workspace_id: ws.workspace_id, entity_id: id })
        if (!read.deleted) have.add(id)
      } catch (error) {
        // a transport's failure carries the service's code (an AiwsFailure, or any error with `code`)
        const code = (error as { code?: unknown } | null)?.code
        if (code !== 'NOT_FOUND' && code !== 'TARGET_DELETED') throw error
      }
    }
    const ops: Op[] = []
    if (!have.has(SCHEDULE_TODO_ID)) ops.push(standardTableOp('todo', { entity_id: SCHEDULE_TODO_ID, parent_id: 'data', order_key: 'u', locale: this.locale }))
    if (!have.has(SCHEDULE_CALENDAR_ID)) ops.push(standardTableOp('calendar', { entity_id: SCHEDULE_CALENDAR_ID, parent_id: 'data', order_key: 'v', locale: this.locale }))
    if (!have.has(SCHEDULE_SURFACE_ID)) ops.push(...scheduleBoardOps(this.locale))
    if (ops.length) {
      const result = await this.commitTo(handle, ops, 'create the schedule', 'system')
      // a concurrent first use created them: fine
      const idConflict = (result.sub_code ?? result.errors?.[0]?.sub_code ?? result.error?.sub_code) === 'ID_CONFLICT'
      if (result.status !== 'accepted' && !(result.status === 'rejected' && idConflict)) throw failureOf(result)
    }
    this.handle = handle
    return handle
  }

  private async commitTo(handle: ScheduleHandle, operations: Op[], message: string, origin: 'agent' | 'human' | 'system' = 'agent'): Promise<CommitResult> {
    const key = `sched-${newRecordId('k')}`
    const request = (epoch: string) => ({ protocol_version: AIWS_PROTOCOL_VERSION, workspace_id: handle.workspace_id, epoch, idempotency_key: key, origin, message, operations })
    let result = await this.aiws.call<CommitResult>('doc.commit', request(handle.epoch))
    if (result.status === 'rejected' && (result.code ?? result.error?.code) === 'EPOCH_MISMATCH') {
      const info = await this.aiws.call<{ epoch: string }>('ws.get_info', { workspace_id: handle.workspace_id })
      handle.epoch = info.epoch
      result = await this.aiws.call<CommitResult>('doc.commit', request(handle.epoch))
    }
    return result
  }

  /** Commit operations into the schedule; a refusal or conflict throws with the service's reason. */
  async commit(operations: Op[], message: string): Promise<CommitResult> {
    const handle = await this.ensure()
    const result = await this.commitTo(handle, operations, message)
    if (result.status !== 'accepted') throw failureOf(result)
    return result
  }

  async rows(sourceId: string, filter?: Json): Promise<RowLike[]> {
    const handle = await this.ensure()
    const rows: RowLike[] = []
    let cursor: string | undefined
    for (let i = 0; i < 100; i++) {
      const page = await this.aiws.call<{ rows: RowLike[]; next_cursor?: string | null }>('doc.query', { workspace_id: handle.workspace_id, source_id: sourceId, limit: 1000, ...(filter ? { filter } : {}), ...(cursor ? { cursor } : {}) })
      rows.push(...page.rows)
      if (!page.next_cursor || page.rows.length === 0) break
      cursor = page.next_cursor
    }
    return rows
  }

  async row(sourceId: string, recordId: string): Promise<RowLike> {
    const handle = await this.ensure()
    const r = await this.aiws.call<{ content?: RowLike }>('doc.read', { workspace_id: handle.workspace_id, entity_id: sourceId, selector: { kind: 'table_record', record_id: recordId } })
    const row = r.content as RowLike
    if (!row?.record_id) throw new AiwsFailure({ code: 'NOT_FOUND', retryable: false, detail: `record ${recordId} not found` })
    return row
  }

  // ---- to-do

  async todos(opts: { includeDone?: boolean } = {}): Promise<TodoItem[]> {
    const items = sortTodos((await this.rows(SCHEDULE_TODO_ID)).map(todoItem))
    return opts.includeDone ? items : items.filter((i) => !i.done)
  }

  async addTodo(input: TodoValues & { title: string }, place: { after?: string; before?: string } = {}): Promise<TodoItem> {
    const items = sortTodos((await this.rows(SCHEDULE_TODO_ID)).map(todoItem))
    const at = (id?: string) => items.find((i) => i.record_id === id)
    let pos: { after?: string | null; before?: string | null; items?: TodoItem[] } = { items }
    if (place.after) { const i = items.findIndex((x) => x.record_id === place.after); pos = { after: at(place.after)?.order ?? null, before: items[i + 1]?.order ?? null } }
    else if (place.before) { const i = items.findIndex((x) => x.record_id === place.before); pos = { after: items[i - 1]?.order ?? null, before: at(place.before)?.order ?? null } }
    const { record_id, ops } = todoAddOps(SCHEDULE_TODO_ID, input, pos)
    await this.commit(ops, `add to-do: ${input.title}`)
    return todoItem(await this.row(SCHEDULE_TODO_ID, record_id))
  }

  async completeTodo(recordId: string, done = true): Promise<void> {
    const row = await this.row(SCHEDULE_TODO_ID, recordId)
    const ops = todoCompleteOps(SCHEDULE_TODO_ID, row, done)
    if (ops.length) await this.commit(ops, `${done ? 'complete' : 'reopen'} to-do ${recordId}`)
  }

  async updateTodo(recordId: string, changes: TodoValues & { ext_merge?: Record<string, Json | null> }): Promise<void> {
    const row = await this.row(SCHEDULE_TODO_ID, recordId)
    const ops = todoUpdateOps(SCHEDULE_TODO_ID, row, changes)
    if (ops.length) await this.commit(ops, `update to-do ${recordId}`)
  }

  /** Move a to-do before / after another one, and / or into another status. */
  async moveTodo(recordId: string, to: { status?: string; before?: string; after?: string }): Promise<void> {
    const items = sortTodos((await this.rows(SCHEDULE_TODO_ID)).map(todoItem))
    const row = items.find((i) => i.record_id === recordId)
    if (!row) throw new AiwsFailure({ code: 'NOT_FOUND', retryable: false, detail: `to-do ${recordId} not found` })
    const others = items.filter((i) => i.record_id !== recordId)
    let order: string | undefined
    if (to.before || to.after) {
      const anchor = others.findIndex((i) => i.record_id === (to.before ?? to.after))
      if (anchor < 0) throw new AiwsFailure({ code: 'NOT_FOUND', retryable: false, detail: `to-do ${to.before ?? to.after} not found` })
      order = orderAt(others, to.before ? anchor : anchor + 1)
    }
    const ops = todoMoveOps(SCHEDULE_TODO_ID, row, { status: to.status, order })
    if (ops.length) await this.commit(ops, `move to-do ${recordId}`)
  }

  async removeTodos(recordIds: string[]): Promise<void> {
    const rows = await Promise.all(recordIds.map((id) => this.row(SCHEDULE_TODO_ID, id)))
    await this.commit([deleteRecordsOp(SCHEDULE_TODO_ID, rows)], `delete to-do ${recordIds.join(', ')}`)
  }

  // ---- calendar

  async events(window: { fromMs: number; toMs: number }, opts: { viewerTz?: string } = {}): Promise<EventOccurrence[]> {
    return calendarOccurrences(await this.rows(SCHEDULE_CALENDAR_ID), window, opts)
  }

  async addEvent(input: EventValues & { title: string }): Promise<string> {
    if (input.ext?.rrule !== undefined && typeof input.ext.rrule === 'string') input = { ...input, ext: { ...input.ext, rrule: formatRRule(parseRRule(input.ext.rrule)) } }
    const { record_id, ops } = eventAddOps(SCHEDULE_CALENDAR_ID, input)
    await this.commit(ops, `add event: ${input.title}`)
    return record_id
  }

  /** The occurrence an id names (`record_id` or `<master>@<original>`), from all rows. */
  async occurrence(id: string): Promise<{ occ: EventOccurrence; rows: RowLike[] }> {
    const rows = await this.rows(SCHEDULE_CALENDAR_ID)
    return { occ: findOccurrence(rows, id), rows }
  }

  async editEvent(id: string, change: EventChange, scope: RecurrenceScope = 'one'): Promise<string> {
    const { occ, rows } = await this.occurrence(id)
    const { ops, record_id } = eventEditOps(SCHEDULE_CALENDAR_ID, occ, change, scope, { rows })
    if (ops.length) await this.commit(ops, `edit event ${id} (${scope})`)
    return record_id
  }

  async deleteEvent(id: string, scope: RecurrenceScope = 'one'): Promise<void> {
    const { occ, rows } = await this.occurrence(id)
    await this.commit(eventDeleteOps(SCHEDULE_CALENDAR_ID, occ, scope, { rows }), `delete event ${id} (${scope})`)
  }
}

export interface CommitResult {
  status: 'accepted' | 'conflict' | 'rejected' | 'saved_locally'
  seq?: number
  commit_id?: string
  code?: string
  sub_code?: string
  detail?: string
  errors?: { code: string; sub_code?: string; detail?: string }[]
  error?: { code: string; sub_code?: string; detail: string; retryable: boolean }
  conflicts?: { selector?: unknown; entity_id?: string; code?: string }[]
}

function failureOf(result: CommitResult): AiwsFailure {
  const first = result.errors?.[0]
  if (result.status === 'conflict') {
    const c = result.conflicts?.[0]
    return new AiwsFailure({ code: result.code ?? 'REVISION_CONFLICT', retryable: true, detail: `changed meanwhile, read it again${c ? `: ${JSON.stringify(c.selector ?? c)}` : ''}` })
  }
  return new AiwsFailure({ code: result.code ?? result.error?.code ?? 'REJECTED', sub_code: result.sub_code ?? first?.sub_code, retryable: false, detail: first?.detail ?? result.detail ?? result.error?.detail ?? 'refused' })
}

/** The occurrence an id names among a calendar's rows: a record id, or `<master>@<original>` (an occurrence of a
 * series, overridden or not). */
export function findOccurrence(rows: RowLike[], id: string): EventOccurrence {
  const at = id.indexOf('@')
  const recordId = at < 0 ? id : id.slice(0, at)
  const original = at < 0 ? null : canonicalOriginal(id.slice(at + 1))
  const row = rows.find((r) => r.record_id === recordId)
  if (!row) throw new AiwsFailure({ code: 'NOT_FOUND', retryable: false, detail: `event ${recordId} not found` })
  if (original === null) {
    const times = rowTimes(row)
    if (!times) throw new AiwsFailure({ code: 'INVALID_OPERATION', retryable: false, detail: `event ${recordId} has no time` })
    const ext = extOf(row)
    const rid = ext.recurrence_id as Record<string, Json> | undefined
    const master = rid && typeof rid.master === 'string' ? rows.find((r) => r.record_id === rid.master) : undefined
    return occurrenceOf(row, times, master ? { master, original: String(rid!.original), recurring: true, override: true } : { recurring: typeof ext.rrule === 'string', master: typeof ext.rrule === 'string' ? row : undefined, original: typeof ext.rrule === 'string' ? (times.allDay ? times.startDate : new Date(times.startMs!).toISOString()) : undefined })
  }
  const override = rows.find((r) => {
    const rid = extOf(r).recurrence_id as Record<string, Json> | undefined
    return rid && rid.master === recordId && typeof rid.original === 'string' && canonicalOriginal(rid.original) === canonicalOriginal(original)
  })
  const times = rowTimes(row)
  if (!times) throw new AiwsFailure({ code: 'INVALID_OPERATION', retryable: false, detail: `event ${recordId} has no time` })
  if (override) return occurrenceOf(override, rowTimes(override)!, { id, master: row, original, recurring: true, override: true })
  const allDay = times.allDay
  const durationMs = allDay ? 0 : times.endMs! - times.startMs!
  const durationDays = allDay ? daysBetween(times.startDate!, times.endDate!) : 0
  const occTimes = allDay ? { allDay: true, startDate: original, endDate: addDays(original, durationDays) } : { allDay: false, startMs: Date.parse(original), endMs: Date.parse(original) + durationMs }
  return occurrenceOf(row, occTimes, { id, master: row, original, recurring: true })
}

/** The schedule page of the private Workspace: a Surface with the calendar and the to-do list side by side. */
export function scheduleBoardOps(locale: ScheduleLocale = 'zh'): Op[] {
  const folder = `${SCHEDULE_SURFACE_ID}-content`
  const title = scheduleLabel(locale, 'board')
  return [
    { op: 'entity.create', entity_id: folder, type_id: 'buckyos.container', parent_id: 'canvas-content', order_key: 'u', name: title, payload: { kind: 'folder', title, system: 'surface_content', surface_id: SCHEDULE_SURFACE_ID } },
    { op: 'entity.create', entity_id: SCHEDULE_SURFACE_ID, type_id: 'buckyos.container', parent_id: 'surfaces', order_key: 'a', name: title, payload: { kind: 'surface', layout: { mode: 'free' }, title, content_folder_id: folder } },
    { op: 'entity.create', entity_id: `${SCHEDULE_SURFACE_ID}-calendar`, type_id: 'buckyos.container', parent_id: SCHEDULE_SURFACE_ID, order_key: 'a', placement: { x: 40, y: 40, w: 880, h: 640 },
      payload: { kind: 'calendar', layout: { mode: 'data' }, title: scheduleLabel(locale, 'calendar_table'), bindings: { events: [{ entity_id: SCHEDULE_CALENDAR_ID }], todo: [{ entity_id: SCHEDULE_TODO_ID }] }, config: { view: 'week' } } },
    { op: 'entity.create', entity_id: `${SCHEDULE_SURFACE_ID}-todo`, type_id: 'buckyos.container', parent_id: SCHEDULE_SURFACE_ID, order_key: 'b', placement: { x: 960, y: 40, w: 420, h: 640 },
      payload: { kind: 'todo', layout: { mode: 'data' }, title: scheduleLabel(locale, 'todo_table'), bindings: { items: { entity_id: SCHEDULE_TODO_ID } }, config: { mode: 'list' } } },
  ]
}

export { isDate } from './aiws_rrule'
