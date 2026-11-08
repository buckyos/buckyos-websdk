// `siteTools` resources from DID Objects a BuckyOS service already serves
// (`KrpcObjectProvider`): for each root the page lists, its Profile decides
// what the model can do — properties are read, an IndexTrait collection is
// read with a query, actions become `xcall` actions with the Profile's
// `x-buckyos:risk` (above `maxRisk` they are not exposed). What can be reached
// is decided by the Profile and the roots, never by a URI the model gives.

import type { JsonValue } from '../core/types'
import { isObject } from '../core/json'
import type { DIDObjectClient } from '../../did_object_client'
import { ACTION_RISKS } from './site_tools'
import type { ActionDecl, ActionRisk, ResourceDecl, ResourceMatch } from './site_tools'

export const INDEX_TRAIT_URI = 'https://buckyos.org/traits/index@1'

/** What `didObjectResources` needs of a DID Object client. */
export type DidObjectReader = Pick<DIDObjectClient, 'card' | 'profile' | 'readProperty' | 'invoke'>

export interface DidObjectResourcesOptions {
  client: DidObjectReader
  /** Object URLs (`obj://…`) the page lets the model reach. */
  roots: string[]
  /** Actions above this risk are not exposed (default `read_only`). */
  maxRisk?: ActionRisk
}

function text(v: JsonValue | undefined, key: string): string {
  return isObject(v) && typeof v[key] === 'string' ? (v[key] as string) : ''
}

function riskRank(r: string): number {
  const i = ACTION_RISKS.indexOf(r as ActionRisk)
  return i < 0 ? ACTION_RISKS.length : i
}

/** The object document a read shows (as `render_object_document` in agent-did-object-lib). */
export function renderObjectDocument(canonical: string, card: { id: string; alsoKnownAs?: string[] }, profile: JsonValue,
  summary: Record<string, JsonValue>): string {
  const lines = [`Object: ${canonical}`, `Object DID: ${card.id}`]
  const aliases = (card.alsoKnownAs ?? []).filter(a => a !== canonical)
  if (aliases.length) lines.push(`Also known as: ${aliases.join(', ')}`)
  for (const [label, key] of [['Title', 'title'], ['Description', 'description']]) {
    const v = text(profile, key)
    if (v) lines.push(`${label}: ${v}`)
  }
  for (const [section, key] of [['Properties', 'properties'], ['Actions', 'actions'], ['Events', 'events']]) {
    const entries = isObject(profile) ? profile[key] : undefined
    if (!isObject(entries) || Object.keys(entries).length === 0) continue
    lines.push(`${section}:`)
    for (const name of Object.keys(entries).sort()) {
      const e = entries[name]
      let line = `- ${name}`
      const d = text(e, 'description')
      if (d) line += `: ${d}`
      const risk = text(e, 'x-buckyos:risk')
      if (risk) line += ` (risk: ${risk})`
      lines.push(line)
    }
  }
  const names = Object.keys(summary)
  if (names.length) {
    lines.push('Summary:')
    for (const name of names) lines.push(`- ${name}:`, JSON.stringify(summary[name], null, 2))
  }
  return lines.join('\n')
}

function isCollection(profile: JsonValue): boolean {
  const traits = isObject(profile) ? profile['x-buckyos:traits'] : undefined
  return Array.isArray(traits) && traits.includes(INDEX_TRAIT_URI)
}

/** Resources for `siteTools({ resources })` from the Profiles of `roots`. */
export async function didObjectResources(options: DidObjectResourcesOptions): Promise<Record<string, ResourceDecl>> {
  const maxRank = riskRank(options.maxRisk ?? 'read_only')
  const out: Record<string, ResourceDecl> = {}
  for (const root of options.roots) {
    const client = options.client
    const profile = await client.profile(root) as JsonValue
    const collection = isCollection(profile)
    const actions: Record<string, ActionDecl> = {}
    const declared = isObject(profile) && isObject(profile.actions) ? profile.actions : {}
    for (const [name, a] of Object.entries(declared)) {
      if (collection && (name === 'query' || name === 'page')) continue
      const risk = text(a, 'x-buckyos:risk') as ActionRisk
      if (riskRank(risk) > maxRank) continue
      const input = isObject(a) ? a.input : undefined
      actions[name] = {
        description: text(a, 'description'),
        risk,
        ...(input !== undefined && input !== null ? { input } : {}),
        call: (_m: ResourceMatch, params: Record<string, JsonValue>) => client.invoke(root, name, params),
      }
    }
    const description = [text(profile, 'title'), text(profile, 'description')].filter(Boolean).join(' — ') || root
    out[root] = {
      description: collection ? `${description} (a collection: read it with a query, ?cursor=… for the next page)` : description,
      actions,
      async read(m: ResourceMatch) {
        if (collection && [...m.query.keys()].length > 0) {
          const cursor = m.query.get('cursor')
          const pageSize = m.query.get('page_size')
          if (cursor) return client.invoke(root, 'page', { cursor, ...(pageSize ? { page_size: Number(pageSize) } : {}) })
          const query: Record<string, JsonValue> = {}
          for (const [k, v] of m.query) if (k !== 'page_size') query[k] = v
          return client.invoke(root, 'query', { query, ...(pageSize ? { page_size: Number(pageSize) } : {}) })
        }
        const card = await client.card(root)
        const props = isObject(profile) && isObject(profile.properties) ? Object.keys(profile.properties).filter(p => p !== 'index_schema') : []
        const listed = isObject(profile) && Array.isArray(profile['x-buckyos:summary_props'])
          ? (profile['x-buckyos:summary_props'] as JsonValue[]).filter((p): p is string => typeof p === 'string') : props
        const summary: Record<string, JsonValue> = {}
        for (const p of listed) summary[p] = await client.readProperty(root, p) as JsonValue
        return renderObjectDocument(root, { id: String(card.id), alsoKnownAs: card.alsoKnownAs }, profile, summary)
      },
    }
  }
  return out
}
