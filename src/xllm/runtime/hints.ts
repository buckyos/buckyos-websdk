// What the model was already shown of results (`agent_tool/src/hints.rs`):
// `once` hints appear once (kept in run.json as `hints_once`), a `dedup` key
// replaces a result the model was shown in full with its short hint, naming
// the call that showed it, until the history is rewritten (compaction clears
// the namespace).

import type { AgentToolResult } from './tool_result'
import { rustTrim, rustTrimEnd } from '../core/rust_text'

export const HINT_NS_ONCE = 'once'
export const HINT_NS_DEDUP = 'dedup'

export interface HintLedger {
  /** The call that showed `key` (`''` when unknown); `undefined`: not shown. */
  origin(ns: string, key: string): string | undefined
  seen(ns: string, key: string): boolean
  mark(ns: string, key: string, origin: string): void
  clear(ns: string): void
  keys(ns: string): string[]
}

export class MemoryHintLedger implements HintLedger {
  private readonly inner = new Map<string, Map<string, string>>()

  static seeded(ns: string, keys: Iterable<string>): MemoryHintLedger {
    const l = new MemoryHintLedger()
    for (const k of keys) l.mark(ns, k, '')
    return l
  }

  origin(ns: string, key: string): string | undefined {
    return this.inner.get(ns)?.get(key)
  }

  seen(ns: string, key: string): boolean {
    return this.origin(ns, key) !== undefined
  }

  mark(ns: string, key: string, origin: string) {
    let s = this.inner.get(ns)
    if (!s) this.inner.set(ns, (s = new Map()))
    s.set(key, origin)
  }

  clear(ns: string) {
    this.inner.delete(ns)
  }

  keys(ns: string): string[] {
    return [...(this.inner.get(ns)?.keys() ?? [])].sort()
  }
}

/** `dedup_text`: what replaces a result shown in full before by call `origin`. */
export function dedupText(hint: string, origin: string): string {
  const h = rustTrim(hint).replace(/\.+$/, '')
  return origin === '' ? `${h}; it is shown in full above.` : `${h}; same as the result of call ${origin} above.`
}

/** Apply the ledger to the result of call `callId` (mutated): dedup replacement, `once` filtering; returns the hint texts to show. */
export function applyHints(result: AgentToolResult, ledger: HintLedger, callId: string): string[] {
  if (result.dedup) {
    const origin = ledger.origin(HINT_NS_DEDUP, result.dedup.key)
    if (origin !== undefined) {
      const text = dedupText(result.dedup.hint, origin)
      result.output = text
      result.summary = text
      result.detail = origin === '' ? { dedup: result.dedup.key } : { dedup: result.dedup.key, dedup_of: origin }
      delete result.partial_output
    } else {
      ledger.mark(HINT_NS_DEDUP, result.dedup.key, callId)
    }
  }
  const kept = []
  for (const h of result.hints ?? []) {
    if (!rustTrim(h.text)) continue
    const key = h.once || undefined
    if (key !== undefined) {
      if (ledger.seen(HINT_NS_ONCE, key)) continue
      ledger.mark(HINT_NS_ONCE, key, callId)
    }
    kept.push(h)
  }
  if (result.hints !== undefined) result.hints = kept
  return kept.map(h => rustTrim(h.text))
}

export function renderHintBlock(hints: string[]): string {
  let s = '<runtime_hints>\n'
  for (const h of hints) s += `- ${rustTrim(h)}\n`
  return s + '</runtime_hints>'
}

/** The result text with the hints after it (`<output>` / `<runtime_hints>`). */
export function renderWithHints(text: string, hints: string[]): string {
  if (hints.length === 0) return text
  return `<output>\n${rustTrimEnd(text)}\n</output>\n${renderHintBlock(hints)}`
}
