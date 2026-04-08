import { kRPCClient } from './krpc_client';
export declare const REPO_SERVICE_NAME = "repo-service";
export declare const REPO_SERVICE_PORT = 4000;
export declare const REPO_STATUS_COLLECTED = "collected";
export declare const REPO_STATUS_PINNED = "pinned";
export declare const REPO_ORIGIN_LOCAL = "local";
export declare const REPO_ORIGIN_REMOTE = "remote";
export declare const REPO_ACCESS_POLICY_FREE = "free";
export declare const REPO_ACCESS_POLICY_PAID = "paid";
export declare const REPO_PROOF_TYPE_COLLECTION = "collection_proof";
export declare const REPO_PROOF_TYPE_REFERRAL = "referral_proof";
export declare const REPO_PROOF_TYPE_DOWNLOAD = "download_proof";
export declare const REPO_PROOF_TYPE_INSTALL = "install_proof";
export declare const REPO_SERVE_STATUS_OK = "ok";
export declare const REPO_SERVE_STATUS_REJECT = "reject";
export type ObjId = string;
export type RepoActionProof = Record<string, unknown>;
export type RepoCollectionProof = Record<string, unknown>;
export type RepoProof = {
    kind: 'Action';
    value: RepoActionProof;
} | {
    kind: 'Collection';
    value: RepoCollectionProof;
};
export declare const RepoProof: {
    action(proof: RepoActionProof): RepoProof;
    collection(proof: RepoCollectionProof): RepoProof;
};
export interface RepoRecord {
    content_id: string;
    content_name?: string;
    status: string;
    origin: string;
    meta: unknown;
    owner_did?: string;
    author?: string;
    access_policy: string;
    price?: string;
    content_size?: number;
    collected_at?: number;
    pinned_at?: number;
    updated_at?: number;
}
export interface RepoProofFilter {
    proof_type?: string;
    from_did?: string;
    to_did?: string;
    start_ts?: number;
    end_ts?: number;
}
export interface RepoListFilter {
    status?: string;
    origin?: string;
    content_name?: string;
    owner_did?: string;
}
export interface RepoStat {
    total_objects: number;
    collected_objects: number;
    pinned_objects: number;
    local_objects: number;
    remote_objects: number;
    total_content_bytes: number;
    total_proofs: number;
}
export interface RepoContentRef {
    content_id: string;
    access_url?: string;
    metadata?: unknown;
}
export interface RepoServeRequestContext {
    requester_did?: string;
    requester_device_id?: string;
    receipt?: unknown;
    extra?: unknown;
}
export interface RepoServeResult {
    status: string;
    content_ref?: RepoContentRef;
    download_proof?: RepoActionProof;
    reject_code?: string;
    reject_reason?: string;
}
export declare class RepoClient {
    private rpcClient;
    constructor(rpcClient: kRPCClient);
    setSeq(seq: number): void;
    store(contentId: string): Promise<ObjId>;
    collect(contentMeta: unknown, referralProof?: RepoActionProof): Promise<string>;
    pin(contentId: string, downloadProof: RepoActionProof): Promise<boolean>;
    unpin(contentId: string, force?: boolean): Promise<boolean>;
    uncollect(contentId: string, force?: boolean): Promise<boolean>;
    addProof(proof: RepoProof): Promise<string>;
    getProofs(contentId: string, filter?: RepoProofFilter): Promise<RepoProof[]>;
    resolve(contentName: string): Promise<ObjId[]>;
    list(filter?: RepoListFilter): Promise<RepoRecord[]>;
    stat(): Promise<RepoStat>;
    serve(contentId: string, requestContext: RepoServeRequestContext): Promise<RepoServeResult>;
    announce(contentId: string): Promise<boolean>;
}
//# sourceMappingURL=repo_client.d.ts.map