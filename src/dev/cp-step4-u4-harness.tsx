// 觀眾即時與射手榜截圖。只畫凍結元件與假資料，不連 Firestore。
// ?screen= 與 ?theme=light|dark。畫完且錨點出現後設 window.__CPS_READY。
import { render } from 'preact';
import { LocationProvider } from 'preact-iso';
import '../styles/tokens.css';
import '../styles/base.css';
import '@/ui/app-shell.css';
import { setLocale } from '@/i18n/i18n';
import { groupSchedule } from '@/features/competitions/data/schedule-present';
import type { EntryDoc, SummaryEntry } from '@/features/competitions/data/types';
import { taipeiMs } from '@/features/competitions/format';
import { ctOrKey, loadCompetitionsDict, useCompetitionsT } from '@/features/competitions/i18n';
import { LiveMatchView } from '@/features/competitions/live/LiveMatchView';
import { ScorersTable } from '@/features/competitions/live/ScorersTable';
import { derivePublicTable } from '@/features/competitions/live/stats';
import type { TimelineEvent } from '@/features/competitions/live/types';
import { MatchSchedule, scheduleLabels } from '@/features/competitions/ui/schedule-board';
import {
  S4_CONFIRMED,
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

/** 截圖隊徽：16×16 內嵌 PNG。不連正式儲存網域。 */
const U4_CREST = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAANElEQVR4nGNgoBDwFeehIdJU49ODSzV2PfhVo+shRjWKnhGpgeRgJSfiyEkauPTgU00MAADYspGlcL3zwAAAAABJRU5ErkJggg==';

/** 與觀眾詳情同一天的白天，時刻維持 08:00／09:00，不寫「隔日」。 */
const DETAIL_NOW = taipeiMs(2027, 1, 9, 12, 0);

function detailEntry(row: {
  id: string;
  hour: number;
  minute: number;
  home: string;
  away: string;
  homeId: string;
  awayId: string;
  score: [number, number];
  st: SummaryEntry['st'];
  cx?: number;
  pk?: [number, number];
  logo?: string;
}): SummaryEntry {
  return {
    id: row.id,
    dv: 'dv_adult',
    r: 1,
    no: 1,
    k: taipeiMs(2027, 1, 9, row.hour, row.minute),
    v: null,
    h: { id: row.homeId, n: row.home, ...(row.logo ? { l: row.logo } : {}) },
    a: { id: row.awayId, n: row.away },
    s: row.score,
    st: row.st,
    wo: null,
    ...(row.cx != null ? { cx: row.cx } : {}),
    ...(row.pk ? { p: row.pk } : {}),
  };
}

/** 兩場進行中、一場比分已更正。長隊名沿用原本截圖。 */
const LIVE_ENTRIES: readonly SummaryEntry[] = [
  detailEntry({
    id: 'd1', hour: 9, minute: 0, home: '雷霆隊', away: '海風隊',
    homeId: 'en_c', awayId: 'en_h', score: [1, 1], st: 'live', logo: U4_CREST,
  }),
  detailEntry({
    id: 'd2', hour: 9, minute: 0, home: '山貓隊', away: '銀河隊',
    homeId: 'en_cat', awayId: 'en_gal', score: [0, 2], st: 'live',
  }),
  detailEntry({
    id: 'd3', hour: 8, minute: 0, home: '藍鯨隊', away: '一二三四五六七八九十示範隊',
    homeId: 'en_whale', awayId: 'en_long', score: [2, 1], st: 'confirmed', cx: DETAIL_NOW,
  }),
];

/** 一列：已更正、PK。隊徽只用內嵌圖。 */
const CORRECTED_ENTRIES: readonly SummaryEntry[] = [
  detailEntry({
    id: 'd3', hour: 8, minute: 0, home: '藍鯨隊', away: '海風隊',
    homeId: 'en_whale', awayId: 'en_h', score: [2, 1], st: 'confirmed', cx: DETAIL_NOW, pk: [4, 3], logo: U4_CREST,
  }),
];

function shotCrests(crests: readonly EntryDoc[]): EntryDoc[] {
  return crests.map((row) => (row.teamLogo ? { ...row, teamLogo: U4_CREST } : row));
}

/** 詳情截圖畫正式列表（.cp3-m 與即時／已更正標籤），不是 LiveDetailList。 */
function OfficialList({ entries }: { entries: readonly SummaryEntry[] }) {
  const ct = ctOrKey(useCompetitionsT());
  const groups = groupSchedule(entries, DETAIL_NOW, scheduleLabels(ct));
  return <MatchSchedule ct={ct} groups={groups} standings={[]} crests={[]} />;
}

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
  if (name === 'u4-detail-live') return <OfficialList entries={LIVE_ENTRIES} />;
  if (name === 'u4-detail-corrected-pk') return <OfficialList entries={CORRECTED_ENTRIES} />;
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
        crests={shotCrests(scene.crests)}
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
