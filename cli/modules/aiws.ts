import type { CommandDefinition, CommandModule, JsonSchema, OptionDefinition, PositionalDefinition } from '../core/command.ts'
import type { CommandContext } from '../core/context.ts'
import { ToolError, UsageError } from '../core/errors.ts'
import { callService, expectObject, inputString, requiredInputString } from '../core/service.ts'
import { getHost } from '../runtime/host.ts'

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
    throw new ToolError(code, `${code}${typeof error.sub_code === 'string' ? `/${error.sub_code}` : ''}: ${detail}`)
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

export function createAiwsModule(): CommandModule {
  return {
    name: 'aiws',
    summary: 'AI Workspace: read a workspace, and execute wish runs as their executor (claim, heartbeat, report)',
    commands: [infoCommand, readCommand, queryCommand, runGetCommand, runClaimCommand, runHeartbeatCommand, runFilesCommand, runToolCommand, runProgramCommand, runReportCommand],
  }
}
