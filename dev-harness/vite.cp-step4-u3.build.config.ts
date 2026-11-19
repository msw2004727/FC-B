// 指派畫面截圖專用。用法同第 4 步預覽，不在這張派工卡裡執行。
// node node_modules/vite/bin/vite.js build --config dev-harness/vite.cp-step4-u3.build.config.ts
import { defineConfig, mergeConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import base from './vite.harness.config';
import { legacyCssScope } from '../scripts/legacy-css-scope.mjs';

export default mergeConfig(base, defineConfig({
  base: './',
  css: { postcss: { plugins: [legacyCssScope()] } },
  build: {
    outDir: 'dist-cp-step4-u3-harness',
    emptyOutDir: true,
    rollupOptions: { input: {
      main: fileURLToPath(new URL('./cp-step4-u3.html', import.meta.url)),
    } },
  },
}));
