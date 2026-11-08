// `FileRunStore` (Rust `RunStore::Disk`): the same directory layout and the
// same write discipline, so a run directory is shared by Rust and Deno
// executors on one machine.
//
//   <runs_dir>/<run_id>/run.json             pretty JSON, tmp + fsync + rename + fsync dir
//   <runs_dir>/<run_id>/snapshots/NNNN.json  compact JSON, same discipline
//   <runs_dir>/<run_id>/.lock                exclusive flock while a process executes the run
//   <lock_dir>/<blake3(workdir)[..24]>.lock  tool-enabled runs of one working directory
//
// Locks are `Deno.FsFile.tryLock(true)`: flock(2) on Unix, the same advisory
// lock as Rust's fs2 (`try_lock_exclusive`), so a Rust process holding a run
// makes it busy here and the other way round.

import type { LLMContextSnapshot, RunRecord, RunsDirSetting } from '../../core/types'
import { XllmError } from '../../core/errors'
import { RUN_RECORD_VERSION, generateRunId } from '../../core/store'
import type { ExportedRun, RunLock, RunStore } from '../../core/store'
import { resolveConfigPath } from '../../core/config'
import { deno, errorText, homeDir, isAlreadyExists, isDir, isNotFound, joinPath, parentDir, syncDir, writeFileSynced } from './deno_api'
import type { DenoFsFile } from './deno_api'
import { workdirLockPath } from './identity'

/** `DEFAULT_RUNS_DIR` / `DEFAULT_LOCK_DIR`. */
export const DEFAULT_RUNS_DIR = '~/.xllm/runs'
export const DEFAULT_LOCK_DIR = '~/.xllm/locks'

/** `resolve_config_path`: `~` is the home directory, an absolute path stays, a relative one is under `baseDir`. */
export function resolveHostPath(raw: string, baseDir: string): string {
  return resolveConfigPath(raw, baseDir, homeDir())
}

/**
 * Where the runs of a configuration go: `runs_dir` of the `.llm_context`
 * (`none` → `undefined`, a memory store), else `~/.xllm/runs`. `origin` is
 * the configuration's path (relative `runs_dir` is relative to its
 * directory).
 */
export function runsDirOf(setting: RunsDirSetting | undefined, origin: string): string | undefined {
  if (setting?.kind === 'disabled') return undefined
  const raw = setting?.kind === 'path' ? setting.path : DEFAULT_RUNS_DIR
  return resolveHostPath(raw, parentDir(origin.startsWith('/') ? origin : joinPath(deno().cwd(), origin)))
}

/** A held flock; `release` (or process exit) frees it. */
export class FileLock implements RunLock {
  private released = false

  private constructor(private readonly file: DenoFsFile, readonly path: string) {}

  /** Non-blocking (`FileLock::try_acquire`): `null` when another open file holds it. */
  static async tryAcquire(path: string): Promise<FileLock | null> {
    try {
      await deno().mkdir(parentDir(path), { recursive: true })
    } catch (e) {
      throw XllmError.storage(`cannot create lock directory ${parentDir(path)}: ${errorText(e)}`)
    }
    let file: DenoFsFile
    try {
      file = await deno().open(path, { read: true, write: true, create: true })
    } catch (e) {
      throw XllmError.storage(`cannot open lock ${path}: ${errorText(e)}`)
    }
    if (!(await file.tryLock(true))) {
      file.close()
      return null
    }
    try {
      await deno().writeTextFile(path, `${deno().pid}\n`)
    } catch {
      // the lock is held; the owner note is informational
    }
    return new FileLock(file, path)
  }

  async release(): Promise<void> {
    if (this.released) return
    this.released = true
    try {
      await this.file.unlock()
    } finally {
      this.file.close()
    }
  }
}

/** Some open file holds the flock at `path` (`is_run_live`). */
export async function isLocked(path: string): Promise<boolean> {
  let file: DenoFsFile
  try {
    file = await deno().open(path, { read: true, write: true, create: true })
  } catch {
    return false
  }
  try {
    if (await file.tryLock(true)) {
      await file.unlock()
      return false
    }
    return true
  } finally {
    file.close()
  }
}

let tmpCounter = 0

function pad4(n: number): string {
  return String(n).padStart(4, '0')
}

export class FileRunStore implements RunStore {
  readonly persistent = true
  private readonly dir: string

