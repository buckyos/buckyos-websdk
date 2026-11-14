import {
  AIWS_MANIFEST_FILE,
  AIWS_MANIFEST_VERSION,
  AiwsFailure,
  AiwsSourceError,
  aiwsTarget,
  buildControl,
  commitOps,
  exportBundle,
  fieldAdd,
  isSourcePath,
  move,
  NfspClient,
  optionAdd,
  packBuildFiles,
  pullControl,
  rename,
  setProps,
  tableDelete,
  tableInsert,
  tableSet,
  templateDir,
  textAppend,
  textDeleteBlocks,
  textReplaceBlock,
  watchControl,
} from 'buckyos/node'
import { AiccLlmClient, LLMComputeException, providerErrorFromRpc } from 'buckyos/xllm'
import type { CommandDefinition, CommandModule, JsonSchema, OptionDefinition, PositionalDefinition } from '../core/command.ts'
import type { CommandContext } from '../core/context.ts'
import { EXIT_AUTH, ToolError, UsageError } from '../core/errors.ts'
import { callService, expectObject, inputString, requiredInputString, rpcOptions } from '../core/service.ts'
import { getHost } from '../runtime/host.ts'
import { createPikgModule } from './pikg.ts'
import { calCommand, todoCommand } from './aiws_schedule.ts'
import { placeCommand } from './aiws_place.ts'
import { gatewayOrigin } from './share.ts'

// AI Workspace (`/kapi/aiworkspace`): finding, reading, querying and writing a workspace (ls, find, grep, stat, cat,
// resolve, sql; table, text, mv, rename, set-prop: buckyos notepads/aiws-core-api-design.md §9), and the executor
// protocol of a wish run (内核架构改进 M3): claim → heartbeat → report. Source of truth for the methods:
// buckyos/src/frame/aiworkspace/README.md (Protocol).
const SERVICE = 'aiworkspace'
const OBJECT_OUTPUT: JsonSchema = { type: 'object', additionalProperties: true }
const WORKSPACE_OPTION: OptionDefinition = { name: 'workspace', property: 'workspace_id', description: 'Workspace id (ws_…)', type: 'string', required: true }
const RUN_OPTION: OptionDefinition = { name: 'run', property: 'run_id', description: 'Run id (run_…)', type: 'string', required: true }
const ATTEMPT_OPTION: OptionDefinition = { name: 'attempt', property: 'attempt', description: 'The attempt number `run-claim` answered', type: 'integer', required: true }

function workspaceInput(extra: Record<string, JsonSchema>, required: string[] = []): JsonSchema {
  return { type: 'object', properties: { workspace_id: { type: 'string', minLength: 1 }, ...extra }, required: ['workspace_id', ...required], additionalProperties: false }
}

async function aiws(ctx: CommandContext, method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = expectObject(await callService<unknown>(ctx, SERVICE, method, params), method)
  if (result.ok === false) {
    const error = expectObject(result.error, `${method}.error`)
    const code = typeof error.code === 'string' ? error.code : 'AIWS_ERROR'
    const detail = typeof error.detail === 'string' ? error.detail : code
    // the structured part (a build's diagnostics, a conflict's revisions) travels in the error's details
    const details: Record<string, unknown> = {}
    if (typeof error.sub_code === 'string') details.sub_code = error.sub_code
    if (error.data !== undefined) details.data = error.data
    throw new ToolError(code, `${code}${typeof error.sub_code === 'string' ? `/${error.sub_code}` : ''}: ${detail}`, undefined, false, details)
  }
  return result
}

async function jsonInput(input: Record<string, unknown>, textKey: string, fileKey: string, label: string): Promise<unknown> {
  const text = inputString(input, textKey)
  const file = inputString(input, fileKey)
  if (text && file) throw new UsageError('AIWS_USAGE', `${textKey} and ${fileKey} are exclusive`)
  if (file) return JSON.parse(await getHost().readTextFile(file)) as unknown
  if (text) return JSON.parse(text) as unknown
  throw new UsageError('AIWS_USAGE', `${label}: pass --${textKey.replace(/_/g, '-')} or --${fileKey.replace(/_/g, '-')}`)
}

// ---- finding and reading. An entity argument is a path (`/data/销售`, `~<entity_id>/…`) or an entity id.

const PATH_HELP = 'Path (/data/销售, ~<entity_id>/…) or entity id'
const TYPE_OPTIONS: OptionDefinition[] = [
  { name: 'type', property: 'type', description: 'Only these types, comma-separated: table, richtext, record, annotation, block, container (container:<kind>), asset, dir, wish, def, …', type: 'string' },
  { name: 'not-type', property: 'not_type', description: 'Leave these types out, comma-separated', type: 'string' },
]
const CURSOR_OPTION: OptionDefinition = { name: 'cursor', property: 'cursor', description: 'Continue from the next_cursor of a previous page', type: 'string' }
const READ_ACCESS = { mode: 'fixed', level: 'read' } as const
const WRITE_ACCESS = { mode: 'fixed', level: 'write' } as const

/** The keys of `input` that are given, renamed by `names` ({ input key: param }). */
function given(input: Record<string, unknown>, names: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, param] of Object.entries(names)) {
    const v = input[key]
    if (typeof v === 'string' ? v.trim() !== '' : v !== undefined && v !== false) out[param] = typeof v === 'string' ? v.trim() : v
  }
  return out
}

