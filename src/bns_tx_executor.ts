// BNS TX executor routes writes according to the active JavaScript runtime:
// - A regular web page, or a wallet user bound to an SN account, uses the SN
//   bns-proxy (the default route).
// - A wallet runtime whose user is not bound to an SN account must delegate
//   the transaction to the wallet. That bridge is intentionally not
//   implemented yet and fails explicitly instead of silently changing route.
// - A local runtime with an EVM private key and transaction builder constructs
//   and signs locally, then submits the signed raw TX through BnsClient. A
//   submit failure (including insufficient gas funds) is returned to the
//   caller and never falls back to the SN proxy.

import { BnsClient, BnsSubmitRawTxResp } from './bns_client'
import {
  BnsEvmProvider,
  BnsEvmTxBuilder,
  BnsEvmTxConfig,
  BnsTxOperation,
} from './bns_evm_tx'
import { getActiveRuntimeType, getCurrentWalletUserFromHost } from './sdk_core'
import { RuntimeType } from './runtime'
import {
  SnBnsPublishDnsTxtReq,
  SnBnsPublishDocumentReq,
  SnBnsProxyTxResp,
  SnClient,
} from './sn_client'

export type BnsTxRoute = 'sn-proxy' | 'wallet' | 'local'

export type BnsLocalPrivateKeyProvider =
  | string
  | (() => Promise<string | null> | string | null)

export interface BnsWalletUser {
  sn_username?: unknown
  sn_user_name?: unknown
  sn_account?: unknown
  [key: string]: unknown
}

// Structural client types keep the executor easy to test and allow callers
// to wrap the concrete clients (for tracing, retries, etc.) without subclassing.
export type BnsTxSnClient = Pick<SnClient, 'publishDnsTxt' | 'publishDocument'>
export type BnsTxRawClient = Pick<BnsClient, 'queryNameState' | 'resolveDocument' | 'submitRawTx'>

export interface BnsTxExecutorOptions {
  snClient?: BnsTxSnClient | null
  bnsClient?: BnsTxRawClient | null
  localPrivateKey?: BnsLocalPrivateKeyProvider | null
  evmConfig?: BnsEvmTxConfig | null
  evmProvider?: BnsEvmProvider | null

  // Defaults reuse WebSDK's active runtime and wallet bridge detection.
  getRuntimeType?: () => RuntimeType
  getCurrentWalletUser?: () => Promise<unknown> | unknown
}

export interface BnsSnProxyExecutionResult {
  route: 'sn-proxy'
  operation: BnsTxOperation['type']
  response: SnBnsProxyTxResp
}

export interface BnsLocalExecutionResult {
  route: 'local'
  operation: BnsTxOperation['type']
  response: BnsSubmitRawTxResp
}

export type BnsTxExecutionResult = BnsSnProxyExecutionResult | BnsLocalExecutionResult

export type BnsTxExecutorErrorCode =
  | 'SN_CLIENT_UNAVAILABLE'
  | 'BNS_CLIENT_UNAVAILABLE'
  | 'LOCAL_SIGNING_UNAVAILABLE'
  | 'WALLET_EXECUTION_NOT_IMPLEMENTED'

export class BnsTxExecutorError extends Error {
  readonly code: BnsTxExecutorErrorCode
  readonly route: BnsTxRoute

  constructor(code: BnsTxExecutorErrorCode, route: BnsTxRoute, message: string) {
    super(message)
    this.name = 'BnsTxExecutorError'
    this.code = code
    this.route = route
  }
}

