// The `native` runtime of the Deno host (Rust `runtime::Runtime` of kind
// native): the same probe (`LOCAL_PROBE`), the same identity
// (`target = { host: native_host_id(), uid }`, `runtime_id` = blake3 of the
// target, `host`, `workdir` = the probed real cwd, `capabilities.tools` the
// probed commands), so a run directory written by Rust on this machine
// resumes here (descriptors equal field by field) and the other way round.
//
// Tools: the `bash` group only, in the form a host without a task backend can
// run — `shell` waits in the call until its command ends or times out, which
// Rust does when `runtime.task_wait_ms` ≥ `tools.shell.timeout_ms`. A
// configuration that would make `shell` hand commands to tasks, `bash_core`,
// the `executor` group, MCP and named host tools are `capability` errors for a
// new task and `not_resumable` when a saved run needs them.

import type {
  AiToolCall, EffectiveTools, JsonValue, LoopModel, Observation, ResolvedTool, RuntimeConfig, RuntimeDescriptor, RuntimeInfo, ShellSettings,
  ToolSource, ToolSpecLite, ToolsConfig,
} from '../../core/types'
import type { ToolCallCtx } from '../../core/deps'
import { ToolDispatchException } from '../../core/deps'
import { XllmError } from '../../core/errors'
import { BUILTIN_TOOL_GROUP_BASH, BUILTIN_TOOL_GROUP_BASH_CORE, PLANNED_RUNTIME_KINDS, describeToolSource, normalizePath, shellSettings } from '../../core/config'
import { cloneJson } from '../../core/json'
import type { AgentRuntime, OpenedTools, RunBinding, RunToolManager, RuntimeOpenCtx } from '../../runtime/types'
import { unresolvedReason } from '../../runtime/types'
import { envelopeObservation } from '../../runtime/site_manager'
import { HINT_NS_DEDUP, MemoryHintLedger, applyHints } from '../../runtime/hints'
import type { HintLedger } from '../../runtime/hints'
import { taskStateObservation } from '../../runtime/task_model'
import type { RunningTaskResolver } from '../../runtime/task_model'
import { toHost } from '../../runtime/tool_result'
import { deno, errorText, isDir, joinPath } from './deno_api'
import { deriveRuntimeId, nativeHostId, nativeTarget } from './identity'
import {
  BASH_GROUP_TOOLS, NativeToolError, OUTPUT_TAIL_BYTES, TOOL_EDIT_FILE, TOOL_SHELL, TOOL_WRITE_FILE, editFileTool, execDirFor, fmtElapsed,
  readExitFile, readFileTail, readFileTool, shellTool, writeFileTool,
} from './native_tools'
import type { FileToolConfig, NativeTool } from './native_tools'

export const NATIVE_KIND = 'native'

/** `LOCAL_PROBE` (`runtime/ssh.rs`), run as `/bin/bash -c` in the runtime's cwd with its env. */
export const LOCAL_PROBE = `set -e
command -v bash >/dev/null
machine_id="$(cat /etc/machine-id 2>/dev/null || true)"
[ -n "$machine_id" ] || machine_id="$(hostname)"
printf '%s\\0' "$machine_id" "$(hostname)" "$(id -u)" "$(uname -s | tr '[:upper:]' '[:lower:]')" "$(uname -m)" "$(command -v bash)" "$(pwd -P)" "\${PATH}" "$(date +%Y-%m-%dT%H:%M:%S%z)" "$(date +%Z%z)"
for tool in bash realpath base64; do if command -v "$tool" >/dev/null; then printf '%s\\0' "$tool"; fi; done
`

export interface Probe {
  machine: string
  hostname: string
  uid: string
  os: string
  arch: string
  shell: string
  cwd: string
  path: string
  current_time: string
  timezone: string
  tools: string[]
}

/** `parse_probe`: NUL-separated fields, the first ten non-empty. */
export function parseProbe(bytes: Uint8Array): Probe {
  let text = new TextDecoder().decode(bytes)
  if (text.endsWith('\0')) text = text.slice(0, -1)
  const p = text.split('\0')
  if (p.length < 10 || p.slice(0, 10).some(f => f === '')) throw XllmError.capability('execution environment probe returned incomplete data')
  return {
    machine: p[0], hostname: p[1], uid: p[2], os: p[3], arch: p[4], shell: p[5], cwd: p[6], path: p[7], current_time: p[8], timezone: p[9],
    tools: p.slice(10, 42),
  }
}

