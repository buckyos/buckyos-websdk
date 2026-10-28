import { kRPCClient, RPCError } from './krpc_client'

export const AICC_SERVICE_UNIQUE_ID = 'aicc'
export const AICC_SERVICE_SERVICE_NAME = 'aicc'
export const AICC_SERVICE_SERVICE_PORT = 4040

export const AICC_AI_METHODS = {
  CHAT_COMPLETIONS_CREATE: 'chat.completions.create',
  IMAGES_GENERATE: 'images.generate',
  EMBEDDING_TEXT: 'embedding.text',
  EMBEDDING_MULTIMODAL: 'embedding.multimodal',
  RERANK: 'rerank',
  DECISION_EVALUATE: 'decision.evaluate',
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
  VIDEO_GENERATE: 'video.generate',
  VIDEO_EDIT: 'video.edit',
  VIDEO_EXTEND: 'video.extend',
  VIDEO_UPSCALE: 'video.upscale',
  AGENT_COMPUTER_USE: 'agent.computer_use',
} as const

export const AICC_CORE_METHODS = {
  ROUTE_RESOLVE: 'route.resolve',
  HELPER_LLM_CHAT: 'helper.llm_chat',
  HELPER_TEXT_TO_IMAGE: 'helper.text_to_image',
  HELPER_VIDEO_GENERATE: 'helper.video_generate',
  CANCEL: 'cancel',
} as const

export const AICC_MANAGEMENT_METHODS = {
  SERVICE_RELOAD_SETTINGS: 'service.reload_settings',
  QUOTA_QUERY: 'quota.query',
  USAGE_QUERY: 'usage.query',
  TRACE_QUERY: 'trace.query',
  ROUTING_GET: 'routing.get',
  ROUTING_PREVIEW: 'routing.preview',
  ROUTING_UPDATE: 'routing.update',
  PROVIDER_CATALOG: 'provider.catalog',
  PROTOCOL_ADAPTER_LIST: 'protocol_adapter.list',
  PROVIDER_VALIDATE: 'provider.validate',
  PROVIDER_ADD: 'provider.add',
  PROVIDER_LIST: 'provider.list',
  PROVIDER_HEALTH: 'provider.health',
  PROVIDER_UPDATE: 'provider.update',
  PROVIDER_DELETE: 'provider.delete',
  PROVIDER_REFRESH_MODELS: 'provider.refresh_models',
  MODELS_LIST: 'models.list',
  DRIVER_METADATA_UPDATE_GET: 'driver_metadata_update.get',
  DRIVER_METADATA_UPDATE_SET: 'driver_metadata_update.set',
} as const

/** Token quota and resource visibility (product/ai_center/AI_Center_Quota_PRD.md). */
export const AICC_QUOTA_METHODS = {
  RULE_LIST: 'quota.rule.list',
  RULE_GET: 'quota.rule.get',
  RULE_PREVIEW: 'quota.rule.preview',
  RULE_CREATE: 'quota.rule.create',
  RULE_UPDATE: 'quota.rule.update',
  RULE_DELETE: 'quota.rule.delete',
  ACCOUNT_GET: 'quota.account.get',
  ACCOUNT_RECHARGE: 'quota.account.recharge',
  RECHARGE_GET: 'quota.recharge.get',
  VISIBILITY_GET: 'visibility.get',
  VISIBILITY_UPDATE: 'visibility.update',
  VISIBILITY_PREVIEW: 'visibility.preview',
} as const

export const AICC_METHODS = { ...AICC_AI_METHODS, ...AICC_CORE_METHODS, ...AICC_MANAGEMENT_METHODS, ...AICC_QUOTA_METHODS } as const
export type AiccAiMethod = typeof AICC_AI_METHODS[keyof typeof AICC_AI_METHODS]
export type AiccMethod = typeof AICC_METHODS[keyof typeof AICC_METHODS]
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export type ApiType = 'llm' | 'embedding.text' | 'embedding.multimodal' | 'decision' | 'rerank' | 'image.txt2img' |
  'image.img2img' | 'image.inpaint' | 'image.upscale' | 'image.bg_remove' | 'vision.ocr' | 'vision.caption' |
  'vision.detect' | 'vision.segment' | 'audio.tts' | 'audio.asr' | 'audio.music' | 'audio.enhance' |
  'video.generate' | 'video.edit' | 'video.extend' | 'video.upscale' | 'agent.computer_use'
export type Capability = 'llm' | 'embedding' | 'decision' | 'rerank' | 'image' | 'vision' | 'audio' | 'video' | 'agent'
export type Feature = string
export const AICC_FEATURES = {
  PLAN: 'plan', TOOL_CALL: 'tool_call', JSON_SCHEMA: 'json_schema', WEB_SEARCH: 'web_search',
  VISION: 'vision', IMAGE_GENERATION: 'image_generation', ASR: 'asr', VIDEO_UNDERSTAND: 'video_understand',
} as const
export const AICC_EXECUTION_MODES = { IMMEDIATE: 'immediate', STREAM: 'stream' } as const
export type AiccExecutionMode = typeof AICC_EXECUTION_MODES[keyof typeof AICC_EXECUTION_MODES]

export type ResourceRef =
  | { kind: 'url'; url: string; mime_hint?: string }
  | { kind: 'base64'; mime: string; data_base64: string }
  | { kind: 'named_object'; obj_id: string }
export type AiRole = 'system' | 'user' | 'assistant' | 'tool' | 'developer'
export type AiToolResultContent =
  | { type: 'text'; text: string }
  | { type: 'image'; source: ResourceRef }
  | { type: 'document'; source: ResourceRef; title?: string }
export type AiContent =
  | AiToolResultContent
  | { type: 'tool_use'; call_id: string; name: string; args: Record<string, JsonValue> }
  | { type: 'tool_result'; call_id: string; content: AiToolResultContent[]; is_error?: boolean }
  | { type: 'thinking'; summary?: string; text?: string; provider_metadata?: JsonValue }
  | { type: 'provider_state'; provider: string; value: JsonValue }
export interface AiMessage { role: AiRole; content: AiContent[] }
export interface AiToolSpec { type?: string; name: string; description: string; args_json_schema: JsonValue; output_schema?: JsonValue }
export interface LlmJsonSchema { name?: string; schema: JsonValue; strict?: boolean }
export interface LlmResponseFormat { type: 'text' | 'json' | 'json_object' | 'json_schema'; json_schema?: LlmJsonSchema }
export interface AiUsage { input_tokens?: number; output_tokens?: number; total_tokens?: number; request_units?: number;
  video_seconds?: number; reference_images?: number; reported_cost?: number }
export interface Money { amount: number; currency: string }
export type AiCost = Money
export interface AiArtifact { name: string; resource: ResourceRef; mime?: string; metadata?: JsonValue }
export type AiccErrorCode = 'invalid_request' | 'invalid_method' | 'schema_validation_failed' | 'invalid_model_name' |
  'resource_invalid' | 'no_provider_available' | 'no_candidate_model' | 'fallback_not_allowed' | 'provider_start_failed' |
  'provider_error' | 'unsupported_execution_mode' | 'timeout' | 'budget_exceeded' | 'policy_denied' | 'idempotency_conflict' |
  'settings_revision_conflict' | 'cancelled' | 'internal_error' |
  /** An enabled token quota rule has nothing left (`details`: QuotaDenialDetails). */
  'quota_exhausted' |
  /** Tokens are left but fewer than the call reserves; lower the budget (`details`: QuotaDenialDetails). */
  'quota_budget_exceeded' |
  /** A configured rule could not be read or reserved; retry later, never treat it as unlimited. */
  'quota_unavailable' |
  /** The Provider / model is not permitted to the caller (hidden identities are not disclosed). */
  'resource_not_permitted' |
  /** The AICC user of a delegated run cannot be determined. */
  'attribution_unavailable'
export interface AiccError { code: AiccErrorCode; message: string; provider_code?: string; retriable?: boolean; details?: JsonValue }
/** Token quota and resource policy refusals: they reach the client as a detailed kRPC error. */
export const AICC_POLICY_REFUSAL_CODES: readonly AiccErrorCode[] = ['quota_exhausted', 'quota_budget_exceeded', 'quota_unavailable', 'resource_not_permitted', 'attribution_unavailable']
/** The AICC error of a refused call (its `code` and `details`), read from the structured kRPC error. */
export function aiccRefusalOf(error: unknown): AiccError | undefined {
  if (!(error instanceof RPCError) || !AICC_POLICY_REFUSAL_CODES.includes(error.code as AiccErrorCode)) return undefined
  const data = error.data as Partial<AiccError> | undefined
  return { code: error.code as AiccErrorCode, message: data?.message ?? error.message, retriable: data?.retriable, details: data?.details }
}
export interface SettingsRevisionConflictDetails { expected_revision: number; actual_revision: number }
export interface RouteTraceAttempt { step: number; exact_model: string; started_at: string; ended_at?: string;
  outcome: 'succeeded' | 'failed' | 'skipped'; error_code?: AiccErrorCode; fallback_reason?: string }
export interface RouteTrace { attempts: RouteTraceAttempt[]; final_model?: string }
export interface AiToolCall { name: string; args: Record<string, JsonValue>; call_id: string }
export type AiMethodStatus = 'succeeded' | 'running' | 'failed'
export interface AiTaskOptions { parent_id?: string }
export interface AiOutputOptions { media_type?: string; size?: string; sample_rate?: number; fps?: number }
export interface ModelRequirement { decision?: DecisionRequirements; streaming?: boolean; tool_call?: boolean; json_schema?: boolean; web_search?: boolean;
  vision?: boolean; image_generation?: boolean; min_context_tokens?: number; video?: VideoGenerationRequirement }
export interface ModelDisable extends Omit<ModelRequirement, "decision" | "video"> {}
export interface HelperModelRequirement extends Omit<ModelRequirement, "decision"> {}
export interface RoutePolicy { profile?: 'cheap' | 'fast' | 'balanced' | 'quality'; local_only?: boolean;
  allow_fallback?: boolean; runtime_failover?: boolean; explain?: boolean; allowed_provider_instances?: string[];
  blocked_provider_instances?: string[]; max_cost?: Money; max_latency_ms?: number }
