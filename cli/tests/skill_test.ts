import './setup.ts'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BuckyOSToolApplication, type ToolStdio } from '../core/app.ts'
import { ConfigStore } from '../core/config.ts'
import { createMockCommandContext } from '../core/context.ts'
import { CommandRegistry } from '../core/registry.ts'
import type { RpcCallOptions, ServiceClientRegistry } from '../core/runtime.ts'
import { validateAppDocShape } from '../modules/pikg_protocol.ts'
import { createSkillModule, type SkillModuleDependencies } from '../modules/skill.ts'
import { getHost, HostError, installHost, resetHostForTest } from '../runtime/host.ts'
import { commandsInManual, lintSkillPackage, skillContentDigest, type SkillPackageFile } from '../modules/skill_lint.ts'
import { assert, assertEquals, assertRejects, testConfig } from './test_helpers.ts'

interface RecordedCall {
  service: string
  method: string
  params: Record<string, unknown>
}

class CaptureStdio implements ToolStdio {
  stdoutText = ''
  stdout(value: string): Promise<void> {
    this.stdoutText += value
    return Promise.resolve()
  }
  stderr(): Promise<void> {
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

async function buildPikg(
  root: string,
  name: string,
  kind: string,
  populate: (source: string) => Promise<void>,
): Promise<{ path: string; info: Record<string, unknown> }> {
  const project = join(root, name)
  const source = join(project, 'src')
  await Deno.mkdir(source, { recursive: true })
  await populate(source)
  const io = new CaptureStdio()
  const app = new BuckyOSToolApplication({
    cwd: project,
    homeDir: join(root, 'home'),
    environment: { HOME: join(root, 'home') },
    stdio: io,
    pikg: { now: () => 1_800_000_000 },
  })
  const init = [
    '--non-interactive',
    'pikg',
    'init',
    '.',
    '--owner',
    'did:bns:root',
    '--kind',
    kind,
    '--source',
    './src',
  ]
  assertEquals(await app.run(init), 0, io.stdoutText)
  io.takeEnvelope()
  assertEquals(await app.run(['pikg', 'build']), 0, io.stdoutText)
  io.takeEnvelope()
  assertEquals(await app.run(['pikg', 'pack']), 0, io.stdoutText)
  const path = io.takeEnvelope().data.pikg_path
  assertEquals(await app.run(['pikg', 'info', path]), 0, io.stdoutText)
  return { path, info: io.takeEnvelope().data }
}

function clientsFor(
  calls: RecordedCall[],
  response: (method: string, params: Record<string, unknown>) => unknown,
): ServiceClientRegistry {
  return {
    call: <T>(
      service: string,
      method: string,
      params: Record<string, unknown>,
      _options: RpcCallOptions,
    ) => {
      calls.push({ service, method, params })
      return Promise.resolve(response(method, params) as T)
    },
  }
}

interface RunOptions {
  confirmed?: boolean
  /** An interactive terminal that answers the prompt with this. */
  answer?: string
  dependencies?: SkillModuleDependencies
  stderr?: string[]
}

async function run(
  verb: string,
  input: Record<string, unknown>,
  clients: ServiceClientRegistry,
  options: RunOptions | boolean = {},
): Promise<Record<string, unknown>> {
  const { confirmed = false, answer, dependencies, stderr } = typeof options === 'boolean' ? { confirmed: options } as RunOptions : options
  const registry = new CommandRegistry()
  registry.register(createSkillModule(dependencies))
  const command = registry.get('skill', verb)
  const interactive = answer !== undefined
  const context = createMockCommandContext({
    command,
    config: testConfig({ nonInteractive: !interactive, yes: confirmed }),
    configStore: new ConfigStore(join(tmpdir(), 'buckyos-tool-skill-test')),
    clients,
    traceId: 'skill-test',
  })
  context.confirmed = confirmed
  context.deadline = Date.now() + 10_000
  if (interactive) {
    context.io.inputIsTerminal = true
    context.io.prompt = () => Promise.resolve(answer)
    context.io.stderr = (value) => {
      stderr?.push(value)
      return Promise.resolve()
    }
  }
  return await command.handler(context, input) as Record<string, unknown>
}

const AGENT = 'jarvis.test.zone'
const HELLO_MANUAL = '---\nname: hello\ndescription: say hello\nrequires: nothing\n---\nRun `hello`.\n'

async function writeHello(src: string): Promise<void> {
  await Deno.mkdir(join(src, 'cmd_skills', 'hello', 'references'), { recursive: true })
  await Deno.mkdir(join(src, 'plan_skills', 'plan_hello'), { recursive: true })
  await Deno.writeTextFile(join(src, 'cmd_skills', 'hello', 'SKILL.md'), HELLO_MANUAL)
  await Deno.writeTextFile(join(src, 'cmd_skills', 'hello', 'references', 'more.md'), 'More.\n')
  await Deno.writeTextFile(
    join(src, 'plan_skills', 'plan_hello', 'SKILL.md'),
    '---\nname: plan_hello\ndescription: how to split a greeting\n---\nGreet first, then check.\n',
  )
  await Deno.writeTextFile(join(src, 'README.md'), 'not a skill file')
}

const HELLO_FILES = [
  'cmd_skills/hello/SKILL.md',
  'cmd_skills/hello/references/more.md',
  'plan_skills/plan_hello/SKILL.md',
]

function planOf(params: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const pkg = (params.package ?? { package: `imported-${params.draft}`, version: '' }) as Record<string, unknown>
  return {
    package: pkg.package,
    version: pkg.version,
    digest: 'sha256:00',
    plan_digest: 'sha256:plan',
    skills: [{ kind: 'work', name: 'hello', description: 'say hello', origin: 'installed', baseline: 'standard', size: 12, enabled: true }],
    risk: { level: 'low', findings: [] },
    command_status: [],
    checked_runtime_id: params.runtime_id ?? 'private',
    ...extra,
  }
}

function installClients(calls: RecordedCall[], planExtra: Record<string, unknown> = {}): ServiceClientRegistry {
  return clientsFor(calls, (method, params) => {
    if (method === 'skills.install_plan') return planOf(params, planExtra)
    assertEquals(method, 'skills.install')
    const plan = planOf(params, planExtra)
    return { package: plan.package, version: plan.version, digest: 'sha256:00', skills: plan.skills, plan }
  })
}

Deno.test('skill install plans first, then sends the verified agent_skills payload with the plan digest', async () => {
  const root = await Deno.makeTempDir()
  try {
    const { path, info } = await buildPikg(root, 'hello-skills', 'agent-skills', writeHello)
    const app = info.app as Record<string, unknown>
    assertEquals(app.app_type, 'agent_skills')
    assertEquals(app.name, 'hello-skills')
    assertEquals((info.subpackages as Record<string, unknown>[]).map((item) => item.key), [
      'agent_skills',
    ])

    const calls: RecordedCall[] = []
    const clients = installClients(calls)
    const result = await run('install', { source: path, agent_id: AGENT, runtime_id: 'host' }, clients, true)
    assertEquals(calls.map((call) => call.method), ['skills.install_plan', 'skills.install'])
    assertEquals(calls[0].service, AGENT)
    assertEquals(calls[0].params.runtime_id, 'host')
    assertEquals(Object.keys(calls[0].params).sort(), ['package', 'runtime_id'], 'planning takes no digest and no replace')
    const params = calls[1].params
    assertEquals(params.replace, false)
    assertEquals(params.plan_digest, 'sha256:plan')
    assertEquals(Object.keys(params).sort(), ['package', 'plan_digest', 'replace'], 'the runtime only chooses what the plan checks')
    assertEquals(JSON.stringify(params.package), JSON.stringify(calls[0].params.package), 'what was planned is what is installed')
    const pkg = params.package as Record<string, unknown>
    assertEquals(pkg.package, 'hello-skills')
    assertEquals(pkg.version, '0.1.0')
    assertEquals(pkg.pikg_digest, info.pikg_digest)
    const files = pkg.files as Record<string, { content: string }>
    assertEquals(Object.keys(files).sort(), HELLO_FILES)
    assertEquals(files['cmd_skills/hello/SKILL.md'], { content: btoa(HELLO_MANUAL) })
    assertEquals(result.ignored_files, ['README.md'])
    assertEquals(result.pikg_digest, info.pikg_digest)
    assertEquals(result.package, 'hello-skills')
    assertEquals((result.plan as Record<string, unknown>).plan_digest, 'sha256:plan')
    assertEquals(result.source, { kind: 'pikg', path })

    // The same package from a URL: downloaded, then verified like the local file.
    calls.length = 0
    const bytes = await Deno.readFile(path)
    const fromUrl = await run(
      'install',
      { source: 'https://example.com/pkgs/hello-skills-0.1.0.pikg?token=x', agent_id: AGENT },
      clients,
      { confirmed: true, dependencies: { download: () => Promise.resolve(bytes) } },
    )
    assertEquals(calls.map((call) => call.method), ['skills.install_plan', 'skills.install'])
    assertEquals(fromUrl.source, { kind: 'url', url: 'https://example.com/pkgs/hello-skills-0.1.0.pikg' })
    assertEquals(fromUrl.pikg_digest, info.pikg_digest)
    assertEquals('runtime_id' in calls[0].params, false)

    calls.length = 0
    const web = await buildPikg(root, 'web-demo', 'static-web', async (src) => {
      await Deno.writeTextFile(join(src, 'index.html'), 'hi')
    })
    await assertRejects(() => run('install', { source: web.path, agent_id: AGENT }, clients, true), 'NOT_A_SKILL_PACKAGE')
    await assertRejects(() => run('install', { source: path, agent_id: '../control-panel' }, clients, true), 'INVALID_AGENT_ID')
    await assertRejects(() => run('install', { source: 'did:bns:hello-skills', agent_id: AGENT }, clients, true), 'SKILL_SOURCE_UNSUPPORTED')
    await assertRejects(() => run('install', { source: 'hello-skills', from: 'did', agent_id: AGENT }, clients, true), 'SKILL_SOURCE_UNSUPPORTED')
    await assertRejects(() => run('install', { agent_id: AGENT }, clients, true), 'MISSING_ARGUMENT')
    await assertRejects(() => run('install', { source: path, draft: 'x', agent_id: AGENT }, clients, true), 'ARGUMENT_CONFLICT')
    assertEquals(calls.length, 0, 'a rejected source reaches nothing')
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('skill install never probes a DID as a local path (Windows stat rejects `did:bns:x` as an invalid name)', async () => {
  const real = getHost()
  const probed: string[] = []
  const invalidName = (path: string) => {
    probed.push(path)
    return Promise.reject(new HostError('Unknown', 'The filename, directory name, or volume label syntax is incorrect. (os error 123)', path))
  }
  resetHostForTest()
  installHost(Object.create(real, { stat: { value: invalidName }, lstat: { value: invalidName } }))
  try {
    const calls: RecordedCall[] = []
    await assertRejects(
      () => run('install', { source: 'did:bns:hello-skills', agent_id: AGENT }, installClients(calls), true),
      'SKILL_SOURCE_UNSUPPORTED',
    )
    assertEquals(probed, [], 'a DID reaches no stat')
    assertEquals(calls.length, 0)
  } finally {
    resetHostForTest()
    installHost(real)
  }
})

Deno.test('skill install confirms the plan: --yes takes every risk level, no terminal needs it', async () => {
  const root = await Deno.makeTempDir()
  try {
    const dir = join(root, 'my-skills')
    await writeHello(dir)
    const high = {
      risk: { level: 'high', findings: [{ code: 'privilege', level: 'high', where: 'cmd_skills/hello/SKILL.md', note: 'asks for root (`sudo`)' }] },
      command_status: [{
        name: 'hello',
        commands: ['ffmpeg', 'mytool'],
        status: {
          state: 'partial',
          commands: { ffmpeg: { present: false }, mytool: { present: false } },
          recommended_packages: [{ id: 'ext-media', version: '1.0.0', provides: ['ffmpeg'] }],
          no_package: ['mytool'],
        },
      }],
    }

    // A directory: the package is named after it and has no PIKG digest.
    let calls: RecordedCall[] = []
    const result = await run('install', { source: dir, agent_id: AGENT, replace: true }, installClients(calls, high), true)
    assertEquals(calls.map((call) => call.method), ['skills.install_plan', 'skills.install'])
    const pkg = calls[1].params.package as Record<string, unknown>
    assertEquals(pkg.package, 'my-skills')
    assertEquals(pkg.version, '')
    assertEquals('pikg_digest' in pkg, false)
    assertEquals(Object.keys(pkg.files as Record<string, unknown>), HELLO_FILES)
    assertEquals(calls[1].params.replace, true)
    assertEquals(result.ignored_files, ['README.md'])
    assertEquals(((result.plan as Record<string, unknown>).risk as Record<string, unknown>).level, 'high')
    assertEquals((result.source as Record<string, unknown>).kind, 'dir')

    // Not a terminal and no --yes: the plan comes back with the refusal, nothing is installed.
    calls = []
    let refused: unknown
    try {
      await run('install', { source: dir, agent_id: AGENT }, installClients(calls, high))
    } catch (error) {
      refused = error
    }
    const refusal = refused as { code: string; details: { plan: { risk: { level: string } } } }
    assertEquals(refusal.code, 'CONFIRMATION_REQUIRED')
    assertEquals(refusal.details.plan.risk.level, 'high')
    assertEquals(calls.map((call) => call.method), ['skills.install_plan'])

    // A terminal: the plan and its findings are printed, then [y/N].
    calls = []
    const stderr: string[] = []
    await assertRejects(
      () => run('install', { source: dir, agent_id: AGENT }, installClients(calls, high), { answer: 'n', stderr }),
      'CONFIRMATION_DECLINED',
    )
    assertEquals(calls.map((call) => call.method), ['skills.install_plan'])
    assert(stderr.join('').includes('[high] privilege cmd_skills/hello/SKILL.md'), stderr.join(''))
    assert(stderr.join('').includes('Commands checked on runtime: private'))
    assert(
      stderr.join('').includes('hello: missing ffmpeg, mytool; extension packages that bring them: ext-media (buckyos ext-tools enable); no package provides mytool'),
      stderr.join(''),
    )
    await run('install', { source: dir, agent_id: AGENT }, installClients(calls, high), { answer: 'y' })
    assertEquals(calls.at(-1)?.method, 'skills.install')

    // A draft: the Agent reads it itself.
    calls = []
    const draft = await run('install', { draft: 'notes', agent_id: AGENT }, installClients(calls), true)
    assertEquals(calls.map((call) => call.params), [{ draft: 'notes' }, { draft: 'notes', plan_digest: 'sha256:plan', replace: false }])
    assertEquals(draft.source, { kind: 'draft', draft: 'notes' })

    // What the Agent would refuse is refused before it is sent.
    calls = []
    await Deno.mkdir(join(dir, 'tools', 'hello', 'bin'), { recursive: true })
    await Deno.writeTextFile(join(dir, 'tools', 'hello', 'bin', 'hello'), '#!/bin/sh\necho hi\n')
    let invalid: unknown
    try {
      await run('install', { source: dir, agent_id: AGENT }, installClients(calls), true)
    } catch (error) {
      invalid = error
    }
    assertEquals((invalid as { code: string }).code, 'INVALID_SKILL_PACKAGE')
    assert((invalid as Error).message.includes('`tools/hello/bin/hello`: a skill is text only'), (invalid as Error).message)
    assertEquals(calls.length, 0)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('skill remove looks up the kind and requires confirmation', async () => {
  const calls: RecordedCall[] = []
  const clients = clientsFor(calls, (method, params) => {
    if (method === 'skills.list') {
      return [
        { kind: 'goal', name: 'hello', origin: 'installed', enabled: true },
        { kind: 'work', name: 'other', origin: 'package', enabled: true },
      ]
    }
    assertEquals(method, 'skills.remove')
    assertEquals(params, { kind: 'goal', name: 'hello' })
    return { kind: 'goal', name: 'hello', origin: 'installed' }
  })
  await assertRejects(() => run('remove', { name: 'hello', agent_id: AGENT }, clients), 'CONFIRMATION_REQUIRED')
  const removed = await run('remove', { name: 'hello', agent_id: AGENT }, clients, true)
  assertEquals((removed.removed as Record<string, unknown>).kind, 'goal')
  await assertRejects(() => run('remove', { name: 'missing', agent_id: AGENT }, clients, true), 'RESOURCE_NOT_FOUND')
})

Deno.test('skill list leaves out what is not enabled, selects by scope, and adds usage on request', async () => {
  const calls: RecordedCall[] = []
  const skills = [
    { kind: 'work', name: 'ui_core', scope: 'ui', enabled: true, usage: { frozen: 9, last_ms: 5 } },
    { kind: 'work', name: 'share', scope: 'ui,work', enabled: true },
    { kind: 'work', name: 'aigc_video', enabled: false, disabled: { at_ms: 1, by: 'did:bns:owner', reason: 'no provider' } },
    { kind: 'work', name: 'xllm', enabled: true, usage: { frozen: 2, last_ms: 7 } },
    { kind: 'plan', name: 'plan_research', enabled: true },
  ]
  const clients = clientsFor(calls, (method, params) => {
    if (method === 'skills.state') return { disabled: {}, usage: { none: { frozen: 3, last_ms: 9 } }, install: {}, audit: [] }
    if (method === 'skills.drafts') return [{ slug: 'notes', skills: [], files: [], updated_at_ms: 1 }]
    assertEquals(method, 'skills.list')
    return skills.filter((skill) => !params.kind || skill.kind === params.kind)
  })
  const names = (result: Record<string, unknown>) => (result.skills as { name: string }[]).map((skill) => skill.name)

  const listed = await run('list', { agent_id: AGENT }, clients)
  assertEquals(names(listed), ['ui_core', 'share', 'xllm', 'plan_research'])
  assertEquals(listed.not_enabled, 1)
  assertEquals((listed.skills as Record<string, unknown>[]).some((skill) => 'usage' in skill), false)
  assertEquals(calls.map((call) => call.method), ['skills.list'])

  const all = await run('list', { agent_id: AGENT, all: true }, clients)
  assertEquals(names(all).includes('aigc_video'), true)
  assertEquals((all.drafts as { slug: string }[]).map((draft) => draft.slug), ['notes'])

  const ui = await run('list', { agent_id: AGENT, scope: 'ui' }, clients)
  assertEquals(names(ui), ['ui_core', 'share'])
  assertEquals(calls.at(-1)?.params, { kind: 'work' })
  assertEquals(names(await run('list', { agent_id: AGENT, scope: 'work', all: true }, clients)).slice(0, 3), ['share', 'aigc_video', 'xllm'])
  await assertRejects(() => run('list', { agent_id: AGENT, scope: 'ui', kind: 'plan' }, clients), 'ARGUMENT_CONFLICT')

  const plan = await run('list', { agent_id: AGENT, kind: 'plan' }, clients)
  assertEquals(names(plan), ['plan_research'])
  assertEquals(calls.at(-1)?.params, { kind: 'plan' })

  const stats = await run('list', { agent_id: AGENT, stats: true }, clients)
  assertEquals((stats.skills as { usage?: { frozen: number } }[])[0].usage?.frozen, 9)
  assertEquals(stats.usage_none, { frozen: 3, last_ms: 9 })
})

Deno.test('skill enable/disable, the UI set, and the commands of the skills on a runtime', async () => {
  const calls: RecordedCall[] = []
  let ui = ['ui_core']
  const clients = clientsFor(calls, (method, params) => {
    if (method === 'skills.list') return [{ kind: 'work', name: 'share', enabled: true }, { kind: 'plan', name: 'both' }, { kind: 'work', name: 'both' }]
    if (method === 'skills.set_enabled') return { ...params, origin: 'package' }
    if (method === 'skills.ui_set') ui = params.names as string[]
    if (method === 'skills.ui_get' || method === 'skills.ui_set') return { names: ui, source: method === 'skills.ui_get' && ui.length === 1 ? 'template' : 'state', total_bytes: 6000 * ui.length }
    if (method === 'skills.status') return { runtime_id: params.runtime_id ?? 'private', skills: [{ name: 'share', scope: 'ui,work', enabled: true, commands: { state: 'ready', commands: {} } }] }
    throw new Error(`unexpected ${method}`)
  })

  await run('disable', { name: 'share', agent_id: AGENT, reason: 'noisy' }, clients)
  assertEquals(calls.at(-1)?.params, { kind: 'work', name: 'share', enabled: false, reason: 'noisy' })
  await run('enable', { name: 'share', kind: 'work', agent_id: AGENT }, clients)
  assertEquals(calls.at(-1)?.params, { kind: 'work', name: 'share', enabled: true })
  await assertRejects(() => run('disable', { name: 'both', agent_id: AGENT }, clients), 'AMBIGUOUS_SKILL')

  assertEquals((await run('ui-list', { agent_id: AGENT }, clients)).source, 'template')
  const added = await run('ui-add', { name: 'share', agent_id: AGENT }, clients)
  assertEquals(calls.at(-1), { service: AGENT, method: 'skills.ui_set', params: { names: ['ui_core', 'share'] } })
  assertEquals([added.changed, added.names, added.total_bytes], [true, ['ui_core', 'share'], 12000])
  calls.length = 0
  const again = await run('ui-add', { name: 'share', agent_id: AGENT }, clients)
  assertEquals([again.changed, calls.map((call) => call.method)], [false, ['skills.ui_get']])
  const removed = await run('ui-remove', { name: 'ui_core', agent_id: AGENT }, clients)
  assertEquals(removed.names, ['share'])
  await assertRejects(() => run('ui-remove', { name: 'ui_core', agent_id: AGENT }, clients), 'RESOURCE_NOT_FOUND')

  const status = await run('status', { agent_id: AGENT }, clients)
  assertEquals(calls.at(-1)?.params, { runtime_id: null })
  assertEquals((status.skills as { name: string }[])[0].name, 'share')
})

Deno.test('skill import hands a text to the Agent; drafts are listed, shown, and discarded', async () => {
  const root = await Deno.makeTempDir()
  try {
    const calls: RecordedCall[] = []
    const clients = clientsFor(calls, (method, params) => {
      if (method === 'skills.import') return { session_id: 'work-1', inbox: 'skills_drafts' }
      if (method === 'skills.drafts') return [{ slug: 'notes', draft: { imported_from: {} }, skills: ['work:notes'], files: ['cmd_skills/notes/SKILL.md'], updated_at_ms: 1 }]
      if (method === 'skills.draft_file') return { text: `text of ${params.file}` }
      if (method === 'skills.draft_discard') return null
      throw new Error(`unexpected ${method}`)
    })
    const file = join(root, 'howto.md')
    await Deno.writeTextFile(file, '# How to greet\nSay hello.\n')
    const imported = await run('import', { source: file, agent_id: AGENT, name: 'notes', scope: 'plan', runtime_id: 'host' }, clients)
    assertEquals(calls.at(-1)?.params, { text: '# How to greet\nSay hello.\n', name: 'notes', scope: 'plan', source: 'howto.md', runtime_id: 'host' })
    assertEquals([imported.session_id, imported.installed], ['work-1', false])
    assertEquals(imported.install_command, `buckyos skill install --draft notes --agent ${AGENT}`)

    const dependencies: SkillModuleDependencies = {
      fetchText: (url) => Promise.resolve(`from ${url.host}`),
      readStdin: () => Promise.resolve('from stdin'),
    }
    await run('import', { source: 'https://example.com/a/howto.md?key=1', agent_id: AGENT }, clients, { dependencies })
    assertEquals(calls.at(-1)?.params, { text: 'from example.com', source: 'https://example.com/a/howto.md' })
    const piped = await run('import', { source: '-', agent_id: AGENT }, clients, { dependencies })
    assertEquals(calls.at(-1)?.params, { text: 'from stdin', source: 'stdin' })
    assertEquals(piped.install_command, `buckyos skill install --draft <slug> --agent ${AGENT}`)
    await Deno.writeTextFile(file, ' \n')
    await assertRejects(() => run('import', { source: file, agent_id: AGENT }, clients), 'INVALID_ARGUMENT')

    assertEquals((await run('drafts', { agent_id: AGENT }, clients)).total, 1)
    const shown = await run('draft-show', { slug: 'notes', agent_id: AGENT }, clients)
    assertEquals(shown.files, ['cmd_skills/notes/SKILL.md'])
    const text = await run('draft-show', { slug: 'notes', file: 'cmd_skills/notes/SKILL.md', agent_id: AGENT }, clients)
    assertEquals(text.text, 'text of cmd_skills/notes/SKILL.md')
    await assertRejects(() => run('draft-show', { slug: 'other', agent_id: AGENT }, clients), 'RESOURCE_NOT_FOUND')
    await assertRejects(() => run('draft-discard', { slug: 'notes', agent_id: AGENT }, clients), 'CONFIRMATION_REQUIRED')
    assertEquals((await run('draft-discard', { slug: 'notes', agent_id: AGENT }, clients, true)).discarded, 'notes')
    assertEquals(calls.at(-1)?.params, { slug: 'notes' })
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

function pkg(files: Record<string, string | Uint8Array>): Map<string, SkillPackageFile> {
  return new Map(Object.entries(files).map(([path, content]) => [
    path,
    { bytes: typeof content === 'string' ? new TextEncoder().encode(content) : content },
  ]))
}

function manual(fields: Record<string, string>, body: string): string {
  return `---\n${Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join('\n')}\n---\n${body}`
}

Deno.test('skill lint: what the Agent refuses is an error', () => {
  const ok = manual({ name: 'a', description: 'd' }, 'Do it.\n')
  const error = (files: Record<string, string | Uint8Array>) => {
    const { findings } = lintSkillPackage('p', pkg(files))
    assertEquals(findings[0]?.level, 'error', JSON.stringify(findings))
    assertEquals(findings[0].code, 'invalid_package')
    return findings[0].note
  }
  assert(error({ 'cmd_skills/a.md': ok }).includes('move it to cmd_skills/a/SKILL.md'))
  assert(error({ 'cmd_skills/a/SKILL.md': ok, 'cmd_skills/a/notes.md': 'x' }).includes('is not a skill file'))
  assert(error({ 'cmd_skills/a/SKILL.md': ok, 'cmd_skills/.b/SKILL.md': ok }).includes('is not a skill file'))
  assert(error({ 'other/a/SKILL.md': ok }).includes('is not a skill file'))
  assert(error({ 'cmd_skills/a/references/x.md': 'x' }).includes('cmd_skills/a/ has no SKILL.md'))
  assert(error({}).includes('holds no skill'))
  assert(error({ 'cmd_skills/a/SKILL.md': manual({ name: 'b' }, 'x') }).includes('differs from its directory'))
  assert(error({ 'cmd_skills/a/SKILL.md': manual({ scope: 'chat' }, 'x') }).includes('scope `chat` is not ui | work'))
  assert(error({ 'cmd_skills/a/SKILL.md': manual({ baseline: 'full' }, 'x') }).includes('baseline `full`'))
  assert(error({ 'cmd_skills/a/SKILL.md': manual({ platforms: 'linux, bsd' }, 'x') }).includes('platform `bsd`'))
  assert(error({ 'plan_skills/a/SKILL.md': manual({ scope: 'work' }, 'x') }).includes('a plan skill declares no `scope`'))
  assert(error({ 'goal_skills/a/SKILL.md': manual({ commands: 'ffmpeg' }, 'x') }).includes('a goal skill declares no `commands`'))
  assert(error({ 'cmd_skills/a/SKILL.md': new Uint8Array([0xff, 0xfe]) }).includes('is not UTF-8 text'))
})

Deno.test('skill lint: a skill is text only', () => {
  const ok = manual({ name: 'x', description: 'd' }, 'Do it.\n')
  const refusal = (files: Record<string, string | Uint8Array>) => {
    const { skills, findings } = lintSkillPackage('p', pkg(files))
    assertEquals(skills, [])
    assertEquals(findings.map((finding) => [finding.code, finding.level, finding.where]), [['invalid_package', 'error', 'p']])
    return findings[0].note
  }
  assertEquals(
    refusal({ 'cmd_skills/x/SKILL.md': ok, 'tools/x/bin/y': '#!/bin/sh\necho hi\n' }),
    "`tools/x/bin/y`: a skill is text only and brings no command or install script; publish the commands as an extension package and name them in the manual's `commands`",
  )
  assert(refusal({ 'cmd_skills/x/SKILL.md': ok, 'tools/x/install.toml': '[check]\ncommands = ["y"]\n' }).startsWith('`tools/x/install.toml`: a skill is text only'))
  assert(refusal({ 'tools/x/bin/y': 'echo' }).includes('text only'))
  assertEquals(
    refusal({ 'cmd_skills/x/SKILL.md': ok, 'cmd_skills/x/references/logo.md': new Uint8Array([0x89, 0x50, 0xff, 0xfe]) }),
    'cmd_skills/x/references/logo.md is not UTF-8 text: a skill is text only',
  )
  assertEquals(refusal({ 'cmd_skills/x/SKILL.md': new Uint8Array([0xff, 0xfe]) }), 'cmd_skills/x/SKILL.md is not UTF-8 text: a skill is text only')
  assertEquals(lintSkillPackage('p', pkg({ 'cmd_skills/x/SKILL.md': ok, 'cmd_skills/x/references/more.md': 'More.\n' })).findings, [])
})

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

Deno.test('skill content digest: sha256 over `path|sha256(bytes)` lines in path order', async () => {
  const files = { 'plan_skills/p/SKILL.md': 'Plan.\n', 'cmd_skills/a/references/more.md': 'More.\n', 'cmd_skills/a/SKILL.md': 'Do it.\n' }
  const order = ['cmd_skills/a/SKILL.md', 'cmd_skills/a/references/more.md', 'plan_skills/p/SKILL.md'] as const
  let lines = ''
  for (const path of order) lines += `${path}|${await sha256Hex(files[path])}\n`
  const digest = skillContentDigest(pkg(files))
  assertEquals(digest, `sha256:${await sha256Hex(lines)}`)
  assertEquals(digest, 'sha256:df810733a9b32c4a7c20bf3246f79002283f7b8b784be797de255922c5b1098d', 'the value sha256sum gives for the same lines')
  assertEquals(lines.includes('|0|') || lines.includes('|1|'), false)
  assert(skillContentDigest(pkg({ ...files, 'cmd_skills/a/SKILL.md': 'Do it!\n' })) !== digest)
})

Deno.test('skill lint: the rest is advice', () => {
  const codes = (files: Record<string, string | Uint8Array>) => {
    const { findings } = lintSkillPackage('p', pkg(files))
    assertEquals(findings.some((finding) => finding.level === 'error'), false, JSON.stringify(findings))
    return findings.map((finding) => finding.code)
  }
  const clean = lintSkillPackage(
    'p',
    pkg({
      'cmd_skills/a/SKILL.md': manual({ name: 'a', description: 'd', commands: 'ffmpeg, ffprobe', platforms: 'linux, macos', baseline: 'extended' }, [
        'Cut it:',
        '```bash',
        'OUT=out.mp4 ffmpeg -i in.mp4 "$OUT" && ffprobe "$OUT" | grep ok',
        'buckyos skill list --agent "$AGENT"',
        '```',
        'See references/more.md.',
      ].join('\n')),
      'cmd_skills/a/references/more.md': '```sh\nffprobe in.mp4\n```\n',
      'goal_skills/g/SKILL.md': manual({ description: 'd' }, 'Judge the distance.'),
    }),
  )
  assertEquals(clean.findings, [])
  assertEquals(clean.skills.map((skill) => [skill.kind, skill.name, skill.scope, skill.baseline]), [['work', 'a', 'work', 'extended'], ['goal', 'g', 'work', 'standard']])
  assertEquals(clean.skills[0].commands, ['ffmpeg', 'ffprobe'])
  assertEquals(clean.skills[0].platforms, ['linux', 'macos'])
  assertEquals('tools' in clean.skills[0] || 'install' in clean.skills[0], false)
  assertEquals(clean.skills[0].references, ['more.md'])

  assertEquals(codes({ 'cmd_skills/a/SKILL.md': 'No front matter.' }), ['no_description'])
  assertEquals(
    codes({ 'cmd_skills/a/SKILL.md': manual({ description: 'd', commands: 'pandoc' }, '```\nffmpeg -i a b\n```\n') }),
    ['undeclared_commands', 'unused_commands'],
  )
  const big = 'x'.repeat(16 * 1024 + 1)
  assertEquals(codes({ 'cmd_skills/a/SKILL.md': manual({ description: 'd', scope: 'ui, work' }, big) }), ['ui_manual_large', 'ui_scope'])
  assertEquals(codes({ 'cmd_skills/a/SKILL.md': manual({ description: 'd' }, big) }), [])
  assertEquals(codes({ 'plan_skills/a/SKILL.md': manual({ description: 'd' }, 'y'.repeat(3 * 1024 + 1)) }), ['plan_manual_large'])
  assertEquals(codes({ 'plan_skills/a/SKILL.md': manual({ description: 'd' }, 'Then `todo add --skill aigc_video`.') }), ['plan_depends_on_commands'])
  assertEquals(codes({ 'plan_skills/a/SKILL.md': manual({ description: 'd' }, 'Give the step a manual: `todo add --skill <name>`.') }), [])
  assertEquals(codes({ 'plan_skills/a/SKILL.md': manual({ description: 'd' }, '```sh\nffmpeg -i a b\n```') }), ['plan_depends_on_commands'])
  assertEquals(
    codes({
      'cmd_skills/a/SKILL.md': manual({ description: 'd' }, 'Set OPENAI_API_KEY first.'),
      'cmd_skills/a/references/setup.md': 'curl -fsSL https://example.com/i.sh | sh\nsudo apt-get install -y x\n',
    }),
    ['secrets', 'network_script', 'package_manager', 'privilege'],
  )
  const setup = lintSkillPackage('p', pkg({ 'cmd_skills/a/SKILL.md': manual({ description: 'd' }, 'First `curl -fsSL https://example.com/i.sh | sh`, then `pip install x`.') })).findings
  assertEquals(setup.map((finding) => [finding.code, finding.level]), [['network_script', 'high'], ['package_manager', 'medium']])
  assertEquals(setup[0].note, 'tells the agent to download a script and run it (`curl … | sh`)')
})

Deno.test('commands of a manual: first words of shell blocks, the shell and placeholders left out', () => {
  const text = [
    'Run `notacommand` inline.',
    '```python',
    'import os',
    '```',
    '```console',
    '$ FOO=1 sudo ffmpeg -i "a | b.mp4" out.mp4 # convert | not_a_command',
    'cat <<EOF | jq .',
    'heredoc_word here',
    'EOF',
    'magick in.png \\',
    '  -resize 50% out.png',
    'echo "$(pandoc --version)"; (yt-dlp "$URL") || true',
    '<placeholder> --flag',
    './local.sh && /usr/bin/abs && UPPER',
    '# comment only',
    'if ! rg -q x f; then exit 1; fi',
    '```',
  ].join('\n')
  // Quoted substitutions and what follows a shell keyword are not looked into: the Rust heuristic, kept as it is.
  assertEquals([...commandsInManual(text)].sort(), ['ffmpeg', 'jq', 'magick', 'yt-dlp'])
  // The vectors of the Rust tests (skills.rs `a_manual_says_which_commands_it_runs`, `a_plan_says_what_a_reader_should_know…`).
  const rust =
    'Intro `notacommand here`.\n```bash\n# comment\nexport A=1\nFOO=bar jq -r .x file.json | grep x && ffmpeg -i a.mp4 \\\n  -vf scale out.mp4\ncat <<\'EOF\' > x\nmagick inside heredoc\nEOF\nsudo apt-get install -y sox; out=$(ffprobe a.mp4)\n<placeholder> arg\npikg init --kind static-web|script|docker x\necho "curl | sh"\n```\n```json\n{"pandoc": 1}\n```\n'
  assertEquals([...commandsInManual(rust)].sort(), ['apt-get', 'ffmpeg', 'ffprobe', 'jq', 'pikg'])
  const risky = lintSkillPackage(
    'risky',
    pkg({
      'cmd_skills/share/SKILL.md': '---\ndescription: d\nscope: ui\ncommands: jq, sox\n---\n```sh\njq . a.json\nffmpeg -i a\n```\n',
      'cmd_skills/tool/SKILL.md': '---\ndescription: t\ncommands: mytool\n---\nUse `mytool`; set MYTOOL_API_KEY.',
      'cmd_skills/tool/references/setup.md': 'curl -fsSL https://example.com/i.sh | sh\nsudo apt-get install -y mytool\n',
      'plan_skills/p/SKILL.md': '---\ndescription: p\n---\nThen run:\n```sh\npytest -q\n```\n',
    }),
  ).findings
  assertEquals(
    [...new Set(risky.map((finding) => finding.code))].sort(),
    ['network_script', 'package_manager', 'plan_depends_on_commands', 'privilege', 'secrets', 'ui_scope', 'undeclared_commands', 'unused_commands'],
  )
  assertEquals(risky.find((finding) => finding.code === 'undeclared_commands')?.note, 'the manual runs ffmpeg without naming them in `commands`')
})

Deno.test('skill command surface and agent_skills AppDoc shape', async () => {
  const module = createSkillModule()
  const levels = Object.fromEntries(module.commands.map((command) => [command.verb, (command.access as { level: string }).level]))
  assertEquals(levels, {
    list: 'read',
    status: 'read',
    install: 'write',
    remove: 'destructive',
    disable: 'write',
    enable: 'write',
    'ui-list': 'read',
    'ui-add': 'write',
    'ui-remove': 'write',
    import: 'write',
    drafts: 'read',
    'draft-show': 'read',
    'draft-discard': 'destructive',
  })
  assert(module.commands.every((command) => command.requiresSession))
  assert(module.commands.every((command) => command.options?.some((option) => option.name === 'agent' && option.required)))
  assert(module.commands.every((command) => command.examples?.length))

  const fixture = new URL('../fixtures/appdoc-v1.json', import.meta.url)
  const appDoc = JSON.parse(await Deno.readTextFile(fixture))
  const skillsDoc = {
    ...appDoc,
    name: 'hello-skills',
    app_type: 'agent_skills',
    pkg_list: { agent_skills: Object.values(appDoc.pkg_list)[0] },
  }
  validateAppDocShape(skillsDoc)
  await assertRejects(() =>
    validateAppDocShape({
      ...skillsDoc,
      pkg_list: { ...skillsDoc.pkg_list, agent: Object.values(appDoc.pkg_list)[0] },
    }), 'INVALID_PACKAGE')
  await assertRejects(() => validateAppDocShape({ ...skillsDoc, name: undefined }))
})
