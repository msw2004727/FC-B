#!/usr/bin/env node
// 驗證 emulator/firestore.rules 與 emulator/RULES_SOURCE.json 記錄的 sha256 一致。
// 若不一致（代表有人手改了副本），exit 1。
//
// 只用 Node 內建模組。

import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const rulesPath = resolve(repoRoot, 'emulator', 'firestore.rules');
const metaPath = resolve(repoRoot, 'emulator', 'RULES_SOURCE.json');

if (!existsSync(rulesPath)) {
  console.error('[check-rules-sync] 缺少 emulator/firestore.rules，請先執行 npm run sync:rules');
  process.exit(1);
}
if (!existsSync(metaPath)) {
  console.error('[check-rules-sync] 缺少 emulator/RULES_SOURCE.json，請先執行 npm run sync:rules');
  process.exit(1);
}

let meta;
try {
  meta = JSON.parse(readFileSync(metaPath, 'utf8'));
} catch (err) {
  console.error('[check-rules-sync] RULES_SOURCE.json 解析失敗', err);
  process.exit(1);
}

if (!meta || typeof meta.sha256 !== 'string' || meta.sha256.length === 0) {
  console.error('[check-rules-sync] RULES_SOURCE.json 缺少有效 sha256');
  process.exit(1);
}

const actual = createHash('sha256').update(readFileSync(rulesPath)).digest('hex');
if (actual !== meta.sha256) {
  console.error('[check-rules-sync] emulator/firestore.rules 與記錄不一致（副本疑被手改）');
  console.error(`[check-rules-sync]   expected: ${meta.sha256}`);
  console.error(`[check-rules-sync]   actual:   ${actual}`);
  process.exit(1);
}

console.log('[check-rules-sync] OK');
