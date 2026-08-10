import { kRPCClient, RPCError } from '../src/krpc_client'
import {
  RAW_TASK_SCHEMA_ID,
  TASK_ERR_REVISION_CONFLICT,
  TaskControlAction,
  TaskDataScope,
  TaskExecutorKind,
  TaskGrantScope,
  TaskManagerClient,
  TaskOutcome,
  TaskPhase,
  TaskWaitReasonKind,
  taskMgrErrorCode,
  taskMgrTaskEventPath,
  taskMgrTreeEventPath,
} from '../src/task_mgr_client'

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
    task_id: 'task-01',
    name: 'test task',
    root_id: 'task-01',
    child_control_policy: {
      follow_pause: true,
      follow_resume: true,
      follow_cancel: true,
    },
    schema_id: RAW_TASK_SCHEMA_ID,
    schema_version: 1,
    input: { work: true },
    input_digest: 'digest-01',
    creator: {
      user_id: 'did:bns:test-user',
      app_id: 'test-app',
    },
    idempotency_key: 'idem-01',
    executor: {
      kind: 'App',
      app_id: 'test-app',
      app_instance_id: 'instance-01',
    },
    runner_epoch: 2,
    phase: 'Accepted',
    control_profile: {
      pause: { kind: 'Unavailable' },
      resume: { kind: 'Unavailable' },
      cancel: { kind: 'Interrupt' },
      updated_at: 1700000000000,
    },
    policy_preset: 'collaborative-tree/v1',
    permission_boundary: false,
    revision: 3,
    created_at: 1700000000000,
    updated_at: 1700000000000,
    ...overrides,
  }
}

function makeSummary(overrides: Record<string, unknown> = {}) {
  return {
    task_id: 'task-01',
    name: 'test task',
    root_id: 'task-01',
    schema_id: RAW_TASK_SCHEMA_ID,
    schema_version: 1,
    creator: {
      user_id: 'did:bns:test-user',
      app_id: 'test-app',
    },
    executor_kind: 'App',
    phase: 'Running',
    revision: 4,
    created_at: 1700000000000,
    updated_at: 1700000000100,
    ...overrides,
  }
}

function requestBody(fetcher: jest.Mock, call: number = 0) {
  return JSON.parse((fetcher.mock.calls[call][1] as RequestInit).body as string)
}

