import { kRPCClient } from '../src/krpc_client'

function makeResponse(body: unknown, ok: boolean = true, status: number = 200) {
  return {
    ok,
    status,
    json: async () => body,
  }
}

describe('kRPCClient', () => {
  it('sends sys with the current token and updates token from response', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      result: { ok: true },
      sys: [123, 'next-token'],
    }))

    const client = new kRPCClient('/kapi/test/', 'init-token', 123, { fetcher: fetcher })
    const result = await client.call<{ ok: boolean }, { foo: string }>('test', { foo: 'bar' })

    expect(result).toEqual({ ok: true })
    expect(client.getSessionToken()).toBe('next-token')
    expect(JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      method: 'test',
      params: { foo: 'bar' },
      sys: [123, 'init-token'],
    })
  })

  it('omits sys token when no session token exists', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      result: { ok: true },
      sys: [5],
    }))

    const client = new kRPCClient('/kapi/test/', null, 5, { fetcher: fetcher })
    await client.call('test', {})

    expect(JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      method: 'test',
      params: {},
      sys: [5],
    })
  })

  it('uses per-call session token without mutating the managed token', async () => {
    const fetcher = jest.fn()
      .mockResolvedValueOnce(makeResponse({
        result: { ok: true },
        sys: [10, 'response-token'],
      }))
      .mockResolvedValueOnce(makeResponse({
        result: { ok: true },
        sys: [11],
      }))
    const sessionTokenProvider = jest.fn().mockReturnValue('provider-token')
    const onSessionTokenChanged = jest.fn()

    const client = new kRPCClient('/kapi/test/', 'init-token', 10, {
      fetcher: fetcher,
      sessionTokenProvider,
      onSessionTokenChanged,
    })

    await client.call('test', {}, { sessionToken: 'temporary-token' })

    expect(sessionTokenProvider).not.toHaveBeenCalled()
    expect(onSessionTokenChanged).not.toHaveBeenCalled()
    expect(client.getSessionToken()).toBe('init-token')
    expect(JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      method: 'test',
      params: {},
      sys: [10, 'temporary-token'],
    })

    await client.call('next', {})

    expect(sessionTokenProvider).toHaveBeenCalledTimes(1)
    expect(JSON.parse((fetcher.mock.calls[1][1] as RequestInit).body as string)).toEqual({
      method: 'next',
      params: {},
      sys: [11, 'provider-token'],
    })
  })

  it('supports callWithSessionToken as a per-call convenience wrapper', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      result: { ok: true },
      sys: [3],
    }))
    const sessionTokenProvider = jest.fn().mockReturnValue('provider-token')

    const client = new kRPCClient('/kapi/test/', null, 3, {
      fetcher: fetcher,
      sessionTokenProvider,
    })

    await client.callWithSessionToken('temporary-token', 'test', {})

    expect(sessionTokenProvider).not.toHaveBeenCalled()
    expect(JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      method: 'test',
      params: {},
      sys: [3, 'temporary-token'],
    })
  })

  it('keeps explicitly set session token ahead of provider until reset', async () => {
    const fetcher = jest.fn()
      .mockResolvedValueOnce(makeResponse({
        result: { ok: true },
        sys: [20, 'updated-override-token'],
      }))
      .mockResolvedValueOnce(makeResponse({
        result: { ok: true },
        sys: [21],
      }))
    const sessionTokenProvider = jest.fn().mockReturnValue('provider-token')
    const onSessionTokenChanged = jest.fn()

    const client = new kRPCClient('/kapi/test/', 'init-token', 20, {
      fetcher: fetcher,
      sessionTokenProvider,
      onSessionTokenChanged,
    })

    client.setSessionToken('override-token')
    await client.call('test', {})

    expect(sessionTokenProvider).not.toHaveBeenCalled()
    expect(onSessionTokenChanged).not.toHaveBeenCalled()
    expect(client.getSessionToken()).toBe('updated-override-token')
    expect(JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      method: 'test',
      params: {},
      sys: [20, 'override-token'],
    })

    client.resetSessionToken()
    await client.call('next', {})

    expect(sessionTokenProvider).toHaveBeenCalledTimes(1)
    expect(JSON.parse((fetcher.mock.calls[1][1] as RequestInit).body as string)).toEqual({
      method: 'next',
      params: {},
      sys: [21, 'provider-token'],
    })
  })

  it('allows per-call session token null to omit token even when provider exists', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      result: { ok: true },
      sys: [7],
    }))
    const sessionTokenProvider = jest.fn().mockReturnValue('provider-token')

    const client = new kRPCClient('/kapi/test/', 'init-token', 7, {
      fetcher: fetcher,
      sessionTokenProvider,
    })

    await client.call('test', {}, { sessionToken: null })

    expect(sessionTokenProvider).not.toHaveBeenCalled()
    expect(JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      method: 'test',
      params: {},
      sys: [7],
    })
  })

  it('throws on seq mismatch', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      result: { ok: true },
      sys: [999],
    }))

    const client = new kRPCClient('/kapi/test/', null, 1, { fetcher: fetcher })

    await expect(client.call('test', {})).rejects.toThrow('seq not match: 999!=1')
  })

  it('throws on malformed sys payload', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      result: { ok: true },
      sys: { seq: 1 },
    }))

    const client = new kRPCClient('/kapi/test/', null, 1, { fetcher: fetcher })

    await expect(client.call('test', {})).rejects.toThrow('sys is not array')
  })

  it('throws when response sys token is not a string', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      result: { ok: true },
      sys: [1, 123],
    }))

    const client = new kRPCClient('/kapi/test/', 'token', 1, { fetcher: fetcher })

    await expect(client.call('test', {})).rejects.toThrow('sys[1] is not string')
  })

  it('throws on non-200 http responses', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({}, false, 503))

    const client = new kRPCClient('/kapi/test/', null, 1, { fetcher: fetcher })

    await expect(client.call('test', {})).rejects.toThrow('RPC call error: 503')
  })

  it('throws on rpc error response', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      error: 'denied',
      sys: [1],
    }))

    const client = new kRPCClient('/kapi/test/', null, 1, { fetcher: fetcher })

    await expect(client.call('test', {})).rejects.toThrow('RPC call error: denied')
  })

  it('throws when result is missing', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      sys: [1],
    }))

    const client = new kRPCClient('/kapi/test/', null, 1, { fetcher: fetcher })

    await expect(client.call('test', {})).rejects.toThrow('RPC response missing result')
  })
})
