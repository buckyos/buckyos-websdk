// `createSiteRuntime`: a page turns the tools of one scene into an
// AgentRuntime. The SDK ships no tools here; what the scene can do is the
// page's own JS functions, so xllm never exceeds what the page's JS can do.
//
// descriptor: { kind: "site", runtime_id: "site:<scene>", host: null,
//   target: { origin, scene }, workdir: "/", capabilities: { tools: {}, network: true, os: "browser" } }
// Neither the user agent nor the tool list is part of it: a browser update or
// a new page tool must not make old runs unresumable, while a run of scene A
// cannot be resumed in scene B (the descriptors differ).

import type { AiToolCall, EffectiveTools, ResolvedTool, RuntimeConfig, RuntimeDescriptor, RuntimeInfo, ToolSource, ToolsConfig } from '../core/types'
import { XllmError } from '../core/errors'
import { describeToolSource, shellSettings, taskWaitMs } from '../core/config'
import type { AgentRuntime, OpenedTools, RunBinding, RuntimeOpenCtx, SiteTool } from './types'
import { unresolvedReason } from './types'
import { SiteToolManager } from './site_manager'

export const SITE_RUNTIME_KIND = 'site'

const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/

export interface SiteRuntimeOptions {
  /** The scene name, e.g. `aiws.wish`: part of the runtime's identity. */
  scene: string
  /** The page's origin (passed in: the runtime never reads `location`). */
  origin: string
  hostname: string
  /** Every tool of this scene. */
  tools: Record<string, SiteTool>
  /** What `{{env.NAME}}` may read. */
  env?: Record<string, string>
  /** `runtime.task_wait_ms` (in-call wait budget for tasks, M2). */
  task_wait_ms?: number
}

export interface SiteRuntime extends AgentRuntime {
  readonly scene: string
  /** The scene's tools, by name. */
  readonly tools: ReadonlyMap<string, SiteTool>
}

function resolveTool(name: string, tool: SiteTool, source: string): ResolvedTool {
  return { name, description: tool.spec.description, args_schema: tool.spec.args_schema, source }
}

function namedSources(cfg: ToolSource[] | undefined, field: string): string[] {
  return (cfg ?? []).map(s => {
    if (s.kind !== 'named') {
      throw XllmError.capability(`${field}: \`${describeToolSource(s)}\` is not available in a site runtime; only the page's tools can be named`)
    }
    return s.name
  })
}

export function createSiteRuntime(options: SiteRuntimeOptions): SiteRuntime {
  const scene = options.scene?.trim()
  if (!scene) throw XllmError.input('createSiteRuntime: `scene` is required')
  if (!options.origin) throw XllmError.input('createSiteRuntime: `origin` is required')
  const tools = new Map<string, SiteTool>()
  for (const [name, tool] of Object.entries(options.tools ?? {})) {
    if (!TOOL_NAME.test(name)) throw XllmError.tools(`site tool name \`${name}\` must match ${TOOL_NAME}`)
    if (!tool || typeof tool.call !== 'function' || !tool.spec) throw XllmError.tools(`site tool \`${name}\` needs \`spec\` and \`call\``)
    tools.set(name, tool)
  }
  const env = { ...(options.env ?? {}) }
  const descriptor: RuntimeDescriptor = {
    runtime_id: `site:${scene}`,
    kind: SITE_RUNTIME_KIND,
    host: null,
    target: { origin: options.origin, scene },
    workdir: '/',
    capabilities: { tools: {}, network: true, os: 'browser' },
  }
  const config: RuntimeConfig = { kind: SITE_RUNTIME_KIND, env: {} }
  if (options.task_wait_ms !== undefined) config.task_wait_ms = options.task_wait_ms

  const runtime: SiteRuntime = {
    scene,
    tools,
    descriptor: () => JSON.parse(JSON.stringify(descriptor)),
    config: () => JSON.parse(JSON.stringify(config)),
    async info(): Promise<RuntimeInfo> {
      let timezone = ''
      try {
        timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''
      } catch {
        timezone = ''
      }
      return {
        id: descriptor.runtime_id, kind: SITE_RUNTIME_KIND, os: 'browser', arch: '', hostname: options.hostname, shell: '',
        cwd: '/', tools: [], current_time: new Date().toISOString(), timezone, target: descriptor.target,
        platform: 'browser', shell_kind: '', baseline: '',
      }
    },
    async open(ctx: RuntimeOpenCtx, cfg: ToolsConfig): Promise<OpenedTools> {
      const enabled = cfg.enabled ?? false
      const tools2actions = cfg.tools2actions ?? false
      if (ctx.loop_model === 'function_call' && (tools2actions || (cfg.actions ?? []).length > 0)) {
        throw XllmError.capability('actions / tools2actions need loop_model behavior')
      }
      const pick = (names: string[], field: string): ResolvedTool[] => names.map(name => {
        const tool = tools.get(name)
        if (!tool) {
          throw XllmError.capability(`${field}: \`${name}\` is not a tool of scene \`${scene}\` (scene tools: ${[...tools.keys()].join(', ') || 'none'})`)
        }
        return resolveTool(name, tool, `name:${name}`)
      })
      let native: ResolvedTool[] = []
      let actions: ResolvedTool[] = []
      const toolSources = cfg.tools ?? []
      const actionSources = cfg.actions ?? []
      if (enabled) {
        const toolNames = cfg.tools === undefined ? [...tools.keys()] : namedSources(cfg.tools, 'tools.tools')
        native = pick(toolNames, 'tools.tools')
        actions = pick(namedSources(cfg.actions, 'tools.actions'), 'tools.actions')
        if (tools2actions) {
          actions = [...actions, ...native.filter(t => !actions.some(a => a.name === t.name))]
          native = []
        }
      }
      const selected = new Map<string, SiteTool>()
      for (const t of [...native, ...actions]) selected.set(t.name, tools.get(t.name) as SiteTool)
      const effective: EffectiveTools = {
        enabled,
        filesystem_policy: cfg.filesystem_policy ?? 'workspace',
        tools2actions,
        tool_sources: cfg.tools === undefined && enabled ? native.map(t => ({ kind: 'named', name: t.name })) : toolSources,
        action_sources: actionSources,
        native,
        actions,
        bash_tools: [],
        shell: shellSettings(cfg.shell, taskWaitMs(config)),
        exec_enabled: false,
        sources: { ...ctx.sources },
      }
      return { tools: effective, manager: new SiteToolManager(selected, { tasks: ctx.tasks, taskWaitMs: ctx.task_wait_ms }) }
    },
    async describeInterrupted(run: RunBinding, call: AiToolCall): Promise<string> {
      const tool = tools.get(call.name)
      if (tool?.describeInterrupted) {
        try {
          return await tool.describeInterrupted(call.args ?? {}, { run_id: run.run_id, call_id: call.call_id, signal: new AbortController().signal })
        } catch (e) {
          return `${unresolvedReason(call.name)} (describing it failed: ${e instanceof Error ? e.message : String(e)})`
        }
      }
      return unresolvedReason(call.name)
    },
    env: (name: string) => env[name],
  }
  return runtime
}
