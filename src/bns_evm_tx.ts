// BNS EVM transaction construction for the direct/local executor path.
//
// The ABI below mirrors Bns.sol publishDocument. Both public write helpers
// exposed by SnClient (publish_document and publish_dns_txt) ultimately become
// this contract call; the SN path constructs/signs it on the SN, while the
// local path constructs/signs the same call here.

import canonicalize from 'canonicalize'
import {
  encodeBytes32String,
  getAddress,
  getBytes,
  hexlify,
  Interface,
  JsonRpcProvider,
  sha256,
  toBeHex,
  toUtf8Bytes,
  Wallet,
  ZeroAddress,
  ZeroHash,
} from 'ethers'
import {
  BnsClientError,
  canonicalBnsName,
  canonicalDocType,
  NameState,
  ResolveResult,
} from './bns_client'
import {
  SnBnsPublishDnsTxtReq,
  SnBnsPublishDocumentReq,
} from './sn_client'

export const BNS_EVM_DEFAULT_GAS_LIMIT = 3_000_000n
export const BNS_EVM_DEFAULT_MAX_FEE_PER_GAS = 2_000_000_000n
export const BNS_EVM_DEFAULT_MAX_PRIORITY_FEE_PER_GAS = 1_000_000_000n
export const BNS_MAX_INLINE_DOCUMENT_BYTES = 4096
export const BNS_DNS_TXT_DEFAULT_TTL = 600
export const BNS_DNS_TXT_DOC_TYPE = 'dns_txt'

const MAX_U32 = 0xffff_ffff
const MAX_U64 = (1n << 64n) - 1n

// Selector must stay 0x02c809fc for the current Bns.sol ABI.
export const BNS_PUBLISH_DOCUMENT_ABI = [
  'function publishDocument(string name,string docType,uint64 expectedVersion,(bytes32 storageType,string uri,bytes inlineDocument,bytes32 contentHash,bytes32 schema,bytes32 codec,bytes32 extraHash) document,(uint8 kind,bytes value) controller,(uint8 kind,bytes value) beneficiary,address paymentTarget,uint64 expireAt,bytes32 controllerPolicyHash,bytes32 paymentPolicyHash,bytes32 splitPolicyHash,bytes32 pricePolicyHash,bytes32 rightsPolicyHash,(uint8 role,(uint8 kind,bytes value) actor,bytes32 kid) authority,(uint64 expectedNameSeq,uint64 expectedParentNameSeq) guard) returns (uint64 version)',
] as const

const BNS_INTERFACE = new Interface(BNS_PUBLISH_DOCUMENT_ABI)
const UNSET_PRINCIPAL = [0, '0x'] as const
const STORAGE_TYPE_INLINE = encodeBytes32String('inline')

export type BnsEvmNumberish = bigint | number | string

export interface BnsEvmTxConfig {
  rpcEndpoint: string
  chainId: BnsEvmNumberish
  contractAddress: string
  gasLimit?: BnsEvmNumberish
  maxFeePerGas?: BnsEvmNumberish
  maxPriorityFeePerGas?: BnsEvmNumberish

  // Required only when the effective owner is a BNS-name authority. A direct
  // chain-account owner uses bytes32(0), matching the Rust controller client.
  authorityKid?: string | null
}

export type BnsTxOperation =
  | {
      type: 'publish_dns_txt'
      request: SnBnsPublishDnsTxtReq
    }
  | {
      type: 'publish_document'
      request: SnBnsPublishDocumentReq
    }

export interface BnsEvmStateClient {
  queryNameState(name: string): Promise<NameState | null>
  resolveDocument(name: string, docType: string): Promise<ResolveResult>
}

export interface BnsEvmProvider {
  getTransactionCount(address: string, blockTag?: 'pending'): Promise<number>
}

export type BnsEvmTxErrorCode =
  | 'INVALID_CONFIG'
  | 'INVALID_OPERATION'
  | 'NAME_NOT_FOUND'
  | 'LOCAL_SIGNER_NOT_OWNER'
  | 'AUTHORITY_KID_REQUIRED'
  | 'INVALID_DOCUMENT'

export class BnsEvmTxError extends Error {
  readonly code: BnsEvmTxErrorCode

  constructor(code: BnsEvmTxErrorCode, message: string) {
    super(message)
    this.name = 'BnsEvmTxError'
    this.code = code
  }
}

