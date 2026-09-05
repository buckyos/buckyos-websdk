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
// - Paths are a hard constraint (SN-API.md §2):
//   `auth.*`/`user.*`/`zone.*`/`domain.*` only on /kapi/sn/auth,
//   `device.*`/`deviceinfo.*` only on
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
export const SN_REGION_PROBE_CONFIG_PATH = '/kapi/sn/region-probe-config.json'
export const SN_REGION_PROBE_SCHEMA_VERSION = 1
export const SN_REGION_PROBE_MAX_CONFIG_BYTES = 1024 * 1024
export const SN_REGION_PROBE_MAX_REGIONS = 64
export const SN_REGION_PROBE_MAX_URLS_PER_REGION = 16
export const SN_REGION_PROBE_MAX_TOTAL_URLS = 256
// Milliseconds, matching Rust's Duration::from_secs(5).
export const SN_REGION_PROBE_FETCH_TIMEOUT = 5_000

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
export const METHOD_ZONE_GET_INFO = 'zone.get_info'
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
export const METHOD_OWNER_REMOVE_BOUND_ZONE = 'owner.remove_bound_zone'

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
// Anonymous Region probe configuration
// ============================================================================

export type SnRegionProbeMethod = 'tcp_connect'
export type SnRegionProbeIpFamily = 'ipv4'

export interface SnRegionProbePolicy {
  probe_method: SnRegionProbeMethod
  samples_per_url: number
  connect_timeout_ms: number
  round_timeout_ms: number
  max_concurrency: number
  ip_family: SnRegionProbeIpFamily
  minimum_valid_urls: number
  confident_ratio: number
  cache_ttl_sec: number
}

export interface SnRegionProbeUrl {
  id: string
  url: string
  provider?: string
}

export interface SnRegionProbeRegion {
  region_id: string
  priority: number
  probe_urls: SnRegionProbeUrl[]
}

export interface SnRegionProbeConfig {
  schema_version: number
  config_version: string
  // RFC 3339 timestamps, matching chrono::DateTime<Utc>'s JSON format.
  generated_at: string
  expires_at: string
  policy: SnRegionProbePolicy
  regions: SnRegionProbeRegion[]
}

export interface SnRegionProbeConfigDocument {
  config: SnRegionProbeConfig
  etag: string | null
  cache_control: string | null
}

export type SnRegionProbeConfigFetch =
  | { kind: 'modified'; document: SnRegionProbeConfigDocument }
  | { kind: 'not_modified' }
  | { kind: 'not_configured' }

type SnRegionProbeFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface SnRegionProbeFetchOptions {
  // Primarily useful for runtimes that supply their own fetch implementation
  // and for deterministic tests. The timeout and response-size limits remain
  // fixed by the protocol contract.
  fetcher?: SnRegionProbeFetcher
}

const SN_REGION_PROBE_KNOWN_SUFFIXES = [
  SN_REGION_PROBE_CONFIG_PATH,
  SN_BNS_PROXY_PATH,
  SN_DEVICEINFO_PATH,
  SN_AUTH_PATH,
  LEGACY_SN_BNS_PATH,
  SN_ROOT_PATH,
]

const RFC3339_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
const CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f-\u009f]/u

function regionProbeValidationError(message: string): never {
  throw new SnClientError('validation', message)
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    regionProbeValidationError(`${field} must be a JSON object`)
  }
  return value as Record<string, unknown>
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    regionProbeValidationError(`${field} must be a string`)
  }
  return value
}

function asNumber(value: unknown, field: string): number {
  if (typeof value !== 'number') {
    regionProbeValidationError(`${field} must be a number`)
  }
  return value
}

function asInteger(value: unknown, field: string): number {
  const number = asNumber(value, field)
  if (!Number.isSafeInteger(number)) {
    regionProbeValidationError(`${field} must be a safe integer`)
  }
  return number
}

function asInt32(value: unknown, field: string): number {
  const number = asInteger(value, field)
  if (number < -2_147_483_648 || number > 2_147_483_647) {
    regionProbeValidationError(`${field} must fit in a signed 32-bit integer`)
  }
  return number
}

function asArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    regionProbeValidationError(`${field} must be an array`)
  }
  return value
}

function decodeSnRegionProbeConfig(value: unknown): SnRegionProbeConfig {
  const input = asRecord(value, 'region probe config')
  const policyInput = asRecord(input.policy, 'policy')
  const policy: SnRegionProbePolicy = {
    probe_method: asString(policyInput.probe_method, 'policy.probe_method') as SnRegionProbeMethod,
    samples_per_url: asInteger(policyInput.samples_per_url, 'policy.samples_per_url'),
    connect_timeout_ms: asInteger(policyInput.connect_timeout_ms, 'policy.connect_timeout_ms'),
    round_timeout_ms: asInteger(policyInput.round_timeout_ms, 'policy.round_timeout_ms'),
    max_concurrency: asInteger(policyInput.max_concurrency, 'policy.max_concurrency'),
    ip_family: asString(policyInput.ip_family, 'policy.ip_family') as SnRegionProbeIpFamily,
    minimum_valid_urls: asInteger(policyInput.minimum_valid_urls, 'policy.minimum_valid_urls'),
    confident_ratio: asNumber(policyInput.confident_ratio, 'policy.confident_ratio'),
    cache_ttl_sec: asInteger(policyInput.cache_ttl_sec, 'policy.cache_ttl_sec'),
  }

  const regions = asArray(input.regions, 'regions').map((regionValue, regionIndex): SnRegionProbeRegion => {
    const region = asRecord(regionValue, `regions[${regionIndex}]`)
    const probes = asArray(region.probe_urls, `regions[${regionIndex}].probe_urls`).map(
      (probeValue, probeIndex): SnRegionProbeUrl => {
        const probe = asRecord(probeValue, `regions[${regionIndex}].probe_urls[${probeIndex}]`)
        const decoded: SnRegionProbeUrl = {
          id: asString(probe.id, `regions[${regionIndex}].probe_urls[${probeIndex}].id`),
          url: asString(probe.url, `regions[${regionIndex}].probe_urls[${probeIndex}].url`),
        }
        if (probe.provider !== undefined && probe.provider !== null) {
          decoded.provider = asString(
            probe.provider,
            `regions[${regionIndex}].probe_urls[${probeIndex}].provider`,
          )
        }
        return decoded
      },
    )
    return {
      region_id: asString(region.region_id, `regions[${regionIndex}].region_id`),
      priority: region.priority === undefined ? 0 : asInt32(region.priority, `regions[${regionIndex}].priority`),
      probe_urls: probes,
    }
  })

  return {
    schema_version: asInteger(input.schema_version, 'schema_version'),
    config_version: asString(input.config_version, 'config_version'),
    generated_at: asString(input.generated_at, 'generated_at'),
    expires_at: asString(input.expires_at, 'expires_at'),
    policy,
    regions,
  }
}

export function isCanonicalSnRegionId(value: string): boolean {
  return byteLength(value) <= 128 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
}

// Normalizes an untrusted registration hint to the relay configuration's
// canonical ID. Invalid non-ASCII/symbol input returns null.
export function normalizeSnRegionIdHint(value: string): string | null {
  const trimmed = value.trim()
  if (byteLength(trimmed) === 0 || byteLength(trimmed) > 128) {
    return null
  }

  let normalized = ''
  let separatorPending = false
  for (const character of trimmed) {
    if (/^[A-Za-z0-9]$/.test(character)) {
      if (separatorPending && normalized.length > 0) {
        normalized += '-'
      }
      separatorPending = false
      normalized += character.toLowerCase()
    } else if (character === '-' || character === '_' || character === '/' || character === '.' || /^\s$/u.test(character)) {
      separatorPending = normalized.length > 0
    } else {
      return null
    }
  }
  return normalized.length > 0 ? normalized : null
}

