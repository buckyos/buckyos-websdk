import './setup.ts'
import { parseCommandArgs } from '../core/argv.ts'
import { ConfigStore } from '../core/config.ts'
import { createMockCommandContext } from '../core/context.ts'
import { CommandRegistry } from '../core/registry.ts'
import type { RpcCallOptions, ServiceClientRegistry } from '../core/runtime.ts'
import { createAgentModule } from '../modules/agent.ts'
import { agentRuntimeRows, catalogRows, createRuntimeModule, deviceOf, impactText } from '../modules/runtime.ts'
import { assert, assertEquals, assertRejects, testConfig } from './test_helpers.ts'

interface RecordedCall {
  service: string
  method: string
  params: Record<string, unknown>
}

const JARVIS = 'jarvis.test.zone'
const HELPER = 'helper.test.zone'

function registry(): CommandRegistry {
  const registry = new CommandRegistry()
  registry.register(createRuntimeModule())
  registry.register(createAgentModule())
  return registry
}

interface RunOptions {
  confirmed?: boolean
  answer?: string
  stderr?: string[]
  output?: 'json' | 'table'
}

async function run(
  module: string,
  argv: string[],
  calls: RecordedCall[],
  respond: (call: RecordedCall) => unknown,
  options: RunOptions = {},
): Promise<Record<string, unknown>> {
  const command = registry().get(module, argv[0])
  const { input } = parseCommandArgs(command, argv.slice(1), undefined)
  const clients = {
    call: <T>(service: string, method: string, params: Record<string, unknown>, _options?: RpcCallOptions): Promise<T> => {
      const call = { service, method, params }
      calls.push(call)
      try {
        return Promise.resolve(respond(call) as T)
      } catch (error) {
        return Promise.reject(error)
      }
    },
  } as unknown as ServiceClientRegistry
  const interactive = options.answer !== undefined
  const context = createMockCommandContext({
    command,
    config: testConfig({ nonInteractive: !interactive, output: options.output ?? 'json' }),
    configStore: new ConfigStore('/tmp/buckyos-tool-runtime-test'),
    clients,
  })
  context.confirmed = options.confirmed === true
  if (interactive) {
    context.io.inputIsTerminal = true
    context.io.prompt = () => Promise.resolve(options.answer!)
    context.io.stderr = (value) => {
      options.stderr?.push(value)
      return Promise.resolve()
    }
  }
  return await command.handler(context, input) as Record<string, unknown>
}

async function failure(run: () => Promise<unknown>): Promise<{ code: string; message: string; exitCode: number; details: Record<string, unknown> }> {
  try {
    await run()
  } catch (error) {
    return error as { code: string; message: string; exitCode: number; details: Record<string, unknown> }
  }
  throw new Error('expected operation to reject')
}

const CATALOG = {
  runtimes: [
    {
      runtime_id: 'host', kind: 'node', node_id: 'ood1', node_did: 'did:dev:ood1', device_type: 'ood', executor_id: null, name: 'ood1',
      computer: 'none', workdir_roots: ['/home/alice'], read_only: false, baseline: 'extended', expires_at_ms: null, run_as: 'alice',
      closed: false, os: 'linux', online: null,
      assigned_to: [{ agent_id: JARVIS, runtime_id: 'host', enabled: true, default: true }],
    },
    {
      runtime_id: 'exec-laptop', kind: 'executor', node_id: '', node_did: '', device_type: 'device', executor_id: 'laptop', name: 'Laptop',
      computer: 'control', workdir_roots: ['/work', '/data'], read_only: true, baseline: 'standard', expires_at_ms: 1_800_000_000_000,
      run_as: '', closed: false, os: 'macos', online: true,
      assigned_to: [
        { agent_id: HELPER, runtime_id: 'exec-laptop', enabled: false, default: false },
        { agent_id: JARVIS, runtime_id: 'exec-laptop', enabled: true, default: false },
      ],
    },
  ],
  container: 'container',
  container_available: true,
  host_by_default: false,
}

