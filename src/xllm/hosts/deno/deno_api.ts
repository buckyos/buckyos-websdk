// The part of the `Deno` namespace the Deno host uses, typed here so the
// host compiles with the SDK's TypeScript build (no Deno lib) and with
// `deno check`. Only `hosts/deno/` touches it; the browser entries never
// import this directory.

export interface DenoFsFile {
  write(p: Uint8Array): Promise<number>
  sync(): Promise<void>
  close(): void
  tryLock(exclusive?: boolean): Promise<boolean>
  unlock(): Promise<void>
}

export interface DenoFileInfo {
  isFile: boolean
  isDirectory: boolean
  isSymlink: boolean
  size: number
  mtime: Date | null
}

export interface DenoDirEntry {
  name: string
  isFile: boolean
  isDirectory: boolean
}

export interface DenoChildStatus {
  success: boolean
  code: number
  signal: string | null
}

export interface DenoChildProcess {
  readonly pid: number
  readonly status: Promise<DenoChildStatus>
  kill(signo?: string): void
}

export interface DenoCommandOutput extends DenoChildStatus {
  stdout: Uint8Array
  stderr: Uint8Array
}

export interface DenoCommandOptions {
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  clearEnv?: boolean
  stdin?: 'piped' | 'inherit' | 'null'
  stdout?: 'piped' | 'inherit' | 'null'
  stderr?: 'piped' | 'inherit' | 'null'
  signal?: AbortSignal
}

export interface DenoApi {
  readonly pid: number
  readonly build: { os: string }
  readonly errors: { NotFound: new (...a: never[]) => Error; AlreadyExists: new (...a: never[]) => Error }
  readonly env: { get(name: string): string | undefined; toObject(): Record<string, string> }
  open(path: string, options: { read?: boolean; write?: boolean; create?: boolean; truncate?: boolean; createNew?: boolean }): Promise<DenoFsFile>
  readFile(path: string): Promise<Uint8Array>
  readTextFile(path: string): Promise<string>
  writeFile(path: string, data: Uint8Array): Promise<void>
  writeTextFile(path: string, data: string): Promise<void>
  mkdir(path: string, options?: { recursive?: boolean; mode?: number }): Promise<void>
  rename(from: string, to: string): Promise<void>
  remove(path: string, options?: { recursive?: boolean }): Promise<void>
  stat(path: string): Promise<DenoFileInfo>
  lstat(path: string): Promise<DenoFileInfo>
  realPath(path: string): Promise<string>
  readDir(path: string): AsyncIterable<DenoDirEntry>
  cwd(): string
  makeTempDir(options?: { prefix?: string }): Promise<string>
  Command: new (cmd: string, options?: DenoCommandOptions) => { spawn(): DenoChildProcess; output(): Promise<DenoCommandOutput> }
}

export function deno(): DenoApi {
  const d = (globalThis as unknown as { Deno?: DenoApi }).Deno
  if (!d) throw new Error('the xllm Deno host needs the Deno runtime')
  return d
}

export function isNotFound(e: unknown): boolean {
  return e instanceof deno().errors.NotFound
}

export function isAlreadyExists(e: unknown): boolean {
  return e instanceof deno().errors.AlreadyExists
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** `$HOME` (`USERPROFILE` on Windows). */
export function homeDir(): string | undefined {
  const env = deno().env
  return env.get('HOME') ?? env.get('USERPROFILE')
}

export function joinPath(...parts: string[]): string {
  let out = ''
  for (const p of parts) {
    if (!p) continue
    if (p.startsWith('/') || !out) out = p
    else out = out.endsWith('/') ? out + p : `${out}/${p}`
  }
  return out
}

export function parentDir(p: string): string {
  const t = p.replace(/\/+$/, '')
  const i = t.lastIndexOf('/')
  return i < 0 ? '.' : i === 0 ? '/' : t.slice(0, i)
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await deno().lstat(p)
    return true
  } catch (e) {
    if (isNotFound(e)) return false
    throw e
  }
}

export async function isDir(p: string): Promise<boolean> {
  try {
    return (await deno().stat(p)).isDirectory
  } catch {
    return false
  }
}

/** Write a file and fsync it (`write_file_synced`). */
export async function writeFileSynced(path: string, bytes: Uint8Array): Promise<void> {
  const f = await deno().open(path, { write: true, create: true, truncate: true })
  try {
    let off = 0
    while (off < bytes.length) off += await f.write(bytes.subarray(off))
    await f.sync()
  } finally {
    f.close()
  }
}

/** fsync a directory so a rename in it is durable (`sync_dir`). */
export async function syncDir(dir: string): Promise<void> {
  if (deno().build.os === 'windows') return
  const f = await deno().open(dir, { read: true })
  try {
    await f.sync()
  } finally {
    f.close()
  }
}
