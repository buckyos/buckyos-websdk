import type { CommandDefinition, CommandModule, JsonSchema } from '../core/command.ts'
import type { CommandContext } from '../core/context.ts'
import { EXIT_INTERNAL, ToolError, UsageError } from '../core/errors.ts'
import { callService, inputString, parseTimestamp, requiredInputString } from '../core/service.ts'
import { getHost } from '../runtime/host.ts'

// Application object buckets (BuckyOS doc/arch/应用对象桶 Bucket 设计.md §12.4):
// kRPC `bucket.*` on nfs-server plus the `/bucket/v1/<bucket_id>/<key>` data plane.
// A target is `obj://bucket/<scope>/<appid>/<owner>/<name>[/<key>]` or the same without the scheme.
const OBJECT_OUTPUT: JsonSchema = { type: 'object', additionalProperties: true }
const SERVICE = 'nfs-server'
const MAX_PUT_BYTES = 32 * 1024 * 1024
const DAY_MS = 86_400_000
/** `BucketError::code()` of bucket_store; service errors read `<code>: <message>`. */
const BUCKET_ERROR_CODES = [
  'bucket_not_found', 'no_such_key', 'invalid_key', 'invalid_argument', 'precondition_failed', 'permission_denied',
  'quota_exceeded', 'object_too_large', 'content_not_available', 'content_evicted', 'origin_unavailable', 'kind_mismatch',
  'policy_violation', 'origin_required', 'not_held', 'token_invalid', 'conflict', 'store_error', 'db_error', 'internal_error',
]

export function createBucketModule(): CommandModule {
  return {
    name: 'bucket',
    summary: 'Read and write application object buckets (key -> object, retained by the Zone)',
    commands: [lsCommand(), statCommand(), putCommand(), getCommand(), rmCommand(), linkCommand(), s3KeysCommand(), s3KeyCreateCommand(), s3KeyRevokeCommand()],
  }
}

export interface BucketTarget {
  bucketId: string
  key: string
}

/** Splits `obj://bucket/<scope>/<appid>/<owner>/<name>/<key...>` (scheme optional). */
export function parseBucketTarget(value: string, keyRequired: boolean): BucketTarget {
  const path = value.startsWith('obj://bucket/') ? value.slice('obj://bucket/'.length) : value
  const parts = path.split('/')
  if (parts.length < 4 || !['user', 'zone'].includes(parts[0]) || parts.slice(0, 4).some((p) => !p)) {
    throw new UsageError('INVALID_ARGUMENT', `'${value}' is not obj://bucket/<scope>/<appid>/<owner>/<name>[/<key>]`)
  }
  const key = parts.slice(4).join('/')
  if (keyRequired && !key) throw new UsageError('INVALID_ARGUMENT', `'${value}' names no key`)
  return { bucketId: parts.slice(0, 4).join('/'), key }
}

