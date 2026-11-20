// 第 4 步 A（資料正確性，顧問 11-20）重現：讀到 SDK 本機未送寫入（hasPendingWrites）造成的誤判。
// 共用設定照抄 scoring.emu.test.ts（未匯出），只改 describe 名稱與情境。目前會紅的用 it.fails 鎖住，修好後改回 it。
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
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LIVE_COPY } from '../copy';
import { MemoryActionLog, ResilientActionLog, type ActionLog } from './action-log';
import { createFirestoreBackend } from './live-repo';
import { createScoringSession, type ScoringSession } from './session';
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
const PORT = 8402;

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
  expect(hash.slice(0, 16)).toBe('99a8cafef181e8e0');
  if (!rulesBackup) rulesBackup = readFileSync(RULES_TARGET);
  writeFileSync(RULES_TARGET, content);
}

function restoreStartupRules(): void {
  if (!rulesBackup) return;
  writeFileSync(RULES_TARGET, rulesBackup);
  rulesBackup = null;
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
    // scoring.emu.test.ts 這裡直接放 notify，拿到的是 start() 前的空函式，watchOnline 回呼從沒被叫到（test 9 沒測到 reconcileInflight）。改成延遲取值。
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

describe.skipIf(!EMU)('記分模擬器：本機未送寫入', { timeout: 60000 }, () => {
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
    const restored = readFileSync(RULES_TARGET).toString('utf8');
    for (let i = 0; i < 25; i += 1) {
      try {
        const res = await fetch(`http://${HOST}:${PORT}/emulator/v1/projects/${PROJECT}:securityRules`);
        const text = await res.text();
        if (res.ok && text.includes(restored.slice(0, 60))) return;
      } catch { /* 模擬器還在套用 */ }
      await new Promise((resolve) => { setTimeout(resolve, 200); });
    }
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

  const pause = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms); });

  /** 瀏覽器先發 online 事件、Firestore 還沒連上：工作階段開始對帳，但 SDK 仍離線（讀快取＋本機未送寫入）。 */
  async function browserOnlineFirst(live: Live): Promise<void> {
    live.online.value = true;
    live.notify(true);
    await pause(400);
  }

  async function seedHalftime(): Promise<void> {
    await patchDoc(`competitions/${CID}/matches/${MT}`, {
      status: 'halftime',
      clockBase: { startedAt: null, pausedSec: 1500, running: false, period: 'ht' },
    });
  }

  function brief(live: Live) {
    const view = live.session.getState();
    return {
      phase: view.phase,
      liveStatus: view.liveStatus,
      period: view.clock.period,
      matchStatus: view.match?.status,
      score: { home: view.score.home, away: view.score.away },
      pending: view.score.pendingCount,
      events: view.events.map((event) => `${event.seq}:${event.type}:${event.side ?? ''}`),
      needsTakeover: view.control.needsTakeover,
    };
  }

  // P2-1（接手版）：對帳讀到自己還沒送達的寫入，誤標 applied；之後伺服器以 takenOver 退回，catch 看到 applied 直接吞掉。
  it.fails('A1. 對帳在 SDK 未連線時讀到本機未送寫入，不得標 applied（之後被接手應為 rejected）', async () => {
    const live = await startLive('a1');
    await goOffline(live);
    expect((await live.session.getState().actions.goal({ side: 'home', plId: 'pl_h1' })).status).toBe('queued');
    await waitUntil('寫入進 SDK 佇列', async () => (await rows(live.log)).some((row) => row.state === 'sending'));
    await browserOnlineFirst(live);
    const afterReconcile = (await rows(live.log)).find((row) => row.kind === 'goal');
    console.log('[A1] 對帳後日誌狀態', afterReconcile?.state, afterReconcile?.seq);
    await patchDoc(`competitions/${CID}/matches/${MT}/control/scorer`, { uid: UID, sid: 'other-device-sid-000002' });
    await enableNetwork(live.db);
    await live.session.whenIdle();
    await pause(300);
    const goal = (await rows(live.log)).find((row) => row.kind === 'goal');
    console.log('[A1] 結束日誌', goal?.state, goal?.rejectReason, JSON.stringify(brief(live)));
    await expectBoard({ home: 0, away: 0 }, { contiguous: true });
    expect(afterReconcile?.state).not.toBe('applied');
    expect(goal?.state).toBe('rejected');
    expect(goal?.rejectReason).toBe('takenOver');
  });

  // P2-1（衝突版，即「一球消失」）：離線期間主辦 Callable 只加 rev。原寫入衝突被拒，但日誌已被對帳標 applied，不會換號重送。
  it.fails('A2. 對帳誤判 applied 後原寫入衝突被拒：伺服器應仍記到這一球', async () => {
    const live = await startLive('a2');
    await goOffline(live);
    await live.session.getState().actions.goal({ side: 'home', plId: 'pl_h1' });
    await waitUntil('寫入進 SDK 佇列', async () => (await rows(live.log)).some((row) => row.state === 'sending'));
    const ops = await goalOps(live.log);
    await browserOnlineFirst(live);
    await patchDoc(`competitions/${CID}/matches/${MT}`, { rev: 1 });
    await enableNetwork(live.db);
    await live.session.whenIdle();
    await live.session.getState().actions.discard('noop-flush-trigger');
    await live.session.whenIdle();
    await pause(300);
    const goal = (await rows(live.log)).find((row) => row.kind === 'goal');
    const server = await readDoc(`competitions/${CID}/matches/${MT}`);
    console.log('[A2] 結束', goal?.state, goal?.seq, 'server', JSON.stringify(server?.score), 'rev', server?.rev, JSON.stringify(brief(live)));
    await expectBoard({ home: 1, away: 0 }, { ops, contiguous: false });
  });

  // P2-2：被拒後事件列仍留著本機未送那筆（監聽 readTimeline 讀到 hasPendingWrites 文件、maxSeq 已越過）。
  // 另一裝置之後在同一個 seq 記的事件也讀不到。
  it.fails('B1. 離線一球被接手退回後，事件列不留假事件；他機同 seq 的真事件要讀得到', async () => {
    const live = await startLive('b1');
    await goOffline(live);
    await live.session.getState().actions.goal({ side: 'home', plId: 'pl_h1' });
    await waitUntil('寫入進 SDK 佇列', async () => (await rows(live.log)).some((row) => row.state === 'sending'));
    await pause(200);
    console.log('[B1] 離線時', JSON.stringify(brief(live)));
    const other = await startLive('b1-other', { sids: memorySidStore() });
    expect((await other.session.getState().actions.takeover()).status).toBe('applied');
    await goOnline(live);
    await live.session.whenIdle();
    await waitUntil('A 收到被拒', async () => (await rows(live.log)).some((row) => row.state === 'rejected'));
    await pause(300);
    console.log('[B1] 被拒後', JSON.stringify(brief(live)));
    const rejectedView = brief(live);
    expect((await other.session.getState().actions.goal({ side: 'away', plId: 'pl_a1' })).status).toBe('applied');
    await expectBoard({ home: 0, away: 1 }, { contiguous: true });
    await pause(600);
    const after = brief(live);
    console.log('[B1] 他機記客隊後', JSON.stringify(after));
    expect(rejectedView.events).toEqual([]);
    expect(rejectedView.score).toEqual({ home: 0, away: 0 });
    expect(after.events).toEqual(['1:goal:away']);
    expect(after.score).toEqual({ home: 0, away: 1 });
  });

  // 第 3 項：兩裝置互相接手後 A 卡在「下半場開始」。
  // A 離線按下半場開始 → B 接手 → A 恢復，被拒 → A 重新接手 → 再按下半場開始：
  // 被拒那筆擋住佇列（pickNext 'rejected'），新的待送疊加成 live／h2，但 phase 看伺服器仍是 ht，按鈕留在「下半場開始」，再按被 intentForbidden 擋。
  it.fails('C1. 互相接手後再按下半場開始，phase 與疊加狀態一致（不卡在下半場開始）', async () => {
    await seedHalftime();
    const live = await startLive('c1');
    expect(live.session.getState().phase).toBe('ht');
    await goOffline(live);
    expect((await live.session.getState().actions.resume()).status).toBe('queued');
    await waitUntil('寫入進 SDK 佇列', async () => (await rows(live.log)).some((row) => row.state === 'sending'));
    const other = await startLive('c1-other', { sids: memorySidStore() });
    expect((await other.session.getState().actions.takeover()).status).toBe('applied');
    await goOnline(live);
    await live.session.whenIdle();
    await waitUntil('A 收到被拒', async () => (await rows(live.log)).some((row) => row.state === 'rejected'));
    await pause(300);
    console.log('[C1] 被拒後', JSON.stringify(brief(live)));
    const retake = await live.session.getState().actions.takeover();
    console.log('[C1] 重新接手', JSON.stringify(retake));
    const again = await live.session.getState().actions.resume();
    await pause(300);
    const stuck = brief(live);
    const third = await live.session.getState().actions.resume();
    console.log('[C1] 再按下半場開始', JSON.stringify(again), JSON.stringify(stuck), '第三次', JSON.stringify(third));
    const list = (await rows(live.log)).map((row) => `${row.kind}:${row.state}:${row.rejectReason ?? ''}`);
    console.log('[C1] 日誌', JSON.stringify(list));
    expect(stuck.phase === 'ht' && stuck.liveStatus === 'live').toBe(false);
  });

  // 第 3 項另一條路：P2-1 誤判 applied 的「下半場開始」被接手退回，applied 項目 seq > 伺服器 rev，疊加一直算 live／h2。
  it.fails('C2. 下半場開始被對帳誤判 applied 後退回：phase 與疊加狀態一致', async () => {
    await seedHalftime();
    const live = await startLive('c2');
    await goOffline(live);
    await live.session.getState().actions.resume();
    await waitUntil('寫入進 SDK 佇列', async () => (await rows(live.log)).some((row) => row.state === 'sending'));
    await browserOnlineFirst(live);
    await patchDoc(`competitions/${CID}/matches/${MT}/control/scorer`, { uid: UID, sid: 'other-device-sid-000003' });
    await enableNetwork(live.db);
    await live.session.whenIdle();
    await pause(400);
    const view = brief(live);
    const list = (await rows(live.log)).map((row) => `${row.kind}:${row.state}:${row.rejectReason ?? ''}:${row.seq ?? ''}`);
    console.log('[C2] 結束', JSON.stringify(view), JSON.stringify(list));
    expect(view.phase === 'ht' && view.liveStatus === 'live').toBe(false);
    expect(list.some((row) => row.startsWith('resume:applied'))).toBe(false);
  });

  // 第 4 項：送出中（sending）時延遲補償快照先到。全程監看畫面：比分不重複加、事件不重複、最後一致。
  it('D1. 線上記一球：sending 中本機快照先到，所有畫面都不多加也不閃回', async () => {
    const live = await startLive('d1');
    const seen: Array<ReturnType<typeof brief>> = [];
    const unsub = live.session.subscribe(() => { seen.push(brief(live)); });
    expect((await live.session.getState().actions.goal({ side: 'home', plId: 'pl_h1' })).status).toBe('applied');
    await pause(400);
    unsub();
    const homes = seen.map((item) => item.score.home);
    console.log('[D1] 畫面比分序列', JSON.stringify(homes), '事件', JSON.stringify(seen.map((item) => item.events.length)));
    expect(Math.max(...homes)).toBe(1);
    const firstOne = homes.indexOf(1);
    expect(homes.slice(firstOne).every((home) => home === 1)).toBe(true);
    for (const item of seen) expect(new Set(item.events).size).toBe(item.events.length);
    expect(brief(live).events).toEqual(['1:goal:home']);
    expect(brief(live).pending).toBe(0);
  });

  it('D2. 離線連記兩球：sending 那筆被本機快照涵蓋，畫面只多兩球；恢復後一致', async () => {
    const live = await startLive('d2');
    await goOffline(live);
    const seen: Array<ReturnType<typeof brief>> = [];
    const unsub = live.session.subscribe(() => { seen.push(brief(live)); });
    await live.session.getState().actions.goal({ side: 'home' });
    await waitUntil('寫入進 SDK 佇列', async () => (await rows(live.log)).some((row) => row.state === 'sending'));
    await live.session.getState().actions.goal({ side: 'home' });
    await pause(300);
    const offline = brief(live);
    console.log('[D2] 離線', JSON.stringify(offline), '序列', JSON.stringify(seen.map((item) => item.score.home)));
    expect(offline.score.home).toBe(2);
    expect(offline.pending).toBe(2);
    expect(Math.max(...seen.map((item) => item.score.home))).toBe(2);
    await goOnline(live);
    await live.session.whenIdle();
    await pause(400);
    unsub();
    await expectBoard({ home: 2, away: 0 }, { contiguous: true });
    expect(brief(live).score.home).toBe(2);
    expect(brief(live).pending).toBe(0);
  });
});
