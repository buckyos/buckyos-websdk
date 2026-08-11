// bns_client: TypeScript mirror of cyfs-gateway bns-client (kRPC flavour).
// Wire contract: cyfs-gateway/doc/BNS/BNS-API.md (Beta2.2), authoritative Rust
// definitions in cyfs-gateway/src/components/bns-client/src/rpc.rs + model.rs.
//
// Hard constraints (must stay aligned with the Rust implementation):
// - kRPC JSON (no jsonrpc/id fields); the kRPC `result` carries one more
//   business envelope layer: BnsRpcEnvelope<T> = { ok, result, error }.
// - BNS-Server is a read projection + raw EVM TX forwarder. The only write
//   method is `tx.submit_raw`; TX construction/signing happens elsewhere
//   (see bns_tx_executor.ts).
// - Rust u64/u32/usize are plain JSON numbers. Fields that can exceed
//   Number.MAX_SAFE_INTEGER are typed `number` here to match the wire; treat
//   them with care if you do arithmetic on them.
// - Rust Vec<u8> is a JSON array of integers (not base64), e.g.
//   AuthorityKey.key_data / DocumentRef.inline_document.
//
// Response validation: every method decodes its result with a runtime decoder
// that mirrors what serde enforces on the Rust side (missing/mistyped fields,
// unknown enum variants and unknown event tags are INVALID_RESPONSE). Per
// BNS-API.md §8.3, nullable reads (name.query_state / authority.get_key /
// document.get_version / checkpoint.latest) accept an explicit
// `result: null`; a *missing* `result` field is INVALID_RESPONSE even for
// nullable reads. (The explicit-null case intentionally differs from the Rust
// `BnsIndexerClient::into_result`, which cannot observe `Some(None)` through
// serde's nested-Option handling.)

import { kRPCClient, KRPCClientOptions } from './krpc_client'

export const BNS_SERVER_RPC_PATH = '/kapi/bns'
export const BNS_INDEXER_RPC_PATH = '/kapi/bns-indexer'
export const MAX_BNS_NAMES_PAGE_SIZE = 1000

export const DID_BNS_PREFIX = 'did:bns:'
export const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000'
export const MAX_BNS_NAME_LEN = 253
export const MAX_BNS_LABEL_LEN = 126

// AuthorityKey.purposes bitmask
export const KEY_PURPOSE_AUTHENTICATION = 1 << 0
export const KEY_PURPOSE_RECOVERY = 1 << 1
export const KEY_PURPOSE_SIGN_DOCUMENT = 1 << 2

// Canonical kRPC method names. The server also accepts legacy underscore
// aliases (query_name_state, ...) but new callers must use these.
export const METHOD_QUERY_NAME_STATE = 'name.query_state'
export const METHOD_RESOLVE_OWNER = 'name.resolve_owner'
export const METHOD_GET_AUTHORITY_SET = 'authority.get_set'
export const METHOD_GET_AUTHORITY_KEY = 'authority.get_key'
export const METHOD_RESOLVE_DOCUMENT = 'document.resolve'
export const METHOD_GET_DOCUMENT_VERSION = 'document.get_version'
export const METHOD_QUERY_NAMES_BY_ADDRESS = 'name.query_by_addr'
export const METHOD_QUERY_TX_STATE = 'tx.query_state'
export const METHOD_SUBMIT_RAW_TX = 'tx.submit_raw'
export const METHOD_LIST_EVENTS = 'events.list'
export const METHOD_LATEST_CHECKPOINT = 'checkpoint.latest'

// ============================================================================
// Wire types (BNS-API.md §5, mirrors model.rs)
// ============================================================================

export type NameStatus = 'available' | 'active' | 'expired' | 'released' | 'tombstoned'

export type DocumentStatus = 'missing' | 'active' | 'revoked' | 'expired' | 'migrated' | 'tombstoned'

export type AliasKind = 'none' | 'alias' | 'migrated_to' | 'canonical'

export type ReleaseMode = 'release_after_grace' | 'tombstone_forever'

export type PrincipalKind = 'unset' | 'chain_account' | 'bns_name'

export type OwnerSource = 'none' | 'asset_owner_fallback' | 'explicit_semantic_owner' | 'parent_inherited'

export type AuthorityKeyStatus = 'missing' | 'active' | 'revoked' | 'expired'

export interface Principal {
  kind: PrincipalKind
  value: string
}

export interface NameState {
  name: string
  asset_owner: string
  semantic_owner: Principal
  effective_owner: Principal
  owner_source: OwnerSource
  standard_transfer_enabled: boolean
  status: NameStatus
  registered_at: number
  expire_at: number
  grace_until: number
  updated_at: number
  name_seq: number
  owner_document_version: number
  min_document_iat: number
  owner_policy_seq: number
  lineage_epoch: number
  renewable: boolean
  transferable: boolean
  allow_delegated_subnames: boolean
  namespace_policy_hash: string
  payment_policy_hash: string
  alias_state_hash: string
}

