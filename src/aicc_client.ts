import { kRPCClient, RPCError } from './krpc_client'

// AICC (AI Compute Center) client.
//
// The AICC v0.2 protocol uses the kRPC method name as the canonical AI
// method/schema discriminator. Requests no longer go through a generic
// "complete" method; callers invoke standard methods such as "llm.chat" or
// "image.txt2img" directly.

export const AICC_SERVICE_NAME = 'aicc'
export const AICC_SERVICE_UNIQUE_ID = 'aicc'
export const AICC_SERVICE_SERVICE_NAME = AICC_SERVICE_NAME
export const AICC_SERVICE_SERVICE_PORT = 4040

export const AICC_AI_METHODS = {
  LLM_CHAT: 'llm.chat',
  LLM_COMPLETION: 'llm.completion',
  EMBEDDING_TEXT: 'embedding.text',
  EMBEDDING_MULTIMODAL: 'embedding.multimodal',
  RERANK: 'rerank',
  IMAGE_TXT2IMG: 'image.txt2img',
  IMAGE_IMG2IMG: 'image.img2img',
  IMAGE_INPAINT: 'image.inpaint',
  IMAGE_UPSCALE: 'image.upscale',
  IMAGE_BG_REMOVE: 'image.bg_remove',
  VISION_OCR: 'vision.ocr',
  VISION_CAPTION: 'vision.caption',
  VISION_DETECT: 'vision.detect',
  VISION_SEGMENT: 'vision.segment',
  AUDIO_TTS: 'audio.tts',
  AUDIO_ASR: 'audio.asr',
  AUDIO_MUSIC: 'audio.music',
  AUDIO_ENHANCE: 'audio.enhance',
  VIDEO_TXT2VIDEO: 'video.txt2video',
  VIDEO_IMG2VIDEO: 'video.img2video',
  VIDEO_VIDEO2VIDEO: 'video.video2video',
  VIDEO_EXTEND: 'video.extend',
  VIDEO_UPSCALE: 'video.upscale',
  AGENT_COMPUTER_USE: 'agent.computer_use',
} as const

export const AICC_CONTROL_METHODS = {
  CANCEL: 'cancel',
  RELOAD_SETTINGS: 'reload_settings',
  SERVICE_RELOAD_SETTINGS: 'service.reload_settings',
  QUOTA_QUERY: 'quota.query',
  PROVIDER_LIST: 'provider.list',
  PROVIDER_HEALTH: 'provider.health',
} as const

export const AICC_FEATURES = {
  PLAN: 'plan',
  TOOL_CALLING: 'tool_calling',
  JSON_OUTPUT: 'json_output',
  WEB_SEARCH: 'web_search',
  VISION: 'vision',
  ASR: 'asr',
  VIDEO_UNDERSTAND: 'video_understand',
} as const

export type AiccAiMethod = typeof AICC_AI_METHODS[keyof typeof AICC_AI_METHODS]
export type AiccControlMethod = typeof AICC_CONTROL_METHODS[keyof typeof AICC_CONTROL_METHODS]
export type AiccCapability = 'llm' | 'embedding' | 'rerank' | 'image' | 'vision' | 'audio' | 'video' | 'agent'
export type AiccFeature = typeof AICC_FEATURES[keyof typeof AICC_FEATURES] | string
export type AiccRespFormat = 'text' | 'json'
export type AiccRoutePolicyProfile = 'cheap' | 'fast' | 'balanced' | 'quality'
export type AiccMethodStatus = 'succeeded' | 'running' | 'failed'

export interface AiccResourceUrl {
  kind: 'url'
  url: string
  mime_hint?: string | null
}

export interface AiccResourceBase64 {
  kind: 'base64'
  mime: string
  data_base64: string
}

export interface AiccResourceNamedObject {
  kind: 'named_object'
  obj_id: string
}

export type AiccResourceRef = AiccResourceUrl | AiccResourceBase64 | AiccResourceNamedObject

export type AiccContentPart =
  | { type: 'text'; text: string }
  | { type: 'resource'; resource: AiccResourceRef }
  | Record<string, unknown>

export interface AiccMessage {
  role: string
  content: string | AiccContentPart[]
}

