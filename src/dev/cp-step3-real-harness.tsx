// 賽事第 3 步正式頁面截圖。渲染正式元件，資料是 screenEnv 的記憶體假資料，不連 Firestore、不呼叫 Functions。
// ?screen= 與 ?theme=light|dark。截圖腳本等 window.__CPS_READY。
// 面板沒有預覽旗標，畫完後由這裡點正式按鈕打開，再開就緒旗標。
import { render } from 'preact';
import type { ComponentChildren, ComponentType } from 'preact';
import { LocationProvider } from 'preact-iso';
import '../styles/legacy-vars.css';
import '../styles/tokens.css';
import '../styles/base.css';
import '@/styles/category-tokens.css';
import '@/features/tournaments/tournaments.css';
import '@/features/tournaments/list-v2.css';
import './cp-step3-real-harness.css';
import { setLocale } from '@/i18n/i18n';
import { AppConfirmHost } from '@/ui/AppConfirm';
import { ToastHost } from '@/ui/ToastHost';
import { InAppSection } from '@/features/competitions/components/InAppSection';
import { CpEnvProvider } from '@/features/competitions/env';
import { loadCompetitionsDict } from '@/features/competitions/i18n';
import { screenEnv } from '@/features/competitions/testing/screen-fixtures';
import CompetitionDetailPage from '@/features/competitions/pages/CompetitionDetailPage';
import HostMatchesPage from '@/features/competitions/pages/HostMatchesPage';
import HostSchedulePage from '@/features/competitions/pages/HostSchedulePage';
import NewCompetitionPage from '@/features/competitions/pages/NewCompetitionPage';

const params = new URLSearchParams(location.search);
const screenName = params.get('screen') || 'real-recruit';
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.setAttribute('data-theme', theme);

const PAGES: Record<string, ComponentType> = {
  'real-recruit': CompetitionDetailPage,
  'real-warm': CompetitionDetailPage,
  'real-live': CompetitionDetailPage,
  'real-live-stand': CompetitionDetailPage,
  'real-done': CompetitionDetailPage,
  'real-ended-host': CompetitionDetailPage,
  'real-postponed': CompetitionDetailPage,
  'real-cancelled-comp': CompetitionDetailPage,
  'real-notices': CompetitionDetailPage,
  'real-contact-club': CompetitionDetailPage,
  'real-contact-personal-empty': CompetitionDetailPage,
  'real-host-matches': HostMatchesPage,
  'real-host-schedule': HostSchedulePage,
  'real-score-sheet': HostMatchesPage,
  'real-reschedule-clash': HostMatchesPage,
  'real-shift-day': HostMatchesPage,
  'real-tie-panel': CompetitionDetailPage,
  'real-end-dialog': HostMatchesPage,
  'real-cancel-sheet': HostMatchesPage,
  'real-wizard-personal': NewCompetitionPage,
};

/** 正式賽事頁的上方來源切換與分類頁籤在 TournamentsPage，且要等開賽閘門。這裡只畫站內清單，外層套上同一頁的版面鉤子，封面色才吃得到。 */
function ListIn(): ComponentChildren {
  return (
    <div class="legacy-ui tournaments-root" data-v2="1">
      <section class="page active tc-page" id="page-tournaments">
        <InAppSection tab="all" active />
      </section>
    </div>
  );
}

/** 有填、沒填各畫一頁正式詳情。沒填時聯絡區整段不出現。 */
function ContactPersonal(): ComponentChildren {
  return (
    <>
      <section class="cpr-shot">
        <p class="cpr-cap">有填公開聯絡文字</p>
        <CpEnvProvider value={screenEnv('real-contact-personal')}>
          <CompetitionDetailPage />
        </CpEnvProvider>
      </section>
      <section class="cpr-shot">
        <p class="cpr-cap">沒填公開聯絡文字（整區不顯示）</p>
        <CpEnvProvider value={screenEnv('real-contact-personal-empty')}>
          <CompetitionDetailPage />
        </CpEnvProvider>
      </section>
    </>
  );
}

function Screen(): ComponentChildren {
  if (screenName === 'list-in') {
    return (
      <CpEnvProvider value={screenEnv('list-in')}>
        <ListIn />
      </CpEnvProvider>
    );
  }
  if (screenName === 'real-contact-personal') return <ContactPersonal />;
  const Page = PAGES[screenName];
  if (!Page) return <p class="cpr-cap">沒有這個 screen：{screenName}</p>;
  return (
    <CpEnvProvider value={screenEnv(screenName)}>
      <Page />
    </CpEnvProvider>
  );
}

