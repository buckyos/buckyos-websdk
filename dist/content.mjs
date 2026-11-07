import { e as extensionOf, m as mediaTypeFromExtension } from "./content_mime-e42d5f8d.mjs";
import { T, h, i, s, a } from "./content_mime-e42d5f8d.mjs";
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
  return v.kind === "single" || v.kind === "container" && isTransferableRef(v.container) && isTransferableRef(v.current) || v.kind === "list" && Array.isArray(v.items) && v.items.every((i2) => i2 && isTransferableRef(i2.source)) && Number.isInteger(v.currentIndex) && v.currentIndex >= 0 && v.currentIndex < v.items.length;
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
function matchSelector(s2, d) {
  var _a;
  if (s2.maxSize !== void 0 && d.size !== void 0 && d.size > s2.maxSize)
    return 0;
  if (s2.objType && !values(s2.objType).includes(d.objType ?? ""))
    return 0;
  let score = s2.objType ? 2 : 1;
  if (s2.schema) {
    const matches = values(s2.schema).filter((v) => {
      var _a2;
      return v.endsWith("*") ? (_a2 = d.schema) == null ? void 0 : _a2.startsWith(v.slice(0, -1)) : d.schema === v;
    });
    if (!matches.length)
      return 0;
    score = matches.some((v) => v === d.schema) ? 7 : 6;
  }
  if (s2.mime) {
    const mime = (d.mime ?? "").toLowerCase().split(";")[0].trim();
    const scores = values(s2.mime).map((v) => {
      v = v.toLowerCase();
      if (v === "*/*")
        return 1;
      if (v.split(";")[0].trim() === mime)
        return s2.objType ? 6 : 5;
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
  if (!s2.mime && !s2.objType && !s2.schema && !((_a = s2.ext) == null ? void 0 : _a.includes(d.ext ?? "")))
    return 0;
  return score;
}
function compactSelector(value) {
  const out = {};
  for (const part of value.split(";")) {
    const i2 = part.indexOf(":");
    const key = part.slice(0, i2);
    const v = part.slice(i2 + 1);
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
  const preferred = Object.entries(defaults.defaults.open ?? {}).map(([s2, key]) => ({ key, score: matchSelector(compactSelector(s2), descriptor) })).filter((v) => v.score > 0).sort((a2, b) => b.score - a2.score || a2.key.localeCompare(b.key));
  const matches = Object.entries(handlers).flatMap(([key, h2]) => {
    const binding = h2.intents[intent];
    if (!binding || !h2.enabled || key !== "system#preview" && defaults.disabled.includes(key))
      return [];
    if (h2.provider === "app" && (!h2.app_instance_id || !visible.has(h2.app_instance_id) || binding.entry.type !== "web"))
      return [];
    const selectors = h2.selectors.map((selector) => ({ selector, specificity: matchSelector(selector, descriptor) })).filter((s2) => s2.specificity > 0).sort((a2, b) => b.specificity - a2.specificity);
    if (!selectors.length)
      return [];
    return [{ key, h: h2, binding, matched: selectors[0] }];
  });
  const preferredKey = (_a = preferred.find((p) => matches.some((m) => m.key === p.key))) == null ? void 0 : _a.key;
  matches.sort((a2, b) => Number(b.key === preferredKey) - Number(a2.key === preferredKey) || Number(b.matched.specificity > 1 || b.h.provider === "system") - Number(a2.matched.specificity > 1 || a2.h.provider === "system") || b.matched.specificity - a2.matched.specificity || (b.binding.priority ?? 0) - (a2.binding.priority ?? 0) || Number(b.h.provider === "system") - Number(a2.h.provider === "system") || (a2.h.registered_at ?? 0) - (b.h.registered_at ?? 0) || a2.key.localeCompare(b.key));
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
  const i2 = source.path.lastIndexOf("/");
  return i2 >= 7 ? { kind: "cyfs-path", path: source.path.slice(0, i2) || "cyfs:///" } : void 0;
}
function encodeSession(session, source) {
  if (!session)
    return "";
  const encode = (v) => btoa(Array.from(new TextEncoder().encode(JSON.stringify(v)), (b) => String.fromCharCode(b)).join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const encoded = encode(session);
  if (encoded.length <= 2048 || session.kind !== "list")
    return encoded;
  const parent = parentSource(source);
  if (parent && session.items.every((i2) => contentRefString(parentSource(i2.source) ?? i2.source) === contentRefString(parent))) {
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
  const source = value.startsWith("obj://") ? { kind: "object-id", objectId: value.slice(6) } : { kind: "cyfs-path", path: value };
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
export {
  ContentRegistryClient,
  T as TEXT_CODE_EXTENSIONS,
  contentDescriptor,
  contentRefString,
  emptyDefaults,
  encodeSession,
  expandOpenPath,
  extensionOf,
  handlerOfApp,
  h as heifImageSize,
  isOpenRequest,
  isTransferableRef,
  isTransferableSession,
  i as isoBoxes,
  matchSelector,
  mediaTypeFromExtension,
  parentSource,
  parseSystemOpen,
  previewHandler,
  readContentHints,
  resolveContentHandlers,
  s as sniffMagic,
  a as stripMediaTypeParams,
  systemOpenUrl
};
//# sourceMappingURL=content.mjs.map
