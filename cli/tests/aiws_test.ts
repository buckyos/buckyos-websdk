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
      ['query', 'read'],
      ['controls', 'read'],
      ['import', 'write'],
      ['export', 'read'],
      ['run-get', 'read'],
      ['run-files', 'read'],
      ['run-claim', 'write'],
      ['run-heartbeat', 'write'],
      ['run-tool', 'write'],
      ['run-program', 'write'],
      ['run-report', 'write'],
    ]
  ) {
    const described = registry.describe('aiws', verb)
    assertEquals(described.access, { mode: 'fixed', level })
    assertEquals(described.requires_session, true)
  }
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
