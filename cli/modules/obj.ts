import { objectUrl } from 'buckyos/node'
import type { CommandDefinition, CommandModule, JsonSchema } from '../core/command.ts'
import type { CommandContext } from '../core/context.ts'
import { EXIT_INTERNAL, ToolError, UsageError } from '../core/errors.ts'
import { getHost } from '../runtime/host.ts'
import { callService, expectObject, requiredInputString } from '../core/service.ts'

// System URLs (buckyos doc/key url.md part one): `resolve` normalizes a reference and
// says where it lives, `read` follows a DID Object Card to its Profile and summary
// properties. Resolving a url never implies the caller may read it.
const OBJECT_OUTPUT: JsonSchema = { type: 'object', additionalProperties: true }
interface ObjectCard extends Record<string, unknown> {
  service?: Array<Record<string, unknown>>
}

interface ObjectProfile extends Record<string, unknown> {
  properties?: Record<string, unknown>
  actions?: Record<string, Record<string, unknown>>
  events?: Record<string, Record<string, unknown>>
  'x-buckyos:summary_props'?: string[]
}

type ParsedUrl = ReturnType<typeof objectUrl.parseObjectUrl>
const URL_ARG = { name: 'url', description: 'obj:// cyfs:// file:// https:// url, or //<service>/... /abs/path shorthand', required: true }

export function createObjModule(): CommandModule {
  return {
    name: 'obj',
    summary: 'Resolve system URLs and read DID Objects (obj://, cyfs://, file://, https://)',
    commands: [resolveCommand(), readCommand(), aliasCommand(), callCommand()],
  }
}

