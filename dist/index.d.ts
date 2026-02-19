declare interface AccountInfo {
    user_name: string;
    user_id: string;
    user_type: string;
    session_token: string;
}

declare function attachEvent(event_name: string, callback: Function): void;

declare class AuthClient {
    zone_hostname: string;
    clientId: string;
    cookieOptions: any;
    authWindow: Window | null;
    constructor(zone_base_url: string, appId: string);
    login(redirect_uri?: string | null): Promise<AccountInfo | null>;
    request(action: string, params: any): Promise<void>;
    _openAuthWindow(redirect_uri?: string | null): Promise<string>;
}

export declare const BS_SERVICE_OPENDAN = "opendan";

export declare const BS_SERVICE_TASK_MANAGER = "task-manager";

export declare const BS_SERVICE_VERIFY_HUB = "verify-hub";

export declare const buckyos: {
    kRPCClient: typeof kRPCClient;
    AuthClient: typeof AuthClient;
    initBuckyOS: typeof initBuckyOS;
    getBuckyOSConfig: typeof getBuckyOSConfig;
    getRuntimeType: typeof getRuntimeType;
    getAppId: typeof getAppId;
    attachEvent: typeof attachEvent;
    removeEvent: typeof removeEvent;
    getAccountInfo: typeof getAccountInfo;
    doLogin: typeof doLogin;
    login: typeof login;
    logout: typeof logout;
    hashPassword: typeof hashPassword;
    getAppSetting: typeof getAppSetting;
    setAppSetting: typeof setAppSetting;
    getCurrentWalletUser: typeof getCurrentWalletUser;
    walletSignWithActiveDid: typeof walletSignWithActiveDid;
    getZoneHostName: typeof getZoneHostName;
    getZoneServiceURL: typeof getZoneServiceURL;
    getServiceRpcClient: typeof getServiceRpcClient;
    getVerifyHubClient: typeof getVerifyHubClient;
    getTaskManagerClient: typeof getTaskManagerClient;
    getOpenDanClient: typeof getOpenDanClient;
};

export declare interface BuckyOSConfig {
    zoneHost: string;
    appId: string;
    defaultProtocol: string;
    runtimeType: RuntimeType;
}

declare interface CreateTaskOptions {
    permissions?: TaskPermissions;
    parent_id?: number;
    priority?: number;
}

declare interface CreateTaskParams {
    name: string;
    taskType: string;
    data?: unknown;
    userId: string;
    appId: string;
    options?: CreateTaskOptions;
}

declare function doLogin(username: string, password: string): Promise<AccountInfo | null>;

declare type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

declare function getAccountInfo(): AccountInfo | null;

declare function getAppId(): string | null;

declare function getAppSetting(setting_name?: string | null): void;

declare function getBuckyOSConfig(): BuckyOSConfig | null;

declare function getCurrentWalletUser(): Promise<any>;

declare function getOpenDanClient(): OpenDanClient;

declare function getRuntimeType(): RuntimeType;

declare function getServiceRpcClient(service_name: string): kRPCClient;

declare function getTaskManagerClient(): TaskManagerClient;

declare function getVerifyHubClient(): VerifyHubClient;

declare function getZoneHostName(): string | null;

declare function getZoneServiceURL(service_name: string): string;

declare function hashPassword(username: string, password: string, nonce?: number | null): string;

declare function initBuckyOS(appid: string, config?: BuckyOSConfig | null): Promise<void>;

declare class kRPCClient {
    private serverUrl;
    private protocolType;
    private seq;
    private sessionToken;
    private initToken;
    private fetcher;
    constructor(url: string, token?: string | null, seq?: number | null, fetcher?: Fetcher);
    call<TResult, TParams>(method: string, params: TParams): Promise<TResult>;
    setSeq(seq: number): void;
    resetSessionToken(): void;
    setSessionToken(token: string | null): void;
    getSessionToken(): string | null;
    private buildRequest;
    private parseSys;
    private _call;
}

declare interface LegacyLoginByPasswordResponse {
    user_name: string;
    user_id: string;
    user_type: string;
    session_token: string;
    refresh_token?: string;
}

