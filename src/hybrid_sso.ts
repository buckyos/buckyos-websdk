// Hybrid SSO wire model (buckyos doc/arch/verify-hub/混合SSO技术契约.md),
// mirrored from buckyos-api `hybrid_sso.rs`. Shared fixtures live in
// buckyos/src/kernel/buckyos-api/tests/fixtures/hybrid_sso.

import { RPCError } from './krpc_client'
import type { ZoneUserType } from './runtime'

export type AuthMethod =
  | 'password'
  | 'exclusive_invite'
  | 'did_federation'
  | 'assertion'
  | 'app_access_token'
  | 'cross_zone_assertion'

export type SessionScope =
  | 'account_self'
  | 'msg_group'
  | 'aiworkspace'
  | 'homestation'
  | 'aicc'
  | 'msg_inbox'

export type DenyReason =
  | 'session_kind_not_allowed'
  | 'session_ceiling_exceeded'
  | 'resource_grant_missing'
  | 'entry_unavailable'
  | 'zone_method_disabled'
  | 'account_state'
  | 'credential_state'
  | 'source_revoked'
  | 'authorization_unavailable'

export const DENY_REASONS: readonly DenyReason[] = [
  'session_kind_not_allowed',
  'session_ceiling_exceeded',
  'resource_grant_missing',
  'entry_unavailable',
  'zone_method_disabled',
  'account_state',
  'credential_state',
  'source_revoked',
  'authorization_unavailable',
]

export type AdjustParty = 'product' | 'self' | 'sharer' | 'admin' | 'none'

export type AdjustLocation =
  | 'reauth'
  | 'credential'
  | 'share_panel'
  | 'cp:sso_settings'
  | 'cp:users'
  | 'cp:exclusive_invites'

export interface DenyAdjust {
  party: AdjustParty
  location?: AdjustLocation
}

/** A structured denial (D-4); never derived from error text. */
export interface AccessDenial {
  reason: DenyReason
  adjust: DenyAdjust
  service?: string
  method?: string
  /** Finer outcome a page branches on, e.g. `expired`, `password_required`. */
  detail?: string
}

export const ACCESS_DENIED_ERROR_CODE = 'access_denied'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** Validate a wire denial object; `null` when it is not one. */
export function parseAccessDenial(value: unknown): AccessDenial | null {
  if (!isRecord(value) || typeof value.reason !== 'string') return null
  if (!(DENY_REASONS as readonly string[]).includes(value.reason)) return null
  const adjust = isRecord(value.adjust) && typeof value.adjust.party === 'string'
    ? (value.adjust as unknown as DenyAdjust)
    : null
  if (!adjust) return null
  return value as unknown as AccessDenial
}

/** The denial a kRPC failure carries (`code == access_denied`), else `null`. */
export function accessDenialOf(error: unknown): AccessDenial | null {
  if (!(error instanceof RPCError) || error.code !== ACCESS_DENIED_ERROR_CODE) return null
  return parseAccessDenial(error.data)
}

export interface AccountIdentity {
  kind: 'account'
  user_id: string
  did: string
  user_type: ZoneUserType
  show_name: string
  zone_host: string
  auth_method?: AuthMethod
  restricted: boolean
  scopes?: SessionScope[]
  password_set: boolean
}

export interface ExternalIdentity {
  kind: 'external'
  did: string
  show_name: string
  zone_host: string
  auth_method?: AuthMethod
  restricted: boolean
  scopes?: SessionScope[]
}

export interface AnonymousIdentity {
  kind: 'anonymous'
}

/** Whom the browser session speaks for (contract §2.2). */
export type CurrentIdentity = AccountIdentity | ExternalIdentity | AnonymousIdentity

export const ANONYMOUS_IDENTITY: AnonymousIdentity = { kind: 'anonymous' }

export function parseCurrentIdentity(value: unknown): CurrentIdentity | null {
  if (!isRecord(value)) return null
  if (value.kind === 'anonymous') return ANONYMOUS_IDENTITY
  const str = (key: string) => (typeof value[key] === 'string' ? (value[key] as string) : null)
  if (value.kind === 'account') {
    const userId = str('user_id')
    const did = str('did')
    const userType = str('user_type')
    if (!userId || !did || !userType || typeof value.restricted !== 'boolean') return null
    return value as unknown as AccountIdentity
  }
  if (value.kind === 'external') {
    if (!str('did') || typeof value.restricted !== 'boolean') return null
    return value as unknown as ExternalIdentity
  }
  return null
}