function gatewayOrigin(endpoint: string): string {
  const url = new URL(endpoint)
  const marker = url.pathname.indexOf('/kapi')
  url.pathname = marker >= 0 ? url.pathname.slice(0, marker) || '/' : '/'
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

function parse(raw: string): ParsedUrl {
  try {
    return objectUrl.parseObjectUrl(objectUrl.expandInputShorthand(raw))
  } catch (error) {
    throw new UsageError('INVALID_ARGUMENT', error instanceof Error ? error.message : String(error))
  }
}

/** The HTTP endpoint of a DID Object, when it has one: Provider routes for obj:// (and cyfs:///, its DFS object), https as is. */
function endpointOf(ctx: CommandContext, url: ParsedUrl): string | null {
  // Without a session the connection is a placeholder: give the gateway-relative path.
  const origin = /^https?:\/\//.test(ctx.connection.endpoint) ? gatewayOrigin(ctx.connection.endpoint) : ''

  return objectUrl.objectEndpoint(url, origin, ctx.connection.zone)
}

function describe(ctx: CommandContext, url: ParsedUrl): Record<string, unknown> {
  const out: Record<string, unknown> = {
    canonical: objectUrl.formatObjectUrl(url),
    kind: url.kind === 'obj' ? `obj_${url.host!.kind}` : url.kind,
    rbac_resource_key: objectUrl.rbacResourceKey(url, ctx.connection.zone),
    endpoint: endpointOf(ctx, url),
  }
  if (url.kind === 'obj') {
    out.host = url.host!.name
    out.event_pattern = objectUrl.objectEventPattern(url)
  }
  if (url.kind === 'file') out.device = url.deviceId ?? '(empty host: the source runtime, else the Zone default device)'
  if (url.kind === 'cyfs_object') out.obj_id = url.objId!.toString()
  return out
}

function resolveCommand(): CommandDefinition {
  return {
    verb: 'resolve',
    summary: 'Normalize a URL and show its identity, RBAC key, events and endpoint (no access check)',
    positionals: [URL_ARG],
    inputSchema: { type: 'object', properties: { url: { type: 'string', minLength: 1 } }, required: ['url'], additionalProperties: false },
    outputSchema: OBJECT_OUTPUT,
    resultSchemaVersion: 1,
    access: { mode: 'fixed', level: 'read' },
    asyncMode: 'sync',
    requiresSession: false,
    examples: ['buckyos obj resolve obj://msg-center/owners/did:bns:alice/sessions', 'buckyos obj resolve //config/boot/config', 'buckyos obj resolve cyfs:///home/alice/a.md'],
    handler: (ctx, input) => Promise.resolve(describe(ctx, parse(requiredInputString(input, 'url')))),
  }
}

async function getJson(ctx: CommandContext, url: string): Promise<unknown> {
  const headers: Record<string, string> = { accept: 'application/json' }
  if (ctx.session && new URL(url).origin === new URL(ctx.connection.endpoint).origin) headers.authorization = `Bearer ${(await ctx.session.ensureValid()).token}`
  const response = await fetch(url, { headers, signal: ctx.signal })
  const text = await response.text()
  if (!response.ok) {
    const code = response.status === 403 || response.status === 401 ? 'PERMISSION_DENIED' : response.status === 404 ? 'NOT_FOUND' : 'OBJECT_READ_FAILED'
    throw new ToolError(code, `${url}: HTTP ${response.status} ${text.slice(0, 300)}`)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new ToolError('INVALID_SERVICE_RESPONSE', `${url} did not answer JSON`, EXIT_INTERNAL)
  }
}

function readCommand(): CommandDefinition {
  return {
    verb: 'read',
    summary: 'Read a DID Object: its Card, Profile (properties, actions, events) and summary properties',
    positionals: [URL_ARG],
    options: [{ name: 'property', description: 'Read these properties instead of the summary ones (comma separated)', type: 'string' }],
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', minLength: 1 }, property: { type: 'string', minLength: 1 } },
      required: ['url'],
      additionalProperties: false,
    },
    outputSchema: OBJECT_OUTPUT,
    resultSchemaVersion: 1,
    access: { mode: 'fixed', level: 'read' },
    asyncMode: 'sync',
    requiresSession: true,
    examples: ['buckyos obj read obj://aiworkspace/ws_1/entities/e_1', 'buckyos obj read obj://xiaobai.test.buckyos.io/sessions/s-1 --property report'],
    handler: async (ctx, input) => {
      const url = parse(requiredInputString(input, 'url'))
      const endpoint = endpointOf(ctx, url)
      if (!endpoint) throw new ToolError('UNSUPPORTED_OBJECT', `${objectUrl.formatObjectUrl(url)} has no DID Object endpoint; read it as a file or content object`)
      const card = (await getJson(ctx, endpoint)) as ObjectCard
      const service = (card.service ?? []).find((s: Record<string, unknown>) => s.type === 'DIDObjectService')
      if (!service) throw new ToolError('INVALID_SERVICE_RESPONSE', `${endpoint} answered no DID Object Card`, EXIT_INTERNAL)
      const serviceEndpoint = String(service.serviceEndpoint).replace(/\/$/, '')
      const profileUrl = new URL(String(service.profile), `${serviceEndpoint}/`).toString()
      const profile = (await getJson(ctx, profileUrl)) as ObjectProfile
      const wanted = typeof input.property === 'string' ? input.property.split(',').map((p) => p.trim()).filter(Boolean) : (profile['x-buckyos:summary_props'] ?? [])
      const properties: Record<string, unknown> = {}
      for (const name of wanted) {
        if (!profile.properties?.[name]) throw new UsageError('INVALID_ARGUMENT', `property ${name} is not declared by the object`)
        properties[name] = await getJson(ctx, `${serviceEndpoint}/props/${encodeURIComponent(name)}`)
      }
      return {
        ...describe(ctx, url),
        object_did: card.id,
        also_known_as: card.alsoKnownAs ?? [],
        title: profile.title,
        description: profile.description,
        kind: service.kind ?? profile['x-buckyos:kind'],
        traits: profile['x-buckyos:traits'] ?? [],
        declared: {
          properties: Object.keys(profile.properties ?? {}),
          actions: Object.fromEntries(Object.entries(profile.actions ?? {}).map(([name, a]) => [name, { risk: a['x-buckyos:risk'], rbac: a['x-buckyos:rbac'] }])),
          events: Object.fromEntries(Object.entries(profile.events ?? {}).map(([name, e]) => [name, e['x-buckyos:kevent']])),
        },
        properties,
      }
    },
  }
}

