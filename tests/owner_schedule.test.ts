import { scheduleAction } from '../src/owner_schedule'
import { freeBusy } from '../src/owner_availability'
import { findOccurrence, type RowLike } from '../src/aiws_schedule'

const window = { from: '2026-11-20T00:00:00+08:00', to: '2026-11-21T00:00:00+08:00' }
const context = { owner_did: 'did:bns:alice', zone_did: 'did:bns:example' }
function host(run: (method: string, params: Record<string, unknown>) => unknown) {
  return { context, async call<T>(method: string, params: Record<string, unknown>): Promise<T> { return run(method, params) as T } }
}

test('missing schedule lists empty using only a name lookup, preserving lookup refusals', async () => {
  const calls: string[] = []
  const empty = host((method) => {
    calls.push(method)
    return method === 'owner.prepare' ? { binding_revision: 0 } : { found: false }
  })
  const req = { method: 'list', params: window }
  expect(await scheduleAction('calendar', req, empty)).toEqual({ result: { ...{ owner_did: context.owner_did }, binding_revision: 0, events: [], next_cursor: null, initialized: false } })
  expect(calls).toEqual(['owner.prepare', 'aiws.ws.lookup'])
  const denied = host(m => m === 'owner.prepare' ? {} : {ok: false, error: { code: 'PERMISSION_DENIED', detail: 'denied' }})
  expect(await scheduleAction('calendar', req, denied)).toMatchObject({error: {code: 'PERMISSION_DENIED'}})
})

test('external binding returns its receipt, and refuses without touching native storage', async () => {
  const external = { record_ref: 'https://external.example/records/1', status: 'created' }
  for (const denied of [true, false]) {
    const calls: string[] = []
    const ctx = host(m => {
      calls.push(m)
      if (denied) throw Object.assign(new Error('disabled'), {code:'RESOURCE_DISABLED'})
      return { result: external }
    })
    const r = await scheduleAction('todo', { method: 'add', params: { title: 'Demo' } }, ctx)
    expect(r).toMatchObject(denied ? {error: {code:'RESOURCE_DISABLED'}} : {result: external})
    expect(calls).toEqual(['owner.prepare'])
  }
})

test('free_busy clips, merges, projects and handles all-day dates in the owner calendar', () => {
  const rows: RowLike[] = [
    { record_id: 'private', values: { title: 'secret', all_day: true, start_date: '2026-11-20' } },
    { record_id: 'timed', values: { title: 'meeting', start: '2026-11-19T15:00:00Z', end: '2026-11-19T18:00:00Z' } },
  ]
  expect(freeBusy({ ...window, tz: 'Asia/Shanghai', rows })).toEqual({
    intervals: [{ start: '2026-11-19T16:00:00.000Z', end: '2026-11-20T16:00:00.000Z' }], coverage: 'complete',
  })
  expect(freeBusy({ ...window, rows }).coverage).toBe('partial')
  expect(freeBusy({ ...window, rows: [], truncated: true })).toEqual({intervals: [], coverage: 'partial'})
  expect(freeBusy({ ...window, rows: [] })).toEqual({intervals: [], coverage: 'complete'})
  expect(freeBusy({ ...window, rows: [{record_id:'bad',values:{ start:'local date' }}] }).coverage).toBe('partial')
})

test('an excluded original or a date outside the series cannot be modified', () => {
  const row: RowLike = {record_id:'series', values:{all_day:true,start_date:'2026-11-20',ext:{rrule:'FREQ=DAILY;COUNT=2', exdate:['2026-11-21']}}}
  expect(findOccurrence([row], 'series@2026-11-20').id).toBe('series@2026-11-20')
  expect(() => findOccurrence([row], 'series@2026-11-21')).toThrow('NOT_FOUND')
  expect(() => findOccurrence([row], 'series@2026-11-22')).toThrow('NOT_FOUND')
})

