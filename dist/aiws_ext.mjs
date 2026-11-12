import { at as checkBindSteps } from "./aiws_bind-dfeda027.mjs";
import "./object_url-376c5222.mjs";
import "./ndn_types-0fac2499.mjs";
const AIWS_COMPONENT_FILE = "component.json";
const AIWS_COMPOSITION_FILE = "composition.json";
const AIWS_MANIFEST_FILE = "aiws-manifest.json";
const AIWS_BUILD_STATE_FILE = ".aiws-build.json";
const AIWS_MANIFEST_VERSION = 5;
const AIWS_HTML_API_VERSION = 4;
const AIWS_DECLARATIVE_API_VERSION = 1;
const AIWS_TEMPLATE_FORMAT = "aiws-template/1";
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
const COMPONENT_KEYS = ["manifest_version", "ident", "kind", "title", "description", "host_api", "accepts", "allow_no_source", "default_size", "config_schema", "bindings", "entry", "assets", "catalog", "agent", "deps", "events", "actions", "on_bind", "on_init_control"];
const SCHEMA_KEYWORDS = ["type", "enum", "default", "required", "title", "description", "minimum", "maximum", "minLength", "maxLength", "properties", "items"];
const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const DID = /^did:[a-z0-9]+:[^/#\s]+$/;
const BINDING = /^[a-z][a-z0-9_]{0,31}$/;
const IDENT = /^did:[a-z0-9]+:[^/#\s]+#[a-z0-9][a-z0-9._-]{0,63}$/;
const V2_HINT = "needs manifest_version 2 (raise it in component.json)";
const V3_HINT = "needs manifest_version 3 (raise it in component.json)";
const V4_HINT = "needs manifest_version 4 (raise it in component.json)";
const V5_HINT = "needs manifest_version 5 (raise it in component.json)";
const EVENT_PARAM_TYPES = ["string", "number", "boolean", "object", "entity"];
const ITEM_KINDS = ["text", "value", "metric", "bar", "list", "badge"];
const ITEM_KEYS = ["kind", "text", "label", "bind", "by", "format", "limit"];
const ACTION_COMMANDS = ["open_source", "activate_editor", "open_definition"];
const INSPECTOR_KINDS = ["text", "number", "select", "boolean", "color"];
function isRecord(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function isSourcePath(name) {
  return name.length > 0 && encoder.encode(name).length <= 255 && !name.includes("\0") && name.split("/").every((seg) => seg.length > 0 && !seg.startsWith("."));
}
function configProps(configSchema) {
  const props = isRecord(configSchema) ? configSchema.properties : void 0;
  return isRecord(props) ? props : {};
}
function configPlaceholders(text, at, props, error) {
  for (const m of text.matchAll(/\{\{([^}]*)\}\}/g)) {
    const inner = m[1].trim();
    if (!inner.startsWith("config."))
      error(`${at}: only {{config.<key>}} may be used here`);
    else if (!(inner.slice(7) in props))
      error(`${at}: {{${inner}}} names no property of config_schema`);
  }
}
function eventProblems(v, out) {
  if (!isRecord(v)) {
    out.push("events must be an object { <name>: { title?, description?, params? } }");
    return;
  }
  if (Object.keys(v).length > 16)
    out.push("events: at most 16");
  for (const [name, raw] of Object.entries(v)) {
    const at = `events.${name}`;
    if (!BINDING.test(name))
      out.push(`${at}: an event name is [a-z][a-z0-9_]{0,31}`);
    if (!isRecord(raw)) {
      out.push(`${at} must be an object { title?, description?, params? }`);
      continue;
    }
    for (const [k, x] of Object.entries(raw)) {
      if (k === "title") {
        if (typeof x !== "string" || x.length > 256)
          out.push(`${at}.title: at most 256 characters`);
      } else if (k === "description") {
        if (typeof x !== "string" || x.length > 4e3)
          out.push(`${at}.description: at most 4000 characters`);
      } else if (k !== "params")
        out.push(`${at}: unknown key ${k} (title, description, params)`);
    }
    if (raw.params === void 0)
      continue;
    if (!isRecord(raw.params)) {
      out.push(`${at}.params must be an object { <param>: { type, required?, description? } }`);
      continue;
    }
    if (Object.keys(raw.params).length > 16)
      out.push(`${at}.params: at most 16`);
    for (const [p, spec] of Object.entries(raw.params)) {
      const pat = `${at}.params.${p}`;
      if (!BINDING.test(p))
        out.push(`${pat}: a param name is [a-z][a-z0-9_]{0,31}`);
      if (!isRecord(spec)) {
        out.push(`${pat} must be an object { type, required?, description? }`);
        continue;
      }
      for (const [k, x] of Object.entries(spec)) {
        if (k === "type") {
          if (typeof x !== "string" || !EVENT_PARAM_TYPES.includes(x))
            out.push(`${pat}.type: ${EVENT_PARAM_TYPES.join(", ")}`);
        } else if (k === "required") {
          if (typeof x !== "boolean")
            out.push(`${pat}.required must be a boolean`);
        } else if (k === "description") {
          if (typeof x !== "string" || x.length > 1e3)
            out.push(`${pat}.description: at most 1000 characters`);
        } else
          out.push(`${pat}: unknown key ${k} (type, required, description)`);
      }
      if (spec.type === void 0)
        out.push(`${pat}.type required`);
    }
  }
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
function checkDeclarative(text, context = {}, file = "declarative.json") {
  const out = [];
  const error = (message, code) => out.push({ file, severity: "error", message, ...code ? { code } : {} });
  const warn = (message) => out.push({ file, severity: "warning", message });
  let o;
  try {
    const parsed = JSON.parse(text);
    if (!isRecord(parsed)) {
      error("a declarative definition is a JSON object");
      return out;
    }
    o = parsed;
  } catch (e) {
    error(e instanceof Error ? e.message : String(e));
    return out;
  }
  const bindings = isRecord(context.bindings) ? context.bindings : {};
  const props = configProps(context.configSchema);
  const strings = (v, at) => {
    if (typeof v === "string")
      configPlaceholders(v, at, props, error);
    else if (Array.isArray(v))
      v.forEach((x, i) => strings(x, `${at}[${i}]`));
    else if (isRecord(v))
      for (const [k, x] of Object.entries(v))
        strings(x, `${at}.${k}`);
  };
  const button = (it, at) => {
    if (context.manifestVersion !== void 0 && context.manifestVersion < 3)
      error(`${at}: a button ${V3_HINT}`);
    for (const k of Object.keys(it))
      if (!["kind", "label", "emit", "params"].includes(k))
        warn(`${at}: key ${k} is ignored by the interpreter`);
    if (typeof it.label !== "string" || !it.label)
      error(`${at}.label: the button's text (required)`);
    if (typeof it.emit !== "string" || !it.emit)
      error(`${at}.emit: the event the button raises (required)`);
    else if (context.events && !context.events.includes(it.emit))
      error(`${at}.emit ${it.emit}: not an event of component.json`, "EVENT_UNDECLARED");
    if (it.params !== void 0) {
      if (isRecord(it.params))
        strings(it.params, `${at}.params`);
      else
        error(`${at}.params must be an object`);
    }
  };
  const items = (list, at) => {
    if (list === void 0)
      return;
    if (!Array.isArray(list)) {
      error(`${at} must be an array`);
      return;
    }
    list.forEach((it, i) => {
      const iat = `${at}[${i}]`;
      if (!isRecord(it)) {
        error(`${iat} must be an object`);
        return;
      }
      if (it.kind === "button") {
        button(it, iat);
        return;
      }
      if (typeof it.kind !== "string" || !ITEM_KINDS.includes(it.kind))
        error(`${iat}.kind ${JSON.stringify(it.kind)}: one of ${[...ITEM_KINDS, "button"].join(", ")}`);
      for (const k of Object.keys(it))
        if (!ITEM_KEYS.includes(k))
          warn(`${iat}: key ${k} is ignored by the interpreter`);
      if (it.format !== void 0 && !["text", "number", "percent", "currency"].includes(it.format))
        error(`${iat}.format ${JSON.stringify(it.format)}: text, number, percent or currency`);
      if (typeof it.bind === "string" && it.bind.includes(".")) {
        const prefix = it.bind.slice(0, it.bind.indexOf("."));
        if (prefix !== "props" && !(prefix in bindings))
          warn(`${iat}.bind ${JSON.stringify(it.bind)}: ${prefix} is not a declared binding, so it reads the field ${JSON.stringify(it.bind)} of the main source`);
      }
    });
  };
  for (const [k, v] of Object.entries(o)) {
    if (k === "layout") {
      if (v !== "stack" && v !== "row")
        error("layout: stack or row");
    } else if (k === "items")
      items(v, "items");
    else if (k === "view")
      items(isRecord(v) ? v.items : void 0, "view.items");
    else if (k === "accent") {
      if (typeof v !== "string")
        error("accent must be a colour string");
    } else if (k === "actions") {
      (Array.isArray(v) ? v : []).forEach((a, i) => {
        const r = isRecord(a) ? a : {};
        if (typeof r.command !== "string" || !ACTION_COMMANDS.includes(r.command))
          error(`actions[${i}].command: one of ${ACTION_COMMANDS.join(", ")}`);
        if (typeof r.id !== "string" || typeof r.label !== "string")
          error(`actions[${i}] needs id and label`);
      });
    } else if (k === "inspector") {
      (Array.isArray(v) ? v : []).forEach((f, i) => {
        const r = isRecord(f) ? f : {};
        if (typeof r.kind !== "string" || !INSPECTOR_KINDS.includes(r.kind))
          error(`inspector[${i}].kind: one of ${INSPECTOR_KINDS.join(", ")}`);
        if (typeof r.key !== "string" || typeof r.label !== "string")
          error(`inspector[${i}] needs key and label`);
      });
    } else
      warn(`key ${k} is not part of the declarative vocabulary`);
  }
  if (o.items === void 0 && o.view === void 0)
    warn("no items: the control draws nothing");
  return out;
}
function checkComposition(text, configSchema, file = AIWS_COMPOSITION_FILE, context = {}) {
  const out = [];
  const error = (message, code) => out.push({ file, severity: "error", message, ...code ? { code } : {} });
  let o;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      error("a composition is a JSON object { layout, slots, chrome?, events? }");
      return out;
    }
    o = parsed;
  } catch (e) {
    error(e instanceof Error ? e.message : String(e));
    return out;
  }
  const props = configProps(configSchema);
  const placeholders = (t, at) => configPlaceholders(t, at, props, error);
  const dimension = (v, at, max) => {
    if (typeof v === "number" && v >= 0 && v <= max)
      return;
    if (typeof v === "string" && /^\s*\{\{.*\}\}\s*$/.test(v)) {
      placeholders(v, at);
      return;
    }
    error(`${at}: a number in [0, ${max}] or {{config.<key>}}`);
  };
  const before4 = context.manifestVersion !== void 0 && context.manifestVersion < 4;
  for (const k of Object.keys(o)) {
    if (!["layout", "slots", "chrome", "events", "projections", "media"].includes(k))
      error(`unknown key ${k} (a composition says layout, slots, chrome, events, projections and media)`);
    else if ((k === "projections" || k === "media") && before4)
      error(`${k} ${V4_HINT}`);
  }
  const layout = o.layout;
  let algorithm = "stack";
  if (!layout || typeof layout !== "object")
    error("layout { algorithm: stack | fixed | grid } required");
  else {
    if (layout.algorithm === "stack" || layout.algorithm === "fixed" || layout.algorithm === "grid")
      algorithm = layout.algorithm;
    else
      error(`layout.algorithm ${JSON.stringify(layout.algorithm)}: stack, fixed or grid (the algorithms the host ships)`);
    for (const [k, v] of Object.entries(layout)) {
      if (k === "algorithm")
        continue;
      if ((k === "direction" || k === "spacing") && algorithm !== "stack") {
        error(`layout.${k} belongs to the stack layout`);
        continue;
      }
      if ((k === "columns" || k === "gap") && algorithm !== "grid") {
        error(`layout.${k} belongs to the grid layout`);
        continue;
      }
      if (k === "direction") {
        if (v !== "column" && v !== "row")
          error("layout.direction: column or row");
      } else if (k === "spacing")
        dimension(v, "layout.spacing", 2e3);
      else if (k === "columns") {
        if (!Number.isInteger(v) || v < 1 || v > 12)
          error("layout.columns: an integer in [1, 12]");
      } else if (k === "gap")
        dimension(v, "layout.gap", 2e3);
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
    if (algorithm === "grid" && layout.columns === void 0)
      error("layout.columns (1…12) required: the cells of a grid row");
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
          if (v !== "stack" && v !== "top" && v !== "bottom" && v !== "free")
            error(`${at}.placement: stack, top, bottom or free`);
          else if (algorithm === "fixed" && v !== "free")
            error(`${at}.placement: a fixed layout keeps every child where it is (free)`);
          else if (algorithm === "grid" && v !== "stack")
            error(`${at}.placement: a grid fills its cells with the slots' children in slot order (stack)`);
        } else if (k === "title") {
          if (typeof v !== "string" || v.length > 256)
            error(`${at}.title: at most 256 characters`);
        } else if (k === "visible") {
          if (before4) {
            error(`${at}.visible ${V4_HINT}`);
            continue;
          }
          const vis = v;
          if (!isRecord(vis) || vis.from !== "first_open" || Object.keys(vis).some((x) => x !== "from" && x !== "for_ms"))
            error(`${at}.visible: { from: "first_open", for_ms }`);
          else if (typeof vis.for_ms === "string")
            placeholders(vis.for_ms, `${at}.visible.for_ms`);
          else if (!Number.isInteger(vis.for_ms) || vis.for_ms < 1 || vis.for_ms > 366 * 864e5)
            error(`${at}.visible.for_ms: milliseconds (≤ a year) or {{config.<key>}}`);
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
  if (o.events !== void 0) {
    if (context.manifestVersion !== void 0 && context.manifestVersion < 3)
      error(`events ${V3_HINT}`);
    if (!isRecord(o.events))
      error("events must be an object { <name>: { from: { slot, event }, title?, description? } }");
    else {
      if (Object.keys(o.events).length > 16)
        error("events: at most 16");
      for (const [name, raw] of Object.entries(o.events)) {
        const at = `events.${name}`;
        if (!BINDING.test(name))
          error(`${at}: an event name is [a-z][a-z0-9_]{0,31}`);
        if (!isRecord(raw)) {
          error(`${at} must be an object { from: { slot, event }, title?, description? }`);
          continue;
        }
        for (const [k, v] of Object.entries(raw)) {
          if (k === "title") {
            if (typeof v !== "string" || v.length > 256)
              error(`${at}.title: at most 256 characters`);
          } else if (k === "description") {
            if (typeof v !== "string" || v.length > 4e3)
              error(`${at}.description: at most 4000 characters`);
          } else if (k === "on") {
            const list = Array.isArray(v) ? v : [v];
            if (before4)
              error(`${at}.on ${V4_HINT}`);
            else if (list.length === 0 || list.length > 4 || list.some((h) => !isRecord(h) || !["write", "wish", "open", "notify"].includes(String(h.kind))))
              error(`${at}.on: a handler (write, wish, open, notify) or 1…4 of them`);
          } else if (k !== "from")
            error(`${at}: unknown key ${k} (from, title, description, on)`);
        }
        const from = raw.from;
        if (!isRecord(from)) {
          error(`${at}.from { slot, event } required: the child event it re-raises`);
          continue;
        }
        if (from.projection !== void 0) {
          if (before4) {
            error(`${at}.from.projection ${V4_HINT}`);
            continue;
          }
          const projections = isRecord(o.projections) ? o.projections : {};
          if (typeof from.projection !== "string" || !(from.projection in projections))
            error(`${at}.from.projection ${JSON.stringify(from.projection)}: a projection of this composition`);
          if (from.role !== void 0 && !(typeof from.role === "string" && BINDING.test(from.role)))
            error(`${at}.from.role: a role name of its template`);
          for (const k of Object.keys(from))
            if (k !== "projection" && k !== "role")
              error(`${at}.from: unknown key ${k} (projection, role)`);
          continue;
        }
        for (const k of Object.keys(from))
          if (k !== "slot" && k !== "event")
            error(`${at}.from: unknown key ${k} (slot, event)`);
        const event = typeof from.event === "string" && BINDING.test(from.event) ? from.event : void 0;
        if (!event)
          error(`${at}.from.event: an event name [a-z][a-z0-9_]{0,31}`);
        const slot = typeof from.slot === "string" && slots ? slots[from.slot] : void 0;
        if (!isRecord(slot)) {
          error(`${at}.from.slot ${JSON.stringify(from.slot)}: a slot of this composition`);
          continue;
        }
        if (!event)
          continue;
        const cells = (Array.isArray(slot.accepts) ? slot.accepts : []).filter((a) => typeof a === "string" && a.startsWith("cell:")).map((a) => a.slice(5));
        if (cells.length === 0) {
          error(`${at}: slot ${from.slot} accepts no cell:<ident>, so no control there declares ${event}`, "EVENT_UNDECLARED");
          continue;
        }
        const declared = cells.map((ident) => {
          var _a;
          return (_a = context.cellEvents) == null ? void 0 : _a.call(context, ident);
        });
        if (declared.every((names) => names !== void 0 && !names.includes(event)))
          error(`${at}: no control slot ${from.slot} accepts (${cells.join(", ")}) declares the event ${event}`, "EVENT_UNDECLARED");
      }
    }
  }
  if (o.projections !== void 0 && !before4) {
    if (!isRecord(o.projections) || Object.keys(o.projections).length > 8)
      error("projections: at most 8 of name → { source, template, layout }");
    else
      for (const [name, raw] of Object.entries(o.projections)) {
        const at = `projections.${name}`;
        if (!BINDING.test(name))
          error(`${at}: a projection name is [a-z][a-z0-9_]{0,31}`);
        if (!isRecord(raw)) {
          error(`${at} must be an object`);
          continue;
        }
        for (const k of Object.keys(raw))
          if (!["source", "mark", "template", "layout", "placement", "max_items"].includes(k))
            error(`${at}: unknown key ${k} (source, mark, template, layout, placement, max_items)`);
        const src = raw.source;
        const kind = isRecord(src) ? src.kind : void 0;
        if (!isRecord(src) || !["records", "members", "counts", "viewer"].includes(String(kind)) || kind !== "viewer" && typeof src.binding !== "string" || kind === "counts" && typeof src.field !== "string") {
          error(`${at}.source: { kind: records | members | counts | viewer, binding (a binding name), field? (counts) }`);
        }
        const nodes = isRecord(raw.template) && Array.isArray(raw.template.nodes) ? raw.template.nodes : null;
        if (!nodes || nodes.length === 0 || nodes.length > 32)
          error(`${at}.template: { nodes: [1…32 of { id, view: label | shape | asset, box?, config?, when?, role? }] }`);
        else
          nodes.forEach((n, i) => {
            if (!isRecord(n) || typeof n.id !== "string" || !BINDING.test(n.id))
              error(`${at}.template.nodes[${i}].id: a name [a-z][a-z0-9_]{0,31}`);
            else if (!["label", "shape", "asset"].includes(String(n.view)))
              error(`${at}.template.nodes[${i}].view: label, shape or asset`);
          });
        const lay = raw.layout;
        if (!isRecord(lay) || lay.algorithm !== "list" && lay.algorithm !== "grid" || !isRecord(lay.item) || lay.item.h === void 0)
          error(`${at}.layout: { algorithm: list | grid, columns? (grid), gap?, item: { w?, h } }`);
        else if (lay.algorithm === "grid" && lay.columns === void 0)
          error(`${at}.layout.columns required (grid)`);
        if (raw.placement !== void 0 && !["top", "stack", "bottom"].includes(String(raw.placement)))
          error(`${at}.placement: top, stack or bottom`);
      }
  }
  if (o.media !== void 0 && !before4) {
    const m = o.media;
    if (!isRecord(m) || typeof m.slot !== "string" || !slots || !(m.slot in slots) || typeof m.anchor !== "string" || Object.keys(props).length > 0 && !(m.anchor in props)) {
      error("media: { slot (a slot of this composition), anchor (a config property), loop? (a config property) }");
    }
  }
  return out;
}
function checkComponent(text, fileNames, readText, cellEvents) {
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
  for (const k of Object.keys(c))
    if (!COMPONENT_KEYS.includes(k))
      error(`unknown key ${k}`);
  const mv = c.manifest_version;
  const version = typeof mv === "number" && Number.isInteger(mv) && mv >= 1 ? mv : 0;
  if (c.actions !== void 0) {
    if (version > 0 && version < 4)
      error(`actions ${V4_HINT}`);
    else if (!Array.isArray(c.actions) || c.actions.length > 16)
      error("actions: at most 16 of { id, title, icon?, modes?, needs?, run }");
    else
      c.actions.forEach((a, i) => {
        if (!isRecord(a) || typeof a.id !== "string" || !BINDING.test(a.id) || typeof a.title !== "string" || !a.title)
          error(`actions[${i}]: { id, title, run } (id a name [a-z][a-z0-9_]{0,31})`);
        else {
          const run = Array.isArray(a.run) ? a.run : [a.run];
          if (run.length === 0 || run.length > 4 || run.some((h) => !isRecord(h) || !["write", "wish", "open", "notify", "config", "forward"].includes(String(h.kind))))
            error(`actions[${i}].run: a handler (write, wish, open, notify, config, forward) or 1…4 of them`);
        }
      });
  }
  if (!version)
    error(`manifest_version (1…${AIWS_MANIFEST_VERSION}) required`);
  else if (version > AIWS_MANIFEST_VERSION)
    error(`manifest_version ${mv} is newer than this client reads (${AIWS_MANIFEST_VERSION})`);
  const before3 = version > 0 && version < 3;
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
      for (const [n, d] of Object.entries(c.bindings)) {
        if (!BINDING.test(n) || n === "props")
          error(`binding name ${n}: [a-z][a-z0-9_]{0,31}, not props`);
        if (!isRecord(d)) {
          error(`binding ${n} must be an object`);
          continue;
        }
        for (const k of Object.keys(d))
          if (!["accepts", "required", "many", "schema_id", "title", "description"].includes(k))
            error(`binding ${n}: unknown key ${k}`);
        if (d.many !== void 0 && typeof d.many !== "boolean")
          error(`binding ${n}.many: true or false`);
        if (d.schema_id !== void 0 && (typeof d.schema_id !== "string" || !d.schema_id || d.schema_id.length > 128))
          error(`binding ${n}.schema_id: a schema id such as buckyos.todo@1`);
      }
  }
  if (c.on_bind !== void 0 || c.on_init_control !== void 0) {
    if (version > 0 && version < 5)
      error(`on_bind / on_init_control ${V5_HINT}`);
    else if (c.kind !== "composite")
      error("on_bind / on_init_control: declared steps are for a composite (an HTML control binds in behavior.js)");
    else {
      const actionIds = Array.isArray(c.actions) ? c.actions.filter(isRecord).map((a) => String(a.id)) : [];
      checkBindSteps(c.on_bind, c.on_init_control, isRecord(c.bindings) ? c.bindings : {}, actionIds).forEach(error);
    }
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
  let events = [];
  if (c.events !== void 0) {
    if (composite)
      error("events: a composite declares its events in composition.json (events.<name>.from re-raises an event of a child)");
    else if (before3)
      error(`events ${V3_HINT}`);
    else {
      const p = [];
      eventProblems(c.events, p);
      p.forEach(error);
    }
    if (!composite && isRecord(c.events))
      events = Object.keys(c.events);
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
    if (c.host_api !== void 0 && c.host_api !== 2 && c.host_api !== 3 && c.host_api !== 4)
      error("host_api: the HTML Block host speaks API 2, 3 and 4");
    else if (c.host_api === 4 && version < 4)
      error(`host_api 4 ${V4_HINT}`);
    else if (c.host_api === 3 && before3)
      error(`host_api 3 ${V3_HINT}`);
    if (events.length > 0 && !(typeof c.host_api === "number" && c.host_api >= 3))
      out.push({ file: f, severity: "warning", message: "events: an HTML control raises them with aiws.emit, which is host API 3 (set host_api to 3 or later)" });
  } else if (c.kind === "declarative" || composite) {
    if (!has(c.entry))
      error(`entry ${JSON.stringify(c.entry)} is not in the directory`);
    else {
      named.add(String(c.entry));
      const entryText = readText == null ? void 0 : readText(String(c.entry));
      const manifestVersion = version || void 0;
      if (entryText !== void 0 && composite)
        out.push(...checkComposition(entryText, c.config_schema, String(c.entry), { manifestVersion, cellEvents }));
      else if (entryText !== void 0)
        out.push(...checkDeclarative(entryText, { bindings: c.bindings, events, configSchema: c.config_schema, manifestVersion }, String(c.entry)));
    }
    if (composite && c.host_api !== void 0)
      error("host_api: a composite runs no code of its own (its layout and chrome are the host's)");
    if (!composite && c.host_api !== void 0 && c.host_api !== AIWS_DECLARATIVE_API_VERSION)
      error(`host_api: the declarative interpreter is version ${AIWS_DECLARATIVE_API_VERSION}`);
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
const TEMPLATE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
function templateDir(id) {
  return `templates/${id}/`;
}
async function aiwsTemplateDigest(files, id) {
  const dir = templateDir(id);
  const own = [];
  for (const [path, bytes] of files)
    if (path.startsWith(dir))
      own.push([path.slice(dir.length), bytes]);
  return aiwsContentDigest(own);
}
function templateProblems(t, controls) {
  if (!isRecord(t))
    return ["a template is an object { id, title, snapshot, digest, requires, description?, params?, reset? }"];
  const out = [];
  for (const k of Object.keys(t))
    if (!["id", "title", "description", "snapshot", "digest", "requires", "params", "reset"].includes(k))
      out.push(`unknown key ${k}`);
  if (typeof t.id !== "string" || !TEMPLATE_ID.test(t.id))
    out.push("id: [a-z0-9][a-z0-9-]{0,63}");
  else if (t.snapshot !== `${templateDir(t.id)}snapshot.json`)
    out.push(`snapshot must be ${templateDir(t.id)}snapshot.json`);
  if (typeof t.title !== "string" || !t.title || t.title.length > 256)
    out.push("title: 1…256 characters");
  if (t.description !== void 0 && (typeof t.description !== "string" || t.description.length > 4e3))
    out.push("description: at most 4000 characters");
  if (typeof t.digest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(t.digest))
    out.push("digest: sha256:<64 hex digits>");
  const requires = t.requires;
  if (!isRecord(requires))
    out.push("requires { host_api?, controls } required");
  else {
    for (const k of Object.keys(requires))
      if (k !== "host_api" && k !== "controls")
        out.push(`requires: unknown key ${k}`);
    if (requires.host_api !== void 0) {
      if (!isRecord(requires.host_api))
        out.push("requires.host_api must be an object { html?, declarative? }");
      else
        for (const [k, v] of Object.entries(requires.host_api))
          if (k !== "html" && k !== "declarative" || !Number.isInteger(v) || v < 1)
            out.push(`requires.host_api.${k}: html or declarative, a positive integer`);
    }
    if (!Array.isArray(requires.controls) || requires.controls.length > 256)
      out.push("requires.controls: at most 256 identities");
    else {
      const seen = /* @__PURE__ */ new Set();
      for (const ident of requires.controls) {
        if (typeof ident !== "string" || !controls.has(ident))
          out.push(`requires.controls: ${JSON.stringify(ident)} is not a control of this manifest`);
        else if (seen.has(ident))
          out.push(`requires.controls lists ${ident} twice`);
        seen.add(ident);
      }
    }
  }
  if (t.params !== void 0) {
    if (!isRecord(t.params) || Object.keys(t.params).length > 32)
      out.push("params: an object of at most 32 { type, title?, default? }");
    else
      for (const [name, p] of Object.entries(t.params)) {
        const at = `params.${name}`;
        if (!BINDING.test(name))
          out.push(`${at}: a param name is [a-z][a-z0-9_]{0,31}`);
        if (!isRecord(p)) {
          out.push(`${at} must be an object { type, title?, default? }`);
          continue;
        }
        for (const [k, v] of Object.entries(p)) {
          if (k === "type") {
            if (v !== "string" && v !== "number" && v !== "boolean")
              out.push(`${at}.type: string, number or boolean`);
          } else if (k === "title") {
            if (typeof v !== "string" || v.length > 256)
              out.push(`${at}.title: at most 256 characters`);
          } else if (k === "default") {
            if (!["string", "number", "boolean"].includes(typeof v))
              out.push(`${at}.default: a string, number or boolean`);
          } else
            out.push(`${at}: unknown key ${k} (type, title, default)`);
        }
        if (p.type === void 0)
          out.push(`${at}.type required`);
      }
  }
  if (t.reset !== void 0) {
    const tables = isRecord(t.reset) ? t.reset.tables : void 0;
    if (!isRecord(t.reset) || Object.keys(t.reset).some((k) => k !== "tables"))
      out.push("reset: { tables }");
    else if (tables !== void 0 && (!Array.isArray(tables) || tables.length > 64 || new Set(tables).size !== tables.length || tables.some((x) => typeof x !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(x))))
      out.push("reset.tables: at most 64 distinct table ids");
  }
  return out;
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
  const templates = manifest.workspace_templates;
  if (templates.length > 0 && manifest.manifest_version < 3)
    diagnostics.push({ file: AIWS_MANIFEST_FILE, severity: "error", message: `Workspace templates need manifest_version 3 (raise it in ${AIWS_MANIFEST_FILE})` });
  if (templates.length > 32)
    diagnostics.push({ file: AIWS_MANIFEST_FILE, severity: "error", message: "at most 32 Workspace templates" });
  if (manifest.controls.length === 0 && templates.length === 0)
    diagnostics.push({ file: AIWS_MANIFEST_FILE, severity: "error", message: "lists no control" });
  const declared = /* @__PURE__ */ new Map();
  for (const c of manifest.controls) {
    const component = typeof c.dir === "string" ? files.get(`${c.dir}${AIWS_COMPONENT_FILE}`) : void 0;
    try {
      const comp = component ? JSON.parse(decoder.decode(component)) : void 0;
      if (isRecord(comp))
        declared.set(c.ident, isRecord(comp.events) ? Object.keys(comp.events) : []);
    } catch {
    }
  }
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
    for (const d of checkComponent(decoder.decode(component[1]), own.map(([n]) => n), text, (ident) => declared.get(ident)))
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
  for (const [i, t] of templates.entries()) {
    const label = isRecord(t) && typeof t.id === "string" ? `template ${t.id}` : `workspace_templates[${i}]`;
    for (const p of templateProblems(t, idents))
      diagnostics.push({ file: AIWS_MANIFEST_FILE, severity: "error", message: `${label}: ${p}` });
    if (!isRecord(t) || typeof t.id !== "string" || !TEMPLATE_ID.test(t.id))
      continue;
    const dir = templateDir(t.id);
    if (dirs.has(dir)) {
      diagnostics.push({ file: AIWS_MANIFEST_FILE, severity: "error", message: `${label} is listed twice` });
      continue;
    }
    dirs.add(dir);
    const snapshot = files.get(`${dir}snapshot.json`);
    let format;
    try {
      format = snapshot ? JSON.parse(decoder.decode(snapshot)).format : void 0;
    } catch {
      format = void 0;
    }
    if (!snapshot)
      diagnostics.push({ file: `${dir}snapshot.json`, severity: "error", message: "missing" });
    else if (format !== AIWS_TEMPLATE_FORMAT)
      diagnostics.push({ file: `${dir}snapshot.json`, severity: "error", message: `not a template snapshot (format ${AIWS_TEMPLATE_FORMAT})` });
    if (await aiwsTemplateDigest(files, t.id) !== t.digest)
      diagnostics.push({ file: dir, severity: "error", message: "the files do not match the template digest" });
  }
  for (const p of files.keys())
    if (p !== AIWS_MANIFEST_FILE && ![...dirs].some((d) => p.startsWith(d)))
      diagnostics.push({ file: p, severity: "error", message: "belongs to no control or template of the manifest" });
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
    ...opts.dryRun ? { dry_run: true } : {},
    ...opts.migration ? { migration: opts.migration } : {}
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
    const events = { clicked: { title: "Clicked", description: "Raised when someone clicks the button (in run mode)", params: { count: { type: "number", description: "Rows of the bound table" } } } };
    return {
      [AIWS_COMPONENT_FILE]: `${JSON.stringify({ ...base, host_api: AIWS_HTML_API_VERSION, events, entry: { html: "view.html", css: "style.css", js: "behavior.js" } }, null, 2)}
`,
      "view.html": '<div class="card"><div class="label" id="label"></div><div class="value" id="value">—</div><button id="go" type="button">Go</button></div>\n',
      "style.css": ".card{font:14px system-ui;padding:12px}.label{opacity:.7}.value{font-size:28px;font-weight:600}\n",
      "behavior.js": [
        "document.getElementById('label').textContent = (aiws.context.config || {}).label || ''",
        "var count = 0",
        "if (aiws.bindings.data) aiws.input('data').rows().then(function (rows) { count = rows.length; document.getElementById('value').textContent = String(count) })",
        "// the public event of component.json: an instance binds handlers to it in its `on` (host API 3)",
        "document.getElementById('go').addEventListener('click', function () { aiws.emit('clicked', { count: count }) })",
        ""
      ].join("\n"),
      "AGENT.md": `${agent}Event: \`clicked\` (\`count\`), raised by its button; bind handlers to it in the instance's \`on\`.
`
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
  AIWS_TEMPLATE_FORMAT,
  AiwsSourceError,
  aiwsContentDigest,
  aiwsTemplateDigest,
  buildControl,
  buildFiles,
  checkComponent,
  checkComposition,
  checkDeclarative,
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
  templateDir,
  unbuiltChanges,
  verifyBundle,
  watchControl,
  writeBuildState,
  writeHomeFile,
  writeSourceFile
};
//# sourceMappingURL=aiws_ext.mjs.map
