import type { ExtractedValue, JsonValue, ResultFormat } from './types';
/** Apply `result_format` to the final reply; a failure is an error, never a silent fallback to raw. */
export declare function extractResult(raw: string, fmt: ResultFormat): ExtractedValue;
/** `--json` check of an extracted value. */
export declare function extractedAsJson(v: ExtractedValue): {
    ok: true;
    value: JsonValue;
} | {
    ok: false;
    error: string;
};
//# sourceMappingURL=result.d.ts.map