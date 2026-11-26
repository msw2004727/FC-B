// CP-PO-05／08 截圖：詳情頁「延期或取消賽事」入口與確認框、名單頁「退出」與「撤回報名」。
// 正式頁面＋記憶體假資料；不連 Firestore、不呼叫 Functions（動作全是假的）。?screen= 與 ?theme=light|dark。畫完設 window.__CPS_READY。
import { render } from 'preact';
import type { ComponentChildren } from 'preact';
import { LocationProvider } from 'preact-iso';
import '../styles/legacy-vars.css';
import '../styles/tokens.css';
import '../styles/base.css';
import '@/styles/category-tokens.css';
import '@/ui/app-shell.css';
import { setLocale } from '@/i18n/i18n';
import { AppConfirmHost } from '@/ui/AppConfirm';
import { ToastHost } from '@/ui/ToastHost';
import type { CompetitionDoc } from '@/features/competitions/data/types';
import { CpEnvProvider, type CpInjectedEnv, type CpPreview } from '@/features/competitions/env';
import { loadCompetitionsDict } from '@/features/competitions/i18n';
import CompetitionDetailPage from '@/features/competitions/pages/CompetitionDetailPage';
import RosterPage from '@/features/competitions/pages/RosterPage';
import { createFakeCpRepo } from '@/features/competitions/testing/fake-cp-repo';
import { adultDivision, hostActor, memberActor, repActor, screenEnv, youthDivision } from '@/features/competitions/testing/screen-fixtures';

const params = new URLSearchParams(location.search);
const screenName = params.get('screen') || 'detail-host';
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.setAttribute('data-theme', theme);

export const PO_HOST_SCREENS = [
  'detail-host',
  'detail-postponed',
  'status-empty',
  'status-postpone',
  'status-cancel',
  'status-cancel-ready',
  'status-resume',
  'status-error',
  'roster-member',
  'roster-rep',
  'roster-rep-pending',
] as const;

const PERSONAL: Partial<CompetitionDoc> = { name: '2027 春季社區足球聯賽', hostType: 'personal', hostTeamId: null, feeNote: null };

function detailEnv(screen: string): CpInjectedEnv {
  const base = screenEnv('real-recruit');
  const bundle = base.bundle;
  if (!bundle?.competition) throw new Error('fixture');
  const postponed = screen === 'detail-postponed' || screen === 'status-resume';
  const preview: CpPreview = {};
  if (screen === 'status-empty') preview.statusDialog = {};
  if (screen === 'status-postpone') preview.statusDialog = { choice: 'postponed', reason: '場地整修，日期另行通知' };
  if (screen === 'status-cancel') preview.statusDialog = { choice: 'cancelled', reason: '報名隊伍不足' };
  if (screen === 'status-cancel-ready') preview.statusDialog = { choice: 'cancelled', reason: '報名隊伍不足', ack: true, armed: true };
  if (screen === 'status-resume') preview.statusDialog = { choice: 'published' };
  if (screen === 'status-error') preview.statusDialog = { choice: 'postponed', reason: '場地整修', error: 'STATUS_TRANSITION' };
  return {
    ...base,
    actor: hostActor,
    repo: createFakeCpRepo(),
    route: { cid: 'cup' },
    preview,
    bundle: {
      ...bundle,
      divisions: [{ ...adultDivision, entryCount: 5 }, { ...youthDivision, entryCount: 3 }],
      staff: { uid: 'uid_host', roles: ['host'] },
      competition: {
        ...bundle.competition,
        ...PERSONAL,
        ...(postponed ? { status: 'postponed' as const, statusReason: '場地整修，日期另行通知' } : {}),
      },
    },
  };
}

function rosterEnv(screen: string): CpInjectedEnv {
  const base = screenEnv('roster');
  const bundle = base.bundle;
  if (!bundle?.competition) throw new Error('fixture');
  const member = screen === 'roster-member';
  const pending = screen === 'roster-rep-pending';
  // 成員是 pl_2（林示範）：退出鍵改用 CP-PO-08 的 cpMine plIds 認本人（整合 po-host×CP-PO-08，顧問 §3.852）。
  const repo = createFakeCpRepo();
  const shown = pending
    ? { ...bundle, entries: bundle.entries.map((row) => ({ ...row, status: 'pending' as const })) }
    : bundle;
  return {
    ...base,
    actor: member ? memberActor : repActor,
    repo,
    bundle: { ...shown, myPlIds: member ? ['pl_2'] : [] },
  };
}

function Screen(): ComponentChildren {
  if (screenName.startsWith('roster-')) {
    return (
      <CpEnvProvider value={rosterEnv(screenName)}>
        <RosterPage />
      </CpEnvProvider>
    );
  }
  return (
    <CpEnvProvider value={detailEnv(screenName)}>
      <CompetitionDetailPage />
    </CpEnvProvider>
  );
}

function hasText(text: string): boolean {
  return (document.body.textContent ?? '').includes(text);
}

async function until(label: string, ready: () => boolean): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < 4000) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`畫面未出現：${label}`);
}

const OPEN: Record<string, () => Promise<void>> = {
  'detail-host': () => until('入口', () => hasText('延期或取消賽事')),
  'detail-postponed': () => until('入口', () => hasText('恢復或取消賽事')),
  'status-empty': () => until('確認框', () => hasText('處理方式')),
  'status-postpone': () => until('確認框', () => hasText('確定延期')),
  'status-cancel': () => until('確認框', () => hasText('我了解取消後不能恢復')),
  'status-cancel-ready': () => until('確認框', () => hasText('我了解取消後不能恢復')),
  'status-resume': () => until('確認框', () => hasText('確定恢復')),
  'status-error': () => until('錯誤', () => hasText('賽事目前的狀態不能這樣改')),
  'roster-member': () => until('退出鈕', () => hasText('退出名單')),
  'roster-rep': () => until('撤回報名', () => hasText('撤回報名')),
  'roster-rep-pending': () => until('撤回報名', () => hasText('撤回報名')),
};

void start();

async function start(): Promise<void> {
  const win = window as unknown as { __CPS_READY?: boolean; __CPS_ERROR?: string };
  try {
    if (!(PO_HOST_SCREENS as readonly string[]).includes(screenName)) throw new Error(`沒有這個 screen：${screenName}`);
    await setLocale('zh-TW');
    await loadCompetitionsDict('zh-TW');
    const root = document.getElementById('app');
    if (!root) return;
    render(
      <LocationProvider>
        <div class="app-shell ui-app-shell">
          <main class="app-main">
            <Screen />
          </main>
        </div>
        <ToastHost />
        <AppConfirmHost />
      </LocationProvider>,
      root,
    );
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    await OPEN[screenName]?.();
    win.__CPS_READY = true;
  } catch (err) {
    win.__CPS_ERROR = err instanceof Error ? err.message : String(err);
  }
}
