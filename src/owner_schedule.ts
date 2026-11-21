import { AiwsFailure, aiwsReferenceUrl, parseAiwsReferenceUrl } from './aiworkspace_client'
import {
  ScheduleClient, eventPostponeOps, SCHEDULE_SURFACE_ID, type EventChange, type EventOccurrence,
  type EventTimes, type Json, type RecurrenceScope, type ScheduleTransport, type TodoItem,
} from './aiws_schedule'
import { isDate, isTimeZone, parseRRule } from './aiws_rrule'

type Slot = 'calendar' | 'todo'
type Params = Record<string, Json | undefined>
interface Invocation { idempotency_key?: string; method: string; params: Params }
interface Host {
  context: { owner_did: string; zone_did: string; tz?: string }
  call<T>(method: string, params: Record<string, unknown>): Promise<T>
}
interface Target {
  workspace_id?: string
  epoch?: string
  binding_revision: number
  idempotency_key: string
  record_id: string
  replay: boolean
}
interface Workspace { name?: string; former_name?: string; workspace_id: string; epoch: string; public_base?: string; owned_by_caller_user: boolean; owner?: boolean; head_seq: number }
interface RecordLocation { workspace_id: string; epoch: string; id: string; occurrence?: string }

function invalid(message: string): never {
  throw new AiwsFailure({ code: 'INVALID_ARGUMENT', detail: message, retryable: false })
}

function object(value: Json | undefined): Params {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('expected an object')
  return value
}
function required(value: Json | undefined, field: string): string {
  if (typeof value !== 'string' || !value.trim()) invalid(`${field} is required`)
  return value
}

export function instant(value: Json | undefined, field: string): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ||
      !isDate(value.slice(0, 10)) || !Number.isFinite(Date.parse(value))) invalid(`${field} requires an RFC 3339 instant with offset`)
  return Date.parse(value)
}

function times(input: Params): EventTimes | undefined {
  const { start, end, start_date, end_date } = input
  if (start_date !== undefined || end_date !== undefined) {
    if (start !== undefined || end !== undefined) invalid('choose either dates or instants')
    if (typeof start_date !== 'string' || !isDate(start_date) || typeof end_date !== 'string' || !isDate(end_date) || end_date < start_date) invalid('expected start_date and inclusive end_date')
    return { allDay: true, startDate: start_date, endDate: end_date }
  }
  if (start === undefined && end === undefined) return
  const from = instant(start, 'start'), to = instant(end, 'end')
  if (to <= from) invalid('end must follow start')
  return { allDay: false, start: new Date(from).toISOString(), end: new Date(to).toISOString() }
}

function location(raw: Json | undefined, slot: Slot, zone: string, owner: string): RecordLocation {
  const url = required(raw, 'record_ref')
  try {
    const parsed = parseAiwsReferenceUrl(url)
    const address = new URL(url)
    const query = address.searchParams
    const keys = [...query.keys()]
    if (address.username || address.password || address.port || address.hash || new Set(keys).size !== keys.length ||
        keys.some(k => !['zone','owner','epoch','binding_revision','selector','occurrence'].includes(k))) invalid('invalid record reference')
    const epoch = required(query.get('epoch'), 'epoch')
    const id = parsed.selector?.record_id
    if (!parsed.workspace_id || parsed.entity_id !== slot || parsed.mode !== 'live' || parsed.selector?.kind !== 'table_record' ||
        typeof id !== 'string' || !id || query.get('zone') !== zone || query.get('owner') !== owner) invalid('record_ref does not belong to this Zone and resource type')
    const occ = query.get('occurrence')
    if (occ && (slot !== 'calendar' || (!isDate(occ) && !Number.isFinite(instant(occ, 'occurrence'))))) invalid('invalid occurrence')
    return { workspace_id: parsed.workspace_id, epoch, id, occurrence: occ ?? undefined }
  } catch (error) {
    invalid(error instanceof Error ? error.message : 'invalid record_ref')
  }
}

