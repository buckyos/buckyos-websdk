export interface XmlElement {
    name: string;
    attrs: [string, string][];
    /** Raw body (no CDATA or entity processing). */
    body: string;
    self_closing: boolean;
}
export declare function xmlAttr(e: XmlElement, key: string): string | undefined;
/** Body text: CDATA taken verbatim, everything else unescaped. */
export declare function xmlText(e: XmlElement): string;
export declare function xmlChildren(e: XmlElement): XmlElement[];
export declare function xmlUnescape(s: string): string;
export declare function xmlEscape(s: string): string;
export declare function elementText(body: string): string;
/** Direct child elements of `input` (CDATA, comments, processing instructions skipped; missing close tags tolerated). */
export declare function scanXmlElements(input: string): XmlElement[];
/** Strip a ```xml / ```json / ``` fence. */
export declare function stripCodeFences(text: string): string;
//# sourceMappingURL=xml.d.ts.map