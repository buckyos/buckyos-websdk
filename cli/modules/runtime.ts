import type { CommandDefinition, CommandModule, JsonSchema, OptionDefinition } from '../core/command.ts'
import type { CommandContext } from '../core/context.ts'
import { EXIT_OPERATION, EXIT_PERMISSION, EXIT_UNAVAILABLE, normalizeError, ToolError, UsageError } from '../core/errors.ts'
import { callService, expectObject, inputString, requiredInputString } from '../core/service.ts'
import { agentIdFrom } from './skill.ts'

const CONTROL_PANEL = 'control-panel'
const OBJECT_OUTPUT: JsonSchema = { type: 'object', additionalProperties: true }
const ID: JsonSchema = { type: 'string', minLength: 1 }
const DEVICE_PREFIX = 'exec-'
const AGENT_RUNTIME_ACTIONS = ['list', 'enable', 'disable', 'default']

const AGENT_OPTION: OptionDefinition = {
  name: 'agent',
  property: 'agent_id',
  description: 'Agent ID as `agent list` prints it',
  type: 'string',
  required: true,
}

type Row = Record<string, string>
type Json = Record<string, unknown>

function objects(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object' && !Array.isArray(item)) as Json[] : []
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : []
}

function time(value: unknown): string {
  return typeof value === 'number' && value > 0 ? new Date(value).toISOString() : ''
}

function allows(roots: unknown, mode: string, computer: unknown, baseline: unknown): string {
  return [
    strings(roots).join(',') || '-',
    mode,
    ...(computer && computer !== 'none' ? [`computer=${computer}`] : []),
    ...(baseline ? [`baseline=${baseline}`] : []),
  ].join(' ')
}

/** `runtime list` as a table: one row per runtime of the caller's directory (`agent.runtime_catalog`). */
export function catalogRows(runtimes: Json[]): Row[] {
  return runtimes.map((runtime) => ({
    id: String(runtime.runtime_id ?? ''),
    kind: runtime.kind === 'executor' ? 'device' : String(runtime.kind ?? ''),
    name: String(runtime.name ?? ''),
    state: runtime.closed === true ? 'closed' : 'open',
    online: runtime.online === true ? 'yes' : runtime.online === false ? 'no' : '',
    expires: time(runtime.expires_at_ms),
    allows: allows(runtime.workdir_roots, runtime.read_only === true ? 'ro' : 'rw', runtime.computer, runtime.baseline),
    agents: objects(runtime.assigned_to)
      .map((agent) => `${agent.enabled === true ? '*' : ''}${agent.agent_id}${agent.default === true ? ' (default)' : ''}`)
      .join(', '),
  }))
}

/** `agent runtime list` from the Agent's own records: the current ones (private first), then the retired ones. */
export function splitAgentRuntimes(records: Json[]): { current: Json[]; history: Json[] } {
  const current = records.filter((record) => record.lifecycle !== 'retired')
  return {
    current: [...current.filter((record) => record.runtime_id === 'private'), ...current.filter((record) => record.runtime_id !== 'private')],
    history: records.filter((record) => record.lifecycle === 'retired'),
  }
}

export function agentRuntimeRows(records: Json[], settings: Json): Row[] {
  const { current, history } = splitAgentRuntimes(records)
  return [...current, ...history].map((record) => {
    const caps = (record.caps ?? {}) as Json
    const grant = (record.grant ?? {}) as Json
    const usage = (record.usage ?? {}) as Json
    const connector = (record.connector ?? {}) as Json
    const retired = record.lifecycle === 'retired'
    return {
      id: String(record.runtime_id ?? ''),
      name: String(record.name ?? ''),
      type: String(connector.type ?? ''),
      state: retired ? 'retired' : record.enabled === false ? 'off' : String(record.availability ?? 'on'),
      default: !retired && (record.default === true || record.runtime_id === settings.default_runtime_id) ? '*' : '',
      os: String(caps.os ?? ''),
      allows: allows(grant.roots, strings(grant.ops).join(',') || '-', grant.computer, caps.baseline),
      expires: time(grant.expires_at_ms),
      sessions: String(usage.sessions_total ?? 0),
      workspaces: String(usage.workspaces ?? 0),
      last_used: time(usage.last_used_at_ms),
    }
  })
}

