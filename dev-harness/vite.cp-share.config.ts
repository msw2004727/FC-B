// 賽事分享預覽專用（本機截圖，不參與正式 build）：harness 設定＋與正式打包相同的 legacyCssScope（分享選單樣式在 /legacy/ 路徑）。
// 用法：node node_modules/vite/bin/vite.js --config dev-harness/vite.cp-share.config.ts --port <空埠>
import { defineConfig, mergeConfig } from 'vite';
import base from './vite.harness.config';
import { legacyCssScope } from '../scripts/legacy-css-scope.mjs';

export default mergeConfig(base, defineConfig({
  css: { postcss: { plugins: [legacyCssScope()] } },
}));
