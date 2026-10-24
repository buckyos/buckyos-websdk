// App 代登录 (buckyos notepads/self-host-group-extension-todo.md EXT-09, D-7).
// An App signs its own external customers in: the App backend, with its App
// service session, asks Control Panel for a one-time code (`issueAppLoginCode`);
// the App's page exchanges it (`loginByAppAccessToken`) and follows the returned
// callback URL, which sets the host-only cookies of the App's own origin.

import { kRPCClient } from './krpc_client'
import { parseAccessDenial, type AccessDenial } from './hybrid_sso'

export const APP_LOGIN_ISSUE_METHOD = 'user.app_login.issue'
export const APP_LOGIN_EXCHANGE_METHOD = 'auth.app_login.exchange'
export const APP_LOGIN_SETTINGS_GET_METHOD = 'apps.app_login.get'
export const APP_LOGIN_SETTINGS_SET_METHOD = 'apps.app_login.set'

export type AppLoginResource = {
  kind: 'group_session'
  group_did: string
  session_id: string
  title?: string
}

export interface IssueAppLoginCodeParams {
  /** The App's own identifier of the customer; only its digest is stored. */
  external_account_id: string
  /** Must be the account already bound to `external_account_id`; never another one. */
  user_id?: string
  /** Display name of a newly created account. */
  show_name?: string
  /** A group Session to invite the account into as a guest, as the App owner. */
  resource?: AppLoginResource
  /** Path on the App's origin the exchange returns to (default `/`). */
  return_path?: string
}

export interface IssuedAppLoginCode {
  user_id: string
  code: string
  expires_at: number
  new_account: boolean
  invite: Record<string, unknown>
}

export type AppLoginExchangeResult =
  | { status: 'ready'; callback_url: string; user_id: string }
  | { status: 'denied'; denial: AccessDenial }

export interface AppLoginSettings {
  enabled: boolean
  updated_by: string
  updated_at: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** App backend side: `client` is a control-panel kRPC client holding the App's service token. */
export async function issueAppLoginCode(
  client: kRPCClient,
  params: IssueAppLoginCodeParams,
): Promise<IssuedAppLoginCode> {
  const result = await client.call(APP_LOGIN_ISSUE_METHOD, { ...params })
  if (!isRecord(result) || typeof result.code !== 'string' || typeof result.user_id !== 'string') {
    throw new Error(`invalid ${APP_LOGIN_ISSUE_METHOD} response`)
  }
  return {
    user_id: result.user_id,
    code: result.code,
    expires_at: Number(result.expires_at ?? 0),
    new_account: result.new_account === true,
    invite: isRecord(result.invite) ? result.invite : {},
  }
}

export function parseAppLoginExchangeResult(value: unknown): AppLoginExchangeResult | null {
  if (!isRecord(value)) return null
  if (value.status === 'ready') {
    if (typeof value.callback_url !== 'string' || typeof value.user_id !== 'string') return null
    return { status: 'ready', callback_url: value.callback_url, user_id: value.user_id }
  }
  if (value.status === 'denied') {
    const denial = parseAccessDenial(value.denial)
    return denial ? { status: 'denied', denial } : null
  }
  return null
}

export function randomAppLoginNonce(): string {
  const bytes = new Uint8Array(16)
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export interface LoginByAppAccessTokenParams {
  code: string
  /** Reusing the nonce makes a retry idempotent; a new nonce for a used code is refused. */
  nonce?: string
  return_path?: string
  /** Control Panel kRPC URL; the gateway routes `/kapi/control-panel` from any App origin. */
  controlPanelUrl?: string
  client?: kRPCClient
}

/**
 * App page side: exchanges the code for a restricted session targeting the App
 * instance that issued it. On `ready` the page navigates to `callback_url`
 * (`completeAppAccessTokenLogin`), which sets the cookies and returns to `return_path`.
 */
export async function loginByAppAccessToken(
  params: LoginByAppAccessTokenParams,
): Promise<AppLoginExchangeResult> {
  const client = params.client ?? new kRPCClient(params.controlPanelUrl ?? '/kapi/control-panel')
  const request: Record<string, unknown> = {
    code: params.code,
    nonce: params.nonce ?? randomAppLoginNonce(),
  }
  if (params.return_path) request.return_path = params.return_path
  const result = parseAppLoginExchangeResult(await client.call(APP_LOGIN_EXCHANGE_METHOD, request))
  if (!result) throw new Error(`invalid ${APP_LOGIN_EXCHANGE_METHOD} response`)
  return result
}

export async function completeAppAccessTokenLogin(
  params: LoginByAppAccessTokenParams,
  navigate: (url: string) => void = (url) => {
    window.location.assign(url)
  },
): Promise<AppLoginExchangeResult> {
  const result = await loginByAppAccessToken(params)
  if (result.status === 'ready') navigate(result.callback_url)
  return result
}
