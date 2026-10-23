// End-to-end integration test for ndm_client in a real browser.
//
// Flow: SDK init → login by password → pickupAndImport (real browser file
// picker intercepted by Playwright's fileChooser API) → materialization →
// TUS upload → verify files land in named_store.
//
// Requires:
//   - DV test environment running (test.buckyos.io)
//   - systest dist populated by prepare_real_browser_test.mjs
//   - User: devtest / bucky2025

const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');

test.use({ ignoreHTTPSErrors: true });

// Create a temporary test file for upload
function createTestFile(name, sizeBytes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ndm-test-'));
  const filePath = path.join(dir, name);
  const buf = Buffer.alloc(sizeBytes);
  // Fill with recognizable pattern
  for (let i = 0; i < sizeBytes; i++) buf[i] = i & 0xff;
  fs.writeFileSync(filePath, buf);
  return { filePath, dir };
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch { /* ignore */ }
}

test.describe('ndm_client upload integration', () => {
  test('single file: pick → materialize → upload to named_store', async ({ page }) => {
    test.setTimeout(120000);

    const pageErrors = [];
    page.on('pageerror', (error) => {
      pageErrors.push(error.stack || String(error));
    });

    // Navigate to the upload test page
    const testUrl = `https://systest.test.buckyos.io/ndm_client_upload.html?ts=${Date.now()}`;
    await page.goto(testUrl, { waitUntil: 'domcontentloaded' });

    // Phase 1: Wait for SDK init + login to complete (status = "ready")
    await page.waitForFunction(() => {
      const node = document.querySelector('#status');
      const state = node?.getAttribute('data-state');
      return state === 'ready' || state === 'failed';
    }, null, { timeout: 30000 });

    const initState = await page.locator('#status').getAttribute('data-state');
    if (initState === 'failed') {
      const rawResult = (await page.locator('#result').textContent()) || '';
      throw new Error(`SDK init/login failed: ${rawResult}`);
    }

    expect(initState).toBe('ready');

    // Phase 2: Create a test file and trigger the real browser file picker
    const { filePath, dir } = createTestFile('ndm_test_upload.bin', 1024);

    try {
      // Set up file chooser interception BEFORE clicking the button
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.click('#pick-single-file'),
      ]);

      // Provide the test file to the browser's file picker
      await fileChooser.setFiles(filePath);

      // Phase 3: Wait for the full flow to complete (materialization + upload)
      await page.waitForFunction(() => {
        const node = document.querySelector('#status');
        const state = node?.getAttribute('data-state');
        return state === 'passed' || state === 'failed';
      }, null, { timeout: 90000 });

      const finalState = await page.locator('#status').getAttribute('data-state');
      const rawResult = (await page.locator('#result').textContent()) || '';
      let result;
      try {
        result = JSON.parse(rawResult);
      } catch {
        result = { rawResult };
      }

      // Assert no page errors
      expect(pageErrors, `Page errors: ${JSON.stringify(pageErrors)}`).toEqual([]);

      // Assert test passed
      expect(finalState, JSON.stringify(result, null, 2)).toBe('passed');
      expect(result.ok).toBe(true);
      expect(result.phase).toBe('completed');

      // Verify materialization produced valid objectIds
      expect(result.items.length).toBeGreaterThan(0);
      for (const item of result.items) {
        expect(item.objectId).toBeTruthy();
        expect(item.kind).toBe('file');
        expect(item.name).toBe('ndm_test_upload.bin');
        expect(item.size).toBe(1024);
      }

      // Verify upload completed
      expect(['completed', 'not_required']).toContain(result.uploadStatus);
      expect(result.objectStatus).toBe('ready');
      expect(result.readback.every(item => item.verified)).toBe(true);
      expect(result.progress.uploadedObjects).toBe(result.progress.totalObjects);
      expect(result.progress.uploadedBytes).toBe(result.progress.totalBytes);
    } finally {
      cleanup(dir);
    }
  });

  test('multi file: pick multiple → materialize → upload', async ({ page }) => {
    test.setTimeout(120000);

    const pageErrors = [];
    page.on('pageerror', (error) => {
      pageErrors.push(error.stack || String(error));
    });

    const testUrl = `https://systest.test.buckyos.io/ndm_client_upload.html?ts=${Date.now()}`;
    await page.goto(testUrl, { waitUntil: 'domcontentloaded' });

    await page.waitForFunction(() => {
      const node = document.querySelector('#status');
      const state = node?.getAttribute('data-state');
      return state === 'ready' || state === 'failed';
    }, null, { timeout: 30000 });

    const initState = await page.locator('#status').getAttribute('data-state');
    expect(initState).toBe('ready');

    // Create two test files
    const file1 = createTestFile('ndm_multi_a.bin', 512);
    const file2 = createTestFile('ndm_multi_b.txt', 256);

    try {
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.click('#pick-multi-file'),
      ]);

      // Provide multiple files
      await fileChooser.setFiles([file1.filePath, file2.filePath]);

      await page.waitForFunction(() => {
        const node = document.querySelector('#status');
        const state = node?.getAttribute('data-state');
        return state === 'passed' || state === 'failed';
      }, null, { timeout: 90000 });

      const finalState = await page.locator('#status').getAttribute('data-state');
      const rawResult = (await page.locator('#result').textContent()) || '';
      let result;
      try {
        result = JSON.parse(rawResult);
      } catch {
        result = { rawResult };
      }

      expect(pageErrors, `Page errors: ${JSON.stringify(pageErrors)}`).toEqual([]);
      expect(finalState, JSON.stringify(result, null, 2)).toBe('passed');
      expect(result.ok).toBe(true);

      // Verify both files materialized
      expect(result.items.length).toBe(2);
      const names = result.items.map((i) => i.name).sort();
      expect(names).toEqual(['ndm_multi_a.bin', 'ndm_multi_b.txt']);

      // Verify upload completed
      expect(['completed', 'not_required']).toContain(result.uploadStatus);
      expect(result.objectStatus).toBe('ready');
      expect(result.readback.every(item => item.verified)).toBe(true);
      expect(result.progress.uploadedObjects).toBe(2);
    } finally {
      cleanup(file1.dir);
      cleanup(file2.dir);
    }
  });
});


