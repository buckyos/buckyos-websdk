import { kRPCClient, RPCError } from './krpc_client'
import type { KEventClient, KEventReader } from './kevent_client'
import {
  TASK_ERR_ALREADY_COMPLETED,
  TASK_ERR_REVISION_CONFLICT,
  isTerminalTaskPhase,
  taskMgrErrorCode,
  taskMgrTaskEventPath,
} from './task_mgr_client'
import type {
  CommitResultReq,
  HumanPromptControl,
  HumanPromptOption,
  HumanTaskPrompt,
  Task,
  TaskDataResult,
} from './task_mgr_client'

export const MSG_CENTER_SERVICE_UNIQUE_ID = 'msg-center'
export const MSG_CENTER_SERVICE_NAME = 'msg-center'
export const MSG_CENTER_SERVICE_PORT = 4050

export const UI_SESSION_STATE_ACTIVE_KEY = 'active'
export const UI_SESSION_STATE_TYPING_KEY = 'typing'
export const UI_SESSION_STATE_STATUS_LINE_KEY = 'status_line'
export const UI_SESSION_PLATFORM_TELEGRAM = 'tg'

export type DID = string
export type ObjId = string
export type JsonObject = Record<string, unknown>
export type MsgObject = JsonObject

export type MailboxKind = 'INBOX' | 'SENT' | 'GROUP_INBOX' | 'REQUEST_BOX'
export type RecipientState = 'UNREAD' | 'READING' | 'READ' | 'ARCHIVED' | 'DELETED'
export type DeliveryState = 'WAIT' | 'SENDING' | 'SENT' | 'FAILED' | 'DEAD'
export type ReadReceiptState =
  | 'UNREAD'
  | 'READING'
  | 'READED'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'QUARANTINED'

export type ContactSource = 'manual_import' | 'manual_create' | 'auto_inferred' | 'shared'
/** Delivery policy only (INBOX / REQUEST_BOX / drop); friendship is `Contact.friend_state`. */
export type AccessGroupLevel = 'block' | 'stranger' | 'temporary' | 'allow'
/** The owner's side of the friendship with a contact. */
export type FriendState = 'none' | 'outgoing_pending' | 'incoming_pending' | 'friend'
export type SessionMessageDirection = 'in' | 'out'
export type SessionDeliveryOverall = 'sending' | 'delivered' | 'partial_failed' | 'failed'

export interface IngressContext {
  transport_did?: DID
  platform?: string
  chat_id?: string
  source_account_id?: string
  context_id?: string
  contact_mgr_owner?: DID
  extra?: unknown
}

export type TransportKind =
  | { kind: 'native' }
  | { kind: 'tunnel'; platform: string; tunnel_instance_id: string }

export interface DeliverySnapshot {
  platform?: string
  account_id?: string
  account_type?: string
  chat_id?: string
  address?: string
  ext_ids?: Record<string, string>
  extra?: unknown
}

export interface DeliveryEnvelope {
  msg_id: ObjId
  target_did: DID
  transport_did: DID
  transport: TransportKind
  address?: DeliverySnapshot
}

export interface DeliveryError {
  error_code?: string
  message: string
  retryable: boolean
  duplicate_risk: boolean
}

export interface DeliveryRecord {
  delivery_id: string
  envelope: DeliveryEnvelope
  state: DeliveryState
  attempts: number
  next_retry_at_ms?: number
  external_msg_id?: string
  delivered_at_ms?: number
  last_error?: DeliveryError
  created_at_ms: number
  updated_at_ms: number
}

export interface MailboxRecord {
  mailbox: MailboxAddress
  record_id: string
  owner: DID
  box_kind: MailboxKind
  msg_id: ObjId
  msg_kind: string
  state: RecipientState
  from: DID
  from_name?: string
  to: DID
  session_id?: string
  sort_key: number
  tags?: string[]
  ingress?: IngressContext
  created_at_ms: number
  updated_at_ms: number
}

export interface MailboxRecordWithObject {
  record: MailboxRecord
  msg: MsgObject | null
}

export interface DeliveryRecordWithObject {
  record: DeliveryRecord
  msg: MsgObject | null
}

export interface UiSessionStateEntry {
  session_id: string
  key: string
  value: unknown
  updated_at_ms: number
}

export interface MailboxRecordPage {
  items: MailboxRecordWithObject[]
  next_cursor_sort_key?: number
  next_cursor_record_id?: string
}

export interface SessionSummary {
  session_id: string
  last_record?: MailboxRecordWithObject
  unread_count: number
  updated_at_ms: number
}

export interface SessionSummaryPage {
  items: SessionSummary[]
  next_cursor_updated_at_ms?: number
  next_cursor_session_id?: string
}

export interface SessionDeliveryTarget {
  target_did: DID
  state: DeliveryState
  attempts: number
  external_msg_id?: string
  last_error?: DeliveryError
}

export interface SessionDeliveryView {
  overall: SessionDeliveryOverall
  per_target?: SessionDeliveryTarget[]
}

export interface SessionMessageItem {
  record_id: string
  msg_id: ObjId
  direction: SessionMessageDirection
  box_kind: MailboxKind
  sort_key: number
  from: DID
  to: DID
  recipient_state?: RecipientState
  delivery?: SessionDeliveryView
  msg?: MsgObject
}

export interface SessionMessagePage {
  items: SessionMessageItem[]
  next_cursor_sort_key?: number
  next_cursor_record_id?: string
}

export interface MsgReceiptObj {
  msg_id: ObjId
  iss: DID
  reader: DID
  group_id?: DID
  at_ms: number
  status: ReadReceiptState
  reason?: string
}

export interface DispatchResult {
  ok: boolean
  msg_id: ObjId
  delivered_recipients?: DID[]
  dropped_recipients?: DID[]
  delivered_group?: DID
  delivered_agents?: DID[]
  reason?: string
}

export interface PostSendDelivery {
  delivery_id: string
  transport_did: DID
  target_did: DID
  transport: TransportKind
}

export interface PostSendResult {
  ok: boolean
  msg_id: ObjId
  deliveries?: PostSendDelivery[]
  reason?: string
}

export interface DeliveryReportResult {
  ok: boolean
  external_msg_id?: string
  delivered_at_ms?: number
  error_code?: string
  error_message?: string
  retry_after_ms?: number
  retryable?: boolean
}

