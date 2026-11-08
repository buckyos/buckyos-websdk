// Capability gate of the `site` runtime kind (TODO Q4, §0): what a site can
// do comes from the page's code, configuration can only narrow it. Applied in
// `prepare` by `descriptor.kind`, so a site's own AgentRuntime passes the same
// gate as `createSiteRuntime`.

import type { LlmContextFile, ToolsConfig } from './types'
import { XllmError } from './errors'
import { describeToolSource } from './config'

export const SITE_KIND = 'site'

function checkTools(t: ToolsConfig | undefined, field: string) {
  if (!t) return
  for (const list of ['tools', 'actions'] as const) {
    for (const s of t[list] ?? []) {
      if (s.kind !== 'named') {
        throw XllmError.capability(`${field}.${list}: \`${describeToolSource(s)}\` is not available in a site runtime; name the page's tools instead`)
      }
    }
  }
  if (t.bash_tools !== undefined && t.bash_tools.length > 0) throw XllmError.capability(`${field}.bash_tools: a site runtime has no shell`)
  if (t.shell !== undefined) throw XllmError.capability(`${field}.shell: a site runtime has no shell`)
}

/** Rejects (Capability) what a site runtime cannot do; never downgrades silently. */
export function checkSiteConfig(file: LlmContextFile, origin: string) {
  const r = file.runtime
  if (r) {
    const kind = r.kind ?? 'native'
    if (kind !== SITE_KIND) throw XllmError.capability(`${origin}: runtime.kind \`${kind}\` cannot run in a site runtime (only \`site\`)`)
    if (r.id !== undefined || r.workdir !== undefined || Object.keys(r.env).length > 0 || r.remote_ssh || r.remote_node) {
      throw XllmError.capability(`${origin}: a site runtime takes only runtime.kind, runtime.task_wait_ms and runtime.baseline`)
    }
  }
  const p = file.provider
  if (p) {
    if ((p.kind ?? 'buckyos') !== 'buckyos') {
      throw XllmError.capability(`${origin}: provider.type \`${p.kind}\` is not available in a site runtime; the page's model client is used`)
    }
    for (const key of ['base_url', 'api_key', 'session_token', 'on_behalf_of', 'headers'] as const) {
      if (p[key] !== undefined) throw XllmError.capability(`${origin}: provider.${key} is not available in a site runtime; calls run under the page's session`)
    }
  }
  checkTools(file.tools, 'tools')
  checkTools(file.prompt?.tools, 'prompt.tools')
  for (const [name, g] of Object.entries(file.prompt?.groups ?? {})) checkTools(g.tools, `prompt.groups.${name}.tools`)
}
