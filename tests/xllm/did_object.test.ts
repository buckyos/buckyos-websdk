import { DIDObjectClient, DIDObjectError } from '../../src/did_object_client'
import { didObjectResources, INDEX_TRAIT_URI } from '../../src/xllm/runtime/did_object_resources'
import { siteTools } from '../../src/xllm/runtime/site_tools'
import type { SiteToolCtx } from '../../src/xllm/runtime/types'

const ctx: SiteToolCtx = { run_id: 'r', call_id: 'c', signal: new AbortController().signal }

/** A provider like `KrpcObjectProvider` behind `/kapi/<svc>/obj/<path>`. */
function provider() {
  const seen: { method: string; url: string; body?: unknown; auth?: string }[] = []
  const agentProfile = {
    title: 'Agent', description: 'An agent of this Zone', 'x-buckyos:kind': 'agent', 'x-buckyos:summary_props': ['name'],
    properties: { name: { type: 'string', description: 'Display name' }, status: { type: 'string', description: 'Run state' } },
    actions: {
      describe: { description: 'Describe the agent', input: { type: 'object', properties: {} }, 'x-buckyos:risk': 'read_only' },
      restart: { description: 'Restart the agent', input: { type: 'object', properties: {} }, 'x-buckyos:risk': 'write' },
    },
    events: {},
  }
  const feedProfile = {
    title: 'Feed', description: 'Entries', 'x-buckyos:traits': [INDEX_TRAIT_URI],
    properties: { index_schema: { type: 'object', description: 'Columns of the index rows' } },
    actions: {
      query: { description: 'Entries of the feed', 'x-buckyos:risk': 'read_only', input: {} },
      page: { description: 'Next page of a query', 'x-buckyos:risk': 'read_only', input: {} },
    },
  }
  const fetch = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    const u = new URL(url)
    seen.push({ method: init.method, url: u.pathname + u.search, body: init.body ? JSON.parse(init.body) : undefined, auth: init.headers.authorization })
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status })
    if (u.pathname === '/kapi/opendan/obj/agents/jarvis' && u.searchParams.get('type') === 'profile') return json(agentProfile)
    if (u.pathname === '/kapi/opendan/obj/agents/jarvis') return json({ id: 'did:bns:jarvis', alsoKnownAs: ['obj://opendan/agents/jarvis', 'https://zone/agents/jarvis'] })
    if (u.pathname === '/kapi/opendan/obj/agents/jarvis/props/name') return json('Jarvis')
    if (u.pathname === '/kapi/opendan/obj/agents/jarvis/methods/describe') return json({ result: { model: 'llm.chat' } })
    if (u.pathname === '/kapi/homestation/obj/feed' && u.searchParams.get('type') === 'profile') return json(feedProfile)
    if (u.pathname === '/kapi/homestation/obj/feed/methods/query') return json({ result: { rows: [{ id: 'e1' }], next_cursor: 'c2' } })
    if (u.pathname === '/kapi/homestation/obj/feed/methods/page') return json({ result: { rows: [{ id: 'e2' }] } })
    return json({ code: 'not_found', message: `no object at ${u.pathname}` }, 404)
  }
  return { fetch: fetch as unknown as typeof globalThis.fetch, seen }
}

describe('DID Object client', () => {
  test('HTTP layout: card, profile, property, action; bearer token when given', async () => {
    const p = provider()
    const client = new DIDObjectClient({ origin: 'https://zone.example', fetch: p.fetch, sessionToken: () => 'tok' })
    expect(client.endpoint('obj://opendan/agents/jarvis')).toBe('https://zone.example/kapi/opendan/obj/agents/jarvis')
    expect((await client.card('obj://opendan/agents/jarvis')).id).toBe('did:bns:jarvis')
    expect(await client.readProperty('obj://opendan/agents/jarvis', 'name')).toBe('Jarvis')
    expect(await client.invoke('obj://opendan/agents/jarvis', 'describe', {})).toEqual({ model: 'llm.chat' })
    expect(p.seen[2].body).toEqual({ method: 'describe', params: {} })
    expect(p.seen.every(s => s.auth === 'Bearer tok')).toBe(true)
    await expect(client.profile('obj://opendan/agents/nobody')).rejects.toBeInstanceOf(DIDObjectError)
  })
})

describe('didObjectResources', () => {
  async function tools(maxRisk?: 'read_only' | 'write') {
    const p = provider()
    const client = new DIDObjectClient({ origin: 'https://zone.example', fetch: p.fetch })
    const resources = await didObjectResources({ client, roots: ['obj://opendan/agents/jarvis', 'obj://homestation/feed'], maxRisk })
    return { t: siteTools({ resources }), p }
  }
  const run = (t: Awaited<ReturnType<typeof tools>>['t'], name: string, args: Record<string, unknown>) =>
    Promise.resolve(t[name].call(args as never, ctx)) as Promise<string>

  test('read "/" lists the roots; actions above maxRisk are not exposed', async () => {
    const { t } = await tools()
    const listing = await run(t, 'read', { uri: '/' })
    expect(listing).toContain('- obj://opendan/agents/jarvis — Agent — An agent of this Zone [read]')
    expect(listing).toContain('action describe (risk: read_only)')
    expect(listing).not.toContain('restart')
    expect((await run((await tools('write')).t, 'read', { uri: '/' }))).toContain('action restart (risk: write)')
  })

  test('reading an object shows its document with the summary properties', async () => {
    const { t } = await tools()
    const doc = await run(t, 'read', { uri: 'obj://opendan/agents/jarvis' })
    expect(doc).toBe([
      'Object: obj://opendan/agents/jarvis', 'Object DID: did:bns:jarvis', 'Also known as: https://zone/agents/jarvis',
      'Title: Agent', 'Description: An agent of this Zone',
      'Properties:', '- name: Display name', '- status: Run state',
      'Actions:', '- describe: Describe the agent (risk: read_only)', '- restart: Restart the agent (risk: write)',
      'Summary:', '- name:', '"Jarvis"',
    ].join('\n'))
  })

  test('xcall on a root, and a collection read with a query', async () => {
    const { t, p } = await tools()
    expect(await run(t, 'exec', { command: 'xcall obj://opendan/agents/jarvis describe' })).toBe('[risk: read_only]\n{\n  "model": "llm.chat"\n}')
    await expect(run(t, 'exec', { command: 'xcall obj://opendan/agents/jarvis restart' })).rejects.toThrow('has no action `restart`')
    expect(await run(t, 'read', { uri: 'obj://homestation/feed?tag=x&page_size=5' })).toContain('"next_cursor": "c2"')
    expect(p.seen.find(s => s.url.endsWith('/methods/query'))?.body).toEqual({ method: 'query', params: { query: { tag: 'x' }, page_size: 5 } })
    expect(await run(t, 'read', { uri: 'obj://homestation/feed?cursor=c2' })).toContain('"e2"')
    await expect(run(t, 'read', { uri: 'obj://opendan/agents/other' })).rejects.toThrow('not a resource of this page')
  })
})