export interface OwnerResolution {
  effective_owner: Principal
  source: OwnerSource
  authority_root: string
  authority_seq: number
}

export interface AuthoritySetState {
  name: string
  authority_seq: number
  authority_root: string
  active_key_count: number
}

export interface AuthorityKey {
  kid: string
  verification_method: string
  key_data: number[]
  purposes: number
  valid_from: number
  valid_until: number
  status: AuthorityKeyStatus
  metadata_hash: string
}

export interface DocumentRef {
  storage_type: string
  uri: string
  inline_document: number[]
  content_hash: string
  schema: string
  codec: string
  extra_hash: string
}

export interface DocumentState {
  name: string
  doc_type: string
  version: number
  previous_version: number
  status: DocumentStatus
  document: DocumentRef
  controller: Principal
  beneficiary: Principal
  payment_target: string
  valid_from: number
  expire_at: number
  revoked_at: number
  controller_policy_hash: string
  payment_policy_hash: string
  split_policy_hash: string
  price_policy_hash: string
  rights_policy_hash: string
  document_state_hash: string
}

export interface ResolveResult {
  name_state: NameState
  document_state: DocumentState
  owner: OwnerResolution
  effective_controller: Principal
  status: DocumentStatus
  alias_kind: AliasKind
  alias_target_did: string
  proof_root: string
}

export interface BnsNamePage {
  names: string[]
  next_cursor: string | null
}

export type BnsTxExecutionState = 'not_found' | 'pending' | 'succeeded' | 'reverted'

export interface BnsTxState {
  tx_hash: string
  state: BnsTxExecutionState
  block_number: number | null
  confirmations: number
}

export interface BnsSubmitRawTxResp {
  tx_hash: string
}

export interface LogCheckpoint {
  log_root: string
  last_seq: number
  issued_at: number
  issuer: Principal
  external_anchor: string
}

// Registry events (serde tag = "type", content = "data").
export type RegistryEvent =
  | { type: 'name_registered'; data: { name: string; asset_owner: string; expire_at: number; lineage_epoch: number; name_seq: number } }
  | { type: 'name_renewed'; data: { name: string; expire_at: number; name_seq: number } }
  | { type: 'name_asset_transferred'; data: { name: string; old_asset_owner: string; new_asset_owner: string; standard_transfer: boolean; name_seq: number } }
  | { type: 'name_owner_updated'; data: { name: string; owner: Principal; owner_source: OwnerSource; standard_transfer_enabled: boolean; name_seq: number } }
  | { type: 'authority_keys_updated'; data: { name: string; authority_seq: number; authority_root: string } }
  | { type: 'name_released'; data: { name: string; mode: ReleaseMode; reason_hash: string; name_seq: number } }
  | { type: 'document_published'; data: { name: string; doc_type: string; version: number; content_hash: string; document_state_hash: string } }
  | { type: 'document_revoked'; data: { name: string; doc_type: string; previous_version: number; new_version: number; reason_hash: string } }
  | { type: 'owner_document_iat_floor_updated'; data: { name: string; previous_min_document_iat: number; new_min_document_iat: number; owner_policy_seq: number; name_seq: number; reason_hash: string } }
  | { type: 'controller_policy_updated'; data: { name: string; policy_hash: string; name_seq: number } }
  | { type: 'namespace_policy_updated'; data: { name: string; allow_delegated_subnames: boolean; namespace_policy_hash: string; name_seq: number } }
  | { type: 'did_alias_set'; data: { name: string; target_did: string; kind: AliasKind; proof_hash: string; name_seq: number } }
  | { type: 'payment_target_updated'; data: { name: string; doc_type: string; payment_target: string; payment_policy_hash: string; version: number } }
  | { type: 'log_checkpoint_published'; data: { log_root: string; last_seq: number; issued_at: number; external_anchor: string } }

export interface EventLogRecord {
  seq: number
  // For owner_document_iat_floor_updated events this outer tag is currently
  // `owner_iat_floor_updated` (differs from event.type); prefer the inner
  // tagged `event` when consuming.
  event_type: string
  observed_at: number
  event_hash: string
  previous_log_root: string
  log_root: string
  event: RegistryEvent
}

// ============================================================================
// Envelope & errors
// ============================================================================

export interface BnsRpcErrorInfo {
  code: string
  message: string
  name: string | null
  doc_type: string | null
  expected: number | null
  actual: number | null
}

export interface BnsRpcEnvelope<T> {
  ok: boolean
  result: T | null
  error: BnsRpcErrorInfo | null
}

// - registry: the server (or client-side validation) rejected the request
//   with a BNS business error; `info.code` is e.g. NAME_NOT_FOUND (§6).
// - transport: kRPC/HTTP failure, including UnknownMethod and params that
//   fail to deserialize on the server.
// - serialization: local encoding failure (e.g. invalid raw TX hex).
// - invalid_response: the envelope shape is broken or a non-nullable result
//   is missing.
// - timeout: waitTx() gave up before the TX reached a final state.
export type BnsClientErrorKind = 'registry' | 'transport' | 'serialization' | 'invalid_response' | 'timeout'

