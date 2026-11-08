// The `bash` tool group of the native runtime (Rust `builtin_bash_group`):
// `read_file`, `write_file`, `edit_file`, `shell`. Names, descriptions and
// argument schemas are Rust's to the byte — they are advertised to models and
// saved in run.json, and a run moves between the two executors with them.
// Semantics follow `file_tools.rs` (workspace policy on real paths),
// `read_tool.rs` (`read_file` dedup key) and `llm_bash.rs` (`shell` in its
// wait form: the command runs in the call until it ends or `timeout_ms`,
// output in `runs/<run_id>/exec/<call_id>/{command,stdout,stderr,exit}`,
// head 1/4 + tail 3/4 of 64 KB, `XLLM_CALL_ID` / `XLLM_RUN_ID`).
//
// Difference from Rust: `Deno.Command` cannot start the command in its own
// process group, so a timeout or an interrupt kills the wrapper process only;
// what the command started keeps running (Rust kills the whole group).

import type { JsonValue, ToolSpecLite } from '../../core/types'
import { canonicalJson, isObject } from '../../core/json'
import { normalizePath } from '../../core/config'
import type { ToolCallCtx } from '../../core/deps'
import type { AgentToolResult } from '../../runtime/tool_result'
import { deno, errorText, isDir, isNotFound, joinPath, parentDir } from './deno_api'
import type { DenoChildProcess } from './deno_api'
import { blake3Hex } from './identity'

export const TOOL_READ_FILE = 'read_file'
export const TOOL_WRITE_FILE = 'write_file'
export const TOOL_EDIT_FILE = 'edit_file'
export const TOOL_SHELL = 'shell'
export const BASH_GROUP_TOOLS = [TOOL_READ_FILE, TOOL_WRITE_FILE, TOOL_EDIT_FILE, TOOL_SHELL]

/** `EXEC_MAX_OUTPUT_BYTES`: what one `shell` call keeps of each stream. */
export const EXEC_MAX_OUTPUT_BYTES = 64 * 1024
/** Bytes of output in a progress / cancel / interrupted text (`OUTPUT_TAIL_BYTES`). */
export const OUTPUT_TAIL_BYTES = 2048
export const TIMEOUT_EXIT_CODE = 124
export const ENV_CALL_ID = 'XLLM_CALL_ID'
export const ENV_RUN_ID = 'XLLM_RUN_ID'
const LOCAL_ENGINE = 'native'
const READ_FILE_PREVIEW_MAX_LINES = 200
const CMD_PARAM_PREVIEW_KEEP_CHARS = 32
const HISTORY_COMPACT_CMD_MAX_CHARS = 96

// ---------------------------------------------------------------- errors

export type ToolErrorKind = 'invalid_args' | 'exec_failed' | 'timeout' | 'transport' | 'cancelled'

/** `AgentToolError`: the message is its Display text. */
export class NativeToolError extends Error {
  constructor(readonly kind: ToolErrorKind, readonly detail: string, readonly effectUnknown = false) {
    super(kind === 'invalid_args' ? `invalid args: ${detail}`
      : kind === 'exec_failed' ? `execution failed: ${detail}`
        : kind === 'timeout' ? 'timeout'
          : kind === 'transport' ? `runtime transport: ${detail}` : `cancelled: ${detail}`)
    this.name = 'NativeToolError'
  }
}

const invalidArgs = (m: string) => new NativeToolError('invalid_args', m)
const execFailed = (m: string) => new NativeToolError('exec_failed', m)

// ---------------------------------------------------------------- results

/** `tokenize_bash_command_line`. */
export function tokenizeBashCommandLine(line: string): string[] | undefined {
  const tokens: string[] = []
  let cur = ''
  let single = false
  let double = false
  const chars = [...line]
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    if (ch === "'" && !double) single = !single
    else if (ch === '"' && !single) double = !double
    else if (ch === '\\' && !single) {
      if (i + 1 < chars.length) cur += chars[++i]
    } else if (/\s/.test(ch) && !single && !double) {
      if (cur) {
        tokens.push(cur)
        cur = ''
      }
    } else cur += ch
  }
  if (single || double) return undefined
  if (cur) tokens.push(cur)
  return tokens
}

function truncateText(text: string, max: number): string {
  const chars = [...text]
  return chars.length <= max ? text : `${chars.slice(0, max).join('')}...[TRUNCATED]`
}

function defaultTitle(r: AgentToolResult): string {
  const line = r.cmd_name !== undefined ? (r.cmd_args?.trim() ? `${r.cmd_name} ${r.cmd_args.trim()}` : r.cmd_name) : undefined
  const cmd = (line !== undefined ? truncateText(line.trim(), HISTORY_COMPACT_CMD_MAX_CHARS) : '') || 'action'
  const status = r.status === 'pending' ? (r.pending_reason !== undefined ? `pending (${r.pending_reason})` : 'pending') : r.status
  return `${cmd} => ${status}`
}

/** `build_builtin_tool_result(detail, cmd_line, summary)` (+ `with_tool`). */
export function builtinResult(tool: string, detail: JsonValue, cmdLine: string, summary: string): AgentToolResult {
  const r: AgentToolResult = { agent_tool_protocol: '1', tool, status: 'success', summary, detail }
  const tokens = tokenizeBashCommandLine(cmdLine)
  const parts = tokens && tokens.length ? tokens : cmdLine.split(/\s+/).filter(Boolean)
  if (parts.length) {
    r.cmd_name = parts[0]
    if (parts.length > 1) r.cmd_args = parts.slice(1).join(' ')
  }
  r.title = defaultTitle(r)
  return r
}

function withOutput(r: AgentToolResult, output: string): AgentToolResult {
  if (output.trim()) r.output = output
  else delete r.output
  return r
}

// ---------------------------------------------------------------- paths

function pathStartsWith(p: string, root: string): boolean {
  if (root === '/') return p.startsWith('/')
  return p === root || p.startsWith(`${root}/`)
}

