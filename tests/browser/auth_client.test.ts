import { AuthClient } from '../../src/auth_client'

describe('AuthClient in SSO browser environment', () => {
  it('builds the SSO login URL with the current page as default redirect target', () => {
    const authClient = new AuthClient('test.buckyos.io', 'demo-app', {
      navigate: jest.fn(),
    })

    expect(authClient.buildLoginURL()).toBe(
      'http://sys.test.buckyos.io/login?client_id=demo-app&redirect_uri=http%3A%2F%2Flocalhost%2F&response_type=token',
    )
  })

  it('login redirects the current window instead of opening a popup', async () => {
    const navigate = jest.fn()
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null)
    const authClient = new AuthClient('test.buckyos.io', 'demo-app', {
      navigate,
    })

    await expect(authClient.login('https://app.test/login/callback')).resolves.toBeUndefined()

    expect(navigate).toHaveBeenCalledWith(
      'http://sys.test.buckyos.io/login?client_id=demo-app&redirect_uri=https%3A%2F%2Fapp.test%2Flogin%2Fcallback&response_type=token',
    )
    expect(openSpy).not.toHaveBeenCalled()

    openSpy.mockRestore()
  })
})
