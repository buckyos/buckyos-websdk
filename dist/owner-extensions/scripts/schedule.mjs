class NdnError extends Error {
  constructor(kind, message) {
    super(`${kind}: ${message}`);
    this.kind = kind;
    this.name = "NdnError";
  }
}
const OBJ_TYPE_FILE = "cyfile";
const OBJ_TYPE_DIR = "cydir";
const OBJ_TYPE_PACK = "cypack";
const OBJ_TYPE_OBJMAP = "cymap";
const OBJ_TYPE_LIST = "cylist";
const OBJ_TYPE_CHUNK_LIST = "clist";
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
    return this.objType === OBJ_TYPE_CHUNK_LIST;
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
      case OBJ_TYPE_OBJMAP:
      case OBJ_TYPE_LIST:
      case OBJ_TYPE_CHUNK_LIST:
        return true;
      default:
        return false;
    }
  }
  isBigContainer() {
    switch (this.objType) {
      case OBJ_TYPE_OBJMAP:
      case OBJ_TYPE_LIST:
      case OBJ_TYPE_CHUNK_LIST:
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
const MSG_OBJECT_RESERVED_KEYS = [
  "from",
  "to",
  "kind",
  "to_session",
  "thread",
  "relates_to",
  "mentions",
  "workspace",
  "created_at_ms",
  "expires_at_ms",
  "nonce",
  "content",
  "proof"
];
new Set(MSG_OBJECT_RESERVED_KEYS.filter((key) => key !== "proof"));
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
const OBJ_SERVICE_NAMES = [
  "config",
  "dfs",
  "taskmgr",
  "kmsg",
  "bucket",
  "ndm",
  "msg-center",
  "aiworkspace",
  "homestation",
  "opendan",
  "aicc"
];
class ObjectUrlError extends Error {
}
function isObjServiceName(name) {
  return OBJ_SERVICE_NAMES.includes(name);
}
function parseObjectUrl(input) {
  input = input.trim();
  const sep = input.indexOf("://");
  if (sep < 0)
    throw new ObjectUrlError(`'${input}' has no scheme`);
  const scheme = input.slice(0, sep).toLowerCase();
  const rest = input.slice(sep + 3);
  switch (scheme) {
    case "https":
    case "http": {
      try {
        return { kind: "web", url: new URL(input).toString() };
      } catch (e) {
        throw new ObjectUrlError(`invalid web url '${input}': ${e}`);
      }
    }
    case "buckyos":
      return { kind: "buckyos", url: input };
    case "file": {
      const { authority, path, query } = splitAuthority(rest);
      if (query !== null)
        throw new ObjectUrlError("file url does not take query or fragment");
      const host = authority.toLowerCase();
      let deviceId;
      if (host === "" || host === "localhost")
        deviceId = null;
      else if (isHostname(host))
        deviceId = host;
      else
        throw new ObjectUrlError(`invalid device id '${host}' in file url`);
      if (path === "")
        throw new ObjectUrlError("file url requires an absolute path");
      return { kind: "file", deviceId, path: normalizePath(path, false) };
    }
    case "cyfs": {
      const { authority: rawAuthority, path, query } = splitAuthority(rest);
      if (query !== null)
        throw new ObjectUrlError("cyfs url does not take query or fragment");
      const authority = rawAuthority.toLowerCase();
      if (authority === "" || authority === "_") {
        if (path === "")
          throw new ObjectUrlError("cyfs path url requires a path");
        return { kind: "cyfs_path", zone: null, path: normalizePath(path, false) };
      }
      const dot = authority.indexOf(".");
      const firstLabel = dot < 0 ? authority : authority.slice(0, dot);
      const restLabels = dot < 0 ? null : authority.slice(dot + 1);
      const objId = strictObjIdLabel(firstLabel);
      if (objId) {
        if (restLabels !== null && !isHostname(restLabels)) {
          throw new ObjectUrlError(`invalid source zone '${restLabels}'`);
        }
        return {
          kind: "cyfs_object",
          objId,
          sourceZone: restLabels,
          innerPath: path === "" || path === "/" ? "" : normalizePath(path, false)
        };
      }
      if (!isHostname(authority) || !authority.includes(".")) {
        throw new ObjectUrlError(`'${authority}' is neither a zone host nor an ObjId`);
      }
      if (path === "")
        throw new ObjectUrlError("cyfs path url requires a path");
      return { kind: "cyfs_path", zone: authority, path: normalizePath(path, false) };
    }
    case "obj": {
      const { authority, path, query } = splitAuthority(rest);
      const host = parseObjHost(authority.toLowerCase());
      return {
        kind: "obj",
        host,
        path: path === "" || path === "/" ? "" : normalizePath(path, true),
        query: query === null ? {} : parseQuery(query)
      };
    }
    default:
      throw new ObjectUrlError(`unsupported scheme '${scheme}'`);
  }
}
function parseObjHost(host) {
  if (host === "")
    throw new ObjectUrlError("obj url requires a host");
  if (isObjServiceName(host))
    return { kind: "service", name: host };
  if (!host.includes(".")) {
    throw new ObjectUrlError(
      `'${host}' is not a registered obj:// service name; type shorthands are not supported`
    );
  }
  if (!isHostname(host))
    throw new ObjectUrlError(`'${host}' is not a valid entity hostname`);
  const firstLabel = host.split(".")[0];
  if (isObjServiceName(firstLabel)) {
    throw new ObjectUrlError(
      `'${host}' expands a service name; write obj://${firstLabel}/ for the current zone or use https across zones`
    );
  }
  if (strictObjIdLabel(firstLabel)) {
    throw new ObjectUrlError("NamedObject ids do not go into obj:// host; use cyfs://<objid>/");
  }
  return { kind: "entity", name: host };
}
function formatObjectUrl(url) {
  switch (url.kind) {
    case "file":
      return `file://${url.deviceId ?? ""}${url.path}`;
    case "cyfs_path":
      return `cyfs://${url.zone ?? ""}${url.path}`;
    case "cyfs_object":
      return `cyfs://${url.objId.toBase32()}${url.sourceZone ? `.${url.sourceZone}` : ""}${url.innerPath || "/"}`;
    case "obj": {
      const keys = Object.keys(url.query).sort();
      const query = keys.map((k) => `${encodeObjQueryComponent(k)}=${encodeObjQueryComponent(url.query[k])}`).join("&");
      return `obj://${url.host.name}${url.path}${query ? `?${query}` : ""}`;
    }
    case "web":
    case "buckyos":
      return url.url;
  }
}
function normalizeObjectUrl(input) {
  return formatObjectUrl(parseObjectUrl(input));
}
function objectSegments(url) {
  return url.kind === "obj" ? decodedSegments(url.path) : [];
}
function objServiceUrl(service, segments) {
  return `obj://${service}${segments.map((s) => `/${encodeObjSegment(s)}`).join("")}`;
}
function canonicalJson(value) {
  if (Array.isArray(value))
    return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}
function encodeObjSegment(segment) {
  return encodeWith(segment, (b) => isUnreserved(b) || "!$&'()*+,;=:@".includes(String.fromCharCode(b)));
}
function encodeObjQueryComponent(component) {
  return encodeWith(component, (b) => isUnreserved(b) || "!$'()*,;:@/".includes(String.fromCharCode(b)));
}
function encodeWith(input, keep) {
  let out = "";
  for (const byte of new TextEncoder().encode(input)) {
    out += keep(byte) ? String.fromCharCode(byte) : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}
function isUnreserved(byte) {
  const ch = String.fromCharCode(byte);
  return /[A-Za-z0-9]/.test(ch) || "-._~".includes(ch);
}
function splitAuthority(rest) {
  const qpos = rest.search(/[?#]/);
  const beforeQuery = qpos < 0 ? rest : rest.slice(0, qpos);
  let query = null;
  if (qpos >= 0) {
    const q = rest.slice(qpos).split("#")[0];
    query = q.startsWith("?") ? q.slice(1) : q;
    if (query === "")
      query = null;
  }
  const slash = beforeQuery.indexOf("/");
  return slash < 0 ? { authority: beforeQuery, path: "", query } : { authority: beforeQuery.slice(0, slash), path: beforeQuery.slice(slash), query };
}
function normalizePath(path, trimTrailingSlash) {
  if (!path.startsWith("/"))
    throw new ObjectUrlError(`path '${path}' must be absolute`);
  let body = path.slice(1);
  if (trimTrailingSlash && body.endsWith("/"))
    body = body.slice(0, -1);
  const raw = body.split("/");
  let out = "";
  raw.forEach((segment, index) => {
    if (segment === "" && index === raw.length - 1 && !trimTrailingSlash) {
      out += "/";
      return;
    }
    const decoded = percentDecode(segment);
    if (decoded === "" || decoded === "." || decoded === "..") {
      throw new ObjectUrlError(`ambiguous path segment in '${path}'`);
    }
    out += `/${encodeObjSegment(decoded)}`;
  });
  return out;
}
function decodedSegments(path) {
  return path.split("/").filter((s) => s !== "").map((s) => {
    try {
      return percentDecode(s);
    } catch {
      return s;
    }
  });
}
function parseQuery(query) {
  const out = {};
  for (const pair of query.split("&")) {
    if (pair === "")
      continue;
    const eq = pair.indexOf("=");
    const key = percentDecode((eq < 0 ? pair : pair.slice(0, eq)).replace(/\+/g, " "));
    let value = percentDecode((eq < 0 ? "" : pair.slice(eq + 1)).replace(/\+/g, " "));
    if (key === "selector") {
      try {
        value = canonicalJson(JSON.parse(value));
      } catch (e) {
        throw new ObjectUrlError(`selector must be JSON: ${e}`);
      }
    }
    if (Object.prototype.hasOwnProperty.call(out, key)) {
      throw new ObjectUrlError(`query key '${key}' repeats`);
    }
    out[key] = value;
  }
  return out;
}
function percentDecode(input) {
  const raw = new TextEncoder().encode(input);
  const bytes = [];
  for (let i = 0; i < raw.length; ) {
    if (raw[i] === 37) {
      const hex = String.fromCharCode(raw[i + 1] ?? 0, raw[i + 2] ?? 0);
      if (!/^[0-9A-Fa-f]{2}$/.test(hex))
        throw new ObjectUrlError(`invalid escape in '${input}'`);
      bytes.push(parseInt(hex, 16));
      i += 3;
    } else {
      bytes.push(raw[i]);
      i += 1;
    }
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    throw new ObjectUrlError(`'${input}' is not UTF-8`);
  }
}
function isHostname(host) {
  return host !== "" && host.length <= 253 && host.split(".").every((label) => label !== "" && label.length <= 63 && /^[a-z0-9-]+$/.test(label) && !label.startsWith("-") && !label.endsWith("-"));
}
function strictObjIdLabel(label) {
  if (label.length < 26)
    return null;
  try {
    const objId = ObjId.fromString(label);
    const typeOk = /^[a-z0-9_-]+$/.test(objId.objType);
    return typeOk && objId.objHash.length >= 16 && objId.toBase32() === label ? objId : null;
  } catch {
    return null;
  }
}
class AiwsFailure extends Error {
  constructor(error) {
    super(`${error.code}${error.sub_code ? `/${error.sub_code}` : ""}: ${error.detail}`);
    this.name = "AiwsFailure";
    this.code = error.code;
    this.subCode = error.sub_code;
    this.data = error.data;
  }
}
function aiwsReferenceUrl(reference, workspaceId) {
  const ws = reference.workspace_id ?? workspaceId;
  if (!ws)
    throw new Error("reference names no workspace");
  const query = [];
  if (reference.mode === "fixed")
    query.push("mode=fixed");
  if (reference.selector != null)
    query.push(`selector=${encodeObjQueryComponent(canonicalJson(reference.selector))}`);
  if (reference.version != null)
    query.push(`version=${encodeObjQueryComponent(canonicalJson(reference.version))}`);
  const base = objServiceUrl("aiworkspace", [ws, "entities", reference.entity_id]);
  return normalizeObjectUrl(query.length ? `${base}?${query.join("&")}` : base);
}
function parseAiwsReferenceUrl(url) {
  const parsed = parseObjectUrl(url);
  const segments = objectSegments(parsed);
  if (parsed.kind !== "obj" || parsed.host.name !== "aiworkspace" || segments.length !== 3 || segments[1] !== "entities") {
    throw new Error(`${url} is not an AI Workspace entity url`);
  }
  const reference = {
    workspace_id: segments[0],
    entity_id: segments[2],
    mode: parsed.query.mode === "fixed" ? "fixed" : "live"
  };
  if (parsed.query.selector !== void 0)
    reference.selector = JSON.parse(parsed.query.selector);
  if (parsed.query.version !== void 0)
    reference.version = JSON.parse(parsed.query.version);
  return reference;
}
new TextEncoder();
const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
class RRuleError extends Error {
  constructor(message) {
    super(message);
    this.name = "RRuleError";
  }
}
const FREQS = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];
const MAX_COUNT = 1e3;
const MAX_INTERVAL = 999;
function intIn(part, value, lo, hi, zero = false) {
  if (!/^[+-]?\d{1,3}$/.test(value))
    throw new RRuleError(`${part}: ${value} is not a number`);
  const n = Number(value);
  if (n < lo || n > hi || !zero && n === 0)
    throw new RRuleError(`${part}: ${value} is out of range`);
  return n;
}
function list(part, value, max) {
  const items = value.split(",");
  if (items.length === 0 || items.length > max || items.some((x) => x === ""))
    throw new RRuleError(`${part}: at most ${max} comma-separated values`);
  return items;
}
function untilOf(value) {
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (m) {
    const date = `${m[1]}-${m[2]}-${m[3]}`;
    if (!isDate(date))
      throw new RRuleError(`UNTIL: ${value} is not a date`);
    return date;
  }
  m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (m) {
    const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    if (!isDate(`${m[1]}-${m[2]}-${m[3]}`) || +m[4] > 23 || +m[5] > 59 || +m[6] > 59)
      throw new RRuleError(`UNTIL: ${value} is not a UTC time`);
    return new Date(ms).toISOString();
  }
  throw new RRuleError(`UNTIL: ${value} must be YYYYMMDD or YYYYMMDDTHHMMSSZ`);
}
function parseRRule(text) {
  const body = text.startsWith("RRULE:") ? text.slice(6) : text;
  if (body.trim() === "")
    throw new RRuleError("empty rule");
  const seen = /* @__PURE__ */ new Set();
  const raw = {};
  for (const part of body.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0)
      throw new RRuleError(`${part || "(empty)"}: expected NAME=VALUE`);
    const name = part.slice(0, eq);
    const value = part.slice(eq + 1);
    if (name !== name.toUpperCase() || value !== value.toUpperCase())
      throw new RRuleError(`${part}: write the rule in upper case`);
    if (seen.has(name))
      throw new RRuleError(`${name}: given twice`);
    seen.add(name);
    if (!["FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY", "BYMONTHDAY", "BYMONTH", "BYSETPOS", "WKST"].includes(name)) {
      throw new RRuleError(`${name}: not supported (supported: FREQ, INTERVAL, COUNT, UNTIL, BYDAY, BYMONTHDAY, BYMONTH, BYSETPOS, WKST)`);
    }
    if (value === "")
      throw new RRuleError(`${name}: empty value`);
    raw[name] = value;
  }
  if (!raw.FREQ)
    throw new RRuleError("FREQ is required");
  if (!FREQS.includes(raw.FREQ))
    throw new RRuleError(`FREQ: ${raw.FREQ} is not supported (DAILY, WEEKLY, MONTHLY, YEARLY)`);
  const freq = raw.FREQ;
  const rule = { freq, interval: 1, wkst: 0 };
  if (raw.INTERVAL !== void 0)
    rule.interval = intIn("INTERVAL", raw.INTERVAL, 1, MAX_INTERVAL);
  if (raw.COUNT !== void 0 && raw.UNTIL !== void 0)
    throw new RRuleError("COUNT and UNTIL cannot both be given");
  if (raw.COUNT !== void 0)
    rule.count = intIn("COUNT", raw.COUNT, 1, MAX_COUNT);
  if (raw.UNTIL !== void 0)
    rule.until = untilOf(raw.UNTIL);
  if (raw.BYDAY !== void 0) {
    rule.byDay = list("BYDAY", raw.BYDAY, 7).map((item) => {
      const m = /^([+-]?\d)?(MO|TU|WE|TH|FR|SA|SU)$/.exec(item);
      if (!m)
        throw new RRuleError(`BYDAY: ${item} is not a weekday`);
      const weekday = WEEKDAYS.indexOf(m[2]);
      if (m[1] === void 0)
        return { weekday };
      if (freq !== "MONTHLY" && freq !== "YEARLY")
        throw new RRuleError(`BYDAY: ${item}: an ordinal needs FREQ=MONTHLY or YEARLY`);
      return { weekday, ordinal: intIn("BYDAY", m[1], -5, 5) };
    });
    const keys = rule.byDay.map((d) => `${d.ordinal ?? ""}${d.weekday}`);
    if (new Set(keys).size !== keys.length)
      throw new RRuleError("BYDAY: repeated day");
  }
  if (raw.BYMONTHDAY !== void 0) {
    if (freq !== "MONTHLY" && freq !== "YEARLY")
      throw new RRuleError("BYMONTHDAY needs FREQ=MONTHLY or YEARLY");
    rule.byMonthDay = list("BYMONTHDAY", raw.BYMONTHDAY, 31).map((v) => {
      const n = intIn("BYMONTHDAY", v, -1, 31);
      return n;
    });
    if (new Set(rule.byMonthDay).size !== rule.byMonthDay.length)
      throw new RRuleError("BYMONTHDAY: repeated day");
  }
  if (raw.BYMONTH !== void 0) {
    if (freq !== "YEARLY")
      throw new RRuleError("BYMONTH needs FREQ=YEARLY");
    rule.byMonth = list("BYMONTH", raw.BYMONTH, 12).map((v) => intIn("BYMONTH", v, 1, 12));
    if (new Set(rule.byMonth).size !== rule.byMonth.length)
      throw new RRuleError("BYMONTH: repeated month");
  }
  if (raw.BYSETPOS !== void 0) {
    if (freq !== "MONTHLY" || !rule.byDay)
      throw new RRuleError("BYSETPOS needs FREQ=MONTHLY and BYDAY");
    rule.bySetPos = intIn("BYSETPOS", raw.BYSETPOS, -5, 5);
  }
  if (raw.WKST !== void 0) {
    const w = WEEKDAYS.indexOf(raw.WKST);
    if (w < 0)
      throw new RRuleError(`WKST: ${raw.WKST} is not a weekday`);
    rule.wkst = w;
  }
  return rule;
}
function formatRRule(rule) {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval > 1)
    parts.push(`INTERVAL=${rule.interval}`);
  if (rule.byMonth?.length)
    parts.push(`BYMONTH=${rule.byMonth.join(",")}`);
  if (rule.byMonthDay?.length)
    parts.push(`BYMONTHDAY=${rule.byMonthDay.join(",")}`);
  if (rule.byDay?.length)
    parts.push(`BYDAY=${rule.byDay.map((d) => `${d.ordinal ?? ""}${WEEKDAYS[d.weekday]}`).join(",")}`);
  if (rule.bySetPos !== void 0)
    parts.push(`BYSETPOS=${rule.bySetPos}`);
  if (rule.count !== void 0)
    parts.push(`COUNT=${rule.count}`);
  if (rule.until !== void 0)
    parts.push(`UNTIL=${rule.until.length === 10 ? rule.until.replace(/-/g, "") : rule.until.replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`);
  if (rule.wkst !== 0)
    parts.push(`WKST=${WEEKDAYS[rule.wkst]}`);
  return parts.join(";");
}
function isDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m)
    return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  return y >= 1 && mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}
