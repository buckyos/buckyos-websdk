// The runtime protocol and capability texts xllm appends to a run's system
// prompt (`build_runtime_protocol_for`, `build_rules_system_text`,
// `build_cmd_manual_system_text`, `render_action_usage` in xllm.rs). The
// text is copied verbatim: the shared vectors compare it byte for byte.

import type { EffectiveTools, HostProtocolFlavor, LoopModel, ResolvedTool } from './types'
import { isObject } from './json'
import { rustTrim, rustTrimEnd } from './rust_text'

/** Runtime protocol version; a resume checks the executor can handle the saved one. */
export const RUNTIME_PROTOCOL_VERSION = 'xllm/2'

function propsOf(tool: ResolvedTool): Record<string, unknown> {
  const p = isObject(tool.args_schema) ? tool.args_schema.properties : undefined
  return isObject(p) ? p : {}
}

function requiredOf(tool: ResolvedTool): string[] {
  const r = isObject(tool.args_schema) ? tool.args_schema.required : undefined
  return Array.isArray(r) ? r.filter((x): x is string => typeof x === 'string') : []
}

/** The parameter an action's element body carries: `command` / `content` / … or the only required string. */
export function actionBodyArg(tool: ResolvedTool): string | undefined {
  if (!isObject(tool.args_schema) || !isObject(tool.args_schema.properties)) return undefined
  const props = tool.args_schema.properties
  for (const cand of ['command', 'content', 'text', 'body', 'query', 'message']) {
    if (cand in props) return cand
  }
  const stringRequired = requiredOf(tool).filter(k => {
    const v = props[k]
    return isObject(v) && v.type === 'string'
  })
  return stringRequired.length === 1 ? stringRequired[0] : undefined
}

export function renderActionUsage(tool: ResolvedTool): string {
  const props = propsOf(tool)
  const keys = Object.keys(props).sort()
  const required = requiredOf(tool)
  const body = actionBodyArg(tool)
  const attrs: string[] = []
  const childTags: string[] = []
  for (const k of keys) {
    if (k === body) continue
    const v = props[k]
    const ty = isObject(v) && typeof v.type === 'string' ? v.type : 'string'
    const opt = required.includes(k) ? '' : '?'
    if (['string', 'integer', 'number', 'boolean'].includes(ty)) attrs.push(`${k}${opt}="<${ty}>"`)
    else childTags.push(`<${k}${opt}><![CDATA[<json ${ty}>]]></${k}>`)
  }
  const attrStr = attrs.length ? ` ${attrs.join(' ')}` : ''
  const n = tool.name
  let form: string
  if (body !== undefined) {
    form = childTags.length === 0
      ? `<${n}${attrStr}><![CDATA[<${body} value>]]></${n}>`
      : `<${n}${attrStr}>${childTags.join('')}<${body}><![CDATA[...]]></${body}></${n}>`
  } else {
    form = childTags.length === 0 ? `<${n}${attrStr}/>` : `<${n}${attrStr}>${childTags.join('')}</${n}>`
  }
  const lines = [`- ${form}`]
  if (body !== undefined && childTags.length === 0) {
    lines.push(`  Body/CDATA contains only the raw value of \`${body}\`; do not include the field name or a \`${body}:\` prefix.`)
  }
  const desc = rustTrim(tool.description)
  if (desc) lines.push(`  ${desc}`)
  for (const k of keys) {
    const v = props[k]
    if (isObject(v) && typeof v.description === 'string') lines.push(`  ${k}: ${v.description}`)
  }
  return lines.join('\n')
}

export function buildRuntimeProtocol(loopModel: LoopModel, tools: EffectiveTools, json: boolean): string {
  return buildRuntimeProtocolFor({ kind: 'one_shot' }, loopModel, tools, json)
}

