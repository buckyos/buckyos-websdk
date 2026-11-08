// Serve or build the example against the SDK sources:
//   npx vite --config examples/xllm_browser/vite.config.ts          (dev server)
//   npx vite build --config examples/xllm_browser/vite.config.ts    (→ dist-examples/xllm_browser)
import { defineConfig } from 'vite'
import { resolve } from 'path'

const root = resolve(__dirname, '../..')

export default defineConfig({
  root: __dirname,
  base: './',
  resolve: {
    alias: [
      { find: /^buckyos\/xllm\/dev$/, replacement: resolve(root, 'src/xllm/dev.ts') },
      { find: /^buckyos\/xllm$/, replacement: resolve(root, 'src/xllm/index.ts') },
      { find: /^buckyos\/browser$/, replacement: resolve(root, 'src/browser.ts') },
    ],
  },
  build: {
    outDir: resolve(root, 'dist-examples/xllm_browser'),
    emptyOutDir: true,
    minify: false,
    target: 'es2020',
  },
})
