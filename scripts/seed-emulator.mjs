// Firestore emulator 種子腳本（僅供本機開發／截圖驗收）
//
// 安全保證：
//   - 只對 FIRESTORE_EMULATOR_HOST（預設 127.0.0.1:8080）寫入；host 非
//     127.0.0.1 / localhost 一律拒絕並 exit 1。
//   - 使用 REST Admin 權杖 `Authorization: Bearer owner`（僅 emulator 有效）。
//   - projectId 直接讀自 src/data/firebase-config.ts，不做 demo- 前綴轉換；
//     但因 host 已被鎖在 localhost，所有寫入一定落在 emulator。
//
// 用法：node scripts/seed-emulator.mjs [--reset]

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { seedData } from './seed-data.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function fail(message) {
  console.error(`[seed] ERROR: ${message}`);
  process.exit(1);
}

function parseHostname(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;
  try {
    return new URL(`http://${trimmed}`).hostname;
  } catch {
    return null;
  }
}

// ── 1. 目標 host 安全檢查 ─────────────────────────────────────────────
const host = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').trim();
const hostname = parseHostname(host);
if (hostname !== '127.0.0.1' && hostname !== 'localhost') {
  fail(
    `FIRESTORE_EMULATOR_HOST=${JSON.stringify(host)} 不是 localhost / 127.0.0.1，` +
      '拒絕寫入非 emulator 目標。',
  );
}

// ── 2. 讀取 projectId ───────────────────────────────────────────────
const configPath = resolve(__dirname, '../src/data/firebase-config.ts');
let configText;
try {
  configText = await readFile(configPath, 'utf8');
} catch (err) {
  fail(`無法讀取 ${configPath}：${err?.message ?? err}`);
}

const projectIdMatch = configText.match(/projectId\s*:\s*['"]([^'"]+)['"]/);
if (!projectIdMatch) {
  fail('firebase-config.ts 中找不到 projectId 欄位。');
}
const projectId = projectIdMatch[1];

const baseUrl = `http://${host}/v1/projects/${projectId}/databases/(default)/documents`;
const resetUrl = `http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`;

// ── 3. JS 值 → Firestore REST fields 轉換 ───────────────────────────
function toFirestoreValue(value) {
  if (value === null) return { nullValue: null };
  if (value === undefined) {
    throw new Error('undefined 不可作為欄位值（上層已過濾，若見此則為使用錯誤）');
  }
  const t = typeof value;
  if (t === 'string') return { stringValue: value };
  if (t === 'boolean') return { booleanValue: value };
  if (t === 'number') {
    if (!Number.isFinite(value)) throw new Error(`數字不是有限值：${String(value)}`);
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error('無效的 Date 物件');
    return { timestampValue: value.toISOString() };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map((v) => toFirestoreValue(v)) } };
  }
  if (t === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      fields[k] = toFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  throw new Error(`不支援的值型別：${t}`);
}

function toFirestoreFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    fields[k] = toFirestoreValue(v);
  }
  return fields;
}

// ── 4. REST 呼叫 ────────────────────────────────────────────────────
async function patchDocument(path, data) {
  const url = `${baseUrl}/${path}`;
  const body = JSON.stringify({ fields: toFirestoreFields(data) });
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer owner',
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PATCH ${path} 失敗 [${res.status} ${res.statusText}] ${text}`);
  }
}

async function resetEmulator() {
  const res = await fetch(resetUrl, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => '');
    throw new Error(`清空 emulator 失敗 [${res.status} ${res.statusText}] ${text}`);
  }
}

// ── 5. CLI 解析 ────────────────────────────────────────────────────
const cliArgs = process.argv.slice(2);
if (cliArgs.includes('--help') || cliArgs.includes('-h')) {
  console.log('用法：node scripts/seed-emulator.mjs [--reset]');
  process.exit(0);
}
const shouldReset = cliArgs.includes('--reset');

// ── 6. 印出目標資訊，讓操作者肉眼確認 ────────────────────────────
console.log('[seed] ───────── Firestore emulator seed ─────────');
console.log(`[seed] 目標 host : ${host}`);
console.log(`[seed] Project ID: ${projectId}`);
console.log(`[seed] Base URL  : ${baseUrl}`);
console.log(`[seed] --reset   : ${shouldReset ? 'yes' : 'no'}`);
console.log('[seed] ────────────────────────────────────────────');

// ── 7. 執行 ───────────────────────────────────────────────────────
if (shouldReset) {
  console.log('[seed] 清空 emulator 既有資料...');
  await resetEmulator();
}

const counts = { users: 0, teams: 0, events: 0, registrations: 0, legacy: 0, inbox: 0 };

try {
  for (const doc of seedData.users) {
    await patchDocument(`users/${doc.id}`, doc.data);
    counts.users += 1;
    console.log(`[seed]   + users/${doc.id}`);
  }

  for (const doc of seedData.teams) {
    await patchDocument(`teams/${doc.id}`, doc.data);
    counts.teams += 1;
    console.log(`[seed]   + teams/${doc.id}`);
  }

  for (const doc of seedData.events) {
    await patchDocument(`events/${doc.id}`, doc.data);
    counts.events += 1;
    console.log(`[seed]   + events/${doc.id}`);
  }

  for (const reg of seedData.registrations) {
    await patchDocument(reg.path, reg.data);
    counts.registrations += 1;
    console.log(`[seed]   + ${reg.path}`);
  }

  for (const msg of seedData.inbox ?? []) {
    await patchDocument(msg.path, msg.data);
    counts.inbox += 1;
    console.log(`[seed]   + ${msg.path}`);
  }

  for (const reg of seedData.legacy) {
    await patchDocument(reg.path, reg.data);
    counts.legacy += 1;
    console.log(`[seed]   + ${reg.path} (legacy root, 用來驗證會被排除)`);
  }
} catch (err) {
  console.error(`[seed] 寫入失敗：${err?.message ?? err}`);
  process.exit(1);
}

const total = counts.users + counts.teams + counts.events + counts.registrations + counts.legacy + counts.inbox;
console.log('[seed] ───────── 完成 ─────────');
console.log(`[seed]   users         : ${counts.users}`);
console.log(`[seed]   teams         : ${counts.teams}`);
console.log(`[seed]   events        : ${counts.events}`);
console.log(`[seed]   registrations : ${counts.registrations}`);
console.log(`[seed]   legacy root   : ${counts.legacy}`);
console.log(`[seed]   ──────────────────────`);
console.log(`[seed]   total writes  : ${total}`);
console.log('[seed] 資料已寫入 emulator（非正式環境）。');
