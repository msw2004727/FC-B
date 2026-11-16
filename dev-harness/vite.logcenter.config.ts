// 日誌中心 harness 專用 vite 設定：比照正式打包套用 legacy CSS 範圍外掛（.legacy-ui 內的舊站通用樣式優先度與正式站相同），
// 避免「harness 截圖正常、正式站跑版」（2026-11-17 站長回報日期列被 select 撐開）。只給本機截圖，不參與正式 build。
// 用法：node node_modules/vite/bin/vite.js --config dev-harness/vite.logcenter.config.ts --port 5193
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
