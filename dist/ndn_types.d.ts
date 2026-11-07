import type { Ed25519Jwk } from './types';
export type NdnErrorKind = 'Internal' | 'InvalidId' | 'InvalidLink' | 'NotFound' | 'NotReady' | 'AlreadyExists' | 'VerifyError' | 'IoError' | 'DbError' | 'InComplete' | 'RemoteError' | 'DecodeError' | 'OffsetTooLarge' | 'InvalidObjType' | 'InvalidData' | 'InvalidParam' | 'InvalidState' | 'PermissionDenied' | 'Unsupported';
export declare class NdnError extends Error {
    readonly kind: NdnErrorKind;
    constructor(kind: NdnErrorKind, message: string);
}
export declare const OBJ_TYPE_FILE = "cyfile";
export declare const OBJ_TYPE_DIR = "cydir";
export declare const OBJ_TYPE_MSG = "cymsg";
export declare const OBJ_TYPE_RECEIPT = "cyrece";
export declare const OBJ_TYPE_PATH = "cypath";
export declare const OBJ_TYPE_INCLUSION_PROOF = "cyinc";
export declare const OBJ_TYPE_RELATION = "cyrel";
export declare const OBJ_TYPE_ACTION = "cyact";
export declare const OBJ_TYPE_PACK = "cypack";
export declare const OBJ_TYPE_OBJMAP = "cymap";
export declare const OBJ_TYPE_LIST = "cylist";
export declare const OBJ_TYPE_CHUNK_LIST = "clist";
export declare const OBJ_TYPE_PKG = "pkg";
export declare const RELATION_TYPE_SAME = "same";
export declare const RELATION_TYPE_PART_OF = "part_of";
export declare function bytesToHex(bytes: Uint8Array): string;
export declare function hexToBytes(hex: string): Uint8Array;
export declare function base32Encode(bytes: Uint8Array): string;
export declare function base32Decode(str: string): Uint8Array;
export declare function varintEncode(value: number): Uint8Array;
export declare function varintDecode(bytes: Uint8Array, offset?: number): [number, number];
export declare function sha256Bytes(data: Uint8Array): Uint8Array;
export declare function sha256Utf8(text: string): Uint8Array;
/**
 * Recursively sort object keys (BTreeMap-like) while validating that the
 * value is representable as I-JSON/JCS input. Arrays preserve order.
 */
export declare function canonicalizeJson(value: any): any;
export declare function toCanonicalJsonString(value: any): string;
export declare const DEFAULT_HASH_METHOD = "sha256";
export type HashMethod = 'sha256' | 'sha512' | 'qcid' | 'blake2s256' | 'keccak256';
export declare const HashMethod: {
    Sha256: HashMethod;
    Sha512: HashMethod;
    QCID: HashMethod;
    Blake2s256: HashMethod;
    Keccak256: HashMethod;
    hashResultSize(method: HashMethod): number;
    /** parse(s) -> [HashMethod, isMix]; "mix256" -> [Sha256, true]. */
    parse(s: string): [HashMethod, boolean];
    fromString(s: string): HashMethod;
};
export type ChunkTypeStr = 'sha256' | 'mix256' | 'sha512' | 'mix512' | 'qcid' | 'blake2s256' | 'mixblake2s256' | 'keccak256' | 'mixkeccak256' | string;
export declare const ChunkType: {
    Sha256: string;
    Mix256: string;
    Sha512: string;
    Mix512: string;
    QCID: string;
    Blake2s256: string;
    MixBlake2s256: string;
    Keccak256: string;
    MixKeccak256: string;
    isChunkType(typeStr: string): boolean;
    isMix(typeStr: ChunkTypeStr): boolean;
    fromHashType(hashType: HashMethod, isMix: boolean): ChunkTypeStr;
    toHashMethod(typeStr: ChunkTypeStr): HashMethod;
};
/**
 * ObjId (Object Identifier) - mirrors ndn_lib::ObjId.
 *
 * On-wire JSON form is a string `${objType}:${hex(objHash)}`.
 * Display / hostname form is base32-lowercase of `objType + ":" + objHash`.
 */
