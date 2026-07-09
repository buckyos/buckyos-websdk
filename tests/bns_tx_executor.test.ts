import {
  BnsTxExecutor,
  BnsTxExecutorError,
  walletUserHasSnAccount,
} from '../src/bns_tx_executor'
import {
  decodeBnsPublishDocumentCalldata,
} from '../src/bns_evm_tx'
import { BnsClientError, NameState, ResolveResult, ZERO_HASH } from '../src/bns_client'
import { RuntimeType } from '../src/runtime'
import { getBytes, sha256, Transaction, Wallet } from 'ethers'

const LOCAL_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const LOCAL_ADDRESS = new Wallet(LOCAL_PRIVATE_KEY).address
const BNS_CONTRACT_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3'

const EVM_CONFIG = {
  rpcEndpoint: 'http://127.0.0.1:8545',
  contractAddress: BNS_CONTRACT_ADDRESS,
  chainId: 31337,
  gasLimit: 3_000_000,
  maxFeePerGas: 2_000_000_000,
  maxPriorityFeePerGas: 1_000_000_000,
}

function nameState(nameSeq: number = 9): NameState {
  return {
    name: 'alice',
    asset_owner: LOCAL_ADDRESS,
    semantic_owner: { kind: 'unset', value: '' },
    effective_owner: { kind: 'chain_account', value: LOCAL_ADDRESS },
    owner_source: 'asset_owner_fallback',
    standard_transfer_enabled: true,
    status: 'active',
    registered_at: 1,
    expire_at: 2,
    grace_until: 3,
    updated_at: 4,
    name_seq: nameSeq,
    owner_document_version: 0,
    min_document_iat: 0,
    owner_policy_seq: 0,
    lineage_epoch: 1,
    renewable: true,
    transferable: true,
    allow_delegated_subnames: false,
    namespace_policy_hash: ZERO_HASH,
    payment_policy_hash: ZERO_HASH,
    alias_state_hash: ZERO_HASH,
  }
}

function missingDocument(): never {
  throw BnsClientError.registryCode('DOCUMENT_NOT_FOUND', 'document not found')
}

function directBnsClient(
  submitRawTx: jest.Mock<Promise<{ tx_hash: string }>, [string | Uint8Array]> = jest.fn(
    async (_rawTx: string | Uint8Array) => ({ tx_hash: '0xabc' }),
  ),
) {
  return {
    queryNameState: jest.fn<Promise<NameState | null>, [string]>(async () => nameState()),
    resolveDocument: jest.fn<Promise<ResolveResult>, [string, string]>(async () => missingDocument()),
    submitRawTx,
  }
}

const evmProvider = (nonce: number = 7) => ({
  getTransactionCount: jest.fn(async () => nonce),
})

const publishDocumentRequest = {
  name: 'alice',
  doc_type: 'zone',
  document: { gateway: 'ood1' },
}

function snClient() {
  return {
    publishDnsTxt: jest.fn(async () => ({
      code: 0,
      request_id: 'req-1',
      operation: 'publish_dns_txt',
      name: 'alice',
      controller_id: 'controller',
      controller_address: '0x1',
      status: 'submitted',
      reused: false,
    })),
    publishDocument: jest.fn(async () => ({
      code: 0,
      request_id: 'req-1',
      operation: 'publish_document',
      name: 'alice',
      controller_id: 'controller',
      controller_address: '0x1',
      status: 'submitted',
      reused: false,
    })),
  }
}

