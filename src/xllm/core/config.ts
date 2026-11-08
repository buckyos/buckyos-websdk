// `.llm_context` in its JSON form (`parse_llm_context_file`,
// `merge_config_layers`, `compute_tools_config` in xllm.rs). There is no
// file discovery: the configuration is one JSON object with the same schema
// and the same strict keys; unknown fields, wrong types and alias conflicts
// are `XllmError` config errors naming the field.

import type {
  BashToolManual, FilesystemPolicy, GroupDef, JsonValue, LlmContextFile, LoopModel, PromptConfig, PromptMode, ProviderConfig,
  ProviderKind, ResultFormat, RunLogLevel, RunsDirSetting, RuntimeConfig, SectionDef, ShellSettings, ShellToolConfig, ToolSource,
  ToolsConfig,
} from './types'
import { XllmError } from './errors'
import { isObject } from './json'
import { aliasLine, resolveSectionKey } from './prompt'

export const DEFAULT_MAX_TOOL_ITERATIONS = 8
export const DEFAULT_TIMEOUT_SECS = 3600
export const DEFAULT_LLM_TIMEOUT_SECS = 600
export const DEFAULT_CONTEXT_YIELD_RATIO = 0.8
export const DEFAULT_MAX_CONSECUTIVE_ERRORS = 3
export const DEFAULT_TASK_WAIT_MS = 25_000
export const MAX_IN_TOOL_WAIT_MS = 30 * 60_000
export const EXEC_DEFAULT_TIMEOUT_MS = 1_800_000
export const EXEC_MAX_TIMEOUT_MS = 3_600_000
export const BUILTIN_TOOL_GROUP_BASH = 'bash'
export const BUILTIN_TOOL_GROUP_BASH_CORE = 'bash_core'
/** Runtime kinds named by the design but not implemented by any executor. */
export const PLANNED_RUNTIME_KINDS = ['container', 'container_host', 'http_proxy_runtime']
/** Runtime kinds the TS runtime knows (`site` is TS-only; Rust reports it as planned). */
export const KNOWN_RUNTIME_KINDS = ['native', 'remote_ssh', 'remote_node', 'site']

type Obj = { [key: string]: JsonValue }

function kindOf(v: JsonValue | undefined): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'boolean') return 'bool'
  if (typeof v === 'number') return 'number'
  if (typeof v === 'string') return 'string'
  if (Array.isArray(v)) return 'list'
  return 'object'
}

function joinField(base: string, key: string): string {
  return base ? `${base}.${key}` : key
}

class Ctx {
  constructor(readonly file: string) {}

  err(field: string, reason: string): XllmError {
    return XllmError.config(this.file, field, reason)
  }

  map(field: string, v: JsonValue | undefined): Obj {
    if (!isObject(v)) throw this.err(field, `expected an object, got ${kindOf(v)}`)
    return v
  }

  keys(field: string, m: Obj, allowed: string[]) {
    for (const k of Object.keys(m)) {
      if (!allowed.includes(k)) throw this.err(joinField(field, k), `unknown field; allowed: ${allowed.join(', ')}`)
    }
  }

  str(field: string, m: Obj, key: string): string | undefined {
    const v = m[key]
    if (v === undefined || v === null) return undefined
    if (typeof v === 'string') return v
    if (typeof v === 'number' || typeof v === 'boolean') return String(v)
    throw this.err(joinField(field, key), `expected a string, got ${kindOf(v)}`)
  }

  bool(field: string, m: Obj, key: string): boolean | undefined {
    const v = m[key]
    if (v === undefined || v === null) return undefined
    if (typeof v === 'boolean') return v
    throw this.err(joinField(field, key), `expected true/false, got ${kindOf(v)}`)
  }

  u64(field: string, m: Obj, key: string): number | undefined {
    const v = m[key]
    if (v === undefined || v === null) return undefined
    if (typeof v !== 'number') throw this.err(joinField(field, key), `expected an integer, got ${kindOf(v)}`)
    if (!Number.isInteger(v) || v < 0) throw this.err(joinField(field, key), 'expected a non-negative integer')
    return v
  }

  u32(field: string, m: Obj, key: string): number | undefined {
    const v = this.u64(field, m, key)
    if (v !== undefined && v > 0xffffffff) throw this.err(joinField(field, key), 'value too large')
    return v
  }

