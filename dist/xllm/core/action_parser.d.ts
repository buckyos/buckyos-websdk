import type { AiResponse, JsonValue, LLMBehaviorResult, ResolvedTool } from './types';
import type { LLMResultParser } from './deps';
/** Key of the report attachments inside `report_result` (`<artifacts>`). */
export declare const REPORT_ARTIFACTS_KEY = "artifacts";
export declare class XllmActionParser implements LLMResultParser {
    private readonly actions;
    constructor(actions: ResolvedTool[]);
    private elementToCall;
    parse(response: AiResponse): LLMBehaviorResult;
}
/** The attachments carried in a `report_result`. */
export declare function reportArtifacts(result: JsonValue | undefined): string[];
/** A `report_result` taken apart again: its attachments and the rest (`undefined` when nothing else was given). */
export declare function splitReportResult(result: JsonValue | undefined): [string[], JsonValue | undefined];
//# sourceMappingURL=action_parser.d.ts.map