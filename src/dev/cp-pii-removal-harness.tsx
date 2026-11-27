// 「移除我的賽事資料」預覽 harness（設計 §4.11，只給本機截圖，不參與正式 build）。
// 正式 InAppSection＋記憶體假資料：不連 Firestore、不呼叫 Functions。移除動作換成假的：
// ?mode=done（立刻完成，我的清單清空）| waiting（2 場等待，3 筆 waiting）| rate（REMOVAL_RATE_LIMITED）| busy（一直不回）
// ?theme=light|dark。畫完設 window.__CPS_READY；點擊流程由截圖腳本操作。
import { render } from 'preact';
import { LocationProvider } from 'preact-iso';
import '../styles/legacy-vars.css';
import '../styles/tokens.css';
import '../styles/base.css';
import '@/styles/category-tokens.css';
import '@/ui/app-shell.css';
import '@/features/tournaments/tournaments.css';
import '@/features/tournaments/list-v2.css';
import './cp-step3-real-harness.css';
import { setLocale } from '@/i18n/i18n';
import { AppConfirmHost } from '@/ui/AppConfirm';
import { ToastHost } from '@/ui/ToastHost';
import { InAppSection } from '@/features/competitions/components/InAppSection';
import { CpCallError, type CpDataRemovalResult } from '@/features/competitions/data/cp-callables';
import type { CpMineItem } from '@/features/competitions/data/types';
import { CpEnvProvider, type CpInjectedEnv } from '@/features/competitions/env';
import { taipeiMs } from '@/features/competitions/format';
import { loadCompetitionsDict } from '@/features/competitions/i18n';
import { createFakeCpRepo } from '@/features/competitions/testing/fake-cp-repo';
import { NOW, competition, idleActions, memberActor } from '@/features/competitions/testing/screen-fixtures';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') || 'done';
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.setAttribute('data-theme', theme);

const MINE: CpMineItem[] = [
  { id: 'live_cup', cid: 'live_cup', roles: ['player'], host: false, name: '示範盃五人制足球賽', category: 'cup' },
  { id: 'warm_lg', cid: 'warm_lg', roles: ['rep'], host: false, name: '冬季聯賽', category: 'league' },
];
let removed = false;

const repo = createFakeCpRepo({
  launch: { isPublic: true, bannedWords: [] },
  mine: { uid_member: MINE },
  competitions: [
    competition({
      id: 'live_cup', name: '示範盃五人制足球賽', category: 'cup', hostType: 'personal', hostTeamId: null, feeNote: null,
      regCloseAt: taipeiMs(2026, 12, 1, 23, 59), firstMatchAt: NOW - 60 * 60 * 1000, lastMatchAt: NOW + 2 * 24 * 60 * 60 * 1000,
      venues: [{ name: '示範運動公園' }],
    }),
    competition({
      id: 'warm_lg', name: '冬季聯賽', category: 'league', hostType: 'personal', hostTeamId: null, feeNote: null,
      regCloseAt: taipeiMs(2026, 12, 9, 23, 59), firstMatchAt: taipeiMs(2026, 12, 13, 9, 0), lastMatchAt: taipeiMs(2026, 12, 14, 18, 0),
      venues: [{ name: '河濱足球場' }],
    }),
    competition({ id: 'rec_fr', name: '新春迎新友誼賽', category: 'friendly', hostType: 'personal', hostTeamId: null, feeNote: null, venues: [{ name: '示範國小' }] }),
  ],
});
// 移除完成後，我的清單讀回空的（模擬伺服器已移除）。
const listMine = repo.listMine.bind(repo);
repo.listMine = async (uid: string) => (removed ? [] : listMine(uid));

const RESULTS: Record<string, () => Promise<CpDataRemovalResult>> = {
  done: async () => {
    removed = true;
    return { status: 'done', processed: 2, waiting: [] };
  },
  waiting: async () => ({
    status: 'waiting',
    processed: 1,
    waiting: [
      { cid: 'warm_lg', reason: 'STAFF_ACTIVE' },
      { cid: 'warm_lg', reason: 'COMPETITION_NOT_ENDED' },
      { cid: 'live_cup', reason: 'COMPETITION_NOT_ENDED' },
    ],
  }),
  rate: async () => {
    throw new CpCallError('REMOVAL_RATE_LIMITED', {});
  },
  busy: () => new Promise<CpDataRemovalResult>(() => {}),
};

const env: CpInjectedEnv = {
  actor: memberActor,
  repo,
  actions: { ...idleActions(), requestMyDataRemoval: RESULTS[mode] ?? RESULTS.done! },
  now: NOW,
};

void start();

async function start(): Promise<void> {
  const win = window as unknown as { __CPS_READY?: boolean; __CPS_ERROR?: string };
  try {
    await setLocale('zh-TW');
    await loadCompetitionsDict('zh-TW');
    const root = document.getElementById('app');
    if (!root) return;
    render(
      <LocationProvider>
        <div class="app-shell ui-app-shell">
          <main class="app-main">
            <CpEnvProvider value={env}>
              <div class="legacy-ui tournaments-root" data-d2="1">
                <section class="page active tc-page" id="page-tournaments">
                  <div class="cpl-panel" role="tabpanel">
                    <InAppSection tab="all" active />
                  </div>
                </section>
              </div>
            </CpEnvProvider>
          </main>
        </div>
        <ToastHost />
        <AppConfirmHost />
      </LocationProvider>,
      root,
    );
    const t0 = Date.now();
    while (!document.querySelector('[data-cid]')) {
      if (Date.now() - t0 > 6000) throw new Error('站內清單未出現');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    win.__CPS_READY = true;
  } catch (err) {
    win.__CPS_ERROR = err instanceof Error ? err.message : String(err);
  }
}
