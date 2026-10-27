import './setup.ts'
import { ConfigStore } from '../core/config.ts'
import { createMockCommandContext } from '../core/context.ts'
import type { RegisteredCommand } from '../core/command.ts'
import type { ServiceClientRegistry } from '../core/runtime.ts'
import { createBucketModule, parseBucketTarget } from '../modules/bucket.ts'
import { assertEquals, assertRejects, testConfig } from './test_helpers.ts'

function command(verb: string): RegisteredCommand {
  const module = createBucketModule()
  const definition = module.commands.find((item) => item.verb === verb)!
  return { ...definition, module: module.name, moduleSummary: module.summary }
}

function context(verb: string, clients: ServiceClientRegistry) {
  const config = testConfig()
  const ctx = createMockCommandContext({ command: command(verb), config, configStore: new ConfigStore(config.configDir), clients })
  return Object.assign(ctx, { session: { ensureValid: () => Promise.resolve({ token: 'tok' }) } }) as typeof ctx
}

Deno.test('bucket targets accept obj://bucket URLs and bare ids', () => {
  assertEquals(parseBucketTarget('obj://bucket/user/photos/alice/library/2026/a.jpg', true), { bucketId: 'user/photos/alice/library', key: '2026/a.jpg' })
  assertEquals(parseBucketTarget('zone/homestation/_/published', false), { bucketId: 'zone/homestation/_/published', key: '' })
})

Deno.test('bucket targets reject malformed ids and missing keys', async () => {
  await assertRejects(() => parseBucketTarget('user/photos/alice', false))
  await assertRejects(() => parseBucketTarget('team/photos/alice/x/k', true))
  await assertRejects(() => parseBucketTarget('user/photos/alice/library', true))
})

Deno.test('bucket ls and rm call bucket.* on nfs-server', async () => {
  const calls: { service: string; method: string; params: Record<string, unknown> }[] = []
  const clients: ServiceClientRegistry = {
    call: <T>(service: string, method: string, params: Record<string, unknown>) => {
      calls.push({ service, method, params })
      return Promise.resolve((method === 'bucket.list' ? [] : { items: [], common_prefixes: [] }) as T)
    },
  }
  await command('ls').handler(context('ls', clients), {})
  await command('ls').handler(context('ls', clients), { target: 'obj://bucket/user/photos/alice/library/2026/', delimiter: '/' })
  await command('rm').handler(context('rm', clients), { target: 'user/photos/alice/library/2026/a.jpg' })
  assertEquals(calls.map((c) => [c.service, c.method]), [
    ['nfs-server', 'bucket.list'],
    ['nfs-server', 'bucket.list_objects'],
    ['nfs-server', 'bucket.delete'],
  ])
  assertEquals(calls[1].params.prefix, '2026/')
  assertEquals(calls[2].params.key, '2026/a.jpg')
})

Deno.test('bucket service errors keep their code', async () => {
  const clients: ServiceClientRegistry = { call: () => Promise.reject(new Error('RPC call failed: permission_denied: permission denied: read on x')) }
  await assertRejects(() => command('rm').handler(context('rm', clients), { target: 'user/a/b/c/k' }), 'BUCKET_PERMISSION_DENIED')
})

Deno.test('pikg install config validates declared buckets (D17)', async () => {
  const { validateServiceConfigTips } = await import('../modules/pikg_protocol.ts')
  const ok = {
    storage_quota_mib: 2048,
    buckets: {
      library: { kind: 'data', data_policy: 'documents', versioning: true },
      index: { kind: 'data', data_policy: 'app_data', quota_mib: 512 },
      scratch: { kind: 'data', data_policy: 'temp', default_ttl_days: 7 },
    },
  }
  validateServiceConfigTips(ok, 'tips')
  await assertRejects(() => validateServiceConfigTips({ buckets: ok.buckets }, 'tips'))
  await assertRejects(() => validateServiceConfigTips({ buckets: { d: { kind: 'data', data_policy: 'documents', quota_mib: 1 } } }, 'tips'))
  await assertRejects(() => validateServiceConfigTips({ buckets: { t: { kind: 'data', data_policy: 'temp' } } }, 'tips'))
  await assertRejects(() => validateServiceConfigTips({ buckets: { c: { kind: 'blob', data_policy: 'cache' } } }, 'tips'))
  const defaults = validateServiceConfigTips({ buckets: { c: { kind: 'data', data_policy: 'cache', scope: 'user', lifecycle: [] }, z: { kind: 'data', data_policy: 'cache', scope: 'zone' } } }, 'tips')
  assertEquals(defaults.buckets, { c: { kind: 'data', data_policy: 'cache' }, z: { kind: 'data', data_policy: 'cache', scope: 'zone' } })
})
