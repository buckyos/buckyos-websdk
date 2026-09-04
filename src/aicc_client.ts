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

export const AICC_CORE_METHODS = {
  ROUTE_RESOLVE: 'route.resolve',
  HELPER_LLM_CHAT: 'helper.llm_chat',
  HELPER_TEXT_TO_IMAGE: 'helper.text_to_image',
  CANCEL: 'cancel',
} as const

export const AICC_MANAGEMENT_METHODS = {
  SERVICE_RELOAD_SETTINGS: 'service.reload_settings',
  QUOTA_QUERY: 'quota.query',
  USAGE_QUERY: 'usage.query',
  TRACE_QUERY: 'trace.query',
  ROUTING_GET: 'routing.get',
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

export const AICC_METHODS = { ...AICC_AI_METHODS, ...AICC_CORE_METHODS, ...AICC_MANAGEMENT_METHODS } as const
export type AiccAiMethod = typeof AICC_AI_METHODS[keyof typeof AICC_AI_METHODS]
export type AiccMethod = typeof AICC_METHODS[keyof typeof AICC_METHODS]
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export type ApiType = 'llm' | 'embedding.text' | 'embedding.multimodal' | 'rerank' | 'image.txt2img' |
  'image.img2img' | 'image.inpaint' | 'image.upscale' | 'image.bg_remove' | 'vision.ocr' | 'vision.caption' |
  'vision.detect' | 'vision.segment' | 'audio.tts' | 'audio.asr' | 'audio.music' | 'audio.enhance' |
  'video.txt2video' | 'video.img2video' | 'video.video2video' | 'video.extend' | 'video.upscale' | 'agent.computer_use'
export type Capability = 'llm' | 'embedding' | 'rerank' | 'image' | 'vision' | 'audio' | 'video' | 'agent'
export type Feature = string
export const AICC_FEATURES = {
  PLAN: 'plan', TOOL_CALL: 'tool_call', JSON_SCHEMA: 'json_schema', WEB_SEARCH: 'web_search',
  VISION: 'vision', IMAGE_GENERATION: 'image_generation', ASR: 'asr', VIDEO_UNDERSTAND: 'video_understand',
} as const

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
export interface AiUsage { input_tokens?: number; output_tokens?: number; total_tokens?: number; request_units?: number }
export interface Money { amount: number; currency: string }
export type AiCost = Money
export interface AiArtifact { name: string; resource: ResourceRef; mime?: string; metadata?: JsonValue }
export type AiccErrorCode = 'invalid_request' | 'invalid_method' | 'schema_validation_failed' | 'invalid_model_name' |
  'resource_invalid' | 'no_provider_available' | 'no_candidate_model' | 'fallback_not_allowed' | 'provider_start_failed' |
  'provider_error' | 'timeout' | 'budget_exceeded' | 'policy_denied' | 'idempotency_conflict' |
  'settings_revision_conflict' | 'cancelled' | 'internal_error'
export interface AiccError { code: AiccErrorCode; message: string; provider_code?: string; retriable?: boolean; details?: JsonValue }
export interface SettingsRevisionConflictDetails { expected_revision: number; actual_revision: number }
export interface RouteTraceAttempt { step: number; exact_model: string; started_at: string; ended_at?: string;
  outcome: 'succeeded' | 'failed' | 'skipped'; error_code?: AiccErrorCode; fallback_reason?: string }
export interface RouteTrace { attempts: RouteTraceAttempt[]; final_model?: string }
export interface AiToolCall { name: string; args: Record<string, JsonValue>; call_id: string }
export type AiMethodStatus = 'succeeded' | 'running' | 'failed'
export interface AiTaskOptions { parent_id?: string }
export interface AiOutputOptions { media_type?: string; size?: string; sample_rate?: number; fps?: number }
export interface ModelRequirement { streaming?: boolean; tool_call?: boolean; json_schema?: boolean; web_search?: boolean;
  vision?: boolean; image_generation?: boolean; min_context_tokens?: number }
export interface ModelDisable extends ModelRequirement {}
export interface HelperModelRequirement extends ModelRequirement {}
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

export interface RouteResolveRequest { trace_id?: string; request_id?: string; api_type: ApiType; logical_model: string; requirements?: ModelRequirement;
  disable?: ModelDisable; policy?: RoutePolicy; estimated_input_tokens?: number; estimated_output_tokens?: number;
  session_overlay?: AiccRouteOverlay }
export interface RouteResolveResponse { selected_exact_model: string; selected_model_uid: string; provider_instance_name: string;
  provider_profile_id: string; protocol_adapter_id: string; model_driver_id: string; provider_driver?: string;
  origin_model_id: string; provider_model_id: string; operation: string; enabled_capabilities?: Feature[];
  disabled_capabilities?: Feature[]; fallback_attempts?: Array<{ exact_model: string; provider_instance_name: string;
  provider_model_id: string }>; route_trace?: RouteTrace; inventory_revision: string }
export interface InferenceRequest { exact_model: string; trace_id?: string; idempotency_key?: string; task_options?: AiTaskOptions }
export interface InferenceResponse { task_id: string; status: AiMethodStatus; usage?: AiUsage; cost?: AiCost;
  finish_reason?: string; provider_task_ref?: string; route_trace?: RouteTrace; event_ref?: string; error?: AiccError }
interface ChatFields { messages: AiMessage[]; tools?: AiToolSpec[]; response_format?: LlmResponseFormat; temperature?: number;
  top_p?: number; max_output_tokens?: number; seed?: number; stop?: string[]; output?: AiOutputOptions }
interface ImageGenerationFields { prompt: string; negative_prompt?: string; n?: number; aspect_ratio?: string; size?: string;
  quality?: string; style?: string; seed?: number; output?: AiOutputOptions }
export interface LlmChatInvokeRequest extends InferenceRequest, ChatFields {}
export interface LlmChatHelperRequest extends ChatFields { logical_model: string; requirements?: HelperModelRequirement; disable?: ModelDisable;
  trace_id?: string; policy?: RoutePolicy; idempotency_key?: string; task_options?: AiTaskOptions; session_overlay?: AiccRouteOverlay }
export interface LlmChatInvokeResponse extends InferenceResponse { message?: AiMessage; tool_calls?: AiToolCall[] }
export interface TextToImageInvokeRequest extends InferenceRequest, ImageGenerationFields {}
export interface TextToImageHelperRequest extends ImageGenerationFields { logical_model: string; requirements?: HelperModelRequirement;
  trace_id?: string; disable?: ModelDisable; policy?: RoutePolicy; idempotency_key?: string; task_options?: AiTaskOptions; session_overlay?: AiccRouteOverlay }
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
export interface VideoTextToVideoRequest extends InferenceRequest { prompt: string; duration_seconds?: number; aspect_ratio?: string;
  resolution?: string; generate_audio?: boolean; seed?: number; output?: AiOutputOptions }
export interface VideoImageToVideoRequest extends InferenceRequest { image: ResourceRef; prompt: string; duration_seconds?: number;
  aspect_ratio?: string; resolution?: string }
export interface TimeRange { start_seconds: number; end_seconds: number }
export interface VideoToVideoRequest extends InferenceRequest { video: ResourceRef; prompt: string; preserve_motion?: boolean; time_range?: TimeRange }
export interface VideoExtendRequest extends InferenceRequest { video: ResourceRef; prompt: string; continuation_handle?: string;
  duration_seconds?: number; resolution?: string }
export interface VideoUpscaleRequest extends InferenceRequest { video: ResourceRef; target_resolution: string; denoise?: boolean;
  sharpen?: number; output?: AiOutputOptions }
export interface VideoResponse extends InferenceResponse { video?: ResourceRef }
export type VideoTextToVideoResponse = VideoResponse
export type VideoImageToVideoResponse = VideoResponse
export type VideoToVideoResponse = VideoResponse
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
export type ListModelsRequest = EmptyRequest
export type ProviderCatalogRequest = EmptyRequest
export type ProtocolAdapterListRequest = EmptyRequest
export type DriverMetadataUpdateGetReq = EmptyRequest
export interface CancelRequest { task_id: string }
export interface ServiceReloadSettingsResponse { ok: boolean; settings_revision: number }
export interface QuotaQueryRequest { capability?: Capability; method?: string }
export interface QuotaView { state: 'normal' | 'near_limit' | 'exhausted'; remaining_request_units?: number; remaining_cost?: Money; reset_at?: string }
export interface QuotaQueryResponse { quota: QuotaView }
export interface ProviderCatalogEntry { provider_profile_id: string; display_name: string; base_url: string;
  protocol_adapter_id: string; provider_rules_id?: string; ui_hints?: Record<string, JsonValue> }
export interface ProviderCatalogResponse { catalog_revision: number; providers: ProviderCatalogEntry[] }
export type ProtocolAdapterStatus = 'stable' | 'preview' | 'deprecated'
export type ProtocolExecutionMode = 'immediate' | 'stream' | 'native_task'
export interface ProtocolAdapterOperation { operation_id: string; api_types: ApiType[]; capabilities: Capability[];
  supported_features: string[]; execution_modes: ProtocolExecutionMode[]; supports_cancel: boolean; supports_webhook: boolean }
export interface ProtocolAdapterView { protocol_family_id: string; protocol_adapter_id: string; interface_generation: string;
  status: ProtocolAdapterStatus; probe_priority: number; base_adapter_id?: string; operations: ProtocolAdapterOperation[] }
export interface ProtocolAdapterListResponse { adapters: ProtocolAdapterView[] }
interface ProviderConfig { provider_type: string; provider_profile_id: string; protocol_family_id?: string; protocol_adapter_id?: string;
  base_url: string; credentials: JsonValue; region?: string; workspace?: string; account?: string; provider_rules_id?: string;
  auth?: JsonValue; discovery?: JsonValue; instance_rules?: JsonValue; timeout_ms?: number; auto_sync_models?: boolean }
export interface ProviderValidateRequest extends ProviderConfig { provider_instance_name?: string }
export type ProviderValidationErrorKind = 'configuration' | 'base_url' | 'authentication' | 'protocol' | 'models' | 'balance'
export interface ProviderValidationErrorDetail { kind: ProviderValidationErrorKind; message: string }
export interface ProviderValidateResponse { base_url_reachable: boolean; auth_valid: boolean; models_discovered: string[];
  balance_available: boolean; errors: string[]; error_details: ProviderValidationErrorDetail[]; resolved_protocol_adapter_id?: string }
export interface ProviderAddRequest extends ProviderConfig { provider_instance_name: string }
export interface ProviderReloadResult { ok: boolean; providers_registered: number }
export interface ProviderAddResponse { ok: boolean; provider_instance_name: string; settings_revision: number; reload: ProviderReloadResult }
export interface ProviderDeleteRequest { provider_instance_name: string }
export interface ProviderDeleteResponse { ok: boolean; provider_instance_name?: string; settings_revision?: number; reload?: ProviderReloadResult; reason?: string }
export interface ProviderRefreshModelsRequest { provider_instance_name: string }
export interface ProviderRefreshModelsResponse { ok: boolean; provider_instance_name: string; inventory_revision: string }
export interface ProviderListRequest { method?: string }
export type ProviderInstanceAuthMode = 'api_key' | 'dynamic_login'
export interface ProviderInstanceAuthView { mode?: ProviderInstanceAuthMode; credential_kind?: string; configured: boolean }
export type ProviderInstanceInventoryState = 'disabled' | 'not_loaded' | 'loaded'
export interface ProviderInstanceInventoryView { state: ProviderInstanceInventoryState; revision?: string; model_count: number;
  updated_at_ms?: number }
export type ProviderInstanceHealthState = 'disabled' | 'not_loaded' | 'unknown' | 'healthy' | 'degraded' | 'unavailable'
export interface ProviderInstanceHealthView { state: ProviderInstanceHealthState; checked_at_ms?: number }
export interface ProviderInstanceView { provider_instance_name: string; provider_type: string; provider_profile_id: string;
  protocol_adapter_id: string; base_url: string; enabled: boolean; auth: ProviderInstanceAuthView;
  inventory: ProviderInstanceInventoryView; health: ProviderInstanceHealthView }
export interface ProviderListResponse { providers: ProviderInstanceView[]; settings_revision: number; inventory_revision: string }
export interface ProviderHealthRequest { exact_model: string }
export interface ProviderHealthResponse { health: JsonValue }
export interface ProviderUpdateRequest { provider_instance_name: string; settings_revision: number; enabled?: boolean; base_url?: string;
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
  time_bucket?: 'hour' | 'day'; output_mode?: 'summary' | 'events' | 'summary_and_events'; limit?: number; cursor?: string }
export interface UsageAggregate { total_requests: number; input_tokens: number; output_tokens: number; total_tokens: number;
  consumed_request_units: number; finance_totals: Money[]; finance_complete: boolean }
export interface AiccUsageEvent { event_id: string; tenant_id: string; user_id: string; caller_app_id?: string; task_id: string;
  trace_id?: string; idempotency_key?: string; method: AiccAiMethod; capability: string; request_model: string; provider_instance_name: string;
  provider_model: string; input_tokens?: number; output_tokens?: number; total_tokens?: number; request_units?: number;
  usage_json: AiUsage; finance_snapshot_json?: JsonValue; created_at_ms: number }
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
}
const common = ['exact_model', 'trace_id', 'idempotency_key', 'task_options']
const schemas: Partial<Record<AiccMethod, string[]>> = {
  [AICC_AI_METHODS.CHAT_COMPLETIONS_CREATE]: [...common, 'messages', 'tools', 'response_format', 'temperature', 'top_p', 'max_output_tokens', 'seed', 'stop', 'output'],
  [AICC_AI_METHODS.IMAGES_GENERATE]: [...common, 'prompt', 'negative_prompt', 'n', 'aspect_ratio', 'size', 'quality', 'style', 'seed', 'output'],
  [AICC_AI_METHODS.EMBEDDING_TEXT]: [...common, 'items', 'chunking', 'embedding_space_id', 'dimensions', 'normalize', 'prefer_artifact'],
  [AICC_AI_METHODS.EMBEDDING_MULTIMODAL]: [...common, 'items', 'dimensions', 'normalize'],
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
  [AICC_AI_METHODS.VIDEO_TXT2VIDEO]: [...common, 'prompt', 'duration_seconds', 'aspect_ratio', 'resolution', 'generate_audio', 'seed', 'output'],
  [AICC_AI_METHODS.VIDEO_IMG2VIDEO]: [...common, 'image', 'prompt', 'duration_seconds', 'aspect_ratio', 'resolution'],
  [AICC_AI_METHODS.VIDEO_VIDEO2VIDEO]: [...common, 'video', 'prompt', 'preserve_motion', 'time_range'],
  [AICC_AI_METHODS.VIDEO_EXTEND]: [...common, 'video', 'prompt', 'continuation_handle', 'duration_seconds', 'resolution'],
  [AICC_AI_METHODS.VIDEO_UPSCALE]: [...common, 'video', 'target_resolution', 'denoise', 'sharpen', 'output'],
  [AICC_AI_METHODS.AGENT_COMPUTER_USE]: [...common, 'task', 'environment', 'allowed_actions'],
  [AICC_CORE_METHODS.ROUTE_RESOLVE]: ['trace_id', 'request_id', 'api_type', 'logical_model', 'requirements', 'disable', 'policy', 'estimated_input_tokens', 'estimated_output_tokens', 'session_overlay'],
  [AICC_CORE_METHODS.HELPER_LLM_CHAT]: ['logical_model', 'trace_id', 'requirements', 'disable', 'policy', 'messages', 'tools', 'response_format', 'temperature', 'top_p', 'max_output_tokens', 'seed', 'stop', 'output', 'idempotency_key', 'task_options', 'session_overlay'],
  [AICC_CORE_METHODS.HELPER_TEXT_TO_IMAGE]: ['logical_model', 'trace_id', 'requirements', 'disable', 'policy', 'prompt', 'negative_prompt', 'n', 'aspect_ratio', 'size', 'quality', 'style', 'seed', 'output', 'idempotency_key', 'task_options', 'session_overlay'],
  [AICC_CORE_METHODS.CANCEL]: ['task_id'],
  [AICC_MANAGEMENT_METHODS.SERVICE_RELOAD_SETTINGS]: [],
  [AICC_MANAGEMENT_METHODS.QUOTA_QUERY]: ['capability', 'method'],
  [AICC_MANAGEMENT_METHODS.USAGE_QUERY]: ['time_range', 'filters', 'group_by', 'time_bucket', 'output_mode', 'limit', 'cursor'],
  [AICC_MANAGEMENT_METHODS.TRACE_QUERY]: ['limit', 'cursor', 'start_time_ms', 'end_time_ms', 'task_ids', 'request_ids', 'api_types', 'provider_instance_names', 'selected_exact_models', 'scheduler_profiles', 'query', 'outcome'],
  [AICC_MANAGEMENT_METHODS.ROUTING_GET]: [],
  [AICC_MANAGEMENT_METHODS.ROUTING_UPDATE]: ['settings_revision', 'provider_weights'],
  [AICC_MANAGEMENT_METHODS.PROVIDER_CATALOG]: [],
  [AICC_MANAGEMENT_METHODS.PROTOCOL_ADAPTER_LIST]: [],
  [AICC_MANAGEMENT_METHODS.PROVIDER_VALIDATE]: ['provider_instance_name', 'provider_type', 'provider_profile_id', 'protocol_family_id', 'protocol_adapter_id', 'base_url', 'credentials', 'region', 'workspace', 'account', 'provider_rules_id', 'auth', 'discovery', 'instance_rules', 'timeout_ms', 'auto_sync_models'],
  [AICC_MANAGEMENT_METHODS.PROVIDER_ADD]: ['provider_instance_name', 'provider_type', 'provider_profile_id', 'protocol_family_id', 'protocol_adapter_id', 'base_url', 'credentials', 'region', 'workspace', 'account', 'provider_rules_id', 'auth', 'discovery', 'instance_rules', 'timeout_ms', 'auto_sync_models'],
  [AICC_MANAGEMENT_METHODS.PROVIDER_LIST]: ['method'],
  [AICC_MANAGEMENT_METHODS.PROVIDER_HEALTH]: ['exact_model'],
  [AICC_MANAGEMENT_METHODS.PROVIDER_UPDATE]: ['provider_instance_name', 'settings_revision', 'enabled', 'base_url', 'credential', 'provider_profile_id', 'protocol_adapter_id', 'discovery', 'instance_rules'],
  [AICC_MANAGEMENT_METHODS.PROVIDER_DELETE]: ['provider_instance_name'],
  [AICC_MANAGEMENT_METHODS.PROVIDER_REFRESH_MODELS]: ['provider_instance_name'],
  [AICC_MANAGEMENT_METHODS.MODELS_LIST]: [],
  [AICC_MANAGEMENT_METHODS.DRIVER_METADATA_UPDATE_GET]: [],
  [AICC_MANAGEMENT_METHODS.DRIVER_METADATA_UPDATE_SET]: ['enabled', 'source_url', 'interval_secs'],
}