function references(input: Params, action: string, slot: Slot, zone: string, owner: string): RecordLocation[] {
  if (action === 'list' || action === 'add') return []
  if (slot === 'todo' && action === 'rm' && input.record_refs !== undefined) {
    if (input.record_ref || !Array.isArray(input.record_refs) || !input.record_refs.length) invalid('use record_ref or a nonempty record_refs array')
    const refs = input.record_refs.map((value) => location(value, slot, zone, owner))
    if (refs.some((r) => r.workspace_id !== refs[0].workspace_id) || new Set(refs.map((r) => r.id)).size !== refs.length) invalid('record_refs must name distinct rows in one table')
    return refs
  }
  return [location(input.record_ref, slot, zone, owner)]
}

function links(ws: Workspace, slot: Slot, zone: string, owner: string, revision: number, id: string, occurrence?: string) {
  const url = new URL(aiwsReferenceUrl({ workspace_id: ws.workspace_id, entity_id: slot, selector: { kind: 'table_record', record_id: id }, mode: 'live' }))
  url.searchParams.set('zone', zone)
  url.searchParams.set('owner', owner)
  url.searchParams.set('epoch', ws.epoch)
  url.searchParams.set('binding_revision', String(revision))
  if (occurrence) url.searchParams.set('occurrence', occurrence)
  const query = new URLSearchParams({ id: SCHEDULE_SURFACE_ID, block: SCHEDULE_SURFACE_ID + '-' + slot, record: id })
  if (occurrence) query.set('occ', occurrence)
  return {
    record_ref: url.toString(),
    ...(ws.public_base ? { open_url: new URL('/workspace/surface?' + query, ws.public_base).toString() } : {}),
  }
}

function todoView(item: TodoItem) {
  const { title, status, due, order, done, done_at, ext } = item
  return { title, status, due, order, done, done_at, ext }
}
function eventView(o: EventOccurrence) {
  return {
    title: o.title, all_day: o.allDay, status: o.status, ext: o.ext,
    ...(o.allDay ? { start_date: o.startDate, end_date: o.endDate } : { start: new Date(o.startMs!).toISOString(), end: new Date(o.endMs!).toISOString() }),
    ...(o.recurring ? { recurring: true, original: o.original } : {}),
    ...(o.override ? { changed_once: true } : {}), ...(o.agentWritten ? { agent_written: true } : {}),
  }
}
function windowOf(input: Params, tz?: string) {
  const fromMs = instant(input.from, 'from'), toMs = instant(input.to, 'to')
  if (toMs <= fromMs || toMs - fromMs > 366 * 86400000) invalid('use a positive window of at most 366 days')
  const offset = String(input.from).slice(-6)
  const zone = input.tz ?? tz ?? (/^[+-]/.test(offset) ? offset : 'UTC')
  if (typeof zone !== 'string' || !isTimeZone(zone)) invalid('unknown calendar time zone')
  return { fromMs, toMs, viewerTz: zone }
}
function pageOf(input: Params) {
  const offset = input.cursor === undefined ? 0 : Number(input.cursor)
  const limit = input.limit ?? 100
  if ((input.cursor !== undefined && String(offset) !== input.cursor) || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || typeof limit !== 'number' || limit < 1 || limit > 1000) invalid('invalid pagination')
  return { offset, limit }
}

function calendarChange(p: Params, tz?: string): EventChange {
  const time = times(p)
  const ext = { ...(p.ext === undefined ? {} : object(p.ext)) } as Record<string, Json>
  if (p.location !== undefined) ext.location = p.location
  if (p.reminders !== undefined) {
    if (!Array.isArray(p.reminders) || !p.reminders.every((n) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0)) invalid('invalid reminders')
    ext.reminders = p.reminders.map((before_min) => ({ before_min }))
  }
  const repeat = p.rrule ?? ext.rrule
  if (repeat) {
    if (typeof repeat !== 'string') invalid('rrule requires a string')
    try { parseRRule(repeat) } catch (e) { invalid(String(e)) }
  }
  const zone = p.tz ?? ext.tz ?? (repeat && time && !time.allDay ? tz : undefined)
  if (zone !== undefined) {
    if (typeof zone !== 'string' || !isTimeZone(zone)) invalid('unknown repeat time zone')
    ext.tz = zone
  } else if (repeat && time && !time.allDay) {
    if (!String(p.start).endsWith('Z')) invalid('provide tz for a repeating timed event')
    ext.tz = 'UTC'
  }
  const values = { ...(p.title !== undefined ? { title: required(p.title, 'title') } : {}), ...(p.status !== undefined ? { status: required(p.status, 'status') } : {}) }
  return { times: time, values, ext_merge: ext, rrule: p.rrule as string | null | undefined }
}

