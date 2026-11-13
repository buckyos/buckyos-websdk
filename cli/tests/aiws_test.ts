import './setup.ts'
import { join } from 'node:path'
import { createRegistry } from '../core/app.ts'
import { parseCommandArgs } from '../core/argv.ts'
import { ConfigStore } from '../core/config.ts'
import { createMockCommandContext } from '../core/context.ts'
import type { RpcCallOptions, ServiceClientRegistry } from '../core/runtime.ts'
import { assertEquals, assertRejects, testConfig } from './test_helpers.ts'

interface RecordedCall {
  service: string
  method: string
  params: Record<string, unknown>
}

Deno.test('aiws verbs are registered with their access levels', () => {
  const registry = createRegistry()
  for (
    const [verb, level] of [
      ['info', 'read'],
      ['read', 'read'],
      ['ls', 'read'],
      ['find', 'read'],
      ['grep', 'read'],
      ['stat', 'read'],
      ['cat', 'read'],
      ['resolve', 'read'],
      ['sql', 'read'],
      ['table', 'write'],
      ['text', 'write'],
      ['mv', 'write'],
      ['rename', 'write'],
      ['set-prop', 'write'],
      ['controls', 'read'],
      ['import', 'write'],
      ['export', 'read'],
      ['run-get', 'read'],
      ['run-files', 'read'],
      ['run-claim', 'write'],
      ['run-heartbeat', 'write'],
      ['run-tool', 'write'],
      ['run-exec', 'write'],
      ['run-program', 'write'],
      ['run-report', 'write'],
      ['run-start', 'write'],
    ]
  ) {
    const described = registry.describe('aiws', verb)
    assertEquals(described.access, { mode: 'fixed', level })
    assertEquals(described.requires_session, true)
  }
})

Deno.test('the old table query verb is gone', () => {
  let code: string | undefined
  try { createRegistry().get('aiws', 'query') } catch (error) { code = (error as { code?: string }).code }
  assertEquals(typeof code, 'string')
})

Deno.test('finding and reading map onto doc.list / doc.find / doc.query / doc.read / doc.resolve, paths or ids', async () => {
  const calls: RecordedCall[] = []
  const clients = clientsFor(calls, (method, params) => {
    if (method === 'doc.read' && params.as === 'body') {
      const page = params.cursor === 'c2' ? { text: 'b\n', complete: true } : { text: 'a\n', complete: false, next_cursor: 'c2' }
      return { ok: true, entity_id: 'notes', path: '/docs/notes', format: 'text/markdown', etag: 'e', state: 'full', ...page }
    }
    return { ok: true, method }
  })
  const registry = createRegistry()
  assertEquals(parseCommandArgs(registry.get('aiws', 'ls'), ['/data', '--workspace', 'ws_a', '--type', 'table,richtext'], undefined).input, { path: '/data', workspace_id: 'ws_a', type: 'table,richtext' })
  await run('ls', { workspace_id: 'ws_a' }, clients)
  assertEquals(calls.at(-1)?.params, { workspace_id: 'ws_a' })
  await run('ls', { workspace_id: 'ws_a', path: '/data', type: 'table', limit: 5 }, clients)
  assertEquals(calls.at(-1)?.params, { workspace_id: 'ws_a', at: '/data', type: 'table', limit: 5 })
  await run('find', { workspace_id: 'ws_a', text: '销售', at: '~data', depth: 2 }, clients)
  assertEquals([calls.at(-1)?.method, calls.at(-1)?.params], ['doc.find', { workspace_id: 'ws_a', name: '销售', at: '~data', depth: 2 }])
  await run('grep', { workspace_id: 'ws_a', text: 'Q4', case: true, not_type: 'record' }, clients)
  assertEquals([calls.at(-1)?.method, calls.at(-1)?.params], ['doc.query', { workspace_id: 'ws_a', text: 'Q4', case: true, not_type: 'record' }])
  await run('stat', { workspace_id: 'ws_a', path: 'sales' }, clients)
  assertEquals(calls.at(-1)?.params, { workspace_id: 'ws_a', entity_id: 'sales', as: 'meta' })
  await run('resolve', { workspace_id: 'ws_a', path: '/data/销售' }, clients)
  assertEquals(calls.at(-1)?.params, { workspace_id: 'ws_a', path: '/data/销售' })
  await run('read', { workspace_id: 'ws_a', entity_id: '/data/销售' }, clients)
  assertEquals(calls.at(-1)?.params, { workspace_id: 'ws_a', path: '/data/销售' })
  // cat follows the pages unless one page is asked for
  const whole = await run('cat', { workspace_id: 'ws_a', path: '/docs/notes' }, clients)
  assertEquals([whole.text, whole.complete, calls.at(-1)?.params], ['a\nb\n', true, { workspace_id: 'ws_a', path: '/docs/notes', as: 'body', cursor: 'c2' }])
  const one = await run('cat', { workspace_id: 'ws_a', path: '/docs/notes', max_bytes: 4096 }, clients)
  assertEquals([one.text, one.next_cursor, calls.at(-1)?.params], ['a\n', 'c2', { workspace_id: 'ws_a', path: '/docs/notes', as: 'body', max_bytes: 4096 }])
})

