function getBuckyApi() {
  if (typeof window === "undefined")
    return void 0;
  const api = window.BuckyApi;
  const env = api == null ? void 0 : api.env;
  return api && env && (env.container === "desktop-app" || env.container === "mobile-app") && typeof api.call === "function" && typeof api.on === "function" ? api : void 0;
}
const mediaRecording = () => {
  var _a;
  return typeof MediaRecorder !== "undefined" && typeof ((_a = navigator.mediaDevices) == null ? void 0 : _a.getUserMedia) === "function";
};
function browserFormFactor() {
  var _a, _b, _c;
  if (window.parent !== window)
    return Math.min(((_a = window.screen) == null ? void 0 : _a.width) ?? 1024, ((_b = window.screen) == null ? void 0 : _b.height) ?? 1024) <= 768 ? "mobile" : "desktop";
  return ((_c = window.matchMedia) == null ? void 0 : _c.call(window, "(max-width: 768px)").matches) ? "mobile" : "desktop";
}
function getRuntimeEnvironment() {
  var _a;
  if (typeof window === "undefined")
    throw new Error("getRuntimeEnvironment is only available in browser runtime");
  const env = (_a = getBuckyApi()) == null ? void 0 : _a.env;
  if (env) {
    return {
      container: env.container,
      platform: env.platform,
      formFactor: env.formFactor === "mobile" ? "mobile" : "desktop",
      capabilities: Array.isArray(env.capabilities) ? env.capabilities.filter((c) => typeof c === "string") : []
    };
  }
  const capabilities = [];
  if (typeof navigator !== "undefined") {
    if (mediaRecording())
      capabilities.push("audio.record");
    if ("mediaSession" in navigator)
      capabilities.push("media.session");
  }
  return { container: "browser", formFactor: browserFormFactor(), capabilities };
}
const HEX_COLOUR = /^#[0-9a-f]{6}$/i;
const LOCALE_TAG = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
function readUserPreferences(value) {
  if (!isRecord(value))
    return {};
  const result = {};
  if (value.theme === "light" || value.theme === "dark")
    result.theme = value.theme;
  if (value.accent === null)
    result.accent = null;
  else if (typeof value.accent === "string" && HEX_COLOUR.test(value.accent))
    result.accent = value.accent.toLowerCase();
  if (typeof value.locale === "string" && LOCALE_TAG.test(value.locale))
    result.locale = value.locale;
  if (isRecord(value.profile))
    result.profile = value.profile;
  if (isRecord(value.private_profile))
    result.private_profile = value.private_profile;
  return result;
}
let frameAppearance = null;
const frameListeners = /* @__PURE__ */ new Set();
function setFrameAppearance(appearance) {
  frameAppearance = appearance;
  frameListeners.forEach((listener) => listener());
}
const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const browserForeground = typeof window === "undefined" || typeof document === "undefined" ? void 0 : (callback) => {
  const visible = () => {
    if (document.visibilityState !== "hidden")
      callback();
  };
  document.addEventListener("visibilitychange", visible);
  window.addEventListener("focus", callback);
  return () => {
    document.removeEventListener("visibilitychange", visible);
    window.removeEventListener("focus", callback);
  };
};
class UserPreferencesStore {
  constructor(read, onForeground = browserForeground) {
    this.read = read;
    this.onForeground = onForeground;
    this.zone = {};
    this.reading = null;
    this.shown = null;
    this.listeners = /* @__PURE__ */ new Set();
    this.detachPage = null;
    this.announce = () => {
      const view = this.view();
      if (this.shown && sameValue(this.shown, view))
        return;
      const first = this.shown === null;
      this.shown = view;
      if (!first)
        this.listeners.forEach((listener) => listener(view));
    };
  }
  /** The settings now: read from the Zone, the host's appearance over them in a frame. */
  async get() {
    await this.refresh();
    return this.view();
  }
  /** `listener` hears each change after this call; the returned function stops it. */
  subscribe(listener) {
    this.listeners.add(listener);
    if (this.listeners.size === 1)
      this.attach();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0)
        this.detach();
    };
  }
  /** Reads the Zone again (one read at a time); a failed read keeps what was known. */
  refresh() {
    this.reading ?? (this.reading = this.read().then((answer) => {
      this.zone = answer;
    }, () => {
    }).finally(() => {
      this.reading = null;
      this.announce();
    }));
    return this.reading;
  }
  view() {
    const view = { ...this.zone };
    if (frameAppearance) {
      view.theme = frameAppearance.theme;
      view.accent = frameAppearance.accent ?? null;
      view.locale = frameAppearance.locale;
    }
    return view;
  }
  attach() {
    var _a;
    frameListeners.add(this.announce);
    if (!this.shown)
      void this.refresh();
    this.detachPage = ((_a = this.onForeground) == null ? void 0 : _a.call(this, () => {
      void this.refresh();
    })) ?? null;
  }
  detach() {
    var _a;
    frameListeners.delete(this.announce);
    (_a = this.detachPage) == null ? void 0 : _a.call(this);
    this.detachPage = null;
  }
}
export {
  UserPreferencesStore as U,
  getRuntimeEnvironment as a,
  getBuckyApi as g,
  readUserPreferences as r,
  setFrameAppearance as s
};
//# sourceMappingURL=user_preferences-1d49850a.mjs.map
