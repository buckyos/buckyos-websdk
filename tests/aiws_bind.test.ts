/* What a control binds when placed (buckyos notepads/aiworkspace-control-on-bind-todo.md): the default rule of the
 * declarations, a composite's steps, parent → child on_bind and child → parent on_init_control, no_ui for an Agent,
 * and the operations of the result. */
import {
  bindingsPayload, BindFailure, checkBindSteps, createOps, resolveBindings,
  type BindDialogs, type BindHost, type BindNode, type DataInfo,
} from '../src/aiws_bind'

const TODO = 'buckyos.todo@1'
const CAL = 'buckyos.calendar@1'
const table = (id: string, schema_id: string | null = null): DataInfo => ({ entity_id: id, type_id: 'buckyos.table-source', schema_id, title: id })
const dir = (id: string): DataInfo => ({ entity_id: id, type_id: 'buckyos.dir', title: id })

function host(data: DataInfo[], answers: { one?: (string | { new: true } | null)[]; many?: ((string | { new: true })[] | null)[] } = {}, no_ui = false): BindHost & { asked: string[] } {
  const asked: string[] = []
  const dialogs: BindDialogs = {
    pickOne: async (o) => { asked.push(`one:${o.title}`); return answers.one?.shift() ?? null },
    pickMany: async (o) => { asked.push(`many:${o.title}`); return answers.many?.shift() ?? null },
    confirm: async () => true,
  }
  return {
    reason: 'insert', no_ui, dialogs, asked,
    find: (q) => data.filter((d) => (!q.accepts || q.accepts.includes(d.type_id)) && (!q.schema_id || d.schema_id === q.schema_id)),
  }
}

const todoControl = (given = {}): BindNode => ({ id: 'tl', title: 'To-do', decls: { items: { accepts: ['buckyos.table-source'], schema_id: TODO, required: true, title: 'To-do list' } }, given, children: [] })
const calendarControl: BindNode = { id: 'cal', title: 'Calendar', children: [], decls: {
  events: { accepts: ['buckyos.table-source'], schema_id: CAL, required: true, many: true, title: 'Calendars' },
  todo: { accepts: ['buckyos.table-source'], schema_id: TODO, many: true, title: 'To-do lists' },
} }

describe('the default rule', () => {
  it('a required table: none → created, one → bound, several → asked (a new one, a chosen one, cancelled)', async () => {
    const none = await resolveBindings(todoControl(), host([table('other')]))
    expect(none.ok && none.results.get('tl')).toMatchObject({ create: [{ kind: 'standard', schema_id: TODO }] })
    const one = await resolveBindings(todoControl(), host([table('a', TODO)]))
    expect(one.ok && one.results.get('tl')).toEqual({ bindings: { items: 'a' }, create: [] })
    const chosen = await resolveBindings(todoControl(), host([table('a', TODO), table('b', TODO)], { one: ['b'] }))
    expect(chosen.ok && chosen.results.get('tl')?.bindings).toEqual({ items: 'b' })
    const fresh = await resolveBindings(todoControl(), host([table('a', TODO), table('b', TODO)], { one: [{ new: true }] }))
    expect(fresh.ok && fresh.results.get('tl')?.create).toHaveLength(1)
    const cancelled = await resolveBindings(todoControl(), host([table('a', TODO), table('b', TODO)], { one: [null] }))
    expect(cancelled.ok).toBe(false)
    expect(!cancelled.ok && cancelled.error.code).toBe('CANCELLED')
  })

  it('many: all of them, a required one created when none; an optional one left out', async () => {
    const both = await resolveBindings(calendarControl, host([table('c1', CAL), table('t1', TODO), table('t2', TODO)]))
    expect(both.ok && both.results.get('cal')?.bindings).toEqual({ events: ['c1'], todo: ['t1', 't2'] })
    const empty = await resolveBindings(calendarControl, host([]))
    const r = empty.ok ? empty.results.get('cal')! : null
    expect(r?.bindings.todo).toBeUndefined()
    expect(r?.create.map((c) => c.kind === 'standard' && c.schema_id)).toEqual([CAL])
    expect(Array.isArray(r?.bindings.events)).toBe(true)
  })

  it('a required binding it cannot create fails, naming it', async () => {
    const node: BindNode = { id: 'v', title: 'Vote', children: [], decls: { photos: { accepts: ['buckyos.dir'], required: true, title: 'Photos' } } }
    const out = await resolveBindings(node, host([table('a', TODO)]))
    expect(!out.ok && out.error).toMatchObject({ code: 'NO_DATA', binding: 'photos' })
  })

  it('no_ui (an Agent): given bindings are taken, a choice fails naming the binding, the rest still runs', async () => {
    const two = [table('a', TODO), table('b', TODO)]
    expect((await resolveBindings(todoControl({ items: 'b' }), host(two, {}, true))).ok).toBe(true)
    const asked = await resolveBindings(todoControl(), host(two, {}, true))
    expect(!asked.ok && asked.error).toMatchObject({ code: 'NEEDS_UI', binding: 'items' })
    const made = await resolveBindings(todoControl(), host([], {}, true))
    expect(made.ok && made.results.get('tl')?.create).toHaveLength(1)
  })

  it('re-bind of a list: the chosen ones and a new one', async () => {
    const h = { ...host([table('c1', CAL), table('c2', CAL), table('t1', TODO)], { many: [['c2', { new: true }], []] }), reason: 'rebind' as const }
    const out = await resolveBindings({ ...calendarControl, given: { events: ['c1'], todo: ['t1'] } }, h)
    const r = out.ok ? out.results.get('cal')! : null
    expect(r?.bindings.events).toEqual(['c2', expect.stringMatching(/^ref:/)])
    expect(r?.bindings.todo).toEqual([])
    expect(r?.create).toMatchObject([{ kind: 'standard', schema_id: CAL, name: 'Calendar' }])
    expect(h.asked).toEqual(['many:Calendars', 'many:To-do lists'])
  })

  it('re-bind: each binding asked, the current one shown', async () => {
    const h = { ...host([table('a', TODO), table('b', TODO)], { one: ['b'] }), reason: 'rebind' as const }
    const out = await resolveBindings(todoControl({ items: 'a' }), h)
    expect(out.ok && out.results.get('tl')?.bindings).toEqual({ items: 'b' })
    expect(h.asked).toEqual(['one:To-do list'])
  })
})

