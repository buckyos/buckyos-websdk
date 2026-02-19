import { kRPCClient } from '../src/krpc_client'
import { OpenDanClient } from '../src/opendan_client'

describe('OpenDanClient', () => {
  it('listAgents sends params with expected field names', async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          items: [{ agent_id: 'did:opendan:jarvis', status: 'running' }],
          next_cursor: 'cursor-2',
          total: 1,
        },
        sys: [101],
      }),
    })

    const rpcClient = new kRPCClient('/kapi/opendan/', null, 101, fetcher)
    const client = new OpenDanClient(rpcClient)
    const result = await client.listAgents({
      status: 'running',
      includeSubAgents: true,
      limit: 20,
      cursor: 'cursor-1',
    })

    expect(result.items).toHaveLength(1)
    expect(result.next_cursor).toBe('cursor-2')

    const requestBody = JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)
    expect(requestBody.method).toBe('list_agents')
    expect(requestBody.params).toEqual({
      status: 'running',
      include_sub_agents: true,
      limit: 20,
      cursor: 'cursor-1',
    })
  })

  it('getAgent sends agent_id and returns agent info', async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          agent_id: 'did:opendan:agent-a',
          agent_name: 'Agent A',
          status: 'idle',
        },
        sys: [8],
      }),
    })

    const rpcClient = new kRPCClient('/kapi/opendan/', null, 8, fetcher)
    const client = new OpenDanClient(rpcClient)
    const agent = await client.getAgent('did:opendan:agent-a')

    expect(agent.agent_id).toBe('did:opendan:agent-a')
    expect(agent.agent_name).toBe('Agent A')

    const requestBody = JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)
    expect(requestBody).toEqual({
      method: 'get_agent',
      params: { agent_id: 'did:opendan:agent-a' },
      sys: [8],
    })
  })

  it('listWorkspaceWorklogs sends optional filters', async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          items: [{ log_id: 'l1', log_type: 'step', status: 'ok', timestamp: 1700000000 }],
          total: 1,
        },
        sys: [55],
      }),
    })

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

    expect(result.items).toHaveLength(1)
    expect(result.items[0].log_id).toBe('l1')

    const requestBody = JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)
    expect(requestBody.method).toBe('list_workshop_worklogs')
    expect(requestBody.params).toEqual({
      agent_id: 'did:opendan:agent-b',
      owner_session_id: 'session-1',
      log_type: 'step',
      status: 'ok',
      step_id: 's1',
      keyword: 'deploy',
      limit: 10,
      cursor: 'cursor-a',
    })
  })

  it('listWorkspaceTodos and listWorkspaceSubAgents call correct methods', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: { items: [{ todo_id: 't1', title: 'todo', status: 'open' }] },
          sys: [1],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: { items: [{ agent_id: 'did:opendan:sub-1', status: 'running' }] },
          sys: [2],
        }),
      })

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

    const firstBody = JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)
    const secondBody = JSON.parse((fetcher.mock.calls[1][1] as RequestInit).body as string)

    expect(firstBody.method).toBe('list_workshop_todos')
    expect(firstBody.params).toEqual({
      agent_id: 'did:opendan:main',
      owner_session_id: 'session-2',
      status: 'open',
      include_closed: false,
      limit: 5,
    })
    expect(secondBody.method).toBe('list_workshop_sub_agents')
    expect(secondBody.params).toEqual({
      agent_id: 'did:opendan:main',
      include_disabled: false,
      limit: 5,
    })
  })

  it('session APIs send expected rpc methods', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: { items: ['s-1'], total: 1 },
          sys: [21],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
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
          },
          sys: [22],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
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
          },
          sys: [23],
        }),
      })

    const rpcClient = new kRPCClient('/kapi/opendan/', null, 21, fetcher)
    const client = new OpenDanClient(rpcClient)

    const sessions = await client.listAgentSessions({ agentId: 'did:opendan:main', limit: 10 })
    const session = await client.getAgentSession('did:opendan:main', 's-1')
    const sessionRecord = await client.getSessionRecord('s-2')

    expect(sessions.items[0]).toBe('s-1')
    expect(session.session_id).toBe('s-1')
    expect(sessionRecord.session_id).toBe('s-2')

    const firstBody = JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)
    const secondBody = JSON.parse((fetcher.mock.calls[1][1] as RequestInit).body as string)
    const thirdBody = JSON.parse((fetcher.mock.calls[2][1] as RequestInit).body as string)

    expect(firstBody).toEqual({
      method: 'list_agent_sessions',
      params: { agent_id: 'did:opendan:main', limit: 10 },
      sys: [21],
    })
    expect(secondBody).toEqual({
      method: 'get_agent_session',
      params: { agent_id: 'did:opendan:main', session_id: 's-1' },
      sys: [22],
    })
    expect(thirdBody).toEqual({
      method: 'get_session_record',
      params: { session_id: 's-2' },
      sys: [23],
    })
  })
})