export function buildRuntimeProtocolFor(flavor: HostProtocolFlavor, loopModel: LoopModel, tools: EffectiveTools, json: boolean): string {
  let s = ''
  if (flavor.kind === 'session') {
    s += rustTrimEnd(flavor.intro) + '\n'
  } else {
    s += `You are running inside xllm (${RUNTIME_PROTOCOL_VERSION}), a one-shot task runner: complete the task given in the user message and deliver one final result. There is no follow-up conversation, so do not ask the user questions; if something essential is missing, state it in the final result. Use only the material provided and the results you obtain during this run; distinguish verified facts from assumptions.\n`
  }
  if (loopModel === 'function_call') {
    if (tools.enabled && tools.native.length > 0) {
      s += '\nExecution loop (native function calling):\n'
      s += '- When you need to act, call one or more of the provided tools; their results are returned to you and you decide the next step. Only the tools declared for this run exist.\n'
      s += '- A failed tool call is not the end of the task: read the error, adjust, and continue within the tool iteration limit.\n'
      if (tools.native.some(t => t.name === 'report')) {
        s += '- Submit a report with report({report: "free text or Markdown", artifacts: ["relative/file" or "cyfile:…"], result: <optional JSON>, is_end: false}). Omitted is_end means false: it records progress without ending the context or sending a user message.\n'
        s += '- To request completion, call report with is_end: true and a nonempty final report. The host validates and persists it, returns the tool receipt, and completes the current context without another model reply. It skips later calls in that batch; a rejected report returns an error and can be corrected.\n'
        s += '- Final report delivery and Session completion follow the host policy. Child contexts return to their caller. Plain assistant text with no tool calls yields the current Turn; it completes a Session only when the host permits ordinary Done completion.\n'
      } else {
        s += '- When the task is complete, reply with the final result as plain assistant text and no tool calls. That text is delivered verbatim to the caller.\n'
      }
    } else {
      s += '\nExecution loop: no tools or actions are available in this run. Answer directly in a single reply; do not request or describe tool calls. Your reply is delivered verbatim to the caller.\n'
    }
    if (json) s += '\nOutput constraint: the final reply MUST be exactly one valid JSON value with no surrounding prose or code fences.\n'
    return s
  }
  const hasActions = tools.enabled && tools.actions.length > 0
  const hasNative = tools.enabled && tools.native.length > 0
  s += '\nExecution loop (behavior protocol): every reply MUST be one XML document with this shape:\n'
  s += '<response>\n  <observation>what the previous action results tell you (omit on the first step)</observation>\n  <intent>the next move, in one short sentence</intent>\n'
  if (hasActions) s += '  <actions>\n    ...zero or more actions, executed in order...\n  </actions>\n'
  s += '  <report end="true"><![CDATA[the complete final result]]></report>\n</response>\n'
  s += 'Rules:\n'
  s += '- <report> or <report end="false"> submits a progress report. Use <report end="true"> only to submit the complete, nonempty final result and request completion. The final report content is delivered verbatim to the caller.\n'
  s += '- A final report cannot share a reply with actions, native tool calls, or a nonempty next_behavior. Observe action results before submitting it. Use only true or false for end and at most one report per reply.\n'
  s += '- A reply without actions, native tool calls, next_behavior or a final report (a progress report alone, or nothing) yields: this context stops and waits for new input, such as the result of work it started that is still running or a new message. Never yield while there is work you can do now.\n'
  s += '- next_behavior is reserved for host scheduling, including WAIT_USER_MSG; END and done are invalid. A report without end="true" never implies completion.\n'
  if (flavor.kind === 'session') {
    s += '- A report may include sibling <artifacts> containing a JSON array of relative file paths and <result> containing any JSON value. These require a report in the same response. The host validates and persists the submission; completion applies to the current context, with child reports returned to their caller.\n'
    s += '- Yielding is how you wait for work this session started (tasks, sub sessions): the session wakes you with its result. When nothing it started is running, the session ends the Turn instead.\n'
  }
  if (hasActions) {
    s += '- To act, put one or more actions inside <actions>; the results come back in the next message. You may include a progress report with end="false".\n'
    s += '- Actions run in order; the first failed action stops the rest of that step. Read the error, adjust, and continue within the tool iteration limit.\n'
    s += '- Only the actions listed below exist; do not invent others. Put multi-line or special-character values inside <![CDATA[ ... ]]>.\n'
    s += 'Available actions:\n'
    for (const t of tools.actions) s += renderActionUsage(t) + '\n'
    if (hasNative) s += '- Native function-call tools are also declared for this run; a reply that uses them is treated as a step with actions.\n'
  } else if (hasNative) {
    s += '- To act, call one or more of the native function-call tools declared for this run (never inside <actions>); their results come back to you and you may call more. Only the declared tools exist.\n'
    s += '- A failed tool call is not the end of the task: read the error, adjust, and continue within the tool iteration limit.\n'
    s += '- A reply without tool calls is the <response> document of the step: submit <report end="true"> with the complete final result only after you have done the work and observed the results; a reply without it yields.\n'
  } else {
    s += '- No actions or tools are available in this run: reply with a single <response> whose <report end="true"> contains the complete final result. Do not include <actions>.\n'
  }
  if (json) s += '- Output constraint: the content of the final <report end="true"> MUST be exactly one valid JSON value.\n'
  return s
}

