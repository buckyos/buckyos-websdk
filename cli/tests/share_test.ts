import './setup.ts'
import { ConfigStore } from '../core/config.ts'
import { createMockCommandContext } from '../core/context.ts'
import type { RegisteredCommand } from '../core/command.ts'
import type { ServiceClientRegistry } from '../core/runtime.ts'
import { createShareModule, parseExpires } from '../modules/share.ts'
import { assert, assertEquals, assertRejects, testConfig } from './test_helpers.ts'

const noClients: ServiceClientRegistry = { call: () => Promise.reject(new Error('no kRPC in share commands')) }

function command(verb: string): RegisteredCommand {
  const module = createShareModule()
  const definition = module.commands.find((item) => item.verb === verb)!
  return { ...definition, module: module.name, moduleSummary: module.summary }
}

function context(verb: string) {
  const config = testConfig()
  const ctx = createMockCommandContext({ command: command(verb), config, configStore: new ConfigStore(config.configDir), clients: noClients })
  return Object.assign(ctx, { session: { ensureValid: () => Promise.resolve({ token: 'tok' }) } }) as typeof ctx
}

function stubFetch(handler: (method: string, body: Record<string, unknown>) => unknown) {
  const calls: { method: string; body: Record<string, unknown>; auth: string | null }[] = []
  const original = globalThis.fetch
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = url.slice(url.indexOf('/nfs/v1/') + '/nfs/v1/'.length)
    const body = JSON.parse(String(init?.body ?? '{}'))
    calls.push({ method, body, auth: new Headers(init?.headers).get('authorization') })
    const result = method === 'hello' ? { session: 's1', features: ['share'] } : handler(method, body)
    const payload = result instanceof Error ? { ok: false, error: { code: 'STALE', reason: 'share_not_active', message: result.message } } : { ok: true, result }
    return Promise.resolve(new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } }))
  }) as typeof fetch
  return { calls, restore: () => (globalThis.fetch = original) }
}

Deno.test('share expiry parsing', () => {
  assertEquals(parseExpires(undefined), undefined)
  assertEquals(parseExpires('none'), null)
  const seven = parseExpires('7d') as number
  assert(Math.abs(seven - (Math.floor(Date.now() / 1000) + 7 * 86400)) <= 1)
  assertEquals(parseExpires('2999-01-01T00:00:00Z'), Date.parse('2999-01-01T00:00:00Z') / 1000)
})

Deno.test('share create posts a holder link policy over NFSP with the session token', async () => {
  const fake = stubFetch((method) => method === 'share.create' ? { operation_id: 'op_1', state: 'completed', share_id: 'sh_1', url: 'https://share.test.example.com/s/abc', share: { share_id: 'sh_1', status: 'active', revision: 1 } } : {})
  try {
    const out = await command('create').handler(context('create'), { path: '/home/alice/a.pdf', expires: 'none', title: 'A' }) as Record<string, unknown>
    assertEquals(out.url, 'https://share.test.example.com/s/abc')
    const create = fake.calls.find((call) => call.method === 'share.create')!
    assertEquals(create.auth, 'Bearer tok')
    assertEquals(create.body.session, 's1')
    assertEquals(create.body.seq, 1)
    const args = create.body.args as Record<string, unknown>
    assertEquals(args.source, { path: '/home/alice/a.pdf' })
    assertEquals(args.policy, { access: 'holder', allow_download: true, expires_at: null })
    assertEquals(args.source_hint, 'cli')
  } finally {
    fake.restore()
  }
})

Deno.test('share stop reads the revision first and maps business errors', async () => {
  const fake = stubFetch((method, body) => {
    if (method === 'share.get') return { share_id: 'sh_1', revision: 4 }
    if (method === 'share.stop') return (body.args as Record<string, unknown>).revision === 4 ? new Error('share is expired') : {}
    return {}
  })
  try {
    await assertRejects(() => command('stop').handler(context('stop'), { share_id: 'sh_1' }), 'SHARE_SHARE_NOT_ACTIVE')
  } finally {
    fake.restore()
  }
})