  f32(field: string, m: Obj, key: string): number | undefined {
    const v = m[key]
    if (v === undefined || v === null) return undefined
    if (typeof v !== 'number') throw this.err(joinField(field, key), `expected a number, got ${kindOf(v)}`)
    if (!Number.isFinite(v)) throw this.err(joinField(field, key), 'expected a finite number')
    return v
  }
}

/** Lexical path normalization (no filesystem access). */
export function normalizePath(p: string): string {
  const abs = p.startsWith('/')
  const out: string[] = []
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop()
      else if (!abs) out.push('..')
    } else out.push(part)
  }
  return (abs ? '/' : '') + out.join('/')
}

function dirname(p: string): string {
  const i = p.lastIndexOf('/')
  return i < 0 ? '' : i === 0 ? '/' : p.slice(0, i)
}

/** `resolve_config_path`: `~` stays for the host to expand, absolute paths as they are, the rest under `baseDir`. */
export function resolveConfigPath(raw: string, baseDir: string, home?: string): string {
  const t = raw.trim()
  if ((t === '~' || t.startsWith('~/')) && home !== undefined) return normalizePath(`${home}/${t.slice(1).replace(/^\/+/, '')}`)
  if (t.startsWith('/') || t.startsWith('~')) return t
  return normalizePath(baseDir ? `${baseDir}/${t}` : t)
}

function parseSections(ctx: Ctx, field: string, v: JsonValue, source: string): Record<string, SectionDef> {
  const m = ctx.map(field, v)
  const out: Record<string, SectionDef> = {}
  for (const [key, entry] of Object.entries(m)) {
    const entryField = joinField(field, key)
    const line = resolveSectionKey(key)
    if (typeof line === 'string') throw ctx.err(entryField, line)
    let name: string | undefined
    let text: string | undefined
    if (typeof entry === 'string') text = entry
    else if (entry === null) text = ''
    else if (isObject(entry)) {
      ctx.keys(entryField, entry, ['name', 'text'])
      name = ctx.str(entryField, entry, 'name')
      const t = entry.text
      if (t === undefined) text = undefined
      else if (t === null) text = ''
      else if (typeof t === 'string') text = t
      else throw ctx.err(joinField(entryField, 'text'), `expected a string, got ${kindOf(t)}`)
    } else {
      throw ctx.err(entryField, `expected a string or an object with \`name\`/\`text\`, got ${kindOf(entry)}`)
    }
    if (name !== undefined) {
      const al = aliasLine(name)
      if (al !== undefined && al !== line) {
        throw ctx.err(entryField, `name \`${name}\` is a fixed alias bound to line ${al}, but this section is at line ${line}`)
      }
    }
    const prev = out[String(line)]
    if (prev) throw ctx.err(field, `sections \`${prev.key}\` and \`${key}\` both resolve to line ${line}`)
    const def: SectionDef = { key, source }
    if (name !== undefined) def.name = name
    if (text !== undefined) def.text = text
    out[String(line)] = def
  }
  return out
}

function parseToolSources(ctx: Ctx, field: string, v: JsonValue): ToolSource[] {
  if (v === null) return []
  if (!Array.isArray(v)) throw ctx.err(field, `expected a list, got ${kindOf(v)}`)
  return v.map((item, idx) => {
    const f = `${field}[${idx}]`
    const m = ctx.map(f, item)
    ctx.keys(f, m, ['groupname', 'mcp', 'name'])
    const groupname = ctx.str(f, m, 'groupname')
    const mcp = ctx.str(f, m, 'mcp')
    const name = ctx.str(f, m, 'name')
    if ([groupname, mcp, name].filter(x => x !== undefined).length !== 1) {
      throw ctx.err(f, 'exactly one of `groupname`, `mcp`, `name` must be set')
    }
    if (groupname !== undefined) return { kind: 'group', groupname: groupname.trim() }
    if (mcp !== undefined) return { kind: 'mcp', endpoint: mcp.trim() }
    return { kind: 'named', name: (name as string).trim() }
  })
}

