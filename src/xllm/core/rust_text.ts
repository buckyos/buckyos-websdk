// Rust string and JSON semantics for text the model sees: trimming with
// Rust's whitespace set (`char::is_whitespace` differs from JS `trim` in
// U+0085 and U+FEFF), lengths in Unicode scalar values, JSON written the way
// serde_json writes it (keys in code point order, serde's number layout).

import type { AiMessage, JsonValue } from './types'

/** `char::is_whitespace` (Unicode White_Space); every such char is a single UTF-16 unit. */
function isRustWhitespace(c: number): boolean {
  return (c >= 0x09 && c <= 0x0d) || c === 0x20 || c === 0x85 || c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000
}

/** `str::trim_start`. */
export function rustTrimStart(s: string): string {
  let i = 0
  while (i < s.length && isRustWhitespace(s.charCodeAt(i))) i++
  return i === 0 ? s : s.slice(i)
}

/** `str::trim_end`. */
export function rustTrimEnd(s: string): string {
  let j = s.length
  while (j > 0 && isRustWhitespace(s.charCodeAt(j - 1))) j--
  return j === s.length ? s : s.slice(0, j)
}

/** `str::trim`. */
export function rustTrim(s: string): string {
  return rustTrimStart(rustTrimEnd(s))
}

/** `s.split_whitespace().collect::<Vec<_>>().join(" ")`. */
export function collapseWhitespace(s: string): string {
  const words: string[] = []
  let start = -1
  for (let i = 0; i < s.length; i++) {
    if (isRustWhitespace(s.charCodeAt(i))) {
      if (start >= 0) words.push(s.slice(start, i))
      start = -1
    } else if (start < 0) {
      start = i
    }
  }
  if (start >= 0) words.push(s.slice(start))
  return words.join(' ')
}

function isPairAt(s: string, i: number): boolean {
  const c = s.charCodeAt(i)
  return c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00
}

/** UTF-16 offset after the first `n` chars (Unicode scalar values) of `s`; `s.length` when it has fewer. */
export function charOffset(s: string, n: number): number {
  let i = 0
  for (let k = 0; k < n && i < s.length; k++) i += isPairAt(s, i) ? 2 : 1
  return i
}

/** `str::chars().count()`. */
export function charCount(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i += isPairAt(s, i) ? 2 : 1) n++
  return n
}

/** `AiMessage::text_content`: text blocks joined by `\n`, a separator only once something was written. */
export function rustTextContent(message: AiMessage): string {
  let out = ''
  for (const b of message.content) {
    if (b.type !== 'text') continue
    if (out !== '') out += '\n'
    out += b.text
  }
  return out
}

/** Order of Rust `String` (UTF-8 bytes, i.e. code points). */
export function compareCodePoints(a: string, b: string): number {
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    const x = a.codePointAt(i) as number
    const y = b.codePointAt(j) as number
    if (x !== y) return x - y
    i += x > 0xffff ? 2 : 1
    j += y > 0xffff ? 2 : 1
  }
  return (a.length - i) - (b.length - j)
}

/**
 * A number as serde_json writes the value it parsed from this number's JSON
 * text: an integer in the i64 / u64 range as is, anything else as an f64 in
 * the layout of serde_json's formatter (zmij): fixed notation for decimal
 * exponents -5..=15 (`0.00001`, `3.0`), else `1e+21` / `2.5e-7`.
 */
function serdeNumber(n: number): string {
  if (!Number.isFinite(n)) return 'null'
  // -2^63 itself prints as -9223372036854776000, below i64::MIN: serde reads an f64.
  if (Number.isInteger(n) && n > -(2 ** 63) && n < 2 ** 64) return String(n)
  const [mantissa, exponent] = Math.abs(n).toExponential().split('e')
  const digits = mantissa.replace('.', '')
  const length = digits.length
  const e = Number(exponent)
  let s: string
  if (e >= -5 && e <= 15) {
    if (length - 1 <= e) s = `${digits}${'0'.repeat(e + 1 - length)}.0`
    else if (e >= 0) s = `${digits.slice(0, e + 1)}.${digits.slice(e + 1)}`
    else s = `0.${'0'.repeat(-e - 1)}${digits}`
  } else {
    s = `${length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits}e${e < 0 ? '-' : '+'}${Math.abs(e)}`
  }
  return n < 0 ? `-${s}` : s
}

function writeJson(v: JsonValue | undefined, indent: string | undefined): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'string') return JSON.stringify(v)
  if (typeof v === 'number') return serdeNumber(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  const inner = indent === undefined ? undefined : `${indent}  `
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]'
    const items = v.map(x => writeJson(x, inner))
    return inner === undefined ? `[${items.join(',')}]` : `[${inner}${items.join(`,${inner}`)}${indent}]`
  }
  const keys = Object.keys(v).filter(k => v[k] !== undefined).sort(compareCodePoints)
  if (keys.length === 0) return '{}'
  const items = keys.map(k => `${JSON.stringify(k)}:${inner === undefined ? '' : ' '}${writeJson(v[k], inner)}`)
  return inner === undefined ? `{${items.join(',')}}` : `{${inner}${items.join(`,${inner}`)}${indent}}`
}

/** `serde_json::to_string` (or `to_string_pretty`) of a `Value`: keys in Rust's order, numbers as serde prints them. */
export function serdeJson(value: JsonValue, pretty = false): string {
  return writeJson(value, pretty ? '\n' : undefined)
}

