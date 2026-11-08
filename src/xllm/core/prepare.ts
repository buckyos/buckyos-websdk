// `XllmTask.prepare` (Rust `XllmTask::prepare`): a task xllm assembles itself
// from one JSON configuration (no `.llm_context` discovery), explicit
// overrides and the input. Materials are what the host hands over (there is
// no `--file` to read): text as `<material name="…">`, images as
// `[image N: label]` + an image block, or analysed first by `file_model`.

import type {
  AiContent, AiMessage, AttachmentRecord, EffectiveConfig, FileStagePlan, InputRecord, JsonValue, LoopModel, PromptPlan,
  ProviderConfig, ProviderKind, ResourceRef, ResultFormat, RunLimits, RunLogLevel,
} from './types'
import { XllmError } from './errors'
import {
  DEFAULT_LLM_TIMEOUT_SECS, DEFAULT_MAX_TOOL_ITERATIONS, DEFAULT_TIMEOUT_SECS, computeToolsConfig, mergeConfigLayers,
  parseLlmContextJson,
} from './config'
import type { MergedConfig } from './config'
import { TemplateEnv, assemblePrompt, runtimeTemplateValues } from './prompt'
import { RUNTIME_PROTOCOL_VERSION, buildRulesSystemText, buildRuntimeProtocol } from './protocol'
import { checkSiteConfig, SITE_KIND } from './site_policy'
import { textMessage } from './messages'
import { xmlEscape } from './xml'
import { openRuntime } from './open_runtime'
import type { PreparedTask, XllmDeps } from './run'

export const MAX_TEXT_ATTACHMENT_BYTES = 8 * 1024 * 1024
export const MAX_IMAGE_ATTACHMENT_BYTES = 20 * 1024 * 1024

export type Attachment =
  /** Text material the host has (Rust `--file`). */
  | { kind: 'text'; label: string; text: string }
  /** An image: a URL, or a resource (base64 / named object). */
  | { kind: 'image'; source: string | ResourceRef; label?: string }

export interface TaskInput {
  user?: string
  attachments?: Attachment[]
  /** Piped input: the request when there is none, material otherwise. */
  stdin?: string
  /** A ready conversation instead of a request (exclusive with everything else). */
  structured?: AiMessage[]
}

/** Explicit arguments (Rust `TaskOverrides`); `undefined` keeps the configuration. */
export interface TaskOverrides {
  provider?: ProviderKind
  model?: string
  file_model?: string
  loop_model?: LoopModel
  tools?: boolean
  select?: string
  system?: string
  max_tokens?: number
  max_tool_iterations?: number
  timeout_secs?: number
  llm_timeout_secs?: number
  run_logs?: RunLogLevel
  result_format?: ResultFormat
  json?: boolean
  json_schema?: JsonValue
  disable_capabilities?: string[]
}

function summarize(text: string): string {
  const first = text.split('\n').map(l => l.trim()).find(l => l !== '') ?? ''
  const chars = [...first]
  return chars.length <= 80 ? first : chars.slice(0, 80).join('')
}

async function sha256Hex(bytes: BufferSource): Promise<string> {
  const d = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('')
}

function base64Bytes(b64: string) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function isUrl(s: string): boolean {
  return /^(https?|data|cyfs|obj|file):/i.test(s.trim())
}

type Loaded = { kind: 'text'; label: string; text: string } | { kind: 'image'; label: string; source: ResourceRef }