function parseIpv4Address(value: string): [number, number, number, number] | null {
  const parts = value.split('.')
  if (parts.length !== 4) {
    return null
  }
  const octets = parts.map((part) => Number(part))
  if (octets.some((octet, index) => !/^\d+$/.test(parts[index]) || !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return null
  }
  return octets as [number, number, number, number]
}

// Schema v1 only permits public IPv4 probe destinations. Callers resolving a
// hostname should apply this check to every address before connecting.
export function isPublicSnProbeIp(value: string): boolean {
  const octets = parseIpv4Address(value)
  if (!octets) {
    return false
  }
  const [a, b, c] = octets
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  )
}

function parseRfc3339(value: string, field: string): number {
  const timestamp = Date.parse(value)
  if (!RFC3339_RE.test(value) || !Number.isFinite(timestamp)) {
    regionProbeValidationError(`${field} must be an RFC 3339 timestamp`)
  }
  return timestamp
}

export function validateSnRegionProbeConfig(
  config: SnRegionProbeConfig,
  now: Date | number | string = Date.now(),
): void {
  if (config.schema_version !== SN_REGION_PROBE_SCHEMA_VERSION) {
    regionProbeValidationError(
      `unsupported schema_version ${config.schema_version}, expected ${SN_REGION_PROBE_SCHEMA_VERSION}`,
    )
  }
  if (
    config.config_version.length === 0 ||
    byteLength(config.config_version) > 128 ||
    config.config_version.trim() !== config.config_version ||
    CONTROL_CHARACTER_RE.test(config.config_version)
  ) {
    regionProbeValidationError(
      'config_version must be 1..=128 non-control bytes without surrounding whitespace',
    )
  }

  const generatedAt = parseRfc3339(config.generated_at, 'generated_at')
  const expiresAt = parseRfc3339(config.expires_at, 'expires_at')
  const nowTimestamp = now instanceof Date ? now.getTime() : typeof now === 'number' ? now : Date.parse(now)
  if (!Number.isFinite(nowTimestamp)) {
    regionProbeValidationError('validation time is invalid')
  }
  if (generatedAt >= expiresAt) {
    regionProbeValidationError('expires_at must be later than generated_at')
  }
  if (expiresAt <= nowTimestamp) {
    regionProbeValidationError('region probe config is expired')
  }

  const policy = config.policy
  if (policy.probe_method !== 'tcp_connect') {
    regionProbeValidationError(`unsupported probe_method ${JSON.stringify(policy.probe_method)}`)
  }
  if (policy.ip_family !== 'ipv4') {
    regionProbeValidationError(`unsupported ip_family ${JSON.stringify(policy.ip_family)}`)
  }
  if (policy.samples_per_url < 1 || policy.samples_per_url > 3) {
    regionProbeValidationError('samples_per_url must be in 1..=3')
  }
  if (policy.connect_timeout_ms < 1 || policy.connect_timeout_ms > 10_000) {
    regionProbeValidationError('connect_timeout_ms must be in 1..=10000')
  }
  if (policy.round_timeout_ms < 1 || policy.round_timeout_ms > 30_000) {
    regionProbeValidationError('round_timeout_ms must be in 1..=30000')
  }
  if (policy.max_concurrency < 1 || policy.max_concurrency > 32) {
    regionProbeValidationError('max_concurrency must be in 1..=32')
  }
  if (policy.minimum_valid_urls < 2 || policy.minimum_valid_urls > SN_REGION_PROBE_MAX_URLS_PER_REGION) {
    regionProbeValidationError(`minimum_valid_urls must be in 2..=${SN_REGION_PROBE_MAX_URLS_PER_REGION}`)
  }
  if (!Number.isFinite(policy.confident_ratio) || policy.confident_ratio <= 0 || policy.confident_ratio > 1) {
    regionProbeValidationError('confident_ratio must be finite and in (0, 1]')
  }
  if (policy.cache_ttl_sec < 1 || policy.cache_ttl_sec > 21_600) {
    regionProbeValidationError('cache_ttl_sec must be in 1..=21600')
  }

  if (config.regions.length < 1 || config.regions.length > SN_REGION_PROBE_MAX_REGIONS) {
    regionProbeValidationError(`regions must contain 1..=${SN_REGION_PROBE_MAX_REGIONS} entries`)
  }

  const regionIds = new Set<string>()
  const probeIds = new Set<string>()
  const origins = new Map<string, string>()
  let totalUrls = 0
  for (const region of config.regions) {
    if (!isCanonicalSnRegionId(region.region_id)) {
      regionProbeValidationError(`invalid canonical region_id ${JSON.stringify(region.region_id)}`)
    }
    if (regionIds.has(region.region_id)) {
      regionProbeValidationError(`duplicate region_id ${JSON.stringify(region.region_id)}`)
    }
    regionIds.add(region.region_id)

    if (region.probe_urls.length < 2 || region.probe_urls.length > SN_REGION_PROBE_MAX_URLS_PER_REGION) {
      regionProbeValidationError(
        `region ${region.region_id} must contain 2..=${SN_REGION_PROBE_MAX_URLS_PER_REGION} probe_urls`,
      )
    }
    if (policy.minimum_valid_urls > region.probe_urls.length) {
      regionProbeValidationError(`region ${region.region_id} has fewer probe_urls than minimum_valid_urls`)
    }
    totalUrls += region.probe_urls.length
    if (totalUrls > SN_REGION_PROBE_MAX_TOTAL_URLS) {
      regionProbeValidationError(`config contains more than ${SN_REGION_PROBE_MAX_TOTAL_URLS} probe URLs`)
    }

    for (const probe of region.probe_urls) {
      if (
        probe.id.length === 0 ||
        byteLength(probe.id) > 128 ||
        probe.id.trim() !== probe.id ||
        CONTROL_CHARACTER_RE.test(probe.id)
      ) {
        regionProbeValidationError(
          `probe URL id in region ${region.region_id} must be 1..=128 non-control bytes without surrounding whitespace`,
        )
      }
      if (probeIds.has(probe.id)) {
        regionProbeValidationError(`duplicate probe URL id ${JSON.stringify(probe.id)}`)
      }
      probeIds.add(probe.id)

      let parsed: URL
      try {
        parsed = new URL(probe.url)
      } catch (error) {
        regionProbeValidationError(`invalid probe URL ${JSON.stringify(probe.url)}: ${String(error)}`)
      }
      if (parsed.protocol !== 'https:') {
        regionProbeValidationError(`probe URL ${JSON.stringify(probe.url)} must use https`)
      }
      if (!parsed.hostname || parsed.username || parsed.password) {
        regionProbeValidationError(
          `probe URL ${JSON.stringify(probe.url)} must be absolute and must not contain userinfo`,
        )
      }
      if (parsed.port !== '') {
        regionProbeValidationError(`probe URL ${JSON.stringify(probe.url)} must use port 443`)
      }

      const literalIpv4 = parseIpv4Address(parsed.hostname)
      const literalIpv6 = parsed.hostname.startsWith('[') && parsed.hostname.endsWith(']')
      if ((literalIpv4 && !isPublicSnProbeIp(parsed.hostname)) || literalIpv6) {
        regionProbeValidationError(
          `probe URL ${JSON.stringify(probe.url)} has a non-public or unsupported literal IP`,
        )
      }

      const existingRegion = origins.get(parsed.origin)
      if (existingRegion !== undefined) {
        if (existingRegion !== region.region_id) {
          regionProbeValidationError(
            `probe origin ${parsed.origin} is assigned to both ${existingRegion} and ${region.region_id}`,
          )
        }
        regionProbeValidationError(`probe origin ${parsed.origin} is duplicated in region ${region.region_id}`)
      }
      origins.set(parsed.origin, region.region_id)
    }
  }
}

