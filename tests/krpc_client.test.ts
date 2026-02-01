import { kRPCClient } from '../src/krpc_client'

describe('kRPCClient', () => {
  it('sends sys and updates token from response', async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: { ok: true },
        sys: [123, 'next-token'],
      }),
    })

    const client = new kRPCClient('/kapi/test/', 'init-token', 123, fetcher)
    const result = await client.call<{ ok: boolean }, { foo: string }>('test', { foo: 'bar' })

    expect(result).toEqual({ ok: true })
    expect(client.getSessionToken()).toBe('next-token')

    const requestBody = JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)
    expect(requestBody).toEqual({
      method: 'test',
      params: { foo: 'bar' },
      sys: [123, 'init-token'],
    })
  })

  it('throws on rpc error response', async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        error: 'denied',
        sys: [1],
      }),
    })

    const client = new kRPCClient('/kapi/test/', null, 1, fetcher)

    await expect(client.call<unknown, Record<string, unknown>>('test', {})).rejects.toThrow('RPC call error: denied')
  })
})