function checkAllowed(path: string, roots: string[]) {
  if (roots.length === 0 || roots.some(r => pathStartsWith(path, r))) return
  throw invalidArgs(`path not allowed by policy: ${path}`)
}

/** Real path of `path`, its missing tail appended (`canonical_missing`). */
async function canonicalMissing(path: string): Promise<string> {
  let ancestor = path.replace(/\/+$/, '') || '/'
  const missing: string[] = []
  for (;;) {
    try {
      const real = await deno().realPath(ancestor)
      return normalizePath(joinPath(real, ...missing.slice().reverse()))
    } catch (e) {
      if (!isNotFound(e)) throw execFailed(errorText(e))
      try {
        await deno().lstat(ancestor)
        throw invalidArgs(`dangling symlink: ${ancestor}`)
      } catch (le) {
        if (le instanceof NativeToolError) throw le
      }
      const name = ancestor.slice(ancestor.lastIndexOf('/') + 1)
      if (!name || name === '..') throw invalidArgs(`cannot resolve ${path}`)
      if (name !== '.') missing.push(name)
      const parent = parentDir(ancestor)
      if (parent === ancestor || ancestor === '/') throw invalidArgs('path has no existing ancestor')
      ancestor = parent
    }
  }
}

/** `LocalFileBackend::resolve`: the lexical path and the real path must both be under an allowed root. */
export async function resolvePath(root: string, raw: string, allowed: string[]): Promise<string> {
  if (!raw.trim()) throw invalidArgs('path cannot be empty')
  const candidate = raw.startsWith('/') ? raw : joinPath(root, raw)
  checkAllowed(normalizePath(candidate), allowed)
  const real = await canonicalMissing(candidate)
  const roots = await Promise.all(allowed.map(canonicalMissing))
  checkAllowed(real, roots)
  return real
}

function encodeObjSegment(seg: string): string {
  let out = ''
  for (const b of new TextEncoder().encode(seg)) {
    const c = String.fromCharCode(b)
    out += /[A-Za-z0-9\-._~!$&'()*+,;=:@]/.test(c) ? c : `%${b.toString(16).toUpperCase().padStart(2, '0')}`
  }
  return out
}

/** `FileToolConfig::cyfs_url`: a file below `$BUCKYOS_ROOT/data` is the Zone file `cyfs:///<path>`. */
function cyfsUrl(dfsRoot: string | undefined, abs: string): string | undefined {
  if (!dfsRoot) return undefined
  const root = normalizePath(dfsRoot)
  if (!pathStartsWith(abs, root)) return undefined
  const rel = abs.slice(root.length).split('/').filter(s => s && s !== '.')
  return `cyfs://${['', ...rel].map(encodeObjSegment).join('/') || '/'}`
}

// ---------------------------------------------------------------- args

function serdeKind(v: JsonValue): string {
  if (v === null) return 'null'
  if (typeof v === 'boolean') return `boolean \`${v}\``
  if (typeof v === 'number') return Number.isInteger(v) ? `integer \`${v}\`` : `floating point \`${v}\``
  if (typeof v === 'string') return `string ${JSON.stringify(v)}`
  if (Array.isArray(v)) return 'sequence'
  return 'map'
}

function argError(tool: string, reason: string): NativeToolError {
  return invalidArgs(`invalid args for \`${tool}\`: ${reason}`)
}

function reqString(tool: string, args: Record<string, JsonValue>, key: string): string {
  const v = args[key]
  if (v === undefined) throw argError(tool, `missing field \`${key}\``)
  if (typeof v !== 'string') throw argError(tool, `invalid type: ${serdeKind(v)}, expected a string`)
  return v
}

function optString(tool: string, args: Record<string, JsonValue>, key: string): string | undefined {
  const v = args[key]
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string') throw argError(tool, `invalid type: ${serdeKind(v)}, expected a string`)
  return v
}

// ---------------------------------------------------------------- text helpers

const utf8 = new TextEncoder()

function byteLength(s: string): number {
  return utf8.encode(s).length
}

function decodeLossy(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
}

/** `split_inclusive('\n')`. */
function splitLinesPreserveEnding(content: string): string[] {
  if (!content) return []
  return content.match(/[^\n]*\n|[^\n]+$/g) ?? []
}

/** `str::lines()`. */
function strLines(s: string): string[] {
  if (!s) return []
  const parts = s.split('\n')
  if (parts[parts.length - 1] === '') parts.pop()
  return parts.map(l => (l.endsWith('\r') ? l.slice(0, -1) : l))
}

function trimEndLineBreaks(s: string): string {
  return s.replace(/[\r\n]+$/, '')
}

function compactCmdParamPreview(raw: string): string {
  const escaped = raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n')
  const totalLines = raw ? Math.max(strLines(raw).length, 1) : 0
  const chars = [...escaped]
  if (chars.length <= CMD_PARAM_PREVIEW_KEEP_CHARS * 2) return escaped
  return `${chars.slice(0, CMD_PARAM_PREVIEW_KEEP_CHARS).join('')}...(total ${totalLines} lines)...${chars.slice(-CMD_PARAM_PREVIEW_KEEP_CHARS).join('')}`
}

function buildSimpleDiff(path: string, before: string, after: string): string {
  const a = strLines(before)
  const b = strLines(after)
  const body: string[] = []
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const o = a[i]
    const n = b[i]
    if (o !== undefined && n !== undefined) {
      if (o === n) body.push(` ${o}`)
      else body.push(`-${o}`, `+${n}`)
    } else if (o !== undefined) body.push(`-${o}`)
    else if (n !== undefined) body.push(`+${n}`)
  }
  return [`--- a/${path}`, `+++ b/${path}`, `@@ -1,${a.length} +1,${b.length} @@`, ...body].join('\n')
}

// ---------------------------------------------------------------- read_file range

