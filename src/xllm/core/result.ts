// `result_format` extraction (`extract_result`, `ExtractedValue` in xllm.rs).

import type { ExtractedValue, JsonValue, ResultFormat } from './types'
import { XllmError } from './errors'
import { resultFormatString } from './config'
import { scanXmlElements, stripCodeFences, xmlChildren, xmlText } from './xml'
import type { XmlElement } from './xml'
import { rustTrim } from './rust_text'

function extractError(message: string): XllmError {
  return new XllmError({ kind: 'extract', message })
}

function jsonKind(v: JsonValue): string {
  if (v === null) return 'null'
  if (typeof v === 'boolean') return 'boolean'
  if (typeof v === 'number') return 'number'
  if (typeof v === 'string') return 'string'
  return 'scalar'
}

/** Apply `result_format` to the final reply; a failure is an error, never a silent fallback to raw. */
export function extractResult(raw: string, fmt: ResultFormat): ExtractedValue {
  if (fmt.kind === 'raw') return { kind: 'text', text: raw }
  const segments = fmt.segments
  const trimmed = rustTrim(stripCodeFences(raw))
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let cur: JsonValue
    try {
      cur = JSON.parse(trimmed)
    } catch (e) {
      throw extractError(`final response looks like JSON but does not parse: ${e instanceof Error ? e.message : String(e)}`)
    }
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      const pathSoFar = segments.slice(0, i + 1).join('.')
      if (Array.isArray(cur)) {
        if (!/^[0-9]+$/.test(seg)) throw extractError(`\`result.${pathSoFar}\`: parent is an array, segment \`${seg}\` is not an index`)
        const idx = Number(seg)
        if (idx >= cur.length) throw extractError(`\`result.${pathSoFar}\`: index ${idx} out of range (${cur.length} items)`)
        cur = cur[idx]
      } else if (cur !== null && typeof cur === 'object') {
        if (!(seg in cur)) {
          throw extractError(`JSON field \`result.${pathSoFar}\` is missing (available: ${Object.keys(cur).sort().join(', ')})`)
        }
        cur = cur[seg]
      } else {
        throw extractError(`\`result.${pathSoFar}\`: cannot descend into a ${jsonKind(cur)} value`)
      }
    }
    return typeof cur === 'string' ? { kind: 'text', text: cur } : { kind: 'json', value: cur }
  }
  if (trimmed.startsWith('<')) {
    const root = scanXmlElements(trimmed)[0]
    if (!root) throw extractError('final response looks like XML but has no root element')
    let cur: XmlElement = root
    for (let i = 0; i < segments.length; i++) {
      const pathSoFar = segments.slice(0, i + 1).join('.')
      const matches = xmlChildren(cur).filter(c => c.name === segments[i])
      if (matches.length === 0) throw extractError(`XML element \`result.${pathSoFar}\` not found under <${cur.name}>`)
      if (matches.length > 1) throw extractError(`XML path \`result.${pathSoFar}\` matches ${matches.length} elements; the path must be unique`)
      cur = matches[0]
    }
    return xmlChildren(cur).length === 0 ? { kind: 'text', text: xmlText(cur) } : { kind: 'xml', xml: rustTrim(cur.body) }
  }
  throw extractError(`final response is neither JSON nor XML, cannot apply \`${resultFormatString(fmt)}\` (use raw or adjust output_format)`)
}

/** `--json` check of an extracted value. */
export function extractedAsJson(v: ExtractedValue): { ok: true; value: JsonValue } | { ok: false; error: string } {
  if (v.kind === 'json') return { ok: true, value: v.value }
  if (v.kind === 'xml') return { ok: false, error: 'result is XML, not JSON' }
  try {
    return { ok: true, value: JSON.parse(rustTrim(stripCodeFences(v.text))) }
  } catch (e) {
    return { ok: false, error: `result is not valid JSON: ${e instanceof Error ? e.message : String(e)}` }
  }
}
