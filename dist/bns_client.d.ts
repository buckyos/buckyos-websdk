import { KRPCClientOptions } from './krpc_client';
export declare const BNS_SERVER_RPC_PATH = "/kapi/bns";
export declare const BNS_INDEXER_RPC_PATH = "/kapi/bns-indexer";
export declare const MAX_BNS_NAMES_PAGE_SIZE = 1000;
export declare const DID_BNS_PREFIX = "did:bns:";
export declare const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";
export declare const MAX_BNS_NAME_LEN = 253;
export declare const MAX_BNS_LABEL_LEN = 126;
export declare const KEY_PURPOSE_AUTHENTICATION: number;
export declare const KEY_PURPOSE_RECOVERY: number;
export declare const KEY_PURPOSE_SIGN_DOCUMENT: number;
export declare const METHOD_QUERY_NAME_STATE = "name.query_state";
export declare const METHOD_RESOLVE_OWNER = "name.resolve_owner";
export declare const METHOD_GET_AUTHORITY_SET = "authority.get_set";
export declare const METHOD_GET_AUTHORITY_KEY = "authority.get_key";
export declare const METHOD_RESOLVE_DOCUMENT = "document.resolve";
export declare const METHOD_GET_DOCUMENT_VERSION = "document.get_version";
export declare const METHOD_QUERY_NAMES_BY_ADDRESS = "name.query_by_addr";
export declare const METHOD_QUERY_TX_STATE = "tx.query_state";
export declare const METHOD_SUBMIT_RAW_TX = "tx.submit_raw";
export declare const METHOD_LIST_EVENTS = "events.list";
export declare const METHOD_LATEST_CHECKPOINT = "checkpoint.latest";
export type NameStatus = 'available' | 'active' | 'expired' | 'released' | 'tombstoned';
export type DocumentStatus = 'missing' | 'active' | 'revoked' | 'expired' | 'migrated' | 'tombstoned';
export type AliasKind = 'none' | 'alias' | 'migrated_to' | 'canonical';
export type ReleaseMode = 'release_after_grace' | 'tombstone_forever';
export type PrincipalKind = 'unset' | 'chain_account' | 'bns_name';
export type OwnerSource = 'none' | 'asset_owner_fallback' | 'explicit_semantic_owner' | 'parent_inherited';
export type AuthorityKeyStatus = 'missing' | 'active' | 'revoked' | 'expired';
export interface Principal {
    kind: PrincipalKind;
    value: string;
}
export interface NameState {
    name: string;
    asset_owner: string;
    semantic_owner: Principal;
    effective_owner: Principal;
    owner_source: OwnerSource;
    standard_transfer_enabled: boolean;
    status: NameStatus;
    registered_at: number;
    expire_at: number;
    grace_until: number;
    updated_at: number;
    name_seq: number;
    owner_document_version: number;
    min_document_iat: number;
    owner_policy_seq: number;
    lineage_epoch: number;
    renewable: boolean;
    transferable: boolean;
    allow_delegated_subnames: boolean;
    namespace_policy_hash: string;
    payment_policy_hash: string;
    alias_state_hash: string;
}
export interface OwnerResolution {
    effective_owner: Principal;
    source: OwnerSource;
    authority_root: string;
    authority_seq: number;
}
export interface AuthoritySetState {
    name: string;
    authority_seq: number;
    authority_root: string;
    active_key_count: number;
}
export interface AuthorityKey {
    kid: string;
    verification_method: string;
    key_data: number[];
    purposes: number;
    valid_from: number;
    valid_until: number;
    status: AuthorityKeyStatus;
    metadata_hash: string;
}
export interface DocumentRef {
    storage_type: string;
    uri: string;
    inline_document: number[];
    content_hash: string;
    schema: string;
    codec: string;
    extra_hash: string;
}
export interface DocumentState {
    name: string;
    doc_type: string;
    version: number;
    previous_version: number;
    status: DocumentStatus;
    document: DocumentRef;
    controller: Principal;
    beneficiary: Principal;
    payment_target: string;
    valid_from: number;
    expire_at: number;
    revoked_at: number;
    controller_policy_hash: string;
    payment_policy_hash: string;
    split_policy_hash: string;
    price_policy_hash: string;
    rights_policy_hash: string;
    document_state_hash: string;
}
export interface ResolveResult {
    name_state: NameState;
    document_state: DocumentState;
    owner: OwnerResolution;
    effective_controller: Principal;
    status: DocumentStatus;
    alias_kind: AliasKind;
    alias_target_did: string;
    proof_root: string;
}
export interface BnsNamePage {
    names: string[];
    next_cursor: string | null;
}
export type BnsTxExecutionState = 'not_found' | 'pending' | 'succeeded' | 'reverted';
export interface BnsTxState {
    tx_hash: string;
    state: BnsTxExecutionState;
    block_number: number | null;
    confirmations: number;
}
export interface BnsSubmitRawTxResp {
    tx_hash: string;
}
export interface LogCheckpoint {
    log_root: string;
    last_seq: number;
    issued_at: number;
    issuer: Principal;
    external_anchor: string;
}
export type RegistryEvent = {
    type: 'name_registered';
    data: {
        name: string;
        asset_owner: string;
        expire_at: number;
        lineage_epoch: number;
        name_seq: number;
    };
} | {
    type: 'name_renewed';
    data: {
        name: string;
        expire_at: number;
        name_seq: number;
    };
} | {
    type: 'name_asset_transferred';
    data: {
        name: string;
        old_asset_owner: string;
        new_asset_owner: string;
        standard_transfer: boolean;
        name_seq: number;
    };
} | {
    type: 'name_owner_updated';
    data: {
        name: string;
        owner: Principal;
        owner_source: OwnerSource;
        standard_transfer_enabled: boolean;
        name_seq: number;
    };
} | {
    type: 'authority_keys_updated';
    data: {
        name: string;
        authority_seq: number;
        authority_root: string;
    };
} | {
    type: 'name_released';
    data: {
        name: string;
        mode: ReleaseMode;
        reason_hash: string;
        name_seq: number;
    };
} | {
    type: 'document_published';
    data: {
        name: string;
        doc_type: string;
        version: number;
        content_hash: string;
        document_state_hash: string;
    };
} | {
    type: 'document_revoked';
    data: {
        name: string;
        doc_type: string;
        previous_version: number;
        new_version: number;
        reason_hash: string;
    };
} | {
    type: 'owner_document_iat_floor_updated';
    data: {
        name: string;
        previous_min_document_iat: number;
        new_min_document_iat: number;
        owner_policy_seq: number;
        name_seq: number;
        reason_hash: string;
    };
} | {
    type: 'controller_policy_updated';
    data: {
        name: string;
        policy_hash: string;
        name_seq: number;
    };
} | {
    type: 'namespace_policy_updated';
    data: {
        name: string;
        allow_delegated_subnames: boolean;
        namespace_policy_hash: string;
        name_seq: number;
    };
} | {
    type: 'did_alias_set';
    data: {
        name: string;
        target_did: string;
        kind: AliasKind;
        proof_hash: string;
        name_seq: number;
    };
} | {
    type: 'payment_target_updated';
    data: {
        name: string;
        doc_type: string;
        payment_target: string;
        payment_policy_hash: string;
        version: number;
    };
} | {
    type: 'log_checkpoint_published';
    data: {
        log_root: string;
        last_seq: number;
        issued_at: number;
        external_anchor: string;
    };
};
export interface EventLogRecord {
    seq: number;
    event_type: string;
    observed_at: number;
    event_hash: string;
    previous_log_root: string;
    log_root: string;
    event: RegistryEvent;
}
export interface BnsRpcErrorInfo {
    code: string;
    message: string;
    name: string | null;
    doc_type: string | null;
    expected: number | null;
    actual: number | null;
}
export interface BnsRpcEnvelope<T> {
    ok: boolean;
    result: T | null;
    error: BnsRpcErrorInfo | null;
}
export type BnsClientErrorKind = 'registry' | 'transport' | 'serialization' | 'invalid_response' | 'timeout';
export declare class BnsClientError extends Error {
    readonly kind: BnsClientErrorKind;
    readonly info: BnsRpcErrorInfo | null;
    constructor(kind: BnsClientErrorKind, message: string, info?: BnsRpcErrorInfo | null);
    get code(): string;
    isRegistryCode(code: string): boolean;
    static registry(info: BnsRpcErrorInfo): BnsClientError;
    static registryCode(code: string, message: string, context?: Partial<BnsRpcErrorInfo>): BnsClientError;
}
export declare function normalizeBnsServerUrl(serverUrl: string): string;
export declare function normalizeBnsIndexerUrl(indexerUrl: string): string;
export declare function canonicalBnsName(name: string): string;
export declare function canonicalDocType(docType: string): string;
export declare function didBnsFromName(name: string): string;
export declare function nameFromDidBns(did: string): string;
export declare function normalizeRawTx(rawTx: string | Uint8Array): string;
export interface BnsWaitTxOptions {
    confirmations?: number;
    intervalMs?: number;
    timeoutMs?: number;
}
export declare class BnsClient {
    private rpcClient;
    constructor(serviceUrl: string, sessionToken?: string | null, options?: KRPCClientOptions);
    static forIndexer(indexerUrl: string, sessionToken?: string | null, options?: KRPCClientOptions): BnsClient;
    setSeq(seq: number): void;
    syncSessionToken(token: string | null): Promise<void>;
    getSessionToken(): string | null;
    private callEnvelope;
    private call;
    private callNullable;
    queryNameState(name: string): Promise<NameState | null>;
    resolveOwner(name: string): Promise<OwnerResolution>;
    getAuthoritySet(name: string): Promise<AuthoritySetState>;
    getAuthorityKey(name: string, kid: string): Promise<AuthorityKey | null>;
    resolveDocument(name: string, docType: string): Promise<ResolveResult>;
    getDocumentVersion(name: string, docType: string, version: number): Promise<DocumentState | null>;
    queryNamesByAddress(address: string, cursor?: string | null, limit?: number): Promise<BnsNamePage>;
    iterNamesByAddress(address: string, pageSize?: number): AsyncGenerator<string, void, undefined>;
    queryTxState(txHash: string): Promise<BnsTxState>;
    submitRawTx(rawTx: string | Uint8Array): Promise<BnsSubmitRawTxResp>;
    waitTx(txHash: string, options?: BnsWaitTxOptions): Promise<BnsTxState>;
    listEvents(fromSeq: number, limit?: number): Promise<EventLogRecord[]>;
    latestCheckpoint(): Promise<LogCheckpoint | null>;
}
//# sourceMappingURL=bns_client.d.ts.map