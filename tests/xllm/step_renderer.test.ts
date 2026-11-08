// Port of the unit tests of `agent_tool/src/step_record.rs`, plus exact-text
// cases whose expected strings come from the Rust renderer.
import { XmlStepRenderer, toolResultViewFromHost } from '../../src/xllm/runtime/step_renderer'
import { renderStepHistory } from '../../src/xllm/core/behavior_loop'
import { serdeJson } from '../../src/xllm/core/rust_text'
import { resultView } from '../../src/xllm/runtime/task_model'
import type { StepRenderer } from '../../src/xllm/core/deps'
import type { AiMessage, AiToolCall, JsonValue, Observation, StepRecord } from '../../src/xllm/core/types'

function stepRecord(patch: Partial<StepRecord> = {}): StepRecord {
  return { meta: { step_index: 0, started_at_ms: 0, compression_level: 'full' }, assistant_text: '', report_end: false, ...patch }
}

function withMeta(step: StepRecord, behavior: string, index: number): StepRecord {
  step.meta.behavior_name = behavior
  step.meta.step_index = index
  return step
}

function toolCall(name: string, id: string, args: Record<string, JsonValue> = {}): AiToolCall {
  return { name, args, call_id: id }
}

function success(callId: string, content: JsonValue, host?: JsonValue): Observation {
  const obs: Observation = { kind: 'success', call_id: callId, content, bytes: 0, truncated: false }
  if (host !== undefined) obs.host = host
  return obs
}

function plainText(msg: AiMessage): string {
  return msg.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('\n')
}

function assistantTextOf(msg: AiMessage): string {
  expect(msg.role).toBe('assistant')
  return plainText(msg)
}

function userTextOf(msg: AiMessage): string {
  expect(msg.role).toBe('user')
  return plainText(msg)
}

