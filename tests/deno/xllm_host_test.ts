// Unit tests of the Deno host (xllm TS TODO T4-1 / T4-2): `FileRunStore`
// (layout, atomic writes, version gate, flock), the native runtime's
// configuration gates and the bash group (specs equal Rust's saved ones,
// workspace policy on real paths, `shell` exec dirs / truncation / timeout /
// env / cancellation, recovery by call id).
// `pnpm build` first: this imports dist/.

// deno-lint-ignore-file no-explicit-any
import * as x from '../../dist/xllm.mjs'
import * as dev from '../../dist/xllm_dev.mjs'
import * as host from '../../dist/xllm_deno.mjs'
import { FIXTURES, eq, fixtureTest, ok, rejects, tempDir } from './xllm_host_helpers.ts'

const WAIT = { task_wait_ms: 1_800_000 }

function record(runId: string, extra: Record<string, unknown> = {}): any {
  return { version: 7, run_id: runId, status: 'paused', workdir: '/w', created_at_ms: 1, updated_at_ms: 2, summary: 's', input: {}, config: {},
    prompt: {}, artifacts: [], usage: { llm_requests: 0 }, compactions: 0, pid: 1, ...extra }
}

function snapshot(n: number): any {
  return { request: { n }, state: { snapshot_version: 6 } }
}

async function files(dir: string): Promise<string[]> {
  const out: string[] = []
  for await (const e of Deno.readDir(dir)) out.push(e.name)
  return out.sort()
}

// ------------------------------------------------------------------ store

Deno.test('FileRunStore: Rust layout, atomic writes, round trip', async () => {
  const dir = await tempDir()
  const store = new host.FileRunStore(`${dir}/runs`)
  const id = await store.createRun()
  ok(/^\d{8}-\d{6}-[0-9a-f]{6}$/.test(id), `run id ${id}`)
  eq(await files(`${dir}/runs/${id}`), ['snapshots'], 'created run dir')
  await store.writeRecord(record(id))
  eq(await store.putSnapshot(id, snapshot(1)), 1, 'first snapshot')
  eq(await store.putSnapshot(id, snapshot(2)), 2, 'second snapshot')
  eq(await files(`${dir}/runs/${id}`), ['run.json', 'snapshots'], 'no tmp files left')
  eq(await files(`${dir}/runs/${id}/snapshots`), ['0001.json', '0002.json'], 'snapshot names')
  ok((await Deno.readTextFile(`${dir}/runs/${id}/run.json`)).includes('\n  "run_id"'), 'run.json is pretty')
  eq((await store.readRecord(id)).summary, 's', 'read back')
  eq((await store.getSnapshot(id, 2)).request.n, 2, 'snapshot read back')
  eq(await store.listSnapshots(id), [1, 2], 'listSnapshots')
  eq((await store.listRecords()).map((r: any) => r.run_id), [id], 'listRecords')
  eq(store.runDir(id), `${dir}/runs/${id}`, 'runDir')

  const other = new host.FileRunStore(`${dir}/other`)
  await x.importRun(other, await x.exportRun(store, id))
  eq((await x.exportRun(other, id)).snapshots.map((s: any) => s[0]), [1, 2], 'import keeps snapshot indices')
  await store.removeRun(id)
  await rejects(store.readRecord(id), 'run_not_found', 'removed')
})

Deno.test('FileRunStore: readRecord gates like Rust', async () => {
  const dir = await tempDir()
  const store = new host.FileRunStore(dir)
  await rejects(store.readRecord('20260101-000000-000000'), 'run_not_found', 'missing')
  await Deno.mkdir(`${dir}/v5`)
  await Deno.writeTextFile(`${dir}/v5/run.json`, JSON.stringify(record('v5', { version: 5 })))
  const e = await rejects(store.readRecord('v5'), 'not_resumable', 'other version')
  ok(/unsupported run record version/.test(e.message), e.message)
  await Deno.mkdir(`${dir}/bad`)
  await Deno.writeTextFile(`${dir}/bad/run.json`, '{ not json')
  await rejects(store.readRecord('bad'), 'corrupted_run', 'bad JSON')
  await rejects(store.getSnapshot('bad', 1), 'corrupted_run', 'missing snapshot')
})

Deno.test('FileRunStore: run lock is a flock (same process, other process)', async () => {
  const dir = await tempDir()
  const store = new host.FileRunStore(dir)
  const id = await store.createRun()
  ok(!(await store.isRunLive(id)), 'free')
  const lock: any = await store.lockRun(id)
  ok(lock, 'acquired')
  eq((await Deno.readTextFile(`${dir}/${id}/.lock`)).trim(), String(Deno.pid), 'owner pid written like Rust')
  eq(await store.lockRun(id), null, 'second open file of this process is refused (flock, not fcntl)')
  ok(await store.isRunLive(id), 'live while held')
  const probe = await new Deno.Command(Deno.execPath(), {
    args: ['eval', `const f = await Deno.open(${JSON.stringify(`${dir}/${id}/.lock`)}, { read: true, write: true }); console.log(await f.tryLock(true))`],
    stdout: 'piped',
  }).output()
  eq(new TextDecoder().decode(probe.stdout).trim(), 'false', 'another process cannot take it')
  await lock.release()
  ok(!(await store.isRunLive(id)), 'free after release')
})

