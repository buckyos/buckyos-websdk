import type { CommandDefinition, CommandModule, JsonSchema } from '../core/command.ts'
import type { CommandContext } from '../core/context.ts'
import { EXIT_INTERNAL, ToolError, UsageError } from '../core/errors.ts'
import { expectObject, inputString, parseTimestamp, requiredInputString } from '../core/service.ts'

// Share links of the Zone file service (nfs-server `share.*` over NFSP,
// buckyos notepads/share-content-mgr-tech-design-todo.md §3.6).
const OBJECT_OUTPUT: JsonSchema = { type: 'object', additionalProperties: true }
const DAY_MS = 86_400_000
const EXPIRES_HELP = '1d, 7d (default), 30d, none, or an RFC 3339 time'

export function createShareModule(): CommandModule {
  return {
    name: 'share',
    summary: 'Share files and folders as links, and manage what you have shared',
    commands: [
      createCommand(),
      listCommand(),
      getCommand(),
      updateCommand(),
      stopCommand(),
      statsCommand(),
    ],
  }
}

interface NfspSession {
  call(method: string, args: Record<string, unknown>, write?: boolean): Promise<Record<string, unknown>>
}

async function openNfsp(ctx: CommandContext): Promise<NfspSession> {
  const session = ctx.session
  if (!session) throw new ToolError('AUTH_REQUIRED', 'authenticated session is required', 3)
  const token = (await session.ensureValid()).token
  const base = gatewayOrigin(ctx.connection.endpoint)
  let seq = 0
  const post = async (method: string, body: Record<string, unknown>) => {
    const response = await fetch(`${base}/nfs/v1/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: ctx.signal,
    })
    let parsed: { ok?: boolean; result?: unknown; error?: Record<string, unknown> }
    try {
      parsed = await response.json()
    } catch {
      throw new ToolError('INVALID_SERVICE_RESPONSE', `file service answered HTTP ${response.status}`, EXIT_INTERNAL)
    }
    if (parsed.ok !== true) {
      const error = parsed.error ?? {}
      const reason = typeof error.reason === 'string' ? error.reason.toUpperCase() : String(error.code ?? 'INTERNAL')
      throw new ToolError(`SHARE_${reason}`, String(error.message ?? 'share request failed'))
    }
    return expectObject(parsed.result, `${method} result`)
  }
  const hello = await post('hello', { args: { versions: ['nfsp/0'] } })
  const sessionId = String(hello.session ?? '')
  if (!Array.isArray(hello.features) || !hello.features.includes('share')) {
    throw new ToolError('SHARE_UNSUPPORTED', 'the file service of this Zone does not support sharing')
  }
  return {
    call: (method, args, write = false) =>
      post(method, { session: sessionId, args: { ...args, source_hint: 'cli' }, ...(write ? { seq: ++seq } : {}) }),
  }
}

/** The Zone gateway origin of a service endpoint (`…/kapi/<service>`): where `/nfs/v1` and other routes live. */
export function gatewayOrigin(endpoint: string): string {
  const url = new URL(endpoint)
  const marker = url.pathname.indexOf('/kapi')
  url.pathname = marker >= 0 ? url.pathname.slice(0, marker) || '/' : '/'
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

/** `--expires` → unix seconds, `null` for no expiry, `undefined` for the server default (7 days). */
export function parseExpires(value: unknown): number | null | undefined {
  if (value === undefined) return undefined
  const text = String(value).trim().toLowerCase()
  if (text === 'none' || text === 'never') return null
  const days = text.match(/^(\d+)d$/)
  if (days) return Math.floor((Date.now() + Number(days[1]) * DAY_MS) / 1000)
  const at = parseTimestamp(value, 'expires')
  if (at === undefined) return undefined
  if (at <= Date.now()) throw new UsageError('INVALID_ARGUMENT', 'expires must be in the future')
  return Math.floor(at / 1000)
}

function sourceLocator(path: string): Record<string, unknown> {
  if (path.startsWith('cyfs://')) return { uri: path }
  return { path: path.startsWith('/') ? path : `/${path}` }
}

function summary(share: Record<string, unknown>): Record<string, unknown> {
  const keep = ['share_id', 'kind', 'title', 'status', 'access', 'expires_at', 'url', 'target_app', 'delivery_state', 'source_path', 'revision', 'created_at', 'stats']
  return Object.fromEntries(keep.filter((key) => share[key] !== undefined).map((key) => [key, share[key]]))
}

function createCommand(): CommandDefinition {
  return {
    verb: 'create',
    summary: 'Share a file or folder as a link (a snapshot of its current content)',
    positionals: [{ name: 'path', description: 'File or folder, e.g. /home/alice/report.pdf or cyfs:///home/alice/report.pdf', required: true }],
    options: [
      { name: 'expires', description: `Link expiry: ${EXPIRES_HELP}`, type: 'string' },
      { name: 'password', description: 'Require this password to open the link', type: 'string' },
      { name: 'title', description: 'Title shown to visitors', type: 'string' },
      { name: 'no-download', property: 'no_download', description: 'Preview only, no download button', type: 'boolean' },
      { name: 'wait', description: 'Wait for a large snapshot to finish', type: 'boolean' },
    ],
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1 },
        expires: { type: 'string', minLength: 1 },
        password: { type: 'string', minLength: 1 },
        title: { type: 'string', minLength: 1 },
        no_download: { type: 'boolean' },
        wait: { type: 'boolean' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    outputSchema: OBJECT_OUTPUT,
    resultSchemaVersion: 1,
    access: { mode: 'fixed', level: 'write' },
    asyncMode: 'either',
    requiresSession: true,
    examples: [
      'buckyos share create /home/alice/report.pdf',
      'buckyos share create /home/alice/photos --expires 30d --password s3cret',
    ],
    handler: async (ctx, input) => {
      const nfsp = await openNfsp(ctx)
      const expires = parseExpires(input.expires)
      const password = inputString(input, 'password')
      const policy: Record<string, unknown> = {
        access: password ? 'password' : 'holder',
        allow_download: input.no_download !== true,
        ...(password ? { password } : {}),
        ...(expires !== undefined ? { expires_at: expires } : {}),
      }
      let op = await nfsp.call('share.create', {
        source: sourceLocator(requiredInputString(input, 'path')),
        policy,
        title: inputString(input, 'title'),
        idempotency_key: ctx.idempotencyKey ?? crypto.randomUUID(),
      }, true)
      while (input.wait === true && (op.state === 'running' || op.state === 'preparing')) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        ctx.signal.throwIfAborted()
        op = await nfsp.call('share.operation', { operation_id: op.operation_id })
      }
      if (op.state === 'failed' || op.state === 'canceled') {
        const error = (op.error ?? {}) as Record<string, unknown>
        throw new ToolError(`SHARE_${String(error.reason ?? op.state).toUpperCase()}`, String(error.message ?? `share ${op.state}`))
      }
      return {
        operation_id: op.operation_id,
        state: op.state,
        share_id: op.share_id ?? null,
        url: op.url ?? null,
        source_changed: op.source_changed ?? false,
        ...(op.share ? { share: summary(op.share as Record<string, unknown>) } : {}),
      }
    },
  }
}

function listCommand(): CommandDefinition {
  return {
    verb: 'list',
    summary: 'List your shares',
    options: [
      { name: 'kind', description: 'link or app_delivery', type: 'string', enum: ['link', 'app_delivery'] },
      { name: 'status', description: 'active, stopped, expired, ...', type: 'string' },
      { name: 'q', description: 'Search title and path', type: 'string' },
      { name: 'include-hidden', property: 'include_hidden', description: 'Include hidden shares', type: 'boolean' },
      { name: 'cursor', description: 'Page cursor', type: 'string' },
      { name: 'limit', description: 'Page size, at most 200', type: 'integer' },
    ],
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['link', 'app_delivery'] },
        status: { type: 'string', minLength: 1 },
        q: { type: 'string', minLength: 1 },
        include_hidden: { type: 'boolean' },
        cursor: { type: 'string', minLength: 1 },
        limit: { type: 'integer', minimum: 1 },
      },
      additionalProperties: false,
    },
    outputSchema: OBJECT_OUTPUT,
    resultSchemaVersion: 1,
    access: { mode: 'fixed', level: 'read' },
    asyncMode: 'sync',
    requiresSession: true,
    examples: ['buckyos share list --kind link --status active'],
    handler: async (ctx, input) => {
      const nfsp = await openNfsp(ctx)
      const page = await nfsp.call('share.list', {
        kind: input.kind,
        status: input.status,
        q: input.q,
        include_hidden: input.include_hidden === true,
        cursor: input.cursor,
        limit: input.limit,
      })
      const items = Array.isArray(page.items) ? page.items as Record<string, unknown>[] : []
      return { items: items.map(summary), next_cursor: page.next_cursor ?? null }
    },
  }
}

function getCommand(): CommandDefinition {
  return {
    verb: 'get',
    summary: 'Show one share: link, policy, snapshot, delivery, statistics and history',
    positionals: [{ name: 'share_id', description: 'Share ID (sh_…)', required: true }],
    inputSchema: {
      type: 'object',
      properties: { share_id: { type: 'string', minLength: 1 } },
      required: ['share_id'],
      additionalProperties: false,
    },
    outputSchema: OBJECT_OUTPUT,
    resultSchemaVersion: 1,
    access: { mode: 'fixed', level: 'read' },
    asyncMode: 'sync',
    requiresSession: true,
    examples: ['buckyos share get sh_0123456789abcdef'],
    handler: async (ctx, input) => {
      const nfsp = await openNfsp(ctx)
      return await nfsp.call('share.get', { share_id: requiredInputString(input, 'share_id') })
    },
  }
}

function updateCommand(): CommandDefinition {
  return {
    verb: 'update',
    summary: 'Change a link\'s expiry, password, title or download setting',
    positionals: [{ name: 'share_id', description: 'Share ID (sh_…)', required: true }],
    options: [
      { name: 'expires', description: `New expiry: ${EXPIRES_HELP}`, type: 'string' },
      { name: 'password', description: 'Set or change the password', type: 'string' },
      { name: 'no-password', property: 'no_password', description: 'Remove the password', type: 'boolean' },
      { name: 'title', description: 'New title', type: 'string' },
      { name: 'download', description: 'Allow (true) or forbid (false) downloading', type: 'boolean' },
    ],
    inputSchema: {
      type: 'object',
      properties: {
        share_id: { type: 'string', minLength: 1 },
        expires: { type: 'string', minLength: 1 },
        password: { type: 'string', minLength: 1 },
        no_password: { type: 'boolean' },
        title: { type: 'string', minLength: 1 },
        download: { type: 'boolean' },
      },
      required: ['share_id'],
      additionalProperties: false,
    },
    outputSchema: OBJECT_OUTPUT,
    resultSchemaVersion: 1,
    access: { mode: 'fixed', level: 'write' },
    asyncMode: 'sync',
    requiresSession: true,
    examples: ['buckyos share update sh_0123456789abcdef --expires none', 'buckyos share update sh_0123456789abcdef --password n3w'],
    handler: async (ctx, input) => {
      if (input.password !== undefined && input.no_password === true) {
        throw new UsageError('INVALID_ARGUMENT', 'use either --password or --no-password')
      }
      const changes: Record<string, unknown> = {}
      const expires = parseExpires(input.expires)
      if (expires !== undefined) changes.expires_at = expires
      if (input.password !== undefined) changes.password = String(input.password)
      if (input.no_password === true) changes.password = null
      if (input.title !== undefined) changes.title = String(input.title)
      if (input.download !== undefined) changes.allow_download = input.download === true
      if (!Object.keys(changes).length) throw new UsageError('INVALID_ARGUMENT', 'nothing to change')
      const nfsp = await openNfsp(ctx)
      const shareId = requiredInputString(input, 'share_id')
      const current = await nfsp.call('share.get', { share_id: shareId })
      const result = await nfsp.call('share.update', { share_id: shareId, revision: current.revision, changes }, true)
      return { revision: result.revision, share: summary(expectObject(result.share, 'share.update share')) }
    },
  }
}

function stopCommand(): CommandDefinition {
  return {
    verb: 'stop',
    summary: 'Stop a share: the link stops working and the kept snapshot is released',
    positionals: [{ name: 'share_id', description: 'Share ID (sh_…)', required: true }],
    options: [{ name: 'reason', description: 'Recorded in the share history', type: 'string' }],
    inputSchema: {
      type: 'object',
      properties: { share_id: { type: 'string', minLength: 1 }, reason: { type: 'string', minLength: 1 } },
      required: ['share_id'],
      additionalProperties: false,
    },
    outputSchema: OBJECT_OUTPUT,
    resultSchemaVersion: 1,
    access: { mode: 'fixed', level: 'destructive' },
    asyncMode: 'sync',
    requiresSession: true,
    examples: ['buckyos share stop sh_0123456789abcdef --reason "sent by mistake"'],
    handler: async (ctx, input) => {
      const nfsp = await openNfsp(ctx)
      const shareId = requiredInputString(input, 'share_id')
      const current = await nfsp.call('share.get', { share_id: shareId })
      return await nfsp.call('share.stop', { share_id: shareId, revision: current.revision, reason: inputString(input, 'reason') }, true)
    },
  }
}

function statsCommand(): CommandDefinition {
  return {
    verb: 'stats',
    summary: 'Views, downloads, traffic and visitors of one share or all of yours',
    options: [
      { name: 'share-id', property: 'share_id', description: 'One share instead of all', type: 'string' },
      { name: 'days', description: 'How many days back (default 30)', type: 'integer' },
      { name: 'granularity', description: 'day or hour', type: 'string', enum: ['day', 'hour'] },
    ],
    inputSchema: {
      type: 'object',
      properties: {
        share_id: { type: 'string', minLength: 1 },
        days: { type: 'integer', minimum: 1 },
        granularity: { type: 'string', enum: ['day', 'hour'] },
      },
      additionalProperties: false,
    },
    outputSchema: OBJECT_OUTPUT,
    resultSchemaVersion: 1,
    access: { mode: 'fixed', level: 'read' },
    asyncMode: 'sync',
    requiresSession: true,
    examples: ['buckyos share stats --days 7', 'buckyos share stats --share-id sh_0123456789abcdef --granularity hour --days 2'],
    handler: async (ctx, input) => {
      const nfsp = await openNfsp(ctx)
      const to = Math.floor(Date.now() / 1000) + 1
      const days = typeof input.days === 'number' ? input.days : 30
      return await nfsp.call('share.stats', {
        share_id: inputString(input, 'share_id'),
        from: to - days * 86_400,
        to,
        granularity: input.granularity ?? 'day',
      })
    },
  }
}
