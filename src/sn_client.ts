// sn_client: TypeScript mirror of cyfs-gateway-api SnClient (kRPC flavour).
// Wire contract: cyfs-gateway/doc/SN/SN-API.md, authoritative Rust client in
// cyfs-gateway/src/components/cyfs-gateway-api/src/sn_client.rs, server-side
// handlers in cyfs-gateway/src/components/cyfs-sn/src/api/*.rs.
//
// Hard constraints (must stay aligned with the Rust implementation):
// - kRPC JSON over HTTP POST. Unlike BNS there is no extra business envelope:
//   the kRPC `result` IS the payload (success payloads carry `code: 0`), and
//   SN business failures arrive as kRPC error strings tagged
//   `[SN:<code>:<name>] <detail>` (SN-API.md §1/§9), surfaced here as
//   SnClientError kind 'sn'.
// - Paths are a hard constraint (SN-API.md §2): `auth.*`/`user.*`/`domain.*`
//   only on /kapi/sn/auth, `device.*`/`deviceinfo.*` only on
//   /kapi/sn/deviceinfo, `bns.*` only on /kapi/sn/bns-proxy. The client keeps
//   one kRPC channel per path and rewrites any known SN base URL suffix to
//   the target path (mirrors Rust normalize_sn_url), so legacy /kapi/sn or
//   /kapi/sn/bns base URLs keep working.
// - bns-proxy request structs are deny_unknown_fields on the server; this
//   client only ever sends the whitelisted fields and validates the
//   mode/value/records combinations locally before submitting.
// - Rust u64/u32/usize are plain JSON numbers; unix timestamps are seconds.
//
// Deliberately not wrapped: internal management-plane methods that only exist
// on the SN internal root path `/` (`bns.publish_relay_assignment`,
// `bns.register_name_bootstrap`, `admin.clear_state_by_active_code`) and the
// legacy `GET /config` host-name probe (`get_real_sn_host_name`).

import { kRPCClient, KRPCClientOptions } from './krpc_client'
import { signJwtEdDSA } from './namelib'

export const SN_ROOT_PATH = '/kapi/sn'
export const SN_AUTH_PATH = '/kapi/sn/auth'
export const SN_DEVICEINFO_PATH = '/kapi/sn/deviceinfo'
export const SN_BNS_PROXY_PATH = '/kapi/sn/bns-proxy'
// Removed legacy mount; still recognized in base URLs and rewritten.
export const LEGACY_SN_BNS_PATH = '/kapi/sn/bns'

// Canonical namespaced kRPC method names (SN-API.md §1: bare legacy method
// names are no longer normalized by the server).
export const METHOD_AUTH_CHECK_USERNAME = 'auth.check_username'
export const METHOD_AUTH_CHECK_ACTIVE_CODE = 'auth.check_active_code'
export const METHOD_AUTH_REGISTER = 'auth.register'
export const METHOD_AUTH_LOGIN = 'auth.login'
export const METHOD_AUTH_REFRESH = 'auth.refresh'
export const METHOD_AUTH_LOGOUT = 'auth.logout'
export const METHOD_AUTH_ME = 'auth.me'
export const METHOD_USER_GET_PROFILE = 'user.get_profile'
export const METHOD_USER_SET_SELF_CERT = 'user.set_self_cert'
export const METHOD_USER_ADD_DNS_RECORD = 'user.add_dns_record'
export const METHOD_USER_REMOVE_DNS_RECORD = 'user.remove_dns_record'
export const METHOD_USER_LIST_DNS_RECORDS = 'user.list_dns_records'
export const METHOD_DOMAIN_BIND = 'domain.bind'
export const METHOD_DOMAIN_UNBIND = 'domain.unbind'
export const METHOD_DEVICE_REGISTER = 'device.register'
export const METHOD_DEVICE_UPDATE = 'device.update'
export const METHOD_DEVICE_GET = 'device.get'
export const METHOD_DEVICE_LIST = 'device.list'
export const METHOD_DEVICEINFO_RESOLVE_OOD_BY_DID = 'deviceinfo.resolve_ood_by_did'
export const METHOD_DEVICEINFO_RESOLVE_OOD_BY_HOSTNAME = 'deviceinfo.resolve_ood_by_hostname'
export const METHOD_BNS_PUBLISH_DNS_TXT = 'bns.publish_dns_txt'
export const METHOD_BNS_PUBLISH_DOCUMENT = 'bns.publish_document'

