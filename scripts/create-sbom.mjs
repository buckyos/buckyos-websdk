import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import process from 'node:process'

const options = parseArgs(process.argv.slice(2))
const required = ['tarball', 'deno', 'output']
for (const name of required) {
  if (!options[name]) throw new Error(`--${name} is required`)
}

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const lockfile = await readFile(new URL('../pnpm-lock.yaml', import.meta.url))
const tarball = await readFile(options.tarball)
const deno = await readFile(options.deno)
const denoResult = spawnSync(options.deno, ['--version'], { encoding: 'utf8' })
if (denoResult.status !== 0) throw new Error(denoResult.stderr || 'failed to run Deno')
const denoVersion = denoResult.stdout.split(/\r?\n/, 1)[0].split(/\s+/)[1]
const dependencyTree = productionDependencyTree()
const rootRef = npmPurl(packageJson.name, packageJson.version)
const denoRef = `pkg:generic/deno@${encodeURIComponent(denoVersion)}`
const nodes = collectDependencies(dependencyTree.dependencies ?? {})
const components = [...nodes.values()]
  .sort((left, right) => left.ref.localeCompare(right.ref))
  .map((node) => ({
    type: 'library',
    'bom-ref': node.ref,
    name: node.name,
    version: node.version,
    purl: node.ref,
    ...(node.resolved
      ? {
        externalReferences: [{ type: 'distribution', url: node.resolved }],
      }
      : {}),
  }))
components.push({
  type: 'application',
  'bom-ref': denoRef,
  name: 'deno',
  version: denoVersion,
  purl: denoRef,
  hashes: [{ alg: 'SHA-256', content: hash('sha256', deno, 'hex') }],
  properties: [{ name: 'buckyos:distribution', value: 'system-only-runtime' }],
})

const dependencies = [...nodes.values()]
  .sort((left, right) => left.ref.localeCompare(right.ref))
  .map((node) => ({ ref: node.ref, dependsOn: [...node.children].sort() }))
dependencies.unshift({
  ref: rootRef,
  dependsOn: [
    ...Object.values(dependencyTree.dependencies ?? {}).map((value) => dependencyRef(value)),
    denoRef,
  ].sort(),
})
dependencies.push({ ref: denoRef, dependsOn: [] })

const sbom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  version: 1,
  metadata: {
    component: {
      type: 'application',
      'bom-ref': rootRef,
      name: packageJson.name,
      version: packageJson.version,
      purl: rootRef,
      hashes: [
        { alg: 'SHA-256', content: hash('sha256', tarball, 'hex') },
        { alg: 'SHA-512', content: hash('sha512', tarball, 'hex') },
      ],
      properties: [
        { name: 'buckyos:distribution', value: 'npm-and-system' },
        { name: 'buckyos:pnpm-lock-sha256', value: hash('sha256', lockfile, 'hex') },
      ],
    },
  },
  components,
  dependencies,
}
await writeFile(options.output, `${JSON.stringify(sbom, null, 2)}\n`, { flag: 'wx' })

function productionDependencyTree() {
  const packageManager = process.env.npm_execpath
  const command = packageManager
    ? process.execPath
    : process.platform === 'win32'
    ? 'pnpm.cmd'
    : 'pnpm'
  const args = packageManager
    ? [packageManager, 'list', '--prod', '--json', '--depth', 'Infinity']
    : ['list', '--prod', '--json', '--depth', 'Infinity']
  const result = spawnSync(command, args, {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr || 'pnpm list failed')
  const roots = JSON.parse(result.stdout)
  if (roots.length !== 1 || roots[0].name !== packageJson.name) {
    throw new Error('pnpm production dependency tree has an unexpected root')
  }
  return roots[0]
}

function collectDependencies(rootDependencies) {
  const output = new Map()
  const visit = (dependencies) => {
    for (const [name, value] of Object.entries(dependencies)) {
      if (!value.version) throw new Error(`production dependency has no version: ${name}`)
      const ref = npmPurl(name, value.version)
      const current = output.get(ref) ?? {
        ref,
        name,
        version: value.version,
        resolved: value.resolved,
        children: new Set(),
      }
      for (const child of Object.values(value.dependencies ?? {})) {
        current.children.add(dependencyRef(child))
      }
      output.set(ref, current)
      visit(value.dependencies ?? {})
    }
  }
  visit(rootDependencies)
  return output
}

function dependencyRef(value) {
  const name = value.from
  if (!name || !value.version) throw new Error('production dependency is missing name or version')
  return npmPurl(name, value.version)
}

function npmPurl(name, version) {
  const encodedName = name.startsWith('@')
    ? `%40${name.slice(1).split('/').map(encodeURIComponent).join('/')}`
    : encodeURIComponent(name)
  return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`
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