export interface AccountBinding {
  platform: string
  account_id: string
  display_id: string
  tunnel_instance_id: string
  account_type: string
  endpoint_did?: DID
  last_active_at: number
  meta?: Record<string, string>
}

export interface TemporaryGrant {
  context_id: string
  granted_at: number
  expires_at: number
}

export interface Contact {
  did: DID
  name: string
  avatar?: string
  note?: string
  source: ContactSource
  is_verified: boolean
  bindings?: AccountBinding[]
  access_level: AccessGroupLevel
  temp_grants?: TemporaryGrant[]
  friend_state?: FriendState
  tags?: string[]
  created_at: number
  updated_at: number
}

export interface AccessDecision {
  level: AccessGroupLevel
  allow_delivery: boolean
  target_box: string
  temporary_expires_at_ms?: number
  reason?: string
}

export interface ImportContactEntry {
  name: string
  avatar?: string
  note?: string
  bindings?: AccountBinding[]
  tags?: string[]
}

export interface ImportReport {
  imported: number
  upgraded_shadow: number
  merged: number
  created: number
  skipped: number
  failed: number
  errors?: string[]
  affected_dids?: DID[]
}

export interface ContactPatch {
  name?: string
  avatar?: string
  note?: string
  access_level?: AccessGroupLevel
  source?: ContactSource
  is_verified?: boolean
}

export interface TemporaryGrantOutcome {
  did: DID
  granted: boolean
  expires_at_ms?: number
  reason?: string
}

export interface GrantTemporaryAccessResult {
  updated: TemporaryGrantOutcome[]
}

export interface ContactQuery {
  source?: ContactSource
  access_level?: AccessGroupLevel
  friend_state?: FriendState
  /** Exact tag the contact must carry. */
  tag?: string
  keyword?: string
  limit?: number
  offset?: number
}

export interface SetGroupSubscribersResult {
  group_id: DID
  subscriber_count: number
}

/* ── Relationships (msg_contact.rs): lookup, friend requests, tags ── */

export const FRIEND_INTENT = 'buckyos.friend'
export const CONTACT_TAG_ZONE_USER = 'zone_user'
export const CONTACT_TAG_ZONE_AGENT = 'zone_agent'
export const CONTACT_TAG_HOMESTATION_FOLLOWING = 'homestation.following'
export const CONTACT_CHANGED_EVENT_BOX = 'CONTACTS'

export type ContactTagKind = 'system' | 'app' | 'user'

export interface WellKnownContactTag {
  key: string
  kind: ContactTagKind
  /** App that owns the tag; absent for system tags. */
  app?: string
  /** Whether the user may add or remove members. */
  user_editable: boolean
}

export const WELL_KNOWN_CONTACT_TAGS: readonly WellKnownContactTag[] = [
  { key: CONTACT_TAG_ZONE_USER, kind: 'system', user_editable: false },
  { key: CONTACT_TAG_ZONE_AGENT, kind: 'system', user_editable: false },
  { key: CONTACT_TAG_HOMESTATION_FOLLOWING, kind: 'app', app: 'homestation', user_editable: false },
]

/** The app namespace of an app tag (`<app>.<name>`, lowercase ASCII). */
export function contactTagApp(tag: string): string | null {
  const match = /^([a-z][a-z0-9_-]*)\.([a-z0-9_.-]+)$/.exec(tag)
  return match ? match[1] : null
}

/** `zone_user` / `zone_agent` are system tags, `<app>.<name>` app tags, anything else a user tag. */
export function contactTagKind(tag: string): ContactTagKind {
  if (tag === CONTACT_TAG_ZONE_USER || tag === CONTACT_TAG_ZONE_AGENT) return 'system'
  return contactTagApp(tag) ? 'app' : 'user'
}

export type FriendRequestDirection = 'incoming' | 'outgoing'
export type FriendRequestState = 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'expired' | 'ignored'
export type FriendRequestDecision = 'accept' | 'reject' | 'ignore'
/** How far an outgoing request got: queued for another Zone, delivered, or failed. */
export type FriendDeliveryState = 'pending' | 'delivered' | 'failed'

export interface FriendDelivery {
  state: FriendDeliveryState
  reason?: string
}

export interface FriendRequest {
  request_id: string
  peer_did: DID
  direction: FriendRequestDirection
  state: FriendRequestState
  message?: string
  msg_id?: string
  peer_name?: string
  peer_avatar?: string
  /** Outgoing requests only. */
  delivery?: FriendDelivery
  created_at_ms: number
  expires_at_ms: number
  updated_at_ms: number
}

export interface FriendRequestResult {
  friend_state: FriendState
  request?: FriendRequest
}

/** `machine.data` of a `buckyos.friend` message. */
export interface FriendMessageData {
  action: 'request' | 'accept' | 'reject' | 'cancel' | 'remove'
  request_id: string
  message?: string
  profile_hint?: { name?: string; avatar?: string }
  expires_at_ms?: number
}

export type LookupKind = 'user' | 'agent' | 'group' | 'zone' | 'device' | 'msgtunnel' | 'unknown'
/** relation: the owner's contacts and joined groups; zone: users and Agents of this Zone; resolved: the input itself. */
export type LookupSection = 'relation' | 'zone' | 'resolved'
export type LookupInputKind = 'empty' | 'text' | 'did' | 'name' | 'invite_link'
export type ReachabilityState = 'local' | 'tunnel' | 'routable' | 'unknown' | 'unreachable'
/** Why the input could not be resolved. */
export type LookupErrorCode = 'invalid-input' | 'not-found' | 'unreachable' | 'forbidden'

export interface Reachability {
  state: ReachabilityState
  zone?: string
  reason?: string
}

export interface LookupRelation {
  is_contact: boolean
  friend_state?: FriendState
  access_level?: AccessGroupLevel
  temporary_expires_at_ms?: number
  tags?: string[]
  pending_request_id?: string
  /** Group candidates: the owner's member state (`active`, `invited`, `pending_admin_approval`, ...). */
  group_state?: string
  group_role?: string
}

export interface LookupGroupInfo {
  join_policy?: string
  /** Invite token carried by the input link. */
  invite?: string
  /** Hosted by this Zone; only these can be joined for now. */
  hosted_here: boolean
  host?: string
  owner?: DID
  member_count?: number
}

