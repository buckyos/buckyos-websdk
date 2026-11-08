// The behavior protocol parser (Rust `XllmActionParser`): one
// `<response>` per reply; action tags come from the run's actions,
// attributes and child elements are arguments, the body carries the body
// argument (or JSON); a reply without actions and with `<report end="true">`
// is the final answer. Unknown tags still become calls so the tool manager
// answers "not available" for the model to correct.

import type { AiResponse, AiToolCall, JsonValue, LLMBehaviorResult, ResolvedTool } from './types'
import type { LLMResultParser } from './deps'
import { isObject } from './json'
import { textContent, toolCalls } from './messages'
import { actionBodyArg } from './protocol'
import { scanXmlElements, stripCodeFences, xmlChildren, xmlText } from './xml'
import type { XmlElement } from './xml'
import { validateBehaviorResult } from './behavior_result'
import { rustTrim } from './rust_text'

/** Key of the report attachments inside `report_result` (`<artifacts>`). */
export const REPORT_ARTIFACTS_KEY = 'artifacts'

const RUST_SPECIAL_FLOAT = /^[+-]?(inf|infinity|nan)$/i

function coerce(schema: JsonValue | undefined, raw: string): JsonValue {
  const ty = isObject(schema) && typeof schema.type === 'string' ? schema.type : 'string'
  const t = rustTrim(raw)
  if (ty === 'integer') {
    if (/^[+-]?\d+$/.test(t)) {
      const n = Number(t)
      if (Number.isSafeInteger(n)) return n
    }
    return raw
  }
  if (ty === 'number') {
    if (RUST_SPECIAL_FLOAT.test(t)) return null
    if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return Number(t)
    return raw
  }
  if (ty === 'boolean') return t === 'true' ? true : t === 'false' ? false : raw
  if (ty === 'object' || ty === 'array') {
    try {
      return JSON.parse(t)
    } catch {
      return raw
    }
  }
  return raw
}

export class XllmActionParser implements LLMResultParser {
  private readonly actions = new Map<string, JsonValue>()

  constructor(actions: ResolvedTool[]) {
    for (const t of actions) this.actions.set(t.name, t.args_schema)
  }

  private elementToCall(el: XmlElement, autoId: { n: number }): AiToolCall {
    const schema = this.actions.get(el.name)
    const props = isObject(schema) && isObject(schema.properties) ? schema.properties : undefined
    const args: Record<string, JsonValue> = {}
    let callId: string | undefined
    for (const [k, v] of el.attrs) {
      if (k === 'call_id') {
        callId = v
        continue
      }
      args[k] = coerce(props?.[k], v)
    }
    const children = xmlChildren(el)
    if (children.length > 0) {
      for (const child of children) args[child.name] = coerce(props?.[child.name], xmlText(child))
    } else if (rustTrim(el.body)) {
      const bodyArg = schema !== undefined ? actionBodyArg({ name: el.name, description: '', args_schema: schema, source: '' }) : undefined
      const text = xmlText(el)
      if (bodyArg !== undefined && !(bodyArg in args)) {
        args[bodyArg] = text
      } else {
        let obj: JsonValue | undefined
        try {
          obj = JSON.parse(rustTrim(text))
        } catch {
          obj = undefined
        }
        if (isObject(obj)) {
          for (const [k, v] of Object.entries(obj)) if (!(k in args)) args[k] = v
        } else if (bodyArg !== undefined) {
          if (!(bodyArg in args)) args[bodyArg] = text
        } else {
          args.body = text
        }
      }
    }
    autoId.n += 1
    return { name: el.name, args, call_id: callId ?? `action-${autoId.n}` }
  }