/** System text of the `rules` section (30): the tools and actions this run has. */
export function buildRulesSystemText(loopModel: LoopModel, tools: EffectiveTools): string {
  if (!tools.enabled || (tools.native.length === 0 && tools.actions.length === 0)) {
    return 'Capabilities for this run: no tools or actions can be called. Work only with the material submitted in this task.'
  }
  const lines: string[] = []
  if (tools.native.length) lines.push(`Native tools available in this run (${loopModel}): ${tools.native.map(t => t.name).join(', ')}`)
  if (tools.actions.length) lines.push(`Behavior actions available in this run: ${tools.actions.map(t => t.name).join(', ')}`)
  if (tools.tools2actions) {
    lines.push('Configured tools were converted into actions; call them through the XML action protocol, not through native function calls.')
  }
  if ([...tools.native, ...tools.actions].some(t => t.source === 'groupname:bash' || t.source === 'groupname:bash_core')) {
    lines.push(tools.filesystem_policy === 'workspace'
      ? "Builtin file tools and shell's cwd are restricted to the working directory. Shell commands are not sandboxed and run with the current user's permissions."
      : "Builtin file tools and shell's cwd may access paths outside the working directory, subject to the current user's operating-system permissions. Relative paths default to the working directory.")
  }
  lines.push('Do not claim a tool or command exists unless it is listed here.')
  return lines.join('\n')
}

/** System text of the `cmd_manual` section (40), only when `shell` is enabled. */
export function buildCmdManualSystemText(tools: EffectiveTools): string | undefined {
  if (!tools.enabled || !tools.exec_enabled) return undefined
  let s = 'Commands run through `shell` in the working directory with the PATH inherited from the invoking shell. Documented commands:\n'
  if (tools.bash_tools.length === 0) s += '(no additional commands documented; standard commands on PATH may be used)\n'
  for (const m of tools.bash_tools) {
    s += `- ${m.name}: ${rustTrim(m.description)} Command: \`${m.command}\`.${m.usage !== undefined ? ` Usage: \`${m.usage}\`.` : ''}\n`
  }
  return rustTrimEnd(s)
}

const CONTEXT_LABELS: [string, string][] = [
  ['current_time', 'Current time'], ['timezone', 'Timezone'], ['os', 'Operating system'], ['cwd', 'Working directory'],
  ['id', 'Runtime'], ['kind', 'Execution mechanism'], ['arch', 'Architecture'], ['hostname', 'Hostname'], ['shell', 'Shell'],
  ['baseline', 'Environment baseline'], ['tools', 'Available tools'],
]

/** System text of the `contexts` section (20): RuntimeInfo facts the templates did not reference. */
export function buildContextsSystemText(runtime: Record<string, string>, referenced: Record<string, string>): string | undefined {
  const lines: string[] = []
  for (const [key, label] of CONTEXT_LABELS) {
    if (`runtime.${key}` in referenced) continue
    const v = runtime[key]
    if (v === undefined) continue
    if (key === 'baseline' && v === '') continue
    lines.push(`${label}: ${v}`)
  }
  return lines.length ? lines.join('\n') : undefined
}