export interface LookupCandidate {
  did: DID
  kind: LookupKind
  section: LookupSection
  name?: string
  avatar?: string
  note?: string
  reachability: Reachability
  relation: LookupRelation
  group?: LookupGroupInfo
}

export interface LookupResult {
  input: string
  input_kind: LookupInputKind
  candidates: LookupCandidate[]
  error?: { code: LookupErrorCode; message?: string }
}

export interface ContactLookupReq {
  input: string
  kinds?: LookupKind[]
  limit?: number
  contact_mgr_owner?: DID
}

export interface ListFriendRequestsReq {
  direction?: FriendRequestDirection
  state?: FriendRequestState
  limit?: number
  offset?: number
  contact_mgr_owner?: DID
}

/** Payload of the `/msg_center/<owner>/CONTACTS/changed` kevent. */
export interface ContactChangedEvent {
  owner: DID
  operation: 'upsert' | 'remove' | 'friend_request'
  dids?: DID[]
  request_id?: string
  updated_at_ms: number
}

export type MailboxAddress = string

export function mailboxAddress(owner: DID, sessionId?: string): MailboxAddress {
  if (!/^did:[^:]+:.+$/.test(owner) || /[\s\x00-\x1f\x7f-\x9f/\\?#*|]/.test(owner)) {
    throw new RPCError('mailbox owner must be a bare DID')
  }
  if (sessionId === undefined) return owner
  if (!sessionId || sessionId.trim() !== sessionId || [...sessionId].length > 200 || sessionId === '.' || sessionId === '..' || /[\x00-\x1f\x7f-\x9f]/.test(sessionId)) {
    throw new RPCError('invalid mailbox session_id')
  }
  const encoded = encodeURIComponent(sessionId)
    .replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%3A/g, ':').replace(/%40/g, '@')
  return `${owner}/${encoded}`
}

export function mailboxResource(mailbox: MailboxAddress, kind: MailboxKind): string {
  const encoded = encodeURIComponent(mailbox)
    .replace(/[!'()*.]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%3A/g, ':').replace(/%40/g, '@').replace(/%2F/g, '/')
  return `obj://msg-center/${kind.toLowerCase()}/${encoded}`
}

export interface GetNextParams {
  mailbox: MailboxAddress
  box_kind: MailboxKind
  state_filter?: RecipientState[]
  lock_on_take?: boolean
  with_object?: boolean
}

export interface GetNextDeliveryParams {
  transport_did: DID
  lock_on_take?: boolean
  with_object?: boolean
}

export interface PeekBoxParams {
  mailbox: MailboxAddress
  box_kind: MailboxKind
  state_filter?: RecipientState[]
  limit?: number
  with_object?: boolean
}

export interface ListBoxByTimeParams {
  mailbox: MailboxAddress
  box_kind: MailboxKind
  state_filter?: RecipientState[]
  limit?: number
  cursor_sort_key?: number
  cursor_record_id?: string
  descending?: boolean
  with_object?: boolean
}

export interface ListSessionsParams {
  owner: DID
  limit?: number
  cursor_updated_at_ms?: number
  cursor_session_id?: string
  with_object?: boolean
}

export interface ListSessionParams {
  owner: DID
  session_id: string
  limit?: number
  cursor_sort_key?: number
  cursor_record_id?: string
  descending?: boolean
  with_object?: boolean
}

export interface SetReadStateParams {
  group_id: DID
  msg_id: ObjId
  reader_did: DID
  status: ReadReceiptState
  reason?: string
  at_ms?: number
}

export interface ListReadReceiptsParams {
  msg_id: ObjId
  group_id?: DID
  reader?: DID
  limit?: number
  offset?: number
}

// System Notify (`notify.*`): mirrors buckyos-api/src/msg_notify.rs with the
// same wire field names. A `notice` is only a message; an `input` also owns
// a TaskMgr HumanSet task whose result is the answer.

export const NOTIFY_INTENT = 'buckyos.notify'
/** Written into an Agent's own INBOX when its notification also reached one of its conversations. */
export const NOTIFY_DELIVERED_INTENT = 'buckyos.notify.delivered'
export const NOTIFY_DATA_VERSION = 1
/** Owner-local sessions of a user that hold the notifications by category. */
export const NOTIFY_SESSION_PREFIX = 'sysnotify:'
export const NOTIFY_CHOICE_CONTROL_ID = 'option'
export const NOTIFY_TEXT_CONTROL_ID = 'text'
export const NOTIFY_ACTION_ANSWER = 'answer'
export const NOTIFY_ACTION_DISMISS = 'dismiss'
/** Path of the MessageHub card of a notification: `<path>?notify=<id>`. */
export const NOTIFY_LINK_PATH = '/messagehub'

export type NotifyKind = 'notice' | 'input'
/** Derived by msg-center from the caller; only system services may name one. */
export type NotifyCategory = 'todo' | 'agent' | 'app'
export type NotifyLevel = 'quiet' | 'normal' | 'timely' | 'urgent'
export type NotifyStatus = 'open' | 'read' | 'answered' | 'dismissed' | 'expired' | 'canceled'

/** Nothing can change any more (everything but `open` and `read`). */
export function isNotifyClosed(status: NotifyStatus): boolean {
  return status !== 'open' && status !== 'read'
}

export function notifyCategorySessionId(category: NotifyCategory): string {
  return `${NOTIFY_SESSION_PREFIX}${category}`
}

export function notifyCategoryFromSessionId(sessionId: string): NotifyCategory | null {
  if (!sessionId.startsWith(NOTIFY_SESSION_PREFIX)) return null
  const category = sessionId.slice(NOTIFY_SESSION_PREFIX.length)
  return category === 'todo' || category === 'agent' || category === 'app' ? category : null
}

/** A conversation of the user with the source. */
export interface NotifyConversation {
  /** The user's endpoint (DID or tunnel endpoint DID). */
  to: string
  to_session?: string
}

export interface NotifySource {
  /** Filled by msg-center from the caller's identity. */
  app_id?: string
  /** Filled by msg-center when the caller is an Agent. */
  agent_did?: string
  session_id?: string
  turn?: number
  call_id?: string
  goal_id?: string
  /** One sentence: what this is for. */
  operation?: string
  /** A page of the App about this matter. */
  link?: string
  conversation?: NotifyConversation
}

export interface NotifySendReq {
  /** Zone user id of the recipient. */
  to_user: string
  kind: NotifyKind
  level?: NotifyLevel
  category?: NotifyCategory
  prompt: HumanTaskPrompt
  source?: NotifySource
  expires_at_ms?: number
  /** Same caller + same key → the same notification, delivered once. */
  idempotency_key: string
}

/** One mailbox record of a notification. */
export interface NotifyRecordRef {
  owner: string
  session_id: string
  record_id: string
  msg_id: string
  from: string
}

/** A copy of an Agent's notification in one of its conversations with the user. */
export interface NotifyDelivery {
  session_id: string
  /** `native` or the tunnel platform. */
  platform: string
  to: string
  to_session?: string
  msg_id?: string
  ok: boolean
  reason?: string
}

/** What the user (or someone on their behalf) submitted for an `input`. */
export interface NotifyResult {
  /** `answer` or `dismiss`. */
  action: string
  /** `option` and / or `text`. */
  values?: Record<string, unknown>
  submitted_by?: string
  submitted_at?: number
  /** `<user>|<app>` that committed it, from TaskMgr. */
  committed_by?: string
}

export interface NotifyView {
  notify_id: string
  /** `https://<zone host>/messagehub?notify=<id>`, or the bare path. */
  url: string
  to_user: string
  kind: NotifyKind
  category: NotifyCategory
  level: NotifyLevel
  status: NotifyStatus
  prompt: HumanTaskPrompt
  source: NotifySource
  created_at_ms: number
  expires_at_ms?: number
  closed_at_ms?: number
  closed_reason?: string
  /** Who acknowledged a `notice` on the user's behalf, when not the user. */
  acked_by?: string
  task_id?: string
  result?: NotifyResult
  /** The record in the user's notification session. */
  home?: NotifyRecordRef
  deliveries?: NotifyDelivery[]
}

export interface NotifyListReq {
  status?: NotifyStatus[]
  kind?: NotifyKind
  category?: NotifyCategory
  agent_did?: string
  app_id?: string
  session_id?: string
  goal_id?: string
  since_ms?: number
  /** Only system services may name someone else than the caller. */
  to_user?: string
  cursor?: string
  limit?: number
}

export interface NotifyListResult {
  items: NotifyView[]
  next_cursor?: string
}

/** `content.machine.data` of a notification message (intent `buckyos.notify`). */
export interface NotifyMessageData {
  version: number
  notify_id: string
  kind: NotifyKind
  category: NotifyCategory
  level: NotifyLevel
  /** `true` for the record in the user's notification session, `false` for a copy. */
  home: boolean
  source: NotifySource
  prompt: HumanTaskPrompt
  task_id?: string
  url: string
  expires_at_ms?: number
}

/** `content.machine.data` of the record (intent `buckyos.notify.delivered`) in an Agent's own INBOX. */
export interface NotifyDeliveredData {
  notify_id: string
  url: string
  kind: NotifyKind
  category: NotifyCategory
  level: NotifyLevel
  title: string
  message?: string
  options?: HumanPromptOption[]
  source: NotifySource
  delivered_msg_id?: string
  reply_route: NotifyConversation
  at_ms: number
}

/** The answer to an `input`, or what to do with a `notice`. */
export interface NotifyAnswer {
  /** `true`: dismiss instead of answering. */
  dismiss?: boolean
  option?: string
  text?: string
}

function compact<T extends Record<string, unknown>>(input: T): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      out[key] = value
    }
  }
  return out
}

