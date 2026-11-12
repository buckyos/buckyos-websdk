/**
 * What a control binds when it is placed or re-bound (buckyos notepads/aiworkspace-control-on-bind-todo.md): every
 * control placed in one go — a composite and the first Blocks of its slots, say — runs `on_bind` from parent to child
 * (a child sees what its parent bound), then `on_init_control` from child to parent (a parent checks its children are
 * ready); a failure or a cancelled dialog places nothing. A control without its own `on_bind` follows the default rule
 * of its binding declarations (`required`, `many`, `schema_id`); a composite writes its steps in component.json. The
 * host (the Desktop, the CLI) answers the data queries, shows the dialogs — or, with `no_ui` (an Agent), fails where a
 * person would have to choose — and turns the result into one Commit (`bindOps`). Shared by the Desktop and the CLI.
 */
import { CALENDAR_SCHEMA_ID, standardTableOp, TODO_SCHEMA_ID, type Json, type Op } from './aiws_schedule'

/** One binding a control declares (component.json `bindings`, a built-in control's contract). */
export interface BindingDecl {
  accepts?: string[]
  required?: boolean
  /** Takes several data: the instance binds a list. */
  many?: boolean
  /** Only tables of this business schema. */
  schema_id?: string
  title?: string
  description?: string
}

/** Bound data by binding name: one id, or a list for a `many` binding. An id may be a `ref` of data created here. */
export type Bound = Record<string, string | string[]>

/** Data of the Workspace a query answers. */
export interface DataInfo { entity_id: string; type_id: string; schema_id?: string | null; title?: string | null; name?: string | null; place?: string | null }
/** `ids`: only these (a control's own on_bind narrowing what a dialog offers). */
export interface DataQuery { accepts?: string[]; schema_id?: string; ids?: string[] }

/** Data the binding creates, in the canvas's content folder, owned by the control (`ref` names it in `bindings`). */
export type CreateSpec =
  | { ref: string; kind: 'standard'; schema_id: string; name: string }
  | { ref: string; kind: 'table'; name: string; title_field_id?: string; fields: Json[] }
  | { ref: string; kind: 'dir'; name: string }

/** The host's dialogs (`no_ui`: each fails with `needsUi`). */
export interface BindDialogs {
  pickOne(o: { title: string; note?: string; query: DataQuery; allow_new?: boolean; current?: string | null }): Promise<string | { new: true } | null>
  /** Each chosen id, and `{ new: true }` for a new one (when `allow_new`). */
  pickMany(o: { title: string; note?: string; query: DataQuery; preselect?: 'all' | 'none' | string[]; allow_new?: boolean }): Promise<(string | { new: true })[] | null>
  confirm(o: { title: string; text: string }): Promise<boolean>
}

export class BindFailure extends Error {
  constructor(message: string, readonly code: 'NEEDS_UI' | 'NO_DATA' | 'NOT_READY' | 'CANCELLED' | 'INVALID', readonly node?: string, readonly binding?: string) {
    super(message)
  }
}

export interface BindCtx {
  reason: 'insert' | 'rebind'
  no_ui: boolean
  /** The control's id in this placement and its title. */
  node: string
  title: string
  decls: Record<string, BindingDecl>
  /** Bindings already given: by an Agent, chosen before inserting, or the current ones on a re-bind. */
  given: Bound
  /** What the parent control declared and bound (none for the control placed at the top). */
  parent: { decls: Record<string, BindingDecl>; bound: Bound } | null
  find(q: DataQuery): DataInfo[]
  /** The standard schemas the host can create a table of. */
  canCreate(decl: BindingDecl): boolean
  dialogs: BindDialogs
}

export interface BindResult { bindings: Bound; create: CreateSpec[] }
export type OnBind = (ctx: BindCtx) => Promise<BindResult | null>

export interface ChildState { node: string; title: string; ready: boolean; missing: string[] }
export interface InitCtx {
  reason: 'insert' | 'rebind'
  no_ui: boolean
  node: string
  title: string
  decls: Record<string, BindingDecl>
  bound: Bound
  children: ChildState[]
  dialogs: BindDialogs
}
/** Ready (`true`), or why not. */
export type OnInit = (ctx: InitCtx) => Promise<true | string>

