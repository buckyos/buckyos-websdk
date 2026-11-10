import { X as XllmError, i as isObject } from "./aicc-67851c41.mjs";
import { A, L, h, j, a, d, c, e, b, l, p, k, r, f, g, s } from "./aicc-67851c41.mjs";
import { s as shellSettings, t as taskWaitMs, S as SiteToolManager, u as unresolvedReason, d as describeToolSource, a as utf8Length, v as validateJson, g as generateRunId, R as RUN_RECORD_VERSION } from "./site_manager-11a7a468.mjs";
import { a8, B, D, h as h2, i, j as j2, k as k2, l as l2, ao, ap, V, W, L as L2, e as e2, ae, a4, M, m, a5, aq, G, Y, K, z, b as b2, af, x, aA, T, X, Z, _, $, ac, f as f2, ar, a9, y, A as A2, C, E, F, a0, ag, ah, ai, aj, o, a6, H, J, au, av, I, aw, a1, a7, ak, a2, P, q, n, aa, w, p as p2, al, as, Q, at, N, r as r2, ax, U, a3, O, c as c2, am, an, ay, ab, ad, az } from "./site_manager-11a7a468.mjs";
import { D as D2, a as a10 } from "./did_object_client-7fa36f90.mjs";
import "./krpc_client-673448e5.mjs";
import "./object_url-f72c1704.mjs";
import "./ndn_types-0fac2499.mjs";
const SITE_RUNTIME_KIND = "site";
const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;
function resolveTool(name, tool, source) {
  return { name, description: tool.spec.description, args_schema: tool.spec.args_schema, source };
}
function namedSources(cfg, field) {
  return (cfg ?? []).map((s2) => {
    if (s2.kind !== "named") {
      throw XllmError.capability(`${field}: \`${describeToolSource(s2)}\` is not available in a site runtime; only the page's tools can be named`);
    }
    return s2.name;
  });
}
function createSiteRuntime(options) {
  var _a;
  const scene = (_a = options.scene) == null ? void 0 : _a.trim();
  if (!scene)
    throw XllmError.input("createSiteRuntime: `scene` is required");
  if (!options.origin)
    throw XllmError.input("createSiteRuntime: `origin` is required");
  const tools = /* @__PURE__ */ new Map();
  for (const [name, tool] of Object.entries(options.tools ?? {})) {
    if (!TOOL_NAME.test(name))
      throw XllmError.tools(`site tool name \`${name}\` must match ${TOOL_NAME}`);
    if (!tool || typeof tool.call !== "function" || !tool.spec)
      throw XllmError.tools(`site tool \`${name}\` needs \`spec\` and \`call\``);
    tools.set(name, tool);
  }
  const env = { ...options.env ?? {} };
  const descriptor = {
    runtime_id: `site:${scene}`,
    kind: SITE_RUNTIME_KIND,
    host: null,
    target: { origin: options.origin, scene },
    workdir: "/",
    capabilities: { tools: {}, network: true, os: "browser" }
  };
  const config = { kind: SITE_RUNTIME_KIND, env: {} };
  if (options.task_wait_ms !== void 0)
    config.task_wait_ms = options.task_wait_ms;
  const runtime = {
    scene,
    tools,
    descriptor: () => JSON.parse(JSON.stringify(descriptor)),
    config: () => JSON.parse(JSON.stringify(config)),
    async info() {
      let timezone = "";
      try {
        timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
      } catch {
        timezone = "";
      }
      return {
        id: descriptor.runtime_id,
        kind: SITE_RUNTIME_KIND,
        os: "browser",
        arch: "",
        hostname: options.hostname,
        shell: "",
        cwd: "/",
        tools: [],
        current_time: (/* @__PURE__ */ new Date()).toISOString(),
        timezone,
        target: descriptor.target,
        platform: "browser",
        shell_kind: "",
        baseline: ""
      };
    },
    async open(ctx, cfg) {
      const enabled = cfg.enabled ?? false;
      const tools2actions = cfg.tools2actions ?? false;
      if (ctx.loop_model === "function_call" && (tools2actions || (cfg.actions ?? []).length > 0)) {
        throw XllmError.capability("actions / tools2actions need loop_model behavior");
      }
      const pick = (names, field) => names.map((name) => {
        const tool = tools.get(name);
        if (!tool) {
          throw XllmError.capability(`${field}: \`${name}\` is not a tool of scene \`${scene}\` (scene tools: ${[...tools.keys()].join(", ") || "none"})`);
        }
        return resolveTool(name, tool, `name:${name}`);
      });
      let native = [];
      let actions = [];
      const toolSources = cfg.tools ?? [];
      const actionSources = cfg.actions ?? [];
      if (enabled) {
        const toolNames = cfg.tools === void 0 ? [...tools.keys()] : namedSources(cfg.tools, "tools.tools");
        native = pick(toolNames, "tools.tools");
        actions = pick(namedSources(cfg.actions, "tools.actions"), "tools.actions");
        if (tools2actions) {
          actions = [...actions, ...native.filter((t) => !actions.some((a11) => a11.name === t.name))];
          native = [];
        }
      }
      const selected = /* @__PURE__ */ new Map();
      for (const t of [...native, ...actions])
        selected.set(t.name, tools.get(t.name));
      const effective = {
        enabled,
        filesystem_policy: cfg.filesystem_policy ?? "workspace",
        tools2actions,
        tool_sources: cfg.tools === void 0 && enabled ? native.map((t) => ({ kind: "named", name: t.name })) : toolSources,
        action_sources: actionSources,
        native,
        actions,
        bash_tools: [],
        shell: shellSettings(cfg.shell, taskWaitMs(config)),
        exec_enabled: false,
        sources: { ...ctx.sources }
      };
      return { tools: effective, manager: new SiteToolManager(selected, { tasks: ctx.tasks, taskWaitMs: ctx.task_wait_ms }) };
    },
    async describeInterrupted(run, call) {
      const tool = tools.get(call.name);
      if (tool == null ? void 0 : tool.describeInterrupted) {
        try {
          return await tool.describeInterrupted(call.args ?? {}, { run_id: run.run_id, call_id: call.call_id, signal: new AbortController().signal });
        } catch (e3) {
          return `${unresolvedReason(call.name)} (describing it failed: ${e3 instanceof Error ? e3.message : String(e3)})`;
        }
      }
      return unresolvedReason(call.name);
    },
    env: (name) => env[name]
  };
  return runtime;
}
class CommandArgsError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CommandArgsError";
    this.code = code;
  }
}
function hasOwn(o2, key) {
  return Object.prototype.hasOwnProperty.call(o2, key);
}
function optionProperty(option) {
  return option.property ?? option.name.split("-").join("_");
}
function splitLongOption(token) {
  const content = token.slice(2);
  const equalIndex = content.indexOf("=");
  return equalIndex < 0 ? { name: content } : { name: content.slice(0, equalIndex), inlineValue: content.slice(equalIndex + 1) };
}
function readOptionValue(argv, index, option) {
  if (option.inlineValue !== void 0) {
    if (!option.inlineValue)
      throw new CommandArgsError("MISSING_ARGUMENT", `--${option.name} requires a value`);
    return { value: option.inlineValue, consumed: 1 };
  }
  const value = argv[index + 1];
  if (value === void 0 || value.startsWith("--"))
    throw new CommandArgsError("MISSING_ARGUMENT", `--${option.name} requires a value`);
  return { value, consumed: 2 };
}
function parseOptionValue(type, value, name) {
  if (type === "string")
    return value;
  const number = Number(value);
  if (!Number.isFinite(number) || type === "integer" && !Number.isInteger(number)) {
    throw new CommandArgsError("INVALID_ARGUMENT", `--${name} requires a ${type}`);
  }
  return number;
}
function assignPositional(input, positionals, index, value) {
  const positional = positionals[index];
  if (!positional)
    throw new CommandArgsError("TOO_MANY_ARGUMENTS", `unexpected positional argument: ${value}`);
  input[positional.name] = value;
  return index + 1;
}
function parseArgv(spec, argv, beforeOption) {
  const input = {};
  const positionals = spec.positionals ?? [];
  const optionByName = new Map((spec.options ?? []).map((o2) => [o2.name, o2]));
  let positionalIndex = 0;
  let help = false;
  for (let index = 0; index < argv.length; ) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      help = true;
      index += 1;
      continue;
    }
    if (token === "--") {
      for (const value2 of argv.slice(index + 1))
        positionalIndex = assignPositional(input, positionals, positionalIndex, value2);
      break;
    }
    if (!token.startsWith("--")) {
      positionalIndex = assignPositional(input, positionals, positionalIndex, token);
      index += 1;
      continue;
    }
    const parsed = splitLongOption(token);
    const handled = beforeOption == null ? void 0 : beforeOption(parsed, argv, index);
    if (handled !== void 0) {
      index += handled;
      continue;
    }
    const option = optionByName.get(parsed.name);
    if (!option)
      throw new CommandArgsError("UNKNOWN_OPTION", `unknown option: --${parsed.name}`);
    const property = optionProperty(option);
    if (hasOwn(input, property))
      throw new CommandArgsError("DUPLICATE_ARGUMENT", `argument provided more than once: ${property}`);
    if (option.type === "boolean") {
      if (parsed.inlineValue !== void 0)
        throw new CommandArgsError("INVALID_ARGUMENT", `--${parsed.name} does not accept a value`);
      input[property] = true;
      index += 1;
      continue;
    }
    const { value, consumed } = readOptionValue(argv, index, parsed);
    input[property] = parseOptionValue(option.type, value, parsed.name);
    index += consumed;
  }
  return { input, help, positionalCount: positionalIndex };
}
function parseShellLine(line) {
  const tokens = [];
  let current = "";
  let quote = null;
  let escaped = false;
  let started = false;
  for (const character of line) {
    if (escaped) {
      current += character;
      escaped = false;
      started = true;
      continue;
    }
    if (character === "\\" && quote !== "single") {
      escaped = true;
      started = true;
      continue;
    }
    if (quote === "single") {
      if (character === "'")
        quote = null;
      else
        current += character;
      continue;
    }
    if (quote === "double") {
      if (character === '"')
        quote = null;
      else
        current += character;
      continue;
    }
    if (character === "'") {
      quote = "single";
      started = true;
      continue;
    }
    if (character === '"') {
      quote = "double";
      started = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (started) {
        tokens.push(current);
        current = "";
        started = false;
      }
      continue;
    }
    current += character;
    started = true;
  }
  if (escaped)
    throw new CommandArgsError("INVALID_COMMAND_LINE", "unfinished escape sequence");
  if (quote)
    throw new CommandArgsError("INVALID_COMMAND_LINE", `unterminated ${quote} quote`);
  if (started)
    tokens.push(current);
  return tokens;
}
function validateSchema(value, schema, path) {
  var _a;
  if (schema.enum && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    throw new CommandArgsError("SCHEMA_VALIDATION_FAILED", `${path} must be one of ${schema.enum.join(", ")}`);
  }
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new CommandArgsError("SCHEMA_VALIDATION_FAILED", `${path} must be an object`);
    const object = value;
    for (const required of schema.required ?? []) {
      if (!hasOwn(object, required))
        throw new CommandArgsError("SCHEMA_VALIDATION_FAILED", `${path}.${required} is required`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(object)) {
        if (!hasOwn(schema.properties ?? {}, key))
          throw new CommandArgsError("SCHEMA_VALIDATION_FAILED", `${path}.${key} is not allowed`);
      }
    }
    for (const [key, propertyValue] of Object.entries(object)) {
      const propertySchema = (_a = schema.properties) == null ? void 0 : _a[key];
      if (propertySchema)
        validateSchema(propertyValue, propertySchema, `${path}.${key}`);
    }
    return;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value))
      throw new CommandArgsError("SCHEMA_VALIDATION_FAILED", `${path} must be an array`);
    const items = schema.items;
    if (items)
      value.forEach((item, index) => validateSchema(item, items, `${path}[${index}]`));
    return;
  }
  if (schema.type === "string") {
    if (typeof value !== "string")
      throw new CommandArgsError("SCHEMA_VALIDATION_FAILED", `${path} must be a string`);
    if (schema.minLength !== void 0 && value.length < schema.minLength)
      throw new CommandArgsError("SCHEMA_VALIDATION_FAILED", `${path} is too short`);
    return;
  }
  if (schema.type === "boolean" && typeof value !== "boolean")
    throw new CommandArgsError("SCHEMA_VALIDATION_FAILED", `${path} must be a boolean`);
  if (schema.type === "integer" && (!Number.isInteger(value) || typeof value !== "number")) {
    throw new CommandArgsError("SCHEMA_VALIDATION_FAILED", `${path} must be an integer`);
  }
  if (schema.type === "number" && typeof value !== "number")
    throw new CommandArgsError("SCHEMA_VALIDATION_FAILED", `${path} must be a number`);
}
const ACTION_RISKS = ["read_only", "idempotent_write", "write", "destructive", "admin"];
const XCALL_USAGE = "xcall <object> <action> [--params <json>] [key=value ...] [--key=value ...]";
const MAX_RESULT_BYTES = 64 * 1024;
const LOCAL_BASE = "site://page/";
const SHELL_CHARS = /[|;&><`$]/;
function parsePattern(raw, decl) {
  const i2 = raw.indexOf("://");
  if (i2 >= 0) {
    const rest = raw.slice(i2 + 3);
    const slash = rest.indexOf("/");
    const host = slash < 0 ? rest : rest.slice(0, slash);
    const path2 = slash < 0 ? "" : rest.slice(slash + 1);
    return { raw, origin: `${raw.slice(0, i2).toLowerCase()}://${host.toLowerCase()}`, segments: path2 ? path2.split("/") : [], decl };
  }
  const path = raw.replace(/^\/+/, "").replace(/\/+$/, "");
  return { raw, segments: path ? path.split("/") : [], decl };
}
function fail(message) {
  throw new Error(message);
}
function normalizeUri(uri, origins) {
  const raw = uri.trim();
  if (!raw)
    fail("uri is empty");
  const absolute = /^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw);
  let url;
  try {
    url = absolute ? new URL(raw) : new URL(raw.replace(/^\/+/, ""), LOCAL_BASE);
  } catch {
    fail(`invalid uri \`${raw}\``);
  }
  let origin;
  if (absolute) {
    origin = `${url.protocol.slice(0, -1).toLowerCase()}://${url.host.toLowerCase()}`;
    if (!origins.has(origin))
      fail(`uri \`${raw}\` is not a resource of this page (absolute URIs are limited to the declared ones)`);
  } else if (url.protocol !== "site:" || url.host !== "page") {
    fail(`uri \`${raw}\` is not a resource of this page`);
  }
  const segments = [];
  for (const part of url.pathname.split("/")) {
    if (part === "")
      continue;
    let decoded;
    try {
      decoded = decodeURIComponent(part);
    } catch {
      fail(`invalid uri \`${raw}\``);
    }
    if (decoded === ".." || decoded === "." || decoded.includes("/") || decoded.includes("\\"))
      fail(`uri \`${raw}\` is not a resource of this page`);
    segments.push(decoded);
  }
  const text2 = (origin ? `${origin}/` : "") + segments.join("/") + (url.search || "");
  return { origin, segments, query: url.searchParams, text: text2 };
}
function matchPattern(p3, origin, segments) {
  if (p3.origin !== origin || p3.segments.length !== segments.length)
    return void 0;
  const params = {};
  for (let i2 = 0; i2 < segments.length; i2++) {
    const s2 = p3.segments[i2];
    if (s2.startsWith("{") && s2.endsWith("}"))
      params[s2.slice(1, -1)] = segments[i2];
    else if (s2 !== segments[i2])
      return void 0;
  }
  return params;
}
function asText(value) {
  if (value === void 0 || value === null)
    return "";
  if (typeof value === "string")
    return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
function versioned(value) {
  if (isObject(value) && "content" in value && Object.keys(value).every((k3) => k3 === "content" || k3 === "version")) {
    const version = value.version;
    return { text: asText(value.content), version: typeof version === "string" ? version : version === void 0 ? void 0 : String(version) };
  }
  return { text: asText(value) };
}
function clipBytes(text2, max) {
  if (utf8Length(text2) <= max)
    return { text: text2, clipped: false };
  let out = "";
  let bytes = 0;
  for (const ch of text2) {
    const n2 = utf8Length(ch);
    if (bytes + n2 > max)
      break;
    out += ch;
    bytes += n2;
  }
  return { text: out, clipped: true };
}
function pageText(text2, offset = 1, limit) {
  const lines = text2.split("\n");
  const start = Math.max(1, Math.floor(offset));
  if (start > lines.length && !(start === 1 && lines.length === 1))
    return `[offset ${start} is past the end: ${lines.length} lines]`;
  const wanted = limit === void 0 ? lines.length : Math.max(1, Math.floor(limit));
  const out = [];
  let bytes = 0;
  let i2 = start - 1;
  for (; i2 < lines.length && out.length < wanted; i2++) {
    const n2 = utf8Length(lines[i2]) + 1;
    if (out.length > 0 && bytes + n2 > MAX_RESULT_BYTES)
      break;
    out.push(lines[i2]);
    bytes += n2;
  }
  let body = out.join("\n");
  if (out.length === 1 && utf8Length(body) > MAX_RESULT_BYTES)
    body = clipBytes(body, MAX_RESULT_BYTES).text + " …";
  if (i2 < lines.length)
    body += `
[lines ${start}–${i2} of ${lines.length}; read on with offset=${i2 + 1}]`;
  return body;
}
function parseScalar(raw) {
  const v = raw.trim();
  if (v === "true")
    return true;
  if (v === "false")
    return false;
  if (v === "null")
    return null;
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(v))
    return Number(v);
  if (v.startsWith("{") || v.startsWith("[")) {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
}
const UNSUPPORTED_XCALL_KEYS = [
  "config",
  "route-config",
  "session-id",
  "session_id",
  "idempotency-key",
  "idempotency_key",
  "confirm-token",
  "confirm_token",
  "trace-id",
  "trace_id"
];
function parseXcall(tokens) {
  let object;
  let action;
  let params = {};
  const pairs = {};
  const positionals = [];
  const json = (raw, name) => {
    try {
      return JSON.parse(raw);
    } catch (e3) {
      fail(`invalid \`${name}\` JSON value \`${raw}\`: ${e3 instanceof Error ? e3.message : String(e3)}
usage: ${XCALL_USAGE}`);
    }
  };
  const unsupported = (t) => fail(`unsupported flag \`${t}\` (routing and confirmation are the page's)
usage: ${XCALL_USAGE}`);
  for (let i2 = 0; i2 < tokens.length; i2++) {
    const t = tokens[i2];
    if (t === "--params") {
      const v = tokens[++i2];
      if (v === void 0)
        fail(`missing value for --params
usage: ${XCALL_USAGE}`);
      params = json(v, "--params");
    } else if (t.startsWith("--")) {
      const eq = t.indexOf("=");
      if (eq < 0)
        unsupported(t);
      const key = t.slice(2, eq);
      const value = t.slice(eq + 1);
      if (key === "params")
        params = json(value, "--params");
      else if (!key.trim() || key.startsWith("-") || UNSUPPORTED_XCALL_KEYS.includes(key))
        unsupported(t);
      else
        pairs[key] = parseScalar(value);
    } else if (t.includes("=")) {
      const eq = t.indexOf("=");
      const key = t.slice(0, eq);
      const value = t.slice(eq + 1);
      if (key === "object")
        object = value;
      else if (key === "action")
        action = value;
      else if (key === "params")
        params = json(value, "params");
      else if (UNSUPPORTED_XCALL_KEYS.includes(key))
        unsupported(t);
      else
        pairs[key] = parseScalar(value);
    } else {
      positionals.push(t);
    }
  }
  object = object ?? positionals[0];
  action = action ?? positionals[1];
  if (positionals[2] !== void 0)
    params = json(positionals[2], "params");
  if (positionals.length > 3)
    fail(`unexpected positional argument \`${positionals[3]}\`
usage: ${XCALL_USAGE}`);
  if (Object.keys(pairs).length) {
    if (!isObject(params))
      fail(`key=value params require object params
usage: ${XCALL_USAGE}`);
    params = { ...params, ...pairs };
  }
  if (!object || !action)
    fail(`xcall needs an object and an action
usage: ${XCALL_USAGE}`);
  if (!isObject(params))
    fail(`params must be a JSON object
usage: ${XCALL_USAGE}`);
  return { object, action, params };
}
function commandUsage(name, c3) {
  var _a;
  const lines = [`${name} — ${c3.summary}`];
  if (c3.description)
    lines.push("", c3.description);
  const pos = (c3.positionals ?? []).map((p3) => p3.required === false ? `[${p3.name}]` : `<${p3.name}>`).join(" ");
  lines.push("", `usage: ${name}${pos ? ` ${pos}` : ""}${(c3.options ?? []).length ? " [options]" : ""}`);
  for (const p3 of c3.positionals ?? [])
    lines.push(`  ${p3.name}  ${p3.description}`);
  if ((c3.options ?? []).length)
    lines.push("options:");
  for (const o2 of c3.options ?? []) {
    lines.push(`  --${o2.name}${o2.type === "boolean" ? "" : ` <${o2.type}>`}${o2.required ? " (required)" : ""}  ${o2.description}${o2.enum ? ` (${o2.enum.join(" | ")})` : ""}`);
  }
  if ((_a = c3.examples) == null ? void 0 : _a.length) {
    lines.push("examples:");
    for (const e3 of c3.examples)
      lines.push(`  ${e3}`);
  }
  return lines.join("\n");
}
const OBJECT_ARGS = (props, required) => ({ type: "object", properties: props, required });
function siteTools(options) {
  const patterns = Object.entries(options.resources ?? {}).map(([raw, decl]) => parsePattern(raw, decl));
  const origins = new Set(patterns.map((p3) => p3.origin).filter((o2) => o2 !== void 0));
  const commands = new Map(Object.entries(options.commands ?? {}));
  if (commands.has("xcall"))
    throw new Error("siteTools: `xcall` is built in; declare actions on resources instead");
  const resolve = (uri, ctx) => {
    const n2 = normalizeUri(uri, origins);
    for (const p3 of patterns) {
      const params = matchPattern(p3, n2.origin, n2.segments);
      if (params)
        return { uri: n2.text, pattern: p3.raw, params, query: n2.query, ctx, decl: p3.decl };
    }
    fail(`uri \`${uri}\` is not a resource of this page; read uri="/" lists them`);
  };
  const discovery = () => {
    const lines = ['Resources (read uri="<resource>"; {name} is one path segment):'];
    for (const p3 of patterns) {
      const methods = ["read", "write", "edit"].filter((m2) => m2 === "edit" ? !!(p3.decl.edit || p3.decl.read && p3.decl.write) : !!p3.decl[m2]);
      lines.push(`- ${p3.raw} — ${p3.decl.description} [${methods.join(", ") || "no methods"}]`);
      for (const [name, a11] of Object.entries(p3.decl.actions ?? {}))
        lines.push(`  action ${name} (risk: ${a11.risk}) — ${a11.description}`);
    }
    if (patterns.length === 0)
      lines.push("(none)");
    lines.push("", 'Commands (exec "<command> --help" for usage):');
    lines.push(`- xcall — call an action of a resource: ${XCALL_USAGE}`);
    for (const [name, c3] of commands)
      lines.push(`- ${name} — ${c3.summary}`);
    return lines.join("\n");
  };
  const exec = async (command, ctx) => {
    var _a;
    const words = (() => {
      try {
        return parseShellLine(command);
      } catch (e3) {
        fail(`${e3 instanceof Error ? e3.message : String(e3)}; exec runs one command, it is not a shell`);
      }
    })();
    const available = `available commands: xcall${commands.size ? `, ${[...commands.keys()].join(", ")}` : ""}`;
    const unquoted = command.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, "");
    if (SHELL_CHARS.test(unquoted)) {
      fail(`exec runs exactly one command and is not a shell: pipes, redirects, \`;\`, \`&\`, backquotes and \`$\` are not supported (quote them to pass them as text). ${available}`);
    }
    const [name, ...args] = words;
    if (!name)
      fail(`empty command; ${available}`);
    if (name === "xcall") {
      if (args.includes("--help") || args.includes("-h"))
        return `usage: ${XCALL_USAGE}
The actions of each resource are listed by read uri="/".`;
      const { object, action, params } = parseXcall(args);
      const m2 = resolve(object, ctx);
      const decl = (_a = m2.decl.actions) == null ? void 0 : _a[action];
      if (!decl) {
        const known = Object.keys(m2.decl.actions ?? {});
        fail(`resource \`${m2.pattern}\` has no action \`${action}\` (actions: ${known.length ? known.join(", ") : "none"})`);
      }
      if (decl.input !== void 0) {
        const invalid = validateJson(decl.input, params);
        if (invalid)
          fail(`invalid params for ${action}: ${invalid}`);
      }
      const { decl: _decl, ...match } = m2;
      const result = await decl.call(match, params);
      return `[risk: ${decl.risk}]
${clipBytes(asText(result) || "ok", MAX_RESULT_BYTES).text}`;
    }
    const c3 = commands.get(name);
    if (!c3)
      fail(`unknown command \`${name}\`; exec runs one command, it is not a shell. ${available}`);
    let input;
    try {
      const parsed = parseArgv({ positionals: c3.positionals, options: c3.options }, args);
      if (parsed.help)
        return commandUsage(name, c3);
      for (let i2 = parsed.positionalCount; i2 < (c3.positionals ?? []).length; i2++) {
        if ((c3.positionals ?? [])[i2].required !== false)
          throw new CommandArgsError("MISSING_ARGUMENT", `missing positional argument: ${(c3.positionals ?? [])[i2].name}`);
      }
      for (const o2 of c3.options ?? []) {
        const prop = o2.property ?? o2.name.split("-").join("_");
        if (o2.required && !(prop in parsed.input))
          throw new CommandArgsError("MISSING_ARGUMENT", `--${o2.name} is required`);
      }
      input = parsed.input;
      if (c3.inputSchema)
        validateSchema(input, c3.inputSchema, "input");
    } catch (e3) {
      if (e3 instanceof CommandArgsError)
        fail(`${name}: ${e3.message}

${commandUsage(name, c3)}`);
      throw e3;
    }
    return clipBytes(asText(await c3.call(input, ctx)) || "ok", MAX_RESULT_BYTES).text;
  };
  const readRaw = async (m2) => {
    if (!m2.decl.read)
      fail(`resource \`${m2.pattern}\` cannot be read`);
    const { decl: _d, ...match } = m2;
    return versioned(await m2.decl.read(match));
  };
  return {
    read: {
      spec: {
        description: `Read a resource of this page by URI (GET). Start with uri "/": it lists the resources, their actions (with risk) and the commands. A collection's read is its list; filter and page with a query (notes?tag=x). Text comes in pages of lines: offset is the first line (1-based), limit the number of lines.`,
        args_schema: OBJECT_ARGS({
          uri: { type: "string", description: 'Resource URI, e.g. "/" or "notes/1"' },
          offset: { type: "integer", description: "First line, 1-based" },
          limit: { type: "integer", description: "Number of lines" }
        }, ["uri"])
      },
      idempotent: true,
      async call(args, ctx) {
        const uri = String(args.uri);
        const offset = typeof args.offset === "number" ? args.offset : void 0;
        const limit = typeof args.limit === "number" ? args.limit : void 0;
        if (uri.trim() === "/" || uri.trim() === "")
          return pageText(discovery(), offset, limit);
        const r3 = await readRaw(resolve(uri, ctx));
        return pageText(r3.text, offset, limit);
      }
    },
    write: {
      spec: {
        description: `Write a resource's content (PUT). mode: "write" (default) replaces it, "new" only creates it and fails if it exists, "append" adds to its end. Use edit to change part of it.`,
        args_schema: OBJECT_ARGS({
          uri: { type: "string", description: "Resource URI" },
          content: { type: "string", description: "The content" },
          mode: { type: "string", enum: ["write", "new", "append"], description: "write | new | append" }
        }, ["uri", "content"])
      },
      async call(args, ctx) {
        const m2 = resolve(String(args.uri), ctx);
        if (!m2.decl.write)
          fail(`resource \`${m2.pattern}\` is read-only`);
        const { decl, ...match } = m2;
        const mode = typeof args.mode === "string" ? args.mode : "write";
        return asText(await decl.write(match, { content: String(args.content), mode })) || "written";
      }
    },
    edit: {
      spec: {
        description: "Change part of a resource (PATCH): old_string must occur exactly once in its current content and is replaced by new_string.",
        args_schema: OBJECT_ARGS({
          uri: { type: "string", description: "Resource URI" },
          old_string: { type: "string", description: "Text to replace; must occur exactly once" },
          new_string: { type: "string", description: "Replacement text" }
        }, ["uri", "old_string", "new_string"])
      },
      async call(args, ctx) {
        const m2 = resolve(String(args.uri), ctx);
        const body = { old_string: String(args.old_string), new_string: String(args.new_string) };
        const { decl, ...match } = m2;
        if (decl.edit)
          return asText(await decl.edit(match, body)) || "edited";
        if (!decl.read || !decl.write)
          fail(`resource \`${m2.pattern}\` cannot be edited`);
        if (!body.old_string)
          fail("old_string is empty");
        const current = versioned(await decl.read(match));
        const count = current.text.split(body.old_string).length - 1;
        if (count === 0)
          fail("old_string was not found in the current content; read it again");
        if (count > 1)
          fail(`old_string occurs ${count} times; give more context so it occurs exactly once`);
        const content = current.text.replace(body.old_string, () => body.new_string);
        const w2 = { content, mode: "write" };
        if (current.version !== void 0)
          w2.ifVersion = current.version;
        return asText(await decl.write(match, w2)) || "edited";
      }
    },
    exec: {
      spec: {
        description: `Run one command (not a shell: no pipes, redirects, ;, &, backquotes or $). Built in: ${XCALL_USAGE} — calls an action listed by read uri="/". The page's commands are listed there too; "<command> --help" shows a command's usage.`,
        args_schema: OBJECT_ARGS({ command: { type: "string", description: "One command line" } }, ["command"])
      },
      idempotent: (args) => execIsIdempotent(String(args.command ?? ""), patterns, origins, commands),
      call: (args, ctx) => exec(String(args.command), ctx)
    }
  };
}
function execIsIdempotent(command, patterns, origins, commands) {
  var _a, _b, _c;
  let words;
  try {
    words = parseShellLine(command);
  } catch {
    return false;
  }
  const [name, ...args] = words;
  if (name === "xcall") {
    try {
      const { object, action } = parseXcall(args);
      const n2 = normalizeUri(object, origins);
      const p3 = patterns.find((q2) => matchPattern(q2, n2.origin, n2.segments));
      const risk = (_b = (_a = p3 == null ? void 0 : p3.decl.actions) == null ? void 0 : _a[action]) == null ? void 0 : _b.risk;
      return risk === "read_only" || risk === "idempotent_write";
    } catch {
      return false;
    }
  }
  const c3 = name ? commands.get(name) : void 0;
  return ((_c = c3 == null ? void 0 : c3.access) == null ? void 0 : _c.level) === "read";
}
const INDEX_TRAIT_URI = "https://buckyos.org/traits/index@1";
function text(v, key) {
  return isObject(v) && typeof v[key] === "string" ? v[key] : "";
}
function riskRank(r3) {
  const i2 = ACTION_RISKS.indexOf(r3);
  return i2 < 0 ? ACTION_RISKS.length : i2;
}
function renderObjectDocument(canonical, card, profile, summary) {
  const lines = [`Object: ${canonical}`, `Object DID: ${card.id}`];
  const aliases = (card.alsoKnownAs ?? []).filter((a11) => a11 !== canonical);
  if (aliases.length)
    lines.push(`Also known as: ${aliases.join(", ")}`);
  for (const [label, key] of [["Title", "title"], ["Description", "description"]]) {
    const v = text(profile, key);
    if (v)
      lines.push(`${label}: ${v}`);
  }
  for (const [section, key] of [["Properties", "properties"], ["Actions", "actions"], ["Events", "events"]]) {
    const entries = isObject(profile) ? profile[key] : void 0;
    if (!isObject(entries) || Object.keys(entries).length === 0)
      continue;
    lines.push(`${section}:`);
    for (const name of Object.keys(entries).sort()) {
      const e3 = entries[name];
      let line = `- ${name}`;
      const d2 = text(e3, "description");
      if (d2)
        line += `: ${d2}`;
      const risk = text(e3, "x-buckyos:risk");
      if (risk)
        line += ` (risk: ${risk})`;
      lines.push(line);
    }
  }
  const names = Object.keys(summary);
  if (names.length) {
    lines.push("Summary:");
    for (const name of names)
      lines.push(`- ${name}:`, JSON.stringify(summary[name], null, 2));
  }
  return lines.join("\n");
}
function isCollection(profile) {
  const traits = isObject(profile) ? profile["x-buckyos:traits"] : void 0;
  return Array.isArray(traits) && traits.includes(INDEX_TRAIT_URI);
}
async function didObjectResources(options) {
  const maxRank = riskRank(options.maxRisk ?? "read_only");
  const out = {};
  for (const root of options.roots) {
    const client = options.client;
    const profile = await client.profile(root);
    const collection = isCollection(profile);
    const actions = {};
    const declared = isObject(profile) && isObject(profile.actions) ? profile.actions : {};
    for (const [name, a11] of Object.entries(declared)) {
      if (collection && (name === "query" || name === "page"))
        continue;
      const risk = text(a11, "x-buckyos:risk");
      if (riskRank(risk) > maxRank)
        continue;
      const input = isObject(a11) ? a11.input : void 0;
      actions[name] = {
        description: text(a11, "description"),
        risk,
        ...input !== void 0 && input !== null ? { input } : {},
        call: (_m, params) => client.invoke(root, name, params)
      };
    }
    const description = [text(profile, "title"), text(profile, "description")].filter(Boolean).join(" — ") || root;
    out[root] = {
      description: collection ? `${description} (a collection: read it with a query, ?cursor=… for the next page)` : description,
      actions,
      async read(m2) {
        if (collection && [...m2.query.keys()].length > 0) {
          const cursor = m2.query.get("cursor");
          const pageSize = m2.query.get("page_size");
          if (cursor)
            return client.invoke(root, "page", { cursor, ...pageSize ? { page_size: Number(pageSize) } : {} });
          const query = {};
          for (const [k3, v] of m2.query)
            if (k3 !== "page_size")
              query[k3] = v;
          return client.invoke(root, "query", { query, ...pageSize ? { page_size: Number(pageSize) } : {} });
        }
        const card = await client.card(root);
        const props = isObject(profile) && isObject(profile.properties) ? Object.keys(profile.properties).filter((p3) => p3 !== "index_schema") : [];
        const listed = isObject(profile) && Array.isArray(profile["x-buckyos:summary_props"]) ? profile["x-buckyos:summary_props"].filter((p3) => typeof p3 === "string") : props;
        const summary = {};
        for (const p3 of listed)
          summary[p3] = await client.readProperty(root, p3);
        return renderObjectDocument(root, { id: String(card.id), alsoKnownAs: card.alsoKnownAs }, profile, summary);
      }
    };
  }
  return out;
}
const XLLM_RUNS_DB = "xllm-runs";
const RECORDS = "records";
const SNAPSHOTS = "snapshots";
function req(r3) {
  return new Promise((resolve, reject) => {
    r3.onsuccess = () => resolve(r3.result);
    r3.onerror = () => reject(r3.error);
  });
}
function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
  });
}
class IndexedDbRunStore {
  constructor(options = {}) {
    this.options = options;
    this.persistent = true;
    this.localLocks = /* @__PURE__ */ new Set();
  }
  open() {
    if (!this.db) {
      const factory = this.options.idb ?? globalThis.indexedDB;
      if (!factory)
        return Promise.reject(XllmError.storage("IndexedDB is not available here"));
      const r3 = factory.open(this.options.dbName ?? XLLM_RUNS_DB, 1);
      r3.onupgradeneeded = () => {
        const db = r3.result;
        if (!db.objectStoreNames.contains(RECORDS))
          db.createObjectStore(RECORDS, { keyPath: "run_id" });
        if (!db.objectStoreNames.contains(SNAPSHOTS))
          db.createObjectStore(SNAPSHOTS);
      };
      this.db = req(r3);
    }
    return this.db;
  }
  locks() {
    var _a;
    if (this.options.locks === null)
      return void 0;
    return this.options.locks ?? ((_a = globalThis.navigator) == null ? void 0 : _a.locks);
  }
  runsDir() {
    return void 0;
  }
  runDir() {
    return void 0;
  }
  async createRun() {
    const db = await this.open();
    for (let i2 = 0; i2 < 8; i2++) {
      const id = generateRunId();
      const existing = await req(db.transaction(RECORDS).objectStore(RECORDS).get(id));
      if (!existing)
        return id;
    }
    throw XllmError.storage("cannot allocate a unique run id");
  }
  async writeRecord(record) {
    const db = await this.open();
    const tx = db.transaction(RECORDS, "readwrite");
    tx.objectStore(RECORDS).put(JSON.parse(JSON.stringify(record)));
    await done(tx);
  }
  async readRecord(runId) {
    const db = await this.open();
    const rec = await req(db.transaction(RECORDS).objectStore(RECORDS).get(runId));
    if (!rec)
      throw new XllmError({ kind: "run_not_found", run_id: runId, runs_dir: `indexeddb:${this.options.dbName ?? XLLM_RUNS_DB}` });
    if (rec.version !== RUN_RECORD_VERSION)
      throw XllmError.notResumable(runId, "unsupported run record version");
    return rec;
  }
  async listRecords() {
    const db = await this.open();
    return await req(db.transaction(RECORDS).objectStore(RECORDS).getAll());
  }
  async putSnapshot(runId, snapshot) {
    const db = await this.open();
    const tx = db.transaction(SNAPSHOTS, "readwrite");
    const store = tx.objectStore(SNAPSHOTS);
    const keys = await req(store.getAllKeys(IDBKeyRange.bound([runId, 0], [runId, Number.MAX_SAFE_INTEGER])));
    const next = keys.length ? Math.max(...keys.map((k3) => k3[1])) + 1 : 1;
    store.put(JSON.parse(JSON.stringify(snapshot)), [runId, next]);
    await done(tx);
    return next;
  }
  async getSnapshot(runId, idx) {
    const db = await this.open();
    const s2 = await req(db.transaction(SNAPSHOTS).objectStore(SNAPSHOTS).get([runId, idx]));
    if (!s2)
      throw new XllmError({ kind: "corrupted_run", run_id: runId, reason: `snapshot ${idx} missing` });
    return s2;
  }
  async listSnapshots(runId) {
    const db = await this.open();
    const keys = await req(db.transaction(SNAPSHOTS).objectStore(SNAPSHOTS).getAllKeys(IDBKeyRange.bound([runId, 0], [runId, Number.MAX_SAFE_INTEGER])));
    return keys.map((k3) => k3[1]).sort((a11, b3) => a11 - b3);
  }
  async lockRun(runId) {
    const name = `xllm-run:${runId}`;
    const locks = this.locks();
    if (!locks) {
      if (this.localLocks.has(name))
        return null;
      this.localLocks.add(name);
      return { release: () => {
        this.localLocks.delete(name);
      } };
    }
    return new Promise((resolve, reject) => {
      locks.request(name, { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(null);
          return Promise.resolve();
        }
        return new Promise((release) => resolve({ release: () => release() }));
      }).catch(reject);
    });
  }
  async isRunLive(runId) {
    const name = `xllm-run:${runId}`;
    const locks = this.locks();
    if (!locks)
      return this.localLocks.has(name);
    const state = await locks.query();
    return (state.held ?? []).some((l3) => l3.name === name);
  }
  async removeRun(runId) {
    const db = await this.open();
    const tx = db.transaction([RECORDS, SNAPSHOTS], "readwrite");
    tx.objectStore(RECORDS).delete(runId);
    tx.objectStore(SNAPSHOTS).delete(IDBKeyRange.bound([runId, 0], [runId, Number.MAX_SAFE_INTEGER]));
    await done(tx);
  }
  async importRun(run) {
    const db = await this.open();
    const tx = db.transaction([RECORDS, SNAPSHOTS], "readwrite");
    tx.objectStore(RECORDS).put(JSON.parse(JSON.stringify(run.record)));
    for (const [idx, s2] of run.snapshots)
      tx.objectStore(SNAPSHOTS).put(JSON.parse(JSON.stringify(s2)), [run.record.run_id, idx]);
    await done(tx);
  }
}
export {
  ACTION_RISKS,
  a8 as AGENT_TOOL_PROTOCOL_VERSION,
  A as AiccLlmClient,
  B as ByteHeuristicTokenizer,
  D as DEFAULT_CONTEXT_YIELD_RATIO,
  h2 as DEFAULT_LLM_TIMEOUT_SECS,
  i as DEFAULT_MAX_CONSECUTIVE_ERRORS,
  j2 as DEFAULT_MAX_TOOL_ITERATIONS,
  k2 as DEFAULT_TASK_WAIT_MS,
  l2 as DEFAULT_TIMEOUT_SECS,
  D2 as DIDObjectClient,
  a10 as DIDObjectError,
  ao as HINT_NS_DEDUP,
  ap as HINT_NS_ONCE,
  V as HOST_PROMPT_SECTIONS_ALL,
  W as HOST_PROMPT_SECTIONS_NONE,
  INDEX_TRAIT_URI,
  IndexedDbRunStore,
  L as LLMComputeException,
  L2 as LLMContext,
  e2 as LLMContextInterruptHandle,
  ae as LlmSummarizeCompressor,
  a4 as MAX_IMAGE_ATTACHMENT_BYTES,
  M as MAX_INJECTIONS_PER_BOUNDARY,
  m as MAX_IN_TOOL_WAIT_MS,
  MAX_RESULT_BYTES,
  a5 as MAX_TEXT_ATTACHMENT_BYTES,
  aq as MemoryHintLedger,
  G as MemoryRunStore,
  Y as REFUSED_CREDENTIALS,
  K as REPORT_ARTIFACTS_KEY,
  z as RUNTIME_PROTOCOL_VERSION,
  RUN_RECORD_VERSION,
  SITE_RUNTIME_KIND,
  b2 as SNAPSHOT_FORMAT_VERSION,
  af as SUMMARIZE_MODEL_ALIAS,
  SiteToolManager,
  x as TemplateEnv,
  aA as TimeoutLlmClient,
  T as ToolDispatchException,
  XCALL_USAGE,
  XLLM_RUNS_DB,
  X as XllmActionParser,
  XllmError,
  Z as XllmInterrupter,
  _ as XllmRun,
  $ as XllmTask,
  ac as XmlStepRenderer,
  h as aiccProviderFailure,
  f2 as allowAllPolicy,
  j as anyJsonObjectSchema,
  ar as applyHints,
  a as asComputeError,
  a9 as asToolResult,
  y as assemblePrompt,
  A2 as buildCmdManualSystemText,
  C as buildRulesSystemText,
  E as buildRuntimeProtocol,
  F as buildRuntimeProtocolFor,
  d as charCount,
  a0 as classifyError,
  ag as compactionTargetTokens,
  ah as compress,
  ai as compressHistory,
  aj as compressOptions,
  c as computeErrorMessage,
  o as computeToolsConfig,
  createSiteRuntime,
  didObjectResources,
  a6 as envelopeObservation,
  e as errorSource,
  H as exportRun,
  J as extractResult,
  au as followupGeneralHint,
  av as followupHint,
  generateRunId,
  I as importRun,
  aw as inCallWaitMs,
  a1 as inFlightCall,
  b as infraRetrySafe,
  a7 as isIdempotent,
  ak as isSummaryMessage,
  a2 as isTerminal,
  l as llmCorrectable,
  P as materializeHistory,
  q as mergeConfigLayers,
  n as noopWorklog,
  normalizeUri,
  aa as observationText,
  pageText,
  w as parseLlmContextJson,
  p2 as parseReply,
  al as parseSummaryMessage,
  p as providerError,
  k as providerErrorFromRpc,
  as as renderHintBlock,
  renderObjectDocument,
  Q as renderStepHistory,
  at as renderWithHints,
  N as reportArtifacts,
  r2 as resolveToolSpecs,
  ax as resultView,
  U as rewritableHistory,
  a3 as runRequest,
  r as rustTrim,
  f as rustTrimEnd,
  g as rustTrimStart,
  s as serdeJson,
  siteTools,
  O as splitReportResult,
  c2 as stateFromRequest,
  am as summaryMessage,
  an as summaryModel,
  ay as taskStateObservation,
  ab as toHost,
  ad as toolResultViewFromHost,
  unresolvedReason,
  validateJson,
  az as waitUntilMs
};
//# sourceMappingURL=xllm.mjs.map
