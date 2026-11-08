// Types of the xllm TypeScript runtime, copied from the Rust implementation
// (`buckyos/src/frame/llm_context`, `buckyos/src/frame/agent_tool/src/xllm.rs`,
// `agent_tool/src/runtime/mod.rs`). Names and JSON field shapes (snake_case,
// serde tags, which optional fields are omitted) match Rust one to one, so a
// run.json or snapshot written by either implementation reads the same.

import type { AiContent, AiCost, AiMessage, AiToolCall, JsonValue, ResourceRef } from '../../aicc_client'

export type { AiContent, AiCost, AiMessage, AiToolCall, JsonValue, ResourceRef }

/** `AiUsage` as Rust serializes it: every counter optional, `cost` summed per currency. */
export interface AiUsage {
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
  cache_read_input_tokens?: number
  cache_write_input_tokens?: number
  cache_write_1h_input_tokens?: number
  reasoning_tokens?: number
  image_units?: number
  audio_seconds?: number
  video_seconds?: number
  reference_images?: number
  request_units?: number
  characters?: number
  audio_input_tokens?: number
  image_input_tokens?: number
  audio_output_tokens?: number
  image_output_tokens?: number
  reported_cost?: number
  cost?: AiCost
}

export interface AiResponse {
  message: AiMessage
  usage?: AiUsage
  cost?: AiCost
  finish_reason?: string
  provider_task_ref?: string
  extra?: JsonValue
}

// ---------------------------------------------------------------- errors (L2)

/** Externally tagged like Rust: unit variants are strings, `Refused` is `{ refused: { code } }`. */
export type ProviderFailure =
  | 'transient'
  | 'permanent'
  | 'unknown'
  | 'context_limit'
  | { refused: { code: string } }

export type CheckpointStage = 'before_inference' | 'before_tool_call' | 'outcome_boundary'

export type ErrorSource = 'provider' | 'llm_output' | 'tool' | 'runtime' | 'snapshot' | 'internal'

export type LLMComputeError =
  | { kind: 'timeout' }
  | { kind: 'cancelled' }
  | { kind: 'provider'; failure: ProviderFailure; message: string }
  | { kind: 'output_parse'; message: string }
  | { kind: 'policy_rejected'; message: string }
  | { kind: 'tool_failed'; tool: string; call_id: string; message: string }
  | { kind: 'tool_runtime'; tool: string; call_id: string; message: string; effect_unknown: boolean }
  | { kind: 'checkpoint'; stage: CheckpointStage; message: string }
  | { kind: 'snapshot_corrupted'; message: string }
  | { kind: 'internal'; message: string }

// ----------------------------------------------------------- observation (L2)

export type Observation =
  | { kind: 'success'; call_id: string; content: JsonValue; bytes: number; truncated: boolean; host?: JsonValue }
  | { kind: 'error'; call_id: string; message: string; host?: JsonValue }
  | { kind: 'cancelled'; call_id: string; reason: string; effect_unknown: boolean }
  | { kind: 'unresolved'; call_id: string; reason: string; effect_unknown: boolean }

export type ToolExecStatus = 'succeeded' | 'failed' | 'unknown' | 'not_executed' | 'cancelled'

export interface ToolExecRecord {
  tool_name: string
  call_id: string
  status: ToolExecStatus
  duration_ms: number
  error?: string
}

// --------------------------------------------------------------- request (L2)

export interface ModelPolicy {
  preferred: string
  fallbacks: string[]
  temperature: number | null
  max_completion_tokens: number | null
  provider_options: JsonValue | null
}

export type ToolMode = 'none' | 'whitelist' | 'all'

export interface ToolPolicy {
  mode: ToolMode
  whitelist: string[]
  action_mode: ToolMode
  action_whitelist: string[]
  max_tool_iterations: number
  max_calls_per_round: number
  disable_capabilities: string[]
  finish_grace_ms: number
  /** Omitted when empty. */
  wrap_up_tools?: string[]
  /** Omitted when `DEFAULT_WRAP_UP_ROUNDS`. */
  wrap_up_rounds?: number
}

export type OutputSpec =
  | { kind: 'text' }
  | { kind: 'json'; schema?: JsonValue; strict: boolean; max_repairs?: number }

export type BudgetAction = 'fail' | 'return_partial' | 'escalate_human'