function todoChange(p: Params) {
  if (p.due !== undefined && p.due !== null && (typeof p.due !== 'string' || !isDate(p.due))) invalid('due requires a date or null')
  const ext = { ...(p.ext === undefined ? {} : object(p.ext)) } as Record<string, Json>
  if (p.priority !== undefined) ext.priority = p.priority === 'none' ? null : p.priority
  return { ...(p.title !== undefined ? { title: required(p.title, 'title') } : {}),
    ...(p.status !== undefined ? { status: required(p.status, 'status') } : {}), due: p.due as string | null | undefined, ext_merge: ext }
}

async function invoke(slot: Slot, request: Invocation, host: Host): Promise<unknown> {
  const { method, params: p } = request
  const zone = host.context.zone_did
  const identity = { owner_did: host.context.owner_did }
  const read = method === 'list'
  const pagination = read ? pageOf(p) : undefined
  const window = slot === 'calendar' && read ? windowOf(p, host.context.tz) : undefined
  const input = method === 'update' ? object(p.patch) : p
  const change = !read && slot === 'calendar' ? calendarChange(input, host.context.tz) : undefined
  const todo = !read && slot === 'todo' ? todoChange(input) : undefined
  if (method === 'add') {
    required(p.title, 'title')
    if (slot === 'calendar' && !change?.times) invalid('add requires a time or all-day date range')
  }
  if (p.before !== undefined && p.after !== undefined) invalid('choose only one placement anchor')
  const prepared = await host.call<Target | { result: unknown }>('owner.prepare', { slot })
  if ('result' in prepared) return prepared.result
  const base = { ...identity, binding_revision: prepared.binding_revision }
  const owner = host.context.owner_did
  const refs = references(p, method, slot, zone, owner)
  const before = p.before === undefined ? undefined : location(p.before, slot, zone, owner)
  const after = p.after === undefined ? undefined : location(p.after, slot, zone, owner)
  const locations = [...refs, ...[before, after].filter((a): a is RecordLocation => Boolean(a))]
  const transport: ScheduleTransport = { call: async <T>(m: string, params: Record<string, unknown>) => {
    type Reply = T & { ok?: boolean; status?: string; code?: string; error?: ConstructorParameters<typeof AiwsFailure>[0] }
    let response: Reply
    try {
      response = await host.call<Reply>('aiws.' + m, params)
      const code = response.error?.code ?? response.code
      if (m === 'doc.commit' && (['STORAGE_IO_ERROR','WRITE_OUTCOME_UNKNOWN','IDEMPOTENCY_MISMATCH'].includes(code ?? ''))) throw new Error(code)
    } catch (error) {
      if (m !== 'doc.commit') throw error
      const cause = error as { code?: string }
      if (cause.code && !['WRITE_OUTCOME_UNKNOWN','PROVIDER_UNAVAILABLE','TRANSPORT_ERROR','STORAGE_IO_ERROR','TIMEOUT'].includes(cause.code)) throw error
      const { workspace_id, epoch, idempotency_key } = params
      try {
        const tableWrite = Array.isArray(params.operations) && params.operations.every(op => String(op.op).startsWith('table.'))
        const found = await host.call<{ status: string; result?: Reply }>('aiws.doc.get_submission', {
          workspace_id, epoch, idempotency_key, ...(tableWrite ? { source_id: slot } : {}),
        })
        if (found.status === 'accepted') return (found.result ?? { status: 'accepted' }) as T
      } catch (checkError) {
        if (['PERMISSION_DENIED','AUTH_REQUIRED','UNAUTHORIZED'].includes(String((checkError as {code?: string}).code))) throw checkError
      }
      throw new AiwsFailure({ code: 'WRITE_OUTCOME_UNKNOWN', detail: 'the service could not confirm the submission', retryable: false, data: { idempotency_key, workspace_id } })
    }
    if (response.ok === false && response.error) throw new AiwsFailure(response.error)
    return response
  } }
  let workspaceId = prepared.workspace_id ?? refs[0]?.workspace_id
  if (!workspaceId) {
    if (read || before || after) {
      const ws = await transport.call<{ found: boolean; workspace_id: string }>('ws.lookup', { name: 'schedule' })
      if (ws.found === false && !read) invalid('placement anchor requires an existing personal schedule')
      if (ws.found === false) return { ...base, initialized: false, [slot === 'calendar' ? 'events' : 'items']: [], next_cursor: null }
      if (ws.found !== true || !ws.workspace_id) throw new AiwsFailure({ code: 'INVALID_SERVICE_RESPONSE', retryable: false, detail: 'invalid workspace lookup result' })
      workspaceId = ws.workspace_id
    } else {
      const ws = await transport.call<{ workspace_id: string }>('ws.ensure', { name: 'schedule', title: '我的日程' })
      workspaceId = ws.workspace_id
    }
  }
  const businessKey = request.idempotency_key ?? prepared.idempotency_key
  const inputKey = 'xcall:' + slot + ':' + method + ':' + businessKey
  const key = read ? '' : /^[\x21-\x7e]{1,110}$/.test(inputKey) ? inputKey :
    'xcall:' + Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(inputKey))), b => b.toString(16).padStart(2, '0')).join('')
  const allocated = prepared.record_id
  const client = new ScheduleClient(transport, { idempotencyKey: key, newRecordId: () => allocated })
  async function workspace(id: string) {
    const ws = await transport.call<Workspace>('ws.get_info', { workspace_id: id })
    if (ws.workspace_id !== id || !ws.owned_by_caller_user || (ws.name !== 'schedule' && ws.former_name !== 'schedule')) {
      throw new AiwsFailure({ code: 'PERMISSION_DENIED', detail: 'workspace is outside the owner’s personal schedule', retryable: false })
    }
    for (const loc of locations) {
      if (loc.workspace_id !== ws.workspace_id) invalid('record reference belongs to another workspace')
      if (loc.epoch !== ws.epoch) throw new AiwsFailure({ code: 'EPOCH_MISMATCH', detail: 'record reference belongs to an earlier workspace history', retryable: false })
    }
    return ws
  }
  let ws = await workspace(workspaceId)
  if (!read) {
    const pinned = await host.call<{ workspace_id: string; epoch: string }>('owner.pin', { slot, workspace_id: ws.workspace_id, epoch: ws.epoch })
    if (pinned.workspace_id !== ws.workspace_id) ws = await workspace(pinned.workspace_id)
    if (pinned.epoch !== ws.epoch) throw new AiwsFailure({ code: 'WRITE_OUTCOME_UNKNOWN', detail: 'original workspace epoch has changed', retryable: false, data: { idempotency_key: key } })
  }
  const link = (id: string, occ?: string) => links(ws, slot, zone, owner, prepared.binding_revision, id, occ)
  const ref = refs[0]
  const id = ref?.occurrence ? ref.id + '@' + ref.occurrence : ref?.id
  const receipt = (resultId?: string, occurrence?: string) => ({
    ...base, idempotency_key: businessKey, status: method === 'add' ? 'created' : method === 'rm' ? 'removed' : 'updated',
    ...(resultId ? link(resultId, occurrence) : {}), ...(method === 'rm' && slot === 'todo' ? { removed: refs.length } : {}),
  })
  let initialize = method === 'add'
  if (initialize && prepared.replay) {
    // A confirmed original write must not recreate a deleted table or board on replay.
    const prior = await transport.call<{ status: string }>('doc.get_submission', {
      workspace_id: ws.workspace_id, epoch: ws.epoch, idempotency_key: key,
    })
    if (!['accepted','not_found'].includes(prior.status)) throw new AiwsFailure({ code: 'WRITE_OUTCOME_UNKNOWN', detail: 'cannot confirm the original write', retryable: false, data: { idempotency_key: key } })
    initialize = prior.status === 'not_found'
  }
  await client.open(ws, initialize)
  try {
    const meta = await transport.call<{ schema_id: string; capabilities: string[] }>('doc.read', { workspace_id: ws.workspace_id, entity_id: slot, as: 'meta' })
    if (meta.schema_id !== 'buckyos.' + slot + '@1') throw new AiwsFailure({ code: 'RESOURCE_TYPE_MISMATCH', detail: 'unexpected table schema', retryable: false })
    // A no-op update still requires the ability to edit. Recurrence changes may insert or delete
    // overrides, so the commit (and submission replay) checks the exact capabilities for its operations.
    if (slot === 'todo' && ['done','undone','update','move'].includes(method) && !meta.capabilities.includes('update')) {
      throw new AiwsFailure({ code: 'PERMISSION_DENIED', detail: 'table update permission required', retryable: false })
    }
  } catch (error) {
    if (read && (ws.owner === true || ws.head_seq === 0) && ['NOT_FOUND','TARGET_DELETED'].includes(String((error as { code?: string }).code))) {
      return { ...base, initialized: false, [slot === 'todo' ? 'items' : 'events']: [], next_cursor: null }
    }
    throw error
  }
  if (prepared.replay && !read) {
    const sub = await transport.call<{ status: string; inserted?: string[]; changed?: string[] }>('doc.get_submission', {
      workspace_id: ws.workspace_id, epoch: ws.epoch, idempotency_key: key, source_id: slot,
    })
    if (sub.status === 'accepted') {
      if (method === 'add') return receipt(allocated)
      if (['update', 'postpone'].includes(method) && slot === 'calendar') return receipt(sub.inserted?.[0] ?? sub.changed?.[0] ?? ref.id)
      return receipt(ref.id, ref.occurrence)
    }
    if (sub.status !== 'not_found') throw new AiwsFailure({ code: 'WRITE_OUTCOME_UNKNOWN', detail: 'provider could not confirm submission', retryable: false, data: { idempotency_key: key } })
  }
  if (read) {
    const all = slot === 'todo'
      ? (await client.todos({ includeDone: p.include_done === true })).map((item) => ({ ...todoView(item), ...link(item.record_id) }))
      : (await client.events(window!, window!)).map((o) => ({ ...eventView(o), ...link(o.master?.record_id ?? o.row.record_id, o.original) }))
    const { offset, limit } = pagination!
    return { ...base, initialized: true, [slot === 'todo' ? 'items' : 'events']: all.slice(offset, offset + limit), next_cursor: offset + limit < all.length ? String(offset + limit) : null }
  }
  if (slot === 'todo') {
    const place = { before: before?.id, after: after?.id }
    switch (method) {
      case 'add': {
        const item = await client.addTodo({ ...todo!, title: required(p.title, 'title'), record_id: allocated, ext: todo!.ext_merge }, place)
        return receipt(item.record_id)
      }
      case 'done': case 'undone': await client.completeTodo(id, method === 'done'); break
      case 'update': await client.updateTodo(id, todo!); break
      case 'move': await client.moveTodo(id, { status: todo!.status, ...place }); break
      case 'rm': await client.removeTodos(refs.map((r) => r.id)); break
      default: invalid('unknown to-do action')
    }
    return receipt(id)
  }
  const scope = (p.scope ?? 'one') as RecurrenceScope
  switch (method) {
    case 'add': {
      const t = change!.times!
      const ext = { ...change!.ext_merge, ...(change!.rrule ? { rrule: change!.rrule } : {}) }
      const event = await client.addEvent({ ...change!.values, title: required(p.title, 'title'), record_id: allocated, ext,
        ...(t.allDay ? { all_day: true, start_date: t.startDate, end_date: t.endDate } : { start: t.start, end: t.end }) })
      return receipt(event)
    }
    case 'update': return receipt(await client.editEvent(id, change!, scope))
    case 'rm': case 'skip': await client.deleteEvent(id, method === 'skip' ? 'one' : scope); return receipt(ref.id, ref.occurrence)
    case 'postpone': {
      if (typeof p.minutes !== 'number' || !Number.isSafeInteger(p.minutes) || p.minutes <= 0) invalid('minutes must be positive')
      const { occ, rows } = await client.occurrence(id)
      const { ops, record_id } = eventPostponeOps(slot, occ, p.minutes, { rows, newRecordId: () => allocated })
      if (ops.length) await client.commit(ops, 'postpone occurrence')
      return receipt(record_id)
    }
    default: invalid('unknown calendar action')
  }
}

export async function scheduleAction(slot: Slot, request: Invocation, host: Host) {
  try {
    return { result: await invoke(slot, request, host) }
  } catch (error) {
    const e = error as { code?: string; message?: string; details?: unknown; data?: unknown }
    return { error: { code: e.code ?? 'PROVIDER_UNAVAILABLE', message: e.message ?? String(error), details: e.details ?? e.data ?? null } }
  }
}