function trimToNull(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isLocalRuntime(runtimeType: RuntimeType): boolean {
  return runtimeType === RuntimeType.NodeJS
    || runtimeType === RuntimeType.AppClient
    || runtimeType === RuntimeType.AppService
}

// Wallet bridge versions have used both sn_username and sn_user_name. An
// explicit boolean is also accepted for runtimes that do not expose the name.
export function walletUserHasSnAccount(walletUser: unknown): boolean {
  if (!walletUser || typeof walletUser !== 'object' || Array.isArray(walletUser)) {
    return false
  }
  const user = walletUser as BnsWalletUser
  if (typeof user.sn_account === 'boolean') {
    return user.sn_account
  }
  return trimToNull(user.sn_username) !== null || trimToNull(user.sn_user_name) !== null
}

export class BnsTxExecutor {
  private readonly options: BnsTxExecutorOptions
  private readonly evmTxBuilder: BnsEvmTxBuilder | null
  private localExecutionTail: Promise<void> = Promise.resolve()

  constructor(options: BnsTxExecutorOptions = {}) {
    this.options = options
    this.evmTxBuilder = options.bnsClient && options.evmConfig
      ? new BnsEvmTxBuilder(options.bnsClient, options.evmConfig, options.evmProvider)
      : null
  }

  async resolveRoute(): Promise<BnsTxRoute> {
    const runtimeType = this.getRuntimeType()
    const privateKey = isLocalRuntime(runtimeType) ? await this.getLocalPrivateKey() : null
    return this.resolveRouteFor(runtimeType, privateKey)
  }

  private async resolveRouteFor(runtimeType: RuntimeType, privateKey: string | null): Promise<BnsTxRoute> {
    if (isLocalRuntime(runtimeType) && this.options.evmConfig && privateKey) {
      return 'local'
    }

    if (runtimeType === RuntimeType.AppRuntime) {
      const walletUser = await this.getCurrentWalletUser()
      if (walletUser && !walletUserHasSnAccount(walletUser)) {
        return 'wallet'
      }
    }

    return 'sn-proxy'
  }

  async execute(operation: BnsTxOperation): Promise<BnsTxExecutionResult> {
    const runtimeType = this.getRuntimeType()
    const privateKey = isLocalRuntime(runtimeType) ? await this.getLocalPrivateKey() : null
    const route = await this.resolveRouteFor(runtimeType, privateKey)

    switch (route) {
      case 'local':
        return this.executeLocally(operation, runtimeType, privateKey)
      case 'wallet':
        throw new BnsTxExecutorError(
          'WALLET_EXECUTION_NOT_IMPLEMENTED',
          route,
          `BNS wallet execution is not implemented for operation ${operation.type}`,
        )
      case 'sn-proxy':
        return this.executeWithSn(operation)
    }
  }

  publishDnsTxt(request: SnBnsPublishDnsTxtReq): Promise<BnsTxExecutionResult> {
    return this.execute({ type: 'publish_dns_txt', request })
  }

  publishDocument(request: SnBnsPublishDocumentReq): Promise<BnsTxExecutionResult> {
    return this.execute({ type: 'publish_document', request })
  }

  private getRuntimeType(): RuntimeType {
    return (this.options.getRuntimeType ?? getActiveRuntimeType)()
  }

  private getCurrentWalletUser(): Promise<unknown> {
    return Promise.resolve(
      (this.options.getCurrentWalletUser ?? getCurrentWalletUserFromHost)(),
    )
  }

  private async getLocalPrivateKey(): Promise<string | null> {
    const provider = this.options.localPrivateKey
    if (typeof provider === 'function') {
      return trimToNull(await provider())
    }
    return trimToNull(provider)
  }

  private async executeWithSn(operation: BnsTxOperation): Promise<BnsSnProxyExecutionResult> {
    const client = this.options.snClient
    if (!client) {
      throw new BnsTxExecutorError(
        'SN_CLIENT_UNAVAILABLE',
        'sn-proxy',
        `SN client is required for BNS operation ${operation.type}`,
      )
    }

    const response = operation.type === 'publish_dns_txt'
      ? await client.publishDnsTxt(operation.request)
      : await client.publishDocument(operation.request)

    return {
      route: 'sn-proxy',
      operation: operation.type,
      response,
    }
  }

  private async executeLocally(
    operation: BnsTxOperation,
    runtimeType: RuntimeType,
    privateKey: string | null,
  ): Promise<BnsLocalExecutionResult> {
    const client = this.options.bnsClient
    if (!client) {
      throw new BnsTxExecutorError(
        'BNS_CLIENT_UNAVAILABLE',
        'local',
        `BNS client is required for local operation ${operation.type}`,
      )
    }

    const builder = this.evmTxBuilder
    if (!privateKey || !builder) {
      throw new BnsTxExecutorError(
        'LOCAL_SIGNING_UNAVAILABLE',
        'local',
        `Local signing configuration is unavailable for operation ${operation.type}`,
      )
    }

    return this.enqueueLocalExecution(async () => {
      try {
        const rawTx = await builder.buildAndSign(operation, privateKey)
        const response = await client.submitRawTx(rawTx)
        return {
          route: 'local',
          operation: operation.type,
          response,
        }
      } catch (error) {
        builder.resetNonce()
        throw error
      }
    })
  }

  private enqueueLocalExecution<T>(execute: () => Promise<T>): Promise<T> {
    const result = this.localExecutionTail.then(execute, execute)
    this.localExecutionTail = result.then(() => undefined, () => undefined)
    return result
  }
}

export type { BnsTxOperation } from './bns_evm_tx'
