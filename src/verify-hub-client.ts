import { kRPCClient, RPCError } from './krpc_client'

export interface TokenPair {
  session_token: string
  refresh_token: string
}

export interface VerifyHubUserInfo {
  show_name: string
  user_id: string
  user_type: string
  state?: string
}

export interface LoginByPasswordResponse {
  user_info: VerifyHubUserInfo
  session_token: string
  refresh_token: string
}

export interface LegacyLoginByPasswordResponse {
  user_name: string
  user_id: string
  user_type: string
  session_token: string
  refresh_token?: string
}

export interface LoginByJwtParams {
  jwt: string
  login_params?: Record<string, unknown>
}

export interface LoginByPasswordParams {
  username: string
  password: string
  appid: string
  source_url?: string
}

export interface VerifyTokenParams {
  session_token: string
  appid?: string
}

export interface RefreshTokenParams {
  refresh_token: string
}

export class VerifyHubClient {
  private rpcClient: kRPCClient

  constructor(rpcClient: kRPCClient) {
    this.rpcClient = rpcClient
  }

  setSeq(seq: number) {
    this.rpcClient.setSeq(seq)
  }

  async loginByJwt(params: LoginByJwtParams): Promise<TokenPair> {
    this.rpcClient.resetSessionToken()
    const payload: Record<string, unknown> = {
      type: 'jwt',
      jwt: params.jwt,
    }
    if (params.login_params) {
      Object.assign(payload, params.login_params)
    }
    return this.rpcClient.call<TokenPair, Record<string, unknown>>('login_by_jwt', payload)
  }

  async loginByPassword(params: LoginByPasswordParams): Promise<LoginByPasswordResponse | LegacyLoginByPasswordResponse> {
    this.rpcClient.resetSessionToken()
    const payload: Record<string, unknown> = {
      type: 'password',
      username: params.username,
      password: params.password,
      appid: params.appid,
    }
    if (params.source_url) {
      payload.source_url = params.source_url
    }
    return this.rpcClient.call<LoginByPasswordResponse | LegacyLoginByPasswordResponse, Record<string, unknown>>('login_by_password', payload)
  }

  async refreshToken(params: RefreshTokenParams): Promise<TokenPair> {
    return this.rpcClient.call<TokenPair, RefreshTokenParams>('refresh_token', params)
  }

  async verifyToken(params: VerifyTokenParams): Promise<boolean> {
    return this.rpcClient.call<boolean, VerifyTokenParams>('verify_token', params)
  }

  static normalizeLoginResponse(response: LoginByPasswordResponse | LegacyLoginByPasswordResponse): LegacyLoginByPasswordResponse {
    if ('user_info' in response) {
      return {
        user_name: response.user_info.show_name,
        user_id: response.user_info.user_id,
        user_type: response.user_info.user_type,
        session_token: response.session_token,
        refresh_token: response.refresh_token,
      }
    }

    if (!response.session_token) {
      throw new RPCError('login_by_password response missing session_token')
    }

    return response
  }
}

export type { KRPCResponse } from './krpc_client'