function parseToolsConfig(ctx: Ctx, field: string, v: JsonValue): ToolsConfig {
  if (typeof v === 'boolean') return { enabled: v }
  const m = ctx.map(field, v)
  ctx.keys(field, m, ['enabled', 'filesystem_policy', 'tools2actions', 'tools', 'actions', 'bash_tools', 'shell'])
  const cfg: ToolsConfig = {}
  const enabled = ctx.bool(field, m, 'enabled')
  if (enabled !== undefined) cfg.enabled = enabled
  const fp = ctx.str(field, m, 'filesystem_policy')
  if (fp !== undefined) {
    const p = fp.trim().toLowerCase()
    if (p !== 'workspace' && p !== 'unrestricted') {
      throw ctx.err(joinField(field, 'filesystem_policy'), `unsupported filesystem_policy \`${fp}\` (supported: workspace, unrestricted)`)
    }
    cfg.filesystem_policy = p as FilesystemPolicy
  }
  const t2a = ctx.bool(field, m, 'tools2actions')
  if (t2a !== undefined) cfg.tools2actions = t2a
  if (m.tools !== undefined) cfg.tools = parseToolSources(ctx, joinField(field, 'tools'), m.tools)
  if (m.actions !== undefined) cfg.actions = parseToolSources(ctx, joinField(field, 'actions'), m.actions)
  if (m.bash_tools !== undefined) {
    const bf = joinField(field, 'bash_tools')
    const items = m.bash_tools
    if (items === null) cfg.bash_tools = []
    else if (Array.isArray(items)) {
      cfg.bash_tools = items.map((item, idx): BashToolManual => {
        const ef = `${bf}[${idx}]`
        const o = ctx.map(ef, item)
        ctx.keys(ef, o, ['name', 'description', 'command', 'usage'])
        const name = ctx.str(ef, o, 'name')
        if (!name?.trim()) throw ctx.err(ef, '`name` is required')
        const description = ctx.str(ef, o, 'description')
        if (description === undefined) throw ctx.err(ef, '`description` is required')
        const command = ctx.str(ef, o, 'command')
        if (!command?.trim()) throw ctx.err(ef, '`command` is required')
        const usage = ctx.str(ef, o, 'usage')
        return usage === undefined ? { name, description, command } : { name, description, command, usage }
      })
    } else throw ctx.err(bf, `expected a list, got ${kindOf(items)}`)
  }
  if (m.shell !== undefined && m.shell !== null) {
    const sf = joinField(field, 'shell')
    const o = ctx.map(sf, m.shell)
    ctx.keys(sf, o, ['timeout_ms', 'max_timeout_ms'])
    const shell: ShellToolConfig = {}
    const t = ctx.u64(sf, o, 'timeout_ms')
    const mx = ctx.u64(sf, o, 'max_timeout_ms')
    if (t !== undefined) shell.timeout_ms = t
    if (mx !== undefined) shell.max_timeout_ms = mx
    cfg.shell = shell
  }
  return cfg
}

function parseGroup(ctx: Ctx, field: string, v: JsonValue, source: string): GroupDef {
  const m = ctx.map(field, v)
  ctx.keys(field, m, ['default_user', 'sections', 'tools'])
  const g: GroupDef = { sources: [source] }
  const du = ctx.str(field, m, 'default_user')
  if (du !== undefined) g.default_user = du
  if (m.sections !== undefined && m.sections !== null) g.sections = parseSections(ctx, joinField(field, 'sections'), m.sections, source)
  if (m.tools !== undefined && m.tools !== null) g.tools = parseToolsConfig(ctx, joinField(field, 'tools'), m.tools)
  return g
}

