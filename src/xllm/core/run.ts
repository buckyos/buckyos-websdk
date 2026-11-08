// One xllm run (Rust `XllmTask` / `XllmRun`): prepare → start → execute to a
// stopping point, every outcome boundary committed to the run store, the six
// waist outcomes mapped to `RunStatus`; resume takes a run back under the same
// checks as Rust (`RunBusy`, `NotResumable`, descriptor equality →
// `RuntimeMismatch`, calls without a result recovered by call id).

import type {
  AiContent, AiMessage, AiResponse, AiUsage, BudgetKind, EffectiveConfig, EffectiveTools, ExtractedValue, FileStagePlan, RunEvent, RunResultRecord, HostPromptSections, HostProtocolFlavor, InputRecord, JsonValue,
  LLMComputeError, LLMContextOutcome, LLMContextRequest, LLMContextSnapshot, LlmClient, LoopModel, PromptPlan, RunErrorRecord,
  ResumeFill, RunLimits, RunObserver, RunRecord, RunStatus, Tokenizer, ToolPolicy, ToolsConfig,
} from './types'
import { LLMContext, DEFAULT_WRAP_UP_ROUNDS } from './loop'
import type { CheckpointHook, LLMContextDeps } from './deps'
import { LLMComputeException, XllmError, computeErrorMessage, errorSource, refusedCode } from './errors'
import {
  DEFAULT_CONTEXT_YIELD_RATIO, DEFAULT_LLM_TIMEOUT_SECS, DEFAULT_MAX_CONSECUTIVE_ERRORS, DEFAULT_MAX_TOOL_ITERATIONS,
  DEFAULT_TIMEOUT_SECS, computeToolsConfig, mergeConfigLayers, parseLlmContextJson, taskWaitMs,
} from './config'
import { TemplateEnv, runtimeTemplateValues } from './prompt'
import { RUNTIME_PROTOCOL_VERSION, buildCmdManualSystemText, buildRulesSystemText, buildRuntimeProtocolFor } from './protocol'
import { RUN_RECORD_VERSION } from './store'
import type { RunLock, RunStore } from './store'
import { ObserverWorklog, noopObserver } from './observer'
import { canonicalJson, cloneJson, jsonEqual } from './json'
import { rustTrim, rustTrimEnd } from './rust_text'
import { ByteHeuristicTokenizer } from './tokenizer'
import { XllmActionParser } from './action_parser'
import { rewritableHistory } from './behavior_loop'
import { addRecordUsage, nowMs, textContent, textMessage } from './messages'
import { xmlEscape } from './xml'
import { extractResult, extractedAsJson } from './result'
import { checkSiteConfig, SITE_KIND } from './site_policy'
import { TimeoutLlmClient } from '../providers/timeout'
import { openRuntime } from './open_runtime'
import { prepareTask } from './prepare'
import type { TaskInput, TaskOverrides } from './prepare'
import type { AgentRuntime, RunToolManager } from '../runtime/types'
import type { RunningTaskResolver } from '../runtime/task_model'
import { HINT_NS_ONCE } from '../runtime/hints'
import { XmlStepRenderer } from '../runtime/step_renderer'
import { LlmSummarizeCompressor, compactionTargetTokens, summaryModel } from '../runtime/compress'

export const REFUSED_CREDENTIALS = 'credentials'

const MAX_COMPACTIONS = 3

/** `last_error` of a run whose context does not fit after the compactions it may make: the run fails. */
const CONTEXT_CAPACITY_EXHAUSTED = {
  kind: 'context_capacity',
  message: 'the task context still exceeds the model capacity after repeated compaction',
} as const

/**
 * Step renderer of a run: hosted runs render without wall-clock timestamps
 * (their history is a stable prefix), whoever executes them. Rust tells them
 * by `record.host`; a page executes its hosted task itself, so here it is the
 * task kind.
 */
function stepRenderer(hosted: boolean): XmlStepRenderer {
  return hosted ? new XmlStepRenderer().withoutTimestamps() : new XmlStepRenderer()
}
const REFUSED_QUOTA_EXHAUSTED = 'quota_exhausted'
const REFUSED_QUOTA_BUDGET_EXCEEDED = 'quota_budget_exceeded'
const REFUSED_RESOURCE_NOT_PERMITTED = 'resource_not_permitted'
const REFUSED_ATTRIBUTION_UNAVAILABLE = 'attribution_unavailable'

export const HOST_PROMPT_SECTIONS_ALL: HostPromptSections = { capabilities: true, cmd_manual: true, runtime_protocol: true }
export const HOST_PROMPT_SECTIONS_NONE: HostPromptSections = { capabilities: false, cmd_manual: false, runtime_protocol: false }

/** What a run executes with; `llm` and `runtime` come from the host (the page), never from configuration. */
export interface XllmDeps {
  llm: LlmClient
  runtime: AgentRuntime
  store: RunStore
  observer?: RunObserver
  tokenizer?: Tokenizer
  /** Sections a hosted run appends after the host's system text (default: all). */
  hostPromptSections?: HostPromptSections | 'NONE' | 'ALL'
  /** Opening of a hosted run's runtime protocol (default one-shot). */
  hostProtocol?: HostProtocolFlavor
  /** Process id written to run.json (0 where there is none, e.g. a browser page). */
  pid?: number
  /** Working-directory lock of tool-enabled runs (hosts with a filesystem). */
  lockWorkdir?(workdir: string, runId: string): Promise<RunLock | null>
  /** The control-side working directory still exists (hosts with a filesystem; default: yes). */
  workdirExists?(workdir: string): Promise<boolean>
  /** The run's task backend: pending tool results are waited for through it (runtime layer). */
  tasks?: RunningTaskResolver
}

function sectionsOf(deps: XllmDeps): HostPromptSections {
  const s = deps.hostPromptSections
  if (s === 'NONE') return HOST_PROMPT_SECTIONS_NONE
  if (s === undefined || s === 'ALL') return HOST_PROMPT_SECTIONS_ALL
  return s
}

/** A host-assembled task: the host's system text, xllm's sections after it (`prepare_hosted`). */
export interface HostedTask {
  readonly kind: 'hosted'
  readonly origin: string
  readonly workdir: string
  readonly config: EffectiveConfig
  readonly prompt: PromptPlan
  /** @internal */
  readonly manager: RunToolManager
}

