import { BnsClient, BnsSubmitRawTxResp } from './bns_client';
import { BnsEvmProvider, BnsEvmTxConfig, BnsTxOperation } from './bns_evm_tx';
import { RuntimeType } from './runtime';
import { SnBnsPublishDnsTxtReq, SnBnsPublishDocumentReq, SnBnsProxyTxResp, SnClient } from './sn_client';
export type BnsTxRoute = 'sn-proxy' | 'wallet' | 'local';
export type BnsLocalPrivateKeyProvider = string | (() => Promise<string | null> | string | null);
export interface BnsWalletUser {
    sn_username?: unknown;
    sn_user_name?: unknown;
    sn_account?: unknown;
    [key: string]: unknown;
}
export type BnsTxSnClient = Pick<SnClient, 'publishDnsTxt' | 'publishDocument'>;
export type BnsTxRawClient = Pick<BnsClient, 'queryNameState' | 'resolveDocument' | 'submitRawTx'>;
export interface BnsTxExecutorOptions {
    snClient?: BnsTxSnClient | null;
    bnsClient?: BnsTxRawClient | null;
    localPrivateKey?: BnsLocalPrivateKeyProvider | null;
    evmConfig?: BnsEvmTxConfig | null;
    evmProvider?: BnsEvmProvider | null;
    getRuntimeType?: () => RuntimeType;
    getCurrentWalletUser?: () => Promise<unknown> | unknown;
}
export interface BnsSnProxyExecutionResult {
    route: 'sn-proxy';
    operation: BnsTxOperation['type'];
    response: SnBnsProxyTxResp;
}
export interface BnsLocalExecutionResult {
    route: 'local';
    operation: BnsTxOperation['type'];
    response: BnsSubmitRawTxResp;
}
export type BnsTxExecutionResult = BnsSnProxyExecutionResult | BnsLocalExecutionResult;
export type BnsTxExecutorErrorCode = 'SN_CLIENT_UNAVAILABLE' | 'BNS_CLIENT_UNAVAILABLE' | 'LOCAL_SIGNING_UNAVAILABLE' | 'WALLET_EXECUTION_NOT_IMPLEMENTED';
export declare class BnsTxExecutorError extends Error {
    readonly code: BnsTxExecutorErrorCode;
    readonly route: BnsTxRoute;
    constructor(code: BnsTxExecutorErrorCode, route: BnsTxRoute, message: string);
}
export declare function walletUserHasSnAccount(walletUser: unknown): boolean;
export declare class BnsTxExecutor {
    private readonly options;
    private readonly evmTxBuilder;
    private localExecutionTail;
    constructor(options?: BnsTxExecutorOptions);
    resolveRoute(): Promise<BnsTxRoute>;
    private resolveRouteFor;
    execute(operation: BnsTxOperation): Promise<BnsTxExecutionResult>;
    publishDnsTxt(request: SnBnsPublishDnsTxtReq): Promise<BnsTxExecutionResult>;
    publishDocument(request: SnBnsPublishDocumentReq): Promise<BnsTxExecutionResult>;
    private getRuntimeType;
    private getCurrentWalletUser;
    private getLocalPrivateKey;
    private executeWithSn;
    private executeLocally;
    private enqueueLocalExecution;
}
export type { BnsTxOperation } from './bns_evm_tx';
//# sourceMappingURL=bns_tx_executor.d.ts.map