// Taking over run directories across executors (xllm TS TODO T4-3): the
// fixtures are real Rust run directories (Q9 (e)); they are installed under a
// temporary root for this machine (rewrite_paths.ts) and resumed by the Deno
// host. Steps that need the Rust binary (`cargo build -p agent_tool_cli_dev`)
// run when it is built and are skipped otherwise.
// `pnpm build` first: this imports dist/.

// deno-lint-ignore-file no-explicit-any
import * as x from '../../dist/xllm.mjs'
import * as dev from '../../dist/xllm_dev.mjs'
import * as host from '../../dist/xllm_deno.mjs'
import {
  FIXTURES, KEY_ENV, eq, fail, fixtureTest, installFixture, ok, rejects, runRust, rustBin, spawnRust, startMock, tempDir, toolResultText, waitFor,
} from './xllm_host_helpers.ts'

const RUST = rustBin()
const withRust = (name: string) => (RUST ? name : `${name} (skipped: no agent_tool binary)`)

async function install(name: string, options: { baseUrl?: string } = {}) {
  return await installFixture(`${FIXTURES}${name}`, await tempDir(`xllm-${name}-`), options)
}

async function editRecord(runDir: string, f: (r: any) => void) {
  const path = `${runDir}/run.json`
  const r = JSON.parse(await Deno.readTextFile(path))
  f(r)
  await Deno.writeTextFile(path, JSON.stringify(r, null, 2))
}

async function readJson(path: string): Promise<any> {
  return JSON.parse(await Deno.readTextFile(path))
}

fixtureTest('fixture identity: Rust runtime_id = blake3 of the target, as the Deno host derives it', async () => {
  for (const name of ['paused_transient', 'shell_sigkill']) {
    const fixture = await readJson(`${FIXTURES}${name}/fixture.json`)
    const rec = await readJson(`${FIXTURES}${name}/runs/${fixture.run_id}/run.json`)
    const d = rec.config.runtime_descriptor
    eq(host.runtimeIdOf('native', d.target), d.runtime_id, `${name} runtime_id`)
    eq(d.host, `host:${fixture.host_id}:`, `${name} host`)
  }
})

fixtureTest('(i) Rust paused on a Transient error → Deno resumes it to completed', async () => {
  const fx = await install('paused_transient')
  const store = new host.FileRunStore(fx.runsDir)
  const before = await store.readRecord(fx.runId)
  eq(before.status, 'paused', 'fixture status')
  eq(before.last_error.kind, 'provider_transient', 'fixture error')
  const llm = new dev.ScriptedLlmClient([{ text: 'notes.txt is written.' }])
  const start = await host.resumeNativeRun(store, fx.runId, {}, { llm })
  eq(start.kind, 'run', 'resumable')
  const out = await (start as any).run.execute()
  eq(out.status, 'completed', 'status')
  eq(out.record.result.raw, 'notes.txt is written.', 'result')
  eq(await Deno.readTextFile(`${fx.workdir}/notes.txt`), 'written by rust\n', 'the file Rust wrote')
  eq(out.record.usage.llm_requests, before.usage.llm_requests + 1, 'llm_requests added on top')
  eq(out.record.pid, Deno.pid, 'pid is the Deno process')
  ok(out.record.pid !== before.pid, 'pid changed')
  ok(out.record.latest_snapshot_idx > before.latest_snapshot_idx, 'snapshots continued')
  eq(out.record.artifacts, [`${fx.workdir}/notes.txt`], 'the artifact Rust recorded is kept')
  // F6: the model is shown the specs saved in run.json, offered `intent` like Rust
  const req = llm.requests[0]
  eq(req.tool_specs.map((s: any) => s.name), ['edit_file', 'read_file', 'shell', 'write_file'], 'advertised tools (sorted like Rust)')
  for (const saved of before.config.tools.native) {
    const shown = req.tool_specs.find((s: any) => s.name === saved.name)
    eq(shown.description, saved.description, `${saved.name} description`)
    const { intent, ...rest } = shown.args_schema.properties
    eq(rest, saved.args_schema.properties, `${saved.name} properties`)
    ok(intent?.description?.startsWith('Optional:'), `${saved.name} offers intent`)
  }
  eq(toolResultText(req.messages, 'call_write_1'), 'created notes.txt, wrote 16 bytes across 1 line', 'Rust tool result in the history')
  ok(!(await store.isRunLive(fx.runId)), 'lock released')
  if (RUST) {
    const r = await runRust(['xllm', 'result', '--run', fx.runId, '--runs-dir', fx.runsDir, '--format', 'json'])
    eq(r.code, 0, `agent_tool xllm result: ${r.stderr}`)
    const view = JSON.parse(r.stdout)
    eq(view.status, 'completed', 'Rust reads the status')
    eq(view.answer, 'notes.txt is written.', 'Rust reads the answer')
  }
})