describe('BnsTxExecutor', () => {
  it('uses the SN proxy for a regular browser', async () => {
    const sn = snClient()
    const getWalletUser = jest.fn()
    const executor = new BnsTxExecutor({
      snClient: sn,
      getRuntimeType: () => RuntimeType.Browser,
      getCurrentWalletUser: getWalletUser,
    })

    const request = { name: 'alice', mode: 'add' as const, value: 'pkx=abc' }
    await expect(executor.publishDnsTxt(request)).resolves.toMatchObject({
      route: 'sn-proxy',
      operation: 'publish_dns_txt',
    })
    expect(sn.publishDnsTxt).toHaveBeenCalledWith(request)
    expect(getWalletUser).not.toHaveBeenCalled()
  })

  it('uses the SN proxy for a wallet user bound to an SN account', async () => {
    const sn = snClient()
    const executor = new BnsTxExecutor({
      snClient: sn,
      getRuntimeType: () => RuntimeType.AppRuntime,
      getCurrentWalletUser: async () => ({ sn_username: 'alice' }),
    })

    await expect(executor.publishDocument(publishDocumentRequest)).resolves.toMatchObject({
      route: 'sn-proxy',
    })
    expect(sn.publishDocument).toHaveBeenCalledTimes(1)
  })

  it('fails explicitly on the not-yet-implemented unbound wallet route', async () => {
    const sn = snClient()
    const executor = new BnsTxExecutor({
      snClient: sn,
      getRuntimeType: () => RuntimeType.AppRuntime,
      getCurrentWalletUser: async () => ({ user_name: 'alice' }),
    })

    await expect(executor.publishDocument(publishDocumentRequest)).rejects.toMatchObject({
      name: 'BnsTxExecutorError',
      code: 'WALLET_EXECUTION_NOT_IMPLEMENTED',
      route: 'wallet',
    } satisfies Partial<BnsTxExecutorError>)
    expect(sn.publishDocument).not.toHaveBeenCalled()
  })

  it('builds, signs, and submits raw TX locally in a local runtime', async () => {
    const sn = snClient()
    const submitRawTx = jest.fn(async (_rawTx: string | Uint8Array) => ({ tx_hash: '0xabc' }))
    const bnsClient = directBnsClient(submitRawTx)
    const provider = evmProvider()
    const localPrivateKey = jest.fn(async () => LOCAL_PRIVATE_KEY)
    const executor = new BnsTxExecutor({
      snClient: sn,
      bnsClient,
      localPrivateKey,
      evmConfig: EVM_CONFIG,
      evmProvider: provider,
      getRuntimeType: () => RuntimeType.AppClient,
    })

    await expect(executor.publishDocument(publishDocumentRequest)).resolves.toEqual({
      route: 'local',
      operation: 'publish_document',
      response: { tx_hash: '0xabc' },
    })

    const rawTx = submitRawTx.mock.calls[0][0]
    expect(typeof rawTx).toBe('string')
    const tx = Transaction.from(rawTx as string)
    expect(tx.type).toBe(2)
    expect(tx.from).toBe(LOCAL_ADDRESS)
    expect(tx.to).toBe(BNS_CONTRACT_ADDRESS)
    expect(tx.chainId).toBe(31337n)
    expect(tx.nonce).toBe(7)
    expect(tx.gasLimit).toBe(3_000_000n)
    expect(tx.maxFeePerGas).toBe(2_000_000_000n)
    expect(tx.maxPriorityFeePerGas).toBe(1_000_000_000n)

    const decoded = decodeBnsPublishDocumentCalldata(tx.data)
    expect(decoded.name).toBe('alice')
    expect(decoded.docType).toBe('zone')
    expect(decoded.expectedVersion).toBe(0n)
    expect(new TextDecoder().decode(getBytes(decoded.document.inlineDocument))).toBe('{"gateway":"ood1"}')
    expect(decoded.document.contentHash).toBe(sha256(toBytes('{"gateway":"ood1"}')))
    expect(decoded.authority.role).toBe(1n)
    expect(decoded.authority.actor.kind).toBe(1n)
    expect(decoded.authority.actor.value.toLowerCase()).toBe(LOCAL_ADDRESS.toLowerCase())
    expect(decoded.guard.expectedNameSeq).toBe(9n)
    expect(decoded.guard.expectedParentNameSeq).toBe(0n)

    expect(provider.getTransactionCount).toHaveBeenCalledWith(LOCAL_ADDRESS, 'pending')
    expect(localPrivateKey).toHaveBeenCalledTimes(1)
    expect(sn.publishDocument).not.toHaveBeenCalled()
  })

  it('turns a local DNS TXT update into the same publishDocument TX shape', async () => {
    const existingJson = '[{"ttl":300,"value":"old"}]'
    const submitRawTx = jest.fn(async (_rawTx: string | Uint8Array) => ({ tx_hash: '0xdns' }))
    const bnsClient = directBnsClient(submitRawTx)
    bnsClient.resolveDocument.mockImplementation(async () => ({
      status: 'active',
      document_state: {
        version: 2,
        document: {
          storage_type: 'inline',
          inline_document: Array.from(toBytes(existingJson)),
        },
      },
    } as ResolveResult))
    const executor = new BnsTxExecutor({
      bnsClient,
      localPrivateKey: LOCAL_PRIVATE_KEY,
      evmConfig: EVM_CONFIG,
      evmProvider: evmProvider(11),
      getRuntimeType: () => RuntimeType.NodeJS,
    })

    await expect(executor.publishDnsTxt({
      name: 'alice',
      mode: 'add',
      value: 'new',
    })).resolves.toMatchObject({ route: 'local' })

    const tx = Transaction.from(submitRawTx.mock.calls[0][0] as string)
    const decoded = decodeBnsPublishDocumentCalldata(tx.data)
    expect(decoded.docType).toBe('dns_txt')
    expect(decoded.expectedVersion).toBe(2n)
    expect(JSON.parse(new TextDecoder().decode(getBytes(decoded.document.inlineDocument)))).toEqual([
      { ttl: 300, value: 'old' },
      { ttl: 600, value: 'new' },
    ])
  })

  it('does not fall back to the SN proxy after a local submit failure', async () => {
    const sn = snClient()
    const submitError = new Error('insufficient funds for gas * price + value')
    const bnsClient = directBnsClient(jest.fn(async (_rawTx: string | Uint8Array) => { throw submitError }))
    const executor = new BnsTxExecutor({
      snClient: sn,
      bnsClient,
      localPrivateKey: LOCAL_PRIVATE_KEY,
      evmConfig: EVM_CONFIG,
      evmProvider: evmProvider(),
      getRuntimeType: () => RuntimeType.NodeJS,
    })

    await expect(executor.publishDocument(publishDocumentRequest)).rejects.toBe(submitError)
    expect(sn.publishDocument).not.toHaveBeenCalled()
  })

  it('uses the default SN route when local signing is not configured', async () => {
    const sn = snClient()
    const executor = new BnsTxExecutor({
      snClient: sn,
      getRuntimeType: () => RuntimeType.AppService,
    })

    await expect(executor.publishDocument(publishDocumentRequest)).resolves.toMatchObject({
      route: 'sn-proxy',
    })
  })
})

function toBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

describe('walletUserHasSnAccount', () => {
  it.each([
    [{ sn_username: 'alice' }, true],
    [{ sn_user_name: 'alice' }, true],
    [{ sn_account: true }, true],
    [{ sn_account: false, sn_username: 'alice' }, false],
    [{ user_name: 'alice' }, false],
    [null, false],
  ])('detects supported wallet bridge fields for %p', (user, expected) => {
    expect(walletUserHasSnAccount(user)).toBe(expected)
  })
})