const IMPACT = {
  runtime_id: 'exec-laptop',
  owner_default: false,
  blocking: true,
  active_sessions: [{ session_id: 'work-1', kind: 'work', class: 'task', title: 'Cut the video', run_state: 'running' }],
  pending_todos: [{ session_id: 'plan-1', todo_id: 't2', title: 'Render', status: 'pending' }],
  workspaces: [{ workspace_id: 'ws-1', name: 'video', directory: '/work/video', lifecycle: 'active' }],
  usage: { sessions_total: 3, workspaces: 1 },
}
const IDLE = { ...IMPACT, blocking: false, active_sessions: [], pending_todos: [], workspaces: [] }
const SETTINGS = { runtimes: { host: { enabled: true, target: { kind: 'node', node_id: 'ood1' } } }, default_runtime_id: 'host' }

Deno.test('runtime: the verbs, their access, and how `agent runtime <action>` parses', () => {
  const commands = registry()
  assertEquals(
    createRuntimeModule().commands.map((command) => [command.verb, (command.access as { level: string }).level]),
    [['list', 'read'], ['assign', 'write'], ['unassign', 'destructive'], ['revoke', 'destructive']],
  )
  assert(createRuntimeModule().commands.every((command) => command.requiresSession && command.examples?.length))
  const agentRuntime = commands.get('agent', 'runtime')
  assertEquals(agentRuntime.access, { mode: 'operation', operationIdField: 'action', possibleLevels: ['read', 'write'] })
  assertEquals(commands.syntax(agentRuntime), 'buckyos agent runtime <action> [runtime_id] [--agent <agent_id>]')
  assertEquals(parseCommandArgs(agentRuntime, ['list', '--agent', JARVIS], undefined).input, { action: 'list', agent_id: JARVIS })
  assertEquals(
    parseCommandArgs(agentRuntime, ['disable', 'exec-laptop', '--agent', JARVIS], undefined).input,
    { action: 'disable', runtime_id: 'exec-laptop', agent_id: JARVIS },
  )
  assertEquals(
    parseCommandArgs(commands.get('runtime', 'assign'), ['host', '--agent', JARVIS, '--disabled'], undefined).input,
    { runtime_id: 'host', agent_id: JARVIS, disabled: true },
  )
  for (const argv of [['add-ssh', '--agent', JARVIS], ['list'], ['enable', 'host', '--agent', JARVIS, '--computer', 'control']]) {
    let refused = false
    try {
      parseCommandArgs(agentRuntime, argv, undefined)
    } catch {
      refused = true
    }
    assert(refused, argv.join(' '))
  }
  assert(!createRuntimeModule().commands.some((command) => command.verb.includes('ssh')))
  for (const command of [...createRuntimeModule().commands, agentRuntime]) {
    assertEquals((command.options ?? []).map((option) => option.name).filter((name) => name !== 'agent' && name !== 'disabled'), [])
  }
})

Deno.test('runtime list: the catalog as it is, and as a compact table', async () => {
  const calls: RecordedCall[] = []
  const listed = await run('runtime', ['list'], calls, () => CATALOG)
  assertEquals(calls, [{ service: 'control-panel', method: 'agent.runtime_catalog', params: {} }])
  assertEquals(listed, CATALOG)
  const table = await run('runtime', ['list'], calls, () => CATALOG, { output: 'table' })
  assertEquals(table.runtimes, catalogRows(CATALOG.runtimes))
  assertEquals(table.runtimes, [
    { id: 'host', kind: 'node', name: 'ood1', state: 'open', online: '', expires: '', allows: '/home/alice rw baseline=extended', agents: `*${JARVIS} (default)` },
    {
      id: 'exec-laptop', kind: 'device', name: 'Laptop', state: 'open', online: 'yes', expires: '2027-01-15T08:00:00.000Z',
      allows: '/work,/data ro computer=control baseline=standard', agents: `${HELPER}, *${JARVIS}`,
    },
  ])
  assertEquals(catalogRows([{ runtime_id: 'node-b', kind: 'node', closed: true, online: false }])[0].state, 'closed')
})

