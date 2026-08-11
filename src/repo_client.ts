import { kRPCClient, RPCError } from './krpc_client'

// Repo (repo-service) client.
//
// Mirrors ../../buckyos/src/kernel/buckyos-api/src/repo_client.rs.
// Most of the heavy nested types come from ndn-lib (`ActionObject`,
// `InclusionProof`, `ObjId`) — we keep those as opaque pass-through JSON shapes
// to avoid drift, while modeling the small repo-service-local DTOs explicitly.

export const REPO_SERVICE_NAME = 'repo-service'
export const REPO_SERVICE_PORT = 4000

export const REPO_STATUS_COLLECTED = 'collected'
export const REPO_STATUS_PINNED = 'pinned'

export const REPO_ORIGIN_LOCAL = 'local'
export const REPO_ORIGIN_REMOTE = 'remote'

export const REPO_ACCESS_POLICY_FREE = 'free'
export const REPO_ACCESS_POLICY_PAID = 'paid'

export const REPO_PROOF_TYPE_COLLECTION = 'collection_proof'
export const REPO_PROOF_TYPE_REFERRAL = 'referral_proof'
export const REPO_PROOF_TYPE_DOWNLOAD = 'download_proof'
export const REPO_PROOF_TYPE_INSTALL = 'install_proof'

export const REPO_SERVE_STATUS_OK = 'ok'
export const REPO_SERVE_STATUS_REJECT = 'reject'

// ndn-lib types — opaque on the wire.
export type ObjId = string
export type RepoActionProof = Record<string, unknown>
export type RepoCollectionProof = Record<string, unknown>

// `enum RepoProof` is `#[serde(tag = "kind", content = "value")]` so JSON looks
// like `{ "kind": "Action", "value": <ActionObject> }`.
export type RepoProof =
  | { kind: 'Action'; value: RepoActionProof }
  | { kind: 'Collection'; value: RepoCollectionProof }

export const RepoProof = {
  action(proof: RepoActionProof): RepoProof {
    return { kind: 'Action', value: proof }
  },
  collection(proof: RepoCollectionProof): RepoProof {
    return { kind: 'Collection', value: proof }
  },
}

export interface RepoRecord {
  content_id: string
  content_name?: string
  status: string
  origin: string
  meta: unknown
  owner_did?: string
  author?: string
  access_policy: string
  price?: string
  content_size?: number
  collected_at?: number
  pinned_at?: number
  updated_at?: number
}

export interface RepoProofFilter {
  proof_type?: string
  from_did?: string
  to_did?: string
  start_ts?: number
  end_ts?: number
}

export interface RepoListFilter {
  status?: string
  origin?: string
  content_name?: string
  owner_did?: string
}

export interface RepoStat {
  total_objects: number
  collected_objects: number
  pinned_objects: number
  local_objects: number
  remote_objects: number
  total_content_bytes: number
  total_proofs: number
}

export interface RepoContentRef {
  content_id: string
  access_url?: string
  metadata?: unknown
}

export interface RepoServeRequestContext {
  requester_did?: string
  requester_device_id?: string
  receipt?: unknown
  extra?: unknown
}

export interface RepoServeResult {
  status: string
  content_ref?: RepoContentRef
  download_proof?: RepoActionProof
  reject_code?: string
  reject_reason?: string
}

function compact<T extends Record<string, unknown>>(input: T): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) {
    if (v !== undefined) {
      out[k] = v
    }
  }
  return out
}

function asString(value: unknown, what: string): string {
  if (typeof value !== 'string') {
    throw new RPCError(`expected ${what} to be a string`)
  }
  return value
}

function asBoolean(value: unknown, what: string): boolean {
  if (typeof value !== 'boolean') {
    throw new RPCError(`expected ${what} to be a boolean`)
  }
  return value
}

function asNumber(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RPCError(`expected ${what} to be a number`)
  }
  return value
}

function asArray<T = unknown>(value: unknown, what: string): T[] {
  if (!Array.isArray(value)) {
    throw new RPCError(`expected ${what} to be an array`)
  }
  return value as T[]
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RPCError(`expected ${what} to be an object`)
  }
  return value as Record<string, unknown>
}

export class RepoClient {
  private rpcClient: kRPCClient

  constructor(rpcClient: kRPCClient) {
    this.rpcClient = rpcClient
  }

  setSeq(seq: number) {
    this.rpcClient.setSeq(seq)
  }

  async store(contentId: string): Promise<ObjId> {
    const result = await this.rpcClient.call<unknown, { content_id: string }>('store', {
      content_id: contentId,
    })
    return asString(result, 'ObjId')
  }

  async collect(contentMeta: unknown, referralProof?: RepoActionProof): Promise<string> {
    const result = await this.rpcClient.call<unknown, Record<string, unknown>>(
      'collect',
      compact({ content_meta: contentMeta, referral_proof: referralProof }),
    )
    return asString(result, 'content_id')
  }

  async pin(contentId: string, downloadProof: RepoActionProof): Promise<boolean> {
    const result = await this.rpcClient.call<unknown, {
      content_id: string
      download_proof: RepoActionProof
    }>('pin', { content_id: contentId, download_proof: downloadProof })
    return asBoolean(result, 'pin response')
  }

