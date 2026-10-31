import { AIWS_MAX_INLINE_BYTES, aiwsContentDigest, AiwsSourceError, buildFiles, checkComponent, checkComposition, collectSources, compatManifest, controlSkeleton, homeControlDir, packBuildFiles, slotCells, sourcesKey, verifyBundle } from '../src/aiws_ext'
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
    const broken = JSON.stringify({ manifest_version: 3, ident: { author_did: 'alice', name: 'KPI' }, kind: 'chart', title: '', entry: 'x.json', deps: ['y'], config_schema: { pattern: 'a' }, events: {} })
    const messages = checkComponent(broken, ['component.json']).map((d) => d.message).join('\n')
    for (const needle of ['newer than this client', 'author_did', 'ident.name', 'kind must be', 'title', 'is not an identity', 'outside the supported subset', 'events are not supported']) expect(messages).toContain(needle)
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
    expect(bad({ layout: { algorithm: 'grid' }, slots: {} })).toContain('stack or fixed')
    expect(bad({ layout: { algorithm: 'stack', spacing: '{{config.nope}}' }, slots: {} })).toContain('config.nope')
    expect(bad({ layout: { algorithm: 'fixed' }, slots: { a: { placement: 'stack' } } })).toContain('fixed layout')
    expect(bad({ layout: { algorithm: 'stack' }, slots: { Bad: {} }, events: {} })).toMatch(/slot name[\s\S]*events are not supported|events are not supported[\s\S]*slot name/)
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

  it('suggests home folders without the Workspace title breaking paths', () => {
    expect(homeControlDir('alice', 'Q3/Plan', 'kpi')).toBe('/home/alice/AI Workspace/Q3 Plan/controls/kpi')
  })
})
