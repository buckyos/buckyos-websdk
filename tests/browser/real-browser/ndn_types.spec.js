// Real-browser regression for the ndn_types runtime.
//
// Loads the standalone ndn_types.html page (served by systest from
// /opt/buckyos/bin/buckyos_systest/dist/ndn_types.html) and asserts that the
// shared ndn_types_cases test suite passes inside a real Chromium tab.
// The HTML/runner bundle is produced + copied by
// `tests/scripts/prepare_real_browser_test.mjs`.

const { test, expect } = require('@playwright/test');

test.use({ ignoreHTTPSErrors: true });

test('ndn_types shared cases pass in a real browser', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => {
        pageErrors.push(error.stack || String(error));
    });

    const testUrl = `https://systest.test.buckyos.io/ndn_types.html?ts=${Date.now()}`;
    await page.goto(testUrl, { waitUntil: 'domcontentloaded' });

    await page.waitForFunction(() => {
        const node = document.querySelector('#status');
        const state = node?.getAttribute('data-state');
        return state === 'passed' || state === 'failed';
    }, null, { timeout: 30000 });

    const state = await page.locator('#status').getAttribute('data-state');
    const rawResult = (await page.locator('#result').textContent()) || '';
    let result;
    try {
        result = JSON.parse(rawResult);
    } catch {
        result = { rawResult };
    }

    // Surface failed-case names if any so the playwright report is useful.
    const failedNames = Array.isArray(result?.results)
        ? result.results.filter((r) => !r.ok).map((r) => `${r.name}: ${r.error}`)
        : [];

    expect(pageErrors, rawResult).toEqual([]);
    expect(state, JSON.stringify({ failedNames, result }, null, 2)).toBe('passed');
    expect(result.ok).toBe(true);
    expect(result.failed).toBe(0);
    expect(typeof result.total).toBe('number');
    expect(result.total).toBeGreaterThan(0);
});