Deno.test('runtime assign: enabled only, and a device in use names who has it', async () => {
  const calls: RecordedCall[] = []
  assertEquals(
    await run('runtime', ['assign', 'host', '--agent', JARVIS], calls, () => ({ ok: true })),
    { agent_id: JARVIS, runtime_id: 'host', assigned: true, enabled: true },
  )
  await run('runtime', ['assign', 'exec-laptop', '--agent', HELPER, '--disabled'], calls, () => ({ ok: true }))
  assertEquals(calls, [
    { service: 'control-panel', method: 'agent.update', params: { agent_id: JARVIS, runtimes: { host: { enabled: true } } } },
    { service: 'control-panel', method: 'agent.update', params: { agent_id: HELPER, runtimes: { 'exec-laptop': { enabled: false } } } },
  ])

  calls.length = 0
  const inUse = await failure(() =>
    run('runtime', ['assign', 'exec-laptop', '--agent', HELPER], calls, (call) => {
      if (call.method === 'agent.runtime_catalog') return CATALOG
      throw new Error(`rpc error: runtime_in_use: device \`Laptop\` is in use by Agent \`${JARVIS}\`: a device is used by one Agent at a time; switch it off there first`)
    })
  )
  assertEquals([inUse.code, inUse.exitCode], ['RUNTIME_IN_USE', 6])
  assertEquals(inUse.details, { in_use_by: JARVIS, disable_command: `buckyos agent runtime disable exec-laptop --agent ${JARVIS}` })
  assert(inUse.message.includes(`buckyos agent runtime disable exec-laptop --agent ${JARVIS}`), inUse.message)
  assertEquals(calls.map((call) => call.method), ['agent.update', 'agent.runtime_catalog'], 'nothing is switched off for the caller')

  const refused = await failure(() =>
    run('runtime', ['assign', 'node-x', '--agent', JARVIS], [], () => {
      throw new Error("runtime_not_offered: runtime `node-x` is not in this owner's runtime directory (see agent.runtime_catalog)")
    })
  )
  assertEquals(refused.code, 'RUNTIME_NOT_OFFERED')
  await assertRejects(() => run('runtime', ['assign', 'host', '--agent', '../control-panel'], [], () => ({})), 'INVALID_AGENT_ID')
})

Deno.test('runtime unassign: refused while sessions run there, otherwise removed without asking', async () => {
  let calls: RecordedCall[] = []
  const busy = await failure(() =>
    run('runtime', ['unassign', 'exec-laptop', '--agent', JARVIS], calls, (call) => call.method === 'runtimes.impact' ? IMPACT : SETTINGS, { confirmed: true })
  )
  assertEquals([busy.code, busy.exitCode], ['SESSIONS_IN_PROGRESS', 6])
  assert(busy.message.includes('session work-1'), busy.message)
  assertEquals(busy.details, { impact: IMPACT })
  assertEquals(calls.map((call) => call.method), ['runtimes.impact'], '--yes does not override it')

  calls = []
  const removed = await run('runtime', ['unassign', 'exec-laptop', '--agent', JARVIS], calls, (call) => call.method === 'runtimes.impact' ? IDLE : SETTINGS)
  assertEquals(calls, [
    { service: JARVIS, method: 'runtimes.impact', params: { runtime_id: 'exec-laptop' } },
    { service: JARVIS, method: 'runtimes.remove', params: { runtime_id: 'exec-laptop' } },
  ])
  assertEquals([removed.removed, removed.via, removed.settings], [true, 'agent', SETTINGS])
})

Deno.test('runtime unassign: an unreachable Agent service is said, and only --yes falls back to the control panel', async () => {
  const respond = (call: RecordedCall) => {
    if (call.service === JARVIS) throw new Error('rpc call error: 503 Service Unavailable')
    return { ok: true }
  }
  let calls: RecordedCall[] = []
  const unavailable = await failure(() => run('runtime', ['unassign', 'host', '--agent', JARVIS], calls, respond, { answer: 'y' }))
  assertEquals([unavailable.code, unavailable.exitCode], ['AGENT_SERVICE_UNAVAILABLE', 5])
  assert(unavailable.message.includes(`the service of ${JARVIS} cannot be reached`), unavailable.message)
  assertEquals(calls.map((call) => call.method), ['runtimes.impact'])

  calls = []
  const removed = await run('runtime', ['unassign', 'host', '--agent', JARVIS], calls, respond, { confirmed: true })
  assertEquals(calls.at(-1), { service: 'control-panel', method: 'agent.update', params: { agent_id: JARVIS, runtimes: { host: null } } })
  assertEquals([removed.via, removed.impact], ['control-panel', null])
  assert(String(removed.warning).includes('unknown'))

  await assertRejects(
    () => run('runtime', ['unassign', 'host', '--agent', JARVIS], [], () => { throw new Error('rpc error: runtime `host` is not assigned to this agent') }, { confirmed: true }),
  )
})