// ============================================================================
// Errors (SN-API.md §9, mirrors api/errors.rs SnApiErrorCode)
// ============================================================================

export const SN_ERROR_CODES = {
  invalid_params: 1000,
  invalid_username: 1001,
  username_already_exists: 1002,
  invalid_active_code: 1003,
  user_auth_not_found: 1004,
  invalid_password: 1005,
  auth_required: 1006,
  invalid_token: 1007,
  user_not_found: 1008,
  device_not_found: 1012,
  device_permission_denied: 1013,
  invalid_device_did: 1014,
  invalid_domain: 1015,
  domain_proof_failed: 1016,
  hostname_not_found: 1017,
  cross_user_access_denied: 1018,
  unsupported_password_algo: 1019,
  invalid_password_storage: 1020,
  user_not_activated: 1022,
  bns_permission_denied: 1023,
  bns_name_already_exists: 1024,
  bns_write_failed: 1025,
  bns_proxy_unavailable: 1026,
  bns_controller_unavailable: 1027,
  invalid_email: 1028,
  email_already_bound: 1029,
  internal_error: 1099,
} as const

export type SnErrorName = keyof typeof SN_ERROR_CODES

// `domain.bind` domain_proof_failed (1016) detail payload (SN-API.md §4.3).
// Configure the TXT record at `pkx_record_name` with `pkx`, then retry.
export interface SnDomainProofFailure {
  domain: string
  pkx_record_name: string
  pkx: string
  retryable: boolean
  reason: string
}

// bns_permission_denied / bns_name_already_exists / bns_write_failed detail
// payload (SN-API.md §9, mirrors api/errors.rs bns_write_error).
export interface SnBnsWriteFailure {
  bns_code: string
  expected: number | null
  actual: number | null
  message: string
}

// - sn: the server rejected the request with an `[SN:<code>:<name>]` tagged
//   business error; `code`/`codeName` are set from the tag.
// - transport: kRPC/HTTP failure without an SN tag, including UnknownMethod
//   (e.g. a method sent to the wrong SN path).
// - validation: local client-side rejection before anything was sent.
export type SnClientErrorKind = 'sn' | 'transport' | 'validation'

const SN_ERROR_TAG_RE = /\[SN:(\d+):([a-z_]+)\]\s*/

export class SnClientError extends Error {
  readonly kind: SnClientErrorKind
  // SN numeric business code, e.g. 1016 (kind === 'sn' only).
  readonly code: number | null
  // SN error name, e.g. 'domain_proof_failed' (kind === 'sn' only).
  readonly codeName: SnErrorName | string | null
  // Message with the [SN:code:name] tag and prefixes stripped for kind
  // 'sn', otherwise the raw underlying message.
  readonly detail: string

  constructor(
    kind: SnClientErrorKind,
    message: string,
    code: number | null = null,
    codeName: string | null = null,
    detail: string | null = null,
  ) {
    super(message)
    this.name = 'SnClientError'
    this.kind = kind
    this.code = code
    this.codeName = codeName
    this.detail = detail ?? message
  }

  isSnError(name: SnErrorName | string): boolean {
    return this.kind === 'sn' && this.codeName === name
  }

  // Parsed detail of a domain.bind domain_proof_failed (1016) error; null
  // for any other error or when the detail is not the documented JSON.
  domainProofInfo(): SnDomainProofFailure | null {
    if (!this.isSnError('domain_proof_failed')) {
      return null
    }
    return parseJsonObject<SnDomainProofFailure>(this.detail)
  }

  // Parsed detail of a BNS write error (1023/1024/1025); null otherwise.
  bnsWriteInfo(): SnBnsWriteFailure | null {
    if (
      !this.isSnError('bns_permission_denied') &&
      !this.isSnError('bns_name_already_exists') &&
      !this.isSnError('bns_write_failed')
    ) {
      return null
    }
    return parseJsonObject<SnBnsWriteFailure>(this.detail)
  }

