import { DID } from './namelib'

export type AppId = string
export type AppDID = string
export type AppInstanceId = string

export interface ParsedAppInstanceId {
  appId: AppId
  ownerUserId: string
}

function validateDnsHostname(value: string): void {
  if (!value || value.length > 253 || value.includes('@')) {
    throw new Error('hostname must be 1..=253 bytes and must not contain `@`')
  }
  if (value !== value.toLowerCase() || !/^[\x00-\x7f]+$/.test(value)) {
    throw new Error('hostname must be canonical lowercase ASCII')
  }

  for (const label of value.split('.')) {
    if (
      !label ||
      label.length > 63 ||
      label.startsWith('-') ||
      label.endsWith('-') ||
      !/^[a-z0-9-]+$/.test(label)
    ) {
      throw new Error(`invalid DNS label \`${label}\``)
    }
  }
}

function canonicalAppIdFromDid(appDid: AppDID): AppId {
  const match = /^did:([^:]+):(.+)$/.exec(appDid)
  if (!match) {
    throw new Error('AppDID must be a canonical DID')
  }

  const [, method, id] = match
  if (
    !method ||
    !id ||
    method !== method.toLowerCase() ||
    id !== id.toLowerCase() ||
    id.includes(':') ||
    id.includes('#') ||
    id.includes('%')
  ) {
    throw new Error(
      'AppDID must be a canonical lowercase hostname-form DID without path, port, encoding, or fragment',
    )
  }

  const did = new DID(method, id)
  const appId = did.toRawHostName()
  validateDnsHostname(appId)
  if (method === 'web' && appId.endsWith('.did')) {
    throw new Error('AppDID did:web hostnames ending in `.did` are reserved')
  }
  if (DID.fromStr(appId).toString() !== appDid) {
    throw new Error('AppDID raw hostname does not round-trip')
  }
  return appId
}

export function appIdFromDid(appDid: AppDID): AppId {
  return canonicalAppIdFromDid(appDid.trim())
}

export function parseAppId(value: string): AppId {
  const appId = value.trim()
  validateDnsHostname(appId)
  const appDid = DID.fromStr(appId).toString()
  const canonical = canonicalAppIdFromDid(appDid)
  if (canonical !== appId) {
    throw new Error('AppId is not a canonical AppDID raw hostname')
  }
  return canonical
}

export function appDidFromId(value: string): AppDID {
  return DID.fromStr(parseAppId(value)).toString()
}

function validateOwnerUserId(value: string): void {
  if (!value || value.length > 64 || !/^[a-z0-9._-]+$/.test(value)) {
    throw new Error('owner_user_id must be lowercase ASCII and contain only [a-z0-9._-]')
  }
}

export function createAppInstanceId(appId: string, ownerUserId: string): AppInstanceId {
  const parsedAppId = parseAppId(appId)
  validateOwnerUserId(ownerUserId)
  return `${parsedAppId}@${ownerUserId}`
}

export function parseAppInstanceId(value: string): ParsedAppInstanceId {
  const normalized = value.trim()
  const separator = normalized.lastIndexOf('@')
  if (separator <= 0 || separator === normalized.length - 1) {
    throw new Error('AppInstanceId must be `{app_id}@{owner_user_id}`')
  }

  const appId = parseAppId(normalized.slice(0, separator))
  const ownerUserId = normalized.slice(separator + 1)
  validateOwnerUserId(ownerUserId)
  return { appId, ownerUserId }
}
