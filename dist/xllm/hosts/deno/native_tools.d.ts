import type { JsonValue, ToolSpecLite } from '../../core/types';
import type { ToolCallCtx } from '../../core/deps';
import type { AgentToolResult } from '../../runtime/tool_result';
export declare const TOOL_READ_FILE = "read_file";
export declare const TOOL_WRITE_FILE = "write_file";
export declare const TOOL_EDIT_FILE = "edit_file";
export declare const TOOL_SHELL = "shell";
export declare const BASH_GROUP_TOOLS: string[];
/** `EXEC_MAX_OUTPUT_BYTES`: what one `shell` call keeps of each stream. */
export declare const EXEC_MAX_OUTPUT_BYTES: number;
/** Bytes of output in a progress / cancel / interrupted text (`OUTPUT_TAIL_BYTES`). */
export declare const OUTPUT_TAIL_BYTES = 2048;
export declare const TIMEOUT_EXIT_CODE = 124;
export declare const ENV_CALL_ID = "XLLM_CALL_ID";
export declare const ENV_RUN_ID = "XLLM_RUN_ID";
export type ToolErrorKind = 'invalid_args' | 'exec_failed' | 'timeout' | 'transport' | 'cancelled';
/** `AgentToolError`: the message is its Display text. */
export declare class NativeToolError extends Error {
    readonly kind: ToolErrorKind;
    readonly detail: string;
    readonly effectUnknown: boolean;
    constructor(kind: ToolErrorKind, detail: string, effectUnknown?: boolean);
}
/** `tokenize_bash_command_line`. */
export declare function tokenizeBashCommandLine(line: string): string[] | undefined;
/** `build_builtin_tool_result(detail, cmd_line, summary)` (+ `with_tool`). */
export declare function builtinResult(tool: string, detail: JsonValue, cmdLine: string, summary: string): AgentToolResult;
/** `LocalFileBackend::resolve`: the lexical path and the real path must both be under an allowed root. */
export declare function resolvePath(root: string, raw: string, allowed: string[]): Promise<string>;
export interface FileToolConfig {
    /** The working directory (real path). */
    root: string;
    allowedRead: string[];
    allowedWrite: string[];
    /** `$BUCKYOS_ROOT/data` on this machine. */
    dfsRoot?: string;
}
export interface NativeToolCtx {
    call_id: string;
    run_id: string;
    run_dir?: string;
    call: ToolCallCtx;
}
export interface NativeTool {
    spec: ToolSpecLite;
    idempotent: boolean;
    /** Observes the call's cancellation itself (`shell`). */
    cancellable: boolean;
    call(args: Record<string, JsonValue>, ctx: NativeToolCtx): Promise<AgentToolResult>;
}
export declare const READ_FILE_SPEC: ToolSpecLite;
export declare const WRITE_FILE_SPEC: ToolSpecLite;
export declare const EDIT_FILE_SPEC: ToolSpecLite;
/** `read_file` (`ReadFileTool` behind `DedupReadFile`). */
export declare function readFileTool(cfg: FileToolConfig): NativeTool;
/** `write_file`. */
export declare function writeFileTool(cfg: FileToolConfig): NativeTool;
/** `edit_file`. */
export declare function editFileTool(cfg: FileToolConfig): NativeTool;
/**
 * Wrapper run as `bash -c WRAPPER <command> <exec_dir>` (`NATIVE_WRAPPER`):
 * output to files, exit code to `exit`, so the command outlives the executor
 * without SIGPIPE and its end is readable after a crash.
 */
export declare const NATIVE_WRAPPER = "if [ \"$#\" -ge 2 ]; then export PATH=\"$2\"; fi\nprintf '%s\\n' \"$0\" > \"$1/command\"\n\"$BASH\" -c \"$0\" </dev/null >\"$1/stdout\" 2>\"$1/stderr\"\n__llm_ec=$?\nprintf '%s\\n' \"$__llm_ec\" > \"$1/exit.tmp\" && command -p mv -f \"$1/exit.tmp\" \"$1/exit\"\nexit $__llm_ec";
/** `sanitize_call_id`. */
export declare function sanitizeCallId(callId: string): string;
/** `<run_dir>/exec/<call_id>` (`exec_dir_for`). */
export declare function execDirFor(runDir: string | undefined, callId: string | undefined): string | undefined;
/** `fmt_elapsed`. */
export declare function fmtElapsed(ms: number): string;
/** `read_file_tail`: the last `max` bytes as text. */
export declare function readFileTail(path: string, max: number): Promise<string>;
/** `read_exit_file`. */
export declare function readExitFile(dir: string): Promise<number | undefined>;
interface ShellOutput {
    exit_code: number;
    stdout: string;
    stderr: string;
    output: string;
    output_truncated: boolean;
    timed_out: boolean;
    duration_ms: number;
    cwd: string;
}
export interface ShellToolConfig {
    workspace: string;
    restrictCwd: boolean;
    timeoutMs: number;
    maxTimeoutMs: number;
    /** The runtime's environment for every command (`runtime.env`, PATH). */
    env: Record<string, string>;
}
/** `shell`'s spec in its wait form (Rust `ShellTool::spec`, `ShellMode::Wait`, native, bash). */
export declare function shellSpec(cfg: {
    restrictCwd: boolean;
    timeoutMs: number;
    maxTimeoutMs: number;
}): ToolSpecLite;
/** `shell` (Rust `ShellTool` with `LocalProcessBashRunner`, wait form). */
export declare function shellTool(cfg: ShellToolConfig): NativeTool;
/** `shell_finished_result`. */
export declare function shellFinishedResult(command: string, out: ShellOutput, timeoutMs: number, maxTimeoutMs: number): AgentToolResult;
export {};
//# sourceMappingURL=native_tools.d.ts.map