import { siteTools, normalizeUri, pageText, MAX_RESULT_BYTES } from '../../src/xllm/runtime/site_tools'
import type { ResourceMatch, WriteBody } from '../../src/xllm/runtime/site_tools'
import type { SiteToolCtx } from '../../src/xllm/runtime/types'

const ctx: SiteToolCtx = { run_id: 'r', call_id: 'c', signal: new AbortController().signal }

function notesSite() {
  const notes = new Map<string, { text: string; version: number; tags: string[] }>([
    ['1', { text: 'alpha beta', version: 1, tags: ['work'] }],
    ['2', { text: 'gamma', version: 3, tags: [] }],
  ])
  const writes: WriteBody[] = []
  const calls: string[] = []
  const tools = siteTools({
    resources: {
      notes: {
        description: 'All notes, supports ?tag=',
        read: ({ query }: ResourceMatch) => [...notes].filter(([, n]) => !query.get('tag') || n.tags.includes(query.get('tag')!)).map(([id]) => id),
      },
      'notes/{id}': {
        description: 'One note',
        read: ({ params }: ResourceMatch) => {
          const n = notes.get(params.id)
          if (!n) throw new Error(`no note ${params.id}`)
          return { content: n.text, version: String(n.version) }
        },
        write: ({ params }: ResourceMatch, body: WriteBody) => {
          writes.push(body)
          const n = notes.get(params.id)!
          if (body.ifVersion !== undefined && body.ifVersion !== String(n.version)) throw new Error('version conflict')
          n.text = body.mode === 'append' ? n.text + body.content : body.content
          n.version += 1
          return 'saved'
        },
        actions: {
          delete: { description: 'Delete this note', risk: 'destructive', input: { type: 'object', properties: {} },
            call: ({ params }: ResourceMatch) => { calls.push(`delete ${params.id}`); notes.delete(params.id); return 'deleted' } },
          tag: { description: 'Add a tag', risk: 'idempotent_write', input: { type: 'object', properties: { tag: { type: 'string' } }, required: ['tag'] },
            call: ({ params }: ResourceMatch, p) => { notes.get(params.id)!.tags.push(String(p.tag)); return 'tagged' } },
        },
      },
      settings: { description: 'Page settings (read-only)', read: () => ({ theme: 'dark' }) },
    },
    commands: {
      'notes-export': {
        summary: 'Export notes as one markdown document',
        options: [{ name: 'tag', type: 'string', description: 'Only notes with this tag' }, { name: 'with-ids', type: 'boolean', description: 'Include ids' }],
        inputSchema: { type: 'object', properties: { tag: { type: 'string' }, with_ids: { type: 'boolean' } } },
        access: { mode: 'fixed', level: 'read' },
        call: (input) => `export ${JSON.stringify(input)}`,
      },
      'notes-purge': { summary: 'Delete all notes', access: { mode: 'fixed', level: 'destructive' }, call: () => 'purged' },
    },
  })
  return { tools, notes, writes, calls }
}

const call = (tools: ReturnType<typeof notesSite>['tools'], name: string, args: Record<string, unknown>) =>
  Promise.resolve(tools[name].call(args as never, ctx)) as Promise<string>

