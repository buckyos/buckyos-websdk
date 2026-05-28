import { kRPCClient, RPCError } from './krpc_client'

export const WORKFLOW_SERVICE_NAME = 'workflow'

export interface WorkflowOwner {
  user_id: string
  app_id: string
}

export enum WorkflowStepType {
  Autonomous = 'autonomous',
  HumanConfirm = 'human_confirm',
  HumanRequired = 'human_required',
}

export enum WorkflowOutputMode {
  Single = 'single',
  FiniteSeekable = 'finite_seekable',
  FiniteSequential = 'finite_sequential',
}

export enum WorkflowJoinMode {
  All = 'all',
  Any = 'any',
  NOfM = 'n_of_m',
}

export enum WorkflowRetryFallback {
  Human = 'human',
  Abort = 'abort',
}

export interface WorkflowBudgetGuard {
  max_tokens?: number
  max_cost_usdb?: number
  max_duration?: string
}

export interface WorkflowRetryGuard {
  max_attempts?: number
  backoff?: string
  fallback?: WorkflowRetryFallback
}

export interface WorkflowGuardConfig {
  budget?: WorkflowBudgetGuard
  permissions?: string[]
  retry?: WorkflowRetryGuard
  timeout?: string
  amendment_auto_approve?: boolean
  max_cost_usdb?: number
  max_duration?: string
}

export interface WorkflowStepDefinition {
  id: string
  name: string
  executor?: string
  type: WorkflowStepType
  input?: unknown
  input_schema?: unknown
  output_schema: unknown
  subject_ref?: string
  prompt?: string
  idempotent?: boolean
  skippable?: boolean
  output_mode?: WorkflowOutputMode
  guards?: WorkflowGuardConfig
}

export interface WorkflowBranchNodeDefinition {
  type: 'branch'
  id: string
  on: string
  paths: Record<string, string>
  max_iterations: number
}

export interface WorkflowParallelNodeDefinition {
  type: 'parallel'
  id: string
  branches: string[]
  join: WorkflowJoinMode
  n?: number
}

export interface WorkflowForEachNodeDefinition {
  type: 'for_each'
  id: string
  items: string
  steps: string[]
  max_items: number
  concurrency?: number
}

export type WorkflowControlNodeDefinition =
  | WorkflowBranchNodeDefinition
  | WorkflowParallelNodeDefinition
  | WorkflowForEachNodeDefinition

export interface WorkflowEdgeDefinition {
  from: string
  to?: string | null
}

export interface WorkflowDefinition {
  schema_version: string
  id: string
  name: string
  description?: string | null
  trigger: unknown
  steps: WorkflowStepDefinition[]
  nodes?: WorkflowControlNodeDefinition[]
  edges: WorkflowEdgeDefinition[]
  guards?: WorkflowGuardConfig | null
  defs?: Record<string, unknown>
}

export enum WorkflowDefinitionStatus {
  Draft = 'draft',
  Active = 'active',
  Archived = 'archived',
}

export enum WorkflowRunStatus {
  Created = 'created',
  Running = 'running',
  WaitingHuman = 'waiting_human',
  Completed = 'completed',
  Failed = 'failed',
  Paused = 'paused',
  Aborted = 'aborted',
  BudgetExhausted = 'budget_exhausted',
}

export enum WorkflowNodeRunState {
  Pending = 'pending',
  Ready = 'ready',
  Running = 'running',
  Completed = 'completed',
  Failed = 'failed',
  Retrying = 'retrying',
  WaitingHuman = 'waiting_human',
  Skipped = 'skipped',
  Aborted = 'aborted',
  Cancelled = 'cancelled',
}

export enum WorkflowHumanActionKind {
  Approve = 'approve',
  Modify = 'modify',
  Reject = 'reject',
  Retry = 'retry',
  Skip = 'skip',
  Abort = 'abort',
  Rollback = 'rollback',
}

export interface WorkflowEventEnvelope {
  event_id: string
  type: string
  ts: string
  run_id: string
  plan_version: number
  seq: number
  actor: string
  node_id?: string | null
  attempt?: number | null
  payload?: unknown
}

export interface WorkflowHumanAction {
  node_id: string
  action: WorkflowHumanActionKind
  payload?: unknown
  actor?: string
}

export interface WorkflowSubmitDefinitionReq {
  owner: WorkflowOwner
  definition: WorkflowDefinition
  tags?: string[]
}

export interface WorkflowSubmitDefinitionResult {
  workflow_id: string
  version: number
  analysis: unknown
  definition: unknown
}

export interface WorkflowListDefinitionsReq {
  owner?: WorkflowOwner
  status?: WorkflowDefinitionStatus
  tag?: string
}

