import { f as encodeObjSegment } from "./object_url-20e94b67.mjs";
import "./ndn_types-0fac2499.mjs";
const TEXT_CODE_EXTENSIONS = [
  "txt",
  "text",
  "log",
  "ini",
  "conf",
  "cfg",
  "env",
  "csv",
  "tsv",
  "md",
  "markdown",
  "rst",
  "adoc",
  "json",
  "jsonc",
  "json5",
  "xml",
  "yaml",
  "yml",
  "toml",
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "rs",
  "py",
  "go",
  "c",
  "h",
  "cc",
  "cpp",
  "hpp",
  "java",
  "kt",
  "swift",
  "rb",
  "php",
  "sql",
  "sh",
  "bash",
  "zsh",
  "ps1",
  "bat",
  "css",
  "scss",
  "less",
  "vue",
  "svelte",
  "lua",
  "dart",
  "r",
  "scala",
  "ex",
  "exs",
  "dockerfile",
  "makefile",
  "gitignore",
  "editorconfig",
  "lock"
];
const MEDIA_TYPE_BY_EXTENSION = {
  png: "image/png",
  apng: "image/apng",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
  tif: "image/tiff",
  tiff: "image/tiff",
  psd: "image/vnd.adobe.photoshop",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  ogv: "video/ogg",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  flac: "audio/flac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  pdf: "application/pdf",
  html: "text/html",
  htm: "text/html",
  xhtml: "application/xhtml+xml",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  doc: "application/msword",
  xls: "application/vnd.ms-excel",
  ppt: "application/vnd.ms-powerpoint",
  odt: "application/vnd.oasis.opendocument.text",
  zip: "application/zip",
  tar: "application/x-tar",
  gz: "application/gzip",
  "7z": "application/x-7z-compressed",
  rar: "application/vnd.rar",
  epub: "application/epub+zip",
  md: "text/markdown",
  markdown: "text/markdown",
  json: "application/json",
  xml: "application/xml",
  csv: "text/csv",
  yaml: "application/yaml",
  yml: "application/yaml",
  toml: "application/toml",
  js: "text/javascript",
  mjs: "text/javascript",
  cjs: "text/javascript",
  css: "text/css"
};
for (const ext of TEXT_CODE_EXTENSIONS) {
  if (!MEDIA_TYPE_BY_EXTENSION[ext])
    MEDIA_TYPE_BY_EXTENSION[ext] = `text/x-${ext}`;
}
function extensionOf(name) {
  if (!name)
    return "";
  const base = name.split("/").pop() ?? name;
  const dot = base.lastIndexOf(".");
  if (dot <= 0)
    return "";
  return base.slice(dot + 1).toLowerCase();
}
function mediaTypeFromExtension(ext) {
  return MEDIA_TYPE_BY_EXTENSION[ext.toLowerCase()];
}
function stripMediaTypeParams(value) {
  return (value ?? "").split(";")[0].trim().toLowerCase();
}
function ascii(bytes, start, length) {
  let out = "";
  for (let i = start; i < Math.min(bytes.length, start + length); i += 1) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}