test('repeating instants preserve fractional seconds and advance through the spring DST gap', () => {
  const row: RowLike = {record_id:'dst',values:{ start:'2026-03-07T02:30:00.125-08:00',end:'2026-03-07T02:45:00.125-08:00',ext:{ rrule:'FREQ=DAILY',tz:'America/Los_Angeles' } }}
  const result = freeBusy({ rows:[row], from:'2026-03-08T00:00:00-08:00',to:'2026-03-09T00:00:00-07:00' })
  expect(result).toEqual({ coverage:'complete', intervals:[{start:'2026-03-08T10:30:00.125Z',end:'2026-03-08T10:45:00.125Z'}] })
})

test('an unbounded series with over 2000 overlapping instances reports partial coverage', () => {
  const row: RowLike = {record_id:'long',values:{start:'2010-01-01T09:00:00Z',end:'2026-01-01T10:00:00Z',ext:{rrule:'FREQ=DAILY',tz:'UTC'}}}
  expect(freeBusy({ ...window, rows:[row] }).coverage).toBe('partial')
})

test('native receipts bind the subject, workspace, epoch and standard table before a mutation', async () => {
  const info = { workspace_id: 'ws_2611abcd', name: 'schedule', epoch: 'history-one', owned_by_caller_user: true }
  const reference = async () => {
    const reader = host(method => {
      switch (method) {
        case 'owner.prepare': return { binding_revision: 2 }
        case 'aiws.ws.lookup': return { found: true, workspace_id: info.workspace_id }
        case 'aiws.ws.get_info': return info
        case 'aiws.doc.read': return { schema_id: 'buckyos.todo@1', capabilities: ['read'] }
        case 'aiws.doc.query': return { rows: [[{record_id: 'shared-id', values: {title: 'Existing', status: 'todo'}}]] }
        default: throw new Error(method)
      }
    })
    const reply = await scheduleAction('todo', { method: 'list', params: {} }, reader)
    const { items } = reply.result as { items: { record_ref: string }[] }
    return new URL(items[0].record_ref)
  }
  const ref = await reference()
  expect(ref.searchParams.get('epoch')).toBe(info.epoch)
  expect(ref.searchParams.get('owner')).toBe(context.owner_did)
  expect(ref.searchParams.get('binding_revision')).toBe('2')
  const input = (mutate?: (url: URL) => void) => {
    const r = new URL(ref)
    mutate?.(r)
    return { method: 'done', params: { record_ref: r.href } }
  }
  const probe = async (request: Parameters<typeof scheduleAction>[1], changes = {}, schema = 'buckyos.todo@1', caps = ['read','update']) => {
    const calls: string[] = []
    const writer = host(method => {
      calls.push(method)
      switch (method) {
        case 'owner.prepare': return {binding_revision: 2, idempotency_key: 'key', record_id: 'allocated'}
        case 'aiws.ws.lookup': return { found: true, workspace_id: info.workspace_id }
        case 'aiws.ws.get_info': return { ...info, ...changes }
        case 'owner.pin': return { workspace_id: info.workspace_id, epoch: info.epoch }
        case 'aiws.doc.read':
          if (calls.filter(c => c === method).length === 1) return { schema_id: schema, capabilities: caps }
          return { content: {record_id: 'shared-id', values: {title: 'Existing', status: 'todo'}} }
        case 'aiws.doc.commit': return { status: 'accepted' }
        default: throw new Error(method)
      }
    })
    const result = await scheduleAction('todo', request, writer)
    return { code: result.error?.code, calls }
  }
  const cases = [
    [await probe(input(u => u.searchParams.set('owner', 'did:bns:bob'))), 'INVALID_ARGUMENT'],
    [await probe(input(u => u.searchParams.set('zone', 'did:bns:elsewhere'))), 'INVALID_ARGUMENT'],
    [await probe(input(u => u.pathname = u.pathname.replace('/todo','/calendar'))), 'INVALID_ARGUMENT'],
    [await probe(input(u => u.searchParams.delete('epoch'))), 'INVALID_ARGUMENT'],
    [await probe(input(), { epoch: 'restored-history' }), 'EPOCH_MISMATCH'],
    [await probe(input(), { owned_by_caller_user: false }), 'PERMISSION_DENIED'],
    [await probe(input(), { name: 'project' }), 'PERMISSION_DENIED'],
    [await probe(input(), {}, 'buckyos.other@1'), 'RESOURCE_TYPE_MISMATCH'],
    [await probe(input(), {}, 'buckyos.todo@1', ['read']), 'PERMISSION_DENIED'],
    [await probe({ method: 'add', params: { title: 'New', before: ref.href } }, { epoch: 'restored-history' }), 'EPOCH_MISMATCH'],
  ] as const
  for (const [r, code] of cases) {
    expect(r.code).toBe(code)
    expect(r.calls).not.toContain('aiws.doc.commit')
  }
  const legacy = await probe(input(), { name: undefined, former_name: 'schedule' })
  expect(legacy.code).toBeUndefined()
  expect(legacy.calls).toContain('aiws.doc.commit')
})