const ERROR_KIND_CODES: Record<Exclude<BnsClientErrorKind, 'registry'>, string> = {
  transport: 'RPC_TRANSPORT_ERROR',
  serialization: 'SERIALIZATION_ERROR',
  invalid_response: 'INVALID_RESPONSE',
  timeout: 'TX_WAIT_TIMEOUT',
}

export class BnsClientError extends Error {
  readonly kind: BnsClientErrorKind
  // Present for kind === 'registry'.
  readonly info: BnsRpcErrorInfo | null

  constructor(kind: BnsClientErrorKind, message: string, info: BnsRpcErrorInfo | null = null) {
    super(message)
    this.name = 'BnsClientError'
    this.kind = kind
    this.info = info
  }

  get code(): string {
    if (this.kind === 'registry') {
      return this.info?.code ?? 'UNKNOWN_BNS_ERROR'
    }
    return ERROR_KIND_CODES[this.kind]
  }

  isRegistryCode(code: string): boolean {
    return this.kind === 'registry' && this.code === code
  }

  static registry(info: BnsRpcErrorInfo): BnsClientError {
    return new BnsClientError('registry', `${info.code}: ${info.message}`, info)
  }

  static registryCode(code: string, message: string, context: Partial<BnsRpcErrorInfo> = {}): BnsClientError {
    return BnsClientError.registry({
      code,
      message,
      name: null,
      doc_type: null,
      expected: null,
      actual: null,
      ...context,
    })
  }
}

// ============================================================================
// Result decoders (runtime mirror of the serde deserialization that the Rust
// client gets for free; a mismatch is reported as INVALID_RESPONSE)
// ============================================================================

class BnsDecodeError extends Error {
  constructor(readonly path: string, readonly reason: string) {
    super(`${path}: ${reason}`)
    this.name = 'BnsDecodeError'
  }
}

interface Decoder<T> {
  (value: unknown, path: string): T
  // Missing-field handling inside dStruct: absent means the field is
  // required (serde's "missing field" error).
  onMissing?: () => T
}

function fail(path: string, reason: string): never {
  throw new BnsDecodeError(path, reason)
}

const dString: Decoder<string> = (value, path) =>
  typeof value === 'string' ? value : fail(path, 'expected string')

const dBool: Decoder<boolean> = (value, path) =>
  typeof value === 'boolean' ? value : fail(path, 'expected boolean')

// Rust u64 arrives as a JSON number. Number.isInteger (not isSafeInteger) so
// values beyond 2^53 — already rounded by JSON.parse — still decode; the
// precision loss is a known wire-format limitation.
const dU64: Decoder<number> = (value, path) =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fail(path, 'expected u64')

const dU32: Decoder<number> = (value, path) =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff
    ? value
    : fail(path, 'expected u32')

// Rust Vec<u8>: JSON array of byte integers (not base64).
const dBytes: Decoder<number[]> = (value, path) => {
  if (!Array.isArray(value)) {
    fail(path, 'expected byte array')
  }
  for (let i = 0; i < value.length; i++) {
    const byte = value[i]
    if (typeof byte !== 'number' || !Number.isInteger(byte) || byte < 0 || byte > 255) {
      fail(`${path}[${i}]`, 'expected u8')
    }
  }
  return value as number[]
}

function dEnum<T extends string>(...values: T[]): Decoder<T> {
  return (value, path) =>
    typeof value === 'string' && (values as string[]).includes(value)
      ? (value as T)
      : fail(path, `expected one of ${values.join('|')}`)
}

function dArray<T>(inner: Decoder<T>): Decoder<T[]> {
  return (value, path) => {
    if (!Array.isArray(value)) {
      fail(path, 'expected array')
    }
    return value.map((item, index) => inner(item, `${path}[${index}]`))
  }
}

function withMissing<T>(inner: Decoder<T>, onMissing: () => T): Decoder<T> {
  const decoder: Decoder<T> = (value, path) => inner(value, path)
  decoder.onMissing = onMissing
  return decoder
}

// Rust Option<T> struct field: both a missing field and an explicit null
// decode to null.
function dOptional<T>(inner: Decoder<T>): Decoder<T | null> {
  return withMissing((value, path) => (value === null ? null : inner(value, path)), () => null)
}

// #[serde(default)] u64 field: missing decodes to 0, but null is rejected.
const dU64Default = withMissing(dU64, () => 0)

// Extra fields are ignored (serde's default); declared fields are validated
// and copied, so the decoded object carries exactly the declared shape.
function dStruct<T>(typeName: string, fields: { [K in keyof T]-?: Decoder<T[K]> }): Decoder<T> {
  const fieldNames = Object.keys(fields) as Array<keyof T & string>
  return (value, path) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      fail(path, `expected ${typeName} object`)
    }
    const source = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const fieldName of fieldNames) {
      const decoder = fields[fieldName] as Decoder<unknown>
      const fieldPath = `${path}.${fieldName}`
      const fieldValue = source[fieldName]
      if (fieldValue === undefined && !(fieldName in source)) {
        if (decoder.onMissing) {
          out[fieldName] = decoder.onMissing()
          continue
        }
        fail(fieldPath, 'missing field')
      }
      out[fieldName] = decoder(fieldValue, fieldPath)
    }
    return out as T
  }
}