describe('TaskManagerClient 2.0', () => {
  it('createTask sends the 2.0 schema/input/executor contract and parses TaskResult', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      task: makeTask({ task_id: 'task-created' }),
    }, 9))
    const client = new TaskManagerClient(new kRPCClient('/kapi/task-manager/', null, 9, { fetcher }))

    const task = await client.createTask({
      name: 'publish package',
      schema_id: 'package.publish/v1',
      input: { pkg: 'abc' },
      executor: { kind: 'SelfApp', app_instance_id: 'instance-01' },
      parent_id: 'task-parent',
      permission_boundary: true,
      idempotency_key: 'publish-abc-1',
      message: 'queued',
    })

    expect(task.task_id).toBe('task-created')
    expect(task.phase).toBe(TaskPhase.Accepted)
    expect(requestBody(fetcher)).toEqual({
      method: 'create_task',
      params: {
        name: 'publish package',
        schema_id: 'package.publish/v1',
        input: { pkg: 'abc' },
        executor: { kind: 'SelfApp', app_instance_id: 'instance-01' },
        parent_id: 'task-parent',
        permission_boundary: true,
        idempotency_key: 'publish-abc-1',
        message: 'queued',
      },
      sys: [9],
    })
  })

  it('uses opaque string ids and returns cursor pages for get/list/tree/subtasks', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(makeResponse({ task: makeTask() }, 20))
      .mockResolvedValueOnce(makeResponse({ tasks: [makeSummary()], next_cursor: 'cursor-2' }, 21))
      .mockResolvedValueOnce(makeResponse({ tasks: [makeSummary()], next_cursor: 'cursor-tree' }, 22))
      .mockResolvedValueOnce(makeResponse({ tasks: [makeSummary()], next_cursor: 'cursor-child' }, 23))
    const client = new TaskManagerClient(new kRPCClient('/kapi/task-manager/', null, 20, { fetcher }))

    await expect(client.getTask('task-01')).resolves.toMatchObject({ task_id: 'task-01' })
    await expect(client.listTasks({
      schema_id: RAW_TASK_SCHEMA_ID,
      phase: TaskPhase.Running,
      executor_kind: TaskExecutorKind.App,
      include_archived: true,
      limit: 10,
    })).resolves.toMatchObject({ next_cursor: 'cursor-2' })
    await expect(client.getTaskTree({ root_id: 'task-01', depth: 2 })).resolves.toMatchObject({
      next_cursor: 'cursor-tree',
    })
    await expect(client.getSubtasks({ task_id: 'task-01', limit: 5 })).resolves.toMatchObject({
      next_cursor: 'cursor-child',
    })

    expect(requestBody(fetcher, 0).params).toEqual({ task_id: 'task-01' })
    expect(requestBody(fetcher, 1).params).toEqual({
      schema_id: RAW_TASK_SCHEMA_ID,
      phase: 'Running',
      executor_kind: 'App',
      include_archived: true,
      limit: 10,
    })
    expect(requestBody(fetcher, 2).params).toEqual({ root_id: 'task-01', depth: 2 })
    expect(requestBody(fetcher, 3).params).toEqual({ task_id: 'task-01', limit: 5 })
  })

  it('sends flattened runner fencing fields and returns updated task snapshots', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      task: makeTask({ phase: 'Running', revision: 4 }),
    }, 30))
    const client = new TaskManagerClient(new kRPCClient('/kapi/task-manager/', null, 30, { fetcher }))

    const task = await client.reportProgress({
      task_id: 'task-01',
      app_instance_id: 'instance-01',
      runner_epoch: 2,
      expected_revision: 3,
      progress: { completed: 1, total: 2 },
      message: 'halfway',
    })

    expect(task.revision).toBe(4)
    expect(requestBody(fetcher)).toEqual({
      method: 'report_progress',
      params: {
        task_id: 'task-01',
        app_instance_id: 'instance-01',
        runner_epoch: 2,
        expected_revision: 3,
        progress: { completed: 1, total: 2 },
        message: 'halfway',
      },
      sys: [30],
    })
  })

  it('parses tagged single and recursive control results', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(makeResponse({ kind: 'Task', task: makeTask() }, 40))
      .mockResolvedValueOnce(makeResponse({
        kind: 'Batch',
        result: {
          requested: ['task-01', 'task-02'],
          skipped_by_policy: [],
          denied: [],
          already_terminal: ['task-03'],
        },
      }, 41))
    const client = new TaskManagerClient(new kRPCClient('/kapi/task-manager/', null, 40, { fetcher }))

    await expect(client.requestControl({
      task_id: 'task-01',
      action: TaskControlAction.Pause,
      request_id: 'control-01',
      expected_revision: 3,
    })).resolves.toMatchObject({ kind: 'Task' })
    await expect(client.cancelTask('task-01', true)).resolves.toMatchObject({ kind: 'Batch' })

    expect(requestBody(fetcher, 0).params).toEqual({
      task_id: 'task-01',
      action: 'Pause',
      request_id: 'control-01',
      expected_revision: 3,
    })
    expect(requestBody(fetcher, 1).params).toMatchObject({
      task_id: 'task-01',
      action: 'Cancel',
      recursive: true,
    })
    expect(requestBody(fetcher, 1).params.request_id).toMatch(/^ctl-/)
  })

  it('forwards every task-returning 2.0 mutation to its matching RPC method', async () => {
    const fetcher = jest.fn()
    for (let seq = 100; seq < 117; seq += 1) {
      fetcher.mockResolvedValueOnce(makeResponse({ task: makeTask() }, seq))
    }
    const client = new TaskManagerClient(new kRPCClient('/kapi/task-manager/', null, 100, { fetcher }))
    const envelope = {
      task_id: 'task-01',
      app_instance_id: 'instance-01',
      runner_epoch: 2,
      expected_revision: 3,
    }
    const reason = { kind: TaskWaitReasonKind.Capacity, code: 'busy' }

    await client.archiveTask({ task_id: 'task-01', expected_revision: 3 })
    await client.updateAssignees({ task_id: 'task-01', add: ['did:bns:u2'], expected_revision: 3 })
    await client.grantTaskAccess({
      task_id: 'task-01',
      grant: {
        subject: { kind: 'User', user_id: 'did:bns:u2' },
        actions: [],
        scope: TaskGrantScope.SelfOnly,
        data_scope: TaskDataScope.MetaOnly,
      },
      expected_revision: 3,
    })
    await client.revokeTaskAccess({ task_id: 'task-01', grant_id: 'grant-01', expected_revision: 3 })
    await client.reportStarted(envelope)
    await client.reportWaiting({ ...envelope, reason })
    await client.reportRunning(envelope)
    await client.updateControlProfile({
      ...envelope,
      profile: {
        pause: { kind: 'Available' },
        resume: { kind: 'Unavailable', reason: 'already running' },
        cancel: { kind: 'Safe' },
        updated_at: 1,
      },
    })
    await client.ackControl({ ...envelope, request_id: 'control-01', applied: true })
    await client.commitResult({ task_id: 'task-01', result: { ok: true }, expected_revision: 3 })
    await client.failTask({ ...envelope, error: { code: 'failed', message: 'failed' } })
    await client.createPromisedTask({
      name: 'promised',
      schema_id: RAW_TASK_SCHEMA_ID,
      input: {},
      creator: { user_id: 'did:bns:u1', app_id: 'test-app' },
      idempotency_key: 'promised-01',
    })
    await client.setPromiseWait({ task_id: 'task-01', wait_reason: reason, expected_revision: 3 })
    await client.bindAppExecutor({
      task_id: 'task-01',
      app_id: 'runner-app',
      app_instance_id: 'runner-01',
      expected_revision: 3,
    })
    await client.releaseAppExecutor({
      task_id: 'task-01',
      expected_instance_id: 'runner-01',
      expected_runner_epoch: 2,
      reason,
      expected_revision: 3,
    })
    await client.finishPromiseFailure({
      task_id: 'task-01',
      error: { code: 'no_runner', message: 'no runner' },
      expected_revision: 3,
    })
    await client.cancelPromisedTask({ task_id: 'task-01', expected_revision: 3 })

    expect(fetcher.mock.calls.map((_, index) => requestBody(fetcher, index).method)).toEqual([
      'archive_task',
      'update_assignees',
      'grant_task_access',
      'revoke_task_access',
      'report_started',
      'report_waiting',
      'report_running',
      'update_control_profile',
      'ack_control',
      'commit_result',
      'fail_task',
      'create_promised_task',
      'set_promise_wait',
      'bind_app_executor',
      'release_app_executor',
      'finish_promise_failure',
      'cancel_promised_task',
    ])
  })

  it('supports schema registry, event, ACL, and note response shapes', async () => {
    const schema = {
      schema_id: 'test.op/v1',
      schema_version: 1,
      input_schema: {},
      output_schema: {},
      allowed_executor_kinds: ['App'],
      user_creatable: true,
      publisher_app_id: 'test-app',
      enabled: true,
      created_at: 1,
    }
    const grant = { grant_id: 'grant-01' }
    const event = { event_id: 'event-01' }
    const note = { id: 1, task_id: 'task-01', content: 'hello' }
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(makeResponse(schema, 50))
      .mockResolvedValueOnce(makeResponse({ schemas: [schema] }, 51))
      .mockResolvedValueOnce(makeResponse({ grants: [grant] }, 52))
      .mockResolvedValueOnce(makeResponse({ events: [event], next_cursor: 'event-02' }, 53))
      .mockResolvedValueOnce(makeResponse({ note_id: 1, note }, 54))
      .mockResolvedValueOnce(makeResponse({ notes: [note] }, 55))
    const client = new TaskManagerClient(new kRPCClient('/kapi/task-manager/', null, 50, { fetcher }))

    await expect(client.getTaskSchema('test.op/v1')).resolves.toMatchObject({ schema_id: 'test.op/v1' })
    await expect(client.listTaskSchemas()).resolves.toHaveLength(1)
    await expect(client.listTaskAccess('task-01')).resolves.toHaveLength(1)
    await expect(client.listTaskEvents({ task_id: 'task-01' })).resolves.toMatchObject({
      next_cursor: 'event-02',
    })
    await expect(client.addTaskNote({ task_id: 'task-01', content: 'hello' })).resolves.toMatchObject({ id: 1 })
    await expect(client.listTaskNotes('task-01')).resolves.toHaveLength(1)
  })

  it('runnerStart and runnerComplete use fresh fencing snapshots', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(makeResponse({ task: makeTask({ phase: 'Accepted', revision: 3 }) }, 60))
      .mockResolvedValueOnce(makeResponse({ task: makeTask({ phase: 'Running', revision: 4 }) }, 61))
      .mockResolvedValueOnce(makeResponse({ task: makeTask({ phase: 'Running', revision: 4 }) }, 62))
      .mockResolvedValueOnce(makeResponse({
        task: makeTask({
          phase: 'Terminal',
          outcome: 'Succeeded',
          result: { ok: true },
          revision: 5,
        }),
      }, 63))
    const client = new TaskManagerClient(new kRPCClient('/kapi/task-manager/', null, 60, { fetcher }))

    await expect(client.runnerStart('task-01')).resolves.toMatchObject({ phase: TaskPhase.Running })
    await expect(client.runnerComplete('task-01', { ok: true })).resolves.toMatchObject({
      phase: TaskPhase.Terminal,
      outcome: TaskOutcome.Succeeded,
    })

    expect(requestBody(fetcher, 1)).toMatchObject({
      method: 'report_started',
      params: {
        task_id: 'task-01',
        app_instance_id: 'instance-01',
        runner_epoch: 2,
        expected_revision: 3,
      },
    })
    expect(requestBody(fetcher, 3)).toMatchObject({
      method: 'commit_result',
      params: {
        task_id: 'task-01',
        result: { ok: true },
        app_instance_id: 'instance-01',
        runner_epoch: 2,
        expected_revision: 4,
      },
    })
  })

  it('runnerProgress retries once with a fresh revision after a revision conflict', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(makeResponse({ task: makeTask({ phase: 'Running', revision: 7 }) }, 70))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ error: 'revision_conflict: expected 8', sys: [71] }),
      })
      .mockResolvedValueOnce(makeResponse({ task: makeTask({ phase: 'Running', revision: 8 }) }, 72))
      .mockResolvedValueOnce(makeResponse({ task: makeTask({ phase: 'Running', revision: 9 }) }, 73))
    const client = new TaskManagerClient(new kRPCClient('/kapi/task-manager/', null, 70, { fetcher }))

    await expect(client.runnerProgress('task-01', { percent: 50 }, 'half')).resolves.toMatchObject({ revision: 9 })
    expect(requestBody(fetcher, 1).params.expected_revision).toBe(7)
    expect(requestBody(fetcher, 3).params.expected_revision).toBe(8)
  })

  it('exposes stable error-code and event-path helpers', () => {
    expect(taskMgrErrorCode(new RPCError('RPC call error: revision_conflict: stale write')))
      .toBe(TASK_ERR_REVISION_CONFLICT)
    expect(taskMgrErrorCode(new Error('unrelated'))).toBeNull()
    expect(taskMgrTaskEventPath('task-01')).toBe('/task_mgr/task-01')
    expect(taskMgrTreeEventPath('root-01')).toBe('/task_mgr/tree/root-01')
    expect(TaskWaitReasonKind.HumanInput).toBe('HumanInput')
  })

  it('rejects old task payloads that do not carry a string task_id', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({ task: { id: 1, status: 'Running' } }, 80))
    const client = new TaskManagerClient(new kRPCClient('/kapi/task-manager/', null, 80, { fetcher }))

    await expect(client.getTask('task-01')).rejects.toThrow('string task_id')
  })
})
