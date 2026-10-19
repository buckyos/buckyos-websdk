import { kRPCClient, RPCError } from '../src/krpc_client'
import type { KEventReader } from '../src/kevent_client'
import {
  MsgCenterClient,
  contactTagApp,
  contactTagKind,
  NotifyAnswer,
  NotifyTaskAccess,
  NotifyView,
  answerNotify,
  commitNotifyAnswer,
  inputPrompt,
  isNotifyClosed,
  mailboxAddress,
  mailboxResource,
  notifyAnswerToTaskResult,
  notifyCategoryFromSessionId,
  notifyCategorySessionId,
  notifyMessageData,
  notifyUrl,
  promptOptions,
  validateNotifyAnswer,
  waitNotify,
} from '../src/msg_center_client'
import {
  CommitResultReq,
  DEFAULT_CHILD_CONTROL_POLICY,
  StorageDomain,
  Task,
  TaskManagerClient,
  TaskOutcome,
  TaskPhase,
  baselineTaskControlProfile,
} from '../src/task_mgr_client'

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
  it('builds exact default and session addresses with canonical encoding', () => {
    expect(mailboxAddress('did:bns:alice')).toBe('did:bns:alice')
    expect(mailboxAddress('did:bns:alice', 'dm:did:bns:bob')).toBe('did:bns:alice/dm:did:bns:bob')
    expect(mailboxAddress('did:web:example.com%3A8080', '审批/a b%*')).toBe('did:web:example.com%3A8080/%E5%AE%A1%E6%89%B9%2Fa%20b%25%2A')
    for (const session of ['', '.', '..', ' padded ', 'a\n']) {
      expect(() => mailboxAddress('did:bns:alice', session)).toThrow()
    }
    for (const owner of ['did', 'alice', 'did:bns:alice/session', 'did:bns:']) {
      expect(() => mailboxAddress(owner)).toThrow()
    }
  })

  it('builds literal RBAC resources for dotted and escaped session IDs', () => {
    const address = mailboxAddress('did:web:agent.zone', 'approval.1')
    expect(mailboxResource(address, 'INBOX')).toBe('obj://msg-center/inbox/did:web:agent%2Ezone/approval%2E1')
    expect(mailboxResource(mailboxAddress('did:web:agent%2Ezone', 'approval%2E1'), 'INBOX')).toBe('obj://msg-center/inbox/did:web:agent%252Ezone/approval%25252E1')
    expect(mailboxResource(mailboxAddress('did:bns:alice', '审批/a b%*'), 'INBOX')).toBe('obj://msg-center/inbox/did:bns:alice/%25E5%25AE%25A1%25E6%2589%25B9%252Fa%2520b%2525%252A')
  })

  it('lists pending mailboxes and moves a record to the default inbox', async () => {
    const fetcher = jest.fn()
      .mockResolvedValueOnce(makeResponse(['did:bns:alice/a', 'did:bns:alice/b'], 1))
      .mockResolvedValueOnce(makeResponse({ record_id: 'r1', mailbox: 'did:bns:alice' }, 2))
    const client = new MsgCenterClient(new kRPCClient('/kapi/msg-center/', null, 1, { fetcher }))
    expect(await client.listMailboxes('did:bns:alice', 'INBOX')).toEqual(['did:bns:alice/a', 'did:bns:alice/b'])
    expect((await client.moveRecord('r1', mailboxAddress('did:bns:alice'))).mailbox).toBe('did:bns:alice')
    expect(bodyOf(fetcher, 0).params).toEqual({ owner: 'did:bns:alice', box_kind: 'INBOX' })
    expect(bodyOf(fetcher, 1).params).toEqual({ record_id: 'r1', mailbox: 'did:bns:alice' })
  })

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

    const result = await client.getNext({ mailbox: 'did:bns:user/session-1', box_kind: 'INBOX' })

    expect(result).toBeNull()
    expect(bodyOf(fetcher)).toEqual({
      method: 'msg.get_next',
      params: { mailbox: 'did:bns:user/session-1', box_kind: 'INBOX' },
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
      mailbox: 'did:bns:user/session-1',
      box_kind: 'INBOX',
      state_filter: ['UNREAD', 'READING'],
      limit: 10,
      with_object: true,
    })

    expect(out).toHaveLength(2)
    expect(bodyOf(fetcher).params).toEqual({
      mailbox: 'did:bns:user/session-1',
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
      mailbox: 'did:bns:user/session-1',
      box_kind: 'INBOX',
      cursor_sort_key: 100,
      descending: true,
    })

    expect(page.items).toHaveLength(1)
    expect(page.next_cursor_sort_key).toBe(99)
    expect(page.next_cursor_record_id).toBe('r1')
    expect(bodyOf(fetcher).params).toEqual({
      mailbox: 'did:bns:user/session-1',
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

    const list = await client.listContacts({ access_level: 'allow', limit: 50 })

    expect(list).toHaveLength(1)
    expect(bodyOf(fetcher).params).toEqual({
      query: { access_level: 'allow', limit: 50 },
    })
  })

  it('lookup sends the raw input and defaults missing candidates', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({ input: 'bob', input_kind: 'text' }, 31))
    const client = new MsgCenterClient(new kRPCClient('/kapi/msg-center/', null, 31, { fetcher }))

    const result = await client.lookup({ input: 'bob', limit: 5 })

    expect(result.candidates).toEqual([])
    expect(bodyOf(fetcher).method).toBe('contact.lookup')
    expect(bodyOf(fetcher).params).toEqual({ input: 'bob', limit: 5 })
  })

  it('friend request methods use the contact.* wire names', async () => {
    const clientFor = (body: unknown, seq: number) => {
      const fetcher = jest.fn().mockResolvedValue(makeResponse(body, seq))
      return { fetcher, client: new MsgCenterClient(new kRPCClient('/kapi/msg-center/', null, seq, { fetcher })) }
    }

    const send = clientFor({ friend_state: 'outgoing_pending' }, 32)
    await send.client.sendFriendRequest('did:bns:bob', 'hi')
    expect(bodyOf(send.fetcher).method).toBe('contact.send_friend_request')
    expect(bodyOf(send.fetcher).params).toEqual({ did: 'did:bns:bob', message: 'hi' })

    const respond = clientFor({ friend_state: 'friend' }, 33)
    await respond.client.respondFriendRequest('r1', 'accept')
    expect(bodyOf(respond.fetcher).params).toEqual({ request_id: 'r1', decision: 'accept' })

    const list = clientFor({ items: [{ request_id: 'r1' }] }, 34)
    expect(await list.client.listFriendRequests({ direction: 'incoming' })).toHaveLength(1)
    expect(bodyOf(list.fetcher).params).toEqual({ direction: 'incoming' })

    const tags = clientFor({ did: 'did:bns:bob', tags: ['家人'] }, 35)
    await tags.client.updateContactTags('did:bns:bob', { add: ['家人'] })
    expect(bodyOf(tags.fetcher).method).toBe('contact.update_tags')
    expect(bodyOf(tags.fetcher).params).toEqual({ did: 'did:bns:bob', add: ['家人'] })
  })

  it('classifies contact tags', () => {
    expect(contactTagKind('zone_user')).toBe('system')
    expect(contactTagKind('homestation.following')).toBe('app')
    expect(contactTagApp('homestation.following')).toBe('homestation')
    expect(contactTagKind('家人')).toBe('user')
    expect(contactTagKind('Work.Friends')).toBe('user')
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

  it('peekBox throws on a non-array response', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({ items: [] }, 21))
    const client = new MsgCenterClient(new kRPCClient('/kapi/msg-center/', null, 21, { fetcher }))

    await expect(
      client.peekBox({ mailbox: 'did:bns:u', box_kind: 'INBOX' }),
    ).rejects.toThrow('expected Vec<MailboxRecordWithObject> to be an array')
  })
})

