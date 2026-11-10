import './setup.ts'
import { join, parse as parsePath } from 'node:path'
import { BuckyOSToolApplication, type ToolStdio } from '../core/app.ts'
import { aiwsTemplateDigest } from 'buckyos/node'
import { createDeterministicTarGz, digestFile, listTarGzStream } from '../modules/pikg_archive.ts'
import type { DockerClient, DockerImageInfo } from '../modules/pikg.ts'
import { appDocObjectId, validateAppDocShape } from '../modules/pikg_protocol.ts'
import { getHost, installHost, resetHostForTest } from '../runtime/host.ts'
import { assert, assertEquals, assertRejects } from './test_helpers.ts'

class CaptureStdio implements ToolStdio {
  stdoutText = ''
  stderrText = ''

  stdout(value: string): Promise<void> {
    this.stdoutText += value
    return Promise.resolve()
  }

  stderr(value: string): Promise<void> {
    this.stderrText += value
    return Promise.resolve()
  }

  readStdin(): Promise<string> {
    return Promise.resolve('')
  }

  takeEnvelope() {
    const value = JSON.parse(this.stdoutText)
    this.stdoutText = ''
    return value
  }
}

class FakeDocker implements DockerClient {
  inspectReferences: string[] = []
  saveReferences: string[] = []
  readonly info: DockerImageInfo = {
    id: `sha256:${'ab'.repeat(32)}`,
    architecture: 'amd64',
    canonicalName: 'local/demo:0.1.0-amd64',
  }

  inspect(reference: string): Promise<DockerImageInfo> {
    this.inspectReferences.push(reference)
    return Promise.resolve(this.info)
  }

  async save(imageId: string, destinationTarGz: string): Promise<void> {
    this.saveReferences.push(imageId)
    const body = new TextEncoder().encode('local docker image fixture')
    const compressed = await new Response(
      new Blob([body]).stream().pipeThrough(new CompressionStream('gzip')),
    ).bytes()
    await Deno.writeFile(destinationTarGz, compressed, { createNew: true })
  }
}

