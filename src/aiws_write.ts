/* Write helpers of AI Workspace (buckyos notepads/aiws-core-api-design.md §9, core API TODO §4 R13): pure functions
 * that build the Commit operations of the frequent writes — table records, cells, fields and options; rich text blocks
 * from Markdown; rename, move and Block properties — doing the three things a hand-written operation most often gets
 * wrong: field names → field ids and option labels → option ids, `expect` from what was read, Markdown → rich text
 * blocks. `commitOps` sends them as one Commit: an idempotency key, parts when large, and on an unknown result
 * `doc.get_submission` then a resend with the same key. The operations are those of buckyos
 * src/frame/aiworkspace/schemas/operations.json (planner: core/src/plan_table.rs, plan_richtext.rs, plan.rs). */

import { AiwsFailure, commitOverLimit, commitWithParts, type AiwsCall } from './aiworkspace_client'
import {
  AIWS_PROTOCOL_VERSION, deleteRecordsOp, insertRecordOp, newRecordId, orderKeyBetween, setValuesOps,
  type CommitResult, type Json, type Op, type RowLike,
} from './aiws_schedule'

// ---- what the helpers read

/** A field of a table as `doc.read` answers it (`content.fields[]`). */
export interface AiwsFieldRead {
  field_id: string
  name: string
  type: string
  options?: { option_id: string; label: string }[]
  currency?: string
  order_key?: string
  def_rev?: number
}

/** A table as `doc.read` answers it (`entity_id`, `content.fields`), or `{ entity_id, fields }`. */
export interface AiwsTableRead {
  entity_id: string
  content?: { fields?: AiwsFieldRead[] } | null
  fields?: AiwsFieldRead[]
}

/** A record as `doc.read` with a `table_record` selector answers it (the record is its `content`), the record
 * itself, or the SQL `_record` column (JSON text). */
export type AiwsRecordRead = RowLike | { content: RowLike } | string

/** An entity as `doc.read` answers it (the envelope: `meta_rev`, `struct_rev`, `content.key_revs`), or as
 * `doc.read { as: "meta" }` does (`version`). */
export interface AiwsEntityRead {
  entity_id: string
  meta_rev?: number
  struct_rev?: number | null
  version?: { meta_rev?: number; struct_rev?: number | null }
  content?: { key_revs?: Record<string, number> } | null
}

export interface AiwsBlockState { block_id: string; hash: string; struct_rev: number }

/** A rich text as `doc.read` answers it: `content.blocks` holds each block's `hash` and `struct_rev`. */
export interface AiwsRichTextRead {
  entity_id: string
  content?: { blocks?: Record<string, { hash: string; struct_rev: number }> } | null
}

/** A block as `doc.read` with a `richtext_block` selector answers it (in `content`), or its state itself. */
export type AiwsBlockRead = AiwsBlockState | { content: AiwsBlockState }

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function failure(detail: string, code = 'INVALID_SCHEMA'): AiwsFailure {
  return new AiwsFailure({ code, retryable: false, detail })
}

const idOf = (x: { entity_id: string } | string): string => (typeof x === 'string' ? x : x.entity_id)

function fieldsOf(table: AiwsTableRead): AiwsFieldRead[] {
  const fields = table.content?.fields ?? table.fields
  if (!Array.isArray(fields)) throw failure(`table ${table.entity_id}: pass it as doc.read answers it (content.fields)`, 'INVALID_OPERATION')
  return fields
}

/** The field a key names: its name first, else its field id. */
export function fieldNamed(table: AiwsTableRead, key: string): AiwsFieldRead {
  const fields = fieldsOf(table)
  const f = fields.find((x) => x.name === key) ?? fields.find((x) => x.field_id === key)
  if (!f) throw failure(`table ${table.entity_id} has no field "${key}" (fields: ${fields.map((x) => x.name).join(', ')})`)
  return f
}

function optionOf(field: AiwsFieldRead, value: string): string {
  const options = field.options ?? []
  const o = options.find((x) => x.label === value) ?? options.find((x) => x.option_id === value)
  if (!o) throw failure(`field "${field.name}" has no option "${value}" (options: ${options.map((x) => x.label).join(', ')})`)
  return o.option_id
}

/** A cell value from its display form (what the body and the SQL display columns show) or its stored form: a select
 * takes its label (or option id), a multi-select an array of them (or `a; b`, or the JSON array text), a number a
 * numeric string, a boolean `true` / `false` / 1 / 0, a decimal a number, a currency `{ amount, currency }`, an amount,
 * or `USD 12.50`, an object reference `{ entity_id }` or an entity id (a path must be resolved first), a json field an
 * object or its JSON text. A `{ "$formula" }` object passes as it is; `null` stays `null` (unset). */
