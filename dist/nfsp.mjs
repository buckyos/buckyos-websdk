const NFSP_VERSION = "nfsp/0";
const liveRef = (nodeId, gen = 0) => ({
  type: "live",
  node_id: nodeId,
  gen
});
const toLocator = (at) => {
  if (typeof at === "string") {
    if (at.includes("://"))
      return { uri: at };
    return { realm: "dfs", path: at };
  }
  if ("type" in at)
    return { ref: at };
  return at;
};
class NfspError extends Error {
  constructor(body, httpStatus) {
    super(`${body.code}: ${body.message}`);
    this.name = "NfspError";
    this.code = body.code;
    this.httpStatus = httpStatus;
    this.details = Object.fromEntries(Object.entries(body).filter(([key]) => key !== "code" && key !== "message"));
  }
}
class NfspClient {
  constructor(opts) {
    this.session = null;
    this.seq = 0;
    this.helloResult = null;
    this.sessionToken = opts.sessionToken;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.fetchFn = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.chunkSize = opts.uploadChunkSize ?? 8 * 1024 * 1024;
  }
  get sessionId() {
    return this.session;
  }
  /** Features advertised by the server in hello (empty before hello). */
  get features() {
    var _a;
    return ((_a = this.helloResult) == null ? void 0 : _a.features) ?? [];
  }
  get limits() {
    var _a;
    return ((_a = this.helloResult) == null ? void 0 : _a.limits) ?? null;
  }
  // ---------- session ----------
  async hello(clientFeatures) {
    const args = { versions: [NFSP_VERSION] };
    if (clientFeatures)
      args.features = clientFeatures;
    const r = await this.post("hello", { args });
    this.session = r.session;
    this.seq = 0;
    this.helloResult = r;
    return r;
  }
  async bye() {
    await this.call("bye", {});
    this.session = null;
    this.helloResult = null;
  }
  // ---------- resolve / stat / list / batch ----------
  async resolve(at, want) {
    return await this.call("resolve", { at: toLocator(at), want });
  }
  /** stat with an optional child `name` step (server-side walk). */
  async stat(at, opts) {
    return await this.call("stat", {
      at: toLocator(at),
      want: opts == null ? void 0 : opts.want,
      args: (opts == null ? void 0 : opts.name) ? { name: opts.name } : {}
    });
  }
  async list(at, opts, want) {
    return await this.call("list", {
      at: toLocator(at),
      want,
      args: opts ?? {}
    });
  }
  async batch(start, ops, onError = "abort") {
    return await this.call("batch", {
      args: { start: toLocator(start), ops, on_error: onError }
    });
  }
  // ---------- structure writes ----------
  /**
   * Ref form: create one child under `parent` (optional CAS via
   * `expectedRevision`). Path form: pass a dfs path string and no name —
   * behaves like `mkdir -p` (idempotent, no CAS).
   */
  async mkdir(parent, name, opts) {
    const args = {};
    if (name !== void 0)
      args.name = name;
    if (opts == null ? void 0 : opts.expectedRevision)
      args.expected_revision = opts.expectedRevision;
    return await this.write("mkdir", { at: toLocator(parent), args });
  }
  async move(from, to, opts) {
    return await this.write("move", {
      args: {
        from: { parent_ref: from.parentRef, name: from.name },
        to: { parent_ref: to.parentRef, name: to.name },
        expected_from_revision: opts == null ? void 0 : opts.expectedFromRevision,
        expected_to_revision: opts == null ? void 0 : opts.expectedToRevision
      }
    });
  }
  /** Destroys a native entry. Reference entries must use `unlink` instead. */
  async delete(parent, name, opts) {
    return await this.write("delete", {
      at: toLocator(parent),
      args: {
        name,
        recursive: opts == null ? void 0 : opts.recursive,
        expected_revision: opts == null ? void 0 : opts.expectedRevision
      }
    });
  }
  async bindRef(parentRef, name, targetRef, opts) {
    return await this.write("bind_ref", {
      args: {
        parent_ref: parentRef,
        name,
        target_ref: targetRef,
        expected_revision: opts == null ? void 0 : opts.expectedRevision
      }
    });
  }
  /** Removes a reference entry (`be_*`) only; the target is never touched. */
  async unlink(entryRef, opts) {
    return await this.write("unlink", {
      args: { entry_ref: entryRef, expected_revision: opts == null ? void 0 : opts.expectedRevision }
    });
  }
  // ---------- content writes (open_write / tus / commit_file / probe) ----------
  async openWrite(target) {
    const args = "ref" in target ? { ref: target.ref } : { parent_ref: target.parentRef, name: target.name, size: target.size };
    return await this.write("open_write", { args });
  }
  /** Current upload offset (tus HEAD) — resume point after interruption. */
  async uploadOffset(fbHandle) {
    const resp = await this.fetchFn(`${this.baseUrl}/nfs/v1/uploads/${fbHandle}`, {
      method: "HEAD",
      headers: await this.authHeaders()
    });
    if (!resp.ok)
      throw await this.httpError(resp);
    return Number(resp.headers.get("Upload-Offset") ?? "0");
  }
  /** One tus PATCH. Returns the new offset. */
  async uploadChunk(fbHandle, offset, chunk) {
    const resp = await this.fetchFn(`${this.baseUrl}/nfs/v1/uploads/${fbHandle}`, {
      method: "PATCH",
      headers: {
        ...await this.authHeaders(),
        "Upload-Offset": String(offset),
        "Content-Type": "application/offset+octet-stream"
      },
      body: chunk
    });
    if (resp.status !== 204)
      throw await this.httpError(resp);
    return Number(resp.headers.get("Upload-Offset") ?? String(offset + chunk.byteLength));
  }
  /** Uploads a whole buffer in chunks, resuming from the server's offset. */
  async uploadContent(fbHandle, content, onProgress) {
    let offset = await this.uploadOffset(fbHandle);
    while (offset < content.byteLength) {
      const chunk = content.subarray(offset, Math.min(offset + this.chunkSize, content.byteLength));
      offset = await this.uploadChunk(fbHandle, offset, chunk);
      onProgress == null ? void 0 : onProgress(offset, content.byteLength);
    }
  }
  async abortWrite(leaseId) {
    await this.write("abort_write", { args: { lease_id: leaseId } });
  }
  async authHeaders() {
    var _a;
    const token = await ((_a = this.sessionToken) == null ? void 0 : _a.call(this));
    return token ? { Authorization: `Bearer ${token}` } : {};
  }
  async commitFile(parent, name, source, opts) {
    const args = {
      name,
      overwrite: opts == null ? void 0 : opts.overwrite,
      expected_revision: opts == null ? void 0 : opts.expectedRevision
    };
    if ("fbHandle" in source) {
      args.fb_handle = source.fbHandle;
      if (source.leaseId)
        args.lease_id = source.leaseId;
    } else {
      args.hash = source.hash;
    }
    return await this.write("commit_file", { at: toLocator(parent), args });
  }
  /** Which of these digests must be uploaded (§ probe / 秒传). */
  async probe(digests) {
    return await this.call("probe", { args: { digests } });
  }
  /**
   * Convenience: open_write + chunked tus upload + commit_file.
   * Overwrites an existing file only when `opts.overwrite` is set.
   */
  async uploadFile(parentRef, name, content, opts) {
    const ow = await this.openWrite({ parentRef, name, size: content.byteLength });
    await this.uploadContent(ow.fb_handle, content, opts == null ? void 0 : opts.onProgress);
    return this.commitFile({ ref: parentRef }, name, {
      fbHandle: ow.fb_handle,
      leaseId: ow.lease.lease_id
    }, { overwrite: opts == null ? void 0 : opts.overwrite });
  }
  // ---------- data plane read ----------
  /** URL for `GET /nfs/v1/read/{node_id}` (usable in <img>, <a download>, …). */
  readUrl(nodeId, opts) {
    const params = new URLSearchParams();
    if (opts == null ? void 0 : opts.download)
      params.set("download", "1");
    if (opts == null ? void 0 : opts.name)
      params.set("name", opts.name);
    const qs = params.size > 0 ? `?${params.toString()}` : "";
    return `${this.baseUrl}/nfs/v1/read/${encodeURIComponent(nodeId)}${qs}`;
  }
  /** Reads file content; `range` is inclusive byte positions. */
  async readFile(nodeId, opts) {
    const headers = await this.authHeaders();
    if (opts == null ? void 0 : opts.range) {
      headers.Range = `bytes=${opts.range.start}-${opts.range.end ?? ""}`;
    }
    if (opts == null ? void 0 : opts.ifNoneMatch)
      headers["If-None-Match"] = opts.ifNoneMatch;
    const resp = await this.fetchFn(this.readUrl(nodeId), { headers, cache: "no-store" });
    if (!resp.ok && resp.status !== 304)
      throw await this.httpError(resp);
    return resp;
  }
  // ---------- meta ----------
  async getMeta(target, ns) {
    const loc = toLocator(target);
    const args = { ns };
    if (loc.ref)
      args.ref = loc.ref;
    return await this.call("get_meta", { at: loc, args });
  }
  /** v1: only `ns: "user"` records are writable. */
  async setMeta(target, records) {
    const loc = toLocator(target);
    const args = { records };
    if (loc.ref)
      args.ref = loc.ref;
    return await this.write("set_meta", { at: loc, args });
  }
  // ---------- search ----------
  async search(q, opts, want) {
    return await this.call("search", {
      want,
      args: {
        q,
        limit: opts == null ? void 0 : opts.limit,
        cursor: opts == null ? void 0 : opts.cursor,
        scope: (opts == null ? void 0 : opts.scope) !== void 0 ? toLocator(opts.scope) : void 0,
        modes: opts == null ? void 0 : opts.modes
      }
    });
  }
  // ---------- views & collections ----------
  async openView(viewId, want) {
    return await this.call("open_view", { want, args: { view_id: viewId } });
  }
  async createCollection(title, collectionId, want) {
    return await this.write("create_collection", {
      want,
      args: { title, collection_id: collectionId }
    });
  }
  async openCollection(collectionId, want) {
    return await this.call("open_collection", {
      want,
      args: { collection_id: collectionId }
    });
  }
  async collectionPatch(ref, ops, opts) {
    return await this.write("collection_patch", {
      args: { ref, ops, expected_revision: opts == null ? void 0 : opts.expectedRevision }
    });
  }
  // ---------- grants ----------
  async grant(subtree, opts) {
    return await this.write("grant", {
      args: {
        subtree: toLocator(subtree),
        ops: opts == null ? void 0 : opts.ops,
        ttl: opts == null ? void 0 : opts.ttl,
        audience: opts == null ? void 0 : opts.audience,
        max_uses: opts == null ? void 0 : opts.maxUses
      }
    });
  }
  async revoke(capId) {
    return await this.write("revoke", { args: { cap_id: capId } });
  }
  // ---------- watch (SSE) ----------
  /**
   * Opens the watch stream. `tokens` filters to specific containers using the
   * `watch_token` returned by list. The stream is lossy by contract: on any
   * `resync` event, re-list watched containers.
   */
  watch(opts) {
    var _a;
    if (!this.session)
      throw new Error("watch requires an active session; call hello() first");
    const params = new URLSearchParams({ session: this.session });
    if ((_a = opts == null ? void 0 : opts.tokens) == null ? void 0 : _a.length)
      params.set("tokens", opts.tokens.join(","));
    const url = `${this.baseUrl}/nfs/v1/watch?${params.toString()}`;
    const controller = new AbortController();
    if (opts == null ? void 0 : opts.signal) {
      opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    const fetchFn = this.fetchFn;
    const authHeaders = () => this.authHeaders();
    async function* events() {
      const resp = await fetchFn(url, {
        headers: { ...await authHeaders(), Accept: "text/event-stream" },
        signal: controller.signal
      });
      if (!resp.ok || !resp.body) {
        throw new Error(`watch failed: HTTP ${resp.status}`);
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      try {
        for (; ; ) {
          const { done, value } = await reader.read();
          if (done)
            return;
          buf += decoder.decode(value, { stream: true });
          for (; ; ) {
            const sep = buf.indexOf("\n\n");
            if (sep < 0)
              break;
            const frame = buf.slice(0, sep);
            buf = buf.slice(sep + 2);
            let event = "message";
            let id;
            const dataLines = [];
            for (const line of frame.split("\n")) {
              if (line.startsWith("event:"))
                event = line.slice(6).trim();
              else if (line.startsWith("data:"))
                dataLines.push(line.slice(5).trim());
              else if (line.startsWith("id:"))
                id = line.slice(3).trim();
            }
            if (dataLines.length === 0 && event === "message")
              continue;
            let data = {};
            if (dataLines.length > 0) {
              try {
                data = JSON.parse(dataLines.join("\n"));
              } catch {
                data = { raw: dataLines.join("\n") };
              }
            }
            yield { event, data, id };
          }
        }
      } finally {
        reader.cancel().catch(() => {
        });
      }
    }
    const it = events();
    it.close = () => controller.abort();
    return it;
  }
  // ---------- envelope plumbing ----------
  /** Read-path call: no seq. Throws NfspError on `ok:false`. */
  async call(method, extras) {
    return this.post(method, this.envelope(extras));
  }
  /**
   * Write-path call: assigns the next seq once and reuses it across network
   * retries so the server's replay window guarantees exactly-once.
   */
  async write(method, extras, retries = 2) {
    const seq = ++this.seq;
    const body = { ...this.envelope(extras), seq };
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await this.post(method, body);
      } catch (e) {
        if (e instanceof NfspError)
          throw e;
        lastErr = e;
      }
    }
    throw lastErr;
  }
  envelope(extras) {
    const body = { args: pruneUndefined(extras.args ?? {}) };
    if (this.session)
      body.session = this.session;
    if (extras.at)
      body.at = pruneUndefined(extras.at);
    if (extras.want)
      body.want = extras.want;
    return body;
  }
  async post(method, body) {
    var _a;
    const token = await ((_a = this.sessionToken) == null ? void 0 : _a.call(this));
    const resp = await this.fetchFn(`${this.baseUrl}/nfs/v1/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...token ? { Authorization: `Bearer ${token}` } : {} },
      body: JSON.stringify(body)
    });
    let parsed;
    try {
      parsed = await resp.json();
    } catch {
      throw new NfspError(
        { code: "INTERNAL", message: `non-JSON response (HTTP ${resp.status})` },
        resp.status
      );
    }
    if (parsed.ok !== true) {
      throw new NfspError(
        parsed.error ?? { code: "INTERNAL", message: "malformed error envelope" },
        resp.status
      );
    }
    return parsed.result;
  }
  async httpError(resp) {
    try {
      const parsed = await resp.json();
      if (parsed.error)
        return new NfspError(parsed.error, resp.status);
    } catch {
    }
    return new NfspError({ code: "INTERNAL", message: `HTTP ${resp.status}` }, resp.status);
  }
}
const pruneUndefined = (obj) => {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== void 0)
      out[k] = v;
  }
  return out;
};
export {
  NFSP_VERSION,
  NfspClient,
  NfspError,
  liveRef,
  toLocator
};
//# sourceMappingURL=nfsp.mjs.map
