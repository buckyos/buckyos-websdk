// Run persistence (Rust `RunStore`). The layout of persistent stores is the
// Rust one: `<runs_dir>/<run_id>/run.json`, `snapshots/NNNN.json` (from 1),
// `.lock`. `MemoryRunStore` keeps runs in memory; the host decides where an
// exported run goes (`exportRun` / `importRun`).

import type { LLMContextSnapshot, RunRecord } from './types'
import { XllmError } from './errors'
import { cloneJson } from './json'

export const RUN_RECORD_VERSION = 7

/** Held while a run executes; releasing it lets another executor take the run. */
export interface RunLock {
  release(): void | Promise<void>
}

/** A run with every snapshot, as moved between stores. */
export interface ExportedRun {
  record: RunRecord
  /** `[index, snapshot]`, ascending. */
  snapshots: [number, LLMContextSnapshot][]
}

export interface RunStore {
  /** Runs survive this process (a directory, IndexedDB …). */
  readonly persistent: boolean
  runsDir(): string | undefined
  runDir(runId: string): string | undefined
  createRun(): Promise<string>
  writeRecord(record: RunRecord): Promise<void>
  /** Rejects with `run_not_found` / `not_resumable` (other version) / `corrupted_run`. */
  readRecord(runId: string): Promise<RunRecord>
  listRecords(): Promise<RunRecord[]>
  /** Stores the next snapshot and returns its index (1, 2, …). */
  putSnapshot(runId: string, snapshot: LLMContextSnapshot): Promise<number>
  getSnapshot(runId: string, idx: number): Promise<LLMContextSnapshot>
  listSnapshots(runId: string): Promise<number[]>
  /** The run's execution lock, `null` when another executor holds it. */
  lockRun(runId: string): Promise<RunLock | null>
  /** Some executor holds the run's lock. */
  isRunLive(runId: string): Promise<boolean>
  removeRun(runId: string): Promise<void>
  /** Write a run exported from another store (same id, same snapshot indices). */
  importRun(run: ExportedRun): Promise<void>
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** `YYYYMMDD-HHMMSS-<6 hex>`: local time for reading, a random suffix against collisions. */
export function generateRunId(now: Date = new Date()): string {
  const ts = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`
  const bytes = new Uint8Array(3)
  globalThis.crypto.getRandomValues(bytes)
  return `${ts}-${[...bytes].map(b => b.toString(16).padStart(2, '0')).join('')}`
}

export async function exportRun(store: RunStore, runId: string): Promise<ExportedRun> {
  const record = await store.readRecord(runId)
  const snapshots: [number, LLMContextSnapshot][] = []
  for (const idx of await store.listSnapshots(runId)) snapshots.push([idx, await store.getSnapshot(runId, idx)])
  return { record, snapshots }
}

export async function importRun(store: RunStore, run: ExportedRun): Promise<void> {
  await store.importRun(run)
}

export class MemoryRunStore implements RunStore {
  readonly persistent = false
  private readonly records = new Map<string, RunRecord>()
  private readonly snapshots = new Map<string, Map<number, LLMContextSnapshot>>()
  private readonly locks = new Set<string>()

  runsDir(): string | undefined {
    return undefined
  }

  runDir(): string | undefined {
    return undefined
  }

  async createRun(): Promise<string> {
    for (let i = 0; i < 8; i++) {
      const id = generateRunId()
      if (!this.records.has(id) && !this.snapshots.has(id)) {
        this.snapshots.set(id, new Map())
        return id
      }
    }
    throw XllmError.storage('cannot allocate a unique run id')
  }

  async writeRecord(record: RunRecord): Promise<void> {
    this.records.set(record.run_id, cloneJson(record))
  }

  async readRecord(runId: string): Promise<RunRecord> {
    const rec = this.records.get(runId)
    if (!rec) throw new XllmError({ kind: 'run_not_found', run_id: runId, runs_dir: '(memory)' })
    return cloneJson(rec)
  }

  async listRecords(): Promise<RunRecord[]> {
    return [...this.records.values()].map(cloneJson)
  }

  async putSnapshot(runId: string, snapshot: LLMContextSnapshot): Promise<number> {
    let m = this.snapshots.get(runId)
    if (!m) this.snapshots.set(runId, (m = new Map()))
    const next = m.size === 0 ? 1 : Math.max(...m.keys()) + 1
    m.set(next, cloneJson(snapshot))
    return next
  }

  async getSnapshot(runId: string, idx: number): Promise<LLMContextSnapshot> {
    const s = this.snapshots.get(runId)?.get(idx)
    if (!s) throw new XllmError({ kind: 'corrupted_run', run_id: runId, reason: `snapshot ${idx} missing` })
    return cloneJson(s)
  }

  async listSnapshots(runId: string): Promise<number[]> {
    return [...(this.snapshots.get(runId)?.keys() ?? [])].sort((a, b) => a - b)
  }

  async lockRun(runId: string): Promise<RunLock | null> {
    if (this.locks.has(runId)) return null
    this.locks.add(runId)
    let released = false
    return {
      release: () => {
        if (released) return
        released = true
        this.locks.delete(runId)
      },
    }
  }

  async isRunLive(runId: string): Promise<boolean> {
    return this.locks.has(runId)
  }

  async removeRun(runId: string): Promise<void> {
    this.records.delete(runId)
    this.snapshots.delete(runId)
  }

  async importRun(run: ExportedRun): Promise<void> {
    const id = run.record.run_id
    if (this.locks.has(id)) throw new XllmError({ kind: 'run_busy', run_id: id })
    this.records.set(id, cloneJson(run.record))
    this.snapshots.set(id, new Map(run.snapshots.map(([idx, s]) => [idx, cloneJson(s)])))
  }

  /** `exportRun` on this store. */
  exportRun(runId: string): Promise<ExportedRun> {
    return exportRun(this, runId)
  }
}
