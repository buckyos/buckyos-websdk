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
const previewHandler = {
  provider: "system",
  handler_id: "preview",
  handler_version: 1,
  selectors: [{ mime: "*/*" }],
  enabled: true,
  intents: { open: { entry: { type: "builtin", target: "preview" }, modes: ["view"], fidelity: "partial", window: "reuse", priority: 90 } }
};
const emptyDefaults = () => ({ schema_version: 1, defaults: {}, disabled: [] });
const contentRefString = (ref) => ref.kind === "cyfs-path" ? ref.path : `obj://${ref.objectId}`;
function isTransferableRef(value) {
  if (!value || typeof value !== "object")
    return false;
  const v = value;
  return v.kind === "cyfs-path" && typeof v.path === "string" && /^cyfs:\/\/\/[^\0]*$/.test(v.path) || v.kind === "object-id" && typeof v.objectId === "string" && /^[\w.-]+:[\w-]+$/.test(v.objectId);
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
  const name = hints.name ?? contentRefString(source).split("/").pop() ?? "";
  const ext = extensionOf(name);
  return {
    source,
    name,
    size: hints.size,
    ext: ext ? `.${ext}` : void 0,
    objType: source.kind === "cyfs-path" ? "cyfile" : source.objectId.split(":")[0],
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
  if (source.kind !== "cyfs-path")
    return void 0;
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
export {
  ContentRegistryClient,
  TEXT_CODE_EXTENSIONS,
  contentDescriptor,
  contentRefString,
  emptyDefaults,
  encodeSession,
  expandOpenPath,
  extensionOf,
  isOpenRequest,
  isTransferableRef,
  isTransferableSession,
  matchSelector,
  mediaTypeFromExtension,
  parentSource,
  previewHandler,
  resolveContentHandlers
};
//# sourceMappingURL=content.mjs.map