function asRecord(value: unknown, what: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RPCError(`expected ${what} to be an object`)
  }
  return value as JsonObject
}

function asOptionalRecord<T>(value: unknown, what: string): T | null {
  return value == null ? null : asRecord(value, what) as unknown as T
}

function asArrayOf<T>(value: unknown, what: string): T[] {
  if (!Array.isArray(value)) {
    throw new RPCError(`expected ${what} to be an array`)
  }
  return value as T[]
}

function asDid(value: unknown, method: string): DID {
  if (typeof value !== 'string') {
    throw new RPCError(`${method} expected to return a DID string`)
  }
  return value
}

function asOptionalDid(value: unknown, method: string): DID | null {
  return value == null ? null : asDid(value, method)
}

function asNotifyView(value: unknown): NotifyView {
  const view = asRecord(value, 'NotifyView')
  if (typeof view.notify_id !== 'string' || typeof view.status !== 'string') {
    throw new RPCError('Invalid NotifyView')
  }
  return view as unknown as NotifyView
}

export class MsgCenterClient {
  private rpcClient: kRPCClient

  constructor(rpcClient: kRPCClient) {
    this.rpcClient = rpcClient
  }

  setSeq(seq: number) {
    this.rpcClient.setSeq(seq)
  }

  private call(method: string, params: Record<string, unknown>): Promise<unknown> {
    return this.rpcClient.call<unknown, Record<string, unknown>>(method, params)
  }

  async dispatch(
    msg: MsgObject,
    ingressCtx?: IngressContext,
    idempotencyKey?: string,
  ): Promise<DispatchResult> {
    const result = await this.call('msg.dispatch', compact({
      msg,
      ingress_ctx: ingressCtx,
      idempotency_key: idempotencyKey,
    }))
    return asRecord(result, 'DispatchResult') as unknown as DispatchResult
  }

  async postSend(msg: MsgObject, idempotencyKey?: string): Promise<PostSendResult> {
    const result = await this.call('msg.post_send', compact({
      msg,
      idempotency_key: idempotencyKey,
    }))
    return asRecord(result, 'PostSendResult') as unknown as PostSendResult
  }

  async listMailboxes(owner: DID, boxKind: MailboxKind): Promise<MailboxAddress[]> {
    return asArrayOf<MailboxAddress>(await this.call('msg.list_mailboxes', { owner, box_kind: boxKind }), 'Vec<MailboxAddress>')
  }

  async moveRecord(recordId: string, mailbox: MailboxAddress): Promise<MailboxRecord> {
    return asRecord(await this.call('msg.move_record', { record_id: recordId, mailbox }), 'MailboxRecord') as unknown as MailboxRecord
  }

  async getNext(req: GetNextParams): Promise<MailboxRecordWithObject | null> {
    const result = await this.call('msg.get_next', compact({ ...req }))
    return asOptionalRecord<MailboxRecordWithObject>(result, 'MailboxRecordWithObject')
  }