Deno.test('working-directory lock: blake3 file name, one tool-enabled run per directory', async () => {
  const locks = await tempDir()
  const lockWorkdir = host.workdirLocker(locks)
  const a: any = await lockWorkdir('/work/project', 'run-a')
  ok(a, 'first')
  eq(await lockWorkdir('/work/project', 'run-b'), null, 'second refused')
  eq((await Deno.readTextFile(`${locks}/c2f433bcc22dbb561d378ab2.lock`)).trim(), 'run-a', 'Rust file name (vector h), owner run id')
  await a.release()
  const b: any = await lockWorkdir('/work/project', 'run-b')
  ok(b, 'free again')
  await b.release()
})

Deno.test('runs_dir resolution: ~, relative to the configuration, none', () => {
  const home = Deno.env.get('HOME')
  eq(host.runsDirOf(undefined, '/etc/x/.llm_context'), `${home}/.xllm/runs`, 'default')
  eq(host.runsDirOf({ kind: 'path', path: '~/r' }, '/etc/x/.llm_context'), `${home}/r`, '~')
  eq(host.runsDirOf({ kind: 'path', path: '/abs/r' }, '/etc/x/.llm_context'), '/abs/r', 'absolute')
  const parsed: any = x.parseLlmContextJson('/etc/x/.llm_context', { runs_dir: 'runs' })
  eq(host.runsDirOf(parsed.runs_dir, '/etc/x/.llm_context'), '/etc/x/runs', 'relative to the file')
  eq(host.runsDirOf({ kind: 'disabled' }, '/etc/x/.llm_context'), undefined, 'none')
})

// ------------------------------------------------------------------ runtime

function ctxOf(abort = new AbortController()): any {
  const stopped = new Promise(resolve => abort.signal.addEventListener('abort', () => resolve('interrupted'), { once: true }))
  return { signal: abort.signal, cause: () => (abort.signal.aborted ? 'interrupted' : undefined), cancelled: () => stopped, cancelledHard: () => stopped }
}

async function opened(tools: any = { enabled: true }, config: any = WAIT, runDir?: string) {
  const work = await tempDir('xllm-work-')
  const runtime = await host.createNativeRuntime({ config: { env: {}, ...config }, workdir: work })
  const o = await runtime.open({ workdir: work, run_id: 'r1', loop_model: 'function_call', sources: {}, env: {}, task_wait_ms: config.task_wait_ms ?? 25_000 }, tools)
  o.manager.bindRun({ run_id: 'r1', run_dir: runDir })
  let n = 0
  const call = (name: string, args: any, ctx = ctxOf()): Promise<any> => o.manager.callTool({ name, args, call_id: `c${++n}` }, ctx)
  return { work, runtime, ...o, call }
}

fixtureTest('bash group specs equal the ones Rust saved in run.json', async () => {
  const fixture = JSON.parse(await Deno.readTextFile(`${FIXTURES}paused_transient/fixture.json`))
  const saved = JSON.parse(await Deno.readTextFile(`${FIXTURES}paused_transient/runs/${fixture.run_id}/run.json`)).config.tools
  const { tools } = await opened()
  eq(tools.native, saved.native, 'ResolvedTool list (names, descriptions, schemas, sources)')
  eq(tools.tool_sources, saved.tool_sources, 'tool sources')
  eq(tools.exec_enabled, true, 'exec_enabled')
  const unrestricted = await opened({ enabled: true, filesystem_policy: 'unrestricted', shell: { timeout_ms: 60_000, max_timeout_ms: 0 } }, WAIT)
  const shell: any = unrestricted.tools.native.find((t: any) => t.name === 'shell')
  ok(shell.description.includes('Default timeout 60s, no upper limit;'), shell.description)
  ok(!('maximum' in shell.args_schema.properties.timeout_ms), 'no maximum when unlimited')
})