export interface AiccToolSpec {
  name: string
  description: string
  args_schema: Record<string, unknown>
  output_schema: unknown
}

export interface AiccModelSpec {
  alias: string
  provider_model_hint?: string | null
}

export interface AiccRequirements {
  must_features?: AiccFeature[]
  max_latency_ms?: number
  max_cost_usd?: number
  resp_format?: AiccRespFormat
  extra?: unknown
}

export interface AiccPayload {
  input_json?: unknown
  resources?: AiccResourceRef[]
  options?: unknown
}

export interface AiccRoutePolicy {
  profile?: AiccRoutePolicyProfile
  allow_fallback?: boolean
  runtime_failover?: boolean
  explain?: boolean
}

export interface AiccTaskOptions {
  parent_id?: number | null
}

export interface AiccMethodRequest {
  capability: AiccCapability
  model: AiccModelSpec
  requirements: AiccRequirements
  payload: AiccPayload
  policy?: AiccRoutePolicy | null
  idempotency_key?: string | null
  task_options?: AiccTaskOptions | null
}

export interface AiccTokenUsage {
  input?: number
  output?: number
  total?: number
  cached?: number
  reasoning?: number
}

export interface AiccMediaUsage {
  audio_seconds?: number
  video_seconds?: number
  image_count?: number
}

export interface AiccUsage {
  tokens?: AiccTokenUsage
  media?: AiccMediaUsage
  request_units?: number
}

export interface AiccCost {
  amount: number
  currency: string
}

export interface AiccArtifact {
  name: string
  resource: AiccResourceRef
  mime?: string | null
  metadata?: unknown
}

export interface AiccToolCall {
  name: string
  args: Record<string, unknown>
  call_id: string
}

export interface AiccResponseSummary {
  text?: string
  tool_calls?: AiccToolCall[]
  artifacts?: AiccArtifact[]
  usage?: AiccUsage
  cost?: AiccCost
  finish_reason?: string
  provider_task_ref?: string | null
  extra?: unknown
}

export interface AiccMethodResponse {
  task_id: string
  status: AiccMethodStatus
  result?: AiccResponseSummary | null
  event_ref?: string | null
}

export interface AiccCancelResponse {
  task_id: string
  accepted: boolean
}

export interface AiccQuotaQueryRequest {
  capability?: AiccCapability
  method?: AiccAiMethod | string
}

export interface AiccQuotaQueryResponse {
  quota: {
    state: string
    remaining_request_units?: number
    remaining_cost_usd?: number
    reset_at?: string
    [key: string]: unknown
  }
}

export interface AiccProviderListRequest {
  method?: AiccAiMethod | string
}

export interface AiccProviderHealthRequest {
  exact_model?: string
  provider?: string
}

export type AiccModelInput = string | AiccModelSpec

export interface AiccTypedMethodCall<TInput> {
  model: AiccModelInput
  input: TInput
  requirements?: AiccRequirements
  resources?: AiccResourceRef[]
  options?: unknown
  policy?: AiccRoutePolicy | null
  idempotency_key?: string | null
  task_options?: AiccTaskOptions | null
}

export type AiccTypedResponseSummary<TExtra = unknown> = Omit<AiccResponseSummary, 'extra'> & {
  extra?: TExtra
}

export type AiccTypedMethodResponse<TExtra = unknown> = Omit<AiccMethodResponse, 'result'> & {
  result?: AiccTypedResponseSummary<TExtra> | null
}

export interface AiccGenerationOutputOptions {
  media_type?: string
  size?: string
  sample_rate?: number
  fps?: number
}

export interface AiccGenerationParams {
  temperature?: number
  top_p?: number
  max_output_tokens?: number
  seed?: number
  stop?: string[]
  output?: AiccGenerationOutputOptions
}

export interface AiccJsonSchemaResponseFormat {
  type: 'json_schema'
  json_schema: {
    name: string
    schema: Record<string, unknown>
    strict?: boolean
  }
}

export type AiccLlmResponseFormat = { type: 'text' } | { type: 'json_object' } | AiccJsonSchemaResponseFormat

export interface AiccLlmTool {
  type: 'function'
  name: string
  description?: string
  args_json_schema: Record<string, unknown>
}

