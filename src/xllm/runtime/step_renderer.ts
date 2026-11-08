// Default XML step renderer of the behavior loop (`agent_tool/src/step_record.rs`,
// with the `StepRenderer` trait defaults of `llm_context/src/behavior_loop.rs`).
// Current-behavior steps render as `(assistant, user)` pairs in append order,
// so normal progress appends messages and the prefix stays stable for
// provider KV caches; inherited steps and history summaries render into one
// `<<step_history>>` user message. Tool results are read from
// `Observation.host` as a `ToolResultView`.
//
// What this renders is the model's input and is byte-identical to Rust (see
// `core/rust_text`).

import type { AiMessage, AiToolCall, HistorySummaryRecord, JsonValue, Observation, StepRecord } from '../core/types'
import type { StepRenderer } from '../core/deps'
import { cloneJson, isObject } from '../core/json'
import { textMessage } from '../core/messages'
import { renderHintBlock } from './hints'

import { charOffset, collapseWhitespace, compareCodePoints, rustTextContent, rustTrim, rustTrimEnd, serdeJson } from '../core/rust_text'

/** `xml_util::xml_escape`: `& < > " '`. */
function xmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] as string)
}

/** `prompt_engine::escape_xml_text`: `& < >`. */
function escapeXmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// --------------------------------------------------------- ToolResultView

export type ToolResultStatusView = 'success' | 'error' | 'pending'

export interface HintView {
  text: string
  once?: string
}

/** Rendering view of the AgentToolResult envelope in `Observation.host` (`result_view.rs`). */
export interface ToolResultView {
  agent_tool_protocol?: string
  status: ToolResultStatusView
  cmd_name?: string
  cmd_args?: string
  title: string
  summary: string
  output?: string
  /** `null` and `{}` read as absent. */
  detail?: JsonValue
  return_code?: number
  task_id?: string
  partial_output?: string
  pending_reason?: string
  check_after?: number
  hints: HintView[]
}

class InvalidView {}

function invalid(): never {
  throw new InvalidView()
}

function optString(o: { [key: string]: JsonValue }, key: string): string | undefined {
  const v = o[key]
  if (v === undefined || v === null) return undefined
  return typeof v === 'string' ? v : invalid()
}

function defaultString(o: { [key: string]: JsonValue }, key: string): string {
  const v = o[key]
  if (v === undefined) return ''
  return typeof v === 'string' ? v : invalid()
}

function optInteger(o: { [key: string]: JsonValue }, key: string, min: number, maxExclusive: number): number | undefined {
  const v = o[key]
  if (v === undefined || v === null) return undefined
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v < maxExclusive ? v : invalid()
}

/**
 * `ToolResultView::from_host`: any object host reads as a view (every field
 * is optional, unknown fields are ignored); a field of the wrong type makes
 * the host unreadable, as serde's deserialization does.
 */
export function toolResultViewFromHost(host: JsonValue | undefined): ToolResultView | undefined {
  if (!isObject(host)) return undefined
  try {
    const status = host.status === undefined ? 'success' : host.status
    if (status !== 'success' && status !== 'error' && status !== 'pending') return undefined
    const hints = host.hints === undefined ? [] : host.hints
    if (!Array.isArray(hints)) return undefined
    const detail = host.detail
    const view: ToolResultView = {
      agent_tool_protocol: optString(host, 'agent_tool_protocol'),
      status,
      cmd_name: optString(host, 'cmd_name'),
      cmd_args: optString(host, 'cmd_args'),
      title: defaultString(host, 'title'),
      summary: defaultString(host, 'summary'),
      output: optString(host, 'output'),
      detail: detail === undefined || detail === null || (isObject(detail) && Object.keys(detail).length === 0) ? undefined : detail,
      return_code: optInteger(host, 'return_code', -(2 ** 31), 2 ** 31),
      task_id: optString(host, 'task_id'),
      partial_output: optString(host, 'partial_output'),
      pending_reason: optString(host, 'pending_reason'),
      check_after: optInteger(host, 'check_after', 0, 2 ** 64),
      hints: hints.map(h => (isObject(h) ? { text: defaultString(h, 'text'), once: optString(h, 'once') } : invalid())),
    }
    return view
  } catch (e) {
    if (e instanceof InvalidView) return undefined
    throw e
  }
}

function hintTexts(r: ToolResultView): string[] {
  return r.hints.map(h => rustTrim(h.text)).filter(t => t !== '')
}

