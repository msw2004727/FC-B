// 觀眾即時與射手榜截圖。只畫凍結元件與假資料，不連 Firestore。
// ?screen= 與 ?theme=light|dark。畫完且錨點出現後設 window.__CPS_READY。
import { render } from 'preact';
import { LocationProvider } from 'preact-iso';
import '../styles/tokens.css';
import '../styles/base.css';
import '@/ui/app-shell.css';
import { setLocale } from '@/i18n/i18n';
import { loadCompetitionsDict } from '@/features/competitions/i18n';
import { LiveDetailList } from '@/features/competitions/live/LiveDetailList';
import { LiveMatchView } from '@/features/competitions/live/LiveMatchView';
import { pkScoreLabel } from '@/features/competitions/live/copy';
import { ScorersTable } from '@/features/competitions/live/ScorersTable';
import { derivePublicTable } from '@/features/competitions/live/stats';
import type { TimelineEvent } from '@/features/competitions/live/types';
import {
  S4_CONFIRMED,
  S4_DETAIL_ROWS,
  S4_PEOPLE,
  S4_SCENE_LIVE,
} from '@/features/competitions/testing/step4-fixtures';

const params = new URLSearchParams(location.search);
const screenName = params.get('screen') || 'u4-detail-live';
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.setAttribute('data-theme', theme);

export const U4_SCREENS = [
  'u4-detail-live',
  'u4-detail-corrected-pk',
  'u4-match-live',
  'u4-match-log-open',
  'u4-scorers',
  'u4-cards',
  'u4-scorers-stalled',
  'u4-scorers-empty',
] as const;

const ANCHORS: Record<string, string> = {
  'u4-detail-live': '即時',
  'u4-detail-corrected-pk': '比分已更正',
  'u4-match-live': '比賽紀錄',
  'u4-match-log-open': '第1輪',
  'u4-scorers': '劉冠廷',
  'u4-cards': '黃牌數',
  'u4-scorers-stalled': '射手榜已停止更新',
  'u4-scorers-empty': '還沒有已確認的比賽紀錄',
};

const CORRECTED_ROWS = [
  {
    id: 'd3',
    when: '08:00',
    home: '藍鯨隊',
    away: '海風隊',
    score: '2:1',
    live: false,
    corrected: true,
    pk: pkScoreLabel(4, 3),
  },
];

const LOG_EVENTS: TimelineEvent[] = [
  ...S4_SCENE_LIVE.events,
  {
    seq: 20,
    type: 'pk',
    side: 'home',
    plId: 'pl_th9',
    scored: true,
    round: 1,
    matchSecond: 40 * 60,
    createdAt: S4_SCENE_LIVE.nowMs,
  },
];

function hasText(text: string): boolean {
  return (document.body.textContent ?? '').includes(text);
}

function buttonsNamed(name: string): HTMLButtonElement[] {
  return [...document.querySelectorAll('button')].filter((node) => (node.textContent ?? '').replace(/\s+/g, ' ').trim() === name);
}

function clickButton(name: string): void {
  const node = buttonsNamed(name)[0];
  if (!node) throw new Error(`找不到按鈕：${name}`);
  node.click();
}

function screenOf(name: string) {
  if (name === 'u4-detail-live') return <LiveDetailList rows={S4_DETAIL_ROWS} />;
  if (name === 'u4-detail-corrected-pk') return <LiveDetailList rows={CORRECTED_ROWS} />;
  if (name === 'u4-match-live' || name === 'u4-match-log-open') {
    const scene = S4_SCENE_LIVE;
    return (
      <LiveMatchView
        match={scene.match}
        clock={scene.clock}
        events={name === 'u4-match-log-open' ? LOG_EVENTS : scene.events}
        voids={scene.voids}
        homeRoster={scene.homeRoster}
        awayRoster={scene.awayRoster}
        crests={scene.crests}
      />
    );
  }
  const table = derivePublicTable(S4_CONFIRMED, S4_PEOPLE);
  if (name === 'u4-scorers') return <ScorersTable scorers={table.scorers} cards={table.cards} />;
  if (name === 'u4-cards') {
    return <ScorersTable scorers={table.scorers} cards={table.cards} initialTab="cards" />;
  }
  if (name === 'u4-scorers-stalled') {
    return <ScorersTable scorers={table.scorers} cards={table.cards} stalled />;
  }
  return <ScorersTable scorers={[]} cards={[]} empty />;
}

const OPEN: Record<string, () => void> = {
  'u4-match-log-open': () => {
    clickButton('比賽紀錄');
  },
};

void start();

async function start(): Promise<void> {
  const root = document.getElementById('app');
  const win = window as unknown as { __CPS_READY?: boolean; __CPS_ERROR?: string };
  if (!root) return;
  try {
    await setLocale('zh-TW');
    await loadCompetitionsDict('zh-TW');
    if (!(U4_SCREENS as readonly string[]).includes(screenName)) {
      throw new Error(`沒有這個 screen：${screenName}`);
    }
    // 與正式 App 相同的內容容器（ui-app-shell 的 max-width）。
    render(
      <LocationProvider>
        <div class="app-shell ui-app-shell">
          <main class="app-main">{screenOf(screenName)}</main>
        </div>
      </LocationProvider>,
      root,
    );
    OPEN[screenName]?.();
    const anchor = ANCHORS[screenName] ?? '';
    const startAt = Date.now();
    while (!hasText(anchor)) {
      if (Date.now() - startAt > 4000) throw new Error(`畫面未出現：${anchor}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    win.__CPS_READY = true;
  } catch (err) {
    win.__CPS_ERROR = err instanceof Error ? err.message : String(err);
  }
}
