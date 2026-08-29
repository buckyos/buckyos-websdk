import { createHash as nodeCreateHash } from 'node:crypto'
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import { tmpdir } from 'node:os'
import * as nodePath from 'node:path'
import { spawn } from 'node:child_process'
import process from 'node:process'
import { createInterface } from 'node:readline/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { constants as zlibConstants, createGzip } from 'node:zlib'
import {
  type DistributionPolicy,
  HostError,
  type HostFile,
  type HostFileInfo,
  type HostLineReader,
  type ToolHost,
} from './host.ts'

export class NodeHost implements ToolHost {
  readonly kind = 'node' as const
  readonly runtimeName = 'node'
  readonly runtimeVersion = process.versions.node
  readonly platform = normalizePlatform(process.platform)
  readonly arch = normalizeArch(process.arch)
  readonly pid = process.pid
  readonly executable = process.argv[1] ? nodePath.resolve(process.argv[1]) : process.execPath
  readonly runtimeExecutable = process.execPath
  readonly path = nodePath
  readonly policy: DistributionPolicy

  constructor(policy: DistributionPolicy) {
    this.policy = policy
  }

  cwd(): string {
    return process.cwd()
  }

  homeDir(): string {
    return process.env.HOME ?? process.env.USERPROFILE ?? process.cwd()
  }

  env(name: string): string | undefined {
    if (!this.policy.environment.includes(name)) {
      throw new HostError('PermissionDenied', `environment access is not allowed: ${name}`)
    }
    return process.env[name]
  }

  exit(code: number): never {
    process.exit(code)
  }

  setExitCode(code: number): void {
    process.exitCode = code
  }

  async readTextFile(path: string): Promise<string> {
    await this.assertPath(path, 'read')
    try {
      return await readFile(path, 'utf8')
    } catch (error) {
      throw translateNodeError(error, path)
    }
  }

  async readFile(path: string): Promise<Uint8Array> {
    await this.assertPath(path, 'read')
    try {
      return new Uint8Array(await readFile(path))
    } catch (error) {
      throw translateNodeError(error, path)
    }
  }

  async writeTextFile(
    path: string,
    value: string,
    options: { createNew?: boolean; mode?: number } = {},
  ): Promise<void> {
    await this.assertPath(path, 'write')
    try {
      await writeFile(path, value, {
        flag: options.createNew ? 'wx' : 'w',
        mode: options.mode,
      })
    } catch (error) {
      throw translateNodeError(error, path)
    }
  }

  async writeFile(
    path: string,
    value: Uint8Array,
    options: { createNew?: boolean; mode?: number } = {},
  ): Promise<void> {
    await this.assertPath(path, 'write')
    try {
      await writeFile(path, value, {
        flag: options.createNew ? 'wx' : 'w',
        mode: options.mode,
      })
    } catch (error) {
      throw translateNodeError(error, path)
    }
  }

  async readDir(path: string) {
    await this.assertPath(path, 'read')
    try {
      return (await readdir(path, { withFileTypes: true })).map((entry) => ({
        name: entry.name,
        isFile: entry.isFile(),
        isDirectory: entry.isDirectory(),
        isSymlink: entry.isSymbolicLink(),
      }))
    } catch (error) {
      throw translateNodeError(error, path)
    }
  }

  async stat(path: string): Promise<HostFileInfo> {
    await this.assertPath(path, 'read')
    try {
      return fileInfo(await stat(path))
    } catch (error) {
      throw translateNodeError(error, path)
    }
  }

  async lstat(path: string): Promise<HostFileInfo> {
    await this.assertPath(path, 'read', false)
    try {
      return fileInfo(await lstat(path))
    } catch (error) {
      throw translateNodeError(error, path)
    }
  }

  async realPath(path: string): Promise<string> {
    await this.assertPath(path, 'read')
    try {
      return await realpath(path)
    } catch (error) {
      throw translateNodeError(error, path)
    }
  }

  async makeTempDir(options: { dir?: string; prefix?: string } = {}): Promise<string> {
    const directory = options.dir ?? tmpdir()
    await this.assertPath(directory, 'write')
    try {
      return await mkdtemp(nodePath.join(directory, options.prefix ?? 'buckyos-'))
    } catch (error) {
      throw translateNodeError(error, directory)
    }
  }

