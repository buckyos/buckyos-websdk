// What the model was already shown of results (`agent_tool/src/hints.rs`):
// `once` hints appear once per run (kept in run.json as `hints_once`), a
// `dedup` key replaces a result the model has seen with its short hint until
// the history is rewritten (compaction clears the namespace).

import type { AgentToolResult } from './tool_result'
import { rustTrim, rustTrimEnd } from '../core/rust_text'

export const HINT_NS_ONCE = 'once'
export const HINT_NS_DEDUP = 'dedup'

export interface HintLedger {
  seen(ns: string, key: string): boolean
  mark(ns: string, key: string): void
  clear(ns: string): void
  keys(ns: string): string[]
}

export class MemoryHintLedger implements HintLedger {
  private readonly inner = new Map<string, Set<string>>()

  static seeded(ns: string, keys: Iterable<string>): MemoryHintLedger {
    const l = new MemoryHintLedger()
    for (const k of keys) l.mark(ns, k)
    return l
  }

  seen(ns: string, key: string): boolean {
    return this.inner.get(ns)?.has(key) ?? false
  }

  mark(ns: string, key: string) {
    let s = this.inner.get(ns)
    if (!s) this.inner.set(ns, (s = new Set()))
    s.add(key)
  }

  clear(ns: string) {
    this.inner.delete(ns)
  }

  keys(ns: string): string[] {
    return [...(this.inner.get(ns) ?? [])].sort()
  }
}

/** Apply the ledger to `result` (mutated): dedup replacement, `once` filtering; returns the hint texts to show. */
export function applyHints(result: AgentToolResult, ledger: HintLedger): string[] {
  if (result.dedup) {
    if (ledger.seen(HINT_NS_DEDUP, result.dedup.key)) {
      result.output = result.dedup.hint
      result.summary = result.dedup.hint
      result.detail = { dedup: result.dedup.key }
      delete result.partial_output
    } else {
      ledger.mark(HINT_NS_DEDUP, result.dedup.key)
    }
  }
  const kept = []
  for (const h of result.hints ?? []) {
    if (!rustTrim(h.text)) continue
    const key = h.once || undefined
    if (key !== undefined) {
      if (ledger.seen(HINT_NS_ONCE, key)) continue
      ledger.mark(HINT_NS_ONCE, key)
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
