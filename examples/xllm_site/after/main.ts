import { notesApi } from '../notes_api'

let current: string | undefined

function render() {
  const list = document.getElementById('list') as HTMLUListElement
  list.innerHTML = ''
  for (const n of notesApi.list()) {
    const li = document.createElement('li')
    li.textContent = n.title
    li.dataset.id = n.id
    li.onclick = () => select(n.id)
    list.appendChild(li)
  }
  if (current && notesApi.list().some(n => n.id === current)) select(current)
}

function select(id: string) {
  current = id
  const n = notesApi.get(id)
  ;(document.getElementById('title') as HTMLElement).textContent = n.title
  ;(document.getElementById('body') as HTMLTextAreaElement).value = n.body
}

document.getElementById('save')?.addEventListener('click', () => {
  if (current) notesApi.update(current, (document.getElementById('body') as HTMLTextAreaElement).value)
})
document.getElementById('delete')?.addEventListener('click', () => {
  if (current) notesApi.remove(current)
  current = undefined
})
document.getElementById('export')?.addEventListener('click', () => {
  ;(document.getElementById('exported') as HTMLElement).textContent = notesApi.exportMarkdown()
})

notesApi.onChange(render)
render()

// ---------------------------------------------------------------- the agent
// The same notesApi the buttons call, declared as resources, an action and a
// command; the agent works through them under the page's session.

import { AiccLlmClient, IndexedDbRunStore, XllmRun, XllmTask, createSiteRuntime, siteTools } from 'buckyos/xllm'
import type { JsonValue, LlmClient, RunEvent, XllmDeps } from 'buckyos/xllm'
import { ScriptedLlmClient } from 'buckyos/xllm/dev'

const tools = siteTools({
  resources: {
    notes: { description: 'All notes (id, title, tags); filter with ?tag=', read: ({ query }) => notesApi.list(query.get('tag')).map(({ id, title, tags }) => ({ id, title, tags })) },
    'notes/{id}': {
      description: 'One note: its body',
      read: ({ params }) => {
        const n = notesApi.get(params.id)
        return { content: n.body, version: String(n.version) }
      },
      write: ({ params }, { content, mode, ifVersion }) => {
        const n = notesApi.get(params.id)
        notesApi.update(params.id, mode === 'append' ? n.body + content : content, ifVersion === undefined ? undefined : Number(ifVersion))
        return 'saved'
      },
      actions: {
        delete: { description: 'Delete this note', risk: 'destructive', input: { type: 'object', properties: {} }, call: ({ params }) => { notesApi.remove(params.id); return 'deleted' } },
      },
    },
  },
  commands: {
    'notes-export': {
      summary: 'Export notes as one markdown document',
      options: [{ name: 'tag', type: 'string', description: 'Only notes with this tag' }],
      access: { mode: 'fixed', level: 'read' },
      call: ({ tag }) => notesApi.exportMarkdown(tag as string | undefined),
    },
  },
})
const runtime = createSiteRuntime({ scene: 'demo.site.notes', origin: location.origin, hostname: location.hostname, tools })
const store = new IndexedDbRunStore({ dbName: 'xllm-site-demo' })
const LLM_CONTEXT: JsonValue = { model: 'llm.chat', max_tool_iterations: 10, tools: { enabled: true } }
const SYSTEM = 'You work on the user\'s notes in this page. Start with read uri="/". Use edit for small changes.'
const params = new URLSearchParams(location.search)

const events = document.getElementById('events') as HTMLOListElement
const observer = {
  onEvent(_id: string, e: RunEvent) {
    const li = document.createElement('li')
    li.textContent = e.kind === 'tool_started' ? `→ ${e.name}` : e.kind === 'tool_finished' ? `← ${e.name} ${e.ok ? 'ok' : 'failed'}` : e.kind
    events.appendChild(li)
  },
}
function setStatus(state: string, text = state) {
  const s = document.getElementById('status') as HTMLElement
  s.setAttribute('data-state', state)
  s.textContent = text
}

async function model(script: ConstructorParameters<typeof ScriptedLlmClient>[0]): Promise<LlmClient> {
  if (params.get('llm') !== 'aicc') return new ScriptedLlmClient(script)
  const { initBuckyOS, login, buckyos } = await import('buckyos/browser')
  await initBuckyOS(params.get('appid') ?? 'buckyos-systest')
  await login()
  return new AiccLlmClient(buckyos.getAiccClient())
}

let run: XllmRun | undefined
document.getElementById('stop')?.addEventListener('click', () => run?.interrupter().interrupt('stopped from the page'))
document.getElementById('run')?.addEventListener('click', async () => {
  const deps: XllmDeps = { llm: await model([]), runtime, store, observer, hostPromptSections: 'NONE' }
  run = await XllmRun.start(await XllmTask.prepareHosted(LLM_CONTEXT, 'notes', SYSTEM, deps), deps,
    { input: (document.getElementById('ask') as HTMLInputElement).value })
  const out = await run.execute()
  ;(document.getElementById('result') as HTMLElement).textContent = `${out.status}\n${out.record.result?.raw ?? out.record.last_error?.message ?? ''}`
})

// On load: a run this page left unfinished (a reload, a crash) continues.
async function resumeLeftover(llm: LlmClient) {
  for (const rec of await store.listRecords()) {
    if (rec.status === 'completed' || rec.status === 'failed' || rec.status === 'limit_reached') continue
    const start = await XllmRun.resume(store, rec.run_id, {}, { llm, runtime, store, observer })
    if (start.kind === 'run') {
      run = start.run
      return start.run.execute()
    }
  }
  return undefined
}
export { resumeLeftover, runtime, store, tools }

if (params.get('auto')) {
  void import('./auto').then(m => m.auto(params.get('auto') as string, { model, runtime, store, observer, setStatus, resumeLeftover, SYSTEM, LLM_CONTEXT }))
} else setStatus('ready')