  async getNextDelivery(req: GetNextDeliveryParams): Promise<DeliveryRecordWithObject | null> {
    const result = await this.call('msg.get_next_delivery', compact({ ...req }))
    return asOptionalRecord<DeliveryRecordWithObject>(result, 'DeliveryRecordWithObject')
  }

  async peekBox(req: PeekBoxParams): Promise<MailboxRecordWithObject[]> {
    const result = await this.call('msg.peek_box', compact({ ...req }))
    return asArrayOf<MailboxRecordWithObject>(result, 'Vec<MailboxRecordWithObject>')
  }

  async listBoxByTime(req: ListBoxByTimeParams): Promise<MailboxRecordPage> {
    const result = await this.call('msg.list_box_by_time', compact({ ...req }))
    const page = asRecord(result, 'MailboxRecordPage')
    return {
      ...page,
      items: Array.isArray(page.items) ? page.items as MailboxRecordWithObject[] : [],
    } as unknown as MailboxRecordPage
  }

  async listSessions(req: ListSessionsParams): Promise<SessionSummaryPage> {
    const result = await this.call('msg.list_sessions', compact({ ...req }))
    const page = asRecord(result, 'SessionSummaryPage')
    return {
      ...page,
      items: Array.isArray(page.items) ? page.items as SessionSummary[] : [],
    } as unknown as SessionSummaryPage
  }

  async listSession(req: ListSessionParams): Promise<SessionMessagePage> {
    const result = await this.call('msg.list_session', compact({ ...req }))
    const page = asRecord(result, 'SessionMessagePage')
    return {
      ...page,
      items: Array.isArray(page.items) ? page.items as SessionMessageItem[] : [],
    } as unknown as SessionMessagePage
  }

  async updateRecordState(recordId: string, newState: RecipientState): Promise<MailboxRecord> {
    const result = await this.call('msg.update_record_state', {
      record_id: recordId,
      new_state: newState,
    })
    return asRecord(result, 'MailboxRecord') as unknown as MailboxRecord
  }

  async updateRecordSession(recordId: string, sessionId: string): Promise<MailboxRecord> {
    const result = await this.call('msg.update_record_session', {
      record_id: recordId,
      session_id: sessionId,
    })
    return asRecord(result, 'MailboxRecord') as unknown as MailboxRecord
  }

  async reportDelivery(deliveryId: string, result: DeliveryReportResult): Promise<DeliveryRecord> {
    const response = await this.call('msg.report_delivery', {
      delivery_id: deliveryId,
      result,
    })
    return asRecord(response, 'DeliveryRecord') as unknown as DeliveryRecord
  }

  async setReadState(req: SetReadStateParams): Promise<MsgReceiptObj> {
    const result = await this.call('msg.set_read_state', compact({ ...req }))
    return asRecord(result, 'MsgReceiptObj') as unknown as MsgReceiptObj
  }

  async listReadReceipts(req: ListReadReceiptsParams): Promise<MsgReceiptObj[]> {
    const result = await this.call('msg.list_read_receipts', compact({ ...req }))
    return asArrayOf<MsgReceiptObj>(result, 'Vec<MsgReceiptObj>')
  }

  async getRecord(recordId: string, withObject?: boolean): Promise<MailboxRecordWithObject | null> {
    const result = await this.call('msg.get_record', compact({
      record_id: recordId,
      with_object: withObject,
    }))
    return asOptionalRecord<MailboxRecordWithObject>(result, 'MailboxRecordWithObject')
  }

  async getMessage(msgId: ObjId): Promise<MsgObject | null> {
    const result = await this.call('msg.get_message', { msg_id: msgId })
    return asOptionalRecord<MsgObject>(result, 'MsgObject')
  }

  async updateUiSessionState(
    sessionId: string,
    key: string,
    value: unknown,
  ): Promise<UiSessionStateEntry> {
    const result = await this.call('ui_session.update_state', {
      session_id: sessionId,
      key,
      value,
    })
    return asRecord(result, 'UiSessionStateEntry') as unknown as UiSessionStateEntry
  }

  async getUiSessionState(sessionId: string, key: string): Promise<UiSessionStateEntry | null> {
    const result = await this.call('ui_session.get_state', { session_id: sessionId, key })
    return asOptionalRecord<UiSessionStateEntry>(result, 'UiSessionStateEntry')
  }

  async listUiSessionState(sessionId: string): Promise<UiSessionStateEntry[]> {
    const result = await this.call('ui_session.list_state', { session_id: sessionId })
    return asArrayOf<UiSessionStateEntry>(result, 'Vec<UiSessionStateEntry>')
  }

  async resolveDid(
    platform: string,
    accountId: string,
    profileHint?: unknown,
    contactMgrOwner?: DID,
  ): Promise<DID> {
    const result = await this.call('contact.resolve_did', compact({
      platform,
      account_id: accountId,
      profile_hint: profileHint,
      contact_mgr_owner: contactMgrOwner,
    }))
    return asDid(result, 'contact.resolve_did')
  }

  async resolveEndpointDid(
    platform: string,
    accountId: string,
    accountType: string,
    tunnelInstanceId: string,
    contactMgrOwner?: DID,
  ): Promise<DID> {
    const result = await this.call('contact.resolve_endpoint_did', compact({
      platform,
      account_id: accountId,
      account_type: accountType,
      tunnel_instance_id: tunnelInstanceId,
      contact_mgr_owner: contactMgrOwner,
    }))
    return asDid(result, 'contact.resolve_endpoint_did')
  }

  async resolveTarget(
    contactDid: DID,
    selector: string,
    contactMgrOwner?: DID,
  ): Promise<DID> {
    const result = await this.call('contact.resolve_target', compact({
      contact_did: contactDid,
      selector,
      contact_mgr_owner: contactMgrOwner,
    }))
    return asDid(result, 'contact.resolve_target')
  }

  async resolveContactForEndpoint(
    endpointDid: DID,
    contactMgrOwner?: DID,
  ): Promise<DID | null> {
    const result = await this.call('contact.resolve_contact_for_endpoint', compact({
      endpoint_did: endpointDid,
      contact_mgr_owner: contactMgrOwner,
    }))
    return asOptionalDid(result, 'contact.resolve_contact_for_endpoint')
  }

  async resolveCanonicalDid(did: DID, contactMgrOwner?: DID): Promise<DID> {
    const result = await this.call('contact.resolve_canonical_did', compact({
      did,
      contact_mgr_owner: contactMgrOwner,
    }))
    return asDid(result, 'contact.resolve_canonical_did')
  }