export interface AiccLlmChatInput extends AiccGenerationParams {
  messages: AiccMessage[]
  tools?: AiccLlmTool[]
  response_format?: AiccLlmResponseFormat
}

export interface AiccLlmCompletionInput extends AiccGenerationParams {
  prompt: string
  suffix?: string | null
}

export interface AiccRouteTraceAttempt {
  step: number
  exact_model: string
  started_at?: string
  ended_at?: string | null
  outcome: 'succeeded' | 'failed' | 'skipped'
  error_code?: string | null
  fallback_reason?: string | null
}

export interface AiccRouteTrace {
  attempts: AiccRouteTraceAttempt[]
  final_model?: string
}

export interface AiccLlmExtra {
  provider_io?: unknown
  route_trace?: AiccRouteTrace
  [key: string]: unknown
}

export type AiccLlmChatResponse = AiccTypedMethodResponse<AiccLlmExtra>
export type AiccLlmCompletionResponse = AiccTypedMethodResponse<AiccLlmExtra>

export type AiccEmbeddingTextItem =
  | { type: 'text'; text: string; id?: string }
  | { type: 'resource'; resource: AiccResourceRef; id?: string }

export interface AiccEmbeddingChunking {
  strategy: 'auto' | string
  max_tokens?: number
  overlap_tokens?: number
}

export interface AiccEmbeddingTextInput {
  items: AiccEmbeddingTextItem[]
  chunking?: AiccEmbeddingChunking
  embedding_space_id?: string | null
  dimensions?: number
  normalize?: boolean
  prefer_artifact?: boolean | 'auto'
}

export interface AiccEmbeddingMultimodalItem {
  id?: string
  text?: string
  image?: AiccResourceRef
  audio?: AiccResourceRef
  video?: AiccResourceRef
}

export interface AiccEmbeddingMultimodalInput {
  items: AiccEmbeddingMultimodalItem[]
  dimensions?: number
  normalize?: boolean
  embedding_space_id?: string | null
  prefer_artifact?: boolean | 'auto'
}

export interface AiccEmbeddingVector {
  index: number
  id?: string
  embedding: number[]
  embedding_space_id?: string
}

export interface AiccEmbeddingResult {
  data?: AiccEmbeddingVector[]
  data_resource?: AiccResourceRef
}

export interface AiccEmbeddingExtra {
  embedding?: AiccEmbeddingResult
  [key: string]: unknown
}

export type AiccEmbeddingTextResponse = AiccTypedMethodResponse<AiccEmbeddingExtra>
export type AiccEmbeddingMultimodalResponse = AiccTypedMethodResponse<AiccEmbeddingExtra>

export type AiccRerankDocument =
  | { id?: string; text: string; metadata?: Record<string, unknown> }
  | { id?: string; resource: AiccResourceRef; metadata?: Record<string, unknown> }

export interface AiccRerankInput {
  query: string
  documents: AiccRerankDocument[]
  n?: number
  return_documents?: boolean
}

export interface AiccRerankResultItem {
  index: number
  id?: string
  score: number
  document?: AiccRerankDocument
}

export interface AiccRerankResult {
  results: AiccRerankResultItem[]
}

export interface AiccRerankExtra {
  rerank?: AiccRerankResult
  [key: string]: unknown
}

export type AiccRerankResponse = AiccTypedMethodResponse<AiccRerankExtra>

export interface AiccImageOutputOptions {
  media_type?: string
  size?: string
}

export interface AiccImageTxt2imgInput {
  prompt: string
  negative_prompt?: string
  n?: number
  aspect_ratio?: string
  quality?: 'low' | 'medium' | 'high' | string
  seed?: number
  output?: AiccImageOutputOptions
}

export interface AiccImageImg2imgInput {
  images: AiccResourceRef[]
  prompt?: string
  strength?: number
  output?: AiccImageOutputOptions
}

export type AiccImageMaskSemantics = 'white_area_is_edit_area' | 'black_area_is_edit_area' | 'alpha_zero_is_edit_area'

