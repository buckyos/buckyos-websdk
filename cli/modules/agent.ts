import type { CommandModule, JsonSchema, PositionalDefinition } from '../core/command.ts'
import type { CommandContext } from '../core/context.ts'
import { EXIT_INTERNAL, ToolError, UsageError } from '../core/errors.ts'
import { callService, expectObject, requiredInputString } from '../core/service.ts'

const CONTROL_PANEL = 'control-panel'
const OBJECT_OUTPUT: JsonSchema = { type: 'object', additionalProperties: true }
const AGENT_POSITIONAL: PositionalDefinition = {
  name: 'agent_id',
  description: 'Agent ID as `agent list` prints it (raw host name, e.g. jarvis.example.zone)',
}
const AGENT_INPUT: JsonSchema = {
  type: 'object',
  properties: { agent_id: { type: 'string', minLength: 1 } },
  required: ['agent_id'],
  additionalProperties: false,
}
const PROFILE_FIELDS = ['display_name', 'bio']

// Control Panel answers for Agents the caller owns; admins (and the device identity) see all.
export function createAgentModule(): CommandModule {
  return {
    name: 'agent',
    summary: 'List Agents and read or change their profiles',
    commands: [
      {
        verb: 'list',
        summary: 'List the Agents visible to the caller',
        description: 'Owners see their own Agents; admins see every Agent in the Zone.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        outputSchema: {
          type: 'object',
          properties: { agents: { type: 'array', items: OBJECT_OUTPUT } },
          required: ['agents'],
          additionalProperties: false,
        },
        resultSchemaVersion: 1,
        access: { mode: 'fixed', level: 'read' },
        asyncMode: 'sync',
        requiresSession: true,
        examples: ['buckyos agent list'],
        handler: async (ctx) => {
          const response = await callAgent(ctx, 'agent.list', {})
          if (!Array.isArray(response.agents)) {
            throw new ToolError(
              'INVALID_SERVICE_RESPONSE',
              'agent.list agents must be an array',
              EXIT_INTERNAL,
            )
          }
          return { agents: response.agents }
        },
      },
      {
        verb: 'get',
        summary: 'Get one Agent: profile, settings, install state, template, and runtime',
        positionals: [AGENT_POSITIONAL],
        inputSchema: AGENT_INPUT,
        outputSchema: OBJECT_OUTPUT,
        resultSchemaVersion: 1,
        access: { mode: 'fixed', level: 'read' },
        asyncMode: 'sync',
        requiresSession: true,
        examples: ['buckyos agent get jarvis.example.zone'],
        handler: async (ctx, input) =>
          await callAgent(ctx, 'agent.get', { agent_id: requiredInputString(input, 'agent_id') }),
      },
      {
        verb: 'profile-get',
        summary: 'Get the public profile (display name, bio, avatar) of an Agent',
        positionals: [AGENT_POSITIONAL],
        inputSchema: AGENT_INPUT,
        outputSchema: OBJECT_OUTPUT,
        resultSchemaVersion: 1,
        access: { mode: 'fixed', level: 'read' },
        asyncMode: 'sync',
        requiresSession: true,
        examples: ['buckyos agent profile-get jarvis.example.zone'],
        handler: async (ctx, input) => {
          const agentId = requiredInputString(input, 'agent_id')
          return {
            agent_id: agentId,
            ...await callAgent(ctx, 'agent.profile.get', { agent_id: agentId }),
          }
        },
      },
      {
        verb: 'profile-set',
        summary: 'Change the display name or bio of an Agent',
        description:
          'Only the given fields change; an empty value clears the field. Returns the profile before and after the change, and Message Center reloads the new name.',
        positionals: [AGENT_POSITIONAL],
        options: [
          {
            name: 'display-name',
            description: 'New display name; empty clears it',
            type: 'string',
          },
          { name: 'bio', description: 'New bio; empty clears it', type: 'string' },
        ],
        inputSchema: {
          type: 'object',
          properties: {
            agent_id: { type: 'string', minLength: 1 },
            display_name: { type: 'string' },
            bio: { type: 'string' },
          },
          required: ['agent_id'],
          additionalProperties: false,
        },
        outputSchema: {
          type: 'object',
          properties: {
            agent_id: { type: 'string' },
            before: OBJECT_OUTPUT,
            profile: OBJECT_OUTPUT,
          },
          required: ['agent_id', 'before', 'profile'],
          additionalProperties: false,
        },
        resultSchemaVersion: 1,
        access: { mode: 'fixed', level: 'write' },
        asyncMode: 'sync',
        requiresSession: true,
        examples: [
          "buckyos agent profile-set jarvis.example.zone --display-name 'Jarvis'",
          "buckyos agent profile-set jarvis.example.zone --bio ''",
        ],
        handler: async (ctx, input) => {
          const agentId = requiredInputString(input, 'agent_id')
          const changes = Object.fromEntries(
            PROFILE_FIELDS.filter((field) => typeof input[field] === 'string')
              .map((field) => [field, input[field]]),
          )
          if (Object.keys(changes).length === 0) {
            throw new UsageError('INVALID_ARGUMENT', 'give --display-name or --bio')
          }
          const before = await callAgent(ctx, 'agent.profile.get', { agent_id: agentId })
          const after = await callAgent(ctx, 'agent.profile.set', { agent_id: agentId, ...changes })
          return {
            agent_id: agentId,
            before: expectObject(before.profile, 'agent.profile.get profile'),
            profile: expectObject(after.profile, 'agent.profile.set profile'),
          }
        },
      },
    ],
  }
}

async function callAgent(
  ctx: CommandContext,
  method: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    return expectObject(await callService(ctx, CONTROL_PANEL, method, params), method)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('agent_not_found')) {
      throw new ToolError('RESOURCE_NOT_FOUND', `Agent not found or not yours: ${params.agent_id}`)
    }
    throw error
  }
}
