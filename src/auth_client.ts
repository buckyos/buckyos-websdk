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
  private readonly navigate: (url: string) => void

  constructor(zoneBaseUrl: string, options: AuthClientOptions = {}) {
    ensureSSOEnvironment()

    this.zoneHostname = zoneBaseUrl
    this.navigate = options.navigate ?? ((url: string) => {
      window.location.assign(url)
    })
  }

  buildLoginURL(redirectUri: string | null = null): string {
    ensureSSOEnvironment()

    const redirectTarget = redirectUri ?? window.location.href
    const ssoURL = `${window.location.protocol}//sys.${this.zoneHostname}/login`
    return `${ssoURL}?redirect_url=${encodeURIComponent(redirectTarget)}`
  }

  async login(redirectUri: string | null = null): Promise<void> {
    const authURL = this.buildLoginURL(redirectUri)
    this.navigate(authURL)
  }
}