export type ContextThreshold = { kind: 'ratio'; value: number } | { kind: 'absolute_tokens'; value: number }

export interface BudgetSpec {
  max_total_tokens: number | null
  max_completion_tokens: number | null
  max_wallclock_ms: number | null
  max_cost_units: number | null
  on_exhausted: BudgetAction
  context_yield_threshold: ContextThreshold | null
  context_window_tokens: number | null
}

export interface ErrorPolicy {
  max_consecutive_errors: number
}

export interface LLMContextRequest {
  owner: JsonValue
  trace?: string
  objective: string
  /** Omitted when empty. */
  behavior_name?: string
  input: AiMessage[]
  model_policy: ModelPolicy
  tool_policy: ToolPolicy
  output: OutputSpec
  budget: BudgetSpec
  error_policy: ErrorPolicy
  forbid_next_behavior: boolean
}

// ------------------------------------------------------- behavior loop (L2)

export type StepCompressionLevel = 'full' | 'compact' | 'summary'

export interface StepMeta {
  behavior_name?: string
  step_index: number
  started_at_ms: number
  ended_at_ms?: number
  compression_level: StepCompressionLevel
}

export interface HistorySummaryRecord {
  step_count: number
  start_step_index: number
  end_step_index: number
  started_at_ms: number
  ended_at_ms: number
  behavior_names?: string[]
  summary: string
}

export interface StepRecord {
  meta: StepMeta
  assistant_text: string
  assistant_message?: AiMessage
  native_messages?: AiMessage[]
  observation?: string
  thought?: string
  actions?: AiToolCall[]
  next_behavior?: string
  self_report?: string
  report_end: boolean
  report_result?: JsonValue
  action_results?: Observation[]
  next_user_message?: AiMessage
}

export interface LLMBehaviorResult {
  do_actions?: AiToolCall[]
  next_behavior?: string
  assistant_text: string
  observation?: string
  thought?: string
  self_report?: string
  report_end: boolean
  report_result?: JsonValue
}

export type StepDecision = 'handover' | 'yield'

export type DecisionVerdict = { accept: true } | { refuse: string }

// ----------------------------------------------------------------- state (L2)

export type ContextLimitKind = 'approaching_window' | 'hard_limit' | 'provider_refused'

export interface Suspension {
  which: ContextLimitKind
  estimated_tokens?: number
  at_ms: number
}

export interface ToolBatch {
  remaining?: AiToolCall[]
  batch_error?: LLMComputeError
}

export interface ActionStep {
  step: StepRecord
  response: AiResponse
}

export interface LLMContextState {
  accumulated: AiMessage[]
  usage: AiUsage
  tool_iterations_left: number
  wrap_up_rounds_used?: number
  started_at_ms: number
  cost_units: number
  consecutive_errors: number
  output_repairs?: number
  suspended?: Suspension
  tool_batch?: ToolBatch
  action_step?: ActionStep
  steps?: StepRecord[]
  history_summaries?: HistorySummaryRecord[]
  last_step?: StepRecord
  last_report?: string
  report_end: boolean
  next_step_index: number
  next_action_id: number
  snapshot_version: number
  host?: JsonValue
}

export interface LLMContextSnapshot {
  request: LLMContextRequest
  state: LLMContextState
}

// --------------------------------------------------------------- outcome (L2)

export type ContextOutput =
  | { kind: 'text'; content: string }
  | { kind: 'json'; content: JsonValue }
  | { kind: 'invalid'; content: string; error: string }

export interface ContextRunTrace {
  trace_id: string
  latency_ms: number
  tool_trace?: ToolExecRecord[]
}

export type BudgetKind = 'tokens' | 'wallclock' | 'cost_units' | 'tool_iterations'

export interface InferenceAbortTrace {
  reason: string
  requested_at_ms: number
  observed_at_ms: number
  provider_cancel_supported: boolean
  provider_task_ref?: string
}