  async makeTempFile(options: { dir?: string; prefix?: string } = {}): Promise<string> {
    const directory = await this.makeTempDir({ dir: options.dir, prefix: options.prefix })
    const path = nodePath.join(directory, 'file')
    await this.writeFile(path, new Uint8Array(), { createNew: true, mode: 0o600 })
    return path
  }

  async rename(from: string, to: string): Promise<void> {
    await this.assertPath(from, 'write')
    await this.assertPath(to, 'write')
    try {
      await rename(from, to)
    } catch (error) {
      throw translateNodeError(error, `${from} -> ${to}`)
    }
  }

  async remove(path: string, options: { recursive?: boolean } = {}): Promise<void> {
    await this.assertPath(path, 'write', false)
    try {
      await rm(path, { recursive: options.recursive ?? false })
    } catch (error) {
      throw translateNodeError(error, path)
    }
  }

  async mkdir(path: string, options: { recursive?: boolean; mode?: number } = {}): Promise<void> {
    await this.assertPath(path, 'write', false)
    try {
      await mkdir(path, { recursive: options.recursive, mode: options.mode })
    } catch (error) {
      throw translateNodeError(error, path)
    }
  }

  async chmod(path: string, mode: number): Promise<void> {
    await this.assertPath(path, 'write')
    try {
      await chmod(path, mode)
    } catch (error) {
      throw translateNodeError(error, path)
    }
  }

  async symlink(target: string, path: string): Promise<void> {
    await this.assertPath(target, 'read')
    await this.assertPath(path, 'write', false)
    try {
      await symlink(target, path)
    } catch (error) {
      throw translateNodeError(error, path)
    }
  }

  async copyFile(from: string, to: string): Promise<void> {
    await this.assertPath(from, 'read')
    await this.assertPath(to, 'write', false)
    try {
      await copyFile(from, to)
    } catch (error) {
      throw translateNodeError(error, `${from} -> ${to}`)
    }
  }

  async open(
    path: string,
    options: { read?: boolean; write?: boolean; createNew?: boolean; mode?: number },
  ): Promise<HostFile> {
    await this.assertPath(path, options.write ? 'write' : 'read', !options.createNew)
    const flags = options.read && options.write
      ? 'r+'
      : options.write
      ? options.createNew ? 'wx' : 'w'
      : 'r'
    try {
      return new NodeHostFile(await open(path, flags, options.mode))
    } catch (error) {
      throw translateNodeError(error, path)
    }
  }

  createHash(_algorithm: 'sha256') {
    const hash = nodeCreateHash('sha256')
    return {
      update(bytes: Uint8Array) {
        hash.update(bytes)
      },
      digestHex() {
        return hash.digest('hex')
      },
    }
  }

  async gzipFile(source: string, destination: string): Promise<void> {
    await this.assertPath(source, 'read')
    await this.assertPath(destination, 'write', false)
    try {
      await pipeline(
        Readable.from(fixedChunks(createReadStream(source))),
        createGzip({ level: 6, strategy: zlibConstants.Z_RLE }),
        createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
      )
    } catch (error) {
      throw translateNodeError(error, destination)
    }
  }

  async run(command: string, args: string[]) {
    this.assertCommand(command)
    return await capture(command, args)
  }

