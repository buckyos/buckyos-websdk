import { createHash as denoCreateHash } from 'node:crypto'
import { homedir } from 'node:os'
import * as denoPath from 'node:path'
import { createInterface } from 'node:readline/promises'
import { stderr, stdin } from 'node:process'
import { fileURLToPath } from 'node:url'
import { Readable, Writable } from 'node:stream'
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

export class DenoHost implements ToolHost {
  readonly kind = 'deno' as const
  readonly runtimeName = 'deno'
  readonly runtimeVersion = Deno.version.deno
  readonly platform = normalizePlatform(Deno.build.os)
  readonly arch = normalizeArch(Deno.build.arch)
  readonly pid = Deno.pid
  readonly executable = fileURLToPath(Deno.mainModule)
  readonly runtimeExecutable = Deno.execPath()
  readonly path = denoPath
  readonly policy: DistributionPolicy

  constructor(policy: DistributionPolicy) {
    this.policy = policy
  }

  cwd(): string {
    return Deno.cwd()
  }

  homeDir(): string {
    return Deno.env.get('HOME') ?? Deno.env.get('USERPROFILE') ?? homedir()
  }

  env(name: string): string | undefined {
    if (!this.policy.environment.includes(name)) {
      throw new HostError('PermissionDenied', `environment access is not allowed: ${name}`)
    }
    try {
      return Deno.env.get(name)
    } catch (error) {
      throw translateDenoError(error, name)
    }
  }

  exit(code: number): never {
    Deno.exit(code)
  }

  setExitCode(code: number): void {
    Deno.exitCode = code
  }

  async readTextFile(path: string): Promise<string> {
    await this.assertPath(path, 'read')
    try {
      return await Deno.readTextFile(path)
    } catch (error) {
      throw translateDenoError(error, path)
    }
  }

  async readFile(path: string): Promise<Uint8Array> {
    await this.assertPath(path, 'read')
    try {
      return await Deno.readFile(path)
    } catch (error) {
      throw translateDenoError(error, path)
    }
  }

  async writeTextFile(
    path: string,
    value: string,
    options: { createNew?: boolean; mode?: number } = {},
  ): Promise<void> {
    await this.assertPath(path, 'write', !options.createNew)
    try {
      await Deno.writeTextFile(path, value, options)
    } catch (error) {
      throw translateDenoError(error, path)
    }
  }

  async writeFile(
    path: string,
    value: Uint8Array,
    options: { createNew?: boolean; mode?: number } = {},
  ): Promise<void> {
    await this.assertPath(path, 'write', !options.createNew)
    try {
      await Deno.writeFile(path, value, options)
    } catch (error) {
      throw translateDenoError(error, path)
    }
  }

  async readDir(path: string) {
    await this.assertPath(path, 'read')
    try {
      const output = []
      for await (const entry of Deno.readDir(path)) {
        output.push({
          name: entry.name,
          isFile: entry.isFile,
          isDirectory: entry.isDirectory,
          isSymlink: entry.isSymlink,
        })
      }
      return output
    } catch (error) {
      throw translateDenoError(error, path)
    }
  }

  async stat(path: string): Promise<HostFileInfo> {
    await this.assertPath(path, 'read')
    try {
      return fileInfo(await Deno.stat(path))
    } catch (error) {
      throw translateDenoError(error, path)
    }
  }

  async lstat(path: string): Promise<HostFileInfo> {
    await this.assertPath(path, 'read', false)
    try {
      return fileInfo(await Deno.lstat(path))
    } catch (error) {
      throw translateDenoError(error, path)
    }
  }

  async realPath(path: string): Promise<string> {
    await this.assertPath(path, 'read')
    try {
      return await Deno.realPath(path)
    } catch (error) {
      throw translateDenoError(error, path)
    }
  }

  async makeTempDir(options: { dir?: string; prefix?: string } = {}): Promise<string> {
    const directory = options.dir ?? this.cwd()
    await this.assertPath(directory, 'write')
    try {
      return await Deno.makeTempDir(options)
    } catch (error) {
      throw translateDenoError(error, directory)
    }
  }

  async makeTempFile(options: { dir?: string; prefix?: string } = {}): Promise<string> {
    const directory = options.dir ?? this.cwd()
    await this.assertPath(directory, 'write')
    try {
      return await Deno.makeTempFile(options)
    } catch (error) {
      throw translateDenoError(error, directory)
    }
  }

