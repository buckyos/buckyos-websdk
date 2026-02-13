import { kRPCClient, RPCError } from './krpc_client'

export const TASK_MANAGER_SERVICE_NAME = 'task-manager'

export enum TaskStatus {
  Pending = 'Pending',
  Running = 'Running',
  Paused = 'Paused',
  Completed = 'Completed',
  Failed = 'Failed',
  Canceled = 'Canceled',
  WaitingForApproval = 'WaitingForApproval',
}

export enum TaskScope {
  Private = 'Private',
  User = 'User',
  System = 'System',
}

export interface TaskPermissions {
  read: TaskScope
  write: TaskScope
}

export const DEFAULT_TASK_PERMISSIONS: TaskPermissions = {
  read: TaskScope.User,
  write: TaskScope.Private,
}

export interface Task {
  id: number
  user_id: string
  app_id: string
  parent_id: number | null
  root_id: number | null
  name: string
  task_type: string
  status: TaskStatus
  progress: number
  message: string | null
  data: unknown
  permissions: TaskPermissions
  created_at: number
  updated_at: number
}

export interface CreateTaskOptions {
  permissions?: TaskPermissions
  parent_id?: number
  priority?: number
}

export interface TaskFilter {
  app_id?: string
  task_type?: string
  status?: TaskStatus
  parent_id?: number
  root_id?: number
}

export interface TaskUpdatePayload {
  id: number
  status?: TaskStatus
  progress?: number
  message?: string
  data?: unknown
}

export interface CreateTaskParams {
  name: string
  taskType: string
  data?: unknown
  userId: string
  appId: string
  options?: CreateTaskOptions
}

export interface ListTasksParams {
  filter?: TaskFilter
  sourceUserId?: string
  sourceAppId?: string
}

export interface ListTasksByTimeRangeParams {
  appId?: string
  taskType?: string
  sourceUserId?: string
  sourceAppId?: string
  startTime: number
  endTime: number
}

export interface PauseResumeOptions {
  sourceUserId?: string
  sourceAppId?: string
}

interface CreateTaskResult {
  task_id: number
  task: Task
}

interface GetTaskResult {
  task: Task
}

interface ListTasksResult {
  tasks: Task[]
}

interface TaskManagerCreateTaskReq {
  name: string
  task_type: string
  data?: unknown
  permissions?: TaskPermissions
  parent_id?: number
  priority?: number
  user_id: string
  app_id: string
  app_name?: string
}

interface TaskManagerGetTaskReq {
  id: number
}

interface TaskManagerListTasksReq {
  app_id?: string
  task_type?: string
  status?: TaskStatus
  parent_id?: number
  root_id?: number
  source_user_id?: string
  source_app_id?: string
}

interface TaskManagerListTasksByTimeRangeReq {
  app_id?: string
  task_type?: string
  source_user_id?: string
  source_app_id?: string
  start_time: number
  end_time: number
}

interface TaskManagerUpdateTaskReq {
  id: number
  status?: TaskStatus
  progress?: number
  message?: string
  data?: unknown
}

interface TaskManagerCancelTaskReq {
  id: number
  recursive: boolean
}

interface TaskManagerGetSubtasksReq {
  parent_id: number
}

interface TaskManagerUpdateTaskStatusReq {
  id: number
  status: TaskStatus
}

interface TaskManagerUpdateTaskProgressReq {
  id: number
  completed_items: number
  total_items: number
}

interface TaskManagerUpdateTaskErrorReq {
  id: number
  error_message: string
}

interface TaskManagerUpdateTaskDataReq {
  id: number
  data: unknown
}

interface TaskManagerDeleteTaskReq {
  id: number
}

export function parseTaskStatus(status: string): TaskStatus {
  switch (status) {
    case TaskStatus.Pending:
      return TaskStatus.Pending
    case TaskStatus.Running:
      return TaskStatus.Running
    case TaskStatus.Paused:
      return TaskStatus.Paused
    case TaskStatus.Completed:
      return TaskStatus.Completed
    case TaskStatus.Failed:
      return TaskStatus.Failed
    case TaskStatus.Canceled:
      return TaskStatus.Canceled
    case TaskStatus.WaitingForApproval:
      return TaskStatus.WaitingForApproval
    default:
      throw new RPCError(`Invalid task status: ${status}`)
  }
}

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return status === TaskStatus.Completed || status === TaskStatus.Failed || status === TaskStatus.Canceled
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RPCError('Invalid RPC response format')
  }
  return value as Record<string, unknown>
}