Deno.test('runtime revoke: devices only, refused while the Agent using it runs sessions there, otherwise asks', async () => {
  let impact: Record<string, unknown> = IMPACT
  const respond = (call: RecordedCall) => {
    if (call.method === 'agent.runtime_catalog') return CATALOG
    if (call.method === 'runtimes.impact') return impact
    return { unassigned: [HELPER, JARVIS] }
  }
  await assertRejects(() => run('runtime', ['revoke', 'host'], [], respond, { confirmed: true }), 'INVALID_ARGUMENT')
  await assertRejects(() => run('runtime', ['revoke', 'node-b'], [], respond, { confirmed: true }), 'INVALID_ARGUMENT')

  let calls: RecordedCall[] = []
  const busy = await failure(() => run('runtime', ['revoke', 'exec-laptop'], calls, respond, { confirmed: true }))
  assertEquals(busy.code, 'SESSIONS_IN_PROGRESS')
  assertEquals((busy.details.impacts as unknown[]).length, 1)
  assert(busy.message.includes('session work-1 [work/task, running] Cut the video'), busy.message)
  assertEquals(calls.map((call) => [call.service, call.method]), [['control-panel', 'agent.runtime_catalog'], [JARVIS, 'runtimes.impact']])

  impact = IDLE
  calls = []
  const required = await failure(() => run('runtime', ['revoke', 'exec-laptop'], calls, respond))
  assertEquals(required.code, 'CONFIRMATION_REQUIRED')

  calls = []
  const stderr: string[] = []
  const revoked = await run('runtime', ['revoke', 'laptop'], calls, respond, { answer: 'yes', stderr })
  const shown = stderr.join('')
  assert(shown.includes('Device exec-laptop (Laptop) is assigned to 2 Agent(s)'), shown)
  assert(shown.includes(`    ${HELPER}`) && shown.includes(`  * ${JARVIS}`), shown)
  assertEquals(calls.at(-1), { service: 'control-panel', method: 'executor.device.revoke', params: { executor_id: 'laptop' } })
  assertEquals([revoked.runtime_id, revoked.executor_id, revoked.unassigned], ['exec-laptop', 'laptop', [HELPER, JARVIS]])

  assertEquals(deviceOf('exec-gone', CATALOG.runtimes), { runtime_id: 'exec-gone', executor_id: 'gone' })
  assertEquals(deviceOf('tablet', []), { runtime_id: 'exec-tablet', executor_id: 'tablet' })
})

const RECORDS = [
  {
    runtime_id: 'private', name: 'Private', connector: { type: 'container' }, enabled: true, availability: 'available', lifecycle: 'active', default: false,
    caps: { os: 'linux', baseline: 'standard' }, grant: { ops: ['exec', 'read', 'write'], roots: [], computer: 'none' }, usage: { sessions_total: 12, workspaces: 2 },
  },
  {
    runtime_id: 'exec-old', name: 'Old tablet', connector: { type: 'executor' }, enabled: false, availability: 'runtime_unavailable', lifecycle: 'retired',
    default: false, caps: { os: 'macos', baseline: 'standard' }, grant: { ops: ['read'], roots: ['/work'], computer: 'observe' },
    usage: { sessions_total: 4, last_used_at_ms: 1_700_000_000_000, last_session_id: 'work-9', workspaces: 1 },
  },
  {
    runtime_id: 'host', name: 'ood1', connector: { type: 'executor' }, enabled: true, availability: 'available', lifecycle: 'active', default: true,
    caps: { os: 'linux', baseline: 'extended' }, grant: { ops: ['exec', 'read', 'write'], roots: ['/home/alice'], computer: 'none', expires_at_ms: 1_800_000_000_000 },
    usage: { sessions_total: 7, workspaces: 0 },
  },
]