fixtureTest('(ii) SIGKILLed in `shell` → Unresolved with Rust\'s describe_interrupted text, then completed', async () => {
  const fx = await install('shell_sigkill')
  const expected = await readJson(`${FIXTURES}shell_sigkill/expected.json`)
  const execDir = `${fx.runDir}/exec/${expected.call_id}`
  const secs = Math.floor(Date.now() / 1000) - expected.command_mtime_offset_secs
  await Deno.utime(`${execDir}/command`, secs, secs)
  const fill = (t: string) => t.split('{{command_mtime_ms}}').join(String(secs * 1000)).split('{{exec_dir}}').join(execDir)
  const store = new host.FileRunStore(fx.runsDir)
  const before = await store.readRecord(fx.runId)
  eq(before.status, 'running', 'killed run is still marked running')
  ok(!(await store.isRunLive(fx.runId)), 'no process holds it')
  const llm = new dev.ScriptedLlmClient([{ text: 'checked; nothing to repeat.' }])
  const start = await host.resumeNativeRun(store, fx.runId, {}, { llm })
  const out = await (start as any).run.execute()
  eq(out.status, 'completed', 'status')
  eq(toolResultText(llm.requests[0].messages, expected.call_id), fill(expected.no_exit.tool_message), 'the model sees Rust\'s text')
  eq(out.record.usage.llm_requests, 1, 'llm_requests (the killed segment wrote none)')
  ok(!(await Deno.stat(`${execDir}/exit`).catch(() => null)), 'the command was not run again')

  // the same account straight from the runtime
  const rt = await host.createNativeRuntime({ config: before.config.runtime, workdir: before.workdir })
  const call = (await store.getSnapshot(fx.runId, before.latest_snapshot_idx)).state.tool_batch.remaining[0]
  eq(await rt.describeInterrupted({ run_id: fx.runId, run_dir: fx.runDir }, call), fill(expected.no_exit.reason), 'describeInterrupted')
})

fixtureTest('(ii-b) the command ended after the crash: Unresolved with exit code and tails (Rust reads it back as a task result)', async () => {
  const fx = await install('shell_sigkill')
  const expected = await readJson(`${FIXTURES}shell_sigkill/expected.json`)
  const execDir = `${fx.runDir}/exec/${expected.call_id}`
  await Deno.writeTextFile(`${execDir}/stdout`, expected.exit_0.stdout_append, { append: true })
  await Deno.writeTextFile(`${execDir}/exit`, expected.exit_0.exit_file)
  const secs = Math.floor(Date.now() / 1000) - expected.command_mtime_offset_secs
  await Deno.utime(`${execDir}/command`, secs, secs)
  const store = new host.FileRunStore(fx.runsDir)
  const llm = new dev.ScriptedLlmClient([{ text: 'reviewed.' }])
  const out = await ((await host.resumeNativeRun(store, fx.runId, {}, { llm })) as any).run.execute()
  eq(out.status, 'completed', 'status')
  const text = toolResultText(llm.requests[0].messages, expected.call_id) ?? ''
  const command = "printf 'started\\n'; sleep 60; printf 'finished\\n' # xllm-fixture-shell"
  eq(text, `[unresolved: result unknown] shell (native): the previous executor exited while \`${command}\` was running (started 2h00m ago (at ${secs * 1000} ms since epoch)). The command has since ended with exit code 0 (read from ${execDir}); its result was never returned, so review it before deciding whether to repeat anything.\n--- stdout (tail) ---\nstarted\nfinished`, 'exit-code branch of describe_interrupted')
})