export type LLMContextOutcome =
  | { kind: 'done'; reason?: string; output: ContextOutput; usage: AiUsage; response: AiResponse; trace: ContextRunTrace;
      behavior_result?: LLMBehaviorResult }
  | { kind: 'budget_exhausted'; which: BudgetKind; partial?: ContextOutput; usage: AiUsage }
  | { kind: 'error'; error: LLMComputeError; usage: AiUsage; trace: ContextRunTrace }
  | { kind: 'context_limit_reached'; which: ContextLimitKind; usage: AiUsage; accumulated: AiMessage[];
      snapshot: LLMContextSnapshot; deadline_ms?: number; trace: ContextRunTrace }
  | { kind: 'interrupted'; reason: string; usage: AiUsage; snapshot: LLMContextSnapshot; abort: InferenceAbortTrace }
  | { kind: 'settled'; reason: string; usage: AiUsage; snapshot: LLMContextSnapshot; trace: ContextRunTrace }

export type ResumeFill =
  | { kind: 'rewritten_history'; history: AiMessage[] }
  | { kind: 'rewritten_steps'; input: AiMessage[]; history_summaries?: HistorySummaryRecord[]; steps?: StepRecord[];
      last_step?: StepRecord }
  | { kind: 'resume_from_mid_run' }

// ------------------------------------------------------------ deps (L2)

export interface ToolSpecLite {
  name: string
  description: string
  args_schema: JsonValue
}

/** One inference sent to the provider adapter (`LlmInferenceRequest`). */
export interface LlmInferenceRequest {
  trace_id?: string
  messages: AiMessage[]
  model_alias: string
  fallbacks: string[]
  temperature?: number
  max_completion_tokens?: number
  force_json: boolean
  json_schema?: JsonValue
  provider_options?: JsonValue
  disable_capabilities: string[]
  tool_specs: ToolSpecLite[]
  allow_tool_calls: boolean
  /** Fires when the run is interrupted; adapters wire it to their transport when they can. */
  signal: AbortSignal
}

/** Provider boundary: one call, one inference. Failures reject with an `LLMComputeException`. */
export interface LlmClient {
  infer(req: LlmInferenceRequest): Promise<AiResponse>
}

/** Failure of the dispatch infrastructure itself (not a tool that reported an error). */
export interface ToolDispatchError {
  message: string
  effect_unknown: boolean
}

export type CancelCause = 'interrupted' | 'finishing' | 'deadline'

export interface Tokenizer {
  countTokens(text: string): number
}

export interface Injection {
  messages: AiMessage[]
  host?: JsonValue
}

export type InjectionPosition =
  | { kind: 'request_input'; at: number }
  | { kind: 'accumulated'; at: number }
  | { kind: 'step'; step_index: number }
  | { kind: 'none' }

export type WorkEvent =
  | { kind: 'llm_started'; trace_id?: string; model: string }
  | { kind: 'llm_finished'; trace_id?: string; ok: boolean }
  | { kind: 'llm_inference_failed'; trace_id?: string; error: string }
  | { kind: 'tool_call_planned'; trace_id?: string; tool: string; call_id: string; args: Record<string, JsonValue> }
  | { kind: 'tool_call_finished'; trace_id?: string; tool: string; call_id: string; ok: boolean; duration_ms: number }
  | { kind: 'tool_call_failed'; trace_id?: string; tool: string; call_id: string; message: string }
  | { kind: 'output_parse_failed'; trace_id?: string; error: string }
  | { kind: 'tool_dispatch_failed'; trace_id?: string; tool: string; call_id: string; message: string; effect_unknown: boolean }
  | { kind: 'checkpoint_failed'; trace_id?: string; stage: CheckpointStage; error: string }
  | { kind: 'context_rewritten'; trace_id?: string; from_messages: number; to_messages: number }
  | { kind: 'self_report_set'; trace_id?: string; chars: number }

// ----------------------------------------------------------- runtime (L3/L4)

export interface Capabilities {
  tools: Record<string, string>
  network: boolean
  os: string
}

/** Identity of an execution target; a resume requires it to be equal field by field. */
export interface RuntimeDescriptor {
  runtime_id: string
  kind: string
  host: string | null
  target: JsonValue
  workdir: string
  capabilities: Capabilities
}

export type RuntimeBaseline = 'standard' | 'extended'

/** `.llm_context` `runtime` block (`deny_unknown_fields`). */
export interface RuntimeConfig {
  kind?: string
  id?: string
  workdir?: string
  env: Record<string, string>
  remote_ssh?: { host?: string | null; user?: string; port?: number; identity_file?: string }
  remote_node?: { node_did?: string; executor_id?: string; profile_id?: string }
  baseline?: RuntimeBaseline
  task_wait_ms?: number
}

