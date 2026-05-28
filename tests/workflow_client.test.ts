import { kRPCClient } from '../src/krpc_client'
import {
  WorkflowClient,
  WorkflowOutputMode,
  WorkflowScheduledTaskMisfirePolicy,
  WorkflowScheduledTaskStatus,
  WorkflowStepType,
} from '../src/workflow_client'

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

function makeWorkflowClient(fetcher: jest.Mock, seq: number = 1) {
  return new WorkflowClient(new kRPCClient('/kapi/workflow/', null, seq, { fetcher }))
}

describe('WorkflowClient', () => {
  it('submitDefinition sends upstream-compatible payload and unwraps result', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      ok: true,
      workflow_id: 'wf-1',
      version: 2,
      analysis: { warnings: [] },
      definition: { id: 'wf-1' },
    }, 5))
    const client = makeWorkflowClient(fetcher, 5)

    const result = await client.submitDefinition({
      owner: { user_id: 'did:bns:u1', app_id: 'workflow-app' },
      tags: ['test'],
      definition: {
        schema_version: '0.4',
        id: 'wf-1',
        name: 'Test Workflow',
        trigger: { type: 'manual' },
        steps: [{
          id: 'step-1',
          name: 'Step 1',
          type: WorkflowStepType.Autonomous,
          executor: 'service::aicc.complete',
          output_schema: { type: 'object' },
          output_mode: WorkflowOutputMode.Single,
        }],
        edges: [{ from: 'step-1', to: null }],
      },
    })

    expect(result.workflow_id).toBe('wf-1')
    expect(JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      method: 'submit_definition',
      params: {
        owner: { user_id: 'did:bns:u1', app_id: 'workflow-app' },
        tags: ['test'],
        definition: {
          schema_version: '0.4',
          id: 'wf-1',
          name: 'Test Workflow',
          trigger: { type: 'manual' },
          steps: [{
            id: 'step-1',
            name: 'Step 1',
            type: 'autonomous',
            executor: 'service::aicc.complete',
            output_schema: { type: 'object' },
            output_mode: 'single',
          }],
          edges: [{ from: 'step-1', to: null }],
        },
      },
      sys: [5],
    })
  })

  it('createRun/startRun/getHistory use workflow RPC method names', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(makeResponse({
        ok: true,
        run_id: 'run-1',
        status: 'running',
        events: [],
        seq: 1,
      }, 10))
      .mockResolvedValueOnce(makeResponse({
        ok: true,
        run_id: 'run-1',
        status: 'completed',
        events: [],
        from_seq: 1,
        to_seq: 2,
      }, 11))
      .mockResolvedValueOnce(makeResponse({
        ok: true,
        run_id: 'run-1',
        events: [],
        next_seq: 2,
        current_seq: 2,
      }, 12))

    const client = makeWorkflowClient(fetcher, 10)

    await client.createRun({
      workflow_id: 'wf-1',
      owner: { user_id: 'did:bns:u1', app_id: 'workflow-app' },
      input: { x: 1 },
      auto_start: true,
    })
    await client.startRun('run-1')
    await client.getHistory({ run_id: 'run-1', since_seq: 1, limit: 10 })

    expect(fetcher.mock.calls.map((call) => JSON.parse((call[1] as RequestInit).body as string).method)).toEqual([
      'create_run',
      'start_run',
      'get_history',
    ])
  })

  it('createScheduledTask unwraps schedule response', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      ok: true,
      schedule_id: 'sch-1',
      schedule: {
        schedule_id: 'sch-1',
        owner: { user_id: 'did:bns:u1', app_id: 'workflow-app' },
        name: 'Nightly',
        status: 'enabled',
        schedule: { kind: 'cron', expr: '0 1 * * *', timezone: 'UTC' },
        target: {
          task_type: 'workflow.run',
          runner: 'workflow',
          name_template: 'workflow/run',
          data_template: { workflow_run: { workflow_id: 'wf-1' } },
        },
        state: {},
        policy: {
          misfire: 'skip',
          max_parallel_runs: 1,
          catch_up_limit: 0,
          jitter_sec: 0,
        },
        task_mirror: {},
        created_at: 1,
        updated_at: 1,
      },
    }, 20))
    const client = makeWorkflowClient(fetcher, 20)

    const schedule = await client.createScheduledTask({
      owner: { user_id: 'did:bns:u1', app_id: 'workflow-app' },
      name: 'Nightly',
      status: WorkflowScheduledTaskStatus.Enabled,
      schedule: { kind: 'cron', expr: '0 1 * * *', timezone: 'UTC' },
      target: {
        task_type: 'workflow.run',
        runner: 'workflow',
        name_template: 'workflow/run',
        data_template: { workflow_run: { workflow_id: 'wf-1' } },
      },
      policy: {
        misfire: WorkflowScheduledTaskMisfirePolicy.Skip,
        max_parallel_runs: 1,
        catch_up_limit: 0,
        jitter_sec: 0,
      },
    })

    expect(schedule.schedule_id).toBe('sch-1')
  })

  it('throws when workflow response has ok false', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      ok: false,
      error: 'analysis_failed',
    }, 30))
    const client = makeWorkflowClient(fetcher, 30)

    await expect(client.listDefinitions()).rejects.toThrow('analysis_failed')
  })
})