function jsonArg(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new UsageError('AIWS_USAGE', `${label}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const readCommand: CommandDefinition = {
  verb: 'read',
  summary: 'Read one entity of a workspace: envelope and native content',
  positionals: [{ name: 'entity_id', description: PATH_HELP, required: true } satisfies PositionalDefinition],
  options: [WORKSPACE_OPTION, { name: 'selector', property: 'selector', description: 'Selector JSON, e.g. {"kind":"table_record","record_id":"r1"}', type: 'string' }],
  inputSchema: workspaceInput({ entity_id: { type: 'string', minLength: 1 }, selector: { type: 'string' } }, ['entity_id']),
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: READ_ACCESS,
  asyncMode: 'sync',
  requiresSession: true,
  examples: ['buckyos aiws read orders --workspace ws_abc', 'buckyos aiws read /data/订单 --workspace ws_abc --selector \'{"kind":"table_record","record_id":"r1"}\''],
  handler: (ctx, input) => {
    const selector = inputString(input, 'selector')
    return aiws(ctx, 'doc.read', { workspace_id: requiredInputString(input, 'workspace_id'), ...aiwsTarget(requiredInputString(input, 'entity_id')), ...(selector ? { selector: jsonArg(selector, '--selector') } : {}) })
  },
}

const lsCommand: CommandDefinition = {
  verb: 'ls',
  summary: 'The direct children of a path (default /), in tree order: name, path, type, title, children, body state',
  positionals: [{ name: 'path', description: `${PATH_HELP} (default /)`, required: false }],
  options: [WORKSPACE_OPTION, ...TYPE_OPTIONS, { name: 'schema', property: 'schema', description: 'Only entities of this schema id, e.g. buckyos.todo@1', type: 'string' }, { name: 'limit', property: 'limit', description: 'Items per page (≤ 1000, default 100)', type: 'integer' }, CURSOR_OPTION],
  inputSchema: workspaceInput({ path: { type: 'string' }, type: { type: 'string' }, not_type: { type: 'string' }, schema: { type: 'string' }, limit: { type: 'integer', minimum: 1 }, cursor: { type: 'string' } }),
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: READ_ACCESS,
  asyncMode: 'sync',
  requiresSession: true,
  examples: ['buckyos aiws ls --workspace ws_abc', 'buckyos aiws ls /data --workspace ws_abc --type table'],
  handler: (ctx, input) => aiws(ctx, 'doc.list', { workspace_id: requiredInputString(input, 'workspace_id'), ...given(input, { path: 'at', type: 'type', not_type: 'not_type', schema: 'schema', limit: 'limit', cursor: 'cursor' }) }),
}

const findCommand: CommandDefinition = {
  verb: 'find',
  summary: 'Entities whose name or title holds a literal (case-insensitive), by type and schema, walking down from a path',
  description: 'A pre-order walk of at most 20 000 entities per call: when `complete` is false, continue with --cursor. Without text it finds by --type / --schema only.',
  positionals: [{ name: 'text', description: 'Literal looked for in names and titles', required: false }],
  options: [WORKSPACE_OPTION, { name: 'at', property: 'at', description: `Where to start: ${PATH_HELP} (default /)`, type: 'string' }, { name: 'depth', property: 'depth', description: 'Levels below --at (≤ 16)', type: 'integer' }, ...TYPE_OPTIONS, { name: 'schema', property: 'schema', description: 'Only entities of this schema id', type: 'string' }, { name: 'limit', property: 'limit', description: 'Items per page (≤ 200, default 50)', type: 'integer' }, CURSOR_OPTION],
  inputSchema: workspaceInput({ text: { type: 'string' }, at: { type: 'string' }, depth: { type: 'integer', minimum: 1 }, type: { type: 'string' }, not_type: { type: 'string' }, schema: { type: 'string' }, limit: { type: 'integer', minimum: 1 }, cursor: { type: 'string' } }),
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: READ_ACCESS,
  asyncMode: 'sync',
  requiresSession: true,
  examples: ['buckyos aiws find 销售 --workspace ws_abc', 'buckyos aiws find --workspace ws_abc --type table --at /data'],
  handler: (ctx, input) => aiws(ctx, 'doc.find', { workspace_id: requiredInputString(input, 'workspace_id'), ...given(input, { text: 'name', at: 'at', depth: 'depth', type: 'type', not_type: 'not_type', schema: 'schema', limit: 'limit', cursor: 'cursor' }) }),
}

const grepCommand: CommandDefinition = {
  verb: 'grep',
  summary: 'A literal (1–256 characters) in names, titles and bodies (the plain-text rendering of each entity): hits with a snippet and the selector of the part',
  description: 'Literal match, case-insensitive unless --case; no regex. An empty result means “none” only when coverage.complete is true; otherwise continue with --cursor. Annotations, viewports, paths, tasks, responses and results are searched only when named in --type.',
  positionals: [{ name: 'text', description: 'Literal to look for', required: true }],
  options: [WORKSPACE_OPTION, { name: 'at', property: 'at', description: `Where to search: ${PATH_HELP} (default /)`, type: 'string' }, { name: 'depth', property: 'depth', description: 'Levels below --at', type: 'integer' }, { name: 'case', property: 'case', description: 'Compare case-sensitively', type: 'boolean' }, ...TYPE_OPTIONS, { name: 'limit', property: 'limit', description: 'Hits per page (≤ 100, default 20)', type: 'integer' }, CURSOR_OPTION],
  inputSchema: workspaceInput({ text: { type: 'string', minLength: 1 }, at: { type: 'string' }, depth: { type: 'integer', minimum: 1 }, case: { type: 'boolean' }, type: { type: 'string' }, not_type: { type: 'string' }, limit: { type: 'integer', minimum: 1 }, cursor: { type: 'string' } }, ['text']),
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: READ_ACCESS,
  asyncMode: 'sync',
  requiresSession: true,
  examples: ['buckyos aiws grep 华东 --workspace ws_abc', 'buckyos aiws grep "Q4 plan" --workspace ws_abc --at /docs --type richtext'],
  handler: (ctx, input) => aiws(ctx, 'doc.query', { workspace_id: requiredInputString(input, 'workspace_id'), text: requiredInputString(input, 'text'), ...given(input, { at: 'at', depth: 'depth', case: 'case', type: 'type', not_type: 'not_type', limit: 'limit', cursor: 'cursor' }) }),
}

// ---- permissions (buckyos notepads/aiws-permission-system-prd.md §4; README “Permissions”): entries `subject × resource
// → allow, deny` addressed by path, logical groups, anonymous access, inner-path publications, the operation record.
const SUBJECT_HELP = 'A principal (user id, DID), @<group>, @all, @guest or @creator'
const caps = (text: string | undefined): string[] => (text ? ids(text) : [])

const aclCommand: CommandDefinition = {
  verb: 'acl',
  summary: 'Read permissions: `ls` (every entry, or your own), `show <path>` (who holds what on it and from where), `who [subject]` (a subject\'s entries; a principal\'s groups), `explain <path> [--principal]` (why each capability is allowed or refused), `groups`, `entries` (share links), `audit` (the operation record)',
  description: 'Entries are decided by the nearest layer (the entity, its ancestors, then /) that mentions a capability, then by the most specific tier (a single caller, then groups and @creator, then @guest and @all); a deny wins within a tier. Anyone may ask about themselves (who, explain); the rest needs manage.',
  positionals: [
    { name: 'action', description: 'ls | show | who | explain | groups | entries | audit', required: true },
    { name: 'target', description: `show / explain: ${PATH_HELP} (default /); who: ${SUBJECT_HELP}`, required: false },
  ],
  options: [
    WORKSPACE_OPTION,
    { name: 'principal', property: 'principal', description: 'explain: whose permissions (default: yours; another\'s needs manage)', type: 'string' },
    { name: 'expand', property: 'expand', description: 'show: list the members of each group', type: 'boolean' },
    { name: 'after', property: 'after', description: 'audit: records after this sequence number', type: 'integer' },
    { name: 'limit', property: 'limit', description: 'audit: at most this many records (≤ 1000)', type: 'integer' },
  ],
  inputSchema: workspaceInput({
    action: { type: 'string', enum: ['ls', 'show', 'who', 'explain', 'groups', 'entries', 'audit'] }, target: { type: 'string' }, principal: { type: 'string' },
    expand: { type: 'boolean' }, after: { type: 'integer' }, limit: { type: 'integer', minimum: 1 },
  }, ['action']),
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: READ_ACCESS,
  asyncMode: 'sync',
  requiresSession: true,
  examples: [
    'buckyos aiws acl show /data/成绩 --workspace ws_abc',
    'buckyos aiws acl explain /data/成绩 --principal bob --workspace ws_abc',
    'buckyos aiws acl who @teachers --workspace ws_abc',
    'buckyos aiws acl groups --workspace ws_abc',
  ],
  handler: (ctx, input) => {
    const workspace_id = requiredInputString(input, 'workspace_id')
    const target = inputString(input, 'target')
    switch (requiredInputString(input, 'action')) {
      case 'ls': return aiws(ctx, 'acl.query', { workspace_id, by: 'all' })
      case 'show': return aiws(ctx, 'acl.query', { workspace_id, by: 'entity', resource: target ?? '/', ...given(input, { expand: 'expand' }) })
      case 'who': return aiws(ctx, 'acl.query', { workspace_id, by: 'subject', ...(target ? { subject: target } : {}) })
      case 'explain': return aiws(ctx, 'acl.query', { workspace_id, by: 'explain', resource: target ?? '/', ...given(input, { principal: 'principal' }) })
      case 'groups': return aiws(ctx, 'acl.groups', { workspace_id })
      case 'entries': return aiws(ctx, 'ws.list_entries', { workspace_id })
      case 'audit': return aiws(ctx, 'acl.audit', { workspace_id, ...given(input, { after: 'after', limit: 'limit' }) })
      default: throw new UsageError('AIWS_USAGE', 'acl: ls, show, who, explain, groups, entries or audit')
    }
  },
}

const aclEditCommand: CommandDefinition = {
  verb: 'acl-edit',
  summary: 'Change permissions: `set <subject> <path> --allow … --deny …` (replaces that entry; both empty removes it), `rm <subject> <path>`, `group-add <id> [--title]`, `group-rm <id>`, `member-add <group> <members>`, `member-rm <group> <members>`, `anonymous on|off`, `bind <wish> <group|none> [--mode]`, `entry-add <group> --methods …`, `entry-close <entry_id> [--remove-members]`, `publish <path> [--name]`, `unpublish <path>`',
  description: 'Needs manage (giving or taking manage, or changing the members of a group holding it, is the owner\'s). Members: a principal, group:<system group>, contact:<your did>#<tag>, * (every unrestricted account of the Zone); a group is never a member of a group. @all and @guest never get manage or run; @guest exists only while anonymous access is on. A share entry leads into a group holding neither manage nor run.',
  positionals: [
    { name: 'action', description: 'set | rm | group-add | group-rm | member-add | member-rm | anonymous | bind | entry-add | entry-close | publish | unpublish', required: true },
    { name: 'target', description: `set / rm: ${SUBJECT_HELP}; group-*, member-*, entry-add: group id; anonymous: on | off; bind, publish, unpublish: ${PATH_HELP}; entry-close: entry id`, required: false },
    { name: 'arg', description: `set / rm: ${PATH_HELP} (default /); member-*: members, comma-separated; bind: group id or none`, required: false },
  ],
  options: [
    WORKSPACE_OPTION,
    { name: 'allow', property: 'allow', description: 'set: capabilities, comma-separated (read, append, update, delete, structure, comment, export, manage, run)', type: 'string' },
    { name: 'deny', property: 'deny', description: 'set: capabilities refused, comma-separated', type: 'string' },
    { name: 'title', property: 'title', description: 'group-add: the group\'s title', type: 'string' },
    { name: 'description', property: 'description', description: 'group-add: what the group is for', type: 'string' },
    { name: 'mode', property: 'mode', description: 'bind: union (default) or intersection with the triggerer\'s permissions', type: 'string', enum: ['union', 'intersection'] },
    { name: 'methods', property: 'methods', description: 'entry-add: ways in, comma-separated: guest, password, self_register, did_login', type: 'string' },
    { name: 'expires-at', property: 'expires_at', description: 'entry-add: unix seconds', type: 'integer' },
    { name: 'max-joins', property: 'max_joins', description: 'entry-add: how many may join at most', type: 'integer' },
    { name: 'remove-members', property: 'remove_members', description: 'entry-close: those who joined through it leave the group too', type: 'boolean' },
    { name: 'name', property: 'name', description: 'publish: the last segment of the link', type: 'string' },
  ],
  inputSchema: workspaceInput({
    action: { type: 'string', enum: ['set', 'rm', 'group-add', 'group-rm', 'member-add', 'member-rm', 'anonymous', 'bind', 'entry-add', 'entry-close', 'publish', 'unpublish'] },
    target: { type: 'string' }, arg: { type: 'string' }, allow: { type: 'string' }, deny: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' },
    mode: { type: 'string', enum: ['union', 'intersection'] }, methods: { type: 'string' }, expires_at: { type: 'integer' }, max_joins: { type: 'integer', minimum: 1 },
    remove_members: { type: 'boolean' }, name: { type: 'string' },
  }, ['action']),
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: WRITE_ACCESS,
  asyncMode: 'sync',
  requiresSession: true,
  examples: [
    'buckyos aiws acl-edit group-add teachers --title 老师 --workspace ws_abc',
    'buckyos aiws acl-edit member-add teachers group:staff,bob --workspace ws_abc',
    'buckyos aiws acl-edit set @teachers /data/成绩 --allow read,update --workspace ws_abc',
    'buckyos aiws acl-edit set @all /data/工资 --deny read --workspace ws_abc',
    'buckyos aiws acl-edit anonymous on --workspace ws_abc',
    'buckyos aiws acl-edit entry-add visitors --methods guest,password --workspace ws_abc',
  ],
  handler: async (ctx, input) => {
    const workspace_id = requiredInputString(input, 'workspace_id')
    const target = () => requiredInputString(input, 'target')
    const arg = inputString(input, 'arg')
    const entityId = async (path: string) => String((await aiws(ctx, 'doc.resolve', { workspace_id, ...( path.startsWith('/') || path.startsWith('~') ? { path } : { reference: { entity_id: path, mode: 'live' } }) })).entity_id)
    switch (requiredInputString(input, 'action')) {
      case 'set': return aiws(ctx, 'acl.set', { workspace_id, changes: [{ subject: target(), resource: arg ?? '/', allow: caps(inputString(input, 'allow')), deny: caps(inputString(input, 'deny')) }] })
      case 'rm': return aiws(ctx, 'acl.set', { workspace_id, changes: [{ subject: target(), resource: arg ?? '/' }] })
      case 'group-add': return aiws(ctx, 'acl.set_group', { workspace_id, group_id: target(), ...given(input, { title: 'title', description: 'description' }) })
      case 'group-rm': return aiws(ctx, 'acl.delete_group', { workspace_id, group_id: target() })
      case 'member-add': return aiws(ctx, 'acl.members', { workspace_id, group_id: target(), add: ids(arg ?? '') })
      case 'member-rm': return aiws(ctx, 'acl.members', { workspace_id, group_id: target(), remove: ids(arg ?? '') })
      case 'anonymous': {
        const on = target()
        if (on !== 'on' && on !== 'off') throw new UsageError('AIWS_USAGE', 'anonymous on | off')
        return aiws(ctx, 'acl.set_anonymous', { workspace_id, enabled: on === 'on' })
      }
      case 'bind': return aiws(ctx, 'acl.bind_macro', { workspace_id, wish: target(), group_id: !arg || arg === 'none' ? null : arg, ...given(input, { mode: 'mode' }) })
      case 'entry-add': {
        const methods = Object.fromEntries(ids(requiredInputString(input, 'methods')).map((m) => [m, true]))
        return aiws(ctx, 'ws.create_entry', { workspace_id, group_id: target(), methods, ...given(input, { expires_at: 'expires_at', max_joins: 'max_joins' }) })
      }
      case 'entry-close': return aiws(ctx, 'ws.close_entry', { workspace_id, entry_id: target(), ...given(input, { remove_members: 'remove_members' }) })
      case 'publish': return aiws(ctx, 'ws.publish', { workspace_id, entity_id: await entityId(target()), ...given(input, { name: 'name' }) })
      case 'unpublish': return aiws(ctx, 'ws.unpublish', { workspace_id, entity_id: await entityId(target()) })
      default: throw new UsageError('AIWS_USAGE', 'acl-edit: set, rm, group-add, group-rm, member-add, member-rm, anonymous, bind, entry-add, entry-close, publish or unpublish')
    }
  },
}

const statCommand: CommandDefinition = {
  verb: 'stat',
  summary: 'What an entity is: path, name, title, type, schema, parent, versions, body state and size, children, your capabilities and the Commit operations its type takes',
  positionals: [{ name: 'path', description: PATH_HELP, required: true }],
  options: [WORKSPACE_OPTION],
  inputSchema: workspaceInput({ path: { type: 'string', minLength: 1 } }, ['path']),
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: READ_ACCESS,
  asyncMode: 'sync',
  requiresSession: true,
  examples: ['buckyos aiws stat /data/销售 --workspace ws_abc'],
  handler: (ctx, input) => aiws(ctx, 'doc.read', { workspace_id: requiredInputString(input, 'workspace_id'), ...aiwsTarget(requiredInputString(input, 'path')), as: 'meta' }),
}

/** Pages of a body followed at most this far (32 KiB each by default). */
const CAT_MAX_PAGES = 512

const catCommand: CommandDefinition = {
  verb: 'cat',
  summary: 'The plain-text body of an entity (rich text as Markdown, a table as CSV, …), whole: the pages are followed unless --max-bytes or --cursor asks for one page',
  description: 'With --output text only the text is printed. A table body is CSV of display values (select labels, reference paths); one part (a record, a block) is read with --selector.',
  positionals: [{ name: 'path', description: PATH_HELP, required: true }],
  options: [
    WORKSPACE_OPTION,
    { name: 'selector', property: 'selector', description: 'Only this part, selector JSON, e.g. {"kind":"richtext_block","block_id":"b3"}', type: 'string' },
    { name: 'max-bytes', property: 'max_bytes', description: 'One page of at most this many bytes (64…262144)', type: 'integer' },
    CURSOR_OPTION,
  ],
  inputSchema: workspaceInput({ path: { type: 'string', minLength: 1 }, selector: { type: 'string' }, max_bytes: { type: 'integer', minimum: 64 }, cursor: { type: 'string' } }, ['path']),
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: READ_ACCESS,
  asyncMode: 'sync',
  requiresSession: true,
  examples: ['buckyos aiws cat /docs/周报 --workspace ws_abc --output text', 'buckyos aiws cat /data/销售 --workspace ws_abc --max-bytes 4096'],
  handler: async (ctx, input) => {
    const selector = inputString(input, 'selector')
    const request = {
      workspace_id: requiredInputString(input, 'workspace_id'), ...aiwsTarget(requiredInputString(input, 'path')), as: 'body',
      ...(selector ? { selector: jsonArg(selector, '--selector') } : {}), ...given(input, { max_bytes: 'max_bytes' }),
    }
    let page = await aiws(ctx, 'doc.read', { ...request, ...given(input, { cursor: 'cursor' }) })
    if (input.max_bytes !== undefined || inputString(input, 'cursor')) return page
    let text = String(page.text ?? '')
    for (let n = 1; page.complete === false && typeof page.next_cursor === 'string' && n < CAT_MAX_PAGES; n++) {
      page = await aiws(ctx, 'doc.read', { ...request, cursor: page.next_cursor })
      text += String(page.text ?? '')
    }
    const { parts: _parts, ...last } = page
    return { ...last, text }
  },
}

const resolveCommand: CommandDefinition = {
  verb: 'resolve',
  summary: 'A path (or entity id) as a reference: entity id, canonical reference, path and name',
  positionals: [{ name: 'path', description: PATH_HELP, required: true }],
  options: [WORKSPACE_OPTION],
  inputSchema: workspaceInput({ path: { type: 'string', minLength: 1 } }, ['path']),
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: READ_ACCESS,
  asyncMode: 'sync',
  requiresSession: true,
  examples: ['buckyos aiws resolve /data/销售 --workspace ws_abc'],
  handler: (ctx, input) => {
    const target = aiwsTarget(requiredInputString(input, 'path'))
    return aiws(ctx, 'doc.resolve', { workspace_id: requiredInputString(input, 'workspace_id'), ...('path' in target ? target : { reference: { entity_id: target.entity_id, mode: 'live' } }) })
  },
}

/** `--table a=/data/销售,b=orders`: aliases of the tables a query reads (a path may hold commas; a pair starts at
 * `<alias>=`). */
function tableAliases(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const pair of text.split(/,(?=\s*[A-Za-z_][A-Za-z0-9_]*=)/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.+?)\s*$/.exec(pair)
    if (!m) throw new UsageError('AIWS_USAGE', `--table ${pair}: <alias>=<path or entity id>`)
    out[m[1]] = m[2]
  }
  return out
}

const sqlCommand: CommandDefinition = {
  verb: 'sql',
  summary: 'One SQL SELECT over the tables of a workspace: a table is named by its path in double quotes (FROM "/data/销售"), "~<entity_id>", or an alias of --table',
  description: 'Columns: _id (record id), _rev, _body (path of the record body), _record (the record as doc.read gives it, JSON), and per field "<name>" (display value: select label, multi-select JSON array of labels, reference path, decimal / currency amount as a number, boolean 1/0) and "<name>#raw" (stored value: option ids, exact decimal, reference / currency JSON); currency also "<name>#currency". SELECT only (WITH, subqueries and window functions included); at most --max-rows rows (truncated tells), 4 MiB and 2 s. URL tables have no local rows (NOT_MATERIALIZED).',
  positionals: [{ name: 'sql', description: 'The SELECT statement', required: true }],
  options: [
    WORKSPACE_OPTION,
    { name: 'table', property: 'table', description: 'Aliases: alias=<path or entity id>[,alias=…]; only these tables are visible then', type: 'string' },
    { name: 'params', property: 'params', description: 'Positional parameters (?) as a JSON array', type: 'string' },
    { name: 'max-rows', property: 'max_rows', description: 'Rows at most (≤ 5000, default 1000)', type: 'integer' },
  ],
  inputSchema: workspaceInput({ sql: { type: 'string', minLength: 1 }, table: { type: 'string' }, params: { type: 'string' }, max_rows: { type: 'integer', minimum: 1 } }, ['sql']),
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: READ_ACCESS,
  asyncMode: 'sync',
  requiresSession: true,
  examples: [
    'buckyos aiws sql \'SELECT "客户", SUM("金额") AS total FROM "/data/销售" GROUP BY "客户" ORDER BY total DESC LIMIT 10\' --workspace ws_abc',
    'buckyos aiws sql \'SELECT "_id", "客户", "金额" FROM t WHERE "状态" = ? LIMIT 20\' --table t=/data/销售 --params \'["已完成"]\' --workspace ws_abc',
  ],
  handler: (ctx, input) => {
    const table = inputString(input, 'table')
    const params = inputString(input, 'params')
    const values = params ? jsonArg(params, '--params') : undefined
    if (values !== undefined && !Array.isArray(values)) throw new UsageError('AIWS_USAGE', '--params is a JSON array')
    return aiws(ctx, 'doc.query', {
      workspace_id: requiredInputString(input, 'workspace_id'), sql: requiredInputString(input, 'sql'),
      ...(table ? { tables: tableAliases(table) } : {}), ...(values ? { params: values } : {}), ...given(input, { max_rows: 'max_rows' }),
    })
  },
}

// ---- writing: the operations of buckyos-websdk src/aiws_write.ts, committed as one Commit each (an idempotency key, and
// on an unknown result doc.get_submission, then the same key again). Field names, option labels and `expect` come from
// what is read just before.

type TableRead = Parameters<typeof tableInsert>[0]
type RichTextRead = Parameters<typeof textReplaceBlock>[0]
type EntityRead = Parameters<typeof rename>[0]

/** The service as the SDK's write helpers take it: a business failure is an `AiwsFailure`, never an unknown result. */
function writeTransport(ctx: CommandContext) {
  return {
    call: async <T,>(method: string, params: Record<string, unknown>): Promise<T> => {
      const result = expectObject(await callService<unknown>(ctx, SERVICE, method, params), method)
      if (result.ok === false) {
        const error = expectObject(result.error, `${method}.error`)
        throw new AiwsFailure({ code: String(error.code ?? 'AIWS_ERROR'), retryable: Boolean(error.retryable), detail: String(error.detail ?? error.code ?? ''), sub_code: typeof error.sub_code === 'string' ? error.sub_code : undefined, data: error.data })
      }
      return result as T
    },
  }
}

/** A refusal (of the service, or of a helper: an unknown field, a block not read) as the CLI's error, its code first. */
async function writing<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof AiwsFailure) throw new ToolError(error.code, error.message, undefined, false, { ...(error.subCode ? { sub_code: error.subCode } : {}), ...(error.data !== undefined ? { data: error.data } : {}) })
    throw error
  }
}

