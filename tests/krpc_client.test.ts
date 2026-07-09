import { kRPCClient } from '../src/krpc_client'

function makeResponse(body: unknown, ok: boolean = true, status: number = 200) {
  return {
    ok,
    status,
    json: async () => body,
  }
}

function requestBody(fetcher: jest.Mock, callIndex: number = 0) {
  return JSON.parse((fetcher.mock.calls[callIndex][1] as RequestInit).body as string)
}

describe('kRPCClient', () => {
  it('sends sys with the current token', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      result: { ok: true },
      sys: [123],
    }))

    const client = new kRPCClient('/kapi/test/', 'init-token', 123, { fetcher: fetcher })
    const result = await client.call<{ ok: boolean }, { foo: string }>('test', { foo: 'bar' })

    expect(result).toEqual({ ok: true })
    expect(requestBody(fetcher)).toEqual({
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

    expect(requestBody(fetcher)).toEqual({
      method: 'test',
      params: {},
      sys: [5],
    })
  })

  it('treats response sys[1] as a trace id, never as a session token update', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      result: { ok: true },
      sys: [123, 'trace-from-server'],
    }))
    const onSessionTokenChanged = jest.fn()

    const client = new kRPCClient('/kapi/test/', 'init-token', 123, { fetcher, onSessionTokenChanged })
    await client.call('test', {})

    expect(client.getSessionToken()).toBe('init-token')
    expect(onSessionTokenChanged).not.toHaveBeenCalled()
  })

  it('does not let a response trace id replace an explicitly set token', async () => {
    const fetcher = jest.fn()
      .mockResolvedValueOnce(makeResponse({
        result: { ok: true },
        sys: [20, 'trace-1'],
      }))
      .mockResolvedValueOnce(makeResponse({
        result: { ok: true },
        sys: [21],
      }))
    const sessionTokenProvider = jest.fn().mockReturnValue('provider-token')

    const client = new kRPCClient('/kapi/test/', 'init-token', 20, {
      fetcher: fetcher,
      sessionTokenProvider,
    })

    client.setSessionToken('override-token')
    await client.call('test', {})

    expect(sessionTokenProvider).not.toHaveBeenCalled()
    expect(client.getSessionToken()).toBe('override-token')
    expect(requestBody(fetcher, 0)).toEqual({
      method: 'test',
      params: {},
      sys: [20, 'override-token'],
    })

    client.resetSessionToken()
    await client.call('next', {})

    expect(sessionTokenProvider).toHaveBeenCalledTimes(1)
    expect(requestBody(fetcher, 1)).toEqual({
      method: 'next',
      params: {},
      sys: [21, 'provider-token'],
    })
  })

  it('uses per-call session token without mutating the managed token', async () => {
    const fetcher = jest.fn()
      .mockResolvedValueOnce(makeResponse({
        result: { ok: true },
        sys: [10, 'trace-1'],
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
    expect(requestBody(fetcher, 0)).toEqual({
      method: 'test',
      params: {},
      sys: [10, 'temporary-token'],
    })

    await client.call('next', {})

    expect(sessionTokenProvider).toHaveBeenCalledTimes(1)
    expect(requestBody(fetcher, 1)).toEqual({
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
    expect(requestBody(fetcher)).toEqual({
      method: 'test',
      params: {},
      sys: [3, 'temporary-token'],
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
    expect(requestBody(fetcher)).toEqual({
      method: 'test',
      params: {},
      sys: [7],
    })
  })

  it('sends [seq, null, trace_id] when a trace id is set without a token', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      result: { ok: true },
      sys: [40, 'tr1'],
    }))

    const client = new kRPCClient('/kapi/test/', null, 40, { fetcher: fetcher, traceId: 'tr1' })
    await client.call('test', {})

    expect(requestBody(fetcher)).toEqual({
      method: 'test',
      params: {},
      sys: [40, null, 'tr1'],
    })
  })

  it('sends [seq, token, trace_id] when both are set', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      result: { ok: true },
      sys: [41, 'tr1'],
    }))

    const client = new kRPCClient('/kapi/test/', 'init-token', 41, { fetcher: fetcher })
    client.setTraceId('tr1')
    expect(client.getTraceId()).toBe('tr1')

    await client.call('test', {})

    expect(requestBody(fetcher)).toEqual({
      method: 'test',
      params: {},
      sys: [41, 'init-token', 'tr1'],
    })
  })

  it('supports per-call trace id override and suppression', async () => {
    const fetcher = jest.fn()
      .mockResolvedValueOnce(makeResponse({ result: { ok: true }, sys: [50] }))
      .mockResolvedValueOnce(makeResponse({ result: { ok: true }, sys: [51] }))

    const client = new kRPCClient('/kapi/test/', 'init-token', 50, { fetcher: fetcher, traceId: 'client-trace' })

    await client.call('test', {}, { traceId: 'call-trace' })
    await client.call('next', {}, { traceId: null })

    expect(requestBody(fetcher, 0).sys).toEqual([50, 'init-token', 'call-trace'])
    expect(requestBody(fetcher, 1).sys).toEqual([51, 'init-token'])
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

  it('throws when response sys trace id is not a string', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      result: { ok: true },
      sys: [1, 123],
    }))

    const client = new kRPCClient('/kapi/test/', 'token', 1, { fetcher: fetcher })

    await expect(client.call('test', {})).rejects.toThrow('sys[1] trace_id is not string')
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
