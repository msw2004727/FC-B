// 刪除賽事：正式詳情頁＋記憶體假資料截圖。不連 Firestore、不呼叫 Functions（動作全是假的）。
// ?screen= 與 ?theme=light|dark。畫完設 window.__CPS_READY。
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
import { createFakeCpRepo } from '@/features/competitions/testing/fake-cp-repo';
import { adultDivision, hostActor, NOW, screenEnv, youthDivision } from '@/features/competitions/testing/screen-fixtures';

const params = new URLSearchParams(location.search);
const screenName = params.get('screen') || 'detail-host';
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.setAttribute('data-theme', theme);

export const DELETE_SCREENS = [
  'detail-host',
  'dialog-unchecked',
  'dialog-arming',
  'dialog-ready',
  'dialog-error-started',
  'dialog-error-hidden',
  'detail-stuck',
] as const;

const PERSONAL: Partial<CompetitionDoc> = { name: '2027 春季社區足球聯賽', hostType: 'personal', hostTeamId: null, feeNote: null };

function envOf(screen: string): CpInjectedEnv {
  const base = screenEnv('real-recruit');
  const bundle = base.bundle;
  if (!bundle?.competition) throw new Error('fixture');
  const stuck = screen === 'detail-stuck';
  const preview: CpPreview = {};
  if (screen === 'dialog-unchecked') preview.deleteDialog = { ack: false };
  if (screen === 'dialog-arming') preview.deleteDialog = { ack: true, armed: false };
  if (screen === 'dialog-ready') preview.deleteDialog = { ack: true, armed: true };
  if (screen === 'dialog-error-started') preview.deleteDialog = { ack: true, armed: true, error: 'DELETE_AFTER_START' };
  if (screen === 'dialog-error-hidden') preview.deleteDialog = { ack: true, armed: true, error: 'COMPETITION_HIDDEN' };
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
        ...(stuck ? { hidden: true, hiddenReason: null, deletingAt: NOW - 60_000 } : {}),
      },
    },
  };
}

function Screen(): ComponentChildren {
  return (
    <CpEnvProvider value={envOf(screenName)}>
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
  'detail-host': () => until('刪除鈕', () => hasText('刪除賽事')),
  'dialog-unchecked': () => until('確認框', () => hasText('我了解刪除後無法復原')),
  'dialog-arming': () => until('確認框', () => hasText('我了解刪除後無法復原')),
  'dialog-ready': () => until('確認框', () => hasText('我了解刪除後無法復原')),
  'dialog-error-started': () => until('錯誤', () => hasText('比賽已開始，不能刪除')),
  'dialog-error-hidden': () => until('錯誤', () => hasText('這場賽事目前不公開')),
  'detail-stuck': () => until('續刪', () => hasText('繼續刪除')),
};

void start();

async function start(): Promise<void> {
  const win = window as unknown as { __CPS_READY?: boolean; __CPS_ERROR?: string };
  try {
    if (!(DELETE_SCREENS as readonly string[]).includes(screenName)) throw new Error(`沒有這個 screen：${screenName}`);
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