function commandLineText(r: ToolResultView): string | undefined {
  if (r.cmd_name === undefined) return undefined
  const args = r.cmd_args === undefined ? '' : rustTrim(r.cmd_args)
  return args ? `${r.cmd_name} ${args}` : r.cmd_name
}

// ------------------------------------------------------------- renderer

export interface XmlStepRendererOptions {
  /** Rust's `summary_chars` knob (default 280); no rendering path reads it there either. */
  summaryChars?: number
  /** Cap on a current-behavior step's result body (default 4096 chars); `0` disables it. */
  maxResultChars?: number
  /** Render `started_at_ms` / `ended_at_ms` into history records (default true). */
  timestamps?: boolean
}

/** Default renderer of the XML behavior protocol (`XmlStepRenderer`). Stateless; share one across runs. */
export class XmlStepRenderer implements StepRenderer {
  readonly summaryChars: number
  readonly maxResultChars: number
  readonly timestamps: boolean

  constructor(options: XmlStepRendererOptions = {}) {
    this.summaryChars = options.summaryChars ?? 280
    this.maxResultChars = options.maxResultChars ?? 4 * 1024
    this.timestamps = options.timestamps ?? true
  }

  /** History records without wall-clock timestamps (a byte-stable prefix; hosted runs use it). */
  withoutTimestamps(): XmlStepRenderer {
    return new XmlStepRenderer({ summaryChars: this.summaryChars, maxResultChars: this.maxResultChars, timestamps: false })
  }

  render(step: StepRecord): [AiMessage, AiMessage] {
    return this.renderFull(step)
  }

  renderInherited(step: StepRecord): AiMessage {
    return textMessage('user', renderInheritedStepRecord(step, this.timestamps))
  }

  renderSummary(summary: HistorySummaryRecord): AiMessage {
    const behaviors = xmlEscape((summary.behavior_names ?? []).join(','))
    const range = `steps="${summary.start_step_index}..${summary.end_step_index}" count="${summary.step_count}"`
    const times = this.timestamps ? ` started_at_ms="${summary.started_at_ms}" ended_at_ms="${summary.ended_at_ms}"` : ''
    return textMessage('user', `<history_summary ${range}${times} behaviors="${behaviors}">${xmlEscape(summary.summary)}</history_summary>`)
  }

  renderHistory(steps: StepRecord[], currentBehavior: string, summaries: HistorySummaryRecord[]): AiMessage[] {
    if (steps.length === 0 && summaries.length === 0) return []
    const records = summaries.map(s => rustTextContent(this.renderSummary(s)))
    const pairs: AiMessage[] = []
    for (const step of steps) {
      if (currentBehavior !== '' && (step.meta.behavior_name ?? '') !== currentBehavior) {
        records.push(rustTextContent(this.renderInherited(step)))
        continue
      }
      pairs.push(...this.renderFull(step))
    }
    const out: AiMessage[] = []
    if (records.length > 0) out.push(textMessage('user', `<<step_history>>\n${records.join('\n')}\n<</step_history>>`))
    out.push(...pairs)
    return out
  }

  private renderFull(step: StepRecord): [AiMessage, AiMessage] {
    const assistant = step.assistant_message ? cloneJson(step.assistant_message) : textMessage('assistant', step.assistant_text)
    const user = step.next_user_message
      ? cloneJson(step.next_user_message)
      : textMessage('user', renderActionResultsFull(step, this.maxResultChars))
    return [assistant, user]
  }
}

// ------------------------------------------------------- action results

interface RenderedActionResult {
  title: string
  body: string
  fence: 'output' | 'json'
  action_id?: string
  /** `<runtime_hints>` of the result, rendered after its output. */
  hints: string[]
}

function output(title: string, body: string): RenderedActionResult {
  return { title, body, fence: 'output', hints: [] }
}

/** Truncate to `maxChars` chars; `0` means no limit. Returns `[clipped, wasClipped]`. */
function clip(input: string, maxChars: number): [string, boolean] {
  if (maxChars === 0) return [input, false]
  const end = charOffset(input, maxChars)
  if (end >= input.length) return [input, false]
  return [`${rustTrimEnd(input.slice(0, end))}...`, true]
}

function renderActionResultsFull(step: StepRecord, maxBodyChars: number): string {
  const actions = step.actions ?? []
  const results = step.action_results ?? []
  const n = Math.min(actions.length, results.length)
  const parts: RenderedActionResult[] = []
  for (let i = 0; i < n; i++) parts.push(renderOneActionResultFull(actions[i], results[i], maxBodyChars))
  for (const obs of results.slice(n)) parts.push(renderUnpairedActionResult(obs, maxBodyChars))
  return renderStepActionResultsWrapper(step, parts)
}