export interface AiccImageInpaintInput {
  image: AiccResourceRef
  mask: AiccResourceRef
  prompt: string
  mask_semantics?: AiccImageMaskSemantics
  output?: AiccImageOutputOptions
}

export interface AiccImageUpscaleInput {
  image: AiccResourceRef
  scale?: number
  target_width?: number
  target_height?: number
  preserve_faces?: boolean
  output?: AiccImageOutputOptions
}

export interface AiccImageBgRemoveInput {
  image: AiccResourceRef
  mode?: 'rgba_image' | 'mask' | string
  output?: AiccImageOutputOptions
}

export interface AiccImageExtra {
  images?: AiccResourceRef[]
  image?: AiccResourceRef
  [key: string]: unknown
}

export type AiccImageResponse = AiccTypedMethodResponse<AiccImageExtra>

export interface AiccBoundingBox {
  format: 'xywh'
  unit: 'px' | 'relative'
  x: number
  y: number
  width: number
  height: number
}

export interface AiccBoundingBoxSpec {
  format: 'xywh'
  unit: 'px' | 'relative'
}

export type AiccMask =
  | { format: 'rle'; size: [number, number]; counts: string }
  | { format: 'polygon'; points: number[][] }
  | { format: 'bitmap_resource'; resource: AiccResourceRef }

export interface AiccVisionOcrInput {
  document: AiccResourceRef
  level?: 'page' | 'block' | 'line' | 'word' | string
  language_hints?: string[]
  return_layout?: boolean
  return_artifacts?: string[]
}

export interface AiccVisionCaptionInput {
  image: AiccResourceRef
  style?: 'short' | 'detailed' | string
  language?: string
  n?: number
}

export interface AiccVisionDetectInput {
  image: AiccResourceRef
  classes?: string[]
  score_threshold?: number
  bbox_spec?: AiccBoundingBoxSpec
}

export type AiccVisionSegmentPrompt =
  | { type: 'box'; bbox: AiccBoundingBox }
  | { type: 'point'; x: number; y: number; label?: string }
  | { type: 'text'; text: string }

export interface AiccVisionSegmentInput {
  image: AiccResourceRef
  prompt: AiccVisionSegmentPrompt
  mask_format?: 'rle' | 'polygon' | 'bitmap_resource'
  return_bitmap_mask?: boolean
}

export interface AiccVisionOcrExtra {
  ocr?: unknown
  [key: string]: unknown
}

export interface AiccVisionCaption {
  text: string
  confidence?: number
}

export interface AiccVisionCaptionExtra {
  captions?: AiccVisionCaption[]
  [key: string]: unknown
}

export interface AiccVisionDetection {
  label: string
  class_id?: string
  score: number
  bbox: AiccBoundingBox
}

export interface AiccVisionDetectExtra {
  detections?: AiccVisionDetection[]
  [key: string]: unknown
}

export interface AiccVisionMaskResult {
  id?: string
  score?: number
  bbox?: AiccBoundingBox
  mask: AiccMask
}

export interface AiccVisionSegmentExtra {
  segment?: {
    masks: AiccVisionMaskResult[]
  }
  [key: string]: unknown
}

export type AiccVisionOcrResponse = AiccTypedMethodResponse<AiccVisionOcrExtra>
export type AiccVisionCaptionResponse = AiccTypedMethodResponse<AiccVisionCaptionExtra>
export type AiccVisionDetectResponse = AiccTypedMethodResponse<AiccVisionDetectExtra>
export type AiccVisionSegmentResponse = AiccTypedMethodResponse<AiccVisionSegmentExtra>

export interface AiccAudioOutputOptions {
  media_type?: string
  sample_rate?: number
}

export interface AiccAudioVoiceSpec {
  voice_id?: string
  language?: string
  gender?: 'male' | 'female' | 'neutral' | string
  style?: string
  speaker_similarity_required?: boolean
}

export interface AiccAudioTtsInput {
  text: string
  voice?: AiccAudioVoiceSpec
  speed?: number
  output?: AiccAudioOutputOptions
}

export interface AiccAudioAsrInput {
  audio: AiccResourceRef
  language?: string
  timestamps?: 'none' | 'word' | 'segment' | string
  diarization?: boolean
  output_formats?: Array<'json' | 'vtt' | 'srt' | string>
}