type LineMarker = number | 'end'

interface LineRangeSpec {
  start?: LineMarker
  end?: LineMarker
  count?: number
  defaultEnd: 'same_as_start' | 'end' | 'tail_if_start_negative'
}

function parseMarkerToken(raw: string, rangeText: string): LineMarker {
  const t = raw.trim()
  if (t === '$') return 'end'
  if (t.startsWith('+') || !/^-?\d+$/.test(t)) throw invalidArgs(`invalid range text \`${rangeText}\``)
  const v = Number(t)
  if (v === 0) throw invalidArgs('range must be 1-based, zero is invalid')
  return v
}

function parseCountText(raw: string, rangeText: string): number {
  const t = raw.trim()
  if (!t.startsWith('+')) throw invalidArgs(`invalid range text \`${rangeText}\``)
  const c = t.slice(1).trim()
  if (!/^\d+$/.test(c)) throw invalidArgs(`invalid range text \`${rangeText}\``)
  const n = Number(c)
  if (n === 0) throw invalidArgs('range count must be positive integer')
  return n
}

function parseMarkerJson(v: JsonValue, name: string): LineMarker {
  if (typeof v === 'string') return parseMarkerToken(v, name)
  if (typeof v === 'number' && Number.isInteger(v)) {
    if (v === 0) throw invalidArgs(`${name} must be non-zero integer`)
    return v
  }
  throw invalidArgs(`${name} must be integer or \`$\``)
}

function parseCountJson(v: JsonValue, name: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) throw invalidArgs(`${name} must be positive integer`)
  return v
}

function parseRangeText(raw: string): LineRangeSpec | undefined {
  const text = raw.trim()
  if (!text || text === '-') return undefined
  if (text.includes(',') || text.includes(':')) {
    if (text.includes(',') && text.includes(':')) throw invalidArgs(`invalid range text \`${raw}\``)
    const parts = text.split(text.includes(',') ? ',' : ':')
    if (parts.length !== 2) throw invalidArgs(`invalid range text \`${raw}\``)
    const start = parts[0].trim() ? parseMarkerToken(parts[0].trim(), raw) : undefined
    const endText = parts[1].trim()
    if (endText.startsWith('+')) {
      if (start === undefined) throw invalidArgs(`range \`${raw}\` with \`+count\` requires start`)
      return { start, count: parseCountText(endText, raw), defaultEnd: 'same_as_start' }
    }
    return { start, end: endText ? parseMarkerToken(endText, raw) : undefined, defaultEnd: 'end' }
  }
  const dash = text.indexOf('-')
  if (dash >= 0) {
    const left = text.slice(0, dash).trim()
    const right = text.slice(dash + 1).trim()
    if (left && right && /^\d+$/.test(left) && /^\d+$/.test(right)) {
      return { start: parseMarkerToken(left, raw), end: parseMarkerToken(right, raw), defaultEnd: 'same_as_start' }
    }
  }
  return { start: parseMarkerToken(text, raw), defaultEnd: 'same_as_start' }
}

function parseRangeSpec(raw: JsonValue | undefined): LineRangeSpec | undefined {
  if (raw === undefined || raw === null) return undefined
  if (isObject(raw)) {
    const start = raw.start !== undefined ? parseMarkerJson(raw.start, 'range.start') : undefined
    const end = raw.end !== undefined ? parseMarkerJson(raw.end, 'range.end') : undefined
    const count = raw.count !== undefined ? parseCountJson(raw.count, 'range.count') : undefined
    if (count !== undefined && end !== undefined) throw invalidArgs('range cannot set both `end` and `count`')
    if (count !== undefined && start === undefined) throw invalidArgs('range.count requires range.start')
    if (start === undefined && end === undefined && count === undefined) {
      throw invalidArgs('range object must contain at least one of start/end/count')
    }
    return { start, end, count, defaultEnd: 'tail_if_start_negative' }
  }
  if (Array.isArray(raw)) {
    if (raw.length === 0 || raw.length > 2) throw invalidArgs('range array must be [start] or [start,end]')
    return {
      start: parseMarkerJson(raw[0], 'range[0]'),
      end: raw.length === 2 ? parseMarkerJson(raw[1], 'range[1]') : undefined,
      defaultEnd: 'same_as_start',
    }
  }
  if (typeof raw === 'number' && Number.isInteger(raw)) return { start: parseMarkerJson(raw, 'range'), defaultEnd: 'same_as_start' }
  if (typeof raw === 'string') return parseRangeText(raw)
  throw invalidArgs('range must be string/number/array/object')
}

function resolveMarker(m: LineMarker, total: number): number {
  if (m === 'end') return total
  return m > 0 ? m : total + m + 1
}

function resolveRange(spec: LineRangeSpec, total: number): [number, number] {
  const startMarker = spec.start ?? 1
  const startRaw = resolveMarker(startMarker, total)
  let endRaw: number
  if (spec.count !== undefined) endRaw = startRaw + spec.count - 1
  else if (spec.end !== undefined) endRaw = resolveMarker(spec.end, total)
  else if (spec.defaultEnd === 'same_as_start') endRaw = startRaw
  else if (spec.defaultEnd === 'end') endRaw = total
  else endRaw = typeof startMarker === 'number' && startMarker < 0 ? total : startRaw
  return [Math.min(Math.max(startRaw, 1), total + 1), Math.min(Math.max(endRaw, 0), total)]
}

function readCmdLine(path: string, firstChunk: string | undefined, range: JsonValue | undefined): string {
  let cmd = `${TOOL_READ_FILE} ${path}`
  if (firstChunk !== undefined) cmd += ` first_chunk="${compactCmdParamPreview(firstChunk)}"`
  if (range !== undefined && range !== null) {
    const text = typeof range === 'string' ? range : canonicalJson(range)
    if (text.trim()) cmd += ` range=${text}`
  }
  return cmd
}