export interface WorkflowCreateRunReq {
  workflow_id: string
  owner: WorkflowOwner
  input?: unknown
  callback_url?: string
  auto_start?: boolean
}

export interface WorkflowRunTransitionResult {
  run_id: string
  status: WorkflowRunStatus
  events: WorkflowEventEnvelope[]
  seq?: number
  from_seq?: number
  to_seq?: number
}

export interface WorkflowRunGraph {
  run_id: string
  workflow_id: string
  status: WorkflowRunStatus
  graph: unknown
  nodes: unknown
  node_states: Record<string, WorkflowNodeRunState>
  node_outputs: Record<string, unknown>
  human_waiting_nodes: string[]
  pending_thunks: Record<string, unknown>
  metrics: Record<string, unknown>
  seq: number
}

export interface WorkflowListRunsReq {
  owner?: WorkflowOwner
  workflow_id?: string
  status?: WorkflowRunStatus | string
}

export interface WorkflowRunSummary {
  run_id: string
  workflow_id: string
  workflow_name: string
  status: WorkflowRunStatus
  owner: WorkflowOwner
  created_at: number
  updated_at: number
  seq: number
  progress: number
}

export interface WorkflowSubmitStepOutputReq {
  run_id: string
  node_id: string
  output?: unknown
  actor?: string
}

export interface WorkflowReportStepProgressReq {
  run_id: string
  node_id: string
  progress?: unknown
  actor?: string
}

export interface WorkflowRequestHumanReq {
  run_id: string
  node_id: string
  prompt?: string
  subject?: unknown
  actor?: string
}

export interface WorkflowSubmitAmendmentReq {
  run_id: string
  patch?: unknown
  actor?: string
}

export interface WorkflowDecideAmendmentReq {
  run_id: string
  amendment_id: string
  actor?: string
  reason?: string
}

export interface WorkflowHistoryReq {
  run_id: string
  since_seq?: number
  limit?: number
}

export interface WorkflowHistoryResult {
  run_id: string
  events: WorkflowEventEnvelope[]
  next_seq: number
  current_seq: number
}

export interface WorkflowSubscribeEventsResult {
  channel: string
  transport: string
  history: WorkflowHistoryResult
}

export enum WorkflowScheduledTaskStatus {
  Enabled = 'enabled',
  Paused = 'paused',
  Archived = 'archived',
  Error = 'error',
}

export type WorkflowScheduledTaskSchedule =
  | {
    kind: 'cron'
    expr: string
    timezone: string
    calendar?: string | null
    start_at?: number | null
    end_at?: number | null
  }
  | {
    kind: 'once'
    run_at: number
    timezone?: string | null
  }
  | {
    kind: 'run_every'
    every_sec: number
    start_at?: number | null
    end_at?: number | null
    timezone?: string | null
  }

export interface WorkflowScheduledTaskTarget {
  task_type: string
  runner?: string
  name_template: string
  data_template?: unknown
}

export enum WorkflowScheduledTaskMisfirePolicy {
  Skip = 'skip',
  RunOnce = 'run_once',
  CatchUp = 'catch_up',
  Manual = 'manual',
}

export interface WorkflowScheduledTaskPolicy {
  misfire: WorkflowScheduledTaskMisfirePolicy
  max_parallel_runs: number
  catch_up_limit: number
  jitter_sec: number
}

export interface WorkflowScheduledTaskState {
  next_fire_at?: number | null
  last_fire_at?: number | null
  last_task_id?: number | null
  last_run_id?: string | null
  consecutive_failures?: number
  last_error?: string | null
}

export interface WorkflowScheduledTaskMirror {
  root_task_id?: number | null
  root_id?: string | null
}

export interface WorkflowScheduledTask {
  schedule_id: string
  owner: WorkflowOwner
  name: string
  description?: string | null
  status: WorkflowScheduledTaskStatus
  schedule: WorkflowScheduledTaskSchedule
  target: WorkflowScheduledTaskTarget
  state: WorkflowScheduledTaskState
  policy: WorkflowScheduledTaskPolicy
  task_mirror?: WorkflowScheduledTaskMirror
  created_at: number
  updated_at: number
}

export enum WorkflowScheduledTaskFireStatus {
  Created = 'created',
  TaskCreated = 'task_created',
  Skipped = 'skipped',
  Failed = 'failed',
}

export interface WorkflowScheduledTaskFireRecord {
  fire_id: string
  schedule_id: string
  fire_key: string
  fire_time: number
  manual: boolean
  status: WorkflowScheduledTaskFireStatus
  task_id?: number | null
  run_id?: string | null
  error?: string | null
  created_at: number
  updated_at: number
}

