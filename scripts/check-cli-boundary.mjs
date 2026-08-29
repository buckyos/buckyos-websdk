import { readdir, readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

const roots = ['cli/main.ts', 'cli/core', 'cli/modules']
const forbidden = [
  { pattern: /\bDeno\s*\./, label: 'Deno.*' },
  { pattern: /from\s+['"]node:/, label: 'node:* import' },
  { pattern: /\bprocess\s*\./, label: 'process.*' },
]
const files = []
for (const root of roots) await collect(root)
const violations = []
for (const file of files) {
  const source = await readFile(file, 'utf8')
  for (const rule of forbidden) {
    if (rule.pattern.test(source)) violations.push(`${file}: forbidden ${rule.label}`)
  }
}
if (violations.length) {
  console.error(violations.join('\n'))
  process.exitCode = 1
}

async function collect(path) {
  if (extname(path)) {
    files.push(path)
    return
  }
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) await collect(child)
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(child)
  }
}