Deno.test('native runtime gates: what this host cannot run is a capability error', async () => {
  await rejects(opened({ enabled: true }, {}), 'capability', 'default task_wait_ms (shell would hand commands to tasks)')
  await rejects(opened({ enabled: true, tools: [{ kind: 'group', groupname: 'bash_core' }] }), 'capability', 'bash_core')
  await rejects(opened({ enabled: true, tools: [{ kind: 'mcp', endpoint: 'http://127.0.0.1:9' }] }), 'capability', 'mcp')
  await rejects(opened({ enabled: true, tools: [{ kind: 'named', name: 'read_file' }] }), 'capability', 'named host tool')
  await rejects(opened({ enabled: true, tools2actions: true }), 'capability', 'tools2actions in function_call')
  await rejects(host.createNativeRuntime({ config: { kind: 'remote_ssh', env: {} } }), 'capability', 'remote_ssh')
  await rejects(host.createNativeRuntime({ config: { kind: 'container', env: {} } }), 'capability', 'planned kind')
  await rejects(host.createNativeRuntime({ config: { env: {} }, workdir: '/nonexistent/xllm' }), 'capability', 'missing workdir')
  const off = await opened({ enabled: false }, {})
  eq(off.tools.native, [], 'tools off: nothing, any wait budget')
})

Deno.test('file tools: write, read (dedup), edit; artifacts', async () => {
  const t = await opened()
  const w = await t.call('write_file', { path: 'a/b.txt', content: 'one\ntwo\n', intent: 'make the file' })
  eq(w.kind, 'success', 'write')
  eq(w.content, 'created a/b.txt, wrote 8 bytes across 2 lines', 'write text (Rust summary)')
  eq(await Deno.readTextFile(`${t.work}/a/b.txt`), 'one\ntwo\n', 'written')
  const r1 = await t.call('read_file', { path: 'a/b.txt', range: '2' })
  eq(r1.content, 'succeeded, read 4 bytes across 1 line at 2\n```content\n2: two\n```', 'read range')
  const r2 = await t.call('read_file', { path: 'a/b.txt', range: '2' })
  eq(r2.content, '`a/b.txt` is unchanged since you read it earlier in this run; use that content.', 'dedup')
  const e = await t.call('edit_file', { path: 'a/b.txt', old_string: 'two', new_string: 'TWO' })
  eq(e.kind, 'success', 'edit')
  ok(e.content.startsWith('edited a/b.txt with replace at line 2\n```diff\n--- a/a/b.txt'), e.content)
  eq((await t.call('edit_file', { path: 'a/b.txt', old_string: 'zzz', new_string: 'y' })).message,
    'invalid args: `old_string` was not found in the file', 'edit: absent')
  await t.call('write_file', { path: 'a/b.txt', content: 'x x', mode: 'append' })
  eq((await t.call('edit_file', { path: 'a/b.txt', old_string: 'x', new_string: 'y' })).message,
    'invalid args: `old_string` must match exactly once, found 2 matches', 'edit: twice')
  eq((await t.call('write_file', { path: 'a/b.txt', content: 'n', mode: 'new' })).message,
    'invalid args: write mode `new` requires target file not exist: a/b.txt', 'write new over existing')
  eq((await t.call('write_file', { content: 'n' })).message, 'invalid args: invalid args for `write_file`: missing field `path`', 'missing arg')
  eq(t.manager.artifacts(), [`${t.work}/a/b.txt`], 'artifacts')
})

Deno.test('workspace policy checks real paths', async () => {
  const t = await opened()
  const outside = await tempDir('xllm-outside-')
  await Deno.writeTextFile(`${outside}/secret.txt`, 'secret')
  await Deno.symlink(outside, `${t.work}/link`)
  eq((await t.call('read_file', { path: '../x.txt' })).kind, 'error', 'lexical escape')
  ok(/path not allowed by policy/.test((await t.call('read_file', { path: `${outside}/secret.txt` })).message), 'absolute outside')
  ok(/path not allowed by policy/.test((await t.call('read_file', { path: 'link/secret.txt' })).message), 'symlink escape')
  ok(/path not allowed by policy/.test((await t.call('write_file', { path: 'link/new.txt', content: 'x' })).message), 'symlink escape on write')
  ok(/path not allowed by policy/.test((await t.call('shell', { command: 'pwd', cwd: 'link' })).message), 'shell cwd escape')
  const u = await opened({ enabled: true, filesystem_policy: 'unrestricted' })
  await Deno.symlink(outside, `${u.work}/link`)
  ok((await u.call('read_file', { path: 'link/secret.txt' })).content.includes('1: secret'), 'unrestricted follows the OS')
})