export declare class ObjId {
    objType: string;
    objHash: Uint8Array;
    constructor(objType: string, objHash: Uint8Array);
    /** Parse from base32 (no separator) or `obj_type:hex_hash`. */
    static fromString(s: string): ObjId;
    static fromBytes(bytes: Uint8Array): ObjId;
    static fromValue(v: unknown): ObjId;
    static fromHostname(hostname: string): ObjId;
    /**
     * Try to extract an ObjId from an NDN-style path. Returns the ObjId and
     * the optional remaining sub-path (with leading '/'), or null if no part
     * of the path parses as an ObjId.
     */
    static fromPath(path: string): {
        objId: ObjId;
        subPath: string | null;
    };
    /** Construct an ObjId from a precomputed hash. */
    static fromRaw(objType: string, hashValue: Uint8Array): ObjId;
    isChunk(): boolean;
    isChunkList(): boolean;
    isJson(): boolean;
    isDirObject(): boolean;
    isFileObject(): boolean;
    isContainer(): boolean;
    isBigContainer(): boolean;
    /** `${obj_type}:${hex(obj_hash)}` form. */
    toString(): string;
    toFilename(): string;
    toBase32(): string;
    toBytes(): Uint8Array;
    /** Used for JSON.stringify -> serialized as the `${type}:${hex}` string. */
    toJSON(): string;
    equals(other: ObjId): boolean;
}
/**
 * ChunkId - mirrors ndn_lib::ChunkId. Wire format is identical to ObjId
 * (`${chunk_type}:${hex(hash_result)}`); for "mix*" types the hash bytes
 * begin with a varint-encoded data length.
 */
export declare class ChunkId {
    chunkType: ChunkTypeStr;
    hashResult: Uint8Array;
    constructor(chunkType: ChunkTypeStr, hashResult: Uint8Array);
    static defaultChunkType(): ChunkTypeStr;
    static fromString(s: string): ChunkId;
    static fromObjId(objId: ObjId): ChunkId;
    static fromBytes(bytes: Uint8Array): ChunkId;
    /** Construct from raw hash result, no length encoding. */
    static fromHashResult(hashResult: Uint8Array, chunkType: ChunkTypeStr): ChunkId;
    /** Construct mix-style ChunkId by prepending varint(length) to hash. */
    static fromMixHashResult(dataLength: number, hashResult: Uint8Array, chunkType: ChunkTypeStr): ChunkId;
    static fromMixHashResultByHashMethod(dataLength: number, hashResult: Uint8Array, hashMethod: HashMethod): ChunkId;
    static fromSha256Result(hashResult: Uint8Array): ChunkId;
    static fromMix256Result(dataLength: number, hashResult: Uint8Array): ChunkId;
    static mixLengthAndHashResult(dataLength: number, hashResult: Uint8Array): Uint8Array;
    toObjId(): ObjId;
    toString(): string;
    toBase32(): string;
    toDidString(): string;
    toBytes(): Uint8Array;
    toJSON(): string;
    /** For mix-* types, return the data length encoded in the prefix. */
    getLength(): number | null;
    equalsHash(hashBytes: Uint8Array): boolean;
}
/**
 * Anything that can be hashed into an ObjId. Implementations need only
 * provide getObjType() and toJSON() (the JSON-serializable form). The
 * default genObjId() then derives the ObjId from canonical JSON.
 */
export interface NamedObject {
    getObjType(): string;
    toJSON(): unknown;
    genObjId(): [ObjId, string];
}
export declare abstract class NamedObjectBase implements NamedObject {
    abstract getObjType(): string;
    abstract toJSON(): unknown;
    genObjId(): [ObjId, string];
}
/** SHA-256-based ObjId derivation: matches build_obj_id() in ndn-lib. */
export declare function buildObjId(objType: string, objJsonStr: string): ObjId;
/**
 * Canonicalize the JSON value (recursive sort), serialize, then derive ObjId.
 * Matches build_named_object_by_json() in ndn-lib.
 */
