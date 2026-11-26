/* Clipboard and drag-and-drop content (doc/desktop/BuckyOS 剪贴板管理与拖拽支持规范.md §2): the BuckyOS standard
 * formats every App can write and read, and the helpers that put them on a DataTransfer or the async clipboard and
 * read them back in the registered order.
 *
 * A writer puts at least one representation for people (`text/plain`, `text/html`) next to the BuckyOS standard
 * content and its own custom content; a reader tries its own custom content, then BuckyOS standard content (the
 * dedicated MIME type, then the copy embedded in `text/html`), then Web rich formats, then `text/plain`. */

import { contentRefString, isTransferableRef, parseObjRefString, readContentHints, readZoneContent, type TransferableContentRef, type ZoneContent } from './content'
import { decodeHtmlEntities, escapeHtml, tokenizeHtml, type HtmlTag } from './internal/html_tokens'

// ─── Format registry (§2.1) ───

/** Zone content reference list: `{"v":1,"items":[ZoneContent…]}`. */
export const CONTENT_REFS_FORMAT = 'application/vnd.buckyos.content-refs+json'
/** Transfer handle: `{"v":1,"offerId":"…"}`, pointing at a record the desktop keeps (cut, large, deferred or private content). */
export const TRANSFER_HANDLE_FORMAT = 'application/vnd.buckyos.transfer+json'
/** The `text/html` attributes of the typed table. */
export const TYPED_TABLE_ATTR = 'data-buckyos-table'
export const TYPED_VALUE_ATTR = 'data-buckyos-value'
/** The `text/html` attribute that marks a link as an embedded content reference: `{"v":1,"kind":"file"|"folder"}`. */
export const CONTENT_REF_ATTR = 'data-buckyos-ref'
/** The `text/html` attribute that carries the transfer handle where the dedicated MIME type cannot travel. */
export const TRANSFER_HANDLE_ATTR = 'data-buckyos-transfer'
/** The async clipboard name of a non-standard format (Chromium Web custom formats). */
export const webClipboardFormat = (format: string): string => `web ${format}`
/** Formats the async clipboard writes under their own names. */
const ASYNC_STANDARD = ['text/plain', 'text/html', 'image/png']
/** The most items one content reference list carries; a larger selection needs a transfer handle. */
export const MAX_CONTENT_REFS = 10000

/** One item's representations by format name: the strings a DataTransfer or a ClipboardItem carries. */
export type TransferRepresentations = Record<string, string>

const parseJson = (s: string | undefined): unknown => {
  if (!s) return undefined
  try { return JSON.parse(s) } catch { return undefined }
}
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

// ─── BuckyOS addresses (§2.2) ───

/** A `cyfs:///<path>` or `obj://<objId>[/<inner path>]` line as a reference; undefined when it is not one (any other
 * scheme, a query or fragment, `.` / `..` segments, invalid names or escapes). Segments may be percent-encoded. */