/** A composite's declared steps (component.json manifest 5). */
export type OnBindStep =
  | { binding: string; pick: 'one' | 'many' | 'all'; title?: string; allow_new?: boolean }
  | { binding: string; from_parent: string }
  | { binding: string; create: { standard: string } | { table: { name: string; title_field_id?: string; fields: Json[] } } | { dir: { name: string } }; when?: 'missing' | 'always' }
export type OnInitStep = { require: 'children' } | { then: { action: string } }

/** A control of this placement, with the controls placed under it. */
export interface BindNode {
  id: string
  title: string
  decls: Record<string, BindingDecl>
  given?: Bound
  onBind?: OnBind | OnBindStep[]
  onInit?: OnInit | OnInitStep[]
  children: BindNode[]
}

export interface BindHost {
  reason: 'insert' | 'rebind'
  no_ui: boolean
  find(q: DataQuery): DataInfo[]
  /** Standard schemas the host creates a table of (default: the to-do and calendar tables). */
  standardSchemas?: string[]
  dialogs: BindDialogs
  /** The control the placed one goes into, when it is one already on the canvas (a Block put into a composite). */
  parent?: { decls: Record<string, BindingDecl>; bound: Bound } | null
}

export type BindOutcome =
  | { ok: true; results: Map<string, BindResult>; then: { node: string; action: string }[] }
  | { ok: false; error: BindFailure }

export const STANDARD_SCHEMAS = [TODO_SCHEMA_ID, CALENDAR_SCHEMA_ID]

const asList = (v: string | string[] | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : [v])
const label = (name: string, decl: BindingDecl) => decl.title ?? name

/** Whether `data` is what a declaration takes. */
export function bindingAccepts(decl: BindingDecl, data: Pick<DataInfo, 'type_id' | 'schema_id'>): boolean {
  if (decl.accepts && decl.accepts.length > 0 && !decl.accepts.includes(data.type_id)) return false
  if (decl.schema_id && data.schema_id !== decl.schema_id) return false
  return true
}

const queryOf = (decl: BindingDecl): DataQuery => ({ ...(decl.accepts?.length ? { accepts: decl.accepts } : {}), ...(decl.schema_id ? { schema_id: decl.schema_id } : {}) })

/** The dialogs of a host without a person: every one fails, naming the binding a caller has to give. */
export function noUiDialogs(): BindDialogs {
  const fail = (title: string): never => { throw new BindFailure(`needs a choice: ${title}`, 'NEEDS_UI') }
  return { pickOne: async (o) => fail(o.title), pickMany: async (o) => fail(o.title), confirm: async (o) => fail(o.title) }
}

let refSeq = 0
const newRef = () => `ref:${++refSeq}`

const MAX_ITEMS = 32
const MAX_CREATE = 16

/** An on_bind's result as the host takes it — also what an HTML control's script returned (TODO §2.9): every binding a
 * declared one, a single binding one id, a `many` one at most 32; what it creates well-formed, its refs used and renamed
 * apart from other controls' refs of the same placement. */
