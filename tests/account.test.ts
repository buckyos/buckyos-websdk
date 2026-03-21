import {
  cleanLocalAccountInfo,
  getLocalAccountInfo,
  hashPassword,
  saveLocalAccountInfo,
} from '../src/account'

function makeJwt(payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>) => Buffer.from(JSON.stringify(value))
    .toString('base64url')
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.signature`
}

describe('account helpers', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.cookie = ''
  })

  it('hashPassword is stable for the same input and changes with nonce', () => {
    const first = hashPassword('devtest', 'bucky2025')
    const second = hashPassword('devtest', 'bucky2025')
    const withNonceA = hashPassword('devtest', 'bucky2025', 100)
    const withNonceB = hashPassword('devtest', 'bucky2025', 101)

    expect(first).toBe(second)
    expect(withNonceA).not.toBe(first)
    expect(withNonceA).not.toBe(withNonceB)
  })

  it('stores account info per app id', () => {
    const accountInfo = {
      user_name: 'devtest',
      user_id: 'devtest',
      user_type: 'user',
      session_token: 'session-a',
      refresh_token: 'refresh-a',
    }

    saveLocalAccountInfo('app-a', accountInfo)

    expect(getLocalAccountInfo('app-a')).toEqual(accountInfo)
    expect(getLocalAccountInfo('app-b')).toBeNull()
    expect(document.cookie).toContain('app-a_token=session-a')
  })

  it('migrates matching legacy account info into scoped storage', () => {
    const legacyAccountInfo = {
      user_name: 'devtest',
      user_id: 'devtest',
      user_type: 'user',
      session_token: makeJwt({ appid: 'app-a', sub: 'devtest' }),
      refresh_token: 'refresh-a',
    }

    window.localStorage.setItem('buckyos.account_info', JSON.stringify(legacyAccountInfo))

    expect(getLocalAccountInfo('app-a')).toEqual(legacyAccountInfo)
    expect(window.localStorage.getItem('buckyos.account_info.app-a')).toBe(JSON.stringify(legacyAccountInfo))
  })

  it('ignores legacy account info from another app id', () => {
    const legacyAccountInfo = {
      user_name: 'devtest',
      user_id: 'devtest',
      user_type: 'user',
      session_token: makeJwt({ appid: 'app-b', sub: 'devtest' }),
    }

    window.localStorage.setItem('buckyos.account_info', JSON.stringify(legacyAccountInfo))

    expect(getLocalAccountInfo('app-a')).toBeNull()
    expect(window.localStorage.getItem('buckyos.account_info.app-a')).toBeNull()
  })

  it('cleanLocalAccountInfo removes scoped and matching legacy storage', () => {
    const sessionToken = makeJwt({ appid: 'app-a', sub: 'devtest' })
    const accountInfo = {
      user_name: 'devtest',
      user_id: 'devtest',
      user_type: 'user',
      session_token: sessionToken,
    }

    saveLocalAccountInfo('app-a', accountInfo)
    window.localStorage.setItem('buckyos.account_info', JSON.stringify(accountInfo))

    cleanLocalAccountInfo('app-a')

    expect(getLocalAccountInfo('app-a')).toBeNull()
    expect(window.localStorage.getItem('buckyos.account_info')).toBeNull()
    expect(document.cookie).toContain('app-a_token=')
  })
})