export function parseSnRegionProbeConfig(json: string | Uint8Array): SnRegionProbeConfig {
  let text: string
  try {
    text = typeof json === 'string' ? json : new TextDecoder('utf-8', { fatal: true }).decode(json)
  } catch (error) {
    regionProbeValidationError(`parse region probe config JSON failed: ${String(error)}`)
  }

  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    regionProbeValidationError(`parse region probe config JSON failed: ${String(error)}`)
  }
  const config = decodeSnRegionProbeConfig(value)
  validateSnRegionProbeConfig(config)
  return config
}

export function normalizeSnRegionProbeUrl(snUrl: string): string {
  let url: URL
  try {
    url = new URL(snUrl.trim())
  } catch (error) {
    regionProbeValidationError(`invalid SN base URL for region probe config: ${String(error)}`)
  }
  if (url.protocol !== 'https:') {
    regionProbeValidationError('region probe config must be fetched from the target SN over HTTPS')
  }
  if (!url.hostname || url.username || url.password) {
    regionProbeValidationError('SN region probe config URL must have a host and no userinfo')
  }
  url.search = ''
  url.hash = ''

  const trimmedPath = url.pathname.replace(/\/+$/, '')
  let basePath = trimmedPath
  for (const suffix of SN_REGION_PROBE_KNOWN_SUFFIXES) {
    if (trimmedPath.endsWith(suffix)) {
      basePath = trimmedPath.slice(0, trimmedPath.length - suffix.length)
      break
    }
  }
  url.pathname = `${basePath}${SN_REGION_PROBE_CONFIG_PATH}`
  return url.toString()
}

