// 活動區間統計彈窗截圖用（只給本機截圖，不參與正式 build）：把讀取層換成記憶體假資料，不連 Firestore。
// 用法：node node_modules/vite/bin/vite.js --config dev-harness/vite.range-stats.config.ts --port <空埠>
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { fileURLToPath, URL } from 'node:url';

const FAKE = fileURLToPath(new URL('../src/dev/range-stats-fakes.ts', import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  plugins: [
    {
      name: 'range-stats-fake-data',
      enforce: 'pre',
      resolveId(source, importer) {
        if (source === '../../data/range-stats' && importer?.split(String.fromCharCode(92)).join('/').endsWith('/RangeStatsModal.tsx')) return FAKE;
        return null;
      },
    },
    preact(),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
});