fixtureTest(withRust('(iii) a Rust process holding the run → run_busy; Deno holding it → Rust refuses'), async () => {
  if (!RUST) return
  const mock = await startMock({ paused: [{ hang: true }] })
  let rust: Deno.ChildProcess | undefined
  try {
    const fx = await install('paused_transient', { baseUrl: mock.baseUrl('paused') })
    const store = new host.FileRunStore(fx.runsDir)
    rust = spawnRust(['xllm', '--resume', '--run', fx.runId, '--runs-dir', fx.runsDir, '--run-logs', 'result'])
    await waitFor(async () => (await mock.requests()).length > 0, 30_000, 'Rust to reach the model')
    ok(await store.isRunLive(fx.runId), 'Rust\'s flock is seen')
    eq(await store.lockRun(fx.runId), null, 'lockRun while Rust holds it')
    eq((await store.readRecord(fx.runId)).status, 'running', 'Rust marked it running')
    await rejects(host.resumeNativeRun(store, fx.runId, {}, { llm: new dev.ScriptedLlmClient([]) }), 'run_busy', 'resume while Rust runs')
    rust.kill('SIGKILL')
    await rust.status
    rust = undefined
    ok(!(await store.isRunLive(fx.runId)), 'free once Rust is gone')

    const lock: any = await store.lockRun(fx.runId)
    ok(lock, 'Deno takes the lock')
    const r = await runRust(['xllm', '--resume', '--run', fx.runId, '--runs-dir', fx.runsDir])
    eq(r.code, 2, `Rust exit code while Deno holds the run (${r.stderr.trim()})`)
    ok(/being executed by another process/.test(r.stderr), `Rust says busy: ${r.stderr}`)
    await lock.release()
  } finally {
    if (rust) {
      rust.kill('SIGKILL')
      await rust.status
    }
    await mock.close()
  }
})

fixtureTest('(iii) a run held by another process → run_busy (lock held by a Deno subprocess)', async () => {
  const fx = await install('paused_transient')
  const store = new host.FileRunStore(fx.runsDir)
  const holder = new Deno.Command(Deno.execPath(), {
    args: ['eval', `const f = await Deno.open(${JSON.stringify(`${fx.runDir}/.lock`)}, { read: true, write: true, create: true }); await f.lock(true); console.log('held'); setInterval(() => {}, 1000)`],
    stdin: 'null', stdout: 'piped', stderr: 'inherit',
  }).spawn()
  const reader = holder.stdout.getReader()
  try {
    let text = ''
    while (!text.includes('held')) text += new TextDecoder().decode((await reader.read()).value)
    ok(await store.isRunLive(fx.runId), 'held elsewhere')
    await editRecord(fx.runDir, r => {
      r.status = 'running'
    })
    await rejects(host.resumeNativeRun(store, fx.runId, {}, { llm: new dev.ScriptedLlmClient([]) }), 'run_busy', 'running and held')
    await editRecord(fx.runDir, r => {
      r.status = 'paused'
    })
    await rejects(host.resumeNativeRun(store, fx.runId, {}, { llm: new dev.ScriptedLlmClient([]) }), 'run_busy', 'paused and held')
  } finally {
    holder.kill('SIGKILL')
    await reader.cancel().catch(() => undefined)
    await holder.status
  }
})

fixtureTest('(iii) rejections: version 5, another workdir, an mcp source, a host-assembled run', async () => {
  const cases: [string, (r: any) => void, string, RegExp][] = [
    ['version 5', r => { r.version = 5 }, 'not_resumable', /unsupported run record version/],
    ['descriptor workdir', r => { r.config.runtime_descriptor.workdir = '/nonexistent/elsewhere' }, 'runtime_mismatch', /target or workdir changed/],
    ['mcp source', r => { r.config.tools.tool_sources.push({ kind: 'mcp', endpoint: 'http://127.0.0.1:9/mcp' }) }, 'not_resumable', /mcp:/],
    ['host', r => {
      r.host = { assembled_by: 'libopendan', session_id: 's1', runtime_kind: 'native', runtime_id: r.config.runtime_descriptor.runtime_id, env_check: {}, extra: {} }
    }, 'not_resumable', /assembled by `libopendan`/],
  ]
  for (const [name, edit, kind, reason] of cases) {
    const fx = await install('paused_transient')
    await editRecord(fx.runDir, edit)
    const store = new host.FileRunStore(fx.runsDir)
    const llm = new dev.ScriptedLlmClient([])
    const e = await rejects(host.resumeNativeRun(store, fx.runId, {}, { llm }), kind, name)
    ok(reason.test(e.message), `${name}: ${e.message}`)
    eq(llm.calls, 0, `${name}: no inference`)
    const lock: any = await store.lockRun(fx.runId)
    ok(lock, `${name}: locks released`)
    await lock.release()
  }
})