// ---------------------------------------------------------------- tools

export interface FileToolConfig {
  /** The working directory (real path). */
  root: string
  allowedRead: string[]
  allowedWrite: string[]
  /** `$BUCKYOS_ROOT/data` on this machine. */
  dfsRoot?: string
}

export interface NativeToolCtx {
  call_id: string
  run_id: string
  run_dir?: string
  call: ToolCallCtx
}

export interface NativeTool {
  spec: ToolSpecLite
  idempotent: boolean
  /** Observes the call's cancellation itself (`shell`). */
  cancellable: boolean
  call(args: Record<string, JsonValue>, ctx: NativeToolCtx): Promise<AgentToolResult>
}

export const READ_FILE_SPEC: ToolSpecLite = {
  name: TOOL_READ_FILE,
  description: 'Read a text file. range selects 1-based lines ("120-200", "120:$", "120:+20", "-50:$" for the last 50); first_chunk starts the read at the first occurrence of that text. Paths are relative to the working directory; paths outside it only where the run\'s filesystem policy allows.',
  args_schema: {
    properties: {
      first_chunk: { description: 'Start the read at the first occurrence of this text (range then counts from there).', type: 'string' },
      path: { description: 'File to read, relative to the working directory.', type: 'string' },
      range: { description: '1-based line range: "120-200", "120:$" (to the end), "120:+20" (20 lines from 120); negative numbers count from the end ("-50:$").' },
    },
    required: ['path'],
    type: 'object',
  },
}

export const WRITE_FILE_SPEC: ToolSpecLite = {
  name: TOOL_WRITE_FILE,
  description: 'Write a text file: mode "write" (default) creates or overwrites it, "append" adds to its end, "new" creates it and fails if it exists. Parent directories are created. Paths are relative to the working directory; paths outside it only where the run\'s filesystem policy allows.',
  args_schema: {
    properties: {
      content: { description: 'The text to write.', type: 'string' },
      mode: { description: '`write` (default): create or overwrite; `append`: add to the end; `new`: create, fail if the file exists.', type: 'string' },
      path: { description: 'File to write, relative to the working directory.', type: 'string' },
    },
    required: ['content', 'path'],
    type: 'object',
  },
}

export const EDIT_FILE_SPEC: ToolSpecLite = {
  name: TOOL_EDIT_FILE,
  description: 'Replace the one exact occurrence of old_string with new_string in a text file. Fails when old_string is absent or occurs more than once: include enough surrounding text to make it unique. Paths are relative to the working directory; paths outside it only where the run\'s filesystem policy allows.',
  args_schema: {
    properties: {
      new_string: { description: 'The replacement text.', type: 'string' },
      old_string: { description: 'The exact text to replace; it must occur exactly once.', type: 'string' },
      path: { description: 'File to edit, relative to the working directory.', type: 'string' },
    },
    required: ['new_string', 'old_string', 'path'],
    type: 'object',
  },
}

async function readText(path: string): Promise<string> {
  try {
    return decodeLossy(await deno().readFile(path))
  } catch (e) {
    throw execFailed(`read file failed: ${errorText(e)}`)
  }
}

async function writeText(path: string, text: string): Promise<void> {
  try {
    await deno().mkdir(parentDir(path), { recursive: true })
  } catch (e) {
    throw execFailed(errorText(e))
  }
  try {
    await deno().writeFile(path, utf8.encode(text))
  } catch (e) {
    throw execFailed(`write file failed: ${errorText(e)}`)
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await deno().stat(path)
    return true
  } catch (e) {
    if (isNotFound(e)) return false
    throw execFailed(errorText(e))
  }
}

/** `read_file` (`ReadFileTool` behind `DedupReadFile`). */
export function readFileTool(cfg: FileToolConfig): NativeTool {
  return {
    spec: READ_FILE_SPEC,
    idempotent: true,
    cancellable: false,
    async call(args) {
      const rawPath = reqString(TOOL_READ_FILE, args, 'path')
      const firstChunk = optString(TOOL_READ_FILE, args, 'first_chunk')
      const range = args.range === null ? undefined : args.range
      const filePath = rawPath.trim()
      if (!filePath) throw invalidArgs('missing required arg `path`')
      const abs = await resolvePath(cfg.root, filePath, cfg.allowedRead)
      const full = await readText(abs)
      let chunk: string
      let matched = true
      let chunkStart = 1
      if (firstChunk !== undefined) {
        const pos = full.indexOf(firstChunk)
        if (pos >= 0) {
          chunk = full.slice(pos)
          chunkStart = (full.slice(0, pos).match(/\n/g) ?? []).length + 1
        } else {
          chunk = ''
          matched = false
        }
      } else chunk = full
      const lines = splitLinesPreserveEnding(chunk)
      const total = lines.length
      const spec = parseRangeSpec(range)
      let start: number
      let end: number
      let label = ''
      if (spec) {
        ;[start, end] = resolveRange(spec, total)
        label = `${start}-${end}`
      } else if (total === 0) {
        start = 1
        end = 0
      } else {
        start = 1
        end = total
      }
      const si = Math.min(Math.max(start - 1, 0), total)
      const ei = Math.min(end, total)
      const selected = si < ei ? lines.slice(si, ei) : []
      const content = selected.join('')
      const count = selected.length
      const startLine = count === 0 ? null : chunkStart + si
      const endLine = startLine === null ? null : startLine + Math.max(count - 1, 0)
      let preview = ''
      if (startLine !== null) {
        preview = selected.slice(0, READ_FILE_PREVIEW_MAX_LINES).map((l, i) => `${startLine + i}: ${trimEndLineBreaks(l)}`).join('\n')
        if (selected.length > READ_FILE_PREVIEW_MAX_LINES) preview += `${preview ? '\n' : ''}... truncated to ${READ_FILE_PREVIEW_MAX_LINES} lines`
      }
      const bytes = byteLength(content)
      const cmdLine = readCmdLine(filePath, firstChunk, range)
      let summary: string
      if (matched) {
        const linesText = startLine !== null && endLine !== null
          ? (startLine === endLine ? `1 line at ${startLine}` : `${count} lines at ${startLine}-${endLine}`) : '0 lines'
        const base = `succeeded, read ${bytes} bytes across ${linesText}`
        summary = preview ? `${base}\n\`\`\`content\n${preview}\n\`\`\`` : base
      } else {
        summary = 'succeeded, first_chunk was not found, read 0 bytes across 0 lines'
      }
      const detail: Record<string, JsonValue> = {}
      const url = cyfsUrl(cfg.dfsRoot, abs)
      if (url !== undefined) detail.cyfs_url = url
      Object.assign(detail, {
        content, matched, line_range: label, bytes, line_count: count, start_line: startLine, end_line: endLine,
        preview_truncated: count > READ_FILE_PREVIEW_MAX_LINES,
      })
      const result = builtinResult(TOOL_READ_FILE, detail, cmdLine, summary)
      result.title = `${cmdLine} => ${matched ? 'success' : 'anchor not found'}`
      return withReadDedup(result, filePath, canonicalJson(Object.fromEntries(Object.entries(args).filter(([k]) => k !== 'path'))))
    },
  }
}

