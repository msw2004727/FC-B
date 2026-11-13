#!/usr/bin/env node
// 從 FC repo 的 git 物件讀取 firestore.rules 與 storage.rules（不讀工作樹），
// 位元組原樣寫入 emulator/，並記錄雜湊與來源 ref。
//
// 用法：
//   node scripts/sync-rules.mjs <FC repo 路徑> [--ref <git ref，預設 origin/main>]
//
// 只用 Node 內建模組。

import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const destDir = resolve(repoRoot, 'emulator');

function usage() {
  console.error('Usage: node scripts/sync-rules.mjs <FC repo path> [--ref <git ref>]');
  process.exit(1);
}

const args = process.argv.slice(2);
let fcRepoArg = null;
let ref = 'origin/main';
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--ref') {
    ref = args[++i];
    if (!ref || ref.startsWith('--')) usage();
  } else if (arg.startsWith('--')) {
    usage();
  } else if (!fcRepoArg) {
    fcRepoArg = arg;
  } else {
    usage();
  }
}
if (!fcRepoArg) usage();

const fcRepo = resolve(fcRepoArg);

function git(gitArgs) {
  try {
    return execFileSync('git', ['--no-pager', '-C', fcRepo, ...gitArgs], {
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString('utf8').trim() : String(err.message || err);
    console.error(`[sync-rules] git ${gitArgs.join(' ')} 失敗`);
    if (stderr) console.error(stderr);
    process.exit(1);
  }
}

const firestore = git(['show', `${ref}:firestore.rules`]);
const storage = git(['show', `${ref}:storage.rules`]);
const fcHead = git(['rev-parse', ref]).toString('utf8').trim();
if (!/^[0-9a-f]{40}$/.test(fcHead)) {
  console.error(`[sync-rules] git rev-parse ${ref} 沒有回傳完整 SHA：${fcHead}`);
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });
const destFirestore = resolve(destDir, 'firestore.rules');
const destStorage = resolve(destDir, 'storage.rules');
writeFileSync(destFirestore, firestore);
writeFileSync(destStorage, storage);

const sha256 = createHash('sha256').update(firestore).digest('hex');
const storageSha256 = createHash('sha256').update(storage).digest('hex');
const meta = {
  sha256,
  storageSha256,
  copiedAt: new Date().toISOString(),
  fcRef: ref,
  fcHead,
};
writeFileSync(resolve(destDir, 'RULES_SOURCE.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

console.log(`[sync-rules] ${ref}:firestore.rules`);
console.log(`[sync-rules]   -> ${destFirestore}`);
console.log(`[sync-rules] ${ref}:storage.rules`);
console.log(`[sync-rules]   -> ${destStorage}`);
console.log(`[sync-rules] sha256=${sha256}`);
console.log(`[sync-rules] storageSha256=${storageSha256}`);
console.log(`[sync-rules] fcRef=${ref}`);
console.log(`[sync-rules] fcHead=${fcHead}`);