  async unpin(contentId: string, force: boolean = false): Promise<boolean> {
    const result = await this.rpcClient.call<unknown, { content_id: string; force: boolean }>(
      'unpin',
      { content_id: contentId, force },
    )
    return asBoolean(result, 'unpin response')
  }

  async uncollect(contentId: string, force: boolean = false): Promise<boolean> {
    const result = await this.rpcClient.call<unknown, { content_id: string; force: boolean }>(
      'uncollect',
      { content_id: contentId, force },
    )
    return asBoolean(result, 'uncollect response')
  }

  async addProof(proof: RepoProof): Promise<string> {
    const result = await this.rpcClient.call<unknown, { proof: RepoProof }>('add_proof', { proof })
    return asString(result, 'proof_id')
  }

  async getProofs(contentId: string, filter?: RepoProofFilter): Promise<RepoProof[]> {
    const result = await this.rpcClient.call<unknown, Record<string, unknown>>(
      'get_proofs',
      compact({ content_id: contentId, filter }),
    )
    const arr = asArray<unknown>(result, 'Vec<RepoProof>')
    return arr.map((entry, idx) => {
      const record = asRecord(entry, `RepoProof[${idx}]`)
      if (record.kind !== 'Action' && record.kind !== 'Collection') {
        throw new RPCError(`RepoProof[${idx}] has unknown kind: ${String(record.kind)}`)
      }
      return record as unknown as RepoProof
    })
  }

  async resolve(contentName: string): Promise<ObjId[]> {
    const result = await this.rpcClient.call<unknown, { content_name: string }>('resolve', {
      content_name: contentName,
    })
    const arr = asArray<unknown>(result, 'Vec<ObjId>')
    return arr.map((entry, idx) => asString(entry, `ObjId[${idx}]`))
  }

  async list(filter?: RepoListFilter): Promise<RepoRecord[]> {
    const result = await this.rpcClient.call<unknown, Record<string, unknown>>(
      'list',
      compact({ filter }),
    )
    const arr = asArray<unknown>(result, 'Vec<RepoRecord>')
    return arr.map((entry, idx) => {
      const record = asRecord(entry, `RepoRecord[${idx}]`)
      return {
        content_id: asString(record.content_id, `RepoRecord[${idx}].content_id`),
        content_name: typeof record.content_name === 'string' ? record.content_name : undefined,
        status: asString(record.status, `RepoRecord[${idx}].status`),
        origin: asString(record.origin, `RepoRecord[${idx}].origin`),
        meta: record.meta,
        owner_did: typeof record.owner_did === 'string' ? record.owner_did : undefined,
        author: typeof record.author === 'string' ? record.author : undefined,
        access_policy: asString(record.access_policy, `RepoRecord[${idx}].access_policy`),
        price: typeof record.price === 'string' ? record.price : undefined,
        content_size: typeof record.content_size === 'number' ? record.content_size : undefined,
        collected_at: typeof record.collected_at === 'number' ? record.collected_at : undefined,
        pinned_at: typeof record.pinned_at === 'number' ? record.pinned_at : undefined,
        updated_at: typeof record.updated_at === 'number' ? record.updated_at : undefined,
      }
    })
  }

  async stat(): Promise<RepoStat> {
    const result = await this.rpcClient.call<unknown, Record<string, never>>('stat', {})
    const record = asRecord(result, 'RepoStat')
    return {
      total_objects: asNumber(record.total_objects, 'RepoStat.total_objects'),
      collected_objects: asNumber(record.collected_objects, 'RepoStat.collected_objects'),
      pinned_objects: asNumber(record.pinned_objects, 'RepoStat.pinned_objects'),
      local_objects: asNumber(record.local_objects, 'RepoStat.local_objects'),
      remote_objects: asNumber(record.remote_objects, 'RepoStat.remote_objects'),
      total_content_bytes: asNumber(record.total_content_bytes, 'RepoStat.total_content_bytes'),
      total_proofs: asNumber(record.total_proofs, 'RepoStat.total_proofs'),
    }
  }

  async serve(contentId: string, requestContext: RepoServeRequestContext): Promise<RepoServeResult> {
    const result = await this.rpcClient.call<unknown, {
      content_id: string
      request_context: RepoServeRequestContext
    }>('serve', { content_id: contentId, request_context: requestContext })
    const record = asRecord(result, 'RepoServeResult')
    return {
      status: asString(record.status, 'RepoServeResult.status'),
      content_ref:
        record.content_ref && typeof record.content_ref === 'object'
          ? (record.content_ref as RepoContentRef)
          : undefined,
      download_proof:
        record.download_proof && typeof record.download_proof === 'object'
          ? (record.download_proof as RepoActionProof)
          : undefined,
      reject_code: typeof record.reject_code === 'string' ? record.reject_code : undefined,
      reject_reason: typeof record.reject_reason === 'string' ? record.reject_reason : undefined,
    }
  }

  async announce(contentId: string): Promise<boolean> {
    const result = await this.rpcClient.call<unknown, { content_id: string }>('announce', {
      content_id: contentId,
    })
    return asBoolean(result, 'announce response')
  }
}
