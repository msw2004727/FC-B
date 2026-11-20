// 賽事清單頁示範頁（新外觀清-6）專用的 vite 開發伺服器設定：只給本機截圖，不參與正式 build、不連 Firebase。
// 畫的是正式的 TournamentsPage（含動態載入的站內區塊）；只有 TournamentsPage 匯入的外部賽事讀寫、登入者、上次登入帳號
// 三個模組換成 src/dev/cp-list-fakes 的假模組；站內區塊走 CpEnvProvider 注入的記憶體假資料。
// 與正式打包相同掛 legacyCssScope（舊站樣式限定 .legacy-ui；不掛的話深色清單頁底色是假的，見 實量覆核.md 第 6 節）。
// 用法：node node_modules/vite/bin/vite.js --config dev-harness/vite.cp-list.config.ts --port <空埠> --strictPort
import { defineConfig, mergeConfig, normalizePath, type Plugin } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import base from './vite.harness.config';
import { legacyCssScope } from '../scripts/legacy-css-scope.mjs';

const fake = (name: string) => fileURLToPath(new URL(`../src/dev/cp-list-fakes/${name}.ts`, import.meta.url));
// 比對的是匯入字串的結尾：@ 別名在這個外掛之前就被換成絕對路徑。
const SWAP: ReadonlyArray<readonly [string, string]> = [
  ['/data/cards-repo', fake('cards-repo')],
  ['/features/profile/data/viewer', fake('viewer')],
  ['/data/auth', fake('auth')],
];

function cplFakes(): Plugin {
  return {
    name: 'cp-list-fakes',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !normalizePath(importer).endsWith('/features/tournaments/pages/TournamentsPage.tsx')) return null;
      const target = normalizePath(source).replace(/\.tsx?$/, '');
      return SWAP.find(([tail]) => target.endsWith(tail))?.[1] ?? null;
    },
  };
}

export default mergeConfig(base, defineConfig({
  plugins: [cplFakes()],
  css: { postcss: { plugins: [legacyCssScope()] } },
}));
