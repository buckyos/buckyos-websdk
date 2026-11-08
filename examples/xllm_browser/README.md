# xllm in a browser page

A plain page that runs the xllm loop in its own main thread with a runtime it
builds itself (`buckyos/xllm`). It opens without a Zone: the model is a
`ScriptedLlmClient` from `buckyos/xllm/dev`. With `?llm=aicc` the first demo
signs in (`initBuckyOS` + `login`) and uses the page's own AICC session
(`new AiccLlmClient(buckyos.getAiccClient())`); this only works when the page
is served from a Zone.

```bash
npx vite --config examples/xllm_browser/vite.config.ts         # dev server
npx vite build --config examples/xllm_browser/vite.config.ts   # → dist-examples/xllm_browser
pnpm test:xllm:browser                                         # build + real-browser run (no Zone)
```

The real-browser run needs `@playwright/test` resolvable, like the other
real-browser specs; without a local install point `NODE_PATH` at one, e.g.
`NODE_PATH=../buckyos/src/frame/desktop/node_modules`.

What the demos show (`main.ts`):

1. **Build the runtime.** `buildNotesRuntime()` turns three page functions into
   the `demo.notes` scene with `createSiteRuntime`. `CounterRuntime` is the same
   contract written by hand (`AgentRuntime`), for a site with its own dispatcher.
2. **Run the loop.** Events appear in the list as they happen; *Stop the run*
   interrupts it (`run.interrupter().interrupt(...)`).
3. **Export and resume.** A run is exported while a call is still running (the
   page "went away"), imported into a new store and resumed with a new runtime
   of the same scene. `get_selection` and `append_note` are idempotent and run
   again — the note gets the text once, because `append_note` deduplicates by
   `call_id`. `clear_note` is not: the model gets `[unresolved: result unknown]`
   with the text of `describeInterrupted`. A runtime of another scene gets
   `RuntimeMismatch`.
4. **Boundaries.** `group:bash`, `runtime.kind: native`, `provider.base_url`
   and a tool the page did not give are each `Capability` errors; a call to a
   tool outside the run's selection is an error observation the model sees.

With `?auto=1` the page runs every demo and writes `#status[data-state]`
(`passed` / `failed`) and `#result` (JSON), which `tests/browser/xllm/xllm.spec.js`
reads.

What the runtime adds to a list of tools, and where it is in `main.ts`:

| | Rust `AgentRuntime` | here |
| --- | --- | --- |
| identity | `descriptor()`, compared field by field on resume | `scene` → `target: { origin, scene }` |
| bound to a run | `open(ctx, tools_cfg)`; configuration only narrows | tools get `ctx = { run_id, call_id, signal }`; `tools.tools` only picks page tools |
| side-effect ledger | `describe_interrupted`, `Unresolved` for non-idempotent calls | `idempotent`, `describeInterrupted(args, ctx)` |
| environment | `info()` → `{{runtime.*}}` | `RuntimeInfo` from `scene` / `origin` / `hostname`; `{{env.*}}` only from `env` |