async function call<T = Record<string, unknown>>(ctx: CommandContext, method: string, params: Record<string, unknown>): Promise<T> {
  try {
    return await callService<T>(ctx, SERVICE, method, params)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const code = BUCKET_ERROR_CODES.find((c) => message.includes(`${c}: `))
    if (code) throw new ToolError(`BUCKET_${code.toUpperCase()}`, message)
    throw error
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

function objectUrl(ctx: CommandContext, target: BucketTarget, query: Record<string, string> = {}): string {
  const qs = new URLSearchParams(query).toString()
  const key = target.key.split('/').map(encodeURIComponent).join('/')
  return `${gatewayOrigin(ctx.connection.endpoint)}/bucket/v1/${target.bucketId}/${key}${qs ? `?${qs}` : ''}`
}

async function bearer(ctx: CommandContext): Promise<Record<string, string>> {
  if (!ctx.session) throw new ToolError('AUTH_REQUIRED', 'authenticated session is required', 3)
  return { Authorization: `Bearer ${(await ctx.session.ensureValid()).token}` }
}

async function failure(response: Response): Promise<never> {
  let body: Record<string, unknown> = {}
  try {
    body = await response.json()
  } catch {
    throw new ToolError('INVALID_SERVICE_RESPONSE', `bucket data plane answered HTTP ${response.status}`, EXIT_INTERNAL)
  }
  throw new ToolError(`BUCKET_${String(body.error ?? response.status).toUpperCase()}`, String(body.message ?? `HTTP ${response.status}`))
}

const TARGET = { name: 'target', description: 'obj://bucket/<scope>/<appid>/<owner>/<name>[/<key>]', required: true }

function lsCommand(): CommandDefinition {
  return {
    verb: 'ls',
    summary: 'List your buckets, or the keys of one bucket',
    positionals: [{ ...TARGET, required: false }],
    options: [
      { name: 'delimiter', description: 'Fold keys at this delimiter (e.g. /)', type: 'string' },
      { name: 'start-after', property: 'start_after', description: 'Continue after this key', type: 'string' },
      { name: 'limit', description: 'Page size, at most 1000', type: 'integer' },
      { name: 'appid', description: 'Only buckets of this app (no target)', type: 'string' },
    ],
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', minLength: 1 },
        delimiter: { type: 'string', minLength: 1 },
        start_after: { type: 'string', minLength: 1 },
        limit: { type: 'integer', minimum: 1 },
        appid: { type: 'string', minLength: 1 },
      },
      additionalProperties: false,
    },
    outputSchema: OBJECT_OUTPUT,
    resultSchemaVersion: 1,
    access: { mode: 'fixed', level: 'read' },
    asyncMode: 'sync',
    requiresSession: true,
    examples: ['buckyos bucket ls', 'buckyos bucket ls obj://bucket/user/photos/alice/library/2026/ --delimiter /'],
    handler: async (ctx, input) => {
      const raw = inputString(input, 'target')
      if (!raw) return { buckets: await call(ctx, 'bucket.list', { appid: inputString(input, 'appid') }) }
      const target = parseBucketTarget(raw, false)
      return await call(ctx, 'bucket.list_objects', {
        bucket_id: target.bucketId,
        prefix: target.key,
        delimiter: inputString(input, 'delimiter'),
        start_after: inputString(input, 'start_after'),
        limit: input.limit,
      })
    },
  }
}

function statCommand(): CommandDefinition {
  return {
    verb: 'stat',
    summary: 'Show a bucket (usage, quota) or a key (binding and where its content is)',
    positionals: [TARGET],
    options: [{ name: 'version', description: 'A specific version of the key', type: 'integer' }],
    inputSchema: {
      type: 'object',
      properties: { target: { type: 'string', minLength: 1 }, version: { type: 'integer', minimum: 1 } },
      required: ['target'],
      additionalProperties: false,
    },
    outputSchema: OBJECT_OUTPUT,
    resultSchemaVersion: 1,
    access: { mode: 'fixed', level: 'read' },
    asyncMode: 'sync',
    requiresSession: true,
    examples: ['buckyos bucket stat obj://bucket/user/photos/alice/library', 'buckyos bucket stat obj://bucket/user/photos/alice/library/a.jpg'],
    handler: async (ctx, input) => {
      const target = parseBucketTarget(requiredInputString(input, 'target'), false)
      if (!target.key) {
        const [bucket, quota] = await Promise.all([
          call(ctx, 'bucket.stat', { bucket_id: target.bucketId }),
          call(ctx, 'bucket.get_quota', { bucket_id: target.bucketId }),
        ])
        return { bucket, quota }
      }
      return await call(ctx, 'bucket.head', { bucket_id: target.bucketId, key: target.key, version: input.version })
    },
  }
}

function putCommand(): CommandDefinition {
  return {
    verb: 'put',
    summary: 'Store a local file (up to 32 MiB) under a key; success means the Zone retains it',
    positionals: [TARGET, { name: 'file', description: 'Local file to upload', required: true }],
    options: [
      { name: 'content-type', property: 'content_type', description: 'Content-Type of the object', type: 'string' },
      { name: 'if-absent', property: 'if_absent', description: 'Fail if the key already exists', type: 'boolean' },
      { name: 'expires', description: 'Unbind after: 1d, 7d, or an RFC 3339 time (temp/cache/app_data buckets)', type: 'string' },
    ],
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', minLength: 1 },
        file: { type: 'string', minLength: 1 },
        content_type: { type: 'string', minLength: 1 },
        if_absent: { type: 'boolean' },
        expires: { type: 'string', minLength: 1 },
      },
      required: ['target', 'file'],
      additionalProperties: false,
    },
    outputSchema: OBJECT_OUTPUT,
    resultSchemaVersion: 1,
    access: { mode: 'fixed', level: 'write' },
    asyncMode: 'sync',
    requiresSession: true,
    networkAccess: true,
    examples: ['buckyos bucket put obj://bucket/user/photos/alice/library/2026/a.jpg ./a.jpg --content-type image/jpeg'],
    handler: async (ctx, input) => {
      const target = parseBucketTarget(requiredInputString(input, 'target'), true)
      const bytes = await getHost().readFile(requiredInputString(input, 'file'))
      if (bytes.byteLength > MAX_PUT_BYTES) {
        throw new UsageError('FILE_TOO_LARGE', 'files over 32 MiB go through the SDK upload (ndm.startUpload with bind)')
      }
      const headers: Record<string, string> = { ...(await bearer(ctx)) }
      const contentType = inputString(input, 'content_type')
      if (contentType) headers['Content-Type'] = contentType
      if (input.if_absent === true) headers['If-None-Match'] = '*'
      const expires = inputString(input, 'expires')
      if (expires) {
        const days = expires.match(/^(\d+)d$/)
        const at = days ? Date.now() + Number(days[1]) * DAY_MS : parseTimestamp(expires, 'expires')
        if (at !== undefined) headers['x-bucky-expires-at'] = String(at)
      }
      const response = await fetch(objectUrl(ctx, target), { method: 'PUT', headers, body: new Blob([bytes as Uint8Array<ArrayBuffer>]), signal: ctx.signal })
      if (!response.ok) await failure(response)
      return await response.json()
    },
  }
}