export class AiccClient {
  constructor(private rpcClient: kRPCClient) {}
  setSeq(seq: number) { this.rpcClient.setSeq(seq) }
  private call<R, Q extends object>(method: AiccMethod, request: Q): Promise<R> {
    const schema = schemas[method]
    if (schema) strict(request, schema)
    return this.rpcClient.call<R, Q>(method, request)
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
  videoTextToVideo(r: VideoTextToVideoRequest) { return this.inference<VideoTextToVideoResponse, VideoTextToVideoRequest>(AICC_AI_METHODS.VIDEO_TXT2VIDEO, r) }
  videoImageToVideo(r: VideoImageToVideoRequest) { return this.inference<VideoImageToVideoResponse, VideoImageToVideoRequest>(AICC_AI_METHODS.VIDEO_IMG2VIDEO, r) }
  videoToVideo(r: VideoToVideoRequest) { return this.inference<VideoToVideoResponse, VideoToVideoRequest>(AICC_AI_METHODS.VIDEO_VIDEO2VIDEO, r) }
  videoExtend(r: VideoExtendRequest) { return this.inference<VideoExtendResponse, VideoExtendRequest>(AICC_AI_METHODS.VIDEO_EXTEND, r) }
  videoUpscale(r: VideoUpscaleRequest) { return this.inference<VideoUpscaleResponse, VideoUpscaleRequest>(AICC_AI_METHODS.VIDEO_UPSCALE, r) }
  computerUse(r: ComputerUseRequest) { return this.inference<ComputerUseResponse, ComputerUseRequest>(AICC_AI_METHODS.AGENT_COMPUTER_USE, r) }
  cancel(taskId: string) { if (!taskId) throw new RPCError('cancel requires non-empty task_id'); return this.call<CancelResponse, { task_id: string }>(AICC_CORE_METHODS.CANCEL, { task_id: taskId }) }
  reloadSettings() { return this.call<ServiceReloadSettingsResponse, EmptyRequest>(AICC_MANAGEMENT_METHODS.SERVICE_RELOAD_SETTINGS, {}) }
  queryQuota(r: QuotaQueryRequest = {}) { return this.call<QuotaQueryResponse, QuotaQueryRequest>(AICC_MANAGEMENT_METHODS.QUOTA_QUERY, r) }
  queryUsage(r: QueryUsageRequest) { return this.call<QueryUsageResponse, QueryUsageRequest>(AICC_MANAGEMENT_METHODS.USAGE_QUERY, r) }
  queryTrace(r: QueryRouteTraceRequest = {}) { return this.call<QueryRouteTraceResponse, QueryRouteTraceRequest>(AICC_MANAGEMENT_METHODS.TRACE_QUERY, r) }
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
  listModels() { return this.call<JsonValue, EmptyRequest>(AICC_MANAGEMENT_METHODS.MODELS_LIST, {}) }
  getDriverMetadataUpdate() { return this.call<DriverMetadataUpdateView, EmptyRequest>(AICC_MANAGEMENT_METHODS.DRIVER_METADATA_UPDATE_GET, {}) }
  setDriverMetadataUpdate(r: DriverMetadataUpdateSetReq) { return this.call<DriverMetadataUpdateSetResponse, DriverMetadataUpdateSetReq>(AICC_MANAGEMENT_METHODS.DRIVER_METADATA_UPDATE_SET, r) }
}
