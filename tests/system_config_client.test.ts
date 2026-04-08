import { SystemConfigClient } from '../src/system_config_client'

describe('SystemConfigClient', () => {
  beforeEach(() => {
    ;((SystemConfigClient as unknown) as { configCache: Map<string, unknown> }).configCache.clear()
  })

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
})