function getCommand(): CommandDefinition {
  return {
    verb: 'get',
    summary: 'Download a key to a local file',
    positionals: [TARGET, { name: 'output', description: 'Local file to write', required: true }],
    options: [{ name: 'version', description: 'A specific version of the key', type: 'integer' }],
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', minLength: 1 },
        output: { type: 'string', minLength: 1 },
        version: { type: 'integer', minimum: 1 },
      },
      required: ['target', 'output'],
      additionalProperties: false,
    },
    outputSchema: OBJECT_OUTPUT,
    resultSchemaVersion: 1,
    access: { mode: 'fixed', level: 'read' },
    asyncMode: 'sync',
    requiresSession: true,
    networkAccess: true,
    examples: ['buckyos bucket get obj://bucket/user/photos/alice/library/2026/a.jpg ./a.jpg'],
    handler: async (ctx, input) => {
      const target = parseBucketTarget(requiredInputString(input, 'target'), true)
      const query: Record<string, string> = input.version !== undefined ? { version: String(input.version) } : {}
      const response = await fetch(objectUrl(ctx, target, query), { headers: await bearer(ctx), signal: ctx.signal })
      if (!response.ok) await failure(response)
      const bytes = new Uint8Array(await response.arrayBuffer())
      const output = requiredInputString(input, 'output')
      await getHost().writeFile(output, bytes)
      return {
        output,
        size: bytes.byteLength,
        obj_id: response.headers.get('x-bucky-obj-id'),
        version: Number(response.headers.get('x-bucky-version')),
        content_type: response.headers.get('content-type'),
      }
    },
  }
}

function rmCommand(): CommandDefinition {
  return {
    verb: 'rm',
    summary: 'Unbind a key (the bucket stops retaining its content)',
    positionals: [TARGET],
    options: [{ name: 'version', description: 'Remove only this version', type: 'integer' }],
    inputSchema: {
      type: 'object',
      properties: { target: { type: 'string', minLength: 1 }, version: { type: 'integer', minimum: 1 } },
      required: ['target'],
      additionalProperties: false,
    },
    outputSchema: OBJECT_OUTPUT,
    resultSchemaVersion: 1,
    access: { mode: 'fixed', level: 'write' },
    asyncMode: 'sync',
    requiresSession: true,
    examples: ['buckyos bucket rm obj://bucket/user/photos/alice/library/2026/a.jpg'],
    handler: async (ctx, input) => {
      const target = parseBucketTarget(requiredInputString(input, 'target'), true)
      return await call(ctx, 'bucket.delete', { bucket_id: target.bucketId, key: target.key, version: input.version })
    },
  }
}

