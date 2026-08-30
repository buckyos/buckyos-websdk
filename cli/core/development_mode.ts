import { buckyos } from 'buckyos/node'
import type { ResolvedConfig } from './config.ts'
import { resolveServiceUrl } from './runtime.ts'

export const BUCKYOS_DEV_CONFIG_KEY = 'system/buckyos_dev_config'
export const BUCKYOS_DEV_CONFIG_SCHEMA_VERSION = 1

export interface BuckyOSDevConfig {
  schema_version: 1
  enabled: boolean
  enabled_at: number | null
  enabled_by: string | null
}

export type DevelopmentModeDecision =
  | { state: 'enabled'; config: BuckyOSDevConfig }
  | { state: 'disabled'; config: BuckyOSDevConfig }
  | { state: 'unavailable'; reason: string }

export type DevelopmentModeReader = (
  config: ResolvedConfig,
) => Promise<DevelopmentModeDecision>

interface PublicRpcClient {
  call<T>(method: string, params: Record<string, unknown>): Promise<T>
}

/**
 * Read the target Zone's public developer-mode setting.
 *
 * This deliberately uses control-panel's unauthenticated `system.dev_mode.get`
 * endpoint: developer mode must be known before a local identity is touched or
 * exchanged at verify-hub. Every error is converted to `unavailable`, which is
 * a fail-closed result for the identity resolver.
 */
export async function readTargetDevelopmentMode(
  config: ResolvedConfig,
): Promise<DevelopmentModeDecision> {
  try {
    const url = resolveServiceUrl(config, 'control-panel')
    const client = new buckyos.kRPCClient(url) as unknown as PublicRpcClient
    const value = await withTimeout(
      client.call<unknown>('system.dev_mode.get', {}),
      config.timeoutMs,
    )
    const parsed = parseBuckyOSDevConfig(value)
    return parsed.enabled
      ? { state: 'enabled', config: parsed }
      : { state: 'disabled', config: parsed }
  } catch (error) {
    return {
      state: 'unavailable',
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

export function parseBuckyOSDevConfig(value: unknown): BuckyOSDevConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('BuckyOSDevConfig must be an object')
  }
  const config = value as Record<string, unknown>
  const keys = Object.keys(config).sort()
  const expectedKeys = ['enabled', 'enabled_at', 'enabled_by', 'schema_version']
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
    throw new Error('BuckyOSDevConfig contains missing or unsupported fields')
  }
  if (config.schema_version !== BUCKYOS_DEV_CONFIG_SCHEMA_VERSION) {
    throw new Error(`unsupported BuckyOSDevConfig schema_version ${String(config.schema_version)}`)
  }
  if (typeof config.enabled !== 'boolean') {
    throw new Error('BuckyOSDevConfig enabled must be a boolean')
  }
  const enabledAt = config.enabled_at
  const enabledBy = config.enabled_by
  const hasAuditFields = Number.isSafeInteger(enabledAt) && (enabledAt as number) > 0 &&
    typeof enabledBy === 'string' && enabledBy.trim().length > 0
  const hasNoAuditFields = enabledAt === null && enabledBy === null
  if (!hasAuditFields && !hasNoAuditFields) {
    throw new Error('BuckyOSDevConfig enabled_at and enabled_by must be valid and present together')
  }
  if (config.enabled && !hasAuditFields) {
    throw new Error('enabled BuckyOSDevConfig requires enable audit fields')
  }
  return {
    schema_version: 1,
    enabled: config.enabled,
    enabled_at: enabledAt as number | null,
    enabled_by: enabledBy as string | null,
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('developer-mode lookup timed out')), timeoutMs)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