export function cellValue(field: AiwsFieldRead, value: unknown): Json {
  if (value === null || value === undefined) return null
  if (isRecord(value) && '$formula' in value) return value as Json
  const bad = (what: string) => failure(`field "${field.name}" (${field.type}) takes ${what}, not ${JSON.stringify(value)}`)
  switch (field.type) {
    case 'text':
      if (typeof value === 'string') return value
      if (typeof value === 'number' || typeof value === 'boolean') return String(value)
      throw bad('a text')
    case 'number': {
      const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
      if (Number.isFinite(n)) return n
      throw bad('a number')
    }
    case 'decimal':
      if (typeof value === 'string' && value.trim()) return value.trim()
      if (typeof value === 'number' && Number.isFinite(value)) return String(value)
      throw bad('a decimal string')
    case 'boolean':
      if (typeof value === 'boolean') return value
      if (value === 1 || value === 0) return value === 1
      if (typeof value === 'string' && /^(true|false|1|0)$/i.test(value.trim())) return /^(true|1)$/i.test(value.trim())
      throw bad('true or false')
    case 'date':
    case 'datetime':
      if (typeof value === 'string') return value.trim()
      throw bad(field.type === 'date' ? 'YYYY-MM-DD' : 'an RFC 3339 datetime')
    case 'select':
      if (typeof value === 'string') return optionOf(field, value)
      throw bad('an option label')
    case 'multi_select': {
      let items: unknown = value
      if (typeof value === 'string') items = value.trim().startsWith('[') ? JSON.parse(value) : value.split(';').map((s) => s.trim()).filter(Boolean)
      if (!Array.isArray(items)) throw bad('option labels')
      return [...new Set(items.map((x) => {
        if (typeof x !== 'string') throw bad('option labels')
        return optionOf(field, x)
      }))]
    }
    case 'object_ref': {
      if (isRecord(value)) return value as Json
      const id = typeof value === 'string' && value.startsWith('~') ? value.slice(1) : value
      if (typeof id === 'string' && id && !id.includes('/')) return { entity_id: id }
      throw bad('a reference { entity_id } or an entity id (resolve a path with doc.resolve first)')
    }
    case 'currency': {
      if (isRecord(value)) return value as Json
      if (typeof value === 'number') return value
      if (typeof value !== 'string' || !value.trim()) throw bad('{ amount, currency }, an amount or "USD 12.50"')
      const before = /^\s*([A-Z]{3})\s+(\S+)\s*$/.exec(value)
      if (before) return { amount: before[2], currency: before[1] }
      const after = /^\s*(\S+)\s+([A-Z]{3})\s*$/.exec(value)
      if (after) return { amount: after[1], currency: after[2] }
      return value.trim()
    }
    case 'json': {
      let v: unknown = value
      if (typeof value === 'string') { try { v = JSON.parse(value) } catch { throw bad('a JSON object') } }
      if (isRecord(v)) return v as Json
      throw bad('a JSON object')
    }
    default:
      return value as Json
  }
}

function recordOf(read: AiwsRecordRead): RowLike {
  const r = typeof read === 'string' ? JSON.parse(read) as unknown : read
  const row = isRecord(r) && isRecord(r.content) && typeof r.content.record_id === 'string' ? r.content : r
  if (!isRecord(row) || typeof row.record_id !== 'string') throw failure('a record as doc.read (table_record) or the SQL _record column answers it', 'INVALID_OPERATION')
  return row as unknown as RowLike
}

function valuesById(table: AiwsTableRead, values: Record<string, unknown>): Record<string, Json> {
  const out: Record<string, Json> = {}
  for (const [key, v] of Object.entries(values)) {
    const f = fieldNamed(table, key)
    out[f.field_id] = cellValue(f, v)
  }
  return out
}

// ---- tables

/** `table.insert_records` of rows keyed by field name (or field id), values in display form (`cellValue`). A row's
 * `_id` (when no field is named so) is its record id; one is generated otherwise. */
export function tableInsert(table: AiwsTableRead, rows: Record<string, unknown>[], opts: { newRecordId?: () => string } = {}): Op[] {
  if (rows.length === 0) return []
  const fields = fieldsOf(table)
  const idKey = fields.some((f) => f.name === '_id') ? null : '_id'
  const records = rows.map((row) => {
    const values = { ...row }
    let record_id: string | undefined
    if (idKey && values._id !== undefined) {
      record_id = String(values._id)
      delete values._id
    }
    return { record_id: record_id || (opts.newRecordId ?? (() => newRecordId()))(), values: valuesById(table, values) }
  })
  return [insertRecordOp(table.entity_id, records)]
}

/** `table.set_values` / `table.unset_values` (null unsets) of one record, keyed by field name, each cell expected at
 * the rev of `read` — the record as read (`doc.read` with `{ kind: "table_record", record_id }`, or SQL `_record`). */
