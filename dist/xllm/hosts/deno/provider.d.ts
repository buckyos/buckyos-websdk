import type { LlmClient, ProviderConfig, SecretRef } from '../../core/types';
export declare const SESSION_TOKEN_ENV = "BUCKYOS_APPCLIENT_SESSION_TOKEN";
/**
 * `SecretRef::resolve`. A `config_file` reference is re-read; the Deno host
 * reads JSON configuration files (a reference into a YAML `.llm_context`
 * written by Rust is a `capability` error here).
 */
export declare function resolveSecret(ref: SecretRef): Promise<string>;
/** A client whose every request is refused as `credentials` (no session on this host). */
export declare function credentialsRefusedClient(message: string): LlmClient;
/** The model client of `provider` on this host. */
export declare function createLlmClient(provider: ProviderConfig): Promise<LlmClient>;
//# sourceMappingURL=provider.d.ts.map