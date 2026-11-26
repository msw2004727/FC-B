import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  connectFirestoreEmulator,
  disableNetwork,
  doc,
  enableNetwork,
  getDoc,
  initializeFirestore,
  memoryLocalCache,
  type Firestore,
} from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIVE_COPY } from '../copy';
import { compareEntries, MemoryActionLog, ResilientActionLog, type ActionLog } from './action-log';
import { createFirestoreBackend } from './live-repo';
import { Sender } from './sender';
import { createScoringSession, type ScoringSession } from './session';
import { scorePadPropsFrom } from '../scoring-adapter';
import { memorySidStore, type SidStore } from './sid';
import type { BatchPlan, LogEntry } from './types';

// 模擬器啟動時認定的示範專案。規則只對這個專案生效；其他 demo 專案會變成「沒有任何 allow」。
const PROJECT = 'demo-cp-u1';
// 模擬器監看規則檔後，只把新規則套到 (default)。asia-main 會停在啟動時的主站規則。
const DB = '(default)';
const CID = 'comp-u1';
const MT = 'mt-u1';
const UID = 'scorer-u1';
const SID = 'emu-local-sid-0000000001';
const HOST = '127.0.0.1';
// 預設 8402（FC-B 全測照舊）；與其他工作階段並行時用 FCB_EMU_PORT 換埠（顧問 11-20）。
const PORT = Number(process.env.FCB_EMU_PORT ?? 8402);

function probePort(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: HOST, port: PORT });
    const finish = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(400);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

const EMU = await probePort();

class Ts {
  constructor(readonly iso: string) {}
}

type RestVal =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { nullValue: null }
  | { timestampValue: string }
  | { mapValue: { fields: Record<string, RestVal> } }
  | { arrayValue: { values?: RestVal[] } };

function enc(value: unknown): RestVal {
  if (value instanceof Ts) return { timestampValue: value.iso };
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map((item) => enc(item)) } };
  if (typeof value === 'object') return { mapValue: { fields: fieldsOf(value as Record<string, unknown>) } };
  throw new Error('無法編碼');
}

function fieldsOf(data: Record<string, unknown>): Record<string, RestVal> {
  const fields: Record<string, RestVal> = {};
  for (const [key, value] of Object.entries(data)) fields[key] = enc(value);
  return fields;
}

function dec(value: RestVal | undefined): unknown {
  if (!value) return undefined;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('nullValue' in value) return null;
  if ('timestampValue' in value) return value.timestampValue;
  if ('mapValue' in value) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value.mapValue.fields ?? {})) out[key] = dec(item);
    return out;
  }
  if ('arrayValue' in value) return (value.arrayValue.values ?? []).map((item) => dec(item));
  return undefined;
}

function root(path: string): string {
  return `http://${HOST}:${PORT}/v1/projects/${PROJECT}/databases/${DB}/documents/${path}`;
}