/** Stable key of an identity within a Zone; changes whenever the subject does. */
export function identityKey(identity: CurrentIdentity): string {
  switch (identity.kind) {
    case 'account':
      return `${identity.zone_host}|account|${identity.user_id}`
    case 'external':
      return `${identity.zone_host}|external|${identity.did}`
    default:
      return 'anonymous'
  }
}

export function identityAllows(identity: CurrentIdentity, scope: SessionScope): boolean {
  if (identity.kind === 'anonymous') return false
  return !identity.restricted || (identity.scopes ?? []).includes(scope)
}

// ─── entries and Zone SSO configuration ─────────────────────────────────────

export type EntryMethod = 'guest' | 'password' | 'self_register' | 'did_login'
export type EntryService = 'aiworkspace' | 'msg-center'

export interface EntryMethods {
  guest: boolean
  password: boolean
  self_register: boolean
  did_login: boolean
}

export interface EntryRef {
  service: EntryService
  entry_id: string
}

export interface EntryResource {
  kind: string
  title: string
  owner_name?: string
  /** The resource page: an absolute URL when the resource lives on its own origin (an AI Workspace on
   * `aiws-<id>.<zone>`), else a Zone-relative path. */
  path: string
}

export interface EntryDescriptor {
  entry: EntryRef
  state: 'active' | 'unavailable'
  resource?: EntryResource
  methods: EntryMethods
  /** Methods the entry allows that the Zone switched off. */
  zone_disabled?: EntryMethod[]
  expires_at?: number
}

export interface SsoPublicConfig {
  self_register_enabled: boolean
  did_login_enabled: boolean
  jump_base_url: string
}

// ─── jump ─────────────────────────────────────────────────────────────────

export const DEFAULT_JUMP_BASE_URL = 'https://jump.buckyos.org'

/**
 * Registered jump actions and their path (same path on jump and on the target
 * Zone). Only actions a Zone page implements are registered; `saveas` joins
 * when its Zone-side dialog exists.
 */
export const JUMP_ACTION_PATHS: Readonly<Record<string, string>> = {
  app_installer: '/sysdlg/app_installer',
}

/**
 * A bare Zone hostname as a user may type it; `null` for anything carrying a
 * scheme, userinfo, port, path, query, fragment or an encoding trick.
 */
export function normalizeZoneHostname(input: string): string | null {
  const value = input.trim().toLowerCase().replace(/\.$/, '')
  if (!value || value.length > 253) return null
  if (/[^a-z0-9.-]/.test(value)) return null
  const labels = value.split('.')
  if (labels.length < 2) return null
  for (const label of labels) {
    if (!label || label.length > 63 || label.startsWith('-') || label.endsWith('-')) return null
  }
  return value
}

/** `https://<host><action path>` of a registered action, else `null`. */
export function zoneActionUrl(hostname: string, action: string): string | null {
  const host = normalizeZoneHostname(hostname)
  const path = JUMP_ACTION_PATHS[action]
  if (!host || !path) return null
  return `https://${host}${path}`
}

/**
 * The jump URL of a registered action. Parameters go in the fragment so they
 * never reach the jump server; the fragment is still visible to page scripts
 * and is not a place for credentials.
 */
export function buildJumpUrl(
  action: string,
  params: Record<string, string>,
  jumpBase: string = DEFAULT_JUMP_BASE_URL,
): string {
  const path = JUMP_ACTION_PATHS[action]
  if (!path) throw new Error(`unregistered jump action: ${action}`)
  const base = new URL(jumpBase || DEFAULT_JUMP_BASE_URL)
  if (base.protocol !== 'https:' && base.hostname !== 'localhost') {
    throw new Error('jump base must be https')
  }
  const fragment = new URLSearchParams(params).toString()
  return `${base.origin}${path}${fragment ? `#${fragment}` : ''}`
}