async function commit(ctx: CommandContext, ws: string, ops: Record<string, unknown>[], message: string): Promise<Record<string, unknown>> {
  const result = await commitOps(writeTransport(ctx), ws, ops as never, { message, ...(ctx.idempotencyKey ? { idempotencyKey: ctx.idempotencyKey } : {}) })
  return { ok: true, status: result.status, commit_id: result.commit_id, seq: result.seq }
}

/** The envelope of an entity (ids and revs) without its content. */
function envelopeOf(ctx: CommandContext, ws: string, target: string): Promise<Record<string, unknown>> {
  return aiws(ctx, 'doc.read', { workspace_id: ws, ...aiwsTarget(target), selector: { kind: 'doc_key', key: 'title' } })
}

const ids = (text: string) => text.split(',').map((s) => s.trim()).filter(Boolean)

async function markdownInput(input: Record<string, unknown>): Promise<string> {
  const text = typeof input.text === 'string' ? input.text : undefined
  const file = inputString(input, 'file')
  if ((text !== undefined) === (file !== undefined)) throw new UsageError('AIWS_USAGE', 'pass --file <md> or --text <markdown>')
  return file ? await getHost().readTextFile(file) : text!
}

const tableCommand: CommandDefinition = {
  verb: 'table',
  summary: 'Write a table: `add <table> --values` (records), `set <table> <record_id> --values` (cells), `rm <table> <record_id>[,…]`, `field-add <table> --name --type`, `option-add <table> <field> <label>`',
  description: '--values is JSON keyed by field name with display values (a select takes its label, a multi-select labels, a reference an entity id; null clears a cell on set); add takes an object or an array of them, "_id" naming a record id. Each change is expected at the version just read: a concurrent change of the same cell is a REVISION_CONFLICT (read again). field-add --type: text, number, decimal, boolean, date, datetime, select, multi_select, object_ref, currency, json; --options gives a select its labels.',
  positionals: [
    { name: 'action', description: 'add | set | rm | field-add | option-add', required: true },
    { name: 'table', description: `The table: ${PATH_HELP}`, required: true },
    { name: 'target', description: 'set: record id; rm: record ids, comma-separated; option-add: field name', required: false },
    { name: 'label', description: 'option-add: the new option label', required: false },
  ],
  options: [
    WORKSPACE_OPTION,
    { name: 'values', property: 'values', description: 'add / set: JSON keyed by field name', type: 'string' },
    { name: 'name', property: 'name', description: 'field-add: the field name', type: 'string' },
    { name: 'type', property: 'type', description: 'field-add: the field type', type: 'string', enum: ['text', 'number', 'decimal', 'boolean', 'date', 'datetime', 'select', 'multi_select', 'object_ref', 'currency', 'json'] },
    { name: 'options', property: 'options', description: 'field-add: option labels of a select, a JSON array or comma-separated', type: 'string' },
  ],
  inputSchema: workspaceInput({
    action: { type: 'string', enum: ['add', 'set', 'rm', 'field-add', 'option-add'] }, table: { type: 'string', minLength: 1 }, target: { type: 'string' }, label: { type: 'string' },
    values: { type: 'string' }, name: { type: 'string' }, type: { type: 'string' }, options: { type: 'string' },
  }, ['action', 'table']),
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: WRITE_ACCESS,
  asyncMode: 'sync',
  requiresSession: true,
  examples: [
    'buckyos aiws table add /data/销售 --values \'{"客户":"ACME","金额":"1200.50","状态":"进行中"}\' --workspace ws_abc',
    'buckyos aiws table set /data/销售 r123 --values \'{"状态":"已完成"}\' --workspace ws_abc',
    'buckyos aiws table rm /data/销售 r123,r124 --workspace ws_abc',
    'buckyos aiws table field-add /data/销售 --name 负责人 --type text --workspace ws_abc',
    'buckyos aiws table option-add /data/销售 状态 已取消 --workspace ws_abc',
  ],
  handler: (ctx, input) => writing(async () => {
    const ws = requiredInputString(input, 'workspace_id')
    const action = requiredInputString(input, 'action')
    const tablePath = requiredInputString(input, 'table')
    const values = () => {
      const v = jsonArg(requiredInputString(input, 'values'), '--values')
      if (!v || typeof v !== 'object') throw new UsageError('AIWS_USAGE', '--values is a JSON object keyed by field name')
      return v as Record<string, unknown> | Record<string, unknown>[]
    }
    if (action === 'rm') {
      const records = ids(requiredInputString(input, 'target'))
      const reads = await Promise.all(records.map((record_id) => aiws(ctx, 'doc.read', { workspace_id: ws, ...aiwsTarget(tablePath), selector: { kind: 'table_record', record_id } })))
      const table = String(reads[0].entity_id)
      return { ...await commit(ctx, ws, tableDelete(table, records, reads as never), `delete ${records.length} record(s)`), table, removed: records }
    }
    const table = await aiws(ctx, 'doc.read', { workspace_id: ws, ...aiwsTarget(tablePath) }) as unknown as TableRead
    switch (action) {
      case 'add': {
        const rows = values()
        const ops = tableInsert(table, Array.isArray(rows) ? rows : [rows])
        const record_ids = ((ops[0]?.records ?? []) as { record_id: string }[]).map((r) => r.record_id)
        return { ...await commit(ctx, ws, ops, `add ${record_ids.length} record(s)`), table: table.entity_id, record_ids }
      }
      case 'set': {
        const record_id = requiredInputString(input, 'target')
        const v = values()
        if (Array.isArray(v)) throw new UsageError('AIWS_USAGE', 'set takes one --values object')
        const read = await aiws(ctx, 'doc.read', { workspace_id: ws, entity_id: table.entity_id, selector: { kind: 'table_record', record_id } })
        const ops = tableSet(table, record_id, v, read as never)
        if (ops.length === 0) return { ok: true, status: 'unchanged', table: table.entity_id, record_id }
        return { ...await commit(ctx, ws, ops, `update record ${record_id}`), table: table.entity_id, record_id }
      }
      case 'field-add': {
        const options = inputString(input, 'options')
        const labels = options === undefined ? undefined : options.startsWith('[') ? jsonArg(options, '--options') as string[] : ids(options)
        const op = fieldAdd(table, { name: requiredInputString(input, 'name'), type: requiredInputString(input, 'type'), ...(labels ? { options: labels } : {}) })
        const field = op.field as { field_id: string; options?: unknown[] }
        return { ...await commit(ctx, ws, [op], `add field ${requiredInputString(input, 'name')}`), table: table.entity_id, field_id: field.field_id, ...(field.options ? { options: field.options } : {}) }
      }
      case 'option-add': {
        const op = optionAdd(table, requiredInputString(input, 'target'), requiredInputString(input, 'label'))
        return { ...await commit(ctx, ws, [op], `add option ${requiredInputString(input, 'label')}`), table: table.entity_id, field_id: op.field_id, option: op.option }
      }
      default:
        throw new UsageError('AIWS_USAGE', `table: add, set, rm, field-add or option-add, not ${action}`)
    }
  }),
}

const textCommand: CommandDefinition = {
  verb: 'text',
  summary: 'Write a rich text by blocks from Markdown: `append <doc> --file <md>`, `replace <doc> <block_id> --file <md>`, `rm <doc> <block_id>[,…]`',
  description: 'Markdown: headings, paragraphs, bullet / ordered / task lists, fenced code, quotes, rules, pipe tables, inline code, strong, emphasis, strike and links ([label](entity:<id>) links an entity). Block ids are in the rich text as `doc.read` answers it (content.blocks) and in the selectors of `grep` hits; a replaced or removed block is expected at the version just read (REVISION_CONFLICT when it changed meanwhile). replace keeps the block id for the first block of the Markdown and inserts the rest after it.',
  positionals: [
    { name: 'action', description: 'append | replace | rm', required: true },
    { name: 'doc', description: `The rich text: ${PATH_HELP}`, required: true },
    { name: 'block', description: 'replace: block id; rm: block ids, comma-separated', required: false },
  ],
  options: [
    WORKSPACE_OPTION,
    { name: 'file', property: 'file', description: 'append / replace: a local Markdown file', type: 'string' },
    { name: 'text', property: 'text', description: 'append / replace: the Markdown itself', type: 'string' },
  ],
  inputSchema: workspaceInput({ action: { type: 'string', enum: ['append', 'replace', 'rm'] }, doc: { type: 'string', minLength: 1 }, block: { type: 'string' }, file: { type: 'string' }, text: { type: 'string' } }, ['action', 'doc']),
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: WRITE_ACCESS,
  asyncMode: 'sync',
  requiresSession: true,
  examples: [
    'buckyos aiws text append /docs/周报 --file notes.md --workspace ws_abc',
    'buckyos aiws text replace /docs/周报 b12 --text "## 下周计划" --workspace ws_abc',
    'buckyos aiws text rm /docs/周报 b12,b13 --workspace ws_abc',
  ],
  handler: (ctx, input) => writing(async () => {
    const ws = requiredInputString(input, 'workspace_id')
    const action = requiredInputString(input, 'action')
    const target = requiredInputString(input, 'doc')
    if (action === 'append') {
      const markdown = await markdownInput(input)
      const doc = String((await aiws(ctx, 'doc.read', { workspace_id: ws, ...aiwsTarget(target), as: 'meta' })).entity_id)
      const ops = textAppend(doc, markdown)
      const blocks = (ops[0].blocks as { attrs: { block_id: string } }[]).map((b) => b.attrs.block_id)
      return { ...await commit(ctx, ws, ops, 'append text'), doc, blocks }
    }
    if (action !== 'replace' && action !== 'rm') throw new UsageError('AIWS_USAGE', `text: append, replace or rm, not ${action}`)
    const markdown = action === 'replace' ? await markdownInput(input) : ''
    const doc = await aiws(ctx, 'doc.read', { workspace_id: ws, ...aiwsTarget(target) }) as unknown as RichTextRead
    if (action === 'rm') {
      const blocks = ids(requiredInputString(input, 'block'))
      return { ...await commit(ctx, ws, textDeleteBlocks(doc, blocks), `delete ${blocks.length} block(s)`), doc: doc.entity_id, removed: blocks }
    }
    const block = requiredInputString(input, 'block')
    const ops = textReplaceBlock(doc, block, markdown)
    const added = ops.length > 1 ? ((ops[1] as Record<string, unknown>).blocks as { attrs: { block_id: string } }[]).map((b) => b.attrs.block_id) : []
    return { ...await commit(ctx, ws, ops, `replace block ${block}`), doc: doc.entity_id, blocks: [block, ...added] }
  }),
}

const mvCommand: CommandDefinition = {
  verb: 'mv',
  summary: 'Move an entity under another parent, after its last child (a following name moves aside if taken there)',
  positionals: [{ name: 'path', description: PATH_HELP, required: true }, { name: 'parent', description: `The new parent: ${PATH_HELP}`, required: true }],
  options: [WORKSPACE_OPTION],
  inputSchema: workspaceInput({ path: { type: 'string', minLength: 1 }, parent: { type: 'string', minLength: 1 } }, ['path', 'parent']),
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: WRITE_ACCESS,
  asyncMode: 'sync',
  requiresSession: true,
  examples: ['buckyos aiws mv /data/草稿 /archive --workspace ws_abc'],
  handler: (ctx, input) => writing(async () => {
    const ws = requiredInputString(input, 'workspace_id')
    const entity = await envelopeOf(ctx, ws, requiredInputString(input, 'path'))
    const parent = String((await aiws(ctx, 'doc.read', { workspace_id: ws, ...aiwsTarget(requiredInputString(input, 'parent')), as: 'meta' })).entity_id)
    // the new place: after the last child the caller sees there
    let last: string | undefined
    let cursor: string | undefined
    for (let page = 0; page < 100; page++) {
      const listed = await aiws(ctx, 'doc.list', { workspace_id: ws, at: parent, limit: 1000, ...(cursor ? { cursor } : {}) })
      const items = (Array.isArray(listed.items) ? listed.items : []) as { entity_id: string }[]
      last = items.map((i) => i.entity_id).filter((id) => id !== entity.entity_id).at(-1) ?? last
      if (typeof listed.next_cursor !== 'string' || items.length === 0) break
      cursor = listed.next_cursor
    }
    const after = last ? (await envelopeOf(ctx, ws, last)).order_key : undefined
    const op = move(entity as unknown as EntityRead, parent, typeof after === 'string' ? after : null)
    return { ...await commit(ctx, ws, [op], `move ${entity.entity_id}`), entity_id: entity.entity_id, parent }
  }),
}

const renameCommand: CommandDefinition = {
  verb: 'rename',
  summary: 'Give an entity a name of its own (its path segment), or --auto to let it follow its title again',
  positionals: [{ name: 'path', description: PATH_HELP, required: true }, { name: 'name', description: 'The new name (1–128 characters, no /, not starting with ~)', required: false }],
  options: [WORKSPACE_OPTION, { name: 'auto', property: 'auto', description: 'Name it after its title again (or a counter)', type: 'boolean' }],
  inputSchema: workspaceInput({ path: { type: 'string', minLength: 1 }, name: { type: 'string' }, auto: { type: 'boolean' } }, ['path']),
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: WRITE_ACCESS,
  asyncMode: 'sync',
  requiresSession: true,
  examples: ['buckyos aiws rename /data/销售 销售-2026 --workspace ws_abc', 'buckyos aiws rename ~sales --auto --workspace ws_abc'],
  handler: (ctx, input) => writing(async () => {
    const ws = requiredInputString(input, 'workspace_id')
    const name = inputString(input, 'name')
    if ((name === undefined) === (input.auto !== true)) throw new UsageError('AIWS_USAGE', 'rename: pass a new name or --auto')
    const entity = await envelopeOf(ctx, ws, requiredInputString(input, 'path'))
    return { ...await commit(ctx, ws, [rename(entity as unknown as EntityRead, name ?? null)], `rename ${entity.entity_id}`), entity_id: entity.entity_id, ...(name ? { name } : {}) }
  }),
}