function aliasCommand(): CommandDefinition {
  const names = ['list', 'set', 'rm']
  return {
    verb: 'alias', summary: 'List, override or reset object aliases in your current Zone',
    positionals: [{ name: 'action', description: 'list | set | rm', required: true }, { name: 'name', description: 'Complete alias name (set, rm)', required: false }],
    options: [
      { name: 'kind', description: 'local | link | disabled', type: 'string', enum: ['local', 'link', 'disabled'] },
      { name: 'object', description: 'Installed object ID for a local binding', type: 'string' },
      { name: 'url', description: 'Fixed Object URL for a link', type: 'string' },
      { name: 'if-revision', property: 'if_revision', description: 'Expected override revision (0 if never configured)', type: 'integer' },
    ],
    inputSchema: { type: 'object', properties: {
      action: { type: 'string', enum: names }, name: { type: 'string' }, kind: { type: 'string' },
      object: { type: 'string' }, url: { type: 'string' }, if_revision: { type: 'integer', minimum: 0 },
    }, required: ['action'], additionalProperties: false },
    outputSchema: OBJECT_OUTPUT, resultSchemaVersion: 1, access: { mode: 'operation', operationIdField: 'action', possibleLevels: ['read', 'write'] },
    asyncMode: 'sync', requiresSession: true,
    examples: ['buckyos obj alias list', 'buckyos obj alias set owner.cal --kind link --url obj://cal/calendars/alice --if-revision 0', 'buckyos obj alias rm owner.cal --if-revision 1'],
    handler: async (ctx, input) => {
      const { action, ...params } = input
      if (!names.includes(String(action))) throw new UsageError('INVALID_ARGUMENT', 'expected list, set or rm')
      if (action === 'list' && Object.keys(params).length) throw new UsageError('INVALID_ARGUMENT', 'list takes no arguments')
      if (action !== 'list' && (!params.name || !Number.isSafeInteger(params.if_revision))) throw new UsageError('INVALID_ARGUMENT', 'name and --if-revision are required')
      if (action === 'set' && !params.kind) throw new UsageError('INVALID_ARGUMENT', 'set requires --kind')
      const result = expectObject(await callService(ctx, 'control-panel', 'owner.alias.' + action, params), 'owner.alias.' + action)
      if (result.ok === false) {
        const e = expectObject(result.error, 'alias error')
        throw new ToolError(String(e.code), String(e.message), undefined, false, { detail: e.detail })
      }
      return result
    },
  }
}

function callCommand(): CommandDefinition {
  return {
    verb: 'call', summary: 'Invoke xcall with your current Zone session',
    description: 'Pass the object, action and xcall arguments verbatim. The installed agent_tool handles profiles, permissions, output and exit status.',
    examples: ['buckyos obj call owner who', 'buckyos obj call owner.todo add title=Review'],
    inputSchema: { type: 'object', properties: { argv: { type: 'array', items: { type: 'string' } } }, required: ['argv'] },
    outputSchema: { type: 'object', properties: { exit_code: { type: 'integer' } }, required: ['exit_code'] }, resultSchemaVersion: 1, access: { mode: 'fixed', level: 'write' },
    asyncMode: 'sync', requiresSession: true,
    handler: async (ctx, input) => {
      const host = getHost()
      const root = host.policy.buckyosRoot
      if (!root || host.policy.distribution !== 'system') throw new ToolError('EXTENSION_UNAVAILABLE', 'xcall requires the BuckyOS system installation')
      if (!ctx.session) throw new ToolError('AUTH_REQUIRED', 'xcall requires a signed-in Zone session')
      const { token } = await ctx.session.ensureValid()
      const exe = host.path.join(root, 'bin', 'opendan', host.platform === 'win32' || host.platform === 'windows' ? 'agent_tool.exe' : 'agent_tool')
      const env = { BUCKYOS_ROOT: root, BUCKYOS_TOOL_ENDPOINT: ctx.connection.endpoint, BUCKYOS_APPCLIENT_SESSION_TOKEN: token }
      const child = host.spawn(exe, ['xcall', ...(input.argv as string[])], { cwd: ctx.cwd, env })
      const cancel = () => child.kill()
      ctx.signal.addEventListener('abort', cancel, { once: true })
      try {
        await child.closeInput()
        for await (const line of child.lines()) await ctx.io.stdout(line + '\n')
        const stderr = await child.stderr
        if (stderr) await ctx.io.stderr(stderr)
        return { exit_code: await child.status }
      } finally {
        ctx.signal.removeEventListener('abort', cancel)
      }
    },
  }
}
