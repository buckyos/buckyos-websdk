import { cp, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const root = new URL('../', import.meta.url)
const out = new URL('dist/owner-extensions/', root)
await mkdir(out, { recursive: true })
await cp(new URL('owner-extensions/', root), out, { recursive: true })
for (const [entry, name] of [['src/owner_schedule.ts', 'schedule'], ['scripts/free_busy.ts', 'free_busy']]) {
  await build({
    configFile: false,
    build: {
      target: 'es2022', emptyOutDir: false, outDir: fileURLToPath(new URL('scripts/', out)),
      minify: false, lib: { entry: fileURLToPath(new URL(entry, root)), formats: ['es'], fileName: () => name + '.mjs' },
    },
  })
}
