#!/usr/bin/env node
// Rust ↔ TS conformance of xllm (TS runtime TODO T4-4), against one scripted
// OpenAI mock (tests/fixtures/xllm/runs/mock_openai.mjs):
//   (a) the same task run by `agent_tool xllm --no-tools` and by the Deno host:
//       status, usage.llm_requests and result.raw must match (and the native
//       runtime identity both derive on this machine);
//   (b) Rust runs to a mock Transient error (paused), the Deno host resumes it
//       to completed in the same runs_dir.
// Without the Rust binary (`cargo build -p agent_tool_cli_dev`; XLLM_RUST_BIN
// to point at one) the script prints why and exits 0. Needs `pnpm build`.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startMockOpenai } from '../tests/fixtures/xllm/runs/mock_openai.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rust = [process.env.XLLM_RUST_BIN, '/tmp/dev-cache-root/cargo-target/debug/agent_tool', resolve(root, '../buckyos/src/target/debug/agent_tool')]
  .find(p => p && existsSync(p))
if (!rust) {
  console.log('test-xllm-conformance: skipped — no agent_tool binary (cargo build -p agent_tool_cli_dev in buckyos/src, or set XLLM_RUST_BIN)')
  process.exit(0)
}
if (!existsSync(join(root, 'dist/xllm_deno.mjs'))) {
  console.error('test-xllm-conformance: dist/xllm_deno.mjs missing; run pnpm build first')
  process.exit(1)
}
const deno = process.env.DENO ?? 'deno'
const KEY_ENV = 'XLLM_FIXTURE_KEY'
const env = { ...process.env, [KEY_ENV]: 'conformance-key' }
delete env.AGENT_TOOL_HOST_ID // the real machine identity on both sides

let failures = 0
function check(cond, what, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}${!cond && detail ? `\n     ${detail}` : ''}`)
  if (!cond) failures += 1
}

// Asynchronous: the mock answers from this process's event loop.
function run(cmd, args) {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', c => { stdout += c })
    child.stderr.on('data', c => { stderr += c })
    child.on('error', e => resolve({ code: -1, stdout, stderr: String(e) }))
    child.on('close', code => resolve({ code, stdout, stderr }))
  })
}

function denoDriver(args) {
  return run(deno, ['run', '--allow-read', '--allow-write', '--allow-env', '--allow-run', '--allow-net', join(root, 'scripts/xllm-deno-driver.ts'), ...args])
}

const record = (runsDir, id) => JSON.parse(readFileSync(join(runsDir, id, 'run.json'), 'utf8'))

const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'xllm-conformance-')))
const script = {
  a_rust: [{ content: 'hello from the mock' }],
  a_deno: [{ content: 'hello from the mock' }],
  c_rust: [{ content: 'hello' }],
  c_deno: [{ content: 'hello' }],
  b: [
    { tool_calls: [{ id: 'call_write_1', name: 'write_file', arguments: { path: 'notes.txt', content: 'written by rust\n' } }] },
    { status: 503, body: { error: { message: 'mock overloaded', type: 'server_error' } } },
    { content: 'deno finished it' },
  ],
}
const mock = await startMockOpenai({ script, log: join(tmp, 'requests.jsonl') })
const baseUrl = s => `http://127.0.0.1:${mock.port}/s/${s}/v1`

function workdir(name, scenario, tools) {
  const dir = join(tmp, name)
  mkdirSync(join(dir, 'work'), { recursive: true })
  const cfg = { provider: { type: 'openai', base_url: baseUrl(scenario), api_key_env: KEY_ENV }, model: 'mock-model', runtime: { task_wait_ms: 1800000 } }
  if (tools) cfg.tools = { enabled: true }
  writeFileSync(join(dir, 'work/.llm_context'), JSON.stringify(cfg, null, 2))
  return { work: join(dir, 'work'), runs: join(dir, 'runs') }
}