function buttonsNamed(name: string): HTMLButtonElement[] {
  return [...document.querySelectorAll('button')].filter((node) => (node.textContent ?? '').replace(/\s+/g, ' ').trim() === name);
}

function clickButton(name: string, index = 0): void {
  const node = buttonsNamed(name)[index];
  if (!node) throw new Error(`找不到按鈕：${name}`);
  node.click();
}

async function until(label: string, ready: () => boolean): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < 4000) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`畫面未出現：${label}`);
}

function setField(selector: string, value: string): void {
  const node = [...document.querySelectorAll<HTMLInputElement | HTMLSelectElement>(selector)].pop();
  if (!node) throw new Error(`找不到欄位：${selector}`);
  node.value = value;
  node.dispatchEvent(new Event('input', { bubbles: true }));
  node.dispatchEvent(new Event('change', { bubbles: true }));
}

function hasText(text: string): boolean {
  return (document.body.textContent ?? '').includes(text);
}

/** 面板類：點正式按鈕。積分分頁、已結束賽程也在這裡展開。 */
const OPEN: Record<string, () => Promise<void>> = {
  'list-in': () => until('站內清單', () => hasText('今天 3 場\u30fb下一場 14:30') && hasText('距開賽 3 天') && hasText('報名截止')),
  'real-live-stand': async () => {
    clickButton('積分');
    await until('積分分頁', () => {
      const tab = [...document.querySelectorAll('[role="tab"]')].find((node) => (node.textContent ?? '').trim() === '積分');
      const panel = document.querySelector('[role="tabpanel"]:not([hidden])');
      return tab?.getAttribute('aria-selected') === 'true'
        && !!panel?.querySelector('.cp3-st')
        && (panel.textContent ?? '').includes('同分')
        && (panel.textContent ?? '').includes('主辦裁定');
    });
  },
  'real-done': async () => {
    // 首屏資料還在補讀時按展開可能被擋（正式畫面會出「再試一次」）；截圖這邊最多重按 5 次
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const fold = document.querySelector<HTMLButtonElement>('button.cp3-fold[aria-expanded="false"]');
      fold?.click();
      try {
        await until('展開賽程', () => hasText('18:00') && hasText('海風隊'));
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
    throw new Error('畫面未出現：展開賽程');
  },
  'real-cancelled-comp': async () => {
    // 假資料庫沒有這場的全部賽程（展開讀 loadFullSchedule），截圖只看頂部取消狀態與原因，不展開
    await until('已取消賽程', () => hasText('報名隊伍不足'));
  },
  'real-score-sheet': async () => {
    clickButton('登錄比分');
    await until('登錄比分面板', () => hasText('登錄並確認'));
  },
  'real-reschedule-clash': async () => {
    // 改期底頁要等這次點擊畫完才有「確認改期」。同一輪接著點會找不到按鈕。
    clickButton('改期');
    await until('確認改期', () => buttonsNamed('確認改期').length > 0);
    // 把新時間、場地改到撞期那場（1/10 11:00、第二球場），警示內容才跟表單一致
    setField('#cp-resched-date', '2027-01-10');
    setField('.cps-grid2 input:not(#cp-resched-date)', '11:00');
    setField('select', '1');
    await new Promise((resolve) => setTimeout(resolve, 50));
    clickButton('確認改期');
    await until('仍要改期', () => hasText('仍要改期') && !!document.querySelector('.cpm-warn')?.textContent?.includes('藍鯨隊'));
  },
  'real-tie-panel': async () => {
    clickButton('同分');
    await until('同分比較', () => hasText('在這一項分出高下') && hasText('裁定原因'));
  },
  'real-end-dialog': async () => {
    clickButton('結束賽事');
    await until('結束確認', () => hasText('還有同分尚未裁定') && hasText('未確認'));
  },
  'real-cancel-sheet': async () => {
    clickButton('取消這場');
    await until('取消面板', () => hasText('取消原因會公開'));
  },
};

void start();

async function start(): Promise<void> {
  await setLocale('zh-TW');
  await loadCompetitionsDict('zh-TW');
  const root = document.getElementById('app');
  if (!root) return;
  render(
    <LocationProvider>
      <Screen />
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
