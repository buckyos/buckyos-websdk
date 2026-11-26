/* A small tolerant HTML tokenizer for clipboard and drag data. Clipboard HTML is not XML (unquoted attributes,
 * unclosed cells, `<br>`, Office conditional comments) and the readers here must also run where there is no
 * DOMParser (Node, Deno, workers). Same rules as the AI Workspace table importer (`import-table/html.ts`). */

export interface HtmlTag { name: string; attrs: Record<string, string>; close: boolean; self: boolean }
export type HtmlToken = HtmlTag | string

const NAMED: Record<string, string> = {
  nbsp: '\u00a0', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", yen: '¥', euro: '€', pound: '£', cent: '¢', copy: '©', reg: '®',
  trade: '™', hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»', times: '×', divide: '÷', deg: '°', middot: '·', bull: '•',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
}

export function decodeHtmlEntities(text: string): string {
  if (!text.includes('&')) return text
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);?/g, (all, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all
    }
    return NAMED[ref.toLowerCase()] ?? all
  })
}

export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Tags (lower-case names and attribute names, decoded attribute values) and raw text; comments, doctype and the
 * bodies of script, style, textarea and title are dropped. */
export function tokenizeHtml(html: string): HtmlToken[] {
  const out: HtmlToken[] = []
  let i = 0
  const n = html.length
  while (i < n) {
    const lt = html.indexOf('<', i)
    if (lt < 0) { out.push(html.slice(i)); break }
    if (lt > i) out.push(html.slice(i, lt))
    if (html.startsWith('<!--', lt)) { const end = html.indexOf('-->', lt + 4); i = end < 0 ? n : end + 3; continue }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') { const end = html.indexOf('>', lt); i = end < 0 ? n : end + 1; continue }
    const close = html[lt + 1] === '/'
    let j = lt + (close ? 2 : 1)
    const nameStart = j
    while (j < n && /[A-Za-z0-9:_-]/.test(html[j])) j++
    const name = html.slice(nameStart, j).toLowerCase()
    if (!name) { out.push('<'); i = lt + 1; continue }
    const attrs: Record<string, string> = {}
    let self = false
    while (j < n && html[j] !== '>') {
      if (/\s/.test(html[j])) { j++; continue }
      if (html[j] === '/') { self = true; j++; continue }
      let k = j
      while (k < n && !/[\s=>/]/.test(html[k])) k++
      const attr = html.slice(j, k).toLowerCase()
      j = k
      while (j < n && /\s/.test(html[j])) j++
      if (html[j] !== '=') { if (attr) attrs[attr] = ''; continue }
      j++
      while (j < n && /\s/.test(html[j])) j++
      let value: string
      if (html[j] === '"' || html[j] === "'") {
        const q = html[j]
        const end = html.indexOf(q, j + 1)
        value = html.slice(j + 1, end < 0 ? n : end)
        j = end < 0 ? n : end + 1
      } else {
        let k2 = j
        while (k2 < n && !/[\s>]/.test(html[k2])) k2++
        value = html.slice(j, k2)
        j = k2
      }
      if (attr && !(attr in attrs)) attrs[attr] = decodeHtmlEntities(value)
    }
    i = j + 1
    out.push({ name, attrs, close, self })
    if (!close && (name === 'script' || name === 'style' || name === 'textarea' || name === 'title')) {
      const end = html.toLowerCase().indexOf(`</${name}`, i)
      i = end < 0 ? n : html.indexOf('>', end) + 1 || n
      out.push({ name, attrs: {}, close: true, self: false })
    }
  }
  return out
}
