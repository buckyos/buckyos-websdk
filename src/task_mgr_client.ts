import { kRPCClient, RPCError } from './krpc_client'

// TaskMgr 2.0 client. The public DTOs mirror
// buckyos-api/src/task_mgr.rs and therefore use the Rust wire field names.

export const TASK_MANAGER_SERVICE_UNIQUE_ID = 'task-manager'
export const TASK_MANAGER_SERVICE_NAME = 'task-manager'
export const TASK_MANAGER_SERVICE_PORT = 3380

export type TaskId = string
export type TaskNoteId = number

export const TASK_POLICY_PRESET_COLLABORATIVE_TREE_V1 = 'collaborative-tree/v1'

export const RAW_TASK_SCHEMA_ID = 'raw/v1'
export const HUMAN_APPROVAL_SCHEMA_ID = 'human.approval/v1'
export const DOWNLOAD_TASK_SCHEMA_ID = 'download/v1'
export const SCHEDULER_DISPATCH_THUNK_TASK_SCHEMA_ID = 'scheduler.dispatch_thunk/v1'
export const WORKFLOW_RUN_TREE_TASK_SCHEMA_ID = 'workflow.run_tree/v1'
export const WORKFLOW_STEP_TASK_SCHEMA_ID = 'workflow.step/v1'
export const WORKFLOW_MAP_SHARD_TASK_SCHEMA_ID = 'workflow.map_shard/v1'
export const WORKFLOW_THUNK_TASK_SCHEMA_ID = 'workflow.thunk/v1'
export const WORKFLOW_SCHEDULE_TASK_SCHEMA_ID = 'workflow.schedule/v1'
export const WORKFLOW_SEND_MESSAGE_TASK_SCHEMA_ID = 'workflow.send_message/v1'
export const WORKFLOW_EXECUTE_RPC_TASK_SCHEMA_ID = 'workflow.execute_rpc/v1'
export const WORKFLOW_RUN_TARGET_TASK_SCHEMA_ID = 'workflow.run/v1'
export const AGENT_DELEGATE_TASK_SCHEMA_ID = 'agent.delegate/v1'
export const HUMAN_INPUT_TASK_SCHEMA_ID = 'human.input/v1'
export const OPENDAN_ASYNC_TOOL_TASK_SCHEMA_ID = 'opendan.async_tool/v1'
export const OPENDAN_COMMAND_TASK_SCHEMA_ID = 'opendan.command/v1'
export const TOOL_EXEC_BASH_TASK_SCHEMA_ID = 'tool.exec_bash/v1'
export const AICC_COMPUTE_TASK_SCHEMA_ID = 'aicc.compute/v1'
export const APP_INSTALL_TASK_SCHEMA_ID = 'app.install/v1'
export const APP_UNINSTALL_TASK_SCHEMA_ID = 'app.uninstall/v1'
export const APP_START_TASK_SCHEMA_ID = 'app.start/v1'
export const APP_UPDATE_TASK_SCHEMA_ID = 'app.update/v1'
export const APP_UPDATE_BATCH_TASK_SCHEMA_ID = 'app.update_batch/v1'

export const TASK_ERR_NOT_FOUND = 'task_not_found'
export const TASK_ERR_PERMISSION_DENIED = 'permission_denied'
export const TASK_ERR_REVISION_CONFLICT = 'revision_conflict'
export const TASK_ERR_STALE_RUNNER_EPOCH = 'stale_runner_epoch'
export const TASK_ERR_INVALID_PHASE = 'invalid_task_phase'
export const TASK_ERR_CONTROL_NOT_AVAILABLE = 'control_not_available'
export const TASK_ERR_CONTROL_ALREADY_PENDING = 'control_already_pending'
export const TASK_ERR_ALREADY_COMPLETED = 'task_already_completed'
export const TASK_ERR_INPUT_SCHEMA_MISMATCH = 'input_schema_mismatch'
export const TASK_ERR_RESULT_SCHEMA_MISMATCH = 'result_schema_mismatch'
export const TASK_ERR_IDEMPOTENCY_CONFLICT = 'idempotency_conflict'
export const TASK_ERR_SCHEMA_NOT_FOUND = 'task_schema_not_found'