export function checkBindResult(value: unknown, decls: Record<string, BindingDecl>, node: string): BindResult {
  const bad = (message: string): never => { throw new BindFailure(`on_bind result: ${message}`, 'INVALID', node) }
  const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
  if (!isObject(value) || !isObject(value.bindings)) return bad('{ bindings, create? } (or null to cancel)')
  const created = value.create === undefined ? [] : value.create
  if (!Array.isArray(created) || created.length > MAX_CREATE) return bad(`create: a list of at most ${MAX_CREATE}`)
  const refs = new Map<string, string>()
  const create: CreateSpec[] = created.map((c, i) => {
    const at = `create[${i}]`
    if (!isObject(c) || typeof c.ref !== 'string' || !c.ref) return bad(`${at}: { ref, kind, … }`)
    if (refs.has(c.ref)) return bad(`${at}: ref ${c.ref} twice`)
    const ref = newRef()
    refs.set(c.ref, ref)
    const name = typeof c.name === 'string' && c.name.trim() && c.name.length <= 128 ? c.name.trim() : null
    if (c.kind === 'standard') {
      if (typeof c.schema_id !== 'string') return bad(`${at}: a standard table names its schema_id`)
      return { ref, kind: 'standard', schema_id: c.schema_id, name: name ?? c.schema_id }
    }
    if (!name) return bad(`${at}: a name (at most 128 characters)`)
    if (c.kind === 'table') {
      if (!Array.isArray(c.fields) || c.fields.length === 0) return bad(`${at}: a table lists its fields`)
      if (c.title_field_id !== undefined && typeof c.title_field_id !== 'string') return bad(`${at}: title_field_id is a field id`)
      return { ref, kind: 'table', name, fields: c.fields as Json[], ...(c.title_field_id ? { title_field_id: c.title_field_id as string } : {}) }
    }
    if (c.kind === 'dir') return { ref, kind: 'dir', name }
    return bad(`${at}: kind standard, table or dir`)
  })
  const bindings: Bound = {}
  const used = new Set<string>()
  for (const [name, v] of Object.entries(value.bindings)) {
    const decl = decls[name]
    if (!decl) return bad(`${name} is not a declared binding`)
    if (v === null || v === undefined) continue
    const list = typeof v === 'string' ? [v] : Array.isArray(v) && v.every((x) => typeof x === 'string' && x) ? v as string[] : bad(`${name}: an id, or a list of ids`)
    if (!decl.many && (Array.isArray(v) || list.length !== 1)) return bad(`${name} takes one`)
    if (list.length > MAX_ITEMS || new Set(list).size !== list.length) return bad(`${name}: at most ${MAX_ITEMS}, each once`)
    const ids = list.map((id) => { if (refs.has(id)) used.add(id); return refs.get(id) ?? id })
    if (decl.many) { if (ids.length > 0) bindings[name] = ids } else bindings[name] = ids[0]
  }
  const unused = [...refs.keys()].filter((r) => !used.has(r))
  if (unused.length > 0) return bad(`created but not bound: ${unused.join(', ')}`)
  return { bindings, create }
}

/** The default rule of a declaration (TODO §2.4): given → the parent's matching data → the Workspace's data. */
export const defaultOnBind: OnBind = async (ctx) => {
  const bindings: Bound = {}
  const create: CreateSpec[] = []
  const parentData = ctx.parent ? Object.values(ctx.parent.bound).flatMap(asList) : []
  const known = new Map(ctx.find({}).map((d) => [d.entity_id, d]))
  for (const [name, decl] of Object.entries(ctx.decls)) {
    const failNamed = (message: string, code: BindFailure['code']) => new BindFailure(message, code, ctx.node, name)
    if (ctx.reason === 'rebind') {
      if (ctx.given[name] !== undefined && ctx.no_ui) { bindings[name] = ctx.given[name]; continue }
      const current = asList(ctx.given[name])
      if (decl.many) {
        const picked = await withName(name, () => ctx.dialogs.pickMany({ title: label(name, decl), query: queryOf(decl), preselect: current, allow_new: ctx.canCreate(decl) }))
        if (picked === null) return null
        bindings[name] = picked.map((p) => { if (typeof p === 'string') return p; const ref = newRef(); create.push(standardSpec(ref, decl, ctx.title)); return ref })
      } else {
        const picked = await withName(name, () => ctx.dialogs.pickOne({ title: label(name, decl), query: queryOf(decl), allow_new: ctx.canCreate(decl), current: current[0] ?? null }))
        if (picked === null) return null
        if (typeof picked === 'string') bindings[name] = picked
        else { const ref = newRef(); create.push(standardSpec(ref, decl, ctx.title)); bindings[name] = ref }
      }
      continue
    }
    if (ctx.given[name] !== undefined) { bindings[name] = decl.many ? asList(ctx.given[name]) : asList(ctx.given[name])[0]; continue }
    // what the parent bound that this binding takes (a child shares its parent's data)
    const fromParent = parentData.filter((id) => { const d = known.get(id); return d !== undefined && bindingAccepts(decl, d) })
    if (decl.many && fromParent.length > 0) { bindings[name] = fromParent; continue }
    if (!decl.many && fromParent.length === 1) { bindings[name] = fromParent[0]; continue }
    const found = ctx.find(queryOf(decl)).filter((d) => bindingAccepts(decl, d))
    if (found.length === 0) {
      if (!decl.required) continue
      if (!ctx.canCreate(decl)) throw failNamed(`no ${label(name, decl)} in this Workspace yet`, 'NO_DATA')
      const ref = newRef()
      create.push(standardSpec(ref, decl, ctx.title))
      bindings[name] = decl.many ? [ref] : ref
    } else if (decl.many) {
      bindings[name] = found.map((d) => d.entity_id)
    } else if (found.length === 1) {
      bindings[name] = found[0].entity_id
    } else if (decl.required) {
      const picked = await withName(name, () => ctx.dialogs.pickOne({ title: label(name, decl), query: queryOf(decl), allow_new: ctx.canCreate(decl) }))
      if (picked === null) return null
      if (typeof picked === 'string') bindings[name] = picked
      else { const ref = newRef(); create.push(standardSpec(ref, decl, ctx.title)); bindings[name] = ref }
    }
  }
  return { bindings, create }
}