  async listAliasDids(canonicalDid: DID, contactMgrOwner?: DID): Promise<DID[]> {
    const result = await this.call('contact.list_alias_dids', compact({
      canonical_did: canonicalDid,
      contact_mgr_owner: contactMgrOwner,
    }))
    return asArrayOf<DID>(result, 'Vec<DID>')
  }

  async getPreferredBinding(did: DID, contactMgrOwner?: DID): Promise<AccountBinding> {
    const result = await this.call('contact.get_preferred_binding', compact({
      did,
      contact_mgr_owner: contactMgrOwner,
    }))
    return asRecord(result, 'AccountBinding') as unknown as AccountBinding
  }

  async checkAccessPermission(
    did: DID,
    contextId?: string,
    contactMgrOwner?: DID,
  ): Promise<AccessDecision> {
    const result = await this.call('contact.check_access_permission', compact({
      did,
      context_id: contextId,
      contact_mgr_owner: contactMgrOwner,
    }))
    return asRecord(result, 'AccessDecision') as unknown as AccessDecision
  }

  async grantTemporaryAccess(
    dids: DID[],
    contextId: string,
    durationSecs: number,
    contactMgrOwner?: DID,
  ): Promise<GrantTemporaryAccessResult> {
    const result = await this.call('contact.grant_temporary_access', compact({
      dids,
      context_id: contextId,
      duration_secs: durationSecs,
      contact_mgr_owner: contactMgrOwner,
    }))
    const response = asRecord(result, 'GrantTemporaryAccessResult')
    return {
      updated: Array.isArray(response.updated)
        ? response.updated as TemporaryGrantOutcome[]
        : [],
    }
  }

  async blockContact(did: DID, reason?: string, contactMgrOwner?: DID): Promise<void> {
    await this.call('contact.block_contact', compact({
      did,
      reason,
      contact_mgr_owner: contactMgrOwner,
    }))
  }

  async importContacts(
    contacts: ImportContactEntry[],
    upgradeToFriend?: boolean,
    contactMgrOwner?: DID,
  ): Promise<ImportReport> {
    const result = await this.call('contact.import_contacts', compact({
      contacts,
      upgrade_to_friend: upgradeToFriend,
      contact_mgr_owner: contactMgrOwner,
    }))
    return asRecord(result, 'ImportReport') as unknown as ImportReport
  }

  async mergeContacts(targetDid: DID, sourceDid: DID, contactMgrOwner?: DID): Promise<Contact> {
    const result = await this.call('contact.merge_contacts', compact({
      target_did: targetDid,
      source_did: sourceDid,
      contact_mgr_owner: contactMgrOwner,
    }))
    return asRecord(result, 'Contact') as unknown as Contact
  }

  async updateContact(did: DID, patch: ContactPatch, contactMgrOwner?: DID): Promise<Contact> {
    const result = await this.call('contact.update_contact', compact({
      did,
      patch,
      contact_mgr_owner: contactMgrOwner,
    }))
    return asRecord(result, 'Contact') as unknown as Contact
  }

  async getContact(did: DID, contactMgrOwner?: DID): Promise<Contact | null> {
    const result = await this.call('contact.get_contact', compact({
      did,
      contact_mgr_owner: contactMgrOwner,
    }))
    return asOptionalRecord<Contact>(result, 'Contact')
  }

  async listContacts(query: ContactQuery, contactMgrOwner?: DID): Promise<Contact[]> {
    const result = await this.call('contact.list_contacts', compact({
      query,
      contact_mgr_owner: contactMgrOwner,
    }))
    return asArrayOf<Contact>(result, 'Vec<Contact>')
  }

  async getGroupSubscribers(
    groupId: DID,
    limit?: number,
    offset?: number,
    contactMgrOwner?: DID,
  ): Promise<DID[]> {
    const result = await this.call('contact.get_group_subscribers', compact({
      group_id: groupId,
      limit,
      offset,
      contact_mgr_owner: contactMgrOwner,
    }))
    return asArrayOf<DID>(result, 'Vec<DID>')
  }

  async setGroupSubscribers(
    groupId: DID,
    subscribers: DID[],
    contactMgrOwner?: DID,
  ): Promise<SetGroupSubscribersResult> {
    const result = await this.call('contact.set_group_subscribers', compact({
      group_id: groupId,
      subscribers,
      contact_mgr_owner: contactMgrOwner,
    }))
    const record = asRecord(result, 'SetGroupSubscribersResult')
    if (typeof record.group_id !== 'string' || typeof record.subscriber_count !== 'number') {
      throw new RPCError('Invalid SetGroupSubscribersResult')
    }
    return {
      group_id: record.group_id,
      subscriber_count: record.subscriber_count,
    }
  }

  /** Find people and groups for raw input: name, DID, BNS name or group invite link. */
  async lookup(req: ContactLookupReq): Promise<LookupResult> {
    const result = asRecord(await this.call('contact.lookup', compact({ ...req })), 'LookupResult')
    return {
      ...(result as unknown as LookupResult),
      candidates: Array.isArray(result.candidates) ? result.candidates as LookupCandidate[] : [],
    }
  }

  /** Add / remove tags; a user may only change user tags, an app only its own namespace. */
  async updateContactTags(
    did: DID,
    change: { add?: string[]; remove?: string[] },
    contactMgrOwner?: DID,
  ): Promise<Contact> {
    const result = await this.call('contact.update_tags', compact({
      did,
      add: change.add,
      remove: change.remove,
      contact_mgr_owner: contactMgrOwner,
    }))
    return asRecord(result, 'Contact') as unknown as Contact
  }

  /** Delete the contact record (history stays); relations the system established are refused. */
  async removeContact(did: DID, contactMgrOwner?: DID): Promise<void> {
    await this.call('contact.remove_contact', compact({ did, contact_mgr_owner: contactMgrOwner }))
  }

  async unblockContact(did: DID, contactMgrOwner?: DID): Promise<Contact> {
    const result = await this.call('contact.unblock_contact', compact({ did, contact_mgr_owner: contactMgrOwner }))
    return asRecord(result, 'Contact') as unknown as Contact
  }

