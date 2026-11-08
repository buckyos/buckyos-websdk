// Shared vectors (generated and checked by Rust `xllm::vectors` in
// buckyos/src/frame/llm_context/tests/vectors/, read from a sibling buckyos
// checkout or XLLM_VECTORS_DIR): the TS runtime must produce the same
// protocol text, parse results, loop outcomes, error classes, hint rendering
// and task text.
import * as fs from 'fs'
import * as path from 'path'
import { buildCmdManualSystemText, buildRulesSystemText, buildRuntimeProtocolFor } from '../../src/xllm/core/protocol'
import { TemplateEnv, assemblePrompt } from '../../src/xllm/core/prompt'
import { mergeConfigLayers, parseLlmContextJson } from '../../src/xllm/core/config'
import { selectPromptGroup } from '../../src/xllm/core/prepare'
import { assembleHostedSystem, checkHostedLoop, outcomeRunStatus } from '../../src/xllm/core/run'
import { XllmError, LLMComputeException } from '../../src/xllm/core/errors'
import { XllmActionParser } from '../../src/xllm/core/action_parser'
import { LLMContext, stateFromRequest } from '../../src/xllm/core/loop'
import { XmlStepRenderer } from '../../src/xllm/runtime/step_renderer'
import { compressHistory, mergeKeepExact, parseSummaryMessage, segment, summaryMessage } from '../../src/xllm/runtime/compress'
import { ByteHeuristicTokenizer } from '../../src/xllm/core/tokenizer'
import { textContent } from '../../src/xllm/core/messages'
import type { LLMContextDeps } from '../../src/xllm/core/deps'
import { ToolDispatchException } from '../../src/xllm/core/deps'
import type { ToolManager } from '../../src/xllm/core/deps'
import { canonicalJson } from '../../src/xllm/core/json'
import { DEFAULT_TIMEOUT_SECS } from '../../src/xllm/core/config'
import { AiccLlmClient, providerErrorFromRpc } from '../../src/xllm/providers/aicc'
import { openaiHttpFailure } from '../../src/xllm/dev/openai'
import { MemoryHintLedger, HINT_NS_DEDUP, HINT_NS_ONCE, applyHints } from '../../src/xllm/runtime/hints'
import { envelopeObservation } from '../../src/xllm/runtime/site_manager'
import { asToolResult } from '../../src/xllm/runtime/tool_result'
import { followupGeneralHint, taskStateObservation } from '../../src/xllm/runtime/task_model'
import type { AiMessage, AiResponse, JsonValue, LLMContextOutcome, LlmInferenceRequest } from '../../src/xllm/core/types'

/* eslint-disable @typescript-eslint/no-explicit-any */
const dir = process.env.XLLM_VECTORS_DIR ?? path.join(__dirname, '../../../buckyos/src/frame/llm_context/tests/vectors')
const present = fs.existsSync(dir)
if (!present) test.skip(`shared vectors (none at ${dir}; set XLLM_VECTORS_DIR)`, () => {})
function load(name: string): any[] {
  if (!present) return []
  const file = JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8'))
  expect(file.vectors_version).toBe(1)
  return file.cases
}
const same = (a: unknown, b: unknown) => expect(JSON.parse(canonicalJson(a))).toEqual(JSON.parse(canonicalJson(b)))

function errorOf(e: unknown): { kind: string; field?: string } {
  if (!(e instanceof XllmError)) throw e
  return e.detail.kind === 'config' ? { kind: 'config', field: e.detail.field } : { kind: e.detail.kind }
}

