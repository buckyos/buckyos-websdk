import type { CommandDefinition, CommandModule, JsonSchema } from '../core/command.ts'
import { ToolError, UsageError } from '../core/errors.ts'
import type { AccessLevel, OptionDefinition } from '../core/command.ts'
import {
  callService,
  expectObject,
  inputString,
  parseTimestamp,
  requiredInputString,
  splitServices,
} from '../core/service.ts'

const AICC = 'aicc'
const OBJECT_OUTPUT: JsonSchema = { type: 'object', additionalProperties: true }
const EMPTY_INPUT: JsonSchema = { type: 'object', properties: {}, additionalProperties: false }
const RANGES = ['last1d', 'last7d', 'last30d']
const GROUPS = [
  'provider_instance_name',
  'provider_model',
  'request_model',
  'method',
  'capability',
  'caller_app_id',
  'user_id',
  'tenant_id',
  'user_group',
]
const ON_UNAVAILABLE = ['none', 'same_model', 'not_pricier', 'next_model']
const USECASE_FIELDS = ['model', 'on_unavailable']
const GROUP_ACTIONS = ['list', 'create', 'delete', 'bind', 'unbind']

// The AICC service (/kapi/aicc): read views, the usecase table and routing groups; provider changes stay in Control Panel.
export function createAiModule(): CommandModule {
  return {
    name: 'ai',
    summary: 'Read AI providers, usecase routing and usage; set usecase models and routing groups; read AI policies and Credit; recharge Credit',
    commands: [
      readCommand({
        verb: 'providers',
        summary: 'List configured AI provider instances with auth, health, and model inventory',
        method: 'provider.list',
        description:
          'Credentials are reported only as configured/kind; secrets are never returned.',
      }),
      routingCommand(),
      usecaseCommand(),
      routingGroupCommand(),
      usageCommand(),
      ...policyCommands(),
    ],
  }
}

interface AiccCommand {
  verb: string
  summary: string
  description: string
  method: string
  level: AccessLevel
  options?: (OptionDefinition & { key: string; required?: boolean; json?: boolean })[]
  examples: string[]
}

function aiccCommand(command: AiccCommand): CommandDefinition {
  const options = command.options ?? []
  return {
    verb: command.verb,
    summary: command.summary,
    description: command.description,
    options: options.map(({ key: _key, required: _required, json: _json, ...option }) => option),
    inputSchema: {
      type: 'object',
      properties: Object.fromEntries(options.map((option) => [
        option.name.replaceAll('-', '_'),
        option.type === 'integer' ? { type: 'integer', minimum: 1 } : option.type === 'boolean' ? { type: 'boolean' } : { type: 'string', minLength: 1 },
      ])),
      required: options.filter((option) => option.required).map((option) => option.name.replaceAll('-', '_')),
      additionalProperties: false,
    },
    outputSchema: OBJECT_OUTPUT,
    resultSchemaVersion: 1,
    access: { mode: 'fixed', level: command.level },
    asyncMode: 'sync',
    requiresSession: true,
    examples: command.examples,
    handler: async (ctx, input) => {
      const params: Record<string, unknown> = {}
      for (const option of options) {
        const name = option.name.replaceAll('-', '_')
        if (option.type === 'boolean' || option.type === 'integer') {
          if (input[name] !== undefined) params[option.key] = input[name]
          continue
        }
        const value = option.required ? requiredInputString(input, name) : inputString(input, name)
        if (value === undefined) continue
        if (option.json) {
          try {
            params[option.key] = JSON.parse(value)
          } catch {
            throw new UsageError('INVALID_ARGUMENT', `--${option.name} must be JSON`)
          }
        } else {
          params[option.key] = value
        }
      }
      if (params.scope !== undefined) params.scope = params.scope ? 'manage' : 'mine'
      return expectObject(await callService(ctx, AICC, command.method, params), command.method)
    },
  }
}

const USER_OPTION = { name: 'user', key: 'user_id', description: 'Another user (administrators only); defaults to the caller', type: 'string' } as const
const APP_OPTION = { name: 'app', key: 'app_id', description: 'Calls through this App or Agent (its App policies apply)', type: 'string' } as const

