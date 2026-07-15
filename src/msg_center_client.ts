import { kRPCClient, RPCError } from './krpc_client'

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
export type AccessGroupLevel = 'block' | 'stranger' | 'temporary' | 'friend'
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
  groups?: string[]
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
  groups?: string[]
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
  groups?: string[]
  tags?: string[]
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
  keyword?: string
  limit?: number
  offset?: number
}

export interface SetGroupSubscribersResult {
  group_id: DID
  subscriber_count: number
}

export type GroupCreateReq = JsonObject
export type GroupGetDocReq = JsonObject
export type GroupUpdateProfileReq = JsonObject
export type GroupInviteMemberReq = JsonObject
export type GroupSubmitMemberProofReq = JsonObject
export type GroupRequestJoinReq = JsonObject
export type GroupApproveMemberReq = JsonObject
export type GroupRejectMemberReq = JsonObject
export type GroupRemoveMemberReq = JsonObject
export type GroupUpdateMemberRoleReq = JsonObject
export type GroupListMembersReq = JsonObject
export type GroupCreateSubgroupReq = JsonObject
export type GroupUpdateSubgroupReq = JsonObject
export type GroupListSubgroupsReq = JsonObject
export type GroupUpdateCollectionPolicyReq = JsonObject
export type GroupUpdateAttributionPolicyReq = JsonObject
export type GroupExpandMembersReq = JsonObject
export type GroupListByMemberReq = JsonObject
export type GroupListParentsReq = JsonObject
export type GroupCheckAccessReq = JsonObject
export type GroupDoc = JsonObject
export type GroupMemberRecord = JsonObject
export type GroupSubgroup = JsonObject
export type GroupExpansionSnapshot = JsonObject
export type GroupSummary = JsonObject
export type GroupAccessDecision = JsonObject

export interface GetNextParams {
  owner: DID
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
  owner: DID
  box_kind: MailboxKind
  state_filter?: RecipientState[]
  limit?: number
  with_object?: boolean
}

export interface ListBoxByTimeParams {
  owner: DID
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

  async groupCreate(req: GroupCreateReq): Promise<GroupDoc> {
    return asRecord(await this.call('group.create', req), 'GroupDoc')
  }

  async groupGetDoc(req: GroupGetDocReq): Promise<GroupDoc | null> {
    return asOptionalRecord<GroupDoc>(await this.call('group.get_doc', req), 'GroupDoc')
  }

  async groupUpdateProfile(req: GroupUpdateProfileReq): Promise<GroupDoc> {
    return asRecord(await this.call('group.update_profile', req), 'GroupDoc')
  }

  async groupInviteMember(req: GroupInviteMemberReq): Promise<GroupMemberRecord> {
    return asRecord(await this.call('group.invite_member', req), 'GroupMemberRecord')
  }

  async groupSubmitMemberProof(req: GroupSubmitMemberProofReq): Promise<GroupMemberRecord> {
    return asRecord(await this.call('group.submit_member_proof', req), 'GroupMemberRecord')
  }

  async groupRequestJoin(req: GroupRequestJoinReq): Promise<GroupMemberRecord> {
    return asRecord(await this.call('group.request_join', req), 'GroupMemberRecord')
  }

  async groupApproveMember(req: GroupApproveMemberReq): Promise<GroupMemberRecord> {
    return asRecord(await this.call('group.approve_member', req), 'GroupMemberRecord')
  }

  async groupRejectMember(req: GroupRejectMemberReq): Promise<GroupMemberRecord> {
    return asRecord(await this.call('group.reject_member', req), 'GroupMemberRecord')
  }

  async groupRemoveMember(req: GroupRemoveMemberReq): Promise<GroupMemberRecord> {
    return asRecord(await this.call('group.remove_member', req), 'GroupMemberRecord')
  }

  async groupUpdateMemberRole(req: GroupUpdateMemberRoleReq): Promise<GroupMemberRecord> {
    return asRecord(await this.call('group.update_member_role', req), 'GroupMemberRecord')
  }

  async groupListMembers(req: GroupListMembersReq): Promise<GroupMemberRecord[]> {
    return asArrayOf<GroupMemberRecord>(await this.call('group.list_members', req), 'Vec<GroupMemberRecord>')
  }

  async groupCreateSubgroup(req: GroupCreateSubgroupReq): Promise<GroupSubgroup> {
    return asRecord(await this.call('group.create_subgroup', req), 'GroupSubgroup')
  }

  async groupUpdateSubgroup(req: GroupUpdateSubgroupReq): Promise<GroupSubgroup> {
    return asRecord(await this.call('group.update_subgroup', req), 'GroupSubgroup')
  }

  async groupListSubgroups(req: GroupListSubgroupsReq): Promise<GroupSubgroup[]> {
    return asArrayOf<GroupSubgroup>(await this.call('group.list_subgroups', req), 'Vec<GroupSubgroup>')
  }

  async groupUpdateCollectionPolicy(req: GroupUpdateCollectionPolicyReq): Promise<GroupDoc> {
    return asRecord(await this.call('group.update_collection_policy', req), 'GroupDoc')
  }

  async groupUpdateAttributionPolicy(req: GroupUpdateAttributionPolicyReq): Promise<GroupDoc> {
    return asRecord(await this.call('group.update_attribution_policy', req), 'GroupDoc')
  }

  async groupExpandMembers(req: GroupExpandMembersReq): Promise<GroupExpansionSnapshot> {
    return asRecord(await this.call('group.expand_members', req), 'GroupExpansionSnapshot')
  }

  async groupListByMember(req: GroupListByMemberReq): Promise<GroupSummary[]> {
    return asArrayOf<GroupSummary>(await this.call('group.list_by_member', req), 'Vec<GroupSummary>')
  }

  async groupListParents(req: GroupListParentsReq): Promise<GroupSummary[]> {
    return asArrayOf<GroupSummary>(await this.call('group.list_parents', req), 'Vec<GroupSummary>')
  }

  async groupCheckAccess(req: GroupCheckAccessReq): Promise<GroupAccessDecision> {
    return asRecord(await this.call('group.check_access', req), 'GroupAccessDecision')
  }
}
