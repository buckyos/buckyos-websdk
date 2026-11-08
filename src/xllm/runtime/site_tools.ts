// Optional basic tools for a site (TODO §2.1, a trial): what `bash_core`'s four
// tools are for files, `read` / `write` / `edit` / `exec` are for a page's
// resources and commands. REST semantics: read = GET (a collection's read is
// its list, filter with a query), write = PUT, edit = PATCH; everything REST
// cannot say is a command run by `exec` — `xcall <object> <action>` for the
// actions declared on resources (DID Object style, with `risk`), and the
// page's own commands. The four specs are fixed: more resources and commands
// cost no tokens per round. Every resource, action and command is declared by
// the page; nothing is forwarded to `fetch` or turned into a raw RPC.

import type { JsonValue } from '../core/types'
import { isObject } from '../core/json'
import { validateJson } from '../core/json_check'
import { utf8Length } from '../core/tokenizer'
import type { SiteTool, SiteToolCtx } from './types'
import {
  CommandArgsError, parseArgv, parseShellLine, validateSchema,
} from '../../internal/command_args'
import type { AccessLevel, JsonSchema, OptionDefinition, PositionalDefinition } from '../../internal/command_args'

export type ActionRisk = 'read_only' | 'idempotent_write' | 'write' | 'destructive' | 'admin'
export const ACTION_RISKS: ActionRisk[] = ['read_only', 'idempotent_write', 'write', 'destructive', 'admin']

export const XCALL_USAGE = 'xcall <object> <action> [--params <json>] [key=value ...] [--key=value ...]'
/** Result text cap of `read` (one page) and `exec`. */
export const MAX_RESULT_BYTES = 64 * 1024

/** What a resource method gets: the URI as normalized, the `{name}` parameters, the query. */
export interface ResourceMatch {
  uri: string
  pattern: string
  params: Record<string, string>
  query: URLSearchParams
  ctx: SiteToolCtx
}

/** A read may return a version: `write` (and the default `edit`) gets it back as `ifVersion`. */
export interface Versioned {
  content: unknown
  version?: string
}

export interface WriteBody {
  content: string
  mode: 'write' | 'new' | 'append'
  ifVersion?: string
}

export interface ActionDecl {
  description: string
  risk: ActionRisk
  /** JSON Schema of the params. */
  input?: JsonValue
  call(m: ResourceMatch, params: Record<string, JsonValue>): unknown
}

export interface ResourceDecl {
  description: string
  read?(m: ResourceMatch): unknown
  write?(m: ResourceMatch, body: WriteBody): unknown
  edit?(m: ResourceMatch, body: { old_string: string; new_string: string }): unknown
  actions?: Record<string, ActionDecl>
}

/** A page command: a subset of the CLI `CommandDefinition`; `call(input)` replaces its handler. */
export interface CommandDecl {
  summary: string
  description?: string
  positionals?: PositionalDefinition[]
  options?: OptionDefinition[]
  inputSchema?: JsonSchema
  access?: { mode: 'fixed'; level: AccessLevel }
  examples?: string[]
  call(input: Record<string, unknown>, ctx: SiteToolCtx): unknown
}

export interface SiteToolsOptions {
  resources?: Record<string, ResourceDecl>
  commands?: Record<string, CommandDecl>
}

const LOCAL_BASE = 'site://page/'
const SHELL_CHARS = /[|;&><`$]/

interface Pattern {
  raw: string
  origin?: string
  segments: string[]
  decl: ResourceDecl
}

function parsePattern(raw: string, decl: ResourceDecl): Pattern {
  const i = raw.indexOf('://')
  if (i >= 0) {
    const rest = raw.slice(i + 3)
    const slash = rest.indexOf('/')
    const host = slash < 0 ? rest : rest.slice(0, slash)
    const path = slash < 0 ? '' : rest.slice(slash + 1)
    return { raw, origin: `${raw.slice(0, i).toLowerCase()}://${host.toLowerCase()}`, segments: path ? path.split('/') : [], decl }
  }
  const path = raw.replace(/^\/+/, '').replace(/\/+$/, '')
  return { raw, segments: path ? path.split('/') : [], decl }
}

function fail(message: string): never {
  throw new Error(message)
}