export const TASK_MGR_ERROR_CODES = [
  TASK_ERR_NOT_FOUND,
  TASK_ERR_PERMISSION_DENIED,
  TASK_ERR_REVISION_CONFLICT,
  TASK_ERR_STALE_RUNNER_EPOCH,
  TASK_ERR_INVALID_PHASE,
  TASK_ERR_CONTROL_NOT_AVAILABLE,
  TASK_ERR_CONTROL_ALREADY_PENDING,
  TASK_ERR_ALREADY_COMPLETED,
  TASK_ERR_INPUT_SCHEMA_MISMATCH,
  TASK_ERR_RESULT_SCHEMA_MISMATCH,
  TASK_ERR_IDEMPOTENCY_CONFLICT,
  TASK_ERR_SCHEMA_NOT_FOUND,
] as const

export type TaskMgrErrorCode = typeof TASK_MGR_ERROR_CODES[number]

export function taskMgrTaskEventPath(taskId: TaskId): string {
  return `/task_mgr/${taskId}`
}

export function taskMgrTreeEventPath(rootId: TaskId): string {
  return `/task_mgr/tree/${rootId}`
}

export function taskMgrErrorCode(error: unknown): TaskMgrErrorCode | null {
  const message = error instanceof Error ? error.message : String(error)
  for (const code of TASK_MGR_ERROR_CODES) {
    const index = message.indexOf(code)
    if (index < 0) {
      continue
    }
    const before = index === 0 ? '' : message[index - 1]
    const after = message[index + code.length] ?? ''
    if ((!before || /[\s:]/.test(before)) && (!after || /[\s:]/.test(after))) {
      return code
    }
  }
  return null
}

export interface ActorRef {
  user_id: string
  app_id: string
  app_instance_id?: string
}

export interface TaskOriginRef {
  kind: string
  id: string
}

export enum TaskExecutorKind {
  Unbound = 'Unbound',
  App = 'App',
  HumanSet = 'HumanSet',
}

export type TaskExecutor =
  | { kind: 'Unbound' }
  | { kind: 'App'; target_id?: string; app_id: string; app_instance_id?: string }
  | { kind: 'HumanSet' }

export enum TaskPhase {
  Promised = 'Promised',
  Accepted = 'Accepted',
  Running = 'Running',
  Waiting = 'Waiting',
  Paused = 'Paused',
  Terminal = 'Terminal',
}

export function isTerminalTaskPhase(phase: TaskPhase): boolean {
  return phase === TaskPhase.Terminal
}

export enum TaskWaitReasonKind {
  Dispatch = 'Dispatch',
  Capacity = 'Capacity',
  Authorization = 'Authorization',
  HumanInput = 'HumanInput',
  ChildTask = 'ChildTask',
  Dependency = 'Dependency',
  External = 'External',
  Other = 'Other',
}

export interface TaskWaitReason {
  kind: TaskWaitReasonKind
  code?: string
  related_task_id?: TaskId
  message?: string
}

export enum TaskOutcome {
  Succeeded = 'Succeeded',
  Failed = 'Failed',
  Canceled = 'Canceled',
}

export interface TaskError {
  code: string
  message: string
  detail?: unknown
}

export enum TaskControlAction {
  Pause = 'Pause',
  Resume = 'Resume',
  Cancel = 'Cancel',
}

export interface TaskControlRequest {
  request_id: string
  action: TaskControlAction
  requested_by: ActorRef
  requested_at: number
}

export type ControlAvailability =
  | { kind: 'Available' }
  | { kind: 'Unavailable'; reason?: string }

export type CancelCapability =
  | { kind: 'Unavailable'; reason?: string }
  | { kind: 'Interrupt' }
  | { kind: 'Safe' }

