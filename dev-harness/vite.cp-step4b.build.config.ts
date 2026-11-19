// 賽事第 4 步預覽專用：把 harness 打包成靜態檔再截圖（不含主站 index.html 外掛，不連 Firebase）。
// 用法：node node_modules/vite/bin/vite.js build --config dev-harness/vite.cp-step4b.build.config.ts
import { defineConfig, mergeConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import base from './vite.harness.config';
import { legacyCssScope } from '../scripts/legacy-css-scope.mjs';

export default mergeConfig(base, defineConfig({
  base: './',
  css: { postcss: { plugins: [legacyCssScope()] } },
  build: {
    outDir: 'dist-cp-step4b-harness',
    emptyOutDir: true,
    rollupOptions: { input: {
      main: fileURLToPath(new URL('./cp-step4b.html', import.meta.url)),
    } },
  },
}));
