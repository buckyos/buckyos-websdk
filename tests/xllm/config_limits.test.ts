// `max_consecutive_errors` in `.llm_context` (same key and default as Rust `agent_tool` xllm): the run's error policy.
import { DEFAULT_MAX_CONSECUTIVE_ERRORS, parseLlmContextJson } from '../../src/xllm/core/config'
import { XllmTask, runRequest } from '../../src/xllm/core/run'
import { MemoryRunStore } from '../../src/xllm/core/store'
import { ScriptedLlmClient } from '../../src/xllm/dev/scripted'
import { createSiteRuntime } from '../../src/xllm/runtime/site'

function deps() {
  const runtime = createSiteRuntime({ scene: 'test.limits', origin: 'https://example.invalid', hostname: 'example.invalid', tools: {} })
  return { llm: new ScriptedLlmClient([{ text: 'done' }]), runtime, store: new MemoryRunStore(), hostPromptSections: 'NONE' as const }
}

describe('max_consecutive_errors', () => {
  it('is parsed, must be at least 1', () => {
    expect(parseLlmContextJson('/x/.llm_context', { max_consecutive_errors: 6 }).max_consecutive_errors).toBe(6)
    expect(() => parseLlmContextJson('/x/.llm_context', { max_consecutive_errors: 0 })).toThrow(/max_consecutive_errors/)
  })

  it('sets the error policy of a run; absent, the default', async () => {
    for (const [config, cap] of [[{ max_consecutive_errors: 6 }, 6], [{}, DEFAULT_MAX_CONSECUTIVE_ERRORS]] as const) {
      const task = await XllmTask.prepareHosted({ provider: { type: 'buckyos' }, ...config }, 'test', 'system', deps())
      expect(task.config.limits.max_consecutive_errors).toBe('max_consecutive_errors' in config ? cap : undefined)
      expect(runRequest(task.config, null, 't', 'o', '', [], true).error_policy.max_consecutive_errors).toBe(cap)
    }
  })
})