export function tableSet(table: AiwsTableRead, recordId: string, values: Record<string, unknown>, read: AiwsRecordRead): Op[] {
  const row = recordOf(read)
  if (row.record_id !== recordId) throw failure(`the read is of record ${row.record_id}, not ${recordId}`, 'INVALID_OPERATION')
  return setValuesOps(table.entity_id, row, valuesById(table, values))
}

/** `table.delete_records`, each record expected at the rev it was read with (`reads`: the records as read). */
export function tableDelete(table: AiwsTableRead | string, recordIds: string[], reads: AiwsRecordRead[]): Op[] {
  if (recordIds.length === 0) return []
  const byId = new Map(reads.map(recordOf).map((r) => [r.record_id, r]))
  return [deleteRecordsOp(idOf(table), recordIds.map((id) => {
    const row = byId.get(id)
    if (!row) throw failure(`record ${id} was not read`, 'NOT_FOUND')
    return row
  }))]
}

/** A field to add: `options` are labels (or `{ label, option_id? }`) of a select / multi-select. */
export interface AiwsFieldInput {
  name: string
  type: string
  field_id?: string
  options?: (string | { label: string; option_id?: string })[]
  required?: boolean
  nullable?: boolean
  unique?: boolean
  description?: string
  scale?: number
  currency?: string
  max_items?: number
  target_types?: string[]
}

/** A new id: the ASCII words of `label` and a random tail, or `prefix` and the tail. */
function newId(label: string, prefix: string): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24)
  const tail = Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, '0')
  return /^[a-z0-9]/.test(slug) ? `${slug}_${tail}` : `${prefix}${tail}`
}

/** `table.add_field`: a generated field id (and option ids), placed after the last field; a required field of a table
 * with records needs `backfill` (display form). */
export function fieldAdd(table: AiwsTableRead, def: AiwsFieldInput, opts: { backfill?: unknown } = {}): Op {
  const fields = fieldsOf(table)
  const { options, field_id, ...rest } = def
  const field: Record<string, Json> = { field_id: field_id ?? newId(def.name, 'f'), ...(rest as Record<string, Json>) }
  if (options) {
    const used = new Set<string>()
    field.options = options.map((o) => {
      const label = typeof o === 'string' ? o : o.label
      let option_id = typeof o === 'string' ? undefined : o.option_id
      while (!option_id || used.has(option_id)) option_id = newId(label, 'o')
      used.add(option_id)
      return { option_id, label }
    })
  }
  const last = fields.map((f) => f.order_key).filter((k): k is string => typeof k === 'string' && k.length > 0).sort().pop()
  const op: Op = { op: 'table.add_field', source_id: table.entity_id, field, ...(last ? { order_key: orderKeyBetween(last, null) } : {}) }
  if (opts.backfill !== undefined) op.backfill = cellValue(field as unknown as AiwsFieldRead, opts.backfill)
  return op
}

/** `table.add_option`: a new option `label` of a select / multi-select field (by name), expected at the field's
 * `def_rev` as read. */
export function optionAdd(table: AiwsTableRead, field: string, label: string, opts: { option_id?: string; index?: number } = {}): Op {
  const f = fieldNamed(table, field)
  if (f.type !== 'select' && f.type !== 'multi_select') throw failure(`field "${f.name}" is ${f.type}, not a select`, 'INVALID_OPERATION')
  if (f.options?.some((o) => o.label === label)) throw failure(`field "${f.name}" already has the option "${label}"`, 'INVALID_OPERATION')
  if (typeof f.def_rev !== 'number') throw failure(`field "${f.name}": pass the table as doc.read answers it (fields carry def_rev)`, 'INVALID_OPERATION')
  const used = new Set((f.options ?? []).map((o) => o.option_id))
  let option_id = opts.option_id
  while (!option_id || used.has(option_id)) option_id = newId(label, 'o')
  return { op: 'table.add_option', source_id: table.entity_id, field_id: f.field_id, option: { option_id, label }, ...(opts.index !== undefined ? { index: opts.index } : {}), expect: { rev: f.def_rev } }
}

// ---- rich text

function blockState(doc: AiwsRichTextRead | string, blockId: string, reads?: AiwsBlockRead | AiwsBlockRead[]): AiwsBlockState {
  for (const r of reads === undefined ? [] : Array.isArray(reads) ? reads : [reads]) {
    const b = 'content' in r ? r.content : r
    if (b.block_id === blockId) return b
  }
  const known = typeof doc === 'string' ? undefined : doc.content?.blocks?.[blockId]
  if (!known) throw failure(`block ${blockId} is not in the rich text as read`, 'NOT_FOUND')
  return { block_id: blockId, ...known }
}

