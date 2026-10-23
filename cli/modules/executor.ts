import { ExecutorCommandStream } from 'buckyos/node'
import type { CommandDefinition, CommandModule, JsonSchema } from '../core/command.ts'
import type { CommandContext } from '../core/context.ts'
import { ToolError } from '../core/errors.ts'
import { getHost } from '../runtime/host.ts'

const text = { type: 'string' as const, minLength: 1 }
type ExecutorRoute = Parameters<typeof ExecutorCommandStream.connect>[0]
type ExecutorOperationLocator = Parameters<InstanceType<typeof ExecutorCommandStream>['query']>[0]
const object = { type: 'object' as const, additionalProperties: true }
const targetProperties = {
  executor_id: text, generation: { type: 'integer' as const, minimum: 1 },
  profile_id: text, store_id: text, locator: text,
}

function call<T>(ctx: CommandContext, method: string, params: Record<string, unknown>): Promise<T> {
  return ctx.clients.call('control-panel', method, params, {
    traceId: ctx.traceId, signal: ctx.signal, timeoutMs: Math.max(1, (ctx.deadline ?? Date.now() + 30000) - Date.now()),
  })
}

function management(verb: string, method: string, properties: Record<string, JsonSchema>, required: string[], write = false): CommandDefinition {
  return {
    verb, summary: `Executor ${verb}`, inputSchema: { ...object, properties, required, additionalProperties: false },
    outputSchema: object, resultSchemaVersion: 1, access: { mode: 'fixed', level: write ? 'write' : 'read' },
    asyncMode: 'sync', requiresSession: true,
    options: Object.entries(properties).filter(([, schema]) => schema.type !== 'object').map(([name, schema]) => ({
      name: name.replaceAll('_', '-'), property: name, description: name, type: schema.type === 'integer' ? 'integer' as const : 'string' as const,
      required: required.includes(name),
    })),
    handler: (ctx, input) => call(ctx, method, input),
  }
}

export function createExecutorModule(): CommandModule {
  return {
    name: 'executor', summary: 'Manage lightweight devices and explicitly target online command/file executors',
    commands: [
      management('create', 'executor.device.create', { name: text, profiles: object, limits: object, expires_at_ms: { type: 'integer' } }, ['name', 'profiles'], true),
      management('list', 'executor.device.list', {}, []),
      management('issue', 'executor.device.issue', { executor_id: text, expires_at_ms: { type: 'integer' } }, ['executor_id'], true),
      management('revoke', 'executor.device.revoke', { executor_id: text }, ['executor_id'], true),
      management('delete', 'executor.device.delete', { executor_id: text }, ['executor_id'], true),
      management('online', 'executor.online.list', {}, []),
      operation('exec', { cmd: text, cwd: text, env: object, execution_timeout_ms: { type: 'integer', minimum: 1 } }, ['cmd', 'cwd']),
      operation('read', { path: text }, ['path']),
      operation('write', { path: text, content: { type: 'string' }, mode: { type: 'string', enum: ['replace', 'append', 'create_new'] } }, ['path', 'content']),
      operation('edit', { path: text, old_string: text, new_string: { type: 'string' } }, ['path', 'old_string', 'new_string']),
      operation('query', { channel: { type: 'string', enum: ['stdout', 'stderr', 'content'] }, offset: { type: 'integer', minimum: 0 }, wait_ms: { type: 'integer', minimum: 0 } }, []),
      operation('cancel', {}, []),
    ],
  }
}

function operation(verb: string, extra: Record<string, JsonSchema>, required: string[]): CommandDefinition {
  const recovery = verb === 'query' || verb === 'cancel'
  const properties: Record<string, JsonSchema> = { ...targetProperties, ...extra }
  return {
    verb, summary: `${verb} on an explicit executor; persist --locator before dispatch and query it after disconnection`,
    inputSchema: { ...object, properties, required: [...Object.keys(targetProperties), ...required], additionalProperties: false },
    outputSchema: object, resultSchemaVersion: 1,
    access: { mode: 'fixed', level: ['read', 'query'].includes(verb) ? 'read' : 'write' },
    asyncMode: 'sync', requiresSession: true,
    options: Object.entries(properties).filter(([, schema]) => schema.type !== 'object').map(([name, schema]) => ({
      name: name.replaceAll('_', '-'), property: name, description: name,
      type: schema.type === 'integer' ? 'integer' as const : 'string' as const,
      required: Object.keys(targetProperties).includes(name) || required.includes(name),
    })),
    handler: async (ctx, input) => {
      const target = { executor_id: String(input.executor_id), generation: Number(input.generation), profile_id: String(input.profile_id), store_id: String(input.store_id) }
      const path = String(input.locator)
      const host = getHost()
      let locator: ExecutorOperationLocator
      if (recovery) locator = JSON.parse(await host.readTextFile(path))
      else {
        locator = { ...target, op_id: crypto.randomUUID(), run_id: ctx.traceId, call_id: ctx.idempotencyKey ?? crypto.randomUUID() }
        await host.writeTextFile(path, JSON.stringify(locator) + '\n', { createNew: true, mode: 0o600 })
      }
      if (!ctx.session) throw new ToolError('AUTH_REQUIRED', 'An authenticated App session is required')
      const { token } = await ctx.session.ensureValid()
      const route = await call<ExecutorRoute>(ctx, 'executor.stream.open', { executor_id: target.executor_id, generation: target.generation, profile_id: target.profile_id })
      const stream = await ExecutorCommandStream.connect(route, target, token, 'buckyos-cli', locator.run_id)
      if (!stream) throw new ToolError('INVALID_SERVICE_RESPONSE', 'Executor stream did not initialize')
      const abort = () => stream.close()
      ctx.signal.addEventListener('abort', abort, { once: true })
      try {
        let reply
        if (verb === 'exec') reply = await stream.exec(locator, String(input.cmd), String(input.cwd), (input.env ?? {}) as Record<string, string>, Number(input.execution_timeout_ms ?? 60000))
        else if (verb === 'read') reply = await stream.read(locator, String(input.path))
        else if (verb === 'write') reply = await stream.write(locator, String(input.path), new TextEncoder().encode(String(input.content)), (input.mode ?? 'replace') as 'replace' | 'append' | 'create_new')
        else if (verb === 'edit') reply = await stream.edit(locator, String(input.path), [{ old_string: String(input.old_string), new_string: String(input.new_string) }])
        else if (verb === 'cancel') reply = await stream.cancel(locator)
        else reply = await stream.query(locator, input.channel as 'stdout' | 'stderr' | 'content' | undefined, Number(input.offset ?? 0), Number(input.wait_ms ?? 0))
        return { locator, reply }
      } finally { ctx.signal.removeEventListener('abort', abort); stream.close() }
    },
  }
}
