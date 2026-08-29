export type HostKind = 'node' | 'deno'
export type DistributionKind = 'developer' | 'system'
export type HostErrorCode =
  | 'NotFound'
  | 'PermissionDenied'
  | 'AlreadyExists'
  | 'InvalidInput'
  | 'Unknown'

export class HostError extends Error {
  readonly code: HostErrorCode
  readonly path?: string

  constructor(code: HostErrorCode, message: string, path?: string, cause?: unknown) {
    super(message, { cause })
    this.name = 'HostError'
    this.code = code
    this.path = path
  }
}

export function isHostError(error: unknown, code: HostErrorCode): error is HostError {
  return error instanceof HostError && error.code === code
}

export interface HostFileInfo {
  isFile: boolean
  isDirectory: boolean
  isSymlink: boolean
  size: number
  mode: number | null
  mtime: Date | null
  dev: number | null
  ino: number | null
}

export interface HostDirEntry {
  name: string
  isFile: boolean
  isDirectory: boolean
  isSymlink: boolean
}

export interface HostFile {
  read(buffer: Uint8Array): Promise<number | null>
  write(buffer: Uint8Array): Promise<number>
  seek(offset: number): Promise<number>
  stat(): Promise<HostFileInfo>
  sync(): Promise<void>
  close(): Promise<void>
}

export interface HostHash {
  update(bytes: Uint8Array): void
  digestHex(): string
}

export interface HostCommandOutput {
  success: boolean
  code: number
  stdout: Uint8Array
  stderr: Uint8Array
}

export interface HostPath {
  readonly sep: string
  basename(path: string): string
  dirname(path: string): string
  isAbsolute(path: string): boolean
  join(...parts: string[]): string
  relative(from: string, to: string): string
  resolve(...parts: string[]): string
  parse(path: string): { root: string; dir: string; base: string; ext: string; name: string }
}

export interface DistributionPolicy {
  readonly name: 'developer-default' | 'system-default'
  readonly distribution: DistributionKind
  readonly packageRoot: string
  readonly readPaths: readonly string[]
  readonly writePaths: readonly string[]
  readonly environment: readonly string[]
  readonly subprocesses: readonly string[]
  readonly network: boolean
  readonly buckyosRoot?: string
}

export interface ToolHost {
  readonly kind: HostKind
  readonly runtimeName: string
  readonly runtimeVersion: string
  readonly platform: string
  readonly arch: string
  readonly pid: number
  readonly executable: string
  readonly runtimeExecutable: string
  readonly policy: DistributionPolicy
  readonly path: HostPath

  cwd(): string
  homeDir(): string
  env(name: string): string | undefined
  exit(code: number): never
  setExitCode(code: number): void

  readTextFile(path: string): Promise<string>
  readFile(path: string): Promise<Uint8Array>
  writeTextFile(
    path: string,
    value: string,
    options?: { createNew?: boolean; mode?: number },
  ): Promise<void>
  writeFile(
    path: string,
    value: Uint8Array,
    options?: { createNew?: boolean; mode?: number },
  ): Promise<void>
  readDir(path: string): Promise<HostDirEntry[]>
  stat(path: string): Promise<HostFileInfo>
  lstat(path: string): Promise<HostFileInfo>
  realPath(path: string): Promise<string>
  makeTempDir(options?: { dir?: string; prefix?: string }): Promise<string>
  makeTempFile(options?: { dir?: string; prefix?: string }): Promise<string>
  rename(from: string, to: string): Promise<void>
  remove(path: string, options?: { recursive?: boolean }): Promise<void>
  mkdir(path: string, options?: { recursive?: boolean; mode?: number }): Promise<void>
  chmod(path: string, mode: number): Promise<void>
  symlink(target: string, path: string): Promise<void>
  copyFile(from: string, to: string): Promise<void>
  open(
    path: string,
    options: { read?: boolean; write?: boolean; createNew?: boolean; mode?: number },
  ): Promise<HostFile>

  createHash(algorithm: 'sha256'): HostHash
  gzipFile(source: string, destination: string): Promise<void>
  run(command: string, args: string[]): Promise<HostCommandOutput>
  runGzip(command: string, args: string[], destination: string): Promise<HostCommandOutput>

