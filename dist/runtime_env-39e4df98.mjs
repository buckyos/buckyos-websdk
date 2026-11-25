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
export {
  getRuntimeEnvironment as a,
  getBuckyApi as g
};
//# sourceMappingURL=runtime_env-39e4df98.mjs.map