const dNameStatus = dEnum<NameStatus>('available', 'active', 'expired', 'released', 'tombstoned')
const dDocumentStatus = dEnum<DocumentStatus>('missing', 'active', 'revoked', 'expired', 'migrated', 'tombstoned')
const dAliasKind = dEnum<AliasKind>('none', 'alias', 'migrated_to', 'canonical')
const dReleaseMode = dEnum<ReleaseMode>('release_after_grace', 'tombstone_forever')
const dPrincipalKind = dEnum<PrincipalKind>('unset', 'chain_account', 'bns_name')
const dOwnerSource = dEnum<OwnerSource>('none', 'asset_owner_fallback', 'explicit_semantic_owner', 'parent_inherited')
const dAuthorityKeyStatus = dEnum<AuthorityKeyStatus>('missing', 'active', 'revoked', 'expired')
const dTxExecutionState = dEnum<BnsTxExecutionState>('not_found', 'pending', 'succeeded', 'reverted')

const dPrincipal = dStruct<Principal>('Principal', {
  kind: dPrincipalKind,
  value: dString,
})

const dNameState = dStruct<NameState>('NameState', {
  name: dString,
  asset_owner: dString,
  semantic_owner: dPrincipal,
  effective_owner: dPrincipal,
  owner_source: dOwnerSource,
  standard_transfer_enabled: dBool,
  status: dNameStatus,
  registered_at: dU64,
  expire_at: dU64,
  grace_until: dU64,
  updated_at: dU64,
  name_seq: dU64,
  owner_document_version: dU64,
  min_document_iat: dU64Default,
  owner_policy_seq: dU64Default,
  lineage_epoch: dU64,
  renewable: dBool,
  transferable: dBool,
  allow_delegated_subnames: dBool,
  namespace_policy_hash: dString,
  payment_policy_hash: dString,
  alias_state_hash: dString,
})

const dOwnerResolution = dStruct<OwnerResolution>('OwnerResolution', {
  effective_owner: dPrincipal,
  source: dOwnerSource,
  authority_root: dString,
  authority_seq: dU64,
})

const dAuthoritySetState = dStruct<AuthoritySetState>('AuthoritySetState', {
  name: dString,
  authority_seq: dU64,
  authority_root: dString,
  active_key_count: dU32,
})

const dAuthorityKey = dStruct<AuthorityKey>('AuthorityKey', {
  kid: dString,
  verification_method: dString,
  key_data: dBytes,
  purposes: dU32,
  valid_from: dU64,
  valid_until: dU64,
  status: dAuthorityKeyStatus,
  metadata_hash: dString,
})

const dDocumentRef = dStruct<DocumentRef>('DocumentRef', {
  storage_type: dString,
  uri: dString,
  inline_document: dBytes,
  content_hash: dString,
  schema: dString,
  codec: dString,
  extra_hash: dString,
})

const dDocumentState = dStruct<DocumentState>('DocumentState', {
  name: dString,
  doc_type: dString,
  version: dU64,
  previous_version: dU64,
  status: dDocumentStatus,
  document: dDocumentRef,
  controller: dPrincipal,
  beneficiary: dPrincipal,
  payment_target: dString,
  valid_from: dU64,
  expire_at: dU64,
  revoked_at: dU64,
  controller_policy_hash: dString,
  payment_policy_hash: dString,
  split_policy_hash: dString,
  price_policy_hash: dString,
  rights_policy_hash: dString,
  document_state_hash: dString,
})

const dResolveResult = dStruct<ResolveResult>('ResolveResult', {
  name_state: dNameState,
  document_state: dDocumentState,
  owner: dOwnerResolution,
  effective_controller: dPrincipal,
  status: dDocumentStatus,
  alias_kind: dAliasKind,
  alias_target_did: dString,
  proof_root: dString,
})

const dBnsNamePage = dStruct<BnsNamePage>('BnsNamePage', {
  names: dArray(dString),
  next_cursor: dOptional(dString),
})

const dBnsTxState = dStruct<BnsTxState>('BnsTxState', {
  tx_hash: dString,
  state: dTxExecutionState,
  block_number: dOptional(dU64),
  confirmations: dU64,
})

const dSubmitRawTxResp = dStruct<BnsSubmitRawTxResp>('BnsSubmitRawTxResp', {
  tx_hash: dString,
})

const dLogCheckpoint = dStruct<LogCheckpoint>('LogCheckpoint', {
  log_root: dString,
  last_seq: dU64,
  issued_at: dU64,
  issuer: dPrincipal,
  external_anchor: dString,
})

