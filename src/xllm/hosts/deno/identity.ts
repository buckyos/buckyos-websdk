// Identity of the native runtime and of locks, byte for byte as Rust:
// `native_host_id()` (`AGENT_TOOL_HOST_ID`, else /etc/hostname +
// /etc/machine-id), `runtime_id` = `native:` + blake3(target JSON)[..24],
// workdir lock = blake3(workdir display string)[..24].lock (vector (h)).

import { blake3 } from '@noble/hashes/blake3.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { JsonValue } from '../../core/types'
import { canonicalJson } from '../../core/json'
import { deno, joinPath } from './deno_api'

/** Names the local execution environment where the hostname is not a stable identity (`HOST_ID_ENV`). */
export const HOST_ID_ENV = 'AGENT_TOOL_HOST_ID'

export function blake3Hex(text: string): string {
  return bytesToHex(blake3(new TextEncoder().encode(text)))
}

async function readText(path: string): Promise<string | null> {
  try {
    return await deno().readTextFile(path)
  } catch {
    return null
  }
}

/** The inputs of `native_host_id` (`null`: unset / unreadable). */
export interface HostIdInputs {
  agent_tool_host_id: string | null
  etc_hostname: string | null
  hostname_env: string | null
  machine_id: string | null
}

/** `native_host_id_from`: `AGENT_TOOL_HOST_ID` when not blank, else /etc/hostname (or `HOSTNAME`) + /etc/machine-id. */
export function nativeHostIdFrom(i: HostIdInputs): string {
  const id = i.agent_tool_host_id?.trim()
  if (id) return `host:${id}:`
  const host = i.etc_hostname ?? i.hostname_env ?? 'unknown'
  return `host:${host.trim()}:${(i.machine_id ?? '').trim()}`
}

/** `native_host_id()` of this machine. */
export async function nativeHostId(): Promise<string> {
  const env = deno().env.get(HOST_ID_ENV) ?? null
  if (env?.trim()) return nativeHostIdFrom({ agent_tool_host_id: env, etc_hostname: null, hostname_env: null, machine_id: null })
  return nativeHostIdFrom({
    agent_tool_host_id: env,
    etc_hostname: await readText('/etc/hostname'),
    hostname_env: deno().env.get('HOSTNAME') ?? null,
    machine_id: await readText('/etc/machine-id'),
  })
}

/** `native_target`: what a native runtime's identity is made of. */
export function nativeTarget(hostId: string, uid: string): { host: string; uid: string } {
  return { host: hostId, uid }
}

/** The exact text blake3 hashes for a runtime id (serde_json: sorted keys, compact). */
export function targetText(target: JsonValue): string {
  return canonicalJson(target)
}

/** `derive_runtime_id`: the configured id, else `<kind>:` + blake3(target)[..24]. */
export function deriveRuntimeId(configuredId: string | null | undefined, kind: string, target: JsonValue): string {
  return configuredId ?? runtimeIdOf(kind, target)
}

/** `<kind>:` + the first 24 hex of blake3 over the target's JSON (serde_json: sorted keys, compact). */
export function runtimeIdOf(kind: string, target: JsonValue): string {
  return `${kind}:${blake3Hex(targetText(target)).slice(0, 24)}`
}

/** `<lockDir>/<blake3(workdir)[..24]>.lock` (`workdir_lock_path`). */
export function workdirLockPath(lockDir: string, workdir: string): string {
  return joinPath(lockDir, `${blake3Hex(workdir).slice(0, 24)}.lock`)
}
