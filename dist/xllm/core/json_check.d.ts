import type { JsonValue } from './types';
import type { OutputValidator } from './deps';
/** `undefined` when `value` matches `schema`, otherwise the first mismatch. */
export declare function validateJson(schema: JsonValue, value: JsonValue): string | undefined;
/** Parse a reply as one JSON value; one surrounding code fence is tolerated. */
export declare function parseReply(text: string): JsonValue;
/** A reply under a reply contract: parsed, matching the schema, accepted by the host's validator. */
export declare function checkReply(text: string, schema: JsonValue | undefined, validator?: OutputValidator): Promise<{
    ok: true;
    value: JsonValue;
} | {
    ok: false;
    error: string;
}>;
/** The correction message after a reply that broke the reply contract. */
export declare function repairMessage(error: string, schema: JsonValue | undefined): string;
//# sourceMappingURL=json_check.d.ts.map