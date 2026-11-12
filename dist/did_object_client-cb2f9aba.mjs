import { p as parseObjectUrl, O as ObjectUrlError, f as objectEndpoint } from "./object_url-376c5222.mjs";
class DIDObjectError extends Error {
  constructor(code, message, status, details) {
    super(message);
    this.name = "DIDObjectError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
class DIDObjectClient {
  constructor(options) {
    this.options = options;
  }
  /** HTTP endpoint of an object URL (`obj://…`, or http(s) as it is). */
  endpoint(objectUrl) {
    let url;
    try {
      url = parseObjectUrl(objectUrl);
    } catch (e) {
      throw new DIDObjectError("bad_request", e instanceof ObjectUrlError ? e.message : String(e), 400);
    }
    const endpoint = objectEndpoint(url, this.options.origin, this.options.currentZone);
    if (!endpoint)
      throw new DIDObjectError("bad_request", `'${objectUrl}' has no DID Object endpoint`, 400);
    return endpoint;
  }
  card(objectUrl) {
    return this.request("GET", this.endpoint(objectUrl));
  }
  profile(objectUrl) {
    const e = this.endpoint(objectUrl);
    return this.request("GET", `${e}${e.includes("?") ? "&" : "?"}type=profile`);
  }
  readProperty(objectUrl, name) {
    return this.request("GET", `${this.split(objectUrl)}/props/${encodeURIComponent(name)}`);
  }
  async invoke(objectUrl, method, params) {
    const body = await this.request("POST", `${this.split(objectUrl)}/methods/${encodeURIComponent(method)}`, { method, params });
    if (body && typeof body === "object" && !Array.isArray(body) && "error" in body && body.error) {
      const err = body.error;
      throw new DIDObjectError(err.code ?? "error", err.message ?? "action failed", 200, err.details);
    }
    return body && typeof body === "object" && !Array.isArray(body) ? body.result ?? null : body;
  }
  /** The endpoint without its query (property and method paths go before it). */
  split(objectUrl) {
    const e = this.endpoint(objectUrl);
    const q = e.indexOf("?");
    return q < 0 ? e : e.slice(0, q);
  }
  async request(method, url, body) {
    var _a, _b;
    const headers = { accept: "application/json" };
    if (body !== void 0)
      headers["content-type"] = "application/json";
    const token = await ((_b = (_a = this.options).sessionToken) == null ? void 0 : _b.call(_a));
    if (token)
      headers.authorization = `Bearer ${token}`;
    const f = this.options.fetch ?? globalThis.fetch.bind(globalThis);
    const response = await f(url, {
      method,
      headers,
      credentials: "same-origin",
      ...body !== void 0 ? { body: JSON.stringify(body) } : {}
    });
    const text = await response.text();
    let parsed = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new DIDObjectError("invalid_response", `${method} ${url}: not JSON (HTTP ${response.status})`, response.status);
      }
    }
    if (!response.ok) {
      const err = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? "error" in parsed && parsed.error && typeof parsed.error === "object" ? parsed.error : parsed : {};
      throw new DIDObjectError(err.code ?? `http_${response.status}`, err.message ?? `${method} ${url}: HTTP ${response.status}`, response.status, err.details);
    }
    return parsed;
  }
}
export {
  DIDObjectClient as D,
  DIDObjectError as a
};
//# sourceMappingURL=did_object_client-cb2f9aba.mjs.map