const setPropCommand: CommandDefinition = {
  verb: 'set-prop',
  summary: 'Set properties of a Block or a container: `config`, `bindings` or `on`, as JSON { <name>: value | null } (null removes one), each expected at the version just read',
  positionals: [
    { name: 'path', description: `The Block or container: ${PATH_HELP}`, required: true },
    { name: 'key', description: 'config | bindings | on', required: true },
    { name: 'props', description: 'JSON object { <name>: value | null }', required: true },
  ],
  options: [WORKSPACE_OPTION],
  inputSchema: workspaceInput({ path: { type: 'string', minLength: 1 }, key: { type: 'string', enum: ['config', 'bindings', 'on'] }, props: { type: 'string', minLength: 1 } }, ['path', 'key', 'props']),
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: WRITE_ACCESS,
  asyncMode: 'sync',
  requiresSession: true,
  examples: ['buckyos aiws set-prop /surfaces/看板/kpi config \'{"label":"本月销售"}\' --workspace ws_abc'],
  handler: (ctx, input) => writing(async () => {
    const ws = requiredInputString(input, 'workspace_id')
    const key = requiredInputString(input, 'key')
    if (key !== 'config' && key !== 'bindings' && key !== 'on') throw new UsageError('AIWS_USAGE', 'set-prop: the key is config, bindings or on')
    const props = jsonArg(requiredInputString(input, 'props'), 'props')
    if (!props || typeof props !== 'object' || Array.isArray(props)) throw new UsageError('AIWS_USAGE', 'props is a JSON object { <name>: value | null }')
    const entity = await aiws(ctx, 'doc.read', { workspace_id: ws, ...aiwsTarget(requiredInputString(input, 'path')) })
    return { ...await commit(ctx, ws, [setProps(entity as unknown as EntityRead, key, props as Record<string, unknown>)], `set ${key} of ${entity.entity_id}`), entity_id: entity.entity_id }
  }),
}

const infoCommand: CommandDefinition = {
  verb: 'info',
  summary: 'Workspace info: versions, capabilities of the caller, usage, hosted execution configuration',
  options: [WORKSPACE_OPTION],
  inputSchema: workspaceInput({}),
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: { mode: 'fixed', level: 'read' },
  asyncMode: 'sync',
  requiresSession: true,
  examples: ['buckyos aiws info --workspace ws_abc'],
  handler: (ctx, input) => aiws(ctx, 'ws.get_info', { workspace_id: requiredInputString(input, 'workspace_id') }),
}

const runGetCommand: CommandDefinition = {
  verb: 'run-get',
  summary: 'A wish run: state, execution context, the brief an executor starts from, candidate and preview',
  options: [WORKSPACE_OPTION, RUN_OPTION],
  inputSchema: workspaceInput({ run_id: { type: 'string', minLength: 1 } }, ['run_id']),
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: { mode: 'fixed', level: 'read' },
  asyncMode: 'sync',
  requiresSession: true,
  examples: ['buckyos aiws run-get --workspace ws_abc --run run_xyz'],
  handler: (ctx, input) => aiws(ctx, 'proc.get', { workspace_id: requiredInputString(input, 'workspace_id'), run_id: requiredInputString(input, 'run_id') }),
}

const runClaimCommand: CommandDefinition = {
  verb: 'run-claim',
  summary: 'Take a run as its executor: starts an attempt, answers the attempt number, a run token and the lease',
  options: [WORKSPACE_OPTION, RUN_OPTION, { name: 'claim-token', property: 'claim_token', description: 'The claim token the run was dispatched with (ct_…)', type: 'string', required: true, secret: true }],
  inputSchema: workspaceInput({ run_id: { type: 'string', minLength: 1 }, claim_token: { type: 'string', minLength: 1 } }, ['run_id', 'claim_token']),
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: { mode: 'fixed', level: 'write' },
  asyncMode: 'sync',
  requiresSession: true,
  examples: ['buckyos aiws run-claim --workspace ws_abc --run run_xyz --claim-token ct_…'],
  handler: (ctx, input) => aiws(ctx, 'proc.claim', {
    workspace_id: requiredInputString(input, 'workspace_id'), run_id: requiredInputString(input, 'run_id'), claim_token: requiredInputString(input, 'claim_token'),
    executor: { kind: 'agent', principal: ctx.principal.id },
  }),
}

const runHeartbeatCommand: CommandDefinition = {
  verb: 'run-heartbeat',
  summary: 'Keep the lease of a claimed run alive (every minute while working); optionally report progress',
  options: [WORKSPACE_OPTION, RUN_OPTION, ATTEMPT_OPTION, { name: 'phase', property: 'phase', description: 'A short progress phase, e.g. "reading inputs"', type: 'string' }],
  inputSchema: workspaceInput({ run_id: { type: 'string', minLength: 1 }, attempt: { type: 'integer', minimum: 1 }, phase: { type: 'string' } }, ['run_id', 'attempt']),
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: { mode: 'fixed', level: 'write' },
  asyncMode: 'sync',
  requiresSession: true,
  examples: ['buckyos aiws run-heartbeat --workspace ws_abc --run run_xyz --attempt 1 --phase "reading inputs"'],
  handler: (ctx, input) => {
    const phase = inputString(input, 'phase')
    return aiws(ctx, 'proc.heartbeat', { workspace_id: requiredInputString(input, 'workspace_id'), run_id: requiredInputString(input, 'run_id'), attempt: input.attempt, ...(phase ? { progress: { phase } } : {}) })
  },
}

const runFilesCommand: CommandDefinition = {
  verb: 'run-files',
  summary: 'Write the stage of a claimed run into a directory: the snapshot (context/), request.json, the Renderer catalog, the program host (lib/, with the stage budget and manifest in lib/stage.json) and, when there is one, program/main.js',
  description: 'Run the macro there with `run-exec` (or `run-program`, which also hands it in): it reads program/main.js and writes output/.aiws/results.json, exactly as every executor runs it.',
  options: [WORKSPACE_OPTION, RUN_OPTION, ATTEMPT_OPTION, { name: 'dir', property: 'dir', description: 'Directory to write into (created)', type: 'string', required: true }],
  inputSchema: workspaceInput({ run_id: { type: 'string', minLength: 1 }, attempt: { type: 'integer', minimum: 1 }, dir: { type: 'string', minLength: 1 } }, ['run_id', 'attempt', 'dir']),
  outputSchema: { type: 'object', properties: { dir: { type: 'string' }, files: { type: 'array', items: { type: 'string' } } }, required: ['dir', 'files'], additionalProperties: true },
  resultSchemaVersion: 1,
  access: { mode: 'fixed', level: 'read' },
  asyncMode: 'sync',
  requiresSession: true,
  examples: ['buckyos aiws run-files --workspace ws_abc --run run_xyz --attempt 1 --dir work'],
  handler: async (ctx, input) => {
    const result = await aiws(ctx, 'proc.files', { workspace_id: requiredInputString(input, 'workspace_id'), run_id: requiredInputString(input, 'run_id'), attempt: input.attempt })
    const dir = requiredInputString(input, 'dir')
    const host = getHost()
    const written: string[] = []
    for (const [path, file] of Object.entries(expectObject(result.files, 'proc.files.files'))) {
      const f = expectObject(file, path)
      if (typeof f.text !== 'string' && typeof f.base64 !== 'string') continue
      const target = `${dir}/${path}`
      await host.mkdir(target.slice(0, target.lastIndexOf('/')), { recursive: true })
      if (typeof f.text === 'string') await host.writeTextFile(target, f.text)
      else await host.writeFile(target, Uint8Array.from(atob(f.base64 as string), (c) => c.charCodeAt(0)))
      written.push(path)
    }
    await host.mkdir(`${dir}/output`, { recursive: true })
    await host.mkdir(`${dir}/program`, { recursive: true })
    await host.mkdir(`${dir}/lib`, { recursive: true })
    await host.writeTextFile(`${dir}/lib/stage.json`, JSON.stringify(result.stage ?? {}))
    return { dir, files: written }
  },
}

const runToolCommand: CommandDefinition = {
  verb: 'run-tool',
  summary: 'Call one stage tool of a claimed run (ws_profile, ws_read, ws_query, submit_analysis, check_results, finish, …): the service answers as it answers the model',
  options: [WORKSPACE_OPTION, RUN_OPTION, ATTEMPT_OPTION, { name: 'name', property: 'name', description: 'Tool name (the claim answered the list, with their argument schemas)', type: 'string', required: true }, { name: 'args', property: 'args', description: 'Arguments JSON', type: 'string' }, { name: 'args-file', property: 'args_file', description: 'Path of a JSON file holding the arguments', type: 'string' }],
  inputSchema: workspaceInput({ run_id: { type: 'string', minLength: 1 }, attempt: { type: 'integer', minimum: 1 }, name: { type: 'string', minLength: 1 }, args: { type: 'string' }, args_file: { type: 'string' } }, ['run_id', 'attempt', 'name']),
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: { mode: 'fixed', level: 'write' },
  asyncMode: 'sync',
  requiresSession: true,
  examples: ['buckyos aiws run-tool --workspace ws_abc --run run_xyz --attempt 1 --name ws_profile --args \'{"target":"@B1"}\'', 'buckyos aiws run-tool --workspace ws_abc --run run_xyz --attempt 1 --name finish --args \'{"summary":"done"}\''],
  handler: async (ctx, input) => {
    const args = inputString(input, 'args') || inputString(input, 'args_file') ? await jsonInput(input, 'args', 'args_file', 'arguments') : {}
    return aiws(ctx, 'proc.tool', { workspace_id: requiredInputString(input, 'workspace_id'), run_id: requiredInputString(input, 'run_id'), attempt: input.attempt, name: requiredInputString(input, 'name'), args })
  },
}

// ---- running a wish macro the way every executor runs it (AI Native phase 1, section 2.6): a Deno child that reads only
// the stage directory, writes only its output/, reaches only the Zone's host, with an empty environment and no token; its
// bridge calls (`aiws.sql`, `aiws.ai.complete`, `aiws.llm.map`, `aiws.zone.fetch`) come back over stdio and are answered
// here with the stage's lib/host.js: SQL by the service, AI with this session's own AICC, Zone resources with this session.

const BRIDGE_PREFIX = '\x1eaiws '
const REFUSALS: Record<string, string> = {
  quota_exhausted: 'AI_QUOTA_EXHAUSTED', quota_budget_exceeded: 'AI_QUOTA_BUDGET_EXCEEDED', resource_not_permitted: 'AI_RESOURCE_NOT_PERMITTED',
  attribution_unavailable: 'AI_ATTRIBUTION_UNAVAILABLE', credentials: 'AI_UNAVAILABLE',
}

interface MacroRun { source: string; results: unknown; log: string; code: number }

/** One inference with this session's AICC; a refusal carries the run's sub-code. */
function sessionInfer(ctx: CommandContext) {
  const call = async (method: string, params: unknown) => {
    try {
      return await ctx.clients.call('aicc', method, params as Record<string, unknown>, rpcOptions(ctx))
    } catch (error) {
      throw providerErrorFromRpc(`aicc ${method} failed`, error)
    }
  }
  const client = new AiccLlmClient({ chatCompletionsCreate: (r: unknown) => call('chat.completions.create', r), helperLlmChat: (r: unknown) => call('helper.llm_chat', r) } as never)
  return async (req: { model: string; messages: { role: 'system' | 'user' | 'assistant'; text: string }[]; schema: unknown; max_tokens: number }) => {
    try {
      const r: { message: { content: { type: string; text?: string }[] }; usage?: { output_tokens?: number } } = await client.infer({
        messages: req.messages.map((m) => ({ role: m.role, content: [{ type: 'text' as const, text: m.text }] })), model_alias: req.model, fallbacks: [], temperature: 0,
        max_completion_tokens: req.max_tokens, force_json: req.schema !== null, ...(req.schema !== null ? { json_schema: req.schema as never } : {}),
        disable_capabilities: [], tool_specs: [], allow_tool_calls: false, signal: ctx.signal,
      })
      return { text: r.message.content.map((c) => (c.type === 'text' ? c.text ?? '' : '')).join(''), tokens: r.usage?.output_tokens }
    } catch (error) {
      if (error instanceof LLMComputeException && error.error.kind === 'provider' && typeof error.error.failure === 'object' && 'refused' in error.error.failure) {
        const e = new Error(error.message) as Error & { code?: string }
        e.code = REFUSALS[error.error.failure.refused.code] ?? 'AI_QUOTA_EXHAUSTED'
        throw e
      }
      throw error
    }
  }
}

async function execMacro(ctx: CommandContext, input: Record<string, unknown>): Promise<MacroRun> {
  const host = getHost()
  // Subprocess cwd resolves directory aliases (e.g. /var -> /private/var on macOS).
  // Use the same canonical path for the macro's read/write permission scopes.
  const dir = await host.realPath(host.path.resolve(ctx.cwd, requiredInputString(input, 'dir')))
  const ids = { workspace_id: requiredInputString(input, 'workspace_id'), run_id: requiredInputString(input, 'run_id'), attempt: input.attempt }
  const source = await host.readTextFile(`${dir}/program/main.js`)
  let stage: { budget?: Record<string, unknown>; manifest?: unknown } = {}
  try { stage = JSON.parse(await host.readTextFile(`${dir}/lib/stage.json`)) } catch { stage = {} }
  const budget = stage.budget ?? {}
  const manifest = stage.manifest && typeof stage.manifest === 'object' ? stage.manifest as { resources?: { timeout_secs?: number } } : null
  const { createBridgeHost } = await import(new URL(`file://${dir}/lib/host.js`).href) as { createBridgeHost: (o: Record<string, unknown>) => { handle(op: string, req: unknown): Promise<unknown> } }
  const origin = gatewayOrigin(ctx.connection.endpoint)
  const zoneHost = new URL(origin).hostname
  const bridge = createBridgeHost({
    tool: async (name: string, args: unknown) => {
      try {
        return await aiws(ctx, 'proc.tool', { ...ids, name, args })
      } catch (error) {
        return { status: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
    infer: sessionInfer(ctx),
    zoneFetch: async (url: string, init: { method: string; headers: Record<string, string>; body: string | null }) => {
      const res = await fetch(url, { method: init.method, headers: { ...init.headers, Authorization: `Bearer ${await sessionToken(ctx)}` }, body: init.body ?? undefined, signal: ctx.signal })
      const bytes = new Uint8Array(await res.arrayBuffer())
      const headers: Record<string, string> = {}
      res.headers.forEach((v, k) => { headers[k] = v })
      try { return { status: res.status, headers, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) } } catch { return { status: res.status, headers, base64: btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join('')) } }
    },
    zoneHosts: [zoneHost], zoneOrigin: origin, budget, manifest,
  })
  await host.remove(`${dir}/output/.aiws/results.json`).catch(() => undefined)
  await host.mkdir(`${dir}/output`, { recursive: true })
  // under Deno the tool's own runtime runs the macro; the Node distribution uses the Deno on PATH
  const child = host.spawn(host.kind === 'deno' ? host.runtimeExecutable : 'deno', [
    'run', '--no-prompt', '--quiet', '--no-remote', `--allow-read=${dir}`, `--allow-write=${dir}/output`, `--allow-net=${zoneHost}`, 'lib/run.js', '--bridge',
  ], { cwd: dir, env: { NO_COLOR: '1', DENO_NO_UPDATE_CHECK: '1', DENO_DIR: `${dir}/.deno` } })
  const cap = Number(budget.program_timeout_secs) || 120
  const limit = Math.min(cap, Number(manifest?.resources?.timeout_secs) || cap)
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; child.kill() }, limit * 1000)
  const out: string[] = []
  try {
    for await (const line of child.lines()) {
      if (!line.startsWith(BRIDGE_PREFIX)) { out.push(line); continue }
      const msg = JSON.parse(line.slice(BRIDGE_PREFIX.length)) as { id: number; op: string; req: unknown }
      await child.writeLine(JSON.stringify({ id: msg.id, body: await bridge.handle(msg.op, msg.req) }))
    }
  } finally {
    clearTimeout(timer)
    await child.closeInput()
  }
  const code = await child.status
  const log = [...out, await child.stderr, ...(timedOut ? [`The macro timed out (${limit} s)`] : [])].filter(Boolean).join('\n')
  let results: unknown = null
  try { results = JSON.parse(await host.readTextFile(`${dir}/output/.aiws/results.json`)) } catch { results = null }
  if (timedOut) results = { error: `The macro timed out (${limit} s)` }
  return { source, results, log, code }
}

