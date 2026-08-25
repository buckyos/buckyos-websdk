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

    const rpcClient = new kRPCClient('/kapi/verify-hub/', 'init-token', 7, { fetcher: fetcher })
    rpcClient.setSessionToken('stale-token')

    const client = new VerifyHubClient(rpcClient)
    await client.loginByPassword({
      username: 'devtest',
      password: 'hashed-password',
      target: {
        kind: 'app',
        app_instance_id: 'buckycli@devtest',
      },
      login_nonce: 7,
      source_url: 'https://buckycli.test.buckyos.io/',
    })

    expect(JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      method: 'login_by_password',
      params: {
        type: 'password',
        username: 'devtest',
        password: 'hashed-password',
        target: {
          kind: 'app',
          app_instance_id: 'buckycli@devtest',
        },
        login_nonce: 7,
        source_url: 'https://buckycli.test.buckyos.io/',
      },
      sys: [7, 'init-token'],
    })
  })

  it('loginByJwt sends the required structured target', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      result: { session_token: 'session', refresh_token: 'refresh' },
      sys: [11],
    }))

    const rpcClient = new kRPCClient('/kapi/verify-hub/', 'init-token', 11, { fetcher: fetcher })
    rpcClient.setSessionToken('stale-token')

    const client = new VerifyHubClient(rpcClient)
    const targetWithUnknownField = {
      kind: 'system',
      service_id: 'kernel',
      unexpected: true,
    } as const
    await client.loginByJwt({
      jwt: 'jwt-1',
      target: targetWithUnknownField,
    })

    expect(JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      method: 'login_by_jwt',
      params: {
        type: 'jwt',
        jwt: 'jwt-1',
        target: {
          kind: 'system',
          service_id: 'kernel',
        },
      },
      sys: [11, 'init-token'],
    })
  })

  it('loginByJwt rejects a missing target before sending a request', async () => {
    const fetcher = jest.fn()
    const client = new VerifyHubClient(new kRPCClient('/kapi/verify-hub/', null, 12, { fetcher }))

    await expect(client.loginByJwt({ jwt: 'jwt-1' } as never)).rejects.toThrow(
      'verify-hub auth target is required',
    )
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('refreshToken and verifyToken send the expected rpc methods and target', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(makeResponse({
        result: { session_token: 'session-2', refresh_token: 'refresh-2' },
        sys: [21],
      }))
      .mockResolvedValueOnce(makeResponse({
        result: true,
        sys: [22],
      }))

    const rpcClient = new kRPCClient('/kapi/verify-hub/', 'session-1', 21, { fetcher: fetcher })
    const client = new VerifyHubClient(rpcClient)

    const refreshed = await client.refreshToken({ refresh_token: 'refresh-1' })
    // Beta2.2 responses never rotate the session token via sys; adopting the
    // refreshed token is the caller's job.
    rpcClient.setSessionToken(refreshed.session_token)
    const verified = await client.verifyToken({
      session_token: 'session-2',
      expected_target: {
        kind: 'app',
        app_instance_id: 'buckycli@devtest',
      },
    })

    expect(refreshed).toEqual({ session_token: 'session-2', refresh_token: 'refresh-2' })
    expect(verified).toBe(true)
    expect(JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      method: 'refresh_token',
      params: { refresh_token: 'refresh-1' },
      sys: [21, 'session-1'],
    })
    expect(JSON.parse((fetcher.mock.calls[1][1] as RequestInit).body as string)).toEqual({
      method: 'verify_token',
      params: {
        session_token: 'session-2',
        expected_target: {
          kind: 'app',
          app_instance_id: 'buckycli@devtest',
        },
      },
      sys: [22, 'session-2'],
    })
  })

  it('sudoByPassword sends the structured target and resets inherited session token', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      result: { session_token: 'sudo-session' },
      sys: [31],
    }))

    const rpcClient = new kRPCClient('/kapi/verify-hub/', 'init-token', 31, { fetcher })
    rpcClient.setSessionToken('stale-token')

    const client = new VerifyHubClient(rpcClient)
    const response = await client.sudoByPassword({
      username: 'devtest',
      password: 'hashed-password',
      target: {
        kind: 'system',
        service_id: 'control-panel',
      },
      aud: 'system-config',
      login_nonce: 123,
    })

    expect(response).toEqual({ session_token: 'sudo-session' })
    expect(JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      method: 'sudo_by_password',
      params: {
        username: 'devtest',
        password: 'hashed-password',
        target: {
          kind: 'system',
          service_id: 'control-panel',
        },
        aud: 'system-config',
        login_nonce: 123,
      },
      sys: [31, 'init-token'],
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
