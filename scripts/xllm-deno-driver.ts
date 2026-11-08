// The Deno host as a command, for scripts/test-xllm-conformance.mjs (not a
// product CLI — PRD's `xllm` is Rust's `agent_tool xllm`). Prints one JSON
// line { run_id, status }.
//
//   deno run -A scripts/xllm-deno-driver.ts run --workdir <dir> --runs-dir <dir> --user <text> [--no-tools]
//   deno run -A scripts/xllm-deno-driver.ts resume --runs-dir <dir> --run <id>
// `run` reads <workdir>/.llm_context as the JSON configuration. Needs `pnpm build`.

import * as x from '../dist/xllm.mjs'
import * as host from '../dist/xllm_deno.mjs'

const [cmd, ...rest] = Deno.args
const opt = (name: string) => {
  const i = rest.indexOf(`--${name}`)
  return i >= 0 ? rest[i + 1] : undefined
}
const need = (name: string) => opt(name) ?? (() => {
  console.error(`missing --${name}`)
  Deno.exit(2)
})()

const store = new host.FileRunStore(need('runs-dir'))
if (cmd === 'run') {
  const workdir = need('workdir')
  const origin = `${workdir}/.llm_context`
  const config = JSON.parse(await Deno.readTextFile(origin))
  const overrides = rest.includes('--no-tools') ? { tools: false } : {}
  const { task, deps } = await host.prepareNativeTask(config, origin, { user: need('user') }, overrides, { store, workdir })
  const run = await x.XllmRun.start(task, deps)
  const out = await run.execute()
  console.log(JSON.stringify({ run_id: run.runId, status: out.status }))
} else if (cmd === 'resume') {
  const start = await host.resumeNativeRun(store, need('run'))
  const out = start.kind === 'run' ? await start.run.execute() : { status: start.record.status }
  console.log(JSON.stringify({ run_id: need('run'), status: out.status }))
} else {
  console.error('usage: xllm-deno-driver.ts run|resume …')
  Deno.exit(2)
}