// System Notify: wire shapes follow buckyos-api/src/msg_notify.rs.

const CHOICE_PROMPT = inputPrompt('Which one?', 'pick', [{ value: 'a', label: 'A' }], true)

// A NotifyView as msg-center serializes it (serde, skip_serializing_if).
const VIEW_WIRE = {
  notify_id: 'nt-1',
  url: 'https://test.buckyos.io/messagehub?notify=nt-1',
  to_user: 'alice',
  kind: 'input',
  category: 'agent',
  level: 'timely',
  status: 'answered',
  prompt: {
    title: 'Which one?',
    message: 'pick',
    controls: [
      { kind: 'choice', id: 'option', options: [{ value: 'a', label: 'A' }], multiple: false, required: false },
      { kind: 'text_input', id: 'text', multiline: true, required: false },
    ],
  },
  source: {
    agent_did: 'did:web:jarvis.test',
    session_id: 'work-1',
    turn: 3,
    call_id: 'call-1',
    conversation: { to: 'did:bns:alice' },
  },
  created_at_ms: 1000,
  expires_at_ms: 5000,
  closed_at_ms: 2000,
  task_id: 't1',
  result: {
    action: 'answer',
    values: { option: 'a' },
    submitted_by: 'alice',
    submitted_at: 1999,
    committed_by: 'alice|system:control-panel',
  },
  home: {
    owner: 'did:bns:alice',
    session_id: 'sysnotify:agent',
    record_id: 'r1',
    msg_id: 'm1',
    from: 'did:bns:zone',
  },
  deliveries: [{ session_id: 'dm:1', platform: 'native', to: 'did:bns:alice', msg_id: 'm2', ok: true }],
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function humanTask(revision: number): Task {
  return {
    task_id: 't1',
    name: 'notify',
    root_id: 't1',
    child_control_policy: DEFAULT_CHILD_CONTROL_POLICY,
    schema_id: 'human.input/v1',
    schema_version: 1,
    input: {},
    input_digest: '',
    creator: { user_id: 'ood1', app_id: 'system:msg-center' },
    storage_domain: StorageDomain.User,
    idempotency_key: 'notify:nt-1',
    executor: { kind: 'HumanSet' },
    runner_epoch: 0,
    assignees: ['alice'],
    phase: TaskPhase.Waiting,
    control_profile: baselineTaskControlProfile(0),
    policy_preset: 'collaborative-tree/v1',
    permission_boundary: false,
    revision,
    created_at: 0,
    updated_at: 0,
  }
}

/** One task; a commit with a stale revision loses (like TaskMgr's CAS). */
class OneTask implements NotifyTaskAccess {
  commits = 0
  conflicts = 0
  late = 0

  constructor(public task: Task) {}

  async getTask(): Promise<Task> {
    return clone(this.task)
  }

  async commitResult(req: CommitResultReq): Promise<Task> {
    if (this.task.phase === TaskPhase.Terminal) {
      this.late += 1
      throw new RPCError('RPC call error: task_already_completed: terminal')
    }
    if (this.task.revision !== req.expected_revision) {
      this.conflicts += 1
      throw new RPCError('RPC call error: revision_conflict: stale')
    }
    this.commits += 1
    this.task = {
      ...this.task,
      result: req.result,
      outcome: TaskOutcome.Succeeded,
      phase: TaskPhase.Terminal,
      revision: this.task.revision + 1,
      completed_by: { user_id: 'alice', app_id: 'system:control-panel' },
    }
    return clone(this.task)
  }
}

/** msg-center as seen by the SDK: the status of an `input` comes from its task. */
function fakeMsgCenter(tasks: OneTask, kind: 'input' | 'notice' = 'input') {
  const calls: string[] = []
  const view = (): NotifyView => {
    const task = tasks.task
    const base: NotifyView = {
      notify_id: 'nt-1',
      url: notifyUrl(null, 'nt-1'),
      to_user: 'alice',
      kind,
      category: 'app',
      level: 'normal',
      status: 'open',
      prompt: kind === 'input' ? inputPrompt('q', '', [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]) : { title: 'hi' },
      source: {},
      created_at_ms: 0,
    }
    if (kind === 'notice') return base
    base.task_id = task.task_id
    if (task.phase === TaskPhase.Terminal) {
      const result = task.result as { action: string; values?: Record<string, unknown>; submitted_by?: string }
      base.status = result.action === 'dismiss' ? 'dismissed' : 'answered'
      base.result = { ...result, committed_by: 'alice|system:control-panel' }
    }
    return base
  }
  return {
    calls,
    notifyGet: jest.fn(async (_notifyId: string) => {
      calls.push('get')
      return view()
    }),
    notifyAck: jest.fn(async (_notifyId: string, _onBehalf?: string) => {
      calls.push('ack')
      return { ...view(), status: 'read' as const }
    }),
    notifyDismiss: jest.fn(async (_notifyId: string) => {
      calls.push('dismiss')
      return { ...view(), status: 'dismissed' as const }
    }),
  }
}

describe('System Notify', () => {
  it('notifySend sends the NotifySendReq fields and parses the NotifyView', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse(VIEW_WIRE, 1))
    const client = new MsgCenterClient(new kRPCClient('/kapi/msg-center/', null, 1, { fetcher }))

    const view = await client.notifySend({
      to_user: 'alice',
      kind: 'input',
      level: 'timely',
      prompt: CHOICE_PROMPT,
      source: { session_id: 'work-1', operation: 'pick one', link: undefined },
      expires_at_ms: 5000,
      idempotency_key: 'k1',
    })

    expect(bodyOf(fetcher)).toEqual({
      method: 'notify.send',
      params: {
        to_user: 'alice',
        kind: 'input',
        level: 'timely',
        prompt: VIEW_WIRE.prompt,
        source: { session_id: 'work-1', operation: 'pick one' },
        expires_at_ms: 5000,
        idempotency_key: 'k1',
      },
      sys: [1],
    })
    expect(clone(view)).toEqual(VIEW_WIRE)
    expect(view.result?.values?.option).toBe('a')
    expect(view.home?.session_id).toBe(notifyCategorySessionId('agent'))
    expect(isNotifyClosed(view.status)).toBe(true)
  })

  it('notify get/list/ack/dismiss/cancel send the Rust request shapes', async () => {
    const open = { ...VIEW_WIRE, status: 'open', result: undefined }
    const fetcher = jest.fn()
      .mockResolvedValueOnce(makeResponse(open, 1))
      .mockResolvedValueOnce(makeResponse({ items: [open], next_cursor: 'c2' }, 2))
      .mockResolvedValueOnce(makeResponse({ items: [] }, 3))
      .mockResolvedValueOnce(makeResponse({ ...open, status: 'read', acked_by: 'did:web:jarvis.test' }, 4))
      .mockResolvedValueOnce(makeResponse({ ...open, status: 'read' }, 5))
      .mockResolvedValueOnce(makeResponse({ ...open, status: 'dismissed' }, 6))
      .mockResolvedValueOnce(makeResponse({ ...open, status: 'canceled', closed_reason: 'gone' }, 7))
      .mockResolvedValueOnce(makeResponse({ ...open, status: 'canceled' }, 8))
    const client = new MsgCenterClient(new kRPCClient('/kapi/msg-center/', null, 1, { fetcher }))

    expect((await client.notifyGet('nt-1')).status).toBe('open')
    const page = await client.notifyList({ status: ['open', 'read'], kind: 'input', category: 'agent', since_ms: 10, limit: 20 })
    expect(page.items.map((item) => item.notify_id)).toEqual(['nt-1'])
    expect(page.next_cursor).toBe('c2')
    expect((await client.notifyList()).items).toEqual([])
    expect((await client.notifyAck('nt-1', 'did:web:jarvis.test')).acked_by).toBe('did:web:jarvis.test')
    expect((await client.notifyAck('nt-1')).status).toBe('read')
    expect((await client.notifyDismiss('nt-1')).status).toBe('dismissed')
    expect((await client.notifyCancel('nt-1', 'gone')).closed_reason).toBe('gone')
    await client.notifyCancel('nt-1')

    const sent = fetcher.mock.calls.map((_, index) => {
      const body = bodyOf(fetcher, index)
      return [body.method, body.params]
    })
    expect(sent).toEqual([
      ['notify.get', { notify_id: 'nt-1' }],
      ['notify.list', { status: ['open', 'read'], kind: 'input', category: 'agent', since_ms: 10, limit: 20 }],
      ['notify.list', {}],
      ['notify.ack', { notify_id: 'nt-1', on_behalf: 'did:web:jarvis.test' }],
      ['notify.ack', { notify_id: 'nt-1' }],
      ['notify.dismiss', { notify_id: 'nt-1' }],
      ['notify.cancel', { notify_id: 'nt-1', reason: 'gone' }],
      ['notify.cancel', { notify_id: 'nt-1' }],
    ])
  })

  it('rejects responses that are not a NotifyView', async () => {
    const fetcher = jest.fn()
      .mockResolvedValueOnce(makeResponse({ notify_id: 'nt-1' }, 1))
      .mockResolvedValueOnce(makeResponse({ items: [{ status: 'open' }] }, 2))
    const client = new MsgCenterClient(new kRPCClient('/kapi/msg-center/', null, 1, { fetcher }))

    await expect(client.notifyGet('nt-1')).rejects.toThrow('Invalid NotifyView')
    await expect(client.notifyList()).rejects.toThrow('Invalid NotifyView')
  })

  it('inputPrompt lays out the option choice and the text input like Rust input_prompt', () => {
    const options = [{ value: 'yes', label: 'Overwrite' }, { value: 'no', label: 'Keep', style: 'danger' as const }]
    expect(inputPrompt('Overwrite?', 'A file exists.', options)).toEqual({
      title: 'Overwrite?',
      message: 'A file exists.',
      controls: [{ kind: 'choice', id: 'option', options, multiple: false, required: true }],
    })
    expect(inputPrompt('Overwrite?', '', options, true)).toEqual({
      title: 'Overwrite?',
      controls: [
        { kind: 'choice', id: 'option', options, multiple: false, required: false },
        { kind: 'text_input', id: 'text', multiline: true, required: false },
      ],
    })
    expect(inputPrompt('Why?', '', [])).toEqual({
      title: 'Why?',
      controls: [{ kind: 'text_input', id: 'text', multiline: true, required: true }],
    })
    expect(promptOptions(inputPrompt('q', '', options, true))).toEqual(options)
    expect(promptOptions({ title: 'notice' })).toEqual([])
  })

  it('checks answers against the prompt and builds the human task result', () => {
    const choice = inputPrompt('q', '', [{ value: 'a', label: 'A' }])
    expect(validateNotifyAnswer({ option: 'a' }, choice)).toBeNull()
    expect(validateNotifyAnswer({ option: 'b' }, choice)).toBe("no option 'b'; options: a")
    expect(validateNotifyAnswer({ text: 'free' }, choice)).toBe('this question takes one of its options, not free text')
    expect(validateNotifyAnswer({ dismiss: true }, choice)).toBeNull()
    const text = inputPrompt('q', '', [])
    expect(validateNotifyAnswer({ text: 'free' }, text)).toBeNull()
    expect(validateNotifyAnswer({ text: '  ' }, text)).toBe('an answer needs an option or a text')
    expect(validateNotifyAnswer({}, text)).toBe('an answer needs an option or a text')
    expect(validateNotifyAnswer({ option: 'a', text: 'why' }, inputPrompt('q', '', [{ value: 'a', label: 'A' }], true))).toBeNull()

    expect(notifyAnswerToTaskResult({ option: 'a', text: ' ' }, 'alice', 7)).toEqual({
      kind: 'human',
      action: 'answer',
      values: { option: 'a' },
      submitted_by: 'alice',
      submitted_at: 7,
    })
    expect(notifyAnswerToTaskResult({ dismiss: true }, 'alice', 8)).toEqual({
      kind: 'human',
      action: 'dismiss',
      submitted_by: 'alice',
      submitted_at: 8,
    })
  })

  it('builds links, maps category sessions and reads notification messages', () => {
    expect(notifyUrl('test.buckyos.io', 'nt-1')).toBe('https://test.buckyos.io/messagehub?notify=nt-1')
    expect(notifyUrl(' ', 'nt-1')).toBe('/messagehub?notify=nt-1')
    expect(notifyUrl(undefined, 'nt-1')).toBe('/messagehub?notify=nt-1')
    expect(notifyCategorySessionId('todo')).toBe('sysnotify:todo')
    expect(notifyCategoryFromSessionId('sysnotify:agent')).toBe('agent')
    expect(notifyCategoryFromSessionId('sysnotify:other')).toBeNull()
    expect(notifyCategoryFromSessionId('dm:did:bns:bob')).toBeNull()
    expect(isNotifyClosed('read')).toBe(false)
    expect(isNotifyClosed('expired')).toBe(true)

    const data = {
      version: 1,
      notify_id: 'nt-1',
      kind: 'input',
      category: 'agent',
      level: 'timely',
      home: true,
      source: { agent_did: 'did:web:jarvis.test' },
      prompt: CHOICE_PROMPT,
      task_id: 't1',
      url: notifyUrl('test.buckyos.io', 'nt-1'),
    }
    const msg = { from: 'did:bns:zone', content: { content: 'Which one?', machine: { intent: 'buckyos.notify', data } } }
    expect(notifyMessageData(msg)).toEqual(data)
    expect(notifyMessageData({ content: { machine: { intent: 'buckyos.notify.delivered', data } } })).toBeNull()
    expect(notifyMessageData({ content: { content: 'plain' } })).toBeNull()
    expect(notifyMessageData(null)).toBeNull()
  })

  it('answerNotify: the first answer wins, a later one sees the final result', async () => {
    const tasks = new OneTask(humanTask(3))
    const msgCenter = fakeMsgCenter(tasks)

    const first = await answerNotify(msgCenter, tasks, 'nt-1', { option: 'a' })
    expect(first.status).toBe('answered')
    expect(tasks.task.result).toEqual({
      kind: 'human',
      action: 'answer',
      values: { option: 'a' },
      submitted_by: 'alice',
      submitted_at: expect.any(Number),
    })

    const second = await answerNotify(msgCenter, tasks, 'nt-1', { option: 'b' }, 'bob')
    expect(second.status).toBe('answered')
    expect(second.result?.values).toEqual({ option: 'a' })
    expect(tasks.commits).toBe(1)
  })

  it('answerNotify: of two concurrent answers one commits and both return its result', async () => {
    const tasks = new OneTask(humanTask(3))
    const msgCenter = fakeMsgCenter(tasks)
    // Both answers read the same open snapshot before either writes.
    let reads = 0
    let release!: () => void
    const bothRead = new Promise<void>((resolve) => { release = resolve })
    const gated: NotifyTaskAccess = {
      getTask: async () => {
        const snapshot = await tasks.getTask()
        reads += 1
        if (reads === 2) release()
        if (reads <= 2) await bothRead
        return snapshot
      },
      commitResult: (req) => tasks.commitResult(req),
    }

    const [a, b] = await Promise.all([
      answerNotify(msgCenter, gated, 'nt-1', { option: 'a' }),
      answerNotify(msgCenter, gated, 'nt-1', { dismiss: true }),
    ])

    // The loser's write is refused (the task is already completed).
    expect(tasks.commits).toBe(1)
    expect(tasks.late).toBe(1)
    expect(a.status).toBe('answered')
    expect(b).toEqual(a)
  })

  it('commitNotifyAnswer retries a revision conflict and reports a task closed under it', async () => {
    // A stale snapshot loses the CAS, re-reads and still wins while the task is open.
    const racy = new OneTask(humanTask(5))
    let stale = true
    const access: NotifyTaskAccess = {
      getTask: async (taskId) => {
        const task = await racy.getTask()
        if (stale) {
          stale = false
          task.revision -= 1
        }
        expect(taskId).toBe('t1')
        return task
      },
      commitResult: (req) => racy.commitResult(req),
    }
    const won = await commitNotifyAnswer(access, 't1', { dismiss: true }, 'alice', 3)
    expect(won.kind).toBe('committed')
    expect(racy.conflicts).toBe(1)
    expect(won.task.result).toEqual({ kind: 'human', action: 'dismiss', submitted_by: 'alice', submitted_at: 3 })

    // The task completes between the read and the write.
    const done = new OneTask(humanTask(1))
    await done.commitResult({ task_id: 't1', result: { kind: 'human', action: 'answer' }, expected_revision: 1 })
    let first = true
    const late: NotifyTaskAccess = {
      getTask: async () => {
        if (first) {
          first = false
          return humanTask(2)
        }
        return done.getTask()
      },
      commitResult: (req) => done.commitResult(req),
    }
    const lost = await commitNotifyAnswer(late, 't1', { option: 'a' }, 'alice', 4)
    expect(lost.kind).toBe('already_closed')
    expect(lost.task.phase).toBe(TaskPhase.Terminal)

    // A task that keeps changing is an error, not a silent loss.
    const busy: NotifyTaskAccess = {
      getTask: async () => humanTask(1),
      commitResult: async () => {
        throw new RPCError('RPC call error: revision_conflict: stale')
      },
    }
    await expect(commitNotifyAnswer(busy, 't1', { option: 'a' }, 'alice', 5)).rejects.toThrow('keeps changing')

    const denied: NotifyTaskAccess = {
      getTask: async () => humanTask(1),
      commitResult: async () => {
        throw new RPCError('RPC call error: permission_denied: not an assignee')
      },
    }
    await expect(commitNotifyAnswer(denied, 't1', { option: 'a' }, 'alice', 6)).rejects.toThrow('permission_denied')
  })

  it('answerNotify acks or dismisses a notice and never touches TaskMgr for it', async () => {
    const tasks = new OneTask(humanTask(1))
    const msgCenter = fakeMsgCenter(tasks, 'notice')

    expect((await answerNotify(msgCenter, tasks, 'nt-1', {})).status).toBe('read')
    expect((await answerNotify(msgCenter, tasks, 'nt-1', { dismiss: true })).status).toBe('dismissed')
    expect(msgCenter.notifyAck).toHaveBeenCalledWith('nt-1')
    expect(msgCenter.calls).toEqual(['get', 'ack', 'get', 'dismiss'])
    expect(tasks.commits).toBe(0)
  })

  it('answerNotify rejects an invalid answer and returns a closed input as it is', async () => {
    const tasks = new OneTask(humanTask(1))
    const msgCenter = fakeMsgCenter(tasks)

    await expect(answerNotify(msgCenter, tasks, 'nt-1', { option: 'z' })).rejects.toThrow("no option 'z'")
    expect(tasks.commits).toBe(0)

    await tasks.commitResult({
      task_id: 't1',
      result: notifyAnswerToTaskResult({ option: 'b' }, 'alice', 1),
      expected_revision: 1,
    })
    const closed = await answerNotify(msgCenter, tasks, 'nt-1', { option: 'z' })
    expect(closed.result?.values).toEqual({ option: 'b' })
    expect(tasks.commits).toBe(1)
  })

  it('answerNotify writes commit_result with expected_revision through the SDK clients', async () => {
    const open = { ...VIEW_WIRE, category: 'app', status: 'open', result: undefined }
    const msgFetcher = jest.fn()
      .mockResolvedValueOnce(makeResponse(open, 1))
      .mockResolvedValueOnce(makeResponse(VIEW_WIRE, 2))
    const taskFetcher = jest.fn()
      .mockResolvedValueOnce(makeResponse({ task: humanTask(3) }, 1))
      .mockResolvedValueOnce(makeResponse({ task: { ...humanTask(4), phase: TaskPhase.Terminal } }, 2))
    const msgCenter = new MsgCenterClient(new kRPCClient('/kapi/msg-center/', null, 1, { fetcher: msgFetcher }))
    const taskMgr: NotifyTaskAccess = new TaskManagerClient(new kRPCClient('/kapi/task-manager/', null, 1, { fetcher: taskFetcher }))

    const answer: NotifyAnswer = { option: 'a' }
    const view = await answerNotify(msgCenter, taskMgr, 'nt-1', answer)

    expect(view.status).toBe('answered')
    expect(bodyOf(taskFetcher, 0)).toMatchObject({ method: 'get_task', params: { task_id: 't1' } })
    expect(bodyOf(taskFetcher, 1)).toMatchObject({
      method: 'commit_result',
      params: {
        task_id: 't1',
        result: { kind: 'human', action: 'answer', values: { option: 'a' }, submitted_by: 'alice' },
        expected_revision: 3,
      },
    })
    expect(Object.keys(bodyOf(taskFetcher, 1).params).sort()).toEqual(['expected_revision', 'result', 'task_id'])
  })

  it('waitNotify returns the open view at the deadline', async () => {
    const tasks = new OneTask(humanTask(1))
    const msgCenter = fakeMsgCenter(tasks)
    const start = Date.now()

    const view = await waitNotify(msgCenter, 'nt-1', start + 300)

    expect(view.status).toBe('open')
    expect(Date.now() - start).toBeGreaterThanOrEqual(290)
    expect(msgCenter.notifyGet.mock.calls.length).toBeGreaterThanOrEqual(2)

    msgCenter.notifyGet.mockClear()
    expect((await waitNotify(msgCenter, 'nt-1', Date.now() - 1)).status).toBe('open')
    expect(msgCenter.notifyGet).toHaveBeenCalledTimes(1)

    // An event stream that never opens does not hold the wait past its deadline.
    const stuck = { createEventReader: jest.fn(() => new Promise<KEventReader>(() => undefined)) }
    const before = Date.now()
    expect((await waitNotify(msgCenter, 'nt-1', before + 200, { kevent: stuck })).status).toBe('open')
    expect(Date.now() - before).toBeLessThan(1000)
  })

  it('waitNotify returns once the notification is closed; task events wake it early', async () => {
    const tasks = new OneTask(humanTask(1))
    const msgCenter = fakeMsgCenter(tasks)
    let gets = 0
    msgCenter.notifyGet.mockImplementation(async () => {
      gets += 1
      if (gets === 3) {
        await tasks.commitResult({
          task_id: 't1',
          result: notifyAnswerToTaskResult({ option: 'a' }, 'alice', 1),
          expected_revision: 1,
        })
      }
      return fakeMsgCenter(tasks).notifyGet('nt-1')
    })
    const reader = {
      pullEvent: jest.fn(async () => ({ eventid: 'e1', source_node: 'ood1', source_pid: 1, timestamp: 0, data: {} })),
      close: jest.fn(async () => undefined),
    }
    const kevent = { createEventReader: jest.fn(async () => reader as unknown as KEventReader) }
    const start = Date.now()

    const view = await waitNotify(msgCenter, 'nt-1', start + 60_000, { kevent })

    expect(view.status).toBe('answered')
    expect(view.result?.values).toEqual({ option: 'a' })
    expect(gets).toBe(3)
    // 0.5 s sleep before the reader is up, then the task event instead of 1 s.
    expect(Date.now() - start).toBeLessThan(1200)
    expect(kevent.createEventReader).toHaveBeenCalledWith(['/task_mgr/t1'])
    expect(reader.pullEvent).toHaveBeenCalled()
    expect(reader.close).toHaveBeenCalled()
  })
})