function parseTask(value: unknown): Task {
  const record = asRecord(value)
  const id = record.id
  const status = record.status

  if (typeof id !== 'number') {
    throw new RPCError('Invalid task payload: missing id')
  }

  if (typeof status !== 'string') {
    throw new RPCError('Invalid task payload: missing status')
  }

  return {
    ...(record as Omit<Task, 'status'>),
    status: parseTaskStatus(status),
  } as Task
}

function parseTasks(value: unknown): Task[] {
  if (!Array.isArray(value)) {
    throw new RPCError('Invalid tasks payload: expected array')
  }
  return value.map((task) => parseTask(task))
}

export class TaskManagerClient {
  private rpcClient: kRPCClient

  constructor(rpcClient: kRPCClient) {
    this.rpcClient = rpcClient
  }

  setSeq(seq: number) {
    this.rpcClient.setSeq(seq)
  }

  async createTask(params: CreateTaskParams): Promise<Task> {
    const options = params.options ?? {}
    const req: TaskManagerCreateTaskReq = {
      name: params.name,
      task_type: params.taskType,
      data: params.data,
      permissions: options.permissions,
      parent_id: options.parent_id,
      priority: options.priority,
      user_id: params.userId,
      app_id: params.appId,
      app_name: params.appId || undefined,
    }

    const result = await this.rpcClient.call<unknown, TaskManagerCreateTaskReq>('create_task', req)
    const parsed = asRecord(result)

    if ('task' in parsed) {
      return parseTask(parsed.task)
    }

    const taskId = parsed.task_id
    if (typeof taskId === 'number') {
      return this.getTask(taskId)
    }

    throw new RPCError('Expected CreateTaskResult response')
  }

  async getTask(id: number): Promise<Task> {
    const req: TaskManagerGetTaskReq = { id }
    const result = await this.rpcClient.call<unknown, TaskManagerGetTaskReq>('get_task', req)

    const parsed = asRecord(result)
    if ('task' in parsed) {
      return parseTask(parsed.task)
    }

    return parseTask(result)
  }

  async waitForTaskEnd(id: number): Promise<TaskStatus> {
    return this.waitForTaskEndWithInterval(id, 500)
  }

  async waitForTaskEndWithInterval(id: number, pollIntervalMs: number): Promise<TaskStatus> {
    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
      throw new RPCError('pollIntervalMs must be greater than 0')
    }