export interface AiccAudioMusicInput {
  prompt: string
  duration_seconds?: number
  instrumental?: boolean
  lyrics?: string | null
  seed?: number
  output?: AiccAudioOutputOptions
}

export interface AiccAudioEnhanceInput {
  audio: AiccResourceRef
  task: 'denoise' | 'dereverb' | 'separate_stems' | string
  strength?: number
  return_stems?: boolean
}

export interface AiccAudioSegment {
  id?: string
  start_seconds: number
  end_seconds: number
  text: string
  speaker?: string
  confidence?: number
}

export interface AiccAudioExtra {
  asr?: {
    segments?: AiccAudioSegment[]
  }
  audio?: AiccResourceRef
  stems?: AiccResourceRef[]
  structure?: unknown
  [key: string]: unknown
}

export type AiccAudioResponse = AiccTypedMethodResponse<AiccAudioExtra>

export interface AiccVideoOutputOptions {
  media_type?: string
  fps?: number
}

export interface AiccVideoTxt2videoInput {
  prompt: string
  duration_seconds?: number
  aspect_ratio?: string
  resolution?: string
  generate_audio?: boolean
  seed?: number
  output?: AiccVideoOutputOptions
}

export interface AiccVideoImg2videoInput {
  image: AiccResourceRef
  prompt?: string
  duration_seconds?: number
  aspect_ratio?: string
  resolution?: string
}

export interface AiccTimeRange {
  start_seconds: number
  end_seconds: number
}

export interface AiccVideoVideo2videoInput {
  video: AiccResourceRef
  prompt?: string
  preserve_motion?: boolean
  time_range?: AiccTimeRange
}

export interface AiccVideoExtendInput {
  video: AiccResourceRef
  prompt?: string
  continuation_handle?: string
  duration_seconds?: number
  resolution?: string
}

export interface AiccVideoUpscaleInput {
  video: AiccResourceRef
  target_resolution?: string
  denoise?: boolean
  sharpen?: number
  output?: AiccVideoOutputOptions
}

export interface AiccVideoExtra {
  video?: AiccResourceRef
  [key: string]: unknown
}

export type AiccVideoResponse = AiccTypedMethodResponse<AiccVideoExtra>

export type AiccAgentComputerActionName = 'screenshot' | 'left_click' | 'right_click' | 'type' | 'key' | 'scroll' | 'wait'

export interface AiccAgentComputerUseInput {
  task: string
  environment: {
    environment_id: string
    session_id: string
    screenshot?: AiccResourceRef
    viewport?: {
      width: number
      height: number
    }
  }
  allowed_actions?: AiccAgentComputerActionName[]
}

export type AiccAgentComputerAction =
  | { type: 'screenshot' }
  | { type: 'left_click' | 'right_click'; x: number; y: number }
  | { type: 'type'; text: string }
  | { type: 'key'; key: string }
  | { type: 'scroll'; x?: number; y?: number; delta_x?: number; delta_y?: number }
  | { type: 'wait'; milliseconds?: number }

export interface AiccAgentComputerUseExtra {
  actions?: AiccAgentComputerAction[]
  requires_next_observation?: boolean
  [key: string]: unknown
}

export type AiccAgentComputerUseResponse = AiccTypedMethodResponse<AiccAgentComputerUseExtra>

const AI_METHOD_SET = new Set<string>(Object.values(AICC_AI_METHODS))
const CAPABILITY_SET = new Set<string>(['llm', 'embedding', 'rerank', 'image', 'vision', 'audio', 'video', 'agent'])
const METHOD_STATUS_SET = new Set<string>(['succeeded', 'running', 'failed'])

export function isAiccAiMethod(method: string): method is AiccAiMethod {
  return AI_METHOD_SET.has(method)
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RPCError('Invalid RPC response format')
  }
  return value as Record<string, unknown>
}

function rejectDeprecatedRequestFields(request: AiccMethodRequest) {
  const requirements = request.requirements as Record<string, unknown>
  if ('resp_foramt' in requirements) {
    throw new RPCError('AiccRequirements.resp_foramt is no longer supported; use resp_format')
  }

  const payload = request.payload as Record<string, unknown>
  for (const key of ['text', 'messages', 'tool_specs']) {
    if (key in payload) {
      throw new RPCError(`AiccPayload.${key} is no longer supported; put method fields under payload.input_json`)
    }
  }
}