  /** `runsDir`: absolute, or relative to the current directory; `~` is the home directory. */
  constructor(runsDir: string) {
    this.dir = resolveHostPath(runsDir, deno().cwd())
  }

  runsDir(): string {
    return this.dir
  }

  runDir(runId: string): string {
    return joinPath(this.dir, runId)
  }

  /** The runs directory can be created and written (`ensure_writable`). */
  async ensureWritable(): Promise<void> {
    try {
      await deno().mkdir(this.dir, { recursive: true })
    } catch (e) {
      throw XllmError.storage(`runs directory ${this.dir} cannot be created: ${errorText(e)}`)
    }
    const probe = joinPath(this.dir, `.probe-${deno().pid}`)
    try {
      await deno().writeFile(probe, new Uint8Array())
    } catch (e) {
      throw XllmError.storage(`runs directory ${this.dir} is not writable: ${errorText(e)}`)
    }
    await deno().remove(probe).catch(() => undefined)
  }

  async createRun(): Promise<string> {
    await this.ensureWritable()
    for (let i = 0; i < 8; i++) {
      const runId = generateRunId()
      const dir = this.runDir(runId)
      try {
        await deno().mkdir(dir)
      } catch (e) {
        if (isAlreadyExists(e)) continue
        throw XllmError.storage(`cannot create run directory ${dir}: ${errorText(e)}`)
      }
      await deno().mkdir(joinPath(dir, 'snapshots'), { recursive: true })
      return runId
    }
    throw XllmError.storage('cannot allocate a unique run id')
  }

  async writeRecord(record: RunRecord): Promise<void> {
    const dir = this.runDir(record.run_id)
    const path = joinPath(dir, 'run.json')
    const tmp = joinPath(dir, `run.json.tmp-${deno().pid}-${tmpCounter++}`)
    try {
      await deno().mkdir(dir, { recursive: true })
      await writeFileSynced(tmp, new TextEncoder().encode(JSON.stringify(record, null, 2)))
    } catch (e) {
      throw XllmError.storage(`write ${tmp}: ${errorText(e)}`)
    }
    try {
      await deno().rename(tmp, path)
    } catch (e) {
      throw XllmError.storage(`commit ${path}: ${errorText(e)}`)
    }
    try {
      await syncDir(dir)
    } catch (e) {
      throw XllmError.storage(`sync ${dir}: ${errorText(e)}`)
    }
  }

  /** Rejects with `run_not_found`, `not_resumable` (another record version, like Rust) or `corrupted_run`. */
  async readRecord(runId: string): Promise<RunRecord> {
    const path = joinPath(this.runDir(runId), 'run.json')
    let text: string
    try {
      text = await deno().readTextFile(path)
    } catch (e) {
      if (isNotFound(e)) throw new XllmError({ kind: 'run_not_found', run_id: runId, runs_dir: this.dir })
      throw XllmError.storage(`read ${path}: ${errorText(e)}`)
    }
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch (e) {
      throw new XllmError({ kind: 'corrupted_run', run_id: runId, reason: errorText(e) })
    }
    const v = value as { version?: unknown; run_id?: unknown; status?: unknown; config?: unknown; prompt?: unknown }
    if (v?.version !== RUN_RECORD_VERSION) throw XllmError.notResumable(runId, 'unsupported run record version')
    if (typeof v.run_id !== 'string' || typeof v.status !== 'string' || typeof v.config !== 'object' || typeof v.prompt !== 'object') {
      throw new XllmError({ kind: 'corrupted_run', run_id: runId, reason: 'run.json unreadable: missing run_id / status / config / prompt' })
    }
    return value as RunRecord
  }

  async listRecords(): Promise<RunRecord[]> {
    const out: RunRecord[] = []
    let entries: AsyncIterable<{ name: string; isDirectory: boolean }>
    try {
      entries = deno().readDir(this.dir)
      for await (const entry of entries) {
        if (!entry.isDirectory) continue
        try {
          const rec = JSON.parse(await deno().readTextFile(joinPath(this.dir, entry.name, 'run.json')))
          if (rec && typeof rec.run_id === 'string') out.push(rec as RunRecord)
        } catch {
          // not a run, or an unreadable one: skipped like Rust
        }
      }
    } catch (e) {
      if (isNotFound(e)) return out
      throw XllmError.storage(`read runs directory ${this.dir}: ${errorText(e)}`)
    }
    return out
  }

