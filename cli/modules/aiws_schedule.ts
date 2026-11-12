import { AiwsFailure, calendarOccurrences, localDate, ScheduleClient, viewerTimeZone } from 'buckyos/node'
import type { CommandDefinition, JsonSchema, OptionDefinition } from '../core/command.ts'
import type { CommandContext } from '../core/context.ts'
import { ToolError, UsageError } from '../core/errors.ts'
import { callService, expectObject, inputString, requiredInputString } from '../core/service.ts'

// The person's private schedule in AI Workspace (buckyos notepads/aiworkspace-control-mechanism-todo.md G9, G11): the
// Workspace named `schedule`, its to-do table `todo` and calendar table `calendar` (created on first use), read and
// changed with the same operations the official to-do and calendar controls use (buckyos-websdk aiws_schedule.ts).
// What the controls show changes at once. Times are RFC 3339 instants or YYYY-MM-DD dates.

const OBJECT_OUTPUT: JsonSchema = { type: 'object', additionalProperties: true }

// the module's types, as its functions declare them (the CLI reads the SDK's built JavaScript)
type EventOccurrence = ReturnType<typeof calendarOccurrences>[number]
type TodoItem = Awaited<ReturnType<ScheduleClient['todos']>>[number]
type EventChange = Parameters<ScheduleClient['editEvent']>[1]
type RecurrenceScope = NonNullable<Parameters<ScheduleClient['editEvent']>[2]>

function schedule(ctx: CommandContext): ScheduleClient {
  return new ScheduleClient({
    call: async <T,>(method: string, params: Record<string, unknown>): Promise<T> => {
      const result = expectObject(await callService<unknown>(ctx, 'aiworkspace', method, params), method)
      if (result.ok === false) {
        const error = expectObject(result.error, `${method}.error`)
        throw new AiwsFailure({ code: String(error.code ?? 'AIWS_ERROR'), retryable: Boolean(error.retryable), detail: String(error.detail ?? error.code ?? ''), sub_code: typeof error.sub_code === 'string' ? error.sub_code : undefined, data: error.data })
      }
      return result as T
    },
  }, { locale: /^zh/i.test(Intl.DateTimeFormat().resolvedOptions().locale) ? 'zh' : 'en' })
}

/** A service refusal as the CLI's error (its code first, so an Agent can branch on it). */
async function run<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof AiwsFailure) throw new ToolError(error.code, error.message, undefined, false, { ...(error.subCode ? { sub_code: error.subCode } : {}), ...(error.data !== undefined ? { data: error.data } : {}) })
    throw error
  }
}

const todoView = (i: TodoItem) => ({ id: i.record_id, title: i.title, status: i.status, done: i.done, due: i.due, order: i.order, ...(i.done_at ? { done_at: i.done_at } : {}), ...(Object.keys(i.ext).length ? { ext: i.ext } : {}) })

const eventView = (o: EventOccurrence) => ({
  id: o.id, record_id: o.row.record_id, title: o.title, all_day: o.allDay,
  ...(o.allDay ? { start_date: o.startDate, end_date: o.endDate } : { start: new Date(o.startMs!).toISOString(), end: new Date(o.endMs!).toISOString() }),
  ...(o.recurring ? { recurring: true, original: o.original } : {}), ...(o.override ? { changed_once: true } : {}), ...(o.agentWritten ? { agent_written: true } : {}),
  ...(o.status ? { status: o.status } : {}), ...(Object.keys(o.ext).length ? { ext: o.ext } : {}),
})

const DATE = /^\d{4}-\d{2}-\d{2}$/

function parseExt(input: Record<string, unknown>): Record<string, unknown> | undefined {
  const text = inputString(input, 'ext')
  if (!text) return undefined
  const ext = JSON.parse(text) as unknown
  if (!ext || typeof ext !== 'object' || Array.isArray(ext)) throw new UsageError('AIWS_USAGE', '--ext must be a JSON object')
  return ext as Record<string, unknown>
}

const ID: OptionDefinition = { name: 'id', property: 'id', description: 'To-do record id (`todo list` shows them)', type: 'string' }