  stdout(value: string | Uint8Array): Promise<void>
  stderr(value: string | Uint8Array): Promise<void>
  readStdin(): Promise<string>
  readLine(prompt: string): Promise<string | null>
  readSecret(prompt: string): Promise<string>
  inputIsTerminal(): boolean
  createLineReader(options: {
    history: string[]
    historySize: number
    completer(line: string): [string[], string]
    onSigint(): void
  }): HostLineReader
}

export interface HostLineReader extends AsyncIterable<string> {
  write(value: string): void
  setPrompt(value: string): void
  prompt(): void
  close(): void
}

let activeHost: ToolHost | undefined

export function installHost(host: ToolHost): void {
  if (activeHost && activeHost !== host) throw new Error('CLI host is already installed')
  activeHost = host
}

export function getHost(): ToolHost {
  if (!activeHost) throw new Error('CLI host was not injected by a launcher')
  return activeHost
}

export function resetHostForTest(): void {
  activeHost = undefined
}

export const TOOL_ENVIRONMENT_NAMES = [
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'BUCKYOS_TOOL_CONFIG_DIR',
  'BUCKYOS_TOOL_PROFILE',
  'BUCKYOS_TOOL_ZONE',
  'BUCKYOS_TOOL_ENDPOINT',
  'BUCKYOS_TOOL_IDENTITY',
  'BUCKYOS_TOOL_OUTPUT',
  'BUCKYOS_IDENTITY_ROOT',
  'BUCKYOS_SECURITY_ROOT',
  'BUCKYOS_APPCLIENT_SESSION_TOKEN',
  'BUCKYOS_ROOT',
  'SOURCE_DATE_EPOCH',
] as const

interface PolicyOptions {
  distribution: DistributionKind
  argv: string[]
  cwd: string
  packageRoot: string
  homeDir: string
  environment: Record<string, string | undefined>
  path: HostPath
  buckyosRoot?: string
}

export function buildDistributionPolicy(options: PolicyOptions): DistributionPolicy {
  const { argv, cwd, packageRoot, homeDir, environment, path } = options
  const buckyosRoot = path.resolve(
    options.buckyosRoot ?? environment.BUCKYOS_ROOT ?? defaultBuckyosRoot(options),
  )
  const configRoot = path.resolve(
    environment.BUCKYOS_TOOL_CONFIG_DIR ?? path.join(homeDir, '.buckyos_tool'),
  )
  const readPaths = new Set([path.resolve(packageRoot), path.resolve(cwd), configRoot])
  const writePaths = new Set([path.resolve(cwd), configRoot])
  if (options.distribution === 'system') readPaths.add(buckyosRoot)
  if (environment.BUCKYOS_IDENTITY_ROOT && environment.BUCKYOS_SECURITY_ROOT) {
    readPaths.add(path.resolve(environment.BUCKYOS_IDENTITY_ROOT))
    readPaths.add(path.resolve(environment.BUCKYOS_SECURITY_ROOT))
  }

  const parsed = collectArgumentPaths(argv)
  for (const candidate of parsed.read) readPaths.add(resolveInputPath(candidate, cwd, path))
  for (const candidate of parsed.write) writePaths.add(resolveInputPath(candidate, cwd, path))
  for (const candidate of parsed.writeParents) {
    writePaths.add(path.dirname(resolveInputPath(candidate, cwd, path)))
  }
  const subprocesses = parsed.module === 'pikg' && ['init', 'build'].includes(parsed.verb ?? '')
    ? ['docker']
    : []
  const network = parsed.module !== undefined &&
    !['pikg', 'command', 'completion', 'config'].includes(parsed.module)
  const allowedEnvironment = options.distribution === 'developer'
    ? TOOL_ENVIRONMENT_NAMES.filter((name) => name !== 'BUCKYOS_ROOT')
    : TOOL_ENVIRONMENT_NAMES

  return Object.freeze({
    name: options.distribution === 'system' ? 'system-default' : 'developer-default',
    distribution: options.distribution,
    packageRoot: path.resolve(packageRoot),
    readPaths: Object.freeze([...readPaths]),
    writePaths: Object.freeze([...writePaths]),
    environment: Object.freeze(allowedEnvironment),
    subprocesses: Object.freeze(subprocesses),
    network,
    ...(options.distribution === 'system' ? { buckyosRoot } : {}),
  })
}

