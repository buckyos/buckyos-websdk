import './setup.ts'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BuckyOSToolApplication, type ToolStdio } from '../core/app.ts'
import { ConfigStore } from '../core/config.ts'
import { createMockCommandContext } from '../core/context.ts'
import { CommandRegistry } from '../core/registry.ts'
import type { RpcCallOptions, ServiceClientRegistry } from '../core/runtime.ts'
import { validateAppDocShape } from '../modules/pikg_protocol.ts'
import { createSkillModule } from '../modules/skill.ts'
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

async function run(
  verb: string,
  input: Record<string, unknown>,
  clients: ServiceClientRegistry,
  confirmed = false,
): Promise<Record<string, unknown>> {
  const registry = new CommandRegistry()
  registry.register(createSkillModule())
  const command = registry.get('skill', verb)
  const context = createMockCommandContext({
    command,
    config: testConfig({ nonInteractive: true, yes: confirmed }),
    configStore: new ConfigStore(join(tmpdir(), 'buckyos-tool-skill-test')),
    clients,
    traceId: 'skill-test',
  })
  context.confirmed = confirmed
  context.deadline = Date.now() + 10_000
  return await command.handler(context, input) as Record<string, unknown>
}

Deno.test('skill install sends the verified agent_skills payload to the Agent', async () => {
  const root = await Deno.makeTempDir()
  try {
    const { path, info } = await buildPikg(root, 'hello-skills', 'agent-skills', async (src) => {
      await Deno.mkdir(join(src, 'cmd_skills'))
      await Deno.mkdir(join(src, 'tools', 'hello', 'bin'), { recursive: true })
      await Deno.writeTextFile(
        join(src, 'cmd_skills', 'hello.md'),
        '---\nname: hello\ndescription: say hello\nrequires: nothing\n---\nRun `hello`.\n',
      )
      await Deno.writeTextFile(join(src, 'tools', 'hello', 'bin', 'hello'), '#!/bin/sh\necho hi\n')
      await Deno.chmod(join(src, 'tools', 'hello', 'bin', 'hello'), 0o755)
      await Deno.writeTextFile(join(src, 'README.md'), 'not a skill file')
    })
    const app = info.app as Record<string, unknown>
    assertEquals(app.app_type, 'agent_skills')
    assertEquals(app.name, 'hello-skills')
    assertEquals((info.subpackages as Record<string, unknown>[]).map((item) => item.key), [
      'agent_skills',
    ])

    const calls: RecordedCall[] = []
    const clients = clientsFor(calls, (method, params) => {
      assertEquals(method, 'skills.install')
      const pkg = params.package as Record<string, unknown>
      return { package: pkg.package, version: pkg.version, digest: 'sha256:00', skills: [] }
    })
    const result = await run('install', { pikg_path: path, agent_id: 'jarvis.test.zone' }, clients)
    assertEquals(calls.length, 1)
    assertEquals(calls[0].service, 'jarvis.test.zone')
    const params = calls[0].params
    assertEquals(params.replace, false)
    const pkg = params.package as Record<string, unknown>
    assertEquals(pkg.package, 'hello-skills')
    assertEquals(pkg.version, '0.1.0')
    assertEquals(pkg.pikg_digest, info.pikg_digest)
    const files = pkg.files as Record<string, { content: string; executable: boolean }>
    assertEquals(Object.keys(files).sort(), ['cmd_skills/hello.md', 'tools/hello/bin/hello'])
    assertEquals(atob(files['tools/hello/bin/hello'].content), '#!/bin/sh\necho hi\n')
    if (Deno.build.os !== 'windows') {
      assertEquals(files['tools/hello/bin/hello'].executable, true)
    }
    assertEquals(files['cmd_skills/hello.md'].executable, false)
    assertEquals(result.ignored_files, ['README.md'])
    assertEquals(result.pikg_digest, info.pikg_digest)
    assertEquals(result.package, 'hello-skills')

    const web = await buildPikg(root, 'web-demo', 'static-web', async (src) => {
      await Deno.writeTextFile(join(src, 'index.html'), 'hi')
    })
    await assertRejects(
      () => run('install', { pikg_path: web.path, agent_id: 'jarvis.test.zone' }, clients),
      'NOT_A_SKILL_PACKAGE',
    )
    await assertRejects(
      () => run('install', { pikg_path: path, agent_id: '../control-panel' }, clients),
      'INVALID_AGENT_ID',
    )
    assertEquals(calls.length, 1)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('skill remove looks up the kind and requires confirmation', async () => {
  const calls: RecordedCall[] = []
  const clients = clientsFor(calls, (method, params) => {
    if (method === 'skills.list') {
      return [
        { kind: 'goal', name: 'hello', origin: 'installed' },
        { kind: 'cmd', name: 'other', origin: 'package' },
      ]
    }
    assertEquals(method, 'skills.remove')
    assertEquals(params, { kind: 'goal', name: 'hello' })
    return { kind: 'goal', name: 'hello', origin: 'installed' }
  })
  await assertRejects(
    () => run('remove', { name: 'hello', agent_id: 'jarvis.test.zone' }, clients),
    'CONFIRMATION_REQUIRED',
  )
  const removed = await run(
    'remove',
    { name: 'hello', agent_id: 'jarvis.test.zone' },
    clients,
    true,
  )
  assertEquals((removed.removed as Record<string, unknown>).kind, 'goal')
  await assertRejects(
    () => run('remove', { name: 'missing', agent_id: 'jarvis.test.zone' }, clients, true),
    'RESOURCE_NOT_FOUND',
  )
  const listed = await run('list', { agent_id: 'jarvis.test.zone', kind: 'cmd' }, clients)
  assertEquals(listed.total, 2)
  assertEquals(calls.at(-1)?.params, { kind: 'cmd' })
})

Deno.test('skill command surface and agent_skills AppDoc shape', async () => {
  const module = createSkillModule()
  assertEquals(module.commands.map((command) => command.verb), ['list', 'install', 'remove'])
  assertEquals(module.commands.map((command) => command.access), [
    { mode: 'fixed', level: 'read' },
    { mode: 'fixed', level: 'write' },
    { mode: 'fixed', level: 'destructive' },
  ])
  assert(module.commands.every((command) => command.requiresSession))

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
