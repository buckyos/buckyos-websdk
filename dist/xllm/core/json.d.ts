import type { JsonValue } from './types';
/** `serde_json::to_string` of the value (after a JSON round trip, so `toJSON` and `undefined` behave as in JSON). */
export declare function canonicalJson(value: unknown): string;
/** Deep copy of a JSON value (drops `undefined` members like serialization does). */
export declare function cloneJson<T>(value: T): T;
/** Structural equality of two JSON values, `undefined` members ignored. */
export declare function jsonEqual(a: unknown, b: unknown): boolean;
export declare function isObject(v: unknown): v is {
    [key: string]: JsonValue;
};
//# sourceMappingURL=json.d.ts.map