function renderStepActionResultsWrapper(step: StepRecord, parts: RenderedActionResult[]): string {
  let body = ''
  for (const part of parts) {
    body += part.action_id !== undefined ? `- #${part.action_id} ${part.title}\n\n` : `- ${part.title}\n\n`
    body += `\`\`\`output\n${part.body}\n\`\`\`\n`
    if (part.hints.length > 0) body += `${renderHintBlock(part.hints)}\n`
  }
  return `<<last_step_action_results behavior="${xmlEscape(step.meta.behavior_name ?? '')}" step="${step.meta.step_index}">>\n${body}\n<</last_step_action_results>>`
}

function withActionTitleId(action: AiToolCall, rendered: RenderedActionResult): RenderedActionResult {
  const id = rustTrim(action.call_id)
  if (id !== '' && /^[0-9]+$/.test(id)) rendered.action_id = id
  return rendered
}

function renderOneActionResultFull(action: AiToolCall, obs: Observation, maxBodyChars: number): RenderedActionResult {
  const command = actionCommandText(action)
  switch (obs.kind) {
    case 'success': {
      const view = toolResultViewFromHost(obs.host)
      if (view) return withActionTitleId(action, renderToolResultFull(action, view, maxBodyChars, obs.truncated))
      const [body, bodyTruncated] = clip(stringifyContent(obs.content), maxBodyChars)
      return withActionTitleId(action, output(`Run ${command}`, formatActionResultBody(body, obs.truncated || bodyTruncated)))
    }
    case 'error': {
      const view = toolResultViewFromHost(obs.host)
      if (view) return withActionTitleId(action, renderToolResultFull(action, view, maxBodyChars, false))
      const [msg] = clip(obs.message, Math.max(maxBodyChars, 1024))
      return withActionTitleId(action, output(`Run ${command}`, `Error: ${msg}`))
    }
    case 'cancelled': {
      const [body] = clip(obs.reason, Math.max(maxBodyChars, 512))
      return withActionTitleId(action, output(`Run ${command}`, `${cancelledLabel(obs.effect_unknown)}: ${body}`))
    }
    case 'unresolved': {
      const [body] = clip(obs.reason, Math.max(maxBodyChars, 512))
      return withActionTitleId(action, output(`Run ${command}`, unresolvedBody(obs.effect_unknown, body)))
    }
  }
}

function renderOneActionResultCompact(action: AiToolCall, obs: Observation, maxBodyChars: number): RenderedActionResult {
  const command = actionCommandText(action)
  switch (obs.kind) {
    case 'success': {
      const view = toolResultViewFromHost(obs.host)
      if (view) return withActionTitleId(action, renderToolResultCompact(action, view, maxBodyChars, obs.truncated))
      const [clipped, bodyTruncated] = clip(stringifyContent(obs.content), maxBodyChars)
      const body = rustTrim(clipped)
      return withActionTitleId(action,
        output(`Run ${command}`, body === '' ? 'Success' : formatActionResultBody(body, obs.truncated || bodyTruncated)))
    }
    case 'error': {
      const view = toolResultViewFromHost(obs.host)
      if (view) return withActionTitleId(action, renderToolResultCompact(action, view, maxBodyChars, false))
      const [msg] = clip(obs.message, maxBodyChars)
      return withActionTitleId(action, output(`Run ${command}`, `Error: ${msg}`))
    }
    case 'cancelled': {
      const body = rustTrim(clip(obs.reason, maxBodyChars)[0])
      const label = cancelledLabel(obs.effect_unknown)
      return withActionTitleId(action, output(`Run ${command}`, body === '' ? label : `${label}: ${body}`))
    }
    case 'unresolved': {
      const body = rustTrim(clip(obs.reason, maxBodyChars)[0])
      return withActionTitleId(action, output(`Run ${command}`, unresolvedBody(obs.effect_unknown, body)))
    }
  }
}