function parseProvider(ctx: Ctx, field: string, v: JsonValue): ProviderConfig {
  const m = ctx.map(field, v)
  ctx.keys(field, m, ['type', 'session_token', 'base_url', 'api_key', 'api_key_env', 'headers', 'on_behalf_of'])
  const p: ProviderConfig = {}
  const type = ctx.str(field, m, 'type')
  if (type !== undefined) {
    const k = type.trim().toLowerCase()
    if (k !== 'buckyos' && k !== 'openai') {
      throw ctx.err(joinField(field, 'type'), `unsupported provider type \`${type}\` (supported: buckyos, openai)`)
    }
    p.kind = k as ProviderKind
  }
  if (ctx.str(field, m, 'session_token')?.trim()) p.session_token = { kind: 'config_file', path: ctx.file, field: joinField(field, 'session_token') }
  const baseUrl = ctx.str(field, m, 'base_url')
  if (baseUrl !== undefined) p.base_url = baseUrl
  if (ctx.str(field, m, 'api_key')?.trim()) p.api_key = { kind: 'config_file', path: ctx.file, field: joinField(field, 'api_key') }
  const envName = ctx.str(field, m, 'api_key_env')
  if (envName?.trim()) {
    if (p.api_key) throw ctx.err(field, '`api_key` and `api_key_env` are mutually exclusive')
    p.api_key = { kind: 'env', name: envName }
  }
  if (m.headers !== undefined) {
    const hf = joinField(field, 'headers')
    const hm = ctx.map(hf, m.headers)
    const headers: Record<string, string> = {}
    for (const key of Object.keys(hm)) {
      const val = ctx.str(hf, hm, key)
      if (val === undefined) throw ctx.err(joinField(hf, key), 'header value must be a string')
      headers[key] = val
    }
    p.headers = headers
  }
  if (m.on_behalf_of !== undefined) {
    if (!isObject(m.on_behalf_of)) throw ctx.err(joinField(field, 'on_behalf_of'), 'invalid on_behalf_of: expected an object')
    p.on_behalf_of = m.on_behalf_of
  }
  return p
}

function parseRuntime(ctx: Ctx, v: JsonValue, baseDir: string): RuntimeConfig {
  const m = ctx.map('runtime', v)
  const kind = typeof m.kind === 'string' ? m.kind : undefined
  if (kind && PLANNED_RUNTIME_KINDS.includes(kind)) throw XllmError.capability(`runtime \`${kind}\` is planned but not implemented`)
  const allowed = ['kind', 'id', 'workdir', 'env', 'remote_ssh', 'remote_node', 'baseline', 'task_wait_ms']
  for (const k of Object.keys(m)) if (!allowed.includes(k)) throw ctx.err('runtime', `unknown field \`${k}\`, expected one of ${allowed.map(a => `\`${a}\``).join(', ')}`)
  const r: RuntimeConfig = { env: {} }
  if (m.kind !== undefined) {
    if (typeof m.kind !== 'string') throw ctx.err('runtime', 'kind: expected a string')
    if (!KNOWN_RUNTIME_KINDS.includes(m.kind)) throw ctx.err('runtime', `unknown runtime kind \`${m.kind}\``)
    r.kind = m.kind
  }
  for (const key of ['id', 'workdir'] as const) {
    const val = m[key]
    if (val === undefined || val === null) continue
    if (typeof val !== 'string') throw ctx.err('runtime', `${key}: expected a string`)
    r[key] = val
  }
  if (r.id !== undefined && !r.id.trim()) throw ctx.err('runtime', 'id cannot be empty')
  if (m.env !== undefined && m.env !== null) {
    if (!isObject(m.env)) throw ctx.err('runtime', 'env: expected a map')
    for (const [k, val] of Object.entries(m.env)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) || typeof val !== 'string' || val.includes('\0')) {
        throw ctx.err('runtime', `invalid env key or value \`${k}\``)
      }
      r.env[k] = val
    }
  }
  if (m.baseline !== undefined && m.baseline !== null) {
    if (m.baseline !== 'standard' && m.baseline !== 'extended') throw ctx.err('runtime', 'baseline: expected `standard` or `extended`')
    r.baseline = m.baseline
  }
  if (m.task_wait_ms !== undefined && m.task_wait_ms !== null) {
    const t = m.task_wait_ms
    if (typeof t !== 'number' || !Number.isInteger(t) || t < 0) throw ctx.err('runtime', 'task_wait_ms: expected a non-negative integer')
    if (t === 0) throw ctx.err('runtime', 'task_wait_ms must be positive')
    r.task_wait_ms = t
  }
  for (const block of ['remote_ssh', 'remote_node'] as const) {
    const b = m[block]
    if (b === undefined || b === null) continue
    if (!isObject(b)) throw ctx.err('runtime', `${block}: expected a map`)
    const fields = block === 'remote_ssh' ? ['host', 'user', 'port', 'identity_file'] : ['node_did', 'executor_id', 'profile_id']
    for (const k of Object.keys(b)) if (!fields.includes(k)) throw ctx.err('runtime', `${block}: unknown field \`${k}\``)
    if (r.kind !== undefined && r.kind !== block) throw ctx.err('runtime', `${block} connection block requires kind: ${block}`)
    ;(r as unknown as Record<string, unknown>)[block] = { ...b }
  }
  if (r.kind !== undefined && r.kind !== 'remote_ssh' && r.kind !== 'remote_node' && r.workdir !== undefined) {
    r.workdir = resolveConfigPath(r.workdir, baseDir)
  }
  return r
}