export declare function buildNamedObjectByJson(objType: string, jsonValue: unknown): [ObjId, string];
/** Verify that the JSON canonical hash equals the expected ObjId. */
export declare function verifyNamedObject(objId: ObjId, jsonValue: unknown): boolean;
export declare function verifyNamedObjectFromStr(objId: ObjId, objStr: string): unknown;
/**
 * Parse an obj-data-string: JSON when it starts with `{` or `[` after leading
 * whitespace, otherwise a JWT whose claims are the object. The JWT signature
 * is not checked.
 */
export declare function loadNamedObjectFromObjStr(objStr: string): unknown;
/** ObjId of a NamedObject in JWT form, computed from the claims only. */
export declare function buildNamedObjectByJwt(objType: string, jwt: string): [ObjId, string];
/** Whether the claims of `jwt` hash to `objId`. The JWT signature is not checked. */
export declare function verifyNamedObjectFromJwt(objId: ObjId, jwt: string): boolean;
export declare function loadNamedObj<T = unknown>(objStr: string): T;
export declare function loadNamedObjAndVerify<T = unknown>(objId: ObjId, objStr: string): T;
/** Walk a JSON value via a `/foo/bar/0/baz` path and parse it as ObjId. */
export declare function extractObjIdByPath(jsonValue: unknown, path: string): ObjId;
export type DID = string;
export interface BaseContentObjectFields {
    did?: DID | null;
    name?: string;
    author?: string;
    owner?: DID;
    create_time?: number;
    last_update_time?: number;
    copyright?: string | null;
    tags?: string[];
    categories?: string[];
    base_on?: ObjId | null;
    directory?: Record<string, unknown>;
    references?: Record<string, unknown>;
    exp?: number;
}
/**
 * Mirrors ndn-lib BaseContentObject. Optional/empty fields are skipped on
 * serialization (matching `skip_serializing_if`) so that ObjIds derived from
 * a TS instance match those derived from the equivalent Rust value.
 */
