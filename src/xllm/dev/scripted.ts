// A scripted LlmClient for development and tests (Rust wishkit `ScriptedModel`):
// replies by call number, never by matching prompt text.

import type { AiMessage, AiResponse, AiToolCall, AiUsage, JsonValue, LLMComputeError, LlmClient, LlmInferenceRequest } from '../core/types'
import { LLMComputeException } from '../core/errors'
import { cloneJson } from '../core/json'

export interface ScriptedCall {
  name: string
  args?: AiToolCall['args']
  /** Default `call_<reply#>_<n>`. */
  call_id?: string
}

export type ScriptedReply =
  | { text?: string; tool_calls?: ScriptedCall[]; usage?: AiUsage }
  | { message: AiMessage; usage?: AiUsage }
  | { error: LLMComputeError }
  /** Never resolves (until the request signal aborts): an inference in flight. */
  | { hang: true }
  /** Resolves after `ms` with `then`. */
  | { delay_ms: number; then: ScriptedReply }

export type ScriptedStep = ScriptedReply | ((req: LlmInferenceRequest, index: number) => ScriptedReply | Promise<ScriptedReply>)

export interface ScriptedLlmOptions {
  /** Reply when the script is exhausted (default: an `internal` error). */
  fallback?: ScriptedReply
  /** Usage reported for every reply without its own (default `{ total_tokens: 10, request_units: 1 }`). */
  usage?: AiUsage
}

export class ScriptedLlmClient implements LlmClient {
  /** Every request received, in order. */
  readonly requests: LlmInferenceRequest[] = []
  private index = 0

  constructor(private readonly script: ScriptedStep[], private readonly options: ScriptedLlmOptions = {}) {}

  /** Number of inferences requested so far. */
  get calls(): number {
    return this.index
  }

  async infer(req: LlmInferenceRequest): Promise<AiResponse> {
    const i = this.index++
    this.requests.push({ ...req, messages: cloneJson(req.messages) })
    const step = this.script[i]
    let reply: ScriptedReply
    if (step === undefined) {
      reply = this.options.fallback ?? { error: { kind: 'internal', message: `scripted model has no reply #${i + 1}` } }
    } else {
      reply = typeof step === 'function' ? await step(req, i) : step
    }
    return this.play(reply, req, i)
  }

  private async play(reply: ScriptedReply, req: LlmInferenceRequest, i: number): Promise<AiResponse> {
    if ('hang' in reply) {
      return new Promise((_, reject) => {
        const fail = () => reject(new LLMComputeException({ kind: 'cancelled' }))
        if (req.signal.aborted) fail()
        else req.signal.addEventListener('abort', fail, { once: true })
      })
    }
    if ('delay_ms' in reply) {
      await new Promise(resolve => setTimeout(resolve, reply.delay_ms))
      return this.play(reply.then, req, i)
    }
    if ('error' in reply) throw new LLMComputeException(reply.error)
    const usage = reply.usage ?? this.options.usage ?? { total_tokens: 10, request_units: 1 }
    if ('message' in reply) return { message: cloneJson(reply.message), usage }
    const content: AiMessage['content'] = []
    if (reply.text !== undefined && reply.text !== '') content.push({ type: 'text', text: reply.text })
    let n = 0
    for (const call of reply.tool_calls ?? []) {
      n += 1
      content.push({
        type: 'tool_use',
        call_id: call.call_id ?? `call_${i + 1}_${n}`,
        name: call.name,
        args: (call.args ?? {}) as Record<string, JsonValue>,
      })
    }
    if (content.length === 0) content.push({ type: 'text', text: '' })
    return { message: { role: 'assistant', content }, usage }
  }
}
