import { kRPCClient, RPCError } from './krpc_client'

// MsgQueue (kmsg) client.
//
// Mirrors ../../buckyos/src/kernel/buckyos-api/src/msg_queue.rs.
// Naming and method names match the Rust kRPC contract exactly so the
// JSON wire format stays compatible. Where Rust uses serde-tagged enums
// (SubPosition), we expose dedicated factory helpers below.

export const KMSG_SERVICE_NAME = 'kmsg'

export type QueueUrn = string
export type SubscriptionId = string
export type MsgIndex = number

export interface MsgQueueMessage {
  index: MsgIndex
  created_at: number
  // payload is `Vec<u8>` on the Rust side. serde_json serializes it as an
  // array of byte values. We mirror that as a number[] so callers can pass
  // arbitrary binary content without forcing base64 encoding here.
  payload: number[]
  headers: Record<string, string>
}

export interface QueueConfig {
  max_messages?: number | null
  retention_seconds?: number | null
  sync_write: boolean
  other_app_can_read: boolean
  other_app_can_write: boolean
  other_user_can_read: boolean
  other_user_can_write: boolean
}

export const DEFAULT_QUEUE_CONFIG: QueueConfig = {
  max_messages: null,
  retention_seconds: null,
  sync_write: false,
  other_app_can_read: true,
  other_app_can_write: false,
  other_user_can_read: false,
  other_user_can_write: false,
}

export interface QueueStats {
  message_count: number
  first_index: number
  last_index: number
  size_bytes: number
}

// SubPosition is `enum SubPosition { Earliest, Latest, At(MsgIndex) }` on the
// Rust side. serde_json serializes the variants as `"Earliest"`, `"Latest"`,
// `{ "At": 17 }` respectively. The factory helpers below produce the matching
// JSON shape.
export type SubPosition = 'Earliest' | 'Latest' | { At: MsgIndex }

export const SubPosition = {
  earliest(): SubPosition {
    return 'Earliest'
  },
  latest(): SubPosition {
    return 'Latest'
  },
  at(index: MsgIndex): SubPosition {
    return { At: index }
  },
}

export interface SubscribeParams {
  queueUrn: QueueUrn
  userId: string
  appId: string
  subId?: string
  position: SubPosition
}

function asNumber(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RPCError(`expected ${what} to be a number`)
  }
  return value
}

function asString(value: unknown, what: string): string {
  if (typeof value !== 'string') {
    throw new RPCError(`expected ${what} to be a string`)
  }
  return value
}

function asMessageList(value: unknown): MsgQueueMessage[] {
  if (!Array.isArray(value)) {
    throw new RPCError('expected message list to be an array')
  }
  return value.map((entry, idx) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new RPCError(`message[${idx}] is not an object`)
    }
    const record = entry as Record<string, unknown>
    return {
      index: asNumber(record.index, `message[${idx}].index`),
      created_at: asNumber(record.created_at, `message[${idx}].created_at`),
      payload: Array.isArray(record.payload) ? (record.payload as number[]) : [],
      headers:
        record.headers && typeof record.headers === 'object' && !Array.isArray(record.headers)
          ? (record.headers as Record<string, string>)
          : {},
    }
  })
}

export class MsgQueueClient {
  private rpcClient: kRPCClient

  constructor(rpcClient: kRPCClient) {
    this.rpcClient = rpcClient
  }

  setSeq(seq: number) {
    this.rpcClient.setSeq(seq)
  }

  async createQueue(
    name: string | null,
    appid: string,
    appOwner: string,
    config: QueueConfig = { ...DEFAULT_QUEUE_CONFIG },
  ): Promise<QueueUrn> {
    const result = await this.rpcClient.call<unknown, {
      name: string | null
      appid: string
      app_owner: string
      config: QueueConfig
    }>('create_queue', {
      name,
      appid,
      app_owner: appOwner,
      config,
    })
    return asString(result, 'queue_urn')
  }

