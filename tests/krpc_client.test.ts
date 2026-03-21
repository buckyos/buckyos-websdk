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

    const client = new kRPCClient('/kapi/test/', 'init-token', 123, fetcher)
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

    const client = new kRPCClient('/kapi/test/', null, 5, fetcher)
    await client.call('test', {})

    expect(JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      method: 'test',
      params: {},
      sys: [5],
    })
  })

  it('throws on seq mismatch', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      result: { ok: true },
      sys: [999],
    }))

    const client = new kRPCClient('/kapi/test/', null, 1, fetcher)

    await expect(client.call('test', {})).rejects.toThrow('seq not match: 999!=1')
  })

  it('throws on malformed sys payload', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      result: { ok: true },
      sys: { seq: 1 },
    }))

    const client = new kRPCClient('/kapi/test/', null, 1, fetcher)

    await expect(client.call('test', {})).rejects.toThrow('sys is not array')
  })

  it('throws when response sys token is not a string', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      result: { ok: true },
      sys: [1, 123],
    }))

    const client = new kRPCClient('/kapi/test/', 'token', 1, fetcher)

    await expect(client.call('test', {})).rejects.toThrow('sys[1] is not string')
  })

  it('throws on non-200 http responses', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({}, false, 503))

    const client = new kRPCClient('/kapi/test/', null, 1, fetcher)

    await expect(client.call('test', {})).rejects.toThrow('RPC call error: 503')
  })

  it('throws on rpc error response', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      error: 'denied',
      sys: [1],
    }))

    const client = new kRPCClient('/kapi/test/', null, 1, fetcher)

    await expect(client.call('test', {})).rejects.toThrow('RPC call error: denied')
  })

  it('throws when result is missing', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      sys: [1],
    }))

    const client = new kRPCClient('/kapi/test/', null, 1, fetcher)

    await expect(client.call('test', {})).rejects.toThrow('RPC response missing result')
  })
})
