import { SystemConfigClient } from '../src/system_config_client'

describe('SystemConfigClient', () => {
  function createClient(call: jest.Mock) {
    const client = new SystemConfigClient('https://example.test/kapi/system_config', 'session-token')
    ;(client as unknown as { rpcClient: { call: jest.Mock } }).rpcClient = { call }
    return client
  }

  it('get returns server value/version, then hits cache with the same version', async () => {
    const call = jest.fn().mockResolvedValue({
      value: '{"enabled":true}',
      version: 42,
    })
    const client = createClient(call)

    const first = await client.get('services/demo/settings')
    const second = await client.get('services/demo/settings')

    expect(first.value).toBe('{"enabled":true}')
    expect(first.version).toBe(42)
    expect(first.is_changed).toBe(true)
    expect(second).toEqual({
      value: '{"enabled":true}',
      version: 42,
      is_changed: false,
    })
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('set invalidates cache for cacheable keys so the next get reloads revision', async () => {
    const call = jest
      .fn()
      .mockResolvedValueOnce({
        value: '{"enabled":true}',
        version: 3,
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        value: '{"enabled":false}',
        version: 4,
      })
    const client = createClient(call)

    await client.get('services/demo/settings')
    await client.set('services/demo/settings', '{"enabled":false}')
    const refreshed = await client.get('services/demo/settings')

    expect(refreshed).toEqual({
      value: '{"enabled":false}',
      version: 4,
      is_changed: true,
    })
    expect(call).toHaveBeenCalledTimes(3)
    expect(call).toHaveBeenNthCalledWith(2, 'sys_config_set', {
      key: 'services/demo/settings',
      value: '{"enabled":false}',
    })
  })

  it('setByJsonPath invalidates cache', async () => {
    const call = jest
      .fn()
      .mockResolvedValueOnce({
        value: '{"enabled":true}',
        version: 5,
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        value: '{"enabled":false}',
        version: 6,
      })
    const client = createClient(call)

    await client.get('services/demo/settings')
    await client.setByJsonPath('services/demo/settings', '$.enabled', 'false')
    const refreshed = await client.get('services/demo/settings')

    expect(refreshed.value).toBe('{"enabled":false}')
    expect(call).toHaveBeenNthCalledWith(2, 'sys_config_set_by_json_path', {
      key: 'services/demo/settings',
      json_path: '$.enabled',
      value: 'false',
    })
    expect(call).toHaveBeenCalledTimes(3)
  })

  it('delete and append invalidate cache', async () => {
    const call = jest
      .fn()
      .mockResolvedValueOnce({
        value: '["a"]',
        version: 11,
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        value: '["b"]',
        version: 12,
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        value: '["c"]',
        version: 13,
      })
    const client = createClient(call)

    await client.get('system/rbac/list')
    await client.delete('system/rbac/list')
    const afterDelete = await client.get('system/rbac/list')
    await client.append('system/rbac/list', '"c"')
    const afterAppend = await client.get('system/rbac/list')

    expect(afterDelete.value).toBe('["b"]')
    expect(afterAppend.value).toBe('["c"]')
    expect(call).toHaveBeenNthCalledWith(2, 'sys_config_delete', { key: 'system/rbac/list' })
    expect(call).toHaveBeenNthCalledWith(4, 'sys_config_append', {
      key: 'system/rbac/list',
      append_value: '"c"',
    })
  })

  it('list maps array results', async () => {
    const call = jest.fn().mockResolvedValue(['a', 'b'])
    const client = createClient(call)

    await expect(client.list('services/')).resolves.toEqual(['a', 'b'])
    expect(call).toHaveBeenCalledWith('sys_config_list', { key: 'services/' })
  })

  it('execTx clears touched cache keys only', async () => {
    const call = jest
      .fn()
      .mockResolvedValueOnce({
        value: '{"a":1}',
        version: 21,
      })
      .mockResolvedValueOnce({
        value: '{"b":2}',
        version: 22,
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        value: '{"a":3}',
        version: 23,
      })
    const client = createClient(call)

    await client.get('services/a')
    await client.get('services/b')
    await client.execTx({
      'services/a': { action: 'update', value: '{"a":3}' },
    }, ['services/a', 7])

    const refreshedA = await client.get('services/a')
    const cachedB = await client.get('services/b')

    expect(refreshedA.value).toBe('{"a":3}')
    expect(cachedB.value).toBe('{"b":2}')
    expect(call).toHaveBeenNthCalledWith(3, 'sys_config_exec_tx', {
      actions: {
        'services/a': { action: 'update', value: '{"a":3}' },
      },
      main_key: 'services/a:7',
    })
    expect(call).toHaveBeenCalledTimes(4)
  })

  it('create invalidates cache for later reads', async () => {
    const call = jest
      .fn()
      .mockResolvedValueOnce({
        value: '{"enabled":true}',
        version: 30,
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        value: '{"enabled":false}',
        version: 31,
      })
    const client = createClient(call)

    await client.get('services/demo/settings')
    await client.create('services/demo/settings', '{"enabled":false}')
    const refreshed = await client.get('services/demo/settings')

    expect(refreshed).toEqual({
      value: '{"enabled":false}',
      version: 31,
      is_changed: true,
    })
    expect(call).toHaveBeenNthCalledWith(2, 'sys_config_create', {
      key: 'services/demo/settings',
      value: '{"enabled":false}',
    })
  })

  it('refreshTrustKeys sends the expected rpc method', async () => {
    const call = jest.fn().mockResolvedValue(null)
    const client = createClient(call)

    await client.refreshTrustKeys()

    expect(call).toHaveBeenCalledWith('sys_refresh_trust_keys', {})
  })

  it('cache is scoped per client instance (mirror of Rust SystemConfigClient)', async () => {
    const callA = jest.fn().mockResolvedValue({ value: 'value-a', version: 1 })
    const callB = jest.fn().mockResolvedValue({ value: 'value-b', version: 7 })
    const clientA = createClient(callA)
    const clientB = createClient(callB)

    const firstA = await clientA.get('services/demo')
    const secondA = await clientA.get('services/demo')
    const firstB = await clientB.get('services/demo')

    expect(firstA.value).toBe('value-a')
    expect(secondA.value).toBe('value-a')
    expect(firstB.value).toBe('value-b')
    // clientA cached after the first call, second call should not fire RPC.
    expect(callA).toHaveBeenCalledTimes(1)
    // clientB has its own (empty) cache, so it must fire its own RPC.
    expect(callB).toHaveBeenCalledTimes(1)
  })

  it('set rejects empty key/value and keys containing colon', async () => {
    const call = jest.fn()
    const client = createClient(call)

    await expect(client.set('', 'x')).rejects.toThrow('key or value is empty')
    await expect(client.set('k', '')).rejects.toThrow('key or value is empty')
    await expect(client.set('a:b', 'x')).rejects.toThrow("key can not contain ':'")
    expect(call).not.toHaveBeenCalled()
  })

  it('non-cacheable keys never populate the cache', async () => {
    const call = jest
      .fn()
      .mockResolvedValueOnce({ value: 'v1', version: 1 })
      .mockResolvedValueOnce({ value: 'v2', version: 2 })
    const client = createClient(call)

    const first = await client.get('boot/config')
    const second = await client.get('boot/config')

    expect(first.value).toBe('v1')
    expect(second.value).toBe('v2')
    // Two calls because boot/config is not in CACHE_KEY_PREFIXES.
    expect(call).toHaveBeenCalledTimes(2)
  })

  it('get throws when the server reports a missing key (null result)', async () => {
    const call = jest.fn().mockResolvedValue(null)
    const client = createClient(call)

    await expect(client.get('services/missing')).rejects.toThrow('system_config key not found: services/missing')
  })

  it('syncSessionToken updates the underlying rpc client token', async () => {
    const client = new SystemConfigClient('https://example.test/kapi/system_config', 'old-token')
    expect(client.getSessionToken()).toBe('old-token')

    await client.syncSessionToken('new-token')

    expect(client.getSessionToken()).toBe('new-token')
  })

  it('dumpConfigsForScheduler forwards to the rpc method', async () => {
    const call = jest.fn().mockResolvedValue({ value: 'ok' })
    const client = createClient(call)

    await expect(client.dumpConfigsForScheduler()).resolves.toEqual({ value: 'ok' })
    expect(call).toHaveBeenCalledWith('dump_configs_for_scheduler', {})
  })
})
