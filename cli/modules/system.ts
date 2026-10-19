import type { CommandModule, JsonSchema } from '../core/command.ts'
import type { CommandContext } from '../core/context.ts'
import { callService, expectObject } from '../core/service.ts'

const CONTROL_PANEL = 'control-panel'
const EMPTY_INPUT: JsonSchema = { type: 'object', properties: {}, additionalProperties: false }
const BUCKYOS_INFO: JsonSchema = {
  type: 'object',
  properties: {
    version: { type: 'string' },
    build_version: { type: 'string' },
    release_channel: { type: 'string' },
    target: { type: 'string' },
  },
  additionalProperties: true,
}

export function createSystemModule(): CommandModule {
  return {
    name: 'system',
    summary: 'Inspect BuckyOS Zone health and version state',
    commands: [
      {
        verb: 'status',
        summary: 'Get host resource state, configured service keys, and the BuckyOS version',
        description:
          'state and warnings come from CPU/memory/disk/swap of the Control Panel host; services lists the keys under services/ with status unknown (not a per-service health check); buckyos is the system.buckyos_info.get record.',
        inputSchema: EMPTY_INPUT,
        outputSchema: {
          type: 'object',
          properties: { buckyos: BUCKYOS_INFO },
          required: ['buckyos'],
          additionalProperties: true,
        },
        resultSchemaVersion: 1,
        access: { mode: 'fixed', level: 'read' },
        asyncMode: 'sync',
        requiresSession: true,
        examples: ['buckyos --profile production system status'],
        handler: async (ctx) => {
          const [status, buckyos] = await Promise.all([
            callService(ctx, CONTROL_PANEL, 'system.status', {}),
            buckyosInfo(ctx),
          ])
          return { ...expectObject(status, 'system.status'), buckyos }
        },
      },
      {
        verb: 'info',
        summary: 'Get the installed BuckyOS version, build version, and release channel',
        description:
          'build_version is build<YYMMDD>.<branch>.<commit12>[.dirty]; any authenticated identity may read it.',
        inputSchema: EMPTY_INPUT,
        outputSchema: BUCKYOS_INFO,
        resultSchemaVersion: 1,
        access: { mode: 'fixed', level: 'read' },
        asyncMode: 'sync',
        requiresSession: true,
        examples: ['buckyos system info'],
        handler: async (ctx) => await buckyosInfo(ctx),
      },
    ],
  }
}

async function buckyosInfo(ctx: CommandContext): Promise<Record<string, unknown>> {
  return expectObject(
    await callService(ctx, CONTROL_PANEL, 'system.buckyos_info.get', {}),
    'system.buckyos_info.get',
  )
}
