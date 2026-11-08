// Templates and system prompt assembly (`TemplateEnv`, `assemble_prompt`,
// section helpers in xllm.rs).

import type {
  EffectiveTools, GroupDef, LoopModel, PromptMode, PromptPlan, RuntimeInfo, SectionDef, SectionRender,
} from './types'
import { XllmError } from './errors'
import { canonicalJson } from './json'
import {
  RUNTIME_PROTOCOL_VERSION, buildCmdManualSystemText, buildContextsSystemText, buildRulesSystemText, buildRuntimeProtocol,
} from './protocol'
import type { MergedConfig } from './config'
import { rustTrim, rustTrimEnd } from './rust_text'

/** Fixed section aliases → line numbers. */
export const SECTION_ALIASES: [string, number][] = [
  ['role', 10], ['contexts', 20], ['env', 20], ['rules', 30], ['cmd_manual', 40], ['output_format', 100],
]

export function resolveSectionKey(key: string): number | string {
  const k = rustTrim(key)
  if (!k) return 'empty section key'
  if (/^[0-9]+$/.test(k)) {
    const n = Number(k)
    if (!Number.isSafeInteger(n) || n > 0xffffffff) return `invalid line number \`${k}\``
    if (n === 0) return 'line number must be a positive integer'
    return n
  }
  const alias = SECTION_ALIASES.find(([a]) => a === k)
  if (alias) return alias[1]
  return `unknown section alias \`${k}\` (fixed aliases: ${SECTION_ALIASES.map(([a, l]) => `${a}=${l}`).join(', ')}; or use a numeric line number)`
}

export function aliasLine(name: string): number | undefined {
  return SECTION_ALIASES.find(([a]) => a === name)?.[1]
}

export function sectionDefaultName(line: number): string {
  switch (line) {
    case 10: return 'role'
    case 20: return 'contexts'
    case 30: return 'rules'
    case 40: return 'cmd_manual'
    case 100: return 'output_format'
    default: return `section_${line}`
  }
}

/** `RuntimeInfo::template_values`: strings as they are, other values as JSON. */
export function runtimeTemplateValues(info: RuntimeInfo): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(info)) out[k] = typeof v === 'string' ? v : canonicalJson(v)
  return out
}

/**
 * Template variables: `runtime.*` from the runtime, `env.*` read only when a
 * template references them (from what the host / page passed). `\{{` is a
 * literal `{{`; values are not interpreted again.
 */
export class TemplateEnv {
  readonly runtime: Record<string, string>
  private readonly used: Record<string, string> = {}

  constructor(runtime: Record<string, string>, private readonly env: (name: string) => string | undefined) {
    this.runtime = { ...runtime }
  }

  static forNewRun(info: RuntimeInfo, env: (name: string) => string | undefined): TemplateEnv {
    return new TemplateEnv(runtimeTemplateValues(info), env)
  }

  usedVars(): Record<string, string> {
    return { ...this.used }
  }

  private lookup(name: string, source: string): string {
    let value: string | undefined
    if (name.startsWith('runtime.')) {
      value = this.runtime[name.slice('runtime.'.length)]
      if (value === undefined) {
        const available = Object.keys(this.runtime).sort().map(k => `runtime.${k}`).join(', ')
        throw XllmError.template(source, `unknown runtime variable \`${name}\` (available: ${available})`)
      }
    } else if (name.startsWith('env.')) {
      const key = name.slice('env.'.length)
      value = this.env(key)
      if (value === undefined) throw XllmError.template(source, `environment variable \`${key}\` is not set (referenced as \`${name}\`)`)
    } else {
      throw XllmError.template(source, `unknown template variable \`${name}\` (use \`runtime.*\` or \`env.*\`)`)
    }
    this.used[name] = value
    return value
  }

  render(text: string, source: string): string {
    let out = ''
    let rest = text
    for (;;) {
      const pos = rest.indexOf('{{')
      if (pos < 0) {
        out += rest
        break
      }
      if (pos > 0 && rest[pos - 1] === '\\') {
        out += rest.slice(0, pos - 1) + '{{'
        rest = rest.slice(pos + 2)
        continue
      }
      out += rest.slice(0, pos)
      const after = rest.slice(pos + 2)
      const end = after.indexOf('}}')
      if (end < 0) throw XllmError.template(source, 'unterminated `{{` placeholder')
      const name = rustTrim(after.slice(0, end))
      if (!name || !/^[A-Za-z0-9_.-]+$/.test(name)) throw XllmError.template(source, `invalid placeholder \`{{${name}}}\``)
      out += this.lookup(name, source)
      rest = after.slice(end + 2)
    }
    return out
  }
}

export function sectionIsEmpty(s: SectionRender): boolean {
  return !rustTrim(s.user_text ?? '') && !rustTrim(s.system_text ?? '')
}

