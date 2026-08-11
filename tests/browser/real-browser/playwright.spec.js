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

// The two tests below were migrated from tests/runtime.browser.test.ts, which
// needed a real window and could never run under jest's node environment.
// They import browser.mjs with a cache-busting query so each case gets a
// fresh, uninitialized SDK instance independent from the one test.html owns.

test('runtime type inference and openExternalUrl dispatch follow window.BuckyApi', async ({ page }) => {
  const pageErrors = [];

  page.on('pageerror', (error) => {
    pageErrors.push(error.stack || String(error));
  });

  await page.goto(`https://systest.test.buckyos.io/test.html?ts=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
  });

  await page.waitForFunction(() => {
    const node = document.querySelector('#status');
    const state = node?.getAttribute('data-state');
    return state === 'passed' || state === 'failed';
  }, null, { timeout: 30000 });

  const result = await page.evaluate(async () => {
    const sdk = await import('./browser.mjs?case=runtime-inference');

    const inferredWithoutBuckyApi = sdk.getRuntimeType();

    const buckyApiCalls = [];
    window.BuckyApi = {
      openExternalUrl: (url) => {
        buckyApiCalls.push(url);
        return Promise.resolve();
      },
    };
    const inferredWithBuckyApi = sdk.getRuntimeType();
    await sdk.openExternalUrl('https://example.com/via-bucky-api');

    delete window.BuckyApi;
    const windowOpenCalls = [];
    const originalOpen = window.open;
    window.open = (...args) => {
      windowOpenCalls.push(args);
      return null;
    };
    try {
      await sdk.openExternalUrl('https://example.com/via-window-open');
    } finally {
      window.open = originalOpen;
    }

    return { inferredWithoutBuckyApi, inferredWithBuckyApi, buckyApiCalls, windowOpenCalls };
  });

  expect(pageErrors).toEqual([]);
  expect(result.inferredWithoutBuckyApi).toBe('Browser');
  expect(result.inferredWithBuckyApi).toBe('AppRuntime');
  expect(result.buckyApiCalls).toEqual(['https://example.com/via-bucky-api']);
  expect(result.windowOpenCalls).toEqual([
    ['https://example.com/via-window-open', '_blank', 'noopener,noreferrer'],
  ]);
});

test('config-less init derives the zone host, caches it under the v2 key and reuses the cache', async ({ page }) => {
  const pageErrors = [];

  page.on('pageerror', (error) => {
    pageErrors.push(error.stack || String(error));
  });

  await page.goto(`https://systest.test.buckyos.io/test.html?ts=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
  });

  await page.waitForFunction(() => {
    const node = document.querySelector('#status');
    const state = node?.getAttribute('data-state');
    return state === 'passed' || state === 'failed';
  }, null, { timeout: 30000 });

  const derived = await page.evaluate(async () => {
    window.localStorage.removeItem('zone_host_name');
    window.localStorage.removeItem('zone_host_name_v2');

    const sdk = await import('./browser.mjs?case=zone-host-derive');
    await sdk.initBuckyOS('systest');

    return {
      zoneHostName: sdk.getZoneHostName(),
      verifyHubUrl: sdk.getZoneServiceURL('verify-hub'),
      cachedValue: window.localStorage.getItem('zone_host_name_v2'),
      legacyValue: window.localStorage.getItem('zone_host_name'),
    };
  });

  expect(pageErrors).toEqual([]);
  expect(derived.zoneHostName).toBe('test.buckyos.io');
  expect(derived.verifyHubUrl).toBe('/kapi/verify-hub/');
  expect(derived.cachedValue).toBe('test.buckyos.io');
  expect(derived.legacyValue).toBe(null);

  const cached = await page.evaluate(async () => {
    window.localStorage.setItem('zone_host_name_v2', 'cached-zone.buckyos.io');

    const sdk = await import('./browser.mjs?case=zone-host-cached');
    await sdk.initBuckyOS('systest');

    return {
      zoneHostName: sdk.getZoneHostName(),
      cachedValue: window.localStorage.getItem('zone_host_name_v2'),
    };
  });

  expect(cached.zoneHostName).toBe('cached-zone.buckyos.io');
  expect(cached.cachedValue).toBe('cached-zone.buckyos.io');
});