const RUN_EXEC_OPTIONS: OptionDefinition[] = [
  WORKSPACE_OPTION, RUN_OPTION, ATTEMPT_OPTION,
  { name: 'dir', property: 'dir', description: 'The stage directory written by run-files (program/main.js, lib/, output/), under the current directory', type: 'string', required: true },
]
const RUN_EXEC_INPUT = workspaceInput({ run_id: { type: 'string', minLength: 1 }, attempt: { type: 'integer', minimum: 1 }, dir: { type: 'string', minLength: 1 } }, ['run_id', 'attempt', 'dir'])

const runExecCommand: CommandDefinition = {
  verb: 'run-exec',
  summary: 'Run program/main.js of a stage directory as every executor runs a wish macro: reads only the directory, writes only output/, reaches only the Zone, its AI calls with your session; prints its outcome',
  description: 'The macro gets no token and no environment. Use it to debug a macro; `run-program` runs it the same way and hands it in. API: the wish macro guide (src/frame/aiworkspace/aiws/README.md in buckyos).',
  options: RUN_EXEC_OPTIONS,
  inputSchema: RUN_EXEC_INPUT,
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: { mode: 'fixed', level: 'write' },
  asyncMode: 'sync',
  requiresSession: true,
  examples: ['buckyos aiws run-exec --workspace ws_abc --run run_xyz --attempt 1 --dir work'],
  handler: async (ctx, input) => {
    const run = await execMacro(ctx, input)
    const r = (run.results ?? {}) as Record<string, unknown>
    return { exit_code: run.code, error: r.error ?? null, error_code: r.error_code ?? null, ai: r.ai ?? null, declare: r.declare ?? null, log: run.log }
  },
}

const runProgramCommand: CommandDefinition = {
  verb: 'run-program',
  summary: 'Run the macro of a stage directory (as run-exec) and hand the run in: the source, its results, the files under output/ and its log; the service judges it against the contract',
  description: 'While coding, the answer is what the model would read (previews, checks, manifest, problems); running a stored macro, a failure ends the run. Then `run-report --finished`.',
  options: RUN_EXEC_OPTIONS,
  inputSchema: RUN_EXEC_INPUT,
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: { mode: 'fixed', level: 'write' },
  asyncMode: 'sync',
  requiresSession: true,
  examples: ['buckyos aiws run-program --workspace ws_abc --run run_xyz --attempt 1 --dir work'],
  handler: async (ctx, input) => {
    const host = getHost()
    const dir = host.path.resolve(ctx.cwd, requiredInputString(input, 'dir'))
    const run = await execMacro(ctx, input)
    const files: Record<string, unknown> = {}
    const walk = async (rel: string) => {
      for (const entry of await host.readDir(`${dir}/output${rel ? `/${rel}` : ''}`)) {
        const name = rel ? `${rel}/${entry.name}` : entry.name
        if (name === '.aiws' || name.startsWith('.aiws/')) continue
        if (entry.isDirectory) await walk(name)
        else {
          const bytes = await host.readFile(`${dir}/output/${name}`)
          let text: string | null = null
          try { text = bytes.includes(0) ? null : new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { text = null }
          files[`output/${name}`] = text ?? { base64: btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join('')) }
        }
      }
    }
    await walk('')
    return aiws(ctx, 'proc.program', { workspace_id: requiredInputString(input, 'workspace_id'), run_id: requiredInputString(input, 'run_id'), attempt: input.attempt, source: run.source, results: run.results, log: run.log, files })
  },
}

const runStartCommand: CommandDefinition = {
  verb: 'run-start',
  summary: 'Start a wish run that you execute yourself (an analysis you work out in a conversation, coding, running): answers the run and its claim token; your AI resources pay',
  description: 'Then `run-claim` with that token and work it like any run. An analysis is handed in with `run-tool --name submit_analysis` then `run-report --finished`, or `run-report --analysis-file`. Needs update on the wish.',
  options: [WORKSPACE_OPTION, { name: 'wish', property: 'wish_id', description: 'The wish (its entity id)', type: 'string', required: true },
    { name: 'stage', property: 'stage', description: 'analyze | code | run (default analyze)', type: 'string' }],
  inputSchema: workspaceInput({ wish_id: { type: 'string', minLength: 1 }, stage: { type: 'string', enum: ['analyze', 'code', 'run'] } }, ['wish_id']),
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: { mode: 'fixed', level: 'write' },
  asyncMode: 'sync',
  requiresSession: true,
  examples: ['buckyos aiws run-start --workspace ws_abc --wish wish_q3 --stage analyze'],
  handler: (ctx, input) => aiws(ctx, 'proc.start', {
    workspace_id: requiredInputString(input, 'workspace_id'), program: 'wish.xllm@1', idempotency_key: ctx.idempotencyKey ?? `cli-${ctx.traceId}`,
    params: { wish_id: requiredInputString(input, 'wish_id'), stage: inputString(input, 'stage') || 'analyze', execution: { mode: 'local' } },
  }),
}

const runReportCommand: CommandDefinition = {
  verb: 'run-report',
  summary: 'End a claimed run: --finished after the stage is done (submit_analysis or finish accepted, or the stored macro handed in), an analysis made elsewhere, or a failure',
  description: 'The service validates and plans what the stage collected; the user confirms it in the workspace. Results always come from the macro (run-program). A superseded attempt or a cancelled run gets RUN_REVOKED.',
  options: [
    WORKSPACE_OPTION, RUN_OPTION, ATTEMPT_OPTION,
    { name: 'finished', property: 'finished', description: 'The stage is done: what it collected becomes the candidate', type: 'boolean' },
    { name: 'analysis', property: 'analysis', description: 'Analysis JSON (analyze runs, wish.analysis.v3)', type: 'string' },
    { name: 'analysis-file', property: 'analysis_file', description: 'Path of a JSON file holding the analysis', type: 'string' },
    { name: 'summary', property: 'summary', description: 'One paragraph on what was done', type: 'string' },
    { name: 'warning', property: 'warnings', description: 'A warning for the user (repeatable)', type: 'string' },
    { name: 'error', property: 'error', description: 'Report a failure instead: its reason', type: 'string' },
  ],
  inputSchema: workspaceInput({ run_id: { type: 'string', minLength: 1 }, attempt: { type: 'integer', minimum: 1 }, finished: { type: 'boolean' }, analysis: { type: 'string' }, analysis_file: { type: 'string' }, summary: { type: 'string' }, warnings: { type: 'string' }, error: { type: 'string' } }, ['run_id', 'attempt']),
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: { mode: 'fixed', level: 'write' },
  asyncMode: 'sync',
  requiresSession: true,
  examples: [
    'buckyos aiws run-report --workspace ws_abc --run run_xyz --attempt 1 --finished',
    'buckyos aiws run-report --workspace ws_abc --run run_xyz --attempt 1 --analysis-file out/analysis.json',
    'buckyos aiws run-report --workspace ws_abc --run run_xyz --attempt 1 --error "the input table is empty"',
  ],
  handler: async (ctx, input) => {
    const params: Record<string, unknown> = { workspace_id: requiredInputString(input, 'workspace_id'), run_id: requiredInputString(input, 'run_id'), attempt: input.attempt }
    const error = inputString(input, 'error')
    if (error) {
      params.error = { code: 'EXECUTOR_FAILED', detail: error }
    } else if (input.finished === true) {
      params.finished = true
    } else {
      params.analysis = await jsonInput(input, 'analysis', 'analysis_file', 'an analysis')
    }
    const summary = inputString(input, 'summary')
    if (summary) params.summary = summary
    const warning = inputString(input, 'warnings')
    if (warning) params.warnings = [warning]
    return aiws(ctx, 'proc.report', params)
  },
}

// Block-controls (a mind map…): the catalogue each control describes itself in, and its exchange formats
// (脑图方案 §8.1). The service dispatches by control kind: `control.*` in buckyos/src/frame/aiworkspace/README.md.
const controlsCommand: CommandDefinition = {
  verb: 'controls',
  summary: 'Block-controls a canvas offers: `list` (kind, what it is, when to use it), `describe <kind>` (the full self-description to follow)',
  positionals: [{ name: 'action', description: 'list | describe', required: true }, { name: 'kind', description: 'Control kind for describe, e.g. mindmap', required: false }],
  options: [],
  inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'describe'] }, kind: { type: 'string' } }, required: ['action'], additionalProperties: false },
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: { mode: 'fixed', level: 'read' },
  asyncMode: 'sync',
  requiresSession: true,
  examples: ['buckyos aiws controls list', 'buckyos aiws controls describe mindmap'],
  handler: (ctx, input) => {
    const action = requiredInputString(input, 'action')
    if (action === 'list') return aiws(ctx, 'control.list', {})
    if (action !== 'describe') throw new UsageError('AIWS_USAGE', 'controls: list or describe <kind>')
    return aiws(ctx, 'control.describe', { kind: requiredInputString(input, 'kind') })
  },
}

/** `markdown` / `opml` from an explicit option or the file name. */
function exchangeFormat(explicit: string | undefined, file: string): string {
  if (explicit) return explicit
  return /\.(opml|xml)$/i.test(file) ? 'opml' : 'markdown'
}

const importCommand: CommandDefinition = {
  verb: 'import',
  summary: 'Create a Block-control from an exchange file: a mind map from a Markdown outline (nested list) or OPML',
  positionals: [{ name: 'file', description: 'Local file (.md / .opml)', required: true }],
  options: [
    WORKSPACE_OPTION,
    { name: 'parent', property: 'parent_id', description: 'Surface (or group) id to put the control on', type: 'string', required: true },
    { name: 'kind', property: 'kind', description: 'Control kind (default mindmap)', type: 'string' },
    { name: 'format', property: 'format', description: 'markdown | opml (default: by the file extension)', type: 'string', enum: ['markdown', 'opml'] },
    { name: 'at', property: 'at', description: 'x,y on a free canvas: where the first root goes', type: 'string' },
    { name: 'title', property: 'title', description: 'Title of the control (default: the single root, or the OPML title)', type: 'string' },
  ],
  inputSchema: workspaceInput({ file: { type: 'string', minLength: 1 }, parent_id: { type: 'string', minLength: 1 }, kind: { type: 'string' }, format: { type: 'string' }, at: { type: 'string' }, title: { type: 'string' } }, ['file', 'parent_id']),
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: { mode: 'fixed', level: 'write' },
  asyncMode: 'sync',
  requiresSession: true,
  examples: ['buckyos aiws import plan.md --workspace ws_abc --parent sf_main --at 100,80', 'buckyos aiws import ideas.opml --workspace ws_abc --parent sf_main'],
  handler: async (ctx, input) => {
    const file = requiredInputString(input, 'file')
    const params: Record<string, unknown> = {
      workspace_id: requiredInputString(input, 'workspace_id'), parent_id: requiredInputString(input, 'parent_id'),
      kind: inputString(input, 'kind') ?? 'mindmap', format: exchangeFormat(inputString(input, 'format'), file), text: await getHost().readTextFile(file),
    }
    const at = inputString(input, 'at')
    if (at) {
      const [x, y] = at.split(',').map(Number)
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new UsageError('AIWS_USAGE', '--at is x,y')
      params.at = { x, y }
    }
    const title = inputString(input, 'title')
    if (title) params.title = title
    return aiws(ctx, 'control.import', params)
  },
}

const exportCommand: CommandDefinition = {
  verb: 'export',
  summary: 'A Block-control in an exchange format: a mind map as a Markdown outline or OPML',
  positionals: [{ name: 'entity_id', description: 'The control (container) id', required: true }],
  options: [
    WORKSPACE_OPTION,
    { name: 'format', property: 'format', description: 'markdown (default) | opml', type: 'string', enum: ['markdown', 'opml'] },
    { name: 'out', property: 'out', description: 'Write the text to this file instead of answering it', type: 'string' },
  ],
  inputSchema: workspaceInput({ entity_id: { type: 'string', minLength: 1 }, format: { type: 'string' }, out: { type: 'string' } }, ['entity_id']),
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: { mode: 'fixed', level: 'read' },
  asyncMode: 'sync',
  requiresSession: true,
  examples: ['buckyos aiws export mm_plan --workspace ws_abc', 'buckyos aiws export mm_plan --workspace ws_abc --format opml --out plan.opml'],
  handler: async (ctx, input) => {
    const result = await aiws(ctx, 'control.export', { workspace_id: requiredInputString(input, 'workspace_id'), entity_id: requiredInputString(input, 'entity_id'), format: inputString(input, 'format') ?? 'markdown' })
    const out = inputString(input, 'out')
    if (!out) return result
    await getHost().writeTextFile(out, String(result.text ?? ''))
    return { ok: true, format: result.format, kind: result.kind, path: out }
  },
}

// ---- extension controls (buckyos aiworkspace README “Extension controls”): source in the Zone's home folders,
// built into a Workspace, exported as a bundle / `aiws` PIKG, installed into the caller's library, imported elsewhere.
// The drivers are buckyos-websdk src/aiws_ext.ts, shared with the Desktop.

