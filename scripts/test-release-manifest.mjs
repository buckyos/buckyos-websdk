import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspace = await mkdtemp(join(tmpdir(), 'buckyos-release-manifest-'))
try {
  const packed = run(managerCommand('npm'), ['pack', '--json', '--pack-destination', workspace])
  const packInfo = JSON.parse(packed.stdout)[0]
  const deno = run('deno', ['eval', 'console.log(Deno.execPath())']).stdout.trim()
  const sbom = join(workspace, 'sbom.cdx.json')
  run(process.execPath, [
    join(packageRoot, 'scripts', 'create-sbom.mjs'),
    '--tarball',
    join(workspace, packInfo.filename),
    '--deno',
    deno,
    '--output',
    sbom,
  ])
  const output = join(workspace, 'release.json')
  run(process.execPath, [
    join(packageRoot, 'scripts', 'create-release-manifest.mjs'),
    '--tarball',
    join(workspace, packInfo.filename),
    '--deno',
    deno,
    '--sbom',
    sbom,
    '--output',
    output,
    '--buckyos-version',
    'conformance',
    '--build-id',
    'conformance',
  ])
  const manifest = JSON.parse(await readFile(output, 'utf8'))
  const packedPaths = packInfo.files.map((file) => file.path).sort()
  const manifestPaths = manifest.npm_files.map((file) => file.path).sort()
  if (JSON.stringify(packedPaths) !== JSON.stringify(manifestPaths)) {
    throw new Error('release manifest file list differs from npm pack')
  }
  if (manifest.tool_version !== manifest.sdk_version || !manifest.npm_files_sha256) {
    throw new Error('release manifest version or file digest is invalid')
  }
  const sbomValue = JSON.parse(await readFile(sbom, 'utf8'))
  if (sbomValue.bomFormat !== 'CycloneDX' || sbomValue.components.length < 2) {
    throw new Error('release SBOM is invalid')
  }
  process.stdout.write(
    `release manifest/SBOM smoke passed (${manifest.npm_files.length} files, ` +
      `${sbomValue.components.length} components).\n`,
  )
} finally {
  await rm(workspace, { recursive: true, force: true })
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: packageRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    shell: process.platform === 'win32' && command.endsWith('.cmd'),
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed:\n${result.stderr}${result.stdout}`)
  }
  return result
}

function managerCommand(name) {
  return process.platform === 'win32' ? `${name}.cmd` : name
}
