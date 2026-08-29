import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const nodeLauncher = join(packageRoot, 'cli', 'launcher.mjs')
const systemLauncher = join(packageRoot, 'cli', 'system_launcher.ts')
const workspace = await mkdtemp(join(tmpdir(), 'buckyos conformance-示例-'))
const project = join(workspace, 'app with space-示例')
const environment = {
  ...process.env,
  HOME: join(workspace, 'home'),
  USERPROFILE: join(workspace, 'home'),
  BUCKYOS_TOOL_CONFIG_DIR: join(workspace, 'config'),
  SOURCE_DATE_EPOCH: '1800000000',
}

try {
  await mkdir(join(project, 'web', 'dist'), { recursive: true })
  await writeFile(join(project, 'web', 'dist', 'index.html'), '<h1>Hello, 双宿主</h1>\n')

  const staticCases = [
    ['--version'],
    ['--help'],
    ['--output', 'json', '--trace-id', 'conformance', 'command', 'list'],
    [
      '--output',
      'json',
      '--trace-id',
      'conformance',
      'command',
      'describe',
      'pikg',
      'build',
    ],
    ['--output', 'json', '--trace-id', 'conformance', 'missing-module', 'missing-verb'],
  ]
  for (const args of staticCases) assertEquivalent(args, runNode(args), runDeno(args))

  const nodeWorkflow = await runPikgWorkflow('node')
  const denoWorkflow = await runPikgWorkflow('deno')
  assertDeepEqual(nodeWorkflow.results, denoWorkflow.results, 'PIKG command results')
  assertDeepEqual(nodeWorkflow.snapshot, denoWorkflow.snapshot, 'PIKG file side effects')
  process.stdout.write(
    'Node/Deno CLI conformance passed (5 registry/error cases + full PIKG workflow).\n',
  )
} finally {
  await rm(workspace, { recursive: true, force: true })
}

async function runPikgWorkflow(host) {
  await rm(join(project, 'dapp_meta'), { recursive: true, force: true })
  await rm(join(project, 'dapp_dist'), { recursive: true, force: true })
  const invoke = host === 'node' ? runNode : runDeno
  const commands = [
    [
      '--non-interactive',
      '--output',
      'json',
      '--trace-id',
      'conformance',
      'pikg',
      'init',
      '.',
      '--owner',
      'did:bns:root',
      '--kind',
      'static-web',
      '--source',
      './web/dist',
    ],
    ['--output', 'json', '--trace-id', 'conformance', 'pikg', 'build'],
    ['--output', 'json', '--trace-id', 'conformance', 'pikg', 'pack'],
  ]
  const results = []
  for (const args of commands) {
    const result = invoke(args, project)
    assertSuccess(args, result)
    results.push(normalizeResult(result))
  }
  const pikg = (await readdir(join(project, 'dapp_dist'))).find((name) => name.endsWith('.pikg'))
  if (!pikg) throw new Error(`${host}: pikg pack did not create a .pikg file`)
  const infoArgs = [
    '--output',
    'json',
    '--trace-id',
    'conformance',
    'pikg',
    'info',
    join(project, 'dapp_dist', pikg),
  ]
  const info = invoke(infoArgs, project)
  assertSuccess(infoArgs, info)
  results.push(normalizeResult(info))
  const snapshot = await fileSnapshot(project, ['dapp_meta', 'dapp_dist'])
  const cleanArgs = [
    '--non-interactive',
    '--yes',
    '--output',
    'json',
    '--trace-id',
    'conformance',
    'pikg',
    'clean',
  ]
  const clean = invoke(cleanArgs, project)
  assertSuccess(cleanArgs, clean)
  results.push(normalizeResult(clean))
  return { results, snapshot }
}

function runNode(args, cwd = project) {
  return run(process.execPath, [nodeLauncher, ...args], cwd)
}

function runDeno(args, cwd = project) {
  return run(
    'deno',
    [
      'run',
      `--allow-read=${packageRoot},${workspace},/opt/buckyos`,
      `--allow-write=${workspace}`,
      '--allow-env',
      '--allow-run=docker',
      systemLauncher,
      ...args,
    ],
    cwd,
  )
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    env: environment,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  if (result.error) throw result.error
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

function assertEquivalent(args, nodeResult, denoResult) {
  const label = args.join(' ')
  assertDeepEqual(normalizeResult(nodeResult), normalizeResult(denoResult), label)
}

function normalizeResult(result) {
  return {
    status: result.status,
    stdout: normalizeVolatile(result.stdout),
    stderr: normalizeVolatile(result.stderr),
  }
}

function normalizeVolatile(value) {
  return value.replace(/"duration_ms":\d+/g, '"duration_ms":0')
}

function assertSuccess(args, result) {
  if (result.status !== 0) {
    throw new Error(
      `${args.join(' ')} failed (${result.status}):\n${result.stderr}${result.stdout}`,
    )
  }
}

function assertDeepEqual(actual, expected, label) {
  const left = JSON.stringify(actual)
  const right = JSON.stringify(expected)
  if (left !== right) {
    throw new Error(`${label} differs between Node and Deno\nNode: ${left}\nDeno: ${right}`)
  }
}

async function fileSnapshot(root, directories) {
  const records = []
  for (const directory of directories) await walk(join(root, directory), records)
  return records

  async function walk(path, output) {
    const entries = await readdir(path, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))
    for (const entry of entries) {
      const child = join(path, entry.name)
      const name = relative(root, child).replaceAll('\\', '/')
      if (entry.isDirectory()) {
        output.push({ name: `${name}/`, type: 'directory' })
        await walk(child, output)
      } else if (entry.isFile()) {
        const bytes = await readFile(child)
        output.push({
          name,
          type: 'file',
          size: bytes.byteLength,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        })
      } else {
        throw new Error(`unexpected non-file side effect: ${child}`)
      }
    }
  }
}