async function sessionToken(ctx: CommandContext): Promise<string> {
  const session = ctx.session
  if (!session) throw new ToolError('AUTH_REQUIRED', 'authenticated session is required', EXIT_AUTH)
  return (await session.ensureValid()).token
}

/** The Zone file service (NFSP) with the caller's session: where control sources live. */
async function openHome(ctx: CommandContext): Promise<NfspClient> {
  const session = ctx.session
  if (!session) throw new ToolError('AUTH_REQUIRED', 'authenticated session is required', EXIT_AUTH)
  const nfsp = new NfspClient({ baseUrl: gatewayOrigin(ctx.connection.endpoint), sessionToken: async () => (await session.ensureValid()).token })
  await nfsp.hello(['cli'])
  return nfsp
}

/** The two calls the shared drivers make (`AiwsExtRpc` of buckyos-websdk src/aiws_ext.ts). */
function extRpc(ctx: CommandContext) {
  return {
    extBuild: (workspace_id: string, params: Record<string, unknown>) => aiws(ctx, 'ext.build', { workspace_id, ...params }) as never,
    extExport: (workspace_id: string, entity_ids: string[], purpose: string = 'package') => aiws(ctx, 'ext.export', { workspace_id, entity_ids, purpose }) as never,
  }
}

/** Bytes of a Workspace object (`GET /kapi/aiworkspace/asset/<ws>/<obj_id>`, authorized through what references it). */
function assetFetcher(ctx: CommandContext): (workspaceId: string, objId: string) => Promise<Uint8Array> {
  return async (workspaceId, objId) => {
    const response = await fetch(`${gatewayOrigin(ctx.connection.endpoint)}/kapi/aiworkspace/asset/${encodeURIComponent(workspaceId)}/${encodeURIComponent(objId)}`, {
      headers: { Authorization: `Bearer ${await sessionToken(ctx)}` },
      signal: ctx.signal,
    })
    if (!response.ok) throw new ToolError('AIWS_ASSET_UNAVAILABLE', `asset ${objId}: HTTP ${response.status}`)
    return new Uint8Array(await response.arrayBuffer())
  }
}

/** Source problems (not refusals of the service) as a build failure with diagnostics. */
async function sourceErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof AiwsSourceError) throw new ToolError('BUILD_FAILED', `BUILD_FAILED: ${error.message}`, undefined, false, { data: { diagnostics: error.diagnostics } })
    throw error
  }
}

function list(input: Record<string, unknown>, key: string): string[] {
  return requiredInputString(input, key).split(',').map((s) => s.trim()).filter(Boolean)
}

