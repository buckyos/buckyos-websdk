import { rm } from 'node:fs/promises'

const target = process.argv[2]
if (!['all', 'sdk'].includes(target)) {
  throw new Error('usage: node scripts/clean-build.mjs <all|sdk>')
}

await rm(new URL('../dist', import.meta.url), { recursive: true, force: true })
if (target === 'all') {
  await rm(new URL('../cli/dist', import.meta.url), { recursive: true, force: true })
}