describe('vectors: prompt_assembly', () => {
  for (const c of load('prompt_assembly')) {
    test(c.name, () => {
      switch (c.fn) {
        case 'runtime_protocol':
          expect(buildRuntimeProtocolFor(c.flavor, c.loop_model, c.tools, c.json)).toBe(c.expect)
          return
        case 'rules':
          expect(buildRulesSystemText(c.loop_model, c.tools)).toBe(c.expect)
          return
        case 'cmd_manual':
          expect(buildCmdManualSystemText(c.tools) ?? null).toBe(c.expect)
          return
        case 'parse_config': {
          let got: unknown
          try {
            parseLlmContextJson(c.origin ?? '/v/.llm_context', c.llm_context)
            got = { ok: true }
          } catch (e) {
            got = { error: errorOf(e) }
          }
          same(got, c.expect)
          return
        }
        case 'assemble_prompt': {
          const env = new TemplateEnv(c.runtime_vars, (n: string) => c.env?.[n])
          let got: unknown
          try {
            const merged = mergeConfigLayers([{ path: c.origin, file: parseLlmContextJson(c.origin, c.llm_context) }])
            const groupName = selectPromptGroup(merged, { select: c.override_select, system: c.override_system })
            const plan = assemblePrompt({
              merged, overrideSystem: c.override_system, overrideSelect: c.override_select, groupName,
              group: groupName !== undefined ? merged.prompt.groups?.[groupName] : undefined, loopModel: c.loop_model, tools: c.tools, env, json: c.json,
            })
            got = { mode: plan.mode, system_prompt: plan.system_prompt, runtime_protocol: plan.runtime_protocol, sections: plan.sections,
              template_vars: plan.template_vars, ...(plan.user_request !== undefined ? { user_request: plan.user_request } : {}) }
          } catch (e) {
            got = { error: errorOf(e) }
          }
          same(got, c.expect)
          return
        }
        case 'hosted_system': {
          let got: unknown
          try {
            checkHostedLoop(c.origin, c.sections, c.loop_model, c.json)
            const env = new TemplateEnv(c.runtime_vars, (n: string) => c.env?.[n])
            const h = assembleHostedSystem(c.host_system, c.origin, env, c.sections, c.flavor, c.loop_model, c.tools, c.json)
            got = { system_prompt: h.system_prompt, runtime_protocol: h.runtime_protocol, template_vars: h.template_vars }
          } catch (e) {
            got = { error: errorOf(e) }
          }
          same(got, c.expect)
          return
        }
        default:
          throw new Error(`unknown fn ${c.fn}`)
      }
    })
  }
})

/** serde_json's own message texts are not portable: the two (b) cases that embed them only need an error. */
const SERDE_TEXT_CASES = new Set(['artifacts_must_be_strings', 'result_must_be_json'])

describe('vectors: xml_behavior', () => {
  for (const c of load('xml_behavior')) {
    test(c.name, () => {
      const content: any[] = []
      if (c.text !== undefined && c.text !== null && (c.text !== '' || !c.tool_calls)) content.push({ type: 'text', text: c.text })
      for (const t of c.tool_calls ?? []) content.push({ type: 'tool_use', call_id: t.call_id, name: t.name, args: t.args })
      if (content.length === 0) content.push({ type: 'text', text: '' })
      const response: AiResponse = { message: { role: 'assistant', content } }
      let got: any
      try {
        got = { result: new XllmActionParser(c.actions).parse(response) }
      } catch (e) {
        got = { error: e instanceof Error ? e.message : String(e) }
      }
      if (SERDE_TEXT_CASES.has(c.name)) {
        expect(Object.keys(got)).toEqual(['error'])
        expect(Object.keys(c.expect)).toEqual(['error'])
        return
      }
      same(got, c.expect)
    })
  }
})