interface PreparedDocumentUpdate {
  name: string
  docType: string
  expectedVersion: number
  inlineDocument: Uint8Array
  nameState: NameState
}

interface DnsTxtRecord {
  ttl: number
  value: string
}

function toConfigBigInt(field: string, value: BnsEvmNumberish, max?: bigint): bigint {
  let parsed: bigint
  try {
    parsed = BigInt(value)
  } catch {
    throw new BnsEvmTxError('INVALID_CONFIG', `${field} must be an integer`)
  }
  if (parsed < 0n || (max !== undefined && parsed > max)) {
    throw new BnsEvmTxError('INVALID_CONFIG', `${field} is out of range`)
  }
  return parsed
}

function normalizeBytes32(field: string, value: string | null | undefined): string {
  if (!value) {
    return ZeroHash
  }
  const bytes = getBytes(value)
  if (bytes.length !== 32) {
    throw new BnsEvmTxError('INVALID_CONFIG', `${field} must be a 32-byte hex value`)
  }
  return hexlify(bytes)
}

function canonicalJsonBytes(value: unknown): Uint8Array {
  const canonical = canonicalize(value)
  if (typeof canonical !== 'string') {
    throw new BnsEvmTxError('INVALID_DOCUMENT', 'document cannot be encoded as canonical JSON')
  }
  const bytes = toUtf8Bytes(canonical)
  if (bytes.length === 0 || bytes.length > BNS_MAX_INLINE_DOCUMENT_BYTES) {
    throw new BnsEvmTxError(
      'INVALID_DOCUMENT',
      `inline document is ${bytes.length} bytes, max ${BNS_MAX_INLINE_DOCUMENT_BYTES}`,
    )
  }
  return bytes
}

function decodeUtf8(bytes: number[]): string {
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder().decode(new Uint8Array(bytes))
  }
  let value = ''
  for (const byte of bytes) {
    value += String.fromCharCode(byte)
  }
  try {
    return decodeURIComponent(escape(value))
  } catch {
    return value
  }
}

function validateDnsTxtRecord(record: unknown, path: string): DnsTxtRecord {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new BnsEvmTxError('INVALID_DOCUMENT', `${path} must be an object`)
  }
  const source = record as { ttl?: unknown; value?: unknown }
  if (!Number.isInteger(source.ttl) || (source.ttl as number) < 0 || (source.ttl as number) > MAX_U32) {
    throw new BnsEvmTxError('INVALID_DOCUMENT', `${path}.ttl must be a u32`)
  }
  if (typeof source.value !== 'string' || source.value.length === 0) {
    throw new BnsEvmTxError('INVALID_DOCUMENT', `${path}.value must be a non-empty string`)
  }
  return { ttl: source.ttl as number, value: source.value }
}

function isDocumentNotFound(error: unknown): boolean {
  return error instanceof BnsClientError && error.isRegistryCode('DOCUMENT_NOT_FOUND')
}

function walletAddressPrincipal(address: string): [number, string] {
  return [1, hexlify(getBytes(address))]
}

export class BnsEvmTxBuilder {
  private readonly client: BnsEvmStateClient
  private readonly config: BnsEvmTxConfig
  private readonly provider: BnsEvmProvider
  private readonly chainId: bigint
  private readonly contractAddress: string
  private readonly gasLimit: bigint
  private readonly maxFeePerGas: bigint
  private readonly maxPriorityFeePerGas: bigint
  private nextNonce: number | null = null

