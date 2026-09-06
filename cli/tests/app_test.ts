import './setup.ts'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ndn } from 'buckyos/node'
import type { CommandContext } from '../core/context.ts'
import { getHost, HostError } from '../runtime/host.ts'
import { ConfigStore } from '../core/config.ts'
import { createMockCommandContext } from '../core/context.ts'
import type { RpcCallOptions, ServiceClientRegistry } from '../core/runtime.ts'
import { createAppModule, type PikgSnapshot } from '../modules/app.ts'
import { CommandRegistry } from '../core/registry.ts'
import { assert, assertEquals, assertRejects, testConfig } from './test_helpers.ts'

interface RecordedCall {
  service: string
  method: string
  params: Record<string, unknown>
  options: RpcCallOptions
}

Deno.test('app module exposes the frozen beta 2.2 command surface', () => {
  const module = createAppModule()
  assertEquals(module.commands.map((command) => command.verb), [
    'fetch',
    'list',
    'get',
    'install',
    'upgrade',
    'uninstall',
    'start',
    'stop',
    'restart',
    'status',
  ])
  assert(module.commands.every((command) => command.requiresSession))
  assertEquals(module.commands.find((command) => command.verb === 'uninstall')?.access, {
    mode: 'fixed',
    level: 'destructive',
  })
})

Deno.test('app fetch normalizes a BNS short name before calling Installer', async () => {
  const calls: RecordedCall[] = []
  const clients = clientsFor(calls, (method, params) => {
    if (method === 'apps.inspect') {
      assertEquals(params.source, { kind: 'identifier', identifier: 'did:bns:demo' })
      return inspection('catalog')
    }
    throw new Error(`unexpected method ${method}`)
  })
  const result = await run('fetch', { source: 'demo' }, clients)
  assertEquals((result as Record<string, unknown>).app, samplePlan('catalog').app)
  assertEquals(calls.map((call) => call.method), ['apps.inspect'])
})

Deno.test('app output preserves AppInstanceId and hides server paths', async () => {
  const clients = clientsFor([], (method) => {
    assertEquals(method, 'apps.list')
    return {
      user_id: 'alice',
      total: 1,
      apps: [{
        app_did: 'did:bns:demo',
        app_instance_id: 'demo.bns.did@alice',
        spec_path: 'users/alice/apps/demo/spec',
        web_hosts: ['demo.example.com'],
      }],
    }
  })
  const result = await run('list', {}, clients) as Record<string, unknown>
  const app = (result.apps as Record<string, unknown>[])[0]
  assertEquals(app.app_instance_id, 'demo.bns.did@alice')
  assertEquals(app.spec_path, undefined)
  assertEquals(app.web_hosts, ['demo.example.com'])
})

Deno.test('app RPC errors prioritize invalid sessions over nested not-found text', async () => {
  const clients = clientsFor([], () => {
    throw new Error(
      'RPC call error: Invalid token: failed to load identity: Trust key not found',
    )
  })
  await assertRejects(() => run('list', {}, clients), 'INVALID_SESSION')
})

