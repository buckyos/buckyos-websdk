import type { CommandDefinition, CommandModule, JsonSchema, OptionDefinition } from '../core/command.ts'
import type { CommandContext } from '../core/context.ts'
import { EXIT_INTERNAL, EXIT_PERMISSION, EXIT_UNAVAILABLE, ToolError, UsageError } from '../core/errors.ts'
import { callService, inputString, requiredInputString } from '../core/service.ts'
import { getHost, isHostError } from '../runtime/host.ts'
import { type AppModuleDependencies, classifySource, downloadPikg, isDidSource } from './app.ts'
import { openZip, readTarGz, readZipEntry, sha256Bytes } from './pikg_archive.ts'
import { inspectPikg } from './pikg_protocol.ts'
import { lintSkillPackage, readSkillDirectory, SKILL_DIRS, SKILL_KINDS, type SkillPackageFile } from './skill_lint.ts'

const OBJECT_OUTPUT: JsonSchema = { type: 'object', additionalProperties: true }
const SKILLS_SUB_PKG = 'agent_skills'
const SKILL_SCOPES = ['ui', 'work']
const IMPORT_SCOPES = ['work', 'ui', 'plan']
const SOURCE_KINDS = ['pikg', 'dir', 'url', 'did']
const MAX_SKILL_PAYLOAD_BYTES = 64 * 1024 * 1024
const MAX_IMPORT_TEXT_BYTES = 512 * 1024
const AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export interface SkillModuleDependencies {
  /** Downloads a skill PIKG (`skill install <url>`). */
  download?: AppModuleDependencies['download']
  /** Fetches the text `skill import <url>` hands to the Agent. */
  fetchText?: (url: URL, signal: AbortSignal) => Promise<string>
  readStdin?: () => Promise<string>
}

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
  enum: [...SKILL_KINDS],
}

const RUNTIME_OPTION: OptionDefinition = {
  name: 'runtime',
  property: 'runtime_id',
  description: 'Runtime id (default: the private runtime)',
  type: 'string',
}

const AGENT_PROPERTY: JsonSchema = { type: 'string', minLength: 1 }
const NAME_PROPERTY: JsonSchema = { type: 'string', minLength: 1 }
const KIND_PROPERTY: JsonSchema = { type: 'string', enum: [...SKILL_KINDS] }

function command(
  definition: Pick<CommandDefinition, 'verb' | 'summary' | 'handler'> & Partial<CommandDefinition> & {
    level: 'read' | 'write' | 'destructive'
    properties: Record<string, JsonSchema>
    required?: string[]
  },
): CommandDefinition {
  const { level, properties, required, ...rest } = definition
  return {
    options: [AGENT_OPTION],
    inputSchema: {
      type: 'object',
      properties: { agent_id: AGENT_PROPERTY, ...properties },
      required: ['agent_id', ...(required ?? [])],
      additionalProperties: false,
    },
    outputSchema: OBJECT_OUTPUT,
    resultSchemaVersion: 1,
    access: { mode: 'fixed', level },
    asyncMode: 'sync',
    requiresSession: true,
    ...rest,
  }
}