// Per-variant `data` decoders for the serde(tag = "type", content = "data")
// RegistryEvent enum. Keyed by RegistryEvent['type'] so the compiler flags a
// missing variant.
const REGISTRY_EVENT_DATA_DECODERS: Record<RegistryEvent['type'], Decoder<unknown>> = {
  name_registered: dStruct('name_registered', {
    name: dString,
    asset_owner: dString,
    expire_at: dU64,
    lineage_epoch: dU64,
    name_seq: dU64,
  }),
  name_renewed: dStruct('name_renewed', {
    name: dString,
    expire_at: dU64,
    name_seq: dU64,
  }),
  name_asset_transferred: dStruct('name_asset_transferred', {
    name: dString,
    old_asset_owner: dString,
    new_asset_owner: dString,
    standard_transfer: dBool,
    name_seq: dU64,
  }),
  name_owner_updated: dStruct('name_owner_updated', {
    name: dString,
    owner: dPrincipal,
    owner_source: dOwnerSource,
    standard_transfer_enabled: dBool,
    name_seq: dU64,
  }),
  authority_keys_updated: dStruct('authority_keys_updated', {
    name: dString,
    authority_seq: dU64,
    authority_root: dString,
  }),
  name_released: dStruct('name_released', {
    name: dString,
    mode: dReleaseMode,
    reason_hash: dString,
    name_seq: dU64,
  }),
  document_published: dStruct('document_published', {
    name: dString,
    doc_type: dString,
    version: dU64,
    content_hash: dString,
    document_state_hash: dString,
  }),
  document_revoked: dStruct('document_revoked', {
    name: dString,
    doc_type: dString,
    previous_version: dU64,
    new_version: dU64,
    reason_hash: dString,
  }),
  owner_document_iat_floor_updated: dStruct('owner_document_iat_floor_updated', {
    name: dString,
    previous_min_document_iat: dU64,
    new_min_document_iat: dU64,
    owner_policy_seq: dU64,
    name_seq: dU64,
    reason_hash: dString,
  }),
  controller_policy_updated: dStruct('controller_policy_updated', {
    name: dString,
    policy_hash: dString,
    name_seq: dU64,
  }),
  namespace_policy_updated: dStruct('namespace_policy_updated', {
    name: dString,
    allow_delegated_subnames: dBool,
    namespace_policy_hash: dString,
    name_seq: dU64,
  }),
  did_alias_set: dStruct('did_alias_set', {
    name: dString,
    target_did: dString,
    kind: dAliasKind,
    proof_hash: dString,
    name_seq: dU64,
  }),
  payment_target_updated: dStruct('payment_target_updated', {
    name: dString,
    doc_type: dString,
    payment_target: dString,
    payment_policy_hash: dString,
    version: dU64,
  }),
  log_checkpoint_published: dStruct('log_checkpoint_published', {
    log_root: dString,
    last_seq: dU64,
    issued_at: dU64,
    external_anchor: dString,
  }),
}

// Unknown variant tags are rejected, matching serde's deserialization of the
// tagged RegistryEvent enum.
const dRegistryEvent: Decoder<RegistryEvent> = (value, path) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(path, 'expected RegistryEvent object')
  }
  const tagged = value as { type?: unknown; data?: unknown }
  if (typeof tagged.type !== 'string') {
    fail(`${path}.type`, 'expected string event tag')
  }
  const dataDecoder = (REGISTRY_EVENT_DATA_DECODERS as Record<string, Decoder<unknown> | undefined>)[tagged.type]
  if (!dataDecoder) {
    fail(`${path}.type`, `unknown event type \`${tagged.type}\``)
  }
  if (!('data' in tagged) || tagged.data === undefined) {
    fail(`${path}.data`, 'missing field')
  }
  return { type: tagged.type, data: dataDecoder(tagged.data, `${path}.data`) } as RegistryEvent
}

const dEventLogRecord = dStruct<EventLogRecord>('EventLogRecord', {
  seq: dU64,
  // Free-form outer tag (Rust String): not validated against the event enum;
  // see the EventLogRecord.event_type comment.
  event_type: dString,
  observed_at: dU64,
  event_hash: dString,
  previous_log_root: dString,
  log_root: dString,
  event: dRegistryEvent,
})

const dEventLogRecords = dArray(dEventLogRecord)

const dBnsRpcErrorInfo = dStruct<BnsRpcErrorInfo>('BnsRpcErrorInfo', {
  code: dString,
  message: dString,
  name: dOptional(dString),
  doc_type: dOptional(dString),
  expected: dOptional(dU64),
  actual: dOptional(dU64),
})

// ============================================================================
// URL normalization (mirrors rpc.rs normalize_bns_*_url)
// ============================================================================

// A URL that already carries a non-root path is used as-is, so a client can
// point at a non-default mount (e.g. bns_dv only exposes /kapi/bns). Only a
// bare scheme/host[:port] (or root path) gets the default path appended.
function hasExplicitPath(url: string): boolean {
  const schemeSplit = url.split('://')
  const rest = schemeSplit.length > 1 ? schemeSplit.slice(1).join('://') : url
  const slashIndex = rest.indexOf('/')
  if (slashIndex < 0) {
    return false
  }
  return rest.slice(slashIndex + 1).replace(/\/+$/, '') !== ''
}

