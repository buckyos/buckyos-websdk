import { kRPCClient } from './krpc_client';
export declare const TASK_MANAGER_SERVICE_UNIQUE_ID = "task-manager";
export declare const TASK_MANAGER_SERVICE_NAME = "task-manager";
export declare const TASK_MANAGER_SERVICE_PORT = 3380;
export type TaskId = string;
export type TaskNoteId = number;
export declare const TASK_POLICY_PRESET_COLLABORATIVE_TREE_V1 = "collaborative-tree/v1";
export declare const RAW_TASK_SCHEMA_ID = "raw/v1";
export declare const HUMAN_APPROVAL_SCHEMA_ID = "human.approval/v1";
export declare const DOWNLOAD_TASK_SCHEMA_ID = "download/v1";
export declare const SCHEDULER_DISPATCH_THUNK_TASK_SCHEMA_ID = "scheduler.dispatch_thunk/v1";
export declare const WORKFLOW_RUN_TREE_TASK_SCHEMA_ID = "workflow.run_tree/v1";
export declare const WORKFLOW_STEP_TASK_SCHEMA_ID = "workflow.step/v1";
export declare const WORKFLOW_MAP_SHARD_TASK_SCHEMA_ID = "workflow.map_shard/v1";
export declare const WORKFLOW_THUNK_TASK_SCHEMA_ID = "workflow.thunk/v1";
export declare const WORKFLOW_SCHEDULE_TASK_SCHEMA_ID = "workflow.schedule/v1";
export declare const WORKFLOW_SEND_MESSAGE_TASK_SCHEMA_ID = "workflow.send_message/v1";
export declare const WORKFLOW_EXECUTE_RPC_TASK_SCHEMA_ID = "workflow.execute_rpc/v1";
export declare const WORKFLOW_RUN_TARGET_TASK_SCHEMA_ID = "workflow.run/v1";
export declare const AGENT_DELEGATE_TASK_SCHEMA_ID = "agent.delegate/v1";
export declare const HUMAN_INPUT_TASK_SCHEMA_ID = "human.input/v1";
export declare const OPENDAN_ASYNC_TOOL_TASK_SCHEMA_ID = "opendan.async_tool/v1";
export declare const OPENDAN_COMMAND_TASK_SCHEMA_ID = "opendan.command/v1";
export declare const TOOL_EXEC_BASH_TASK_SCHEMA_ID = "tool.exec_bash/v1";
export declare const AICC_COMPUTE_TASK_SCHEMA_ID = "aicc.compute/v1";
export declare const APP_INSTALL_TASK_SCHEMA_ID = "app.install/v1";
export declare const APP_UNINSTALL_TASK_SCHEMA_ID = "app.uninstall/v1";
export declare const APP_START_TASK_SCHEMA_ID = "app.start/v1";
export declare const APP_UPDATE_TASK_SCHEMA_ID = "app.update/v1";
export declare const TASK_ERR_NOT_FOUND = "task_not_found";
export declare const TASK_ERR_PERMISSION_DENIED = "permission_denied";
export declare const TASK_ERR_REVISION_CONFLICT = "revision_conflict";
export declare const TASK_ERR_STALE_RUNNER_EPOCH = "stale_runner_epoch";
export declare const TASK_ERR_INVALID_PHASE = "invalid_task_phase";
export declare const TASK_ERR_CONTROL_NOT_AVAILABLE = "control_not_available";
export declare const TASK_ERR_CONTROL_ALREADY_PENDING = "control_already_pending";
export declare const TASK_ERR_ALREADY_COMPLETED = "task_already_completed";
export declare const TASK_ERR_INPUT_SCHEMA_MISMATCH = "input_schema_mismatch";
export declare const TASK_ERR_RESULT_SCHEMA_MISMATCH = "result_schema_mismatch";
export declare const TASK_ERR_IDEMPOTENCY_CONFLICT = "idempotency_conflict";
export declare const TASK_ERR_SCHEMA_NOT_FOUND = "task_schema_not_found";
export declare const TASK_MGR_ERROR_CODES: readonly ["task_not_found", "permission_denied", "revision_conflict", "stale_runner_epoch", "invalid_task_phase", "control_not_available", "control_already_pending", "task_already_completed", "input_schema_mismatch", "result_schema_mismatch", "idempotency_conflict", "task_schema_not_found"];
export type TaskMgrErrorCode = typeof TASK_MGR_ERROR_CODES[number];
export declare function taskMgrTaskEventPath(taskId: TaskId): string;
export declare function taskMgrTreeEventPath(rootId: TaskId): string;
export declare function taskMgrErrorCode(error: unknown): TaskMgrErrorCode | null;
export interface ActorRef {
    user_id: string;
    app_id: string;
    app_instance_id?: string;
}
export interface TaskOriginRef {
    kind: string;
    id: string;
}
export declare enum TaskExecutorKind {
    Unbound = "Unbound",
    App = "App",
    HumanSet = "HumanSet"
}
export type TaskExecutor = {
    kind: 'Unbound';
} | {
    kind: 'App';
    target_id?: string;
    app_id: string;
    app_instance_id?: string;
} | {
    kind: 'HumanSet';
};
export declare enum TaskPhase {
    Promised = "Promised",
    Accepted = "Accepted",
    Running = "Running",
    Waiting = "Waiting",
    Paused = "Paused",
    Terminal = "Terminal"
}
export declare function isTerminalTaskPhase(phase: TaskPhase): boolean;
export declare enum TaskWaitReasonKind {
    Dispatch = "Dispatch",
    Capacity = "Capacity",
    Authorization = "Authorization",
    HumanInput = "HumanInput",
    ChildTask = "ChildTask",
    Dependency = "Dependency",
    External = "External",
    Other = "Other"
}
export interface TaskWaitReason {
    kind: TaskWaitReasonKind;
    code?: string;
    related_task_id?: TaskId;
    message?: string;
}
export declare enum TaskOutcome {
    Succeeded = "Succeeded",
    Failed = "Failed",
    Canceled = "Canceled"
}
export interface TaskError {
    code: string;
    message: string;
    detail?: unknown;
}
export declare enum TaskControlAction {
    Pause = "Pause",
    Resume = "Resume",
    Cancel = "Cancel"
}
export interface TaskControlRequest {
    request_id: string;
    action: TaskControlAction;
    requested_by: ActorRef;
    requested_at: number;
}
export type ControlAvailability = {
    kind: 'Available';
} | {
    kind: 'Unavailable';
    reason?: string;
};
export type CancelCapability = {
    kind: 'Unavailable';
    reason?: string;
} | {
    kind: 'Interrupt';
} | {
    kind: 'Safe';
};
export interface TaskControlProfile {
    pause: ControlAvailability;
    resume: ControlAvailability;
    cancel: CancelCapability;
    updated_at: number;
}
export declare function baselineTaskControlProfile(now: number): TaskControlProfile;
export interface ChildControlPolicy {
    follow_pause: boolean;
    follow_resume: boolean;
    follow_cancel: boolean;
}
export declare const DEFAULT_CHILD_CONTROL_POLICY: ChildControlPolicy;
export interface BatchControlResult {
    requested: TaskId[];
    skipped_by_policy: TaskId[];
    denied: TaskId[];
    already_terminal: TaskId[];
}
export declare enum TaskAction {
    ReadMeta = "ReadMeta",
    ReadInput = "ReadInput",
    ReadResult = "ReadResult",
    ReportProgress = "ReportProgress",
    Control = "Control",
    Commit = "Commit",
    CreateChild = "CreateChild",
    Reassign = "Reassign",
    Grant = "Grant",
    Archive = "Archive"
}
export type TaskGrantSubject = {
    kind: 'RootCreator';
} | {
    kind: 'Creator';
} | {
    kind: 'Runner';
} | {
    kind: 'Assignees';
} | {
    kind: 'User';
    user_id: string;
} | {
    kind: 'App';
    app_id: string;
} | {
    kind: 'Principal';
    user_id: string;
    app_id: string;
} | {
    kind: 'SystemRole';
    role: string;
};
export declare enum TaskGrantScope {
    SelfOnly = "SelfOnly",
    Subtree = "Subtree",
    WholeTree = "WholeTree"
}
export declare enum TaskDataScope {
    MetaOnly = "MetaOnly",
    Payload = "Payload",
    Full = "Full"
}
export interface TaskAclGrant {
    grant_id: string;
    task_id: TaskId;
    subject: TaskGrantSubject;
    actions: TaskAction[];
    scope: TaskGrantScope;
    data_scope: TaskDataScope;
    created_by: ActorRef;
    created_at: number;
    revoked_at?: number;
}
export interface TaskAclGrantSpec {
    subject: TaskGrantSubject;
    actions: TaskAction[];
    scope: TaskGrantScope;
    data_scope: TaskDataScope;
}
export interface TaskSchemaDefinition {
    schema_id: string;
    schema_version: number;
    input_schema: unknown;
    output_schema: unknown;
    presentation_schema?: unknown;
    allowed_executor_kinds: TaskExecutorKind[];
    user_creatable: boolean;
    publisher_app_id: string;
    enabled: boolean;
    created_at?: number;
}
export interface Task {
    task_id: TaskId;
    name: string;
    parent_id?: TaskId;
    root_id: TaskId;
    child_control_policy: ChildControlPolicy;
    schema_id: string;
    schema_version: number;
    input: unknown;
    input_digest: string;
    creator: ActorRef;
    idempotency_key: string;
    origin_ref?: TaskOriginRef;
    retry_of?: TaskId;
    supersedes?: TaskId;
    executor: TaskExecutor;
    runner_epoch: number;
    assignees?: string[];
    phase: TaskPhase;
    wait_reason?: TaskWaitReason;
    pending_control?: TaskControlRequest;
    control_profile: TaskControlProfile;
    progress?: unknown;
    message?: string;
    outcome?: TaskOutcome;
    result?: unknown;
    error?: TaskError;
    completed_by?: ActorRef;
    policy_preset: string;
    permission_boundary: boolean;
    revision: number;
    data_scope?: TaskDataScope;
    created_at: number;
    updated_at: number;
    completed_at?: number;
    archived_at?: number;
}
export interface TaskSummary {
    task_id: TaskId;
    name: string;
    parent_id?: TaskId;
    root_id: TaskId;
    schema_id: string;
    schema_version: number;
    creator: ActorRef;
    executor_kind: TaskExecutorKind;
    phase: TaskPhase;
    wait_reason?: TaskWaitReason;
    pending_control_action?: TaskControlAction;
    outcome?: TaskOutcome;
    message?: string;
    revision: number;
    created_at: number;
    updated_at: number;
    completed_at?: number;
    archived_at?: number;
}
export declare enum TaskEventType {
    TaskCreated = "TaskCreated",
    RunnerBound = "RunnerBound",
    RunnerReleased = "RunnerReleased",
    PhaseChanged = "PhaseChanged",
    WaitReasonChanged = "WaitReasonChanged",
    ProgressReported = "ProgressReported",
    ControlProfileChanged = "ControlProfileChanged",
    ControlRequested = "ControlRequested",
    ControlSuperseded = "ControlSuperseded",
    ControlApplied = "ControlApplied",
    ControlRejected = "ControlRejected",
    AssigneesChanged = "AssigneesChanged",
    AccessGranted = "AccessGranted",
    AccessRevoked = "AccessRevoked",
    ResultCommitted = "ResultCommitted",
    TaskFailed = "TaskFailed",
    TaskCanceled = "TaskCanceled",
    TaskArchived = "TaskArchived",
    PayloadRedacted = "PayloadRedacted"
}
export interface TaskEvent {
    event_id: string;
    task_id: TaskId;
    root_id: TaskId;
    task_revision: number;
    event_type: TaskEventType;
    actor?: ActorRef;
    payload: unknown;
    created_at: number;
}
export interface TaskNote {
    id: TaskNoteId;
    task_id: TaskId;
    note_type: string;
    content: string;
    data: unknown;
    author_user_id: string;
    author_app_id: string;
    created_at: number;
    updated_at: number;
}
export type CreateTaskExecutor = {
    kind: 'SelfApp';
    app_instance_id?: string;
} | {
    kind: 'HumanSet';
    assignees: string[];
};
export interface CreateTaskReq {
    name: string;
    schema_id: string;
    schema_version?: number;
    input: unknown;
    executor: CreateTaskExecutor;
    parent_id?: TaskId;
    child_control_policy?: ChildControlPolicy;
    policy_preset?: string;
    permission_boundary?: boolean;
    idempotency_key: string;
    retry_of?: TaskId;
    supersedes?: TaskId;
    message?: string;
}
export interface GetTaskReq {
    task_id: TaskId;
}
export interface ListTasksReq {
    creator_user_id?: string;
    creator_app_id?: string;
    schema_id?: string;
    phase?: TaskPhase;
    root_id?: TaskId;
    executor_kind?: TaskExecutorKind;
    created_after?: number;
    created_before?: number;
    include_archived?: boolean;
    cursor?: string;
    limit?: number;
}
export interface TaskSummaryPage {
    tasks: TaskSummary[];
    next_cursor?: string;
}
export interface GetTaskTreeReq {
    root_id: TaskId;
    depth?: number;
    cursor?: string;
    limit?: number;
}
export interface GetSubtasksReq {
    task_id: TaskId;
    cursor?: string;
    limit?: number;
}
export interface ArchiveTaskReq {
    task_id: TaskId;
    expected_revision: number;
}
export interface RequestControlReq {
    task_id: TaskId;
    action: TaskControlAction;
    request_id: string;
    recursive?: boolean;
    expected_revision?: number;
}
export type RequestControlResult = {
    kind: 'Task';
    task: Task;
} | {
    kind: 'Batch';
    result: BatchControlResult;
};
export interface UpdateAssigneesReq {
    task_id: TaskId;
    add?: string[];
    remove?: string[];
    expected_revision: number;
}
export interface GrantTaskAccessReq {
    task_id: TaskId;
    grant: TaskAclGrantSpec;
    expected_revision: number;
}
export interface RevokeTaskAccessReq {
    task_id: TaskId;
    grant_id: string;
    expected_revision: number;
}
export interface ListTaskAccessReq {
    task_id: TaskId;
}
export interface ListTaskAccessResult {
    grants: TaskAclGrant[];
}
export interface RunnerWriteEnvelope {
    task_id: TaskId;
    app_instance_id?: string;
    runner_epoch: number;
    expected_revision: number;
}
export type ReportStartedReq = RunnerWriteEnvelope;
export interface ReportProgressReq extends RunnerWriteEnvelope {
    progress?: unknown;
    message?: string;
}
export interface ReportWaitingReq extends RunnerWriteEnvelope {
    reason: TaskWaitReason;
}
export type ReportRunningReq = RunnerWriteEnvelope;
export interface UpdateControlProfileReq extends RunnerWriteEnvelope {
    profile: TaskControlProfile;
}
export interface AckControlReq extends RunnerWriteEnvelope {
    request_id: string;
    applied: boolean;
    reject_reason?: string;
}
export interface CommitResultReq {
    task_id: TaskId;
    result: unknown;
    app_instance_id?: string;
    runner_epoch?: number;
    expected_revision: number;
}
export interface FailTaskReq extends RunnerWriteEnvelope {
    error: TaskError;
}
export interface CreatePromisedTaskReq {
    name: string;
    schema_id: string;
    schema_version?: number;
    input: unknown;
    creator: ActorRef;
    expected_input_digest?: string;
    origin_ref?: TaskOriginRef;
    parent_id?: TaskId;
    child_control_policy?: ChildControlPolicy;
    policy_preset?: string;
    permission_boundary?: boolean;
    idempotency_key: string;
    wait_reason?: TaskWaitReason;
    message?: string;
}
export interface SetPromiseWaitReq {
    task_id: TaskId;
    wait_reason: TaskWaitReason;
    expected_revision: number;
}
export interface BindAppExecutorReq {
    task_id: TaskId;
    target_id?: string;
    app_id: string;
    app_instance_id: string;
    delivery_id?: string;
    expected_revision: number;
}
export interface ReleaseAppExecutorReq {
    task_id: TaskId;
    expected_instance_id: string;
    expected_runner_epoch: number;
    reason: TaskWaitReason;
    expected_revision: number;
}
export interface FinishPromiseFailureReq {
    task_id: TaskId;
    error: TaskError;
    expected_revision: number;
}
export interface CancelPromisedTaskReq {
    task_id: TaskId;
    expected_revision: number;
}
export interface RegisterTaskSchemaReq {
    definition: TaskSchemaDefinition;
}
export interface GetTaskSchemaReq {
    schema_id: string;
    schema_version?: number;
}
export interface ListTaskSchemasReq {
    user_creatable_only?: boolean;
    include_disabled?: boolean;
}
export interface ListTaskSchemasResult {
    schemas: TaskSchemaDefinition[];
}
export interface SetTaskSchemaEnabledReq {
    schema_id: string;
    schema_version: number;
    enabled: boolean;
}
export interface ListTaskEventsReq {
    task_id?: TaskId;
    root_id?: TaskId;
    after_event_id?: string;
    limit?: number;
}
export interface ListTaskEventsResult {
    events: TaskEvent[];
    next_cursor?: string;
}
export interface AddTaskNoteReq {
    task_id: TaskId;
    note_type?: string;
    content: string;
    data?: unknown;
}
export interface ListTaskNotesReq {
    task_id: TaskId;
}
export interface TaskResult {
    task: Task;
}
export interface AddTaskNoteResult {
    note_id: TaskNoteId;
    note: TaskNote;
}
export interface ListTaskNotesResult {
    notes: TaskNote[];
}
export declare class TaskManagerClient {
    private rpcClient;
    constructor(rpcClient: kRPCClient);
    setSeq(seq: number): void;
    private callTask;
    createTask(request: CreateTaskReq): Promise<Task>;
    getTask(taskId: TaskId): Promise<Task>;
    listTasks(request?: ListTasksReq): Promise<TaskSummaryPage>;
    getTaskTree(request: GetTaskTreeReq): Promise<TaskSummaryPage>;
    getSubtasks(request: GetSubtasksReq): Promise<TaskSummaryPage>;
    archiveTask(request: ArchiveTaskReq): Promise<Task>;
    requestControl(request: RequestControlReq): Promise<RequestControlResult>;
    updateAssignees(request: UpdateAssigneesReq): Promise<Task>;
    grantTaskAccess(request: GrantTaskAccessReq): Promise<Task>;
    revokeTaskAccess(request: RevokeTaskAccessReq): Promise<Task>;
    listTaskAccess(taskId: TaskId): Promise<TaskAclGrant[]>;
    reportStarted(request: ReportStartedReq): Promise<Task>;
    reportProgress(request: ReportProgressReq): Promise<Task>;
    reportWaiting(request: ReportWaitingReq): Promise<Task>;
    reportRunning(request: ReportRunningReq): Promise<Task>;
    updateControlProfile(request: UpdateControlProfileReq): Promise<Task>;
    ackControl(request: AckControlReq): Promise<Task>;
    commitResult(request: CommitResultReq): Promise<Task>;
    failTask(request: FailTaskReq): Promise<Task>;
    createPromisedTask(request: CreatePromisedTaskReq): Promise<Task>;
    setPromiseWait(request: SetPromiseWaitReq): Promise<Task>;
    bindAppExecutor(request: BindAppExecutorReq): Promise<Task>;
    releaseAppExecutor(request: ReleaseAppExecutorReq): Promise<Task>;
    finishPromiseFailure(request: FinishPromiseFailureReq): Promise<Task>;
    cancelPromisedTask(request: CancelPromisedTaskReq): Promise<Task>;
    registerTaskSchema(definition: TaskSchemaDefinition): Promise<TaskSchemaDefinition>;
    getTaskSchema(schemaId: string, schemaVersion?: number): Promise<TaskSchemaDefinition>;
    listTaskSchemas(request?: ListTaskSchemasReq): Promise<TaskSchemaDefinition[]>;
    setTaskSchemaEnabled(schemaId: string, schemaVersion: number, enabled: boolean): Promise<TaskSchemaDefinition>;
    listTaskEvents(request: ListTaskEventsReq): Promise<ListTaskEventsResult>;
    addTaskNote(request: AddTaskNoteReq): Promise<TaskNote>;
    listTaskNotes(taskId: TaskId): Promise<TaskNote[]>;
    cancelTask(taskId: TaskId, recursive?: boolean): Promise<RequestControlResult>;
    private snapshotEnvelope;
    runnerStart(taskId: TaskId): Promise<Task>;
    runnerProgress(taskId: TaskId, progress?: unknown, message?: string): Promise<Task>;
    runnerWait(taskId: TaskId, reason: TaskWaitReason): Promise<Task>;
    runnerComplete(taskId: TaskId, result: unknown): Promise<Task>;
    runnerFail(taskId: TaskId, code: string, message: string, detail?: unknown): Promise<Task>;
}
//# sourceMappingURL=task_mgr_client.d.ts.map