export function parseBuckyosAddress(text: string): TransferableContentRef | undefined {
  const value = text.trim()
  if (!value || value.length > 8192 || /[\t\r\n]/.test(value)) return undefined
  if (value.startsWith('cyfs:///')) {
    const raw = value.slice('cyfs://'.length)
    if (/[?#]/.test(raw)) return undefined
    const parts = raw.split('/').slice(1)
    if (parts.length && parts[parts.length - 1] === '') parts.pop()
    const segments: string[] = []
    for (const part of parts) {
      let segment: string
      try { segment = decodeURIComponent(part) } catch { return undefined }
      if (!segment || segment === '.' || segment === '..' || segment.length > 255 || /[/\\\0]/.test(segment)) return undefined
      segments.push(segment)
    }
    const ref: TransferableContentRef = { kind: 'cyfs-path', path: `cyfs:///${segments.join('/')}` }
    return isTransferableRef(ref) ? ref : undefined
  }
  if (value.startsWith('obj://')) {
    const ref = parseObjRefString(value)
    return ref && isTransferableRef(ref) ? ref : undefined
  }
  return undefined
}

/** The address of a reference as a URI (`text/uri-list`, `href`): every path segment percent-encoded. */
export function buckyosAddressUri(ref: TransferableContentRef): string {
  if (ref.kind !== 'cyfs-path') return contentRefString(ref)
  return 'cyfs:///' + ref.path.slice('cyfs:///'.length).split('/').filter(Boolean).map(encodeURIComponent).join('/')
}

/** The references of a text when every non-empty line is a BuckyOS address (`text/uri-list` comment lines skipped);
 * undefined when any line is something else. */
export function readBuckyosAddresses(text: string | undefined, options: { uriList?: boolean } = {}): TransferableContentRef[] | undefined {
  if (!text) return undefined
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !(options.uriList && l.startsWith('#')))
  if (!lines.length || lines.length > MAX_CONTENT_REFS) return undefined
  const refs: TransferableContentRef[] = []
  for (const line of lines) {
    const ref = parseBuckyosAddress(line)
    if (!ref) return undefined
    refs.push(ref)
  }
  return refs
}

// ─── Zone content reference list (§2.2) ───

const nameOf = (item: ZoneContent): string => {
  if (item.hints.name) return item.hints.name
  const tail = item.source.kind === 'cyfs-path' ? item.source.path : item.source.innerPath ?? item.source.objectId
  return tail.split('/').filter(Boolean).pop() ?? contentRefString(item.source)
}

/** The dedicated value of a reference list. */
export function contentRefsValue(items: ZoneContent[]): string {
  return JSON.stringify({ v: 1, items })
}

/** The items of a reference list value in order; undefined for another major version, a damaged value, an empty
 * list or an invalid item. */
export function readContentRefs(value: string | undefined): ZoneContent[] | undefined {
  const v = parseJson(value)
  if (!isRecord(v) || v.v !== 1 || !Array.isArray(v.items) || !v.items.length || v.items.length > MAX_CONTENT_REFS) return undefined
  const items: ZoneContent[] = []
  for (const raw of v.items) {
    const item = readZoneContent(raw)
    if (!item) return undefined
    items.push(item)
  }
  return items
}

/** The `<a>` links of a reference list, in order, each marked with its kind. */
export function contentRefsHtml(items: ZoneContent[]): string {
  return `<meta charset="utf-8">${items.map((item) =>
    `<a href="${escapeHtml(buckyosAddressUri(item.source))}" ${CONTENT_REF_ATTR}="${escapeHtml(JSON.stringify({ v: 1, kind: item.kind }))}">${escapeHtml(nameOf(item))}</a>`,
  ).join('<br>')}`
}

/** The reference list a `text/html` carries as marked links, in order (addresses only: no `objId`; the link text as
 * the name). Undefined when there is no marked link or one of them is not valid. */
export function contentRefsFromHtml(html: string | undefined): ZoneContent[] | undefined {
  if (!html || !html.includes(CONTENT_REF_ATTR)) return undefined
  const items: ZoneContent[] = []
  let open: { source: TransferableContentRef; kind: 'file' | 'folder'; text: string } | null = null
  const finish = () => {
    if (!open) return
    const name = open.text.replace(/\s+/g, ' ').trim()
    items.push({ origin: 'zone', kind: open.kind, source: open.source, hints: readContentHints({ name }) })
    open = null
  }
  for (const token of tokenizeHtml(html)) {
    if (typeof token === 'string') { if (open) open.text += decodeHtmlEntities(token); continue }
    if (token.name !== 'a') continue
    if (token.close) { finish(); continue }
    finish()
    if (!(CONTENT_REF_ATTR in token.attrs)) continue
    const mark = parseJson(token.attrs[CONTENT_REF_ATTR])
    const source = parseBuckyosAddress(token.attrs.href ?? '')
    if (!isRecord(mark) || mark.v !== 1 || (mark.kind !== 'file' && mark.kind !== 'folder') || !source) return undefined
    open = { source, kind: mark.kind, text: '' }
    if (items.length >= MAX_CONTENT_REFS) return undefined
  }
  finish()
  return items.length ? items : undefined
}

/** Everything one write of a Zone selection puts down (§2.2): the list, a name per line, an address per line and the
 * marked links. */
export function contentRefsRepresentations(items: ZoneContent[]): TransferRepresentations {
  return {
    [CONTENT_REFS_FORMAT]: contentRefsValue(items),
    'text/plain': items.map(nameOf).join('\n'),
    'text/uri-list': items.map((item) => buckyosAddressUri(item.source)).join('\r\n'),
    'text/html': contentRefsHtml(items),
  }
}

// ─── Typed table (§2.2) ───

/** The field types of the system table standard (the AI Workspace standard table types, without `object_ref`). */
export const TABLE_FIELD_TYPES = ['text', 'boolean', 'number', 'decimal', 'date', 'datetime', 'select', 'multi_select', 'currency', 'json'] as const
export type TableFieldType = typeof TABLE_FIELD_TYPES[number]
export interface TypedTableField {
  name: string
  type: TableFieldType
  /** decimal, currency: digits after the point (0–18). */
  scale?: number
  /** currency: the default ISO 4217 code. */
  currency?: string
  /** select, multi_select: the option labels. */
  options?: string[]
}
/** A cell: its wire value (option labels, not ids; `{ amount, currency }` for money) and the text people see. An empty
 * cell has neither. */
export interface TypedTableCell { value?: unknown; text?: string }
export interface TypedTable { fields: TypedTableField[]; rows: TypedTableCell[][] }

const isCurrencyCode = (v: unknown): v is string => typeof v === 'string' && /^[A-Z]{3}$/.test(v)

function readField(raw: unknown): TypedTableField | undefined {
  if (!isRecord(raw) || typeof raw.name !== 'string' || !(TABLE_FIELD_TYPES as readonly string[]).includes(raw.type as string)) return undefined
  const field: TypedTableField = { name: raw.name, type: raw.type as TableFieldType }
  if (raw.scale !== undefined) {
    if (!Number.isInteger(raw.scale) || (raw.scale as number) < 0 || (raw.scale as number) > 18 || (field.type !== 'decimal' && field.type !== 'currency')) return undefined
    field.scale = raw.scale as number
  }
  if (raw.currency !== undefined) {
    if (!isCurrencyCode(raw.currency) || field.type !== 'currency') return undefined
    field.currency = raw.currency
  }
  if (raw.options !== undefined) {
    if (!Array.isArray(raw.options) || !raw.options.every((o) => typeof o === 'string') || (field.type !== 'select' && field.type !== 'multi_select')) return undefined
    field.options = raw.options as string[]
  }
  return field
}

/** Whether a wire value has the shape its field type takes (the receiver still normalizes it). */
export function isTypedTableValue(field: TypedTableField, value: unknown): boolean {
  switch (field.type) {
    case 'text': case 'select': return typeof value === 'string'
    case 'boolean': return typeof value === 'boolean'
    case 'number': return typeof value === 'number' && Number.isFinite(value)
    case 'decimal': return typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)
    case 'date': return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    case 'datetime': return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)
    case 'multi_select': return Array.isArray(value) && value.every((v) => typeof v === 'string')
    case 'currency': return isRecord(value) && typeof value.amount === 'string' && isCurrencyCode(value.currency)
    case 'json': return isRecord(value) || Array.isArray(value)
  }
}