function normalizeMethodRequest(request: AiccMethodRequest): AiccMethodRequest {
  if (!request.capability || !CAPABILITY_SET.has(request.capability)) {
    throw new RPCError('AiccMethodRequest.capability is invalid')
  }
  if (!request.model || !request.model.alias) {
    throw new RPCError('AiccMethodRequest.model.alias is required')
  }
  if (!request.requirements || typeof request.requirements !== 'object') {
    throw new RPCError('AiccMethodRequest.requirements is required')
  }
  if (!request.payload || typeof request.payload !== 'object' || Array.isArray(request.payload)) {
    throw new RPCError('AiccMethodRequest.payload is required')
  }

  rejectDeprecatedRequestFields(request)

  return {
    ...request,
    payload: {
      input_json: request.payload.input_json ?? {},
      resources: request.payload.resources ?? [],
      options: request.payload.options ?? {},
    },
  }
}

function parseMethodResponse(result: unknown): AiccMethodResponse {
  const record = asRecord(result)
  if (typeof record.task_id !== 'string') {
    throw new RPCError('AiccMethodResponse missing task_id')
  }
  if (typeof record.status !== 'string' || !METHOD_STATUS_SET.has(record.status)) {
    throw new RPCError('AiccMethodResponse missing or invalid status')
  }
  return record as unknown as AiccMethodResponse
}

function normalizeModel(model: AiccModelInput): AiccModelSpec {
  if (typeof model === 'string') {
    return { alias: model }
  }
  return model
}

function buildTypedMethodRequest<TInput>(
  capability: AiccCapability,
  request: AiccTypedMethodCall<TInput>,
): AiccMethodRequest {
  return {
    capability,
    model: normalizeModel(request.model),
    requirements: request.requirements ?? {},
    payload: {
      input_json: request.input,
      resources: request.resources ?? [],
      options: request.options ?? {},
    },
    policy: request.policy,
    idempotency_key: request.idempotency_key,
    task_options: request.task_options,
  }
}

export class AiccClient {
  private rpcClient: kRPCClient

  constructor(rpcClient: kRPCClient) {
    this.rpcClient = rpcClient
  }

  setSeq(seq: number) {
    this.rpcClient.setSeq(seq)
  }

  async callMethod(method: AiccAiMethod, request: AiccMethodRequest): Promise<AiccMethodResponse> {
    if (!isAiccAiMethod(method)) {
      throw new RPCError(`Unknown AICC AI method: ${method}`)
    }
    const normalizedRequest = normalizeMethodRequest(request)
    const result = await this.rpcClient.call<unknown, AiccMethodRequest>(method, normalizedRequest)
    return parseMethodResponse(result)
  }

  async llmChat(request: AiccTypedMethodCall<AiccLlmChatInput>): Promise<AiccLlmChatResponse> {
    return this.callMethod(AICC_AI_METHODS.LLM_CHAT, buildTypedMethodRequest('llm', request)) as Promise<AiccLlmChatResponse>
  }

  async llmCompletion(request: AiccTypedMethodCall<AiccLlmCompletionInput>): Promise<AiccLlmCompletionResponse> {
    return this.callMethod(AICC_AI_METHODS.LLM_COMPLETION, buildTypedMethodRequest('llm', request)) as Promise<AiccLlmCompletionResponse>
  }

  async embeddingText(request: AiccTypedMethodCall<AiccEmbeddingTextInput>): Promise<AiccEmbeddingTextResponse> {
    return this.callMethod(AICC_AI_METHODS.EMBEDDING_TEXT, buildTypedMethodRequest('embedding', request)) as Promise<AiccEmbeddingTextResponse>
  }

  async embeddingMultimodal(request: AiccTypedMethodCall<AiccEmbeddingMultimodalInput>): Promise<AiccEmbeddingMultimodalResponse> {
    return this.callMethod(
      AICC_AI_METHODS.EMBEDDING_MULTIMODAL,
      buildTypedMethodRequest('embedding', request),
    ) as Promise<AiccEmbeddingMultimodalResponse>
  }

