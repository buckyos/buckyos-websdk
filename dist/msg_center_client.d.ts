import { kRPCClient } from './krpc_client';
import type { KEventClient } from './kevent_client';
import type { CommitResultReq, HumanPromptOption, HumanTaskPrompt, Task, TaskDataResult } from './task_mgr_client';
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
/** Delivery policy only (INBOX / REQUEST_BOX / drop); friendship is `Contact.friend_state`. */
export type AccessGroupLevel = 'block' | 'stranger' | 'temporary' | 'allow';
/** The owner's side of the friendship with a contact. */
export type FriendState = 'none' | 'outgoing_pending' | 'incoming_pending' | 'friend';
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
    mailbox: MailboxAddress;
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
    friend_state?: FriendState;
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
    friend_state?: FriendState;
    /** Exact tag the contact must carry. */
    tag?: string;
    keyword?: string;
    limit?: number;
    offset?: number;
}
export interface SetGroupSubscribersResult {
    group_id: DID;
    subscriber_count: number;
}
export declare const FRIEND_INTENT = "buckyos.friend";
export declare const CONTACT_TAG_ZONE_USER = "zone_user";
export declare const CONTACT_TAG_ZONE_AGENT = "zone_agent";
export declare const CONTACT_TAG_HOMESTATION_FOLLOWING = "homestation.following";
export declare const CONTACT_CHANGED_EVENT_BOX = "CONTACTS";
export type ContactTagKind = 'system' | 'app' | 'user';
export interface WellKnownContactTag {
    key: string;
    kind: ContactTagKind;
    /** App that owns the tag; absent for system tags. */
    app?: string;
    /** Whether the user may add or remove members. */
    user_editable: boolean;
}
export declare const WELL_KNOWN_CONTACT_TAGS: readonly WellKnownContactTag[];
/** The app namespace of an app tag (`<app>.<name>`, lowercase ASCII). */
export declare function contactTagApp(tag: string): string | null;
/** `zone_user` / `zone_agent` are system tags, `<app>.<name>` app tags, anything else a user tag. */
export declare function contactTagKind(tag: string): ContactTagKind;
export type FriendRequestDirection = 'incoming' | 'outgoing';
export type FriendRequestState = 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'expired' | 'ignored';
export type FriendRequestDecision = 'accept' | 'reject' | 'ignore';
/** How far an outgoing request got: queued for another Zone, delivered, or failed. */
export type FriendDeliveryState = 'pending' | 'delivered' | 'failed';
export interface FriendDelivery {
    state: FriendDeliveryState;
    reason?: string;
}
export interface FriendRequest {
    request_id: string;
    peer_did: DID;
    direction: FriendRequestDirection;
    state: FriendRequestState;
    message?: string;
    msg_id?: string;
    peer_name?: string;
    peer_avatar?: string;
    /** Outgoing requests only. */
    delivery?: FriendDelivery;
    created_at_ms: number;
    expires_at_ms: number;
    updated_at_ms: number;
}
export interface FriendRequestResult {
    friend_state: FriendState;
    request?: FriendRequest;
}
/** `machine.data` of a `buckyos.friend` message. */
export interface FriendMessageData {
    action: 'request' | 'accept' | 'reject' | 'cancel' | 'remove';
    request_id: string;
    message?: string;
    profile_hint?: {
        name?: string;
        avatar?: string;
    };
    expires_at_ms?: number;
}
export type LookupKind = 'user' | 'agent' | 'group' | 'zone' | 'device' | 'msgtunnel' | 'unknown';
/** relation: the owner's contacts and joined groups; zone: users and Agents of this Zone; resolved: the input itself. */
export type LookupSection = 'relation' | 'zone' | 'resolved';
export type LookupInputKind = 'empty' | 'text' | 'did' | 'name' | 'invite_link';
export type ReachabilityState = 'local' | 'tunnel' | 'routable' | 'unknown' | 'unreachable';
/** Why the input could not be resolved. */
export type LookupErrorCode = 'invalid-input' | 'not-found' | 'unreachable' | 'forbidden';
export interface Reachability {
    state: ReachabilityState;
    zone?: string;
    reason?: string;
}
export interface LookupRelation {
    is_contact: boolean;
    friend_state?: FriendState;
    access_level?: AccessGroupLevel;
    temporary_expires_at_ms?: number;
    tags?: string[];
    pending_request_id?: string;
    /** Group candidates: the owner's member state (`active`, `invited`, `pending_admin_approval`, ...). */
    group_state?: string;
    group_role?: string;
}
export interface LookupGroupInfo {
    join_policy?: string;
    /** Invite token carried by the input link. */
    invite?: string;
    /** Hosted by this Zone; only these can be joined for now. */
    hosted_here: boolean;
    host?: string;
    owner?: DID;
    member_count?: number;
}
export interface LookupCandidate {
    did: DID;
    kind: LookupKind;
    section: LookupSection;
    name?: string;
    avatar?: string;
    note?: string;
    reachability: Reachability;
    relation: LookupRelation;
    group?: LookupGroupInfo;
}
export interface LookupResult {
    input: string;
    input_kind: LookupInputKind;
    candidates: LookupCandidate[];
    error?: {
        code: LookupErrorCode;
        message?: string;
    };
}
export interface ContactLookupReq {
    input: string;
    kinds?: LookupKind[];
    limit?: number;
    contact_mgr_owner?: DID;
}
export interface ListFriendRequestsReq {
    direction?: FriendRequestDirection;
    state?: FriendRequestState;
    limit?: number;
    offset?: number;
    contact_mgr_owner?: DID;
}
/** Payload of the `/msg_center/<owner>/CONTACTS/changed` kevent. */
export interface ContactChangedEvent {
    owner: DID;
    operation: 'upsert' | 'remove' | 'friend_request';
    dids?: DID[];
    request_id?: string;
    updated_at_ms: number;
}
export type MailboxAddress = string;
export declare function mailboxAddress(owner: DID, sessionId?: string): MailboxAddress;
export declare function mailboxResource(mailbox: MailboxAddress, kind: MailboxKind): string;
export interface GetNextParams {
    mailbox: MailboxAddress;
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
    mailbox: MailboxAddress;
    box_kind: MailboxKind;
    state_filter?: RecipientState[];
    limit?: number;
    with_object?: boolean;
}
export interface ListBoxByTimeParams {
    mailbox: MailboxAddress;
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
export declare const NOTIFY_INTENT = "buckyos.notify";
/** Written into an Agent's own INBOX when its notification also reached one of its conversations. */
export declare const NOTIFY_DELIVERED_INTENT = "buckyos.notify.delivered";
export declare const NOTIFY_DATA_VERSION = 1;
/** Owner-local sessions of a user that hold the notifications by category. */
export declare const NOTIFY_SESSION_PREFIX = "sysnotify:";
export declare const NOTIFY_CHOICE_CONTROL_ID = "option";
export declare const NOTIFY_TEXT_CONTROL_ID = "text";
export declare const NOTIFY_ACTION_ANSWER = "answer";
export declare const NOTIFY_ACTION_DISMISS = "dismiss";
/** Path of the MessageHub card of a notification: `<path>?notify=<id>`. */
export declare const NOTIFY_LINK_PATH = "/messagehub";
export type NotifyKind = 'notice' | 'input';
/** Derived by msg-center from the caller; only system services may name one. */
export type NotifyCategory = 'todo' | 'agent' | 'app';
export type NotifyLevel = 'quiet' | 'normal' | 'timely' | 'urgent';
export type NotifyStatus = 'open' | 'read' | 'answered' | 'dismissed' | 'expired' | 'canceled';
/** Nothing can change any more (everything but `open` and `read`). */
export declare function isNotifyClosed(status: NotifyStatus): boolean;
export declare function notifyCategorySessionId(category: NotifyCategory): string;
export declare function notifyCategoryFromSessionId(sessionId: string): NotifyCategory | null;
/** A conversation of the user with the source. */
export interface NotifyConversation {
    /** The user's endpoint (DID or tunnel endpoint DID). */
    to: string;
    to_session?: string;
}
export interface NotifySource {
    /** Filled by msg-center from the caller's identity. */
    app_id?: string;
    /** Filled by msg-center when the caller is an Agent. */
    agent_did?: string;
    session_id?: string;
    turn?: number;
    call_id?: string;
    goal_id?: string;
    /** One sentence: what this is for. */
    operation?: string;
    /** A page of the App about this matter. */
    link?: string;
    conversation?: NotifyConversation;
}
export interface NotifySendReq {
    /** Zone user id of the recipient. */
    to_user: string;
    kind: NotifyKind;
    level?: NotifyLevel;
    category?: NotifyCategory;
    prompt: HumanTaskPrompt;
    source?: NotifySource;
    expires_at_ms?: number;
    /** Same caller + same key → the same notification, delivered once. */
    idempotency_key: string;
}
/** One mailbox record of a notification. */
export interface NotifyRecordRef {
    owner: string;
    session_id: string;
    record_id: string;
    msg_id: string;
    from: string;
}
/** A copy of an Agent's notification in one of its conversations with the user. */
export interface NotifyDelivery {
    session_id: string;
    /** `native` or the tunnel platform. */
    platform: string;
    to: string;
    to_session?: string;
    msg_id?: string;
    ok: boolean;
    reason?: string;
}
/** What the user (or someone on their behalf) submitted for an `input`. */
export interface NotifyResult {
    /** `answer` or `dismiss`. */
    action: string;
    /** `option` and / or `text`. */
    values?: Record<string, unknown>;
    submitted_by?: string;
    submitted_at?: number;
    /** `<user>|<app>` that committed it, from TaskMgr. */
    committed_by?: string;
}
export interface NotifyView {
    notify_id: string;
    /** `https://<zone host>/messagehub?notify=<id>`, or the bare path. */
    url: string;
    to_user: string;
    kind: NotifyKind;
    category: NotifyCategory;
    level: NotifyLevel;
    status: NotifyStatus;
    prompt: HumanTaskPrompt;
    source: NotifySource;
    created_at_ms: number;
    expires_at_ms?: number;
    closed_at_ms?: number;
    closed_reason?: string;
    /** Who acknowledged a `notice` on the user's behalf, when not the user. */
    acked_by?: string;
    task_id?: string;
    result?: NotifyResult;
    /** The record in the user's notification session. */
    home?: NotifyRecordRef;
    deliveries?: NotifyDelivery[];
}
export interface NotifyListReq {
    status?: NotifyStatus[];
    kind?: NotifyKind;
    category?: NotifyCategory;
    agent_did?: string;
    app_id?: string;
    session_id?: string;
    goal_id?: string;
    since_ms?: number;
    /** Only system services may name someone else than the caller. */
    to_user?: string;
    cursor?: string;
    limit?: number;
}
export interface NotifyListResult {
    items: NotifyView[];
    next_cursor?: string;
}
/** `content.machine.data` of a notification message (intent `buckyos.notify`). */
export interface NotifyMessageData {
    version: number;
    notify_id: string;
    kind: NotifyKind;
    category: NotifyCategory;
    level: NotifyLevel;
    /** `true` for the record in the user's notification session, `false` for a copy. */
    home: boolean;
    source: NotifySource;
    prompt: HumanTaskPrompt;
    task_id?: string;
    url: string;
    expires_at_ms?: number;
}
/** `content.machine.data` of the record (intent `buckyos.notify.delivered`) in an Agent's own INBOX. */
export interface NotifyDeliveredData {
    notify_id: string;
    url: string;
    kind: NotifyKind;
    category: NotifyCategory;
    level: NotifyLevel;
    title: string;
    message?: string;
    options?: HumanPromptOption[];
    source: NotifySource;
    delivered_msg_id?: string;
    reply_route: NotifyConversation;
    at_ms: number;
}
/** The answer to an `input`, or what to do with a `notice`. */
export interface NotifyAnswer {
    /** `true`: dismiss instead of answering. */
    dismiss?: boolean;
    option?: string;
    text?: string;
}
export declare class MsgCenterClient {
    private rpcClient;
    constructor(rpcClient: kRPCClient);
    setSeq(seq: number): void;
    private call;
    dispatch(msg: MsgObject, ingressCtx?: IngressContext, idempotencyKey?: string): Promise<DispatchResult>;
    postSend(msg: MsgObject, idempotencyKey?: string): Promise<PostSendResult>;
    listMailboxes(owner: DID, boxKind: MailboxKind): Promise<MailboxAddress[]>;
    moveRecord(recordId: string, mailbox: MailboxAddress): Promise<MailboxRecord>;
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
    /** Find people and groups for raw input: name, DID, BNS name or group invite link. */
    lookup(req: ContactLookupReq): Promise<LookupResult>;
    /** Add / remove tags; a user may only change user tags, an app only its own namespace. */
    updateContactTags(did: DID, change: {
        add?: string[];
        remove?: string[];
    }, contactMgrOwner?: DID): Promise<Contact>;
    /** Delete the contact record (history stays); relations the system established are refused. */
    removeContact(did: DID, contactMgrOwner?: DID): Promise<void>;
    unblockContact(did: DID, contactMgrOwner?: DID): Promise<Contact>;
    sendFriendRequest(did: DID, message?: string, contactMgrOwner?: DID): Promise<FriendRequestResult>;
    respondFriendRequest(requestId: string, decision: FriendRequestDecision, contactMgrOwner?: DID): Promise<FriendRequestResult>;
    cancelFriendRequest(requestId: string, contactMgrOwner?: DID): Promise<FriendRequestResult>;
    /** End the friendship; `notify` (default true) tells the peer. */
    removeFriend(did: DID, notify?: boolean, contactMgrOwner?: DID): Promise<FriendRequestResult>;
    listFriendRequests(req?: ListFriendRequestsReq): Promise<FriendRequest[]>;
    /** Notify a zone user (System Notify). */
    notifySend(req: NotifySendReq): Promise<NotifyView>;
    notifyGet(notifyId: string): Promise<NotifyView>;
    notifyList(req?: NotifyListReq): Promise<NotifyListResult>;
    /** Mark a `notice` read; `onBehalf` names who acknowledges for the user. */
    notifyAck(notifyId: string, onBehalf?: string): Promise<NotifyView>;
    notifyDismiss(notifyId: string): Promise<NotifyView>;
    notifyCancel(notifyId: string, reason?: string): Promise<NotifyView>;
}
/**
 * The prompt of an `input`: a required `option` choice when there are
 * options, a `text` input when there are none or free text is allowed.
 */
export declare function inputPrompt(title: string, message: string, options: HumanPromptOption[], allowText?: boolean): HumanTaskPrompt;
/** The options of a prompt's `option` choice. */
export declare function promptOptions(prompt: HumanTaskPrompt): HumanPromptOption[];
/** The task result of an answer (`TaskDataResult` `human`). */
export declare function notifyAnswerToTaskResult(answer: NotifyAnswer, submittedBy: string, submittedAtMs: number): TaskDataResult;
/** Checks an answer against the prompt of an `input`; returns the error, or null. */
export declare function validateNotifyAnswer(answer: NotifyAnswer, prompt: HumanTaskPrompt): string | null;
/** `/messagehub?notify=<id>` under `https://<host>` when the host is known. */
export declare function notifyUrl(zoneHost: string | null | undefined, notifyId: string): string;
/** The `content.machine.data` of a message, when it carries `intent`. */
export declare function msgMachineData<T = JsonObject>(msg: MsgObject | null | undefined, intent: string): T | null;
/** The notification data of a message, when it is one. */
export declare function notifyMessageData(msg: MsgObject | null | undefined): NotifyMessageData | null;
/** The TaskMgr side of answering an `input` (a `TaskManagerClient` fits). */
export interface NotifyTaskAccess {
    getTask(taskId: string): Promise<Task>;
    commitResult(req: CommitResultReq): Promise<Task>;
}
/** How an attempt to answer ended: this answer is the result, or the task was already closed (by someone else's answer, a cancel or expiry). */
export type NotifyCommit = {
    kind: 'committed';
    task: Task;
} | {
    kind: 'already_closed';
    task: Task;
};
/**
 * Commit `answer` to the task of an `input`: read the latest snapshot and
 * write with `expected_revision`; a lost race re-reads so the caller sees
 * the final state.
 */
export declare function commitNotifyAnswer(tasks: NotifyTaskAccess, taskId: string, answer: NotifyAnswer, submittedBy: string, nowMs?: number): Promise<NotifyCommit>;
/**
 * Answer an `input` (or dismiss it); for a `notice` acknowledge or dismiss
 * it. Returns the final view: when someone else answered first, theirs.
 * `submittedBy` defaults to the notification's user.
 */
export declare function answerNotify(msgCenter: Pick<MsgCenterClient, 'notifyGet' | 'notifyAck' | 'notifyDismiss'>, taskMgr: NotifyTaskAccess, notifyId: string, answer: NotifyAnswer, submittedBy?: string): Promise<NotifyView>;
export interface WaitNotifyOptions {
    /**
     * When given, `/task_mgr/<task_id>` events of an `input` wake the wait
     * early; without it (or if the reader cannot be opened) it only polls.
     */
    kevent?: Pick<KEventClient, 'createEventReader'> | null;
}
/**
 * Wait until the notification is closed or `deadlineMs` (epoch ms) passes;
 * returns the last view either way. Polls `notify.get` every 0.5 s, doubling
 * up to 30 s, never past the deadline.
 */
export declare function waitNotify(msgCenter: Pick<MsgCenterClient, 'notifyGet'>, notifyId: string, deadlineMs: number, opts?: WaitNotifyOptions): Promise<NotifyView>;
//# sourceMappingURL=msg_center_client.d.ts.map