const IDENT = /^did:[a-z0-9]+:[^/#\s]+#[a-z0-9][a-z0-9._-]{0,63}$/

/** A `--migration` file: `{ "<author_did>#<name>": Migration }` (aiworkspace schemas/migration.schema.json: `config` /
 * `bindings` `{ rename, drop, fill }`, `slots` `{ rename, move }`, `events` `{ rename, drop }`), passed as it is. */
async function migrationFile(ctx: CommandContext, path: string): Promise<Record<string, unknown>> {
  const host = getHost()
  let value: unknown
  try {
    value = JSON.parse(await host.readTextFile(host.path.resolve(ctx.cwd, path)))
  } catch (error) {
    throw new UsageError('AIWS_USAGE', `--migration ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
  const shape = `--migration ${path}: { "<author_did>#<name>": { config?, bindings?, slots?, events? } }`
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new UsageError('AIWS_USAGE', shape)
  for (const [ident, m] of Object.entries(value)) {
    if (!IDENT.test(ident) || !m || typeof m !== 'object' || Array.isArray(m) || Object.keys(m).some((k) => !['config', 'bindings', 'slots', 'events'].includes(k))) {
      throw new UsageError('AIWS_USAGE', `${shape} (at ${ident})`)
    }
  }
  return value as Record<string, unknown>
}

// ---- local source folders: a developer's or an Agent's own disk (files go inline; past 4 MiB per build the largest
// are uploaded and sent by reference, Q22)

const LOCAL_STATE = '.aiws-build.json'

async function isLocalDir(path: string): Promise<boolean> {
  try { return (await getHost().stat(path)).isDirectory } catch { return false }
}

/** The files of a local source folder, sub-folders included (names are relative paths; dot entries are skipped). */
async function localFiles(dir: string): Promise<{ name: string; bytes: Uint8Array }[]> {
  const host = getHost()
  const files: { name: string; bytes: Uint8Array }[] = []
  const problems: { file: string; severity: 'error'; message: string }[] = []
  const walk = async (folder: string, prefix: string, depth: number): Promise<void> => {
    for (const entry of await host.readDir(folder)) {
      if (entry.name.startsWith('.')) continue
      const name = `${prefix}${entry.name}`
      if (entry.isDirectory) {
        if (depth >= 8) problems.push({ file: name, severity: 'error', message: 'sub-folders nest at most 8 levels' })
        else await walk(host.path.join(folder, entry.name), `${name}/`, depth + 1)
      } else if (entry.isFile) files.push({ name, bytes: await host.readFile(host.path.join(folder, entry.name)) })
      else problems.push({ file: name, severity: 'error', message: 'only files and folders belong to a control source' })
    }
  }
  await walk(dir, '', 0)
  if (files.length === 0) problems.push({ file: '', severity: 'error', message: `${dir} holds no files` })
  if (problems.length > 0) throw new ToolError('BUILD_FAILED', `BUILD_FAILED: ${problems.map((p) => `${p.file}: ${p.message}`).join('; ')}`, undefined, false, { data: { diagnostics: problems } })
  return files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/** Put a source file too big to go inline into the caller's own `exports` bucket: the FileObject the build names (the
 * service reads it through the NDM gateway with the caller's token). */
function sourceUploader(ctx: CommandContext): (name: string, bytes: Uint8Array) => Promise<string> {
  return async (name, bytes) => {
    const bucket = `user/aiworkspace/${ctx.principal.id}/exports`
    const key = `aiws-src/${Date.now()}-${name.replaceAll('/', '_')}`
    const url = `${gatewayOrigin(ctx.connection.endpoint)}/bucket/v1/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`
    const response = await fetch(url, { method: 'PUT', headers: { Authorization: `Bearer ${await sessionToken(ctx)}` }, body: new Blob([bytes as Uint8Array<ArrayBuffer>]), signal: ctx.signal })
    if (!response.ok) throw new ToolError('AIWS_UPLOAD_FAILED', `upload of ${name}: HTTP ${response.status} ${await response.text().catch(() => '')}`)
    const put = await response.json() as { obj_id?: string }
    if (!put.obj_id) throw new ToolError('AIWS_UPLOAD_FAILED', `upload of ${name}: the bucket answered no obj_id`)
    return put.obj_id
  }
}

async function localState(dir: string): Promise<Record<string, unknown> | null> {
  try { return JSON.parse(await getHost().readTextFile(getHost().path.join(dir, LOCAL_STATE))) as Record<string, unknown> } catch { return null }
}

/** Build a local folder into a Workspace; the base it was built on is kept in its `.aiws-build.json`. */
async function buildLocal(ctx: CommandContext, ws: string, dir: string, opts: { folderId?: string; force?: boolean; dryRun?: boolean; migration?: Record<string, unknown> }): Promise<Record<string, unknown>> {
  const state = await localState(dir)
  const result = await aiws(ctx, 'ext.build', {
    workspace_id: ws, files: await sourceErrors(async () => packBuildFiles(await localFiles(dir), sourceUploader(ctx))),
    ...(opts.folderId ? { folder_id: opts.folderId } : {}),
    ...(state && state.workspace_id === ws ? { expect: { def_rev: state.def_rev, dir_rev: state.dir_rev } } : {}),
    ...(opts.force ? { force: true } : {}), ...(opts.dryRun ? { dry_run: true } : {}), ...(opts.migration ? { migration: opts.migration } : {}),
  })
  if (!opts.dryRun && typeof result.def_entity_id === 'string' && typeof result.def_rev === 'number') {
    await getHost().writeTextFile(getHost().path.join(dir, LOCAL_STATE), `${JSON.stringify({ workspace_id: ws, def_entity_id: result.def_entity_id, def_rev: result.def_rev, dir_rev: result.dir_rev ?? 0, ident: result.ident, at: new Date().toISOString() }, null, 2)}\n`)
  }
  return result
}

const buildCommand: CommandDefinition = {
  verb: 'build',
  summary: 'Build a control from its source folder (local, or in the Zone; component.json + files) into a Workspace; instances update, a failure commits nothing',
  description: 'The folder is a local folder (when it exists here; its files are sent inline, and past 4 MiB per build the largest are uploaded to your exports bucket and sent by reference) or a Zone path (e.g. /home/alice/AI Workspace/Demo/controls/kpi-card; --zone-path forces it); sub-folders are part of the source (file names are relative paths). The base of the last build or pull is kept in its .aiws-build.json; building over a newer Workspace version is refused (pull first, or --force). --watch rebuilds on every change until interrupted. A build that narrows what instances rely on (a binding renamed, a slot moved, an event dropped) takes --migration, a JSON file { "<author_did>#<name>": Migration } (as ext-upgrade).',
  positionals: [{ name: 'dir', description: 'Local folder, or Zone path of the control source folder', required: true }],
  options: [
    WORKSPACE_OPTION,
    { name: 'folder', property: 'folder_id', description: 'Data folder for the definition (default: data/extensions)', type: 'string' },
    { name: 'watch', property: 'watch', description: 'Rebuild whenever the folder changes', type: 'boolean' },
    { name: 'dry-run', property: 'dry_run', description: 'Check only: diagnostics, nothing committed', type: 'boolean' },
    { name: 'force', property: 'force', description: 'Build over whatever the Workspace holds now', type: 'boolean' },
    { name: 'zone-path', property: 'zone_path', description: 'Treat the folder as a Zone path even if a local folder has that name', type: 'boolean' },
    { name: 'migration', property: 'migration', description: 'JSON file { "<author_did>#<name>": Migration } rewriting the instances of a build that narrows the contract', type: 'string' },
  ],
  inputSchema: workspaceInput({ dir: { type: 'string', minLength: 1 }, folder_id: { type: 'string' }, watch: { type: 'boolean' }, dry_run: { type: 'boolean' }, force: { type: 'boolean' }, zone_path: { type: 'boolean' }, migration: { type: 'string' } }, ['dir']),
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: { mode: 'fixed', level: 'write' },
  asyncMode: 'sync',
  requiresSession: true,
  examples: ['buckyos aiws build "/home/alice/AI Workspace/Demo/controls/kpi-card" --workspace ws_abc', 'buckyos aiws build "/home/alice/AI Workspace/Demo/controls/kpi-card" --workspace ws_abc --watch'],
  handler: async (ctx, input) => {
    const ws = requiredInputString(input, 'workspace_id')
    const dir = requiredInputString(input, 'dir')
    const migration = inputString(input, 'migration')
    const opts = { folderId: inputString(input, 'folder_id'), force: input.force === true, dryRun: input.dry_run === true, upload: sourceUploader(ctx), ...(migration ? { migration: await migrationFile(ctx, migration) } : {}) }
    if (input.zone_path !== true && await isLocalDir(getHost().path.resolve(ctx.cwd, dir))) {
      const local = getHost().path.resolve(ctx.cwd, dir)
      if (input.watch === true) throw new UsageError('AIWS_USAGE', '--watch follows a Zone folder; rebuild a local folder yourself')
      return buildLocal(ctx, ws, local, opts)
    }
    const nfsp = await openHome(ctx)
    if (input.watch !== true) return sourceErrors(() => buildControl(extRpc(ctx), nfsp, ws, dir, opts))
    let builds = 0
    let failures = 0
    await watchControl(nfsp, dir, async () => {
      try {
        const r = await sourceErrors(() => buildControl(extRpc(ctx), nfsp, ws, dir, opts))
        builds++
        await ctx.io.stderr(`built ${r.ident} v${r.version ?? '?'} (${r.unchanged ? 'unchanged' : r.status})\n`)
      } catch (error) {
        failures++
        const diagnostics = error instanceof ToolError ? (error.details.data as { diagnostics?: unknown[] } | undefined)?.diagnostics : undefined
        await ctx.io.stderr(`build failed: ${error instanceof Error ? error.message : String(error)}\n${diagnostics ? `${JSON.stringify(diagnostics, null, 2)}\n` : ''}`)
      }
    }, { signal: ctx.signal })
    return { ok: true, watched: dir, builds, failures }
  },
}

const pullCommand: CommandDefinition = {
  verb: 'pull',
  summary: 'Write a control definition’s Workspace snapshot into a folder — a Zone path (default) or a local one (--local) — as the base of the next build',
  positionals: [{ name: 'def', description: 'Definition (buckyos.block-def) id', required: true }],
  options: [WORKSPACE_OPTION, { name: 'out', property: 'out', description: 'Folder to write (created)', type: 'string', required: true }, { name: 'local', property: 'local', description: 'Write into a local folder instead of the Zone', type: 'boolean' }],
  inputSchema: workspaceInput({ def: { type: 'string', minLength: 1 }, out: { type: 'string', minLength: 1 }, local: { type: 'boolean' } }, ['def', 'out']),
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: { mode: 'fixed', level: 'write' },
  asyncMode: 'sync',
  requiresSession: true,
  examples: ['buckyos aiws pull def_abc --workspace ws_abc --out "/home/alice/AI Workspace/Demo/controls/kpi-card"'],
  handler: async (ctx, input) => {
    if (input.local === true) {
      const ws = requiredInputString(input, 'workspace_id')
      const host = getHost()
      const out = host.path.resolve(ctx.cwd, requiredInputString(input, 'out'))
      const r = await aiws(ctx, 'ext.export', { workspace_id: ws, entity_ids: [requiredInputString(input, 'def')], purpose: 'pull' })
      const control = expectObject((r.controls as unknown[])[0], 'ext.export.controls[0]')
      await host.mkdir(out, { recursive: true })
      const fetchAsset = assetFetcher(ctx)
      const files: string[] = []
      for (const f of control.files as { name: string; obj_id?: string; text?: string }[]) {
        const target = host.path.join(out, ...f.name.split('/'))
        await host.mkdir(host.path.dirname(target), { recursive: true })
        if (f.text !== undefined) await host.writeTextFile(target, f.text)
        else await host.writeFile(target, await fetchAsset(ws, String(f.obj_id)))
        files.push(f.name)
      }
      await host.writeTextFile(host.path.join(out, LOCAL_STATE), `${JSON.stringify({ workspace_id: ws, def_entity_id: control.entity_id, def_rev: control.def_rev, dir_rev: control.dir_rev, ident: control.ident, at: new Date().toISOString() }, null, 2)}\n`)
      return { ok: true, out, files }
    }
    const nfsp = await openHome(ctx)
    const r = await pullControl(extRpc(ctx), nfsp, requiredInputString(input, 'workspace_id'), requiredInputString(input, 'def'), requiredInputString(input, 'out'), assetFetcher(ctx))
    return { ok: true, out: requiredInputString(input, 'out'), ...r }
  },
}

/** Run a verb of the pikg module (init / build / pack) with this command's context. */
async function pikgVerb(ctx: CommandContext, verb: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const command = createPikgModule().commands.find((c) => c.verb === verb)
  if (!command) throw new ToolError('INTERNAL', `pikg ${verb} is missing`)
  return expectObject(await command.handler(ctx, input), `pikg ${verb}`)
}

/** Bind a local `.pikg` into the caller's own `user/aiworkspace/<user>/exports` bucket (the data plane PUT, ≤ 32 MiB):
 * what `ext.install { pikg: { bucket_id, key } }` takes (and consumes once installed). */
async function uploadPackage(ctx: CommandContext, path: string): Promise<{ bucket_id: string; key: string }> {
  const bucket_id = `user/aiworkspace/${ctx.principal.id}/exports`
  const key = `aiws/${Date.now()}-${getHost().path.basename(path)}`
  const bytes = await getHost().readFile(path)
  if (bytes.byteLength > 32 * 1024 * 1024) throw new UsageError('FILE_TOO_LARGE', 'a control package installed from the CLI is limited to 32 MiB')
  const url = `${gatewayOrigin(ctx.connection.endpoint)}/bucket/v1/${bucket_id}/${key.split('/').map(encodeURIComponent).join('/')}`
  const response = await fetch(url, { method: 'PUT', headers: { Authorization: `Bearer ${await sessionToken(ctx)}` }, body: new Blob([bytes as Uint8Array<ArrayBuffer>]), signal: ctx.signal })
  if (!response.ok) throw new ToolError('AIWS_UPLOAD_FAILED', `upload of ${path}: HTTP ${response.status} ${await response.text().catch(() => '')}`)
  return { bucket_id, key }
}

const PACKAGE_INPUT: Record<string, JsonSchema> = { name: { type: 'string' }, version: { type: 'string' }, owner: { type: 'string' }, pikg: { type: 'boolean' }, install: { type: 'boolean' } }

function packageOptions(nameDefault: string): OptionDefinition[] {
  return [
    { name: 'name', property: 'name', description: `Package name (default: ${nameDefault})`, type: 'string' },
    { name: 'version', property: 'version', description: 'Package version (default 0.1.0)', type: 'string' },
    { name: 'owner', property: 'owner', description: 'Owner DID of the package (default did:bns:<you>)', type: 'string' },
    { name: 'pikg', property: 'pikg', description: 'Also pack the bundle as an aiws PIKG', type: 'boolean' },
    { name: 'install', property: 'install', description: 'Pack, then install into your AI Workspace library (dev mode)', type: 'boolean' },
  ]
}

const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0))

/** Write a bundle (manifest, `controls/<dir>/`, `templates/<id>/`) as `<out>/aiws/`. */
async function writeBundle(out: string, files: Map<string, Uint8Array>): Promise<string> {
  const host = getHost()
  const root = host.path.join(out, 'aiws')
  // a previous export's controls must not linger in the bundle
  await host.remove(root, { recursive: true }).catch(() => undefined)
  for (const [path, bytes] of files) {
    const target = host.path.join(root, path)
    await host.mkdir(host.path.dirname(target), { recursive: true })
    await host.writeFile(target, bytes)
  }
  return root
}

/** `--pikg` / `--install` of a bundle written into `<out>/aiws/`: pikg init (once) / build / pack in `<out>` (kind
 * aiws-controls); `--install` binds the `.pikg` into your aiworkspace exports bucket and calls `ext.install`. */
async function packBundle(ctx: CommandContext, input: Record<string, unknown>, out: string, defaultName: string, result: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (input.pikg !== true && input.install !== true) return result
  const host = getHost()
  const name = inputString(input, 'name') ?? defaultName
  const owner = inputString(input, 'owner') ?? `did:bns:${ctx.principal.id}`
  const version = inputString(input, 'version') ?? '0.1.0'
  const appJson = host.path.join(out, 'dapp_meta', 'app.json')
  const existing = await host.readTextFile(appJson).then((t) => JSON.parse(t) as Record<string, unknown>).catch(() => null)
  if (!existing) {
    await pikgVerb(ctx, 'init', { project_dir: out, name, owner, kind: 'aiws-controls', source: './aiws', version })
  } else if (inputString(input, 'version') && existing.version !== version) {
    // a re-export at a new version: the same project, the new version (a library refuses other content at an old one)
    await host.writeTextFile(appJson, `${JSON.stringify({ ...existing, version }, null, 2)}\n`)
    const pikgJson = host.path.join(out, 'dapp_meta', 'pikg.json')
    const meta = JSON.parse(await host.readTextFile(pikgJson)) as Record<string, unknown>
    await host.writeTextFile(pikgJson, `${JSON.stringify({ ...meta, pikg_file: `${existing.name}-${version}.pikg` }, null, 2)}\n`)
  }
  await pikgVerb(ctx, 'build', { meta_dir: host.path.join(out, 'dapp_meta') })
  const packed = await pikgVerb(ctx, 'pack', { dist_dir: host.path.join(out, 'dapp_dist') })
  const pikgPath = String(packed.pikg_path)
  result.pikg = pikgPath
  if (input.install !== true) return result
  result.install = await aiws(ctx, 'ext.install', { pikg: await uploadPackage(ctx, pikgPath), mode: 'dev' })
  return result
}

const controlSummary = (controls: Record<string, unknown>[]) => controls.map((c) => ({ ident: c.ident, kind: c.kind, version: c.version, digest: c.digest }))

const extExportCommand: CommandDefinition = {
  verb: 'ext-export',
  summary: 'Export Workspace controls as a bundle in a local folder; optionally pack it as an aiws PIKG and install it into your library',
  description: 'Writes <out>/aiws/ (aiws-manifest.json + controls/<dir>/). --pikg (or --install) also runs pikg init/build/pack in <out> (kind aiws-controls); --install binds the .pikg into your aiworkspace exports bucket and calls ext.install.',
  positionals: [{ name: 'defs', description: 'Definition (or instance) ids, comma-separated', required: true }],
  options: [
    WORKSPACE_OPTION,
    { name: 'out', property: 'out', description: 'Local folder to write into (created)', type: 'string', required: true },
    ...packageOptions('the first control’s'),
  ],
  inputSchema: workspaceInput({ defs: { type: 'string', minLength: 1 }, out: { type: 'string', minLength: 1 }, ...PACKAGE_INPUT }, ['defs', 'out']),
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: { mode: 'fixed', level: 'write' },
  asyncMode: 'sync',
  requiresSession: true,
  examples: ['buckyos aiws ext-export def_abc,def_xyz --workspace ws_abc --out ./kpi-pack --install'],
  handler: async (ctx, input) => {
    const out = getHost().path.resolve(ctx.cwd, requiredInputString(input, 'out'))
    const bundle = await exportBundle(extRpc(ctx), requiredInputString(input, 'workspace_id'), list(input, 'defs'), assetFetcher(ctx))
    const result: Record<string, unknown> = { ok: true, bundle: await writeBundle(out, bundle.files), controls: controlSummary(bundle.manifest.controls) }
    return packBundle(ctx, input, out, bundle.manifest.controls[0]?.name.replace(/[._]/g, '-') ?? 'controls', result)
  },
}

const extUpgradeCommand: CommandDefinition = {
  verb: 'ext-upgrade',
  summary: 'Upgrade controls a Workspace imported from your library to the version your library holds now (one Commit; instances keep their overrides and content)',
  description: 'Each definition is rebuilt from its package in your library (--pkg, or the package it was imported from), with what it builds on from the same package, dependencies first. A definition built locally since its import is refused (EXT_LOCAL_CHANGES; the error data lists the changed files) unless --force. A version that narrows what instances rely on needs --migration, a JSON file { "<author_did>#<name>": Migration } keyed by identity (config / bindings { rename, drop, fill }, slots { rename, move }, events { rename, drop }); --dry-run answers what it would write on each instance. Across Zones: `aiws library bundle <pkg_id> --out <file>` in the Zone of the library, then `aiws ext-import --bundle <file> --upgrade` in the Zone of the Workspace.',
  positionals: [{ name: 'defs', description: 'Definition (buckyos.block-def) ids, comma-separated', required: true }],
  options: [
    WORKSPACE_OPTION,
    { name: 'pkg', property: 'pkg_id', description: 'Library package to upgrade from (default: the one each definition was imported from)', type: 'string' },
    { name: 'migration', property: 'migration', description: 'JSON file { "<author_did>#<name>": Migration } rewriting the instances of a narrowing version', type: 'string' },
    { name: 'dry-run', property: 'dry_run', description: 'Check only: the plan per instance, nothing committed', type: 'boolean' },
    { name: 'force', property: 'force', description: 'Upgrade over local changes (they are replaced)', type: 'boolean' },
  ],
  inputSchema: workspaceInput({ defs: { type: 'string', minLength: 1 }, pkg_id: { type: 'string' }, migration: { type: 'string' }, dry_run: { type: 'boolean' }, force: { type: 'boolean' } }, ['defs']),
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: { mode: 'fixed', level: 'write' },
  asyncMode: 'sync',
  requiresSession: true,
  examples: ['buckyos aiws ext-upgrade def_abc --workspace ws_abc --dry-run', 'buckyos aiws ext-upgrade def_abc,def_xyz --workspace ws_abc --migration ./migration.json'],
  handler: async (ctx, input) => {
    const pkg = inputString(input, 'pkg_id')
    const migration = inputString(input, 'migration')
    return aiws(ctx, 'ext.upgrade', {
      workspace_id: requiredInputString(input, 'workspace_id'),
      items: list(input, 'defs').map((def_entity_id) => ({ def_entity_id, ...(pkg ? { pkg_id: pkg } : {}) })),
      ...(migration ? { migration: await migrationFile(ctx, migration) } : {}),
      ...(input.force === true ? { force: true } : {}), ...(input.dry_run === true ? { dry_run: true } : {}),
      ...(ctx.idempotencyKey ? { idempotency_key: ctx.idempotencyKey } : {}),
    })
  },
}

const libraryCommand: CommandDefinition = {
  verb: 'library',
  summary: 'Your AI Workspace control library: `list` (each control with the identities it depends on, `deps`, and the package’s templates), `install <file.pikg>` (an aiws package, dev mode), `remove <pkg_id>`, `bundle <pkg_id> --out <file.json>` (the controls with their bytes, for `ext-import --bundle` in another Zone)',
  positionals: [{ name: 'action', description: 'list | install | remove | bundle', required: true }, { name: 'target', description: 'install: local .pikg path; remove, bundle: package id', required: false }],
  options: [
    { name: 'out', property: 'out', description: 'bundle: the JSON file to write', type: 'string' },
    { name: 'idents', property: 'idents', description: 'bundle: only these controls (and what they build on), comma-separated identities', type: 'string' },
  ],
  inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'install', 'remove', 'bundle'] }, target: { type: 'string' }, out: { type: 'string' }, idents: { type: 'string' } }, required: ['action'], additionalProperties: false },
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: { mode: 'fixed', level: 'write' },
  asyncMode: 'sync',
  requiresSession: true,
  examples: ['buckyos aiws library list', 'buckyos aiws library install ./kpi-pack-0.1.0.pikg', 'buckyos aiws library remove kpi-pack.alice.bns.did', 'buckyos aiws library bundle kpi-pack.alice.bns.did --out ./kpi-pack.bundle.json'],
  handler: async (ctx, input) => {
    const action = requiredInputString(input, 'action')
    if (action === 'list') return aiws(ctx, 'ext.list_library', {})
    if (action === 'remove') return aiws(ctx, 'ext.uninstall', { pkg_id: requiredInputString(input, 'target') })
    if (action === 'bundle') {
      const host = getHost()
      const out = host.path.resolve(ctx.cwd, requiredInputString(input, 'out'))
      const idents = inputString(input, 'idents')
      const r = await aiws(ctx, 'ext.library_bundle', { pkg_id: requiredInputString(input, 'target'), ...(idents ? { idents: list(input, 'idents') } : {}) })
      const controls = (Array.isArray(r.controls) ? r.controls : []) as Record<string, unknown>[]
      await host.writeTextFile(out, `${JSON.stringify({ pkg_id: r.pkg_id, controls }, null, 2)}\n`)
      return { ok: true, out, pkg_id: r.pkg_id, controls: controls.map((c) => ({ ident: c.ident, version: c.version, digest: c.digest, deps: c.deps })) }
    }
    if (action !== 'install') throw new UsageError('AIWS_USAGE', 'library: list, install <file.pikg>, remove <pkg_id> or bundle <pkg_id> --out <file.json>')
    const path = getHost().path.resolve(ctx.cwd, requiredInputString(input, 'target'))
    return aiws(ctx, 'ext.install', { pikg: await uploadPackage(ctx, path), mode: 'dev' })
  },
}

interface BundleControl { ident: string; deps?: string[]; provenance?: Record<string, unknown>; files: { name: string; base64: string }[] }

/** Build the controls of a library bundle (`library bundle` in the Zone of the library) into a Workspace of this Zone:
 * their bytes with their `provenance`, what they build on first (README “Import” across Zones). `upgrade` replaces what
 * the Workspace holds of these identities (`migration` per identity, Q30); without it a dependency the Workspace already
 * holds from another source is met by that definition, as `ext.import` does. */
async function relayBundle(ctx: CommandContext, ws: string, controls: BundleControl[], opts: { folderId?: string; upgrade: boolean; migration?: Record<string, unknown> }): Promise<Record<string, unknown>[]> {
  const pending = [...controls]
  const needed = new Set(controls.flatMap((c) => c.deps ?? []))
  const out: Record<string, unknown>[] = []
  while (pending.length > 0) {
    const left = new Set(pending.map((c) => c.ident))
    const c = pending.splice(Math.max(0, pending.findIndex((p) => (p.deps ?? []).every((d) => !left.has(d) || d === p.ident))), 1)[0]
    try {
      const r = await aiws(ctx, 'ext.build', {
        workspace_id: ws, files: await sourceErrors(() => packBuildFiles(c.files.map((f) => ({ name: f.name, bytes: fromBase64(f.base64) })), sourceUploader(ctx))), provenance: c.provenance,
        ...(opts.folderId ? { folder_id: opts.folderId } : {}),
        ...(opts.upgrade ? { upgrade: true } : {}),
        ...(opts.migration?.[c.ident] ? { migration: { [c.ident]: opts.migration[c.ident] } } : {}),
      })
      out.push({ ident: c.ident, def_entity_id: r.def_entity_id, action: r.action ?? r.status, version: r.version })
    } catch (error) {
      if (opts.upgrade || !needed.has(c.ident) || !(error instanceof ToolError) || error.details.sub_code !== 'EXT_IDENT_EXISTS') throw error
      out.push({ ident: c.ident, def_entity_id: (error.details.data as { def_entity_id?: unknown } | undefined)?.def_entity_id, action: 'satisfied' })
    }
  }
  return out
}

const extImportCommand: CommandDefinition = {
  verb: 'ext-import',
  summary: 'Bring controls of your library into a Workspace (one Commit): <pkg_id>#<ident>, comma-separated; what they build on (deps) comes along, dependencies first, and an identity the Workspace already has satisfies it. --bundle builds a library bundle of another Zone instead',
  description: 'Across Zones: `aiws library bundle <pkg_id> --out <file>` in the Zone of the library, then `aiws ext-import --bundle <file> --workspace <ws>` in the Zone of the Workspace: each control is built with its package provenance, dependencies first; a dependency the Workspace already holds is met by that definition. --upgrade (with --bundle) upgrades the identities the Workspace holds from another version, --migration naming a JSON file { "<author_did>#<name>": Migration } for a version that narrows what instances rely on. Upgrades from your library in the same Zone are `aiws ext-upgrade`.',
  positionals: [{ name: 'items', description: '<pkg_id>#<author_did>#<name>[,…] (ext.list_library names them); not with --bundle', required: false }],
  options: [
    WORKSPACE_OPTION,
    { name: 'folder', property: 'folder_id', description: 'Data folder for the definitions (default: data/extensions)', type: 'string' },
    { name: 'bundle', property: 'bundle', description: 'A library bundle file (`aiws library bundle`, any Zone) to build instead of items', type: 'string' },
    { name: 'upgrade', property: 'upgrade', description: 'With --bundle: upgrade identities the Workspace holds from another version', type: 'boolean' },
    { name: 'migration', property: 'migration', description: 'With --upgrade: JSON file { "<author_did>#<name>": Migration }', type: 'string' },
  ],
  inputSchema: workspaceInput({ items: { type: 'string', minLength: 1 }, folder_id: { type: 'string' }, bundle: { type: 'string' }, upgrade: { type: 'boolean' }, migration: { type: 'string' } }),
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: { mode: 'fixed', level: 'write' },
  asyncMode: 'sync',
  requiresSession: true,
  examples: ['buckyos aiws ext-import kpi-pack.alice.bns.did#did:bns:alice#kpi-card --workspace ws_abc', 'buckyos aiws ext-import --bundle ./kpi-pack.bundle.json --workspace ws_abc --upgrade'],
  handler: async (ctx, input) => {
    const ws = requiredInputString(input, 'workspace_id')
    const folder = inputString(input, 'folder_id')
    const bundle = inputString(input, 'bundle')
    const migration = inputString(input, 'migration')
    if (migration && input.upgrade !== true) throw new UsageError('AIWS_USAGE', '--migration goes with --upgrade')
    if (!bundle) {
      if (input.upgrade === true) throw new UsageError('AIWS_USAGE', '--upgrade goes with --bundle (a library bundle of another Zone); upgrade what came from your own library with `aiws ext-upgrade`')
      const items = list(input, 'items').map((item) => {
        const cut = item.indexOf('#')
        if (cut <= 0) throw new UsageError('AIWS_USAGE', `${item}: <pkg_id>#<ident>`)
        return { pkg_id: item.slice(0, cut), ident: item.slice(cut + 1) }
      })
      return aiws(ctx, 'ext.import', { workspace_id: ws, items, ...(folder ? { folder_id: folder } : {}) })
    }
    if (inputString(input, 'items')) throw new UsageError('AIWS_USAGE', 'pass items or --bundle, not both')
    const host = getHost()
    const file = JSON.parse(await host.readTextFile(host.path.resolve(ctx.cwd, bundle))) as { controls?: unknown }
    if (!Array.isArray(file.controls) || file.controls.some((c) => !c || typeof c.ident !== 'string' || !Array.isArray(c.files))) {
      throw new UsageError('AIWS_USAGE', `--bundle ${bundle}: not a library bundle ({ pkg_id, controls: [{ ident, provenance, files }] }, from \`aiws library bundle\`)`)
    }
    const controls = await relayBundle(ctx, ws, file.controls as BundleControl[], { folderId: folder, upgrade: input.upgrade === true, ...(migration ? { migration: await migrationFile(ctx, migration) } : {}) })
    return { ok: true, controls }
  },
}