export declare class BaseContentObject {
    did: DID | null;
    name: string;
    author: string;
    owner: DID;
    create_time: number;
    last_update_time: number;
    copyright: string | null;
    tags: string[];
    categories: string[];
    base_on: ObjId | null;
    directory: Record<string, unknown>;
    references: Record<string, unknown>;
    exp: number;
    constructor(fields?: BaseContentObjectFields);
    /** Build the JSON object using the same skip rules as Rust serde. */
    toJSON(): Record<string, unknown>;
}
export declare class FileObject extends NamedObjectBase {
    content_obj: BaseContentObject;
    size: number;
    /** chunkid or chunklist id, or empty string. */
    content: string;
    /** Free-form metadata. Flattened into the object root on serialization. */
    meta: Record<string, unknown>;
    constructor(name: string, size: number, content: string);
    static fromJSON(value: Record<string, unknown>): FileObject;
    getObjType(): string;
    toJSON(): Record<string, unknown>;
}
export declare class PathObject extends NamedObjectBase {
    path: string;
    iat: number;
    target: ObjId;
    exp: number;
    /** Host the JWT was issued for; omitted when there is none. */
    host?: string;
    constructor(path: string, target: ObjId, iat?: number, exp?: number, host?: string);
    static fromJSON(value: Record<string, unknown>): PathObject;
    getObjType(): string;
    toJSON(): Record<string, unknown>;
}
export declare class InclusionProof extends NamedObjectBase {
    content_id: string;
    content_obj: unknown;
    curator: DID;
    editor: string[];
    meta: unknown;
    rank: number;
    collection: string[];
    review_url: string | null;
    iat: number;
    exp: number;
    constructor(contentId: ObjId, contentObj: unknown, curator: DID, rank: number, collection: string[]);
    /**
     * Reconstruct an InclusionProof from its JSON form. The decode /
     * re-encode round-trip (fromJSON followed by toJSON) must be
     * byte-stable under canonical JSON, otherwise ObjId verification on a
     * payload produced by the Rust reference impl would drift. That is
     * exactly what the tests under `tests/ndn_types_cases.ts` pin down.
     *
     * Notes on the field mapping:
     *   - `content_id` is passed through ObjId.fromString for validation,
     *     then pinned back to the raw input string so any non-hex-canonical
     *     forms survive the round-trip unchanged (the Rust side doesn't
     *     renormalize on deserialization either).
     *   - `iat` / `exp` must come from the payload, not from the
     *     constructor's `nowSeconds()` defaults, or decoding an older
     *     proof would silently rewrite its validity window.
     */
    static fromJSON(value: Record<string, unknown>): InclusionProof;
    getObjType(): string;
    toJSON(): Record<string, unknown>;
}
export type SimpleMapItem = {
    kind: 'objId';
    objId: ObjId;
} | {
    kind: 'object';
    objType: string;
    obj: unknown;
} | {
    kind: 'objectJwt';
    objType: string;
    jwt: string;
};
export declare const SimpleMapItem: {
    fromObjId(objId: ObjId): SimpleMapItem;
    fromObject(objType: string, obj: unknown): SimpleMapItem;
    fromObjectJwt(objType: string, jwt: string): SimpleMapItem;
    getObjType(item: SimpleMapItem): string;
    /** Compute (objId, optional inline obj-string) for this item. */
    getObjId(item: SimpleMapItem): [ObjId, string];
    toJSON(item: SimpleMapItem): unknown;
    fromJSON(value: unknown): SimpleMapItem;
};
export declare class SimpleObjectMap {
    body: Map<string, SimpleMapItem>;
    constructor();
    static fromJSON(value: unknown): SimpleObjectMap;
    /**
     * Resolve every entry to its ObjId string and merge it into `realObj` as
     * the `body` field, then derive a NamedObject ObjId. Matches
     * SimpleObjectMap::gen_obj_id_with_real_obj() in Rust.
     */
    genObjIdWithRealObj(resultObjType: string, realObj: Record<string, unknown>): [ObjId, string];
    get size(): number;
    isEmpty(): boolean;
    get(key: string): SimpleMapItem | undefined;
    set(key: string, value: SimpleMapItem): void;
    delete(key: string): boolean;
    has(key: string): boolean;
    keys(): IterableIterator<string>;
    values(): IterableIterator<SimpleMapItem>;
    entries(): IterableIterator<[string, SimpleMapItem]>;
    /** Serialize to wire JSON (matches Rust SimpleObjectMap serde). */
    toJSON(): Record<string, unknown>;
}
export declare class DirObject extends NamedObjectBase {
    content_obj: BaseContentObject;
    meta: Record<string, unknown>;
    total_size: number;
    file_count: number;
    file_size: number;
    object_map: SimpleObjectMap;
    constructor(name?: string);
    static fromJSON(value: Record<string, unknown>): DirObject;
    getObjType(): string;
    /** JSON form (with raw `body`) - useful for storage / debug. */
    toJSON(): Record<string, unknown>;
    /**
     * DirObject's ObjId is derived from a JSON form whose `body` field is a
     * `name -> objIdString` map (children are reduced to ObjIds first).
     * Matches DirObject::gen_obj_id() in Rust.
     */
    genObjId(): [ObjId, string];
    get size(): number;
    isEmpty(): boolean;
    get(key: string): SimpleMapItem | undefined;
    delete(key: string): boolean;
    has(key: string): boolean;
    keys(): IterableIterator<string>;
    values(): IterableIterator<SimpleMapItem>;
    entries(): IterableIterator<[string, SimpleMapItem]>;
    addFile(name: string, fileObj: unknown, fileSize: number): void;
    addDirectory(name: string, dirObjId: ObjId, dirSize: number): void;
    listEntries(): string[];
    isFile(name: string): boolean;
    isDirectory(name: string): boolean;
}
export declare class SimpleChunkList {
    total_size: number;
    body: ChunkId[];
    constructor();
    static fromChunkList(chunks: ChunkId[]): SimpleChunkList;
    static fromJson(objStr: string): SimpleChunkList;
    static fromJsonValue(value: unknown): SimpleChunkList;
    appendChunk(chunkId: ChunkId): void;
    /**
     * Mirrors SimpleChunkList::gen_obj_id(): hash the JSON list of ChunkId
     * strings, then prefix the resulting hash bytes with varint(total_size)
     * to form the final ObjId.
     */
    genObjId(): [ObjId, string];
}
export type ObjectLinkData = {
    kind: 'sameAs';
    target: ObjId;
} | {
    kind: 'partOf';
    target: ObjId;
    range: {
        start: number;
        end: number;
    };
};
export declare class RelationObject extends NamedObjectBase {
    source: ObjId;
    relation: string;
    target: ObjId;
    body: Record<string, unknown>;
    iat: number | null;
    exp: number | null;
    constructor(source: ObjId, relation: string, target: ObjId, body?: Record<string, unknown>);
    /**
     * Reconstruct a RelationObject from its JSON form. `source`, `relation`,
     * `target`, `iat` and `exp` are reserved top-level fields; every other
     * key lands back in `body` (matching what `toJSON` spreads out), so the
     * decode → re-encode round-trip is byte-stable under canonical JSON
     * for any shape the TS class is capable of emitting.
     */
    static fromJSON(value: Record<string, unknown>): RelationObject;
    static createByLinkData(source: ObjId, link: ObjectLinkData): RelationObject;
    getLinkData(): ObjectLinkData;
    getObjType(): string;
    toJSON(): Record<string, unknown>;
}
export type MsgObjKind = 'chat' | 'group_msg' | 'deliver' | 'notify' | 'event' | 'operation';
/** MIME-based. Unlisted values are kept verbatim. */
export type MsgContentFormat = 'text/plain' | 'text/markdown' | 'text/html' | 'text/css' | 'text/xml' | 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/svg+xml' | 'image/bmp' | 'video/mp4' | 'video/webm' | 'video/ogg' | 'video/quicktime' | 'video/x-msvideo' | 'audio/mpeg' | 'audio/wav' | 'audio/ogg' | 'audio/webm' | 'audio/aac' | 'audio/flac' | 'application/json' | 'application/xml' | 'application/pdf' | 'application/zip' | 'application/octet-stream' | (string & {});
/**
 * Semantic hints only. `topic` may help to label a conversation but is never
 * a routing key: the target session is `MsgObject.to_session`.
 */
