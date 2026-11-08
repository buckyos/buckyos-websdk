// Real-browser run of the xllm example page (examples/xllm_browser), no Zone:
// the page builds its own runtime, runs the loop with a scripted model,
// resumes an exported run and checks the boundaries (T1-6 / T1-8).
//   npx vite build --config examples/xllm_browser/vite.config.ts
//   npx playwright test tests/browser/xllm/
const { test, expect } = require('@playwright/test')
const path = require('node:path')
const { serve } = require('./serve')

let server

test.beforeAll(async () => {
  server = await serve(path.resolve(__dirname, '../../../dist-examples/xllm_browser'), 'npx vite build --config examples/xllm_browser/vite.config.ts')
})

test.afterAll(async () => {
  await server.close()
})

test('the xllm example page passes all demos in a real browser', async ({ page }) => {
  const errors = []
  page.on('pageerror', e => errors.push(e.stack || String(e)))
  await page.goto(`${server.base}/index.html?auto=1`)
  await page.waitForFunction(() => {
    const s = document.querySelector('#status')?.getAttribute('data-state')
    return s === 'passed' || s === 'failed'
  }, null, { timeout: 30000 })
  const result = JSON.parse((await page.locator('#result').textContent()) || '{}')
  const failed = (result.results || []).filter(r => !r.ok).map(r => `${r.name}: ${r.detail}`)
  expect(errors, errors.join('\n')).toEqual([])
  expect(failed, failed.join('\n\n')).toEqual([])
  expect(await page.locator('#status').getAttribute('data-state')).toBe('passed')
  expect(result.results.map(r => r.name)).toEqual(['run', 'resume', 'boundaries', 'custom_runtime'])
})