/** Run `LOCAL_PROBE` in `cwd` (10 s at most). */
export async function localProbe(cwd: string, env: Record<string, string>): Promise<Probe> {
  if (deno().build.os === 'windows') throw XllmError.capability('the Deno host\'s native runtime needs bash (Linux / macOS); Windows PowerShell runtimes are Rust-only')
  let out
  try {
    out = await new (deno().Command)('/bin/bash', {
      args: ['-c', LOCAL_PROBE], cwd, env, stdin: 'null', stdout: 'piped', stderr: 'piped', signal: AbortSignal.timeout(10_000),
    }).output()
  } catch (e) {
    throw XllmError.capability(errorText(e))
  }
  if (!out.success) throw XllmError.capability(`native capability probe failed: ${new TextDecoder().decode(out.stderr)}`)
  return parseProbe(out.stdout)
}

function configError(reason: string): XllmError {
  return XllmError.config('.llm_context', 'runtime', reason)
}

/** `RuntimeConfig::validate` for what this host runs (kind native). */
function validateConfig(c: RuntimeConfig) {
  const kind = c.kind ?? NATIVE_KIND
  if (PLANNED_RUNTIME_KINDS.includes(kind)) throw XllmError.capability(`runtime \`${kind}\` is planned but not implemented`)
  if (kind === 'site') throw XllmError.capability('runtime `site` is built by a website (createSiteRuntime); the Deno host runs `native`')
  if (kind === 'remote_ssh' || kind === 'remote_node') throw XllmError.capability(`runtime \`${kind}\` is not available on the Deno host (only \`native\`)`)
  if (kind !== NATIVE_KIND) throw configError(`unknown runtime kind \`${kind}\``)
  if (c.remote_ssh && c.kind !== undefined) throw configError('remote_ssh connection block requires kind: remote_ssh')
  if (c.remote_node && c.kind !== undefined) throw configError('remote_node connection block requires kind: remote_node')
  if (c.remote_ssh || c.remote_node) throw configError('connection block does not match runtime kind')
  validateEnv(c.env ?? {})
  if (c.id !== undefined && !c.id.trim()) throw configError('id cannot be empty')
  if (c.task_wait_ms === 0) throw configError('task_wait_ms must be positive')
}

function validateEnv(env: Record<string, string>) {
  for (const [k, v] of Object.entries(env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) || v.includes('\0')) throw configError(`invalid env key or value \`${k}\``)
  }
}

/** `RuntimeInfo::with_declared`. */
function infoOf(probe: Probe, id: string, target: JsonValue, baseline: string | undefined): RuntimeInfo {
  const os = probe.os.toLowerCase()
  const shellName = probe.shell.split(/[/\\]/).pop() ?? ''
  return {
    id, kind: NATIVE_KIND, os: probe.os, arch: probe.arch, hostname: probe.hostname, shell: probe.shell, cwd: probe.cwd, tools: probe.tools,
    current_time: probe.current_time, timezone: probe.timezone, target,
    platform: os === 'darwin' || os === 'macos' ? 'macos' : os,
    shell_kind: shellName.replace(/\.exe$/, '').replace(/\.EXE$/, '').toLowerCase(),
    baseline: baseline ?? '',
  }
}

// ------------------------------------------------------------- tool manager

const INTENT_ARG = 'intent'
const INTENT_OPTIONAL_DESCRIPTION = 'Optional: why you make this call now and what you expect it to give you, in one short sentence. Shown as the progress of your work.'

/** `with_intent(spec, IntentPolicy::Optional)`. */
function withOptionalIntent(spec: ToolSpecLite): ToolSpecLite {
  const s = cloneJson(spec)
  let schema = s.args_schema as Record<string, JsonValue>
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) schema = s.args_schema = { type: 'object' }
  if (typeof schema.properties !== 'object' || schema.properties === null || Array.isArray(schema.properties)) schema.properties = {}
  ;(schema.properties as Record<string, JsonValue>)[INTENT_ARG] = { type: 'string', description: INTENT_OPTIONAL_DESCRIPTION }
  if (Array.isArray(schema.required)) schema.required = schema.required.filter(r => r !== INTENT_ARG)
  return s
}