/** Normalize a URI the model gave: relative paths and declared absolute origins only, no `..`, no encoded separators. */
export function normalizeUri(uri: string, origins: Set<string>): { origin?: string; segments: string[]; query: URLSearchParams; text: string } {
  const raw = uri.trim()
  if (!raw) fail('uri is empty')
  const absolute = /^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw)
  let url: URL
  try {
    url = absolute ? new URL(raw) : new URL(raw.replace(/^\/+/, ''), LOCAL_BASE)
  } catch {
    fail(`invalid uri \`${raw}\``)
  }
  let origin: string | undefined
  if (absolute) {
    origin = `${url.protocol.slice(0, -1).toLowerCase()}://${url.host.toLowerCase()}`
    if (!origins.has(origin)) fail(`uri \`${raw}\` is not a resource of this page (absolute URIs are limited to the declared ones)`)
  } else if (url.protocol !== 'site:' || url.host !== 'page') {
    fail(`uri \`${raw}\` is not a resource of this page`)
  }
  const segments: string[] = []
  for (const part of url.pathname.split('/')) {
    if (part === '') continue
    let decoded: string
    try {
      decoded = decodeURIComponent(part)
    } catch {
      fail(`invalid uri \`${raw}\``)
    }
    if (decoded === '..' || decoded === '.' || decoded.includes('/') || decoded.includes('\\')) fail(`uri \`${raw}\` is not a resource of this page`)
    segments.push(decoded)
  }
  const text = (origin ? `${origin}/` : '') + segments.join('/') + (url.search || '')
  return { origin, segments, query: url.searchParams, text }
}

function matchPattern(p: Pattern, origin: string | undefined, segments: string[]): Record<string, string> | undefined {
  if (p.origin !== origin || p.segments.length !== segments.length) return undefined
  const params: Record<string, string> = {}
  for (let i = 0; i < segments.length; i++) {
    const s = p.segments[i]
    if (s.startsWith('{') && s.endsWith('}')) params[s.slice(1, -1)] = segments[i]
    else if (s !== segments[i]) return undefined
  }
  return params
}

function asText(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function versioned(value: unknown): { text: string; version?: string } {
  if (isObject(value) && 'content' in value && Object.keys(value).every(k => k === 'content' || k === 'version')) {
    const version = value.version
    return { text: asText(value.content), version: typeof version === 'string' ? version : version === undefined ? undefined : String(version) }
  }
  return { text: asText(value) }
}

function clipBytes(text: string, max: number): { text: string; clipped: boolean } {
  if (utf8Length(text) <= max) return { text, clipped: false }
  let out = ''
  let bytes = 0
  for (const ch of text) {
    const n = utf8Length(ch)
    if (bytes + n > max) break
    out += ch
    bytes += n
  }
  return { text: out, clipped: true }
}

/** One page of a text by lines: `offset` is the 1-based first line. */
export function pageText(text: string, offset = 1, limit?: number): string {
  const lines = text.split('\n')
  const start = Math.max(1, Math.floor(offset))
  if (start > lines.length && !(start === 1 && lines.length === 1)) return `[offset ${start} is past the end: ${lines.length} lines]`
  const wanted = limit === undefined ? lines.length : Math.max(1, Math.floor(limit))
  const out: string[] = []
  let bytes = 0
  let i = start - 1
  for (; i < lines.length && out.length < wanted; i++) {
    const n = utf8Length(lines[i]) + 1
    if (out.length > 0 && bytes + n > MAX_RESULT_BYTES) break
    out.push(lines[i])
    bytes += n
  }
  let body = out.join('\n')
  if (out.length === 1 && utf8Length(body) > MAX_RESULT_BYTES) body = clipBytes(body, MAX_RESULT_BYTES).text + ' …'
  if (i < lines.length) body += `\n[lines ${start}–${i} of ${lines.length}; read on with offset=${i + 1}]`
  return body
}

function parseScalar(raw: string): JsonValue {
  const v = raw.trim()
  if (v === 'true') return true
  if (v === 'false') return false
  if (v === 'null') return null
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(v)) return Number(v)
  if (v.startsWith('{') || v.startsWith('[')) {
    try {
      return JSON.parse(v)
    } catch {
      return v
    }
  }
  return v
}

const UNSUPPORTED_XCALL_KEYS = ['config', 'route-config', 'session-id', 'session_id', 'idempotency-key', 'idempotency_key',
  'confirm-token', 'confirm_token', 'trace-id', 'trace_id']

