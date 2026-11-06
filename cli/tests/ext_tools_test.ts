import './setup.ts'
import { ConfigStore } from '../core/config.ts'
import { createMockCommandContext } from '../core/context.ts'
import { CommandRegistry } from '../core/registry.ts'
import type { RpcCallOptions, ServiceClientRegistry } from '../core/runtime.ts'
import { createExtToolsModule } from '../modules/ext_tools.ts'
import { assertEquals, assertRejects, testConfig } from './test_helpers.ts'

interface RecordedCall { service: string; method: string; params: Record<string, unknown> }

function registry(): CommandRegistry {
  const registry = new CommandRegistry()
  registry.register(createExtToolsModule())
  return registry
}

function context(calls: RecordedCall[], verb: string) {
  const clients: ServiceClientRegistry = {
    call: <T>(service: string, method: string, params: Record<string, unknown>, _options?: RpcCallOptions): Promise<T> => {
      calls.push({ service, method, params })
      return Promise.resolve({ ok: true } as T)
    },
  } as unknown as ServiceClientRegistry
  return createMockCommandContext({
    command: registry().get('ext-tools', verb),
    config: testConfig(),
    configStore: new ConfigStore('/tmp/ext-tools-test'),
    clients,
  })
}

Deno.test('ext-tools: the verbs are registered with the access they need', () => {
  assertEquals(registry().commands().map((command) => command.verb), ['disable', 'enable', 'import', 'list', 'status'])
  for (const verb of ['list', 'status']) assertEquals(registry().get('ext-tools', verb).access, { mode: 'fixed', level: 'read' })
  for (const verb of ['enable', 'disable', 'import']) assertEquals(registry().get('ext-tools', verb).access, { mode: 'fixed', level: 'write' })
})

Deno.test('ext-tools: enable and disable ask control-panel for the desired state, dry-run for the plan', async () => {
  const calls: RecordedCall[] = []
  const run = (verb: string, input: Record<string, unknown>) => registry().get('ext-tools', verb).handler(context(calls, verb), input)
  await run('enable', { id: 'ext-core', version: '1.2.0' })
  await run('disable', { id: 'ext-core' })
  await run('enable', { id: 'ext-core', dry_run: true })
  await run('status', {})
  assertEquals(calls, [
    { service: 'control-panel', method: 'ext_tools.set_desired', params: { id: 'ext-core', enabled: true, version: '1.2.0' } },
    { service: 'control-panel', method: 'ext_tools.set_desired', params: { id: 'ext-core', enabled: false } },
    { service: 'control-panel', method: 'ext_tools.plan', params: { id: 'ext-core', enabled: true } },
    { service: 'control-panel', method: 'ext_tools.status', params: {} },
  ])
  await assertRejects(() => Promise.resolve(run('enable', {})))
})
