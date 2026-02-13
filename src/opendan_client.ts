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

export interface ListAgentsParams {
  status?: string
  includeSubAgents?: boolean
  limit?: number
  cursor?: string
}

export interface ListWorkspaceWorklogsParams {
  agentId: string
  logType?: string
  status?: string
  stepId?: string
  keyword?: string
  limit?: number
  cursor?: string
}

export interface ListWorkspaceTodosParams {
  agentId: string
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

interface OpenDanListAgentsReq {
  status?: string
  include_sub_agents?: boolean
  limit?: number
  cursor?: string
}

interface OpenDanGetAgentReq {
  agent_id: string
}

interface OpenDanGetWorkspaceReq {
  agent_id: string
}

interface OpenDanListWorkspaceWorklogsReq {
  agent_id: string
  log_type?: string
  status?: string
  step_id?: string
  keyword?: string
  limit?: number
  cursor?: string
}

interface OpenDanListWorkspaceTodosReq {
  agent_id: string
  status?: string
  include_closed?: boolean
  limit?: number
  cursor?: string
}

interface OpenDanListWorkspaceSubAgentsReq {
  agent_id: string
  include_disabled?: boolean
  limit?: number
  cursor?: string
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

  async getWorkspace(agentId: string): Promise<OpenDanWorkspaceInfo> {
    const req: OpenDanGetWorkspaceReq = { agent_id: agentId }
    return this.rpcClient.call<OpenDanWorkspaceInfo, OpenDanGetWorkspaceReq>('get_workspace', req)
  }

  async listWorkspaceWorklogs(params: ListWorkspaceWorklogsParams): Promise<OpenDanWorkspaceWorklogsResult> {
    const req: OpenDanListWorkspaceWorklogsReq = {
      agent_id: params.agentId,
      log_type: params.logType,
      status: params.status,
      step_id: params.stepId,
      keyword: params.keyword,
      limit: params.limit,
      cursor: params.cursor,
    }
    return this.rpcClient.call<OpenDanWorkspaceWorklogsResult, OpenDanListWorkspaceWorklogsReq>('list_workspace_worklogs', req)
  }

  async listWorkspaceTodos(params: ListWorkspaceTodosParams): Promise<OpenDanWorkspaceTodosResult> {
    const req: OpenDanListWorkspaceTodosReq = {
      agent_id: params.agentId,
      status: params.status,
      include_closed: params.includeClosed,
      limit: params.limit,
      cursor: params.cursor,
    }
    return this.rpcClient.call<OpenDanWorkspaceTodosResult, OpenDanListWorkspaceTodosReq>('list_workspace_todos', req)
  }

  async listWorkspaceSubAgents(params: ListWorkspaceSubAgentsParams): Promise<OpenDanWorkspaceSubAgentsResult> {
    const req: OpenDanListWorkspaceSubAgentsReq = {
      agent_id: params.agentId,
      include_disabled: params.includeDisabled,
      limit: params.limit,
      cursor: params.cursor,
    }
    return this.rpcClient.call<OpenDanWorkspaceSubAgentsResult, OpenDanListWorkspaceSubAgentsReq>('list_workspace_sub_agents', req)
  }
}

