// Real-Zone DV of buckyos notepads/xllm-ts-runtime-todo.md T1-9 and T5-6, run by hand (it calls the real model):
//   npx vite build --config examples/xllm_browser/vite.config.ts && npx vite build --config examples/xllm_site/vite.config.ts   # dist/ is the committed SDK build
//   BUCKYOS_TEST_ADMIN_PASSWORD=… NODE_PATH=../buckyos/src/frame/desktop/node_modules \
//     npx playwright test tests/browser/xllm_zone/ --reporter=line
// The two example pages and the SDK build are served under the systest app's origin (`https://buckyos-systest.<zone>/xllm-dv/`)
// by the browser context's routing, since the app's installed files belong to root: the origin, its SSO session, AICC
// and the DID Object providers are the Zone's.
const { test, expect } = require('@playwright/test')
const fs = require('node:fs')
const path = require('node:path')

const ZONE = process.env.BUCKYOS_TEST_ZONE_HOST || 'test.buckyos.io'
const USER = process.env.BUCKYOS_TEST_ADMIN_USER || 'devtest'
const APP = 'buckyos-systest.buckyos.bns.did'
const SYS = `https://buckyos-systest.${ZONE}`
const REPO = path.resolve(__dirname, '../../..')
const SERVED = { 'examples/': path.join(REPO, 'dist-examples'), 'sdk/': path.join(REPO, 'dist') }
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' }

function password() {
  const file = process.env.BUCKYOS_TEST_ADMIN_PASSWORD_FILE
  return file ? fs.readFileSync(file, 'utf8').trimEnd() : process.env.BUCKYOS_TEST_ADMIN_PASSWORD
}

test.use({ ignoreHTTPSErrors: true, launchOptions: { args: ['--ignore-certificate-errors'] } })
test.describe.configure({ timeout: 600_000 })
test.beforeEach(() => test.skip(!password(), 'set BUCKYOS_TEST_ADMIN_PASSWORD(_FILE) to run the real-Zone DV'))

async function serve(context) {
  await context.route(`${SYS}/xllm-dv/**`, route => {
    const rel = new URL(route.request().url()).pathname.replace(/^\/xllm-dv\//, '')
    const prefix = Object.keys(SERVED).find(p => rel.startsWith(p))
    const file = prefix && path.join(SERVED[prefix], rel.slice(prefix.length))
    if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: `not built: ${rel}` })
    return route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) })
  })
}

async function signIn(page, form) {
  await form.getByLabel('Username', { exact: true }).fill(USER)
  await form.getByLabel('Password', { exact: true }).fill(password())
  await form.getByRole('button', { name: 'Sign In', exact: true }).click()
}

/** devtest on the Zone host, then on the systest app's origin through its own SSO. */
async function login(page) {
  await page.goto(`https://${ZONE}/`)
  await signIn(page, page)
  await expect(page.getByTestId('desktop-app-aiworkspace')).toBeVisible({ timeout: 30_000 })
  await page.goto(`${SYS}/`)
  await page.locator('#btn-login').click()
  await expect(page.getByLabel('Username', { exact: true })).toBeVisible({ timeout: 20_000 })
  await signIn(page, page)
  await page.waitForURL(u => u.host === new URL(SYS).host, { timeout: 30_000 })
  await expect.poll(async () => (await page.context().cookies(SYS)).some(c => c.name === 'buckyos_session_token'), { timeout: 20_000 }).toBe(true)
}

async function settled(page) {
  await page.waitForFunction(() => ['passed', 'failed'].includes(document.querySelector('#status')?.getAttribute('data-state') ?? '')
    && document.querySelector('#status')?.textContent !== 'running', null, { timeout: 300_000 })
  return JSON.parse((await page.locator('#result').textContent()) || '{}')
}

/** AICC usage events of a run, read with the page's own session (as the systest xllm self-test does). */
async function usageOf(page, runId, since) {
  const token = (await page.context().cookies(SYS)).find(c => c.name === 'buckyos_session_token').value
  for (let i = 0; i < 20; i++) {
    const body = await page.evaluate(async ({ token, since }) => {
      const r = await fetch('/kapi/aicc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        method: 'usage.query', sys: [1, token],
        params: { time_range: { kind: 'explicit', start_time_ms: since, end_time_ms: Date.now() + 1000 }, output_mode: 'events', limit: 200 } }) })
      return r.json()
    }, { token, since })
    if (body.error) throw new Error(`usage.query: ${body.error}`)
    const events = (body.result.events ?? []).filter(e => e.trace_id === runId)
    if (events.length) return events
    await page.waitForTimeout(500)
  }
  return []
}

function expectAttributed(events) {
  expect(events.length).toBeGreaterThan(0)
  for (const e of events) {
    expect(e.user_id, JSON.stringify(e)).toBe(USER)
    expect(e.caller_app_id, JSON.stringify(e)).toBe(APP)
    expect(e.attribution, JSON.stringify(e)).toMatchObject({ app_id: APP, user_id: USER, caller: `app:${APP}@${USER}` })
  }
}

