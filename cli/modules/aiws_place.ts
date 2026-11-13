import {
  AIWS_PROTOCOL_VERSION,
  BindFailure,
  bindingsPayload,
  createOps,
  noUiDialogs,
  orderKeyBetween,
  resolveBindings,
} from 'buckyos/node'
import type { CommandDefinition, JsonSchema } from '../core/command.ts'
import type { CommandContext } from '../core/context.ts'
import { ToolError, UsageError } from '../core/errors.ts'
import { callService, expectObject, inputString, requiredInputString } from '../core/service.ts'

// Placing a control on a canvas as an Agent (buckyos notepads/aiworkspace-control-on-bind-todo.md §2.8, Q6): the same
// on_bind / on_init_control a person's insertion runs (buckyos-websdk aiws_bind.ts), without dialogs (`no_ui`). What the
// Agent gives (--bind) is taken; what the default rule settles without a choice (none → created, one → bound) is done;
// where a person would have to choose, the command fails naming the binding to give. One Commit. An HTML control that
// decides its bindings in its own script (on_bind "script", TODO §2.9) is not run here: what the Agent gives is its ctx,
// taken as it is (owner 11-12).

const OBJECT_OUTPUT: JsonSchema = { type: 'object', additionalProperties: true }
const SERVICE = 'aiworkspace'
const NOT_DATA = new Set([
  'buckyos.cell',
  'buckyos.container',
  'buckyos.block-def',
  'buckyos.viewport',
  'buckyos.show-path',
])
const BUILTIN_SIZE: Record<string, { w: number; h: number }> = {
  todo: { w: 420, h: 520 },
  calendar: { w: 860, h: 620 },
}

type Envelope = Record<string, unknown> & {
  entity_id: string
  type_id: string
  parent_id?: string | null
  order_key?: string | null
  deleted?: boolean
}
// the shapes of buckyos-websdk aiws_bind.ts (the CLI reads the SDK's built JavaScript)
type BindingDecl = {
  accepts?: string[]
  required?: boolean
  many?: boolean
  schema_id?: string
  title?: string
}
type DataInfo = {
  entity_id: string
  type_id: string
  schema_id: string | null
  title: string | null
}
type DataQuery = { accepts?: string[]; schema_id?: string; ids?: string[] }
type GivenCtx = {
  node: string
  given: Record<string, string | string[]>
  decls: Record<string, BindingDecl>
}

/** An HTML control's on_bind for an Agent: its script runs in a person's browser only, so the bindings given are taken as
 * they are; a required one not given fails naming it. */
function givenOnly(title: string) {
  return (ctx: GivenCtx) => {
    const missing = Object.entries(ctx.decls).filter(([name, d]) =>
      d.required && ctx.given[name] === undefined
    )
      .map(([name]) => name)
    if (missing.length > 0) {
      throw new BindFailure(
        `${title} decides its data in its own script, which runs in a person's browser only: give ${
          missing.join(', ')
        } with --bind`,
        'NEEDS_UI',
        ctx.node,
        missing[0],
      )
    }
    return Promise.resolve({ bindings: ctx.given, create: [] })
  }
}
type Outcome =
  | {
    ok: true
    results: Map<string, { bindings: Record<string, string | string[]> }>
    then: { node: string; action: string }[]
  }
  | { ok: false; error: { code: string; message: string; binding?: string } }

async function call(
  ctx: CommandContext,
  method: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = expectObject(await callService<unknown>(ctx, SERVICE, method, params), method)
  if (result.ok === false) {
    const error = expectObject(result.error, `${method}.error`)
    const code = typeof error.code === 'string' ? error.code : 'AIWS_ERROR'
    throw new ToolError(code, `${code}: ${String(error.detail ?? code)}`, undefined, false, {
      ...(error.sub_code ? { sub_code: error.sub_code } : {}),
      ...(error.data !== undefined ? { data: error.data } : {}),
    })
  }
  return result
}

/** `name=id[,id];name2=id` → given bindings. */
function parseBind(text: string | undefined): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  for (const part of (text ?? '').split(';').map((s) => s.trim()).filter(Boolean)) {
    const at = part.indexOf('=')
    if (at <= 0) throw new UsageError('AIWS_USAGE', `--bind ${part}: name=id[,id]`)
    const ids = part.slice(at + 1).split(',').map((s) => s.trim()).filter(Boolean)
    out[part.slice(0, at).trim()] = ids.length === 1 ? ids[0] : ids
  }
  return out
}

function freeName(taken: Set<string>, base: string): string {
  let name = base
  for (let n = 2; taken.has(name); n++) name = `${base} (${n})`
  taken.add(name)
  return name
}

