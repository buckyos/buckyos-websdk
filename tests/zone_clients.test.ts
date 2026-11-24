import { createZoneClients } from '../src/zone_clients'

interface Call { url: string; method: string; params: Record<string, unknown>; token?: string }

function zone(zoneHost: string, results: Record<string, unknown>, token?: string) {
  const calls: Call[] = []
  const clients = createZoneClients({
    zoneHost, userId: 'alice', ownerDid: 'did:bns:alice',
    sessionTokenProvider: token ? () => token : undefined,
    fetcher: async (input, init) => {
      const body = JSON.parse(String(init?.body)) as { method: string; params: Record<string, unknown>; sys: [number, string?] }
      calls.push({ url: String(input), method: body.method, params: body.params, token: body.sys[1] })
      return new Response(JSON.stringify({ result: results[body.method], sys: [body.sys[0]] }))
    },
  })
  return { clients, calls }
}

describe('createZoneClients', () => {
  it('sends every call to its own Zone through the given fetcher', async () => {
    const home = zone('alice.example', { 'notify.list': { items: [] }, ping: 1 }, 'home-token')
    const org = zone('org.example:8443', { 'notify.list': { items: [] }, ping: 2 })
    await home.clients.msgCenter.notifyList()
    await org.clients.msgCenter.notifyList()
    expect(await home.clients.rpc('control-panel').call('ping', {})).toBe(1)
    expect(await org.clients.rpc('control-panel').call('ping', {})).toBe(2)
    expect(home.calls.map(c => [c.url, c.token])).toEqual([
      ['https://alice.example/kapi/msg-center', 'home-token'], ['https://alice.example/kapi/control-panel', 'home-token']])
    expect(org.calls.map(c => [c.url, c.token])).toEqual([
      ['https://org.example:8443/kapi/msg-center', undefined], ['https://org.example:8443/kapi/control-panel', undefined]])
  })

  it('keeps the session token out of verify-hub and reads the registry of a user', async () => {
    const registry = JSON.stringify({ schema_version: 1, handlers: {} })
    const { clients, calls } = zone('alice.example', {
      refresh_token: { session_token: 's', refresh_token: 'r' }, sys_config_get: { value: registry, version: 1 },
    }, 'token')
    await clients.verifyHub.refreshToken({ refresh_token: 'old' })
    await clients.contentRegistry('bob').refresh()
    await clients.contentRegistry().refresh()
    expect(calls[0]).toMatchObject({ url: 'https://alice.example/kapi/verify-hub', method: 'refresh_token', token: undefined })
    expect(calls.slice(1).map(c => [c.url, c.params.key])).toEqual([
      ['https://alice.example/kapi/system_config', 'system/content_registry'], ['https://alice.example/kapi/system_config', 'users/bob/content_defaults'],
      ['https://alice.example/kapi/system_config', 'system/content_registry'], ['https://alice.example/kapi/system_config', 'users/alice/content_defaults']])
    expect(() => createZoneClients({ zoneHost: 'x', fetcher: fetch }).contentRegistry()).toThrow('user id')
  })
})
