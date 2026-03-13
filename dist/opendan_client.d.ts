import { kRPCClient } from './krpc_client';
export declare const OPENDAN_SERVICE_NAME = "opendan";
export interface OpenDanAgentInfo {
    agent_id: string;
    agent_name?: string;
    agent_type?: string;
    status?: string;
    parent_agent_id?: string;
    current_run_id?: string;
    workspace_id?: string;
    workspace_path?: string;
    last_active_at?: string;
    updated_at?: number;
    extra?: unknown;
}
export interface OpenDanWorkspaceInfo {
    workspace_id: string;
    agent_id: string;
    workspace_path?: string;
    todo_db_path?: string;
    worklog_db_path?: string;
    summary?: unknown;
    extra?: unknown;
}
export interface OpenDanWorklogItem {
    log_id: string;
    log_type: string;
    status: string;
    timestamp: number;
    agent_id?: string;
    related_agent_id?: string;
    step_id?: string;
    summary?: string;
    payload?: unknown;
}
export interface OpenDanTodoItem {
    todo_id: string;
    title: string;
    status: string;
    agent_id?: string;
    description?: string;
    created_at?: number;
    completed_at?: number;
    created_in_step_id?: string;
    completed_in_step_id?: string;
    extra?: unknown;
}
export interface OpenDanSubAgentInfo {
    agent_id: string;
    agent_name?: string;
    status?: string;
    current_run_id?: string;
    last_active_at?: string;
    workspace_id?: string;
    workspace_path?: string;
    extra?: unknown;
}
export interface OpenDanAgentListResult {
    items: OpenDanAgentInfo[];
    next_cursor?: string;
    total?: number;
}
export interface OpenDanWorkspaceWorklogsResult {
    items: OpenDanWorklogItem[];
    next_cursor?: string;
    total?: number;
}
export interface OpenDanWorkspaceTodosResult {
    items: OpenDanTodoItem[];
    next_cursor?: string;
    total?: number;
}
export interface OpenDanWorkspaceSubAgentsResult {
    items: OpenDanSubAgentInfo[];
    next_cursor?: string;
    total?: number;
}
export interface OpenDanSessionLink {
    relation: string;
    session_id: string;
    agent_did?: string;
    note?: string;
}
export interface OpenDanAgentSessionRecord {
    session_id: string;
    owner_agent: string;
    title: string;
    summary: string;
    status: string;
    created_at_ms: number;
    updated_at_ms: number;
    last_activity_ms: number;
    links: OpenDanSessionLink[];
    tags: string[];
    meta: unknown;
}
export interface OpenDanAgentSessionListResult {
    items: string[];
    next_cursor?: string;
    total?: number;
}
export interface ListAgentsParams {
    status?: string;
    includeSubAgents?: boolean;
    limit?: number;
    cursor?: string;
}
export interface ListWorkspaceWorklogsParams {
    agentId: string;
    ownerSessionId: string;
    logType?: string;
    status?: string;
    stepId?: string;
    keyword?: string;
    limit?: number;
    cursor?: string;
}
export interface ListWorkshopWorklogsParams {
    agentId: string;
    ownerSessionId: string;
    logType?: string;
    status?: string;
    stepId?: string;
    keyword?: string;
    limit?: number;
    cursor?: string;
}
export interface ListWorkspaceTodosParams {
    agentId: string;
    ownerSessionId: string;
    status?: string;
    includeClosed?: boolean;
    limit?: number;
    cursor?: string;
}
export interface ListWorkshopTodosParams {
    agentId: string;
    ownerSessionId: string;
    status?: string;
    includeClosed?: boolean;
    limit?: number;
    cursor?: string;
}
export interface ListWorkspaceSubAgentsParams {
    agentId: string;
    includeDisabled?: boolean;
    limit?: number;
    cursor?: string;
}
export interface ListWorkshopSubAgentsParams {
    agentId: string;
    includeDisabled?: boolean;
    limit?: number;
    cursor?: string;
}
export interface ListAgentSessionsParams {
    agentId: string;
    limit?: number;
    cursor?: string;
}
export declare class OpenDanClient {
    private rpcClient;
    constructor(rpcClient: kRPCClient);
    setSeq(seq: number): void;
    listAgents(params?: ListAgentsParams): Promise<OpenDanAgentListResult>;
    getAgent(agentId: string): Promise<OpenDanAgentInfo>;
    getWorkshop(agentId: string): Promise<OpenDanWorkspaceInfo>;
    getWorkspace(agentId: string): Promise<OpenDanWorkspaceInfo>;
    listWorkshopWorklogs(params: ListWorkshopWorklogsParams): Promise<OpenDanWorkspaceWorklogsResult>;
    listWorkspaceWorklogs(params: ListWorkspaceWorklogsParams): Promise<OpenDanWorkspaceWorklogsResult>;
    listWorkshopTodos(params: ListWorkshopTodosParams): Promise<OpenDanWorkspaceTodosResult>;
    listWorkspaceTodos(params: ListWorkspaceTodosParams): Promise<OpenDanWorkspaceTodosResult>;
    listWorkshopSubAgents(params: ListWorkshopSubAgentsParams): Promise<OpenDanWorkspaceSubAgentsResult>;
    listWorkspaceSubAgents(params: ListWorkspaceSubAgentsParams): Promise<OpenDanWorkspaceSubAgentsResult>;
    listAgentSessions(params: ListAgentSessionsParams): Promise<OpenDanAgentSessionListResult>;
    getAgentSession(agentId: string, sessionId: string): Promise<OpenDanAgentSessionRecord>;
    getSessionRecord(sessionId: string): Promise<OpenDanAgentSessionRecord>;
}
//# sourceMappingURL=opendan_client.d.ts.map