export interface PromptAssembly {
  merged: MergedConfig
  /** `TaskOverrides.system` / `.select` (explicit arguments). */
  overrideSystem?: string
  overrideSelect?: string
  groupName?: string
  group?: GroupDef
  loopModel: LoopModel
  tools: EffectiveTools
  env: TemplateEnv
  json: boolean
}

/** System prompt of a run that xllm assembles itself (`assemble_prompt`). */
export function assemblePrompt(a: PromptAssembly): PromptPlan {
  const runtimeProtocol = buildRuntimeProtocol(a.loopModel, a.tools, a.json)
  const mode: PromptMode = a.overrideSystem !== undefined ? 'custom' : a.overrideSelect !== undefined ? 'standard'
    : a.merged.prompt.mode ?? 'standard'
  const sections: SectionRender[] = []
  let customSystem: string | undefined
  let customSystemSource: string | undefined
  if (mode === 'custom') {
    let text: string
    let source: string
    if (a.overrideSystem !== undefined) {
      text = a.overrideSystem
      source = 'cli:--system'
    } else {
      source = a.merged.sources['prompt.system'] ?? 'prompt.system'
      if (a.merged.prompt.system === undefined) throw XllmError.config(source, 'prompt.system', 'mode `custom` requires `prompt.system`')
      text = a.merged.prompt.system
    }
    customSystem = a.env.render(text, source)
    customSystemSource = source
  } else {
    const userTexts = new Map<number, { name?: string; text?: string; source: string }>()
    for (const [line, def] of Object.entries(a.group?.sections ?? {}) as [string, SectionDef][]) {
      userTexts.set(Number(line), { name: def.name, text: def.text, source: `group:${a.groupName ?? '?'}` })
    }
    for (const [line, def] of Object.entries(a.merged.prompt.sections ?? {}) as [string, SectionDef][]) {
      const n = Number(line)
      const entry = userTexts.get(n) ?? { source: def.source }
      if (def.name !== undefined) entry.name = def.name
      if (def.text !== undefined) {
        entry.text = def.text
        entry.source = def.source
      }
      userTexts.set(n, entry)
    }
    for (const line of [10, 20, 30, 40, 100]) if (!userTexts.has(line)) userTexts.set(line, { source: 'default' })
    for (const line of [...userTexts.keys()].sort((x, y) => x - y)) {
      const { name, text, source } = userTexts.get(line)!
      const rendered = text !== undefined && rustTrim(text) ? a.env.render(text, `${source} (section ${line})`) : undefined
      const sec: SectionRender = { line, name: name ?? sectionDefaultName(line), user_source: source }
      if (rendered !== undefined) sec.user_text = rendered
      sections.push(sec)
    }
  }
  const defaultUser = a.group?.default_user
  const groupDefaultUser = defaultUser !== undefined && rustTrim(defaultUser)
    ? a.env.render(defaultUser, `group:${a.groupName ?? '?'}:default_user`) : undefined
  const referenced = a.env.usedVars()
  if (mode === 'standard') {
    for (const sec of sections) {
      const text = sec.line === 20 ? buildContextsSystemText(a.env.runtime, referenced)
        : sec.line === 30 ? buildRulesSystemText(a.loopModel, a.tools)
          : sec.line === 40 ? buildCmdManualSystemText(a.tools) : undefined
      if (text !== undefined) sec.system_text = text
      else delete sec.system_text
      if (sec.line === 40 && !a.tools.exec_enabled) delete sec.user_text
    }
  }
  let system = ''
  if (mode === 'custom') {
    if (customSystem !== undefined) system += rustTrimEnd(customSystem) + '\n\n'
    system += '## capabilities\n' + buildRulesSystemText(a.loopModel, a.tools)
    const manual = buildCmdManualSystemText(a.tools)
    if (manual !== undefined) system += '\n\n' + manual
    system += '\n\n'
  } else {
    for (const sec of sections) {
      if (sectionIsEmpty(sec)) continue
      system += `## ${sec.name}\n`
      if (sec.user_text !== undefined) system += rustTrimEnd(sec.user_text) + '\n'
      if (sec.system_text !== undefined) system += rustTrimEnd(sec.system_text) + '\n'
      system += '\n'
    }
  }
  system += '## runtime_protocol\n' + rustTrimEnd(runtimeProtocol) + '\n'
  const plan: PromptPlan = {
    mode, loop_model: a.loopModel, sections, runtime_protocol: runtimeProtocol, protocol_version: RUNTIME_PROTOCOL_VERSION,
    system_prompt: system, user_request_source: 'group_default', template_vars: a.env.usedVars(), runtime_vars: { ...a.env.runtime },
  }
  if (a.groupName !== undefined) plan.group = a.groupName
  if (customSystem !== undefined) plan.custom_system = customSystem
  if (customSystemSource !== undefined) plan.custom_system_source = customSystemSource
  if (groupDefaultUser !== undefined) plan.user_request = groupDefaultUser
  return plan
}