export function normalizeBnsServerUrl(serverUrl: string): string {
  const trimmed = serverUrl.replace(/\/+$/, '')
  return hasExplicitPath(trimmed) ? trimmed : `${trimmed}${BNS_SERVER_RPC_PATH}`
}

export function normalizeBnsIndexerUrl(indexerUrl: string): string {
  const trimmed = indexerUrl.replace(/\/+$/, '')
  return hasExplicitPath(trimmed) ? trimmed : `${trimmed}${BNS_INDEXER_RPC_PATH}`
}

// ============================================================================
// Canonical form helpers (mirrors model.rs)
// ============================================================================

export function canonicalBnsName(name: string): string {
  const invalid = (reason: string) =>
    BnsClientError.registryCode('INVALID_NAME', `invalid BNS name \`${name}\`: ${reason}`, { name })

  if (!name) {
    throw invalid('name is empty')
  }
  if (name.trim() !== name) {
    throw invalid('name must not contain leading or trailing whitespace')
  }
  if (name.startsWith(DID_BNS_PREFIX)) {
    throw invalid('contract names must not include did:bns: prefix')
  }
  if (name.length > MAX_BNS_NAME_LEN) {
    throw invalid(`name must be at most ${MAX_BNS_NAME_LEN} bytes`)
  }

  for (const label of name.split('.')) {
    if (!label) {
      throw invalid('empty label')
    }
    if (label.length > MAX_BNS_LABEL_LEN) {
      throw invalid(`label must be at most ${MAX_BNS_LABEL_LEN} bytes`)
    }
    if (label.startsWith('-') || label.endsWith('-')) {
      throw invalid("label must not start or end with '-'")
    }
    if (!/^[a-z0-9-]+$/.test(label)) {
      throw invalid("only lower-case ASCII letters, digits, '-' and '.' are supported")
    }
  }

  return name
}

export function canonicalDocType(docType: string): string {
  const invalid = (reason: string) =>
    BnsClientError.registryCode('INVALID_DOC_TYPE', `invalid doc_type \`${docType}\`: ${reason}`, { doc_type: docType })

  if (!docType) {
    throw invalid('doc_type is empty')
  }
  if (docType.length > 32) {
    throw invalid('doc_type must be at most 32 bytes')
  }
  if (!/^[a-z0-9_-]+$/.test(docType)) {
    throw invalid("only lower-case ASCII letters, digits, '-' and '_' are supported")
  }

  return docType
}

export function didBnsFromName(name: string): string {
  return `${DID_BNS_PREFIX}${canonicalBnsName(name)}`
}

export function nameFromDidBns(did: string): string {
  if (!did.startsWith(DID_BNS_PREFIX)) {
    throw BnsClientError.registryCode('INVALID_NAME', `invalid BNS name \`${did}\`: DID must start with did:bns:`, {
      name: did,
    })
  }
  return canonicalBnsName(did.slice(DID_BNS_PREFIX.length))
}

const HEX_CHARS = '0123456789abcdef'

function bytesToHex(bytes: Uint8Array): string {
  let result = ''
  for (let i = 0; i < bytes.length; i++) {
    result += HEX_CHARS[bytes[i] >> 4] + HEX_CHARS[bytes[i] & 0x0f]
  }
  return result
}

// Normalizes a signed raw TX to `0x`-prefixed hex, enforcing the same shape
// constraints as BnsSubmitRawTxReq::raw_tx_bytes (non-empty, even-length hex).
export function normalizeRawTx(rawTx: string | Uint8Array): string {
  if (rawTx instanceof Uint8Array) {
    if (rawTx.length === 0) {
      throw new BnsClientError('serialization', 'raw_tx must not be empty')
    }
    return `0x${bytesToHex(rawTx)}`
  }

  const raw = rawTx.trim()
  if (!raw) {
    throw new BnsClientError('serialization', 'raw_tx must not be empty')
  }
  const hex = raw.startsWith('0x') ? raw.slice(2) : raw
  if (!hex || hex.length % 2 !== 0) {
    throw new BnsClientError('serialization', `raw_tx must be even-length hex, got \`${rawTx}\``)
  }
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    throw new BnsClientError('serialization', `invalid raw_tx hex \`${rawTx}\``)
  }
  return `0x${hex}`
}

// ============================================================================
// Client
// ============================================================================

// All three options mirror Rust `BnsEvmReceiptWaitConfig` u64 fields: they
// must be finite non-negative integers (negative, fractional, NaN and
// Infinity are rejected up front), and like `wait_for_receipt()` each value
// is clamped to at least 1. In particular there is no "0 disables the
// timeout" mode: timeoutMs 0 clamps to 1ms and times out after the first
// poll, exactly like the Rust helper.
export interface BnsWaitTxOptions {
  // Required confirmations before a succeeded TX is considered final (min 1).
  confirmations?: number
  // Poll interval in milliseconds (min 1).
  intervalMs?: number
  // Give up after this many milliseconds (min 1; no infinite mode).
  timeoutMs?: number
}