/** A task xllm assembled itself (`prepare`): its user input is part of it. */
export interface PreparedTask {
  readonly kind: 'prepared'
  readonly workdir: string
  readonly config: EffectiveConfig
  readonly prompt: PromptPlan
  readonly input: InputRecord
  readonly summary: string
  readonly initialMessages: AiMessage[]
  readonly mainUserParts: AiContent[]
  readonly fileStage?: FileStagePlan
  /** @internal */
  readonly manager: RunToolManager
}

function contextYieldThreshold(limits: RunLimits) {
  return limits.context_window_tokens !== undefined
    ? { kind: 'ratio' as const, value: limits.context_yield_ratio ?? DEFAULT_CONTEXT_YIELD_RATIO } : null
}

function limitsOf(merged: ReturnType<typeof mergeConfigLayers>): RunLimits {
  const l: RunLimits = {
    max_tool_iterations: merged.max_tool_iterations ?? DEFAULT_MAX_TOOL_ITERATIONS,
    timeout_secs: merged.timeout ?? DEFAULT_TIMEOUT_SECS,
    llm_timeout_secs: merged.llm_timeout ?? DEFAULT_LLM_TIMEOUT_SECS,
  }
  if (merged.max_tokens !== undefined) l.max_tokens = merged.max_tokens
  if (merged.context_window !== undefined) l.context_window_tokens = merged.context_window
  if (merged.context_yield_ratio !== undefined) l.context_yield_ratio = merged.context_yield_ratio
  return l
}

/** The waist tool policy of a run (`hosted_request` / `build_initial_context`). */
export function runToolPolicy(cfg: EffectiveConfig): ToolPolicy {
  const native = cfg.tools.native.map(t => t.name)
  const actions = cfg.tools.actions.map(t => t.name)
  return {
    mode: native.length ? 'whitelist' : 'none',
    whitelist: native,
    action_mode: actions.length ? 'whitelist' : 'none',
    action_whitelist: actions,
    max_tool_iterations: cfg.tools.enabled ? cfg.limits.max_tool_iterations : 0,
    max_calls_per_round: 16,
    disable_capabilities: [...(cfg.disable_capabilities ?? [])],
    finish_grace_ms: 30_000,
  }
}

/** The waist request of a run. `hosted`: a JSON reply is a contract with one repair (`hosted_request`). */
export function runRequest(cfg: EffectiveConfig, owner: JsonValue, trace: string, objective: string, behaviorName: string,
  input: AiMessage[], hosted: boolean): LLMContextRequest {
  const req: LLMContextRequest = {
    owner,
    trace,
    objective,
    input,
    model_policy: {
      preferred: cfg.model, fallbacks: [], temperature: null, max_completion_tokens: cfg.limits.max_tokens ?? null, provider_options: null,
    },
    tool_policy: runToolPolicy(cfg),
    output: { kind: 'text' },
    budget: {
      max_total_tokens: null,
      max_completion_tokens: cfg.limits.max_tokens ?? null,
      max_wallclock_ms: cfg.limits.timeout_secs * 1000,
      max_cost_units: null,
      on_exhausted: 'fail',
      context_yield_threshold: contextYieldThreshold(cfg.limits),
      context_window_tokens: cfg.limits.context_window_tokens ?? null,
    },
    error_policy: { max_consecutive_errors: DEFAULT_MAX_CONSECUTIVE_ERRORS },
    forbid_next_behavior: false,
  }
  if (cfg.loop_model === 'behavior') req.behavior_name = behaviorName || 'xllm'
  if (cfg.json && cfg.loop_model === 'function_call') {
    req.output = hosted
      ? { kind: 'json', ...(cfg.json_schema !== undefined ? { schema: cfg.json_schema } : {}), strict: true, max_repairs: 1 }
      : { kind: 'json', ...(cfg.json_schema !== undefined ? { schema: cfg.json_schema } : {}), strict: false }
  }
  return req
}

function summarizeRequest(text: string): string {
  const first = text.split('\n').map(l => rustTrim(l)).find(l => l !== '') ?? ''
  const chars = [...first]
  return chars.length <= 80 ? first : chars.slice(0, 80).join('')
}

/** The loop a hosted run may use (`check_hosted_loop`). */
export function checkHostedLoop(origin: string, sections: HostPromptSections, loopModel: LoopModel, json: boolean) {
  if (!sections.runtime_protocol && loopModel !== 'function_call') {
    throw XllmError.capability(`${origin}: the runtime protocol defines the reply shape of the behavior loop; only a function call loop can run without it`)
  }
  if (json && loopModel !== 'function_call') {
    throw XllmError.capability(`${origin}: a JSON reply (json / json_schema) needs loop_model function_call; a behavior loop reply is its XML step`)
  }
}

/**
 * A hosted run's system prompt (`assemble_hosted_system`): the host's text
 * rendered with `env` (no `current_time` / `timezone`), then the sections.
 */
export function assembleHostedSystem(hostSystem: string, origin: string, env: TemplateEnv, sections: HostPromptSections,
  flavor: HostProtocolFlavor, loopModel: LoopModel, tools: EffectiveTools, json: boolean) {
  const runtimeProtocol = buildRuntimeProtocolFor(flavor, loopModel, tools, json)
  const renderedHost = env.render(hostSystem, `host:${origin}`)
  const appended: string[] = []
  if (sections.capabilities) appended.push(`## capabilities\n${rustTrimEnd(buildRulesSystemText(loopModel, tools))}`)
  if (sections.cmd_manual) {
    const manual = buildCmdManualSystemText(tools)
    if (manual !== undefined) appended.push(`## cmd_manual\n${rustTrimEnd(manual)}`)
  }
  if (sections.runtime_protocol) appended.push(`## runtime_protocol\n${rustTrimEnd(runtimeProtocol)}`)
  let system = rustTrimEnd(renderedHost)
  for (const s of appended) {
    if (system) system += '\n\n'
    system += s
  }
  if (system) system += '\n'
  return { system_prompt: system, runtime_protocol: runtimeProtocol, rendered_host: renderedHost, template_vars: env.usedVars() }
}

