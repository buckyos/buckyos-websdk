import { kRPCClient } from './krpc_client'

export const OPENDAN_SERVICE_NAME = 'opendan'

export interface OpenDanAgentInfo {
  agent_id: string
  agent_name?: string
  agent_type?: string
  status?: string
  parent_agent_id?: string
  current_run_id?: string
  workspace_id?: string
  workspace_path?: string
  last_active_at?: string
  updated_at?: number
  extra?: unknown
}

export interface OpenDanWorkspaceInfo {
  workspace_id: string
  agent_id: string
  workspace_path?: string
  todo_db_path?: string
  worklog_db_path?: string
  summary?: unknown
  extra?: unknown
}

export interface OpenDanWorklogItem {
  log_id: string
  log_type: string
  status: string
  timestamp: number
  agent_id?: string
  related_agent_id?: string
  step_id?: string
  summary?: string
  payload?: unknown
}

export interface OpenDanTodoItem {
  todo_id: string
  title: string
  status: string
  agent_id?: string
  description?: string
  created_at?: number
  completed_at?: number
  created_in_step_id?: string
  completed_in_step_id?: string
  extra?: unknown
}

export interface OpenDanSubAgentInfo {
  agent_id: string
  agent_name?: string
  status?: string
  current_run_id?: string
  last_active_at?: string
  workspace_id?: string
  workspace_path?: string
  extra?: unknown
}

export interface OpenDanAgentListResult {
  items: OpenDanAgentInfo[]
  next_cursor?: string
  total?: number
}

export interface OpenDanWorkspaceWorklogsResult {
  items: OpenDanWorklogItem[]
  next_cursor?: string
  total?: number
}

export interface OpenDanWorkspaceTodosResult {
  items: OpenDanTodoItem[]
  next_cursor?: string
  total?: number
}

export interface OpenDanWorkspaceSubAgentsResult {
  items: OpenDanSubAgentInfo[]
  next_cursor?: string
  total?: number
}

export interface OpenDanSessionLink {
  relation: string
  session_id: string
  agent_did?: string
  note?: string
}

export interface OpenDanAgentSessionRecord {
  session_id: string
  owner_agent: string
  title: string
  summary: string
  status: string
  created_at_ms: number
  updated_at_ms: number
  last_activity_ms: number
  links: OpenDanSessionLink[]
  tags: string[]
  meta: unknown
}

export interface OpenDanAgentSessionListResult {
  items: string[]
  next_cursor?: string
  total?: number
}

export interface ListAgentsParams {
  status?: string
  includeSubAgents?: boolean
  limit?: number
  cursor?: string
}

export interface ListWorkspaceWorklogsParams {
  agentId: string
  ownerSessionId: string
  logType?: string
  status?: string
  stepId?: string
  keyword?: string
  limit?: number
  cursor?: string
}

export interface ListWorkshopWorklogsParams {
  agentId: string
  ownerSessionId: string
  logType?: string
  status?: string
  stepId?: string
  keyword?: string
  limit?: number
  cursor?: string
}

export interface ListWorkspaceTodosParams {
  agentId: string
  ownerSessionId: string
  status?: string
  includeClosed?: boolean
  limit?: number
  cursor?: string
}

export interface ListWorkshopTodosParams {
  agentId: string
  ownerSessionId: string
  status?: string
  includeClosed?: boolean
  limit?: number
  cursor?: string
}

export interface ListWorkspaceSubAgentsParams {
  agentId: string
  includeDisabled?: boolean
  limit?: number
  cursor?: string
}

export interface ListWorkshopSubAgentsParams {
  agentId: string
  includeDisabled?: boolean
  limit?: number
  cursor?: string
}

export interface ListAgentSessionsParams {
  agentId: string
  limit?: number
  cursor?: string
}

interface OpenDanListAgentsReq {
  status?: string
  include_sub_agents?: boolean
  limit?: number
  cursor?: string
}

interface OpenDanGetAgentReq {
  agent_id: string
}

interface OpenDanGetWorkshopReq {
  agent_id: string
}

interface OpenDanListWorkshopWorklogsReq {
  agent_id: string
  owner_session_id: string
  log_type?: string
  status?: string
  step_id?: string
  keyword?: string
  limit?: number
  cursor?: string
}

interface OpenDanListWorkshopTodosReq {
  agent_id: string
  owner_session_id: string
  status?: string
  include_closed?: boolean
  limit?: number
  cursor?: string
}

interface OpenDanListWorkshopSubAgentsReq {
  agent_id: string
  include_disabled?: boolean
  limit?: number
  cursor?: string
}

interface OpenDanListAgentSessionsReq {
  agent_id: string
  limit?: number
  cursor?: string
}

interface OpenDanGetAgentSessionReq {
  agent_id: string
  session_id: string
}