  static fromRpcError(method: string, error: unknown): SnClientError {
    if (error instanceof SnClientError) {
      return error
    }
    const message = error instanceof Error ? error.message : String(error)
    const match = SN_ERROR_TAG_RE.exec(message)
    if (match) {
      const code = parseInt(match[1], 10)
      const codeName = match[2]
      const detail = message.slice(match.index + match[0].length)
      return new SnClientError(
        'sn',
        `${method} failed: [SN:${code}:${codeName}] ${detail}`,
        code,
        codeName,
        detail,
      )
    }
    return new SnClientError('transport', `${method} failed: ${message}`)
  }
}

function parseJsonObject<T>(text: string): T | null {
  try {
    const parsed = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as T) : null
  } catch {
    return null
  }
}

// ============================================================================
// URL normalization (mirrors sn_client.rs normalize_sn_url)
// ============================================================================

export type SnRpcTarget = 'auth' | 'deviceinfo' | 'bns-proxy'

const SN_TARGET_PATHS: Record<SnRpcTarget, string> = {
  auth: SN_AUTH_PATH,
  deviceinfo: SN_DEVICEINFO_PATH,
  'bns-proxy': SN_BNS_PROXY_PATH,
}

const KNOWN_SN_BASE_SUFFIXES = [
  SN_BNS_PROXY_PATH,
  SN_DEVICEINFO_PATH,
  SN_AUTH_PATH,
  LEGACY_SN_BNS_PATH,
  SN_ROOT_PATH,
]

// Rewrites any known SN mount suffix on `snUrl` to the target path, so the
// same base URL (bare host, /kapi/sn, or another target path) routes every
// method group to its required endpoint.
export function normalizeSnUrl(snUrl: string, target: SnRpcTarget): string {
  const path = SN_TARGET_PATHS[target]
  const trimmed = snUrl.replace(/\/+$/, '')
  for (const suffix of KNOWN_SN_BASE_SUFFIXES) {
    if (trimmed.endsWith(suffix)) {
      return `${trimmed.slice(0, trimmed.length - suffix.length)}${path}`
    }
  }
  return `${trimmed}${path}`
}

// ============================================================================
// Wire types — /kapi/sn/auth (SN-API.md §4)
// ============================================================================

export interface SnCheckUsernameResp {
  valid: boolean
  // 'ok' | 'invalid_username' | 'already_exists'
  reason: string
  message: string
  // Usernames are trimmed and lowercased server-side.
  normalized_name: string
}

export interface SnCheckActiveCodeResp {
  valid: boolean
}

// Initial documents published atomically with the BNS registerName during
// auth.register (SN-API.md §6.3). Single inline document limit is 4KB.
export interface SnBnsProxyInitialDocuments {
  zone?: Record<string, unknown>
  boot?: Record<string, unknown>
  dns_txt?: SnBnsDnsTxtRecord[]
}

export interface SnBnsDnsTxtRecord {
  ttl: number
  value: string
}

export interface SnAuthRegisterReq {
  name: string
  // Required SN-local account email. The server normalizes it and enforces
  // that each normalized address is bound to at most one account.
  email: string
  pwd_hash: string
  active_code: string
  // Idempotency key; server default is `sn:register:<username>`.
  request_id?: string
  // User owner EVM address (0x…). Required when the SN runs the production
  // multi-controller bns-proxy config; devtest single-controller deployments
  // fall back to the bound controller address.
  asset_owner?: string
  owner_config?: Record<string, unknown>
  initial_documents?: SnBnsProxyInitialDocuments
}

export interface SnAuthSessionResp {
  code: number
  access_token: string
  refresh_token: string
  need_bind_owner_key: boolean
  // Present only when the SN performed the BNS proxy registration.
  bns?: SnBnsProxyTxOutcome
}

export interface SnAuthRefreshResp {
  code: number
  access_token: string
}

// Generic `{ "code": 0 }` success payload.
export interface SnCodeResp {
  code: number
}