export interface WorkflowCreateScheduledTaskReq {
  owner: WorkflowOwner
  name: string
  description?: string
  schedule: WorkflowScheduledTaskSchedule
  target: WorkflowScheduledTaskTarget
  policy?: WorkflowScheduledTaskPolicy
  status?: WorkflowScheduledTaskStatus
}

export interface WorkflowUpdateScheduledTaskReq {
  schedule_id: string
  name?: string
  description?: string | null
  schedule?: WorkflowScheduledTaskSchedule
  target?: WorkflowScheduledTaskTarget
  policy?: WorkflowScheduledTaskPolicy
}

export interface WorkflowListScheduledTasksReq {
  owner?: WorkflowOwner
  status?: WorkflowScheduledTaskStatus
  workflow_id?: string
  name?: string
}

export interface WorkflowRunScheduledTaskNowReq {
  schedule_id: string
  fire_time?: number
}

export interface WorkflowGetScheduledTaskHistoryReq {
  schedule_id: string
  limit?: number
}

export interface WorkflowValidateScheduledTaskReq {
  schedule: WorkflowScheduledTaskSchedule
  target?: WorkflowScheduledTaskTarget
}

export interface WorkflowValidateScheduledTaskResult {
  valid: boolean
  normalized_expr?: string | null
  timezone: string
  next_fire_times: string[]
  warnings: string[]
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RPCError('Invalid workflow RPC response format')
  }
  return value as Record<string, unknown>
}

function requiredField<T>(record: Record<string, unknown>, field: string): T {
  if (!(field in record)) {
    throw new RPCError(`Expected ${field} in workflow response`)
  }
  return record[field] as T
}

export class WorkflowClient {
  private rpcClient: kRPCClient

  constructor(rpcClient: kRPCClient) {
    this.rpcClient = rpcClient
  }

  setSeq(seq: number) {
    this.rpcClient.setSeq(seq)
  }

  private async callOk<TParams>(method: string, params: TParams): Promise<Record<string, unknown>> {
    const result = await this.rpcClient.call<unknown, TParams>(method, params)
    const parsed = asRecord(result)
    if (parsed.ok === true) {
      return parsed
    }

    const message = typeof parsed.message === 'string'
      ? parsed.message
      : typeof parsed.error === 'string'
        ? parsed.error
        : 'workflow request failed'
    throw new RPCError(message)
  }

  async submitDefinition(request: WorkflowSubmitDefinitionReq): Promise<WorkflowSubmitDefinitionResult> {
    const result = await this.callOk('submit_definition', request)
    return {
      workflow_id: requiredField<string>(result, 'workflow_id'),
      version: requiredField<number>(result, 'version'),
      analysis: requiredField<unknown>(result, 'analysis'),
      definition: requiredField<unknown>(result, 'definition'),
    }
  }

  async getDefinition(workflowId: string): Promise<unknown> {
    const result = await this.callOk('get_definition', { workflow_id: workflowId })
    return requiredField<unknown>(result, 'definition')
  }

  async listDefinitions(request: WorkflowListDefinitionsReq = {}): Promise<unknown[]> {
    const result = await this.callOk('list_definitions', request)
    return requiredField<unknown[]>(result, 'definitions')
  }

  async archiveDefinition(workflowId: string): Promise<WorkflowDefinitionStatus> {
    const result = await this.callOk('archive_definition', { workflow_id: workflowId })
    return requiredField<WorkflowDefinitionStatus>(result, 'status')
  }

  async dryRun(definition: WorkflowDefinition): Promise<{ analysis: unknown, graph: unknown }> {
    const result = await this.callOk('dry_run', { definition })
    return {
      analysis: requiredField<unknown>(result, 'analysis'),
      graph: requiredField<unknown>(result, 'graph'),
    }
  }

  async createRun(request: WorkflowCreateRunReq): Promise<WorkflowRunTransitionResult> {
    return await this.callOk('create_run', request) as unknown as WorkflowRunTransitionResult
  }

  async startRun(runId: string): Promise<WorkflowRunTransitionResult> {
    return await this.callOk('start_run', { run_id: runId }) as unknown as WorkflowRunTransitionResult
  }

  async tickRun(runId: string): Promise<WorkflowRunTransitionResult> {
    return await this.callOk('tick_run', { run_id: runId }) as unknown as WorkflowRunTransitionResult
  }

  async getRunGraph(runId: string): Promise<WorkflowRunGraph> {
    return await this.callOk('get_run_graph', { run_id: runId }) as unknown as WorkflowRunGraph
  }

  async listRuns(request: WorkflowListRunsReq = {}): Promise<WorkflowRunSummary[]> {
    const result = await this.callOk('list_runs', request)
    return requiredField<WorkflowRunSummary[]>(result, 'runs')
  }