export interface ModelItem { target: string; weight?: number }
export interface ModelItemPatch { target?: string; weight?: number }
export type OverlayMergeMode = 'inherit' | 'replace'
export type AiccFallbackMode = 'strict' | 'parent' | 'target_exact' | 'target_logical' | 'disabled'
export interface AiccFallbackRule { mode: AiccFallbackMode; target?: string }
export type AiccSchedulerProfile = 'cost_first' | 'latency_first' | 'quality_first' | 'balanced' | 'local_first' | 'strict_local'
export type LockedValue<T> = T | { value: T; locked?: boolean }
export interface AiccSchedulerProfileWeights { cost?: number; latency?: number; reliability?: number; quality?: number;
  preference?: number; cache?: number; local?: number }
export interface AiccSchedulerProfileConfig { cost_first?: AiccSchedulerProfileWeights; latency_first?: AiccSchedulerProfileWeights;
  quality_first?: AiccSchedulerProfileWeights; balanced?: AiccSchedulerProfileWeights; local_first?: AiccSchedulerProfileWeights;
  strict_local?: AiccSchedulerProfileWeights }
export interface AiccPolicyConfig { profile?: LockedValue<AiccSchedulerProfile>;
  scheduler_profiles?: LockedValue<AiccSchedulerProfileConfig>; local_only?: LockedValue<boolean>;
  allow_fallback?: LockedValue<boolean>; allow_exact_model_fallback?: LockedValue<boolean>;
  runtime_failover?: LockedValue<boolean>; explain?: LockedValue<boolean>;
  blocked_provider_instances?: LockedValue<string[]>; allowed_provider_instances?: LockedValue<string[]>;
  max_estimated_cost?: LockedValue<Money> }
export interface AiccLogicalNodeOverlay { children?: Record<string, AiccLogicalNodeOverlay>; source?: string;
  items?: Record<string, ModelItem>; item_overrides?: Record<string, ModelItemPatch>;
  exact_model_weights?: Record<string, number>; disable_line?: ModelDisable; fallback?: AiccFallbackRule;
  policy?: AiccPolicyConfig; route_policy_override?: AiccPolicyConfig }
export interface AiccLogicalTreeOverlay { path: string; merge_mode?: OverlayMergeMode; items?: Record<string, ModelItem>;
  item_overrides?: Record<string, ModelItemPatch>; exact_model_weights?: Record<string, number>;
  disable_line?: ModelDisable; fallback?: AiccFallbackRule; route_policy_override?: AiccPolicyConfig; source?: string }
export interface AiccSessionLogicalProfile { name?: string; overlays?: AiccLogicalTreeOverlay[];
  route_policy_override?: AiccPolicyConfig }
export interface AiccRouteOverlay {
  inherit?: string; logical_tree?: Record<string, AiccLogicalNodeOverlay>; logical_profile?: AiccSessionLogicalProfile;
  logical_profiles?: Record<string, AiccSessionLogicalProfile>; active_logical_profile?: string;
  global_exact_model_weights?: Record<string, number>; provider_weights?: Record<string, number>;
  policy?: AiccPolicyConfig; revision?: string; ttl_seconds?: number
}

export interface RouteResolveRequest { trace_id?: string; execution_mode?: AiccExecutionMode; request_id?: string;
  api_type: ApiType; logical_model: string; requirements?: ModelRequirement;
  disable?: ModelDisable; policy?: RoutePolicy; estimated_input_tokens?: number; estimated_output_tokens?: number;
  session_overlay?: AiccRouteOverlay; session_id?: string }
export interface RouteResolveResponse { selected_exact_model: string; selected_model_uid: string; provider_instance_name: string;
  provider_profile_id: string; protocol_adapter_id: string; model_driver_id: string; provider_driver?: string;
  origin_model_id: string; provider_model_id: string; operation: string; enabled_capabilities?: Feature[];
  disabled_capabilities?: Feature[]; fallback_attempts?: Array<{ exact_model: string; provider_instance_name: string;
  provider_model_id: string }>; route_trace?: RouteTrace; inventory_revision: string }
export interface InferenceRequest { exact_model: string; trace_id?: string; execution_mode?: AiccExecutionMode;
  idempotency_key?: string; task_options?: AiTaskOptions; session_id?: string }
export interface InferenceResponse { task_id: string; status: AiMethodStatus; usage?: AiUsage; cost?: AiCost;
  finish_reason?: string; provider_task_ref?: string; route_trace?: RouteTrace; event_ref?: string; error?: AiccError }
interface ChatFields { messages: AiMessage[]; tools?: AiToolSpec[]; response_format?: LlmResponseFormat; temperature?: number;
  top_p?: number; max_output_tokens?: number; seed?: number; stop?: string[]; output?: AiOutputOptions }
interface ImageGenerationFields { prompt: string; negative_prompt?: string; n?: number; aspect_ratio?: string; size?: string;
  quality?: string; style?: string; seed?: number; output?: AiOutputOptions }
export interface LlmChatInvokeRequest extends InferenceRequest, ChatFields { web_search?: boolean }
export interface LlmChatHelperRequest extends ChatFields { logical_model: string; requirements?: HelperModelRequirement; disable?: ModelDisable;
  trace_id?: string; execution_mode?: AiccExecutionMode; policy?: RoutePolicy; idempotency_key?: string;
  task_options?: AiTaskOptions; session_overlay?: AiccRouteOverlay; session_id?: string }
export interface LlmChatInvokeResponse extends InferenceResponse { message?: AiMessage; tool_calls?: AiToolCall[] }
export interface TextToImageInvokeRequest extends InferenceRequest, ImageGenerationFields {}
export interface TextToImageHelperRequest extends ImageGenerationFields { logical_model: string; requirements?: HelperModelRequirement;
  trace_id?: string; execution_mode?: AiccExecutionMode; disable?: ModelDisable; policy?: RoutePolicy;
  idempotency_key?: string; task_options?: AiTaskOptions; session_overlay?: AiccRouteOverlay; session_id?: string }
export interface TextToImageInvokeResponse extends InferenceResponse { images?: ResourceRef[]; provider_states?: AiContent[] }

export type EmbeddingTextItem = { type: 'text'; text: string; id?: string } | { type: 'resource'; resource: ResourceRef; id?: string }
export interface EmbeddingMultimodalItem { id: string; text?: string; image?: ResourceRef }
export interface EmbeddingChunking { strategy?: string; max_tokens?: number; overlap_tokens?: number }
export interface EmbeddingValue { index: number; id?: string; embedding: number[]; embedding_space_id: string }
export interface EmbeddingTextRequest extends InferenceRequest { items: EmbeddingTextItem[]; chunking?: EmbeddingChunking;
  embedding_space_id?: string; dimensions?: number; normalize?: boolean; prefer_artifact?: JsonValue }
export interface EmbeddingMultimodalRequest extends InferenceRequest { items: EmbeddingMultimodalItem[]; dimensions?: number; normalize?: boolean }
export interface EmbeddingTextResponse extends InferenceResponse { data?: EmbeddingValue[]; data_resource?: ResourceRef }
export type EmbeddingMultimodalResponse = EmbeddingTextResponse
export type DecisionText = string | JsonValue[] | { [key: string]: JsonValue }
export type DecisionQuestionType = 'choice' | 'score' | 'boolean'
export interface DecisionOption { id: string; description: DecisionText | null }
export interface DecisionBooleanCriteria { true?: DecisionText; false?: DecisionText }
export type DecisionQuestion =
  | { type: 'choice'; id: string; instructions: DecisionText; options: DecisionOption[] }
  | { type: 'score'; id: string; instructions: DecisionText; levels: DecisionText[] }
  | { type: 'boolean'; id: string; instructions: DecisionText; criteria?: DecisionBooleanCriteria }
export type DecisionAnswer =
  | { type: 'choice'; id: string; selected: string; probabilities: Record<string, number>; confidence?: number }
  | { type: 'score'; id: string; score: number; levels: DecisionText[]; probabilities: Record<string, number>; confidence?: number }
  | { type: 'boolean'; id: string; probability_true: number; confidence?: number }
export interface DecisionEvaluateRequest extends InferenceRequest { state: DecisionText; questions: DecisionQuestion[] }
export interface DecisionEvaluateResponse extends InferenceResponse { answers?: DecisionAnswer[]; model?: string }
export interface DecisionRequirements { question_types?: DecisionQuestionType[]; structured_state?: boolean; structured_rules?: boolean;
  question_count?: number; max_options?: number; max_levels?: number; input_bytes?: number; max_state_question_bytes?: number }

export interface RerankDocument { id: string; text?: string; resource?: ResourceRef; metadata?: JsonValue }
export interface RerankResult { index: number; id: string; score: number; document?: RerankDocument }
export interface RerankRequest extends InferenceRequest { query: string; documents: RerankDocument[]; n?: number; return_documents?: boolean }
export interface RerankResponse extends InferenceResponse { results?: RerankResult[] }
export interface ImageToImageRequest extends InferenceRequest { images: ResourceRef[]; prompt: string; strength?: number; output?: AiOutputOptions }
export interface ImageInpaintRequest extends InferenceRequest { image: ResourceRef; mask: ResourceRef; prompt: string;
  mask_semantics?: 'white_area_is_edit_area' | 'black_area_is_edit_area' | 'alpha_zero_is_edit_area'; output?: AiOutputOptions }
export interface ImageUpscaleRequest extends InferenceRequest { image: ResourceRef; scale?: number; target_width?: number;
  target_height?: number; preserve_faces?: boolean; output?: AiOutputOptions }
export interface ImageBackgroundRemoveRequest extends InferenceRequest { image: ResourceRef; mode?: string; output?: AiOutputOptions }
export interface ImageToImageResponse extends InferenceResponse { images?: ResourceRef[]; provider_states?: AiContent[] }
export type ImageInpaintResponse = ImageToImageResponse
export interface ImageUpscaleResponse extends InferenceResponse { image?: ResourceRef }
export type ImageBackgroundRemoveResponse = ImageUpscaleResponse
export interface BoundingBox { format: 'xywh'; unit: 'px' | 'relative'; x: number; y: number; width: number; height: number }
export interface OcrLine { text: string; confidence?: number }
export interface OcrBlock { type: string; bbox: BoundingBox; lines?: OcrLine[] }
export interface OcrPage { page_index: number; width: number; height: number; blocks?: OcrBlock[] }
export interface VisionOcrRequest extends InferenceRequest { document: ResourceRef; level?: string; language_hints?: string[];
  return_layout?: boolean; return_artifacts?: string[] }
