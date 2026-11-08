// Model clients of the Deno host, from a run's saved provider configuration
// (Rust `DefaultLlmClientFactory`): credentials are re-resolved from their
// references (`SecretRef`), never read from run.json.
//
//   openai  → the dev `OpenAiLlmClient` (`base_url`, `api_key` / `api_key_env`
//             or `OPENAI_API_KEY`, `headers`); no key → `capability`
//   buckyos → websdk's node runtime as an AppClient with the session in
//             `BUCKYOS_APPCLIENT_SESSION_TOKEN` (or `provider.session_token`)
//             → `getAiccClient()`. Without a session the client refuses every
//             request as `credentials`, so the run pauses (`last_error.kind =
//             credentials`) until it is resumed with a session.

import type { LlmClient, ProviderConfig, SecretRef } from '../../core/types'
import type { AiccClient } from '../../../aicc_client'
import { XllmError, providerError } from '../../core/errors'
import { isObject } from '../../core/json'
import { REFUSED_CREDENTIALS } from '../../core/run'
import { AiccLlmClient } from '../../providers/aicc'
import { OpenAiLlmClient } from '../../dev/openai'
import { deno, errorText } from './deno_api'

export const SESSION_TOKEN_ENV = 'BUCKYOS_APPCLIENT_SESSION_TOKEN'

/**
 * `SecretRef::resolve`. A `config_file` reference is re-read; the Deno host
 * reads JSON configuration files (a reference into a YAML `.llm_context`
 * written by Rust is a `capability` error here).
 */
export async function resolveSecret(ref: SecretRef): Promise<string> {
  if (ref.kind === 'env') {
    const v = deno().env.get(ref.name)
    if (v === undefined) throw XllmError.capability(`environment variable \`${ref.name}\` is not set`)
    return v
  }
  let raw: string
  try {
    raw = await deno().readTextFile(ref.path)
  } catch (e) {
    throw XllmError.capability(`cannot re-read credential source ${ref.path}:${ref.field}: ${errorText(e)}`)
  }
  let doc: unknown
  try {
    doc = JSON.parse(raw)
  } catch (e) {
    throw XllmError.capability(`cannot parse credential source ${ref.path} (the Deno host reads JSON configuration): ${errorText(e)}`)
  }
  let cur: unknown = doc
  for (const seg of ref.field.split('.')) {
    if (!isObject(cur) || !(seg in cur)) throw XllmError.capability(`credential field \`${ref.field}\` no longer exists in ${ref.path}`)
    cur = cur[seg]
  }
  if (typeof cur !== 'string' || !cur.trim()) throw XllmError.capability(`credential field \`${ref.field}\` in ${ref.path} is empty or not a string`)
  return cur
}

/** A client whose every request is refused as `credentials` (no session on this host). */
export function credentialsRefusedClient(message: string): LlmClient {
  return {
    // deno-lint-ignore require-await
    async infer() {
      throw providerError({ refused: { code: REFUSED_CREDENTIALS } }, message)
    },
  }
}

interface NodeSdk {
  BuckyOSSDK: new (target: 'node') => {
    initBuckyOS(appId: string, config: Record<string, unknown>): Promise<void>
    getAiccClient(): AiccClient
  }
}

/**
 * websdk's node entry (`buckyos/node`, `dist/node.mjs` beside this bundle),
 * loaded only when a run uses the buckyos provider.
 */
async function loadNodeSdk(): Promise<NodeSdk> {
  // @ts-ignore: the SDK's tsc build is CommonJS; this bundle is ESM (Deno)
  const url = new URL('./node.mjs', import.meta.url).href
  return await import(/* @vite-ignore */ url) as NodeSdk
}

/** The model client of `provider` on this host. */
export async function createLlmClient(provider: ProviderConfig): Promise<LlmClient> {
  if ((provider.kind ?? 'buckyos') === 'openai') {
    const key = provider.api_key ? await resolveSecret(provider.api_key) : deno().env.get('OPENAI_API_KEY')
    if (!key?.trim()) {
      throw XllmError.capability('openai provider: no API key; set `provider.api_key`, `provider.api_key_env` or the OPENAI_API_KEY environment variable')
    }
    return new OpenAiLlmClient({ baseUrl: provider.base_url, apiKey: key, headers: provider.headers })
  }
  if (provider.on_behalf_of !== undefined && provider.on_behalf_of !== null) {
    throw XllmError.capability('buckyos provider: `on_behalf_of` (a system service paying for a user) is not available on the Deno host')
  }
  const token = provider.session_token ? await resolveSecret(provider.session_token) : deno().env.get(SESSION_TOKEN_ENV)?.trim()
  if (!token) {
    return credentialsRefusedClient(`buckyos provider: no BuckyOS session on this host (set ${SESSION_TOKEN_ENV}), sign in and resume`)
  }
  const appId = deno().env.get('BUCKYOS_APP_ID')?.trim() || 'buckycli'
  const sdk = new (await loadNodeSdk()).BuckyOSSDK('node')
  try {
    await sdk.initBuckyOS(appId, {
      zoneHost: deno().env.get('BUCKYOS_ZONE_HOST')?.trim() ?? '',
      appId,
      defaultProtocol: 'https://',
      runtimeType: 'AppClient',
      sessionToken: token,
      privateKeySearchPaths: [],
      autoRenew: false,
    })
  } catch (e) {
    throw XllmError.capability(`buckyos provider: cannot initialize the BuckyOS runtime (check zone/session setup): ${errorText(e)}`)
  }
  return new AiccLlmClient(sdk.getAiccClient())
}