export function createSkillModule(dependencies: SkillModuleDependencies = {}): CommandModule {
  return {
    name: 'skill',
    summary: 'List, install, enable, and remove the work/plan/goal skills of an Agent',
    commands: [
      command({
        verb: 'list',
        summary: 'List the skills of an Agent',
        description:
          'Skills that no new session takes (disabled by the owner) are left out unless --all, which also lists the drafts waiting for the owner. --scope selects work skills by scope. --stats adds how often each manual was frozen, and the count of work created without any manual.',
        options: [
          AGENT_OPTION,
          KIND_OPTION,
          { name: 'scope', description: 'Work skills whose scope includes this', type: 'string', enum: SKILL_SCOPES },
          { name: 'all', description: 'Include skills that are not enabled, and drafts', type: 'boolean' },
          { name: 'stats', description: 'Include usage', type: 'boolean' },
        ],
        level: 'read',
        properties: {
          kind: KIND_PROPERTY,
          scope: { type: 'string', enum: SKILL_SCOPES },
          all: { type: 'boolean' },
          stats: { type: 'boolean' },
        },
        examples: [
          'buckyos skill list --agent jarvis.example.zone',
          'buckyos skill list --agent jarvis.example.zone --kind work --scope ui',
          'buckyos skill list --agent jarvis.example.zone --all --stats',
        ],
        handler: async (ctx, input) => await listCommand(ctx, input),
      }),
      command({
        verb: 'status',
        summary:
          'Whether each work skill works on a runtime of the Agent: baseline and platform, the commands it relies on, and the extension package that would bring what is missing',
        options: [AGENT_OPTION, RUNTIME_OPTION],
        level: 'read',
        properties: { runtime_id: { type: 'string', minLength: 1 } },
        examples: ['buckyos skill status --agent jarvis.example.zone --runtime host'],
        handler: async (ctx, input) =>
          await callService<Record<string, unknown>>(ctx, agentIdFrom(input), 'skills.status', {
            runtime_id: input.runtime_id ?? null,
          }),
      }),
      command({
        verb: 'install',
        summary: 'Install skills into an Agent: plan, confirm, install',
        description:
          'The source is a skill PIKG (local file or HTTP(S) URL; verified offline, app_type agent_skills), a directory laid out like its agent_skills sub package (cmd_skills/, plan_skills/, goal_skills/; the package is named after the directory), or --draft <slug> for a draft in the AgentRoot. A skill is text only: a package with tools/ (commands, install scripts) or a file that is not UTF-8 text is refused; commands come from the standard layer or from extension packages (buckyos ext-tools) and a manual only names them in `commands`. The Agent plans the installation first (nothing is written): the plan and its risk findings are shown and must be confirmed; --yes accepts every risk level. Installing is checking and copying: nothing runs. Only the owner installs. Sessions created before keep their frozen manuals.',
        positionals: [{ name: 'source', description: 'Skill .pikg file, skill directory, or HTTP(S) URL', required: false }],
        options: [
          AGENT_OPTION,
          { name: 'from', description: 'Force source type', type: 'string', enum: SOURCE_KINDS },
          { name: 'draft', description: 'Install this draft of the AgentRoot (skills_drafts/<slug>) instead of a source', type: 'string' },
          { ...RUNTIME_OPTION, description: 'Runtime the commands the manuals name are checked against in the plan (default: the private runtime)' },
          { name: 'replace', description: 'Replace skills of the same names from another package', type: 'boolean' },
        ],
        level: 'write',
        properties: {
          source: { type: 'string', minLength: 1 },
          from: { type: 'string', enum: SOURCE_KINDS },
          draft: { type: 'string', minLength: 1 },
          runtime_id: { type: 'string', minLength: 1 },
          replace: { type: 'boolean' },
        },
        examples: [
          'buckyos skill install ./dapp_dist/hello-skills-0.1.0.pikg --agent jarvis.example.zone',
          'buckyos --yes skill install ./skills --agent jarvis.example.zone --replace',
          'buckyos skill install https://example.com/hello-skills-0.1.0.pikg --agent jarvis.example.zone',
          'buckyos skill install --draft notes-to-slides --agent jarvis.example.zone',
        ],
        handler: async (ctx, input) => await installCommand(ctx, input, dependencies),
      }),
      command({
        verb: 'remove',
        summary: 'Remove an installed skill from an Agent',
        description: 'Only installed and imported skills can be removed. Without --kind the kind is looked up by name.',
        positionals: [{ name: 'name', description: 'Skill name' }],
        options: [AGENT_OPTION, KIND_OPTION],
        level: 'destructive',
        properties: { name: NAME_PROPERTY, kind: KIND_PROPERTY },
        required: ['name'],
        examples: ['buckyos --yes skill remove hello --agent jarvis.example.zone --kind work'],
        handler: async (ctx, input) => {
          const agentId = agentIdFrom(input)
          const name = requiredInputString(input, 'name')
          const kind = await kindOf(ctx, agentId, name, input)
          await confirm(ctx, 'skill remove', `Remove ${kind} skill ${name} from ${agentId}?`)
          const removed = await callService<unknown>(ctx, agentId, 'skills.remove', { kind, name })
          return { agent_id: agentId, removed: expectObject(removed, 'skills.remove') }
        },
      }),
      command({
        verb: 'disable',
        summary: 'Disable a skill of an Agent: no new session takes it',
        description:
          'Any skill can be disabled, package ones included. Running sessions keep what they froze. Without --kind the kind is looked up by name.',
        positionals: [{ name: 'name', description: 'Skill name' }],
        options: [AGENT_OPTION, KIND_OPTION, { name: 'reason', description: 'Why, for the record', type: 'string' }],
        level: 'write',
        properties: { name: NAME_PROPERTY, kind: KIND_PROPERTY, reason: { type: 'string' } },
        required: ['name'],
        examples: ['buckyos skill disable aigc_video --agent jarvis.example.zone --reason "no provider"'],
        handler: async (ctx, input) => await setEnabled(ctx, input, false),
      }),
      command({
        verb: 'enable',
        summary: 'Enable a disabled skill of an Agent',
        positionals: [{ name: 'name', description: 'Skill name' }],
        options: [AGENT_OPTION, KIND_OPTION],
        level: 'write',
        properties: { name: NAME_PROPERTY, kind: KIND_PROPERTY },
        required: ['name'],
        examples: ['buckyos skill enable aigc_video --agent jarvis.example.zone'],
        handler: async (ctx, input) => await setEnabled(ctx, input, true),
      }),
      command({
        verb: 'ui-list',
        summary: 'The work skills every new conversation (UI session) of the Agent takes',
        level: 'read',
        properties: {},
        examples: ['buckyos skill ui-list --agent jarvis.example.zone'],
        handler: async (ctx, input) => {
          const agentId = agentIdFrom(input)
          return { agent_id: agentId, ...await uiGet(ctx, agentId) }
        },
      }),
      command({
        verb: 'ui-add',
        summary: 'Add a skill whose scope includes ui to the conversations of the Agent',
        description:
          'Takes effect in conversations created afterwards. The result gives total_bytes: every conversation carries that much manual text.',
        positionals: [{ name: 'name', description: 'Skill name' }],
        level: 'write',
        properties: { name: NAME_PROPERTY },
        required: ['name'],
        examples: ['buckyos skill ui-add share --agent jarvis.example.zone'],
        handler: async (ctx, input) => await uiChange(ctx, input, true),
      }),
      command({
        verb: 'ui-remove',
        summary: 'Take a skill out of the conversations of the Agent',
        positionals: [{ name: 'name', description: 'Skill name' }],
        level: 'write',
        properties: { name: NAME_PROPERTY },
        required: ['name'],
        examples: ['buckyos skill ui-remove share --agent jarvis.example.zone'],
        handler: async (ctx, input) => await uiChange(ctx, input, false),
      }),
      command({
        verb: 'import',
        summary: 'Hand a text to the Agent to turn into a skill draft',
        description:
          'Reads the text from a file, an HTTP(S) URL, or stdin (-). The Agent starts a work session that writes a draft under skills_drafts/; nothing is installed. The owner reads the draft (skill drafts, skill draft-show) and installs it with skill install --draft <slug>.',
        positionals: [{ name: 'source', description: 'Text file, HTTP(S) URL, or - for stdin' }],
        options: [
          AGENT_OPTION,
          { name: 'name', description: 'Slug of the draft', type: 'string' },
          { name: 'scope', description: 'What to make of it', type: 'string', enum: IMPORT_SCOPES },
          { ...RUNTIME_OPTION, description: 'Runtime the commands the text names are checked on (default: the private runtime)' },
        ],
        level: 'write',
        properties: {
          source: { type: 'string', minLength: 1 },
          name: { type: 'string', minLength: 1 },
          scope: { type: 'string', enum: IMPORT_SCOPES },
          runtime_id: { type: 'string', minLength: 1 },
        },
        required: ['source'],
        examples: [
          'buckyos skill import ./notes/release-checklist.md --agent jarvis.example.zone --name release_checklist',
          'cat howto.md | buckyos skill import - --agent jarvis.example.zone --scope plan',
        ],
        handler: async (ctx, input) => await importCommand(ctx, input, dependencies),
      }),
      command({
        verb: 'drafts',
        summary: 'List the skill drafts of an Agent that wait for the owner',
        level: 'read',
        properties: {},
        examples: ['buckyos skill drafts --agent jarvis.example.zone'],
        handler: async (ctx, input) => {
          const agentId = agentIdFrom(input)
          const drafts = await listDrafts(ctx, agentId)
          return { agent_id: agentId, total: drafts.length, drafts }
        },
      }),
      command({
        verb: 'draft-show',
        summary: 'Show a skill draft, or one of its files',
        positionals: [{ name: 'slug', description: 'Draft slug' }],
        options: [AGENT_OPTION, { name: 'file', description: 'Draft-relative path of a file to print', type: 'string' }],
        level: 'read',
        properties: { slug: NAME_PROPERTY, file: { type: 'string', minLength: 1 } },
        required: ['slug'],
        examples: [
          'buckyos skill draft-show release_checklist --agent jarvis.example.zone',
          'buckyos skill draft-show release_checklist --file cmd_skills/release_checklist/SKILL.md --agent jarvis.example.zone',
        ],
        handler: async (ctx, input) => {
          const agentId = agentIdFrom(input)
          const slug = requiredInputString(input, 'slug')
          const file = inputString(input, 'file')
          if (file) {
            const shown = expectObject(await callService<unknown>(ctx, agentId, 'skills.draft_file', { slug, file }), 'skills.draft_file')
            return { agent_id: agentId, slug, file, text: shown.text }
          }
          const draft = (await listDrafts(ctx, agentId)).find((item) => item.slug === slug)
          if (!draft) throw new ToolError('RESOURCE_NOT_FOUND', `Agent ${agentId} has no skill draft ${slug}`)
          return { agent_id: agentId, ...draft, install_command: `buckyos skill install --draft ${slug} --agent ${agentId}` }
        },
      }),
      command({
        verb: 'draft-discard',
        summary: 'Delete a skill draft',
        positionals: [{ name: 'slug', description: 'Draft slug' }],
        level: 'destructive',
        properties: { slug: NAME_PROPERTY },
        required: ['slug'],
        examples: ['buckyos --yes skill draft-discard release_checklist --agent jarvis.example.zone'],
        handler: async (ctx, input) => {
          const agentId = agentIdFrom(input)
          const slug = requiredInputString(input, 'slug')
          await confirm(ctx, 'skill draft-discard', `Discard skill draft ${slug} of ${agentId}?`)
          await callService<unknown>(ctx, agentId, 'skills.draft_discard', { slug })
          return { agent_id: agentId, discarded: slug }
        },
      }),
    ],
  }
}