export interface SnUserProfileResp {
  code: number
  name: string
  owner_key_bound: boolean
  user_domain: string | null
  self_cert: boolean
  // JSON stored server-side (array of IPs) or null.
  sn_ips: unknown
  zone_config: string
}

export interface SnAddDnsRecordReq {
  // Must be a device owned by the current user.
  device_did: string
  // The user's bound user_domain (or subdomain), or the user's own
  // `<username>.web3.<server_host>` bridge domain (or subdomain).
  domain: string
  // Mainly 'A' | 'AAAA' | 'TXT'.
  record_type: string
  record: string
  // Seconds, server default 600.
  ttl?: number
  has_cert?: boolean
}

export interface SnAddDnsRecordResp {
  code: number
  device_name: string
}

export interface SnRemoveDnsRecordReq {
  device_did: string
  domain: string
  record_type: string
  has_cert?: boolean
}

export interface SnDnsRecordItem {
  domain: string
  record_type: string
  record: string
  ttl: number
}

export interface SnListDnsRecordsResp {
  code: number
  items: SnDnsRecordItem[]
}

export interface SnDomainBindResp {
  code: number
  domain: string
  pkx: string
  pkx_record_name: string
  pkx_source: string
  verified_at: number
}

// ============================================================================
// Wire types — /kapi/sn/deviceinfo (SN-API.md §5, mirrors sn_device_info.rs)
// ============================================================================

export type SnDeviceState = 'online' | 'offline' | 'stale' | 'blocked'

export type SnDeviceRole = 'gateway' | 'ood' | 'normal' | 'unknown'

export type SnNatType = 'public' | 'private' | 'symmetric' | 'unknown'

export type SnEndpointProtocol = 'tcp' | 'udp' | 'quic' | 'rtcp' | 'http' | 'https'

export type SnEndpointScope = 'public' | 'private' | 'relay' | 'loopback' | 'unknown'

export type SnEndpointSource = 'device_report' | 'from_ip' | 'relay_observed' | 'admin'

export type SnEndpointState = 'active' | 'stale' | 'failed' | 'disabled'

export interface SnDeviceEndpointUpdate {
  endpoint_id: string
  protocol: SnEndpointProtocol
  host: string
  port?: number | null
  scope: SnEndpointScope
  priority: number
  source: SnEndpointSource
  // Unix seconds.
  expires_at?: number | null
}

export interface SnDeviceEndpoint {
  did: string
  endpoint_id: string
  protocol: SnEndpointProtocol
  host: string
  port: number | null
  scope: SnEndpointScope
  priority: number
  source: SnEndpointSource
  state: SnEndpointState
  last_seen_at: number | null
  expires_at: number | null
  created_at: number
  updated_at: number
}

export interface SnDeviceStateView {
  did: string
  zone: string
  device_name: string
  device_role: SnDeviceRole
  state: SnDeviceState
  public_ips: string[]
  private_ips: string[]
  active_endpoints: SnDeviceEndpoint[]
  preferred_endpoint: SnDeviceEndpoint | null
  nat_type: SnNatType
  is_wan_device: boolean
  last_seen_at: number | null
  expires_at: number | null
}

export type SnDeviceStateResp = SnDeviceStateView & { code: number }

// device.register / device.update online-state report. Only reports runtime
// state — device identity documents are published via the BNS API, and a
// `mini_config_jwt` field is rejected by the server.
export interface SnDeviceOnlineReportReq {
  device_name: string
  // Required for device.register and for the first report of a device;
  // device.update may omit it once the device is known to the SN.
  device_did?: string
  device_ip: string
  device_info: Record<string, unknown> | string
  endpoints?: SnDeviceEndpointUpdate[]
  report_seq?: number
  // Seconds, server default 300.
  ttl?: number
}

export interface SnDeviceGetReq {
  device_name?: string
  device_did?: string
}

export interface SnDeviceListReq {
  state?: SnDeviceState
  offset?: number
  limit?: number
}

export interface SnDeviceListResp {
  code: number
  items: SnDeviceStateView[]
}