/** `with_read_dedup`: the same window of the same content read again answers with one line. */
function withReadDedup(result: AgentToolResult, what: string, window: string): AgentToolResult {
  if (result.status !== 'success') return result
  const text = result.output?.trim() ? result.output : result.summary.trim() ? result.summary : canonicalJson(result.detail)
  result.dedup = {
    key: `read:${what}#${window}:${blake3Hex(text).slice(0, 16)}`,
    hint: `\`${what}\` is unchanged since you read it earlier in this run; use that content.`,
  }
  return result
}

function normalizeWriteMode(raw: string | undefined): 'new' | 'append' | 'write' {
  const m = (raw ?? 'write').trim().toLowerCase()
  if (m === 'new' || m === 'create') return 'new'
  if (m === 'append') return 'append'
  if (m === '' || m === 'write' || m === 'overwrite') return 'write'
  throw invalidArgs(`invalid write mode \`${m}\`, expected new/append/write`)
}

/** `write_file`. */
export function writeFileTool(cfg: FileToolConfig): NativeTool {
  return {
    spec: WRITE_FILE_SPEC,
    idempotent: false,
    cancellable: false,
    async call(args) {
      const rawPath = reqString(TOOL_WRITE_FILE, args, 'path')
      const content = reqString(TOOL_WRITE_FILE, args, 'content')
      const rawMode = optString(TOOL_WRITE_FILE, args, 'mode')
      let cmdMode: string
      try {
        cmdMode = normalizeWriteMode(rawMode)
      } catch {
        cmdMode = 'write'
      }
      const cmdLine = `${TOOL_WRITE_FILE} ${rawPath} mode=${cmdMode}`
      const filePath = rawPath.trim()
      if (!filePath) throw invalidArgs('missing required arg `path`')
      const mode = normalizeWriteMode(rawMode)
      const abs = await resolvePath(cfg.root, filePath, cfg.allowedWrite)
      const present = await exists(abs)
      if (mode === 'new' && present) throw invalidArgs(`write mode \`new\` requires target file not exist: ${filePath}`)
      const original = present ? await readText(abs) : ''
      const operation = mode === 'append' ? 'append' : mode === 'new' ? 'new' : present ? 'write' : 'create'
      const updated = mode === 'append' ? `${original}${content}` : content
      await writeText(abs, updated)
      const lineCount = splitLinesPreserveEnding(content).length
      const detail: Record<string, JsonValue> = {}
      const url = cyfsUrl(cfg.dfsRoot, abs)
      if (url !== undefined) detail.cyfs_url = url
      const bytesAfter = byteLength(updated)
      Object.assign(detail, { created: !present, changed: original !== updated, bytes_written: bytesAfter, line_count: lineCount })
      const verb = operation === 'append' ? 'appended' : operation === 'new' || operation === 'create' ? 'created' : 'wrote'
      const summary = `${verb} ${filePath}, wrote ${byteLength(content)} bytes across ${lineCount === 1 ? '1 line' : `${lineCount} lines`}`
      const result = builtinResult(TOOL_WRITE_FILE, detail, cmdLine, summary)
      const label = operation === 'append' ? 'append' : operation === 'new' || operation === 'create' ? 'new' : 'write'
      result.title = `${TOOL_WRITE_FILE} ${filePath} mode=${label} => success (${bytesAfter} bytes)`
      return result
    },
  }
}

