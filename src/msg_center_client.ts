import { kRPCClient, RPCError } from './krpc_client'

// MsgCenter client.
//
// Mirrors ../../buckyos/src/kernel/buckyos-api/src/msg_center_client.rs.
// The Rust client carries a fairly large surface (msg.* + contact.*) and many
// nested DTOs. We model the small structural enums here for type safety, but
// keep the deeply nested object types (`MsgObject`, `MsgRecord`, `Contact`,
// `MsgReceiptObj`, ...) as pass-through `Record<string, unknown>` aliases so
// the TS side does not have to chase every Rust struct change. Wire JSON is
// preserved verbatim.

export const MSG_CENTER_SERVICE_NAME = 'msg-center'
export const MSG_CENTER_SERVICE_PORT = 4050

// DID and ObjId are stringly-typed on the wire (Rust serializes them via
// Display/FromStr).
export type DID = string
export type ObjId = string

// `enum BoxKind` (SCREAMING_SNAKE_CASE).
export type BoxKind = 'INBOX' | 'OUTBOX' | 'GROUP_INBOX' | 'TUNNEL_OUTBOX' | 'REQUEST_BOX'

// `enum MsgState` (SCREAMING_SNAKE_CASE).
export type MsgState =
  | 'UNREAD'
  | 'READING'
  | 'READED'
  | 'WAIT'
  | 'SENDING'
  | 'SENT'
  | 'FAILED'
  | 'DEAD'
  | 'DELETED'
  | 'ARCHIVED'

// `enum ReadReceiptState` (SCREAMING_SNAKE_CASE).
export type ReadReceiptState =
  | 'UNREAD'
  | 'READING'
  | 'READED'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'QUARANTINED'

// `enum ContactSource` / `AccessGroupLevel` (snake_case).
export type ContactSource = 'manual_import' | 'manual_create' | 'auto_inferred' | 'shared'
export type AccessGroupLevel = 'block' | 'stranger' | 'temporary' | 'friend'

export interface IngressContext {
  tunnel_did?: DID
  platform?: string
  chat_id?: string
  source_account_id?: string
  context_id?: string
  contact_mgr_owner?: DID
  extra?: unknown
}

export interface SendContext {
  context_id?: string
  contact_mgr_owner?: DID
  preferred_tunnel?: DID
  priority?: number
  extra?: unknown
}

// MsgObject / MsgRecord / Contact: large nested types from buckyos. We expose
// them as opaque records to avoid duplicating every field. Callers populate or
// inspect them as JSON.
export type MsgObject = Record<string, unknown>
export type MsgRecord = Record<string, unknown>
export type MsgRecordWithObject = {
  record: MsgRecord
  msg: MsgObject | null
}
export type MsgReceiptObj = Record<string, unknown>
export type Contact = Record<string, unknown>
export type AccessDecision = Record<string, unknown>
export type DispatchResult = Record<string, unknown>
export type PostSendResult = Record<string, unknown>
export type AccountBinding = Record<string, unknown>
export type ImportContactEntry = Record<string, unknown>
export type ContactPatch = Record<string, unknown>

export interface MsgRecordPage {
  items: MsgRecordWithObject[]
  next_cursor_sort_key?: number
  next_cursor_record_id?: string
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

export interface GrantTemporaryAccessResult {
  updated: Array<{
    did: DID
    granted: boolean
    expires_at_ms?: number
    reason?: string
  }>
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

export interface DeliveryReportResult {
  ok: boolean
  external_msg_id?: string
  delivered_at_ms?: number
  error_code?: string
  error_message?: string
  retry_after_ms?: number
  retryable?: boolean
}

// --- request param helpers -------------------------------------------------

export interface GetNextParams {
  owner: DID
  box_kind: BoxKind
  state_filter?: MsgState[]
  lock_on_take?: boolean
  with_object?: boolean
}

export interface PeekBoxParams {
  owner: DID
  box_kind: BoxKind
  state_filter?: MsgState[]
  limit?: number
  with_object?: boolean
}

export interface ListBoxByTimeParams {
  owner: DID
  box_kind: BoxKind
  state_filter?: MsgState[]
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

// Drop `undefined` keys so the wire payload matches the Rust client's
// `skip_serializing_if = "Option::is_none"` behavior. We don't recurse into
// nested objects — those are user-supplied JSON shapes and should already be
// well-formed.
function compact<T extends Record<string, unknown>>(input: T): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) {
    if (v !== undefined) {
      out[k] = v
    }
  }
  return out
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RPCError(`expected ${what} to be an object`)
  }
  return value as Record<string, unknown>
}

function asArrayOf<T = Record<string, unknown>>(value: unknown, what: string): T[] {
  if (!Array.isArray(value)) {
    throw new RPCError(`expected ${what} to be an array`)
  }
  return value as T[]
}

export class MsgCenterClient {
  private rpcClient: kRPCClient

  constructor(rpcClient: kRPCClient) {
    this.rpcClient = rpcClient
  }

  setSeq(seq: number) {
    this.rpcClient.setSeq(seq)
  }

  // ---- msg.* ---------------------------------------------------------------