  async rename(from: string, to: string): Promise<void> {
    await this.assertPath(from, 'write')
    await this.assertPath(to, 'write', false)
    try {
      await Deno.rename(from, to)
    } catch (error) {
      throw translateDenoError(error, `${from} -> ${to}`)
    }
  }

  async remove(path: string, options: { recursive?: boolean } = {}): Promise<void> {
    await this.assertPath(path, 'write', false)
    try {
      await Deno.remove(path, options)
    } catch (error) {
      throw translateDenoError(error, path)
    }
  }

  async mkdir(path: string, options: { recursive?: boolean; mode?: number } = {}): Promise<void> {
    await this.assertPath(path, 'write', false)
    try {
      await Deno.mkdir(path, options)
    } catch (error) {
      throw translateDenoError(error, path)
    }
  }

  async chmod(path: string, mode: number): Promise<void> {
    await this.assertPath(path, 'write')
    try {
      await Deno.chmod(path, mode)
    } catch (error) {
      throw translateDenoError(error, path)
    }
  }

  async symlink(target: string, path: string): Promise<void> {
    await this.assertPath(target, 'read')
    await this.assertPath(path, 'write', false)
    try {
      await Deno.symlink(target, path)
    } catch (error) {
      throw translateDenoError(error, path)
    }
  }

  async copyFile(from: string, to: string): Promise<void> {
    await this.assertPath(from, 'read')
    await this.assertPath(to, 'write', false)
    try {
      await Deno.copyFile(from, to)
    } catch (error) {
      throw translateDenoError(error, `${from} -> ${to}`)
    }
  }

  async open(
    path: string,
    options: { read?: boolean; write?: boolean; createNew?: boolean; mode?: number },
  ): Promise<HostFile> {
    await this.assertPath(path, options.write ? 'write' : 'read', !options.createNew)
    try {
      return new DenoHostFile(await Deno.open(path, options))
    } catch (error) {
      throw translateDenoError(error, path)
    }
  }

  createHash(_algorithm: 'sha256') {
    const hash = denoCreateHash('sha256')
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
    const input = await Deno.open(source, { read: true })
    const output = await Deno.open(destination, { createNew: true, write: true, mode: 0o600 })
    try {
      await pipeline(
        Readable.from(fixedChunks(input.readable)),
        createGzip({ level: 6, strategy: zlibConstants.Z_RLE }),
        Writable.fromWeb(output.writable),
      )
    } finally {
      safeClose(input)
      safeClose(output)
    }
  }

  async run(command: string, args: string[]) {
    this.assertCommand(command)
    try {
      return await new Deno.Command(command, { args, stdout: 'piped', stderr: 'piped' }).output()
    } catch (error) {
      throw translateDenoError(error, command)
    }
  }

  async runGzip(command: string, args: string[], destination: string) {
    this.assertCommand(command)
    await this.assertPath(destination, 'write', false)
    let child: Deno.ChildProcess
    try {
      child = new Deno.Command(command, { args, stdout: 'piped', stderr: 'piped' }).spawn()
    } catch (error) {
      throw translateDenoError(error, command)
    }
    const output = await Deno.open(destination, { createNew: true, write: true, mode: 0o600 })
    const stderrPromise = new Response(child.stderr).arrayBuffer()
    try {
      const [status, errorBytes] = await Promise.all([
        child.status,
        stderrPromise,
        pipeline(
          Readable.from(fixedChunks(child.stdout)),
          createGzip({ level: 6, strategy: zlibConstants.Z_RLE }),
          Writable.fromWeb(output.writable),
        ),
      ])
      return {
        success: status.success,
        code: status.code,
        stdout: new Uint8Array(),
        stderr: new Uint8Array(errorBytes),
      }
    } finally {
      safeClose(output)
    }
  }

  async stdout(value: string | Uint8Array): Promise<void> {
    await writeAll(Deno.stdout, bytes(value))
  }

  async stderr(value: string | Uint8Array): Promise<void> {
    await writeAll(Deno.stderr, bytes(value))
  }

  async readStdin(): Promise<string> {
    return await new Response(Deno.stdin.readable).text()
  }

  async readLine(prompt: string): Promise<string | null> {
    await this.stderr(prompt)
    const buffer = new Uint8Array(4096)
    const count = await Deno.stdin.read(buffer)
    return count === null ? null : new TextDecoder().decode(buffer.subarray(0, count)).trim()
  }