Deno.test('sql sends one SELECT with its aliases and parameters', async () => {
  const calls: RecordedCall[] = []
  const clients = clientsFor(calls, () => ({ ok: true, columns: ['n'], rows: [[3]], truncated: false, read: [], head_seq: 1 }))
  const answer = await run('sql', { workspace_id: 'ws_a', sql: 'SELECT count(*) AS n FROM t WHERE "状态" = ?', table: 't=/data/销售, 1-2,u=orders', params: '["已完成"]', max_rows: 10 }, clients)
  assertEquals(answer.rows, [[3]])
  assertEquals(calls[0].params, { workspace_id: 'ws_a', sql: 'SELECT count(*) AS n FROM t WHERE "状态" = ?', tables: { t: '/data/销售, 1-2', u: 'orders' }, params: ['已完成'], max_rows: 10 })
  await assertRejects(() => run('sql', { workspace_id: 'ws_a', sql: 'SELECT 1', params: '{"a":1}' }, clients), 'AIWS_USAGE')
  await assertRejects(() => run('sql', { workspace_id: 'ws_a', sql: 'SELECT 1', table: 'nope' }, clients), 'AIWS_USAGE')
})

Deno.test('table verbs read the table and the records, then commit by field id, option id and expect', async () => {
  const calls: RecordedCall[] = []
  const table = {
    ok: true, entity_id: 'sales', meta_rev: 2,
    content: { fields: [{ field_id: 'f_c', name: '客户', type: 'text', order_key: 'a', def_rev: 1 }, { field_id: 'f_s', name: '状态', type: 'select', order_key: 'b', def_rev: 4, options: [{ option_id: 'won', label: '已完成' }] }] },
  }
  const record = { ok: true, entity_id: 'sales', content: { record_id: 'r1', rev: 6, revs: { f_s: 5 }, values: { f_s: 'won' } } }
  const clients = clientsFor(calls, (method, params) => {
    if (method === 'doc.read') return params.selector ? record : table
    if (method === 'ws.get_info') return { ok: true, epoch: 'ep_a' }
    if (method === 'doc.commit') return { status: 'accepted', commit_id: 'cm', seq: 9 }
    throw new Error(method)
  })
  const added = await run('table', { workspace_id: 'ws_a', action: 'add', table: '/data/销售', values: '{"_id":"r9","客户":"ACME","状态":"已完成"}' }, clients)
  assertEquals([added.status, added.record_ids, calls[0].params], ['accepted', ['r9'], { workspace_id: 'ws_a', path: '/data/销售' }])
  const commit = calls.find((c) => c.method === 'doc.commit')!.params
  assertEquals([commit.epoch, commit.protocol_version, commit.operations], ['ep_a', '1.2', [{ op: 'table.insert_records', source_id: 'sales', records: [{ record_id: 'r9', values: { f_c: 'ACME', f_s: 'won' } }] }]])
  calls.length = 0
  await run('table', { workspace_id: 'ws_a', action: 'set', table: 'sales', target: 'r1', values: '{"客户":"Beta"}' }, clients)
  assertEquals(calls.at(-1)?.params.operations, [{ op: 'table.set_values', source_id: 'sales', values: [{ record_id: 'r1', field_id: 'f_c', expect: { rev: 0 }, value: 'Beta' }] }])
  await run('table', { workspace_id: 'ws_a', action: 'rm', table: 'sales', target: 'r1' }, clients)
  assertEquals(calls.at(-1)?.params.operations, [{ op: 'table.delete_records', source_id: 'sales', records: [{ record_id: 'r1', expect: { rev: 6 } }] }])
  await run('table', { workspace_id: 'ws_a', action: 'option-add', table: 'sales', target: '状态', label: '已取消' }, clients)
  const option = (calls.at(-1)?.params.operations as Record<string, unknown>[])[0]
  assertEquals([option.op, option.field_id, (option.option as { label: string }).label, option.expect], ['table.add_option', 'f_s', '已取消', { rev: 4 }])
  const field = await run('table', { workspace_id: 'ws_a', action: 'field-add', table: 'sales', name: 'Stage', type: 'select', options: 'Lead,Won' }, clients)
  assertEquals(((field.options as { label: string }[]) ?? []).map((o) => o.label), ['Lead', 'Won'])
  // a refusal of a helper (an unknown field) is the CLI's error, with its code
  await assertRejects(() => run('table', { workspace_id: 'ws_a', action: 'add', table: 'sales', values: '{"Nope":1}' }, clients), 'INVALID_SCHEMA')
  // a conflict carries the conflicting cells
  const conflicting = clientsFor([], (method, params) => {
    if (method === 'doc.read') return params.selector ? record : table
    if (method === 'ws.get_info') return { ok: true, epoch: 'ep_a' }
    return { status: 'conflict', code: 'REVISION_CONFLICT', conflicts: [{ entity_id: 'sales', selector: { kind: 'table_cell', record_id: 'r1', field_id: 'f_s' } }] }
  })
  let details: Record<string, unknown> | undefined
  await assertRejects(() => run('table', { workspace_id: 'ws_a', action: 'set', table: 'sales', target: 'r1', values: '{"状态":null}' }, conflicting).catch((error: unknown) => { details = (error as { details?: Record<string, unknown> }).details; throw error }), 'REVISION_CONFLICT')
  assertEquals((details?.data as { conflicts: unknown[] }).conflicts.length, 1)
})

