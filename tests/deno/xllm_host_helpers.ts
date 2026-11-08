// Helpers of the Deno host tests (not a test file): assertions, the Rust
// `agent_tool` binary when it is built, the scripted OpenAI mock as a
// subprocess (these tests run without --allow-net; the mock and the Rust
// binary talk to each other), fixture installation.

// deno-lint-ignore-file no-explicit-any
export { installFixture, nativeRuntimeId } from '../fixtures/xllm/runs/rewrite_paths.ts'

/** The shared vectors and Rust run fixtures, read where Rust keeps them: a sibling buckyos checkout, or XLLM_VECTORS_DIR. */
export const VECTORS = (Deno.env.get('XLLM_VECTORS_DIR') ?? new URL('../../../buckyos/src/frame/llm_context/tests/vectors', import.meta.url).pathname)
  .replace(/\/?$/, '/')
export const HAVE_VECTORS = (() => {
  try {
    return Deno.statSync(VECTORS).isDirectory
  } catch {
    return false
  }
})()
export const FIXTURES = `${VECTORS}runs/`
export const MOCK = new URL('../fixtures/xllm/runs/mock_openai.mjs', import.meta.url).pathname

/** A test that reads the vectors or run fixtures; ignored without them. */
export function fixtureTest(name: string, fn: () => Promise<void> | void) {
  Deno.test({ name: HAVE_VECTORS ? name : `${name} (skipped: no vectors at ${VECTORS})`, ignore: !HAVE_VECTORS, fn })
}
export const HOST_ID = 'xllm-fixture'
export const KEY_ENV = 'XLLM_FIXTURE_KEY'

Deno.env.set('AGENT_TOOL_HOST_ID', HOST_ID)
Deno.env.set(KEY_ENV, 'fixture-key')

export function fail(msg: string): never {
  throw new Error(msg)
}

function sorted(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sorted)
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted((v as Record<string, unknown>)[k])]))
  return v
}

/** Structural equality (object key order ignored, like serde_json maps). */
export function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(sorted(actual))
  const e = JSON.stringify(sorted(expected))
  if (a !== e) fail(`${msg}:\n  expected ${e}\n  got      ${a}`)
}

export function ok(cond: unknown, msg: string) {
  if (!cond) fail(msg)
}

/** Rejects with an XllmError of `kind`; returns it. */
export async function rejects(p: Promise<unknown>, kind: string, msg: string): Promise<any> {
  try {
    await p
  } catch (e: any) {
    if (e?.kind !== kind) fail(`${msg}: expected XllmError ${kind}, got ${e?.kind ?? ''} ${e?.message ?? e}`)
    return e
  }
  fail(`${msg}: expected a ${kind} rejection`)
}

export async function tempDir(prefix = 'xllm-deno-'): Promise<string> {
  return await Deno.realPath(await Deno.makeTempDir({ prefix }))
}

/** `agent_tool` (`cargo build -p agent_tool_cli_dev`), when it is there. */
export function rustBin(): string | undefined {
  const candidates = [
    Deno.env.get('XLLM_RUST_BIN'),
    '/tmp/dev-cache-root/cargo-target/debug/agent_tool',
    new URL('../../../buckyos/src/target/debug/agent_tool', import.meta.url).pathname,
  ]
  for (const c of candidates) {
    if (!c) continue
    try {
      if (Deno.statSync(c).isFile) return c
    } catch {
      // next
    }
  }
  return undefined
}

export interface Ran {
  code: number
  stdout: string
  stderr: string
}

export async function runRust(args: string[], env: Record<string, string> = {}): Promise<Ran> {
  const bin = rustBin() ?? fail('no agent_tool binary')
  const out = await new Deno.Command(bin, {
    args, stdin: 'null', stdout: 'piped', stderr: 'piped', env: { AGENT_TOOL_HOST_ID: HOST_ID, [KEY_ENV]: 'fixture-key', ...env },
  }).output()
  const dec = new TextDecoder()
  return { code: out.code, stdout: dec.decode(out.stdout), stderr: dec.decode(out.stderr) }
}

export function spawnRust(args: string[]): Deno.ChildProcess {
  const bin = rustBin() ?? fail('no agent_tool binary')
  return new Deno.Command(bin, {
    args, stdin: 'null', stdout: 'null', stderr: 'null', env: { AGENT_TOOL_HOST_ID: HOST_ID, [KEY_ENV]: 'fixture-key' },
  }).spawn()
}

export interface Mock {
  port: number
  baseUrl(scenario: string): string
  setScript(script: Record<string, unknown[]>): Promise<void>
  requests(): Promise<{ scenario: string; n: number; body: any }[]>
  close(): Promise<void>
}

/** The scripted OpenAI mock in a subprocess (`deno run --allow-net mock_openai.mjs`). */
export async function startMock(script: Record<string, unknown[]>): Promise<Mock> {
  const dir = await tempDir('xllm-mock-')
  const scriptPath = `${dir}/script.json`
  const logPath = `${dir}/requests.jsonl`
  await Deno.writeTextFile(scriptPath, JSON.stringify(script))
  const child = new Deno.Command(Deno.execPath(), {
    args: ['run', '--allow-net', '--allow-read', '--allow-write', MOCK, '--script', scriptPath, '--log', logPath],
    stdin: 'null', stdout: 'piped', stderr: 'inherit',
  }).spawn()
  const reader = child.stdout.getReader()
  let text = ''
  while (!/listening (\d+)/.test(text)) {
    const { value, done } = await reader.read()
    if (done) fail(`mock exited: ${text}`)
    text += new TextDecoder().decode(value)
  }
  const port = Number(/listening (\d+)/.exec(text)?.[1])
  return {
    port,
    baseUrl: scenario => `http://127.0.0.1:${port}/s/${scenario}/v1`,
    setScript: s => Deno.writeTextFile(scriptPath, JSON.stringify(s)),
    async requests() {
      try {
        return (await Deno.readTextFile(logPath)).trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
      } catch {
        return []
      }
    },
    async close() {
      try {
        child.kill('SIGKILL')
      } catch {
        // gone
      }
      await reader.cancel().catch(() => undefined)
      await child.status
    },
  }
}

/** The text of the tool result for `callId` in an inference request's messages. */
export function toolResultText(messages: any[], callId: string): string | undefined {
  for (const m of messages) {
    for (const b of m.content ?? []) {
      if (b.type === 'tool_result' && b.call_id === callId) {
        return (b.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
      }
    }
  }
  return undefined
}

export async function sleep(ms: number) {
  await new Promise(r => setTimeout(r, ms))
}

export async function waitFor(cond: () => Promise<boolean>, ms: number, what: string) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (await cond()) return
    await sleep(50)
  }
  fail(`timed out waiting for ${what}`)
}