  async readSecret(prompt: string): Promise<string> {
    if (!this.inputIsTerminal()) {
      throw new HostError('PermissionDenied', 'secret input requires a terminal')
    }
    await this.stderr(prompt)
    const output: number[] = []
    Deno.stdin.setRaw(true)
    try {
      const buffer = new Uint8Array(1)
      while (true) {
        const count = await Deno.stdin.read(buffer)
        if (count === null || buffer[0] === 10 || buffer[0] === 13) break
        if (buffer[0] === 3) throw new HostError('PermissionDenied', 'secret input canceled')
        if (buffer[0] === 8 || buffer[0] === 127) output.pop()
        else output.push(buffer[0])
      }
    } finally {
      Deno.stdin.setRaw(false)
      await this.stderr('\n')
    }
    return new TextDecoder().decode(Uint8Array.from(output))
  }

  inputIsTerminal(): boolean {
    return Deno.stdin.isTerminal()
  }

  createLineReader(options: {
    history: string[]
    historySize: number
    completer(line: string): [string[], string]
    onSigint(): void
  }): HostLineReader {
    const reader = createInterface({
      input: stdin,
      output: stderr,
      terminal: true,
      history: options.history,
      historySize: options.historySize,
      completer: options.completer,
    })
    reader.on('SIGINT', options.onSigint)
    return {
      [Symbol.asyncIterator]: () => reader[Symbol.asyncIterator](),
      write: (value) => stderr.write(value),
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
    const absolute = denoPath.resolve(candidate)
    if (!insideAny(absolute, roots)) {
      throw new HostError(
        'PermissionDenied',
        `${operation} access is outside ${this.policy.name}: ${absolute}`,
        absolute,
      )
    }
    if (!resolveLinks) return
    try {
      const physical = await Deno.realPath(absolute)
      if (!insideAny(physical, roots)) {
        throw new HostError(
          'PermissionDenied',
          `${operation} access escapes ${this.policy.name}: ${absolute}`,
          absolute,
        )
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error
    }
  }
}

async function* fixedChunks(
  source: ReadableStream<Uint8Array>,
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

class DenoHostFile implements HostFile {
  readonly file: Deno.FsFile

  constructor(file: Deno.FsFile) {
    this.file = file
  }

  read(buffer: Uint8Array): Promise<number | null> {
    return this.file.read(buffer)
  }

  write(buffer: Uint8Array): Promise<number> {
    return this.file.write(buffer)
  }

  seek(offset: number): Promise<number> {
    return this.file.seek(offset, Deno.SeekMode.Start)
  }

  async stat(): Promise<HostFileInfo> {
    return fileInfo(await this.file.stat())
  }

  sync(): Promise<void> {
    return this.file.sync()
  }

  close(): Promise<void> {
    this.file.close()
    return Promise.resolve()
  }
}

function fileInfo(value: Deno.FileInfo): HostFileInfo {
  return {
    isFile: value.isFile,
    isDirectory: value.isDirectory,
    isSymlink: value.isSymlink,
    size: value.size,
    mode: value.mode,
    mtime: value.mtime,
    dev: value.dev,
    ino: value.ino,
  }
}

function insideAny(candidate: string, roots: readonly string[]): boolean {
  return roots.some((root) => {
    const relative = denoPath.relative(denoPath.resolve(root), candidate)
    return relative === '' || relative !== '..' && !relative.startsWith(`..${denoPath.sep}`) &&
        !denoPath.isAbsolute(relative)
  })
}

function translateDenoError(error: unknown, path?: string): HostError {
  if (error instanceof HostError) return error
  const kind = error instanceof Deno.errors.NotFound
    ? 'NotFound'
    : error instanceof Deno.errors.PermissionDenied
    ? 'PermissionDenied'
    : error instanceof Deno.errors.AlreadyExists
    ? 'AlreadyExists'
    : error instanceof Deno.errors.InvalidData
    ? 'InvalidInput'
    : 'Unknown'
  return new HostError(kind, error instanceof Error ? error.message : String(error), path, error)
}

function bytes(value: string | Uint8Array): Uint8Array {
  return typeof value === 'string' ? new TextEncoder().encode(value) : value
}

async function writeAll(
  writer: { write(value: Uint8Array): Promise<number> },
  value: Uint8Array,
): Promise<void> {
  let offset = 0
  while (offset < value.length) offset += await writer.write(value.subarray(offset))
}

function safeClose(file: Deno.FsFile): void {
  try {
    file.close()
  } catch {
    // A completed stream pipe already closed the resource.
  }
}

function normalizePlatform(value: string): string {
  return value === 'darwin' ? 'macos' : value
}

function normalizeArch(value: string): string {
  return value === 'x86_64' || value === 'aarch64' ? value : value
}
