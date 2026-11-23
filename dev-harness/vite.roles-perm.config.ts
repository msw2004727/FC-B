// 權限面板截圖用（只給本機截圖，不參與正式 build）：正式元件＋記憶體假資料，不連 Firestore。
// 用法：node node_modules/vite/bin/vite.js --config dev-harness/vite.roles-perm.config.ts --port <空埠>
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  plugins: [preact()],
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
});
