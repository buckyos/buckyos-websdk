import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { AIWS_MAX_INLINE_BYTES, aiwsContentDigest, aiwsTemplateDigest, AiwsSourceError, buildFiles, checkComponent, checkComposition, checkDeclarative, collectSources, compatManifest, controlSkeleton, homeControlDir, packBuildFiles, slotCells, sourcesKey, verifyBundle } from '../src/aiws_ext'
import type { NfspClient } from '../src/nfsp'

const enc = new TextEncoder()

describe('aiws extension controls (shared drivers)', () => {
  it('computes the content digest the service computes (store/src/ext.rs content_digest)', async () => {
    const digest = await aiwsContentDigest([['b.json', enc.encode('{}')], ['a.txt', enc.encode('hello')]])
    expect(digest).toBe('sha256:febb1057a0ccca4402f38caf1f5441717e6e56ef19188621177b68c1593c9488')
  })

  it('pre-checks component.json against its folder', () => {
    const files = controlSkeleton({ authorDid: 'did:bns:alice', name: 'kpi-card', title: 'KPI' })
    expect(checkComponent(files['component.json'], Object.keys(files)).filter((d) => d.severity === 'error')).toEqual([])
    const html = controlSkeleton({ authorDid: 'did:bns:alice', name: 'clock', kind: 'html' })
    expect(checkComponent(html['component.json'], Object.keys(html)).filter((d) => d.severity === 'error')).toEqual([])
    const broken = JSON.stringify({ manifest_version: 6, ident: { author_did: 'alice', name: 'KPI' }, kind: 'chart', title: '', entry: 'x.json', deps: ['y'], config_schema: { pattern: 'a' }, events: [] })
    const messages = checkComponent(broken, ['component.json']).map((d) => d.message).join('\n')
    for (const needle of ['newer than this client', 'author_did', 'ident.name', 'kind must be', 'title', 'is not an identity', 'outside the supported subset', 'events must be an object']) expect(messages).toContain(needle)
    // version 1 knows neither composites nor dependencies
    const v1 = JSON.stringify({ manifest_version: 1, ident: { author_did: 'did:bns:alice', name: 'b' }, kind: 'composite', title: 'B', entry: 'composition.json', deps: ['did:bns:alice#c'] })
    expect(checkComponent(v1, ['component.json', 'composition.json']).filter((d) => d.message.includes('manifest_version 2')).length).toBe(2)
    expect(checkComponent('{ oops', [])[0].severity).toBe('error')
    expect(checkComponent(files['component.json'], [...Object.keys(files), 'notes.txt']).find((d) => d.file === 'notes.txt')?.severity).toBe('warning')
  })

  it('reads older manifests and refuses newer ones (Q19)', () => {
    expect(compatManifest({ manifest_version: 1, purpose: 'aiws', controls: [] }).workspace_templates).toEqual([])
    expect(() => compatManifest({ manifest_version: 9, purpose: 'aiws', controls: [] })).toThrow(AiwsSourceError)
    expect(() => compatManifest({ manifest_version: 1, purpose: 'app', controls: [] })).toThrow(AiwsSourceError)
  })

  it('verifies a bundle: digests, component.json, stray files', async () => {
    const files = controlSkeleton({ authorDid: 'did:bns:alice', name: 'kpi', title: 'KPI' })
    const bundle = new Map<string, Uint8Array>(Object.entries(files).map(([n, t]) => [`controls/kpi/${n}`, enc.encode(t)]))
    const digest = await aiwsContentDigest(Object.entries(files).map(([n, t]) => [n, enc.encode(t)] as [string, Uint8Array]))
    const manifest = { manifest_version: 1, purpose: 'aiws', controls: [{ ident: 'did:bns:alice#kpi', name: 'kpi', kind: 'declarative', version: 1, digest, dir: 'controls/kpi/' }], workspace_templates: [] }
    bundle.set('aiws-manifest.json', enc.encode(JSON.stringify(manifest)))
    expect((await verifyBundle(bundle)).diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    bundle.set('controls/kpi/declarative.json', enc.encode('{}'))
    bundle.set('loose.txt', enc.encode('x'))
    const errors = (await verifyBundle(bundle)).diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)
    expect(errors.join('\n')).toContain('digest')
    expect(errors.join('\n')).toContain('belongs to no control')
  })

  it('pre-checks a composite and its composition (the service rules of store/src/ext.rs)', () => {
    const files = controlSkeleton({ authorDid: 'did:bns:alice', name: 'board', kind: 'composite', deps: ['did:bns:alice#card'], slots: { cards: { accepts: ['cell:did:bns:alice#card', 'richtext'] }, header: { max: 1, placement: 'top' } } })
    const read = (n: string) => files[n]
    expect(checkComponent(files['component.json'], Object.keys(files), read).filter((d) => d.severity === 'error')).toEqual([])
    expect(slotCells(JSON.parse(files['composition.json']))).toEqual(['did:bns:alice#card'])
    const fixed = controlSkeleton({ authorDid: 'did:bns:alice', name: 'canvas', kind: 'composite', algorithm: 'fixed' })
    expect(checkComponent(fixed['component.json'], Object.keys(fixed), (n) => fixed[n]).filter((d) => d.severity === 'error')).toEqual([])
    const schema = { properties: { gap: { type: 'integer' } } }
    const bad = (c: unknown) => checkComposition(JSON.stringify(c), schema).map((d) => d.message).join('\n')
    expect(bad({ layout: { algorithm: 'circle' }, slots: {} })).toContain('stack, fixed or grid')
    expect(bad({ layout: { algorithm: 'stack', spacing: '{{config.nope}}' }, slots: {} })).toContain('config.nope')
    expect(bad({ layout: { algorithm: 'fixed' }, slots: { a: { placement: 'stack' } } })).toContain('fixed layout')
    expect(bad({ layout: { algorithm: 'stack' }, slots: { Bad: {} }, events: {} })).toBe('slots.Bad: a slot name is [a-z][a-z0-9_]{0,31}')
    expect(bad({ layout: { algorithm: 'stack' }, slots: { a: { accepts: ['cell:bob'] } }, chrome: { title: { slot: 'z' } } })).toMatch(/cell:<author_did>#<name>[\s\S]*chrome.title/)
    expect(bad({ layout: { algorithm: 'stack', spacing: '{{config.gap}}' }, slots: { a: { min: 1, max: 2 } }, chrome: { background: '#fff', title: { text: '{{config.gap}} px' } } })).toBe('')
    const own = JSON.parse(files['component.json'])
    own.deps = ['did:bns:alice#board']
    expect(checkComponent(JSON.stringify(own), Object.keys(files), read).map((d) => d.message).join('\n')).toContain('itself')
    own.deps = []
    own.accepts = ['buckyos.record']
    expect(checkComponent(JSON.stringify(own), Object.keys(files), read).map((d) => d.message).join('\n')).toContain('container of Blocks')
  })

  it('verifies the dependency closure of a bundle', async () => {
    const files = controlSkeleton({ authorDid: 'did:bns:alice', name: 'board', kind: 'composite', deps: ['did:bns:alice#card'] })
    const bundle = new Map<string, Uint8Array>(Object.entries(files).map(([n, t]) => [`controls/board/${n}`, enc.encode(t)]))
    const digest = await aiwsContentDigest(Object.entries(files).map(([n, t]) => [n, enc.encode(t)] as [string, Uint8Array]))
    const control = { ident: 'did:bns:alice#board', name: 'board', kind: 'composite', version: 1, digest, dir: 'controls/board/', deps: ['did:bns:alice#card'] }
    bundle.set('aiws-manifest.json', enc.encode(JSON.stringify({ manifest_version: 2, purpose: 'aiws', controls: [control], workspace_templates: [] })))
    expect((await verifyBundle(bundle)).diagnostics.map((d) => d.message).join('\n')).toContain('does not carry')
    bundle.set('aiws-manifest.json', enc.encode(JSON.stringify({ manifest_version: 2, purpose: 'aiws', controls: [{ ...control, deps: [] }], workspace_templates: [] })))
    expect((await verifyBundle(bundle)).diagnostics.map((d) => d.message).join('\n')).toContain('deps must match')
  })

  it('sends the largest files by reference once the inline bytes would exceed the limit (Q22)', async () => {
    const big = new Uint8Array(3 * 1024 * 1024).fill(1)
    const files = [{ name: 'component.json', bytes: enc.encode('{}') }, { name: 'a.bin', bytes: big }, { name: 'b.bin', bytes: big }]
    await expect(packBuildFiles(files)).rejects.toThrow(AiwsSourceError)
    const uploaded: string[] = []
    const out = await packBuildFiles(files, async (name) => { uploaded.push(name); return `cyfile:${name}` })
    expect(uploaded).toHaveLength(1)
    expect(out.filter((f) => 'obj_id' in f)).toHaveLength(1)
    expect(out.map((f) => f.name)).toEqual(['a.bin', 'b.bin', 'component.json'])
    const inline = out.filter((f) => 'base64' in f).reduce((n, f) => n + atob((f as { base64: string }).base64).length, 0)
    expect(inline).toBeLessThanOrEqual(AIWS_MAX_INLINE_BYTES)
  })

  it('collects a folder with its sub-folders and sends FileObjects by reference, other files inline', async () => {
    const read: string[] = []
    const nfsp = {
      list: async () => ({ container: {}, entries: [
        { name: 'component.json', binding: 'native', target: { kind: 'file', ref: { type: 'live', node_id: 'n1' }, attrs: { obj_id: 'cyfile:aa', size: 2, etag: '2-1' } } },
        { name: 'view.html', binding: 'native', target: { kind: 'file', ref: { type: 'live', node_id: 'n2' }, attrs: { obj_id: 'sha256:00', etag: '5-1' } } },
        { name: '.aiws-build.json', binding: 'native', target: { kind: 'file', ref: { type: 'live', node_id: 'n3' }, attrs: {} } },
      ] }),
      readFile: async (nodeId: string) => { read.push(nodeId); return new Response(enc.encode('<div>')) },
    } as unknown as NfspClient
    const files = await collectSources(nfsp, '/home/alice/x')
    expect(files.map((f) => f.name)).toEqual(['component.json', 'view.html'])
    expect(sourcesKey(files)).toBe(JSON.stringify([['component.json', 'cyfile:aa'], ['view.html', 'sha256:00']]))
    expect(await buildFiles(nfsp, files)).toEqual([{ name: 'component.json', obj_id: 'cyfile:aa' }, { name: 'view.html', base64: btoa('<div>') }])
    expect(read).toEqual(['n2'])
    // sub-folders become relative names; dot folders are the client's own
    const nested = {
      list: async (where: unknown) => {
        const inner = typeof where === 'object' && (where as { ref: { node_id: string } }).ref.node_id === 'd'
        return { container: {}, entries: inner
          ? [{ name: 'check.svg', binding: 'native', target: { kind: 'file', ref: { type: 'live', node_id: 'n5' }, attrs: {} } }]
          : [{ name: 'icons', binding: 'native', target: { kind: 'dir', ref: { type: 'live', node_id: 'd' } } },
             { name: '.cache', binding: 'native', target: { kind: 'dir', ref: { type: 'live', node_id: 'x' } } },
             { name: 'component.json', binding: 'native', target: { kind: 'file', ref: { type: 'live', node_id: 'n4' }, attrs: {} } }] }
      },
    } as unknown as NfspClient
    expect((await collectSources(nested, '/home/alice/y')).map((f) => f.name)).toEqual(['component.json', 'icons/check.svg'])
  })

  it('v3: render controls declare events, HTML speaks host API 2 or 3, older versions get a hint', () => {
    const html = controlSkeleton({ authorDid: 'did:bns:alice', name: 'clock', kind: 'html' })
    const component = JSON.parse(html['component.json'])
    expect([component.manifest_version, component.host_api, Object.keys(component.events)]).toEqual([5, 4, ['clicked']])
    expect(html['behavior.js']).toContain("aiws.emit('clicked'")
    expect(checkComponent(html['component.json'], Object.keys(html))).toEqual([])
    const errors = (c: unknown) => checkComponent(JSON.stringify(c), Object.keys(html)).filter((d) => d.severity === 'error').map((d) => d.message).join('\n')
    expect(errors({ ...component, events: { Done: { params: { x: { type: 'date' }, Y: {}, z: { type: 'string', required: 'yes', label: 1 } }, color: 'red' } } }))
      .toMatch(/events.Done: an event name[\s\S]*unknown key color[\s\S]*params.x.type: string, number, boolean, object, entity[\s\S]*params.Y: a param name[\s\S]*params.Y.type required[\s\S]*params.z.required must be a boolean[\s\S]*unknown key label/)
    const many = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`e${i}`, {}]))
    expect(errors({ ...component, events: many })).toContain('events: at most 16')
    expect(errors({ ...component, manifest_version: 2 })).toMatch(/events needs manifest_version 3[\s\S]*host_api 4 needs manifest_version 4/)
    expect(errors({ ...component, manifest_version: 2, host_api: 2, events: undefined })).toBe('')
    expect(errors({ ...component, host_api: 1 })).toContain('API 2, 3 and 4')
    // events with host API 2 cannot be raised: a warning, not an error
    expect(checkComponent(JSON.stringify({ ...component, host_api: 2 }), Object.keys(html)).map((d) => `${d.severity}: ${d.message}`)).toEqual(['warning: events: an HTML control raises them with aiws.emit, which is host API 3 (set host_api to 3 or later)'])
    // a composite's events live in composition.json
    const board = controlSkeleton({ authorDid: 'did:bns:alice', name: 'board', kind: 'composite' })
    const own = { ...JSON.parse(board['component.json']), events: { done: {} } }
    expect(checkComponent(JSON.stringify(own), Object.keys(board), (n) => board[n]).map((d) => d.message).join('\n')).toContain('declares its events in composition.json')
  })

  it('v3: the declarative button emits a declared event (EVENT_UNDECLARED otherwise)', () => {
    const files = controlSkeleton({ authorDid: 'did:bns:alice', name: 'todo', title: 'Todo' })
    const component = { ...JSON.parse(files['component.json']), events: { completed: { params: { label: { type: 'string' } } } } }
    const spec = { layout: 'stack', items: [{ kind: 'text', text: 'hi' }, { kind: 'button', label: 'Done', emit: 'completed', params: { label: '{{config.label}}', nested: { at: ['{{config.label}}'] } } }] }
    const check = (c: unknown, s: unknown) => checkComponent(JSON.stringify(c), Object.keys(files), (n) => n === 'declarative.json' ? JSON.stringify(s) : files[n])
    expect(check(component, spec)).toEqual([])
    const bad = check({ ...component, manifest_version: 2, events: undefined }, { items: [{ kind: 'button', emit: 'gone', params: { a: '{{config.nope}}', b: '{{event.x}}' }, color: 1 }, { kind: 'chart', format: 'pct' }] })
    expect(bad.find((d) => d.code === 'EVENT_UNDECLARED')?.message).toBe('items[0].emit gone: not an event of component.json')
    expect(bad.filter((d) => d.severity === 'error').map((d) => d.message).join('\n'))
      .toMatch(/items\[0\]: a button needs manifest_version 3[\s\S]*items\[0\].label[\s\S]*config.nope[\s\S]*only \{\{config.<key>\}\}[\s\S]*items\[1\].kind "chart"[\s\S]*items\[1\].format/)
    expect(bad.filter((d) => d.severity === 'warning').map((d) => d.message)).toEqual(['items[0]: key color is ignored by the interpreter'])
    expect(checkDeclarative(JSON.stringify({ items: [{ kind: 'button', label: 'Go', emit: 'go', params: [] }] })).map((d) => d.message)).toEqual(['items[0].params must be an object'])
    expect(checkDeclarative(JSON.stringify({ items: [{ kind: 'metric', bind: 'other.count' }], inspector: [{ kind: 'slider' }], extra: 1 })).map((d) => `${d.severity}: ${d.message}`)).toEqual([
      'warning: items[0].bind "other.count": other is not a declared binding, so it reads the field "other.count" of the main source',
      'error: inspector[0].kind: one of text, number, select, boolean, color',
      'error: inspector[0] needs key and label',
      'warning: key extra is not part of the declarative vocabulary',
    ])
  })

  it('v3: a composition re-raises events of its slots and lays them out on a grid', () => {
    const schema = { properties: { gap: { type: 'integer' } } }
    const card = 'did:bns:alice#card'
    const slots = { cards: { accepts: [`cell:${card}`, 'richtext'] }, notes: { accepts: ['richtext'] } }
    const known = (ident: string) => (ident === card ? ['completed'] : undefined)
    const check = (c: unknown, cellEvents = known, manifestVersion?: number) => checkComposition(JSON.stringify(c), schema, 'composition.json', { cellEvents, manifestVersion })
    expect(check({ layout: { algorithm: 'stack' }, slots, events: { card_done: { from: { slot: 'cards', event: 'completed' }, title: 'Done' } } })).toEqual([])
    const undeclared = check({ layout: { algorithm: 'stack' }, slots, events: { a: { from: { slot: 'cards', event: 'removed' } }, b: { from: { slot: 'notes', event: 'completed' } } } })
    expect(undeclared.map((d) => [d.code, d.message])).toEqual([
      ['EVENT_UNDECLARED', `events.a: no control slot cards accepts (${card}) declares the event removed`],
      ['EVENT_UNDECLARED', 'events.b: slot notes accepts no cell:<ident>, so no control there declares completed'],
    ])
    // a control not at hand is the build's to judge
    expect(check({ layout: { algorithm: 'stack' }, slots, events: { a: { from: { slot: 'cards', event: 'removed' } } } }, () => undefined)).toEqual([])
    expect(check({ layout: { algorithm: 'stack' }, slots, events: { Bad: { from: { slot: 'nope', event: 'x' }, extra: 1 }, c: {} } }, known, 2).map((d) => d.message)).toEqual([
      'events needs manifest_version 3 (raise it in component.json)',
      'events.Bad: an event name is [a-z][a-z0-9_]{0,31}',
      'events.Bad: unknown key extra (from, title, description, on)',
      'events.Bad.from.slot "nope": a slot of this composition',
      'events.c.from { slot, event } required: the child event it re-raises',
    ])
    // grid: columns 1…12 (required), gap; stack keys belong to stack; slots fill cells in order
    expect(check({ layout: { algorithm: 'grid', columns: 3, gap: '{{config.gap}}', padding: 8 }, slots: { cards: { placement: 'stack' } } })).toEqual([])
    const grid = check({ layout: { algorithm: 'grid', columns: 13, gap: 3000, direction: 'row' }, slots: { a: { placement: 'free' }, b: { placement: 'top' } } }).map((d) => d.message)
    expect(grid).toEqual([
      'layout.columns: an integer in [1, 12]',
      'layout.gap: a number in [0, 2000] or {{config.<key>}}',
      'layout.direction belongs to the stack layout',
      "slots.a.placement: a grid fills its cells with the slots' children in slot order (stack)",
      "slots.b.placement: a grid fills its cells with the slots' children in slot order (stack)",
    ])
    expect(check({ layout: { algorithm: 'grid' }, slots: {} }).map((d) => d.message)).toEqual(['layout.columns (1…12) required: the cells of a grid row'])
    expect(check({ layout: { algorithm: 'stack', columns: 2, gap: 4 }, slots: {} }).map((d) => d.message)).toEqual(['layout.columns belongs to the grid layout', 'layout.gap belongs to the grid layout'])
  })

  it('v4: projections, a media slot, per-viewer visibility, events from a projection with a default handler', () => {
    const schema = { type: 'object', properties: { limit_ms: { type: 'integer' }, broadcast: { type: 'object' }, picks: { type: 'integer' } } }
    const check = (c: unknown, manifestVersion?: number) => checkComposition(JSON.stringify(c), schema, 'composition.json', { manifestVersion }).map((d) => d.message)
    const v4 = {
      layout: { algorithm: 'stack' },
      slots: { screen: { accepts: ['asset'], max: 1 }, later: { visible: { from: 'first_open', for_ms: '{{config.limit_ms}}' } } },
      media: { slot: 'screen', anchor: 'broadcast' },
      projections: { photos: { source: { kind: 'members', binding: 'photos', accept: 'image' }, layout: { algorithm: 'grid', columns: 3, item: { h: 90 } },
        template: { nodes: [{ id: 'img', view: 'asset', role: 'pick', config: { object_id: '{{item.object_id}}' } }] } } },
      events: { pick: { from: { projection: 'photos', role: 'pick' }, on: { kind: 'write', target: 'votes', what: 'toggle', args: { field: 'picks', value: '{{event.item}}', max: '{{config.picks}}' } } } },
    }
    expect(check(v4, 4)).toEqual([])
    // an older manifest is told to raise it
    expect(check(v4, 3).every((m) => m.includes('manifest_version 4'))).toBe(true)
    expect(check(v4, 3).length).toBeGreaterThan(0)
    // a default handler is one of the event handlers (not an action's `config` / `forward`)
    expect(check({ ...v4, events: { pick: { from: { projection: 'photos', role: 'pick' }, on: { kind: 'forward' } } } }, 4)).toEqual(['events.pick.on: a handler (write, wish, open, notify) or 1…4 of them'])
  })

  const HELLO = process.env.AIWS_HELLO_CONTROLS ?? '/home/lzc/project/buckyos/doc/workspace/hello-controls'
  ;(existsSync(HELLO) ? it : it.skip)('the hello-controls examples check clean (buckyos doc/workspace/hello-controls)', () => {
    const read = (dir: string): Record<string, string> => {
      const out: Record<string, string> = {}
      const walk = (at: string, prefix: string) => {
        for (const name of readdirSync(at)) {
          if (statSync(join(at, name)).isDirectory()) walk(join(at, name), `${prefix}${name}/`)
          else out[`${prefix}${name}`] = readFileSync(join(at, name), 'utf8')
        }
      }
      walk(dir, '')
      return out
    }
    const controls = Object.fromEntries(['hello-kpi', 'hello-card', 'hello-board'].map((n) => [n, read(join(HELLO, 'controls', n))]))
    const events = (ident: string) => {
      const c = controls[ident.split('#')[1]]
      return c ? Object.keys(JSON.parse(c['component.json']).events ?? {}) : undefined
    }
    for (const [name, files] of Object.entries(controls)) {
      expect([name, checkComponent(files['component.json'], Object.keys(files), (n) => files[n], events)]).toEqual([name, []])
    }
    const board = controls['hello-board']
    const composition = checkComposition(board['composition.json'], JSON.parse(board['component.json']).config_schema, 'composition.json', { manifestVersion: 3, cellEvents: events })
    expect(composition).toEqual([])
    // hello-card is what makes card_done valid: without its completed event the bubbling is undeclared
    expect(checkComposition(board['composition.json'], JSON.parse(board['component.json']).config_schema, 'composition.json', { cellEvents: () => [] }).map((d) => d.code)).toEqual(['EVENT_UNDECLARED'])
  })

  // the 控件机制 examples (TV screen, time-limited, photo vote, listen together): a manifest-4 bundle whose digests,
  // components and compositions check clean as a whole
  const EXAMPLES = process.env.AIWS_CONTROL_EXAMPLES ?? join(process.cwd(), '../buckyos/doc/workspace/control-examples')
  ;(existsSync(EXAMPLES) ? it : it.skip)('the control examples are a clean bundle (buckyos doc/workspace/control-examples)', async () => {
    const files = new Map<string, Uint8Array>()
    const walk = (at: string, prefix: string) => {
      for (const name of readdirSync(at)) {
        if (statSync(join(at, name)).isDirectory()) walk(join(at, name), `${prefix}${name}/`)
        else if (prefix || name === 'aiws-manifest.json') files.set(`${prefix}${name}`, new Uint8Array(readFileSync(join(at, name))))
      }
    }
    walk(EXAMPLES, '')
    const { manifest, diagnostics } = await verifyBundle(files)
    expect(diagnostics).toEqual([])
    expect(manifest.controls.map((c) => c.ident)).toEqual(['did:bns:buckyos#tv-screen', 'did:bns:buckyos#time-limited', 'did:bns:buckyos#photo-vote', 'did:bns:buckyos#listen-together'])
  })

  it('v5: a composite declares what it binds when placed (on_bind, on_init_control) and its bindings\' schema_id / many', () => {
    const vote = {
      manifest_version: 5, ident: { author_did: 'did:bns:alice', name: 'vote' }, kind: 'composite', title: 'Vote', entry: 'composition.json',
      bindings: { photos: { accepts: ['buckyos.dir'], required: true }, votes: { accepts: ['buckyos.table-source'], required: true }, lists: { schema_id: 'buckyos.todo@1', many: true } },
      actions: [{ id: 'prepare', title: 'Prepare', run: { kind: 'write', target: 'votes', what: 'addOptions', args: {} } }],
      on_bind: [{ binding: 'photos', pick: 'one' }, { binding: 'votes', create: { table: { name: 'Votes', fields: [] } }, when: 'always' }, { binding: 'lists', pick: 'all' }],
      on_init_control: [{ require: 'children' }, { then: { action: 'prepare' } }],
    }
    const errors = (c: unknown) => checkComponent(JSON.stringify(c), ['component.json', 'composition.json']).filter((d) => d.severity === 'error').map((d) => d.message)
    expect(errors(vote)).toEqual([])
    expect(errors({ ...vote, manifest_version: 4 }).some((m) => m.includes('manifest_version 5'))).toBe(true)
    expect(errors({ ...vote, on_bind: [{ binding: 'photos', pick: 'many' }], on_init_control: [{ then: { action: 'nope' } }] })).toEqual([
      'on_bind[0]: photos takes one', 'on_init_control[0]: nope is not a declared action',
    ])
    expect(errors({ ...vote, bindings: { photos: { many: 'yes', multiple: true } }, on_bind: undefined, on_init_control: undefined })).toEqual([
      'binding photos: unknown key multiple', 'binding photos.many: true or false',
    ])
  })

  it('verifies the Workspace templates of a bundle: shape, snapshot, digest, required controls, no stray files', async () => {
    const files = controlSkeleton({ authorDid: 'did:bns:alice', name: 'kpi', title: 'KPI' })
    const bundle = new Map<string, Uint8Array>(Object.entries(files).map(([n, t]) => [`controls/kpi/${n}`, enc.encode(t)]))
    const digest = await aiwsContentDigest(Object.entries(files).map(([n, t]) => [n, enc.encode(t)] as [string, Uint8Array]))
    bundle.set('templates/team/snapshot.json', enc.encode(JSON.stringify({ format: 'aiws-template/1', content_root: 'r', entities: [] })))
    bundle.set('templates/team/objects/obj1', enc.encode('{}'))
    const template = {
      id: 'team', title: 'Team board', snapshot: 'templates/team/snapshot.json', digest: await aiwsTemplateDigest(bundle, 'team'),
      requires: { host_api: { declarative: 1 }, controls: ['did:bns:alice#kpi'] }, params: { team_name: { type: 'string', title: 'Team', default: 'Team' } }, reset: { tables: ['tasks'] },
    }
    expect(template.digest).toBe(await aiwsContentDigest([['snapshot.json', bundle.get('templates/team/snapshot.json')!], ['objects/obj1', enc.encode('{}')]]))
    const control = { ident: 'did:bns:alice#kpi', name: 'kpi', kind: 'declarative', version: 1, digest, dir: 'controls/kpi/' }
    const withManifest = (m: unknown) => { const b = new Map(bundle); b.set('aiws-manifest.json', enc.encode(JSON.stringify(m))); return b }
    const errors = async (b: Map<string, Uint8Array>) => (await verifyBundle(b)).diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.file}: ${d.message}`)
    const manifest = { manifest_version: 3, purpose: 'aiws', controls: [control], workspace_templates: [template] }
    expect(await errors(withManifest(manifest))).toEqual([])
    expect((await verifyBundle(withManifest(manifest))).manifest.workspace_templates[0].id).toBe('team')
    // a package may carry a template without controls
    const templateOnly = withManifest({ ...manifest, controls: [], workspace_templates: [{ ...template, requires: { controls: [] } }] })
    for (const p of [...templateOnly.keys()]) if (p.startsWith('controls/')) templateOnly.delete(p)
    expect(await errors(templateOnly)).toEqual([])
    expect(await errors(withManifest({ ...manifest, manifest_version: 2 }))).toEqual(['aiws-manifest.json: Workspace templates need manifest_version 3 (raise it in aiws-manifest.json)'])
    const broken = withManifest({ ...manifest, workspace_templates: [{ ...template, snapshot: 'templates/other/snapshot.json', requires: { controls: ['did:bns:bob#gauge'] }, params: { team_name: { type: 'date' } }, reset: { tables: ['Bad table'] }, extra: 1 }] })
    expect(await errors(broken)).toEqual([
      'aiws-manifest.json: template team: unknown key extra',
      'aiws-manifest.json: template team: snapshot must be templates/team/snapshot.json',
      'aiws-manifest.json: template team: requires.controls: "did:bns:bob#gauge" is not a control of this manifest',
      'aiws-manifest.json: template team: params.team_name.type: string, number or boolean',
      'aiws-manifest.json: template team: reset.tables: at most 64 distinct table ids',
    ])
    const changed = withManifest(manifest)
    changed.set('templates/team/chunks/c1', enc.encode('bytes'))
    changed.set('templates/other/snapshot.json', enc.encode('{}'))
    expect(await errors(changed)).toEqual(['templates/team/: the files do not match the template digest', 'templates/other/snapshot.json: belongs to no control or template of the manifest'])
    const other = withManifest(manifest)
    other.set('templates/team/snapshot.json', enc.encode('{"format":"other"}'))
    expect(await errors(other)).toEqual(['templates/team/snapshot.json: not a template snapshot (format aiws-template/1)', 'templates/team/: the files do not match the template digest'])
    other.delete('templates/team/snapshot.json')
    expect(await errors(other)).toEqual(['templates/team/snapshot.json: missing', 'templates/team/: the files do not match the template digest'])
  })

  it('suggests home folders without the Workspace title breaking paths', () => {
    expect(homeControlDir('alice', 'Q3/Plan', 'kpi')).toBe('/home/alice/AI Workspace/Q3 Plan/controls/kpi')
  })
})
