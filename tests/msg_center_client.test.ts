import { kRPCClient } from '../src/krpc_client'
import { MsgCenterClient } from '../src/msg_center_client'

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

describe('MsgCenterClient', () => {
  it('dispatch forwards msg/ingress_ctx/idempotency_key and parses DispatchResult', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      ok: true,
      msg_id: 'mobj://msg-1',
      delivered_recipients: ['did:bns:alice'],
      dropped_recipients: [],
    }, 1))
    const client = new MsgCenterClient(new kRPCClient('/kapi/msg-center/', null, 1, { fetcher }))

    const out = await client.dispatch(
      { id: 'mobj://msg-1', kind: 'text', content: 'hi' },
      { transport_did: 'did:tunnel:wechat-main', platform: 'wechat', context_id: 'ctx-1' },
      'idem-1',
    )

    expect(out.ok).toBe(true)
    expect(bodyOf(fetcher)).toEqual({
      method: 'msg.dispatch',
      params: {
        msg: { id: 'mobj://msg-1', kind: 'text', content: 'hi' },
        ingress_ctx: {
          transport_did: 'did:tunnel:wechat-main',
          platform: 'wechat',
          context_id: 'ctx-1',
        },
        idempotency_key: 'idem-1',
      },
      sys: [1],
    })
  })

  it('dispatch omits undefined optional fields from the wire payload', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({ ok: true, msg_id: 'm1' }, 1))
    const client = new MsgCenterClient(new kRPCClient('/kapi/msg-center/', null, 1, { fetcher }))

    await client.dispatch({ id: 'm1' })

    expect(bodyOf(fetcher).params).toEqual({ msg: { id: 'm1' } })
  })

  it('postSend forwards msg/idempotency_key and parses PostSendResult', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      ok: true,
      msg_id: 'mobj://msg-2',
      deliveries: [{
        delivery_id: 'delivery-1',
        transport_did: 'did:tunnel:1',
        target_did: 'did:msgtunnel:alice.user.tg-main',
        transport: { kind: 'tunnel', platform: 'telegram', tunnel_instance_id: 'tg-main' },
      }],
    }, 2))
    const client = new MsgCenterClient(new kRPCClient('/kapi/msg-center/', null, 2, { fetcher }))

    const result = await client.postSend({ id: 'm2' }, 'idem-2')

    expect(result.ok).toBe(true)
    expect(bodyOf(fetcher)).toEqual({
      method: 'msg.post_send',
      params: { msg: { id: 'm2' }, idempotency_key: 'idem-2' },
      sys: [2],
    })
  })

  it('getNext returns null when the server reports an empty box', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse(null, 3))
    const client = new MsgCenterClient(new kRPCClient('/kapi/msg-center/', null, 3, { fetcher }))

    const result = await client.getNext({ owner: 'did:bns:user', box_kind: 'INBOX' })

    expect(result).toBeNull()
    expect(bodyOf(fetcher)).toEqual({
      method: 'msg.get_next',
      params: { owner: 'did:bns:user', box_kind: 'INBOX' },
      sys: [3],
    })
  })

  it('getNextDelivery reads the transport delivery queue', async () => {
    const record = {
      record: { delivery_id: 'delivery-1', state: 'SENDING' },
      msg: { id: 'm1' },
    }
    const fetcher = jest.fn().mockResolvedValue(makeResponse(record, 3))
    const client = new MsgCenterClient(new kRPCClient('/kapi/msg-center/', null, 3, { fetcher }))

    const result = await client.getNextDelivery({
      transport_did: 'did:tunnel:tg-main',
      lock_on_take: true,
      with_object: true,
    })

    expect(result).toEqual(record)
    expect(bodyOf(fetcher).params).toEqual({
      transport_did: 'did:tunnel:tg-main',
      lock_on_take: true,
      with_object: true,
    })
  })

  it('peekBox returns parsed records and forwards filters', async () => {
    const records = [
      { record: { record_id: 'r1', state: 'UNREAD' }, msg: null },
      { record: { record_id: 'r2', state: 'READING' }, msg: { id: 'm1' } },
    ]
    const fetcher = jest.fn().mockResolvedValue(makeResponse(records, 4))
    const client = new MsgCenterClient(new kRPCClient('/kapi/msg-center/', null, 4, { fetcher }))

    const out = await client.peekBox({
      owner: 'did:bns:user',
      box_kind: 'INBOX',
      state_filter: ['UNREAD', 'READING'],
      limit: 10,
      with_object: true,
    })

    expect(out).toHaveLength(2)
    expect(bodyOf(fetcher).params).toEqual({
      owner: 'did:bns:user',
      box_kind: 'INBOX',
      state_filter: ['UNREAD', 'READING'],
      limit: 10,
      with_object: true,
    })
  })

  it('listBoxByTime forwards cursor fields and returns a typed page', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      items: [{ record: { record_id: 'r1' }, msg: null }],
      next_cursor_sort_key: 99,
      next_cursor_record_id: 'r1',
    }, 5))
    const client = new MsgCenterClient(new kRPCClient('/kapi/msg-center/', null, 5, { fetcher }))

    const page = await client.listBoxByTime({
      owner: 'did:bns:user',
      box_kind: 'INBOX',
      cursor_sort_key: 100,
      descending: true,
    })

    expect(page.items).toHaveLength(1)
    expect(page.next_cursor_sort_key).toBe(99)
    expect(page.next_cursor_record_id).toBe('r1')
    expect(bodyOf(fetcher).params).toEqual({
      owner: 'did:bns:user',
      box_kind: 'INBOX',
      cursor_sort_key: 100,
      descending: true,
    })
  })

  it('listSessions and listSession forward projection cursors', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(makeResponse({ next_cursor_session_id: 's1' }, 5))
      .mockResolvedValueOnce(makeResponse({ next_cursor_record_id: 'r1' }, 6))
    const client = new MsgCenterClient(new kRPCClient('/kapi/msg-center/', null, 5, { fetcher }))

    const sessions = await client.listSessions({
      owner: 'did:bns:user',
      cursor_updated_at_ms: 100,
      cursor_session_id: 's2',
      with_object: true,
    })
    const messages = await client.listSession({
      owner: 'did:bns:user',
      session_id: 's1',
      cursor_sort_key: 99,
      descending: true,
    })

    expect(bodyOf(fetcher, 0).params).toEqual({
      owner: 'did:bns:user',
      cursor_updated_at_ms: 100,
      cursor_session_id: 's2',
      with_object: true,
    })
    expect(bodyOf(fetcher, 1).params).toEqual({
      owner: 'did:bns:user',
      session_id: 's1',
      cursor_sort_key: 99,
      descending: true,
    })
    expect(sessions.items).toEqual([])
    expect(messages.items).toEqual([])
  })

  it('updateRecordState uses recipient state and omits the removed reason field', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({ record_id: 'r1', state: 'READ' }, 6))
    const client = new MsgCenterClient(new kRPCClient('/kapi/msg-center/', null, 6, { fetcher }))

    await client.updateRecordState('r1', 'READ')

    expect(bodyOf(fetcher)).toEqual({
      method: 'msg.update_record_state',
      params: { record_id: 'r1', new_state: 'READ' },
      sys: [6],
    })
  })

  it('reportDelivery wraps the result payload', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({ delivery_id: 'delivery-1' }, 7))
    const client = new MsgCenterClient(new kRPCClient('/kapi/msg-center/', null, 7, { fetcher }))

    await client.reportDelivery('delivery-1', { ok: true, external_msg_id: 'ext-1' })

    expect(bodyOf(fetcher)).toEqual({
      method: 'msg.report_delivery',
      params: {
        delivery_id: 'delivery-1',
        result: { ok: true, external_msg_id: 'ext-1' },
      },
      sys: [7],
    })
  })

  it('setReadState forwards optional reason/at_ms when present', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      msg_id: 'm1',
      iss: 'did:bns:server',
      reader: 'did:bns:alice',
      at_ms: 1700,
      status: 'READED',
    }, 8))
    const client = new MsgCenterClient(new kRPCClient('/kapi/msg-center/', null, 8, { fetcher }))

    await client.setReadState({
      group_id: 'did:bns:group-1',
      msg_id: 'm1',
      reader_did: 'did:bns:alice',
      status: 'READED',
      at_ms: 1700,
    })

    expect(bodyOf(fetcher).params).toEqual({
      group_id: 'did:bns:group-1',
      msg_id: 'm1',
      reader_did: 'did:bns:alice',
      status: 'READED',
      at_ms: 1700,
    })
  })

  it('getRecord returns null on null result', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse(null, 9))
    const client = new MsgCenterClient(new kRPCClient('/kapi/msg-center/', null, 9, { fetcher }))

    expect(await client.getRecord('r1', true)).toBeNull()
    expect(bodyOf(fetcher).params).toEqual({ record_id: 'r1', with_object: true })
  })

  it('getMessage returns the parsed MsgObject or null', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(makeResponse({ id: 'm1', kind: 'text' }, 10))
      .mockResolvedValueOnce(makeResponse(null, 11))
    const client = new MsgCenterClient(new kRPCClient('/kapi/msg-center/', null, 10, { fetcher }))

    const present = await client.getMessage('m1')
    const missing = await client.getMessage('m2')

    expect(present).toEqual({ id: 'm1', kind: 'text' })
    expect(missing).toBeNull()
  })

  it('supports ui_session state RPCs', async () => {
    const entry = { session_id: 's1', key: 'typing', value: true, updated_at_ms: 100 }
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(makeResponse(entry, 10))
      .mockResolvedValueOnce(makeResponse(entry, 11))
      .mockResolvedValueOnce(makeResponse([entry], 12))
    const client = new MsgCenterClient(new kRPCClient('/kapi/msg-center/', null, 10, { fetcher }))

    await client.updateUiSessionState('s1', 'typing', true)
    await client.getUiSessionState('s1', 'typing')
    await client.listUiSessionState('s1')

    expect(bodyOf(fetcher, 0)).toMatchObject({
      method: 'ui_session.update_state',
      params: { session_id: 's1', key: 'typing', value: true },
    })
    expect(bodyOf(fetcher, 1)).toMatchObject({
      method: 'ui_session.get_state',
      params: { session_id: 's1', key: 'typing' },
    })
    expect(bodyOf(fetcher, 2)).toMatchObject({
      method: 'ui_session.list_state',
      params: { session_id: 's1' },
    })
  })

  it('resolveDid validates that the response is a string', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse('did:bns:resolved', 12))
    const client = new MsgCenterClient(new kRPCClient('/kapi/msg-center/', null, 12, { fetcher }))

    const did = await client.resolveDid('wechat', 'wxid_xx', { hint: 1 }, 'did:bns:owner')

    expect(did).toBe('did:bns:resolved')
    expect(bodyOf(fetcher)).toEqual({
      method: 'contact.resolve_did',
      params: {
        platform: 'wechat',
        account_id: 'wxid_xx',
        profile_hint: { hint: 1 },
        contact_mgr_owner: 'did:bns:owner',
      },
      sys: [12],
    })
  })

  it('resolveDid throws when the server returns a non-string', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({ unexpected: true }, 13))
    const client = new MsgCenterClient(new kRPCClient('/kapi/msg-center/', null, 13, { fetcher }))

    await expect(client.resolveDid('wechat', 'wxid_xx')).rejects.toThrow(
      'contact.resolve_did expected to return a DID string',
    )
  })

  it('resolveEndpointDid uses tunnel_instance_id', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse('did:msgtunnel:alice.user.tg-main', 13))
    const client = new MsgCenterClient(new kRPCClient('/kapi/msg-center/', null, 13, { fetcher }))

    await client.resolveEndpointDid('telegram', 'alice', 'user', 'tg-main', 'did:bns:owner')

    expect(bodyOf(fetcher).params).toEqual({
      platform: 'telegram',
      account_id: 'alice',
      account_type: 'user',
      tunnel_instance_id: 'tg-main',
      contact_mgr_owner: 'did:bns:owner',
    })
  })

  it('grantTemporaryAccess forwards numeric duration and parses outcome list', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      updated: [
        { did: 'did:bns:a', granted: true, expires_at_ms: 100000 },
        { did: 'did:bns:b', granted: false, reason: 'blocked' },
      ],
    }, 14))
    const client = new MsgCenterClient(new kRPCClient('/kapi/msg-center/', null, 14, { fetcher }))

    const out = await client.grantTemporaryAccess(
      ['did:bns:a', 'did:bns:b'],
      'context-x',
      3600,
    )

    expect(out.updated).toHaveLength(2)
    expect(out.updated[1].granted).toBe(false)
    expect(bodyOf(fetcher).params).toEqual({
      dids: ['did:bns:a', 'did:bns:b'],
      context_id: 'context-x',
      duration_secs: 3600,
    })
  })

  it('blockContact returns void and forwards reason', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse(null, 15))
    const client = new MsgCenterClient(new kRPCClient('/kapi/msg-center/', null, 15, { fetcher }))

    await expect(client.blockContact('did:bns:bad', 'spam')).resolves.toBeUndefined()
    expect(bodyOf(fetcher).params).toEqual({ did: 'did:bns:bad', reason: 'spam' })
  })

  it('importContacts forwards the contacts payload and parses ImportReport', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      imported: 2,
      upgraded_shadow: 0,
      merged: 0,
      created: 2,
      skipped: 0,
      failed: 0,
    }, 16))
    const client = new MsgCenterClient(new kRPCClient('/kapi/msg-center/', null, 16, { fetcher }))

    const report = await client.importContacts(
      [{ name: 'alice' }, { name: 'bob' }],
      true,
    )

    expect(report.imported).toBe(2)
    expect(bodyOf(fetcher).params).toEqual({
      contacts: [{ name: 'alice' }, { name: 'bob' }],
      upgrade_to_friend: true,
    })
  })

  it('listContacts wraps the query in an object', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse([{ did: 'did:bns:a' }], 17))
    const client = new MsgCenterClient(new kRPCClient('/kapi/msg-center/', null, 17, { fetcher }))

    const list = await client.listContacts({ access_level: 'friend', limit: 50 })

    expect(list).toHaveLength(1)
    expect(bodyOf(fetcher).params).toEqual({
      query: { access_level: 'friend', limit: 50 },
    })
  })

  it('getGroupSubscribers parses the DID array result', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse(['did:bns:a', 'did:bns:b'], 18))
    const client = new MsgCenterClient(new kRPCClient('/kapi/msg-center/', null, 18, { fetcher }))

    const dids = await client.getGroupSubscribers('did:bns:group', 100, 0)

    expect(dids).toEqual(['did:bns:a', 'did:bns:b'])
    expect(bodyOf(fetcher).params).toEqual({
      group_id: 'did:bns:group',
      limit: 100,
      offset: 0,
    })
  })

  it('setGroupSubscribers validates the result shape', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(makeResponse({ group_id: 'did:bns:group', subscriber_count: 3 }, 19))
      .mockResolvedValueOnce(makeResponse({ group_id: 'did:bns:group' }, 20))

    const client = new MsgCenterClient(new kRPCClient('/kapi/msg-center/', null, 19, { fetcher }))

    const ok = await client.setGroupSubscribers('did:bns:group', ['did:bns:a', 'did:bns:b', 'did:bns:c'])
    expect(ok).toEqual({ group_id: 'did:bns:group', subscriber_count: 3 })

    await expect(
      client.setGroupSubscribers('did:bns:group', []),
    ).rejects.toThrow('Invalid SetGroupSubscribersResult')
  })

  it('group methods pass group_mgr requests through unchanged', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(makeResponse({ group_did: 'did:bns:group' }, 21))
      .mockResolvedValueOnce(makeResponse([{ member_did: 'did:bns:alice' }], 22))
    const client = new MsgCenterClient(new kRPCClient('/kapi/msg-center/', null, 21, { fetcher }))

    await client.groupCreate({ owner: 'did:bns:owner', profile: { name: 'team' } })
    await client.groupListMembers({ group_did: 'did:bns:group', state_filter: ['active'] })

    expect(bodyOf(fetcher, 0)).toMatchObject({
      method: 'group.create',
      params: { owner: 'did:bns:owner', profile: { name: 'team' } },
    })
    expect(bodyOf(fetcher, 1)).toMatchObject({
      method: 'group.list_members',
      params: { group_did: 'did:bns:group', state_filter: ['active'] },
    })
  })

  it('peekBox throws on a non-array response', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({ items: [] }, 21))
    const client = new MsgCenterClient(new kRPCClient('/kapi/msg-center/', null, 21, { fetcher }))

    await expect(
      client.peekBox({ owner: 'did:bns:u', box_kind: 'INBOX' }),
    ).rejects.toThrow('expected Vec<MailboxRecordWithObject> to be an array')
  })
})
