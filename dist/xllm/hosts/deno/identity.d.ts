import type { JsonValue } from '../../core/types';
/** Names the local execution environment where the hostname is not a stable identity (`HOST_ID_ENV`). */
export declare const HOST_ID_ENV = "AGENT_TOOL_HOST_ID";
export declare function blake3Hex(text: string): string;
/** The inputs of `native_host_id` (`null`: unset / unreadable). */
export interface HostIdInputs {
    agent_tool_host_id: string | null;
    etc_hostname: string | null;
    hostname_env: string | null;
    machine_id: string | null;
}
/** `native_host_id_from`: `AGENT_TOOL_HOST_ID` when not blank, else /etc/hostname (or `HOSTNAME`) + /etc/machine-id. */
export declare function nativeHostIdFrom(i: HostIdInputs): string;
/** `native_host_id()` of this machine. */
export declare function nativeHostId(): Promise<string>;
/** `native_target`: what a native runtime's identity is made of. */
export declare function nativeTarget(hostId: string, uid: string): {
    host: string;
    uid: string;
};
/** The exact text blake3 hashes for a runtime id (serde_json: sorted keys, compact). */
export declare function targetText(target: JsonValue): string;
/** `derive_runtime_id`: the configured id, else `<kind>:` + blake3(target)[..24]. */
export declare function deriveRuntimeId(configuredId: string | null | undefined, kind: string, target: JsonValue): string;
/** `<kind>:` + the first 24 hex of blake3 over the target's JSON (serde_json: sorted keys, compact). */
export declare function runtimeIdOf(kind: string, target: JsonValue): string;
/** `<lockDir>/<blake3(workdir)[..24]>.lock` (`workdir_lock_path`). */
export declare function workdirLockPath(lockDir: string, workdir: string): string;
//# sourceMappingURL=identity.d.ts.map