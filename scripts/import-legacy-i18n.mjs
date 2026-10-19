#!/usr/bin/env node
// 把舊版 A 的翻譯包（FC/js/i18n.js）轉成 FC-B 的 JSON 字典：src/i18n/legacy/<locale>.json。
// 用法：node scripts/import-legacy-i18n.mjs [A repo 路徑，預設 ../FC]
// 背景（2026-10-19）：改版頁面照 A 的 DOM 輸出，文字與 A 一樣用 data-i18n 的 key（中文原文或語意 key）查翻譯，
// 用 A 的翻譯包才能和舊版一字不差。產物是生成檔，不要手改；A 更新翻譯時重跑本腳本。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const aRepo = path.resolve(process.argv[2] || path.join(here, '..', '..', 'FC'));
const source = fs.readFileSync(path.join(aRepo, 'js', 'i18n.js'), 'utf8');

const memory = new Map();
const sandbox = {
  console,
  localStorage: {
    getItem: (k) => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => memory.set(k, String(v)),
    removeItem: (k) => memory.delete(k),
  },
  navigator: { language: 'zh-TW', languages: ['zh-TW'] },
  document: { documentElement: { lang: 'zh-TW', setAttribute() {} } },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(`${source}\n;globalThis.__packs = I18N._packs;`, sandbox, { filename: 'i18n.js' });

const packs = sandbox.__packs;
const outDir = path.join(here, '..', 'src', 'i18n', 'legacy');
fs.mkdirSync(outDir, { recursive: true });
const written = [];
for (const locale of ['zh-TW', 'en', 'ja', 'ko', 'th', 'vi']) {
  const pack = packs[locale];
  if (!pack) throw new Error(`A 沒有 ${locale} 翻譯包`);
  const flat = {};
  for (const [key, value] of Object.entries(pack)) {
    if (key.startsWith('_') || typeof value !== 'string') continue;
    flat[key] = value;
  }
  const sorted = Object.fromEntries(Object.entries(flat).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  fs.writeFileSync(path.join(outDir, `${locale}.json`), `${JSON.stringify(sorted, null, 0)}\n`);
  written.push(`${locale}:${Object.keys(sorted).length}`);
}
console.log(`[legacy-i18n] 來源 ${path.join(aRepo, 'js', 'i18n.js')}`);
console.log(`[legacy-i18n] 輸出 ${written.join(' ')}`);
