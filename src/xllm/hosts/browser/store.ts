// A run store in the page's IndexedDB (database `xllm-runs`): run.json and
// numbered snapshots as Rust lays them out, so a run survives a reload of the
// page and resumes. The run lock is a Web Lock (`navigator.locks`) held while
// an executor runs; without Web Locks the page is assumed to be the only tab.
// Data read back is not trusted: `XllmRun.resume` checks it against the
// page's runtime before anything runs.

import type { LLMContextSnapshot, RunRecord } from '../../core/types'
import { RUN_RECORD_VERSION, generateRunId } from '../../core/store'
import type { ExportedRun, RunLock, RunStore } from '../../core/store'
import { XllmError } from '../../core/errors'

export const XLLM_RUNS_DB = 'xllm-runs'
const RECORDS = 'records'
const SNAPSHOTS = 'snapshots'

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'))
  })
}

interface LockLike {
  request(name: string, options: { ifAvailable: boolean }, cb: (lock: unknown) => Promise<void>): Promise<void>
  query(): Promise<{ held?: { name?: string }[] }>
}

export class IndexedDbRunStore implements RunStore {
  readonly persistent = true
  private db: Promise<IDBDatabase> | undefined
  private readonly localLocks = new Set<string>()

  constructor(private readonly options: { dbName?: string; idb?: IDBFactory; locks?: LockLike | null } = {}) {}

  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      const factory = this.options.idb ?? globalThis.indexedDB
      if (!factory) return Promise.reject(XllmError.storage('IndexedDB is not available here'))
      const r = factory.open(this.options.dbName ?? XLLM_RUNS_DB, 1)
      r.onupgradeneeded = () => {
        const db = r.result
        if (!db.objectStoreNames.contains(RECORDS)) db.createObjectStore(RECORDS, { keyPath: 'run_id' })
        if (!db.objectStoreNames.contains(SNAPSHOTS)) db.createObjectStore(SNAPSHOTS)
      }
      this.db = req(r)
    }
    return this.db
  }

  private locks(): LockLike | undefined {
    if (this.options.locks === null) return undefined
    return this.options.locks ?? (globalThis.navigator as unknown as { locks?: LockLike } | undefined)?.locks
  }

  runsDir(): string | undefined {
    return undefined
  }

  runDir(): string | undefined {
    return undefined
  }

  async createRun(): Promise<string> {
    const db = await this.open()
    for (let i = 0; i < 8; i++) {
      const id = generateRunId()
      const existing = await req(db.transaction(RECORDS).objectStore(RECORDS).get(id))
      if (!existing) return id
    }
    throw XllmError.storage('cannot allocate a unique run id')
  }

  async writeRecord(record: RunRecord): Promise<void> {
    const db = await this.open()
    const tx = db.transaction(RECORDS, 'readwrite')
    tx.objectStore(RECORDS).put(JSON.parse(JSON.stringify(record)))
    await done(tx)
  }

  async readRecord(runId: string): Promise<RunRecord> {
    const db = await this.open()
    const rec = await req(db.transaction(RECORDS).objectStore(RECORDS).get(runId)) as RunRecord | undefined
    if (!rec) throw new XllmError({ kind: 'run_not_found', run_id: runId, runs_dir: `indexeddb:${this.options.dbName ?? XLLM_RUNS_DB}` })
    if (rec.version !== RUN_RECORD_VERSION) throw XllmError.notResumable(runId, 'unsupported run record version')
    return rec
  }

  async listRecords(): Promise<RunRecord[]> {
    const db = await this.open()
    return await req(db.transaction(RECORDS).objectStore(RECORDS).getAll()) as RunRecord[]
  }

  async putSnapshot(runId: string, snapshot: LLMContextSnapshot): Promise<number> {
    const db = await this.open()
    const tx = db.transaction(SNAPSHOTS, 'readwrite')
    const store = tx.objectStore(SNAPSHOTS)
    const keys = await req(store.getAllKeys(IDBKeyRange.bound([runId, 0], [runId, Number.MAX_SAFE_INTEGER]))) as [string, number][]
    const next = keys.length ? Math.max(...keys.map(k => k[1])) + 1 : 1
    store.put(JSON.parse(JSON.stringify(snapshot)), [runId, next])
    await done(tx)
    return next
  }

  async getSnapshot(runId: string, idx: number): Promise<LLMContextSnapshot> {
    const db = await this.open()
    const s = await req(db.transaction(SNAPSHOTS).objectStore(SNAPSHOTS).get([runId, idx])) as LLMContextSnapshot | undefined
    if (!s) throw new XllmError({ kind: 'corrupted_run', run_id: runId, reason: `snapshot ${idx} missing` })
    return s
  }

  async listSnapshots(runId: string): Promise<number[]> {
    const db = await this.open()
    const keys = await req(db.transaction(SNAPSHOTS).objectStore(SNAPSHOTS)
      .getAllKeys(IDBKeyRange.bound([runId, 0], [runId, Number.MAX_SAFE_INTEGER]))) as [string, number][]
    return keys.map(k => k[1]).sort((a, b) => a - b)
  }

  async lockRun(runId: string): Promise<RunLock | null> {
    const name = `xllm-run:${runId}`
    const locks = this.locks()
    if (!locks) {
      if (this.localLocks.has(name)) return null
      this.localLocks.add(name)
      return { release: () => { this.localLocks.delete(name) } }
    }
    return new Promise<RunLock | null>((resolve, reject) => {
      locks.request(name, { ifAvailable: true }, lock => {
        if (!lock) {
          resolve(null)
          return Promise.resolve()
        }
        return new Promise<void>(release => resolve({ release: () => release() }))
      }).catch(reject)
    })
  }

  async isRunLive(runId: string): Promise<boolean> {
    const name = `xllm-run:${runId}`
    const locks = this.locks()
    if (!locks) return this.localLocks.has(name)
    const state = await locks.query()
    return (state.held ?? []).some(l => l.name === name)
  }

  async removeRun(runId: string): Promise<void> {
    const db = await this.open()
    const tx = db.transaction([RECORDS, SNAPSHOTS], 'readwrite')
    tx.objectStore(RECORDS).delete(runId)
    tx.objectStore(SNAPSHOTS).delete(IDBKeyRange.bound([runId, 0], [runId, Number.MAX_SAFE_INTEGER]))
    await done(tx)
  }

  async importRun(run: ExportedRun): Promise<void> {
    const db = await this.open()
    const tx = db.transaction([RECORDS, SNAPSHOTS], 'readwrite')
    tx.objectStore(RECORDS).put(JSON.parse(JSON.stringify(run.record)))
    for (const [idx, s] of run.snapshots) tx.objectStore(SNAPSHOTS).put(JSON.parse(JSON.stringify(s)), [run.record.run_id, idx])
    await done(tx)
  }
}
