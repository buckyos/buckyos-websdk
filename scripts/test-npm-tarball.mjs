import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspace = await mkdtemp(join(tmpdir(), 'buckyos npm-smoke-示例-'))
const packDirectory = join(workspace, 'packed artifact')
await mkdir(packDirectory, { recursive: true })

try {
  const packed = run(managerCommand('npm'), [
    'pack',
    '--json',
    '--pack-destination',
    packDirectory,
  ], packageRoot)
  const packResult = JSON.parse(packed.stdout)
  const tarball = join(packDirectory, packResult[0].filename)
  await stat(tarball)
  for (const manager of ['npm', 'pnpm']) await smokeManager(manager, tarball)
  process.stdout.write('npm tarball smoke passed with npm and pnpm (Node-only PIKG workflow).\n')
} finally {
  await rm(workspace, { recursive: true, force: true })
}

async function smokeManager(manager, tarball) {
  const project = join(workspace, `${manager} project with space-示例`)
  await mkdir(join(project, 'web', 'dist'), { recursive: true })
  await writeFile(
    join(project, 'package.json'),
    JSON.stringify({ name: `${manager}-smoke`, private: true }),
  )
  await writeFile(join(project, 'web', 'dist', 'index.html'), '<h1>pack smoke</h1>\n')
  const installArgs = manager === 'npm'
    ? ['install', '--ignore-scripts', tarball]
    : ['add', '--ignore-scripts', tarball]
  run(managerCommand(manager), installArgs, project)
  const binary = join(
    project,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'buckyos.cmd' : 'buckyos',
  )
  await stat(binary)
  await assertMissing(join(project, 'node_modules', 'buckyos', 'cli', 'runtime', 'deno'))

  const commands = [
    ['--version'],
    ['--output', 'json', '--trace-id', 'smoke', 'command', 'list'],
    ['--output', 'json', '--trace-id', 'smoke', 'command', 'describe', 'pikg', 'build'],
    [
      '--non-interactive',
      '--output',
      'json',
      '--trace-id',
      'smoke',
      'pikg',
      'init',
      '.',
      '--name',
      'smoke-app',
      '--owner',
      'did:bns:root',
      '--kind',
      'static-web',
      '--source',
      './web/dist',
    ],
    ['--output', 'json', '--trace-id', 'smoke', 'pikg', 'build'],
    ['--output', 'json', '--trace-id', 'smoke', 'pikg', 'pack'],
    ['--output', 'json', '--trace-id', 'smoke', 'pikg', 'info', './dapp_dist/smoke-app-0.1.0.pikg'],
    ['--non-interactive', '--yes', '--output', 'json', '--trace-id', 'smoke', 'pikg', 'clean'],
  ]
  for (const args of commands) run(binary, args, project)
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, SOURCE_DATE_EPOCH: '1800000000' },
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    shell: process.platform === 'win32' && command.endsWith('.cmd'),
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed (${result.status}):\n${result.stderr}${result.stdout}`,
    )
  }
  return result
}

async function assertMissing(path) {
  try {
    await stat(path)
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  throw new Error(`developer tarball unexpectedly contains a Deno runtime: ${path}`)
}

function managerCommand(name) {
  return process.platform === 'win32' ? `${name}.cmd` : name
}
