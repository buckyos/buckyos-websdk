import './setup.ts'
import { createRegistry } from '../core/app.ts'
import { ConfigStore } from '../core/config.ts'
import { createMockCommandContext } from '../core/context.ts'
import type { RpcCallOptions, ServiceClientRegistry } from '../core/runtime.ts'
import { assertEquals, assertRejects, testConfig } from './test_helpers.ts'

interface RecordedCall {
  service: string
  method: string
  params: Record<string, unknown>
}

const INFO = {
  schema_version: 1,
  version: '0.7.0',
  build_version: 'build261017.main.1b6e277fadd9.dirty',
  release_channel: 'nightly',
  target: 'x86_64-unknown-linux-musl',
}

Deno.test('admin verbs are registered and describable', () => {
  const registry = createRegistry()
  for (
    const [module, verb, level] of [
      ['system', 'info', 'read'],
      ['log', 'services', 'read'],
      ['agent', 'list', 'read'],
      ['agent', 'get', 'read'],
      ['agent', 'profile-get', 'read'],
      ['agent', 'profile-set', 'write'],
      ['ai', 'providers', 'read'],
      ['ai', 'routing', 'read'],
      ['ai', 'usage', 'read'],
    ]
  ) {
    const described = registry.describe(module, verb)
    assertEquals(described.access, { mode: 'fixed', level })
    assertEquals(described.requires_session, true)
  }
})

Deno.test('system info reads buckyos_info and status carries the version', async () => {
  const calls: RecordedCall[] = []
  const clients = clientsFor(calls, (method) => {
    if (method === 'system.buckyos_info.get') return INFO
    if (method === 'system.status') return { state: 'online', warnings: [], services: [] }
    throw new Error(`unexpected method ${method}`)
  })
  assertEquals(await run('system', 'info', {}, clients), INFO)
  assertEquals(await run('system', 'status', {}, clients), {
    state: 'online',
    warnings: [],
    services: [],
    buckyos: INFO,
  })
  assertEquals(calls.map((call) => `${call.service} ${call.method}`), [
    'control-panel system.buckyos_info.get',
    'control-panel system.status',
    'control-panel system.buckyos_info.get',
  ])
})

Deno.test('log services lists ids and --level warn matches stored warning', async () => {
  const calls: RecordedCall[] = []
  const clients = clientsFor(calls, (method) => {
    if (method === 'system.logs.list') return { services: [{ id: 'aicc', label: 'Aicc' }] }
    if (method === 'system.logs.query') return { entries: [], nextCursor: null }
    throw new Error(`unexpected method ${method}`)
  })
  assertEquals(await run('log', 'services', {}, clients), {
    services: [{ id: 'aicc', label: 'Aicc' }],
  })
  await run('log', 'query', { service: 'scheduler', level: 'WARN' }, clients)
  assertEquals(calls[1].params.level, 'warning')
  await assertRejects(
    () => run('log', 'query', { service: 'scheduler', level: 'fatal' }, clients),
    'INVALID_ARGUMENT',
  )
})

Deno.test('agent verbs call control-panel and profile-set returns before and after', async () => {
  const calls: RecordedCall[] = []
  let profile: Record<string, unknown> = { display_name: 'xiaobai' }
  const clients = clientsFor(calls, (method, params) => {
    if (method === 'agent.list') return { agents: [{ agent_id: 'xiaobai.test.zone' }] }
    if (method === 'agent.get') return { agent_id: params.agent_id, display_name: 'xiaobai' }
    if (method === 'agent.profile.get') {
      if (params.agent_id !== 'xiaobai.test.zone') {
        throw new Error('RPC call error: agent_not_found: nobody.test.zone')
      }
      return { profile }
    }
    if (method === 'agent.profile.set') {
      profile = { ...profile, display_name: params.display_name }
      return { profile }
    }
    throw new Error(`unexpected method ${method}`)
  })
  assertEquals(await run('agent', 'list', {}, clients), {
    agents: [{ agent_id: 'xiaobai.test.zone' }],
  })
  assertEquals(await run('agent', 'get', { agent_id: 'xiaobai.test.zone' }, clients), {
    agent_id: 'xiaobai.test.zone',
    display_name: 'xiaobai',
  })
  assertEquals(await run('agent', 'profile-get', { agent_id: 'xiaobai.test.zone' }, clients), {
    agent_id: 'xiaobai.test.zone',
    profile: { display_name: 'xiaobai' },
  })
  assertEquals(
    await run(
      'agent',
      'profile-set',
      { agent_id: 'xiaobai.test.zone', display_name: 'Xiao Bai' },
      clients,
    ),
    {
      agent_id: 'xiaobai.test.zone',
      before: { display_name: 'xiaobai' },
      profile: { display_name: 'Xiao Bai' },
    },
  )
  assertEquals(calls.at(-1)!.params, { agent_id: 'xiaobai.test.zone', display_name: 'Xiao Bai' })
  await assertRejects(
    () => run('agent', 'profile-set', { agent_id: 'xiaobai.test.zone' }, clients),
    'INVALID_ARGUMENT',
  )
  await assertRejects(
    () => run('agent', 'profile-get', { agent_id: 'nobody.test.zone' }, clients),
    'RESOURCE_NOT_FOUND',
  )
})