  async putSnapshot(runId: string, snapshot: LLMContextSnapshot): Promise<number> {
    const dir = joinPath(this.runDir(runId), 'snapshots')
    try {
      await deno().mkdir(dir, { recursive: true })
      const idxs = await this.listSnapshots(runId)
      const next = idxs.length ? idxs[idxs.length - 1] + 1 : 1
      const path = joinPath(dir, `${pad4(next)}.json`)
      const tmp = joinPath(dir, `${pad4(next)}.json.tmp`)
      await writeFileSynced(tmp, new TextEncoder().encode(JSON.stringify(snapshot)))
      await deno().rename(tmp, path)
      await syncDir(dir)
      return next
    } catch (e) {
      if (e instanceof XllmError) throw e
      throw XllmError.storage(`write snapshot of ${runId}: ${errorText(e)}`)
    }
  }

  async getSnapshot(runId: string, idx: number): Promise<LLMContextSnapshot> {
    const path = joinPath(this.runDir(runId), 'snapshots', `${pad4(idx)}.json`)
    let text: string
    try {
      text = await deno().readTextFile(path)
    } catch (e) {
      throw new XllmError({ kind: 'corrupted_run', run_id: runId, reason: `snapshot ${idx} missing at ${path}: ${errorText(e)}` })
    }
    try {
      return JSON.parse(text) as LLMContextSnapshot
    } catch (e) {
      throw new XllmError({ kind: 'corrupted_run', run_id: runId, reason: `snapshot ${idx} unreadable: ${errorText(e)}` })
    }
  }

  async listSnapshots(runId: string): Promise<number[]> {
    const dir = joinPath(this.runDir(runId), 'snapshots')
    const idxs: number[] = []
    try {
      for await (const entry of deno().readDir(dir)) {
        const m = /^(\d+)\.json$/.exec(entry.name)
        if (m) idxs.push(Number(m[1]))
      }
    } catch (e) {
      if (isNotFound(e)) return []
      throw e
    }
    return idxs.sort((a, b) => a - b)
  }

  /** The run's execution lock (`<run>/.lock`), `null` when another process (or open file) holds it. */
  lockRun(runId: string): Promise<FileLock | null> {
    return FileLock.tryAcquire(joinPath(this.runDir(runId), '.lock'))
  }

  /** Some process holds the run's `.lock` (`is_run_live`). */
  async isRunLive(runId: string): Promise<boolean> {
    if (!(await isDir(this.runDir(runId)))) return false
    return isLocked(joinPath(this.runDir(runId), '.lock'))
  }

  /** Delete the run directory; the caller holds its lock and has nothing unreconciled in flight. */
  async removeRun(runId: string): Promise<void> {
    const dir = this.runDir(runId)
    try {
      await deno().remove(dir, { recursive: true })
    } catch (e) {
      if (!isNotFound(e)) throw XllmError.storage(`remove ${dir}: ${errorText(e)}`)
    }
    await syncDir(this.dir).catch(() => undefined)
  }

  /** Write a run exported from another store: same id, same snapshot indices. */
  async importRun(run: ExportedRun): Promise<void> {
    const id = run.record.run_id
    if (await this.isRunLive(id)) throw new XllmError({ kind: 'run_busy', run_id: id })
    const dir = this.runDir(id)
    await deno().mkdir(joinPath(dir, 'snapshots'), { recursive: true })
    for (const [idx, snapshot] of run.snapshots) {
      const path = joinPath(dir, 'snapshots', `${pad4(idx)}.json`)
      const tmp = `${path}.tmp`
      await writeFileSynced(tmp, new TextEncoder().encode(JSON.stringify(snapshot)))
      await deno().rename(tmp, path)
    }
    await syncDir(joinPath(dir, 'snapshots'))
    await this.writeRecord(run.record)
  }
}

/**
 * `XllmDeps.lockWorkdir` of a host with a filesystem: the flock
 * `<lockDir>/<blake3(workdir)[..24]>.lock`, the run id written into it.
 */
export function workdirLocker(lockDir: string = DEFAULT_LOCK_DIR) {
  const dir = resolveHostPath(lockDir, deno().cwd())
  return async (workdir: string, runId: string): Promise<RunLock | null> => {
    const lock = await FileLock.tryAcquire(workdirLockPath(dir, workdir))
    if (lock) await deno().writeTextFile(lock.path, `${runId}\n`).catch(() => undefined)
    return lock
  }
}

/** `XllmDeps.workdirExists`. */
export function workdirExists(workdir: string): Promise<boolean> {
  return isDir(workdir)
}
