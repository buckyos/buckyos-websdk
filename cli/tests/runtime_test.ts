import './setup.ts'
import { withDeadline } from '../core/runtime.ts'
import { normalizeError } from '../core/errors.ts'
import { assertEquals, assertRejects } from './test_helpers.ts'
import { buildDistributionPolicy, getHost } from '../runtime/host.ts'

Deno.test('local timeout returns the stable TIMEOUT error', async () => {
  await assertRejects(
    () => withDeadline(new Promise(() => {}), 1),
    'TIMEOUT',
  )
})

Deno.test('local cancellation does not mutate a remote operation', async () => {
  const controller = new AbortController()
  let remoteCompleted = false
  const remote = new Promise<string>((resolve) => {
    setTimeout(() => {
      remoteCompleted = true
      resolve('done')
    }, 5)
  })
  controller.abort()
  await assertRejects(() => withDeadline(remote, 100, controller.signal), 'CANCELED')
  await remote
  assertEquals(remoteCompleted, true)
})

Deno.test('distribution policy grants Docker only to pikg and excludes the system root', () => {
  const host = getHost()
  const common = {
    distribution: 'developer' as const,
    cwd: host.cwd(),
    packageRoot: host.cwd(),
    homeDir: host.homeDir(),
    environment: { HOME: host.homeDir(), BUCKYOS_ROOT: '/opt/buckyos' },
    path: host.path,
  }
  const pikg = buildDistributionPolicy({ ...common, argv: ['pikg', 'build', './dapp_meta'] })
  const doctor = buildDistributionPolicy({ ...common, argv: ['pikg', 'doctor'] })
  const externalMeta = getHost().path.resolve(getHost().homeDir(), 'external', 'dapp_meta')
  const externalBuild = buildDistributionPolicy({
    ...common,
    argv: ['pikg', 'build', externalMeta],
  })
  const explicitReadOne = host.path.resolve(host.homeDir(), 'explicit-read-one')
  const explicitReadTwo = host.path.resolve(host.cwd(), '../explicit-read-two')
  const explicitRead = buildDistributionPolicy({
    ...common,
    argv: [
      '--allow-read',
      explicitReadOne,
      `--allow-read=${explicitReadTwo}`,
      '--allow-read',
      explicitReadOne,
      'pikg',
      'build',
      './dapp_meta',
    ],
  })
  const topLevel = buildDistributionPolicy({ ...common, argv: ['--version'] })
  const online = buildDistributionPolicy({ ...common, argv: ['system', 'status'] })
  assertEquals(pikg.subprocesses, ['docker'])
  assertEquals(doctor.subprocesses, [])
  assertEquals(online.subprocesses, [])
  assertEquals(pikg.network, false)
  assertEquals(topLevel.network, false)
  assertEquals(online.network, true)
  assertEquals(
    externalBuild.writePaths.includes(getHost().path.dirname(externalMeta)),
    true,
  )
  assertEquals(pikg.readPaths.includes('/opt/buckyos'), false)
  assertEquals(pikg.environment.includes('BUCKYOS_ROOT'), false)
  const buckyosIdentityHome = host.path.resolve(host.path.join(host.homeDir(), '.buckyos'))
  const buckycliIdentityHome = host.path.resolve(host.path.join(host.homeDir(), '.buckycli'))
  assertEquals(pikg.readPaths.includes(buckyosIdentityHome), true)
  assertEquals(pikg.readPaths.includes(buckycliIdentityHome), true)
  assertEquals(pikg.writePaths.includes(buckyosIdentityHome), false)
  assertEquals(pikg.writePaths.includes(buckycliIdentityHome), false)
  assertEquals(explicitRead.readPaths.includes(explicitReadOne), true)
  assertEquals(explicitRead.readPaths.includes(explicitReadTwo), true)
  assertEquals(explicitRead.readPaths.filter((path) => path === explicitReadOne).length, 1)
  assertEquals(explicitRead.writePaths.includes(explicitReadOne), false)
  assertEquals(explicitRead.writePaths.includes(explicitReadTwo), false)
})

Deno.test('invalid token errors are not misclassified as missing resources', () => {
  const error = normalizeError(
    new Error('RPC call error: Invalid token: users/ood1/settings not found'),
  )
  assertEquals(error.code, 'INVALID_SESSION')
  assertEquals(error.exitCode, 3)
})

Deno.test('error normalization removes named and database credentials', () => {
  const error = normalizeError(
    new Error('RPC call error: password=hunter2 database=postgres://alice:pw@db/app'),
  )
  assertEquals(error.message.includes('hunter2'), false)
  assertEquals(error.message.includes('alice:pw'), false)
})