/** `richtext.insert_blocks` of `markdown` (`markdownToBlocks`) at the end of the document. */
export function textAppend(doc: AiwsRichTextRead | string, markdown: string, opts: { prefix?: string } = {}): Op[] {
  return [{ op: 'richtext.insert_blocks', entity_id: idOf(doc), position: { end: true }, blocks: markdownToBlocks(markdown, opts.prefix) as unknown as Json }]
}

/** `richtext.replace_block` of one block by the first block of `markdown` (it keeps the block id), expected at the
 * hash it was read with (`read`, else the document's `content.blocks`); further blocks of `markdown` are inserted
 * after it. */
export function textReplaceBlock(doc: AiwsRichTextRead, blockId: string, markdown: string, read?: AiwsBlockRead, opts: { prefix?: string } = {}): Op[] {
  const { hash } = blockState(doc, blockId, read)
  const [first, ...rest] = markdownToBlocks(markdown, opts.prefix)
  const node = { ...first, attrs: { ...(first.attrs ?? {}), block_id: blockId } }
  const ops: Op[] = [{ op: 'richtext.replace_block', entity_id: doc.entity_id, block_id: blockId, expect: { hash }, node: node as unknown as Json }]
  if (rest.length > 0) ops.push({ op: 'richtext.insert_blocks', entity_id: doc.entity_id, position: { after: blockId }, blocks: rest as unknown as Json })
  return ops
}

/** `richtext.delete_blocks`, each block expected at the hash and position it was read with. */
export function textDeleteBlocks(doc: AiwsRichTextRead, blockIds: string[], reads?: AiwsBlockRead[]): Op[] {
  if (blockIds.length === 0) return []
  return [{
    op: 'richtext.delete_blocks', entity_id: doc.entity_id,
    blocks: blockIds.map((b) => { const s = blockState(doc, b, reads); return { block_id: b, expect: { hash: s.hash, struct_rev: s.struct_rev } } }),
  }]
}

// ---- common properties

/** `entity.rename` (null gives the name back to the title rule), expected at the `meta_rev` the entity was read with. */
export function rename(entity: AiwsEntityRead, name: string | null): Op {
  const rev = entity.meta_rev ?? entity.version?.meta_rev
  if (typeof rev !== 'number') throw failure(`entity ${entity.entity_id}: pass it as doc.read answers it (meta_rev)`, 'INVALID_OPERATION')
  return { op: 'entity.rename', entity_id: entity.entity_id, name, expect: { rev } }
}

/** `tree.move` under `parentId`, between the order keys `after` and `before` of its new siblings (`after`: the last
 * child's key appends; neither: the parent has no children); expected at the `struct_rev` it was read with, if read. */
export function move(entity: AiwsEntityRead | string, parentId: string, after?: string | null, before?: string | null): Op {
  const rev = typeof entity === 'string' ? undefined : entity.struct_rev ?? entity.version?.struct_rev
  return { op: 'tree.move', entity_id: idOf(entity), new_parent_id: parentId, order_key: orderKeyBetween(after ?? null, before ?? null), ...(typeof rev === 'number' ? { expect: { rev } } : {}) }
}

/** `entity.set_props` of a Block or a container: properties of `config`, `bindings` or `on` (null removes one), each
 * expected at the rev of its cell in `read` (or in `entity`, when it is a read): `content.key_revs["p:<key>.<name>"]`.
 * Without a read the properties merge (no `expect`). */
export function setProps(entity: AiwsEntityRead | string, key: 'config' | 'bindings' | 'on', props: Record<string, unknown>, read?: AiwsEntityRead): Op {
  const revs = (read ?? (typeof entity === 'string' ? undefined : entity))?.content?.key_revs
  return {
    op: 'entity.set_props', entity_id: idOf(entity), key, props: props as Json,
    ...(revs ? { expect: Object.fromEntries(Object.keys(props).map((n) => [n, revs[`p:${key}.${n}`] ?? 0])) } : {}),
  }
}

// ---- commit

/** One kRPC call whose business failure (`ok: false`) throws an `AiwsFailure`: an `AiWorkspaceClient`, or a CLI's call. */
export interface AiwsWriteTransport {
  call<T = Record<string, unknown>>(method: string, params: Record<string, unknown>): Promise<T>
}

export interface AiwsCommitOpsOptions {
  message?: string
  /** The Workspace epoch (default: `ws.get_info`). */
  epoch?: string
  idempotencyKey?: string
  /** Sends of the same request while its result stays unknown (default 3). */
  attempts?: number
  retryDelayMs?: number
  partBytes?: number
  /** Whether a failed send left the result unknown (default: any error but an `AiwsFailure`, the service's answer). */
  isUnknown?: (error: unknown) => boolean
}

