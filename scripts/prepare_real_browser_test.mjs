import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const distDir = join(repoRoot, 'dist');
const htmlSource = join(repoRoot, 'tests', 'browser', 'real-browser', 'test.html');
const buckyosRoot = process.env.BUCKYOS_ROOT?.trim() || '/opt/buckyos';
const systestDistDir = join(buckyosRoot, 'bin', 'buckyos_systest', 'dist');

const importPattern = /from\s+['"](\.\/[^'"]+\.(?:mjs|js))['"]/g;

async function copyRuntimeBundle(entryFile) {
  const pending = [entryFile];
  const visited = new Set();

  while (pending.length > 0) {
    const relativePath = pending.pop();
    if (!relativePath || visited.has(relativePath)) {
      continue;
    }

    visited.add(relativePath);
    const sourcePath = join(distDir, relativePath);
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

async function main() {
  await mkdir(systestDistDir, { recursive: true });
  await copyFile(htmlSource, join(systestDistDir, 'test.html'));
  const copiedBundleFiles = await copyRuntimeBundle('browser.mjs');

  console.log(JSON.stringify({
    buckyosRoot,
    systestDistDir,
    copiedBundleFiles,
    htmlTarget: join(systestDistDir, 'test.html'),
  }, null, 2));
}

await main();