/** `edit_file`. */
export function editFileTool(cfg: FileToolConfig): NativeTool {
  return {
    spec: EDIT_FILE_SPEC,
    idempotent: false,
    cancellable: false,
    async call(args) {
      const rawPath = reqString(TOOL_EDIT_FILE, args, 'path')
      const oldString = reqString(TOOL_EDIT_FILE, args, 'old_string')
      const newString = reqString(TOOL_EDIT_FILE, args, 'new_string')
      const cmdLine = `${TOOL_EDIT_FILE} ${rawPath} old_string="${compactCmdParamPreview(oldString)}"`
      const filePath = rawPath.trim()
      if (!filePath) throw invalidArgs('missing required arg `path`')
      if (!oldString) throw invalidArgs('missing required arg `old_string`')
      if (oldString === newString) throw invalidArgs('`new_string` must be different from `old_string`')
      const abs = await resolvePath(cfg.root, filePath, cfg.allowedWrite)
      const original = await readText(abs)
      const matches: number[] = []
      for (let at = original.indexOf(oldString); at >= 0; at = original.indexOf(oldString, at + oldString.length)) matches.push(at)
      if (matches.length === 0) throw invalidArgs('`old_string` was not found in the file')
      if (matches.length > 1) throw invalidArgs(`\`old_string\` must match exactly once, found ${matches.length} matches`)
      const pos = matches[0]
      const updated = original.slice(0, pos) + newString + original.slice(pos + oldString.length)
      const changed = original !== updated
      if (changed) await writeText(abs, updated)
      const diff = buildSimpleDiff(filePath, original, updated)
      const line = (original.slice(0, pos).match(/\n/g) ?? []).length + 1
      const detail: Record<string, JsonValue> = {}
      const url = cyfsUrl(cfg.dfsRoot, abs)
      if (url !== undefined) detail.cyfs_url = url
      Object.assign(detail, { matched: true, changed, mode: 'replace', line, diff, diff_truncated: false })
      const summary = changed
        ? (diff.trim() ? `edited ${filePath} with replace at line ${line}\n\`\`\`diff\n${diff}\n\`\`\`` : `edited ${filePath} with replace at line ${line}`)
        : `edit ${filePath} made no change`
      const result = builtinResult(TOOL_EDIT_FILE, detail, cmdLine, summary)
      result.title = `${TOOL_EDIT_FILE} ${filePath} => ${changed ? `success (line ${line})` : 'no change'}`
      return result
    },
  }
}

// ---------------------------------------------------------------- shell

/**
 * Wrapper run as `bash -c WRAPPER <command> <exec_dir>` (`NATIVE_WRAPPER`):
 * output to files, exit code to `exit`, so the command outlives the executor
 * without SIGPIPE and its end is readable after a crash.
 */
export const NATIVE_WRAPPER = `if [ "$#" -ge 2 ]; then export PATH="$2"; fi
printf '%s\\n' "$0" > "$1/command"
"$BASH" -c "$0" </dev/null >"$1/stdout" 2>"$1/stderr"
__llm_ec=$?
printf '%s\\n' "$__llm_ec" > "$1/exit.tmp" && command -p mv -f "$1/exit.tmp" "$1/exit"
exit $__llm_ec`

const SYSTEM_PATH_ENTRIES = ['/usr/local/sbin', '/usr/local/bin', '/usr/sbin', '/usr/bin', '/sbin', '/bin']

/** `sanitize_call_id`. */
export function sanitizeCallId(callId: string): string {
  const s = [...callId].map(c => (/[A-Za-z0-9\-_.]/.test(c) ? c : '_')).join('')
  return !s || s.startsWith('.') ? `c_${s}` : s
}

/** `<run_dir>/exec/<call_id>` (`exec_dir_for`). */
export function execDirFor(runDir: string | undefined, callId: string | undefined): string | undefined {
  if (!runDir || !callId) return undefined
  return joinPath(runDir, 'exec', sanitizeCallId(callId))
}

/** `fmt_elapsed`. */
export function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
}

/** Head 1/4 + tail 3/4 of a stream (`OutputCollector`). */
function boundedText(bytes: Uint8Array, max: number): [string, boolean] {
  const headCap = Math.floor(max / 4)
  const tailCap = max - headCap
  const head = bytes.subarray(0, Math.min(headCap, bytes.length))
  const rest = bytes.subarray(head.length)
  const tail = rest.subarray(Math.max(0, rest.length - tailCap))
  const truncated = bytes.length > head.length + tail.length
  if (!truncated) return [decodeLossy(head) + decodeLossy(tail), false]
  return [`${decodeLossy(head)}\n…[${bytes.length - head.length - tail.length} bytes omitted]…\n${decodeLossy(tail)}`, true]
}

async function readBytes(path: string): Promise<Uint8Array | undefined> {
  try {
    return await deno().readFile(path)
  } catch {
    return undefined
  }
}

/** `read_file_bounded`. */
async function readFileBounded(path: string, max: number): Promise<[string, boolean]> {
  const bytes = await readBytes(path)
  return bytes ? boundedText(bytes, Math.max(max, 16)) : ['', false]
}

/** `read_file_tail`: the last `max` bytes as text. */
export async function readFileTail(path: string, max: number): Promise<string> {
  const bytes = await readBytes(path)
  return bytes ? decodeLossy(bytes.subarray(Math.max(0, bytes.length - max))) : ''
}

/** `read_exit_file`. */
export async function readExitFile(dir: string): Promise<number | undefined> {
  try {
    const t = (await deno().readTextFile(joinPath(dir, 'exit'))).trim()
    return /^[+-]?\d+$/.test(t) ? Number(t) : undefined
  } catch {
    return undefined
  }
}

interface ShellOutput {
  exit_code: number
  stdout: string
  stderr: string
  output: string
  output_truncated: boolean
  timed_out: boolean
  duration_ms: number
  cwd: string
}

/** `output_from_exec_dir`. */
async function outputFromExecDir(dir: string, exitCode: number, timedOut: boolean, elapsedMs: number, max: number, cwd: string): Promise<ShellOutput> {
  const [stdout, outTrunc] = await readFileBounded(joinPath(dir, 'stdout'), max)
  const [stderr, errTrunc] = await readFileBounded(joinPath(dir, 'stderr'), max)
  let output = stdout
  if (stderr) {
    if (output && !output.endsWith('\n')) output += '\n'
    output += stderr
  }
  return { exit_code: exitCode, stdout, stderr, output, output_truncated: outTrunc || errTrunc, timed_out: timedOut, duration_ms: Math.floor(elapsedMs), cwd }
}

const SIGNALS: Record<string, number> = {
  SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGILL: 4, SIGTRAP: 5, SIGABRT: 6, SIGBUS: 7, SIGFPE: 8, SIGKILL: 9, SIGUSR1: 10, SIGSEGV: 11,
  SIGUSR2: 12, SIGPIPE: 13, SIGALRM: 14, SIGTERM: 15,
}

function exitCodeOf(status: { code: number; signal: string | null }): number {
  if (status.signal) return 128 + (SIGNALS[status.signal] ?? 0)
  return status.code
}