export interface VisionOcrResponse extends InferenceResponse { text?: string; pages?: OcrPage[]; artifacts?: Record<string, ResourceRef> }
export interface Caption { text: string; confidence?: number }
export interface VisionCaptionRequest extends InferenceRequest { image: ResourceRef; style?: string; language?: string; n?: number }
export interface VisionCaptionResponse extends InferenceResponse { captions?: Caption[] }
export interface Detection { label: string; class_id?: string; score: number; bbox: BoundingBox }
export interface VisionDetectRequest extends InferenceRequest { image: ResourceRef; classes?: string[]; score_threshold?: number;
  bbox_spec?: { format: 'xywh'; unit: 'px' | 'relative' } }
export interface VisionDetectResponse extends InferenceResponse { detections?: Detection[] }
export type SegmentationPrompt = { type: 'box'; bbox: BoundingBox } | { type: 'point'; x: number; y: number; label?: string } | { type: 'text'; text: string }
export type AiMask = { format: 'rle'; size: [number, number]; counts: string } | { format: 'polygon'; points: [number, number][] } |
  { format: 'bitmap_resource'; resource: ResourceRef }
export interface SegmentationMask { id: string; score: number; bbox?: BoundingBox; mask: AiMask }
export interface VisionSegmentRequest extends InferenceRequest { image: ResourceRef; prompt: SegmentationPrompt; mask_format?: string;
  return_bitmap_mask?: boolean }
export interface VisionSegmentResponse extends InferenceResponse { masks?: SegmentationMask[] }
export interface VoiceSpec { voice_id?: string; language?: string; gender?: string; style?: string; speaker_similarity_required?: boolean }
export interface AudioTextToSpeechRequest extends InferenceRequest { text: string; voice: VoiceSpec; speed?: number; output?: AiOutputOptions }
export interface AudioTextToSpeechResponse extends InferenceResponse { audio?: ResourceRef }
export interface AsrSegment { id: string; start_seconds: number; end_seconds: number; text: string; speaker?: string; confidence?: number }
export interface AudioSpeechRecognitionRequest extends InferenceRequest { audio: ResourceRef; language?: string; timestamps?: string;
  diarization?: boolean; output_formats?: string[] }
export interface AudioSpeechRecognitionResponse extends InferenceResponse { text?: string; segments?: AsrSegment[];
  artifacts?: Record<string, ResourceRef>; diagnostic?: JsonValue }
export interface MusicSection { name: string; start_seconds: number; end_seconds: number }
export interface MusicStructure { lyrics?: string; sections?: MusicSection[] }
export interface AudioMusicRequest extends InferenceRequest { prompt: string; duration_seconds?: number; instrumental?: boolean;
  lyrics?: string; seed?: number; output?: AiOutputOptions }
export interface AudioMusicResponse extends InferenceResponse { audio?: ResourceRef; structure?: MusicStructure }
export interface AudioEnhanceRequest extends InferenceRequest { audio: ResourceRef; task: string; strength?: number; return_stems?: boolean }
export interface AudioEnhanceResponse extends InferenceResponse { audio?: ResourceRef; stems?: ResourceRef[] }
export interface TimeRange { start_seconds: number; end_seconds: number }
/** Video generation inputs (doc/aicc/video_generation.md); `id` is referenced from the prompt as `@{id}`. */
export type KeyframePosition = 'start' | 'end'
export type VideoCondition =
  | { type: 'reference_image'; id: string; resource: ResourceRef }
  | { type: 'reference_video'; id: string; resource: ResourceRef; time_range?: TimeRange; include_audio?: boolean }
  | { type: 'reference_audio'; id: string; resource: ResourceRef; time_range?: TimeRange }
  | { type: 'keyframe'; id: string; resource: ResourceRef; position: KeyframePosition }
export type VideoConditionKind = VideoCondition['type']
export type VideoSize = { short_edge: number } | { width: number; height: number }
export type VideoAudioMode = 'auto' | 'generate' | 'none'
export interface VideoOutputSpec { duration_seconds?: number; aspect_ratio?: string; size?: VideoSize; fps?: number;
  audio?: VideoAudioMode; media_type?: string }
/** What a video request demands of a model; used by `route.resolve`, helpers and routing alike. */
export interface VideoGenerationRequirement { prompt?: boolean; negative_prompt?: boolean; seed?: boolean;
  reference_images?: number; reference_videos?: number; reference_audios?: number; keyframes?: KeyframePosition[];
  reference_video_audio?: boolean; time_ranges?: boolean; output?: VideoOutputSpec }
interface VideoGenerationFields { prompt?: string; negative_prompt?: string; conditions?: VideoCondition[];
  output?: VideoOutputSpec; seed?: number }
export interface VideoGenerateRequest extends InferenceRequest, VideoGenerationFields {}
export interface VideoGenerateHelperRequest extends VideoGenerationFields { logical_model: string; requirements?: HelperModelRequirement;
  trace_id?: string; execution_mode?: AiccExecutionMode; disable?: ModelDisable; policy?: RoutePolicy;
  idempotency_key?: string; task_options?: AiTaskOptions; session_overlay?: AiccRouteOverlay; session_id?: string }
export interface VideoEditRequest extends InferenceRequest { video: ResourceRef; prompt: string; output?: VideoOutputSpec }
export interface VideoExtendRequest extends InferenceRequest { video: ResourceRef; prompt: string; continuation_handle?: string;
  duration_seconds?: number; resolution?: string }
export interface VideoUpscaleRequest extends InferenceRequest { video: ResourceRef; target_resolution: string; denoise?: boolean;
  sharpen?: number; output?: AiOutputOptions }
export interface VideoMetadata { duration_seconds?: number; width?: number; height?: number; fps?: number; has_audio?: boolean }
export interface VideoDeviation { field: string; requested: JsonValue; actual: JsonValue; source: 'provider' | 'measured' }
/** `provider_metadata` is what the Provider reported; `measured_metadata` is read from the file by AICC when it had the bytes. */
export interface GeneratedVideo { resource: ResourceRef; media_type?: string; provider_metadata: VideoMetadata;
  measured_metadata?: VideoMetadata; last_frame?: ResourceRef; deviations?: VideoDeviation[] }
export interface VideoResponse extends InferenceResponse { videos?: GeneratedVideo[] }
export type VideoGenerateResponse = VideoResponse
export type VideoEditResponse = VideoResponse
export type VideoExtendResponse = VideoResponse
export type VideoUpscaleResponse = VideoResponse
export interface ComputerEnvironment { environment_id: string; session_id: string; screenshot: ResourceRef; viewport: { width: number; height: number } }
export type ComputerAction = { type: 'screenshot' } | { type: 'left_click' | 'right_click'; x: number; y: number } |
  { type: 'type'; text: string } | { type: 'key'; key: string } | { type: 'scroll'; delta_x: number; delta_y: number } |
  { type: 'wait'; duration_ms: number }
export interface ComputerUseRequest extends InferenceRequest { task: string; environment: ComputerEnvironment; allowed_actions: string[] }
export interface ComputerUseResponse extends InferenceResponse { actions?: ComputerAction[]; requires_next_observation?: boolean }

export type EmptyRequest = Record<string, never>
export type ServiceReloadSettingsRequest = EmptyRequest
export type RoutingGetRequest = EmptyRequest
/** `use` (default): what the caller may use; `manage` (admin): the whole inventory, each model marked `accessible`. */
export type AiccListView = 'use' | 'manage'
export interface ListModelsRequest { view?: AiccListView }
export type ProviderCatalogRequest = EmptyRequest
export type ProtocolAdapterListRequest = EmptyRequest
export type DriverMetadataUpdateGetReq = EmptyRequest
export interface CancelRequest { task_id: string }
export interface ServiceReloadSettingsResponse { ok: boolean; settings_revision: number }
export type QuotaRuleSource = 'admin' | 'user'
export type QuotaObject = { type: 'user'; user_id: string } | { type: 'app'; app_id: string } |
  { type: 'user_app'; user_id: string; app_id: string }
export type QuotaResource = { type: 'all' } | { type: 'provider'; provider_instance_name: string } |
  { type: 'model'; exact_model: string } | { type: 'hidden' }
export type QuotaPeriod = '4h' | '24h' | '72h' | 'week'
export type QuotaKind = 'periodic' | 'total'
export type QuotaStatus = 'normal' | 'near_limit' | 'exhausted' | 'forbidden' | 'disabled' | 'resource_unavailable'
export interface QuotaPendingPeriod { period: QuotaPeriod; effective_at_ms: number; conflict?: boolean }
export interface QuotaRule { rule_id: string; source: QuotaRuleSource; object: QuotaObject; resource: QuotaResource; kind: QuotaKind;
  period?: QuotaPeriod; limit_tokens?: number; account_id?: string; enabled: boolean; deleted?: boolean;
  pending_period?: QuotaPendingPeriod; version: number; created_by: string; created_at_ms: number; updated_by: string; updated_at_ms: number }
export interface QuotaUsageState { status: QuotaStatus; window_start_ms?: number; window_end_ms?: number; reset_at_ms: number | null;
  limit_tokens?: number; granted_tokens?: number; account_start_ms?: number; settled_tokens: number; reserved_tokens: number;
  pending_tokens: number; available_tokens: number; debt_tokens: number; updated_at_ms: number }
export interface QuotaRuleView { rule: QuotaRule; state: QuotaUsageState; editable: boolean }
export interface QuotaQueryRequest { app_id?: string }
export interface QuotaQueryResponse { user_id: string; rules: QuotaRuleView[]; near_limit_count: number; exhausted_count: number }
export interface QuotaRuleListRequest { scope?: 'mine' | 'manage'; include_deleted?: boolean }
export interface QuotaRuleListResponse { rules: QuotaRuleView[] }
export interface QuotaAuditRecord { audit_id: string; target_type: string; target_id: string; action: string; operator: string;
  before?: JsonValue; after?: JsonValue; created_at_ms: number }
export interface QuotaGrantRecord { grant_id: string; account_id: string; kind: 'initial' | 'recharge'; amount_tokens: number;
  operator: string; note?: string; created_at_ms: number }
export interface QuotaAccountView { account_id: string; object: QuotaObject; resource: QuotaResource; granted_tokens: number;
  settled_tokens: number; reserved_tokens: number; pending_tokens: number; available_tokens: number; debt_tokens: number;
  start_at_ms: number; version: number; updated_at_ms: number; enforced: boolean }
export interface QuotaRuleDetail { rule: QuotaRuleView; constraints: QuotaRuleView[]; blocking_rule_ids: string[];
  account?: QuotaAccountView; grants?: QuotaGrantRecord[]; audit?: QuotaAuditRecord[] }
export interface QuotaRuleDraft { source?: QuotaRuleSource; object: QuotaObject; resource: QuotaResource; kind: QuotaKind;
  period?: QuotaPeriod; limit_tokens?: number; initial_tokens?: number }
