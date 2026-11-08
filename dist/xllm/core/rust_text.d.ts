import type { AiMessage, JsonValue } from './types';
/** `str::trim_start`. */
export declare function rustTrimStart(s: string): string;
/** `str::trim_end`. */
export declare function rustTrimEnd(s: string): string;
/** `str::trim`. */
export declare function rustTrim(s: string): string;
/** `s.split_whitespace().collect::<Vec<_>>().join(" ")`. */
export declare function collapseWhitespace(s: string): string;
/** UTF-16 offset after the first `n` chars (Unicode scalar values) of `s`; `s.length` when it has fewer. */
export declare function charOffset(s: string, n: number): number;
/** `str::chars().count()`. */
export declare function charCount(s: string): number;
/** `AiMessage::text_content`: text blocks joined by `\n`, a separator only once something was written. */
export declare function rustTextContent(message: AiMessage): string;
/** Order of Rust `String` (UTF-8 bytes, i.e. code points). */
export declare function compareCodePoints(a: string, b: string): number;
/** `serde_json::to_string` (or `to_string_pretty`) of a `Value`: keys in Rust's order, numbers as serde prints them. */
export declare function serdeJson(value: JsonValue, pretty?: boolean): string;
//# sourceMappingURL=rust_text.d.ts.map