Deno.test('text, mv, rename and set-prop build their operations from what they read', async () => {
  const calls: RecordedCall[] = []
  const clients = clientsFor(calls, (method, params) => {
    if (method === 'ws.get_info') return { ok: true, epoch: 'ep_a' }
    if (method === 'doc.commit') return { status: 'accepted', commit_id: 'cm', seq: 3 }
    if (method === 'doc.list') return { ok: true, items: [{ entity_id: 'x1' }, { entity_id: 'x2' }] }
    if (method === 'doc.read' && params.as === 'meta') return { ok: true, entity_id: params.path === '/archive' ? 'archive' : 'notes' }
    if (method === 'doc.read' && (params.selector as { kind?: string } | undefined)?.kind === 'doc_key') {
      return { ok: true, entity_id: params.entity_id ?? 'draft', meta_rev: 7, struct_rev: 2, order_key: params.entity_id === 'x2' ? 'm' : 'c' }
    }
    if (method === 'doc.read') return { ok: true, entity_id: params.path === '/docs/notes' ? 'notes' : 'blk', content: { blocks: { b1: { hash: 'h1', struct_rev: 4 } }, key_revs: { 'p:config.label': 5 } } }
    throw new Error(method)
  })
  const appended = await run('text', { workspace_id: 'ws_a', action: 'append', doc: '/docs/notes', text: '# Done\n\n- a\n- b' }, clients)
  const insert = (calls.at(-1)?.params.operations as Record<string, unknown>[])[0]
  assertEquals([insert.op, insert.entity_id, insert.position, (insert.blocks as { type: string }[]).map((b) => b.type), (appended.blocks as string[]).length], ['richtext.insert_blocks', 'notes', { end: true }, ['heading', 'bullet_list'], 2])
  await run('text', { workspace_id: 'ws_a', action: 'replace', doc: '/docs/notes', block: 'b1', text: 'new' }, clients)
  const replace = (calls.at(-1)?.params.operations as Record<string, unknown>[])[0]
  assertEquals([replace.op, replace.block_id, replace.expect, (replace.node as { attrs: { block_id: string } }).attrs.block_id], ['richtext.replace_block', 'b1', { hash: 'h1' }, 'b1'])
  await run('text', { workspace_id: 'ws_a', action: 'rm', doc: '/docs/notes', block: 'b1' }, clients)
  assertEquals(calls.at(-1)?.params.operations, [{ op: 'richtext.delete_blocks', entity_id: 'notes', blocks: [{ block_id: 'b1', expect: { hash: 'h1', struct_rev: 4 } }] }])
  await assertRejects(() => run('text', { workspace_id: 'ws_a', action: 'rm', doc: '/docs/notes', block: 'b9' }, clients), 'NOT_FOUND')
  await assertRejects(() => run('text', { workspace_id: 'ws_a', action: 'append', doc: '/docs/notes' }, clients), 'AIWS_USAGE')
  await run('mv', { workspace_id: 'ws_a', path: '/data/draft', parent: '/archive' }, clients)
  const moved = (calls.at(-1)?.params.operations as Record<string, unknown>[])[0]
  assertEquals([moved.op, moved.entity_id, moved.new_parent_id, moved.expect, (moved.order_key as string) > 'm'], ['tree.move', 'draft', 'archive', { rev: 2 }, true])
  await run('rename', { workspace_id: 'ws_a', path: '/data/draft', name: 'final' }, clients)
  assertEquals(calls.at(-1)?.params.operations, [{ op: 'entity.rename', entity_id: 'draft', name: 'final', expect: { rev: 7 } }])
  await run('rename', { workspace_id: 'ws_a', path: '/data/draft', auto: true }, clients)
  assertEquals((calls.at(-1)?.params.operations as Record<string, unknown>[])[0].name, null)
  await assertRejects(() => run('rename', { workspace_id: 'ws_a', path: '/data/draft' }, clients), 'AIWS_USAGE')
  await run('set-prop', { workspace_id: 'ws_a', path: '/surfaces/board/kpi', key: 'config', props: '{"label":"Sales","color":null}' }, clients)
  assertEquals(calls.at(-1)?.params.operations, [{ op: 'entity.set_props', entity_id: 'blk', key: 'config', props: { label: 'Sales', color: null }, expect: { label: 5, color: 0 } }])
})

Deno.test('controls takes its kind only for describe', () => {
  const command = createRegistry().get('aiws', 'controls')
  assertEquals(parseCommandArgs(command, ['list'], undefined).input, { action: 'list' })
  assertEquals(parseCommandArgs(command, ['describe', 'mindmap'], undefined).input, { action: 'describe', kind: 'mindmap' })
})