function causeName(cause: string | undefined): string {
  return cause === 'deadline' ? 'Deadline' : cause === 'finishing' ? 'Finishing' : 'Interrupted'
}

/** The dispatcher of a native run (Rust `XllmToolManager` over the bash group). */
export class NativeToolManager implements RunToolManager {
  private binding: RunBinding = { run_id: '' }
  private recovering: { callId: string; reason: string } | undefined
  private readonly ledger: HintLedger = new MemoryHintLedger()
  private readonly written: string[] = []

  constructor(
    private readonly tools: Map<string, NativeTool>,
    private readonly workdir: string,
    /** Resume: the specs saved with the run, shown instead of the tools' own (freeze TODO F6). */
    private readonly advertised?: Map<string, ToolSpecLite>,
  ) {}

  bindRun(binding: RunBinding) {
    this.binding = { ...binding }
  }

  setRecovering(callId: string, reason: string) {
    this.recovering = { callId, reason }
  }

  artifacts(): string[] {
    return [...this.written]
  }

  has(name: string): boolean {
    return this.tools.has(name)
  }

  hintLedger(): HintLedger {
    return this.ledger
  }

  clearDedup() {
    this.ledger.clear(HINT_NS_DEDUP)
  }

  taskResolver(): RunningTaskResolver | undefined {
    return undefined
  }

  listToolSpecs(): ToolSpecLite[] {
    const specs = this.advertised ? [...this.advertised.values()] : [...this.tools.values()].map(t => t.spec)
    return specs.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map(s => (BASH_GROUP_TOOLS.includes(s.name) ? withOptionalIntent(s) : cloneJson(s)))
  }

  private names(): string {
    return [...this.tools.keys()].sort().join(', ')
  }

  async callTool(call: AiToolCall, ctx: ToolCallCtx): Promise<Observation> {
    const callId = call.call_id
    const tool = this.tools.get(call.name)
    if (!tool) return { kind: 'error', call_id: callId, message: `tool \`${call.name}\` is not available in this run (available: ${this.names()})` }
    const args: Record<string, JsonValue> = { ...(call.args ?? {}) }
    if (BASH_GROUP_TOOLS.includes(call.name)) delete args[INTENT_ARG]
    if (this.recovering?.callId === callId) {
      const reason = this.recovering.reason
      this.recovering = undefined
      // `shell` would look up task `local:shell:<call_id>` first; this host has no task resolver.
      if (!tool.idempotent) return { kind: 'unresolved', call_id: callId, reason, effect_unknown: true }
    }
    const running = tool.call(args, { call_id: callId, run_id: this.binding.run_id, run_dir: this.binding.run_dir, call: ctx })
      .then(ok => ({ ok }), err => ({ err }))
    let settled: { ok: Awaited<ReturnType<NativeTool['call']>> } | { err: unknown }
    if (tool.cancellable) {
      settled = await running
    } else {
      const first = await Promise.race([running, ctx.cancelledHard().then(cause => ({ cancelled: cause }))])
      if ('cancelled' in first) {
        return {
          kind: 'cancelled', call_id: callId,
          reason: `tool \`${call.name}\` was abandoned while running (${causeName(first.cancelled)}); it cannot be cancelled, so its effect is unknown`,
          effect_unknown: true,
        }
      }
      settled = first
    }
    if ('err' in settled) {
      const e = settled.err
      if (e instanceof NativeToolError) {
        if (e.kind === 'transport') throw new ToolDispatchException(e.detail, e.effectUnknown)
        if (e.kind === 'cancelled') return { kind: 'cancelled', call_id: callId, reason: e.detail, effect_unknown: e.effectUnknown }
        return { kind: 'error', call_id: callId, message: e.message }
      }
      return { kind: 'error', call_id: callId, message: `execution failed: ${errorText(e)}` }
    }
    const result = settled.ok
    if (result.status === 'success' && (call.name === TOOL_WRITE_FILE || call.name === TOOL_EDIT_FILE)) {
      const p = args.path
      if (typeof p === 'string') {
        const abs = p.startsWith('/') ? p : normalizePath(joinPath(this.workdir, p))
        if (!this.written.includes(abs)) this.written.push(abs)
      }
    }
    if (result.status === 'pending') {
      const taskId = result.task_id?.trim()
      if (!taskId) return { kind: 'error', call_id: callId, message: `tool \`${call.name}\` returned a pending result without a task_id`, host: toHost(result) }
      return taskStateObservation(callId, taskId, { kind: 'unknown', reason: 'this runtime has no task backend' }, { kind: 'tools' })
    }
    return envelopeObservation(callId, result, applyHints(result, this.ledger))
  }
}

