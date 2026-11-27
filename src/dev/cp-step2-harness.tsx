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
import { idleActions, screenEnv } from '@/features/competitions/testing/screen-fixtures';
import AddRosterPage from '@/features/competitions/pages/AddRosterPage';
import CompetitionDetailPage from '@/features/competitions/pages/CompetitionDetailPage';
import CompetitionManagePage from '@/features/competitions/pages/CompetitionManagePage';
import JoinRosterPage from '@/features/competitions/pages/JoinRosterPage';
import NewCompetitionPage from '@/features/competitions/pages/NewCompetitionPage';
import RosterPage from '@/features/competitions/pages/RosterPage';
// 報隊管理空狀態沿用 .s4b-mempty（step4b.css）；正式打包同在 entry CSS、排在 competitions.css 之後，示範頁照這個順序補載。
import '@/features/competitions/step4b/step4b.css';

const params = new URLSearchParams(location.search);
const screenName = params.get('screen') || 'wizard-1';
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
const framed = params.get('frame') === '1';
// ?nav=1：載入正式外框的 legacy/layout.css，放同樣 id 的 #top-bar、#bottom-tabs（z-index 900，含半圓凸起），看建立賽事有沒有讓開。
// 只放外框元素、不載正式 TopBar／BottomNav 元件（會帶進登入與路由註冊模組）；只在 nav=1 時載入，其他畫面不受影響。
const withShell = params.get('nav') === '1';
// ?slow=create|publish：建立或發布一直不回（看等待中按鈕轉圈、2 秒與 15 秒兩段說明）；不給就照常立即完成。
const slow = params.get('slow');
const never = (): Promise<never> => new Promise(() => {});
const actions = slow === 'create' ? { ...idleActions(), create: never } : slow === 'publish' ? { ...idleActions(), publish: never } : undefined;
document.documentElement.setAttribute('data-theme', theme);

const PAGES: Record<string, ComponentType> = {
  'wizard-1': NewCompetitionPage,
  'wizard-1-club': NewCompetitionPage,
  'wizard-1-error': NewCompetitionPage,
  'wizard-2': NewCompetitionPage,
  'wizard-3': NewCompetitionPage,
  // 必填沒過：按下一步後捲到該欄、欄位錯誤
  'wizard-1-required': NewCompetitionPage,
  'wizard-2-required': NewCompetitionPage,
  'wizard-done': NewCompetitionPage,
  'detail-rep': CompetitionDetailPage,
  'detail-member': CompetitionDetailPage,
  'detail-report': CompetitionDetailPage,
  roster: RosterPage,
  'roster-ready': RosterPage,
  'roster-locked': RosterPage,
  'form-self-adult': JoinRosterPage,
  'form-self-legacy': JoinRosterPage,
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
  'roster-member-legacy': RosterPage,
  'roster-remove': RosterPage,
  // CP-PO-08 球員本人退出名單
  'roster-self': RosterPage,
  'roster-self-confirm': RosterPage,
  'roster-self-locked': RosterPage,
  'roster-self-started': RosterPage,
  'roster-self-long': RosterPage,
  'roster-rep-self': RosterPage,
  'form-already': JoinRosterPage,
  'form-error': JoinRosterPage,
  'form-custom-pos': JoinRosterPage,
  'form-ineligible': JoinRosterPage,
  // 第 3 批小修補拍（設計總監 05:08）：代為新增表單填 24 字真實姓名（資料同 form-rep，畫完後由 OPEN 填字）
  'form-long-name': AddRosterPage,
  // 既有小修（顧問 §3.505）
  'host-pending-empty': CompetitionManagePage,
  'host-approved-empty': CompetitionManagePage,
  'host-rejected-empty': CompetitionManagePage,
  'host-lock-all': CompetitionManagePage,
  'roster-confirmed': RosterPage,
  'detail-oneday': CompetitionDetailPage,
  // 編輯賽事（站長 11-21）：建賽精靈同一頁，網址補 edit=cup；入口按鈕看報隊管理主辦區與詳情頁主辦卡
  'edit-1': NewCompetitionPage,
  'edit-1-personal': NewCompetitionPage,
  'edit-2': NewCompetitionPage,
  'edit-3': NewCompetitionPage,
  'edit-started': NewCompetitionPage,
  'edit-locked': NewCompetitionPage,
  'edit-scheduled': NewCompetitionPage,
  'edit-denied': NewCompetitionPage,
  'edit-entry-manage': CompetitionManagePage,
  'edit-entry-detail': CompetitionDetailPage,
};

