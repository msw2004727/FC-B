// 網頁推播 W5 截圖台（只給本機截圖，不參與正式 build）：A 樣式照正式打包限定到 .legacy-ui，QA 判斷與 LINE 好友狀態換成假模組。
// 用法：node node_modules/vite/bin/vite.js --config dev-harness/vite.webpush-w5.config.ts --port <空埠>
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { fileURLToPath, URL } from 'node:url';
import { legacyCssScope } from '../scripts/legacy-css-scope.mjs';

const QA_FAKE = fileURLToPath(new URL('../src/dev/webpush-w5-qa-fake.ts', import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  plugins: [
    {
      name: 'webpush-w5-qa-fake',
      enforce: 'pre',
      resolveId(source) {
        const s = source.split(String.fromCharCode(92)).join('/');
        if (/(^@|\/src)\/features\/qa-login\/data\/qa-session(\.ts)?$/.test(s)) return QA_FAKE;
        if (/\/data\/line-friendship(\.ts)?$/.test(s)) return QA_FAKE;
        return null;
      },
    },
    preact(),
  ],
  css: { postcss: { plugins: [legacyCssScope()] } },
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
});
