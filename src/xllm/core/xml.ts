// Tolerant XML scanning for behavior replies and `result.<path>` extraction
// (`scan_xml_elements`, `element_text`, `strip_code_fences` in xllm.rs).

import { rustTrim, rustTrimEnd } from './rust_text'

export interface XmlElement {
  name: string
  attrs: [string, string][]
  /** Raw body (no CDATA or entity processing). */
  body: string
  self_closing: boolean
}

export function xmlAttr(e: XmlElement, key: string): string | undefined {
  return e.attrs.find(([k]) => k === key)?.[1]
}

/** Body text: CDATA taken verbatim, everything else unescaped. */
export function xmlText(e: XmlElement): string {
  return elementText(e.body)
}

export function xmlChildren(e: XmlElement): XmlElement[] {
  return scanXmlElements(e.body)
}

export function xmlUnescape(s: string): string {
  if (!s.includes('&')) return s
  return s.split('&lt;').join('<').split('&gt;').join('>').split('&quot;').join('"').split('&apos;').join("'")
    .split('&#39;').join("'").split('&amp;').join('&')
}

export function xmlEscape(s: string): string {
  return s.split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;').split('"').join('&quot;')
}

export function elementText(body: string): string {
  const t = rustTrim(body)
  if (t.startsWith('<![CDATA[') && t.endsWith(']]>') && t.length >= 12) {
    const inner = t.slice(9, -3)
    return inner
  }
  if (t.includes('<![CDATA[')) {
    let out = ''
    let rest = t
    for (;;) {
      const pos = rest.indexOf('<![CDATA[')
      if (pos < 0) break
      out += xmlUnescape(rest.slice(0, pos))
      const after = rest.slice(pos + 9)
      const end = after.indexOf(']]>')
      if (end >= 0) {
        out += after.slice(0, end)
        rest = after.slice(end + 3)
      } else {
        out += after
        rest = ''
      }
    }
    return out + xmlUnescape(rest)
  }
  return xmlUnescape(t)
}

function isNameStart(c: string): boolean {
  return /[A-Za-z_]/.test(c)
}

function isNameChar(c: string): boolean {
  return /[A-Za-z0-9_\-.:]/.test(c)
}

function isWs(c: string | undefined): boolean {
  return c !== undefined && /\s/.test(c)
}

/** Direct child elements of `input` (CDATA, comments, processing instructions skipped; missing close tags tolerated). */
export function scanXmlElements(input: string): XmlElement[] {
  const out: XmlElement[] = []
  let i = 0
  while (i < input.length) {
    const start = input.indexOf('<', i)
    if (start < 0) break
    const rest = input.slice(start)
    if (rest.startsWith('<![CDATA[')) {
      const e = rest.indexOf(']]>')
      i = e < 0 ? input.length : start + e + 3
      continue
    }
    if (rest.startsWith('<!--')) {
      const e = rest.indexOf('-->')
      i = e < 0 ? input.length : start + e + 3
      continue
    }
    if (rest.startsWith('<?') || rest.startsWith('<!') || rest.startsWith('</')) {
      const e = rest.indexOf('>')
      i = e < 0 ? input.length : start + e + 1
      continue
    }
    const c0 = rest[1]
    if (c0 === undefined) break
    if (!isNameStart(c0)) {
      i = start + 1
      continue
    }
    let nameEnd = 2
    while (nameEnd < rest.length && isNameChar(rest[nameEnd])) nameEnd++
    const name = rest.slice(1, nameEnd)
    const attrs: [string, string][] = []
    let j = nameEnd
    let selfClosing = false
    let closed = false
    while (j < rest.length) {
      const c = rest[j]
      if (isWs(c)) {
        j++
        continue
      }
      if (c === '/' && rest[j + 1] === '>') {
        selfClosing = true
        j += 2
        closed = true
        break
      }
      if (c === '>') {
        j++
        closed = true
        break
      }
      const anStart = j
      while (j < rest.length) {
        const ch = rest[j]
        if (isWs(ch) || ch === '=' || ch === '>' || ch === '/') break
        j++
      }
      const an = rest.slice(anStart, j)
      if (!an) {
        j++
        continue
      }
      while (j < rest.length && isWs(rest[j])) j++
      if (rest[j] === '=') {
        j++
        while (j < rest.length && isWs(rest[j])) j++
        const q = rest[j]
        if (q === '"' || q === "'") {
          const vStart = j + 1
          const found = rest.indexOf(q, vStart)
          const vEnd = found < 0 ? rest.length : found
          attrs.push([an, xmlUnescape(rest.slice(vStart, vEnd))])
          j = Math.min(vEnd + 1, rest.length)
        } else {
          const vStart = j
          while (j < rest.length) {
            const ch = rest[j]
            if (isWs(ch) || ch === '>' || ch === '/') break
            j++
          }
          attrs.push([an, xmlUnescape(rest.slice(vStart, j))])
        }
      } else {
        attrs.push([an, ''])
      }
    }
    if (!closed) break
    const bodyStart = start + j
    if (selfClosing) {
      out.push({ name, attrs, body: '', self_closing: true })
      i = bodyStart
      continue
    }
    let depth = 1
    let k = bodyStart
    let bodyEnd = input.length
    let afterClose = input.length
    const closePrefix = `</${name}`
    const openPrefix = `<${name}`
    while (k < input.length) {
      const p = input.indexOf('<', k)
      if (p < 0) break
      const r = input.slice(p)
      if (r.startsWith('<![CDATA[')) {
        const e = r.indexOf(']]>')
        k = e < 0 ? input.length : p + e + 3
        continue
      }
      if (r.startsWith('<!--')) {
        const e = r.indexOf('-->')
        k = e < 0 ? input.length : p + e + 3
        continue
      }
      if (r.startsWith(closePrefix) && (r[closePrefix.length] === '>' || isWs(r[closePrefix.length]))) {
        depth -= 1
        const g = r.indexOf('>')
        const gt = g < 0 ? input.length : p + g + 1
        if (depth === 0) {
          bodyEnd = p
          afterClose = gt
          break
        }
        k = gt
        continue
      }
      if (r.startsWith(openPrefix) && (r[openPrefix.length] === '>' || r[openPrefix.length] === '/' || isWs(r[openPrefix.length]))) {
        const g = r.indexOf('>')
        const gt = g < 0 ? input.length : p + g + 1
        const isSelf = input.slice(p, gt).replace(/>+$/, '').endsWith('/')
        if (!isSelf) depth += 1
        k = gt
        continue
      }
      k = p + 1
    }
    out.push({ name, attrs, body: input.slice(bodyStart, bodyEnd), self_closing: false })
    i = afterClose
  }
  return out
}

/** Strip a ```xml / ```json / ``` fence. */
export function stripCodeFences(text: string): string {
  const t = rustTrim(text)
  if (t.startsWith('```')) {
    let rest = t.slice(3)
    const nl = rest.indexOf('\n')
    if (nl >= 0) rest = rest.slice(nl + 1)
    rest = rustTrimEnd(rest)
    if (rest.endsWith('```')) rest = rest.slice(0, -3)
    return rustTrim(rest)
  }
  return t
}
