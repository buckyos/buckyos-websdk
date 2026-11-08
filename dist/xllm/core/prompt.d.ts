import type { EffectiveTools, GroupDef, LoopModel, PromptPlan, RuntimeInfo, SectionRender } from './types';
import type { MergedConfig } from './config';
/** Fixed section aliases → line numbers. */
export declare const SECTION_ALIASES: [string, number][];
export declare function resolveSectionKey(key: string): number | string;
export declare function aliasLine(name: string): number | undefined;
export declare function sectionDefaultName(line: number): string;
/** `RuntimeInfo::template_values`: strings as they are, other values as JSON. */
export declare function runtimeTemplateValues(info: RuntimeInfo): Record<string, string>;
/**
 * Template variables: `runtime.*` from the runtime, `env.*` read only when a
 * template references them (from what the host / page passed). `\{{` is a
 * literal `{{`; values are not interpreted again.
 */
export declare class TemplateEnv {
    private readonly env;
    readonly runtime: Record<string, string>;
    private readonly used;
    constructor(runtime: Record<string, string>, env: (name: string) => string | undefined);
    static forNewRun(info: RuntimeInfo, env: (name: string) => string | undefined): TemplateEnv;
    usedVars(): Record<string, string>;
    private lookup;
    render(text: string, source: string): string;
}
export declare function sectionIsEmpty(s: SectionRender): boolean;
export interface PromptAssembly {
    merged: MergedConfig;
    /** `TaskOverrides.system` / `.select` (explicit arguments). */
    overrideSystem?: string;
    overrideSelect?: string;
    groupName?: string;
    group?: GroupDef;
    loopModel: LoopModel;
    tools: EffectiveTools;
    env: TemplateEnv;
    json: boolean;
}
/** System prompt of a run that xllm assembles itself (`assemble_prompt`). */
export declare function assemblePrompt(a: PromptAssembly): PromptPlan;
//# sourceMappingURL=prompt.d.ts.map