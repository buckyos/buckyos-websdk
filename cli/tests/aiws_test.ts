import './setup.ts'
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
