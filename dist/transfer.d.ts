import { type TransferableContentRef, type ZoneContent } from './content';
/** Zone content reference list: `{"v":1,"items":[ZoneContent…]}`. */
export declare const CONTENT_REFS_FORMAT = "application/vnd.buckyos.content-refs+json";
/** Transfer handle: `{"v":1,"offerId":"…"}`, pointing at a record the desktop keeps (cut, large, deferred or private content). */
export declare const TRANSFER_HANDLE_FORMAT = "application/vnd.buckyos.transfer+json";
/** The `text/html` attributes of the typed table. */
export declare const TYPED_TABLE_ATTR = "data-buckyos-table";
export declare const TYPED_VALUE_ATTR = "data-buckyos-value";
/** The `text/html` attribute that marks a link as an embedded content reference: `{"v":1,"kind":"file"|"folder"}`. */
export declare const CONTENT_REF_ATTR = "data-buckyos-ref";
/** The `text/html` attribute that carries the transfer handle where the dedicated MIME type cannot travel. */
export declare const TRANSFER_HANDLE_ATTR = "data-buckyos-transfer";
/** The async clipboard name of a non-standard format (Chromium Web custom formats). */
export declare const webClipboardFormat: (format: string) => string;
/** The most items one content reference list carries; a larger selection needs a transfer handle. */
export declare const MAX_CONTENT_REFS = 10000;
/** One item's representations by format name: the strings a DataTransfer or a ClipboardItem carries. */
export type TransferRepresentations = Record<string, string>;
/** A `cyfs:///<path>` or `obj://<objId>[/<inner path>]` line as a reference; undefined when it is not one (any other
 * scheme, a query or fragment, `.` / `..` segments, invalid names or escapes). Segments may be percent-encoded. */
export declare function parseBuckyosAddress(text: string): TransferableContentRef | undefined;
/** The address of a reference as a URI (`text/uri-list`, `href`): every path segment percent-encoded. */
export declare function buckyosAddressUri(ref: TransferableContentRef): string;
/** The references of a text when every non-empty line is a BuckyOS address (`text/uri-list` comment lines skipped);
 * undefined when any line is something else. */
export declare function readBuckyosAddresses(text: string | undefined, options?: {
    uriList?: boolean;
}): TransferableContentRef[] | undefined;
/** The dedicated value of a reference list. */
export declare function contentRefsValue(items: ZoneContent[]): string;
/** The items of a reference list value in order; undefined for another major version, a damaged value, an empty
 * list or an invalid item. */
export declare function readContentRefs(value: string | undefined): ZoneContent[] | undefined;
/** The `<a>` links of a reference list, in order, each marked with its kind. */
export declare function contentRefsHtml(items: ZoneContent[]): string;
/** The reference list a `text/html` carries as marked links, in order (addresses only: no `objId`; the link text as
 * the name). Undefined when there is no marked link or one of them is not valid. */
export declare function contentRefsFromHtml(html: string | undefined): ZoneContent[] | undefined;
/** Everything one write of a Zone selection puts down (§2.2): the list, a name per line, an address per line and the
 * marked links. */
export declare function contentRefsRepresentations(items: ZoneContent[]): TransferRepresentations;
/** The field types of the system table standard (the AI Workspace standard table types, without `object_ref`). */
export declare const TABLE_FIELD_TYPES: readonly ["text", "boolean", "number", "decimal", "date", "datetime", "select", "multi_select", "currency", "json"];
export type TableFieldType = typeof TABLE_FIELD_TYPES[number];
export interface TypedTableField {
    name: string;
    type: TableFieldType;
    /** decimal, currency: digits after the point (0–18). */
    scale?: number;
    /** currency: the default ISO 4217 code. */
    currency?: string;
    /** select, multi_select: the option labels. */
    options?: string[];
}
/** A cell: its wire value (option labels, not ids; `{ amount, currency }` for money) and the text people see. An empty
 * cell has neither. */
export interface TypedTableCell {
    value?: unknown;
    text?: string;
}
export interface TypedTable {
    fields: TypedTableField[];
    rows: TypedTableCell[][];
}
/** Whether a wire value has the shape its field type takes (the receiver still normalizes it). */
export declare function isTypedTableValue(field: TypedTableField, value: unknown): boolean;
/** A cell value as plain text: ISO dates, `TRUE` / `FALSE`, labels joined with `, `, `CNY 500.00`, JSON. */
export declare function typedTableText(field: TypedTableField, value: unknown): string;
/** A cell as spreadsheets take it, quoted when it holds a tab, quote or line break. */
export declare function typedTableTsvCell(field: TypedTableField, value: unknown): string;
/** One write of a table (§2.2): an HTML table carrying the field definitions and each cell's wire value, and a TSV
 * with a header row. A cell's `text` is what the HTML shows; without it the TSV text is shown. */
