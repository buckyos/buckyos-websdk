import { kRPCClient } from '../src/krpc_client'
import {
  WorkflowClient,
  WorkflowOutputMode,
  WorkflowRequestError,
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
      revision: 'abc',
      source: 'user_imported',
      analysis: { errors: [], warnings: [] },
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
    expect(result.revision).toBe('abc')
    expect(result.source).toBe('user_imported')
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

  it('throws a WorkflowRequestError carrying code and detail when ok is false', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      ok: false,
      error: 'tools_missing',
      message: 'pdftoppm missing',
      detail: { details: { tools_missing: ['pdftoppm'] }, retryable: false },
    }, 30))
    const client = makeWorkflowClient(fetcher, 30)

    const err = await client.listDefinitions().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(WorkflowRequestError)
    expect((err as WorkflowRequestError).code).toBe('tools_missing')
    expect((err as WorkflowRequestError).message).toBe('pdftoppm missing')
    expect(((err as WorkflowRequestError).detail as { details: { tools_missing: string[] } }).details.tools_missing).toEqual(['pdftoppm'])
  })

  it('createRun forwards ensure/wait_ms and exposes reused/output/revision', async () => {
    const fetcher = jest.fn().mockResolvedValue(makeResponse({
      ok: true,
      run_id: 'run-9',
      workflow_id: 'media.image',
      status: 'completed',
      revision: 'rev1',
      reused: true,
      output: { fit_image: { model_media_obj_id: 'cyfile:aa' } },
      events: [],
      seq: 7,
    }, 40))
    const client = makeWorkflowClient(fetcher, 40)

    const result = await client.createRun({
      workflow_id: 'media.image',
      input: { obj_id: 'cyfile:in' },
      auto_start: true,
      ensure: true,
      wait_ms: 500,
    })

    expect(result.reused).toBe(true)
    expect(result.revision).toBe('rev1')
    expect((result.output.fit_image as { model_media_obj_id: string }).model_media_obj_id).toBe('cyfile:aa')
    expect(JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string).params).toEqual({
      workflow_id: 'media.image',
      input: { obj_id: 'cyfile:in' },
      auto_start: true,
      ensure: true,
      wait_ms: 500,
    })
  })

  it('function, capability, cancel and output methods use the new RPC names', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(makeResponse({ ok: true, functions: [{ fun_id: 'func:1', registration: { name: 'media.probe', version: '1', fun_id: 'func:1', description: '', requirements: {}, best_run_weight: {}, affinity_type: 'Input' }, object: { func_type: 'native', content: 'media.probe/impl-1', is_pure: true, params_type: {}, params_schema: {}, result_type: {}, result_schema: {} } }] }, 50))
      .mockResolvedValueOnce(makeResponse({ ok: true, function: { fun_id: 'func:1', published: true, registration: {}, object: {} } }, 51))
      .mockResolvedValueOnce(makeResponse({ ok: true, execution_epoch: 3, environment: { revision: 'r', probed_at: 1, tools: {}, missing: ['soffice'], searched: [] }, functions: 12 }, 52))
      .mockResolvedValueOnce(makeResponse({ ok: true, run_id: 'run-1', status: 'aborted', events: [], from_seq: 1, to_seq: 3 }, 53))
      .mockResolvedValueOnce(makeResponse({ ok: true, run_id: 'run-1', status: 'aborted', terminal: true, revision: 'r', output: {}, node_errors: { a: { code: 'cancelled', message: 'x' } }, run_error: { code: 'cancelled', message: 'x' }, delivery: { artifacts: [], principal: 'u/app', expires_at: 1 } }, 54))
    const client = makeWorkflowClient(fetcher, 50)

    const functions = await client.listFunctions('media.')
    expect(functions[0].registration.name).toBe('media.probe')
    const fn = await client.getFunction({ name: 'media.probe', version: '1' })
    expect(fn.published).toBe(true)
    const caps = await client.getCapabilities()
    expect(caps.environment.missing).toEqual(['soffice'])
    const cancelled = await client.cancelRun({ run_id: 'run-1', reason: 'test' })
    expect(cancelled.status).toBe('aborted')
    const output = await client.getRunOutput('run-1')
    expect(output.node_errors.a.code).toBe('cancelled')

    const calls = fetcher.mock.calls.map((call) => JSON.parse((call[1] as RequestInit).body as string))
    expect(calls.map((c) => c.method)).toEqual(['list_functions', 'get_function', 'get_capabilities', 'cancel_run', 'get_run_output'])
    expect(calls[0].params).toEqual({ prefix: 'media.' })
    expect(calls[1].params).toEqual({ name: 'media.probe', version: '1' })
    expect(calls[3].params).toEqual({ run_id: 'run-1', reason: 'test' })
  })
})
