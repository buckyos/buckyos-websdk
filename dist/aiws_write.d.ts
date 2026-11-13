import { type Json, type Op, type RowLike } from './aiws_schedule';
/** A field of a table as `doc.read` answers it (`content.fields[]`). */
export interface AiwsFieldRead {
    field_id: string;
    name: string;
    type: string;
    options?: {
        option_id: string;
        label: string;
    }[];
    currency?: string;
    order_key?: string;
    def_rev?: number;
}
/** A table as `doc.read` answers it (`entity_id`, `content.fields`), or `{ entity_id, fields }`. */
export interface AiwsTableRead {
    entity_id: string;
    content?: {
        fields?: AiwsFieldRead[];
    } | null;
    fields?: AiwsFieldRead[];
}
/** A record as `doc.read` with a `table_record` selector answers it (the record is its `content`), the record
 * itself, or the SQL `_record` column (JSON text). */
export type AiwsRecordRead = RowLike | {
    content: RowLike;
} | string;
/** An entity as `doc.read` answers it (the envelope: `meta_rev`, `struct_rev`, `content.key_revs`), or as
 * `doc.read { as: "meta" }` does (`version`). */
export interface AiwsEntityRead {
    entity_id: string;
    meta_rev?: number;
    struct_rev?: number | null;
    version?: {
        meta_rev?: number;
        struct_rev?: number | null;
    };
    content?: {
        key_revs?: Record<string, number>;
    } | null;
}
export interface AiwsBlockState {
    block_id: string;
    hash: string;
    struct_rev: number;
}
/** A rich text as `doc.read` answers it: `content.blocks` holds each block's `hash` and `struct_rev`. */
export interface AiwsRichTextRead {
    entity_id: string;
    content?: {
        blocks?: Record<string, {
            hash: string;
            struct_rev: number;
        }>;
    } | null;
}
/** A block as `doc.read` with a `richtext_block` selector answers it (in `content`), or its state itself. */
export type AiwsBlockRead = AiwsBlockState | {
    content: AiwsBlockState;
};
/** The field a key names: its name first, else its field id. */
export declare function fieldNamed(table: AiwsTableRead, key: string): AiwsFieldRead;
/** A cell value from its display form (what the body and the SQL display columns show) or its stored form: a select
 * takes its label (or option id), a multi-select an array of them (or `a; b`, or the JSON array text), a number a
 * numeric string, a boolean `true` / `false` / 1 / 0, a decimal a number, a currency `{ amount, currency }`, an amount,
 * or `USD 12.50`, an object reference `{ entity_id }` or an entity id (a path must be resolved first), a json field an
 * object or its JSON text. A `{ "$formula" }` object passes as it is; `null` stays `null` (unset). */
export declare function cellValue(field: AiwsFieldRead, value: unknown): Json;
/** `table.insert_records` of rows keyed by field name (or field id), values in display form (`cellValue`). A row's
 * `_id` (when no field is named so) is its record id; one is generated otherwise. */
export declare function tableInsert(table: AiwsTableRead, rows: Record<string, unknown>[], opts?: {
    newRecordId?: () => string;
}): Op[];
/** `table.set_values` / `table.unset_values` (null unsets) of one record, keyed by field name, each cell expected at
 * the rev of `read` — the record as read (`doc.read` with `{ kind: "table_record", record_id }`, or SQL `_record`). */
export declare function tableSet(table: AiwsTableRead, recordId: string, values: Record<string, unknown>, read: AiwsRecordRead): Op[];
/** `table.delete_records`, each record expected at the rev it was read with (`reads`: the records as read). */
export declare function tableDelete(table: AiwsTableRead | string, recordIds: string[], reads: AiwsRecordRead[]): Op[];
/** A field to add: `options` are labels (or `{ label, option_id? }`) of a select / multi-select. */
export interface AiwsFieldInput {
    name: string;
    type: string;
    field_id?: string;
    options?: (string | {
        label: string;
        option_id?: string;
    })[];
    required?: boolean;
    nullable?: boolean;
    unique?: boolean;
    description?: string;
    scale?: number;
    currency?: string;
    max_items?: number;
    target_types?: string[];
}
/** `table.add_field`: a generated field id (and option ids), placed after the last field; a required field of a table
 * with records needs `backfill` (display form). */
export declare function fieldAdd(table: AiwsTableRead, def: AiwsFieldInput, opts?: {
    backfill?: unknown;
}): Op;
/** `table.add_option`: a new option `label` of a select / multi-select field (by name), expected at the field's
 * `def_rev` as read. */