Deno.test('the executor protocol maps onto proc.* with the attempt and the service answers as they are', async () => {
  const calls: RecordedCall[] = []
  const clients = clientsFor(calls, (method, params) => {
    if (method === 'proc.claim') return { ok: true, run_id: params.run_id, attempt: 1, run_token: 'rt_x', lease_ms: 90000, stage: { kind: 'model', tools: [] } }
    if (method === 'proc.heartbeat') return { ok: true, lease_until: 'later' }
    if (method === 'proc.tool') return { ok: true, status: 'ok', text: 'profile' }
    if (method === 'proc.report') return { ok: true, state: 'validating' }
    throw new Error(`unexpected method ${method}`)
  })
  const claimed = await run('run-claim', { workspace_id: 'ws_a', run_id: 'run_1', claim_token: 'ct_1' }, clients)
  assertEquals(claimed.attempt, 1)
  assertEquals(calls[0].service, 'aiworkspace')
  assertEquals((calls[0].params.executor as { kind: string }).kind, 'agent')
  await run('run-heartbeat', { workspace_id: 'ws_a', run_id: 'run_1', attempt: 1, phase: 'reading' }, clients)
  assertEquals(calls[1].params, { workspace_id: 'ws_a', run_id: 'run_1', attempt: 1, progress: { phase: 'reading' } })
  const answer = await run('run-tool', { workspace_id: 'ws_a', run_id: 'run_1', attempt: 1, name: 'ws_profile', args: '{"target":"@B1"}' }, clients)
  assertEquals(answer.status, 'ok')
  assertEquals(calls[2].params, { workspace_id: 'ws_a', run_id: 'run_1', attempt: 1, name: 'ws_profile', args: { target: '@B1' } })
  await run('run-report', { workspace_id: 'ws_a', run_id: 'run_1', attempt: 1, finished: true }, clients)
  assertEquals(calls[3].params, { workspace_id: 'ws_a', run_id: 'run_1', attempt: 1, finished: true })
  await run('run-report', { workspace_id: 'ws_a', run_id: 'run_1', attempt: 1, error: 'no data' }, clients)
  assertEquals(calls[4].params.error, { code: 'EXECUTOR_FAILED', detail: 'no data' })
})

Deno.test('a service failure becomes a tool error carrying its code', async () => {
  const clients = clientsFor([], () => ({ ok: false, error: { code: 'RUN_REVOKED', detail: 'the run was cancelled' } }))
  let code: string | undefined
  await assertRejects(() => run('run-heartbeat', { workspace_id: 'ws_a', run_id: 'run_1', attempt: 1 }, clients).catch((error: unknown) => { code = (error as { code?: string }).code; throw error }))
  assertEquals(code, 'RUN_REVOKED')
})

Deno.test('Block-controls: the catalogue, import from an outline file and export dispatch to control.*', async () => {
  const calls: RecordedCall[] = []
  const clients = clientsFor(calls, (method, params) => {
    if (method === 'control.list') return { ok: true, controls: [{ kind: 'mindmap', summary: 'A tree of ideas' }] }
    if (method === 'control.describe') return { ok: true, control: { kind: params.kind, agent: '# mindmap' } }
    if (method === 'control.import') return { ok: true, container_id: 'm1', nodes: 3 }
    if (method === 'control.export') return { ok: true, kind: 'mindmap', format: params.format, text: '- Root\n  - A\n' }
    throw new Error(method)
  })
  assertEquals((await run('controls', { action: 'list' }, clients)).controls, [{ kind: 'mindmap', summary: 'A tree of ideas' }])
  assertEquals(((await run('controls', { action: 'describe', kind: 'mindmap' }, clients)).control as Record<string, unknown>).agent, '# mindmap')
  const dir = await Deno.makeTempDir()
  await Deno.writeTextFile(`${dir}/plan.opml`, '<opml version="2.0"><body><outline text="Root"/></body></opml>')
  await run('import', { workspace_id: 'ws', parent_id: 'sf', file: `${dir}/plan.opml`, at: '10,20' }, clients)
  assertEquals(calls.at(-1)?.params, { workspace_id: 'ws', parent_id: 'sf', kind: 'mindmap', format: 'opml', text: '<opml version="2.0"><body><outline text="Root"/></body></opml>', at: { x: 10, y: 20 } })
  const written = await run('export', { workspace_id: 'ws', entity_id: 'm1', out: `${dir}/plan.md` }, clients)
  assertEquals(written, { ok: true, format: 'markdown', kind: 'mindmap', path: `${dir}/plan.md` })
  assertEquals(await Deno.readTextFile(`${dir}/plan.md`), '- Root\n  - A\n')
  await assertRejects(() => run('controls', { action: 'show' }, clients))
})

function clientsFor(
  calls: RecordedCall[],
  response: (method: string, params: Record<string, unknown>) => unknown,
): ServiceClientRegistry {
  return {
    call: <T>(service: string, method: string, params: Record<string, unknown>, _options: RpcCallOptions) => {
      calls.push({ service, method, params })
      try {
        return Promise.resolve(response(method, params) as T)
      } catch (error) {
        return Promise.reject(error)
      }
    },
  } as unknown as ServiceClientRegistry
}

