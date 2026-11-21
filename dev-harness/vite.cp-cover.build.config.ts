// 賽事封面圖預覽專用：把 harness 打包成靜態檔再截圖（與正式相同的 vite／preact 打包，不含主站 index.html 外掛、不連 Firebase）。
// 用法：node node_modules/vite/bin/vite.js build --config dev-harness/vite.cp-cover.build.config.ts
//       node node_modules/vite/bin/vite.js preview --config dev-harness/vite.cp-cover.build.config.ts --port 5297
import { defineConfig, mergeConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import base from './vite.harness.config';
import { legacyCssScope } from '../scripts/legacy-css-scope.mjs';

export default mergeConfig(base, defineConfig({
  base: './',
  css: { postcss: { plugins: [legacyCssScope()] } },
  build: {
    outDir: 'dist-cp-cover-harness',
    emptyOutDir: true,
    rollupOptions: { input: fileURLToPath(new URL('./cp-cover.html', import.meta.url)) },
  },
}));