// Connection-decision state (SN-API.md §5.2): online devices resolve to
// 'active', offline/expired to 'suspended', blocked to 'banned'.
export type SnOodConnectionState = 'active' | 'suspended' | 'disabled' | 'banned'

export interface SnOodInfo {
  did_hostname: string
  owner_id: string
  self_cert: boolean
  state: SnOodConnectionState
}

// ============================================================================
// Wire types — /kapi/sn/bns-proxy (SN-API.md §6)
// ============================================================================

export type SnBnsDnsTxtMode = 'add' | 'remove' | 'replace'

export interface SnBnsPublishDnsTxtRecord {
  // Seconds, server default 600.
  ttl?: number
  value: string
}

// `add` requires `value` (`ttl` defaults to 600 server-side), `remove`
// requires `value`, `replace` requires `records`. Fields irrelevant to the
// mode are never sent (server structs are deny_unknown_fields).
export interface SnBnsPublishDnsTxtReq {
  // Must equal the token user.
  name: string
  mode: SnBnsDnsTxtMode
  // Idempotency key; the server generates a random one when omitted (each
  // call is then a new intent).
  request_id?: string
  ttl?: number
  value?: string
  records?: SnBnsPublishDnsTxtRecord[]
}

export interface SnBnsPublishDocumentReq {
  // Must equal the token user.
  name: string
  // `relay_assignment` is rejected; existing identity fields of `owner`
  // documents are protected server-side (SN-API.md §6.1).
  doc_type: string
  document: Record<string, unknown> | string
  request_id?: string
}

// TX delivery result shared by all bns-proxy writes and the `bns` field of
// auth.register (SN-API.md §6.2). `status` is always 'submitted' today: the
// SN only guarantees delivery, the final on-chain state is projected by
// bns-indexer with a read-side delay window.
export interface SnBnsProxyTxOutcome {
  request_id: string
  operation: string
  name: string
  controller_id: string
  controller_address: string
  // register_name_bootstrap only.
  asset_owner?: string
  // Document operations only.
  doc_type?: string
  // Target version computed before submit, not the confirmed on-chain state.
  document_version?: number
  chain_id?: number
  nonce?: number
  tx_hash?: string
  raw_tx?: string
  status: string
  // True when the same request_id was replayed and the previous TX returned.
  reused: boolean
}

export type SnBnsProxyTxResp = SnBnsProxyTxOutcome & { code: number }

// ============================================================================
// Device-signed SN credential (mirrors sn_client.rs generate_sn_device_token)
// ============================================================================

// `aud` claim of a device-signed SN access token. SN account tokens use aud
// `sn`; device tokens use a separate aud so neither verification path
// accepts the other's tokens.
export const SN_DEVICE_TOKEN_AUD = 'sn-device'
// Device reports are second-granular; a token only needs to cover a single
// call and the SN enforces a hard exp ceiling — do not issue long-lived ones.
export const SN_DEVICE_TOKEN_DEFAULT_TTL_SECS = 600

// Generates a device-level SN credential (EdDSA JWT signed with the device
// private key). Claims (validated by cyfs-sn sn_authority::require_sn_device):
// - `sub`: device key DID (`did:dev:<ed25519-x>`), public key embedded;
// - `iss`: the device's zone-scoped DID (e.g. `did:bns:ood1.alice`,
//   `did:web:ood1.charlie.me`) — the SN locates (zone, device_name) from it
//   and anchors the `sub` key against the zone-authoritative document,
//   rejecting the token when the key cannot be anchored;
// - `aud`: SN_DEVICE_TOKEN_AUD;
// - `exp`: unix seconds expiry.
export async function generateSnDeviceToken(
  deviceKeyDid: string,
  deviceScopedDid: string,
  devicePrivateKeyPem: string,
  ttlSecs: number = SN_DEVICE_TOKEN_DEFAULT_TTL_SECS,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return signJwtEdDSA(
    {
      aud: SN_DEVICE_TOKEN_AUD,
      exp: now + ttlSecs,
      iss: deviceScopedDid,
      sub: deviceKeyDid,
    },
    devicePrivateKeyPem,
  )
}

// ============================================================================
// Client
// ============================================================================