export function limitReason(which: BudgetKind, limits: Pick<RunLimits, 'max_tool_iterations' | 'timeout_secs'>): string {
  return which === 'tool_iterations' ? `tool iteration limit (${limits.max_tool_iterations}) reached`
    : which === 'wallclock' ? `total execution time limit (${limits.timeout_secs}s) reached`
      : which === 'tokens' ? 'token budget exhausted' : 'cost budget exhausted'
}

/**
 * Run state an outcome ends a function-call run in when nothing else applies
 * (no running task, nothing to compact) — Rust `run_step` + `RunStep::status`.
 */
export function outcomeRunStatus(outcome: LLMContextOutcome, limits: Pick<RunLimits, 'max_tool_iterations' | 'timeout_secs'>):
  { status: RunStatus; kind?: string; limit_reason?: string } {
  switch (outcome.kind) {
    case 'done': {
      const br = outcome.behavior_result
      if (br && !br.report_end && br.next_behavior === undefined) return { status: 'paused', kind: 'yield' }
      return { status: 'completed' }
    }
    case 'budget_exhausted': return { status: 'limit_reached', limit_reason: limitReason(outcome.which, limits) }
    case 'error': {
      const e = classifyError(outcome.error)
      return { status: e.recoverable ? 'paused' : 'failed', kind: e.kind }
    }
    case 'interrupted': case 'settled': return { status: 'interrupted' }
    case 'context_limit_reached': return { status: 'failed', kind: 'context_capacity' }
  }
}

export class XllmTask {
  /**
   * Prepare a task xllm assembles itself (`XllmTask::prepare`): `llmContext`
   * is the one JSON configuration (no discovery), `overrides` the explicit
   * arguments, `input` the request, materials and images.
   */
  static prepare(llmContext: JsonValue | undefined, origin: string, input: TaskInput, overrides: TaskOverrides, deps: XllmDeps): Promise<PreparedTask> {
    return prepareTask(llmContext, origin, input, overrides, deps)
  }

  /**
   * Prepare a host-assembled task (`prepare_hosted`): `llmContext` is the
   * JSON form of an `.llm_context` (strict keys; `origin` names it in
   * diagnostics), `hostSystem` the host's system text; xllm appends its
   * `capabilities` / `cmd_manual` / `runtime_protocol` sections as
   * `deps.hostPromptSections` allows.
   */
  static async prepareHosted(llmContext: JsonValue | undefined, origin: string, hostSystem: string, deps: XllmDeps): Promise<HostedTask> {
    const runtime = deps.runtime
    const descriptor = runtime.descriptor()
    const file = parseLlmContextJson(origin, llmContext ?? null)
    if (descriptor.kind === SITE_KIND) checkSiteConfig(file, origin)
    if (file.runtime?.kind !== undefined && file.runtime.kind !== descriptor.kind) {
      throw XllmError.capability(`${origin}: runtime.kind \`${file.runtime.kind}\` does not match the host's runtime \`${descriptor.kind}\``)
    }
    const merged = mergeConfigLayers([{ path: origin, file }])
    const sources = { ...merged.sources }
    let model = merged.model
    if (model === undefined) {
      if ((merged.provider.kind ?? 'buckyos') === 'openai') throw XllmError.capability(`${origin}: openai provider requires a model`)
      sources.model = 'default'
      model = 'llm.chat'
    }
    const loopModel: LoopModel = merged.loop_model ?? 'function_call'
    const sections = sectionsOf(deps)
    const json = merged.json === true || merged.json_schema !== undefined
    checkHostedLoop(origin, sections, loopModel, json)
    const limits = limitsOf(merged)
    const group = merged.prompt.select !== undefined ? merged.prompt.groups?.[merged.prompt.select] : undefined
    const { cfg: toolsCfg, sources: toolSources } = computeToolsConfig(merged, group, undefined, group !== undefined)
    const { tools, manager, runtimeConfig } = await openRuntime(runtime, merged.runtime, descriptor.workdir, loopModel, toolSources, toolsCfg, deps.tasks)
    const info = await runtime.info()
    const env = TemplateEnv.forNewRun(info, name => runtime.env?.(name))
    delete env.runtime.current_time
    delete env.runtime.timezone
    const hosted = assembleHostedSystem(hostSystem, origin, env, sections, deps.hostProtocol ?? { kind: 'one_shot' }, loopModel, tools, json)
    const prompt: PromptPlan = {
      mode: 'custom', loop_model: loopModel, sections: [], custom_system: hosted.rendered_host, custom_system_source: `host:${origin}`,
      runtime_protocol: hosted.runtime_protocol, protocol_version: RUNTIME_PROTOCOL_VERSION, system_prompt: hosted.system_prompt,
      user_request_source: 'structured', template_vars: hosted.template_vars, runtime_vars: runtimeTemplateValues(info),
    }
    const config: EffectiveConfig = {
      runtime: runtimeConfig, runtime_descriptor: runtime.descriptor(), provider: merged.provider, model, loop_model: loopModel, limits,
      run_logs: merged.run_logs ?? 'warn', result_format: merged.result_format ?? { kind: 'raw' }, json, tools,
      config_files: [origin], sources,
    }
    if (merged.file_model !== undefined) config.file_model = merged.file_model
    if (merged.json_schema !== undefined) config.json_schema = merged.json_schema
    return { kind: 'hosted', origin, workdir: descriptor.workdir, config, prompt, manager }
  }
}

export interface RunOutcome {
  status: RunStatus
  record: RunRecord
}

export interface ResumeLimits {
  max_tokens?: number
  max_tool_iterations?: number
  timeout_secs?: number
  llm_timeout_secs?: number
}

export type ResumeStart = { kind: 'terminal'; record: RunRecord } | { kind: 'run'; run: XllmRun }

/** External interrupt handle of a run (Ctrl-C semantics; `finish` settles gracefully). */
export class XllmInterrupter {
  /** @internal */ requested: string | undefined
  /** @internal */ handle: { interrupt(r: string): boolean; finish(r: string): boolean } | undefined

  interrupt(reason: string) {
    this.requested = reason
    this.handle?.interrupt(reason)
  }

  finish(reason: string) {
    this.requested = reason
    this.handle?.finish(reason)
  }
}

export interface StartOptions {
  /** The user input of a hosted task (text or messages). */
  input?: string | AiMessage[]
  /** Task summary in run.json (default: the first line of the input). */
  summary?: string
}