export declare function typedTableRepresentations(table: TypedTable): {
    'text/html': string;
    'text/plain': string;
};
/** The definitions of a `data-buckyos-table` attribute; undefined for another major version or a damaged value. */
export declare function readTypedTableFields(attr: string | undefined): TypedTableField[] | undefined;
/** The first typed table of a `text/html`; undefined when there is none or its marks are not valid. The header row
 * (`<th>` cells) is skipped; a cell value that does not fit its field keeps only its text. */
export declare function readTypedTable(html: string | undefined): TypedTable | undefined;
/** `cut` marks the handle of a cut: when the record is gone (a reload, another tab) the receiver can still tell the user
 * that the cut expired instead of silently copying (§6). */
export interface TransferHandle {
    v: 1;
    offerId: string;
    cut?: true;
}
/** A fresh high-entropy offer id (128 random bits, base64url). */
export declare function newOfferId(): string;
export declare const transferHandleValue: (offerId: string, options?: {
    cut?: boolean;
}) => string;
export declare function readTransferHandle(value: string | undefined): TransferHandle | undefined;
/** The `text/html` of one write with the handle embedded, for paths that only carry Web standard formats (an async
 * clipboard read of a copy-event write, a cross-origin WebKit paste). */
export declare function embedTransferHandle(html: string, offerId: string, options?: {
    cut?: boolean;
}): string;
export declare function transferHandleFromHtml(html: string | undefined): TransferHandle | undefined;
/** What one paste or drop carried, taken while its event is dispatched. */
export interface TransferSnapshot {
    /** Format names as the platform listed them, lower-case, without the `web ` prefix (`files` for files). */
    types: string[];
    /** String representations by format. */
    data: Record<string, string>;
    files: File[];
}
/** The format names a drag or clipboard event lists (all that `dragenter` / `dragover` may look at). */
export declare function transferTypes(dt: DataTransfer | null | undefined): string[];
/** Reads every string representation and the files of a DataTransfer. Call it before the event handler returns. */
export declare function snapshotDataTransfer(dt: DataTransfer | null | undefined): TransferSnapshot;
/** Puts representations on a DataTransfer (`dragstart`, `copy` / `cut` events). */
export declare function writeDataTransfer(dt: DataTransfer, representations: TransferRepresentations): void;
/**
 * Writes representations to the system clipboard in one `ClipboardItem` (toolbar and menu commands, inside the user's
 * gesture). Formats the browser cannot write are left out; when the custom ones make the write fail, the Web standard
 * ones are written alone. Returns the formats written; throws when nothing could be written.
 */
export declare function writeClipboard(representations: TransferRepresentations, options?: {
    images?: Record<string, Blob>;
}): Promise<string[]>;
/** Reads the system clipboard (an explicit Paste button, inside the user's gesture). Throws when the browser refuses. */
export declare function readClipboard(): Promise<TransferSnapshot>;
export interface TransferReader {
    snapshot: TransferSnapshot;
    has(format: string): boolean;
    /** A string representation by its registered name. */
    get(format: string): string | undefined;
    /** The transfer handle: the dedicated MIME type, then the `text/html` embedding. */
    handle(): TransferHandle | undefined;
    /** The Zone reference list: the dedicated MIME type, then the marked links of `text/html`. */
    contentRefs(): {
        items: ZoneContent[];
        via: 'mime' | 'html';
    } | undefined;
    /** The typed table of `text/html`. */
    typedTable(): TypedTable | undefined;
    /** BuckyOS addresses: `text/uri-list`, then `text/plain`, when every line is one. */
    addresses(): TransferableContentRef[] | undefined;
    files: File[];
    html: string | undefined;
    text: string | undefined;
}
export declare function transferReader(snapshot: TransferSnapshot): TransferReader;
/** Whether a drag or paste may carry Zone references (from its types alone, as `dragover` sees them). */
export declare const mayCarryContentRefs: (types: string[]) => boolean;
//# sourceMappingURL=transfer.d.ts.map