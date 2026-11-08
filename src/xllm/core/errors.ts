import type { CheckpointStage, ErrorSource, LLMComputeError, ProviderFailure, RunStatus } from './types'

// ------------------------------------------------------------ LLMComputeError

/** A rejected `LlmClient.infer` (or any waist dependency) carries its `LLMComputeError`. */
export class LLMComputeException extends Error {
  readonly error: LLMComputeError

  constructor(error: LLMComputeError) {
    super(computeErrorMessage(error))
    this.name = 'LLMComputeException'
    this.error = error
  }
}

export function providerError(failure: ProviderFailure, message: string): LLMComputeException {
  return new LLMComputeException({ kind: 'provider', failure, message })
}

/** What a dependency rejected with, as an `LLMComputeError`. A foreign error is a provider failure of unknown class. */
export function asComputeError(error: unknown): LLMComputeError {
  if (error instanceof LLMComputeException) return error.error
  const message = error instanceof Error ? error.message : String(error)
  return { kind: 'provider', failure: 'unknown', message }
}

function failureDebug(failure: ProviderFailure): string {
  if (typeof failure === 'object') return `Refused { code: ${JSON.stringify(failure.refused.code)} }`
  return { transient: 'Transient', permanent: 'Permanent', unknown: 'Unknown', context_limit: 'ContextLimit' }[failure]
}

function stageDebug(stage: CheckpointStage): string {
  return { before_inference: 'BeforeInference', before_tool_call: 'BeforeToolCall', outcome_boundary: 'OutcomeBoundary' }[stage]
}

/** Same text as Rust's `Display for LLMComputeError` (run.json `last_error.message`). */
export function computeErrorMessage(e: LLMComputeError): string {
  switch (e.kind) {
    case 'timeout': return 'llm timeout'
    case 'cancelled': return 'llm cancelled'
    case 'provider': return `llm provider failed (${failureDebug(e.failure)}): ${e.message}`
    case 'output_parse': return `llm output parse failed: ${e.message}`
    case 'policy_rejected': return `policy rejected: ${e.message}`
    case 'tool_failed': return `tool \`${e.tool}\` failed: ${e.message}`
    case 'tool_runtime': return `tool \`${e.tool}\` dispatch failed (effect_unknown=${e.effect_unknown}): ${e.message}`
    case 'checkpoint': return `checkpoint ${stageDebug(e.stage)} failed: ${e.message}`
    case 'snapshot_corrupted': return `snapshot corrupted: ${e.message}`
    case 'internal': return `internal: ${e.message}`
  }
}

export function errorSource(e: LLMComputeError): ErrorSource {
  switch (e.kind) {
    case 'timeout': case 'cancelled': case 'provider': return 'provider'
    case 'output_parse': return 'llm_output'
    case 'policy_rejected': case 'tool_failed': return 'tool'
    case 'tool_runtime': case 'checkpoint': return 'runtime'
    case 'snapshot_corrupted': return 'snapshot'
    case 'internal': return 'internal'
  }
}

/** Feeding the error back to the model is a meaningful recovery; everything else ends the run. */
export function llmCorrectable(e: LLMComputeError): boolean {
  return e.kind === 'output_parse' || e.kind === 'policy_rejected' || e.kind === 'tool_failed'
}

export function infraRetrySafe(e: LLMComputeError): boolean {
  switch (e.kind) {
    case 'timeout': case 'checkpoint': return true
    case 'provider': return e.failure === 'transient'
    case 'tool_runtime': return !e.effect_unknown
    default: return false
  }
}

export function refusedCode(failure: ProviderFailure): string | undefined {
  return typeof failure === 'object' ? failure.refused.code : undefined
}

// ------------------------------------------------------------------ XllmError

/** Pre-run errors of the SDK (`XllmError` in Rust): once a run exists, results come back as a `RunOutcome`. */
export type XllmErrorDetail =
  | { kind: 'config'; file: string; field: string; reason: string }
  | { kind: 'input'; message: string }
  | { kind: 'capability'; message: string }
  | { kind: 'runtime_mismatch'; message: string }
  | { kind: 'recovery_blocked'; message: string }
  | { kind: 'tools'; message: string }
  | { kind: 'template'; origin: string; reason: string }
  | { kind: 'run_not_found'; run_id: string; runs_dir: string }
  | { kind: 'run_busy'; run_id: string }
  | { kind: 'workdir_busy'; workdir: string; run_id: string }
  | { kind: 'run_terminal'; run_id: string; status: RunStatus; hint: string }
  | { kind: 'not_resumable'; run_id: string; reason: string }
  | { kind: 'corrupted_run'; run_id: string; reason: string }
  | { kind: 'storage'; message: string }
  | { kind: 'extract'; message: string }
  | { kind: 'compressor'; message: string }
  | { kind: 'other'; message: string }

export type XllmErrorKind = XllmErrorDetail['kind']

function xllmErrorMessage(d: XllmErrorDetail): string {
  switch (d.kind) {
    case 'config': return `config error: ${d.file}: ${d.field}: ${d.reason}`
    case 'input': return `input error: ${d.message}`
    case 'capability': return `capability error: ${d.message}`
    case 'runtime_mismatch': return `runtime mismatch: ${d.message}`
    case 'recovery_blocked': return `RecoveryBlocked: ${d.message}`
    case 'tools': return `tools error: ${d.message}`
    case 'template': return `template error in ${d.origin}: ${d.reason}`
    case 'run_not_found': return `run \`${d.run_id}\` not found under ${d.runs_dir}`
    case 'run_busy': return `run \`${d.run_id}\` is being executed by another process`
    case 'workdir_busy':
      return `working directory ${d.workdir} already has a tool-enabled run \`${d.run_id}\` executing; wait for it or use another directory`
    case 'run_terminal': return `run \`${d.run_id}\` is terminal (${d.status}); ${d.hint}`
    case 'not_resumable': return `run \`${d.run_id}\` cannot be resumed: ${d.reason}`
    case 'corrupted_run': return `run \`${d.run_id}\` record is corrupted: ${d.reason}`
    case 'storage': return `storage error: ${d.message}`
    case 'extract': return `result extraction failed: ${d.message}`
    case 'compressor': return `context compaction failed: ${d.message}`
    case 'other': return d.message
  }
}

export class XllmError extends Error {
  readonly detail: XllmErrorDetail

  constructor(detail: XllmErrorDetail) {
    super(xllmErrorMessage(detail))
    this.name = 'XllmError'
    this.detail = detail
  }

  get kind(): XllmErrorKind {
    return this.detail.kind
  }

  static config(file: string, field: string, reason: string): XllmError {
    return new XllmError({ kind: 'config', file, field, reason })
  }

  static input(message: string): XllmError {
    return new XllmError({ kind: 'input', message })
  }

  static capability(message: string): XllmError {
    return new XllmError({ kind: 'capability', message })
  }

  static runtimeMismatch(message: string): XllmError {
    return new XllmError({ kind: 'runtime_mismatch', message })
  }

  static tools(message: string): XllmError {
    return new XllmError({ kind: 'tools', message })
  }

  static template(origin: string, reason: string): XllmError {
    return new XllmError({ kind: 'template', origin, reason })
  }

  static notResumable(runId: string, reason: string): XllmError {
    return new XllmError({ kind: 'not_resumable', run_id: runId, reason })
  }

  static storage(message: string): XllmError {
    return new XllmError({ kind: 'storage', message })
  }

  static other(message: string): XllmError {
    return new XllmError({ kind: 'other', message })
  }
}
