import './setup.ts'
import { createExecutorModule } from '../modules/executor.ts'
import { CommandRegistry } from '../core/registry.ts'
import { assertEquals } from './test_helpers.ts'

Deno.test('executor management and command stream commands are registered with explicit target fields', () => {
  const registry = new CommandRegistry()
  registry.register(createExecutorModule())
  assertEquals(registry.commands().map(command => command.verb), ['cancel', 'create', 'delete', 'edit', 'exec', 'issue', 'list', 'online', 'query', 'read', 'revoke', 'write'])
  assertEquals(registry.get('executor', 'exec').inputSchema.required, ['executor_id', 'generation', 'profile_id', 'store_id', 'locator', 'cmd', 'cwd'])
  assertEquals(registry.get('executor', 'query').access, { mode: 'fixed', level: 'read' })
  assertEquals(registry.get('executor', 'exec').access, { mode: 'fixed', level: 'write' })
})
