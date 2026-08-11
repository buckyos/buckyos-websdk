import { kRPCClient } from './krpc_client';
export declare const MSG_CENTER_SERVICE_UNIQUE_ID = "msg-center";
export declare const MSG_CENTER_SERVICE_NAME = "msg-center";
export declare const MSG_CENTER_SERVICE_PORT = 4050;
export declare const UI_SESSION_STATE_ACTIVE_KEY = "active";
export declare const UI_SESSION_STATE_TYPING_KEY = "typing";
export declare const UI_SESSION_STATE_STATUS_LINE_KEY = "status_line";
export declare const UI_SESSION_PLATFORM_TELEGRAM = "tg";
export type DID = string;
export type ObjId = string;
export type JsonObject = Record<string, unknown>;
export type MsgObject = JsonObject;
export type MailboxKind = 'INBOX' | 'SENT' | 'GROUP_INBOX' | 'REQUEST_BOX';
export type RecipientState = 'UNREAD' | 'READING' | 'READ' | 'ARCHIVED' | 'DELETED';
export type DeliveryState = 'WAIT' | 'SENDING' | 'SENT' | 'FAILED' | 'DEAD';
export type ReadReceiptState = 'UNREAD' | 'READING' | 'READED' | 'ACCEPTED' | 'REJECTED' | 'QUARANTINED';
export type ContactSource = 'manual_import' | 'manual_create' | 'auto_inferred' | 'shared';
export type AccessGroupLevel = 'block' | 'stranger' | 'temporary' | 'friend';
export type SessionMessageDirection = 'in' | 'out';
export type SessionDeliveryOverall = 'sending' | 'delivered' | 'partial_failed' | 'failed';
export interface IngressContext {
    transport_did?: DID;
    platform?: string;
    chat_id?: string;
    source_account_id?: string;
    context_id?: string;
    contact_mgr_owner?: DID;
    extra?: unknown;
}
export type TransportKind = {
    kind: 'native';
} | {
    kind: 'tunnel';
    platform: string;
    tunnel_instance_id: string;
};
export interface DeliverySnapshot {
    platform?: string;
    account_id?: string;
    account_type?: string;
    chat_id?: string;
    address?: string;
    ext_ids?: Record<string, string>;
    extra?: unknown;
}
export interface DeliveryEnvelope {
    msg_id: ObjId;
    target_did: DID;
    transport_did: DID;
    transport: TransportKind;
    address?: DeliverySnapshot;
}
export interface DeliveryError {
    error_code?: string;
    message: string;
    retryable: boolean;
    duplicate_risk: boolean;
}
export interface DeliveryRecord {
    delivery_id: string;
    envelope: DeliveryEnvelope;
    state: DeliveryState;
    attempts: number;
    next_retry_at_ms?: number;
    external_msg_id?: string;
    delivered_at_ms?: number;
    last_error?: DeliveryError;
    created_at_ms: number;
    updated_at_ms: number;
}
export interface MailboxRecord {
    record_id: string;
    owner: DID;
    box_kind: MailboxKind;
    msg_id: ObjId;
    msg_kind: string;
    state: RecipientState;
    from: DID;
    from_name?: string;
    to: DID;
    session_id?: string;
    sort_key: number;
    tags?: string[];
    ingress?: IngressContext;
    created_at_ms: number;
    updated_at_ms: number;
}
export interface MailboxRecordWithObject {
    record: MailboxRecord;
    msg: MsgObject | null;
}
export interface DeliveryRecordWithObject {
    record: DeliveryRecord;
    msg: MsgObject | null;
}
export interface UiSessionStateEntry {
    session_id: string;
    key: string;
    value: unknown;
    updated_at_ms: number;
}
export interface MailboxRecordPage {
    items: MailboxRecordWithObject[];
    next_cursor_sort_key?: number;
    next_cursor_record_id?: string;
}
export interface SessionSummary {
    session_id: string;
    last_record?: MailboxRecordWithObject;
    unread_count: number;
    updated_at_ms: number;
}
export interface SessionSummaryPage {
    items: SessionSummary[];
    next_cursor_updated_at_ms?: number;
    next_cursor_session_id?: string;
}
export interface SessionDeliveryTarget {
    target_did: DID;
    state: DeliveryState;
    attempts: number;
    external_msg_id?: string;
    last_error?: DeliveryError;
}
export interface SessionDeliveryView {
    overall: SessionDeliveryOverall;
    per_target?: SessionDeliveryTarget[];
}
export interface SessionMessageItem {
    record_id: string;
    msg_id: ObjId;
    direction: SessionMessageDirection;
    box_kind: MailboxKind;
    sort_key: number;
    from: DID;
    to: DID;
    recipient_state?: RecipientState;
    delivery?: SessionDeliveryView;
    msg?: MsgObject;
}
export interface SessionMessagePage {
    items: SessionMessageItem[];
    next_cursor_sort_key?: number;
    next_cursor_record_id?: string;
}
export interface MsgReceiptObj {
    msg_id: ObjId;
    iss: DID;
    reader: DID;
    group_id?: DID;
    at_ms: number;
    status: ReadReceiptState;
    reason?: string;
}
export interface DispatchResult {
    ok: boolean;
    msg_id: ObjId;
    delivered_recipients?: DID[];
    dropped_recipients?: DID[];
    delivered_group?: DID;
    delivered_agents?: DID[];
    reason?: string;
}
export interface PostSendDelivery {
    delivery_id: string;
    transport_did: DID;
    target_did: DID;
    transport: TransportKind;
}
export interface PostSendResult {
    ok: boolean;
    msg_id: ObjId;
    deliveries?: PostSendDelivery[];
    reason?: string;
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
export interface AccountBinding {
    platform: string;
    account_id: string;
    display_id: string;
    tunnel_instance_id: string;
    account_type: string;
    endpoint_did?: DID;
    last_active_at: number;
    meta?: Record<string, string>;
}
export interface TemporaryGrant {
    context_id: string;
    granted_at: number;
    expires_at: number;
}
export interface Contact {
    did: DID;
    name: string;
    avatar?: string;
    note?: string;
    source: ContactSource;
    is_verified: boolean;
    bindings?: AccountBinding[];
    access_level: AccessGroupLevel;
    temp_grants?: TemporaryGrant[];
    groups?: string[];
    tags?: string[];
    created_at: number;
    updated_at: number;
}
export interface AccessDecision {
    level: AccessGroupLevel;
    allow_delivery: boolean;
    target_box: string;
    temporary_expires_at_ms?: number;
    reason?: string;
}
export interface ImportContactEntry {
    name: string;
    avatar?: string;
    note?: string;
    bindings?: AccountBinding[];
    groups?: string[];
    tags?: string[];
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
export interface ContactPatch {
    name?: string;
    avatar?: string;
    note?: string;
    access_level?: AccessGroupLevel;
    source?: ContactSource;
    is_verified?: boolean;
    groups?: string[];
    tags?: string[];
}
export interface TemporaryGrantOutcome {
    did: DID;
    granted: boolean;
    expires_at_ms?: number;
    reason?: string;
}
export interface GrantTemporaryAccessResult {
    updated: TemporaryGrantOutcome[];
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
export type GroupCreateReq = JsonObject;
export type GroupGetDocReq = JsonObject;
export type GroupUpdateProfileReq = JsonObject;
export type GroupInviteMemberReq = JsonObject;
export type GroupSubmitMemberProofReq = JsonObject;
export type GroupRequestJoinReq = JsonObject;
export type GroupApproveMemberReq = JsonObject;
export type GroupRejectMemberReq = JsonObject;
export type GroupRemoveMemberReq = JsonObject;
export type GroupUpdateMemberRoleReq = JsonObject;
export type GroupListMembersReq = JsonObject;
export type GroupCreateSubgroupReq = JsonObject;
export type GroupUpdateSubgroupReq = JsonObject;
export type GroupListSubgroupsReq = JsonObject;
export type GroupUpdateCollectionPolicyReq = JsonObject;
export type GroupUpdateAttributionPolicyReq = JsonObject;
export type GroupExpandMembersReq = JsonObject;
export type GroupListByMemberReq = JsonObject;
export type GroupListParentsReq = JsonObject;
export type GroupCheckAccessReq = JsonObject;
export type GroupDoc = JsonObject;
export type GroupMemberRecord = JsonObject;
export type GroupSubgroup = JsonObject;
export type GroupExpansionSnapshot = JsonObject;
export type GroupSummary = JsonObject;
export type GroupAccessDecision = JsonObject;
export interface GetNextParams {
    owner: DID;
    box_kind: MailboxKind;
    state_filter?: RecipientState[];
    lock_on_take?: boolean;
    with_object?: boolean;
}
export interface GetNextDeliveryParams {
    transport_did: DID;
    lock_on_take?: boolean;
    with_object?: boolean;
}
export interface PeekBoxParams {
    owner: DID;
    box_kind: MailboxKind;
    state_filter?: RecipientState[];
    limit?: number;
    with_object?: boolean;
}
export interface ListBoxByTimeParams {
    owner: DID;
    box_kind: MailboxKind;
    state_filter?: RecipientState[];
    limit?: number;
    cursor_sort_key?: number;
    cursor_record_id?: string;
    descending?: boolean;
    with_object?: boolean;
}
export interface ListSessionsParams {
    owner: DID;
    limit?: number;
    cursor_updated_at_ms?: number;
    cursor_session_id?: string;
    with_object?: boolean;
}
export interface ListSessionParams {
    owner: DID;
    session_id: string;
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
    private call;
    dispatch(msg: MsgObject, ingressCtx?: IngressContext, idempotencyKey?: string): Promise<DispatchResult>;
    postSend(msg: MsgObject, idempotencyKey?: string): Promise<PostSendResult>;
    getNext(req: GetNextParams): Promise<MailboxRecordWithObject | null>;
    getNextDelivery(req: GetNextDeliveryParams): Promise<DeliveryRecordWithObject | null>;
    peekBox(req: PeekBoxParams): Promise<MailboxRecordWithObject[]>;
    listBoxByTime(req: ListBoxByTimeParams): Promise<MailboxRecordPage>;
    listSessions(req: ListSessionsParams): Promise<SessionSummaryPage>;
    listSession(req: ListSessionParams): Promise<SessionMessagePage>;
    updateRecordState(recordId: string, newState: RecipientState): Promise<MailboxRecord>;
    updateRecordSession(recordId: string, sessionId: string): Promise<MailboxRecord>;
    reportDelivery(deliveryId: string, result: DeliveryReportResult): Promise<DeliveryRecord>;
    setReadState(req: SetReadStateParams): Promise<MsgReceiptObj>;
    listReadReceipts(req: ListReadReceiptsParams): Promise<MsgReceiptObj[]>;
    getRecord(recordId: string, withObject?: boolean): Promise<MailboxRecordWithObject | null>;
    getMessage(msgId: ObjId): Promise<MsgObject | null>;
    updateUiSessionState(sessionId: string, key: string, value: unknown): Promise<UiSessionStateEntry>;
    getUiSessionState(sessionId: string, key: string): Promise<UiSessionStateEntry | null>;
    listUiSessionState(sessionId: string): Promise<UiSessionStateEntry[]>;
    resolveDid(platform: string, accountId: string, profileHint?: unknown, contactMgrOwner?: DID): Promise<DID>;
    resolveEndpointDid(platform: string, accountId: string, accountType: string, tunnelInstanceId: string, contactMgrOwner?: DID): Promise<DID>;
    resolveTarget(contactDid: DID, selector: string, contactMgrOwner?: DID): Promise<DID>;
    resolveContactForEndpoint(endpointDid: DID, contactMgrOwner?: DID): Promise<DID | null>;
    resolveCanonicalDid(did: DID, contactMgrOwner?: DID): Promise<DID>;
    listAliasDids(canonicalDid: DID, contactMgrOwner?: DID): Promise<DID[]>;
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
    groupCreate(req: GroupCreateReq): Promise<GroupDoc>;
    groupGetDoc(req: GroupGetDocReq): Promise<GroupDoc | null>;
    groupUpdateProfile(req: GroupUpdateProfileReq): Promise<GroupDoc>;
    groupInviteMember(req: GroupInviteMemberReq): Promise<GroupMemberRecord>;
    groupSubmitMemberProof(req: GroupSubmitMemberProofReq): Promise<GroupMemberRecord>;
    groupRequestJoin(req: GroupRequestJoinReq): Promise<GroupMemberRecord>;
    groupApproveMember(req: GroupApproveMemberReq): Promise<GroupMemberRecord>;
    groupRejectMember(req: GroupRejectMemberReq): Promise<GroupMemberRecord>;
    groupRemoveMember(req: GroupRemoveMemberReq): Promise<GroupMemberRecord>;
    groupUpdateMemberRole(req: GroupUpdateMemberRoleReq): Promise<GroupMemberRecord>;
    groupListMembers(req: GroupListMembersReq): Promise<GroupMemberRecord[]>;
    groupCreateSubgroup(req: GroupCreateSubgroupReq): Promise<GroupSubgroup>;
    groupUpdateSubgroup(req: GroupUpdateSubgroupReq): Promise<GroupSubgroup>;
    groupListSubgroups(req: GroupListSubgroupsReq): Promise<GroupSubgroup[]>;
    groupUpdateCollectionPolicy(req: GroupUpdateCollectionPolicyReq): Promise<GroupDoc>;
    groupUpdateAttributionPolicy(req: GroupUpdateAttributionPolicyReq): Promise<GroupDoc>;
    groupExpandMembers(req: GroupExpandMembersReq): Promise<GroupExpansionSnapshot>;
    groupListByMember(req: GroupListByMemberReq): Promise<GroupSummary[]>;
    groupListParents(req: GroupListParentsReq): Promise<GroupSummary[]>;
    groupCheckAccess(req: GroupCheckAccessReq): Promise<GroupAccessDecision>;
}
//# sourceMappingURL=msg_center_client.d.ts.map