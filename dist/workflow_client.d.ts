import { kRPCClient, RPCError } from './krpc_client';
export declare const WORKFLOW_SERVICE_NAME = "workflow";
export interface WorkflowOwner {
    user_id: string;
    app_id: string;
}
export type WorkflowDefinitionSource = 'system' | 'user_imported' | 'app_registered' | 'agent_generated';
/** Structured execution error carried from the function implementation to the RPC surface. */
export interface WorkflowExecutionError {
    code: string;
    message: string;
    details?: unknown;
    retryable?: boolean;
}
export declare const WorkflowErrorCode: {
    readonly ToolsMissing: "tools_missing";
    readonly Timeout: "timeout";
    readonly Cancelled: "cancelled";
    readonly Interrupted: "interrupted";
    readonly PermissionDenied: "permission_denied";
    readonly ResourceLimit: "resource_limit";
    readonly EnvironmentChanged: "environment_changed";
    readonly InvalidParams: "invalid_params";
    readonly InvalidResult: "invalid_result";
    readonly InputUnavailable: "input_unavailable";
    readonly ToolFailed: "tool_failed";
    readonly FunctionNotFound: "function_not_found";
    readonly QueueFull: "queue_full";
    readonly Internal: "internal";
    readonly SystemDefinitionReadOnly: "system_definition_read_only";
    readonly UnresolvedFunction: "unresolved_function";
    readonly RunTerminal: "run_terminal";
    readonly InvalidInput: "invalid_input";
    readonly NotAuthorized: "not_authorized";
};
/** `{ok:false, error, message, detail}` from the workflow service. */
export declare class WorkflowRequestError extends RPCError {
    readonly code: string;
    readonly detail: unknown;
    constructor(code: string, message: string, detail: unknown);
}
/** `cache` = reused step result, `executed` = thunk ran, `direct` = orchestrator adapter, `submitted` = agent output. */
export type WorkflowNodeSource = 'cache' | 'executed' | 'direct' | 'submitted';
export declare enum WorkflowStepType {
    Autonomous = "autonomous",
    HumanConfirm = "human_confirm",
    HumanRequired = "human_required"
}
export declare enum WorkflowOutputMode {
    Single = "single",
    FiniteSeekable = "finite_seekable",
    FiniteSequential = "finite_sequential"
}
export declare enum WorkflowJoinMode {
    All = "all",
    Any = "any",
    NOfM = "n_of_m"
}
export declare enum WorkflowRetryFallback {
    Human = "human",
    Abort = "abort"
}
export interface WorkflowBudgetGuard {
    max_tokens?: number;
    max_cost_usdb?: number;
    max_duration?: string;
}
export interface WorkflowRetryGuard {
    max_attempts?: number;
    backoff?: string;
    fallback?: WorkflowRetryFallback;
}
export interface WorkflowGuardConfig {
    budget?: WorkflowBudgetGuard;
    permissions?: string[];
    retry?: WorkflowRetryGuard;
    timeout?: string;
    amendment_auto_approve?: boolean;
    max_cost_usdb?: number;
    max_duration?: string;
}
export interface WorkflowStepDefinition {
    id: string;
    name: string;
    executor?: string;
    type: WorkflowStepType;
    input?: unknown;
    input_schema?: unknown;
    output_schema: unknown;
    subject_ref?: string;
    prompt?: string;
    idempotent?: boolean;
    skippable?: boolean;
    output_mode?: WorkflowOutputMode;
    guards?: WorkflowGuardConfig;
}
export interface WorkflowBranchNodeDefinition {
    type: 'branch';
    id: string;
    on: string;
    paths: Record<string, string>;
    max_iterations: number;
}
export interface WorkflowParallelNodeDefinition {
    type: 'parallel';
    id: string;
    branches: string[];
    join: WorkflowJoinMode;
    n?: number;
}
export interface WorkflowForEachNodeDefinition {
    type: 'for_each';
    id: string;
    items: string;
    steps: string[];
    max_items: number;
    concurrency?: number;
}
export type WorkflowControlNodeDefinition = WorkflowBranchNodeDefinition | WorkflowParallelNodeDefinition | WorkflowForEachNodeDefinition;
export interface WorkflowEdgeDefinition {
    from: string;
    to?: string | null;
}
export interface WorkflowDefinition {
    schema_version: string;
    id: string;
    name: string;
    description?: string | null;
    trigger: unknown;
    steps: WorkflowStepDefinition[];
    nodes?: WorkflowControlNodeDefinition[];
    edges: WorkflowEdgeDefinition[];
    guards?: WorkflowGuardConfig | null;
    defs?: Record<string, unknown>;
}
export declare enum WorkflowDefinitionStatus {
    Draft = "draft",
    Active = "active",
    Archived = "archived"
}
export declare enum WorkflowRunStatus {
    Created = "created",
    Running = "running",
    WaitingHuman = "waiting_human",
    Completed = "completed",
    Failed = "failed",
    Paused = "paused",
    Aborted = "aborted",
    BudgetExhausted = "budget_exhausted"
}
export declare enum WorkflowNodeRunState {
    Pending = "pending",
    Ready = "ready",
    Running = "running",
    Completed = "completed",
    Failed = "failed",
    Retrying = "retrying",
    WaitingHuman = "waiting_human",
    Skipped = "skipped",
    Aborted = "aborted",
    Cancelled = "cancelled"
}
export declare enum WorkflowHumanActionKind {
    Approve = "approve",
    Modify = "modify",
    Reject = "reject",
    Retry = "retry",
    Skip = "skip",
    Abort = "abort",
    Rollback = "rollback"
}
export interface WorkflowEventEnvelope {
    event_id: string;
    type: string;
    ts: string;
    run_id: string;
    plan_version: number;
    seq: number;
    actor: string;
    node_id?: string | null;
    attempt?: number | null;
    payload?: unknown;
}
export interface WorkflowHumanAction {
    node_id: string;
    action: WorkflowHumanActionKind;
    payload?: unknown;
    actor?: string;
}
export interface WorkflowSubmitDefinitionReq {
    owner?: WorkflowOwner;
    definition: WorkflowDefinition;
    tags?: string[];
    /** `system` is reserved for the service and rejected. */
    source?: Exclude<WorkflowDefinitionSource, 'system'>;
}
export interface WorkflowAnalysisIssue {
    severity: string;
    code: string;
    message: string;
    node_id?: string | null;
}
export interface WorkflowAnalysisReport {
    errors: WorkflowAnalysisIssue[];
    warnings: WorkflowAnalysisIssue[];
}
export interface WorkflowDefinitionSummary {
    id: string;
    schema_version: string;
    name: string;
    owner: WorkflowOwner;
    source: WorkflowDefinitionSource;
    read_only: boolean;
    revision: string;
    status: WorkflowDefinitionStatus;
    version: number;
    tags: string[];
    created_at: number;
    updated_at: number;
    warnings: number;
    errors: number;
}
export interface WorkflowDefinitionRecord {
    id: string;
    schema_version: string;
    name: string;
    owner: WorkflowOwner;
    source: WorkflowDefinitionSource;
    read_only: boolean;
    revision: string;
    resolved_functions: Record<string, string>;
    definition: WorkflowDefinition;
    compiled: WorkflowCompiledWorkflow;
    analysis: WorkflowAnalysisReport;
    status: WorkflowDefinitionStatus;
    version: number;
    tags: string[];
    created_at: number;
    updated_at: number;
}
export interface WorkflowCompiledGraph {
    start_nodes: string[];
    terminal_from: string[];
    incoming: Record<string, string[]>;
    explicit_successors: Record<string, string[]>;
    all_successors: Record<string, string[]>;
    branch_targets: Record<string, Record<string, string>>;
    parallel_branches: Record<string, string[]>;
    for_each_steps: Record<string, string[]>;
}
export interface WorkflowCompiledNode {
    id: string;
    name: string;
    expr: unknown;
    output_schema?: unknown;
    skippable: boolean;
    idempotent: boolean;
}
export interface WorkflowCompiledWorkflow {
    schema_version: string;
    workflow_id: string;
    workflow_name: string;
    definition: WorkflowDefinition;
    nodes: Record<string, WorkflowCompiledNode>;
    graph: WorkflowCompiledGraph;
    warnings: WorkflowAnalysisIssue[];
    resolved_functions: Record<string, string>;
    revision: string;
}
export interface WorkflowSubmitDefinitionResult {
    workflow_id: string;
    version: number;
    revision: string;
    source: WorkflowDefinitionSource;
    analysis: WorkflowAnalysisReport;
    definition: WorkflowDefinitionRecord;
}
export interface WorkflowDryRunResult {
    analysis: WorkflowAnalysisReport;
    graph: WorkflowCompiledGraph;
    revision: string;
    resolved_functions: Record<string, string>;
}
export interface WorkflowListDefinitionsReq {
    owner?: WorkflowOwner;
    status?: WorkflowDefinitionStatus;
    tag?: string;
    source?: WorkflowDefinitionSource;
}
export interface WorkflowFunctionRegistration {
    name: string;
    version: string;
    fun_id: string;
    description: string;
    timeout?: number | null;
    requirements: Record<string, number>;
    best_run_weight: Record<string, number>;
    affinity_type: unknown;
}
export interface WorkflowFunctionObject {
    func_type: unknown;
    content: string;
    is_pure: boolean;
    params_type: Record<string, unknown>;
    params_schema: unknown;
    result_type: unknown;
    result_schema: unknown;
}
export interface WorkflowFunctionEntry {
    fun_id: string;
    registration: WorkflowFunctionRegistration;
    object: WorkflowFunctionObject;
    /** Only on `getFunction`: whether the FunctionObject is readable from the object store. */
    published?: boolean;
}
export interface WorkflowToolInfo {
    path: string;
    version: string;
}
export interface WorkflowCapabilities {
    execution_epoch: number;
    environment: {
        revision: string;
        probed_at: number;
        tools: Record<string, WorkflowToolInfo>;
        missing: string[];
        searched: string[];
    };
    functions: number;
}
export interface WorkflowCreateRunReq {
    /** Record id, or the logical id of a system definition (`media.pdf`). */
    workflow_id: string;
    owner?: WorkflowOwner;
    input?: unknown;
    callback_url?: string;
    auto_start?: boolean;
    /** Reuse an active run of the same principal / revision / input / environment. */
    ensure?: boolean;
    /** Wait up to this long (<= 5000) for a terminal state before returning. */
    wait_ms?: number;
}
export interface WorkflowRunTransitionResult {
    run_id: string;
    status: WorkflowRunStatus;
    events: WorkflowEventEnvelope[];
    accepted?: boolean;
    seq?: number;
    from_seq?: number;
    to_seq?: number;
}
export interface WorkflowCreateRunResult extends WorkflowRunTransitionResult {
    workflow_id: string;
    revision: string;
    reused: boolean;
    output: Record<string, unknown>;
    seq: number;
}
export interface WorkflowStartRunReq {
    run_id: string;
    wait_ms?: number;
}
export interface WorkflowCancelRunReq {
    run_id: string;
    reason?: string;
}
export interface WorkflowSubmitHumanActionReq {
    run_id: string;
    node_id: string;
    kind: WorkflowHumanActionKind;
    /** `modify`: `{modified_subject}`. `reject`: optional `{feedback}`. */
    payload?: Record<string, unknown>;
}
export interface WorkflowRunGraph {
    run_id: string;
    workflow_id: string;
    workflow_name: string;
    status: WorkflowRunStatus;
    revision: string;
    requested_by?: string | null;
    executor: string;
    owner: WorkflowOwner;
    graph: WorkflowCompiledGraph;
    nodes: Record<string, WorkflowCompiledNode>;
    node_states: Record<string, WorkflowNodeRunState>;
    node_outputs: Record<string, unknown>;
    node_errors: Record<string, WorkflowExecutionError>;
    node_sources: Record<string, WorkflowNodeSource>;
    node_attempts: Record<string, number>;
    human_waiting_nodes: string[];
    pending_thunks: Record<string, unknown>;
    metrics: Record<string, unknown>;
    output: Record<string, unknown>;
    deadline_at?: number | null;
    execution_epoch: number;
    created_at: number;
    updated_at: number;
    seq: number;
}
export interface WorkflowRunOutput {
    run_id: string;
    status: WorkflowRunStatus;
    terminal: boolean;
    revision: string;
    output: Record<string, unknown>;
    node_errors: Record<string, WorkflowExecutionError>;
    run_error?: WorkflowExecutionError | null;
    delivery: {
        artifacts: string[];
        /** How many objects the requester may now read through NDM. */
        held: number;
        hold_error?: string | null;
    };
}
export interface WorkflowListRunsReq {
    owner?: WorkflowOwner;
    workflow_id?: string;
    status?: WorkflowRunStatus | string;
}
export interface WorkflowRunSummary {
    run_id: string;
    workflow_id: string;
    workflow_name: string;
    status: WorkflowRunStatus;
    revision: string;
    owner: WorkflowOwner;
    requested_by?: string | null;
    created_at: number;
    updated_at: number;
    seq: number;
    progress: number;
}
export interface WorkflowSubmitStepOutputReq {
    run_id: string;
    node_id: string;
    output?: unknown;
    actor?: string;
}
export interface WorkflowReportStepProgressReq {
    run_id: string;
    node_id: string;
    progress?: unknown;
    actor?: string;
}
export interface WorkflowRequestHumanReq {
    run_id: string;
    node_id: string;
    prompt?: string;
    subject?: unknown;
    actor?: string;
}
export interface WorkflowSubmitAmendmentReq {
    run_id: string;
    patch?: unknown;
    actor?: string;
}
export interface WorkflowDecideAmendmentReq {
    run_id: string;
    amendment_id: string;
    actor?: string;
    reason?: string;
}
export interface WorkflowHistoryReq {
    run_id: string;
    since_seq?: number;
    limit?: number;
}
export interface WorkflowHistoryResult {
    run_id: string;
    status: WorkflowRunStatus;
    events: WorkflowEventEnvelope[];
    next_seq: number;
    current_seq: number;
}
export interface WorkflowSubscribeEventsResult {
    channel: string;
    transport: string;
    history: WorkflowHistoryResult;
}
export declare enum WorkflowScheduledTaskStatus {
    Enabled = "enabled",
    Paused = "paused",
    Archived = "archived",
    Error = "error"
}
export type WorkflowScheduledTaskSchedule = {
    kind: 'cron';
    expr: string;
    timezone: string;
    calendar?: string | null;
    start_at?: number | null;
    end_at?: number | null;
} | {
    kind: 'once';
    run_at: number;
    timezone?: string | null;
} | {
    kind: 'run_every';
    every_sec: number;
    start_at?: number | null;
    end_at?: number | null;
    timezone?: string | null;
};
export interface WorkflowScheduledTaskTarget {
    task_type: string;
    runner?: string;
    name_template: string;
    data_template?: unknown;
}
export declare enum WorkflowScheduledTaskMisfirePolicy {
    Skip = "skip",
    RunOnce = "run_once",
    CatchUp = "catch_up",
    Manual = "manual"
}
export interface WorkflowScheduledTaskPolicy {
    misfire: WorkflowScheduledTaskMisfirePolicy;
    max_parallel_runs: number;
    catch_up_limit: number;
    jitter_sec: number;
}
export interface WorkflowScheduledTaskState {
    next_fire_at?: number | null;
    last_fire_at?: number | null;
    last_task_id?: number | null;
    last_run_id?: string | null;
    consecutive_failures?: number;
    last_error?: string | null;
}
export interface WorkflowScheduledTaskMirror {
    root_task_id?: number | null;
    root_id?: string | null;
}
export interface WorkflowScheduledTask {
    schedule_id: string;
    owner: WorkflowOwner;
    name: string;
    description?: string | null;
    status: WorkflowScheduledTaskStatus;
    schedule: WorkflowScheduledTaskSchedule;
    target: WorkflowScheduledTaskTarget;
    state: WorkflowScheduledTaskState;
    policy: WorkflowScheduledTaskPolicy;
    task_mirror?: WorkflowScheduledTaskMirror;
    created_at: number;
    updated_at: number;
}
export declare enum WorkflowScheduledTaskFireStatus {
    Created = "created",
    TaskCreated = "task_created",
    Skipped = "skipped",
    Failed = "failed"
}
export interface WorkflowScheduledTaskFireRecord {
    fire_id: string;
    schedule_id: string;
    fire_key: string;
    fire_time: number;
    manual: boolean;
    status: WorkflowScheduledTaskFireStatus;
    task_id?: number | null;
    run_id?: string | null;
    error?: string | null;
    created_at: number;
    updated_at: number;
}
export interface WorkflowCreateScheduledTaskReq {
    owner: WorkflowOwner;
    name: string;
    description?: string;
    schedule: WorkflowScheduledTaskSchedule;
    target: WorkflowScheduledTaskTarget;
    policy?: WorkflowScheduledTaskPolicy;
    status?: WorkflowScheduledTaskStatus;
}
export interface WorkflowUpdateScheduledTaskReq {
    schedule_id: string;
    name?: string;
    description?: string | null;
    schedule?: WorkflowScheduledTaskSchedule;
    target?: WorkflowScheduledTaskTarget;
    policy?: WorkflowScheduledTaskPolicy;
}
export interface WorkflowListScheduledTasksReq {
    owner?: WorkflowOwner;
    status?: WorkflowScheduledTaskStatus;
    workflow_id?: string;
    name?: string;
}
export interface WorkflowRunScheduledTaskNowReq {
    schedule_id: string;
    fire_time?: number;
}
export interface WorkflowGetScheduledTaskHistoryReq {
    schedule_id: string;
    limit?: number;
}
export interface WorkflowValidateScheduledTaskReq {
    schedule: WorkflowScheduledTaskSchedule;
    target?: WorkflowScheduledTaskTarget;
}
export interface WorkflowValidateScheduledTaskResult {
    valid: boolean;
    normalized_expr?: string | null;
    timezone: string;
    next_fire_times: string[];
    warnings: string[];
}
export declare class WorkflowClient {
    private rpcClient;
    constructor(rpcClient: kRPCClient);
    setSeq(seq: number): void;
    private callOk;
    submitDefinition(request: WorkflowSubmitDefinitionReq): Promise<WorkflowSubmitDefinitionResult>;
    getDefinition(workflowId: string): Promise<WorkflowDefinitionRecord>;
    listDefinitions(request?: WorkflowListDefinitionsReq): Promise<WorkflowDefinitionSummary[]>;
    archiveDefinition(workflowId: string): Promise<WorkflowDefinitionStatus>;
    dryRun(definition: WorkflowDefinition): Promise<WorkflowDryRunResult>;
    listFunctions(prefix?: string): Promise<WorkflowFunctionEntry[]>;
    getFunction(ref: {
        fun_id: string;
    } | {
        name: string;
        version?: string;
    }): Promise<WorkflowFunctionEntry>;
    getCapabilities(): Promise<WorkflowCapabilities>;
    createRun(request: WorkflowCreateRunReq): Promise<WorkflowCreateRunResult>;
    startRun(runId: string, waitMs?: number): Promise<WorkflowRunTransitionResult>;
    tickRun(runId: string): Promise<WorkflowRunTransitionResult>;
    cancelRun(request: WorkflowCancelRunReq): Promise<WorkflowRunTransitionResult>;
    getRunGraph(runId: string): Promise<WorkflowRunGraph>;
    getRunOutput(runId: string): Promise<WorkflowRunOutput>;
    listRuns(request?: WorkflowListRunsReq): Promise<WorkflowRunSummary[]>;
    submitStepOutput(request: WorkflowSubmitStepOutputReq): Promise<WorkflowRunTransitionResult>;
    reportStepProgress(request: WorkflowReportStepProgressReq): Promise<WorkflowRunTransitionResult>;
    submitHumanAction(request: WorkflowSubmitHumanActionReq): Promise<WorkflowRunTransitionResult>;
    requestHuman(request: WorkflowRequestHumanReq): Promise<WorkflowRunTransitionResult>;
    submitAmendment(request: WorkflowSubmitAmendmentReq): Promise<unknown>;
    approveAmendment(request: WorkflowDecideAmendmentReq): Promise<{
        amendment: unknown;
        plan_version: number;
    }>;
    rejectAmendment(request: WorkflowDecideAmendmentReq): Promise<{
        amendment: unknown;
        plan_version: number;
    }>;
    getHistory(request: WorkflowHistoryReq): Promise<WorkflowHistoryResult>;
    subscribeEvents(request: WorkflowHistoryReq): Promise<WorkflowSubscribeEventsResult>;
    createScheduledTask(request: WorkflowCreateScheduledTaskReq): Promise<WorkflowScheduledTask>;
    updateScheduledTask(request: WorkflowUpdateScheduledTaskReq): Promise<WorkflowScheduledTask>;
    getScheduledTask(scheduleId: string): Promise<WorkflowScheduledTask>;
    listScheduledTasks(request?: WorkflowListScheduledTasksReq): Promise<WorkflowScheduledTask[]>;
    pauseScheduledTask(scheduleId: string): Promise<WorkflowScheduledTask>;
    resumeScheduledTask(scheduleId: string): Promise<WorkflowScheduledTask>;
    archiveScheduledTask(scheduleId: string): Promise<WorkflowScheduledTask>;
    runScheduledTaskNow(request: WorkflowRunScheduledTaskNowReq): Promise<WorkflowScheduledTaskFireRecord>;
    getScheduledTaskHistory(request: WorkflowGetScheduledTaskHistoryReq): Promise<WorkflowScheduledTaskFireRecord[]>;
    validateScheduledTask(request: WorkflowValidateScheduledTaskReq): Promise<WorkflowValidateScheduledTaskResult>;
}
//# sourceMappingURL=workflow_client.d.ts.map