function commandHasShellOperator(command: string): boolean {
  let single = false
  let double = false
  let escaped = false
  for (const ch of command) {
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\' && !single) escaped = true
    else if (ch === "'" && !double) single = !single
    else if (ch === '"' && !single) double = !double
    else if ('|;&><\n\r'.includes(ch) && !single && !double) return true
  }
  return false
}

const RESULT_STRING_FIELDS = ['tool', 'cmd_name', 'task_id', 'pending_reason', 'estimated_wait', 'title', 'summary', 'cmd_args', 'partial_output', 'output']

/** `try_forward_inner_agent_tool_result`: a simple command printing an AgentToolResult is that result. */
function forwardInnerResult(command: string, out: ShellOutput): AgentToolResult | undefined {
  if (commandHasShellOperator(command) || !tokenizeBashCommandLine(command)?.length) return undefined
  const stdout = out.stdout.trim()
  if (!stdout) return undefined
  let v: unknown
  try {
    v = JSON.parse(stdout)
  } catch {
    return undefined
  }
  if (!isObject(v) || v.agent_tool_protocol !== '1') return undefined
  const status = v.status ?? 'success'
  if (status !== 'success' && status !== 'error' && status !== 'pending') return undefined
  for (const k of RESULT_STRING_FIELDS) if (v[k] !== undefined && v[k] !== null && typeof v[k] !== 'string') return undefined
  if (status === 'pending' && (typeof v.task_id !== 'string')) return undefined
  const r = { ...v, status, summary: typeof v.summary === 'string' ? v.summary : '', detail: v.detail === undefined ? {} : v.detail } as unknown as AgentToolResult
  if (r.return_code === undefined && out.exit_code !== 0) r.return_code = out.exit_code
  return r
}

export interface ShellToolConfig {
  workspace: string
  restrictCwd: boolean
  timeoutMs: number
  maxTimeoutMs: number
  /** The runtime's environment for every command (`runtime.env`, PATH). */
  env: Record<string, string>
}

/** `shell`'s spec in its wait form (Rust `ShellTool::spec`, `ShellMode::Wait`, native, bash). */
export function shellSpec(cfg: { restrictCwd: boolean; timeoutMs: number; maxTimeoutMs: number }): ToolSpecLite {
  const max = cfg.maxTimeoutMs
  const description = 'Run a command in this run\'s runtime (native) with bash syntax. It starts in the working directory unless cwd is given; it is not sandboxed and runs with the current user\'s permissions. The command is a child process of this executor: an interrupt or a timeout ends its process group; processes it leaves behind after returning are not managed. '
    + `Waits for the command to finish. Default timeout ${Math.floor(cfg.timeoutMs / 1000)}s${max === 0 ? ', no upper limit' : `, max ${Math.floor(max / 1000)}s`}; on timeout the command is stopped and the output so far is returned. `
    + 'Start a long-lived service with nohup / setsid and return at once; on Unix, processes started with `&` / nohup in the foreground command\'s process group also end when that command is interrupted or times out. Long output keeps its beginning and end.'
  const timeout: Record<string, JsonValue> = {
    description: `Timeout in milliseconds (default ${cfg.timeoutMs}${max === 0 ? '' : `, max ${max}`}). Set it explicitly for long builds, tests or media commands.`,
    minimum: 1,
    type: 'integer',
  }
  if (max !== 0) timeout.maximum = max
  return {
    name: TOOL_SHELL,
    description,
    args_schema: {
      properties: {
        command: { description: 'bash command to execute', type: 'string' },
        cwd: {
          description: cfg.restrictCwd
            ? 'Working directory, relative to or within the configured workspace. Defaults to the workspace.'
            : 'Working directory, absolute or relative to the default working directory. Defaults to that directory; outside paths are allowed subject to OS permissions.',
          type: 'string',
        },
        timeout_ms: timeout,
      },
      required: ['command'],
      type: 'object',
    },
  }
}

function parseMs(raw: JsonValue | undefined, name: string): number | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) return raw
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) return Number(raw.trim())
  throw invalidArgs(`\`${name}\` must be a non-negative integer`)
}

function parseEnv(raw: JsonValue | undefined): [string, string][] {
  if (raw === undefined || raw === null) return []
  if (!isObject(raw)) throw invalidArgs('`env` must be an object of string=>string')
  const out: [string, string][] = []
  for (const [k, v] of Object.entries(raw)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw invalidArgs(`invalid env key \`${k}\` (must match [A-Za-z_][A-Za-z0-9_]*)`)
    if (typeof v === 'string') out.push([k, v])
    else if (typeof v === 'number' || typeof v === 'boolean') out.push([k, String(v)])
    else if (v === null) out.push([k, ''])
    else throw invalidArgs(`env value for \`${k}\` must be string/number/bool, got ${canonicalJson(v)}`)
  }
  return out
}

function appendPathEntry(entry: string, base: string): string {
  if (!base) return entry
  return base.split(':').includes(entry) ? base : `${base}:${entry}`
}

let localSeq = 0