export interface AiwsCommitAccepted { status: 'accepted'; commit_id: string; seq: number; [key: string]: unknown }

function settle(result: CommitResult & { retryable?: boolean }): AiwsCommitAccepted {
  if (result?.status === 'accepted') return result as unknown as AiwsCommitAccepted
  if (result?.status === 'conflict') {
    throw new AiwsFailure({ code: result.code ?? 'REVISION_CONFLICT', retryable: true, detail: 'changed meanwhile: read it again', data: { conflicts: result.conflicts ?? [] } })
  }
  const first = result?.errors?.[0] ?? result?.error
  throw new AiwsFailure({
    code: result?.code ?? first?.code ?? 'REJECTED', sub_code: result?.sub_code ?? first?.sub_code, retryable: result?.retryable === true,
    detail: first?.detail ?? result?.detail ?? `commit ${result?.status ?? 'failed'}`, data: { errors: result?.errors ?? [] },
  })
}

/** Commit `ops` as one Commit: the accepted result, or an `AiwsFailure` — a conflict carries the conflicting cells
 * (`data.conflicts`, as the service answers them), a refusal its errors. A send whose result is unknown (a transport
 * failure or timeout) is looked up with `doc.get_submission` and, if not accepted, sent again with the same
 * idempotency key; a Commit too large for one request goes in parts (`commitWithParts`). */
export async function commitOps(client: AiwsWriteTransport, workspace_id: string, ops: Op[], opts: AiwsCommitOpsOptions = {}): Promise<AiwsCommitAccepted> {
  if (ops.length === 0) throw failure('nothing to commit', 'INVALID_OPERATION')
  const over = commitOverLimit(ops)
  if (over) throw failure(`a Commit holds at most ${over.max} ${over.limit} (this one: ${over.value})`, 'LIMIT_EXCEEDED')
  const epoch = opts.epoch ?? (await client.call<{ epoch: string }>('ws.get_info', { workspace_id })).epoch
  const idempotency_key = opts.idempotencyKey ?? `aiws-${newRecordId('k')}`
  const request = { protocol_version: AIWS_PROTOCOL_VERSION, workspace_id, epoch, idempotency_key, ...(opts.message ? { message: opts.message } : {}), operations: ops }
  const call: AiwsCall = (method, params) => client.call(method, params)
  const unknown = opts.isUnknown ?? ((error: unknown) => !(error instanceof AiwsFailure))
  const attempts = Math.max(1, opts.attempts ?? 3)
  for (let attempt = 1; ; attempt++) {
    try {
      return settle(await commitWithParts(call, request, opts.partBytes ? { partBytes: opts.partBytes } : {}))
    } catch (error) {
      if (!unknown(error) || attempt >= attempts) throw error
    }
    await new Promise((resolve) => setTimeout(resolve, (opts.retryDelayMs ?? 500) * attempt))
    const found = await client.call<{ status?: string; result?: CommitResult }>('doc.get_submission', { workspace_id, epoch, idempotency_key }).catch(() => null)
    if (found?.status === 'accepted') return settle(found.result ?? { status: 'accepted' })
  }
}

// ---- Markdown → rich text blocks

export interface RichTextMark { type: string; attrs?: Record<string, Json> }
export interface RichTextNode {
  type: string
  attrs?: Record<string, Json>
  content?: RichTextNode[]
  text?: string
  marks?: RichTextMark[]
}

const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})[ \t]*([^\s`]*)[^`]*$/
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const QUOTE = /^ {0,3}> ?(.*)$/
const BULLET = /^( {0,3})([-*+])([ \t]+|$)(.*)$/
const ORDERED = /^( {0,3})(\d{1,9})([.)])([ \t]+|$)(.*)$/
const TABLE_DELIM = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/
const ESCAPABLE = /[!-/:-@[-`{-~]/
const ALLOWED_HREF = /^(https?:|mailto:|#)/
const ENTITY_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/

interface ListMarker { ordered: boolean; start: number; indent: number; text: string }

function listMarker(line: string): ListMarker | null {
  if (HR.test(line)) return null
  const b = BULLET.exec(line)
  if (b) return { ordered: false, start: 1, indent: b[1].length + 1 + (b[4] ? Math.min(Math.max(b[3].length, 1), 4) : 1), text: b[4] }
  const o = ORDERED.exec(line)
  if (o) return { ordered: true, start: Number(o[2]), indent: o[1].length + o[2].length + 1 + (o[5] ? Math.min(Math.max(o[4].length, 1), 4) : 1), text: o[5] }
  return null
}

/** Whether `line` starts a block that ends a paragraph (a list only when it starts with content, an ordered one at 1). */
function interrupts(line: string): boolean {
  if (FENCE_OPEN.test(line) || ATX.test(line) || HR.test(line) || QUOTE.test(line)) return true
  const m = listMarker(line)
  return !!m && m.text.trim() !== '' && (!m.ordered || m.start === 1)
}

const indentOf = (line: string) => /^ */.exec(line)![0].length

function tableCells(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++ } else if (s[i] === '|') { cells.push(cur.trim()); cur = '' } else cur += s[i]
  }
  cells.push(cur.trim())
  return cells
}

function textNode(text: string, marks: RichTextMark[]): RichTextNode {
  return marks.length ? { type: 'text', text, marks } : { type: 'text', text }
}

/** The index of the next run of exactly `run` backticks at or after `from`, -1 when none. */
function closingRun(src: string, from: number, run: string): number {
  for (let j = src.indexOf(run, from); j >= 0; j = src.indexOf(run, j + 1)) {
    if (src[j - 1] !== '`' && src[j + run.length] !== '`') return j
    while (src[j + 1] === '`') j++
  }
  return -1
}

