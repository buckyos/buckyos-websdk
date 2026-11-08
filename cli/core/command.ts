import type { CommandContext } from './context.ts'

import type { AccessLevel, JsonSchema, OptionDefinition, PositionalDefinition } from '../../src/internal/command_args.ts'

export type { AccessLevel, JsonSchema, OptionDefinition, PositionalDefinition }
export { optionProperty } from '../../src/internal/command_args.ts'

export type AccessPolicy =
  | { mode: 'fixed'; level: AccessLevel }
  | { mode: 'operation'; operationIdField: string; possibleLevels: AccessLevel[] }

export interface CommandDefinition {
  verb: string
  summary: string
  description?: string
  positionals?: PositionalDefinition[]
  options?: OptionDefinition[]
  inputSchema: JsonSchema
  outputSchema: JsonSchema
  resultSchemaVersion: number
  access: AccessPolicy
  asyncMode: 'sync' | 'task' | 'either' | 'stream'
  requiresSession: boolean
  execution?: 'local' | 'service'
  networkAccess?: boolean
  examples?: string[]
  supportsRawOutput?: boolean
  handler(ctx: CommandContext, input: Record<string, unknown>): Promise<unknown>
}

export interface CommandModule {
  name: string
  summary: string
  commands: CommandDefinition[]
}

export interface RegisteredCommand extends CommandDefinition {
  module: string
  moduleSummary: string
}
