import { isOpenRequest, readContentHints, systemOpenUrl, isTransferableRef, isTransferableSession } from "./content.mjs";
const envelope = (type, payload, extra = {}) => ({ protocol: "buckyos.app-frame", version: 1, type, payload, ...extra });
const isMessage = (value) => {
  if (!value || typeof value !== "object")
    return false;
  const v = value;
  return v.protocol === "buckyos.app-frame" && v.version === 1 && typeof v.type === "string" && !!v.payload && typeof v.payload === "object";
};
class AppFrameHost {
  constructor(options) {
    this.options = options;
    this.ready = false;
    this.capabilities = [];
    this.pending = /* @__PURE__ */ new Map();
    this.listener = (event) => this.receive(event);
    this.opens = [];
    window.addEventListener("message", this.listener);
  }
  receive(event) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    if (event.source !== this.options.target() || event.origin !== this.options.origin || !isMessage(event.data))
      return;
    const m = event.data;
    const p = m.payload;
    if (m.type === "frame.hello") {
      if (p.nonce !== this.options.init.nonce || !Array.isArray(p.appCapabilities))
        return;
      this.ready = true;
      this.capabilities = p.appCapabilities.filter((c) => typeof c === "string");
      this.send("frame.init", this.options.init);
      if (this.focused !== void 0)
        this.send("frame.focusChanged", { focused: this.focused });
      (_b = (_a = this.options).onReady) == null ? void 0 : _b.call(_a);
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
      (_d = (_c = this.options).onTitle) == null ? void 0 : _d.call(_c, p.title.slice(0, 256), p.dirty === true);
    if (m.type === "window.requestClose")
      (_f = (_e = this.options).onRequestClose) == null ? void 0 : _f.call(_e);
    if (m.type === "content.open" && (p.target === "default" || p.target === "preview" || p.target === "chooser")) {
      const request = { ...p.request, requestId: crypto.randomUUID() };
      if (!isOpenRequest(request))
        return;
      this.opens = this.opens.filter((t) => t > Date.now() - 1e4);
      if (this.opens.length >= 5)
        return;
      this.opens.push(Date.now());
      (_h = (_g = this.options).onContentOpen) == null ? void 0 : _h.call(_g, request, p.target, { newWindow: p.newWindow === true, hints: readContentHints(p.hints) });
    }
  }
  update(init) {
    this.options.init = { ...this.options.init, ...init };
  }
  /** Reports whether the App's window is the focused one; only a change is sent. */
  setFocused(focused) {
    if (this.focused === focused)
      return;
    this.focused = focused;
    this.send("frame.focusChanged", { focused });
  }
  send(type, payload) {
    var _a;
    if (this.ready)
      (_a = this.options.target()) == null ? void 0 : _a.postMessage(envelope(type, payload), this.options.origin);
  }
  request(type, payload, timeout = 3e3) {
    if (!this.ready)
      return Promise.reject(new Error("App frame is not ready"));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      var _a;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("App frame timed out"));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer, type });
      (_a = this.options.target()) == null ? void 0 : _a.postMessage(envelope(type, payload, { id }), this.options.origin);
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
  dispose() {
    window.removeEventListener("message", this.listener);
    this.pending.forEach((p) => {
      clearTimeout(p.timer);
      p.reject(new Error("App frame disposed"));
    });
    this.pending.clear();
    this.ready = false;
  }
}
function embedderOrigin(accept) {
  var _a;
  if (window.parent === window)
    return null;
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
    this.listener = (event) => {
      void this.receive(event);
    };
    this.origin = new URL(options.shellOrigin).origin;
    this.nonce = new URLSearchParams(window.location.hash.slice(1)).get("bfp");
    window.addEventListener("message", this.listener);
    if (window.parent !== window && this.nonce) {
      const hello = () => window.parent.postMessage(envelope("frame.hello", { nonce: this.nonce, appCapabilities: [
        ...options.onOpen ? ["open"] : [],
        ...options.onBeforeClose ? ["beforeClose"] : [],
        ...options.onBack ? ["back"] : []
      ] }), this.origin);
      hello();
      this.helloTimer = setInterval(hello, 250);
      this.helloDeadline = setTimeout(() => clearInterval(this.helloTimer), 1500);
    }
  }
  async receive(event) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n;
    if (event.source !== window.parent || event.origin !== this.origin || !isMessage(event.data))
      return;
    const m = event.data;
    const p = m.payload;
    if (m.type === "frame.init") {
      if (!this.nonce || p.nonce !== this.nonce || typeof p.locale !== "string" || !p.theme || typeof p.windowId !== "string" || p.launch && !isOpenRequest(p.launch))
        return;
      clearInterval(this.helloTimer);
      clearTimeout(this.helloDeadline);
      this.init = p;
      this.title = void 0;
      this.focused = void 0;
      (_b = (_a = this.options).onInit) == null ? void 0 : _b.call(_a, this.init);
      return;
    }
    if (!this.init)
      return;
    const reply = (payload) => window.parent.postMessage(envelope(m.type + "Result", payload, { replyTo: m.id }), this.origin);
    try {
      if (m.type === "frame.open" && isOpenRequest(p.request))
        reply(await ((_d = (_c = this.options).onOpen) == null ? void 0 : _d.call(_c, p.request)) ?? { accepted: false });
      if (m.type === "frame.beforeClose")
        reply({ decision: await ((_f = (_e = this.options).onBeforeClose) == null ? void 0 : _f.call(_e, p.reason)) ?? "allow" });
      if (m.type === "frame.back")
        reply({ handled: await ((_h = (_g = this.options).onBack) == null ? void 0 : _h.call(_g)) ?? false });
      if (m.type === "frame.themeChanged" && (p.mode === "dark" || p.mode === "light"))
        (_j = (_i = this.options).onTheme) == null ? void 0 : _j.call(_i, p);
      if (m.type === "frame.localeChanged" && typeof p.locale === "string")
        (_l = (_k = this.options).onLocale) == null ? void 0 : _l.call(_k, p.locale);
      if (m.type === "frame.focusChanged" && this.focused !== (p.focused === true)) {
        this.focused = p.focused === true;
        (_n = (_m = this.options).onFocus) == null ? void 0 : _n.call(_m, this.focused);
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
      window.parent.postMessage(envelope(type, payload), this.origin);
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
  /**
   * Asks the system to open content: with its default app, in Preview, or by letting the user choose (`chooser`).
   * Embedded in the shell the request goes over the frame; in a standalone tab it opens the Zone's system entry
   * (`systemOrigin`) in a new tab. Returns false when neither is available.
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
  dispose() {
    clearInterval(this.helloTimer);
    clearTimeout(this.helloDeadline);
    window.removeEventListener("message", this.listener);
  }
}
const PREVIEW_EMBED = "buckyos.preview-embed";
const embedEnvelope = (type, payload) => ({ protocol: PREVIEW_EMBED, version: 1, type, payload });
const isEmbedMessage = (value) => {
  const v = value;
  return !!v && v.protocol === PREVIEW_EMBED && v.version === 1 && typeof v.type === "string" && !!v.payload && typeof v.payload === "object";
};
const isEmbedSource = (value) => isTransferableRef(value) || !!value && typeof value === "object" && value.kind === "blob" && typeof Blob !== "undefined" && value.blob instanceof Blob && typeof value.name === "string";
const PREVIEW_EMBED_PATH = "/embed/preview";
class PreviewEmbed {
  constructor(options) {
    this.options = options;
    this.nonce = crypto.randomUUID();
    this.listener = (event) => this.receive(event);
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
      if (p.nonce === this.nonce)
        this.post("embed.init", { ...this.init, nonce: this.nonce });
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
export {
  AppFrameClient,
  AppFrameHost,
  PREVIEW_EMBED_PATH,
  PreviewEmbed,
  PreviewEmbedHost,
  embedderOrigin,
  originInZone
};
//# sourceMappingURL=app-frame.mjs.map
