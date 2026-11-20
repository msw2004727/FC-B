// 賽事第 4 步 K11 邀請記分員、K12 管理員下架與檢舉：截圖 harness 打包（不含主站 index.html 外掛，不連 Firebase）。
// 用法：node node_modules/vite/bin/vite.js build --config dev-harness/vite.cp-k1112.build.config.ts
import { defineConfig, mergeConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import base from './vite.harness.config';
import { legacyCssScope } from '../scripts/legacy-css-scope.mjs';

export default mergeConfig(base, defineConfig({
  base: './',
  css: { postcss: { plugins: [legacyCssScope()] } },
  build: {
    outDir: 'dist-cp-k1112-harness',
    emptyOutDir: true,
    rollupOptions: { input: {
      main: fileURLToPath(new URL('./cp-k1112.html', import.meta.url)),
    } },
  },
}));