  async dispatch(
    msg: MsgObject,
    ingressCtx?: IngressContext,
    idempotencyKey?: string,
  ): Promise<DispatchResult> {
    const params = compact({
      msg,
      ingress_ctx: ingressCtx,
      idempotency_key: idempotencyKey,
    })
    const result = await this.rpcClient.call<unknown, Record<string, unknown>>('msg.dispatch', params)
    return asRecord(result, 'DispatchResult')
  }

  async postSend(
    msg: MsgObject,
    sendCtx?: SendContext,
    idempotencyKey?: string,
  ): Promise<PostSendResult> {
    const params = compact({
      msg,
      send_ctx: sendCtx,
      idempotency_key: idempotencyKey,
    })
    const result = await this.rpcClient.call<unknown, Record<string, unknown>>('msg.post_send', params)
    return asRecord(result, 'PostSendResult')
  }

  async getNext(req: GetNextParams): Promise<MsgRecordWithObject | null> {
    const result = await this.rpcClient.call<unknown, Record<string, unknown>>(
      'msg.get_next',
      compact({ ...req }),
    )
    if (result == null) {
      return null
    }
    return asRecord(result, 'MsgRecordWithObject') as unknown as MsgRecordWithObject
  }

  async peekBox(req: PeekBoxParams): Promise<MsgRecordWithObject[]> {
    const result = await this.rpcClient.call<unknown, Record<string, unknown>>(
      'msg.peek_box',
      compact({ ...req }),
    )
    return asArrayOf<MsgRecordWithObject>(result, 'Vec<MsgRecordWithObject>')
  }

  async listBoxByTime(req: ListBoxByTimeParams): Promise<MsgRecordPage> {
    const result = await this.rpcClient.call<unknown, Record<string, unknown>>(
      'msg.list_box_by_time',
      compact({ ...req }),
    )
    const record = asRecord(result, 'MsgRecordPage')
    return {
      items: Array.isArray(record.items) ? (record.items as MsgRecordWithObject[]) : [],
      next_cursor_sort_key:
        typeof record.next_cursor_sort_key === 'number' ? record.next_cursor_sort_key : undefined,
      next_cursor_record_id:
        typeof record.next_cursor_record_id === 'string' ? record.next_cursor_record_id : undefined,
    }
  }

  async updateRecordState(recordId: string, newState: MsgState, reason?: string): Promise<MsgRecord> {
    const result = await this.rpcClient.call<unknown, Record<string, unknown>>(
      'msg.update_record_state',
      compact({ record_id: recordId, new_state: newState, reason }),
    )
    return asRecord(result, 'MsgRecord')
  }

  async updateRecordSession(recordId: string, sessionId: string): Promise<MsgRecord> {
    const result = await this.rpcClient.call<unknown, Record<string, unknown>>(
      'msg.update_record_session',
      { record_id: recordId, session_id: sessionId },
    )
    return asRecord(result, 'MsgRecord')
  }

  async reportDelivery(recordId: string, result: DeliveryReportResult): Promise<MsgRecord> {
    const response = await this.rpcClient.call<unknown, Record<string, unknown>>(
      'msg.report_delivery',
      { record_id: recordId, result },
    )
    return asRecord(response, 'MsgRecord')
  }

  async setReadState(req: SetReadStateParams): Promise<MsgReceiptObj> {
    const result = await this.rpcClient.call<unknown, Record<string, unknown>>(
      'msg.set_read_state',
      compact({ ...req }),
    )
    return asRecord(result, 'MsgReceiptObj')
  }

  async listReadReceipts(req: ListReadReceiptsParams): Promise<MsgReceiptObj[]> {
    const result = await this.rpcClient.call<unknown, Record<string, unknown>>(
      'msg.list_read_receipts',
      compact({ ...req }),
    )
    return asArrayOf<MsgReceiptObj>(result, 'Vec<MsgReceiptObj>')
  }

  async getRecord(recordId: string, withObject?: boolean): Promise<MsgRecordWithObject | null> {
    const result = await this.rpcClient.call<unknown, Record<string, unknown>>(
      'msg.get_record',
      compact({ record_id: recordId, with_object: withObject }),
    )
    if (result == null) {
      return null
    }
    return asRecord(result, 'MsgRecordWithObject') as unknown as MsgRecordWithObject
  }

  async getMessage(msgId: ObjId): Promise<MsgObject | null> {
    const result = await this.rpcClient.call<unknown, Record<string, unknown>>(
      'msg.get_message',
      { msg_id: msgId },
    )
    if (result == null) {
      return null
    }
    return asRecord(result, 'MsgObject')
  }

  // ---- contact.* -----------------------------------------------------------

  async resolveDid(
    platform: string,
    accountId: string,
    profileHint?: unknown,
    contactMgrOwner?: DID,
  ): Promise<DID> {
    const result = await this.rpcClient.call<unknown, Record<string, unknown>>(
      'contact.resolve_did',
      compact({
        platform,
        account_id: accountId,
        profile_hint: profileHint,
        contact_mgr_owner: contactMgrOwner,
      }),
    )
    if (typeof result !== 'string') {
      throw new RPCError('contact.resolve_did expected to return a DID string')
    }
    return result
  }