function renderUnpairedActionResult(obs: Observation, maxBodyChars: number): RenderedActionResult {
  switch (obs.kind) {
    case 'success': {
      const view = toolResultViewFromHost(obs.host)
      if (view) return renderToolResultFullPlaceholder(view, maxBodyChars, obs.truncated)
      const [body, bodyTruncated] = clip(stringifyContent(obs.content), maxBodyChars)
      return output('Step result', formatActionResultBody(body, obs.truncated || bodyTruncated))
    }
    case 'error': {
      const view = toolResultViewFromHost(obs.host)
      if (view) return renderToolResultFullPlaceholder(view, maxBodyChars, false)
      const [msg] = clip(obs.message, Math.max(maxBodyChars, 1024))
      return output('Step error', `Error: ${msg}`)
    }
    case 'cancelled': {
      const [body] = clip(obs.reason, Math.max(maxBodyChars, 512))
      return output('Step result', `${cancelledLabel(obs.effect_unknown)}: ${body}`)
    }
    case 'unresolved': {
      const [body] = clip(obs.reason, Math.max(maxBodyChars, 512))
      return output('Step result', unresolvedBody(obs.effect_unknown, body))
    }
  }
}

function unresolvedBody(effectUnknown: boolean, body: string): string {
  const label = effectUnknown ? 'Unresolved (result unknown, side effects unconfirmed)' : 'Not executed'
  return body === '' ? label : `${label}: ${body}`
}

function renderToolResultFull(action: AiToolCall, result: ToolResultView, maxBodyChars: number,
  fallbackTruncated: boolean): RenderedActionResult {
  const rendered = renderToolResultFullPlaceholder(result, maxBodyChars, fallbackTruncated)
  rendered.title = toolResultTitle(action, result)
  rendered.hints = hintTexts(result)
  return rendered
}

function renderToolResultFullPlaceholder(result: ToolResultView, maxBodyChars: number,
  fallbackTruncated: boolean): RenderedActionResult {
  const [body, fence] = result.status === 'error'
    ? toolResultFullBody(result, 'Error')
    : result.status === 'pending' ? [toolResultPendingBody(result), 'output' as const] : toolResultFullBody(result, 'Success')
  const [clipped, wasClipped] = clip(body, maxBodyChars)
  return { title: toolResultTitle(undefined, result), body: formatActionResultBody(clipped, fallbackTruncated || wasClipped), fence, hints: [] }
}

function renderToolResultCompact(action: AiToolCall, result: ToolResultView, maxBodyChars: number,
  fallbackTruncated: boolean): RenderedActionResult {
  const title = toolResultTitle(action, result)
  let body: string
  if (result.status === 'pending') body = toolResultPendingBody(result)
  else if (result.status === 'error') body = toolResultErrorBody(result)
  else body = rustTrim(result.summary) || rustTrim(result.title) || 'Success'
  const [clipped, wasClipped] = clip(body, maxBodyChars)
  return output(title, formatActionResultBody(clipped, fallbackTruncated || wasClipped))
}

function toolResultTitle(action: AiToolCall | undefined, result: ToolResultView): string {
  const title = rustTrim(result.title)
  if (title !== '') return title
  const command = commandLineText(result)
  if (command !== undefined && rustTrim(command) !== '') return rustTrim(command)
  return action ? `Run ${actionCommandText(action)}` : 'Step result'
}

function toolResultFullBody(result: ToolResultView, emptyFallback: string): [string, 'output' | 'json'] {
  if (result.output !== undefined) {
    const out = rustTrimEnd(result.output)
    if (out !== '') return [out, 'output']
  }
  if (result.detail !== undefined) {
    if (typeof result.detail === 'string') return [rustTrimEnd(result.detail), 'output']
    return [serdeJson(result.detail, true), 'json']
  }
  const summary = rustTrim(result.summary)
  if (summary !== '') return [summary, 'output']
  const title = rustTrim(result.title)
  if (title !== '') return [title, 'output']
  return [emptyFallback, 'output']
}

function toolResultErrorBody(result: ToolResultView): string {
  const output = result.output === undefined ? '' : rustTrim(result.output)
  const lines = [rustTrim(result.summary) || output || rustTrim(result.title) || 'Error']
  if (result.return_code !== undefined) lines.push(`return_code=${result.return_code}`)
  return lines.join('\n')
}

function toolResultPendingBody(result: ToolResultView): string {
  const lines = [rustTrim(result.summary) || 'Pending']
  if (result.task_id) lines.push(`task_id=${result.task_id}`)
  if (result.pending_reason) lines.push(`pending_reason=${result.pending_reason}`)
  if (result.check_after !== undefined) lines.push(`check_after=${result.check_after}`)
  const partial = result.partial_output === undefined ? '' : rustTrim(result.partial_output)
  if (partial !== '') lines.push(`partial_output:\n${partial}`)
  return lines.join('\n')
}

