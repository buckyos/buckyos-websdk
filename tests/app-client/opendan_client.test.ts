import { kRPCClient } from '../../src/krpc_client'
import { OpenDanClient } from '../../src/opendan_client'

function makeResponse(body: unknown, seq: number) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      result: body,
      sys: [seq],
    }),
  }
}

describe('OpenDanClient', () => {
  it('listAgents sends params with expected field names', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      items: [{ agent_id: 'did:opendan:jarvis', status: 'running' }],
      next_cursor: 'cursor-2',
      total: 1,
    }, 101))

    const rpcClient = new kRPCClient('/kapi/opendan/', null, 101, fetcher)
    const client = new OpenDanClient(rpcClient)
    const result = await client.listAgents({
      status: 'running',
      includeSubAgents: true,
      limit: 20,
      cursor: 'cursor-1',
    })

    expect(result.items).toHaveLength(1)
    expect(JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      method: 'list_agents',
      params: {
        status: 'running',
        include_sub_agents: true,
        limit: 20,
        cursor: 'cursor-1',
      },
      sys: [101],
    })
  })

  it('getAgent sends agent_id and returns agent info', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      agent_id: 'did:opendan:agent-a',
      agent_name: 'Agent A',
      status: 'idle',
    }, 8))

    const rpcClient = new kRPCClient('/kapi/opendan/', null, 8, fetcher)
    const client = new OpenDanClient(rpcClient)
    const agent = await client.getAgent('did:opendan:agent-a')

    expect(agent.agent_id).toBe('did:opendan:agent-a')
    expect(JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      method: 'get_agent',
      params: { agent_id: 'did:opendan:agent-a' },
      sys: [8],
    })
  })

  it('getWorkspace aliases getWorkshop', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      workspace_id: 'ws-1',
      agent_id: 'did:opendan:agent-a',
      workspace_path: '/tmp/ws-1',
    }, 9))

    const rpcClient = new kRPCClient('/kapi/opendan/', null, 9, fetcher)
    const client = new OpenDanClient(rpcClient)
    const workspace = await client.getWorkspace('did:opendan:agent-a')

    expect(workspace.workspace_id).toBe('ws-1')
    expect(JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      method: 'get_workshop',
      params: { agent_id: 'did:opendan:agent-a' },
      sys: [9],
    })
  })

  it('listWorkspaceWorklogs sends optional filters', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      items: [{ log_id: 'l1', log_type: 'step', status: 'ok', timestamp: 1700000000 }],
      total: 1,
    }, 55))

    const rpcClient = new kRPCClient('/kapi/opendan/', null, 55, fetcher)
    const client = new OpenDanClient(rpcClient)
    const result = await client.listWorkspaceWorklogs({
      agentId: 'did:opendan:agent-b',
      ownerSessionId: 'session-1',
      logType: 'step',
      status: 'ok',
      stepId: 's1',
      keyword: 'deploy',
      limit: 10,
      cursor: 'cursor-a',
    })

    expect(result.items[0].log_id).toBe('l1')
    expect(JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      method: 'list_workshop_worklogs',
      params: {
        agent_id: 'did:opendan:agent-b',
        owner_session_id: 'session-1',
        log_type: 'step',
        status: 'ok',
        step_id: 's1',
        keyword: 'deploy',
        limit: 10,
        cursor: 'cursor-a',
      },
      sys: [55],
    })
  })

  it('listWorkspaceTodos and listWorkspaceSubAgents call correct methods', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(makeResponse({
        items: [{ todo_id: 't1', title: 'todo', status: 'open' }],
      }, 1))
      .mockResolvedValueOnce(makeResponse({
        items: [{ agent_id: 'did:opendan:sub-1', status: 'running' }],
      }, 2))

    const rpcClient = new kRPCClient('/kapi/opendan/', null, 1, fetcher)
    const client = new OpenDanClient(rpcClient)

    const todos = await client.listWorkspaceTodos({
      agentId: 'did:opendan:main',
      ownerSessionId: 'session-2',
      status: 'open',
      includeClosed: false,
      limit: 5,
    })
    const subAgents = await client.listWorkspaceSubAgents({
      agentId: 'did:opendan:main',
      includeDisabled: false,
      limit: 5,
    })

    expect(todos.items[0].todo_id).toBe('t1')
    expect(subAgents.items[0].agent_id).toBe('did:opendan:sub-1')
    expect(JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      method: 'list_workshop_todos',
      params: {
        agent_id: 'did:opendan:main',
        owner_session_id: 'session-2',
        status: 'open',
        include_closed: false,
        limit: 5,
        cursor: undefined,
      },
      sys: [1],
    })
    expect(JSON.parse((fetcher.mock.calls[1][1] as RequestInit).body as string)).toEqual({
      method: 'list_workshop_sub_agents',
      params: {
        agent_id: 'did:opendan:main',
        include_disabled: false,
        limit: 5,
        cursor: undefined,
      },
      sys: [2],
    })
  })

  it('session APIs send expected rpc methods', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(makeResponse({ items: ['s-1'], total: 1 }, 21))
      .mockResolvedValueOnce(makeResponse({
        session_id: 's-1',
        owner_agent: 'did:opendan:main',
        title: 'Session',
        summary: '',
        status: 'running',
        created_at_ms: 1,
        updated_at_ms: 2,
        last_activity_ms: 3,
        links: [],
        tags: [],
        meta: {},
      }, 22))
      .mockResolvedValueOnce(makeResponse({
        session_id: 's-2',
        owner_agent: 'did:opendan:main',
        title: 'Session2',
        summary: '',
        status: 'idle',
        created_at_ms: 1,
        updated_at_ms: 2,
        last_activity_ms: 3,
        links: [],
        tags: [],
        meta: {},
      }, 23))
      .mockResolvedValueOnce(makeResponse({
        session_id: 's-2',
        owner_agent: 'did:opendan:main',
        title: 'Session2',
        summary: '',
        status: 'paused',
        created_at_ms: 1,
        updated_at_ms: 2,
        last_activity_ms: 3,
        links: [],
        tags: [],
        meta: {},
      }, 24))
      .mockResolvedValueOnce(makeResponse({
        session_id: 's-2',
        owner_agent: 'did:opendan:main',
        title: 'Session2',
        summary: '',
        status: 'running',
        created_at_ms: 1,
        updated_at_ms: 2,
        last_activity_ms: 3,
        links: [],
        tags: [],
        meta: {},
      }, 25))

    const rpcClient = new kRPCClient('/kapi/opendan/', null, 21, fetcher)
    const client = new OpenDanClient(rpcClient)

    const sessions = await client.listAgentSessions({ agentId: 'did:opendan:main', limit: 10 })
    const session = await client.getAgentSession('did:opendan:main', 's-1')
    const sessionRecord = await client.getSessionRecord('s-2')
    const paused = await client.pauseSession('s-2')
    const resumed = await client.resumeSession('s-2')

    expect(sessions.items[0]).toBe('s-1')
    expect(session.session_id).toBe('s-1')
    expect(sessionRecord.session_id).toBe('s-2')
    expect(paused.status).toBe('paused')
    expect(resumed.status).toBe('running')
    expect(JSON.parse((fetcher.mock.calls[3][1] as RequestInit).body as string)).toEqual({
      method: 'pause_session',
      params: { session_id: 's-2' },
      sys: [24],
    })
    expect(JSON.parse((fetcher.mock.calls[4][1] as RequestInit).body as string)).toEqual({
      method: 'resume_session',
      params: { session_id: 's-2' },
      sys: [25],
    })
  })
})
