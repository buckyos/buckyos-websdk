// Separate vite config used to bundle browser-side test runners that load
// the SDK source directly. The output goes to `dist-tests/` (NOT `dist/`)
// so it never ends up in the published npm artifact — only the real-browser
// playwright harness consumes it via prepare_real_browser_test.mjs.
//
// Currently this bundles:
//   - tests/browser/real-browser/ndn_types_runner.ts → dist-tests/ndn_types_runner.mjs
//   - tests/browser/real-browser/ndm_client_runner.ts → dist-tests/ndm_client_runner.mjs
// Add additional entries here when new browser-driven test runners need to
// be shipped to the systest dist directory.

import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
    build: {
        outDir: 'dist-tests',
        emptyOutDir: true,
        minify: false,
        sourcemap: true,
        target: 'es2019',
        lib: {
            entry: {
                ndn_types_runner: resolve(
                    __dirname,
                    'tests/browser/real-browser/ndn_types_runner.ts',
                ),
                ndm_client_runner: resolve(
                    __dirname,
                    'tests/browser/real-browser/ndm_client_runner.ts',
                ),
            },
            name: 'buckyos_browser_tests',
            fileName: (format, entryName) =>
                `${entryName}.${format === 'es' ? 'mjs' : 'cjs'}`,
            formats: ['es'],
        },
    },
})