/** `template create --param k=v[,k=v…]`, typed by the template's `params` (string | number | boolean). */
function createParams(text: string, declared: Record<string, { type?: string }>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const pair of text.split(',').map((s) => s.trim()).filter(Boolean)) {
    const cut = pair.indexOf('=')
    const name = cut > 0 ? pair.slice(0, cut) : ''
    if (!Object.hasOwn(declared, name)) throw new UsageError('AIWS_USAGE', `--param ${pair}: the template's params are ${Object.keys(declared).join(', ') || '(none)'}`)
    out[name] = typedValue(declared[name].type, pair.slice(cut + 1), `--param ${pair}`)
  }
  return out
}

/** `template export --param name:type[:default][,…]`: the params a new Workspace is created with. */
function exportParams(text: string): Record<string, { type: string; default?: string | number | boolean }> {
  const out: Record<string, { type: string; default?: string | number | boolean }> = {}
  for (const item of text.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [name, type, ...rest] = item.split(':')
    if (!name || !['string', 'number', 'boolean'].includes(type)) throw new UsageError('AIWS_USAGE', `--param ${item}: <name>:<string | number | boolean>[:<default>]`)
    out[name] = { type, ...(rest.length > 0 ? { default: typedValue(type, rest.join(':'), `--param ${item}`) } : {}) }
  }
  return out
}

function typedValue(type: string | undefined, raw: string, label: string): string | number | boolean {
  if (type === 'number') {
    const n = Number(raw)
    if (!raw.trim() || !Number.isFinite(n)) throw new UsageError('AIWS_USAGE', `${label}: a number`)
    return n
  }
  if (type === 'boolean') {
    if (raw !== 'true' && raw !== 'false') throw new UsageError('AIWS_USAGE', `${label}: true or false`)
    return raw === 'true'
  }
  return raw
}

/** `template export`: the template snapshot (`ext.export_template`) and the controls it needs (`ext.export`, package)
 * as one bundle in `<out>/aiws/`, then packed / installed as `ext-export` does. */
async function exportTemplate(ctx: CommandContext, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const ws = requiredInputString(input, 'workspace_id')
  const id = requiredInputString(input, 'id')
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw new UsageError('AIWS_USAGE', `--id ${id}: [a-z0-9][a-z0-9-]{0,63}`)
  const description = inputString(input, 'description')
  const param = inputString(input, 'param')
  const template = {
    id, title: requiredInputString(input, 'title'), ...(description ? { description } : {}), ...(param ? { params: exportParams(param) } : {}),
    ...(inputString(input, 'reset') ? { reset: { tables: list(input, 'reset') } } : {}),
  }
  const out = getHost().path.resolve(ctx.cwd, requiredInputString(input, 'out'))
  const r = await aiws(ctx, 'ext.export_template', { workspace_id: ws, surfaces: list(input, 'surfaces'), ...(inputString(input, 'data') ? { data: list(input, 'data') } : {}), template })
  const item = expectObject(r.template, 'ext.export_template.template')
  const defs = (Array.isArray(r.controls) ? r.controls : []).map((c) => typeof c === 'string' ? c : String(expectObject(c, 'ext.export_template.controls[]').entity_id))
  const files = new Map<string, Uint8Array>()
  let manifest: Record<string, unknown> = { manifest_version: AIWS_MANIFEST_VERSION, purpose: 'aiws', host_api: {}, controls: [] }
  if (defs.length > 0) {
    const bundle = await exportBundle(extRpc(ctx), ws, defs, assetFetcher(ctx))
    for (const [path, bytes] of bundle.files) files.set(path, bytes)
    manifest = bundle.manifest
  }
  const dir = templateDir(id)
  for (const f of (Array.isArray(r.files) ? r.files : []) as { path: string; base64: string }[]) {
    const path = f.path.startsWith(dir) ? f.path : `${dir}${f.path}`
    if (!isSourcePath(path)) throw new ToolError('INVALID_SERVICE_RESPONSE', `ext.export_template: ${f.path} is not a file of the template`)
    files.set(path, fromBase64(f.base64))
  }
  manifest = { ...manifest, manifest_version: AIWS_MANIFEST_VERSION, workspace_templates: [item] }
  files.set(AIWS_MANIFEST_FILE, new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`))
  const result: Record<string, unknown> = {
    ok: true, bundle: await writeBundle(out, files), template: { id: item.id, title: item.title, digest: item.digest, requires: item.requires },
    controls: controlSummary(manifest.controls as Record<string, unknown>[]),
  }
  return packBundle(ctx, input, out, id, result)
}

const templateCommand: CommandDefinition = {
  verb: 'template',
  summary: 'Workspace templates (snapshots carried in control packages): `list` (the templates of your library), `create <pkg_id>#<template_id>` (a new Workspace from one: answers its workspace_id), `export` (Surfaces of a Workspace as a template bundle; --pikg / --install pack it with the controls it needs and install it)',
  description: 'create: --title names the new Workspace; --param k=v[,k=v…] sets the template’s params (typed as the template declares them; `template list` shows them). Installing a template never creates a Workspace; each create makes an independent one. export: --workspace, --surfaces s1,s2, --id and --title are required; --data e1,e2 carries data entities along, --param name:type[:default][,…] (type string | number | boolean) declares what a creator fills into {{params.<name>}}, --reset t1,t2 names tables a new Workspace starts without rows. It writes <out>/aiws/ (aiws-manifest.json at manifest_version 3 with the template in workspace_templates, controls/<dir>/ of the controls it needs, templates/<id>/), then packs and installs it as `ext-export` does.',
  positionals: [{ name: 'action', description: 'list | create | export', required: true }, { name: 'target', description: 'create: <pkg_id>#<template_id>', required: false }],
  options: [
    { name: 'workspace', property: 'workspace_id', description: 'export: Workspace id (ws_…)', type: 'string' },
    { name: 'surfaces', property: 'surfaces', description: 'export: Surface ids, comma-separated', type: 'string' },
    { name: 'id', property: 'id', description: 'export: template id ([a-z0-9][a-z0-9-]{0,63})', type: 'string' },
    { name: 'title', property: 'title', description: 'create: title of the new Workspace; export: title of the template', type: 'string' },
    { name: 'description', property: 'description', description: 'export: what the template is for', type: 'string' },
    { name: 'data', property: 'data', description: 'export: data entity ids to carry along, comma-separated', type: 'string' },
    { name: 'param', property: 'param', description: 'create: k=v[,k=v…]; export: name:type[:default][,…]', type: 'string' },
    { name: 'reset', property: 'reset', description: 'export: tables a new Workspace starts without rows, comma-separated', type: 'string' },
    { name: 'out', property: 'out', description: 'export: local folder to write into (created)', type: 'string' },
    ...packageOptions('the template id'),
  ],
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'create', 'export'] }, target: { type: 'string' }, workspace_id: { type: 'string' }, surfaces: { type: 'string' }, id: { type: 'string' },
      title: { type: 'string' }, description: { type: 'string' }, data: { type: 'string' }, param: { type: 'string' }, reset: { type: 'string' }, out: { type: 'string' }, ...PACKAGE_INPUT,
    },
    required: ['action'],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: { mode: 'fixed', level: 'write' },
  asyncMode: 'sync',
  requiresSession: true,
  examples: [
    'buckyos aiws template list',
    'buckyos aiws template create team-pack.alice.bns.did#team-board --title "Ops board" --param team_name=Ops',
    'buckyos aiws template export --workspace ws_abc --surfaces sf_board --id team-board --title "Team task board" --param team_name:string:Team --reset tasks --out ./team-pack --install',
  ],
  handler: async (ctx, input) => {
    const action = requiredInputString(input, 'action')
    if (action === 'list') {
      const library = await aiws(ctx, 'ext.list_library', {})
      const packages = (Array.isArray(library.packages) ? library.packages : []) as { pkg_id: string; version?: string; templates?: Record<string, unknown>[] }[]
      return { ok: true, templates: packages.flatMap((p) => (p.templates ?? []).map((t) => ({ ref: `${p.pkg_id}#${t.id}`, pkg_id: p.pkg_id, version: p.version, ...t }))) }
    }
    if (action === 'export') return exportTemplate(ctx, input)
    if (action !== 'create') throw new UsageError('AIWS_USAGE', 'template: list, create <pkg_id>#<template_id> or export --workspace <ws> --surfaces <ids> --id <id> --title <title> --out <dir>')
    const target = requiredInputString(input, 'target')
    const cut = target.indexOf('#')
    if (cut <= 0 || cut === target.length - 1) throw new UsageError('AIWS_USAGE', `${target}: <pkg_id>#<template_id>`)
    const [pkg_id, template_id] = [target.slice(0, cut), target.slice(cut + 1)]
    const param = inputString(input, 'param')
    let params: Record<string, string | number | boolean> | undefined
    if (param) {
      const library = await aiws(ctx, 'ext.list_library', {})
      const packages = (Array.isArray(library.packages) ? library.packages : []) as { pkg_id: string; templates?: { id: string; params?: Record<string, { type?: string }> }[] }[]
      const found = packages.find((p) => p.pkg_id === pkg_id)?.templates?.find((t) => t.id === template_id)
      if (!found) throw new UsageError('AIWS_USAGE', `${target} is not a template of your library (aiws template list)`)
      params = createParams(param, found.params ?? {})
    }
    const title = inputString(input, 'title')
    return aiws(ctx, 'ext.create_from_template', { pkg_id, template_id, ...(title ? { title } : {}), ...(params ? { params } : {}) })
  },
}

export function createAiwsModule(): CommandModule {
  return {
    name: 'aiws',
    summary: 'AI Workspace: find and read a workspace by path (ls, find, grep, stat, cat, resolve, read), its permissions (acl, acl-edit), query its tables in SQL (sql), write tables, rich text and common properties (table, text, mv, rename, set-prop), your to-do list and calendar (todo, cal), Block-controls (catalogue, import, export), extension controls (build, pull, export, library, import, upgrade), Workspace templates (list, create, export), and execute wish runs as their executor (claim, heartbeat, report)',
    commands: [infoCommand, lsCommand, findCommand, grepCommand, statCommand, aclCommand, aclEditCommand, catCommand, resolveCommand, readCommand, sqlCommand, tableCommand, textCommand, mvCommand, renameCommand, setPropCommand, todoCommand, calCommand, placeCommand, controlsCommand, importCommand, exportCommand, buildCommand, pullCommand, extExportCommand, libraryCommand, extImportCommand, extUpgradeCommand, templateCommand, runGetCommand, runClaimCommand, runHeartbeatCommand, runFilesCommand, runToolCommand, runExecCommand, runProgramCommand, runReportCommand, runStartCommand],
  }
}
