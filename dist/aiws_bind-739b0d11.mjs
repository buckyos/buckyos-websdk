import { e as encodeObjQueryComponent, c as canonicalJson, b as objServiceUrl, n as normalizeObjectUrl, p as parseObjectUrl, d as objectSegments } from "./object_url-376c5222.mjs";
const AIWORKSPACE_SERVICE_NAME = "aiworkspace";
class AiwsFailure extends Error {
  constructor(error) {
    super(`${error.code}${error.sub_code ? `/${error.sub_code}` : ""}: ${error.detail}`);
    this.name = "AiwsFailure";
    this.code = error.code;
    this.subCode = error.sub_code;
    this.data = error.data;
  }
}
function aiwsReferenceUrl(reference, workspaceId) {
  const ws = reference.workspace_id ?? workspaceId;
  if (!ws)
    throw new Error("reference names no workspace");
  const query = [];
  if (reference.mode === "fixed")
    query.push("mode=fixed");
  if (reference.selector != null)
    query.push(`selector=${encodeObjQueryComponent(canonicalJson(reference.selector))}`);
  if (reference.version != null)
    query.push(`version=${encodeObjQueryComponent(canonicalJson(reference.version))}`);
  const base = objServiceUrl("aiworkspace", [ws, "entities", reference.entity_id]);
  return normalizeObjectUrl(query.length ? `${base}?${query.join("&")}` : base);
}
function parseAiwsReferenceUrl(url) {
  const parsed = parseObjectUrl(url);
  const segments = objectSegments(parsed);
  if (parsed.kind !== "obj" || parsed.host.name !== "aiworkspace" || segments.length !== 3 || segments[1] !== "entities") {
    throw new Error(`${url} is not an AI Workspace entity url`);
  }
  const reference = {
    workspace_id: segments[0],
    entity_id: segments[2],
    mode: parsed.query.mode === "fixed" ? "fixed" : "live"
  };
  if (parsed.query.selector !== void 0)
    reference.selector = JSON.parse(parsed.query.selector);
  if (parsed.query.version !== void 0)
    reference.version = JSON.parse(parsed.query.version);
  return reference;
}
const AIWS_COMMIT_PART_BYTES = 6 * 1024 * 1024;
const AIWS_COMMIT_MAX_BYTES = 32 * 1024 * 1024;
const AIWS_COMMIT_MAX_OPERATIONS = 5e4;
const utf8 = new TextEncoder();
function jsonBytes(value) {
  const text = JSON.stringify(value);
  return text.length + (/[^\x00-\x7f]/.test(text) ? utf8.encode(text).length - text.length : 0);
}
function splitCommitOperations(operations, partBytes = AIWS_COMMIT_PART_BYTES) {
  const parts = [];
  let current = [];
  let size = 2;
  for (const op of operations) {
    const bytes = jsonBytes(op) + 1;
    if (current.length > 0 && size + bytes > partBytes) {
      parts.push(current);
      current = [];
      size = 2;
    }
    current.push(op);
    size += bytes;
  }
  if (current.length > 0 || parts.length === 0)
    parts.push(current);
  return parts;
}
function commitOverLimit(operations) {
  if (operations.length > AIWS_COMMIT_MAX_OPERATIONS)
    return { limit: "operations", value: operations.length, max: AIWS_COMMIT_MAX_OPERATIONS };
  let bytes = 2;
  for (const op of operations)
    bytes += jsonBytes(op) + 1;
  return bytes + 4096 > AIWS_COMMIT_MAX_BYTES ? { limit: "bytes", value: bytes, max: AIWS_COMMIT_MAX_BYTES } : null;
}
async function commitWithParts(call, request, options = {}) {
  var _a, _b;
  const method = options.method ?? "doc.commit";
  const operations = Array.isArray(request.operations) ? request.operations : [];
  const parts = splitCommitOperations(operations, options.partBytes ?? AIWS_COMMIT_PART_BYTES);
  if (parts.length <= 1)
    return await call(method, request);
  const { workspace_id, epoch, idempotency_key } = request;
  for (let attempt = 0; ; attempt++) {
    const staged = [];
    for (let part = 0; part < parts.length - 1; part++) {
      (_a = options.onPart) == null ? void 0 : _a.call(options, part + 1, parts.length);
      const held = await call("doc.stage", { workspace_id, epoch, idempotency_key, part, operations: parts[part] });
      if (!held || held.ok === false || typeof held.digest !== "string") {
        const error = (held == null ? void 0 : held.error) ?? { code: "STORAGE_IO_ERROR", retryable: true, detail: "doc.stage returned no digest" };
        return { status: "rejected", code: error.code, retryable: error.retryable, detail: error.detail, ...error.sub_code ? { sub_code: error.sub_code } : {}, errors: [error] };
      }
      staged.push(held.digest);
    }
    (_b = options.onPart) == null ? void 0 : _b.call(options, parts.length, parts.length);
    const result = await call(method, { ...request, staged, operations: parts[parts.length - 1] });
    if (attempt === 0 && (result == null ? void 0 : result.status) === "rejected" && result.sub_code === "STAGED_PARTS_MISSING")
      continue;
    return result;
  }
}
class AiWorkspaceClient {
  constructor(rpcClient) {
    this.rpcClient = rpcClient;
    this.raw = (method, params) => this.rpcClient.call(method, params);
  }
  async call(method, params) {
    const raw = await this.rpcClient.call(method, params);
    if (raw && typeof raw === "object" && raw.ok === false)
      throw new AiwsFailure(raw.error);
    return raw;
  }
  // ---- workspace
  /** A new Workspace; `name` (unique among the caller's, fixed) answers `NAME_CONFLICT` when the caller already uses it. */
  create(title, opts = {}) {
    return this.call("ws.create", { title, ...opts });
  }
  /** The caller's Workspace named `name`, created (titled `title`, else the name) when it has none. */
  ensure(name, title) {
    return this.call("ws.ensure", { name, ...title === void 0 ? {} : { title } });
  }
  /** The service clock (unix ms): calibrate against half the round trip. */
  time() {
    return this.call("ws.time", {});
  }
  list() {
    return this.call("ws.list", {});
  }
  info(workspace_id) {
    return this.call("ws.get_info", { workspace_id });
  }
  getUserState(workspace_id) {
    return this.call("ws.get_user_state", { workspace_id });
  }
  setUserState(workspace_id, entries, expect) {
    return this.call("ws.set_user_state", { workspace_id, entries, ...expect ? { expect } : {} });
  }
  // ---- document
  resolve(workspace_id, reference) {
    return this.call("doc.resolve", { workspace_id, reference });
  }
  resolvePath(workspace_id, path) {
    return this.call("doc.resolve", { workspace_id, path });
  }
  read(workspace_id, entity_id, selector) {
    return this.call("doc.read", { workspace_id, entity_id, ...selector ? { selector } : {} });
  }
  query(workspace_id, params) {
    return this.call("doc.query", { workspace_id, ...params });
  }
  outline(workspace_id) {
    return this.call("doc.outline", { workspace_id });
  }
  prepare(workspace_id, request) {
    return commitWithParts(this.raw, { workspace_id, ...request }, { method: "doc.prepare" });
  }
  /** The three-state commit result (`status: accepted | conflict | rejected`), never thrown. One call per Commit
   * whatever its size (up to `AIWS_COMMIT_MAX_BYTES` / `AIWS_COMMIT_MAX_OPERATIONS`): a large one is sent in parts. */
  commit(workspace_id, request, options = {}) {
    return commitWithParts(this.raw, { workspace_id, ...request }, options);
  }
  getSubmission(workspace_id, epoch, idempotency_key) {
    return this.call("doc.get_submission", { workspace_id, epoch, idempotency_key });
  }
  /** Changes after `after_seq` (`filter.detail: "touched"` for the touched entities only). */
  getChanges(workspace_id, epoch, after_seq, opts = {}) {
    return this.call("doc.get_changes", { workspace_id, epoch, after_seq, ...opts.limit ? { limit: opts.limit } : {}, ...opts.touchedOnly ? { filter: { detail: "touched" } } : {} });
  }
  /** Long poll until the head passes `after_seq` (or `timeout_ms`). */
  waitChanges(workspace_id, after_seq, opts = {}) {
    return this.call("doc.wait_changes", { workspace_id, after_seq, ...opts });
  }
  /** A whole-Workspace package (`.bcanvas`): `download` names it in the owner's exports bucket. */
  exportDoc(workspace_id, mode, self_contained, include_notes) {
    return this.call("doc.export", { workspace_id, mode, self_contained, ...include_notes === void 0 ? {} : { include_notes } });
  }
  // ---- assets
  /** Register a FileObject as a staged asset: `{ bucket_id, key }` (the uploader's binding) or `{ obj_id }`. */
  assetImportObject(workspace_id, source) {
    return this.call("asset.import_object", { workspace_id, ...source });
  }
  // ---- Block-controls (code-registered layouts such as the mind map)
  controlsList() {
    return this.call("control.list", {});
  }
  controlsDescribe(kind) {
    return this.call("control.describe", { kind });
  }
  controlsImport(workspace_id, params) {
    return this.call("control.import", { workspace_id, ...params });
  }
  controlsExport(workspace_id, entity_id, format) {
    return this.call("control.export", { workspace_id, entity_id, ...format ? { format } : {} });
  }
  // ---- extension controls (README “Extension controls”; buckyos-websdk src/aiws_ext.ts drives them)
  /** Build one control's source files into the Workspace; `BUILD_FAILED` carries `data.diagnostics`. */
  extBuild(workspace_id, params) {
    return this.call("ext.build", { workspace_id, ...params });
  }
  /** The bundle of definitions (`purpose: pull` needs read only and synthesizes the source of never-built ones). */
  extExport(workspace_id, entity_ids, purpose = "package") {
    return this.call("ext.export", { workspace_id, entity_ids, purpose });
  }
  /** Into the caller's library: a `.pikg` object or one bound into the caller's `exports` bucket (consumed), or
   * definitions of a Workspace (`from` + `package`). */
  extInstall(params) {
    return this.call("ext.install", params);
  }
  /** Pack definitions (and what they build on, and templates of the Workspace) as an `aiws` `.pikg` into the caller's
   * `exports` bucket (unsigned). */
  extPack(workspace_id, entity_ids, pkg, templates) {
    return this.call("ext.pack", { workspace_id, entity_ids, package: pkg, ...templates ? { templates } : {} });
  }
  /** Rebuild imported definitions from the caller's library (same Zone; across Zones `ext.build { provenance, upgrade }`):
   * `EXT_LOCAL_CHANGES` when the snapshot was built locally since, unless `force`. */
  extUpgrade(params) {
    return this.call("ext.upgrade", { ...params });
  }
  /** Chosen Surfaces as a template snapshot: the manifest item, the definitions it needs and the files (base64) of
   * `templates/<id>/`. */
  extExportTemplate(params) {
    return this.call("ext.export_template", { ...params });
  }
  /** A new Workspace from a template of the caller's library (installing a template never creates one). */
  extCreateFromTemplate(params) {
    return this.call("ext.create_from_template", params);
  }
  extListLibrary() {
    return this.call("ext.list_library", {});
  }
  extUninstall(pkg_id) {
    return this.call("ext.uninstall", { pkg_id });
  }
  /** A library package's controls with their bytes (base64): what a client relays into a Workspace of another Zone. */
  extLibraryBundle(pkg_id, idents) {
    return this.call("ext.library_bundle", { pkg_id, ...idents ? { idents } : {} });
  }
  /** Bring library controls into a Workspace of this Zone (one Commit). */
  extImport(workspace_id, items, opts = {}) {
    return this.call("ext.import", { workspace_id, items, ...opts });
  }
  // ---- runs (M3 executor protocol)
  runStart(workspace_id, program, params, idempotency_key) {
    return this.call("proc.start", { workspace_id, program, params, idempotency_key });
  }
  runGet(workspace_id, run_id, choices) {
    return this.call("proc.get", { workspace_id, run_id, ...choices ? { choices } : {} });
  }
  runList(workspace_id, wish_id, limit) {
    return this.call("proc.list", { workspace_id, ...wish_id ? { wish_id } : {}, ...limit ? { limit } : {} });
  }
  runClaim(workspace_id, run_id, claim_token, executor) {
    return this.call("proc.claim", { workspace_id, run_id, claim_token, ...executor ? { executor } : {} });
  }
  runHeartbeat(workspace_id, run_id, attempt, progress) {
    return this.call("proc.heartbeat", { workspace_id, run_id, attempt, ...progress ? { progress } : {} });
  }
  runReport(workspace_id, report) {
    return this.call("proc.report", { workspace_id, ...report });
  }
  runApply(workspace_id, run_id, plan_digest, session_id) {
    return this.call("proc.apply", { workspace_id, run_id, plan_digest, ...session_id ? { session_id } : {} });
  }
  runCancel(workspace_id, run_id) {
    return this.call("proc.cancel", { workspace_id, run_id });
  }
}
const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
class RRuleError extends Error {
  constructor(message) {
    super(message);
    this.name = "RRuleError";
  }
}
const FREQS = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];
const MAX_COUNT = 1e3;
const MAX_INTERVAL = 999;
function intIn(part, value, lo, hi, zero = false) {
  if (!/^[+-]?\d{1,3}$/.test(value))
    throw new RRuleError(`${part}: ${value} is not a number`);
  const n = Number(value);
  if (n < lo || n > hi || !zero && n === 0)
    throw new RRuleError(`${part}: ${value} is out of range`);
  return n;
}
function list(part, value, max) {
  const items = value.split(",");
  if (items.length === 0 || items.length > max || items.some((x) => x === ""))
    throw new RRuleError(`${part}: at most ${max} comma-separated values`);
  return items;
}
function untilOf(value) {
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (m) {
    const date = `${m[1]}-${m[2]}-${m[3]}`;
    if (!isDate(date))
      throw new RRuleError(`UNTIL: ${value} is not a date`);
    return date;
  }
  m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (m) {
    const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    if (!isDate(`${m[1]}-${m[2]}-${m[3]}`) || +m[4] > 23 || +m[5] > 59 || +m[6] > 59)
      throw new RRuleError(`UNTIL: ${value} is not a UTC time`);
    return new Date(ms).toISOString();
  }
  throw new RRuleError(`UNTIL: ${value} must be YYYYMMDD or YYYYMMDDTHHMMSSZ`);
}
function parseRRule(text) {
  const body = text.startsWith("RRULE:") ? text.slice(6) : text;
  if (body.trim() === "")
    throw new RRuleError("empty rule");
  const seen = /* @__PURE__ */ new Set();
  const raw = {};
  for (const part of body.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0)
      throw new RRuleError(`${part || "(empty)"}: expected NAME=VALUE`);
    const name = part.slice(0, eq);
    const value = part.slice(eq + 1);
    if (name !== name.toUpperCase() || value !== value.toUpperCase())
      throw new RRuleError(`${part}: write the rule in upper case`);
    if (seen.has(name))
      throw new RRuleError(`${name}: given twice`);
    seen.add(name);
    if (!["FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY", "BYMONTHDAY", "BYMONTH", "BYSETPOS", "WKST"].includes(name)) {
      throw new RRuleError(`${name}: not supported (supported: FREQ, INTERVAL, COUNT, UNTIL, BYDAY, BYMONTHDAY, BYMONTH, BYSETPOS, WKST)`);
    }
    if (value === "")
      throw new RRuleError(`${name}: empty value`);
    raw[name] = value;
  }
  if (!raw.FREQ)
    throw new RRuleError("FREQ is required");
  if (!FREQS.includes(raw.FREQ))
    throw new RRuleError(`FREQ: ${raw.FREQ} is not supported (DAILY, WEEKLY, MONTHLY, YEARLY)`);
  const freq = raw.FREQ;
  const rule = { freq, interval: 1, wkst: 0 };
  if (raw.INTERVAL !== void 0)
    rule.interval = intIn("INTERVAL", raw.INTERVAL, 1, MAX_INTERVAL);
  if (raw.COUNT !== void 0 && raw.UNTIL !== void 0)
    throw new RRuleError("COUNT and UNTIL cannot both be given");
  if (raw.COUNT !== void 0)
    rule.count = intIn("COUNT", raw.COUNT, 1, MAX_COUNT);
  if (raw.UNTIL !== void 0)
    rule.until = untilOf(raw.UNTIL);
  if (raw.BYDAY !== void 0) {
    rule.byDay = list("BYDAY", raw.BYDAY, 7).map((item) => {
      const m = /^([+-]?\d)?(MO|TU|WE|TH|FR|SA|SU)$/.exec(item);
      if (!m)
        throw new RRuleError(`BYDAY: ${item} is not a weekday`);
      const weekday = WEEKDAYS.indexOf(m[2]);
      if (m[1] === void 0)
        return { weekday };
      if (freq !== "MONTHLY" && freq !== "YEARLY")
        throw new RRuleError(`BYDAY: ${item}: an ordinal needs FREQ=MONTHLY or YEARLY`);
      return { weekday, ordinal: intIn("BYDAY", m[1], -5, 5) };
    });
    const keys = rule.byDay.map((d) => `${d.ordinal ?? ""}${d.weekday}`);
    if (new Set(keys).size !== keys.length)
      throw new RRuleError("BYDAY: repeated day");
  }
  if (raw.BYMONTHDAY !== void 0) {
    if (freq !== "MONTHLY" && freq !== "YEARLY")
      throw new RRuleError("BYMONTHDAY needs FREQ=MONTHLY or YEARLY");
    rule.byMonthDay = list("BYMONTHDAY", raw.BYMONTHDAY, 31).map((v) => {
      const n = intIn("BYMONTHDAY", v, -1, 31);
      return n;
    });
    if (new Set(rule.byMonthDay).size !== rule.byMonthDay.length)
      throw new RRuleError("BYMONTHDAY: repeated day");
  }
  if (raw.BYMONTH !== void 0) {
    if (freq !== "YEARLY")
      throw new RRuleError("BYMONTH needs FREQ=YEARLY");
    rule.byMonth = list("BYMONTH", raw.BYMONTH, 12).map((v) => intIn("BYMONTH", v, 1, 12));
    if (new Set(rule.byMonth).size !== rule.byMonth.length)
      throw new RRuleError("BYMONTH: repeated month");
  }
  if (raw.BYSETPOS !== void 0) {
    if (freq !== "MONTHLY" || !rule.byDay)
      throw new RRuleError("BYSETPOS needs FREQ=MONTHLY and BYDAY");
    rule.bySetPos = intIn("BYSETPOS", raw.BYSETPOS, -5, 5);
  }
  if (raw.WKST !== void 0) {
    const w = WEEKDAYS.indexOf(raw.WKST);
    if (w < 0)
      throw new RRuleError(`WKST: ${raw.WKST} is not a weekday`);
    rule.wkst = w;
  }
  return rule;
}
function formatRRule(rule) {
  var _a, _b, _c;
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval > 1)
    parts.push(`INTERVAL=${rule.interval}`);
  if ((_a = rule.byMonth) == null ? void 0 : _a.length)
    parts.push(`BYMONTH=${rule.byMonth.join(",")}`);
  if ((_b = rule.byMonthDay) == null ? void 0 : _b.length)
    parts.push(`BYMONTHDAY=${rule.byMonthDay.join(",")}`);
  if ((_c = rule.byDay) == null ? void 0 : _c.length)
    parts.push(`BYDAY=${rule.byDay.map((d) => `${d.ordinal ?? ""}${WEEKDAYS[d.weekday]}`).join(",")}`);
  if (rule.bySetPos !== void 0)
    parts.push(`BYSETPOS=${rule.bySetPos}`);
  if (rule.count !== void 0)
    parts.push(`COUNT=${rule.count}`);
  if (rule.until !== void 0)
    parts.push(`UNTIL=${rule.until.length === 10 ? rule.until.replace(/-/g, "") : rule.until.replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`);
  if (rule.wkst !== 0)
    parts.push(`WKST=${WEEKDAYS[rule.wkst]}`);
  return parts.join(";");
}
function isDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m)
    return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  return y >= 1 && mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}
