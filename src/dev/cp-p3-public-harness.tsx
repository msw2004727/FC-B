// 新外觀第 3 批（榜單與公開內頁）示範頁：詳情頁裡的積分榜／射手榜／紅黃牌，以及我的場次。
// 畫正式頁面（CompetitionDetailPage、ScorerMatchesPage），資料是 p3-public-fixtures 的記憶體假資料，
// 不連 Firestore、不呼叫 Functions。不改 screen-fixtures.ts 與其他示範頁。
// ?screen= 與 ?theme=light|dark。畫完、展開、錨點出現後設 window.__CPS_READY。
// window.__CPS_SCROLL_TO：截圖腳本第一張先捲到這個選擇器（例如排序規則卡）。
import { render } from 'preact';
import type { ComponentType } from 'preact';
import { LocationProvider } from 'preact-iso';
import '../styles/legacy-vars.css';
import '../styles/tokens.css';
import '../styles/base.css';
import '@/ui/app-shell.css';
import { setLocale } from '@/i18n/i18n';
import { AppConfirmHost } from '@/ui/AppConfirm';
import { ToastHost } from '@/ui/ToastHost';
import type { CpInjectedEnv } from '@/features/competitions/env';
import { CpEnvProvider } from '@/features/competitions/env';
import { loadCompetitionsDict } from '@/features/competitions/i18n';
import CompetitionDetailPage from '@/features/competitions/pages/CompetitionDetailPage';
import ScorerMatchesPage from '@/features/competitions/pages/ScorerMatchesPage';
import {
  detailLiveEnv,
  myMatchesEnv,
  P3_DIVISIONS_4,
  P3_STAND_LONG,
  P3_STAND_LONG_CRESTS,
  P3_STATS_CAP,
  P3_STATS_EMPTY,
  P3_STATS_STALLED,
} from '@/features/competitions/testing/p3-public-fixtures';

const params = new URLSearchParams(location.search);
const screenName = params.get('screen') || 'p3-stand-long';
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.setAttribute('data-theme', theme);

interface Shot {
  page: ComponentType;
  env: () => CpInjectedEnv;
  /** 畫完後依序點的按鈕（文字完全相同；同名取第一顆）。 */
  clicks?: string[];
  anchor: string;
  scrollTo?: string;
}

export const P3_SHOTS: Record<string, Shot> = {
  // 積分榜：長隊名、兩位數名次、三位數積分、同分與裁定、有上傳隊徽圖的隊伍
  'p3-stand-long': {
    page: CompetitionDetailPage,
    env: () => detailLiveEnv({ standings: P3_STAND_LONG, crests: P3_STAND_LONG_CRESTS }),
    clicks: ['積分'],
    anchor: '屏東墾丁南國陽光示範隊',
  },
  // 排序規則：新外觀卡 3-4 改成積分表卡片底部的收合列，這裡點開後捲到規則清單
  'p3-stand-rules': {
    page: CompetitionDetailPage,
    env: () => detailLiveEnv(),
    clicks: ['積分', '排序規則'],
    anchor: '先比積分，高者在前',
    scrollTo: '.cpm-rules',
  },
  // 射手榜（在詳情頁裡）
  'p3-detail-scorers': {
    page: CompetitionDetailPage,
    env: () => detailLiveEnv(),
    clicks: ['射手榜'],
    anchor: '劉冠廷',
  },
  'p3-detail-cards': {
    page: CompetitionDetailPage,
    env: () => detailLiveEnv(),
    clicks: ['射手榜', '紅黃牌'],
    anchor: '黃牌數',
  },
  'p3-detail-scorers-stalled': {
    page: CompetitionDetailPage,
    env: () => detailLiveEnv({ stats: P3_STATS_STALLED }),
    clicks: ['射手榜'],
    anchor: '射手榜已停止更新',
  },
  'p3-detail-scorers-empty': {
    page: CompetitionDetailPage,
    env: () => detailLiveEnv({ stats: P3_STATS_EMPTY }),
    clicks: ['射手榜'],
    anchor: '還沒有已確認的比賽紀錄',
  },
  'p3-detail-scorers-cap': {
    page: CompetitionDetailPage,
    env: () => detailLiveEnv({ stats: P3_STATS_CAP }),
    clicks: ['射手榜'],
    anchor: '只顯示前 50 名',
  },
  'p3-detail-scorers-groups': {
    page: CompetitionDetailPage,
    env: () => detailLiveEnv({ divisions: P3_DIVISIONS_4 }),
    clicks: ['射手榜'],
    anchor: '壯年四十歲以上組',
  },
  // 我的場次
  'p3-my-pre': { page: ScorerMatchesPage, env: () => myMatchesEnv('pre'), anchor: '進入記分' },
  'p3-my-done': { page: ScorerMatchesPage, env: () => myMatchesEnv('done'), anchor: '已取消' },
  'p3-my-long': { page: ScorerMatchesPage, env: () => myMatchesEnv('long'), anchor: '一二三四五六七八九十示範隊' },
  // 第 3 批小修補拍（設計總監 05:08）：跨日板卡＋長場地名；射手榜名額附註在 360 寬（直接捲到附註）
  'p3-my-edge': { page: ScorerMatchesPage, env: () => myMatchesEnv('edge'), anchor: '隔日' },
  'p3-detail-scorers-cap-end': {
    page: CompetitionDetailPage,
    env: () => detailLiveEnv({ stats: P3_STATS_CAP }),
    clicks: ['射手榜'],
    anchor: '只顯示前 50 名',
    scrollTo: '.cp-sc__cap',
  },
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

void start();

async function start(): Promise<void> {
  const root = document.getElementById('app');
  const win = window as unknown as { __CPS_READY?: boolean; __CPS_ERROR?: string; __CPS_SCROLL_TO?: string };
  if (!root) return;
  try {
    await setLocale('zh-TW');
    await loadCompetitionsDict('zh-TW');
    const shot = P3_SHOTS[screenName];
    if (!shot) throw new Error(`沒有這個 screen：${screenName}`);
    const Page = shot.page;
    // 與正式 App 相同的內容容器（ui-app-shell 的 max-width 與 app-main 內距）。
    render(
      <LocationProvider>
        <div class="app-shell ui-app-shell">
          <main class="app-main">
            <CpEnvProvider value={shot.env()}>
              <Page />
            </CpEnvProvider>
          </main>
        </div>
        <ToastHost />
        <AppConfirmHost />
      </LocationProvider>,
      root,
    );
    for (const name of shot.clicks ?? []) {
      await until(`按鈕 ${name}`, () => buttonsNamed(name).length > 0);
      buttonsNamed(name)[0]!.click();
    }
    await until(shot.anchor, () => hasText(shot.anchor));
    if (shot.scrollTo) win.__CPS_SCROLL_TO = shot.scrollTo;
    win.__CPS_READY = true;
  } catch (err) {
    win.__CPS_ERROR = err instanceof Error ? err.message : String(err);
  }
}
