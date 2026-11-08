import { a5 as ObjId } from "./ndn_types-0fac2499.mjs";
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
const OBJECT_EVENT_PREFIX = "/obj";
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
function expandInputShorthand(input) {
  input = input.trim();
  if (input.startsWith("//")) {
    const rest = input.slice(2);
    const service = rest.split(/[/?]/)[0] ?? "";
    return isObjServiceName(service) ? `obj://${rest}` : input;
  }
  if (input.startsWith("/"))
    return `file://${input}`;
  return input;
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
function objectEndpoint(url, origin, currentZone) {
  const base = origin.replace(/\/+$/, "");
  if (url.kind === "obj")
    return `${base}/kapi/${url.host.name}/obj${formatObjectUrl(url).slice(`obj://${url.host.name}`.length)}`;
  if (url.kind === "cyfs_path" && (url.zone === null || url.zone === currentZone))
    return `${base}/kapi/dfs/obj${url.path.replace(/\/+$/, "")}`;
  if (url.kind === "cyfs_object") {
    const from = url.sourceZone && url.sourceZone !== currentZone ? `https://${url.sourceZone}` : base;
    const inner = url.innerPath.replace(/^\/+|\/+$/g, "");
    return `${from}/ndn/${url.objId.toString()}${inner ? `/@/${inner}` : ""}`;
  }
  if (url.kind === "web")
    return url.url;
  return null;
}
function ndnReadUrl(origin, objId, hint) {
  const url = `${origin.replace(/\/+$/, "")}/ndn/${objId}`;
  if (!hint || hint.path === void 0 && hint.token === void 0)
    return url;
  return `${url}?hint=${encodeURIComponent(canonicalJson(hint))}`;
}
function normalizeObjectUrl(input) {
  return formatObjectUrl(parseObjectUrl(input));
}
function rbacResourceKey(url, currentZone) {
  if (url.kind === "obj")
    return `obj://${url.host.name}${url.path}`;
  if (url.kind === "cyfs_path") {
    const local = url.zone === null || currentZone !== void 0 && url.zone === currentZone.toLowerCase();
    return local ? `obj://dfs${url.path}` : null;
  }
  return null;
}
function objectSegments(url) {
  return url.kind === "obj" ? decodedSegments(url.path) : [];
}
function objectEventKey(url, event) {
  if (url.kind !== "obj")
    throw new ObjectUrlError("object events are only defined for obj:// urls");
  if (!/^[A-Za-z0-9_-]+$/.test(event) || event.startsWith("x")) {
    throw new ObjectUrlError(`invalid object event name '${event}'`);
  }
  const key = `${objectEventBase(url.host, url.path)}/${event}`;
  if (key.length > 256 || key.split("/").length - 1 > 8) {
    throw new ObjectUrlError(`object event key too long: ${key}`);
  }
  return key;
}
function objectEventPattern(url) {
  if (url.kind !== "obj")
    throw new ObjectUrlError("object events are only defined for obj:// urls");
  return `${objectEventBase(url.host, url.path)}/**`;
}
function keventSegment(segment) {
  if (segment !== "" && /^[A-Za-z0-9_-]+$/.test(segment) && !segment.startsWith("x"))
    return segment;
  let out = "x";
  for (const byte of new TextEncoder().encode(segment))
    out += byte.toString(16).padStart(2, "0");
  return out;
}
function objEventKey(host, segments, event) {
  return `${objEventBase(host, segments)}/${event}`;
}
function objEventPattern(host, segments) {
  return `${objEventBase(host, segments)}/**`;
}
function objEventBase(host, segments) {
  return [OBJECT_EVENT_PREFIX, keventSegment(host), ...segments.map(keventSegment)].join("/");
}
function objectDid(url, zoneDid, entityDid) {
  if (url.kind !== "obj")
    return null;
  const segments = url.path.split("/").filter((s) => s !== "").map((s) => s.replace(/:/g, "%3A"));
  const base = url.host.kind === "service" ? zoneDid : entityDid ?? `did:web:${url.host.name}`;
  const all = url.host.kind === "service" ? [url.host.name, ...segments] : segments;
  return all.length ? `${base}:${all.join(":")}` : base;
}
function objServiceUrl(service, segments) {
  return `obj://${service}${segments.map((s) => `/${encodeObjSegment(s)}`).join("")}`;
}
function objEntityUrl(entityHost, segments) {
  return `obj://${entityHost}${segments.map((s) => `/${encodeObjSegment(s)}`).join("")}`;
}
function configKeyFromUrl(input) {
  let key = input.startsWith("obj://config/") ? input.slice("obj://config/".length) : input;
  if (key.startsWith("/config/"))
    key = key.slice("/config/".length);
  return key.replace(/^[/\\]+/, "");
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
function objectEventBase(host, path) {
  return objEventBase(host.name, decodedSegments(path));
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
const object_url = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  OBJECT_EVENT_PREFIX,
  OBJ_SERVICE_NAMES,
  ObjectUrlError,
  canonicalJson,
  configKeyFromUrl,
  encodeObjQueryComponent,
  encodeObjSegment,
  expandInputShorthand,
  formatObjectUrl,
  isObjServiceName,
  keventSegment,
  ndnReadUrl,
  normalizeObjectUrl,
  objEntityUrl,
  objEventKey,
  objEventPattern,
  objServiceUrl,
  objectDid,
  objectEndpoint,
  objectEventKey,
  objectEventPattern,
  objectSegments,
  parseObjHost,
  parseObjectUrl,
  rbacResourceKey
}, Symbol.toStringTag, { value: "Module" }));
export {
  ObjectUrlError as O,
  objServiceUrl as a,
  objectSegments as b,
  canonicalJson as c,
  objEventKey as d,
  encodeObjQueryComponent as e,
  objectEndpoint as f,
  normalizeObjectUrl as n,
  object_url as o,
  parseObjectUrl as p
};
//# sourceMappingURL=object_url-f72c1704.mjs.map
