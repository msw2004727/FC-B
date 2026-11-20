// 賽事第 3 步預覽專用：把 harness 打包成靜態檔再截圖（不含主站 index.html 外掛，不連 Firebase）。
// 用法：node node_modules/vite/bin/vite.js build --config dev-harness/vite.cp-step3.build.config.ts
import { defineConfig, mergeConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import base from './vite.harness.config';
import { legacyCssScope } from '../scripts/legacy-css-scope.mjs';

export default mergeConfig(base, defineConfig({
  base: './',
  // 與正式 build 相同：舊站 A 的 CSS 限定到 .legacy-ui（列表 v2 用正式賽事頁樣式）
  css: { postcss: { plugins: [legacyCssScope()] } },
  build: {
    outDir: 'dist-cp-step3-harness',
    emptyOutDir: true,
    rollupOptions: { input: {
      // 第 3 步手寫預覽（cp-step3／cp-step3-more／cp-step3-rules）總收尾已刪，正式頁面示範取代。
      list: fileURLToPath(new URL('./cp-step3-list.html', import.meta.url)),
      // 正式頁面＋假資料的截圖入口（cp-step3-real.html）
      real: fileURLToPath(new URL('./cp-step3-real.html', import.meta.url)),
    } },
  },
}));