describe('siteTools', () => {
  test('read "/" lists resources, actions with risk and commands', async () => {
    const { tools } = notesSite()
    const text = await call(tools, 'read', { uri: '/' })
    expect(text).toContain('- notes/{id} — One note [read, write, edit]')
    expect(text).toContain('  action delete (risk: destructive) — Delete this note')
    expect(text).toContain('- settings — Page settings (read-only) [read]')
    expect(text).toContain('- xcall — call an action of a resource: xcall <object> <action>')
    expect(text).toContain('- notes-export — Export notes as one markdown document')
  })

  test('read passes the query and versions are not shown', async () => {
    const { tools } = notesSite()
    expect(await call(tools, 'read', { uri: 'notes?tag=work' })).toBe('[\n  "1"\n]')
    expect(await call(tools, 'read', { uri: '/notes/1' })).toBe('alpha beta')
  })

  test('undeclared and traversing URIs are refused', async () => {
    const { tools } = notesSite()
    for (const uri of ['admin', 'notes/1/x', 'notes/..%2fadmin', 'note/..%2fadmin', 'notes/%2e%2e', 'https://evil.example/notes/1', '//evil/notes']) {
      await expect(call(tools, 'read', { uri })).rejects.toThrow(/not a resource of this page/)
    }
    expect(normalizeUri('notes/./1', new Set()).segments).toEqual(['notes', '1'])
  })

  test('write: read-only resources, modes', async () => {
    const { tools, notes } = notesSite()
    await expect(call(tools, 'write', { uri: 'settings', content: 'x' })).rejects.toThrow('read-only')
    await call(tools, 'write', { uri: 'notes/2', content: '!', mode: 'append' })
    expect(notes.get('2')!.text).toBe('gamma!')
  })

  test('edit: exactly one occurrence, written with the version it read', async () => {
    const { tools, notes, writes } = notesSite()
    await expect(call(tools, 'edit', { uri: 'notes/1', old_string: 'zzz', new_string: 'y' })).rejects.toThrow('not found')
    notes.get('1')!.text = 'a a'
    await expect(call(tools, 'edit', { uri: 'notes/1', old_string: 'a', new_string: 'y' })).rejects.toThrow('occurs 2 times')
    notes.get('1')!.text = 'alpha beta'
    await call(tools, 'edit', { uri: 'notes/1', old_string: 'beta', new_string: '$&delta' })
    expect(notes.get('1')!.text).toBe('alpha $&delta')
    expect(writes[writes.length - 1]).toEqual({ content: 'alpha $&delta', mode: 'write', ifVersion: '1' })
  })

  test('exec xcall: declared actions only, params validated, risk in the result', async () => {
    const { tools, calls, notes } = notesSite()
    expect(await call(tools, 'exec', { command: 'xcall notes/1 delete' })).toBe('[risk: destructive]\ndeleted')
    expect(calls).toEqual(['delete 1'])
    expect(await call(tools, 'exec', { command: 'xcall notes/2 tag tag=urgent' })).toBe('[risk: idempotent_write]\ntagged')
    expect(await call(tools, 'exec', { command: 'xcall notes/2 tag --params \'{"tag":"x"}\'' })).toBe('[risk: idempotent_write]\ntagged')
    expect(notes.get('2')!.tags).toEqual(['urgent', 'x'])
    await expect(call(tools, 'exec', { command: 'xcall notes/2 archive' })).rejects.toThrow('has no action `archive` (actions: delete, tag)')
    await expect(call(tools, 'exec', { command: 'xcall notes/2 tag' })).rejects.toThrow('missing required field `tag`')
    await expect(call(tools, 'exec', { command: 'xcall notes/2 delete --confirm-token=t' })).rejects.toThrow('unsupported flag')
  })

  test('exec is not a shell', async () => {
    const { tools } = notesSite()
    const err = call(tools, 'exec', { command: 'xcall note clear | cat' })
    await expect(err).rejects.toThrow(/not a shell/)
    await expect(err).rejects.toThrow(/available commands: xcall, notes-export, notes-purge/)
    await expect(call(tools, 'exec', { command: 'rm -rf /' })).rejects.toThrow(/unknown command `rm`; exec runs one command, it is not a shell/)
    await expect(call(tools, 'exec', { command: 'notes-export --tag "a|b"' })).resolves.toBe('export {"tag":"a|b"}')
  })

  test('page commands: options, --help, unknown options', async () => {
    const { tools } = notesSite()
    expect(await call(tools, 'exec', { command: 'notes-export --tag work --with-ids' })).toBe('export {"tag":"work","with_ids":true}')
    expect(await call(tools, 'exec', { command: 'notes-export --help' })).toContain('usage: notes-export [options]')
    await expect(call(tools, 'exec', { command: 'notes-export --format md' })).rejects.toThrow('unknown option: --format')
  })

  test('resume rules: read and access:read commands re-run, writes and non-idempotent actions do not', () => {
    const { tools } = notesSite()
    const idem = (name: string, args: Record<string, unknown>) => {
      const f = tools[name].idempotent
      return typeof f === 'function' ? f(args as never) : f === true
    }
    expect(idem('read', { uri: 'notes' })).toBe(true)
    expect(idem('write', { uri: 'notes/1', content: '' })).toBe(false)
    expect(idem('edit', { uri: 'notes/1', old_string: 'a', new_string: 'b' })).toBe(false)
    expect(idem('exec', { command: 'xcall notes/1 tag tag=a' })).toBe(true)
    expect(idem('exec', { command: 'xcall notes/1 delete' })).toBe(false)
    expect(idem('exec', { command: 'notes-export' })).toBe(true)
    expect(idem('exec', { command: 'notes-purge' })).toBe(false)
  })

  test('long text is paged by lines with the next offset', () => {
    const text = Array.from({ length: 5 }, (_, i) => `line ${i + 1}`).join('\n')
    expect(pageText(text, 2, 2)).toBe('line 2\nline 3\n[lines 2–3 of 5; read on with offset=4]')
    const big = Array.from({ length: 4000 }, () => 'x'.repeat(40)).join('\n')
    const page = pageText(big)
    expect(page.length).toBeLessThan(MAX_RESULT_BYTES + 100)
    expect(page).toMatch(/read on with offset=\d+\]$/)
  })
})