/** `agent runtime list` when the Agent's service cannot be reached: what the control panel has assigned to it. */
export function directoryRows(runtimes: Json[], directory: Json): Row[] {
  return runtimes.map((runtime) => ({
    id: String(runtime.runtime_id ?? ''),
    name: String(runtime.name ?? ''),
    type: runtime.kind === 'executor' ? 'device' : String(runtime.kind ?? ''),
    state: runtime.withdrawn === true ? 'withdrawn' : runtime.enabled === true ? (runtime.closed === true ? 'closed' : 'on') : 'off',
    default: runtime.runtime_id === directory.default_runtime_id ? '*' : '',
    os: String(runtime.os ?? ''),
    allows: allows(runtime.workdir_roots, runtime.read_only === true ? 'ro' : 'rw', runtime.computer, runtime.baseline),
    expires: time(runtime.expires_at_ms),
  }))
}

/** What switching a runtime off or removing it touches (`runtimes.impact`), as the lines shown before the question. */
export function impactText(agentId: string, impact: Json): string {
  const sessions = objects(impact.active_sessions)
  const todos = objects(impact.pending_todos)
  const workspaces = objects(impact.workspaces)
  const lines = [
    `Runtime ${impact.runtime_id} of ${agentId}: ${sessions.length} session(s) in progress, ${todos.length} Todo(s) waiting, ${workspaces.length} workspace(s)` +
    (impact.owner_default === true ? '; it is the default runtime' : ''),
  ]
  for (const session of sessions) {
    lines.push(`  session ${session.session_id} [${session.kind}${session.class ? `/${session.class}` : ''}, ${session.run_state}] ${session.title ?? ''}`)
  }
  for (const todo of todos) lines.push(`  todo ${todo.session_id}/${todo.todo_id} [${todo.status}] ${todo.title ?? ''}`)
  for (const workspace of workspaces) {
    lines.push(`  workspace ${workspace.workspace_id} ${workspace.name ?? ''} ${workspace.directory ?? ''} [${workspace.lifecycle ?? ''}]`)
  }
  if (sessions.length + todos.length + workspaces.length > 0) lines.push('  None of them is moved to another runtime.')
  return `${lines.join('\n')}\n`
}

/** `exec-<executor_id>` for a device named by its runtime id or its executor id; a node runtime is refused. */
export function deviceOf(given: string, runtimes: Json[]): { runtime_id: string; executor_id: string; runtime?: Json } {
  const runtime = runtimes.find((item) => item.runtime_id === given || (item.executor_id && item.executor_id === given))
  if (runtime ? runtime.kind !== 'executor' : given === 'host' || given === 'private' || given.startsWith('node-')) {
    throw new UsageError('INVALID_ARGUMENT', `${given} is not a device: only device runtimes (${DEVICE_PREFIX}<executor_id>) are revoked; a node runtime is closed on its node`)
  }
  const executorId = runtime?.executor_id
    ? String(runtime.executor_id)
    : given.startsWith(DEVICE_PREFIX)
    ? given.slice(DEVICE_PREFIX.length)
    : given
  return { runtime_id: runtime ? String(runtime.runtime_id) : `${DEVICE_PREFIX}${executorId}`, executor_id: executorId, ...(runtime ? { runtime } : {}) }
}

function serviceReason(error: unknown, prefix: string): string | undefined {
  const message = error instanceof Error ? error.message : String(error)
  const at = message.indexOf(`${prefix}:`)
  return at < 0 ? undefined : message.slice(at + prefix.length + 1).trim()
}

function unreachable(error: unknown): boolean {
  const normalized = normalizeError(error)
  return normalized.code === 'SERVICE_UNAVAILABLE' || normalized.code === 'TIMEOUT' ||
    normalized.message.toLowerCase().includes('rpc call error: 404')
}

function message(error: unknown): string {
  return normalizeError(error).message
}