export interface QuotaRulePreviewResponse { state: QuotaUsageState; existing_account?: QuotaAccountView; conflict_rule_id?: string;
  other_constraints: QuotaRuleView[] }
export interface QuotaRuleUpdateRequest { rule_id: string; expected_version: number; limit_tokens?: number; period?: QuotaPeriod;
  enabled?: boolean; cancel_pending_period?: boolean }
export interface QuotaRechargeRequest { account_id: string; recharge_id: string; amount_tokens: number; note?: string }
export interface QuotaRechargeResponse { recharge: QuotaGrantRecord; account: QuotaAccountView; replayed: boolean }
export interface QuotaBlockingRule { rule_id: string; source: QuotaRuleSource; object: QuotaObject; resource: QuotaResource;
  kind: QuotaKind; period?: QuotaPeriod; state: QuotaUsageState; recoverable: boolean }
/** `details` of `quota_exhausted` / `quota_budget_exceeded`. */
export interface QuotaDenialDetails { required_tokens: number; max_allowed_tokens: number; provider_instance_name: string;
  exact_model: string; blocking: QuotaBlockingRule[]; reset_at_ms: number | null }
export type VisibilityEntry = { type: 'all_providers' } | { type: 'provider_all_models'; provider_instance_name: string } |
  { type: 'provider_models'; provider_instance_name: string; exact_models: string[] }
export interface VisibilitySubjectPolicy { subject: string; entries: VisibilityEntry[]; updated_by: string; updated_at_ms: number }
export interface VisibilityGetResponse { revision: number; subjects: VisibilitySubjectPolicy[];
  providers: { provider_instance_name: string; enabled: boolean; exact_models: string[] }[]; unexposed_models: string[] }
export interface VisibilityUpdateRequest { expected_revision: number; subject: string; entries: VisibilityEntry[] }
export interface VisibilityPreviewRequest { user_id?: string; draft?: { subject: string; entries: VisibilityEntry[] } }
export interface VisibilityPreviewResponse { user_id: string;
  grants: { provider_instance_name: string; exact_model?: string; sources: string[] }[];
  added?: string[]; removed?: string[]; affected_users?: string[]; caller_loses?: string[] }
export interface ProviderCatalogEntry { provider_profile_id: string; display_name: string; base_url: string;
  protocol_adapter_id: string; provider_rules_id?: string; model_driver_overrides?: Record<string, string>; ui_hints?: Record<string, JsonValue> }
export interface ProviderCatalogResponse { catalog_revision: number; providers: ProviderCatalogEntry[] }
export type ProtocolAdapterStatus = 'stable' | 'preview' | 'deprecated'
export type ProtocolExecutionMode = 'immediate' | 'stream' | 'native_task'
export interface ProtocolAdapterOperation { operation_id: string; api_types: ApiType[]; capabilities: Capability[];
  supported_features: string[]; execution_modes: ProtocolExecutionMode[]; supports_cancel: boolean; supports_webhook: boolean }
export interface ProtocolAdapterView { default_operations?: Record<string, string>; protocol_family_id: string; protocol_adapter_id: string; interface_generation: string;
  status: ProtocolAdapterStatus; probe_priority: number; base_adapter_id?: string; operations: ProtocolAdapterOperation[] }
export interface ProtocolAdapterListResponse { adapters: ProtocolAdapterView[] }
interface ProviderConfig { provider_type: string; provider_profile_id: string; protocol_family_id?: string; protocol_adapter_id?: string;
  base_url: string; credentials: JsonValue; region?: string; workspace?: string; account?: string; provider_rules_id?: string;
  auth?: JsonValue; discovery?: JsonValue; instance_rules?: JsonValue; timeout_ms?: number; auto_sync_models?: boolean }
export interface ProviderValidateRequest extends ProviderConfig { provider_instance_name?: string }
export type ProviderValidationErrorKind = 'configuration' | 'base_url' | 'authentication' | 'protocol' | 'models' | 'balance'
export interface ProviderValidationErrorDetail { kind: ProviderValidationErrorKind; message: string }
export interface FilteredProviderCapability { provider_model_id: string; protocol_adapter_id: string; api_type: string;
  operation_id: string | null; reason: string }
export interface ProviderValidateResponse { filtered_capabilities: FilteredProviderCapability[]; models_recognized: string[]; unmatched_models: JsonValue[]; unavailable_presets: JsonValue[]; routing_candidates: Record<string, string[]>; warnings: string[]; base_url_reachable: boolean; auth_valid: boolean; models_discovered: string[];
  balance_available: boolean; errors: string[]; error_details: ProviderValidationErrorDetail[]; resolved_protocol_adapter_id?: string }
export interface ProviderAddRequest extends ProviderConfig { provider_instance_name: string }
export interface ProviderReloadResult { ok: boolean; providers_registered: number }
export interface ProviderAddResponse { ok: boolean; provider_instance_name: string; settings_revision: number; reload: ProviderReloadResult }
export interface ProviderDeleteRequest { provider_instance_name: string }
export interface ProviderDeleteResponse { ok: boolean; provider_instance_name?: string; settings_revision?: number; reload?: ProviderReloadResult; reason?: string }
export interface ProviderRefreshModelsRequest { provider_instance_name: string }
export interface ProviderRefreshModelsResponse { ok: boolean; provider_instance_name: string; inventory_revision: string }
export interface ProviderListRequest { method?: string; view?: AiccListView }
export type ProviderInstanceAuthMode = 'api_key' | 'dynamic_login'
export interface ProviderInstanceAuthView { mode?: ProviderInstanceAuthMode; credential_kind?: string; configured: boolean }
export type ProviderInstanceInventoryState = 'disabled' | 'not_loaded' | 'loaded'
export interface ProviderInstanceInventoryView { filtered_capabilities: FilteredProviderCapability[]; state: ProviderInstanceInventoryState; revision?: string; model_count: number;
  updated_at_ms?: number }
export type ProviderInstanceHealthState = 'disabled' | 'not_loaded' | 'unknown' | 'healthy' | 'degraded' | 'unavailable'
export interface ProviderInstanceHealthView { state: ProviderInstanceHealthState; checked_at_ms?: number }
export interface ProviderInstanceView {
  discovered_model_ids?: string[]; rules_catalog?: JsonValue;
  resolved_model_rules?: Record<string, JsonValue>;
  provider_rules_id?: string; instance_rules?: JsonValue; provider_instance_name: string; provider_type: string; provider_profile_id: string;
  protocol_adapter_id: string; base_url: string; enabled: boolean; auth: ProviderInstanceAuthView;
  inventory: ProviderInstanceInventoryView; health: ProviderInstanceHealthView }
export interface ProviderListResponse { providers: ProviderInstanceView[]; settings_revision: number; inventory_revision: string }
export interface ProviderHealthRequest { exact_model: string }
export interface ProviderHealthResponse { health: JsonValue }
export interface ProviderUpdateRequest { provider_rules_id?: string; provider_instance_name: string; settings_revision: number; enabled?: boolean; base_url?: string;
  credential?: JsonValue; provider_profile_id?: string; protocol_adapter_id?: string; discovery?: JsonValue; instance_rules?: JsonValue }
export interface ProviderUpdateResponse { ok: boolean; settings_revision: number; provider?: JsonValue }
export interface CancelResponse { task_id: string; accepted: boolean }
export type UsageQueryTimeRange = { kind: 'last1d' | 'last7d' | 'last30d' } | { kind: 'explicit'; start_time_ms: number; end_time_ms: number }
export interface UsageQueryFilters { tenant_ids?: string[]; user_ids?: string[]; caller_app_ids?: string[]; caller_app_query?: string;
  request_models?: string[]; provider_models?: string[]; provider_model_query?: string; provider_instance_names?: string[];
  provider_instance_query?: string; capabilities?: string[]; task_ids?: string[]; idempotency_keys?: string[]; methods?: string[] }
export type UsageQueryGroup = 'provider_model' | 'provider_instance_name' | 'request_model' | 'method' | 'capability' |
  'caller_app_id' | 'user_id' | 'tenant_id'
export interface QueryUsageRequest { time_range: UsageQueryTimeRange; filters?: UsageQueryFilters; group_by?: UsageQueryGroup[];
  time_bucket?: 'hour' | 'day'; output_mode?: 'summary' | 'events' | 'summary_and_events'; limit?: number; cursor?: string;
  /** Admins only: every user of the Zone instead of the caller alone. */
  zone_wide?: boolean }
export interface UsageAggregate { total_requests: number; input_tokens: number; output_tokens: number; total_tokens: number;
  consumed_request_units: number; finance_totals: Money[]; finance_complete: boolean }
export interface AiccUsageEvent { event_id: string; tenant_id: string; user_id: string; caller_app_id?: string; task_id: string;
  trace_id?: string; idempotency_key?: string; method: AiccAiMethod; capability: string; request_model: string; provider_instance_name: string;
  provider_model: string; input_tokens?: number; output_tokens?: number; total_tokens?: number; request_units?: number;
  usage_json: AiUsage; finance_snapshot_json?: JsonValue; operator_id?: string; attribution?: JsonValue; created_at_ms: number }
export interface UsageGroupedRow { group: Record<string, string>; aggregate: UsageAggregate }
export interface UsageBucketedRow { bucket_start_ms: number; group?: Record<string, string>; aggregate: UsageAggregate }
export interface QueryUsageResponse { total: UsageAggregate; grouped?: UsageGroupedRow[];
  buckets?: UsageBucketedRow[];
  events?: AiccUsageEvent[]; next_cursor?: string }
export interface AiccRouteTraceEvent { trace_id: string; tenant_id: string; caller_app_id?: string; task_id: string;
  request_model: string; selected_exact_model?: string; provider_instance_name?: string; api_type: string;
  route_trace_json: RouteTrace; created_at_ms: number }
export interface QueryRouteTraceRequest { limit?: number; cursor?: string; start_time_ms?: number; end_time_ms?: number;
  task_ids?: string[]; request_ids?: string[]; api_types?: string[]; provider_instance_names?: string[];
  selected_exact_models?: string[]; scheduler_profiles?: string[]; query?: string; outcome?: string }