export class SnClient {
  private authRpc: kRPCClient
  private deviceInfoRpc: kRPCClient
  private bnsProxyRpc: kRPCClient

  // `snUrl` may be a bare host or any known SN mount (/kapi/sn,
  // /kapi/sn/auth, /kapi/sn/deviceinfo, /kapi/sn/bns-proxy, legacy
  // /kapi/sn/bns); every method group is routed to its required path.
  //
  // register()/login() do NOT implicitly adopt the returned access_token;
  // call syncSessionToken(resp.access_token) to authenticate later calls.
  // Device-token flows pass generateSnDeviceToken() output the same way.
  constructor(snUrl: string, sessionToken: string | null = null, options: KRPCClientOptions = {}) {
    this.authRpc = new kRPCClient(normalizeSnUrl(snUrl, 'auth'), sessionToken, null, options)
    this.deviceInfoRpc = new kRPCClient(normalizeSnUrl(snUrl, 'deviceinfo'), sessionToken, null, options)
    this.bnsProxyRpc = new kRPCClient(normalizeSnUrl(snUrl, 'bns-proxy'), sessionToken, null, options)
  }

  setSeq(seq: number) {
    this.authRpc.setSeq(seq)
    this.deviceInfoRpc.setSeq(seq)
    this.bnsProxyRpc.setSeq(seq)
  }

  syncSessionToken(token: string | null): void {
    this.authRpc.setSessionToken(token)
    this.deviceInfoRpc.setSessionToken(token)
    this.bnsProxyRpc.setSessionToken(token)
  }

  getSessionToken(): string | null {
    return this.authRpc.getSessionToken()
  }

  private async call<TResult>(channel: kRPCClient, method: string, params: unknown): Promise<TResult> {
    try {
      return await channel.call<TResult, unknown>(method, params)
    } catch (error) {
      throw SnClientError.fromRpcError(method, error)
    }
  }

  // ----- auth.* (no access token required except logout) -----

  async checkUsername(name: string): Promise<SnCheckUsernameResp> {
    return this.call(this.authRpc, METHOD_AUTH_CHECK_USERNAME, { name })
  }

  async checkActiveCode(activeCode: string): Promise<SnCheckActiveCodeResp> {
    return this.call(this.authRpc, METHOD_AUTH_CHECK_ACTIVE_CODE, { active_code: activeCode })
  }

  // When the SN has bns-proxy enabled this atomically registers the same-name
  // BNS name first (resp.bns carries the TX info, need_bind_owner_key=false);
  // a BNS write failure leaves no local account, so the same request_id can
  // be retried idempotently.
  async register(req: SnAuthRegisterReq): Promise<SnAuthSessionResp> {
    const params: Record<string, unknown> = {
      name: req.name,
      email: req.email,
      pwd_hash: req.pwd_hash,
      active_code: req.active_code,
    }
    if (req.request_id !== undefined) {
      params.request_id = req.request_id
    }
    if (req.asset_owner !== undefined) {
      params.asset_owner = req.asset_owner
    }
    if (req.owner_config !== undefined) {
      params.owner_config = req.owner_config
    }
    if (req.initial_documents !== undefined) {
      params.initial_documents = sanitizeInitialDocuments(req.initial_documents)
    }
    return this.call(this.authRpc, METHOD_AUTH_REGISTER, params)
  }

  async login(name: string, pwdHash: string): Promise<SnAuthSessionResp> {
    return this.call(this.authRpc, METHOD_AUTH_LOGIN, { name, pwd_hash: pwdHash })
  }

  async refresh(refreshToken: string): Promise<SnAuthRefreshResp> {
    return this.call(this.authRpc, METHOD_AUTH_REFRESH, { refresh_token: refreshToken })
  }

  // Revokes the current access token (when set on this client) and/or the
  // given refresh token.
  async logout(refreshToken?: string): Promise<SnCodeResp> {
    return this.call(this.authRpc, METHOD_AUTH_LOGOUT, { refresh_token: refreshToken ?? null })
  }

  async me(): Promise<SnUserProfileResp> {
    return this.call(this.authRpc, METHOD_AUTH_ME, {})
  }

