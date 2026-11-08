import { a as RPC_HTTP_ERROR_CODE, b as RPC_TRANSPORT_ERROR_CODE } from "./krpc_client-673448e5.mjs";
class LLMComputeException extends Error {
  constructor(error) {
    super(computeErrorMessage(error));
    this.name = "LLMComputeException";
    this.error = error;
  }
}
function providerError(failure, message) {
  return new LLMComputeException({ kind: "provider", failure, message });
}
function asComputeError(error) {
  if (error instanceof LLMComputeException)
    return error.error;
  const message = error instanceof Error ? error.message : String(error);
  return { kind: "provider", failure: "unknown", message };
}
function failureDebug(failure) {
  if (typeof failure === "object")
    return `Refused { code: ${JSON.stringify(failure.refused.code)} }`;
  return { transient: "Transient", permanent: "Permanent", unknown: "Unknown", context_limit: "ContextLimit" }[failure];
}
function stageDebug(stage) {
  return { before_inference: "BeforeInference", before_tool_call: "BeforeToolCall", outcome_boundary: "OutcomeBoundary" }[stage];
}
function computeErrorMessage(e) {
  switch (e.kind) {
    case "timeout":
      return "llm timeout";
    case "cancelled":
      return "llm cancelled";
    case "provider":
      return `llm provider failed (${failureDebug(e.failure)}): ${e.message}`;
    case "output_parse":
      return `llm output parse failed: ${e.message}`;
    case "policy_rejected":
      return `policy rejected: ${e.message}`;
    case "tool_failed":
      return `tool \`${e.tool}\` failed: ${e.message}`;
    case "tool_runtime":
      return `tool \`${e.tool}\` dispatch failed (effect_unknown=${e.effect_unknown}): ${e.message}`;
    case "checkpoint":
      return `checkpoint ${stageDebug(e.stage)} failed: ${e.message}`;
    case "snapshot_corrupted":
      return `snapshot corrupted: ${e.message}`;
    case "internal":
      return `internal: ${e.message}`;
  }
}
function errorSource(e) {
  switch (e.kind) {
    case "timeout":
    case "cancelled":
    case "provider":
      return "provider";
    case "output_parse":
      return "llm_output";
    case "policy_rejected":
    case "tool_failed":
      return "tool";
    case "tool_runtime":
    case "checkpoint":
      return "runtime";
    case "snapshot_corrupted":
      return "snapshot";
    case "internal":
      return "internal";
  }
}
function llmCorrectable(e) {
  return e.kind === "output_parse" || e.kind === "policy_rejected" || e.kind === "tool_failed";
}
function infraRetrySafe(e) {
  switch (e.kind) {
    case "timeout":
    case "checkpoint":
      return true;
    case "provider":
      return e.failure === "transient";
    case "tool_runtime":
      return !e.effect_unknown;
    default:
      return false;
  }
}
function refusedCode(failure) {
  return typeof failure === "object" ? failure.refused.code : void 0;
}
function xllmErrorMessage(d) {
  switch (d.kind) {
    case "config":
      return `config error: ${d.file}: ${d.field}: ${d.reason}`;
    case "input":
      return `input error: ${d.message}`;
    case "capability":
      return `capability error: ${d.message}`;
    case "runtime_mismatch":
      return `runtime mismatch: ${d.message}`;
    case "recovery_blocked":
      return `RecoveryBlocked: ${d.message}`;
    case "tools":
      return `tools error: ${d.message}`;
    case "template":
      return `template error in ${d.origin}: ${d.reason}`;
    case "run_not_found":
      return `run \`${d.run_id}\` not found under ${d.runs_dir}`;
    case "run_busy":
      return `run \`${d.run_id}\` is being executed by another process`;
    case "workdir_busy":
      return `working directory ${d.workdir} already has a tool-enabled run \`${d.run_id}\` executing; wait for it or use another directory`;
    case "run_terminal":
      return `run \`${d.run_id}\` is terminal (${d.status}); ${d.hint}`;
    case "not_resumable":
      return `run \`${d.run_id}\` cannot be resumed: ${d.reason}`;
    case "corrupted_run":
      return `run \`${d.run_id}\` record is corrupted: ${d.reason}`;
    case "storage":
      return `storage error: ${d.message}`;
    case "extract":
      return `result extraction failed: ${d.message}`;
    case "compressor":
      return `context compaction failed: ${d.message}`;
    case "other":
      return d.message;
  }
}
class XllmError extends Error {
  constructor(detail) {
    super(xllmErrorMessage(detail));
    this.name = "XllmError";
    this.detail = detail;
  }
  get kind() {
    return this.detail.kind;
  }
  static config(file, field, reason) {
    return new XllmError({ kind: "config", file, field, reason });
  }
  static input(message) {
    return new XllmError({ kind: "input", message });
  }
  static capability(message) {
    return new XllmError({ kind: "capability", message });
  }
  static runtimeMismatch(message) {
    return new XllmError({ kind: "runtime_mismatch", message });
  }
  static tools(message) {
    return new XllmError({ kind: "tools", message });
  }
  static template(origin, reason) {
    return new XllmError({ kind: "template", origin, reason });
  }
  static notResumable(runId, reason) {
    return new XllmError({ kind: "not_resumable", run_id: runId, reason });
  }
  static storage(message) {
    return new XllmError({ kind: "storage", message });
  }
  static other(message) {
    return new XllmError({ kind: "other", message });
  }
}
function isRustWhitespace(c) {
  return c >= 9 && c <= 13 || c === 32 || c === 133 || c === 160 || c === 5760 || c >= 8192 && c <= 8202 || c === 8232 || c === 8233 || c === 8239 || c === 8287 || c === 12288;
}
function rustTrimStart(s) {
  let i = 0;
  while (i < s.length && isRustWhitespace(s.charCodeAt(i)))
    i++;
  return i === 0 ? s : s.slice(i);
}
function rustTrimEnd(s) {
  let j = s.length;
  while (j > 0 && isRustWhitespace(s.charCodeAt(j - 1)))
    j--;
  return j === s.length ? s : s.slice(0, j);
}
function rustTrim(s) {
  return rustTrimStart(rustTrimEnd(s));
}
function collapseWhitespace(s) {
  const words = [];
  let start = -1;
  for (let i = 0; i < s.length; i++) {
    if (isRustWhitespace(s.charCodeAt(i))) {
      if (start >= 0)
        words.push(s.slice(start, i));
      start = -1;
    } else if (start < 0) {
      start = i;
    }
  }
  if (start >= 0)
    words.push(s.slice(start));
  return words.join(" ");
}
function isPairAt(s, i) {
  const c = s.charCodeAt(i);
  return c >= 55296 && c <= 56319 && i + 1 < s.length && (s.charCodeAt(i + 1) & 64512) === 56320;
}
function charOffset(s, n) {
  let i = 0;
  for (let k = 0; k < n && i < s.length; k++)
    i += isPairAt(s, i) ? 2 : 1;
  return i;
}
function charCount(s) {
  let n = 0;
  for (let i = 0; i < s.length; i += isPairAt(s, i) ? 2 : 1)
    n++;
  return n;
}
function rustTextContent(message) {
  let out = "";
  for (const b of message.content) {
    if (b.type !== "text")
      continue;
    if (out !== "")
      out += "\n";
    out += b.text;
  }
  return out;
}
function compareCodePoints(a, b) {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const x = a.codePointAt(i);
    const y = b.codePointAt(j);
    if (x !== y)
      return x - y;
    i += x > 65535 ? 2 : 1;
    j += y > 65535 ? 2 : 1;
  }
  return a.length - i - (b.length - j);
}
function serdeNumber(n) {
  if (!Number.isFinite(n))
    return "null";
  if (Number.isInteger(n) && n > -(2 ** 63) && n < 2 ** 64)
    return String(n);
  const [mantissa, exponent] = Math.abs(n).toExponential().split("e");
  const digits = mantissa.replace(".", "");
  const length = digits.length;
  const e = Number(exponent);
  let s;
  if (e >= -5 && e <= 15) {
    if (length - 1 <= e)
      s = `${digits}${"0".repeat(e + 1 - length)}.0`;
    else if (e >= 0)
      s = `${digits.slice(0, e + 1)}.${digits.slice(e + 1)}`;
    else
      s = `0.${"0".repeat(-e - 1)}${digits}`;
  } else {
    s = `${length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits}e${e < 0 ? "-" : "+"}${Math.abs(e)}`;
  }
  return n < 0 ? `-${s}` : s;
}
function writeJson(v, indent) {
  if (v === null || v === void 0)
    return "null";
  if (typeof v === "string")
    return JSON.stringify(v);
  if (typeof v === "number")
    return serdeNumber(v);
  if (typeof v === "boolean")
    return v ? "true" : "false";
  const inner = indent === void 0 ? void 0 : `${indent}  `;
  if (Array.isArray(v)) {
    if (v.length === 0)
      return "[]";
    const items2 = v.map((x) => writeJson(x, inner));
    return inner === void 0 ? `[${items2.join(",")}]` : `[${inner}${items2.join(`,${inner}`)}${indent}]`;
  }
  const keys = Object.keys(v).filter((k) => v[k] !== void 0).sort(compareCodePoints);
  if (keys.length === 0)
    return "{}";
  const items = keys.map((k) => `${JSON.stringify(k)}:${inner === void 0 ? "" : " "}${writeJson(v[k], inner)}`);
  return inner === void 0 ? `{${items.join(",")}}` : `{${inner}${items.join(`,${inner}`)}${indent}}`;
}
function serdeJson(value, pretty = false) {
  return writeJson(value, pretty ? "\n" : void 0);
}
function canonicalJson(value) {
  if (value === void 0)
    return "null";
  return serdeJson(JSON.parse(JSON.stringify(value)));
}
function cloneJson(value) {
  return value === void 0 ? value : JSON.parse(JSON.stringify(value));
}
function jsonEqual(a, b) {
  return canonicalJson(a) === canonicalJson(b);
}
function isObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function nowMs() {
  return Date.now();
}
function textMessage(role, text) {
  return { role, content: [{ type: "text", text }] };
}
function textContent(message) {
  return rustTextContent(message);
}
function toolCalls(message) {
  const out = [];
  for (const b of message.content) {
    if (b.type === "tool_use")
      out.push({ name: b.name, args: b.args ?? {}, call_id: b.call_id });
  }
  return out;
}
function validateResponse(response) {
  const m = response.message;
  if (!m || m.role !== "assistant")
    return `invalid block response_message for role ${m == null ? void 0 : m.role}`;
  for (const b of m.content ?? []) {
    if (!["text", "image", "document", "tool_use", "thinking", "provider_state"].includes(b.type)) {
      return `invalid block ${b.type} for role assistant`;
    }
    if (b.type === "tool_use" && !rustTrim(b.call_id ?? ""))
      return "tool call without call_id";
  }
  return void 0;
}
function toolObservationMessage(callId, observation) {
  let text;
  let isError;
  switch (observation.kind) {
    case "success":
      text = typeof observation.content === "string" ? observation.content : canonicalJson(observation.content);
      isError = false;
      break;
    case "error":
      text = observation.message;
      isError = true;
      break;
    case "cancelled":
      if (observation.effect_unknown) {
        text = `[cancelled, result unknown] ${observation.reason}`;
        isError = true;
      } else {
        text = `[cancelled] ${observation.reason}`;
        isError = false;
      }
      break;
    case "unresolved":
      text = observation.effect_unknown ? `[unresolved: result unknown] ${observation.reason}` : `[not executed] ${observation.reason}`;
      isError = true;
      break;
  }
  const block = isError ? { type: "tool_result", call_id: callId, content: [{ type: "text", text }], is_error: true } : { type: "tool_result", call_id: callId, content: [{ type: "text", text }] };
  return { role: "tool", content: [block] };
}
const USAGE_COUNTERS = [
  "input_tokens",
  "output_tokens",
  "total_tokens",
  "cache_read_input_tokens",
  "cache_write_input_tokens",
  "cache_write_1h_input_tokens",
  "reasoning_tokens",
  "image_units",
  "audio_seconds",
  "video_seconds",
  "reference_images",
  "request_units",
  "characters",
  "audio_input_tokens",
  "image_input_tokens",
  "audio_output_tokens",
  "image_output_tokens"
];
function mergeUsage(left, right) {
  const out = {};
  for (const k of USAGE_COUNTERS) {
    const a = left[k];
    const b = right[k];
    if (a !== void 0 || b !== void 0)
      out[k] = (a ?? 0) + (b ?? 0);
  }
  const cost = addCost(left.cost, right.cost);
  if (cost)
    out.cost = cost;
  return out;
}
function addCost(a, b) {
  if (a && b)
    return a.currency === b.currency ? { amount: a.amount + b.amount, currency: a.currency } : void 0;
  return a ?? b;
}
function addRecordUsage(base, extra) {
  const cur = { ...base ?? {} };
  for (const k of ["input_tokens", "output_tokens", "total_tokens", "request_units"]) {
    if (extra[k] !== void 0)
      cur[k] = (cur[k] ?? 0) + extra[k];
  }
  return cur;
}
const REFUSED_QUOTA_EXHAUSTED = "quota_exhausted";
const REFUSED_QUOTA_BUDGET_EXCEEDED = "quota_budget_exceeded";
const REFUSED_RESOURCE_NOT_PERMITTED = "resource_not_permitted";
const REFUSED_ATTRIBUTION_UNAVAILABLE = "attribution_unavailable";
const REFUSED_CREDENTIALS = "credentials";
const REFUSAL_CODES = [REFUSED_QUOTA_EXHAUSTED, REFUSED_QUOTA_BUDGET_EXCEEDED, REFUSED_RESOURCE_NOT_PERMITTED, REFUSED_ATTRIBUTION_UNAVAILABLE];
function anyJsonObjectSchema() {
  return { type: "object", additionalProperties: true };
}
function refused(code) {
  return { refused: { code } };
}
function aiccProviderFailure(error) {
  const code = error.code;
  if (code && REFUSAL_CODES.includes(code))
    return refused(code);
  if (code === "quota_unavailable")
    return "transient";
  const httpStatus = isObject(error.details) ? error.details.http_status : void 0;
  if (code === "context_length_exceeded" || httpStatus === 413)
    return "context_limit";
  if (code === "timeout" || error.retriable === true)
    return "transient";
  return void 0;
}
function providerErrorFromRpc(context, err) {
  const message = err instanceof Error ? err.message : String(err);
  const text = `${context}: ${message}`;
  const code = typeof err === "object" && err !== null ? err.code : void 0;
  if (typeof code !== "string" || !code)
    return providerError("unknown", text);
  const rawData = err.data;
  const data = isObject(rawData) ? rawData : void 0;
  const fromAicc = aiccProviderFailure({ ...data, code });
  if (fromAicc)
    return providerError(fromAicc, text);
  if (code === RPC_HTTP_ERROR_CODE) {
    const status = typeof (data == null ? void 0 : data.status) === "number" ? data.status : void 0;
    if (status === 413)
      return providerError("context_limit", text);
    if (status === 408 || status === 504)
      return providerError("transient", text);
    if (status === 401 || status === 403)
      return providerError(refused(REFUSED_CREDENTIALS), text);
    return providerError("unknown", text);
  }
  if (code === RPC_TRANSPORT_ERROR_CODE)
    return providerError("transient", text);
  return providerError("unknown", text);
}
const DISABLE_FEATURES = {
  tool_call: "tool_call",
  json_schema: "json_schema",
  web_search: "web_search",
  vision: "vision",
  image_generation: "image_generation",
  streaming: "streaming"
};
function aiccErrorText(e) {
  return e ? ` (${e.code}: ${e.message})` : "";
}
class AiccLlmClient {
  constructor(client) {
    this.client = client;
  }
  async infer(req) {
    var _a;
    const tools = req.allow_tool_calls ? req.tool_specs.map((s) => ({ type: "function", name: s.name, description: s.description, args_json_schema: s.args_schema })) : [];
    const disable = {};
    for (const f of req.disable_capabilities) {
      const key = DISABLE_FEATURES[f];
      if (key)
        disable[key] = true;
    }
    let responseFormat;
    if (req.force_json) {
      responseFormat = req.json_schema !== void 0 ? { type: "json_schema", json_schema: { name: "llm_response", schema: req.json_schema } } : { type: "json_schema", json_schema: { name: "llm_response", schema: anyJsonObjectSchema(), strict: false } };
    }
    const common = {
      messages: req.messages,
      ...tools.length ? { tools } : {},
      ...responseFormat ? { response_format: responseFormat } : {},
      ...req.temperature !== void 0 ? { temperature: req.temperature } : {},
      ...req.max_completion_tokens !== void 0 ? { max_output_tokens: req.max_completion_tokens } : {},
      ...req.trace_id ? { trace_id: req.trace_id } : {},
      execution_mode: "immediate"
    };
    const exact = req.model_alias.includes("@");
    const method = exact ? "chat.completions.create" : "helper.llm_chat";
    let response;
    try {
      if (exact) {
        const r = { exact_model: req.model_alias, ...common };
        response = await this.client.chatCompletionsCreate(r);
      } else {
        const requirements = {};
        if (req.allow_tool_calls && tools.length > 0)
          requirements.tool_call = true;
        if (req.force_json)
          requirements.json_schema = true;
        const r = {
          logical_model: req.model_alias,
          ...common,
          ...Object.keys(requirements).length ? { requirements } : {},
          ...Object.keys(disable).length ? { disable } : {}
        };
        response = await this.client.helperLlmChat(r);
      }
    } catch (e) {
      if (e instanceof LLMComputeException)
        throw e;
      throw providerErrorFromRpc(`aicc ${method} failed`, e);
    }
    if (response.status === "succeeded") {
      if (!response.message)
        throw providerError("unknown", `aicc ${method} succeeded but message is empty`);
      const out = { message: response.message };
      if (response.usage)
        out.usage = response.usage;
      if (response.cost)
        out.cost = response.cost;
      if (response.finish_reason)
        out.finish_reason = response.finish_reason;
      if (response.provider_task_ref)
        out.provider_task_ref = response.provider_task_ref;
      const model = (_a = response.route_trace) == null ? void 0 : _a.final_model;
      if (model)
        out.extra = { model };
      return out;
    }
    if (response.status === "failed") {
      const failure = (response.error && aiccProviderFailure(response.error)) ?? "unknown";
      throw providerError(
        failure,
        `aicc ${method} failed${aiccErrorText(response.error)}: task_id=${response.task_id}, event_ref=${response.event_ref ?? ""}`
      );
    }
    throw providerError(
      "permanent",
      `aicc ${method} returned async task \`${response.task_id}\`; xllm does not poll async tasks — use a synchronous-capable model`
    );
  }
}
export {
  AiccLlmClient as A,
  compareCodePoints as B,
  charOffset as C,
  collapseWhitespace as D,
  addRecordUsage as E,
  refusedCode as F,
  LLMComputeException as L,
  XllmError as X,
  asComputeError as a,
  infraRetrySafe as b,
  computeErrorMessage as c,
  charCount as d,
  errorSource as e,
  rustTrimEnd as f,
  rustTrimStart as g,
  aiccProviderFailure as h,
  isObject as i,
  anyJsonObjectSchema as j,
  providerErrorFromRpc as k,
  llmCorrectable as l,
  cloneJson as m,
  canonicalJson as n,
  jsonEqual as o,
  providerError as p,
  nowMs as q,
  rustTrim as r,
  serdeJson as s,
  textMessage as t,
  textContent as u,
  validateResponse as v,
  toolCalls as w,
  toolObservationMessage as x,
  mergeUsage as y,
  rustTextContent as z
};
//# sourceMappingURL=aicc-67851c41.mjs.map