export interface QueryRouteTraceResponse { traces?: JsonValue[]; next_cursor?: string; total_count?: number }
export interface RoutingPreviewRequest { paths?: string[]; explain?: boolean; requirements?: ModelRequirement }
export interface RoutingPreviewEntry { path: string; api_type: ApiType; kind: 'task' | 'spec' | 'family' | 'directory'; available: boolean; selected_exact_model?: string; error?: string; trace?: JsonValue }
export interface RoutingPreviewResponse { settings_revision: number; entries: RoutingPreviewEntry[] }
export interface RoutingGetResponse { settings_revision: number; routing: AiccRouteOverlay }
export interface RoutingUpdateRequest { settings_revision: number; provider_weights: Record<string, number> }
export interface RoutingUpdateResponse { ok: boolean; settings_revision: number; routing: AiccRouteOverlay }
export interface DriverMetadataUpdateSetReq { enabled: boolean; source_url?: string; interval_secs?: number }
export type DriverMetadataUpdateStatus = 'disabled' | 'idle' | 'updating' | 'healthy' | 'degraded' | 'error'
export interface DriverMetadataProviderStatus { provider_instance_name: string; metadata_applied_seq: number }
export interface DriverMetadataUpdateView { enabled: boolean; source_url?: string | null; source_configured: boolean;
  interval_secs: number; metadata_target_seq: number; providers: DriverMetadataProviderStatus[];
  status: DriverMetadataUpdateStatus; active_revision?: number | null;
  last_attempt_at_ms?: number | null; last_success_at_ms?: number | null; last_error?: string | null; consecutive_failures: number }
export interface DriverMetadataRuntimeApply { ok: boolean; refresh_scheduled?: boolean; error?: string }
export interface DriverMetadataUpdateSetResponse { ok: boolean; settings_revision: number; settings: DriverMetadataUpdateView;
  runtime_apply: DriverMetadataRuntimeApply }

const AI_METHOD_SET = new Set<string>(Object.values(AICC_AI_METHODS))
export function isAiccAiMethod(method: string): method is AiccAiMethod { return AI_METHOD_SET.has(method) }
export function aiccTextMessage(role: AiRole, text: string): AiMessage { return { role, content: [{ type: 'text', text }] } }
export function aiccMessageTextContent(message: AiMessage): string {
  return message.content.filter((b): b is Extract<AiContent, { type: 'text' }> => b.type === 'text').map(b => b.text).join('\n')
}
export function aiccMessageFirstText(message: AiMessage): string | undefined {
  return message.content.find((b): b is Extract<AiContent, { type: 'text' }> => b.type === 'text')?.text
}
export function validateAiccMessage(message: AiMessage): void {
  const allowed: Record<AiRole, string[]> = { system: ['text'], developer: ['text'], user: ['text', 'image', 'document'],
    assistant: ['text', 'image', 'document', 'tool_use', 'thinking', 'provider_state'], tool: ['tool_result'] }
  if (!message || !Array.isArray(message.content) || !allowed[message.role]) throw new RPCError('invalid AiMessage')
  if (message.role === 'tool' && (message.content.length !== 1 || message.content[0].type !== 'tool_result')) {
    throw new RPCError('role Tool requires exactly one ToolResult block')
  }
  for (const block of message.content) {
    if (!allowed[message.role].includes(block.type)) throw new RPCError(`AiMessage role ${message.role} cannot contain ${block.type} content`)
    if ((block.type === 'tool_use' || block.type === 'tool_result') && !block.call_id) throw new RPCError(`${block.type} requires call_id`)
    if (block.type === 'tool_result' && block.content.length === 0) throw new RPCError('tool_result requires non-empty content')
  }
}
function exact(value: string) {
  if (!value || value.split('@').length !== 2 || value.startsWith('@') || value.endsWith('@')) {
    throw new RPCError('exact_model must be `<provider_model_id>[:<variant>]@<provider_instance_name>`')
  }
}
function logical(value: string) {
  if (!value?.trim() || value.includes('@')) throw new RPCError('logical_model must be a non-empty logical path without `@`')
}
function strict(request: object, allowed: readonly string[]) {
  for (const key of Object.keys(request)) if (!allowed.includes(key)) throw new RPCError(`unknown field \`${key}\``)
  const mode = (request as { execution_mode?: unknown }).execution_mode
  if (mode !== undefined && mode !== AICC_EXECUTION_MODES.IMMEDIATE && mode !== AICC_EXECUTION_MODES.STREAM) {
    throw new RPCError('execution_mode must be `immediate` or `stream`')
  }
  const sessionId = (request as { session_id?: unknown }).session_id
  if (sessionId !== undefined && (typeof sessionId !== 'string' || !sessionId.trim() || new TextEncoder().encode(sessionId).length > 512)) {
    throw new RPCError('session_id must contain 1..512 bytes')
  }
}
const common = ['exact_model', 'trace_id', 'execution_mode', 'idempotency_key', 'task_options', 'session_id']
const schemas: Partial<Record<AiccMethod, string[]>> = {
  [AICC_AI_METHODS.CHAT_COMPLETIONS_CREATE]: [...common, 'web_search', 'messages', 'tools', 'response_format', 'temperature', 'top_p', 'max_output_tokens', 'seed', 'stop', 'output'],
  [AICC_AI_METHODS.IMAGES_GENERATE]: [...common, 'prompt', 'negative_prompt', 'n', 'aspect_ratio', 'size', 'quality', 'style', 'seed', 'output'],
  [AICC_AI_METHODS.EMBEDDING_TEXT]: [...common, 'items', 'chunking', 'embedding_space_id', 'dimensions', 'normalize', 'prefer_artifact'],
  [AICC_AI_METHODS.EMBEDDING_MULTIMODAL]: [...common, 'items', 'dimensions', 'normalize'],
  [AICC_AI_METHODS.DECISION_EVALUATE]: [...common, 'state', 'questions'],
  [AICC_AI_METHODS.RERANK]: [...common, 'query', 'documents', 'n', 'return_documents'],
  [AICC_AI_METHODS.IMAGE_IMG2IMG]: [...common, 'images', 'prompt', 'strength', 'output'],
  [AICC_AI_METHODS.IMAGE_INPAINT]: [...common, 'image', 'mask', 'prompt', 'mask_semantics', 'output'],
  [AICC_AI_METHODS.IMAGE_UPSCALE]: [...common, 'image', 'scale', 'target_width', 'target_height', 'preserve_faces', 'output'],
  [AICC_AI_METHODS.IMAGE_BG_REMOVE]: [...common, 'image', 'mode', 'output'],
  [AICC_AI_METHODS.VISION_OCR]: [...common, 'document', 'level', 'language_hints', 'return_layout', 'return_artifacts'],
  [AICC_AI_METHODS.VISION_CAPTION]: [...common, 'image', 'style', 'language', 'n'],
  [AICC_AI_METHODS.VISION_DETECT]: [...common, 'image', 'classes', 'score_threshold', 'bbox_spec'],
  [AICC_AI_METHODS.VISION_SEGMENT]: [...common, 'image', 'prompt', 'mask_format', 'return_bitmap_mask'],
  [AICC_AI_METHODS.AUDIO_TTS]: [...common, 'text', 'voice', 'speed', 'output'],
  [AICC_AI_METHODS.AUDIO_ASR]: [...common, 'audio', 'language', 'timestamps', 'diarization', 'output_formats'],
  [AICC_AI_METHODS.AUDIO_MUSIC]: [...common, 'prompt', 'duration_seconds', 'instrumental', 'lyrics', 'seed', 'output'],
  [AICC_AI_METHODS.AUDIO_ENHANCE]: [...common, 'audio', 'task', 'strength', 'return_stems'],
  [AICC_AI_METHODS.VIDEO_GENERATE]: [...common, 'prompt', 'negative_prompt', 'conditions', 'output', 'seed'],
  [AICC_AI_METHODS.VIDEO_EDIT]: [...common, 'video', 'prompt', 'output'],
  [AICC_AI_METHODS.VIDEO_EXTEND]: [...common, 'video', 'prompt', 'continuation_handle', 'duration_seconds', 'resolution'],
  [AICC_AI_METHODS.VIDEO_UPSCALE]: [...common, 'video', 'target_resolution', 'denoise', 'sharpen', 'output'],
  [AICC_AI_METHODS.AGENT_COMPUTER_USE]: [...common, 'task', 'environment', 'allowed_actions'],
  [AICC_CORE_METHODS.ROUTE_RESOLVE]: ['trace_id', 'execution_mode', 'request_id', 'api_type', 'logical_model', 'requirements', 'disable', 'policy', 'estimated_input_tokens', 'estimated_output_tokens', 'session_overlay', 'session_id'],
  [AICC_CORE_METHODS.HELPER_LLM_CHAT]: ['logical_model', 'trace_id', 'execution_mode', 'requirements', 'disable', 'policy', 'messages', 'tools', 'response_format', 'temperature', 'top_p', 'max_output_tokens', 'seed', 'stop', 'output', 'idempotency_key', 'task_options', 'session_overlay', 'session_id'],
  [AICC_CORE_METHODS.HELPER_TEXT_TO_IMAGE]: ['logical_model', 'trace_id', 'execution_mode', 'requirements', 'disable', 'policy', 'prompt', 'negative_prompt', 'n', 'aspect_ratio', 'size', 'quality', 'style', 'seed', 'output', 'idempotency_key', 'task_options', 'session_overlay', 'session_id'],
  [AICC_CORE_METHODS.HELPER_VIDEO_GENERATE]: ['logical_model', 'trace_id', 'execution_mode', 'requirements', 'disable', 'policy', 'prompt', 'negative_prompt', 'conditions', 'output', 'seed', 'idempotency_key', 'task_options', 'session_overlay', 'session_id'],
  [AICC_CORE_METHODS.CANCEL]: ['task_id'],
  [AICC_MANAGEMENT_METHODS.SERVICE_RELOAD_SETTINGS]: [],
  [AICC_MANAGEMENT_METHODS.QUOTA_QUERY]: ['app_id'],
  [AICC_MANAGEMENT_METHODS.USAGE_QUERY]: ['time_range', 'filters', 'group_by', 'time_bucket', 'output_mode', 'limit', 'cursor', 'zone_wide'],
  [AICC_MANAGEMENT_METHODS.TRACE_QUERY]: ['limit', 'cursor', 'start_time_ms', 'end_time_ms', 'task_ids', 'request_ids', 'api_types', 'provider_instance_names', 'selected_exact_models', 'scheduler_profiles', 'query', 'outcome'],
  [AICC_MANAGEMENT_METHODS.ROUTING_GET]: [],
  [AICC_MANAGEMENT_METHODS.ROUTING_PREVIEW]: ['paths', 'explain', 'requirements'],
  [AICC_MANAGEMENT_METHODS.ROUTING_UPDATE]: ['settings_revision', 'provider_weights'],
  [AICC_MANAGEMENT_METHODS.PROVIDER_CATALOG]: [],
  [AICC_MANAGEMENT_METHODS.PROTOCOL_ADAPTER_LIST]: [],
  [AICC_MANAGEMENT_METHODS.PROVIDER_VALIDATE]: ['provider_instance_name', 'provider_type', 'provider_profile_id', 'protocol_family_id', 'protocol_adapter_id', 'base_url', 'credentials', 'region', 'workspace', 'account', 'provider_rules_id', 'auth', 'discovery', 'instance_rules', 'timeout_ms', 'auto_sync_models'],
  [AICC_MANAGEMENT_METHODS.PROVIDER_ADD]: ['provider_instance_name', 'provider_type', 'provider_profile_id', 'protocol_family_id', 'protocol_adapter_id', 'base_url', 'credentials', 'region', 'workspace', 'account', 'provider_rules_id', 'auth', 'discovery', 'instance_rules', 'timeout_ms', 'auto_sync_models'],
  [AICC_MANAGEMENT_METHODS.PROVIDER_LIST]: ['method', 'view'],
  [AICC_MANAGEMENT_METHODS.PROVIDER_HEALTH]: ['exact_model'],
  [AICC_MANAGEMENT_METHODS.PROVIDER_UPDATE]: ['provider_rules_id', 'provider_instance_name', 'settings_revision', 'enabled', 'base_url', 'credential', 'provider_profile_id', 'protocol_adapter_id', 'discovery', 'instance_rules'],
  [AICC_MANAGEMENT_METHODS.PROVIDER_DELETE]: ['provider_instance_name'],
  [AICC_MANAGEMENT_METHODS.PROVIDER_REFRESH_MODELS]: ['provider_instance_name'],
  [AICC_MANAGEMENT_METHODS.MODELS_LIST]: ['view'],
  [AICC_MANAGEMENT_METHODS.DRIVER_METADATA_UPDATE_GET]: [],
  [AICC_MANAGEMENT_METHODS.DRIVER_METADATA_UPDATE_SET]: ['enabled', 'source_url', 'interval_secs'],
}