function normalizeWaitTxOption(option: string, value: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new BnsClientError('serialization', `waitTx ${option} must be a non-negative integer, got ${value}`)
  }
  return Math.max(1, value)
}

export class BnsClient {
  private rpcClient: kRPCClient

  // `serviceUrl` with only scheme/host[:port] gets `/kapi/bns` appended; a URL
  // that already carries a non-root path is used as-is (BNS-API.md §1.1).
  constructor(serviceUrl: string, sessionToken: string | null = null, options: KRPCClientOptions = {}) {
    this.rpcClient = new kRPCClient(normalizeBnsServerUrl(serviceUrl), sessionToken, null, options)
  }

  // Targets a legacy/standalone BNS-Indexer (default path /kapi/bns-indexer).
  static forIndexer(indexerUrl: string, sessionToken: string | null = null, options: KRPCClientOptions = {}): BnsClient {
    return new BnsClient(normalizeBnsIndexerUrl(indexerUrl), sessionToken, options)
  }

  setSeq(seq: number) {
    this.rpcClient.setSeq(seq)
  }

  async syncSessionToken(token: string | null): Promise<void> {
    this.rpcClient.setSessionToken(token)
  }

  getSessionToken(): string | null {
    return this.rpcClient.getSessionToken()
  }

  // Trace id attached to subsequent requests (kRPC request sys trace slot);
  // the server echoes it in the response sys. Pass null to clear.
  setTraceId(traceId: string | null) {
    this.rpcClient.setTraceId(traceId)
  }

  getTraceId(): string | null {
    return this.rpcClient.getTraceId()
  }

  // Fetches and validates one BnsRpcEnvelope, returning the raw `result`
  // value (which may be an explicit null). Envelope rules (BNS-API.md §1.3):
  // - `ok` must be a boolean.
  // - ok=true: `result` must be present (`{ok:true}` without a result field
  //   is INVALID_RESPONSE even for nullable methods) and `error` must be
  //   null/missing.
  // - ok=false: `result` must be null/missing; a present `error` must decode
  //   as BnsRpcErrorInfo (malformed error info is INVALID_RESPONSE), a
  //   missing one falls back to UNKNOWN_BNS_ERROR like Rust into_result().
  private async callEnvelope<TParams>(method: string, params: TParams): Promise<unknown> {
    let raw: unknown
    try {
      raw = await this.rpcClient.call<unknown, TParams>(method, params)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new BnsClientError('transport', `${method} failed: ${message}`)
    }

    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new BnsClientError('invalid_response', `invalid BNS RPC envelope for ${method}`)
    }
    const envelope = raw as { ok?: unknown; result?: unknown; error?: unknown }
    if (typeof envelope.ok !== 'boolean') {
      throw new BnsClientError('invalid_response', `invalid BNS RPC envelope for ${method}`)
    }

    if (!envelope.ok) {
      if (envelope.result !== undefined && envelope.result !== null) {
        throw new BnsClientError('invalid_response', `unexpected result in failed BNS envelope for ${method}`)
      }
      if (envelope.error === undefined || envelope.error === null) {
        throw BnsClientError.registryCode('UNKNOWN_BNS_ERROR', 'BNS RPC envelope missing error')
      }
      let info: BnsRpcErrorInfo
      try {
        info = dBnsRpcErrorInfo(envelope.error, 'error')
      } catch (error) {
        const reason = error instanceof BnsDecodeError ? error.message : String(error)
        throw new BnsClientError('invalid_response', `invalid BNS error info for ${method}: ${reason}`)
      }
      throw BnsClientError.registry(info)
    }