export interface RuntimeInfo {
  id: string
  kind: string
  os: string
  arch: string
  hostname: string
  shell: string
  cwd: string
  tools: string[]
  current_time: string
  timezone: string
  target: JsonValue
  platform: string
  shell_kind: string
  baseline: string
}

// --------------------------------------------------------- config (L4 xllm)

export type ProviderKind = 'buckyos' | 'openai'
export type LoopModel = 'function_call' | 'behavior'
export type RunLogLevel = 'debug' | 'info' | 'warn' | 'result'
export type PromptMode = 'standard' | 'custom'
export type FilesystemPolicy = 'workspace' | 'unrestricted'

export type ResultFormat = { kind: 'raw' } | { kind: 'path'; segments: string[] }

export type SecretRef = { kind: 'config_file'; path: string; field: string } | { kind: 'env'; name: string }

export interface ProviderConfig {
  kind?: ProviderKind
  session_token?: SecretRef
  base_url?: string
  api_key?: SecretRef
  headers?: Record<string, string>
  on_behalf_of?: JsonValue
}

export type ToolSource =
  | { kind: 'group'; groupname: string }
  | { kind: 'mcp'; endpoint: string }
  | { kind: 'named'; name: string }

export interface ShellToolConfig {
  timeout_ms?: number
  max_timeout_ms?: number
}

export interface ShellSettings {
  wait_ms: number
  timeout_ms: number
  max_timeout_ms: number
}

export interface BashToolManual {
  name: string
  description: string
  command: string
  usage?: string
}

export interface ToolsConfig {
  enabled?: boolean
  filesystem_policy?: FilesystemPolicy
  tools2actions?: boolean
  tools?: ToolSource[]
  actions?: ToolSource[]
  bash_tools?: BashToolManual[]
  shell?: ShellToolConfig
}

export interface SectionDef {
  key: string
  name?: string
  text?: string
  source: string
}

export interface GroupDef {
  default_user?: string
  sections?: Record<string, SectionDef>
  tools?: ToolsConfig
  sources: string[]
}

export interface PromptConfig {
  mode?: PromptMode
  select?: string
  groups?: Record<string, GroupDef>
  sections?: Record<string, SectionDef>
  tools?: ToolsConfig
  system?: string
}

export type RunsDirSetting = { kind: 'disabled' } | { kind: 'path'; path: string }

/** One parsed `.llm_context` (here: the JSON form a host or a page hands over). */
export interface LlmContextFile {
  runtime?: RuntimeConfig
  provider?: ProviderConfig
  model?: string
  file_model?: string
  max_tokens?: number
  max_tool_iterations?: number
  llm_timeout?: number
  context_window?: number
  context_yield_ratio?: number
  timeout?: number
  runs_dir?: RunsDirSetting
  loop_model?: LoopModel
  run_logs?: RunLogLevel
  result_format?: ResultFormat
  json?: boolean
  json_schema?: JsonValue
  tools?: ToolsConfig
  prompt?: PromptConfig
}

/** The JSON object a caller passes as configuration (same schema as `.llm_context`, strict keys). */
export type LlmContextJson = { [key: string]: JsonValue }

export interface RunLimits {
  max_tokens?: number
  max_tool_iterations: number
  timeout_secs: number
  llm_timeout_secs: number
  context_window_tokens?: number
  context_yield_ratio?: number
}

export interface ResolvedTool {
  name: string
  description: string
  args_schema: JsonValue
  source: string
}

export interface EffectiveTools {
  enabled: boolean
  filesystem_policy: FilesystemPolicy
  tools2actions: boolean
  tool_sources: ToolSource[]
  action_sources: ToolSource[]
  native: ResolvedTool[]
  actions: ResolvedTool[]
  bash_tools: BashToolManual[]
  shell: ShellSettings
  exec_enabled: boolean
  sources: Record<string, string>
}

export interface EffectiveConfig {
  runtime: RuntimeConfig
  runtime_descriptor: RuntimeDescriptor
  provider: ProviderConfig
  model: string
  file_model?: string
  loop_model: LoopModel
  limits: RunLimits
  run_logs: RunLogLevel
  result_format: ResultFormat
  json: boolean
  json_schema?: JsonValue
  disable_capabilities?: string[]
  tools: EffectiveTools
  config_files: string[]
  sources: Record<string, string>
}