/** A standard table to create for `decl`, named after the control placed. */
function standardSpec(ref: string, decl: BindingDecl, title: string): CreateSpec {
  return { ref, kind: 'standard', schema_id: decl.schema_id!, name: title || decl.title || 'Table' }
}

async function withName<T>(binding: string, run: () => Promise<T>): Promise<T> {
  try { return await run() } catch (error) {
    if (error instanceof BindFailure && error.code === 'NEEDS_UI') throw new BindFailure(`binding ${binding} needs a choice: give it`, 'NEEDS_UI', undefined, binding)
    throw error
  }
}

/** A composite's declared steps; bindings no step settles follow the default rule. */
export function stepsOnBind(steps: OnBindStep[]): OnBind {
  return async (ctx) => {
    const bindings: Bound = {}
    const create: CreateSpec[] = []
    for (const step of steps) {
      const decl = ctx.decls[step.binding] ?? {}
      if (ctx.given[step.binding] !== undefined && ctx.reason === 'insert') { bindings[step.binding] = ctx.given[step.binding]; continue }
      if ('from_parent' in step) {
        const v = ctx.parent?.bound[step.from_parent]
        if (v !== undefined) bindings[step.binding] = decl.many ? asList(v) : asList(v)[0]
      } else if ('pick' in step) {
        const query = queryOf(decl)
        const title = step.title ?? label(step.binding, decl)
        const allowNew = step.allow_new !== false && ctx.canCreate(decl)
        const current = asList(ctx.given[step.binding])
        if (step.pick === 'all') bindings[step.binding] = ctx.find(query).filter((d) => bindingAccepts(decl, d)).map((d) => d.entity_id)
        else if (step.pick === 'many') {
          const picked = await withName(step.binding, () => ctx.dialogs.pickMany({ title, query, preselect: current.length ? current : 'none', allow_new: allowNew }))
          if (picked === null) return null
          bindings[step.binding] = picked.map((p) => { if (typeof p === 'string') return p; const ref = newRef(); create.push(standardSpec(ref, decl, ctx.title)); return ref })
        } else {
          const picked = await withName(step.binding, () => ctx.dialogs.pickOne({ title, query, allow_new: allowNew, current: current[0] ?? null }))
          if (picked === null) return null
          if (typeof picked === 'string') bindings[step.binding] = decl.many ? [picked] : picked
          else { const ref = newRef(); create.push(standardSpec(ref, decl, ctx.title)); bindings[step.binding] = decl.many ? [ref] : ref }
        }
      } else {
        const missing = ctx.find(queryOf(decl)).filter((d) => bindingAccepts(decl, d)).length === 0
        if ((step.when ?? 'missing') === 'missing' && !missing) continue
        const ref = newRef()
        const c = step.create
        create.push('standard' in c ? { ref, kind: 'standard', schema_id: c.standard, name: label(step.binding, decl) }
          : 'table' in c ? { ref, kind: 'table', name: c.table.name, title_field_id: c.table.title_field_id, fields: c.table.fields }
          : { ref, kind: 'dir', name: c.dir.name })
        bindings[step.binding] = decl.many ? [ref] : ref
      }
    }
    // the rest by the default rule
    const rest = Object.fromEntries(Object.entries(ctx.decls).filter(([name]) => bindings[name] === undefined))
    if (Object.keys(rest).length > 0) {
      const more = await defaultOnBind({ ...ctx, decls: rest })
      if (more === null) return null
      Object.assign(bindings, more.bindings)
      create.push(...more.create)
    }
    return { bindings, create }
  }
}