    if (envelope.error !== undefined && envelope.error !== null) {
      throw new BnsClientError('invalid_response', `unexpected error in successful BNS envelope for ${method}`)
    }
    if (envelope.result === undefined) {
      throw new BnsClientError('invalid_response', `BNS RPC envelope missing result for ${method}`)
    }
    return envelope.result
  }

  private decodeResult<TResult>(method: string, decoder: Decoder<TResult>, value: unknown): TResult {
    try {
      return decoder(value, 'result')
    } catch (error) {
      const reason = error instanceof BnsDecodeError ? error.message : String(error)
      throw new BnsClientError('invalid_response', `invalid ${method} result: ${reason}`)
    }
  }

  private async call<TResult, TParams>(method: string, params: TParams, decoder: Decoder<TResult>): Promise<TResult> {
    const result = await this.callEnvelope(method, params)
    if (result === null) {
      throw new BnsClientError('invalid_response', `BNS RPC envelope missing result for ${method}`)
    }
    return this.decodeResult(method, decoder, result)
  }

  private async callNullable<TResult, TParams>(
    method: string,
    params: TParams,
    decoder: Decoder<TResult>,
  ): Promise<TResult | null> {
    const result = await this.callEnvelope(method, params)
    if (result === null) {
      return null
    }
    return this.decodeResult(method, decoder, result)
  }

  // Full projection state of a name; null when the name does not exist.
  async queryNameState(name: string): Promise<NameState | null> {
    return this.callNullable(METHOD_QUERY_NAME_STATE, { name }, dNameState)
  }

  // Effective semantic owner plus its authority summary. NAME_NOT_FOUND when
  // the name does not exist.
  async resolveOwner(name: string): Promise<OwnerResolution> {
    return this.call(METHOD_RESOLVE_OWNER, { name }, dOwnerResolution)
  }

  // Authority set summary; an empty set (authority_seq 0, ZERO_HASH root) is
  // returned when no record exists.
  async getAuthoritySet(name: string): Promise<AuthoritySetState> {
    return this.call(METHOD_GET_AUTHORITY_SET, { name }, dAuthoritySetState)
  }

  // Single authority key by kid; null when the key does not exist.
  async getAuthorityKey(name: string, kid: string): Promise<AuthorityKey | null> {
    return this.callNullable(METHOD_GET_AUTHORITY_KEY, { name, kid }, dAuthorityKey)
  }

  // Current document of (name, doc_type) with owner/controller/alias/proof
  // context. NAME_NOT_FOUND / DOCUMENT_NOT_FOUND on missing name/document.
  async resolveDocument(name: string, docType: string): Promise<ResolveResult> {
    return this.call(METHOD_RESOLVE_DOCUMENT, { name, doc_type: docType }, dResolveResult)
  }

  // Historical document version; null when that version does not exist.
  async getDocumentVersion(name: string, docType: string, version: number): Promise<DocumentState | null> {
    return this.callNullable(METHOD_GET_DOCUMENT_VERSION, { name, doc_type: docType, version }, dDocumentState)
  }

  // Names currently held (asset_owner) by an EVM address, ordered by name.
  // `limit` must stay within 1..=1000; pass the returned next_cursor to page.
  async queryNamesByAddress(address: string, cursor: string | null = null, limit: number = 100): Promise<BnsNamePage> {
    return this.call(METHOD_QUERY_NAMES_BY_ADDRESS, { address, cursor, limit }, dBnsNamePage)
  }

  // Iterates all names held by an address, following next_cursor pagination.
  async *iterNamesByAddress(address: string, pageSize: number = 100): AsyncGenerator<string, void, undefined> {
    let cursor: string | null = null
    do {
      const page: BnsNamePage = await this.queryNamesByAddress(address, cursor, pageSize)
      yield* page.names
      cursor = page.next_cursor
    } while (cursor !== null)
  }

  // Execution state of a submitted TX. `not_found` only means the upstream
  // node currently has neither the transaction nor a receipt.
  async queryTxState(txHash: string): Promise<BnsTxState> {
    return this.call(METHOD_QUERY_TX_STATE, { tx_hash: txHash }, dBnsTxState)
  }

  // Submits a signed EVM raw transaction (hex string or bytes). Success only
  // means the chain node accepted the TX — poll queryTxState / waitTx for the
  // final execution state.
  async submitRawTx(rawTx: string | Uint8Array): Promise<BnsSubmitRawTxResp> {
    return this.call(METHOD_SUBMIT_RAW_TX, { raw_tx: normalizeRawTx(rawTx) }, dSubmitRawTxResp)
  }

  // Polls tx.query_state until the TX is reverted or succeeded with enough
  // confirmations, then returns that final state (callers must still check
  // `state`). `not_found`/`pending` keep polling until timeoutMs. Option
  // validation/clamping mirrors Rust wait_for_receipt(); see BnsWaitTxOptions.
  async waitTx(txHash: string, options: BnsWaitTxOptions = {}): Promise<BnsTxState> {
    const confirmations = normalizeWaitTxOption('confirmations', options.confirmations ?? 1)
    const intervalMs = normalizeWaitTxOption('intervalMs', options.intervalMs ?? 2000)
    const timeoutMs = normalizeWaitTxOption('timeoutMs', options.timeoutMs ?? 120_000)
    const startedAt = Date.now()

    for (;;) {
      const state = await this.queryTxState(txHash)
      if (state.state === 'reverted') {
        return state
      }
      if (state.state === 'succeeded' && state.confirmations >= confirmations) {
        return state
      }
      if (Date.now() - startedAt >= timeoutMs) {
        throw new BnsClientError('timeout', `timed out waiting for tx ${txHash} (last state: ${state.state})`)
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  }

  // Projection event log, `seq >= fromSeq`, ascending, at most `limit`
  // records. Continue paging with `lastRecord.seq + 1`.
  async listEvents(fromSeq: number, limit: number = 100): Promise<EventLogRecord[]> {
    return this.call(METHOD_LIST_EVENTS, { from_seq: fromSeq, limit }, dEventLogRecords)
  }

  // Log checkpoint with the largest last_seq; null when none exists yet.
  async latestCheckpoint(): Promise<LogCheckpoint | null> {
    return this.callNullable(METHOD_LATEST_CHECKPOINT, {}, dLogCheckpoint)
  }
}