async function listCommand(ctx: CommandContext, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const agentId = agentIdFrom(input)
  const scope = inputString(input, 'scope')
  let kind = inputString(input, 'kind')
  if (scope) {
    if (kind && kind !== 'work') throw new UsageError('ARGUMENT_CONFLICT', `--scope selects work skills; a ${kind} skill has no scope`)
    kind = 'work'
  }
  const listed = (await listSkills(ctx, agentId, kind)).filter((skill) => {
    if (!scope) return true
    const own = typeof skill.scope === 'string' ? skill.scope.split(',').map((word) => word.trim()) : ['work']
    return own.includes(scope)
  })
  const shown = input.all === true ? listed : listed.filter((skill) => skill.enabled !== false)
  const stats = input.stats === true
  const skills = stats ? shown : shown.map(({ usage: _usage, ...skill }) => skill)
  const result: Record<string, unknown> = {
    agent_id: agentId,
    ...(kind ? { kind } : {}),
    ...(scope ? { scope } : {}),
    total: skills.length,
    not_enabled: listed.length - listed.filter((skill) => skill.enabled !== false).length,
    skills,
  }
  if (stats) {
    const state = expectObject(await callService<unknown>(ctx, agentId, 'skills.state', {}), 'skills.state')
    const usage = state.usage && typeof state.usage === 'object' ? state.usage as Record<string, unknown> : {}
    result.usage_none = usage.none ?? { frozen: 0, last_ms: 0 }
  }
  if (input.all === true) result.drafts = await listDrafts(ctx, agentId)
  return result
}