async function confirm(ctx: CommandContext, verb: string, shown: string, question: string, details: Json): Promise<void> {
  if (ctx.confirmed) return
  if (ctx.config.nonInteractive || !ctx.io.inputIsTerminal) {
    throw new ToolError('CONFIRMATION_REQUIRED', `${verb} requires --yes in non-interactive execution`, EXIT_PERMISSION, false, details)
  }
  await ctx.io.stderr(shown)
  const answer = (await ctx.io.prompt(`${question} [y/N] `))?.trim().toLowerCase()
  if (answer !== 'y' && answer !== 'yes') throw new ToolError('CONFIRMATION_DECLINED', `${verb} was declined`, EXIT_PERMISSION)
}

async function controlPanel(ctx: CommandContext, method: string, params: Json): Promise<Json> {
  try {
    return expectObject(await callService(ctx, CONTROL_PANEL, method, params), method)
  } catch (error) {
    if (message(error).includes('agent_not_found')) {
      throw new ToolError('RESOURCE_NOT_FOUND', `Agent not found or not yours: ${params.agent_id}`)
    }
    for (const [prefix, code] of [['runtime_not_offered', 'RUNTIME_NOT_OFFERED'], ['invalid_runtimes', 'INVALID_RUNTIMES']]) {
      const reason = serviceReason(error, prefix)
      if (reason !== undefined) throw new ToolError(code, reason, EXIT_OPERATION)
    }
    throw error
  }
}

async function catalog(ctx: CommandContext): Promise<{ response: Json; runtimes: Json[] }> {
  const response = await controlPanel(ctx, 'agent.runtime_catalog', {})
  return { response, runtimes: objects(response.runtimes) }
}

async function impactOf(ctx: CommandContext, agentId: string, runtimeId: string): Promise<Json> {
  return expectObject(await callService(ctx, agentId, 'runtimes.impact', { runtime_id: runtimeId }), 'runtimes.impact')
}

function command(
  definition: Pick<CommandDefinition, 'verb' | 'summary' | 'handler'> & Partial<CommandDefinition> & {
    level: 'read' | 'write' | 'destructive'
    properties: Record<string, JsonSchema>
    required?: string[]
  },
): CommandDefinition {
  const { level, properties, required, ...rest } = definition
  return {
    inputSchema: { type: 'object', properties, required: required ?? [], additionalProperties: false },
    outputSchema: OBJECT_OUTPUT,
    resultSchemaVersion: 1,
    access: { mode: 'fixed', level },
    asyncMode: 'sync',
    requiresSession: true,
    ...rest,
  }
}

/** The owner's runtime directory: what runtimes there are, and which Agent each is assigned to. A runtime is a sandbox
 * with its own configuration; assigning it only records that an Agent may use it. */
export function createRuntimeModule(): CommandModule {
  return {
    name: 'runtime',
    summary: 'List the runtimes of your directory, assign them to Agents, and revoke devices',
    commands: [
      command({
        verb: 'list',
        summary: 'List the runtimes of your directory and the Agents each is assigned to',
        description:
          'Node runtimes (host, node-*) and devices (exec-<executor_id>). What a runtime allows (directories, ro|rw, computer use, baseline, expiry) is its own configuration. In the agents column `*` marks an Agent that has the runtime switched on and (default) the Agent whose default it is. A device is used by one Agent at a time.',
        level: 'read',
        properties: {},
        examples: ['buckyos runtime list', 'buckyos --output table runtime list'],
        handler: async (ctx) => {
          const { response, runtimes } = await catalog(ctx)
          return { ...response, runtimes: ctx.output.format === 'table' ? catalogRows(runtimes) : runtimes }
        },
      }),
      command({
        verb: 'assign',
        summary: 'Assign a runtime of your directory to an Agent',
        description:
          'Records that the Agent may use the runtime, switched on unless --disabled. Nothing about what the runtime allows is set per Agent. A device another Agent has switched on is refused (RUNTIME_IN_USE): switch it off there first; this command never does that for you.',
        positionals: [{ name: 'runtime_id', description: 'Runtime id as `runtime list` prints it' }],
        options: [AGENT_OPTION, { name: 'disabled', description: 'Assign it switched off', type: 'boolean' }],
        level: 'write',
        properties: { runtime_id: ID, agent_id: ID, disabled: { type: 'boolean' } },
        required: ['runtime_id', 'agent_id'],
        examples: [
          'buckyos runtime assign host --agent jarvis.example.zone',
          'buckyos runtime assign exec-laptop --agent jarvis.example.zone --disabled',
        ],
        handler: async (ctx, input) => await assign(ctx, input),
      }),
      command({
        verb: 'unassign',
        summary: 'Take a runtime away from an Agent',
        description:
          'Shows what the Agent has on the runtime (sessions in progress, Todos waiting, workspaces; none is moved) and asks; --yes skips the question. The Agent keeps the record as history; the runtime stays in your directory. When the service of the Agent cannot be reached the impact is unknown and only --yes removes the assignment, through the control panel.',
        positionals: [{ name: 'runtime_id', description: 'Runtime id' }],
        options: [AGENT_OPTION],
        level: 'destructive',
        properties: { runtime_id: ID, agent_id: ID },
        required: ['runtime_id', 'agent_id'],
        examples: ['buckyos runtime unassign host --agent jarvis.example.zone', 'buckyos --yes runtime unassign exec-laptop --agent jarvis.example.zone'],
        handler: async (ctx, input) => await unassign(ctx, input),
      }),
      command({
        verb: 'revoke',
        summary: 'Revoke a device: it stops serving and is taken away from its Agents',
        description:
          'Devices only (exec-<executor_id>, or the executor id). Shows the Agents the device is assigned to and what the Agent using it has in progress there, and asks; --yes skips the question.',
        positionals: [{ name: 'runtime_id', description: 'Device runtime id (exec-<executor_id>) or executor id' }],
        level: 'destructive',
        properties: { runtime_id: ID },
        required: ['runtime_id'],
        examples: ['buckyos runtime revoke exec-laptop', 'buckyos --yes runtime revoke laptop'],
        handler: async (ctx, input) => await revoke(ctx, input),
      }),
    ],
  }
}

