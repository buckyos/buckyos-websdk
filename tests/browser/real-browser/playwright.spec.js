const { test, expect } = require('@playwright/test');

test.use({ ignoreHTTPSErrors: true });

test('browser runtime works from a real browser page served by systest', async ({ page }) => {
  const pageErrors = [];
  const testUrl = `https://systest.test.buckyos.io/test.html?ts=${Date.now()}`;

  page.on('pageerror', (error) => {
    pageErrors.push(error.stack || String(error));
  });

  await page.goto(testUrl, {
    waitUntil: 'domcontentloaded',
  });

  await page.waitForFunction(() => {
    const node = document.querySelector('#status');
    return node?.getAttribute('data-state') === 'passed' || node?.getAttribute('data-state') === 'failed';
  }, null, { timeout: 30000 });

  const state = await page.locator('#status').getAttribute('data-state');
  const rawResult = (await page.locator('#result').textContent()) || '';
  let result;

  try {
    result = JSON.parse(rawResult);
  } catch {
    result = { rawResult };
  }

  expect(pageErrors, rawResult).toEqual([]);
  expect(state, JSON.stringify(result, null, 2)).toBe('passed');
  expect(result.origin).toBe('https://systest.test.buckyos.io');
  expect(result.runtimeType).toBe('Browser');
  expect(result.zoneHostName).toBe('test.buckyos.io');
  expect(result.verifyHubUrl).toBe('/kapi/verify-hub/');
  expect(result.loginButtonEnabled).toBe(true);
  expect(result.currentAccountInfo).toBe(null);
  expect(result.cookie).toBe('');

  const loginRequestPromise = page.waitForRequest((request) => {
    return request.isNavigationRequest() && request.url().startsWith('https://sys.test.buckyos.io/login');
  });

  await page.click('#login-button');

  const loginRequest = await loginRequestPromise;
  const assignedLocation = loginRequest.url();
  const assignedUrl = new URL(assignedLocation);

  expect(assignedUrl.origin).toBe('https://sys.test.buckyos.io');
  expect(assignedUrl.pathname).toBe('/login');

  expect(result.ssoLoginUrl).toBe(assignedLocation);
});
