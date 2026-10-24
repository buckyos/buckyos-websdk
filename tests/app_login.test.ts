/** @jest-environment node */
import { kRPCClient } from '../src/krpc_client'
import {
  APP_LOGIN_EXCHANGE_METHOD,
  APP_LOGIN_ISSUE_METHOD,
  completeAppAccessTokenLogin,
  issueAppLoginCode,
  loginByAppAccessToken,
  parseAppLoginExchangeResult,
  randomAppLoginNonce,
} from '../src/app_login'

function response(body: unknown) {
  return { ok: true, status: 200, json: async () => body }
}

function clientWith(fetcher: jest.Mock, token?: string): kRPCClient {
  return new kRPCClient('/kapi/control-panel', token ?? null, 1, { fetcher })
}

async function sentBody(fetcher: jest.Mock): Promise<Record<string, unknown>> {
  const init = fetcher.mock.calls[0][1] as { body: string }
  return JSON.parse(init.body)
}

describe('App login', () => {
  it('issues a code with the App service session and keeps the response shape', async () => {
    const fetcher = jest.fn().mockResolvedValue(
      response({
        result: {
          user_id: 'crm-0123456789abcdef',
          code: 'ei-1.secret',
          expires_at: 1_000,
          new_account: true,
          invite: { invite_id: 'ei-1' },
        },
        sys: [1],
      }),
    )
    const issued = await issueAppLoginCode(clientWith(fetcher, 'app-service-token'), {
      external_account_id: 'crm:42',
      show_name: 'Alice',
      resource: { kind: 'group_session', group_did: 'did:web:support.zone', session_id: 't-42' },
      return_path: '/tickets/42',
    })
    expect(issued).toEqual({
      user_id: 'crm-0123456789abcdef',
      code: 'ei-1.secret',
      expires_at: 1_000,
      new_account: true,
      invite: { invite_id: 'ei-1' },
    })
    const body = await sentBody(fetcher)
    expect(body.method).toBe(APP_LOGIN_ISSUE_METHOD)
    expect(body.params).toMatchObject({
      external_account_id: 'crm:42',
      show_name: 'Alice',
      return_path: '/tickets/42',
    })
    expect(body.sys).toEqual([1, 'app-service-token'])
  })

  it('exchanges the code with a nonce and navigates on ready', async () => {
    const fetcher = jest.fn().mockResolvedValue(
      response({
        result: {
          status: 'ready',
          callback_url: 'https://crm.zone/sso_callback?nonce=7&redirect_url=https%3A%2F%2Fcrm.zone%2Ftickets%2F42',
          user_id: 'crm-0123456789abcdef',
        },
        sys: [1],
      }),
    )
    const navigate = jest.fn()
    const result = await completeAppAccessTokenLogin(
      { code: 'ei-1.secret', nonce: 'n-1', return_path: '/tickets/42', client: clientWith(fetcher) },
      navigate,
    )
    expect(result.status).toBe('ready')
    expect(navigate).toHaveBeenCalledWith(
      'https://crm.zone/sso_callback?nonce=7&redirect_url=https%3A%2F%2Fcrm.zone%2Ftickets%2F42',
    )
    const body = await sentBody(fetcher)
    expect(body.method).toBe(APP_LOGIN_EXCHANGE_METHOD)
    expect(body.params).toEqual({ code: 'ei-1.secret', nonce: 'n-1', return_path: '/tickets/42' })
  })

  it('returns structured denials and refuses malformed envelopes', async () => {
    const denied = jest.fn().mockResolvedValue(
      response({
        result: {
          status: 'denied',
          denial: { reason: 'credential_state', adjust: { party: 'self', location: 'credential' }, detail: 'consumed' },
        },
        sys: [1],
      }),
    )
    const result = await loginByAppAccessToken({ code: 'ei-1.secret', client: clientWith(denied) })
    expect(result).toEqual({
      status: 'denied',
      denial: { reason: 'credential_state', adjust: { party: 'self', location: 'credential' }, detail: 'consumed' },
    })
    const body = await sentBody(denied)
    expect(typeof (body.params as { nonce: unknown }).nonce).toBe('string')
    expect(parseAppLoginExchangeResult({ status: 'ready' })).toBeNull()
    expect(parseAppLoginExchangeResult({ status: 'denied', denial: { reason: 'bogus' } })).toBeNull()
    expect(parseAppLoginExchangeResult('ready')).toBeNull()
    expect(randomAppLoginNonce()).toMatch(/^[0-9a-f]{32}$/)
    expect(randomAppLoginNonce()).not.toBe(randomAppLoginNonce())
  })
})