  async sendFriendRequest(did: DID, message?: string, contactMgrOwner?: DID): Promise<FriendRequestResult> {
    const result = await this.call('contact.send_friend_request', compact({
      did,
      message,
      contact_mgr_owner: contactMgrOwner,
    }))
    return asRecord(result, 'FriendRequestResult') as unknown as FriendRequestResult
  }

  async respondFriendRequest(
    requestId: string,
    decision: FriendRequestDecision,
    contactMgrOwner?: DID,
  ): Promise<FriendRequestResult> {
    const result = await this.call('contact.respond_friend_request', compact({
      request_id: requestId,
      decision,
      contact_mgr_owner: contactMgrOwner,
    }))
    return asRecord(result, 'FriendRequestResult') as unknown as FriendRequestResult
  }

  async cancelFriendRequest(requestId: string, contactMgrOwner?: DID): Promise<FriendRequestResult> {
    const result = await this.call('contact.cancel_friend_request', compact({
      request_id: requestId,
      contact_mgr_owner: contactMgrOwner,
    }))
    return asRecord(result, 'FriendRequestResult') as unknown as FriendRequestResult
  }

  /** End the friendship; `notify` (default true) tells the peer. */
  async removeFriend(did: DID, notify?: boolean, contactMgrOwner?: DID): Promise<FriendRequestResult> {
    const result = await this.call('contact.remove_friend', compact({
      did,
      notify,
      contact_mgr_owner: contactMgrOwner,
    }))
    return asRecord(result, 'FriendRequestResult') as unknown as FriendRequestResult
  }

  async listFriendRequests(req: ListFriendRequestsReq = {}): Promise<FriendRequest[]> {
    const result = asOptionalRecord<{ items?: FriendRequest[] }>(
      await this.call('contact.list_friend_requests', compact({ ...req })),
      'FriendRequestPage',
    )
    return result && Array.isArray(result.items) ? result.items : []
  }

  /** Notify a zone user (System Notify). */
  async notifySend(req: NotifySendReq): Promise<NotifyView> {
    return asNotifyView(await this.call('notify.send', compact({ ...req })))
  }

  async notifyGet(notifyId: string): Promise<NotifyView> {
    return asNotifyView(await this.call('notify.get', { notify_id: notifyId }))
  }

  async notifyList(req: NotifyListReq = {}): Promise<NotifyListResult> {
    const result = asRecord(await this.call('notify.list', compact({ ...req })), 'NotifyListResult')
    return {
      ...result,
      items: asArrayOf<unknown>(result.items, 'Vec<NotifyView>').map(asNotifyView),
    } as NotifyListResult
  }

  /** Mark a `notice` read; `onBehalf` names who acknowledges for the user. */
  async notifyAck(notifyId: string, onBehalf?: string): Promise<NotifyView> {
    return asNotifyView(await this.call('notify.ack', compact({ notify_id: notifyId, on_behalf: onBehalf })))
  }

  async notifyDismiss(notifyId: string): Promise<NotifyView> {
    return asNotifyView(await this.call('notify.dismiss', { notify_id: notifyId }))
  }

  async notifyCancel(notifyId: string, reason?: string): Promise<NotifyView> {
    return asNotifyView(await this.call('notify.cancel', compact({ notify_id: notifyId, reason })))
  }
}

/**
 * The prompt of an `input`: a required `option` choice when there are
 * options, a `text` input when there are none or free text is allowed.
 */
export function inputPrompt(
  title: string,
  message: string,
  options: HumanPromptOption[],
  allowText: boolean = false,
): HumanTaskPrompt {
  const controls: HumanPromptControl[] = []
  const hasOptions = options.length > 0
  if (hasOptions) {
    controls.push({
      kind: 'choice',
      id: NOTIFY_CHOICE_CONTROL_ID,
      options,
      multiple: false,
      required: !allowText,
    })
  }
  if (!hasOptions || allowText) {
    controls.push({
      kind: 'text_input',
      id: NOTIFY_TEXT_CONTROL_ID,
      multiline: true,
      required: !hasOptions,
    })
  }
  return message ? { title, message, controls } : { title, controls }
}

/** The options of a prompt's `option` choice. */
export function promptOptions(prompt: HumanTaskPrompt): HumanPromptOption[] {
  for (const control of prompt.controls ?? []) {
    if (control.kind === 'choice' && control.id === NOTIFY_CHOICE_CONTROL_ID) {
      return control.options ?? []
    }
  }
  return []
}

/** The task result of an answer (`TaskDataResult` `human`). */
export function notifyAnswerToTaskResult(
  answer: NotifyAnswer,
  submittedBy: string,
  submittedAtMs: number,
): TaskDataResult {
  const values: Record<string, unknown> = {}
  if (answer.option) {
    values[NOTIFY_CHOICE_CONTROL_ID] = answer.option
  }
  if (answer.text && answer.text.trim()) {
    values[NOTIFY_TEXT_CONTROL_ID] = answer.text
  }
  return {
    kind: 'human',
    action: answer.dismiss ? NOTIFY_ACTION_DISMISS : NOTIFY_ACTION_ANSWER,
    ...(Object.keys(values).length > 0 ? { values } : {}),
    submitted_by: submittedBy,
    submitted_at: submittedAtMs,
  }
}

/** Checks an answer against the prompt of an `input`; returns the error, or null. */
export function validateNotifyAnswer(answer: NotifyAnswer, prompt: HumanTaskPrompt): string | null {
  if (answer.dismiss) {
    return null
  }
  const options = promptOptions(prompt)
  const acceptsText = (prompt.controls ?? []).some(
    (control) => control.kind === 'text_input' && control.id === NOTIFY_TEXT_CONTROL_ID,
  )
  if (answer.option != null && !options.some((option) => option.value === answer.option)) {
    return `no option '${answer.option}'; options: ${options.map((option) => option.value).join(', ')}`
  }
  const hasText = !!answer.text && answer.text.trim() !== ''
  if (hasText && !acceptsText) {
    return 'this question takes one of its options, not free text'
  }
  if (answer.option == null && !hasText) {
    return 'an answer needs an option or a text'
  }
  return null
}

/** `/messagehub?notify=<id>` under `https://<host>` when the host is known. */
export function notifyUrl(zoneHost: string | null | undefined, notifyId: string): string {
  const path = `${NOTIFY_LINK_PATH}?notify=${notifyId}`
  const host = zoneHost?.trim()
  return host ? `https://${host}${path}` : path
}

