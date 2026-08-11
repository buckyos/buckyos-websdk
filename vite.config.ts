import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    minify: 'terser',
    sourcemap: true,
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
        browser: resolve(__dirname, "src/browser.ts"),
        node: resolve(__dirname, "src/node.ts"),
        provision: resolve(__dirname, "src/provision.ts"),
      },
      name: "buckyos",
      fileName: (format, entryName) => `${entryName}.${format === 'es' ? 'mjs' : 'cjs'}`,
      formats: ["es", "cjs"],
    },
    rollupOptions: {
      // provision is node-only: never bundle node builtins (and keep them out
      // of the browser entries, which must not import them at all)
      external: [/^node:/],
    },
  },
});