Deno.test('agent runtime list: current ones, then history; the control panel when the service is unreachable', async () => {
  const settings = { ...SETTINGS, configured_default_runtime_id: 'host' }
  const respond = (call: RecordedCall) => call.method === 'runtimes.list' ? RECORDS : settings
  const calls: RecordedCall[] = []
  const listed = await run('agent', ['runtime', 'list', '--agent', JARVIS], calls, respond)
  assertEquals(calls.map((call) => [call.service, call.method, call.params]), [[JARVIS, 'runtimes.list', {}], [JARVIS, 'runtimes.settings', {}]])
  assertEquals((listed.runtimes as { runtime_id: string }[]).map((record) => record.runtime_id), ['private', 'host'])
  assertEquals((listed.history as { runtime_id: string }[]).map((record) => record.runtime_id), ['exec-old'])
  assertEquals([listed.source, listed.default_runtime_id, listed.configured_default_runtime_id], ['agent', 'host', 'host'])

  const table = await run('agent', ['runtime', 'list', '--agent', JARVIS], [], respond, { output: 'table' })
  assertEquals(table.runtimes, agentRuntimeRows(RECORDS, settings))
  assertEquals((table.runtimes as Record<string, string>[]).map((row) => [row.id, row.state, row.default, row.sessions, row.last_used]), [
    ['private', 'available', '', '12', ''],
    ['host', 'available', '*', '7', ''],
    ['exec-old', 'retired', '', '4', '2023-11-14T22:13:20.000Z'],
  ])
  assertEquals((table.runtimes as Record<string, string>[])[1].allows, '/home/alice exec,read,write baseline=extended')

  calls.length = 0
  const directory = {
    runtimes: [
      { ...CATALOG.runtimes[0], assigned: true, enabled: true, in_use_by: null },
      { ...CATALOG.runtimes[1], assigned: false, enabled: false, in_use_by: HELPER },
    ],
    default_runtime_id: 'host',
    configured_default_runtime_id: 'host',
    container: 'container',
    container_available: true,
    host_by_default: false,
  }
  const fallback = await run('agent', ['runtime', 'list', '--agent', JARVIS], calls, (call) => {
    if (call.service === JARVIS) throw new Error('fetch failed')
    return directory
  })
  assertEquals(calls.at(-1), { service: 'control-panel', method: 'agent.runtime_directory', params: { agent_id: JARVIS } })
  assertEquals(fallback.source, 'control-panel')
  assertEquals((fallback.runtimes as { runtime_id: string }[]).map((runtime) => runtime.runtime_id), ['host'])
  assert(String(fallback.note).includes('cannot be reached'))
  await assertRejects(() => run('agent', ['runtime', 'list', 'host', '--agent', JARVIS], [], respond), 'ARGUMENT_CONFLICT')
})

Deno.test('agent runtime enable, disable and default: settings_set; a disable with sessions in progress is refused', async () => {
  let busy = false
  const respond = (call: RecordedCall) => {
    if (call.params.enabled === false && busy) {
      throw new Error('RPC call error: Failed due to reason: {"at_ms":1,"kind":"invalid_argument","message":"invalid argument: sessions_in_progress: runtime `exec-laptop` has 1 session(s) in progress (work-1); stop them or let them finish, then switch it off"}')
    }
    return SETTINGS
  }
  let calls: RecordedCall[] = []
  await run('agent', ['runtime', 'enable', 'host', '--agent', JARVIS], calls, respond)
  await run('agent', ['runtime', 'default', 'private', '--agent', JARVIS], calls, respond)
  const disabled = await run('agent', ['runtime', 'disable', 'exec-laptop', '--agent', JARVIS], calls, respond)
  assertEquals(calls, [
    { service: JARVIS, method: 'runtimes.settings_set', params: { runtime_id: 'host', enabled: true } },
    { service: JARVIS, method: 'runtimes.settings_set', params: { runtime_id: 'private', default: true } },
    { service: JARVIS, method: 'runtimes.settings_set', params: { runtime_id: 'exec-laptop', enabled: false } },
  ])
  assertEquals(disabled.enabled, false)

  busy = true
  calls = []
  const refused = await failure(() => run('agent', ['runtime', 'disable', 'exec-laptop', '--agent', JARVIS], calls, respond, { confirmed: true }))
  assertEquals([refused.code, refused.exitCode], ['SESSIONS_IN_PROGRESS', 6])
  assert(refused.message.includes('work-1') && !refused.message.includes('"}'), refused.message)

  const inUse = await failure(() =>
    run('agent', ['runtime', 'enable', 'exec-laptop', '--agent', HELPER], [], () => {
      throw new Error(`runtime_in_use: device \`Laptop\` is in use by Agent \`${JARVIS}\`: a device is used by one Agent at a time; switch it off there first`)
    })
  )
  assertEquals([inUse.code, inUse.details.in_use_by], ['RUNTIME_IN_USE', JARVIS])
  await assertRejects(() => run('agent', ['runtime', 'enable', '--agent', JARVIS], [], respond), 'MISSING_ARGUMENT')
})