  // ----- user.* (SN access token required) -----

  async getProfile(): Promise<SnUserProfileResp> {
    return this.call(this.authRpc, METHOD_USER_GET_PROFILE, {})
  }

  // Enabling self_cert requires the DID of an online device owned by the
  // current user; disabling does not.
  async setSelfCert(selfCert: boolean, deviceDid?: string): Promise<SnCodeResp> {
    return this.call(this.authRpc, METHOD_USER_SET_SELF_CERT, {
      self_cert: selfCert,
      device_did: deviceDid ?? null,
    })
  }

  // Local (compatibility-store) DNS records only — no BNS dns_txt publish, no
  // on-chain TX, no gas; suitable for short-lived ACME challenge TXT records.
  async addDnsRecord(req: SnAddDnsRecordReq): Promise<SnAddDnsRecordResp> {
    const params: Record<string, unknown> = {
      device_did: req.device_did,
      domain: req.domain,
      record_type: req.record_type,
      record: req.record,
    }
    if (req.ttl !== undefined) {
      params.ttl = req.ttl
    }
    if (req.has_cert !== undefined) {
      params.has_cert = req.has_cert
    }
    return this.call(this.authRpc, METHOD_USER_ADD_DNS_RECORD, params)
  }

  async removeDnsRecord(req: SnRemoveDnsRecordReq): Promise<SnCodeResp> {
    const params: Record<string, unknown> = {
      device_did: req.device_did,
      domain: req.domain,
      record_type: req.record_type,
    }
    if (req.has_cert !== undefined) {
      params.has_cert = req.has_cert
    }
    return this.call(this.authRpc, METHOD_USER_REMOVE_DNS_RECORD, params)
  }

  async listDnsRecords(): Promise<SnListDnsRecordsResp> {
    return this.call(this.authRpc, METHOD_USER_LIST_DNS_RECORDS, {})
  }

  // ----- domain.* (SN access token required) -----

  // One-stop user_domain bind: the SN resolves the expected PKX from the
  // user's `did:bns:<username>` owner document and queries external DNS TXT
  // itself. Until the TXT record is in place this rejects with the retryable
  // domain_proof_failed (1016) — read SnClientError.domainProofInfo() for the
  // record to configure, then call bindDomain again. Client-submitted TXT
  // proofs are ignored by the server.
  async bindDomain(domain: string): Promise<SnDomainBindResp> {
    return this.call(this.authRpc, METHOD_DOMAIN_BIND, { domain })
  }

  async unbindDomain(domain: string): Promise<SnCodeResp> {
    return this.call(this.authRpc, METHOD_DOMAIN_UNBIND, { domain })
  }

  // ----- device.* (SN access token or device token required) -----

  async registerDeviceOnline(req: SnDeviceOnlineReportReq): Promise<SnDeviceStateResp> {
    return this.call(this.deviceInfoRpc, METHOD_DEVICE_REGISTER, deviceReportParams(req))
  }

  async updateDeviceOnline(req: SnDeviceOnlineReportReq): Promise<SnDeviceStateResp> {
    return this.call(this.deviceInfoRpc, METHOD_DEVICE_UPDATE, deviceReportParams(req))
  }

  async getDeviceOnline(query: SnDeviceGetReq): Promise<SnDeviceStateResp> {
    return this.call(this.deviceInfoRpc, METHOD_DEVICE_GET, {
      device_name: query.device_name ?? null,
      device_did: query.device_did ?? null,
    })
  }

  async listDevicesOnline(options: SnDeviceListReq = {}): Promise<SnDeviceListResp> {
    const params: Record<string, unknown> = {}
    if (options.state !== undefined) {
      params.state = options.state
    }
    if (options.offset !== undefined) {
      params.offset = options.offset
    }
    if (options.limit !== undefined) {
      params.limit = options.limit
    }
    return this.call(this.deviceInfoRpc, METHOD_DEVICE_LIST, params)
  }

  // ----- deviceinfo.* (anonymous read-only) -----

