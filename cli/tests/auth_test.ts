import './setup.ts'
import { namelib, parseSessionTokenClaims } from 'buckyos'
import {
  authenticatedSession,
  AuthenticationSession,
  type AuthenticationTransport,
} from '../core/auth.ts'
import { ToolError } from '../core/errors.ts'
import { assert, assertEquals, assertRejects, jwt, testConfig } from './test_helpers.ts'

Deno.test('external session keeps token appid and principal', () => {
  const token = jwt({
    sub: 'alice',
    appid: 'jarvis',
    app_instance_id: 'jarvis@alice',
    exp: Math.floor(Date.now() / 1_000) + 600,
  })
  const session = authenticatedSession(token, 'session-token', false)
  assertEquals(session.principal.id, 'alice')
  assertEquals(session.principal.appId, 'jarvis')
  assertEquals(session.principal.appInstanceId, 'jarvis@alice')
  assertEquals(session.renewable, false)
})

Deno.test('expired external session returns stable SESSION_EXPIRED', async () => {
  const token = jwt({
    sub: 'alice',
    appid: 'jarvis',
    exp: Math.floor(Date.now() / 1_000) - 1,
  })
  await assertRejects(
    () => authenticatedSession(token, 'session-token', false),
    'SESSION_EXPIRED',
  )
})

