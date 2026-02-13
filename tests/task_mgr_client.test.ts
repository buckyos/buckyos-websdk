import { kRPCClient } from '../src/krpc_client'
import { TaskManagerClient, TaskStatus } from '../src/task_mgr_client'

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    user_id: 'did:bns:test-user',
    app_id: 'test-app',
    parent_id: null,
    root_id: null,
    name: 'test task',
    task_type: 'publish',
    status: 'Pending',
    progress: 0,
    message: null,
    data: { ok: true },
    permissions: {
      read: 'User',
      write: 'Private',
    },
    created_at: 1700000000000,
    updated_at: 1700000000000,
    ...overrides,
  }
}

describe('TaskManagerClient', () => {
  it('createTask sends expected payload and parses task', async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          task_id: 11,
          task: makeTask({ id: 11, status: 'Pending' }),
        },
        sys: [9],
      }),
    })

    const rpcClient = new kRPCClient('/kapi/task-manager/', null, 9, fetcher)
    const client = new TaskManagerClient(rpcClient)
    const task = await client.createTask({
      name: 'publish package',
      taskType: 'publish',
      data: { pkg: 'abc' },
      userId: 'did:bns:u1',
      appId: 'pkg-app',
      options: {
        parent_id: 3,
        priority: 5,
      },
    })

    expect(task.id).toBe(11)
    expect(task.status).toBe(TaskStatus.Pending)

    const requestBody = JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)
    expect(requestBody.method).toBe('create_task')
    expect(requestBody.params).toEqual({
      name: 'publish package',
      task_type: 'publish',
      data: { pkg: 'abc' },
      parent_id: 3,
      priority: 5,
      user_id: 'did:bns:u1',
      app_id: 'pkg-app',
      app_name: 'pkg-app',
    })
  })

  it('createTask falls back to getTask when response only has task_id', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            task_id: 22,
          },
          sys: [1],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            task: makeTask({ id: 22, status: 'Running' }),
          },
          sys: [2],
        }),
      })

    const rpcClient = new kRPCClient('/kapi/task-manager/', null, 1, fetcher)
    const client = new TaskManagerClient(rpcClient)
    const task = await client.createTask({
      name: 'sync',
      taskType: 'sync',
      userId: 'did:bns:u2',
      appId: 'sync-app',
    })

    expect(task.id).toBe(22)
    expect(task.status).toBe(TaskStatus.Running)
    expect(fetcher).toHaveBeenCalledTimes(2)

    const firstBody = JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)
    const secondBody = JSON.parse((fetcher.mock.calls[1][1] as RequestInit).body as string)
    expect(firstBody.method).toBe('create_task')
    expect(secondBody.method).toBe('get_task')
    expect(secondBody.params).toEqual({ id: 22 })
  })

  it('listTasks sends filter and source params', async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          tasks: [makeTask({ id: 30, status: 'Paused' })],
        },
        sys: [33],
      }),
    })

    const rpcClient = new kRPCClient('/kapi/task-manager/', null, 33, fetcher)
    const client = new TaskManagerClient(rpcClient)
    const tasks = await client.listTasks({
      filter: {
        app_id: 'test-app',
        status: TaskStatus.Paused,
      },
      sourceUserId: 'did:bns:source-user',
      sourceAppId: 'source-app',
    })

    expect(tasks).toHaveLength(1)
    expect(tasks[0].status).toBe(TaskStatus.Paused)

    const requestBody = JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)
    expect(requestBody.method).toBe('list_tasks')
    expect(requestBody.params).toEqual({
      app_id: 'test-app',
      status: 'Paused',
      source_user_id: 'did:bns:source-user',
      source_app_id: 'source-app',
    })
  })

  it('markTaskAsFailed sends update_task_error then update_task_status', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: null,
          sys: [5],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: null,
          sys: [6],
        }),
      })

    const rpcClient = new kRPCClient('/kapi/task-manager/', null, 5, fetcher)
    const client = new TaskManagerClient(rpcClient)
    await client.markTaskAsFailed(42, 'network failed')

    expect(fetcher).toHaveBeenCalledTimes(2)

    const firstBody = JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)
    const secondBody = JSON.parse((fetcher.mock.calls[1][1] as RequestInit).body as string)
    expect(firstBody).toMatchObject({
      method: 'update_task_error',
      params: { id: 42, error_message: 'network failed' },
    })
    expect(secondBody).toMatchObject({
      method: 'update_task_status',
      params: { id: 42, status: 'Failed' },
    })
  })

  it('resumeLastPausedTask throws when paused task does not exist', async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: { tasks: [] },
        sys: [77],
      }),
    })

    const rpcClient = new kRPCClient('/kapi/task-manager/', null, 77, fetcher)
    const client = new TaskManagerClient(rpcClient)

    await expect(client.resumeLastPausedTask()).rejects.toThrow('No paused tasks found')
  })

  it('waitForTaskEndWithInterval validates poll interval', async () => {
    const fetcher = jest.fn()
    const rpcClient = new kRPCClient('/kapi/task-manager/', null, 1, fetcher)
    const client = new TaskManagerClient(rpcClient)

    await expect(client.waitForTaskEndWithInterval(1, 0)).rejects.toThrow('pollIntervalMs must be greater than 0')
    expect(fetcher).not.toHaveBeenCalled()
  })
})
