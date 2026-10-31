import {
  AiwsSourceError,
  buildControl,
  exportBundle,
  NfspClient,
  packBuildFiles,
  pullControl,
  watchControl,
} from 'buckyos/node'
import type { CommandDefinition, CommandModule, JsonSchema, OptionDefinition, PositionalDefinition } from '../core/command.ts'
import type { CommandContext } from '../core/context.ts'
import { EXIT_AUTH, ToolError, UsageError } from '../core/errors.ts'
import { callService, expectObject, inputString, requiredInputString } from '../core/service.ts'
import { getHost } from '../runtime/host.ts'
import { createPikgModule } from './pikg.ts'
import { gatewayOrigin } from './share.ts'

// AI Workspace (`/kapi/aiworkspace`): reading a workspace, and the executor protocol of a wish run
// (内核架构改进 M3): claim → heartbeat → report. Source of truth for the methods:
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

const readCommand: CommandDefinition = {
  verb: 'read',
  summary: 'Read one entity of a workspace (envelope and content)',
  positionals: [{ name: 'entity_id', description: 'Entity id', required: true } satisfies PositionalDefinition],
  options: [WORKSPACE_OPTION, { name: 'selector', property: 'selector', description: 'Selector JSON, e.g. {"kind":"table_record","record_id":"r1"}', type: 'string' }],
  inputSchema: workspaceInput({ entity_id: { type: 'string', minLength: 1 }, selector: { type: 'string' } }, ['entity_id']),
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: { mode: 'fixed', level: 'read' },
  asyncMode: 'sync',
  requiresSession: true,
  examples: ['buckyos aiws read orders --workspace ws_abc'],
  handler: (ctx, input) => {
    const selector = inputString(input, 'selector')
    return aiws(ctx, 'doc.read', { workspace_id: requiredInputString(input, 'workspace_id'), entity_id: requiredInputString(input, 'entity_id'), ...(selector ? { selector: JSON.parse(selector) } : {}) })
  },
}

const queryCommand: CommandDefinition = {
  verb: 'query',
  summary: 'Query the rows of a table (or through a saved view)',
  options: [
    WORKSPACE_OPTION,
    { name: 'source', property: 'source_id', description: 'Table entity id', type: 'string' },
    { name: 'view', property: 'view_id', description: 'Table view (Block) id', type: 'string' },
    { name: 'filter', property: 'filter', description: 'Filter JSON (README: doc.query)', type: 'string' },
    { name: 'limit', property: 'limit', description: 'Rows per page (≤ 1000)', type: 'integer' },
    { name: 'cursor', property: 'cursor', description: 'Continue from a previous page', type: 'string' },
  ],
  inputSchema: workspaceInput({ source_id: { type: 'string' }, view_id: { type: 'string' }, filter: { type: 'string' }, limit: { type: 'integer' }, cursor: { type: 'string' } }),
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: { mode: 'fixed', level: 'read' },
  asyncMode: 'sync',
  requiresSession: true,
  examples: ['buckyos aiws query --workspace ws_abc --source orders --limit 100'],
  handler: (ctx, input) => {
    const params: Record<string, unknown> = { workspace_id: requiredInputString(input, 'workspace_id') }
    for (const key of ['source_id', 'view_id', 'cursor']) { const value = inputString(input, key); if (value) params[key] = value }
    const filter = inputString(input, 'filter')
    if (filter) params.filter = JSON.parse(filter)
    if (typeof input.limit === 'number') params.limit = input.limit
    if (!params.source_id && !params.view_id) throw new UsageError('AIWS_USAGE', 'pass --source or --view')
    return aiws(ctx, 'doc.query', params)
  },
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
  summary: 'Write the stage of a claimed run into a directory: the snapshot (context/), request.json, the Renderer catalog and the program host (lib/)',
  description: 'Run the program there the way the service does: `deno run -A lib/run.js` reads program/main.js and writes output/.aiws/results.json.',
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
    return { dir, files: written }
  },
}