/** One run's execution handle. */
export class XllmRun {
  readonly runId: string
  private record: RunRecord
  private ctx: LLMContext | undefined
  private limitSnapshot: LLMContextSnapshot | undefined
  private readonly interrupterState = new XllmInterrupter()
  private readonly llm: TimeoutLlmClient
  private countedCalls = 0
  private lock: RunLock | undefined
  private workdirLock: RunLock | undefined
  private readonly waistDeps: LLMContextDeps
  private readonly hosted: boolean
  private initialMessages: AiMessage[]
  private fileStage: FileStagePlan | undefined
  private mainUserParts: AiContent[]

  private constructor(
    private readonly store: RunStore,
    record: RunRecord,
    private readonly deps: XllmDeps,
    private readonly manager: RunToolManager,
    locks: { run?: RunLock; workdir?: RunLock },
    initialMessages: AiMessage[],
    pending?: { fileStage?: FileStagePlan; mainUserParts: AiContent[] },
  ) {
    this.fileStage = pending?.fileStage
    this.mainUserParts = pending?.mainUserParts ?? []
    this.runId = record.run_id
    this.record = record
    this.lock = locks.run
    this.workdirLock = locks.workdir
    this.initialMessages = initialMessages
    this.hosted = record.prompt.custom_system_source?.startsWith('host:') ?? false
    this.llm = new TimeoutLlmClient(deps.llm, Math.max(1, record.config.limits.llm_timeout_secs) * 1000)
    const hook: CheckpointHook = {
      beforeToolCall: async s => {
        await this.commit(s)
      },
      beforeInference: async s => {
        await this.commit(s)
        return undefined
      },
    }
    this.waistDeps = {
      llm: this.llm,
      tools: manager,
      worklog: new ObserverWorklog(this.runId, deps.observer ?? noopObserver),
      tokenizer: deps.tokenizer,
      checkpointHook: hook,
    }
    if (record.config.loop_model === 'behavior') {
      this.waistDeps.resultParser = new XllmActionParser(record.config.tools.actions)
      this.waistDeps.stepRenderer = stepRenderer(this.hosted)
    }
  }

  /** Create the run: allocate its id, take its locks, write run.json before the first model request. */
  static async start(task: HostedTask | PreparedTask, deps: XllmDeps, options: StartOptions = {}): Promise<XllmRun> {
    const store = deps.store
    let initialMessages: AiMessage[]
    let input: InputRecord
    let summary: string
    if (task.kind === 'hosted') {
      if (options.input === undefined) throw XllmError.input('a hosted task needs its input (`start(task, deps, { input })`)')
      const user = typeof options.input === 'string' ? [textMessage('user', options.input)] : cloneJson(options.input)
      if (user.length === 0) throw XllmError.input('the input is empty')
      initialMessages = [textMessage('system', task.prompt.system_prompt), ...user]
      input = { request_source: 'structured', attachments: [], structured_messages: user.length }
      summary = summarizeRequest(options.summary ?? user.map(textContent).join('\n'))
    } else {
      initialMessages = cloneJson(task.initialMessages)
      input = cloneJson(task.input)
      summary = options.summary ?? task.summary
    }
    const runId = await store.createRun()
    task.manager.bindRun({ run_id: runId, run_dir: store.runDir(runId) })
    const locks = await acquireLocks(store, runId, task.config, deps)
    const now = nowMs()
    const record: RunRecord = {
      version: RUN_RECORD_VERSION, run_id: runId, status: 'running', workdir: task.workdir, created_at_ms: now, updated_at_ms: now,
      summary, input, config: cloneJson(task.config), prompt: cloneJson(task.prompt),
      pending_input: {
        initial_messages: initialMessages,
        main_user_parts: task.kind === 'prepared' ? cloneJson(task.mainUserParts) : [],
        ...(task.kind === 'prepared' && task.fileStage ? { file_stage: cloneJson(task.fileStage) } : {}),
      },
      artifacts: [], usage: { llm_requests: 0 }, compactions: 0, pid: deps.pid ?? 0,
    }
    const runsDir = store.runsDir()
    if (runsDir !== undefined) record.runs_dir = runsDir
    try {
      await store.writeRecord(record)
    } catch (e) {
      await releaseLocks(locks)
      throw e
    }
    return new XllmRun(store, record, deps, task.manager, locks, initialMessages,
      task.kind === 'prepared' ? { fileStage: task.fileStage, mainUserParts: task.mainUserParts } : undefined)
  }