async function setEnabled(ctx: CommandContext, input: Record<string, unknown>, enabled: boolean): Promise<Record<string, unknown>> {
  const agentId = agentIdFrom(input)
  const name = requiredInputString(input, 'name')
  const kind = await kindOf(ctx, agentId, name, input)
  const reason = inputString(input, 'reason')
  const skill = await callService<unknown>(ctx, agentId, 'skills.set_enabled', {
    kind,
    name,
    enabled,
    ...(reason ? { reason } : {}),
  })
  return { agent_id: agentId, skill: expectObject(skill, 'skills.set_enabled') }
}

async function uiGet(ctx: CommandContext, agentId: string): Promise<Record<string, unknown> & { names: string[] }> {
  const ui = expectObject(await callService<unknown>(ctx, agentId, 'skills.ui_get', {}), 'skills.ui_get')
  if (!Array.isArray(ui.names)) invalidResponse('skills.ui_get')
  return { ...ui, names: (ui.names as unknown[]).map(String) }
}

async function uiChange(ctx: CommandContext, input: Record<string, unknown>, add: boolean): Promise<Record<string, unknown>> {
  const agentId = agentIdFrom(input)
  const name = requiredInputString(input, 'name')
  const current = await uiGet(ctx, agentId)
  const has = current.names.includes(name)
  if (!add && !has) {
    throw new ToolError('RESOURCE_NOT_FOUND', `${name} is not among the UI skills of ${agentId} (${current.names.join(', ') || 'none'})`)
  }
  if (add && has) return { agent_id: agentId, changed: false, ...current }
  const names = add ? [...current.names, name] : current.names.filter((item) => item !== name)
  const ui = expectObject(await callService<unknown>(ctx, agentId, 'skills.ui_set', { names }), 'skills.ui_set')
  return { agent_id: agentId, changed: true, ...ui }
}