Deno.test('ai read views call aicc and usage maps its range options', async () => {
  const calls: RecordedCall[] = []
  const clients = clientsFor(calls, (method) => {
    if (method === 'provider.list') {
      return { providers: [], settings_revision: 1, inventory_revision: '1:1' }
    }
    if (method === 'routing.get') return { routing: {}, settings_revision: 1 }
    if (method === 'usage.query') return { total: { total_requests: 0 } }
    throw new Error(`unexpected method ${method}`)
  })
  assertEquals((await run('ai', 'providers', {}, clients)).settings_revision, 1)
  assertEquals((await run('ai', 'routing', {}, clients)).routing, {})
  await run('ai', 'usage', {}, clients)
  await run(
    'ai',
    'usage',
    {
      since: '2026-10-01T00:00:00Z',
      until: '2026-10-02T00:00:00Z',
      group_by: 'provider_instance_name,provider_model',
      bucket: 'day',
      events: true,
      limit: 10,
    },
    clients,
  )
  assertEquals(calls.map((call) => call.service), ['aicc', 'aicc', 'aicc', 'aicc'])
  assertEquals(calls[2].params, { time_range: { kind: 'last7d' }, output_mode: 'summary' })
  assertEquals(calls[3].params, {
    time_range: {
      kind: 'explicit',
      start_time_ms: Date.parse('2026-10-01T00:00:00Z'),
      end_time_ms: Date.parse('2026-10-02T00:00:00Z'),
    },
    group_by: ['provider_instance_name', 'provider_model'],
    time_bucket: 'day',
    output_mode: 'summary_and_events',
    limit: 10,
  })
  await assertRejects(
    () => run('ai', 'usage', { group_by: 'provider' }, clients),
    'INVALID_ARGUMENT',
  )
  await assertRejects(
    () => run('ai', 'usage', { range: 'last1d', since: '2026-10-01T00:00:00Z' }, clients),
    'ARGUMENT_CONFLICT',
  )
  await assertRejects(
    () => run('ai', 'usage', { until: '2026-10-01T00:00:00Z' }, clients),
    'INVALID_ARGUMENT',
  )
})

function clientsFor(
  calls: RecordedCall[],
  response: (method: string, params: Record<string, unknown>) => unknown,
): ServiceClientRegistry {
  return {
    call: <T>(
      service: string,
      method: string,
      params: Record<string, unknown>,
      _options: RpcCallOptions,
    ) => {
      calls.push({ service, method, params })
      try {
        return Promise.resolve(response(method, params) as T)
      } catch (error) {
        return Promise.reject(error)
      }
    },
  }
}

async function run(
  module: string,
  verb: string,
  input: Record<string, unknown>,
  clients: ServiceClientRegistry,
): Promise<Record<string, unknown>> {
  const command = createRegistry().get(module, verb)
  const context = createMockCommandContext({
    command,
    config: testConfig(),
    configStore: new ConfigStore('/tmp/buckyos-tool-zone-admin-test'),
    clients,
    traceId: 'zone-admin-test',
  })
  context.deadline = Date.now() + 10_000
  return await command.handler(context, input) as Record<string, unknown>
}
