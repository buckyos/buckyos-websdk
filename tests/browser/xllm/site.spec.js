// The M5 acceptance page (examples/xllm_site/after) in a real browser, no Zone:
// the four points of TODO M5 with a scripted model, and a run that survives a
// reload of the page (IndexedDbRunStore + Web Locks).
//   npx vite build --config examples/xllm_site/vite.config.ts && npx playwright test tests/browser/xllm/
const { test, expect } = require('@playwright/test')
const path = require('node:path')
const { serve } = require('./serve')

let server

test.beforeAll(async () => {
  server = await serve(path.resolve(__dirname, '../../../dist-examples/xllm_site'), 'npx vite build --config examples/xllm_site/vite.config.ts')
})

test.afterAll(async () => {
  await server.close()
})

async function settled(page, states = ['passed', 'failed']) {
  await page.waitForFunction(s => s.includes(document.querySelector('#status')?.getAttribute('data-state')), states, { timeout: 30000 })
  return page.locator('#status').getAttribute('data-state')
}

test('the agent works the page through its declared resources (M5 acceptance)', async ({ page }) => {
  const errors = []
  page.on('pageerror', e => errors.push(e.stack || String(e)))
  await page.goto(`${server.base}/after/?auto=accept`)
  const state = await settled(page)
  const result = JSON.parse((await page.locator('#result').textContent()) || '{}')
  expect(errors, errors.join('\n')).toEqual([])
  expect(state, JSON.stringify(result, null, 2)).toBe('passed')
  expect(result.lines).toHaveLength(4)
})

test('a run left by a reload resumes from IndexedDB', async ({ page }) => {
  await page.goto(`${server.base}/after/?auto=reload`)
  expect(await settled(page, ['reload-me', 'failed'])).toBe('reload-me')
  await page.reload()
  const state = await settled(page)
  const result = JSON.parse((await page.locator('#result').textContent()) || '{}')
  expect(state, JSON.stringify(result)).toBe('passed')
  expect(result.llm_requests).toBe(1)
})

test('the page before the change still works on its own', async ({ page }) => {
  await page.goto(`${server.base}/before/`)
  await page.locator('#list li[data-id="2"]').click()
  await expect(page.locator('#title')).toHaveText('Release plan')
})