// AI user policy, price list and Credit (buckyos doc/aicc/aicc_user_policy.md).
function policyCommands(): CommandDefinition[] {
  return [
    aiccCommand({
      verb: 'policy',
      summary: "Show the caller's AI Credit balance and the usage limits that apply, with their windows",
      description:
        'A refused call returns quota_exhausted (a limit is used up), credit_insufficient (the Credit balance is used up) or resource_not_permitted (hidden, or unpriced for a caller who pays: details.reason = "unpriced").',
      method: 'policy.status',
      level: 'read',
      options: [APP_OPTION],
      examples: ['buckyos ai policy', 'buckyos ai policy --app aiworkspace'],
    }),
    aiccCommand({
      verb: 'policy-effective',
      summary: 'Show every model a user can see with its Credit price and source, and every limit that applies',
      description: 'Without --user it is the caller. Each model says which policy makes it visible and whether it is free, priced or unpriced (not usable for a caller who pays).',
      method: 'policy.effective',
      level: 'read',
      options: [USER_OPTION, APP_OPTION],
      examples: ['buckyos ai policy-effective', 'buckyos ai policy-effective --user bob --app writer.example.zone'],
    }),
    aiccCommand({
      verb: 'policies',
      summary: 'List the AI policies that apply to the caller, or with --manage every policy of the Zone',
      description: 'Subjects: type:admin|user|limited, group:<id>, user:<id> (more specific overrides), app:<id>, user_app:<user>/<app> (only narrows). Change them in Desktop AI Center › Policies or with policy.upsert.',
      method: 'policy.list',
      level: 'read',
      options: [{ name: 'manage', key: 'scope', description: 'Every policy of the Zone (administrators only)', type: 'boolean' }],
      examples: ['buckyos ai policies', 'buckyos ai policies --manage'],
    }),
    aiccCommand({
      verb: 'prices',
      summary: 'Show the Credit price list (token rates per million tokens) and, for administrators, Credit rates and unpriced models',
      description: 'Keys: model:<model_driver_id>:<origin_model_id> (every Provider of the model) and exact:<model>@<provider> (one channel).',
      method: 'price.get',
      level: 'read',
      examples: ['buckyos ai prices'],
    }),
    aiccCommand({
      verb: 'credit',
      summary: 'Show the AI Credit balance of the caller (or of a user, for administrators)',
      description: 'Credit is the Zone\'s unit for AI use, unrelated to a Provider account balance; it may be negative after a large call.',
      method: 'credit.account.get',
      level: 'read',
      options: [USER_OPTION],
      examples: ['buckyos ai credit', 'buckyos ai credit --user bob'],
    }),
    aiccCommand({
      verb: 'credit-ledger',
      summary: 'List recharges, adjustments and charges of a Credit account, newest first',
      description: 'Charges with status unpriced or unknown_usage were not charged; an administrator can charge them with credit-adjust.',
      method: 'credit.ledger.list',
      level: 'read',
      options: [USER_OPTION, { name: 'limit', key: 'limit', description: 'Page size', type: 'integer' },
        { name: 'cursor', key: 'cursor', description: 'Opaque page cursor', type: 'string' }],
      examples: ['buckyos ai credit-ledger', 'buckyos ai credit-ledger --user bob --limit 20'],
    }),
    aiccCommand({
      verb: 'credit-recharge',
      summary: 'Recharge a user\'s AI Credit once per id (administrators and granted payment gateways)',
      description:
        'Needs write on obj://aicc/credit/recharge. The same --id with the same amount is credited once and returns the original entry; with different parameters it fails. Use the payment order id as --id.',
      method: 'credit.recharge',
      level: 'privileged',
      options: [
        { name: 'user', key: 'user_id', description: 'User to recharge', type: 'string', required: true },
        { name: 'amount', key: 'amount', description: 'Positive Credit amount, up to six decimals', type: 'string', required: true },
        { name: 'id', key: 'recharge_id', description: 'Idempotency id (payment order id)', type: 'string', required: true },
        { name: 'note', key: 'note', description: 'Note kept with the entry', type: 'string' },
        { name: 'external-ref', key: 'external_ref', description: 'JSON a payment gateway keeps with the entry', type: 'string', json: true },
      ],
      examples: ["buckyos ai credit-recharge --user bob --amount 100 --id order-1001 --external-ref '{\"gateway\":\"stripe\"}'"],
    }),
    aiccCommand({
      verb: 'credit-recharge-get',
      summary: 'Look up a recharge or adjustment by its id (after a timeout, before retrying)',
      description: 'Needs write on obj://aicc/credit/recharge.',
      method: 'credit.recharge.get',
      level: 'read',
      options: [{ name: 'id', key: 'recharge_id', description: 'Recharge or adjustment id', type: 'string', required: true }],
      examples: ['buckyos ai credit-recharge-get --id order-1001'],
    }),
    aiccCommand({
      verb: 'credit-adjust',
      summary: 'Add or remove AI Credit with a note: refunds, corrections, charging unpriced usage',
      description: 'Needs write on obj://aicc/credit/recharge. A negative amount removes Credit; the same --id is applied once.',
      method: 'credit.adjust',
      level: 'privileged',
      options: [
        { name: 'user', key: 'user_id', description: 'User whose balance changes', type: 'string', required: true },
        { name: 'amount', key: 'amount', description: 'Signed Credit amount, not zero', type: 'string', required: true },
        { name: 'id', key: 'adjust_id', description: 'Idempotency id', type: 'string', required: true },
        { name: 'note', key: 'note', description: 'Why (required)', type: 'string', required: true },
      ],
      examples: ["buckyos ai credit-adjust --user bob --amount=-2.5 --id refund-1001 --note 'refund order 1001'"],
    }),
  ]
}