async function loadAttachments(atts: Attachment[]): Promise<{ loaded: Loaded[]; records: AttachmentRecord[] }> {
  const loaded: Loaded[] = []
  const records: AttachmentRecord[] = []
  for (let index = 0; index < atts.length; index++) {
    const a = atts[index]
    if (a.kind === 'text') {
      const bytes = new TextEncoder().encode(a.text)
      if (bytes.length > MAX_TEXT_ATTACHMENT_BYTES) {
        throw XllmError.input(`material ${a.label}: ${bytes.length} bytes exceeds the ${MAX_TEXT_ATTACHMENT_BYTES} byte limit; split the material or trim it`)
      }
      records.push({ index, kind: 'file', label: a.label, mime: 'text/plain', bytes: bytes.length, sha256: await sha256Hex(bytes) })
      loaded.push({ kind: 'text', label: a.label, text: a.text })
      continue
    }
    if (typeof a.source === 'string') {
      if (!isUrl(a.source)) throw XllmError.input(`image ${a.source}: pass a URL or a resource (this executor reads no local files)`)
      const label = a.label ?? a.source
      records.push({ index, kind: 'image', label })
      loaded.push({ kind: 'image', label, source: { kind: 'url', url: a.source } })
      continue
    }
    const src = a.source
    const label = a.label ?? (src.kind === 'url' ? src.url : src.kind === 'named_object' ? src.obj_id : `image ${index + 1}`)
    const rec: AttachmentRecord = { index, kind: 'image', label }
    if (src.kind === 'base64') {
      const bytes = base64Bytes(src.data_base64)
      if (bytes.length > MAX_IMAGE_ATTACHMENT_BYTES) {
        throw XllmError.input(`image ${label}: ${bytes.length} bytes exceeds the ${MAX_IMAGE_ATTACHMENT_BYTES} byte limit; shrink the image`)
      }
      rec.mime = src.mime
      rec.bytes = bytes.length
      rec.sha256 = await sha256Hex(bytes)
    }
    records.push(rec)
    loaded.push({ kind: 'image', label, source: src })
  }
  return { loaded, records }
}

/** The prompt group a task uses (`select_prompt_group`): none for structured input or a custom prompt. */
export function selectPromptGroup(merged: MergedConfig, overrides: Pick<TaskOverrides, 'select' | 'system'>, structured = false): string | undefined {
  const custom = overrides.system !== undefined || (overrides.select === undefined && merged.prompt.mode === 'custom')
  if (structured || custom) return undefined
  const sel = overrides.select ?? merged.prompt.select
  if (sel === undefined) return undefined
  if (!merged.prompt.groups?.[sel]) {
    const available = Object.keys(merged.prompt.groups ?? {}).sort()
    const src = overrides.select !== undefined ? 'cli:--select' : merged.sources['prompt.select'] ?? ''
    throw XllmError.config(src, 'prompt.select', `prompt group \`${sel}\` does not exist (available: ${available.length ? available.join(', ') : 'none'})`)
  }
  return sel
}

/**
 * Merge the configuration with `overrides`, select the group, open the
 * runtime's tools, assemble the prompt and the first user message; no run
 * is created.
 */