/** Parse one `.llm_context` JSON object. `file` names it in diagnostics. */
export function parseLlmContextJson(file: string, value: JsonValue | undefined): LlmContextFile {
  const ctx = new Ctx(file)
  if (value === null || value === undefined) return {}
  const baseDir = dirname(file)
  const m = ctx.map('(root)', value)
  ctx.keys('', m, [
    'provider', 'runtime', 'model', 'file_model', 'max_tokens', 'max_tool_iterations', 'llm_timeout', 'context_window',
    'context_yield_ratio', 'timeout', 'runs_dir', 'loop_model', 'run_logs', 'result_format', 'json', 'json_schema', 'tools', 'prompt',
  ])
  const f: LlmContextFile = {}
  if (m.runtime !== undefined && m.runtime !== null) f.runtime = parseRuntime(ctx, m.runtime, baseDir)
  if (m.provider !== undefined && m.provider !== null) f.provider = parseProvider(ctx, 'provider', m.provider)
  const model = ctx.str('', m, 'model')
  if (model?.trim()) f.model = model
  const fileModel = ctx.str('', m, 'file_model')
  if (fileModel?.trim()) f.file_model = fileModel
  const assign = <K extends keyof LlmContextFile>(k: K, v: LlmContextFile[K] | undefined) => {
    if (v !== undefined) f[k] = v
  }
  assign('max_tokens', ctx.u32('', m, 'max_tokens'))
  assign('max_tool_iterations', ctx.u32('', m, 'max_tool_iterations'))
  assign('llm_timeout', ctx.u64('', m, 'llm_timeout'))
  assign('context_window', ctx.u32('', m, 'context_window'))
  const ratio = ctx.f32('', m, 'context_yield_ratio')
  if (ratio !== undefined && !(ratio > 0 && ratio <= 1)) throw ctx.err('context_yield_ratio', 'must be in (0, 1]')
  assign('context_yield_ratio', ratio)
  assign('timeout', ctx.u64('', m, 'timeout'))
  if ('runs_dir' in m) {
    const rd = m.runs_dir
    let setting: RunsDirSetting
    if (rd === null) setting = { kind: 'disabled' }
    else if (typeof rd === 'string') {
      if (rd.trim().toLowerCase() === 'none') setting = { kind: 'disabled' }
      else if (!rd.trim()) throw ctx.err('runs_dir', 'must be a path or `none`')
      else setting = { kind: 'path', path: resolveConfigPath(rd, baseDir) }
    } else throw ctx.err('runs_dir', `expected a path string or \`none\`, got ${kindOf(rd)}`)
    f.runs_dir = setting
  }
  const loop = ctx.str('', m, 'loop_model')
  if (loop !== undefined) {
    const l = loop.trim().toLowerCase()
    if (l !== 'function_call' && l !== 'behavior') throw ctx.err('loop_model', `unsupported loop_model \`${loop}\` (supported: function_call, behavior)`)
    f.loop_model = l as LoopModel
  }
  const logs = ctx.str('', m, 'run_logs')
  if (logs !== undefined) {
    const l = logs.trim().toLowerCase()
    if (!['debug', 'info', 'warn', 'result'].includes(l)) {
      throw ctx.err('run_logs', `unsupported run_logs \`${logs}\` (supported: debug, info, warn, result)`)
    }
    f.run_logs = l as RunLogLevel
  }
  const rf = ctx.str('', m, 'result_format')
  if (rf !== undefined) {
    try {
      f.result_format = parseResultFormat(rf)
    } catch (e) {
      throw ctx.err('result_format', e instanceof Error ? e.message : String(e))
    }
  }
  assign('json', ctx.bool('', m, 'json'))
  if (m.json_schema !== undefined && m.json_schema !== null) {
    if (!isObject(m.json_schema)) throw ctx.err('json_schema', `expected a JSON Schema object, got ${kindOf(m.json_schema)}`)
    f.json_schema = m.json_schema
  }
  if (m.tools !== undefined && m.tools !== null) f.tools = parseToolsConfig(ctx, 'tools', m.tools)
  if (m.prompt !== undefined && m.prompt !== null) f.prompt = parsePrompt(ctx, m.prompt, file)
  return f
}