  async getPreferredBinding(did: DID, contactMgrOwner?: DID): Promise<AccountBinding> {
    const result = await this.rpcClient.call<unknown, Record<string, unknown>>(
      'contact.get_preferred_binding',
      compact({ did, contact_mgr_owner: contactMgrOwner }),
    )
    return asRecord(result, 'AccountBinding')
  }

  async checkAccessPermission(
    did: DID,
    contextId?: string,
    contactMgrOwner?: DID,
  ): Promise<AccessDecision> {
    const result = await this.rpcClient.call<unknown, Record<string, unknown>>(
      'contact.check_access_permission',
      compact({ did, context_id: contextId, contact_mgr_owner: contactMgrOwner }),
    )
    return asRecord(result, 'AccessDecision')
  }

  async grantTemporaryAccess(
    dids: DID[],
    contextId: string,
    durationSecs: number,
    contactMgrOwner?: DID,
  ): Promise<GrantTemporaryAccessResult> {
    const result = await this.rpcClient.call<unknown, Record<string, unknown>>(
      'contact.grant_temporary_access',
      compact({
        dids,
        context_id: contextId,
        duration_secs: durationSecs,
        contact_mgr_owner: contactMgrOwner,
      }),
    )
    const record = asRecord(result, 'GrantTemporaryAccessResult')
    return {
      updated: Array.isArray(record.updated)
        ? (record.updated as GrantTemporaryAccessResult['updated'])
        : [],
    }
  }

  async blockContact(did: DID, reason?: string, contactMgrOwner?: DID): Promise<void> {
    await this.rpcClient.call<unknown, Record<string, unknown>>(
      'contact.block_contact',
      compact({ did, reason, contact_mgr_owner: contactMgrOwner }),
    )
  }

  async importContacts(
    contacts: ImportContactEntry[],
    upgradeToFriend?: boolean,
    contactMgrOwner?: DID,
  ): Promise<ImportReport> {
    const result = await this.rpcClient.call<unknown, Record<string, unknown>>(
      'contact.import_contacts',
      compact({
        contacts,
        upgrade_to_friend: upgradeToFriend,
        contact_mgr_owner: contactMgrOwner,
      }),
    )
    return asRecord(result, 'ImportReport') as unknown as ImportReport
  }

  async mergeContacts(targetDid: DID, sourceDid: DID, contactMgrOwner?: DID): Promise<Contact> {
    const result = await this.rpcClient.call<unknown, Record<string, unknown>>(
      'contact.merge_contacts',
      compact({ target_did: targetDid, source_did: sourceDid, contact_mgr_owner: contactMgrOwner }),
    )
    return asRecord(result, 'Contact')
  }

  async updateContact(did: DID, patch: ContactPatch, contactMgrOwner?: DID): Promise<Contact> {
    const result = await this.rpcClient.call<unknown, Record<string, unknown>>(
      'contact.update_contact',
      compact({ did, patch, contact_mgr_owner: contactMgrOwner }),
    )
    return asRecord(result, 'Contact')
  }

  async getContact(did: DID, contactMgrOwner?: DID): Promise<Contact | null> {
    const result = await this.rpcClient.call<unknown, Record<string, unknown>>(
      'contact.get_contact',
      compact({ did, contact_mgr_owner: contactMgrOwner }),
    )
    if (result == null) {
      return null
    }
    return asRecord(result, 'Contact')
  }

  async listContacts(query: ContactQuery, contactMgrOwner?: DID): Promise<Contact[]> {
    const result = await this.rpcClient.call<unknown, Record<string, unknown>>(
      'contact.list_contacts',
      compact({ query, contact_mgr_owner: contactMgrOwner }),
    )
    return asArrayOf<Contact>(result, 'Vec<Contact>')
  }

  async getGroupSubscribers(
    groupId: DID,
    limit?: number,
    offset?: number,
    contactMgrOwner?: DID,
  ): Promise<DID[]> {
    const result = await this.rpcClient.call<unknown, Record<string, unknown>>(
      'contact.get_group_subscribers',
      compact({ group_id: groupId, limit, offset, contact_mgr_owner: contactMgrOwner }),
    )
    if (!Array.isArray(result)) {
      throw new RPCError('expected Vec<DID> response')
    }
    return result as DID[]
  }

  async setGroupSubscribers(
    groupId: DID,
    subscribers: DID[],
    contactMgrOwner?: DID,
  ): Promise<SetGroupSubscribersResult> {
    const result = await this.rpcClient.call<unknown, Record<string, unknown>>(
      'contact.set_group_subscribers',
      compact({ group_id: groupId, subscribers, contact_mgr_owner: contactMgrOwner }),
    )
    const record = asRecord(result, 'SetGroupSubscribersResult')
    if (typeof record.group_id !== 'string' || typeof record.subscriber_count !== 'number') {
      throw new RPCError('Invalid SetGroupSubscribersResult')
    }
    return {
      group_id: record.group_id,
      subscriber_count: record.subscriber_count,
    }
  }
}
