import { Interface } from 'ethers';
import { NameState, ResolveResult } from './bns_client';
import { SnBnsPublishDnsTxtReq, SnBnsPublishDocumentReq } from './sn_client';
export declare const BNS_EVM_DEFAULT_GAS_LIMIT = 3000000n;
export declare const BNS_EVM_DEFAULT_MAX_FEE_PER_GAS = 2000000000n;
export declare const BNS_EVM_DEFAULT_MAX_PRIORITY_FEE_PER_GAS = 1000000000n;
export declare const BNS_MAX_INLINE_DOCUMENT_BYTES = 4096;
export declare const BNS_DNS_TXT_DEFAULT_TTL = 600;
export declare const BNS_DNS_TXT_DOC_TYPE = "dns_txt";
export declare const BNS_PUBLISH_DOCUMENT_ABI: readonly ["function publishDocument(string name,string docType,uint64 expectedVersion,(bytes32 storageType,string uri,bytes inlineDocument,bytes32 contentHash,bytes32 schema,bytes32 codec,bytes32 extraHash) document,(uint8 kind,bytes value) controller,(uint8 kind,bytes value) beneficiary,address paymentTarget,uint64 expireAt,bytes32 controllerPolicyHash,bytes32 paymentPolicyHash,bytes32 splitPolicyHash,bytes32 pricePolicyHash,bytes32 rightsPolicyHash,(uint8 role,(uint8 kind,bytes value) actor,bytes32 kid) authority,(uint64 expectedNameSeq,uint64 expectedParentNameSeq) guard) returns (uint64 version)"];
export type BnsEvmNumberish = bigint | number | string;
export interface BnsEvmTxConfig {
    rpcEndpoint: string;
    chainId: BnsEvmNumberish;
    contractAddress: string;
    gasLimit?: BnsEvmNumberish;
    maxFeePerGas?: BnsEvmNumberish;
    maxPriorityFeePerGas?: BnsEvmNumberish;
    authorityKid?: string | null;
}
export type BnsTxOperation = {
    type: 'publish_dns_txt';
    request: SnBnsPublishDnsTxtReq;
} | {
    type: 'publish_document';
    request: SnBnsPublishDocumentReq;
};
export interface BnsEvmStateClient {
    queryNameState(name: string): Promise<NameState | null>;
    resolveDocument(name: string, docType: string): Promise<ResolveResult>;
}
export interface BnsEvmProvider {
    getTransactionCount(address: string, blockTag?: 'pending'): Promise<number>;
}
export type BnsEvmTxErrorCode = 'INVALID_CONFIG' | 'INVALID_OPERATION' | 'NAME_NOT_FOUND' | 'LOCAL_SIGNER_NOT_OWNER' | 'AUTHORITY_KID_REQUIRED' | 'INVALID_DOCUMENT';
export declare class BnsEvmTxError extends Error {
    readonly code: BnsEvmTxErrorCode;
    constructor(code: BnsEvmTxErrorCode, message: string);
}
export declare class BnsEvmTxBuilder {
    private readonly client;
    private readonly config;
    private readonly provider;
    private readonly chainId;
    private readonly contractAddress;
    private readonly gasLimit;
    private readonly maxFeePerGas;
    private readonly maxPriorityFeePerGas;
    private nextNonce;
    constructor(client: BnsEvmStateClient, config: BnsEvmTxConfig, provider?: BnsEvmProvider | null);
    resetNonce(): void;
    buildAndSign(operation: BnsTxOperation, privateKey: string): Promise<string>;
    private allocateNonce;
    private preparePublishedDocument;
    private prepareDnsTxtDocument;
    private prepareDocument;
    private getNameState;
    private getCurrentDocument;
    private encodePublishDocument;
    private ownerAuthority;
}
export declare function decodeBnsPublishDocumentCalldata(data: string): ReturnType<Interface['decodeFunctionData']>;
//# sourceMappingURL=bns_evm_tx.d.ts.map