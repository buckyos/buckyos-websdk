import { AiccLlmClient, aiccProviderFailure, providerErrorFromRpc, REFUSED_UNSUPPORTED_OPERATION } from '../../src/xllm/providers/aicc'
import { classifyError } from '../../src/xllm/core/run'
import { RPCError } from '../../src/krpc_client'
import type { AiccClient } from '../../src/aicc_client'

const error = { code: REFUSED_UNSUPPORTED_OPERATION, message: 'quality is unsupported on selected-model', retriable: true } as const

it('keeps an unsupported-operation refusal across RPC and failed-response paths', async () => {
  expect(aiccProviderFailure(error)).toEqual({ refused: { code: REFUSED_UNSUPPORTED_OPERATION } })
  const rpc = providerErrorFromRpc('image', new RPCError(error.message, error.code, error))
  const client = new AiccLlmClient({ helperLlmChat: async () => ({ status: 'failed', error }) } as unknown as AiccClient)
  let failed: unknown
  try { await client.infer({ messages: [], allow_tool_calls: false, tool_specs: [], model_alias: 'llm.chat', fallbacks: [], force_json: false, disable_capabilities: [], signal: new AbortController().signal }) } catch (caught) { failed = caught }
  for (const exception of [rpc, failed] as typeof rpc[]) {
    expect(exception.error).toMatchObject({ kind: 'provider', failure: { refused: { code: REFUSED_UNSUPPORTED_OPERATION } } })
    expect(classifyError(exception.error)).toMatchObject({ kind: REFUSED_UNSUPPORTED_OPERATION, recoverable: false,
      condition: 'the selected model does not support the requested operation or parameters; change the parameters or explicitly select a suitable model before resuming' })
  }
})