const isLeap = (y) => y % 4 === 0 && y % 100 !== 0 || y % 400 === 0;
function daysInMonth(y, m) {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}
const dayNumber = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / 864e5);
function dayOf(date) {
  return dayNumber(+date.slice(0, 4), +date.slice(5, 7), +date.slice(8, 10));
}
function dateOf(day) {
  return new Date(day * 864e5).toISOString().slice(0, 10);
}
function ymdOf(day) {
  const t = new Date(day * 864e5);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
const weekdayOf = (day) => ((day + 3) % 7 + 7) % 7;
const formatters = /* @__PURE__ */ new Map();
function formatter(tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    formatters.set(tz, f);
  }
  return f;
}
function isTimeZone(tz) {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}
function zonedParts(ms, tz) {
  const parts = {};
  for (const p of formatter(tz).formatToParts(new Date(ms)))
    if (p.type !== "literal")
      parts[p.type] = Number(p.value);
  return { y: parts.year, m: parts.month, d: parts.day, h: parts.hour === 24 ? 0 : parts.hour, mi: parts.minute, s: parts.second };
}
function offsetMs(ms, tz) {
  const p = zonedParts(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1e3) * 1e3;
}
function zonedToUtc(day, minuteOfDay, secondOfMinute, tz) {
  const local = day * 864e5 + minuteOfDay * 6e4 + secondOfMinute * 1e3;
  const first = local - offsetMs(local, tz);
  const second = local - offsetMs(first, tz);
  return second;
}
function localDay(ms, tz) {
  const p = zonedParts(ms, tz);
  return dayNumber(p.y, p.m, p.d);
}
const MAX_PERIODS = 2e5;
function candidates(rule, period, startDay) {
  const s = ymdOf(startDay);
  const out = [];
  const byDayAll = (day0, len, wanted) => {
    for (let i = 0; i < len; i++)
      if (wanted.some((w) => w.ordinal === void 0 && w.weekday === weekdayOf(day0 + i)))
        out.push(day0 + i);
  };
  const nth = (day0, len, w) => {
    const days = [];
    for (let i = 0; i < len; i++)
      if (weekdayOf(day0 + i) === w.weekday)
        days.push(day0 + i);
    const k = w.ordinal > 0 ? w.ordinal - 1 : days.length + w.ordinal;
    if (k >= 0 && k < days.length)
      out.push(days[k]);
  };
  const monthDays = (y, m, list2) => {
    const n = daysInMonth(y, m);
    for (const d of list2) {
      const day = d > 0 ? d : n + d + 1;
      if (day >= 1 && day <= n)
        out.push(dayNumber(y, m, day));
    }
  };
  switch (rule.freq) {
    case "DAILY": {
      const day = startDay + period * rule.interval;
      const { m, d } = ymdOf(day);
      if (rule.byMonth && !rule.byMonth.includes(m))
        break;
      if (rule.byMonthDay && !rule.byMonthDay.some((x) => x > 0 ? x === d : daysInMonth(ymdOf(day).y, m) + x + 1 === d))
        break;
      if (rule.byDay && !rule.byDay.some((w) => w.weekday === weekdayOf(day)))
        break;
      out.push(day);
      break;
    }
    case "WEEKLY": {
      const weekStart = startDay - (weekdayOf(startDay) - rule.wkst + 7) % 7 + period * rule.interval * 7;
      const wanted = rule.byDay ?? [{ weekday: weekdayOf(startDay) }];
      byDayAll(weekStart, 7, wanted);
      if (rule.byMonth)
        return out.filter((d) => rule.byMonth.includes(ymdOf(d).m)).sort((a, b) => a - b);
      break;
    }
    case "MONTHLY": {
      const index = s.y * 12 + (s.m - 1) + period * rule.interval;
      const y = Math.floor(index / 12), m = index % 12 + 1;
      const day0 = dayNumber(y, m, 1), len = daysInMonth(y, m);
      if (rule.byMonthDay) {
        monthDays(y, m, rule.byMonthDay);
        if (rule.byDay) {
          const keep = out.filter((d) => rule.byDay.some((w) => w.weekday === weekdayOf(d)));
          out.length = 0;
          out.push(...keep);
        }
      } else if (rule.byDay) {
        byDayAll(day0, len, rule.byDay);
        for (const w of rule.byDay)
          if (w.ordinal !== void 0)
            nth(day0, len, w);
      } else if (s.d <= len)
        out.push(dayNumber(y, m, s.d));
      break;
    }
    case "YEARLY": {
      const y = s.y + period * rule.interval;
      if (rule.byDay && !rule.byMonth && !rule.byMonthDay) {
        const day0 = dayNumber(y, 1, 1), len = isLeap(y) ? 366 : 365;
        byDayAll(day0, len, rule.byDay);
        for (const w of rule.byDay)
          if (w.ordinal !== void 0)
            nth(day0, len, w);
        break;
      }
      const months = rule.byMonth ?? [s.m];
      for (const m of months) {
        if (rule.byMonthDay)
          monthDays(y, m, rule.byMonthDay);
        else if (rule.byDay) {
          const day0 = dayNumber(y, m, 1), len = daysInMonth(y, m);
          byDayAll(day0, len, rule.byDay);
          for (const w of rule.byDay)
            if (w.ordinal !== void 0)
              nth(day0, len, w);
        } else if (s.d <= daysInMonth(y, m))
          out.push(dayNumber(y, m, s.d));
      }
      if (rule.byMonthDay && rule.byDay) {
        const keep = out.filter((d) => rule.byDay.some((w) => w.weekday === weekdayOf(d)));
        out.length = 0;
        out.push(...keep);
      }
      break;
    }
  }
  const sorted = [...new Set(out)].sort((a, b) => a - b);
  if (rule.bySetPos !== void 0) {
    const k = rule.bySetPos > 0 ? rule.bySetPos - 1 : sorted.length + rule.bySetPos;
    return k >= 0 && k < sorted.length ? [sorted[k]] : [];
  }
  return sorted;
}
function periodStart(rule, p, startDay) {
  const s = ymdOf(startDay);
  switch (rule.freq) {
    case "DAILY":
      return startDay + p * rule.interval;
    case "WEEKLY":
      return startDay - (weekdayOf(startDay) - rule.wkst + 7) % 7 + p * rule.interval * 7;
    case "MONTHLY": {
      const index = s.y * 12 + (s.m - 1) + p * rule.interval;
      return dayNumber(Math.floor(index / 12), index % 12 + 1, 1);
    }
    case "YEARLY":
      return dayNumber(s.y + p * rule.interval, 1, 1);
  }
}
function periodsBefore(rule, startDay, day) {
  const s = ymdOf(startDay);
  const t = ymdOf(day);
  let p;
  switch (rule.freq) {
    case "DAILY":
      p = Math.floor((day - startDay) / rule.interval);
      break;
    case "WEEKLY":
      p = Math.floor((day - periodStart(rule, 0, startDay)) / (7 * rule.interval));
      break;
    case "MONTHLY":
      p = Math.floor((t.y * 12 + t.m - (s.y * 12 + s.m)) / rule.interval);
      break;
    case "YEARLY":
      p = Math.floor((t.y - s.y) / rule.interval);
      break;
  }
  return Math.max(-1, p - 1);
}
function expandSeries(rule, start, window, opts = {}) {
  var _a;
  const limit = opts.limit ?? 2e3;
  const excluded = new Set(opts.exdate ?? []);
  const out = [];
  let startDay;
  let minute = 0, second = 0;
  let tz = "UTC";
  let fromDay, toDay;
  const viewerTz = opts.viewerTz ?? "UTC";
  if (start.kind === "date") {
    startDay = dayOf(start.date);
    fromDay = localDay(window.fromMs, viewerTz) - (opts.durationDays ?? 0);
    toDay = localDay(window.toMs - 1, viewerTz);
  } else {
    tz = start.tz;
    const ms = Date.parse(start.utc);
    const p = zonedParts(ms, tz);
    startDay = dayNumber(p.y, p.m, p.d);
    minute = p.h * 60 + p.mi;
    second = p.s;
    fromDay = localDay(window.fromMs - (opts.durationMs ?? 0), tz) - 1;
    toDay = localDay(window.toMs, tz) + 1;
  }
  const untilDay = ((_a = rule.until) == null ? void 0 : _a.length) === 10 ? dayOf(rule.until) : void 0;
  const untilMs = rule.until && rule.until.length > 10 ? Date.parse(rule.until) : void 0;
  let count = 0;
  const emit = (day) => {
    if (rule.count !== void 0 && count >= rule.count)
      return false;
    if (untilDay !== void 0 && day > untilDay)
      return false;
    let occ;
    if (start.kind === "date") {
      if (untilMs !== void 0 && day * 864e5 > untilMs)
        return false;
      const date = dateOf(day);
      occ = { original: date, date };
    } else {
      const ms = zonedToUtc(day, minute, second, tz);
      if (untilMs !== void 0 && ms > untilMs)
        return false;
      occ = { original: new Date(ms).toISOString(), startMs: ms };
    }
    count += 1;
    if (excluded.has(occ.original))
      return true;
    if (start.kind === "date") {
      if (day >= fromDay && day <= toDay)
        out.push(occ);
    } else if (occ.startMs + (opts.durationMs ?? 0) > window.fromMs && occ.startMs < window.toMs)
      out.push(occ);
    return true;
  };
  if (startDay > toDay || !emit(startDay))
    return out;
  let period = rule.count === void 0 ? periodsBefore(rule, startDay, fromDay) + 1 : 0;
  for (let guard = 0; guard < MAX_PERIODS && out.length < limit; guard++, period++) {
    if (periodStart(rule, period, startDay) > toDay)
      break;
    for (const day of candidates(rule, period, startDay)) {
      if (day <= startDay)
        continue;
      if (day > toDay)
        return out;
      if (!emit(day) || out.length >= limit)
        return out;
    }
  }
  return out;
}
function seriesStartOf(values, tz, fallbackTz = "UTC") {
  if (values.all_day === true)
    return typeof values.start_date === "string" ? { kind: "date", date: values.start_date } : null;
  return typeof values.start === "string" ? { kind: "datetime", utc: values.start, tz: tz && isTimeZone(tz) ? tz : fallbackTz } : null;
}
function originalOf(occ) {
  return occ.date ?? new Date(occ.startMs).toISOString();
}
function occurrenceId(recordId, original) {
  return `${recordId}@${original}`;
}
function parseOccurrenceId(id) {
  const at = id.indexOf("@");
  return at < 0 ? { recordId: id, original: null } : { recordId: id.slice(0, at), original: id.slice(at + 1) };
}
const ORD_ZH = { 1: "第一个", 2: "第二个", 3: "第三个", 4: "第四个", 5: "第五个", [-1]: "最后一个", [-2]: "倒数第二个", [-3]: "倒数第三个", [-4]: "倒数第四个", [-5]: "倒数第五个" };
const ORD_EN = { 1: "first", 2: "second", 3: "third", 4: "fourth", 5: "fifth", [-1]: "last", [-2]: "second to last", [-3]: "third to last", [-4]: "fourth to last", [-5]: "fifth to last" };
const WD_ZH = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const WD_EN = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTH_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const isWorkdays = (d) => !!d && d.length === 5 && d.every((x) => x.ordinal === void 0) && [0, 1, 2, 3, 4].every((w) => d.some((x) => x.weekday === w));
function describeRRule(rule, locale = "zh") {
  var _a;
  const zh = locale === "zh";
  const n = rule.interval;
  const days = (d) => d.map((x) => {
    const wd = zh ? WD_ZH[x.weekday] : WD_EN[x.weekday];
    if (x.ordinal === void 0)
      return wd;
    return zh ? `${ORD_ZH[x.ordinal]}${wd}` : `${ORD_EN[x.ordinal]} ${wd}`;
  });
  const join = (xs) => zh ? xs.join("、") : xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs.join("");
  const mday = (d) => zh ? d === -1 ? "最后一天" : `${d} 日` : d === -1 ? "the last day" : `day ${d}`;
  let text;
  switch (rule.freq) {
    case "DAILY":
      text = zh ? n === 1 ? "每天" : `每 ${n} 天` : n === 1 ? "every day" : `every ${n} days`;
      break;
    case "WEEKLY":
      if (isWorkdays(rule.byDay) && n === 1)
        text = zh ? "每个工作日" : "every weekday";
      else {
        const on = rule.byDay ? join(days(rule.byDay)) : "";
        text = zh ? `${n === 1 ? "每周" : `每 ${n} 周的`}${on}` : `${n === 1 ? "every week" : `every ${n} weeks`}${on ? ` on ${on}` : ""}`;
      }
      break;
    case "MONTHLY": {
      let on = "";
      if (rule.byMonthDay)
        on = join(rule.byMonthDay.map(mday));
      else if (rule.byDay && rule.bySetPos !== void 0) {
        on = isWorkdays(rule.byDay) ? zh ? `${ORD_ZH[rule.bySetPos]}工作日` : `the ${ORD_EN[rule.bySetPos]} weekday` : zh ? `${ORD_ZH[rule.bySetPos]}${join(days(rule.byDay))}` : `the ${ORD_EN[rule.bySetPos]} of ${join(days(rule.byDay))}`;
      } else if (rule.byDay)
        on = zh ? join(days(rule.byDay)) : `the ${join(days(rule.byDay))}`;
      text = zh ? `${n === 1 ? "每月" : `每 ${n} 个月的`}${on}` : `${n === 1 ? "every month" : `every ${n} months`}${on ? ` on ${on}` : ""}`;
      break;
    }
    case "YEARLY": {
      const months = (_a = rule.byMonth) == null ? void 0 : _a.map((m) => zh ? `${m} 月` : MONTH_EN[m - 1]);
      let on = months ? join(months) : "";
      if (rule.byMonthDay)
        on += zh ? join(rule.byMonthDay.map(mday)) : ` ${join(rule.byMonthDay.map((d) => d === -1 ? "last day" : String(d)))}`;
      else if (rule.byDay)
        on += zh ? join(days(rule.byDay)) : ` on the ${join(days(rule.byDay))}`;
      text = zh ? `${n === 1 ? "每年" : `每 ${n} 年的`}${on}` : `${n === 1 ? "every year" : `every ${n} years`}${on.trim() ? ` in ${on.trim()}` : ""}`;
      break;
    }
  }
  if (rule.count !== void 0)
    text += zh ? `，共 ${rule.count} 次` : `, ${rule.count} times`;
  if (rule.until !== void 0)
    text += zh ? `，到 ${rule.until.slice(0, 10)} 为止` : `, until ${rule.until.slice(0, 10)}`;
  return text;
}
function recurrencePresets(date, locale = "zh") {
  const day = dayOf(date);
  const { y, m, d } = ymdOf(day);
  const wd = weekdayOf(day);
  const nth = Math.floor((d - 1) / 7) + 1;
  const last = d + 7 > daysInMonth(y, m);
  const zh = locale === "zh";
  const w = WEEKDAYS[wd];
  const out = [
    { id: "none", label: zh ? "不重复" : "Does not repeat", rrule: null },
    { id: "daily", label: zh ? "每天" : "Daily", rrule: "FREQ=DAILY" },
    { id: "weekdays", label: zh ? "每个工作日（周一至周五）" : "Every weekday (Monday to Friday)", rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" },
    { id: "weekly", label: zh ? `每周的${WD_ZH[wd]}` : `Weekly on ${WD_EN[wd]}`, rrule: `FREQ=WEEKLY;BYDAY=${w}` },
    { id: "monthly_day", label: zh ? `每月 ${d} 日` : `Monthly on day ${d}`, rrule: `FREQ=MONTHLY;BYMONTHDAY=${d}` }
  ];
  if (nth <= 4)
    out.push({ id: "monthly_nth", label: zh ? `每月${ORD_ZH[nth]}${WD_ZH[wd]}` : `Monthly on the ${ORD_EN[nth]} ${WD_EN[wd]}`, rrule: `FREQ=MONTHLY;BYDAY=${nth}${w}` });
  if (last)
    out.push({ id: "monthly_last", label: zh ? `每月最后一个${WD_ZH[wd]}` : `Monthly on the last ${WD_EN[wd]}`, rrule: `FREQ=MONTHLY;BYDAY=-1${w}` });
  out.push({ id: "yearly", label: zh ? `每年 ${m} 月 ${d} 日` : `Annually on ${MONTH_EN[m - 1]} ${d}`, rrule: `FREQ=YEARLY;BYMONTH=${m};BYMONTHDAY=${d}` });
  return out;
}
const TODO_SCHEMA_ID = "buckyos.todo@1";
const CALENDAR_SCHEMA_ID = "buckyos.calendar@1";
const SCHEDULE_WORKSPACE_NAME = "schedule";
const SCHEDULE_TODO_ID = "todo";
const SCHEDULE_CALENDAR_ID = "calendar";
const SCHEDULE_SURFACE_ID = "schedule-board";
const TODO_DONE = "done";
const AIWS_PROTOCOL_VERSION = "1.1";
const LABELS = {
  zh: {
    title: "标题",
    status: "状态",
    due: "截止",
    order: "顺序",
    done_at: "完成时间",
    ext: "扩展",
    todo: "待办",
    doing: "进行中",
    done: "已完成",
    all_day: "全天",
    start: "开始",
    end: "结束",
    start_date: "开始日期",
    end_date: "结束日期",
    confirmed: "已确认",
    tentative: "暂定",
    cancelled: "已取消",
    todo_table: "待办",
    calendar_table: "日程",
    workspace: "我的日程",
    board: "日程"
  },
  en: {
    title: "Title",
    status: "Status",
    due: "Due",
    order: "Order",
    done_at: "Completed",
    ext: "Extension",
    todo: "To do",
    doing: "In progress",
    done: "Done",
    all_day: "All day",
    start: "Start",
    end: "End",
    start_date: "Start date",
    end_date: "End date",
    confirmed: "Confirmed",
    tentative: "Tentative",
    cancelled: "Cancelled",
    todo_table: "To-do",
    calendar_table: "Calendar",
    workspace: "My schedule",
    board: "Schedule"
  }
};
function scheduleLabel(locale, key) {
  return LABELS[locale][key] ?? LABELS.en[key] ?? key;
}
function todoFields(locale = "zh") {
  const l = (k) => scheduleLabel(locale, k);
  return [
    { field_id: "title", name: l("title"), type: "text", required: true },
    { field_id: "status", name: l("status"), type: "select", required: true, options: ["todo", "doing", "done"].map((id) => ({ option_id: id, label: l(id) })) },
    { field_id: "due", name: l("due"), type: "date", nullable: true },
    { field_id: "order", name: l("order"), type: "text", nullable: true },
    { field_id: "done_at", name: l("done_at"), type: "datetime", nullable: true },
    { field_id: "ext", name: l("ext"), type: "json", nullable: true }
  ];
}
function calendarFields(locale = "zh") {
  const l = (k) => scheduleLabel(locale, k);
  return [
    { field_id: "title", name: l("title"), type: "text", required: true },
    { field_id: "all_day", name: l("all_day"), type: "boolean", nullable: true },
    { field_id: "start", name: l("start"), type: "datetime", nullable: true },
    { field_id: "end", name: l("end"), type: "datetime", nullable: true },
    { field_id: "start_date", name: l("start_date"), type: "date", nullable: true },
    { field_id: "end_date", name: l("end_date"), type: "date", nullable: true },
    { field_id: "status", name: l("status"), type: "select", nullable: true, options: ["confirmed", "tentative", "cancelled"].map((id) => ({ option_id: id, label: l(id) })) },
    { field_id: "ext", name: l("ext"), type: "json", nullable: true }
  ];
}
function standardTableOp(kind, args) {
  const locale = args.locale ?? "zh";
  return {
    op: "entity.create",
    entity_id: args.entity_id,
    type_id: "buckyos.table-source",
    parent_id: args.parent_id,
    order_key: args.order_key,
    schema_id: kind === "todo" ? TODO_SCHEMA_ID : CALENDAR_SCHEMA_ID,
    name: args.name ?? scheduleLabel(locale, kind === "todo" ? "todo_table" : "calendar_table"),
    payload: { title_field_id: "title", fields: kind === "todo" ? todoFields(locale) : calendarFields(locale) }
  };
}
const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";
const MAX_KEY_LEN = 64;
const APPEND_WIDTH = 8;
function isOrderKey(k) {
  return typeof k === "string" && k.length > 0 && k.length <= MAX_KEY_LEN && /^[0-9a-z]+$/.test(k) && !k.endsWith("0");
}
function midpoint(a, b) {
  if (b !== null) {
    let n = 0;
    while (n < b.length && (a[n] ?? "0") === b[n])
      n++;
    if (n > 0)
      return b.slice(0, n) + midpoint(a.length > n ? a.slice(n) : "", b.slice(n));
  }
  const da = a.length ? DIGITS.indexOf(a[0]) : 0;
  const db = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length;
  if (db - da > 1)
    return DIGITS[Math.floor((da + db + 1) / 2)];
  if (b !== null && b.length > 1)
    return b[0];
  return DIGITS[da] + midpoint(a.length > 1 ? a.slice(1) : "", null);
}
function after(a) {
  const out = a.padEnd(Math.max(a.length, APPEND_WIDTH), "0").split("");
  let i = out.length - 1;
  while (i >= 0 && out[i] === "z")
    i--;
  if (i >= 0) {
    out[i] = DIGITS[DIGITS.indexOf(out[i]) + 1];
    for (let j = i + 1; j < out.length; j++)
      out[j] = "0";
    if (out[out.length - 1] === "0")
      out[out.length - 1] = "1";
    return out.join("");
  }
  if (out.length >= MAX_KEY_LEN)
    throw new Error("order key space exhausted; rebalance");
  const longer = out.join("").padEnd(Math.min(out.length + APPEND_WIDTH, MAX_KEY_LEN), "0");
  return longer.slice(0, -1) + "1";
}
function orderKeyBetween(a, b) {
  const lo = a ?? null, hi = b ?? null;
  if (lo !== null && hi !== null && lo >= hi)
    throw new Error("orderKeyBetween requires a < b");
  const key = lo !== null && hi === null ? after(lo) : midpoint(lo ?? "", hi);
  if (!isOrderKey(key))
    throw new Error("order key space exhausted; rebalance");
  return key;
}
function orderKeysBetween(a, b, count) {
  const out = [];
  let lo = a;
  for (let i = 0; i < count; i++) {
    lo = orderKeyBetween(lo, b);
    out.push(lo);
  }
  return out;
}
let counter = 0;
function newRecordId(prefix = "r") {
  counter = (counter + 1) % 1296;
  const rand = Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, "0");
  return `${prefix}${Date.now().toString(36)}${counter.toString(36).padStart(2, "0")}${rand}`;
}
function setValuesOps(sourceId, row, changes) {
  var _a;
  const set = [];
  const unset = [];
  for (const [field, value] of Object.entries(changes)) {
    const cell = { record_id: row.record_id, field_id: field, expect: { rev: ((_a = row.revs) == null ? void 0 : _a[field]) ?? 0 } };
    if (value === null || value === void 0) {
      if (row.values[field] !== void 0 && row.values[field] !== null)
        unset.push(cell);
    } else {
      set.push({ ...cell, value });
    }
  }
  const out = [];
  if (set.length)
    out.push({ op: "table.set_values", source_id: sourceId, values: set });
  if (unset.length)
    out.push({ op: "table.unset_values", source_id: sourceId, values: unset });
  return out;
}
function insertRecordOp(sourceId, records) {
  return {
    op: "table.insert_records",
    source_id: sourceId,
    records: records.map((r) => ({ record_id: r.record_id, values: Object.fromEntries(Object.entries(r.values).filter(([, v]) => v !== void 0 && v !== null)) }))
  };
}
function deleteRecordsOp(sourceId, rows) {
  return { op: "table.delete_records", source_id: sourceId, records: rows.map((r) => ({ record_id: r.record_id, expect: { rev: r.rev ?? 0 } })) };
}
function canonicalOriginal(x) {
  if (isDate(x))
    return x;
  const t = Date.parse(x);
  return Number.isFinite(t) ? new Date(t).toISOString() : x;
}
const originals = (v) => Array.isArray(v) ? v.filter((x) => typeof x === "string").map(canonicalOriginal) : [];
const extOf = (row) => {
  const e = row == null ? void 0 : row.values.ext;
  return e && typeof e === "object" && !Array.isArray(e) ? { ...e } : {};
};
function todoItem(row) {
  const v = row.values;
  const status = typeof v.status === "string" ? v.status : "todo";
  return {
    record_id: row.record_id,
    rev: row.rev,
    revs: row.revs,
    values: row.values,
    title: typeof v.title === "string" ? v.title : "",
    status,
    due: typeof v.due === "string" ? v.due : null,
    order: isOrderKey(v.order) ? v.order : null,
    done: status === TODO_DONE,
    done_at: typeof v.done_at === "string" ? v.done_at : null,
    ext: extOf(row)
  };
}
function sortTodos(items) {
  return [...items].sort((a, b) => a.order === b.order ? a.record_id.localeCompare(b.record_id) : a.order === null ? 1 : b.order === null ? -1 : a.order < b.order ? -1 : 1);
}
function todoAddOps(sourceId, input, place = {}) {
  const record_id = input.record_id ?? newRecordId("t");
  let order = input.order ?? null;
  if (!order) {
    if (place.after !== void 0 || place.before !== void 0)
      order = orderKeyBetween(place.after ?? null, place.before ?? null);
    else {
      const last = (place.items ?? []).map((i) => i.order).filter(isOrderKey).sort().pop() ?? null;
      order = orderKeyBetween(last, null);
    }
  }
  const status = input.status ?? "todo";
  const values = {
    title: input.title,
    status,
    order,
    due: input.due ?? void 0,
    ext: input.ext && Object.keys(input.ext).length ? input.ext : void 0,
    done_at: status === TODO_DONE ? input.done_at ?? (/* @__PURE__ */ new Date()).toISOString() : void 0
  };
  return { record_id, order, ops: [insertRecordOp(sourceId, [{ record_id, values }])] };
}
function todoCompleteOps(sourceId, row, done, opts = {}) {
  if (done)
    return setValuesOps(sourceId, row, { status: TODO_DONE, done_at: opts.now ?? (/* @__PURE__ */ new Date()).toISOString() });
  return setValuesOps(sourceId, row, { status: opts.reopenStatus ?? "todo", done_at: null });
}
function todoMoveOps(sourceId, row, to, opts = {}) {
  const changes = {};
  const was = typeof row.values.status === "string" ? row.values.status : void 0;
  if (to.status !== void 0 && to.status !== was) {
    changes.status = to.status;
    if (to.status === TODO_DONE)
      changes.done_at = opts.now ?? (/* @__PURE__ */ new Date()).toISOString();
    else if (was === TODO_DONE)
      changes.done_at = null;
  }
  if (to.order !== void 0 && to.order !== row.values.order)
    changes.order = to.order;
  return Object.keys(changes).length ? setValuesOps(sourceId, row, changes) : [];
}
function todoUpdateOps(sourceId, row, changes) {
  const out = {};
  for (const k of ["title", "status", "due", "order", "done_at"])
    if (changes[k] !== void 0)
      out[k] = changes[k];
  if (changes.ext !== void 0)
    out.ext = changes.ext && Object.keys(changes.ext).length ? changes.ext : null;
  if (changes.ext_merge) {
    const ext = extOf(row);
    for (const [k, v] of Object.entries(changes.ext_merge))
      if (v === null)
        delete ext[k];
      else
        ext[k] = v;
    out.ext = Object.keys(ext).length ? ext : null;
  }
  if (out.status !== void 0 && out.status !== row.values.status && out.done_at === void 0) {
    if (out.status === TODO_DONE)
      out.done_at = (/* @__PURE__ */ new Date()).toISOString();
    else if (row.values.status === TODO_DONE)
      out.done_at = null;
  }
  return setValuesOps(sourceId, row, out);
}
function orderAt(items, index) {
  const keys = items.map((i) => i.order);
  const before = index > 0 ? keys[index - 1] : null;
  const afterKey = index < keys.length ? keys[index] : null;
  if (before !== null && !isOrderKey(before))
    return orderKeyBetween(null, null);
  if (afterKey !== null && isOrderKey(afterKey) && (before === null || before < afterKey))
    return orderKeyBetween(before, afterKey);
  return orderKeyBetween(before, null);
}
const DEFAULT_EVENT_MS = 36e5;
function rowTimes(row) {
  const v = row.values;
  if (v.all_day === true) {
    if (typeof v.start_date !== "string" || !isDate(v.start_date))
      return null;
    const endDate = typeof v.end_date === "string" && isDate(v.end_date) && v.end_date >= v.start_date ? v.end_date : v.start_date;
    return { allDay: true, startDate: v.start_date, endDate };
  }
  if (typeof v.start !== "string")
    return null;
  const startMs = Date.parse(v.start);
  if (!Number.isFinite(startMs))
    return null;
  const end = typeof v.end === "string" ? Date.parse(v.end) : NaN;
  return { allDay: false, startMs, endMs: Number.isFinite(end) && end >= startMs ? end : startMs + DEFAULT_EVENT_MS };
}
function addDays(date, n) {
  return dateOf(dayOf(date) + n);
}
const daysBetween = (a, b) => dayOf(b) - dayOf(a);
function occurrenceOf(row, times, extra) {
  const ext = extOf(row);
  return {
    id: row.record_id,
    row,
    title: typeof row.values.title === "string" ? row.values.title : "",
    allDay: times.allDay,
    startMs: times.startMs,
    endMs: times.endMs,
    startDate: times.startDate,
    endDate: times.endDate,
    status: typeof row.values.status === "string" ? row.values.status : null,
    ext,
    recurring: false,
    override: false,
    agentWritten: false,
    ...extra
  };
}
function overlaps(o, window, viewerTz) {
  if (!o.allDay)
    return o.startMs < window.toMs && Math.max(o.endMs, o.startMs + 1) > window.fromMs;
  const from = localDate(window.fromMs, viewerTz), to = localDate(window.toMs - 1, viewerTz);
  return o.startDate <= to && o.endDate >= from;
}
function localDate(ms, tz) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  return f.format(new Date(ms));
}
function viewerTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
function calendarOccurrences(rows, window, opts = {}) {
  const viewerTz = opts.viewerTz ?? viewerTimeZone();
  const out = [];
  const overrides = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const rid = extOf(row).recurrence_id;
    if (rid && typeof rid === "object" && !Array.isArray(rid) && typeof rid.master === "string" && typeof rid.original === "string")
      overrides.set(`${rid.master}@${canonicalOriginal(rid.original)}`, row);
  }
  const byId = new Map(rows.map((r) => [r.record_id, r]));
  for (const row of rows) {
    const times = rowTimes(row);
    if (!times)
      continue;
    const ext = extOf(row);
    const rid = ext.recurrence_id;
    if (rid && typeof rid === "object") {
      const master = typeof rid.master === "string" ? byId.get(rid.master) : void 0;
      const original = typeof rid.original === "string" ? canonicalOriginal(rid.original) : void 0;
      const occ2 = occurrenceOf(row, times, { id: master && original ? occurrenceId(master.record_id, original) : row.record_id, master, original, recurring: Boolean(master), override: true });
      if (overlaps(occ2, window, viewerTz))
        out.push(occ2);
      continue;
    }
    const duration = times.allDay ? daysBetween(times.startDate, times.endDate) : times.endMs - times.startMs;
    const shift = (o) => {
      const key = `${row.record_id}@${o.original}`;
      if (overrides.has(key))
        return null;
      if (times.allDay)
        return occurrenceOf(row, { allDay: true, startDate: o.date, endDate: addDays(o.date, duration) }, { id: key, master: row, original: o.original, recurring: true });
      return occurrenceOf(row, { allDay: false, startMs: o.startMs, endMs: o.startMs + duration }, { id: key, master: row, original: o.original, recurring: true });
    };
    let rule = null;
    if (typeof ext.rrule === "string") {
      try {
        rule = parseRRule(ext.rrule);
      } catch {
        rule = null;
      }
    }
    if (rule) {
      const start = seriesStartOf(row.values, typeof ext.tz === "string" ? ext.tz : void 0, viewerTz);
      if (!start)
        continue;
      const exdate = originals(ext.exdate);
      const occs = expandSeries(rule, start, window, { exdate, viewerTz, durationMs: times.allDay ? void 0 : duration, durationDays: times.allDay ? duration : void 0, limit: opts.limit });
      for (const o of occs) {
        const s = shift(o);
        if (s)
          out.push(s);
      }
      continue;
    }
    if (Array.isArray(ext.occurrences) && ext.occurrences.length > 0) {
      const exdate = new Set(originals(ext.exdate));
      for (const raw of ext.occurrences) {
        if (typeof raw !== "string")
          continue;
        const x = canonicalOriginal(raw);
        if (exdate.has(x))
          continue;
        const o = times.allDay ? { original: x, date: x } : { original: x, startMs: Date.parse(x) };
        if (!times.allDay && !Number.isFinite(o.startMs))
          continue;
        if (times.allDay && !isDate(x))
          continue;
        const s = shift(o);
        if (s && overlaps(s, window, viewerTz))
          out.push({ ...s, agentWritten: true });
      }
      continue;
    }
    const occ = occurrenceOf(row, times, {});
    if (overlaps(occ, window, viewerTz))
      out.push(occ);
  }
  return out.sort((a, b) => sortKey(a) - sortKey(b) || a.id.localeCompare(b.id));
}
const sortKey = (o) => o.allDay ? Date.parse(`${o.startDate}T00:00:00Z`) : o.startMs;
function eventAddOps(sourceId, input) {
  const record_id = input.record_id ?? newRecordId("e");
  const values = { title: input.title, status: input.status ?? void 0, ext: input.ext && Object.keys(input.ext).length ? input.ext : void 0 };
  if (input.all_day) {
    values.all_day = true;
    values.start_date = input.start_date ?? void 0;
    values.end_date = input.end_date && input.end_date !== input.start_date ? input.end_date : void 0;
  } else {
    values.start = input.start ?? void 0;
    values.end = input.end ?? void 0;
  }
  return { record_id, ops: [insertRecordOp(sourceId, [{ record_id, values }])] };
}
function timesChanges(times) {
  return times.allDay ? { all_day: true, start_date: times.startDate, end_date: times.endDate !== times.startDate ? times.endDate : null, start: null, end: null } : { all_day: null, start: times.start, end: times.end, start_date: null, end_date: null };
}
function overridesOf(rows, masterId) {
  return rows.filter((r) => {
    const rid = extOf(r).recurrence_id;
    return rid && typeof rid === "object" && rid.master === masterId;
  });
}
const isoShift = (iso, deltaMs) => new Date(Date.parse(iso) + deltaMs).toISOString();
function shiftOriginal(original, allDay, deltaMs, deltaDays) {
  return allDay ? addDays(original, deltaDays) : isoShift(original, deltaMs);
}
function shiftRule(rule, deltaDays) {
  if (!deltaDays)
    return rule;
  const next = { ...rule };
  if (rule.byDay && rule.byDay.every((d) => d.ordinal === void 0) && (rule.freq === "WEEKLY" || rule.freq === "DAILY")) {
    next.byDay = rule.byDay.map((d) => ({ weekday: ((d.weekday + deltaDays) % 7 + 7) % 7 }));
  } else if (rule.byDay && rule.freq === "MONTHLY" && rule.byDay.length === 1 && rule.bySetPos === void 0 && Math.abs(deltaDays) < 7) {
    next.byDay = [{ ...rule.byDay[0], weekday: ((rule.byDay[0].weekday + deltaDays) % 7 + 7) % 7 }];
  } else if (rule.byMonthDay && rule.byMonthDay.length === 1 && rule.byMonthDay[0] > 0) {
    const d = rule.byMonthDay[0] + deltaDays;
    if (d >= 1 && d <= 28)
      next.byMonthDay = [d];
  }
  return next;
}
function eventEditOps(sourceId, occ, change, scope, ctx) {
  const newId = ctx.newRecordId ?? (() => newRecordId("e"));
  const fieldChanges = (row) => {
    const out = { ...change.values };
    if (change.ext_merge) {
      const ext = extOf(row);
      for (const [k, v] of Object.entries(change.ext_merge))
        if (v === null)
          delete ext[k];
        else
          ext[k] = v;
      out.ext = Object.keys(ext).length ? ext : null;
    }
    return out;
  };
  const master = occ.master;
  if (!master || occ.row !== master && scope === "one") {
    const row = occ.row;
    const changes = { ...fieldChanges(row), ...change.times ? timesChanges(change.times) : {} };
    if (change.rrule !== void 0 && !master) {
      const ext = changes.ext ?? extOf(row);
      const next = { ...ext ?? {} };
      if (change.rrule === null)
        delete next.rrule;
      else
        next.rrule = formatRRule(parseRRule(change.rrule));
      if (change.rrule === null)
        delete next.exdate;
      changes.ext = Object.keys(next).length ? next : null;
    }
    return { ops: setValuesOps(sourceId, row, changes), record_id: row.record_id };
  }
  const original = occ.original;
  const masterTimes = rowTimes(master);
  const masterExt = extOf(master);
  if (scope === "one") {
    const id2 = newId();
    const ext = { ...masterExt, recurrence_id: { master: master.record_id, original } };
    delete ext.rrule;
    delete ext.exdate;
    delete ext.occurrences;
    delete ext.rule_text;
    delete ext.covered_until;
    delete ext.maintenance;
    const base = { title: master.values.title, status: master.values.status, ext };
    const times2 = change.times ?? (occ.allDay ? { allDay: true, startDate: occ.startDate, endDate: addDays(occ.startDate, daysBetween(masterTimes.startDate, masterTimes.endDate)) } : { allDay: false, start: new Date(occ.startMs).toISOString(), end: new Date(occ.startMs + (masterTimes.endMs - masterTimes.startMs)).toISOString() });
    const values2 = { ...base, ...fieldChanges({ record_id: id2, values: { ext } }), ...timesChanges(times2) };
    if (!values2.ext)
      values2.ext = ext;
    return { ops: [insertRecordOp(sourceId, [{ record_id: id2, values: values2 }])], record_id: id2 };
  }
  let deltaMs = 0, deltaDays = 0;
  let durationMs = masterTimes.allDay ? 0 : masterTimes.endMs - masterTimes.startMs;
  let durationDays = masterTimes.allDay ? daysBetween(masterTimes.startDate, masterTimes.endDate) : 0;
  if (change.times) {
    if (change.times.allDay !== masterTimes.allDay)
      throw new Error("changing a series between all-day and timed: edit the series itself (scope all) with new times");
    if (change.times.allDay) {
      deltaDays = daysBetween(original, change.times.startDate);
      durationDays = daysBetween(change.times.startDate, change.times.endDate);
    } else {
      deltaMs = Date.parse(change.times.start) - Date.parse(original);
      deltaDays = Math.round(deltaMs / 864e5);
      durationMs = Date.parse(change.times.end) - Date.parse(change.times.start);
    }
  }
  const rule = typeof masterExt.rrule === "string" ? parseRRule(masterExt.rrule) : null;
  const overrides = overridesOf(ctx.rows, master.record_id);
  const exdate = originals(masterExt.exdate);
  const isFirst = masterTimes.allDay ? original === masterTimes.startDate : original === new Date(masterTimes.startMs).toISOString();
  const seriesTimes = (startMs, startDate) => masterTimes.allDay ? { allDay: true, startDate: addDays(startDate, deltaDays), endDate: addDays(addDays(startDate, deltaDays), durationDays) } : { allDay: false, start: new Date(startMs + deltaMs).toISOString(), end: new Date(startMs + deltaMs + durationMs).toISOString() };
  const nextRule = (r) => {
    if (change.rrule !== void 0)
      return change.rrule === null ? null : formatRRule(parseRRule(change.rrule));
    return r ? formatRRule(shiftRule(r, deltaDays)) : null;
  };
  const ops = [];
  if (scope === "all" || isFirst) {
    const times2 = seriesTimes(masterTimes.startMs, masterTimes.startDate);
    const ext = { ...masterExt };
    const r = nextRule(rule);
    if (r)
      ext.rrule = r;
    else {
      delete ext.rrule;
      delete ext.exdate;
    }
    if (r && exdate.length)
      ext.exdate = exdate.map((x) => shiftOriginal(x, masterTimes.allDay, deltaMs, deltaDays));
    const fc2 = fieldChanges({ record_id: master.record_id, values: { ext } });
    const extOut = fc2.ext !== void 0 ? fc2.ext : ext;
    ops.push(...setValuesOps(sourceId, master, { ...fc2, ...timesChanges(times2), ext: extOut && Object.keys(extOut).length ? extOut : null }));
    for (const o of overrides) {
      const oext = extOf(o);
      const rid = oext.recurrence_id;
      if (!r) {
        ops.push(deleteRecordsOp(sourceId, [o]));
        continue;
      }
      if (deltaMs || deltaDays)
        ops.push(...setValuesOps(sourceId, o, { ext: { ...oext, recurrence_id: { ...rid, original: shiftOriginal(String(rid.original), masterTimes.allDay, deltaMs, deltaDays) } } }));
    }
    return { ops, record_id: master.record_id };
  }
  if (!rule)
    throw new Error("not a repeating event");
  const id = newId();
  const before = (x) => masterTimes.allDay ? x < original : Date.parse(x) < Date.parse(original);
  let headRule = { ...rule };
  let tailRule = { ...rule };
  if (rule.count !== void 0) {
    const start = seriesStartOf(master.values, typeof masterExt.tz === "string" ? masterExt.tz : void 0);
    const fromMs = masterTimes.allDay ? Date.parse(`${masterTimes.startDate}T00:00:00Z`) - 864e5 * 2 : masterTimes.startMs;
    const toMs = masterTimes.allDay ? Date.parse(`${original}T00:00:00Z`) : Date.parse(original);
    const done = expandSeries(rule, start, { fromMs, toMs }, { viewerTz: "UTC" }).filter((o) => before(o.original)).length;
    headRule = { ...rule, count: Math.max(1, done) };
    tailRule = { ...rule, count: Math.max(1, rule.count - done) };
  } else {
    headRule = { ...rule, until: masterTimes.allDay ? addDays(original, -1) : new Date(Date.parse(original) - 1e3).toISOString().replace(/\.\d{3}Z$/, ".000Z") };
  }
  const headExt = { ...masterExt, rrule: formatRRule(headRule) };
  const headEx = exdate.filter(before);
  if (headEx.length)
    headExt.exdate = headEx;
  else
    delete headExt.exdate;
  ops.push(...setValuesOps(sourceId, master, { ext: headExt }));
  const tailExt = { ...masterExt };
  const tr = nextRule(tailRule);
  if (tr)
    tailExt.rrule = tr;
  else
    delete tailExt.rrule;
  const tailEx = exdate.filter((x) => !before(x)).map((x) => shiftOriginal(x, masterTimes.allDay, deltaMs, deltaDays));
  if (tailEx.length && tr)
    tailExt.exdate = tailEx;
  else
    delete tailExt.exdate;
  const times = seriesTimes(masterTimes.allDay ? void 0 : Date.parse(original), masterTimes.allDay ? original : void 0);
  const fc = fieldChanges({ record_id: id, values: { ext: tailExt } });
  const values = { title: master.values.title, status: master.values.status, ...fc, ...timesChanges(times) };
  values.ext = (fc.ext !== void 0 ? fc.ext : tailExt) ?? void 0;
  ops.push(insertRecordOp(sourceId, [{ record_id: id, values }]));
  for (const o of overrides) {
    const oext = extOf(o);
    const rid = oext.recurrence_id;
    if (before(String(rid.original)))
      continue;
    if (!tr) {
      ops.push(deleteRecordsOp(sourceId, [o]));
      continue;
    }
    ops.push(...setValuesOps(sourceId, o, { ext: { ...oext, recurrence_id: { master: id, original: shiftOriginal(String(rid.original), masterTimes.allDay, deltaMs, deltaDays) } } }));
  }
  return { ops, record_id: id };
}
function eventDeleteOps(sourceId, occ, scope, ctx) {
  const master = occ.master;
  if (!master)
    return [deleteRecordsOp(sourceId, [occ.row])];
  const original = occ.original;
  const masterExt = extOf(master);
  const masterTimes = rowTimes(master);
  const overrides = overridesOf(ctx.rows, master.record_id);
  const isFirst = masterTimes.allDay ? original === masterTimes.startDate : original === new Date(masterTimes.startMs).toISOString();
  if (scope === "all" || scope === "following" && isFirst)
    return [deleteRecordsOp(sourceId, [master, ...overrides])];
  const ops = [];
  if (scope === "one") {
    const exdate = originals(masterExt.exdate);
    if (!exdate.includes(original))
      ops.push(...setValuesOps(sourceId, master, { ext: { ...masterExt, exdate: [...exdate, original].sort() } }));
    const own = overrides.filter((o) => canonicalOriginal(String(extOf(o).recurrence_id.original)) === original);
    if (own.length)
      ops.push(deleteRecordsOp(sourceId, own));
    return ops;
  }
  const rule = typeof masterExt.rrule === "string" ? parseRRule(masterExt.rrule) : null;
  if (!rule)
    return [deleteRecordsOp(sourceId, [occ.row])];
  const before = (x) => masterTimes.allDay ? x < original : Date.parse(x) < Date.parse(original);
  const head = { ...rule, count: void 0, until: masterTimes.allDay ? addDays(original, -1) : new Date(Date.parse(original) - 1e3).toISOString() };
  const ext = { ...masterExt, rrule: formatRRule(head) };
  if (Array.isArray(masterExt.exdate)) {
    const keep = originals(masterExt.exdate).filter(before);
    if (keep.length)
      ext.exdate = keep;
    else
      delete ext.exdate;
  }
  ops.push(...setValuesOps(sourceId, master, { ext }));
  const gone = overrides.filter((o) => !before(String(extOf(o).recurrence_id.original)));
  if (gone.length)
    ops.push(deleteRecordsOp(sourceId, gone));
  return ops;
}
const eventSkipOps = (sourceId, occ, ctx) => eventDeleteOps(sourceId, occ, "one", ctx);
function eventPostponeOps(sourceId, occ, minutes, ctx) {
  const times = occ.allDay ? { allDay: true, startDate: addDays(occ.startDate, Math.max(1, Math.round(minutes / 1440))), endDate: addDays(occ.endDate, Math.max(1, Math.round(minutes / 1440))) } : { allDay: false, start: new Date(occ.startMs + minutes * 6e4).toISOString(), end: new Date(occ.endMs + minutes * 6e4).toISOString() };
  return eventEditOps(sourceId, occ, { times }, "one", ctx);
}
class ScheduleClient {
  constructor(aiws, opts = {}) {
    this.aiws = aiws;
    this.handle = null;
    this.locale = opts.locale ?? "zh";
  }
  /** The schedule Workspace with its two tables (created when missing; concurrent first uses converge). */
  async ensure() {
    var _a, _b, _c;
    if (this.handle)
      return this.handle;
    const ws = await this.aiws.call("ws.ensure", { name: SCHEDULE_WORKSPACE_NAME, title: scheduleLabel(this.locale, "workspace") });
    const handle = { workspace_id: ws.workspace_id, epoch: ws.epoch, created: ws.created, todo: SCHEDULE_TODO_ID, calendar: SCHEDULE_CALENDAR_ID };
    const have = /* @__PURE__ */ new Set();
    for (const id of [SCHEDULE_TODO_ID, SCHEDULE_CALENDAR_ID, SCHEDULE_SURFACE_ID]) {
      try {
        const read = await this.aiws.call("doc.read", { workspace_id: ws.workspace_id, entity_id: id });
        if (!read.deleted)
          have.add(id);
      } catch (error) {
        const code = error == null ? void 0 : error.code;
        if (code !== "NOT_FOUND" && code !== "TARGET_DELETED")
          throw error;
      }
    }
    const ops = [];
    if (!have.has(SCHEDULE_TODO_ID))
      ops.push(standardTableOp("todo", { entity_id: SCHEDULE_TODO_ID, parent_id: "data", order_key: "u", locale: this.locale }));
    if (!have.has(SCHEDULE_CALENDAR_ID))
      ops.push(standardTableOp("calendar", { entity_id: SCHEDULE_CALENDAR_ID, parent_id: "data", order_key: "v", locale: this.locale }));
    if (!have.has(SCHEDULE_SURFACE_ID))
      ops.push(...scheduleBoardOps(this.locale));
    if (ops.length) {
      const result = await this.commitTo(handle, ops, "create the schedule", "system");
      const idConflict = (result.sub_code ?? ((_b = (_a = result.errors) == null ? void 0 : _a[0]) == null ? void 0 : _b.sub_code) ?? ((_c = result.error) == null ? void 0 : _c.sub_code)) === "ID_CONFLICT";
      if (result.status !== "accepted" && !(result.status === "rejected" && idConflict))
        throw failureOf(result);
    }
    this.handle = handle;
    return handle;
  }
  async commitTo(handle, operations, message, origin = "agent") {
    var _a;
    const key = `sched-${newRecordId("k")}`;
    const request = (epoch) => ({ protocol_version: AIWS_PROTOCOL_VERSION, workspace_id: handle.workspace_id, epoch, idempotency_key: key, origin, message, operations });
    let result = await this.aiws.call("doc.commit", request(handle.epoch));
    if (result.status === "rejected" && (result.code ?? ((_a = result.error) == null ? void 0 : _a.code)) === "EPOCH_MISMATCH") {
      const info = await this.aiws.call("ws.get_info", { workspace_id: handle.workspace_id });
      handle.epoch = info.epoch;
      result = await this.aiws.call("doc.commit", request(handle.epoch));
    }
    return result;
  }
  /** Commit operations into the schedule; a refusal or conflict throws with the service's reason. */
  async commit(operations, message) {
    const handle = await this.ensure();
    const result = await this.commitTo(handle, operations, message);
    if (result.status !== "accepted")
      throw failureOf(result);
    return result;
  }
  async rows(sourceId, filter) {
    const handle = await this.ensure();
    const rows = [];
    let cursor;
    for (let i = 0; i < 100; i++) {
      const page = await this.aiws.call("doc.query", { workspace_id: handle.workspace_id, source_id: sourceId, limit: 1e3, ...filter ? { filter } : {}, ...cursor ? { cursor } : {} });
      rows.push(...page.rows);
      if (!page.next_cursor || page.rows.length === 0)
        break;
      cursor = page.next_cursor;
    }
    return rows;
  }
  async row(sourceId, recordId) {
    const handle = await this.ensure();
    const r = await this.aiws.call("doc.read", { workspace_id: handle.workspace_id, entity_id: sourceId, selector: { kind: "table_record", record_id: recordId } });
    const row = r.content;
    if (!(row == null ? void 0 : row.record_id))
      throw new AiwsFailure({ code: "NOT_FOUND", retryable: false, detail: `record ${recordId} not found` });
    return row;
  }
  // ---- to-do
  async todos(opts = {}) {
    const items = sortTodos((await this.rows(SCHEDULE_TODO_ID)).map(todoItem));
    return opts.includeDone ? items : items.filter((i) => !i.done);
  }
  async addTodo(input, place = {}) {
    var _a, _b, _c, _d;
    const items = sortTodos((await this.rows(SCHEDULE_TODO_ID)).map(todoItem));
    const at = (id) => items.find((i) => i.record_id === id);
    let pos = { items };
    if (place.after) {
      const i = items.findIndex((x) => x.record_id === place.after);
      pos = { after: ((_a = at(place.after)) == null ? void 0 : _a.order) ?? null, before: ((_b = items[i + 1]) == null ? void 0 : _b.order) ?? null };
    } else if (place.before) {
      const i = items.findIndex((x) => x.record_id === place.before);
      pos = { after: ((_c = items[i - 1]) == null ? void 0 : _c.order) ?? null, before: ((_d = at(place.before)) == null ? void 0 : _d.order) ?? null };
    }
    const { record_id, ops } = todoAddOps(SCHEDULE_TODO_ID, input, pos);
    await this.commit(ops, `add to-do: ${input.title}`);
    return todoItem(await this.row(SCHEDULE_TODO_ID, record_id));
  }
  async completeTodo(recordId, done = true) {
    const row = await this.row(SCHEDULE_TODO_ID, recordId);
    const ops = todoCompleteOps(SCHEDULE_TODO_ID, row, done);
    if (ops.length)
      await this.commit(ops, `${done ? "complete" : "reopen"} to-do ${recordId}`);
  }
  async updateTodo(recordId, changes) {
    const row = await this.row(SCHEDULE_TODO_ID, recordId);
    const ops = todoUpdateOps(SCHEDULE_TODO_ID, row, changes);
    if (ops.length)
      await this.commit(ops, `update to-do ${recordId}`);
  }
  /** Move a to-do before / after another one, and / or into another status. */
  async moveTodo(recordId, to) {
    const items = sortTodos((await this.rows(SCHEDULE_TODO_ID)).map(todoItem));
    const row = items.find((i) => i.record_id === recordId);
    if (!row)
      throw new AiwsFailure({ code: "NOT_FOUND", retryable: false, detail: `to-do ${recordId} not found` });
    const others = items.filter((i) => i.record_id !== recordId);
    let order;
    if (to.before || to.after) {
      const anchor = others.findIndex((i) => i.record_id === (to.before ?? to.after));
      if (anchor < 0)
        throw new AiwsFailure({ code: "NOT_FOUND", retryable: false, detail: `to-do ${to.before ?? to.after} not found` });
      order = orderAt(others, to.before ? anchor : anchor + 1);
    }
    const ops = todoMoveOps(SCHEDULE_TODO_ID, row, { status: to.status, order });
    if (ops.length)
      await this.commit(ops, `move to-do ${recordId}`);
  }
  async removeTodos(recordIds) {
    const rows = await Promise.all(recordIds.map((id) => this.row(SCHEDULE_TODO_ID, id)));
    await this.commit([deleteRecordsOp(SCHEDULE_TODO_ID, rows)], `delete to-do ${recordIds.join(", ")}`);
  }
  // ---- calendar
  async events(window, opts = {}) {
    return calendarOccurrences(await this.rows(SCHEDULE_CALENDAR_ID), window, opts);
  }
  async addEvent(input) {
    var _a;
    if (((_a = input.ext) == null ? void 0 : _a.rrule) !== void 0 && typeof input.ext.rrule === "string")
      input = { ...input, ext: { ...input.ext, rrule: formatRRule(parseRRule(input.ext.rrule)) } };
    const { record_id, ops } = eventAddOps(SCHEDULE_CALENDAR_ID, input);
    await this.commit(ops, `add event: ${input.title}`);
    return record_id;
  }
  /** The occurrence an id names (`record_id` or `<master>@<original>`), from all rows. */
  async occurrence(id) {
    const rows = await this.rows(SCHEDULE_CALENDAR_ID);
    return { occ: findOccurrence(rows, id), rows };
  }
  async editEvent(id, change, scope = "one") {
    const { occ, rows } = await this.occurrence(id);
    const { ops, record_id } = eventEditOps(SCHEDULE_CALENDAR_ID, occ, change, scope, { rows });
    if (ops.length)
      await this.commit(ops, `edit event ${id} (${scope})`);
    return record_id;
  }
  async deleteEvent(id, scope = "one") {
    const { occ, rows } = await this.occurrence(id);
    await this.commit(eventDeleteOps(SCHEDULE_CALENDAR_ID, occ, scope, { rows }), `delete event ${id} (${scope})`);
  }
}
function failureOf(result) {
  var _a, _b, _c, _d;
  const first = (_a = result.errors) == null ? void 0 : _a[0];
  if (result.status === "conflict") {
    const c = (_b = result.conflicts) == null ? void 0 : _b[0];
    return new AiwsFailure({ code: result.code ?? "REVISION_CONFLICT", retryable: true, detail: `changed meanwhile, read it again${c ? `: ${JSON.stringify(c.selector ?? c)}` : ""}` });
  }
  return new AiwsFailure({ code: result.code ?? ((_c = result.error) == null ? void 0 : _c.code) ?? "REJECTED", sub_code: result.sub_code ?? (first == null ? void 0 : first.sub_code), retryable: false, detail: (first == null ? void 0 : first.detail) ?? result.detail ?? ((_d = result.error) == null ? void 0 : _d.detail) ?? "refused" });
}
function findOccurrence(rows, id) {
  const at = id.indexOf("@");
  const recordId = at < 0 ? id : id.slice(0, at);
  const original = at < 0 ? null : canonicalOriginal(id.slice(at + 1));
  const row = rows.find((r) => r.record_id === recordId);
  if (!row)
    throw new AiwsFailure({ code: "NOT_FOUND", retryable: false, detail: `event ${recordId} not found` });
  if (original === null) {
    const times2 = rowTimes(row);
    if (!times2)
      throw new AiwsFailure({ code: "INVALID_OPERATION", retryable: false, detail: `event ${recordId} has no time` });
    const ext = extOf(row);
    const rid = ext.recurrence_id;
    const master = rid && typeof rid.master === "string" ? rows.find((r) => r.record_id === rid.master) : void 0;
    return occurrenceOf(row, times2, master ? { master, original: String(rid.original), recurring: true, override: true } : { recurring: typeof ext.rrule === "string", master: typeof ext.rrule === "string" ? row : void 0, original: typeof ext.rrule === "string" ? times2.allDay ? times2.startDate : new Date(times2.startMs).toISOString() : void 0 });
  }
  const override = rows.find((r) => {
    const rid = extOf(r).recurrence_id;
    return rid && rid.master === recordId && typeof rid.original === "string" && canonicalOriginal(rid.original) === canonicalOriginal(original);
  });
  const times = rowTimes(row);
  if (!times)
    throw new AiwsFailure({ code: "INVALID_OPERATION", retryable: false, detail: `event ${recordId} has no time` });
  if (override)
    return occurrenceOf(override, rowTimes(override), { id, master: row, original, recurring: true, override: true });
  const allDay = times.allDay;
  const durationMs = allDay ? 0 : times.endMs - times.startMs;
  const durationDays = allDay ? daysBetween(times.startDate, times.endDate) : 0;
  const occTimes = allDay ? { allDay: true, startDate: original, endDate: addDays(original, durationDays) } : { allDay: false, startMs: Date.parse(original), endMs: Date.parse(original) + durationMs };
  return occurrenceOf(row, occTimes, { id, master: row, original, recurring: true });
}
function scheduleBoardOps(locale = "zh") {
  const folder = `${SCHEDULE_SURFACE_ID}-content`;
  const title = scheduleLabel(locale, "board");
  return [
    { op: "entity.create", entity_id: folder, type_id: "buckyos.container", parent_id: "canvas-content", order_key: "u", name: title, payload: { kind: "folder", title, system: "surface_content", surface_id: SCHEDULE_SURFACE_ID } },
    { op: "entity.create", entity_id: SCHEDULE_SURFACE_ID, type_id: "buckyos.container", parent_id: "surfaces", order_key: "a", name: title, payload: { kind: "surface", layout: { mode: "free" }, title, content_folder_id: folder } },
    {
      op: "entity.create",
      entity_id: `${SCHEDULE_SURFACE_ID}-calendar`,
      type_id: "buckyos.container",
      parent_id: SCHEDULE_SURFACE_ID,
      order_key: "a",
      placement: { x: 40, y: 40, w: 880, h: 640 },
      payload: { kind: "calendar", layout: { mode: "data" }, title: scheduleLabel(locale, "calendar_table"), bindings: { events: { entity_id: SCHEDULE_CALENDAR_ID }, todo: { entity_id: SCHEDULE_TODO_ID } }, config: { view: "week" } }
    },
    {
      op: "entity.create",
      entity_id: `${SCHEDULE_SURFACE_ID}-todo`,
      type_id: "buckyos.container",
      parent_id: SCHEDULE_SURFACE_ID,
      order_key: "b",
      placement: { x: 960, y: 40, w: 420, h: 640 },
      payload: { kind: "todo", layout: { mode: "data" }, title: scheduleLabel(locale, "todo_table"), bindings: { items: { entity_id: SCHEDULE_TODO_ID } }, config: { mode: "list" } }
    }
  ];
}
class BindFailure extends Error {
  constructor(message, code, node, binding) {
    super(message);
    this.code = code;
    this.node = node;
    this.binding = binding;
  }
}
const STANDARD_SCHEMAS = [TODO_SCHEMA_ID, CALENDAR_SCHEMA_ID];
const asList = (v) => v === void 0 ? [] : Array.isArray(v) ? v : [v];
const label = (name, decl) => decl.title ?? name;
function bindingAccepts(decl, data) {
  if (decl.accepts && decl.accepts.length > 0 && !decl.accepts.includes(data.type_id))
    return false;
  if (decl.schema_id && data.schema_id !== decl.schema_id)
    return false;
  return true;
}
const queryOf = (decl) => {
  var _a;
  return { ...((_a = decl.accepts) == null ? void 0 : _a.length) ? { accepts: decl.accepts } : {}, ...decl.schema_id ? { schema_id: decl.schema_id } : {} };
};
function noUiDialogs() {
  const fail = (title) => {
    throw new BindFailure(`needs a choice: ${title}`, "NEEDS_UI");
  };
  return { pickOne: async (o) => fail(o.title), pickMany: async (o) => fail(o.title), confirm: async (o) => fail(o.title) };
}
let refSeq = 0;
const newRef = () => `ref:${++refSeq}`;
const defaultOnBind = async (ctx) => {
  const bindings = {};
  const create = [];
  const parentData = ctx.parent ? Object.values(ctx.parent.bound).flatMap(asList) : [];
  const known = new Map(ctx.find({}).map((d) => [d.entity_id, d]));
  for (const [name, decl] of Object.entries(ctx.decls)) {
    const failNamed = (message, code) => new BindFailure(message, code, ctx.node, name);
    if (ctx.reason === "rebind") {
      if (ctx.given[name] !== void 0 && ctx.no_ui) {
        bindings[name] = ctx.given[name];
        continue;
      }
      const current = asList(ctx.given[name]);
      if (decl.many) {
        const picked = await withName(name, () => ctx.dialogs.pickMany({ title: label(name, decl), query: queryOf(decl), preselect: current, allow_new: ctx.canCreate(decl) }));
        if (picked === null)
          return null;
        bindings[name] = picked;
      } else {
        const picked = await withName(name, () => ctx.dialogs.pickOne({ title: label(name, decl), query: queryOf(decl), allow_new: ctx.canCreate(decl), current: current[0] ?? null }));
        if (picked === null)
          return null;
        if (typeof picked === "string")
          bindings[name] = picked;
        else {
          const ref = newRef();
          create.push(standardSpec(ref, decl, ctx.title));
          bindings[name] = ref;
        }
      }
      continue;
    }
    if (ctx.given[name] !== void 0) {
      bindings[name] = decl.many ? asList(ctx.given[name]) : asList(ctx.given[name])[0];
      continue;
    }
    const fromParent = parentData.filter((id) => {
      const d = known.get(id);
      return d !== void 0 && bindingAccepts(decl, d);
    });
    if (decl.many && fromParent.length > 0) {
      bindings[name] = fromParent;
      continue;
    }
    if (!decl.many && fromParent.length === 1) {
      bindings[name] = fromParent[0];
      continue;
    }
    const found = ctx.find(queryOf(decl)).filter((d) => bindingAccepts(decl, d));
    if (found.length === 0) {
      if (!decl.required)
        continue;
      if (!ctx.canCreate(decl))
        throw failNamed(`no ${label(name, decl)} in this Workspace yet`, "NO_DATA");
      const ref = newRef();
      create.push(standardSpec(ref, decl, ctx.title));
      bindings[name] = decl.many ? [ref] : ref;
    } else if (decl.many) {
      bindings[name] = found.map((d) => d.entity_id);
    } else if (found.length === 1) {
      bindings[name] = found[0].entity_id;
    } else if (decl.required) {
      const picked = await withName(name, () => ctx.dialogs.pickOne({ title: label(name, decl), query: queryOf(decl), allow_new: ctx.canCreate(decl) }));
      if (picked === null)
        return null;
      if (typeof picked === "string")
        bindings[name] = picked;
      else {
        const ref = newRef();
        create.push(standardSpec(ref, decl, ctx.title));
        bindings[name] = ref;
      }
    }
  }
  return { bindings, create };
};
function standardSpec(ref, decl, title) {
  return { ref, kind: "standard", schema_id: decl.schema_id, name: title || decl.title || "Table" };
}
async function withName(binding, run) {
  try {
    return await run();
  } catch (error) {
    if (error instanceof BindFailure && error.code === "NEEDS_UI")
      throw new BindFailure(`binding ${binding} needs a choice: give it`, "NEEDS_UI", void 0, binding);
    throw error;
  }
}
function stepsOnBind(steps) {
  return async (ctx) => {
    var _a;
    const bindings = {};
    const create = [];
    for (const step of steps) {
      const decl = ctx.decls[step.binding] ?? {};
      if (ctx.given[step.binding] !== void 0 && ctx.reason === "insert") {
        bindings[step.binding] = ctx.given[step.binding];
        continue;
      }
      if ("from_parent" in step) {
        const v = (_a = ctx.parent) == null ? void 0 : _a.bound[step.from_parent];
        if (v !== void 0)
          bindings[step.binding] = decl.many ? asList(v) : asList(v)[0];
      } else if ("pick" in step) {
        const query = queryOf(decl);
        const title = step.title ?? label(step.binding, decl);
        const allowNew = step.allow_new !== false && ctx.canCreate(decl);
        const current = asList(ctx.given[step.binding]);
        if (step.pick === "all")
          bindings[step.binding] = ctx.find(query).filter((d) => bindingAccepts(decl, d)).map((d) => d.entity_id);
        else if (step.pick === "many") {
          const picked = await withName(step.binding, () => ctx.dialogs.pickMany({ title, query, preselect: current.length ? current : "none", allow_new: allowNew }));
          if (picked === null)
            return null;
          bindings[step.binding] = picked;
        } else {
          const picked = await withName(step.binding, () => ctx.dialogs.pickOne({ title, query, allow_new: allowNew, current: current[0] ?? null }));
          if (picked === null)
            return null;
          if (typeof picked === "string")
            bindings[step.binding] = decl.many ? [picked] : picked;
          else {
            const ref = newRef();
            create.push(standardSpec(ref, decl, ctx.title));
            bindings[step.binding] = decl.many ? [ref] : ref;
          }
        }
      } else {
        const missing = ctx.find(queryOf(decl)).filter((d) => bindingAccepts(decl, d)).length === 0;
        if ((step.when ?? "missing") === "missing" && !missing)
          continue;
        const ref = newRef();
        const c = step.create;
        create.push("standard" in c ? { ref, kind: "standard", schema_id: c.standard, name: label(step.binding, decl) } : "table" in c ? { ref, kind: "table", name: c.table.name, title_field_id: c.table.title_field_id, fields: c.table.fields } : { ref, kind: "dir", name: c.dir.name });
        bindings[step.binding] = decl.many ? [ref] : ref;
      }
    }
    const rest = Object.fromEntries(Object.entries(ctx.decls).filter(([name]) => bindings[name] === void 0));
    if (Object.keys(rest).length > 0) {
      const more = await defaultOnBind({ ...ctx, decls: rest });
      if (more === null)
        return null;
      Object.assign(bindings, more.bindings);
      create.push(...more.create);
    }
    return { bindings, create };
  };
}
const missingOf = (decls, bound) => Object.entries(decls).filter(([name, d]) => d.required && asList(bound[name]).length === 0).map(([name, d]) => label(name, d));
const defaultOnInit = async (ctx) => {
  const own = missingOf(ctx.decls, ctx.bound);
  if (own.length > 0)
    return `${ctx.title}: ${own.join(", ")} not bound`;
  const waiting = ctx.children.filter((c) => !c.ready);
  return waiting.length > 0 ? `not ready: ${waiting.map((c) => `${c.title} (${c.missing.join(", ")})`).join("; ")}` : true;
};
async function resolveBindings(root, host) {
  const schemas = host.standardSchemas ?? STANDARD_SCHEMAS;
  const dialogs = host.no_ui ? noUiDialogs() : host.dialogs;
  const results = /* @__PURE__ */ new Map();
  const then = [];
  const visit = async (node, parent) => {
    const ctx = {
      reason: host.reason,
      no_ui: host.no_ui,
      node: node.id,
      title: node.title,
      decls: node.decls,
      given: node.given ?? {},
      parent,
      find: host.find,
      canCreate: (d) => Boolean(d.schema_id && schemas.includes(d.schema_id)),
      dialogs
    };
    const run = typeof node.onBind === "function" ? node.onBind : Array.isArray(node.onBind) ? stepsOnBind(node.onBind) : defaultOnBind;
    let result;
    try {
      result = await run(ctx);
    } catch (error) {
      if (error instanceof BindFailure)
        throw new BindFailure(error.message, error.code, error.node ?? node.id, error.binding);
      throw error;
    }
    if (result === null)
      throw new BindFailure(`${node.title}: cancelled`, "CANCELLED", node.id);
    results.set(node.id, result);
    const children = [];
    for (const child of node.children)
      children.push(await visit(child, { decls: node.decls, bound: result.bindings }));
    const init = typeof node.onInit === "function" ? node.onInit : defaultOnInit;
    const steps = Array.isArray(node.onInit) ? node.onInit : [];
    const verdict = await init({ reason: host.reason, no_ui: host.no_ui, node: node.id, title: node.title, decls: node.decls, bound: result.bindings, children, dialogs });
    if (verdict !== true)
      throw new BindFailure(verdict, "NOT_READY", node.id);
    for (const step of steps)
      if ("then" in step)
        then.push({ node: node.id, action: step.then.action });
    return { node: node.id, title: node.title, ready: true, missing: [] };
  };
  try {
    await visit(root, host.parent ?? null);
    return { ok: true, results, then };
  } catch (error) {
    if (error instanceof BindFailure)
      return { ok: false, error };
    throw error;
  }
}
function createOps(results, opts) {
  const ops = [];
  const ids = {};
  for (const result of results.values()) {
    for (const spec of result.create) {
      const entity_id = opts.newId();
      ids[spec.ref] = entity_id;
      const base = { entity_id, parent_id: opts.folderId, order_key: opts.orderKey(), name: opts.freeName(spec.name) };
      if (spec.kind === "standard") {
        const kind = spec.schema_id === TODO_SCHEMA_ID ? "todo" : spec.schema_id === CALENDAR_SCHEMA_ID ? "calendar" : null;
        if (!kind)
          throw new BindFailure(`cannot create a table of ${spec.schema_id}`, "INVALID");
        ops.push(standardTableOp(kind, { ...base, locale: opts.locale }));
      } else if (spec.kind === "table") {
        ops.push({ op: "entity.create", type_id: "buckyos.table-source", ...base, payload: { fields: spec.fields, ...spec.title_field_id ? { title_field_id: spec.title_field_id } : {} } });
      } else {
        ops.push({ op: "entity.create", type_id: "buckyos.dir", ...base, payload: { members: {} } });
      }
    }
  }
  return { ops, ids };
}
function bindingsPayload(bound, decls, ids) {
  var _a;
  const out = {};
  for (const [name, value] of Object.entries(bound)) {
    const list2 = asList(value).map((id) => ({ entity_id: ids[id] ?? id }));
    if (((_a = decls[name]) == null ? void 0 : _a.many) || Array.isArray(value)) {
      if (list2.length > 0)
        out[name] = list2;
    } else if (list2[0])
      out[name] = list2[0];
  }
  return out;
}
function boundIds(value) {
  return value === null || value === void 0 ? [] : Array.isArray(value) ? value : [value];
}
function checkBindSteps(onBind, onInit, decls, actions) {
  var _a, _b, _c, _d;
  const out = [];
  if (onBind !== void 0) {
    if (!Array.isArray(onBind) || onBind.length > 16)
      out.push("on_bind: at most 16 steps");
    else
      for (const [i, raw] of onBind.entries()) {
        const s = raw;
        const where = `on_bind[${i}]`;
        if (!s || typeof s !== "object" || typeof s.binding !== "string") {
          out.push(`${where}: names a binding`);
          continue;
        }
        const decl = decls[s.binding];
        if (!decl) {
          out.push(`${where}: ${s.binding} is not a declared binding`);
          continue;
        }
        const kinds = ["pick", "from_parent", "create"].filter((k) => k in s);
        if (kinds.length !== 1) {
          out.push(`${where}: one of pick, from_parent, create`);
          continue;
        }
        if ("pick" in s && !["one", "many", "all"].includes(String(s.pick)))
          out.push(`${where}: pick is one, many or all`);
        if ("pick" in s && s.pick !== "one" && !decl.many)
          out.push(`${where}: ${s.binding} takes one`);
        if ("from_parent" in s && typeof s.from_parent !== "string")
          out.push(`${where}: from_parent names a binding of the parent`);
        if ("create" in s) {
          const c = s.create;
          const which = c && typeof c === "object" ? ["standard", "table", "dir"].filter((k) => k in c) : [];
          if (which.length !== 1)
            out.push(`${where}: create one of standard, table, dir`);
          else if (which[0] === "standard" && !STANDARD_SCHEMAS.includes(String(c.standard)))
            out.push(`${where}: no standard table ${String(c.standard)}`);
          else if (which[0] === "table" && (!Array.isArray((_a = c.table) == null ? void 0 : _a.fields) || typeof ((_b = c.table) == null ? void 0 : _b.name) !== "string"))
            out.push(`${where}: create.table needs name and fields`);
          else if (which[0] === "dir" && typeof ((_c = c.dir) == null ? void 0 : _c.name) !== "string")
            out.push(`${where}: create.dir needs name`);
          if (s.when !== void 0 && s.when !== "missing" && s.when !== "always")
            out.push(`${where}: when is missing or always`);
        }
      }
  }
  if (onInit !== void 0) {
    if (!Array.isArray(onInit) || onInit.length > 16)
      out.push("on_init_control: at most 16 steps");
    else
      for (const [i, raw] of onInit.entries()) {
        const s = raw;
        const where = `on_init_control[${i}]`;
        if ((s == null ? void 0 : s.require) === "children")
          continue;
        const action = (_d = s == null ? void 0 : s.then) == null ? void 0 : _d.action;
        if (typeof action !== "string")
          out.push(`${where}: { require: "children" } or { then: { action } }`);
        else if (!actions.includes(action))
          out.push(`${where}: ${action} is not a declared action`);
      }
  }
  return out;
}
export {
  canonicalOriginal as $,
  AIWORKSPACE_SERVICE_NAME as A,
  originalOf as B,
  occurrenceId as C,
  parseOccurrenceId as D,
  describeRRule as E,
  recurrencePresets as F,
  CALENDAR_SCHEMA_ID as G,
  SCHEDULE_TODO_ID as H,
  SCHEDULE_CALENDAR_ID as I,
  SCHEDULE_SURFACE_ID as J,
  TODO_DONE as K,
  AIWS_PROTOCOL_VERSION as L,
  scheduleLabel as M,
  todoFields as N,
  calendarFields as O,
  standardTableOp as P,
  isOrderKey as Q,
  RRuleError as R,
  SCHEDULE_WORKSPACE_NAME as S,
  TODO_SCHEMA_ID as T,
  orderKeyBetween as U,
  orderKeysBetween as V,
  WEEKDAYS as W,
  newRecordId as X,
  setValuesOps as Y,
  insertRecordOp as Z,
  deleteRecordsOp as _,
  AiwsFailure as a,
  todoItem as a0,
  sortTodos as a1,
  todoAddOps as a2,
  todoCompleteOps as a3,
  todoMoveOps as a4,
  todoUpdateOps as a5,
  orderAt as a6,
  localDate as a7,
  viewerTimeZone as a8,
  calendarOccurrences as a9,
  eventAddOps as aa,
  eventEditOps as ab,
  eventDeleteOps as ac,
  eventSkipOps as ad,
  eventPostponeOps as ae,
  ScheduleClient as af,
  findOccurrence as ag,
  scheduleBoardOps as ah,
  BindFailure as ai,
  STANDARD_SCHEMAS as aj,
  bindingAccepts as ak,
  noUiDialogs as al,
  defaultOnBind as am,
  stepsOnBind as an,
  defaultOnInit as ao,
  resolveBindings as ap,
  createOps as aq,
  bindingsPayload as ar,
  boundIds as as,
  checkBindSteps as at,
  aiwsReferenceUrl as b,
  AIWS_COMMIT_PART_BYTES as c,
  AIWS_COMMIT_MAX_BYTES as d,
  AIWS_COMMIT_MAX_OPERATIONS as e,
  commitOverLimit as f,
  commitWithParts as g,
  AiWorkspaceClient as h,
  parseRRule as i,
  formatRRule as j,
  isDate as k,
  isLeap as l,
  daysInMonth as m,
  dayNumber as n,
  dayOf as o,
  parseAiwsReferenceUrl as p,
  dateOf as q,
  isTimeZone as r,
  splitCommitOperations as s,
  zonedToUtc as t,
  localDay as u,
  expandSeries as v,
  weekdayOf as w,
  seriesStartOf as x,
  ymdOf as y,
  zonedParts as z
};
//# sourceMappingURL=aiws_bind-739b0d11.mjs.map