// ------------------------------------------------------------- runtime

export interface NativeRuntimeOptions {
  /** The configuration's `runtime` block (kind `native`): `workdir`, `env`, `id`, `baseline`, `task_wait_ms`. */
  config?: RuntimeConfig
  /** Where the runtime works when `config.workdir` is unset (default: the current directory). */
  workdir?: string
  /**
   * Taking over a saved run: `open` for this run id rebuilds the run's saved
   * tool sources and shows the model the specs saved with them (F6).
   */
  takeover?: { run_id: string; tools: EffectiveTools }
}

export interface NativeRuntime extends AgentRuntime {
  readonly kind: 'native'
  /** The probe the runtime was opened with. */
  readonly probe: Probe
}

/** `runtime_descriptor` of a native runtime: identity from the target, workdir / os / tools from the probe. */
export function nativeDescriptor(runtimeId: string, target: { host: string; uid: string }, probe: { cwd: string; os: string; tools: string[] }): RuntimeDescriptor {
  return {
    runtime_id: runtimeId,
    kind: NATIVE_KIND,
    host: target.host,
    target,
    workdir: probe.cwd,
    capabilities: { tools: Object.fromEntries(probe.tools.map(t => [t, 'available'])), network: true, os: probe.os },
  }
}

function shellNeedsTasks(shell: ShellSettings): boolean {
  return shell.wait_ms < shell.timeout_ms
}

