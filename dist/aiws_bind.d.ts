/**
 * What a control binds when it is placed or re-bound (buckyos notepads/aiworkspace-control-on-bind-todo.md): every
 * control placed in one go — a composite and the first Blocks of its slots, say — runs `on_bind` from parent to child
 * (a child sees what its parent bound), then `on_init_control` from child to parent (a parent checks its children are
 * ready); a failure or a cancelled dialog places nothing. A control without its own `on_bind` follows the default rule
 * of its binding declarations (`required`, `many`, `schema_id`); a composite writes its steps in component.json. The
 * host (the Desktop, the CLI) answers the data queries, shows the dialogs — or, with `no_ui` (an Agent), fails where a
 * person would have to choose — and turns the result into one Commit (`bindOps`). Shared by the Desktop and the CLI.
 */
import { type Json, type Op } from './aiws_schedule';
/** One binding a control declares (component.json `bindings`, a built-in control's contract). */
export interface BindingDecl {
    accepts?: string[];
    required?: boolean;
    /** Takes several data: the instance binds a list. */
    many?: boolean;
    /** Only tables of this business schema. */
    schema_id?: string;
    title?: string;
    description?: string;
}
/** Bound data by binding name: one id, or a list for a `many` binding. An id may be a `ref` of data created here. */
export type Bound = Record<string, string | string[]>;
/** Data of the Workspace a query answers. */
export interface DataInfo {
    entity_id: string;
    type_id: string;
    schema_id?: string | null;
    title?: string | null;
    name?: string | null;
    place?: string | null;
}
export interface DataQuery {
    accepts?: string[];
    schema_id?: string;
}
/** Data the binding creates, in the canvas's content folder, owned by the control (`ref` names it in `bindings`). */
export type CreateSpec = {
    ref: string;
    kind: 'standard';
    schema_id: string;
    name: string;
} | {
    ref: string;
    kind: 'table';
    name: string;
    title_field_id?: string;
    fields: Json[];
} | {
    ref: string;
    kind: 'dir';
    name: string;
};
/** The host's dialogs (`no_ui`: each fails with `needsUi`). */
export interface BindDialogs {
    pickOne(o: {
        title: string;
        note?: string;
        query: DataQuery;
        allow_new?: boolean;
        current?: string | null;
    }): Promise<string | {
        new: true;
    } | null>;
    pickMany(o: {
        title: string;
        note?: string;
        query: DataQuery;
        preselect?: 'all' | 'none' | string[];
        allow_new?: boolean;
    }): Promise<string[] | null>;
    confirm(o: {
        title: string;
        text: string;
    }): Promise<boolean>;
}
export declare class BindFailure extends Error {
    readonly code: 'NEEDS_UI' | 'NO_DATA' | 'NOT_READY' | 'CANCELLED' | 'INVALID';
    readonly node?: string | undefined;
    readonly binding?: string | undefined;
    constructor(message: string, code: 'NEEDS_UI' | 'NO_DATA' | 'NOT_READY' | 'CANCELLED' | 'INVALID', node?: string | undefined, binding?: string | undefined);
}
export interface BindCtx {
    reason: 'insert' | 'rebind';
    no_ui: boolean;
    /** The control's id in this placement and its title. */
    node: string;
    title: string;
    decls: Record<string, BindingDecl>;
    /** Bindings already given: by an Agent, chosen before inserting, or the current ones on a re-bind. */
    given: Bound;
    /** What the parent control declared and bound (none for the control placed at the top). */
    parent: {
        decls: Record<string, BindingDecl>;
        bound: Bound;
    } | null;
    find(q: DataQuery): DataInfo[];
    /** The standard schemas the host can create a table of. */
    canCreate(decl: BindingDecl): boolean;
    dialogs: BindDialogs;
}
export interface BindResult {
    bindings: Bound;
    create: CreateSpec[];
}
export type OnBind = (ctx: BindCtx) => Promise<BindResult | null>;
export interface ChildState {
    node: string;
    title: string;
    ready: boolean;
    missing: string[];
}
export interface InitCtx {
    reason: 'insert' | 'rebind';
    no_ui: boolean;
    node: string;
    title: string;
    decls: Record<string, BindingDecl>;
    bound: Bound;
    children: ChildState[];
    dialogs: BindDialogs;
}
/** Ready (`true`), or why not. */
export type OnInit = (ctx: InitCtx) => Promise<true | string>;
/** A composite's declared steps (component.json manifest 5). */
export type OnBindStep = {
    binding: string;
    pick: 'one' | 'many' | 'all';
    title?: string;
    allow_new?: boolean;
} | {
    binding: string;
    from_parent: string;
} | {
    binding: string;
    create: {
        standard: string;
    } | {
        table: {
            name: string;
            title_field_id?: string;
            fields: Json[];
        };
    } | {
        dir: {
            name: string;
        };
    };
    when?: 'missing' | 'always';
};
export type OnInitStep = {
    require: 'children';
} | {
    then: {
        action: string;
    };
};
/** A control of this placement, with the controls placed under it. */
export interface BindNode {
    id: string;
    title: string;
    decls: Record<string, BindingDecl>;
    given?: Bound;
    onBind?: OnBind | OnBindStep[];
    onInit?: OnInit | OnInitStep[];
    children: BindNode[];
}
export interface BindHost {
    reason: 'insert' | 'rebind';
    no_ui: boolean;
    find(q: DataQuery): DataInfo[];
    /** Standard schemas the host creates a table of (default: the to-do and calendar tables). */
    standardSchemas?: string[];
    dialogs: BindDialogs;
    /** The control the placed one goes into, when it is one already on the canvas (a Block put into a composite). */
    parent?: {
        decls: Record<string, BindingDecl>;
        bound: Bound;
    } | null;
}
export type BindOutcome = {
    ok: true;
    results: Map<string, BindResult>;
    then: {
        node: string;
        action: string;
    }[];
} | {
    ok: false;
    error: BindFailure;
};
export declare const STANDARD_SCHEMAS: string[];
/** Whether `data` is what a declaration takes. */
export declare function bindingAccepts(decl: BindingDecl, data: Pick<DataInfo, 'type_id' | 'schema_id'>): boolean;
/** The dialogs of a host without a person: every one fails, naming the binding a caller has to give. */
export declare function noUiDialogs(): BindDialogs;
/** The default rule of a declaration (TODO §2.4): given → the parent's matching data → the Workspace's data. */
export declare const defaultOnBind: OnBind;
/** A composite's declared steps; bindings no step settles follow the default rule. */
export declare function stepsOnBind(steps: OnBindStep[]): OnBind;
/** The default `on_init_control`: ready when this control and its children have their required bindings. */
export declare const defaultOnInit: OnInit;
/** Run both events over a placement; the `then` actions run after the host's Commit. */
export declare function resolveBindings(root: BindNode, host: BindHost): Promise<BindOutcome>;
/** The operations of what a placement creates, ids for its refs: `name(spec)` gives a free name in the folder, `orderKey()`
 * the next key there. */
export declare function createOps(results: Map<string, BindResult>, opts: {
    folderId: string;
    newId: () => string;
    orderKey: () => string;
    freeName: (name: string) => string;
    locale?: 'zh' | 'en';
}): {
    ops: Op[];
    ids: Record<string, string>;
};
/** A control's `payload.bindings` from a result: a list for a `many` binding (none bound: left out). */
export declare function bindingsPayload(bound: Bound, decls: Record<string, BindingDecl>, ids: Record<string, string>): Record<string, Json>;
/** The ids a binding names (an outline's `bindings` value, one or a list). */
export declare function boundIds(value: string | string[] | null | undefined): string[];
/** Problems of declared steps (component.json manifest 5): `on_bind` / `on_init_control`, against the bindings and
 * actions the control declares. */
export declare function checkBindSteps(onBind: unknown, onInit: unknown, decls: Record<string, BindingDecl>, actions: string[]): string[];
//# sourceMappingURL=aiws_bind.d.ts.map