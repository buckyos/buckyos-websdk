import type { Tokenizer } from './types'

/** UTF-8 byte length without allocating. */
export function utf8Length(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1)
      if (d >= 0xdc00 && d <= 0xdfff) {
        n += 4
        i++
      } else n += 3
    } else n += 3
  }
  return n
}

/** 1 token ≈ 4 bytes, rounded up (`ByteHeuristicTokenizer`). */
export class ByteHeuristicTokenizer implements Tokenizer {
  countTokens(text: string): number {
    return Math.min(Math.floor((utf8Length(text) + 3) / 4), 0xffffffff)
  }
}