async function run(verb: string, input: Record<string, unknown>, clients: ServiceClientRegistry): Promise<Record<string, unknown>> {
  const command = createRegistry().get('aiws', verb)
  const context = createMockCommandContext({
    command,
    config: testConfig(),
    configStore: new ConfigStore('/tmp/buckyos-tool-aiws-test'),
    clients,
    traceId: 'aiws-test',
  })
  context.deadline = Date.now() + 10_000
  return await command.handler(context, input) as Record<string, unknown>
}

Deno.test('extension control verbs: registered, and library / ext-import map onto ext.*', async () => {
  const registry = createRegistry()
  for (const [verb, level] of [['build', 'write'], ['pull', 'write'], ['ext-export', 'write'], ['library', 'write'], ['ext-import', 'write']]) {
    assertEquals(registry.describe('aiws', verb).access, { mode: 'fixed', level })
  }
  assertEquals(parseCommandArgs(registry.get('aiws', 'build'), ['/home/alice/AI Workspace/Demo/controls/kpi', '--workspace', 'ws_a', '--dry-run'], undefined).input, {
    dir: '/home/alice/AI Workspace/Demo/controls/kpi', workspace_id: 'ws_a', dry_run: true,
  })
  const calls: RecordedCall[] = []
  const clients = clientsFor(calls, (method) => {
    if (method === 'ext.list_library') return { ok: true, packages: [] }
    if (method === 'ext.import') return { ok: true, status: 'accepted', controls: [{ action: 'created' }] }
    if (method === 'ext.uninstall') return { ok: false, error: { code: 'NOT_FOUND', detail: 'not in your library' } }
    throw new Error(method)
  })
  assertEquals((await run('library', { action: 'list' }, clients)).packages, [])
  await run('ext-import', { workspace_id: 'ws_a', items: 'kpi.alice.bns.did#did:bns:alice#kpi, other#did:bns:bob#gauge' }, clients)
  assertEquals(calls.at(-1)?.params, { workspace_id: 'ws_a', items: [{ pkg_id: 'kpi.alice.bns.did', ident: 'did:bns:alice#kpi' }, { pkg_id: 'other', ident: 'did:bns:bob#gauge' }] })
  await assertRejects(() => run('ext-import', { workspace_id: 'ws_a', items: 'no-ident' }, clients))
  let code: string | undefined
  await assertRejects(() => run('library', { action: 'remove', target: 'x' }, clients).catch((error: unknown) => { code = (error as { code?: string }).code; throw error }))
  assertEquals(code, 'NOT_FOUND')
})

Deno.test('a build failure carries the service diagnostics in the error details', async () => {
  const diagnostics = [{ file: 'component.json', line: 3, col: 2, severity: 'error', message: 'expected value' }]
  const clients = clientsFor([], () => ({ ok: false, error: { code: 'BUILD_FAILED', detail: 'the control does not build', data: { diagnostics } } }))
  const command = createRegistry().get('aiws', 'ext-import')
  const context = createMockCommandContext({ command, config: testConfig(), configStore: new ConfigStore('/tmp/buckyos-tool-aiws-test'), clients, traceId: 'aiws-test' })
  context.deadline = Date.now() + 10_000
  let details: Record<string, unknown> | undefined
  await assertRejects(() => (command.handler(context, { workspace_id: 'ws', items: 'p#did:bns:a#k' }) as Promise<unknown>).catch((error: unknown) => { details = (error as { details?: Record<string, unknown> }).details; throw error }))
  assertEquals((details?.data as { diagnostics: unknown[] }).diagnostics, diagnostics)
})

Deno.test('build and pull work on a local folder: files inline, the base kept in .aiws-build.json', async () => {
  const dir = await Deno.makeTempDir()
  await Deno.writeTextFile(`${dir}/component.json`, '{"manifest_version":1}')
  await Deno.writeTextFile(`${dir}/declarative.json`, '{"items":[]}')
  const calls: RecordedCall[] = []
  const clients = clientsFor(calls, (method, params) => {
    if (method === 'ext.build') return { ok: true, status: 'accepted', def_entity_id: 'def1', def_rev: 7, dir_rev: 7, ident: 'did:bns:a#k', controls: [] }
    if (method === 'ext.export') return { ok: true, controls: [{ entity_id: params.entity_ids && 'def1', ident: 'did:bns:a#k', def_rev: 7, dir_rev: 7, files: [{ name: 'component.json', text: '{}' }] }] }
    throw new Error(method)
  })
  await run('build', { workspace_id: 'ws_a', dir }, clients)
  const files = calls[0].params.files as { name: string; base64: string }[]
  assertEquals(files.map((f) => f.name), ['component.json', 'declarative.json'])
  assertEquals(atob(files[0].base64), '{"manifest_version":1}')
  assertEquals(calls[0].params.expect, undefined)
  const state = JSON.parse(await Deno.readTextFile(`${dir}/.aiws-build.json`))
  assertEquals([state.def_rev, state.dir_rev], [7, 7])
  // the next build sends the base; the state file itself is not a source file
  await run('build', { workspace_id: 'ws_a', dir }, clients)
  assertEquals(calls[1].params.expect, { def_rev: 7, dir_rev: 7 })
  assertEquals((calls[1].params.files as unknown[]).length, 2)
  // a build that narrows its own contract carries the migration
  await Deno.writeTextFile(`${dir}/.m.json`, JSON.stringify({ 'did:bns:a#k': { bindings: { drop: ['old'] } } }))
  await run('build', { workspace_id: 'ws_a', dir, migration: `${dir}/.m.json` }, clients)
  assertEquals(calls[2].params.migration, { 'did:bns:a#k': { bindings: { drop: ['old'] } } })
  assertEquals((calls[2].params.files as unknown[]).length, 2)
  const out = await Deno.makeTempDir()
  await run('pull', { workspace_id: 'ws_a', def: 'def1', out, local: true }, clients)
  assertEquals(await Deno.readTextFile(`${out}/component.json`), '{}')
  assertEquals(JSON.parse(await Deno.readTextFile(`${out}/.aiws-build.json`)).def_entity_id, 'def1')
})

