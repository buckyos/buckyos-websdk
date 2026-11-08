import { m as cloneJson, L as LLMComputeException } from "./aicc-67851c41.mjs";
import { O, m, o } from "./openai-ae2978de.mjs";
import "./krpc_client-673448e5.mjs";
class ScriptedLlmClient {
  constructor(script, options = {}) {
    this.script = script;
    this.options = options;
    this.requests = [];
    this.index = 0;
  }
  /** Number of inferences requested so far. */
  get calls() {
    return this.index;
  }
  async infer(req) {
    const i = this.index++;
    this.requests.push({ ...req, messages: cloneJson(req.messages) });
    const step = this.script[i];
    let reply;
    if (step === void 0) {
      reply = this.options.fallback ?? { error: { kind: "internal", message: `scripted model has no reply #${i + 1}` } };
    } else {
      reply = typeof step === "function" ? await step(req, i) : step;
    }
    return this.play(reply, req, i);
  }
  async play(reply, req, i) {
    if ("hang" in reply) {
      return new Promise((_, reject) => {
        const fail = () => reject(new LLMComputeException({ kind: "cancelled" }));
        if (req.signal.aborted)
          fail();
        else
          req.signal.addEventListener("abort", fail, { once: true });
      });
    }
    if ("delay_ms" in reply) {
      await new Promise((resolve) => setTimeout(resolve, reply.delay_ms));
      return this.play(reply.then, req, i);
    }
    if ("error" in reply)
      throw new LLMComputeException(reply.error);
    const usage = reply.usage ?? this.options.usage ?? { total_tokens: 10, request_units: 1 };
    if ("message" in reply)
      return { message: cloneJson(reply.message), usage };
    const content = [];
    if (reply.text !== void 0 && reply.text !== "")
      content.push({ type: "text", text: reply.text });
    let n = 0;
    for (const call of reply.tool_calls ?? []) {
      n += 1;
      content.push({
        type: "tool_use",
        call_id: call.call_id ?? `call_${i + 1}_${n}`,
        name: call.name,
        args: call.args ?? {}
      });
    }
    if (content.length === 0)
      content.push({ type: "text", text: "" });
    return { message: { role: "assistant", content }, usage };
  }
}
export {
  O as OpenAiLlmClient,
  ScriptedLlmClient,
  m as messagesToOpenai,
  o as openaiHttpFailure
};
//# sourceMappingURL=xllm_dev.mjs.map