  async submitStepOutput(request: WorkflowSubmitStepOutputReq): Promise<WorkflowRunTransitionResult> {
    return await this.callOk('submit_step_output', request) as unknown as WorkflowRunTransitionResult
  }

  async reportStepProgress(request: WorkflowReportStepProgressReq): Promise<WorkflowRunTransitionResult> {
    return await this.callOk('report_step_progress', request) as unknown as WorkflowRunTransitionResult
  }

  async requestHuman(request: WorkflowRequestHumanReq): Promise<WorkflowRunTransitionResult> {
    return await this.callOk('request_human', request) as unknown as WorkflowRunTransitionResult
  }

  async submitAmendment(request: WorkflowSubmitAmendmentReq): Promise<unknown> {
    const result = await this.callOk('submit_amendment', request)
    return requiredField<unknown>(result, 'amendment')
  }

  async approveAmendment(request: WorkflowDecideAmendmentReq): Promise<{ amendment: unknown, plan_version: number }> {
    const result = await this.callOk('approve_amendment', request)
    return {
      amendment: requiredField<unknown>(result, 'amendment'),
      plan_version: requiredField<number>(result, 'plan_version'),
    }
  }

  async rejectAmendment(request: WorkflowDecideAmendmentReq): Promise<{ amendment: unknown, plan_version: number }> {
    const result = await this.callOk('reject_amendment', request)
    return {
      amendment: requiredField<unknown>(result, 'amendment'),
      plan_version: requiredField<number>(result, 'plan_version'),
    }
  }

  async getHistory(request: WorkflowHistoryReq): Promise<WorkflowHistoryResult> {
    return await this.callOk('get_history', request) as unknown as WorkflowHistoryResult
  }

  async subscribeEvents(request: WorkflowHistoryReq): Promise<WorkflowSubscribeEventsResult> {
    return await this.callOk('subscribe_events', request) as unknown as WorkflowSubscribeEventsResult
  }

  async createScheduledTask(request: WorkflowCreateScheduledTaskReq): Promise<WorkflowScheduledTask> {
    const result = await this.callOk('create_scheduled_task', request)
    return requiredField<WorkflowScheduledTask>(result, 'schedule')
  }

  async updateScheduledTask(request: WorkflowUpdateScheduledTaskReq): Promise<WorkflowScheduledTask> {
    const result = await this.callOk('update_scheduled_task', request)
    return requiredField<WorkflowScheduledTask>(result, 'schedule')
  }

  async getScheduledTask(scheduleId: string): Promise<WorkflowScheduledTask> {
    const result = await this.callOk('get_scheduled_task', { schedule_id: scheduleId })
    return requiredField<WorkflowScheduledTask>(result, 'schedule')
  }

  async listScheduledTasks(request: WorkflowListScheduledTasksReq = {}): Promise<WorkflowScheduledTask[]> {
    const result = await this.callOk('list_scheduled_tasks', request)
    return requiredField<WorkflowScheduledTask[]>(result, 'schedules')
  }

  async pauseScheduledTask(scheduleId: string): Promise<WorkflowScheduledTask> {
    const result = await this.callOk('pause_scheduled_task', { schedule_id: scheduleId })
    return requiredField<WorkflowScheduledTask>(result, 'schedule')
  }

  async resumeScheduledTask(scheduleId: string): Promise<WorkflowScheduledTask> {
    const result = await this.callOk('resume_scheduled_task', { schedule_id: scheduleId })
    return requiredField<WorkflowScheduledTask>(result, 'schedule')
  }

  async archiveScheduledTask(scheduleId: string): Promise<WorkflowScheduledTask> {
    const result = await this.callOk('archive_scheduled_task', { schedule_id: scheduleId })
    return requiredField<WorkflowScheduledTask>(result, 'schedule')
  }

  async runScheduledTaskNow(request: WorkflowRunScheduledTaskNowReq): Promise<WorkflowScheduledTaskFireRecord> {
    const result = await this.callOk('run_scheduled_task_now', request)
    return requiredField<WorkflowScheduledTaskFireRecord>(result, 'fire')
  }

  async getScheduledTaskHistory(request: WorkflowGetScheduledTaskHistoryReq): Promise<WorkflowScheduledTaskFireRecord[]> {
    const result = await this.callOk('get_scheduled_task_history', request)
    return requiredField<WorkflowScheduledTaskFireRecord[]>(result, 'fires')
  }

  async validateScheduledTask(request: WorkflowValidateScheduledTaskReq): Promise<WorkflowValidateScheduledTaskResult> {
    return await this.callOk('validate_scheduled_task', request) as unknown as WorkflowValidateScheduledTaskResult
  }
}
