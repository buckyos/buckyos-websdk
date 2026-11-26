export interface HtmlTag {
    name: string;
    attrs: Record<string, string>;
    close: boolean;
    self: boolean;
}
export type HtmlToken = HtmlTag | string;
export declare function decodeHtmlEntities(text: string): string;
export declare const escapeHtml: (s: string) => string;
/** Tags (lower-case names and attribute names, decoded attribute values) and raw text; comments, doctype and the
 * bodies of script, style, textarea and title are dropped. */
export declare function tokenizeHtml(html: string): HtmlToken[];
//# sourceMappingURL=html_tokens.d.ts.map