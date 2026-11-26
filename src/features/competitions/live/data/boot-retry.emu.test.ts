// G-06（顧問 §3.457）：記分頁進場時網路不通，要顯示讀取失敗、連線恢復後重新進場，佇列照常送出且不重複。
// 走 useScoring（正式記分頁用的那一層）＋真的 Firestore 後端。共用設定照抄 pending-writes.emu.test.ts（未匯出）。
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { cleanup, render } from '@testing-library/preact';
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  connectFirestoreEmulator,
  disableNetwork,
  enableNetwork,
  initializeFirestore,
  memoryLocalCache,
  type Firestore,
} from 'firebase/firestore';
import { h } from 'preact';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { useScoring, type ScoringDeps, type ScoringScreenView } from '../useScoring';
import { MemoryActionLog } from './action-log';
import { createFirestoreBackend } from './live-repo';
import { memorySidStore } from './sid';

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
  expect(hash.slice(0, 16)).toBe('99a8cafef181e8e0');
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


const READY_ROUNDS = 400;

async function waitFor(label: string, pred: () => Promise<boolean> | boolean, rounds = READY_ROUNDS): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    if (await pred()) return;
    await new Promise((resolve) => { setTimeout(resolve, 25); });
  }
  throw new Error(label);
}

describe.skipIf(!EMU)('記分模擬器：進場失敗後恢復（G-06）', { timeout: 60000 }, () => {
  let app: FirebaseApp | null = null;

  beforeAll(async () => {
    useSnapshotRules();
    await seed();
    await waitForRules();
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
    cleanup();
    if (app) await deleteApp(app);
    app = null;
  });

  it('斷線進場→讀取失敗（不是沒有權限）→連線恢復且兩個來源同時觸發→只進場一次，2 筆待送各送一次', async () => {
    app = initializeApp({ apiKey: 'demo', projectId: PROJECT, appId: 'demo-u1' }, `boot-${Date.now()}-${Math.random()}`);
    const db = initializeFirestore(app, {
      localCache: memoryLocalCache(),
      experimentalForceLongPolling: true,
      useFetchStreams: true,
    } as Parameters<typeof initializeFirestore>[1], DB);
    connectFirestoreEmulator(db, HOST, PORT);
    signIn(db, UID);
    await disableNetwork(db);

    const log = new MemoryActionLog();
    const ops = ['g06-emu-goal-0000001', 'g06-emu-goal-0000002'];
    for (const op of ops) {
      await log.put({
        op, cid: CID, mtId: MT, uid: UID, sid: SID, kind: 'goal', state: 'pending',
        createdAt: Date.now() - 2_000, attempts: 0, baseResetRev: 0,
        intent: { kind: 'goal', side: 'away', goalKind: 'normal', matchSecond: 400 },
      });
    }
    const sids = memorySidStore();
    await sids.set(CID, MT, UID, SID);
    const backend = createFirestoreBackend(db, CID, MT, UID);
    const rawOpen = backend.open.bind(backend);
    let opens = 0;
    backend.open = (listener, isVisible) => {
      opens += 1;
      return rawOpen(listener, isVisible);
    };
    const onlineCbs: Array<(next: boolean) => void> = [];
    const deps: ScoringDeps = {
      uid: UID,
      backend,
      log,
      sids,
      locks: null,
      channel: null,
      wakeRequest: null,
      tick: false,
      online: () => true,
      watchOnline: (cb) => {
        onlineCbs.push(cb);
        return () => {
          const at = onlineCbs.indexOf(cb);
          if (at >= 0) onlineCbs.splice(at, 1);
        };
      },
      visible: () => true,
      watchVisible: () => () => {},
    };
    let view: ScoringScreenView | null = null;
    function Probe(): null {
      view = useScoring(CID, MT, deps);
      return null;
    }
    render(h(Probe, {}));

    await waitFor('沒有出現讀取失敗', () => view?.loadError === 'network');
    expect(view!.loading).toBe(false);
    expect(opens).toBe(1);
    expect(await listCollection(`competitions/${CID}/matches/${MT}/timeline`)).toHaveLength(0);

    await enableNetwork(db);
    // 兩個來源同時觸發：online 事件與重試鈕。
    for (const cb of [...onlineCbs]) cb(true);
    view!.retry?.();
    await waitFor('沒有恢復進場', () => !!view && !view.loading && !view.loadError && !!view.match);
    await waitFor('待送沒有送完', async () => {
      const rows = await log.list(CID, MT);
      return rows.filter((row) => ops.includes(row.op)).every((row) => row.state === 'applied');
    });
    expect(opens).toBe(2);
    const events = await listCollection(`competitions/${CID}/matches/${MT}/timeline`);
    const sent = events.map((event) => String(event.op));
    for (const op of ops) expect(sent.filter((item) => item === op)).toHaveLength(1);
    expect(sent).toHaveLength(2);
    const match = await readDoc(`competitions/${CID}/matches/${MT}`);
    expect(match?.score).toEqual({ home: 0, away: 2 });
    expect(Number(match?.rev)).toBe(2);
    // 退避計時器（5 秒）已被成功進場取消，不會再開一次。
    await new Promise((resolve) => { setTimeout(resolve, 6_000); });
    expect(opens).toBe(2);
    expect((await listCollection(`competitions/${CID}/matches/${MT}/timeline`))).toHaveLength(2);
  });
});