describe('XmlStepRenderer (step_record.rs)', () => {
  test('render_full_pair_preserves_assistant_text', () => {
    const step = stepRecord({
      assistant_text: '<intent>plan</intent><actions><shell>ls</shell></actions>',
      actions: [toolCall('shell', 'c-1')],
      action_results: [{ kind: 'success', call_id: 'c-1', content: 'ok', bytes: 2, truncated: false }],
    })
    const [a, u] = new XmlStepRenderer().render(step)
    expect(assistantTextOf(a)).toContain('<intent>plan</intent>')
    const text = userTextOf(u)
    expect(text.startsWith('<<last_step_action_results')).toBe(true)
    expect(text).toContain('behavior=""')
    expect(text).toContain('step="0"')
    expect(text).toContain('- Run shell')
    expect(text).toContain('```output\nok\n```')
  })

  test('step_without_action_renders_empty_results_wrapper', () => {
    const [, u] = new XmlStepRenderer().render(stepRecord({ assistant_text: 'just words' }))
    const text = userTextOf(u)
    expect(text.startsWith('<<last_step_action_results')).toBe(true)
    expect(text.endsWith('<</last_step_action_results>>')).toBe(true)
    expect(text).not.toContain('```output')
  })

  test('multiple_actions_render_as_step_action_results_wrapper', () => {
    const step = stepRecord({
      actions: [toolCall('shell', 'c-1'), toolCall('write_file', 'c-2')],
      action_results: [success('c-1', 'first'), success('c-2', 'second')],
    })
    const text = userTextOf(new XmlStepRenderer().render(step)[1])
    expect(text.startsWith('<<last_step_action_results')).toBe(true)
    expect(text.endsWith('<</last_step_action_results>>')).toBe(true)
    const i1 = text.indexOf('- Run shell')
    const i2 = text.indexOf('Run write_file')
    expect(i1).toBeGreaterThanOrEqual(0)
    expect(i2).toBeGreaterThan(i1)
  })

  test('step_record_renders_action_ids_only_in_result_wrapper', () => {
    const step = stepRecord({
      assistant_text: '<response><actions><shell>ls</shell><read uri="src/lib.rs"/></actions></response>',
      actions: [toolCall('shell', '1', { command: 'ls' }), toolCall('read', '2', { uri: 'src/lib.rs' })],
      action_results: [success('1', 'listed'), success('2', 'file body')],
    })
    const [a, u] = new XmlStepRenderer().render(step)
    const assistant = assistantTextOf(a)
    expect(assistant).toContain('<shell>ls</shell>')
    expect(assistant).toContain('<read uri="src/lib.rs"/>')
    expect(assistant).not.toContain('call_id=')
    const user = userTextOf(u)
    expect(user).toContain('- #1 Run ls')
    expect(user).toContain('- #2 Run read src/lib.rs')
  })

  test('render_history_does_not_render_action_ids', () => {
    const step = withMeta(stepRecord({
      actions: [toolCall('shell', '1', { command: 'ls' })],
      action_results: [success('1', 'listed')],
    }), 'plan', 1)
    const msgs = new XmlStepRenderer().renderHistory([step], 'do', [])
    const history = plainText(msgs[0])
    expect(history).toContain('- Run ls')
    expect(history).not.toContain('- #1 Run ls')
  })

  test('write_file_command_omits_content_body', () => {
    const step = withMeta(stepRecord({
      actions: [toolCall('write_file', 'c-2', { path: 'demo.txt', mode: 'write', content: 'large body should not appear in action cmd' })],
      action_results: [success('c-2', 'wrote 10 bytes')],
    }), 'do', 1)
    const text = userTextOf(new XmlStepRenderer().render(step)[1])
    expect(text).toContain('<<last_step_action_results behavior="do" step="1">>')
    expect(text).toContain('- Run write_file demo.txt mode=write')
    expect(text).toContain('wrote 10 bytes')
    expect(text).not.toContain('large body should not appear in action cmd')
  })

  test('self_report_does_not_add_action_result', () => {
    const text = userTextOf(new XmlStepRenderer().render(stepRecord({ self_report: 'checkpoint' }))[1])
    expect(text.startsWith('<<last_step_action_results')).toBe(true)
    expect(text).not.toContain('```output')
  })

  test('inherited_self_report_renders_as_report_not_action', () => {
    const renderer = new XmlStepRenderer()
    const step = withMeta(stepRecord({ self_report: 'checkpoint <T01>' }), 'plan', 0)
    const msgs = renderer.renderHistory([step], 'do', [])
    expect(msgs).toHaveLength(1)
    const inherited = plainText(msgs[0])
    expect(inherited).toContain('<report end="false">checkpoint &lt;T01&gt;</report>\n<actions>')
    expect(inherited).toContain('<actions>\nNo action.\n</actions>')
    expect(inherited).not.toContain('Report acknowledged')
    expect(inherited).not.toContain('- Report')

    const plain = withMeta(stepRecord({ thought: 'no report here' }), 'plan', 0)
    expect(plainText(renderer.renderHistory([plain], 'do', [])[0])).not.toContain('<report')
  })

  test('error_result_carries_message', () => {
    const step = stepRecord({
      actions: [toolCall('shell', 'c-9')],
      action_results: [{ kind: 'error', call_id: 'c-9', message: 'permission denied' }],
    })
    const text = userTextOf(new XmlStepRenderer().render(step)[1])
    expect(text).toContain('Error:')
    expect(text).toContain('permission denied')
  })

  test('unpaired_error_result_is_rendered', () => {
    const step = stepRecord({ action_results: [{ kind: 'error', call_id: '', message: 'parse failed' }] })
    const text = userTextOf(new XmlStepRenderer().render(step)[1])
    expect(text).toContain('- Step error')
    expect(text).toContain('Error: parse failed')
  })

  test('json_content_is_stringified', () => {
    const step = stepRecord({ actions: [toolCall('read', 'q-1')], action_results: [success('q-1', { rows: 3 })] })
    expect(userTextOf(new XmlStepRenderer().render(step)[1])).toContain('{"rows":3}')
  })

  test('xml_special_chars_in_body_are_not_escaped', () => {
    const step = stepRecord({ actions: [toolCall('shell', 'e-1')], action_results: [success('e-1', '<b>not html</b> & friends')] })
    expect(userTextOf(new XmlStepRenderer().render(step)[1])).toContain('<b>not html</b> & friends')
  })

  test('protocol_tool_result_full_uses_title_and_output', () => {
    const step = stepRecord({
      actions: [toolCall('custom_tool', '1')],
      action_results: [success('t-1', 'legacy fallback should not render', resultView({
        status: 'success', cmd_name: 'custom_tool', cmd_args: 'target --verbose', title: 'custom tool completed',
        summary: 'short protocol summary', output: 'protocol output body',
      }))],
    })
    const text = userTextOf(new XmlStepRenderer().render(step)[1])
    expect(text).toContain('- #1 custom tool completed')
    expect(text).toContain('```output\nprotocol output body\n```')
    expect(text).not.toContain('target --verbose')
    expect(text).not.toContain('legacy fallback should not render')
  })

  test('protocol_tool_result_full_renders_structured_detail_as_json', () => {
    const step = stepRecord({
      actions: [toolCall('read_file', '2')],
      action_results: [success('2', 'legacy fallback should not render', resultView({
        status: 'success', cmd_name: 'read_file', cmd_args: 'HUGE_CMD_ARGS_SHOULD_NOT_RENDER', title: 'read completed',
        summary: 'Read 20 lines from demo.txt.', detail: { path: 'demo.txt', content: 'line 1' },
      }))],
    })
    const text = userTextOf(new XmlStepRenderer().render(step)[1])
    expect(text).toContain('- #2 read completed')
    expect(text).toContain('```output\n{')
    expect(text).toContain('"content": "line 1"')
    expect(text).not.toContain('HUGE_CMD_ARGS_SHOULD_NOT_RENDER')
    expect(text).not.toContain('legacy fallback should not render')
  })

  test('inherited_protocol_tool_result_uses_summary_not_detail', () => {
    const step = withMeta(stepRecord({
      actions: [toolCall('custom_tool', 't-2')],
      action_results: [success('t-2', 'legacy fallback should not render', resultView({
        status: 'success', title: 'custom_tool => success', summary: 'compact protocol summary',
        output: 'full protocol output should not render', detail: { large: 'detail should not render' },
      }))],
    }), 'plan', 0)
    const history = plainText(new XmlStepRenderer().renderHistory([step], 'do', [])[0])
    expect(history).toContain('- custom_tool => success')
    expect(history).toContain('compact protocol summary')
    expect(history).not.toContain('full protocol output should not render')
    expect(history).not.toContain('detail should not render')
  })

  test('history_without_timestamps_is_stable', () => {
    const step = withMeta(stepRecord({ assistant_text: '<intent>t</intent>' }), 'plan', 0)
    step.meta.started_at_ms = 123
    step.meta.ended_at_ms = 456
    const withTimes = new XmlStepRenderer().renderHistory([structuredClone(step)], 'do', [])
    expect(plainText(withTimes[0])).toContain('started_at_ms="123"')
    const r = new XmlStepRenderer().withoutTimestamps()
    const a = r.renderHistory([structuredClone(step)], 'do', [])
    step.meta.started_at_ms = 999
    step.meta.ended_at_ms = 1000
    const b = r.renderHistory([step], 'do', [])
    expect(plainText(a[0])).toBe(plainText(b[0]))
    expect(plainText(a[0])).not.toContain('started_at_ms')
  })

  test('observation_deserializes_success_without_host', () => {
    const obs = JSON.parse('{"kind":"success","call_id":"old","content":"ok","bytes":2,"truncated":false}') as Observation
    expect(obs.kind === 'success' && obs.host).toBeUndefined()
    expect(toolResultViewFromHost(undefined)).toBeUndefined()
    const step = stepRecord({ actions: [toolCall('shell', 'old')], action_results: [obs] })
    expect(userTextOf(new XmlStepRenderer().render(step)[1])).toContain('- Run shell\n\n```output\nok\n```')
  })

  test('render_history_keeps_current_behavior_steps_full_when_older', () => {
    const renderer = new XmlStepRenderer({ summaryChars: 20, maxResultChars: 0, timestamps: true })
    const makeStep = (idx: number, body: string) => stepRecord({
      assistant_text: `<intent>thought-${idx}</intent><actions><shell>t</shell></actions>`,
      thought: `thought-${idx}`,
      actions: [toolCall('shell', `c-${idx}`)],
      action_results: [{ kind: 'success', call_id: `c-${idx}`, content: body, bytes: body.length, truncated: false }],
    })
    const msgs = renderer.renderHistory([makeStep(0, 'old body, should compress'), makeStep(1, 'newest body, full')], '', [])
    expect(msgs).toHaveLength(4)
    // Step 0 is older, but current-behavior history stays full so adding
    // Step 1 appends messages instead of rewriting the prefix.
    expect(plainText(msgs[0])).toContain('<shell>t</shell>')
    expect(plainText(msgs[1])).toContain('old body, should compress')
    expect(plainText(msgs[2])).toContain('<shell>t</shell>')
  })

  test('render_history_appends_new_current_step_without_rewriting_prefix', () => {
    const renderer = new XmlStepRenderer()
    const makeStep = (idx: number) => withMeta(stepRecord({
      assistant_text: `<intent>thought-${idx}</intent><actions><shell>cmd-${idx}</shell></actions>`,
      thought: `thought-${idx}`,
      actions: [toolCall('shell', `c-${idx}`)],
      action_results: [{ kind: 'success', call_id: `c-${idx}`, content: `result-${idx}`, bytes: 8, truncated: false }],
    }), 'execute', idx)
    const prefix = renderer.renderHistory([makeStep(0), makeStep(1)], 'execute', [])
    const extended = renderer.renderHistory([makeStep(0), makeStep(1), makeStep(2)], 'execute', [])
    expect(extended).toHaveLength(prefix.length + 2)
    expect(extended.slice(0, prefix.length)).toEqual(prefix)
    expect(plainText(extended[4])).toContain('<shell>cmd-2</shell>')
    expect(plainText(extended[5])).toContain('result-2')
  })

  test('alternation_is_preserved', () => {
    const makeStep = (idx: number) => stepRecord({
      assistant_text: `turn-${idx}`,
      actions: [toolCall('shell', `c-${idx}`)],
      action_results: [{ kind: 'success', call_id: `c-${idx}`, content: 'ok', bytes: 2, truncated: false }],
    })
    const msgs = new XmlStepRenderer().renderHistory([makeStep(0), makeStep(1), makeStep(2)], '', [])
    msgs.forEach((msg, idx) => expect(msg.role).toBe(idx % 2 === 0 ? 'assistant' : 'user'))
  })

  test('inherited_behavior_steps_render_as_single_history_records', () => {
    const renderer = new XmlStepRenderer({ summaryChars: 20, maxResultChars: 0, timestamps: true })
    const makeStep = (behavior: string, idx: number) => withMeta(stepRecord({
      assistant_text: `<intent>${behavior}-${idx}</intent>`,
      observation: `observed-${behavior}-${idx} <raw>`,
      thought: `${behavior}-${idx} <thought>`,
      actions: [toolCall('shell', `c-${idx}`, { command: 'ls <raw>' })],
      action_results: [{ kind: 'success', call_id: `c-${idx}`, content: '<raw output>', bytes: 12, truncated: false }],
    }), behavior, idx)
    const msgs = renderer.renderHistory([makeStep('plan', 0), makeStep('execute', 1)], 'execute', [])
    expect(msgs).toHaveLength(3)
    expect(msgs[0].role).toBe('user')
    const inherited = plainText(msgs[0])
    expect(inherited).toContain('<step_record')
    expect(inherited).not.toContain('<history_step')
    expect(inherited).toContain('behavior="plan"')
    expect(inherited).toContain('<observation>observed-plan-0 <raw></observation>')
    expect(inherited).toContain('<intent>plan-0 <thought></intent>')
    expect(inherited).toContain('<actions>')
    expect(inherited).toContain('- Run ls <raw>')
    expect(inherited).toContain('```output\n<raw output>\n```')
    expect(msgs[1].role).toBe('assistant')
    expect(msgs[2].role).toBe('user')
  })
})

