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
  'real-notices-host': CompetitionDetailPage,
  'real-contact-club': CompetitionDetailPage,
  'real-contact-personal-empty': CompetitionDetailPage,
  'real-host-matches': HostMatchesPage,
  'real-host-matches-many': HostMatchesPage,
  'real-host-schedule': HostSchedulePage,
  'real-score-sheet': HostMatchesPage,
  'real-reschedule-clash': HostMatchesPage,
  'real-shift-day': HostMatchesPage,
  'real-tie-panel': CompetitionDetailPage,
  'real-end-dialog': HostMatchesPage,
  'real-cancel-sheet': HostMatchesPage,
  'real-wizard-personal': NewCompetitionPage,
  // 卡 2-0（施工-第2批 3.25、3.27）：登錄棄權、重置比分、清除賽程、同分裁定另外兩張卡。
  'real-forfeit-sheet': HostMatchesPage,
  'real-reset-dialog': HostMatchesPage,
  'real-clear-schedule': HostSchedulePage,
  'real-tie-exists': CompetitionDetailPage,
  'real-tie-decision': CompetitionDetailPage,
  // 新外觀第 1b 批第 7 節「要補示範狀態」（截圖拍正式版現況；面板類由下方 OPEN 點正式按鈕打開）。
  'real-live-twin-next': CompetitionDetailPage,
  'real-live-no-today': CompetitionDetailPage,
  'real-warm-no-schedule': CompetitionDetailPage,
  'real-recruit-nodiv': CompetitionDetailPage,
  'real-done-five': CompetitionDetailPage,
  'real-done-nochamp': CompetitionDetailPage,
  'real-done-pending': CompetitionDetailPage,
  'real-long': CompetitionDetailPage,
  'real-long-recruit': CompetitionDetailPage,
  'real-draft-host': CompetitionDetailPage,
  'real-scorer': CompetitionDetailPage,
  'real-admin-menu': CompetitionDetailPage,
  'real-club-entry-one': CompetitionDetailPage,
  'real-club-entry-two': CompetitionDetailPage,
  'real-club-entry-error': CompetitionDetailPage,
  'real-notice-delete': CompetitionDetailPage,
  'real-notice-delete-sys': CompetitionDetailPage,
  'real-load-failed': CompetitionDetailPage,
  // u4-detail-live／u4-detail-corrected-pk 外層沒有 .cps-root：改在這裡用正式詳情頁畫同樣的列（即時、已更正、PK、內嵌隊徽）。
  'real-crest-live': CompetitionDetailPage,
  'real-corrected-pk': CompetitionDetailPage,
  // 新外觀第 4 批第 7 節「要補」：賽程管理、排賽程。
  'real-swap-open': HostMatchesPage,
  'real-shift-clash': HostMatchesPage,
  // 同上，等「撞期」提示框消失後再拍（現況提示框會蓋住按鈕列）。
  'real-shift-clash-settled': HostMatchesPage,
  'real-pending-fresh': HostMatchesPage,
  'real-host-matches-empty': HostMatchesPage,
  'real-host-matches-denied': HostMatchesPage,
  'real-schedule-preview': HostSchedulePage,
  'real-schedule-unplaced': HostSchedulePage,
  'real-schedule-too-many': HostSchedulePage,
  'real-schedule-replace': HostSchedulePage,
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
  'real-shift-day': async () => {
    // 順延表單預設收合，截圖要先點開。
    clickButton('整天順延');
    await until('整天順延表單', () => buttonsNamed('確認順延').length > 0);
  },
  'real-tie-panel': async () => {
    clickButton('同分');
    await until('同分比較', () => hasText('全部相同，待主辦裁定') && hasText('裁定原因'));
  },
  'real-end-dialog': async () => {
    clickButton('結束賽事');
    await until('結束確認', () => hasText('還有同分尚未裁定') && hasText('未確認'));
  },
  'real-cancel-sheet': async () => {
    clickButton('取消這場');
    await until('取消面板', () => hasText('取消原因會公開'));
  },
  'real-forfeit-sheet': async () => {
    clickButton('登錄比分');
    await until('登錄比分面板', () => buttonsNamed('改登錄棄權').length > 0);
    clickButton('改登錄棄權');
    await until('登錄棄權面板', () => buttonsNamed('確認棄權').length > 0 && hasText('棄權方判 0：2'));
  },
  'real-reset-dialog': async () => {
    await until('重置鈕', () => buttonsNamed('重置').length > 0);
    clickButton('重置');
    await until('重置比分面板', () => hasText('重置後比分歸零，積分榜會重算'));
  },
  'real-clear-schedule': async () => {
    // 產生鈕要先預覽過才能按；預覽丟 SCHEDULE_REPLACE_TOO_LARGE 後才出現「清除賽程」。
    await until('預覽鈕', () => buttonsNamed('預覽').length > 0);
    clickButton('預覽');
    await until('清除賽程鈕', () => buttonsNamed('清除賽程').length > 0);
    clickButton('清除賽程');
    await until('清除確認', () => hasText('清除後這個組別的賽程會刪掉，確定要清除？'));
  },
  'real-tie-exists': async () => {
    clickButton('同分');
    await until('裁定表單', () => hasText('裁定原因') && buttonsNamed('儲存').length > 0);
    setField('.cpm-form textarea, textarea', '兩隊所有比較項目相同，依規則由主辦裁定');
    await new Promise((resolve) => setTimeout(resolve, 50));
    clickButton('儲存');
    await until('已有裁定卡', () => hasText('已有裁定，請先撤銷原本的裁定') && buttonsNamed('撤銷裁定').length > 0);
  },
  'real-tie-decision': async () => {
    const tag = () => [...document.querySelectorAll<HTMLButtonElement>('button.cpm-tiebtn')].find((el) => el.getAttribute('aria-label') === '主辦裁定');
    // 與 real-tie-panel 同一頁：積分榜直接在詳情頁上；有「積分」分頁鈕時才點。
    if (!tag() && buttonsNamed('積分').length > 0) clickButton('積分');
    await until('裁定小標', () => tag() != null);
    tag()?.click();
    await until('裁定卡', () => buttonsNamed('撤銷裁定').length > 0);
  },
  // ── 新外觀第 1b 批 ──
  'real-live-twin-next': () => until('兩場下一場', () => hasText('綠洲隊') && hasText('晨光隊')),
  'real-done-five': () => until('五組冠軍', () => hasText('赤焰隊') && hasText('第一級別組')),
  'real-done-pending': () => until('冠軍待裁定', () => hasText('冠軍待主辦裁定')),
  'real-scorer': () => until('我的場次', () => buttonsNamed('我的場次').length > 0),
  'real-admin-menu': () => until('右上選單', () => !!document.querySelector('.cps-menu') && hasText('下架')),
  'real-club-entry-one': async () => {
    clickButton('以俱樂部報隊');
    await until('報隊面板', () => buttonsNamed('送出報名').length > 0);
  },
  'real-club-entry-two': async () => {
    clickButton('以俱樂部報隊');
    await until('報隊面板（兩個俱樂部）', () => buttonsNamed('送出報名').length > 0 && !!document.querySelector('.cps-sheet-body select'));
  },
  'real-club-entry-error': async () => {
    clickButton('以俱樂部報隊');
    await until('報隊面板（兩個俱樂部）', () => buttonsNamed('送出報名').length > 0);
    clickButton('送出報名');
    await until('必填錯誤', () => hasText('還有必填項目沒填'));
  },
  'real-notice-delete': () => openNoticeDelete('領隊會議改在示範球場門口', '確定要刪除這則公告？'),
  'real-notice-delete-sys': () => openNoticeDelete('因雨延後一小時', '這是系統公告，確定要刪除？'),
  'real-load-failed': () => until('讀取失敗', () => hasText('讀取失敗') && buttonsNamed('重試').length > 0),
  'real-crest-live': () => until('即時列', () => hasText('雷霆隊') && hasText('藍鯨隊')),
  'real-corrected-pk': () => until('已更正列', () => hasText('藍鯨隊')),
  // ── 新外觀第 4 批 ──
  'real-swap-open': async () => {
    clickButton('兩場對調');
    await until('兩場對調表單', () => buttonsNamed('確認對調').length > 0 && document.querySelectorAll('.cpm-swap').length === 2);
  },
  'real-shift-clash': () => openShiftClash(),
  'real-shift-clash-settled': async () => {
    await openShiftClash();
    // 提示框 2.5 秒後收掉；最多等 8 秒。
    const start = Date.now();
    while (Date.now() - start < 8000) {
      if (!document.querySelector('.ui-toast-host')?.children.length) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('畫面未出現：撞期提示框沒有消失');
  },
  'real-pending-fresh': () => until('待確認列', () => buttonsNamed('確認').length > 0 && buttonsNamed('記分').length > 0),
  'real-host-matches-empty': () => until('沒有場次', () => hasText('請先排賽程')),
  'real-host-matches-denied': () => until('沒有權限', () => !document.querySelector('.cp3-ml') && !!document.querySelector('[role="alert"]')),
  'real-schedule-preview': async () => {
    await until('預覽鈕', () => buttonsNamed('預覽').length > 0);
    clickButton('預覽');
    await until('預覽結果', () => hasText('共 12 場、需 2 天、每隊 3 場'));
  },
  'real-schedule-unplaced': async () => {
    await until('預覽鈕', () => buttonsNamed('預覽').length > 0);
    clickButton('預覽');
    await until('排不下', () => !!document.querySelector('.cp3-result--bad'));
  },
  'real-schedule-too-many': async () => {
    await until('預覽鈕', () => buttonsNamed('預覽').length > 0);
    clickButton('預覽');
    await until('場次太多', () => hasText('場次太多，請調整賽制'));
  },
  'real-schedule-replace': async () => {
    await until('預覽鈕', () => buttonsNamed('預覽').length > 0);
    clickButton('預覽');
    await until('清除賽程鈕', () => buttonsNamed('清除賽程').length > 0);
  },
};

/** 整天順延 1/9 → 1/10，送出後撞期，等「仍要順延」出現。 */
async function openShiftClash(): Promise<void> {
  clickButton('整天順延');
  await until('整天順延表單', () => buttonsNamed('確認順延').length > 0);
  setField('#cp-shift-date', '2027-01-10');
  setField('textarea', '場地整修，整天往後延');
  await new Promise((resolve) => setTimeout(resolve, 50));
  clickButton('確認順延');
  await until('仍要順延', () => buttonsNamed('仍要順延').length > 0 && !!document.querySelector('.cpm-warn')?.textContent?.includes('藍鯨隊'));
}

/** 主辦公告：點指定那一則的「刪除」，等確認框出現。 */
async function openNoticeDelete(text: string, confirm: string): Promise<void> {
  await until('公告', () => hasText(text));
  const row = [...document.querySelectorAll('.cpm-ann > li')].find((li) => (li.textContent ?? '').includes(text));
  const btn = row ? [...row.querySelectorAll('button')].find((node) => (node.textContent ?? '').trim() === '刪除') : undefined;
  if (!btn) throw new Error(`找不到公告刪除鈕：${text}`);
  btn.click();
  await until('刪除確認框', () => hasText(confirm));
}

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