const missingOf = (decls: Record<string, BindingDecl>, bound: Bound) =>
  Object.entries(decls).filter(([name, d]) => d.required && asList(bound[name]).length === 0).map(([name, d]) => label(name, d))

/** The default `on_init_control`: ready when this control and its children have their required bindings. */
export const defaultOnInit: OnInit = async (ctx) => {
  const own = missingOf(ctx.decls, ctx.bound)
  if (own.length > 0) return `${ctx.title}: ${own.join(', ')} not bound`
  const waiting = ctx.children.filter((c) => !c.ready)
  return waiting.length > 0 ? `not ready: ${waiting.map((c) => `${c.title} (${c.missing.join(', ')})`).join('; ')}` : true
}

/** Run both events over a placement; the `then` actions run after the host's Commit. */
export async function resolveBindings(root: BindNode, host: BindHost): Promise<BindOutcome> {
  const schemas = host.standardSchemas ?? STANDARD_SCHEMAS
  const dialogs = host.no_ui ? noUiDialogs() : host.dialogs
  const results = new Map<string, BindResult>()
  const then: { node: string; action: string }[] = []
  const visit = async (node: BindNode, parent: { decls: Record<string, BindingDecl>; bound: Bound } | null): Promise<ChildState> => {
    const ctx: BindCtx = {
      reason: host.reason, no_ui: host.no_ui, node: node.id, title: node.title, decls: node.decls, given: node.given ?? {}, parent,
      find: host.find, canCreate: (d) => Boolean(d.schema_id && schemas.includes(d.schema_id)), dialogs,
    }
    const run: OnBind = typeof node.onBind === 'function' ? node.onBind : Array.isArray(node.onBind) ? stepsOnBind(node.onBind) : defaultOnBind
    let result: BindResult | null
    try { result = await run(ctx) } catch (error) {
      if (error instanceof BindFailure) throw new BindFailure(error.message, error.code, error.node ?? node.id, error.binding)
      throw error
    }
    if (result === null) throw new BindFailure(`${node.title}: cancelled`, 'CANCELLED', node.id)
    result = checkBindResult(result, node.decls, node.id)
    results.set(node.id, result)
    const children: ChildState[] = []
    for (const child of node.children) children.push(await visit(child, { decls: node.decls, bound: result.bindings }))
    const init: OnInit = typeof node.onInit === 'function' ? node.onInit : defaultOnInit
    const steps = Array.isArray(node.onInit) ? node.onInit : []
    const verdict = await init({ reason: host.reason, no_ui: host.no_ui, node: node.id, title: node.title, decls: node.decls, bound: result.bindings, children, dialogs })
    if (verdict !== true) throw new BindFailure(verdict, 'NOT_READY', node.id)
    for (const step of steps) if ('then' in step) then.push({ node: node.id, action: step.then.action })
    return { node: node.id, title: node.title, ready: true, missing: [] }
  }
  try {
    await visit(root, host.parent ?? null)
    return { ok: true, results, then }
  } catch (error) {
    if (error instanceof BindFailure) return { ok: false, error }
    throw error
  }
}

/** The operations of what a placement creates, ids for its refs: `name(spec)` gives a free name in the folder, `orderKey()`
 * the next key there. */
export function createOps(results: Map<string, BindResult>, opts: { folderId: string; newId: () => string; orderKey: () => string; freeName: (name: string) => string; locale?: 'zh' | 'en' }): { ops: Op[]; ids: Record<string, string> } {
  const ops: Op[] = []
  const ids: Record<string, string> = {}
  for (const result of results.values()) {
    for (const spec of result.create) {
      const entity_id = opts.newId()
      ids[spec.ref] = entity_id
      const base = { entity_id, parent_id: opts.folderId, order_key: opts.orderKey(), name: opts.freeName(spec.name) }
      if (spec.kind === 'standard') {
        const kind = spec.schema_id === TODO_SCHEMA_ID ? 'todo' : spec.schema_id === CALENDAR_SCHEMA_ID ? 'calendar' : null
        if (!kind) throw new BindFailure(`cannot create a table of ${spec.schema_id}`, 'INVALID')
        ops.push(standardTableOp(kind, { ...base, locale: opts.locale }))
      } else if (spec.kind === 'table') {
        ops.push({ op: 'entity.create', type_id: 'buckyos.table-source', ...base, payload: { fields: spec.fields, ...(spec.title_field_id ? { title_field_id: spec.title_field_id } : {}) } })
      } else {
        ops.push({ op: 'entity.create', type_id: 'buckyos.dir', ...base, payload: { members: {} } })
      }
    }
  }
  return { ops, ids }
}