/** Open the native runtime (`Runtime::initialize`): validate, resolve the cwd, probe, derive the identity. */
export async function createNativeRuntime(options: NativeRuntimeOptions = {}): Promise<NativeRuntime> {
  const configured: RuntimeConfig = cloneJson(options.config ?? { env: {} })
  configured.env = configured.env ?? {}
  validateConfig(configured)
  const rawCwd = configured.workdir ?? options.workdir ?? deno().cwd()
  let cwd: string
  try {
    cwd = await deno().realPath(rawCwd)
  } catch (e) {
    throw XllmError.capability(`runtime cwd ${rawCwd}: ${errorText(e)}`)
  }
  if (!(await isDir(cwd))) throw XllmError.capability('runtime workdir must be a directory')
  const probe = await localProbe(cwd, configured.env)
  const target = nativeTarget(await nativeHostId(), probe.uid)
  const id = deriveRuntimeId(configured.id, NATIVE_KIND, target)
  const info = infoOf(probe, id, target, configured.baseline)
  const config: RuntimeConfig = { ...configured, kind: NATIVE_KIND, id, workdir: info.cwd }
  const descriptor = nativeDescriptor(id, target, probe)
  const dfsRoot = joinPath(deno().env.get('BUCKYOS_ROOT') || '/opt/buckyos', 'data')

  const expand = (sources: ToolSource[], field: string, shell: ShellSettings, fsPolicy: string, env: Record<string, string>,
    tools: Map<string, NativeTool>): ResolvedTool[] => {
    const out: ResolvedTool[] = []
    for (const src of sources) {
      const desc = describeToolSource(src)
      if (src.kind === 'mcp') throw XllmError.capability(`${field}: \`${desc}\`: MCP tools are not available on the Deno host`)
      if (src.kind === 'named') throw XllmError.capability(`${field}: \`${desc}\`: named host tools are not available on the Deno host (only the \`bash\` group)`)
      if (src.groupname === BUILTIN_TOOL_GROUP_BASH_CORE || src.groupname === 'executor') {
        throw XllmError.capability(`${field}: \`${desc}\` needs a host task CLI / executor that the Deno host does not provide (use \`bash\`)`)
      }
      if (src.groupname !== BUILTIN_TOOL_GROUP_BASH) {
        throw XllmError.tools(`unknown builtin tool group \`${src.groupname}\` (available: ${BUILTIN_TOOL_GROUP_BASH}, ${BUILTIN_TOOL_GROUP_BASH_CORE}, executor)`)
      }
      if (shellNeedsTasks(shell)) {
        throw XllmError.capability(`${field}: \`shell\` would hand commands still running after runtime.task_wait_ms (${shell.wait_ms} ms) to a task backend, which the Deno host does not have; set runtime.task_wait_ms to at least tools.shell.timeout_ms (${shell.timeout_ms} ms) so \`shell\` waits for its command`)
      }
      const restrict = fsPolicy === 'workspace'
      const fileCfg: FileToolConfig = {
        root: info.cwd, allowedRead: restrict ? [info.cwd] : [], allowedWrite: restrict ? [info.cwd] : [], dfsRoot,
      }
      const group = [
        readFileTool(fileCfg), writeFileTool(fileCfg), editFileTool(fileCfg),
        shellTool({ workspace: info.cwd, restrictCwd: restrict, timeoutMs: shell.timeout_ms, maxTimeoutMs: shell.max_timeout_ms, env }),
      ]
      for (const t of group) {
        if (tools.has(t.spec.name)) {
          throw XllmError.tools(`tool name \`${t.spec.name}\` from ${desc} conflicts with an already expanded tool of the same name`)
        }
        tools.set(t.spec.name, t)
        out.push({ name: t.spec.name, description: t.spec.description, args_schema: cloneJson(t.spec.args_schema), source: desc })
      }
    }
    return out
  }

  let openedNames: string[] | undefined
  const runtime: NativeRuntime = {
    kind: NATIVE_KIND,
    probe,
    descriptor: () => cloneJson(descriptor),
    config: () => cloneJson(config),
    // After `open`, the info of the opened tool set (Rust prompts read the manager's: probed
    // commands and the run's tool names, sorted, at most 32).
    async info(): Promise<RuntimeInfo> {
      const now = await localProbe(info.cwd, config.env)
      const tools = openedNames ? [...new Set([...info.tools, ...openedNames])].sort().slice(0, 32) : info.tools
      return { ...cloneJson(info), tools, current_time: now.current_time, timezone: now.timezone }
    },
    // deno-lint-ignore require-await
    async open(ctx: RuntimeOpenCtx, requested: ToolsConfig): Promise<OpenedTools> {
      validateEnv(ctx.env)
      const env: Record<string, string> = { ...config.env, ...ctx.env }
      env.PATH = env.PATH ?? probe.path
      const take = options.takeover && options.takeover.run_id === ctx.run_id ? options.takeover.tools : undefined
      const cfg: ToolsConfig = take
        ? {
          enabled: take.enabled, filesystem_policy: take.filesystem_policy, tools2actions: take.tools2actions, tools: take.tool_sources,
          actions: take.action_sources, bash_tools: take.bash_tools, shell: { timeout_ms: take.shell.timeout_ms, max_timeout_ms: take.shell.max_timeout_ms },
        }
        : requested
      const enabled = cfg.enabled ?? false
      const fsPolicy = cfg.filesystem_policy ?? 'workspace'
      const tools2actions = cfg.tools2actions ?? false
      const shell = shellSettings(cfg.shell, ctx.task_wait_ms)
      const loop: LoopModel = ctx.loop_model
      const eff: EffectiveTools = {
        enabled, filesystem_policy: fsPolicy, tools2actions, tool_sources: cloneJson(cfg.tools ?? []), action_sources: cloneJson(cfg.actions ?? []),
        native: [], actions: [], bash_tools: cloneJson(cfg.bash_tools ?? []), shell, exec_enabled: false, sources: { ...ctx.sources },
      }
      if (loop === 'function_call') {
        if (tools2actions) {
          throw XllmError.capability('`tools2actions: true` requires `loop_model: behavior`; function_call cannot convert tools into actions')
        }
        if ((cfg.actions ?? []).length > 0) {
          throw XllmError.capability('`actions` are configured but `loop_model` is function_call; use `loop_model: behavior` or remove `actions`')
        }
      }
      const tools = new Map<string, NativeTool>()
      if (enabled) {
        const toolSources = cfg.tools ?? [{ kind: 'group', groupname: BUILTIN_TOOL_GROUP_BASH }]
        eff.tool_sources = cloneJson(toolSources)
        const native = expand(toolSources, 'tools.tools', shell, fsPolicy, env, tools)
        const explicit = expand(eff.action_sources, 'tools.actions', shell, fsPolicy, env, tools)
        if (loop === 'behavior' && tools2actions) {
          eff.actions = [...native, ...explicit]
        } else {
          eff.native = native
          eff.actions = explicit
        }
        eff.exec_enabled = tools.has(TOOL_SHELL) && [...eff.native, ...eff.actions].some(t => t.name === TOOL_SHELL)
      }
      let advertised: Map<string, ToolSpecLite> | undefined
      if (take) {
        advertised = new Map()
        for (const t of [...take.native, ...take.actions]) {
          if (tools.has(t.name)) advertised.set(t.name, { name: t.name, description: t.description, args_schema: cloneJson(t.args_schema) })
        }
      }
      openedNames = [...eff.native, ...eff.actions].map(t => t.name)
      return { tools: eff, manager: new NativeToolManager(tools, info.cwd, advertised) }
    },
    async describeInterrupted(run: RunBinding, call: AiToolCall): Promise<string> {
      if (call.name !== TOOL_SHELL) return unresolvedReason(call.name)
      const dir = execDirFor(run.run_dir, call.call_id)
      if (dir === undefined) return interruptedShellText(call, undefined, '(no execution directory)')
      return interruptedShellText(call, await readExecDir(dir), dir)
    },
  }
  return runtime
}

