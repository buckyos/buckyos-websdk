import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { gunzipSync } from 'node:zlib'

const options = parseArgs(process.argv.slice(2))
const required = ['tarball', 'deno', 'sbom', 'output', 'buckyos-version', 'build-id']
for (const name of required) {
  if (!options[name]) throw new Error(`--${name} is required`)
}
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const tarball = await readFile(options.tarball)
const deno = await readFile(options.deno)
const sbomBytes = await readFile(options.sbom)
const npmFiles = npmFileManifest(tarball)
const versionResult = spawnSync(options.deno, ['--version'], { encoding: 'utf8' })
if (versionResult.status !== 0) throw new Error(versionResult.stderr || 'failed to run Deno')
const denoVersion = versionResult.stdout.split(/\r?\n/, 1)[0].split(/\s+/)[1]
validateSbom(
  JSON.parse(new TextDecoder().decode(sbomBytes)),
  packageJson,
  tarball,
  deno,
  denoVersion,
)
const manifest = {
  schema_version: 1,
  buckyos_version: options['buckyos-version'],
  build_id: options['build-id'],
  tool_version: packageJson.version,
  sdk_version: packageJson.version,
  npm_tarball_sha256: hash('sha256', tarball, 'hex'),
  npm_integrity: `sha512-${hash('sha512', tarball, 'base64')}`,
  npm_files_sha256: hash(
    'sha256',
    new TextEncoder().encode(JSON.stringify(npmFiles)),
    'hex',
  ),
  npm_files: npmFiles,
  deno_version: denoVersion,
  deno_sha256: hash('sha256', deno, 'hex'),
  sbom_sha256: hash('sha256', sbomBytes, 'hex'),
  protocol_version: '1',
  capability_range: options['capability-range'] ?? 'buckyos.tool.v1',
}
await writeFile(options.output, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })

function validateSbom(sbom, packageJson, tarball, deno, denoVersion) {
  if (sbom.bomFormat !== 'CycloneDX' || sbom.metadata?.component?.name !== packageJson.name) {
    throw new Error('SBOM is not a CycloneDX document for this package')
  }
  if (sbom.metadata.component.version !== packageJson.version) {
    throw new Error('SBOM package version differs from package.json')
  }
  const tarballHash = sbom.metadata.component.hashes?.find((value) => value.alg === 'SHA-256')
  if (tarballHash?.content !== hash('sha256', tarball, 'hex')) {
    throw new Error('SBOM npm tarball digest differs from the release artifact')
  }
  const denoComponent = sbom.components?.find((value) =>
    value.name === 'deno' && value.version === denoVersion
  )
  const denoHash = denoComponent?.hashes?.find((value) => value.alg === 'SHA-256')
  if (denoHash?.content !== hash('sha256', deno, 'hex')) {
    throw new Error('SBOM Deno digest differs from the release runtime')
  }
}

function hash(algorithm, bytes, encoding) {
  return createHash(algorithm).update(bytes).digest(encoding)
}

function parseArgs(argv) {
  const output = {}
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!name?.startsWith('--') || value === undefined) throw new Error(`invalid argument: ${name}`)
    output[name.slice(2)] = value
  }
  return output
}

function npmFileManifest(tarball) {
  const archive = gunzipSync(tarball)
  const files = []
  let offset = 0
  let pax = {}
  let longPath
  while (offset + 512 <= archive.byteLength) {
    const header = archive.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const type = String.fromCharCode(header[156] || 48)
    const name = `${tarString(header, 345, 155)}${tarString(header, 345, 155) ? '/' : ''}${
      tarString(header, 0, 100)
    }`
    const size = tarNumber(header, 124, 12)
    const bodyStart = offset + 512
    const bodyEnd = bodyStart + size
    if (bodyEnd > archive.byteLength) throw new Error(`truncated npm tar entry: ${name}`)
    const body = archive.subarray(bodyStart, bodyEnd)
    if (type === 'x') {
      pax = parsePax(body)
    } else if (type === 'L') {
      longPath = text(body).replace(/\0.*$/s, '').trimEnd()
    } else if (type === '0' || type === '\0') {
      const path = pax.path ?? longPath ?? name
      validatePackagePath(path)
      files.push({
        path: path.slice('package/'.length),
        size,
        sha256: hash('sha256', body, 'hex'),
      })
      pax = {}
      longPath = undefined
    } else if (type !== '5') {
      throw new Error(`unsupported npm tar entry type ${JSON.stringify(type)}: ${name}`)
    }
    offset = bodyStart + Math.ceil(size / 512) * 512
  }
  files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  if (!files.some((file) => file.path === 'package.json')) {
    throw new Error('npm tarball does not contain package/package.json')
  }
  return files
}

function tarString(buffer, offset, length) {
  return text(buffer.subarray(offset, offset + length)).replace(/\0.*$/s, '')
}

function tarNumber(buffer, offset, length) {
  const raw = tarString(buffer, offset, length).trim()
  if (!/^[0-7]*$/.test(raw)) throw new Error(`invalid npm tar numeric field: ${raw}`)
  return raw ? Number.parseInt(raw, 8) : 0
}

function parsePax(buffer) {
  const output = {}
  let value = text(buffer)
  while (value) {
    const separator = value.indexOf(' ')
    const length = Number.parseInt(value.slice(0, separator), 10)
    if (!Number.isSafeInteger(length) || length <= separator) throw new Error('invalid PAX record')
    const record = value.slice(separator + 1, length - 1)
    const equals = record.indexOf('=')
    if (equals > 0) output[record.slice(0, equals)] = record.slice(equals + 1)
    value = value.slice(length)
  }
  return output
}

function validatePackagePath(path) {
  if (!path.startsWith('package/')) throw new Error(`unexpected npm tar entry: ${path}`)
  const relative = path.slice('package/'.length)
  if (!relative || relative.startsWith('/') || relative.split('/').includes('..')) {
    throw new Error(`unsafe npm tar entry: ${path}`)
  }
}

function text(buffer) {
  return new TextDecoder().decode(buffer)
}