function parsePrompt(ctx: Ctx, v: JsonValue, file: string): PromptConfig {
  const pm = ctx.map('prompt', v)
  ctx.keys('prompt', pm, ['mode', 'select', 'groups', 'sections', 'tools', 'system'])
  const p: PromptConfig = {}
  const mode = ctx.str('prompt', pm, 'mode')
  if (mode !== undefined) {
    const md = mode.trim().toLowerCase()
    if (md !== 'standard' && md !== 'custom') throw ctx.err('prompt.mode', `unsupported mode \`${md}\` (supported: standard, custom)`)
    p.mode = md as PromptMode
  }
  const select = ctx.str('prompt', pm, 'select')
  if (select?.trim()) p.select = select
  const system = ctx.str('prompt', pm, 'system')
  if (system !== undefined) p.system = system
  if (pm.groups !== undefined && pm.groups !== null) {
    const gm = ctx.map('prompt.groups', pm.groups)
    const groups: Record<string, GroupDef> = {}
    for (const [name, gv] of Object.entries(gm)) {
      if (typeof gv === 'string') {
        throw XllmError.capability(`${file}: prompt.groups.${name}: external group files are not supported by this executor; inline the group`)
      }
      groups[name] = parseGroup(ctx, `prompt.groups.${name}`, gv, file)
    }
    p.groups = groups
  }
  if (pm.sections !== undefined && pm.sections !== null) p.sections = parseSections(ctx, 'prompt.sections', pm.sections, file)
  if (pm.tools !== undefined && pm.tools !== null) p.tools = parseToolsConfig(ctx, 'prompt.tools', pm.tools)
  if (p.mode === 'custom' && (p.select !== undefined || Object.keys(p.sections ?? {}).length > 0)) {
    throw ctx.err('prompt.mode', 'mode `custom` cannot be combined with `select` or `sections` in the same file')
  }
  if (p.mode === 'custom' && p.system === undefined) throw ctx.err('prompt.system', 'mode `custom` requires `prompt.system`')
  return p
}

export function parseResultFormat(s: string): ResultFormat {
  const t = s.trim()
  if (t.toLowerCase() === 'raw') return { kind: 'raw' }
  if (!t.startsWith('result.')) throw XllmError.input(`invalid result_format \`${t}\`: expected \`raw\` or \`result.<path>\``)
  const segments = t.slice('result.'.length).split('.').map(p => p.trim())
  if (segments.some(p => !p)) throw XllmError.input(`invalid result_format \`${t}\`: empty path segment`)
  return { kind: 'path', segments }
}

export function resultFormatString(f: ResultFormat): string {
  return f.kind === 'raw' ? 'raw' : `result.${f.segments.join('.')}`
}

// ------------------------------------------------------------------- merging

export interface MergedConfig {
  runtime: RuntimeConfig
  provider: ProviderConfig
  model?: string
  file_model?: string
  max_tokens?: number
  max_tool_iterations?: number
  llm_timeout?: number
  context_window?: number
  context_yield_ratio?: number
  timeout?: number
  runs_dir?: RunsDirSetting
  loop_model?: LoopModel
  run_logs?: RunLogLevel
  result_format?: ResultFormat
  json?: boolean
  json_schema?: JsonValue
  tools: ToolsConfig
  prompt: PromptConfig
  sources: Record<string, string>
  files: string[]
}