  constructor(
    client: BnsEvmStateClient,
    config: BnsEvmTxConfig,
    provider?: BnsEvmProvider | null,
  ) {
    this.client = client
    this.config = config
    this.chainId = toConfigBigInt('chainId', config.chainId, MAX_U64)
    this.contractAddress = getAddress(config.contractAddress)
    this.gasLimit = toConfigBigInt('gasLimit', config.gasLimit ?? BNS_EVM_DEFAULT_GAS_LIMIT, MAX_U64)
    this.maxFeePerGas = toConfigBigInt(
      'maxFeePerGas',
      config.maxFeePerGas ?? BNS_EVM_DEFAULT_MAX_FEE_PER_GAS,
    )
    this.maxPriorityFeePerGas = toConfigBigInt(
      'maxPriorityFeePerGas',
      config.maxPriorityFeePerGas ?? BNS_EVM_DEFAULT_MAX_PRIORITY_FEE_PER_GAS,
    )
    if (!config.rpcEndpoint && !provider) {
      throw new BnsEvmTxError('INVALID_CONFIG', 'rpcEndpoint is required')
    }
    if (this.chainId === 0n || this.gasLimit === 0n) {
      throw new BnsEvmTxError('INVALID_CONFIG', 'chainId and gasLimit must be greater than zero')
    }
    if (this.maxFeePerGas < this.maxPriorityFeePerGas) {
      throw new BnsEvmTxError('INVALID_CONFIG', 'maxFeePerGas must be >= maxPriorityFeePerGas')
    }
    this.provider = provider ?? new JsonRpcProvider(config.rpcEndpoint, this.chainId, {
      staticNetwork: true,
    })
  }

  resetNonce(): void {
    this.nextNonce = null
  }

  async buildAndSign(operation: BnsTxOperation, privateKey: string): Promise<string> {
    const wallet = new Wallet(privateKey)
    const update = operation.type === 'publish_document'
      ? await this.preparePublishedDocument(operation.request)
      : await this.prepareDnsTxtDocument(operation.request)
    const data = this.encodePublishDocument(update, wallet.address)
    const nonce = await this.allocateNonce(wallet.address)

    try {
      return await wallet.signTransaction({
        type: 2,
        chainId: this.chainId,
        nonce,
        to: this.contractAddress,
        value: 0,
        data,
        gasLimit: this.gasLimit,
        maxFeePerGas: this.maxFeePerGas,
        maxPriorityFeePerGas: this.maxPriorityFeePerGas,
      })
    } catch (error) {
      this.resetNonce()
      throw error
    }
  }

  private async allocateNonce(address: string): Promise<number> {
    if (this.nextNonce === null) {
      this.nextNonce = await this.provider.getTransactionCount(address, 'pending')
    }
    const nonce = this.nextNonce
    this.nextNonce += 1
    return nonce
  }

  private async preparePublishedDocument(
    request: SnBnsPublishDocumentReq,
  ): Promise<PreparedDocumentUpdate> {
    if (!request.document || typeof request.document !== 'object' || Array.isArray(request.document)) {
      throw new BnsEvmTxError('INVALID_DOCUMENT', 'publish_document document must be a JSON object')
    }
    return this.prepareDocument(
      request.name,
      request.doc_type,
      canonicalJsonBytes(request.document),
    )
  }