export interface TaskControlProfile {
  pause: ControlAvailability
  resume: ControlAvailability
  cancel: CancelCapability
  updated_at: number
}

export function baselineTaskControlProfile(now: number): TaskControlProfile {
  return {
    pause: { kind: 'Unavailable' },
    resume: { kind: 'Unavailable' },
    cancel: { kind: 'Interrupt' },
    updated_at: now,
  }
}

export interface ChildControlPolicy {
  follow_pause: boolean
  follow_resume: boolean
  follow_cancel: boolean
}

export const DEFAULT_CHILD_CONTROL_POLICY: ChildControlPolicy = {
  follow_pause: true,
  follow_resume: true,
  follow_cancel: true,
}

export interface BatchControlResult {
  requested: TaskId[]
  skipped_by_policy: TaskId[]
  denied: TaskId[]
  already_terminal: TaskId[]
}

export enum TaskAction {
  ReadMeta = 'ReadMeta',
  ReadInput = 'ReadInput',
  ReadResult = 'ReadResult',
  ReportProgress = 'ReportProgress',
  Control = 'Control',
  Commit = 'Commit',
  CreateChild = 'CreateChild',
  Reassign = 'Reassign',
  Grant = 'Grant',
  Archive = 'Archive',
}

export type TaskGrantSubject =
  | { kind: 'RootCreator' }
  | { kind: 'Creator' }
  | { kind: 'Runner' }
  | { kind: 'Assignees' }
  | { kind: 'User'; user_id: string }
  | { kind: 'App'; app_id: string }
  | { kind: 'Principal'; user_id: string; app_id: string }
  | { kind: 'SystemRole'; role: string }

export enum TaskGrantScope {
  SelfOnly = 'SelfOnly',
  Subtree = 'Subtree',
  WholeTree = 'WholeTree',
}

export enum TaskDataScope {
  MetaOnly = 'MetaOnly',
  Payload = 'Payload',
  Full = 'Full',
}

export interface TaskAclGrant {
  grant_id: string
  task_id: TaskId
  subject: TaskGrantSubject
  actions: TaskAction[]
  scope: TaskGrantScope
  data_scope: TaskDataScope
  created_by: ActorRef
  created_at: number
  revoked_at?: number
}

export interface TaskAclGrantSpec {
  subject: TaskGrantSubject
  actions: TaskAction[]
  scope: TaskGrantScope
  data_scope: TaskDataScope
}

export interface TaskSchemaDefinition {
  schema_id: string
  schema_version: number
  input_schema: unknown
  output_schema: unknown
  presentation_schema?: unknown
  allowed_executor_kinds: TaskExecutorKind[]
  user_creatable: boolean
  publisher_app_id: string
  enabled: boolean
  created_at?: number
}

export interface Task {
  task_id: TaskId
  name: string
  parent_id?: TaskId
  root_id: TaskId
  child_control_policy: ChildControlPolicy
  schema_id: string
  schema_version: number
  input: unknown
  input_digest: string
  creator: ActorRef
  idempotency_key: string
  origin_ref?: TaskOriginRef
  retry_of?: TaskId
  supersedes?: TaskId
  executor: TaskExecutor
  runner_epoch: number
  assignees?: string[]
  phase: TaskPhase
  wait_reason?: TaskWaitReason
  pending_control?: TaskControlRequest
  control_profile: TaskControlProfile
  progress?: unknown
  message?: string
  outcome?: TaskOutcome
  result?: unknown
  error?: TaskError
  completed_by?: ActorRef
  policy_preset: string
  permission_boundary: boolean
  revision: number
  data_scope?: TaskDataScope
  created_at: number
  updated_at: number
  completed_at?: number
  archived_at?: number
}