interface SkillSource {
  summary: Record<string, unknown>
  params: Record<string, unknown>
  extra: Record<string, unknown>
}

async function installCommand(
  ctx: CommandContext,
  input: Record<string, unknown>,
  dependencies: SkillModuleDependencies,
): Promise<Record<string, unknown>> {
  const agentId = agentIdFrom(input)
  const source = await skillSource(ctx, input, dependencies)
  const runtimeId = inputString(input, 'runtime_id')
  const runtime = runtimeId ? { runtime_id: runtimeId } : {}
  const plan = expectObject(
    await callService<unknown>(ctx, agentId, 'skills.install_plan', { ...source.params, ...runtime }),
    'skills.install_plan',
  )
  const planDigest = plan.plan_digest
  if (typeof planDigest !== 'string' || !planDigest) invalidResponse('skills.install_plan')
  if (!ctx.confirmed) {
    if (ctx.config.nonInteractive || !ctx.io.inputIsTerminal) {
      throw new ToolError(
        'CONFIRMATION_REQUIRED',
        `skill install requires --yes in non-interactive execution (risk: ${riskLevel(plan)})`,
        EXIT_PERMISSION,
        false,
        { plan },
      )
    }
    await ctx.io.stderr(planText(plan))
    await confirm(ctx, 'skill install', `Install into ${agentId} (risk: ${riskLevel(plan)})?`)
  }
  const report = expectObject(
    await callService<unknown>(ctx, agentId, 'skills.install', {
      ...source.params,
      plan_digest: planDigest,
      replace: input.replace === true,
    }),
    'skills.install',
  )
  return { agent_id: agentId, source: source.summary, ...source.extra, plan, ...report }
}

function riskLevel(plan: Record<string, unknown>): string {
  const risk = plan.risk && typeof plan.risk === 'object' ? plan.risk as Record<string, unknown> : {}
  return typeof risk.level === 'string' ? risk.level : 'unknown'
}