export const placeCommand: CommandDefinition = {
  verb: 'place',
  summary:
    'Place a control on a canvas the way a person inserts it: its on_bind settles its data (none → created, one → bound); give a binding where it would ask',
  description:
    'CONTROL is `todo`, `calendar` or a definition of the workspace (its entity id, or its identity <author_did>#<name>). Bindings you give (--bind "photos=d1;votes=t1,t2", a list for a `many` binding) are taken; the rest follow the control\'s on_bind with no dialogs: a choice a person would make fails with NEEDS_UI naming the binding to give. Data it creates (a standard table, a composite\'s declared table or folder) goes into the canvas\'s content folder, owned by the control. A composite\'s on_init_control actions (e.g. preparing a ballot) are listed in `then`: run them yourself (the Desktop runs them for a person). An HTML control whose own script decides its data (on_bind "script", see its AGENT.md) is not run here: give its bindings with --bind; a required one missing fails with NEEDS_UI.',
  positionals: [{
    name: 'control',
    description: 'todo | calendar | a definition id | <author_did>#<name>',
    required: true,
  }],
  options: [
    {
      name: 'workspace',
      property: 'workspace_id',
      description: 'Workspace id (ws_…)',
      type: 'string',
      required: true,
    },
    {
      name: 'surface',
      property: 'surface',
      description: 'Canvas (Surface) id',
      type: 'string',
      required: true,
    },
    {
      name: 'bind',
      property: 'bind',
      description: 'Bindings you give: "name=id[,id];name=id"',
      type: 'string',
    },
    { name: 'title', property: 'title', description: 'Title of the control', type: 'string' },
    {
      name: 'at',
      property: 'at',
      description: 'Position x,y on a free canvas (default: right of what is on it)',
      type: 'string',
    },
    {
      name: 'config',
      property: 'config',
      description: 'Instance properties, a JSON object',
      type: 'string',
    },
  ],
  inputSchema: {
    type: 'object',
    properties: {
      control: { type: 'string', minLength: 1 },
      workspace_id: { type: 'string', minLength: 1 },
      surface: { type: 'string', minLength: 1 },
      bind: { type: 'string' },
      title: { type: 'string' },
      at: { type: 'string' },
      config: { type: 'string' },
    },
    required: ['control', 'workspace_id', 'surface'],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT,
  resultSchemaVersion: 1,
  access: { mode: 'fixed', level: 'write' },
  asyncMode: 'sync',
  requiresSession: true,
  examples: [
    'buckyos aiws place todo --workspace ws_… --surface sf_…',
    'buckyos aiws place calendar --workspace ws_… --surface sf_… --bind "events=t_cal"',
    'buckyos aiws place did:bns:buckyos#photo-vote --workspace ws_… --surface sf_… --bind "photos=d_trip"',
  ],
  handler: async (ctx, input) => {
    const ws = requiredInputString(input, 'workspace_id')
    const surfaceId = requiredInputString(input, 'surface')
    const control = requiredInputString(input, 'control')
    const info = await call(ctx, 'ws.get_info', { workspace_id: ws })
    const entities = (await call(ctx, 'doc.outline', { workspace_id: ws })).entities as Envelope[]
    const byId = new Map(entities.map((e) => [e.entity_id, e]))
    const surface = byId.get(surfaceId)
    if (!surface || surface.kind !== 'surface') {
      throw new UsageError('AIWS_USAGE', `${surfaceId} is not a canvas of this workspace`)
    }
    const folderId = String(surface.content_folder_id ?? '')
    const config = inputString(input, 'config')
      ? JSON.parse(inputString(input, 'config')!) as Record<string, unknown>
      : undefined
    // by default right of what is already on the canvas, so the controls an Agent places do not cover each other
    const right = entities.filter((e) => e.parent_id === surfaceId && !e.deleted).reduce(
      (max, e) => {
        const p = e.placement as { x?: unknown; w?: unknown } | undefined
        return typeof p?.x === 'number'
          ? Math.max(max, p.x + (typeof p.w === 'number' ? p.w : 320))
          : max
      },
      0,
    )
    const at = inputString(input, 'at')
      ? inputString(input, 'at')!.split(',').map(Number)
      : [right > 0 ? right + 40 : 40, 40]

    // the control: a built-in data control's contract, or a definition of the workspace
    let decls: Record<string, BindingDecl>
    let node: { onBind?: unknown; onInit?: unknown } = {}
    let op: Record<string, unknown>
    let title = inputString(input, 'title') ?? undefined
    const id = `c${Math.random().toString(36).slice(2, 14)}`
    if (control === 'todo' || control === 'calendar') {
      const contract = expectObject(
        (await call(ctx, 'control.describe', { kind: control })).control,
        'control',
      ).contract as Record<string, unknown>
      decls = (contract.bindings ?? {}) as Record<string, BindingDecl>
      title ??= String(contract.title ?? control)
      const size = BUILTIN_SIZE[control]
      op = {
        op: 'entity.create',
        entity_id: id,
        type_id: 'buckyos.container',
        parent_id: surfaceId,
        placement: { x: at[0] || 40, y: at[1] || 40, ...size },
        payload: { kind: control, layout: { mode: 'data' }, title },
      }
    } else {
      const def = entities.find((e) =>
        e.type_id === 'buckyos.block-def' && !e.deleted &&
        (e.entity_id === control || e.ident === control)
      )
      if (!def) {
        throw new UsageError(
          'AIWS_USAGE',
          `no control ${control} in this workspace (build or import it first)`,
        )
      }
      const payload =
        ((await call(ctx, 'doc.read', { workspace_id: ws, entity_id: def.entity_id })).content as {
          payload: Record<string, unknown>
        }).payload
      decls = (payload.bindings ?? {}) as Record<string, BindingDecl>
      title ??= String(payload.title ?? def.entity_id)
      // a composite's declared steps; an HTML control's script is not run (its init check is the default one)
      node = payload.on_bind === 'script'
        ? { onBind: givenOnly(title) }
        : payload.kind === 'composite'
        ? { onBind: payload.on_bind, onInit: payload.on_init_control }
        : {}
      const size = (payload.default_size as { w: number; h: number } | undefined) ??
        { w: 320, h: 240 }
      op = payload.kind === 'composite'
        ? {
          op: 'entity.create',
          entity_id: id,
          type_id: 'buckyos.container',
          parent_id: surfaceId,
          placement: { x: at[0] || 40, y: at[1] || 40, w: 'auto', h: 'auto' },
          payload: {
            kind: 'composite',
            def_ref: { entity_id: def.entity_id },
            ...(config ? { config } : {}),
          },
        }
        : {
          op: 'entity.create',
          entity_id: id,
          type_id: 'buckyos.cell',
          parent_id: surfaceId,
          placement: { x: at[0] || 40, y: at[1] || 40, ...size },
          payload: {
            view: { type: String(payload.kind) },
            def_ref: { entity_id: def.entity_id },
            ...(config ? { config } : {}),
          },
        }
    }

    const data: DataInfo[] = entities.filter((e) => !e.deleted && !NOT_DATA.has(e.type_id))
      .map((e) => ({
        entity_id: e.entity_id,
        type_id: e.type_id,
        schema_id: (e.schema_id as string | null) ?? null,
        title: (e.title as string | null) ?? (e.name as string | null) ?? null,
      }))
    const outcome = await resolveBindings(
      {
        id,
        title: title!,
        decls,
        given: parseBind(inputString(input, 'bind') ?? undefined),
        children: [],
        ...node,
      } as never,
      {
        reason: 'insert',
        no_ui: true,
        dialogs: noUiDialogs(),
        find: (q: DataQuery) =>
          data.filter((d) =>
            (!q.accepts?.length || q.accepts.includes(d.type_id)) &&
            (!q.schema_id || d.schema_id === q.schema_id) && (!q.ids || q.ids.includes(d.entity_id))
          ),
      },
    ) as Outcome
    if (!outcome.ok) {
      throw new ToolError(
        outcome.error.code,
        `${outcome.error.code}: ${outcome.error.message}`,
        undefined,
        false,
        { ...(outcome.error.binding ? { binding: outcome.error.binding } : {}) },
      )
    }

    const children = entities.filter((e) => e.parent_id === folderId && !e.deleted)
    const taken = new Set(children.map((e) => String(e.name ?? '')).filter(Boolean))
    let last = children.map((e) => e.order_key ?? '').filter(Boolean).sort().at(-1) ?? null
    const made = createOps(outcome.results, {
      folderId,
      newId: () => `d${Math.random().toString(36).slice(2, 14)}`,
      orderKey: () => {
        last = orderKeyBetween(last, null)
        return last
      },
      freeName: (name: string) => freeName(taken, name),
      locale: /^zh/i.test(Intl.DateTimeFormat().resolvedOptions().locale) ? 'zh' : 'en',
    })
    const bindings = bindingsPayload(outcome.results.get(id)!.bindings, decls, made.ids)
    const lastOnCanvas =
      entities.filter((e) => e.parent_id === surfaceId && !e.deleted).map((e) => e.order_key ?? '')
        .filter(Boolean).sort().at(-1) ?? null
    op.order_key = orderKeyBetween(lastOnCanvas, null)
    if (Object.keys(bindings).length > 0) {
      ;(op.payload as Record<string, unknown>).bindings = bindings
    }
    const commit = await call(ctx, 'doc.commit', {
      protocol_version: AIWS_PROTOCOL_VERSION,
      workspace_id: ws,
      epoch: info.epoch,
      idempotency_key: `place-${id}`,
      origin: 'agent',
      message: `place ${title}`,
      operations: [...made.ops, op],
    })
    if (commit.status !== 'accepted') {
      throw new ToolError(
        'AIWS_COMMIT_REFUSED',
        `the placement was not accepted: ${JSON.stringify(commit).slice(0, 500)}`,
      )
    }
    return {
      entity_id: id,
      bindings,
      created: Object.values(made.ids),
      then: outcome.then.map((t) => t.action),
      commit_seq: commit.seq ?? null,
    }
  },
}