export interface TopicThread {
    topic?: string;
    reply_to?: string;
    correlation_id?: string;
}
/**
 * Relation kind of a relation message (§16.3). Unknown values are kept
 * verbatim; a receiver shows such a message as a plain one.
 */
export type MsgRelType = 'edit' | 'redact' | 'reaction' | 'thread' | (string & {});
/**
 * `relates_to`: this message edits / redacts / reacts to / joins the thread
 * of another `cymsg`. The original message is never modified.
 */
export interface MsgRelation {
    rel: MsgRelType;
    /** The related message, always a `cymsg` ObjId. */
    target: string;
    /** Only for `reaction`: the reaction content (1-64 bytes), e.g. one emoji. */
    key?: string;
}
/**
 * Structured mentions; notification semantics come only from this field,
 * never from `@` text in the body. Omit the whole field when it is empty:
 * `{}` is not a canonical value and is rejected.
 */
export interface MsgMentions {
    dids?: DID[];
    /** Mentions every participant of the target session. */
    all?: boolean;
}
export type CanonValue = null | boolean | number | string | number[] | CanonValue[] | {
    [key: string]: CanonValue;
};
export interface MachineContent {
    intent?: string;
    data?: Record<string, CanonValue>;
}
export type RefTarget = {
    type: 'data_obj';
    obj_id: string;
    uri_hint?: string;
} | {
    type: 'service_did';
    did: DID;
};
export type RefRole = 'context' | 'input' | 'output' | 'evidence' | 'control';
export interface RefItem {
    role: RefRole;
    target: RefTarget;
    label?: string;
}
export interface MsgContent {
    title?: string;
    format?: MsgContentFormat;
    content?: string;
    machine?: MachineContent;
    refs?: RefItem[];
}
/**
 * Immutable message object. Rust flattens `meta` into the top level, so unknown
 * keys are allowed here on purpose. `proof` is reserved since v2 (a signed
 * message travels in the JWT form instead) and must never be set.
 *
 * Deserialization stays lenient so stored records always load: call
 * `validateMsgObject` or `msgObjectFromJsonChecked` at an ingress.
 */