/** `xcall` arguments as Rust parses them (`parse_object_x_call_cli_command`), minus routing and confirmation flags. */
function parseXcall(tokens: string[]): { object: string; action: string; params: Record<string, JsonValue> } {
  let object: string | undefined
  let action: string | undefined
  let params: JsonValue = {}
  const pairs: Record<string, JsonValue> = {}
  const positionals: string[] = []
  const json = (raw: string, name: string): JsonValue => {
    try {
      return JSON.parse(raw)
    } catch (e) {
      fail(`invalid \`${name}\` JSON value \`${raw}\`: ${e instanceof Error ? e.message : String(e)}\nusage: ${XCALL_USAGE}`)
    }
  }
  const unsupported = (t: string): never => fail(`unsupported flag \`${t}\` (routing and confirmation are the page's)\nusage: ${XCALL_USAGE}`)
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t === '--params') {
      const v = tokens[++i]
      if (v === undefined) fail(`missing value for --params\nusage: ${XCALL_USAGE}`)
      params = json(v, '--params')
    } else if (t.startsWith('--')) {
      const eq = t.indexOf('=')
      if (eq < 0) unsupported(t)
      const key = t.slice(2, eq)
      const value = t.slice(eq + 1)
      if (key === 'params') params = json(value, '--params')
      else if (!key.trim() || key.startsWith('-') || UNSUPPORTED_XCALL_KEYS.includes(key)) unsupported(t)
      else pairs[key] = parseScalar(value)
    } else if (t.includes('=')) {
      const eq = t.indexOf('=')
      const key = t.slice(0, eq)
      const value = t.slice(eq + 1)
      if (key === 'object') object = value
      else if (key === 'action') action = value
      else if (key === 'params') params = json(value, 'params')
      else if (UNSUPPORTED_XCALL_KEYS.includes(key)) unsupported(t)
      else pairs[key] = parseScalar(value)
    } else {
      positionals.push(t)
    }
  }
  object = object ?? positionals[0]
  action = action ?? positionals[1]
  if (positionals[2] !== undefined) params = json(positionals[2], 'params')
  if (positionals.length > 3) fail(`unexpected positional argument \`${positionals[3]}\`\nusage: ${XCALL_USAGE}`)
  if (Object.keys(pairs).length) {
    if (!isObject(params)) fail(`key=value params require object params\nusage: ${XCALL_USAGE}`)
    params = { ...params, ...pairs }
  }
  if (!object || !action) fail(`xcall needs an object and an action\nusage: ${XCALL_USAGE}`)
  if (!isObject(params)) fail(`params must be a JSON object\nusage: ${XCALL_USAGE}`)
  return { object, action, params }
}

function commandUsage(name: string, c: CommandDecl): string {
  const lines = [`${name} — ${c.summary}`]
  if (c.description) lines.push('', c.description)
  const pos = (c.positionals ?? []).map(p => (p.required === false ? `[${p.name}]` : `<${p.name}>`)).join(' ')
  lines.push('', `usage: ${name}${pos ? ` ${pos}` : ''}${(c.options ?? []).length ? ' [options]' : ''}`)
  for (const p of c.positionals ?? []) lines.push(`  ${p.name}  ${p.description}`)
  if ((c.options ?? []).length) lines.push('options:')
  for (const o of c.options ?? []) {
    lines.push(`  --${o.name}${o.type === 'boolean' ? '' : ` <${o.type}>`}${o.required ? ' (required)' : ''}  ${o.description}${o.enum ? ` (${o.enum.join(' | ')})` : ''}`)
  }
  if (c.examples?.length) {
    lines.push('examples:')
    for (const e of c.examples) lines.push(`  ${e}`)
  }
  return lines.join('\n')
}

const OBJECT_ARGS = (props: Record<string, JsonValue>, required: string[]): JsonValue => ({ type: 'object', properties: props, required })

/**
 * The four basic tools over the page's resources and commands. Spread them
 * into `createSiteRuntime({ tools })`, alongside named tools if wanted.
 */