export class AiccClient {
  constructor(private rpcClient: kRPCClient) {}
  setSeq(seq: number) { this.rpcClient.setSeq(seq) }
  private call<R, Q extends object>(method: AiccMethod, request: Q): Promise<R> {
    const schema = schemas[method]
    const params = schema?.includes('execution_mode') && (request as { execution_mode?: unknown }).execution_mode === undefined
      ? { ...request, execution_mode: AICC_EXECUTION_MODES.IMMEDIATE } as Q
      : request
    if (schema) strict(params, schema)
    return this.rpcClient.call<R, Q>(method, params)
  }
  private inference<R, Q extends InferenceRequest>(method: AiccAiMethod, request: Q): Promise<R> {
    exact(request.exact_model)
    return this.call<R, Q>(method, request)
  }
  routeResolve(r: RouteResolveRequest) { logical(r.logical_model); return this.call<RouteResolveResponse, RouteResolveRequest>(AICC_CORE_METHODS.ROUTE_RESOLVE, r) }
  chatCompletionsCreate(r: LlmChatInvokeRequest) { r.messages.forEach(validateAiccMessage); return this.inference<LlmChatInvokeResponse, LlmChatInvokeRequest>(AICC_AI_METHODS.CHAT_COMPLETIONS_CREATE, r) }
  imagesGenerate(r: TextToImageInvokeRequest) { return this.inference<TextToImageInvokeResponse, TextToImageInvokeRequest>(AICC_AI_METHODS.IMAGES_GENERATE, r) }
  helperLlmChat(r: LlmChatHelperRequest) { logical(r.logical_model); r.messages.forEach(validateAiccMessage); return this.call<LlmChatInvokeResponse, LlmChatHelperRequest>(AICC_CORE_METHODS.HELPER_LLM_CHAT, r) }
  helperTextToImage(r: TextToImageHelperRequest) { logical(r.logical_model); return this.call<TextToImageInvokeResponse, TextToImageHelperRequest>(AICC_CORE_METHODS.HELPER_TEXT_TO_IMAGE, r) }
  embeddingText(r: EmbeddingTextRequest) { return this.inference<EmbeddingTextResponse, EmbeddingTextRequest>(AICC_AI_METHODS.EMBEDDING_TEXT, r) }
  embeddingMultimodal(r: EmbeddingMultimodalRequest) { return this.inference<EmbeddingMultimodalResponse, EmbeddingMultimodalRequest>(AICC_AI_METHODS.EMBEDDING_MULTIMODAL, r) }
  async decisionEvaluate(r: DecisionEvaluateRequest) {
    validateDecisionRequest(r)
    const result = await this.inference<DecisionEvaluateResponse, DecisionEvaluateRequest>(AICC_AI_METHODS.DECISION_EVALUATE, r)
    if (result.status === 'succeeded') validateDecisionAnswers(r, result.answers ?? [])
    return result
  }
  rerank(r: RerankRequest) { return this.inference<RerankResponse, RerankRequest>(AICC_AI_METHODS.RERANK, r) }
  imageToImage(r: ImageToImageRequest) { return this.inference<ImageToImageResponse, ImageToImageRequest>(AICC_AI_METHODS.IMAGE_IMG2IMG, r) }
  imageInpaint(r: ImageInpaintRequest) { return this.inference<ImageInpaintResponse, ImageInpaintRequest>(AICC_AI_METHODS.IMAGE_INPAINT, r) }
  imageUpscale(r: ImageUpscaleRequest) { return this.inference<ImageUpscaleResponse, ImageUpscaleRequest>(AICC_AI_METHODS.IMAGE_UPSCALE, r) }
  imageBackgroundRemove(r: ImageBackgroundRemoveRequest) { return this.inference<ImageBackgroundRemoveResponse, ImageBackgroundRemoveRequest>(AICC_AI_METHODS.IMAGE_BG_REMOVE, r) }
  visionOcr(r: VisionOcrRequest) { return this.inference<VisionOcrResponse, VisionOcrRequest>(AICC_AI_METHODS.VISION_OCR, r) }
  visionCaption(r: VisionCaptionRequest) { return this.inference<VisionCaptionResponse, VisionCaptionRequest>(AICC_AI_METHODS.VISION_CAPTION, r) }
  visionDetect(r: VisionDetectRequest) { return this.inference<VisionDetectResponse, VisionDetectRequest>(AICC_AI_METHODS.VISION_DETECT, r) }
  visionSegment(r: VisionSegmentRequest) { return this.inference<VisionSegmentResponse, VisionSegmentRequest>(AICC_AI_METHODS.VISION_SEGMENT, r) }
  audioTextToSpeech(r: AudioTextToSpeechRequest) { return this.inference<AudioTextToSpeechResponse, AudioTextToSpeechRequest>(AICC_AI_METHODS.AUDIO_TTS, r) }
  audioSpeechRecognition(r: AudioSpeechRecognitionRequest) { return this.inference<AudioSpeechRecognitionResponse, AudioSpeechRecognitionRequest>(AICC_AI_METHODS.AUDIO_ASR, r) }
  audioMusic(r: AudioMusicRequest) { return this.inference<AudioMusicResponse, AudioMusicRequest>(AICC_AI_METHODS.AUDIO_MUSIC, r) }
  audioEnhance(r: AudioEnhanceRequest) { return this.inference<AudioEnhanceResponse, AudioEnhanceRequest>(AICC_AI_METHODS.AUDIO_ENHANCE, r) }
  videoGenerate(r: VideoGenerateRequest) { validateVideoGeneration(r); return this.inference<VideoGenerateResponse, VideoGenerateRequest>(AICC_AI_METHODS.VIDEO_GENERATE, r) }
  helperVideoGenerate(r: VideoGenerateHelperRequest) {
    logical(r.logical_model); validateVideoGeneration(r); videoGenerationRequirement(r)
    return this.call<VideoGenerateResponse, VideoGenerateHelperRequest>(AICC_CORE_METHODS.HELPER_VIDEO_GENERATE, r)
  }
  videoEdit(r: VideoEditRequest) { validateVideoEdit(r); return this.inference<VideoEditResponse, VideoEditRequest>(AICC_AI_METHODS.VIDEO_EDIT, r) }
  videoExtend(r: VideoExtendRequest) { return this.inference<VideoExtendResponse, VideoExtendRequest>(AICC_AI_METHODS.VIDEO_EXTEND, r) }
  videoUpscale(r: VideoUpscaleRequest) { return this.inference<VideoUpscaleResponse, VideoUpscaleRequest>(AICC_AI_METHODS.VIDEO_UPSCALE, r) }
  computerUse(r: ComputerUseRequest) { return this.inference<ComputerUseResponse, ComputerUseRequest>(AICC_AI_METHODS.AGENT_COMPUTER_USE, r) }
  cancel(taskId: string) { if (!taskId) throw new RPCError('cancel requires non-empty task_id'); return this.call<CancelResponse, { task_id: string }>(AICC_CORE_METHODS.CANCEL, { task_id: taskId }) }
  reloadSettings() { return this.call<ServiceReloadSettingsResponse, EmptyRequest>(AICC_MANAGEMENT_METHODS.SERVICE_RELOAD_SETTINGS, {}) }
  queryQuota(r: QuotaQueryRequest = {}) { return this.call<QuotaQueryResponse, QuotaQueryRequest>(AICC_MANAGEMENT_METHODS.QUOTA_QUERY, r) }
  queryUsage(r: QueryUsageRequest) { return this.call<QueryUsageResponse, QueryUsageRequest>(AICC_MANAGEMENT_METHODS.USAGE_QUERY, r) }
  queryTrace(r: QueryRouteTraceRequest = {}) { return this.call<QueryRouteTraceResponse, QueryRouteTraceRequest>(AICC_MANAGEMENT_METHODS.TRACE_QUERY, r) }
  previewRouting(r: RoutingPreviewRequest = {}) { return this.call<RoutingPreviewResponse, RoutingPreviewRequest>(AICC_MANAGEMENT_METHODS.ROUTING_PREVIEW, r) }
  getRouting() { return this.call<RoutingGetResponse, EmptyRequest>(AICC_MANAGEMENT_METHODS.ROUTING_GET, {}) }
  updateRouting(r: RoutingUpdateRequest) { return this.call<RoutingUpdateResponse, RoutingUpdateRequest>(AICC_MANAGEMENT_METHODS.ROUTING_UPDATE, r) }
  providerCatalog() { return this.call<ProviderCatalogResponse, EmptyRequest>(AICC_MANAGEMENT_METHODS.PROVIDER_CATALOG, {}) }
  listProtocolAdapters() { return this.call<ProtocolAdapterListResponse, EmptyRequest>(AICC_MANAGEMENT_METHODS.PROTOCOL_ADAPTER_LIST, {}) }
  validateProvider(r: ProviderValidateRequest) { return this.call<ProviderValidateResponse, ProviderValidateRequest>(AICC_MANAGEMENT_METHODS.PROVIDER_VALIDATE, r) }
  addProvider(r: ProviderAddRequest) { return this.call<ProviderAddResponse, ProviderAddRequest>(AICC_MANAGEMENT_METHODS.PROVIDER_ADD, r) }
  listProviders(r: ProviderListRequest = {}) { return this.call<ProviderListResponse, ProviderListRequest>(AICC_MANAGEMENT_METHODS.PROVIDER_LIST, r) }
  providerHealth(r: ProviderHealthRequest) { exact(r.exact_model); return this.call<ProviderHealthResponse, ProviderHealthRequest>(AICC_MANAGEMENT_METHODS.PROVIDER_HEALTH, r) }
  updateProvider(r: ProviderUpdateRequest) { return this.call<ProviderUpdateResponse, ProviderUpdateRequest>(AICC_MANAGEMENT_METHODS.PROVIDER_UPDATE, r) }
  deleteProvider(r: ProviderDeleteRequest) { return this.call<ProviderDeleteResponse, ProviderDeleteRequest>(AICC_MANAGEMENT_METHODS.PROVIDER_DELETE, r) }
  refreshProviderModels(r: ProviderRefreshModelsRequest) { return this.call<ProviderRefreshModelsResponse, ProviderRefreshModelsRequest>(AICC_MANAGEMENT_METHODS.PROVIDER_REFRESH_MODELS, r) }
  listModels(r: ListModelsRequest = {}) { return this.call<JsonValue, ListModelsRequest>(AICC_MANAGEMENT_METHODS.MODELS_LIST, r) }
  listQuotaRules(r: QuotaRuleListRequest = {}) { return this.call<QuotaRuleListResponse, QuotaRuleListRequest>(AICC_QUOTA_METHODS.RULE_LIST, r) }
  getQuotaRule(ruleId: string) { return this.call<QuotaRuleDetail, { rule_id: string }>(AICC_QUOTA_METHODS.RULE_GET, { rule_id: ruleId }) }
  previewQuotaRule(draft: QuotaRuleDraft) { return this.call<QuotaRulePreviewResponse, { draft: QuotaRuleDraft }>(AICC_QUOTA_METHODS.RULE_PREVIEW, { draft }) }
  createQuotaRule(draft: QuotaRuleDraft) { return this.call<QuotaRuleView, { draft: QuotaRuleDraft }>(AICC_QUOTA_METHODS.RULE_CREATE, { draft }) }
  updateQuotaRule(r: QuotaRuleUpdateRequest) { return this.call<QuotaRuleView, QuotaRuleUpdateRequest>(AICC_QUOTA_METHODS.RULE_UPDATE, r) }
  deleteQuotaRule(ruleId: string, expectedVersion: number) { return this.call<{ ok: boolean; rule_id: string }, { rule_id: string; expected_version: number }>(AICC_QUOTA_METHODS.RULE_DELETE, { rule_id: ruleId, expected_version: expectedVersion }) }
  getQuotaAccount(accountId: string) { return this.call<{ account: QuotaAccountView; grants: QuotaGrantRecord[] }, { account_id: string }>(AICC_QUOTA_METHODS.ACCOUNT_GET, { account_id: accountId }) }
  rechargeQuotaAccount(r: QuotaRechargeRequest) { return this.call<QuotaRechargeResponse, QuotaRechargeRequest>(AICC_QUOTA_METHODS.ACCOUNT_RECHARGE, r) }
  getQuotaRecharge(rechargeId: string) { return this.call<{ recharge?: QuotaGrantRecord; account?: QuotaAccountView }, { recharge_id: string }>(AICC_QUOTA_METHODS.RECHARGE_GET, { recharge_id: rechargeId }) }
  getVisibility() { return this.call<VisibilityGetResponse, EmptyRequest>(AICC_QUOTA_METHODS.VISIBILITY_GET, {}) }
  updateVisibility(r: VisibilityUpdateRequest) { return this.call<VisibilityGetResponse, VisibilityUpdateRequest>(AICC_QUOTA_METHODS.VISIBILITY_UPDATE, r) }
  previewVisibility(r: VisibilityPreviewRequest = {}) { return this.call<VisibilityPreviewResponse, VisibilityPreviewRequest>(AICC_QUOTA_METHODS.VISIBILITY_PREVIEW, r) }
  getDriverMetadataUpdate() { return this.call<DriverMetadataUpdateView, EmptyRequest>(AICC_MANAGEMENT_METHODS.DRIVER_METADATA_UPDATE_GET, {}) }
  setDriverMetadataUpdate(r: DriverMetadataUpdateSetReq) { return this.call<DriverMetadataUpdateSetResponse, DriverMetadataUpdateSetReq>(AICC_MANAGEMENT_METHODS.DRIVER_METADATA_UPDATE_SET, r) }
}