/** The `content.machine.data` of a message, when it carries `intent`. */
export function msgMachineData<T = JsonObject>(msg: MsgObject | null | undefined, intent: string): T | null {
  const content = msg?.content
  if (!content || typeof content !== 'object') return null
  const machine = (content as JsonObject).machine
  if (!machine || typeof machine !== 'object' || (machine as JsonObject).intent !== intent) return null
  const data = (machine as JsonObject).data
  return data && typeof data === 'object' && !Array.isArray(data) ? data as T : null
}

/** The notification data of a message, when it is one. */
export function notifyMessageData(msg: MsgObject | null | undefined): NotifyMessageData | null {
  const data = msgMachineData<NotifyMessageData>(msg, NOTIFY_INTENT)
  return data && typeof data.notify_id === 'string' ? data : null
}

/** The TaskMgr side of answering an `input` (a `TaskManagerClient` fits). */
export interface NotifyTaskAccess {
  getTask(taskId: string): Promise<Task>
  commitResult(req: CommitResultReq): Promise<Task>
}

/** How an attempt to answer ended: this answer is the result, or the task was already closed (by someone else's answer, a cancel or expiry). */
export type NotifyCommit =
  | { kind: 'committed'; task: Task }
  | { kind: 'already_closed'; task: Task }

/**
 * Commit `answer` to the task of an `input`: read the latest snapshot and
 * write with `expected_revision`; a lost race re-reads so the caller sees
 * the final state.
 */
export async function commitNotifyAnswer(
  tasks: NotifyTaskAccess,
  taskId: string,
  answer: NotifyAnswer,
  submittedBy: string,
  nowMs: number = Date.now(),
): Promise<NotifyCommit> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const task = await tasks.getTask(taskId)
    if (isTerminalTaskPhase(task.phase) || task.result != null) {
      return { kind: 'already_closed', task }
    }
    try {
      const committed = await tasks.commitResult({
        task_id: taskId,
        result: notifyAnswerToTaskResult(answer, submittedBy, nowMs),
        expected_revision: task.revision,
      })
      return { kind: 'committed', task: committed }
    } catch (error) {
      const code = taskMgrErrorCode(error)
      if (code === TASK_ERR_ALREADY_COMPLETED) {
        return { kind: 'already_closed', task: await tasks.getTask(taskId) }
      }
      if (code !== TASK_ERR_REVISION_CONFLICT) {
        throw error
      }
    }
  }
  const task = await tasks.getTask(taskId)
  if (isTerminalTaskPhase(task.phase)) {
    return { kind: 'already_closed', task }
  }
  throw new RPCError(`task ${taskId} keeps changing; answer not committed`)
}

/**
 * Answer an `input` (or dismiss it); for a `notice` acknowledge or dismiss
 * it. Returns the final view: when someone else answered first, theirs.
 * `submittedBy` defaults to the notification's user.
 */
export async function answerNotify(
  msgCenter: Pick<MsgCenterClient, 'notifyGet' | 'notifyAck' | 'notifyDismiss'>,
  taskMgr: NotifyTaskAccess,
  notifyId: string,
  answer: NotifyAnswer,
  submittedBy?: string,
): Promise<NotifyView> {
  const view = await msgCenter.notifyGet(notifyId)
  if (view.kind === 'notice') {
    return answer.dismiss ? msgCenter.notifyDismiss(notifyId) : msgCenter.notifyAck(notifyId)
  }
  if (!view.task_id) {
    throw new RPCError(`notification ${notifyId} has no task`)
  }
  if (isNotifyClosed(view.status)) {
    return view
  }
  const invalid = validateNotifyAnswer(answer, view.prompt)
  if (invalid) {
    throw new RPCError(invalid)
  }
  await commitNotifyAnswer(taskMgr, view.task_id, answer, submittedBy ?? view.to_user)
  return msgCenter.notifyGet(notifyId)
}

export interface WaitNotifyOptions {
  /**
   * When given, `/task_mgr/<task_id>` events of an `input` wake the wait
   * early; without it (or if the reader cannot be opened) it only polls.
   */
  kevent?: Pick<KEventClient, 'createEventReader'> | null
}

const NOTIFY_WAIT_FIRST_INTERVAL_MS = 500
const NOTIFY_WAIT_MAX_INTERVAL_MS = 30_000

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Wait at most `ms`; an event on `reader` ends the wait early. */
async function pauseNotifyWait(ms: number, reader: KEventReader | null): Promise<void> {
  const startedAt = Date.now()
  if (reader) {
    try {
      if (await reader.pullEvent(ms)) {
        return
      }
    } catch {
      // A broken reader falls back to sleeping.
    }
  }
  const left = ms - (Date.now() - startedAt)
  if (left > 0) {
    await sleepMs(left)
  }
}

/**
 * Wait until the notification is closed or `deadlineMs` (epoch ms) passes;
 * returns the last view either way. Polls `notify.get` every 0.5 s, doubling
 * up to 30 s, never past the deadline.
 */
export async function waitNotify(
  msgCenter: Pick<MsgCenterClient, 'notifyGet'>,
  notifyId: string,
  deadlineMs: number,
  opts: WaitNotifyOptions = {},
): Promise<NotifyView> {
  let view = await msgCenter.notifyGet(notifyId)
  let reader: KEventReader | null = null
  let finished = false
  if (opts.kevent && view.task_id && !isNotifyClosed(view.status)) {
    // Opened in the background so a slow event stream never delays polling.
    opts.kevent.createEventReader([taskMgrTaskEventPath(view.task_id)]).then(
      (opened) => {
        if (finished) {
          opened.close().catch(() => undefined)
        } else {
          reader = opened
        }
      },
      () => undefined,
    )
  }
  try {
    let interval = NOTIFY_WAIT_FIRST_INTERVAL_MS
    for (;;) {
      if (isNotifyClosed(view.status)) {
        return view
      }
      const now = Date.now()
      if (now >= deadlineMs) {
        return view
      }
      await pauseNotifyWait(Math.min(interval, deadlineMs - now), reader)
      interval = Math.min(interval * 2, NOTIFY_WAIT_MAX_INTERVAL_MS)
      view = await msgCenter.notifyGet(notifyId)
    }
  } finally {
    finished = true
    const opened = reader as KEventReader | null
    if (opened) {
      await opened.close().catch(() => undefined)
    }
  }
}