  parse(response: AiResponse): LLMBehaviorResult {
    const rawText = textContent(response.message)
    const providerCalls = toolCalls(response.message)
    if (!rustTrim(rawText) && providerCalls.length === 0) throw new Error('empty response: no text and no tool_calls')
    const top = scanXmlElements(stripCodeFences(rawText))
    const region = top.find(e => e.name === 'response')
    const children = region ? xmlChildren(region) : top
    const firstText = (name: string) => {
      const e = children.find(c => c.name === name)
      const t = e ? rustTrim(xmlText(e)) : ''
      return t ? t : undefined
    }
    const thought = firstText('intent') ?? firstText('thinking')
    const observation = firstText('observation')
    if (children.filter(e => e.name === 'next_behavior').length > 1) throw new Error('a decision must contain at most one next_behavior')
    const nextBehavior = firstText('next_behavior')
    const reports = children.filter(e => e.name === 'report')
    if (reports.length > 1) throw new Error('a decision must contain at most one report')
    const selfReport = reports[0] ? xmlText(reports[0]) : undefined
    let reportEnd = false
    if (reports[0]) {
      const ends = reports[0].attrs.filter(([k]) => k === 'end')
      if (ends.length > 1) throw new Error('report has duplicate end attributes')
      const v = ends[0]?.[1]
      if (v === 'true') reportEnd = true
      else if (v !== undefined && v !== 'false') throw new Error('report end must be true or false')
    }
    const payload = (name: string): JsonValue | undefined => {
      const els = children.filter(e => e.name === name)
      if (els.length > 1) throw new Error(`a decision must contain at most one ${name}`)
      if (!els[0]) return undefined
      if (selfReport === undefined) throw new Error(`${name} requires a report in the same decision`)
      try {
        return JSON.parse(xmlText(els[0]))
      } catch (e) {
        throw new Error(`invalid report ${name} JSON: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    const artifactsValue = payload('artifacts')
    let artifacts: string[] | undefined
    if (artifactsValue !== undefined) {
      if (!Array.isArray(artifactsValue) || artifactsValue.some(a => typeof a !== 'string')) {
        throw new Error('report artifacts must be an array of strings: invalid type')
      }
      artifacts = artifactsValue as string[]
    }
    const reportResult = withReportArtifacts(payload('result'), artifacts)
    const actionEls = children.filter(e => e.name === 'actions').flatMap(xmlChildren)
    if (reportEnd && (actionEls.length > 0 || children.some(e => e.name === 'actions' && rustTrim(e.body)))) {
      throw new Error('a final report cannot be combined with actions')
    }
    const autoId = { n: 0 }
    let doActions = actionEls.map(el => this.elementToCall(el, autoId))
    if (providerCalls.length > 0) doActions = providerCalls
    const result: LLMBehaviorResult = { assistant_text: rawText, report_end: reportEnd }
    if (doActions.length) result.do_actions = doActions
    if (nextBehavior !== undefined) result.next_behavior = nextBehavior
    if (observation !== undefined) result.observation = observation
    if (thought !== undefined) result.thought = thought
    if (selfReport !== undefined) result.self_report = selfReport
    if (reportResult !== undefined) result.report_result = reportResult
    const invalid = validateBehaviorResult(result)
    if (invalid) throw new Error(invalid)
    return result
  }
}

function withReportArtifacts(result: JsonValue | undefined, artifacts: string[] | undefined): JsonValue | undefined {
  if (artifacts === undefined) return result
  let obj: { [k: string]: JsonValue }
  if (result === undefined || result === null) obj = {}
  else if (isObject(result)) obj = { ...result }
  else throw new Error('a report result given with artifacts must be a JSON object')
  if (REPORT_ARTIFACTS_KEY in obj) throw new Error(`report result must not carry \`${REPORT_ARTIFACTS_KEY}\` when <artifacts> is given`)
  obj[REPORT_ARTIFACTS_KEY] = artifacts
  return obj
}

/** The attachments carried in a `report_result`. */
export function reportArtifacts(result: JsonValue | undefined): string[] {
  const a = isObject(result) ? result[REPORT_ARTIFACTS_KEY] : undefined
  return Array.isArray(a) && a.every(x => typeof x === 'string') ? (a as string[]) : []
}

/** A `report_result` taken apart again: its attachments and the rest (`undefined` when nothing else was given). */
export function splitReportResult(result: JsonValue | undefined): [string[], JsonValue | undefined] {
  const artifacts = reportArtifacts(result)
  if (isObject(result) && REPORT_ARTIFACTS_KEY in result) {
    const rest = { ...result }
    delete rest[REPORT_ARTIFACTS_KEY]
    return [artifacts, Object.keys(rest).length ? rest : undefined]
  }
  return [artifacts, result]
}