  /**
   * Take a run back (`XllmRun::resume`). A terminal run only returns its
   * record. Records and snapshots from a store are not trusted: the tools
   * they name must be tools of this runtime, the model is the host's client.
   */
  static async resume(store: RunStore, runId: string, limits: ResumeLimits, deps: XllmDeps): Promise<ResumeStart> {
    let record = await store.readRecord(runId)
    const limitsGiven = Object.values(limits).some(v => v !== undefined)
    if (isTerminal(record.status)) {
      if (limitsGiven) {
        throw new XllmError({ kind: 'run_terminal', run_id: runId, status: record.status,
          hint: 'execution limits do not apply to a terminal run; start a new task instead' })
      }
      return { kind: 'terminal', record }
    }
    if (record.status === 'running' && await store.isRunLive(runId)) throw new XllmError({ kind: 'run_busy', run_id: runId })
    checkResumable(record)
    if (deps.workdirExists && !(await deps.workdirExists(record.workdir))) {
      throw XllmError.notResumable(runId, `original working directory ${record.workdir} no longer exists`)
    }
    const locks = await acquireLocks(store, runId, record.config, deps)
    try {
      record = await store.readRecord(runId)
      checkResumable(record)
      const runtime = deps.runtime
      if (!jsonEqual(runtime.descriptor(), record.config.runtime_descriptor)) {
        throw XllmError.runtimeMismatch('saved runtime target or workdir changed')
      }
      const manager = await rebuildToolset(record, runtime, deps.tasks, store.runDir(runId))
      for (const key of record.hints_once ?? []) manager.hintLedger().mark(HINT_NS_ONCE, key)
      if (limits.max_tokens !== undefined) record.config.limits.max_tokens = limits.max_tokens
      if (limits.timeout_secs !== undefined) record.config.limits.timeout_secs = limits.timeout_secs
      if (limits.llm_timeout_secs !== undefined) record.config.limits.llm_timeout_secs = limits.llm_timeout_secs
      const oldMax = record.config.limits.max_tool_iterations
      if (limits.max_tool_iterations !== undefined) record.config.limits.max_tool_iterations = limits.max_tool_iterations
      const snapshot = record.latest_snapshot_idx !== undefined ? await store.getSnapshot(runId, record.latest_snapshot_idx) : undefined
      const inFlight = snapshot ? inFlightCall(snapshot) : undefined
      if (inFlight) manager.setRecovering(inFlight.call_id, await runtime.describeInterrupted({ run_id: runId, run_dir: store.runDir(runId) }, inFlight))
      record.status = 'running'
      record.pid = deps.pid ?? 0
      record.updated_at_ms = nowMs()
      await store.writeRecord(record)
      let initial: AiMessage[] = []
      let pending: { fileStage?: FileStagePlan; mainUserParts: AiContent[] } | undefined
      if (record.latest_snapshot_idx === undefined) {
        if (!record.pending_input) throw XllmError.notResumable(runId, 'the run has neither a saved snapshot nor its initial input')
        initial = cloneJson(record.pending_input.initial_messages)
        pending = { fileStage: record.pending_input.file_stage, mainUserParts: record.pending_input.main_user_parts }
      }
      const run = new XllmRun(store, record, deps, manager, locks, initial, pending)
      if (snapshot) {
        const now = record.config.limits
        snapshot.state.started_at_ms = nowMs()
        snapshot.request.budget.max_wallclock_ms = now.timeout_secs * 1000
        snapshot.request.model_policy.max_completion_tokens = now.max_tokens ?? null
        if (now.max_tool_iterations !== oldMax) {
          const consumed = Math.max(0, oldMax - snapshot.state.tool_iterations_left)
          snapshot.state.tool_iterations_left = Math.max(0, now.max_tool_iterations - consumed)
          snapshot.request.tool_policy.max_tool_iterations = now.max_tool_iterations
        }
        if (snapshot.state.suspended) {
          run.limitSnapshot = snapshot
        } else {
          try {
            run.setCtx(LLMContext.resume(snapshot, { kind: 'resume_from_mid_run' }, run.waistDeps))
          } catch (e) {
            const reason = e instanceof LLMComputeException ? computeErrorMessage(e.error) : e instanceof Error ? e.message : String(e)
            throw XllmError.notResumable(runId, `saved progress cannot be loaded: ${reason}`)
          }
        }
      }
      return { kind: 'run', run }
    } catch (e) {
      await releaseLocks(locks)
      throw e
    }
  }

  /** The current run record. */
  currentRecord(): RunRecord {
    return cloneJson(this.record)
  }

  interrupter(): XllmInterrupter {
    return this.interrupterState
  }

  /**
   * Give a paused or interrupted run a new input (`XllmRun::inject_input` /
   * `xllm --resume "<message>"`): appended at the boundary the run stopped
   * at and committed before the run continues.
   */
  async injectInput(text: string): Promise<void> {
    const ctx = this.ctx
    if (!ctx) throw XllmError.input('this run has not reached the model yet; it cannot take a message')
    const placed = ctx.inject({ messages: [textMessage('user', text)] })
    if (placed.kind === 'none') throw XllmError.input('the run stopped in the middle of a tool batch; resume it without a message first')
    await this.commit(ctx.snapshot())
  }

  /** Release the run's locks without executing (a run that will not continue in this executor). */
  async release(): Promise<void> {
    await releaseLocks({ run: this.lock, workdir: this.workdirLock })
    this.lock = undefined
    this.workdirLock = undefined
  }

  /** Drive the run to this command's stopping point. */
  async execute(): Promise<RunOutcome> {
    if (!this.lock) {
      const locks = await acquireLocks(this.store, this.runId, this.record.config, this.deps)
      this.lock = locks.run
      this.workdirLock = locks.workdir
    }
    try {
      return await this.executeLocked()
    } finally {
      await this.release()
    }
  }

  private async executeLocked(): Promise<RunOutcome> {
    this.emit({ kind: 'phase', phase: 'preparing_input', detail: '' })
    if (this.interrupterState.requested !== undefined) return this.interrupted(this.interrupterState.requested)
    if (this.limitSnapshot) {
      const snapshot = this.limitSnapshot
      this.limitSnapshot = undefined
      const out = await this.compactContext(snapshot, rewritableHistory(snapshot, this.waistDeps), snapshot.state.usage)
      if (out) return out
    }
    if (!this.ctx) {
      if (this.fileStage && !this.record.file_model_stage) {
        const out = await this.runFileStage(this.fileStage)
        if (out) return out
      }
      await this.buildInitialContext()
    }
    const model = this.record.config.model
    for (;;) {
      if (this.interrupterState.requested !== undefined) return this.interrupted(this.interrupterState.requested)
      this.emit({ kind: 'phase', phase: 'waiting_model', detail: model })
      const ctx = this.ctx
      if (!ctx) throw XllmError.other('no active context (already finished?)')
      this.ctx = undefined
      const outcome = await ctx.run()
      try {
        await this.commit(ctx.snapshot())
      } catch (e) {
        this.setCtx(ctx)
        const err: RunErrorRecord = {
          phase: 'storage', kind: 'storage', message: e instanceof Error ? e.message : String(e), recoverable: true,
          condition: 'fix the runs directory, then resume', at_ms: nowMs(),
        }
        try {
          await this.update(r => {
            r.status = 'paused'
            r.last_error = err
          })
        } catch {
          // the store is failing; the outcome still says paused
        }
        return this.outcome()
      }
      const done = await this.handleOutcome(ctx, outcome)
      if (done) return done
    }
  }