export async function prepareTask(llmContext: JsonValue | undefined, origin: string, input: TaskInput, overrides: TaskOverrides,
  deps: XllmDeps): Promise<PreparedTask> {
  const runtime = deps.runtime
  const descriptor = runtime.descriptor()
  const atts = input.attachments ?? []
  if (overrides.select !== undefined && overrides.system !== undefined) {
    throw XllmError.input('--select and --system are mutually exclusive (custom prompt vs. standard group assembly)')
  }
  if (input.structured !== undefined
    && (input.user !== undefined || atts.length > 0 || input.stdin !== undefined || overrides.select !== undefined || overrides.system !== undefined)) {
    throw XllmError.input('--input-file is mutually exclusive with question/--user/--system/--select/--file/--image/stdin')
  }
  if (input.stdin !== undefined && !input.stdin.trim()) {
    throw XllmError.input('stdin was connected but contained no usable input; check the upstream command and its exit status')
  }
  const file = parseLlmContextJson(origin, llmContext ?? null)
  if (descriptor.kind === SITE_KIND) {
    checkSiteConfig(file, origin)
    if (overrides.provider !== undefined && overrides.provider !== 'buckyos') {
      throw XllmError.capability(`provider \`${overrides.provider}\` is not available in a site runtime; the page's model client is used`)
    }
  }
  if (file.runtime?.kind !== undefined && file.runtime.kind !== descriptor.kind) {
    throw XllmError.capability(`${origin}: runtime.kind \`${file.runtime.kind}\` does not match the host's runtime \`${descriptor.kind}\``)
  }
  const merged = mergeConfigLayers([{ path: origin, file }])
  const sources = { ...merged.sources }
  let provider: ProviderConfig = merged.provider
  if (overrides.provider !== undefined) {
    if (provider.kind !== overrides.provider) provider = { kind: overrides.provider }
    sources['provider.type'] = 'cli'
  }
  const pick = <T>(cli: T | undefined, fileValue: T | undefined, name: string, dflt?: T): T | undefined => {
    if (cli !== undefined) {
      sources[name] = 'cli'
      return cli
    }
    if (fileValue !== undefined) return fileValue
    if (dflt !== undefined) sources[name] = 'default'
    return dflt
  }
  let model = pick(overrides.model, merged.model, 'model')
  if (model === undefined) {
    if ((provider.kind ?? 'buckyos') === 'openai') {
      throw XllmError.capability('openai provider requires a model: set `model` in .llm_context or pass --model')
    }
    sources.model = 'default'
    model = 'llm.chat'
  }
  const fileModel = pick(overrides.file_model, merged.file_model, 'file_model')
  const loopModel = pick(overrides.loop_model, merged.loop_model, 'loop_model', 'function_call' as LoopModel) as LoopModel
  const resultFormat = pick(overrides.result_format, merged.result_format, 'result_format', { kind: 'raw' } as ResultFormat) as ResultFormat
  const jsonOut = overrides.json === true || merged.json === true || overrides.json_schema !== undefined || merged.json_schema !== undefined
  const jsonSchema = overrides.json_schema ?? merged.json_schema
  const runLogs = (overrides.run_logs !== undefined ? (sources.run_logs = 'cli', overrides.run_logs) : merged.run_logs ?? 'info') as RunLogLevel
  const limits: RunLimits = {
    max_tool_iterations: pick(overrides.max_tool_iterations, merged.max_tool_iterations, 'max_tool_iterations', DEFAULT_MAX_TOOL_ITERATIONS) as number,
    timeout_secs: pick(overrides.timeout_secs, merged.timeout, 'timeout', DEFAULT_TIMEOUT_SECS) as number,
    llm_timeout_secs: pick(overrides.llm_timeout_secs, merged.llm_timeout, 'llm_timeout', DEFAULT_LLM_TIMEOUT_SECS) as number,
  }
  const maxTokens = pick(overrides.max_tokens, merged.max_tokens, 'max_tokens')
  if (maxTokens !== undefined) limits.max_tokens = maxTokens
  if (merged.context_window !== undefined) limits.context_window_tokens = merged.context_window
  if (merged.context_yield_ratio !== undefined) limits.context_yield_ratio = merged.context_yield_ratio
  if (jsonOut && loopModel === 'behavior' && resultFormat.kind === 'raw') {
    throw XllmError.capability('--json cannot be satisfied with `loop_model: behavior` and `result_format: raw` (the raw behavior response is XML); use e.g. `result_format: result.report`')
  }

  const structured = input.structured !== undefined
  const groupName = selectPromptGroup(merged, overrides, structured)
  if (groupName !== undefined && overrides.select !== undefined) sources['prompt.select'] = 'cli'
  const group = groupName !== undefined ? merged.prompt.groups?.[groupName] : undefined
  const { cfg: toolsCfg, sources: toolSources } = computeToolsConfig(merged, group, overrides.tools, group !== undefined)
  const { tools, manager, runtimeConfig } = await openRuntime(runtime, merged.runtime, descriptor.workdir, loopModel, toolSources, toolsCfg, deps.tasks)

  const info = await runtime.info()
  const env = TemplateEnv.forNewRun(info, name => runtime.env?.(name))
  let prompt: PromptPlan
  if (structured) {
    const runtimeProtocol = buildRuntimeProtocol(loopModel, tools, jsonOut)
    prompt = {
      mode: 'custom', loop_model: loopModel, sections: [], custom_system_source: 'structured input', runtime_protocol: runtimeProtocol,
      protocol_version: RUNTIME_PROTOCOL_VERSION,
      system_prompt: `## capabilities\n${buildRulesSystemText(loopModel, tools)}\n\n## runtime_protocol\n${runtimeProtocol.trimEnd()}\n`,
      user_request_source: 'structured', template_vars: {}, runtime_vars: runtimeTemplateValues(info),
    }
  } else {
    prompt = assemblePrompt({
      merged, overrideSystem: overrides.system, overrideSelect: overrides.select, groupName, group, loopModel, tools, env, json: jsonOut,
    })
  }

  const explicit = input.user?.trim() || undefined
  let request: string | undefined
  let requestSource: string
  let stdinRole: string | undefined
  if (structured) {
    requestSource = 'structured'
  } else if (explicit !== undefined) {
    request = explicit
    requestSource = 'explicit'
    if (input.stdin !== undefined) stdinRole = 'material'
  } else if (prompt.user_request !== undefined) {
    request = prompt.user_request
    requestSource = 'group_default'
    if (input.stdin !== undefined) stdinRole = 'material'
  } else if (input.stdin !== undefined) {
    request = input.stdin.trimEnd()
    requestSource = 'stdin'
    stdinRole = 'request'
  } else if (input.user !== undefined) {
    throw XllmError.input('the task request is empty')
  } else if (groupName !== undefined) {
    throw XllmError.input(`prompt group \`${groupName}\` has no default task; pass a question or configure \`default_user\``)
  } else if (atts.length > 0) {
    throw XllmError.input('attachments were given without a task request; add a question or --user')
  } else {
    throw XllmError.input('no task request: pass a question, --user, --select <group with default_user>, or pipe input')
  }

  const { loaded, records } = await loadAttachments(atts)
  const images: [string, ResourceRef][] = []
  let imageIndex = 0
  for (const a of loaded) if (a.kind === 'image') images.push([`image ${++imageIndex}: ${a.label}`, a.source])
  const fileStage: FileStagePlan | undefined = images.length > 0 && fileModel !== undefined
    ? { model: fileModel, request_text: request ?? '', images } : undefined
  const mainUserParts: AiContent[] = request !== undefined ? [{ type: 'text', text: request }] : []
  let img = 0
  for (const a of loaded) {
    if (a.kind === 'text') {
      mainUserParts.push({ type: 'text', text: `<material name="${xmlEscape(a.label)}">\n${a.text}\n</material>` })
    } else {
      const [label, src] = images[img++]
      if (!fileStage) mainUserParts.push({ type: 'text', text: `[${label}]` }, { type: 'image', source: src })
    }
  }
  if (input.stdin !== undefined && stdinRole === 'material') mainUserParts.push({ type: 'text', text: `<stdin>\n${input.stdin.trimEnd()}\n</stdin>` })

  const initialMessages: AiMessage[] = structured
    ? [textMessage('system', prompt.system_prompt), ...(input.structured as AiMessage[])]
    : [textMessage('system', prompt.system_prompt), { role: 'user', content: mainUserParts }]
  const summary = (request !== undefined ? summarize(request) : '') || '(structured input)'
  if (request !== undefined) prompt.user_request = request
  else delete prompt.user_request
  prompt.user_request_source = requestSource

  const config: EffectiveConfig = {
    runtime: runtimeConfig, runtime_descriptor: runtime.descriptor(), provider, model, loop_model: loopModel, limits, run_logs: runLogs,
    result_format: resultFormat, json: jsonOut, tools, config_files: merged.files, sources,
  }
  if (fileModel !== undefined) config.file_model = fileModel
  if (jsonSchema !== undefined) config.json_schema = jsonSchema
  if (overrides.disable_capabilities?.length) config.disable_capabilities = [...overrides.disable_capabilities]
  const inputRecord: InputRecord = { request_source: requestSource, attachments: records }
  if (request !== undefined) inputRecord.request = request
  if (stdinRole !== undefined) inputRecord.stdin_role = stdinRole
  if (input.stdin !== undefined) inputRecord.stdin_chars = [...input.stdin].length
  if (input.structured !== undefined) inputRecord.structured_messages = input.structured.length
  return {
    kind: 'prepared', workdir: descriptor.workdir, config, prompt, input: inputRecord, summary, initialMessages,
    mainUserParts, ...(fileStage ? { fileStage } : {}), manager,
  }
}
