import { kRPCClient } from './krpc_client';
export declare const TASK_MANAGER_SERVICE_NAME = "task-manager";
export declare enum TaskStatus {
    Pending = "Pending",
    Running = "Running",
    Paused = "Paused",
    Completed = "Completed",
    Failed = "Failed",
    Canceled = "Canceled",
    WaitingForApproval = "WaitingForApproval"
}
export declare enum TaskScope {
    Private = "Private",
    User = "User",
    System = "System"
}
export interface TaskPermissions {
    read: TaskScope;
    write: TaskScope;
}
export declare const DEFAULT_TASK_PERMISSIONS: TaskPermissions;
export interface Task {
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
export interface CreateTaskOptions {
    permissions?: TaskPermissions;
    parent_id?: number;
    priority?: number;
}
export interface TaskFilter {
    app_id?: string;
    task_type?: string;
    status?: TaskStatus;
    parent_id?: number;
    root_id?: number;
}
export interface TaskUpdatePayload {
    id: number;
    status?: TaskStatus;
    progress?: number;
    message?: string;
    data?: unknown;
}
export interface CreateTaskParams {
    name: string;
    taskType: string;
    data?: unknown;
    userId: string;
    appId: string;
    options?: CreateTaskOptions;
}
export interface ListTasksParams {
    filter?: TaskFilter;
    sourceUserId?: string;
    sourceAppId?: string;
}
export interface ListTasksByTimeRangeParams {
    appId?: string;
    taskType?: string;
    sourceUserId?: string;
    sourceAppId?: string;
    startTime: number;
    endTime: number;
}
export interface PauseResumeOptions {
    sourceUserId?: string;
    sourceAppId?: string;
}
interface CreateTaskResult {
    task_id: number;
    task: Task;
}
interface GetTaskResult {
    task: Task;
}
interface ListTasksResult {
    tasks: Task[];
}
export declare function parseTaskStatus(status: string): TaskStatus;
export declare function isTerminalTaskStatus(status: TaskStatus): boolean;
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
export type { CreateTaskResult, GetTaskResult, ListTasksResult };
//# sourceMappingURL=task_mgr_client.d.ts.map