function linkCommand(): CommandDefinition {
  return {
    verb: 'link',
    summary: 'Create a revocable read link to one key (up to 7 days, no Zone account needed)',
    positionals: [TARGET],
    options: [
      { name: 'expires', description: '1d (default) to 7d, or an RFC 3339 time', type: 'string' },
      { name: 'max-uses', property: 'max_uses', description: 'Stop after this many reads', type: 'integer' },
    ],
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', minLength: 1 },
        expires: { type: 'string', minLength: 1 },
        max_uses: { type: 'integer', minimum: 1 },
      },
      required: ['target'],
      additionalProperties: false,
    },
    outputSchema: OBJECT_OUTPUT,
    resultSchemaVersion: 1,
    access: { mode: 'fixed', level: 'write' },
    asyncMode: 'sync',
    requiresSession: true,
    examples: ['buckyos bucket link obj://bucket/user/photos/alice/library/2026/a.jpg --expires 3d'],
    handler: async (ctx, input) => {
      const target = parseBucketTarget(requiredInputString(input, 'target'), true)
      const text = inputString(input, 'expires') ?? '1d'
      const days = text.match(/^(\d+)d$/)
      const expiresAt = days ? Date.now() + Number(days[1]) * DAY_MS : parseTimestamp(text, 'expires')
      if (expiresAt === undefined) throw new UsageError('INVALID_ARGUMENT', 'expires is required')
      const issued = await call(ctx, 'bucket.create_access_token', {
        bucket_id: target.bucketId,
        key: target.key,
        actions: ['read'],
        expires_at: expiresAt,
        max_uses: input.max_uses,
      })
      return { ...issued, url: `${gatewayOrigin(ctx.connection.endpoint)}${String(issued.path)}` }
    },
  }
}

function s3KeysCommand(): CommandDefinition {
  return {
    verb: 's3-keys',
    summary: 'List your S3 access keys (secrets are shown only when created)',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: OBJECT_OUTPUT,
    resultSchemaVersion: 1,
    access: { mode: 'fixed', level: 'read' },
    asyncMode: 'sync',
    requiresSession: true,
    examples: ['buckyos bucket s3-keys'],
    handler: async (ctx) => ({ keys: await call(ctx, 'bucket.list_s3_keys', {}) }),
  }
}

function s3KeyCreateCommand(): CommandDefinition {
  return {
    verb: 's3-key-create',
    summary: 'Issue an S3 access key for one of your apps (endpoint https://<zone>/s3 or https://s3.<zone>)',
    options: [
      { name: 'app', description: 'App id whose buckets the key reaches', type: 'string' },
      { name: 'prefix', description: 'Only keys under this prefix', type: 'string' },
      { name: 'expires', description: 'Expiry: 30d, or an RFC 3339 time (default: none)', type: 'string' },
    ],
    inputSchema: {
      type: 'object',
      properties: { app: { type: 'string', minLength: 1 }, prefix: { type: 'string', minLength: 1 }, expires: { type: 'string', minLength: 1 } },
      required: ['app'],
      additionalProperties: false,
    },
    outputSchema: OBJECT_OUTPUT,
    resultSchemaVersion: 1,
    access: { mode: 'fixed', level: 'write' },
    asyncMode: 'sync',
    requiresSession: true,
    examples: ['buckyos bucket s3-key-create --app photos.app.bns.did --expires 30d'],
    handler: async (ctx, input) => {
      const text = inputString(input, 'expires')
      const days = text?.match(/^(\d+)d$/)
      const expiresAt = !text ? undefined : days ? Date.now() + Number(days[1]) * DAY_MS : parseTimestamp(text, 'expires')
      const prefix = inputString(input, 'prefix')
      const key = await call(ctx, 'bucket.create_s3_key', {
        appid: requiredInputString(input, 'app'),
        scope: prefix ? { prefix } : undefined,
        expires_at: expiresAt,
      })
      return { ...key, endpoint: `${gatewayOrigin(ctx.connection.endpoint)}/s3`, region: 'us-east-1', path_style: true }
    },
  }
}

function s3KeyRevokeCommand(): CommandDefinition {
  return {
    verb: 's3-key-revoke',
    summary: 'Revoke an S3 access key (its presigned URLs stop working too)',
    positionals: [{ name: 'access_key_id', description: 'Access key id (BK…)', required: true }],
    inputSchema: {
      type: 'object',
      properties: { access_key_id: { type: 'string', minLength: 1 } },
      required: ['access_key_id'],
      additionalProperties: false,
    },
    outputSchema: OBJECT_OUTPUT,
    resultSchemaVersion: 1,
    access: { mode: 'fixed', level: 'write' },
    asyncMode: 'sync',
    requiresSession: true,
    examples: ['buckyos bucket s3-key-revoke BKABCDEFGHIJKLMNOPQR'],
    handler: async (ctx, input) => await call(ctx, 'bucket.revoke_s3_key', { access_key_id: requiredInputString(input, 'access_key_id') }),
  }
}
