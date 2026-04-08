import { kRPCClient } from './krpc_client';
export declare const MSG_CENTER_SERVICE_NAME = "msg-center";
export declare const MSG_CENTER_SERVICE_PORT = 4050;
export type DID = string;
export type ObjId = string;
export type BoxKind = 'INBOX' | 'OUTBOX' | 'GROUP_INBOX' | 'TUNNEL_OUTBOX' | 'REQUEST_BOX';
export type MsgState = 'UNREAD' | 'READING' | 'READED' | 'WAIT' | 'SENDING' | 'SENT' | 'FAILED' | 'DEAD' | 'DELETED' | 'ARCHIVED';
export type ReadReceiptState = 'UNREAD' | 'READING' | 'READED' | 'ACCEPTED' | 'REJECTED' | 'QUARANTINED';
export type ContactSource = 'manual_import' | 'manual_create' | 'auto_inferred' | 'shared';
export type AccessGroupLevel = 'block' | 'stranger' | 'temporary' | 'friend';
export interface IngressContext {
    tunnel_did?: DID;
    platform?: string;
    chat_id?: string;
    source_account_id?: string;
    context_id?: string;
    contact_mgr_owner?: DID;
    extra?: unknown;
}
export interface SendContext {
    context_id?: string;
    contact_mgr_owner?: DID;
    preferred_tunnel?: DID;
    priority?: number;
    extra?: unknown;
}
export type MsgObject = Record<string, unknown>;
export type MsgRecord = Record<string, unknown>;
export type MsgRecordWithObject = {
    record: MsgRecord;
    msg: MsgObject | null;
};
export type MsgReceiptObj = Record<string, unknown>;
export type Contact = Record<string, unknown>;
export type AccessDecision = Record<string, unknown>;
export type DispatchResult = Record<string, unknown>;
export type PostSendResult = Record<string, unknown>;
export type AccountBinding = Record<string, unknown>;
export type ImportContactEntry = Record<string, unknown>;
export type ContactPatch = Record<string, unknown>;
export interface MsgRecordPage {
    items: MsgRecordWithObject[];
    next_cursor_sort_key?: number;
    next_cursor_record_id?: string;
}
export interface ImportReport {
    imported: number;
    upgraded_shadow: number;
    merged: number;
    created: number;
    skipped: number;
    failed: number;
    errors?: string[];
    affected_dids?: DID[];
}
export interface GrantTemporaryAccessResult {
    updated: Array<{
        did: DID;
        granted: boolean;
        expires_at_ms?: number;
        reason?: string;
    }>;
}
export interface ContactQuery {
    source?: ContactSource;
    access_level?: AccessGroupLevel;
    keyword?: string;
    limit?: number;
    offset?: number;
}
export interface SetGroupSubscribersResult {
    group_id: DID;
    subscriber_count: number;
}
export interface DeliveryReportResult {
    ok: boolean;
    external_msg_id?: string;
    delivered_at_ms?: number;
    error_code?: string;
    error_message?: string;
    retry_after_ms?: number;
    retryable?: boolean;
}
export interface GetNextParams {
    owner: DID;
    box_kind: BoxKind;
    state_filter?: MsgState[];
    lock_on_take?: boolean;
    with_object?: boolean;
}
export interface PeekBoxParams {
    owner: DID;
    box_kind: BoxKind;
    state_filter?: MsgState[];
    limit?: number;
    with_object?: boolean;
}
export interface ListBoxByTimeParams {
    owner: DID;
    box_kind: BoxKind;
    state_filter?: MsgState[];
    limit?: number;
    cursor_sort_key?: number;
    cursor_record_id?: string;
    descending?: boolean;
    with_object?: boolean;
}
export interface SetReadStateParams {
    group_id: DID;
    msg_id: ObjId;
    reader_did: DID;
    status: ReadReceiptState;
    reason?: string;
    at_ms?: number;
}
export interface ListReadReceiptsParams {
    msg_id: ObjId;
    group_id?: DID;
    reader?: DID;
    limit?: number;
    offset?: number;
}
export declare class MsgCenterClient {
    private rpcClient;
    constructor(rpcClient: kRPCClient);
    setSeq(seq: number): void;
    dispatch(msg: MsgObject, ingressCtx?: IngressContext, idempotencyKey?: string): Promise<DispatchResult>;
    postSend(msg: MsgObject, sendCtx?: SendContext, idempotencyKey?: string): Promise<PostSendResult>;
    getNext(req: GetNextParams): Promise<MsgRecordWithObject | null>;
    peekBox(req: PeekBoxParams): Promise<MsgRecordWithObject[]>;
    listBoxByTime(req: ListBoxByTimeParams): Promise<MsgRecordPage>;
    updateRecordState(recordId: string, newState: MsgState, reason?: string): Promise<MsgRecord>;
    updateRecordSession(recordId: string, sessionId: string): Promise<MsgRecord>;
    reportDelivery(recordId: string, result: DeliveryReportResult): Promise<MsgRecord>;
    setReadState(req: SetReadStateParams): Promise<MsgReceiptObj>;
    listReadReceipts(req: ListReadReceiptsParams): Promise<MsgReceiptObj[]>;
    getRecord(recordId: string, withObject?: boolean): Promise<MsgRecordWithObject | null>;
    getMessage(msgId: ObjId): Promise<MsgObject | null>;
    resolveDid(platform: string, accountId: string, profileHint?: unknown, contactMgrOwner?: DID): Promise<DID>;
    getPreferredBinding(did: DID, contactMgrOwner?: DID): Promise<AccountBinding>;
    checkAccessPermission(did: DID, contextId?: string, contactMgrOwner?: DID): Promise<AccessDecision>;
    grantTemporaryAccess(dids: DID[], contextId: string, durationSecs: number, contactMgrOwner?: DID): Promise<GrantTemporaryAccessResult>;
    blockContact(did: DID, reason?: string, contactMgrOwner?: DID): Promise<void>;
    importContacts(contacts: ImportContactEntry[], upgradeToFriend?: boolean, contactMgrOwner?: DID): Promise<ImportReport>;
    mergeContacts(targetDid: DID, sourceDid: DID, contactMgrOwner?: DID): Promise<Contact>;
    updateContact(did: DID, patch: ContactPatch, contactMgrOwner?: DID): Promise<Contact>;
    getContact(did: DID, contactMgrOwner?: DID): Promise<Contact | null>;
    listContacts(query: ContactQuery, contactMgrOwner?: DID): Promise<Contact[]>;
    getGroupSubscribers(groupId: DID, limit?: number, offset?: number, contactMgrOwner?: DID): Promise<DID[]>;
    setGroupSubscribers(groupId: DID, subscribers: DID[], contactMgrOwner?: DID): Promise<SetGroupSubscribersResult>;
}
//# sourceMappingURL=msg_center_client.d.ts.map