/** 沿用既有資料的畫面：畫面名稱 → screenEnv 的狀態名。 */
const ENV_OF: Record<string, string> = { 'form-long-name': 'form-rep', 'roster-member-legacy': 'roster-member', 'form-self-legacy': 'form-self-adult', 'edit-entry-manage': 'host-approved', 'edit-entry-detail': 'real-draft-host' };

/**
 * 俱樂部雙鍵（顧問 §3.846）預覽：成員清單只有自訂 id（legacy_demo），報隊是文件 id（club_a）；
 * 假的 clubKeys 晚 120ms 才回兩把鍵，畫面要先不出錯、換算完才出登錄入口。
 */
const LEGACY_SCREENS = new Set(['roster-member-legacy', 'form-self-legacy']);
function envOf(name: string) {
  const env = screenEnv(ENV_OF[name] ?? name, actions);
  if (!LEGACY_SCREENS.has(name)) return env;
  return {
    ...env,
    actor: { ...env.actor, memberClubIds: ['legacy_demo'] },
    clubKeys: (_uid: string | null, teamId: string) =>
      new Promise<string[]>((resolve) => setTimeout(() => resolve([teamId, 'legacy_demo']), 120)),
  };
}

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

async function nextUntilFieldError(): Promise<void> {
  await until('下一步', () => buttonsNamed('下一步').length > 0);
  clickButton('下一步');
  await until('欄位錯誤', () => !!document.querySelector('.cps-root [data-field-error]'));
  // 平滑捲動跑完再拍
  await new Promise((resolve) => setTimeout(resolve, 600));
}

const OPEN: Record<string, () => Promise<void>> = {
  'wizard-1-required': nextUntilFieldError,
  'wizard-2-required': nextUntilFieldError,
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
  'roster-self': () => until('退出名單鈕', () => buttonsNamed('退出名單').length > 0),
  'roster-self-confirm': async () => {
    await until('退出名單鈕', () => buttonsNamed('退出名單').length > 0);
    clickButton('退出名單');
    await until('退出確認框', () => hasText('確定要退出') && buttonsNamed('退出').length > 0);
  },
  'form-already': async () => {
    await until('送出鈕', () => buttonsNamed('送出').length > 0);
    const ack = document.querySelector<HTMLInputElement>('.cps-root input[type="checkbox"]');
    ack?.click();
    // 等勾選畫完再送出（送出讀的是重繪後的狀態）
    await until('已勾選', () => ack?.checked === true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    clickButton('送出');
    await until('已在其他隊伍', () => hasText('你已在本賽事其他隊伍名單'));
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
  'roster-member-legacy': () => until('登錄名單鈕（雙鍵）', () => buttonsNamed('登錄名單').length > 0),
  'form-self-legacy': () => until('登錄表單（雙鍵）', () => buttonsNamed('送出').length > 0),
  'form-long-name': async () => {
    await until('真實姓名欄', () => !!document.querySelector('.ui-input input'));
    const input = document.querySelector<HTMLInputElement>('.ui-input input');
    if (!input) return;
    input.value = '上官歐陽司徒長孫東方西門南宮慕容令狐皇甫尉遲諸葛';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await until('24 字姓名', () => input.value.length === 24 && !!document.querySelector('[data-public-name]'));
  },
};

const Page = PAGES[screenName] ?? NewCompetitionPage;
// 編輯賽事走 /competitions/new?edit=<cid>：頁面讀網址的 edit，這裡補上合格的示範 id（後端 CID_RE：cp_＋20 碼；不改其他畫面的網址）。
if (screenName.startsWith('edit-') && Page === NewCompetitionPage) history.replaceState(null, '', `${location.pathname}${location.search}&edit=cp_${'A'.repeat(20)}`);

void start();

async function start(): Promise<void> {
  if (withShell) await import('../styles/legacy/layout.css');
  await setLocale('zh-TW');
  const root = document.getElementById('app');
  if (!root) return;
  render(
    <LocationProvider>
      {framed ? (
        <div class="app-shell ui-app-shell">
          <main class="app-main">
            <CpEnvProvider value={envOf(screenName)}>
              <Page />
            </CpEnvProvider>
          </main>
        </div>
      ) : (
        <CpEnvProvider value={envOf(screenName)}>
          <Page />
        </CpEnvProvider>
      )}
      {withShell ? (
        <div class="legacy-ui legacy-chrome">
          <header id="top-bar" data-shell="top">頂部列</header>
          <nav id="bottom-tabs" data-shell="bottom">底部導覽</nav>
        </div>
      ) : null}
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
