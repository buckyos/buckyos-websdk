import type { GroupDef, JsonValue, LlmContextFile, LoopModel, PromptConfig, ProviderConfig, ResultFormat, RunLogLevel, RunsDirSetting, RuntimeConfig, ShellSettings, ShellToolConfig, ToolSource, ToolsConfig } from './types';
export declare const DEFAULT_MAX_TOOL_ITERATIONS = 8;
export declare const DEFAULT_TIMEOUT_SECS = 3600;
export declare const DEFAULT_LLM_TIMEOUT_SECS = 600;
export declare const DEFAULT_CONTEXT_YIELD_RATIO = 0.8;
export declare const DEFAULT_MAX_CONSECUTIVE_ERRORS = 3;
export declare const DEFAULT_TASK_WAIT_MS = 25000;
export declare const MAX_IN_TOOL_WAIT_MS: number;
export declare const EXEC_DEFAULT_TIMEOUT_MS = 1800000;
export declare const EXEC_MAX_TIMEOUT_MS = 3600000;
export declare const BUILTIN_TOOL_GROUP_BASH = "bash";
export declare const BUILTIN_TOOL_GROUP_BASH_CORE = "bash_core";
/** Runtime kinds named by the design but not implemented by any executor. */
export declare const PLANNED_RUNTIME_KINDS: string[];
/** Runtime kinds the TS runtime knows (`site` is TS-only; Rust reports it as planned). */
export declare const KNOWN_RUNTIME_KINDS: string[];
/** Lexical path normalization (no filesystem access). */
export declare function normalizePath(p: string): string;
/** `resolve_config_path`: `~` stays for the host to expand, absolute paths as they are, the rest under `baseDir`. */
export declare function resolveConfigPath(raw: string, baseDir: string, home?: string): string;
/** Parse one `.llm_context` JSON object. `file` names it in diagnostics. */
export declare function parseLlmContextJson(file: string, value: JsonValue | undefined): LlmContextFile;
export declare function parseResultFormat(s: string): ResultFormat;
export declare function resultFormatString(f: ResultFormat): string;
export interface MergedConfig {
    runtime: RuntimeConfig;
    provider: ProviderConfig;
    model?: string;
    file_model?: string;
    max_tokens?: number;
    max_tool_iterations?: number;
    llm_timeout?: number;
    context_window?: number;
    context_yield_ratio?: number;
    timeout?: number;
    runs_dir?: RunsDirSetting;
    loop_model?: LoopModel;
    run_logs?: RunLogLevel;
    result_format?: ResultFormat;
    json?: boolean;
    json_schema?: JsonValue;
    tools: ToolsConfig;
    prompt: PromptConfig;
    sources: Record<string, string>;
    files: string[];
}
export declare function mergeToolsConfig(base: ToolsConfig, over: ToolsConfig): ToolsConfig;
/** Merge parsed layers, ancestor first (`merge_config_layers`). */
export declare function mergeConfigLayers(layers: {
    path: string;
    file: LlmContextFile;
}[]): MergedConfig;
/** Tool configuration before expansion: defaults → top `tools` → selected group → `prompt.tools` → explicit switch. */
export declare function computeToolsConfig(merged: MergedConfig, group: GroupDef | undefined, cliTools: boolean | undefined, includeGroup: boolean): {
    cfg: ToolsConfig;
    sources: Record<string, string>;
};
export declare function shellSettings(cfg: ShellToolConfig | undefined, taskWaitMs: number): ShellSettings;
/** `RuntimeConfig::task_wait_ms`: the in-call wait budget for tasks. */
export declare function taskWaitMs(r: RuntimeConfig): number;
export declare function describeToolSource(s: ToolSource): string;
//# sourceMappingURL=config.d.ts.map