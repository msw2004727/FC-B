// 賽事第 2 步預覽。渲染正式頁面，資料是記憶體假資料，不連 Firestore、不呼叫 Functions。
// ?screen= 與 ?theme=light|dark。截圖腳本等 window.__CPS_READY。
import { render } from 'preact';
import type { ComponentType } from 'preact';
import { LocationProvider } from 'preact-iso';
import '../styles/legacy-vars.css';
import '../styles/tokens.css';
import '../styles/base.css';
import './cp-step2-harness.css';
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
  'host-pending': CompetitionManagePage,
  'host-approved': CompetitionManagePage,
  'host-rejected': CompetitionManagePage,
  'host-reject': CompetitionManagePage,
  'host-lock': CompetitionManagePage,
  'host-unlock': CompetitionManagePage,
  'position-measure': RosterPage,
};

const Page = PAGES[screenName] ?? NewCompetitionPage;

void start();

async function start(): Promise<void> {
  await setLocale('zh-TW');
  const root = document.getElementById('app');
  if (!root) return;
  render(
    <LocationProvider>
      <CpEnvProvider value={screenEnv(screenName)}>
        <Page />
      </CpEnvProvider>
      <ToastHost />
      <AppConfirmHost />
    </LocationProvider>,
    root,
  );
  const win = window as unknown as { __CPS_COPY: unknown[]; __CPS_READY: boolean };
  win.__CPS_COPY = [];
  win.__CPS_READY = true;
}