function defaultBuckyosRoot(options: PolicyOptions): string {
  if (options.path.sep === '\\') {
    return options.environment.APPDATA
      ? options.path.join(options.environment.APPDATA, 'buckyos')
      : options.path.join(options.homeDir, 'AppData', 'Roaming', 'buckyos')
  }
  return '/opt/buckyos'
}

function resolveInputPath(value: string, cwd: string, path: HostPath): string {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(cwd, value)
}

function collectArgumentPaths(argv: string[]): {
  read: string[]
  write: string[]
  writeParents: string[]
  module?: string
  verb?: string
} {
  const read: string[] = []
  const write: string[] = []
  const writeParents: string[] = []
  let module: string | undefined
  let verb: string | undefined
  let positional = 0
  const valueOptions = new Set([
    'profile',
    'zone',
    'endpoint',
    'identity',
    'session-token',
    'output',
    'timeout',
    'trace-id',
    'idempotency-key',
    'from',
    'app-class',
    'owner',
    'policy',
    'data',
    'strategy',
    'kind',
    'source',
    'version',
    'name',
  ])
  const booleanOptions = new Set([
    'cli',
    'wait',
    'non-interactive',
    'yes',
    'no-color',
    'verbose',
    'help',
    'version',
  ])
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]
    if (!module && !token.startsWith('-')) {
      module = token
      continue
    }
    if (module && !verb && !token.startsWith('-')) {
      verb = token
      continue
    }
    if (token.startsWith('--')) {
      const equal = token.indexOf('=')
      const name = token.slice(2, equal < 0 ? undefined : equal)
      if (booleanOptions.has(name)) continue
      const inline = equal < 0 ? undefined : token.slice(equal + 1)
      const value = inline ?? argv[index + 1]
      if (inline === undefined && value !== undefined && !value.startsWith('--')) index++
      if (value === undefined) continue
      if (name === 'config-dir') {
        read.push(value)
        write.push(value)
      } else if (
        ['input', 'session-token-file', 'identity-root', 'security-root', 'pikg'].includes(name)
      ) {
        if (value !== '-') read.push(value)
      } else if (name === 'source' && module === 'pikg') {
        read.push(value)
      } else if (name === 'plan') {
        read.push(value)
        if (module === 'app' && verb === 'fetch') write.push(value)
      } else if (name === 'path') write.push(value)
      else if (name === 'file' && module === 'system-config' && verb === 'set-file') {
        read.push(value)
      } else if (!valueOptions.has(name)) continue
      continue
    }
    if (module === 'app' && ['fetch', 'install'].includes(verb ?? '') && positional++ === 0) {
      if (!/^https?:\/\//i.test(token)) read.push(token)
    } else if (module === 'pikg' && positional++ === 0) {
      read.push(token)
      if (verb === 'init' || verb === 'pack') write.push(token)
      else if (verb === 'build' || verb === 'clean') writeParents.push(token)
    }
  }
  return { read, write, writeParents, module, verb }
}

export function policyView(host: ToolHost): Record<string, unknown> {
  return {
    executable: host.executable,
    runtime_executable: host.runtimeExecutable,
    distribution: host.policy.distribution,
    policy: host.policy.name,
    host: host.kind,
    runtime: host.runtimeName,
    runtime_version: host.runtimeVersion,
    platform: host.platform,
    arch: host.arch,
    package_root: host.policy.packageRoot,
    read_paths: [...host.policy.readPaths],
    write_paths: [...host.policy.writePaths],
    environment: [...host.policy.environment],
    subprocesses: [...host.policy.subprocesses],
    network: host.policy.network,
  }
}

export async function readDistributionManifest(
  host: ToolHost = getHost(),
): Promise<Record<string, unknown> | null> {
  const path = host.path.join(host.policy.packageRoot, 'distribution.json')
  try {
    const value = JSON.parse(await host.readTextFile(path)) as unknown
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  } catch (error) {
    if (isHostError(error, 'NotFound')) return null
    throw error
  }
}

export function distributionManifestView(
  manifest: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!manifest) return null
  const { npm_files: files, ...summary } = manifest
  return {
    ...summary,
    npm_file_count: Array.isArray(files) ? files.length : null,
  }
}