Deno.test('ext-upgrade maps onto ext.upgrade: items, the package, a migration file keyed by identity, dry run and force', async () => {
  const registry = createRegistry()
  for (const verb of ['ext-upgrade', 'template']) assertEquals(registry.describe('aiws', verb).access, { mode: 'fixed', level: 'write' })
  assertEquals(parseCommandArgs(registry.get('aiws', 'ext-upgrade'), ['def_a,def_b', '--workspace', 'ws_a', '--pkg', 'kpi.alice.bns.did', '--migration', 'm.json', '--dry-run', '--force'], undefined).input, {
    defs: 'def_a,def_b', workspace_id: 'ws_a', pkg_id: 'kpi.alice.bns.did', migration: 'm.json', dry_run: true, force: true,
  })
  const dir = await Deno.makeTempDir()
  const migration = { 'did:bns:alice#kpi': { config: { rename: { label: 'title' } }, slots: { move: { old: 'cards' } } } }
  await Deno.writeTextFile(`${dir}/m.json`, JSON.stringify(migration))
  await Deno.writeTextFile(`${dir}/bad.json`, JSON.stringify({ kpi: { config: {} } }))
  const calls: RecordedCall[] = []
  const clients = clientsFor(calls, (method) => {
    if (method === 'ext.upgrade') return { ok: true, status: 'accepted', controls: [{ ident: 'did:bns:alice#kpi', action: 'upgraded', from: '0.1.0', to: '0.2.0', migrated: ['c1'] }] }
    throw new Error(method)
  })
  const answer = await run('ext-upgrade', { workspace_id: 'ws_a', defs: 'def_a, def_b', pkg_id: 'kpi.alice.bns.did', migration: `${dir}/m.json`, dry_run: true }, clients)
  assertEquals((answer.controls as { action: string }[])[0].action, 'upgraded')
  assertEquals(calls[0].params, { workspace_id: 'ws_a', items: [{ def_entity_id: 'def_a', pkg_id: 'kpi.alice.bns.did' }, { def_entity_id: 'def_b', pkg_id: 'kpi.alice.bns.did' }], migration, dry_run: true })
  await run('ext-upgrade', { workspace_id: 'ws_a', defs: 'def_a', force: true }, clients)
  assertEquals(calls[1].params, { workspace_id: 'ws_a', items: [{ def_entity_id: 'def_a' }], force: true })
  await assertRejects(() => run('ext-upgrade', { workspace_id: 'ws_a', defs: 'def_a', migration: `${dir}/bad.json` }, clients))
  await assertRejects(() => run('ext-upgrade', { workspace_id: 'ws_a', defs: 'def_a', migration: `${dir}/missing.json` }, clients))
  assertEquals(calls.length, 2)
})