Deno.test('app fetch stages the exact local PIKG snapshot and releases it', async () => {
  const root = await Deno.makeTempDir()
  try {
    const path = join(root, 'demo.pikg')
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4])
    await Deno.writeFile(path, bytes)
    const digest = await sha256Id(bytes)
    const calls: RecordedCall[] = []
    let staged: PikgSnapshot | undefined
    const clients = clientsFor(calls, (method, params) => {
      if (method === 'apps.inspect') {
        assertEquals(params.source, {
          kind: 'local_pikg',
          staging_handle: 'pikg-stage-00000000000000000000000000000001',
        })
        return inspection('pikg', digest)
      }
      if (method === 'apps.staging.release') return { released: true }
      throw new Error(`unexpected method ${method}`)
    })
    const result = await run('fetch', { source: path }, clients, {
      stagePikg: async (_ctx, snapshot, purpose) => {
        staged = snapshot
        assertEquals(await Deno.readFile(snapshot.path), bytes)
        return Promise.resolve({
          schema_version: 4,
          handle: 'pikg-stage-00000000000000000000000000000001',
          pikg_digest: snapshot.digest,
          size: snapshot.size,
          purpose,
        })
      },
    })
    assertEquals(staged?.size, bytes.length)
    await assertRejects(() => Deno.stat(staged!.path))
    assertEquals((result as Record<string, unknown>).source, {
      kind: 'pikg',
      source: path,
      pikg_digest: digest,
      size: bytes.length,
    })
    assertEquals(calls.map((call) => call.method), ['apps.inspect', 'apps.staging.release'])
    assertEquals(calls[1].options.timeoutMs, 5_000)
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('fetch writes a private v4 plan and does not silently overwrite it', async () => {
  const root = await Deno.makeTempDir()
  try {
    const path = join(root, 'demo.install-plan.json')
    const clients = clientsFor([], (method) => {
      if (method === 'apps.inspect') return inspection('catalog')
      throw new Error(`unexpected method ${method}`)
    })
    await run('fetch', { source: 'demo', plan: path }, clients, {}, true)
    assertEquals(JSON.parse(await Deno.readTextFile(path)), samplePlan('catalog'))
    if (Deno.build.os !== 'windows') {
      assertEquals((await Deno.stat(path)).mode! & 0o777, 0o600)
    }
    await assertRejects(
      () => run('fetch', { source: 'demo', plan: path }, clients),
      'CONFIRMATION_REQUIRED',
    )
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('install requires a plan when the App is not installed', async () => {
  const clients = clientsFor([], (method) => {
    if (method === 'apps.inspect') return inspection('catalog')
    if (method === 'apps.details') throw new Error('RPC call error: APP_NOT_INSTALLED: demo')
    throw new Error(`unexpected method ${method}`)
  })
  await assertRejects(
    () => run('install', { source: 'demo' }, clients),
    'PLAN_REQUIRED',
  )
})

Deno.test('fresh install binds plan fingerprint, submits once, and waits to terminal readiness', async () => {
  const root = await Deno.makeTempDir()
  try {
    const plan = samplePlan('catalog')
    const planPath = join(root, 'demo.install-plan.json')
    await Deno.writeTextFile(planPath, JSON.stringify(plan))
    const calls: RecordedCall[] = []
    const clients = clientsFor(calls, (method, params) => {
      if (method === 'apps.plan.recompute') {
        assertEquals(params.plan, plan)
        return inspection('catalog')
      }
      if (method === 'apps.details') throw new Error('RPC call error: APP_NOT_INSTALLED: demo')
      if (method === 'apps.submit') {
        assertEquals(params.plan, plan)
        assertEquals(params.approved_plan_fingerprint, plan.plan_fingerprint)
        assert(typeof params.idempotency_key === 'string')
        return {
          action: 'fresh_install',
          task_id: 'task-1',
          app_instance_id: plan.app_instance_id,
          plan_fingerprint: plan.plan_fingerprint,
        }
      }
      if (method === 'apps.install.status') {
        return {
          schema_version: 4,
          task_id: 'task-1',
          task_phase: 'Terminal',
          task_outcome: 'Succeeded',
          stage: 'activate',
          completed_stages: ['activate'],
          warnings: [],
          updated_at: 1,
        }
      }
      throw new Error(`unexpected method ${method}`)
    })
    const result = await run(
      'install',
      { source: 'demo', plan: planPath },
      clients,
      { sleep: () => Promise.resolve() },
      true,
    ) as Record<string, unknown>
    assertEquals(result.task_id, 'task-1')
    assertEquals((result.status as Record<string, unknown>).task_outcome, 'Succeeded')
    assertEquals(calls.map((call) => call.method), [
      'apps.plan.recompute',
      'apps.details',
      'apps.submit',
      'apps.install.status',
    ])
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test('installed App rejects a fresh plan before submission', async () => {
  const root = await Deno.makeTempDir()
  try {
    const planPath = join(root, 'demo.install-plan.json')
    await Deno.writeTextFile(planPath, JSON.stringify(samplePlan('catalog')))
    const clients = clientsFor([], (method) => {
      if (method === 'apps.plan.recompute') return inspection('catalog')
      if (method === 'apps.details') return installedDetails()
      throw new Error(`unexpected method ${method}`)
    })
    await assertRejects(
      () => run('install', { source: 'demo', plan: planPath }, clients, {}, true),
      'PLAN_NOT_APPLICABLE',
    )
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

for (const verb of ['install', 'upgrade'] as const) {
  Deno.test(`${verb} binds the upgrade plan without a plan file and preserves inherited settings`, async () => {
    const upgrade = inspection('catalog')
    const plan = upgrade.plan as Record<string, unknown>
    plan.plan_use = 'UPGRADE'
    plan.task_id = 'task-upgrade'
    plan.plan_fingerprint = `planfp:${'4'.repeat(64)}`
    plan.install_params = {
      selected_components: ['script'],
      permissions: [],
      service_settings: { services: { www: { enabled: true } } },
      bash_envs: { MODE: 'custom' },
      res_pool_id: 'custom-pool',
      auto_start: false,
      expected_instance_count: 2,
    }
    const status = upgrade.status as Record<string, unknown>
    status.plan_fingerprint = plan.plan_fingerprint
    const calls: RecordedCall[] = []
    const clients = clientsFor(calls, (method, params) => {
      if (method === 'apps.upgrade.check') {
        assertEquals(params.selector, 'did:bns:demo')
        return { items: [{ app_did: 'did:bns:demo', state: 'UPDATE_AVAILABLE' }] }
      }
      if (method === 'apps.details') return installedDetails()
      if (method === 'apps.inspect') {
        if (params.action !== 'upgrade') return inspection('catalog')
        assertEquals(params.owner_user_id, 'alice')
        assertEquals(params.install_params, undefined)
        return upgrade
      }
      if (method === 'apps.submit') {
        return { action: 'upgrade', task_id: plan.task_id }
      }
      throw new Error(`unexpected method ${method}`)
    })
    const input = verb === 'install'
      ? { source: 'demo', no_wait: true }
      : { app_name: 'demo', no_wait: true }
    const result = await run(verb, input, clients, {}, true) as Record<string, unknown>
    assertEquals(result.task_id, plan.task_id)
    const submissions = calls.filter((call) => call.method === 'apps.submit')
    assertEquals(submissions.length, 1)
    const params = submissions[0].params
    assertEquals(params.plan, plan, 'submit must preserve the inspected upgrade plan and task ID')
    assertEquals(params.approved_plan_fingerprint, plan.plan_fingerprint)
    assertEquals(params.owner_user_id, plan.owner_user_id)
    assertEquals(params.target, plan.target)
    assertEquals(params.install_params, plan.install_params)
  })
}

Deno.test('batch upgrade with no available changes is synchronous and creates no task', async () => {
  const calls: RecordedCall[] = []
  const clients = clientsFor(calls, (method) => {
    if (method === 'apps.upgrade.check') {
      return { batch: true, total: 1, items: [{ app_did: 'did:bns:demo', state: 'UP_TO_DATE' }] }
    }
    throw new Error(`unexpected method ${method}`)
  })
  assertEquals(await run('upgrade', {}, clients), {
    action: 'satisfied',
    total: 1,
    items: [{ app_did: 'did:bns:demo', state: 'UP_TO_DATE' }],
  })
  assertEquals(calls.map((call) => call.method), ['apps.upgrade.check'])
})

Deno.test('lifecycle mutation maps the selector and supports no-wait', async () => {
  const clients = clientsFor([], (method, params) => {
    assertEquals(method, 'apps.restart')
    assertEquals(params.selector, 'did:bns:demo')
    assertEquals(params.restart_strategy, 'recreate')
    return { task_id: 'task-restart', action: 'restart' }
  })
  assertEquals(await run('restart', { app_name: 'demo', no_wait: true }, clients), {
    task_id: 'task-restart',
    action: 'restart',
  })
  await assertRejects(
    () => run('restart', { app_name: 'demo', strategy: 'rolling' }, clients),
    'UNSUPPORTED_STRATEGY',
  )
})

for (const size of [32 * 1024 * 1024 - 1, 32 * 1024 * 1024, 32 * 1024 * 1024 + 1]) {
  Deno.test(`app stages a ${size}-byte PIKG as a FileObject with bounded chunks`, async () => {
    await exercisePikgTransport(size, 'remote')
  })
}

Deno.test('system app stages a large local PIKG without HTTP upload', async () => {
  await exercisePikgTransport(33 * 1024 * 1024, 'local')
})

Deno.test('local endpoint without shared staging falls back to FileObject upload', async () => {
  await exercisePikgTransport(33 * 1024 * 1024, 'fallback')
})

Deno.test('local staging without filesystem write permission uses FileObject upload', async () => {
  await exercisePikgTransport(1024, 'permission')
})

Deno.test('app streams URL input and binds the uploaded FileObject to its digest', async () => {
  await exercisePikgTransport(32 * 1024 * 1024 + 1, 'url')
})

Deno.test('app does not finalize after a failed chunk upload and cleans its snapshot', async () => {
  await exercisePikgTransport(32 * 1024 * 1024 + 1, 'failure')
})

Deno.test('app cancels between chunks and cleans its snapshot without finalizing', async () => {
  await exercisePikgTransport(32 * 1024 * 1024 + 1, 'abort')
})

async function exercisePikgTransport(
  size: number,
  mode: 'remote' | 'local' | 'fallback' | 'url' | 'failure' | 'abort' | 'permission',
): Promise<void> {
  const root = await Deno.makeTempDir()
  const host = getHost()
  const policy = host.policy
  const openFile = host.open
  const fetcher = globalThis.fetch
  const abort = new AbortController()
  try {
    const source = join(root, 'source.pikg')
    const bytes = new Uint8Array(size).fill(19)
    bytes.set([0x50, 0x4b, 0x03, 0x04])
    await Deno.writeFile(source, bytes)
    const digest = await sha256Id(bytes)
    const uploaded: string[] = []
    const uploadedHash = host.createHash('sha256')
    let uploadedSize = 0
    const objects = new Map<string, string>()
    let localAttempts = 0
    let finalizations = 0
    if (mode === 'local' || mode === 'fallback' || mode === 'permission') {
      Object.defineProperty(host, 'policy', {
        value: { ...policy, buckyosRoot: root },
        configurable: true,
      })
    }
    if (mode === 'permission') {
      host.open = (path, options) =>
        options.write && path.includes('incoming')
          ? Promise.reject(new HostError('PermissionDenied', 'incoming is not writable'))
          : openFile.call(host, path, options)
    }
    globalThis.fetch = (request, init) => {
      const url = String(request)
      if (mode === 'url' && url === 'https://download.invalid/app.pikg') {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes.subarray(0, 2))
            controller.enqueue(bytes.subarray(2))
            controller.close()
          },
        })
        return Promise.resolve(new Response(body))
      }
      assert(mode !== 'local', 'local staging must not upload over HTTP')
      if (url.includes('/write/chunk/')) {
        if (mode === 'failure') {
          return Promise.resolve(
            Response.json({ error: 'failed', message: 'upload rejected' }, { status: 413 }),
          )
        }
        const body = init!.body as Uint8Array
        assert(body.length <= 32 * 1024 * 1024)
        const chunk = ndn.ChunkId.fromMix256Result(body.length, ndn.sha256Bytes(body)).toString()
        assert(url.endsWith(chunk))
        assertEquals(new Headers(init!.headers).get('NDM-Chunk-Size'), String(body.length))
        uploaded.push(chunk)
        uploadedHash.update(body)
        uploadedSize += body.length
        if (mode === 'abort') abort.abort()
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      assert(url.endsWith('/rpc/put_object'), url)
      const value = JSON.parse(init!.body as string)
      objects.set(value.obj_id, value.obj_data)
      return Promise.resolve(new Response(null, { status: 204 }))
    }
    const clients = clientsFor([], async (method, params) => {
      if (method === 'apps.staging.finalize') {
        assertEquals(params.pikg_digest, digest)
        assertEquals(params.size, size)
        if (params.local_file_id) {
          localAttempts++
          assertEquals(params.source_obj_id, undefined)
          assert(/^[a-f0-9]{32}$/.test(params.local_file_id as string))
          if (mode === 'fallback') throw new Error('LOCAL_PIKG_UNAVAILABLE: not on this machine')
          const local = join(
            root,
            'cache',
            'control_panel',
            'pikg_staging',
            'incoming',
            `${params.local_file_id}.pikg`,
          )
          const copied = await Deno.readFile(local)
          assertEquals(await sha256Id(copied), digest)
          await Deno.writeFile(source, new Uint8Array([9]))
          assertEquals(await sha256Id(await Deno.readFile(local)), digest)
        } else {
          const sourceId = params.source_obj_id as string
          assert(sourceId.startsWith(`${ndn.OBJ_TYPE_FILE}:`), sourceId)
          const object = ndn.FileObject.fromJSON(JSON.parse(objects.get(sourceId)!))
          assertEquals(object.genObjId()[0].toString(), sourceId)
          assertEquals(object.size, size)
          if (uploaded.length > 1) {
            const list = ndn.SimpleChunkList.fromJson(objects.get(object.content)!)
            assertEquals(list.genObjId()[0].toString(), object.content)
            assertEquals(list.body.map((chunk) => chunk.toString()), uploaded)
          } else {
            assertEquals(object.content, uploaded[0])
          }
          assertEquals(uploadedSize, size)
          assertEquals(uploadedHash.digestHex(), digest)
        }
        finalizations++
        return {
          schema_version: 4,
          handle: 'pikg-stage-test',
          pikg_digest: digest,
          size,
          purpose: params.purpose,
        }
      }
      if (method === 'apps.inspect') return inspection('pikg', digest)
      if (method === 'apps.staging.release') return { released: true }
      throw new Error(`unexpected method ${method}`)
    })
    const invoke = () =>
      run(
        'fetch',
        { source: mode === 'url' ? 'https://download.invalid/app.pikg' : source },
        clients,
        {},
        false,
        (ctx) => {
          ctx.configStore = new ConfigStore(join(root, 'config'))
          ctx.connection.endpoint = mode === 'local' || mode === 'fallback' || mode === 'permission'
            ? 'http://127.0.0.1:3180'
            : 'https://remote.invalid'
          ctx.signal = abort.signal
          const session = {
            token: 'test-token',
            principal: ctx.principal,
            claims: {},
            renewable: false,
          }
          ctx.session = {
            config: ctx.config,
            connect: () => Promise.resolve(session),
            ensureValid: () => Promise.resolve(session),
            reconnect: () => Promise.resolve(session),
            current: () => session,
            status: () => ({}),
          }
        },
      )
    if (mode === 'failure' || mode === 'abort') {
      await assertRejects(invoke, mode === 'failure' ? 'PIKG_UPLOAD_FAILED' : undefined)
      assertEquals(finalizations, 0)
    } else {
      await invoke()
      assertEquals(finalizations, 1)
      assertEquals(localAttempts, mode === 'local' || mode === 'fallback' ? 1 : 0)
    }
    const temporaryDirectory = mode === 'local' || mode === 'fallback'
      ? join(root, 'cache', 'control_panel', 'pikg_staging', 'incoming')
      : join(root, 'config')
    assertEquals(Array.from(Deno.readDirSync(temporaryDirectory)), [])
  } finally {
    globalThis.fetch = fetcher
    host.open = openFile
    Object.defineProperty(host, 'policy', { value: policy, configurable: true })
    await Deno.remove(root, { recursive: true })
  }
}

function clientsFor(
  calls: RecordedCall[],
  response: (method: string, params: Record<string, unknown>) => unknown,
): ServiceClientRegistry {
  return {
    call: <T>(
      service: string,
      method: string,
      params: Record<string, unknown>,
      options: RpcCallOptions,
    ) => {
      calls.push({ service, method, params, options })
      return Promise.resolve(response(method, params) as T)
    },
  }
}

async function run(
  verb: string,
  input: Record<string, unknown>,
  clients: ServiceClientRegistry,
  dependencies: Parameters<typeof createAppModule>[0] = {},
  confirmed = false,
  configure?: (context: CommandContext) => void,
): Promise<unknown> {
  const registry = new CommandRegistry()
  registry.register(createAppModule(dependencies))
  const command = registry.get('app', verb)
  const context = createMockCommandContext({
    command,
    config: testConfig({ nonInteractive: true, yes: confirmed }),
    configStore: new ConfigStore(join(tmpdir(), 'buckyos-tool-app-test')),
    clients,
    traceId: 'app-test',
  })
  context.confirmed = confirmed
  context.deadline = Date.now() + 10_000
  configure?.(context)
  return await command.handler(context, input)
}

function inspection(kind: 'catalog' | 'pikg', digest?: string): Record<string, unknown> {
  const plan = samplePlan(kind, digest)
  return {
    schema_version: 4,
    plan,
    resolution_status: plan.resolution,
    status: {
      plan_fingerprint: plan.plan_fingerprint,
      target_snapshot: plan.target,
      readiness: {
        document_syntax: 'READY',
        trust: 'READY',
        package_integrity: 'READY',
        content: 'READY',
        target: 'READY',
        config: 'READY',
        install: 'OFFLINE_READY',
      },
      contents: [],
      target_issues: [],
      config_issues: [],
      permission_options: [],
      estimated_download_bytes: 0,
      warnings: [],
      inspected_at: 1,
    },
  }
}

function samplePlan(kind: 'catalog' | 'pikg', digest?: string): Record<string, unknown> {
  const appDocId = `appdoc:${'1'.repeat(64)}`
  return {
    schema_version: 4,
    plan_use: 'FRESH_INSTALL',
    task_id: 'task-plan',
    app_instance_id: 'demo.bns.did@alice',
    owner_user_id: 'alice',
    source_identity: kind === 'catalog'
      ? { kind: 'catalog', app_doc_object_id: appDocId }
      : { kind: 'pikg', app_doc_object_id: appDocId, pikg_digest: digest },
    app: {
      did: 'did:bns:demo',
      object_id: appDocId,
      show_name: 'Demo',
      version: '1.0.0',
    },
    app_doc: {},
    resolution: {
      app_did: 'did:bns:demo',
      doc_type: 'app',
      app_doc_object_id: appDocId,
      document_status: 'Active',
      warnings: [],
    },
    target: { os: 'linux', arch: 'x86_64', capabilities: {} },
    selected_packages: [],
    required_contents: [],
    install_params: {
      selected_components: [],
      permissions: [],
      service_settings: {},
      auto_start: true,
      expected_instance_count: 1,
    },
    service_spec_config: {},
    plan_fingerprint: `planfp:${'3'.repeat(64)}`,
    created_at: 1,
  }
}

function installedDetails(): Record<string, unknown> {
  return {
    app_id: 'demo.bns.did',
    app_instance_id: 'demo.bns.did@alice',
    owner_user_id: 'alice',
    summary: {},
    spec: {},
  }
}

async function sha256Id(bytes: Uint8Array): Promise<string> {
  const copy = Uint8Array.from(bytes)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', copy.buffer))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