  async runGzip(command: string, args: string[], destination: string) {
    this.assertCommand(command)
    await this.assertPath(destination, 'write', false)
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false })
    const stderr: Uint8Array[] = []
    child.stderr.on('data', (chunk) => stderr.push(new Uint8Array(chunk)))
    try {
      await pipeline(
        Readable.from(fixedChunks(child.stdout)),
        createGzip({ level: 6, strategy: zlibConstants.Z_RLE }),
        createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
      )
      const code = await childStatus(child)
      return { success: code === 0, code, stdout: new Uint8Array(), stderr: concat(stderr) }
    } catch (error) {
      child.kill()
      throw translateNodeError(error, destination)
    }
  }

  async stdout(value: string | Uint8Array): Promise<void> {
    await writeStream(process.stdout, value)
  }

  async stderr(value: string | Uint8Array): Promise<void> {
    await writeStream(process.stderr, value)
  }

  async readStdin(): Promise<string> {
    const chunks: Uint8Array[] = []
    for await (const chunk of process.stdin) chunks.push(new Uint8Array(chunk))
    return new TextDecoder().decode(concat(chunks))
  }

  async readLine(prompt: string): Promise<string | null> {
    const reader = createInterface({ input: process.stdin, output: process.stderr })
    try {
      return await reader.question(prompt)
    } catch {
      return null
    } finally {
      reader.close()
    }
  }

  async readSecret(prompt: string): Promise<string> {
    if (!this.inputIsTerminal() || typeof process.stdin.setRawMode !== 'function') {
      throw new HostError('PermissionDenied', 'secret input requires a terminal')
    }
    await this.stderr(prompt)
    process.stdin.setRawMode(true)
    process.stdin.resume()
    const bytes: number[] = []
    try {
      while (true) {
        const chunk = await readInputChunk()
        if (chunk === null) break
        const byte = chunk[0]
        if (byte === 10 || byte === 13) break
        if (byte === 3) throw new HostError('PermissionDenied', 'secret input canceled')
        if (byte === 8 || byte === 127) bytes.pop()
        else bytes.push(byte)
      }
    } finally {
      process.stdin.setRawMode(false)
      process.stdin.pause()
      await this.stderr('\n')
    }
    return new TextDecoder().decode(Uint8Array.from(bytes))
  }

  inputIsTerminal(): boolean {
    return Boolean(process.stdin.isTTY)
  }

  createLineReader(options: {
    history: string[]
    historySize: number
    completer(line: string): [string[], string]
    onSigint(): void
  }): HostLineReader {
    const reader = createInterface({
      input: process.stdin,
      output: process.stderr,
      terminal: true,
      history: options.history,
      historySize: options.historySize,
      completer: options.completer,
    })
    reader.on('SIGINT', options.onSigint)
    return {
      [Symbol.asyncIterator]: () => reader[Symbol.asyncIterator](),
      write: (value) => process.stderr.write(value),
      setPrompt: (value) => reader.setPrompt(value),
      prompt: () => reader.prompt(),
      close: () => reader.close(),
    }
  }

  private assertCommand(command: string): void {
    if (!this.policy.subprocesses.includes(command)) {
      throw new HostError('PermissionDenied', `subprocess is not allowed: ${command}`)
    }
  }

  private async assertPath(
    candidate: string,
    operation: 'read' | 'write',
    resolveLinks = true,
  ): Promise<void> {
    const roots = operation === 'read' ? this.policy.readPaths : this.policy.writePaths
    const absolute = nodePath.resolve(candidate)
    if (!insideAny(absolute, roots)) {
      throw new HostError(
        'PermissionDenied',
        `${operation} access is outside ${this.policy.name}: ${absolute}`,
        absolute,
      )
    }
    if (!resolveLinks) return
    try {
      const physical = await realpath(absolute)
      if (!insideAny(physical, roots)) {
        throw new HostError(
          'PermissionDenied',
          `${operation} access escapes ${this.policy.name}: ${absolute}`,
          absolute,
        )
      }
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') throw error
    }
  }
}

async function* fixedChunks(
  source: AsyncIterable<Uint8Array>,
): AsyncGenerator<Uint8Array> {
  const size = 64 * 1024
  let pending = new Uint8Array(size)
  let used = 0
  for await (const chunk of source) {
    let offset = 0
    while (offset < chunk.byteLength) {
      const copied = Math.min(size - used, chunk.byteLength - offset)
      pending.set(chunk.subarray(offset, offset + copied), used)
      used += copied
      offset += copied
      if (used === size) {
        yield pending
        pending = new Uint8Array(size)
        used = 0
      }
    }
  }
  if (used > 0) yield pending.slice(0, used)
}

class NodeHostFile implements HostFile {
  readonly handle
  #position = 0