export interface TaskSummary {
  task_id: TaskId
  name: string
  parent_id?: TaskId
  root_id: TaskId
  schema_id: string
  schema_version: number
  creator: ActorRef
  executor_kind: TaskExecutorKind
  phase: TaskPhase
  wait_reason?: TaskWaitReason
  pending_control_action?: TaskControlAction
  outcome?: TaskOutcome
  message?: string
  revision: number
  created_at: number
  updated_at: number
  completed_at?: number
  archived_at?: number
}

export enum TaskEventType {
  TaskCreated = 'TaskCreated',
  RunnerBound = 'RunnerBound',
  RunnerReleased = 'RunnerReleased',
  PhaseChanged = 'PhaseChanged',
  WaitReasonChanged = 'WaitReasonChanged',
  ProgressReported = 'ProgressReported',
  ControlProfileChanged = 'ControlProfileChanged',
  ControlRequested = 'ControlRequested',
  ControlSuperseded = 'ControlSuperseded',
  ControlApplied = 'ControlApplied',
  ControlRejected = 'ControlRejected',
  AssigneesChanged = 'AssigneesChanged',
  AccessGranted = 'AccessGranted',
  AccessRevoked = 'AccessRevoked',
  ResultCommitted = 'ResultCommitted',
  TaskFailed = 'TaskFailed',
  TaskCanceled = 'TaskCanceled',
  TaskArchived = 'TaskArchived',
  PayloadRedacted = 'PayloadRedacted',
}

export interface TaskEvent {
  event_id: string
  task_id: TaskId
  root_id: TaskId
  task_revision: number
  event_type: TaskEventType
  actor?: ActorRef
  payload: unknown
  created_at: number
}

export interface TaskNote {
  id: TaskNoteId
  task_id: TaskId
  note_type: string
  content: string
  data: unknown
  author_user_id: string
  author_app_id: string
  created_at: number
  updated_at: number
}

export type CreateTaskExecutor =
  | { kind: 'SelfApp'; app_instance_id?: string }
  | { kind: 'HumanSet'; assignees: string[] }

export interface CreateTaskReq {
  name: string
  schema_id: string
  schema_version?: number
  input: unknown
  executor: CreateTaskExecutor
  parent_id?: TaskId
  child_control_policy?: ChildControlPolicy
  policy_preset?: string
  permission_boundary?: boolean
  idempotency_key: string
  retry_of?: TaskId
  supersedes?: TaskId
  message?: string
}

export interface GetTaskReq {
  task_id: TaskId
}

export interface ListTasksReq {
  creator_user_id?: string
  creator_app_id?: string
  idempotency_key?: string
  schema_id?: string
  phase?: TaskPhase
  root_id?: TaskId
  executor_kind?: TaskExecutorKind
  runner_app_id?: string
  runner_target_id?: string
  created_after?: number
  created_before?: number
  include_archived?: boolean
  cursor?: string
  limit?: number
}

export interface TaskSummaryPage {
  tasks: TaskSummary[]
  next_cursor?: string
}

export interface GetTaskTreeReq {
  root_id: TaskId
  depth?: number
  cursor?: string
  limit?: number
}

export interface GetSubtasksReq {
  task_id: TaskId
  cursor?: string
  limit?: number
}

export interface ArchiveTaskReq {
  task_id: TaskId
  expected_revision: number
}

export interface RequestControlReq {
  task_id: TaskId
  action: TaskControlAction
  request_id: string
  recursive?: boolean
  expected_revision?: number
}

export type RequestControlResult =
  | { kind: 'Task'; task: Task }
  | { kind: 'Batch'; result: BatchControlResult }

export interface UpdateAssigneesReq {
  task_id: TaskId
  add?: string[]
  remove?: string[]
  expected_revision: number
}

export interface GrantTaskAccessReq {
  task_id: TaskId
  grant: TaskAclGrantSpec
  expected_revision: number
}

export interface RevokeTaskAccessReq {
  task_id: TaskId
  grant_id: string
  expected_revision: number
}

export interface ListTaskAccessReq {
  task_id: TaskId
}