export interface SectionRender {
  line: number
  name: string
  user_text?: string
  user_source?: string
  system_text?: string
}

export interface PromptPlan {
  mode: PromptMode
  group?: string
  loop_model: LoopModel
  sections: SectionRender[]
  custom_system?: string
  custom_system_source?: string
  runtime_protocol: string
  protocol_version: string
  system_prompt: string
  user_request?: string
  user_request_source: string
  template_vars: Record<string, string>
  runtime_vars: Record<string, string>
}

/** Which of xllm's own sections a hosted run appends after the host's system text. */
export interface HostPromptSections {
  capabilities: boolean
  cmd_manual: boolean
  runtime_protocol: boolean
}

export type HostProtocolFlavor = { kind: 'one_shot' } | { kind: 'session'; intro: string }

// ----------------------------------------------------------- record (L4 xllm)

export type RunStatus = 'running' | 'interrupted' | 'paused' | 'completed' | 'failed' | 'limit_reached'

export interface AttachmentRecord {
  index: number
  kind: string
  label: string
  path?: string
  mime?: string
  bytes?: number
  sha256?: string
}

export interface InputRecord {
  request?: string
  request_source: string
  attachments: AttachmentRecord[]
  stdin_role?: string
  stdin_chars?: number
  structured_messages?: number
}

export interface FileModelStageRecord {
  model: string
  analysis: string
  usage?: AiUsage
  response_model?: string
  completed_at_ms: number
}

export interface RunErrorRecord {
  phase: string
  kind: string
  message: string
  recoverable: boolean
  condition?: string
  at_ms: number
}

export type ExtractedValue = { kind: 'text'; text: string } | { kind: 'json'; value: JsonValue } | { kind: 'xml'; xml: string }

export interface RunResultRecord {
  raw: string
  extracted?: ExtractedValue
  extract_error?: string
  json_valid?: boolean
  json_error?: string
  response_model?: string
}

export interface UsageRecord {
  main?: AiUsage
  file_model?: AiUsage
  compaction?: AiUsage
  llm_requests: number
}

export interface FileStagePlan {
  model: string
  request_text: string
  images: [string, ResourceRef][]
}

export interface PendingInput {
  initial_messages: AiMessage[]
  main_user_parts: AiContent[]
  file_stage?: FileStagePlan
}

export interface HostRunInfo {
  assembled_by: string
  session_id?: string
  runtime_kind?: string
  runtime_id?: string
  env_check?: JsonValue
  extra?: JsonValue
}

export interface RunHandover {
  next_behavior: string
  at_ms: number
}

/** `run.json` (`RUN_RECORD_VERSION` 7). */
export interface RunRecord {
  version: number
  run_id: string
  status: RunStatus
  workdir: string
  runs_dir?: string
  created_at_ms: number
  updated_at_ms: number
  summary: string
  input: InputRecord
  config: EffectiveConfig
  prompt: PromptPlan
  file_model_stage?: FileModelStageRecord
  pending_input?: PendingInput
  latest_snapshot_idx?: number
  last_error?: RunErrorRecord
  result?: RunResultRecord
  artifacts: string[]
  usage: UsageRecord
  limit_reason?: string
  interrupt_reason?: string
  compactions: number
  pid: number
  host?: HostRunInfo
  host_commit_pending?: number
  hints_once?: string[]
  handover?: RunHandover
}

export type RunPhase = 'preparing_input' | 'file_model' | 'waiting_model' | 'executing_tool' | 'compacting_context' | 'saving_result'

export type RunEvent =
  | { kind: 'phase'; phase: RunPhase; detail: string }
  | { kind: 'llm_started'; model: string }
  | { kind: 'llm_finished'; ok: boolean; elapsed_ms: number }
  | { kind: 'tool_started'; name: string; call_id: string; command?: string }
  | { kind: 'tool_finished'; name: string; call_id: string; command?: string; ok: boolean; duration_ms: number }
  | { kind: 'warning'; message: string }
  | { kind: 'debug'; message: string }

export interface RunObserver {
  onEvent(runId: string, event: RunEvent): void
}
