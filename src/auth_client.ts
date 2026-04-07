interface AuthClientOptions {
  navigate?: (url: string) => void
}

function ensureSSOEnvironment() {
  if (typeof window === 'undefined' || typeof window.location === 'undefined') {
    throw new Error('AuthClient can only be created in browser SSO environments')
  }
}

export class AuthClient {
  zoneHostname: string
  clientId: string
  private readonly navigate: (url: string) => void

  constructor(zoneBaseUrl: string, appId: string, options: AuthClientOptions = {}) {
    ensureSSOEnvironment()

    this.zoneHostname = zoneBaseUrl
    this.clientId = appId
    this.navigate = options.navigate ?? ((url: string) => {
      window.location.assign(url)
    })
  }

  buildLoginURL(redirectUri: string | null = null): string {
    ensureSSOEnvironment()

    const redirectTarget = redirectUri ?? window.location.href
    const ssoURL = `${window.location.protocol}//sys.${this.zoneHostname}/sso/login`
    return `${ssoURL}?client_id=${this.clientId}&redirect_uri=${encodeURIComponent(redirectTarget)}&response_type=token`
  }

  async login(redirectUri: string | null = null): Promise<void> {
    const authURL = this.buildLoginURL(redirectUri)
    this.navigate(authURL)
  }
}