  async rerank(request: AiccTypedMethodCall<AiccRerankInput>): Promise<AiccRerankResponse> {
    return this.callMethod(AICC_AI_METHODS.RERANK, buildTypedMethodRequest('rerank', request)) as Promise<AiccRerankResponse>
  }

  async imageTxt2img(request: AiccTypedMethodCall<AiccImageTxt2imgInput>): Promise<AiccImageResponse> {
    return this.callMethod(AICC_AI_METHODS.IMAGE_TXT2IMG, buildTypedMethodRequest('image', request)) as Promise<AiccImageResponse>
  }

  async imageImg2img(request: AiccTypedMethodCall<AiccImageImg2imgInput>): Promise<AiccImageResponse> {
    return this.callMethod(AICC_AI_METHODS.IMAGE_IMG2IMG, buildTypedMethodRequest('image', request)) as Promise<AiccImageResponse>
  }

  async imageInpaint(request: AiccTypedMethodCall<AiccImageInpaintInput>): Promise<AiccImageResponse> {
    return this.callMethod(AICC_AI_METHODS.IMAGE_INPAINT, buildTypedMethodRequest('image', request)) as Promise<AiccImageResponse>
  }

  async imageUpscale(request: AiccTypedMethodCall<AiccImageUpscaleInput>): Promise<AiccImageResponse> {
    return this.callMethod(AICC_AI_METHODS.IMAGE_UPSCALE, buildTypedMethodRequest('image', request)) as Promise<AiccImageResponse>
  }

  async imageBgRemove(request: AiccTypedMethodCall<AiccImageBgRemoveInput>): Promise<AiccImageResponse> {
    return this.callMethod(AICC_AI_METHODS.IMAGE_BG_REMOVE, buildTypedMethodRequest('image', request)) as Promise<AiccImageResponse>
  }

  async visionOcr(request: AiccTypedMethodCall<AiccVisionOcrInput>): Promise<AiccVisionOcrResponse> {
    return this.callMethod(AICC_AI_METHODS.VISION_OCR, buildTypedMethodRequest('vision', request)) as Promise<AiccVisionOcrResponse>
  }

  async visionCaption(request: AiccTypedMethodCall<AiccVisionCaptionInput>): Promise<AiccVisionCaptionResponse> {
    return this.callMethod(AICC_AI_METHODS.VISION_CAPTION, buildTypedMethodRequest('vision', request)) as Promise<AiccVisionCaptionResponse>
  }

  async visionDetect(request: AiccTypedMethodCall<AiccVisionDetectInput>): Promise<AiccVisionDetectResponse> {
    return this.callMethod(AICC_AI_METHODS.VISION_DETECT, buildTypedMethodRequest('vision', request)) as Promise<AiccVisionDetectResponse>
  }

  async visionSegment(request: AiccTypedMethodCall<AiccVisionSegmentInput>): Promise<AiccVisionSegmentResponse> {
    return this.callMethod(AICC_AI_METHODS.VISION_SEGMENT, buildTypedMethodRequest('vision', request)) as Promise<AiccVisionSegmentResponse>
  }

  async audioTts(request: AiccTypedMethodCall<AiccAudioTtsInput>): Promise<AiccAudioResponse> {
    return this.callMethod(AICC_AI_METHODS.AUDIO_TTS, buildTypedMethodRequest('audio', request)) as Promise<AiccAudioResponse>
  }

  async audioAsr(request: AiccTypedMethodCall<AiccAudioAsrInput>): Promise<AiccAudioResponse> {
    return this.callMethod(AICC_AI_METHODS.AUDIO_ASR, buildTypedMethodRequest('audio', request)) as Promise<AiccAudioResponse>
  }

  async audioMusic(request: AiccTypedMethodCall<AiccAudioMusicInput>): Promise<AiccAudioResponse> {
    return this.callMethod(AICC_AI_METHODS.AUDIO_MUSIC, buildTypedMethodRequest('audio', request)) as Promise<AiccAudioResponse>
  }

