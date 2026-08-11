import { kRPCClient } from './krpc_client';
export declare const KMSG_SERVICE_NAME = "kmsg";
export type QueueUrn = string;
export type SubscriptionId = string;
export type MsgIndex = number;
export interface MsgQueueMessage {
    index: MsgIndex;
    created_at: number;
    payload: number[];
    headers: Record<string, string>;
}
export interface QueueConfig {
    max_messages?: number | null;
    retention_seconds?: number | null;
    sync_write: boolean;
    other_app_can_read: boolean;
    other_app_can_write: boolean;
    other_user_can_read: boolean;
    other_user_can_write: boolean;
}
export declare const DEFAULT_QUEUE_CONFIG: QueueConfig;
export interface QueueStats {
    message_count: number;
    first_index: number;
    last_index: number;
    size_bytes: number;
}
export type SubPosition = 'Earliest' | 'Latest' | {
    At: MsgIndex;
};
export declare const SubPosition: {
    earliest(): SubPosition;
    latest(): SubPosition;
    at(index: MsgIndex): SubPosition;
};
export interface SubscribeParams {
    queueUrn: QueueUrn;
    userId: string;
    appId: string;
    subId?: string;
    position: SubPosition;
}
export declare class MsgQueueClient {
    private rpcClient;
    constructor(rpcClient: kRPCClient);
    setSeq(seq: number): void;
    createQueue(name: string | null, appid: string, appOwner: string, config?: QueueConfig): Promise<QueueUrn>;
    deleteQueue(queueUrn: QueueUrn): Promise<void>;
    getQueueStats(queueUrn: QueueUrn): Promise<QueueStats>;
    updateQueueConfig(queueUrn: QueueUrn, config: QueueConfig): Promise<void>;
    postMessage(queueUrn: QueueUrn, message: MsgQueueMessage): Promise<MsgIndex>;
    subscribe(params: SubscribeParams): Promise<SubscriptionId>;
    unsubscribe(subId: SubscriptionId): Promise<void>;
    fetchMessages(subId: SubscriptionId, length: number, autoCommit: boolean): Promise<MsgQueueMessage[]>;
    readMessage(queueUrn: QueueUrn, cursor: MsgIndex, length: number): Promise<MsgQueueMessage[]>;
    commitAck(subId: SubscriptionId, index: MsgIndex): Promise<void>;
    seek(subId: SubscriptionId, index: SubPosition): Promise<void>;
    deleteMessageBefore(queueUrn: QueueUrn, index: MsgIndex): Promise<number>;
}
//# sourceMappingURL=msg_queue_client.d.ts.map