  async resolveOodByDid(sourceDeviceId: string): Promise<SnOodInfo> {
    return this.call(this.deviceInfoRpc, METHOD_DEVICEINFO_RESOLVE_OOD_BY_DID, {
      source_device_id: sourceDeviceId,
    })
  }

  async resolveOodByHostname(destHost: string): Promise<SnOodInfo> {
    return this.call(this.deviceInfoRpc, METHOD_DEVICEINFO_RESOLVE_OOD_BY_HOSTNAME, {
      dest_host: destHost,
    })
  }

  // ----- bns.* (SN access token required; name must equal the token user) -----

  async publishDnsTxt(req: SnBnsPublishDnsTxtReq): Promise<SnBnsProxyTxResp> {
    const params: Record<string, unknown> = { name: req.name, mode: req.mode }
    if (req.request_id !== undefined) {
      params.request_id = req.request_id
    }
    switch (req.mode) {
      case 'add':
        if (!req.value) {
          throw new SnClientError('validation', 'publish_dns_txt mode=add requires value')
        }
        params.value = req.value
        if (req.ttl !== undefined) {
          params.ttl = req.ttl
        }
        break
      case 'remove':
        if (!req.value) {
          throw new SnClientError('validation', 'publish_dns_txt mode=remove requires value')
        }
        params.value = req.value
        break
      case 'replace':
        if (!req.records) {
          throw new SnClientError('validation', 'publish_dns_txt mode=replace requires records')
        }
        params.records = req.records.map(sanitizeDnsTxtRecord)
        break
      default:
        throw new SnClientError('validation', `publish_dns_txt mode \`${req.mode}\` is not supported`)
    }
    return this.call(this.bnsProxyRpc, METHOD_BNS_PUBLISH_DNS_TXT, params)
  }

  async publishDocument(req: SnBnsPublishDocumentReq): Promise<SnBnsProxyTxResp> {
    const isObject = req.document !== null && typeof req.document === 'object' && !Array.isArray(req.document)
    const jwtParts = typeof req.document === 'string' ? req.document.trim().split('.') : []
    const isJwt = jwtParts.length === 3 && jwtParts.every((part) => part.length > 0)
    if (!isObject && !isJwt) {
      throw new SnClientError(
        'validation',
        'publish_document document must be a JSON object or non-empty compact JWT string',
      )
    }
    if (req.doc_type.trim().toLowerCase() === 'owner' && !isObject) {
      throw new SnClientError('validation', 'owner document must be a JSON object')
    }
    const params: Record<string, unknown> = {
      name: req.name,
      doc_type: req.doc_type,
      document: req.document,
    }
    if (req.request_id !== undefined) {
      params.request_id = req.request_id
    }
    return this.call(this.bnsProxyRpc, METHOD_BNS_PUBLISH_DOCUMENT, params)
  }
}

// The server-side structs are deny_unknown_fields: keep only the whitelisted
// keys so stray caller properties can never poison the request.
function sanitizeInitialDocuments(docs: SnBnsProxyInitialDocuments): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (docs.zone !== undefined) {
    out.zone = docs.zone
  }
  if (docs.boot !== undefined) {
    out.boot = docs.boot
  }
  if (docs.dns_txt !== undefined) {
    out.dns_txt = docs.dns_txt.map((record) => ({ ttl: record.ttl, value: record.value }))
  }
  return out
}

function sanitizeDnsTxtRecord(record: SnBnsPublishDnsTxtRecord): Record<string, unknown> {
  return record.ttl !== undefined ? { ttl: record.ttl, value: record.value } : { value: record.value }
}

function deviceReportParams(req: SnDeviceOnlineReportReq): Record<string, unknown> {
  const params: Record<string, unknown> = {
    device_name: req.device_name,
    device_ip: req.device_ip,
    device_info: req.device_info,
  }
  if (req.device_did !== undefined) {
    params.device_did = req.device_did
  }
  if (req.endpoints !== undefined) {
    params.endpoints = req.endpoints
  }
  if (req.report_seq !== undefined) {
    params.report_seq = req.report_seq
  }
  if (req.ttl !== undefined) {
    params.ttl = req.ttl
  }
  return params
}
