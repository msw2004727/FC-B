#!/usr/bin/env node
// 產生 src/data/__fixtures__/user-doc-oracle.json：以舊站 A 的 `FirebaseService.createOrUpdateUser`
// （../FC/js/firebase-crud.js）為 oracle，記錄同一輸入下 A 實際送出的 Firestore 寫入。
//
// 做法（照 FC tests/unit/b-oracle 的 vm 載入法）：A 的原始碼原樣在 vm 執行，不重寫任何邏輯；
// 只替換資料來源：
//   - db：記錄 get／where／set／update 的假 Firestore（依案例回傳 canonical／legacy 文件）；
//   - auth.currentUser.uid、firebase.firestore.FieldValue.serverTimestamp()（回 '__SERVER_TIMESTAMP__'）；
//   - FirebaseService._ensureAuth（回 true；uid 是否一致由 A 自己以 auth.currentUser.uid 比對）、
//     _saveToLS／_setupUserListener／_startAuthDependentWork（空操作，都在寫入之後才呼叫，不影響寫入內容）；
//   - Date：固定 now（A 用 Date.now() 判斷 lastLogin 是否超過 10 分鐘）。
// `_stripDocId` 取自 ../FC/js/firebase-service.js 原文。
//
// 用法（只在主機有 ../FC 時執行；產物 commit 進 repo，測試只讀 fixture）：
//   node scripts/gen-user-doc-oracle.mjs ../FC

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import vm from 'node:vm';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fcRoot = resolve(process.argv[2] || resolve(repoRoot, '../FC'));
const crudPath = resolve(fcRoot, 'js/firebase-crud.js');
const servicePath = resolve(fcRoot, 'js/firebase-service.js');
const outPath = resolve(repoRoot, 'src/data/__fixtures__/user-doc-oracle.json');

const TS = '__SERVER_TIMESTAMP__';
const NOW = Date.UTC(2026, 10, 9, 6, 0, 0);
const MIN = 60 * 1000;

const crudSource = readFileSync(crudPath, 'utf8');
const serviceSource = readFileSync(servicePath, 'utf8');
const stripMatch = /function _stripDocId\(obj\) \{[\s\S]*?\n\}/.exec(serviceSource);
if (!stripMatch) throw new Error('找不到 _stripDocId');

const decode = (value) => {
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === 'object') {
    if (typeof value.__timestamp === 'number') {
      const ms = value.__timestamp;
      return { toMillis: () => ms };
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decode(v)]));
  }
  return value;
};
const encode = (value) => {
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === 'object') {
    if (typeof value.toMillis === 'function') return { __timestamp: value.toMillis() };
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)]));
  }
  return value;
};

const P = (userId, displayName, pictureUrl = 'https://profile.line-scdn.net/a', email = null) =>
  ({ userId, displayName, pictureUrl, email });
const U = 'Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1';

const cases = [
  { id: 'new-basic', authUid: U, profile: P(U, '  小明  ', 'https://profile.line-scdn.net/a', 'a@example.test') },
  { id: 'new-empty-name', authUid: U, profile: P(U, '', null, null) },
  { id: 'new-blank-name-no-picture', authUid: U, profile: P(U, '   ', '', '') },
  { id: 'new-null-name', authUid: U, profile: P(U, null, undefined, undefined) },
  {
    id: 'legacy-no-createdAt', authUid: U, profile: P(U, '新名字'),
    legacy: { id: 'legacy-doc-1', data: { lineUserId: U, displayName: '舊名', role: 'user', exp: 0, level: 1, gender: '男', region: '台北市' } },
  },
  {
    id: 'legacy-with-createdAt', authUid: U, profile: P(U, '新名字', null),
    legacy: { id: 'legacy-doc-2', data: { lineUserId: U, displayName: '舊名', role: 'coach', exp: 120, createdAt: { __timestamp: NOW - 400 * 24 * 60 * MIN } } },
  },
  {
    id: 'existing-recent-login', authUid: U, profile: P(U, ' 改名 ', 'https://profile.line-scdn.net/b'),
    canonical: { uid: U, displayName: '原名', pictureUrl: 'https://profile.line-scdn.net/a', role: 'admin', exp: 300, level: 5, lineNotify: { bound: true }, lastLogin: { __timestamp: NOW - 5 * MIN } },
  },
  {
    id: 'existing-old-login', authUid: U, profile: P(U, '原名', 'https://profile.line-scdn.net/a'),
    canonical: { uid: U, displayName: '原名', pictureUrl: 'https://profile.line-scdn.net/a', role: 'user', exp: 0, lastLogin: { __timestamp: NOW - 11 * MIN } },
  },
  {
    id: 'existing-iso-lastLogin', authUid: U, profile: P(U, '原名', null),
    canonical: { uid: U, displayName: '原名', lastLogin: '2026-01-01T00:00:00.000Z' },
  },
  {
    id: 'existing-no-lastLogin-empty-name', authUid: U, profile: P(U, ''),
    canonical: { uid: U, displayName: '原名' },
  },
  {
    id: 'existing-same-values', authUid: U, profile: P(U, '原名', 'https://profile.line-scdn.net/a'),
    canonical: { uid: U, displayName: '原名', pictureUrl: 'https://profile.line-scdn.net/a', lastLogin: { __timestamp: NOW - 1 * MIN } },
  },
  { id: 'uid-mismatch', authUid: 'Ubbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2', profile: P(U, '小明') },
];