function textHead(bytes, length = 512) {
  let start = 0;
  if (bytes.length >= 3 && bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191)
    start = 3;
  return ascii(bytes, start, length).replace(/^\s+/, "");
}
const HEIC_BRANDS = /* @__PURE__ */ new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs"]);
function compatibleBrands(b) {
  const size = b[0] << 24 | b[1] << 16 | b[2] << 8 | b[3];
  const end = Math.min(b.length, size > 16 ? size : 16);
  const brands = [];
  for (let at = 16; at + 4 <= end; at += 4)
    brands.push(ascii(b, at, 4));
  return brands;
}
function sniffMagic(bytes) {
  if (!bytes || bytes.length < 4)
    return null;
  const b = bytes;
  if (b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71)
    return "image/png";
  if (b[0] === 255 && b[1] === 216 && b[2] === 255)
    return "image/jpeg";
  if (ascii(b, 0, 4) === "GIF8")
    return "image/gif";
  if (ascii(b, 0, 4) === "RIFF" && b.length >= 12) {
    const form = ascii(b, 8, 4);
    if (form === "WEBP")
      return "image/webp";
    if (form === "WAVE")
      return "audio/wav";
    if (form === "AVI ")
      return "video/x-msvideo";
  }
  if (b[0] === 66 && b[1] === 77)
    return "image/bmp";
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0)
    return "image/x-icon";
  if (ascii(b, 0, 4) === "II*\0" || ascii(b, 0, 4) === "MM\0*")
    return "image/tiff";
  if (ascii(b, 0, 4) === "8BPS")
    return "image/vnd.adobe.photoshop";
  if (ascii(b, 0, 5) === "%PDF-")
    return "application/pdf";
  if (b.length >= 12 && ascii(b, 4, 4) === "ftyp") {
    const brand = ascii(b, 8, 4);
    if (brand === "avif" || brand === "avis")
      return "image/avif";
    if (HEIC_BRANDS.has(brand))
      return "image/heic";
    if (brand === "mif1" || brand === "msf1") {
      const compatible = compatibleBrands(b);
      if (compatible.some((c) => c === "avif" || c === "avis"))
        return "image/avif";
      return compatible.some((c) => HEIC_BRANDS.has(c)) ? "image/heic" : "image/heif";
    }
    if (brand === "qt  ")
      return "video/quicktime";
    if (brand === "M4A ")
      return "audio/mp4";
    return "video/mp4";
  }
  if (b[0] === 26 && b[1] === 69 && b[2] === 223 && b[3] === 163) {
    return ascii(b, 0, 64).includes("webm") ? "video/webm" : "video/x-matroska";
  }
  if (ascii(b, 0, 4) === "OggS") {
    const head2 = ascii(b, 0, 96);
    return head2.includes("theora") ? "video/ogg" : "audio/ogg";
  }
  if (ascii(b, 0, 3) === "ID3")
    return "audio/mpeg";
  if (b[0] === 255 && (b[1] & 230) === 226 && (b[1] & 24) !== 8)
    return "audio/mpeg";
  if (ascii(b, 0, 4) === "fLaC")
    return "audio/flac";
  if (b[0] === 80 && b[1] === 75 && (b[2] === 3 || b[2] === 5 || b[2] === 7)) {
    return "application/zip";
  }
  if (b[0] === 31 && b[1] === 139)
    return "application/gzip";
  if (ascii(b, 0, 6) === "7z¼¯'")
    return "application/x-7z-compressed";
  if (ascii(b, 0, 4) === "Rar!")
    return "application/vnd.rar";
  const head = textHead(b).toLowerCase();
  if (head.startsWith("<?xml") || head.startsWith("<svg") || head.startsWith("<!doctype svg")) {
    if (head.includes("<svg"))
      return "image/svg+xml";
    if (head.startsWith("<?xml"))
      return "application/xml";
  }
  if (head.startsWith("<!doctype html") || head.startsWith("<html") || head.startsWith("<head") || head.startsWith("<body")) {
    return "text/html";
  }
  return null;
}
const MAX_ISO_BOXES = 4096;
function isoBoxes(view, start, end) {
  const boxes = [];
  let at = start;
  while (boxes.length < MAX_ISO_BOXES && at + 8 <= end) {
    let size = view.getUint32(at);
    const type = String.fromCharCode(view.getUint8(at + 4), view.getUint8(at + 5), view.getUint8(at + 6), view.getUint8(at + 7));
    let header = 8;
    if (size === 1) {
      if (at + 16 > end)
        break;
      size = Number(view.getBigUint64(at + 8));
      if (!Number.isSafeInteger(size))
        throw new RangeError("box size exceeds the safe integer range");
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < header)
      break;
    boxes.push({ type, start: at + header, end: Math.min(end, at + size) });
    at += size;
  }
  return boxes;
}
function heifImageSize(bytes) {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const meta = isoBoxes(view, 0, bytes.length).find((b) => b.type === "meta");
    if (!meta)
      return null;
    const children = isoBoxes(view, meta.start + 4, meta.end);
    const pitm = children.find((b) => b.type === "pitm");
    const iprp = children.find((b) => b.type === "iprp");
    if (!pitm || !iprp)
      return null;
    const primary = view.getUint8(pitm.start) === 0 ? view.getUint16(pitm.start + 4) : view.getUint32(pitm.start + 4);
    const props = isoBoxes(view, iprp.start, iprp.end);
    const ipco = props.find((b) => b.type === "ipco");
    if (!ipco)
      return null;
    const properties = isoBoxes(view, ipco.start, ipco.end);
    let width = 0;
    let height = 0;
    let quarterTurns = 0;
    for (const ipma of props.filter((b) => b.type === "ipma")) {
      const version = view.getUint8(ipma.start);
      const wideIndex = (view.getUint8(ipma.start + 3) & 1) === 1;
      let at = ipma.start + 4;
      const count = view.getUint32(at);
      at += 4;
      for (let i = 0; i < count && at < ipma.end; i += 1) {
        const item = version < 1 ? view.getUint16(at) : view.getUint32(at);
        at += version < 1 ? 2 : 4;
        const associations = view.getUint8(at);
        at += 1;
        for (let j = 0; j < associations; j += 1) {
          const index = wideIndex ? view.getUint16(at) & 32767 : view.getUint8(at) & 127;
          at += wideIndex ? 2 : 1;
          if (item !== primary || index === 0)
            continue;
          const property = properties[index - 1];
          if ((property == null ? void 0 : property.type) === "ispe") {
            width = view.getUint32(property.start + 4);
            height = view.getUint32(property.start + 8);
          } else if ((property == null ? void 0 : property.type) === "irot") {
            quarterTurns = view.getUint8(property.start) & 3;
          }
        }
      }
    }
    if (!width || !height)
      return null;
    return quarterTurns % 2 === 1 ? { width: height, height: width } : { width, height };
  } catch {
    return null;
  }
}
function isArchiveInnerPath(value) {
  if (typeof value !== "string" || value !== "/archive" && !value.startsWith("/archive/"))
    return false;
  return value.split("/").slice(2).every((s) => !!s && s !== "." && s !== ".." && s.length <= 255 && !/[\\\0]/.test(s));
}
const objRefString = (objectId, innerPath) => `obj://${objectId}${innerPath ? innerPath.split("/").slice(1).map((s) => `/${encodeObjSegment(s)}`).join("") : ""}`;
function parseObjRefString(value) {
  if (!value.startsWith("obj://"))
    return void 0;
  const rest = value.slice(6);
  const slash = rest.indexOf("/");
  if (slash < 0)
    return { kind: "object-id", objectId: rest };
  try {
    const innerPath = "/" + rest.slice(slash + 1).split("/").map(decodeURIComponent).join("/");
    return { kind: "object-id", objectId: rest.slice(0, slash), innerPath };
  } catch {
    return void 0;
  }
}
function readContentHints(value) {
  if (!value || typeof value !== "object")
    return {};
  const v = value;
  const hints = {};
  if (typeof v.name === "string" && v.name && v.name.length <= 255 && !/[\/\\\0]/.test(v.name))
    hints.name = v.name;
  if (typeof v.mime === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(v.mime))
    hints.mime = v.mime.toLowerCase();
  const size = typeof v.size === "string" ? Number(v.size) : v.size;
  if (typeof size === "number" && Number.isSafeInteger(size) && size >= 0)
    hints.size = size;
  return hints;
}
const previewHandler = {
  provider: "system",
  handler_id: "preview",
  handler_version: 1,
  selectors: [{ mime: "*/*" }],
  enabled: true,
  intents: { open: { entry: { type: "builtin", target: "preview" }, modes: ["view"], fidelity: "partial", window: "reuse", priority: 90 } }
};
const emptyDefaults = () => ({ schema_version: 1, defaults: {}, disabled: [] });
const contentRefString = (ref) => ref.kind === "cyfs-path" ? ref.path : objRefString(ref.objectId, ref.innerPath);
function isTransferableRef(value) {
  if (!value || typeof value !== "object")
    return false;
  const v = value;
  return v.kind === "cyfs-path" && typeof v.path === "string" && /^cyfs:\/\/\/[^\0]*$/.test(v.path) || v.kind === "object-id" && typeof v.objectId === "string" && /^[\w.-]+:[\w-]+$/.test(v.objectId) && (v.innerPath === void 0 || isArchiveInnerPath(v.innerPath));
}
function isOpenRequest(value) {
  if (!value || typeof value !== "object")
    return false;
  const v = value;
  return typeof v.requestId === "string" && isTransferableRef(v.source) && (v.mode === void 0 || v.mode === "view" || v.mode === "edit") && (v.session === void 0 || isTransferableSession(v.session));
}
function isTransferableSession(value) {
  if (!value || typeof value !== "object")
    return false;
  const v = value;
  return v.kind === "single" || v.kind === "container" && isTransferableRef(v.container) && isTransferableRef(v.current) || v.kind === "list" && Array.isArray(v.items) && v.items.every((i) => i && isTransferableRef(i.source)) && Number.isInteger(v.currentIndex) && v.currentIndex >= 0 && v.currentIndex < v.items.length;
}
function contentDescriptor(source, hints = {}) {
  const tail = source.kind === "cyfs-path" ? source.path : source.innerPath ?? "";
  const name = hints.name ?? tail.split("/").pop() ?? "";
  const ext = extensionOf(name);
  return {
    source,
    name,
    size: hints.size,
    ext: ext ? `.${ext}` : void 0,
    objType: source.kind === "cyfs-path" || source.innerPath ? "cyfile" : source.objectId.split(":")[0],
    mime: hints.mime || mediaTypeFromExtension(ext) || "application/octet-stream"
  };
}
const values = (v) => v === void 0 ? [] : Array.isArray(v) ? v : [v];
function matchSelector(s, d) {
  var _a;
  if (s.maxSize !== void 0 && d.size !== void 0 && d.size > s.maxSize)
    return 0;
  if (s.objType && !values(s.objType).includes(d.objType ?? ""))
    return 0;
  let score = s.objType ? 2 : 1;
  if (s.schema) {
    const matches = values(s.schema).filter((v) => {
      var _a2;
      return v.endsWith("*") ? (_a2 = d.schema) == null ? void 0 : _a2.startsWith(v.slice(0, -1)) : d.schema === v;
    });
    if (!matches.length)
      return 0;
    score = matches.some((v) => v === d.schema) ? 7 : 6;
  }
  if (s.mime) {
    const mime = (d.mime ?? "").toLowerCase().split(";")[0].trim();
    const scores = values(s.mime).map((v) => {
      v = v.toLowerCase();
      if (v === "*/*")
        return 1;
      if (v.split(";")[0].trim() === mime)
        return s.objType ? 6 : 5;
      if (v.includes("/*+") && mime.startsWith(v.split("/")[0] + "/") && mime.endsWith(v.slice(v.indexOf("+"))))
        return 4;
      if (v.endsWith("/*") && mime.startsWith(v.slice(0, -1)))
        return 3;
      return 0;
    });
    const best = Math.max(...scores, 0);
    if (!best)
      return 0;
    score = Math.max(score, best);
  }
  if (!s.mime && !s.objType && !s.schema && !((_a = s.ext) == null ? void 0 : _a.includes(d.ext ?? "")))
    return 0;
  return score;
}
function compactSelector(value) {
  const out = {};
  for (const part of value.split(";")) {
    const i = part.indexOf(":");
    const key = part.slice(0, i);
    const v = part.slice(i + 1);
    if (key === "obj")
      out.objType = v;
    else if (key === "mime")
      out.mime = v;
    else if (key === "schema")
      out.schema = v;
    else if (key === "ext")
      out.ext = [v];
    else
      return {};
  }
  return out;
}
function resolveContentHandlers(registry, defaults, descriptor, intent = "open", _host = {}, availableApps = []) {
  var _a;
  const visible = new Set(availableApps);
  const handlers = { ...registry.handlers, "system#preview": previewHandler };
  const preferred = Object.entries(defaults.defaults.open ?? {}).map(([s, key]) => ({ key, score: matchSelector(compactSelector(s), descriptor) })).filter((v) => v.score > 0).sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  const matches = Object.entries(handlers).flatMap(([key, h]) => {
    const binding = h.intents[intent];
    if (!binding || !h.enabled || key !== "system#preview" && defaults.disabled.includes(key))
      return [];
    if (h.provider === "app" && (!h.app_instance_id || !visible.has(h.app_instance_id) || binding.entry.type !== "web"))
      return [];
    const selectors = h.selectors.map((selector) => ({ selector, specificity: matchSelector(selector, descriptor) })).filter((s) => s.specificity > 0).sort((a, b) => b.specificity - a.specificity);
    if (!selectors.length)
      return [];
    return [{ key, h, binding, matched: selectors[0] }];
  });
  const preferredKey = (_a = preferred.find((p) => matches.some((m) => m.key === p.key))) == null ? void 0 : _a.key;
  matches.sort((a, b) => Number(b.key === preferredKey) - Number(a.key === preferredKey) || Number(b.matched.specificity > 1 || b.h.provider === "system") - Number(a.matched.specificity > 1 || a.h.provider === "system") || b.matched.specificity - a.matched.specificity || (b.binding.priority ?? 0) - (a.binding.priority ?? 0) || Number(b.h.provider === "system") - Number(a.h.provider === "system") || (a.h.registered_at ?? 0) - (b.h.registered_at ?? 0) || a.key.localeCompare(b.key));
  return matches.map((m) => {
    var _a2;
    return {
      handlerKey: m.key,
      handlerRef: `${((_a2 = m.h.app_instance_id) == null ? void 0 : _a2.split("@")[0]) ?? "system"}#${m.h.handler_id}`,
      appInstanceId: m.h.app_instance_id,
      appDocObjectId: m.h.app_doc_object_id,
      handlerVersion: m.h.handler_version,
      intent,
      binding: m.binding,
      matched: m.matched,
      reason: m.key === preferredKey ? "user-default" : m.h.provider === "system" ? "system-default" : "ranked"
    };
  });
}
function parentSource(source) {
  if (source.kind !== "cyfs-path") {
    if (!source.innerPath || source.innerPath === "/archive")
      return void 0;
    return { kind: "object-id", objectId: source.objectId, innerPath: source.innerPath.slice(0, source.innerPath.lastIndexOf("/")) };
  }
  const i = source.path.lastIndexOf("/");
  return i >= 7 ? { kind: "cyfs-path", path: source.path.slice(0, i) || "cyfs:///" } : void 0;
}
function encodeSession(session, source) {
  if (!session)
    return "";
  const encode = (v) => btoa(Array.from(new TextEncoder().encode(JSON.stringify(v)), (b) => String.fromCharCode(b)).join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const encoded = encode(session);
  if (encoded.length <= 2048 || session.kind !== "list")
    return encoded;
  const parent = parentSource(source);
  if (parent && session.items.every((i) => contentRefString(parentSource(i.source) ?? i.source) === contentRefString(parent))) {
    return encode({ kind: "container", container: parent, current: source });
  }
  return "";
}
function expandOpenPath(path, request, modes = ["view", "edit"]) {
  if (!path.startsWith("/") || path.startsWith("//") || /(?:\.\.|\\|[\r\n])/.test(decodeURIComponent(path)))
    throw new Error("Invalid App entry path");
  const params = { source: contentRefString(request.source), mode: request.mode ?? (modes.includes("edit") ? "edit" : "view"), session: encodeSession(request.session, request.source) };
  const expanded = path.replace(/\{(source|mode|session)\}/g, (_, key) => encodeURIComponent(params[key]));
  return expanded + (expanded.includes("?") ? "&" : "?") + "requestId=" + encodeURIComponent(request.requestId);
}
function systemOpenUrl(systemOrigin, open) {
  const url = new URL("/", systemOrigin);
  url.searchParams.set("open", contentRefString(open.request.source));
  url.searchParams.set("intent", open.target);
  const session = encodeSession(open.request.session, open.request.source);
  if (session)
    url.searchParams.set("session", session);
  if (open.request.mode)
    url.searchParams.set("mode", open.request.mode);
  for (const key of ["name", "mime", "size"])
    if (open.hints[key] !== void 0)
      url.searchParams.set(key, String(open.hints[key]));
  if (open.from)
    url.searchParams.set("from", open.from);
  return url.href;
}
function parseSystemOpen(params) {
  const value = params.get("open");
  if (!value)
    return void 0;
  const source = value.startsWith("obj://") ? parseObjRefString(value) : { kind: "cyfs-path", path: value };
  if (!isTransferableRef(source))
    return void 0;
  const intent = params.get("intent");
  const target = intent === "preview" || intent === "chooser" ? intent : "default";
  const request = { source };
  const mode = params.get("mode");
  if (mode === "view" || mode === "edit")
    request.mode = mode;
  const encoded = params.get("session");
  if (encoded) {
    try {
      const session = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))));
      if (isTransferableSession(session))
        request.session = session;
    } catch {
    }
  }
  const from = params.get("from");
  return { request, target, hints: readContentHints({ name: params.get("name") ?? void 0, mime: params.get("mime") ?? void 0, size: params.get("size") ?? void 0 }), from: from && /^[\w.@-]+$/.test(from) ? from : void 0 };
}
const handlerOfApp = (plan, appId) => !!plan.appInstanceId && plan.appInstanceId.split("@")[0] === appId.split("@")[0];
class ContentRegistryClient {
  constructor(config, userId) {
    this.config = config;
    this.userId = userId;
    this.registry = { schema_version: 1, handlers: {} };
    this.defaults = emptyDefaults();
    this.updatedAt = 0;
    this.listeners = /* @__PURE__ */ new Set();
  }
  async refresh() {
    const [registry, defaults] = await Promise.all([this.config.get("system/content_registry"), this.config.get(`users/${this.userId}/content_defaults`).catch((error) => {
      if (/not found|not_found/i.test(String(error)))
        return null;
      throw error;
    })]);
    this.registry = JSON.parse(registry.value);
    this.defaults = defaults ? JSON.parse(defaults.value) : emptyDefaults();
    this.updatedAt = Date.now();
    this.listeners.forEach((cb) => cb());
  }
  async setDefault(intent, selector, handlerKey) {
    await this.refresh();
    const next = { ...this.defaults.defaults[intent] };
    if (handlerKey)
      next[selector] = handlerKey;
    else
      delete next[selector];
    await this.persist({ ...this.defaults, defaults: { ...this.defaults.defaults, [intent]: next } });
  }
  async setEnabled(key, enabled) {
    await this.refresh();
    await this.persist({ ...this.defaults, disabled: [.../* @__PURE__ */ new Set([...this.defaults.disabled.filter((k) => k !== key), ...enabled ? [] : [key]])] });
  }
  onChanged(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  async persist(next) {
    await this.config.set(`users/${this.userId}/content_defaults`, JSON.stringify(next));
    this.defaults = next;
    this.listeners.forEach((cb) => cb());
  }
}
const SELECT_DIALOG_PATH = "sysdlg/select";
const SYSTEM_DIALOG_ERROR_CODES = ["unsupported", "invalid_params", "busy", "closed", "load_failed", "protocol"];
class SystemDialogError extends Error {
  constructor(code, message) {
    super(message ?? `System dialog: ${code}`);
    this.code = code;
    this.name = "SystemDialogError";
  }
}
const isFile = (value) => typeof File !== "undefined" && value instanceof File;
const validName = (value) => typeof value === "string" && !!value && value.length <= 255 && value !== "." && value !== ".." && !/[\/\\\0]/.test(value);
function readZoneContent(value) {
  if (!value || typeof value !== "object")
    return void 0;
  const v = value;
  if (v.origin !== "zone" || v.kind !== "file" && v.kind !== "folder" || !isTransferableRef(v.source))
    return void 0;
  if (v.objId !== void 0 && !(typeof v.objId === "string" && /^[\w.-]+:[\w-]+$/.test(v.objId)))
    return void 0;
  const source = v.source.kind === "cyfs-path" ? { kind: "cyfs-path", path: v.source.path, ...typeof v.source.version === "string" ? { version: v.source.version } : {} } : { kind: "object-id", objectId: v.source.objectId, ...v.source.innerPath ? { innerPath: v.source.innerPath } : {}, ...typeof v.source.version === "string" ? { version: v.source.version } : {} };
  return { origin: "zone", kind: v.kind, source, ...v.objId ? { objId: v.objId } : {}, hints: readContentHints(v.hints) };
}
function readSelectedContent(value) {
  if (!value || typeof value !== "object")
    return void 0;
  const v = value;
  if (v.origin === "zone")
    return readZoneContent(v);
  if (v.origin !== "local")
    return void 0;
  if (v.kind === "file")
    return isFile(v.file) ? { origin: "local", kind: "file", file: v.file, hints: readContentHints(v.hints) } : void 0;
  if (v.kind !== "folder" || !validName(v.name) || !Array.isArray(v.files))
    return void 0;
  const files = [];
  for (const entry of v.files) {
    if (!entry || !isFile(entry.file) || typeof entry.relativePath !== "string")
      return void 0;
    const parts = entry.relativePath.split("/");
    if (parts.length < 2 || parts[0] !== v.name || !parts.every(validName))
      return void 0;
    files.push({ file: entry.file, relativePath: entry.relativePath });
  }
  return { origin: "local", kind: "folder", name: v.name, files };
}
function readSelectDialogResult(value, options = {}) {
  var _a;
  if (!value || typeof value !== "object")
    return void 0;
  const v = value;
  if (v.action === "cancelled")
    return { action: "cancelled" };
  if (v.action === "save") {
    const parent = v.parent;
    return isTransferableRef(parent) && parent.kind === "cyfs-path" && validName(v.name) && typeof v.overwrite === "boolean" ? { action: "save", parent, name: v.name, overwrite: v.overwrite } : void 0;
  }
  if (v.action !== "selected" || !Array.isArray(v.items) || !v.items.length || v.items.length > 500)
    return void 0;
  const items = [];
  for (const raw of v.items) {
    const item = readSelectedContent(raw);
    if (!item || item.origin !== (((_a = items[0]) == null ? void 0 : _a.origin) ?? item.origin) || item.origin === "local" && !options.allowLocal)
      return void 0;
    items.push(item);
  }
  return { action: "selected", items };
}
export {
  ContentRegistryClient,
  SELECT_DIALOG_PATH,
  SYSTEM_DIALOG_ERROR_CODES,
  SystemDialogError,
  TEXT_CODE_EXTENSIONS,
  contentDescriptor,
  contentRefString,
  emptyDefaults,
  encodeSession,
  expandOpenPath,
  extensionOf,
  handlerOfApp,
  heifImageSize,
  isArchiveInnerPath,
  isOpenRequest,
  isTransferableRef,
  isTransferableSession,
  isoBoxes,
  matchSelector,
  mediaTypeFromExtension,
  parentSource,
  parseObjRefString,
  parseSystemOpen,
  previewHandler,
  readContentHints,
  readSelectDialogResult,
  readZoneContent,
  resolveContentHandlers,
  sniffMagic,
  stripMediaTypeParams,
  systemOpenUrl
};
//# sourceMappingURL=content.mjs.map