function planText(plan: Record<string, unknown>): string {
  const lines = [`Install plan: ${plan.package}${plan.version ? ` ${plan.version}` : ''} (${plan.digest})`]
  for (const item of Array.isArray(plan.skills) ? plan.skills : []) {
    const skill = item as Record<string, unknown>
    const scope = typeof skill.scope === 'string' ? ` [${skill.scope}]` : ''
    const replaces = skill.replaces ? `; replaces the ${skill.replaces} skill` : ''
    const commands = Array.isArray(skill.commands) && skill.commands.length ? `; commands: ${skill.commands.join(', ')}` : ''
    lines.push(`  ${skill.kind} ${skill.name}${scope}: ${skill.description ?? ''}${commands}${replaces}`)
  }
  if (plan.checked_runtime_id) lines.push(`Commands checked on runtime: ${plan.checked_runtime_id}`)
  for (const item of Array.isArray(plan.command_status) ? plan.command_status : []) {
    const entry = item as Record<string, unknown>
    const status = entry.status && typeof entry.status === 'object' ? entry.status as Record<string, unknown> : {}
    if (status.state !== 'partial') continue
    const states = status.commands && typeof status.commands === 'object' ? status.commands as Record<string, { present?: boolean }> : {}
    const missing = Object.keys(states).filter((name) => states[name]?.present === false)
    const packages = (Array.isArray(status.recommended_packages) ? status.recommended_packages : [])
      .map((pkg) => String((pkg as Record<string, unknown>).id))
    const none = Array.isArray(status.no_package) ? status.no_package.map(String) : []
    lines.push(
      `  ${entry.name}: missing ${missing.join(', ')}` +
        (packages.length ? `; extension packages that bring them: ${packages.join(', ')} (buckyos ext-tools enable)` : '') +
        (none.length ? `; no package provides ${none.join(', ')}` : ''),
    )
  }
  const risk = plan.risk && typeof plan.risk === 'object' ? plan.risk as Record<string, unknown> : {}
  lines.push(`Risk: ${riskLevel(plan)}`)
  for (const item of Array.isArray(risk.findings) ? risk.findings : []) {
    const finding = item as Record<string, unknown>
    lines.push(`  [${finding.level}] ${finding.code} ${finding.where}: ${finding.note}`)
  }
  return `${lines.join('\n')}\n`
}

async function skillSource(
  ctx: CommandContext,
  input: Record<string, unknown>,
  dependencies: SkillModuleDependencies,
): Promise<SkillSource> {
  const host = getHost()
  const draft = inputString(input, 'draft')
  const raw = inputString(input, 'source')
  const forced = inputString(input, 'from')
  if (draft) {
    if (raw || forced) throw new UsageError('ARGUMENT_CONFLICT', '--draft takes no <source> and no --from: the Agent reads the draft itself')
    return { summary: { kind: 'draft', draft }, params: { draft }, extra: {} }
  }
  if (!raw) throw new UsageError('MISSING_ARGUMENT', 'a <source> or --draft <slug> is required')
  const local = host.path.isAbsolute(raw) ? host.path.resolve(raw) : host.path.resolve(ctx.cwd, raw)
  let directory = forced === 'dir'
  if (!forced && !/^https?:\/\//i.test(raw) && !isDidSource(raw)) {
    try {
      directory = (await host.stat(local)).isDirectory
    } catch (error) {
      if (!isHostError(error, 'NotFound')) throw error
    }
  }
  if (directory) return await directorySource(local)

  const classified = await classifySource(ctx, { source: raw, ...(forced ? { from: forced === 'did' ? 'catalog' : forced } : {}) })
  if (classified.kind === 'catalog') {
    throw new ToolError(
      'SKILL_SOURCE_UNSUPPORTED',
      `${classified.display} names a Catalog App, and the Catalog cannot hand a skill PIKG to this tool yet: install from the .pikg file or its URL`,
      EXIT_UNAVAILABLE,
    )
  }
  if (classified.kind === 'pikg') return await pikgSource(classified.path, { kind: 'pikg', path: classified.path })
  await host.mkdir(ctx.configStore.root, { recursive: true, mode: 0o700 })
  const temporary = await host.makeTempDir({ dir: ctx.configStore.root, prefix: '.skill-pikg-' })
  try {
    const snapshot = await downloadPikg(classified.url, host.path.join(temporary, 'source.pikg'), dependencies.download, ctx.signal)
    return await pikgSource(snapshot.path, { kind: 'url', url: snapshot.display })
  } finally {
    await host.remove(temporary, { recursive: true }).catch(() => {})
  }
}

