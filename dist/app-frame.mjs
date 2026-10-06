import { isOpenRequest } from "./content.mjs";
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
    if (m.type === "content.open" && (p.target === "default" || p.target === "preview")) {
      const request = { ...p.request, requestId: crypto.randomUUID() };
      if (!isOpenRequest(request))
        return;
      this.opens = this.opens.filter((t) => t > Date.now() - 1e4);
      if (this.opens.length >= 5)
        return;
      this.opens.push(Date.now());
      (_h = (_g = this.options).onContentOpen) == null ? void 0 : _h.call(_g, request, p.target, p.newWindow === true);
    }
  }
  update(init) {
    this.options.init = { ...this.options.init, ...init };
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
      if (m.type === "frame.focusChanged")
        (_n = (_m = this.options).onFocus) == null ? void 0 : _n.call(_m, p.focused === true);
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
    this.send("window.setTitle", { title, dirty });
  }
  requestClose() {
    this.send("window.requestClose", {});
  }
  openContent(request, target = "default", newWindow = false) {
    this.send("content.open", { request, target, newWindow });
  }
  dispose() {
    clearInterval(this.helloTimer);
    clearTimeout(this.helloDeadline);
    window.removeEventListener("message", this.listener);
  }
}
export {
  AppFrameClient,
  AppFrameHost
};
//# sourceMappingURL=app-frame.mjs.map
