// 營運儀表板 W6 截圖台（只給本機截圖，不參與正式 build）：viewer、ops-data、firebase 換成假模組，不登入、不連 Firestore。
// 用法：node node_modules/vite/bin/vite.js --config dev-harness/vite.ops-w6.config.ts --port <空埠>
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { fileURLToPath, URL } from 'node:url';
import { legacyCssScope } from '../scripts/legacy-css-scope.mjs';

const fake = (name: string): string => fileURLToPath(new URL(`../src/dev/ops-w6-${name}-fake.ts`, import.meta.url));
const norm = (p: string): string => p.split(String.fromCharCode(92)).join('/');
// 解析後的實體路徑 → 假模組。假模組自己 import 原模組時不換（否則循環）。
const SWAPS: readonly [RegExp, string][] = [
  [/\/src\/features\/ops-dashboard\/data\/ops-data\.ts$/, fake('data')],
  [/\/src\/features\/profile\/data\/viewer\.ts$/, fake('viewer')],
  [/\/src\/data\/firebase\.ts$/, fake('firebase')],
];

export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  plugins: [
    {
      name: 'ops-w6-fakes',
      enforce: 'pre',
      async resolveId(source, importer, options) {
        if (!importer || /\/src\/dev\/ops-w6-[a-z]+-fake\.ts$/.test(norm(importer))) return null;
        const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
        if (!resolved) return null;
        const id = norm(resolved.id).split('?')[0] ?? '';
        for (const [re, target] of SWAPS) if (re.test(id)) return target;
        return null;
      },
    },
    preact(),
  ],
  css: { postcss: { plugins: [legacyCssScope()] } },
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
});
