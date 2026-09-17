import './setup.ts'
import { dirname, join } from 'node:path'
import { BuckyOSToolApplication, createRegistry, type ToolStdio } from '../core/app.ts'
import { CommandRegistry } from '../core/registry.ts'
import { createProvisionModule } from '../modules/provision.ts'
import { buildDistributionPolicy } from '../runtime/host.ts'
import { assert, assertEquals } from './test_helpers.ts'

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

const SECRET_MARKERS = ['PRIVATE KEY', 'admin-password-1', 'admin_password_hash']

function assertNoSecret(text: string): void {
  for (const marker of SECRET_MARKERS) {
    assert(!text.includes(marker), `output leaked ${marker}`)
  }
}

async function installedRoot(sandbox: string): Promise<string> {
  const root = join(sandbox, 'root')
  await Deno.mkdir(join(root, 'bin'), { recursive: true })
  await Deno.mkdir(join(root, 'etc'), { recursive: true })
  return root
}

Deno.test('provision module registers local, offline, session-free commands', () => {
  const registry = new CommandRegistry()
  registry.register(createProvisionModule())
  assertEquals(registry.commands().map((command) => command.verb), ['activate', 'check', 'status'])
  for (const verb of ['status', 'check', 'activate']) {
    const described = registry.describe('provision', verb)
    assertEquals(described.execution, 'local')
    assertEquals(described.network_access, false)
    assertEquals(described.requires_session, false)
    assertEquals(described.async_mode, 'sync')
  }
  assertEquals(registry.describe('provision', 'status').access, { mode: 'fixed', level: 'read' })
  assertEquals(registry.describe('provision', 'check').access, { mode: 'fixed', level: 'read' })
  assertEquals(registry.describe('provision', 'activate').access, {
    mode: 'fixed',
    level: 'privileged',
  })
  const activate = registry.get('provision', 'activate')
  assertEquals(activate.inputSchema.properties?.admin_password?.secret, true)
  assert(!(activate.options ?? []).some((option) => option.name.includes('password')))
  assert(
    (activate.options ?? []).every((option) =>
      option.name !== 'force' && option.name !== 'no-wait'
    ),
  )
  // The default registry also exposes the module.
  assertEquals(createRegistry().get('provision', 'status').module, 'provision')
})

Deno.test('provision launcher policy grants only the target root and the backup directory', () => {
  const path = {
    sep: '/',
    basename: (value: string) => value.split('/').pop() ?? '',
    dirname,
    isAbsolute: (value: string) => value.startsWith('/'),
    join,
    relative: (from: string, to: string) => to.replace(`${from}/`, ''),
    resolve: (...parts: string[]) => join('/', ...parts),
    parse: (value: string) => ({
      root: '/',
      dir: dirname(value),
      base: value,
      ext: '',
      name: value,
    }),
  }
  const base = {
    distribution: 'developer' as const,
    cwd: '/work',
    packageRoot: '/pkg',
    homeDir: '/home/user',
    environment: {},
    path,
  }
  const activate = buildDistributionPolicy({
    ...base,
    argv: [
      '--non-interactive',
      '--yes',
      '--input',
      '/secrets/activation.json',
      'provision',
      'activate',
      '--root',
      '/opt/buckyos',
      '--owner-key-backup',
      '/secure-backup/corp-owner.pem',
    ],
  })
  assertEquals(activate.network, false)
  assertEquals(activate.subprocesses, [])
  assert(activate.readPaths.includes('/opt/buckyos'))
  assert(activate.readPaths.includes('/secure-backup'))
  assert(activate.readPaths.includes('/secrets/activation.json'))
  assert(activate.writePaths.includes('/opt/buckyos'))
  assert(activate.writePaths.includes('/secure-backup'))
  assert(!activate.writePaths.includes('/secrets/activation.json'))

  const check = buildDistributionPolicy({
    ...base,
    argv: [
      'provision',
      'check',
      '--root',
      '/opt/buckyos',
      '--domain',
      'corp.example.com',
      '--owner-name',
      'admin',
      '--owner-key-backup',
      '/secure-backup/corp-owner.pem',
    ],
  })
  assertEquals(check.network, false)
  assert(check.readPaths.includes('/opt/buckyos'))
  assert(check.readPaths.includes('/secure-backup'))
  assert(!check.writePaths.includes('/opt/buckyos'))
  assert(!check.writePaths.includes('/secure-backup'))

  const status = buildDistributionPolicy({
    ...base,
    argv: ['provision', 'status', '--root', '/opt/buckyos'],
  })
  assertEquals(status.network, false)
  assert(status.readPaths.includes('/opt/buckyos'))
  assert(!status.writePaths.includes('/opt/buckyos'))
})

