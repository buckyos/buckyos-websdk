// JSON helpers. serde_json (without `preserve_order`) writes object keys in
// code point order; `canonicalJson` writes JSON exactly as serde_json does,
// so lengths, comparisons and model-visible text match the Rust side.

import type { JsonValue } from './types'
import { serdeJson } from './rust_text'

/** `serde_json::to_string` of the value (after a JSON round trip, so `toJSON` and `undefined` behave as in JSON). */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null'
  return serdeJson(JSON.parse(JSON.stringify(value)) as JsonValue)
}

/** Deep copy of a JSON value (drops `undefined` members like serialization does). */
export function cloneJson<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value))
}

/** Structural equality of two JSON values, `undefined` members ignored. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b)
}

export function isObject(v: unknown): v is { [key: string]: JsonValue } {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
