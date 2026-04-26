import { kRPCClient } from './krpc_client';
export declare const AICC_SERVICE_NAME = "aicc";
export declare const AICC_SERVICE_UNIQUE_ID = "aicc";
export declare const AICC_SERVICE_SERVICE_NAME = "aicc";
export declare const AICC_SERVICE_SERVICE_PORT = 4040;
export declare const AICC_AI_METHODS: {
    readonly LLM_CHAT: "llm.chat";
    readonly LLM_COMPLETION: "llm.completion";
    readonly EMBEDDING_TEXT: "embedding.text";
    readonly EMBEDDING_MULTIMODAL: "embedding.multimodal";
    readonly RERANK: "rerank";
    readonly IMAGE_TXT2IMG: "image.txt2img";
    readonly IMAGE_IMG2IMG: "image.img2img";
    readonly IMAGE_INPAINT: "image.inpaint";
    readonly IMAGE_UPSCALE: "image.upscale";
    readonly IMAGE_BG_REMOVE: "image.bg_remove";
    readonly VISION_OCR: "vision.ocr";
    readonly VISION_CAPTION: "vision.caption";
    readonly VISION_DETECT: "vision.detect";
    readonly VISION_SEGMENT: "vision.segment";
    readonly AUDIO_TTS: "audio.tts";
    readonly AUDIO_ASR: "audio.asr";
    readonly AUDIO_MUSIC: "audio.music";
    readonly AUDIO_ENHANCE: "audio.enhance";
    readonly VIDEO_TXT2VIDEO: "video.txt2video";
    readonly VIDEO_IMG2VIDEO: "video.img2video";
    readonly VIDEO_VIDEO2VIDEO: "video.video2video";
    readonly VIDEO_EXTEND: "video.extend";
    readonly VIDEO_UPSCALE: "video.upscale";
    readonly AGENT_COMPUTER_USE: "agent.computer_use";
};
export declare const AICC_CONTROL_METHODS: {
    readonly CANCEL: "cancel";
    readonly RELOAD_SETTINGS: "reload_settings";
    readonly SERVICE_RELOAD_SETTINGS: "service.reload_settings";
    readonly QUOTA_QUERY: "quota.query";
    readonly PROVIDER_LIST: "provider.list";
    readonly PROVIDER_HEALTH: "provider.health";
};
export declare const AICC_FEATURES: {
    readonly PLAN: "plan";
    readonly TOOL_CALLING: "tool_calling";
    readonly JSON_OUTPUT: "json_output";
    readonly WEB_SEARCH: "web_search";
    readonly VISION: "vision";
    readonly ASR: "asr";
    readonly VIDEO_UNDERSTAND: "video_understand";
};
export type AiccAiMethod = typeof AICC_AI_METHODS[keyof typeof AICC_AI_METHODS];
export type AiccControlMethod = typeof AICC_CONTROL_METHODS[keyof typeof AICC_CONTROL_METHODS];
export type AiccCapability = 'llm' | 'embedding' | 'rerank' | 'image' | 'vision' | 'audio' | 'video' | 'agent';
export type AiccFeature = typeof AICC_FEATURES[keyof typeof AICC_FEATURES] | string;
export type AiccRespFormat = 'text' | 'json';
export type AiccRoutePolicyProfile = 'cheap' | 'fast' | 'balanced' | 'quality';
export type AiccMethodStatus = 'succeeded' | 'running' | 'failed';
export interface AiccResourceUrl {
    kind: 'url';
    url: string;
    mime_hint?: string | null;
}
export interface AiccResourceBase64 {
    kind: 'base64';
    mime: string;
    data_base64: string;
}
export interface AiccResourceNamedObject {
    kind: 'named_object';
    obj_id: string;
}
export type AiccResourceRef = AiccResourceUrl | AiccResourceBase64 | AiccResourceNamedObject;
export type AiccContentPart = {
    type: 'text';
    text: string;
} | {
    type: 'resource';
    resource: AiccResourceRef;
} | Record<string, unknown>;
export interface AiccMessage {
    role: string;
    content: string | AiccContentPart[];
}
export interface AiccToolSpec {
    name: string;
    description: string;
    args_schema: Record<string, unknown>;
    output_schema: unknown;
}
export interface AiccModelSpec {
    alias: string;
    provider_model_hint?: string | null;
}
export interface AiccRequirements {
    must_features?: AiccFeature[];
    max_latency_ms?: number;
    max_cost_usd?: number;
    resp_format?: AiccRespFormat;
    extra?: unknown;
}
export interface AiccPayload {
    input_json?: unknown;
    resources?: AiccResourceRef[];
    options?: unknown;
}
export interface AiccRoutePolicy {
    profile?: AiccRoutePolicyProfile;
    allow_fallback?: boolean;
    runtime_failover?: boolean;
    explain?: boolean;
}
export interface AiccTaskOptions {
    parent_id?: number | null;
}
export interface AiccMethodRequest {
    capability: AiccCapability;
    model: AiccModelSpec;
    requirements: AiccRequirements;
    payload: AiccPayload;
    policy?: AiccRoutePolicy | null;
    idempotency_key?: string | null;
    task_options?: AiccTaskOptions | null;
}
export interface AiccTokenUsage {
    input?: number;
    output?: number;
    total?: number;
    cached?: number;
    reasoning?: number;
}
export interface AiccMediaUsage {
    audio_seconds?: number;
    video_seconds?: number;
    image_count?: number;
}
export interface AiccUsage {
    tokens?: AiccTokenUsage;
    media?: AiccMediaUsage;
    request_units?: number;
}
export interface AiccCost {
    amount: number;
    currency: string;
}
export interface AiccArtifact {
    name: string;
    resource: AiccResourceRef;
    mime?: string | null;
    metadata?: unknown;
}
export interface AiccToolCall {
    name: string;
    args: Record<string, unknown>;
    call_id: string;
}
export interface AiccResponseSummary {
    text?: string;
    tool_calls?: AiccToolCall[];
    artifacts?: AiccArtifact[];
    usage?: AiccUsage;
    cost?: AiccCost;
    finish_reason?: string;
    provider_task_ref?: string | null;
    extra?: unknown;
}
export interface AiccMethodResponse {
    task_id: string;
    status: AiccMethodStatus;
    result?: AiccResponseSummary | null;
    event_ref?: string | null;
}
export interface AiccCancelResponse {
    task_id: string;
    accepted: boolean;
}
export interface AiccQuotaQueryRequest {
    capability?: AiccCapability;
    method?: AiccAiMethod | string;
}
export interface AiccQuotaQueryResponse {
    quota: {
        state: string;
        remaining_request_units?: number;
        remaining_cost_usd?: number;
        reset_at?: string;
        [key: string]: unknown;
    };
}
export interface AiccProviderListRequest {
    method?: AiccAiMethod | string;
}
export interface AiccProviderHealthRequest {
    exact_model?: string;
    provider?: string;
}
export type AiccModelInput = string | AiccModelSpec;
export interface AiccTypedMethodCall<TInput> {
    model: AiccModelInput;
    input: TInput;
    requirements?: AiccRequirements;
    resources?: AiccResourceRef[];
    options?: unknown;
    policy?: AiccRoutePolicy | null;
    idempotency_key?: string | null;
    task_options?: AiccTaskOptions | null;
}
export type AiccTypedResponseSummary<TExtra = unknown> = Omit<AiccResponseSummary, 'extra'> & {
    extra?: TExtra;
};
export type AiccTypedMethodResponse<TExtra = unknown> = Omit<AiccMethodResponse, 'result'> & {
    result?: AiccTypedResponseSummary<TExtra> | null;
};
export interface AiccGenerationOutputOptions {
    media_type?: string;
    size?: string;
    sample_rate?: number;
    fps?: number;
}
export interface AiccGenerationParams {
    temperature?: number;
    top_p?: number;
    max_output_tokens?: number;
    seed?: number;
    stop?: string[];
    output?: AiccGenerationOutputOptions;
}
export interface AiccJsonSchemaResponseFormat {
    type: 'json_schema';
    json_schema: {
        name: string;
        schema: Record<string, unknown>;
        strict?: boolean;
    };
}
export type AiccLlmResponseFormat = {
    type: 'text';
} | {
    type: 'json_object';
} | AiccJsonSchemaResponseFormat;
export interface AiccLlmTool {
    type: 'function';
    name: string;
    description?: string;
    args_json_schema: Record<string, unknown>;
}
export interface AiccLlmChatInput extends AiccGenerationParams {
    messages: AiccMessage[];
    tools?: AiccLlmTool[];
    response_format?: AiccLlmResponseFormat;
}
export interface AiccLlmCompletionInput extends AiccGenerationParams {
    prompt: string;
    suffix?: string | null;
}
export interface AiccRouteTraceAttempt {
    step: number;
    exact_model: string;
    started_at?: string;
    ended_at?: string | null;
    outcome: 'succeeded' | 'failed' | 'skipped';
    error_code?: string | null;
    fallback_reason?: string | null;
}
export interface AiccRouteTrace {
    attempts: AiccRouteTraceAttempt[];
    final_model?: string;
}
export interface AiccLlmExtra {
    provider_io?: unknown;
    route_trace?: AiccRouteTrace;
    [key: string]: unknown;
}
export type AiccLlmChatResponse = AiccTypedMethodResponse<AiccLlmExtra>;
export type AiccLlmCompletionResponse = AiccTypedMethodResponse<AiccLlmExtra>;
export type AiccEmbeddingTextItem = {
    type: 'text';
    text: string;
    id?: string;
} | {
    type: 'resource';
    resource: AiccResourceRef;
    id?: string;
};
export interface AiccEmbeddingChunking {
    strategy: 'auto' | string;
    max_tokens?: number;
    overlap_tokens?: number;
}
export interface AiccEmbeddingTextInput {
    items: AiccEmbeddingTextItem[];
    chunking?: AiccEmbeddingChunking;
    embedding_space_id?: string | null;
    dimensions?: number;
    normalize?: boolean;
    prefer_artifact?: boolean | 'auto';
}
export interface AiccEmbeddingMultimodalItem {
    id?: string;
    text?: string;
    image?: AiccResourceRef;
    audio?: AiccResourceRef;
    video?: AiccResourceRef;
}
export interface AiccEmbeddingMultimodalInput {
    items: AiccEmbeddingMultimodalItem[];
    dimensions?: number;
    normalize?: boolean;
    embedding_space_id?: string | null;
    prefer_artifact?: boolean | 'auto';
}
export interface AiccEmbeddingVector {
    index: number;
    id?: string;
    embedding: number[];
    embedding_space_id?: string;
}
export interface AiccEmbeddingResult {
    data?: AiccEmbeddingVector[];
    data_resource?: AiccResourceRef;
}
export interface AiccEmbeddingExtra {
    embedding?: AiccEmbeddingResult;
    [key: string]: unknown;
}
export type AiccEmbeddingTextResponse = AiccTypedMethodResponse<AiccEmbeddingExtra>;
export type AiccEmbeddingMultimodalResponse = AiccTypedMethodResponse<AiccEmbeddingExtra>;
export type AiccRerankDocument = {
    id?: string;
    text: string;
    metadata?: Record<string, unknown>;
} | {
    id?: string;
    resource: AiccResourceRef;
    metadata?: Record<string, unknown>;
};
export interface AiccRerankInput {
    query: string;
    documents: AiccRerankDocument[];
    n?: number;
    return_documents?: boolean;
}
export interface AiccRerankResultItem {
    index: number;
    id?: string;
    score: number;
    document?: AiccRerankDocument;
}
export interface AiccRerankResult {
    results: AiccRerankResultItem[];
}
export interface AiccRerankExtra {
    rerank?: AiccRerankResult;
    [key: string]: unknown;
}
export type AiccRerankResponse = AiccTypedMethodResponse<AiccRerankExtra>;
export interface AiccImageOutputOptions {
    media_type?: string;
    size?: string;
}
export interface AiccImageTxt2imgInput {
    prompt: string;
    negative_prompt?: string;
    n?: number;
    aspect_ratio?: string;
    quality?: 'low' | 'medium' | 'high' | string;
    seed?: number;
    output?: AiccImageOutputOptions;
}
export interface AiccImageImg2imgInput {
    images: AiccResourceRef[];
    prompt?: string;
    strength?: number;
    output?: AiccImageOutputOptions;
}
export type AiccImageMaskSemantics = 'white_area_is_edit_area' | 'black_area_is_edit_area' | 'alpha_zero_is_edit_area';
export interface AiccImageInpaintInput {
    image: AiccResourceRef;
    mask: AiccResourceRef;
    prompt: string;
    mask_semantics?: AiccImageMaskSemantics;
    output?: AiccImageOutputOptions;
}
export interface AiccImageUpscaleInput {
    image: AiccResourceRef;
    scale?: number;
    target_width?: number;
    target_height?: number;
    preserve_faces?: boolean;
    output?: AiccImageOutputOptions;
}
export interface AiccImageBgRemoveInput {
    image: AiccResourceRef;
    mode?: 'rgba_image' | 'mask' | string;
    output?: AiccImageOutputOptions;
}
export interface AiccImageExtra {
    images?: AiccResourceRef[];
    image?: AiccResourceRef;
    [key: string]: unknown;
}
export type AiccImageResponse = AiccTypedMethodResponse<AiccImageExtra>;
export interface AiccBoundingBox {
    format: 'xywh';
    unit: 'px' | 'relative';
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface AiccBoundingBoxSpec {
    format: 'xywh';
    unit: 'px' | 'relative';
}
export type AiccMask = {
    format: 'rle';
    size: [number, number];
    counts: string;
} | {
    format: 'polygon';
    points: number[][];
} | {
    format: 'bitmap_resource';
    resource: AiccResourceRef;
};
export interface AiccVisionOcrInput {
    document: AiccResourceRef;
    level?: 'page' | 'block' | 'line' | 'word' | string;
    language_hints?: string[];
    return_layout?: boolean;
    return_artifacts?: string[];
}
export interface AiccVisionCaptionInput {
    image: AiccResourceRef;
    style?: 'short' | 'detailed' | string;
    language?: string;
    n?: number;
}
export interface AiccVisionDetectInput {
    image: AiccResourceRef;
    classes?: string[];
    score_threshold?: number;
    bbox_spec?: AiccBoundingBoxSpec;
}
export type AiccVisionSegmentPrompt = {
    type: 'box';
    bbox: AiccBoundingBox;
} | {
    type: 'point';
    x: number;
    y: number;
    label?: string;
} | {
    type: 'text';
    text: string;
};
export interface AiccVisionSegmentInput {
    image: AiccResourceRef;
    prompt: AiccVisionSegmentPrompt;
    mask_format?: 'rle' | 'polygon' | 'bitmap_resource';
    return_bitmap_mask?: boolean;
}
export interface AiccVisionOcrExtra {
    ocr?: unknown;
    [key: string]: unknown;
}
export interface AiccVisionCaption {
    text: string;
    confidence?: number;
}
export interface AiccVisionCaptionExtra {
    captions?: AiccVisionCaption[];
    [key: string]: unknown;
}
export interface AiccVisionDetection {
    label: string;
    class_id?: string;
    score: number;
    bbox: AiccBoundingBox;
}
export interface AiccVisionDetectExtra {
    detections?: AiccVisionDetection[];
    [key: string]: unknown;
}
export interface AiccVisionMaskResult {
    id?: string;
    score?: number;
    bbox?: AiccBoundingBox;
    mask: AiccMask;
}
export interface AiccVisionSegmentExtra {
    segment?: {
        masks: AiccVisionMaskResult[];
    };
    [key: string]: unknown;
}
export type AiccVisionOcrResponse = AiccTypedMethodResponse<AiccVisionOcrExtra>;
export type AiccVisionCaptionResponse = AiccTypedMethodResponse<AiccVisionCaptionExtra>;
export type AiccVisionDetectResponse = AiccTypedMethodResponse<AiccVisionDetectExtra>;
export type AiccVisionSegmentResponse = AiccTypedMethodResponse<AiccVisionSegmentExtra>;
export interface AiccAudioOutputOptions {
    media_type?: string;
    sample_rate?: number;
}
export interface AiccAudioVoiceSpec {
    voice_id?: string;
    language?: string;
    gender?: 'male' | 'female' | 'neutral' | string;
    style?: string;
    speaker_similarity_required?: boolean;
}
export interface AiccAudioTtsInput {
    text: string;
    voice?: AiccAudioVoiceSpec;
    speed?: number;
    output?: AiccAudioOutputOptions;
}
export interface AiccAudioAsrInput {
    audio: AiccResourceRef;
    language?: string;
    timestamps?: 'none' | 'word' | 'segment' | string;
    diarization?: boolean;
    output_formats?: Array<'json' | 'vtt' | 'srt' | string>;
}
export interface AiccAudioMusicInput {
    prompt: string;
    duration_seconds?: number;
    instrumental?: boolean;
    lyrics?: string | null;
    seed?: number;
    output?: AiccAudioOutputOptions;
}
export interface AiccAudioEnhanceInput {
    audio: AiccResourceRef;
    task: 'denoise' | 'dereverb' | 'separate_stems' | string;
    strength?: number;
    return_stems?: boolean;
}
export interface AiccAudioSegment {
    id?: string;
    start_seconds: number;
    end_seconds: number;
    text: string;
    speaker?: string;
    confidence?: number;
}
export interface AiccAudioExtra {
    asr?: {
        segments?: AiccAudioSegment[];
    };
    audio?: AiccResourceRef;
    stems?: AiccResourceRef[];
    structure?: unknown;
    [key: string]: unknown;
}
export type AiccAudioResponse = AiccTypedMethodResponse<AiccAudioExtra>;
export interface AiccVideoOutputOptions {
    media_type?: string;
    fps?: number;
}
export interface AiccVideoTxt2videoInput {
    prompt: string;
    duration_seconds?: number;
    aspect_ratio?: string;
    resolution?: string;
    generate_audio?: boolean;
    seed?: number;
    output?: AiccVideoOutputOptions;
}
export interface AiccVideoImg2videoInput {
    image: AiccResourceRef;
    prompt?: string;
    duration_seconds?: number;
    aspect_ratio?: string;
    resolution?: string;
}
export interface AiccTimeRange {
    start_seconds: number;
    end_seconds: number;
}
export interface AiccVideoVideo2videoInput {
    video: AiccResourceRef;
    prompt?: string;
    preserve_motion?: boolean;
    time_range?: AiccTimeRange;
}
export interface AiccVideoExtendInput {
    video: AiccResourceRef;
    prompt?: string;
    continuation_handle?: string;
    duration_seconds?: number;
    resolution?: string;
}
export interface AiccVideoUpscaleInput {
    video: AiccResourceRef;
    target_resolution?: string;
    denoise?: boolean;
    sharpen?: number;
    output?: AiccVideoOutputOptions;
}
export interface AiccVideoExtra {
    video?: AiccResourceRef;
    [key: string]: unknown;
}
export type AiccVideoResponse = AiccTypedMethodResponse<AiccVideoExtra>;
export type AiccAgentComputerActionName = 'screenshot' | 'left_click' | 'right_click' | 'type' | 'key' | 'scroll' | 'wait';
export interface AiccAgentComputerUseInput {
    task: string;
    environment: {
        environment_id: string;
        session_id: string;
        screenshot?: AiccResourceRef;
        viewport?: {
            width: number;
            height: number;
        };
    };
    allowed_actions?: AiccAgentComputerActionName[];
}
export type AiccAgentComputerAction = {
    type: 'screenshot';
} | {
    type: 'left_click' | 'right_click';
    x: number;
    y: number;
} | {
    type: 'type';
    text: string;
} | {
    type: 'key';
    key: string;
} | {
    type: 'scroll';
    x?: number;
    y?: number;
    delta_x?: number;
    delta_y?: number;
} | {
    type: 'wait';
    milliseconds?: number;
};
export interface AiccAgentComputerUseExtra {
    actions?: AiccAgentComputerAction[];
    requires_next_observation?: boolean;
    [key: string]: unknown;
}
export type AiccAgentComputerUseResponse = AiccTypedMethodResponse<AiccAgentComputerUseExtra>;
export declare function isAiccAiMethod(method: string): method is AiccAiMethod;
export declare class AiccClient {
    private rpcClient;
    constructor(rpcClient: kRPCClient);
    setSeq(seq: number): void;
    callMethod(method: AiccAiMethod, request: AiccMethodRequest): Promise<AiccMethodResponse>;
    llmChat(request: AiccTypedMethodCall<AiccLlmChatInput>): Promise<AiccLlmChatResponse>;
    llmCompletion(request: AiccTypedMethodCall<AiccLlmCompletionInput>): Promise<AiccLlmCompletionResponse>;
    embeddingText(request: AiccTypedMethodCall<AiccEmbeddingTextInput>): Promise<AiccEmbeddingTextResponse>;
    embeddingMultimodal(request: AiccTypedMethodCall<AiccEmbeddingMultimodalInput>): Promise<AiccEmbeddingMultimodalResponse>;
    rerank(request: AiccTypedMethodCall<AiccRerankInput>): Promise<AiccRerankResponse>;
    imageTxt2img(request: AiccTypedMethodCall<AiccImageTxt2imgInput>): Promise<AiccImageResponse>;
    imageImg2img(request: AiccTypedMethodCall<AiccImageImg2imgInput>): Promise<AiccImageResponse>;
    imageInpaint(request: AiccTypedMethodCall<AiccImageInpaintInput>): Promise<AiccImageResponse>;
    imageUpscale(request: AiccTypedMethodCall<AiccImageUpscaleInput>): Promise<AiccImageResponse>;
    imageBgRemove(request: AiccTypedMethodCall<AiccImageBgRemoveInput>): Promise<AiccImageResponse>;
    visionOcr(request: AiccTypedMethodCall<AiccVisionOcrInput>): Promise<AiccVisionOcrResponse>;
    visionCaption(request: AiccTypedMethodCall<AiccVisionCaptionInput>): Promise<AiccVisionCaptionResponse>;
    visionDetect(request: AiccTypedMethodCall<AiccVisionDetectInput>): Promise<AiccVisionDetectResponse>;
    visionSegment(request: AiccTypedMethodCall<AiccVisionSegmentInput>): Promise<AiccVisionSegmentResponse>;
    audioTts(request: AiccTypedMethodCall<AiccAudioTtsInput>): Promise<AiccAudioResponse>;
    audioAsr(request: AiccTypedMethodCall<AiccAudioAsrInput>): Promise<AiccAudioResponse>;
    audioMusic(request: AiccTypedMethodCall<AiccAudioMusicInput>): Promise<AiccAudioResponse>;
    audioEnhance(request: AiccTypedMethodCall<AiccAudioEnhanceInput>): Promise<AiccAudioResponse>;
    videoTxt2video(request: AiccTypedMethodCall<AiccVideoTxt2videoInput>): Promise<AiccVideoResponse>;
    videoImg2video(request: AiccTypedMethodCall<AiccVideoImg2videoInput>): Promise<AiccVideoResponse>;
    videoVideo2video(request: AiccTypedMethodCall<AiccVideoVideo2videoInput>): Promise<AiccVideoResponse>;
    videoExtend(request: AiccTypedMethodCall<AiccVideoExtendInput>): Promise<AiccVideoResponse>;
    videoUpscale(request: AiccTypedMethodCall<AiccVideoUpscaleInput>): Promise<AiccVideoResponse>;
    agentComputerUse(request: AiccTypedMethodCall<AiccAgentComputerUseInput>): Promise<AiccAgentComputerUseResponse>;
    cancel(taskId: string): Promise<AiccCancelResponse>;
    reloadSettings(): Promise<unknown>;
    serviceReloadSettings(): Promise<unknown>;
    queryQuota(request: AiccQuotaQueryRequest): Promise<AiccQuotaQueryResponse>;
    listProviders(request?: AiccProviderListRequest): Promise<unknown>;
    providerHealth(request: AiccProviderHealthRequest): Promise<unknown>;
}
//# sourceMappingURL=aicc_client.d.ts.map