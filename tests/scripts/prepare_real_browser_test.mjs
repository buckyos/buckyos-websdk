import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..', '..');
const distDir = join(repoRoot, 'dist');
const distTestsDir = join(repoRoot, 'dist-tests');
const realBrowserDir = join(repoRoot, 'tests', 'browser', 'real-browser');
const buckyosRoot = process.env.BUCKYOS_ROOT?.trim() || '/opt/buckyos';
const systestDistDir = join(buckyosRoot, 'bin', 'buckyos_systest', 'dist');

const importPattern = /from\s+['"](\.\/[^'"]+\.(?:mjs|js))['"]/g;

async function copyRuntimeBundle(sourceDir, entryFile) {
  const pending = [entryFile];
  const visited = new Set();

  while (pending.length > 0) {
    const relativePath = pending.pop();
    if (!relativePath || visited.has(relativePath)) {
      continue;
    }

    visited.add(relativePath);
    const sourcePath = join(sourceDir, relativePath);
    const targetPath = join(systestDistDir, relativePath);
    const sourceText = await readFile(sourcePath, 'utf8');

    await mkdir(dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);

    let match;
    while ((match = importPattern.exec(sourceText)) !== null) {
      pending.push(match[1].slice(2));
    }
    importPattern.lastIndex = 0;
  }

  return [...visited].sort();
}

function runViteBuild(configPath) {
  const result = spawnSync(
    'npx',
    ['vite', 'build', '--config', configPath],
    { cwd: repoRoot, stdio: 'inherit' },
  );
  if (result.status !== 0) {
    throw new Error(`vite build (${configPath}) failed with status ${result.status}`);
  }
}

async function main() {
  await mkdir(systestDistDir, { recursive: true });

  // 1) Existing main browser SDK page (test.html + dist/browser.mjs).
  await copyFile(
    join(realBrowserDir, 'test.html'),
    join(systestDistDir, 'test.html'),
  );
  const copiedBundleFiles = await copyRuntimeBundle(distDir, 'browser.mjs');

  // 2) New ndn_types browser test page. The runner is bundled separately
  // (`vite.test-browser.config.ts`) so it can transitively pull in the
  // ndn_types module + jssha + the shared cases without polluting dist/.
  runViteBuild(join(repoRoot, 'vite.test-browser.config.ts'));

  await copyFile(
    join(realBrowserDir, 'ndn_types.html'),
    join(systestDistDir, 'ndn_types.html'),
  );
  const copiedNdnTypesBundleFiles = await copyRuntimeBundle(
    distTestsDir,
    'ndn_types_runner.mjs',
  );

  // 3) ndm_client browser test page (shared cases, mock provider).
  // The runner is bundled alongside ndn_types_runner by the same vite config.
  await copyFile(
    join(realBrowserDir, 'ndm_client.html'),
    join(systestDistDir, 'ndm_client.html'),
  );
  const copiedNdmClientBundleFiles = await copyRuntimeBundle(
    distTestsDir,
    'ndm_client_runner.mjs',
  );

  // 4) ndm_client upload integration page (real file picker + TUS upload).
  // This page imports browser.mjs directly (already copied in step 1).
  await copyFile(
    join(realBrowserDir, 'ndm_client_upload.html'),
    join(systestDistDir, 'ndm_client_upload.html'),
  );

  console.log(JSON.stringify({
    buckyosRoot,
    systestDistDir,
    copiedBundleFiles,
    copiedNdnTypesBundleFiles,
    copiedNdmClientBundleFiles,
    htmlTargets: [
      join(systestDistDir, 'test.html'),
      join(systestDistDir, 'ndn_types.html'),
      join(systestDistDir, 'ndm_client.html'),
      join(systestDistDir, 'ndm_client_upload.html'),
    ],
  }, null, 2));
}

await main();