    while (true) {
      const task = await this.getTask(id)
      if (isTerminalTaskStatus(task.status)) {
        return task.status
      }

      await sleep(pollIntervalMs)
    }
  }

  async listTasks(params: ListTasksParams = {}): Promise<Task[]> {
    const filter = params.filter ?? {}
    const req: TaskManagerListTasksReq = {
      app_id: filter.app_id,
      task_type: filter.task_type,
      status: filter.status,
      parent_id: filter.parent_id,
      root_id: filter.root_id,
      source_user_id: params.sourceUserId,
      source_app_id: params.sourceAppId,
    }

    const result = await this.rpcClient.call<unknown, TaskManagerListTasksReq>('list_tasks', req)
    const parsed = asRecord(result)

    if ('tasks' in parsed) {
      return parseTasks(parsed.tasks)
    }

    throw new RPCError('Expected tasks in response')
  }

  async listTasksByTimeRange(params: ListTasksByTimeRangeParams): Promise<Task[]> {
    const req: TaskManagerListTasksByTimeRangeReq = {
      app_id: params.appId,
      task_type: params.taskType,
      source_user_id: params.sourceUserId,
      source_app_id: params.sourceAppId,
      start_time: params.startTime,
      end_time: params.endTime,
    }

    const result = await this.rpcClient.call<unknown, TaskManagerListTasksByTimeRangeReq>('list_tasks_by_time_range', req)
    const parsed = asRecord(result)

    if ('tasks' in parsed) {
      return parseTasks(parsed.tasks)
    }

    throw new RPCError('Expected tasks in response')
  }

  async updateTask(payload: TaskUpdatePayload): Promise<void> {
    const req: TaskManagerUpdateTaskReq = {
      id: payload.id,
      status: payload.status,
      progress: payload.progress,
      message: payload.message,
      data: payload.data,
    }

    await this.rpcClient.call<unknown, TaskManagerUpdateTaskReq>('update_task', req)
  }

  async cancelTask(id: number, recursive: boolean = false): Promise<void> {
    const req: TaskManagerCancelTaskReq = { id, recursive }
    await this.rpcClient.call<unknown, TaskManagerCancelTaskReq>('cancel_task', req)
  }

  async getSubtasks(parentId: number): Promise<Task[]> {
    const req: TaskManagerGetSubtasksReq = { parent_id: parentId }
    const result = await this.rpcClient.call<unknown, TaskManagerGetSubtasksReq>('get_subtasks', req)
    const parsed = asRecord(result)

    if ('tasks' in parsed) {
      return parseTasks(parsed.tasks)
    }

    throw new RPCError('Expected tasks in response')
  }

  async updateTaskStatus(id: number, status: TaskStatus): Promise<void> {
    const req: TaskManagerUpdateTaskStatusReq = { id, status }
    await this.rpcClient.call<unknown, TaskManagerUpdateTaskStatusReq>('update_task_status', req)
  }

  async updateTaskProgress(id: number, completedItems: number, totalItems: number): Promise<void> {
    const req: TaskManagerUpdateTaskProgressReq = {
      id,
      completed_items: completedItems,
      total_items: totalItems,
    }
    await this.rpcClient.call<unknown, TaskManagerUpdateTaskProgressReq>('update_task_progress', req)
  }

  async updateTaskError(id: number, errorMessage: string): Promise<void> {
    const req: TaskManagerUpdateTaskErrorReq = { id, error_message: errorMessage }
    await this.rpcClient.call<unknown, TaskManagerUpdateTaskErrorReq>('update_task_error', req)
  }

  async updateTaskData(id: number, data: unknown): Promise<void> {
    const req: TaskManagerUpdateTaskDataReq = { id, data }
    await this.rpcClient.call<unknown, TaskManagerUpdateTaskDataReq>('update_task_data', req)
  }

  async deleteTask(id: number): Promise<void> {
    const req: TaskManagerDeleteTaskReq = { id }
    await this.rpcClient.call<unknown, TaskManagerDeleteTaskReq>('delete_task', req)
  }

  async pauseTask(id: number): Promise<void> {
    await this.updateTaskStatus(id, TaskStatus.Paused)
  }

  async resumeTask(id: number): Promise<void> {
    await this.updateTaskStatus(id, TaskStatus.Running)
  }

  async completeTask(id: number): Promise<void> {
    await this.updateTaskStatus(id, TaskStatus.Completed)
  }

  async markTaskAsWaitingForApproval(id: number): Promise<void> {
    await this.updateTaskStatus(id, TaskStatus.WaitingForApproval)
  }

  async markTaskAsFailed(id: number, errorMessage: string): Promise<void> {
    await this.updateTaskError(id, errorMessage)
    await this.updateTaskStatus(id, TaskStatus.Failed)
  }

  async pauseAllRunningTasks(options: PauseResumeOptions = {}): Promise<void> {
    const runningTasks = await this.listTasks({
      filter: { status: TaskStatus.Running },
      sourceUserId: options.sourceUserId,
      sourceAppId: options.sourceAppId,
    })

    for (const task of runningTasks) {
      await this.pauseTask(task.id)
    }
  }

  async resumeLastPausedTask(options: PauseResumeOptions = {}): Promise<void> {
    const pausedTasks = await this.listTasks({
      filter: { status: TaskStatus.Paused },
      sourceUserId: options.sourceUserId,
      sourceAppId: options.sourceAppId,
    })

    const lastPausedTask = pausedTasks[pausedTasks.length - 1]
    if (!lastPausedTask) {
      throw new RPCError('No paused tasks found')
    }

    await this.resumeTask(lastPausedTask.id)
  }
}

export type { CreateTaskResult, GetTaskResult, ListTasksResult }