function readCommand(options: {
  verb: string
  summary: string
  method: string
  description: string
}): CommandDefinition {
  return {
    verb: options.verb,
    summary: options.summary,
    description: options.description,
    inputSchema: EMPTY_INPUT,
    outputSchema: OBJECT_OUTPUT,
    resultSchemaVersion: 1,
    access: { mode: 'fixed', level: 'read' },
    asyncMode: 'sync',
    requiresSession: true,
    examples: [`buckyos ai ${options.verb}`],
    handler: async (ctx) =>
      expectObject(await callService(ctx, AICC, options.method, {}), options.method),
  }
}

// The usecase table (buckyos doc/aicc/aicc_router.md §11–§12).
function routingCommand(): CommandDefinition {
  return {
    verb: 'routing',
    summary: 'Show the usecase table: the model each usecase routes to, who set it, and what happens when it is unavailable',
    description:
      'Without --view it is the caller\'s own table. source is the layer that chose the model: default, zone (administrator), user, group:<id> or fallback_llm; "locked" means an administrator fixed it. on_unavailable is none (return the real error), same_model, not_pricier or next_model, with the layer that set it when not the default; would_switch_to is what that policy would use if the model\'s Provider were unavailable. coverage is covered, fallback_llm (served by the fallback LLM) or uncovered, with the reason. The row llm.fallback is the fallback LLM (enabled: whether it is on; off by default). --json returns the whole routing.usecases response: every layer with its value, lock and model state, and the revision a change passes.',
    options: [
      { name: 'view', description: 'zone (administrators), group:<id> or app:<app_id>; defaults to the caller', type: 'string' },
      { name: 'json', description: 'The whole routing.usecases response instead of one line per usecase', type: 'boolean' },
    ],
    inputSchema: {
      type: 'object',
      properties: { view: { type: 'string', minLength: 1 }, json: { type: 'boolean' } },
      additionalProperties: false,
    },
    outputSchema: OBJECT_OUTPUT,
    resultSchemaVersion: 1,
    access: { mode: 'fixed', level: 'read' },
    asyncMode: 'sync',
    requiresSession: true,
    examples: ['buckyos --output table ai routing', 'buckyos ai routing --view zone', 'buckyos ai routing --view app:writer --json'],
    handler: async (ctx, input) => {
      const view = inputString(input, 'view')
      const table = expectObject(await callService(ctx, AICC, 'routing.usecases', view ? { view } : {}), 'routing.usecases')
      if (input.json === true) return table
      const rows = Array.isArray(table.rows) ? table.rows as Record<string, unknown>[] : []
      return {
        view: table.view,
        revision: table.revision,
        can_edit: table.can_edit,
        usecases: rows.map((row) => {
          const lock = (locked: unknown) => locked === true ? ', locked' : ''
          const policySource = row.on_unavailable_source === 'default' && row.on_unavailable_locked !== true
            ? ''
            : ` (${row.on_unavailable_source}${lock(row.on_unavailable_locked)})`
          return {
            usecase: row.usecase,
            model: row.model ?? '',
            source: row.model_source ? `${row.model_source}${lock(row.model_locked)}` : '',
            on_unavailable: `${row.on_unavailable}${policySource}`,
            would_switch_to: row.fallback_to ?? (row.fallback_note ? `(${row.fallback_note})` : ''),
            coverage: row.coverage_reason ? `${row.coverage} (${row.coverage_reason})` : row.coverage,
            ...(row.enabled !== undefined ? { enabled: row.enabled } : {}),
          }
        }),
      }
    },
  }
}

