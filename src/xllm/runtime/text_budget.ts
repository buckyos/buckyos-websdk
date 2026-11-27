// The per-result budget (`agent_tool/src/text_budget.rs`): how much of the
// prompt one tool result, or one value a template brings in, may take. Sizes
// are UTF-8 bytes and tokens are estimated at 4 bytes a token, as in Rust.

export const RESULT_BUDGET_TOKENS = 16 * 1024

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function tokensOf(bytes: number): number {
  return Math.ceil(bytes / 4)
}

/** UTF-8 offset at or before `i` that starts a character. */
function floorBoundary(b: Uint8Array, i: number): number {
  i = Math.min(i, b.length)
  while (i > 0 && i < b.length && (b[i] & 0xc0) === 0x80) i--
  return i
}

/** UTF-8 offset at or after `i` that starts a character. */
function ceilBoundary(b: Uint8Array, i: number): number {
  i = Math.min(i, b.length)
  while (i < b.length && (b[i] & 0xc0) === 0x80) i++
  return i
}

/** `clip_to_budget` with the 4-bytes-a-token estimate: `[text, clipped]`. */
export function clipToBudget(text: string, budget: number, more?: string): [string, boolean] {
  const b = encoder.encode(text)
  const tokens = tokensOf(b.length)
  if (tokens <= budget) return [text, false]
  const markerRoom = 96 + (more === undefined ? 0 : encoder.encode(more).length)
  const keep = Math.max(0, Math.floor((b.length * budget) / Math.max(tokens, 1)) - markerRoom)
  const headEnd = floorBoundary(b, Math.floor(keep / 2))
  const tailStart = Math.max(ceilBoundary(b, b.length - (keep - Math.floor(keep / 2))), headEnd)
  const omitted = tailStart - headEnd
  const marker = more === undefined ? `\n…[${omitted} bytes omitted]…\n` : `\n…[${omitted} bytes omitted; ${more}]…\n`
  return [`${decoder.decode(b.slice(0, headEnd))}${marker}${decoder.decode(b.slice(tailStart))}`, true]
}

export function clipToDefaultBudget(text: string, more?: string): [string, boolean] {
  return clipToBudget(text, RESULT_BUDGET_TOKENS, more)
}
