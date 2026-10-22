/** @jest-environment node */
// Wire fixtures shared with buckyos-api (`tests/hybrid_sso_fixtures.rs`). The
// buckyos checkout is expected beside this repository (BUCKYOS_SOURCE overrides).

import * as fs from 'fs'
import * as path from 'path'
import {
  accessDenialOf,
  buildJumpUrl,
  identityAllows,
  identityKey,
  normalizeZoneHostname,
  parseAccessDenial,
  parseCurrentIdentity,
  zoneActionUrl,
} from '../../src/hybrid_sso'
import { RPCError } from '../../src/krpc_client'

const FIXTURE_DIR = path.resolve(
  process.env.BUCKYOS_SOURCE ?? path.join(__dirname, '../../../buckyos'),
  'src/kernel/buckyos-api/tests/fixtures/hybrid_sso',
)

const fixtureAvailable = fs.existsSync(FIXTURE_DIR)
const describeFixtures = fixtureAvailable ? describe : describe.skip

function fixture(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8'))
}

describeFixtures('hybrid SSO wire fixtures', () => {
  it('parses every identity kind', () => {
    const account = parseCurrentIdentity(fixture('current_identity_account.json'))
    expect(account?.kind).toBe('account')
    expect(account && identityAllows(account, 'account_self')).toBe(true)
    const external = parseCurrentIdentity(fixture('current_identity_external.json'))
    expect(external?.kind).toBe('external')
    expect(external && identityAllows(external, 'account_self')).toBe(false)
    expect(external && identityAllows(external, 'aiworkspace')).toBe(true)
    const admin = parseCurrentIdentity(fixture('current_identity_admin.json'))
    expect(admin && identityAllows(admin, 'account_self')).toBe(true)
    expect(parseCurrentIdentity(fixture('current_identity_anonymous.json'))).toEqual({ kind: 'anonymous' })
    expect(account && external && identityKey(account) !== identityKey(external)).toBe(true)
  })

  it('parses denials and reads them off an RPC failure by code only', () => {
    for (const name of [
      'access_denial_grant_missing.json',
      'access_denial_invite_expired.json',
      'access_denial_zone_disabled.json',
      'access_denial_kind_not_allowed.json',
    ]) {
      expect(parseAccessDenial(fixture(name))).not.toBeNull()
    }
    const wire = fixture('rpc_failure_access_denied.json') as { error: string, code: string, data: unknown }
    const error = new RPCError(`RPC call error: ${wire.error}`, wire.code, wire.data)
    expect(accessDenialOf(error)?.reason).toBe('resource_grant_missing')
    expect(accessDenialOf(new RPCError('access denied: resource_grant_missing'))).toBeNull()
    expect(accessDenialOf(new RPCError('x', 'other_code', wire.data))).toBeNull()
  })
})

describe('jump helpers', () => {
  it('normalizes bare hostnames and rejects anything else', () => {
    expect(normalizeZoneHostname('Alice.Example.COM.')).toBe('alice.example.com')
    for (const bad of [
      'https://alice.example.com',
      'user@alice.example.com',
      'alice.example.com:8443',
      'alice.example.com/x',
      'alice.example.com?x=1',
      'alice.example.com#x',
      'alice%2eexample.com',
      'localhost',
      '-bad.example.com',
    ]) {
      expect(normalizeZoneHostname(bad)).toBeNull()
    }
  })

  it('builds registered action URLs with parameters in the fragment', () => {
    expect(zoneActionUrl('alice.example.com', 'app_installer')).toBe('https://alice.example.com/sysdlg/app_installer')
    expect(zoneActionUrl('alice.example.com', 'saveas')).toBeNull()
    const url = buildJumpUrl('app_installer', { app_url: 'https://a.example/app.pkg' })
    expect(url.startsWith('https://jump.buckyos.org/sysdlg/app_installer#')).toBe(true)
    expect(new URL(url).search).toBe('')
    expect(buildJumpUrl('app_installer', {}, 'https://jump.example')).toBe('https://jump.example/sysdlg/app_installer')
    expect(() => buildJumpUrl('evil', {})).toThrow()
    expect(() => buildJumpUrl('app_installer', {}, 'http://jump.example')).toThrow()
  })
})
