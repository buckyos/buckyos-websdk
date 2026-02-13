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
export interface ListAgentsParams {
    status?: string;
    includeSubAgents?: boolean;
    limit?: number;
    cursor?: string;
}
export interface ListWorkspaceWorklogsParams {
    agentId: string;
    logType?: string;
    status?: string;
    stepId?: string;
    keyword?: string;
    limit?: number;
    cursor?: string;
}
export interface ListWorkspaceTodosParams {
    agentId: string;
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
export declare class OpenDanClient {
    private rpcClient;
    constructor(rpcClient: kRPCClient);
    setSeq(seq: number): void;
    listAgents(params?: ListAgentsParams): Promise<OpenDanAgentListResult>;
    getAgent(agentId: string): Promise<OpenDanAgentInfo>;
    getWorkspace(agentId: string): Promise<OpenDanWorkspaceInfo>;
    listWorkspaceWorklogs(params: ListWorkspaceWorklogsParams): Promise<OpenDanWorkspaceWorklogsResult>;
    listWorkspaceTodos(params: ListWorkspaceTodosParams): Promise<OpenDanWorkspaceTodosResult>;
    listWorkspaceSubAgents(params: ListWorkspaceSubAgentsParams): Promise<OpenDanWorkspaceSubAgentsResult>;
}
//# sourceMappingURL=opendan_client.d.ts.map