  async audioEnhance(request: AiccTypedMethodCall<AiccAudioEnhanceInput>): Promise<AiccAudioResponse> {
    return this.callMethod(AICC_AI_METHODS.AUDIO_ENHANCE, buildTypedMethodRequest('audio', request)) as Promise<AiccAudioResponse>
  }

  async videoTxt2video(request: AiccTypedMethodCall<AiccVideoTxt2videoInput>): Promise<AiccVideoResponse> {
    return this.callMethod(AICC_AI_METHODS.VIDEO_TXT2VIDEO, buildTypedMethodRequest('video', request)) as Promise<AiccVideoResponse>
  }

  async videoImg2video(request: AiccTypedMethodCall<AiccVideoImg2videoInput>): Promise<AiccVideoResponse> {
    return this.callMethod(AICC_AI_METHODS.VIDEO_IMG2VIDEO, buildTypedMethodRequest('video', request)) as Promise<AiccVideoResponse>
  }

  async videoVideo2video(request: AiccTypedMethodCall<AiccVideoVideo2videoInput>): Promise<AiccVideoResponse> {
    return this.callMethod(AICC_AI_METHODS.VIDEO_VIDEO2VIDEO, buildTypedMethodRequest('video', request)) as Promise<AiccVideoResponse>
  }

  async videoExtend(request: AiccTypedMethodCall<AiccVideoExtendInput>): Promise<AiccVideoResponse> {
    return this.callMethod(AICC_AI_METHODS.VIDEO_EXTEND, buildTypedMethodRequest('video', request)) as Promise<AiccVideoResponse>
  }

  async videoUpscale(request: AiccTypedMethodCall<AiccVideoUpscaleInput>): Promise<AiccVideoResponse> {
    return this.callMethod(AICC_AI_METHODS.VIDEO_UPSCALE, buildTypedMethodRequest('video', request)) as Promise<AiccVideoResponse>
  }

  async agentComputerUse(request: AiccTypedMethodCall<AiccAgentComputerUseInput>): Promise<AiccAgentComputerUseResponse> {
    return this.callMethod(AICC_AI_METHODS.AGENT_COMPUTER_USE, buildTypedMethodRequest('agent', request)) as Promise<AiccAgentComputerUseResponse>
  }

  async cancel(taskId: string): Promise<AiccCancelResponse> {
    if (!taskId) {
      throw new RPCError('AiccClient.cancel requires a non-empty task_id')
    }
    const result = await this.rpcClient.call<unknown, { task_id: string }>(AICC_CONTROL_METHODS.CANCEL, { task_id: taskId })
    const record = asRecord(result)
    if (typeof record.task_id !== 'string' || typeof record.accepted !== 'boolean') {
      throw new RPCError('Invalid cancel response')
    }
    return { task_id: record.task_id, accepted: record.accepted }
  }

  async reloadSettings(): Promise<unknown> {
    return this.rpcClient.call<unknown, Record<string, never>>(AICC_CONTROL_METHODS.RELOAD_SETTINGS, {})
  }

  async serviceReloadSettings(): Promise<unknown> {
    return this.rpcClient.call<unknown, Record<string, never>>(AICC_CONTROL_METHODS.SERVICE_RELOAD_SETTINGS, {})
  }

  async queryQuota(request: AiccQuotaQueryRequest): Promise<AiccQuotaQueryResponse> {
    const result = await this.rpcClient.call<unknown, AiccQuotaQueryRequest>(AICC_CONTROL_METHODS.QUOTA_QUERY, request)
    const record = asRecord(result)
    if (!record.quota || typeof record.quota !== 'object' || Array.isArray(record.quota)) {
      throw new RPCError('Invalid quota.query response')
    }
    return record as unknown as AiccQuotaQueryResponse
  }

  async listProviders(request: AiccProviderListRequest = {}): Promise<unknown> {
    return this.rpcClient.call<unknown, AiccProviderListRequest>(AICC_CONTROL_METHODS.PROVIDER_LIST, request)
  }

  async providerHealth(request: AiccProviderHealthRequest): Promise<unknown> {
    return this.rpcClient.call<unknown, AiccProviderHealthRequest>(AICC_CONTROL_METHODS.PROVIDER_HEALTH, request)
  }
}