// Expected texts below were produced by the Rust `XmlStepRenderer` from the same inputs.
describe('XmlStepRenderer exact text', () => {
  test('envelope results: pending, error with return code, hints, unpaired', () => {
    const step = withMeta(stepRecord({
      actions: [
        toolCall('fetch', '7', { url: 'https://example.com/a b', retries: 3, opts: { '10': true, '9': false, z: 1.5 } }),
        toolCall('shell', '8', { command: '  make   test  ' }),
        toolCall('edit_file', 'x-1', { path: ' src/a.ts ', old_string: 'const  a =\n 1' }),
      ],
      action_results: [
        success('7', 'ignored', resultView({
          status: 'pending', summary: '  downloading  ', task_id: 'task-42', pending_reason: 'slow mirror', check_after: 30,
          partial_output: '\n12%\n', hints: [{ text: '  wait with wait_task  ' }, { text: '   ' }],
        })),
        { kind: 'error', call_id: '8', message: 'ignored', host: resultView({ status: 'error', summary: '', output: 'make: *** [test] Error 2\n', return_code: 2 }) },
        { kind: 'cancelled', call_id: 'x-1', reason: 'interrupted by the user', effect_unknown: true },
      ],
    }), 'do <it>', 3)
    step.action_results?.push({ kind: 'unresolved', call_id: '', reason: '', effect_unknown: false })
    const text = userTextOf(new XmlStepRenderer().render(step)[1])
    expect(text).toBe(
      '<<last_step_action_results behavior="do &lt;it&gt;" step="3">>\n' +
      '- #7 Run fetch opts={"10":true,"9":false,"z":1.5} retries=3 url=https://example.com/a b\n\n' +
      '```output\ndownloading\ntask_id=task-42\npending_reason=slow mirror\ncheck_after=30\npartial_output:\n12%\n```\n' +
      '<runtime_hints>\n- wait with wait_task\n</runtime_hints>\n' +
      '- #8 Run make test\n\n' +
      '```output\nmake: *** [test] Error 2\n```\n' +
      '- Run edit_file src/a.ts old_string="const a = 1"\n\n' +
      '```output\nCancelled (result unknown): interrupted by the user\n```\n' +
      '- Step result\n\n' +
      '```output\nNot executed\n```\n' +
      '\n<</last_step_action_results>>')
  })

  test('inherited record with timestamps, report and compact envelope results', () => {
    const step = withMeta(stepRecord({
      assistant_text: '  fallback intent  ',
      observation: ' saw <x> ',
      self_report: ' half done & <ok> ',
      report_end: true,
      actions: [toolCall('read', '1', { path: 'notes.md', range: [1, 20] }), toolCall('shell', '2', { command: 'ls' })],
      action_results: [
        success('1', 'body', resultView({ status: 'success', title: '', summary: '', cmd_name: 'read', cmd_args: ' notes.md ' })),
        { kind: 'error', call_id: '2', message: 'x'.repeat(600) },
      ],
    }), 'plan', 4)
    step.meta.started_at_ms = 1700000000000
    step.meta.compression_level = 'compact'
    expect(plainText(new XmlStepRenderer().renderInherited(step))).toBe(
      '<step_record behavior="plan" index="4" started_at_ms="1700000000000" ended_at_ms="" compression="compact">\n' +
      '<observation>saw <x></observation>\n<intent>fallback intent</intent>\n' +
      '<report end="true">half done &amp; &lt;ok&gt;</report>\n' +
      '<actions>\n- read notes.md\n\n```output\nSuccess\n```\n\n' +
      `- Run ls\n\n\`\`\`output\nError: ${'x'.repeat(512)}...\n\`\`\`\n</actions>\n</step_record>`)
  })

  test('history message folds summaries and inherited steps', () => {
    const summary = {
      step_count: 3, start_step_index: 0, end_step_index: 2, started_at_ms: 10, ended_at_ms: 20,
      behavior_names: ['plan', "o'k"], summary: 'did <a> & "b"',
    }
    const inherited = withMeta(stepRecord({ thought: 'think' }), 'plan', 3)
    const current = withMeta(stepRecord({ assistant_text: 'A' }), 'do', 4)
    const msgs = new XmlStepRenderer().withoutTimestamps().renderHistory([inherited, current], 'do', [summary])
    expect(msgs).toHaveLength(3)
    expect(plainText(msgs[0])).toBe(
      '<<step_history>>\n' +
      '<history_summary steps="0..2" count="3" behaviors="plan,o&apos;k">did &lt;a&gt; &amp; &quot;b&quot;</history_summary>\n' +
      '<step_record behavior="plan" index="3" compression="full">\n<observation></observation>\n<intent>think</intent>\n' +
      '<actions>\nNo action.\n</actions>\n</step_record>\n<</step_history>>')
    expect(plainText(new XmlStepRenderer().renderSummary(summary))).toBe(
      '<history_summary steps="0..2" count="3" started_at_ms="10" ended_at_ms="20" behaviors="plan,o&apos;k">did &lt;a&gt; &amp; &quot;b&quot;</history_summary>')
  })

  test('renderStepHistory uses the trait defaults for a renderer without its own', () => {
    const xml = new XmlStepRenderer()
    const renderer: StepRenderer = { render: step => xml.render(step) }
    const summary = { step_count: 1, start_step_index: 0, end_step_index: 0, started_at_ms: 0, ended_at_ms: 0, behavior_names: ['a', 'b'], summary: 'S' }
    const inherited = withMeta(stepRecord({ assistant_text: '  text  ', thought: '  ' }), 'plan', 1)
    const msgs = renderStepHistory(renderer, [inherited, withMeta(stepRecord({ assistant_text: 'A' }), 'do', 2)], 'do', [summary])
    expect(msgs.map(plainText)).toEqual([
      'history summary:\nsteps: 0..0\ncount: 1\nbehaviors: a, b\nsummary: S',
      'history step record:\nbehavior: plan\nindex: 1\nsummary: text',
      'A',
      '<<last_step_action_results behavior="do" step="2">>\n\n<</last_step_action_results>>',
    ])
    expect(renderStepHistory(xml, [inherited], 'do', [])).toEqual(xml.renderHistory([inherited], 'do', []))
  })

  test('clipping counts chars and trims with Rust whitespace', () => {
    const renderer = new XmlStepRenderer({ maxResultChars: 5 })
    const step = stepRecord({
      actions: [toolCall('shell', '1'), toolCall('shell', '2')],
      action_results: [success('1', '😀😀😀😀\u0085😀😀'), success('2', 'ab﻿\u0085')],
    })
    expect(userTextOf(renderer.render(step)[1])).toBe(
      '<<last_step_action_results behavior="" step="0">>\n' +
      '- #1 Run shell\n\n```output\n😀😀😀😀...\n[truncated]\n```\n' +
      '- #2 Run shell\n\n```output\nab﻿\n```\n' +
      '\n<</last_step_action_results>>')
  })

  test('JSON is written as serde_json writes it', () => {
    const value = { b: [1, 0.1, 1e21, 0.000001, 0.00001, 2.5e-7, -3, 1e300, 123456.789], '10': {}, '9': [], a: 'é"\n', 'é': null, z: 1e16 }
    expect(serdeJson(value)).toBe(
      '{"10":{},"9":[],"a":"é\\"\\n","b":[1,0.1,1e+21,1e-6,0.00001,2.5e-7,-3,1e+300,123456.789],"z":10000000000000000,"é":null}')
    expect(serdeJson({ a: [1, { b: 2 }], c: {} }, true)).toBe('{\n  "a": [\n    1,\n    {\n      "b": 2\n    }\n  ],\n  "c": {}\n}')
  })

  test('a host of the wrong shape is not read as a result view', () => {
    expect(toolResultViewFromHost({})).toMatchObject({ status: 'success', title: '', summary: '', hints: [] })
    expect(toolResultViewFromHost({ status: null })).toBeUndefined()
    expect(toolResultViewFromHost({ title: 5 })).toBeUndefined()
    expect(toolResultViewFromHost({ return_code: 1.5 })).toBeUndefined()
    expect(toolResultViewFromHost({ check_after: -1 })).toBeUndefined()
    expect(toolResultViewFromHost({ hints: [{ text: null }] })).toBeUndefined()
    expect(toolResultViewFromHost({ detail: {}, cmd_name: null })).toMatchObject({ detail: undefined, cmd_name: undefined })
    expect(toolResultViewFromHost('text')).toBeUndefined()
  })
})