interface OpenDanGetSessionRecordReq {
  session_id: string
}

export class OpenDanClient {
  private rpcClient: kRPCClient

  constructor(rpcClient: kRPCClient) {
    this.rpcClient = rpcClient
  }

  setSeq(seq: number) {
    this.rpcClient.setSeq(seq)
  }

  async listAgents(params: ListAgentsParams = {}): Promise<OpenDanAgentListResult> {
    const req: OpenDanListAgentsReq = {
      status: params.status,
      include_sub_agents: params.includeSubAgents,
      limit: params.limit,
      cursor: params.cursor,
    }
    return this.rpcClient.call<OpenDanAgentListResult, OpenDanListAgentsReq>('list_agents', req)
  }

  async getAgent(agentId: string): Promise<OpenDanAgentInfo> {
    const req: OpenDanGetAgentReq = { agent_id: agentId }
    return this.rpcClient.call<OpenDanAgentInfo, OpenDanGetAgentReq>('get_agent', req)
  }

  async getWorkshop(agentId: string): Promise<OpenDanWorkspaceInfo> {
    const req: OpenDanGetWorkshopReq = { agent_id: agentId }
    return this.rpcClient.call<OpenDanWorkspaceInfo, OpenDanGetWorkshopReq>('get_workshop', req)
  }

  async getWorkspace(agentId: string): Promise<OpenDanWorkspaceInfo> {
    return this.getWorkshop(agentId)
  }

  async listWorkshopWorklogs(params: ListWorkshopWorklogsParams): Promise<OpenDanWorkspaceWorklogsResult> {
    const req: OpenDanListWorkshopWorklogsReq = {
      agent_id: params.agentId,
      owner_session_id: params.ownerSessionId,
      log_type: params.logType,
      status: params.status,
      step_id: params.stepId,
      keyword: params.keyword,
      limit: params.limit,
      cursor: params.cursor,
    }
    return this.rpcClient.call<OpenDanWorkspaceWorklogsResult, OpenDanListWorkshopWorklogsReq>('list_workshop_worklogs', req)
  }

  async listWorkspaceWorklogs(params: ListWorkspaceWorklogsParams): Promise<OpenDanWorkspaceWorklogsResult> {
    return this.listWorkshopWorklogs(params)
  }

  async listWorkshopTodos(params: ListWorkshopTodosParams): Promise<OpenDanWorkspaceTodosResult> {
    const req: OpenDanListWorkshopTodosReq = {
      agent_id: params.agentId,
      owner_session_id: params.ownerSessionId,
      status: params.status,
      include_closed: params.includeClosed,
      limit: params.limit,
      cursor: params.cursor,
    }
    return this.rpcClient.call<OpenDanWorkspaceTodosResult, OpenDanListWorkshopTodosReq>('list_workshop_todos', req)
  }

  async listWorkspaceTodos(params: ListWorkspaceTodosParams): Promise<OpenDanWorkspaceTodosResult> {
    return this.listWorkshopTodos(params)
  }

  async listWorkshopSubAgents(params: ListWorkshopSubAgentsParams): Promise<OpenDanWorkspaceSubAgentsResult> {
    const req: OpenDanListWorkshopSubAgentsReq = {
      agent_id: params.agentId,
      include_disabled: params.includeDisabled,
      limit: params.limit,
      cursor: params.cursor,
    }
    return this.rpcClient.call<OpenDanWorkspaceSubAgentsResult, OpenDanListWorkshopSubAgentsReq>('list_workshop_sub_agents', req)
  }

  async listWorkspaceSubAgents(params: ListWorkspaceSubAgentsParams): Promise<OpenDanWorkspaceSubAgentsResult> {
    return this.listWorkshopSubAgents(params)
  }

  async listAgentSessions(params: ListAgentSessionsParams): Promise<OpenDanAgentSessionListResult> {
    const req: OpenDanListAgentSessionsReq = {
      agent_id: params.agentId,
      limit: params.limit,
      cursor: params.cursor,
    }
    return this.rpcClient.call<OpenDanAgentSessionListResult, OpenDanListAgentSessionsReq>('list_agent_sessions', req)
  }

  async getAgentSession(agentId: string, sessionId: string): Promise<OpenDanAgentSessionRecord> {
    const req: OpenDanGetAgentSessionReq = {
      agent_id: agentId,
      session_id: sessionId,
    }
    return this.rpcClient.call<OpenDanAgentSessionRecord, OpenDanGetAgentSessionReq>('get_agent_session', req)
  }

  async getSessionRecord(sessionId: string): Promise<OpenDanAgentSessionRecord> {
    const req: OpenDanGetSessionRecordReq = {
      session_id: sessionId,
    }
    return this.rpcClient.call<OpenDanAgentSessionRecord, OpenDanGetSessionRecordReq>('get_session_record', req)
  }
}
