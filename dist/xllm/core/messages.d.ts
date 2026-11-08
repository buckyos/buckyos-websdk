import type { AiMessage, AiRole } from '../../aicc_client';
import type { AiResponse, AiToolCall, AiUsage, JsonValue, Observation } from './types';
export declare function nowMs(): number;
export declare function textMessage(role: AiRole, text: string): AiMessage;
/** All text blocks joined by `\n` (`AiMessage::text_content`). */
export declare function textContent(message: AiMessage): string;
/** Tool-use blocks as calls, in message order (`AiMessage::tool_calls`). */
export declare function toolCalls(message: AiMessage): AiToolCall[];
/** `AiResponse::validate`: an assistant message with blocks allowed for the role and tool calls with ids. */
export declare function validateResponse(response: AiResponse): string | undefined;
/** The tool-role message carrying one observation back to the model. */
export declare function toolObservationMessage(callId: string, observation: Observation): AiMessage;
/** Sum of two usages (`merge_usage`): counters add, `cost` adds per currency, `reported_cost` is dropped. */
export declare function mergeUsage(left: AiUsage, right: AiUsage): AiUsage;
/** `add_usage` of the run record: input / output / total tokens and request units. */
export declare function addRecordUsage(base: AiUsage | undefined, extra: AiUsage): AiUsage;
export declare function argsOf(args: Record<string, JsonValue> | undefined): Record<string, JsonValue>;
//# sourceMappingURL=messages.d.ts.map