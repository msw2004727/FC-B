// 第 4 步 A（顧問 11-20 第 2 點）：真瀏覽器、正式站同款持久化快取（persistentLocalCache＋persistentMultipleTabManager）、
// IndexedDB 日誌，對本機 Firestore 模擬器（127.0.0.1，預設 8402、?port= 可換；demo- 專案）跑「離線記一球 → 重新整理 → 另一台接手 → 恢復連線」。
// 只給 dev-harness/cp-step4-a1-persist.mjs 用；不連正式環境（projectId 是 demo-，host 固定 127.0.0.1）。
import { render } from 'preact';
import { LocationProvider } from 'preact-iso';
import { initializeApp } from 'firebase/app';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';
import '../styles/tokens.css';
import '../styles/base.css';
import '@/features/competitions/live/live.css';
import { setLocale } from '@/i18n/i18n';
import { loadCompetitionsDict } from '@/features/competitions/i18n';
import { ScoringScreen } from '@/features/competitions/pages/ScoringPage';
import { IndexedDbActionLog, openScoringDatabase } from '@/features/competitions/live/data/action-log';
import { createFirestoreBackend } from '@/features/competitions/live/data/live-repo';
import { idbSidStore } from '@/features/competitions/live/data/sid';
import type { ScoringDeps } from '@/features/competitions/live/useScoring';

const PROJECT = 'demo-cp-u1';
const CID = 'comp-u1';
const MT = 'mt-u1';
const UID = 'scorer-u1';
const SID = 'emu-local-sid-0000000001';

function mockUserToken(uid: string): string {
  const pack = (value: unknown) => btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
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

/** 與模擬器測試同一套：直接換掉 SDK 的憑證提供者，送假使用者 token（模擬器接受 alg none）。 */
function signIn(db: Firestore, uid: string): void {
  const host = db as unknown as { _authCredentials?: Record<string, unknown> };
  const creds = host._authCredentials;
  if (!creds) throw new Error('Firestore 客戶端沒有 _authCredentials');
  const accessToken = mockUserToken(uid);
  const user = { uid };
  const headers = new Map<string, string>([['Authorization', `Bearer ${accessToken}`]]);
  const token = async () => ({ type: 'OAuth', accessToken, authUser: user, user, headers });
  creds.getToken = token;
  creds.forceRefresh = token;
  creds.getUser = async () => user;
  try { creds.currentUser = user; } catch { /* 唯讀 */ }
}

void start();

async function start(): Promise<void> {
  const win = window as unknown as { __A1?: unknown; __A1_READY?: boolean; __A1_ERROR?: string };
  try {
    await setLocale('zh-TW');
    await loadCompetitionsDict('zh-TW');
    const app = initializeApp({ apiKey: 'demo', projectId: PROJECT, appId: 'demo-a1' });
    const db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
    const asked = Number(new URLSearchParams(location.search).get('port') ?? 8402);
    const port = Number.isInteger(asked) && asked >= 1024 && asked <= 65535 ? asked : 8402;
    connectFirestoreEmulator(db, '127.0.0.1', port);
    signIn(db, UID);
    const idb = await openScoringDatabase(indexedDB);
    const log = new IndexedDbActionLog(async () => idb);
    const sids = idbSidStore(idb);
    if (!(await sids.get(CID, MT, UID))) await sids.set(CID, MT, UID, SID);
    const deps: ScoringDeps = {
      uid: UID,
      backend: createFirestoreBackend(db, CID, MT, UID),
      log,
      sids,
      locks: null,
      channel: null,
      wakeRequest: null,
    };
    win.__A1 = { rows: () => log.list(CID, MT) };
    const root = document.getElementById('app');
    if (!root) throw new Error('沒有 #app');
    render(
      <LocationProvider>
        <ScoringScreen cid={CID} mtId={MT} deps={deps} />
      </LocationProvider>,
      root,
    );
    win.__A1_READY = true;
  } catch (err) {
    win.__A1_ERROR = err instanceof Error ? err.message : String(err);
  }
}
