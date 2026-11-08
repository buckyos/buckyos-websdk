import type { EffectiveTools, HostProtocolFlavor, LoopModel, ResolvedTool } from './types';
/** Runtime protocol version; a resume checks the executor can handle the saved one. */
export declare const RUNTIME_PROTOCOL_VERSION = "xllm/2";
/** The parameter an action's element body carries: `command` / `content` / … or the only required string. */
export declare function actionBodyArg(tool: ResolvedTool): string | undefined;
export declare function renderActionUsage(tool: ResolvedTool): string;
export declare function buildRuntimeProtocol(loopModel: LoopModel, tools: EffectiveTools, json: boolean): string;
export declare function buildRuntimeProtocolFor(flavor: HostProtocolFlavor, loopModel: LoopModel, tools: EffectiveTools, json: boolean): string;
/** System text of the `rules` section (30): the tools and actions this run has. */
export declare function buildRulesSystemText(loopModel: LoopModel, tools: EffectiveTools): string;
/** System text of the `cmd_manual` section (40), only when `shell` is enabled. */
export declare function buildCmdManualSystemText(tools: EffectiveTools): string | undefined;
/** System text of the `contexts` section (20): RuntimeInfo facts the templates did not reference. */
export declare function buildContextsSystemText(runtime: Record<string, string>, referenced: Record<string, string>): string | undefined;
//# sourceMappingURL=protocol.d.ts.map