/** `[label](dest "title")` at `i` (`src[i] === "["`): the label, the destination and where it ends. */
function linkAt(src: string, i: number): { label: string; href: string; end: number } | null {
  let depth = 0
  let j = i
  for (; j < src.length; j++) {
    if (src[j] === '\\') { j++; continue }
    if (src[j] === '[') depth++
    else if (src[j] === ']' && --depth === 0) break
  }
  if (j >= src.length || src[j + 1] !== '(') return null
  const m = /^\(\s*(?:<([^<>\n]*)>|((?:[^\s()]|\([^\s()]*\))*))(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/.exec(src.slice(j + 1))
  if (!m) return null
  return { label: src.slice(i + 1, j), href: m[1] ?? m[2] ?? '', end: j + 1 + m[0].length }
}

/** Inline Markdown into text nodes (and hard breaks, object links): code spans, `**` / `__` strong, `*` / `_`
 * emphasis, `~~` strike, links (http, https, mailto, `#`; `entity:<id>` an object link; other destinations keep their
 * text only), autolinks, backslash escapes; a `\n` is a hard break. */
function inline(src: string, marks: RichTextMark[], out: RichTextNode[]): void {
  let buf = ''
  const flush = () => { if (buf) { out.push(textNode(buf, marks)); buf = '' } }
  const alnum = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c)
  for (let i = 0; i < src.length;) {
    const c = src[i]
    if (c === '\\' && i + 1 < src.length && ESCAPABLE.test(src[i + 1])) { buf += src[i + 1]; i += 2; continue }
    if (c === '\n') { flush(); out.push({ type: 'hard_break' }); i++; continue }
    if (c === '`') {
      const run = /^`+/.exec(src.slice(i))![0]
      const close = closingRun(src, i + run.length, run)
      if (close < 0) { buf += run; i += run.length; continue }
      let code = src.slice(i + run.length, close).replace(/\n/g, ' ')
      if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim()) code = code.slice(1, -1)
      flush()
      if (code) out.push(textNode(code, [{ type: 'code' }]))
      i = close + run.length
      continue
    }
    if (c === '[' || (c === '!' && src[i + 1] === '[')) {
      const link = linkAt(src, c === '!' ? i + 1 : i)
      if (link) {
        flush()
        const entity = /^entity:(.+)$/.exec(link.href)
        if (entity && ENTITY_ID.test(entity[1])) {
          const label: RichTextNode[] = []
          inline(link.label, [], label)
          out.push({ type: 'object_link', attrs: { ref: { entity_id: entity[1] }, label: label.map((n) => n.text ?? '').join('') } })
        } else {
          const href = ALLOWED_HREF.test(link.href) && !/[\u0000-\u001f\u007f]/.test(link.href) ? link.href : null
          inline(link.label, href ? [...marks.filter((m) => m.type !== 'link'), { type: 'link', attrs: { href } }] : marks, out)
        }
        i = link.end
        continue
      }
    }
    if (c === '<') {
      const auto = /^<((?:https?|mailto):[^\s<>]+)>/.exec(src.slice(i))
      if (auto) { flush(); out.push(textNode(auto[1], [...marks.filter((m) => m.type !== 'link'), { type: 'link', attrs: { href: auto[1] } }])); i += auto[0].length; continue }
    }
    if (c === '*' || c === '_' || c === '~') {
      const double = src[i + 1] === c
      const delim = double ? c + c : c
      const opens = (c !== '~' || double) && src[i + delim.length] !== undefined && !/\s/.test(src[i + delim.length]) && !(c === '_' && alnum(src[i - 1]))
      if (opens) {
        let close = -1
        for (let j = i + delim.length + 1; j < src.length; j++) {
          if (src[j] === '\\') { j++; continue }
          if (src[j] !== c) continue
          let run = 1
          while (src[j + run] === c) run++
          // a run closes after a non-space (`_` not inside a word); `***` closes a strong on its last two, an
          // emphasis on its last one; a run of two inside an emphasis is a nested strong
          if (!/\s/.test(src[j - 1]) && !(c === '_' && alnum(src[j + run]))) {
            if (double && run >= 2) { close = j + run - 2; break }
            if (!double && run !== 2) { close = j + run - 1; break }
          }
          j += run - 1
        }
        if (close > 0) {
          flush()
          const type = c === '~' ? 'strike' : double ? 'strong' : 'em'
          inline(src.slice(i + delim.length, close), marks.some((m) => m.type === type) ? marks : [...marks, { type }], out)
          i = close + delim.length
          continue
        }
      }
      buf += delim
      i += delim.length
      continue
    }
    buf += c
    i++
  }
  flush()
}

function inlineNodes(text: string): RichTextNode[] {
  const out: RichTextNode[] = []
  inline(text, [], out)
  // adjacent text with the same marks is one node
  const merged: RichTextNode[] = []
  for (const n of out) {
    const last = merged[merged.length - 1]
    if (last && n.type === 'text' && last.type === 'text' && JSON.stringify(last.marks ?? []) === JSON.stringify(n.marks ?? [])) last.text += n.text ?? ''
    else merged.push(n)
  }
  return merged
}

/** Paragraph lines as inline text: a line ending in two spaces or `\` breaks hard, others softly (a space). */
function paragraphText(lines: string[]): string {
  return lines.map((l, k) => {
    const t = l.replace(/^[ \t]+/, '')
    if (k === lines.length - 1) return t.trimEnd()
    if (/( {2,}|\\)$/.test(t)) return `${t.replace(/( {2,}|\\)$/, '')}\n`
    return `${t.trimEnd()} `
  }).join('')
}

class MarkdownBlocks {
  private n = 0
  constructor(private readonly prefix: string) {}

  private id(): string {
    return `${this.prefix}-${++this.n}`
  }

  private textblock(type: string, text: string, attrs: Record<string, Json> = {}): RichTextNode {
    const node: RichTextNode = { type, attrs: { block_id: this.id(), ...attrs } }
    const content = inlineNodes(text)
    if (content.length) node.content = content
    return node
  }

  empty(): RichTextNode {
    return { type: 'paragraph', attrs: { block_id: this.id() } }
  }

  blocks(lines: string[]): RichTextNode[] {
    const out: RichTextNode[] = []
    let i = 0
    while (i < lines.length) {
      const line = lines[i]
      if (!line.trim()) { i++; continue }
      let m: RegExpExecArray | null
      if ((m = FENCE_OPEN.exec(line))) {
        const [, indent, fence, lang] = m
        const body: string[] = []
        i++
        while (i < lines.length) {
          const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(lines[i])
          if (close && close[1][0] === fence[0] && close[1].length >= fence.length) { i++; break }
          body.push(lines[i].slice(Math.min(indent.length, indentOf(lines[i]))))
          i++
        }
        const node: RichTextNode = { type: 'code_block', attrs: { block_id: this.id(), ...(lang ? { language: lang.slice(0, 32) } : {}) } }
        const text = body.join('\n')
        if (text) node.content = [{ type: 'text', text }]
        out.push(node)
      } else if ((m = ATX.exec(line))) {
        const level = Math.min(m[1].length, 3)
        out.push(this.textblock('heading', m[2] ?? '', level === 1 ? {} : { level }))
        i++
      } else if (HR.test(line)) {
        out.push({ type: 'horizontal_rule', attrs: { block_id: this.id() } })
        i++
      } else if (QUOTE.test(line)) {
        const id = this.id()
        const inner: string[] = []
        while (i < lines.length) {
          const q = QUOTE.exec(lines[i])
          if (q) inner.push(q[1])
          else if (lines[i].trim() && inner.length && inner[inner.length - 1].trim() && !interrupts(lines[i])) inner.push(lines[i])
          else break
          i++
        }
        const content = this.blocks(inner).flatMap((b) => (b.type === 'blockquote' ? b.content ?? [] : [b]))
          .filter((b) => ['paragraph', 'heading', 'bullet_list', 'ordered_list', 'code_block'].includes(b.type))
        out.push({ type: 'blockquote', attrs: { block_id: id }, content: content.length ? content : [this.empty()] })
      } else if (listMarker(line)) {
        i = this.list(lines, i, out)
      } else if (line.includes('|') && i + 1 < lines.length && lines[i + 1].includes('-') && TABLE_DELIM.test(lines[i + 1]) && tableCells(line).length === tableCells(lines[i + 1]).length) {
        const header = tableCells(line)
        const id = this.id()
        const row = (cells: string[], head: boolean): RichTextNode => ({
          type: 'table_row',
          content: header.map((_, k) => {
            const cell: RichTextNode = { type: 'table_cell', ...(head ? { attrs: { header: 1 } } : {}) }
            const content = inlineNodes(cells[k] ?? '')
            if (content.length) cell.content = content
            return cell
          }),
        })
        const rows = [row(header, true)]
        i += 2
        while (i < lines.length && lines[i].trim() && !interrupts(lines[i])) rows.push(row(tableCells(lines[i++]), false))
        out.push({ type: 'table', attrs: { block_id: id }, content: rows })
      } else {
        const para = [line]
        i++
        let level = 0
        while (i < lines.length && lines[i].trim()) {
          const setext = SETEXT.exec(lines[i])
          if (setext) { level = setext[1][0] === '=' ? 1 : 2; i++; break }
          if (interrupts(lines[i])) break
          para.push(lines[i++])
        }
        out.push(level ? this.textblock('heading', paragraphText(para).replace(/\n/g, ' '), level === 1 ? {} : { level }) : this.textblock('paragraph', paragraphText(para)))
      }
    }
    return out
  }

  /** A list from `lines[i]`: its items while the marker kind stays; returns the index after it. */
  private list(lines: string[], i: number, out: RichTextNode[]): number {
    const first = listMarker(lines[i])!
    const list: RichTextNode = { type: first.ordered ? 'ordered_list' : 'bullet_list', attrs: { block_id: this.id(), ...(first.ordered && first.start !== 1 ? { start: Math.max(1, first.start) } : {}) }, content: [] }
    while (i < lines.length) {
      const mk = listMarker(lines[i])
      if (!mk || mk.ordered !== first.ordered) break
      const item = [mk.text]
      i++
      while (i < lines.length) {
        const l = lines[i]
        if (!l.trim()) item.push('')
        else if (indentOf(l) >= mk.indent) item.push(l.slice(mk.indent))
        else if (item[item.length - 1].trim() && !interrupts(l) && !listMarker(l)) item.push(l.trim())
        else break
        i++
      }
      while (item.length && !item[item.length - 1].trim()) item.pop()
      list.content!.push(this.item(item))
    }
    out.push(list)
    return i
  }

  /** A list item holds one paragraph, then paragraphs and lists only (as the core's converter makes it). */
  private item(lines: string[]): RichTextNode {
    const id = this.id()
    const task = /^\[([ xX])\][ \t]+/.exec(lines[0] ?? '')
    if (task) lines = [`${task[1] === ' ' ? '☐' : '☑'} ${lines[0].slice(task[0].length)}`, ...lines.slice(1)]
    const content: RichTextNode[] = []
    for (const b of this.blocks(lines)) {
      if (b.type === 'paragraph' || b.type === 'bullet_list' || b.type === 'ordered_list') content.push(b)
      else if (b.type === 'heading' || b.type === 'code_block') content.push({ type: 'paragraph', attrs: { block_id: b.attrs!.block_id }, ...(b.content ? { content: b.content } : {}) })
      else if (b.type === 'blockquote') content.push(...(b.content ?? []).filter((c) => c.type === 'paragraph'))
    }
    if (content[0]?.type !== 'paragraph') content.unshift(this.empty())
    return { type: 'list_item', attrs: { block_id: id }, content }
  }
}

/**
 * Markdown → top-level blocks of `buckyos.richtext.basic.v1` (block ids `<prefix>-<n>`; the default prefix is random,
 * so the ids are new in any document). A subset of the core's converter (aiworkspace core/src/markdown.rs, CommonMark +
 * GFM): ATX and setext headings (levels past 3 are 3), paragraphs with soft and hard breaks, bullet and ordered lists
 * (nested by indentation, task markers as ☐ / ☑), fenced code blocks with their language, block quotes, horizontal
 * rules, GFM pipe tables, and inline code, strong, emphasis, strike, links (http, https, mailto, `#`; `[label](entity:
 * <id>)` an object link; other destinations keep their text) and autolinks. Not covered: indented code blocks (their
 * text becomes a paragraph), reference-style links, HTML (kept as text), footnotes, embeds, and CommonMark's finer
 * delimiter and laziness rules. The service validates the result as for any other block.
 */
export function markdownToBlocks(markdown: string, prefix?: string): RichTextNode[] {
  const b = new MarkdownBlocks(prefix ?? `m${Math.floor(Math.random() * 36 ** 8).toString(36).padStart(8, '0')}`)
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/^[ \t]+/, (ws) => ws.replace(/\t/g, '    ')))
  const blocks = b.blocks(lines)
  return blocks.length ? blocks : [b.empty()]
}