async function pikgSource(path: string, summary: Record<string, unknown>): Promise<SkillSource> {
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
  const bytes = await readZipEntry(archive, archive.byName.get(payload.path)!, MAX_SKILL_PAYLOAD_BYTES)
  if (`sha256:${sha256Bytes(bytes)}` !== payload.digest) {
    throw new ToolError('INVALID_PACKAGE', 'PIKG changed after it was verified')
  }
  const files = new Map<string, SkillPackageFile>()
  const ignored: string[] = []
  for (const entry of await readTarGz(bytes, MAX_SKILL_PAYLOAD_BYTES)) {
    if (SKILL_DIRS.includes(entry.path.split('/')[0])) files.set(entry.path, { bytes: entry.bytes })
    else ignored.push(entry.path)
  }
  return {
    summary,
    params: {
      package: {
        package: inspection.app.name,
        version: inspection.app.version,
        pikg_digest: inspection.pikg_digest,
        files: packageFiles(files),
      },
    },
    extra: { pikg_digest: inspection.pikg_digest, ...(ignored.length ? { ignored_files: ignored } : {}) },
  }
}

async function directorySource(path: string): Promise<SkillSource> {
  const host = getHost()
  let root: string
  let read: Awaited<ReturnType<typeof readSkillDirectory>>
  try {
    root = await host.realPath(path)
    if (!(await host.stat(root)).isDirectory) throw new Error('not a directory')
    read = await readSkillDirectory(root, MAX_SKILL_PAYLOAD_BYTES)
  } catch (error) {
    throw new UsageError('INVALID_SKILL_SOURCE', `${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
  const name = host.path.basename(root)
  const invalid = lintSkillPackage(name, read.files).findings.find((finding) => finding.level === 'error')
  if (invalid) throw new UsageError('INVALID_SKILL_PACKAGE', invalid.note)
  return {
    summary: { kind: 'dir', path: root },
    params: { package: { package: name, version: '', files: packageFiles(read.files) } },
    extra: read.ignored.length ? { ignored_files: read.ignored } : {},
  }
}

function packageFiles(files: Map<string, SkillPackageFile>): Record<string, { content: string }> {
  const out: Record<string, { content: string }> = {}
  for (const path of [...files.keys()].sort()) out[path] = { content: base64(files.get(path)!.bytes) }
  return out
}

async function importCommand(
  ctx: CommandContext,
  input: Record<string, unknown>,
  dependencies: SkillModuleDependencies,
): Promise<Record<string, unknown>> {
  const host = getHost()
  const agentId = agentIdFrom(input)
  const raw = requiredInputString(input, 'source')
  let text: string
  let source: string
  if (raw === '-') {
    text = await (dependencies.readStdin ?? (() => host.readStdin()))()
    source = 'stdin'
  } else if (/^https?:\/\//i.test(raw)) {
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      throw new UsageError('INVALID_ARGUMENT', `invalid URL: ${raw}`)
    }
    if (url.username || url.password) throw new UsageError('INVALID_ARGUMENT', 'the URL must not contain credentials')
    try {
      text = await (dependencies.fetchText ?? fetchText)(url, ctx.signal)
    } catch (error) {
      if (error instanceof ToolError) throw error
      ctx.signal.throwIfAborted()
      throw new ToolError('SKILL_IMPORT_FETCH_FAILED', `failed to fetch ${url.origin}${url.pathname}: ${error instanceof Error ? error.message : String(error)}`, EXIT_UNAVAILABLE, true)
    }
    source = `${url.origin}${url.pathname}`
  } else {
    const path = host.path.isAbsolute(raw) ? host.path.resolve(raw) : host.path.resolve(ctx.cwd, raw)
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(await host.readFile(path))
    } catch (error) {
      throw new UsageError('FILE_ACCESS_FAILED', `failed to read ${raw} as UTF-8 text: ${error instanceof Error ? error.message : String(error)}`)
    }
    source = host.path.basename(path)
  }
  if (!text.trim()) throw new UsageError('INVALID_ARGUMENT', 'the text to import is empty')
  if (new TextEncoder().encode(text).length > MAX_IMPORT_TEXT_BYTES) {
    throw new UsageError('INVALID_ARGUMENT', `the text to import is larger than ${MAX_IMPORT_TEXT_BYTES} bytes`)
  }
  const name = inputString(input, 'name')
  const scope = inputString(input, 'scope')
  const runtimeId = inputString(input, 'runtime_id')
  const started = expectObject(
    await callService<unknown>(ctx, agentId, 'skills.import', {
      text,
      ...(name ? { name } : {}),
      ...(scope ? { scope } : {}),
      source,
      ...(runtimeId ? { runtime_id: runtimeId } : {}),
    }),
    'skills.import',
  )
  return {
    agent_id: agentId,
    source,
    ...started,
    installed: false,
    note:
      'The Agent writes a draft in that work session; nothing is installed. When it reports, the draft is listed by the drafts command; read it, then install it.',
    drafts_command: `buckyos skill drafts --agent ${agentId}`,
    install_command: `buckyos skill install --draft ${name ?? '<slug>'} --agent ${agentId}`,
  }
}

async function fetchText(url: URL, signal: AbortSignal): Promise<string> {
  const response = await fetch(url, { method: 'GET', redirect: 'follow', signal })
  if (!response.ok) {
    await response.body?.cancel()
    throw new ToolError('SKILL_IMPORT_FETCH_FAILED', `the URL returned HTTP ${response.status}`, EXIT_UNAVAILABLE, response.status >= 500)
  }
  return await response.text()
}

async function confirm(ctx: CommandContext, verb: string, question: string): Promise<void> {
  if (ctx.confirmed) return
  if (ctx.config.nonInteractive || !ctx.io.inputIsTerminal) {
    throw new ToolError('CONFIRMATION_REQUIRED', `${verb} requires --yes in non-interactive execution`, EXIT_PERMISSION)
  }
  const answer = (await ctx.io.prompt(`${question} [y/N] `))?.trim().toLowerCase()
  if (answer !== 'y' && answer !== 'yes') {
    throw new ToolError('CONFIRMATION_DECLINED', `${verb} was declined`, EXIT_PERMISSION)
  }
}

async function kindOf(ctx: CommandContext, agentId: string, name: string, input: Record<string, unknown>): Promise<string> {
  const given = inputString(input, 'kind')
  if (given) return given
  const kinds = (await listSkills(ctx, agentId)).filter((skill) => skill.name === name).map((skill) => String(skill.kind))
  if (kinds.length === 0) throw new ToolError('RESOURCE_NOT_FOUND', `Agent ${agentId} has no skill named ${name}`)
  if (kinds.length > 1) throw new UsageError('AMBIGUOUS_SKILL', `${name} is a ${kinds.join(' and a ')} skill; use --kind`)
  return kinds[0]
}

async function listSkills(ctx: CommandContext, agentId: string, kind?: string): Promise<Record<string, unknown>[]> {
  const skills = await callService<unknown>(ctx, agentId, 'skills.list', kind ? { kind } : {})
  if (!Array.isArray(skills)) invalidResponse('skills.list')
  return (skills as unknown[]).map((skill) => expectObject(skill, 'skills.list'))
}

async function listDrafts(ctx: CommandContext, agentId: string): Promise<Record<string, unknown>[]> {
  const drafts = await callService<unknown>(ctx, agentId, 'skills.drafts', {})
  if (!Array.isArray(drafts)) invalidResponse('skills.drafts')
  return (drafts as unknown[]).map((draft) => expectObject(draft, 'skills.drafts'))
}

export function agentIdFrom(input: Record<string, unknown>): string {
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