/** `agent runtime <list|enable|disable|default> [runtime_id] --agent <agent_id>`: the runtimes one Agent uses. */
export function agentRuntimeCommand(): CommandDefinition {
  return {
    verb: 'runtime',
    summary: 'The runtimes of one Agent: list them, switch one on or off, choose the default',
    description:
      'list: the runtimes the Agent has now (its private one first), then the retired ones with their usage; from the control panel when the service of the Agent cannot be reached. enable / disable <runtime_id>: whether the Agent uses a runtime it was assigned; disable shows what is in progress there and asks unless --yes. default <runtime_id|private>: where new work of the Agent runs. Runtimes are assigned with `buckyos runtime assign`.',
    positionals: [
      { name: 'action', description: AGENT_RUNTIME_ACTIONS.join(' | ') },
      { name: 'runtime_id', description: 'Runtime id (enable, disable, default); `private` is the own runtime of the Agent', required: false },
    ],
    options: [AGENT_OPTION],
    inputSchema: {
      type: 'object',
      properties: { action: { type: 'string', enum: AGENT_RUNTIME_ACTIONS }, runtime_id: ID, agent_id: ID },
      required: ['action', 'agent_id'],
      additionalProperties: false,
    },
    outputSchema: OBJECT_OUTPUT,
    resultSchemaVersion: 1,
    access: { mode: 'operation', operationIdField: 'action', possibleLevels: ['read', 'write'] },
    asyncMode: 'sync',
    requiresSession: true,
    examples: [
      'buckyos agent runtime list --agent jarvis.example.zone',
      'buckyos agent runtime enable host --agent jarvis.example.zone',
      'buckyos --yes agent runtime disable exec-laptop --agent jarvis.example.zone',
      'buckyos agent runtime default private --agent jarvis.example.zone',
    ],
    handler: async (ctx, input) => {
      const agentId = agentIdFrom(input)
      const action = requiredInputString(input, 'action')
      const runtimeId = inputString(input, 'runtime_id')
      if (action === 'list') {
        if (runtimeId) throw new UsageError('ARGUMENT_CONFLICT', 'agent runtime list takes no runtime id')
        return await agentRuntimeList(ctx, agentId)
      }
      if (!runtimeId) throw new UsageError('MISSING_ARGUMENT', `agent runtime ${action} needs a runtime id`)
      if (action === 'default') {
        const settings = await settingsSet(ctx, agentId, { runtime_id: runtimeId, default: true })
        return { agent_id: agentId, runtime_id: runtimeId, default: true, settings }
      }
      if (action === 'enable') {
        const settings = await settingsSet(ctx, agentId, { runtime_id: runtimeId, enabled: true })
        return { agent_id: agentId, runtime_id: runtimeId, enabled: true, settings }
      }
      const impact = await impactOf(ctx, agentId, runtimeId)
      if (impact.blocking === true) {
        await confirm(ctx, 'agent runtime disable', impactText(agentId, impact), `Switch ${runtimeId} off for ${agentId} anyway?`, { impact })
      }
      const settings = await settingsSet(ctx, agentId, {
        runtime_id: runtimeId,
        enabled: false,
        ...(impact.blocking === true ? { confirm: true } : {}),
      })
      return { agent_id: agentId, runtime_id: runtimeId, enabled: false, impact, settings }
    },
  }
}