const defaultSnRegionProbeFetcher: SnRegionProbeFetcher = async (input, init) => {
  if (typeof globalThis.fetch !== 'function') {
    throw new Error('fetch is not available in this runtime')
  }
  return globalThis.fetch(input, init)
}

async function readBoundedRegionProbeBody(response: Response, url: string): Promise<Uint8Array> {
  if (!response.body) {
    const body = new Uint8Array(await response.arrayBuffer())
    if (body.byteLength > SN_REGION_PROBE_MAX_CONFIG_BYTES) {
      throw new SnClientError(
        'transport',
        `SN region probe config from ${url} exceeds ${SN_REGION_PROBE_MAX_CONFIG_BYTES} bytes`,
      )
    }
    return body
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    totalBytes += value.byteLength
    if (totalBytes > SN_REGION_PROBE_MAX_CONFIG_BYTES) {
      await reader.cancel()
      throw new SnClientError(
        'transport',
        `SN region probe config from ${url} exceeds ${SN_REGION_PROBE_MAX_CONFIG_BYTES} bytes`,
      )
    }
    chunks.push(value)
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

// Anonymous bounded fetch. Redirects are disabled; 304 and 404 are normal
// outcomes so callers can use a cached config or fail open during activation.
export async function fetchSnRegionProbeConfig(
  snUrl: string,
  etag: string | null = null,
  options: SnRegionProbeFetchOptions = {},
): Promise<SnRegionProbeConfigFetch> {
  const url = normalizeSnRegionProbeUrl(snUrl)
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (etag !== null) {
    if (/[\u0000-\u001f\u007f]/.test(etag)) {
      regionProbeValidationError('invalid cached region probe ETag: header value contains control characters')
    }
    headers['If-None-Match'] = etag
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SN_REGION_PROBE_FETCH_TIMEOUT)
  try {
    let response: Response
    try {
      response = await (options.fetcher ?? defaultSnRegionProbeFetcher)(url, {
        method: 'GET',
        headers,
        redirect: 'manual',
        credentials: 'omit',
        signal: controller.signal,
      })
    } catch (error) {
      throw new SnClientError('transport', `fetch SN region probe config from ${url} failed: ${String(error)}`)
    }

    if (response.status === 304) {
      return { kind: 'not_modified' }
    }
    if (response.status === 404) {
      return { kind: 'not_configured' }
    }
    if (response.status !== 200) {
      throw new SnClientError(
        'transport',
        `fetch SN region probe config from ${url} returned HTTP ${response.status}`,
      )
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.split(';')[0].trim().toLowerCase() !== 'application/json') {
      throw new SnClientError(
        'transport',
        `SN region probe config from ${url} has unsupported Content-Type ${JSON.stringify(contentType)}`,
      )
    }
    const contentLength = response.headers.get('content-length')
    if (contentLength !== null && /^\d+$/.test(contentLength) && Number(contentLength) > SN_REGION_PROBE_MAX_CONFIG_BYTES) {
      throw new SnClientError(
        'transport',
        `SN region probe config from ${url} exceeds ${SN_REGION_PROBE_MAX_CONFIG_BYTES} bytes`,
      )
    }

    let body: Uint8Array
    try {
      body = await readBoundedRegionProbeBody(response, url)
    } catch (error) {
      if (error instanceof SnClientError) {
        throw error
      }
      throw new SnClientError('transport', `read SN region probe config from ${url} failed: ${String(error)}`)
    }

    let config: SnRegionProbeConfig
    try {
      config = parseSnRegionProbeConfig(body)
    } catch (error) {
      const detail = error instanceof SnClientError ? error.detail : String(error)
      throw new SnClientError('validation', `invalid SN region probe config from ${url}: ${detail}`)
    }
    return {
      kind: 'modified',
      document: {
        config,
        etag: response.headers.get('etag'),
        cache_control: response.headers.get('cache-control'),
      },
    }
  } finally {
    clearTimeout(timeout)
  }
}

// ============================================================================
// Wire types — /kapi/sn/auth (SN-API.md §4)
// ============================================================================

export interface SnCheckUsernameResp {
  valid: boolean
  reason: SnCheckUsernameReason
  message: string
  // Usernames are trimmed and lowercased server-side.
  normalized_name: string
}

export type SnCheckUsernameReason = 'ok' | 'invalid_username' | 'already_exists'

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
  region?: string
  // Idempotency key; server default is `sn:register:<username>`.
  request_id?: string
  // User owner EVM address (0x…). Required when the SN runs the production
  // multi-controller bns-proxy config; devtest single-controller deployments
  // fall back to the bound controller address.
  asset_owner?: string
  owner_config?: Record<string, unknown>
  initial_documents?: SnBnsProxyInitialDocuments
}

export interface SnAuthLoginReq {
  name: string
  pwd_hash: string
  active_code?: string
}

export interface SnAuthSessionResp {
  code: number
  access_token: string
  refresh_token: string
  need_bind_owner_key: boolean
  // Present only when the SN performed the BNS proxy registration.
  bns?: SnBnsProxyTxOutcome
}

export type SnAuthRegisterResp = SnAuthSessionResp
export type SnAuthLoginResp = SnAuthSessionResp

export interface SnAuthRefreshResp {
  code: number
  access_token: string
}

// Generic `{ "code": 0 }` success payload.
export interface SnSuccessResp {
  code: number
}

export interface SnUserProfileResp {
  code: number
  name: string
  owner_key_bound: boolean
  user_domain: string | null
  self_cert: boolean
  sn_ips: string[] | null
  zone_config: string
}

export interface SnDnsRecordReq {
  // Must be a device owned by the current user.
  device_did: string
  // The user's bound user_domain (or subdomain), or the user's own
  // `<username>.web3.<server_host>` bridge domain (or subdomain).
  domain: string
  // Exactly 'A' | 'AAAA' | 'TXT'.
  record_type: string
  // Required for add; optional for account-token removal of a whole RRset.
  record?: string
  // Seconds, server default 600.
  ttl?: number
  has_cert?: boolean
}

export interface SnAddDnsRecordResp {
  code: number
  device_name: string
  revision: number
  changed: boolean
}

export type SnDnsRecordType = 'A' | 'AAAA' | 'TXT'

export interface SnDnsRrset {
  name: string
  record_type: SnDnsRecordType
  ttl: number
  values: string[]
  revision: number
}

export interface SnRemoveDnsRecordResp {
  code: number
  revision: number
  changed: boolean
}

export interface SnDnsRecordListResp {
  code: number
  items: SnDnsRrset[]
}

export interface SnZoneInfoResp {
  code: number
  zone: string
  bns_name: string
  relay_sn: string | null
  self_cert: boolean
  cert_checked_at: number | null
  cert_expires_at: number | null
  source_version: string | null
  updated_at: number
}

export interface SnBindDomainResp {
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
  port: number | null
  scope: SnEndpointScope
  priority: number
  source: SnEndpointSource
  // Unix seconds.
  expires_at: number | null
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

export type SnDeviceOnlineResp = SnDeviceStateView & { code: number }

// device.register / device.update online-state report. Only reports runtime
// state — device identity documents are published via the BNS API, and a
// `mini_config_jwt` field is rejected by the server.
export interface SnDeviceOnlineReportReq {
  device_name: string
  // Required for device.register and for the first report of a device;
  // device.update may omit it once the device is known to the SN.
  device_did?: string
  device_ip: string
  device_info: unknown
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
export type SnOodState = 'active' | 'suspended' | 'disabled' | 'banned'

export interface SnOodInfo {
  did_hostname: string
  canonical_device_id?: string
  owner_id: string
  self_cert: boolean
  state: SnOodState
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
// auth.register (SN-API.md §6.2). Ordinary writes return `submitted`; the
// registration path may return `confirmed`.
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
  status: SnBnsProxyStatus
  // True when the same request_id was replayed and the previous TX returned.
  reused: boolean
}

export type SnBnsProxyStatus = 'submitted' | 'confirmed'

export type SnBnsProxyResp = SnBnsProxyTxOutcome & { code: number }

// Owner-key-authorized compare-and-swap update. Unlike ordinary bns.* writes,
// this call does not require an SN account token: owner_authorization is an
// EdDSA JWT whose claims bind every request field.
export interface SnOwnerRemoveBoundZoneReq {
  name: string
  zone_did: string
  expected_owner_hash: string
  request_id: string
  owner_authorization: string
}

export interface SnOwnerRemoveBoundZoneResp extends SnBnsProxyTxOutcome {
  code: number
  source_owner_hash: string
  result_owner_hash: string
  source_version: number
  target_version: number
}

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
  async register(req: SnAuthRegisterReq): Promise<SnAuthRegisterResp> {
    const params: Record<string, unknown> = {
      name: req.name,
      email: req.email,
      pwd_hash: req.pwd_hash,
      active_code: req.active_code,
    }
    if (req.request_id !== undefined) {
      params.request_id = req.request_id
    }
    if (req.region !== undefined) {
      params.region = req.region
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

  async login(req: SnAuthLoginReq): Promise<SnAuthLoginResp> {
    const params: Record<string, unknown> = {
      name: req.name,
      pwd_hash: req.pwd_hash,
    }
    if (req.active_code !== undefined) {
      params.active_code = req.active_code
    }
    return this.call(this.authRpc, METHOD_AUTH_LOGIN, params)
  }

  async refresh(refreshToken: string): Promise<SnAuthRefreshResp> {
    return this.call(this.authRpc, METHOD_AUTH_REFRESH, { refresh_token: refreshToken })
  }

  // Revokes the current access token (when set on this client) and/or the
  // given refresh token.
  async logout(refreshToken?: string): Promise<SnSuccessResp> {
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
  async setSelfCert(selfCert: boolean, deviceDid?: string): Promise<SnSuccessResp> {
    return this.call(this.authRpc, METHOD_USER_SET_SELF_CERT, {
      self_cert: selfCert,
      device_did: deviceDid ?? null,
    })
  }

  // AuthDB RRset records only — no BNS dns_txt publish, on-chain TX, or gas.
  // This is the supported bridge namespace for short-lived ACME challenges;
  // it is not a legacy compat-store fallback.
  async addDnsRecord(req: SnDnsRecordReq): Promise<SnAddDnsRecordResp> {
    return this.call(this.authRpc, METHOD_USER_ADD_DNS_RECORD, dnsRecordParams(req))
  }

  async removeDnsRecord(req: SnDnsRecordReq): Promise<SnRemoveDnsRecordResp> {
    return this.call(this.authRpc, METHOD_USER_REMOVE_DNS_RECORD, dnsRecordParams(req))
  }

  async listDnsRecords(): Promise<SnDnsRecordListResp> {
    return this.call(this.authRpc, METHOD_USER_LIST_DNS_RECORDS, {})
  }

  // Returns the caller's SN-local zone runtime state. The zone is derived
  // from the account/device token; the request deliberately takes no params.
  async getZoneInfo(): Promise<SnZoneInfoResp> {
    return this.call(this.authRpc, METHOD_ZONE_GET_INFO, {})
  }

  // ----- domain.* (SN access token required) -----

  // One-stop user_domain bind: the SN resolves the expected PKX from the
  // user's `did:bns:<username>` owner document and queries external DNS TXT
  // itself. Until the TXT record is in place this rejects with the retryable
  // domain_proof_failed (1016) — read SnClientError.domainProofInfo() for the
  // record to configure, then call bindDomain again. Client-submitted TXT
  // proofs are ignored by the server.
  async bindDomain(domain: string): Promise<SnBindDomainResp> {
    return this.call(this.authRpc, METHOD_DOMAIN_BIND, { domain })
  }

  async unbindDomain(domain: string): Promise<SnSuccessResp> {
    return this.call(this.authRpc, METHOD_DOMAIN_UNBIND, { domain })
  }

  // ----- device.* (SN access token or device token required) -----

  async registerDeviceOnline(req: SnDeviceOnlineReportReq): Promise<SnDeviceOnlineResp> {
    return this.call(this.deviceInfoRpc, METHOD_DEVICE_REGISTER, deviceReportParams(req))
  }

  async updateDeviceOnline(req: SnDeviceOnlineReportReq): Promise<SnDeviceOnlineResp> {
    return this.call(this.deviceInfoRpc, METHOD_DEVICE_UPDATE, deviceReportParams(req))
  }

  async getDeviceOnline(query: SnDeviceGetReq): Promise<SnDeviceOnlineResp> {
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

  async publishDnsTxt(req: SnBnsPublishDnsTxtReq): Promise<SnBnsProxyResp> {
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

  async publishDocument(req: SnBnsPublishDocumentReq): Promise<SnBnsProxyResp> {
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

  async removeBoundZone(req: SnOwnerRemoveBoundZoneReq): Promise<SnOwnerRemoveBoundZoneResp> {
    return this.call(this.bnsProxyRpc, METHOD_OWNER_REMOVE_BOUND_ZONE, {
      name: req.name,
      zone_did: req.zone_did,
      expected_owner_hash: req.expected_owner_hash,
      request_id: req.request_id,
      owner_authorization: req.owner_authorization,
    })
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

function dnsRecordParams(req: SnDnsRecordReq): Record<string, unknown> {
  const params: Record<string, unknown> = {
    device_did: req.device_did,
    domain: req.domain,
    record_type: req.record_type,
  }
  if (req.record !== undefined) {
    params.record = req.record
  }
  if (req.ttl !== undefined) {
    params.ttl = req.ttl
  }
  if (req.has_cert !== undefined) {
    params.has_cert = req.has_cert
  }
  return params
}

function sanitizeDeviceEndpointUpdate(endpoint: SnDeviceEndpointUpdate): Record<string, unknown> {
  return {
    endpoint_id: endpoint.endpoint_id,
    protocol: endpoint.protocol,
    host: endpoint.host,
    port: endpoint.port,
    scope: endpoint.scope,
    priority: endpoint.priority,
    source: endpoint.source,
    expires_at: endpoint.expires_at,
  }
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
  if (req.endpoints !== undefined && req.endpoints.length > 0) {
    params.endpoints = req.endpoints.map(sanitizeDeviceEndpointUpdate)
  }
  if (req.report_seq !== undefined) {
    params.report_seq = req.report_seq
  }
  if (req.ttl !== undefined) {
    params.ttl = req.ttl
  }
  return params
}