test('replaying a confirmed add never recreates its deleted table', async () => {
  const ws = { workspace_id: 'ws_2611abcd', epoch: 'e', name: 'schedule', owned_by_caller_user: true }
  const seen: string[] = []
  const original = host(method => {
    seen.push(method)
    switch (method) {
      case 'owner.prepare': return { ...ws, binding_revision: 0, record_id: 'r1', idempotency_key: 'key', replay: true }
      case 'aiws.ws.get_info': case 'owner.pin': return ws
      case 'aiws.doc.get_submission': return {status: 'accepted'}
      case 'aiws.doc.read': throw Object.assign(new Error('deleted table'), {code: 'TARGET_DELETED'})
      default: throw new Error(method)
    }
  })
  const reply = await scheduleAction('todo', {method:'add', params: {title:'Existing'}}, original)
  expect(reply.error?.code).toBe('TARGET_DELETED')
  expect(seen).not.toContain('aiws.doc.commit')
})

test('a keyed undone request records its result even if the item is already open', async () => {
  const ws = { workspace_id: 'ws_2611abcd', epoch: 'e', name: 'schedule', owned_by_caller_user: true }
  const ref = new URL('obj://aiworkspace/ws_2611abcd/entities/todo')
  for (const [k,v] of Object.entries({ zone: context.zone_did, owner: context.owner_did, epoch: ws.epoch,
    binding_revision: '0', selector: JSON.stringify({kind:'table_record',record_id:'r'}) })) ref.searchParams.set(k,v)
  const writes: unknown[] = []
  let status = 'todo'
  const server = host((method, p) => {
    switch (method) {
      case 'owner.prepare': return { ...ws, binding_revision: 0, record_id: 'r', idempotency_key: 'unchanged', replay: writes.length > 0 }
      case 'aiws.ws.get_info': case 'owner.pin': return ws
      case 'aiws.doc.read': return p.as === 'meta' ? {schema_id: 'buckyos.todo@1', capabilities: ['read','update']} :
        { content: {record_id: 'r', revs: {status: 5}, values: {title: 'item', status}} }
      case 'aiws.doc.commit': writes.push(p.operations); return {status: 'accepted'}
      case 'aiws.doc.get_submission': return {status: 'accepted', changed: ['r']}
      default: throw new Error(method)
    }
  })
  const request = {method: 'undone', params: {record_ref: ref.href}}
  const first = await scheduleAction('todo', request, server)
  expect(first.error).toBeUndefined()
  expect(writes[0]).toEqual([{op:'table.set_values',source_id:'todo',values:[{record_id:'r',field_id:'status',expect:{rev:5},value:'todo'}]}])
  status = 'done'
  expect(await scheduleAction('todo', request, server)).toEqual(first)
  expect(writes).toHaveLength(1)
})