Deno.test('pikg path workflow is offline, self-verifying, and safely cleanable', async () => {
  const root = await Deno.makeTempDir()
  try {
    const project = join(root, 'demo')
    await Deno.mkdir(join(project, 'web', 'dist'), { recursive: true })
    await Deno.writeTextFile(join(project, 'web', 'dist', 'index.html'), '<h1>Hello</h1>\n')
    const io = new CaptureStdio()
    let authenticationCreated = false
    const app = new BuckyOSToolApplication({
      cwd: project,
      homeDir: join(root, 'home'),
      environment: { HOME: join(root, 'home') },
      stdio: io,
      pikg: { now: () => 1_800_000_000 },
      createAuthentication: () => {
        authenticationCreated = true
        throw new Error('PIKG must not create authentication')
      },
    })

    assertEquals(
      await app.run([
        '--non-interactive',
        'pikg',
        'init',
        '.',
        '--owner',
        'did:bns:root',
        '--kind',
        'static-web',
        '--source',
        './web/dist',
      ]),
      0,
    )
    let envelope = io.takeEnvelope()
    assertEquals(envelope.data.app.did, 'did:bns:demo.root')
    assertEquals(envelope.data.subpackage.key, 'web')
    assertEquals(authenticationCreated, false)

    const appMetaPath = join(project, 'dapp_meta', 'app.json')
    const appMeta = JSON.parse(await Deno.readTextFile(appMetaPath))
    appMeta.pkg_list = {}
    await Deno.writeTextFile(appMetaPath, `${JSON.stringify(appMeta, null, 2)}\n`)
    assertEquals(await app.run(['pikg', 'build']), 2)
    envelope = io.takeEnvelope()
    assertEquals(envelope.error.code, 'SCHEMA_VALIDATION_FAILED')
    delete appMeta.pkg_list
    appMeta.presentation = 'invalid'
    await Deno.writeTextFile(appMetaPath, `${JSON.stringify(appMeta, null, 2)}\n`)
    assertEquals(await app.run(['pikg', 'build']), 2)
    envelope = io.takeEnvelope()
    assertEquals(envelope.error.code, 'SCHEMA_VALIDATION_FAILED')
    appMeta.presentation = {
      title: { en: 'Demo', 'zh-CN': '示例' },
      summary: {},
      description: {},
      icons: { small: `cyfile:${'ab'.repeat(32)}` },
      links: { app_icon_url: '/icon.svg' },
      license: 'MIT',
    }
    await Deno.writeTextFile(appMetaPath, `${JSON.stringify(appMeta, null, 2)}\n`)

    const pikgMetaPath = join(project, 'dapp_meta', 'pikg.json')
    const pikgMeta = JSON.parse(await Deno.readTextFile(pikgMetaPath))
    pikgMeta.sub_pkgs.web.selector = 'linux'
    await Deno.writeTextFile(pikgMetaPath, `${JSON.stringify(pikgMeta, null, 2)}\n`)
    assertEquals(await app.run(['pikg', 'build']), 2)
    envelope = io.takeEnvelope()
    assertEquals(envelope.error.code, 'SCHEMA_VALIDATION_FAILED')
    delete pikgMeta.sub_pkgs.web.selector
    await Deno.writeTextFile(pikgMetaPath, `${JSON.stringify(pikgMeta, null, 2)}\n`)

    const buildExit = await app.run(['pikg', 'build'])
    assertEquals(buildExit, 0, io.stdoutText)
    envelope = io.takeEnvelope()
    assertEquals(envelope.data.ready_for_pack, true)
    assertEquals(envelope.data.subpackage_count, 1)
    assertEquals(authenticationCreated, false)
    const appDoc = JSON.parse(
      await Deno.readTextFile(join(envelope.data.dist_dir, 'APPDOC.json')),
    )
    assertEquals(appDoc.exp, 1_957_680_000)
    assertEquals(appDoc.name, 'demo')
    assertEquals(appDoc.categories, ['web'])
    assertEquals(appDoc.presentation, appMeta.presentation)
    assertEquals(appDoc.pkg_list.web.pkg_id, 'all.web.demo.root.bns.did#0.1.0')

    const packExit = await app.run(['pikg', 'pack'])
    assertEquals(packExit, 0, io.stdoutText)
    envelope = io.takeEnvelope()
    assertEquals(envelope.data.validation, 'passed')
    const pikgPath = envelope.data.pikg_path
    const originalPikg = await Deno.readFile(pikgPath)

    assertEquals(await app.run(['pikg', 'info', pikgPath]), 0)
    envelope = io.takeEnvelope()
    assertEquals(envelope.data.valid, true)
    assertEquals(envelope.data.offline_content_validation, 'passed')
    assertEquals(envelope.data.signature_validation, 'not-present')
    assertEquals(envelope.data.publication_validation, 'not-checked')

    const tamperedPikg = originalPikg.slice()
    tamperedPikg[Math.floor(tamperedPikg.length / 2)] ^= 1
    const tamperedPath = join(project, 'tampered.pikg')
    await Deno.writeFile(tamperedPath, tamperedPikg)
    assertEquals(await app.run(['pikg', 'info', tamperedPath]), 6)
    envelope = io.takeEnvelope()
    assertEquals(envelope.error.code, 'INVALID_PACKAGE')

    const payloadPath = join(project, 'dapp_dist', 'web.tar.gz')
    const originalPayload = await Deno.readFile(payloadPath)
    await Deno.writeFile(payloadPath, new Uint8Array([...originalPayload, 0]))
    assertEquals(await app.run(['pikg', 'pack']), 6)
    io.takeEnvelope()
    assertEquals(await Deno.readFile(pikgPath), originalPikg)
    await Deno.writeFile(payloadPath, originalPayload)

    assertEquals(await app.run(['--non-interactive', 'pikg', 'clean']), 4)
    envelope = io.takeEnvelope()
    assertEquals(envelope.error.code, 'CONFIRMATION_REQUIRED')
    assertEquals(await app.run(['--non-interactive', '--yes', 'pikg', 'clean']), 0)
    envelope = io.takeEnvelope()
    assertEquals(envelope.data.removed, true)
    await assertRejects(() => Deno.stat(join(project, 'dapp_dist')))
    assertEquals(authenticationCreated, false)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('pikg Docker workflow pins the image ID and never uses a session', async () => {
  const root = await Deno.makeTempDir()
  try {
    const project = join(root, 'docker-demo')
    await Deno.mkdir(project)
    const docker = new FakeDocker()
    const io = new CaptureStdio()
    const app = new BuckyOSToolApplication({
      cwd: project,
      homeDir: join(root, 'home'),
      environment: { HOME: join(root, 'home') },
      stdio: io,
      pikg: { docker, now: () => 1_800_000_000 },
      createAuthentication: () => {
        throw new Error('PIKG must not create authentication')
      },
    })
    assertEquals(
      await app.run([
        '--non-interactive',
        'pikg',
        'init',
        '.',
        '--owner',
        'did:bns:root',
        '--kind',
        'docker',
        '--source',
        'local/demo:0.1.0-amd64',
      ]),
      0,
    )
    io.takeEnvelope()
    assertEquals(docker.saveReferences, [])
    const buildExit = await app.run(['pikg', 'build'])
    assertEquals(buildExit, 0, io.stdoutText)
    io.takeEnvelope()
    assertEquals(docker.saveReferences, [docker.info.id])
    assert(docker.inspectReferences.length >= 3)
    const packExit = await app.run(['pikg', 'pack'])
    assertEquals(packExit, 0, io.stdoutText)
    const packed = io.takeEnvelope()
    assertEquals(await app.run(['pikg', 'info', packed.data.pikg_path]), 0)
    const inspected = io.takeEnvelope()
    assertEquals(inspected.data.subpackages[0].docker_image_digest, docker.info.id)
    assertEquals(inspected.data.subpackages[0].selector.arch, 'x86_64')
    assertEquals(
      inspected.data.subpackages[0].pkg_id,
      'nightly-linux-amd64.amd64_docker_image.docker-demo.root.bns.did#0.1.0',
    )
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('Rust and TypeScript share the canonical AppDoc v1 golden identity', async () => {
  const fixture = new URL('../fixtures/appdoc-v1.json', import.meta.url)
  const expectedId = new URL('../fixtures/appdoc-v1.object-id', import.meta.url)
  const appDoc = JSON.parse(await Deno.readTextFile(fixture))
  validateAppDocShape(appDoc)
  assertEquals(appDocObjectId(appDoc), (await Deno.readTextFile(expectedId)).trim())
})

Deno.test('AppDoc accepts BaseContentObject metadata but rejects PackageMeta fields', async () => {
  const fixture = new URL('../fixtures/appdoc-v1.json', import.meta.url)
  const appDoc = JSON.parse(await Deno.readTextFile(fixture))
  const contentDoc = {
    ...appDoc,
    name: 'portable-app-release',
    copyright: 'Copyright 2026 Example',
    tags: ['productivity', 'web'],
    categories: ['web'],
    base_on: `appdoc:${'07'.repeat(32)}`,
    directory: { catalog: {} },
    references: { homepage: {} },
  }
  validateAppDocShape(contentDoc)
  assert(appDocObjectId(contentDoc) !== appDocObjectId(appDoc))
  await assertRejects(() => validateAppDocShape({ ...contentDoc, deps: {} }))
  await assertRejects(() => validateAppDocShape({ ...contentDoc, size: 0, content: '' }))
})

Deno.test('AppDoc presentation follows the Rust field types and rejects malformed metadata', async () => {
  const fixture = new URL('../fixtures/appdoc-v1.json', import.meta.url)
  const appDoc = JSON.parse(await Deno.readTextFile(fixture))
  const presentation: Record<string, unknown> = {
    title: { en: 'Demo', 'zh-CN': '示例' },
    summary: {},
    description: {},
    icons: { small: `cyfile:${'ab'.repeat(32)}` },
    links: { app_icon_url: '/icon.svg' },
    license: 'MIT',
  }
  validateAppDocShape({ ...appDoc, presentation })
  validateAppDocShape({ ...appDoc, presentation: null })
  for (const url of ['https://example.com/icon.svg', 'data:image/png;base64,aWNvbg==']) {
    validateAppDocShape({ ...appDoc, presentation: { ...presentation, links: { app_icon_url: url } } })
  }
  for (const field of Object.keys(presentation)) {
    const incomplete = { ...presentation }
    delete incomplete[field]
    await assertRejects(
      () => validateAppDocShape({ ...appDoc, presentation: incomplete }),
      'INVALID_PACKAGE',
    )
  }
  await assertRejects(
    () => validateAppDocShape({ ...appDoc, presentation: { ...presentation, unknown: true } }),
    'SCHEMA_VALIDATION_FAILED',
  )
  for (const invalid of [
    'invalid',
    [],
    { ...presentation, title: [] },
    { ...presentation, summary: { en: 1 } },
    { ...presentation, description: null },
    { ...presentation, icons: { small: '/icon.svg' } },
    { ...presentation, links: { app_icon_url: 1 } },
    { ...presentation, license: false },
  ]) {
    await assertRejects(
      () => validateAppDocShape({ ...appDoc, presentation: invalid }),
      'INVALID_PACKAGE',
    )
  }
})

Deno.test('pikg clean rejects protected, symlinked, and unmanaged targets', async () => {
  const root = await Deno.makeTempDir()
  try {
    const project = join(root, 'clean-demo')
    const source = join(project, 'web', 'dist')
    await Deno.mkdir(source, { recursive: true })
    await Deno.writeTextFile(join(source, 'index.html'), 'safe')
    const io = new CaptureStdio()
    const app = new BuckyOSToolApplication({
      cwd: project,
      homeDir: join(root, 'home'),
      environment: { HOME: join(root, 'home') },
      stdio: io,
      pikg: { now: () => 1_800_000_000 },
      createAuthentication: () => {
        throw new Error('PIKG must not create authentication')
      },
    })
    assertEquals(
      await app.run([
        '--non-interactive',
        'pikg',
        'init',
        '.',
        '--owner',
        'did:bns:root',
        '--kind',
        'static-web',
        '--source',
        './web/dist',
      ]),
      0,
    )
    io.takeEnvelope()
    assertEquals(await app.run(['pikg', 'build']), 0)
    io.takeEnvelope()

    const metaPath = join(project, 'dapp_meta', 'pikg.json')
    const original = JSON.parse(await Deno.readTextFile(metaPath))
    const rejectTarget = async (outputDir: string) => {
      await Deno.writeTextFile(
        metaPath,
        `${JSON.stringify({ ...original, output_dir: outputDir }, null, 2)}\n`,
      )
      assertEquals(await app.run(['--non-interactive', '--yes', 'pikg', 'clean']), 6)
      assertEquals(io.takeEnvelope().error.code, 'UNSAFE_CLEAN_TARGET')
    }

    await rejectTarget('..')
    await rejectTarget('../web/dist')
    await rejectTarget(parsePath(project).root)

    const unmanaged = join(project, 'user-output')
    await Deno.mkdir(unmanaged)
    await Deno.writeTextFile(join(unmanaged, 'keep.txt'), 'keep')
    await rejectTarget('../user-output')
    assertEquals(await Deno.readTextFile(join(unmanaged, 'keep.txt')), 'keep')

    if (Deno.build.os !== 'windows') {
      const linked = join(project, 'linked-output')
      await Deno.symlink(join(project, 'dapp_dist'), linked)
      await rejectTarget('../linked-output')
      assert((await Deno.lstat(linked)).isSymlink)
    }
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('deterministic tar.gz rejects source symlinks that escape the input root', async () => {
  const root = await Deno.makeTempDir()
  try {
    const source = join(root, 'source')
    await Deno.mkdir(join(source, 'nested'), { recursive: true })
    await Deno.writeTextFile(join(source, 'nested', 'b.txt'), 'b')
    await Deno.writeTextFile(join(source, 'a.txt'), 'a')
    const first = join(root, 'first.tar.gz')
    const second = join(root, 'second.tar.gz')
    await createDeterministicTarGz(source, first)
    await createDeterministicTarGz(source, second)
    assertEquals((await digestFile(first)).sha256, (await digestFile(second)).sha256)
    const tarBytes = await new Response(
      new Blob([await Deno.readFile(first)]).stream().pipeThrough(new DecompressionStream('gzip')),
    ).bytes()
    const decoder = new TextDecoder()
    const entries = new Map<string, string>()
    let offset = 0
    while (offset + 512 <= tarBytes.length && tarBytes[offset] !== 0) {
      const header = tarBytes.subarray(offset, offset + 512)
      const name = decoder.decode(header.subarray(0, 100)).replace(/\0.*$/, '')
      const sizeText = decoder.decode(header.subarray(124, 136)).replace(/\0.*$/, '').trim()
      const size = Number.parseInt(sizeText, 8)
      offset += 512
      if (!name.endsWith('/')) {
        entries.set(name, decoder.decode(tarBytes.subarray(offset, offset + size)))
      }
      offset += Math.ceil(size / 512) * 512
    }
    assertEquals(entries.get('a.txt'), 'a')
    assertEquals(entries.get('nested/b.txt'), 'b')

    if (Deno.build.os !== 'windows') {
      const outside = join(root, 'outside.txt')
      await Deno.writeTextFile(outside, 'outside')
      await Deno.symlink(outside, join(source, 'escape'))
      await assertRejects(
        () => createDeterministicTarGz(source, join(root, 'unsafe.tar.gz')),
        'INVALID_SOURCE',
      )
    }
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('pikg command schemas are local and expose the doctor workflow', () => {
  const app = new BuckyOSToolApplication({ environment: {} })
  const module = app.registry.modules().find((candidate) => candidate.name === 'pikg')
  assert(module)
  assertEquals(module.commands.map((command) => command.verb), [
    'doctor',
    'init',
    'build',
    'pack',
    'info',
    'clean',
  ])
  for (const command of module.commands) {
    assertEquals(command.requiresSession, false)
    assertEquals(command.execution, 'local')
    assertEquals(command.networkAccess, false)
  }
})

Deno.test('content handler declarations reject unsafe entries and preserve normal declarations', async () => {
  const { validateContentHandlers } = await import('../modules/pikg_protocol.ts')
  const valid = [{ handler_id: 'text', version: 1, selectors: [{ mime: 'text/*' }], intents: { open: { entry: { type: 'web', path: '/open?src={source}' }, priority: 60 } } }]
  assertEquals(validateContentHandlers(valid, []), valid)
  for (const path of ['//evil.example/open', '/%2e%2e/secret', '/\\evil', '/open#x']) {
    const invalid = structuredClone(valid); invalid[0].intents.open.entry.path = path
    let rejected = false
    try { validateContentHandlers(invalid, []) } catch { rejected = true }
    assert(rejected)
  }
  const duplicate = [...valid, ...valid]
  let rejected = false
  try { validateContentHandlers(duplicate, []) } catch { rejected = true }
  assert(rejected)
})

Deno.test('aiws-controls packages: init writes a control skeleton, pack checks the bundle, info reports it', async () => {
  const root = await Deno.makeTempDir()
  try {
    const project = join(root, 'kpi-pack')
    await Deno.mkdir(project, { recursive: true })
    const io = new CaptureStdio()
    const app = new BuckyOSToolApplication({
      cwd: project,
      homeDir: join(root, 'home'),
      environment: { HOME: join(root, 'home') },
      stdio: io,
      pikg: { now: () => 1_800_000_000 },
      createAuthentication: () => {
        throw new Error('PIKG must not create authentication')
      },
    })
    assertEquals(await app.run(['--non-interactive', 'pikg', 'init', '.', '--owner', 'did:bns:alice', '--kind', 'aiws-controls', '--source', './aiws']), 0, io.stdoutText)
    let envelope = io.takeEnvelope()
    assertEquals(envelope.data.subpackage.key, 'aiws')
    assertEquals(envelope.data.app.categories, ['aiws'])
    const manifest = JSON.parse(await Deno.readTextFile(join(project, 'aiws', 'aiws-manifest.json')))
    assertEquals(manifest.controls[0].ident, 'did:bns:alice#kpi-pack')
    assertEquals(await app.run(['pikg', 'build']), 0, io.stdoutText)
    envelope = io.takeEnvelope()
    const appDoc = JSON.parse(await Deno.readTextFile(join(envelope.data.dist_dir, 'APPDOC.json')))
    assertEquals(appDoc.app_type, 'aiws')
    assertEquals(Object.keys(appDoc.pkg_list), ['aiws'])
    assertEquals(await app.run(['pikg', 'pack', envelope.data.dist_dir]), 0, io.stdoutText)
    envelope = io.takeEnvelope()
    const pikgPath = envelope.data.pikg_path
    assertEquals(await app.run(['pikg', 'info', pikgPath]), 0, io.stdoutText)
    envelope = io.takeEnvelope()
    assertEquals(envelope.data.app.app_type, 'aiws')
    assertEquals(envelope.data.aiws.controls[0].ident, 'did:bns:alice#kpi-pack')

    // a control changed behind the manifest's digest: the snapshot no longer builds
    await Deno.writeTextFile(join(project, 'aiws', 'controls', 'kpi-pack', 'declarative.json'), '{"items":[]}')
    assertEquals(await app.run(['pikg', 'build']), 6, io.stdoutText)
    envelope = io.takeEnvelope()
    assertEquals(envelope.error.code, 'INVALID_PACKAGE')
    assert(String(envelope.error.message).includes('digest'), envelope.error.message)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('aiws-controls packages: --composite starts with a composite control that packs and reads back', async () => {
  const root = await Deno.makeTempDir()
  try {
    const project = join(root, 'board-pack')
    await Deno.mkdir(project, { recursive: true })
    const io = new CaptureStdio()
    const app = new BuckyOSToolApplication({
      cwd: project,
      homeDir: join(root, 'home'),
      environment: { HOME: join(root, 'home') },
      stdio: io,
      pikg: { now: () => 1_800_000_000 },
      createAuthentication: () => {
        throw new Error('PIKG must not create authentication')
      },
    })
    assertEquals(await app.run(['--non-interactive', 'pikg', 'init', '.', '--owner', 'did:bns:alice', '--kind', 'aiws-controls', '--source', './aiws', '--composite']), 0, io.stdoutText)
    io.takeEnvelope()
    const component = JSON.parse(await Deno.readTextFile(join(project, 'aiws', 'controls', 'board-pack', 'component.json')))
    assertEquals([component.manifest_version, component.kind, component.entry], [3, 'composite', 'composition.json'])
    assertEquals(await app.run(['pikg', 'build']), 0, io.stdoutText)
    let envelope = io.takeEnvelope()
    assertEquals(await app.run(['pikg', 'pack', envelope.data.dist_dir]), 0, io.stdoutText)
    envelope = io.takeEnvelope()
    assertEquals(await app.run(['pikg', 'info', envelope.data.pikg_path]), 0, io.stdoutText)
    envelope = io.takeEnvelope()
    assertEquals(envelope.data.aiws.controls[0].kind, 'composite')
    // a composition the service would refuse fails the package check as well
    const compositionPath = join(project, 'aiws', 'controls', 'board-pack', 'composition.json')
    const composition = JSON.parse(await Deno.readTextFile(compositionPath))
    composition.events = {}
    await Deno.writeTextFile(compositionPath, JSON.stringify(composition))
    assertEquals(await app.run(['pikg', 'build']), 6, io.stdoutText)
    envelope = io.takeEnvelope()
    assert(String(envelope.error.message).includes('digest') || String(envelope.error.message).includes('events'), envelope.error.message)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('aiws-controls packages: Workspace templates are checked with the bundle (shape, snapshot, digest, controls, stray files)', async () => {
  const root = await Deno.makeTempDir()
  try {
    const project = join(root, 'team-pack')
    await Deno.mkdir(project, { recursive: true })
    const io = new CaptureStdio()
    const app = new BuckyOSToolApplication({
      cwd: project,
      homeDir: join(root, 'home'),
      environment: { HOME: join(root, 'home') },
      stdio: io,
      pikg: { now: () => 1_800_000_000 },
      createAuthentication: () => {
        throw new Error('PIKG must not create authentication')
      },
    })
    assertEquals(await app.run(['--non-interactive', 'pikg', 'init', '.', '--owner', 'did:bns:alice', '--kind', 'aiws-controls', '--source', './aiws']), 0, io.stdoutText)
    io.takeEnvelope()
    const bundle = join(project, 'aiws')
    const manifestPath = join(bundle, 'aiws-manifest.json')
    const manifest = JSON.parse(await Deno.readTextFile(manifestPath))
    assertEquals(manifest.manifest_version, 3)
    await Deno.mkdir(join(bundle, 'templates', 'team', 'objects'), { recursive: true })
    const snapshot = JSON.stringify({ format: 'aiws-template/1', content_root: 'r', entities: [] })
    await Deno.writeTextFile(join(bundle, 'templates', 'team', 'snapshot.json'), snapshot)
    await Deno.writeTextFile(join(bundle, 'templates', 'team', 'objects', 'o1'), '{}')
    const encoder = new TextEncoder()
    const digest = await aiwsTemplateDigest([['templates/team/snapshot.json', encoder.encode(snapshot)], ['templates/team/objects/o1', encoder.encode('{}')]], 'team')
    const template = { id: 'team', title: 'Team board', snapshot: 'templates/team/snapshot.json', digest, requires: { controls: [manifest.controls[0].ident] }, params: { team_name: { type: 'string', default: 'Team' } }, reset: { tables: ['tasks'] } }
    const writeManifest = (m: unknown) => Deno.writeTextFile(manifestPath, JSON.stringify(m))
    const refused = async (needle: string) => {
      assertEquals(await app.run(['pikg', 'build']), 6, io.stdoutText)
      const envelope = io.takeEnvelope()
      assertEquals(envelope.error.code, 'INVALID_PACKAGE')
      assert(String(envelope.error.message).includes(needle), envelope.error.message)
    }

    await writeManifest({ ...manifest, workspace_templates: [template] })
    assertEquals(await app.run(['pikg', 'build']), 0, io.stdoutText)
    let envelope = io.takeEnvelope()
    assertEquals(await app.run(['pikg', 'pack', envelope.data.dist_dir]), 0, io.stdoutText)
    envelope = io.takeEnvelope()
    assertEquals(await app.run(['pikg', 'info', envelope.data.pikg_path]), 0, io.stdoutText)
    envelope = io.takeEnvelope()
    assertEquals(envelope.data.aiws.manifest_version, 3)
    assertEquals(envelope.data.aiws.templates.map((t: { id: string; digest: string }) => [t.id, t.digest]), [['team', digest]])

    await writeManifest({ ...manifest, manifest_version: 2, workspace_templates: [template] })
    await refused('need manifest_version 3')
    await writeManifest({ ...manifest, workspace_templates: [{ ...template, requires: { controls: ['did:bns:bob#gauge'] } }] })
    await refused('is not a control of this manifest')
    await writeManifest({ ...manifest, workspace_templates: [{ ...template, snapshot: 'templates/team/other.json' }] })
    await refused('snapshot must be templates/team/snapshot.json')
    await writeManifest({ ...manifest, workspace_templates: [template] })
    await Deno.writeTextFile(join(bundle, 'templates', 'team', 'objects', 'o2'), '[]')
    await refused('template digest')
    await Deno.remove(join(bundle, 'templates', 'team', 'objects', 'o2'))
    await Deno.mkdir(join(bundle, 'templates', 'loose'), { recursive: true })
    await Deno.writeTextFile(join(bundle, 'templates', 'loose', 'snapshot.json'), snapshot)
    await refused('belongs to no control or template')
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

function extToolsApp(root: string, project: string) {
  const io = new CaptureStdio()
  const app = new BuckyOSToolApplication({
    cwd: project,
    homeDir: join(root, 'home'),
    environment: { HOME: join(root, 'home') },
    stdio: io,
    pikg: { now: () => 1_800_000_000 },
    createAuthentication: () => {
      throw new Error('PIKG must not create authentication')
    },
  })
  return { app, io }
}

// `pikg init --kind ext-tools` starts from the host's platform, and Windows on ARM is not one of the five.
const hostHasNoExtToolsPlatform = Deno.build.os === 'windows' && Deno.build.arch === 'aarch64'

async function asHost<T>(platform: string, arch: string, run: () => Promise<T>): Promise<T> {
  const real = getHost()
  resetHostForTest()
  installHost(Object.create(real, { platform: { value: platform }, arch: { value: arch } }))
  try {
    return await run()
  } finally {
    resetHostForTest()
    installHost(real)
  }
}

const extToolsInitArgs = (name: string) => ['--non-interactive', 'pikg', 'init', '.', '--name', name, '--owner', 'did:bns:alice', '--kind', 'ext-tools', '--source', '.']

async function initExtTools(root: string, name = 'ext-media') {
  const project = join(root, name)
  await Deno.mkdir(project, { recursive: true })
  const { app, io } = extToolsApp(root, project)
  assertEquals(await app.run(extToolsInitArgs(name)), 0, io.stdoutText)
  const envelope = io.takeEnvelope()
  const platform: string = envelope.data.subpackage.source.platform
  return { project, app, io, envelope, platform, payload: join(project, 'payload', platform) }
}

function failedChecks(data: { checks: Array<Record<string, unknown>> }): string[] {
  return data.checks.filter((check) => check.status === 'error').flatMap((check) => (check.errors ?? [check.detail]) as string[])
}

Deno.test('ext-tools packages: init writes a package that doctors, builds, packs and reads back', { ignore: hostHasNoExtToolsPlatform }, async () => {
  const root = await Deno.makeTempDir()
  try {
    const { project, app, io, envelope, platform, payload } = await initExtTools(root)
    assertEquals(envelope.data.app.categories, ['ext_tools'])
    assertEquals(envelope.data.subpackage.key, `ext_tools_${platform.replace('-', '_')}`)
    const manifest = JSON.parse(await Deno.readTextFile(join(project, 'ext-manifest.json')))
    assertEquals(manifest.schema, 'buckyos.ext_tools/1')
    assertEquals(manifest.provides[0].command, 'ext-media')
    assertEquals(await Deno.readTextFile(join(payload, 'ext-manifest.json')), await Deno.readTextFile(join(project, 'ext-manifest.json')))

    assertEquals(await app.run(['pikg', 'doctor']), 0, io.stdoutText)
    let result = io.takeEnvelope()
    assertEquals(result.data.healthy, true, JSON.stringify(result.data.checks))
    const names = result.data.checks.map((check: { name: string }) => check.name)
    assert(names.includes('ext_tools_manifest') && names.includes('ext_tools_payload'), names.join())
    assertEquals(result.data.checks.find((check: { name: string }) => check.name === 'ext_tools_catalog').status, 'skipped')

    assertEquals(await app.run(['pikg', 'build']), 0, io.stdoutText)
    result = io.takeEnvelope()
    const appDoc = JSON.parse(await Deno.readTextFile(join(result.data.dist_dir, 'APPDOC.json')))
    assertEquals(appDoc.app_type, 'ext_tools')
    assertEquals(Object.keys(appDoc.pkg_list), [`ext_tools_${platform.replace('-', '_')}`])
    assertEquals(await app.run(['pikg', 'pack', result.data.dist_dir]), 0, io.stdoutText)
    result = io.takeEnvelope()
    assertEquals(await app.run(['pikg', 'info', result.data.pikg_path]), 0, io.stdoutText)
    result = io.takeEnvelope()
    assertEquals(result.data.app.app_type, 'ext_tools')
    assertEquals(result.data.ext_tools.id, 'ext-media')
    assertEquals(result.data.ext_tools.provides[0].smoke, 'smoke/ext-media.sh')
    assertEquals(result.data.subpackages[0].selector, envelope.data.subpackage.selector)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('ext-tools packages: a Windows host gets a .cmd launcher and a .ps1 smoke, and they doctor, build and pack', async () => {
  const root = await Deno.makeTempDir()
  try {
    await asHost('windows', 'x86_64', async () => {
      const { project, app, io, envelope, platform, payload } = await initExtTools(root)
      assertEquals(platform, 'windows-x86_64')
      assertEquals(envelope.data.subpackage.key, 'ext_tools_windows_x86_64')
      assert((await Deno.stat(join(payload, 'bin', 'ext-media.cmd'))).isFile)
      assert((await Deno.stat(join(payload, 'smoke', 'ext-media.ps1'))).isFile)
      const manifest = JSON.parse(await Deno.readTextFile(join(project, 'ext-manifest.json')))
      assertEquals(manifest.provides[0].smoke, 'smoke/ext-media.sh')

      assertEquals(await app.run(['pikg', 'doctor']), 0, io.stdoutText)
      const doctor = io.takeEnvelope()
      assertEquals(doctor.data.healthy, true, JSON.stringify(failedChecks(doctor.data)))
      assertEquals(await app.run(['pikg', 'build']), 0, io.stdoutText)
      const build = io.takeEnvelope()
      assertEquals(await app.run(['pikg', 'pack', build.data.dist_dir]), 0, io.stdoutText)
      assertEquals(io.takeEnvelope().ok, true)
    })
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('ext-tools packages: init refuses a host that no payload platform covers', async () => {
  const root = await Deno.makeTempDir()
  try {
    await asHost('windows', 'aarch64', async () => {
      const project = join(root, 'ext-media')
      await Deno.mkdir(project)
      const { app, io } = extToolsApp(root, project)
      assert(await app.run(extToolsInitArgs('ext-media')) !== 0, io.stdoutText)
      assertEquals(io.takeEnvelope().error.code, 'UNSUPPORTED_PLATFORM')
    })
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('ext-tools packages: doctor names what a package gets wrong, and build refuses it', { ignore: hostHasNoExtToolsPlatform }, async () => {
  const root = await Deno.makeTempDir()
  try {
    const { project, app, io, payload } = await initExtTools(root)
    const manifestPath = join(project, 'ext-manifest.json')
    const original = JSON.parse(await Deno.readTextFile(manifestPath))
    const writeManifest = async (value: unknown) => {
      const text = `${JSON.stringify(value, null, 2)}\n`
      await Deno.writeTextFile(manifestPath, text)
      await Deno.writeTextFile(join(payload, 'ext-manifest.json'), text)
    }
    const doctor = async () => {
      assertEquals(await app.run(['pikg', 'doctor']), 0, io.stdoutText)
      return io.takeEnvelope().data
    }
    const expectProblem = (data: { healthy: boolean; checks: Array<Record<string, unknown>> }, needle: string) => {
      assertEquals(data.healthy, false)
      assert(failedChecks(data).some((line) => line.includes(needle)), `${needle}: ${JSON.stringify(failedChecks(data))}`)
    }

    // a command with no launcher
    await writeManifest({ ...original, provides: [...original.provides, { command: 'ffmpeg', version_probe: 'ffmpeg -version' }] })
    expectProblem(await doctor(), 'bin/ffmpeg: the launcher of a provided command is missing')
    assertEquals(await app.run(['pikg', 'build']), 6, io.stdoutText)
    const failure = io.takeEnvelope()
    assertEquals(failure.error.code, 'INVALID_PACKAGE')
    assert(String(failure.error.message).includes('bin/ffmpeg'), failure.error.message)

    // the launcher is there but does not run: Windows has no execute bit to check
    await Deno.writeTextFile(join(payload, 'bin', 'ffmpeg'), '#!/bin/sh\nexit 0\n', { mode: 0o644 })
    if (Deno.build.os !== 'windows') {
      await Deno.chmod(join(payload, 'bin', 'ffmpeg'), 0o644)
      expectProblem(await doctor(), 'bin/ffmpeg: the launcher is not executable')
      await Deno.chmod(join(payload, 'bin', 'ffmpeg'), 0o755)
    }
    assertEquals((await doctor()).healthy, true)

    // a launcher that names the machine it was built on
    await Deno.writeTextFile(join(payload, 'bin', 'ffmpeg'), `#!/bin/sh\nexec ${join(project, 'payload', 'x')} "$@"\n`)
    expectProblem(await doctor(), 'on the machine that built it')
    await Deno.writeTextFile(join(payload, 'bin', 'ffmpeg'), '#!/bin/sh\nexec /home/ci/ffmpeg "$@"\n')
    expectProblem(await doctor(), '/home/')
    await Deno.writeTextFile(join(payload, 'bin', 'ffmpeg'), '#!/bin/sh\nexec "$(dirname "$0")/../store/ext-media/ffmpeg" "$@"\n')
    assertEquals((await doctor()).healthy, true)

    // a launcher the manifest does not declare would be a command nothing knows about
    await Deno.writeTextFile(join(payload, 'bin', 'ffplay'), '#!/bin/sh\n', { mode: 0o755 })
    expectProblem(await doctor(), 'bin/ffplay: not in provides')
    await Deno.remove(join(payload, 'bin', 'ffplay'))

    // the smoke script it promises
    await writeManifest({ ...original, provides: [...original.provides, { command: 'ffmpeg', version_probe: 'ffmpeg -version', smoke: 'smoke/ffmpeg.sh' }] })
    expectProblem(await doctor(), Deno.build.os === 'windows' ? 'smoke/ffmpeg.ps1' : 'smoke/ffmpeg.sh')
    await writeManifest({ ...original, provides: [...original.provides, { command: 'ffmpeg', version_probe: 'ffmpeg -version' }] })

    // only its own tree
    await Deno.mkdir(join(payload, 'store', 'pandoc'), { recursive: true })
    await Deno.writeTextFile(join(payload, 'uv-cache'), '')
    let data = await doctor()
    expectProblem(data, 'store/pandoc: a package only writes store/ext-media/')
    expectProblem(data, 'uv-cache: a package only holds')
    await Deno.remove(join(payload, 'store', 'pandoc'))
    await Deno.remove(join(payload, 'uv-cache'))

    // a symlink cannot reach out of the payload
    if (Deno.build.os !== 'windows') {
      await Deno.symlink('/bin/sh', join(payload, 'bin', 'ffmpeg-link'))
      expectProblem(await doctor(), 'bin/ffmpeg-link: a symlink out of the payload')
      await Deno.remove(join(payload, 'bin', 'ffmpeg-link'))
    }

    // a payload copy behind the package's manifest, and an id that is not the App's
    await Deno.writeTextFile(join(payload, 'ext-manifest.json'), `${JSON.stringify(original)}\n`)
    expectProblem(await doctor(), 'differs from the package')
    await writeManifest({ ...original, id: 'other', provides: [...original.provides, { command: 'ffmpeg', version_probe: 'ffmpeg -version' }] })
    expectProblem(await doctor(), 'is not the App name')
    // a command listed twice and a field the format does not have
    await writeManifest({ ...original, provides: [original.provides[0], original.provides[0]], writes: ['/usr/bin'] })
    data = await doctor()
    expectProblem(data, 'listed twice')
    expectProblem(data, 'writes is not a field')
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('ext-tools packages: a catalog answers requires and same-named commands', { ignore: hostHasNoExtToolsPlatform }, async () => {
  const root = await Deno.makeTempDir()
  try {
    const { project, app, io, payload } = await initExtTools(root)
    const catalog = join(root, 'catalog')
    await Deno.mkdir(join(catalog, 'ext-core'), { recursive: true })
    const other = {
      schema: 'buckyos.ext_tools/1', id: 'ext-core', version: '1.0.0', requires: [], conflicts: [],
      provides: [{ command: 'ext-media', version_probe: 'ext-media --version' }], platforms: ['linux-x86_64'],
    }
    await Deno.writeTextFile(join(catalog, 'ext-core', 'ext-manifest.json'), JSON.stringify(other))
    await Deno.writeTextFile(join(catalog, 'Dockerfile'), 'a catalog directory also holds other files')
    await Deno.mkdir(join(catalog, 'not-a-package'))
    const doctor = async () => {
      assertEquals(await app.run(['pikg', 'doctor', '--catalog', catalog]), 0, io.stdoutText)
      return io.takeEnvelope().data
    }
    const manifestPath = join(project, 'ext-manifest.json')
    const writeManifest = async (value: unknown) => {
      const text = `${JSON.stringify(value, null, 2)}\n`
      await Deno.writeTextFile(manifestPath, text)
      await Deno.writeTextFile(join(payload, 'ext-manifest.json'), text)
    }
    const original = JSON.parse(await Deno.readTextFile(manifestPath))

    let data = await doctor()
    assertEquals(data.healthy, false)
    assert(failedChecks(data).some((line) => line.includes('ext-core also provides ext-media')), JSON.stringify(failedChecks(data)))

    // either side saying `conflicts` is enough: the two are never enabled together
    await writeManifest({ ...original, conflicts: ['ext-core'] })
    data = await doctor()
    assertEquals(data.healthy, true, JSON.stringify(failedChecks(data)))
    assertEquals(data.checks.find((check: { name: string }) => check.name === 'ext_tools_catalog').packages, ['ext-core'])

    await writeManifest({ ...original, conflicts: ['ext-core'], requires: [{ id: 'ext-absent', version: '>=1.0' }] })
    data = await doctor()
    assert(failedChecks(data).some((line) => line.includes('requires ext-absent: not in the catalog')), JSON.stringify(failedChecks(data)))
    await writeManifest({ ...original, conflicts: ['ext-core'], requires: [{ id: 'ext-core', version: '>=1.0' }] })
    assertEquals((await doctor()).healthy, true)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('a payload too large to hold is listed from a stream, whatever its chunks', async () => {
  const root = await Deno.makeTempDir()
  try {
    const source = join(root, 'source')
    await Deno.mkdir(join(source, 'bin'), { recursive: true })
    await Deno.writeTextFile(join(source, 'bin', 'tool'), '#!/bin/sh\n', { mode: 0o755 })
    await Deno.writeTextFile(join(source, 'ext-manifest.json'), '{"id":"x"}')
    await Deno.writeFile(join(source, 'blob'), new Uint8Array(3 * 1024 * 1024))
    await Deno.writeFile(join(source, 'empty'), new Uint8Array())
    const tar = join(root, 'payload.tar.gz')
    await createDeterministicTarGz(source, tar)
    const bytes = await Deno.readFile(tar)
    for (const chunkSize of [1, 7, 513, bytes.length]) {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (let offset = 0; offset < bytes.length; offset += chunkSize) controller.enqueue(bytes.subarray(offset, offset + chunkSize))
          controller.close()
        },
      })
      const listing = await listTarGzStream(stream, 16 * 1024 * 1024, (path) => path !== 'blob')
      assertEquals([...listing.files.keys()].sort(), ['bin/tool', 'blob', 'empty', 'ext-manifest.json'])
      assertEquals(listing.files.get('bin/tool')?.executable, Deno.build.os !== 'windows')
      assertEquals(listing.files.get('blob')?.size, 3 * 1024 * 1024)
      assertEquals(new TextDecoder().decode(listing.captured.get('ext-manifest.json')), '{"id":"x"}')
      assertEquals(listing.captured.has('blob'), false)
      assertEquals(listing.captured.get('empty')?.length, 0)
      assert(listing.directories.has('bin'))
    }
    const limited = new Response(bytes).body!
    await assertRejects(() => listTarGzStream(limited, 1024, () => false))
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('an ext_tools AppDoc carries only its platform payloads', () => {
  const objid = `pkg:${'0'.repeat(64)}`
  const appDoc: Record<string, unknown> = {
    schema_version: 1, doc_type: 'app', did: 'did:bns:ext-core.alice', name: 'ext-core', version: '1.0.0', app_type: 'ext_tools', owner: 'did:bns:alice',
    controller: 'did:bns:alice', author: 'did:bns:alice', show_name: 'ext-core', selector_type: 'single', categories: ['ext_tools'],
    create_time: 1, last_update_time: 1, exp: 2, service_config_tips: {},
    pkg_list: { ext_tools_linux_x86_64: { pkg_objid: objid }, ext_tools_darwin_arm64: { pkg_objid: objid } },
  }
  validateAppDocShape(appDoc)
  const refused = (pkgList: unknown) => {
    try {
      validateAppDocShape({ ...appDoc, pkg_list: pkgList })
    } catch {
      return true
    }
    return false
  }
  assert(refused({ ext_tools_linux_x86_64: { pkg_objid: objid }, web: { pkg_objid: objid } }), 'another sub package')
  assert(refused({ ext_tools_windows_aarch64: { pkg_objid: objid } }), 'a platform that does not exist')
  let strayRefused = false
  try {
    validateAppDocShape({ ...appDoc, app_type: 'web', categories: ['web'], pkg_list: { web: { pkg_objid: objid }, ext_tools_linux_x86_64: { pkg_objid: objid } } })
  } catch {
    strayRefused = true
  }
  assert(strayRefused, 'a payload of an extension package in another App')
})

Deno.test('an aiws AppDoc carries exactly the aiws sub package', () => {
  const appDoc: Record<string, unknown> = {
    schema_version: 1, doc_type: 'app', did: 'did:bns:kpi.alice', name: 'kpi', version: '0.1.0', app_type: 'aiws', owner: 'did:bns:alice',
    controller: 'did:bns:alice', author: 'did:bns:alice', show_name: 'kpi', selector_type: 'single', categories: ['aiws'],
    create_time: 1, last_update_time: 1, exp: 2, service_config_tips: {}, permissions: [],
    pkg_list: { aiws: { pkg_objid: `pkg:${'0'.repeat(64)}` } },
  }
  validateAppDocShape(appDoc)
  appDoc.pkg_list = { aiws: { pkg_objid: `pkg:${'0'.repeat(64)}` }, web: { pkg_objid: `pkg:${'1'.repeat(64)}` } }
  let failed = false
  try {
    validateAppDocShape(appDoc)
  } catch {
    failed = true
  }
  assert(failed, 'an aiws package with another sub package must be refused')
})

Deno.test('ext-tools packages: a standard command cannot be provided, and a Windows payload smokes with .ps1', async () => {
  const { extToolsManifestErrors, extToolsPayloadErrors } = await import('../modules/pikg_protocol.ts')
  const manifest = {
    schema: 'buckyos.ext_tools/1', id: 'ext-x', version: '1.0.0', requires: [], conflicts: [],
    provides: [{ command: 'xagent', version_probe: 'xagent --version' }], platforms: ['linux-x86_64'],
  }
  assert(extToolsManifestErrors(manifest).some((error: string) => error.includes('standard command')))
  const windows = { ...manifest, provides: [{ command: 'tool', version_probe: 'tool -v', smoke: 'smoke/tool.sh' }], platforms: ['windows-x86_64'] }
  const tree = (files: string[]) => ({ files: new Map(files.map((path) => [path, { executable: false }])), directories: new Set<string>(), launchers: new Map() })
  assertEquals(extToolsPayloadErrors(windows, 'windows-x86_64', tree(['ext-manifest.json', 'bin/tool.cmd', 'smoke/tool.ps1'])), [])
  assert(extToolsPayloadErrors(windows, 'windows-x86_64', tree(['ext-manifest.json', 'bin/tool.cmd', 'smoke/tool.sh'])).some((error: string) => error.includes('smoke/tool.ps1')))
})

Deno.test('agent-skills packages: init writes a skill in the directory layout, doctor lints the source', async () => {
  const root = await Deno.makeTempDir()
  try {
    const project = join(root, 'hello-skills')
    await Deno.mkdir(project)
    const io = new CaptureStdio()
    const app = new BuckyOSToolApplication({
      cwd: project,
      homeDir: join(root, 'home'),
      environment: { HOME: join(root, 'home') },
      stdio: io,
      pikg: { now: () => 1_800_000_000 },
    })
    const init = ['--non-interactive', 'pikg', 'init', '.', '--owner', 'did:bns:root', '--kind', 'agent-skills', '--source', './skills']
    assertEquals(await app.run(init), 0, io.stdoutText)
    assertEquals(io.takeEnvelope().data.subpackage.source.skeleton, true)
    const skills = join(project, 'skills')
    const skeleton = await Deno.readTextFile(join(skills, 'cmd_skills', 'hello_skills', 'SKILL.md'))
    assert(skeleton.startsWith('---\nname: hello_skills\n'))
    assert(skeleton.includes('A skill is text only') && !skeleton.includes('tools/'), skeleton)
    assertEquals([...Deno.readDirSync(skills)].map((entry) => entry.name), ['cmd_skills'])
    const lint = async () => {
      assertEquals(await app.run(['pikg', 'doctor']), 0, io.stdoutText)
      const data = io.takeEnvelope().data
      const check = data.checks.find((item: { name: string }) => item.name === 'skill_lint')
      return { healthy: data.healthy as boolean, check }
    }
    let result = await lint()
    assertEquals([result.healthy, result.check.status, result.check.warnings], [true, 'ok', []], JSON.stringify(result.check))
    assertEquals(result.check.skills, [{ kind: 'work', name: 'hello_skills', scope: 'work', size: result.check.skills[0].size, commands: [] }])
    assert(/^sha256:[0-9a-f]{64}$/.test(result.check.digest), JSON.stringify(result.check))

    // Warnings do not fail the doctor.
    await Deno.mkdir(join(skills, 'plan_skills', 'plan_hello'), { recursive: true })
    await Deno.writeTextFile(join(skills, 'plan_skills', 'plan_hello', 'SKILL.md'), '---\ndescription: p\n---\nRun `agent-session create-worksession`.\n')
    await Deno.writeTextFile(join(skills, 'cmd_skills', 'hello_skills', 'SKILL.md'), '---\ndescription: d\nscope: ui\n---\n```sh\nffmpeg -i a b\n```\n')
    await Deno.writeTextFile(join(skills, 'README.md'), 'not a skill file')
    result = await lint()
    assertEquals([result.healthy, result.check.status], [true, 'ok'])
    assertEquals(result.check.warnings.map((finding: { code: string }) => finding.code), ['undeclared_commands', 'plan_depends_on_commands', 'ui_scope'])
    assertEquals(result.check.ignored_files, ['README.md'])
    assertEquals(await app.run(['pikg', 'build']), 0, io.stdoutText)
    io.takeEnvelope()

    // What the Agent would refuse does.
    await Deno.writeTextFile(join(skills, 'goal_skills.md'), 'ignored: not in a skill directory')
    await Deno.mkdir(join(skills, 'goal_skills'))
    await Deno.writeTextFile(join(skills, 'goal_skills', 'flat.md'), 'flat')
    result = await lint()
    assertEquals([result.healthy, result.check.status], [false, 'error'])
    assert(result.check.detail.includes('move it to goal_skills/flat/SKILL.md'), result.check.detail)
    await Deno.remove(join(skills, 'goal_skills'), { recursive: true })
    await Deno.mkdir(join(skills, 'tools', 'hello_skills', 'bin'), { recursive: true })
    await Deno.writeTextFile(join(skills, 'tools', 'hello_skills', 'bin', 'hello'), '#!/bin/sh\necho hi\n')
    result = await lint()
    assertEquals([result.healthy, result.check.status, 'digest' in result.check], [false, 'error', false])
    assert(result.check.detail.startsWith('`tools/hello_skills/bin/hello`: a skill is text only and brings no command or install script'), result.check.detail)
    await Deno.remove(join(skills, 'tools'), { recursive: true })
    await Deno.writeFile(join(skills, 'cmd_skills', 'hello_skills', 'references.bin'), new Uint8Array([1]))
    result = await lint()
    assert(result.check.detail.includes('is not a skill file'), result.check.detail)
    await Deno.remove(join(skills, 'cmd_skills', 'hello_skills', 'references.bin'))
    await Deno.mkdir(join(skills, 'cmd_skills', 'hello_skills', 'references'))
    await Deno.writeFile(join(skills, 'cmd_skills', 'hello_skills', 'references', 'logo.png'), new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff]))
    result = await lint()
    assertEquals(result.check.detail, 'cmd_skills/hello_skills/references/logo.png is not UTF-8 text: a skill is text only')
    await Deno.remove(join(skills, 'cmd_skills', 'hello_skills', 'references'), { recursive: true })
    await Deno.writeTextFile(join(skills, 'plan_skills', 'plan_hello', 'SKILL.md'), '---\ncommands: ffmpeg\n---\nx')
    result = await lint()
    assertEquals(result.check.status, 'error')
    assert(result.check.detail.includes('a plan skill declares no `commands`'), result.check.detail)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})
