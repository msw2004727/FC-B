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
  expect(hash.slice(0, 16)).toBe('68faebd1df8912d9');
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
    app, db, session, log, sids, online, notify, visible,
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
    expect(result.status).not.toBe('applied');
    const op = (await goalOps(live.log))[0];
    const events = await listCollection(`competitions/${CID}/matches/${MT}/timeline`);
    expect(events.some((event) => event.op === op && Number(event.seq) <= line)).toBe(true);
    expect(events.some((event) => event.op === op && Number(event.seq) > line)).toBe(false);
    expect(live.commits).toHaveLength(1);
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
});
