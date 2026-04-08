import { f as ht } from "./sdk_core-4704b88c.mjs";
class NdnError extends Error {
  constructor(kind, message) {
    super(`${kind}: ${message}`);
    this.kind = kind;
    this.name = "NdnError";
  }
}
const OBJ_TYPE_FILE = "cyfile";
const OBJ_TYPE_DIR = "cydir";
const OBJ_TYPE_MSG = "cymsg";
const OBJ_TYPE_MSG_RECE = "cymsgr";
const OBJ_TYPE_PATH = "cypath";
const OBJ_TYPE_INCLUSION_PROOF = "cyinc";
const OBJ_TYPE_RELATION = "cyrel";
const OBJ_TYPE_ACTION = "cyact";
const OBJ_TYPE_PACK = "cypack";
const OBJ_TYPE_TRIE = "cytrie";
const OBJ_TYPE_TRIE_SIMPLE = "cytrie-s";
const OBJ_TYPE_OBJMAP = "cymap-mtp";
const OBJ_TYPE_OBJMAP_SIMPLE = "cymap";
const OBJ_TYPE_LIST = "cylist-mtree";
const OBJ_TYPE_LIST_SIMPLE = "cylist";
const OBJ_TYPE_CHUNK_LIST = "cl";
const OBJ_TYPE_CHUNK_LIST_SIMPLE = "clist";
const OBJ_TYPE_CHUNK_LIST_FIX_SIZE = "clist-fix";
const OBJ_TYPE_CHUNK_LIST_SIMPLE_FIX_SIZE = "cl-sf";
const OBJ_TYPE_PKG = "pkg";
const RELATION_TYPE_SAME = "same";
const RELATION_TYPE_PART_OF = "part_of";
const HEX_CHARS = "0123456789abcdef";
function bytesToHex(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    s += HEX_CHARS[b >>> 4 & 15];
    s += HEX_CHARS[b & 15];
  }
  return s;
}
function hexToBytes(hex) {
  if (hex.length % 2 !== 0) {
    throw new NdnError("InvalidId", `invalid hex length: ${hex.length}`);
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const hi = HEX_CHARS.indexOf(hex[i * 2].toLowerCase());
    const lo = HEX_CHARS.indexOf(hex[i * 2 + 1].toLowerCase());
    if (hi < 0 || lo < 0) {
      throw new NdnError("InvalidId", `invalid hex char at offset ${i * 2}`);
    }
    out[i] = hi << 4 | lo;
  }
  return out;
}
const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    value = value << 8 | bytes[i];
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_ALPHABET[value >>> bits & 31];
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[value << 5 - bits & 31];
  }
  return out;
}
function base32Decode(str) {
  const lower = str.toLowerCase();
  let bits = 0;
  let value = 0;
  const out = [];
  for (let i = 0; i < lower.length; i++) {
    const ch = lower[i];
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) {
      throw new NdnError("InvalidId", `invalid base32 char '${ch}' at ${i}`);
    }
    value = value << 5 | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push(value >>> bits & 255);
    }
  }
  return new Uint8Array(out);
}
function varintEncode(value) {
  if (!Number.isFinite(value) || value < 0) {
    throw new NdnError("InvalidParam", `varint must be non-negative finite: ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new NdnError("InvalidParam", `varint exceeds safe integer range: ${value}`);
  }
  const out = [];
  let v = value;
  while (v >= 128) {
    out.push(v & 127 | 128);
    v = Math.floor(v / 128);
  }
  out.push(v & 127);
  return new Uint8Array(out);
}
function varintDecode(bytes, offset = 0) {
  let result = 0;
  let shiftMul = 1;
  let i = offset;
  let consumed = 0;
  while (i < bytes.length) {
    const b = bytes[i++];
    consumed++;
    const part = b & 127;
    result += part * shiftMul;
    if (!Number.isSafeInteger(result)) {
      throw new NdnError("InvalidData", "varint exceeds safe integer range");
    }
    if ((b & 128) === 0) {
      return [result, consumed];
    }
    shiftMul *= 128;
    if (consumed > 10) {
      throw new NdnError("InvalidData", "varint too long");
    }
  }
  throw new NdnError("InvalidData", "varint truncated");
}
function sha256Bytes(data) {
  const sha = new ht("SHA-256", "UINT8ARRAY");
  sha.update(data);
  return sha.getHash("UINT8ARRAY");
}
function sha256Utf8(text) {
  const sha = new ht("SHA-256", "TEXT", { encoding: "UTF8" });
  sha.update(text);
  return sha.getHash("UINT8ARRAY");
}
function canonicalizeJson(value) {
  if (value === null || typeof value !== "object")
    return value;
  if (Array.isArray(value))
    return value.map(canonicalizeJson);
  const keys = Object.keys(value).sort();
  const result = {};
  for (const k of keys) {
    result[k] = canonicalizeJson(value[k]);
  }
  return result;
}
function toCanonicalJsonString(value) {
  return JSON.stringify(canonicalizeJson(value));
}
const DEFAULT_HASH_METHOD = "sha256";
const HashMethod = {
  Sha256: "sha256",
  Sha512: "sha512",
  QCID: "qcid",
  Blake2s256: "blake2s256",
  Keccak256: "keccak256",
  hashResultSize(method) {
    switch (method) {
      case "sha256":
        return 32;
      case "sha512":
        return 64;
      case "qcid":
        return 32;
      case "blake2s256":
        return 32;
      case "keccak256":
        return 32;
    }
  },
  /** parse(s) -> [HashMethod, isMix]; "mix256" -> [Sha256, true]. */
  parse(s) {
    const isMix = s.startsWith("mix");
    const method = HashMethod.fromString(s);
    return [method, isMix];
  },
  fromString(s) {
    switch (s) {
      case "sha256":
      case "mix256":
        return "sha256";
      case "sha512":
      case "mix512":
        return "sha512";
      case "qcid":
      case "mixqcid":
        return "qcid";
      case "blake2s256":
      case "mixblake2s256":
        return "blake2s256";
      case "keccak256":
      case "mixkeccak256":
        return "keccak256";
      default:
        throw new NdnError("InvalidData", `Invalid hash method: ${s}`);
    }
  }
};
const ChunkType = {
  Sha256: "sha256",
  Mix256: "mix256",
  Sha512: "sha512",
  Mix512: "mix512",
  QCID: "qcid",
  Blake2s256: "blake2s256",
  MixBlake2s256: "mixblake2s256",
  Keccak256: "keccak256",
  MixKeccak256: "mixkeccak256",
  isChunkType(typeStr) {
    switch (typeStr) {
      case "sha256":
      case "mix256":
      case "sha512":
      case "mix512":
      case "qcid":
      case "blake2s256":
      case "mixblake2s256":
      case "keccak256":
      case "mixkeccak256":
        return true;
      default:
        return false;
    }
  },
  isMix(typeStr) {
    switch (typeStr) {
      case "mix256":
      case "mix512":
      case "mixblake2s256":
      case "mixkeccak256":
      case "qcid":
        return true;
      default:
        return false;
    }
  },
  fromHashType(hashType, isMix) {
    switch (hashType) {
      case "sha256":
        return isMix ? "mix256" : "sha256";
      case "sha512":
        return isMix ? "mix512" : "sha512";
      case "qcid":
        if (!isMix) {
          throw new NdnError("InvalidObjType", "QCID must be mix hash");
        }
        return "qcid";
      case "blake2s256":
        return isMix ? "mixblake2s256" : "blake2s256";
      case "keccak256":
        return isMix ? "mixkeccak256" : "keccak256";
    }
  },
  toHashMethod(typeStr) {
    switch (typeStr) {
      case "sha256":
      case "mix256":
        return "sha256";
      case "sha512":
      case "mix512":
        return "sha512";
      case "qcid":
        return "qcid";
      case "blake2s256":
      case "mixblake2s256":
        return "blake2s256";
      case "keccak256":
      case "mixkeccak256":
        return "keccak256";
      default:
        throw new NdnError("InvalidObjType", `invalid chunk type: ${typeStr}`);
    }
  }
};
class ObjId {
  constructor(objType, objHash) {
    this.objType = objType;
    this.objHash = objHash;
  }
  /** Parse from base32 (no separator) or `obj_type:hex_hash`. */
  static fromString(s) {
    const parts = s.split(":");
    if (parts.length === 1) {
      const decoded = base32Decode(parts[0]);
      let pos = -1;
      for (let i = 0; i < decoded.length; i++) {
        if (decoded[i] === 58) {
          pos = i;
          break;
        }
      }
      if (pos < 0) {
        throw new NdnError("InvalidId", "separator ':' not found");
      }
      const objType = utf8Decode(decoded.subarray(0, pos));
      const objHash = decoded.slice(pos + 1);
      return new ObjId(objType, objHash);
    } else if (parts.length === 2) {
      return new ObjId(parts[0], hexToBytes(parts[1]));
    } else {
      throw new NdnError("InvalidId", s);
    }
  }
  static fromBytes(bytes) {
    if (bytes.length < 3) {
      throw new NdnError("InvalidId", "objid bytes too short");
    }
    let pos = -1;
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] === 58) {
        pos = i;
        break;
      }
    }
    if (pos < 0) {
      throw new NdnError("InvalidId", "separator ':' not found");
    }
    const objType = utf8Decode(bytes.subarray(0, pos));
    const objHash = bytes.slice(pos + 1);
    return new ObjId(objType, objHash);
  }
  static fromValue(v) {
    if (typeof v === "string") {
      return ObjId.fromString(v);
    }
    throw new NdnError("InvalidData", "ObjId MUST be string");
  }
  static fromHostname(hostname) {
    const first = hostname.split(".")[0];
    return ObjId.fromString(first);
  }
  /**
   * Try to extract an ObjId from an NDN-style path. Returns the ObjId and
   * the optional remaining sub-path (with leading '/'), or null if no part
   * of the path parses as an ObjId.
   */
  static fromPath(path) {
    const parts = path.split("/");
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.length === 0)
        continue;
      try {
        const objId = ObjId.fromString(part);
        if (i < parts.length - 1) {
          return { objId, subPath: "/" + parts.slice(i + 1).join("/") };
        }
        return { objId, subPath: null };
      } catch {
      }
    }
    throw new NdnError("InvalidId", `no objid found in path: ${path}`);
  }
  /** Construct an ObjId from a precomputed hash. */
  static fromRaw(objType, hashValue) {
    return new ObjId(objType, hashValue);
  }
  isChunk() {
    return ChunkType.isChunkType(this.objType);
  }
  isChunkList() {
    return this.objType === OBJ_TYPE_CHUNK_LIST_SIMPLE;
  }
  isJson() {
    if (this.isChunk() || this.isContainer())
      return false;
    return this.objType !== OBJ_TYPE_PACK;
  }
  isDirObject() {
    return this.objType === OBJ_TYPE_DIR;
  }
  isFileObject() {
    return this.objType === OBJ_TYPE_FILE;
  }
  isContainer() {
    switch (this.objType) {
      case OBJ_TYPE_DIR:
      case OBJ_TYPE_TRIE:
      case OBJ_TYPE_TRIE_SIMPLE:
      case OBJ_TYPE_OBJMAP:
      case OBJ_TYPE_OBJMAP_SIMPLE:
      case OBJ_TYPE_LIST:
      case OBJ_TYPE_LIST_SIMPLE:
      case OBJ_TYPE_CHUNK_LIST:
      case OBJ_TYPE_CHUNK_LIST_SIMPLE:
      case OBJ_TYPE_CHUNK_LIST_FIX_SIZE:
      case OBJ_TYPE_CHUNK_LIST_SIMPLE_FIX_SIZE:
        return true;
      default:
        return false;
    }
  }
  isBigContainer() {
    switch (this.objType) {
      case OBJ_TYPE_TRIE:
      case OBJ_TYPE_OBJMAP:
      case OBJ_TYPE_LIST:
      case OBJ_TYPE_CHUNK_LIST:
      case OBJ_TYPE_CHUNK_LIST_FIX_SIZE:
        return true;
      default:
        return false;
    }
  }
  /** `${obj_type}:${hex(obj_hash)}` form. */
  toString() {
    return `${this.objType}:${bytesToHex(this.objHash)}`;
  }
  toFilename() {
    return `${bytesToHex(this.objHash)}.${this.objType}`;
  }
  toBase32() {
    return base32Encode(this.toBytes());
  }
  toBytes() {
    const typeBytes = utf8Encode(this.objType);
    const out = new Uint8Array(typeBytes.length + 1 + this.objHash.length);
    out.set(typeBytes, 0);
    out[typeBytes.length] = 58;
    out.set(this.objHash, typeBytes.length + 1);
    return out;
  }
  /** Used for JSON.stringify -> serialized as the `${type}:${hex}` string. */
  toJSON() {
    return this.toString();
  }
  equals(other) {
    if (this.objType !== other.objType)
      return false;
    if (this.objHash.length !== other.objHash.length)
      return false;
    for (let i = 0; i < this.objHash.length; i++) {
      if (this.objHash[i] !== other.objHash[i])
        return false;
    }
    return true;
  }
}
class ChunkId {
  constructor(chunkType, hashResult) {
    this.chunkType = chunkType;
    this.hashResult = hashResult;
  }
  static defaultChunkType() {
    return "mix256";
  }
  static fromString(s) {
    const objId = ObjId.fromString(s);
    if (!objId.isChunk()) {
      throw new NdnError("InvalidId", `invalid chunk id: ${s}`);
    }
    return new ChunkId(objId.objType, objId.objHash);
  }
  static fromObjId(objId) {
    return new ChunkId(objId.objType, new Uint8Array(objId.objHash));
  }
  static fromBytes(bytes) {
    const obj = ObjId.fromBytes(bytes);
    return new ChunkId(obj.objType, obj.objHash);
  }
  /** Construct from raw hash result, no length encoding. */
  static fromHashResult(hashResult, chunkType) {
    return new ChunkId(chunkType, new Uint8Array(hashResult));
  }
  /** Construct mix-style ChunkId by prepending varint(length) to hash. */
  static fromMixHashResult(dataLength, hashResult, chunkType) {
    return new ChunkId(chunkType, ChunkId.mixLengthAndHashResult(dataLength, hashResult));
  }
  static fromMixHashResultByHashMethod(dataLength, hashResult, hashMethod) {
    const chunkType = ChunkType.fromHashType(hashMethod, true);
    return new ChunkId(chunkType, ChunkId.mixLengthAndHashResult(dataLength, hashResult));
  }
  static fromSha256Result(hashResult) {
    return new ChunkId("sha256", new Uint8Array(hashResult));
  }
  static fromMix256Result(dataLength, hashResult) {
    return new ChunkId("mix256", ChunkId.mixLengthAndHashResult(dataLength, hashResult));
  }
  static mixLengthAndHashResult(dataLength, hashResult) {
    const lenBytes = varintEncode(dataLength);
    const out = new Uint8Array(lenBytes.length + hashResult.length);
    out.set(lenBytes, 0);
    out.set(hashResult, lenBytes.length);
    return out;
  }
  toObjId() {
    return new ObjId(this.chunkType, new Uint8Array(this.hashResult));
  }
  toString() {
    return `${this.chunkType}:${bytesToHex(this.hashResult)}`;
  }
  toBase32() {
    const typeBytes = utf8Encode(this.chunkType);
    const buf = new Uint8Array(typeBytes.length + 1 + this.hashResult.length);
    buf.set(typeBytes, 0);
    buf[typeBytes.length] = 58;
    buf.set(this.hashResult, typeBytes.length + 1);
    return base32Encode(buf);
  }
  toDidString() {
    return `did:${this.chunkType}:${bytesToHex(this.hashResult)}`;
  }
  toBytes() {
    return this.toObjId().toBytes();
  }
  toJSON() {
    return this.toString();
  }
  /** For mix-* types, return the data length encoded in the prefix. */
  getLength() {
    if (this.hashResult.length === 0)
      return null;
    if (!ChunkType.isMix(this.chunkType))
      return null;
    try {
      const [len] = varintDecode(this.hashResult, 0);
      return len;
    } catch {
      return null;
    }
  }
  equalsHash(hashBytes) {
    if (this.hashResult.length !== hashBytes.length)
      return false;
    for (let i = 0; i < this.hashResult.length; i++) {
      if (this.hashResult[i] !== hashBytes[i])
        return false;
    }
    return true;
  }
}
class NamedObjectBase {
  genObjId() {
    return buildNamedObjectByJson(this.getObjType(), this.toJSON());
  }
}
function buildObjId(objType, objJsonStr) {
  const hash = sha256Utf8(objJsonStr);
  return ObjId.fromRaw(objType, hash);
}
function buildNamedObjectByJson(objType, jsonValue) {
  const jsonStr = toCanonicalJsonString(jsonValue);
  const objId = buildObjId(objType, jsonStr);
  return [objId, jsonStr];
}
function verifyNamedObject(objId, jsonValue) {
  const [objId2] = buildNamedObjectByJson(objId.objType, jsonValue);
  return objId.equals(objId2);
}
function verifyNamedObjectFromStr(objId, objStr) {
  let parsed;
  try {
    parsed = JSON.parse(objStr);
  } catch (e) {
    throw new NdnError("InvalidId", `failed to parse obj_str: ${e.message}`);
  }
  if (!verifyNamedObject(objId, parsed)) {
    throw new NdnError("InvalidId", `verify named object failed: ${objStr}`);
  }
  return parsed;
}
function loadNamedObjectFromObjStr(objStr) {
  if (objStr.indexOf("{") >= 0) {
    try {
      return JSON.parse(objStr);
    } catch (e) {
      throw new NdnError("InvalidId", `failed to parse obj_str: ${e.message}`);
    }
  }
  throw new NdnError(
    "Unsupported",
    "JWT-encoded named objects are not supported in this TypeScript port"
  );
}
function loadNamedObj(objStr) {
  return loadNamedObjectFromObjStr(objStr);
}
function loadNamedObjAndVerify(objId, objStr) {
  const parsed = loadNamedObjectFromObjStr(objStr);
  if (!verifyNamedObject(objId, parsed)) {
    throw new NdnError("InvalidId", `verify named object failed for obj_id: ${objId.toString()}`);
  }
  return parsed;
}
function extractObjIdByPath(jsonValue, path) {
  const parts = path.split("/").filter((p) => p.length > 0);
  let cursor = jsonValue;
  for (const p of parts) {
    if (cursor == null) {
      throw new NdnError("InvalidParam", `objid path not found: ${path}`);
    }
    if (Array.isArray(cursor)) {
      const idx = Number(p);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cursor.length) {
        throw new NdnError("InvalidParam", `objid path not found: ${path}`);
      }
      cursor = cursor[idx];
    } else if (typeof cursor === "object") {
      if (!(p in cursor)) {
        throw new NdnError("InvalidParam", `objid path not found: ${path}`);
      }
      cursor = cursor[p];
    } else {
      throw new NdnError("InvalidParam", `objid path not found: ${path}`);
    }
  }
  try {
    return ObjId.fromValue(cursor);
  } catch (e) {
    throw new NdnError("InvalidData", `invalid objid at path ${path}: ${e.message}`);
  }
}
class BaseContentObject {
  constructor(fields = {}) {
    this.did = fields.did ?? null;
    this.name = fields.name ?? "";
    this.author = fields.author ?? "";
    this.owner = fields.owner ?? "";
    this.create_time = fields.create_time ?? 0;
    this.last_update_time = fields.last_update_time ?? 0;
    this.copyright = fields.copyright ?? null;
    this.tags = fields.tags ?? [];
    this.categories = fields.categories ?? [];
    this.base_on = fields.base_on ?? null;
    this.directory = fields.directory ?? {};
    this.references = fields.references ?? {};
    this.exp = fields.exp ?? 0;
  }
  /** Build the JSON object using the same skip rules as Rust serde. */
  toJSON() {
    const out = {};
    if (this.did != null)
      out.did = this.did;
    if (this.name.length > 0)
      out.name = this.name;
    if (this.author.length > 0)
      out.author = this.author;
    if (this.owner.length > 0)
      out.owner = this.owner;
    out.create_time = this.create_time;
    out.last_update_time = this.last_update_time;
    if (this.copyright != null)
      out.copyright = this.copyright;
    if (this.tags.length > 0)
      out.tags = this.tags;
    if (this.categories.length > 0)
      out.categories = this.categories;
    if (this.base_on != null)
      out.base_on = this.base_on.toString();
    if (Object.keys(this.directory).length > 0)
      out.directory = this.directory;
    if (Object.keys(this.references).length > 0)
      out.references = this.references;
    if (this.exp !== 0)
      out.exp = this.exp;
    return out;
  }
}
function nowSeconds() {
  return Math.floor(Date.now() / 1e3);
}
class FileObject extends NamedObjectBase {
  constructor(name, size, content) {
    super();
    this.content_obj = new BaseContentObject({ name });
    this.size = size;
    this.content = content;
    this.meta = {};
  }
  static fromJSON(value) {
    const file = new FileObject("", 0, "");
    const base = {};
    const meta = {};
    const baseKeys = /* @__PURE__ */ new Set([
      "did",
      "name",
      "author",
      "owner",
      "create_time",
      "last_update_time",
      "copyright",
      "tags",
      "categories",
      "base_on",
      "directory",
      "references",
      "exp"
    ]);
    for (const [k, v] of Object.entries(value)) {
      if (k === "size") {
        file.size = v ?? 0;
      } else if (k === "content") {
        file.content = v ?? "";
      } else if (baseKeys.has(k)) {
        if (k === "base_on" && typeof v === "string") {
          base.base_on = ObjId.fromString(v);
        } else {
          base[k] = v;
        }
      } else {
        meta[k] = v;
      }
    }
    file.content_obj = new BaseContentObject(base);
    file.meta = meta;
    return file;
  }
  getObjType() {
    return OBJ_TYPE_FILE;
  }
  toJSON() {
    const out = { ...this.content_obj.toJSON() };
    if (this.size !== 0)
      out.size = this.size;
    if (this.content.length > 0)
      out.content = this.content;
    for (const [k, v] of Object.entries(this.meta)) {
      out[k] = v;
    }
    return out;
  }
}
class PathObject extends NamedObjectBase {
  constructor(path, target, uptime, exp) {
    super();
    const now = nowSeconds();
    this.path = path;
    this.target = target;
    this.uptime = uptime ?? now;
    this.exp = exp ?? now + 3600 * 24 * 365 * 3;
  }
  static fromJSON(value) {
    const path = String(value.path ?? "");
    const target = ObjId.fromString(String(value.target ?? ""));
    const uptime = Number(value.uptime ?? 0);
    const exp = Number(value.exp ?? 0);
    return new PathObject(path, target, uptime, exp);
  }
  getObjType() {
    return OBJ_TYPE_PATH;
  }
  toJSON() {
    return {
      path: this.path,
      uptime: this.uptime,
      target: this.target.toString(),
      exp: this.exp
    };
  }
}
class InclusionProof extends NamedObjectBase {
  constructor(contentId, contentObj, curator, rank, collection) {
    super();
    const now = nowSeconds();
    this.content_id = contentId.toString();
    this.content_obj = contentObj;
    this.curator = curator;
    this.editor = [];
    this.meta = null;
    this.rank = rank;
    this.collection = collection;
    this.review_url = null;
    this.iat = now;
    this.exp = now + 3600 * 24 * 30 * 12;
  }
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
  static fromJSON(value) {
    const proof = new InclusionProof(
      ObjId.fromString(String(value.content_id ?? "")),
      value.content_obj ?? null,
      String(value.curator ?? ""),
      Number(value.rank ?? 0),
      Array.isArray(value.collection) ? value.collection.slice() : []
    );
    proof.content_id = String(value.content_id ?? "");
    proof.editor = Array.isArray(value.editor) ? value.editor.slice() : [];
    proof.meta = value.meta ?? null;
    proof.review_url = typeof value.review_url === "string" ? value.review_url : null;
    proof.iat = Number(value.iat ?? 0);
    proof.exp = Number(value.exp ?? 0);
    return proof;
  }
  getObjType() {
    return OBJ_TYPE_INCLUSION_PROOF;
  }
  toJSON() {
    const out = {
      content_id: this.content_id,
      content_obj: this.content_obj,
      curator: this.curator,
      editor: this.editor,
      meta: this.meta,
      rank: this.rank,
      iat: this.iat,
      exp: this.exp
    };
    if (this.collection.length > 0)
      out.collection = this.collection;
    if (this.review_url != null)
      out.review_url = this.review_url;
    return out;
  }
}
const SimpleMapItem = {
  fromObjId(objId) {
    return { kind: "objId", objId };
  },
  fromObject(objType, obj) {
    return { kind: "object", objType, obj };
  },
  fromObjectJwt(objType, jwt) {
    return { kind: "objectJwt", objType, jwt };
  },
  getObjType(item) {
    switch (item.kind) {
      case "objId":
        return item.objId.objType;
      case "object":
        return item.objType;
      case "objectJwt":
        return item.objType;
    }
  },
  /** Compute (objId, optional inline obj-string) for this item. */
  getObjId(item) {
    switch (item.kind) {
      case "objId":
        return [item.objId, ""];
      case "object":
        return buildNamedObjectByJson(item.objType, item.obj);
      case "objectJwt":
        throw new NdnError(
          "Unsupported",
          "JWT-encoded SimpleMapItem requires JWT decoding (not implemented in TS port)"
        );
    }
  },
  toJSON(item) {
    switch (item.kind) {
      case "objId":
        return item.objId.toString();
      case "object":
        return { obj_type: item.objType, body: item.obj };
      case "objectJwt":
        return { obj_type: item.objType, jwt: item.jwt };
    }
  },
  fromJSON(value) {
    if (typeof value === "string") {
      return { kind: "objId", objId: ObjId.fromString(value) };
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const v = value;
      const objType = v.obj_type;
      if (typeof objType !== "string") {
        throw new NdnError("InvalidData", "SimpleMapItem must have obj_type field");
      }
      if (typeof v.jwt === "string") {
        return { kind: "objectJwt", objType, jwt: v.jwt };
      }
      if ("body" in v) {
        return { kind: "object", objType, obj: v.body };
      }
      throw new NdnError("InvalidData", "SimpleMapItem must have body or jwt field");
    }
    throw new NdnError("InvalidData", "SimpleMapItem must be string or object");
  }
};
class SimpleObjectMap {
  constructor() {
    this.body = /* @__PURE__ */ new Map();
  }
  static fromJSON(value) {
    const map = new SimpleObjectMap();
    if (!value || typeof value !== "object") {
      throw new NdnError("InvalidData", "SimpleObjectMap must be an object");
    }
    const root = value;
    const body = root.body;
    if (body == null)
      return map;
    if (typeof body !== "object" || Array.isArray(body)) {
      throw new NdnError("InvalidData", "SimpleObjectMap.body must be an object");
    }
    for (const [k, v] of Object.entries(body)) {
      map.body.set(k, SimpleMapItem.fromJSON(v));
    }
    return map;
  }
  /**
   * Resolve every entry to its ObjId string and merge it into `realObj` as
   * the `body` field, then derive a NamedObject ObjId. Matches
   * SimpleObjectMap::gen_obj_id_with_real_obj() in Rust.
   */
  genObjIdWithRealObj(resultObjType, realObj) {
    const realMap = {};
    for (const [k, v] of this.body) {
      const [subId] = SimpleMapItem.getObjId(v);
      realMap[k] = subId.toString();
    }
    realObj.body = realMap;
    return buildNamedObjectByJson(resultObjType, realObj);
  }
  get size() {
    return this.body.size;
  }
  isEmpty() {
    return this.body.size === 0;
  }
  get(key) {
    return this.body.get(key);
  }
  set(key, value) {
    this.body.set(key, value);
  }
  delete(key) {
    return this.body.delete(key);
  }
  has(key) {
    return this.body.has(key);
  }
  keys() {
    return this.body.keys();
  }
  values() {
    return this.body.values();
  }
  entries() {
    return this.body.entries();
  }
  /** Serialize to wire JSON (matches Rust SimpleObjectMap serde). */
  toJSON() {
    const body = {};
    for (const [k, v] of this.body) {
      body[k] = SimpleMapItem.toJSON(v);
    }
    return { body };
  }
}
class DirObject extends NamedObjectBase {
  constructor(name) {
    super();
    this.content_obj = name != null ? new BaseContentObject({ name }) : new BaseContentObject();
    this.meta = {};
    this.total_size = 0;
    this.file_count = 0;
    this.file_size = 0;
    this.object_map = new SimpleObjectMap();
  }
  static fromJSON(value) {
    const dir = new DirObject();
    const baseKeys = /* @__PURE__ */ new Set([
      "did",
      "name",
      "author",
      "owner",
      "create_time",
      "last_update_time",
      "copyright",
      "tags",
      "categories",
      "base_on",
      "directory",
      "references",
      "exp"
    ]);
    const baseFields = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "meta") {
        dir.meta = v ?? {};
      } else if (k === "total_size") {
        dir.total_size = Number(v ?? 0);
      } else if (k === "file_count") {
        dir.file_count = Number(v ?? 0);
      } else if (k === "file_size") {
        dir.file_size = Number(v ?? 0);
      } else if (k === "body") {
        const body = v;
        if (body) {
          for (const [name, item] of Object.entries(body)) {
            dir.object_map.set(name, SimpleMapItem.fromJSON(item));
          }
        }
      } else if (baseKeys.has(k)) {
        if (k === "base_on" && typeof v === "string") {
          baseFields.base_on = ObjId.fromString(v);
        } else {
          baseFields[k] = v;
        }
      }
    }
    dir.content_obj = new BaseContentObject(baseFields);
    return dir;
  }
  getObjType() {
    return OBJ_TYPE_DIR;
  }
  /** JSON form (with raw `body`) - useful for storage / debug. */
  toJSON() {
    const out = { ...this.content_obj.toJSON() };
    if (Object.keys(this.meta).length > 0)
      out.meta = this.meta;
    out.total_size = this.total_size;
    out.file_count = this.file_count;
    out.file_size = this.file_size;
    out.body = this.object_map.toJSON().body;
    return out;
  }
  /**
   * DirObject's ObjId is derived from a JSON form whose `body` field is a
   * `name -> objIdString` map (children are reduced to ObjIds first).
   * Matches DirObject::gen_obj_id() in Rust.
   */
  genObjId() {
    const realObj = { ...this.content_obj.toJSON() };
    realObj.total_size = this.total_size;
    realObj.file_count = this.file_count;
    realObj.file_size = this.file_size;
    return this.object_map.genObjIdWithRealObj(OBJ_TYPE_DIR, realObj);
  }
  get size() {
    return this.object_map.size;
  }
  isEmpty() {
    return this.object_map.isEmpty();
  }
  get(key) {
    return this.object_map.get(key);
  }
  delete(key) {
    return this.object_map.delete(key);
  }
  has(key) {
    return this.object_map.has(key);
  }
  keys() {
    return this.object_map.keys();
  }
  values() {
    return this.object_map.values();
  }
  entries() {
    return this.object_map.entries();
  }
  addFile(name, fileObj, fileSize) {
    this.file_size += fileSize;
    this.file_count += 1;
    this.total_size += fileSize;
    this.object_map.set(name, SimpleMapItem.fromObject(OBJ_TYPE_FILE, fileObj));
  }
  addDirectory(name, dirObjId, dirSize) {
    if (dirObjId.objType !== OBJ_TYPE_DIR) {
      throw new NdnError("InvalidParam", "dir_obj_id is not a directory");
    }
    this.total_size += dirSize;
    this.object_map.set(name, SimpleMapItem.fromObjId(dirObjId));
  }
  listEntries() {
    return Array.from(this.object_map.keys());
  }
  isFile(name) {
    const item = this.object_map.get(name);
    if (!item)
      return false;
    return item.kind === "object" && item.objType === OBJ_TYPE_FILE;
  }
  isDirectory(name) {
    const item = this.object_map.get(name);
    if (!item)
      return false;
    switch (item.kind) {
      case "objId":
        return item.objId.objType === OBJ_TYPE_DIR;
      case "objectJwt":
        return item.objType === OBJ_TYPE_DIR;
      default:
        return false;
    }
  }
}
class SimpleChunkList {
  constructor() {
    this.total_size = 0;
    this.body = [];
  }
  static fromChunkList(chunks) {
    const list = new SimpleChunkList();
    for (const c of chunks) {
      const len = c.getLength();
      if (len == null) {
        throw new NdnError("InvalidParam", "get chunk length from chunkid failed");
      }
      list.total_size += len;
    }
    list.body = chunks.slice();
    return list;
  }
  static fromJson(objStr) {
    let parsed;
    try {
      parsed = JSON.parse(objStr);
    } catch (e) {
      throw new NdnError(
        "InvalidParam",
        `parse chunk list from json failed: ${e.message}`
      );
    }
    return SimpleChunkList.fromJsonValue(parsed);
  }
  static fromJsonValue(value) {
    if (!Array.isArray(value)) {
      throw new NdnError("InvalidParam", "chunk list must be a JSON array");
    }
    const chunks = value.map((item) => {
      if (typeof item !== "string") {
        throw new NdnError("InvalidParam", "chunk list item must be a string");
      }
      return ChunkId.fromString(item);
    });
    return SimpleChunkList.fromChunkList(chunks);
  }
  appendChunk(chunkId) {
    const len = chunkId.getLength();
    if (len == null) {
      throw new NdnError("InvalidParam", "get chunk length from chunkid failed");
    }
    this.body.push(chunkId);
    this.total_size += len;
  }
  /**
   * Mirrors SimpleChunkList::gen_obj_id(): hash the JSON list of ChunkId
   * strings, then prefix the resulting hash bytes with varint(total_size)
   * to form the final ObjId.
   */
  genObjId() {
    const bodyJson = this.body.map((c) => c.toString());
    const [innerObjId, objStr] = buildNamedObjectByJson(
      OBJ_TYPE_CHUNK_LIST_SIMPLE,
      bodyJson
    );
    const mixed = ChunkId.mixLengthAndHashResult(this.total_size, innerObjId.objHash);
    const resultId = ObjId.fromRaw(OBJ_TYPE_CHUNK_LIST_SIMPLE, mixed);
    return [resultId, objStr];
  }
}
class RelationObject extends NamedObjectBase {
  constructor(source, relation, target, body = {}) {
    super();
    this.source = source;
    this.relation = relation;
    this.target = target;
    this.body = body;
    this.iat = null;
    this.exp = null;
  }
  /**
   * Reconstruct a RelationObject from its JSON form. `source`, `relation`,
   * `target`, `iat` and `exp` are reserved top-level fields; every other
   * key lands back in `body` (matching what `toJSON` spreads out), so the
   * decode → re-encode round-trip is byte-stable under canonical JSON
   * for any shape the TS class is capable of emitting.
   */
  static fromJSON(value) {
    const reserved = /* @__PURE__ */ new Set(["source", "relation", "target", "iat", "exp"]);
    const body = {};
    for (const [k, v] of Object.entries(value)) {
      if (!reserved.has(k))
        body[k] = v;
    }
    const rel = new RelationObject(
      ObjId.fromString(String(value.source ?? "")),
      String(value.relation ?? ""),
      ObjId.fromString(String(value.target ?? "")),
      body
    );
    rel.iat = typeof value.iat === "number" ? value.iat : null;
    rel.exp = typeof value.exp === "number" ? value.exp : null;
    return rel;
  }
  static createByLinkData(source, link) {
    switch (link.kind) {
      case "sameAs":
        return new RelationObject(source, RELATION_TYPE_SAME, link.target);
      case "partOf":
        return new RelationObject(
          source,
          RELATION_TYPE_PART_OF,
          link.target,
          { range: { start: link.range.start, end: link.range.end } }
        );
    }
  }
  getLinkData() {
    switch (this.relation) {
      case RELATION_TYPE_SAME:
        return { kind: "sameAs", target: this.target };
      case RELATION_TYPE_PART_OF: {
        const range = this.body.range;
        if (!range || typeof range.start !== "number" || typeof range.end !== "number") {
          throw new NdnError(
            "InvalidLink",
            `invalid range: ${JSON.stringify(this.body.range)}`
          );
        }
        return {
          kind: "partOf",
          target: this.target,
          range: { start: range.start, end: range.end }
        };
      }
      default:
        throw new NdnError("InvalidLink", `invalid relation: ${this.relation}`);
    }
  }
  getObjType() {
    return OBJ_TYPE_RELATION;
  }
  toJSON() {
    const out = {
      source: this.source.toString(),
      relation: this.relation,
      target: this.target.toString()
    };
    for (const [k, v] of Object.entries(this.body)) {
      out[k] = v;
    }
    if (this.iat != null)
      out.iat = this.iat;
    if (this.exp != null)
      out.exp = this.exp;
    return out;
  }
}
const KnownStandardObject = {
  fromObjData(objId, objData) {
    switch (objId.objType) {
      case OBJ_TYPE_DIR: {
        let parsed;
        try {
          parsed = JSON.parse(objData);
        } catch (e) {
          throw new NdnError(
            "InvalidParam",
            `parse dir object from json failed: ${e.message}`
          );
        }
        return {
          kind: "dir",
          obj: DirObject.fromJSON(parsed),
          objStr: objData
        };
      }
      case OBJ_TYPE_FILE: {
        let parsed;
        try {
          parsed = JSON.parse(objData);
        } catch (e) {
          throw new NdnError(
            "InvalidParam",
            `parse file object from json failed: ${e.message}`
          );
        }
        return {
          kind: "file",
          obj: FileObject.fromJSON(parsed),
          objStr: objData
        };
      }
      case OBJ_TYPE_CHUNK_LIST_SIMPLE: {
        return {
          kind: "chunkList",
          obj: SimpleChunkList.fromJson(objData),
          objStr: objData
        };
      }
      default:
        throw new NdnError("InvalidParam", `Unknown object type: ${objId.objType}`);
    }
  },
  /** Return ObjIds (and optional inline obj-string) for the children. */
  getChildObjs(known) {
    switch (known.kind) {
      case "dir": {
        const out = [];
        for (const [, item] of known.obj.entries()) {
          const [objId, objStr] = SimpleMapItem.getObjId(item);
          out.push({ objId, objStr: objStr.length > 0 ? objStr : null });
        }
        return out;
      }
      case "file": {
        if (known.obj.content.length === 0)
          return [];
        return [{ objId: ObjId.fromString(known.obj.content), objStr: null }];
      }
      case "chunkList":
        return known.obj.body.map((c) => ({ objId: c.toObjId(), objStr: null }));
    }
  }
};
const _textEncoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
const _textDecoder = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8") : null;
function utf8Encode(s) {
  if (_textEncoder)
    return _textEncoder.encode(s);
  const out = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 128) {
      out.push(c);
    } else if (c < 2048) {
      out.push(192 | c >> 6, 128 | c & 63);
    } else if (c >= 55296 && c <= 56319 && i + 1 < s.length) {
      const c2 = s.charCodeAt(++i);
      const cp = 65536 + ((c & 1023) << 10 | c2 & 1023);
      out.push(
        240 | cp >> 18,
        128 | cp >> 12 & 63,
        128 | cp >> 6 & 63,
        128 | cp & 63
      );
    } else {
      out.push(224 | c >> 12, 128 | c >> 6 & 63, 128 | c & 63);
    }
  }
  return new Uint8Array(out);
}
function utf8Decode(bytes) {
  if (_textDecoder)
    return _textDecoder.decode(bytes);
  let s = "";
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i++];
    if (b < 128) {
      s += String.fromCharCode(b);
    } else if (b < 224) {
      s += String.fromCharCode((b & 31) << 6 | bytes[i++] & 63);
    } else if (b < 240) {
      s += String.fromCharCode(
        (b & 15) << 12 | (bytes[i++] & 63) << 6 | bytes[i++] & 63
      );
    } else {
      const cp = (b & 7) << 18 | (bytes[i++] & 63) << 12 | (bytes[i++] & 63) << 6 | bytes[i++] & 63;
      const u = cp - 65536;
      s += String.fromCharCode(55296 + (u >> 10), 56320 + (u & 1023));
    }
  }
  return s;
}
const ndn_types = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  BaseContentObject,
  ChunkId,
  ChunkType,
  DEFAULT_HASH_METHOD,
  DirObject,
  FileObject,
  HashMethod,
  InclusionProof,
  KnownStandardObject,
  NamedObjectBase,
  NdnError,
  OBJ_TYPE_ACTION,
  OBJ_TYPE_CHUNK_LIST,
  OBJ_TYPE_CHUNK_LIST_FIX_SIZE,
  OBJ_TYPE_CHUNK_LIST_SIMPLE,
  OBJ_TYPE_CHUNK_LIST_SIMPLE_FIX_SIZE,
  OBJ_TYPE_DIR,
  OBJ_TYPE_FILE,
  OBJ_TYPE_INCLUSION_PROOF,
  OBJ_TYPE_LIST,
  OBJ_TYPE_LIST_SIMPLE,
  OBJ_TYPE_MSG,
  OBJ_TYPE_MSG_RECE,
  OBJ_TYPE_OBJMAP,
  OBJ_TYPE_OBJMAP_SIMPLE,
  OBJ_TYPE_PACK,
  OBJ_TYPE_PATH,
  OBJ_TYPE_PKG,
  OBJ_TYPE_RELATION,
  OBJ_TYPE_TRIE,
  OBJ_TYPE_TRIE_SIMPLE,
  ObjId,
  PathObject,
  RELATION_TYPE_PART_OF,
  RELATION_TYPE_SAME,
  RelationObject,
  SimpleChunkList,
  SimpleMapItem,
  SimpleObjectMap,
  base32Decode,
  base32Encode,
  buildNamedObjectByJson,
  buildObjId,
  bytesToHex,
  canonicalizeJson,
  extractObjIdByPath,
  hexToBytes,
  loadNamedObj,
  loadNamedObjAndVerify,
  loadNamedObjectFromObjStr,
  sha256Bytes,
  sha256Utf8,
  toCanonicalJsonString,
  varintDecode,
  varintEncode,
  verifyNamedObject,
  verifyNamedObjectFromStr
}, Symbol.toStringTag, { value: "Module" }));
export {
  ndn_types as n
};
//# sourceMappingURL=ndn_types-d5a581f1.mjs.map
