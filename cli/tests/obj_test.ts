import type { CommandContext } from '../core/context.ts'
import { assertEquals } from './test_helpers.ts'
import { createObjModule } from '../modules/obj.ts'

const resolve = createObjModule().commands.find((c) => c.verb === 'resolve')!

function ctx() {
  return { connection: { zone: 'test.buckyos.io', endpoint: 'https://test.buckyos.io/kapi/system_config', defaultProtocol: 'https://' } } as CommandContext
}

Deno.test('obj resolve names identity, rbac key and endpoint without an access check', async () => {
  const out = (await resolve.handler(ctx(), { url: 'obj://msg-center/owners/did:bns:alice/sessions/chat%201' })) as Record<string, unknown>
  assertEquals(out.canonical, 'obj://msg-center/owners/did:bns:alice/sessions/chat%201')
  assertEquals(out.rbac_resource_key, 'obj://msg-center/owners/did:bns:alice/sessions/chat%201')
  assertEquals(out.endpoint, 'https://test.buckyos.io/kapi/msg-center/obj/owners/did:bns:alice/sessions/chat%201')
  const dfs = (await resolve.handler(ctx(), { url: 'cyfs:///home/alice/a.md' })) as Record<string, unknown>
  assertEquals(dfs.rbac_resource_key, 'obj://dfs/home/alice/a.md')
  assertEquals(dfs.endpoint, 'https://test.buckyos.io/kapi/dfs/obj/home/alice/a.md')
  const short = (await resolve.handler(ctx(), { url: '//config/boot/config' })) as Record<string, unknown>
  assertEquals(short.canonical, 'obj://config/boot/config')
})

Deno.test('obj resolve without a session gives the gateway-relative endpoint', async () => {
  const local = { connection: { zone: 'local', endpoint: 'local://', defaultProtocol: 'https://' } } as any
  const out = (await resolve.handler(local, { url: 'obj://dfs/home/alice' })) as Record<string, unknown>
  assertEquals(out.endpoint, '/kapi/dfs/obj/home/alice')
})