// ------------------------------------------------------------- describe_interrupted

/** What a `shell` command's execution directory says (`ExecDirFacts`). */
export interface ExecDirFacts {
  exit_code?: number
  stdout_tail: string
  stderr_tail: string
  exists: boolean
  /** mtime of `command`: when the command was written there. */
  started_at_ms?: number
}

export async function readExecDir(dir: string): Promise<ExecDirFacts> {
  let started: number | undefined
  try {
    const m = (await deno().stat(joinPath(dir, 'command'))).mtime
    if (m) started = Math.floor(m.getTime())
  } catch {
    started = undefined
  }
  return {
    exit_code: await readExitFile(dir),
    stdout_tail: await readFileTail(joinPath(dir, 'stdout'), OUTPUT_TAIL_BYTES),
    stderr_tail: await readFileTail(joinPath(dir, 'stderr'), OUTPUT_TAIL_BYTES),
    exists: await isDir(dir),
    started_at_ms: started,
  }
}

function shellCommandOf(call: AiToolCall): string {
  const c = call.args?.command
  if (typeof c !== 'string') return ''
  const one = c.split(/\s+/).filter(Boolean).join(' ')
  const chars = [...one]
  return chars.length > 160 ? `${chars.slice(0, 160).join('')}…` : one
}

function tails(f: ExecDirFacts): string {
  let s = ''
  if (f.stdout_tail.trim()) s += `\n--- stdout (tail) ---\n${f.stdout_tail.trimEnd()}`
  if (f.stderr_tail.trim()) s += `\n--- stderr (tail) ---\n${f.stderr_tail.trimEnd()}`
  return s
}

/** `interrupted_shell_text` for the native kind. */
export function interruptedShellText(call: AiToolCall, facts: ExecDirFacts | undefined, location: string): string {
  const command = shellCommandOf(call)
  const started = facts?.started_at_ms !== undefined
    ? `started ${fmtElapsed(Math.max(0, Date.now() - facts.started_at_ms))} ago (at ${facts.started_at_ms} ms since epoch)`
    : 'start time unknown'
  if (facts?.exit_code !== undefined) {
    return `shell (native): the previous executor exited while \`${command}\` was running (${started}). The command has since ended with exit code ${facts.exit_code} (read from ${location}); its result was never returned, so review it before deciding whether to repeat anything.${tails(facts)}`
  }
  return `shell (native): the previous executor exited while \`${command}\` was running (${started}). The command may have partly executed; it usually ended together with the executor, but not necessarily (e.g. after kill -9 it may still be running). Background processes it started are unaffected. Check the actual state before repeating it.${facts ? tails(facts) : ''}`
}
