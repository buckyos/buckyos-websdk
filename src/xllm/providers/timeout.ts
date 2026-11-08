// Per-request timeout (`llm_timeout`) around any LlmClient, counting the
// inference attempts of this executor segment and the model the provider
// reported (Rust `TimeoutLlmClient`).

import type { AiResponse, LlmClient, LlmInferenceRequest } from '../core/types'
import { LLMComputeException } from '../core/errors'
import { isObject } from '../core/json'

export class TimeoutLlmClient implements LlmClient {
  private callCount = 0
  private model: string | undefined

  constructor(private readonly inner: LlmClient, private readonly timeoutMs: number) {}

  calls(): number {
    return this.callCount
  }

  lastModel(): string | undefined {
    return this.model
  }

  async infer(req: LlmInferenceRequest): Promise<AiResponse> {
    this.callCount += 1
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    if (req.signal.aborted) controller.abort()
    else req.signal.addEventListener('abort', onAbort)
    let timer: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new LLMComputeException({ kind: 'timeout' }))
      }, Math.max(1, this.timeoutMs))
    })
    try {
      const response = await Promise.race([this.inner.infer({ ...req, signal: controller.signal }), timedOut])
      const model = isObject(response.extra) ? response.extra.model : undefined
      if (typeof model === 'string') this.model = model
      return response
    } finally {
      if (timer) clearTimeout(timer)
      req.signal.removeEventListener('abort', onAbort)
    }
  }
}