/** A control's `payload.bindings` from a result: a list for a `many` binding (none bound: left out). */
export function bindingsPayload(bound: Bound, decls: Record<string, BindingDecl>, ids: Record<string, string>): Record<string, Json> {
  const out: Record<string, Json> = {}
  for (const [name, value] of Object.entries(bound)) {
    const list = asList(value).map((id) => ({ entity_id: ids[id] ?? id }))
    if (decls[name]?.many || Array.isArray(value)) { if (list.length > 0) out[name] = list }
    else if (list[0]) out[name] = list[0]
  }
  return out
}

/** The ids a binding names (an outline's `bindings` value, one or a list). */
export function boundIds(value: string | string[] | null | undefined): string[] {
  return value === null || value === undefined ? [] : Array.isArray(value) ? value : [value]
}

/** Problems of declared steps (component.json manifest 5): `on_bind` / `on_init_control`, against the bindings and
 * actions the control declares. */
export function checkBindSteps(onBind: unknown, onInit: unknown, decls: Record<string, BindingDecl>, actions: string[]): string[] {
  const out: string[] = []
  if (onBind !== undefined) {
    if (!Array.isArray(onBind) || onBind.length > 16) out.push('on_bind: at most 16 steps')
    else for (const [i, raw] of onBind.entries()) {
      const s = raw as Record<string, unknown>
      const where = `on_bind[${i}]`
      if (!s || typeof s !== 'object' || typeof s.binding !== 'string') { out.push(`${where}: names a binding`); continue }
      const decl = decls[s.binding]
      if (!decl) { out.push(`${where}: ${s.binding} is not a declared binding`); continue }
      const kinds = ['pick', 'from_parent', 'create'].filter((k) => k in s)
      if (kinds.length !== 1) { out.push(`${where}: one of pick, from_parent, create`); continue }
      if ('pick' in s && !['one', 'many', 'all'].includes(String(s.pick))) out.push(`${where}: pick is one, many or all`)
      if ('pick' in s && s.pick !== 'one' && !decl.many) out.push(`${where}: ${s.binding} takes one`)
      if ('from_parent' in s && typeof s.from_parent !== 'string') out.push(`${where}: from_parent names a binding of the parent`)
      if ('create' in s) {
        const c = s.create as Record<string, unknown> | null
        const which = c && typeof c === 'object' ? ['standard', 'table', 'dir'].filter((k) => k in c) : []
        if (which.length !== 1) out.push(`${where}: create one of standard, table, dir`)
        else if (which[0] === 'standard' && !STANDARD_SCHEMAS.includes(String(c!.standard))) out.push(`${where}: no standard table ${String(c!.standard)}`)
        else if (which[0] === 'table' && (!Array.isArray((c!.table as Record<string, unknown>)?.fields) || typeof (c!.table as Record<string, unknown>)?.name !== 'string')) out.push(`${where}: create.table needs name and fields`)
        else if (which[0] === 'dir' && typeof (c!.dir as Record<string, unknown>)?.name !== 'string') out.push(`${where}: create.dir needs name`)
        if (s.when !== undefined && s.when !== 'missing' && s.when !== 'always') out.push(`${where}: when is missing or always`)
      }
    }
  }
  if (onInit !== undefined) {
    if (!Array.isArray(onInit) || onInit.length > 16) out.push('on_init_control: at most 16 steps')
    else for (const [i, raw] of onInit.entries()) {
      const s = raw as Record<string, unknown>
      const where = `on_init_control[${i}]`
      if (s?.require === 'children') continue
      const action = (s?.then as Record<string, unknown> | undefined)?.action
      if (typeof action !== 'string') out.push(`${where}: { require: "children" } or { then: { action } }`)
      else if (!actions.includes(action)) out.push(`${where}: ${action} is not a declared action`)
    }
  }
  return out
}