Deno.test('provision status/check/activate run without a Zone and never print secrets', async () => {
  const sandbox = await Deno.makeTempDir()
  try {
    const root = await installedRoot(sandbox)
    const backupDir = join(sandbox, 'backup')
    await Deno.mkdir(backupDir)
    const backup = join(backupDir, 'owner.pem')
    const inputPath = join(sandbox, 'activation.json')
    await Deno.writeTextFile(
      inputPath,
      JSON.stringify({
        domain: 'Corp.Example.com',
        owner_name: 'admin',
        public_ip: '203.0.113.7',
        admin_password: 'admin-password-1',
      }),
    )
    const io = new CaptureStdio()
    const app = new BuckyOSToolApplication({
      environment: { HOME: sandbox, BUCKYOS_TOOL_CONFIG_DIR: join(sandbox, 'config') },
      homeDir: sandbox,
      stdio: io,
      createAuthentication: () => {
        throw new Error('local commands must not create a session')
      },
      createClients: () => {
        throw new Error('local commands must not create service clients')
      },
    })
    const run = async (args: string[]) => {
      const code = await app.run(args)
      const envelope = io.takeEnvelope()
      assertNoSecret(JSON.stringify(envelope))
      assertNoSecret(io.stderrText)
      return { code, envelope }
    }

    const unactivated = await run(['provision', 'status', '--root', root])
    assertEquals(unactivated.code, 0)
    assertEquals(unactivated.envelope.data.state, 'unactivated')
    assertEquals(unactivated.envelope.data.startup_required, false)
    assertEquals(unactivated.envelope.meta.command, 'provision.status')

    const check = await run([
      'provision',
      'check',
      '--root',
      root,
      '--domain',
      'corp.example.com',
      '--owner-name',
      'admin',
      '--owner-key-backup',
      backup,
      '--rtcp-port',
      '2981',
    ])
    assertEquals(check.code, 0)
    assertEquals(check.envelope.data.ready, true)
    assertEquals(check.envelope.data.zone_did, 'did:web:corp.example.com')
    assertEquals(check.envelope.data.device_did, 'did:web:ood1.corp.example.com')
    assertEquals(check.envelope.data.rtcp_port, 2981)
    assertEquals(check.envelope.data.owner_key_backup.exists, false)
    // check writes nothing
    assertEquals([...Deno.readDirSync(join(root, 'etc'))].length, 0)
    assertEquals([...Deno.readDirSync(backupDir)].length, 0)

    // online-only session options conflict with the local command
    const conflict = await run([
      '--zone',
      'corp.example.com',
      'provision',
      'status',
      '--root',
      root,
    ])
    assertEquals(conflict.code, 2)
    assertEquals(conflict.envelope.error.code, 'ARGUMENT_CONFLICT')

    // non-interactive activation without --yes stops before any secret is used
    const unconfirmed = await run([
      '--non-interactive',
      '--input',
      inputPath,
      'provision',
      'activate',
      '--root',
      root,
      '--owner-key-backup',
      backup,
    ])
    assertEquals(unconfirmed.code, 4)
    assertEquals(unconfirmed.envelope.error.code, 'CONFIRMATION_REQUIRED')
    assertEquals([...Deno.readDirSync(join(root, 'etc'))].length, 0)

    // non-interactive activation needs the secret from --input
    const noSecret = await run([
      '--non-interactive',
      '--yes',
      'provision',
      'activate',
      '--root',
      root,
      '--domain',
      'corp.example.com',
      '--owner-name',
      'admin',
      '--owner-key-backup',
      backup,
    ])
    assertEquals(noSecret.code, 2)
    assertEquals(noSecret.envelope.error.code, 'SECRET_REQUIRED')

    const activated = await run([
      '--non-interactive',
      '--yes',
      '--trace-id',
      'provision-test',
      '--input',
      inputPath,
      'provision',
      'activate',
      '--root',
      root,
      '--owner-key-backup',
      backup,
    ])
    assertEquals(activated.code, 0)
    const data = activated.envelope.data
    assertEquals(data.state, 'configured')
    assertEquals(data.startup_required, true)
    assertEquals(data.owner_did, 'did:web:corp.example.com')
    assertEquals(data.zone_did, 'did:web:corp.example.com')
    assertEquals(data.device_did, 'did:web:ood1.corp.example.com')
    assertEquals(data.owner_key_backup, { path: backup, saved: true })
    assertEquals(data.dns_records, [{ type: 'A', name: 'corp.example.com', value: '203.0.113.7' }])
    assertEquals(data.audit.trace_id, 'provision-test')
    assertEquals(activated.envelope.meta.trace_id, 'provision-test')
    assertEquals(typeof data.audit.input_fingerprint, 'string')
    assertEquals(data.committed_files.at(-1).path, 'etc/node_identity.json')
    assert(
      data.committed_files.some((file: { secret: boolean; sha256: string | null }) =>
        file.secret && file.sha256 === null
      ),
    )
    assert(await Deno.stat(backup).then((info) => info.isFile))
    assert(await Deno.stat(join(root, 'etc', 'node_identity.json')).then((info) => info.isFile))
    assert(!await Deno.stat(join(root, 'etc', 'provision_activation.lock')).catch(() => null))

    const configured = await run(['provision', 'status', '--root', root])
    assertEquals(configured.envelope.data.state, 'configured')
    assertEquals(configured.envelope.data.startup_required, true)
    assertEquals(configured.envelope.data.problems, [])

    const repeated = await run([
      '--non-interactive',
      '--yes',
      '--input',
      inputPath,
      'provision',
      'activate',
      '--root',
      root,
      '--owner-key-backup',
      join(backupDir, 'second.pem'),
    ])
    assertEquals(repeated.code, 6)
    assertEquals(repeated.envelope.error.code, 'TARGET_ALREADY_ACTIVATED')
    assert(!await Deno.stat(join(backupDir, 'second.pem')).catch(() => null))

    const failedCheck = await run([
      'provision',
      'check',
      '--root',
      root,
      '--domain',
      'corp.example.com',
      '--owner-name',
      'admin',
      '--owner-key-backup',
      backup,
    ])
    assertEquals(failedCheck.code, 6)
    assertEquals(failedCheck.envelope.error.code, 'ACTIVATION_PRECHECK_FAILED')
    assertEquals(
      failedCheck.envelope.error.details.problems.map((problem: { code: string }) => problem.code),
      ['TARGET_ALREADY_ACTIVATED', 'OWNER_KEY_BACKUP_EXISTS'],
    )
  } finally {
    await Deno.remove(sandbox, { recursive: true })
  }
})

Deno.test('provision refuses roots outside the host policy before touching the SDK', async () => {
  const io = new CaptureStdio()
  let inspected = 0
  const app = new BuckyOSToolApplication({
    stdio: io,
    provision: {
      inspect: () => {
        inspected += 1
        throw new Error('must not be reached')
      },
    },
  })
  const code = await app.run(['provision', 'status', '--root', '/definitely/outside/policy'])
  const envelope = io.takeEnvelope()
  assertEquals(code, 4)
  assertEquals(envelope.error.code, 'HOST_ACCESS_DENIED')
  assertEquals(inspected, 0)
})