describe('vectors: loop_scripts', () => {
  for (const c of load('loop_scripts')) {
    test(`${c.name} (${c.source})`, async () => {
      const script: any[] = c.script
      let i = 0
      let last: { messages: AiMessage[]; tools: string[] | null } | undefined
      const llm = {
        async infer(req: LlmInferenceRequest): Promise<AiResponse> {
          last = { messages: structuredClone(req.messages), tools: req.allow_tool_calls ? req.tool_specs.map(t => t.name) : null }
          const step = script[i++]
          if (!step) throw new LLMComputeException({ kind: 'internal', message: 'script exhausted' })
          if (step.error) throw new LLMComputeException(step.error)
          return step.response
        },
      }
      const dispatched: string[] = []
      const tools: ToolManager = {
        listToolSpecs: () => c.tools,
        async callTool(call) {
          dispatched.push(call.call_id)
          const r = c.tool_results?.[call.call_id]
          if (!r) return { kind: 'error', call_id: call.call_id, message: 'no scripted result' }
          if (r.dispatch_error) throw new ToolDispatchException(r.dispatch_error.message, r.dispatch_error.effect_unknown)
          return r.observation
        },
      }
      const deps: LLMContextDeps = { llm, tools }
      const b = c.behavior
      if (b) {
        deps.resultParser = new XllmActionParser(b.actions)
        deps.stepRenderer = b.renderer === 'timestamps' ? new XmlStepRenderer() : new XmlStepRenderer().withoutTimestamps()
      }
      let ctx: LLMContext
      if (b?.seed) {
        const state = stateFromRequest(c.request, 1)
        state.steps = b.seed.steps
        state.next_step_index = b.seed.next_step_index
        state.accumulated.push(...b.seed.inner_transcript)
        ctx = LLMContext.resume({ request: c.request, state }, { kind: 'resume_from_mid_run' }, deps)
      } else {
        ctx = new LLMContext(c.request, deps)
      }
      const outcome: LLMContextOutcome = await ctx.run()
      const o: any = { kind: outcome.kind }
      if (outcome.kind === 'budget_exhausted') o.which = outcome.which
      if (outcome.kind === 'context_limit_reached') o.which = outcome.which
      if (outcome.kind === 'error') {
        o.error = { kind: outcome.error.kind }
        if (outcome.error.kind === 'provider') o.error.failure = outcome.error.failure
      }
      if (outcome.kind === 'done') o.output_kind = outcome.output.kind
      const want = c.expect
      expect(o).toEqual(want.outcome)
      expect(i).toBe(want.inferences)
      expect(dispatched).toEqual(want.dispatched)
      const st = ctx.snapshot().state
      const state: any = { tool_iterations_left: st.tool_iterations_left, consecutive_errors: st.consecutive_errors, output_repairs: st.output_repairs ?? 0 }
      if (b) {
        Object.assign(state, {
          steps: (st.steps ?? []).length, last_step: st.last_step !== undefined, next_step_index: st.next_step_index, next_action_id: st.next_action_id,
        })
        const br = outcome.kind === 'done' ? outcome.behavior_result : undefined
        if (br) {
          const got: any = { report_end: br.report_end }
          if (br.self_report !== undefined) got.self_report = br.self_report
          if (br.next_behavior !== undefined) got.next_behavior = br.next_behavior
          if (br.report_result !== undefined) got.report_result = br.report_result
          same(got, want.behavior_result)
        } else {
          expect(want.behavior_result).toBeUndefined()
        }
        // The model's input, byte for byte.
        expect(canonicalJson(last?.messages)).toBe(canonicalJson(want.last_request_messages))
        same(last?.tools, want.last_request_tools)
      }
      same(state, want.state)
      const run = outcomeRunStatus(outcome, { max_tool_iterations: c.request.tool_policy.max_tool_iterations, timeout_secs: DEFAULT_TIMEOUT_SECS })
      same(run, want.run)
    })
  }
})