const runToolCommand: CommandDefinition = {
  verb: 'run-tool',
  summary: 'Call one stage tool of a claimed run (ws_profile, ws_read, ws_query, submit_analysis, put_result, check_results, finish, …): the service answers as it answers the model',
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

const runProgramCommand: CommandDefinition = {
  verb: 'run-program',
  summary: 'Hand in a program run: the program source, what lib/run.js wrote to output/.aiws/results.json, the files under output/ and the log; the service validates it like its own run_program',
  options: [
    WORKSPACE_OPTION, RUN_OPTION, ATTEMPT_OPTION,
    { name: 'dir', property: 'dir', description: 'The stage directory written by run-files (program/main.js, output/)', type: 'string', required: true },
    { name: 'log-file', property: 'log_file', description: 'Path of the program log to attach (stdout/stderr of deno run)', type: 'string' },
  ],
  inputSchema: workspaceInput({ run_id: { type: 'string', minLength: 1 }, attempt: { type: 'integer', minimum: 1 }, dir: { type: 'string', minLength: 1 }, log_file: { type: 'string' } }, ['run_id', 'attempt', 'dir']),
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: { mode: 'fixed', level: 'write' },
  asyncMode: 'sync',
  requiresSession: true,
  examples: ['buckyos aiws run-program --workspace ws_abc --run run_xyz --attempt 1 --dir work --log-file work/run.log'],
  handler: async (ctx, input) => {
    const dir = requiredInputString(input, 'dir')
    const host = getHost()
    const source = await host.readTextFile(`${dir}/program/main.js`)
    let results: unknown = null
    try { results = JSON.parse(await host.readTextFile(`${dir}/output/.aiws/results.json`)) } catch { results = null }
    const logFile = inputString(input, 'log_file')
    const log = logFile ? await host.readTextFile(logFile).catch(() => '') : ''
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
    return aiws(ctx, 'proc.program', { workspace_id: requiredInputString(input, 'workspace_id'), run_id: requiredInputString(input, 'run_id'), attempt: input.attempt, source, results, log, files })
  },
}

const runReportCommand: CommandDefinition = {
  verb: 'run-report',
  summary: 'End a claimed run: --finished after the stage tools accepted the work (submit_analysis / finish), or the candidate itself (results / analysis), or a failure',
  description: 'The service validates and plans what is reported; the user confirms it in the workspace. A superseded attempt or a cancelled run gets RUN_REVOKED.',
  options: [
    WORKSPACE_OPTION, RUN_OPTION, ATTEMPT_OPTION,
    { name: 'finished', property: 'finished', description: 'The stage is done: what the tools collected becomes the candidate', type: 'boolean' },
    { name: 'results', property: 'results', description: 'Results JSON array (execute runs): [{ name, type, title?, content, config? }]', type: 'string' },
    { name: 'results-file', property: 'results_file', description: 'Path of a JSON file holding the results array', type: 'string' },
    { name: 'analysis', property: 'analysis', description: 'Analysis JSON (analyze runs, wish.analysis.v2)', type: 'string' },
    { name: 'analysis-file', property: 'analysis_file', description: 'Path of a JSON file holding the analysis', type: 'string' },
    { name: 'summary', property: 'summary', description: 'One paragraph on what was done', type: 'string' },
    { name: 'warning', property: 'warnings', description: 'A warning for the user (repeatable)', type: 'string' },
    { name: 'error', property: 'error', description: 'Report a failure instead: its reason', type: 'string' },
  ],
  inputSchema: workspaceInput({ run_id: { type: 'string', minLength: 1 }, attempt: { type: 'integer', minimum: 1 }, finished: { type: 'boolean' }, results: { type: 'string' }, results_file: { type: 'string' }, analysis: { type: 'string' }, analysis_file: { type: 'string' }, summary: { type: 'string' }, warnings: { type: 'string' }, error: { type: 'string' } }, ['run_id', 'attempt']),
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: { mode: 'fixed', level: 'write' },
  asyncMode: 'sync',
  requiresSession: true,
  examples: [
    'buckyos aiws run-report --workspace ws_abc --run run_xyz --attempt 1 --finished',
    'buckyos aiws run-report --workspace ws_abc --run run_xyz --attempt 1 --results-file out/results.json --summary "monthly totals and a commentary"',
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
    } else if (inputString(input, 'analysis') || inputString(input, 'analysis_file')) {
      params.analysis = await jsonInput(input, 'analysis', 'analysis_file', 'an analysis')
    } else {
      params.results = await jsonInput(input, 'results', 'results_file', 'results')
      params.read_set = []
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
async function buildLocal(ctx: CommandContext, ws: string, dir: string, opts: { folderId?: string; force?: boolean; dryRun?: boolean }): Promise<Record<string, unknown>> {
  const state = await localState(dir)
  const result = await aiws(ctx, 'ext.build', {
    workspace_id: ws, files: await sourceErrors(async () => packBuildFiles(await localFiles(dir), sourceUploader(ctx))),
    ...(opts.folderId ? { folder_id: opts.folderId } : {}),
    ...(state && state.workspace_id === ws ? { expect: { def_rev: state.def_rev, dir_rev: state.dir_rev } } : {}),
    ...(opts.force ? { force: true } : {}), ...(opts.dryRun ? { dry_run: true } : {}),
  })
  if (!opts.dryRun && typeof result.def_entity_id === 'string' && typeof result.def_rev === 'number') {
    await getHost().writeTextFile(getHost().path.join(dir, LOCAL_STATE), `${JSON.stringify({ workspace_id: ws, def_entity_id: result.def_entity_id, def_rev: result.def_rev, dir_rev: result.dir_rev ?? 0, ident: result.ident, at: new Date().toISOString() }, null, 2)}\n`)
  }
  return result
}

const buildCommand: CommandDefinition = {
  verb: 'build',
  summary: 'Build a control from its source folder (local, or in the Zone; component.json + files) into a Workspace; instances update, a failure commits nothing',
  description: 'The folder is a local folder (when it exists here; its files are sent inline, and past 4 MiB per build the largest are uploaded to your exports bucket and sent by reference) or a Zone path (e.g. /home/alice/AI Workspace/Demo/controls/kpi-card; --zone-path forces it); sub-folders are part of the source (file names are relative paths). The base of the last build or pull is kept in its .aiws-build.json; building over a newer Workspace version is refused (pull first, or --force). --watch rebuilds on every change until interrupted.',
  positionals: [{ name: 'dir', description: 'Local folder, or Zone path of the control source folder', required: true }],
  options: [
    WORKSPACE_OPTION,
    { name: 'folder', property: 'folder_id', description: 'Data folder for the definition (default: data/extensions)', type: 'string' },
    { name: 'watch', property: 'watch', description: 'Rebuild whenever the folder changes', type: 'boolean' },
    { name: 'dry-run', property: 'dry_run', description: 'Check only: diagnostics, nothing committed', type: 'boolean' },
    { name: 'force', property: 'force', description: 'Build over whatever the Workspace holds now', type: 'boolean' },
    { name: 'zone-path', property: 'zone_path', description: 'Treat the folder as a Zone path even if a local folder has that name', type: 'boolean' },
  ],
  inputSchema: workspaceInput({ dir: { type: 'string', minLength: 1 }, folder_id: { type: 'string' }, watch: { type: 'boolean' }, dry_run: { type: 'boolean' }, force: { type: 'boolean' }, zone_path: { type: 'boolean' } }, ['dir']),
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: { mode: 'fixed', level: 'write' },
  asyncMode: 'sync',
  requiresSession: true,
  examples: ['buckyos aiws build "/home/alice/AI Workspace/Demo/controls/kpi-card" --workspace ws_abc', 'buckyos aiws build "/home/alice/AI Workspace/Demo/controls/kpi-card" --workspace ws_abc --watch'],
  handler: async (ctx, input) => {
    const ws = requiredInputString(input, 'workspace_id')
    const dir = requiredInputString(input, 'dir')
    const opts = { folderId: inputString(input, 'folder_id'), force: input.force === true, dryRun: input.dry_run === true, upload: sourceUploader(ctx) }
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

const extExportCommand: CommandDefinition = {
  verb: 'ext-export',
  summary: 'Export Workspace controls as a bundle in a local folder; optionally pack it as an aiws PIKG and install it into your library',
  description: 'Writes <out>/aiws/ (aiws-manifest.json + controls/<dir>/). --pikg (or --install) also runs pikg init/build/pack in <out> (kind aiws-controls); --install binds the .pikg into your aiworkspace exports bucket and calls ext.install.',
  positionals: [{ name: 'defs', description: 'Definition (or instance) ids, comma-separated', required: true }],
  options: [
    WORKSPACE_OPTION,
    { name: 'out', property: 'out', description: 'Local folder to write into (created)', type: 'string', required: true },
    { name: 'name', property: 'name', description: 'Package name (default: the first control’s)', type: 'string' },
    { name: 'version', property: 'version', description: 'Package version (default 0.1.0)', type: 'string' },
    { name: 'owner', property: 'owner', description: 'Owner DID of the package (default did:bns:<you>)', type: 'string' },
    { name: 'pikg', property: 'pikg', description: 'Also pack the bundle as an aiws PIKG', type: 'boolean' },
    { name: 'install', property: 'install', description: 'Pack, then install into your AI Workspace library (dev mode)', type: 'boolean' },
  ],
  inputSchema: workspaceInput({ defs: { type: 'string', minLength: 1 }, out: { type: 'string', minLength: 1 }, name: { type: 'string' }, version: { type: 'string' }, owner: { type: 'string' }, pikg: { type: 'boolean' }, install: { type: 'boolean' } }, ['defs', 'out']),
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: { mode: 'fixed', level: 'write' },
  asyncMode: 'sync',
  requiresSession: true,
  examples: ['buckyos aiws ext-export def_abc,def_xyz --workspace ws_abc --out ./kpi-pack --install'],
  handler: async (ctx, input) => {
    const ws = requiredInputString(input, 'workspace_id')
    const host = getHost()
    const out = host.path.resolve(ctx.cwd, requiredInputString(input, 'out'))
    const bundle = await exportBundle(extRpc(ctx), ws, list(input, 'defs'), assetFetcher(ctx))
    const root = host.path.join(out, 'aiws')
    // a previous export's controls must not linger in the bundle
    await host.remove(root, { recursive: true }).catch(() => undefined)
    for (const [path, bytes] of bundle.files) {
      const target = host.path.join(root, path)
      await host.mkdir(host.path.dirname(target), { recursive: true })
      await host.writeFile(target, bytes)
    }
    const result: Record<string, unknown> = { ok: true, bundle: root, controls: bundle.manifest.controls.map((c: Record<string, unknown>) => ({ ident: c.ident, kind: c.kind, version: c.version, digest: c.digest })) }
    if (input.pikg !== true && input.install !== true) return result
    const name = inputString(input, 'name') ?? bundle.manifest.controls[0]?.name.replace(/[._]/g, '-') ?? 'controls'
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
  },
}

const libraryCommand: CommandDefinition = {
  verb: 'library',
  summary: 'Your AI Workspace control library: `list` (each control with the identities it depends on, `deps`), `install <file.pikg>` (an aiws package, dev mode), `remove <pkg_id>`',
  positionals: [{ name: 'action', description: 'list | install | remove', required: true }, { name: 'target', description: 'install: local .pikg path; remove: package id', required: false }],
  options: [],
  inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'install', 'remove'] }, target: { type: 'string' } }, required: ['action'], additionalProperties: false },
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: { mode: 'fixed', level: 'write' },
  asyncMode: 'sync',
  requiresSession: true,
  examples: ['buckyos aiws library list', 'buckyos aiws library install ./kpi-pack-0.1.0.pikg', 'buckyos aiws library remove kpi-pack.alice.bns.did'],
  handler: async (ctx, input) => {
    const action = requiredInputString(input, 'action')
    if (action === 'list') return aiws(ctx, 'ext.list_library', {})
    if (action === 'remove') return aiws(ctx, 'ext.uninstall', { pkg_id: requiredInputString(input, 'target') })
    if (action !== 'install') throw new UsageError('AIWS_USAGE', 'library: list, install <file.pikg> or remove <pkg_id>')
    const path = getHost().path.resolve(ctx.cwd, requiredInputString(input, 'target'))
    return aiws(ctx, 'ext.install', { pikg: await uploadPackage(ctx, path), mode: 'dev' })
  },
}

const extImportCommand: CommandDefinition = {
  verb: 'ext-import',
  summary: 'Bring controls of your library into a Workspace (one Commit): <pkg_id>#<ident>, comma-separated; what they build on (deps) comes along, dependencies first, and an identity the Workspace already has satisfies it',
  positionals: [{ name: 'items', description: '<pkg_id>#<author_did>#<name>[,…] (ext.list_library names them)', required: true }],
  options: [WORKSPACE_OPTION, { name: 'folder', property: 'folder_id', description: 'Data folder for the definitions (default: data/extensions)', type: 'string' }],
  inputSchema: workspaceInput({ items: { type: 'string', minLength: 1 }, folder_id: { type: 'string' } }, ['items']),
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: { mode: 'fixed', level: 'write' },
  asyncMode: 'sync',
  requiresSession: true,
  examples: ['buckyos aiws ext-import kpi-pack.alice.bns.did#did:bns:alice#kpi-card --workspace ws_abc'],
  handler: (ctx, input) => {
    const items = list(input, 'items').map((item) => {
      const cut = item.indexOf('#')
      if (cut <= 0) throw new UsageError('AIWS_USAGE', `${item}: <pkg_id>#<ident>`)
      return { pkg_id: item.slice(0, cut), ident: item.slice(cut + 1) }
    })
    const folder = inputString(input, 'folder_id')
    return aiws(ctx, 'ext.import', { workspace_id: requiredInputString(input, 'workspace_id'), items, ...(folder ? { folder_id: folder } : {}) })
  },
}

export function createAiwsModule(): CommandModule {
  return {
    name: 'aiws',
    summary: 'AI Workspace: read a workspace, Block-controls (catalogue, import, export), extension controls (build, pull, export, library, import), and execute wish runs as their executor (claim, heartbeat, report)',
    commands: [infoCommand, readCommand, queryCommand, controlsCommand, importCommand, exportCommand, buildCommand, pullCommand, extExportCommand, libraryCommand, extImportCommand, runGetCommand, runClaimCommand, runHeartbeatCommand, runFilesCommand, runToolCommand, runProgramCommand, runReportCommand],
  }
}
