// `aiws run-exec`: a wish macro run with the tool's own Deno, restricted to its stage directory, its bridge over stdio
// (AI Native phase 1, section 2.6). Its own host: the policy lets this tool start Deno.
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { createRegistry } from '../core/app.ts'
import { ConfigStore } from '../core/config.ts'
import { createMockCommandContext } from '../core/context.ts'
import type { ServiceClientRegistry } from '../core/runtime.ts'
import { installHost, TOOL_ENVIRONMENT_NAMES } from '../runtime/host.ts'
import { DenoHost } from '../runtime/host_deno.ts'
import { assert, assertEquals, testConfig } from './test_helpers.ts'

installHost(new DenoHost({
  name: 'developer-default', distribution: 'developer', packageRoot: path.resolve(Deno.cwd()), readPaths: [path.resolve(Deno.cwd(), '..'), tmpdir()],
  writePaths: [path.resolve(Deno.cwd()), tmpdir()], environment: TOOL_ENVIRONMENT_NAMES.filter((n) => n !== 'BUCKYOS_ROOT'), subprocesses: [Deno.execPath()], network: true,
}))

function clientsFor(): ServiceClientRegistry {
  return { call: () => Promise.resolve({}) } as unknown as ServiceClientRegistry
}

Deno.test('run-exec runs a macro restricted to its stage directory and answers its bridge over stdio', async () => {
  const parent = await Deno.makeTempDir({ prefix: 'aiws-run-exec-' })
  const dir = `${parent}/work`
  await Deno.mkdir(`${dir}/lib`, { recursive: true })
  await Deno.mkdir(`${dir}/program`, { recursive: true })
  await Deno.writeTextFile(`${parent}/claim.json`, '{"run_token":"rt_secret"}')
  await Deno.writeTextFile(`${dir}/program/main.js`, 'export default async function main() {}')
  await Deno.writeTextFile(`${dir}/lib/stage.json`, JSON.stringify({ budget: { program_timeout_secs: 30 }, manifest: { inputs: {}, results: {} } }))
  await Deno.writeTextFile(`${dir}/lib/host.js`, 'export function createBridgeHost(o) { return { handle: async (op, req) => ({ op, req, budget: o.budget, manifest: o.manifest, zone: o.zoneHosts }) } }')
  await Deno.writeTextFile(`${dir}/lib/run.js`, `
const enc = new TextEncoder()
const attempt = (f) => { try { return f() } catch (e) { return e.name } }
const claim = attempt(() => Deno.readTextFileSync('../claim.json'))
const env = attempt(() => Object.keys(Deno.env.toObject()).length)
const outside = attempt(() => { Deno.writeTextFileSync('lib/x.js', 'x'); return 'written' })
Deno.stdout.writeSync(enc.encode('\\x1eaiws ' + JSON.stringify({ id: 1, op: 'sql', req: { query: 'SELECT 1' } }) + '\\n'))
const reader = Deno.stdin.readable.getReader()
let text = ''
while (!text.includes('\\n')) { const { value, done } = await reader.read(); if (done) break; text += new TextDecoder().decode(value) }
Deno.mkdirSync('output/.aiws', { recursive: true })
Deno.writeTextFileSync('output/.aiws/results.json', JSON.stringify({ claim, env, outside, answer: JSON.parse(text), declare: {}, ai: null, error: null }))
console.error('macro log line')
Deno.exit(0)
`)
  try {
    const command = createRegistry().get('aiws', 'run-exec')
    const ctx = createMockCommandContext({ command, config: testConfig(), configStore: new ConfigStore('/tmp/buckyos-tool-aiws-test'), clients: clientsFor(), traceId: 'aiws-test' })
    ctx.cwd = parent
    const out = await command.handler(ctx, { workspace_id: 'ws_a', run_id: 'run_1', attempt: 1, dir: 'work' }) as Record<string, unknown>
    assertEquals(out.exit_code, 0, JSON.stringify(out))
    const results = JSON.parse(await Deno.readTextFile(`${dir}/output/.aiws/results.json`))
    assert(results.claim === 'NotCapable' || results.claim === 'PermissionDenied', `the macro read outside its directory: ${results.claim}`)
    assert(results.env === 'NotCapable' || results.env === 'PermissionDenied' || results.env === 0, `the macro saw an environment: ${results.env}`)
    assert(results.outside !== 'written', 'the macro wrote outside output/')
    assertEquals(results.answer.id, 1)
    assertEquals(results.answer.body.op, 'sql')
    assertEquals(results.answer.body.budget, { program_timeout_secs: 30 })
    assert(String(out.log).includes('macro log line'))
  } finally {
    await Deno.remove(parent, { recursive: true })
  }
})