export const todoCommand: CommandDefinition = {
  verb: 'todo',
  summary: 'Your to-do list (the private schedule Workspace): list | add | done | undone | update | move | rm',
  description: 'The to-dos are records of the table `todo` in your Workspace named `schedule` (created on first use); the to-do control shows every change at once. Status is a board column (`todo`, `doing`, `done` unless columns were added); `done` completes.',
  positionals: [{ name: 'action', description: 'list | add | done | undone | update | move | rm', required: true }, { name: 'title', description: 'add: the title', required: false }],
  options: [
    ID,
    { name: 'all', property: 'all', description: 'list: completed ones too', type: 'boolean' },
    { name: 'title', property: 'new_title', description: 'update: the new title', type: 'string' },
    { name: 'status', property: 'status', description: 'add / update / move: the status (board column) option id', type: 'string' },
    { name: 'due', property: 'due', description: 'add / update: due date YYYY-MM-DD (update: "none" clears it)', type: 'string' },
    { name: 'priority', property: 'priority', description: 'add / update: low | normal | high | urgent | none', type: 'string', enum: ['low', 'normal', 'high', 'urgent', 'none'] },
    { name: 'before', property: 'before', description: 'add / move: place before this to-do id', type: 'string' },
    { name: 'after', property: 'after', description: 'add / move: place after this to-do id', type: 'string' },
    { name: 'ext', property: 'ext', description: 'add / update: extension fields JSON (merged on update; null removes a key)', type: 'string' },
  ],
  inputSchema: {
    type: 'object',
    properties: { action: { type: 'string', enum: ['list', 'add', 'done', 'undone', 'update', 'move', 'rm'] }, title: { type: 'string' }, id: { type: 'string' }, all: { type: 'boolean' }, new_title: { type: 'string' }, status: { type: 'string' }, due: { type: 'string' }, priority: { type: 'string' }, before: { type: 'string' }, after: { type: 'string' }, ext: { type: 'string' } },
    required: ['action'], additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: { mode: 'fixed', level: 'write' },
  asyncMode: 'sync',
  requiresSession: true,
  examples: [
    'buckyos aiws todo list',
    'buckyos aiws todo add "Renew the passport" --due 2026-12-01 --priority high',
    'buckyos aiws todo done --id t…',
    'buckyos aiws todo move --id t… --status doing --before t…',
  ],
  handler: (ctx, input) => run(async () => {
    const s = schedule(ctx)
    const action = requiredInputString(input, 'action')
    const id = () => requiredInputString(input, 'id')
    const due = inputString(input, 'due')
    if (due && due !== 'none' && !DATE.test(due)) throw new UsageError('AIWS_USAGE', '--due must be YYYY-MM-DD')
    const priority = inputString(input, 'priority')
    switch (action) {
      case 'list': {
        const handle = await s.ensure()
        const items = await s.todos({ includeDone: input.all === true })
        return { workspace_id: handle.workspace_id, table: handle.todo, items: items.map(todoView) }
      }
      case 'add': {
        const title = requiredInputString(input, 'title')
        const ext = { ...(parseExt(input) ?? {}), ...(priority && priority !== 'none' ? { priority } : {}) }
        const item = await s.addTodo({ title, status: inputString(input, 'status') ?? undefined, due: due && due !== 'none' ? due : undefined, ext: ext as never }, { before: inputString(input, 'before') ?? undefined, after: inputString(input, 'after') ?? undefined })
        return { item: todoView(item) }
      }
      case 'done': case 'undone': await s.completeTodo(id(), action === 'done'); return { ok: true, id: id(), done: action === 'done' }
      case 'update': {
        const ext = parseExt(input)
        const merge: Record<string, unknown> = { ...(ext ?? {}) }
        if (priority) merge.priority = priority === 'none' ? null : priority
        await s.updateTodo(id(), { ...(inputString(input, 'new_title') ? { title: inputString(input, 'new_title')! } : {}), ...(inputString(input, 'status') ? { status: inputString(input, 'status')! } : {}), ...(due ? { due: due === 'none' ? null : due } : {}), ...(Object.keys(merge).length ? { ext_merge: merge as never } : {}) })
        return { ok: true, id: id() }
      }
      case 'move': await s.moveTodo(id(), { status: inputString(input, 'status') ?? undefined, before: inputString(input, 'before') ?? undefined, after: inputString(input, 'after') ?? undefined }); return { ok: true, id: id() }
      case 'rm': { const ids = id().split(',').map((x) => x.trim()).filter(Boolean); await s.removeTodos(ids); return { ok: true, removed: ids } }
      default: throw new UsageError('AIWS_USAGE', `todo: unknown action ${action}`)
    }
  }),
}

const SCOPE: OptionDefinition = { name: 'scope', property: 'scope', description: 'A repeating event: one (only this occurrence, default) | following (this and later) | all', type: 'string', enum: ['one', 'following', 'all'] }

export const calCommand: CommandDefinition = {
  verb: 'cal',
  summary: 'Your calendar (the private schedule Workspace): list | add | update | rm | skip | postpone',
  description: 'Events are records of the table `calendar` in your Workspace named `schedule`. A repeating event has `ext.rrule` (iCalendar RRULE subset: FREQ DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL, COUNT or UNTIL, BYDAY with -1FR style ordinals, BYMONTHDAY, BYMONTH, BYSETPOS); `list` expands it and names each occurrence `<record_id>@<original start>` — pass that id to change, skip or postpone one occurrence. Rules the subset cannot express go to ext.rule_text with ext.occurrences written by you.',
  positionals: [{ name: 'action', description: 'list | add | update | rm | skip | postpone', required: true }, { name: 'title', description: 'add: the title', required: false }],
  options: [
    { name: 'id', property: 'id', description: 'Event id or occurrence id (`cal list` shows them)', type: 'string' },
    { name: 'from', property: 'from', description: 'list: first day YYYY-MM-DD (default today)', type: 'string' },
    { name: 'days', property: 'days', description: 'list: how many days (default 7, ≤ 366)', type: 'integer' },
    { name: 'start', property: 'start', description: 'add / update: start, RFC 3339 instant (timed) or YYYY-MM-DD (all-day)', type: 'string' },
    { name: 'end', property: 'end', description: 'add / update: end, same form as --start (all-day: the last day, inclusive)', type: 'string' },
    { name: 'title', property: 'new_title', description: 'update: the new title', type: 'string' },
    { name: 'rrule', property: 'rrule', description: 'add / update: repeat rule, e.g. FREQ=WEEKLY;BYDAY=MO,WE ("none" stops repeating)', type: 'string' },
    { name: 'tz', property: 'tz', description: 'add: the IANA time zone a series repeats in (default this machine’s)', type: 'string' },
    { name: 'location', property: 'location', description: 'add / update: where', type: 'string' },
    { name: 'reminder', property: 'reminder', description: 'add: minutes before to remind, comma separated (e.g. 10,1440)', type: 'string' },
    { name: 'minutes', property: 'minutes', description: 'postpone: by how many minutes', type: 'integer' },
    { name: 'ext', property: 'ext', description: 'add / update: extension fields JSON (merged on update; null removes a key)', type: 'string' },
    SCOPE,
  ],
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'add', 'update', 'rm', 'skip', 'postpone'] }, title: { type: 'string' }, id: { type: 'string' }, from: { type: 'string' }, days: { type: 'integer' },
      start: { type: 'string' }, end: { type: 'string' }, new_title: { type: 'string' }, rrule: { type: 'string' }, tz: { type: 'string' }, location: { type: 'string' }, reminder: { type: 'string' },
      minutes: { type: 'integer' }, ext: { type: 'string' }, scope: { type: 'string', enum: ['one', 'following', 'all'] },
    },
    required: ['action'], additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: { mode: 'fixed', level: 'write' },
  asyncMode: 'sync',
  requiresSession: true,
  examples: [
    'buckyos aiws cal list --days 14',
    'buckyos aiws cal add "Stand-up" --start 2026-11-16T09:00:00+08:00 --end 2026-11-16T09:15:00+08:00 --rrule "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"',
    'buckyos aiws cal add "Trip" --start 2026-11-20 --end 2026-11-22',
    'buckyos aiws cal skip --id e…@2026-11-18T01:00:00.000Z',
    'buckyos aiws cal update --id e…@2026-11-18T01:00:00.000Z --start 2026-11-18T10:00:00+08:00 --end 2026-11-18T10:15:00+08:00 --scope following',
  ],
  handler: (ctx, input) => run(async () => {
    const s = schedule(ctx)
    const action = requiredInputString(input, 'action')
    const tz = viewerTimeZone()
    const scope = (inputString(input, 'scope') ?? 'one') as RecurrenceScope
    const times = (): EventChange['times'] | undefined => {
      const start = inputString(input, 'start'), end = inputString(input, 'end')
      if (!start && !end) return undefined
      if (!start) throw new UsageError('AIWS_USAGE', '--end needs --start')
      if (DATE.test(start)) {
        const last = end ?? start
        if (!DATE.test(last)) throw new UsageError('AIWS_USAGE', 'an all-day event takes dates for --start and --end')
        return { allDay: true, startDate: start, endDate: last }
      }
      const s0 = Date.parse(start)
      const e0 = end ? Date.parse(end) : s0 + 3600_000
      if (!Number.isFinite(s0) || !Number.isFinite(e0)) throw new UsageError('AIWS_USAGE', '--start / --end must be RFC 3339 instants with an offset (or dates for all-day)')
      return { allDay: false, start: new Date(s0).toISOString(), end: new Date(e0).toISOString() }
    }
    switch (action) {
      case 'list': {
        const handle = await s.ensure()
        const from = inputString(input, 'from') ?? localDate(Date.now(), tz)
        if (!DATE.test(from)) throw new UsageError('AIWS_USAGE', '--from must be YYYY-MM-DD')
        const days = typeof input.days === 'number' ? Math.max(1, Math.min(366, input.days)) : 7
        const fromMs = Date.parse(`${from}T00:00:00Z`) - 14 * 3600_000
        const window = { fromMs, toMs: fromMs + days * 86_400_000 + 28 * 3600_000 }
        const rows = await s.rows(handle.calendar)
        const last = localDate(Date.parse(`${from}T12:00:00Z`) + (days - 1) * 86_400_000, 'UTC')
        // only what touches the asked days on this machine's calendar
        const occ = calendarOccurrences(rows, window, { viewerTz: tz }).filter((o) => (o.allDay ? o.endDate! >= from && o.startDate! <= last : localDate(o.endMs!, tz) >= from && localDate(o.startMs!, tz) <= last))
        return { workspace_id: handle.workspace_id, table: handle.calendar, from, days, time_zone: tz, events: occ.map(eventView) }
      }
      case 'add': {
        const title = requiredInputString(input, 'title')
        const t = times()
        if (!t) throw new UsageError('AIWS_USAGE', 'add needs --start')
        const ext: Record<string, unknown> = { ...(parseExt(input) ?? {}) }
        const rrule = inputString(input, 'rrule')
        if (rrule && rrule !== 'none') { ext.rrule = rrule; ext.tz = inputString(input, 'tz') ?? tz }
        const location = inputString(input, 'location')
        if (location) ext.location = location
        const reminder = inputString(input, 'reminder')
        if (reminder) ext.reminders = reminder.split(',').map((m) => ({ before_min: Number(m.trim()) })).filter((r) => Number.isFinite(r.before_min))
        const id = await s.addEvent(t.allDay
          ? { title, all_day: true, start_date: t.startDate, end_date: t.endDate, ext: ext as never }
          : { title, start: t.start, end: t.end, ext: ext as never })
        return { ok: true, id }
      }
      case 'update': {
        const change: EventChange = {}
        const t = times()
        if (t) change.times = t
        const title = inputString(input, 'new_title')
        if (title) change.values = { title }
        const merge: Record<string, unknown> = { ...(parseExt(input) ?? {}) }
        const location = inputString(input, 'location')
        if (location !== undefined && location !== null) merge.location = location || null
        if (Object.keys(merge).length) change.ext_merge = merge as never
        const rrule = inputString(input, 'rrule')
        if (rrule) change.rrule = rrule === 'none' ? null : rrule
        const id = await s.editEvent(requiredInputString(input, 'id'), change, scope)
        return { ok: true, id }
      }
      case 'rm': await s.deleteEvent(requiredInputString(input, 'id'), scope); return { ok: true }
      case 'skip': await s.deleteEvent(requiredInputString(input, 'id'), 'one'); return { ok: true }
      case 'postpone': {
        const minutes = typeof input.minutes === 'number' ? input.minutes : 0
        if (minutes <= 0) throw new UsageError('AIWS_USAGE', 'postpone needs --minutes')
        const { occ } = await s.occurrence(requiredInputString(input, 'id'))
        const change: EventChange = occ.allDay
          ? { times: { allDay: true, startDate: shiftDate(occ.startDate!, Math.max(1, Math.round(minutes / 1440))), endDate: shiftDate(occ.endDate!, Math.max(1, Math.round(minutes / 1440))) } }
          : { times: { allDay: false, start: new Date(occ.startMs! + minutes * 60_000).toISOString(), end: new Date(occ.endMs! + minutes * 60_000).toISOString() } }
        const id = await s.editEvent(requiredInputString(input, 'id'), change, 'one')
        return { ok: true, id }
      }
      default: throw new UsageError('AIWS_USAGE', `cal: unknown action ${action}`)
    }
  }),
}

function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}
