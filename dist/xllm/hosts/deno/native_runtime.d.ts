import type { AiToolCall, EffectiveTools, Observation, RuntimeConfig, RuntimeDescriptor, ToolSpecLite } from '../../core/types';
import type { ToolCallCtx } from '../../core/deps';
import type { AgentRuntime, RunBinding, RunToolManager } from '../../runtime/types';
import type { HintLedger } from '../../runtime/hints';
import type { RunningTaskResolver } from '../../runtime/task_model';
import type { NativeTool } from './native_tools';
export declare const NATIVE_KIND = "native";
/** `LOCAL_PROBE` (`runtime/ssh.rs`), run as `/bin/bash -c` in the runtime's cwd with its env. */
export declare const LOCAL_PROBE = "set -e\ncommand -v bash >/dev/null\nmachine_id=\"$(cat /etc/machine-id 2>/dev/null || true)\"\n[ -n \"$machine_id\" ] || machine_id=\"$(hostname)\"\nprintf '%s\\0' \"$machine_id\" \"$(hostname)\" \"$(id -u)\" \"$(uname -s | tr '[:upper:]' '[:lower:]')\" \"$(uname -m)\" \"$(command -v bash)\" \"$(pwd -P)\" \"${PATH}\" \"$(date +%Y-%m-%dT%H:%M:%S%z)\" \"$(date +%Z%z)\"\nfor tool in bash realpath base64; do if command -v \"$tool\" >/dev/null; then printf '%s\\0' \"$tool\"; fi; done\n";
export interface Probe {
    machine: string;
    hostname: string;
    uid: string;
    os: string;
    arch: string;
    shell: string;
    cwd: string;
    path: string;
    current_time: string;
    timezone: string;
    tools: string[];
}
/** `parse_probe`: NUL-separated fields, the first ten non-empty. */
export declare function parseProbe(bytes: Uint8Array): Probe;
/** Run `LOCAL_PROBE` in `cwd` (10 s at most). */
export declare function localProbe(cwd: string, env: Record<string, string>): Promise<Probe>;
/** The dispatcher of a native run (Rust `XllmToolManager` over the bash group). */
export declare class NativeToolManager implements RunToolManager {
    private readonly tools;
    private readonly workdir;
    /** Resume: the specs saved with the run, shown instead of the tools' own (freeze TODO F6). */
    private readonly advertised?;
    private binding;
    private recovering;
    private readonly ledger;
    private readonly written;
    constructor(tools: Map<string, NativeTool>, workdir: string, 
    /** Resume: the specs saved with the run, shown instead of the tools' own (freeze TODO F6). */
    advertised?: Map<string, ToolSpecLite> | undefined);
    bindRun(binding: RunBinding): void;
    setRecovering(callId: string, reason: string): void;
    artifacts(): string[];
    has(name: string): boolean;
    hintLedger(): HintLedger;
    clearDedup(): void;
    taskResolver(): RunningTaskResolver | undefined;
    listToolSpecs(): ToolSpecLite[];
    private names;
    callTool(call: AiToolCall, ctx: ToolCallCtx): Promise<Observation>;
}
export interface NativeRuntimeOptions {
    /** The configuration's `runtime` block (kind `native`): `workdir`, `env`, `id`, `baseline`, `task_wait_ms`. */
    config?: RuntimeConfig;
    /** Where the runtime works when `config.workdir` is unset (default: the current directory). */
    workdir?: string;
    /**
     * Taking over a saved run: `open` for this run id rebuilds the run's saved
     * tool sources and shows the model the specs saved with them (F6).
     */
    takeover?: {
        run_id: string;
        tools: EffectiveTools;
    };
}
export interface NativeRuntime extends AgentRuntime {
    readonly kind: 'native';
    /** The probe the runtime was opened with. */
    readonly probe: Probe;
}
/** `runtime_descriptor` of a native runtime: identity from the target, workdir / os / tools from the probe. */
export declare function nativeDescriptor(runtimeId: string, target: {
    host: string;
    uid: string;
}, probe: {
    cwd: string;
    os: string;
    tools: string[];
}): RuntimeDescriptor;
/** Open the native runtime (`Runtime::initialize`): validate, resolve the cwd, probe, derive the identity. */
export declare function createNativeRuntime(options?: NativeRuntimeOptions): Promise<NativeRuntime>;
/** What a `shell` command's execution directory says (`ExecDirFacts`). */
export interface ExecDirFacts {
    exit_code?: number;
    stdout_tail: string;
    stderr_tail: string;
    exists: boolean;
    /** mtime of `command`: when the command was written there. */
    started_at_ms?: number;
}
export declare function readExecDir(dir: string): Promise<ExecDirFacts>;
/** `interrupted_shell_text` for the native kind. */
export declare function interruptedShellText(call: AiToolCall, facts: ExecDirFacts | undefined, location: string): string;
//# sourceMappingURL=native_runtime.d.ts.map