  private async handleOutcome(ctx: LLMContext, outcome: LLMContextOutcome): Promise<RunOutcome | undefined> {
    switch (outcome.kind) {
      case 'done': {
        const br = outcome.behavior_result
        const yielded = br !== undefined && !br.report_end && br.next_behavior === undefined
        const running = br === undefined
          ? (await this.manager.taskResolver()?.active() ?? []).filter(t => t.status === 'running').map(t => t.task_id) : []
        if (running.length > 0) {
          this.setCtx(ctx)
          await this.update(r => {
            r.status = 'paused'
            r.usage.main = outcome.usage
            this.addCalls(r)
            r.last_error = {
              phase: 'model', kind: 'tasks_running', message: textContent(outcome.response.message), recoverable: true,
              condition: `tasks ${running.join(', ')} are still running; resume once they ended (optionally with a message)`, at_ms: nowMs(),
            }
          })
          return this.outcome()
        }
        if (yielded) {
          this.setCtx(ctx)
          await this.update(r => {
            r.status = 'paused'
            r.usage.main = outcome.usage
            this.addCalls(r)
            r.last_error = {
              phase: 'model', kind: 'yield', message: br?.self_report ?? textContent(outcome.response.message), recoverable: true,
              condition: 'the model stopped to wait for new input; resume with a message to continue', at_ms: nowMs(),
            }
          })
          return this.outcome()
        }
        let raw: string
        if (outcome.output.kind === 'json') {
          const text = textContent(outcome.response.message)
          raw = rustTrim(text) ? text : canonicalJson(outcome.output.content)
        } else {
          raw = textContent(outcome.response.message)
        }
        return this.finishWithResponse(raw, outcome.usage)
      }
      case 'budget_exhausted': {
        const reason = limitReason(outcome.which, this.record.config.limits)
        await this.update(r => {
          r.status = 'limit_reached'
          r.usage.main = outcome.usage
          this.addCalls(r)
          r.limit_reason = reason
        })
        return this.outcome()
      }
      case 'error': {
        const err = classifyError(outcome.error)
        if (errorSource(outcome.error) === 'runtime') this.setCtx(ctx)
        await this.update(r => {
          r.status = err.recoverable ? 'paused' : 'failed'
          r.usage.main = outcome.usage
          this.addCalls(r)
          r.last_error = err
        })
        return this.outcome()
      }
      case 'interrupted':
      case 'settled':
        this.setCtx(LLMContext.resume(outcome.snapshot, { kind: 'resume_from_mid_run' }, this.waistDeps))
        this.interrupterState.requested = undefined
        await this.update(r => {
          r.status = 'interrupted'
          r.usage.main = outcome.usage
          this.addCalls(r)
          r.interrupt_reason = outcome.reason
        })
        return this.outcome()
      case 'context_limit_reached':
        return this.compactContext(outcome.snapshot, outcome.accumulated, outcome.usage)
    }
  }

  /**
   * Compact a context suspended at the context limit and resume it (at most
   * 3 compactions per run). The compacted context is committed before it
   * runs; an outcome ends this command.
   */
  private async compactContext(snapshot: LLMContextSnapshot, history: AiMessage[], usage: AiUsage): Promise<RunOutcome | undefined> {
    this.emit({ kind: 'phase', phase: 'compacting_context', detail: `${history.length} messages` })
    const fail = async (kind: string, message: string) => {
      await this.update(r => {
        r.status = 'failed'
        r.usage.main = usage
        this.addCalls(r)
        r.last_error = { phase: 'model', kind, message, recoverable: false, at_ms: nowMs() }
      })
      return this.outcome()
    }
    if (this.record.compactions >= MAX_COMPACTIONS) return fail(CONTEXT_CAPACITY_EXHAUSTED.kind, CONTEXT_CAPACITY_EXHAUSTED.message)
    const cfg = this.record.config
    const compressor = new LlmSummarizeCompressor(this.llm, summaryModel(cfg), compactionTargetTokens(cfg.limits),
      this.deps.tokenizer ?? new ByteHeuristicTokenizer(), this.record.workdir)
    let rewritten: AiMessage[]
    try {
      rewritten = await compressor.compress(history)
    } catch (e) {
      return fail('context_compaction', e instanceof Error ? e.message : String(e))
    }
    // Behavior runs fold the materialized history into the input; the inner
    // transcript of the step in progress is kept by the waist.
    const fill: ResumeFill = this.waistDeps.resultParser
      ? { kind: 'rewritten_steps', input: rewritten, history_summaries: [], steps: [] }
      : { kind: 'rewritten_history', history: rewritten }
    // Results shown before are no longer in the history.
    this.manager.clearDedup()
    let resumed: LLMContext
    try {
      resumed = LLMContext.resume(snapshot, fill, this.waistDeps)
    } catch (e) {
      const reason = e instanceof LLMComputeException ? computeErrorMessage(e.error) : e instanceof Error ? e.message : String(e)
      throw XllmError.other(`resume after compaction failed: ${reason}`)
    }
    await this.commit(resumed.snapshot())
    this.setCtx(resumed)
    await this.update(r => {
      r.compactions += 1
    })
    return undefined
  }

  private async buildInitialContext() {
    const rec = this.record
    if (rec.config.limits.context_yield_ratio !== undefined && rec.config.limits.context_window_tokens === undefined) {
      const origin = rec.config.sources.context_yield_ratio ?? 'config'
      this.emit({ kind: 'warning',
        message: `context_yield_ratio (from ${origin}) has no effect without context_window; only the provider's refusal triggers compaction` })
    }
    let messages = cloneJson(this.initialMessages)
    const stage = rec.file_model_stage
    if (stage) {
      messages = [textMessage('system', rec.prompt.system_prompt), { role: 'user', content: [...cloneJson(this.mainUserParts),
        { type: 'text', text: `<image_analysis model="${xmlEscape(stage.model)}">\n${rustTrimEnd(stage.analysis)}\n</image_analysis>` }] }]
    }
    const request = runRequest(rec.config, { kind: 'one_shot', id: this.runId }, this.runId, rec.summary, '', messages, this.hosted)
    const ctx = new LLMContext(request, this.waistDeps)
    await this.commit(ctx.snapshot())
    this.setCtx(ctx)
    await this.update(r => {
      delete r.pending_input
    })
  }

