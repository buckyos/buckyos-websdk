import { objectUrl } from 'buckyos/node'
import type { CommandDefinition, CommandModule, JsonSchema } from '../core/command.ts'
import type { CommandContext } from '../core/context.ts'
import { EXIT_INTERNAL, ToolError, UsageError } from '../core/errors.ts'
import { requiredInputString } from '../core/service.ts'

// System URLs (buckyos doc/key url.md part one): `resolve` normalizes a reference and
// says where it lives, `read` follows a DID Object Card to its Profile and summary
// properties. Resolving a url never implies the caller may read it.
const OBJECT_OUTPUT: JsonSchema = { type: 'object', additionalProperties: true }
type ParsedUrl = ReturnType<typeof objectUrl.parseObjectUrl>
const URL_ARG = { name: 'url', description: 'obj:// cyfs:// file:// https:// url, or //<service>/... /abs/path shorthand', required: true }

export function createObjModule(): CommandModule {
  return {
    name: 'obj',
    summary: 'Resolve system URLs and read DID Objects (obj://, cyfs://, file://, https://)',
    commands: [resolveCommand(), readCommand()],
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
  const origin = gatewayOrigin(ctx.connection.endpoint)
  if (url.kind === 'obj') {
    const query = objectUrl.formatObjectUrl(url).split('?')[1]
    return `${origin}/kapi/${url.host!.name}/obj${url.path}${query ? `?${query}` : ''}`
  }
  if (url.kind === 'cyfs_path' && (url.zone === null || url.zone === ctx.connection.zone)) {
    return `${origin}/kapi/dfs/obj${url.path!.replace(/\/$/, '')}`
  }
  if (url.kind === 'web') return url.url
  return null
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
    handler: async (ctx, input) => describe(ctx, parse(requiredInputString(input, 'url'))),
  }
}

async function getJson(ctx: CommandContext, url: string): Promise<unknown> {
  const headers: Record<string, string> = { accept: 'application/json' }
  if (ctx.session) headers.authorization = `Bearer ${(await ctx.session.ensureValid()).token}`
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
      const card = (await getJson(ctx, endpoint)) as Record<string, any>
      const service = (card.service ?? []).find((s: Record<string, unknown>) => s.type === 'DIDObjectService')
      if (!service) throw new ToolError('INVALID_SERVICE_RESPONSE', `${endpoint} answered no DID Object Card`, EXIT_INTERNAL)
      const serviceEndpoint = String(service.serviceEndpoint).replace(/\/$/, '')
      const profileUrl = new URL(String(service.profile), `${serviceEndpoint}/`).toString()
      const profile = (await getJson(ctx, profileUrl)) as Record<string, any>
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
          actions: Object.fromEntries(Object.entries(profile.actions ?? {}).map(([name, a]: [string, any]) => [name, { risk: a['x-buckyos:risk'], rbac: a['x-buckyos:rbac'] }])),
          events: Object.fromEntries(Object.entries(profile.events ?? {}).map(([name, e]: [string, any]) => [name, e['x-buckyos:kevent']])),
        },
        properties,
      }
    },
  }
}
