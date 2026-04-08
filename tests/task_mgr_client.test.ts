import { kRPCClient } from '../src/krpc_client'
import { TaskManagerClient, TaskStatus } from '../src/task_mgr_client'

function makeResponse(body: unknown, seq: number = 1) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      result: body,
      sys: [seq],
    }),
  }
}

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    user_id: 'did:bns:test-user',
    app_id: 'test-app',
    parent_id: null,
    root_id: '1',
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
  it('createTask sends expected payload including root_id as a string', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      task_id: 11,
      task: makeTask({ id: 11, root_id: '3', status: 'Pending' }),
    }, 9))

    const rpcClient = new kRPCClient('/kapi/task-manager/', null, 9, { fetcher: fetcher })
    const client = new TaskManagerClient(rpcClient)
    const task = await client.createTask({
      name: 'publish package',
      taskType: 'publish',
      data: { pkg: 'abc' },
      userId: 'did:bns:u1',
      appId: 'pkg-app',
      options: {
        parent_id: 3,
        root_id: '3',
        priority: 5,
      },
    })

    expect(task.id).toBe(11)
    expect(task.status).toBe(TaskStatus.Pending)
    expect(JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      method: 'create_task',
      params: {
        name: 'publish package',
        task_type: 'publish',
        data: { pkg: 'abc' },
        parent_id: 3,
        root_id: '3',
        priority: 5,
        user_id: 'did:bns:u1',
        app_id: 'pkg-app',
        app_name: 'pkg-app',
      },
      sys: [9],
    })
  })

  it('createTask falls back to getTask when response only has task_id', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(makeResponse({ task_id: 22 }, 1))
      .mockResolvedValueOnce(makeResponse({ task: makeTask({ id: 22, status: 'Running' }) }, 2))

    const rpcClient = new kRPCClient('/kapi/task-manager/', null, 1, { fetcher: fetcher })
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
  })

  it('createDownloadTask sends Rust-compatible payload', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({ task_id: 31 }, 31))

    const rpcClient = new kRPCClient('/kapi/task-manager/', null, 31, { fetcher: fetcher })
    const client = new TaskManagerClient(rpcClient)
    const taskId = await client.createDownloadTask(
      'https://example.com/pkg.tgz',
      'did:bns:u1',
      'pkg-app',
      { root_id: '10', priority: 2 },
      'obj-1',
      { checksum: 'sha256' },
    )

    expect(taskId).toBe(31)
    expect(JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      method: 'create_download_task',
      params: {
        download_url: 'https://example.com/pkg.tgz',
        objid: 'obj-1',
        download_options: { checksum: 'sha256' },
        parent_id: undefined,
        permissions: undefined,
        root_id: '10',
        priority: 2,
        user_id: 'did:bns:u1',
        app_id: 'pkg-app',
        app_name: 'pkg-app',
      },
      sys: [31],
    })
  })

  it('getTask accepts wrapped and task-only response shapes', async () => {
    const wrappedFetcher = jest.fn().mockResolvedValue(makeResponse({
      task: makeTask({ id: 40, status: 'Paused' }),
    }, 40))
    const directFetcher = jest.fn().mockResolvedValue(makeResponse(
      makeTask({ id: 41, status: 'Completed' }),
      41,
    ))

    const wrappedClient = new TaskManagerClient(new kRPCClient('/kapi/task-manager/', null, 40, { fetcher: wrappedFetcher }))
    const directClient = new TaskManagerClient(new kRPCClient('/kapi/task-manager/', null, 41, { fetcher: directFetcher }))

    expect((await wrappedClient.getTask(40)).status).toBe(TaskStatus.Paused)
    expect((await directClient.getTask(41)).status).toBe(TaskStatus.Completed)
  })

  it('listTasks accepts wrapped and task-array response shapes', async () => {
    const wrappedFetcher = jest.fn().mockResolvedValue(makeResponse({
      tasks: [makeTask({ id: 50, status: 'Paused' })],
    }, 50))
    const directFetcher = jest.fn().mockResolvedValue(makeResponse([
      makeTask({ id: 51, status: 'Running' }),
    ], 51))

    const wrappedClient = new TaskManagerClient(new kRPCClient('/kapi/task-manager/', null, 50, { fetcher: wrappedFetcher }))
    const directClient = new TaskManagerClient(new kRPCClient('/kapi/task-manager/', null, 51, { fetcher: directFetcher }))

    const wrappedTasks = await wrappedClient.listTasks({
      filter: {
        app_id: 'test-app',
        status: TaskStatus.Paused,
        root_id: '50',
      },
      sourceUserId: 'did:bns:source-user',
      sourceAppId: 'source-app',
    })
    const directTasks = await directClient.listTasks({ filter: { root_id: '51' } })

    expect(wrappedTasks[0].status).toBe(TaskStatus.Paused)
    expect(directTasks[0].status).toBe(TaskStatus.Running)
    expect(JSON.parse((wrappedFetcher.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      method: 'list_tasks',
      params: {
        app_id: 'test-app',
        task_type: undefined,
        status: 'Paused',
        parent_id: undefined,
        root_id: '50',
        source_user_id: 'did:bns:source-user',
        source_app_id: 'source-app',
      },
      sys: [50],
    })
  })

  it('getSubtasks accepts wrapped and task-array response shapes', async () => {
    const wrappedFetcher = jest.fn().mockResolvedValue(makeResponse({
      tasks: [makeTask({ id: 60, parent_id: 10 })],
    }, 60))
    const directFetcher = jest.fn().mockResolvedValue(makeResponse([
      makeTask({ id: 61, parent_id: 10 }),
    ], 61))

    const wrappedClient = new TaskManagerClient(new kRPCClient('/kapi/task-manager/', null, 60, { fetcher: wrappedFetcher }))
    const directClient = new TaskManagerClient(new kRPCClient('/kapi/task-manager/', null, 61, { fetcher: directFetcher }))

    expect((await wrappedClient.getSubtasks(10))).toHaveLength(1)
    expect((await directClient.getSubtasks(10))).toHaveLength(1)
  })

  it('markTaskAsFailed sends update_task_error then update_task_status', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(makeResponse(null, 5))
      .mockResolvedValueOnce(makeResponse(null, 6))

    const rpcClient = new kRPCClient('/kapi/task-manager/', null, 5, { fetcher: fetcher })
    const client = new TaskManagerClient(rpcClient)
    await client.markTaskAsFailed(42, 'network failed')

    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)).toMatchObject({
      method: 'update_task_error',
      params: { id: 42, error_message: 'network failed' },
    })
    expect(JSON.parse((fetcher.mock.calls[1][1] as RequestInit).body as string)).toMatchObject({
      method: 'update_task_status',
      params: { id: 42, status: 'Failed' },
    })
  })

  it('waitForTaskEndWithInterval stops on terminal states', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(makeResponse({ task: makeTask({ id: 70, status: 'Running' }) }, 70))
      .mockResolvedValueOnce(makeResponse({ task: makeTask({ id: 70, status: 'Completed' }) }, 71))

    const rpcClient = new kRPCClient('/kapi/task-manager/', null, 70, { fetcher: fetcher })
    const client = new TaskManagerClient(rpcClient)

    await expect(client.waitForTaskEndWithInterval(70, 1)).resolves.toBe(TaskStatus.Completed)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('resumeLastPausedTask throws when paused task does not exist', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({ tasks: [] }, 77))

    const rpcClient = new kRPCClient('/kapi/task-manager/', null, 77, { fetcher: fetcher })
    const client = new TaskManagerClient(rpcClient)

    await expect(client.resumeLastPausedTask()).rejects.toThrow('No paused tasks found')
  })

  it('waitForTaskEndWithInterval validates poll interval', async () => {
    const fetcher = jest.fn()
    const rpcClient = new kRPCClient('/kapi/task-manager/', null, 1, { fetcher: fetcher })
    const client = new TaskManagerClient(rpcClient)

    await expect(client.waitForTaskEndWithInterval(1, 0)).rejects.toThrow('pollIntervalMs must be greater than 0')
    expect(fetcher).not.toHaveBeenCalled()
  })
})