Deno.test('ext-import --bundle builds a library bundle of another Zone: dependencies first, provenance, --upgrade with a migration', async () => {
  const dir = await Deno.makeTempDir()
  const files = (text: string) => [{ name: 'component.json', base64: btoa(text) }]
  const card = { ident: 'did:bns:alice#card', deps: [], provenance: { pkg_id: 'p', version: '0.2.0', digest: 'sha256:c' }, files: files('{"card":1}') }
  const board = { ident: 'did:bns:alice#board', deps: ['did:bns:alice#card'], provenance: { pkg_id: 'p', version: '0.2.0', digest: 'sha256:b' }, files: files('{"board":1}') }
  await Deno.writeTextFile(`${dir}/bundle.json`, JSON.stringify({ pkg_id: 'p', controls: [board, card] }))
  await Deno.writeTextFile(`${dir}/m.json`, JSON.stringify({ 'did:bns:alice#board': { slots: { rename: { items: 'cards' } } } }))
  const calls: RecordedCall[] = []
  let cardExists = true
  const clients = clientsFor(calls, (method, params) => {
    if (method === 'ext.library_bundle') return { ok: true, pkg_id: params.pkg_id, controls: [card, board] }
    if (method !== 'ext.build') throw new Error(method)
    const ident = (params.provenance as { digest: string }).digest === 'sha256:c' ? card.ident : board.ident
    if (ident === card.ident && cardExists && params.upgrade !== true) return { ok: false, error: { code: 'INVALID_OPERATION', sub_code: 'EXT_IDENT_EXISTS', detail: 'from another source', data: { def_entity_id: 'def_card' } } }
    return { ok: true, status: 'accepted', def_entity_id: `def_${ident.split('#')[1]}`, action: params.upgrade ? 'rebuilt' : 'created', version: 2 }
  })
  // the library side writes the file the other Zone builds from
  const written = await run('library', { action: 'bundle', target: 'p', out: `${dir}/again.json`, idents: 'did:bns:alice#board' }, clients)
  assertEquals(calls[0].params, { pkg_id: 'p', idents: ['did:bns:alice#board'] })
  assertEquals((written.controls as { ident: string }[]).map((c) => c.ident), [card.ident, board.ident])
  assertEquals(JSON.parse(await Deno.readTextFile(`${dir}/again.json`)).controls.length, 2)
  // a dependency the Workspace holds from another source meets it; the board builds on that one
  calls.length = 0
  const imported = await run('ext-import', { workspace_id: 'ws_b', bundle: `${dir}/bundle.json`, folder_id: 'fld' }, clients)
  assertEquals(imported.controls, [{ ident: card.ident, def_entity_id: 'def_card', action: 'satisfied' }, { ident: board.ident, def_entity_id: 'def_board', action: 'created', version: 2 }])
  assertEquals(calls.map((c) => (c.params.provenance as { digest: string }).digest), ['sha256:c', 'sha256:b'])
  assertEquals(calls[1].params, { workspace_id: 'ws_b', files: [{ name: 'component.json', base64: btoa('{"board":1}') }], provenance: board.provenance, folder_id: 'fld' })
  // --upgrade rebuilds both, each with its own migration
  calls.length = 0
  await run('ext-import', { workspace_id: 'ws_b', bundle: `${dir}/bundle.json`, upgrade: true, migration: `${dir}/m.json` }, clients)
  assertEquals(calls.map((c) => [c.params.upgrade, c.params.migration]), [[true, undefined], [true, { 'did:bns:alice#board': { slots: { rename: { items: 'cards' } } } }]])
  // the chosen control itself is never silently kept
  cardExists = true
  await Deno.writeTextFile(`${dir}/card.json`, JSON.stringify({ controls: [card] }))
  await assertRejects(() => run('ext-import', { workspace_id: 'ws_b', bundle: `${dir}/card.json` }, clients))
  calls.length = 0
  await assertRejects(() => run('ext-import', { workspace_id: 'ws_b', items: 'p#did:bns:alice#card', upgrade: true }, clients))
  await assertRejects(() => run('ext-import', { workspace_id: 'ws_b', bundle: `${dir}/bundle.json`, migration: `${dir}/m.json` }, clients))
  await assertRejects(() => run('ext-import', { workspace_id: 'ws_b', bundle: `${dir}/bundle.json`, items: 'p#did:bns:alice#card' }, clients))
  await assertRejects(() => run('ext-import', { workspace_id: 'ws_b', bundle: `${dir}/m.json` }, clients))
  assertEquals(calls.length, 0)
})

Deno.test('template list / create: the library templates, typed params, the new Workspace', async () => {
  const command = createRegistry().get('aiws', 'template')
  assertEquals(parseCommandArgs(command, ['create', 'team.alice.bns.did#team-board', '--title', 'Ops', '--param', 'team_name=Ops,size=3'], undefined).input, {
    action: 'create', target: 'team.alice.bns.did#team-board', title: 'Ops', param: 'team_name=Ops,size=3',
  })
  const calls: RecordedCall[] = []
  const library = { ok: true, packages: [{ pkg_id: 'team.alice.bns.did', version: '0.1.0', controls: [], templates: [{ id: 'team-board', title: 'Team board', params: { team_name: { type: 'string' }, size: { type: 'number' }, archived: { type: 'boolean' } }, requires: { controls: [] } }] }, { pkg_id: 'other', version: '1.0.0', controls: [] }] }
  const clients = clientsFor(calls, (method) => {
    if (method === 'ext.list_library') return library
    if (method === 'ext.create_from_template') return { ok: true, workspace_id: 'ws_new' }
    throw new Error(method)
  })
  const listed = await run('template', { action: 'list' }, clients)
  assertEquals((listed.templates as { ref: string; version: string }[]).map((t) => [t.ref, t.version]), [['team.alice.bns.did#team-board', '0.1.0']])
  const created = await run('template', { action: 'create', target: 'team.alice.bns.did#team-board', title: 'Ops', param: 'team_name=Ops, size=3,archived=false' }, clients)
  assertEquals(created.workspace_id, 'ws_new')
  assertEquals(calls.at(-1)?.params, { pkg_id: 'team.alice.bns.did', template_id: 'team-board', title: 'Ops', params: { team_name: 'Ops', size: 3, archived: false } })
  calls.length = 0
  await run('template', { action: 'create', target: 'team.alice.bns.did#team-board' }, clients)
  assertEquals(calls.map((c) => c.method), ['ext.create_from_template'])
  assertEquals(calls[0].params, { pkg_id: 'team.alice.bns.did', template_id: 'team-board' })
  for (const bad of [{ target: 'no-template' }, { target: 'p#' }, { target: 'team.alice.bns.did#team-board', param: 'owner=bob' }, { target: 'team.alice.bns.did#team-board', param: 'size=many' }, { target: 'team.alice.bns.did#team-board', param: 'archived=yes' }, { target: 'other#x', param: 'a=b' }]) {
    await assertRejects(() => run('template', { action: 'create', ...bad }, clients))
  }
  await assertRejects(() => run('template', { action: 'apply' }, clients))
})

