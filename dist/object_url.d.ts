import { ObjId } from './ndn_types';
/** Current-zone service names registered in key url.md §4.1. */
export declare const OBJ_SERVICE_NAMES: readonly ["config", "dfs", "taskmgr", "kmsg", "bucket", "ndm", "msg-center", "aiworkspace", "homestation", "opendan", "aicc"];
export declare const OBJECT_EVENT_PREFIX = "/obj";
export declare class ObjectUrlError extends Error {
}
export type ObjHost = {
    kind: 'service' | 'entity';
    name: string;
};
export type ObjectUrl = {
    kind: 'file';
    deviceId: string | null;
    path: string;
} | {
    kind: 'cyfs_path';
    zone: string | null;
    path: string;
} | {
    kind: 'cyfs_object';
    objId: ObjId;
    sourceZone: string | null;
    innerPath: string;
} | {
    kind: 'obj';
    host: ObjHost;
    path: string;
    query: Record<string, string>;
} | {
    kind: 'web';
    url: string;
} | {
    kind: 'buckyos';
    url: string;
};
export declare function isObjServiceName(name: string): boolean;
/** Strict parse and normalize. Shorthands are expanded by `expandInputShorthand`. */
export declare function parseObjectUrl(input: string): ObjectUrl;
/** Only for inputs that declare the shorthand syntax (CLI, prompt environment), key url.md §8. */
export declare function expandInputShorthand(input: string): string;
export declare function parseObjHost(host: string): ObjHost;
export declare function formatObjectUrl(url: ObjectUrl): string;
export declare function normalizeObjectUrl(input: string): string;
/** RBAC resource key: unique after alias normalization, without query. */
export declare function rbacResourceKey(url: ObjectUrl, currentZone?: string): string | null;
export declare function objectSegments(url: ObjectUrl): string[];
/** `/obj/<host>/<seg...>/<event>`; segments outside `[A-Za-z0-9_-]` (or starting with `x`) become `x` + hex. */
export declare function objectEventKey(url: ObjectUrl, event: string): string;
export declare function objectEventPattern(url: ObjectUrl): string;
export declare function keventSegment(segment: string): string;
/** Object-event kevent key built from an obj:// host and decoded segments, without parsing. */
export declare function objEventKey(host: string, segments: string[], event: string): string;
export declare function objEventPattern(host: string, segments: string[]): string;
/** Path DID (D8): service object `<zoneDid>:<service>:<seg...>`, entity object `<entityDid>:<seg...>`. */
export declare function objectDid(url: ObjectUrl, zoneDid: string, entityDid?: string): string | null;
export declare function objServiceUrl(service: string, segments: string[]): string;
export declare function objEntityUrl(entityHost: string, segments: string[]): string;
/** `obj://config/<key>`, `/config/<key>`, `/<key>` → system-config key. */
export declare function configKeyFromUrl(input: string): string;
/** Canonical JSON: sorted object keys, no whitespace (selector and other JSON query values). */
export declare function canonicalJson(value: unknown): string;
export declare function encodeObjSegment(segment: string): string;
/** Canonical encoding of a query key or value. */
export declare function encodeObjQueryComponent(component: string): string;
//# sourceMappingURL=object_url.d.ts.map