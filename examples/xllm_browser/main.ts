// xllm in a browser page: build a runtime for this page, run the loop, stop
// it, take it back from an exported run, and see what configuration may not
// do. Opens without a Zone (a scripted model); `?llm=aicc` uses the page's
// AICC session after signing in.
//
// A runtime is not a tool list. What it adds, and where it is in this file:
//   identity          scene → descriptor.target; a run resumes only in the same scene  (buildNotesRuntime: `scene`)
//   bound to a run    every call gets ctx = { run_id, call_id, signal }; config can only pick tools  (append_note)
//   side-effect ledger `idempotent` calls re-run on resume, others report via describeInterrupted  (clear_note)
//   environment       RuntimeInfo from scene / origin / hostname → {{runtime.*}}, {{env.*}} only from `env`

import {
  AiccLlmClient, MemoryHintLedger, MemoryRunStore, XllmError, XllmRun, XllmTask, createSiteRuntime, exportRun, importRun,
} from 'buckyos/xllm'
import type {
  AgentRuntime, AiToolCall, JsonValue, LlmClient, Observation, RunBinding, RunEvent, RunToolManager, RuntimeInfo, SiteRuntime,
  ToolCallCtx, ToolsConfig, XllmDeps,
} from 'buckyos/xllm'
import { ScriptedLlmClient } from 'buckyos/xllm/dev'
import { appendNoteOnce, clearNote, currentSelection, getNote, onNoteChange, resetDemoState } from './notes'

// ---------------------------------------------------------------- the runtime

/** Holding a call open simulates "the page went away while it ran" (demo 3). */
const hold = { tool: undefined as string | undefined }
const held = (name: string) => (hold.tool === name ? new Promise<never>(() => {}) : Promise.resolve())

export function buildNotesRuntime(scene = 'demo.notes'): SiteRuntime {
  return createSiteRuntime({
    scene,
    origin: location.origin,
    hostname: location.hostname,
    env: { PAGE_TITLE: document.title },
    tools: {
      get_selection: {
        spec: { description: 'The text selected on this page', args_schema: { type: 'object', properties: {} } },
        idempotent: true,
        call: async () => {
          await held('get_selection')
          return currentSelection() || (document.getElementById('sample')?.textContent ?? '')
        },
      },
      append_note: {
        spec: {
          description: 'Append text to the saved note',
          args_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        },
        // Deduplicated by call_id: running it again on resume does not write twice.
        idempotent: true,
        call: async ({ text }, { call_id }) => {
          await held('append_note')
          return appendNoteOnce(call_id, String(text))
        },
      },
      clear_note: {
        spec: { description: 'Delete the saved note', args_schema: { type: 'object', properties: {} } },
        call: async () => {
          await held('clear_note')
          clearNote()
          return 'cleared'
        },
        // Not idempotent: on resume the model is told what actually happened.
        describeInterrupted: () => (getNote() === null ? 'The note is already deleted.' : 'The note was not deleted.'),
      },
    },
  })
}

/**
 * The same contract implemented directly, without `createSiteRuntime`: a
 * site with its own dispatcher (AiWorkspace is expected to work like this).
 */
export class CounterRuntime implements AgentRuntime {
  count = 0
  private readonly scene = 'demo.counter'

  descriptor() {
    return {
      runtime_id: `site:${this.scene}`, kind: 'site', host: null, target: { origin: location.origin, scene: this.scene }, workdir: '/',
      capabilities: { tools: {}, network: true, os: 'browser' },
    }
  }

  config() {
    return { kind: 'site', env: {} }
  }

  async info(): Promise<RuntimeInfo> {
    return {
      id: `site:${this.scene}`, kind: 'site', os: 'browser', arch: '', hostname: location.hostname, shell: '', cwd: '/', tools: [],
      current_time: new Date().toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, target: this.descriptor().target,
      platform: 'browser', shell_kind: '', baseline: '',
    }
  }

