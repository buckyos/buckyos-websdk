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
// Unlike the current Rust `BnsIndexerClient::into_result`, this client treats
// `ok: true, result: null` as a valid empty result for nullable reads
// (name.query_state / authority.get_key / document.get_version /
// checkpoint.latest), per BNS-API.md §8.3.

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

export interface BnsWaitTxOptions {
  // Required confirmations before a succeeded TX is considered final.
  confirmations?: number
  // Poll interval in milliseconds.
  intervalMs?: number
  // Give up after this many milliseconds (0 disables the timeout).
  timeoutMs?: number
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

  private async callEnvelope<TParams>(method: string, params: TParams): Promise<unknown> {
    let raw: unknown
    try {
      raw = await this.rpcClient.call<unknown, TParams>(method, params)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new BnsClientError('transport', `${method} failed: ${message}`)
    }

    if (raw === null || typeof raw !== 'object' || typeof (raw as { ok?: unknown }).ok !== 'boolean') {
      throw new BnsClientError('invalid_response', `invalid BNS RPC envelope for ${method}`)
    }
    const envelope = raw as BnsRpcEnvelope<unknown>

    if (!envelope.ok) {
      throw BnsClientError.registry(
        envelope.error ?? {
          code: 'UNKNOWN_BNS_ERROR',
          message: 'BNS RPC envelope missing error',
          name: null,
          doc_type: null,
          expected: null,
          actual: null,
        },
      )
    }
    return envelope.result ?? null
  }

  private async call<TResult, TParams>(method: string, params: TParams): Promise<TResult> {
    const result = await this.callEnvelope(method, params)
    if (result === null) {
      throw new BnsClientError('invalid_response', `BNS RPC envelope missing result for ${method}`)
    }
    return result as TResult
  }

  private async callNullable<TResult, TParams>(method: string, params: TParams): Promise<TResult | null> {
    return (await this.callEnvelope(method, params)) as TResult | null
  }

  // Full projection state of a name; null when the name does not exist.
  async queryNameState(name: string): Promise<NameState | null> {
    return this.callNullable(METHOD_QUERY_NAME_STATE, { name })
  }

  // Effective semantic owner plus its authority summary. NAME_NOT_FOUND when
  // the name does not exist.
  async resolveOwner(name: string): Promise<OwnerResolution> {
    return this.call(METHOD_RESOLVE_OWNER, { name })
  }

  // Authority set summary; an empty set (authority_seq 0, ZERO_HASH root) is
  // returned when no record exists.
  async getAuthoritySet(name: string): Promise<AuthoritySetState> {
    return this.call(METHOD_GET_AUTHORITY_SET, { name })
  }

  // Single authority key by kid; null when the key does not exist.
  async getAuthorityKey(name: string, kid: string): Promise<AuthorityKey | null> {
    return this.callNullable(METHOD_GET_AUTHORITY_KEY, { name, kid })
  }

  // Current document of (name, doc_type) with owner/controller/alias/proof
  // context. NAME_NOT_FOUND / DOCUMENT_NOT_FOUND on missing name/document.
  async resolveDocument(name: string, docType: string): Promise<ResolveResult> {
    return this.call(METHOD_RESOLVE_DOCUMENT, { name, doc_type: docType })
  }

  // Historical document version; null when that version does not exist.
  async getDocumentVersion(name: string, docType: string, version: number): Promise<DocumentState | null> {
    return this.callNullable(METHOD_GET_DOCUMENT_VERSION, { name, doc_type: docType, version })
  }

  // Names currently held (asset_owner) by an EVM address, ordered by name.
  // `limit` must stay within 1..=1000; pass the returned next_cursor to page.
  async queryNamesByAddress(address: string, cursor: string | null = null, limit: number = 100): Promise<BnsNamePage> {
    return this.call(METHOD_QUERY_NAMES_BY_ADDRESS, { address, cursor, limit })
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
    return this.call(METHOD_QUERY_TX_STATE, { tx_hash: txHash })
  }

  // Submits a signed EVM raw transaction (hex string or bytes). Success only
  // means the chain node accepted the TX — poll queryTxState / waitTx for the
  // final execution state.
  async submitRawTx(rawTx: string | Uint8Array): Promise<BnsSubmitRawTxResp> {
    return this.call(METHOD_SUBMIT_RAW_TX, { raw_tx: normalizeRawTx(rawTx) })
  }

  // Polls tx.query_state until the TX is reverted or succeeded with enough
  // confirmations, then returns that final state (callers must still check
  // `state`). `not_found`/`pending` keep polling until timeoutMs.
  async waitTx(txHash: string, options: BnsWaitTxOptions = {}): Promise<BnsTxState> {
    const confirmations = options.confirmations ?? 1
    const intervalMs = options.intervalMs ?? 2000
    const timeoutMs = options.timeoutMs ?? 120_000
    const startedAt = Date.now()

    for (;;) {
      const state = await this.queryTxState(txHash)
      if (state.state === 'reverted') {
        return state
      }
      if (state.state === 'succeeded' && state.confirmations >= confirmations) {
        return state
      }
      if (timeoutMs > 0 && Date.now() - startedAt >= timeoutMs) {
        throw new BnsClientError('timeout', `timed out waiting for tx ${txHash} (last state: ${state.state})`)
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  }

  // Projection event log, `seq >= fromSeq`, ascending, at most `limit`
  // records. Continue paging with `lastRecord.seq + 1`.
  async listEvents(fromSeq: number, limit: number = 100): Promise<EventLogRecord[]> {
    return this.call(METHOD_LIST_EVENTS, { from_seq: fromSeq, limit })
  }

  // Log checkpoint with the largest last_seq; null when none exists yet.
  async latestCheckpoint(): Promise<LogCheckpoint | null> {
    return this.callNullable(METHOD_LATEST_CHECKPOINT, {})
  }
}
