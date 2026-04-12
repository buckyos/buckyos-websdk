// Real-browser regression for the ndm_client module.
//
// Loads the standalone ndm_client.html page (served by systest from
// /opt/buckyos/bin/buckyos_systest/dist/ndm_client.html) and asserts that the
// shared ndm_client_cases test suite passes inside a real Chromium tab.
// The HTML/runner bundle is produced + copied by
// `tests/scripts/prepare_real_browser_test.mjs`.

const { test, expect } = require('@playwright/test');

test.use({ ignoreHTTPSErrors: true });

test('ndm_client shared cases pass in a real browser', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => {
        pageErrors.push(error.stack || String(error));
    });

    const testUrl = `https://systest.test.buckyos.io/ndm_client.html?ts=${Date.now()}`;
    await page.goto(testUrl, { waitUntil: 'domcontentloaded' });

    // ndm_client cases are async, allow extra time
    await page.waitForFunction(() => {
        const node = document.querySelector('#status');
        const state = node?.getAttribute('data-state');
        return state === 'passed' || state === 'failed';
    }, null, { timeout: 60000 });

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
