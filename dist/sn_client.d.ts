import { KRPCClientOptions } from './krpc_client';
export declare const SN_ROOT_PATH = "/kapi/sn";
export declare const SN_AUTH_PATH = "/kapi/sn/auth";
export declare const SN_DEVICEINFO_PATH = "/kapi/sn/deviceinfo";
export declare const SN_BNS_PROXY_PATH = "/kapi/sn/bns-proxy";
export declare const LEGACY_SN_BNS_PATH = "/kapi/sn/bns";
export declare const METHOD_AUTH_CHECK_USERNAME = "auth.check_username";
export declare const METHOD_AUTH_CHECK_ACTIVE_CODE = "auth.check_active_code";
export declare const METHOD_AUTH_REGISTER = "auth.register";
export declare const METHOD_AUTH_LOGIN = "auth.login";
export declare const METHOD_AUTH_REFRESH = "auth.refresh";
export declare const METHOD_AUTH_LOGOUT = "auth.logout";
export declare const METHOD_AUTH_ME = "auth.me";
export declare const METHOD_USER_GET_PROFILE = "user.get_profile";
export declare const METHOD_USER_SET_SELF_CERT = "user.set_self_cert";
export declare const METHOD_USER_ADD_DNS_RECORD = "user.add_dns_record";
export declare const METHOD_USER_REMOVE_DNS_RECORD = "user.remove_dns_record";
export declare const METHOD_USER_LIST_DNS_RECORDS = "user.list_dns_records";
export declare const METHOD_DOMAIN_BIND = "domain.bind";
export declare const METHOD_DOMAIN_UNBIND = "domain.unbind";
export declare const METHOD_DEVICE_REGISTER = "device.register";
export declare const METHOD_DEVICE_UPDATE = "device.update";
export declare const METHOD_DEVICE_GET = "device.get";
export declare const METHOD_DEVICE_LIST = "device.list";
export declare const METHOD_DEVICEINFO_RESOLVE_OOD_BY_DID = "deviceinfo.resolve_ood_by_did";
export declare const METHOD_DEVICEINFO_RESOLVE_OOD_BY_HOSTNAME = "deviceinfo.resolve_ood_by_hostname";
export declare const METHOD_BNS_PUBLISH_DNS_TXT = "bns.publish_dns_txt";
export declare const METHOD_BNS_PUBLISH_DOCUMENT = "bns.publish_document";
export declare const SN_ERROR_CODES: {
    readonly invalid_params: 1000;
    readonly invalid_username: 1001;
    readonly username_already_exists: 1002;
    readonly invalid_active_code: 1003;
    readonly user_auth_not_found: 1004;
    readonly invalid_password: 1005;
    readonly auth_required: 1006;
    readonly invalid_token: 1007;
    readonly user_not_found: 1008;
    readonly device_not_found: 1012;
    readonly device_permission_denied: 1013;
    readonly invalid_device_did: 1014;
    readonly invalid_domain: 1015;
    readonly domain_proof_failed: 1016;
    readonly hostname_not_found: 1017;
    readonly cross_user_access_denied: 1018;
    readonly unsupported_password_algo: 1019;
    readonly invalid_password_storage: 1020;
    readonly user_not_activated: 1022;
    readonly bns_permission_denied: 1023;
    readonly bns_name_already_exists: 1024;
    readonly bns_write_failed: 1025;
    readonly bns_proxy_unavailable: 1026;
    readonly bns_controller_unavailable: 1027;
    readonly internal_error: 1099;
};
export type SnErrorName = keyof typeof SN_ERROR_CODES;
export interface SnDomainProofFailure {
    domain: string;
    pkx_record_name: string;
    pkx: string;
    retryable: boolean;
    reason: string;
}
export interface SnBnsWriteFailure {
    bns_code: string;
    expected: number | null;
    actual: number | null;
    message: string;
}
export type SnClientErrorKind = 'sn' | 'transport' | 'validation';
export declare class SnClientError extends Error {
    readonly kind: SnClientErrorKind;
    readonly code: number | null;
    readonly codeName: SnErrorName | string | null;
    readonly detail: string;
    constructor(kind: SnClientErrorKind, message: string, code?: number | null, codeName?: string | null, detail?: string | null);
    isSnError(name: SnErrorName | string): boolean;
    domainProofInfo(): SnDomainProofFailure | null;
    bnsWriteInfo(): SnBnsWriteFailure | null;
    static fromRpcError(method: string, error: unknown): SnClientError;
}
export type SnRpcTarget = 'auth' | 'deviceinfo' | 'bns-proxy';
export declare function normalizeSnUrl(snUrl: string, target: SnRpcTarget): string;
export interface SnCheckUsernameResp {
    valid: boolean;
    reason: string;
    message: string;
    normalized_name: string;
}
export interface SnCheckActiveCodeResp {
    valid: boolean;
}
export interface SnBnsProxyInitialDocuments {
    zone?: Record<string, unknown>;
    boot?: Record<string, unknown>;
    dns_txt?: SnBnsDnsTxtRecord[];
}
export interface SnBnsDnsTxtRecord {
    ttl: number;
    value: string;
}
export interface SnAuthRegisterReq {
    name: string;
    pwd_hash: string;
    active_code: string;
    request_id?: string;
    asset_owner?: string;
    owner_config?: Record<string, unknown>;
    initial_documents?: SnBnsProxyInitialDocuments;
}
export interface SnAuthSessionResp {
    code: number;
    access_token: string;
    refresh_token: string;
    need_bind_owner_key: boolean;
    bns?: SnBnsProxyTxOutcome;
}
export interface SnAuthRefreshResp {
    code: number;
    access_token: string;
}
export interface SnCodeResp {
    code: number;
}
export interface SnUserProfileResp {
    code: number;
    name: string;
    owner_key_bound: boolean;
    user_domain: string | null;
    self_cert: boolean;
    sn_ips: unknown;
    zone_config: string;
}
export interface SnAddDnsRecordReq {
    device_did: string;
    domain: string;
    record_type: string;
    record: string;
    ttl?: number;
    has_cert?: boolean;
}
export interface SnAddDnsRecordResp {
    code: number;
    device_name: string;
}
export interface SnRemoveDnsRecordReq {
    device_did: string;
    domain: string;
    record_type: string;
    has_cert?: boolean;
}
export interface SnDnsRecordItem {
    domain: string;
    record_type: string;
    record: string;
    ttl: number;
}
export interface SnListDnsRecordsResp {
    code: number;
    items: SnDnsRecordItem[];
}
export interface SnDomainBindResp {
    code: number;
    domain: string;
    pkx: string;
    pkx_record_name: string;
    pkx_source: string;
    verified_at: number;
}
export type SnDeviceState = 'online' | 'offline' | 'stale' | 'blocked';
export type SnDeviceRole = 'gateway' | 'ood' | 'normal' | 'unknown';
export type SnNatType = 'public' | 'private' | 'symmetric' | 'unknown';
export type SnEndpointProtocol = 'tcp' | 'udp' | 'quic' | 'rtcp' | 'http' | 'https';
export type SnEndpointScope = 'public' | 'private' | 'relay' | 'loopback' | 'unknown';
export type SnEndpointSource = 'device_report' | 'from_ip' | 'relay_observed' | 'admin';
export type SnEndpointState = 'active' | 'stale' | 'failed' | 'disabled';
export interface SnDeviceEndpointUpdate {
    endpoint_id: string;
    protocol: SnEndpointProtocol;
    host: string;
    port?: number | null;
    scope: SnEndpointScope;
    priority: number;
    source: SnEndpointSource;
    expires_at?: number | null;
}
export interface SnDeviceEndpoint {
    did: string;
    endpoint_id: string;
    protocol: SnEndpointProtocol;
    host: string;
    port: number | null;
    scope: SnEndpointScope;
    priority: number;
    source: SnEndpointSource;
    state: SnEndpointState;
    last_seen_at: number | null;
    expires_at: number | null;
    created_at: number;
    updated_at: number;
}
export interface SnDeviceStateView {
    did: string;
    zone: string;
    device_name: string;
    device_role: SnDeviceRole;
    state: SnDeviceState;
    public_ips: string[];
    private_ips: string[];
    active_endpoints: SnDeviceEndpoint[];
    preferred_endpoint: SnDeviceEndpoint | null;
    nat_type: SnNatType;
    is_wan_device: boolean;
    last_seen_at: number | null;
    expires_at: number | null;
}
export type SnDeviceStateResp = SnDeviceStateView & {
    code: number;
};
export interface SnDeviceOnlineReportReq {
    device_name: string;
    device_did?: string;
    device_ip: string;
    device_info: Record<string, unknown> | string;
    endpoints?: SnDeviceEndpointUpdate[];
    report_seq?: number;
    ttl?: number;
}
export interface SnDeviceGetReq {
    device_name?: string;
    device_did?: string;
}
export interface SnDeviceListReq {
    state?: SnDeviceState;
    offset?: number;
    limit?: number;
}
export interface SnDeviceListResp {
    code: number;
    items: SnDeviceStateView[];
}
export type SnOodConnectionState = 'active' | 'suspended' | 'disabled' | 'banned';
export interface SnOodInfo {
    did_hostname: string;
    owner_id: string;
    self_cert: boolean;
    state: SnOodConnectionState;
}
export type SnBnsDnsTxtMode = 'add' | 'remove' | 'replace';
export interface SnBnsPublishDnsTxtRecord {
    ttl?: number;
    value: string;
}
export interface SnBnsPublishDnsTxtReq {
    name: string;
    mode: SnBnsDnsTxtMode;
    request_id?: string;
    ttl?: number;
    value?: string;
    records?: SnBnsPublishDnsTxtRecord[];
}
export interface SnBnsPublishDocumentReq {
    name: string;
    doc_type: string;
    document: Record<string, unknown>;
    request_id?: string;
}
export interface SnBnsProxyTxOutcome {
    request_id: string;
    operation: string;
    name: string;
    controller_id: string;
    controller_address: string;
    asset_owner?: string;
    doc_type?: string;
    document_version?: number;
    chain_id?: number;
    nonce?: number;
    tx_hash?: string;
    raw_tx?: string;
    status: string;
    reused: boolean;
}
export type SnBnsProxyTxResp = SnBnsProxyTxOutcome & {
    code: number;
};
export declare const SN_DEVICE_TOKEN_AUD = "sn-device";
export declare const SN_DEVICE_TOKEN_DEFAULT_TTL_SECS = 600;
export declare function generateSnDeviceToken(deviceKeyDid: string, deviceScopedDid: string, devicePrivateKeyPem: string, ttlSecs?: number): Promise<string>;
export declare class SnClient {
    private authRpc;
    private deviceInfoRpc;
    private bnsProxyRpc;
    constructor(snUrl: string, sessionToken?: string | null, options?: KRPCClientOptions);
    setSeq(seq: number): void;
    syncSessionToken(token: string | null): void;
    getSessionToken(): string | null;
    private call;
    checkUsername(name: string): Promise<SnCheckUsernameResp>;
    checkActiveCode(activeCode: string): Promise<SnCheckActiveCodeResp>;
    register(req: SnAuthRegisterReq): Promise<SnAuthSessionResp>;
    login(name: string, pwdHash: string): Promise<SnAuthSessionResp>;
    refresh(refreshToken: string): Promise<SnAuthRefreshResp>;
    logout(refreshToken?: string): Promise<SnCodeResp>;
    me(): Promise<SnUserProfileResp>;
    getProfile(): Promise<SnUserProfileResp>;
    setSelfCert(selfCert: boolean, deviceDid?: string): Promise<SnCodeResp>;
    addDnsRecord(req: SnAddDnsRecordReq): Promise<SnAddDnsRecordResp>;
    removeDnsRecord(req: SnRemoveDnsRecordReq): Promise<SnCodeResp>;
    listDnsRecords(): Promise<SnListDnsRecordsResp>;
    bindDomain(domain: string): Promise<SnDomainBindResp>;
    unbindDomain(domain: string): Promise<SnCodeResp>;
    registerDeviceOnline(req: SnDeviceOnlineReportReq): Promise<SnDeviceStateResp>;
    updateDeviceOnline(req: SnDeviceOnlineReportReq): Promise<SnDeviceStateResp>;
    getDeviceOnline(query: SnDeviceGetReq): Promise<SnDeviceStateResp>;
    listDevicesOnline(options?: SnDeviceListReq): Promise<SnDeviceListResp>;
    resolveOodByDid(sourceDeviceId: string): Promise<SnOodInfo>;
    resolveOodByHostname(destHost: string): Promise<SnOodInfo>;
    publishDnsTxt(req: SnBnsPublishDnsTxtReq): Promise<SnBnsProxyTxResp>;
    publishDocument(req: SnBnsPublishDocumentReq): Promise<SnBnsProxyTxResp>;
}
//# sourceMappingURL=sn_client.d.ts.map