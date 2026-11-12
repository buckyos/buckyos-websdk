import {
  calendarOccurrences, eventAddOps, eventDeleteOps, eventEditOps, findOccurrence, orderAt, orderKeyBetween, orderKeysBetween, isOrderKey,
  sortTodos, standardTableOp, todoAddOps, todoCompleteOps, todoItem, todoMoveOps, todoUpdateOps, type Op, type RowLike,
} from '../src/aiws_schedule'

const win = (from: string, to: string) => ({ fromMs: Date.parse(from), toMs: Date.parse(to) })

/** Apply the record operations to an in-memory table (enough to chain edits in tests). */
function apply(rows: RowLike[], ops: Op[]): RowLike[] {
  const out = rows.map((r) => ({ ...r, values: { ...r.values } }))
  for (const op of ops) {
    if (op.op === 'table.insert_records') for (const r of op.records as { record_id: string; values: RowLike['values'] }[]) out.push({ record_id: r.record_id, rev: 1, revs: {}, values: { ...r.values } })
    if (op.op === 'table.set_values') for (const v of op.values as { record_id: string; field_id: string; value: never }[]) out.find((r) => r.record_id === v.record_id)!.values[v.field_id] = v.value
    if (op.op === 'table.unset_values') for (const v of op.values as { record_id: string; field_id: string }[]) delete out.find((r) => r.record_id === v.record_id)!.values[v.field_id]
    if (op.op === 'table.delete_records') for (const d of op.records as { record_id: string }[]) out.splice(out.findIndex((r) => r.record_id === d.record_id), 1)
  }
  return out
}

describe('order keys', () => {
  it('agree with the core on the first keys and stay ordered', () => {
    expect(orderKeyBetween(null, null)).toBe('i')
    expect(orderKeyBetween('i', null)).toBe('i0000001')
    let lo = 'a', hi = 'b'
    for (let i = 0; i < 100; i++) {
      const m = orderKeyBetween(lo, hi)
      expect(lo < m && m < hi).toBe(true)
      expect(isOrderKey(m)).toBe(true)
      if (i % 2) lo = m; else hi = m
    }
    const keys = orderKeysBetween(null, null, 20)
    expect([...keys].sort()).toEqual(keys)
  })
  it('place an item at an index', () => {
    const items = [{ order: 'b' }, { order: 'd' }, { order: 'f' }]
    expect(orderAt(items, 0) < 'b').toBe(true)
    const mid = orderAt(items, 1)
    expect('b' < mid && mid < 'd').toBe(true)
    expect(orderAt(items, 3) > 'f').toBe(true)
  })
})

describe('to-do operations', () => {
  it('creates a standard table', () => {
    const op = standardTableOp('todo', { entity_id: 'todo', parent_id: 'data', order_key: 'u', locale: 'en' })
    expect(op.schema_id).toBe('buckyos.todo@1')
    const fields = (op.payload as { fields: { field_id: string; type: string }[] }).fields
    expect(fields.map((f) => `${f.field_id}:${f.type}`)).toEqual(['title:text', 'status:select', 'due:date', 'order:text', 'done_at:datetime', 'ext:json'])
  })
  it('adds at the end, completes, reopens and moves with cell expectations', () => {
    const { record_id, ops, order } = todoAddOps('todo', { title: 'Buy milk' }, { items: [{ order: 'b' }, { order: 'c' }] })
    expect(order > 'c').toBe(true)
    expect(ops[0]).toMatchObject({ op: 'table.insert_records', records: [{ record_id, values: { title: 'Buy milk', status: 'todo', order } }] })
    const row: RowLike = { record_id, rev: 3, revs: { status: 3, order: 2 }, values: { title: 'Buy milk', status: 'todo', order } }
    const done = todoCompleteOps('todo', row, true, { now: '2026-11-11T10:00:00.000Z' })
    expect(done).toEqual([{ op: 'table.set_values', source_id: 'todo', values: [
      { record_id, field_id: 'status', expect: { rev: 3 }, value: 'done' }, { record_id, field_id: 'done_at', expect: { rev: 0 }, value: '2026-11-11T10:00:00.000Z' }] }])
    const doneRow: RowLike = { ...row, values: { ...row.values, status: 'done', done_at: '2026-11-11T10:00:00.000Z' } }
    expect(todoCompleteOps('todo', doneRow, false)).toEqual([
      { op: 'table.set_values', source_id: 'todo', values: [{ record_id, field_id: 'status', expect: { rev: 3 }, value: 'todo' }] },
      { op: 'table.unset_values', source_id: 'todo', values: [{ record_id, field_id: 'done_at', expect: { rev: 0 } }] },
    ])
    const moved = todoMoveOps('todo', row, { status: 'doing', order: 'a5' })
    expect(moved[0].values).toEqual([{ record_id, field_id: 'status', expect: { rev: 3 }, value: 'doing' }, { record_id, field_id: 'order', expect: { rev: 2 }, value: 'a5' }])
    expect(todoMoveOps('todo', row, { status: 'todo', order })).toEqual([])
  })
  it('merges ext and stamps completion on a status change', () => {
    const row: RowLike = { record_id: 't1', values: { title: 'x', status: 'todo', ext: { priority: 'low', tags: ['a'] } } }
    const ops = todoUpdateOps('todo', row, { status: 'done', ext_merge: { priority: 'high', tags: null } })
    const values = ops[0].values as { field_id: string; value: unknown }[]
    expect(values.find((v) => v.field_id === 'ext')?.value).toEqual({ priority: 'high' })
    expect(values.find((v) => v.field_id === 'done_at')).toBeTruthy()
  })
  it('sorts by order with unordered items last', () => {
    const items = [{ record_id: 'x', order: null }, { record_id: 'y', order: 'c' }, { record_id: 'z', order: 'a' }]
    expect(sortTodos(items).map((i) => i.record_id)).toEqual(['z', 'y', 'x'])
    expect(todoItem({ record_id: 'q', values: { title: 'Q', status: 'done' } }).done).toBe(true)
  })
})