test.describe('ndm_client directory and ChunkList readback', () => {
  for (const scenario of ['folder', 'large']) {
    test(`${scenario}: finalize and verify all leaf bytes`, async ({ page }) => {
      test.setTimeout(180000);
      const { filePath, dir } = createTestFile('跨块 中文.bin', 33 * 1024 * 1024);
      try {
        if (scenario === 'folder') {
          fs.mkdirSync(path.join(dir, 'nested'));
          fs.renameSync(filePath, path.join(dir, 'nested', '跨块 中文.bin'));
          fs.writeFileSync(path.join(dir, 'empty.bin'), Buffer.alloc(0));
          fs.writeFileSync(path.join(dir, 'same.bin'), Buffer.from([0, 1, 2, 3]));
          fs.writeFileSync(path.join(dir, 'nested', 'same.bin'), Buffer.from([0, 1, 2, 3]));
        }
        await page.goto(`https://systest.test.buckyos.io/ndm_client_upload.html?ts=${Date.now()}`);
        await page.waitForFunction(() => ['ready', 'failed'].includes(document.querySelector('#status')?.dataset.state));
        expect(await page.locator('#status').getAttribute('data-state')).toBe('ready');
        const [chooser] = await Promise.all([
          page.waitForEvent('filechooser'),
          page.click(scenario === 'folder' ? '#pick-folder' : '#pick-single-file'),
        ]);
        await chooser.setFiles(scenario === 'folder' ? dir : filePath);
        await page.waitForFunction(() => ['passed', 'failed'].includes(document.querySelector('#status')?.dataset.state), null, { timeout: 150000 });
        const result = JSON.parse(await page.locator('#result').textContent());
        expect(result.ok, JSON.stringify(result)).toBe(true);
        expect(result.objectStatus).toBe('ready');
        expect(result.readback.every(item => item.verified)).toBe(true);
        expect(result.readback.some(item => item.size > 32 * 1024 * 1024)).toBe(true);
        if (scenario === 'folder') {
          expect(result.items[0].kind).toBe('dir');
          expect(result.items[0].name).toBe(path.basename(dir));
          expect(result.readback).toHaveLength(4);
        }
      } finally { cleanup(dir); }
    });
  }
});
