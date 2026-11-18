// 賽事第 3 步預覽專用：把 harness 打包成靜態檔再截圖（不含主站 index.html 外掛，不連 Firebase）。
// 用法：node node_modules/vite/bin/vite.js build --config dev-harness/vite.cp-step3.build.config.ts
import { defineConfig, mergeConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import base from './vite.harness.config';

export default mergeConfig(base, defineConfig({
  base: './',
  build: {
    outDir: 'dist-cp-step3-harness',
    emptyOutDir: true,
    rollupOptions: { input: fileURLToPath(new URL('./cp-step3.html', import.meta.url)) },
  },
}));
