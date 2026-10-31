const AIWS_COMPONENT_FILE = "component.json";
const AIWS_COMPOSITION_FILE = "composition.json";
const AIWS_MANIFEST_FILE = "aiws-manifest.json";
const AIWS_BUILD_STATE_FILE = ".aiws-build.json";
const AIWS_MANIFEST_VERSION = 2;
const AIWS_HTML_API_VERSION = 2;
const AIWS_DECLARATIVE_API_VERSION = 1;
const AIWS_MAX_SOURCE_FILES = 64;
class AiwsSourceError extends Error {
  constructor(diagnostics) {
    super(diagnostics.filter((d) => d.severity === "error").map((d) => `${d.file ? `${d.file}: ` : ""}${d.message}`).join("; ") || "invalid control source");
    this.name = "AiwsSourceError";
    this.diagnostics = diagnostics;
  }
}
const encoder = new TextEncoder();
const decoder = new TextDecoder();
function joinPath(dir, name) {
  return `${dir.replace(/\/+$/, "")}/${name}`;
}
function folderName(title) {
  const cleaned = title.replace(/[/\\\u0000-\u001f]/g, " ").replace(/^\.+/, "").trim();
  return cleaned.slice(0, 80) || "Workspace";
}
function homeControlDir(owner, workspaceTitle, name) {
  return `/home/${owner}/AI Workspace/${folderName(workspaceTitle)}/controls/${name}`;
}
function homeExportDir(owner, pkg) {
  return `/home/${owner}/AI Workspace/exports/${pkg}`;
}
function sourceStateKey(defEntityId) {
  return `aiws:src:${defEntityId}`;
}
async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
async function aiwsContentDigest(files) {
  const pairs = [];
  for (const [name, bytes] of files)
    pairs.push([name, await sha256Hex(bytes)]);
  pairs.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return `sha256:${await sha256Hex(encoder.encode(JSON.stringify(pairs)))}`;
}
function sourcesKey(files) {
  return JSON.stringify([...files].sort((a, b) => a.name.localeCompare(b.name)).map((f) => [f.name, f.obj_id ?? f.etag ?? ""]));
}
const AIWS_MAX_INLINE_BYTES = 4 * 1024 * 1024;
function base64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768)
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
}
async function packBuildFiles(files, upload, byRef = []) {
  let total = files.reduce((n, f) => n + f.bytes.length, 0);
  const uploaded = /* @__PURE__ */ new Map();
  if (total > AIWS_MAX_INLINE_BYTES) {
    if (!upload)
      throw new AiwsSourceError([{ file: "", severity: "error", message: `a control's inline files are limited to ${AIWS_MAX_INLINE_BYTES} bytes per build` }]);
    for (const f of [...files].sort((a, b) => b.bytes.length - a.bytes.length)) {
      if (total <= AIWS_MAX_INLINE_BYTES)
        break;
      uploaded.set(f.name, await upload(f.name, f.bytes));
      total -= f.bytes.length;
    }
  }
  const out = [...byRef];
  for (const f of files) {
    const obj = uploaded.get(f.name);
    out.push(obj ? { name: f.name, obj_id: obj } : { name: f.name, base64: base64(f.bytes) });
  }
  return out.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}
