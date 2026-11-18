// 賽事第 2 步預覽專用：把 harness 打包成靜態檔再截圖（與正式相同的 vite／preact 打包，不含主站 index.html 外掛）。
// 用法：node node_modules/vite/bin/vite.js build --config dev-harness/vite.cp-step2.build.config.ts
import { defineConfig, mergeConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import base from './vite.harness.config';

export default mergeConfig(base, defineConfig({
  base: './',
  build: {
    outDir: 'dist-cp-step2-harness',
    emptyOutDir: true,
    rollupOptions: { input: fileURLToPath(new URL('./cp-step2.html', import.meta.url)) },
  },
}));