function usecaseCommand(): CommandDefinition {
  return {
    verb: 'usecase',
    summary: 'Set the model of a usecase, or what it does when that model is unavailable, in your layer, a routing group or the Zone',
    description:
      'set <usecase> changes one usecase of a layer: your own by default, one of your routing groups with --group <id>, the administrator layer (the Zone default) with --zone-default (administrators; --lock keeps users and groups from changing what it sets). --model is an exact model <model>@<provider> with the usecase\'s API type that meets its requirements. --on-unavailable: none (return the real error), same_model (the same model on another Provider), not_pricier (route again without that Provider, only to a model known not to cost more), next_model (route again without that Provider). --clear model,on_unavailable makes them follow the layer below again. The layer\'s revision is read first; when it changed in between the call fails with settings_revision_conflict: run it again.',
    positionals: [
      { name: 'action', description: 'set', required: true },
      { name: 'usecase', description: 'A usecase such as llm.code or image.txt2img (buckyos ai routing lists them)', required: true },
    ],
    options: [
      { name: 'model', description: 'Exact model <model>@<provider>', type: 'string' },
      { name: 'on-unavailable', description: ON_UNAVAILABLE.join(' | '), type: 'string', enum: ON_UNAVAILABLE },
      { name: 'clear', description: `Comma-separated: ${USECASE_FIELDS.join(', ')}`, type: 'string' },
      { name: 'zone-default', description: 'The administrator layer, the Zone default (administrators)', type: 'boolean' },
      { name: 'group', description: 'One of your routing groups, by id', type: 'string' },
      { name: 'lock', description: 'With --zone-default: what this sets cannot be changed by users or groups', type: 'boolean' },
    ],
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['set'] },
        usecase: { type: 'string', minLength: 1 },
        model: { type: 'string', minLength: 1 },
        on_unavailable: { type: 'string', enum: ON_UNAVAILABLE },
        clear: { type: 'string', minLength: 1 },
        zone_default: { type: 'boolean' },
        group: { type: 'string', minLength: 1 },
        lock: { type: 'boolean' },
      },
      required: ['action', 'usecase'],
      additionalProperties: false,
    },
    outputSchema: OBJECT_OUTPUT,
    resultSchemaVersion: 1,
    access: { mode: 'fixed', level: 'write' },
    asyncMode: 'sync',
    requiresSession: true,
    examples: [
      'buckyos ai usecase set llm.code --model gpt-6@openai-main --on-unavailable same_model',
      'buckyos ai usecase set llm.chat --group rg_1 --clear model',
      'buckyos ai usecase set image.txt2img --zone-default --model gpt-image-2@openai-main --lock',
    ],
    handler: async (ctx, input) => {
      const group = inputString(input, 'group')
      if (group && input.zone_default === true) throw new UsageError('ARGUMENT_CONFLICT', '--zone-default cannot be combined with --group')
      if (input.lock === true && input.zone_default !== true) throw new UsageError('INVALID_ARGUMENT', '--lock requires --zone-default')
      const model = inputString(input, 'model')
      const onUnavailable = inputString(input, 'on_unavailable')
      const clear = splitServices(input.clear)
      const unknown = clear.filter((field) => !USECASE_FIELDS.includes(field))
      if (unknown.length > 0) {
        throw new UsageError('INVALID_ARGUMENT', `unknown --clear ${unknown.join(', ')}; use ${USECASE_FIELDS.join(', ')}`)
      }
      if (!model && !onUnavailable && clear.length === 0) {
        throw new UsageError('MISSING_ARGUMENT', 'give --model, --on-unavailable or --clear')
      }
      const target = input.zone_default === true ? 'zone' : group ? `group:${group}` : 'user'
      const current = expectObject(
        await callService(ctx, AICC, 'routing.usecases', { view: target === 'user' ? 'self' : target }),
        'routing.usecases',
      )
      const value = (v: string) => input.lock === true ? { value: v, locked: true } : v
      return expectObject(
        await callService(ctx, AICC, 'routing.usecase.set', {
          target,
          usecase: requiredInputString(input, 'usecase'),
          ...(model ? { model: value(model) } : {}),
          ...(onUnavailable ? { on_unavailable: value(onUnavailable) } : {}),
          ...(clear.length > 0 ? { clear } : {}),
          revision: current.revision,
        }),
        'routing.usecase.set',
      )
    },
  }
}

