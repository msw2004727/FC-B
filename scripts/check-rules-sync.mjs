#!/usr/bin/env node
// 驗證 emulator 規則副本：
// (a) firestore.rules／storage.rules 與 RULES_SOURCE.json 記錄的雜湊一致。
// (b) 可選 --upstream <FC 路徑> [--ref <ref>]：用 git show 取正本算雜湊，不同則失敗。
// (c) 可選 --upstream-url <base>：用 fetch 取 <base>/firestore.rules 與 storage.rules 比對。
//
// 只用 Node 內建模組。

import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const firestorePath = resolve(repoRoot, 'emulator', 'firestore.rules');
const storagePath = resolve(repoRoot, 'emulator', 'storage.rules');
const metaPath = resolve(repoRoot, 'emulator', 'RULES_SOURCE.json');

function usage() {
  console.error('Usage: node scripts/check-rules-sync.mjs [--upstream <FC repo path> [--ref <git ref>]] [--upstream-url <base>]');
  process.exit(1);
}

const args = process.argv.slice(2);
let upstream = null;
let upstreamUrl = null;
let ref = 'origin/main';
let sawRef = false;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--upstream') {
    upstream = args[++i];
    if (!upstream || upstream.startsWith('--')) usage();
  } else if (arg === '--upstream-url') {
    upstreamUrl = args[++i];
    if (!upstreamUrl || upstreamUrl.startsWith('--')) usage();
  } else if (arg === '--ref') {
    sawRef = true;
    ref = args[++i];
    if (!ref || ref.startsWith('--')) usage();
  } else {
    usage();
  }
}
if (sawRef && !upstream) usage();

function hash(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

let failed = false;
function error(message) {
  failed = true;
  console.error(`[check-rules-sync] ${message}`);
}

const copies = [
  { label: 'firestore.rules', path: firestorePath, metaKey: 'sha256' },
  { label: 'storage.rules', path: storagePath, metaKey: 'storageSha256' },
];

for (const copy of copies) {
  if (!existsSync(copy.path)) {
    error(`缺少 emulator/${copy.label}，請先執行 npm run sync:rules`);
  }
}
if (!existsSync(metaPath)) {
  error('缺少 emulator/RULES_SOURCE.json，請先執行 npm run sync:rules');
  process.exit(1);
}

let meta;
try {
  meta = JSON.parse(readFileSync(metaPath, 'utf8'));
} catch (err) {
  error(`RULES_SOURCE.json 解析失敗 ${err}`);
  process.exit(1);
}

const local = new Map();
for (const copy of copies) {
  if (!existsSync(copy.path)) continue;
  const recorded = meta && typeof meta[copy.metaKey] === 'string' ? meta[copy.metaKey] : '';
  if (recorded.length === 0) {
    error(`RULES_SOURCE.json 缺少有效 ${copy.metaKey}`);
    continue;
  }
  const actual = hash(readFileSync(copy.path));
  local.set(copy.label, actual);
  if (actual !== recorded) {
    error(`emulator/${copy.label} 與記錄不一致（副本疑被手改）`);
    console.error(`[check-rules-sync]   expected: ${recorded}`);
    console.error(`[check-rules-sync]   actual:   ${actual}`);
  }
}

function reportLag(sourceLabel, upstreamBytes) {
  let lagged = false;
  for (const copy of copies) {
    const copyHash = local.get(copy.label);
    if (!copyHash) continue;
    const upstreamHash = hash(upstreamBytes.get(copy.label));
    if (copyHash !== upstreamHash) {
      if (!lagged) {
        error(`副本落後正本（${sourceLabel}）`);
        lagged = true;
      }
      console.error(`[check-rules-sync]   ${copy.label}`);
      console.error(`[check-rules-sync]     副本: ${copyHash}`);
      console.error(`[check-rules-sync]     正本: ${upstreamHash}`);
    }
  }
}

if (upstream) {
  const fcRepo = resolve(upstream);
  function gitShow(file) {
    try {
      return execFileSync('git', ['--no-pager', '-C', fcRepo, 'show', `${ref}:${file}`], {
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      const stderr = err.stderr ? err.stderr.toString('utf8').trim() : String(err.message || err);
      error(`git show ${ref}:${file} 失敗`);
      if (stderr) console.error(stderr);
      return null;
    }
  }
  const upstreamBytes = new Map();
  for (const copy of copies) {
    const bytes = gitShow(copy.label);
    if (bytes) upstreamBytes.set(copy.label, bytes);
  }
  if (upstreamBytes.size === copies.length) reportLag(`git ${ref}`, upstreamBytes);
}

if (upstreamUrl) {
  const base = upstreamUrl.replace(/\/+$/, '');
  async function fetchRules(file) {
    const url = `${base}/${file}`;
    let response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    } catch (err) {
      error(`fetch ${url} 失敗 ${err}`);
      return null;
    }
    if (!response.ok) {
      error(`fetch ${url} HTTP ${response.status}`);
      return null;
    }
    return Buffer.from(await response.arrayBuffer());
  }
  const upstreamBytes = new Map();
  for (const copy of copies) {
    const bytes = await fetchRules(copy.label);
    if (bytes) upstreamBytes.set(copy.label, bytes);
  }
  if (upstreamBytes.size === copies.length) reportLag(base, upstreamBytes);
}

if (failed) process.exit(1);
console.log('[check-rules-sync] OK');