const isLeap = (y) => y % 4 === 0 && y % 100 !== 0 || y % 400 === 0;
function daysInMonth(y, m) {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}
const dayNumber = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / 864e5);
function dayOf(date) {
  return dayNumber(+date.slice(0, 4), +date.slice(5, 7), +date.slice(8, 10));
}
function dateOf(day) {
  return new Date(day * 864e5).toISOString().slice(0, 10);
}
function ymdOf(day) {
  const t = new Date(day * 864e5);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
const weekdayOf = (day) => ((day + 3) % 7 + 7) % 7;
const formatters = /* @__PURE__ */ new Map();
function formatter(tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    formatters.set(tz, f);
  }
  return f;
}
function isTimeZone(tz) {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}
function zonedParts(ms, tz) {
  const parts = {};
  for (const p of formatter(tz).formatToParts(new Date(ms)))
    if (p.type !== "literal")
      parts[p.type] = Number(p.value);
  return { y: parts.year, m: parts.month, d: parts.day, h: parts.hour === 24 ? 0 : parts.hour, mi: parts.minute, s: parts.second };
}
function offsetMs(ms, tz) {
  const p = zonedParts(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1e3) * 1e3;
}
function zonedToUtc(day, minuteOfDay, secondOfMinute, tz) {
  const local = day * 864e5 + minuteOfDay * 6e4 + secondOfMinute * 1e3;
  const first = local - offsetMs(local, tz);
  const second = local - offsetMs(first, tz);
  return second !== first && local - offsetMs(second, tz) !== second ? Math.max(first, second) : second;
}
function localDay(ms, tz) {
  const p = zonedParts(ms, tz);
  return dayNumber(p.y, p.m, p.d);
}
const MAX_PERIODS = 2e5;
function candidates(rule, period, startDay) {
  const s = ymdOf(startDay);
  const out = [];
  const byDayAll = (day0, len, wanted) => {
    for (let i = 0; i < len; i++)
      if (wanted.some((w) => w.ordinal === void 0 && w.weekday === weekdayOf(day0 + i)))
        out.push(day0 + i);
  };
  const nth = (day0, len, w) => {
    const days = [];
    for (let i = 0; i < len; i++)
      if (weekdayOf(day0 + i) === w.weekday)
        days.push(day0 + i);
    const k = w.ordinal > 0 ? w.ordinal - 1 : days.length + w.ordinal;
    if (k >= 0 && k < days.length)
      out.push(days[k]);
  };
  const monthDays = (y, m, list2) => {
    const n = daysInMonth(y, m);
    for (const d of list2) {
      const day = d > 0 ? d : n + d + 1;
      if (day >= 1 && day <= n)
        out.push(dayNumber(y, m, day));
    }
  };
  switch (rule.freq) {
    case "DAILY": {
      const day = startDay + period * rule.interval;
      const { m, d } = ymdOf(day);
      if (rule.byMonth && !rule.byMonth.includes(m))
        break;
      if (rule.byMonthDay && !rule.byMonthDay.some((x) => x > 0 ? x === d : daysInMonth(ymdOf(day).y, m) + x + 1 === d))
        break;
      if (rule.byDay && !rule.byDay.some((w) => w.weekday === weekdayOf(day)))
        break;
      out.push(day);
      break;
    }
    case "WEEKLY": {
      const weekStart = startDay - (weekdayOf(startDay) - rule.wkst + 7) % 7 + period * rule.interval * 7;
      const wanted = rule.byDay ?? [{ weekday: weekdayOf(startDay) }];
      byDayAll(weekStart, 7, wanted);
      if (rule.byMonth)
        return out.filter((d) => rule.byMonth.includes(ymdOf(d).m)).sort((a, b) => a - b);
      break;
    }
    case "MONTHLY": {
      const index = s.y * 12 + (s.m - 1) + period * rule.interval;
      const y = Math.floor(index / 12), m = index % 12 + 1;
      const day0 = dayNumber(y, m, 1), len = daysInMonth(y, m);
      if (rule.byMonthDay) {
        monthDays(y, m, rule.byMonthDay);
        if (rule.byDay) {
          const keep = out.filter((d) => rule.byDay.some((w) => w.weekday === weekdayOf(d)));
          out.length = 0;
          out.push(...keep);
        }
      } else if (rule.byDay) {
        byDayAll(day0, len, rule.byDay);
        for (const w of rule.byDay)
          if (w.ordinal !== void 0)
            nth(day0, len, w);
      } else if (s.d <= len)
        out.push(dayNumber(y, m, s.d));
      break;
    }
    case "YEARLY": {
      const y = s.y + period * rule.interval;
      if (rule.byDay && !rule.byMonth && !rule.byMonthDay) {
        const day0 = dayNumber(y, 1, 1), len = isLeap(y) ? 366 : 365;
        byDayAll(day0, len, rule.byDay);
        for (const w of rule.byDay)
          if (w.ordinal !== void 0)
            nth(day0, len, w);
        break;
      }
      const months = rule.byMonth ?? [s.m];
      for (const m of months) {
        if (rule.byMonthDay)
          monthDays(y, m, rule.byMonthDay);
        else if (rule.byDay) {
          const day0 = dayNumber(y, m, 1), len = daysInMonth(y, m);
          byDayAll(day0, len, rule.byDay);
          for (const w of rule.byDay)
            if (w.ordinal !== void 0)
              nth(day0, len, w);
        } else if (s.d <= daysInMonth(y, m))
          out.push(dayNumber(y, m, s.d));
      }
      if (rule.byMonthDay && rule.byDay) {
        const keep = out.filter((d) => rule.byDay.some((w) => w.weekday === weekdayOf(d)));
        out.length = 0;
        out.push(...keep);
      }
      break;
    }
  }
  const sorted = [...new Set(out)].sort((a, b) => a - b);
  if (rule.bySetPos !== void 0) {
    const k = rule.bySetPos > 0 ? rule.bySetPos - 1 : sorted.length + rule.bySetPos;
    return k >= 0 && k < sorted.length ? [sorted[k]] : [];
  }
  return sorted;
}
function periodStart(rule, p, startDay) {
  const s = ymdOf(startDay);
  switch (rule.freq) {
    case "DAILY":
      return startDay + p * rule.interval;
    case "WEEKLY":
      return startDay - (weekdayOf(startDay) - rule.wkst + 7) % 7 + p * rule.interval * 7;
    case "MONTHLY": {
      const index = s.y * 12 + (s.m - 1) + p * rule.interval;
      return dayNumber(Math.floor(index / 12), index % 12 + 1, 1);
    }
    case "YEARLY":
      return dayNumber(s.y + p * rule.interval, 1, 1);
  }
}
function periodsBefore(rule, startDay, day) {
  const s = ymdOf(startDay);
  const t = ymdOf(day);
  let p;
  switch (rule.freq) {
    case "DAILY":
      p = Math.floor((day - startDay) / rule.interval);
      break;
    case "WEEKLY":
      p = Math.floor((day - periodStart(rule, 0, startDay)) / (7 * rule.interval));
      break;
    case "MONTHLY":
      p = Math.floor((t.y * 12 + t.m - (s.y * 12 + s.m)) / rule.interval);
      break;
    case "YEARLY":
      p = Math.floor((t.y - s.y) / rule.interval);
      break;
  }
  return Math.max(-1, p - 1);
}
function expandSeries(rule, start, window, opts = {}) {
  const limit = opts.limit ?? 2e3;
  const excluded = new Set(opts.exdate ?? []);
  const out = [];
  let startDay;
  let minute = 0, second = 0;
  let tz = "UTC";
  let fromDay, toDay;
  const viewerTz = opts.viewerTz ?? "UTC";
  if (start.kind === "date") {
    startDay = dayOf(start.date);
    fromDay = localDay(window.fromMs, viewerTz) - (opts.durationDays ?? 0);
    toDay = localDay(window.toMs - 1, viewerTz);
  } else {
    tz = start.tz;
    const ms = Date.parse(start.utc);
    const p = zonedParts(ms, tz);
    startDay = dayNumber(p.y, p.m, p.d);
    minute = p.h * 60 + p.mi;
    second = p.s;
    fromDay = localDay(window.fromMs - (opts.durationMs ?? 0), tz) - 1;
    toDay = localDay(window.toMs, tz) + 1;
  }
  const untilDay = rule.until?.length === 10 ? dayOf(rule.until) : void 0;
  const untilMs = rule.until && rule.until.length > 10 ? Date.parse(rule.until) : void 0;
  let count = 0;
  const emit = (day) => {
    if (rule.count !== void 0 && count >= rule.count)
      return false;
    if (untilDay !== void 0 && day > untilDay)
      return false;
    let occ;
    if (start.kind === "date") {
      if (untilMs !== void 0 && day * 864e5 > untilMs)
        return false;
      const date = dateOf(day);
      occ = { original: date, date };
    } else {
      const firstMs = Date.parse(start.utc);
      const ms = day === startDay ? firstMs : zonedToUtc(day, minute, second, tz) + new Date(firstMs).getUTCMilliseconds();
      if (untilMs !== void 0 && ms > untilMs)
        return false;
      occ = { original: new Date(ms).toISOString(), startMs: ms };
    }
    count += 1;
    if (excluded.has(occ.original))
      return true;
    if (start.kind === "date") {
      if (day >= fromDay && day <= toDay)
        out.push(occ);
    } else if (occ.startMs + (opts.durationMs ?? 0) > window.fromMs && occ.startMs < window.toMs)
      out.push(occ);
    return true;
  };
  if (startDay > toDay || !emit(startDay))
    return out;
  let period = rule.count === void 0 ? periodsBefore(rule, startDay, fromDay) + 1 : 0;
  for (let guard = 0; guard < MAX_PERIODS && out.length < limit; guard++, period++) {
    if (periodStart(rule, period, startDay) > toDay)
      return out;
    for (const day of candidates(rule, period, startDay)) {
      if (day <= startDay)
        continue;
      if (day > toDay)
        return out;
      if (!emit(day))
        return out;
      if (out.length >= limit) {
        opts.onTruncated?.();
        return out;
      }
    }
  }
  if (periodStart(rule, period, startDay) <= toDay)
    opts.onTruncated?.();
  return out;
}
function seriesStartOf(values, tz, fallbackTz = "UTC") {
  if (values.all_day === true)
    return typeof values.start_date === "string" ? { kind: "date", date: values.start_date } : null;
  return typeof values.start === "string" ? { kind: "datetime", utc: values.start, tz: tz && isTimeZone(tz) ? tz : fallbackTz } : null;
}
function occurrenceId(recordId, original) {
  return `${recordId}@${original}`;
}
const TODO_SCHEMA_ID = "buckyos.todo@1";
const CALENDAR_SCHEMA_ID = "buckyos.calendar@1";
const SCHEDULE_WORKSPACE_NAME = "schedule";
const SCHEDULE_TODO_ID = "todo";
const SCHEDULE_CALENDAR_ID = "calendar";
const SCHEDULE_SURFACE_ID = "schedule-board";
const TODO_DONE = "done";
const AIWS_PROTOCOL_VERSION = "1.2";
const LABELS = {
  zh: {
    title: "标题",
    status: "状态",
    due: "截止",
    order: "顺序",
    done_at: "完成时间",
    ext: "扩展",
    todo: "待办",
    doing: "进行中",
    done: "已完成",
    all_day: "全天",
    start: "开始",
    end: "结束",
    start_date: "开始日期",
    end_date: "结束日期",
    confirmed: "已确认",
    tentative: "暂定",
    cancelled: "已取消",
    todo_table: "待办",
    calendar_table: "日程",
    workspace: "我的日程",
    board: "日程"
  },
  en: {
    title: "Title",
    status: "Status",
    due: "Due",
    order: "Order",
    done_at: "Completed",
    ext: "Extension",
    todo: "To do",
    doing: "In progress",
    done: "Done",
    all_day: "All day",
    start: "Start",
    end: "End",
    start_date: "Start date",
    end_date: "End date",
    confirmed: "Confirmed",
    tentative: "Tentative",
    cancelled: "Cancelled",
    todo_table: "To-do",
    calendar_table: "Calendar",
    workspace: "My schedule",
    board: "Schedule"
  },
  "zh-TW": {
    title: "標題",
    status: "狀態",
    due: "截止",
    order: "順序",
    done_at: "完成時間",
    ext: "擴充",
    todo: "待辦",
    doing: "進行中",
    done: "已完成",
    all_day: "全天",
    start: "開始",
    end: "結束",
    start_date: "開始日期",
    end_date: "結束日期",
    confirmed: "已確認",
    tentative: "暫定",
    cancelled: "已取消",
    todo_table: "待辦事項",
    calendar_table: "行程",
    workspace: "我的行程",
    board: "行程"
  },
  ja: {
    title: "タイトル",
    status: "ステータス",
    due: "期限",
    order: "順序",
    done_at: "完了日時",
    ext: "拡張",
    todo: "未着手",
    doing: "進行中",
    done: "完了",
    all_day: "終日",
    start: "開始",
    end: "終了",
    start_date: "開始日",
    end_date: "終了日",
    confirmed: "確定",
    tentative: "仮",
    cancelled: "キャンセル",
    todo_table: "ToDo",
    calendar_table: "予定",
    workspace: "マイスケジュール",
    board: "スケジュール"
  },
  ko: {
    title: "제목",
    status: "상태",
    due: "마감",
    order: "순서",
    done_at: "완료 시각",
    ext: "확장",
    todo: "할 일",
    doing: "진행 중",
    done: "완료",
    all_day: "종일",
    start: "시작",
    end: "종료",
    start_date: "시작일",
    end_date: "종료일",
    confirmed: "확정",
    tentative: "미정",
    cancelled: "취소됨",
    todo_table: "할 일",
    calendar_table: "일정",
    workspace: "내 일정",
    board: "일정"
  },
  fr: {
    title: "Titre",
    status: "Statut",
    due: "Échéance",
    order: "Ordre",
    done_at: "Terminé le",
    ext: "Extension",
    todo: "À faire",
    doing: "En cours",
    done: "Terminé",
    all_day: "Toute la journée",
    start: "Début",
    end: "Fin",
    start_date: "Date de début",
    end_date: "Date de fin",
    confirmed: "Confirmé",
    tentative: "Provisoire",
    cancelled: "Annulé",
    todo_table: "Tâches",
    calendar_table: "Calendrier",
    workspace: "Mon agenda",
    board: "Agenda"
  },
  de: {
    title: "Titel",
    status: "Status",
    due: "Fällig",
    order: "Reihenfolge",
    done_at: "Erledigt am",
    ext: "Erweiterung",
    todo: "Offen",
    doing: "In Arbeit",
    done: "Erledigt",
    all_day: "Ganztägig",
    start: "Beginn",
    end: "Ende",
    start_date: "Startdatum",
    end_date: "Enddatum",
    confirmed: "Bestätigt",
    tentative: "Vorläufig",
    cancelled: "Abgesagt",
    todo_table: "Aufgaben",
    calendar_table: "Kalender",
    workspace: "Mein Terminplan",
    board: "Terminplan"
  },
  es: {
    title: "Título",
    status: "Estado",
    due: "Vencimiento",
    order: "Orden",
    done_at: "Completado el",
    ext: "Extensión",
    todo: "Pendiente",
    doing: "En curso",
    done: "Hecho",
    all_day: "Todo el día",
    start: "Inicio",
    end: "Fin",
    start_date: "Fecha de inicio",
    end_date: "Fecha de fin",
    confirmed: "Confirmado",
    tentative: "Provisional",
    cancelled: "Cancelado",
    todo_table: "Tareas",
    calendar_table: "Calendario",
    workspace: "Mi agenda",
    board: "Agenda"
  },
  ru: {
    title: "Название",
    status: "Статус",
    due: "Срок",
    order: "Порядок",
    done_at: "Выполнено",
    ext: "Расширение",
    todo: "К выполнению",
    doing: "В работе",
    done: "Готово",
    all_day: "Весь день",
    start: "Начало",
    end: "Конец",
    start_date: "Дата начала",
    end_date: "Дата окончания",
    confirmed: "Подтверждено",
    tentative: "Предварительно",
    cancelled: "Отменено",
    todo_table: "Задачи",
    calendar_table: "Календарь",
    workspace: "Моё расписание",
    board: "Расписание"
  }
};
function scheduleLabel(locale, key) {
  return LABELS[locale]?.[key] ?? LABELS.en[key] ?? key;
}
function todoFields(locale = "zh") {
  const l = (k) => scheduleLabel(locale, k);
  return [
    { field_id: "title", name: l("title"), type: "text", required: true },
    { field_id: "status", name: l("status"), type: "select", required: true, options: ["todo", "doing", "done"].map((id) => ({ option_id: id, label: l(id) })) },
    { field_id: "due", name: l("due"), type: "date", nullable: true },
    { field_id: "order", name: l("order"), type: "text", nullable: true },
    { field_id: "done_at", name: l("done_at"), type: "datetime", nullable: true },
    { field_id: "ext", name: l("ext"), type: "json", nullable: true }
  ];
}
function calendarFields(locale = "zh") {
  const l = (k) => scheduleLabel(locale, k);
  return [
    { field_id: "title", name: l("title"), type: "text", required: true },
    { field_id: "all_day", name: l("all_day"), type: "boolean", nullable: true },
    { field_id: "start", name: l("start"), type: "datetime", nullable: true },
    { field_id: "end", name: l("end"), type: "datetime", nullable: true },
    { field_id: "start_date", name: l("start_date"), type: "date", nullable: true },
    { field_id: "end_date", name: l("end_date"), type: "date", nullable: true },
    { field_id: "status", name: l("status"), type: "select", nullable: true, options: ["confirmed", "tentative", "cancelled"].map((id) => ({ option_id: id, label: l(id) })) },
    { field_id: "ext", name: l("ext"), type: "json", nullable: true }
  ];
}
function standardTableOp(kind, args) {
  const locale = args.locale ?? "zh";
  return {
    op: "entity.create",
    entity_id: args.entity_id,
    type_id: "buckyos.table-source",
    parent_id: args.parent_id,
    order_key: args.order_key,
    schema_id: kind === "todo" ? TODO_SCHEMA_ID : CALENDAR_SCHEMA_ID,
    name: args.name ?? scheduleLabel(locale, kind === "todo" ? "todo_table" : "calendar_table"),
    payload: { title_field_id: "title", fields: kind === "todo" ? todoFields(locale) : calendarFields(locale) }
  };
}
const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";
const MAX_KEY_LEN = 64;
const APPEND_WIDTH = 8;
function isOrderKey(k) {
  return typeof k === "string" && k.length > 0 && k.length <= MAX_KEY_LEN && /^[0-9a-z]+$/.test(k) && !k.endsWith("0");
}
function midpoint(a, b) {
  if (b !== null) {
    let n = 0;
    while (n < b.length && (a[n] ?? "0") === b[n])
      n++;
    if (n > 0)
      return b.slice(0, n) + midpoint(a.length > n ? a.slice(n) : "", b.slice(n));
  }
  const da = a.length ? DIGITS.indexOf(a[0]) : 0;
  const db = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length;
  if (db - da > 1)
    return DIGITS[Math.floor((da + db + 1) / 2)];
  if (b !== null && b.length > 1)
    return b[0];
  return DIGITS[da] + midpoint(a.length > 1 ? a.slice(1) : "", null);
}
function after(a) {
  const out = a.padEnd(Math.max(a.length, APPEND_WIDTH), "0").split("");
  let i = out.length - 1;
  while (i >= 0 && out[i] === "z")
    i--;
  if (i >= 0) {
    out[i] = DIGITS[DIGITS.indexOf(out[i]) + 1];
    for (let j = i + 1; j < out.length; j++)
      out[j] = "0";
    if (out[out.length - 1] === "0")
      out[out.length - 1] = "1";
    return out.join("");
  }
  if (out.length >= MAX_KEY_LEN)
    throw new Error("order key space exhausted; rebalance");
  const longer = out.join("").padEnd(Math.min(out.length + APPEND_WIDTH, MAX_KEY_LEN), "0");
  return longer.slice(0, -1) + "1";
}
function orderKeyBetween(a, b) {
  const lo = a ?? null, hi = b ?? null;
  if (lo !== null && hi !== null && lo >= hi)
    throw new Error("orderKeyBetween requires a < b");
  const key = lo !== null && hi === null ? after(lo) : midpoint(lo ?? "", hi);
  if (!isOrderKey(key))
    throw new Error("order key space exhausted; rebalance");
  return key;
}
let counter = 0;
function newRecordId(prefix = "r") {
  counter = (counter + 1) % 1296;
  const rand = Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, "0");
  return `${prefix}${Date.now().toString(36)}${counter.toString(36).padStart(2, "0")}${rand}`;
}
function setValuesOps(sourceId, row, changes) {
  const set = [];
  const unset = [];
  for (const [field, value] of Object.entries(changes)) {
    const cell = { record_id: row.record_id, field_id: field, expect: { rev: row.revs?.[field] ?? 0 } };
    if (value === null || value === void 0) {
      if (row.values[field] !== void 0 && row.values[field] !== null)
        unset.push(cell);
    } else {
      set.push({ ...cell, value });
    }
  }
  const out = [];
  if (set.length)
    out.push({ op: "table.set_values", source_id: sourceId, values: set });
  if (unset.length)
    out.push({ op: "table.unset_values", source_id: sourceId, values: unset });
  return out;
}
function insertRecordOp(sourceId, records) {
  return {
    op: "table.insert_records",
    source_id: sourceId,
    records: records.map((r) => ({ record_id: r.record_id, values: Object.fromEntries(Object.entries(r.values).filter(([, v]) => v !== void 0 && v !== null)) }))
  };
}
function deleteRecordsOp(sourceId, rows) {
  return { op: "table.delete_records", source_id: sourceId, records: rows.map((r) => ({ record_id: r.record_id, expect: { rev: r.rev ?? 0 } })) };
}
function canonicalOriginal(x) {
  if (isDate(x))
    return x;
  const t = Date.parse(x);
  return Number.isFinite(t) ? new Date(t).toISOString() : x;
}
const originals = (v) => Array.isArray(v) ? v.filter((x) => typeof x === "string").map(canonicalOriginal) : [];
const extOf = (row) => {
  const e = row?.values.ext;
  return e && typeof e === "object" && !Array.isArray(e) ? { ...e } : {};
};
function todoItem(row) {
  const v = row.values;
  const status = typeof v.status === "string" ? v.status : "todo";
  return {
    record_id: row.record_id,
    rev: row.rev,
    revs: row.revs,
    values: row.values,
    title: typeof v.title === "string" ? v.title : "",
    status,
    due: typeof v.due === "string" ? v.due : null,
    order: isOrderKey(v.order) ? v.order : null,
    done: status === TODO_DONE,
    done_at: typeof v.done_at === "string" ? v.done_at : null,
    ext: extOf(row)
  };
}
function sortTodos(items) {
  return [...items].sort((a, b) => a.order === b.order ? a.record_id.localeCompare(b.record_id) : a.order === null ? 1 : b.order === null ? -1 : a.order < b.order ? -1 : 1);
}
function todoAddOps(sourceId, input, place = {}) {
  const record_id = input.record_id ?? newRecordId("t");
  let order = input.order ?? null;
  if (!order) {
    if (place.after !== void 0 || place.before !== void 0)
      order = orderKeyBetween(place.after ?? null, place.before ?? null);
    else {
      const last = (place.items ?? []).map((i) => i.order).filter(isOrderKey).sort().pop() ?? null;
      order = orderKeyBetween(last, null);
    }
  }
  const status = input.status ?? "todo";
  const values = {
    title: input.title,
    status,
    order,
    due: input.due ?? void 0,
    ext: input.ext && Object.keys(input.ext).length ? input.ext : void 0,
    done_at: status === TODO_DONE ? input.done_at ?? (/* @__PURE__ */ new Date()).toISOString() : void 0
  };
  return { record_id, order, ops: [insertRecordOp(sourceId, [{ record_id, values }])] };
}
function todoCompleteOps(sourceId, row, done, opts = {}) {
  if (done)
    return setValuesOps(sourceId, row, { status: TODO_DONE, done_at: opts.now ?? (/* @__PURE__ */ new Date()).toISOString() });
  return setValuesOps(sourceId, row, { status: opts.reopenStatus ?? "todo", done_at: null });
}
function todoMoveOps(sourceId, row, to, opts = {}) {
  const changes = {};
  const was = typeof row.values.status === "string" ? row.values.status : void 0;
  if (to.status !== void 0 && to.status !== was) {
    changes.status = to.status;
    if (to.status === TODO_DONE)
      changes.done_at = opts.now ?? (/* @__PURE__ */ new Date()).toISOString();
    else if (was === TODO_DONE)
      changes.done_at = null;
  }
  if (to.order !== void 0 && to.order !== row.values.order)
    changes.order = to.order;
  return Object.keys(changes).length ? setValuesOps(sourceId, row, changes) : [];
}
function todoUpdateOps(sourceId, row, changes) {
  const out = {};
  for (const k of ["title", "status", "due", "order", "done_at"])
    if (changes[k] !== void 0)
      out[k] = changes[k];
  if (changes.ext !== void 0)
    out.ext = changes.ext && Object.keys(changes.ext).length ? changes.ext : null;
  if (changes.ext_merge) {
    const ext = extOf(row);
    for (const [k, v] of Object.entries(changes.ext_merge))
      if (v === null)
        delete ext[k];
      else
        ext[k] = v;
    out.ext = Object.keys(ext).length ? ext : null;
  }
  if (out.status !== void 0 && out.status !== row.values.status && out.done_at === void 0) {
    if (out.status === TODO_DONE)
      out.done_at = (/* @__PURE__ */ new Date()).toISOString();
    else if (row.values.status === TODO_DONE)
      out.done_at = null;
  }
  return setValuesOps(sourceId, row, out);
}
function orderAt(items, index) {
  const keys = items.map((i) => i.order);
  const before = index > 0 ? keys[index - 1] : null;
  const afterKey = index < keys.length ? keys[index] : null;
  if (before !== null && !isOrderKey(before))
    return orderKeyBetween(null, null);
  if (afterKey !== null && isOrderKey(afterKey) && (before === null || before < afterKey))
    return orderKeyBetween(before, afterKey);
  return orderKeyBetween(before, null);
}
const DEFAULT_EVENT_MS = 36e5;
function rowTimes(row) {
  const v = row.values;
  if (v.all_day === true) {
    if (typeof v.start_date !== "string" || !isDate(v.start_date))
      return null;
    const endDate = typeof v.end_date === "string" && isDate(v.end_date) && v.end_date >= v.start_date ? v.end_date : v.start_date;
    return { allDay: true, startDate: v.start_date, endDate };
  }
  if (typeof v.start !== "string")
    return null;
  const startMs = Date.parse(v.start);
  if (!Number.isFinite(startMs))
    return null;
  const end = typeof v.end === "string" ? Date.parse(v.end) : NaN;
  return { allDay: false, startMs, endMs: Number.isFinite(end) && end >= startMs ? end : startMs + DEFAULT_EVENT_MS };
}
function addDays(date, n) {
  return dateOf(dayOf(date) + n);
}
const daysBetween = (a, b) => dayOf(b) - dayOf(a);
function occurrenceOf(row, times2, extra) {
  const ext = extOf(row);
  return {
    id: row.record_id,
    row,
    title: typeof row.values.title === "string" ? row.values.title : "",
    allDay: times2.allDay,
    startMs: times2.startMs,
    endMs: times2.endMs,
    startDate: times2.startDate,
    endDate: times2.endDate,
    status: typeof row.values.status === "string" ? row.values.status : null,
    ext,
    recurring: false,
    override: false,
    agentWritten: false,
    ...extra
  };
}
function overlaps(o, window, viewerTz) {
  if (!o.allDay)
    return o.startMs < window.toMs && Math.max(o.endMs, o.startMs + 1) > window.fromMs;
  const from = localDate(window.fromMs, viewerTz), to = localDate(window.toMs - 1, viewerTz);
  return o.startDate <= to && o.endDate >= from;
}
function localDate(ms, tz) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  return f.format(new Date(ms));
}
function viewerTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
function calendarOccurrences(rows, window, opts = {}) {
  const viewerTz = opts.viewerTz ?? viewerTimeZone();
  const out = [];
  const overrides = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const rid = extOf(row).recurrence_id;
    if (rid && typeof rid === "object" && !Array.isArray(rid) && typeof rid.master === "string" && typeof rid.original === "string")
      overrides.set(`${rid.master}@${canonicalOriginal(rid.original)}`, row);
  }
  const byId = new Map(rows.map((r) => [r.record_id, r]));
  for (const row of rows) {
    const times2 = rowTimes(row);
    if (!times2)
      continue;
    const ext = extOf(row);
    const rid = ext.recurrence_id;
    if (rid && typeof rid === "object") {
      const master = typeof rid.master === "string" ? byId.get(rid.master) : void 0;
      const original = typeof rid.original === "string" ? canonicalOriginal(rid.original) : void 0;
      const occ2 = occurrenceOf(row, times2, { id: master && original ? occurrenceId(master.record_id, original) : row.record_id, master, original, recurring: Boolean(master), override: true });
      if (overlaps(occ2, window, viewerTz))
        out.push(occ2);
      continue;
    }
    const duration = times2.allDay ? daysBetween(times2.startDate, times2.endDate) : times2.endMs - times2.startMs;
    const shift = (o) => {
      const key = `${row.record_id}@${o.original}`;
      if (overrides.has(key))
        return null;
      if (times2.allDay)
        return occurrenceOf(row, { allDay: true, startDate: o.date, endDate: addDays(o.date, duration) }, { id: key, master: row, original: o.original, recurring: true });
      return occurrenceOf(row, { allDay: false, startMs: o.startMs, endMs: o.startMs + duration }, { id: key, master: row, original: o.original, recurring: true });
    };
    let rule = null;
    if (typeof ext.rrule === "string") {
      try {
        rule = parseRRule(ext.rrule);
      } catch {
        rule = null;
      }
    }
    if (rule) {
      const start = seriesStartOf(row.values, typeof ext.tz === "string" ? ext.tz : void 0, viewerTz);
      if (!start)
        continue;
      const exdate = originals(ext.exdate);
      const occs = expandSeries(rule, start, window, { exdate, viewerTz, durationMs: times2.allDay ? void 0 : duration, durationDays: times2.allDay ? duration : void 0, limit: opts.limit, onTruncated: opts.onTruncated });
      for (const o of occs) {
        const s = shift(o);
        if (s)
          out.push(s);
      }
      continue;
    }
    if (Array.isArray(ext.occurrences) && ext.occurrences.length > 0) {
      const exdate = new Set(originals(ext.exdate));
      for (const raw of ext.occurrences) {
        if (typeof raw !== "string")
          continue;
        const x = canonicalOriginal(raw);
        if (exdate.has(x))
          continue;
        const o = times2.allDay ? { original: x, date: x } : { original: x, startMs: Date.parse(x) };
        if (!times2.allDay && !Number.isFinite(o.startMs))
          continue;
        if (times2.allDay && !isDate(x))
          continue;
        const s = shift(o);
        if (s && overlaps(s, window, viewerTz))
          out.push({ ...s, agentWritten: true });
      }
      continue;
    }
    const occ = occurrenceOf(row, times2, {});
    if (overlaps(occ, window, viewerTz))
      out.push(occ);
  }
  return out.sort((a, b) => sortKey(a) - sortKey(b) || a.id.localeCompare(b.id));
}
const sortKey = (o) => o.allDay ? Date.parse(`${o.startDate}T00:00:00Z`) : o.startMs;
function eventAddOps(sourceId, input) {
  const record_id = input.record_id ?? newRecordId("e");
  const values = { title: input.title, status: input.status ?? void 0, ext: input.ext && Object.keys(input.ext).length ? input.ext : void 0 };
  if (input.all_day) {
    values.all_day = true;
    values.start_date = input.start_date ?? void 0;
    values.end_date = input.end_date && input.end_date !== input.start_date ? input.end_date : void 0;
  } else {
    values.start = input.start ?? void 0;
    values.end = input.end ?? void 0;
  }
  return { record_id, ops: [insertRecordOp(sourceId, [{ record_id, values }])] };
}
function timesChanges(times2) {
  return times2.allDay ? { all_day: true, start_date: times2.startDate, end_date: times2.endDate !== times2.startDate ? times2.endDate : null, start: null, end: null } : { all_day: null, start: times2.start, end: times2.end, start_date: null, end_date: null };
}
function overridesOf(rows, masterId) {
  return rows.filter((r) => {
    const rid = extOf(r).recurrence_id;
    return rid && typeof rid === "object" && rid.master === masterId;
  });
}
const isoShift = (iso, deltaMs) => new Date(Date.parse(iso) + deltaMs).toISOString();
function shiftOriginal(original, allDay, deltaMs, deltaDays) {
  return allDay ? addDays(original, deltaDays) : isoShift(original, deltaMs);
}
function shiftRule(rule, deltaDays) {
  if (!deltaDays)
    return rule;
  const next = { ...rule };
  if (rule.byDay && rule.byDay.every((d) => d.ordinal === void 0) && (rule.freq === "WEEKLY" || rule.freq === "DAILY")) {
    next.byDay = rule.byDay.map((d) => ({ weekday: ((d.weekday + deltaDays) % 7 + 7) % 7 }));
  } else if (rule.byDay && rule.freq === "MONTHLY" && rule.byDay.length === 1 && rule.bySetPos === void 0 && Math.abs(deltaDays) < 7) {
    next.byDay = [{ ...rule.byDay[0], weekday: ((rule.byDay[0].weekday + deltaDays) % 7 + 7) % 7 }];
  } else if (rule.byMonthDay && rule.byMonthDay.length === 1 && rule.byMonthDay[0] > 0) {
    const d = rule.byMonthDay[0] + deltaDays;
    if (d >= 1 && d <= 28)
      next.byMonthDay = [d];
  }
  return next;
}
function eventEditOps(sourceId, occ, change, scope, ctx) {
  const newId = ctx.newRecordId ?? (() => newRecordId("e"));
  const fieldChanges = (row) => {
    const out = { ...change.values };
    if (change.ext_merge) {
      const ext = extOf(row);
      for (const [k, v] of Object.entries(change.ext_merge))
        if (v === null)
          delete ext[k];
        else
          ext[k] = v;
      out.ext = Object.keys(ext).length ? ext : null;
    }
    return out;
  };
  const master = occ.master;
  if (!master || occ.row !== master && scope === "one") {
    const row = occ.row;
    const changes = { ...fieldChanges(row), ...change.times ? timesChanges(change.times) : {} };
    if (change.rrule !== void 0 && !master) {
      const ext = changes.ext ?? extOf(row);
      const next = { ...ext ?? {} };
      if (change.rrule === null)
        delete next.rrule;
      else
        next.rrule = formatRRule(parseRRule(change.rrule));
      if (change.rrule === null)
        delete next.exdate;
      changes.ext = Object.keys(next).length ? next : null;
    }
    return { ops: setValuesOps(sourceId, row, changes), record_id: row.record_id };
  }
  const original = occ.original;
  const masterTimes = rowTimes(master);
  const masterExt = extOf(master);
  if (scope === "one") {
    const id2 = newId();
    const ext = { ...masterExt, recurrence_id: { master: master.record_id, original } };
    delete ext.rrule;
    delete ext.exdate;
    delete ext.occurrences;
    delete ext.rule_text;
    delete ext.covered_until;
    delete ext.maintenance;
    const base = { title: master.values.title, status: master.values.status, ext };
    const times22 = change.times ?? (occ.allDay ? { allDay: true, startDate: occ.startDate, endDate: addDays(occ.startDate, daysBetween(masterTimes.startDate, masterTimes.endDate)) } : { allDay: false, start: new Date(occ.startMs).toISOString(), end: new Date(occ.startMs + (masterTimes.endMs - masterTimes.startMs)).toISOString() });
    const values2 = { ...base, ...fieldChanges({ record_id: id2, values: { ext } }), ...timesChanges(times22) };
    if (!values2.ext)
      values2.ext = ext;
    return { ops: [insertRecordOp(sourceId, [{ record_id: id2, values: values2 }])], record_id: id2 };
  }
  let deltaMs = 0, deltaDays = 0;
  let durationMs = masterTimes.allDay ? 0 : masterTimes.endMs - masterTimes.startMs;
  let durationDays = masterTimes.allDay ? daysBetween(masterTimes.startDate, masterTimes.endDate) : 0;
  if (change.times) {
    if (change.times.allDay !== masterTimes.allDay)
      throw new Error("changing a series between all-day and timed: edit the series itself (scope all) with new times");
    if (change.times.allDay) {
      deltaDays = daysBetween(original, change.times.startDate);
      durationDays = daysBetween(change.times.startDate, change.times.endDate);
    } else {
      deltaMs = Date.parse(change.times.start) - Date.parse(original);
      deltaDays = Math.round(deltaMs / 864e5);
      durationMs = Date.parse(change.times.end) - Date.parse(change.times.start);
    }
  }
  const rule = typeof masterExt.rrule === "string" ? parseRRule(masterExt.rrule) : null;
  const overrides = overridesOf(ctx.rows, master.record_id);
  const exdate = originals(masterExt.exdate);
  const isFirst = masterTimes.allDay ? original === masterTimes.startDate : original === new Date(masterTimes.startMs).toISOString();
  const seriesTimes = (startMs, startDate) => masterTimes.allDay ? { allDay: true, startDate: addDays(startDate, deltaDays), endDate: addDays(addDays(startDate, deltaDays), durationDays) } : { allDay: false, start: new Date(startMs + deltaMs).toISOString(), end: new Date(startMs + deltaMs + durationMs).toISOString() };
  const nextRule = (r) => {
    if (change.rrule !== void 0)
      return change.rrule === null ? null : formatRRule(parseRRule(change.rrule));
    return r ? formatRRule(shiftRule(r, deltaDays)) : null;
  };
  const ops = [];
  if (scope === "all" || isFirst) {
    const times22 = seriesTimes(masterTimes.startMs, masterTimes.startDate);
    const ext = { ...masterExt };
    const r = nextRule(rule);
    if (r)
      ext.rrule = r;
    else {
      delete ext.rrule;
      delete ext.exdate;
    }
    if (r && exdate.length)
      ext.exdate = exdate.map((x) => shiftOriginal(x, masterTimes.allDay, deltaMs, deltaDays));
    const fc2 = fieldChanges({ record_id: master.record_id, values: { ext } });
    const extOut = fc2.ext !== void 0 ? fc2.ext : ext;
    ops.push(...setValuesOps(sourceId, master, { ...fc2, ...timesChanges(times22), ext: extOut && Object.keys(extOut).length ? extOut : null }));
    for (const o of overrides) {
      const oext = extOf(o);
      const rid = oext.recurrence_id;
      if (!r) {
        ops.push(deleteRecordsOp(sourceId, [o]));
        continue;
      }
      if (deltaMs || deltaDays)
        ops.push(...setValuesOps(sourceId, o, { ext: { ...oext, recurrence_id: { ...rid, original: shiftOriginal(String(rid.original), masterTimes.allDay, deltaMs, deltaDays) } } }));
    }
    return { ops, record_id: master.record_id };
  }
  if (!rule)
    throw new Error("not a repeating event");
  const id = newId();
  const before = (x) => masterTimes.allDay ? x < original : Date.parse(x) < Date.parse(original);
  let headRule = { ...rule };
  let tailRule = { ...rule };
  if (rule.count !== void 0) {
    const start = seriesStartOf(master.values, typeof masterExt.tz === "string" ? masterExt.tz : void 0);
    const fromMs = masterTimes.allDay ? Date.parse(`${masterTimes.startDate}T00:00:00Z`) - 864e5 * 2 : masterTimes.startMs;
    const toMs = masterTimes.allDay ? Date.parse(`${original}T00:00:00Z`) : Date.parse(original);
    const done = expandSeries(rule, start, { fromMs, toMs }, { viewerTz: "UTC" }).filter((o) => before(o.original)).length;
    headRule = { ...rule, count: Math.max(1, done) };
    tailRule = { ...rule, count: Math.max(1, rule.count - done) };
  } else {
    headRule = { ...rule, until: masterTimes.allDay ? addDays(original, -1) : new Date(Date.parse(original) - 1e3).toISOString().replace(/\.\d{3}Z$/, ".000Z") };
  }
  const headExt = { ...masterExt, rrule: formatRRule(headRule) };
  const headEx = exdate.filter(before);
  if (headEx.length)
    headExt.exdate = headEx;
  else
    delete headExt.exdate;
  ops.push(...setValuesOps(sourceId, master, { ext: headExt }));
  const tailExt = { ...masterExt };
  const tr = nextRule(tailRule);
  if (tr)
    tailExt.rrule = tr;
  else
    delete tailExt.rrule;
  const tailEx = exdate.filter((x) => !before(x)).map((x) => shiftOriginal(x, masterTimes.allDay, deltaMs, deltaDays));
  if (tailEx.length && tr)
    tailExt.exdate = tailEx;
  else
    delete tailExt.exdate;
  const times2 = seriesTimes(masterTimes.allDay ? void 0 : Date.parse(original), masterTimes.allDay ? original : void 0);
  const fc = fieldChanges({ record_id: id, values: { ext: tailExt } });
  const values = { title: master.values.title, status: master.values.status, ...fc, ...timesChanges(times2) };
  values.ext = (fc.ext !== void 0 ? fc.ext : tailExt) ?? void 0;
  ops.push(insertRecordOp(sourceId, [{ record_id: id, values }]));
  for (const o of overrides) {
    const oext = extOf(o);
    const rid = oext.recurrence_id;
    if (before(String(rid.original)))
      continue;
    if (!tr) {
      ops.push(deleteRecordsOp(sourceId, [o]));
      continue;
    }
    ops.push(...setValuesOps(sourceId, o, { ext: { ...oext, recurrence_id: { master: id, original: shiftOriginal(String(rid.original), masterTimes.allDay, deltaMs, deltaDays) } } }));
  }
  return { ops, record_id: id };
}
function eventDeleteOps(sourceId, occ, scope, ctx) {
  const master = occ.master;
  if (!master)
    return [deleteRecordsOp(sourceId, [occ.row])];
  const original = occ.original;
  const masterExt = extOf(master);
  const masterTimes = rowTimes(master);
  const overrides = overridesOf(ctx.rows, master.record_id);
  const isFirst = masterTimes.allDay ? original === masterTimes.startDate : original === new Date(masterTimes.startMs).toISOString();
  if (scope === "all" || scope === "following" && isFirst)
    return [deleteRecordsOp(sourceId, [master, ...overrides])];
  const ops = [];
  if (scope === "one") {
    const exdate = originals(masterExt.exdate);
    if (!exdate.includes(original))
      ops.push(...setValuesOps(sourceId, master, { ext: { ...masterExt, exdate: [...exdate, original].sort() } }));
    const own = overrides.filter((o) => canonicalOriginal(String(extOf(o).recurrence_id.original)) === original);
    if (own.length)
      ops.push(deleteRecordsOp(sourceId, own));
    return ops;
  }
  const rule = typeof masterExt.rrule === "string" ? parseRRule(masterExt.rrule) : null;
  if (!rule)
    return [deleteRecordsOp(sourceId, [occ.row])];
  const before = (x) => masterTimes.allDay ? x < original : Date.parse(x) < Date.parse(original);
  const head = { ...rule, count: void 0, until: masterTimes.allDay ? addDays(original, -1) : new Date(Date.parse(original) - 1e3).toISOString() };
  const ext = { ...masterExt, rrule: formatRRule(head) };
  if (Array.isArray(masterExt.exdate)) {
    const keep = originals(masterExt.exdate).filter(before);
    if (keep.length)
      ext.exdate = keep;
    else
      delete ext.exdate;
  }
  ops.push(...setValuesOps(sourceId, master, { ext }));
  const gone = overrides.filter((o) => !before(String(extOf(o).recurrence_id.original)));
  if (gone.length)
    ops.push(deleteRecordsOp(sourceId, gone));
  return ops;
}
function eventPostponeOps(sourceId, occ, minutes, ctx) {
  const times2 = occ.allDay ? { allDay: true, startDate: addDays(occ.startDate, Math.max(1, Math.round(minutes / 1440))), endDate: addDays(occ.endDate, Math.max(1, Math.round(minutes / 1440))) } : { allDay: false, start: new Date(occ.startMs + minutes * 6e4).toISOString(), end: new Date(occ.endMs + minutes * 6e4).toISOString() };
  return eventEditOps(sourceId, occ, { times: times2 }, "one", ctx);
}
const ROWS_PAGE = 1e3;
class ScheduleClient {
  constructor(aiws, opts = {}) {
    this.aiws = aiws;
    this.opts = opts;
    this.handle = null;
    this.locale = opts.locale ?? "zh";
  }
  /** The schedule Workspace with its two tables (created when missing; concurrent first uses converge). */
  async ensure() {
    if (this.handle)
      return this.handle;
    const ws = await this.aiws.call("ws.ensure", { name: SCHEDULE_WORKSPACE_NAME, title: scheduleLabel(this.locale, "workspace") });
    return this.open(ws, true);
  }
  async open(ws, initialize = false) {
    const handle = { workspace_id: ws.workspace_id, epoch: ws.epoch, created: ws.created ?? false, todo: SCHEDULE_TODO_ID, calendar: SCHEDULE_CALENDAR_ID };
    if (!initialize) {
      this.handle = handle;
      return handle;
    }
    const have = /* @__PURE__ */ new Set();
    for (const id of [SCHEDULE_TODO_ID, SCHEDULE_CALENDAR_ID, SCHEDULE_SURFACE_ID]) {
      try {
        const read = await this.aiws.call("doc.read", { workspace_id: ws.workspace_id, entity_id: id, as: "meta" });
        const schema = id === SCHEDULE_TODO_ID ? TODO_SCHEMA_ID : id === SCHEDULE_CALENDAR_ID ? CALENDAR_SCHEMA_ID : void 0;
        if (schema && read.schema_id !== schema)
          throw new AiwsFailure({ code: "RESOURCE_TYPE_MISMATCH", detail: id + " is not the expected schedule table", retryable: false });
        if (!read.deleted)
          have.add(id);
      } catch (error) {
        const code = error?.code;
        if (code !== "NOT_FOUND" && code !== "TARGET_DELETED")
          throw error;
      }
    }
    const ops = [];
    if (!have.has(SCHEDULE_TODO_ID))
      ops.push(standardTableOp("todo", { entity_id: SCHEDULE_TODO_ID, parent_id: "data", order_key: "u", locale: this.locale }));
    if (!have.has(SCHEDULE_CALENDAR_ID))
      ops.push(standardTableOp("calendar", { entity_id: SCHEDULE_CALENDAR_ID, parent_id: "data", order_key: "v", locale: this.locale }));
    if (!have.has(SCHEDULE_SURFACE_ID))
      ops.push(...scheduleBoardOps(this.locale));
    if (ops.length) {
      const initKey = `init-${this.opts.idempotencyKey ?? newRecordId("k")}`;
      const result = await this.commitTo(handle, ops, "create the schedule", "system", initKey);
      const idConflict = (result.sub_code ?? result.errors?.[0]?.sub_code ?? result.error?.sub_code) === "ID_CONFLICT";
      if (result.status !== "accepted") {
        if (!(result.status === "rejected" && idConflict))
          throw failureOf(result);
        for (const id of [SCHEDULE_TODO_ID, SCHEDULE_CALENDAR_ID, SCHEDULE_SURFACE_ID]) {
          const meta = await this.aiws.call("doc.read", { workspace_id: ws.workspace_id, entity_id: id, as: "meta" });
          if (id !== SCHEDULE_SURFACE_ID && meta.schema_id !== (id === SCHEDULE_TODO_ID ? TODO_SCHEMA_ID : CALENDAR_SCHEMA_ID))
            throw failureOf(result);
        }
      }
    }
    this.handle = handle;
    return handle;
  }
  async commitTo(handle, operations, message, origin = "agent", key = this.opts.idempotencyKey ?? `sched-${newRecordId("k")}`) {
    const request = (epoch) => ({ protocol_version: AIWS_PROTOCOL_VERSION, workspace_id: handle.workspace_id, epoch, idempotency_key: key, origin, message, operations });
    let result = await this.aiws.call("doc.commit", request(handle.epoch));
    if (result.status === "rejected" && (result.code ?? result.error?.code) === "EPOCH_MISMATCH") {
      if (this.opts.idempotencyKey)
        throw new AiwsFailure({ code: "WRITE_OUTCOME_UNKNOWN", retryable: false, detail: "original workspace epoch changed", data: { workspace_id: handle.workspace_id, idempotency_key: key } });
      const info = await this.aiws.call("ws.get_info", { workspace_id: handle.workspace_id });
      handle.epoch = info.epoch;
      result = await this.aiws.call("doc.commit", request(handle.epoch));
    }
    return result;
  }
  /** Commit operations into the schedule; a refusal or conflict throws with the service's reason. */
  async commit(operations, message) {
    const handle = await this.ensure();
    const result = await this.commitTo(handle, operations, message);
    if (result.status !== "accepted")
      throw failureOf(result);
    return result;
  }
  /** Every live record of a table, as `doc.read` answers one (the SQL `_record` column), by record id. */
  async rows(sourceId) {
    const handle = await this.ensure();
    const rows = [];
    for (let i = 0; ; i++) {
      const page = await this.aiws.call("doc.query", {
        workspace_id: handle.workspace_id,
        sql: 'SELECT "_record" FROM t ORDER BY "_id" LIMIT ? OFFSET ?',
        params: [ROWS_PAGE, i * ROWS_PAGE],
        tables: { t: sourceId },
        max_rows: ROWS_PAGE
      });
      for (const [record] of page.rows)
        rows.push(typeof record === "string" ? JSON.parse(record) : record);
      if (page.rows.length < ROWS_PAGE)
        break;
    }
    return rows;
  }
  async row(sourceId, recordId) {
    const handle = await this.ensure();
    const r = await this.aiws.call("doc.read", { workspace_id: handle.workspace_id, entity_id: sourceId, selector: { kind: "table_record", record_id: recordId } });
    const row = r.content;
    if (!row?.record_id)
      throw new AiwsFailure({ code: "NOT_FOUND", retryable: false, detail: `record ${recordId} not found` });
    return row;
  }
  // ---- to-do
  async todos(opts = {}) {
    const items = sortTodos((await this.rows(SCHEDULE_TODO_ID)).map(todoItem));
    return opts.includeDone ? items : items.filter((i) => !i.done);
  }
  async addTodo(input, place = {}) {
    const items = sortTodos((await this.rows(SCHEDULE_TODO_ID)).map(todoItem));
    const at = (id) => items.find((i) => i.record_id === id);
    if (place.after && !at(place.after) || place.before && !at(place.before))
      throw new AiwsFailure({ code: "NOT_FOUND", retryable: false, detail: "placement anchor does not exist" });
    let pos = { items };
    if (place.after) {
      const i = items.findIndex((x) => x.record_id === place.after);
      pos = { after: at(place.after)?.order ?? null, before: items[i + 1]?.order ?? null };
    } else if (place.before) {
      const i = items.findIndex((x) => x.record_id === place.before);
      pos = { after: items[i - 1]?.order ?? null, before: at(place.before)?.order ?? null };
    }
    const { record_id, ops } = todoAddOps(SCHEDULE_TODO_ID, input, pos);
    await this.commit(ops, `add to-do: ${input.title}`);
    return todoItem(await this.row(SCHEDULE_TODO_ID, record_id));
  }
  async commitRowChange(source, row, ops, message, field = "title") {
    if (!ops.length && this.opts.idempotencyKey) {
      ops = setValuesOps(source, row, { [field]: row.values[field] ?? (field === "status" ? "todo" : row.values.title) });
    }
    if (ops.length)
      await this.commit(ops, message);
  }
  async completeTodo(recordId, done = true) {
    const row = await this.row(SCHEDULE_TODO_ID, recordId);
    const ops = todoCompleteOps(SCHEDULE_TODO_ID, row, done);
    await this.commitRowChange(SCHEDULE_TODO_ID, row, ops, `${done ? "complete" : "reopen"} to-do ${recordId}`, "status");
  }
  async updateTodo(recordId, changes) {
    const row = await this.row(SCHEDULE_TODO_ID, recordId);
    const ops = todoUpdateOps(SCHEDULE_TODO_ID, row, changes);
    await this.commitRowChange(SCHEDULE_TODO_ID, row, ops, `update to-do ${recordId}`);
  }
  /** Move a to-do before / after another one, and / or into another status. */
  async moveTodo(recordId, to) {
    const items = sortTodos((await this.rows(SCHEDULE_TODO_ID)).map(todoItem));
    const row = items.find((i) => i.record_id === recordId);
    if (!row)
      throw new AiwsFailure({ code: "NOT_FOUND", retryable: false, detail: `to-do ${recordId} not found` });
    const others = items.filter((i) => i.record_id !== recordId);
    let order;
    if (to.before || to.after) {
      const anchor = others.findIndex((i) => i.record_id === (to.before ?? to.after));
      if (anchor < 0)
        throw new AiwsFailure({ code: "NOT_FOUND", retryable: false, detail: `to-do ${to.before ?? to.after} not found` });
      order = orderAt(others, to.before ? anchor : anchor + 1);
    }
    const ops = todoMoveOps(SCHEDULE_TODO_ID, row, { status: to.status, order });
    await this.commitRowChange(SCHEDULE_TODO_ID, row, ops, `move to-do ${recordId}`, "status");
  }
  async removeTodos(recordIds) {
    const rows = await Promise.all(recordIds.map((id) => this.row(SCHEDULE_TODO_ID, id)));
    await this.commit([deleteRecordsOp(SCHEDULE_TODO_ID, rows)], `delete to-do ${recordIds.join(", ")}`);
  }
  // ---- calendar
  async events(window, opts = {}) {
    return calendarOccurrences(await this.rows(SCHEDULE_CALENDAR_ID), window, opts);
  }
  async addEvent(input) {
    if (input.ext?.rrule !== void 0 && typeof input.ext.rrule === "string")
      input = { ...input, ext: { ...input.ext, rrule: formatRRule(parseRRule(input.ext.rrule)) } };
    const { record_id, ops } = eventAddOps(SCHEDULE_CALENDAR_ID, input);
    await this.commit(ops, `add event: ${input.title}`);
    return record_id;
  }
  /** The occurrence an id names (`record_id` or `<master>@<original>`), from all rows. */
  async occurrence(id) {
    const rows = await this.rows(SCHEDULE_CALENDAR_ID);
    return { occ: findOccurrence(rows, id), rows };
  }
  async editEvent(id, change, scope = "one") {
    const { occ, rows } = await this.occurrence(id);
    const { ops, record_id } = eventEditOps(SCHEDULE_CALENDAR_ID, occ, change, scope, { rows, newRecordId: this.opts.newRecordId });
    await this.commitRowChange(SCHEDULE_CALENDAR_ID, occ.row, ops, `edit event ${id} (${scope})`);
    return record_id;
  }
  async deleteEvent(id, scope = "one") {
    const { occ, rows } = await this.occurrence(id);
    await this.commit(eventDeleteOps(SCHEDULE_CALENDAR_ID, occ, scope, { rows }), `delete event ${id} (${scope})`);
  }
}
function failureOf(result) {
  const first = result.errors?.[0];
  if (result.status === "conflict") {
    const c = result.conflicts?.[0];
    return new AiwsFailure({ code: result.code ?? "REVISION_CONFLICT", retryable: true, detail: `changed meanwhile, read it again${c ? `: ${JSON.stringify(c.selector ?? c)}` : ""}` });
  }
  return new AiwsFailure({ code: result.code ?? result.error?.code ?? "REJECTED", sub_code: result.sub_code ?? first?.sub_code, retryable: false, detail: first?.detail ?? result.detail ?? result.error?.detail ?? "refused" });
}
function findOccurrence(rows, id) {
  const at = id.indexOf("@");
  const recordId = at < 0 ? id : id.slice(0, at);
  const original = at < 0 ? null : canonicalOriginal(id.slice(at + 1));
  const row = rows.find((r) => r.record_id === recordId);
  if (!row)
    throw new AiwsFailure({ code: "NOT_FOUND", retryable: false, detail: `event ${recordId} not found` });
  if (original === null) {
    const times22 = rowTimes(row);
    if (!times22)
      throw new AiwsFailure({ code: "INVALID_OPERATION", retryable: false, detail: `event ${recordId} has no time` });
    const ext = extOf(row);
    const rid = ext.recurrence_id;
    const master = rid && typeof rid.master === "string" ? rows.find((r) => r.record_id === rid.master) : void 0;
    return occurrenceOf(row, times22, master ? { master, original: String(rid.original), recurring: true, override: true } : { recurring: typeof ext.rrule === "string", master: typeof ext.rrule === "string" ? row : void 0, original: typeof ext.rrule === "string" ? times22.allDay ? times22.startDate : new Date(times22.startMs).toISOString() : void 0 });
  }
  const override = rows.find((r) => {
    const rid = extOf(r).recurrence_id;
    return rid && rid.master === recordId && typeof rid.original === "string" && canonicalOriginal(rid.original) === canonicalOriginal(original);
  });
  const times2 = rowTimes(row);
  if (!times2)
    throw new AiwsFailure({ code: "INVALID_OPERATION", retryable: false, detail: `event ${recordId} has no time` });
  if (override)
    return occurrenceOf(override, rowTimes(override), { id, master: row, original, recurring: true, override: true });
  const fromMs = Date.parse(times2.allDay ? original + "T00:00:00Z" : original);
  const instance = Number.isFinite(fromMs) && calendarOccurrences([row], { fromMs, toMs: fromMs + 1 }, { viewerTz: "UTC" }).find((o) => o.original === original);
  if (!instance)
    throw new AiwsFailure({ code: "NOT_FOUND", retryable: false, detail: "occurrence is outside the series or was removed" });
  return instance;
}
function scheduleBoardOps(locale = "zh") {
  const folder = `${SCHEDULE_SURFACE_ID}-content`;
  const title = scheduleLabel(locale, "board");
  return [
    { op: "entity.create", entity_id: folder, type_id: "buckyos.container", parent_id: "canvas-content", order_key: "u", name: title, payload: { kind: "folder", title, system: "surface_content", surface_id: SCHEDULE_SURFACE_ID } },
    { op: "entity.create", entity_id: SCHEDULE_SURFACE_ID, type_id: "buckyos.container", parent_id: "surfaces", order_key: "a", name: title, payload: { kind: "surface", layout: { mode: "free" }, title, content_folder_id: folder } },
    {
      op: "entity.create",
      entity_id: `${SCHEDULE_SURFACE_ID}-calendar`,
      type_id: "buckyos.container",
      parent_id: SCHEDULE_SURFACE_ID,
      order_key: "a",
      placement: { x: 40, y: 40, w: 880, h: 640 },
      payload: { kind: "calendar", layout: { mode: "data" }, title: scheduleLabel(locale, "calendar_table"), bindings: { events: [{ entity_id: SCHEDULE_CALENDAR_ID }], todo: [{ entity_id: SCHEDULE_TODO_ID }] }, config: { view: "week" } }
    },
    {
      op: "entity.create",
      entity_id: `${SCHEDULE_SURFACE_ID}-todo`,
      type_id: "buckyos.container",
      parent_id: SCHEDULE_SURFACE_ID,
      order_key: "b",
      placement: { x: 960, y: 40, w: 420, h: 640 },
      payload: { kind: "todo", layout: { mode: "data" }, title: scheduleLabel(locale, "todo_table"), bindings: { items: { entity_id: SCHEDULE_TODO_ID } }, config: { mode: "list" } }
    }
  ];
}
function invalid(message) {
  throw new AiwsFailure({ code: "INVALID_ARGUMENT", detail: message, retryable: false });
}
function object(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid("expected an object");
  return value;
}
function required(value, field) {
  if (typeof value !== "string" || !value.trim())
    invalid(`${field} is required`);
  return value;
}
function instant(value, field) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value) || !isDate(value.slice(0, 10)) || !Number.isFinite(Date.parse(value)))
    invalid(`${field} requires an RFC 3339 instant with offset`);
  return Date.parse(value);
}
function times(input) {
  const { start, end, start_date, end_date } = input;
  if (start_date !== void 0 || end_date !== void 0) {
    if (start !== void 0 || end !== void 0)
      invalid("choose either dates or instants");
    if (typeof start_date !== "string" || !isDate(start_date) || typeof end_date !== "string" || !isDate(end_date) || end_date < start_date)
      invalid("expected start_date and inclusive end_date");
    return { allDay: true, startDate: start_date, endDate: end_date };
  }
  if (start === void 0 && end === void 0)
    return;
  const from = instant(start, "start"), to = instant(end, "end");
  if (to <= from)
    invalid("end must follow start");
  return { allDay: false, start: new Date(from).toISOString(), end: new Date(to).toISOString() };
}
function location(raw, slot, zone, owner) {
  const url = required(raw, "record_ref");
  try {
    const parsed = parseAiwsReferenceUrl(url);
    const address = new URL(url);
    const query = address.searchParams;
    const keys = [...query.keys()];
    if (address.username || address.password || address.port || address.hash || new Set(keys).size !== keys.length || keys.some((k) => !["zone", "owner", "epoch", "binding_revision", "selector", "occurrence"].includes(k)))
      invalid("invalid record reference");
    const epoch = required(query.get("epoch"), "epoch");
    const id = parsed.selector?.record_id;
    if (!parsed.workspace_id || parsed.entity_id !== slot || parsed.mode !== "live" || parsed.selector?.kind !== "table_record" || typeof id !== "string" || !id || query.get("zone") !== zone || query.get("owner") !== owner)
      invalid("record_ref does not belong to this Zone and resource type");
    const occ = query.get("occurrence");
    if (occ && (slot !== "calendar" || !isDate(occ) && !Number.isFinite(instant(occ, "occurrence"))))
      invalid("invalid occurrence");
    return { workspace_id: parsed.workspace_id, epoch, id, occurrence: occ ?? void 0 };
  } catch (error) {
    invalid(error instanceof Error ? error.message : "invalid record_ref");
  }
}
function references(input, action, slot, zone, owner) {
  if (action === "list" || action === "add")
    return [];
  if (slot === "todo" && action === "rm" && input.record_refs !== void 0) {
    if (input.record_ref || !Array.isArray(input.record_refs) || !input.record_refs.length)
      invalid("use record_ref or a nonempty record_refs array");
    const refs = input.record_refs.map((value) => location(value, slot, zone, owner));
    if (refs.some((r) => r.workspace_id !== refs[0].workspace_id) || new Set(refs.map((r) => r.id)).size !== refs.length)
      invalid("record_refs must name distinct rows in one table");
    return refs;
  }
  return [location(input.record_ref, slot, zone, owner)];
}
function links(ws, slot, zone, owner, revision, id, occurrence) {
  const url = new URL(aiwsReferenceUrl({ workspace_id: ws.workspace_id, entity_id: slot, selector: { kind: "table_record", record_id: id }, mode: "live" }));
  url.searchParams.set("zone", zone);
  url.searchParams.set("owner", owner);
  url.searchParams.set("epoch", ws.epoch);
  url.searchParams.set("binding_revision", String(revision));
  if (occurrence)
    url.searchParams.set("occurrence", occurrence);
  const query = new URLSearchParams({ id: SCHEDULE_SURFACE_ID, block: SCHEDULE_SURFACE_ID + "-" + slot, record: id });
  if (occurrence)
    query.set("occ", occurrence);
  return {
    record_ref: url.toString(),
    ...ws.public_base ? { open_url: new URL("/workspace/surface?" + query, ws.public_base).toString() } : {}
  };
}
function todoView(item) {
  const { title, status, due, order, done, done_at, ext } = item;
  return { title, status, due, order, done, done_at, ext };
}
function eventView(o) {
  return {
    title: o.title,
    all_day: o.allDay,
    status: o.status,
    ext: o.ext,
    ...o.allDay ? { start_date: o.startDate, end_date: o.endDate } : { start: new Date(o.startMs).toISOString(), end: new Date(o.endMs).toISOString() },
    ...o.recurring ? { recurring: true, original: o.original } : {},
    ...o.override ? { changed_once: true } : {},
    ...o.agentWritten ? { agent_written: true } : {}
  };
}
function windowOf(input, tz) {
  const fromMs = instant(input.from, "from"), toMs = instant(input.to, "to");
  if (toMs <= fromMs || toMs - fromMs > 366 * 864e5)
    invalid("use a positive window of at most 366 days");
  const offset = String(input.from).slice(-6);
  const zone = input.tz ?? tz ?? (/^[+-]/.test(offset) ? offset : "UTC");
  if (typeof zone !== "string" || !isTimeZone(zone))
    invalid("unknown calendar time zone");
  return { fromMs, toMs, viewerTz: zone };
}
function pageOf(input) {
  const offset = input.cursor === void 0 ? 0 : Number(input.cursor);
  const limit = input.limit ?? 100;
  if (input.cursor !== void 0 && String(offset) !== input.cursor || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || typeof limit !== "number" || limit < 1 || limit > 1e3)
    invalid("invalid pagination");
  return { offset, limit };
}
function calendarChange(p, tz) {
  const time = times(p);
  const ext = { ...p.ext === void 0 ? {} : object(p.ext) };
  if (p.location !== void 0)
    ext.location = p.location;
  if (p.reminders !== void 0) {
    if (!Array.isArray(p.reminders) || !p.reminders.every((n) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0))
      invalid("invalid reminders");
    ext.reminders = p.reminders.map((before_min) => ({ before_min }));
  }
  const repeat = p.rrule ?? ext.rrule;
  if (repeat) {
    if (typeof repeat !== "string")
      invalid("rrule requires a string");
    try {
      parseRRule(repeat);
    } catch (e) {
      invalid(String(e));
    }
  }
  const zone = p.tz ?? ext.tz ?? (repeat && time && !time.allDay ? tz : void 0);
  if (zone !== void 0) {
    if (typeof zone !== "string" || !isTimeZone(zone))
      invalid("unknown repeat time zone");
    ext.tz = zone;
  } else if (repeat && time && !time.allDay) {
    if (!String(p.start).endsWith("Z"))
      invalid("provide tz for a repeating timed event");
    ext.tz = "UTC";
  }
  const values = { ...p.title !== void 0 ? { title: required(p.title, "title") } : {}, ...p.status !== void 0 ? { status: required(p.status, "status") } : {} };
  return { times: time, values, ext_merge: ext, rrule: p.rrule };
}
function todoChange(p) {
  if (p.due !== void 0 && p.due !== null && (typeof p.due !== "string" || !isDate(p.due)))
    invalid("due requires a date or null");
  const ext = { ...p.ext === void 0 ? {} : object(p.ext) };
  if (p.priority !== void 0)
    ext.priority = p.priority === "none" ? null : p.priority;
  return {
    ...p.title !== void 0 ? { title: required(p.title, "title") } : {},
    ...p.status !== void 0 ? { status: required(p.status, "status") } : {},
    due: p.due,
    ext_merge: ext
  };
}
async function invoke(slot, request, host) {
  const { method, params: p } = request;
  const zone = host.context.zone_did;
  const identity = { owner_did: host.context.owner_did };
  const read = method === "list";
  const pagination = read ? pageOf(p) : void 0;
  const window = slot === "calendar" && read ? windowOf(p, host.context.tz) : void 0;
  const input = method === "update" ? object(p.patch) : p;
  const change = !read && slot === "calendar" ? calendarChange(input, host.context.tz) : void 0;
  const todo = !read && slot === "todo" ? todoChange(input) : void 0;
  if (method === "add") {
    required(p.title, "title");
    if (slot === "calendar" && !change?.times)
      invalid("add requires a time or all-day date range");
  }
  if (p.before !== void 0 && p.after !== void 0)
    invalid("choose only one placement anchor");
  const prepared = await host.call("owner.prepare", { slot });
  if ("result" in prepared)
    return prepared.result;
  const base = { ...identity, binding_revision: prepared.binding_revision };
  const owner = host.context.owner_did;
  const refs = references(p, method, slot, zone, owner);
  const before = p.before === void 0 ? void 0 : location(p.before, slot, zone, owner);
  const after2 = p.after === void 0 ? void 0 : location(p.after, slot, zone, owner);
  const locations = [...refs, ...[before, after2].filter((a) => Boolean(a))];
  const transport = { call: async (m, params) => {
    let response;
    try {
      response = await host.call("aiws." + m, params);
      const code = response.error?.code ?? response.code;
      if (m === "doc.commit" && ["STORAGE_IO_ERROR", "WRITE_OUTCOME_UNKNOWN", "IDEMPOTENCY_MISMATCH"].includes(code ?? ""))
        throw new Error(code);
    } catch (error) {
      if (m !== "doc.commit")
        throw error;
      const cause = error;
      if (cause.code && !["WRITE_OUTCOME_UNKNOWN", "PROVIDER_UNAVAILABLE", "TRANSPORT_ERROR", "STORAGE_IO_ERROR", "TIMEOUT"].includes(cause.code))
        throw error;
      const { workspace_id, epoch, idempotency_key } = params;
      try {
        const tableWrite = Array.isArray(params.operations) && params.operations.every((op) => String(op.op).startsWith("table."));
        const found = await host.call("aiws.doc.get_submission", {
          workspace_id,
          epoch,
          idempotency_key,
          ...tableWrite ? { source_id: slot } : {}
        });
        if (found.status === "accepted")
          return found.result ?? { status: "accepted" };
      } catch (checkError) {
        if (["PERMISSION_DENIED", "AUTH_REQUIRED", "UNAUTHORIZED"].includes(String(checkError.code)))
          throw checkError;
      }
      throw new AiwsFailure({ code: "WRITE_OUTCOME_UNKNOWN", detail: "the service could not confirm the submission", retryable: false, data: { idempotency_key, workspace_id } });
    }
    if (response.ok === false && response.error)
      throw new AiwsFailure(response.error);
    return response;
  } };
  let workspaceId = prepared.workspace_id ?? refs[0]?.workspace_id;
  if (!workspaceId) {
    if (read || before || after2) {
      const ws2 = await transport.call("ws.lookup", { name: "schedule" });
      if (ws2.found === false && !read)
        invalid("placement anchor requires an existing personal schedule");
      if (ws2.found === false)
        return { ...base, initialized: false, [slot === "calendar" ? "events" : "items"]: [], next_cursor: null };
      if (ws2.found !== true || !ws2.workspace_id)
        throw new AiwsFailure({ code: "INVALID_SERVICE_RESPONSE", retryable: false, detail: "invalid workspace lookup result" });
      workspaceId = ws2.workspace_id;
    } else {
      const ws2 = await transport.call("ws.ensure", { name: "schedule", title: "我的日程" });
      workspaceId = ws2.workspace_id;
    }
  }
  const businessKey = request.idempotency_key ?? prepared.idempotency_key;
  const inputKey = "xcall:" + slot + ":" + method + ":" + businessKey;
  const key = read ? "" : /^[\x21-\x7e]{1,110}$/.test(inputKey) ? inputKey : "xcall:" + Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(inputKey))), (b) => b.toString(16).padStart(2, "0")).join("");
  const allocated = prepared.record_id;
  const client = new ScheduleClient(transport, { idempotencyKey: key, newRecordId: () => allocated });
  async function workspace(id2) {
    const ws2 = await transport.call("ws.get_info", { workspace_id: id2 });
    if (ws2.workspace_id !== id2 || !ws2.owned_by_caller_user || ws2.name !== "schedule" && ws2.former_name !== "schedule") {
      throw new AiwsFailure({ code: "PERMISSION_DENIED", detail: "workspace is outside the owner’s personal schedule", retryable: false });
    }
    for (const loc of locations) {
      if (loc.workspace_id !== ws2.workspace_id)
        invalid("record reference belongs to another workspace");
      if (loc.epoch !== ws2.epoch)
        throw new AiwsFailure({ code: "EPOCH_MISMATCH", detail: "record reference belongs to an earlier workspace history", retryable: false });
    }
    return ws2;
  }
  let ws = await workspace(workspaceId);
  if (!read) {
    const pinned = await host.call("owner.pin", { slot, workspace_id: ws.workspace_id, epoch: ws.epoch });
    if (pinned.workspace_id !== ws.workspace_id)
      ws = await workspace(pinned.workspace_id);
    if (pinned.epoch !== ws.epoch)
      throw new AiwsFailure({ code: "WRITE_OUTCOME_UNKNOWN", detail: "original workspace epoch has changed", retryable: false, data: { idempotency_key: key } });
  }
  const link = (id2, occ) => links(ws, slot, zone, owner, prepared.binding_revision, id2, occ);
  const ref = refs[0];
  const id = ref?.occurrence ? ref.id + "@" + ref.occurrence : ref?.id;
  const receipt = (resultId, occurrence) => ({
    ...base,
    idempotency_key: businessKey,
    status: method === "add" ? "created" : method === "rm" ? "removed" : "updated",
    ...resultId ? link(resultId, occurrence) : {},
    ...method === "rm" && slot === "todo" ? { removed: refs.length } : {}
  });
  let initialize = method === "add";
  if (initialize && prepared.replay) {
    const prior = await transport.call("doc.get_submission", {
      workspace_id: ws.workspace_id,
      epoch: ws.epoch,
      idempotency_key: key
    });
    if (!["accepted", "not_found"].includes(prior.status))
      throw new AiwsFailure({ code: "WRITE_OUTCOME_UNKNOWN", detail: "cannot confirm the original write", retryable: false, data: { idempotency_key: key } });
    initialize = prior.status === "not_found";
  }
  await client.open(ws, initialize);
  try {
    const meta = await transport.call("doc.read", { workspace_id: ws.workspace_id, entity_id: slot, as: "meta" });
    if (meta.schema_id !== "buckyos." + slot + "@1")
      throw new AiwsFailure({ code: "RESOURCE_TYPE_MISMATCH", detail: "unexpected table schema", retryable: false });
    if (slot === "todo" && ["done", "undone", "update", "move"].includes(method) && !meta.capabilities.includes("update")) {
      throw new AiwsFailure({ code: "PERMISSION_DENIED", detail: "table update permission required", retryable: false });
    }
  } catch (error) {
    if (read && (ws.owner === true || ws.head_seq === 0) && ["NOT_FOUND", "TARGET_DELETED"].includes(String(error.code))) {
      return { ...base, initialized: false, [slot === "todo" ? "items" : "events"]: [], next_cursor: null };
    }
    throw error;
  }
  if (prepared.replay && !read) {
    const sub = await transport.call("doc.get_submission", {
      workspace_id: ws.workspace_id,
      epoch: ws.epoch,
      idempotency_key: key,
      source_id: slot
    });
    if (sub.status === "accepted") {
      if (method === "add")
        return receipt(allocated);
      if (["update", "postpone"].includes(method) && slot === "calendar")
        return receipt(sub.inserted?.[0] ?? sub.changed?.[0] ?? ref.id);
      return receipt(ref.id, ref.occurrence);
    }
    if (sub.status !== "not_found")
      throw new AiwsFailure({ code: "WRITE_OUTCOME_UNKNOWN", detail: "provider could not confirm submission", retryable: false, data: { idempotency_key: key } });
  }
  if (read) {
    const all = slot === "todo" ? (await client.todos({ includeDone: p.include_done === true })).map((item) => ({ ...todoView(item), ...link(item.record_id) })) : (await client.events(window, window)).map((o) => ({ ...eventView(o), ...link(o.master?.record_id ?? o.row.record_id, o.original) }));
    const { offset, limit } = pagination;
    return { ...base, initialized: true, [slot === "todo" ? "items" : "events"]: all.slice(offset, offset + limit), next_cursor: offset + limit < all.length ? String(offset + limit) : null };
  }
  if (slot === "todo") {
    const place = { before: before?.id, after: after2?.id };
    switch (method) {
      case "add": {
        const item = await client.addTodo({ ...todo, title: required(p.title, "title"), record_id: allocated, ext: todo.ext_merge }, place);
        return receipt(item.record_id);
      }
      case "done":
      case "undone":
        await client.completeTodo(id, method === "done");
        break;
      case "update":
        await client.updateTodo(id, todo);
        break;
      case "move":
        await client.moveTodo(id, { status: todo.status, ...place });
        break;
      case "rm":
        await client.removeTodos(refs.map((r) => r.id));
        break;
      default:
        invalid("unknown to-do action");
    }
    return receipt(id);
  }
  const scope = p.scope ?? "one";
  switch (method) {
    case "add": {
      const t = change.times;
      const ext = { ...change.ext_merge, ...change.rrule ? { rrule: change.rrule } : {} };
      const event = await client.addEvent({
        ...change.values,
        title: required(p.title, "title"),
        record_id: allocated,
        ext,
        ...t.allDay ? { all_day: true, start_date: t.startDate, end_date: t.endDate } : { start: t.start, end: t.end }
      });
      return receipt(event);
    }
    case "update":
      return receipt(await client.editEvent(id, change, scope));
    case "rm":
    case "skip":
      await client.deleteEvent(id, method === "skip" ? "one" : scope);
      return receipt(ref.id, ref.occurrence);
    case "postpone": {
      if (typeof p.minutes !== "number" || !Number.isSafeInteger(p.minutes) || p.minutes <= 0)
        invalid("minutes must be positive");
      const { occ, rows } = await client.occurrence(id);
      const { ops, record_id } = eventPostponeOps(slot, occ, p.minutes, { rows, newRecordId: () => allocated });
      if (ops.length)
        await client.commit(ops, "postpone occurrence");
      return receipt(record_id);
    }
    default:
      invalid("unknown calendar action");
  }
}
async function scheduleAction(slot, request, host) {
  try {
    return { result: await invoke(slot, request, host) };
  } catch (error) {
    const e = error;
    return { error: { code: e.code ?? "PROVIDER_UNAVAILABLE", message: e.message ?? String(error), details: e.details ?? e.data ?? null } };
  }
}
export {
  instant,
  scheduleAction
};