export interface MsgObject {
    from: DID;
    to: DID[];
    kind: MsgObjKind;
    /**
     * Named session under the single target entity (`to[0]/to_session`).
     * Omitted means the default session. Only valid when `to` has exactly one
     * DID; the value follows `isValidMsgSessionId`.
     */
    to_session?: string;
    thread?: TopicThread;
    relates_to?: MsgRelation;
    /** Omitted when empty, never `{}`. */
    mentions?: MsgMentions;
    workspace?: DID;
    /** Sender-declared creation time, for display only. A checked object may omit it when it is 0. */
    created_at_ms: number;
    expires_at_ms?: number;
    /** Random per message (`randomMsgNonce`) so identical messages keep distinct ObjIds. */
    nonce?: number;
    content: MsgContent;
    [key: string]: unknown;
}
/** Top-level keys that the flattened `meta` must not use. */
export declare const MSG_OBJECT_RESERVED_KEYS: readonly string[];
/** Max char length of `to_session`, same as the MailboxAddress session part. */
export declare const MSG_SESSION_ID_MAX_CHARS = 200;
export declare const MSG_REACTION_KEY_MAX_BYTES = 64;
/**
 * `to_session` value rule (`validate_msg_session_id`): 1-200 chars, no
 * surrounding whitespace, no control chars, not `.` / `..`.
 */
export declare function isValidMsgSessionId(value: string): boolean;
/**
 * Random `nonce` for one outgoing message (§16.6): deduplication is by ObjId,
 * so two identical messages must not collapse into one. Kept below 2^53 so it
 * stays a safe integer in JS and round-trips through JSON unchanged.
 */
export declare function randomMsgNonce(): number;
/** Object-level validity rules of §16. Throws `NdnError('InvalidData')` on a violation. */
export declare function validateMsgObject(msg: MsgObject): void;
/**
 * Parse a received MsgObject JSON (or JWT claims), validate it and make sure it
 * re-serializes to the same canonical JSON. Returns the normalized object and
 * the ObjId computed from `value` itself.
 */
export declare function msgObjectFromJsonChecked(value: unknown): [MsgObject, ObjId];
/** A MsgObject received in JWT form. */
export interface MsgObjectJwt {
    msg: MsgObject;
    objId: ObjId;
    /** `kid` of the JWT header: DID URL of the signing key. */
    kid: string;
}
/**
 * DID part of a `kid` (before `#`). It must equal `msg.from`, unless the
 * receiver resolves it as a device/agent key authorized by `from`'s DID
 * Document.
 */
export declare function msgJwtKidDid(kid: string): DID | null;
/**
 * Decode a MsgObject JWT without checking the signature. Use only where the
 * signature is not relied upon (e.g. display); see `verifyMsgObjectJwt`.
 */
export declare function decodeMsgObjectJwt(jwt: string): MsgObjectJwt;
/**
 * Verify the JWT signature with the public key the receiver resolved for `kid`,
 * then decode it. The caller still has to make sure that key belongs to
 * `msg.from` (see `msgJwtKidDid`).
 */