async function buildFiles(nfsp, files, upload) {
  var _a;
  const byRef = [];
  const inline = [];
  for (const f of files) {
    if ((_a = f.obj_id) == null ? void 0 : _a.startsWith("cyfile:")) {
      byRef.push({ name: f.name, obj_id: f.obj_id });
      continue;
    }
    if (!f.node_id)
      throw new AiwsSourceError([{ file: f.name, severity: "error", message: "the file service did not name this file" }]);
    inline.push({ name: f.name, bytes: new Uint8Array(await (await nfsp.readFile(f.node_id)).arrayBuffer()) });
  }
  return packBuildFiles(inline, upload, byRef);
}
const COMPONENT_KEYS = ["manifest_version", "ident", "kind", "title", "description", "host_api", "accepts", "allow_no_source", "default_size", "config_schema", "bindings", "entry", "assets", "catalog", "agent", "deps"];
const SCHEMA_KEYWORDS = ["type", "enum", "default", "required", "title", "description", "minimum", "maximum", "minLength", "maxLength", "properties", "items"];
const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const DID = /^did:[a-z0-9]+:[^/#\s]+$/;
const BINDING = /^[a-z][a-z0-9_]{0,31}$/;
const IDENT = /^did:[a-z0-9]+:[^/#\s]+#[a-z0-9][a-z0-9._-]{0,63}$/;
const EVENTS_LATER = "events are not supported yet (a later AI Workspace version adds them)";
const V2_HINT = "needs manifest_version 2 (raise it in component.json)";
function isSourcePath(name) {
  return name.length > 0 && encoder.encode(name).length <= 255 && !name.includes("\0") && name.split("/").every((seg) => seg.length > 0 && !seg.startsWith("."));
}
function schemaProblems(v, path, out) {
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    out.push(`${path}: a schema is an object`);
    return;
  }
  for (const [k, x] of Object.entries(v)) {
    if (!SCHEMA_KEYWORDS.includes(k)) {
      out.push(`${path}/${k}: keyword ${k} is outside the supported subset`);
      continue;
    }
    if (k === "properties" && x && typeof x === "object")
      for (const [n, s] of Object.entries(x))
        schemaProblems(s, `${path}/properties/${n}`, out);
    if (k === "items")
      schemaProblems(x, `${path}/items`, out);
  }
}
function checkComposition(text, configSchema, file = AIWS_COMPOSITION_FILE) {
  const out = [];
  const error = (message) => out.push({ file, severity: "error", message });
  let o;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      error("a composition is a JSON object { layout, slots, chrome? }");
      return out;
    }
    o = parsed;
  } catch (e) {
    error(e instanceof Error ? e.message : String(e));
    return out;
  }
  const props = (configSchema == null ? void 0 : configSchema.properties) ?? {};
  const placeholders = (t, at) => {
    for (const m of t.matchAll(/\{\{([^}]*)\}\}/g)) {
      const inner = m[1].trim();
      if (!inner.startsWith("config."))
        error(`${at}: only {{config.<key>}} may be used here`);
      else if (!(inner.slice(7) in props))
        error(`${at}: {{${inner}}} names no property of config_schema`);
    }
  };
  const dimension = (v, at, max) => {
    if (typeof v === "number" && v >= 0 && v <= max)
      return;
    if (typeof v === "string" && /^\s*\{\{.*\}\}\s*$/.test(v)) {
      placeholders(v, at);
      return;
    }
    error(`${at}: a number in [0, ${max}] or {{config.<key>}}`);
  };
  for (const k of Object.keys(o)) {
    if (k === "events")
      error(EVENTS_LATER);
    else if (!["layout", "slots", "chrome"].includes(k))
      error(`unknown key ${k} (a composition says layout, slots and chrome)`);
  }
  const layout = o.layout;
  let algorithm = "stack";
  if (!layout || typeof layout !== "object")
    error("layout { algorithm: stack | fixed } required");
  else {
    if (layout.algorithm === "stack" || layout.algorithm === "fixed")
      algorithm = layout.algorithm;
    else
      error(`layout.algorithm ${JSON.stringify(layout.algorithm)}: stack or fixed (the algorithms the host ships)`);
    for (const [k, v] of Object.entries(layout)) {
      if (k === "algorithm")
        continue;
      if ((k === "direction" || k === "spacing") && algorithm !== "stack") {
        error(`layout.${k} belongs to the stack layout`);
        continue;
      }
      if (k === "direction") {
        if (v !== "column" && v !== "row")
          error("layout.direction: column or row");
      } else if (k === "spacing")
        dimension(v, "layout.spacing", 2e3);
      else if (k === "padding") {
        if (v && typeof v === "object" && !Array.isArray(v))
          for (const [side, n] of Object.entries(v)) {
            if (!["t", "r", "b", "l"].includes(side))
              error(`layout.padding.${side}: t, r, b or l`);
            dimension(n, `layout.padding.${side}`, 2e3);
          }
        else
          dimension(v, "layout.padding", 2e3);
      } else
        error(`layout: unknown key ${k}`);
    }
  }
  const slots = o.slots && typeof o.slots === "object" && !Array.isArray(o.slots) ? o.slots : null;
  if (!slots)
    error("slots { <name>: { accepts?, min?, max?, placement? } } required");
  else {
    if (Object.keys(slots).length > 16)
      error("at most 16 slots");
    for (const [name, raw] of Object.entries(slots)) {
      const at = `slots.${name}`;
      if (!BINDING.test(name))
        error(`${at}: a slot name is [a-z][a-z0-9_]{0,31}`);
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        error(`${at} must be an object`);
        continue;
      }
      const slot = raw;
      for (const [k, v] of Object.entries(slot)) {
        if (k === "accepts") {
          if (!Array.isArray(v) || v.length === 0 || v.length > 32) {
            error(`${at}.accepts: 1…32 entries (cell:<ident>, a view type, container)`);
            continue;
          }
          for (const a of v) {
            if (typeof a === "string" && a.startsWith("cell:")) {
              if (!IDENT.test(a.slice(5)) || encoder.encode(a.slice(5)).length > 128)
                error(`${at}.accepts ${JSON.stringify(a)}: cell:<author_did>#<name>`);
            } else if (a !== "container" && !(typeof a === "string" && NAME.test(a)))
              error(`${at}.accepts ${JSON.stringify(a)}: cell:<ident>, a view type or container`);
          }
        } else if (k === "min") {
          if (!Number.isInteger(v) || v < 0 || v > 64)
            error(`${at}.min: an integer in [0, 64]`);
        } else if (k === "max") {
          if (!Number.isInteger(v) || v < 1 || v > 1e3)
            error(`${at}.max: an integer in [1, 1000]`);
        } else if (k === "placement") {
          if (v === "free")
            continue;
          if (v === "stack" || v === "top" || v === "bottom") {
            if (algorithm !== "stack")
              error(`${at}.placement: a fixed layout keeps every child where it is (free)`);
          } else
            error(`${at}.placement: stack, top, bottom or free`);
        } else if (k === "title") {
          if (typeof v !== "string" || v.length > 256)
            error(`${at}.title: at most 256 characters`);
        } else
          error(`${at}: unknown key ${k}`);
      }
      if (Number.isInteger(slot.min) && Number.isInteger(slot.max) && slot.min > slot.max)
        error(`${at}: min exceeds max`);
    }
  }
  const chrome = o.chrome;
  if (chrome !== void 0) {
    if (!chrome || typeof chrome !== "object" || Array.isArray(chrome))
      error("chrome must be an object");
    else
      for (const [k, v] of Object.entries(chrome)) {
        const at = `chrome.${k}`;
        if (k === "background" || k === "border") {
          if (typeof v === "string" && v.length <= 64)
            placeholders(v, at);
          else
            error(`${at}: a colour (≤ 64 characters) or {{config.<key>}}`);
        } else if (k === "radius")
          dimension(v, at, 200);
        else if (k === "empty") {
          if (typeof v === "string" && v.length <= 1e3)
            placeholders(v, at);
          else
            error(`${at}: a text of at most 1000 characters`);
        } else if (k === "title") {
          const t = v;
          if (!t || typeof t !== "object" || Array.isArray(t)) {
            error(`${at}: { text, slot? }`);
            continue;
          }
          for (const [tk, tv] of Object.entries(t)) {
            if (tk === "text") {
              if (typeof tv === "string" && tv.length <= 256)
                placeholders(tv, "chrome.title.text");
              else
                error("chrome.title.text: at most 256 characters");
            } else if (tk === "slot") {
              if (typeof tv !== "string" || !slots || !(tv in slots))
                error(`chrome.title.slot ${JSON.stringify(tv)}: a slot of this composition`);
            } else
              error(`chrome.title: unknown key ${tk}`);
          }
          if (typeof t.text !== "string")
            error("chrome.title.text required");
        } else
          error(`chrome: unknown key ${k} (background, radius, border, title, empty)`);
      }
  }
  return out;
}
function checkComponent(text, fileNames, readText) {
  const out = [];
  const f = AIWS_COMPONENT_FILE;
  const error = (message) => out.push({ file: f, severity: "error", message });
  let c;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      error("must be a JSON object");
      return out;
    }
    c = parsed;
  } catch (e) {
    error(e instanceof Error ? e.message : String(e));
    return out;
  }
  for (const k of Object.keys(c)) {
    if (k === "events")
      error(EVENTS_LATER);
    else if (!COMPONENT_KEYS.includes(k))
      error(`unknown key ${k}`);
  }
  const mv = c.manifest_version;
  const version = typeof mv === "number" && Number.isInteger(mv) && mv >= 1 ? mv : 0;
  if (!version)
    error(`manifest_version (1…${AIWS_MANIFEST_VERSION}) required`);
  else if (version > AIWS_MANIFEST_VERSION)
    error(`manifest_version ${mv} is newer than this client reads (${AIWS_MANIFEST_VERSION})`);
  const ident = c.ident;
  let self = "";
  if (!ident || typeof ident !== "object")
    error("ident { author_did, name } required");
  else {
    if (typeof ident.author_did !== "string" || !DID.test(ident.author_did))
      error("ident.author_did must be a DID (did:<method>:<id>)");
    if (typeof ident.name !== "string" || !NAME.test(ident.name))
      error("ident.name must be [a-z0-9][a-z0-9._-]{0,63}");
    if (typeof ident.author_did === "string" && typeof ident.name === "string") {
      self = `${ident.author_did}#${ident.name}`;
      if (encoder.encode(self).length > 128)
        error("an identity is at most 128 bytes");
    }
  }
  const composite = c.kind === "composite";
  if (c.kind !== "declarative" && c.kind !== "html" && !composite)
    error("kind must be declarative, html or composite");
  if (composite && version === 1)
    error(`kind composite ${V2_HINT}`);
  if (composite) {
    for (const k of ["accepts", "allow_no_source"])
      if (c[k] !== void 0)
        error(`${k}: a composite is a container of Blocks, not a Cell showing data`);
  }
  if (typeof c.title !== "string" || !c.title || c.title.length > 256)
    error("title: 1…256 characters");
  if (c.config_schema !== void 0) {
    const p = [];
    schemaProblems(c.config_schema, "config_schema", p);
    p.forEach(error);
  }
  if (c.bindings !== void 0) {
    if (!c.bindings || typeof c.bindings !== "object")
      error("bindings must be an object");
    else
      for (const n of Object.keys(c.bindings))
        if (!BINDING.test(n) || n === "props")
          error(`binding name ${n}: [a-z][a-z0-9_]{0,31}, not props`);
  }
  if (c.deps !== void 0) {
    if (!Array.isArray(c.deps) || c.deps.length > 32)
      error("deps: at most 32 identities <author_did>#<name>");
    else if (c.deps.length > 0 && version === 1)
      error(`deps ${V2_HINT}`);
    else {
      const seen = /* @__PURE__ */ new Set();
      for (const d of c.deps) {
        if (typeof d !== "string" || !IDENT.test(d))
          error(`deps: ${JSON.stringify(d)} is not an identity <author_did>#<name>`);
        else if (d === self)
          error("deps: a control cannot depend on itself");
        else if (seen.has(d))
          error(`deps lists ${d} twice`);
        seen.add(String(d));
      }
    }
  }
  const has = (n) => typeof n === "string" && fileNames.includes(n);
  const named = /* @__PURE__ */ new Set([f]);
  if (c.kind === "html") {
    const e = c.entry;
    if (!e || typeof e !== "object" || typeof e.html !== "string")
      error("entry must be { html, css?, js? }");
    else
      for (const [k, n] of Object.entries(e)) {
        if (!has(n))
          error(`entry.${k} ${JSON.stringify(n)} is not in the directory`);
        else
          named.add(String(n));
      }
    if (c.host_api !== void 0 && c.host_api !== AIWS_HTML_API_VERSION)
      error(`host_api: the HTML Block host speaks API ${AIWS_HTML_API_VERSION}`);
  } else if (c.kind === "declarative" || composite) {
    if (!has(c.entry))
      error(`entry ${JSON.stringify(c.entry)} is not in the directory`);
    else {
      named.add(String(c.entry));
      const entryText = composite ? readText == null ? void 0 : readText(String(c.entry)) : void 0;
      if (entryText !== void 0)
        out.push(...checkComposition(entryText, c.config_schema, String(c.entry)));
    }
    if (composite && c.host_api !== void 0)
      error("host_api: a composite runs no code of its own (its layout and chrome are the host's)");
  }
  for (const a of Array.isArray(c.assets) ? c.assets : []) {
    if (!has(a))
      error(`asset ${JSON.stringify(a)} is not in the directory`);
    else
      named.add(String(a));
  }
  if (c.agent !== void 0) {
    if (!has(c.agent))
      error(`agent ${JSON.stringify(c.agent)} is not in the directory`);
    else
      named.add(String(c.agent));
  }
  for (const n of fileNames) {
    if (!isSourcePath(n))
      out.push({ file: n, severity: "error", message: "a file of a source directory: a relative path whose parts do not start with '.'" });
    else if (!named.has(n))
      out.push({ file: n, severity: "warning", message: "not named by component.json: kept in the source snapshot only" });
  }
  return out;
}
function slotCells(composition) {
  const out = /* @__PURE__ */ new Set();
  for (const slot of Object.values(composition.slots ?? {}))
    for (const a of slot.accepts ?? [])
      if (a.startsWith("cell:"))
        out.add(a.slice(5));
  return [...out].sort();
}
function compatManifest(value) {
  if (!value || typeof value !== "object")
    throw new AiwsSourceError([{ file: AIWS_MANIFEST_FILE, severity: "error", message: "must be a JSON object" }]);
  const m = value;
  const version = m.manifest_version;
  if (typeof version !== "number" || version < 1)
    throw new AiwsSourceError([{ file: AIWS_MANIFEST_FILE, severity: "error", message: "manifest_version required" }]);
  if (version > AIWS_MANIFEST_VERSION)
    throw new AiwsSourceError([{ file: AIWS_MANIFEST_FILE, severity: "error", message: `manifest_version ${version} needs a newer client (this one reads ${AIWS_MANIFEST_VERSION})` }]);
  if (m.purpose !== "aiws")
    throw new AiwsSourceError([{ file: AIWS_MANIFEST_FILE, severity: "error", message: "purpose must be aiws" }]);
  if (!Array.isArray(m.controls))
    throw new AiwsSourceError([{ file: AIWS_MANIFEST_FILE, severity: "error", message: "controls must be an array" }]);
  return { manifest_version: version, purpose: "aiws", host_api: m.host_api ?? {}, controls: m.controls, workspace_templates: Array.isArray(m.workspace_templates) ? m.workspace_templates : [] };
}
async function verifyBundle(files) {
  var _a, _b;
  const raw = files.get(AIWS_MANIFEST_FILE);
  if (!raw)
    throw new AiwsSourceError([{ file: AIWS_MANIFEST_FILE, severity: "error", message: "missing" }]);
  let parsed;
  try {
    parsed = JSON.parse(decoder.decode(raw));
  } catch (e) {
    throw new AiwsSourceError([{ file: AIWS_MANIFEST_FILE, severity: "error", message: String(e) }]);
  }
  const manifest = compatManifest(parsed);
  const diagnostics = [];
  if (manifest.workspace_templates.length > 0)
    diagnostics.push({ file: AIWS_MANIFEST_FILE, severity: "error", message: "Workspace templates are not supported yet" });
  if (manifest.controls.length === 0)
    diagnostics.push({ file: AIWS_MANIFEST_FILE, severity: "error", message: "lists no control" });
  const dirs = /* @__PURE__ */ new Set();
  for (const c of manifest.controls) {
    if (typeof c.dir !== "string" || !/^controls\/[a-z0-9][a-z0-9._-]{0,70}\/$/.test(c.dir) || dirs.has(c.dir)) {
      diagnostics.push({ file: AIWS_MANIFEST_FILE, severity: "error", message: `control ${c.ident}: bad or repeated dir` });
      continue;
    }
    dirs.add(c.dir);
    const own = [...files].filter(([p]) => p.startsWith(c.dir)).map(([p, b]) => [p.slice(c.dir.length), b]);
    if (await aiwsContentDigest(own) !== c.digest)
      diagnostics.push({ file: c.dir, severity: "error", message: "the files do not match the manifest digest" });
    const component = own.find(([n]) => n === AIWS_COMPONENT_FILE);
    if (!component) {
      diagnostics.push({ file: `${c.dir}${AIWS_COMPONENT_FILE}`, severity: "error", message: "missing" });
      continue;
    }
    const text = (name) => {
      const hit = own.find(([n]) => n === name);
      return hit ? decoder.decode(hit[1]) : void 0;
    };
    for (const d of checkComponent(decoder.decode(component[1]), own.map(([n]) => n), text))
      diagnostics.push({ ...d, file: `${c.dir}${d.file}` });
    try {
      const comp = JSON.parse(decoder.decode(component[1]));
      if (`${(_a = comp.ident) == null ? void 0 : _a.author_did}#${(_b = comp.ident) == null ? void 0 : _b.name}` !== c.ident || comp.kind !== c.kind)
        diagnostics.push({ file: c.dir, severity: "error", message: "ident and kind must match its component.json" });
      if (JSON.stringify([...comp.deps ?? []].sort()) !== JSON.stringify([...c.deps ?? []].sort()))
        diagnostics.push({ file: c.dir, severity: "error", message: "deps must match its component.json" });
    } catch {
    }
  }
  const idents = new Set(manifest.controls.map((c) => c.ident));
  for (const c of manifest.controls)
    for (const d of c.deps ?? [])
      if (!idents.has(d))
        diagnostics.push({ file: AIWS_MANIFEST_FILE, severity: "error", message: `${c.ident} depends on ${d}, which the bundle does not carry` });
  for (const p of files.keys())
    if (p !== AIWS_MANIFEST_FILE && ![...dirs].some((d) => p.startsWith(d)))
      diagnostics.push({ file: p, severity: "error", message: "belongs to no control of the manifest" });
  return { manifest, diagnostics };
}
async function exportBundle(client, workspaceId, entityIds, fetchAsset) {
  const r = await client.extExport(workspaceId, entityIds, "package");
  const files = /* @__PURE__ */ new Map();
  files.set(AIWS_MANIFEST_FILE, encoder.encode(`${JSON.stringify(r.manifest, null, 2)}
`));
  for (const f of r.files)
    files.set(f.path, f.text !== void 0 ? encoder.encode(f.text) : await fetchAsset(workspaceId, String(f.obj_id)));
  return { manifest: compatManifest(r.manifest), files, controls: r.controls };
}
async function child(nfsp, folder, name) {
  const glob = /[*?[\]\\]/.test(name) ? void 0 : name;
  const page = await nfsp.list(typeof folder === "string" ? folder : { ref: folder }, { limit: glob ? 10 : 1e3, ...glob ? { filter: { name_glob: glob } } : {} }, ["base", "ident"]);
  return page.entries.find((e) => e.name === name);
}
async function ensureFolder(nfsp, path) {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0)
    throw new Error(`not a folder path: ${path}`);
  let ref = (await nfsp.stat(`/${parts[0]}`)).ref;
  for (const name of parts.slice(1)) {
    const hit = await child(nfsp, ref, name);
    if (hit && hit.target.kind !== "dir")
      throw new AiwsSourceError([{ file: name, severity: "error", message: `${name} in ${path} is not a folder` }]);
    ref = hit ? hit.target.ref : (await nfsp.mkdir({ ref }, name)).ref;
  }
  return ref;
}
async function findFolder(nfsp, path) {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0)
    return null;
  let ref = (await nfsp.stat(`/${parts[0]}`)).ref;
  for (const name of parts.slice(1)) {
    const hit = await child(nfsp, ref, name);
    if (!hit || hit.target.kind !== "dir")
      return null;
    ref = hit.target.ref;
  }
  return ref;
}
async function hasControlSource(nfsp, dir) {
  const ref = await findFolder(nfsp, dir);
  return ref !== null && await child(nfsp, ref, AIWS_COMPONENT_FILE) !== void 0;
}
async function writeHomeFile(nfsp, dir, name, bytes) {
  const ref = typeof dir === "string" ? await ensureFolder(nfsp, dir) : dir;
  await nfsp.uploadFile(ref, name, bytes, { overwrite: true });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function collectSources(nfsp, dir) {
  const out = [];
  const problems = [];
  const walk = async (folder, prefix, depth) => {
    var _a, _b, _c;
    let cursor;
    do {
      const page = await nfsp.list(typeof folder === "string" ? folder : { ref: folder }, { limit: 500, ...cursor ? { cursor } : {} }, ["base", "ident"]);
      for (const e of page.entries) {
        if (e.name.startsWith("."))
          continue;
        const name = `${prefix}${e.name}`;
        if (e.target.kind === "dir") {
          if (depth >= 8)
            problems.push({ file: name, severity: "error", message: "sub-folders nest at most 8 levels" });
          else
            await walk(e.target.ref, `${name}/`, depth + 1);
          continue;
        }
        if (e.target.kind !== "file") {
          problems.push({ file: name, severity: "error", message: "only files and folders belong to a control source" });
          continue;
        }
        const ref = e.target.ref;
        const objId = ref.type === "object" ? ref.obj_id : typeof ((_a = e.target.attrs) == null ? void 0 : _a.obj_id) === "string" ? e.target.attrs.obj_id : void 0;
        out.push({
          name,
          ...objId ? { obj_id: objId } : {},
          ...ref.type === "live" ? { node_id: ref.node_id } : {},
          ...typeof ((_b = e.target.attrs) == null ? void 0 : _b.etag) === "string" ? { etag: e.target.attrs.etag } : {},
          ...typeof ((_c = e.target.attrs) == null ? void 0 : _c.size) === "number" ? { size: e.target.attrs.size } : {}
        });
      }
      cursor = page.truncated ? page.next_cursor : void 0;
    } while (cursor);
  };
  await walk(dir, "", 0);
  if (out.length === 0)
    problems.push({ file: "", severity: "error", message: `${dir} holds no files` });
  if (out.length > AIWS_MAX_SOURCE_FILES)
    problems.push({ file: "", severity: "error", message: `a control holds at most ${AIWS_MAX_SOURCE_FILES} files` });
  if (problems.some((p) => p.severity === "error"))
    throw new AiwsSourceError(problems);
  return out.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}
async function writeSourceFile(nfsp, dir, name, bytes) {
  const cut = name.lastIndexOf("/");
  await writeHomeFile(nfsp, cut < 0 ? dir : joinPath(dir, name.slice(0, cut)), cut < 0 ? name : name.slice(cut + 1), bytes);
}
async function sourcesDigest(nfsp, files) {
  const pairs = [];
  for (const f of files) {
    if (!f.node_id)
      throw new AiwsSourceError([{ file: f.name, severity: "error", message: "the file service did not name this file" }]);
    pairs.push([f.name, new Uint8Array(await (await nfsp.readFile(f.node_id)).arrayBuffer())]);
  }
  return aiwsContentDigest(pairs);
}
async function unbuiltChanges(client, nfsp, workspaceId, defEntityId, dir) {
  var _a;
  if (!await hasControlSource(nfsp, dir))
    return null;
  const home = await sourcesDigest(nfsp, await collectSources(nfsp, dir));
  const r = await client.extExport(workspaceId, [defEntityId], "pull");
  const built = String(((_a = r.controls[0]) == null ? void 0 : _a.digest) ?? "");
  return { changed: home !== built, home, built };
}
async function readBuildState(nfsp, dir) {
  try {
    const entry = await child(nfsp, dir, AIWS_BUILD_STATE_FILE);
    const nodeId = (entry == null ? void 0 : entry.target.ref.type) === "live" ? entry.target.ref.node_id : void 0;
    if (!nodeId)
      return null;
    const response = await nfsp.readFile(nodeId);
    return await response.json();
  } catch {
    return null;
  }
}
async function writeBuildState(nfsp, dir, state) {
  await writeHomeFile(nfsp, dir, AIWS_BUILD_STATE_FILE, encoder.encode(`${JSON.stringify(state, null, 2)}
`));
}
async function buildControl(client, nfsp, workspaceId, dir, opts = {}) {
  const files = await collectSources(nfsp, dir);
  const state = await readBuildState(nfsp, dir);
  const base = state && state.workspace_id === workspaceId ? { def_rev: state.def_rev, dir_rev: state.dir_rev } : void 0;
  const result = await client.extBuild(workspaceId, {
    files: await buildFiles(nfsp, files, opts.upload),
    ...opts.folderId ? { folder_id: opts.folderId } : {},
    ...base ? { expect: base } : {},
    ...opts.force ? { force: true } : {},
    ...opts.dryRun ? { dry_run: true } : {}
  });
  if (!opts.dryRun && typeof result.def_entity_id === "string" && typeof result.def_rev === "number") {
    await writeBuildState(nfsp, dir, { workspace_id: workspaceId, def_entity_id: result.def_entity_id, def_rev: result.def_rev, dir_rev: Number(result.dir_rev ?? 0), ident: String(result.ident ?? ""), at: (/* @__PURE__ */ new Date()).toISOString() });
  }
  return { ...result, files };
}
async function pullControl(client, nfsp, workspaceId, defEntityId, outDir, fetchAsset) {
  const r = await client.extExport(workspaceId, [defEntityId], "pull");
  const control = r.controls[0];
  await ensureFolder(nfsp, outDir);
  for (const f of control.files)
    await writeSourceFile(nfsp, outDir, f.name, f.text !== void 0 ? encoder.encode(f.text) : await fetchAsset(workspaceId, String(f.obj_id)));
  const state = { workspace_id: workspaceId, def_entity_id: control.entity_id, def_rev: control.def_rev, dir_rev: control.dir_rev, ident: control.ident, at: (/* @__PURE__ */ new Date()).toISOString() };
  await writeBuildState(nfsp, outDir, state);
  return { files: control.files.map((f) => f.name), state };
}
async function watchControl(nfsp, dir, onChange, opts = {}) {
  var _a, _b;
  let last = "";
  let timer;
  let running = Promise.resolve();
  const check = () => {
    running = running.then(async () => {
      let files;
      try {
        files = await collectSources(nfsp, dir);
      } catch {
        return;
      }
      const key = sourcesKey(files);
      if (key === last)
        return;
      last = key;
      await onChange(files);
    }).catch(() => void 0);
  };
  check();
  while (!((_a = opts.signal) == null ? void 0 : _a.aborted)) {
    const listing = await nfsp.list(dir, { limit: 1 }, ["base"]);
    const stream = nfsp.watch({ tokens: listing.watch_token ? [listing.watch_token] : [], signal: opts.signal });
    try {
      for await (const _ of stream) {
        if (timer)
          clearTimeout(timer);
        timer = setTimeout(check, opts.debounceMs ?? 500);
      }
    } catch {
      if ((_b = opts.signal) == null ? void 0 : _b.aborted)
        break;
      await sleep(2e3);
    } finally {
      stream.close();
    }
  }
  if (timer)
    clearTimeout(timer);
  await running;
}
function controlSkeleton(opts) {
  const title = opts.title ?? opts.name;
  if (opts.kind === "composite") {
    const fixed = opts.algorithm === "fixed";
    const slots = opts.slots ?? { items: { placement: fixed ? "free" : "stack", title: "Items" } };
    const composition = {
      layout: fixed ? { algorithm: "fixed", padding: 12 } : { algorithm: "stack", direction: "column", spacing: "{{config.gap}}", padding: 12 },
      slots,
      chrome: { background: "{{config.background}}", radius: 12, title: { text: "{{config.title}}" }, empty: "Drop Blocks here" }
    };
    const component = {
      manifest_version: AIWS_MANIFEST_VERSION,
      ident: { author_did: opts.authorDid, name: opts.name },
      kind: "composite",
      title,
      description: `${title}: a panel of Blocks`,
      default_size: { w: 320, h: 360 },
      config_schema: { type: "object", properties: {
        title: { type: "string", title: "Title", default: title },
        background: { type: "string", title: "Background", default: "#f6f7fb" },
        gap: { type: "integer", title: "Gap (px)", default: 8, minimum: 0, maximum: 64 }
      } },
      entry: AIWS_COMPOSITION_FILE,
      deps: opts.deps ?? [],
      catalog: { group: "custom", description: `${title}` },
      agent: "AGENT.md"
    };
    const names = Object.keys(slots).map((n) => `\`${n}\``).join(", ");
    return {
      [AIWS_COMPONENT_FILE]: `${JSON.stringify(component, null, 2)}
`,
      [AIWS_COMPOSITION_FILE]: `${JSON.stringify(composition, null, 2)}
`,
      "AGENT.md": `# ${title}

A composite: an instance is a \`buckyos.container { kind: "composite", def_ref }\`; put Blocks under it with \`slot\` set to one of ${names}. Config: \`title\`, \`background\`, \`gap\`.
`
    };
  }
  const base = {
    manifest_version: AIWS_MANIFEST_VERSION,
    ident: { author_did: opts.authorDid, name: opts.name },
    kind: opts.kind ?? "declarative",
    title,
    description: `${title}: a control of this Workspace`,
    accepts: ["buckyos.table-source", "buckyos.record"],
    allow_no_source: true,
    default_size: { w: 260, h: 140 },
    config_schema: { type: "object", properties: { label: { type: "string", title: "Label", default: title } } },
    bindings: { data: { accepts: ["buckyos.table-source"], title: "Data", description: "The table this control summarizes" } },
    catalog: { group: "custom", description: `${title}` },
    agent: "AGENT.md"
  };
  const agent = `# ${title}

Bind \`data\` to a table. Config: \`label\` (text).
`;
  if (opts.kind === "html") {
    return {
      [AIWS_COMPONENT_FILE]: `${JSON.stringify({ ...base, host_api: AIWS_HTML_API_VERSION, entry: { html: "view.html", css: "style.css", js: "behavior.js" } }, null, 2)}
`,
      "view.html": '<div class="card"><div class="label" id="label"></div><div class="value" id="value">—</div></div>\n',
      "style.css": ".card{font:14px system-ui;padding:12px}.label{opacity:.7}.value{font-size:28px;font-weight:600}\n",
      "behavior.js": "document.getElementById('label').textContent = (aiws.context.config || {}).label || ''\nif (aiws.bindings.data) aiws.input('data').rows().then(function (rows) { document.getElementById('value').textContent = String(rows.length) })\n",
      "AGENT.md": agent
    };
  }
  return {
    [AIWS_COMPONENT_FILE]: `${JSON.stringify({ ...base, entry: "declarative.json" }, null, 2)}
`,
    "declarative.json": `${JSON.stringify({ layout: "stack", items: [{ kind: "metric", label: title, bind: "data.count", format: "number" }, { kind: "text", text: "Rows of the bound table" }] }, null, 2)}
`,
    "AGENT.md": agent
  };
}
async function createControlSource(nfsp, dir, files) {
  const ref = await ensureFolder(nfsp, dir);
  const existing = await nfsp.list({ ref }, { limit: 500 }, ["base"]).catch(() => null);
  if (existing == null ? void 0 : existing.entries.some((e) => e.name === AIWS_COMPONENT_FILE))
    throw new AiwsSourceError([{ file: AIWS_COMPONENT_FILE, severity: "error", message: `${dir} already holds a control` }]);
  for (const [name, text] of Object.entries(files))
    await writeHomeFile(nfsp, ref, name, encoder.encode(text));
  return ref;
}
export {
  AIWS_BUILD_STATE_FILE,
  AIWS_COMPONENT_FILE,
  AIWS_COMPOSITION_FILE,
  AIWS_DECLARATIVE_API_VERSION,
  AIWS_HTML_API_VERSION,
  AIWS_MANIFEST_FILE,
  AIWS_MANIFEST_VERSION,
  AIWS_MAX_INLINE_BYTES,
  AIWS_MAX_SOURCE_FILES,
  AiwsSourceError,
  aiwsContentDigest,
  buildControl,
  buildFiles,
  checkComponent,
  checkComposition,
  collectSources,
  compatManifest,
  controlSkeleton,
  createControlSource,
  ensureFolder,
  exportBundle,
  findFolder,
  folderName,
  hasControlSource,
  homeControlDir,
  homeExportDir,
  isSourcePath,
  joinPath,
  packBuildFiles,
  pullControl,
  readBuildState,
  slotCells,
  sourceStateKey,
  sourcesDigest,
  sourcesKey,
  unbuiltChanges,
  verifyBundle,
  watchControl,
  writeBuildState,
  writeHomeFile,
  writeSourceFile
};
//# sourceMappingURL=aiws_ext.mjs.map