async function settingsSet(ctx: CommandContext, agentId: string, params: Json): Promise<Json> {
  try {
    return expectObject(await callService(ctx, agentId, 'runtimes.settings_set', params), 'runtimes.settings_set')
  } catch (error) {
    throw runtimeError(error, agentId, String(params.runtime_id)) ?? error
  }
}

function runtimeError(error: unknown, agentId: string, runtimeId: string): ToolError | undefined {
  const needed = serviceReason(error, 'confirm_required')
  if (needed !== undefined) {
    return new ToolError('CONFIRMATION_REQUIRED', `${needed} (buckyos agent runtime list --agent ${agentId}; --yes confirms)`, EXIT_PERMISSION)
  }
  const inUse = serviceReason(error, 'runtime_in_use')
  if (inUse !== undefined) {
    const user = /in use by Agent `([^`]+)`/.exec(inUse)?.[1]
    return new ToolError(
      'RUNTIME_IN_USE',
      `${inUse}${user ? ` (buckyos agent runtime disable ${runtimeId} --agent ${user})` : ''}`,
      EXIT_OPERATION,
      false,
      user ? { in_use_by: user, disable_command: `buckyos agent runtime disable ${runtimeId} --agent ${user}` } : {},
    )
  }
  return undefined
}

async function agentRuntimeList(ctx: CommandContext, agentId: string): Promise<Json> {
  let records: Json[]
  let settings: Json
  try {
    const listed = await callService<unknown>(ctx, agentId, 'runtimes.list', {})
    if (!Array.isArray(listed)) throw new ToolError('INVALID_SERVICE_RESPONSE', 'runtimes.list must be an array')
    records = objects(listed)
    settings = expectObject(await callService(ctx, agentId, 'runtimes.settings', {}), 'runtimes.settings')
  } catch (error) {
    if (!unreachable(error)) throw error
    const directory = await controlPanel(ctx, 'agent.runtime_directory', { agent_id: agentId })
    const assigned = objects(directory.runtimes).filter((runtime) => runtime.assigned === true)
    const { runtimes: _all, ...rest } = directory
    return {
      agent_id: agentId,
      source: CONTROL_PANEL,
      note: `the service of ${agentId} cannot be reached (${message(error)}): these are its assignments in the control panel; availability, usage and retired runtimes are not known`,
      runtimes: ctx.output.format === 'table' ? directoryRows(assigned, directory) : assigned,
      ...rest,
    }
  }
  const { current, history } = splitAgentRuntimes(records)
  return {
    agent_id: agentId,
    source: 'agent',
    ...(ctx.output.format === 'table' ? { runtimes: agentRuntimeRows(records, settings) } : { runtimes: current, history }),
    default_runtime_id: settings.default_runtime_id ?? null,
    configured_default_runtime_id: settings.configured_default_runtime_id ?? null,
    settings: settings.runtimes ?? {},
  }
}

async function assign(ctx: CommandContext, input: Json): Promise<Json> {
  const agentId = agentIdFrom(input)
  const runtimeId = requiredInputString(input, 'runtime_id')
  const enabled = input.disabled !== true
  try {
    await controlPanel(ctx, 'agent.update', { agent_id: agentId, runtimes: { [runtimeId]: { enabled } } })
  } catch (error) {
    const inUse = serviceReason(error, 'runtime_in_use')
    if (inUse === undefined) throw error
    let user = /in use by Agent `([^`]+)`/.exec(inUse)?.[1]
    let theirs = runtimeId
    try {
      const device = deviceOf(runtimeId, (await catalog(ctx)).runtimes).runtime
      const using = objects(device?.assigned_to).find((agent) => agent.enabled === true && agent.agent_id !== agentId)
      if (using) {
        user = String(using.agent_id)
        theirs = String(using.runtime_id ?? runtimeId)
      }
    } catch {
      // the refusal itself is what matters
    }
    const disable = user ? `buckyos agent runtime disable ${theirs} --agent ${user}` : undefined
    throw new ToolError(
      'RUNTIME_IN_USE',
      `${inUse}${disable ? `: ${disable}` : ''}`,
      EXIT_OPERATION,
      false,
      user ? { in_use_by: user, disable_command: disable } : {},
    )
  }
  return { agent_id: agentId, runtime_id: runtimeId, assigned: true, enabled }
}

