import { u as textContent, w as toolCalls, j as anyJsonObjectSchema, L as LLMComputeException, p as providerError } from "./aicc-67851c41.mjs";
function openaiHttpFailure(status, body) {
  var _a, _b;
  let code;
  try {
    code = (_b = (_a = JSON.parse(body)) == null ? void 0 : _a.error) == null ? void 0 : _b.code;
  } catch {
    code = void 0;
  }
  if (code === "context_length_exceeded")
    return "context_limit";
  if (status === 401 || status === 403)
    return { refused: { code: "credentials" } };
  if ([400, 404, 422].includes(status))
    return "permanent";
  if ([408, 409, 425, 429, 500, 502, 503, 504].includes(status))
    return "transient";
  return "unknown";
}
function contentToOpenai(content) {
  const parts = [];
  for (const c of content) {
    if (c.type === "text")
      parts.push({ type: "text", text: c.text });
    else if (c.type === "image") {
      const s = c.source;
      const url = s.kind === "url" ? s.url : s.kind === "base64" ? `data:${s.mime};base64,${s.data_base64}` : s.obj_id;
      parts.push({ type: "image_url", image_url: { url } });
    } else if (c.type === "document") {
      const label = c.title ?? "document";
      const desc = c.source.kind === "url" ? c.source.url : "(inline document omitted)";
      parts.push({ type: "text", text: `[${label}: ${desc}]` });
    }
  }
  const only = parts[0];
  if (parts.length === 1 && (only == null ? void 0 : only.type) === "text")
    return only.text;
  return parts;
}
function messagesToOpenai(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role === "system" || m.role === "developer")
      out.push({ role: "system", content: textContent(m) });
    else if (m.role === "user")
      out.push({ role: "user", content: contentToOpenai(m.content) });
    else if (m.role === "assistant") {
      const text = textContent(m);
      const calls = toolCalls(m).map((c) => ({ id: c.call_id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } }));
      const obj = { role: "assistant", content: text === "" ? null : text };
      if (calls.length)
        obj.tool_calls = calls;
      out.push(obj);
    } else {
      for (const b of m.content) {
        if (b.type === "tool_result") {
          out.push({ role: "tool", tool_call_id: b.call_id, content: b.content.filter((c) => c.type === "text").map((c) => c.text).join("\n") });
        }
      }
    }
  }
  return out;
}
function truncateChars(s, max) {
  const chars = [...s];
  return chars.length <= max ? s : chars.slice(0, max).join("") + "…";
}
class OpenAiLlmClient {
  constructor(options) {
    var _a, _b;
    this.options = options;
    this.baseUrl = (((_a = options.baseUrl) == null ? void 0 : _a.trim()) || "https://api.openai.com/v1").replace(/\/+$/, "");
    if (!((_b = options.apiKey) == null ? void 0 : _b.trim()))
      throw new Error("openai provider: no API key");
  }
  async infer(req) {
    var _a, _b, _c;
    const body = { model: req.model_alias, messages: messagesToOpenai(req.messages) };
    if (req.temperature !== void 0)
      body.temperature = req.temperature;
    if (req.max_completion_tokens !== void 0)
      body.max_tokens = req.max_completion_tokens;
    if (req.allow_tool_calls && req.tool_specs.length) {
      body.tools = req.tool_specs.map((s) => ({ type: "function", function: { name: s.name, description: s.description, parameters: s.args_schema } }));
      body.tool_choice = "auto";
    }
    if (req.force_json)
      body.response_format = { type: "json_schema", json_schema: { name: "xllm_result", schema: req.json_schema ?? anyJsonObjectSchema() } };
    if (req.provider_options && typeof req.provider_options === "object" && !Array.isArray(req.provider_options)) {
      Object.assign(body, req.provider_options);
    }
    const f = this.options.fetch ?? globalThis.fetch.bind(globalThis);
    let response;
    try {
      response = await f(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.options.apiKey}`, ...this.options.headers ?? {} },
        body: JSON.stringify(body),
        signal: req.signal
      });
    } catch (e) {
      if (req.signal.aborted)
        throw new LLMComputeException({ kind: "cancelled" });
      throw providerError("transient", `openai request failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    let text;
    try {
      text = await response.text();
    } catch (e) {
      throw providerError("transient", `openai read body failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!response.ok)
      throw providerError(openaiHttpFailure(response.status, text), `openai http ${response.status}: ${truncateChars(text, 512)}`);
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw providerError("unknown", `openai invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
    const choice = (_a = parsed.choices) == null ? void 0 : _a[0];
    if (!choice)
      throw providerError("unknown", "openai response has no choices");
    const message = choice.message ?? {};
    const content = [];
    if (typeof message.content === "string")
      content.push({ type: "text", text: message.content });
    for (const c of message.tool_calls ?? []) {
      let args = {};
      try {
        const v = JSON.parse(((_b = c.function) == null ? void 0 : _b.arguments) ?? "{}");
        if (v && typeof v === "object" && !Array.isArray(v))
          args = v;
      } catch {
        args = {};
      }
      content.push({ type: "tool_use", call_id: c.id ?? "", name: ((_c = c.function) == null ? void 0 : _c.name) ?? "", args });
    }
    if (content.length === 0)
      content.push({ type: "text", text: "" });
    const out = { message: { role: "assistant", content } };
    if (typeof choice.finish_reason === "string")
      out.finish_reason = choice.finish_reason;
    const u = parsed.usage;
    if (u) {
      out.usage = { request_units: 1 };
      if (typeof u.prompt_tokens === "number")
        out.usage.input_tokens = u.prompt_tokens;
      if (typeof u.completion_tokens === "number")
        out.usage.output_tokens = u.completion_tokens;
      if (typeof u.total_tokens === "number")
        out.usage.total_tokens = u.total_tokens;
    }
    if (typeof parsed.model === "string")
      out.extra = { model: parsed.model };
    return out;
  }
}
export {
  OpenAiLlmClient as O,
  messagesToOpenai as m,
  openaiHttpFailure as o
};
//# sourceMappingURL=openai-ae2978de.mjs.map