async function rest(method: string, url: string, body?: unknown): Promise<{ status: number; text: string }> {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: 'Bearer owner',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

const RULES_TARGET = 'emulator/firestore.rules';
let rulesBackup: Buffer | null = null;

function useSnapshotRules(): void {
  const content = readFileSync('emulator/asia-main.rules');
  const hash = createHash('sha256').update(content).digest('hex');
  expect(hash.slice(0, 16)).toBe('37add016c3084d24');
  if (!rulesBackup) rulesBackup = readFileSync(RULES_TARGET);
  writeFileSync(RULES_TARGET, content);
}

function restoreStartupRules(): void {
  if (!rulesBackup) return;
  writeFileSync(RULES_TARGET, rulesBackup);
  rulesBackup = null;
}

/**
 * 等模擬器重載回啟動規則。兩份規則開頭相同，不能比前幾十字；改找「啟動規則有、快照沒有」的一行
 * （ASCII、不含引號與反斜線，JSON 回應裡原樣出現）。5 秒內沒看到就丟錯，不靜默結束。
 */
async function waitForStartupRules(restored: string): Promise<void> {
  const snapshot = readFileSync('emulator/asia-main.rules').toString('utf8');
  const marker = restored.split('\n').map((line) => line.trim()).find((line) => line.length >= 20
    && /^[\x20-\x7e]+$/.test(line) && !line.includes('"') && !line.includes('\\') && !snapshot.includes(line));
  if (!marker) throw new Error('啟動規則找不到可辨識的特徵行');
  let last = '';
  for (let i = 0; i < 25; i += 1) {
    try {
      const res = await fetch(`http://${HOST}:${PORT}/emulator/v1/projects/${PROJECT}:securityRules`);
      const text = await res.text();
      if (res.ok && text.includes(marker)) return;
      last = `${res.status}`;
    } catch (err) {
      last = String(err);
    }
    await new Promise((resolve) => { setTimeout(resolve, 200); });
  }
  throw new Error(`還原規則 5 秒內未生效（${last}）`);
}

async function waitForRules(): Promise<void> {
  const path = root(`competitions/${CID}/matches/${MT}`);
  let last = '';
  for (let i = 0; i < 30; i += 1) {
    const res = await fetch(path);
    last = `${res.status} ${(await res.text()).slice(0, 160)}`;
    if (res.status === 200) return;
    await new Promise((resolve) => { setTimeout(resolve, 200); });
  }
  throw new Error(`規則未生效 ${last}`);
}

async function clearDb(): Promise<void> {
  const res = await rest('DELETE', `http://${HOST}:${PORT}/emulator/v1/projects/${PROJECT}/databases/${DB}/documents`);
  if (res.status >= 300 && res.status !== 404) throw new Error(`清空失敗 ${res.status} ${res.text.slice(0, 240)}`);
}

async function createDoc(collection: string, id: string, data: Record<string, unknown>): Promise<void> {
  const res = await rest('POST', `${root(collection)}?documentId=${encodeURIComponent(id)}`, { fields: fieldsOf(data) });
  if (res.status < 200 || res.status >= 300) throw new Error(`建立 ${collection}/${id} 失敗 ${res.status} ${res.text.slice(0, 400)}`);
}

async function patchDoc(path: string, data: Record<string, unknown>): Promise<void> {
  const mask = Object.keys(data).map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`).join('&');
  const res = await rest('PATCH', `${root(path)}?${mask}`, { fields: fieldsOf(data) });
  if (res.status < 200 || res.status >= 300) throw new Error(`更新 ${path} 失敗 ${res.status} ${res.text.slice(0, 400)}`);
}

/** 主辦重置：把 rev、resetRev 推到既有事件之上，比分歸零，並刪掉 control/scorer。回傳新的重置線。 */
async function hostReset(): Promise<number> {
  const match = await readDoc(`competitions/${CID}/matches/${MT}`);
  const events = await listCollection(`competitions/${CID}/matches/${MT}/timeline`);
  const top = events.reduce((max, event) => Math.max(max, Number(event.seq) || 0), Number(match?.rev ?? 0));
  const rev = top + 1;
  await patchDoc(`competitions/${CID}/matches/${MT}`, {
    rev,
    resetRev: rev,
    status: 'live',
    lock: { locked: false },
    score: { home: 0, away: 0 },
    finishedAt: null,
  });
  const removed = await rest('DELETE', root(`competitions/${CID}/matches/${MT}/control/scorer`));
  if (removed.status >= 300 && removed.status !== 404) {
    throw new Error(`刪除記分權失敗 ${removed.status} ${removed.text.slice(0, 240)}`);
  }
  return rev;
}

async function readDoc(path: string): Promise<Record<string, unknown> | null> {
  const res = await rest('GET', root(path));
  if (res.status === 404) return null;
  if (res.status < 200 || res.status >= 300) throw new Error(`讀取 ${path} 失敗 ${res.status} ${res.text.slice(0, 240)}`);
  const body = JSON.parse(res.text) as { fields?: Record<string, RestVal> };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body.fields ?? {})) out[key] = dec(value);
  return out;
}

async function listCollection(path: string): Promise<Array<Record<string, unknown>>> {
  const res = await rest('GET', `${root(path)}?pageSize=300`);
  if (res.status < 200 || res.status >= 300) throw new Error(`列出 ${path} 失敗 ${res.status} ${res.text.slice(0, 240)}`);
  const body = JSON.parse(res.text) as { documents?: Array<{ fields?: Record<string, RestVal> }> };
  return (body.documents ?? []).map((item) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(item.fields ?? {})) out[key] = dec(value);
    return out;
  });
}

async function seed(): Promise<void> {
  await clearDb();
  await createDoc('competitions', CID, {
    status: 'published',
    hidden: false,
    visibility: 'public',
    hostType: 'personal',
  });
  await createDoc(`competitions/${CID}/staff`, UID, {
    roles: ['scorer'],
    matchIds: [MT],
    expiresAt: null,
  });
  await createDoc(`competitions/${CID}/matches`, MT, {
    status: 'live',
    rev: 0,
    resetRev: 0,
    lock: { locked: false },
    score: { home: 0, away: 0 },
    clockBase: { startedAt: null, pausedSec: 0, running: true, period: 'h1' },
    finishedAt: null,
    divisionId: 'dv1',
    home: { teamId: 'en_h', name: '主隊' },
    away: { teamId: 'en_a', name: '客隊' },
  });
  await createDoc(`competitions/${CID}/matches/${MT}/control`, 'scorer', {
    uid: UID,
    sid: SID,
    takenAt: new Ts('2026-01-01T00:00:00.000Z'),
  });
}

function mockUserToken(uid: string): string {
  const pack = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return `${pack({ alg: 'none', typ: 'JWT' })}.${pack({
    iss: `https://securetoken.google.com/${PROJECT}`,
    aud: PROJECT,
    sub: uid,
    user_id: uid,
    uid,
    iat: now,
    exp: now + 3600,
    firebase: { sign_in_provider: 'custom' },
  })}.`;
}

function signIn(db: Firestore, uid: string): void {
  const host = db as unknown as {
    _authCredentials?: Record<string, unknown>;
    _delegate?: { _authCredentials?: Record<string, unknown> };
  };
  const creds = host._authCredentials ?? host._delegate?._authCredentials;
  if (!creds) throw new Error('Firestore 客戶端沒有 _authCredentials');
  const accessToken = mockUserToken(uid);
  const user = { uid };
  // 瀏覽器傳輸會讀 token.headers（Map）。沒有這個欄位時開流會在 forEach 炸掉。
  const headers = new Map<string, string>([['Authorization', `Bearer ${accessToken}`]]);
  const token = async () => ({ type: 'OAuth', accessToken, authUser: user, user, headers });
  creds.getToken = token;
  creds.forceRefresh = token;
  creds.getUser = async () => user;
  try { creds.currentUser = user; } catch { /* 有的實作把 currentUser 做成唯讀 */ }
}

interface Live {
  app: FirebaseApp;
  db: Firestore;
  session: ScoringSession;
  log: ActionLog;
  sids: SidStore;
  online: { value: boolean };
  notify: (online: boolean) => void;
  visible: { value: boolean };
  notifyVisible: () => void;
  commits: BatchPlan[];
  release: () => Promise<void>;
}

const opened: Live[] = [];

async function startLive(name: string, options?: {
  log?: ActionLog;
  sids?: SidStore;
  beforeCommit?: (plan: BatchPlan, nth: number) => Promise<void> | void;
  afterCommit?: (plan: BatchPlan, nth: number) => Promise<void> | void;
  visible?: { value: boolean };
  now?: () => number;
  randomBytes?: (n: number) => Uint8Array;
}): Promise<Live> {
  const app = initializeApp({ apiKey: 'demo', projectId: PROJECT, appId: 'demo-u1' }, `${name}-${Date.now()}-${Math.random()}`);
  const db = initializeFirestore(app, {
    localCache: memoryLocalCache(),
    // jsdom 的 XHR 串流不穩。長輪詢加上 Fetch 串流，避開 WebChannel 的 XHR。
    experimentalForceLongPolling: true,
    useFetchStreams: true,
  } as Parameters<typeof initializeFirestore>[1], DB);
  connectFirestoreEmulator(db, HOST, PORT);
  signIn(db, UID);
  const log = options?.log ?? new MemoryActionLog();
  const sids = options?.sids ?? memorySidStore();
  if (!options?.sids) await sids.set(CID, MT, UID, SID);
  const backend = createFirestoreBackend(db, CID, MT, UID);
  const commits: BatchPlan[] = [];
  const raw = backend.port.commit.bind(backend.port);
  backend.port.commit = async (plan) => {
    commits.push(plan);
    if (options?.beforeCommit) await options.beforeCommit(plan, commits.length);
    await raw(plan);
    if (options?.afterCommit) await options.afterCommit(plan, commits.length);
  };
  const online = { value: true };
  const visible = options?.visible ?? { value: true };
  let notify = (_next: boolean) => {};
  let notifyVisible = () => {};
  const session = createScoringSession({
    cid: CID,
    mtId: MT,
    uid: UID,
    backend,
    log,
    sids,
    ...(options?.now ? { now: options.now } : {}),
    ...(options?.randomBytes ? { randomBytes: options.randomBytes } : {}),
    online: () => online.value,
    watchOnline: (cb) => {
      notify = cb;
      return () => {};
    },
    visible: () => visible.value,
    watchVisible: (cb) => {
      notifyVisible = cb;
      return () => {};
    },
    locks: null,
    channel: null,
    wakeRequest: null,
    tick: false,
  });
  const live: Live = {
    app, db, session, log, sids, online, visible,
    // 延遲取值：直接放 notify 拿到的是 start() 前的空函式，watchOnline 回呼從沒被叫到（第 4 步 A：原本 test 9 沒測到 reconcileInflight）。
    notify: (next: boolean) => notify(next),
    notifyVisible: () => notifyVisible(),
    commits,
    release: async () => {
      session.stop();
      await deleteApp(app);
    },
  };
  opened.push(live);
  try {
    await session.start();
  } catch (err) {
    const id = (db as unknown as { _databaseId?: unknown; _settings?: { host?: string } });
    throw new Error(`${(err as Error).message} db=${JSON.stringify(id._databaseId)} host=${id._settings?.host} project=${app.options.projectId}`);
  }
  return live;
}

async function goOffline(live: Live): Promise<void> {
  live.online.value = false;
  await disableNetwork(live.db);
}

async function goOnline(live: Live): Promise<void> {
  live.online.value = true;
  await enableNetwork(live.db);
  live.notify(true);
}

async function waitUntil(label: string, pred: () => Promise<boolean> | boolean, rounds = 40): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    if (await pred()) return;
    await new Promise((resolve) => { setTimeout(resolve, 25); });
  }
  throw new Error(label);
}

async function goalOps(log: ActionLog): Promise<string[]> {
  const rows = await log.list(CID, MT);
  return rows.filter((row) => row.kind === 'goal').map((row) => row.op);
}

async function rows(log: ActionLog): Promise<LogEntry[]> {
  return log.list(CID, MT);
}

async function expectBoard(score: { home: number; away: number }, opts?: { contiguous?: boolean; ops?: string[] }): Promise<void> {
  let events: Array<Record<string, unknown>> = [];
  let home = -1;
  let away = -1;
  for (let i = 0; i < 20; i += 1) {
    events = await listCollection(`competitions/${CID}/matches/${MT}/timeline`);
    const match = await readDoc(`competitions/${CID}/matches/${MT}`);
    const got = (match?.score ?? {}) as { home?: number; away?: number };
    home = Number(got.home ?? -1);
    away = Number(got.away ?? -1);
    if (home === score.home && away === score.away) break;
    await new Promise((resolve) => { setTimeout(resolve, 40); });
  }
  expect({ home, away }).toEqual(score);
  const ops = events.map((event) => String(event.op));
  expect(new Set(ops).size).toBe(ops.length);
  for (const op of opts?.ops ?? []) expect(ops.filter((item) => item === op)).toHaveLength(1);
  const seqs = events.map((event) => Number(event.seq)).sort((a, b) => a - b);
  const match = await readDoc(`competitions/${CID}/matches/${MT}`);
  if (seqs.length > 0) expect(Number(match?.rev)).toBe(seqs[seqs.length - 1]);
  if (opts?.contiguous !== false && seqs.length > 0) {
    expect(seqs[0]).toBe(1);
    for (let i = 1; i < seqs.length; i += 1) expect(seqs[i]).toBe((seqs[i - 1] ?? 0) + 1);
  }
}

/**
 * 照 IndexedDbActionLog.list 的排法：索引 getAll 依主鍵（op）出列，再做穩定排序 compareEntries。
 * createdAt 相同時，先後由隨機 op 決定，不是建立順序。
 */
class OpOrderedLog extends MemoryActionLog {
  override async list(cid: string, mtId: string): Promise<LogEntry[]> {
    const out = await super.list(cid, mtId);
    return out.sort((a, b) => (a.op < b.op ? -1 : a.op > b.op ? 1 : 0)).sort(compareEntries);
  }
}

/** arm 之後的前幾次用指定位元組填滿（控制 op 字典序），其餘照常隨機。 */
function fillQueue(): { bytes: (n: number) => Uint8Array; arm: (fills: number[]) => void } {
  const fills: number[] = [];
  return {
    bytes: (n) => {
      const fill = fills.shift();
      if (fill === undefined) return globalThis.crypto.getRandomValues(new Uint8Array(n));
      return new Uint8Array(n).fill(fill);
    },
    arm: (next) => { fills.push(...next); },
  };
}

describe.skipIf(!EMU)('記分模擬器', { timeout: 60000 }, () => {
  beforeAll(async () => {
    useSnapshotRules();
    await seed();
    await waitForRules();
    const live = await startLive('smoke');
    const snap = await getDoc(doc(live.db, `competitions/${CID}/matches/${MT}`));
    expect(snap.exists()).toBe(true);
    await live.release();
  }, 60000);

  afterAll(async () => {
    restoreStartupRules();
    // 還原規則會讓模擬器再載一次。先等它載完，腳本關機時才不會撞上 securityRules。
    await waitForStartupRules(readFileSync(RULES_TARGET).toString('utf8'));
  });

  beforeEach(async () => {
    await seed();
  }, 60000);

  afterEach(async () => {
    for (const live of opened) {
      try { await live.release(); } catch { /* 已關掉 */ }
    }
    opened.length = 0;
  });

  it('1. 斷網兩筆，恢復後各記一次', async () => {
    const live = await startLive('s1');
    await goOffline(live);
    const first = await live.session.getState().actions.goal({ side: 'home', plId: 'pl_h1' });
    const second = await live.session.getState().actions.goal({ side: 'away', plId: 'pl_a1' });
    expect(first.status).toBe('queued');
    expect(second.status).toBe('queued');
    const ops = await goalOps(live.log);
    await goOnline(live);
    await live.session.whenIdle();
    await expectBoard({ home: 1, away: 1 }, { ops, contiguous: true });
  });

  it('2. 斷網兩筆後丟掉 SDK，重整續送且不重複', async () => {
    const log = new MemoryActionLog();
    const sids = memorySidStore();
    await sids.set(CID, MT, UID, SID);
    const first = await startLive('s2a', { log, sids });
    await goOffline(first);
    await first.session.getState().actions.goal({ side: 'home' });
    await first.session.getState().actions.goal({ side: 'home' });
    const ops = await goalOps(log);
    first.session.stop();
    await deleteApp(first.app);
    opened.splice(opened.indexOf(first), 1);
    const second = await startLive('s2b', { log, sids });
    await second.session.whenIdle();
    await expectBoard({ home: 2, away: 0 }, { ops, contiguous: true });
  });

  it('3. 伺服器已寫入但回應遺失，以 op 對帳不再送', async () => {
    const live = await startLive('s3', {
      afterCommit: async (_plan, nth) => {
        if (nth === 1) throw { code: 'unavailable' };
      },
    });
    const result = await live.session.getState().actions.goal({ side: 'home' });
    expect(result.status).toBe('applied');
    const ops = await goalOps(live.log);
    await expectBoard({ home: 1, away: 0 }, { ops, contiguous: true });
    expect(live.commits).toHaveLength(1);
  });

  it('4. 離線期間被另一個 uid 接手，兩筆都不寫入', async () => {
    const live = await startLive('s4');
    await goOffline(live);
    await live.session.getState().actions.goal({ side: 'home' });
    await live.session.getState().actions.goal({ side: 'away' });
    await patchDoc(`competitions/${CID}/matches/${MT}/control/scorer`, {
      uid: 'other-user',
      sid: 'other-device-sid-000001',
    });
    await goOnline(live);
    await live.session.whenIdle();
    const list = await rows(live.log);
    const goals = list.filter((row) => row.kind === 'goal');
    expect(goals.every((row) => row.state === 'rejected' && row.rejectReason === 'takenOver')).toBe(true);
    await expectBoard({ home: 0, away: 0 }, { contiguous: true });
  });

  it('5. 同帳號第二支裝置接手，第一支待送的兩筆被拒', async () => {
    const live = await startLive('s5a');
    await goOffline(live);
    await live.session.getState().actions.goal({ side: 'home' });
    await live.session.getState().actions.goal({ side: 'home' });
    const other = await startLive('s5b', { sids: memorySidStore() });
    const taken = await other.session.getState().actions.takeover();
    expect(taken.status).toBe('applied');
    await goOnline(live);
    await live.session.whenIdle();
    const goals = (await rows(live.log)).filter((row) => row.kind === 'goal');
    expect(goals).toHaveLength(2);
    expect(goals.every((row) => row.state === 'rejected' && row.rejectReason === 'takenOver')).toBe(true);
    await expectBoard({ home: 0, away: 0 }, { contiguous: true });
  });

  it('6. 主辦把 rev 往上推，衝突後自動重試一次成功', async () => {
    let bumps = 0;
    const live = await startLive('s6', {
      beforeCommit: async (_plan, nth) => {
        if (nth === 1) {
          bumps += 1;
          await patchDoc(`competitions/${CID}/matches/${MT}`, { rev: 1 });
        }
      },
    });
    const result = await live.session.getState().actions.goal({ side: 'away' });
    expect(result.status).toBe('applied');
    expect(bumps).toBe(1);
    const ops = await goalOps(live.log);
    await expectBoard({ home: 0, away: 1 }, { ops, contiguous: false });
    expect(live.commits.length).toBe(2);
  });

  it('7. 改判第二步兩次衝突後停住，重新套用才完成', async () => {
    const live = await startLive('s7');
    expect((await live.session.getState().actions.goal({ side: 'home', plId: 'pl_h1' })).status).toBe('applied');
    let armed = true;
    let tries = 0;
    const raw = live.commits.length;
    void raw;
    live.session.stop();
    // 重新包一層已來不及；直接在現有 beforeCommit 之外，用第二個工作階段承接同一日誌。
    const log = live.log;
    const sids = live.sids;
    const next = await startLive('s7b', {
      log,
      sids,
      beforeCommit: async (plan) => {
        if (!armed || plan.event.type !== 'goal') return;
        tries += 1;
        if (tries <= 2) {
          const match = await readDoc(`competitions/${CID}/matches/${MT}`);
          await patchDoc(`competitions/${CID}/matches/${MT}`, { rev: Number(match?.rev ?? 0) + 1 });
        }
      },
    });
    const amended = await next.session.getState().actions.amend(
      { seq: 1 },
      { kind: 'goal', side: 'home', goalKind: 'penalty', matchSecond: 20, plId: 'pl_h1' },
    );
    expect(amended).toEqual({ status: 'rejected', reason: 'conflict' });
    expect(next.session.getState().groups[0]?.message).toBe(LIVE_COPY.amendHalf);
    expect(next.session.getState().fulltimeBlocked).toBe(true);
    expect((await next.session.getState().actions.fulltime()).status).toBe('rejected');
    armed = false;
    const failed = (await rows(log)).find((row) => row.state === 'rejected');
    expect((await next.session.getState().actions.reapply(failed?.op ?? '')).status).toBe('applied');
    expect(next.session.getState().fulltimeBlocked).toBe(false);
    const ops = (await rows(log)).filter((row) => row.state === 'applied').map((row) => row.op);
    await expectBoard({ home: 1, away: 0 }, { ops, contiguous: false });
  });

  it('8. 復原被引用的第一黃依序成功；第二步被拒時顯示半套', async () => {
    const live = await startLive('s8');
    await live.session.getState().actions.card({ side: 'home', plId: 'pl_h1', cardType: 'yellow' });
    await live.session.getState().actions.card({ side: 'home', plId: 'pl_h1', cardType: 'yellow' });
    const undone = await live.session.getState().actions.undoFirstYellow({ seq: 1 });
    expect(undone.status).toBe('applied');
    const events = await listCollection(`competitions/${CID}/matches/${MT}/timeline`);
    expect(events.filter((event) => event.type === 'void')).toHaveLength(2);
    expect(events.map((event) => Number(event.seq)).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    await live.release();

    await seed();
    const again = await startLive('s8b');
    await again.session.getState().actions.card({ side: 'home', plId: 'pl_h1', cardType: 'yellow' });
    await again.session.getState().actions.card({ side: 'home', plId: 'pl_h1', cardType: 'yellow' });
    again.session.stop();
    const retry = await startLive('s8c', {
      log: again.log,
      sids: again.sids,
      beforeCommit: async (plan) => {
        if (plan.event.type !== 'void') return;
        const seen = (await listCollection(`competitions/${CID}/matches/${MT}/timeline`)).filter((event) => event.type === 'void');
        if (seen.length >= 1) {
          const match = await readDoc(`competitions/${CID}/matches/${MT}`);
          await patchDoc(`competitions/${CID}/matches/${MT}`, { rev: Number(match?.rev ?? 0) + 1 });
          await patchDoc(`competitions/${CID}/matches/${MT}`, { rev: Number(match?.rev ?? 0) + 2 });
        }
      },
    });
    const half = await retry.session.getState().actions.undoFirstYellow({ seq: 1 });
    expect(half.status).toBe('rejected');
    expect(retry.session.getState().groups[0]?.message).toBe(LIVE_COPY.undoHalf);
  });

  it('9. 恢復連線不重整，原寫入與對帳只留下一筆', async () => {
    // 證明真的走到 reconcileInflight，而且當下有進行中的寫入（第 4 步 A：原本 notify 是空函式，這條從沒被叫到）。
    const original = Sender.prototype.reconcileInflight;
    const inflightAtReconcile: number[] = [];
    const spy = vi.spyOn(Sender.prototype, 'reconcileInflight').mockImplementation(async function reconcile(this: Sender) {
      inflightAtReconcile.push((this as unknown as { inflight: Set<string> }).inflight.size);
      return original.call(this);
    });
    try {
      const live = await startLive('s9');
      await goOffline(live);
      const queued = await live.session.getState().actions.goal({ side: 'home', plId: 'pl_h1' });
      expect(queued.status).toBe('queued');
      await waitUntil('寫入進 SDK 佇列', async () => (await rows(live.log)).some((row) => row.state === 'sending'));
      const ops = await goalOps(live.log);
      await goOnline(live);
      await live.session.whenIdle();
      await expectBoard({ home: 1, away: 0 }, { ops, contiguous: true });
      expect(live.commits).toHaveLength(1);
      expect(spy).toHaveBeenCalled();
      expect(inflightAtReconcile.some((size) => size >= 1)).toBe(true);
      await waitUntil('日誌標 applied', async () => (await rows(live.log)).every((row) => row.state === 'applied'));
    } finally {
      spy.mockRestore();
    }
  });

  it('10. 對帳之後原寫入才落地，同一個 seq 只成功一次', async () => {
    const log = new MemoryActionLog();
    const sids = memorySidStore();
    await sids.set(CID, MT, UID, SID);
    const oldPage = await startLive('s10a', { log, sids });
    await goOffline(oldPage);
    await oldPage.session.getState().actions.goal({ side: 'away' });
    await waitUntil('舊頁已取號', async () => (await rows(log)).some((row) => row.seq != null));
    const ops = await goalOps(log);
    const fresh = await startLive('s10b', { log, sids });
    await fresh.session.whenIdle();
    await goOnline(oldPage);
    await oldPage.session.whenIdle();
    await fresh.session.whenIdle();
    await expectBoard({ home: 0, away: 1 }, { ops, contiguous: true });
  });

  it('11. 只加 rev 的拒絕依 S2 換號重送，意圖只留一次', async () => {
    let bumped = false;
    const live = await startLive('s11', {
      beforeCommit: async () => {
        if (bumped) return;
        bumped = true;
        await patchDoc(`competitions/${CID}/matches/${MT}`, { rev: 1 });
      },
    });
    const result = await live.session.getState().actions.goal({ side: 'home' });
    expect(result.status).toBe('applied');
    const ops = await goalOps(live.log);
    await expectBoard({ home: 1, away: 0 }, { ops, contiguous: false });
    const events = await listCollection(`competitions/${CID}/matches/${MT}/timeline`);
    expect(events).toHaveLength(1);
    expect(Number(events[0]?.seq)).toBeGreaterThan(1);
  });

  it('12. 離線兩筆後主辦重置，恢復並重新接手，兩筆都丟棄', async () => {
    const live = await startLive('s12');
    await goOffline(live);
    const first = await live.session.getState().actions.goal({ side: 'home' });
    const second = await live.session.getState().actions.goal({ side: 'away' });
    expect(first.status).toBe('queued');
    expect(second.status).toBe('queued');
    const ops = await goalOps(live.log);
    expect(ops).toHaveLength(2);
    const line = await hostReset();
    await goOnline(live);
    await live.session.whenIdle();
    const taken = await live.session.getState().actions.takeover();
    expect(taken.status).toBe('applied');
    await live.session.whenIdle();
    await waitUntil('重置後兩筆都丟棄', async () => {
      const goals = (await rows(live.log)).filter((row) => row.kind === 'goal');
      return goals.length === 2 && goals.every((row) => row.state === 'discarded' && row.rejectReason === 'reset');
    }, 80);
    const sent = live.commits.length;
    await live.session.whenIdle();
    expect(live.commits).toHaveLength(sent);
    const events = await listCollection(`competitions/${CID}/matches/${MT}/timeline`);
    const above = events.filter((event) => Number(event.seq) > line);
    for (const op of ops) expect(above.some((event) => event.op === op)).toBe(false);
    const match = await readDoc(`competitions/${CID}/matches/${MT}`);
    expect(match?.score).toEqual({ home: 0, away: 0 });
    expect(Number(match?.resetRev)).toBe(line);
  });

  it('13. 送出成功但回應遺失，主辦重置後恢復且不重送', async () => {
    let line = 0;
    const live = await startLive('s13', {
      afterCommit: async (_plan, nth) => {
        if (nth !== 1) return;
        line = await hostReset();
        throw { code: 'unavailable' };
      },
    });
    const result = await live.session.getState().actions.goal({ side: 'home' });
    expect(live.commits).toHaveLength(1);
    await live.session.whenIdle();
    await waitUntil('遺失回應後標成重置丟棄', async () => {
      const goals = (await rows(live.log)).filter((row) => row.kind === 'goal');
      return goals.length === 1 && goals[0]?.state === 'discarded' && goals[0]?.rejectReason === 'reset';
    }, 80);
    // 回應遺失後重讀場次可能讀到本機監聽的舊快照（主辦重置還沒到），先判成 applied；
    // 監聽追上後由 discardStale 改成 discarded。中間回報 applied 或 queued 都可以，不可以是被拒（顧問 §3.810）。
    expect(['queued', 'applied']).toContain(result.status);
    const op = (await goalOps(live.log))[0];
    const events = await listCollection(`competitions/${CID}/matches/${MT}/timeline`);
    expect(events.some((event) => event.op === op && Number(event.seq) <= line)).toBe(true);
    expect(events.some((event) => event.op === op && Number(event.seq) > line)).toBe(false);
    expect(live.commits).toHaveLength(1);
    // 收尾再送一輪也不重送（比照第 12 條）。
    await live.session.whenIdle();
    expect(live.commits).toHaveLength(1);
    // 比分以伺服器為準：伺服器 0:0、resetRev 是重置線；畫面也回到 0:0、沒有待送。
    const match = await readDoc(`competitions/${CID}/matches/${MT}`);
    expect(match?.score).toEqual({ home: 0, away: 0 });
    expect(Number(match?.resetRev)).toBe(line);
    await waitUntil('畫面比分回到伺服器 0:0', () => {
      const score = live.session.getState().score;
      return score.home === 0 && score.away === 0 && score.pendingCount === 0;
    }, 80);
  });

  it('14. 隱藏期間另一裝置進球，恢復可見後作廢成功', async () => {
    let trips = 0;
    const log = new ResilientActionLog(new MemoryActionLog(), () => { trips += 1; });
    const sids = memorySidStore();
    await sids.set(CID, MT, UID, SID);
    const visible = { value: true };
    const first = await startLive('s14a', { log, sids, visible });
    visible.value = false;
    first.notifyVisible();
    const other = await startLive('s14b', { sids });
    expect((await other.session.getState().actions.goal({ side: 'home' })).status).toBe('applied');
    await expectBoard({ home: 1, away: 0 });
    visible.value = true;
    first.notifyVisible();
    await waitUntil('恢復可見後看得到那一球', () => {
      const state = first.session.getState();
      return state.events.some((event) => event.type === 'goal') && (state.match?.rev ?? 0) >= 1;
    }, 80);
    const goal = first.session.getState().events.find((event) => event.type === 'goal');
    expect(goal?.seq).toBeGreaterThan(0);
    expect((await first.session.getState().actions.voidEvent({ seq: goal?.seq })).status).toBe('applied');
    await expectBoard({ home: 0, away: 0 });
    expect(trips).toBe(0);
    const stored = await rows(log);
    expect(stored.some((row) => row.kind === 'void' && row.state === 'applied')).toBe(true);
  });

  it('15. 停錶型暫停會停錶，再按繼續計時', async () => {
    await patchDoc(`competitions/${CID}/matches/${MT}`, {
      status: 'live',
      clockBase: {
        startedAt: new Ts(new Date(Date.now() - 4000).toISOString()),
        pausedSec: 40,
        running: true,
        period: 'h2',
      },
    });
    const live = await startLive('s15');
    expect((await live.session.getState().actions.timeout({ side: 'home' })).status).toBe('applied');
    const match = await readDoc(`competitions/${CID}/matches/${MT}`);
    const clock = (match?.clockBase ?? {}) as { running?: boolean; period?: string; pausedSec?: number; startedAt?: unknown };
    expect(clock.running).toBe(false);
    expect(clock.period).toBe('h2');
    expect(Number(clock.pausedSec)).toBeGreaterThanOrEqual(40);
    expect(clock.startedAt).toBeTruthy();
    const events = await listCollection(`competitions/${CID}/matches/${MT}/timeline`);
    const timeout = events.find((event) => event.type === 'timeout');
    expect(timeout?.side).toBe('home');
    expect(timeout).not.toHaveProperty('stopClock');
    expect((await live.session.getState().actions.resumeClock()).status).toBe('applied');
    const after = await readDoc(`competitions/${CID}/matches/${MT}`);
    const next = (after?.clockBase ?? {}) as { running?: boolean; period?: string };
    expect(next.running).toBe(true);
    expect(next.period).toBe('h2');
  });

  it('16. 不停錶的暫停只寫事件', async () => {
    await createDoc(`competitions/${CID}/divisions`, 'dv1', {
      rules: {
        timeout: { enabled: true, per: 'match', count: 2, seconds: 90, stopsClock: false },
      },
    });
    const live = await startLive('s16');
    const before = await readDoc(`competitions/${CID}/matches/${MT}`);
    const beforeClock = before?.clockBase;
    expect((await live.session.getState().actions.timeout({ side: 'away' })).status).toBe('applied');
    const match = await readDoc(`competitions/${CID}/matches/${MT}`);
    expect(match?.clockBase).toEqual(beforeClock);
    const events = await listCollection(`competitions/${CID}/matches/${MT}/timeline`);
    expect(events.filter((event) => event.type === 'timeout')).toHaveLength(1);
    expect(events[0]?.side).toBe('away');
  });

  it('17. pkStart、進、沒進、作廢進的那腳', async () => {
    await patchDoc(`competitions/${CID}/matches/${MT}`, {
      status: 'live',
      score: { home: 1, away: 1 },
      clockBase: { startedAt: null, pausedSec: 2700, running: false, period: 'h2' },
      penaltyScore: null,
    });
    const live = await startLive('s17');
    const actions = live.session.getState().actions;
    expect((await actions.pkStart()).status).toBe('applied');
    expect((await actions.pk({ side: 'home', scored: true, plId: 'pl_h1' })).status).toBe('applied');
    expect((await actions.pk({ side: 'away', scored: false })).status).toBe('applied');
    const scored = (await rows(live.log)).find((row) => row.kind === 'pk' && row.intent.kind === 'pk' && row.intent.scored);
    expect(scored?.seq).toBeGreaterThan(0);
    expect((await live.session.getState().actions.voidEvent({ seq: scored?.seq })).status).toBe('applied');
    const match = await readDoc(`competitions/${CID}/matches/${MT}`);
    expect(match?.penaltyScore).toEqual({ home: 0, away: 0 });
    expect(match?.score).toEqual({ home: 1, away: 1 });
    expect((match?.clockBase as { period?: string } | undefined)?.period).toBe('pk');
  });

  it('18. PK 期間一般進球與作廢一般進球不寫入', async () => {
    await patchDoc(`competitions/${CID}/matches/${MT}`, {
      rev: 2,
      status: 'live',
      score: { home: 1, away: 1 },
      clockBase: { startedAt: null, pausedSec: 2700, running: false, period: 'h2' },
      penaltyScore: null,
    });
    const stamp = new Ts('2026-01-01T00:00:00.000Z');
    await createDoc(`competitions/${CID}/matches/${MT}/timeline`, 'e1', {
      seq: 1, type: 'goal', side: 'home', goalKind: 'normal', plId: 'pl_h1', matchSecond: 10,
      createdAt: stamp, sid: SID, op: 'goalhomeopgoalhome01',
    });
    await createDoc(`competitions/${CID}/matches/${MT}/timeline`, 'e2', {
      seq: 2, type: 'goal', side: 'away', goalKind: 'normal', plId: 'pl_a1', matchSecond: 20,
      createdAt: stamp, sid: SID, op: 'goalawayopgoalaway01',
    });
    const live = await startLive('s18');
    expect(live.session.getState().events.some((event) => event.type === 'goal' && event.seq === 1)).toBe(true);
    expect((await live.session.getState().actions.pkStart()).status).toBe('applied');
    const commits = live.commits.length;
    const timeline = (await listCollection(`competitions/${CID}/matches/${MT}/timeline`)).length;
    expect(await live.session.getState().actions.goal({ side: 'home' })).toEqual({ status: 'rejected', reason: 'rules' });
    expect(await live.session.getState().actions.voidEvent({ seq: 1 })).toEqual({ status: 'rejected', reason: 'rules' });
    expect(live.commits).toHaveLength(commits);
    expect(await listCollection(`competitions/${CID}/matches/${MT}/timeline`)).toHaveLength(timeline);
    const logged = await rows(live.log);
    expect(logged.some((row) => row.kind === 'goal' || row.kind === 'void')).toBe(false);
  });

  it('20. 換人（CP-PO-07）：進行中與中場都寫入、比分不變；換人不能作廢', async () => {
    const live = await startLive('s20');
    const before = await readDoc(`competitions/${CID}/matches/${MT}`);
    expect((await live.session.getState().actions.sub({ side: 'home', outPlId: 'pl_h1', inPlId: 'pl_h2' })).status).toBe('applied');
    let events = await listCollection(`competitions/${CID}/matches/${MT}/timeline`);
    const sub = events.find((event) => event.type === 'sub');
    expect(sub).toMatchObject({ side: 'home', outPlId: 'pl_h1', inPlId: 'pl_h2' });
    const after = await readDoc(`competitions/${CID}/matches/${MT}`);
    expect(after?.score).toEqual(before?.score);
    expect((await live.session.getState().actions.halftime()).status).toBe('applied');
    expect((await live.session.getState().actions.sub({ side: 'away', outPlId: 'pl_a1', inPlId: 'pl_a2' })).status).toBe('applied');
    events = await listCollection(`competitions/${CID}/matches/${MT}/timeline`);
    expect(events.filter((event) => event.type === 'sub')).toHaveLength(2);
    // Rules 只允許作廢進球或牌：作廢換人會被伺服器拒絕，沒有任何寫入（畫面上換人列本來就不能點開）。
    const timelineBefore = (await listCollection(`competitions/${CID}/matches/${MT}/timeline`)).length;
    expect((await live.session.getState().actions.voidEvent({ seq: sub?.seq as number })).status).toBe('rejected');
    expect(await listCollection(`competitions/${CID}/matches/${MT}/timeline`)).toHaveLength(timelineBefore);
    expect(await listCollection(`competitions/${CID}/matches/${MT}/voids`)).toHaveLength(0);
  });

  it('19. 正規比分不平手時 pkStart 不產生', async () => {
    await patchDoc(`competitions/${CID}/matches/${MT}`, {
      status: 'live',
      score: { home: 1, away: 0 },
      clockBase: { startedAt: null, pausedSec: 100, running: false, period: 'h2' },
      penaltyScore: null,
    });
    const live = await startLive('s19');
    expect(await live.session.getState().actions.pkStart()).toEqual({ status: 'rejected', reason: 'rules' });
    expect(live.commits).toHaveLength(0);
    const events = await listCollection(`competitions/${CID}/matches/${MT}/timeline`);
    expect(events.some((event) => event.type === 'pkStart')).toBe(false);
    expect(await rows(live.log)).toHaveLength(0);
  });

  // S2：ScorePad 復原、改判兩張黃牌時，原本 adapter 連呼兩次 voidEvent（不等結果）。同一毫秒建立的兩筆，
  // IndexedDB 依 op 出列；後建的第一黃作廢 op 較小時排到前面，第二黃還沒作廢就被 Rules 拒、佇列停住。
  // 修正後走工作階段的原子群組（at + index），與 op 字典序無關。這裡固定讓後建的 op 較小
  // （base64url 首字元 'A'(65) < 'E'(69) < '_'(95) < 'g'(103)）。
  async function twoYellows(): Promise<void> {
    const live = await startLive('s2pre');
    await live.session.getState().actions.card({ side: 'home', plId: 'pl_h1', cardType: 'yellow' });
    await live.session.getState().actions.card({ side: 'home', plId: 'pl_h1', cardType: 'yellow' });
    await live.release();
    opened.length = 0;
  }
  async function settled(log: ActionLog, count: number): Promise<LogEntry[]> {
    await waitUntil('都送完或停住', async () => {
      const logged = await rows(log);
      return logged.length === count && logged.every((row) => row.state === 'applied' || row.state === 'rejected');
    }, 200).catch(() => {});
    return rows(log);
  }

  it('20. 復原兩張黃牌：同毫秒、op 反序仍依序送出', async () => {
    await twoYellows();
    const at = Date.now();
    const ops = fillQueue();
    const s = await startLive('s20', { log: new OpOrderedLog(), now: () => at, randomBytes: ops.bytes });
    await waitUntil('兩張黃牌已載入', () => s.session.getState().events.length >= 2, 200);
    const props = scorePadPropsFrom(s.session.getState(), at);
    // 依取號順序遞減：'g' > '_' > 'E' > 'A'。不論走群組（先取群組 id）還是改回逐筆送，後建的 op 都比較小。
    ops.arm([0x80, 0xff, 0x11, 0x00]);
    expect(props.onUndoPair?.(1)).toBe(true);
    const logged = await settled(s.log, 2);
    expect(logged.map((row) => row.state)).toEqual(['applied', 'applied']);
    expect(s.commits.map((plan) => (plan.event as { targetSeq?: number }).targetSeq)).toEqual([2, 1]);
    expect(await listCollection(`competitions/${CID}/matches/${MT}/voids`)).toHaveLength(2);
  });

  it('21. 改判被引用的第一黃為紅牌：三筆同毫秒、op 反序仍依序送出', async () => {
    await twoYellows();
    const at = Date.now();
    const ops = fillQueue();
    const s = await startLive('s21', { log: new OpOrderedLog(), now: () => at, randomBytes: ops.bytes });
    await waitUntil('兩張黃牌已載入', () => s.session.getState().events.length >= 2, 200);
    const props = scorePadPropsFrom(s.session.getState(), at);
    // 同上：取號順序遞減，與建立序相反。
    ops.arm([0x80, 0xff, 0x11, 0x00]);
    expect(props.onAmend?.(1, {
      side: 'home', action: 'red', plId: 'pl_h1', goalKind: null, minute: 0, refSeq: null, matchSecond: 30,
    })).toBe(true);
    const logged = await settled(s.log, 3);
    expect(logged.map((row) => row.state)).toEqual(['applied', 'applied', 'applied']);
    expect(s.commits.map((plan) => plan.event.type)).toEqual(['void', 'void', 'card']);
    const events = await listCollection(`competitions/${CID}/matches/${MT}/timeline`);
    expect(events.find((event) => Number(event.seq) === 5)).toMatchObject({ type: 'card', cardType: 'red', matchSecond: 30 });
  });

  it('22. 離線先記一張待送黃牌，再把別的牌改判成同一人黃牌：寫成第二黃', async () => {
    const live = await startLive('s22');
    await live.session.getState().actions.card({ side: 'home', plId: 'pl_h2', cardType: 'red' });
    await waitUntil('紅牌已載入', () => live.session.getState().events.length >= 1, 200);
    await goOffline(live);
    await live.session.getState().actions.card({ side: 'home', plId: 'pl_h1', cardType: 'yellow' });
    const props = scorePadPropsFrom(live.session.getState(), Date.now());
    expect(props.onAmend?.(1, {
      side: 'home', action: 'yellow', plId: 'pl_h1', goalKind: null, minute: 0, refSeq: null, matchSecond: 40,
    })).toBe(true);
    await waitUntil('改判已排入', async () => (await rows(live.log)).length === 3, 200);
    const queued = (await rows(live.log)).find((row) => row.group && row.intent.kind === 'card');
    expect(queued?.intent).toMatchObject({ kind: 'card', cardType: 'second_yellow', plId: 'pl_h1' });
    await goOnline(live);
    await waitUntil('三筆都送完', async () => (await rows(live.log)).every((row) => row.state === 'applied'), 200);
    const events = await listCollection(`competitions/${CID}/matches/${MT}/timeline`);
    const yellow = events.find((event) => event.cardType === 'yellow');
    const second = events.find((event) => event.cardType === 'second_yellow');
    expect(second).toMatchObject({ plId: 'pl_h1', refSeq: Number(yellow?.seq), matchSecond: 40 });
    expect(await listCollection(`competitions/${CID}/matches/${MT}/voids`)).toHaveLength(1);
  });

  // S2 審查 P3（顧問 §3.863）：審查只有推論、沒有測試的三種改判情境。
  async function redThenYellow(name: string): Promise<Live> {
    const live = await startLive(name);
    await live.session.getState().actions.card({ side: 'home', plId: 'pl_h2', cardType: 'red' });
    await live.session.getState().actions.card({ side: 'home', plId: 'pl_h1', cardType: 'yellow' });
    await waitUntil('兩張牌已載入', () => live.session.getState().events.length >= 2, 200);
    return live;
  }
  const yellowPick = (plId: string, matchSecond: number) => ({
    side: 'home' as const, action: 'yellow' as const, plId, goalKind: null, minute: 0, refSeq: null, matchSecond,
  });
  async function openRows(live: Live): Promise<LogEntry[]> {
    return (await rows(live.log)).filter((row) => row.state !== 'applied' && row.state !== 'discarded');
  }
  async function allApplied(live: Live): Promise<void> {
    await waitUntil('都送完', async () => (await openRows(live)).length === 0, 200);
  }

  it('23. 黃牌的作廢還在待送，把別的牌改判成同一人黃牌：寫成普通黃牌，不被拒', async () => {
    const live = await redThenYellow('s23');
    await goOffline(live);
    expect(scorePadPropsFrom(live.session.getState(), Date.now()).onUndo?.(2)).toBe(true);
    await waitUntil('作廢已排入', async () => (await openRows(live)).length === 1, 200);
    expect(scorePadPropsFrom(live.session.getState(), Date.now()).onAmend?.(1, yellowPick('pl_h1', 50))).toBe(true);
    await waitUntil('改判已排入', async () => (await openRows(live)).length === 3, 200);
    const queued = (await rows(live.log)).find((row) => row.group && row.intent.kind === 'card');
    expect(queued?.intent).toMatchObject({ kind: 'card', cardType: 'yellow', plId: 'pl_h1' });
    expect(queued?.intent).not.toHaveProperty('refSeq');
    await goOnline(live);
    await allApplied(live);
    const events = await listCollection(`competitions/${CID}/matches/${MT}/timeline`);
    expect(events.find((event) => Number(event.seq) === 5)).toMatchObject({ type: 'card', cardType: 'yellow', plId: 'pl_h1' });
    expect(await listCollection(`competitions/${CID}/matches/${MT}/voids`)).toHaveLength(2);
  });

  it('24. 已有待送第二黃指向那張黃牌，把別的牌改判成同一人黃牌：寫成普通黃牌，不被拒', async () => {
    const live = await redThenYellow('s24');
    await goOffline(live);
    await live.session.getState().actions.card({ side: 'home', plId: 'pl_h1', cardType: 'yellow' });
    await waitUntil('第二黃已排入', async () => (await openRows(live)).length === 1, 200);
    const pendingSecond = (await openRows(live))[0];
    expect(pendingSecond?.intent).toMatchObject({ cardType: 'second_yellow', refSeq: 2 });
    expect(scorePadPropsFrom(live.session.getState(), Date.now()).onAmend?.(1, yellowPick('pl_h1', 50))).toBe(true);
    await waitUntil('改判已排入', async () => (await openRows(live)).length === 3, 200);
    const queued = (await rows(live.log)).find((row) => row.group && row.intent.kind === 'card');
    expect(queued?.intent).toMatchObject({ kind: 'card', cardType: 'yellow', plId: 'pl_h1' });
    await goOnline(live);
    await allApplied(live);
    const events = await listCollection(`competitions/${CID}/matches/${MT}/timeline`);
    expect(events.filter((event) => event.cardType === 'second_yellow')).toHaveLength(1);
    expect(events.find((event) => Number(event.seq) === 5)).toMatchObject({ type: 'card', cardType: 'yellow', plId: 'pl_h1' });
  });

  it('25. 改判第二黃本身（同一人仍判黃）：寫成第二黃指向第一黃，連結改指新的這張', async () => {
    const live = await startLive('s25');
    await live.session.getState().actions.card({ side: 'home', plId: 'pl_h1', cardType: 'yellow' });
    await live.session.getState().actions.card({ side: 'home', plId: 'pl_h1', cardType: 'yellow' });
    await waitUntil('兩張黃牌已載入', () => live.session.getState().events.length >= 2, 200);
    expect(scorePadPropsFrom(live.session.getState(), Date.now()).onAmend?.(2, yellowPick('pl_h1', 70))).toBe(true);
    await waitUntil('改判已送完', async () => {
      const logged = (await rows(live.log)).filter((row) => row.group);
      return logged.length === 2 && logged.every((row) => row.state === 'applied' || row.state === 'rejected');
    }, 200);
    expect((await rows(live.log)).filter((row) => row.group).map((row) => row.state)).toEqual(['applied', 'applied']);
    const events = await listCollection(`competitions/${CID}/matches/${MT}/timeline`);
    expect(events.find((event) => Number(event.seq) === 4)).toMatchObject({ type: 'card', cardType: 'second_yellow', refSeq: 1, matchSecond: 70 });
    expect(await readDoc(`competitions/${CID}/matches/${MT}/cardLinks/1`)).toMatchObject({ seq: 4 });
  });
});
