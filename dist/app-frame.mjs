import { SystemDialogError, isOpenRequest, readContentHints, readSelectDialogResult, systemOpenUrl, SELECT_DIALOG_PATH, isTransferableRef, isTransferableSession, SYSTEM_DIALOG_ERROR_CODES } from "./content.mjs";
import { readAppOpenRequest, systemOpenAppUrl } from "./open-app.mjs";
import { g as getBuckyApi } from "./runtime_env-39e4df98.mjs";
import "./object_url-20e94b67.mjs";
import "./ndn_types-0fac2499.mjs";
const dialogErrorCode = (value) => SYSTEM_DIALOG_ERROR_CODES.includes(value) ? value : "protocol";
const text = (value, max) => typeof value === "string" ? value.slice(0, max) : void 0;
function readHeaderList(value, read) {
  if (!Array.isArray(value))
    return [];
  return value.slice(0, 32).flatMap((entry) => {
    const v = entry;
    if (!v || typeof v !== "object" || typeof v.id !== "string" || !v.id || v.id.length > 128 || typeof v.label !== "string")
      return [];
    return [read(v, { id: v.id, label: v.label.slice(0, 128) })];
  });
}
function readHeader(p) {
  const header = {};
  const title = text(p.title, 256);
  if (title !== void 0)
    header.title = title;
  if (Array.isArray(p.second_row))
    header.second_row = readHeaderList(p.second_row, (v, base) => ({ ...base, ...v.active === true ? { active: true } : {} }));
  if (Array.isArray(p.menu))
    header.menu = readHeaderList(p.menu, (v, base) => ({ ...base, ...typeof v.icon === "string" ? { icon: v.icon.slice(0, 2048) } : {}, ...v.danger === true ? { danger: true } : {} }));
  if (p.search === null)
    header.search = null;
  else if (p.search && typeof p.search === "object") {
    const search = p.search;
    const placeholder = text(search.placeholder, 128), value = text(search.value, 1024);
    header.search = { ...placeholder !== void 0 ? { placeholder } : {}, ...value !== void 0 ? { value } : {} };
  }
  if (typeof p.back === "boolean")
    header.back = p.back;
  return header;
}
function windowTransport(peer, origin) {
  return {
    post: (message) => {
      var _a;
      return (_a = peer()) == null ? void 0 : _a.postMessage(message, origin);
    },
    onMessage: (cb) => {
      const own = window;
      const listener = (event) => {
        if (event.source === peer() && event.origin === origin)
          cb(event.data);
      };
      own.addEventListener("message", listener);
      return () => own.removeEventListener("message", listener);
    }
  };
}
function bridgeTransport(api) {
  return {
    post: (message) => {
      void Promise.resolve(api.call("frame.post", message)).catch(() => {
      });
    },
    onMessage: (cb) => api.on("frame.message", cb)
  };
}
const envelope = (type, payload, extra = {}) => ({ protocol: "buckyos.app-frame", version: 1, type, payload, ...extra });
const isMessage = (value) => {
  if (!value || typeof value !== "object")
    return false;
  const v = value;
  return v.protocol === "buckyos.app-frame" && v.version === 1 && typeof v.type === "string" && !!v.payload && typeof v.payload === "object";
};
const FRAME_NAME_PREFIX = "buckyos.app-frame:";
function appFrameName(nonce) {
  return FRAME_NAME_PREFIX + nonce;
}
const OPEN_LIMIT = 5;
class AppFrameHost {
  constructor(options) {
    this.ready = false;
    this.capabilities = [];
    this.header = {};
    this.pending = /* @__PURE__ */ new Map();
    this.opens = /* @__PURE__ */ new Map();
    this.dialogOpen = false;
    this.callbacks = options;
    this.framed = !options.transport;
    this.init = options.transport ? { ...options.init, nonce: "" } : options.init;
    this.channel = options.transport ?? windowTransport(options.target, options.origin);
    this.detach = this.channel.onMessage((message) => this.receive(message));
  }
  limited(type) {
    const recent = (this.opens.get(type) ?? []).filter((t) => t > Date.now() - 1e4);
    this.opens.set(type, recent);
    if (recent.length >= OPEN_LIMIT)
      return true;
    recent.push(Date.now());
    return false;
  }
  async appOpen(id, payload) {
    const reply = (result) => {
      if (this.ready)
        this.channel.post(envelope("app.openResult", result, { replyTo: id }));
    };
    if (!this.callbacks.onAppOpen)
      return reply({ ok: false, code: "unsupported" });
    const request = readAppOpenRequest(payload);
    if (!request || this.limited("app.open"))
      return reply({ ok: false, code: "denied" });
    try {
      reply(await this.callbacks.onAppOpen(request));
    } catch {
      reply({ ok: false, code: "denied" });
    }
  }
  async systemDialog(id, path, params) {
    const reply = (payload) => {
      if (this.ready)
        this.channel.post(envelope("sysdlg.openResult", payload, { replyTo: id }));
    };
    if (!this.callbacks.onSystemDialog || typeof path !== "string")
      return reply({ ok: false, code: "unsupported" });
    if (this.dialogOpen)
      return reply({ ok: false, code: "busy" });
    this.dialogOpen = true;
    try {
      reply(await this.callbacks.onSystemDialog(path, params));
    } catch (error) {
      reply({ ok: false, code: error instanceof SystemDialogError ? error.code : "closed" });
    } finally {
      this.dialogOpen = false;
    }
  }
  receive(m) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l;
    if (!isMessage(m))
      return;
    const p = m.payload;
    if (m.type === "frame.hello") {
      if (!Array.isArray(p.appCapabilities))
        return;
      if (this.framed) {
        if (p.nonce !== this.init.nonce)
          return;
      } else {
        if (typeof p.nonce !== "string" || !p.nonce || p.nonce.length > 128)
          return;
        if (p.nonce !== this.init.nonce)
          this.failPending("App frame reloaded");
        this.init = { ...this.init, nonce: p.nonce };
      }
      this.ready = true;
      this.capabilities = p.appCapabilities.filter((c) => typeof c === "string");
      this.send("frame.init", this.init);
      if (this.focused !== void 0)
        this.send("frame.focusChanged", { focused: this.focused });
      if (Object.keys(this.header).length) {
        this.header = {};
        (_b = (_a = this.callbacks).onHeader) == null ? void 0 : _b.call(_a, {});
      }
      (_d = (_c = this.callbacks).onReady) == null ? void 0 : _d.call(_c);
      return;
    }
    if (!this.ready)
      return;
    if (m.replyTo) {
      const pending = this.pending.get(m.replyTo);
      if (pending && m.type === pending.type + "Result") {
        clearTimeout(pending.timer);
        this.pending.delete(m.replyTo);
        pending.resolve(m.payload);
      }
      return;
    }
    if (m.type === "window.setTitle" && typeof p.title === "string")
      (_f = (_e = this.callbacks).onTitle) == null ? void 0 : _f.call(_e, p.title.slice(0, 256), p.dirty === true);
    if (m.type === "window.requestClose")
      (_h = (_g = this.callbacks).onRequestClose) == null ? void 0 : _h.call(_g);
    if (m.type === "header.set") {
      this.header = { ...this.header, ...readHeader(p) };
      (_j = (_i = this.callbacks).onHeader) == null ? void 0 : _j.call(_i, this.header);
    }
    if (m.type === "app.open" && typeof m.id === "string")
      void this.appOpen(m.id, p);
    if (m.type === "sysdlg.open" && typeof m.id === "string")
      void this.systemDialog(m.id, p.path, p.params);
    if (m.type === "content.open" && (p.target === "default" || p.target === "preview" || p.target === "chooser")) {
      const request = { ...p.request, requestId: crypto.randomUUID() };
      if (!isOpenRequest(request) || this.limited("content.open"))
        return;
      (_l = (_k = this.callbacks).onContentOpen) == null ? void 0 : _l.call(_k, request, p.target, { newWindow: p.newWindow === true, hints: readContentHints(p.hints) });
    }
  }
  update(init) {
    this.init = { ...this.init, ...init };
  }
  /** Reports whether the App's window is the focused one; only a change is sent. */
  setFocused(focused) {
    if (this.focused === focused)
      return;
    this.focused = focused;
    this.send("frame.focusChanged", { focused });
  }
  /** Tells the App what happened in the header the host draws for it. */
  headerEvent(event) {
    this.send("header.event", event);
  }
  send(type, payload) {
    if (this.ready)
      this.channel.post(envelope(type, payload));
  }
  request(type, payload, timeout = 3e3) {
    if (!this.ready)
      return Promise.reject(new Error("App frame is not ready"));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("App frame timed out"));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer, type });
      this.channel.post(envelope(type, payload, { id }));
    });
  }
  async open(request) {
    if (!this.capabilities.includes("open"))
      return { accepted: false };
    return await this.request("frame.open", { request });
  }
  async beforeClose(reason = "user") {
    if (!this.ready || !this.capabilities.includes("beforeClose"))
      return "allow";
    const r = await this.request("frame.beforeClose", { reason });
    return r.decision === "allow" || r.decision === "pending" ? r.decision : "deny";
  }
  async back() {
    if (!this.capabilities.includes("back"))
      return false;
    return (await this.request("frame.back", {})).handled === true;
  }
  failPending(reason) {
    this.pending.forEach((p) => {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    });
    this.pending.clear();
  }
  dispose() {
    this.detach();
    this.failPending("App frame disposed");
    this.ready = false;
  }
}
function embedderOrigin(accept) {
  var _a;
  if (window.parent === window)
    return getBuckyApi() && accept(window.location.origin) ? window.location.origin : null;
  const candidates = [(_a = window.location.ancestorOrigins) == null ? void 0 : _a[0], document.referrer];
  for (const candidate of candidates) {
    if (!candidate)
      continue;
    try {
      const origin = new URL(candidate).origin;
      if (accept(origin))
        return origin;
    } catch {
    }
  }
  return null;
}
const originInZone = (origin, zoneHost) => {
  try {
    const url = new URL(origin);
    return url.protocol === window.location.protocol && (url.hostname === zoneHost || url.hostname.endsWith(`.${zoneHost}`));
  } catch {
    return false;
  }
};
class AppFrameClient {
  constructor(options) {
    this.options = options;
    this.header = {};
    this.dialogs = /* @__PURE__ */ new Map();
    this.appOpens = /* @__PURE__ */ new Map();
    const origin = new URL(options.shellOrigin).origin;
    const bridge = window.parent === window ? getBuckyApi() : void 0;
    this.native = !!bridge;
    const name = window.parent !== window ? window.name : "";
    this.nonce = (name == null ? void 0 : name.startsWith(FRAME_NAME_PREFIX)) ? name.slice(FRAME_NAME_PREFIX.length) : new URLSearchParams(window.location.hash.slice(1)).get("bfp") ?? (bridge ? crypto.randomUUID() : null);
    this.channel = bridge ? bridgeTransport(bridge) : windowTransport(() => window.parent, origin);
    this.detach = this.channel.onMessage((message) => {
      void this.receive(message);
    });
    if ((bridge || window.parent !== window) && this.nonce) {
      const hello = () => this.channel.post(envelope("frame.hello", { nonce: this.nonce, appCapabilities: [
        ...options.onOpen ? ["open"] : [],
        ...options.onBeforeClose ? ["beforeClose"] : [],
        ...options.onBack ? ["back"] : []
      ] }));
      hello();
      this.helloTimer = setInterval(hello, 250);
      this.helloDeadline = setTimeout(() => clearInterval(this.helloTimer), bridge ? 1e4 : 1500);
    }
  }
  async receive(m) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q;
    if (!isMessage(m))
      return;
    const p = m.payload;
    if (m.type === "frame.init") {
      if (!this.nonce || p.nonce !== this.nonce || typeof p.locale !== "string" || !p.theme || typeof p.windowId !== "string" || p.launch && !isOpenRequest(p.launch))
        return;
      clearInterval(this.helloTimer);
      clearTimeout(this.helloDeadline);
      this.init = p;
      this.title = void 0;
      this.focused = void 0;
      if (Object.keys(this.header).length)
        this.send("header.set", this.header);
      (_b = (_a = this.options).onInit) == null ? void 0 : _b.call(_a, this.init);
      return;
    }
    if (!this.init)
      return;
    if (m.type === "sysdlg.openResult") {
      const pending = m.replyTo ? this.dialogs.get(m.replyTo) : void 0;
      if (!pending)
        return;
      this.dialogs.delete(m.replyTo);
      if (p.ok !== true)
        return pending.reject(new SystemDialogError(dialogErrorCode(p.code)));
      const result = readSelectDialogResult(p.result, { allowLocal: pending.allowLocal });
      if (result)
        pending.resolve(result);
      else
        pending.reject(new SystemDialogError("protocol"));
      return;
    }
    if (m.type === "app.openResult") {
      const code = p.code === "not_found" || p.code === "denied" ? p.code : "unsupported";
      if (m.replyTo)
        (_c = this.appOpens.get(m.replyTo)) == null ? void 0 : _c(p.ok === true ? { ok: true } : { ok: false, code });
      return;
    }
    if (m.type === "header.event") {
      if (p.kind !== "search" && p.kind !== "item" && p.kind !== "menu")
        return;
      (_e = (_d = this.options).onHeaderEvent) == null ? void 0 : _e.call(_d, { kind: p.kind, ...typeof p.id === "string" ? { id: p.id } : {}, ...typeof p.value === "string" ? { value: p.value } : {} });
      return;
    }
    const reply = (payload) => this.channel.post(envelope(m.type + "Result", payload, { replyTo: m.id }));
    try {
      if (m.type === "frame.open" && isOpenRequest(p.request))
        reply(await ((_g = (_f = this.options).onOpen) == null ? void 0 : _g.call(_f, p.request)) ?? { accepted: false });
      if (m.type === "frame.beforeClose")
        reply({ decision: await ((_i = (_h = this.options).onBeforeClose) == null ? void 0 : _i.call(_h, p.reason)) ?? "allow" });
      if (m.type === "frame.back")
        reply({ handled: await ((_k = (_j = this.options).onBack) == null ? void 0 : _k.call(_j)) ?? false });
      if (m.type === "frame.themeChanged" && (p.mode === "dark" || p.mode === "light"))
        (_m = (_l = this.options).onTheme) == null ? void 0 : _m.call(_l, p);
      if (m.type === "frame.localeChanged" && typeof p.locale === "string")
        (_o = (_n = this.options).onLocale) == null ? void 0 : _o.call(_n, p.locale);
      if (m.type === "frame.focusChanged" && this.focused !== (p.focused === true)) {
        this.focused = p.focused === true;
        (_q = (_p = this.options).onFocus) == null ? void 0 : _q.call(_p, this.focused);
      }
    } catch {
      if (m.type === "frame.open")
        reply({ accepted: false, fallback: "preview" });
      if (m.type === "frame.beforeClose")
        reply({ decision: "deny" });
    }
  }
  send(type, payload) {
    if (this.init)
      this.channel.post(envelope(type, payload));
  }
  setTitle(title, dirty = false) {
    const key = JSON.stringify([title, dirty]);
    if (!this.init || key === this.title)
      return;
    this.title = key;
    this.send("window.setTitle", { title, dirty });
  }
  requestClose() {
    this.send("window.requestClose", {});
  }
  /** Sets what the host shows in the header above this App. It may be called before the handshake. */
  setHeader(header) {
    this.header = { ...this.header, ...header };
    this.send("header.set", header);
  }
  /**
   * Opens another App, or a page of one, in this App's Zone (or in `zone`). The host decides between a new window and
   * an open one. In a standalone tab it opens the Zone's system entry (`systemOrigin`) in a new tab, which only reaches
   * this App's own Zone. Never rejects.
   */
  openApp(request) {
    const clean = readAppOpenRequest(request);
    if (!clean)
      return Promise.resolve({ ok: false, code: "denied" });
    if (this.init) {
      if (!this.init.shellCapabilities.includes("app.open"))
        return Promise.resolve({ ok: false, code: "unsupported" });
      const id = crypto.randomUUID();
      return new Promise((resolve) => {
        const settle = (reply) => {
          clearTimeout(timer);
          this.appOpens.delete(id);
          resolve(reply);
        };
        const timer = setTimeout(() => settle({ ok: false, code: "unsupported" }), 3e4);
        this.appOpens.set(id, settle);
        this.channel.post(envelope("app.open", clean, { id }));
      });
    }
    if (!this.options.systemOrigin || clean.zone)
      return Promise.resolve({ ok: false, code: "unsupported" });
    window.open(systemOpenAppUrl(this.options.systemOrigin, clean), "_blank", "noopener");
    return Promise.resolve({ ok: true });
  }
  /**
   * Asks the system to open content: with its default app, in Preview, or by letting the user choose (`chooser`).
   * Inside the shell or the BuckyOS client the request goes to the host; in a standalone tab it opens the Zone's system
   * entry (`systemOrigin`) in a new tab. Returns false when neither is available.
   */
  openContent(request, target = "default", options = {}) {
    const hints = options.hints ?? {};
    if (this.init) {
      this.send("content.open", { request, target, newWindow: options.newWindow === true, hints });
      return true;
    }
    if (!this.options.systemOrigin)
      return false;
    window.open(systemOpenUrl(this.options.systemOrigin, { request, target, hints, from: this.options.appId }), "_blank", "noopener");
    return true;
  }
  /**
   * Shows the system file picker (`sysdlg/select`) and resolves with what the user chose; cancelling resolves with
   * `{ action: 'cancelled' }`. Embedded in the shell the shell draws the dialog over this App's window; in a
   * standalone tab, and in the BuckyOS client unless it lists the dialog, the picker page of the Zone's system entry
   * (`systemOrigin`) is framed over this page. Rejects with a `SystemDialogError` when no picker is available or the
   * request did not complete.
   */
  selectContent(params = {}, options = {}) {
    var _a, _b, _c;
    const offered = (_a = this.init) == null ? void 0 : _a.shellCapabilities.includes(SELECT_DIALOG_PATH);
    if (this.init && (offered || !this.native)) {
      if (!offered)
        return Promise.reject(new SystemDialogError("unsupported"));
      if (this.dialogs.size)
        return Promise.reject(new SystemDialogError("busy"));
      const id = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        this.dialogs.set(id, { resolve, reject, allowLocal: params.allowLocal === true });
        this.channel.post(envelope("sysdlg.open", { path: SELECT_DIALOG_PATH, params }, { id }));
      });
    }
    if (!this.options.systemOrigin)
      return Promise.reject(new SystemDialogError("unsupported"));
    const abort = this.embedAbort = new AbortController();
    (_b = options.signal) == null ? void 0 : _b.addEventListener("abort", () => abort.abort(), { once: true });
    if ((_c = options.signal) == null ? void 0 : _c.aborted)
      abort.abort();
    return openSelectEmbed(this.options.systemOrigin, params, { ...options, signal: abort.signal });
  }
  dispose() {
    var _a;
    clearInterval(this.helloTimer);
    clearTimeout(this.helloDeadline);
    this.detach();
    this.appOpens.forEach((settle) => settle({ ok: false, code: "unsupported" }));
    this.dialogs.forEach((pending) => pending.reject(new SystemDialogError("closed")));
    this.dialogs.clear();
    (_a = this.embedAbort) == null ? void 0 : _a.abort();
  }
}
const PREVIEW_EMBED = "buckyos.preview-embed";
const embedEnvelope = (type, payload, protocol = PREVIEW_EMBED) => ({ protocol, version: 1, type, payload });
const isEmbedMessage = (value, protocol = PREVIEW_EMBED) => {
  const v = value;
  return !!v && v.protocol === protocol && v.version === 1 && typeof v.type === "string" && !!v.payload && typeof v.payload === "object";
};
const isEmbedSource = (value) => isTransferableRef(value) || !!value && typeof value === "object" && value.kind === "blob" && typeof Blob !== "undefined" && value.blob instanceof Blob && typeof value.name === "string";
const PREVIEW_EMBED_PATH = "/embed/preview";
class PreviewEmbed {
  constructor(options) {
    this.options = options;
    this.nonce = crypto.randomUUID();
    this.listener = (event) => this.receive(event);
    this.ready = false;
    this.origin = new URL(options.systemOrigin).origin;
    this.init = options.init;
    this.url = `${this.origin}${PREVIEW_EMBED_PATH}#bpe=${this.nonce}&po=${encodeURIComponent(window.location.origin)}`;
    window.addEventListener("message", this.listener);
  }
  post(type, payload) {
    var _a, _b;
    (_b = (_a = this.options.frame()) == null ? void 0 : _a.contentWindow) == null ? void 0 : _b.postMessage(embedEnvelope(type, payload), this.origin);
  }
  receive(event) {
    var _a, _b, _c, _d, _e, _f, _g;
    if (event.origin !== this.origin || event.source !== ((_a = this.options.frame()) == null ? void 0 : _a.contentWindow) || !isEmbedMessage(event.data))
      return;
    const { type, payload: p } = event.data;
    if (type === "embed.hello") {
      if (p.nonce === this.nonce) {
        this.ready = true;
        this.post("embed.init", { ...this.init, nonce: this.nonce });
      }
      return;
    }
    if (type === "embed.state" && (p.status === "loading" || p.status === "ready" || p.status === "error")) {
      const error = p.error;
      (_c = (_b = this.options).onState) == null ? void 0 : _c.call(_b, {
        status: p.status,
        error: error && typeof error.kind === "string" && typeof error.code === "string" ? { kind: error.kind, code: error.code } : void 0,
        title: typeof p.title === "string" ? p.title.slice(0, 256) : void 0,
        mediaType: typeof p.mediaType === "string" ? p.mediaType.slice(0, 128) : void 0
      });
    }
    if (type === "embed.openWith") {
      const request = p.request;
      if (request && isTransferableRef(request.source) && (request.session === void 0 || isTransferableSession(request.session))) {
        (_e = (_d = this.options).onOpenWith) == null ? void 0 : _e.call(_d, { request: { source: request.source, session: request.session }, hints: readContentHints(p.hints) });
      }
    }
    if (type === "embed.exit")
      (_g = (_f = this.options).onExit) == null ? void 0 : _g.call(_f);
  }
  update(patch) {
    this.init = { ...this.init, ...patch };
    if (this.ready)
      this.post("embed.update", patch);
  }
  dispose() {
    window.removeEventListener("message", this.listener);
  }
}
class PreviewEmbedHost {
  constructor(options) {
    this.options = options;
    this.ready = false;
    this.listener = (event) => this.receive(event);
    const params = new URLSearchParams(window.location.hash.slice(1));
    this.nonce = params.get("bpe");
    let parentOrigin = null;
    try {
      parentOrigin = new URL(params.get("po") ?? "").origin;
    } catch {
    }
    this.parentOrigin = window.parent !== window && this.nonce && parentOrigin && options.accept(parentOrigin) ? parentOrigin : null;
    if (!this.parentOrigin)
      return;
    window.addEventListener("message", this.listener);
    const hello = () => window.parent.postMessage(embedEnvelope("embed.hello", { nonce: this.nonce }), this.parentOrigin);
    hello();
    this.hello = setInterval(() => {
      if (!this.ready)
        hello();
    }, 250);
  }
  receive(event) {
    var _a, _b;
    if (event.source !== window.parent || event.origin !== this.parentOrigin || !isEmbedMessage(event.data))
      return;
    const { type, payload: p } = event.data;
    if (type === "embed.init") {
      if (p.nonce !== this.nonce || !isEmbedSource(p.source) || p.session !== void 0 && !isTransferableSession(p.session) || typeof p.locale !== "string")
        return;
      this.ready = true;
      clearInterval(this.hello);
      this.options.onInit({ nonce: String(p.nonce), source: p.source, session: p.session, theme: p.theme === "dark" ? "dark" : "light", locale: p.locale });
      return;
    }
    if (type === "embed.update" && this.ready) {
      const patch = {};
      if (p.theme === "dark" || p.theme === "light")
        patch.theme = p.theme;
      if (typeof p.locale === "string")
        patch.locale = p.locale;
      (_b = (_a = this.options).onUpdate) == null ? void 0 : _b.call(_a, patch);
    }
  }
  post(type, payload) {
    if (this.ready && this.parentOrigin)
      window.parent.postMessage(embedEnvelope(type, payload), this.parentOrigin);
  }
  state(state) {
    this.post("embed.state", state);
  }
  openWith(open) {
    this.post("embed.openWith", open);
  }
  exit() {
    this.post("embed.exit", {});
  }
  dispose() {
    clearInterval(this.hello);
    window.removeEventListener("message", this.listener);
  }
}
const SYSDLG_EMBED = "buckyos.sysdlg-embed";
const SELECT_EMBED_PATH = "/embed/sysdlg/select";
let selectEmbedOpen = false;
function openSelectEmbed(systemOrigin, params, options = {}) {
  var _a, _b;
  if ((_a = options.signal) == null ? void 0 : _a.aborted)
    return Promise.reject(new SystemDialogError("closed"));
  if (selectEmbedOpen)
    return Promise.reject(new SystemDialogError("busy"));
  selectEmbedOpen = true;
  const origin = new URL(systemOrigin).origin;
  const locale = options.locale ?? navigator.language ?? "en";
  const theme = options.theme ?? (((_b = window.matchMedia) == null ? void 0 : _b.call(window, "(prefers-color-scheme: dark)").matches) ? "dark" : "light");
  const zh = locale.toLowerCase().startsWith("zh");
  return new Promise((resolve, reject) => {
    var _a2;
    const body = document.body;
    const html = document.documentElement;
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const scroll = { x: window.scrollX, y: window.scrollY };
    const saved = { body: body.getAttribute("style"), html: html.getAttribute("style") };
    const siblings = Array.from(body.children).filter((el) => el instanceof HTMLElement).map((el) => ({ el, inert: el.inert, hidden: el.getAttribute("aria-hidden") }));
    const root = document.createElement("div");
    root.setAttribute("data-buckyos-sysdlg", "select");
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", zh ? "文件选择器" : "File picker");
    root.style.cssText = "position:fixed;inset:0;height:100vh;height:100dvh;z-index:2147483647;background:rgba(0,0,0,.32);display:flex;align-items:center;justify-content:center";
    let frame;
    let nonce = "";
    let timer;
    let done = false;
    const block = (event) => {
      if (!root.contains(event.target)) {
        event.stopPropagation();
        event.preventDefault();
      }
    };
    const blocked = ["keydown", "pointerdown", "mousedown", "touchstart", "wheel"];
    const cleanup = () => {
      var _a3;
      if (done)
        return false;
      done = true;
      selectEmbedOpen = false;
      clearTimeout(timer);
      window.removeEventListener("message", receive);
      (_a3 = options.signal) == null ? void 0 : _a3.removeEventListener("abort", abort);
      if (!("inert" in HTMLElement.prototype))
        blocked.forEach((type) => document.removeEventListener(type, block, true));
      root.remove();
      siblings.forEach(({ el, inert, hidden }) => {
        el.inert = inert;
        if (hidden === null)
          el.removeAttribute("aria-hidden");
        else
          el.setAttribute("aria-hidden", hidden);
      });
      if (saved.body === null)
        body.removeAttribute("style");
      else
        body.setAttribute("style", saved.body);
      if (saved.html === null)
        html.removeAttribute("style");
      else
        html.setAttribute("style", saved.html);
      window.scrollTo(scroll.x, scroll.y);
      focused == null ? void 0 : focused.focus({ preventScroll: true });
      return true;
    };
    const finish = (result) => {
      if (cleanup())
        resolve(result);
    };
    const fail = (code) => {
      if (cleanup())
        reject(new SystemDialogError(code));
    };
    const abort = () => fail("closed");
    const showFailure = () => {
      frame == null ? void 0 : frame.remove();
      frame = void 0;
      const panel = document.createElement("div");
      panel.setAttribute("role", "alert");
      panel.style.cssText = `max-width:22rem;margin:1rem;padding:1.25rem;border-radius:16px;font:14px/1.6 system-ui,sans-serif;background:${theme === "dark" ? "#1f2329" : "#fff"};color:${theme === "dark" ? "#f2f3f5" : "#1f2329"};box-shadow:0 24px 64px rgba(0,0,0,.24)`;
      const text2 = document.createElement("p");
      text2.style.margin = "0 0 1rem";
      text2.textContent = zh ? "无法加载文件选择器" : "Unable to load the file picker";
      const actions = document.createElement("div");
      actions.style.cssText = "display:flex;gap:.5rem;justify-content:flex-end";
      const button = (label, action) => {
        const el = document.createElement("button");
        el.type = "button";
        el.textContent = label;
        el.style.cssText = "min-height:2.25rem;padding:0 1rem;font:inherit;border-radius:999px;border:1px solid currentColor;background:transparent;color:inherit;cursor:pointer";
        el.addEventListener("click", action);
        actions.append(el);
        return el;
      };
      button(zh ? "取消" : "Cancel", () => fail("load_failed"));
      const retry = button(zh ? "重试" : "Retry", () => {
        panel.remove();
        load();
      });
      panel.append(text2, actions);
      root.append(panel);
      retry.focus();
    };
    const load = () => {
      nonce = crypto.randomUUID();
      frame = document.createElement("iframe");
      frame.title = zh ? "文件选择器" : "File picker";
      frame.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent;color-scheme:normal";
      frame.setAttribute("allowtransparency", "true");
      frame.addEventListener("error", showFailure);
      frame.src = `${origin}${SELECT_EMBED_PATH}#bse=${nonce}&po=${encodeURIComponent(window.location.origin)}`;
      root.append(frame);
      timer = setTimeout(showFailure, 1e4);
    };
    const receive = (event) => {
      var _a3;
      if (!frame || event.origin !== origin || event.source !== frame.contentWindow || !isEmbedMessage(event.data, SYSDLG_EMBED))
        return;
      const { type, payload: p } = event.data;
      if (type === "embed.hello") {
        if (p.nonce !== nonce)
          return;
        clearTimeout(timer);
        (_a3 = frame.contentWindow) == null ? void 0 : _a3.postMessage(embedEnvelope("embed.init", { nonce, params, theme, locale }, SYSDLG_EMBED), origin);
        frame.focus();
      }
      if (type === "embed.error")
        fail(dialogErrorCode(p.code));
      if (type === "embed.result") {
        const result = readSelectDialogResult(p.result, { allowLocal: params.allowLocal === true });
        if (result)
          finish(result);
        else
          fail("protocol");
      }
    };
    window.addEventListener("message", receive);
    (_a2 = options.signal) == null ? void 0 : _a2.addEventListener("abort", abort, { once: true });
    if ("inert" in HTMLElement.prototype)
      siblings.forEach(({ el }) => {
        el.inert = true;
      });
    else {
      siblings.forEach(({ el }) => el.setAttribute("aria-hidden", "true"));
      blocked.forEach((type) => document.addEventListener(type, block, true));
    }
    html.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `${-scroll.y}px`;
    body.style.left = `${-scroll.x}px`;
    body.style.right = "0";
    body.style.overflow = "hidden";
    body.append(root);
    load();
  });
}
class SelectEmbedHost {
  constructor(options) {
    this.options = options;
    this.ready = false;
    this.listener = (event) => this.receive(event);
    const params = new URLSearchParams(window.location.hash.slice(1));
    this.nonce = params.get("bse");
    let parentOrigin = null;
    try {
      parentOrigin = new URL(params.get("po") ?? "").origin;
    } catch {
    }
    this.parentOrigin = window.parent !== window && this.nonce && parentOrigin && options.accept(parentOrigin) ? parentOrigin : null;
    if (!this.parentOrigin)
      return;
    window.addEventListener("message", this.listener);
    const hello = () => window.parent.postMessage(embedEnvelope("embed.hello", { nonce: this.nonce }, SYSDLG_EMBED), this.parentOrigin);
    hello();
    this.hello = setInterval(() => {
      if (!this.ready)
        hello();
    }, 250);
  }
  receive(event) {
    if (event.source !== window.parent || event.origin !== this.parentOrigin || !isEmbedMessage(event.data, SYSDLG_EMBED))
      return;
    const { type, payload: p } = event.data;
    if (type !== "embed.init" || this.ready || p.nonce !== this.nonce || typeof p.locale !== "string")
      return;
    this.ready = true;
    clearInterval(this.hello);
    this.options.onInit({ nonce: String(p.nonce), params: p.params, theme: p.theme === "dark" ? "dark" : "light", locale: p.locale });
  }
  post(type, payload) {
    if (this.ready && this.parentOrigin)
      window.parent.postMessage(embedEnvelope(type, payload, SYSDLG_EMBED), this.parentOrigin);
  }
  result(result) {
    this.post("embed.result", { result });
  }
  error(code) {
    this.post("embed.error", { code });
  }
  dispose() {
    clearInterval(this.hello);
    window.removeEventListener("message", this.listener);
  }
}
const CONVERSATION_EMBED = "buckyos.conversation-embed";
const CONVERSATION_EMBED_PATH = "/embed/conversation";
const CONVERSATION_EMBED_ERROR_CODES = ["invalid_params", "not_found", "denied"];
const TURN_MODES = ["idle", "running", "interrupted", "paused", "answer"];
const MAX_EMBED_TEXT = 64 * 1024;
const MAX_EMBED_ATTACHMENTS = 32;
const readEmbedSend = (p) => {
  if (typeof p.text !== "string" || p.text.length > MAX_EMBED_TEXT)
    return null;
  if (p.attachments === void 0)
    return { text: p.text };
  if (!Array.isArray(p.attachments) || p.attachments.length > MAX_EMBED_ATTACHMENTS || !p.attachments.every(isTransferableRef))
    return null;
  return { text: p.text, attachments: p.attachments };
};
class ConversationEmbed {
  constructor(options) {
    this.options = options;
    this.nonce = crypto.randomUUID();
    this.listener = (event) => this.receive(event);
    this.ready = false;
    this.outbox = [];
    this.origin = new URL(options.systemOrigin).origin;
    this.init = options.init;
    this.url = `${this.origin}${CONVERSATION_EMBED_PATH}#bce=${this.nonce}&po=${encodeURIComponent(window.location.origin)}`;
    window.addEventListener("message", this.listener);
  }
  post(type, payload) {
    var _a, _b;
    (_b = (_a = this.options.frame()) == null ? void 0 : _a.contentWindow) == null ? void 0 : _b.postMessage(embedEnvelope(type, payload, CONVERSATION_EMBED), this.origin);
  }
  receive(event) {
    var _a, _b, _c, _d, _e, _f, _g;
    if (event.origin !== this.origin || event.source !== ((_a = this.options.frame()) == null ? void 0 : _a.contentWindow) || !isEmbedMessage(event.data, CONVERSATION_EMBED))
      return;
    const { type, payload: p } = event.data;
    if (type === "embed.hello") {
      if (p.nonce !== this.nonce)
        return;
      this.ready = true;
      this.post("embed.init", { ...this.init, nonce: this.nonce });
      const queued = this.outbox;
      this.outbox = [];
      queued.forEach((message) => this.post("embed.send", message));
      return;
    }
    if (type === "embed.state" && (p.status === "loading" || p.status === "ready" || p.status === "error")) {
      (_c = (_b = this.options).onState) == null ? void 0 : _c.call(_b, {
        status: p.status,
        sessionId: typeof p.sessionId === "string" ? p.sessionId.slice(0, 512) : void 0,
        error: typeof p.error === "string" ? p.error.slice(0, 128) : void 0
      });
    }
    if (type === "embed.turn" && TURN_MODES.includes(p.mode))
      (_e = (_d = this.options).onTurn) == null ? void 0 : _e.call(_d, p.mode);
    if (type === "embed.error" && CONVERSATION_EMBED_ERROR_CODES.includes(p.code))
      (_g = (_f = this.options).onError) == null ? void 0 : _g.call(_f, p.code);
  }
  update(patch) {
    this.init = { ...this.init, ...patch };
    if (this.ready)
      this.post("embed.update", patch);
  }
  /** Sends a message in the user's name. Before the handshake it waits and goes out right after `embed.init`. */
  send(message) {
    var _a;
    const payload = { text: message.text, ...((_a = message.attachments) == null ? void 0 : _a.length) ? { attachments: message.attachments } : {} };
    if (this.ready)
      this.post("embed.send", payload);
    else
      this.outbox.push(payload);
  }
  dispose() {
    window.removeEventListener("message", this.listener);
    this.outbox = [];
  }
}
class ConversationEmbedHost {
  constructor(options) {
    this.options = options;
    this.ready = false;
    this.listener = (event) => this.receive(event);
    const params = new URLSearchParams(window.location.hash.slice(1));
    this.nonce = params.get("bce");
    let parentOrigin = null;
    try {
      parentOrigin = new URL(params.get("po") ?? "").origin;
    } catch {
    }
    this.parentOrigin = window.parent !== window && this.nonce && parentOrigin && options.accept(parentOrigin) ? parentOrigin : null;
    if (!this.parentOrigin)
      return;
    window.addEventListener("message", this.listener);
    const hello = () => window.parent.postMessage(embedEnvelope("embed.hello", { nonce: this.nonce }, CONVERSATION_EMBED), this.parentOrigin);
    hello();
    this.hello = setInterval(() => {
      if (!this.ready)
        hello();
    }, 250);
  }
  receive(event) {
    var _a, _b, _c, _d;
    if (event.source !== window.parent || event.origin !== this.parentOrigin || !isEmbedMessage(event.data, CONVERSATION_EMBED))
      return;
    const { type, payload: p } = event.data;
    if (type === "embed.init") {
      if (this.ready || p.nonce !== this.nonce || typeof p.locale !== "string")
        return;
      this.ready = true;
      clearInterval(this.hello);
      this.options.onInit({
        nonce: String(p.nonce),
        target: p.target,
        theme: p.theme === "dark" ? "dark" : "light",
        locale: p.locale,
        ...typeof p.placeholder === "string" ? { placeholder: p.placeholder.slice(0, 200) } : {}
      });
      return;
    }
    if (!this.ready)
      return;
    if (type === "embed.update") {
      const patch = {};
      if (p.theme === "dark" || p.theme === "light")
        patch.theme = p.theme;
      if (typeof p.locale === "string")
        patch.locale = p.locale;
      (_b = (_a = this.options).onUpdate) == null ? void 0 : _b.call(_a, patch);
    }
    if (type === "embed.send") {
      const message = readEmbedSend(p);
      if (message)
        (_d = (_c = this.options).onSend) == null ? void 0 : _d.call(_c, message);
      else
        this.error("invalid_params");
    }
  }
  post(type, payload) {
    if (this.ready && this.parentOrigin)
      window.parent.postMessage(embedEnvelope(type, payload, CONVERSATION_EMBED), this.parentOrigin);
  }
  state(state) {
    this.post("embed.state", state);
  }
  turn(mode) {
    this.post("embed.turn", { mode });
  }
  error(code) {
    this.post("embed.error", { code });
  }
  dispose() {
    clearInterval(this.hello);
    window.removeEventListener("message", this.listener);
  }
}
export {
  AppFrameClient,
  AppFrameHost,
  CONVERSATION_EMBED_ERROR_CODES,
  CONVERSATION_EMBED_PATH,
  ConversationEmbed,
  ConversationEmbedHost,
  PREVIEW_EMBED_PATH,
  PreviewEmbed,
  PreviewEmbedHost,
  SELECT_EMBED_PATH,
  SelectEmbedHost,
  appFrameName,
  embedderOrigin,
  openSelectEmbed,
  originInZone
};
//# sourceMappingURL=app-frame.mjs.map
