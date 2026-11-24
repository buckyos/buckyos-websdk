function readAppWindowDeclaration(value) {
  const v = value && typeof value === "object" ? value : {};
  const declaration = {
    instance: v.instance === "multi" ? "multi" : "single",
    default_mode: v.default_mode === "maximized" ? "maximized" : "windowed",
    resizable: v.resizable !== false,
    allow_minimize: v.allow_minimize !== false,
    allow_maximize: v.allow_maximize !== false,
    mobile_header: v.mobile_header === "compact" ? "compact" : "standard"
  };
  for (const key of ["width", "height", "min_width", "min_height"]) {
    const size = v[key];
    if (typeof size === "number" && Number.isFinite(size) && size >= 1)
      declaration[key] = Math.round(size);
  }
  return declaration;
}
function appWindowId(zone, appInstance, windowPath = "") {
  return [zone, appInstance, windowPath].map(encodeURIComponent).join("|");
}
function parseAppWindowId(id) {
  const parts = id.split("|");
  if (parts.length !== 3)
    return void 0;
  try {
    const [zone, appInstance, windowPath] = parts.map(decodeURIComponent);
    return zone && appInstance ? { zone, appInstance, windowPath } : void 0;
  } catch {
    return void 0;
  }
}
function resolveOpenApp(request, appInstance, declaration, windows) {
  const own = windows.filter((w) => w.zone === request.zone && w.appInstance === appInstance);
  const path = request.path || void 0;
  const create = (windowPath) => ({ action: "create", windowId: appWindowId(request.zone, appInstance, windowPath), windowPath, ...path ? { path } : {} });
  const focus = (window) => ({ action: "focus", windowId: window.id, ...path && path !== window.path ? { navigate: path } : {} });
  const multi = declaration.instance === "multi";
  if (multi && request.mode === "new") {
    const taken = new Set(own.map((w) => w.windowPath));
    const base = request.window ?? "";
    let windowPath = base;
    for (let n = 2; taken.has(windowPath); n++)
      windowPath = `${base}~${n}`;
    return create(windowPath);
  }
  if (multi && request.window !== void 0) {
    const existing = own.find((w) => w.windowPath === request.window);
    return existing ? focus(existing) : create(request.window);
  }
  const latest = own.reduce((best, w) => !best || w.lastActive > best.lastActive ? w : best, void 0);
  return latest ? focus(latest) : create("");
}
const wellFormed = (value) => {
  if (/[\x00-\x1f\x7f]/.test(value))
    return false;
  try {
    encodeURIComponent(value);
  } catch {
    return false;
  }
  return true;
};
const isAppId = (value) => typeof value === "string" && /^[\w.@-]{1,255}$/.test(value);
const isWindowPath = (value) => typeof value === "string" && value.length <= 512 && wellFormed(value);
const isZoneHost = (value) => /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i.test(value);
function isAppPath(value) {
  return typeof value === "string" && value.length <= 4096 && /^\/(?![\/\\])/.test(value) && wellFormed(value);
}
function readAppOpenRequest(value) {
  if (!value || typeof value !== "object")
    return void 0;
  const v = value;
  if (!isAppId(v.app))
    return void 0;
  const request = { app: v.app };
  if (v.zone !== void 0) {
    if (typeof v.zone !== "string" || !v.zone || v.zone.length > 255 || !wellFormed(v.zone))
      return void 0;
    request.zone = v.zone;
  }
  if (v.path !== void 0) {
    if (!isAppPath(v.path))
      return void 0;
    request.path = v.path;
  }
  if (v.window !== void 0) {
    if (!isWindowPath(v.window))
      return void 0;
    request.window = v.window;
  }
  if (v.mode !== void 0) {
    if (v.mode !== "reuse" && v.mode !== "new")
      return void 0;
    request.mode = v.mode;
  }
  return request;
}
const query = (params) => params.flatMap(([key, value]) => value === void 0 ? [] : [`${key}=${encodeURIComponent(value)}`]).join("&");
function systemOpenAppUrl(systemOrigin, request) {
  return `${new URL("/", systemOrigin).href}?${query([
    ["open-app", request.app],
    ["path", request.path],
    ["window", request.window],
    ["mode", request.mode === "new" ? "new" : void 0]
  ])}`;
}
function parseSystemOpenApp(params) {
  return readAppOpenRequest({
    app: params.get("open-app") ?? void 0,
    path: params.get("path") ?? void 0,
    window: params.get("window") ?? void 0,
    mode: params.get("mode") === "new" ? "new" : void 0
  });
}
function parseBuckyosUrl(url) {
  const match = /^buckyos:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)*)\/?(?:\?([^#]*))?(?:#.*)?$/i.exec(url.trim());
  if (!match)
    return void 0;
  const params = new URLSearchParams(match[2] ?? "");
  const version = params.get("v") ?? "";
  if (!/^[1-9]\d{0,8}$/.test(version))
    return void 0;
  return { action: match[1].toLowerCase(), version: Number(version), params };
}
const APP_OPEN_ACTION = "app.open";
function formatAppOpenUrl(link) {
  return `buckyos://${APP_OPEN_ACTION}?${query([["v", "1"], ["zone", link.zoneHost], ["app", link.app], ["path", link.path], ["window", link.window]])}`;
}
function parseAppOpenUrl(url) {
  var _a;
  const parsed = parseBuckyosUrl(url);
  if (!parsed || parsed.action !== APP_OPEN_ACTION || parsed.version !== 1)
    return void 0;
  const zoneHost = (_a = parsed.params.get("zone")) == null ? void 0 : _a.toLowerCase();
  if (!zoneHost || !isZoneHost(zoneHost))
    return void 0;
  const request = readAppOpenRequest({
    app: parsed.params.get("app") ?? void 0,
    path: parsed.params.get("path") ?? void 0,
    window: parsed.params.get("window") ?? void 0
  });
  if (!request)
    return void 0;
  return { zoneHost, app: request.app, ...request.path !== void 0 ? { path: request.path } : {}, ...request.window !== void 0 ? { window: request.window } : {} };
}
export {
  APP_OPEN_ACTION,
  appWindowId,
  formatAppOpenUrl,
  isAppPath,
  parseAppOpenUrl,
  parseAppWindowId,
  parseBuckyosUrl,
  parseSystemOpenApp,
  readAppOpenRequest,
  readAppWindowDeclaration,
  resolveOpenApp,
  systemOpenAppUrl
};
//# sourceMappingURL=open-app.mjs.map
