// Reply-contract checks (`llm_context/src/json_check.rs`): the subset of JSON
// Schema structured-output providers support, with error messages that point
// at the offending value (fed back to the model as is).

import type { JsonValue } from './types'
import type { OutputValidator } from './deps'
import { canonicalJson, isObject } from './json'
import { rustTrim } from './rust_text'

function typeName(v: JsonValue): string {
  if (v === null) return 'null'
  if (typeof v === 'boolean') return 'boolean'
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number'
  if (typeof v === 'string') return 'string'
  if (Array.isArray(v)) return 'array'
  return 'object'
}

function isType(v: JsonValue, name: string): boolean {
  if (name === 'number') return typeof v === 'number'
  if (name === 'integer') return typeof v === 'number' && Number.isInteger(v)
  return typeName(v) === name
}

function at(path: string): string {
  return path === '' ? 'the reply' : path
}

function check(schema: JsonValue, value: JsonValue, path: string): string | undefined {
  if (!isObject(schema)) return schema === false ? `${at(path)}: no value is allowed here` : undefined
  const s = schema
  const t = s.type
  if (t !== undefined) {
    const names = typeof t === 'string' ? [t] : Array.isArray(t) ? t.filter((n): n is string => typeof n === 'string') : []
    if (names.length && !names.some(n => isType(value, n))) return `${at(path)}: expected ${names.join(' or ')}, got ${typeName(value)}`
  }
  if (Array.isArray(s.enum)) {
    if (!s.enum.some(o => canonicalJson(o) === canonicalJson(value))) {
      return `${at(path)}: must be one of ${s.enum.map(o => canonicalJson(o)).join(', ')}`
    }
  }
  if (s.const !== undefined && canonicalJson(s.const) !== canonicalJson(value)) return `${at(path)}: must be ${canonicalJson(s.const)}`
  if (isObject(value)) {
    const props = isObject(s.properties) ? s.properties : undefined
    if (Array.isArray(s.required)) {
      for (const key of s.required) {
        if (typeof key === 'string' && !(key in value)) return `${at(path)}: missing required field \`${key}\``
      }
    }
    for (const key of Object.keys(value).sort()) {
      const v = value[key]
      const child = `${path}/${key}`
      const sub = props?.[key]
      if (sub !== undefined) {
        const e = check(sub, v, child)
        if (e) return e
      } else if (s.additionalProperties === false) {
        return `${at(path)}: unknown field \`${key}\` (allowed: ${Object.keys(props ?? {}).sort().join(', ')})`
      } else if (isObject(s.additionalProperties)) {
        const e = check(s.additionalProperties, v, child)
        if (e) return e
      }
    }
  } else if (Array.isArray(value)) {
    if (typeof s.minItems === 'number' && value.length < s.minItems) return `${at(path)}: needs at least ${s.minItems} items`
    if (typeof s.maxItems === 'number' && value.length > s.maxItems) return `${at(path)}: allows at most ${s.maxItems} items`
    if (s.items !== undefined && (isObject(s.items) || typeof s.items === 'boolean')) {
      for (let i = 0; i < value.length; i++) {
        const e = check(s.items, value[i], `${path}/${i}`)
        if (e) return e
      }
    }
  } else if (typeof value === 'string') {
    const len = [...value].length
    if (typeof s.minLength === 'number' && len < s.minLength) return `${at(path)}: needs at least ${s.minLength} characters`
    if (typeof s.maxLength === 'number' && len > s.maxLength) return `${at(path)}: allows at most ${s.maxLength} characters`
  } else if (typeof value === 'number') {
    if (typeof s.minimum === 'number' && value < s.minimum) return `${at(path)}: must be at least ${s.minimum}`
    if (typeof s.maximum === 'number' && value > s.maximum) return `${at(path)}: must be at most ${s.maximum}`
  }
  if (Array.isArray(s.allOf)) {
    for (const sub of s.allOf) {
      const e = check(sub, value, path)
      if (e) return e
    }
  }
  for (const key of ['anyOf', 'oneOf'] as const) {
    const options = s[key]
    if (!Array.isArray(options)) continue
    let first: string | undefined
    let matched = 0
    for (const sub of options) {
      const e = check(sub, value, path)
      if (e === undefined) matched += 1
      else if (first === undefined) first = e
    }
    const ok = key === 'oneOf' ? matched === 1 : matched >= 1
    if (!ok) return matched === 0 && first !== undefined ? first : `${at(path)}: must match exactly one alternative`
  }
  return undefined
}

/** `undefined` when `value` matches `schema`, otherwise the first mismatch. */
export function validateJson(schema: JsonValue, value: JsonValue): string | undefined {
  return check(schema, value, '')
}

/** Parse a reply as one JSON value; one surrounding code fence is tolerated. */
export function parseReply(text: string): JsonValue {
  const trimmed = rustTrim(text)
  try {
    return JSON.parse(trimmed)
  } catch (e) {
    if (trimmed.startsWith('```') && trimmed.endsWith('```') && trimmed.length >= 6) {
      let body = trimmed.slice(3, -3)
      if (body.startsWith('json')) body = body.slice(4)
      return JSON.parse(rustTrim(body))
    }
    throw e
  }
}

/** A reply under a reply contract: parsed, matching the schema, accepted by the host's validator. */
export async function checkReply(text: string, schema: JsonValue | undefined, validator?: OutputValidator):
  Promise<{ ok: true; value: JsonValue } | { ok: false; error: string }> {
  let value: JsonValue
  try {
    value = parseReply(text)
  } catch (e) {
    return { ok: false, error: `the reply is not one JSON value (${e instanceof Error ? e.message : String(e)})` }
  }
  if (schema !== undefined) {
    const e = validateJson(schema, value)
    if (e) return { ok: false, error: e }
  }
  if (validator) {
    try {
      await validator.validate(value)
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
  return { ok: true, value }
}

/** The correction message after a reply that broke the reply contract. */
export function repairMessage(error: string, schema: JsonValue | undefined): string {
  let m = `Your reply does not meet the required format: ${error}.\n`
  if (schema !== undefined) m += `The reply must be exactly one JSON value matching this JSON Schema: ${canonicalJson(schema)}\n`
  m += 'Reply again with only that JSON value: no prose, no code fence.'
  return m
}