function formatActionResultBody(body: string, truncated: boolean): string {
  let s = rustTrimEnd(body) || 'Success'
  if (truncated) s += '\n[truncated]'
  return s
}

function cancelledLabel(effectUnknown: boolean): string {
  return effectUnknown ? 'Cancelled (result unknown)' : 'Cancelled'
}

const COMMAND_SKIPPED_ARGS = ['content', 'old_string', 'new_string', 'from_user_did']

function argValue(action: AiToolCall, key: string): JsonValue | undefined {
  const args = action.args ?? {}
  return Object.prototype.hasOwnProperty.call(args, key) ? args[key] : undefined
}

function stringArg(action: AiToolCall, key: string): string | undefined {
  const v = argValue(action, key)
  if (typeof v !== 'string') return undefined
  const t = rustTrim(v)
  return t === '' ? undefined : t
}

function compactInlineValue(value: string, maxChars: number): string {
  return clip(collapseWhitespace(value), maxChars)[0]
}

function valueArgText(value: JsonValue): string {
  return compactInlineValue(typeof value === 'string' ? value : serdeJson(value), 160)
}

/** The command line a result is titled with (`Run <command>`). */
function actionCommandText(action: AiToolCall): string {
  switch (action.name) {
    case 'shell': {
      const command = stringArg(action, 'command')
      return command === undefined ? action.name : compactInlineValue(command, 160)
    }
    case 'read': {
      const parts = ['read', stringArg(action, 'path') ?? stringArg(action, 'uri') ?? 'target']
      for (const key of ['first_chunk', 'range']) {
        const v = argValue(action, key)
        if (v !== undefined) parts.push(`${key}=${valueArgText(v)}`)
      }
      return parts.join(' ')
    }
    case 'write_file':
      return `write_file ${stringArg(action, 'path') ?? 'target'} mode=${stringArg(action, 'mode') ?? 'write'}`
    case 'edit_file': {
      let command = `edit_file ${stringArg(action, 'path') ?? 'target'}`
      const old = stringArg(action, 'old_string')
      if (old !== undefined) command += ` old_string="${compactInlineValue(old, 80)}"`
      return command
    }
    default: {
      const args = action.args ?? {}
      const parts = [action.name]
      for (const key of Object.keys(args).sort(compareCodePoints)) {
        if (COMMAND_SKIPPED_ARGS.includes(key) || args[key] === undefined) continue
        parts.push(`${key}=${valueArgText(args[key])}`)
      }
      return parts.join(' ')
    }
  }
}

function stringifyContent(content: JsonValue): string {
  return typeof content === 'string' ? content : serdeJson(content)
}

// ----------------------------------------------------- inherited steps

function renderInheritedStepRecord(step: StepRecord, timestamps: boolean): string {
  const thought = (step.thought === undefined ? '' : rustTrim(step.thought)) || rustTrim(step.assistant_text)
  const observation = step.observation === undefined ? '' : rustTrim(step.observation)
  const actions = renderHistoryActionsCompact(step, 512)
  // The step's report is part of what the inheriting context needs (a
  // caller's report is often the hand-over itself); it is not an action.
  const reportText = step.self_report === undefined ? '' : rustTrim(step.self_report)
  const report = reportText === '' ? '' : `<report end="${step.report_end}">${escapeXmlText(reportText)}</report>\n`
  const times = timestamps ? ` started_at_ms="${step.meta.started_at_ms}" ended_at_ms="${step.meta.ended_at_ms ?? ''}"` : ''
  return `<step_record behavior="${step.meta.behavior_name ?? ''}" index="${step.meta.step_index}"${times} compression="${step.meta.compression_level}">\n` +
    `<observation>${observation}</observation>\n<intent>${thought}</intent>\n${report}<actions>\n${actions}\n</actions>\n</step_record>`
}

function renderHistoryActionsCompact(step: StepRecord, maxBodyChars: number): string {
  const actions = step.actions ?? []
  const results = step.action_results ?? []
  const n = Math.min(actions.length, results.length)
  const parts: string[] = []
  for (let i = 0; i < n; i++) {
    const part = renderOneActionResultCompact(actions[i], results[i], maxBodyChars)
    parts.push(`- ${part.title}\n\n\`\`\`${part.fence}\n${part.body}\n\`\`\``)
  }
  return parts.length === 0 ? 'No action.' : parts.join('\n\n')
}
