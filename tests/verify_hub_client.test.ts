import { kRPCClient } from '../src/krpc_client'
import { VerifyHubClient } from '../src/verify-hub-client'

function makeResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  }
}

describe('VerifyHubClient', () => {
  it('loginByPassword sends Rust-compatible payload and resets inherited session token', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      result: { session_token: 'session', refresh_token: 'refresh' },
      sys: [7],
    }))

    const rpcClient = new kRPCClient('/kapi/verify-hub/', 'init-token', 7, fetcher)
    rpcClient.setSessionToken('stale-token')

    const client = new VerifyHubClient(rpcClient)
    await client.loginByPassword({
      username: 'devtest',
      password: 'hashed-password',
      appid: 'buckycli',
      source_url: 'https://buckycli.test.buckyos.io/',
    })

    expect(JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      method: 'login_by_password',
      params: {
        type: 'password',
        username: 'devtest',
        password: 'hashed-password',
        appid: 'buckycli',
        source_url: 'https://buckycli.test.buckyos.io/',
      },
      sys: [7, 'init-token'],
    })
  })

  it('loginByJwt sends type and extra params', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      result: { session_token: 'session', refresh_token: 'refresh' },
      sys: [11],
    }))

    const rpcClient = new kRPCClient('/kapi/verify-hub/', 'init-token', 11, fetcher)
    rpcClient.setSessionToken('stale-token')

    const client = new VerifyHubClient(rpcClient)
    await client.loginByJwt({ jwt: 'jwt-1', login_params: { extra: 'value' } })

    expect(JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      method: 'login_by_jwt',
      params: {
        type: 'jwt',
        jwt: 'jwt-1',
        extra: 'value',
      },
      sys: [11, 'init-token'],
    })
  })

  it('refreshToken and verifyToken send the expected rpc methods', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(makeResponse({
        result: { session_token: 'session-2', refresh_token: 'refresh-2' },
        sys: [21, 'session-2'],
      }))
      .mockResolvedValueOnce(makeResponse({
        result: true,
        sys: [22],
      }))

    const rpcClient = new kRPCClient('/kapi/verify-hub/', 'session-1', 21, fetcher)
    const client = new VerifyHubClient(rpcClient)

    const refreshed = await client.refreshToken({ refresh_token: 'refresh-1' })
    const verified = await client.verifyToken({ session_token: 'session-2', appid: 'buckycli' })

    expect(refreshed).toEqual({ session_token: 'session-2', refresh_token: 'refresh-2' })
    expect(verified).toBe(true)
    expect(JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      method: 'refresh_token',
      params: { refresh_token: 'refresh-1' },
      sys: [21, 'session-1'],
    })
    expect(JSON.parse((fetcher.mock.calls[1][1] as RequestInit).body as string)).toEqual({
      method: 'verify_token',
      params: { session_token: 'session-2', appid: 'buckycli' },
      sys: [22, 'session-2'],
    })
  })

  it('normalizeLoginResponse converts current response shape', () => {
    const normalized = VerifyHubClient.normalizeLoginResponse({
      user_info: {
        show_name: 'Alice',
        user_id: 'did:example:alice',
        user_type: 'admin',
      },
      session_token: 'session',
      refresh_token: 'refresh',
    })

    expect(normalized).toEqual({
      user_name: 'Alice',
      user_id: 'did:example:alice',
      user_type: 'admin',
      session_token: 'session',
      refresh_token: 'refresh',
    })
  })

  it('normalizeLoginResponse keeps legacy response shape and validates session token', () => {
    expect(VerifyHubClient.normalizeLoginResponse({
      user_name: 'Alice',
      user_id: 'did:example:alice',
      user_type: 'admin',
      session_token: 'session',
      refresh_token: 'refresh',
    })).toEqual({
      user_name: 'Alice',
      user_id: 'did:example:alice',
      user_type: 'admin',
      session_token: 'session',
      refresh_token: 'refresh',
    })

    expect(() => VerifyHubClient.normalizeLoginResponse({
      user_name: 'Alice',
      user_id: 'did:example:alice',
      user_type: 'admin',
    } as never)).toThrow('login_by_password response missing session_token')
  })
})