async function unassign(ctx: CommandContext, input: Json): Promise<Json> {
  const agentId = agentIdFrom(input)
  const runtimeId = requiredInputString(input, 'runtime_id')
  let impact: Json
  try {
    impact = await impactOf(ctx, agentId, runtimeId)
  } catch (error) {
    if (!unreachable(error)) throw error
    const why = `the service of ${agentId} cannot be reached (${message(error)}): what it has in progress on ${runtimeId} is unknown`
    if (!ctx.confirmed) {
      throw new ToolError(
        'AGENT_SERVICE_UNAVAILABLE',
        `${why}. Nothing was changed; --yes removes the assignment through the control panel anyway`,
        EXIT_UNAVAILABLE,
        true,
      )
    }
    await controlPanel(ctx, 'agent.update', { agent_id: agentId, runtimes: { [runtimeId]: null } })
    return { agent_id: agentId, runtime_id: runtimeId, removed: true, via: CONTROL_PANEL, impact: null, warning: why }
  }
  await confirm(ctx, 'runtime unassign', impactText(agentId, impact), `Take ${runtimeId} away from ${agentId}?`, { impact })
  let settings: Json
  try {
    settings = expectObject(await callService(ctx, agentId, 'runtimes.remove', { runtime_id: runtimeId, confirm: true }), 'runtimes.remove')
  } catch (error) {
    throw runtimeError(error, agentId, runtimeId) ?? error
  }
  return { agent_id: agentId, runtime_id: runtimeId, removed: true, via: 'agent', impact, settings }
}

async function revoke(ctx: CommandContext, input: Json): Promise<Json> {
  const given = requiredInputString(input, 'runtime_id')
  const device = deviceOf(given, (await catalog(ctx)).runtimes)
  const assigned = objects(device.runtime?.assigned_to)
  const lines = [
    device.runtime
      ? `Device ${device.runtime_id} (${device.runtime.name ?? device.executor_id}) is assigned to ${assigned.length} Agent(s)`
      : `Device ${device.runtime_id} is not in your runtime directory: nothing is known about its Agents`,
    ...assigned.map((agent) => `  ${agent.enabled === true ? '*' : ' '} ${agent.agent_id}${agent.default === true ? ' (default)' : ''}`),
  ]
  const impacts: Json[] = []
  for (const agent of assigned.filter((item) => item.enabled === true)) {
    const agentId = String(agent.agent_id)
    try {
      const impact = await impactOf(ctx, agentId, String(agent.runtime_id ?? device.runtime_id))
      impacts.push({ agent_id: agentId, impact })
      lines.push(impactText(agentId, impact).trimEnd())
    } catch (error) {
      impacts.push({ agent_id: agentId, impact: null, error: message(error) })
      lines.push(`  what ${agentId} has in progress on it is unknown: ${message(error)}`)
    }
  }
  await confirm(ctx, 'runtime revoke', `${lines.join('\n')}\n`, `Revoke ${device.runtime_id} and take it away from its Agents?`, {
    assigned_to: assigned,
    impacts,
  })
  const revoked = await controlPanel(ctx, 'executor.device.revoke', { executor_id: device.executor_id })
  return { runtime_id: device.runtime_id, executor_id: device.executor_id, revoked: true, assigned_to: assigned, impacts, ...revoked }
}