  private async prepareDnsTxtDocument(
    request: SnBnsPublishDnsTxtReq,
  ): Promise<PreparedDocumentUpdate> {
    const current = await this.getCurrentDocument(request.name, BNS_DNS_TXT_DOC_TYPE)
    let records: DnsTxtRecord[] = []
    if (current) {
      if (current.document_state.document.storage_type !== 'inline') {
        throw new BnsEvmTxError('INVALID_DOCUMENT', 'DNS TXT helper can only update inline documents')
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(decodeUtf8(current.document_state.document.inline_document))
      } catch (error) {
        throw new BnsEvmTxError(
          'INVALID_DOCUMENT',
          `current dns_txt document is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
      if (!Array.isArray(parsed)) {
        throw new BnsEvmTxError('INVALID_DOCUMENT', 'current dns_txt document must be an array')
      }
      records = parsed.map((record, index) => validateDnsTxtRecord(record, `dns_txt[${index}]`))
    }

    switch (request.mode) {
      case 'add': {
        if (!request.value) {
          throw new BnsEvmTxError('INVALID_OPERATION', 'publish_dns_txt mode=add requires value')
        }
        const next = validateDnsTxtRecord({
          ttl: request.ttl ?? BNS_DNS_TXT_DEFAULT_TTL,
          value: request.value,
        }, 'dns_txt')
        if (!records.some((record) => record.value === next.value)) {
          records.push(next)
        }
        break
      }
      case 'remove':
        if (!request.value) {
          throw new BnsEvmTxError('INVALID_OPERATION', 'publish_dns_txt mode=remove requires value')
        }
        records = records.filter((record) => record.value !== request.value)
        break
      case 'replace':
        if (!request.records) {
          throw new BnsEvmTxError('INVALID_OPERATION', 'publish_dns_txt mode=replace requires records')
        }
        records = request.records.map((record, index) => validateDnsTxtRecord({
          ttl: record.ttl ?? BNS_DNS_TXT_DEFAULT_TTL,
          value: record.value,
        }, `dns_txt[${index}]`))
        break
      default:
        throw new BnsEvmTxError(
          'INVALID_OPERATION',
          `publish_dns_txt mode \`${request.mode}\` is not supported`,
        )
    }

    const nameState = await this.getNameState(request.name)
    return {
      name: canonicalBnsName(request.name),
      docType: BNS_DNS_TXT_DOC_TYPE,
      expectedVersion: current?.document_state.version ?? 0,
      inlineDocument: canonicalJsonBytes(records),
      nameState,
    }
  }

  private async prepareDocument(
    nameInput: string,
    docTypeInput: string,
    inlineDocument: Uint8Array,
  ): Promise<PreparedDocumentUpdate> {
    const name = canonicalBnsName(nameInput)
    const docType = canonicalDocType(docTypeInput)
    const [nameState, current] = await Promise.all([
      this.getNameState(name),
      this.getCurrentDocument(name, docType),
    ])
    return {
      name,
      docType,
      expectedVersion: current?.document_state.version ?? 0,
      inlineDocument,
      nameState,
    }
  }

  private async getNameState(name: string): Promise<NameState> {
    const state = await this.client.queryNameState(name)
    if (!state) {
      throw new BnsEvmTxError('NAME_NOT_FOUND', `BNS name \`${name}\` was not found`)
    }
    return state
  }

  private async getCurrentDocument(name: string, docType: string): Promise<ResolveResult | null> {
    try {
      const result = await this.client.resolveDocument(name, docType)
      return result.status === 'missing' ? null : result
    } catch (error) {
      if (isDocumentNotFound(error)) {
        return null
      }
      throw error
    }
  }

  private encodePublishDocument(update: PreparedDocumentUpdate, signerAddress: string): string {
    const authority = this.ownerAuthority(update.nameState, signerAddress)
    const document = [
      STORAGE_TYPE_INLINE,
      '',
      hexlify(update.inlineDocument),
      sha256(update.inlineDocument),
      ZeroHash,
      ZeroHash,
      ZeroHash,
    ]

    return BNS_INTERFACE.encodeFunctionData('publishDocument', [
      update.name,
      update.docType,
      update.expectedVersion,
      document,
      UNSET_PRINCIPAL,
      UNSET_PRINCIPAL,
      ZeroAddress,
      0,
      ZeroHash,
      ZeroHash,
      ZeroHash,
      ZeroHash,
      ZeroHash,
      authority,
      [update.nameState.name_seq, 0],
    ])
  }

  private ownerAuthority(nameState: NameState, signerAddress: string): [number, [number, string], string] {
    const effectiveOwner = nameState.effective_owner
    if (effectiveOwner.kind === 'chain_account') {
      const ownerAddress = getAddress(effectiveOwner.value)
      if (ownerAddress !== getAddress(signerAddress)) {
        throw new BnsEvmTxError(
          'LOCAL_SIGNER_NOT_OWNER',
          `local signer ${signerAddress} is not effective owner ${ownerAddress} of ${nameState.name}`,
        )
      }
      return [1, walletAddressPrincipal(signerAddress), ZeroHash]
    }

    if (effectiveOwner.kind === 'bns_name') {
      const kid = normalizeBytes32('authorityKid', this.config.authorityKid)
      if (kid === ZeroHash) {
        throw new BnsEvmTxError(
          'AUTHORITY_KID_REQUIRED',
          `authorityKid is required when ${nameState.name} is controlled by BNS name ${effectiveOwner.value}`,
        )
      }
      return [1, [2, hexlify(toUtf8Bytes(effectiveOwner.value))], kid]
    }

    throw new BnsEvmTxError(
      'LOCAL_SIGNER_NOT_OWNER',
      `BNS name ${nameState.name} has no concrete effective owner`,
    )
  }
}

// Exported for ABI regression tests and advanced diagnostics. Operation users
// should call BnsTxExecutor instead of encoding calldata themselves.
export function decodeBnsPublishDocumentCalldata(data: string): ReturnType<Interface['decodeFunctionData']> {
  return BNS_INTERFACE.decodeFunctionData('publishDocument', data)
}
