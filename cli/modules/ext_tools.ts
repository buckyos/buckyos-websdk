import type { CommandDefinition, CommandModule, JsonSchema } from '../core/command.ts'
import type { CommandContext } from '../core/context.ts'
import { UsageError } from '../core/errors.ts'
import { stageLocalPikg } from './app.ts'

const OBJECT_OUTPUT: JsonSchema = { type: 'object', additionalProperties: true }
const ID = { type: 'string' as const, minLength: 1 }

function call<T = Record<string, unknown>>(ctx: CommandContext, method: string, params: Record<string, unknown>): Promise<T> {
  return ctx.clients.call('control-panel', method, params, {
    traceId: ctx.traceId, signal: ctx.signal, timeoutMs: Math.max(1, (ctx.deadline ?? Date.now() + 60000) - Date.now()),
  })
}

function requestOf(input: Record<string, unknown>, enabled: boolean): Record<string, unknown> {
  const id = typeof input.id === 'string' ? input.id : ''
  if (!id) throw new UsageError('MISSING_ARGUMENT', 'a package id is required')
  return { id, enabled, ...(typeof input.version === 'string' ? { version: input.version } : {}) }
}

function read(verb: string, summary: string, method: string): CommandDefinition {
  return {
    verb, summary,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: OBJECT_OUTPUT, resultSchemaVersion: 1, access: { mode: 'fixed', level: 'read' },
    asyncMode: 'sync', requiresSession: true,
    handler: (ctx) => call(ctx, method, {}),
  }
}

function desired(verb: string, summary: string, enabled: boolean): CommandDefinition {
  const properties: Record<string, JsonSchema> = { id: ID, ...(enabled ? { version: { type: 'string', minLength: 1 } } : {}), dry_run: { type: 'boolean' } }
  return {
    verb, summary,
    positionals: [{ name: 'id', description: 'Package id, e.g. ext-core' }],
    options: [
      ...(enabled ? [{ name: 'version', description: 'A published version; the newest without it', type: 'string' as const }] : []),
      { name: 'dry-run', property: 'dry_run', description: 'Only show what would change', type: 'boolean' as const },
    ],
    inputSchema: { type: 'object', properties, required: ['id'], additionalProperties: false },
    outputSchema: OBJECT_OUTPUT, resultSchemaVersion: 1, access: { mode: 'fixed', level: 'write' },
    asyncMode: 'sync', requiresSession: true,
    handler: (ctx, input) => call(ctx, input.dry_run === true ? 'ext_tools.plan' : 'ext_tools.set_desired', requestOf(input, enabled)),
  }
}

/** The Zone's extension packages. The administrator says what the Zone should have; each node's reconciler gets there. */
export function createExtToolsModule(): CommandModule {
  return {
    name: 'ext-tools',
    summary: 'Manage the extension tool packages every Agent of the Zone shares',
    commands: [
      read('list', 'The packages published in the Repo, and what each provides', 'ext_tools.catalog'),
      read('status', 'Package by node: what is asked for and where each node got to', 'ext_tools.status'),
      desired('enable', 'Enable or upgrade a package, with the packages it requires', true),
      desired('disable', 'Disable a package; refused while an enabled package requires it', false),
      {
        verb: 'import',
        summary: 'Put an already built .pikg (an official release asset) into the Repo unchanged',
        positionals: [{ name: 'pikg', description: 'Local .pikg file' }],
        inputSchema: { type: 'object', properties: { pikg: { type: 'string', minLength: 1 } }, required: ['pikg'], additionalProperties: false },
        outputSchema: OBJECT_OUTPUT, resultSchemaVersion: 1, access: { mode: 'fixed', level: 'write' },
        asyncMode: 'sync', requiresSession: true,
        handler: async (ctx, input) => {
          const staging = await stageLocalPikg(ctx, String(input.pikg))
          return await call(ctx, 'ext_tools.import', { handle: staging.handle })
        },
      },
    ],
  }
}