export interface ListTaskAccessResult {
  grants: TaskAclGrant[]
}

export interface RunnerWriteEnvelope {
  task_id: TaskId
  app_instance_id?: string
  runner_epoch: number
  expected_revision: number
}

export type ReportStartedReq = RunnerWriteEnvelope

export interface ReportProgressReq extends RunnerWriteEnvelope {
  progress?: unknown
  message?: string
}

export interface ReportWaitingReq extends RunnerWriteEnvelope {
  reason: TaskWaitReason
}

export type ReportRunningReq = RunnerWriteEnvelope

export interface UpdateControlProfileReq extends RunnerWriteEnvelope {
  profile: TaskControlProfile
}

export interface AckControlReq extends RunnerWriteEnvelope {
  request_id: string
  applied: boolean
  reject_reason?: string
}

export interface CommitResultReq {
  task_id: TaskId
  result: unknown
  app_instance_id?: string
  runner_epoch?: number
  expected_revision: number
}

export interface FailTaskReq extends RunnerWriteEnvelope {
  error: TaskError
}

export interface CreatePromisedTaskReq {
  name: string
  schema_id: string
  schema_version?: number
  input: unknown
  creator: ActorRef
  expected_input_digest?: string
  origin_ref?: TaskOriginRef
  parent_id?: TaskId
  child_control_policy?: ChildControlPolicy
  policy_preset?: string
  permission_boundary?: boolean
  idempotency_key: string
  wait_reason?: TaskWaitReason
  message?: string
}

export interface SetPromiseWaitReq {
  task_id: TaskId
  wait_reason: TaskWaitReason
  expected_revision: number
}

export interface BindAppExecutorReq {
  task_id: TaskId
  target_id?: string
  app_id: string
  app_instance_id: string
  delivery_id?: string
  expected_revision: number
}

export interface ReleaseAppExecutorReq {
  task_id: TaskId
  expected_instance_id: string
  expected_runner_epoch: number
  reason: TaskWaitReason
  expected_revision: number
}

export interface FinishPromiseFailureReq {
  task_id: TaskId
  error: TaskError
  expected_revision: number
}

export interface CancelPromisedTaskReq {
  task_id: TaskId
  expected_revision: number
}

export interface RegisterTaskSchemaReq {
  definition: TaskSchemaDefinition
}

export interface GetTaskSchemaReq {
  schema_id: string
  schema_version?: number
}

export interface ListTaskSchemasReq {
  user_creatable_only?: boolean
  include_disabled?: boolean
}

export interface ListTaskSchemasResult {
  schemas: TaskSchemaDefinition[]
}

export interface SetTaskSchemaEnabledReq {
  schema_id: string
  schema_version: number
  enabled: boolean
}

export interface ListTaskEventsReq {
  task_id?: TaskId
  root_id?: TaskId
  after_event_id?: string
  limit?: number
}

export interface ListTaskEventsResult {
  events: TaskEvent[]
  next_cursor?: string
}

export interface AddTaskNoteReq {
  task_id: TaskId
  note_type?: string
  content: string
  data?: unknown
}

export interface ListTaskNotesReq {
  task_id: TaskId
}

export interface TaskResult {
  task: Task
}

export interface AddTaskNoteResult {
  note_id: TaskNoteId
  note: TaskNote
}

export interface ListTaskNotesResult {
  notes: TaskNote[]
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RPCError(`Expected ${what} in TaskMgr response`)
  }
  return value as Record<string, unknown>
}

function requiredField<T>(value: unknown, field: string, what: string): T {
  const record = asRecord(value, what)
  if (!(field in record)) {
    throw new RPCError(`Expected ${field} in TaskMgr response`)
  }
  return record[field] as T
}

function parseTaskResult(value: unknown): Task {
  const task = requiredField<Task>(value, 'task', 'task result')
  if (!task || typeof task !== 'object' || typeof task.task_id !== 'string') {
    throw new RPCError('Expected a string task_id in TaskMgr response')
  }
  return task
}

