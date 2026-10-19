import type { CommandModule, JsonSchema, OptionDefinition } from '../core/command.ts'
import type { CommandContext } from '../core/context.ts'
import { EXIT_INTERNAL, EXIT_PERMISSION, ToolError, UsageError } from '../core/errors.ts'
import { callService, requiredInputString } from '../core/service.ts'
import { getHost } from '../runtime/host.ts'
import { openZip, readTarGz, readZipEntry, sha256Bytes } from './pikg_archive.ts'
import { inspectPikg } from './pikg_protocol.ts'

const OBJECT_OUTPUT: JsonSchema = { type: 'object', additionalProperties: true }
const SKILL_KINDS = ['cmd', 'goal']
const SKILLS_SUB_PKG = 'agent_skills'
const SKILL_DIRS = ['cmd_skills', 'goal_skills', 'tools']
const MAX_SKILL_PAYLOAD_BYTES = 64 * 1024 * 1024
const AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

const AGENT_OPTION: OptionDefinition = {
  name: 'agent',
  property: 'agent_id',
  description: 'Agent ID; the Agent serves kRPC at /kapi/<agent_id>',
  type: 'string',
  required: true,
}

const KIND_OPTION: OptionDefinition = {
  name: 'kind',
  description: 'Skill kind',
  type: 'string',
  enum: SKILL_KINDS,
}

export function createSkillModule(): CommandModule {
  return {
    name: 'skill',
    summary: 'List, install, and remove the cmd/goal skills of an Agent',
    commands: [
      {
        verb: 'list',
        summary: 'List the skills of an Agent',
        options: [AGENT_OPTION, KIND_OPTION],
        inputSchema: {
          type: 'object',
          properties: {
            agent_id: { type: 'string', minLength: 1 },
            kind: { type: 'string', enum: SKILL_KINDS },
          },
          required: ['agent_id'],
          additionalProperties: false,
        },
        outputSchema: OBJECT_OUTPUT,
        resultSchemaVersion: 1,
        access: { mode: 'fixed', level: 'read' },
        asyncMode: 'sync',
        requiresSession: true,
        examples: [
          'buckyos skill list --agent jarvis.example.zone',
          'buckyos skill list --agent jarvis.example.zone --kind cmd',
        ],
        handler: async (ctx, input) => {
          const agentId = agentIdFrom(input)
          const kind = typeof input.kind === 'string' ? input.kind : undefined
          const skills = await listSkills(ctx, agentId, kind)
          return { agent_id: agentId, ...(kind ? { kind } : {}), total: skills.length, skills }
        },
      },
      {
        verb: 'install',
        summary: 'Install the skills of a skill PIKG into an Agent',
        description:
          'Verifies the PIKG offline, requires app_type agent_skills, and sends the files of its agent_skills sub package (cmd_skills/, goal_skills/, tools/) to the Agent. Sessions created before keep their frozen manuals.',
        positionals: [{ name: 'pikg_path', description: 'Local skill .pikg file' }],
        options: [
          AGENT_OPTION,
          {
            name: 'replace',
            description: 'Replace skills of the same names from another package',
            type: 'boolean',
          },
        ],
        inputSchema: {
          type: 'object',
          properties: {
            pikg_path: { type: 'string', minLength: 1 },
            agent_id: { type: 'string', minLength: 1 },
            replace: { type: 'boolean' },
          },
          required: ['pikg_path', 'agent_id'],
          additionalProperties: false,
        },
        outputSchema: OBJECT_OUTPUT,
        resultSchemaVersion: 1,
        access: { mode: 'fixed', level: 'write' },
        asyncMode: 'sync',
        requiresSession: true,
        examples: [
          'buckyos skill install ./dapp_dist/hello-skills-0.1.0.pikg --agent jarvis.example.zone',
          'buckyos skill install ./hello-skills-0.2.0.pikg --agent jarvis.example.zone --replace',
        ],
        handler: async (ctx, input) => await installSkills(ctx, input),
      },
      {
        verb: 'remove',
        summary: 'Remove an installed skill from an Agent',
        description:
          'Only installed skills can be removed. Without --kind the kind is looked up by name.',
        positionals: [{ name: 'name', description: 'Skill name' }],
        options: [AGENT_OPTION, KIND_OPTION],
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1 },
            agent_id: { type: 'string', minLength: 1 },
            kind: { type: 'string', enum: SKILL_KINDS },
          },
          required: ['name', 'agent_id'],
          additionalProperties: false,
        },
        outputSchema: OBJECT_OUTPUT,
        resultSchemaVersion: 1,
        access: { mode: 'fixed', level: 'destructive' },
        asyncMode: 'sync',
        requiresSession: true,
        examples: ['buckyos --yes skill remove hello --agent jarvis.example.zone --kind cmd'],
        handler: async (ctx, input) => await removeSkill(ctx, input),
      },
    ],
  }
}