Deno.test('session token file is reread on reconnect', async () => {
  const root = await Deno.makeTempDir()
  try {
    const path = `${root}/token.jwt`
    const first = jwt({ sub: 'alice', appid: 'jarvis', exp: Math.floor(Date.now() / 1_000) + 600 })
    const second = jwt({ sub: 'bob', appid: 'jarvis', exp: Math.floor(Date.now() / 1_000) + 600 })
    await Deno.writeTextFile(path, first)
    const authentication = new AuthenticationSession(
      testConfig({ configDir: root, sessionTokenFile: path }),
      {},
    )
    assertEquals((await authentication.connect()).principal.id, 'alice')
    await Deno.writeTextFile(path, second)
    assertEquals((await authentication.reconnect()).principal.id, 'bob')
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('identity login reads the new IdentityRoots layout and exchanges a signed JWT', async () => {
  const root = await Deno.makeTempDir()
  try {
    const publicRoot = `${root}/identity`
    const securityRoot = `${root}/security`
    const did = 'did:bns:alice'
    const directory = namelib.DID.fromStr(did).toFilename()
    await Deno.mkdir(`${publicRoot}/${directory}`, { recursive: true })
    await Deno.mkdir(`${securityRoot}/${directory}`, { recursive: true })
    await Deno.writeTextFile(
      `${publicRoot}/${directory}/did.json`,
      JSON.stringify({ id: did, name: 'alice' }),
    )
    const keyPair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey))
    await Deno.writeTextFile(
      `${securityRoot}/${directory}/authentication.private.pem`,
      pem(pkcs8),
    )

    let exchangedJwt = ''
    let exchangedTarget: unknown
    const finalToken = jwt({
      sub: 'alice',
      appid: 'buckycli',
      iss: 'verify-hub',
      exp: Math.floor(Date.now() / 1_000) + 600,
    })
    const transport: AuthenticationTransport = {
      loginByJwt: (_url, loginJwt, target) => {
        exchangedJwt = loginJwt
        exchangedTarget = target
        return Promise.resolve(finalToken)
      },
      loginByPassword: () => Promise.reject(new Error('unexpected password login')),
    }
    const authentication = new AuthenticationSession(
      testConfig({
        configDir: root,
        identity: did,
        identityRoot: publicRoot,
        securityRoot,
        nonInteractive: true,
      }),
      {},
      { transport },
    )
    const session = await authentication.connect()
    assertEquals(session.principal.authentication, 'identity')
    assertEquals(session.principal.appId, 'buckycli')
    assert(exchangedJwt.length > 0)
    const claims = parseSessionTokenClaims(exchangedJwt)
    assertEquals(claims?.sub, 'alice')
    assertEquals(claims?.iss, 'alice')
    assertEquals(claims?.appid, 'buckycli')
    assertEquals(exchangedTarget, {
      kind: 'app',
      app_instance_id: 'buckycli@alice',
    })
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('device identity login uses the buckycli system auth target', async () => {
  const root = await Deno.makeTempDir()
  try {
    const publicRoot = `${root}/identity`
    const securityRoot = `${root}/security`
    const did = 'did:web:ood1.test.example.com'
    const directory = namelib.DID.fromStr(did).toFilename()
    await Deno.mkdir(`${publicRoot}/${directory}`, { recursive: true })
    await Deno.mkdir(`${securityRoot}/${directory}`, { recursive: true })
    await Deno.writeTextFile(
      `${publicRoot}/${directory}/did.json`,
      JSON.stringify({
        id: did,
        name: 'ood1',
        device_type: 'ood',
        zone_did: 'did:web:test.example.com',
      }),
    )
    const keyPair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey))
    await Deno.writeTextFile(
      `${securityRoot}/${directory}/authentication.private.pem`,
      pem(pkcs8),
    )

    let exchangedTarget: unknown
    const finalToken = jwt({
      sub: 'ood1',
      appid: 'buckycli',
      iss: 'verify-hub',
      exp: Math.floor(Date.now() / 1_000) + 600,
    })
    const transport: AuthenticationTransport = {
      loginByJwt: (_url, _loginJwt, target) => {
        exchangedTarget = target
        return Promise.resolve(finalToken)
      },
      loginByPassword: () => Promise.reject(new Error('unexpected password login')),
    }
    const authentication = new AuthenticationSession(
      testConfig({
        configDir: root,
        identity: did,
        identityRoot: publicRoot,
        securityRoot,
        nonInteractive: true,
      }),
      {},
      { transport },
    )

    await authentication.connect()
    assertEquals(exchangedTarget, {
      kind: 'system',
      service_id: 'buckycli',
    })
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('implicit identities use a stable order and rotate only on an authentication rejection', async () => {
  const root = await Deno.makeTempDir()
  try {
    await writeIdentity(root, 'did:bns:bob', 'bob')
    await writeIdentity(root, 'did:bns:alice', 'alice')
    const attempts: string[] = []
    const finalToken = jwt({
      sub: 'bob',
      appid: 'buckycli',
      exp: Math.floor(Date.now() / 1_000) + 600,
    })
    const transport: AuthenticationTransport = {
      loginByJwt: (_url, loginJwt) => {
        const identity = String(parseSessionTokenClaims(loginJwt)?.sub)
        attempts.push(identity)
        if (identity === 'alice') {
          return Promise.reject(
            new ToolError('IDENTITY_KIND_NOT_ACCEPTED', 'developer identity is disabled', 3),
          )
        }
        return Promise.resolve(finalToken)
      },
      loginByPassword: () => Promise.reject(new Error('unexpected password login')),
    }
    const authentication = new AuthenticationSession(
      testConfig({ configDir: root, identity: undefined, nonInteractive: true }),
      {},
      { transport },
    )
    assertEquals((await authentication.connect()).principal.id, 'bob')
    assertEquals(attempts, ['alice', 'bob'])
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('an explicit identity never falls back to another candidate', async () => {
  const root = await Deno.makeTempDir()
  try {
    await writeIdentity(root, 'did:bns:alice', 'alice')
    await writeIdentity(root, 'did:bns:bob', 'bob')
    const attempts: string[] = []
    const transport: AuthenticationTransport = {
      loginByJwt: (_url, loginJwt) => {
        attempts.push(String(parseSessionTokenClaims(loginJwt)?.sub))
        return Promise.reject(
          new ToolError('AUTHENTICATION_REJECTED', 'identity was rejected', 3),
        )
      },
      loginByPassword: () => Promise.reject(new Error('unexpected password login')),
    }
    const authentication = new AuthenticationSession(
      testConfig({ configDir: root, identity: 'did:bns:alice', nonInteractive: true }),
      {},
      { transport },
    )
    await assertRejects(() => authentication.connect(), 'AUTHENTICATION_REJECTED')
    assertEquals(attempts, ['alice'])
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('implicit identity rotation stops on non-authentication errors', async () => {
  const root = await Deno.makeTempDir()
  try {
    await writeIdentity(root, 'did:bns:alice', 'alice')
    await writeIdentity(root, 'did:bns:bob', 'bob')
    const attempts: string[] = []
    const transport: AuthenticationTransport = {
      loginByJwt: (_url, loginJwt) => {
        attempts.push(String(parseSessionTokenClaims(loginJwt)?.sub))
        return Promise.reject(new ToolError('SERVICE_UNAVAILABLE', 'network unavailable', 5, true))
      },
      loginByPassword: () => Promise.reject(new Error('unexpected password login')),
    }
    const authentication = new AuthenticationSession(
      testConfig({ configDir: root, identity: undefined, nonInteractive: true }),
      {},
      { transport },
    )
    await assertRejects(() => authentication.connect(), 'SERVICE_UNAVAILABLE')
    assertEquals(attempts, ['alice'])
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('password login uses the user-owned buckycli app target', async () => {
  let exchangedTarget: unknown
  const finalToken = jwt({
    sub: 'alice',
    appid: 'buckycli',
    app_instance_id: 'buckycli@alice',
    iss: 'verify-hub',
    exp: Math.floor(Date.now() / 1_000) + 600,
  })
  const transport: AuthenticationTransport = {
    loginByJwt: () => Promise.reject(new Error('unexpected JWT login')),
    loginByPassword: (_url, _username, _password, target) => {
      exchangedTarget = target
      return Promise.resolve(finalToken)
    },
  }
  const authentication = new AuthenticationSession(
    testConfig({ nonInteractive: false }),
    {},
    {
      transport,
      readUsername: () => Promise.resolve('alice'),
      readPassword: () => Promise.resolve('secret'),
    },
  )

  await authentication.connect()
  assertEquals(exchangedTarget, {
    kind: 'app',
    app_instance_id: 'buckycli@alice',
  })
})

function pem(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const encoded = btoa(binary).match(/.{1,64}/g)!.join('\n')
  return `-----BEGIN PRIVATE KEY-----\n${encoded}\n-----END PRIVATE KEY-----\n`
}

async function writeIdentity(root: string, did: string, name: string): Promise<void> {
  const directory = namelib.DID.fromStr(did).toFilename()
  const publicDirectory = `${root}/local/identity/${directory}`
  const securityDirectory = `${root}/security/${directory}`
  await Deno.mkdir(publicDirectory, { recursive: true })
  await Deno.mkdir(securityDirectory, { recursive: true })
  await Deno.writeTextFile(`${publicDirectory}/did.json`, JSON.stringify({ id: did, name }))
  const keyPair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey))
  await Deno.writeTextFile(`${securityDirectory}/authentication.private.pem`, pem(pkcs8))
}