export function siteTools(options: SiteToolsOptions): Record<string, SiteTool> {
  const patterns = Object.entries(options.resources ?? {}).map(([raw, decl]) => parsePattern(raw, decl))
  const origins = new Set(patterns.map(p => p.origin).filter((o): o is string => o !== undefined))
  const commands = new Map(Object.entries(options.commands ?? {}))
  if (commands.has('xcall')) throw new Error('siteTools: `xcall` is built in; declare actions on resources instead')

  const resolve = (uri: string, ctx: SiteToolCtx): ResourceMatch & { decl: ResourceDecl } => {
    const n = normalizeUri(uri, origins)
    for (const p of patterns) {
      const params = matchPattern(p, n.origin, n.segments)
      if (params) return { uri: n.text, pattern: p.raw, params, query: n.query, ctx, decl: p.decl }
    }
    fail(`uri \`${uri}\` is not a resource of this page; read uri="/" lists them`)
  }

  const discovery = (): string => {
    const lines = ['Resources (read uri="<resource>"; {name} is one path segment):']
    for (const p of patterns) {
      const methods = (['read', 'write', 'edit'] as const).filter(m => m === 'edit' ? !!(p.decl.edit || (p.decl.read && p.decl.write)) : !!p.decl[m])
      lines.push(`- ${p.raw} — ${p.decl.description} [${methods.join(', ') || 'no methods'}]`)
      for (const [name, a] of Object.entries(p.decl.actions ?? {})) lines.push(`  action ${name} (risk: ${a.risk}) — ${a.description}`)
    }
    if (patterns.length === 0) lines.push('(none)')
    lines.push('', 'Commands (exec "<command> --help" for usage):')
    lines.push(`- xcall — call an action of a resource: ${XCALL_USAGE}`)
    for (const [name, c] of commands) lines.push(`- ${name} — ${c.summary}`)
    return lines.join('\n')
  }

  const exec = async (command: string, ctx: SiteToolCtx): Promise<string> => {
    const words = (() => {
      try {
        return parseShellLine(command)
      } catch (e) {
        fail(`${e instanceof Error ? e.message : String(e)}; exec runs one command, it is not a shell`)
      }
    })()
    const available = `available commands: xcall${commands.size ? `, ${[...commands.keys()].join(', ')}` : ''}`
    const unquoted = command.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, '')
    if (SHELL_CHARS.test(unquoted)) {
      fail(`exec runs exactly one command and is not a shell: pipes, redirects, \`;\`, \`&\`, backquotes and \`$\` are not supported (quote them to pass them as text). ${available}`)
    }
    const [name, ...args] = words
    if (!name) fail(`empty command; ${available}`)
    if (name === 'xcall') {
      if (args.includes('--help') || args.includes('-h')) return `usage: ${XCALL_USAGE}\nThe actions of each resource are listed by read uri="/".`
      const { object, action, params } = parseXcall(args)
      const m = resolve(object, ctx)
      const decl = m.decl.actions?.[action]
      if (!decl) {
        const known = Object.keys(m.decl.actions ?? {})
        fail(`resource \`${m.pattern}\` has no action \`${action}\` (actions: ${known.length ? known.join(', ') : 'none'})`)
      }
      if (decl.input !== undefined) {
        const invalid = validateJson(decl.input, params)
        if (invalid) fail(`invalid params for ${action}: ${invalid}`)
      }
      const { decl: _decl, ...match } = m
      void _decl
      const result = await decl.call(match, params)
      return `[risk: ${decl.risk}]\n${clipBytes(asText(result) || 'ok', MAX_RESULT_BYTES).text}`
    }
    const c = commands.get(name)
    if (!c) fail(`unknown command \`${name}\`; exec runs one command, it is not a shell. ${available}`)
    let input: Record<string, unknown>
    try {
      const parsed = parseArgv({ positionals: c.positionals, options: c.options }, args)
      if (parsed.help) return commandUsage(name, c)
      for (let i = parsed.positionalCount; i < (c.positionals ?? []).length; i++) {
        if ((c.positionals ?? [])[i].required !== false) throw new CommandArgsError('MISSING_ARGUMENT', `missing positional argument: ${(c.positionals ?? [])[i].name}`)
      }
      for (const o of c.options ?? []) {
        const prop = o.property ?? o.name.split('-').join('_')
        if (o.required && !(prop in parsed.input)) throw new CommandArgsError('MISSING_ARGUMENT', `--${o.name} is required`)
      }
      input = parsed.input
      if (c.inputSchema) validateSchema(input, c.inputSchema, 'input')
    } catch (e) {
      if (e instanceof CommandArgsError) fail(`${name}: ${e.message}\n\n${commandUsage(name, c)}`)
      throw e
    }
    return clipBytes(asText(await c.call(input, ctx)) || 'ok', MAX_RESULT_BYTES).text
  }

  const readRaw = async (m: ResourceMatch & { decl: ResourceDecl }) => {
    if (!m.decl.read) fail(`resource \`${m.pattern}\` cannot be read`)
    const { decl: _d, ...match } = m
    void _d
    return versioned(await m.decl.read(match))
  }

  return {
    read: {
      spec: {
        description: 'Read a resource of this page by URI (GET). Start with uri "/": it lists the resources, their actions (with risk) and the commands. A collection\'s read is its list; filter and page with a query (notes?tag=x). Text comes in pages of lines: offset is the first line (1-based), limit the number of lines.',
        args_schema: OBJECT_ARGS({
          uri: { type: 'string', description: 'Resource URI, e.g. "/" or "notes/1"' },
          offset: { type: 'integer', description: 'First line, 1-based' },
          limit: { type: 'integer', description: 'Number of lines' },
        }, ['uri']),
      },
      idempotent: true,
      async call(args, ctx) {
        const uri = String(args.uri)
        const offset = typeof args.offset === 'number' ? args.offset : undefined
        const limit = typeof args.limit === 'number' ? args.limit : undefined
        if (uri.trim() === '/' || uri.trim() === '') return pageText(discovery(), offset, limit)
        const r = await readRaw(resolve(uri, ctx))
        return pageText(r.text, offset, limit)
      },
    },
    write: {
      spec: {
        description: 'Write a resource\'s content (PUT). mode: "write" (default) replaces it, "new" only creates it and fails if it exists, "append" adds to its end. Use edit to change part of it.',
        args_schema: OBJECT_ARGS({
          uri: { type: 'string', description: 'Resource URI' },
          content: { type: 'string', description: 'The content' },
          mode: { type: 'string', enum: ['write', 'new', 'append'], description: 'write | new | append' },
        }, ['uri', 'content']),
      },
      async call(args, ctx) {
        const m = resolve(String(args.uri), ctx)
        if (!m.decl.write) fail(`resource \`${m.pattern}\` is read-only`)
        const { decl, ...match } = m
        const mode = (typeof args.mode === 'string' ? args.mode : 'write') as WriteBody['mode']
        return asText(await decl.write!(match, { content: String(args.content), mode })) || 'written'
      },
    },
    edit: {
      spec: {
        description: 'Change part of a resource (PATCH): old_string must occur exactly once in its current content and is replaced by new_string.',
        args_schema: OBJECT_ARGS({
          uri: { type: 'string', description: 'Resource URI' },
          old_string: { type: 'string', description: 'Text to replace; must occur exactly once' },
          new_string: { type: 'string', description: 'Replacement text' },
        }, ['uri', 'old_string', 'new_string']),
      },
      async call(args, ctx) {
        const m = resolve(String(args.uri), ctx)
        const body = { old_string: String(args.old_string), new_string: String(args.new_string) }
        const { decl, ...match } = m
        if (decl.edit) return asText(await decl.edit(match, body)) || 'edited'
        if (!decl.read || !decl.write) fail(`resource \`${m.pattern}\` cannot be edited`)
        if (!body.old_string) fail('old_string is empty')
        const current = versioned(await decl.read(match))
        const count = current.text.split(body.old_string).length - 1
        if (count === 0) fail('old_string was not found in the current content; read it again')
        if (count > 1) fail(`old_string occurs ${count} times; give more context so it occurs exactly once`)
        const content = current.text.replace(body.old_string, () => body.new_string)
        const w: WriteBody = { content, mode: 'write' }
        if (current.version !== undefined) w.ifVersion = current.version
        return asText(await decl.write(match, w)) || 'edited'
      },
    },
    exec: {
      spec: {
        description: `Run one command (not a shell: no pipes, redirects, ;, &, backquotes or $). Built in: ${XCALL_USAGE} — calls an action listed by read uri="/". The page's commands are listed there too; "<command> --help" shows a command's usage.`,
        args_schema: OBJECT_ARGS({ command: { type: 'string', description: 'One command line' } }, ['command']),
      },
      idempotent: (args: Record<string, JsonValue>) => execIsIdempotent(String(args.command ?? ''), patterns, origins, commands),
      call: (args, ctx) => exec(String(args.command), ctx),
    },
  }
}

/** Resume rule of `exec`: `xcall` re-runs `read_only` / `idempotent_write` actions, commands re-run at `access: read`. */
function execIsIdempotent(command: string, patterns: Pattern[], origins: Set<string>, commands: Map<string, CommandDecl>): boolean {
  let words: string[]
  try {
    words = parseShellLine(command)
  } catch {
    return false
  }
  const [name, ...args] = words
  if (name === 'xcall') {
    try {
      const { object, action } = parseXcall(args)
      const n = normalizeUri(object, origins)
      const p = patterns.find(q => matchPattern(q, n.origin, n.segments))
      const risk = p?.decl.actions?.[action]?.risk
      return risk === 'read_only' || risk === 'idempotent_write'
    } catch {
      return false
    }
  }
  const c = name ? commands.get(name) : undefined
  return c?.access?.level === 'read'
}

