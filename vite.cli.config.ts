import { defineConfig } from 'vite'
import { builtinModules } from 'node:module'
import { resolve } from 'node:path'

const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)])

export default defineConfig({
  build: {
    target: 'node22.13',
    minify: false,
    sourcemap: true,
    outDir: 'cli/dist',
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'cli/runtime/node_entry.ts'),
      formats: ['es'],
      fileName: () => 'cli.mjs',
    },
    rollupOptions: {
      external: (id) => id === 'buckyos/node' || builtins.has(id) || id.startsWith('node:'),
    },
  },
})