describe('calendar occurrences and edits', () => {
  const standup: RowLike = { record_id: 'su', rev: 1, revs: {}, values: { title: 'Stand-up', start: '2026-11-09T01:00:00.000Z', end: '2026-11-09T01:15:00.000Z', ext: { rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', tz: 'Asia/Shanghai' } } }
  const trip: RowLike = { record_id: 'tr', values: { title: 'Trip', all_day: true, start_date: '2026-11-12', end_date: '2026-11-14' } }
  const week = win('2026-11-09T00:00:00Z', '2026-11-16T00:00:00Z')

  it('expands series, keeps single events, shows all-day spans', () => {
    const occ = calendarOccurrences([standup, trip], week, { viewerTz: 'Asia/Shanghai' })
    expect(occ.filter((o) => o.row.record_id === 'su')).toHaveLength(5)
    const t = occ.find((o) => o.id === 'tr')!
    expect([t.allDay, t.startDate, t.endDate]).toEqual([true, '2026-11-12', '2026-11-14'])
    expect(occ[0].id).toBe('su@2026-11-09T01:00:00.000Z')
    expect(occ[0].endMs! - occ[0].startMs!).toBe(15 * 60_000)
  })
  it('“only this one”: an override replaces the occurrence', () => {
    const occ = findOccurrence([standup], 'su@2026-11-11T01:00:00.000Z')
    const { ops, record_id } = eventEditOps('cal', occ, { times: { allDay: false, start: '2026-11-11T03:00:00.000Z', end: '2026-11-11T03:30:00.000Z' } }, 'one', { rows: [standup], newRecordId: () => 'ov1' })
    expect(record_id).toBe('ov1')
    const rows = apply([standup], ops)
    const shown = calendarOccurrences(rows, week, { viewerTz: 'UTC' })
    const wed = shown.filter((o) => o.id === 'su@2026-11-11T01:00:00.000Z')
    expect(wed).toHaveLength(1)
    expect([wed[0].override, new Date(wed[0].startMs!).toISOString()]).toEqual([true, '2026-11-11T03:00:00.000Z'])
    expect(shown.filter((o) => o.row.record_id === 'su' || o.override)).toHaveLength(5)
    // the override's own ext names the series and is not itself a series
    expect((rows.find((r) => r.record_id === 'ov1')!.values.ext as Record<string, unknown>).rrule).toBeUndefined()
  })
  it('“today not needed”: an exclusion removes one occurrence', () => {
    const occ = findOccurrence([standup], 'su@2026-11-10T01:00:00.000Z')
    const rows = apply([standup], eventDeleteOps('cal', occ, 'one', { rows: [standup] }))
    const shown = calendarOccurrences(rows, week, { viewerTz: 'UTC' })
    expect(shown.map((o) => o.original)).not.toContain('2026-11-10T01:00:00.000Z')
    expect(shown).toHaveLength(4)
  })
  it('“this and following”: the series is split where it changes', () => {
    const occ = findOccurrence([standup], 'su@2026-11-12T01:00:00.000Z')
    const { ops, record_id } = eventEditOps('cal', occ, { times: { allDay: false, start: '2026-11-12T02:00:00.000Z', end: '2026-11-12T02:15:00.000Z' } }, 'following', { rows: [standup], newRecordId: () => 'su2' })
    expect(record_id).toBe('su2')
    const rows = apply([standup], ops)
    const shown = calendarOccurrences(rows, win('2026-11-09T00:00:00Z', '2026-11-21T00:00:00Z'), { viewerTz: 'UTC' })
    const times = shown.map((o) => new Date(o.startMs!).toISOString())
    expect(times.slice(0, 5)).toEqual(['2026-11-09T01:00:00.000Z', '2026-11-10T01:00:00.000Z', '2026-11-11T01:00:00.000Z', '2026-11-12T02:00:00.000Z', '2026-11-13T02:00:00.000Z'])
    expect(times).toHaveLength(10)
  })
  it('“all”: the series moves, a weekly rule follows to the new weekday', () => {
    const weekly: RowLike = { record_id: 'wk', revs: {}, values: { title: 'Review', start: '2026-11-09T08:00:00.000Z', end: '2026-11-09T09:00:00.000Z', ext: { rrule: 'FREQ=WEEKLY;BYDAY=MO', tz: 'UTC', exdate: ['2026-11-16T08:00:00.000Z'] } } }
    const occ = findOccurrence([weekly], 'wk@2026-11-23T08:00:00.000Z')
    const { ops } = eventEditOps('cal', occ, { times: { allDay: false, start: '2026-11-24T10:00:00.000Z', end: '2026-11-24T11:00:00.000Z' } }, 'all', { rows: [weekly] })
    const rows = apply([weekly], ops)
    const ext = rows[0].values.ext as Record<string, unknown>
    expect(ext.rrule).toBe('FREQ=WEEKLY;BYDAY=TU')
    expect(ext.exdate).toEqual(['2026-11-17T10:00:00.000Z'])
    expect(rows[0].values.start).toBe('2026-11-10T10:00:00.000Z')
    const shown = calendarOccurrences(rows, win('2026-11-09T00:00:00Z', '2026-12-01T00:00:00Z'), { viewerTz: 'UTC' })
    expect(shown.map((o) => o.original)).toEqual(['2026-11-10T10:00:00.000Z', '2026-11-24T10:00:00.000Z'])
  })
  it('deleting this and following ends the series; deleting all removes overrides too', () => {
    const occ = findOccurrence([standup], 'su@2026-11-12T01:00:00.000Z')
    const rows = apply([standup], eventDeleteOps('cal', occ, 'following', { rows: [standup] }))
    expect(calendarOccurrences(rows, win('2026-11-09T00:00:00Z', '2026-12-01T00:00:00Z'), { viewerTz: 'UTC' })).toHaveLength(3)
    const withOverride = apply([standup], eventEditOps('cal', findOccurrence([standup], 'su@2026-11-11T01:00:00.000Z'), { values: { title: 'Moved' } }, 'one', { rows: [standup], newRecordId: () => 'ov' }).ops)
    const gone = apply(withOverride, eventDeleteOps('cal', findOccurrence(withOverride, 'su@2026-11-10T01:00:00.000Z'), 'all', { rows: withOverride }))
    expect(gone).toHaveLength(0)
  })
  it('a new event, timed or all-day', () => {
    expect(eventAddOps('cal', { record_id: 'n', title: 'Lunch', start: '2026-11-11T04:00:00.000Z', end: '2026-11-11T05:00:00.000Z' }).ops[0]).toEqual({ op: 'table.insert_records', source_id: 'cal', records: [{ record_id: 'n', values: { title: 'Lunch', start: '2026-11-11T04:00:00.000Z', end: '2026-11-11T05:00:00.000Z' } }] })
    expect(eventAddOps('cal', { record_id: 'h', title: 'Holiday', all_day: true, start_date: '2026-12-25', end_date: '2026-12-25' }).ops[0]).toEqual({ op: 'table.insert_records', source_id: 'cal', records: [{ record_id: 'h', values: { title: 'Holiday', all_day: true, start_date: '2026-12-25' } }] })
  })
  it('occurrences an Agent wrote for a rule outside the subset', () => {
    const agent: RowLike = { record_id: 'ag', values: { title: 'Payroll', all_day: true, start_date: '2026-11-30', ext: { rule_text: '每月最后一个法定工作日', occurrences: ['2026-11-30', '2026-12-31'], covered_until: '2026-12-31' } } }
    const shown = calendarOccurrences([agent], win('2026-11-01T00:00:00Z', '2027-01-01T00:00:00Z'), { viewerTz: 'UTC' })
    expect(shown.map((o) => [o.startDate, o.agentWritten])).toEqual([['2026-11-30', true], ['2026-12-31', true]])
  })
})