declare interface ListAgentSessionsParams {
    agentId: string;
    limit?: number;
    cursor?: string;
}

declare interface ListAgentsParams {
    status?: string;
    includeSubAgents?: boolean;
    limit?: number;
    cursor?: string;
}

declare interface ListTasksByTimeRangeParams {
    appId?: string;
    taskType?: string;
    sourceUserId?: string;
    sourceAppId?: string;
    startTime: number;
    endTime: number;
}

declare interface ListTasksParams {
    filter?: TaskFilter;
    sourceUserId?: string;
    sourceAppId?: string;
}

declare interface ListWorkshopSubAgentsParams {
    agentId: string;
    includeDisabled?: boolean;
    limit?: number;
    cursor?: string;
}

declare interface ListWorkshopTodosParams {
    agentId: string;
    ownerSessionId: string;
    status?: string;
    includeClosed?: boolean;
    limit?: number;
    cursor?: string;
}

declare interface ListWorkshopWorklogsParams {
    agentId: string;
    ownerSessionId: string;
    logType?: string;
    status?: string;
    stepId?: string;
    keyword?: string;
    limit?: number;
    cursor?: string;
}

declare interface ListWorkspaceSubAgentsParams {
    agentId: string;
    includeDisabled?: boolean;
    limit?: number;
    cursor?: string;
}

declare interface ListWorkspaceTodosParams {
    agentId: string;
    ownerSessionId: string;
    status?: string;
    includeClosed?: boolean;
    limit?: number;
    cursor?: string;
}

declare interface ListWorkspaceWorklogsParams {
    agentId: string;
    ownerSessionId: string;
    logType?: string;
    status?: string;
    stepId?: string;
    keyword?: string;
    limit?: number;
    cursor?: string;
}

declare function login(auto_login?: boolean): Promise<AccountInfo | null>;

declare interface LoginByJwtParams {
    jwt: string;
    login_params?: Record<string, unknown>;
}

declare interface LoginByPasswordParams {
    username: string;
    password: string;
    appid: string;
    source_url?: string;
}

declare interface LoginByPasswordResponse {
    user_info: VerifyHubUserInfo;
    session_token: string;
    refresh_token: string;
}

declare function logout(clean_account_info?: boolean): void;