function sleepOrStop(ms: number): { done: Promise<'timeout'>; stop(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined
  const done = new Promise<'timeout'>(resolve => {
    timer = setTimeout(() => resolve('timeout'), Math.min(ms, 2 ** 31 - 1))
  })
  return { done, stop: () => clearTimeout(timer) }
}

function causeText(cause: string): string {
  return cause === 'finishing' ? 'the run is finishing' : cause === 'deadline' ? 'the run\'s total time limit was reached' : 'the run was interrupted'
}

/** `shell` (Rust `ShellTool` with `LocalProcessBashRunner`, wait form). */
export function shellTool(cfg: ShellToolConfig): NativeTool {
  const resolveTimeout = (raw: number | undefined) => {
    const c = raw ?? cfg.timeoutMs
    return cfg.maxTimeoutMs === 0 ? c : Math.min(Math.max(c, 1), cfg.maxTimeoutMs)
  }
  return {
    spec: shellSpec(cfg),
    idempotent: false,
    cancellable: true,
    async call(args, ctx) {
      const command = typeof args.command === 'string' ? args.command.trim() : ''
      if (!command) throw invalidArgs('`command` is required and must be non-empty')
      const rawCwd = typeof args.cwd === 'string' ? args.cwd : undefined
      const root = normalizePath(cfg.workspace)
      const cwd = await resolvePath(root, rawCwd ?? '.', cfg.restrictCwd ? [root] : [])
      if (!(await isDir(cwd))) throw invalidArgs(`cwd does not exist: ${cwd}`)
      const userEnv = parseEnv(args.env)
      const timeoutRaw = parseMs(args.timeout_ms, 'timeout_ms')
      if (timeoutRaw === 0 && cfg.maxTimeoutMs !== 0) throw invalidArgs('`timeout_ms` must be a positive integer')
      const timeoutMs = resolveTimeout(timeoutRaw)
      parseMs(args.wait_ms, 'wait_ms')

      const reqEnv = new Map<string, string>(userEnv)
      let path = (reqEnv.get('PATH') ?? deno().env.get('PATH') ?? '').trim()
      for (const e of SYSTEM_PATH_ENTRIES) path = appendPathEntry(e, path)
      reqEnv.set('PATH', path)
      if (ctx.call_id) reqEnv.set(ENV_CALL_ID, ctx.call_id)
      if (ctx.run_id) reqEnv.set(ENV_RUN_ID, ctx.run_id)
      const env: Record<string, string> = { ...cfg.env, ...Object.fromEntries(reqEnv) }
      env.PATH = [...new Set(path.split(':').filter(Boolean))].join(':')

      const bound = execDirFor(ctx.run_dir, ctx.call_id)
      const temp = bound === undefined
      const dir = bound ?? joinPath(deno().env.get('TMPDIR') || '/tmp', `llm-shell-${deno().pid}-${++localSeq}`)
      try {
        await deno().mkdir(dir, { recursive: true, mode: 0o700 })
      } catch (e) {
        throw execFailed(`execution directory: ${errorText(e)}`)
      }
      for (const stale of ['exit', 'exit.tmp']) await deno().remove(joinPath(dir, stale)).catch(() => undefined)
      let child: DenoChildProcess
      const started = performance.now()
      try {
        child = new (deno().Command)('/bin/bash', {
          args: ['-c', NATIVE_WRAPPER, command, dir], cwd, env, stdin: 'null', stdout: 'null', stderr: 'null',
        }).spawn()
      } catch (e) {
        throw execFailed(`spawn shell failed: ${errorText(e)}`)
      }
      const cleanup = async () => {
        if (temp) await deno().remove(dir, { recursive: true }).catch(() => undefined)
      }
      const kill = async (): Promise<ShellOutput> => {
        try {
          child.kill('SIGKILL')
        } catch {
          // already gone
        }
        const t = sleepOrStop(5000)
        await Promise.race([child.status, t.done])
        t.stop()
        const out = await outputFromExecDir(dir, TIMEOUT_EXIT_CODE, true, performance.now() - started, EXEC_MAX_OUTPUT_BYTES, cwd)
        await cleanup()
        return out
      }
      const timer = sleepOrStop(timeoutMs === 0 ? 365 * 24 * 3600 * 1000 : timeoutMs)
      const first = await Promise.race([
        child.status.then(s => ({ exited: s })),
        timer.done.then(() => ({ timeout: true as const })),
        ctx.call.cancelled().then(cause => ({ cancel: cause })),
      ])
      timer.stop()
      let out: ShellOutput
      if ('exited' in first) {
        out = await outputFromExecDir(dir, exitCodeOf(first.exited), false, performance.now() - started, EXEC_MAX_OUTPUT_BYTES, cwd)
        await cleanup()
      } else if ('timeout' in first) {
        out = await kill()
      } else {
        const tail = (await readFileTail(joinPath(dir, 'stdout'), OUTPUT_TAIL_BYTES)).trimEnd()
        const stopped = await kill()
        throw new NativeToolError('cancelled',
          `shell (native): \`${command}\` was stopped after ${stopped.duration_ms}ms because ${causeText(first.cancel)}. It may have had partial side effects; check before repeating it.${tail.trim() ? `\n--- output so far (tail) ---\n${tail}` : ''}`)
      }
      return shellFinishedResult(command, out, timeoutMs, cfg.maxTimeoutMs)
    },
  }
}

/** `shell_finished_result`. */
export function shellFinishedResult(command: string, out: ShellOutput, timeoutMs: number, maxTimeoutMs: number): AgentToolResult {
  if (!out.timed_out) {
    const inner = forwardInnerResult(command, out)
    if (inner) return inner
  }
  const summary = out.timed_out
    ? `timed out after ${out.duration_ms}ms (timeout_ms=${timeoutMs}); the command was stopped. Retry with a larger timeout_ms${maxTimeoutMs === 0 ? '' : ` (max ${maxTimeoutMs})`}, or start a long-lived service with nohup / setsid and return at once.`
    : `exit=${out.exit_code} in ${out.duration_ms}ms`
  const detail: JsonValue = {
    command, cwd: out.cwd, exit_code: out.exit_code, stdout: out.stdout, stderr: out.stderr, output: out.output,
    output_truncated: out.output_truncated, timed_out: out.timed_out, duration_ms: out.duration_ms, engine: LOCAL_ENGINE, runtime: 'native',
  }
  const r = builtinResult(TOOL_SHELL, detail, `${TOOL_SHELL} ${command}`, summary)
  r.status = out.exit_code === 0 && !out.timed_out ? 'success' : 'error'
  r.return_code = out.exit_code
  r.title = defaultTitle(r)
  return withOutput(r, out.output)
}
