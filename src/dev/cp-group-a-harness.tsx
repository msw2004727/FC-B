// 賽事 A 組 commit 3 預覽（B2 拒絕面板、B3 產生賽程取代確認）。渲染正式頁面，資料是記憶體假資料，不連 Firestore、不呼叫 Functions。
// ?screen=reject|sched 與 ?theme=light|dark；?frame=1 包正式 App 的內容容器（1280 寬用）。截圖腳本等 window.__CPS_READY。
import { render } from 'preact';
import { LocationProvider } from 'preact-iso';
import '../styles/legacy-vars.css';
import '../styles/tokens.css';
import '../styles/base.css';
import './cp-step2-harness.css';
import '@/ui/app-shell.css';
import { setLocale } from '@/i18n/i18n';
import { AppConfirmHost } from '@/ui/AppConfirm';
import { ToastHost } from '@/ui/ToastHost';
import { CpEnvProvider, type CpInjectedEnv } from '@/features/competitions/env';
import { screenEnv } from '@/features/competitions/testing/screen-fixtures';
import CompetitionManagePage from '@/features/competitions/pages/CompetitionManagePage';
import HostSchedulePage from '@/features/competitions/pages/HostSchedulePage';
import '@/features/competitions/step4b/step4b.css';

const params = new URLSearchParams(location.search);
const screenName = params.get('screen') === 'sched' ? 'sched' : 'reject';
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
const framed = params.get('frame') === '1';
document.documentElement.setAttribute('data-theme', theme);

function envOf(): CpInjectedEnv {
  if (screenName === 'reject') {
    // 待審第一隊已登錄 5 位球員，拒絕面板要寫出會一併移除。
    const env = screenEnv('host-reject');
    const bundle = env.bundle!;
    return {
      ...env,
      bundle: { ...bundle, entries: bundle.entries.map((row) => (row.status === 'pending' ? { ...row, rosterCount: 5 } : row)) },
    };
  }
  // 成人組已排 6 場：按「產生賽程」要先跳取代確認。
  const env = screenEnv('real-host-schedule');
  const bundle = env.bundle!;
  return {
    ...env,
    bundle: { ...bundle, divisions: bundle.divisions.map((row) => (row.dvId === 'dv_adult' ? { ...row, scheduledMatches: 6 } : row)) },
  };
}

function buttonsNamed(name: string): HTMLButtonElement[] {
  return [...document.querySelectorAll('button')].filter((node) => (node.textContent ?? '').replace(/\s+/g, ' ').trim() === name);
}

async function until(label: string, check: () => boolean, ms = 8000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`等不到：${label}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function open(): Promise<void> {
  if (screenName === 'reject') {
    await until('拒絕面板', () => document.querySelector('.d2-panel') != null);
    return;
  }
  await until('預覽鈕', () => buttonsNamed('預覽').length > 0);
  buttonsNamed('預覽')[0]?.click();
  await until('產生鈕可按', () => buttonsNamed('產生賽程').some((node) => !node.disabled));
  buttonsNamed('產生賽程').find((node) => !node.disabled)?.click();
  // 改前沒有確認框（直接產生並轉去賽程管理）；改後等確認框。最多等 1.5 秒。
  const end = Date.now() + 1500;
  while (!document.querySelector('[role="alertdialog"]') && Date.now() < end) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

void start();

async function start(): Promise<void> {
  await setLocale('zh-TW');
  const root = document.getElementById('app');
  if (!root) return;
  const Page = screenName === 'reject' ? CompetitionManagePage : HostSchedulePage;
  const env = envOf();
  render(
    <LocationProvider>
      {framed ? (
        <div class="app-shell ui-app-shell">
          <main class="app-main">
            <CpEnvProvider value={env}><Page /></CpEnvProvider>
          </main>
        </div>
      ) : (
        <CpEnvProvider value={env}><Page /></CpEnvProvider>
      )}
      <ToastHost />
      <AppConfirmHost />
    </LocationProvider>,
    root,
  );
  const win = window as unknown as { __CPS_READY: boolean; __CPS_ERROR?: string };
  try {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    await open();
    win.__CPS_READY = true;
  } catch (err) {
    win.__CPS_ERROR = err instanceof Error ? err.message : String(err);
    win.__CPS_READY = true;
  }
}