  async open(ctx: { loop_model: string }, cfg: ToolsConfig) {
    const enabled = cfg.enabled ?? false
    const spec = { name: 'increment', description: 'Add 1 to the counter and return it', args_schema: { type: 'object', properties: {} } }
    for (const s of cfg.tools ?? []) {
      if (s.kind !== 'named' || s.name !== 'increment') throw XllmError.capability(`${JSON.stringify(s)} is not a tool of demo.counter`)
    }
    const runtime = this
    let recovering: string | undefined
    const hints = new MemoryHintLedger()
    const manager: RunToolManager = {
      bindRun() {},
      hintLedger: () => hints,
      clearDedup: () => hints.clear('dedup'),
      taskResolver: () => undefined,
      setRecovering(callId) {
        recovering = callId
      },
      artifacts: () => [],
      has: name => enabled && name === 'increment',
      listToolSpecs: () => (enabled ? [spec] : []),
      async callTool(call: AiToolCall, _ctx: ToolCallCtx): Promise<Observation> {
        if (call.name !== 'increment' || !enabled) return { kind: 'error', call_id: call.call_id, message: `no tool \`${call.name}\`` }
        if (recovering === call.call_id) {
          recovering = undefined
          return { kind: 'unresolved', call_id: call.call_id, reason: `the counter is ${runtime.count}; check it before incrementing again`, effect_unknown: true }
        }
        runtime.count += 1
        const text = String(runtime.count)
        return { kind: 'success', call_id: call.call_id, content: text, bytes: text.length, truncated: false }
      },
    }
    const tools = {
      enabled, filesystem_policy: 'workspace' as const, tools2actions: false, tool_sources: cfg.tools ?? [], action_sources: [],
      native: enabled ? [{ ...spec, source: 'name:increment' }] : [], actions: [], bash_tools: [],
      shell: { wait_ms: 25000, timeout_ms: 1800000, max_timeout_ms: 3600000 }, exec_enabled: false, sources: {},
    }
    void ctx
    return { tools, manager }
  }

  async describeInterrupted(_run: RunBinding, call: AiToolCall) {
    return `the ${call.name} call may have run; the counter is ${this.count}`
  }
}

// --------------------------------------------------------------- the model

const params = new URLSearchParams(location.search)
const useAicc = params.get('llm') === 'aicc'

async function aiccClient(): Promise<LlmClient> {
  const { initBuckyOS, login, buckyos } = await import('buckyos/browser')
  await initBuckyOS(params.get('appid') ?? 'buckyos-systest')
  await login()
  return new AiccLlmClient(buckyos.getAiccClient())
}

function scripted(script: ConstructorParameters<typeof ScriptedLlmClient>[0]): LlmClient {
  return new ScriptedLlmClient(script)
}

const LLM_CONTEXT: JsonValue = {
  provider: { type: 'buckyos' },
  model: 'llm.chat',
  loop_model: 'function_call',
  max_tool_iterations: 6,
  tools: { enabled: true, tools: [{ name: 'get_selection' }, { name: 'append_note' }, { name: 'clear_note' }] },
}

// --------------------------------------------------------------------- page

const log = document.getElementById('events') as HTMLOListElement
function show(text: string) {
  const li = document.createElement('li')
  li.textContent = text
  log.appendChild(li)
}
const observer = {
  onEvent(runId: string, e: RunEvent) {
    show(`${runId.slice(-6)} ${e.kind} ${JSON.stringify({ ...e, kind: undefined })}`)
  },
}
function renderNote() {
  const n = getNote()
  const el = document.getElementById('note')
  if (el) el.textContent = n === null ? '(deleted)' : n || '(empty)'
}
onNoteChange(renderNote)

let currentRun: XllmRun | undefined
document.getElementById('stop')?.addEventListener('click', () => currentRun?.interrupter().interrupt('stopped from the page'))