  /** The file-model stage: images analysed by `file_model`; the main model gets the analysis instead of the images. */
  private async runFileStage(plan: FileStagePlan): Promise<RunOutcome | undefined> {
    this.emit({ kind: 'phase', phase: 'file_model', detail: `${plan.images.length} image(s) via ${plan.model}` })
    const client = new TimeoutLlmClient(this.deps.llm, Math.max(1, this.record.config.limits.llm_timeout_secs) * 1000)
    const parts: AiContent[] = [{
      type: 'text',
      text: `Analyze the attached image(s) for the following task. Describe everything relevant to the task in detail, keep the image order and labels, and when several images are given, describe the relationships and differences between them explicitly. Do not answer the task itself; produce a faithful analysis that another model will use.\n\nTask: ${plan.request_text}`,
    }]
    for (const [label, src] of plan.images) parts.push({ type: 'text', text: `[${label}]` }, { type: 'image', source: src })
    const maxTokens = this.record.config.limits.max_tokens
    this.emit({ kind: 'llm_started', model: plan.model })
    const started = nowMs()
    let result: { ok: AiResponse } | { err: LLMComputeError }
    try {
      result = {
        ok: await client.infer({
          messages: [textMessage('system', 'You are an image analysis assistant. You receive real images; describe their actual content precisely.'),
            { role: 'user', content: parts }],
          model_alias: plan.model, fallbacks: [], ...(maxTokens !== undefined ? { max_completion_tokens: maxTokens } : {}),
          force_json: false, disable_capabilities: [], tool_specs: [], allow_tool_calls: false, signal: new AbortController().signal,
        }),
      }
    } catch (e) {
      result = { err: e instanceof LLMComputeException ? e.error : { kind: 'provider', failure: 'unknown', message: String(e) } }
    }
    this.emit({ kind: 'llm_finished', ok: 'ok' in result, elapsed_ms: nowMs() - started })
    if ('err' in result) {
      const err = classifyError(result.err)
      err.phase = 'file_model'
      await this.update(r => {
        r.status = err.recoverable ? 'paused' : 'failed'
        r.last_error = err
        r.usage.llm_requests += 1
      })
      return this.outcome()
    }
    const resp = result.ok
    const analysis = textContent(resp.message)
    if (!rustTrim(analysis)) {
      await this.update(r => {
        r.status = 'failed'
        r.last_error = { phase: 'file_model', kind: 'empty_analysis', message: `file model \`${plan.model}\` returned no analysis`, recoverable: false, at_ms: nowMs() }
        r.usage.llm_requests += 1
      })
      return this.outcome()
    }
    await this.update(r => {
      r.file_model_stage = { model: plan.model, analysis, completed_at_ms: nowMs(),
        ...(resp.usage ? { usage: resp.usage } : {}), ...(client.lastModel() !== undefined ? { response_model: client.lastModel() } : {}) }
      if (resp.usage) r.usage.file_model = addRecordUsage(r.usage.file_model, resp.usage)
      r.usage.llm_requests += 1
    })
    return undefined
  }

  private async finishWithResponse(raw: string, usage: AiUsage): Promise<RunOutcome> {
    this.emit({ kind: 'phase', phase: 'saving_result', detail: '' })
    const cfg = this.record.config
    let extracted: ExtractedValue | undefined
    let extractError: string | undefined
    try {
      extracted = extractResult(raw, cfg.result_format)
    } catch (e) {
      extractError = e instanceof Error ? e.message : String(e)
    }
    let jsonValid: boolean | undefined
    let jsonError: string | undefined
    if (cfg.json) {
      if (!extracted) {
        jsonValid = false
        jsonError = 'extraction failed'
      } else {
        const j = extractedAsJson(extracted)
        jsonValid = j.ok
        if (!j.ok) jsonError = j.error
      }
    }
    const responseModel = this.llm.lastModel()
    await this.update(r => {
      r.status = 'completed'
      delete r.last_error
      r.usage.main = usage
      this.addCalls(r)
      const result: RunResultRecord = { raw }
      if (extracted) result.extracted = extracted
      if (extractError !== undefined) result.extract_error = extractError
      if (jsonValid !== undefined) result.json_valid = jsonValid
      if (jsonError !== undefined) result.json_error = jsonError
      if (responseModel !== undefined) result.response_model = responseModel
      r.result = result
    })
    return this.outcome()
  }

  private async interrupted(reason: string): Promise<RunOutcome> {
    this.interrupterState.requested = undefined
    await this.update(r => {
      r.status = 'interrupted'
      r.interrupt_reason = reason
    })
    return this.outcome()
  }

  /** @internal */
  setCtx(ctx: LLMContext) {
    this.ctx = ctx
    this.interrupterState.handle = ctx.interruptHandle()
  }

  private addCalls(r: RunRecord) {
    const calls = this.llm.calls()
    r.usage.llm_requests += calls - this.countedCalls
    this.countedCalls = calls
  }

  private outcome(): RunOutcome {
    return { status: this.record.status, record: cloneJson(this.record) }
  }

  private async update(f: (r: RunRecord) => void) {
    const r = cloneJson(this.record)
    f(r)
    r.updated_at_ms = nowMs()
    // The manager only knows this segment's writes; earlier segments' stay in the record.
    for (const a of this.manager.artifacts()) if (!r.artifacts.includes(a)) r.artifacts.push(a)
    const once = this.manager.hintLedger().keys(HINT_NS_ONCE)
    if (once.length) r.hints_once = once
    else delete r.hints_once
    await this.store.writeRecord(r)
    this.record = r
  }

  private async commit(snapshot: LLMContextSnapshot) {
    const idx = await this.store.putSnapshot(this.runId, snapshot)
    const r = cloneJson(this.record)
    r.latest_snapshot_idx = idx
    r.updated_at_ms = nowMs()
    await this.store.writeRecord(r)
    this.record = r
  }

  private emit(event: RunEvent) {
    ;(this.deps.observer ?? noopObserver).onEvent(this.runId, event)
  }
}

export function isTerminal(s: RunStatus): boolean {
  return s === 'completed' || s === 'failed' || s === 'limit_reached'
}

/** The resume gate (Rust `XllmRun::resume` plus the TS restriction on host-assembled runs). */
function checkResumable(record: RunRecord) {
  const id = record.run_id
  if (record.version !== RUN_RECORD_VERSION) {
    throw XllmError.notResumable(id, `run record version ${record.version} is not supported by this executor (only ${RUN_RECORD_VERSION})`)
  }
  if (record.host_commit_pending !== undefined && record.host_commit_pending !== null) {
    throw XllmError.notResumable(id, `host input batch ${record.host_commit_pending} is not committed yet; drive the session with its host runner first`)
  }
  if (record.handover) {
    throw XllmError.notResumable(id,
      `the run handed over to behavior \`${record.handover.next_behavior}\`; its host session commits the transfer, drive the session with its host runner`)
  }
  if (record.host) {
    throw XllmError.notResumable(id, `the run was assembled by \`${record.host.assembled_by}\`; continue it with its host runner`)
  }
  if (record.prompt.protocol_version !== RUNTIME_PROTOCOL_VERSION) {
    throw XllmError.notResumable(id,
      `saved runtime protocol \`${record.prompt.protocol_version}\` is not supported by this executor (\`${RUNTIME_PROTOCOL_VERSION}\`)`)
  }
}

