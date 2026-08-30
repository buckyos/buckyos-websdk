import process from "node:process";
import { fileURLToPath } from "node:url";
import * as nodePath from "node:path";
import { resolve as resolve$5, dirname as dirname$3 } from "node:path";
import { namelib, BuckyOSSDK, RuntimeType, buckyos, VerifyHubClient, createAppInstanceId, parseSessionTokenClaims, ndn, ndm_proxy } from "buckyos/node";
import { createHash } from "node:crypto";
import { readFile, writeFile, readdir, stat, lstat, realpath, mkdtemp, rename, rm, mkdir, chmod, symlink, copyFile, open } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip, constants } from "node:zlib";
function optionProperty(option) {
  return option.property ?? option.name.replaceAll("-", "_");
}
const EXIT_SUCCESS = 0;
const EXIT_USAGE = 2;
const EXIT_AUTH = 3;
const EXIT_PERMISSION = 4;
const EXIT_UNAVAILABLE = 5;
const EXIT_OPERATION = 6;
const EXIT_TIMEOUT = 8;
const EXIT_INTERNAL = 9;
class ToolError extends Error {
  constructor(code, message, exitCode = EXIT_OPERATION, retryable = false, details = {}) {
    super(message);
    this.name = "ToolError";
    this.code = code;
    this.exitCode = exitCode;
    this.retryable = retryable;
    this.details = details;
  }
}
class UsageError extends ToolError {
  constructor(code, message, details = {}) {
    super(code, message, EXIT_USAGE, false, details);
  }
}
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const URL_CREDENTIAL_PATTERN = /(\w+:\/\/)[^\s/@:]+:[^\s/@]+@/g;
const DATABASE_URI_PATTERN = /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|sqlite):\/\/[^\s,;]+/gi;
function sanitizeMessage(message) {
  return message.replaceAll(JWT_PATTERN, "[REDACTED_TOKEN]").replaceAll(URL_CREDENTIAL_PATTERN, "$1[REDACTED]@").replaceAll(DATABASE_URI_PATTERN, "[REDACTED_DATABASE_URI]").replace(
    /(session[_-]?token|refresh[_-]?token|access[_-]?token|private[_-]?key|password|passwd|api[_-]?key|client[_-]?secret|secret)\s*[=:]\s*[^\s,;]+/gi,
    "$1=[REDACTED]"
  );
}
function normalizeError(error) {
  if (error instanceof ToolError) {
    return new ToolError(
      error.code,
      sanitizeMessage(error.message),
      error.exitCode,
      error.retryable,
      error.details
    );
  }
  const raw = error instanceof Error ? error.message : String(error);
  const message = sanitizeMessage(raw);
  const lower = message.toLowerCase();
  if (lower.includes("abort") || lower.includes("cancel")) {
    return new ToolError("CANCELED", "operation canceled", EXIT_TIMEOUT);
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return new ToolError("TIMEOUT", "operation timed out", EXIT_TIMEOUT, true);
  }
  if (lower.includes("permission denied") || lower.includes("no permission") || lower.includes("rpc call error: 403")) {
    return new ToolError("PERMISSION_DENIED", message, EXIT_PERMISSION);
  }
  if (lower.includes("rpc call error: 401") || lower.includes("unauthorized") || lower.includes("token expired") || lower.includes("session expired") || lower.includes("invalid token")) {
    return new ToolError(
      lower.includes("expired") ? "SESSION_EXPIRED" : "INVALID_SESSION",
      lower.includes("expired") ? "the session token has expired" : message,
      EXIT_AUTH
    );
  }
  if (lower.includes("fetch failed") || lower.includes("connection refused") || lower.includes("rpc call error: 502") || lower.includes("rpc call error: 503") || lower.includes("rpc call error: 504")) {
    return new ToolError("SERVICE_UNAVAILABLE", message, EXIT_UNAVAILABLE, true);
  }
  if (lower.includes("not found") || lower.includes("key not exist")) {
    return new ToolError("RESOURCE_NOT_FOUND", message, EXIT_OPERATION);
  }
  if (lower.includes("rpc call error:")) {
    return new ToolError("OPERATION_FAILED", message, EXIT_OPERATION);
  }
  return new ToolError("INTERNAL_ERROR", message || "internal error", EXIT_INTERNAL);
}
const OUTPUT_FORMATS = ["json", "jsonl", "table", "text", "raw"];
const STRING_GLOBALS = /* @__PURE__ */ new Map([
  ["config-dir", "configDir"],
  ["profile", "profile"],
  ["zone", "zone"],
  ["endpoint", "endpoint"],
  ["identity", "identity"],
  ["identity-root", "identityRoot"],
  ["security-root", "securityRoot"],
  ["session-token", "sessionToken"],
  ["session-token-file", "sessionTokenFile"],
  ["output", "output"],
  ["input", "input"],
  ["timeout", "timeout"],
  ["trace-id", "traceId"],
  ["idempotency-key", "idempotencyKey"]
]);
const REPEATABLE_STRING_GLOBALS = /* @__PURE__ */ new Map([
  ["allow-read", "allowRead"]
]);
const BOOLEAN_GLOBALS = /* @__PURE__ */ new Map([
  ["cli", "cli"],
  ["wait", "wait"],
  ["non-interactive", "nonInteractive"],
  ["yes", "yes"],
  ["no-color", "noColor"],
  ["verbose", "verbose"],
  ["help", "help"],
  ["version", "version"]
]);
const REPL_SCOPED_STRING_GLOBALS = /* @__PURE__ */ new Set([
  "input",
  "timeout",
  "trace-id",
  "idempotency-key",
  "output"
]);
const REPL_SCOPED_BOOLEAN_GLOBALS = /* @__PURE__ */ new Set(["wait", "yes"]);
function parseInvocation(argv) {
  const global = {};
  let index = 0;
  while (index < argv.length) {
    const token = argv[index];
    if (token === "-h") {
      setGlobal(global, "help", true);
      index += 1;
      continue;
    }
    if (token === "--") {
      index += 1;
      break;
    }
    if (!token.startsWith("--"))
      break;
    const parsed = splitLongOption(token);
    const booleanProperty = BOOLEAN_GLOBALS.get(parsed.name);
    if (booleanProperty) {
      if (parsed.inlineValue !== void 0) {
        throw new UsageError("INVALID_ARGUMENT", `--${parsed.name} does not accept a value`);
      }
      setGlobal(global, booleanProperty, true);
      index += 1;
      continue;
    }
    const stringProperty = STRING_GLOBALS.get(parsed.name);
    const repeatableStringProperty = REPEATABLE_STRING_GLOBALS.get(parsed.name);
    if (!stringProperty && !repeatableStringProperty) {
      throw new UsageError("UNKNOWN_OPTION", `unknown global option: --${parsed.name}`);
    }
    const { value, consumed } = readOptionValue(argv, index, parsed);
    if (repeatableStringProperty === "allowRead") {
      global.allowRead = [...global.allowRead ?? [], value];
    } else {
      setGlobal(global, stringProperty, normalizeGlobalValue(parsed.name, value));
    }
    index += consumed;
  }
  const module = argv[index];
  const verb = argv[index + 1];
  const actionArgv = module ? argv.slice(index + (verb ? 2 : 1)) : [];
  if (module?.startsWith("-")) {
    throw new UsageError(
      "INVALID_ARGUMENT",
      `global options must appear before the module: ${module}`
    );
  }
  return { global, module, verb, actionArgv };
}
function parseCommandArgs(command, argv, inputObject, allowReplScopedGlobals = false, deferValidation = false) {
  const cliInput = {};
  const scoped = {};
  const positionals = command.positionals ?? [];
  const optionByName = new Map((command.options ?? []).map((option) => [option.name, option]));
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
      for (const positionalValue of argv.slice(index + 1)) {
        positionalIndex = assignPositional(
          cliInput,
          positionals,
          positionalIndex,
          positionalValue
        );
      }
      break;
    }
    if (!token.startsWith("--")) {
      positionalIndex = assignPositional(cliInput, positionals, positionalIndex, token);
      index += 1;
      continue;
    }
    const parsed = splitLongOption(token);
    if (allowReplScopedGlobals && REPL_SCOPED_BOOLEAN_GLOBALS.has(parsed.name)) {
      if (parsed.inlineValue !== void 0) {
        throw new UsageError("INVALID_ARGUMENT", `--${parsed.name} does not accept a value`);
      }
      const property2 = BOOLEAN_GLOBALS.get(parsed.name);
      setGlobal(scoped, property2, true);
      index += 1;
      continue;
    }
    if (allowReplScopedGlobals && REPL_SCOPED_STRING_GLOBALS.has(parsed.name)) {
      const property2 = STRING_GLOBALS.get(parsed.name);
      const { value: value2, consumed: consumed2 } = readOptionValue(argv, index, parsed);
      setGlobal(scoped, property2, normalizeGlobalValue(parsed.name, value2));
      index += consumed2;
      continue;
    }
    if (allowReplScopedGlobals && (STRING_GLOBALS.has(parsed.name) || REPEATABLE_STRING_GLOBALS.has(parsed.name) || BOOLEAN_GLOBALS.has(parsed.name))) {
      throw new UsageError(
        "SESSION_OPTION_FROZEN",
        `--${parsed.name} is frozen for the interactive session`
      );
    }
    const option = optionByName.get(parsed.name);
    if (!option)
      throw new UsageError("UNKNOWN_OPTION", `unknown option: --${parsed.name}`);
    const property = optionProperty(option);
    if (Object.hasOwn(cliInput, property)) {
      throw new UsageError("DUPLICATE_ARGUMENT", `argument provided more than once: ${property}`);
    }
    if (option.type === "boolean") {
      if (parsed.inlineValue !== void 0) {
        throw new UsageError("INVALID_ARGUMENT", `--${parsed.name} does not accept a value`);
      }
      cliInput[property] = true;
      index += 1;
      continue;
    }
    const { value, consumed } = readOptionValue(argv, index, parsed);
    cliInput[property] = parseOptionValue(option.type, value, parsed.name);
    index += consumed;
  }
  for (let index = positionalIndex; !deferValidation && index < positionals.length; index++) {
    if (positionals[index].required !== false && !Object.hasOwn(inputObject ?? {}, positionals[index].name)) {
      throw new UsageError(
        "MISSING_ARGUMENT",
        `missing positional argument: ${positionals[index].name}`
      );
    }
  }
  const input = mergeCommandInput(inputObject, cliInput);
  if (!deferValidation)
    validateSchema(input, command.inputSchema, "input");
  return { input, scoped, help };
}
function parseDuration(value) {
  const match = /^(\d+)(ms|s|m|h)$/.exec(value.trim());
  if (!match) {
    throw new UsageError("INVALID_DURATION", `invalid duration: ${value}`);
  }
  const amount = Number(match[1]);
  const scale = match[2] === "ms" ? 1 : match[2] === "s" ? 1e3 : match[2] === "m" ? 6e4 : 36e5;
  const result = amount * scale;
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new UsageError("INVALID_DURATION", `invalid duration: ${value}`);
  }
  return result;
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
    throw new UsageError("INVALID_COMMAND_LINE", "unfinished escape sequence");
  if (quote)
    throw new UsageError("INVALID_COMMAND_LINE", `unterminated ${quote} quote`);
  if (started)
    tokens.push(current);
  return tokens;
}
function validateSchema(value, schema, path) {
  if (schema.enum && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    throw new UsageError(
      "SCHEMA_VALIDATION_FAILED",
      `${path} must be one of ${schema.enum.join(", ")}`
    );
  }
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new UsageError("SCHEMA_VALIDATION_FAILED", `${path} must be an object`);
    }
    const object = value;
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(object, required)) {
        throw new UsageError("SCHEMA_VALIDATION_FAILED", `${path}.${required} is required`);
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(object)) {
        if (!Object.hasOwn(schema.properties ?? {}, key)) {
          throw new UsageError("SCHEMA_VALIDATION_FAILED", `${path}.${key} is not allowed`);
        }
      }
    }
    for (const [key, propertyValue] of Object.entries(object)) {
      const propertySchema = schema.properties?.[key];
      if (propertySchema)
        validateSchema(propertyValue, propertySchema, `${path}.${key}`);
    }
    return;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) {
      throw new UsageError("SCHEMA_VALIDATION_FAILED", `${path} must be an array`);
    }
    if (schema.items) {
      value.forEach((item, index) => validateSchema(item, schema.items, `${path}[${index}]`));
    }
    return;
  }
  if (schema.type === "string") {
    if (typeof value !== "string") {
      throw new UsageError("SCHEMA_VALIDATION_FAILED", `${path} must be a string`);
    }
    if (schema.minLength !== void 0 && value.length < schema.minLength) {
      throw new UsageError("SCHEMA_VALIDATION_FAILED", `${path} is too short`);
    }
    return;
  }
  if (schema.type === "boolean" && typeof value !== "boolean") {
    throw new UsageError("SCHEMA_VALIDATION_FAILED", `${path} must be a boolean`);
  }
  if (schema.type === "integer" && (!Number.isInteger(value) || typeof value !== "number")) {
    throw new UsageError("SCHEMA_VALIDATION_FAILED", `${path} must be an integer`);
  }
  if (schema.type === "number" && typeof value !== "number") {
    throw new UsageError("SCHEMA_VALIDATION_FAILED", `${path} must be a number`);
  }
}
function assignPositional(input, positionals, index, value) {
  const positional = positionals[index];
  if (!positional) {
    throw new UsageError("TOO_MANY_ARGUMENTS", `unexpected positional argument: ${value}`);
  }
  input[positional.name] = value;
  return index + 1;
}
function splitLongOption(token) {
  const content = token.slice(2);
  const equalIndex = content.indexOf("=");
  return equalIndex < 0 ? { name: content } : { name: content.slice(0, equalIndex), inlineValue: content.slice(equalIndex + 1) };
}
function readOptionValue(argv, index, option) {
  if (option.inlineValue !== void 0) {
    if (!option.inlineValue) {
      throw new UsageError("MISSING_ARGUMENT", `--${option.name} requires a value`);
    }
    return { value: option.inlineValue, consumed: 1 };
  }
  const value = argv[index + 1];
  if (value === void 0 || value.startsWith("--")) {
    throw new UsageError("MISSING_ARGUMENT", `--${option.name} requires a value`);
  }
  return { value, consumed: 2 };
}
function parseOptionValue(type, value, name) {
  if (type === "string")
    return value;
  const number = Number(value);
  if (!Number.isFinite(number) || type === "integer" && !Number.isInteger(number)) {
    throw new UsageError("INVALID_ARGUMENT", `--${name} requires a ${type}`);
  }
  return number;
}
function mergeCommandInput(inputObject, cliInput) {
  const result = { ...inputObject ?? {} };
  for (const [key, value] of Object.entries(cliInput)) {
    if (Object.hasOwn(result, key)) {
      throw new UsageError("ARGUMENT_CONFLICT", `${key} is present in both --input and argv`);
    }
    result[key] = value;
  }
  return result;
}
function normalizeGlobalValue(name, value) {
  if (name === "output") {
    if (!OUTPUT_FORMATS.includes(value)) {
      throw new UsageError("INVALID_OUTPUT_FORMAT", `invalid output format: ${value}`);
    }
    return value;
  }
  return value;
}
function setGlobal(target, property, value) {
  if (target[property] !== void 0) {
    throw new UsageError("DUPLICATE_ARGUMENT", `option provided more than once: ${property}`);
  }
  target[property] = value;
}
class HostError extends Error {
  constructor(code, message, path, cause) {
    super(message, { cause });
    this.name = "HostError";
    this.code = code;
    this.path = path;
  }
}
function isHostError(error, code) {
  return error instanceof HostError && error.code === code;
}
let activeHost;
function installHost(host2) {
  if (activeHost && activeHost !== host2)
    throw new Error("CLI host is already installed");
  activeHost = host2;
}
function getHost() {
  if (!activeHost)
    throw new Error("CLI host was not injected by a launcher");
  return activeHost;
}
const TOOL_ENVIRONMENT_NAMES = [
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "BUCKYOS_TOOL_CONFIG_DIR",
  "BUCKYOS_TOOL_PROFILE",
  "BUCKYOS_TOOL_ZONE",
  "BUCKYOS_TOOL_ENDPOINT",
  "BUCKYOS_TOOL_IDENTITY",
  "BUCKYOS_TOOL_OUTPUT",
  "BUCKYOS_IDENTITY_ROOT",
  "BUCKYOS_SECURITY_ROOT",
  "BUCKYOS_APPCLIENT_SESSION_TOKEN",
  "BUCKYOS_ROOT",
  "SOURCE_DATE_EPOCH"
];
function buildDistributionPolicy(options) {
  const { argv, cwd, packageRoot: packageRoot2, homeDir, environment: environment2, path } = options;
  const buckyosRoot = path.resolve(
    options.buckyosRoot ?? environment2.BUCKYOS_ROOT ?? defaultBuckyosRoot(options)
  );
  const configRoot = path.resolve(
    environment2.BUCKYOS_TOOL_CONFIG_DIR ?? path.join(homeDir, ".buckyos_tool")
  );
  const readPaths = /* @__PURE__ */ new Set([path.resolve(packageRoot2), path.resolve(cwd), configRoot]);
  const writePaths = /* @__PURE__ */ new Set([path.resolve(cwd), configRoot]);
  if (options.distribution === "system")
    readPaths.add(buckyosRoot);
  if (environment2.BUCKYOS_IDENTITY_ROOT && environment2.BUCKYOS_SECURITY_ROOT) {
    readPaths.add(path.resolve(environment2.BUCKYOS_IDENTITY_ROOT));
    readPaths.add(path.resolve(environment2.BUCKYOS_SECURITY_ROOT));
  }
  const parsed = collectArgumentPaths(argv);
  for (const candidate of parsed.read)
    readPaths.add(resolveInputPath(candidate, cwd, path));
  for (const candidate of parsed.write)
    writePaths.add(resolveInputPath(candidate, cwd, path));
  for (const candidate of parsed.writeParents) {
    writePaths.add(path.dirname(resolveInputPath(candidate, cwd, path)));
  }
  const subprocesses = parsed.module === "pikg" && ["init", "build"].includes(parsed.verb ?? "") ? ["docker"] : [];
  const network = parsed.module !== void 0 && !["pikg", "command", "completion", "config"].includes(parsed.module);
  const allowedEnvironment = options.distribution === "developer" ? TOOL_ENVIRONMENT_NAMES.filter((name) => name !== "BUCKYOS_ROOT") : TOOL_ENVIRONMENT_NAMES;
  return Object.freeze({
    name: options.distribution === "system" ? "system-default" : "developer-default",
    distribution: options.distribution,
    packageRoot: path.resolve(packageRoot2),
    readPaths: Object.freeze([...readPaths]),
    writePaths: Object.freeze([...writePaths]),
    environment: Object.freeze(allowedEnvironment),
    subprocesses: Object.freeze(subprocesses),
    network,
    ...options.distribution === "system" ? { buckyosRoot } : {}
  });
}
function defaultBuckyosRoot(options) {
  if (options.path.sep === "\\") {
    return options.environment.APPDATA ? options.path.join(options.environment.APPDATA, "buckyos") : options.path.join(options.homeDir, "AppData", "Roaming", "buckyos");
  }
  return "/opt/buckyos";
}
function resolveInputPath(value, cwd, path) {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(cwd, value);
}
function collectArgumentPaths(argv) {
  const read = [];
  const write = [];
  const writeParents = [];
  let module;
  let verb;
  let positional = 0;
  const valueOptions = /* @__PURE__ */ new Set([
    "profile",
    "zone",
    "endpoint",
    "identity",
    "session-token",
    "output",
    "timeout",
    "trace-id",
    "idempotency-key",
    "from",
    "app-class",
    "owner",
    "policy",
    "data",
    "strategy",
    "kind",
    "source",
    "version",
    "name"
  ]);
  const booleanOptions = /* @__PURE__ */ new Set([
    "cli",
    "wait",
    "non-interactive",
    "yes",
    "no-color",
    "verbose",
    "help",
    "version"
  ]);
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!module && !token.startsWith("-")) {
      module = token;
      continue;
    }
    if (module && !verb && !token.startsWith("-")) {
      verb = token;
      continue;
    }
    if (token.startsWith("--")) {
      const equal = token.indexOf("=");
      const name = token.slice(2, equal < 0 ? void 0 : equal);
      if (booleanOptions.has(name))
        continue;
      const inline = equal < 0 ? void 0 : token.slice(equal + 1);
      const value = inline ?? argv[index + 1];
      if (inline === void 0 && value !== void 0 && !value.startsWith("--"))
        index++;
      if (value === void 0)
        continue;
      if (name === "config-dir") {
        read.push(value);
        write.push(value);
      } else if (name === "allow-read") {
        read.push(value);
      } else if (["input", "session-token-file", "identity-root", "security-root", "pikg"].includes(name)) {
        if (value !== "-")
          read.push(value);
      } else if (name === "source" && module === "pikg") {
        read.push(value);
      } else if (name === "plan") {
        read.push(value);
        if (module === "app" && verb === "fetch")
          write.push(value);
      } else if (name === "path")
        write.push(value);
      else if (name === "file" && module === "system-config" && verb === "set-file") {
        read.push(value);
      } else if (!valueOptions.has(name))
        continue;
      continue;
    }
    if (module === "app" && ["fetch", "install"].includes(verb ?? "") && positional++ === 0) {
      if (!/^https?:\/\//i.test(token))
        read.push(token);
    } else if (module === "pikg" && positional++ === 0) {
      read.push(token);
      if (verb === "init" || verb === "pack")
        write.push(token);
      else if (verb === "build" || verb === "clean")
        writeParents.push(token);
    }
  }
  return { read, write, writeParents, module, verb };
}
function policyView(host2) {
  return {
    executable: host2.executable,
    runtime_executable: host2.runtimeExecutable,
    distribution: host2.policy.distribution,
    policy: host2.policy.name,
    host: host2.kind,
    runtime: host2.runtimeName,
    runtime_version: host2.runtimeVersion,
    platform: host2.platform,
    arch: host2.arch,
    package_root: host2.policy.packageRoot,
    read_paths: [...host2.policy.readPaths],
    write_paths: [...host2.policy.writePaths],
    environment: [...host2.policy.environment],
    subprocesses: [...host2.policy.subprocesses],
    network: host2.policy.network
  };
}
async function readDistributionManifest(host2 = getHost()) {
  const path = host2.path.join(host2.policy.packageRoot, "distribution.json");
  try {
    const value = JSON.parse(await host2.readTextFile(path));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch (error) {
    if (isHostError(error, "NotFound"))
      return null;
    throw error;
  }
}
function distributionManifestView(manifest) {
  if (!manifest)
    return null;
  const { npm_files: files, ...summary } = manifest;
  return {
    ...summary,
    npm_file_count: Array.isArray(files) ? files.length : null
  };
}
const dirname$2 = (path) => getHost().path.dirname(path);
const isAbsolute$2 = (path) => getHost().path.isAbsolute(path);
const join$3 = (...parts) => getHost().path.join(...parts);
const resolve$4 = (...parts) => getHost().path.resolve(...parts);
const ENVIRONMENT_NAMES = [
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "BUCKYOS_TOOL_CONFIG_DIR",
  "BUCKYOS_TOOL_PROFILE",
  "BUCKYOS_TOOL_ZONE",
  "BUCKYOS_TOOL_ENDPOINT",
  "BUCKYOS_TOOL_IDENTITY",
  "BUCKYOS_TOOL_OUTPUT",
  "BUCKYOS_IDENTITY_ROOT",
  "BUCKYOS_SECURITY_ROOT",
  "BUCKYOS_APPCLIENT_SESSION_TOKEN",
  "BUCKYOS_ROOT"
];
const PROFILE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const DEFAULT_TIMEOUT_MS = 3e4;
class ConfigStore {
  constructor(root) {
    this.root = resolve$4(root);
  }
  async readConfig() {
    return await this.#readJson(join$3(this.root, "config.json"), {
      schema_version: 1
    });
  }
  async readProfile(name) {
    validateProfileName(name);
    return await this.#readJson(this.profilePath(name), void 0);
  }
  async listProfiles() {
    const directory = join$3(this.root, "profiles");
    try {
      const names = [];
      for (const entry of await getHost().readDir(directory)) {
        if (entry.isFile && entry.name.endsWith(".json")) {
          const name = entry.name.slice(0, -5);
          if (PROFILE_NAME.test(name))
            names.push(name);
        }
      }
      return names.sort();
    } catch (error) {
      if (isHostError(error, "NotFound"))
        return [];
      throw error;
    }
  }
  async writeConfig(config) {
    validateToolConfig(config, "config.json");
    await this.#atomicWrite(join$3(this.root, "config.json"), config);
  }
  async writeProfile(name, profile) {
    validateProfileName(name);
    validateProfileConfig(profile, `profiles/${name}.json`);
    await this.#atomicWrite(this.profilePath(name), profile);
  }
  profilePath(name) {
    validateProfileName(name);
    return join$3(this.root, "profiles", `${name}.json`);
  }
  historyPath() {
    return join$3(this.root, "state", "repl_history");
  }
  async #readJson(path, missing) {
    try {
      const parsed = JSON.parse(await getHost().readTextFile(path));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new UsageError("INVALID_CONFIG", `${path} must contain a JSON object`);
      }
      if (parsed.schema_version !== 1) {
        throw new UsageError(
          "UNSUPPORTED_CONFIG_VERSION",
          `${path} has an unsupported schema_version`
        );
      }
      if (path.endsWith("config.json") && !path.includes("/profiles/")) {
        validateToolConfig(parsed, path);
      } else {
        validateProfileConfig(parsed, path);
      }
      return parsed;
    } catch (error) {
      if (isHostError(error, "NotFound") && missing !== void 0)
        return missing;
      if (error instanceof SyntaxError) {
        throw new UsageError("INVALID_CONFIG", `${path} is not valid JSON`);
      }
      throw error;
    }
  }
  async #atomicWrite(path, value) {
    const host2 = getHost();
    await host2.mkdir(dirname$2(path), { recursive: true, mode: 448 });
    const temporary = `${path}.tmp-${host2.pid}-${crypto.randomUUID()}`;
    const body = `${JSON.stringify(value, null, 2)}
`;
    try {
      await host2.writeTextFile(temporary, body, { mode: 384, createNew: true });
      await host2.rename(temporary, path);
      if (host2.platform !== "windows")
        await host2.chmod(path, 384);
    } catch (error) {
      try {
        await host2.remove(temporary);
      } catch (cleanupError) {
      }
      throw error;
    }
  }
}
async function resolveConfig(explicit, environment2 = readEnvironment(), options = {}) {
  const cwd = options.cwd ?? getHost().cwd();
  const homeDir = options.homeDir ?? environment2.HOME ?? environment2.USERPROFILE ?? getHost().homeDir();
  const configDir = resolveConfigRoot(explicit, environment2, cwd, homeDir);
  const store = new ConfigStore(configDir);
  const config = await store.readConfig();
  const profileName = explicit.profile ?? environment2.BUCKYOS_TOOL_PROFILE ?? config.default_profile;
  const profile = profileName ? await store.readProfile(profileName) : void 0;
  if (profileName && !profile) {
    throw new UsageError("PROFILE_NOT_FOUND", `profile not found: ${profileName}`);
  }
  const sources = {
    config_dir: sourceOf(
      explicit.configDir,
      environment2.BUCKYOS_TOOL_CONFIG_DIR,
      void 0,
      "default"
    )
  };
  const zone = select(
    "zone",
    explicit.zone,
    environment2.BUCKYOS_TOOL_ZONE,
    profile?.zone,
    void 0,
    sources
  );
  const endpoint = select(
    "endpoint",
    explicit.endpoint,
    environment2.BUCKYOS_TOOL_ENDPOINT,
    profile?.endpoint,
    void 0,
    sources
  );
  const identity = select(
    "identity",
    explicit.identity,
    environment2.BUCKYOS_TOOL_IDENTITY,
    profile?.identity,
    void 0,
    sources
  );
  const identityRoot = select(
    "identity_root",
    explicit.identityRoot,
    environment2.BUCKYOS_IDENTITY_ROOT,
    void 0,
    void 0,
    sources
  );
  const securityRoot = select(
    "security_root",
    explicit.securityRoot,
    environment2.BUCKYOS_SECURITY_ROOT,
    void 0,
    void 0,
    sources
  );
  if (!!explicit.identityRoot !== !!explicit.securityRoot) {
    throw new UsageError(
      "IDENTITY_ROOT_PAIR_REQUIRED",
      "--identity-root and --security-root must be provided together"
    );
  }
  if (!!environment2.BUCKYOS_IDENTITY_ROOT !== !!environment2.BUCKYOS_SECURITY_ROOT && !explicit.identityRoot) {
    throw new UsageError(
      "IDENTITY_ROOT_PAIR_REQUIRED",
      "BUCKYOS_IDENTITY_ROOT and BUCKYOS_SECURITY_ROOT must be provided together"
    );
  }
  let output;
  if (options.interactive && explicit.output === void 0) {
    output = "table";
    sources.output = "interactive-default";
  } else {
    output = select(
      "output",
      explicit.output,
      asOutput(environment2.BUCKYOS_TOOL_OUTPUT),
      profile?.output,
      config.output ?? "json",
      sources
    );
  }
  const defaultProtocol = profile?.default_protocol ?? inferProtocol(endpoint) ?? "https://";
  const timeoutMs = explicit.timeout ? parseDuration(explicit.timeout) : DEFAULT_TIMEOUT_MS;
  if (endpoint)
    validateEndpoint(endpoint);
  const sessionToken = explicit.sessionToken ?? environment2.BUCKYOS_APPCLIENT_SESSION_TOKEN;
  if (sessionToken)
    sources.session_token = explicit.sessionToken ? "argument" : "environment";
  if (profileName) {
    sources.profile = explicit.profile ? "argument" : environment2.BUCKYOS_TOOL_PROFILE ? "environment" : "config";
  }
  return {
    store,
    resolved: {
      configDir,
      profileName,
      zone,
      endpoint,
      identity,
      identityRoot,
      securityRoot,
      sessionToken,
      sessionTokenFile: explicit.sessionTokenFile,
      output,
      defaultProtocol,
      timeoutMs,
      traceId: explicit.traceId,
      idempotencyKey: explicit.idempotencyKey,
      wait: explicit.wait ?? false,
      nonInteractive: explicit.nonInteractive ?? false,
      yes: explicit.yes ?? false,
      noColor: explicit.noColor ?? false,
      verbose: explicit.verbose ?? false,
      sources
    }
  };
}
function resolveConfigRoot(explicit, environment2, cwd = getHost().cwd(), homeDir = environment2.HOME ?? environment2.USERPROFILE ?? getHost().homeDir()) {
  const value = explicit.configDir ?? environment2.BUCKYOS_TOOL_CONFIG_DIR ?? join$3(homeDir, ".buckyos_tool");
  return isAbsolute$2(value) ? value : resolve$4(cwd, value);
}
function localResolvedConfig(explicit, environment2 = readEnvironment(), options = {}) {
  const cwd = options.cwd ?? getHost().cwd();
  const homeDir = options.homeDir ?? environment2.HOME ?? environment2.USERPROFILE ?? getHost().homeDir();
  const configDir = resolveConfigRoot(explicit, environment2, cwd, homeDir);
  const output = options.interactive && explicit.output === void 0 ? "table" : explicit.output ?? asOutput(environment2.BUCKYOS_TOOL_OUTPUT) ?? "json";
  return {
    store: new ConfigStore(configDir),
    resolved: {
      configDir,
      profileName: explicit.profile ?? environment2.BUCKYOS_TOOL_PROFILE,
      zone: explicit.zone ?? environment2.BUCKYOS_TOOL_ZONE,
      endpoint: explicit.endpoint ?? environment2.BUCKYOS_TOOL_ENDPOINT,
      identity: explicit.identity ?? environment2.BUCKYOS_TOOL_IDENTITY,
      identityRoot: explicit.identityRoot ?? environment2.BUCKYOS_IDENTITY_ROOT,
      securityRoot: explicit.securityRoot ?? environment2.BUCKYOS_SECURITY_ROOT,
      sessionToken: explicit.sessionToken ?? environment2.BUCKYOS_APPCLIENT_SESSION_TOKEN,
      sessionTokenFile: explicit.sessionTokenFile,
      output,
      defaultProtocol: inferProtocol(explicit.endpoint ?? environment2.BUCKYOS_TOOL_ENDPOINT) ?? "https://",
      timeoutMs: explicit.timeout ? parseDuration(explicit.timeout) : DEFAULT_TIMEOUT_MS,
      traceId: explicit.traceId,
      idempotencyKey: explicit.idempotencyKey,
      wait: explicit.wait ?? false,
      nonInteractive: explicit.nonInteractive ?? false,
      yes: explicit.yes ?? false,
      noColor: explicit.noColor ?? false,
      verbose: explicit.verbose ?? false,
      sources: {
        config_dir: sourceOf(
          explicit.configDir,
          environment2.BUCKYOS_TOOL_CONFIG_DIR,
          void 0,
          "default"
        ),
        output: explicit.output ? "argument" : environment2.BUCKYOS_TOOL_OUTPUT ? "environment" : "default"
      }
    }
  };
}
function readEnvironment() {
  const allowed = getHost().policy.environment;
  return Object.fromEntries(
    ENVIRONMENT_NAMES.map((name) => [name, allowed.includes(name) ? getHost().env(name) : void 0])
  );
}
function effectiveConfigView(config) {
  return {
    schema_version: 1,
    config_dir: config.configDir,
    profile: config.profileName ?? null,
    zone: config.zone ?? null,
    endpoint: redactUrl(config.endpoint),
    identity: config.identity ?? null,
    identity_root: config.identityRoot ?? null,
    security_root: config.securityRoot ? "[CONFIGURED]" : null,
    output: config.output,
    default_protocol: config.defaultProtocol,
    timeout_ms: config.timeoutMs,
    session_token: config.sessionToken || config.sessionTokenFile ? {
      present: true,
      source: config.sources.session_token ?? (config.sessionTokenFile ? "file" : "unknown"),
      summary: "[REDACTED]"
    } : { present: false },
    sources: config.sources
  };
}
function validateProfileName(name) {
  if (!PROFILE_NAME.test(name)) {
    throw new UsageError("INVALID_PROFILE_NAME", `invalid profile name: ${name}`);
  }
}
function validateToolConfig(config, source) {
  if (config.schema_version !== 1) {
    throw new UsageError(
      "UNSUPPORTED_CONFIG_VERSION",
      `${source} has an unsupported schema_version`
    );
  }
  if (config.default_profile !== void 0)
    validateProfileName(config.default_profile);
  if (config.output !== void 0)
    asOutput(config.output, source);
  rejectUnknownKeys(config, [
    "schema_version",
    "default_profile",
    "output"
  ], source);
}
function validateProfileConfig(profile, source) {
  if (profile.schema_version !== 1) {
    throw new UsageError(
      "UNSUPPORTED_CONFIG_VERSION",
      `${source} has an unsupported schema_version`
    );
  }
  if (profile.output !== void 0)
    asOutput(profile.output, source);
  if (profile.default_protocol !== void 0 && !["http://", "https://"].includes(profile.default_protocol)) {
    throw new UsageError("INVALID_CONFIG", `${source}.default_protocol must be http:// or https://`);
  }
  if (profile.endpoint)
    validateEndpoint(profile.endpoint);
  rejectUnknownKeys(
    profile,
    ["schema_version", "zone", "endpoint", "identity", "default_protocol", "output"],
    source
  );
}
function rejectUnknownKeys(value, allowed, source) {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (unknown.length > 0) {
    throw new UsageError(
      "INVALID_CONFIG",
      `${source} contains unsupported fields: ${unknown.join(", ")}`
    );
  }
}
function asOutput(value, source = "BUCKYOS_TOOL_OUTPUT") {
  if (value === void 0)
    return void 0;
  if (!["json", "jsonl", "table", "text", "raw"].includes(value)) {
    throw new UsageError("INVALID_OUTPUT_FORMAT", `${source} has invalid output format: ${value}`);
  }
  return value;
}
function select(name, explicit, environment2, profile, fallback, sources) {
  if (explicit !== void 0) {
    sources[name] = "argument";
    return explicit;
  }
  if (environment2 !== void 0) {
    sources[name] = "environment";
    return environment2;
  }
  if (profile !== void 0) {
    sources[name] = "profile";
    return profile;
  }
  if (fallback !== void 0)
    sources[name] = "default";
  return fallback;
}
function sourceOf(explicit, environment2, profile, fallback) {
  return explicit !== void 0 ? "argument" : environment2 !== void 0 ? "environment" : profile !== void 0 ? "profile" : fallback;
}
function validateEndpoint(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new UsageError("INVALID_ENDPOINT", `invalid endpoint URL: ${value}`);
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new UsageError("INVALID_ENDPOINT", "endpoint must use http or https");
  }
}
function inferProtocol(endpoint) {
  if (!endpoint)
    return void 0;
  return endpoint.startsWith("http://") ? "http://" : endpoint.startsWith("https://") ? "https://" : void 0;
}
function redactUrl(value) {
  if (!value)
    return null;
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      url.username = "[REDACTED]";
      url.password = "[REDACTED]";
    }
    return url.toString();
  } catch {
    return "[INVALID_URL]";
  }
}
function configValueError(message) {
  return new ToolError("INVALID_CONFIG_VALUE", message, 2);
}
const join$2 = (...parts) => getHost().path.join(...parts);
const LOCAL_NODE_GATEWAY_ENDPOINT = "http://127.0.0.1:3180";
const IDENTITY_CANDIDATE_LIMIT = 8;
const IDENTITY_REJECTION_CODES = Object.freeze([
  "IDENTITY_KIND_NOT_ACCEPTED",
  "AUTHENTICATION_REJECTED"
]);
async function applyImplicitDeviceIdentity(config, environment2 = readEnvironment()) {
  if (config.sessionToken || config.sessionTokenFile || config.identity || config.zone || config.endpoint) {
    return config;
  }
  const device = await readCurrentDeviceIdentity(environment2);
  if (!device)
    return config;
  return {
    ...config,
    identity: device.did,
    zone: device.zoneDid,
    endpoint: LOCAL_NODE_GATEWAY_ENDPOINT,
    identityRoot: device.publicRoot,
    securityRoot: device.securityRoot,
    defaultProtocol: "http://",
    implicitDeviceIdentity: device,
    sources: {
      ...config.sources,
      identity: "current-device",
      zone: "current-device",
      endpoint: "local-node-gateway",
      identity_root: "current-device",
      security_root: "current-device"
    }
  };
}
async function readCurrentDeviceIdentity(environment2 = readEnvironment()) {
  if (getHost().policy.distribution === "developer" && environment2.BUCKYOS_ROOT === void 0)
    return void 0;
  const buckyosRoot = environment2.BUCKYOS_ROOT ?? defaultBuckyOSRoot(environment2);
  const nodeIdentityPath = join$2(buckyosRoot, "etc", "node_identity.json");
  let value;
  try {
    value = JSON.parse(await getHost().readTextFile(nodeIdentityPath));
  } catch (error) {
    if (isHostError(error, "NotFound"))
      return void 0;
    if (isHostError(error, "PermissionDenied")) {
      throw new ToolError(
        "DEVICE_IDENTITY_READ_FAILED",
        `permission denied reading current device identity: ${nodeIdentityPath}`,
        EXIT_PERMISSION
      );
    }
    throw new ToolError(
      "DEVICE_IDENTITY_READ_FAILED",
      `failed to read current device identity: ${nodeIdentityPath}`,
      EXIT_AUTH
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidDeviceIdentity(nodeIdentityPath);
  }
  const document = value;
  const did = nonEmptyString(document.device_did);
  const name = nonEmptyString(document.device_name);
  const zoneDid = nonEmptyString(document.zone_did);
  if (document.schema !== "buckyos.node_identity.v2" || !did || !name || !zoneDid) {
    throw invalidDeviceIdentity(nodeIdentityPath);
  }
  try {
    namelib.DID.fromStr(did);
    namelib.DID.fromStr(zoneDid);
  } catch {
    throw invalidDeviceIdentity(nodeIdentityPath);
  }
  return {
    did,
    name,
    zoneDid,
    buckyosRoot,
    nodeIdentityPath,
    publicRoot: join$2(buckyosRoot, "local", "identity"),
    securityRoot: join$2(buckyosRoot, "security")
  };
}
function identityRootPairs(config, environment2 = readEnvironment()) {
  const pairs = [];
  if (config.identityRoot && config.securityRoot) {
    pairs.push({
      publicRoot: config.identityRoot,
      securityRoot: config.securityRoot,
      source: "explicit"
    });
  }
  pairs.push({
    publicRoot: join$2(config.configDir, "local", "identity"),
    securityRoot: join$2(config.configDir, "security"),
    source: "tool"
  });
  if (environment2.BUCKYOS_IDENTITY_ROOT && environment2.BUCKYOS_SECURITY_ROOT) {
    const duplicate = config.identityRoot === environment2.BUCKYOS_IDENTITY_ROOT && config.securityRoot === environment2.BUCKYOS_SECURITY_ROOT;
    if (!duplicate) {
      pairs.push({
        publicRoot: environment2.BUCKYOS_IDENTITY_ROOT,
        securityRoot: environment2.BUCKYOS_SECURITY_ROOT,
        source: "environment"
      });
    }
  }
  if (getHost().policy.distribution === "system") {
    const buckyosRoot = environment2.BUCKYOS_ROOT ?? defaultBuckyOSRoot(environment2);
    pairs.push({
      publicRoot: join$2(buckyosRoot, "local", "identity"),
      securityRoot: join$2(buckyosRoot, "security"),
      source: "buckyos-root"
    });
  }
  return deduplicatePairs(pairs);
}
async function resolveIdentityMaterial(selectedIdentity, config, environment2 = readEnvironment()) {
  const selected = selectedIdentity.trim();
  if (!selected)
    throw new UsageError("IDENTITY_REQUIRED", "identity is empty");
  for (const roots of identityRootPairs(config, environment2)) {
    for (const directory of await candidateDirectories(roots.publicRoot, selected)) {
      const material = await loadIdentityMaterial(roots, directory, selected);
      if (material)
        return material;
    }
  }
  throw new ToolError(
    "IDENTITY_NOT_FOUND",
    `no usable authentication material found for identity ${selected}`,
    EXIT_AUTH
  );
}
async function scanIdentityCandidates(config, environment2 = readEnvironment()) {
  const candidates = [];
  const skipped = [];
  const seen = /* @__PURE__ */ new Set();
  const roots = identityRootPairs(config, environment2);
  for (const pair of roots) {
    let directories;
    try {
      directories = await candidateDirectories(pair.publicRoot, "");
    } catch (error) {
      if (isHostError(error, "PermissionDenied")) {
        skipped.push({ source: pair.source, path: pair.publicRoot, reason: "policy-denied" });
        continue;
      }
      throw error;
    }
    for (const directory of directories) {
      if (candidates.length >= IDENTITY_CANDIDATE_LIMIT)
        break;
      const documentPath = join$2(pair.publicRoot, directory, "did.json");
      try {
        const material = await loadIdentityMaterial(pair, directory);
        if (!material) {
          skipped.push({ source: pair.source, path: documentPath, reason: "not-usable" });
          continue;
        }
        if (seen.has(material.did)) {
          skipped.push({
            source: pair.source,
            identity: material.did,
            path: documentPath,
            reason: "duplicate"
          });
          continue;
        }
        seen.add(material.did);
        candidates.push({ material, source: pair.source, directory });
      } catch (error) {
        if (isHostError(error, "PermissionDenied")) {
          skipped.push({ source: pair.source, path: documentPath, reason: "policy-denied" });
          continue;
        }
        if (error instanceof ToolError && error.code === "IDENTITY_KEYREF_UNSUPPORTED") {
          skipped.push({
            source: pair.source,
            identity: typeof error.details.identity === "string" ? error.details.identity : void 0,
            path: documentPath,
            reason: "key-reference-unsupported"
          });
          continue;
        }
        throw error;
      }
    }
    if (candidates.length >= IDENTITY_CANDIDATE_LIMIT)
      break;
  }
  return {
    order: Object.freeze(["explicit", "tool", "environment", "buckyos-root"]),
    limit: IDENTITY_CANDIDATE_LIMIT,
    candidates,
    skipped
  };
}
async function identityCandidateView(config, environment2 = readEnvironment()) {
  if (config.identity) {
    try {
      const material = await resolveIdentityMaterial(config.identity, config, environment2);
      return {
        mode: "explicit",
        order: [material.did],
        limit: 1,
        candidates: [{
          identity: material.did,
          source: config.sources.identity ?? "explicit",
          document_path: material.documentPath
        }],
        skipped: []
      };
    } catch (error) {
      return {
        mode: "explicit",
        order: [config.identity],
        limit: 1,
        candidates: [],
        skipped: [{
          identity: config.identity,
          reason: error instanceof ToolError ? error.code : "unavailable"
        }]
      };
    }
  }
  const scan = await scanIdentityCandidates(config, environment2);
  return {
    mode: "search",
    order: scan.order,
    limit: scan.limit,
    candidates: scan.candidates.map((candidate) => ({
      identity: candidate.material.did,
      source: candidate.source,
      document_path: candidate.material.documentPath
    })),
    skipped: scan.skipped
  };
}
async function loadIdentityMaterial(roots, directory, selected) {
  const documentPath = join$2(roots.publicRoot, directory, "did.json");
  const document = await readIdentityDocument(documentPath);
  if (!document || selected && !identityMatches(document, selected))
    return void 0;
  const did = typeof document.id === "string" ? document.id : "";
  const subject = typeof document.name === "string" && document.name.trim() ? document.name.trim() : did;
  if (!did || !subject)
    return void 0;
  const privateKeyPath = join$2(roots.securityRoot, directory, "authentication.private.pem");
  try {
    const privateKeyPem = (await getHost().readTextFile(privateKeyPath)).trim();
    if (!privateKeyPem)
      return void 0;
    return {
      did,
      subject,
      issuer: subject,
      principalKind: typeof document.device_type === "string" ? "device" : "user",
      publicRoot: roots.publicRoot,
      securityRoot: roots.securityRoot,
      documentPath,
      privateKeyPath,
      privateKeyPem
    };
  } catch (error) {
    if (!isHostError(error, "NotFound"))
      throw error;
  }
  const keyrefPath = join$2(roots.securityRoot, directory, "authentication.keyref.json");
  try {
    await getHost().stat(keyrefPath);
    throw new ToolError(
      "IDENTITY_KEYREF_UNSUPPORTED",
      "the selected identity uses a key reference unsupported by this runtime",
      EXIT_AUTH,
      false,
      { identity: did, keyref_path: keyrefPath }
    );
  } catch (error) {
    if (!isHostError(error, "NotFound"))
      throw error;
  }
  return void 0;
}
async function candidateDirectories(publicRoot, identity) {
  if (identity.startsWith("did:")) {
    try {
      return [namelib.DID.fromStr(identity).toFilename()];
    } catch {
      throw new UsageError("INVALID_IDENTITY", `invalid DID: ${identity}`);
    }
  }
  const directories = [];
  try {
    for (const entry of await getHost().readDir(publicRoot)) {
      if (entry.isDirectory)
        directories.push(entry.name);
    }
  } catch (error) {
    if (isHostError(error, "NotFound"))
      return [];
    throw error;
  }
  return directories.sort();
}
async function readIdentityDocument(path) {
  try {
    const value = JSON.parse(await getHost().readTextFile(path));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch (error) {
    if (isHostError(error, "NotFound") || error instanceof SyntaxError)
      return null;
    throw error;
  }
}
function identityMatches(document, selected) {
  if (typeof document.id === "string" && document.id === selected)
    return true;
  return typeof document.name === "string" && document.name === selected;
}
function defaultBuckyOSRoot(environment2 = readEnvironment()) {
  if (getHost().platform === "windows") {
    const appData = environment2.APPDATA;
    return appData ? join$2(appData, "buckyos") : "C:\\BuckyOS";
  }
  return "/opt/buckyos";
}
function invalidDeviceIdentity(path) {
  return new ToolError(
    "INVALID_DEVICE_IDENTITY",
    `current device identity is invalid: ${path}`,
    EXIT_AUTH
  );
}
function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : void 0;
}
function deduplicatePairs(pairs) {
  const seen = /* @__PURE__ */ new Set();
  return pairs.filter((pair) => {
    const key = `${pair.publicRoot}\0${pair.securityRoot}`;
    if (seen.has(key))
      return false;
    seen.add(key);
    return true;
  });
}
class BuckyOSRuntimeAdapter {
  #sdk = new BuckyOSSDK("node");
  async initialize(config, session) {
    const authenticated = session.current();
    const zoneHost = resolveZoneHost(config);
    const initialize = this.#sdk.initBuckyOS;
    await initialize.call(this.#sdk, authenticated.principal.appId, {
      appId: authenticated.principal.appId,
      ownerUserId: authenticated.principal.id,
      runtimeType: RuntimeType.AppClient,
      zoneHost,
      defaultProtocol: config.defaultProtocol,
      sessionToken: authenticated.token,
      privateKeySearchPaths: [],
      autoRenew: false,
      verifyHubServiceUrl: resolveServiceUrl(config, "verify-hub")
    });
    return {
      zone: config.zone ?? zoneHost,
      endpoint: config.endpoint ?? `${config.defaultProtocol}${zoneHost}`,
      defaultProtocol: config.defaultProtocol
    };
  }
}
class BuckyOSServiceClientRegistry {
  #config;
  #session;
  #clients = /* @__PURE__ */ new Map();
  constructor(config, session) {
    this.#config = config;
    this.#session = session;
  }
  async call(service, method, params, options) {
    let client = this.#clients.get(service);
    if (!client) {
      const RpcClient = buckyos.kRPCClient;
      client = new RpcClient(resolveServiceUrl(this.#config, service), null, null, {
        sessionTokenProvider: async () => (await this.#session.ensureValid()).token
      });
      this.#clients.set(service, client);
    }
    const request = client.call(method, params, { traceId: options.traceId });
    return await withDeadline(request, options.timeoutMs, options.signal);
  }
  async createEventReader(pattern, signal) {
    return await buckyos.createEventReader(pattern, { keepaliveMs: 5e3, signal });
  }
}
class InteractiveSession {
  constructor(authentication, clients, connection) {
    this.authentication = authentication;
    this.clients = clients;
    this.connection = connection;
    this.startedAt = Date.now();
  }
  static async create(config, authentication, runtime = new BuckyOSRuntimeAdapter(), clients) {
    await authentication.connect();
    const connection = await runtime.initialize(config, authentication);
    return new InteractiveSession(
      authentication,
      clients ?? new BuckyOSServiceClientRegistry(config, authentication),
      connection
    );
  }
  async reconnect() {
    await this.authentication.reconnect();
  }
}
function resolveServiceUrl(config, service) {
  if (config.endpoint) {
    const endpoint = new URL(config.endpoint);
    const marker = endpoint.pathname.indexOf("/kapi/");
    if (marker >= 0)
      endpoint.pathname = `${endpoint.pathname.slice(0, marker)}/kapi/${service}`;
    else if (endpoint.pathname.endsWith("/kapi")) {
      endpoint.pathname = `${endpoint.pathname}/${service}`;
    } else
      endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "")}/kapi/${service}`;
    endpoint.search = "";
    endpoint.hash = "";
    return endpoint.toString().replace(/\/$/, "");
  }
  const host2 = resolveZoneHost(config);
  return `${config.defaultProtocol}${host2}/kapi/${service}`;
}
function resolveZoneHost(config) {
  if (config.zone) {
    try {
      return namelib.DID.fromStr(config.zone).toRawHostName();
    } catch {
      throw new UsageError("INVALID_ZONE", `invalid zone host or DID: ${config.zone}`);
    }
  }
  if (config.endpoint)
    return new URL(config.endpoint).host;
  throw new UsageError("CONNECTION_REQUIRED", "an endpoint or zone is required for online commands");
}
async function withDeadline(promise, timeoutMs, signal) {
  if (signal?.aborted)
    throw new ToolError("CANCELED", "operation canceled", 8);
  let timer;
  let abortHandler;
  const guards = [
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new ToolError("TIMEOUT", "operation timed out", 8, true)),
        timeoutMs
      );
    })
  ];
  if (signal) {
    guards.push(
      new Promise((_, reject) => {
        abortHandler = () => reject(new ToolError("CANCELED", "operation canceled", 8));
        signal.addEventListener("abort", abortHandler, { once: true });
      })
    );
  }
  try {
    return await Promise.race([promise, ...guards]);
  } finally {
    if (timer !== void 0)
      clearTimeout(timer);
    if (signal && abortHandler)
      signal.removeEventListener("abort", abortHandler);
  }
}
const LOGIN_APP_ID = "buckycli";
const LOGIN_TOKEN_TTL_SECONDS = 10 * 60;
class AuthenticationSession {
  constructor(config, environment2 = readEnvironment(), dependencies = {}) {
    this.#identityAttempts = [];
    this.config = config;
    this.#environment = environment2;
    this.#transport = dependencies.transport ?? new SdkAuthenticationTransport();
    this.#readPassword = dependencies.readPassword ?? readSecret;
    this.#readUsername = dependencies.readUsername ?? readVisible;
    this.#now = dependencies.now ?? Date.now;
  }
  #environment;
  #transport;
  #readPassword;
  #readUsername;
  #now;
  #session;
  #acceptedIdentity;
  #identityAttempts;
  async connect() {
    if (this.#session)
      return this.#session;
    this.#session = await this.#authenticate(false);
    return this.#session;
  }
  async ensureValid() {
    const session = await this.connect();
    const exp = numberClaim(session.claims.exp);
    const nowSeconds = Math.floor(this.#now() / 1e3);
    if (exp === void 0 || exp > nowSeconds + 15)
      return session;
    if (!session.renewable) {
      throw new ToolError(
        "SESSION_EXPIRED",
        "the externally supplied session token has expired",
        EXIT_AUTH
      );
    }
    this.#session = await this.#authenticate(true);
    return this.#session;
  }
  async reconnect() {
    this.#session = await this.#authenticate(true);
    return this.#session;
  }
  current() {
    if (!this.#session) {
      throw new ToolError("AUTH_REQUIRED", "session is not initialized", EXIT_AUTH);
    }
    return this.#session;
  }
  status() {
    const session = this.current();
    const expiresAt = session.principal.tokenExpiresAt;
    const exp = numberClaim(session.claims.exp);
    const remainingSeconds = exp === void 0 ? null : Math.max(0, exp - Math.floor(this.#now() / 1e3));
    return {
      authenticated: true,
      principal: session.principal.id,
      appid: session.principal.appId,
      app_instance_id: session.principal.appInstanceId ?? null,
      authentication: session.principal.authentication,
      renewable: session.renewable,
      expires_at: expiresAt ?? null,
      remaining_seconds: remainingSeconds,
      identity_attempts: this.#identityAttempts
    };
  }
  async #authenticate(reconnect) {
    if (this.config.sessionToken) {
      const source = this.config.sources.session_token === "environment" ? "environment" : "session-token";
      return externalSession(this.config.sessionToken, source, this.#now());
    }
    if (this.config.sessionTokenFile) {
      let token2;
      try {
        token2 = (await getHost().readTextFile(this.config.sessionTokenFile)).trim();
      } catch (error) {
        throw new ToolError(
          "SESSION_TOKEN_FILE_ERROR",
          `failed to read session token file: ${error instanceof Error ? error.message : String(error)}`,
          EXIT_AUTH
        );
      }
      if (!token2) {
        throw new ToolError("INVALID_SESSION_TOKEN", "session token file is empty", EXIT_AUTH);
      }
      return externalSession(token2, "session-token-file", this.#now());
    }
    const injected = this.#environment.BUCKYOS_APPCLIENT_SESSION_TOKEN?.trim();
    if (injected)
      return externalSession(injected, "environment", this.#now());
    if (this.#acceptedIdentity)
      return await this.#loginWithIdentity(this.#acceptedIdentity);
    if (this.config.identity) {
      const material = await resolveIdentityMaterial(
        this.config.identity,
        this.config,
        this.#environment
      );
      const session = await this.#loginWithIdentity(material);
      this.#acceptedIdentity = material;
      return session;
    }
    const candidates = await scanIdentityCandidates(this.config, this.#environment);
    this.#identityAttempts = [];
    for (const candidate of candidates.candidates) {
      try {
        const session = await this.#loginWithIdentity(candidate.material);
        this.#acceptedIdentity = candidate.material;
        return session;
      } catch (error) {
        if (!isIdentityRejection(error))
          throw error;
        this.#identityAttempts.push({
          identity: candidate.material.did,
          code: error.code,
          message: sanitizeMessage(error.message)
        });
      }
    }
    if (this.#identityAttempts.length > 0) {
      throw new ToolError(
        "IDENTITY_CANDIDATES_REJECTED",
        `all ${this.#identityAttempts.length} identity candidates were rejected`,
        EXIT_AUTH,
        false,
        { attempts: this.#identityAttempts }
      );
    }
    if (this.config.nonInteractive) {
      throw new ToolError(
        "AUTH_REQUIRED",
        "no session token or usable identity is available in non-interactive mode",
        EXIT_AUTH
      );
    }
    const username = this.config.identity?.startsWith("did:") ? await this.#readUsername("Username: ") : this.config.identity ?? await this.#readUsername("Username: ");
    if (!username.trim())
      throw new ToolError("AUTH_REQUIRED", "username is required", EXIT_AUTH);
    const password = await this.#readPassword(reconnect ? "Password (reconnect): " : "Password: ");
    const token = await this.#transport.loginByPassword(
      resolveServiceUrl(this.config, "verify-hub"),
      username.trim(),
      password,
      appAuthTarget(username.trim()),
      this.config.timeoutMs
    );
    return authenticatedSession(token, "password", true, this.#now());
  }
  async #loginWithIdentity(material) {
    const loginJwt = await createLoginJwt(
      material.subject,
      material.issuer,
      material.privateKeyPem,
      this.#now()
    );
    const token = await this.#transport.loginByJwt(
      resolveServiceUrl(this.config, "verify-hub"),
      loginJwt,
      identityAuthTarget(material.principalKind, material.subject),
      this.config.timeoutMs
    );
    return authenticatedSession(token, "identity", true, this.#now());
  }
}
function isIdentityRejection(error) {
  return error instanceof ToolError && IDENTITY_REJECTION_CODES.includes(error.code);
}
class SdkAuthenticationTransport {
  async loginByJwt(url, jwt, target, timeoutMs) {
    const client = new buckyos.kRPCClient(url);
    const response = await withLocalTimeout(
      new VerifyHubClient(client).loginByJwt({ jwt, target }),
      timeoutMs
    );
    if (!response.session_token)
      throw new Error("verify-hub returned no session token");
    return response.session_token;
  }
  async loginByPassword(url, username, password, target, timeoutMs) {
    const client = new buckyos.kRPCClient(url);
    const verifyHub = new VerifyHubClient(client);
    const nonce = Date.now();
    verifyHub.setSeq(nonce);
    const response = await withLocalTimeout(
      verifyHub.loginByPassword({
        username,
        password: buckyos.hashPassword(username, password, nonce),
        target,
        login_nonce: nonce
      }),
      timeoutMs
    );
    const normalized = VerifyHubClient.normalizeLoginResponse(response);
    if (!normalized.session_token)
      throw new Error("verify-hub returned no session token");
    return normalized.session_token;
  }
}
function identityAuthTarget(principalKind, subject) {
  return principalKind === "device" ? { kind: "system", service_id: LOGIN_APP_ID } : appAuthTarget(subject);
}
function appAuthTarget(ownerUserId) {
  return {
    kind: "app",
    app_instance_id: createAppInstanceId(LOGIN_APP_ID, ownerUserId)
  };
}
function authenticatedSession(token, authentication, renewable, nowMs = Date.now()) {
  const claims = parseClaims(token);
  const exp = numberClaim(claims.exp);
  const nowSeconds = Math.floor(nowMs / 1e3);
  if (exp !== void 0 && exp <= nowSeconds) {
    throw new ToolError("SESSION_EXPIRED", "the session token has expired", EXIT_AUTH);
  }
  const id = stringClaim(claims.sub) ?? stringClaim(claims.userid);
  const appId = stringClaim(claims.appid) ?? stringClaim(claims.aud);
  if (!id || !appId) {
    throw new ToolError(
      "INVALID_SESSION_TOKEN",
      "session token is missing principal or appid claims",
      EXIT_AUTH
    );
  }
  const appInstanceId = stringClaim(claims.app_instance_id) ?? stringClaim(claims.extra?.app_instance_id);
  return {
    token,
    claims,
    renewable,
    principal: {
      id,
      appId,
      appInstanceId,
      authentication,
      tokenExpiresAt: exp === void 0 ? void 0 : new Date(exp * 1e3).toISOString()
    }
  };
}
function externalSession(token, authentication, nowMs) {
  return authenticatedSession(token, authentication, false, nowMs);
}
function parseClaims(token) {
  const claims = parseSessionTokenClaims(token);
  if (!claims) {
    throw new ToolError("INVALID_SESSION_TOKEN", "session token is not a valid JWT", EXIT_AUTH);
  }
  return claims;
}
async function createLoginJwt(subject, issuer, privateKeyPem, nowMs) {
  const now = Math.floor(nowMs / 1e3);
  const header = { alg: "EdDSA", kid: issuer, typ: "JWT" };
  const payload = {
    token_type: "Normal",
    appid: LOGIN_APP_ID,
    jti: crypto.randomUUID(),
    session: now,
    sub: subject,
    userid: subject,
    iss: issuer,
    exp: now + LOGIN_TOKEN_TTL_SECONDS,
    sudo: false,
    extra: {}
  };
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const keyBytes = pemBytes(privateKeyPem);
  let key;
  try {
    key = await crypto.subtle.importKey(
      "pkcs8",
      keyBytes.slice().buffer,
      { name: "Ed25519" },
      false,
      ["sign"]
    );
  } catch {
    throw new ToolError(
      "INVALID_PRIVATE_KEY",
      "identity authentication key is not a valid Ed25519 PKCS8 key",
      EXIT_AUTH
    );
  }
  const signature = await crypto.subtle.sign("Ed25519", key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
}
function pemBytes(pem) {
  const encoded = pem.replace(/-----[^-]+-----/g, "").replaceAll(/\s/g, "");
  const binary = atob(encoded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
function base64Url(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes)
    binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function stringClaim(value) {
  return typeof value === "string" && value.trim() ? value.trim() : void 0;
}
function numberClaim(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
async function withLocalTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new ToolError("TIMEOUT", "authentication timed out", 8, true)),
      timeoutMs
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== void 0)
      clearTimeout(timer);
  }
}
async function readVisible(prompt) {
  return (await getHost().readLine(prompt))?.trim() ?? "";
}
async function readSecret(prompt) {
  if (!getHost().inputIsTerminal()) {
    throw new ToolError(
      "INTERACTIVE_AUTH_UNAVAILABLE",
      "password input requires a terminal",
      EXIT_AUTH
    );
  }
  try {
    return await getHost().readSecret(prompt);
  } catch (error) {
    throw new ToolError(
      "INTERACTIVE_AUTH_UNAVAILABLE",
      error instanceof Error ? error.message : String(error),
      EXIT_AUTH
    );
  }
}
function successEnvelope(data, meta) {
  return { schema_version: 1, ok: true, data, meta };
}
function errorEnvelope(error, meta) {
  return {
    schema_version: 1,
    ok: false,
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      details: error.details
    },
    meta
  };
}
function renderSuccess(envelope, format) {
  if (format === "json" || format === "jsonl")
    return JSON.stringify(envelope);
  if (format === "raw") {
    if (typeof envelope.data !== "string")
      throw new Error("raw output requires a string result");
    return envelope.data;
  }
  if (format === "text")
    return renderText(envelope.data);
  return renderTable(envelope.data);
}
function renderError(envelope, format) {
  if (format === "json" || format === "jsonl" || format === "raw")
    return JSON.stringify(envelope);
  const retryable = envelope.error.retryable ? " (retryable)" : "";
  return `${envelope.error.code}${retryable}: ${envelope.error.message}`;
}
function renderText(data) {
  if (typeof data === "string")
    return data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const object = data;
    if (typeof object.script === "string")
      return object.script;
    if (typeof object.text === "string")
      return object.text;
  }
  return JSON.stringify(data, null, 2);
}
function renderTable(data) {
  if (Array.isArray(data))
    return renderRows(data);
  if (data && typeof data === "object") {
    const object = data;
    const arrayEntry = Object.entries(object).find(([, value]) => Array.isArray(value));
    if (arrayEntry)
      return renderRows(arrayEntry[1]);
    const rows = Object.entries(object).map(([key, value]) => ({ key, value: displayValue(value) }));
    return renderRows(rows);
  }
  return String(data ?? "");
}
function renderRows(rows) {
  if (rows.length === 0)
    return "(empty)";
  const objects = rows.map(
    (row) => row && typeof row === "object" && !Array.isArray(row) ? row : { value: row }
  );
  const columns = [...new Set(objects.flatMap((row) => Object.keys(row)))];
  const rendered = objects.map((row) => columns.map((column) => displayValue(row[column])));
  const widths = columns.map(
    (column, index) => Math.max(column.length, ...rendered.map((row) => row[index].length))
  );
  const header = columns.map((column, index) => column.padEnd(widths[index])).join("  ");
  const separator = widths.map((width) => "-".repeat(width)).join("  ");
  const body = rendered.map(
    (row) => row.map((value, index) => value.padEnd(widths[index])).join("  ")
  );
  return [header, separator, ...body].join("\n");
}
function displayValue(value) {
  if (value === null || value === void 0)
    return "";
  if (typeof value === "string")
    return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return JSON.stringify(value);
}
const KEBAB_CASE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const GLOBAL_OPTIONS = [
  { name: "config-dir", property: "configDir", type: "string", scope: "process" },
  {
    name: "allow-read",
    property: "allowRead",
    type: "string",
    scope: "process",
    repeatable: true
  },
  { name: "profile", property: "profile", type: "string", scope: "session" },
  { name: "zone", property: "zone", type: "string", scope: "session" },
  { name: "endpoint", property: "endpoint", type: "string", scope: "session" },
  { name: "identity", property: "identity", type: "string", scope: "session" },
  { name: "identity-root", property: "identityRoot", type: "string", scope: "session" },
  { name: "security-root", property: "securityRoot", type: "string", scope: "session" },
  {
    name: "session-token",
    property: "sessionToken",
    type: "string",
    scope: "session",
    secret: true
  },
  {
    name: "session-token-file",
    property: "sessionTokenFile",
    type: "string",
    scope: "session",
    secret: true
  },
  { name: "cli", property: "cli", type: "boolean", scope: "process" },
  {
    name: "output",
    property: "output",
    type: "string",
    scope: "command",
    enum: ["json", "jsonl", "table", "text", "raw"]
  },
  { name: "input", property: "input", type: "string", scope: "command" },
  { name: "timeout", property: "timeout", type: "duration", scope: "command" },
  { name: "trace-id", property: "traceId", type: "string", scope: "command" },
  {
    name: "idempotency-key",
    property: "idempotencyKey",
    type: "string",
    scope: "command"
  },
  { name: "wait", property: "wait", type: "boolean", scope: "command" },
  {
    name: "non-interactive",
    property: "nonInteractive",
    type: "boolean",
    scope: "process"
  },
  { name: "yes", property: "yes", type: "boolean", scope: "command" },
  { name: "no-color", property: "noColor", type: "boolean", scope: "process" },
  { name: "verbose", property: "verbose", type: "boolean", scope: "process" },
  { name: "help", property: "help", type: "boolean", scope: "process" },
  { name: "version", property: "version", type: "boolean", scope: "process" }
];
const REPL_COMMAND_OPTION_NAMES = /* @__PURE__ */ new Set([
  "output",
  "input",
  "timeout",
  "trace-id",
  "idempotency-key",
  "wait",
  "yes"
]);
class CommandRegistry {
  #modules = /* @__PURE__ */ new Map();
  #commands = /* @__PURE__ */ new Map();
  register(module) {
    if (!KEBAB_CASE.test(module.name)) {
      throw new Error(`invalid module name: ${module.name}`);
    }
    if (this.#modules.has(module.name)) {
      throw new Error(`duplicate module: ${module.name}`);
    }
    for (const definition of module.commands) {
      this.#validateDefinition(module.name, definition);
      const key = `${module.name}.${definition.verb}`;
      if (this.#commands.has(key))
        throw new Error(`duplicate command: ${key}`);
      this.#commands.set(key, {
        ...definition,
        module: module.name,
        moduleSummary: module.summary
      });
    }
    this.#modules.set(module.name, module);
  }
  get(module, verb) {
    const command = this.#commands.get(`${module}.${verb}`);
    if (!command) {
      if (!this.#modules.has(module)) {
        throw new UsageError("UNKNOWN_MODULE", `unknown module: ${module}`);
      }
      throw new UsageError("UNKNOWN_COMMAND", `unknown command: ${module} ${verb}`);
    }
    return command;
  }
  modules() {
    return [...this.#modules.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  commands() {
    return [...this.#commands.values()].sort(
      (a, b) => `${a.module}.${a.verb}`.localeCompare(`${b.module}.${b.verb}`)
    );
  }
  describe(module, verb) {
    const command = this.get(module, verb);
    return {
      schema_version: 1,
      module: command.module,
      verb: command.verb,
      summary: command.summary,
      description: command.description ?? command.summary,
      syntax: this.syntax(command),
      global_options: GLOBAL_OPTIONS,
      repl_command_options: GLOBAL_OPTIONS.filter(
        (option) => REPL_COMMAND_OPTION_NAMES.has(option.name)
      ),
      positionals: command.positionals ?? [],
      options: (command.options ?? []).map((option) => ({
        ...option,
        property: optionProperty(option)
      })),
      input_schema: command.inputSchema,
      output_schema: command.outputSchema,
      result_schema_version: command.resultSchemaVersion,
      access: command.access,
      async_mode: command.asyncMode,
      requires_session: command.requiresSession,
      execution: command.execution ?? (command.requiresSession ? "service" : "local"),
      network_access: command.networkAccess ?? command.requiresSession,
      examples: command.examples ?? []
    };
  }
  syntax(command) {
    const positionals = (command.positionals ?? []).map(
      (position) => position.required === false ? `[${position.name}]` : `<${position.name}>`
    );
    const options = (command.options ?? []).map(
      (option) => option.type === "boolean" ? `[--${option.name}]` : `[--${option.name} <${option.property ?? option.name}>]`
    );
    return ["buckyos", command.module, command.verb, ...positionals, ...options].join(" ");
  }
  completionCandidates(tokens) {
    if (tokens.length <= 1)
      return this.modules().map((module2) => module2.name);
    const module = this.#modules.get(tokens[0]);
    if (!module)
      return this.modules().map((candidate) => candidate.name);
    if (tokens.length === 2 && !tokens[1].startsWith("--")) {
      return module.commands.map((command2) => command2.verb).sort();
    }
    const verb = tokens[1];
    const command = this.#commands.get(`${module.name}.${verb}`);
    if (!command)
      return module.commands.map((candidate) => candidate.verb).sort();
    return [
      ...(command.options ?? []).map((option) => `--${option.name}`),
      "--input",
      "--timeout",
      "--trace-id",
      "--idempotency-key",
      "--output",
      "--wait",
      "--yes",
      "--help"
    ].sort();
  }
  #validateDefinition(module, definition) {
    if (!KEBAB_CASE.test(definition.verb)) {
      throw new Error(`invalid verb name: ${module} ${definition.verb}`);
    }
    const positionals = definition.positionals ?? [];
    const positionalNames = /* @__PURE__ */ new Set();
    for (const positional of positionals) {
      if (positionalNames.has(positional.name)) {
        throw new Error(`duplicate positional ${positional.name} in ${module}.${definition.verb}`);
      }
      positionalNames.add(positional.name);
    }
    const optionNames = /* @__PURE__ */ new Set();
    for (const option of definition.options ?? []) {
      if (!KEBAB_CASE.test(option.name) || optionNames.has(option.name)) {
        throw new Error(
          `invalid or duplicate option --${option.name} in ${module}.${definition.verb}`
        );
      }
      optionNames.add(option.name);
    }
    this.#assertObjectSchema(definition.inputSchema, `${module}.${definition.verb} input`);
    this.#assertObjectSchema(definition.outputSchema, `${module}.${definition.verb} output`);
  }
  #assertObjectSchema(schema, label) {
    if (schema.type !== "object")
      throw new Error(`${label} schema must be an object`);
  }
}
const SECRET_WORDS = /(?:session[-_]?token|refresh[-_]?token|password|private[-_]?key|sudo[-_]?token)/i;
class ReplHistory {
  constructor(path, limit = 500) {
    this.#entries = [];
    this.path = path;
    this.limit = limit;
  }
  #entries;
  async load() {
    try {
      this.#entries = (await getHost().readTextFile(this.path)).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-this.limit);
    } catch (error) {
      if (!isHostError(error, "NotFound"))
        throw error;
      this.#entries = [];
    }
    return [...this.#entries];
  }
  entries() {
    return [...this.#entries];
  }
  async add(line, command) {
    if (!shouldPersistHistory(line, command))
      return;
    if (this.#entries.at(-1) !== line)
      this.#entries.push(line);
    this.#entries = this.#entries.slice(-this.limit);
    const host2 = getHost();
    await host2.mkdir(host2.path.dirname(this.path), { recursive: true, mode: 448 });
    await host2.writeTextFile(this.path, `${this.#entries.join("\n")}
`, { mode: 384 });
    if (host2.platform !== "windows")
      await host2.chmod(this.path, 384);
  }
}
function shouldPersistHistory(line, command) {
  if (SECRET_WORDS.test(line))
    return false;
  if (!command)
    return true;
  if (Object.values(command.inputSchema.properties ?? {}).some((schema) => schema.secret)) {
    return false;
  }
  let tokens;
  try {
    tokens = parseShellLine(line);
  } catch {
    return false;
  }
  const secretOptions = new Set(
    (command.options ?? []).filter((option) => option.secret).flatMap((option) => [
      `--${option.name}`,
      optionProperty(option)
    ])
  );
  return !tokens.some((token) => secretOptions.has(token.split("=", 1)[0]));
}
async function runRepl(options) {
  const history = new ReplHistory(options.configStore.historyPath());
  const savedHistory = await history.load();
  const completer = (line) => {
    const fragment = line.match(/[^\s]*$/)?.[0] ?? "";
    const prefix = line.slice(0, line.length - fragment.length);
    let tokens;
    try {
      tokens = parseShellLine(prefix);
    } catch {
      tokens = prefix.trim().split(/\s+/).filter(Boolean);
    }
    tokens.push(fragment);
    const candidates = options.registry.completionCandidates(tokens);
    return [candidates.filter((candidate) => candidate.startsWith(fragment)), fragment];
  };
  let running;
  const readline = getHost().createLineReader({
    history: [...savedHistory].reverse(),
    historySize: history.limit,
    completer,
    onSigint: () => {
      if (running)
        running.abort();
      else {
        readline.write("^C\n");
        readline.prompt();
      }
    }
  });
  const prompt = replPrompt(options.config);
  readline.write("BuckyOS interactive session. Use :help for commands and :exit to quit.\n");
  readline.setPrompt(prompt);
  readline.prompt();
  try {
    for await (const rawLine of readline) {
      const line = rawLine.trim();
      if (!line) {
        readline.prompt();
        continue;
      }
      if (line.startsWith(":")) {
        const shouldExit = await handleBuiltin(line, options, history);
        if (shouldExit)
          break;
        readline.prompt();
        continue;
      }
      let tokens;
      try {
        tokens = parseShellLine(line);
      } catch (error) {
        const normalized = normalizeError(error);
        readline.write(`${normalized.code}: ${normalized.message}
`);
        readline.prompt();
        continue;
      }
      let command;
      try {
        if (tokens.length >= 2)
          command = options.registry.get(tokens[0], tokens[1]);
      } catch {
        command = void 0;
      }
      await history.add(line, command);
      running = new AbortController();
      try {
        await options.execute(tokens, running.signal);
      } catch (error) {
        const normalized = normalizeError(error);
        readline.write(`${normalized.code}: ${normalized.message}
`);
      } finally {
        running = void 0;
      }
      readline.prompt();
    }
  } finally {
    readline.close();
  }
}
async function handleBuiltin(line, options, history) {
  const command = line.split(/\s+/, 1)[0];
  switch (command) {
    case ":exit":
    case ":quit":
      return true;
    case ":help":
      await getHost().stderr(
        [
          "Enter: <module> <verb> [primary-selector] [action-options]",
          "Built-ins: :help :context :session :history :reconnect :exit :quit",
          `Modules: ${options.registry.modules().map((module) => module.name).join(", ")}`,
          ""
        ].join("\n")
      );
      break;
    case ":context":
      await getHost().stderr(`${JSON.stringify(effectiveConfigView(options.config), null, 2)}
`);
      break;
    case ":session":
      await getHost().stderr(
        `${JSON.stringify(options.session.authentication.status(), null, 2)}
`
      );
      break;
    case ":history":
      await getHost().stderr(
        `${history.entries().map((entry, index) => `${index + 1}  ${entry}`).join("\n")}
`
      );
      break;
    case ":reconnect":
      try {
        await options.session.reconnect();
        await getHost().stderr("session reconnected\n");
      } catch (error) {
        const normalized = normalizeError(error);
        await getHost().stderr(`${normalized.code}: ${normalized.message}
`);
      }
      break;
    default:
      await getHost().stderr(`unknown REPL command: ${command}
`);
  }
  return false;
}
function replPrompt(config) {
  const profile = config.profileName ?? "default";
  const zone = config.zone ?? (config.endpoint ? new URL(config.endpoint).host : "unresolved");
  const identity = config.identity ?? "external-session";
  return `buckyos[${profile}|${zone}|${identity}]> `;
}
const EMPTY_INPUT$1 = { type: "object", properties: {}, additionalProperties: false };
const OBJECT_OUTPUT$7 = { type: "object", additionalProperties: true };
function createAuthModule() {
  return {
    name: "auth",
    summary: "Inspect the current authenticated session",
    commands: [
      {
        verb: "whoami",
        summary: "Show the effective principal and application identity",
        inputSchema: EMPTY_INPUT$1,
        outputSchema: OBJECT_OUTPUT$7,
        resultSchemaVersion: 1,
        access: { mode: "fixed", level: "read" },
        asyncMode: "sync",
        requiresSession: true,
        examples: ["buckyos --profile production auth whoami"],
        handler: (ctx) => Promise.resolve({
          principal: ctx.principal.id,
          appid: ctx.principal.appId,
          app_instance_id: ctx.principal.appInstanceId ?? null,
          authentication: ctx.principal.authentication,
          zone: ctx.connection.zone
        })
      },
      {
        verb: "session-status",
        summary: "Show the in-memory session state without exposing credentials",
        inputSchema: EMPTY_INPUT$1,
        outputSchema: OBJECT_OUTPUT$7,
        resultSchemaVersion: 1,
        access: { mode: "fixed", level: "read" },
        asyncMode: "sync",
        requiresSession: true,
        examples: ["buckyos --profile production auth session-status"],
        handler: (ctx) => {
          if (!ctx.session) {
            throw new ToolError("INTERNAL_ERROR", "authenticated session is unavailable", 9);
          }
          return Promise.resolve(ctx.session.status());
        }
      }
    ]
  };
}
const EMPTY_INPUT = {
  type: "object",
  properties: {},
  additionalProperties: false
};
const OBJECT_OUTPUT$6 = { type: "object", additionalProperties: true };
function createCoreModules(registry) {
  return [createCommandModule(registry), createConfigModule(), createCompletionModule(registry)];
}
function createCommandModule(registry) {
  return {
    name: "command",
    summary: "Discover the machine-readable command registry",
    commands: [
      {
        verb: "list",
        summary: "List registered modules and commands",
        inputSchema: EMPTY_INPUT,
        outputSchema: OBJECT_OUTPUT$6,
        resultSchemaVersion: 1,
        access: { mode: "fixed", level: "read" },
        asyncMode: "sync",
        requiresSession: false,
        examples: ["buckyos command list"],
        handler: () => Promise.resolve({
          modules: registry.modules().map((module) => ({
            name: module.name,
            summary: module.summary,
            commands: module.commands.map((command) => ({
              verb: command.verb,
              summary: command.summary
            }))
          }))
        })
      },
      {
        verb: "describe",
        summary: "Describe one command and its complete schemas",
        positionals: [
          { name: "target_module", description: "Module name" },
          { name: "target_verb", description: "Verb name" }
        ],
        inputSchema: {
          type: "object",
          properties: {
            target_module: { type: "string", minLength: 1 },
            target_verb: { type: "string", minLength: 1 }
          },
          required: ["target_module", "target_verb"],
          additionalProperties: false
        },
        outputSchema: OBJECT_OUTPUT$6,
        resultSchemaVersion: 1,
        access: { mode: "fixed", level: "read" },
        asyncMode: "sync",
        requiresSession: false,
        examples: ["buckyos command describe system status"],
        handler: (_ctx, input) => Promise.resolve(
          registry.describe(String(input.target_module), String(input.target_verb))
        )
      }
    ]
  };
}
function createConfigModule() {
  return {
    name: "config",
    summary: "Manage local non-secret tool configuration",
    commands: [
      {
        verb: "list",
        summary: "List the global configuration and available profiles",
        inputSchema: EMPTY_INPUT,
        outputSchema: OBJECT_OUTPUT$6,
        resultSchemaVersion: 1,
        access: { mode: "fixed", level: "read" },
        asyncMode: "sync",
        requiresSession: false,
        examples: ["buckyos config list"],
        handler: async (ctx) => ({
          config: await ctx.configStore.readConfig(),
          profiles: await ctx.configStore.listProfiles()
        })
      },
      {
        verb: "get",
        summary: "Read a global or profile configuration value",
        positionals: [{ name: "key", description: "Configuration key", required: false }],
        options: [
          {
            name: "profile-name",
            property: "profile_name",
            description: "Read a profile",
            type: "string"
          }
        ],
        inputSchema: {
          type: "object",
          properties: {
            key: { type: "string", minLength: 1 },
            profile_name: { type: "string", minLength: 1 }
          },
          additionalProperties: false
        },
        outputSchema: OBJECT_OUTPUT$6,
        resultSchemaVersion: 1,
        access: { mode: "fixed", level: "read" },
        asyncMode: "sync",
        requiresSession: false,
        examples: [
          "buckyos config get output",
          "buckyos config get zone --profile-name production"
        ],
        handler: async (ctx, input) => {
          const profileName = optionalString$3(input.profile_name);
          const value = profileName ? await ctx.configStore.readProfile(profileName) : await ctx.configStore.readConfig();
          if (!value)
            throw new UsageError("PROFILE_NOT_FOUND", `profile not found: ${profileName}`);
          const key = optionalString$3(input.key);
          if (!key)
            return { value };
          if (!Object.hasOwn(value, key)) {
            throw new UsageError("CONFIG_KEY_NOT_FOUND", `configuration key not found: ${key}`);
          }
          return { key, value: value[key] };
        }
      },
      {
        verb: "set",
        summary: "Atomically set a global or profile configuration value",
        positionals: [{ name: "key", description: "Configuration key" }],
        options: [
          { name: "value", description: "Configuration value", type: "string", required: true },
          {
            name: "profile-name",
            property: "profile_name",
            description: "Write a profile",
            type: "string"
          }
        ],
        inputSchema: {
          type: "object",
          properties: {
            key: { type: "string", minLength: 1 },
            value: { type: "string" },
            profile_name: { type: "string", minLength: 1 }
          },
          required: ["key", "value"],
          additionalProperties: false
        },
        outputSchema: OBJECT_OUTPUT$6,
        resultSchemaVersion: 1,
        access: { mode: "fixed", level: "write" },
        asyncMode: "sync",
        requiresSession: false,
        examples: [
          "buckyos config set output --value json",
          "buckyos config set zone --value corp.example.com --profile-name production"
        ],
        handler: async (ctx, input) => {
          const key = String(input.key);
          const rawValue = String(input.value);
          const profileName = optionalString$3(input.profile_name);
          if (profileName) {
            validateProfileName(profileName);
            const profile = await ctx.configStore.readProfile(profileName) ?? { schema_version: 1 };
            setProfileValue(profile, key, rawValue);
            await ctx.configStore.writeProfile(profileName, profile);
            return {
              profile: profileName,
              key,
              value: profile[key]
            };
          }
          const config = await ctx.configStore.readConfig();
          setGlobalValue(config, key, rawValue);
          await ctx.configStore.writeConfig(config);
          return { profile: null, key, value: config[key] };
        }
      },
      {
        verb: "use",
        summary: "Select the default profile",
        positionals: [{ name: "profile_name", description: "Profile name" }],
        inputSchema: {
          type: "object",
          properties: { profile_name: { type: "string", minLength: 1 } },
          required: ["profile_name"],
          additionalProperties: false
        },
        outputSchema: OBJECT_OUTPUT$6,
        resultSchemaVersion: 1,
        access: { mode: "fixed", level: "write" },
        asyncMode: "sync",
        requiresSession: false,
        examples: ["buckyos config use production"],
        handler: async (ctx, input) => {
          const profileName = String(input.profile_name);
          if (!await ctx.configStore.readProfile(profileName)) {
            throw new UsageError("PROFILE_NOT_FOUND", `profile not found: ${profileName}`);
          }
          const config = await ctx.configStore.readConfig();
          config.default_profile = profileName;
          await ctx.configStore.writeConfig(config);
          return { default_profile: profileName };
        }
      },
      {
        verb: "check",
        summary: "Validate configuration and show a redacted effective view",
        options: [
          {
            name: "effective",
            description: "Include the effective merged configuration",
            type: "boolean"
          }
        ],
        inputSchema: {
          type: "object",
          properties: { effective: { type: "boolean" } },
          additionalProperties: false
        },
        outputSchema: OBJECT_OUTPUT$6,
        resultSchemaVersion: 1,
        access: { mode: "fixed", level: "read" },
        asyncMode: "sync",
        requiresSession: false,
        examples: ["buckyos --profile production config check --effective"],
        handler: async (ctx, input) => ({
          valid: true,
          profile_count: (await ctx.configStore.listProfiles()).length,
          ...input.effective ? { effective: effectiveConfigView(ctx.config) } : {}
        })
      }
    ]
  };
}
function createCompletionModule(registry) {
  return {
    name: "completion",
    summary: "Generate shell completion scripts from the command registry",
    commands: [
      {
        verb: "generate",
        summary: "Generate completion for bash, zsh, or fish",
        options: [
          {
            name: "shell",
            description: "Target shell",
            type: "string",
            required: true,
            enum: ["bash", "zsh", "fish"]
          }
        ],
        inputSchema: {
          type: "object",
          properties: { shell: { type: "string", enum: ["bash", "zsh", "fish"] } },
          required: ["shell"],
          additionalProperties: false
        },
        outputSchema: {
          type: "object",
          properties: { shell: { type: "string" }, script: { type: "string" } },
          required: ["shell", "script"],
          additionalProperties: false
        },
        resultSchemaVersion: 1,
        access: { mode: "fixed", level: "read" },
        asyncMode: "sync",
        requiresSession: false,
        examples: ["buckyos --output text completion generate --shell bash"],
        handler: (_ctx, input) => {
          const shell = String(input.shell);
          return Promise.resolve({ shell, script: completionScript(registry, shell) });
        }
      }
    ]
  };
}
function setGlobalValue(config, key, value) {
  if (key === "default_profile") {
    validateProfileName(value);
    config.default_profile = value;
  } else if (key === "output") {
    config.output = outputValue(value);
  } else {
    throw configValueError(`unsupported global configuration key: ${key}`);
  }
}
function setProfileValue(profile, key, value) {
  if (key === "zone" || key === "endpoint" || key === "identity")
    profile[key] = value;
  else if (key === "default_protocol") {
    if (value !== "http://" && value !== "https://") {
      throw configValueError("default_protocol must be http:// or https://");
    }
    profile.default_protocol = value;
  } else if (key === "output")
    profile.output = outputValue(value);
  else
    throw configValueError(`unsupported profile configuration key: ${key}`);
}
function outputValue(value) {
  if (!["json", "jsonl", "table", "text", "raw"].includes(value)) {
    throw configValueError(`invalid output format: ${value}`);
  }
  return value;
}
function optionalString$3(value) {
  return typeof value === "string" && value ? value : void 0;
}
function completionScript(registry, shell) {
  const modules = registry.modules().map((module) => module.name).join(" ");
  const commands = registry.commands().map((command) => `${command.module}:${command.verb}`).join(
    " "
  );
  if (shell === "fish") {
    return `complete -c buckyos -f
complete -c buckyos -n '__fish_use_subcommand' -a '${modules}'
# ${commands}
`;
  }
  if (shell === "zsh") {
    return `#compdef buckyos
_arguments '1:module:(${modules})' '*::argument:->args'
# ${commands}
`;
  }
  return `_buckyos_complete() {
  if [ "${"${COMP_CWORD}"}" -eq 1 ]; then
    COMPREPLY=( $(compgen -W '${modules}' -- "${"${COMP_WORDS[COMP_CWORD]}"}") )
  fi
}
complete -F _buckyos_complete buckyos
# ${commands}
`;
}
function createSystemModule() {
  return {
    name: "system",
    summary: "Inspect BuckyOS Zone health and version state",
    commands: [
      {
        verb: "status",
        summary: "Get the Zone overview, health, services, and version",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        outputSchema: { type: "object", additionalProperties: true },
        resultSchemaVersion: 1,
        access: { mode: "fixed", level: "read" },
        asyncMode: "sync",
        requiresSession: true,
        examples: ["buckyos --profile production system status"],
        handler: async (ctx) => await ctx.clients.call(
          "control-panel",
          "system.status",
          {},
          {
            traceId: ctx.traceId,
            timeoutMs: Math.max(1, (ctx.deadline ?? Date.now()) - Date.now()),
            signal: ctx.signal
          }
        )
      }
    ]
  };
}
const SERVICE_NAME = "system_config";
const OBJECT_OUTPUT$5 = { type: "object", additionalProperties: false };
const KEY_INPUT = {
  type: "object",
  properties: { key: { type: "string", minLength: 1 } },
  required: ["key"],
  additionalProperties: false
};
function createSystemConfigModule() {
  return {
    name: "system-config",
    summary: "Read and modify the Zone system-config key-value store",
    commands: [
      {
        verb: "get",
        summary: "Get one system-config value",
        positionals: [{ name: "key", description: "System-config key" }],
        inputSchema: KEY_INPUT,
        outputSchema: {
          ...OBJECT_OUTPUT$5,
          properties: {
            key: { type: "string" },
            value: { type: "string" },
            version: { type: "integer" },
            text: { type: "string" }
          },
          required: ["key", "value", "version", "text"]
        },
        resultSchemaVersion: 1,
        access: { mode: "fixed", level: "read" },
        asyncMode: "sync",
        requiresSession: true,
        examples: [
          "buckyos --profile production system-config get boot/config",
          "buckyos --output text system-config get services/example/config"
        ],
        handler: async (ctx, input) => {
          const key = String(input.key);
          const result = await callSystemConfig(ctx, "sys_config_get", { key });
          if (result === null) {
            throw new ToolError(
              "RESOURCE_NOT_FOUND",
              `system-config key not found: ${key}`
            );
          }
          if (!isConfigValue(result))
            invalidResponse$2("sys_config_get");
          return { key, value: result.value, version: result.version, text: result.value };
        }
      },
      {
        verb: "list",
        summary: "List direct child keys under a system-config key",
        positionals: [
          { name: "key", description: "Parent key; omit to list the root", required: false }
        ],
        inputSchema: {
          type: "object",
          properties: { key: { type: "string" } },
          additionalProperties: false
        },
        outputSchema: {
          ...OBJECT_OUTPUT$5,
          properties: {
            key: { type: "string" },
            items: { type: "array", items: { type: "string" } }
          },
          required: ["key", "items"]
        },
        resultSchemaVersion: 1,
        access: { mode: "fixed", level: "read" },
        asyncMode: "sync",
        requiresSession: true,
        examples: [
          "buckyos system-config list",
          "buckyos system-config list services"
        ],
        handler: async (ctx, input) => {
          const key = typeof input.key === "string" ? input.key : "";
          const result = await callSystemConfig(ctx, "sys_config_list", { key });
          if (!Array.isArray(result) || !result.every((item) => typeof item === "string")) {
            invalidResponse$2("sys_config_list");
          }
          return { key, items: result };
        }
      },
      setCommand(),
      setFileCommand(),
      mutationCommand({
        verb: "append",
        summary: "Append text to an existing system-config value",
        method: "sys_config_append",
        valueProperty: "append_value",
        resultProperty: "appended"
      })
    ]
  };
}
function setCommand() {
  return {
    verb: "set",
    summary: "Set one system-config value",
    positionals: [{ name: "key", description: "System-config key" }],
    options: [
      { name: "value", description: "Value to store", type: "string", required: true }
    ],
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", minLength: 1 },
        value: { type: "string", minLength: 1 }
      },
      required: ["key", "value"],
      additionalProperties: false
    },
    outputSchema: {
      ...OBJECT_OUTPUT$5,
      properties: { key: { type: "string" }, updated: { type: "boolean" } },
      required: ["key", "updated"]
    },
    resultSchemaVersion: 1,
    access: { mode: "fixed", level: "write" },
    asyncMode: "sync",
    requiresSession: true,
    examples: ["buckyos system-config set services/example/config --value enabled"],
    handler: async (ctx, input) => {
      const key = String(input.key);
      await callSystemConfig(ctx, "sys_config_set", { key, value: String(input.value) });
      return { key, updated: true };
    }
  };
}
function setFileCommand() {
  return {
    verb: "set-file",
    summary: "Set one system-config value from a file",
    positionals: [{ name: "key", description: "System-config key" }],
    options: [
      {
        name: "file",
        description: "File whose content will be stored",
        type: "string",
        required: true
      }
    ],
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", minLength: 1 },
        file: { type: "string", minLength: 1 }
      },
      required: ["key", "file"],
      additionalProperties: false
    },
    outputSchema: {
      ...OBJECT_OUTPUT$5,
      properties: { key: { type: "string" }, updated: { type: "boolean" } },
      required: ["key", "updated"]
    },
    resultSchemaVersion: 1,
    access: { mode: "fixed", level: "write" },
    asyncMode: "sync",
    requiresSession: true,
    examples: ["buckyos system-config set-file services/example/config --file ./config.json"],
    handler: async (ctx, input) => {
      const key = String(input.key);
      const value = await readValueFile(String(input.file));
      if (!value)
        throw new UsageError("INVALID_ARGUMENT", "system-config value must not be empty");
      await callSystemConfig(ctx, "sys_config_set", { key, value });
      return { key, updated: true };
    }
  };
}
function mutationCommand(options) {
  return {
    verb: options.verb,
    summary: options.summary,
    positionals: [{ name: "key", description: "System-config key" }],
    options: [
      { name: "value", description: "Value to append", type: "string", required: true }
    ],
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", minLength: 1 },
        value: { type: "string", minLength: 1 }
      },
      required: ["key", "value"],
      additionalProperties: false
    },
    outputSchema: {
      ...OBJECT_OUTPUT$5,
      properties: {
        key: { type: "string" },
        [options.resultProperty]: { type: "boolean" }
      },
      required: ["key", options.resultProperty]
    },
    resultSchemaVersion: 1,
    access: { mode: "fixed", level: "write" },
    asyncMode: "sync",
    requiresSession: true,
    examples: [`buckyos system-config ${options.verb} system/rbac/policy --value 'p,...'`],
    handler: async (ctx, input) => {
      const key = String(input.key);
      await callSystemConfig(ctx, options.method, {
        key,
        [options.valueProperty]: String(input.value)
      });
      return { key, [options.resultProperty]: true };
    }
  };
}
async function callSystemConfig(ctx, method, params) {
  return await ctx.clients.call(SERVICE_NAME, method, params, {
    traceId: ctx.traceId,
    timeoutMs: Math.max(1, (ctx.deadline ?? Date.now()) - Date.now()),
    signal: ctx.signal
  });
}
async function readValueFile(path) {
  try {
    return await getHost().readTextFile(path);
  } catch (error) {
    throw new UsageError(
      "INPUT_READ_FAILED",
      `failed to read value file: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
function isConfigValue(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return false;
  const object = value;
  return typeof object.value === "string" && Number.isSafeInteger(object.version) && Number(object.version) >= 0;
}
function invalidResponse$2(method) {
  throw new ToolError(
    "INVALID_SERVICE_RESPONSE",
    `system-config returned an invalid response for ${method}`,
    EXIT_INTERNAL
  );
}
const dirname$1 = (path) => getHost().path.dirname(path);
const relative$1 = (from, to) => getHost().path.relative(from, to);
const resolve$3 = (...parts) => getHost().path.resolve(...parts);
const BLOCK_SIZE = 512;
const ZIP_LOCAL_SIGNATURE = 67324752;
const ZIP_CENTRAL_SIGNATURE = 33639248;
const ZIP_EOCD_SIGNATURE = 101010256;
const ZIP64_EOCD_SIGNATURE = 101075792;
const ZIP64_LOCATOR_SIGNATURE = 117853008;
const MAX_CENTRAL_DIRECTORY = 64 * 1024 * 1024;
const MAX_PIKG_ENTRIES = 4096;
const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC_TABLE.length; index++) {
  let value = index;
  for (let bit = 0; bit < 8; bit++)
    value = value >>> 1 ^ (value & 1 ? 3988292384 : 0);
  CRC_TABLE[index] = value >>> 0;
}
async function digestFile(path) {
  const file = await getHost().open(path, { read: true });
  const sha = getHost().createHash("sha256");
  let crc = 4294967295;
  let size = 0;
  try {
    const buffer = new Uint8Array(256 * 1024);
    while (true) {
      const read = await file.read(buffer);
      if (read === null)
        break;
      const chunk = buffer.subarray(0, read);
      sha.update(chunk);
      crc = updateCrc32(crc, chunk);
      size += read;
      if (!Number.isSafeInteger(size))
        throw new UsageError("FILE_TOO_LARGE", "file is too large");
    }
  } finally {
    await file.close();
  }
  return { size, sha256: sha.digestHex(), crc32: (crc ^ 4294967295) >>> 0 };
}
function sha256Bytes(bytes) {
  const sha = getHost().createHash("sha256");
  sha.update(bytes);
  return sha.digestHex();
}
async function createDeterministicTarGz(sourceDir, destination) {
  const root = await getHost().realPath(sourceDir);
  const before = await collectTarSources(root);
  const tarPath = `${destination}.tar-${crypto.randomUUID()}`;
  const tar = await getHost().open(tarPath, { createNew: true, write: true, mode: 384 });
  try {
    for (const source of before) {
      const header = tarHeader(source);
      await writeAll(tar, header);
      if (source.kind === "file") {
        await copyFileToWriter(source.physicalPath, tar);
        const padding = (BLOCK_SIZE - source.size % BLOCK_SIZE) % BLOCK_SIZE;
        if (padding)
          await writeAll(tar, new Uint8Array(padding));
      }
    }
    await writeAll(tar, new Uint8Array(BLOCK_SIZE * 2));
    await tar.sync();
  } finally {
    await tar.close();
  }
  try {
    const after = await collectTarSources(root);
    if (JSON.stringify(before.map(sourceIdentity)) !== JSON.stringify(after.map(sourceIdentity))) {
      throw new ToolError("SOURCE_CHANGED", "subpackage source changed while it was archived");
    }
    await gzipFile(tarPath, destination);
  } finally {
    await removeIfExists(tarPath);
  }
}
async function gzipFile(source, destination) {
  await getHost().gzipFile(source, destination);
}
async function writeStoredZip(destination, sources) {
  if (sources.length > MAX_PIKG_ENTRIES) {
    throw new UsageError("TOO_MANY_ENTRIES", "PIKG contains too many entries");
  }
  const names = /* @__PURE__ */ new Set();
  const prepared = [];
  for (const source of sources) {
    validateZipEntryName(source.name);
    if (names.has(source.name))
      throw invalidZip("structure", `duplicate entry: ${source.name}`);
    names.add(source.name);
    if (source.bytes === void 0 === (source.path === void 0)) {
      throw new Error(`zip source ${source.name} must provide exactly one body`);
    }
    const digest = source.bytes ? {
      size: source.bytes.byteLength,
      sha256: sha256Bytes(source.bytes),
      crc32: crc32(source.bytes)
    } : await digestFile(source.path);
    prepared.push({
      ...source,
      nameBytes: new TextEncoder().encode(source.name),
      digest,
      offset: 0,
      zip64: digest.size > 4294967295
    });
  }
  await getHost().mkdir(dirname$1(destination), { recursive: true });
  const output = await getHost().open(destination, { createNew: true, write: true, mode: 384 });
  let offset = 0;
  const centralRecords = [];
  try {
    for (const source of prepared) {
      source.offset = offset;
      source.zip64 ||= offset > 4294967295;
      const localExtra = source.zip64 ? zip64Extra([source.digest.size, source.digest.size]) : EMPTY;
      const local = new Uint8Array(30 + source.nameBytes.length + localExtra.length);
      const view2 = new DataView(local.buffer);
      view2.setUint32(0, ZIP_LOCAL_SIGNATURE, true);
      view2.setUint16(4, source.zip64 ? 45 : 20, true);
      view2.setUint16(6, 2048, true);
      view2.setUint16(8, 0, true);
      view2.setUint32(14, source.digest.crc32, true);
      view2.setUint32(18, source.zip64 ? 4294967295 : source.digest.size, true);
      view2.setUint32(22, source.zip64 ? 4294967295 : source.digest.size, true);
      view2.setUint16(26, source.nameBytes.length, true);
      view2.setUint16(28, localExtra.length, true);
      local.set(source.nameBytes, 30);
      local.set(localExtra, 30 + source.nameBytes.length);
      await writeAll(output, local);
      offset += local.length;
      if (source.bytes) {
        await writeAll(output, source.bytes);
      } else {
        await copyFileToWriter(source.path, output);
      }
      offset += source.digest.size;
      const centralExtra = source.zip64 ? zip64Extra([source.digest.size, source.digest.size, source.offset]) : EMPTY;
      const central = new Uint8Array(46 + source.nameBytes.length + centralExtra.length);
      const centralView = new DataView(central.buffer);
      centralView.setUint32(0, ZIP_CENTRAL_SIGNATURE, true);
      centralView.setUint16(4, 3 << 8 | 45, true);
      centralView.setUint16(6, source.zip64 ? 45 : 20, true);
      centralView.setUint16(8, 2048, true);
      centralView.setUint16(10, 0, true);
      centralView.setUint32(16, source.digest.crc32, true);
      centralView.setUint32(20, source.zip64 ? 4294967295 : source.digest.size, true);
      centralView.setUint32(24, source.zip64 ? 4294967295 : source.digest.size, true);
      centralView.setUint16(28, source.nameBytes.length, true);
      centralView.setUint16(30, centralExtra.length, true);
      centralView.setUint32(38, 33188 << 16, true);
      centralView.setUint32(42, source.zip64 ? 4294967295 : source.offset, true);
      central.set(source.nameBytes, 46);
      central.set(centralExtra, 46 + source.nameBytes.length);
      centralRecords.push(central);
    }
    const centralOffset = offset;
    for (const record of centralRecords) {
      await writeAll(output, record);
      offset += record.length;
    }
    const centralSize = offset - centralOffset;
    const needsZip64 = prepared.some((source) => source.zip64) || centralOffset > 4294967295 || centralSize > 4294967295;
    if (needsZip64) {
      const zip64Offset = offset;
      const eocd64 = new Uint8Array(56);
      const view64 = new DataView(eocd64.buffer);
      view64.setUint32(0, ZIP64_EOCD_SIGNATURE, true);
      setUint64(view64, 4, 44);
      view64.setUint16(12, 3 << 8 | 45, true);
      view64.setUint16(14, 45, true);
      setUint64(view64, 24, prepared.length);
      setUint64(view64, 32, prepared.length);
      setUint64(view64, 40, centralSize);
      setUint64(view64, 48, centralOffset);
      await writeAll(output, eocd64);
      offset += eocd64.length;
      const locator = new Uint8Array(20);
      const locatorView = new DataView(locator.buffer);
      locatorView.setUint32(0, ZIP64_LOCATOR_SIGNATURE, true);
      setUint64(locatorView, 8, zip64Offset);
      locatorView.setUint32(16, 1, true);
      await writeAll(output, locator);
      offset += locator.length;
    }
    const eocd = new Uint8Array(22);
    const view = new DataView(eocd.buffer);
    view.setUint32(0, ZIP_EOCD_SIGNATURE, true);
    view.setUint16(8, needsZip64 ? 65535 : prepared.length, true);
    view.setUint16(10, needsZip64 ? 65535 : prepared.length, true);
    view.setUint32(12, needsZip64 ? 4294967295 : centralSize, true);
    view.setUint32(16, needsZip64 ? 4294967295 : centralOffset, true);
    await writeAll(output, eocd);
    await output.sync();
  } finally {
    await output.close();
  }
}
async function openZip(path) {
  const stat2 = await getHost().stat(path);
  if (!stat2.isFile || stat2.size < 22)
    throw invalidZip("container", "PIKG is not a ZIP file");
  const file = await getHost().open(path, { read: true });
  try {
    const magic = await readAt(file, 0, 4);
    if (new DataView(magic.buffer, magic.byteOffset, magic.byteLength).getUint32(0, true) !== ZIP_LOCAL_SIGNATURE) {
      throw invalidZip("container", "PIKG magic mismatch");
    }
    const tailLength = Math.min(stat2.size, 22 + 65535);
    const tail = await readAt(file, stat2.size - tailLength, tailLength);
    const eocdPosition = findLastSignature(tail, ZIP_EOCD_SIGNATURE);
    if (eocdPosition < 0 || eocdPosition + 22 > tail.length) {
      throw invalidZip("container", "ZIP end-of-central-directory record is missing");
    }
    const eocd = new DataView(
      tail.buffer,
      tail.byteOffset + eocdPosition,
      tail.length - eocdPosition
    );
    const commentLength = eocd.getUint16(20, true);
    if (eocdPosition + 22 + commentLength !== tail.length) {
      throw invalidZip("container", "ZIP has trailing data or a truncated comment");
    }
    if (eocd.getUint16(4, true) !== 0 || eocd.getUint16(6, true) !== 0) {
      throw invalidZip("container", "multi-disk ZIP files are not supported");
    }
    let count = eocd.getUint16(10, true);
    if (eocd.getUint16(8, true) !== count) {
      throw invalidZip("container", "ZIP entry counts disagree");
    }
    let centralSize = eocd.getUint32(12, true);
    let centralOffset = eocd.getUint32(16, true);
    if (count === 65535 || centralSize === 4294967295 || centralOffset === 4294967295) {
      const eocdAbsolute = stat2.size - tailLength + eocdPosition;
      if (eocdAbsolute < 20)
        throw invalidZip("container", "ZIP64 locator is missing");
      const locatorBytes = await readAt(file, eocdAbsolute - 20, 20);
      const locator = new DataView(locatorBytes.buffer, locatorBytes.byteOffset, 20);
      if (locator.getUint32(0, true) !== ZIP64_LOCATOR_SIGNATURE) {
        throw invalidZip("container", "ZIP64 locator signature mismatch");
      }
      if (locator.getUint32(4, true) !== 0 || locator.getUint32(16, true) !== 1) {
        throw invalidZip("container", "multi-disk ZIP64 files are not supported");
      }
      const recordOffset = uint64(locator, 8);
      const recordBytes = await readAt(file, recordOffset, 56);
      const record = new DataView(recordBytes.buffer, recordBytes.byteOffset, 56);
      if (record.getUint32(0, true) !== ZIP64_EOCD_SIGNATURE) {
        throw invalidZip("container", "ZIP64 end record signature mismatch");
      }
      if (record.getUint32(16, true) !== 0 || record.getUint32(20, true) !== 0) {
        throw invalidZip("container", "multi-disk ZIP64 files are not supported");
      }
      if (uint64(record, 24) !== uint64(record, 32)) {
        throw invalidZip("container", "ZIP64 entry counts disagree");
      }
      count = uint64(record, 32);
      centralSize = uint64(record, 40);
      centralOffset = uint64(record, 48);
    }
    if (count > MAX_PIKG_ENTRIES)
      throw invalidZip("structure", "PIKG has too many entries");
    if (centralSize > MAX_CENTRAL_DIRECTORY) {
      throw invalidZip("structure", "PIKG central directory exceeds the size limit");
    }
    if (centralOffset + centralSize > stat2.size) {
      throw invalidZip("container", "ZIP central directory is out of bounds");
    }
    const central = await readAt(file, centralOffset, centralSize);
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const entries = [];
    const byName = /* @__PURE__ */ new Map();
    const fileNames = /* @__PURE__ */ new Set();
    const directories = /* @__PURE__ */ new Set();
    let position = 0;
    for (let index = 0; index < count; index++) {
      if (position + 46 > central.length || u32(central, position) !== ZIP_CENTRAL_SIGNATURE) {
        throw invalidZip("structure", `central directory entry #${index} is truncated`);
      }
      const flags = u16(central, position + 8);
      const compression = u16(central, position + 10);
      const crc = u32(central, position + 16);
      let compressedSize = u32(central, position + 20);
      let size = u32(central, position + 24);
      const nameLength = u16(central, position + 28);
      const extraLength = u16(central, position + 30);
      const commentLength2 = u16(central, position + 32);
      const externalAttributes = u32(central, position + 38);
      let localOffset = u32(central, position + 42);
      const end = position + 46 + nameLength + extraLength + commentLength2;
      if (end > central.length)
        throw invalidZip("structure", "central directory is truncated");
      let name;
      try {
        name = decoder.decode(central.subarray(position + 46, position + 46 + nameLength));
      } catch {
        throw invalidZip("structure", `entry #${index} name is not UTF-8`);
      }
      validateZipEntryName(name);
      if (byName.has(name))
        throw invalidZip("structure", `duplicate entry: ${name}`);
      if (flags & 1)
        throw invalidZip("structure", `encrypted entry is not allowed: ${name}`);
      if (![0, 8].includes(compression)) {
        throw invalidZip("structure", `unsupported compression method for ${name}`);
      }
      const extra = central.subarray(
        position + 46 + nameLength,
        position + 46 + nameLength + extraLength
      );
      if (size === 4294967295 || compressedSize === 4294967295 || localOffset === 4294967295) {
        const values = parseZip64Extra(extra);
        let valueIndex = 0;
        if (size === 4294967295)
          size = requiredZip64(values, valueIndex++, name);
        if (compressedSize === 4294967295) {
          compressedSize = requiredZip64(values, valueIndex++, name);
        }
        if (localOffset === 4294967295)
          localOffset = requiredZip64(values, valueIndex++, name);
      }
      const mode = externalAttributes >>> 16 & 65535;
      if ((mode & 61440) === 40960) {
        throw invalidZip("structure", `symlink entry is not allowed: ${name}`);
      }
      const isDirectory = name.endsWith("/");
      const normalized = name.replace(/\/$/, "");
      if (isDirectory)
        directories.add(normalized);
      else
        fileNames.add(name);
      const entry = {
        name,
        compressedSize,
        size,
        crc32: crc,
        compression,
        flags,
        localOffset,
        dataOffset: 0,
        externalAttributes,
        isDirectory
      };
      entries.push(entry);
      byName.set(name, entry);
      position = end;
    }
    if (position !== central.length) {
      throw invalidZip("structure", "central directory size mismatch");
    }
    for (const fileName of fileNames) {
      const parts = fileName.split("/");
      let prefix = "";
      for (const part of parts.slice(0, -1)) {
        prefix = prefix ? `${prefix}/${part}` : part;
        directories.add(prefix);
      }
    }
    const conflict = [...fileNames].find((name) => directories.has(name));
    if (conflict)
      throw invalidZip("structure", `path is both file and directory: ${conflict}`);
    const intervals = [];
    for (const entry of entries) {
      const local = await readAt(file, entry.localOffset, 30);
      if (u32(local, 0) !== ZIP_LOCAL_SIGNATURE) {
        throw invalidZip("structure", `local header is missing for ${entry.name}`);
      }
      const localFlags = u16(local, 6);
      const localCompression = u16(local, 8);
      const localNameLength = u16(local, 26);
      const localExtraLength = u16(local, 28);
      if (localFlags !== entry.flags || localCompression !== entry.compression) {
        throw invalidZip("structure", `local header disagrees for ${entry.name}`);
      }
      const localName = await readAt(file, entry.localOffset + 30, localNameLength);
      let decodedLocalName;
      try {
        decodedLocalName = decoder.decode(localName);
      } catch {
        throw invalidZip("structure", `local entry name is not UTF-8: ${entry.name}`);
      }
      if (decodedLocalName !== entry.name) {
        throw invalidZip("structure", `local entry name disagrees for ${entry.name}`);
      }
      entry.dataOffset = entry.localOffset + 30 + localNameLength + localExtraLength;
      const end = entry.dataOffset + entry.compressedSize;
      if (end > centralOffset) {
        throw invalidZip("structure", `entry data is out of bounds: ${entry.name}`);
      }
      intervals.push([entry.localOffset, end, entry.name]);
    }
    intervals.sort((left, right) => left[0] - right[0]);
    for (let index = 1; index < intervals.length; index++) {
      if (intervals[index][0] < intervals[index - 1][1]) {
        throw invalidZip("structure", `overlapping ZIP entries: ${intervals[index][2]}`);
      }
    }
    return { path: resolve$3(path), size: stat2.size, entries, byName };
  } finally {
    await file.close();
  }
}
async function readZipEntry(archive, entry, limit) {
  if (entry.size > limit)
    throw invalidZip("limits", `entry exceeds size limit: ${entry.name}`);
  const chunks = [];
  let size = 0;
  const verification = createEntryVerification(entry);
  try {
    for await (const chunk of zipEntryStream(archive.path, entry)) {
      size += chunk.byteLength;
      if (size > limit || size > entry.size) {
        throw invalidZip("limits", `entry expands beyond its declared size: ${entry.name}`);
      }
      verification.update(chunk);
      chunks.push(chunk.slice());
    }
  } catch (error) {
    if (error instanceof ToolError)
      throw error;
    throw invalidZip("compression", `failed to read entry ${entry.name}`);
  }
  verification.finish(size);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
async function verifyZipEntry(archive, entry, expectedSha256) {
  const verification = createEntryVerification(entry);
  try {
    for await (const chunk of zipEntryStream(archive.path, entry))
      verification.update(chunk);
  } catch (error) {
    if (error instanceof ToolError)
      throw error;
    throw invalidZip("compression", `failed to read entry ${entry.name}`);
  }
  const result = verification.finish();
  if (expectedSha256 && result.sha256 !== expectedSha256.toLowerCase()) {
    throw invalidZip("content", `content digest mismatch: ${entry.name}`, entry.name);
  }
  return result;
}
function createEntryVerification(entry) {
  const sha = getHost().createHash("sha256");
  let crc = 4294967295;
  let size = 0;
  return {
    update(chunk) {
      size += chunk.length;
      if (size > entry.size) {
        throw invalidZip("limits", `entry is larger than declared: ${entry.name}`);
      }
      sha.update(chunk);
      crc = updateCrc32(crc, chunk);
    },
    finish(actualSize = size) {
      if (actualSize !== entry.size || size !== entry.size) {
        throw invalidZip("content", `entry size mismatch: ${entry.name}`, entry.name);
      }
      const actualCrc = (crc ^ 4294967295) >>> 0;
      if (actualCrc !== entry.crc32) {
        throw invalidZip("content", `entry CRC mismatch: ${entry.name}`, entry.name);
      }
      return { size, sha256: sha.digestHex(), crc32: actualCrc };
    }
  };
}
function zipEntryStream(path, entry) {
  let file;
  let remaining = entry.compressedSize;
  const compressed = new ReadableStream({
    async start() {
      file = await getHost().open(path, { read: true });
      await file.seek(entry.dataOffset);
    },
    async pull(controller) {
      if (!file || remaining === 0) {
        void file?.close();
        controller.close();
        return;
      }
      const buffer = new Uint8Array(Math.min(256 * 1024, remaining));
      const read = await file.read(buffer);
      if (read === null) {
        void file.close();
        controller.error(invalidZip("container", `truncated entry: ${entry.name}`));
        return;
      }
      remaining -= read;
      controller.enqueue(buffer.subarray(0, read));
    },
    cancel() {
      void file?.close();
    }
  });
  if (entry.compression === 0)
    return compressed;
  return compressed.pipeThrough(
    new DecompressionStream("deflate-raw")
  );
}
async function collectTarSources(root) {
  const output = [];
  const activeDirectories = /* @__PURE__ */ new Set();
  async function walk(physicalDirectory, archivePrefix) {
    const realDirectory2 = await getHost().realPath(physicalDirectory);
    assertWithin(root, realDirectory2, archivePrefix || ".");
    if (activeDirectories.has(realDirectory2)) {
      throw new UsageError("INVALID_SOURCE", `symlink cycle in source: ${archivePrefix}`);
    }
    activeDirectories.add(realDirectory2);
    try {
      const children = [];
      for (const child of await getHost().readDir(realDirectory2))
        children.push(child);
      children.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
      for (const child of children) {
        if (child.name.includes("\0") || child.name.includes("/") || child.name.includes("\\")) {
          throw new UsageError("INVALID_SOURCE", "source contains an unsafe file name");
        }
        const archivePath = archivePrefix ? `${archivePrefix}/${child.name}` : child.name;
        const unresolved = resolve$3(realDirectory2, child.name);
        const info = await getHost().lstat(unresolved);
        const physical = info.isSymlink ? await getHost().realPath(unresolved) : unresolved;
        assertWithin(root, physical, archivePath);
        const target = info.isSymlink ? await getHost().stat(physical) : info;
        if (target.isDirectory) {
          output.push({
            archivePath: `${archivePath}/`,
            physicalPath: physical,
            kind: "directory",
            size: 0,
            executable: true,
            identity: fileIdentity(info, physical, target)
          });
          await walk(physical, archivePath);
        } else if (target.isFile) {
          output.push({
            archivePath,
            physicalPath: physical,
            kind: "file",
            size: target.size,
            executable: ((target.mode ?? 0) & 73) !== 0,
            identity: fileIdentity(info, physical, target),
            contentDigest: (await digestFile(physical)).sha256
          });
        } else {
          throw new UsageError("INVALID_SOURCE", `unsupported special file: ${archivePath}`);
        }
      }
    } finally {
      activeDirectories.delete(realDirectory2);
    }
  }
  await walk(root, "");
  return output;
}
function fileIdentity(link, realPath, target) {
  return JSON.stringify({
    realPath,
    linkMtime: link.mtime?.getTime() ?? null,
    mtime: target.mtime?.getTime() ?? null,
    size: target.size,
    dev: target.dev,
    ino: target.ino,
    mode: target.mode
  });
}
function sourceIdentity(source) {
  return [
    source.archivePath,
    source.kind,
    source.size,
    source.executable,
    source.identity,
    source.contentDigest ?? null
  ];
}
function assertWithin(root, candidate, label) {
  const path = relative$1(root, candidate);
  if (path === ".." || path.startsWith(`..${getHost().path.sep}`) || resolve$3(candidate) === resolve$3(root) && label !== ".") {
    throw new UsageError("INVALID_SOURCE", `symlink escapes source root: ${label}`);
  }
}
function tarHeader(source) {
  const header = new Uint8Array(BLOCK_SIZE);
  const { name, prefix } = splitUstarPath(source.archivePath);
  writeString(header, 0, 100, name);
  writeOctal(
    header,
    100,
    8,
    source.kind === "directory" ? 493 : source.executable ? 493 : 420
  );
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, source.size);
  writeOctal(header, 136, 12, 0);
  header.fill(32, 148, 156);
  header[156] = source.kind === "directory" ? 53 : 48;
  writeString(header, 257, 6, "ustar\0");
  writeString(header, 263, 2, "00");
  writeString(header, 345, 155, prefix);
  let checksum = 0;
  for (const byte of header)
    checksum += byte;
  writeChecksum(header, checksum);
  return header;
}
function splitUstarPath(path) {
  const encoder = new TextEncoder();
  if (encoder.encode(path).length <= 100)
    return { name: path, prefix: "" };
  const directory = path.endsWith("/");
  const core = directory ? path.slice(0, -1) : path;
  const parts = core.split("/");
  for (let index = parts.length - 1; index > 0; index--) {
    const prefix = parts.slice(0, index).join("/");
    const name = `${parts.slice(index).join("/")}${directory ? "/" : ""}`;
    if (encoder.encode(prefix).length <= 155 && encoder.encode(name).length <= 100) {
      return { name, prefix };
    }
  }
  throw new UsageError("INVALID_SOURCE", `source path is too long for a portable tar: ${path}`);
}
function writeString(target, offset, length, value) {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > length)
    throw new UsageError("INVALID_SOURCE", "tar field is too long");
  target.set(bytes, offset);
}
function writeOctal(target, offset, length, value) {
  const text = value.toString(8).padStart(length - 1, "0");
  if (text.length >= length)
    throw new UsageError("FILE_TOO_LARGE", "tar field overflows");
  writeString(target, offset, length, `${text}\0`);
}
function writeChecksum(target, value) {
  const text = value.toString(8).padStart(6, "0");
  writeString(target, 148, 8, `${text}\0 `);
}
function validateZipEntryName(name) {
  if (!name || name.includes("\0") || name.includes("\\") || name.startsWith("/")) {
    throw invalidZip("structure", `unsafe entry name: ${JSON.stringify(name)}`);
  }
  if (/^[A-Za-z]:/.test(name))
    throw invalidZip("structure", `absolute entry name: ${name}`);
  const directory = name.endsWith("/");
  const segments = name.split("/");
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    if (segment === "." || segment === ".." || !segment && !(directory && index === segments.length - 1)) {
      throw invalidZip("structure", `unsafe entry name: ${name}`);
    }
  }
}
function invalidZip(stage, message, entry) {
  return new ToolError("INVALID_PACKAGE", message, 6, false, {
    stage,
    ...entry ? { entry } : {}
  });
}
function crc32(bytes) {
  return (updateCrc32(4294967295, bytes) ^ 4294967295) >>> 0;
}
function updateCrc32(crc, bytes) {
  let value = crc;
  for (const byte of bytes)
    value = CRC_TABLE[(value ^ byte) & 255] ^ value >>> 8;
  return value >>> 0;
}
async function writeAll(file, bytes) {
  let offset = 0;
  while (offset < bytes.length)
    offset += await file.write(bytes.subarray(offset));
}
async function copyFileToWriter(path, output) {
  const input = await getHost().open(path, { read: true });
  try {
    const buffer = new Uint8Array(256 * 1024);
    while (true) {
      const read = await input.read(buffer);
      if (read === null)
        break;
      await writeAll(output, buffer.subarray(0, read));
    }
  } finally {
    await input.close();
  }
}
async function readAt(file, offset, length) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0) {
    throw invalidZip("container", "ZIP offset is invalid");
  }
  await file.seek(offset);
  const output = new Uint8Array(length);
  let position = 0;
  while (position < length) {
    const read = await file.read(output.subarray(position));
    if (read === null)
      throw invalidZip("container", "ZIP file is truncated");
    position += read;
  }
  return output;
}
function findLastSignature(bytes, signature) {
  for (let index = bytes.length - 4; index >= 0; index--) {
    if (u32(bytes, index) === signature)
      return index;
  }
  return -1;
}
function parseZip64Extra(extra) {
  let position = 0;
  while (position + 4 <= extra.length) {
    const id = u16(extra, position);
    const length = u16(extra, position + 2);
    const end = position + 4 + length;
    if (end > extra.length)
      throw invalidZip("structure", "ZIP extra field is truncated");
    if (id === 1) {
      if (length % 8 !== 0)
        throw invalidZip("structure", "ZIP64 extra field is malformed");
      const view = new DataView(extra.buffer, extra.byteOffset + position + 4, length);
      const values = [];
      for (let offset = 0; offset < length; offset += 8)
        values.push(uint64(view, offset));
      return values;
    }
    position = end;
  }
  throw invalidZip("structure", "ZIP64 extra field is missing");
}
function requiredZip64(values, index, name) {
  const value = values[index];
  if (value === void 0)
    throw invalidZip("structure", `ZIP64 values are missing for ${name}`);
  return value;
}
function zip64Extra(values) {
  const output = new Uint8Array(4 + values.length * 8);
  const view = new DataView(output.buffer);
  view.setUint16(0, 1, true);
  view.setUint16(2, values.length * 8, true);
  values.forEach((value, index) => setUint64(view, 4 + index * 8, value));
  return output;
}
function setUint64(view, offset, value) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("uint64 value is unsafe");
  view.setBigUint64(offset, BigInt(value), true);
}
function uint64(view, offset) {
  const value = view.getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw invalidZip("limits", "ZIP64 value is too large");
  }
  return Number(value);
}
function u16(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true);
}
function u32(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}
async function removeIfExists(path) {
  try {
    await getHost().remove(path);
  } catch (error) {
    if (!isHostError(error, "NotFound"))
      throw error;
  }
}
const EMPTY = new Uint8Array();
const basename$1 = (path) => getHost().path.basename(path);
const join$1 = (...parts) => getHost().path.join(...parts);
const resolve$2 = (...parts) => getHost().path.resolve(...parts);
const PACKAGE_META_SCHEMA = "buckyos.pikg.package-meta.v1";
const DIST_MANIFEST_NAME = ".buckyos-pikg-dist.json";
const APPDOC_ENTRY = "APPDOC.json";
const APPDOC_JWT_ENTRY = "APPDOC.jwt";
const PACKAGE_META_ENTRY = "PACKAGE_META.json";
const MAX_APPDOC_BYTES = 1024 * 1024;
const MAX_METADATA_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_METADATA_TOTAL_BYTES = 64 * 1024 * 1024;
const SAFE_SUBPACKAGE = /^[A-Za-z0-9._-]+$/;
const SAFE_BNS_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const SHA256_DIGEST = /^sha256:([0-9a-fA-F]{64})$/;
const OBJECT_ID$1 = /^(appdoc|pkg):[0-9a-f]{64}$/;
function validateSubpackageName(name) {
  if (!SAFE_SUBPACKAGE.test(name) || name === "." || name === "..") {
    throw new UsageError("INVALID_SUBPACKAGE_NAME", `invalid subpackage name: ${name}`);
  }
}
function normalizeArch$1(value) {
  switch (value.trim().toLowerCase()) {
    case "amd64":
    case "x86_64":
    case "x64":
      return "x86_64";
    case "arm64":
    case "aarch64":
      return "aarch64";
    default:
      return value.trim().toLowerCase();
  }
}
function normalizeOs(value) {
  switch (value.trim().toLowerCase()) {
    case "darwin":
    case "apple":
    case "macos":
    case "osx":
      return "macos";
    case "win":
    case "win32":
    case "windows":
      return "windows";
    default:
      return value.trim().toLowerCase();
  }
}
function derivedSelector(key) {
  const selectors = {
    amd64_docker_image: { os: "linux", arch: "x86_64" },
    aarch64_docker_image: { os: "linux", arch: "aarch64" },
    amd64_linux_app: { os: "linux", arch: "x86_64" },
    aarch64_linux_app: { os: "linux", arch: "aarch64" },
    amd64_win_app: { os: "windows", arch: "x86_64" },
    aarch64_win_app: { os: "windows", arch: "aarch64" },
    amd64_apple_app: { os: "macos", arch: "x86_64" },
    aarch64_apple_app: { os: "macos", arch: "aarch64" },
    web: {},
    agent: {},
    agent_skills: {},
    agent_tools: {},
    script: {}
  };
  return selectors[key];
}
function canonicalSelector(value, label) {
  if (value === void 0)
    return void 0;
  const selector = expectObject$3(value, label);
  rejectUnknown(selector, ["os", "arch", "min_kernel_version"], label);
  const output = {};
  for (const key of ["os", "arch", "min_kernel_version"]) {
    if (selector[key] !== void 0) {
      output[key] = expectNonEmptyString(selector[key], `${label}.${key}`);
    }
  }
  if (output.os)
    output.os = normalizeOs(output.os);
  if (output.arch)
    output.arch = normalizeArch$1(output.arch);
  return output;
}
function assertSelectorCompatible(key, selector, label) {
  const derived = derivedSelector(key);
  if (!derived || !selector)
    return;
  for (const field of ["os", "arch"]) {
    if (derived[field] !== void 0 && selector[field] !== derived[field]) {
      throw new UsageError(
        "SELECTOR_CONFLICT",
        `${label}.${field} conflicts with the selector derived from ${key}`
      );
    }
  }
}
function deriveAppNamespace(appDid) {
  return appIdFromDid(appDid);
}
function appIdFromDid(appDid) {
  const app = parseDid(appDid, "did");
  if (app.id.includes("#") || app.id.includes("/") || app.id.includes("%") || app.id.includes(":")) {
    throw new UsageError(
      "INVALID_APP_ID",
      "App DID must use hostname form without path, fragment, port, or encoding"
    );
  }
  const labels = app.id.split(".");
  if (labels.some((label) => !SAFE_BNS_LABEL.test(label))) {
    throw new UsageError("INVALID_APP_ID", "App DID must contain canonical lowercase DNS labels");
  }
  if (app.method === "web") {
    if (labels.length >= 3 && labels.at(-1) === "did") {
      throw new UsageError(
        "INVALID_APP_ID",
        "did:web hostname conflicts with the reserved non-Web .did form"
      );
    }
    return app.id;
  }
  return `${app.id}.${app.method}.did`;
}
function createPackageMeta(packageName, version, author, owner, payload, timestamp) {
  const content = ndn.ChunkId.fromMix256Result(
    payload.size,
    ndn.hexToBytes(payload.sha256)
  ).toString();
  const value = {
    name: packageName,
    author,
    owner,
    create_time: timestamp,
    last_update_time: timestamp,
    size: payload.size,
    content,
    version
  };
  const objectId = ndn.buildNamedObjectByJson(ndn.OBJ_TYPE_PKG, value)[0].toString();
  return { value, objectId };
}
function validatePermissions(value, label) {
  if (!Array.isArray(value))
    throw invalid("schema", `${label} must be an array`);
  return value.map((raw, index) => {
    const item = expectObject$3(raw, `${label}[${index}]`);
    assertKnownFields(item, ["scope_path", "required", "actions", "exp"], `${label}[${index}]`);
    expectNonEmptyString(item.scope_path, `${label}[${index}].scope_path`);
    if (typeof item.required !== "boolean") {
      throw invalid("schema", `${label}[${index}].required must be boolean`);
    }
    if (item.actions !== void 0 && (!Array.isArray(item.actions) || item.actions.some((action) => typeof action !== "string"))) {
      throw invalid("schema", `${label}[${index}].actions must be a string array`);
    }
    if (item.exp !== null && item.exp !== void 0 && (typeof item.exp !== "number" || !Number.isInteger(item.exp) || item.exp < 0 || item.exp > 4294967295)) {
      throw invalid("schema", `${label}[${index}].exp must be null or a uint32`);
    }
    return raw;
  });
}
function validateServiceConfigTips(value, label) {
  const config = expectObject$3(value, label);
  for (const field of [
    "service_endpoints",
    "data_mount_points",
    "local_cache_mount_points",
    "external_mount_points",
    "rdb_instances",
    "bash_envs",
    "runtime_caps"
  ]) {
    if (config[field] !== void 0)
      expectObject$3(config[field], `${label}.${field}`);
  }
  for (const [name, raw] of Object.entries(
    expectObject$3(config.service_endpoints ?? {}, `${label}.service_endpoints`)
  )) {
    const endpoint = expectObject$3(raw, `${label}.service_endpoints.${name}`);
    assertKnownFields(
      endpoint,
      ["protocol", "inner_port", "required", "description", "expose"],
      `${label}.service_endpoints.${name}`
    );
    if (!["http", "https", "tcp", "udp"].includes(String(endpoint.protocol))) {
      throw invalid("schema", `${label}.service_endpoints.${name}.protocol is invalid`);
    }
    expectUint(endpoint.inner_port, `${label}.service_endpoints.${name}.inner_port`, 65535);
    optionalBoolean(endpoint.required, `${label}.service_endpoints.${name}.required`);
    validateStringMap(
      endpoint.description ?? {},
      `${label}.service_endpoints.${name}.description`
    );
    if (endpoint.expose !== void 0 && endpoint.expose !== null) {
      const expose = expectObject$3(endpoint.expose, `${label}.service_endpoints.${name}.expose`);
      assertKnownFields(
        expose,
        ["route", "scope", "allow_guest"],
        `${label}.service_endpoints.${name}.expose`
      );
      const route = expectObject$3(expose.route, `${label}.service_endpoints.${name}.expose.route`);
      if (route.type === "web") {
        assertKnownFields(route, ["type"], `${label}.service_endpoints.${name}.expose.route`);
      } else if (route.type === "port") {
        assertKnownFields(
          route,
          ["type", "preferred_port"],
          `${label}.service_endpoints.${name}.expose.route`
        );
        if (route.preferred_port !== void 0) {
          expectUint(
            route.preferred_port,
            `${label}.service_endpoints.${name}.expose.route.preferred_port`,
            65535
          );
        }
      } else {
        throw invalid("schema", `${label}.service_endpoints.${name}.expose.route.type is invalid`);
      }
      optionalString$2(expose.scope, `${label}.service_endpoints.${name}.expose.scope`);
      optionalBoolean(
        expose.allow_guest,
        `${label}.service_endpoints.${name}.expose.allow_guest`
      );
    }
  }
  for (const field of [
    "data_mount_points",
    "local_cache_mount_points",
    "external_mount_points"
  ]) {
    for (const [name, raw] of Object.entries(expectObject$3(config[field] ?? {}, `${label}.${field}`))) {
      if (raw === null)
        continue;
      const mount = expectObject$3(raw, `${label}.${field}.${name}`);
      assertKnownFields(
        mount,
        ["mount_point_name", "access", "reason"],
        `${label}.${field}.${name}`
      );
      expectNonEmptyString(mount.mount_point_name, `${label}.${field}.${name}.mount_point_name`);
      expectNonEmptyString(mount.access, `${label}.${field}.${name}.access`);
      validateStringMap(mount.reason, `${label}.${field}.${name}.reason`);
    }
  }
  for (const [name, raw] of Object.entries(
    expectObject$3(config.rdb_instances ?? {}, `${label}.rdb_instances`)
  )) {
    const database = expectObject$3(raw, `${label}.rdb_instances.${name}`);
    assertKnownFields(
      database,
      ["backend", "version", "schema", "connection"],
      `${label}.rdb_instances.${name}`
    );
    if (!["sqlite", "postgres"].includes(String(database.backend))) {
      throw invalid("schema", `${label}.rdb_instances.${name}.backend is invalid`);
    }
    if (database.version !== void 0) {
      expectUint(
        database.version,
        `${label}.rdb_instances.${name}.version`,
        Number.MAX_SAFE_INTEGER
      );
    }
    const schemas = validateStringMap(
      database.schema ?? {},
      `${label}.rdb_instances.${name}.schema`
    );
    for (const backend of Object.keys(schemas)) {
      if (!["sqlite", "postgres"].includes(backend)) {
        throw invalid("schema", `${label}.rdb_instances.${name}.schema.${backend} is invalid`);
      }
    }
    optionalString$2(database.connection, `${label}.rdb_instances.${name}.connection`);
  }
  if (config.instance_volume !== void 0) {
    const volume = expectObject$3(config.instance_volume, `${label}.instance_volume`);
    assertKnownFields(
      volume,
      ["mode", "quota_mib", "ephemeral_contents"],
      `${label}.instance_volume`
    );
    if (volume.mode !== void 0 && !["required", "optional", "disabled"].includes(String(volume.mode))) {
      throw invalid("schema", `${label}.instance_volume.mode is invalid`);
    }
    if (volume.quota_mib !== void 0) {
      expectUint(volume.quota_mib, `${label}.instance_volume.quota_mib`, Number.MAX_SAFE_INTEGER);
    }
    if (volume.ephemeral_contents !== void 0 && (!Array.isArray(volume.ephemeral_contents) || volume.ephemeral_contents.some((item) => typeof item !== "string"))) {
      throw invalid("schema", `${label}.instance_volume.ephemeral_contents must be a string array`);
    }
  }
  for (const [name, raw] of Object.entries(expectObject$3(config.bash_envs ?? {}, `${label}.bash_envs`))) {
    const environment2 = expectObject$3(raw, `${label}.bash_envs.${name}`);
    assertKnownFields(environment2, ["required", "description"], `${label}.bash_envs.${name}`);
    if (typeof environment2.required !== "boolean") {
      throw invalid("schema", `${label}.bash_envs.${name}.required must be boolean`);
    }
    validateStringMap(environment2.description ?? {}, `${label}.bash_envs.${name}.description`);
  }
  validateStringMap(config.runtime_caps ?? {}, `${label}.runtime_caps`);
  optionalString$2(config.container_param, `${label}.container_param`);
  optionalString$2(config.start_param, `${label}.start_param`);
  return config;
}
function appDocObjectId(value) {
  return ndn.buildNamedObjectByJson("appdoc", value)[0].toString();
}
async function validateSnapshot(distDir, appDoc, packageMeta) {
  const payloads = /* @__PURE__ */ new Map();
  for (const entryValue of Object.values(packageMeta.content_index)) {
    const entry = validateContentIndexEntry(entryValue, "content_index");
    const path = join$1(distDir, entry.path);
    const digest = await digestFile(path);
    payloads.set(entry.path, digest);
  }
  return validateObjectGraph(appDoc, packageMeta, payloads, true, false, true);
}
async function packSnapshot(distDir, destination, appDoc, packageMeta) {
  const validated = await validateSnapshot(distDir, appDoc, packageMeta);
  const encoder = new TextEncoder();
  await writeStoredZip(destination, [
    { name: APPDOC_ENTRY, bytes: encoder.encode(`${JSON.stringify(appDoc, null, 2)}
`) },
    {
      name: PACKAGE_META_ENTRY,
      bytes: encoder.encode(`${JSON.stringify(packageMeta, null, 2)}
`)
    },
    ...validated.subpackages.map((subpackage) => ({
      name: subpackage.payload_path,
      path: join$1(distDir, subpackage.payload_path)
    }))
  ]);
}
async function inspectPikg(path) {
  const archive = await openZip(path);
  let metadataTotal = 0;
  for (const entry of archive.entries) {
    if (entry.name === APPDOC_ENTRY || entry.name === APPDOC_JWT_ENTRY || entry.name === PACKAGE_META_ENTRY || entry.name.startsWith("objects/") && entry.name.endsWith(".json")) {
      const limit = entry.name === APPDOC_ENTRY || entry.name === APPDOC_JWT_ENTRY ? MAX_APPDOC_BYTES : MAX_METADATA_ENTRY_BYTES;
      if (entry.size > limit)
        throw invalid("limits", `metadata entry exceeds limit: ${entry.name}`);
      metadataTotal += entry.size;
    }
  }
  if (metadataTotal > MAX_METADATA_TOTAL_BYTES) {
    throw invalid("limits", "PIKG metadata exceeds the total size limit");
  }
  if (archive.byName.has("APPDOC.wt")) {
    throw invalid("appdoc", "legacy APPDOC.wt is not supported");
  }
  const jsonEntry = archive.byName.get(APPDOC_ENTRY);
  const jwtEntry = archive.byName.get(APPDOC_JWT_ENTRY);
  if (!jsonEntry && !jwtEntry)
    throw invalid("appdoc", "PIKG has no App Document");
  const jsonDoc = jsonEntry ? parseJsonObject(
    await readZipEntry(archive, jsonEntry, MAX_APPDOC_BYTES),
    APPDOC_ENTRY
  ) : void 0;
  const jwt = jwtEntry ? new TextDecoder("utf-8", { fatal: true }).decode(
    await readZipEntry(archive, jwtEntry, MAX_APPDOC_BYTES)
  ).trim() : void 0;
  const jwtDoc = jwt ? decodeJwtClaims(jwt) : void 0;
  if (jsonDoc && jwtDoc && appDocObjectId(jsonDoc) !== appDocObjectId(jwtDoc)) {
    throw invalid("appdoc", "APPDOC.json and APPDOC.jwt have different canonical documents");
  }
  const appDoc = jwtDoc ?? jsonDoc;
  const metaEntry = archive.byName.get(PACKAGE_META_ENTRY);
  if (!metaEntry)
    throw invalid("package-meta", "PACKAGE_META.json is required");
  const packageMeta = parsePackageMeta(
    parseJsonObject(
      await readZipEntry(archive, metaEntry, MAX_METADATA_ENTRY_BYTES),
      PACKAGE_META_ENTRY
    )
  );
  for (const entry of archive.entries.filter((candidate) => candidate.name.startsWith("objects/"))) {
    const match = /^objects\/([^/]+)\.json$/.exec(entry.name);
    if (!match) {
      throw invalid(
        "object-graph",
        `invalid object entry path: ${entry.name}`,
        entry.name
      );
    }
    let objectId;
    try {
      objectId = ndn.ObjId.fromString(match[1]);
    } catch {
      throw invalid("object-graph", `invalid object entry ID: ${entry.name}`, entry.name);
    }
    const value = parseJsonValue(
      await readZipEntry(archive, entry, MAX_METADATA_ENTRY_BYTES),
      entry.name
    );
    const computed = ndn.buildNamedObjectByJson(objectId.objType, value)[0];
    if (!computed.equals(objectId)) {
      throw invalid("object-graph", `object entry ID mismatch: ${entry.name}`, entry.name);
    }
  }
  const payloads = /* @__PURE__ */ new Map();
  for (const value of Object.values(packageMeta.content_index)) {
    const content = validateContentIndexEntry(value, "content_index");
    const entry = archive.byName.get(content.path);
    if (!entry)
      throw invalid("content-index", `content entry is missing: ${content.path}`);
    if (entry.size !== content.size) {
      throw invalid("content-index", `content entry size mismatch: ${content.path}`, content.path);
    }
    const expected = parseSha256(content.digest, `content_index.${content.digest}`);
    payloads.set(content.path, await verifyZipEntry(archive, entry, expected));
  }
  const validated = validateObjectGraph(
    appDoc,
    packageMeta,
    payloads,
    Boolean(jsonEntry),
    Boolean(jwtEntry),
    !jsonDoc || !jwtDoc || appDocObjectId(jsonDoc) === appDocObjectId(jwtDoc)
  );
  const pikgDigest = await digestFile(path);
  return {
    schema_version: 1,
    protocol: PACKAGE_META_SCHEMA,
    pikg_path: resolve$2(path),
    size: pikgDigest.size,
    pikg_digest: `sha256:${pikgDigest.sha256}`,
    valid: true,
    app: {
      did: String(appDoc.did),
      app_id: appIdFromDid(String(appDoc.did)),
      version: String(appDoc.version),
      owner: String(appDoc.owner),
      app_doc_object_id: validated.appDocObjectId
    },
    app_doc_form: jsonEntry && jwtEntry ? "both" : jwtEntry ? "signed" : "unsigned",
    canonical_match: validated.canonicalMatch,
    subpackages: validated.subpackages.map((subpackage) => ({
      key: subpackage.key,
      selector: subpackage.selector,
      required: subpackage.required,
      pkg_id: subpackage.pkg_id,
      pkg_objid: subpackage.pkg_objid,
      payload: {
        path: subpackage.payload_path,
        size: subpackage.payload_size,
        digest: subpackage.payload_digest
      },
      ...subpackage.docker_image_name ? { docker_image_name: subpackage.docker_image_name } : {},
      ...subpackage.docker_image_digest ? { docker_image_digest: subpackage.docker_image_digest } : {}
    })),
    offline_content_validation: "passed",
    signature_validation: jwtEntry ? "not-resolvable-offline" : "not-present",
    publication_validation: "not-checked"
  };
}
function parsePackageMeta(value) {
  try {
    rejectUnknown(
      value,
      ["@schema", "app_doc_id", "package_objects", "content_index"],
      PACKAGE_META_ENTRY
    );
  } catch (error) {
    if (error instanceof UsageError)
      throw invalid("package-meta", error.message);
    throw error;
  }
  if (value["@schema"] !== PACKAGE_META_SCHEMA) {
    throw invalid("package-meta", `unsupported PACKAGE_META.json schema: ${value["@schema"]}`);
  }
  const appDocId = expectNonEmptyString(value.app_doc_id, "PACKAGE_META.json.app_doc_id");
  if (!OBJECT_ID$1.test(appDocId) || !appDocId.startsWith("appdoc:")) {
    throw invalid("package-meta", "PACKAGE_META.json.app_doc_id is invalid");
  }
  const packageObjects = expectObject$3(value.package_objects, "PACKAGE_META.json.package_objects");
  const contentIndex = expectObject$3(value.content_index, "PACKAGE_META.json.content_index");
  return {
    "@schema": PACKAGE_META_SCHEMA,
    app_doc_id: appDocId,
    package_objects: packageObjects,
    content_index: contentIndex
  };
}
function validateObjectGraph(appDoc, packageMeta, payloads, hasJson, hasSigned, canonicalMatch) {
  validateAppDocShape(appDoc);
  const appId = appDocObjectId(appDoc);
  if (packageMeta.app_doc_id !== appId) {
    throw invalid("object-graph", "PACKAGE_META.json app_doc_id does not match APPDOC");
  }
  const appVersion = String(appDoc.version);
  const namespace = deriveNamespaceForPackage(appDoc);
  const pkgList = appDoc.pkg_list;
  const referenced = /* @__PURE__ */ new Set();
  const subpackages = [];
  const contentBySubpackage = /* @__PURE__ */ new Map();
  for (const [digest, raw] of Object.entries(packageMeta.content_index)) {
    const entry = validateContentIndexEntry(raw, `content_index.${digest}`);
    if (entry.digest !== digest)
      throw invalid("content-index", `digest key mismatch: ${digest}`);
    const expectedHex = parseSha256(digest, `content_index.${digest}`);
    const payload = payloads.get(entry.path);
    if (!payload)
      throw invalid("content-index", `payload is missing: ${entry.path}`, entry.path);
    if (payload.size !== entry.size || payload.sha256 !== expectedHex) {
      throw invalid("content", `payload does not match content index: ${entry.path}`, entry.path);
    }
    if (contentBySubpackage.has(entry.sub_pkg_name)) {
      throw invalid("content-index", `subpackage has more than one payload: ${entry.sub_pkg_name}`);
    }
    contentBySubpackage.set(entry.sub_pkg_name, entry);
  }
  const dependencyNames = /* @__PURE__ */ new Set();
  for (const [key, rawDesc] of Object.entries(pkgList).sort(
    ([left], [right]) => left.localeCompare(right)
  )) {
    validateSubpackageNameForPackage(key);
    const desc = expectObject$3(rawDesc, `APPDOC.pkg_list.${key}`);
    rejectUnknown(
      desc,
      [
        "pkg_id",
        "pkg_objid",
        "docker_image_name",
        "docker_image_digest",
        "source_url",
        "selector",
        "required"
      ],
      `APPDOC.pkg_list.${key}`
    );
    if (desc.source_url !== void 0) {
      throw invalid("self-contained", `source_url is not allowed for bundled App: ${key}`);
    }
    const pkgId = expectNonEmptyString(desc.pkg_id, `APPDOC.pkg_list.${key}.pkg_id`);
    const parsedId = parsePackageId(pkgId, key);
    if (parsedId.version !== appVersion) {
      throw invalid("namespace", `subpackage ${key} must use App version ${appVersion}`);
    }
    const uniqueName = packageUniqueName(parsedId.name, key);
    const namespacePrefix = uniqueName.endsWith(`.${namespace}`) ? uniqueName.slice(0, -namespace.length - 1) : void 0;
    if (uniqueName !== namespace && (!namespacePrefix || namespacePrefix.includes(".") || !/^[a-z0-9][a-z0-9_-]*$/.test(namespacePrefix))) {
      throw invalid("namespace", `subpackage ${key} is outside App package namespace`);
    }
    const pkgObjid = expectNonEmptyString(desc.pkg_objid, `APPDOC.pkg_list.${key}.pkg_objid`);
    if (!OBJECT_ID$1.test(pkgObjid) || !pkgObjid.startsWith("pkg:")) {
      throw invalid("object-graph", `subpackage ${key} has an invalid pkg_objid`);
    }
    const packageObject = packageMeta.package_objects[pkgObjid];
    if (!packageObject)
      throw invalid("object-graph", `PackageMeta is missing for ${key}`);
    const computed = ndn.buildNamedObjectByJson(ndn.OBJ_TYPE_PKG, packageObject)[0].toString();
    if (computed !== pkgObjid) {
      throw invalid("object-graph", `PackageMeta Object ID mismatch: ${key}`);
    }
    const metaName = expectNonEmptyString(packageObject.name, `PackageMeta(${key}).name`);
    const metaVersion = expectNonEmptyString(packageObject.version, `PackageMeta(${key}).version`);
    if (metaName !== parsedId.name || metaVersion !== parsedId.version) {
      throw invalid("namespace", `PackageMeta identity does not match pkg_id: ${key}`);
    }
    if (packageObject.owner !== appDoc.owner || packageObject.author !== appDoc.author) {
      throw invalid("namespace", `PackageMeta owner/author does not match AppDoc: ${key}`);
    }
    const metaDeps = packageObject.deps;
    if (metaDeps !== void 0 && Object.keys(expectObject$3(metaDeps, `PackageMeta(${key}).deps`)).length) {
      throw invalid(
        "self-contained",
        `third-party PackageMeta dependencies are not allowed: ${key}`
      );
    }
    const entry = contentBySubpackage.get(key);
    if (!entry)
      throw invalid("content-index", `content index is missing for ${key}`);
    if (entry.path !== `${key}.tar.gz` || entry.format !== "tar.gz") {
      throw invalid("content-index", `subpackage ${key} has a noncanonical payload path`);
    }
    const metaSize = expectSafeInteger(packageObject.size, `PackageMeta(${key}).size`);
    if (metaSize !== entry.size)
      throw invalid("content", `PackageMeta size mismatch: ${key}`);
    validateChunkContent(
      expectNonEmptyString(packageObject.content, `PackageMeta(${key}).content`),
      entry.size,
      parseSha256(entry.digest, `content_index.${entry.digest}`),
      key
    );
    const selector = canonicalSelectorForPackage(desc.selector, `APPDOC.pkg_list.${key}.selector`);
    assertSelectorForPackage(key, selector);
    if (desc.required !== void 0 && typeof desc.required !== "boolean") {
      throw invalid("appdoc", `required must be boolean: ${key}`);
    }
    const dockerImageName = optionalNonEmptyString(
      desc.docker_image_name,
      `APPDOC.pkg_list.${key}.docker_image_name`
    );
    const dockerImageDigest = optionalNonEmptyString(
      desc.docker_image_digest,
      `APPDOC.pkg_list.${key}.docker_image_digest`
    );
    if (dockerImageDigest && !SHA256_DIGEST.test(dockerImageDigest)) {
      throw invalid("appdoc", `invalid Docker image digest: ${key}`);
    }
    referenced.add(pkgObjid);
    dependencyNames.add(metaName);
    subpackages.push({
      key,
      selector: selector ?? derivedSelector(key) ?? null,
      required: desc.required === void 0 ? true : desc.required,
      pkg_id: pkgId,
      pkg_objid: pkgObjid,
      payload_path: entry.path,
      payload_size: entry.size,
      payload_digest: entry.digest,
      ...dockerImageName ? { docker_image_name: dockerImageName } : {},
      ...dockerImageDigest ? { docker_image_digest: dockerImageDigest } : {}
    });
  }
  if (subpackages.length === 0)
    throw invalid("appdoc", "AppDoc.pkg_list must not be empty");
  for (const key of Object.keys(packageMeta.package_objects)) {
    if (!referenced.has(key)) {
      throw invalid("object-graph", `unreferenced PackageMeta object: ${key}`);
    }
  }
  if (contentBySubpackage.size !== subpackages.length) {
    throw invalid("content-index", "content index and pkg_list have different subpackages");
  }
  if (dependencyNames.size !== subpackages.length) {
    throw invalid("self-contained", "AppDoc package identities are not unique");
  }
  return {
    appDoc,
    appDocObjectId: appId,
    packageMeta,
    subpackages,
    hasJsonAppDoc: hasJson,
    hasSignedAppDoc: hasSigned,
    canonicalMatch
  };
}
function validateAppDocShape(appDoc) {
  rejectUnknown(
    appDoc,
    [
      "schema_version",
      "doc_type",
      "did",
      "name",
      "copyright",
      "tags",
      "categories",
      "base_on",
      "directory",
      "references",
      "version",
      "version_tag",
      "app_type",
      "owner",
      "controller",
      "author",
      "create_time",
      "last_update_time",
      "exp",
      "pkg_list",
      "show_name",
      "presentation",
      "sdk_version",
      "req_capbilities",
      "permissions",
      "selector_type",
      "service_config_tips"
    ],
    "APPDOC"
  );
  if (appDoc.schema_version !== 1) {
    throw invalid("appdoc", "APPDOC.schema_version must be 1");
  }
  for (const field of [
    "did",
    "version",
    "app_type",
    "owner",
    "controller",
    "author",
    "show_name",
    "selector_type"
  ]) {
    expectNonEmptyString(appDoc[field], `APPDOC.${field}`);
  }
  if (appDoc.doc_type !== "app")
    throw invalid("appdoc", "APPDOC.doc_type must be app");
  if (!["service", "dapp", "web", "agent"].includes(String(appDoc.app_type))) {
    throw invalid("appdoc", "APPDOC.app_type is invalid");
  }
  if (appDoc.name !== void 0)
    expectNonEmptyString(appDoc.name, "APPDOC.name");
  optionalString$2(appDoc.copyright, "APPDOC.copyright");
  for (const field of ["tags", "categories"]) {
    const values = appDoc[field];
    if (values !== void 0 && (!Array.isArray(values) || values.length === 0 || values.some((value) => typeof value !== "string"))) {
      throw invalid("appdoc", `APPDOC.${field} must be a non-empty string array when present`);
    }
  }
  if (appDoc.base_on !== void 0) {
    const baseOn = expectNonEmptyString(appDoc.base_on, "APPDOC.base_on");
    try {
      ndn.ObjId.fromString(baseOn);
    } catch {
      throw invalid("appdoc", "APPDOC.base_on must be an ObjectId");
    }
  }
  for (const field of ["directory", "references"]) {
    if (appDoc[field] === void 0)
      continue;
    const entries = expectObject$3(appDoc[field], `APPDOC.${field}`);
    if (Object.keys(entries).length === 0) {
      throw invalid("appdoc", `APPDOC.${field} must not be empty when present`);
    }
    for (const [key, value] of Object.entries(entries)) {
      expectObject$3(value, `APPDOC.${field}.${key}`);
    }
  }
  expectSafeInteger(appDoc.create_time, "APPDOC.create_time");
  expectSafeInteger(appDoc.last_update_time, "APPDOC.last_update_time");
  if (expectSafeInteger(appDoc.exp, "APPDOC.exp") === 0) {
    throw invalid("appdoc", "APPDOC.exp must be greater than zero");
  }
  appIdFromDid(String(appDoc.did));
  parseDid(String(appDoc.owner), "owner");
  parseDid(String(appDoc.controller), "controller");
  parseDid(String(appDoc.author), "author");
  if (appDoc.permissions !== void 0 && !Array.isArray(appDoc.permissions)) {
    throw invalid("appdoc", "APPDOC.permissions must be an array");
  }
  validatePermissions(appDoc.permissions ?? [], "APPDOC.permissions");
  validateServiceConfigTips(appDoc.service_config_tips, "APPDOC.service_config_tips");
  const pkgList = expectObject$3(appDoc.pkg_list, "APPDOC.pkg_list");
  if (Object.keys(pkgList).length === 0) {
    throw invalid("appdoc", "APPDOC.pkg_list must not be empty");
  }
  deriveNamespaceForPackage(appDoc);
}
function deriveNamespaceForPackage(appDoc) {
  try {
    return deriveAppNamespace(String(appDoc.did));
  } catch (error) {
    if (error instanceof UsageError)
      throw invalid("namespace", error.message);
    throw error;
  }
}
function validateContentIndexEntry(value, label) {
  const entry = expectObject$3(value, label);
  rejectUnknown(entry, ["sub_pkg_name", "path", "format", "size", "digest"], label);
  const subpackage = expectNonEmptyString(entry.sub_pkg_name, `${label}.sub_pkg_name`);
  validateSubpackageNameForPackage(subpackage);
  const path = expectNonEmptyString(entry.path, `${label}.path`);
  if (path !== `${subpackage}.tar.gz`) {
    throw invalid("content-index", `invalid payload path: ${path}`);
  }
  if (entry.format !== "tar.gz")
    throw invalid("content-index", `invalid payload format: ${path}`);
  const size = expectSafeInteger(entry.size, `${label}.size`);
  const digest = expectNonEmptyString(entry.digest, `${label}.digest`);
  parseSha256(digest, `${label}.digest`);
  return { sub_pkg_name: subpackage, path, format: "tar.gz", size, digest };
}
function validateChunkContent(content, size, sha256, key) {
  let chunk;
  try {
    chunk = ndn.ChunkId.fromString(content);
  } catch {
    throw invalid("content", `PackageMeta content is not a ChunkId: ${key}`);
  }
  if (!["sha256", "mix256"].includes(chunk.chunkType)) {
    throw invalid("content", `unsupported PackageMeta ChunkId type: ${key}`);
  }
  const hash = ndn.hexToBytes(sha256);
  const expected = chunk.chunkType === "mix256" ? ndn.ChunkId.fromMix256Result(size, hash) : ndn.ChunkId.fromSha256Result(hash);
  if (chunk.toString() !== expected.toString()) {
    throw invalid("content", `PackageMeta ChunkId digest mismatch: ${key}`);
  }
}
function parsePackageId(value, key) {
  const parts = value.split("#");
  if (parts.length !== 2 || !parts[0] || !parts[1] || parts[1].startsWith("$")) {
    throw invalid("namespace", `subpackage ${key} must use an exact-version pkg_id`);
  }
  return { name: parts[0], version: parts[1] };
}
function packageUniqueName(packageName, key) {
  const parts = packageName.split(".");
  const environments = /* @__PURE__ */ new Set([
    "all",
    "nightly-linux-amd64",
    "nightly-linux-aarch64",
    "nightly-windows-amd64",
    "nightly-windows-aarch64",
    "nightly-apple-amd64",
    "nightly-apple-aarch64"
  ]);
  const unique = parts.length > 1 && environments.has(parts[0]) ? parts.slice(1).join(".") : parts.join(".");
  if (!unique || unique.split(".").some((label) => !/^[a-z0-9][a-z0-9_-]*$/.test(label))) {
    throw invalid("namespace", `subpackage ${key} has an invalid package name`);
  }
  return unique;
}
function decodeJwtClaims(jwt) {
  const segments = jwt.split(".");
  if (segments.length !== 3 || !segments[1])
    throw invalid("appdoc", "APPDOC.jwt is malformed");
  try {
    const normalized = segments[1].replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return parseJsonObject(bytes, APPDOC_JWT_ENTRY);
  } catch (error) {
    if (error instanceof ToolError)
      throw error;
    throw invalid("appdoc", "APPDOC.jwt claims are not valid JSON");
  }
}
function parseJsonObject(bytes, label) {
  return expectObject$3(parseJsonValue(bytes, label), label);
}
function parseJsonValue(bytes, label) {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof ToolError)
      throw error;
    throw invalid("metadata", `${label} is not valid JSON`);
  }
}
function parseDid(value, label) {
  const match = /^did:([a-z0-9]+):(.+)$/.exec(value);
  if (!match)
    throw new UsageError("INVALID_DID", `${label} must be a DID`);
  return { method: match[1], id: match[2] };
}
function parseSha256(value, label) {
  const match = SHA256_DIGEST.exec(value);
  if (!match)
    throw invalid("digest", `${label} must be sha256:<64 lowercase hex>`);
  return match[1].toLowerCase();
}
function canonicalSelectorForPackage(value, label) {
  try {
    return canonicalSelector(value, label);
  } catch (error) {
    if (error instanceof UsageError)
      throw invalid("appdoc", error.message);
    throw error;
  }
}
function assertSelectorForPackage(key, selector) {
  try {
    assertSelectorCompatible(key, selector, `APPDOC.pkg_list.${key}.selector`);
  } catch (error) {
    if (error instanceof UsageError)
      throw invalid("appdoc", error.message);
    throw error;
  }
}
function validateSubpackageNameForPackage(name) {
  try {
    validateSubpackageName(name);
  } catch (error) {
    if (error instanceof UsageError)
      throw invalid("appdoc", error.message);
    throw error;
  }
}
function expectObject$3(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalid("schema", `${label} must be an object`);
  }
  return value;
}
function expectNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw invalid("schema", `${label} must be a string`);
  }
  return value;
}
function optionalNonEmptyString(value, label) {
  return value === void 0 ? void 0 : expectNonEmptyString(value, label);
}
function expectSafeInteger(value, label) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw invalid("schema", `${label} must be a non-negative safe integer`);
  }
  return value;
}
function expectUint(value, label, maximum) {
  const result = expectSafeInteger(value, label);
  if (result > maximum)
    throw invalid("schema", `${label} is too large`);
  return result;
}
function optionalBoolean(value, label) {
  if (value !== void 0 && typeof value !== "boolean") {
    throw invalid("schema", `${label} must be boolean`);
  }
}
function optionalString$2(value, label) {
  if (value !== void 0 && typeof value !== "string") {
    throw invalid("schema", `${label} must be a string`);
  }
}
function validateStringMap(value, label) {
  const result = expectObject$3(value, label);
  if (Object.values(result).some((item) => typeof item !== "string")) {
    throw invalid("schema", `${label} values must be strings`);
  }
  return result;
}
function assertKnownFields(value, allowed, label) {
  const accepted = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !accepted.has(key));
  if (unknown)
    throw invalid("schema", `${label}.${unknown} is not allowed`);
}
function rejectUnknown(value, allowed, label) {
  const accepted = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !accepted.has(key));
  if (unknown.length) {
    throw new UsageError("SCHEMA_VALIDATION_FAILED", `${label}.${unknown[0]} is not allowed`);
  }
}
function invalid(stage, message, entry) {
  return new ToolError("INVALID_PACKAGE", message, 6, false, {
    stage,
    ...entry ? { entry: basename$1(entry) } : {}
  });
}
function stableJsonDigest(value) {
  return sha256Bytes(new TextEncoder().encode(ndn.toCanonicalJsonString(value)));
}
const PACKAGE_VERSION = "0.7.117";
const TOOL_VERSION = PACKAGE_VERSION;
const SDK_VERSION = PACKAGE_VERSION;
const PROTOCOL_VERSION = "1";
const basename = (path) => getHost().path.basename(path);
const dirname = (path) => getHost().path.dirname(path);
const isAbsolute$1 = (path) => getHost().path.isAbsolute(path);
const join = (...parts) => getHost().path.join(...parts);
const relative = (from, to) => getHost().path.relative(from, to);
const resolve$1 = (...parts) => getHost().path.resolve(...parts);
const APP_DOCUMENT_LIFETIME_SECONDS = 5 * 365 * 24 * 60 * 60;
const SAFE_PIKG_FILE = /^[A-Za-z0-9._-]+\.pikg$/;
const APP_NAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const VERSION$1 = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SHA256_ID = /^sha256:[0-9a-f]{64}$/;
const OBJECT_ID = /^(?:appdoc|pkg):[0-9a-f]{64}$/;
const SAFE_GENERATED_FILE = /^[A-Za-z0-9._-]+$/;
const OBJECT_OUTPUT$4 = { type: "object", additionalProperties: true };
function packageEnvironmentQualifier(key, selector) {
  const effective = selector ?? derivedSelector(key);
  const os = effective?.os;
  const arch = effective?.arch;
  if (!os || !arch)
    return "all";
  const environmentOs = os === "macos" ? "apple" : os;
  const environmentArch = arch === "x86_64" ? "amd64" : arch;
  const qualifier = `nightly-${environmentOs}-${environmentArch}`;
  return (/* @__PURE__ */ new Set([
    "nightly-linux-amd64",
    "nightly-linux-aarch64",
    "nightly-windows-amd64",
    "nightly-windows-aarch64",
    "nightly-apple-amd64",
    "nightly-apple-aarch64"
  ])).has(qualifier) ? qualifier : "all";
}
function createPikgModule(dependencies = {}) {
  const docker = dependencies.docker ?? new LocalDockerClient();
  const now = dependencies.now ?? reproducibleBuildTimestamp;
  return {
    name: "pikg",
    summary: "Build and verify local PIKG release candidates",
    commands: [
      {
        verb: "doctor",
        summary: "Inspect the local SDK, Tool, host policy, metadata, and target profile",
        positionals: [
          { name: "meta_dir", description: "dapp_meta directory", required: false }
        ],
        inputSchema: {
          type: "object",
          properties: { meta_dir: { type: "string", minLength: 1 } },
          additionalProperties: false
        },
        outputSchema: OBJECT_OUTPUT$4,
        resultSchemaVersion: 1,
        access: { mode: "fixed", level: "read" },
        asyncMode: "sync",
        requiresSession: false,
        execution: "local",
        networkAccess: false,
        examples: ["buckyos pikg doctor", "buckyos pikg doctor ./dapp_meta"],
        handler: async (ctx, input) => await doctorCommand(ctx, input)
      },
      {
        verb: "init",
        summary: "Create local PIKG development metadata",
        description: "Creates only dapp_meta/app.json and dapp_meta/pikg.json.",
        positionals: [
          { name: "project_dir", description: "Existing App project directory", required: false }
        ],
        options: [
          { name: "name", description: "App name", type: "string" },
          { name: "owner", description: "Owner DID", type: "string" },
          {
            name: "kind",
            description: "Initial App kind",
            type: "string",
            enum: ["static-web", "script", "docker"]
          },
          {
            name: "source",
            description: "Build output path or local Docker image",
            type: "string"
          },
          { name: "version", description: "Initial App version", type: "string" },
          { name: "app-did", property: "app_did", description: "Explicit App DID", type: "string" }
        ],
        inputSchema: {
          type: "object",
          properties: {
            project_dir: { type: "string", minLength: 1 },
            name: { type: "string", minLength: 1 },
            owner: { type: "string", minLength: 1 },
            kind: { type: "string", enum: ["static-web", "script", "docker"] },
            source: { type: "string", minLength: 1 },
            version: { type: "string", minLength: 1 },
            app_did: { type: "string", minLength: 1 }
          },
          additionalProperties: false
        },
        outputSchema: OBJECT_OUTPUT$4,
        resultSchemaVersion: 1,
        access: { mode: "fixed", level: "write" },
        asyncMode: "sync",
        requiresSession: false,
        execution: "local",
        networkAccess: false,
        examples: [
          "buckyos pikg init .",
          "buckyos --non-interactive pikg init . --owner did:bns:root --kind static-web --source ./web/dist"
        ],
        handler: async (ctx, input) => await initCommand(ctx, input, docker)
      },
      {
        verb: "build",
        summary: "Build a managed dapp_dist snapshot",
        positionals: [
          { name: "meta_dir", description: "dapp_meta directory", required: false }
        ],
        inputSchema: {
          type: "object",
          properties: { meta_dir: { type: "string", minLength: 1 } },
          additionalProperties: false
        },
        outputSchema: OBJECT_OUTPUT$4,
        resultSchemaVersion: 1,
        access: { mode: "fixed", level: "write" },
        asyncMode: "sync",
        requiresSession: false,
        execution: "local",
        networkAccess: false,
        examples: ["buckyos pikg build ./dapp_meta"],
        handler: async (ctx, input) => await buildCommand(ctx, input, docker, now)
      },
      {
        verb: "pack",
        summary: "Pack and verify a complete PIKG",
        positionals: [
          { name: "dist_dir", description: "Managed dapp_dist directory", required: false }
        ],
        inputSchema: {
          type: "object",
          properties: { dist_dir: { type: "string", minLength: 1 } },
          additionalProperties: false
        },
        outputSchema: OBJECT_OUTPUT$4,
        resultSchemaVersion: 1,
        access: { mode: "fixed", level: "write" },
        asyncMode: "sync",
        requiresSession: false,
        execution: "local",
        networkAccess: false,
        examples: ["buckyos pikg pack ./dapp_dist"],
        handler: async (ctx, input) => await packCommand(ctx, input)
      },
      {
        verb: "info",
        summary: "Strictly verify and inspect a local PIKG",
        positionals: [{ name: "pikg_path", description: "Local .pikg file" }],
        inputSchema: {
          type: "object",
          properties: { pikg_path: { type: "string", minLength: 1 } },
          required: ["pikg_path"],
          additionalProperties: false
        },
        outputSchema: OBJECT_OUTPUT$4,
        resultSchemaVersion: 1,
        access: { mode: "fixed", level: "read" },
        asyncMode: "sync",
        requiresSession: false,
        execution: "local",
        networkAccess: false,
        examples: ["buckyos pikg info ./dapp_dist/demo-0.1.0.pikg"],
        handler: async (ctx, input) => await inspectPikg(resolveFromCwd$1(ctx, expectInputString(input, "pikg_path")))
      },
      {
        verb: "clean",
        summary: "Safely delete a managed dapp_dist",
        positionals: [
          { name: "meta_dir", description: "dapp_meta directory", required: false }
        ],
        inputSchema: {
          type: "object",
          properties: { meta_dir: { type: "string", minLength: 1 } },
          additionalProperties: false
        },
        outputSchema: OBJECT_OUTPUT$4,
        resultSchemaVersion: 1,
        access: { mode: "fixed", level: "destructive" },
        asyncMode: "sync",
        requiresSession: false,
        execution: "local",
        networkAccess: false,
        examples: ["buckyos --non-interactive --yes pikg clean ./dapp_meta"],
        handler: async (ctx, input) => await cleanCommand(ctx, input)
      }
    ]
  };
}
function reproducibleBuildTimestamp() {
  const configured = getHost().env("SOURCE_DATE_EPOCH");
  if (configured === void 0)
    return Math.floor(Date.now() / 1e3);
  if (!/^\d+$/.test(configured)) {
    throw new UsageError(
      "INVALID_SOURCE_DATE_EPOCH",
      "SOURCE_DATE_EPOCH must be a non-negative integer number of seconds"
    );
  }
  const seconds = Number(configured);
  if (!Number.isSafeInteger(seconds)) {
    throw new UsageError(
      "INVALID_SOURCE_DATE_EPOCH",
      "SOURCE_DATE_EPOCH is outside the supported integer range"
    );
  }
  return seconds;
}
async function doctorCommand(ctx, input) {
  const metaInput = optionalInputString(input, "meta_dir") ?? "./dapp_meta";
  const metaDir = resolveFromCwd$1(ctx, metaInput);
  const checks = [];
  let appMeta;
  let pikgMeta;
  for (const [name, path] of [
    ["app_metadata", join(metaDir, "app.json")],
    ["pikg_metadata", join(metaDir, "pikg.json")]
  ]) {
    try {
      const value = await readJson(path, name);
      if (name === "app_metadata")
        appMeta = value;
      else
        pikgMeta = value;
      checks.push({ name, status: "ok", path });
    } catch (error) {
      checks.push({
        name,
        status: isHostError(error, "NotFound") ? "missing" : "error",
        path,
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }
  if (appMeta && pikgMeta) {
    try {
      const app = parseAppMeta(appMeta);
      const pikg = parsePikgMeta(pikgMeta, app);
      const missingSources = [];
      for (const subpackage of Object.values(pikg.sub_pkgs)) {
        if (subpackage.source.type !== "path")
          continue;
        const source = resolve$1(metaDir, subpackage.source.path);
        try {
          await getHost().lstat(source);
        } catch (error) {
          if (isHostError(error, "NotFound"))
            missingSources.push(source);
          else
            throw error;
        }
      }
      checks.push({
        name: "build_outputs",
        status: missingSources.length === 0 ? "ok" : "missing",
        missing: missingSources
      });
    } catch (error) {
      checks.push({
        name: "metadata_schema",
        status: "error",
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }
  const globalConfig = await ctx.configStore.readConfig();
  const profileName = ctx.config.profileName ?? globalConfig.default_profile;
  const profile = profileName ? await ctx.configStore.readProfile(profileName) : void 0;
  const host2 = getHost();
  return {
    healthy: checks.every((check) => check.status === "ok"),
    tool_version: TOOL_VERSION,
    sdk_version: SDK_VERSION,
    protocol_version: PROTOCOL_VERSION,
    ...policyView(host2),
    distribution_manifest: distributionManifestView(await readDistributionManifest(host2)),
    target: {
      profile: profileName ?? null,
      zone: ctx.config.zone ?? profile?.zone ?? null,
      endpoint: ctx.config.endpoint ?? profile?.endpoint ?? null,
      compatibility: "not-checked"
    },
    identity_candidates: await identityCandidateView(ctx.config),
    checks
  };
}
async function initCommand(ctx, input, docker) {
  const projectInput = optionalInputString(input, "project_dir") ?? ".";
  const projectDir = await realDirectory(resolveFromCwd$1(ctx, projectInput), "project directory");
  let name = optionalInputString(input, "name") ?? normalizeAppName(basename(projectDir));
  const canPrompt = !ctx.config.nonInteractive && !ctx.interactive && ctx.io.inputIsTerminal;
  if (!name)
    name = await requiredPrompt(ctx, canPrompt, "App name: ", "name");
  let owner = optionalInputString(input, "owner");
  if (!owner)
    owner = await requiredPrompt(ctx, canPrompt, "Owner DID: ", "owner");
  let kind = optionalInputString(input, "kind");
  if (!kind) {
    kind = await requiredPrompt(
      ctx,
      canPrompt,
      "App kind (static-web/script/docker): ",
      "kind"
    );
  }
  if (!["static-web", "script", "docker"].includes(kind)) {
    throw new UsageError("INVALID_APP_KIND", `invalid App kind: ${kind}`);
  }
  let source = optionalInputString(input, "source");
  if (!source)
    source = await requiredPrompt(ctx, canPrompt, "Source: ", "source");
  const version = optionalInputString(input, "version") ?? "0.1.0";
  validateAppName(name);
  validateVersion(version);
  const derivedDid = deriveAppDid(name, owner);
  const appDid = optionalInputString(input, "app_did") ?? derivedDid;
  deriveAppNamespace(appDid);
  let subpackageKey;
  let sourceValue;
  let selector;
  let sourceSummary2;
  if (kind === "docker") {
    const image = await docker.inspect(source);
    const arch = normalizeArch$1(image.architecture);
    subpackageKey = arch === "x86_64" ? "amd64_docker_image" : arch === "aarch64" ? "aarch64_docker_image" : (() => {
      throw new UsageError("UNSUPPORTED_ARCHITECTURE", `unsupported Docker architecture: ${arch}`);
    })();
    selector = { os: "linux", arch };
    sourceValue = { type: "docker-image", image: source };
    sourceSummary2 = { type: "docker-image", image: image.canonicalName, image_id: image.id };
  } else {
    subpackageKey = kind === "static-web" ? "web" : "script";
    const absoluteSource = resolve$1(projectDir, source);
    const persistedSource = isAbsolute$1(source) ? resolve$1(source) : toPortablePath(relative(join(projectDir, "dapp_meta"), absoluteSource));
    sourceValue = { type: "path", path: persistedSource };
    sourceSummary2 = { type: "path", path: displaySource(projectDir, absoluteSource) };
    try {
      await getHost().lstat(absoluteSource);
    } catch (error) {
      if (isHostError(error, "NotFound")) {
        await ctx.io.stderr(`warning: source does not exist yet: ${sourceSummary2.path}
`);
      } else
        throw error;
    }
  }
  const appMeta = {
    schema_version: 1,
    did: appDid,
    name,
    version,
    owner,
    author: owner,
    show_name: name,
    categories: [kind === "static-web" ? "web" : "dapp"],
    permissions: [],
    selector_type: kind === "static-web" ? "static" : "single",
    service_config_tips: {}
  };
  const pikgMeta = {
    schema_version: 1,
    output_dir: "../dapp_dist",
    pikg_file: `${name}-${version}.pikg`,
    sub_pkgs: {
      [subpackageKey]: {
        ...selector ? { selector } : {},
        required: true,
        source: sourceValue
      }
    }
  };
  parseAppMeta({ ...appMeta });
  parsePikgMeta(pikgMeta);
  const metaDir = join(projectDir, "dapp_meta");
  await initializeMetaDirectory(projectDir, metaDir, appMeta, pikgMeta);
  return {
    project_dir: projectDir,
    meta_dir: metaDir,
    generated_files: [join(metaDir, "app.json"), join(metaDir, "pikg.json")],
    app: {
      did: appDid,
      name,
      version,
      owner,
      author: owner,
      show_name: name,
      categories: appMeta.categories,
      permissions: [],
      selector_type: appMeta.selector_type,
      service_config_tips: {}
    },
    subpackage: {
      key: subpackageKey,
      kind,
      source: sourceSummary2,
      required: true,
      ...selector ? { selector } : {}
    },
    output_dir: join(projectDir, "dapp_dist"),
    pikg_file: pikgMeta.pikg_file,
    next_command: `buckyos pikg build ${metaDir}`
  };
}
async function buildCommand(ctx, input, docker, now) {
  const metaInput = optionalInputString(input, "meta_dir") ?? "./dapp_meta";
  const metaDir = await realDirectory(resolveFromCwd$1(ctx, metaInput), "dapp_meta");
  const appMeta = parseAppMeta(await readJson(join(metaDir, "app.json"), "app.json"));
  const pikgMeta = parsePikgMeta(await readJson(join(metaDir, "pikg.json"), "pikg.json"), appMeta);
  const configuredDist = resolve$1(metaDir, pikgMeta.output_dir);
  await rejectLeafSymlink(configuredDist, "UNSAFE_OUTPUT_DIR");
  const distDir = await canonicalTarget(configuredDist);
  const projectDir = dirname(metaDir);
  const sourcePaths = [];
  for (const subpackage of Object.values(pikgMeta.sub_pkgs)) {
    if (subpackage.source.type === "path") {
      sourcePaths.push(await getHost().realPath(resolve$1(metaDir, subpackage.source.path)));
    }
  }
  assertBuildPaths(metaDir, distDir, sourcePaths);
  await validateReplaceableDist(distDir, metaRootId(metaDir));
  await getHost().mkdir(dirname(distDir), { recursive: true });
  const temporary = await getHost().makeTempDir({
    dir: dirname(distDir),
    prefix: ".buckyos-pikg-build-"
  });
  try {
    const prepared = [];
    for (const [key, subpackage] of Object.entries(pikgMeta.sub_pkgs).sort(
      ([a], [b]) => a.localeCompare(b)
    )) {
      const payloadPath = join(temporary, `${key}.tar.gz`);
      let dockerInfo;
      if (subpackage.source.type === "path") {
        const sourcePath = await getHost().realPath(resolve$1(metaDir, subpackage.source.path));
        const info = await getHost().stat(sourcePath);
        if (info.isDirectory) {
          await createDeterministicTarGz(sourcePath, payloadPath);
        } else if (info.isFile && sourcePath.toLowerCase().endsWith(".tar.gz")) {
          const before = await digestFile(sourcePath);
          const beforeStat = statIdentity(await getHost().stat(sourcePath));
          await getHost().copyFile(sourcePath, payloadPath);
          const after = await digestFile(sourcePath);
          const afterStat = statIdentity(await getHost().stat(sourcePath));
          const copied = await digestFile(payloadPath);
          if (beforeStat !== afterStat || before.size !== after.size || before.sha256 !== after.sha256 || copied.size !== before.size || copied.sha256 !== before.sha256) {
            throw new ToolError("SOURCE_CHANGED", `source changed while copied: ${key}`);
          }
        } else {
          throw new UsageError(
            "INVALID_SOURCE",
            `${key} source must be a directory or .tar.gz file`
          );
        }
      } else {
        dockerInfo = await docker.inspect(subpackage.source.image);
        if (!SHA256_ID.test(dockerInfo.id)) {
          throw new ToolError(
            "DOCKER_IDENTITY_INVALID",
            `Docker image ${key} has no immutable image ID`
          );
        }
        await docker.save(dockerInfo.id, payloadPath);
        const after = await docker.inspect(dockerInfo.id);
        if (after.id !== dockerInfo.id) {
          throw new ToolError(
            "SOURCE_CHANGED",
            `Docker image identity changed while exporting: ${key}`
          );
        }
      }
      const digest = await digestFile(payloadPath);
      prepared.push({
        key,
        input: subpackage,
        payloadPath,
        digest: { size: digest.size, digest: `sha256:${digest.sha256}` },
        ...dockerInfo ? { docker: dockerInfo } : {}
      });
    }
    const timestamp = now();
    if (!Number.isSafeInteger(timestamp) || timestamp < 0)
      throw new Error("invalid clock value");
    const namespace = deriveAppNamespace(appMeta.did);
    const packageObjects = {};
    const contentIndex = {};
    const pkgList = {};
    const generatedSubpackages = {};
    const packageNames = /* @__PURE__ */ new Set();
    for (const item of prepared) {
      const packageName = `${packageEnvironmentQualifier(item.key, item.input.selector)}.${packageSuffix(item.key)}.${namespace}`;
      if (packageNames.has(packageName)) {
        throw new UsageError("PACKAGE_NAME_COLLISION", `subpackage names collide at ${packageName}`);
      }
      packageNames.add(packageName);
      const payloadHash = item.digest.digest.slice("sha256:".length);
      const packageMeta2 = createPackageMeta(
        packageName,
        appMeta.version,
        appMeta.author,
        appMeta.owner,
        { size: item.digest.size, sha256: payloadHash, crc32: 0 },
        timestamp
      );
      packageObjects[packageMeta2.objectId] = packageMeta2.value;
      if (contentIndex[item.digest.digest]) {
        throw new UsageError(
          "DUPLICATE_PAYLOAD_DIGEST",
          `subpackages cannot share the same payload digest: ${item.key}`
        );
      }
      contentIndex[item.digest.digest] = {
        sub_pkg_name: item.key,
        path: `${item.key}.tar.gz`,
        format: "tar.gz",
        size: item.digest.size,
        digest: item.digest.digest
      };
      const selector = item.input.selector;
      pkgList[item.key] = {
        pkg_id: `${packageName}#${appMeta.version}`,
        pkg_objid: packageMeta2.objectId,
        ...item.docker ? {
          docker_image_name: item.docker.canonicalName,
          docker_image_digest: item.docker.id
        } : {},
        ...selector ? { selector } : {},
        required: item.input.required
      };
      generatedSubpackages[item.key] = {
        source_kind: item.input.source.type,
        size: item.digest.size,
        digest: item.digest.digest,
        pkg_objid: packageMeta2.objectId
      };
    }
    const appDoc = {
      schema_version: 1,
      doc_type: "app",
      did: appMeta.did,
      name: appMeta.name,
      version: appMeta.version,
      app_type: appMeta.categories[0],
      author: appMeta.author,
      owner: appMeta.owner,
      controller: appMeta.owner,
      create_time: timestamp,
      last_update_time: timestamp,
      exp: timestamp + APP_DOCUMENT_LIFETIME_SECONDS,
      categories: appMeta.categories,
      pkg_list: pkgList,
      show_name: appMeta.show_name,
      ...appMeta.permissions.length ? { permissions: appMeta.permissions } : {},
      selector_type: appMeta.selector_type,
      service_config_tips: appMeta.service_config_tips
    };
    const appObjectId = appDocObjectId(appDoc);
    const packageMeta = {
      "@schema": PACKAGE_META_SCHEMA,
      app_doc_id: appObjectId,
      package_objects: packageObjects,
      content_index: contentIndex
    };
    await writeJson(join(temporary, APPDOC_ENTRY), appDoc);
    await writeJson(join(temporary, PACKAGE_META_ENTRY), packageMeta);
    const validated = await validateSnapshot(temporary, appDoc, packageMeta);
    const generatedFiles = {};
    for (const name of [
      APPDOC_ENTRY,
      PACKAGE_META_ENTRY,
      ...prepared.map((item) => `${item.key}.tar.gz`)
    ]) {
      const digest = await digestFile(join(temporary, name));
      generatedFiles[name] = { size: digest.size, digest: `sha256:${digest.sha256}` };
    }
    const manifest = {
      schema_version: 1,
      tool_version: TOOL_VERSION,
      meta_root_id: metaRootId(metaDir),
      source_fingerprint: `sha256:${stableJsonDigest({
        app: appMeta,
        pikg: pikgMeta,
        payloads: generatedSubpackages
      })}`,
      app_doc_object_id: appObjectId,
      pikg_file: pikgMeta.pikg_file,
      generated_files: generatedFiles,
      subpackages: generatedSubpackages
    };
    await writeJson(join(temporary, DIST_MANIFEST_NAME), manifest);
    await replaceDirectory(temporary, distDir);
    return {
      meta_dir: metaDir,
      dist_dir: distDir,
      app_did: appMeta.did,
      app_doc_object_id: appObjectId,
      subpackage_count: validated.subpackages.length,
      subpackages: validated.subpackages.map((item) => ({
        key: item.key,
        source_kind: pikgMeta.sub_pkgs[item.key].source.type,
        size: item.payload_size,
        digest: item.payload_digest,
        pkg_objid: item.pkg_objid
      })),
      ready_for_pack: true,
      next_command: `buckyos pikg pack ${distDir}`,
      project_dir: projectDir
    };
  } catch (error) {
    await removeTreeIfExists(temporary);
    throw error;
  }
}
async function packCommand(ctx, input) {
  const distInput = optionalInputString(input, "dist_dir") ?? "./dapp_dist";
  const distDir = await safeExistingDirectory(resolveFromCwd$1(ctx, distInput), "dapp_dist");
  const manifest = await validateManagedDist(distDir, void 0, true);
  const appDoc = await readJson(join(distDir, APPDOC_ENTRY), APPDOC_ENTRY);
  const packageMeta = parsePackageMeta(
    await readJson(join(distDir, PACKAGE_META_ENTRY), PACKAGE_META_ENTRY)
  );
  const validated = await validateSnapshot(distDir, appDoc, packageMeta);
  if (validated.appDocObjectId !== manifest.app_doc_object_id) {
    throw new ToolError(
      "INVALID_PACKAGE",
      "snapshot AppDoc Object ID differs from ownership manifest"
    );
  }
  const temporary = join(distDir, `.${manifest.pikg_file}.tmp-${crypto.randomUUID()}`);
  const finalPath = join(distDir, manifest.pikg_file);
  try {
    await packSnapshot(distDir, temporary, appDoc, packageMeta);
    const inspection = await inspectPikg(temporary);
    if (inspection.app.app_doc_object_id !== manifest.app_doc_object_id) {
      throw new ToolError(
        "INVALID_PACKAGE",
        "PIKG self-check returned a different AppDoc Object ID"
      );
    }
    await replaceFile(temporary, finalPath);
    const digest = await digestFile(finalPath);
    return {
      dist_dir: distDir,
      pikg_path: finalPath,
      size: digest.size,
      pikg_digest: `sha256:${digest.sha256}`,
      app_doc_object_id: inspection.app.app_doc_object_id,
      validation: "passed"
    };
  } catch (error) {
    await removeFileIfExists(temporary);
    throw error;
  }
}
async function cleanCommand(ctx, input) {
  const metaInput = optionalInputString(input, "meta_dir") ?? "./dapp_meta";
  const metaDir = await realDirectory(resolveFromCwd$1(ctx, metaInput), "dapp_meta");
  const appMeta = parseAppMeta(await readJson(join(metaDir, "app.json"), "app.json"));
  const pikgMeta = parsePikgMeta(
    await readJson(join(metaDir, "pikg.json"), "pikg.json"),
    appMeta
  );
  const configuredDist = resolve$1(metaDir, pikgMeta.output_dir);
  assertSafeCleanTarget(ctx, metaDir, configuredDist, []);
  await rejectLeafSymlink(configuredDist, "UNSAFE_CLEAN_TARGET");
  const distDir = await canonicalTarget(configuredDist);
  try {
    await getHost().lstat(distDir);
  } catch (error) {
    if (isHostError(error, "NotFound")) {
      return { meta_dir: metaDir, dist_dir: distDir, removed: false };
    }
    throw error;
  }
  const sourcePaths = [];
  for (const subpackage of Object.values(pikgMeta.sub_pkgs)) {
    if (subpackage.source.type === "path") {
      try {
        sourcePaths.push(await getHost().realPath(resolve$1(metaDir, subpackage.source.path)));
      } catch (error) {
        if (!isHostError(error, "NotFound"))
          throw error;
      }
    }
  }
  assertSafeCleanTarget(ctx, metaDir, distDir, sourcePaths);
  await validateManagedDist(distDir, metaRootId(metaDir), true, "UNSAFE_CLEAN_TARGET");
  if (!ctx.confirmed) {
    if (ctx.config.nonInteractive || ctx.interactive || !ctx.io.inputIsTerminal) {
      throw new ToolError(
        "CONFIRMATION_REQUIRED",
        "pikg clean requires --yes in non-interactive mode",
        EXIT_PERMISSION
      );
    }
    const answer = await ctx.io.prompt(`Delete managed PIKG output ${distDir}? [y/N] `);
    if (!answer || !["y", "yes"].includes(answer.trim().toLowerCase())) {
      throw new ToolError("CONFIRMATION_DECLINED", "PIKG clean was declined", EXIT_PERMISSION);
    }
  }
  await getHost().remove(distDir, { recursive: true });
  return { meta_dir: metaDir, dist_dir: distDir, removed: true };
}
function parseAppMeta(value) {
  rejectUnknown(
    value,
    [
      "schema_version",
      "did",
      "name",
      "version",
      "owner",
      "author",
      "show_name",
      "categories",
      "permissions",
      "selector_type",
      "service_config_tips"
    ],
    "app.json"
  );
  if (value.schema_version !== 1) {
    throw new UsageError("UNSUPPORTED_SCHEMA_VERSION", "app.json.schema_version must be 1");
  }
  const name = developmentString(value.name, "app.json.name");
  validateAppName(name);
  const version = developmentString(value.version, "app.json.version");
  validateVersion(version);
  const did = developmentString(value.did, "app.json.did");
  const owner = developmentString(value.owner, "app.json.owner");
  deriveAppNamespace(did);
  const categories = value.categories;
  if (!Array.isArray(categories) || !categories.length || categories.some((item) => typeof item !== "string")) {
    throw new UsageError(
      "SCHEMA_VALIDATION_FAILED",
      "app.json.categories must be a non-empty string array"
    );
  }
  const permissions = developmentValidation(
    () => validatePermissions(value.permissions ?? [], "app.json.permissions")
  );
  const serviceConfig = developmentValidation(
    () => validateServiceConfigTips(
      value.service_config_tips ?? {},
      "app.json.service_config_tips"
    )
  );
  return {
    schema_version: 1,
    did,
    name,
    version,
    owner,
    author: developmentString(value.author, "app.json.author"),
    show_name: developmentString(value.show_name, "app.json.show_name"),
    categories,
    permissions,
    selector_type: developmentString(value.selector_type, "app.json.selector_type"),
    service_config_tips: serviceConfig
  };
}
function parsePikgMeta(value, app) {
  rejectUnknown(value, ["schema_version", "output_dir", "pikg_file", "sub_pkgs"], "pikg.json");
  if (value.schema_version !== 1) {
    throw new UsageError("UNSUPPORTED_SCHEMA_VERSION", "pikg.json.schema_version must be 1");
  }
  const outputDir = value.output_dir === void 0 ? "../dapp_dist" : developmentString(value.output_dir, "pikg.json.output_dir");
  const defaultPikgFile = app ? `${app.name}-${app.version}.pikg` : void 0;
  const pikgFile = value.pikg_file === void 0 ? defaultPikgFile ?? (() => {
    throw new UsageError("SCHEMA_VALIDATION_FAILED", "pikg.json.pikg_file is required");
  })() : developmentString(value.pikg_file, "pikg.json.pikg_file");
  if (!SAFE_PIKG_FILE.test(pikgFile) || pikgFile.includes("..") || basename(pikgFile) !== pikgFile) {
    throw new UsageError("INVALID_PIKG_FILE", "pikg_file must be a safe .pikg file name");
  }
  const rawSubpackages = developmentObject(value.sub_pkgs, "pikg.json.sub_pkgs");
  if (!Object.keys(rawSubpackages).length) {
    throw new UsageError("SCHEMA_VALIDATION_FAILED", "pikg.json.sub_pkgs must not be empty");
  }
  const subpackages = {};
  for (const [key, raw] of Object.entries(rawSubpackages)) {
    validateSubpackageName(key);
    const subpackage = developmentObject(raw, `pikg.json.sub_pkgs.${key}`);
    rejectUnknown(subpackage, ["selector", "required", "source"], `pikg.json.sub_pkgs.${key}`);
    const selector = developmentValidation(
      () => canonicalSelector(subpackage.selector, `pikg.json.sub_pkgs.${key}.selector`)
    );
    assertSelectorCompatible(key, selector, `pikg.json.sub_pkgs.${key}.selector`);
    if (subpackage.required !== void 0 && typeof subpackage.required !== "boolean") {
      throw new UsageError("SCHEMA_VALIDATION_FAILED", `${key}.required must be boolean`);
    }
    const source = developmentObject(subpackage.source, `pikg.json.sub_pkgs.${key}.source`);
    if (source.type === "path") {
      rejectUnknown(source, ["type", "path"], `pikg.json.sub_pkgs.${key}.source`);
      subpackages[key] = {
        ...selector ? { selector } : {},
        required: subpackage.required === void 0 ? true : subpackage.required,
        source: { type: "path", path: developmentString(source.path, `${key}.source.path`) }
      };
    } else if (source.type === "docker-image") {
      rejectUnknown(source, ["type", "image"], `pikg.json.sub_pkgs.${key}.source`);
      subpackages[key] = {
        ...selector ? { selector } : {},
        required: subpackage.required === void 0 ? true : subpackage.required,
        source: {
          type: "docker-image",
          image: developmentString(source.image, `${key}.source.image`)
        }
      };
    } else {
      throw new UsageError("INVALID_SOURCE", `${key}.source.type must be path or docker-image`);
    }
  }
  return {
    schema_version: 1,
    output_dir: outputDir,
    pikg_file: pikgFile,
    sub_pkgs: subpackages
  };
}
async function initializeMetaDirectory(projectDir, metaDir, appMeta, pikgMeta) {
  let existedEmpty = false;
  try {
    const stat2 = await getHost().lstat(metaDir);
    if (!stat2.isDirectory || stat2.isSymlink) {
      throw new UsageError(
        "ALREADY_EXISTS",
        "dapp_meta already exists and is not an empty directory"
      );
    }
    for (const _entry of await getHost().readDir(metaDir)) {
      throw new UsageError("ALREADY_EXISTS", "dapp_meta already contains files");
    }
    existedEmpty = true;
  } catch (error) {
    if (!isHostError(error, "NotFound"))
      throw error;
  }
  const temporary = await getHost().makeTempDir({ dir: projectDir, prefix: ".buckyos-pikg-init-" });
  try {
    await writeJson(join(temporary, "app.json"), appMeta);
    await writeJson(join(temporary, "pikg.json"), pikgMeta);
    parseAppMeta(await readJson(join(temporary, "app.json"), "app.json"));
    parsePikgMeta(await readJson(join(temporary, "pikg.json"), "pikg.json"), appMeta);
    if (existedEmpty)
      await getHost().remove(metaDir);
    try {
      await getHost().rename(temporary, metaDir);
    } catch (error) {
      if (existedEmpty)
        await getHost().mkdir(metaDir);
      throw error;
    }
  } catch (error) {
    await removeTreeIfExists(temporary);
    throw error;
  }
}
async function validateReplaceableDist(distDir, expectedMetaRootId) {
  try {
    await getHost().lstat(distDir);
  } catch (error) {
    if (isHostError(error, "NotFound"))
      return;
    throw error;
  }
  await validateManagedDist(distDir, expectedMetaRootId, true);
}
async function validateManagedDist(distDir, expectedMetaRootId, verifyFiles = true, unsafeCode = "UNSAFE_DIST_TARGET") {
  try {
    const info = await getHost().lstat(distDir);
    if (!info.isDirectory || info.isSymlink)
      throw new Error("target is not a real directory");
    const manifest = parseDistManifest(
      await readJson(join(distDir, DIST_MANIFEST_NAME), DIST_MANIFEST_NAME)
    );
    if (expectedMetaRootId && manifest.meta_root_id !== expectedMetaRootId) {
      throw new Error("ownership manifest belongs to another dapp_meta");
    }
    const allowed = /* @__PURE__ */ new Set([
      DIST_MANIFEST_NAME,
      manifest.pikg_file,
      ...Object.keys(manifest.generated_files)
    ]);
    for (const entry of await getHost().readDir(distDir)) {
      if (!entry.isFile || entry.isSymlink || !allowed.has(entry.name)) {
        throw new Error(`unmanaged entry exists: ${entry.name}`);
      }
    }
    for (const name of Object.keys(manifest.generated_files)) {
      const info2 = await getHost().lstat(join(distDir, name));
      if (!info2.isFile || info2.isSymlink)
        throw new Error(`generated file is unsafe: ${name}`);
      if (verifyFiles) {
        const expected = manifest.generated_files[name];
        const actual = await digestFile(join(distDir, name));
        if (actual.size !== expected.size || `sha256:${actual.sha256}` !== expected.digest) {
          throw new Error(`generated file was modified: ${name}`);
        }
      }
    }
    return manifest;
  } catch (error) {
    if (error instanceof ToolError && error.code === unsafeCode)
      throw error;
    throw new ToolError(
      unsafeCode,
      `managed dist validation failed: ${error instanceof Error ? error.message : String(error)}`,
      6
    );
  }
}
function parseDistManifest(value) {
  rejectUnknown(
    value,
    [
      "schema_version",
      "tool_version",
      "meta_root_id",
      "source_fingerprint",
      "app_doc_object_id",
      "pikg_file",
      "generated_files",
      "subpackages"
    ],
    DIST_MANIFEST_NAME
  );
  if (value.schema_version !== 1)
    throw new Error("unsupported ownership manifest version");
  const pikgFile = String(value.pikg_file ?? "");
  if (!SAFE_PIKG_FILE.test(pikgFile) || pikgFile.includes("..") || basename(pikgFile) !== pikgFile) {
    throw new Error("ownership manifest has an unsafe pikg_file");
  }
  const generatedRaw = expectObject$3(value.generated_files, `${DIST_MANIFEST_NAME}.generated_files`);
  const generated = {};
  for (const [name, raw] of Object.entries(generatedRaw)) {
    if (!SAFE_GENERATED_FILE.test(name) || name === "." || name === ".." || name.includes("\\") || basename(name) !== name || name === DIST_MANIFEST_NAME || name === pikgFile) {
      throw new Error(`ownership manifest has an unsafe generated file: ${name}`);
    }
    const record = expectObject$3(raw, `generated_files.${name}`);
    rejectUnknown(record, ["size", "digest"], `generated_files.${name}`);
    if (typeof record.size !== "number" || !Number.isSafeInteger(record.size) || record.size < 0) {
      throw new Error(`generated_files.${name}.size is invalid`);
    }
    if (typeof record.digest !== "string" || !SHA256_ID.test(record.digest)) {
      throw new Error(`generated_files.${name}.digest is invalid`);
    }
    generated[name] = { size: record.size, digest: record.digest };
  }
  if (!generated[APPDOC_ENTRY] || !generated[PACKAGE_META_ENTRY]) {
    throw new Error("ownership manifest is missing required metadata files");
  }
  return {
    schema_version: 1,
    tool_version: String(value.tool_version ?? ""),
    meta_root_id: validateDigestString(value.meta_root_id, "meta_root_id"),
    source_fingerprint: validateDigestString(value.source_fingerprint, "source_fingerprint"),
    app_doc_object_id: validateObjectId(value.app_doc_object_id, "app_doc_object_id"),
    pikg_file: pikgFile,
    generated_files: generated,
    subpackages: expectObject$3(value.subpackages, "subpackages")
  };
}
function assertBuildPaths(metaDir, distDir, sourcePaths) {
  if (pathsOverlap(metaDir, distDir)) {
    throw new UsageError("UNSAFE_OUTPUT_DIR", "output_dir overlaps dapp_meta");
  }
  for (const source of sourcePaths) {
    if (pathsOverlap(source, distDir)) {
      throw new UsageError("UNSAFE_OUTPUT_DIR", "output_dir overlaps a subpackage source");
    }
  }
}
function assertSafeCleanTarget(ctx, metaDir, distDir, sourcePaths) {
  const projectDir = dirname(metaDir);
  const exactProtected = [resolve$1(ctx.cwd), projectDir];
  const home = getHost().env("HOME") ?? getHost().env("USERPROFILE");
  if (home)
    exactProtected.push(resolve$1(home));
  if (dirname(distDir) === distDir || exactProtected.some((path) => resolve$1(path) === resolve$1(distDir)) || pathsOverlap(metaDir, distDir) || sourcePaths.some((path) => pathsOverlap(path, distDir))) {
    throw new ToolError("UNSAFE_CLEAN_TARGET", "refusing to clean an unsafe output directory");
  }
}
async function replaceDirectory(temporary, destination) {
  let exists = false;
  try {
    await getHost().lstat(destination);
    exists = true;
  } catch (error) {
    if (!isHostError(error, "NotFound"))
      throw error;
  }
  if (!exists) {
    await getHost().rename(temporary, destination);
    return;
  }
  const backup = `${destination}.previous-${crypto.randomUUID()}`;
  await getHost().rename(destination, backup);
  try {
    await getHost().rename(temporary, destination);
  } catch (error) {
    await getHost().rename(backup, destination);
    throw error;
  }
  await getHost().remove(backup, { recursive: true });
}
async function replaceFile(temporary, destination) {
  let exists = false;
  try {
    await getHost().lstat(destination);
    exists = true;
  } catch (error) {
    if (!isHostError(error, "NotFound"))
      throw error;
  }
  if (!exists) {
    await getHost().rename(temporary, destination);
    return;
  }
  const backup = `${destination}.previous-${crypto.randomUUID()}`;
  await getHost().rename(destination, backup);
  try {
    await getHost().rename(temporary, destination);
  } catch (error) {
    await getHost().rename(backup, destination);
    throw error;
  }
  await removeFileIfExists(backup);
}
class LocalDockerClient {
  async inspect(reference) {
    let result;
    try {
      result = await getHost().run("docker", ["image", "inspect", reference]);
    } catch (error) {
      throw new ToolError(
        "DOCKER_UNAVAILABLE",
        `Docker inspect is unavailable: ${error instanceof Error ? error.message : String(error)}`,
        EXIT_UNAVAILABLE,
        true
      );
    }
    if (!result.success) {
      throw new ToolError(
        "DOCKER_IMAGE_NOT_FOUND",
        `local Docker image is unavailable: ${safeDockerError(result.stderr)}`,
        EXIT_UNAVAILABLE
      );
    }
    let values;
    try {
      values = JSON.parse(new TextDecoder().decode(result.stdout));
    } catch {
      throw new ToolError("DOCKER_INSPECT_INVALID", "Docker inspect returned invalid JSON");
    }
    if (!Array.isArray(values) || values.length !== 1) {
      throw new ToolError("DOCKER_INSPECT_INVALID", "Docker inspect returned an unexpected result");
    }
    const value = developmentObject(values[0], "Docker inspect");
    const id = developmentString(value.Id, "Docker image ID").toLowerCase();
    if (!SHA256_ID.test(id)) {
      throw new ToolError("DOCKER_IDENTITY_INVALID", "Docker image ID is not immutable sha256");
    }
    const architecture = developmentString(value.Architecture, "Docker architecture");
    const tags = Array.isArray(value.RepoTags) ? value.RepoTags.filter(
      (tag) => typeof tag === "string" && tag !== "<none>:<none>"
    ) : [];
    return {
      id,
      architecture,
      canonicalName: tags.includes(reference) ? reference : tags[0] ?? reference
    };
  }
  async save(imageId, destinationTarGz) {
    try {
      const result = await getHost().runGzip(
        "docker",
        ["image", "save", imageId],
        destinationTarGz
      );
      if (!result.success) {
        await removeFileIfExists(destinationTarGz);
        throw new ToolError(
          "DOCKER_EXPORT_FAILED",
          `Docker image save failed: ${safeDockerError(result.stderr)}`,
          EXIT_UNAVAILABLE
        );
      }
    } catch (error) {
      if (error instanceof ToolError)
        throw error;
      throw new ToolError(
        "DOCKER_UNAVAILABLE",
        `Docker save is unavailable: ${error instanceof Error ? error.message : String(error)}`,
        EXIT_UNAVAILABLE,
        true
      );
    }
  }
}
function resolveFromCwd$1(ctx, value) {
  return isAbsolute$1(value) ? resolve$1(value) : resolve$1(ctx.cwd, value);
}
async function realDirectory(path, label) {
  const real = await getHost().realPath(path);
  const stat2 = await getHost().stat(real);
  if (!stat2.isDirectory)
    throw new UsageError("INVALID_PATH", `${label} must be a directory`);
  return real;
}
async function safeExistingDirectory(path, label) {
  const info = await getHost().lstat(path);
  if (!info.isDirectory || info.isSymlink) {
    throw new UsageError("INVALID_PATH", `${label} must be a real directory`);
  }
  return await getHost().realPath(path);
}
async function canonicalTarget(path) {
  const absolute = resolve$1(path);
  try {
    return await getHost().realPath(absolute);
  } catch (error) {
    if (!isHostError(error, "NotFound"))
      throw error;
    const parent = dirname(absolute);
    if (parent === absolute)
      return absolute;
    return join(await canonicalTarget(parent), basename(absolute));
  }
}
async function rejectLeafSymlink(path, code) {
  try {
    if ((await getHost().lstat(path)).isSymlink) {
      throw new ToolError(code, "configured output_dir must not be a symlink");
    }
  } catch (error) {
    if (isHostError(error, "NotFound"))
      return;
    throw error;
  }
}
function pathsOverlap(left, right) {
  const leftToRight = relative(resolve$1(left), resolve$1(right));
  const rightToLeft = relative(resolve$1(right), resolve$1(left));
  const separator = getHost().path.sep;
  return leftToRight === "" || !leftToRight.startsWith(`..${separator}`) && leftToRight !== ".." || !rightToLeft.startsWith(`..${separator}`) && rightToLeft !== "..";
}
function metaRootId(metaDir) {
  return `sha256:${sha256Bytes(new TextEncoder().encode(resolve$1(metaDir)))}`;
}
function packageSuffix(key) {
  const suffix = key.toLowerCase().replaceAll(/[^a-z0-9_-]+/g, "-").replaceAll(/^-+|-+$/g, "");
  if (!suffix) {
    throw new UsageError("INVALID_SUBPACKAGE_NAME", `cannot derive package name from ${key}`);
  }
  return suffix;
}
function normalizeAppName(value) {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-+|-+$/g, "");
}
function validateAppName(value) {
  if (!APP_NAME.test(value))
    throw new UsageError("INVALID_APP_NAME", `invalid App name: ${value}`);
}
function validateVersion(value) {
  if (!VERSION$1.test(value))
    throw new UsageError("INVALID_VERSION", `invalid App version: ${value}`);
}
function deriveAppDid(name, owner) {
  const match = /^did:bns:([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)$/.exec(owner);
  if (!match) {
    throw new UsageError(
      "INVALID_OWNER_DID",
      "Owner DID must be a standard single-label did:bns DID for an ordinary App"
    );
  }
  return `did:bns:${name}.${match[1]}`;
}
async function requiredPrompt(ctx, canPrompt, message, field) {
  if (!canPrompt) {
    throw new UsageError("MISSING_REQUIRED_INPUT", `${field} is required`);
  }
  const answer = await ctx.io.prompt(message);
  if (!answer?.trim())
    throw new UsageError("MISSING_REQUIRED_INPUT", `${field} is required`);
  return answer.trim();
}
function optionalInputString(input, key) {
  return input[key] === void 0 ? void 0 : expectInputString(input, key);
}
function expectInputString(input, key) {
  const value = input[key];
  if (typeof value !== "string" || !value) {
    throw new UsageError("MISSING_REQUIRED_INPUT", `${key} is required`);
  }
  return value;
}
function developmentString(value, label) {
  try {
    return expectNonEmptyString(value, label);
  } catch (error) {
    if (error instanceof ToolError)
      throw new UsageError("SCHEMA_VALIDATION_FAILED", error.message);
    throw error;
  }
}
function developmentObject(value, label) {
  try {
    return expectObject$3(value, label);
  } catch (error) {
    if (error instanceof ToolError)
      throw new UsageError("SCHEMA_VALIDATION_FAILED", error.message);
    throw error;
  }
}
function developmentValidation(validate) {
  try {
    return validate();
  } catch (error) {
    if (error instanceof ToolError)
      throw new UsageError("SCHEMA_VALIDATION_FAILED", error.message);
    throw error;
  }
}
async function readJson(path, label) {
  try {
    const parsed = JSON.parse(await getHost().readTextFile(path));
    return developmentObject(parsed, label);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new UsageError("INVALID_JSON", `${label} is not valid JSON`);
    }
    throw error;
  }
}
async function writeJson(path, value) {
  await getHost().writeTextFile(path, `${JSON.stringify(value, null, 2)}
`, {
    createNew: true,
    mode: 384
  });
}
function validateDigestString(value, label) {
  if (typeof value !== "string" || !SHA256_ID.test(value))
    throw new Error(`${label} is invalid`);
  return value;
}
function validateObjectId(value, label) {
  if (typeof value !== "string" || !OBJECT_ID.test(value))
    throw new Error(`${label} is invalid`);
  return value;
}
function statIdentity(value) {
  return JSON.stringify({
    size: value.size,
    mtime: value.mtime?.getTime() ?? null,
    dev: value.dev,
    ino: value.ino,
    mode: value.mode
  });
}
function displaySource(projectDir, source) {
  const display = relative(projectDir, source);
  return display && !display.startsWith(`..${getHost().path.sep}`) && display !== ".." ? toPortablePath(display) : "[external path]";
}
function toPortablePath(path) {
  return path.split(getHost().path.sep).join("/") || ".";
}
function safeDockerError(bytes) {
  const text = new TextDecoder().decode(bytes).trim().replaceAll(/[\r\n]+/g, " ");
  return text.slice(0, 500) || "unknown Docker error";
}
async function removeTreeIfExists(path) {
  try {
    await getHost().remove(path, { recursive: true });
  } catch (error) {
    if (!isHostError(error, "NotFound"))
      throw error;
  }
}
async function removeFileIfExists(path) {
  try {
    await getHost().remove(path);
  } catch (error) {
    if (!isHostError(error, "NotFound"))
      throw error;
  }
}
const TASK_MANAGER_SERVICE = "task-manager";
const DEFAULT_POLL_INTERVAL_MS = 500;
async function waitForTask(ctx, taskId, options = {}) {
  const observe = options.observe ?? observeTask;
  const sleep = options.sleep ?? abortableSleep$1;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const failOnTaskFailure = options.failOnTaskFailure ?? true;
  let lastProgress = "";
  let lastRevision;
  let reader;
  try {
    const remaining = Math.max(1, (ctx.deadline ?? Date.now()) - Date.now());
    const eventSignal = AbortSignal.any([ctx.signal, AbortSignal.timeout(remaining)]);
    reader = await ctx.clients.createEventReader?.(`/task_mgr/${taskId}`, eventSignal);
  } catch {
    reader = void 0;
  }
  try {
    while (true) {
      const observation = await observe(ctx, taskId);
      const progress = JSON.stringify({
        task_id: taskId,
        revision: observation.revision,
        phase: observation.phase,
        outcome: observation.outcome,
        progress: observation.progress,
        message: observation.message
      });
      const changed = observation.revision === void 0 ? progress !== lastProgress : observation.revision !== lastRevision;
      if (changed) {
        if (options.onObservation)
          await options.onObservation(observation);
        else
          await ctx.io.stderr(`${progress}
`);
        lastProgress = progress;
        lastRevision = observation.revision;
      }
      if (observation.phase === "Terminal") {
        if (failOnTaskFailure && observation.outcome !== "Succeeded") {
          const error = observation.error;
          throw new ToolError(
            normalizeTaskErrorCode(error?.code, observation.outcome),
            error?.message ?? `task ${taskId} ended with ${observation.outcome ?? "no outcome"}`,
            observation.outcome === "Canceled" ? EXIT_TIMEOUT : EXIT_OPERATION,
            error?.retryable ?? false,
            { task_id: taskId }
          );
        }
        return observation.data;
      }
      const remaining = (ctx.deadline ?? Date.now()) - Date.now();
      if (remaining <= 0) {
        throw new ToolError(
          "TIMEOUT",
          `timed out waiting for task ${taskId}`,
          EXIT_TIMEOUT,
          true,
          { task_id: taskId }
        );
      }
      const interval = Math.min(pollIntervalMs, remaining);
      if (reader)
        await reader.pullEvent(interval);
      else
        await sleep(interval, ctx.signal);
    }
  } finally {
    await reader?.close().catch(() => void 0);
  }
}
async function observeTask(ctx, taskId) {
  const response = await ctx.clients.call(
    TASK_MANAGER_SERVICE,
    "get_task",
    { task_id: taskId },
    rpcOptions$2(ctx)
  );
  const envelope = expectObject$2(response, "TaskManager get_task response");
  const task = expectObject$2(envelope.task ?? envelope, "TaskManager task");
  const phase = expectString$2(task.phase, "task.phase");
  const outcome = optionalString$1(task.outcome);
  const taskError = isObject$1(task.error) ? task.error : void 0;
  return {
    revision: typeof task.revision === "number" ? task.revision : void 0,
    phase,
    outcome,
    message: optionalString$1(task.message),
    error: taskError ? {
      code: optionalString$1(taskError.code),
      message: optionalString$1(taskError.message),
      retryable: typeof taskError.retryable === "boolean" ? taskError.retryable : void 0,
      details: isObject$1(taskError.detail) ? taskError.detail : void 0
    } : void 0,
    progress: task.progress,
    data: task
  };
}
function rpcOptions$2(ctx) {
  return {
    traceId: ctx.traceId,
    timeoutMs: Math.max(1, (ctx.deadline ?? Date.now()) - Date.now()),
    signal: ctx.signal
  };
}
function normalizeTaskErrorCode(code, outcome) {
  if (code)
    return code.trim().replaceAll(/[^A-Za-z0-9]+/g, "_").toUpperCase();
  return outcome === "Canceled" ? "CANCELED" : "TASK_FAILED";
}
function optionalString$1(value) {
  return typeof value === "string" ? value : void 0;
}
function expectString$2(value, label) {
  if (typeof value !== "string" || !value) {
    throw new ToolError("INVALID_SERVICE_RESPONSE", `${label} must be a string`, 9);
  }
  return value;
}
function isObject$1(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function expectObject$2(value, label) {
  if (!isObject$1(value)) {
    throw new ToolError("INVALID_SERVICE_RESPONSE", `${label} must be an object`, 9);
  }
  return value;
}
function abortableSleep$1(milliseconds, signal) {
  if (signal.aborted) {
    return Promise.reject(new ToolError("CANCELED", "operation canceled", EXIT_TIMEOUT));
  }
  return new Promise((resolve2, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve2();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ToolError("CANCELED", "operation canceled", EXIT_TIMEOUT));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
const isAbsolute = (path) => getHost().path.isAbsolute(path);
const resolve = (...parts) => getHost().path.resolve(...parts);
const CONTROL_PANEL_SERVICE = "control-panel";
const PLAN_SCHEMA_VERSION = 4;
const STAGING_RELEASE_TIMEOUT_MS = 5e3;
const ZIP_LOCAL_MAGIC = [80, 75, 3, 4];
const OBJECT_OUTPUT$3 = { type: "object", additionalProperties: true };
const INSTALL_POLICIES = [
  "strict-public",
  "normal",
  "trusted-share",
  "local-developer",
  "system-internal"
];
function createAppModule(dependencies = {}) {
  const commands = [
    fetchCommand(dependencies),
    listCommand$1(),
    getCommand$1(),
    installCommand(dependencies),
    upgradeCommand(dependencies),
    uninstallCommand(dependencies),
    lifecycleCommand("start", "Start an installed App"),
    lifecycleCommand("stop", "Stop an installed App"),
    restartCommand(),
    statusCommand()
  ];
  return {
    name: "app",
    summary: "Inspect, install, upgrade, and control Apps",
    commands: commands.map((command) => {
      const handler = command.handler;
      return {
        ...command,
        handler: async (ctx, input) => sanitizeAppOutput(await handler(ctx, input))
      };
    })
  };
}
function fetchCommand(dependencies) {
  return {
    verb: "fetch",
    summary: "Inspect an App source and optionally write a fresh-install plan",
    positionals: [
      {
        name: "source",
        description: "Catalog name/DID, local PIKG path, or HTTP(S) URL",
        required: false
      }
    ],
    options: sourceOptions([
      { name: "plan", description: "Write the v4 InstallPlan to this JSON file", type: "string" },
      ownerOption(),
      policyOption()
    ]),
    inputSchema: sourceInputSchema({
      plan: { type: "string", minLength: 1 },
      owner_user_id: { type: "string", minLength: 1 },
      policy: { type: "string", enum: [...INSTALL_POLICIES] },
      target: { type: "object", additionalProperties: true },
      install_params: { type: "object", additionalProperties: true }
    }),
    outputSchema: OBJECT_OUTPUT$3,
    resultSchemaVersion: 1,
    access: { mode: "fixed", level: "read" },
    asyncMode: "sync",
    requiresSession: true,
    examples: [
      "buckyos app fetch did:bns:app1.alice",
      "buckyos app fetch ./demo-0.1.0.pikg --plan ./demo.install-plan.json"
    ],
    handler: async (ctx, input) => await fetchApp(ctx, input, dependencies)
  };
}
function listCommand$1() {
  return {
    verb: "list",
    summary: "List visible installed Apps",
    inputSchema: emptyInputSchema(),
    outputSchema: OBJECT_OUTPUT$3,
    resultSchemaVersion: 1,
    access: { mode: "fixed", level: "read" },
    asyncMode: "sync",
    requiresSession: true,
    examples: ["buckyos app list"],
    handler: async (ctx) => await callControl(ctx, "apps.list", {})
  };
}
function getCommand$1() {
  return selectorCommand({
    verb: "get",
    summary: "Get installation and runtime details for one App",
    access: "read",
    asyncMode: "sync",
    handler: async (ctx, input) => {
      const selector = normalizeAppSelector(expectString$1(input, "app_name"));
      const [details, status] = await Promise.all([
        callControl(ctx, "apps.details", { selector }),
        callControl(ctx, "apps.status", { selector })
      ]);
      return { details, status };
    }
  });
}
function installCommand(dependencies) {
  return {
    verb: "install",
    summary: "Install from a v4 plan or upgrade an existing App from a source",
    positionals: [
      {
        name: "source",
        description: "Catalog name/DID, local PIKG path, or HTTP(S) URL",
        required: false
      }
    ],
    options: sourceOptions([
      { name: "plan", description: "Fresh-install v4 InstallPlan JSON file", type: "string" },
      {
        name: "dry-run",
        property: "dry_run",
        description: "Preflight and print without submitting",
        type: "boolean"
      },
      {
        name: "no-wait",
        property: "no_wait",
        description: "Return immediately after task creation",
        type: "boolean"
      },
      policyOption()
    ]),
    inputSchema: sourceInputSchema({
      plan: { type: "string", minLength: 1 },
      dry_run: { type: "boolean" },
      no_wait: { type: "boolean" },
      policy: { type: "string", enum: [...INSTALL_POLICIES] }
    }),
    outputSchema: OBJECT_OUTPUT$3,
    resultSchemaVersion: 1,
    access: { mode: "fixed", level: "write" },
    asyncMode: "either",
    requiresSession: true,
    examples: [
      "buckyos app install did:bns:app1.alice --plan ./app1.install-plan.json",
      "buckyos --yes app install https://example.com/app1-1.2.0.pikg"
    ],
    handler: async (ctx, input) => await installApp(ctx, input, dependencies)
  };
}
function upgradeCommand(dependencies) {
  return {
    verb: "upgrade",
    summary: "Check and apply Catalog upgrades",
    positionals: [
      { name: "app_name", description: "Installed App name or DID; omit for all", required: false }
    ],
    options: [
      {
        name: "dry-run",
        property: "dry_run",
        description: "Only show the upgrade preflight",
        type: "boolean"
      },
      {
        name: "no-wait",
        property: "no_wait",
        description: "Return immediately after task creation",
        type: "boolean"
      },
      policyOption()
    ],
    inputSchema: {
      type: "object",
      properties: {
        app_name: { type: "string", minLength: 1 },
        dry_run: { type: "boolean" },
        no_wait: { type: "boolean" },
        policy: { type: "string", enum: [...INSTALL_POLICIES] }
      },
      additionalProperties: false
    },
    outputSchema: OBJECT_OUTPUT$3,
    resultSchemaVersion: 1,
    access: { mode: "fixed", level: "write" },
    asyncMode: "either",
    requiresSession: true,
    examples: ["buckyos app upgrade", "buckyos --yes app upgrade did:bns:app1.alice"],
    handler: async (ctx, input) => await upgradeApps(ctx, input, dependencies)
  };
}
function uninstallCommand(dependencies) {
  return {
    ...selectorCommand({
      verb: "uninstall",
      summary: "Uninstall an App and explicitly retain or delete its managed data",
      access: "destructive",
      asyncMode: "task",
      handler: async (ctx, input) => await uninstallApp(ctx, input, dependencies)
    }),
    options: [
      {
        name: "data",
        description: "Managed data disposition",
        type: "string",
        required: true,
        enum: ["retain", "delete"]
      },
      {
        name: "dry-run",
        property: "dry_run",
        description: "Only show the uninstall preflight",
        type: "boolean"
      },
      {
        name: "no-wait",
        property: "no_wait",
        description: "Return immediately after task creation",
        type: "boolean"
      }
    ],
    inputSchema: {
      type: "object",
      properties: {
        app_name: { type: "string", minLength: 1 },
        data: { type: "string", enum: ["retain", "delete"] },
        dry_run: { type: "boolean" },
        no_wait: { type: "boolean" }
      },
      required: ["app_name", "data"],
      additionalProperties: false
    },
    examples: ["buckyos app uninstall app1 --data retain"]
  };
}
function lifecycleCommand(verb, summary) {
  return {
    ...selectorCommand({
      verb,
      summary,
      access: "write",
      asyncMode: verb === "start" ? "task" : "either",
      handler: async (ctx, input) => await mutateLifecycle(ctx, input, verb)
    }),
    options: [
      {
        name: "no-wait",
        property: "no_wait",
        description: "Return immediately after task creation",
        type: "boolean"
      }
    ],
    inputSchema: {
      type: "object",
      properties: {
        app_name: { type: "string", minLength: 1 },
        no_wait: { type: "boolean" }
      },
      required: ["app_name"],
      additionalProperties: false
    }
  };
}
function restartCommand() {
  return {
    ...selectorCommand({
      verb: "restart",
      summary: "Recreate the runtime instances for an installed App",
      access: "write",
      asyncMode: "task",
      handler: async (ctx, input) => await mutateLifecycle(ctx, input, "restart")
    }),
    options: [
      {
        name: "strategy",
        description: "Restart strategy; rolling is currently unsupported",
        type: "string",
        enum: ["recreate", "rolling"]
      },
      {
        name: "no-wait",
        property: "no_wait",
        description: "Return immediately after task creation",
        type: "boolean"
      }
    ],
    inputSchema: {
      type: "object",
      properties: {
        app_name: { type: "string", minLength: 1 },
        strategy: { type: "string", enum: ["recreate", "rolling"] },
        no_wait: { type: "boolean" }
      },
      required: ["app_name"],
      additionalProperties: false
    },
    examples: ["buckyos app restart app1"]
  };
}
function statusCommand() {
  return {
    verb: "status",
    summary: "Show desired, task, scheduled, runtime, version, and readiness state",
    positionals: [
      { name: "app_name", description: "Installed App name or DID; omit for all", required: false }
    ],
    inputSchema: {
      type: "object",
      properties: { app_name: { type: "string", minLength: 1 } },
      additionalProperties: false
    },
    outputSchema: OBJECT_OUTPUT$3,
    resultSchemaVersion: 1,
    access: { mode: "fixed", level: "read" },
    asyncMode: "sync",
    requiresSession: true,
    examples: ["buckyos app status", "buckyos app status did:bns:app1.alice"],
    handler: async (ctx, input) => {
      if (typeof input.app_name === "string") {
        const selector = normalizeAppSelector(input.app_name);
        const [status, details] = await Promise.all([
          callControl(ctx, "apps.status", { selector }),
          callControl(ctx, "apps.details", { selector })
        ]);
        const detailObject = expectObject$1(details, "apps.details response");
        const summary = expectObject$1(detailObject.summary, "apps.details summary");
        return {
          ...expectObject$1(status, "apps.status response"),
          web_hosts: Array.isArray(summary.web_hosts) ? summary.web_hosts : []
        };
      }
      const listed = expectObject$1(await callControl(ctx, "apps.list", {}), "apps.list response");
      const apps = Array.isArray(listed.apps) ? listed.apps : [];
      const items = await Promise.all(apps.map(async (item) => {
        const app = expectObject$1(item, "apps.list item");
        const selector = expectString$1(app, "app_instance_id");
        return {
          ...expectObject$1(
            await callControl(ctx, "apps.status", { selector }),
            "apps.status response"
          ),
          web_hosts: Array.isArray(app.web_hosts) ? app.web_hosts : []
        };
      }));
      return { total: items.length, items };
    }
  };
}
async function fetchApp(ctx, input, dependencies) {
  const source = await prepareSource(ctx, input, "inspect", dependencies);
  try {
    let inspection = await inspectSource(ctx, source, input);
    const planPathInput = optionalString(input.plan);
    let planPath;
    if (planPathInput) {
      inspection = await finalizePlanChoices(ctx, source, input, inspection);
      const plan = inspection.plan;
      assertPortablePlan(plan);
      planPath = resolveFromCwd(ctx, planPathInput);
      await writePlanFile(ctx, planPath, plan);
    }
    return {
      source: sourceSummary(source),
      app: inspection.plan.app,
      source_identity: inspection.plan.source_identity,
      resolution: inspection.resolution_status,
      status: inspection.status,
      plan_path: planPath ?? null,
      plan_fingerprint: planPath ? inspection.plan.plan_fingerprint : null
    };
  } finally {
    await releaseStaging(ctx, source);
  }
}
async function installApp(ctx, input, dependencies) {
  rejectDryRunNoWait(input);
  const submittedPlan = optionalString(input.plan) ? await readPlanFile(resolveFromCwd(ctx, String(input.plan))) : void 0;
  const source = await prepareSource(ctx, input, "install", dependencies);
  let keepStaging = false;
  try {
    let inspection = submittedPlan ? await recomputePlan(ctx, source, input, submittedPlan) : await inspectSource(ctx, source, input);
    verifyPikgBinding(source, submittedPlan ?? inspection.plan);
    const app = expectObject$1(inspection.plan.app, "inspection.plan.app");
    const appDid = expectString$1(app, "did");
    const plannedOwner = submittedPlan ? expectString$1(submittedPlan, "owner_user_id") : void 0;
    const installed = await findInstalled(ctx, appDid, plannedOwner);
    if (submittedPlan && installed) {
      throw new ToolError(
        "PLAN_NOT_APPLICABLE",
        "a fresh-install plan cannot be applied over an installed App"
      );
    }
    if (!submittedPlan && !installed) {
      throw new ToolError(
        "PLAN_REQUIRED",
        `App is not installed; run app fetch ${source.display} --plan <path> first`
      );
    }
    if (submittedPlan) {
      assertPlanMatchesInspection(submittedPlan, inspection);
    } else {
      const scope = installedScope(installed);
      inspection = await inspectSource(ctx, source, input, { ...scope, action: "upgrade" });
      verifyPikgBinding(source, inspection.plan);
    }
    if (input.dry_run === true) {
      return {
        action: "dry_run",
        source: sourceSummary(source),
        plan: inspection.plan,
        status: inspection.status
      };
    }
    if (planUse(inspection.plan) === "SATISFIED") {
      return satisfiedResult(inspection);
    }
    await confirmChange(ctx, "install", confirmationSummary(inspection));
    const params = {
      ...sourceRpcParams(source),
      ...planScopeAndOptions(inspection.plan),
      options: installOptions(input),
      plan: submittedPlan ?? null,
      approved_plan_fingerprint: expectString$1(inspection.plan, "plan_fingerprint"),
      idempotency_key: idempotencyKey(ctx)
    };
    const submitted = expectObject$1(
      await callControl(ctx, "apps.submit", params),
      "apps.submit response"
    );
    if (submitted.action === "satisfied" || submitted.task_id === null) {
      return submitted;
    }
    const taskId = expectString$1(submitted, "task_id");
    keepStaging = true;
    if (input.no_wait === true)
      return submitted;
    try {
      const status = await waitForTask(ctx, taskId, {
        observe: observeInstallTask,
        sleep: dependencies.sleep
      });
      return { ...submitted, status };
    } finally {
      keepStaging = false;
    }
  } finally {
    if (!keepStaging)
      await releaseStaging(ctx, source);
  }
}
async function upgradeApps(ctx, input, dependencies) {
  rejectDryRunNoWait(input);
  const selector = typeof input.app_name === "string" ? normalizeAppSelector(input.app_name) : void 0;
  const check = expectObject$1(
    await callControl(ctx, "apps.upgrade.check", selector ? { selector } : {}),
    "apps.upgrade.check response"
  );
  const items = Array.isArray(check.items) ? check.items : [];
  const actionable = items.filter((value) => {
    const item = isObject(value) ? value : {};
    return item.state === "UPDATE_AVAILABLE" || item.state === "PERMISSION_RECONFIRM_REQUIRED";
  });
  if (input.dry_run === true)
    return { action: "dry_run", check };
  if (actionable.length === 0)
    return { action: "satisfied", total: items.length, items };
  await confirmChange(ctx, "upgrade", {
    total: items.length,
    update_count: actionable.length,
    items
  });
  let submitted;
  let installTask = false;
  if (selector) {
    const item = expectObject$1(actionable[0], "upgrade item");
    const appDid = expectString$1(item, "app_did");
    const details = await findInstalled(ctx, appDid);
    if (!details)
      throw new ToolError("RESOURCE_NOT_FOUND", `App is not installed: ${appDid}`);
    const source = {
      kind: "catalog",
      display: appDid,
      serviceSource: { kind: "identifier", identifier: appDid }
    };
    const inspection = await inspectSource(ctx, source, input, {
      ...installedScope(details),
      action: "upgrade"
    });
    submitted = expectObject$1(
      await callControl(ctx, "apps.submit", {
        ...sourceRpcParams(source),
        ...planScopeAndOptions(inspection.plan),
        options: installOptions(input),
        approved_plan_fingerprint: expectString$1(inspection.plan, "plan_fingerprint"),
        idempotency_key: idempotencyKey(ctx)
      }),
      "apps.submit response"
    );
    installTask = submitted.task_id !== null;
  } else {
    submitted = expectObject$1(
      await callControl(ctx, "apps.upgrade", { idempotency_key: idempotencyKey(ctx) }),
      "apps.upgrade response"
    );
  }
  if (submitted.task_id === null || submitted.action === "satisfied")
    return submitted;
  const taskId = expectString$1(submitted, "task_id");
  if (input.no_wait === true)
    return submitted;
  const status = await waitForTask(ctx, taskId, {
    observe: installTask ? observeInstallTask : void 0,
    sleep: dependencies.sleep
  });
  return { ...submitted, status };
}
async function uninstallApp(ctx, input, dependencies) {
  rejectDryRunNoWait(input);
  const selector = normalizeAppSelector(expectString$1(input, "app_name"));
  const status = await callControl(ctx, "apps.status", { selector });
  const preflight = { action: "uninstall", data_disposition: input.data, status };
  if (input.dry_run === true)
    return { action: "dry_run", preflight };
  await confirmChange(ctx, "uninstall", preflight);
  const submitted = expectObject$1(
    await callControl(ctx, "apps.uninstall", {
      selector,
      data_disposition: input.data,
      idempotency_key: idempotencyKey(ctx)
    }),
    "apps.uninstall response"
  );
  const taskId = expectString$1(submitted, "task_id");
  if (input.no_wait === true)
    return submitted;
  const task = await waitForTask(ctx, taskId, { sleep: dependencies.sleep });
  return { ...submitted, status: task };
}
async function mutateLifecycle(ctx, input, verb) {
  if (input.strategy === "rolling") {
    throw new ToolError(
      "UNSUPPORTED_STRATEGY",
      "rolling restart is not supported by the current deployment strategy"
    );
  }
  const selector = normalizeAppSelector(expectString$1(input, "app_name"));
  const submitted = expectObject$1(
    await callControl(ctx, `apps.${verb}`, {
      selector,
      idempotency_key: idempotencyKey(ctx),
      ...verb === "restart" ? { restart_strategy: input.strategy ?? "recreate" } : {}
    }),
    `apps.${verb} response`
  );
  const taskId = expectString$1(submitted, "task_id");
  if (input.no_wait === true)
    return submitted;
  const task = await waitForTask(ctx, taskId);
  return { ...submitted, status: task };
}
async function prepareSource(ctx, input, purpose, dependencies) {
  const classified = await classifySource(ctx, input);
  if (classified.kind === "catalog")
    return classified;
  const snapshot = classified.kind === "url" ? await downloadPikg(classified.url, dependencies.download, ctx.signal) : await readPikg(classified.path, classified.kind);
  const stage = dependencies.stagePikg ?? stagePikg;
  const metadata = await stage(ctx, snapshot, purpose);
  if (metadata.schema_version !== PLAN_SCHEMA_VERSION) {
    throw new ToolError("UNSUPPORTED_SCHEMA_VERSION", "staging returned a non-v4 schema");
  }
  if (metadata.pikg_digest !== snapshot.digest || metadata.size !== snapshot.size) {
    throw new ToolError(
      "PIKG_DIGEST_MISMATCH",
      "the staged PIKG does not match the client byte snapshot",
      EXIT_OPERATION,
      false,
      {
        expected_digest: snapshot.digest,
        staged_digest: metadata.pikg_digest,
        expected_size: snapshot.size,
        staged_size: metadata.size
      }
    );
  }
  if (metadata.purpose !== purpose) {
    throw new ToolError("INVALID_SERVICE_RESPONSE", "staging purpose does not match the request", 9);
  }
  return {
    kind: snapshot.kind,
    display: snapshot.display,
    snapshot,
    staging: metadata,
    serviceSource: { kind: "local_pikg", staging_handle: metadata.handle }
  };
}
async function classifySource(ctx, input) {
  const positional = optionalString(input.source);
  const pikg = optionalString(input.pikg);
  if (positional && pikg) {
    throw new UsageError("ARGUMENT_CONFLICT", "<source> and --pikg are mutually exclusive");
  }
  const raw = pikg ?? positional;
  if (!raw)
    throw new UsageError("MISSING_ARGUMENT", "source or --pikg is required");
  const forced = pikg ? "pikg" : optionalString(input.from);
  if (pikg && forced && forced !== "pikg") {
    throw new UsageError("ARGUMENT_CONFLICT", "--pikg conflicts with --from");
  }
  if (forced === "url")
    return { kind: "url", url: parsePikgUrl(raw) };
  if (forced === "pikg")
    return { kind: "pikg", path: resolveFromCwd(ctx, raw) };
  if (forced === "catalog") {
    return {
      kind: "catalog",
      display: normalizeCatalogIdentifier(raw),
      serviceSource: { kind: "identifier", identifier: normalizeCatalogIdentifier(raw) }
    };
  }
  if (forced)
    throw new UsageError("INVALID_ARGUMENT", `invalid --from value: ${forced}`);
  if (/^https?:\/\//i.test(raw))
    return { kind: "url", url: parsePikgUrl(raw) };
  const candidatePath = resolveFromCwd(ctx, raw);
  const stat2 = await tryLstat(candidatePath);
  if (stat2) {
    if (!stat2.isFile) {
      throw new UsageError("INVALID_PIKG_SOURCE", `PIKG source is not a regular file: ${raw}`);
    }
    return { kind: "pikg", path: candidatePath };
  }
  if (looksLikeLocalPath(raw)) {
    throw new UsageError("PIKG_NOT_FOUND", `PIKG source does not exist: ${raw}`);
  }
  const identifier = normalizeCatalogIdentifier(raw);
  return {
    kind: "catalog",
    display: identifier,
    serviceSource: { kind: "identifier", identifier }
  };
}
async function readPikg(path, kind) {
  let file;
  try {
    file = await getHost().open(path, { read: true });
  } catch (error) {
    throw new UsageError("PIKG_READ_FAILED", `failed to open PIKG: ${errorMessage(error)}`);
  }
  try {
    const stat2 = await file.stat();
    if (!stat2.isFile)
      throw new UsageError("INVALID_PIKG_SOURCE", "PIKG source is not a file");
    if (stat2.size > Number.MAX_SAFE_INTEGER) {
      throw new UsageError("PIKG_TOO_LARGE", "PIKG is too large for this client");
    }
    const bytes = new Uint8Array(stat2.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = await file.read(bytes.subarray(offset));
      if (read === null)
        break;
      offset += read;
    }
    if (offset !== bytes.length) {
      throw new UsageError("PIKG_READ_FAILED", "PIKG changed size while being read");
    }
    validatePikgSnapshot(bytes);
    return {
      kind,
      display: path,
      bytes,
      digest: await sha256Id(bytes),
      size: bytes.length
    };
  } finally {
    await file.close();
  }
}
async function downloadPikg(url, downloader, signal) {
  let bytes;
  try {
    bytes = downloader ? await downloader(url, signal) : await defaultDownload(url, signal);
  } catch (error) {
    if (error instanceof ToolError)
      throw error;
    throw new ToolError(
      "PIKG_DOWNLOAD_FAILED",
      `failed to download PIKG: ${errorMessage(error)}`,
      5,
      true
    );
  }
  validatePikgSnapshot(bytes);
  return {
    kind: "url",
    display: safeUrl(url),
    bytes,
    digest: await sha256Id(bytes),
    size: bytes.length
  };
}
async function defaultDownload(url, signal) {
  const response = await fetch(url, { method: "GET", redirect: "follow", signal });
  if (!response.ok) {
    throw new ToolError(
      "PIKG_DOWNLOAD_FAILED",
      `PIKG download returned HTTP ${response.status}`,
      5,
      response.status >= 500
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}
async function stagePikg(ctx, snapshot, purpose) {
  const session = ctx.session;
  if (!session)
    throw new ToolError("AUTH_REQUIRED", "authenticated session is required", 3);
  const token = (await session.ensureValid()).token;
  const hash = ndn.sha256Bytes(snapshot.bytes);
  const chunkId = ndn.ChunkId.fromMix256Result(snapshot.size, hash).toString();
  const proxy = ndm_proxy.createNdmProxyClient({
    endpoint: gatewayOrigin(ctx.connection.endpoint),
    sessionToken: token,
    fetcher: (request, init) => fetch(normalizeNdmRequestUrl(request), { ...init, signal: ctx.signal })
  });
  let uploadError;
  try {
    await proxy.putChunk(chunkId, snapshot.bytes);
  } catch (error) {
    uploadError = error;
  }
  let value;
  try {
    value = expectObject$1(
      await callControl(ctx, "apps.staging.finalize", {
        source_obj_id: chunkId,
        purpose
      }),
      "apps.staging.finalize response"
    );
  } catch (error) {
    if (uploadError === void 0)
      throw error;
    throw new ToolError(
      "PIKG_UPLOAD_FAILED",
      `failed to upload PIKG snapshot: ${errorMessage(uploadError)}`,
      5,
      true,
      { finalize_error: errorMessage(error) }
    );
  }
  return {
    schema_version: expectNumber(value, "schema_version"),
    handle: expectString$1(value, "handle"),
    pikg_digest: expectString$1(value, "pikg_digest"),
    size: expectNumber(value, "size"),
    purpose: expectString$1(value, "purpose"),
    expires_at: optionalNumber(value.expires_at)
  };
}
function normalizeNdmRequestUrl(request) {
  if (typeof request === "string") {
    return request.replaceAll("%3A", ":").replaceAll("%3a", ":");
  }
  if (request instanceof URL) {
    return new URL(request.toString().replaceAll("%3A", ":").replaceAll("%3a", ":"));
  }
  return request;
}
async function inspectSource(ctx, source, input, overrides = {}) {
  const result = await callControl(ctx, "apps.inspect", {
    ...sourceRpcParams(source),
    ...scopeAndChoiceParams(input),
    ...overrides,
    options: installOptions(input)
  });
  return expectInspection(result);
}
async function recomputePlan(ctx, source, input, plan, overrides = {}) {
  return expectInspection(
    await callControl(ctx, "apps.plan.recompute", {
      ...sourceRpcParams(source),
      ...planScopeAndOptions(plan),
      ...overrides,
      plan,
      options: installOptions(input)
    })
  );
}
async function finalizePlanChoices(ctx, source, input, initial) {
  let inspection = initial;
  const configReady = readinessValue(inspection, "config") === "READY";
  if (ctx.config.nonInteractive) {
    if (!configReady && input.target === void 0 && input.install_params === void 0) {
      throw new ToolError(
        "PLAN_INPUT_REQUIRED",
        "Installer defaults do not form a complete install plan; provide target/install_params with --input"
      );
    }
    return inspection;
  }
  await ctx.io.stderr(`${JSON.stringify(confirmationSummary(inspection), null, 2)}
`);
  if (!ctx.io.inputIsTerminal || ctx.confirmed)
    return inspection;
  const answer = (await ctx.io.prompt("Accept default install plan? [Y/e/n] "))?.trim().toLowerCase();
  if (answer === "n" || answer === "no") {
    throw new ToolError(
      "CONFIRMATION_DECLINED",
      "install plan creation was declined",
      EXIT_PERMISSION
    );
  }
  if (answer === "e" || answer === "edit") {
    const raw = await ctx.io.prompt('Plan choices JSON ({"target":...,"install_params":...}): ');
    const choices = parsePlanChoices(raw);
    inspection = await recomputePlan(ctx, source, input, initial.plan, choices);
  }
  if (readinessValue(inspection, "config") !== "READY") {
    throw new ToolError(
      "PLAN_INPUT_REQUIRED",
      "the selected plan still has unresolved configuration requirements"
    );
  }
  return inspection;
}
async function findInstalled(ctx, appDid, ownerUserId) {
  try {
    return expectObject$1(
      await callControl(ctx, "apps.details", {
        selector: appDid,
        ...ownerUserId ? { owner_user_id: ownerUserId } : {}
      }),
      "apps.details response"
    );
  } catch (error) {
    if (error instanceof ToolError && error.code === "RESOURCE_NOT_FOUND")
      return void 0;
    throw error;
  }
}
async function observeInstallTask(ctx, taskId) {
  const status = expectObject$1(
    await callControl(ctx, "apps.install.status", { task_id: taskId }),
    "apps.install.status response"
  );
  const error = isObject(status.error) ? status.error : void 0;
  const sanitizedDetails = error && isObject(error.details) ? sanitizeAppOutput(error.details) : void 0;
  return {
    phase: expectString$1(status, "task_phase"),
    outcome: optionalString(status.task_outcome),
    message: installProgressMessage(status),
    error: error ? {
      code: optionalString(error.code),
      message: optionalString(error.message),
      retryable: typeof error.retryable === "boolean" ? error.retryable : void 0,
      details: isObject(sanitizedDetails) ? sanitizedDetails : void 0
    } : void 0,
    data: status
  };
}
async function confirmChange(ctx, action, summary) {
  await ctx.io.stderr(`${JSON.stringify({ action, preflight: summary }, null, 2)}
`);
  if (ctx.confirmed)
    return;
  if (ctx.config.nonInteractive || !ctx.io.inputIsTerminal) {
    throw new ToolError(
      "CONFIRMATION_REQUIRED",
      `${action} requires --yes in non-interactive execution`,
      EXIT_PERMISSION
    );
  }
  const answer = (await ctx.io.prompt(`Proceed with app ${action}? [y/N] `))?.trim().toLowerCase();
  if (answer !== "y" && answer !== "yes") {
    throw new ToolError("CONFIRMATION_DECLINED", `${action} was declined`, EXIT_PERMISSION);
  }
}
async function callControl(ctx, method, params) {
  try {
    return await ctx.clients.call(CONTROL_PANEL_SERVICE, method, params, rpcOptions$1(ctx));
  } catch (error) {
    throw normalizeAppServiceError(error);
  }
}
function normalizeAppServiceError(error) {
  if (error instanceof ToolError)
    return error;
  const message = errorMessage(error);
  const structured = parseEmbeddedJson(message);
  if (structured && typeof structured.code === "string") {
    const rawDetails = isObject(structured.details) ? structured.details : structured;
    const details = sanitizeAppOutput(rawDetails);
    return new ToolError(
      structured.code,
      typeof structured.message === "string" ? structured.message : message,
      structured.code === "AMBIGUOUS_APP_TARGET" ? EXIT_OPERATION : EXIT_OPERATION,
      structured.retryable === true,
      isObject(details) ? details : {}
    );
  }
  const lower = message.toLowerCase();
  if (lower.includes("invalid token") || lower.includes("unauthorized") || lower.includes("rpc call error: 401") || lower.includes("session expired") || lower.includes("token expired")) {
    return new ToolError(
      lower.includes("expired") ? "SESSION_EXPIRED" : "INVALID_SESSION",
      lower.includes("expired") ? "the session token has expired" : message,
      EXIT_AUTH
    );
  }
  if (lower.includes("abort") || lower.includes("cancel")) {
    return new ToolError("CANCELED", "operation canceled", EXIT_TIMEOUT);
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return new ToolError("TIMEOUT", "operation timed out", EXIT_TIMEOUT, true);
  }
  if (lower.includes("fetch failed") || lower.includes("connection refused") || lower.includes("rpc call error: 502") || lower.includes("rpc call error: 503") || lower.includes("rpc call error: 504")) {
    return new ToolError("SERVICE_UNAVAILABLE", message, EXIT_UNAVAILABLE, true);
  }
  if (message.includes("APP_NOT_INSTALLED") || /not found/i.test(message)) {
    return new ToolError("RESOURCE_NOT_FOUND", message);
  }
  if (/permission|forbidden/i.test(message)) {
    return new ToolError("PERMISSION_DENIED", message, EXIT_PERMISSION);
  }
  if (/rolling restart is not supported/i.test(message)) {
    return new ToolError("UNSUPPORTED_STRATEGY", message);
  }
  return new ToolError("OPERATION_FAILED", message, EXIT_OPERATION);
}
function sourceRpcParams(source) {
  return { source: source.serviceSource };
}
function scopeAndChoiceParams(input) {
  return {
    ...typeof input.owner_user_id === "string" ? { owner_user_id: input.owner_user_id } : {},
    ...isObject(input.target) ? { target: input.target } : {},
    ...isObject(input.install_params) ? { install_params: input.install_params } : {}
  };
}
function planScopeAndOptions(plan) {
  return {
    owner_user_id: expectString$1(plan, "owner_user_id"),
    target: expectObject$1(plan.target, "plan.target"),
    install_params: expectObject$1(plan.install_params, "plan.install_params")
  };
}
function installedScope(details) {
  return {
    owner_user_id: expectString$1(details, "owner_user_id")
  };
}
function installOptions(input) {
  const policy2 = optionalString(input.policy) ?? "normal";
  return { policy: policy2.replaceAll("-", "_").toUpperCase() };
}
function sourceSummary(source) {
  if (source.kind === "catalog")
    return { kind: source.kind, identifier: source.display };
  return {
    kind: source.kind,
    source: source.display,
    pikg_digest: source.snapshot.digest,
    size: source.snapshot.size
  };
}
function confirmationSummary(inspection) {
  const plan = inspection.plan;
  return {
    plan_fingerprint: plan.plan_fingerprint,
    plan_use: plan.plan_use,
    app: plan.app,
    app_instance_id: plan.app_instance_id,
    owner_user_id: plan.owner_user_id,
    target: plan.target,
    selected_packages: plan.selected_packages,
    install_params: plan.install_params,
    readiness: inspection.status.readiness,
    warnings: inspection.status.warnings ?? []
  };
}
function satisfiedResult(inspection) {
  return {
    action: "satisfied",
    task_id: null,
    app_instance_id: inspection.plan.app_instance_id,
    app_doc_object_id: expectObject$1(inspection.plan.app, "plan.app").object_id
  };
}
function assertPlanMatchesInspection(plan, inspection) {
  const fingerprint = expectString$1(plan, "plan_fingerprint");
  if (fingerprint !== inspection.plan.plan_fingerprint) {
    throw new ToolError(
      "PLAN_STALE",
      "the plan no longer matches the authoritative source, scope, target, or configuration",
      EXIT_OPERATION,
      false,
      {
        plan_fingerprint: fingerprint,
        current_fingerprint: inspection.plan.plan_fingerprint
      }
    );
  }
}
function verifyPikgBinding(source, plan) {
  if (source.kind === "catalog")
    return;
  const identity = expectObject$1(plan.source_identity, "plan.source_identity");
  const digest = expectString$1(identity, "pikg_digest");
  if (digest !== source.snapshot.digest) {
    throw new ToolError(
      "PLAN_STALE",
      "the PIKG byte snapshot does not match the plan source digest",
      EXIT_OPERATION,
      false,
      { plan_digest: digest, source_digest: source.snapshot.digest }
    );
  }
}
function assertPortablePlan(plan) {
  if (plan.schema_version !== PLAN_SCHEMA_VERSION) {
    throw new ToolError(
      "UNSUPPORTED_SCHEMA_VERSION",
      `InstallPlan schema must be v${PLAN_SCHEMA_VERSION}`
    );
  }
  expectString$1(plan, "plan_fingerprint");
  expectString$1(plan, "task_id");
  const allowed = /* @__PURE__ */ new Set([
    "schema_version",
    "plan_use",
    "task_id",
    "app_instance_id",
    "owner_user_id",
    "source_identity",
    "app",
    "app_doc",
    "resolution",
    "target",
    "selected_packages",
    "required_contents",
    "install_params",
    "service_spec_config",
    "plan_fingerprint",
    "created_at"
  ]);
  for (const key of Object.keys(plan)) {
    if (!allowed.has(key)) {
      throw new ToolError("PLAN_STALE", `InstallPlan contains an unknown field: ${key}`);
    }
  }
  assertNoPlanSecrets(plan, "plan");
}
function assertNoPlanSecrets(value, path) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPlanSecrets(item, `${path}[${index}]`));
    return;
  }
  if (!isObject(value))
    return;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase();
    const disallowed = normalized === "staging_handle" || normalized === "staging_path" || normalized === "session_token" || normalized === "refresh_token" || normalized === "private_key" || normalized === "password" || normalized.endsWith("_token") || normalized.endsWith("_password") || normalized.endsWith("_private_key") || normalized.endsWith("secret") && normalized !== "secret_ref";
    if (disallowed) {
      throw new ToolError("INVALID_PLAN_SECRET", `${path}.${key} is forbidden in InstallPlan`);
    }
    if (typeof child === "string" && (/^[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/i.test(child) || /^(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\//i.test(child))) {
      throw new ToolError(
        "INVALID_PLAN_SECRET",
        `${path}.${key} contains a connection string; use SecretRef`
      );
    }
    assertNoPlanSecrets(child, `${path}.${key}`);
  }
}
async function readPlanFile(path) {
  let raw;
  try {
    raw = await getHost().readTextFile(path);
  } catch (error) {
    throw new UsageError("PLAN_READ_FAILED", `failed to read InstallPlan: ${errorMessage(error)}`);
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new UsageError("INVALID_PLAN_JSON", "InstallPlan is not valid JSON");
  }
  const plan = expectObject$1(value, "InstallPlan");
  assertPortablePlan(plan);
  return plan;
}
async function writePlanFile(ctx, path, plan) {
  const exists = await tryLstat(path);
  if (exists) {
    if (!exists.isFile) {
      throw new UsageError("INVALID_PLAN_PATH", "InstallPlan destination is not a regular file");
    }
    if (!ctx.confirmed) {
      if (ctx.config.nonInteractive || !ctx.io.inputIsTerminal) {
        throw new ToolError(
          "CONFIRMATION_REQUIRED",
          `InstallPlan already exists: ${path}; use --yes to overwrite it`,
          EXIT_PERMISSION
        );
      }
      const answer = (await ctx.io.prompt(`Overwrite existing InstallPlan ${path}? [y/N] `))?.trim().toLowerCase();
      if (answer !== "y" && answer !== "yes") {
        throw new ToolError(
          "CONFIRMATION_DECLINED",
          "InstallPlan overwrite was declined",
          EXIT_PERMISSION
        );
      }
    }
  }
  const content = `${JSON.stringify(plan, null, 2)}
`;
  try {
    await getHost().writeTextFile(
      path,
      content,
      exists ? { mode: 384 } : { createNew: true, mode: 384 }
    );
    if (getHost().platform !== "windows")
      await getHost().chmod(path, 384);
  } catch (error) {
    throw new UsageError("PLAN_WRITE_FAILED", `failed to write InstallPlan: ${errorMessage(error)}`);
  }
}
async function releaseStaging(ctx, source) {
  if (source.kind === "catalog")
    return;
  try {
    await ctx.clients.call(
      CONTROL_PANEL_SERVICE,
      "apps.staging.release",
      { staging_handle: source.staging.handle },
      {
        traceId: ctx.traceId,
        timeoutMs: STAGING_RELEASE_TIMEOUT_MS,
        signal: new AbortController().signal
      }
    );
  } catch (error) {
    await ctx.io.stderr(`warning: failed to release PIKG staging lease: ${errorMessage(error)}
`);
  }
}
function expectInspection(value) {
  const object = expectObject$1(value, "apps.inspect response");
  const schemaVersion = expectNumber(object, "schema_version");
  if (schemaVersion !== PLAN_SCHEMA_VERSION) {
    throw new ToolError(
      "UNSUPPORTED_SCHEMA_VERSION",
      `Installer returned schema v${schemaVersion}; v${PLAN_SCHEMA_VERSION} is required`
    );
  }
  const inspection = {
    schema_version: schemaVersion,
    plan: expectObject$1(object.plan, "inspection.plan"),
    resolution_status: expectObject$1(object.resolution_status, "inspection.resolution_status"),
    status: expectObject$1(object.status, "inspection.status")
  };
  assertPortablePlan(inspection.plan);
  if (inspection.status.plan_fingerprint !== inspection.plan.plan_fingerprint) {
    throw new ToolError("INVALID_SERVICE_RESPONSE", "inspection fingerprint fields disagree", 9);
  }
  return inspection;
}
function parsePlanChoices(raw) {
  if (!raw)
    throw new ToolError("PLAN_INPUT_REQUIRED", "plan choices JSON is required");
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new UsageError("INVALID_INPUT_JSON", "plan choices are not valid JSON");
  }
  const choices = expectObject$1(value, "plan choices");
  for (const key of Object.keys(choices)) {
    if (key !== "target" && key !== "install_params") {
      throw new UsageError("INVALID_ARGUMENT", `unknown plan choice: ${key}`);
    }
  }
  return choices;
}
function normalizeCatalogIdentifier(value) {
  const raw = value.trim();
  if (!raw || /^https?:\/\//i.test(raw) || raw.includes("/") || raw.includes("\\") || /\s/.test(raw)) {
    throw new UsageError("INVALID_APP_NAME", `invalid Catalog App identifier: ${value}`);
  }
  if (raw.startsWith("did:")) {
    return parseAppDid(raw);
  }
  return raw.includes(".") ? raw.toLowerCase() : parseAppDid(`did:bns:${raw}`);
}
function normalizeAppSelector(value) {
  return normalizeCatalogIdentifier(value);
}
function parseAppDid(raw) {
  let did;
  try {
    did = namelib.DID.fromStr(raw);
  } catch (error) {
    throw new UsageError("INVALID_APP_DID", `invalid App DID: ${errorMessage(error)}`);
  }
  if (did.method === "key" || did.method === "dev") {
    throw new UsageError("INVALID_APP_DID", "key-class DIDs cannot identify an App");
  }
  return did.toString();
}
function parsePikgUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new UsageError("INVALID_PIKG_URL", `invalid PIKG URL: ${value}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UsageError("INVALID_PIKG_URL", "PIKG URL must use HTTP or HTTPS");
  }
  if (url.username || url.password) {
    throw new UsageError("INVALID_PIKG_URL", "PIKG URL must not contain credentials");
  }
  return url;
}
function validatePikgSnapshot(bytes) {
  if (bytes.length < ZIP_LOCAL_MAGIC.length) {
    throw new UsageError("INVALID_PIKG", "PIKG is too small to be a ZIP container");
  }
  if (!ZIP_LOCAL_MAGIC.every((byte, index) => bytes[index] === byte)) {
    throw new UsageError("INVALID_PIKG", "PIKG magic mismatch: expected a ZIP container");
  }
}
async function sha256Id(bytes) {
  const digestInput = Uint8Array.from(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", digestInput.buffer));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function gatewayOrigin(endpoint) {
  const url = new URL(endpoint);
  const marker = url.pathname.indexOf("/kapi");
  url.pathname = marker >= 0 ? url.pathname.slice(0, marker) || "/" : "/";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}
function safeUrl(url) {
  const safe = new URL(url);
  safe.search = "";
  safe.hash = "";
  return safe.toString();
}
function looksLikeLocalPath(value) {
  return value.includes("/") || value.includes("\\") || value.startsWith(".") || value.toLowerCase().endsWith(".pikg");
}
async function tryLstat(path) {
  try {
    return await getHost().lstat(path);
  } catch (error) {
    if (isHostError(error, "NotFound"))
      return void 0;
    throw new UsageError("FILE_ACCESS_FAILED", `failed to inspect ${path}: ${errorMessage(error)}`);
  }
}
function resolveFromCwd(ctx, path) {
  return isAbsolute(path) ? resolve(path) : resolve(ctx.cwd, path);
}
function parseEmbeddedJson(message) {
  for (let index = message.indexOf("{"); index >= 0; index = message.indexOf("{", index + 1)) {
    try {
      const value = JSON.parse(message.slice(index));
      if (isObject(value))
        return value;
    } catch {
    }
  }
  return void 0;
}
function readinessValue(inspection, field) {
  const readiness = isObject(inspection.status.readiness) ? inspection.status.readiness : void 0;
  return readiness ? optionalString(readiness[field]) : void 0;
}
function planUse(plan) {
  return optionalString(plan.plan_use);
}
function installProgressMessage(status) {
  const stage = optionalString(status.stage);
  const progress = isObject(status.progress) ? status.progress : void 0;
  const percent = progress && typeof progress.percent === "number" ? `${progress.percent}%` : void 0;
  return [stage, percent].filter(Boolean).join(" ") || void 0;
}
function idempotencyKey(ctx) {
  return ctx.idempotencyKey ?? crypto.randomUUID();
}
function rejectDryRunNoWait(input) {
  if (input.dry_run === true && input.no_wait === true) {
    throw new UsageError("ARGUMENT_CONFLICT", "--dry-run and --no-wait are mutually exclusive");
  }
}
function selectorCommand(options) {
  return {
    verb: options.verb,
    summary: options.summary,
    positionals: [{ name: "app_name", description: "Installed App name or DID" }],
    inputSchema: {
      type: "object",
      properties: { app_name: { type: "string", minLength: 1 } },
      required: ["app_name"],
      additionalProperties: false
    },
    outputSchema: OBJECT_OUTPUT$3,
    resultSchemaVersion: 1,
    access: { mode: "fixed", level: options.access },
    asyncMode: options.asyncMode,
    requiresSession: true,
    examples: [`buckyos app ${options.verb} app1`],
    handler: options.handler
  };
}
function sourceOptions(extra) {
  return [
    {
      name: "from",
      description: "Force source type",
      type: "string",
      enum: ["catalog", "pikg", "url"]
    },
    { name: "pikg", description: "Explicit local PIKG path", type: "string" },
    ...extra
  ];
}
function sourceInputSchema(extra) {
  return {
    type: "object",
    properties: {
      source: { type: "string", minLength: 1 },
      from: { type: "string", enum: ["catalog", "pikg", "url"] },
      pikg: { type: "string", minLength: 1 },
      ...extra
    },
    additionalProperties: false
  };
}
function emptyInputSchema() {
  return { type: "object", properties: {}, additionalProperties: false };
}
function ownerOption() {
  return {
    name: "owner",
    property: "owner_user_id",
    description: "Installation owner user",
    type: "string"
  };
}
function policyOption() {
  return {
    name: "policy",
    description: "Installer trust policy",
    type: "string",
    enum: [...INSTALL_POLICIES]
  };
}
function rpcOptions$1(ctx) {
  return {
    traceId: ctx.traceId,
    timeoutMs: Math.max(1, (ctx.deadline ?? Date.now()) - Date.now()),
    signal: ctx.signal
  };
}
function expectObject$1(value, label) {
  if (!isObject(value)) {
    throw new ToolError("INVALID_SERVICE_RESPONSE", `${label} must be an object`, EXIT_INTERNAL);
  }
  return value;
}
function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function expectString$1(value, property) {
  const candidate = isObject(value) ? value[property] : value;
  if (typeof candidate !== "string" || !candidate.trim()) {
    throw new ToolError("INVALID_SERVICE_RESPONSE", `${property} must be a non-empty string`, 9);
  }
  return candidate;
}
function expectNumber(object, property) {
  const value = object[property];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ToolError("INVALID_SERVICE_RESPONSE", `${property} must be a non-negative integer`, 9);
  }
  return value;
}
function optionalString(value) {
  return typeof value === "string" && value.trim() ? value : void 0;
}
function optionalNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function sanitizeAppOutput(value) {
  if (Array.isArray(value))
    return value.map(sanitizeAppOutput);
  if (!isObject(value))
    return value;
  const result = {};
  const forbidden = /* @__PURE__ */ new Set([
    "spec_path",
    "staging_handle",
    "staging_path",
    "source_url",
    "session_token",
    "refresh_token",
    "private_key",
    "password",
    "connection_string",
    "database_url"
  ]);
  for (const [key, child] of Object.entries(value)) {
    if (!forbidden.has(key.toLowerCase()))
      result[key] = sanitizeAppOutput(child);
  }
  return result;
}
async function downloadArtifact(ctx, service, rawUrl, rawPath, fetcher = defaultArtifactFetcher) {
  const path = getHost().path.isAbsolute(rawPath) ? rawPath : getHost().path.resolve(ctx.cwd, rawPath);
  const base = new URL(resolveServiceUrl(ctx.config, service));
  const url = new URL(rawUrl, `${base.protocol}//${base.host}`);
  if (url.origin !== base.origin || url.username || url.password) {
    throw new ToolError("INVALID_DOWNLOAD_URL", "artifact URL must use the configured Zone origin");
  }
  const bytes = await fetcher(url, ctx);
  try {
    const file = await getHost().open(path, { createNew: true, write: true });
    try {
      let offset = 0;
      while (offset < bytes.length)
        offset += await file.write(bytes.subarray(offset));
      await file.sync();
    } finally {
      await file.close();
    }
  } catch (error) {
    if (isHostError(error, "AlreadyExists")) {
      throw new UsageError("OUTPUT_EXISTS", `output path already exists: ${path}`);
    }
    try {
      await getHost().remove(path);
    } catch {
    }
    throw error;
  }
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return { path, size: bytes.byteLength, sha256: toHex(new Uint8Array(digest)) };
}
async function defaultArtifactFetcher(url, ctx) {
  const token = ctx.session ? (await ctx.session.ensureValid()).token : void 0;
  const response = await fetch(url, {
    headers: token ? { authorization: `Bearer ${token}` } : void 0,
    signal: ctx.signal
  });
  if (!response.ok) {
    throw new ToolError(
      "DOWNLOAD_FAILED",
      `artifact download failed with HTTP ${response.status}`
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}
function toHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function rpcOptions(ctx) {
  return {
    traceId: ctx.traceId,
    timeoutMs: Math.max(1, (ctx.deadline ?? Date.now()) - Date.now()),
    signal: ctx.signal
  };
}
async function callService(ctx, service, method, params) {
  try {
    return await ctx.clients.call(service, method, params, rpcOptions(ctx));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stable = message.match(/\b((?:TASK|AUDIT|DIAGNOSTIC|LOG)_[A-Z0-9_]+):/);
    if (stable)
      throw new ToolError(stable[1], message);
    throw error;
  }
}
function expectObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ToolError("INVALID_SERVICE_RESPONSE", `${label} must be an object`, EXIT_INTERNAL);
  }
  return value;
}
function expectString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ToolError("INVALID_SERVICE_RESPONSE", `${label} must be a string`, EXIT_INTERNAL);
  }
  return value;
}
function inputString(input, key) {
  const value = input[key];
  return typeof value === "string" && value.trim() ? value.trim() : void 0;
}
function requiredInputString(input, key) {
  const value = inputString(input, key);
  if (!value)
    throw new UsageError("INVALID_ARGUMENT", `${key} is required`);
  return value;
}
function parseTimestamp(value, key) {
  if (value === void 0)
    return void 0;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
    return value;
  if (typeof value !== "string" || !value.trim()) {
    throw new UsageError("INVALID_ARGUMENT", `${key} must be RFC 3339 or Unix milliseconds`);
  }
  if (/^\d+$/.test(value)) {
    const milliseconds2 = Number(value);
    if (Number.isSafeInteger(milliseconds2))
      return milliseconds2;
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new UsageError("INVALID_ARGUMENT", `${key} must be RFC 3339 or Unix milliseconds`);
  }
  return milliseconds;
}
function splitServices(value) {
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return [...new Set(items.map((item) => String(item).trim()).filter(Boolean))];
}
const CONTROL_PANEL$2 = "control-panel";
const OBJECT_OUTPUT$2 = { type: "object", additionalProperties: true };
function createDiagnosticModule(dependencies = {}) {
  return {
    name: "diagnostic",
    summary: "Collect and export privileged redacted diagnostic bundles",
    commands: [collectCommand(), exportCommand$1(dependencies)]
  };
}
function collectCommand() {
  return {
    verb: "collect",
    summary: "Create a redacted diagnostic bundle Task",
    options: [
      {
        name: "services",
        description: "Comma-separated service IDs",
        type: "string",
        required: true
      },
      { name: "since", description: "RFC 3339 lower time boundary", type: "string" },
      { name: "until", description: "RFC 3339 upper time boundary", type: "string" },
      {
        name: "no-wait",
        property: "no_wait",
        description: "Return after Task creation",
        type: "boolean"
      }
    ],
    inputSchema: {
      type: "object",
      properties: {
        services: {},
        since: { type: "string", minLength: 1 },
        until: { type: "string", minLength: 1 },
        no_wait: { type: "boolean" }
      },
      required: ["services"],
      additionalProperties: false
    },
    outputSchema: OBJECT_OUTPUT$2,
    resultSchemaVersion: 1,
    access: { mode: "fixed", level: "privileged" },
    asyncMode: "task",
    requiresSession: true,
    examples: [
      "buckyos --idempotency-key diag-42 diagnostic collect --services scheduler,node_daemon --since 2026-08-25T00:00:00Z"
    ],
    handler: async (ctx, input) => {
      const services = splitServices(input.services);
      if (services.length === 0) {
        throw new UsageError("INVALID_ARGUMENT", "at least one diagnostic service is required");
      }
      const response = expectObject(
        await callService(
          ctx,
          CONTROL_PANEL$2,
          "diagnostic.collect",
          compact$2({
            services,
            since: inputString(input, "since"),
            until: inputString(input, "until"),
            idempotency_key: ctx.idempotencyKey ?? `diagnostic-${crypto.randomUUID()}`
          })
        ),
        "Control Panel diagnostic.collect response"
      );
      const taskId = expectString(response.task_id, "diagnostic.collect.task_id");
      if (input.no_wait === true)
        return { task_id: taskId };
      return await waitForTask(ctx, taskId);
    }
  };
}
function exportCommand$1(dependencies) {
  return {
    verb: "export",
    summary: "Export one diagnostic bundle to a new file",
    positionals: [{ name: "bundle_id", description: "Opaque bundle ID", required: true }],
    options: [{
      name: "path",
      description: "New destination file",
      type: "string",
      required: true
    }],
    inputSchema: {
      type: "object",
      properties: {
        bundle_id: { type: "string", minLength: 1 },
        path: { type: "string", minLength: 1 }
      },
      required: ["bundle_id", "path"],
      additionalProperties: false
    },
    outputSchema: OBJECT_OUTPUT$2,
    resultSchemaVersion: 1,
    access: { mode: "fixed", level: "privileged" },
    asyncMode: "sync",
    requiresSession: true,
    examples: ["buckyos diagnostic export diag-opaque --path ./diagnostic.zip"],
    handler: async (ctx, input) => await exportDiagnostic(ctx, input, dependencies)
  };
}
async function exportDiagnostic(ctx, input, dependencies) {
  const response = expectObject(
    await callService(ctx, CONTROL_PANEL$2, "diagnostic.export", {
      bundle_id: requiredInputString(input, "bundle_id")
    }),
    "Control Panel diagnostic.export response"
  );
  const downloaded = await downloadArtifact(
    ctx,
    CONTROL_PANEL$2,
    expectString(response.url, "diagnostic.export.url"),
    requiredInputString(input, "path"),
    dependencies.download
  );
  const expected = typeof response.artifact_sha256 === "string" ? response.artifact_sha256 : void 0;
  if (expected && downloaded.sha256 !== expected) {
    try {
      await getHost().remove(downloaded.path);
    } catch {
    }
    throw new ToolError("ARTIFACT_HASH_MISMATCH", "diagnostic archive SHA-256 mismatch");
  }
  return {
    ...downloaded,
    bundle_id: response.bundle_id ?? input.bundle_id,
    content_sha256: response.sha256 ?? null,
    expires_at: response.expires_at ?? null
  };
}
function compact$2(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== void 0));
}
const CONTROL_PANEL$1 = "control-panel";
const OBJECT_OUTPUT$1 = { type: "object", additionalProperties: true };
function createLogModule(dependencies = {}) {
  return {
    name: "log",
    summary: "Query, follow, and export redacted system logs",
    commands: [queryCommand(), tailCommand(dependencies), exportCommand(dependencies)]
  };
}
function queryCommand() {
  return {
    verb: "query",
    summary: "Query structured redacted log entries",
    options: [
      ...filterOptions(false),
      {
        name: "direction",
        description: "Page direction",
        type: "string",
        enum: ["forward", "backward"]
      },
      { name: "cursor", description: "Opaque page cursor", type: "string" },
      { name: "limit", description: "Page size, at most 500", type: "integer" }
    ],
    inputSchema: filterSchema({
      direction: { type: "string", enum: ["forward", "backward"] },
      cursor: { type: "string", minLength: 1 },
      limit: { type: "integer", minimum: 1 }
    }),
    outputSchema: pageSchema$1(),
    resultSchemaVersion: 1,
    access: { mode: "fixed", level: "read" },
    asyncMode: "sync",
    requiresSession: true,
    examples: ["buckyos log query --service scheduler --level error --limit 100"],
    handler: async (ctx, input) => {
      const params = normalizeFilter(input, true);
      const response = expectObject(
        await callService(ctx, CONTROL_PANEL$1, "system.logs.query", params),
        "Control Panel log query response"
      );
      if (!Array.isArray(response.entries))
        invalidResponse$1("log query entries");
      return { items: response.entries, next_cursor: response.nextCursor ?? null };
    }
  };
}
function tailCommand(dependencies) {
  const sleep = dependencies.sleep ?? abortableSleep;
  return {
    verb: "tail",
    summary: "Continuously stream structured redacted log entries",
    options: [
      ...filterOptions(false),
      {
        name: "from",
        description: "Initial read position",
        type: "string",
        enum: ["start", "end"]
      }
    ],
    inputSchema: filterSchema({ from: { type: "string", enum: ["start", "end"] } }),
    outputSchema: OBJECT_OUTPUT$1,
    resultSchemaVersion: 1,
    access: { mode: "fixed", level: "read" },
    asyncMode: "stream",
    requiresSession: true,
    examples: ["buckyos --timeout 10m log tail --service scheduler --from end"],
    handler: async (ctx, input) => {
      const params = normalizeFilter(input, false);
      if (params.services.length !== 1) {
        throw new UsageError("INVALID_ARGUMENT", "log tail requires exactly one service");
      }
      let cursor;
      while (true) {
        const remaining = (ctx.deadline ?? Date.now()) - Date.now();
        if (remaining <= 0)
          throw timeoutError();
        const response = expectObject(
          await callService(ctx, CONTROL_PANEL$1, "system.logs.tail", {
            ...params,
            cursor,
            from: inputString(input, "from") ?? "end",
            limit: 500
          }),
          "Control Panel log tail response"
        );
        if (!Array.isArray(response.entries))
          invalidResponse$1("log tail entries");
        for (const entry of response.entries) {
          await ctx.io.stdout(`${JSON.stringify({
            schema_version: 1,
            type: "log-entry",
            entry
          })}
`);
        }
        cursor = expectString(response.nextCursor, "log tail nextCursor");
        await sleep(
          Math.min(500, Math.max(1, (ctx.deadline ?? Date.now()) - Date.now())),
          ctx.signal
        );
      }
    }
  };
}
function exportCommand(dependencies) {
  return {
    verb: "export",
    summary: "Export a bounded redacted log archive to a new file",
    options: [
      ...filterOptions(true),
      { name: "path", description: "New destination file", type: "string", required: true }
    ],
    inputSchema: {
      ...filterSchema({ path: { type: "string", minLength: 1 } }),
      required: ["path"]
    },
    outputSchema: OBJECT_OUTPUT$1,
    resultSchemaVersion: 1,
    access: { mode: "fixed", level: "read" },
    asyncMode: "sync",
    requiresSession: true,
    examples: [
      "buckyos log export --services scheduler,node_daemon --since 2026-08-25T00:00:00Z --path ./logs.zip"
    ],
    handler: async (ctx, input) => {
      const params = normalizeFilter(input, false);
      if (params.services.length === 0) {
        throw new UsageError("INVALID_ARGUMENT", "log export requires at least one service");
      }
      if (!params.since && !params.until) {
        throw new UsageError(
          "INVALID_ARGUMENT",
          "log export requires a since or until time boundary"
        );
      }
      const response = expectObject(
        await callService(ctx, CONTROL_PANEL$1, "system.logs.download", {
          ...params,
          mode: "filtered"
        }),
        "Control Panel log export response"
      );
      const downloaded = await downloadArtifact(
        ctx,
        CONTROL_PANEL$1,
        expectString(response.url, "log export url"),
        requiredInputString(input, "path"),
        dependencies.download
      );
      return downloaded;
    }
  };
}
function filterOptions(plural) {
  return [
    {
      name: plural ? "services" : "service",
      property: plural ? "services" : "service",
      description: plural ? "Comma-separated service IDs" : "Service ID",
      type: "string",
      required: true
    },
    {
      name: "file",
      description: "Exact filename in the service log directory",
      type: "string"
    },
    { name: "level", description: "Exact normalized log level", type: "string" },
    { name: "keyword", description: "Case-insensitive content filter", type: "string" },
    { name: "since", description: "RFC 3339 lower time boundary", type: "string" },
    { name: "until", description: "RFC 3339 upper time boundary", type: "string" }
  ];
}
function filterSchema(extra) {
  return {
    type: "object",
    properties: {
      service: { type: "string", minLength: 1 },
      services: {},
      file: { type: "string", minLength: 1 },
      level: { type: "string", minLength: 1 },
      keyword: { type: "string", minLength: 1 },
      since: { type: "string", minLength: 1 },
      until: { type: "string", minLength: 1 },
      ...extra
    },
    additionalProperties: false
  };
}
function normalizeFilter(input, withPage) {
  const services = splitServices(input.services ?? input.service);
  if (services.length === 0)
    throw new UsageError("INVALID_ARGUMENT", "service is required");
  const limit = input.limit === void 0 ? void 0 : Number(input.limit);
  if (limit !== void 0 && (!Number.isSafeInteger(limit) || limit < 1 || limit > 500)) {
    throw new UsageError("INVALID_ARGUMENT", "limit must be an integer between 1 and 500");
  }
  return compact$1({
    services,
    file: inputString(input, "file"),
    level: inputString(input, "level")?.toLowerCase(),
    keyword: inputString(input, "keyword"),
    since: normalizeLogTime(input, "since"),
    until: normalizeLogTime(input, "until"),
    direction: withPage ? inputString(input, "direction") ?? "forward" : void 0,
    cursor: withPage ? inputString(input, "cursor") : void 0,
    limit: withPage ? limit : void 0
  });
}
function normalizeLogTime(input, key) {
  const value = inputString(input, key);
  if (!value)
    return void 0;
  if (!Number.isFinite(Date.parse(value))) {
    throw new UsageError("INVALID_ARGUMENT", `${key} must be RFC 3339`);
  }
  return value;
}
function pageSchema$1() {
  return {
    type: "object",
    properties: { items: { type: "array", items: {} }, next_cursor: {} },
    required: ["items", "next_cursor"],
    additionalProperties: false
  };
}
function compact$1(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== void 0));
}
function invalidResponse$1(label) {
  throw new ToolError("INVALID_SERVICE_RESPONSE", `${label} is invalid`);
}
function timeoutError() {
  return new ToolError("TIMEOUT", "timed out following logs", EXIT_TIMEOUT, true);
}
function abortableSleep(milliseconds, signal) {
  if (signal.aborted)
    return Promise.reject(new ToolError("CANCELED", "operation canceled"));
  return new Promise((resolve2, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ToolError("CANCELED", "operation canceled"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve2();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
const TASK_MANAGER = "task-manager";
const CONTROL_PANEL = "control-panel";
const OBJECT_OUTPUT = { type: "object", additionalProperties: true };
function createTaskModule() {
  return {
    name: "task",
    summary: "Inspect, wait for, cancel, and retry durable Tasks",
    commands: [listCommand(), getCommand(), waitCommand(), cancelCommand(), retryCommand()]
  };
}
function listCommand() {
  return {
    verb: "list",
    summary: "List visible Tasks",
    options: [
      { name: "owner", description: "Creator user ID", type: "string" },
      { name: "type", description: "Task schema ID", type: "string" },
      { name: "state", description: "Task phase", type: "string" },
      { name: "since", description: "Created at or after this time", type: "string" },
      { name: "until", description: "Created at or before this time", type: "string" },
      { name: "cursor", description: "Opaque page cursor", type: "string" },
      { name: "limit", description: "Page size, at most 500", type: "integer" },
      {
        name: "include-archived",
        property: "include_archived",
        description: "Include archived Tasks",
        type: "boolean"
      }
    ],
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string", minLength: 1 },
        type: { type: "string", minLength: 1 },
        state: { type: "string", minLength: 1 },
        since: {},
        until: {},
        cursor: { type: "string", minLength: 1 },
        limit: { type: "integer", minimum: 1 },
        include_archived: { type: "boolean" }
      },
      additionalProperties: false
    },
    outputSchema: pageSchema(),
    resultSchemaVersion: 1,
    access: { mode: "fixed", level: "read" },
    asyncMode: "sync",
    requiresSession: true,
    examples: ["buckyos task list --state running --limit 50"],
    handler: async (ctx, input) => {
      const limit = normalizeLimit(input.limit);
      const response = expectObject(
        await callService(
          ctx,
          TASK_MANAGER,
          "list_tasks",
          compact({
            creator_user_id: inputString(input, "owner"),
            schema_id: inputString(input, "type"),
            phase: input.state === void 0 ? void 0 : normalizePhase(String(input.state)),
            created_after: parseTimestamp(input.since, "since"),
            created_before: parseTimestamp(input.until, "until"),
            cursor: inputString(input, "cursor"),
            limit,
            include_archived: input.include_archived === true
          })
        ),
        "TaskManager list_tasks response"
      );
      const items = response.tasks;
      if (!Array.isArray(items))
        invalidResponse("list_tasks.tasks");
      return { items, next_cursor: response.next_cursor ?? null };
    }
  };
}
function getCommand() {
  return {
    verb: "get",
    summary: "Get one Task snapshot and its direct children",
    positionals: [{ name: "task_id", description: "Opaque Task ID", required: true }],
    options: [
      {
        name: "children-cursor",
        property: "children_cursor",
        description: "Child page cursor",
        type: "string"
      },
      {
        name: "children-limit",
        property: "children_limit",
        description: "Child page size",
        type: "integer"
      }
    ],
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", minLength: 1 },
        children_cursor: { type: "string", minLength: 1 },
        children_limit: { type: "integer", minimum: 1 }
      },
      required: ["task_id"],
      additionalProperties: false
    },
    outputSchema: OBJECT_OUTPUT,
    resultSchemaVersion: 1,
    access: { mode: "fixed", level: "read" },
    asyncMode: "sync",
    requiresSession: true,
    examples: ["buckyos task get t-0123456789abcdef0123456789abcdef"],
    handler: async (ctx, input) => {
      const taskId = requiredInputString(input, "task_id");
      const [taskResponse, childrenResponse] = await Promise.all([
        callService(ctx, TASK_MANAGER, "get_task", { task_id: taskId }),
        callService(
          ctx,
          TASK_MANAGER,
          "get_subtasks",
          compact({
            task_id: taskId,
            cursor: inputString(input, "children_cursor"),
            limit: normalizeLimit(input.children_limit)
          })
        )
      ]);
      const taskEnvelope = expectObject(taskResponse, "TaskManager get_task response");
      const childrenEnvelope = expectObject(childrenResponse, "TaskManager get_subtasks response");
      if (!Array.isArray(childrenEnvelope.tasks))
        invalidResponse("get_subtasks.tasks");
      return {
        task: expectObject(taskEnvelope.task ?? taskEnvelope, "TaskManager task"),
        children: {
          items: childrenEnvelope.tasks,
          next_cursor: childrenEnvelope.next_cursor ?? null
        }
      };
    }
  };
}
function waitCommand() {
  return {
    verb: "wait",
    summary: "Stream changes until a Task becomes terminal",
    positionals: [{ name: "task_id", description: "Opaque Task ID", required: true }],
    inputSchema: taskIdSchema(),
    outputSchema: OBJECT_OUTPUT,
    resultSchemaVersion: 1,
    access: { mode: "fixed", level: "read" },
    asyncMode: "stream",
    requiresSession: true,
    examples: ["buckyos --timeout 10m task wait t-0123456789abcdef0123456789abcdef"],
    handler: async (ctx, input) => {
      const taskId = requiredInputString(input, "task_id");
      return await waitForTask(ctx, taskId, {
        failOnTaskFailure: false,
        onObservation: async (observation) => {
          await ctx.io.stdout(`${JSON.stringify({
            schema_version: 1,
            type: "task-progress",
            task_id: taskId,
            revision: observation.revision ?? null,
            phase: observation.phase,
            outcome: observation.outcome ?? null,
            progress: observation.progress ?? null,
            message: observation.message ?? null
          })}
`);
        }
      });
    }
  };
}
function cancelCommand() {
  return {
    verb: "cancel",
    summary: "Request Task cancellation",
    positionals: [{ name: "task_id", description: "Opaque Task ID", required: true }],
    options: [
      { name: "recursive", description: "Request cancellation for descendants", type: "boolean" },
      {
        name: "expected-revision",
        property: "expected_revision",
        description: "Optimistic revision fence",
        type: "integer"
      }
    ],
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", minLength: 1 },
        recursive: { type: "boolean" },
        expected_revision: { type: "integer", minimum: 0 }
      },
      required: ["task_id"],
      additionalProperties: false
    },
    outputSchema: OBJECT_OUTPUT,
    resultSchemaVersion: 1,
    access: { mode: "fixed", level: "write" },
    asyncMode: "sync",
    requiresSession: true,
    examples: ["buckyos task cancel t-0123456789abcdef0123456789abcdef --recursive"],
    handler: async (ctx, input) => {
      const taskId = requiredInputString(input, "task_id");
      return await callService(
        ctx,
        TASK_MANAGER,
        "request_control",
        compact({
          task_id: taskId,
          action: "Cancel",
          request_id: ctx.idempotencyKey ?? `ctl-${crypto.randomUUID().replaceAll("-", "")}`,
          recursive: input.recursive === true,
          expected_revision: input.expected_revision
        })
      );
    }
  };
}
function retryCommand() {
  return {
    verb: "retry",
    summary: "Create a new Task through the owning domain retry handler",
    positionals: [{ name: "task_id", description: "Failed terminal Task ID", required: true }],
    options: [{
      name: "no-wait",
      property: "no_wait",
      description: "Return after creation",
      type: "boolean"
    }],
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", minLength: 1 },
        no_wait: { type: "boolean" }
      },
      required: ["task_id"],
      additionalProperties: false
    },
    outputSchema: OBJECT_OUTPUT,
    resultSchemaVersion: 1,
    access: { mode: "fixed", level: "write" },
    asyncMode: "either",
    requiresSession: true,
    examples: ["buckyos --idempotency-key retry-42 task retry t-0123456789abcdef0123456789abcdef"],
    handler: async (ctx, input) => {
      const taskId = requiredInputString(input, "task_id");
      const oldEnvelope = expectObject(
        await callService(ctx, TASK_MANAGER, "get_task", { task_id: taskId }),
        "TaskManager get_task response"
      );
      const oldTask = expectObject(oldEnvelope.task ?? oldEnvelope, "TaskManager task");
      if (oldTask.phase !== "Terminal" || oldTask.outcome !== "Failed") {
        throw new UsageError("TASK_NOT_RETRYABLE", "only a terminal failed Task can be retried");
      }
      const response = expectObject(
        await callService(ctx, CONTROL_PANEL, "task.retry", {
          task_id: taskId,
          idempotency_key: ctx.idempotencyKey ?? `retry-${crypto.randomUUID()}`
        }),
        "Control Panel task.retry response"
      );
      const retryTaskId = expectString(response.task_id, "task.retry.task_id");
      if (retryTaskId === taskId || response.retry_of !== taskId) {
        invalidResponse("task.retry identity");
      }
      if (input.no_wait === true)
        return response;
      return await waitForTask(ctx, retryTaskId);
    }
  };
}
function taskIdSchema() {
  return {
    type: "object",
    properties: { task_id: { type: "string", minLength: 1 } },
    required: ["task_id"],
    additionalProperties: false
  };
}
function pageSchema() {
  return {
    type: "object",
    properties: {
      items: { type: "array", items: {} },
      next_cursor: {}
    },
    required: ["items", "next_cursor"],
    additionalProperties: false
  };
}
function normalizePhase(value) {
  const normalized = value.trim().toLowerCase();
  const phase = ["promised", "accepted", "running", "waiting", "paused", "terminal"].find((candidate) => candidate === normalized);
  if (!phase)
    throw new UsageError("INVALID_ARGUMENT", `unknown Task phase: ${value}`);
  return phase[0].toUpperCase() + phase.slice(1);
}
function normalizeLimit(value) {
  if (value === void 0)
    return void 0;
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 500) {
    throw new UsageError("INVALID_ARGUMENT", "limit must be an integer between 1 and 500");
  }
  return Number(value);
}
function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== void 0));
}
function invalidResponse(label) {
  throw new ToolError("INVALID_SERVICE_RESPONSE", `${label} is invalid`, EXIT_INTERNAL);
}
const VERSION = TOOL_VERSION;
class BuckyOSToolApplication {
  #environment;
  #cwd;
  #homeDir;
  #stdio;
  #createAuthentication;
  #runtime;
  #createClients;
  #confirmDeviceIdentity;
  #repl;
  constructor(dependencies = {}) {
    this.registry = createRegistry(
      dependencies.pikg,
      dependencies.app,
      dependencies.log,
      dependencies.diagnostic
    );
    this.#environment = dependencies.environment ?? readEnvironment();
    this.#cwd = dependencies.cwd ?? getHost().cwd();
    this.#homeDir = dependencies.homeDir;
    this.#stdio = dependencies.stdio ?? defaultStdio();
    this.#createAuthentication = dependencies.createAuthentication ?? ((config) => new AuthenticationSession(config, this.#environment));
    this.#runtime = dependencies.runtime ?? new BuckyOSRuntimeAdapter();
    this.#createClients = dependencies.createClients ?? ((config, authentication) => new BuckyOSServiceClientRegistry(config, authentication));
    this.#confirmDeviceIdentity = dependencies.confirmDeviceIdentity ?? confirmDeviceIdentity;
    this.#repl = dependencies.repl ?? runRepl;
  }
  async run(argv) {
    let fallbackTraceId = crypto.randomUUID();
    try {
      const invocation = parseInvocation(argv);
      fallbackTraceId = invocation.global.traceId ?? fallbackTraceId;
      if (invocation.global.version) {
        if (invocation.module) {
          throw new UsageError("ARGUMENT_CONFLICT", "--version cannot be combined with a command");
        }
        if (invocation.global.verbose) {
          const distributionManifest = await readDistributionManifest();
          let identityCandidates;
          try {
            const setup2 = await resolveConfig(invocation.global, this.#environment, {
              cwd: this.#cwd,
              homeDir: this.#homeDir
            });
            setup2.resolved = await applyImplicitDeviceIdentity(
              setup2.resolved,
              this.#environment
            );
            identityCandidates = await identityCandidateView(
              setup2.resolved,
              this.#environment
            );
          } catch (error) {
            const normalized = normalizeError(error);
            identityCandidates = { mode: "unavailable", error: normalized.code };
          }
          await this.#stdio.stdout(`${JSON.stringify(
            {
              buckyos: distributionManifest?.buckyos_version ?? null,
              buckyos_build_id: distributionManifest?.build_id ?? null,
              tool_version: TOOL_VERSION,
              sdk_version: SDK_VERSION,
              protocol_version: PROTOCOL_VERSION,
              target_zone: invocation.global.zone ?? getHost().env("BUCKYOS_TOOL_ZONE") ?? null,
              compatibility: "not-checked",
              ...policyView(getHost()),
              identity_candidates: identityCandidates,
              distribution_manifest: distributionManifestView(distributionManifest)
            },
            null,
            2
          )}
`);
        } else {
          await this.#stdio.stdout(`buckyos ${VERSION}
`);
        }
        return EXIT_SUCCESS;
      }
      if (invocation.global.cli) {
        return await this.#runInteractive(invocation.global, invocation.module, invocation.verb);
      }
      if (!invocation.module) {
        if (invocation.global.help) {
          await this.#stdio.stdout(`${topLevelHelp(this.registry)}
`);
          return EXIT_SUCCESS;
        }
        throw new UsageError("COMMAND_REQUIRED", "a module and verb are required");
      }
      if (!invocation.verb || invocation.verb === "--help" || invocation.verb === "-h") {
        await this.#stdio.stdout(`${moduleHelp(this.registry, invocation.module)}
`);
        return EXIT_SUCCESS;
      }
      const command = this.registry.get(invocation.module, invocation.verb);
      if (invocation.global.help || invocation.actionArgv.includes("--help") || invocation.actionArgv.includes("-h")) {
        await this.#stdio.stdout(`${commandHelp(this.registry, command)}
`);
        return EXIT_SUCCESS;
      }
      const setup = await this.#resolveForCommand(command, invocation.global);
      const inputObject = invocation.global.input ? await this.#readInputObject(invocation.global.input) : void 0;
      const parsed = parseCommandArgs(command, invocation.actionArgv, inputObject);
      if (setup.resolved.output === "raw" && !command.supportsRawOutput) {
        throw new UsageError(
          "RAW_OUTPUT_UNSUPPORTED",
          `${command.module} ${command.verb} does not support raw output`
        );
      }
      const session = command.requiresSession ? await this.#createSession(setup.resolved) : void 0;
      return await this.#executeAndEmit(
        command,
        parsed.input,
        setup.resolved,
        setup.store,
        session,
        false,
        new AbortController().signal
      );
    } catch (error) {
      const normalized = normalizeError(error);
      const envelope = errorEnvelope(normalized, { command: "core", trace_id: fallbackTraceId });
      await this.#stdio.stdout(`${renderError(envelope, "json")}
`);
      return normalized.exitCode;
    }
  }
  async #runInteractive(global, module, verb) {
    if (module || verb) {
      throw new UsageError("ARGUMENT_CONFLICT", "--cli cannot be combined with a module or verb");
    }
    if (global.nonInteractive) {
      throw new UsageError("ARGUMENT_CONFLICT", "--cli conflicts with --non-interactive");
    }
    for (const [name, value] of [
      ["input", global.input],
      ["timeout", global.timeout],
      ["trace-id", global.traceId],
      ["idempotency-key", global.idempotencyKey],
      ["wait", global.wait],
      ["yes", global.yes]
    ]) {
      if (value !== void 0) {
        throw new UsageError(
          "ARGUMENT_CONFLICT",
          `--${name} is command-scoped and cannot be set when entering --cli`
        );
      }
    }
    const setup = await resolveConfig(global, this.#environment, {
      interactive: true,
      cwd: this.#cwd,
      homeDir: this.#homeDir
    });
    setup.resolved = await applyImplicitDeviceIdentity(setup.resolved, this.#environment);
    const session = await this.#createSession(setup.resolved);
    await this.#repl({
      registry: this.registry,
      config: setup.resolved,
      configStore: setup.store,
      session,
      execute: async (tokens, signal) => await this.#executeInteractiveLine(tokens, signal, setup.resolved, setup.store, session)
    });
    return EXIT_SUCCESS;
  }
  async #executeInteractiveLine(tokens, signal, frozen, store, session) {
    if (tokens.length < 2)
      throw new UsageError("COMMAND_REQUIRED", "enter <module> <verb>");
    const command = this.registry.get(tokens[0], tokens[1]);
    const actionArgv = tokens.slice(2);
    if (actionArgv.includes("--help") || actionArgv.includes("-h")) {
      await this.#stdio.stdout(`${commandHelp(this.registry, command)}
`);
      return;
    }
    const preliminary = parseCommandArgs(command, actionArgv, void 0, true, true);
    if (preliminary.scoped.input === "-") {
      throw new UsageError("STDIN_UNAVAILABLE", "--input - is not available inside --cli");
    }
    const inputObject = preliminary.scoped.input ? await this.#readInputObject(preliminary.scoped.input) : void 0;
    const parsed = parseCommandArgs(command, actionArgv, inputObject, true);
    const config = {
      ...frozen,
      output: parsed.scoped.output ?? frozen.output,
      timeoutMs: parsed.scoped.timeout ? parseDuration(parsed.scoped.timeout) : frozen.timeoutMs,
      traceId: parsed.scoped.traceId,
      idempotencyKey: parsed.scoped.idempotencyKey,
      wait: parsed.scoped.wait ?? false,
      yes: parsed.scoped.yes ?? false
    };
    if (config.output === "raw" && !command.supportsRawOutput) {
      throw new UsageError(
        "RAW_OUTPUT_UNSUPPORTED",
        `${command.module} ${command.verb} does not support raw output`
      );
    }
    await this.#executeAndEmit(command, parsed.input, config, store, session, true, signal);
  }
  async #executeAndEmit(command, input, config, store, session, interactive, signal) {
    const traceId = config.traceId ?? crypto.randomUUID();
    const startedAt = Date.now();
    try {
      if (command.requiresSession && !session) {
        throw new ToolError("AUTH_REQUIRED", "authenticated session is required", 3);
      }
      if (command.requiresSession)
        await session.authentication.ensureValid();
      const principal = session?.authentication.current().principal ?? {
        id: "local",
        appId: "buckyos-tool",
        authentication: "mock"
      };
      const context = {
        command: { module: command.module, verb: command.verb },
        definition: command,
        connection: session?.connection ?? {
          zone: config.zone ?? "local",
          endpoint: config.endpoint ?? "local://",
          defaultProtocol: config.defaultProtocol
        },
        principal,
        clients: session?.clients ?? unavailableClients,
        output: { format: config.output },
        traceId,
        idempotencyKey: config.idempotencyKey,
        deadline: Date.now() + config.timeoutMs,
        signal,
        cwd: this.#cwd,
        io: {
          stdout: (value) => this.#stdio.stdout(value),
          stderr: (value) => this.#stdio.stderr(value),
          prompt: (message) => this.#stdio.prompt?.(message) ?? Promise.resolve(null),
          inputIsTerminal: this.#stdio.inputIsTerminal?.() ?? false
        },
        interactive,
        confirmed: config.yes,
        config,
        configStore: store,
        session: session?.authentication
      };
      const data = await command.handler(context, input);
      try {
        validateSchema(data, command.outputSchema, "output");
      } catch (error) {
        throw new ToolError(
          "INVALID_HANDLER_OUTPUT",
          error instanceof Error ? error.message : String(error),
          9
        );
      }
      const envelope = successEnvelope(data, {
        command: `${command.module}.${command.verb}`,
        trace_id: traceId,
        duration_ms: Date.now() - startedAt
      });
      await this.#stdio.stdout(
        `${renderSuccess(envelope, config.output)}${config.output === "raw" ? "" : "\n"}`
      );
      return EXIT_SUCCESS;
    } catch (error) {
      const normalized = normalizeError(error);
      const envelope = errorEnvelope(normalized, {
        command: `${command.module}.${command.verb}`,
        trace_id: traceId,
        duration_ms: Date.now() - startedAt
      });
      await this.#stdio.stdout(`${renderError(envelope, config.output)}
`);
      if (config.verbose)
        await this.#stdio.stderr(`diagnostic: ${normalized.code}
`);
      return normalized.exitCode;
    }
  }
  async #resolveForCommand(command, global) {
    if (command.requiresSession || command.module === "config" && command.verb === "check") {
      const setup = await resolveConfig(global, this.#environment, {
        cwd: this.#cwd,
        homeDir: this.#homeDir
      });
      if (command.requiresSession) {
        setup.resolved = await applyImplicitDeviceIdentity(setup.resolved, this.#environment);
      }
      return setup;
    }
    return localResolvedConfig(global, this.#environment, {
      cwd: this.#cwd,
      homeDir: this.#homeDir
    });
  }
  async #createSession(config) {
    await this.#approveImplicitDeviceIdentity(config);
    const authentication = this.#createAuthentication(config);
    return await InteractiveSession.create(
      config,
      authentication,
      this.#runtime,
      this.#createClients(config, authentication)
    );
  }
  async #approveImplicitDeviceIdentity(config) {
    const identity = config.implicitDeviceIdentity;
    if (!identity || config.yes)
      return;
    if (config.nonInteractive) {
      throw new ToolError(
        "CONFIRMATION_REQUIRED",
        "using the current device identity requires --yes in non-interactive mode",
        EXIT_PERMISSION,
        false,
        { identity: identity.did }
      );
    }
    if (!await this.#confirmDeviceIdentity(identity)) {
      throw new ToolError(
        "CONFIRMATION_DECLINED",
        "current device identity confirmation was declined",
        EXIT_PERMISSION,
        false,
        { identity: identity.did }
      );
    }
  }
  async #readInputObject(path) {
    let raw;
    try {
      raw = path === "-" ? await this.#stdio.readStdin() : await getHost().readTextFile(path);
    } catch (error) {
      throw new UsageError(
        "INPUT_READ_FAILED",
        `failed to read input: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new UsageError("INVALID_INPUT_JSON", "input is not valid JSON");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new UsageError("INVALID_INPUT_JSON", "input JSON must be an object");
    }
    return parsed;
  }
}
function createRegistry(pikgDependencies, appDependencies, logDependencies, diagnosticDependencies) {
  const registry = new CommandRegistry();
  for (const module of createCoreModules(registry))
    registry.register(module);
  registry.register(createAuthModule());
  registry.register(createPikgModule(pikgDependencies));
  registry.register(createSystemModule());
  registry.register(createSystemConfigModule());
  registry.register(createAppModule(appDependencies));
  registry.register(createTaskModule());
  registry.register(createLogModule(logDependencies));
  registry.register(createDiagnosticModule(diagnosticDependencies));
  return registry;
}
const unavailableClients = {
  call: () => Promise.reject(new ToolError("INTERNAL_ERROR", "service clients are unavailable", 9))
};
function topLevelHelp(registry) {
  return [
    `BuckyOS Tool ${VERSION}`,
    "",
    "Usage:",
    "  buckyos [global-options] <module> <verb> [primary-selector] [action-options]",
    "  buckyos [session-options] --cli",
    "",
    "Modules:",
    ...registry.modules().map((module) => `  ${module.name.padEnd(12)} ${module.summary}`),
    "",
    "Global options:",
    "  --config-dir <path>  --profile <name>  --zone <host-or-did>",
    "  --allow-read <path>  Add a readable filesystem root (repeatable)",
    "  --endpoint <url>      --identity <did-or-name>",
    "  --session-token <token> | --session-token-file <path>",
    "    Prefer --session-token-file for automation; argv tokens may appear in process listings.",
    "  --output <json|jsonl|table|text|raw>  --input <path|->",
    "  --timeout <duration>  --trace-id <id>  --non-interactive  --yes",
    "  --cli  --help  --version",
    "",
    "Use `buckyos command describe <module> <verb>` for machine-readable schemas."
  ].join("\n");
}
function moduleHelp(registry, moduleName) {
  const module = registry.modules().find((candidate) => candidate.name === moduleName);
  if (!module)
    throw new UsageError("UNKNOWN_MODULE", `unknown module: ${moduleName}`);
  return [
    `${module.name}: ${module.summary}`,
    "",
    "Commands:",
    ...module.commands.map((command) => `  ${command.verb.padEnd(18)} ${command.summary}`)
  ].join("\n");
}
function commandHelp(registry, command) {
  return [
    command.summary,
    "",
    `Usage: ${registry.syntax(command)}`,
    ...command.description ? ["", command.description] : [],
    ...(command.positionals?.length ?? 0) > 0 ? [
      "",
      "Arguments:",
      ...command.positionals.map(
        (position) => `  ${position.name.padEnd(20)} ${position.description}`
      )
    ] : [],
    ...(command.options?.length ?? 0) > 0 ? [
      "",
      "Options:",
      ...command.options.map((option) => `  --${option.name.padEnd(18)} ${option.description}`)
    ] : [],
    ...(command.examples?.length ?? 0) > 0 ? ["", "Examples:", ...command.examples.map((example) => `  ${example}`)] : []
  ].join("\n");
}
function defaultStdio() {
  return {
    stdout: async (value) => await getHost().stdout(value),
    stderr: async (value) => await getHost().stderr(value),
    readStdin: async () => await getHost().readStdin(),
    prompt: async (message) => await getHost().readLine(message),
    inputIsTerminal: () => getHost().inputIsTerminal()
  };
}
async function confirmDeviceIdentity(identity) {
  if (!getHost().inputIsTerminal()) {
    throw new ToolError(
      "CONFIRMATION_REQUIRED",
      "using the current device identity requires an interactive terminal or --yes",
      EXIT_PERMISSION,
      false,
      { identity: identity.did }
    );
  }
  const prompt = `Use current device identity ${identity.name} (${identity.did})? This identity may have broad privileges. Continue? [y/N] `;
  const answer = (await getHost().readLine(prompt))?.trim() ?? "";
  return answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
}
async function runCli(host2, argv) {
  installHost(host2);
  return await new BuckyOSToolApplication().run(argv);
}
class NodeHost {
  constructor(policy2) {
    this.kind = "node";
    this.runtimeName = "node";
    this.runtimeVersion = process.versions.node;
    this.platform = normalizePlatform(process.platform);
    this.arch = normalizeArch(process.arch);
    this.pid = process.pid;
    this.executable = process.argv[1] ? nodePath.resolve(process.argv[1]) : process.execPath;
    this.runtimeExecutable = process.execPath;
    this.path = nodePath;
    this.policy = policy2;
  }
  cwd() {
    return process.cwd();
  }
  homeDir() {
    return process.env.HOME ?? process.env.USERPROFILE ?? process.cwd();
  }
  env(name) {
    if (!this.policy.environment.includes(name)) {
      throw new HostError("PermissionDenied", `environment access is not allowed: ${name}`);
    }
    return process.env[name];
  }
  exit(code) {
    process.exit(code);
  }
  setExitCode(code) {
    process.exitCode = code;
  }
  async readTextFile(path) {
    await this.assertPath(path, "read");
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      throw translateNodeError(error, path);
    }
  }
  async readFile(path) {
    await this.assertPath(path, "read");
    try {
      return new Uint8Array(await readFile(path));
    } catch (error) {
      throw translateNodeError(error, path);
    }
  }
  async writeTextFile(path, value, options = {}) {
    await this.assertPath(path, "write");
    try {
      await writeFile(path, value, {
        flag: options.createNew ? "wx" : "w",
        mode: options.mode
      });
    } catch (error) {
      throw translateNodeError(error, path);
    }
  }
  async writeFile(path, value, options = {}) {
    await this.assertPath(path, "write");
    try {
      await writeFile(path, value, {
        flag: options.createNew ? "wx" : "w",
        mode: options.mode
      });
    } catch (error) {
      throw translateNodeError(error, path);
    }
  }
  async readDir(path) {
    await this.assertPath(path, "read");
    try {
      return (await readdir(path, { withFileTypes: true })).map((entry) => ({
        name: entry.name,
        isFile: entry.isFile(),
        isDirectory: entry.isDirectory(),
        isSymlink: entry.isSymbolicLink()
      }));
    } catch (error) {
      throw translateNodeError(error, path);
    }
  }
  async stat(path) {
    await this.assertPath(path, "read");
    try {
      return fileInfo(await stat(path));
    } catch (error) {
      throw translateNodeError(error, path);
    }
  }
  async lstat(path) {
    await this.assertPath(path, "read", false);
    try {
      return fileInfo(await lstat(path));
    } catch (error) {
      throw translateNodeError(error, path);
    }
  }
  async realPath(path) {
    await this.assertPath(path, "read");
    try {
      return await realpath(path);
    } catch (error) {
      throw translateNodeError(error, path);
    }
  }
  async makeTempDir(options = {}) {
    const directory = options.dir ?? tmpdir();
    await this.assertPath(directory, "write");
    try {
      return await mkdtemp(nodePath.join(directory, options.prefix ?? "buckyos-"));
    } catch (error) {
      throw translateNodeError(error, directory);
    }
  }
  async makeTempFile(options = {}) {
    const directory = await this.makeTempDir({ dir: options.dir, prefix: options.prefix });
    const path = nodePath.join(directory, "file");
    await this.writeFile(path, new Uint8Array(), { createNew: true, mode: 384 });
    return path;
  }
  async rename(from, to) {
    await this.assertPath(from, "write");
    await this.assertPath(to, "write");
    try {
      await rename(from, to);
    } catch (error) {
      throw translateNodeError(error, `${from} -> ${to}`);
    }
  }
  async remove(path, options = {}) {
    await this.assertPath(path, "write", false);
    try {
      await rm(path, { recursive: options.recursive ?? false });
    } catch (error) {
      throw translateNodeError(error, path);
    }
  }
  async mkdir(path, options = {}) {
    await this.assertPath(path, "write", false);
    try {
      await mkdir(path, { recursive: options.recursive, mode: options.mode });
    } catch (error) {
      throw translateNodeError(error, path);
    }
  }
  async chmod(path, mode) {
    await this.assertPath(path, "write");
    try {
      await chmod(path, mode);
    } catch (error) {
      throw translateNodeError(error, path);
    }
  }
  async symlink(target, path) {
    await this.assertPath(target, "read");
    await this.assertPath(path, "write", false);
    try {
      await symlink(target, path);
    } catch (error) {
      throw translateNodeError(error, path);
    }
  }
  async copyFile(from, to) {
    await this.assertPath(from, "read");
    await this.assertPath(to, "write", false);
    try {
      await copyFile(from, to);
    } catch (error) {
      throw translateNodeError(error, `${from} -> ${to}`);
    }
  }
  async open(path, options) {
    await this.assertPath(path, options.write ? "write" : "read", !options.createNew);
    const flags = options.read && options.write ? "r+" : options.write ? options.createNew ? "wx" : "w" : "r";
    try {
      return new NodeHostFile(await open(path, flags, options.mode));
    } catch (error) {
      throw translateNodeError(error, path);
    }
  }
  createHash(_algorithm) {
    const hash = createHash("sha256");
    return {
      update(bytes) {
        hash.update(bytes);
      },
      digestHex() {
        return hash.digest("hex");
      }
    };
  }
  async gzipFile(source, destination) {
    await this.assertPath(source, "read");
    await this.assertPath(destination, "write", false);
    try {
      await pipeline(
        Readable.from(fixedChunks(createReadStream(source))),
        createGzip({ level: 6, strategy: constants.Z_RLE }),
        createWriteStream(destination, { flags: "wx", mode: 384 })
      );
    } catch (error) {
      throw translateNodeError(error, destination);
    }
  }
  async run(command, args) {
    this.assertCommand(command);
    return await capture(command, args);
  }
  async runGzip(command, args, destination) {
    this.assertCommand(command);
    await this.assertPath(destination, "write", false);
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], shell: false });
    const stderr = [];
    child.stderr.on("data", (chunk) => stderr.push(new Uint8Array(chunk)));
    try {
      await pipeline(
        Readable.from(fixedChunks(child.stdout)),
        createGzip({ level: 6, strategy: constants.Z_RLE }),
        createWriteStream(destination, { flags: "wx", mode: 384 })
      );
      const code = await childStatus(child);
      return { success: code === 0, code, stdout: new Uint8Array(), stderr: concat(stderr) };
    } catch (error) {
      child.kill();
      throw translateNodeError(error, destination);
    }
  }
  async stdout(value) {
    await writeStream(process.stdout, value);
  }
  async stderr(value) {
    await writeStream(process.stderr, value);
  }
  async readStdin() {
    const chunks = [];
    for await (const chunk of process.stdin)
      chunks.push(new Uint8Array(chunk));
    return new TextDecoder().decode(concat(chunks));
  }
  async readLine(prompt) {
    const reader = createInterface({ input: process.stdin, output: process.stderr });
    try {
      return await reader.question(prompt);
    } catch {
      return null;
    } finally {
      reader.close();
    }
  }
  async readSecret(prompt) {
    if (!this.inputIsTerminal() || typeof process.stdin.setRawMode !== "function") {
      throw new HostError("PermissionDenied", "secret input requires a terminal");
    }
    await this.stderr(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const bytes = [];
    try {
      while (true) {
        const chunk = await readInputChunk();
        if (chunk === null)
          break;
        const byte = chunk[0];
        if (byte === 10 || byte === 13)
          break;
        if (byte === 3)
          throw new HostError("PermissionDenied", "secret input canceled");
        if (byte === 8 || byte === 127)
          bytes.pop();
        else
          bytes.push(byte);
      }
    } finally {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      await this.stderr("\n");
    }
    return new TextDecoder().decode(Uint8Array.from(bytes));
  }
  inputIsTerminal() {
    return Boolean(process.stdin.isTTY);
  }
  createLineReader(options) {
    const reader = createInterface({
      input: process.stdin,
      output: process.stderr,
      terminal: true,
      history: options.history,
      historySize: options.historySize,
      completer: options.completer
    });
    reader.on("SIGINT", options.onSigint);
    return {
      [Symbol.asyncIterator]: () => reader[Symbol.asyncIterator](),
      write: (value) => process.stderr.write(value),
      setPrompt: (value) => reader.setPrompt(value),
      prompt: () => reader.prompt(),
      close: () => reader.close()
    };
  }
  assertCommand(command) {
    if (!this.policy.subprocesses.includes(command)) {
      throw new HostError("PermissionDenied", `subprocess is not allowed: ${command}`);
    }
  }
  async assertPath(candidate, operation, resolveLinks = true) {
    const roots = operation === "read" ? this.policy.readPaths : this.policy.writePaths;
    const absolute = nodePath.resolve(candidate);
    if (!insideAny(absolute, roots)) {
      throw new HostError(
        "PermissionDenied",
        `${operation} access is outside ${this.policy.name}: ${absolute}`,
        absolute
      );
    }
    if (!resolveLinks)
      return;
    try {
      const physical = await realpath(absolute);
      if (!insideAny(physical, roots)) {
        throw new HostError(
          "PermissionDenied",
          `${operation} access escapes ${this.policy.name}: ${absolute}`,
          absolute
        );
      }
    } catch (error) {
      if (error.code !== "ENOENT")
        throw error;
    }
  }
}
async function* fixedChunks(source) {
  const size = 64 * 1024;
  let pending = new Uint8Array(size);
  let used = 0;
  for await (const chunk of source) {
    let offset = 0;
    while (offset < chunk.byteLength) {
      const copied = Math.min(size - used, chunk.byteLength - offset);
      pending.set(chunk.subarray(offset, offset + copied), used);
      used += copied;
      offset += copied;
      if (used === size) {
        yield pending;
        pending = new Uint8Array(size);
        used = 0;
      }
    }
  }
  if (used > 0)
    yield pending.slice(0, used);
}
class NodeHostFile {
  constructor(handle) {
    this.#position = 0;
    this.handle = handle;
  }
  #position;
  async read(buffer) {
    const result = await this.handle.read(buffer, 0, buffer.length, this.#position);
    if (result.bytesRead === 0)
      return null;
    this.#position += result.bytesRead;
    return result.bytesRead;
  }
  async write(buffer) {
    const result = await this.handle.write(buffer, 0, buffer.length, this.#position);
    this.#position += result.bytesWritten;
    return result.bytesWritten;
  }
  seek(offset) {
    this.#position = offset;
    return Promise.resolve(offset);
  }
  async stat() {
    return fileInfo(await this.handle.stat());
  }
  async sync() {
    await this.handle.sync();
  }
  close() {
    return this.handle.close();
  }
}
function fileInfo(value) {
  return {
    isFile: value.isFile(),
    isDirectory: value.isDirectory(),
    isSymlink: value.isSymbolicLink(),
    size: value.size,
    mode: value.mode ?? null,
    mtime: value.mtime ?? null,
    dev: value.dev ?? null,
    ino: value.ino ?? null
  };
}
function insideAny(candidate, roots) {
  return roots.some((root) => {
    const relative2 = nodePath.relative(nodePath.resolve(root), candidate);
    return relative2 === "" || relative2 !== ".." && !relative2.startsWith(`..${nodePath.sep}`) && !nodePath.isAbsolute(relative2);
  });
}
async function capture(command, args) {
  return await new Promise((resolve2, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], shell: false });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(new Uint8Array(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(new Uint8Array(chunk)));
    child.once("error", reject);
    child.once("close", (code) => resolve2({
      success: code === 0,
      code: code ?? 1,
      stdout: concat(stdout),
      stderr: concat(stderr)
    }));
  });
}
async function childStatus(child) {
  if (child.exitCode !== null)
    return child.exitCode;
  return await new Promise((resolve2, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve2(code ?? 1));
  });
}
function concat(chunks) {
  const output = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}
async function writeStream(stream, value) {
  await new Promise((resolve2, reject) => {
    stream.write(value, (error) => error ? reject(error) : resolve2());
  });
}
async function readInputChunk() {
  return await new Promise((resolve2, reject) => {
    const onData = (chunk) => done(new Uint8Array(chunk));
    const onEnd = () => done(null);
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
      process.stdin.off("error", onError);
    };
    const done = (value) => {
      cleanup();
      resolve2(value);
    };
    process.stdin.once("data", onData);
    process.stdin.once("end", onEnd);
    process.stdin.once("error", onError);
  });
}
function translateNodeError(error, path) {
  if (error instanceof HostError)
    return error;
  const code = error.code;
  const kind = code === "ENOENT" ? "NotFound" : code === "EACCES" || code === "EPERM" ? "PermissionDenied" : code === "EEXIST" ? "AlreadyExists" : code === "EINVAL" ? "InvalidInput" : "Unknown";
  return new HostError(kind, error instanceof Error ? error.message : String(error), path, error);
}
function normalizePlatform(value) {
  return value === "win32" ? "windows" : value === "darwin" ? "macos" : value;
}
function normalizeArch(value) {
  return value === "x64" ? "x86_64" : value === "arm64" ? "aarch64" : value;
}
const packageRoot = resolve$5(dirname$3(fileURLToPath(import.meta.url)), "../..");
const environment = Object.fromEntries(
  TOOL_ENVIRONMENT_NAMES.map((name) => [name, process.env[name]])
);
const policy = buildDistributionPolicy({
  distribution: "developer",
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  packageRoot,
  homeDir: process.env.HOME ?? process.env.USERPROFILE ?? process.cwd(),
  environment,
  path: await import("node:path")
});
const host = new NodeHost(policy);
installHost(host);
host.setExitCode(await runCli(host, process.argv.slice(2)));
//# sourceMappingURL=cli.mjs.map