async function installSkills(
  ctx: CommandContext,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const agentId = agentIdFrom(input)
  const raw = requiredInputString(input, 'pikg_path')
  const path = getHost().path.isAbsolute(raw)
    ? getHost().path.resolve(raw)
    : getHost().path.resolve(ctx.cwd, raw)
  const inspection = await inspectPikg(path)
  if (inspection.app.app_type !== SKILLS_SUB_PKG) {
    throw new UsageError(
      'NOT_A_SKILL_PACKAGE',
      `PIKG app_type is ${inspection.app.app_type}; a skill package has app_type ${SKILLS_SUB_PKG} (buckyos pikg init --kind agent-skills)`,
    )
  }
  const payload = inspection.subpackages.find((item) => item.key === SKILLS_SUB_PKG)
    ?.payload as { path: string; digest: string }
  const archive = await openZip(path)
  const bytes = await readZipEntry(
    archive,
    archive.byName.get(payload.path)!,
    MAX_SKILL_PAYLOAD_BYTES,
  )
  if (`sha256:${sha256Bytes(bytes)}` !== payload.digest) {
    throw new ToolError('INVALID_PACKAGE', 'PIKG changed after it was verified')
  }
  const files: Record<string, { content: string; executable: boolean }> = {}
  const ignored: string[] = []
  for (const entry of await readTarGz(bytes, MAX_SKILL_PAYLOAD_BYTES)) {
    if (!SKILL_DIRS.includes(entry.path.split('/')[0])) {
      ignored.push(entry.path)
      continue
    }
    files[entry.path] = { content: base64(entry.bytes), executable: entry.executable }
  }
  const result = await callService<unknown>(ctx, agentId, 'skills.install', {
    package: {
      package: inspection.app.name,
      version: inspection.app.version,
      pikg_digest: inspection.pikg_digest,
      files,
    },
    replace: input.replace === true,
  })
  return {
    agent_id: agentId,
    pikg_path: inspection.pikg_path,
    pikg_digest: inspection.pikg_digest,
    ...expectObject(result, 'skills.install'),
    ...(ignored.length ? { ignored_files: ignored } : {}),
  }
}

async function removeSkill(
  ctx: CommandContext,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const agentId = agentIdFrom(input)
  const name = requiredInputString(input, 'name')
  let kind = typeof input.kind === 'string' ? input.kind : undefined
  if (!kind) {
    const kinds = (await listSkills(ctx, agentId)).filter((skill) => skill.name === name)
      .map((skill) => String(skill.kind))
    if (kinds.length === 0) {
      throw new ToolError('RESOURCE_NOT_FOUND', `Agent ${agentId} has no skill named ${name}`)
    }
    if (kinds.length > 1) {
      throw new UsageError('AMBIGUOUS_SKILL', `${name} is both a cmd and a goal skill; use --kind`)
    }
    kind = kinds[0]
  }
  if (!ctx.confirmed) {
    if (ctx.config.nonInteractive || !ctx.io.inputIsTerminal) {
      throw new ToolError(
        'CONFIRMATION_REQUIRED',
        'skill remove requires --yes in non-interactive execution',
        EXIT_PERMISSION,
      )
    }
    const answer = (await ctx.io.prompt(`Remove ${kind} skill ${name} from ${agentId}? [y/N] `))
      ?.trim().toLowerCase()
    if (answer !== 'y' && answer !== 'yes') {
      throw new ToolError('CONFIRMATION_DECLINED', 'skill remove was declined', EXIT_PERMISSION)
    }
  }
  const removed = await callService<unknown>(ctx, agentId, 'skills.remove', { kind, name })
  return { agent_id: agentId, removed: expectObject(removed, 'skills.remove') }
}

async function listSkills(
  ctx: CommandContext,
  agentId: string,
  kind?: string,
): Promise<Record<string, unknown>[]> {
  const skills = await callService<unknown>(ctx, agentId, 'skills.list', kind ? { kind } : {})
  if (!Array.isArray(skills)) invalidResponse('skills.list')
  return (skills as unknown[]).map((skill) => expectObject(skill, 'skills.list'))
}

function agentIdFrom(input: Record<string, unknown>): string {
  const agentId = requiredInputString(input, 'agent_id')
  if (!AGENT_ID.test(agentId)) {
    throw new UsageError('INVALID_AGENT_ID', `invalid Agent ID: ${agentId}`)
  }
  return agentId
}

function expectObject(value: unknown, method: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidResponse(method)
  return value as Record<string, unknown>
}

function invalidResponse(method: string): never {
  throw new ToolError(
    'INVALID_SERVICE_RESPONSE',
    `Agent returned an invalid response for ${method}`,
    EXIT_INTERNAL,
  )
}

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}
