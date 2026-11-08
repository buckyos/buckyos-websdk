// The page's existing data layer: a small REST-style client over its notes
// (in memory, kept in localStorage so a reload keeps them). Both versions of
// the page use it unchanged.

export interface Note {
  id: string
  title: string
  body: string
  tags: string[]
  version: number
}

const KEY = 'xllm-site.notes'

function load(): Note[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    // no storage: start empty
  }
  return [
    { id: '1', title: 'Groceries', body: 'milk\neggs', tags: ['home'], version: 1 },
    { id: '2', title: 'Release plan', body: 'freeze on Friday', tags: ['work'], version: 1 },
  ]
}

let notes: Note[] = load()
const listeners: (() => void)[] = []

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(notes))
  } catch {
    // ignore
  }
  listeners.forEach(f => f())
}

export const notesApi = {
  onChange(f: () => void) {
    listeners.push(f)
  },
  reset() {
    try {
      localStorage.removeItem(KEY)
    } catch {
      // ignore
    }
    notes = load()
    save()
  },
  /** GET /notes?tag= */
  list(tag?: string | null): Note[] {
    return notes.filter(n => !tag || n.tags.includes(tag)).map(n => ({ ...n }))
  },
  /** GET /notes/:id */
  get(id: string): Note {
    const n = notes.find(x => x.id === id)
    if (!n) throw new Error(`note ${id} does not exist`)
    return { ...n }
  },
  /** POST /notes */
  create(title: string, body: string): Note {
    const id = String(Math.max(0, ...notes.map(n => Number(n.id))) + 1)
    const n = { id, title, body, tags: [], version: 1 }
    notes.push(n)
    save()
    return { ...n }
  },
  /** PUT /notes/:id (If-Match: version) */
  update(id: string, body: string, ifVersion?: number): Note {
    const n = notes.find(x => x.id === id)
    if (!n) throw new Error(`note ${id} does not exist`)
    if (ifVersion !== undefined && ifVersion !== n.version) throw new Error(`note ${id} changed (version ${n.version}); read it again`)
    n.body = body
    n.version += 1
    save()
    return { ...n }
  },
  /** DELETE /notes/:id */
  remove(id: string) {
    notes = notes.filter(n => n.id !== id)
    save()
  },
  /** An old-style RPC the page already has: not REST, it becomes a command. */
  exportMarkdown(tag?: string | null): string {
    return notesApi.list(tag).map(n => `# ${n.title}\n\n${n.body}`).join('\n\n')
  },
}
