// 新外觀第 3 批示範頁打包：cp-step4-u4（觀眾即時頁、射手榜元件）與 cp-p3-public（詳情頁的榜單、我的場次）一起打。
// node node_modules/vite/bin/vite.js build --config dev-harness/vite.cp-p3-public.build.config.ts
// node node_modules/vite/bin/vite.js preview --config dev-harness/vite.cp-p3-public.build.config.ts --port 5297 --strictPort
import { defineConfig, mergeConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import base from './vite.harness.config';
import { legacyCssScope } from '../scripts/legacy-css-scope.mjs';

export default mergeConfig(base, defineConfig({
  base: './',
  css: { postcss: { plugins: [legacyCssScope()] } },
  build: {
    outDir: 'dist-cp-p3-public-harness',
    emptyOutDir: true,
    rollupOptions: { input: {
      u4: fileURLToPath(new URL('./cp-step4-u4.html', import.meta.url)),
      p3: fileURLToPath(new URL('./cp-p3-public.html', import.meta.url)),
    } },
  },
  preview: { host: '127.0.0.1', port: 5297, strictPort: true },
}));
