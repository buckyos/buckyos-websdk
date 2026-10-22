import type { CommandDefinition, CommandModule, JsonSchema } from '../core/command.ts'
import { UsageError } from '../core/errors.ts'
import {
  callService,
  expectObject,
  inputString,
  parseTimestamp,
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
]

// Read views of the AICC service (/kapi/aicc); provider and routing changes stay in Control Panel.
export function createAiModule(): CommandModule {
  return {
    name: 'ai',
    summary: 'Read AI provider, routing, usage and token quota state of the AICC service',
    commands: [
      readCommand({
        verb: 'providers',
        summary: 'List configured AI provider instances with auth, health, and model inventory',
        method: 'provider.list',
        description:
          'Credentials are reported only as configured/kind; secrets are never returned.',
      }),
      readCommand({
        verb: 'routing',
        summary: 'Get the AICC routing overlay and its settings revision',
        method: 'routing.get',
        description: 'An empty routing object means the default routing of the model catalog.',
      }),
      usageCommand(),
      quotaCommand(),
    ],
  }
}

function quotaCommand(): CommandDefinition {
  return {
    verb: 'quota',
    summary: "Show the token quota rules that limit the caller's AI calls and what is left",
    description:
      'Admin rules on the caller and the caller\'s Apps, shared App rules, and the caller\'s own App limits, each with its current window or total account. A refused call returns quota_exhausted / quota_budget_exceeded with the blocking rules.',
    options: [
      { name: 'app', description: 'Only the rules that apply to calls of this App (an AppId or AgentId)', type: 'string' },
    ],
    inputSchema: {
      type: 'object',
      properties: { app: { type: 'string', minLength: 1 } },
      additionalProperties: false,
    },
    outputSchema: OBJECT_OUTPUT,
    resultSchemaVersion: 1,
    access: { mode: 'fixed', level: 'read' },
    asyncMode: 'sync',
    requiresSession: true,
    examples: ['buckyos ai quota', 'buckyos ai quota --app aiworkspace'],
    handler: async (ctx, input) =>
      expectObject(
        await callService(ctx, AICC, 'quota.query', inputString(input, 'app') ? { app_id: inputString(input, 'app') } : {}),
        'quota.query',
      ),
  }
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
