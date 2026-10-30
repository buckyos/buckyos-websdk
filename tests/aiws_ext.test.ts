import { aiwsContentDigest, AiwsSourceError, buildFiles, checkComponent, collectSources, compatManifest, controlSkeleton, homeControlDir, sourcesKey, verifyBundle } from '../src/aiws_ext'
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
    const broken = JSON.stringify({ manifest_version: 2, ident: { author_did: 'alice', name: 'KPI' }, kind: 'chart', title: '', entry: 'x.json', deps: ['y'], config_schema: { pattern: 'a' } })
    const messages = checkComponent(broken, ['component.json']).map((d) => d.message).join('\n')
    for (const needle of ['newer than this client', 'author_did', 'ident.name', 'kind must be', 'title', 'deps must be empty', 'outside the supported subset']) expect(messages).toContain(needle)
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

  it('collects a flat folder and sends FileObjects by reference, other files inline; refuses sub-folders', async () => {
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
    const nested = { list: async () => ({ container: {}, entries: [{ name: 'assets', binding: 'native', target: { kind: 'dir', ref: { type: 'live', node_id: 'd' } } }] }) } as unknown as NfspClient
    await expect(collectSources(nested, '/home/alice/y')).rejects.toThrow(AiwsSourceError)
  })

  it('suggests home folders without the Workspace title breaking paths', () => {
    expect(homeControlDir('alice', 'Q3/Plan', 'kpi')).toBe('/home/alice/AI Workspace/Q3 Plan/controls/kpi')
  })
})
