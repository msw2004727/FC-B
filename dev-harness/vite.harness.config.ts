// 元件 harness 專用的 vite 設定（只給本機截圖，不參與正式 build）：只有 preact 與 @ 別名，
// 不掛主站的 index.html 外掛（提早請求正式 Firestore 的內嵌 script 等）。
// 用法：node node_modules/vite/bin/vite.js --config dev-harness/vite.harness.config.ts --port 5191
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  plugins: [preact()],
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
});