function makeDb(c, ops) {
  const canonical = c.canonical ? decode(c.canonical) : null;
  const legacy = c.legacy ? { id: c.legacy.id, data: decode(c.legacy.data) } : null;
  const docRef = (id) => ({
    async get() {
      if (id === c.authUid && ops.some((op) => op.op === 'set')) {
        const last = ops.filter((op) => op.op === 'set').at(-1);
        return { exists: true, id, data: () => decode(last.payload) };
      }
      if (id === c.authUid && canonical) return { exists: true, id, data: () => ({ ...canonical }) };
      return { exists: false, id, data: () => undefined };
    },
    async set(payload, options) {
      ops.push({ op: 'set', path: `users/${id}`, payload: encode(payload), ...(options ? { options } : {}) });
    },
    async update(payload) {
      ops.push({ op: 'update', path: `users/${id}`, payload: encode(payload) });
    },
  });
  return {
    collection(name) {
      if (name !== 'users') throw new Error(`unexpected collection ${name}`);
      return {
        doc: docRef,
        where(field, opr, value) {
          ops.push({ op: 'query', field, opr, value });
          return {
            limit(n) {
              ops.push({ op: 'limit', n });
              return {
                async get() {
                  const hit = legacy && legacy.data.lineUserId === value ? [legacy] : [];
                  return { empty: hit.length === 0, docs: hit.map((d) => ({ id: d.id, data: () => ({ ...d.data }) })) };
                },
              };
            },
          };
        },
      };
    },
  };
}

const results = [];
for (const c of cases) {
  const ops = [];
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [NOW])); }
    static now() { return NOW; }
  }
  const FirebaseService = { _cache: {} };
  const context = vm.createContext({
    FirebaseService,
    db: makeDb(c, ops),
    auth: { currentUser: { uid: c.authUid } },
    firebase: { firestore: { FieldValue: { serverTimestamp: () => TS } } },
    console: { log() {}, warn() {}, error() {} },
    Date: FixedDate,
    Promise,
  });
  vm.runInContext(`${stripMatch[0]}\n${crudSource}`, context, { filename: 'firebase-crud.js' });
  // 必須在 A 原始碼的 Object.assign 之後才替換（firebase-crud.js 自己也定義 _ensureAuth／_setupUserListener）。
  Object.assign(FirebaseService, {
    async _ensureAuth() { return true; },
    _saveToLS() {},
    _setupUserListener() {},
    _startAuthDependentWork() {},
  });
  let error = null;
  try {
    await FirebaseService.createOrUpdateUser({ ...c.profile });
  } catch (err) {
    error = { code: err?.code ?? null, message: String(err?.message ?? err) };
  }
  results.push({
    id: c.id,
    input: {
      authUid: c.authUid,
      profile: c.profile,
      canonical: c.canonical ?? null,
      legacy: c.legacy ?? null,
      nowMs: NOW,
    },
    expected: { writes: ops.filter((op) => op.op === 'set' || op.op === 'update'), queries: ops.filter((op) => op.op === 'query'), error },
  });
}

let fcHead = null;
try {
  fcHead = execSync('git rev-parse HEAD', { cwd: fcRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
} catch { /* ignore */ }

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify({
  meta: {
    source: 'FC js/firebase-crud.js#createOrUpdateUser',
    sourceSha256: createHash('sha256').update(crudSource).digest('hex'),
    fcHead,
    serverTimestamp: TS,
    caseCount: results.length,
  },
  cases: results,
}, null, 2)}\n`, 'utf8');
console.log(`[gen-user-doc-oracle] ${results.length} 案 → ${outPath}`);
