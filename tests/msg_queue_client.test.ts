import { kRPCClient } from '../src/krpc_client'
import {
  MsgQueueClient,
  DEFAULT_QUEUE_CONFIG,
  SubPosition,
  type MsgQueueMessage,
} from '../src/msg_queue_client'

function makeResponse(body: unknown, seq: number = 1) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      result: body,
      sys: [seq],
    }),
  }
}

function bodyOf(fetcher: jest.Mock, callIdx = 0) {
  return JSON.parse((fetcher.mock.calls[callIdx][1] as RequestInit).body as string)
}

function makeMessage(overrides: Partial<MsgQueueMessage> = {}): MsgQueueMessage {
  return {
    index: 1,
    created_at: 1700000000,
    payload: [104, 105], // "hi"
    headers: { 'content-type': 'text/plain' },
    ...overrides,
  }
}

describe('MsgQueueClient', () => {
  it('createQueue forwards name/appid/owner/config and parses queue urn', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse('kmsg://demo/q1', 5))
    const client = new MsgQueueClient(new kRPCClient('/kapi/kmsg/', null, 5, { fetcher }))

    const urn = await client.createQueue('q1', 'demo', 'did:bns:owner')

    expect(urn).toBe('kmsg://demo/q1')
    expect(bodyOf(fetcher)).toEqual({
      method: 'create_queue',
      params: {
        name: 'q1',
        appid: 'demo',
        app_owner: 'did:bns:owner',
        config: DEFAULT_QUEUE_CONFIG,
      },
      sys: [5],
    })
  })

  it('createQueue allows null name and a custom config', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse('kmsg://demo/auto', 6))
    const client = new MsgQueueClient(new kRPCClient('/kapi/kmsg/', null, 6, { fetcher }))

    await client.createQueue(null, 'demo', 'did:bns:owner', {
      max_messages: 100,
      retention_seconds: 3600,
      sync_write: true,
      other_app_can_read: false,
      other_app_can_write: false,
      other_user_can_read: false,
      other_user_can_write: false,
    })

    expect(bodyOf(fetcher).params).toEqual({
      name: null,
      appid: 'demo',
      app_owner: 'did:bns:owner',
      config: {
        max_messages: 100,
        retention_seconds: 3600,
        sync_write: true,
        other_app_can_read: false,
        other_app_can_write: false,
        other_user_can_read: false,
        other_user_can_write: false,
      },
    })
  })

  it('postMessage returns numeric msg index', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse(42, 1))
    const client = new MsgQueueClient(new kRPCClient('/kapi/kmsg/', null, 1, { fetcher }))

    const msg = makeMessage({ index: 0 })
    const idx = await client.postMessage('kmsg://demo/q1', msg)

    expect(idx).toBe(42)
    expect(bodyOf(fetcher)).toEqual({
      method: 'post_message',
      params: {
        queue_urn: 'kmsg://demo/q1',
        message: msg,
      },
      sys: [1],
    })
  })

  it('subscribe sends serde-compatible userid/appid wire fields', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse('sub-001', 2))
    const client = new MsgQueueClient(new kRPCClient('/kapi/kmsg/', null, 2, { fetcher }))

    const subId = await client.subscribe({
      queueUrn: 'kmsg://demo/q1',
      userId: 'did:bns:user',
      appId: 'demo',
      subId: 'my-sub',
      position: SubPosition.at(7),
    })

    expect(subId).toBe('sub-001')
    expect(bodyOf(fetcher)).toEqual({
      method: 'subscribe',
      params: {
        queue_urn: 'kmsg://demo/q1',
        userid: 'did:bns:user',
        appid: 'demo',
        sub_id: 'my-sub',
        position: { At: 7 },
      },
      sys: [2],
    })
  })

  it('subscribe defaults sub_id to null when omitted', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse('sub-002', 3))
    const client = new MsgQueueClient(new kRPCClient('/kapi/kmsg/', null, 3, { fetcher }))

    await client.subscribe({
      queueUrn: 'kmsg://demo/q1',
      userId: 'did:bns:user',
      appId: 'demo',
      position: SubPosition.earliest(),
    })

    expect(bodyOf(fetcher).params).toMatchObject({
      sub_id: null,
      position: 'Earliest',
    })
  })

  it('SubPosition factory helpers produce serde-tagged JSON shapes', () => {
    expect(SubPosition.earliest()).toBe('Earliest')
    expect(SubPosition.latest()).toBe('Latest')
    expect(SubPosition.at(13)).toEqual({ At: 13 })
  })

  it('fetchMessages parses an array of messages', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse([
      makeMessage({ index: 1 }),
      makeMessage({ index: 2, payload: [], headers: {} }),
    ], 4))
    const client = new MsgQueueClient(new kRPCClient('/kapi/kmsg/', null, 4, { fetcher }))

    const messages = await client.fetchMessages('sub-001', 10, true)

    expect(messages).toHaveLength(2)
    expect(messages[0].index).toBe(1)
    expect(messages[1].payload).toEqual([])
    expect(bodyOf(fetcher)).toEqual({
      method: 'fetch_messages',
      params: {
        sub_id: 'sub-001',
        length: 10,
        auto_commit: true,
      },
      sys: [4],
    })
  })

  it('readMessage returns parsed messages', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse([makeMessage({ index: 5 })], 7))
    const client = new MsgQueueClient(new kRPCClient('/kapi/kmsg/', null, 7, { fetcher }))

    const msgs = await client.readMessage('kmsg://demo/q1', 5, 1)

    expect(msgs[0].index).toBe(5)
    expect(bodyOf(fetcher).params).toEqual({
      queue_urn: 'kmsg://demo/q1',
      cursor: 5,
      length: 1,
    })
  })

  it('seek serializes At variant correctly', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse(null, 8))
    const client = new MsgQueueClient(new kRPCClient('/kapi/kmsg/', null, 8, { fetcher }))

    await client.seek('sub-001', SubPosition.at(99))

    expect(bodyOf(fetcher)).toEqual({
      method: 'seek',
      params: { sub_id: 'sub-001', index: { At: 99 } },
      sys: [8],
    })
  })

  it('commitAck forwards sub_id and index', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse(null, 9))
    const client = new MsgQueueClient(new kRPCClient('/kapi/kmsg/', null, 9, { fetcher }))

    await client.commitAck('sub-001', 33)

    expect(bodyOf(fetcher)).toEqual({
      method: 'commit_ack',
      params: { sub_id: 'sub-001', index: 33 },
      sys: [9],
    })
  })

  it('deleteMessageBefore returns the numeric deleted count', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse(7, 10))
    const client = new MsgQueueClient(new kRPCClient('/kapi/kmsg/', null, 10, { fetcher }))

    const deleted = await client.deleteMessageBefore('kmsg://demo/q1', 100)

    expect(deleted).toBe(7)
    expect(bodyOf(fetcher).params).toEqual({ queue_urn: 'kmsg://demo/q1', index: 100 })
  })

  it('getQueueStats parses all numeric fields', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      message_count: 12,
      first_index: 1,
      last_index: 12,
      size_bytes: 1024,
    }, 11))
    const client = new MsgQueueClient(new kRPCClient('/kapi/kmsg/', null, 11, { fetcher }))

    const stats = await client.getQueueStats('kmsg://demo/q1')

    expect(stats).toEqual({
      message_count: 12,
      first_index: 1,
      last_index: 12,
      size_bytes: 1024,
    })
  })

  it('updateQueueConfig forwards the config object', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse(null, 12))
    const client = new MsgQueueClient(new kRPCClient('/kapi/kmsg/', null, 12, { fetcher }))

    await client.updateQueueConfig('kmsg://demo/q1', {
      ...DEFAULT_QUEUE_CONFIG,
      sync_write: true,
    })

    expect(bodyOf(fetcher).params.config.sync_write).toBe(true)
  })

  it('deleteQueue / unsubscribe forward the expected params', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(makeResponse(null, 13))
      .mockResolvedValueOnce(makeResponse(null, 14))
    const client = new MsgQueueClient(new kRPCClient('/kapi/kmsg/', null, 13, { fetcher }))

    await client.deleteQueue('kmsg://demo/q1')
    await client.unsubscribe('sub-001')

    expect(bodyOf(fetcher, 0)).toEqual({
      method: 'delete_queue',
      params: { queue_urn: 'kmsg://demo/q1' },
      sys: [13],
    })
    expect(bodyOf(fetcher, 1)).toMatchObject({
      method: 'unsubscribe',
      params: { sub_id: 'sub-001' },
    })
  })

  it('throws on malformed message list', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse('not an array', 15))
    const client = new MsgQueueClient(new kRPCClient('/kapi/kmsg/', null, 15, { fetcher }))

    await expect(client.fetchMessages('sub-001', 10, false)).rejects.toThrow(
      'expected message list to be an array',
    )
  })

  it('throws on malformed getQueueStats response', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({ message_count: 'oops' }, 16))
    const client = new MsgQueueClient(new kRPCClient('/kapi/kmsg/', null, 16, { fetcher }))

    await expect(client.getQueueStats('kmsg://demo/q1')).rejects.toThrow(
      'expected message_count to be a number',
    )
  })
})