Deno.test('template export writes one bundle: the template files, the controls it needs, manifest_version 3', async () => {
  const { aiwsContentDigest, aiwsTemplateDigest, verifyBundle, controlSkeleton } = await import('buckyos/node')
  const encoder = new TextEncoder()
  const skeleton: Record<string, string> = Object.fromEntries(Object.entries(controlSkeleton({ authorDid: 'did:bns:alice', name: 'kpi', title: 'KPI' })).map(([n, t]) => [n, String(t)]))
  const controlDigest = await aiwsContentDigest(Object.entries(skeleton).map(([n, t]) => [n, encoder.encode(t)] as [string, Uint8Array]))
  const snapshot = JSON.stringify({ format: 'aiws-template/1', content_root: 'r', entities: [] })
  const templateFiles: [string, Uint8Array][] = [['templates/team/snapshot.json', encoder.encode(snapshot)], ['templates/team/objects/o1', encoder.encode('{}')]]
  const item = { id: 'team', title: 'Team board', snapshot: 'templates/team/snapshot.json', digest: await aiwsTemplateDigest(templateFiles, 'team'), requires: { host_api: { declarative: 1 }, controls: ['did:bns:alice#kpi'] }, params: { team_name: { type: 'string', default: 'Team' } }, reset: { tables: ['tasks'] } }
  const calls: RecordedCall[] = []
  const clients = clientsFor(calls, (method) => {
    if (method === 'ext.export_template') {
      return { ok: true, template: item, controls: [{ entity_id: 'def_kpi', ident: 'did:bns:alice#kpi' }], files: [{ path: 'templates/team/snapshot.json', base64: btoa(snapshot) }, { path: 'objects/o1', base64: btoa('{}') }] }
    }
    if (method === 'ext.export') {
      return {
        ok: true, manifest: { manifest_version: 1, purpose: 'aiws', host_api: { declarative: 1 }, controls: [{ ident: 'did:bns:alice#kpi', name: 'kpi', kind: 'declarative', version: 2, digest: controlDigest, dir: 'controls/kpi/' }], workspace_templates: [] },
        controls: [{ entity_id: 'def_kpi' }], files: Object.entries(skeleton).map(([n, t]) => ({ path: `controls/kpi/${n}`, size: t.length, text: t })),
      }
    }
    throw new Error(method)
  })
  const out = await Deno.makeTempDir()
  const result = await run('template', { action: 'export', workspace_id: 'ws_a', surfaces: 'sf_board, sf_kpi', id: 'team', title: 'Team board', description: 'A board', data: 'tasks', param: 'team_name:string:Team,size:number:3,urgent:boolean', reset: 'tasks', out }, clients)
  assertEquals(calls[0].params, {
    workspace_id: 'ws_a', surfaces: ['sf_board', 'sf_kpi'], data: ['tasks'],
    template: { id: 'team', title: 'Team board', description: 'A board', params: { team_name: { type: 'string', default: 'Team' }, size: { type: 'number', default: 3 }, urgent: { type: 'boolean' } }, reset: { tables: ['tasks'] } },
  })
  assertEquals(calls[1].params, { workspace_id: 'ws_a', entity_ids: ['def_kpi'], purpose: 'package' })
  assertEquals((result.template as { id: string }).id, 'team')
  const root = join(out, 'aiws')
  assertEquals(result.bundle, root)
  const manifest = JSON.parse(await Deno.readTextFile(`${root}/aiws-manifest.json`))
  assertEquals([manifest.manifest_version, manifest.workspace_templates, manifest.controls.length], [3, [item], 1])
  const bundle = new Map<string, Uint8Array>()
  for (const path of ['aiws-manifest.json', ...Object.keys(skeleton).map((n) => `controls/kpi/${n}`), 'templates/team/snapshot.json', 'templates/team/objects/o1']) bundle.set(path, await Deno.readFile(`${root}/${path}`))
  assertEquals((await verifyBundle(bundle)).diagnostics.filter((d: { severity: string }) => d.severity === 'error'), [])
  for (const bad of [{ id: 'Team' }, { param: 'size:int' }, { param: 'size:number:many' }]) {
    await assertRejects(() => run('template', { action: 'export', workspace_id: 'ws_a', surfaces: 's', id: 'team', title: 'T', out, ...bad }, clients))
  }
})