function routingGroupCommand(): CommandDefinition {
  return {
    verb: 'routing-group',
    summary: 'List, create and delete your routing groups, and bind Apps to them',
    description:
      'A routing group is a set of usecase settings of your own (change them with buckyos ai usecase set --group <id>); calls through an App bound to it use them over your own layer. list shows each group with its usecases, version and bound Apps; create <name> returns the new group with its id; delete <group_id> also removes its App bindings; bind <group_id> --app <app_id> binds an App or Agent (one group per App); unbind --app <app_id> removes its binding.',
    positionals: [
      { name: 'action', description: GROUP_ACTIONS.join(' | '), required: true },
      { name: 'target', description: 'create: the name; delete, bind: the group id', required: false },
    ],
    options: [{ name: 'app', description: 'bind, unbind: the App or Agent id', type: 'string' }],
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: GROUP_ACTIONS },
        target: { type: 'string', minLength: 1 },
        app: { type: 'string', minLength: 1 },
      },
      required: ['action'],
      additionalProperties: false,
    },
    outputSchema: OBJECT_OUTPUT,
    resultSchemaVersion: 1,
    access: { mode: 'operation', operationIdField: 'action', possibleLevels: ['read', 'write', 'destructive'] },
    asyncMode: 'sync',
    requiresSession: true,
    examples: [
      'buckyos ai routing-group list',
      "buckyos ai routing-group create 'Cheap drafts'",
      'buckyos ai routing-group bind rg_1 --app writer',
      'buckyos ai routing-group unbind --app writer',
      'buckyos ai routing-group delete rg_1',
    ],
    handler: async (ctx, input) => {
      const call = async (method: string, params: Record<string, unknown>) =>
        expectObject(await callService(ctx, AICC, method, params), method)
      const action = input.action
      const target = inputString(input, 'target')
      const app = inputString(input, 'app')
      if (action === 'list') return call('routing.groups.list', {})
      if ((action === 'bind' || action === 'unbind') && !app) {
        throw new UsageError('MISSING_ARGUMENT', `${action} requires --app`)
      }
      if (action === 'unbind') return call('routing.bindings.remove', { app_id: app })
      if (!target) {
        throw new UsageError('MISSING_ARGUMENT', `${action} requires ${action === 'create' ? 'a name' : 'a group id'}`)
      }
      if (action === 'create') return call('routing.groups.create', { name: target })
      if (action === 'bind') return call('routing.bindings.set', { app_id: app, group_id: target })
      const groups = (await call('routing.groups.list', {})).groups
      const group = Array.isArray(groups)
        ? (groups as Record<string, unknown>[]).find((item) => item.group_id === target)
        : undefined
      if (!group) throw new ToolError('RESOURCE_NOT_FOUND', `no routing group ${target} of yours`)
      return call('routing.groups.delete', { group_id: target, version: group.version })
    },
  }
}