Deno.test('shell: exec dir, env, exit codes, output truncation', async () => {
  const runDir = await tempDir('xllm-run-')
  const t = await opened({ enabled: true }, WAIT, runDir)
  const ok1 = await t.call('shell', { command: 'echo "$XLLM_RUN_ID $XLLM_CALL_ID"; echo err >&2' })
  eq(ok1.kind, 'success', 'exit 0')
  eq(ok1.content, 'r1 c1\nerr\n', 'stdout then stderr')
  eq(await files(`${runDir}/exec/c1`), ['command', 'exit', 'stderr', 'stdout'], 'exec dir')
  eq(await Deno.readTextFile(`${runDir}/exec/c1/exit`), '0\n', 'exit file')
  const bad = await t.call('shell', { command: 'echo nope; exit 3' })
  eq(bad.kind, 'error', 'exit 3')
  ok(/^exit=3 in \d+ms\nnope$/.test(bad.message), bad.message)
  eq(bad.host.return_code, 3, 'return code')
  const big = await t.call('shell', { command: 'head -c 100000 /dev/zero | tr "\\0" a' })
  ok(big.truncated, 'truncated flag')
  ok(/\n…\[34464 bytes omitted\]…\n/.test(big.content), 'head 1/4 + tail 3/4 of 64 KB')
  eq((await t.call('shell', { command: '   ' })).message, 'invalid args: `command` is required and must be non-empty', 'empty command')
  eq((await t.call('shell', { command: 'true', timeout_ms: 'x' })).message, 'invalid args: `timeout_ms` must be a non-negative integer', 'bad timeout')
})

Deno.test('shell: timeout stops the command (direct child), cancellation reports stopped', async () => {
  const t = await opened()
  const started = Date.now()
  const r = await t.call('shell', { command: 'echo before; sleep 20', timeout_ms: 300 })
  ok(Date.now() - started < 10_000, 'returned at the timeout')
  eq(r.kind, 'error', 'timed out is an error')
  ok(/^timed out after \d+ms \(timeout_ms=300\); the command was stopped\. Retry with a larger timeout_ms \(max 3600000\)/.test(r.message), r.message)
  eq(r.host.detail.exit_code, 124, 'TIMEOUT_EXIT_CODE')
  eq(r.host.detail.timed_out, true, 'timed_out')
  const abort = new AbortController()
  const p = t.call('shell', { command: 'echo working; sleep 20' }, ctxOf(abort))
  setTimeout(() => abort.abort(), 300)
  const c = await p
  eq(c.kind, 'cancelled', 'cancelled')
  ok(/^shell \(native\): `echo working; sleep 20` was stopped after \d+ms because the run was interrupted\./.test(c.reason), c.reason)
  eq(c.effect_unknown, false, 'known effect')
})

Deno.test('recovery by call id: idempotent read runs again, the rest is Unresolved', async () => {
  const t = await opened()
  await Deno.writeTextFile(`${t.work}/f.txt`, 'x\n')
  t.manager.setRecovering('c1', 'reason A')
  eq((await t.call('read_file', { path: 'f.txt' })).kind, 'success', 'read_file is idempotent')
  t.manager.setRecovering('c2', 'reason B')
  eq(await t.call('write_file', { path: 'f.txt', content: 'y' }), { kind: 'unresolved', call_id: 'c2', reason: 'reason B', effect_unknown: true }, 'write')
  eq(await Deno.readTextFile(`${t.work}/f.txt`), 'x\n', 'not written')
  t.manager.setRecovering('c3', 'reason C')
  eq((await t.call('shell', { command: 'touch ran' })).kind, 'unresolved', 'shell')
  ok(!(await Deno.stat(`${t.work}/ran`).catch(() => null)), 'shell not run')
  eq(await t.runtime.describeInterrupted({ run_id: 'r1' }, { name: 'write_file', args: {}, call_id: 'c9' }), x.unresolvedReason('write_file'),
    'other tools: the generic account')
})

Deno.test('a new native task runs end to end with the bash group', async () => {
  const root = await tempDir('xllm-task-')
  await Deno.mkdir(`${root}/work`)
  const store = new host.FileRunStore(`${root}/runs`)
  const llm = new dev.ScriptedLlmClient([
    { tool_calls: [{ name: 'shell', args: { command: 'echo hi > out.txt' }, call_id: 'call_1' }] },
    { tool_calls: [{ name: 'read_file', args: { path: 'out.txt' }, call_id: 'call_2' }] },
    { text: 'out.txt says hi' },
  ])
  const { task, deps } = await host.prepareNativeTask({ provider: { type: 'openai', api_key_env: 'XLLM_FIXTURE_KEY', base_url: 'http://127.0.0.1:9/v1' },
    model: 'm', runtime: WAIT, tools: { enabled: true } }, `${root}/work/.llm_context.json`, { user: 'go' }, {}, { store, llm, workdir: `${root}/work` })
  const run = await x.XllmRun.start(task, deps)
  const out = await run.execute()
  eq(out.status, 'completed', 'completed')
  eq(out.record.usage.llm_requests, 3, 'llm_requests')
  eq(out.record.config.runtime_descriptor.kind, 'native', 'native descriptor saved')
  eq(out.record.pid, Deno.pid, 'pid')
  eq(await Deno.readTextFile(`${root}/work/out.txt`), 'hi\n', 'shell ran in the workdir')
  ok((await files(`${root}/runs/${run.runId}/exec`)).includes('call_1'), 'exec dir in the run dir')
})
