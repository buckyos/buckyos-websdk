import type { ZoneUserType } from './runtime';
export type AuthMethod = 'password' | 'exclusive_invite' | 'did_federation' | 'assertion';
export type SessionScope = 'account_self' | 'msg_group' | 'aiworkspace' | 'homestation' | 'aicc';
export type DenyReason = 'session_kind_not_allowed' | 'session_ceiling_exceeded' | 'resource_grant_missing' | 'entry_unavailable' | 'zone_method_disabled' | 'account_state' | 'credential_state' | 'source_revoked' | 'authorization_unavailable';
export declare const DENY_REASONS: readonly DenyReason[];
export type AdjustParty = 'product' | 'self' | 'sharer' | 'admin' | 'none';
export type AdjustLocation = 'reauth' | 'credential' | 'share_panel' | 'cp:sso_settings' | 'cp:users' | 'cp:exclusive_invites';
export interface DenyAdjust {
    party: AdjustParty;
    location?: AdjustLocation;
}
/** A structured denial (D-4); never derived from error text. */
export interface AccessDenial {
    reason: DenyReason;
    adjust: DenyAdjust;
    service?: string;
    method?: string;
    /** Finer outcome a page branches on, e.g. `expired`, `password_required`. */
    detail?: string;
}
export declare const ACCESS_DENIED_ERROR_CODE = "access_denied";
/** Validate a wire denial object; `null` when it is not one. */
export declare function parseAccessDenial(value: unknown): AccessDenial | null;
/** The denial a kRPC failure carries (`code == access_denied`), else `null`. */
export declare function accessDenialOf(error: unknown): AccessDenial | null;
export interface AccountIdentity {
    kind: 'account';
    user_id: string;
    did: string;
    user_type: ZoneUserType;
    show_name: string;
    zone_host: string;
    auth_method?: AuthMethod;
    restricted: boolean;
    scopes?: SessionScope[];
    password_set: boolean;
}
export interface ExternalIdentity {
    kind: 'external';
    did: string;
    show_name: string;
    zone_host: string;
    auth_method?: AuthMethod;
    restricted: boolean;
    scopes?: SessionScope[];
}
export interface AnonymousIdentity {
    kind: 'anonymous';
}
/** Whom the browser session speaks for (contract §2.2). */
export type CurrentIdentity = AccountIdentity | ExternalIdentity | AnonymousIdentity;
export declare const ANONYMOUS_IDENTITY: AnonymousIdentity;
export declare function parseCurrentIdentity(value: unknown): CurrentIdentity | null;
/** Stable key of an identity within a Zone; changes whenever the subject does. */
export declare function identityKey(identity: CurrentIdentity): string;
export declare function identityAllows(identity: CurrentIdentity, scope: SessionScope): boolean;
export type EntryMethod = 'guest' | 'password' | 'self_register' | 'did_login';
export type EntryService = 'aiworkspace' | 'msg-center';
export interface EntryMethods {
    guest: boolean;
    password: boolean;
    self_register: boolean;
    did_login: boolean;
}
export interface EntryRef {
    service: EntryService;
    entry_id: string;
}
export interface EntryResource {
    kind: string;
    title: string;
    owner_name?: string;
    /** Zone-relative path of the resource page. */
    path: string;
}
export interface EntryDescriptor {
    entry: EntryRef;
    state: 'active' | 'unavailable';
    resource?: EntryResource;
    methods: EntryMethods;
    /** Methods the entry allows that the Zone switched off. */
    zone_disabled?: EntryMethod[];
    expires_at?: number;
}
export interface SsoPublicConfig {
    self_register_enabled: boolean;
    did_login_enabled: boolean;
    jump_base_url: string;
}
export declare const DEFAULT_JUMP_BASE_URL = "https://jump.buckyos.org";
/**
 * Registered jump actions and their path (same path on jump and on the target
 * Zone). Only actions a Zone page implements are registered; `saveas` joins
 * when its Zone-side dialog exists.
 */
export declare const JUMP_ACTION_PATHS: Readonly<Record<string, string>>;
/**
 * A bare Zone hostname as a user may type it; `null` for anything carrying a
 * scheme, userinfo, port, path, query, fragment or an encoding trick.
 */
export declare function normalizeZoneHostname(input: string): string | null;
/** `https://<host><action path>` of a registered action, else `null`. */
export declare function zoneActionUrl(hostname: string, action: string): string | null;
/**
 * The jump URL of a registered action. Parameters go in the fragment so they
 * never reach the jump server; the fragment is still visible to page scripts
 * and is not a place for credentials.
 */
export declare function buildJumpUrl(action: string, params: Record<string, string>, jumpBase?: string): string;
//# sourceMappingURL=hybrid_sso.d.ts.map