function decisionText(value: unknown, nonempty = true): value is DecisionText {
  if (typeof value === 'string') return !nonempty || value.trim().length > 0
  return value !== null && typeof value === 'object' && (!nonempty || Object.keys(value).length > 0)
}

function decisionId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(value)
}

function decisionJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(decisionJson).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${decisionJson((value as Record<string, unknown>)[key])}`).join(',')}}`
}

function decisionBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length
}

export function decisionRequirements(request: Pick<DecisionEvaluateRequest, 'state' | 'questions'>): ModelRequirement {
  const stateBytes = decisionBytes(request.state)
  const decision: Required<DecisionRequirements> = { question_types: [], structured_state: typeof request.state !== 'string',
    structured_rules: false, question_count: request.questions.length, max_options: 0, max_levels: 0,
    input_bytes: stateBytes + decisionBytes(request.questions), max_state_question_bytes: 0 }
  for (const question of request.questions) {
    if (!decision.question_types.includes(question.type)) decision.question_types.push(question.type)
    const rules: unknown[] = [question.instructions]
    if (question.type === 'choice') {
      decision.max_options = Math.max(decision.max_options, question.options.length)
      rules.push(...question.options.map(option => option.description))
    } else if (question.type === 'score') {
      decision.max_levels = Math.max(decision.max_levels, question.levels.length)
      rules.push(...question.levels)
    } else if (question.criteria) rules.push(...Object.values(question.criteria))
    decision.structured_rules ||= rules.some(value => value !== null && typeof value === 'object')
    decision.max_state_question_bytes = Math.max(decision.max_state_question_bytes, stateBytes + decisionBytes(question))
  }
  return { decision }
}

export function validateDecisionRequest(request: DecisionEvaluateRequest): void {
  exact(request.exact_model)
  strict(request, schemas[AICC_AI_METHODS.DECISION_EVALUATE]!)
  if (!decisionText(request.state, false) || !Array.isArray(request.questions) || !request.questions.length || request.questions.length > 1024) {
    throw new RPCError('decision requires a text/JSON state and 1..1024 questions')
  }
  const ids = new Set<string>()
  for (const question of request.questions) {
    if (!question || !decisionId(question.id) || ids.has(question.id) || !decisionText(question.instructions)) throw new RPCError('invalid decision question')
    ids.add(question.id)
    if (question.type === 'choice') {
      strict(question, ['type', 'id', 'instructions', 'options'])
      if (!Array.isArray(question.options) || !question.options.length || question.options.length > 1024) throw new RPCError('invalid decision options')
      const options = new Set<string>()
      for (const option of question.options) {
        strict(option, ['id', 'description'])
        if (!decisionId(option.id) || options.has(option.id) || !(option.description === null || decisionText(option.description))) throw new RPCError('invalid decision option')
        options.add(option.id)
      }
    } else if (question.type === 'score') {
      strict(question, ['type', 'id', 'instructions', 'levels'])
      if (!Array.isArray(question.levels) || question.levels.length < 2 || question.levels.length > 1024 || question.levels.some(level => !decisionText(level)) || new Set(question.levels.map(decisionJson)).size !== question.levels.length) throw new RPCError('invalid decision levels')
    } else if (question.type === 'boolean') {
      strict(question, ['type', 'id', 'instructions', 'criteria'])
      if (question.criteria !== undefined) {
        if (question.criteria === null || typeof question.criteria !== 'object' || Array.isArray(question.criteria)) throw new RPCError('invalid decision criteria')
        strict(question.criteria, ['true', 'false'])
        if (Object.values(question.criteria).some(value => !decisionText(value))) throw new RPCError('invalid decision criteria')
      }
    } else throw new RPCError('invalid decision question type')
  }
  if (decisionRequirements(request).decision!.input_bytes! > 1024 * 1024) throw new RPCError('decision input exceeds 1 MiB')
}

export function validateDecisionAnswers(request: DecisionEvaluateRequest, answers: DecisionAnswer[]): void {
  const probability = (value: number) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
  const invalid = () => { throw new RPCError('invalid or incomplete decision answers') }
  if (!Array.isArray(answers) || answers.length !== request.questions.length) invalid()
  const ids = new Set<string>()
  for (const answer of answers) {
    if (!answer || ids.has(answer.id)) invalid()
    ids.add(answer.id)
    const question = request.questions.find(question => question.id === answer.id)
    if (!question) throw new RPCError('unknown decision question ID')
    if (question.type !== answer.type || (answer.confidence !== undefined && !probability(answer.confidence))) invalid()
    if (answer.type === 'boolean') {
      strict(answer, ['type', 'id', 'probability_true', 'confidence'])
      if (!probability(answer.probability_true)) invalid()
      continue
    }
    strict(answer, answer.type === 'choice' ? ['type', 'id', 'selected', 'probabilities', 'confidence'] : ['type', 'id', 'score', 'levels', 'probabilities', 'confidence'])
    const keys = question.type === 'choice' ? question.options.map(option => option.id) : question.type === 'score' ? question.levels.map((_, i) => String(i)) : []
    if (!answer.probabilities || Array.isArray(answer.probabilities) || Object.keys(answer.probabilities).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(answer.probabilities, key) || !probability(answer.probabilities[key])) || Math.abs(Object.values(answer.probabilities).reduce((sum, p) => sum + p, 0) - 1) > 1e-4) invalid()
    if (answer.type === 'choice') {
      if (!keys.includes(answer.selected) || Object.values(answer.probabilities).some(p => p > answer.probabilities[answer.selected] + 1e-4)) invalid()
    } else if (answer.type === 'score' && question.type === 'score') {
      const expected = keys.reduce((sum, key, i) => sum + i * answer.probabilities[key], 0)
      if (!Number.isFinite(answer.score) || answer.score < 0 || answer.score > keys.length - 1 || Math.abs(answer.score - expected) > 1e-4 * (keys.length - 1) || decisionJson(answer.levels) !== decisionJson(question.levels)) invalid()
    } else invalid()
  }
}