  async deleteQueue(queueUrn: QueueUrn): Promise<void> {
    await this.rpcClient.call<unknown, { queue_urn: QueueUrn }>('delete_queue', {
      queue_urn: queueUrn,
    })
  }

  async getQueueStats(queueUrn: QueueUrn): Promise<QueueStats> {
    const result = await this.rpcClient.call<unknown, { queue_urn: QueueUrn }>('get_queue_stats', {
      queue_urn: queueUrn,
    })
    if (!result || typeof result !== 'object') {
      throw new RPCError('invalid get_queue_stats response')
    }
    const record = result as Record<string, unknown>
    return {
      message_count: asNumber(record.message_count, 'message_count'),
      first_index: asNumber(record.first_index, 'first_index'),
      last_index: asNumber(record.last_index, 'last_index'),
      size_bytes: asNumber(record.size_bytes, 'size_bytes'),
    }
  }

  async updateQueueConfig(queueUrn: QueueUrn, config: QueueConfig): Promise<void> {
    await this.rpcClient.call<unknown, { queue_urn: QueueUrn; config: QueueConfig }>(
      'update_queue_config',
      { queue_urn: queueUrn, config },
    )
  }

  async postMessage(queueUrn: QueueUrn, message: MsgQueueMessage): Promise<MsgIndex> {
    const result = await this.rpcClient.call<unknown, { queue_urn: QueueUrn; message: MsgQueueMessage }>(
      'post_message',
      { queue_urn: queueUrn, message },
    )
    return asNumber(result, 'msg_index')
  }

  async subscribe(params: SubscribeParams): Promise<SubscriptionId> {
    const result = await this.rpcClient.call<unknown, {
      queue_urn: QueueUrn
      userid: string
      appid: string
      sub_id: string | null
      position: SubPosition
    }>('subscribe', {
      queue_urn: params.queueUrn,
      // Wire fields are `userid` / `appid` to match Rust serde rename rules
      // (#[serde(rename = "userid", alias = "user_id")]).
      userid: params.userId,
      appid: params.appId,
      sub_id: params.subId ?? null,
      position: params.position,
    })
    return asString(result, 'subscription_id')
  }

  async unsubscribe(subId: SubscriptionId): Promise<void> {
    await this.rpcClient.call<unknown, { sub_id: SubscriptionId }>('unsubscribe', { sub_id: subId })
  }

  async fetchMessages(
    subId: SubscriptionId,
    length: number,
    autoCommit: boolean,
  ): Promise<MsgQueueMessage[]> {
    const result = await this.rpcClient.call<unknown, {
      sub_id: SubscriptionId
      length: number
      auto_commit: boolean
    }>('fetch_messages', { sub_id: subId, length, auto_commit: autoCommit })
    return asMessageList(result)
  }

  async readMessage(
    queueUrn: QueueUrn,
    cursor: MsgIndex,
    length: number,
  ): Promise<MsgQueueMessage[]> {
    const result = await this.rpcClient.call<unknown, {
      queue_urn: QueueUrn
      cursor: MsgIndex
      length: number
    }>('read_message', { queue_urn: queueUrn, cursor, length })
    return asMessageList(result)
  }

  async commitAck(subId: SubscriptionId, index: MsgIndex): Promise<void> {
    await this.rpcClient.call<unknown, { sub_id: SubscriptionId; index: MsgIndex }>(
      'commit_ack',
      { sub_id: subId, index },
    )
  }

  async seek(subId: SubscriptionId, index: SubPosition): Promise<void> {
    await this.rpcClient.call<unknown, { sub_id: SubscriptionId; index: SubPosition }>(
      'seek',
      { sub_id: subId, index },
    )
  }

  async deleteMessageBefore(queueUrn: QueueUrn, index: MsgIndex): Promise<number> {
    const result = await this.rpcClient.call<unknown, { queue_urn: QueueUrn; index: MsgIndex }>(
      'delete_message_before',
      { queue_urn: queueUrn, index },
    )
    return asNumber(result, 'deleted_count')
  }
}