try {
  // (a) the same task on both executors
  const ra = workdir('a_rust', 'a_rust', false)
  const r = await run(rust, ['xllm', '--no-tools', '--dir', ra.work, '--runs-dir', ra.runs, '--format', 'json', '--run-logs', 'result', 'Say hello.'])
  check(r.code === 0, '(a) agent_tool xllm --no-tools exits 0', r.stderr)
  const rustId = JSON.parse(r.stdout || '{}').runid ?? JSON.parse(r.stdout || '{}').run_id
  const da = workdir('a_deno', 'a_deno', false)
  const d = await denoDriver(['run', '--workdir', da.work, '--runs-dir', da.runs, '--user', 'Say hello.', '--no-tools'])
  check(d.code === 0, '(a) Deno host run exits 0', d.stderr)
  const denoId = JSON.parse(d.stdout.trim().split('\n').pop() || '{}').run_id
  if (rustId && denoId) {
    const rr = record(ra.runs, rustId)
    const dr = record(da.runs, denoId)
    check(rr.status === dr.status, `(a) status: rust=${rr.status} deno=${dr.status}`)
    check(rr.usage.llm_requests === dr.usage.llm_requests, `(a) usage.llm_requests: rust=${rr.usage.llm_requests} deno=${dr.usage.llm_requests}`)
    check(rr.result?.raw === dr.result?.raw, `(a) result.raw: ${JSON.stringify(rr.result?.raw)} / ${JSON.stringify(dr.result?.raw)}`)
    const rd = rr.config.runtime_descriptor
    const dd = dr.config.runtime_descriptor
    check(rd.runtime_id === dd.runtime_id && rd.host === dd.host && JSON.stringify(rd.target) === JSON.stringify(dd.target),
      `(a) native identity on this machine: ${rd.runtime_id} ${rd.host}`, `rust ${JSON.stringify(rd)}\n     deno ${JSON.stringify(dd)}`)
    const reqs = readFileSync(join(tmp, 'requests.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l))
    const sys = s => reqs.find(q => q.scenario === s)?.body.messages.find(m => m.role === 'system')?.content ?? ''
    const norm = (t, work) => t.split(work).join('<workdir>').replace(/\d{4}-\d\d-\d\dT[\d:]+[+-]\d{4}/g, '<time>')
    check(norm(sys('a_rust'), ra.work) === norm(sys('a_deno'), da.work), '(a) system prompts identical (workdir and time normalized)')
  }

  // (a') the same with the bash group: the prompt and the tools on the wire
  const rc = workdir('c_rust', 'c_rust', true)
  const dc = workdir('c_deno', 'c_deno', true)
  const rcr = await run(rust, ['xllm', '--dir', rc.work, '--runs-dir', rc.runs, '--run-logs', 'result', 'Say hello.'])
  const dcr = await denoDriver(['run', '--workdir', dc.work, '--runs-dir', dc.runs, '--user', 'Say hello.'])
  check(rcr.code === 0 && dcr.code === 0, "(a') tools on: both complete", `${rcr.stderr}\n${dcr.stderr}`)
  {
    const reqs = readFileSync(join(tmp, 'requests.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l))
    const body = s => reqs.find(q => q.scenario === s)?.body ?? {}
    const norm = (t, work) => (t ?? '').split(work).join('<workdir>').replace(/\d{4}-\d\d-\d\dT[\d:]+[+-]\d{4}/g, '<time>')
    const sysOf = (s, work) => norm(body(s).messages?.find(m => m.role === 'system')?.content, work)
    check(sysOf('c_rust', rc.work) === sysOf('c_deno', dc.work), "(a') system prompts identical")
    const canon = v => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x))
    check(canon(body('c_rust').tools) === canon(body('c_deno').tools), "(a') advertised tools identical on the wire (key order aside)")
  }

  // (b) Rust pauses on Transient, Deno resumes in the same runs_dir
  const rb = workdir('b', 'b', true)
  const p = await run(rust, ['xllm', '--dir', rb.work, '--runs-dir', rb.runs, '--run-logs', 'result', 'Write notes.txt, then finish.'])
  check(p.code === 3, `(b) agent_tool xllm pauses (exit ${p.code})`, p.stderr)
  const ids = existsSync(rb.runs) ? spawnSync('ls', [rb.runs], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean) : []
  if (ids.length === 1) {
    const before = record(rb.runs, ids[0])
    check(before.status === 'paused' && before.last_error?.kind === 'provider_transient', `(b) Rust record: ${before.status} ${before.last_error?.kind}`)
    const res = await denoDriver(['resume', '--runs-dir', rb.runs, '--run', ids[0]])
    check(res.code === 0, '(b) Deno host resume exits 0', res.stderr)
    const after = record(rb.runs, ids[0])
    check(after.status === 'completed', `(b) status after the Deno resume: ${after.status}`, JSON.stringify(after.last_error))
    check(after.result?.raw === 'deno finished it', `(b) result.raw: ${JSON.stringify(after.result?.raw)}`)
    check(after.usage.llm_requests === before.usage.llm_requests + 1, `(b) usage.llm_requests ${before.usage.llm_requests} → ${after.usage.llm_requests}`)
    check(readFileSync(join(rb.work, 'notes.txt'), 'utf8') === 'written by rust\n', '(b) the file Rust wrote is there')
    const view = await run(rust, ['xllm', 'result', '--run', ids[0], '--runs-dir', rb.runs, '--format', 'json'])
    check(view.code === 0 && JSON.parse(view.stdout || '{}').status === 'completed', '(b) Rust reads the run the Deno host finished', view.stderr)
  } else {
    check(false, '(b) one Rust run', `runs: ${ids.join(', ')}`)
  }
} finally {
  await mock.close()
}
console.log(failures ? `test-xllm-conformance: ${failures} failure(s) (${tmp})` : 'test-xllm-conformance: all checks passed')
process.exit(failures ? 1 : 0)
