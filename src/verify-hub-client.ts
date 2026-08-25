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

export interface AppAuthTarget {
  kind: 'app'
  app_instance_id: string
}

export interface SystemAuthTarget {
  kind: 'system'
  service_id: string
}

export type AuthTarget = AppAuthTarget | SystemAuthTarget

function serializeAuthTarget(target: AuthTarget): AuthTarget {
  if (!target || typeof target !== 'object') {
    throw new RPCError('verify-hub auth target is required')
  }
  if (target.kind === 'app' && typeof target.app_instance_id === 'string' && target.app_instance_id.length > 0) {
    return {
      kind: 'app',
      app_instance_id: target.app_instance_id,
    }
  }
  if (target.kind === 'system' && typeof target.service_id === 'string' && target.service_id.length > 0) {
    return {
      kind: 'system',
      service_id: target.service_id,
    }
  }
  throw new RPCError('invalid verify-hub auth target')
}

export function getAuthTargetAppId(target: AuthTarget): string {
  const normalized = serializeAuthTarget(target)
  if (normalized.kind === 'system') {
    return normalized.service_id
  }

  const separator = normalized.app_instance_id.lastIndexOf('@')
  if (separator <= 0 || separator === normalized.app_instance_id.length - 1) {
    throw new RPCError('app auth target must use `<appId>@<ownerUserId>`')
  }
  return normalized.app_instance_id.slice(0, separator)
}

export interface LoginByJwtParams {
  jwt: string
  target: AuthTarget
}

export interface LoginByPasswordParams {
  username: string
  password: string
  target: AuthTarget
  login_nonce?: number
  source_url?: string
}

export interface SudoByPasswordParams {
  username: string
  password: string
  target: AuthTarget
  aud?: string
  login_nonce?: number
}

export interface SudoByPasswordResponse {
  session_token: string
}

export interface VerifyTokenParams {
  session_token: string
  expected_target?: AuthTarget
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
    return this.rpcClient.call<TokenPair, LoginByJwtParams & { type: 'jwt' }>('login_by_jwt', {
      type: 'jwt',
      jwt: params.jwt,
      target: serializeAuthTarget(params.target),
    })
  }

  async loginByPassword(params: LoginByPasswordParams): Promise<LoginByPasswordResponse | LegacyLoginByPasswordResponse> {
    this.rpcClient.resetSessionToken()
    const payload: Record<string, unknown> = {
      type: 'password',
      username: params.username,
      password: params.password,
      target: serializeAuthTarget(params.target),
    }
    if (params.login_nonce !== undefined) {
      payload.login_nonce = params.login_nonce
    }
    if (params.source_url) {
      payload.source_url = params.source_url
    }
    return this.rpcClient.call<LoginByPasswordResponse | LegacyLoginByPasswordResponse, Record<string, unknown>>('login_by_password', payload)
  }

  async sudoByPassword(params: SudoByPasswordParams): Promise<SudoByPasswordResponse> {
    this.rpcClient.resetSessionToken()
    const payload: Record<string, unknown> = {
      username: params.username,
      password: params.password,
      target: serializeAuthTarget(params.target),
    }
    if (params.aud !== undefined) {
      payload.aud = params.aud
    }
    if (params.login_nonce !== undefined) {
      payload.login_nonce = params.login_nonce
    }
    return this.rpcClient.call<SudoByPasswordResponse, Record<string, unknown>>('sudo_by_password', payload)
  }

  async refreshToken(params: RefreshTokenParams): Promise<TokenPair> {
    return this.rpcClient.call<TokenPair, RefreshTokenParams>('refresh_token', {
      refresh_token: params.refresh_token,
    })
  }

  async verifyToken(params: VerifyTokenParams): Promise<boolean> {
    const payload: VerifyTokenParams = {
      session_token: params.session_token,
    }
    if (params.expected_target !== undefined) {
      payload.expected_target = serializeAuthTarget(params.expected_target)
    }
    return this.rpcClient.call<boolean, VerifyTokenParams>('verify_token', payload)
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