  constructor(handle: Awaited<ReturnType<typeof open>>) {
    this.handle = handle
  }

  async read(buffer: Uint8Array): Promise<number | null> {
    const result = await this.handle.read(buffer, 0, buffer.length, this.#position)
    if (result.bytesRead === 0) return null
    this.#position += result.bytesRead
    return result.bytesRead
  }

  async write(buffer: Uint8Array): Promise<number> {
    const result = await this.handle.write(buffer, 0, buffer.length, this.#position)
    this.#position += result.bytesWritten
    return result.bytesWritten
  }

  seek(offset: number): Promise<number> {
    this.#position = offset
    return Promise.resolve(offset)
  }

  async stat(): Promise<HostFileInfo> {
    return fileInfo(await this.handle.stat())
  }

  async sync(): Promise<void> {
    await this.handle.sync()
  }

  close(): Promise<void> {
    return this.handle.close()
  }
}

function fileInfo(value: {
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
  size: number
  mode: number
  mtime: Date
  dev: number
  ino: number
}): HostFileInfo {
  return {
    isFile: value.isFile(),
    isDirectory: value.isDirectory(),
    isSymlink: value.isSymbolicLink(),
    size: value.size,
    mode: value.mode ?? null,
    mtime: value.mtime ?? null,
    dev: value.dev ?? null,
    ino: value.ino ?? null,
  }
}

function insideAny(candidate: string, roots: readonly string[]): boolean {
  return roots.some((root) => {
    const relative = nodePath.relative(nodePath.resolve(root), candidate)
    return relative === '' || relative !== '..' && !relative.startsWith(`..${nodePath.sep}`) &&
        !nodePath.isAbsolute(relative)
  })
}

async function capture(command: string, args: string[]) {
  return await new Promise<{
    success: boolean
    code: number
    stdout: Uint8Array
    stderr: Uint8Array
  }>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false })
    const stdout: Uint8Array[] = []
    const stderr: Uint8Array[] = []
    child.stdout.on('data', (chunk) => stdout.push(new Uint8Array(chunk)))
    child.stderr.on('data', (chunk) => stderr.push(new Uint8Array(chunk)))
    child.once('error', reject)
    child.once('close', (code) =>
      resolve({
        success: code === 0,
        code: code ?? 1,
        stdout: concat(stdout),
        stderr: concat(stderr),
      }))
  })
}

async function childStatus(child: ReturnType<typeof spawn>): Promise<number> {
  if (child.exitCode !== null) return child.exitCode
  return await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) => resolve(code ?? 1))
  })
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}

async function writeStream(
  stream: NodeJS.WritableStream,
  value: string | Uint8Array,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.write(value, (error?: Error | null) => error ? reject(error) : resolve())
  })
}

async function readInputChunk(): Promise<Uint8Array | null> {
  return await new Promise((resolve, reject) => {
    const onData = (chunk: Uint8Array) => done(new Uint8Array(chunk))
    const onEnd = () => done(null)
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const cleanup = () => {
      process.stdin.off('data', onData)
      process.stdin.off('end', onEnd)
      process.stdin.off('error', onError)
    }
    const done = (value: Uint8Array | null) => {
      cleanup()
      resolve(value)
    }
    process.stdin.once('data', onData)
    process.stdin.once('end', onEnd)
    process.stdin.once('error', onError)
  })
}

function translateNodeError(error: unknown, path?: string): HostError {
  if (error instanceof HostError) return error
  const code = (error as { code?: string }).code
  const kind = code === 'ENOENT'
    ? 'NotFound'
    : code === 'EACCES' || code === 'EPERM'
    ? 'PermissionDenied'
    : code === 'EEXIST'
    ? 'AlreadyExists'
    : code === 'EINVAL'
    ? 'InvalidInput'
    : 'Unknown'
  return new HostError(kind, error instanceof Error ? error.message : String(error), path, error)
}

function normalizePlatform(value: string): string {
  return value === 'win32' ? 'windows' : value === 'darwin' ? 'macos' : value
}

function normalizeArch(value: string): string {
  return value === 'x64' ? 'x86_64' : value === 'arm64' ? 'aarch64' : value
}