export function mergeToolsConfig(base: ToolsConfig, over: ToolsConfig): ToolsConfig {
  const out: ToolsConfig = { ...base }
  for (const k of ['enabled', 'filesystem_policy', 'tools2actions', 'tools', 'actions', 'bash_tools'] as const) {
    if (over[k] !== undefined) (out as Record<string, unknown>)[k] = over[k]
  }
  if (over.shell) {
    const sh: ShellToolConfig = { ...(out.shell ?? {}) }
    if (over.shell.timeout_ms !== undefined) sh.timeout_ms = over.shell.timeout_ms
    if (over.shell.max_timeout_ms !== undefined) sh.max_timeout_ms = over.shell.max_timeout_ms
    out.shell = sh
  }
  return out
}

function mergeRuntime(base: RuntimeConfig, over: RuntimeConfig): RuntimeConfig {
  let out: RuntimeConfig = { ...base, env: { ...base.env } }
  const baseKind = base.kind ?? 'native'
  if (over.kind !== undefined && over.kind !== baseKind) out = { env: {} }
  for (const k of ['kind', 'id', 'workdir', 'baseline', 'task_wait_ms'] as const) {
    if (over[k] !== undefined) (out as unknown as Record<string, unknown>)[k] = over[k]
  }
  Object.assign(out.env, over.env)
  if (over.remote_node) out.remote_node = { ...(out.remote_node ?? {}), ...over.remote_node }
  if (over.remote_ssh) out.remote_ssh = { ...(out.remote_ssh ?? {}), ...over.remote_ssh }
  return out
}

/** Merge parsed layers, ancestor first (`merge_config_layers`). */
export function mergeConfigLayers(layers: { path: string; file: LlmContextFile }[]): MergedConfig {
  const merged: MergedConfig = { runtime: { env: {} }, provider: {}, tools: {}, prompt: {}, sources: {}, files: [] }
  for (const { path: src, file: f } of layers) {
    merged.files.push(src)
    if (f.runtime) {
      merged.runtime = mergeRuntime(merged.runtime, f.runtime)
      merged.sources.runtime = src
    }
    if (f.provider) {
      const p = f.provider
      if (p.kind !== undefined && merged.provider.kind !== undefined && p.kind !== merged.provider.kind) merged.provider = {}
      if (p.kind !== undefined) {
        merged.provider.kind = p.kind
        merged.sources['provider.type'] = src
      }
      for (const [k, srcKey] of [['session_token', 'provider.session_token'], ['base_url', 'provider.base_url'],
        ['api_key', 'provider.api_key'], ['on_behalf_of', 'provider.on_behalf_of']] as const) {
        if (p[k] !== undefined) {
          (merged.provider as Record<string, unknown>)[k] = p[k]
          merged.sources[srcKey] = src
        }
      }
      if (p.headers) merged.provider.headers = { ...(merged.provider.headers ?? {}), ...p.headers }
    }
    for (const k of ['model', 'file_model', 'max_tokens', 'max_tool_iterations', 'llm_timeout', 'context_window',
      'context_yield_ratio', 'timeout', 'runs_dir', 'loop_model', 'run_logs', 'result_format', 'json', 'json_schema'] as const) {
      if (f[k] !== undefined) {
        (merged as unknown as Record<string, unknown>)[k] = f[k]
        merged.sources[k] = src
      }
    }
    if (f.tools) {
      merged.tools = mergeToolsConfig(merged.tools, f.tools)
      merged.sources.tools = src
      if (f.tools.filesystem_policy !== undefined) merged.sources['tools.filesystem_policy'] = src
    }
    if (f.prompt) mergePrompt(merged, f.prompt, src)
  }
  return merged
}

