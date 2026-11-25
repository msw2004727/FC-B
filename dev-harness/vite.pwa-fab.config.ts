// 加到主畫面浮球截圖台（只給本機截圖，不參與正式 build）。A 樣式照正式打包限定到 .legacy-ui。
// 用法：node node_modules/vite/bin/vite.js --config dev-harness/vite.pwa-fab.config.ts --port <空埠>
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { fileURLToPath, URL } from 'node:url';
import { legacyCssScope } from '../scripts/legacy-css-scope.mjs';

export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  plugins: [preact()],
  css: { postcss: { plugins: [legacyCssScope()] } },
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
});