function usageCommand(): CommandDefinition {
  return {
    verb: 'usage',
    summary: "Aggregate the caller's AI usage: requests, tokens, and cost",
    description:
      "Scoped to the caller's own user (a device identity sees only its own calls, not the Zone total). Without --since the range defaults to last7d; --until defaults to now.",
    options: [
      {
        name: 'range',
        description: 'last1d, last7d (default), or last30d',
        type: 'string',
        enum: RANGES,
      },
      { name: 'since', description: 'RFC 3339 or Unix ms lower bound', type: 'string' },
      { name: 'until', description: 'RFC 3339 or Unix ms upper bound', type: 'string' },
      {
        name: 'group-by',
        description: `Comma-separated: ${GROUPS.join(', ')}`,
        type: 'string',
      },
      {
        name: 'bucket',
        description: 'Time buckets: hour or day',
        type: 'string',
        enum: ['hour', 'day'],
      },
      { name: 'events', description: 'Also return the individual usage events', type: 'boolean' },
      { name: 'limit', description: 'Event page size', type: 'integer' },
      { name: 'cursor', description: 'Opaque event page cursor', type: 'string' },
    ],
    inputSchema: {
      type: 'object',
      properties: {
        range: { type: 'string', enum: RANGES },
        since: { type: 'string', minLength: 1 },
        until: { type: 'string', minLength: 1 },
        group_by: { type: 'string', minLength: 1 },
        bucket: { type: 'string', enum: ['hour', 'day'] },
        events: { type: 'boolean' },
        limit: { type: 'integer', minimum: 1 },
        cursor: { type: 'string', minLength: 1 },
      },
      additionalProperties: false,
    },
    outputSchema: OBJECT_OUTPUT,
    resultSchemaVersion: 1,
    access: { mode: 'fixed', level: 'read' },
    asyncMode: 'sync',
    requiresSession: true,
    examples: [
      'buckyos ai usage --range last1d --group-by provider_instance_name,provider_model',
      'buckyos ai usage --since 2026-10-01T00:00:00Z --bucket day',
    ],
    handler: async (ctx, input) => {
      const groupBy = splitServices(input.group_by)
      const unknown = groupBy.filter((group) => !GROUPS.includes(group))
      if (unknown.length > 0) {
        throw new UsageError(
          'INVALID_ARGUMENT',
          `unknown group-by ${unknown.join(', ')}; use ${GROUPS.join(', ')}`,
        )
      }
      return expectObject(
        await callService(ctx, AICC, 'usage.query', {
          time_range: timeRange(input),
          ...(groupBy.length > 0 ? { group_by: groupBy } : {}),
          ...(input.bucket ? { time_bucket: input.bucket } : {}),
          output_mode: input.events === true ? 'summary_and_events' : 'summary',
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
          ...(inputString(input, 'cursor') ? { cursor: inputString(input, 'cursor') } : {}),
        }),
        'usage.query',
      )
    },
  }
}

function timeRange(input: Record<string, unknown>): Record<string, unknown> {
  const since = parseTimestamp(input.since, 'since')
  const until = parseTimestamp(input.until, 'until')
  if (since === undefined) {
    if (until !== undefined) throw new UsageError('INVALID_ARGUMENT', '--until requires --since')
    return { kind: inputString(input, 'range') ?? 'last7d' }
  }
  if (input.range !== undefined) {
    throw new UsageError('ARGUMENT_CONFLICT', '--range cannot be combined with --since')
  }
  return { kind: 'explicit', start_time_ms: since, end_time_ms: until ?? Date.now() }
}