declare interface OpenDanAgentInfo {
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

declare interface OpenDanAgentListResult {
    items: OpenDanAgentInfo[];
    next_cursor?: string;
    total?: number;
}

declare interface OpenDanAgentSessionListResult {
    items: string[];
    next_cursor?: string;
    total?: number;
}

declare interface OpenDanAgentSessionRecord {
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

declare interface OpenDanSessionLink {
    relation: string;
    session_id: string;
    agent_did?: string;
    note?: string;
}

declare interface OpenDanSubAgentInfo {
    agent_id: string;
    agent_name?: string;
    status?: string;
    current_run_id?: string;
    last_active_at?: string;
    workspace_id?: string;
    workspace_path?: string;
    extra?: unknown;
}

declare interface OpenDanTodoItem {
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

declare interface OpenDanWorklogItem {
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

declare interface OpenDanWorkspaceInfo {
    workspace_id: string;
    agent_id: string;
    workspace_path?: string;
    todo_db_path?: string;
    worklog_db_path?: string;
    summary?: unknown;
    extra?: unknown;
}

declare interface OpenDanWorkspaceSubAgentsResult {
    items: OpenDanSubAgentInfo[];
    next_cursor?: string;
    total?: number;
}

declare interface OpenDanWorkspaceTodosResult {
    items: OpenDanTodoItem[];
    next_cursor?: string;
    total?: number;
}

declare interface OpenDanWorkspaceWorklogsResult {
    items: OpenDanWorklogItem[];
    next_cursor?: string;
    total?: number;
}

declare interface PauseResumeOptions {
    sourceUserId?: string;
    sourceAppId?: string;
}

declare interface RefreshTokenParams {
    refresh_token: string;
}

declare function removeEvent(cookie_id: string): void;

export declare enum RuntimeType {
    Browser = "Browser",
    NodeJS = "NodeJS",
    AppRuntime = "AppRuntime",
    Unknown = "Unknown"
}

declare function setAppSetting(setting_name: string | null | undefined, setting_value: string): void;

declare interface Task {
    id: number;
    user_id: string;
    app_id: string;
    parent_id: number | null;
    root_id: number | null;
    name: string;
    task_type: string;
    status: TaskStatus;
    progress: number;
    message: string | null;
    data: unknown;
    permissions: TaskPermissions;
    created_at: number;
    updated_at: number;
}

declare interface TaskFilter {
    app_id?: string;
    task_type?: string;
    status?: TaskStatus;
    parent_id?: number;
    root_id?: number;
}

export declare class TaskManagerClient {
    private rpcClient;
    constructor(rpcClient: kRPCClient);
    setSeq(seq: number): void;
    createTask(params: CreateTaskParams): Promise<Task>;
    getTask(id: number): Promise<Task>;
    waitForTaskEnd(id: number): Promise<TaskStatus>;
    waitForTaskEndWithInterval(id: number, pollIntervalMs: number): Promise<TaskStatus>;
    listTasks(params?: ListTasksParams): Promise<Task[]>;
    listTasksByTimeRange(params: ListTasksByTimeRangeParams): Promise<Task[]>;
    updateTask(payload: TaskUpdatePayload): Promise<void>;
    cancelTask(id: number, recursive?: boolean): Promise<void>;
    getSubtasks(parentId: number): Promise<Task[]>;
    updateTaskStatus(id: number, status: TaskStatus): Promise<void>;
    updateTaskProgress(id: number, completedItems: number, totalItems: number): Promise<void>;
    updateTaskError(id: number, errorMessage: string): Promise<void>;
    updateTaskData(id: number, data: unknown): Promise<void>;
    deleteTask(id: number): Promise<void>;
    pauseTask(id: number): Promise<void>;
    resumeTask(id: number): Promise<void>;
    completeTask(id: number): Promise<void>;
    markTaskAsWaitingForApproval(id: number): Promise<void>;
    markTaskAsFailed(id: number, errorMessage: string): Promise<void>;
    pauseAllRunningTasks(options?: PauseResumeOptions): Promise<void>;
    resumeLastPausedTask(options?: PauseResumeOptions): Promise<void>;
}

declare interface TaskPermissions {
    read: TaskScope;
    write: TaskScope;
}

declare enum TaskScope {
    Private = "Private",
    User = "User",
    System = "System"
}

declare enum TaskStatus {
    Pending = "Pending",
    Running = "Running",
    Paused = "Paused",
    Completed = "Completed",
    Failed = "Failed",
    Canceled = "Canceled",
    WaitingForApproval = "WaitingForApproval"
}

declare interface TaskUpdatePayload {
    id: number;
    status?: TaskStatus;
    progress?: number;
    message?: string;
    data?: unknown;
}

declare interface TokenPair {
    session_token: string;
    refresh_token: string;
}

export declare class VerifyHubClient {
    private rpcClient;
    constructor(rpcClient: kRPCClient);
    setSeq(seq: number): void;
    loginByJwt(params: LoginByJwtParams): Promise<TokenPair>;
    loginByPassword(params: LoginByPasswordParams): Promise<LoginByPasswordResponse | LegacyLoginByPasswordResponse>;
    refreshToken(params: RefreshTokenParams): Promise<TokenPair>;
    verifyToken(params: VerifyTokenParams): Promise<boolean>;
    static normalizeLoginResponse(response: LoginByPasswordResponse | LegacyLoginByPasswordResponse): LegacyLoginByPasswordResponse;
}

declare interface VerifyHubUserInfo {
    show_name: string;
    user_id: string;
    user_type: string;
    state?: string;
}

declare interface VerifyTokenParams {
    session_token: string;
    appid?: string;
}

declare function walletSignWithActiveDid(payloads: Record<string, unknown>[]): Promise<string[] | null>;

export declare const WEB3_BRIDGE_HOST = "web3.buckyos.ai";

export { }