fixtureTest('(iii) a saved tool set this host cannot run → not_resumable', async () => {
  const fx = await install('paused_transient')
  await editRecord(fx.runDir, r => {
    r.config.tools.tool_sources = [{ kind: 'group', groupname: 'bash_core' }]
  })
  const store = new host.FileRunStore(fx.runsDir)
  const e = await rejects(host.resumeNativeRun(store, fx.runId, {}, { llm: new dev.ScriptedLlmClient([]) }), 'not_resumable', 'bash_core')
  ok(/bash_core/.test(e.message), e.message)
  const fx2 = await install('paused_transient')
  await editRecord(fx2.runDir, r => {
    r.config.runtime.task_wait_ms = 25_000
  })
  const e2 = await rejects(host.resumeNativeRun(new host.FileRunStore(fx2.runsDir), fx2.runId, {}, { llm: new dev.ScriptedLlmClient([]) }),
    'not_resumable', 'shell that hands commands to tasks')
  ok(/task backend/.test(e2.message), e2.message)
})

Deno.test(withRust('(iv) Deno paused on a Transient error → Rust --resume completes it'), async () => {
  if (!RUST) return
  const mock = await startMock({ reverse: [{ content: 'rust finished it' }] })
  try {
    const root = await tempDir('xllm-reverse-')
    await Deno.mkdir(`${root}/work`)
    const store = new host.FileRunStore(`${root}/runs`)
    const llm = new dev.ScriptedLlmClient([
      { tool_calls: [{ name: 'write_file', args: { path: 'deno.txt', content: 'written by deno\n' }, call_id: 'call_deno_1' }] },
      { error: { kind: 'provider', failure: 'transient', message: 'scripted 503' } },
    ])
    const config = {
      provider: { type: 'openai', base_url: mock.baseUrl('reverse'), api_key_env: KEY_ENV }, model: 'mock-model',
      runtime: { task_wait_ms: 1_800_000 }, tools: { enabled: true },
    }
    const { task, deps } = await host.prepareNativeTask(config, `${root}/work/.llm_context.json`, { user: 'Write deno.txt, then finish.' }, {},
      { store, llm, workdir: `${root}/work` })
    const run = await x.XllmRun.start(task, deps)
    const paused = await run.execute()
    eq(paused.status, 'paused', 'Deno run paused')
    eq(paused.record.last_error.kind, 'provider_transient', 'Transient')
    eq(paused.record.usage.llm_requests, 2, 'two inferences')
    const r = await runRust(['xllm', '--resume', '--run', run.runId, '--runs-dir', `${root}/runs`])
    eq(r.code, 0, `Rust resume exit code: ${r.stderr}`)
    const done = await store.readRecord(run.runId)
    eq(done.status, 'completed', 'Rust completed it')
    eq(done.result.raw, 'rust finished it', 'Rust result')
    eq(done.usage.llm_requests, 3, 'Rust added its inference')
    eq(await Deno.readTextFile(`${root}/work/deno.txt`), 'written by deno\n', 'Deno\'s file')
    eq(done.artifacts, paused.record.artifacts, 'Rust keeps the artifact Deno recorded')
    eq(paused.record.artifacts.length, 1, 'Deno recorded deno.txt')
    const req = (await mock.requests())[0]?.body ?? fail('Rust sent no request')
    eq(req.tools.map((t: any) => t.function.name), ['edit_file', 'read_file', 'shell', 'write_file'], 'Rust advertises the saved tools')
    eq(req.messages.find((m: any) => m.role === 'tool')?.content, 'created deno.txt, wrote 16 bytes across 1 line', 'Deno tool result read by Rust')
  } finally {
    await mock.close()
  }
})
