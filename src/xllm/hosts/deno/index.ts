// `buckyos/xllm/deno`: the Deno host of the xllm TypeScript runtime — the
// `native` runtime (files, processes), `FileRunStore` with flock, and taking
// over run directories a Rust `agent_tool xllm` on this machine left half
// done (and the other way round). Not part of the browser entries.

import type { JsonValue, LlmClient, RunObserver, Tokenizer } from '../../core/types'
import { XllmError } from '../../core/errors'
import { mergeConfigLayers, parseLlmContextJson } from '../../core/config'
import { MemoryRunStore } from '../../core/store'
import type { RunStore } from '../../core/store'
import { XllmRun, XllmTask, isTerminal } from '../../core/run'
import type { PreparedTask, ResumeLimits, ResumeStart, XllmDeps } from '../../core/run'
import type { TaskInput, TaskOverrides } from '../../core/prepare'
import type { AgentRuntime } from '../../runtime/types'
import { deno } from './deno_api'
import { createNativeRuntime } from './native_runtime'
import { FileRunStore, runsDirOf, workdirExists, workdirLocker } from './store'
import { createLlmClient } from './provider'

export { FileLock, FileRunStore, DEFAULT_LOCK_DIR, DEFAULT_RUNS_DIR, isLocked, resolveHostPath, runsDirOf, workdirExists, workdirLocker } from './store'
export {
  HOST_ID_ENV, blake3Hex, deriveRuntimeId, nativeHostId, nativeHostIdFrom, nativeTarget, runtimeIdOf, targetText, workdirLockPath,
} from './identity'
export type { HostIdInputs } from './identity'
export {
  LOCAL_PROBE, NATIVE_KIND, NativeToolManager, createNativeRuntime, interruptedShellText, localProbe, nativeDescriptor, parseProbe, readExecDir,
} from './native_runtime'
export type { ExecDirFacts, NativeRuntime, NativeRuntimeOptions, Probe } from './native_runtime'
export {
  BASH_GROUP_TOOLS, EDIT_FILE_SPEC, EXEC_MAX_OUTPUT_BYTES, NATIVE_WRAPPER, READ_FILE_SPEC, WRITE_FILE_SPEC, execDirFor, fmtElapsed,
  sanitizeCallId, shellSpec,
} from './native_tools'
export { SESSION_TOKEN_ENV, createLlmClient, credentialsRefusedClient, resolveSecret } from './provider'

export interface NativeHostOptions {
  /** The model client; default: built from the run's provider configuration (`createLlmClient`). */
  llm?: LlmClient
  observer?: RunObserver
  tokenizer?: Tokenizer
  /** Directory of the working-directory locks (default `~/.xllm/locks`). */
  lockDir?: string
}

/** `XllmDeps` of a native run on this host: flock working-directory locks, this process's pid. */
export function nativeDeps(runtime: AgentRuntime, store: RunStore, llm: LlmClient, options: NativeHostOptions = {}): XllmDeps {
  const deps: XllmDeps = {
    llm, runtime, store, pid: deno().pid, lockWorkdir: workdirLocker(options.lockDir), workdirExists,
  }
  if (options.observer) deps.observer = options.observer
  if (options.tokenizer) deps.tokenizer = options.tokenizer
  return deps
}

export interface NativeTaskOptions extends NativeHostOptions {
  /** The control-side working directory: where `runtime.workdir` defaults to (default: the current directory). */
  workdir?: string
  /** Default: the configuration's `runs_dir` (`none` → memory), else `~/.xllm/runs`. */
  store?: RunStore
}

const pendingLlm: LlmClient = {
  infer() {
    throw XllmError.other('the model client is created after the task is prepared')
  },
}

/**
 * Prepare a new native task (`XllmTask.prepare` with this host's runtime,
 * store and model client): one JSON configuration (`origin` names it and
 * anchors relative paths), the input and explicit overrides.
 */
export async function prepareNativeTask(llmContext: JsonValue | undefined, origin: string, input: TaskInput, overrides: TaskOverrides,
  options: NativeTaskOptions = {}): Promise<{ task: PreparedTask; deps: XllmDeps }> {
  const merged = mergeConfigLayers([{ path: origin, file: parseLlmContextJson(origin, llmContext ?? null) }])
  const runtime = await createNativeRuntime({ config: merged.runtime, workdir: options.workdir })
  let store = options.store
  if (!store) {
    const dir = runsDirOf(merged.runs_dir, origin)
    store = dir === undefined ? new MemoryRunStore() : new FileRunStore(dir)
  }
  const draft = nativeDeps(runtime, store, options.llm ?? pendingLlm, options)
  const task = await XllmTask.prepare(llmContext, origin, input, overrides, draft)
  return { task, deps: { ...draft, llm: options.llm ?? await createLlmClient(task.config.provider) } }
}

/** A runtime that could not be opened: every use reports why (the resume gate reaches it after its own checks). */
function unavailableRuntime(error: unknown): AgentRuntime {
  const err = error instanceof XllmError ? error : XllmError.capability(error instanceof Error ? error.message : String(error))
  const fail = (): never => {
    throw err
  }
  const rejected = () => Promise.reject(err)
  return { descriptor: fail, config: fail, info: rejected, open: rejected, describeInterrupted: rejected }
}

/**
 * Take a run back on this host (`XllmRun.resume` with the native runtime
 * rebuilt from the saved `config.runtime`, the saved tool sources and specs,
 * and a model client from the saved provider). Works the same for runs a
 * Rust executor started: whether it can be taken over is decided by the
 * resume gate — record and snapshot versions, protocol, lock, descriptor
 * equality, rebuildable tools — not by who wrote it.
 */
export async function resumeNativeRun(store: RunStore, runId: string, limits: ResumeLimits = {},
  options: NativeHostOptions = {}): Promise<ResumeStart> {
  const record = await store.readRecord(runId)
  let runtime: AgentRuntime
  let llm = options.llm
  if (isTerminal(record.status)) {
    runtime = unavailableRuntime(XllmError.other('a terminal run is not executed'))
  } else {
    try {
      runtime = await createNativeRuntime({
        config: record.config.runtime, workdir: record.workdir, takeover: { run_id: record.run_id, tools: record.config.tools },
      })
    } catch (e) {
      runtime = unavailableRuntime(e)
    }
    llm = llm ?? await createLlmClient(record.config.provider)
  }
  return XllmRun.resume(store, runId, limits, nativeDeps(runtime, store, llm ?? pendingLlm, options))
}
