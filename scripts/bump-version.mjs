#!/usr/bin/env node
/**
 * bump-version.mjs — 更新新版 B 的版號（src/version.ts 的 APP_VERSION）。
 *
 * 規則照舊版 A 的 scripts/bump-version.js（A CLAUDE.md R-REL-001／R-REL-002）：
 *   格式 0.YYYYMMDD{suffix}，日期用台北時區。
 *   例：0.20260422 → 0.20260422a → … → 0.20260422z → 0.20260422za；跨日重置為 0.新日期。
 * B 的程式檔名帶雜湊，不需要像 A 同步 ?v= 等四處，只更新 src/version.ts 一處。
 *
 * 用法：
 *   node scripts/bump-version.mjs              → 自動遞增（跨日重置、同日遞增後綴）
 *   node scripts/bump-version.mjs 0.20261020a  → 指定版號（必須符合 ^0\.\d{8}[a-z]*$）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERSION_PATTERN = /^0\.(\d{8})([a-z]*)$/;

export function todayTaipei(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const pick = (type) => parts.find((p) => p.type === type).value;
  return `${pick('year')}${pick('month')}${pick('day')}`;
}

/** 照 A incrementVersion：不符格式或跨日→今天無後綴；同日→後綴遞增（a→b、z→za、zz→zza）。 */
export function incrementVersion(current, today) {
  const m = String(current).match(VERSION_PATTERN);
  if (!m) return `0.${today}`;
  const [, date, suffix] = m;
  if (today > date) return `0.${today}`;
  if (!suffix) return `0.${date}a`;
  const chars = suffix.split('');
  let i = chars.length - 1;
  while (i >= 0 && chars[i] === 'z') i--;
  if (i >= 0) {
    chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1);
    for (let j = i + 1; j < chars.length; j++) chars[j] = 'a';
    return `0.${date}${chars.join('')}`;
  }
  return `0.${date}${suffix}a`;
}

const VERSION_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'version.ts');
const DECLARATION = /export const APP_VERSION = '([^']*)';/;

function main() {
  const source = fs.readFileSync(VERSION_FILE, 'utf8');
  const found = source.match(DECLARATION);
  if (!found) throw new Error('src/version.ts 找不到 APP_VERSION');
  const current = found[1];
  const requested = process.argv[2];
  if (requested && !VERSION_PATTERN.test(requested)) {
    throw new Error(`指定版號 "${requested}" 不符合 0.YYYYMMDD{a-z} 格式`);
  }
  const today = todayTaipei();
  const next = requested || incrementVersion(current, today);
  if (!requested && today < (current.match(VERSION_PATTERN)?.[1] ?? '')) {
    console.warn(`⚠ 今天 ${today} 比版號日期還舊（時區或系統時間異常？），沿用舊日期遞增`);
  }
  fs.writeFileSync(VERSION_FILE, source.replace(DECLARATION, `export const APP_VERSION = '${next}';`), 'utf8');
  console.log(`版號：${current} → ${next}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
