// The acceptance page of TODO M5 (before/ and after/), against the SDK sources:
//   npx vite --config examples/xllm_site/vite.config.ts          (dev server: /before/, /after/)
//   npx vite build --config examples/xllm_site/vite.config.ts    (→ dist-examples/xllm_site)
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
    outDir: resolve(root, 'dist-examples/xllm_site'),
    emptyOutDir: true,
    minify: false,
    target: 'es2020',
    rollupOptions: {
      input: { before: resolve(__dirname, 'before/index.html'), after: resolve(__dirname, 'after/index.html') },
    },
  },
})