function mergePrompt(merged: MergedConfig, p: PromptConfig, src: string) {
  const mp = merged.prompt
  if (p.mode !== undefined) {
    mp.mode = p.mode
    merged.sources['prompt.mode'] = src
    if (p.mode === 'custom') {
      delete mp.select
      mp.sections = {}
    }
    if (p.mode === 'standard') delete mp.system
  }
  if (p.select !== undefined) {
    mp.select = p.select
    merged.sources['prompt.select'] = src
    if (mp.mode === 'custom' && p.mode === undefined) {
      mp.mode = 'standard'
      delete mp.system
    }
  }
  if (p.system !== undefined) {
    mp.system = p.system
    merged.sources['prompt.system'] = src
  }
  for (const [name, def] of Object.entries(p.groups ?? {})) {
    const groups = mp.groups ?? (mp.groups = {})
    const existing = groups[name]
    if (existing) {
      if (def.default_user !== undefined) existing.default_user = def.default_user
      existing.sections = { ...(existing.sections ?? {}), ...(def.sections ?? {}) }
      if (def.tools) existing.tools = existing.tools ? mergeToolsConfig(existing.tools, def.tools) : def.tools
      for (const s of def.sources) if (!existing.sources.includes(s)) existing.sources.push(s)
    } else {
      groups[name] = JSON.parse(JSON.stringify(def))
    }
    merged.sources[`prompt.groups.${name}`] = src
  }
  for (const [line, def] of Object.entries(p.sections ?? {})) {
    mp.sections = { ...(mp.sections ?? {}), [line]: def }
    merged.sources[`prompt.sections.${line}`] = src
    if (mp.mode === 'custom' && p.mode === undefined) {
      mp.mode = 'standard'
      delete mp.system
    }
  }
  if (p.tools) {
    mp.tools = mp.tools ? mergeToolsConfig(mp.tools, p.tools) : p.tools
    merged.sources['prompt.tools'] = src
    if (p.tools.filesystem_policy !== undefined) merged.sources['prompt.tools.filesystem_policy'] = src
  }
}

/** Tool configuration before expansion: defaults → top `tools` → selected group → `prompt.tools` → explicit switch. */
export function computeToolsConfig(merged: MergedConfig, group: GroupDef | undefined, cliTools: boolean | undefined,
  includeGroup: boolean): { cfg: ToolsConfig; sources: Record<string, string> } {
  let cfg: ToolsConfig = mergeToolsConfig({}, merged.tools)
  const sources: Record<string, string> = {}
  const top = merged.sources.tools ?? 'default'
  for (const k of ['enabled', 'tools2actions', 'tools', 'actions', 'bash_tools', 'shell']) sources[k] = top
  sources.filesystem_policy = merged.sources['tools.filesystem_policy'] ?? 'default'
  const mark = (t: ToolsConfig, src: string, fpSrc?: string) => {
    if (t.enabled !== undefined) sources.enabled = src
    if (t.filesystem_policy !== undefined) sources.filesystem_policy = fpSrc ?? src
    if (t.tools2actions !== undefined) sources.tools2actions = src
    if (t.tools !== undefined) sources.tools = src
    if (t.actions !== undefined) sources.actions = src
    if (t.bash_tools !== undefined) sources.bash_tools = src
  }
  if (includeGroup && group?.tools) {
    cfg = mergeToolsConfig(cfg, group.tools)
    mark(group.tools, 'selected group')
  }
  const pt = merged.prompt.tools
  if (pt) {
    cfg = mergeToolsConfig(cfg, pt)
    const psrc = merged.sources['prompt.tools'] ?? 'prompt.tools'
    mark(pt, psrc, merged.sources['prompt.tools.filesystem_policy'] ?? psrc)
  }
  if (cliTools !== undefined) {
    cfg.enabled = cliTools
    sources.enabled = 'cli'
  }
  return { cfg, sources }
}

export function shellSettings(cfg: ShellToolConfig | undefined, taskWaitMs: number): ShellSettings {
  return {
    wait_ms: Math.min(Math.max(taskWaitMs, 1), MAX_IN_TOOL_WAIT_MS),
    timeout_ms: cfg?.timeout_ms ?? EXEC_DEFAULT_TIMEOUT_MS,
    max_timeout_ms: cfg?.max_timeout_ms ?? EXEC_MAX_TIMEOUT_MS,
  }
}

/** `RuntimeConfig::task_wait_ms`: the in-call wait budget for tasks. */
export function taskWaitMs(r: RuntimeConfig): number {
  return Math.min(Math.max(r.task_wait_ms ?? DEFAULT_TASK_WAIT_MS, 1), MAX_IN_TOOL_WAIT_MS)
}

export function describeToolSource(s: ToolSource): string {
  switch (s.kind) {
    case 'group': return `groupname:${s.groupname}`
    case 'mcp': return `mcp:${s.endpoint}`
    case 'named': return `name:${s.name}`
  }
}
