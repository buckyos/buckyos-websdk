// Test driver of the after/ page (`?auto=accept` / `?auto=reload`), used by
// tests/browser/xllm/site.spec.js. It shows the four M5 points with a
// scripted model: one set of declarations for people and the agent; the
// page shows what the agent did; the agent sees what a person changed
// mid-run; a person can stop it. And a run survives a reload of the page.

import { XllmRun, XllmTask } from 'buckyos/xllm'
import type { JsonValue, LlmClient, RunOutcome, RunObserver, SiteRuntime, XllmDeps } from 'buckyos/xllm'
import type { IndexedDbRunStore } from 'buckyos/xllm'
import { ScriptedLlmClient } from 'buckyos/xllm/dev'
import { notesApi } from '../notes_api'

interface Page {
  model(script: ConstructorParameters<typeof ScriptedLlmClient>[0]): Promise<LlmClient>
  runtime: SiteRuntime
  store: IndexedDbRunStore
  observer: RunObserver
  setStatus(state: string, text?: string): void
  resumeLeftover(llm: LlmClient): Promise<RunOutcome | undefined>
  SYSTEM: string
  LLM_CONTEXT: JsonValue
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
function check(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}
const call = (name: string, args: Record<string, JsonValue>) => ({ tool_calls: [{ name, args }] })

function toolTexts(llm: ScriptedLlmClient, i: number): string[] {
  return llm.requests[i].messages.filter(m => m.role === 'tool').map(m => {
    const b = m.content[0]
    return b.type === 'tool_result' && b.content[0].type === 'text' ? b.content[0].text : ''
  })
}

async function accept(p: Page): Promise<string[]> {
  notesApi.reset()
  ;(document.querySelector('#list li[data-id="2"]') as HTMLElement).click()
  const humanEdit = () => {
    const body = document.getElementById('body') as HTMLTextAreaElement
    body.value = 'freeze on Friday (moved to Monday)'
    ;(document.getElementById('save') as HTMLButtonElement).click()
  }
  const llm = new ScriptedLlmClient([
    call('read', { uri: '/' }),
    call('read', { uri: 'notes?tag=work' }),
    call('read', { uri: 'notes/2' }),
    () => {
      humanEdit()
      return call('read', { uri: 'notes/2' })
    },
    call('edit', { uri: 'notes/2', old_string: '(moved to Monday)', new_string: '(moved to Monday)\nstatus: on track' }),
    call('exec', { command: 'notes-export --tag work' }),
    call('exec', { command: 'xcall notes/1 delete' }),
    { text: 'Done: release plan updated and exported; groceries deleted.' },
  ])
  const deps: XllmDeps = { llm, runtime: p.runtime, store: p.store, observer: p.observer, hostPromptSections: 'NONE' }
  const run = await XllmRun.start(await XllmTask.prepareHosted(p.LLM_CONTEXT, 'notes', p.SYSTEM, deps), deps, { input: 'Update the release plan.' })
  const out = await run.execute()
  check(out.status === 'completed', `run ${out.status}`)
  const lines: string[] = []
  // 1. people and the agent use one set of declarations: the agent's delete is the page's notesApi.remove
  check(!notesApi.list().some(n => n.id === '1'), 'note 1 deleted through the declared action')
  lines.push('same declarations: xcall notes/1 delete removed the note the Delete button removes')
  // 2. the page shows what the agent did
  check(!document.querySelector('#list li[data-id="1"]'), 'the list no longer shows note 1')
  check((document.getElementById('body') as HTMLTextAreaElement).value.endsWith('status: on track'), 'the open note shows the agent edit')
  check(document.querySelectorAll('#events li').length > 0, 'events shown')
  lines.push('visible: list and open note re-rendered, events listed')
  // 3. the agent saw what the person changed mid-run
  const seen = toolTexts(llm, 4)
  check(seen[seen.length - 1] === 'freeze on Friday (moved to Monday)', `agent read ${seen[seen.length - 1]}`)
  const exported = toolTexts(llm, 6).pop() ?? ''
  check(exported.includes('status: on track'), 'export has the edit')
  lines.push('the agent read the human edit before editing; the edit kept it')
  // 4. a person can stop it at any time
  const hold = new ScriptedLlmClient([{ hang: true }])
  const deps2: XllmDeps = { llm: hold, runtime: p.runtime, store: p.store, observer: p.observer, hostPromptSections: 'NONE' }
  const run2 = await XllmRun.start(await XllmTask.prepareHosted(p.LLM_CONTEXT, 'notes', p.SYSTEM, deps2), deps2, { input: 'Anything.' })
  const pending = run2.execute()
  await sleep(50)
  run2.interrupter().interrupt('stopped from the page')
  check((await pending).status === 'interrupted', 'stopped')
  lines.push('stop: interrupted from the page')
  return lines
}

export async function auto(mode: string, p: Page) {
  p.setStatus('running')
  const result = document.getElementById('result') as HTMLElement
  try {
    if (mode === 'accept') {
      const lines = await accept(p)
      result.textContent = JSON.stringify({ passed: true, lines }, null, 2)
      p.setStatus('passed')
      return
    }
    if (mode === 'reload') {
      if (sessionStorage.getItem('xllm-site.reload') === 'started') {
        const out = await p.resumeLeftover(new ScriptedLlmClient([{ text: 'finished after the reload' }]))
        check(out?.status === 'completed', `resumed run ${out?.status}`)
        check(out?.record.result?.raw === 'finished after the reload', 'its result')
        result.textContent = JSON.stringify({ passed: true, run_id: out?.record.run_id, llm_requests: out?.record.usage.llm_requests })
        p.setStatus('passed')
        return
      }
      notesApi.reset()
      const llm = new ScriptedLlmClient([call('read', { uri: 'notes' }), { hang: true }])
      const deps: XllmDeps = { llm, runtime: p.runtime, store: p.store, observer: p.observer, hostPromptSections: 'NONE' }
      const run = await XllmRun.start(await XllmTask.prepareHosted(p.LLM_CONTEXT, 'notes', p.SYSTEM, deps), deps, { input: 'List my notes.' })
      void run.execute()
      while (llm.calls < 2) await sleep(10)
      sessionStorage.setItem('xllm-site.reload', 'started')
      p.setStatus('reload-me')
      return
    }
    throw new Error(`unknown auto mode ${mode}`)
  } catch (e) {
    result.textContent = JSON.stringify({ passed: false, error: e instanceof Error ? e.stack ?? e.message : String(e) })
    p.setStatus('failed')
  }
}
