#!/usr/bin/env node
// 將 FC repo 的 firestore.rules 同步到 FC-B 的 emulator/firestore.rules。
//
// 用法：
//   node scripts/sync-rules.mjs <FC repo 路徑>
//
// 產出：
//   emulator/firestore.rules       ← 複製自 <FC>/firestore.rules
//   emulator/RULES_SOURCE.json     ← { sha256, copiedAt, fcHead }
//
// 只用 Node 內建模組。

import { existsSync, mkdirSync, readFileSync, copyFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const destDir = resolve(repoRoot, 'emulator');
const destRules = resolve(destDir, 'firestore.rules');
const metaPath = resolve(destDir, 'RULES_SOURCE.json');

const fcRepoArg = process.argv[2];
if (!fcRepoArg) {
  console.error('Usage: node scripts/sync-rules.mjs <FC repo path>');
  process.exit(1);
}
const fcRepo = resolve(fcRepoArg);

const sourceRules = resolve(fcRepo, 'firestore.rules');
if (!existsSync(sourceRules)) {
  console.error(`[sync-rules] 找不到來源 rules: ${sourceRules}`);
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });
copyFileSync(sourceRules, destRules);

const hash = createHash('sha256').update(readFileSync(destRules)).digest('hex');

let fcHead = null;
try {
  const out = execFileSync('git', ['-C', fcRepo, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  const trimmed = String(out).trim();
  fcHead = trimmed.length > 0 ? trimmed : null;
} catch {
  fcHead = null;
}

const meta = {
  sha256: hash,
  copiedAt: new Date().toISOString(),
  fcHead,
};
writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf8');

console.log(`[sync-rules] ${sourceRules}`);
console.log(`[sync-rules]   -> ${destRules}`);
console.log(`[sync-rules] sha256=${hash}`);
console.log(`[sync-rules] fcHead=${fcHead ?? 'null'}`);