const VIDEO_MAX_CONDITIONS = 32
const VIDEO_CONDITION_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/
const VIDEO_CONDITION_FIELDS: Record<VideoConditionKind, readonly string[]> = {
  reference_image: ['type', 'id', 'resource'],
  reference_video: ['type', 'id', 'resource', 'time_range', 'include_audio'],
  reference_audio: ['type', 'id', 'resource', 'time_range'],
  keyframe: ['type', 'id', 'resource', 'position'],
}
const KEYFRAME_POSITIONS: readonly KeyframePosition[] = ['start', 'end']

export type VideoPromptSegment = { text: string } | { reference: string }

/** Splits a prompt into text and `@{id}` references; `@@` is a literal `@`, any other `@` stays as written. */
export function parseVideoPrompt(prompt: string): VideoPromptSegment[] {
  const segments: VideoPromptSegment[] = []
  let text = ''
  for (let index = 0; index < prompt.length; index++) {
    const next = prompt[index + 1]
    if (prompt[index] !== '@') text += prompt[index]
    else if (next === '@') { text += '@'; index++ }
    else if (next !== '{') text += '@'
    else {
      const end = prompt.indexOf('}', index + 2)
      if (end < 0) throw new RPCError('prompt reference `@{` is not closed')
      const id = prompt.slice(index + 2, end)
      if (!VIDEO_CONDITION_ID.test(id)) throw new RPCError(`prompt reference \`${id}\` is not a valid condition id`)
      if (text) segments.push({ text })
      text = ''
      segments.push({ reference: id })
      index = end
    }
  }
  if (text) segments.push({ text })
  return segments
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function finiteIn(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > min && value <= max
}

function aspectRatio(value: unknown): [number, number] | undefined {
  const match = typeof value === 'string' ? /^(\d{1,3}):(\d{1,3})$/.exec(value) : null
  const [width, height] = match ? [Number(match[1]), Number(match[2])] : [0, 0]
  return width >= 1 && width <= 100 && height >= 1 && height <= 100 ? [width, height] : undefined
}

function reducedRatio(width: number, height: number): string {
  const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b)
  const divisor = Math.max(gcd(width, height), 1)
  return `${width / divisor}:${height / divisor}`
}

function validateResourceRef(value: unknown, field: string) {
  const fields: Record<string, string[]> = { url: ['kind', 'url', 'mime_hint'], base64: ['kind', 'mime', 'data_base64'], named_object: ['kind', 'obj_id'] }
  if (!isObject(value) || typeof value.kind !== 'string' || !fields[value.kind]) throw new RPCError(`${field} must be a ResourceRef`)
  strict(value, fields[value.kind])
}

export function validateVideoOutput(output: unknown, field = 'output'): asserts output is VideoOutputSpec {
  if (!isObject(output)) throw new RPCError(`${field} must be an object`)
  strict(output, ['duration_seconds', 'aspect_ratio', 'size', 'fps', 'audio', 'media_type'])
  if (output.duration_seconds !== undefined && !finiteIn(output.duration_seconds, 0, 600)) throw new RPCError(`${field}.duration_seconds must be a number in (0, 600]`)
  const ratio = output.aspect_ratio === undefined ? undefined : aspectRatio(output.aspect_ratio)
  if (output.aspect_ratio !== undefined && !ratio) throw new RPCError(`${field}.aspect_ratio must be \`W:H\` with integers in 1..100`)
  const edge = (value: unknown, name: string) => {
    if (!Number.isInteger(value) || (value as number) < 16 || (value as number) > 8192) throw new RPCError(`${field}.size.${name} must be an integer in 16..8192`)
  }
  const size = output.size
  if (size !== undefined) {
    if (!isObject(size)) throw new RPCError(`${field}.size must be { short_edge } or { width, height }`)
    if ('short_edge' in size) { strict(size, ['short_edge']); edge(size.short_edge, 'short_edge') }
    else {
      strict(size, ['width', 'height']); edge(size.width, 'width'); edge(size.height, 'height')
      if (ratio && reducedRatio(size.width as number, size.height as number) !== reducedRatio(...ratio)) throw new RPCError(`${field}.size conflicts with aspect_ratio`)
    }
  }
  if (output.fps !== undefined && !finiteIn(output.fps, 0, 240)) throw new RPCError(`${field}.fps must be a number in (0, 240]`)
  if (output.audio !== undefined && !['auto', 'generate', 'none'].includes(output.audio as string)) throw new RPCError(`${field}.audio must be auto, generate or none`)
  if (output.media_type !== undefined && !(typeof output.media_type === 'string' && /^video\/[a-z0-9.+-]+$/.test(output.media_type))) throw new RPCError(`${field}.media_type must be a lowercase video/* MIME type`)
}

/** Client-side check of the `video.generate` / `helper.video_generate` body, matching the server's validation. */
export function validateVideoGeneration(request: VideoGenerationFields): void {
  const { prompt, negative_prompt: negative, seed } = request
  const conditions: unknown = request.conditions ?? []
  if (prompt !== undefined && typeof prompt !== 'string') throw new RPCError('prompt must be a string')
  if (!Array.isArray(conditions)) throw new RPCError('conditions must be an array')
  if (!prompt?.trim() && !conditions.length) throw new RPCError('video generation requires a non-blank prompt or at least one condition')
  if (negative !== undefined && (typeof negative !== 'string' || !negative.trim())) throw new RPCError('negative_prompt must not be blank when present')
  if (seed !== undefined && !(Number.isSafeInteger(seed) && seed >= 0)) throw new RPCError('seed must be a non-negative integer')
  if (conditions.length > VIDEO_MAX_CONDITIONS) throw new RPCError(`video generation accepts at most ${VIDEO_MAX_CONDITIONS} conditions`)
  const ids = new Set<string>()
  const positions = new Set<string>()
  conditions.forEach((condition: unknown, index: number) => {
    const field = `conditions[${index}]`
    if (!isObject(condition) || !(condition.type as string in VIDEO_CONDITION_FIELDS)) throw new RPCError(`${field}.type must be a video condition type`)
    strict(condition, VIDEO_CONDITION_FIELDS[condition.type as VideoConditionKind])
    if (typeof condition.id !== 'string' || !VIDEO_CONDITION_ID.test(condition.id)) throw new RPCError(`${field}.id must match ${VIDEO_CONDITION_ID}`)
    if (ids.has(condition.id.toLowerCase())) throw new RPCError(`${field}.id \`${condition.id}\` is not unique (compared case-insensitively)`)
    ids.add(condition.id.toLowerCase())
    validateResourceRef(condition.resource, `${field}.resource`)
    if (condition.type === 'keyframe') {
      if (!KEYFRAME_POSITIONS.includes(condition.position as KeyframePosition)) throw new RPCError(`${field}.position must be start or end`)
      if (positions.has(condition.position as string)) throw new RPCError(`${field}: at most one keyframe is allowed per position`)
      positions.add(condition.position as string)
    }
    if (condition.include_audio !== undefined && typeof condition.include_audio !== 'boolean') throw new RPCError(`${field}.include_audio must be a boolean`)
    const range = condition.time_range
    if (range !== undefined) {
      if (!isObject(range)) throw new RPCError(`${field}.time_range must be an object`)
      strict(range, ['start_seconds', 'end_seconds'])
      const { start_seconds: start, end_seconds: end } = range
      if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= end) {
        throw new RPCError(`${field}.time_range must be finite, non-negative and start before it ends`)
      }
    }
  })
  for (const segment of prompt ? parseVideoPrompt(prompt) : []) {
    if ('reference' in segment && !(request.conditions ?? []).some(condition => condition.id === segment.reference)) {
      throw new RPCError(`prompt references unknown condition \`${segment.reference}\``)
    }
  }
  if (request.output !== undefined) validateVideoOutput(request.output)
}

export function validateVideoEdit(request: VideoEditRequest): void {
  if (typeof request.prompt !== 'string' || !request.prompt.trim()) throw new RPCError('video edit requires a non-blank prompt')
  validateResourceRef(request.video, 'video')
  if (request.output !== undefined) validateVideoOutput(request.output)
}

/** The model requirement a video request implies, merged with a helper's `requirements.video` (which can only tighten it). */
export function videoGenerationRequirement(request: VideoGenerationFields & { requirements?: HelperModelRequirement }): VideoGenerationRequirement {
  const conditions = request.conditions ?? []
  const count = (type: VideoConditionKind) => conditions.filter(condition => condition.type === type).length
  const declared = request.requirements?.video ?? {}
  const requirement: VideoGenerationRequirement = {}
  const flag = (key: 'prompt' | 'negative_prompt' | 'seed' | 'reference_video_audio' | 'time_ranges', value: boolean) => {
    if (value || declared[key]) requirement[key] = true
  }
  flag('prompt', !!request.prompt?.trim())
  flag('negative_prompt', request.negative_prompt !== undefined)
  flag('seed', request.seed !== undefined)
  for (const [key, type] of [['reference_images', 'reference_image'], ['reference_videos', 'reference_video'], ['reference_audios', 'reference_audio']] as const) {
    const value = Math.max(count(type), declared[key] ?? 0)
    if (value) requirement[key] = value
  }
  const keyframes = KEYFRAME_POSITIONS.filter(position => declared.keyframes?.includes(position) ||
    conditions.some(condition => condition.type === 'keyframe' && condition.position === position))
  if (keyframes.length) requirement.keyframes = keyframes
  flag('reference_video_audio', conditions.some(condition => condition.type === 'reference_video' && condition.include_audio === true))
  flag('time_ranges', conditions.some(condition => 'time_range' in condition && condition.time_range !== undefined))
  const own = request.output && Object.values(request.output).some(value => value !== undefined) ? request.output : undefined
  if (own && declared.output && decisionJson(own) !== decisionJson(declared.output)) throw new RPCError('requirements.video.output conflicts with the request output')
  if (!own && declared.output) validateVideoOutput(declared.output, 'requirements.video.output')
  if (own ?? declared.output) requirement.output = own ?? declared.output
  return requirement
}