export declare function verifyMsgObjectJwt(jwt: string, publicKey: Ed25519Jwk): Promise<MsgObjectJwt>;
export type ReceiptStatus = 'accepted' | 'rejected' | 'quarantined';
/** Optional immutable delivery receipt. Not the `MsgReceiptObj` DTO of msg-center. */
export interface ReceiptObj {
    obj_id: string;
    iss: DID;
    channel?: string;
    iat: number;
    status: ReceiptStatus;
    reason?: string;
}
/** Decode with the serde rules of the Rust struct; the result re-encodes to the same ObjId. */
export declare function receiptObjFromJson(value: unknown): ReceiptObj;
export declare const ACTION_TYPE_VIEWED = "viewed";
export declare const ACTION_TYPE_DOWNLOAD = "download";
export declare const ACTION_TYPE_INSTALLED = "installed";
export declare const ACTION_TYPE_SHARED = "shared";
export declare const ACTION_TYPE_LIKED = "liked";
export declare const ACTION_TYPE_UNLIKED = "unliked";
export declare const ACTION_TYPE_PURCHASED = "purchased";
/** `subject` does `action` on `target`. */
export interface ActionObject {
    subject: string;
    action: string;
    target: string;
    /** The action this one is based on. */
    base_on?: string;
    details?: unknown;
    iat: number;
    exp: number;
}
/** Decode with the serde rules of the Rust struct; the result re-encodes to the same ObjId. */
export declare function actionObjectFromJson(value: unknown): ActionObject;
/** `geo` of a `cyfile` (`CYFS 标准对象` §10), WGS84. */
export interface FileGeoMeta {
    lat: number;
    lon: number;
    alt?: number;
    heading?: number;
    accuracy_m?: number;
}
export interface FileCameraMeta {
    make?: string;
    model?: string;
    lens?: string;
}
export interface FileExposureMeta {
    iso?: number;
    f_number?: number;
    /** Reduced fraction such as `1/120`; whole seconds are written `2`. */
    exposure_time?: string;
    focal_length_mm?: number;
    focal_length_35mm?: number;
}
/** The common meta of a `cyfile` (`CYFS 标准对象` §10). A field that cannot be determined is omitted. */
export interface FileMediaMeta {
    /** Without parameters, never `application/octet-stream`. */
    mime?: string;
    /** Display size, rotation already applied. */
    width?: number;
    height?: number;
    duration_ms?: number;
    video_codec?: string;
    audio_codec?: string;
    title?: string;
    artist?: string;
    album?: string;
    /** ISO 8601. Without an offset the time zone is unknown: do not read it as UTC. */
    captured_at?: string;
    geo?: FileGeoMeta;
    camera?: FileCameraMeta;
    exposure?: FileExposureMeta;
}
/** A `cyfile` as plain JSON. Other meta keys are flattened next to these. */
export interface FileObjectJson extends FileMediaMeta {
    did?: DID;
    name?: string;
    author?: string;
    owner?: DID;
    create_time?: number;
    last_update_time?: number;
    copyright?: string;
    tags?: string[];
    categories?: string[];
    base_on?: string;
    directory?: Record<string, unknown>;
    references?: Record<string, unknown>;
    exp?: number;
    size?: number;
    /** Chunk id or chunk list id. */
    content?: string;
    [key: string]: unknown;
}
export interface PackageMeta extends FileObjectJson {
    version: string;
    version_tag?: string;
    /** Package name -> version requirement, such as `>1.0.0-alpha`. */
    deps?: Record<string, string>;
}
export declare function normalizePackageMetaForObjId(meta: Record<string, any>): Record<string, any>;
export declare function calcPkgMetaObjId(metaJson: Record<string, any>): string;
export declare const CYFS_CONTENT_TYPE_NAMED_OBJECT_JSON = "application/cyfs-named-object+json";
/** Dispatch body is a compact JWT whose claims are the NamedObject. */
export declare const CYFS_CONTENT_TYPE_NAMED_OBJECT_JWT = "application/cyfs-named-object+jwt";
export type CyfsNamedObjectEncoding = 'json' | 'jwt';
/** Parse a `Content-Type` value. Parameters such as `charset=utf-8` are accepted. */
export declare function namedObjectEncodingFromContentType(contentType: string): CyfsNamedObjectEncoding | null;
export declare function isCyfsNamedObjectContentType(contentType: string): boolean;
export type KnownStandardObject = {
    kind: 'dir';
    obj: DirObject;
    objStr: string;
} | {
    kind: 'file';
    obj: FileObject;
    objStr: string;
} | {
    kind: 'chunkList';
    obj: SimpleChunkList;
    objStr: string;
};
export declare const KnownStandardObject: {
    fromObjData(objId: ObjId, objData: string): KnownStandardObject;
    /** Return ObjIds (and optional inline obj-string) for the children. */
    getChildObjs(known: KnownStandardObject): Array<{
        objId: ObjId;
        objStr: string | null;
    }>;
};
//# sourceMappingURL=ndn_types.d.ts.map