function randomControlRequestId(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    const bytes = new Uint8Array(16)
    cryptoApi.getRandomValues(bytes)
    return `ctl-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
  }
  return `ctl-${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`
}

export class TaskManagerClient {
  private rpcClient: kRPCClient

  constructor(rpcClient: kRPCClient) {
    this.rpcClient = rpcClient
  }

  setSeq(seq: number) {
    this.rpcClient.setSeq(seq)
  }

  private async callTask<TRequest>(method: string, request: TRequest): Promise<Task> {
    const result = await this.rpcClient.call<unknown, TRequest>(method, request)
    return parseTaskResult(result)
  }

  async createTask(request: CreateTaskReq): Promise<Task> {
    return this.callTask('create_task', request)
  }

  async getTask(taskId: TaskId): Promise<Task> {
    const result = await this.rpcClient.call<unknown, { task_id: TaskId }>('get_task', { task_id: taskId })
    return parseTaskResult(result)
  }

  async listTasks(request: ListTasksReq = {}): Promise<TaskSummaryPage> {
    const result = await this.rpcClient.call<unknown, ListTasksReq>('list_tasks', request)
    const tasks = requiredField<TaskSummary[]>(result, 'tasks', 'task summary page')
    if (!Array.isArray(tasks)) {
      throw new RPCError('Expected tasks array in TaskMgr response')
    }
    return result as TaskSummaryPage
  }

  async getTaskTree(request: GetTaskTreeReq): Promise<TaskSummaryPage> {
    const result = await this.rpcClient.call<unknown, GetTaskTreeReq>('get_task_tree', request)
    const tasks = requiredField<TaskSummary[]>(result, 'tasks', 'task tree page')
    if (!Array.isArray(tasks)) {
      throw new RPCError('Expected tasks array in TaskMgr response')
    }
    return result as TaskSummaryPage
  }

  async getSubtasks(request: GetSubtasksReq): Promise<TaskSummaryPage> {
    const result = await this.rpcClient.call<unknown, GetSubtasksReq>('get_subtasks', request)
    const tasks = requiredField<TaskSummary[]>(result, 'tasks', 'subtask page')
    if (!Array.isArray(tasks)) {
      throw new RPCError('Expected tasks array in TaskMgr response')
    }
    return result as TaskSummaryPage
  }

  async archiveTask(request: ArchiveTaskReq): Promise<Task> {
    return this.callTask('archive_task', request)
  }

  async requestControl(request: RequestControlReq): Promise<RequestControlResult> {
    const result = await this.rpcClient.call<unknown, RequestControlReq>('request_control', request)
    const kind = requiredField<string>(result, 'kind', 'control result')
    if (kind !== 'Task' && kind !== 'Batch') {
      throw new RPCError(`Invalid TaskMgr control result kind: ${kind}`)
    }
    return result as RequestControlResult
  }

  async updateAssignees(request: UpdateAssigneesReq): Promise<Task> {
    return this.callTask('update_assignees', request)
  }

  async grantTaskAccess(request: GrantTaskAccessReq): Promise<Task> {
    return this.callTask('grant_task_access', request)
  }

  async revokeTaskAccess(request: RevokeTaskAccessReq): Promise<Task> {
    return this.callTask('revoke_task_access', request)
  }

  async listTaskAccess(taskId: TaskId): Promise<TaskAclGrant[]> {
    const result = await this.rpcClient.call<unknown, { task_id: TaskId }>('list_task_access', { task_id: taskId })
    const grants = requiredField<TaskAclGrant[]>(result, 'grants', 'task access result')
    if (!Array.isArray(grants)) {
      throw new RPCError('Expected grants array in TaskMgr response')
    }
    return grants
  }

  async reportStarted(request: ReportStartedReq): Promise<Task> {
    return this.callTask('report_started', request)
  }

  async reportProgress(request: ReportProgressReq): Promise<Task> {
    return this.callTask('report_progress', request)
  }

  async reportWaiting(request: ReportWaitingReq): Promise<Task> {
    return this.callTask('report_waiting', request)
  }

  async reportRunning(request: ReportRunningReq): Promise<Task> {
    return this.callTask('report_running', request)
  }

  async updateControlProfile(request: UpdateControlProfileReq): Promise<Task> {
    return this.callTask('update_control_profile', request)
  }

  async ackControl(request: AckControlReq): Promise<Task> {
    return this.callTask('ack_control', request)
  }

  async commitResult(request: CommitResultReq): Promise<Task> {
    return this.callTask('commit_result', request)
  }

  async failTask(request: FailTaskReq): Promise<Task> {
    return this.callTask('fail_task', request)
  }

  async createPromisedTask(request: CreatePromisedTaskReq): Promise<Task> {
    return this.callTask('create_promised_task', request)
  }

  async setPromiseWait(request: SetPromiseWaitReq): Promise<Task> {
    return this.callTask('set_promise_wait', request)
  }

  async bindAppExecutor(request: BindAppExecutorReq): Promise<Task> {
    return this.callTask('bind_app_executor', request)
  }

  async releaseAppExecutor(request: ReleaseAppExecutorReq): Promise<Task> {
    return this.callTask('release_app_executor', request)
  }

  async finishPromiseFailure(request: FinishPromiseFailureReq): Promise<Task> {
    return this.callTask('finish_promise_failure', request)
  }

  async cancelPromisedTask(request: CancelPromisedTaskReq): Promise<Task> {
    return this.callTask('cancel_promised_task', request)
  }

  async registerTaskSchema(definition: TaskSchemaDefinition): Promise<TaskSchemaDefinition> {
    return this.rpcClient.call<TaskSchemaDefinition, { definition: TaskSchemaDefinition }>(
      'register_task_schema',
      { definition },
    )
  }

  async getTaskSchema(schemaId: string, schemaVersion?: number): Promise<TaskSchemaDefinition> {
    return this.rpcClient.call<TaskSchemaDefinition, { schema_id: string; schema_version?: number }>(
      'get_task_schema',
      { schema_id: schemaId, schema_version: schemaVersion },
    )
  }

  async listTaskSchemas(request: ListTaskSchemasReq = {}): Promise<TaskSchemaDefinition[]> {
    const result = await this.rpcClient.call<unknown, ListTaskSchemasReq>('list_task_schemas', request)
    const schemas = requiredField<TaskSchemaDefinition[]>(result, 'schemas', 'task schema list')
    if (!Array.isArray(schemas)) {
      throw new RPCError('Expected schemas array in TaskMgr response')
    }
    return schemas
  }

  async setTaskSchemaEnabled(
    schemaId: string,
    schemaVersion: number,
    enabled: boolean,
  ): Promise<TaskSchemaDefinition> {
    return this.rpcClient.call<
      TaskSchemaDefinition,
      { schema_id: string; schema_version: number; enabled: boolean }
    >('set_task_schema_enabled', {
      schema_id: schemaId,
      schema_version: schemaVersion,
      enabled,
    })
  }

  async listTaskEvents(request: ListTaskEventsReq): Promise<ListTaskEventsResult> {
    const result = await this.rpcClient.call<unknown, ListTaskEventsReq>('list_task_events', request)
    const events = requiredField<TaskEvent[]>(result, 'events', 'task event list')
    if (!Array.isArray(events)) {
      throw new RPCError('Expected events array in TaskMgr response')
    }
    return result as ListTaskEventsResult
  }

  async addTaskNote(request: AddTaskNoteReq): Promise<TaskNote> {
    const result = await this.rpcClient.call<unknown, AddTaskNoteReq>('add_task_note', request)
    return requiredField<TaskNote>(result, 'note', 'add task note result')
  }

  async listTaskNotes(taskId: TaskId): Promise<TaskNote[]> {
    const result = await this.rpcClient.call<unknown, { task_id: TaskId }>('list_task_notes', {
      task_id: taskId,
    })
    const notes = requiredField<TaskNote[]>(result, 'notes', 'task note list')
    if (!Array.isArray(notes)) {
      throw new RPCError('Expected notes array in TaskMgr response')
    }
    return notes
  }

  async cancelTask(taskId: TaskId, recursive: boolean = false): Promise<RequestControlResult> {
    return this.requestControl({
      task_id: taskId,
      action: TaskControlAction.Cancel,
      request_id: randomControlRequestId(),
      recursive,
    })
  }

  private snapshotEnvelope(task: Task): RunnerWriteEnvelope {
    return {
      task_id: task.task_id,
      app_instance_id: task.executor.kind === 'App' ? task.executor.app_instance_id : undefined,
      runner_epoch: task.runner_epoch,
      expected_revision: task.revision,
    }
  }

  async runnerStart(taskId: TaskId): Promise<Task> {
    const task = await this.getTask(taskId)
    let attempt: Promise<Task>
    if (task.phase === TaskPhase.Accepted) {
      attempt = this.reportStarted(this.snapshotEnvelope(task))
    } else if (task.phase === TaskPhase.Waiting) {
      attempt = this.reportRunning(this.snapshotEnvelope(task))
    } else {
      return task
    }

    try {
      return await attempt
    } catch (error) {
      const code = taskMgrErrorCode(error)
      if (code === TASK_ERR_REVISION_CONFLICT || code === TASK_ERR_INVALID_PHASE) {
        return this.getTask(taskId)
      }
      throw error
    }
  }

  async runnerProgress(taskId: TaskId, progress?: unknown, message?: string): Promise<Task> {
    const task = await this.getTask(taskId)
    if (isTerminalTaskPhase(task.phase)) {
      return task
    }

    try {
      return await this.reportProgress({
        ...this.snapshotEnvelope(task),
        progress,
        message,
      })
    } catch (error) {
      if (taskMgrErrorCode(error) !== TASK_ERR_REVISION_CONFLICT) {
        throw error
      }
      const fresh = await this.getTask(taskId)
      return this.reportProgress({
        ...this.snapshotEnvelope(fresh),
        progress,
        message,
      })
    }
  }

  async runnerWait(taskId: TaskId, reason: TaskWaitReason): Promise<Task> {
    const task = await this.runnerStart(taskId)
    if (task.phase !== TaskPhase.Running) {
      return task
    }
    return this.reportWaiting({
      ...this.snapshotEnvelope(task),
      reason,
    })
  }

  async runnerComplete(taskId: TaskId, result: unknown): Promise<Task> {
    const task = await this.getTask(taskId)
    if (isTerminalTaskPhase(task.phase)) {
      return task
    }

    try {
      return await this.commitResult({
        task_id: task.task_id,
        result,
        app_instance_id: this.snapshotEnvelope(task).app_instance_id,
        runner_epoch: task.runner_epoch,
        expected_revision: task.revision,
      })
    } catch (error) {
      if (taskMgrErrorCode(error) !== TASK_ERR_REVISION_CONFLICT) {
        throw error
      }
      const fresh = await this.getTask(taskId)
      if (isTerminalTaskPhase(fresh.phase)) {
        return fresh
      }
      return this.commitResult({
        task_id: fresh.task_id,
        result,
        app_instance_id: this.snapshotEnvelope(fresh).app_instance_id,
        runner_epoch: fresh.runner_epoch,
        expected_revision: fresh.revision,
      })
    }
  }

  async runnerFail(taskId: TaskId, code: string, message: string, detail?: unknown): Promise<Task> {
    const task = await this.getTask(taskId)
    if (isTerminalTaskPhase(task.phase)) {
      return task
    }
    return this.failTask({
      ...this.snapshotEnvelope(task),
      error: { code, message, detail },
    })
  }
}
