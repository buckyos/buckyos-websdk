import { kRPCClient } from '../src/krpc_client'
import { VerifyHubClient } from '../src/verify-hub-client'

describe('VerifyHubClient', () => {
  it('loginByJwt sends type and extra params', async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: { session_token: 'session', refresh_token: 'refresh' },
        sys: [7],
      }),
    })

    const rpcClient = new kRPCClient('/kapi/verify-hub/', null, 7, fetcher)
    const client = new VerifyHubClient(rpcClient)

    await client.loginByJwt({ jwt: 'jwt-1', login_params: { extra: 'value' } })

    const requestBody = JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)
    expect(requestBody.method).toBe('login_by_jwt')
    expect(requestBody.params).toEqual({
      type: 'jwt',
      jwt: 'jwt-1',
      extra: 'value',
    })
  })

  it('normalizeLoginResponse converts user_info shape', () => {
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
})