test('T1-9: the example page runs, stops and resumes a run with the page\'s AICC session', async ({ page, context }, info) => {
  await serve(context)
  await login(page)
  const since = Date.now()
  await page.goto(`${SYS}/xllm-dv/examples/xllm_browser/index.html?llm=aicc&appid=${APP}`)
  await expect(page.locator('#status')).toHaveText('ready')
  await page.locator('#demo-run').click()
  await expect(page.locator('#events')).toContainText('tool_finished', { timeout: 120_000 })
  await page.locator('#stop').click()
  const first = await settled(page)
  expect(first.passed, JSON.stringify(first, null, 2)).toBe(true)
  const stopped = JSON.parse(first.results[0].detail)
  expect(stopped.status, 'the run finished before Stop').toBe('interrupted')

  await page.locator('#demo-continue').click()
  const second = await settled(page)
  expect(second.passed, JSON.stringify(second, null, 2)).toBe(true)
  const done = JSON.parse(second.results[0].detail)
  expect(done).toMatchObject({ run_id: stopped.run_id, status: 'completed' })
  expect(done.usage.llm_requests).toBeGreaterThan(stopped.usage.llm_requests)

  const events = await usageOf(page, stopped.run_id, since)
  expectAttributed(events)
  const record = { stopped, done, usage_events: events.map(e => ({ trace_id: e.trace_id, user_id: e.user_id, caller_app_id: e.caller_app_id, attribution: e.attribution, model: e.model ?? e.exact_model })) }
  await info.attach('t1-9.json', { body: JSON.stringify(record, null, 2), contentType: 'application/json' })
  console.log(JSON.stringify(record, null, 2))
})

const ASK = 'Read my work notes. Add the line "status: on track" to the end of the release plan. '
  + 'Export the work notes with the notes-export command. Then delete the Groceries note.'
const HUMAN = 'freeze on Friday (moved to Monday by a person)'

test('T5-6: the agent works the acceptance page with the real model while a person edits a note mid-run', async ({ page, context }, info) => {
  await serve(context)
  await login(page)
  const since = Date.now()
  await page.goto(`${SYS}/xllm-dv/examples/xllm_site/after/index.html?llm=aicc&appid=${APP}`)
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready')
  await page.evaluate(() => new Promise(r => { const q = indexedDB.deleteDatabase('xllm-site-demo'); q.onsuccess = q.onerror = q.onblocked = () => r(null) }))
  await page.reload()
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready')
  await page.locator('#ask').fill(ASK)
  await page.locator('#run').click()
  // a person edits the release plan while the agent is still discovering
  await expect(page.locator('#events')).toContainText('← read', { timeout: 120_000 })
  await page.locator('#list li', { hasText: 'Release plan' }).click()
  await page.locator('#body').fill(HUMAN)
  await page.locator('#save').click()
  await expect(page.locator('#result')).not.toBeEmpty({ timeout: 300_000 })
  const result = (await page.locator('#result').textContent()) ?? ''
  expect(result.split('\n')[0], result).toBe('completed')

  const events = (await page.locator('#events li').allTextContents())
  const tools = events.filter(t => t.startsWith('→ ')).map(t => t.slice(2))
  const failed = events.filter(t => t.startsWith('← ') && t.endsWith(' failed'))
  const { record, snapshot } = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const q = indexedDB.open('xllm-site-demo'); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error) })
    const get = (store, key) => new Promise((resolve, reject) => {
      const q = key === undefined ? db.transaction(store).objectStore(store).getAll() : db.transaction(store).objectStore(store).get(key)
      q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error)
    })
    const record = (await get('records'))[0]
    return { record, snapshot: await get('snapshots', [record.run_id, record.latest_snapshot_idx]) }
  })
  const seen = JSON.stringify(snapshot ?? record)
  // the agent read the person's edit, and its own edit kept it
  expect(seen).toContain('moved to Monday by a person')
  await page.locator('#list li', { hasText: 'Release plan' }).click()
  const body = await page.locator('#body').inputValue()
  expect(body).toContain('moved to Monday by a person')
  expect(body).toContain('status: on track')
  await expect(page.locator('#list li', { hasText: 'Groceries' })).toHaveCount(0)
  for (const t of ['read', 'exec']) expect(tools, tools.join(', ')).toContain(t)
  expect(tools.some(t => t === 'edit' || t === 'write'), tools.join(', ')).toBe(true)
  expectAttributed(await usageOf(page, record.run_id, since))

  // a provider object of this Zone through didObjectResources, read-only, with the page's session
  const objects = await page.evaluate(async (zone) => {
    const { DIDObjectClient, didObjectResources, siteTools } = await import('/xllm-dv/sdk/xllm.mjs')
    const client = new DIDObjectClient({ origin: location.origin, currentZone: zone })
    const out = {}
    for (const root of ['obj://homestation/home/~zone', 'obj://browsy.test.buckyos.io/']) {
      try {
        const tools = siteTools({ resources: await didObjectResources({ client, roots: [root] }) })
        const ctx = { run_id: 'dv', call_id: `dv-${Math.random()}`, signal: new AbortController().signal }
        out[root] = { index: await tools.read.call({ uri: '/' }, ctx), object: await tools.read.call({ uri: root }, ctx) }
      } catch (e) {
        out[root] = { error: `${e.name}: ${e.message}` }
      }
    }
    return out
  }, ZONE)

  const calls = new Map()
  const walk = v => {
    if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') {
      if (v.type === 'tool_use') calls.set(v.call_id, `${v.name} ${JSON.stringify(v.args)}`)
      Object.values(v).forEach(walk)
    }
  }
  walk(snapshot)
  const report = {
    run: { run_id: record.run_id, status: record.status, usage: record.usage, result: record.result?.raw },
    llm_requests: record.usage.llm_requests, calls: [...calls.values()], failed_tools: failed, objects,
  }
  await info.attach('t5-6.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' })
  console.log(JSON.stringify(report, null, 2))
})