/**
 * Rebuild the saved tool set (`rebuild_toolset`): the tools named in run.json
 * must all be dispatchable by this runtime, otherwise the run cannot be
 * resumed here.
 */
async function rebuildToolset(record: RunRecord, runtime: AgentRuntime, tasks: RunningTaskResolver | undefined,
  runDir: string | undefined): Promise<RunToolManager> {
  const t = record.config.tools
  const cfg: ToolsConfig = {
    enabled: t.enabled,
    filesystem_policy: t.filesystem_policy,
    tools2actions: false,
    tools: t.native.map(x => ({ kind: 'named' as const, name: x.name })),
    actions: t.actions.map(x => ({ kind: 'named' as const, name: x.name })),
    bash_tools: t.bash_tools,
    shell: { timeout_ms: t.shell.timeout_ms, max_timeout_ms: t.shell.max_timeout_ms },
  }
  for (const s of [...t.tool_sources, ...t.action_sources]) {
    if (s.kind === 'mcp') throw XllmError.notResumable(record.run_id, `tool source \`mcp:${s.endpoint}\` cannot be rebuilt by this executor`)
  }
  let opened
  try {
    opened = await runtime.open({ workdir: record.workdir, run_id: record.run_id, loop_model: record.config.loop_model,
      sources: t.sources, env: {}, tasks, task_wait_ms: taskWaitMs(record.config.runtime) }, cfg)
  } catch (e) {
    throw XllmError.notResumable(record.run_id, `its tools cannot be rebuilt here: ${e instanceof Error ? e.message : String(e)}`)
  }
  for (const name of [...t.native, ...t.actions].map(x => x.name)) {
    if (!opened.manager.has(name)) throw XllmError.notResumable(record.run_id, `tool \`${name}\` is not available in this runtime`)
  }
  opened.manager.bindRun({ run_id: record.run_id, run_dir: runDir })
  return opened.manager
}

/** The call a resumed snapshot dispatches first that the previous executor may have started (`in_flight_call`). */
export function inFlightCall(snapshot: LLMContextSnapshot) {
  const s = snapshot.state
  if (s.suspended) return undefined
  const first = s.tool_batch?.remaining?.[0]
  if (first) return first
  const step = s.action_step?.step
  if (!step) return undefined
  const results = step.action_results ?? []
  if (results.length && results[results.length - 1].kind !== 'success') return undefined
  return (step.actions ?? [])[results.length]
}

async function acquireLocks(store: RunStore, runId: string, cfg: EffectiveConfig, deps: XllmDeps): Promise<{ run?: RunLock; workdir?: RunLock }> {
  const run = await store.lockRun(runId)
  if (!run) throw new XllmError({ kind: 'run_busy', run_id: runId })
  let workdir: RunLock | undefined
  const remote = cfg.runtime.kind === 'remote_ssh' || cfg.runtime.kind === 'remote_node'
  if (deps.lockWorkdir && cfg.tools.enabled && !remote) {
    const l = await deps.lockWorkdir(cfg.runtime_descriptor.workdir, runId)
    if (!l) {
      await run.release()
      throw new XllmError({ kind: 'workdir_busy', workdir: cfg.runtime_descriptor.workdir, run_id: 'unknown' })
    }
    workdir = l
  }
  return { run, workdir }
}

async function releaseLocks(locks: { run?: RunLock; workdir?: RunLock }) {
  await locks.workdir?.release()
  await locks.run?.release()
}

/** Run error of a waist error (`classify_error`): kind, whether `resume` can fix it, and how. */
export function classifyError(err: LLMComputeError): RunErrorRecord {
  const at = nowMs()
  const rec = (recoverable: boolean, kind: string, condition?: string): RunErrorRecord => {
    const r: RunErrorRecord = { phase: 'model', kind, message: computeErrorMessage(err), recoverable, at_ms: at }
    if (condition !== undefined) r.condition = condition
    return r
  }
  switch (err.kind) {
    case 'timeout': return rec(true, 'provider_timeout', 'the model request timed out; resume to retry it')
    case 'cancelled': return rec(true, 'cancelled', 'resume to retry')
    case 'provider': {
      const f = err.failure
      if (f === 'transient') return rec(true, 'provider_transient', 'wait for the model service to recover, then resume')
      if (f === 'permanent') return rec(false, 'provider_permanent')
      if (f === 'unknown') return rec(false, 'provider_error')
      if (f === 'context_limit') return rec(false, 'context_capacity')
      const code = refusedCode(f) as string
      if (code === REFUSED_CREDENTIALS) return rec(true, REFUSED_CREDENTIALS, 'fix the credential referenced by the current identity, then resume')
      const condition = code === REFUSED_QUOTA_EXHAUSTED || code === REFUSED_QUOTA_BUDGET_EXCEEDED
        ? 'the AI token quota does not cover this call; wait for it to reset, lower the output budget, or ask an administrator; do not retry right away'
        : code === REFUSED_RESOURCE_NOT_PERMITTED ? 'the model is not permitted to this user; choose a permitted model or ask an administrator'
          : code === REFUSED_ATTRIBUTION_UNAVAILABLE ? 'the user whose AI resources this run uses cannot be determined'
            : 'the AI service refused this call under its policy; do not retry right away'
      return rec(false, code, condition)
    }
    case 'checkpoint': return rec(true, 'storage', 'fix the runs directory (permissions / disk space), then resume')
    case 'tool_runtime':
      return rec(true, 'tool_runtime', err.effect_unknown
        ? "the tool infrastructure failed and the last action's effect is unknown; check the working directory, then resume"
        : 'the tool infrastructure failed before the action ran; fix it, then resume')
    case 'output_parse': return rec(false, 'llm_output')
    case 'policy_rejected': case 'tool_failed': return rec(false, 'tool_errors_exhausted')
    case 'snapshot_corrupted': return rec(false, 'snapshot')
    case 'internal': return rec(false, 'internal')
  }
}

export { DEFAULT_WRAP_UP_ROUNDS }