describe('placing a tree', () => {
  it('on_bind parent → child (a child takes what its parent bound), on_init_control child → parent', async () => {
    const order: string[] = []
    const child: BindNode = { id: 'chart', title: 'Chart', children: [], decls: { rows: { accepts: ['buckyos.table-source'], required: true } },
      onInit: async () => { order.push('init:chart'); return true } }
    const parent: BindNode = { id: 'board', title: 'Board', children: [child], decls: { data: { accepts: ['buckyos.table-source'], required: true } },
      onBind: async () => { order.push('bind:board'); return { bindings: { data: 'x' }, create: [] } },
      onInit: async (ctx) => { order.push(`init:board ${ctx.children.map((c) => c.ready).join()}`); return true } }
    const out = await resolveBindings(parent, host([table('x'), table('y')]))
    expect(out.ok && out.results.get('chart')?.bindings).toEqual({ rows: 'x' })
    expect(order).toEqual(['bind:board', 'init:chart', 'init:board true'])
  })

  it('a parent that finds a child not ready stops the whole placement', async () => {
    const child: BindNode = { id: 'c', title: 'Child', children: [], decls: {}, onInit: async () => 'Child: no rows yet' }
    const out = await resolveBindings({ id: 'p', title: 'Parent', decls: {}, children: [child] }, host([]))
    expect(!out.ok && out.error).toMatchObject({ code: 'NOT_READY', node: 'c' })
  })
})

describe("a composite's declared steps", () => {
  const vote: BindNode = {
    id: 'vote', title: 'Vote', children: [],
    decls: { photos: { accepts: ['buckyos.dir'], required: true, title: 'Photos' }, votes: { accepts: ['buckyos.table-source'], required: true, title: 'Votes' } },
    onBind: [
      { binding: 'photos', pick: 'one' },
      { binding: 'votes', create: { table: { name: 'Votes', fields: [{ field_id: 'voter', name: 'voter', type: 'text', submitter: true }] } }, when: 'always' },
    ],
    onInit: [{ then: { action: 'prepare' } }],
  }

  it('pick a folder, create the votes table, then the action', async () => {
    const out = await resolveBindings(vote, host([dir('trip'), dir('party'), table('old')], { one: ['party'] }))
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const r = out.results.get('vote')!
    expect(r.bindings.photos).toBe('party')
    expect(r.create).toMatchObject([{ kind: 'table', name: 'Votes' }])
    expect(out.then).toEqual([{ node: 'vote', action: 'prepare' }])
    let n = 0
    const { ops, ids } = createOps(out.results, { folderId: 'f', newId: () => `new${++n}`, orderKey: () => 'k', freeName: (s) => `${s} (2)` })
    expect(ops).toMatchObject([{ op: 'entity.create', type_id: 'buckyos.table-source', entity_id: 'new1', parent_id: 'f', name: 'Votes (2)' }])
    expect(bindingsPayload(r.bindings, vote.decls, ids)).toEqual({ photos: { entity_id: 'party' }, votes: { entity_id: 'new1' } })
  })

  it('declared steps are checked against the bindings and actions', () => {
    expect(checkBindSteps(vote.onBind, vote.onInit, vote.decls, ['prepare'])).toEqual([])
    expect(checkBindSteps([{ binding: 'nope', pick: 'one' }, { binding: 'photos', pick: 'many' }], [{ then: { action: 'x' } }], vote.decls, [])).toEqual([
      'on_bind[0]: nope is not a declared binding', 'on_bind[1]: photos takes one', 'on_init_control[0]: x is not a declared action',
    ])
  })
})

it('a list binding is written as a list, a single one as an object', () => {
  const decls = { events: { many: true }, items: {} }
  expect(bindingsPayload({ events: ['a', 'ref:1'], items: 'b' }, decls, { 'ref:1': 'n' })).toEqual({ events: [{ entity_id: 'a' }, { entity_id: 'n' }], items: { entity_id: 'b' } })
  expect(bindingsPayload({ events: [] }, decls, {})).toEqual({})
  expect(new BindFailure('x', 'INVALID')).toBeInstanceOf(Error)
})
