// Host-agnostic xllm cases (M1, T1-8). The same list runs under jest (source),
// Deno (the built `dist/xllm.mjs`, proving core + site runtime need only Web
// standard APIs) and a real browser (the bundled example page). The library is
// a parameter, so this file imports nothing.

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface XllmLibs {
  x: any
  dev: any
}

export interface XllmCase {
  name: string
  run(libs: XllmLibs): Promise<void>
}

function fail(msg: string): never {
  throw new Error(msg)
}

function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) fail(`${msg}: expected ${e}, got ${a}`)
}

function ok(cond: unknown, msg: string) {
  if (!cond) fail(msg)
}

async function rejects(p: Promise<unknown>, kind: string, msg: string) {
  try {
    await p
  } catch (e: any) {
    if (e?.kind !== kind) fail(`${msg}: expected XllmError ${kind}, got ${e?.kind ?? ''} ${e?.message ?? e}`)
    return
  }
  fail(`${msg}: expected a ${kind} rejection`)
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** A page with a note: the tools of the `demo.notes` scene, as the example page defines them. */
function notesPage(x: any, scene = 'demo.notes') {
  const state = { note: '', selection: 'Pick me', applied: new Set<string>(), calls: [] as string[], hang: undefined as undefined | string }
  const hold = (name: string) => (state.hang === name ? new Promise(() => {}) : undefined)
  const runtime = x.createSiteRuntime({
    scene,
    origin: 'https://notes.example',
    hostname: 'notes.example',
    env: { USER_NAME: 'alice' },
    tools: {
      get_selection: {
        spec: { description: 'The text selected on this page', args_schema: { type: 'object', properties: {} } },
        idempotent: true,
        call: async () => {
          state.calls.push('get_selection')
          await hold('get_selection')
          return state.selection
        },
      },
      append_note: {
        spec: {
          description: 'Append text to the saved note',
          args_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        },
        idempotent: true,
        call: async ({ text }: { text: string }, { call_id }: { call_id: string }) => {
          state.calls.push('append_note')
          await hold('append_note')
          if (!state.applied.has(call_id)) {
            state.applied.add(call_id)
            state.note += text
          }
          return 'appended'
        },
      },
      clear_note: {
        spec: { description: 'Delete the saved note', args_schema: { type: 'object', properties: {} } },
        call: async () => {
          state.calls.push('clear_note')
          await hold('clear_note')
          state.note = ''
          return 'cleared'
        },
        describeInterrupted: () => (state.note === '' ? 'The note is already deleted.' : 'The note was not deleted.'),
      },
      fail_tool: {
        spec: { description: 'Always fails', args_schema: { type: 'object', properties: {} } },
        call: () => {
          throw new Error('the page refused')
        },
      },
      slow_tool: {
        spec: { description: 'Takes 3 seconds', args_schema: { type: 'object', properties: {} } },
        cancellable: true,
        call: (_args: unknown, { signal }: { signal: AbortSignal }) => new Promise((resolve, reject) => {
          const t = setTimeout(() => resolve('slow done'), 3000)
          signal.addEventListener('abort', () => {
            clearTimeout(t)
            reject(new Error('stopped'))
          }, { once: true })
        }),
      },
    },
  })
  return { state, runtime }
}

const TOOLS_CFG = { enabled: true, tools: [{ name: 'get_selection' }, { name: 'append_note' }, { name: 'clear_note' }] }

function llmContext(extra: Record<string, unknown> = {}) {
  return { provider: { type: 'buckyos' }, model: 'llm.chat', loop_model: 'function_call', max_tool_iterations: 6, tools: TOOLS_CFG, ...extra }
}

async function startRun(libs: XllmLibs, script: unknown[], opts: { cfg?: unknown; page?: any; store?: any; input?: string } = {}) {
  const { x, dev } = libs
  const page = opts.page ?? notesPage(x)
  const llm = new dev.ScriptedLlmClient(script)
  const store = opts.store ?? new x.MemoryRunStore()
  const events: any[] = []
  const deps = { llm, runtime: page.runtime, store, hostPromptSections: 'NONE', observer: { onEvent: (_id: string, e: any) => events.push(e) } }
  const task = await x.XllmTask.prepareHosted(opts.cfg ?? llmContext(), 'demo.notes', 'You help {{env.USER_NAME}} take notes.', deps)
  const run = await x.XllmRun.start(task, deps, { input: opts.input ?? 'Copy the selection into the note.' })
  return { run, llm, store, page, deps, events, task }
}

function fakeAicc(behaviour: (method: string, req: any) => any) {
  return {
    chatCompletionsCreate: async (req: any) => behaviour('chat.completions.create', req),
    helperLlmChat: async (req: any) => behaviour('helper.llm_chat', req),
  }
}

function rpcError(message: string, code?: string, data?: unknown) {
  const e: any = new Error(message)
  e.name = 'RPCError'
  e.code = code
  e.data = data
  return e
}

/** A task backend whose single task `t1` finishes `finishAfterMs` after creation. */
function fakeTasks(finishAfterMs: number) {
  const started = Date.now()
  const done = () => Date.now() - started >= finishAfterMs
  const waits: number[] = []
  return {
    waits,
    async state() {
      return done() ? { kind: 'finished', success: true, output: 'task output' }
        : { kind: 'running', brief: 'long job', elapsed_ms: Date.now() - started, cancellable: false }
    },
    async wait(_id: string, until: number) {
      waits.push(until - Date.now())
      await sleep(Math.max(0, Math.min(started + finishAfterMs, until) - Date.now()))
      return this.state()
    },
    async active() {
      return done() ? [] : [{ task_id: 't1', brief: 'long job', status: 'running', elapsed_ms: 0, cancellable: false }]
    },
  }
}

function envelopePage(x: any, result: () => unknown) {
  return x.createSiteRuntime({
    scene: 'demo.tasks', origin: 'https://tasks.example', hostname: 'tasks.example',
    tools: { start_job: { spec: { description: 'Start a job', args_schema: { type: 'object', properties: {} } }, call: async () => result() } },
  })
}

export const XLLM_CASES: XllmCase[] = [
  {
    name: 'completes a tool loop and records usage',
    async run(libs) {
      const { run, llm, page, events } = await startRun(libs, [
        { tool_calls: [{ name: 'get_selection', args: {} }] },
        { tool_calls: [{ name: 'append_note', args: { text: 'Pick me' } }] },
        { text: 'Done: the note has the selection.' },
      ])
      const out = await run.execute()
      eq(out.status, 'completed', 'status')
      eq(out.record.result.raw, 'Done: the note has the selection.', 'result')
      eq(out.record.usage.llm_requests, 3, 'llm_requests')
      eq(page.state.note, 'Pick me', 'note written once')
      eq(page.state.calls, ['get_selection', 'append_note'], 'tool sequence')
      ok(out.record.latest_snapshot_idx >= 3, 'snapshots before every inference and tool call')
      eq(llm.requests[0].messages[0].content[0].text, 'You help alice take notes.\n', 'host system with {{env.*}}, no xllm sections')
      eq(llm.requests[0].tool_specs.map((s: any) => s.name).sort(), ['append_note', 'clear_note', 'get_selection'], 'advertised tools')
      ok(events.some(e => e.kind === 'tool_finished' && e.name === 'append_note' && e.ok), 'tool events observed')
    },
  },
  {
    name: 'a failing tool is fed back and the run continues',
    async run(libs) {
      const cfg = llmContext({ tools: { enabled: true, tools: [{ name: 'fail_tool' }] } })
      const { run, llm } = await startRun(libs, [
        { tool_calls: [{ name: 'fail_tool', args: {} }] },
        { text: 'It failed; reporting that.' },
      ], { cfg })
      const out = await run.execute()
      eq(out.status, 'completed', 'status')
      const tool = llm.requests[1].messages.find((m: any) => m.role === 'tool')
      eq(tool.content[0].is_error, true, 'error observation')
      eq(tool.content[0].content[0].text, 'the page refused', 'error text')
    },
  },
  {
    name: 'unknown tools and bad arguments are observation errors',
    async run(libs) {
      const { run, llm } = await startRun(libs, [
        { tool_calls: [{ name: 'delete_everything', args: {} }, { name: 'append_note', args: { text: 7 } }] },
        { text: 'ok' },
      ])
      const out = await run.execute()
      eq(out.status, 'completed', 'status')
      const tools = llm.requests[1].messages.filter((m: any) => m.role === 'tool').map((m: any) => m.content[0].content[0].text)
      ok(tools[0].startsWith('tool `delete_everything` is not available in this run'), `unknown tool: ${tools[0]}`)
      ok(tools[1].startsWith('invalid arguments for `append_note`'), `bad args: ${tools[1]}`)
    },
  },
  {
    name: 'the tool iteration budget ends the run as limit_reached',
    async run(libs) {
      const cfg = llmContext({ max_tool_iterations: 1 })
      const { run } = await startRun(libs, [
        { tool_calls: [{ name: 'get_selection', args: {} }] },
        { tool_calls: [{ name: 'get_selection', args: {} }] },
      ], { cfg })
      const out = await run.execute()
      eq(out.status, 'limit_reached', 'status')
      eq(out.record.limit_reason, 'tool iteration limit (1) reached', 'reason')
    },
  },
  {
    name: 'the wallclock timeout cancels a running tool',
    async run(libs) {
      const cfg = llmContext({ timeout: 1, tools: { enabled: true, tools: [{ name: 'slow_tool' }] } })
      const { run } = await startRun(libs, [{ tool_calls: [{ name: 'slow_tool', args: {} }] }], { cfg })
      const out = await run.execute()
      eq(out.status, 'limit_reached', 'status')
      eq(out.record.limit_reason, 'total execution time limit (1s) reached', 'reason')
    },
  },
  {
    name: 'an interrupt during inference stops the run and execute continues it',
    async run(libs) {
      const { run, llm } = await startRun(libs, [{ hang: true }, { text: 'answer after the interrupt' }])
      const pending = run.execute()
      await sleep(20)
      run.interrupter().interrupt('user pressed stop')
      const first = await pending
      eq(first.status, 'interrupted', 'interrupted')
      eq(first.record.interrupt_reason, 'user pressed stop', 'reason')
      const second = await run.execute()
      eq(second.status, 'completed', 'continued in the same page')
      eq(second.record.result.raw, 'answer after the interrupt', 'result')
      eq(llm.calls, 2, 'the interrupted inference was retried')
    },
  },
  {
    name: 'an interrupt during a tool call pairs it as cancelled',
    async run(libs) {
      const page = notesPage(libs.x)
      page.state.hang = 'clear_note'
      const { run, llm } = await startRun(libs, [{ tool_calls: [{ name: 'clear_note', args: {} }] }, { text: 'stopped' }], { page })
      const pending = run.execute()
      await sleep(30)
      run.interrupter().interrupt('stop')
      eq((await pending).status, 'interrupted', 'interrupted')
      page.state.hang = undefined
      const out = await run.execute()
      eq(out.status, 'completed', 'completed')
      const tool = llm.requests[1].messages.find((m: any) => m.role === 'tool')
      ok(tool.content[0].content[0].text.startsWith('[cancelled, result unknown]'), 'abandoned call is effect-unknown')
      eq(page.state.calls, ['clear_note'], 'not run again')
    },
  },
  {
    name: 'export / resume re-runs idempotent calls and gives the rest describeInterrupted',
    async run(libs) {
      const { x } = libs
      for (const [tool, args, expectRerun] of [['append_note', { text: 'X' }, true], ['clear_note', {}, false]] as const) {
        const page = notesPage(x)
        page.state.note = 'old'
        page.state.hang = tool
        const store = new x.MemoryRunStore()
        const { run } = await startRun(libs, [{ tool_calls: [{ name: tool, args, call_id: 'c1' }] }], { page, store })
        const abandoned = run.execute()
        await sleep(30)
        const exported = await x.exportRun(store, run.runId)
        eq(exported.record.status, 'running', 'the page went away while the call ran')
        run.interrupter().interrupt('page closed')
        await abandoned
        // a new page: same scene, new runtime, new store
        const page2 = notesPage(x)
        page2.state.note = page.state.note
        page2.state.applied = page.state.applied
        const store2 = new x.MemoryRunStore()
        await x.importRun(store2, exported)
        const llm2 = new libs.dev.ScriptedLlmClient([{ text: 'finished after resume' }])
        const deps2 = { llm: llm2, runtime: page2.runtime, store: store2 }
        const start = await x.XllmRun.resume(store2, run.runId, {}, deps2)
        eq(start.kind, 'run', 'resumable')
        const out = await start.run.execute()
        eq(out.status, 'completed', `${tool}: completed`)
        const obs = llm2.requests[0].messages.filter((m: any) => m.role === 'tool').pop().content[0].content[0].text
        if (expectRerun) {
          eq(page2.state.calls, [tool], 'idempotent call ran again')
          eq(page2.state.note, 'oldX', 'appended once')
          eq(obs, 'appended', 'its real result')
        } else {
          eq(page2.state.calls, [], 'not run again')
          eq(obs, '[unresolved: result unknown] The note was not deleted.', 'describeInterrupted text')
        }
        eq(out.record.usage.llm_requests, 1, 'a killed executor segment never wrote its count; the new one adds its own')
      }
    },
  },
  {
    name: 'a run of another scene cannot be resumed',
    async run(libs) {
      const { x } = libs
      const store = new x.MemoryRunStore()
      const { run } = await startRun(libs, [{ error: { kind: 'provider', failure: 'transient', message: 'busy' } }], { store })
      eq((await run.execute()).status, 'paused', 'paused on a transient error')
      const other = notesPage(x, 'demo.other')
      const deps = { llm: new libs.dev.ScriptedLlmClient([]), runtime: other.runtime, store }
      await rejects(x.XllmRun.resume(store, run.runId, {}, deps), 'runtime_mismatch', 'scene mismatch')
    },
  },
  {
    name: 'a paused run takes a new input and continues',
    async run(libs) {
      const { x, dev } = libs
      const store = new x.MemoryRunStore()
      const { run, page } = await startRun(libs, [{ error: { kind: 'provider', failure: 'transient', message: 'busy' } }], { store })
      const paused = await run.execute()
      eq(paused.status, 'paused', 'paused')
      eq(paused.record.last_error.kind, 'provider_transient', 'kind')
      const llm = new dev.ScriptedLlmClient([{ text: 'continued' }])
      const start = await x.XllmRun.resume(store, run.runId, {}, { llm, runtime: page.runtime, store })
      await start.run.injectInput('Please also say hi.')
      const out = await start.run.execute()
      eq(out.status, 'completed', 'completed')
      const last = llm.requests[0].messages[llm.requests[0].messages.length - 1]
      eq(last.content[0].text, 'Please also say hi.', 'injected input reached the model')
    },
  },
  {
    name: 'configuration can only narrow what the page gives',
    async run(libs) {
      const { x } = libs
      const page = notesPage(x)
      const deps = { llm: new libs.dev.ScriptedLlmClient([]), runtime: page.runtime, store: new x.MemoryRunStore(), hostPromptSections: 'NONE' }
      const cases: [string, unknown][] = [
        ['group:bash', { tools: { enabled: true, tools: [{ groupname: 'bash' }] } }],
        ['mcp', { tools: { enabled: true, tools: [{ mcp: 'http://x' }] } }],
        ['runtime.kind native', { runtime: { kind: 'native' } }],
        ['provider.type openai', { provider: { type: 'openai' }, model: 'gpt' }],
        ['provider.base_url', { provider: { type: 'buckyos', base_url: 'https://evil' } }],
        ['provider.on_behalf_of', { provider: { on_behalf_of: { user_id: 'bob' } } }],
        ['shell', { tools: { enabled: true, shell: { timeout_ms: 1 } } }],
        ['tool the page did not give', { tools: { enabled: true, tools: [{ name: 'format_disk' }] } }],
      ]
      for (const [what, cfg] of cases) {
        await rejects(x.XllmTask.prepareHosted(cfg, 'demo.notes', 'sys', deps), 'capability', what)
      }
      await rejects(x.XllmTask.prepareHosted({ model: 'llm.chat', bogus: 1 }, 'demo.notes', 'sys', deps), 'config', 'unknown key')
      await rejects(x.XllmTask.prepareHosted({ model: 'llm.chat' }, 'demo.notes', 'Hi {{env.SECRET}}', deps), 'template', 'env not given by the page')
      const narrowed = await x.XllmTask.prepareHosted({ tools: { enabled: true, tools: [{ name: 'get_selection' }] } }, 'demo.notes', 'sys', deps)
      eq(narrowed.config.tools.native.map((t: any) => t.name), ['get_selection'], 'only the selected tool')
    },
  },
  {
    name: 'an imported run naming a tool the page lacks is not resumable',
    async run(libs) {
      const { x } = libs
      const store = new x.MemoryRunStore()
      const { run, page } = await startRun(libs, [{ error: { kind: 'provider', failure: 'transient', message: 'busy' } }], { store })
      await run.execute()
      const exported = await x.exportRun(store, run.runId)
      exported.record.config.tools.native.push({ name: 'format_disk', description: 'x', args_schema: {}, source: 'name:format_disk' })
      const store2 = new x.MemoryRunStore()
      await x.importRun(store2, exported)
      await rejects(x.XllmRun.resume(store2, run.runId, {}, { llm: new libs.dev.ScriptedLlmClient([]), runtime: page.runtime, store: store2 }),
        'not_resumable', 'tool outside the scene')
    },
  },
  {
    name: 'old formats and host-assembled runs are not resumable',
    async run(libs) {
      const { x } = libs
      const store = new x.MemoryRunStore()
      const { run, page } = await startRun(libs, [{ error: { kind: 'provider', failure: 'transient', message: 'busy' } }], { store })
      await run.execute()
      const original = await x.exportRun(store, run.runId)
      const edits: [string, (e: any) => void][] = [
        ['record version 6', e => { e.record.version = 6 }],
        ['snapshot version 5', e => { for (const [, s] of e.snapshots) s.state.snapshot_version = 5 }],
        ['assembled by a host', e => { e.record.host = { assembled_by: 'opendan' } }],
        ['handed over', e => { e.record.handover = { next_behavior: 'plan', at_ms: 1 } }],
      ]
      for (const [what, edit] of edits) {
        const exported = JSON.parse(JSON.stringify(original))
        edit(exported)
        const store2 = new x.MemoryRunStore()
        await x.importRun(store2, exported)
        await rejects(x.XllmRun.resume(store2, run.runId, {}, { llm: new libs.dev.ScriptedLlmClient([]), runtime: page.runtime, store: store2 }),
          'not_resumable', what)
      }
    },
  },
  {
    name: 'the JSON reply contract repairs once',
    async run(libs) {
      const cfg = llmContext({ tools: false, json_schema: { type: 'object', required: ['n'], properties: { n: { type: 'integer' } } } })
      const { run, llm } = await startRun(libs, [{ text: 'here you go: 3' }, { text: '{"n": 3}' }], { cfg })
      const out = await run.execute()
      eq(out.status, 'completed', 'status')
      eq(out.record.result.json_valid, true, 'json valid')
      ok(llm.requests[1].messages[llm.requests[1].messages.length - 1].content[0].text.startsWith('Your reply does not meet the required format'), 'repair message')
      eq(llm.requests[0].force_json, true, 'structured output requested')
    },
  },
  {
    name: 'AICC errors map to run states without reading message text',
    async run(libs) {
      const { x } = libs
      const cases: [string, () => any, string, string][] = [
        ['http 401', () => { throw rpcError('RPC call error: 401', 'http_error', { status: 401 }) }, 'paused', 'credentials'],
        ['http 403', () => { throw rpcError('RPC call error: 403', 'http_error', { status: 403 }) }, 'paused', 'credentials'],
        ['quota', () => { throw rpcError('denied', 'quota_exhausted', { code: 'quota_exhausted', message: 'no tokens' }) }, 'failed', 'quota_exhausted'],
        ['quota_unavailable', () => { throw rpcError('later', 'quota_unavailable', {}) }, 'paused', 'provider_transient'],
        ['http 504', () => { throw rpcError('RPC call error: 504', 'http_error', { status: 504 }) }, 'paused', 'provider_transient'],
        ['http 500', () => { throw rpcError('RPC call error: 500', 'http_error', { status: 500 }) }, 'failed', 'provider_error'],
        ['transport', () => { throw rpcError('RPC call failed: offline', 'transport') }, 'paused', 'provider_transient'],
        ['no code (token text)', () => { throw rpcError('RPC call error: Invalid token: expired') }, 'failed', 'provider_error'],
        ['status failed, context', () => ({ task_id: 't', status: 'failed', error: { code: 'context_length_exceeded', message: 'too long' } }), 'failed', 'context_capacity'],
        ['status failed, retriable', () => ({ task_id: 't', status: 'failed', error: { code: 'provider_error', message: 'x', retriable: true } }), 'paused', 'provider_transient'],
        ['status running', () => ({ task_id: 't', status: 'running' }), 'failed', 'provider_permanent'],
      ]
      for (const [what, behaviour, status, kind] of cases) {
        const page = notesPage(x)
        const deps = { llm: new x.AiccLlmClient(fakeAicc(behaviour)), runtime: page.runtime, store: new x.MemoryRunStore(), hostPromptSections: 'NONE' }
        const task = await x.XllmTask.prepareHosted({ model: 'llm.chat' }, 'demo.notes', 'sys', deps)
        const out = await (await x.XllmRun.start(task, deps, { input: 'hi' })).execute()
        eq([out.status, out.record.last_error?.kind], [status, kind], what)
      }
    },
  },
  {
    name: 'AICC requests: logical models use helper.llm_chat, exact models chat.completions.create',
    async run(libs) {
      const { x } = libs
      const seen: [string, any][] = []
      const aicc = fakeAicc((method, req) => {
        seen.push([method, req])
        return { task_id: 't', status: 'succeeded', message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
          usage: { total_tokens: 5 }, route_trace: { attempts: [], final_model: 'gpt-x@openai' } }
      })
      for (const model of ['llm.chat', 'gpt-x@openai']) {
        const page = notesPage(x)
        const deps = { llm: new x.AiccLlmClient(aicc), runtime: page.runtime, store: new x.MemoryRunStore(), hostPromptSections: 'NONE' }
        const task = await x.XllmTask.prepareHosted({ model }, 'demo.notes', 'sys', deps)
        const out = await (await x.XllmRun.start(task, deps, { input: 'hi' })).execute()
        eq(out.status, 'completed', model)
        eq(out.record.result.response_model, 'gpt-x@openai', 'response model from the route trace')
      }
      eq(seen.map(s => s[0]), ['helper.llm_chat', 'chat.completions.create'], 'methods')
      eq(seen[0][1].logical_model, 'llm.chat', 'logical model')
      eq(seen[1][1].exact_model, 'gpt-x@openai', 'exact model')
      eq(seen[0][1].tools, undefined, 'no tools advertised when tools are off')
    },
  },
  {
    name: 'a pending result is waited for in the call, check_after only shortening the wait',
    async run(libs) {
      const { x, dev } = libs
      const tasks = fakeTasks(30)
      const runtime = envelopePage(x, () => ({ agent_tool_protocol: '1', status: 'pending', task_id: 't1', check_after: 120, summary: 'started' }))
      const llm = new dev.ScriptedLlmClient([{ tool_calls: [{ name: 'start_job', args: {} }] }, { text: 'job done' }])
      const deps = { llm, runtime, store: new x.MemoryRunStore(), hostPromptSections: 'NONE', tasks }
      const cfg = { runtime: { kind: 'site', task_wait_ms: 5000 }, tools: { enabled: true } }
      const task = await x.XllmTask.prepareHosted(cfg, 'demo.tasks', 'sys', deps)
      const out = await (await x.XllmRun.start(task, deps, { input: 'run the job' })).execute()
      eq(out.status, 'completed', 'status')
      ok(tasks.waits[0] <= 5000 && tasks.waits[0] > 4000, `waited within the 5 s budget, not check_after's 120 s: ${tasks.waits[0]}`)
      const tool = llm.requests[1].messages.find((m: any) => m.role === 'tool').content[0].content[0].text
      eq(tool, 'task output', 'the finished task result')
    },
  },
  {
    name: 'a task still running at the reply pauses the run (tasks_running)',
    async run(libs) {
      const { x, dev } = libs
      const tasks = fakeTasks(60_000)
      const runtime = envelopePage(x, () => ({ agent_tool_protocol: '1', status: 'pending', task_id: 't1', check_after: 0.05 }))
      const llm = new dev.ScriptedLlmClient([{ tool_calls: [{ name: 'start_job', args: {} }] }, { text: 'started it' }])
      const deps = { llm, runtime, store: new x.MemoryRunStore(), hostPromptSections: 'NONE', tasks }
      const task = await x.XllmTask.prepareHosted({ tools: { enabled: true } }, 'demo.tasks', 'sys', deps)
      const out = await (await x.XllmRun.start(task, deps, { input: 'run the job' })).execute()
      eq([out.status, out.record.last_error.kind], ['paused', 'tasks_running'], 'paused for the task')
      const tool = llm.requests[1].messages.find((m: any) => m.role === 'tool').content[0].content[0].text
      ok(tool.startsWith('task t1 is still running (0s): long job\nCall `wait_task` with task_id="t1"'), tool)
    },
  },
  {
    name: 'once hints show once per run and are kept in run.json',
    async run(libs) {
      const { x, dev } = libs
      const runtime = envelopePage(x, () => ({
        agent_tool_protocol: '1', status: 'success', summary: 's', output: 'body', hints: [{ text: 'tip', once: 'tip.key' }, { text: 'always' }],
      }))
      const llm = new dev.ScriptedLlmClient([
        { tool_calls: [{ name: 'start_job', args: {} }] }, { tool_calls: [{ name: 'start_job', args: {} }] }, { text: 'ok' },
      ])
      const deps = { llm, runtime, store: new x.MemoryRunStore(), hostPromptSections: 'NONE' }
      const task = await x.XllmTask.prepareHosted({ tools: { enabled: true } }, 'demo.tasks', 'sys', deps)
      const out = await (await x.XllmRun.start(task, deps, { input: 'go' })).execute()
      const tools = llm.requests[2].messages.filter((m: any) => m.role === 'tool').map((m: any) => m.content[0].content[0].text)
      eq(tools[0], '<output>\nbody\n</output>\n<runtime_hints>\n- tip\n- always\n</runtime_hints>', 'first time')
      eq(tools[1], '<output>\nbody\n</output>\n<runtime_hints>\n- always\n</runtime_hints>', 'second time')
      eq(out.record.hints_once, ['tip.key'], 'hints_once')
    },
  },
  {
    name: 'prepare assembles sections, the group default task, materials and stdin',
    async run(libs) {
      const { x, dev } = libs
      const page = notesPage(x)
      const llm = new dev.ScriptedLlmClient([{ text: 'summary' }])
      const deps = { llm, runtime: page.runtime, store: new x.MemoryRunStore() }
      const cfg = {
        prompt: {
          select: 'sum',
          groups: { sum: { default_user: 'Summarize the material for {{env.USER_NAME}}.', sections: { role: 'You summarize.' } } },
          sections: { 100: 'Plain text only.' },
        },
      }
      const task = await x.XllmTask.prepare(cfg, 'notes.llm_context', {
        attachments: [{ kind: 'text', label: 'a.txt', text: 'alpha' }], stdin: 'piped',
      }, {}, deps)
      eq(task.prompt.user_request, 'Summarize the material for alice.', 'group default task')
      eq(task.input.request_source, 'group_default', 'request source')
      eq(task.input.attachments[0].kind, 'file', 'material record')
      ok(task.prompt.system_prompt.startsWith('## role\nYou summarize.\n\n## contexts\n'), task.prompt.system_prompt.slice(0, 80))
      ok(task.prompt.system_prompt.includes('## output_format\nPlain text only.\n'), 'section 100')
      ok(task.prompt.system_prompt.includes('## runtime_protocol\nYou are running inside xllm (xllm/2)'), 'runtime protocol')
      const out = await (await x.XllmRun.start(task, deps)).execute()
      eq(out.status, 'completed', 'status')
      const user = llm.requests[0].messages[1].content.map((c: any) => c.text)
      eq(user, ['Summarize the material for alice.', '<material name="a.txt">\nalpha\n</material>', '<stdin>\npiped\n</stdin>'], 'user parts')
    },
  },
  {
    name: 'images go through the file model when one is configured',
    async run(libs) {
      const { x, dev } = libs
      const page = notesPage(x)
      const llm = new dev.ScriptedLlmClient([{ text: 'a red square' }, { text: 'It is red.' }])
      const deps = { llm, runtime: page.runtime, store: new x.MemoryRunStore() }
      const task = await x.XllmTask.prepare({ file_model: 'llm.vision' }, 'v.llm_context', {
        user: 'What color?', attachments: [{ kind: 'image', source: { kind: 'base64', mime: 'image/png', data_base64: 'iVBORw0KGgo=' }, label: 'sq.png' }],
      }, {}, deps)
      ok(task.fileStage, 'file stage planned')
      const out = await (await x.XllmRun.start(task, deps)).execute()
      eq(out.status, 'completed', 'status')
      eq(out.record.file_model_stage.analysis, 'a red square', 'analysis recorded')
      eq(out.record.usage.llm_requests, 2, 'both inferences counted')
      eq(llm.requests[0].model_alias, 'llm.vision', 'file model first')
      ok(llm.requests[0].messages[1].content.some((c: any) => c.type === 'image'), 'the file model gets the image')
      const main = llm.requests[1].messages[1].content
      ok(!main.some((c: any) => c.type === 'image'), 'the main model gets no image')
      eq(main[main.length - 1].text, '<image_analysis model="llm.vision">\na red square\n</image_analysis>', 'analysis block')
    },
  },
  {
    name: 'the OpenAI dev client: request shape and error table',
    async run(libs) {
      const { x, dev } = libs
      const seen: any[] = []
      const reply = (status: number, body: unknown) => async (_url: string, init: any) => {
        seen.push(JSON.parse(init.body))
        return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
      }
      const ok200 = reply(200, {
        model: 'gpt-x', usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        choices: [{ finish_reason: 'stop', message: { content: null, tool_calls: [{ id: 'c1', function: { name: 'get_selection', arguments: '{}' } }] } }],
      })
      const page = notesPage(x)
      const llm = new dev.OpenAiLlmClient({ apiKey: 'k', fetch: ok200 })
      const r = await llm.infer({ messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], model_alias: 'gpt-x', fallbacks: [],
        force_json: false, disable_capabilities: [], tool_specs: page.runtime.tools.size ? [{ name: 'get_selection', description: 'd', args_schema: {} }] : [],
        allow_tool_calls: true, signal: new AbortController().signal })
      eq(r.message.content[0], { type: 'tool_use', call_id: 'c1', name: 'get_selection', args: {} }, 'tool call parsed')
      eq(r.usage.total_tokens, 5, 'usage')
      eq(seen[0].tools[0].function.name, 'get_selection', 'tools advertised')
      for (const [status, body, failure] of [
        [401, '{}', { refused: { code: 'credentials' } }], [403, '', { refused: { code: 'credentials' } }], [400, '{}', 'permanent'],
        [400, '{"error":{"code":"context_length_exceeded"}}', 'context_limit'], [429, '', 'transient'], [503, '', 'transient'], [418, '', 'unknown'],
      ] as [number, string, unknown][]) {
        eq(dev.openaiHttpFailure(status, body), failure, `http ${status}`)
      }
    },
  },
  {
    name: 'a terminal run only returns its record',
    async run(libs) {
      const { x } = libs
      const store = new x.MemoryRunStore()
      const { run, page } = await startRun(libs, [{ text: 'final' }], { store })
      await run.execute()
      const deps = { llm: new libs.dev.ScriptedLlmClient([]), runtime: page.runtime, store }
      const start = await x.XllmRun.resume(store, run.runId, {}, deps)
      eq(start.kind, 'terminal', 'terminal')
      await rejects(x.XllmRun.resume(store, run.runId, { max_tool_iterations: 9 }, deps), 'run_terminal', 'limits on a terminal run')
    },
  },
  {
    name: 'a behavior run parses XML steps; native calls run inside the step',
    async run(libs) {
      const { x, dev } = libs
      const page = notesPage(x)
      const final = '<response><intent>done</intent><report end="true">Copied: Pick me</report></response>'
      const llm = new dev.ScriptedLlmClient([
        { text: '<response><intent>read the selection</intent></response>', tool_calls: [{ name: 'get_selection', args: {} }] },
        { text: final },
      ])
      const deps = { llm, runtime: page.runtime, store: new x.MemoryRunStore(), hostPromptSections: { capabilities: false, cmd_manual: false, runtime_protocol: true } }
      const task = await x.XllmTask.prepareHosted(llmContext({ loop_model: 'behavior' }), 'demo.notes', 'You copy selections.', deps)
      const out = await (await x.XllmRun.start(task, deps, { input: 'Copy the selection.' })).execute()
      eq(out.status, 'completed', `status (${out.record.last_error?.message ?? ''})`)
      eq(out.record.result.raw, final, 'result is the final reply')
      const msgs = llm.requests[1].messages
      const last = msgs[msgs.length - 1]
      eq([last.role, last.content[0].content[0].text], ['tool', 'Pick me'], 'the tool result is in the step transcript')
      ok(msgs[0].content[0].text.includes('## runtime_protocol'), 'the runtime protocol defines the step shape')
      eq(out.record.latest_snapshot_idx >= 2, true, 'snapshots committed')
    },
  },
  {
    name: 'a context over the window is compacted and the run continues',
    async run(libs) {
      const { x } = libs
      const page = notesPage(x)
      page.state.selection = 'long selection '.repeat(5000)
      const summary = JSON.stringify({ summary: 'The selection was read; it repeats "long selection".', verbatim: [], memory_candidates: [] })
      const { run, llm, events } = await startRun(libs, [
        { tool_calls: [{ name: 'get_selection', args: {} }] },
        { text: summary },
        { text: 'Done after compaction.' },
      ], { page, cfg: llmContext({ context_window: 20000 }) })
      const out = await run.execute()
      eq(out.status, 'completed', `status (${out.record.last_error?.message ?? ''})`)
      eq(out.record.compactions, 1, 'compactions')
      eq(out.record.usage.llm_requests, 3, 'the summarizer call is counted')
      eq(llm.requests[1].model_alias, 'llm.summarize', 'summary model')
      const last = JSON.stringify(llm.requests[2].messages)
      ok(!last.includes('long selection long selection long selection'), 'the tool result is gone from the history')
      ok(last.includes('The selection was read'), 'the summary is in the history')
      ok(events.some(e => e.kind === 'phase' && e.phase === 'compacting_context'), 'compacting phase observed')
    },
  },
  {
    name: 'a context that compaction cannot shrink fails with context_capacity',
    async run(libs) {
      const { x, dev } = libs
      const page = notesPage(x)
      const llm = new dev.ScriptedLlmClient([])
      const deps = { llm, runtime: page.runtime, store: new x.MemoryRunStore(), hostPromptSections: 'NONE' }
      const task = await x.XllmTask.prepareHosted(llmContext({ context_window: 20000 }), 'demo.notes', 'rules '.repeat(15000), deps)
      const out = await (await x.XllmRun.start(task, deps, { input: 'go' })).execute()
      eq(out.status, 'failed', 'status')
      eq(out.record.last_error.kind, 'context_capacity', 'kind')
      eq(out.record.compactions, 3, 'three compactions tried')
      eq(llm.calls, 0, 'nothing was sent to the model')
    },
  },
  {
    name: 'a run saved at the context limit compacts first when it is resumed',
    async run(libs) {
      const { x, dev } = libs
      const page = notesPage(x)
      page.state.selection = 'long selection '.repeat(5000)
      const summary = JSON.stringify({ summary: 'The selection was read.', verbatim: [], memory_candidates: [] })
      const store = new x.MemoryRunStore()
      const { run } = await startRun(libs, [
        { tool_calls: [{ name: 'get_selection', args: {} }] },
        { delay_ms: 150, then: { text: summary } },
      ], { page, store, cfg: llmContext({ context_window: 20000 }) })
      const abandoned = run.execute()
      await sleep(40)
      const exported = await x.exportRun(store, run.runId)
      const latest = exported.snapshots.find(([i]: [number]) => i === exported.record.latest_snapshot_idx)
      ok(latest?.[1].state.suspended, 'the saved snapshot is suspended at the context limit')
      run.interrupter().interrupt('page closed')
      await abandoned
      const store2 = new x.MemoryRunStore()
      await x.importRun(store2, exported)
      const llm2 = new dev.ScriptedLlmClient([{ text: summary }, { text: 'done after resume' }])
      const start = await x.XllmRun.resume(store2, run.runId, {}, { llm: llm2, runtime: notesPage(x).runtime, store: store2 })
      const out = await start.run.execute()
      eq(out.status, 'completed', `status (${out.record.last_error?.message ?? ''})`)
      eq(llm2.requests.map((r: any) => r.model_alias), ['llm.summarize', 'llm.chat'], 'compaction before the next inference')
      eq(out.record.compactions, 1, 'compactions')
    },
  },
  {
    name: 'a checkpoint the store cannot write pauses the run (storage)',
    async run(libs) {
      const { x } = libs
      const store = new x.MemoryRunStore()
      const put = store.putSnapshot.bind(store)
      let writes = 0
      store.putSnapshot = async (id: string, s: unknown) => {
        if (++writes > 1) throw new Error('quota exceeded')
        return put(id, s)
      }
      const { run } = await startRun(libs, [{ tool_calls: [{ name: 'get_selection', args: {} }] }, { text: 'ok' }], { store })
      const out = await run.execute()
      eq([out.status, out.record.last_error.kind, out.record.last_error.recoverable], ['paused', 'storage', true], 'paused on storage')
    },
  },
  {
    name: 'resume limits: a higher max_tool_iterations adds only the difference',
    async run(libs) {
      const { x, dev } = libs
      const store = new x.MemoryRunStore()
      const { run, page } = await startRun(libs, [
        { tool_calls: [{ name: 'get_selection', args: {} }] },
        { error: { kind: 'provider', failure: 'transient', message: 'busy' } },
      ], { store, cfg: llmContext({ max_tool_iterations: 2 }) })
      eq((await run.execute()).status, 'paused', 'paused after one tool batch')
      const llm = new dev.ScriptedLlmClient([{ text: 'ok' }])
      const start = await x.XllmRun.resume(store, run.runId, { max_tool_iterations: 5 }, { llm, runtime: page.runtime, store })
      const out = await start.run.execute()
      eq(out.status, 'completed', 'completed')
      eq(out.record.config.limits.max_tool_iterations, 5, 'new limit recorded')
      const snap = await store.getSnapshot(run.runId, out.record.latest_snapshot_idx)
      eq(snap.state.tool_iterations_left, 4, 'new total minus the one consumed')
    },
  },
  {
    name: 'a message cannot be injected into an unfinished tool batch',
    async run(libs) {
      const { x, dev } = libs
      const page = notesPage(x)
      page.state.hang = 'append_note'
      const store = new x.MemoryRunStore()
      const { run } = await startRun(libs, [{ tool_calls: [{ name: 'append_note', args: { text: 'X' } }] }], { page, store })
      const abandoned = run.execute()
      await sleep(30)
      const exported = await x.exportRun(store, run.runId)
      run.interrupter().interrupt('page closed')
      await abandoned
      const store2 = new x.MemoryRunStore()
      await x.importRun(store2, exported)
      const start = await x.XllmRun.resume(store2, run.runId, {}, { llm: new dev.ScriptedLlmClient([{ text: 'ok' }]), runtime: notesPage(x).runtime, store: store2 })
      await rejects(start.run.injectInput('also this'), 'input', 'mid-batch injection')
      eq((await start.run.execute()).status, 'completed', 'resumes without a message')
    },
  },
  {
    name: 'context_yield_ratio without context_window warns',
    async run(libs) {
      const { events, run } = await startRun(libs, [{ text: 'ok' }], { cfg: llmContext({ context_yield_ratio: 0.5 }) })
      await run.execute()
      ok(events.some(e => e.kind === 'warning' && e.message.startsWith('context_yield_ratio (from')), 'warning event')
    },
  },
  {
    name: 'a failing summarizer fails the run with context_compaction',
    async run(libs) {
      const page = notesPage(libs.x)
      page.state.selection = 'long selection '.repeat(5000)
      const { run } = await startRun(libs, [
        { tool_calls: [{ name: 'get_selection', args: {} }] },
        { error: { kind: 'provider', failure: 'transient', message: 'down' } },
      ], { page, cfg: llmContext({ context_window: 20000 }) })
      const out = await run.execute()
      eq(out.status, 'failed', 'status')
      eq(out.record.last_error.kind, 'context_compaction', 'kind')
      eq(out.record.last_error.message, 'context compaction failed: llm provider failed (Transient): down', 'message, prefixed once')
      eq(out.record.compactions, 0, 'no compaction counted')
    },
  },
]
