// 賽事第 2 步預覽。渲染正式頁面，資料是記憶體假資料，不連 Firestore、不呼叫 Functions。
// ?screen= 與 ?theme=light|dark；?frame=1 時包正式 App 的內容容器（app-shell 限寬與 app-main 內距，1280 寬截圖用）。截圖腳本等 window.__CPS_READY。
// 要「畫完再點一下」的狀態（展開、確認框、表單錯誤）由下方 OPEN 點正式按鈕，點完才開就緒旗標。
import { render } from 'preact';
import type { ComponentType } from 'preact';
import { LocationProvider } from 'preact-iso';
import '../styles/legacy-vars.css';
import '../styles/tokens.css';
import '../styles/base.css';
import './cp-step2-harness.css';
import '@/ui/app-shell.css';
import { setLocale } from '@/i18n/i18n';
import { AppConfirmHost } from '@/ui/AppConfirm';
import { ToastHost } from '@/ui/ToastHost';
import { CpEnvProvider } from '@/features/competitions/env';
import { screenEnv } from '@/features/competitions/testing/screen-fixtures';
import AddRosterPage from '@/features/competitions/pages/AddRosterPage';
import CompetitionDetailPage from '@/features/competitions/pages/CompetitionDetailPage';
import CompetitionManagePage from '@/features/competitions/pages/CompetitionManagePage';
import JoinRosterPage from '@/features/competitions/pages/JoinRosterPage';
import NewCompetitionPage from '@/features/competitions/pages/NewCompetitionPage';
import RosterPage from '@/features/competitions/pages/RosterPage';

const params = new URLSearchParams(location.search);
const screenName = params.get('screen') || 'wizard-1';
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
const framed = params.get('frame') === '1';
document.documentElement.setAttribute('data-theme', theme);

const PAGES: Record<string, ComponentType> = {
  'wizard-1': NewCompetitionPage,
  'wizard-1-club': NewCompetitionPage,
  'wizard-1-error': NewCompetitionPage,
  'wizard-2': NewCompetitionPage,
  'wizard-3': NewCompetitionPage,
  'wizard-done': NewCompetitionPage,
  'detail-rep': CompetitionDetailPage,
  'detail-member': CompetitionDetailPage,
  'detail-report': CompetitionDetailPage,
  roster: RosterPage,
  'roster-ready': RosterPage,
  'roster-locked': RosterPage,
  'form-self-adult': JoinRosterPage,
  'form-self-minor': JoinRosterPage,
  'form-rep': AddRosterPage,
  'form-rep-adult': AddRosterPage,
  'form-rep-adult-nick': AddRosterPage,
  'host-pending': CompetitionManagePage,
  'host-approved': CompetitionManagePage,
  'host-rejected': CompetitionManagePage,
  'host-reject': CompetitionManagePage,
  'host-lock': CompetitionManagePage,
  'host-unlock': CompetitionManagePage,
  'position-measure': RosterPage,
  // 新外觀第 4 批第 7 節「要補」：個人主辦（screenEnv 早就有，PAGES 少這一行會落到建立賽事頁）、名單已鎖定、編輯展開、長名稱、建賽守門三態。
  'host-approved-personal': CompetitionManagePage,
  'host-locked': CompetitionManagePage,
  'host-edit-open': CompetitionManagePage,
  'host-long': CompetitionManagePage,
  'host-long-pending': CompetitionManagePage,
  'host-pending-longclub': CompetitionManagePage,
  'gate-guest': NewCompetitionPage,
  'gate-member': NewCompetitionPage,
  'gate-error': NewCompetitionPage,
  // 第 3 批留下的：名單隊員視角、移除確認框（點正式的垃圾桶）、表單錯誤／自訂位置展開／資格不符。
  'roster-member': RosterPage,
  'roster-remove': RosterPage,
  'form-error': JoinRosterPage,
  'form-custom-pos': JoinRosterPage,
  'form-ineligible': JoinRosterPage,
};

function buttonsNamed(name: string): HTMLButtonElement[] {
  return [...document.querySelectorAll('button')].filter((node) => (node.textContent ?? '').replace(/\s+/g, ' ').trim() === name);
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

function clickButton(name: string): void {
  const node = buttonsNamed(name)[0];
  if (!node) throw new Error(`找不到按鈕：${name}`);
  node.click();
}

const OPEN: Record<string, () => Promise<void>> = {
  'host-edit-open': async () => {
    await until('編輯賽事資訊鈕', () => buttonsNamed('編輯賽事資訊').length > 0);
    clickButton('編輯賽事資訊');
    await until('編輯展開', () => buttonsNamed('編輯賽事資訊')[0]?.getAttribute('aria-expanded') === 'true');
  },
  'host-locked': () => until('名單已鎖定', () => buttonsNamed('解鎖名單').length > 0 || hasText('解鎖')),
  'gate-guest': () => until('未登入守門', () => hasText('登入後才能建立賽事')),
  'gate-member': () => until('內部期守門', () => hasText('建立賽事尚未開放')),
  'gate-error': () => until('讀取失敗守門', () => hasText('讀取失敗')),
  'roster-member': () => until('登錄名單鈕', () => buttonsNamed('登錄名單').length > 0),
  'roster-remove': async () => {
    await until('垃圾桶', () => !!document.querySelector('[data-roster-row] .cps-iconbtn'));
    document.querySelector<HTMLButtonElement>('[data-roster-row] .cps-iconbtn')?.click();
    await until('移除確認框', () => hasText('確定要移除') && buttonsNamed('移除').length > 0);
  },
  'form-error': async () => {
    await until('送出鈕', () => buttonsNamed('送出').length > 0);
    clickButton('送出');
    await until('表單錯誤', () => !!document.querySelector('.cps-root [role="alert"]'));
  },
  'form-custom-pos': async () => {
    await until('自訂位置', () => buttonsNamed('自訂').length > 0);
    clickButton('自訂');
    await until('自訂位置輸入框', () => [...document.querySelectorAll('label')].some((node) => (node.textContent ?? '').trim().startsWith('自訂')));
  },
  'form-ineligible': () => until('資格不符', () => hasText('只有俱樂部成員可以做這個操作')),
};

const Page = PAGES[screenName] ?? NewCompetitionPage;

void start();

async function start(): Promise<void> {
  await setLocale('zh-TW');
  const root = document.getElementById('app');
  if (!root) return;
  render(
    <LocationProvider>
      {framed ? (
        <div class="app-shell ui-app-shell">
          <main class="app-main">
            <CpEnvProvider value={screenEnv(screenName)}>
              <Page />
            </CpEnvProvider>
          </main>
        </div>
      ) : (
        <CpEnvProvider value={screenEnv(screenName)}>
          <Page />
        </CpEnvProvider>
      )}
      <ToastHost />
      <AppConfirmHost />
    </LocationProvider>,
    root,
  );
  const win = window as unknown as { __CPS_COPY: unknown[]; __CPS_READY: boolean; __CPS_ERROR?: string };
  win.__CPS_COPY = [];
  try {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    await OPEN[screenName]?.();
    win.__CPS_READY = true;
  } catch (err) {
    win.__CPS_ERROR = err instanceof Error ? err.message : String(err);
  }
}
