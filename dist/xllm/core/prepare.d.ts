import type { AiMessage, JsonValue, LoopModel, ProviderKind, ResourceRef, ResultFormat, RunLogLevel } from './types';
import type { MergedConfig } from './config';
import type { PreparedTask, XllmDeps } from './run';
export declare const MAX_TEXT_ATTACHMENT_BYTES: number;
export declare const MAX_IMAGE_ATTACHMENT_BYTES: number;
export type Attachment = 
/** Text material the host has (Rust `--file`). */
{
    kind: 'text';
    label: string;
    text: string;
}
/** An image: a URL, or a resource (base64 / named object). */
 | {
    kind: 'image';
    source: string | ResourceRef;
    label?: string;
};
export interface TaskInput {
    user?: string;
    attachments?: Attachment[];
    /** Piped input: the request when there is none, material otherwise. */
    stdin?: string;
    /** A ready conversation instead of a request (exclusive with everything else). */
    structured?: AiMessage[];
}
/** Explicit arguments (Rust `TaskOverrides`); `undefined` keeps the configuration. */
export interface TaskOverrides {
    provider?: ProviderKind;
    model?: string;
    file_model?: string;
    loop_model?: LoopModel;
    tools?: boolean;
    select?: string;
    system?: string;
    max_tokens?: number;
    max_tool_iterations?: number;
    timeout_secs?: number;
    llm_timeout_secs?: number;
    run_logs?: RunLogLevel;
    result_format?: ResultFormat;
    json?: boolean;
    json_schema?: JsonValue;
    disable_capabilities?: string[];
}
/** The prompt group a task uses (`select_prompt_group`): none for structured input or a custom prompt. */
export declare function selectPromptGroup(merged: MergedConfig, overrides: Pick<TaskOverrides, 'select' | 'system'>, structured?: boolean): string | undefined;
/**
 * Merge the configuration with `overrides`, select the group, open the
 * runtime's tools, assemble the prompt and the first user message; no run
 * is created.
 */
export declare function prepareTask(llmContext: JsonValue | undefined, origin: string, input: TaskInput, overrides: TaskOverrides, deps: XllmDeps): Promise<PreparedTask>;
//# sourceMappingURL=prepare.d.ts.map