describe('vectors: compress', () => {
  const tokenizer = new ByteHeuristicTokenizer()
  for (const c of load('compress')) {
    test(`${c.name} (${c.fn})`, async () => {
      switch (c.fn) {
        case 'compress_history': {
          const calls: any[] = []
          const replies: string[] = c.replies
          const llm = {
            async infer(req: LlmInferenceRequest): Promise<AiResponse> {
              calls.push({
                model_alias: req.model_alias, max_completion_tokens: req.max_completion_tokens ?? null, force_json: req.force_json,
                json_schema: req.json_schema ?? null, allow_tool_calls: req.allow_tool_calls,
                system: textContent(req.messages[0]), user: textContent(req.messages[1]),
              })
              const text = replies[calls.length - 1]
              if (text === undefined) throw new LLMComputeException({ kind: 'internal', message: 'replies exhausted' })
              return { message: { role: 'assistant', content: [{ type: 'text', text }] } } as AiResponse
            },
          }
          const opts: any = { ...c.options }
          let out: any
          try {
            out = await compressHistory(c.history, { llm, tokenizer }, opts)
          } catch (e) {
            if (!(e instanceof LLMComputeException)) throw e
            expect(c.expect.error).toEqual({ kind: e.error.kind })
            same(calls, c.expect.calls)
            return
          }
          expect(c.expect.error).toBeUndefined()
          expect(canonicalJson(out.messages)).toBe(canonicalJson(c.expect.messages))
          expect([out.head_end, out.tail_start]).toEqual([c.expect.head_end, c.expect.tail_start])
          same(out.summary ?? null, c.expect.summary)
          same(out.memory_candidates, c.expect.memory_candidates)
          const { elapsed_ms: _elapsed, ...report } = out.report
          same(report, c.expect.report)
          for (const [k, call] of calls.entries()) {
            const want = c.expect.calls[k]
            expect(call.system).toBe(want.system)
            expect(call.user).toBe(want.user)
          }
          same(calls, c.expect.calls)
          return
        }
        case 'segment':
          same(segment(c.history, c.start), c.expect)
          return
        case 'summary_message': {
          const message = summaryMessage(c.summary, c.note ?? undefined)
          expect(canonicalJson(message)).toBe(canonicalJson(c.expect.message))
          same(parseSummaryMessage(message) ?? null, c.expect.parsed)
          return
        }
        case 'parse_summary_message':
          same(parseSummaryMessage(c.message) ?? null, c.expect)
          return
        case 'merge_keep_exact': {
          const keep: string[] = [...c.keep]
          const candidates: JsonValue[] = []
          mergeKeepExact(keep, c.new, tokenizer, candidates)
          same({ keep, candidates }, c.expect)
          return
        }
        default:
          throw new Error(`unknown compress vector fn ${c.fn}`)
      }
    })
  }
})

describe('vectors: provider_errors', () => {
  for (const c of load('provider_errors')) {
    const t = c.ts ? test : test.skip
    t(c.name, async () => {
      const input = c.input
      let failure: unknown
      if (input.kind === 'rpc_detailed' || input.kind === 'rpc_reason' || input.kind === 'rpc_http_status') {
        const err: any = new Error(input.message ?? `RPC call error: ${input.status}`)
        if (input.kind === 'rpc_detailed') {
          err.code = input.code
          err.data = input.data
        } else if (input.kind === 'rpc_http_status') {
          err.code = 'http_error'
          err.data = { status: input.status }
        }
        const e = providerErrorFromRpc('aicc call failed', err).error
        failure = e.kind === 'provider' ? e.failure : e.kind
      } else if (input.kind === 'aicc_response') {
        const client = new AiccLlmClient({ helperLlmChat: async () => input.response, chatCompletionsCreate: async () => input.response } as never)
        try {
          await client.infer({ messages: [], model_alias: 'llm.chat', fallbacks: [], force_json: false, disable_capabilities: [], tool_specs: [],
            allow_tool_calls: false, signal: new AbortController().signal })
          failure = undefined
        } catch (e) {
          const err = (e as LLMComputeException).error
          failure = err.kind === 'provider' ? err.failure : err.kind
        }
        if (c.expect.ok) {
          expect(failure).toBeUndefined()
          return
        }
      } else if (input.kind === 'openai_http') {
        failure = openaiHttpFailure(input.status, input.body)
      } else {
        throw new Error(`unknown input ${input.kind}`)
      }
      same({ failure }, c.expect)
    })
  }
})

describe('vectors: hints', () => {
  for (const c of load('hints')) {
    test(c.name, () => {
      const ledger = new MemoryHintLedger()
      for (const step of c.steps) {
        if (step.clear_dedup) {
          ledger.clear(HINT_NS_DEDUP)
          continue
        }
        const result = asToolResult(step.result)!
        const obs = envelopeObservation('c', result, applyHints(result, ledger))
        same({ kind: obs.kind, text: obs.kind === 'success' ? obs.content : obs.kind === 'error' ? obs.message : '' }, step.expect)
      }
      expect(ledger.keys(HINT_NS_ONCE)).toEqual(c.expect_once)
    })
  }
})

describe('vectors: task_text', () => {
  for (const c of load('task_text')) {
    test(c.name, () => {
      if (c.fn === 'general_hint') {
        expect(followupGeneralHint(c.followup)).toBe(c.expect)
        return
      }
      same(taskStateObservation(c.call_id, c.task_id, c.state, c.followup), c.expect)
    })
  }
})
