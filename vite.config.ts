import { defineConfig } from "vite";
import { resolve } from "path";
import dts from 'vite-plugin-dts';

export default defineConfig({
  build: {
    minify: 'terser',
    sourcemap: true,
    lib: {
      entry: resolve(__dirname,"src/index.ts"),  // 配置入口文件路径
      name: "buckyos",
      fileName: "buckyos",
      formats: ["es", "umd"], // 打包生成的格式
    },
  },
  plugins: [
    dts({
      insertTypesEntry: true, // 自动生成 types 入口
      rollupTypes: true       // 关键：强力合并成一个 .d.ts 文件
    })
  ]
});