export declare function optionAdd(table: AiwsTableRead, field: string, label: string, opts?: {
    option_id?: string;
    index?: number;
}): Op;
/** `richtext.insert_blocks` of `markdown` (`markdownToBlocks`) at the end of the document. */
export declare function textAppend(doc: AiwsRichTextRead | string, markdown: string, opts?: {
    prefix?: string;
}): Op[];
/** `richtext.replace_block` of one block by the first block of `markdown` (it keeps the block id), expected at the
 * hash it was read with (`read`, else the document's `content.blocks`); further blocks of `markdown` are inserted
 * after it. */
export declare function textReplaceBlock(doc: AiwsRichTextRead, blockId: string, markdown: string, read?: AiwsBlockRead, opts?: {
    prefix?: string;
}): Op[];
/** `richtext.delete_blocks`, each block expected at the hash and position it was read with. */
export declare function textDeleteBlocks(doc: AiwsRichTextRead, blockIds: string[], reads?: AiwsBlockRead[]): Op[];
/** `entity.rename` (null gives the name back to the title rule), expected at the `meta_rev` the entity was read with. */
export declare function rename(entity: AiwsEntityRead, name: string | null): Op;
/** `tree.move` under `parentId`, between the order keys `after` and `before` of its new siblings (`after`: the last
 * child's key appends; neither: the parent has no children); expected at the `struct_rev` it was read with, if read. */
export declare function move(entity: AiwsEntityRead | string, parentId: string, after?: string | null, before?: string | null): Op;
/** `entity.set_props` of a Block or a container: properties of `config`, `bindings` or `on` (null removes one), each
 * expected at the rev of its cell in `read` (or in `entity`, when it is a read): `content.key_revs["p:<key>.<name>"]`.
 * Without a read the properties merge (no `expect`). */
export declare function setProps(entity: AiwsEntityRead | string, key: 'config' | 'bindings' | 'on', props: Record<string, unknown>, read?: AiwsEntityRead): Op;
/** One kRPC call whose business failure (`ok: false`) throws an `AiwsFailure`: an `AiWorkspaceClient`, or a CLI's call. */
export interface AiwsWriteTransport {
    call<T = Record<string, unknown>>(method: string, params: Record<string, unknown>): Promise<T>;
}
export interface AiwsCommitOpsOptions {
    message?: string;
    /** The Workspace epoch (default: `ws.get_info`). */
    epoch?: string;
    idempotencyKey?: string;
    /** Sends of the same request while its result stays unknown (default 3). */
    attempts?: number;
    retryDelayMs?: number;
    partBytes?: number;
    /** Whether a failed send left the result unknown (default: any error but an `AiwsFailure`, the service's answer). */
    isUnknown?: (error: unknown) => boolean;
}
export interface AiwsCommitAccepted {
    status: 'accepted';
    commit_id: string;
    seq: number;
    [key: string]: unknown;
}
/** Commit `ops` as one Commit: the accepted result, or an `AiwsFailure` — a conflict carries the conflicting cells
 * (`data.conflicts`, as the service answers them), a refusal its errors. A send whose result is unknown (a transport
 * failure or timeout) is looked up with `doc.get_submission` and, if not accepted, sent again with the same
 * idempotency key; a Commit too large for one request goes in parts (`commitWithParts`). */
export declare function commitOps(client: AiwsWriteTransport, workspace_id: string, ops: Op[], opts?: AiwsCommitOpsOptions): Promise<AiwsCommitAccepted>;
export interface RichTextMark {
    type: string;
    attrs?: Record<string, Json>;
}
export interface RichTextNode {
    type: string;
    attrs?: Record<string, Json>;
    content?: RichTextNode[];
    text?: string;
    marks?: RichTextMark[];
}
/**
 * Markdown → top-level blocks of `buckyos.richtext.basic.v1` (block ids `<prefix>-<n>`; the default prefix is random,
 * so the ids are new in any document). A subset of the core's converter (aiworkspace core/src/markdown.rs, CommonMark +
 * GFM): ATX and setext headings (levels past 3 are 3), paragraphs with soft and hard breaks, bullet and ordered lists
 * (nested by indentation, task markers as ☐ / ☑), fenced code blocks with their language, block quotes, horizontal
 * rules, GFM pipe tables, and inline code, strong, emphasis, strike, links (http, https, mailto, `#`; `[label](entity:
 * <id>)` an object link; other destinations keep their text) and autolinks. Not covered: indented code blocks (their
 * text becomes a paragraph), reference-style links, HTML (kept as text), footnotes, embeds, and CommonMark's finer
 * delimiter and laziness rules. The service validates the result as for any other block.
 */
export declare function markdownToBlocks(markdown: string, prefix?: string): RichTextNode[];
//# sourceMappingURL=aiws_write.d.ts.map