function check(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

async function rejectsWith(p: Promise<unknown>, kind: string) {
  try {
    await p
  } catch (e) {
    if (e instanceof XllmError && e.kind === kind) return e.message
    throw new Error(`expected ${kind}, got ${e instanceof Error ? e.message : String(e)}`)
  }
  throw new Error(`expected ${kind}`)
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** (1)+(2) Build the runtime, run the loop with live events. */
async function demoRun(): Promise<string> {
  resetDemoState()
  const runtime = buildNotesRuntime()
  const llm = useAicc ? await aiccClient() : scripted([
    { tool_calls: [{ name: 'get_selection', args: {} }] },
    { tool_calls: [{ name: 'append_note', args: { text: 'Pick me' } }] },
    { text: 'Saved the selection to the note.' },
  ])
  const deps: XllmDeps = { llm, runtime, store: new MemoryRunStore(), hostPromptSections: 'NONE', observer }
  const task = await XllmTask.prepareHosted(LLM_CONTEXT, 'demo.notes', 'You help the user take notes from this page "{{env.PAGE_TITLE}}".', deps)
  const run = await XllmRun.start(task, deps, { input: 'Append the selected text to my note.' })
  currentRun = run
  const out = await run.execute()
  check(out.status === 'completed', `run ended ${out.status}`)
  if (!useAicc) check(getNote() === 'Pick me', `note is ${getNote()}`)
  return `${out.status}: ${out.record.result?.raw}`
}

/** (3) Export a run the page left mid-call, resume it with a new runtime of the same scene. */
async function demoResume(): Promise<string> {
  const lines: string[] = []
  for (const [tool, args] of [['get_selection', {}], ['append_note', { text: '!' }], ['clear_note', {}]] as const) {
    resetDemoState()
    appendNoteOnce('seed', 'note')
    hold.tool = tool
    const store = new MemoryRunStore()
    const deps: XllmDeps = {
      llm: scripted([{ tool_calls: [{ name: tool, args, call_id: `held-${tool}` }] }]), runtime: buildNotesRuntime(), store,
      hostPromptSections: 'NONE', observer,
    }
    const run = await XllmRun.start(await XllmTask.prepareHosted(LLM_CONTEXT, 'demo.notes', 'Notes helper.', deps), deps, { input: `Use ${tool}.` })
    const abandoned = run.execute()
    await sleep(30)
    const exported = await exportRun(store, run.runId)
    run.interrupter().interrupt('the page went away')
    await abandoned
    hold.tool = undefined

    const store2 = new MemoryRunStore()
    await importRun(store2, exported)
    if (tool === 'clear_note') {
      const other = { llm: scripted([]), runtime: buildNotesRuntime('demo.other'), store: store2 }
      lines.push(`other scene: ${await rejectsWith(XllmRun.resume(store2, run.runId, {}, other), 'runtime_mismatch')}`)
    }
    const llm2 = new ScriptedLlmClient([{ text: 'done after resume' }])
    const deps2: XllmDeps = { llm: llm2, runtime: buildNotesRuntime(), store: store2, observer }
    const start = await XllmRun.resume(store2, run.runId, {}, deps2)
    check(start.kind === 'run', 'resumable')
    const out = start.kind === 'run' ? await start.run.execute() : start
    check(out.record.status === 'completed', `${tool}: ${out.record.status}`)
    const tools = llm2.requests[0].messages.filter(m => m.role === 'tool')
    const last = tools[tools.length - 1].content[0]
    const text = last.type === 'tool_result' && last.content[0].type === 'text' ? last.content[0].text : ''
    if (tool === 'clear_note') check(text === '[unresolved: result unknown] The note was not deleted.', `clear_note: ${text}`)
    else check(!text.startsWith('[unresolved'), `${tool} ran again: ${text}`)
    if (tool === 'append_note') check(getNote() === 'note!', `appended once: ${getNote()}`)
    lines.push(`${tool}: ${text}`)
  }
  return lines.join('\n')
}

/** (4) What configuration cannot do, and a call outside the run's tools. */
async function demoBoundaries(): Promise<string> {
  const deps: XllmDeps = { llm: scripted([]), runtime: buildNotesRuntime(), store: new MemoryRunStore(), hostPromptSections: 'NONE' }
  const lines: string[] = []
  const refused: [string, JsonValue][] = [
    ['group:bash', { tools: { enabled: true, tools: [{ groupname: 'bash' }] } }],
    ['runtime.kind native', { runtime: { kind: 'native' } }],
    ['provider.base_url', { provider: { type: 'buckyos', base_url: 'https://elsewhere.example' } }],
    ['a tool the page did not give', { tools: { enabled: true, tools: [{ name: 'format_disk' }] } }],
  ]
  for (const [what, cfg] of refused) lines.push(`${what}: ${await rejectsWith(XllmTask.prepareHosted(cfg, 'demo.notes', 'sys', deps), 'capability')}`)
  const llm = new ScriptedLlmClient([{ tool_calls: [{ name: 'clear_note', args: {} }] }, { text: 'I could not clear it.' }])
  const narrowDeps: XllmDeps = { ...deps, llm }
  const task = await XllmTask.prepareHosted({ tools: { enabled: true, tools: [{ name: 'get_selection' }] } }, 'demo.notes', 'sys', narrowDeps)
  const out = await (await XllmRun.start(task, narrowDeps, { input: 'Clear my note.' })).execute()
  const tool = llm.requests[1].messages.find(m => m.role === 'tool')?.content[0]
  const text = tool?.type === 'tool_result' && tool.content[0].type === 'text' ? tool.content[0].text : ''
  check(out.status === 'completed' && text.startsWith('tool `clear_note` is not available in this run'), text)
  lines.push(`call outside this run's tools: ${text}`)
  return lines.join('\n')
}

/** The directly implemented runtime runs the same loop. */
async function demoCustomRuntime(): Promise<string> {
  const runtime = new CounterRuntime()
  const deps: XllmDeps = {
    llm: scripted([{ tool_calls: [{ name: 'increment', args: {} }] }, { tool_calls: [{ name: 'increment', args: {} }] }, { text: 'Counted to 2.' }]),
    runtime, store: new MemoryRunStore(), hostPromptSections: 'NONE', observer,
  }
  const task = await XllmTask.prepareHosted({ tools: { enabled: true } }, 'demo.counter', 'Count.', deps)
  const out = await (await XllmRun.start(task, deps, { input: 'Count to two.' })).execute()
  check(out.status === 'completed' && runtime.count === 2, `counter ${runtime.count}`)
  return `${out.status}: counter = ${runtime.count}`
}

const DEMOS: [string, () => Promise<string>][] = [
  ['run', demoRun], ['resume', demoResume], ['boundaries', demoBoundaries], ['custom_runtime', demoCustomRuntime],
]

function setStatus(state: 'running' | 'passed' | 'failed', text: string) {
  const node = document.getElementById('status') as HTMLElement
  node.setAttribute('data-state', state)
  node.textContent = text
}

async function runAll(names: string[]) {
  setStatus('running', 'running')
  const results: { name: string; ok: boolean; detail: string }[] = []
  for (const [name, demo] of DEMOS) {
    if (!names.includes(name)) continue
    try {
      results.push({ name, ok: true, detail: await demo() })
    } catch (e) {
      results.push({ name, ok: false, detail: e instanceof Error ? e.stack ?? e.message : String(e) })
    }
  }
  const passed = results.every(r => r.ok)
  ;(document.getElementById('result') as HTMLElement).textContent = JSON.stringify({ passed, results }, null, 2)
  setStatus(passed ? 'passed' : 'failed', passed ? 'passed' : 'failed')
}

for (const [name] of DEMOS) document.getElementById(`demo-${name}`)?.addEventListener('click', () => runAll([name]))
renderNote()
if (params.get('auto') === '1') void runAll(DEMOS.map(([n]) => n))
else setStatus('passed', 'ready')
