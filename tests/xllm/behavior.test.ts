// Behavior loop at the waist level, with a minimal renderer (the XML step
// renderer has its own tests).
import { LLMContext } from '../../src/xllm/core/loop'
import { XllmActionParser } from '../../src/xllm/core/action_parser'
import { behaviorDecision } from '../../src/xllm/core/behavior_result'
import type { ToolManager } from '../../src/xllm/core/deps'
import type { AiMessage, LLMContextRequest, Observation, ResolvedTool, StepRecord } from '../../src/xllm/core/types'
import { ScriptedLlmClient } from '../../src/xllm/dev/scripted'

const renderer = {
  render(step: StepRecord): [AiMessage, AiMessage] {
    const results = (step.action_results ?? []).map(r => `${r.kind}:${r.kind === 'success' ? r.content : r.kind === 'error' ? r.message : r.reason}`)
    return [
      { role: 'assistant', content: [{ type: 'text', text: step.assistant_text || '(none)' }] },
      { role: 'user', content: [{ type: 'text', text: `results: ${results.join(' | ') || '(none)'}` }] },
    ]
  },
}

const actions: ResolvedTool[] = [
  { name: 'read_note', description: 'Read a note', args_schema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] }, source: 'name:read_note' },
  { name: 'write_note', description: 'Write', args_schema: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] }, source: 'name:write_note' },
]

function manager(results: Record<string, (args: Record<string, unknown>) => Observation | string>, seen: string[]): ToolManager {
  return {
    listToolSpecs: () => [{ name: 'lookup', description: 'native lookup', args_schema: { type: 'object', properties: {} } }],
    async callTool(call) {
      seen.push(`${call.name}:${JSON.stringify(call.args)}`)
      const f = results[call.name]
      if (!f) return { kind: 'error', call_id: call.call_id, message: `no tool ${call.name}` }
      const r = f(call.args)
      return typeof r === 'string' ? { kind: 'success', call_id: call.call_id, content: r, bytes: r.length, truncated: false } : { ...r, call_id: call.call_id }
    },
  }
}

function request(over: Partial<LLMContextRequest> = {}): LLMContextRequest {
  return {
    owner: { kind: 'test' }, trace: 't', objective: '', behavior_name: 'xllm',
    input: [{ role: 'system', content: [{ type: 'text', text: 'sys' }] }, { role: 'user', content: [{ type: 'text', text: 'task' }] }],
    model_policy: { preferred: 'm', fallbacks: [], temperature: null, max_completion_tokens: null, provider_options: null },
    tool_policy: { mode: 'whitelist', whitelist: ['lookup'], action_mode: 'whitelist', action_whitelist: ['read_note', 'write_note'],
      max_tool_iterations: 4, max_calls_per_round: 16, disable_capabilities: [], finish_grace_ms: 1000 },
    output: { kind: 'text' },
    budget: { max_total_tokens: null, max_completion_tokens: null, max_wallclock_ms: 60_000, max_cost_units: null, on_exhausted: 'fail',
      context_yield_threshold: null, context_window_tokens: null },
    error_policy: { max_consecutive_errors: 3 },
    forbid_next_behavior: false,
    ...over,
  }
}

function ctx(script: ConstructorParameters<typeof ScriptedLlmClient>[0], tools: ToolManager) {
  const llm = new ScriptedLlmClient(script)
  const c = new LLMContext(request(), { llm, tools, resultParser: new XllmActionParser(actions), stepRenderer: renderer })
  return { c, llm }
}

describe('behavior loop', () => {
  test('a reply with a final report and no actions completes the run', async () => {
    const seen: string[] = []
    const { c } = ctx([{ text: '<response><intent>answer</intent><report end="true"><![CDATA[final answer]]></report></response>' }], manager({}, seen))
    const out = await c.run()
    expect(out.kind).toBe('done')
    if (out.kind !== 'done') return
    expect(out.behavior_result).toMatchObject({ report_end: true, self_report: 'final answer', thought: 'answer' })
    expect(c.snapshot().state.steps?.length).toBe(1)
  })

  test('actions run in order; their results are rendered into the next step', async () => {
    const seen: string[] = []
    const { c, llm } = ctx([
      { text: '<response><actions><read_note id="3"/><write_note><![CDATA[hello]]></write_note></actions></response>' },
      { text: '<response><report end="true">done</report></response>' },
    ], manager({ read_note: a => `note ${a.id}`, write_note: () => 'written' }, seen))
    const out = await c.run()
    expect(out.kind).toBe('done')
    expect(seen).toEqual(['read_note:{"id":3}', 'write_note:{"content":"hello"}'])
    const last = llm.requests[1].messages[llm.requests[1].messages.length - 1]
    expect(last.content[0]).toEqual({ type: 'text', text: 'results: success:note 3 | success:written' })
    const state = c.snapshot().state
    expect(state.tool_iterations_left).toBe(3)
    expect(state.next_action_id).toBe(2)
  })

  test('a progress report alone yields', async () => {
    const { c } = ctx([{ text: '<response><report>half way</report></response>' }], manager({}, []))
    const out = await c.run()
    expect(out.kind).toBe('done')
    if (out.kind !== 'done') return
    expect(behaviorDecision(out.behavior_result!)).toBe('yield')
    expect(c.snapshot().state.last_report).toBe('half way')
  })

  test('a reply that does not parse becomes a correction step', async () => {
    const { c, llm } = ctx([
      { text: '<response><report end="true">a</report><report>b</report></response>' },
      { text: '<response><report end="true">fixed</report></response>' },
    ], manager({}, []))
    const out = await c.run()
    expect(out.kind).toBe('done')
    const last = llm.requests[1].messages[llm.requests[1].messages.length - 1]
    expect(last.content[0]).toEqual({ type: 'text', text: 'results: error:parse failed: a decision must contain at most one report' })
    const steps = c.snapshot().state.steps ?? []
    expect(steps.map(st => st.action_results?.[0]?.kind ?? 'final')).toEqual(['error', 'final'])
    expect(c.snapshot().state.consecutive_errors).toBe(0)
  })

  test('the first failing action stops the step; the rest is not executed', async () => {
    const seen: string[] = []
    const { c, llm } = ctx([
      { text: '<response><actions><read_note id="1"/><write_note content="x"/></actions></response>' },
      { text: '<response><report end="true">gave up</report></response>' },
    ], manager({ read_note: () => ({ kind: 'error', call_id: '', message: 'missing' }), write_note: () => 'w' }, seen))
    const out = await c.run()
    expect(out.kind).toBe('done')
    expect(seen).toEqual(['read_note:{"id":1}'])
    const last = llm.requests[1].messages[llm.requests[1].messages.length - 1]
    expect(last.content[0]).toEqual({ type: 'text', text: 'results: error:missing | unresolved:not executed: an earlier action in this step failed' })
  })

  test('native tool calls inside a step run in the inner loop before the step reply', async () => {
    const seen: string[] = []
    const { c } = ctx([
      { tool_calls: [{ name: 'lookup', args: {} }] },
      { text: '<response><report end="true">looked up</report></response>' },
    ], manager({ lookup: () => 'found' }, seen))
    const out = await c.run()
    expect(out.kind).toBe('done')
    expect(seen).toEqual(['lookup:{}'])
    const step = c.snapshot().state.steps?.[0]
    expect(step?.native_messages?.map(m => m.role)).toEqual(['assistant', 'tool'])
  })
})