/** A cell value as plain text: ISO dates, `TRUE` / `FALSE`, labels joined with `, `, `CNY 500.00`, JSON. */
export function typedTableText(field: TypedTableField, value: unknown): string {
  if (value === undefined || value === null) return ''
  switch (field.type) {
    case 'boolean': return value === true ? 'TRUE' : 'FALSE'
    case 'multi_select': return (Array.isArray(value) ? value : []).map(String).join(', ')
    case 'currency': return isRecord(value) ? `${value.currency} ${value.amount}` : String(value)
    case 'json': return JSON.stringify(value)
    default: return typeof value === 'string' || typeof value === 'number' ? String(value) : JSON.stringify(value)
  }
}

/** A cell as spreadsheets take it, quoted when it holds a tab, quote or line break. */
export function typedTableTsvCell(field: TypedTableField, value: unknown): string {
  const text = typedTableText(field, value)
  return /[\t\n\r"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** One write of a table (§2.2): an HTML table carrying the field definitions and each cell's wire value, and a TSV
 * with a header row. A cell's `text` is what the HTML shows; without it the TSV text is shown. */
export function typedTableRepresentations(table: TypedTable): { 'text/html': string; 'text/plain': string } {
  const { fields, rows } = table
  const lines = [fields.map((f) => typedTableTsvCell({ name: f.name, type: 'text' }, f.name)).join('\t')]
  for (const row of rows) lines.push(fields.map((f, i) => typedTableTsvCell(f, row[i]?.value)).join('\t'))
  const meta = { v: 1, fields: fields.map((f) => ({ name: f.name, type: f.type, ...(f.scale !== undefined ? { scale: f.scale } : {}), ...(f.currency ? { currency: f.currency } : {}), ...(f.options ? { options: f.options } : {}) })) }
  const head = `<tr>${fields.map((f) => `<th>${escapeHtml(f.name)}</th>`).join('')}</tr>`
  const body = rows.map((row) => `<tr>${fields.map((f, i) => {
    const cell = row[i]
    if (!cell || (cell.value === undefined && !cell.text)) return '<td></td>'
    const text = cell.text ?? typedTableText(f, cell.value)
    const value = cell.value === undefined || cell.value === null ? '' : ` ${TYPED_VALUE_ATTR}="${escapeHtml(JSON.stringify(cell.value))}"`
    return `<td${value}>${escapeHtml(text).replace(/\r?\n/g, '<br>')}</td>`
  }).join('')}</tr>`).join('')
  return {
    'text/html': `<meta charset="utf-8"><table ${TYPED_TABLE_ATTR}="${escapeHtml(JSON.stringify(meta))}"><thead>${head}</thead><tbody>${body}</tbody></table>`,
    'text/plain': lines.join('\r\n') + '\r\n',
  }
}

/** The definitions of a `data-buckyos-table` attribute; undefined for another major version or a damaged value. */
export function readTypedTableFields(attr: string | undefined): TypedTableField[] | undefined {
  const meta = parseJson(attr)
  if (!isRecord(meta) || meta.v !== 1 || !Array.isArray(meta.fields) || !meta.fields.length) return undefined
  const fields: TypedTableField[] = []
  for (const raw of meta.fields) {
    const field = readField(raw)
    if (!field) return undefined
    fields.push(field)
  }
  return fields
}

/** The first typed table of a `text/html`; undefined when there is none or its marks are not valid. The header row
 * (`<th>` cells) is skipped; a cell value that does not fit its field keeps only its text. */
export function readTypedTable(html: string | undefined): TypedTable | undefined {
  if (!html || !html.includes(TYPED_TABLE_ATTR)) return undefined
  let fields: TypedTableField[] | undefined
  const rows: TypedTableCell[][] = []
  let depth = 0
  let row: { cells: TypedTableCell[]; header: boolean } | null = null
  let cell: { attrs: Record<string, string>; text: string; th: boolean } | null = null
  const endCell = () => {
    if (!cell || !row || !fields) { cell = null; return }
    const field = fields[row.cells.length]
    const text = cell.text.replace(/[ \t\r\n\f]+/g, ' ').replace(/\u2028/g, '\n').trim()
    const raw = cell.attrs[TYPED_VALUE_ATTR]
    const value = raw === undefined ? undefined : parseJson(raw)
    row.cells.push({ ...(field && value !== undefined && isTypedTableValue(field, value) ? { value } : {}), ...(text ? { text } : {}) })
    if (!cell.th) row.header = false
    cell = null
  }
  const endRow = () => {
    endCell()
    if (row && fields && !(row.header && row.cells.length)) {
      while (row.cells.length < fields.length) row.cells.push({})
      rows.push(row.cells.slice(0, fields.length))
    }
    row = null
  }
  for (const token of tokenizeHtml(html)) {
    if (typeof token === 'string') { if (cell && depth === 1) cell.text += decodeHtmlEntities(token); continue }
    const tag: HtmlTag = token
    if (tag.name === 'table') {
      if (tag.close) {
        if (!depth) continue
        depth -= 1
        if (!depth) { endRow(); break }
      } else if (!tag.self) {
        if (depth) { depth += 1; continue }
        if (!(TYPED_TABLE_ATTR in tag.attrs)) continue
        fields = readTypedTableFields(tag.attrs[TYPED_TABLE_ATTR])
        if (!fields) return undefined
        depth = 1
      }
      continue
    }
    if (depth !== 1) continue
    if (tag.name === 'tr') { endRow(); if (!tag.close) row = { cells: [], header: true } }
    else if (tag.name === 'td' || tag.name === 'th') { endCell(); if (!tag.close) { row ??= { cells: [], header: true }; cell = { attrs: tag.attrs, text: '', th: tag.name === 'th' } } }
    else if (tag.name === 'br' && cell) cell.text += '\u2028'
  }
  return fields ? { fields, rows } : undefined
}

// ─── Transfer handle (§3.4) ───

/** `cut` marks the handle of a cut: when the record is gone (a reload, another tab) the receiver can still tell the user
 * that the cut expired instead of silently copying (§6). */
export interface TransferHandle { v: 1; offerId: string; cut?: true }
const OFFER_ID = /^[A-Za-z0-9_-]{16,128}$/

/** A fresh high-entropy offer id (128 random bits, base64url). */
export function newOfferId(): string {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export const transferHandleValue = (offerId: string, options: { cut?: boolean } = {}): string =>
  JSON.stringify(options.cut ? { v: 1, offerId, cut: true } : { v: 1, offerId })
export function readTransferHandle(value: string | undefined): TransferHandle | undefined {
  const v = parseJson(value)
  if (!isRecord(v) || v.v !== 1 || typeof v.offerId !== 'string' || !OFFER_ID.test(v.offerId)) return undefined
  return v.cut === true ? { v: 1, offerId: v.offerId, cut: true } : { v: 1, offerId: v.offerId }
}
/** The `text/html` of one write with the handle embedded, for paths that only carry Web standard formats (an async
 * clipboard read of a copy-event write, a cross-origin WebKit paste). */
export function embedTransferHandle(html: string, offerId: string, options: { cut?: boolean } = {}): string {
  const body = html.replace(/^<meta charset="utf-8">/i, '')
  return `<meta charset="utf-8"><div ${TRANSFER_HANDLE_ATTR}="${escapeHtml(transferHandleValue(offerId, options))}">${body}</div>`
}
export function transferHandleFromHtml(html: string | undefined): TransferHandle | undefined {
  if (!html || !html.includes(TRANSFER_HANDLE_ATTR)) return undefined
  for (const token of tokenizeHtml(html)) {
    if (typeof token !== 'string' && !token.close && TRANSFER_HANDLE_ATTR in token.attrs) return readTransferHandle(token.attrs[TRANSFER_HANDLE_ATTR])
  }
  return undefined
}

// ─── Carriers: DataTransfer and the async clipboard (§2.1, §3) ───

/** What one paste or drop carried, taken while its event is dispatched. */
export interface TransferSnapshot {
  /** Format names as the platform listed them, lower-case, without the `web ` prefix (`files` for files). */
  types: string[]
  /** String representations by format. */
  data: Record<string, string>
  files: File[]
}

/** The format names a drag or clipboard event lists (all that `dragenter` / `dragover` may look at). */
export function transferTypes(dt: DataTransfer | null | undefined): string[] {
  return dt ? Array.from(dt.types ?? [], (t) => t.toLowerCase()) : []
}

/** Reads every string representation and the files of a DataTransfer. Call it before the event handler returns. */
export function snapshotDataTransfer(dt: DataTransfer | null | undefined): TransferSnapshot {
  if (!dt) return { types: [], data: {}, files: [] }
  const types = transferTypes(dt)
  const data: Record<string, string> = {}
  for (const type of types) {
    if (type === 'files') continue
    try {
      const value = dt.getData(type)
      if (value) data[type] = value
    } catch { /* a protected drag store */ }
  }
  return { types, data, files: Array.from(dt.files ?? []) }
}

/** Puts representations on a DataTransfer (`dragstart`, `copy` / `cut` events). */
export function writeDataTransfer(dt: DataTransfer, representations: TransferRepresentations): void {
  for (const [format, value] of Object.entries(representations)) if (value !== undefined) dt.setData(format, value)
}

const clipboardItemSupports = (type: string): boolean => {
  const item = (globalThis as { ClipboardItem?: { supports?: (t: string) => boolean } }).ClipboardItem
  if (!item) return false
  if (typeof item.supports === 'function') {
    try { return item.supports(type) } catch { return false }
  }
  return ASYNC_STANDARD.includes(type)
}

/**
 * Writes representations to the system clipboard in one `ClipboardItem` (toolbar and menu commands, inside the user's
 * gesture). Formats the browser cannot write are left out; when the custom ones make the write fail, the Web standard
 * ones are written alone. Returns the formats written; throws when nothing could be written.
 */
export async function writeClipboard(representations: TransferRepresentations, options: { images?: Record<string, Blob> } = {}): Promise<string[]> {
  const clipboard = globalThis.navigator?.clipboard
  if (!clipboard) throw new Error('The clipboard is not available')
  const standard: Record<string, Blob> = {}
  const custom: Record<string, Blob> = {}
  for (const [format, value] of Object.entries(representations)) {
    if (ASYNC_STANDARD.includes(format)) standard[format] = new Blob([value], { type: format })
    else if (clipboardItemSupports(webClipboardFormat(format))) custom[webClipboardFormat(format)] = new Blob([value], { type: format })
  }
  for (const [format, blob] of Object.entries(options.images ?? {})) if (clipboardItemSupports(format)) standard[format] = blob
  const Item = (globalThis as { ClipboardItem?: new (items: Record<string, Blob>) => ClipboardItem }).ClipboardItem
  if (Item && typeof clipboard.write === 'function') {
    for (const items of Object.keys(custom).length ? [{ ...standard, ...custom }, standard] : [standard]) {
      if (!Object.keys(items).length) continue
      try {
        await clipboard.write([new Item(items)])
        return Object.keys(items).map((f) => f.replace(/^web /, ''))
      } catch { /* try fewer formats */ }
    }
  }
  if (representations['text/plain'] !== undefined && typeof clipboard.writeText === 'function') {
    await clipboard.writeText(representations['text/plain'])
    return ['text/plain']
  }
  throw new Error('Nothing could be written to the clipboard')
}

const isTextFormat = (type: string) => type.startsWith('text/') || type.endsWith('+json') || type === 'application/json'

/** Reads the system clipboard (an explicit Paste button, inside the user's gesture). Throws when the browser refuses. */
export async function readClipboard(): Promise<TransferSnapshot> {
  const clipboard = globalThis.navigator?.clipboard
  if (!clipboard) throw new Error('The clipboard is not available')
  const out: TransferSnapshot = { types: [], data: {}, files: [] }
  if (typeof clipboard.read !== 'function') {
    const text = await clipboard.readText()
    if (text) { out.types.push('text/plain'); out.data['text/plain'] = text }
    return out
  }
  for (const item of await clipboard.read()) {
    for (const type of item.types) {
      const name = type.replace(/^web /, '').toLowerCase()
      if (!out.types.includes(name)) out.types.push(name)
      const blob = await item.getType(type)
      if (isTextFormat(name)) { if (!(name in out.data)) out.data[name] = await blob.text() }
      else if (name.startsWith('image/') && typeof File !== 'undefined') out.files.push(new File([blob], `clipboard.${name.slice(6).split('+')[0]}`, { type: name }))
    }
  }
  if (out.files.length && !out.types.includes('files')) out.types.push('files')
  return out
}

// ─── Reading in the registered order (§2.3) ───

export interface TransferReader {
  snapshot: TransferSnapshot
  has(format: string): boolean
  /** A string representation by its registered name. */
  get(format: string): string | undefined
  /** The transfer handle: the dedicated MIME type, then the `text/html` embedding. */
  handle(): TransferHandle | undefined
  /** The Zone reference list: the dedicated MIME type, then the marked links of `text/html`. */
  contentRefs(): { items: ZoneContent[]; via: 'mime' | 'html' } | undefined
  /** The typed table of `text/html`. */
  typedTable(): TypedTable | undefined
  /** BuckyOS addresses: `text/uri-list`, then `text/plain`, when every line is one. */
  addresses(): TransferableContentRef[] | undefined
  files: File[]
  html: string | undefined
  text: string | undefined
}

export function transferReader(snapshot: TransferSnapshot): TransferReader {
  const get = (format: string) => snapshot.data[format.toLowerCase()]
  const once = <T>(read: () => T) => { let done = false; let value: T; return () => { if (!done) { value = read(); done = true }; return value! } }
  return {
    snapshot,
    has: (format) => snapshot.types.includes(format.toLowerCase()),
    get,
    handle: once(() => readTransferHandle(get(TRANSFER_HANDLE_FORMAT)) ?? transferHandleFromHtml(get('text/html'))),
    contentRefs: once(() => {
      const mime = readContentRefs(get(CONTENT_REFS_FORMAT))
      if (mime) return { items: mime, via: 'mime' as const }
      const html = contentRefsFromHtml(get('text/html'))
      return html ? { items: html, via: 'html' as const } : undefined
    }),
    typedTable: once(() => readTypedTable(get('text/html'))),
    addresses: once(() => readBuckyosAddresses(get('text/uri-list'), { uriList: true }) ?? readBuckyosAddresses(get('text/plain'))),
    files: snapshot.files,
    html: get('text/html'),
    text: get('text/plain'),
  }
}

/** Whether a drag or paste may carry Zone references (from its types alone, as `dragover` sees them). */
export const mayCarryContentRefs = (types: string[]): boolean =>
  types.includes(CONTENT_REFS_FORMAT) || types.includes('text/html') || types.includes('text/uri-list')
