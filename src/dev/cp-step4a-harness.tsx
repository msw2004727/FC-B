// 賽事第 4 步預覽截圖。只畫 live/ 元件＋假資料，不連 Firestore、不呼叫 Functions、不進正式路由。
// ?screen= 與 ?theme=light|dark。畫完設 window.__CPS_READY；面板由這裡點正式按鈕打開。
import { render } from 'preact';
import '../styles/tokens.css';
import '../styles/base.css';
import '@/features/competitions/live/live.css';
import './cp-step4a-harness.css';
import { setLocale } from '@/i18n/i18n';
import { LiveDetailList } from '@/features/competitions/live/LiveDetailList';
import { LiveMatchView } from '@/features/competitions/live/LiveMatchView';
import { ScorePad } from '@/features/competitions/live/ScorePad';
import { ScorersTable } from '@/features/competitions/live/ScorersTable';
import { derivePublicTable } from '@/features/competitions/live/stats';
import {
  S4_CONFIRMED,
  S4_DETAIL_ROWS,
  S4_PEOPLE,
  S4_SCENE_LIVE,
  S4_SCORE_SCENES,
  S4A_SCREENS,
} from '@/features/competitions/testing/step4-fixtures';

const params = new URLSearchParams(location.search);
const screenName = params.get('screen') || 'score-live';
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.setAttribute('data-theme', theme);

const ANCHORS: Record<string, string> = {
  'score-pre': '開賽',
  'score-live': '34:00',
  'score-pick-player': '不指定球員',
  'score-card-yellow': '點一下關閉',
  'score-card-red-auto': '第二張黃牌 → 紅牌',
  'score-halftime': '下半場開始',
  'score-fulltime-undo': '2:41',
  'score-unapplied': '另一支裝置可能也在記這場',
  'score-takeover': '接手記分',
  'score-offline': '重整後會消失',
  'score-paused': '繼續計時',
  'score-amend': '會先復原原紀錄，再記新的',
  'score-cap': '紀錄已達上限，請由主辦在賽後登錄比分',
  'score-undo-half': '第二張黃牌已復原，第一張黃牌仍在',
  'live-detail': '比分已更正',
  'live-match': '比賽紀錄',
  'live-scorers': '劉冠廷',
};

/** 復原半成功：第一筆（第二張黃牌）成功，第二筆（第一張黃牌）失敗。計數放元件外，重繪不會歸零。 */
let undoHalfCalls = 0;

function Screen() {
  if (screenName === 'score-undo-half') {
    return (
      <ScorePad
        {...S4_SCENE_LIVE}
        onUndo={() => {
          undoHalfCalls += 1;
          return undoHalfCalls === 1;
        }}
      />
    );
  }
  if (screenName in S4_SCORE_SCENES) {
    const scene = S4_SCORE_SCENES[screenName as keyof typeof S4_SCORE_SCENES];
    return <ScorePad {...scene} />;
  }
  if (screenName === 'live-detail') return <LiveDetailList rows={S4_DETAIL_ROWS} />;
  if (screenName === 'live-match') {
    const scene = S4_SCENE_LIVE;
    return (
      <LiveMatchView
        match={scene.match}
        clock={scene.clock}
        events={scene.events}
        voids={scene.voids}
        homeRoster={scene.homeRoster}
        awayRoster={scene.awayRoster}
        crests={scene.crests}
      />
    );
  }
  if (screenName === 'live-scorers') {
    const table = derivePublicTable(S4_CONFIRMED, S4_PEOPLE);
    return <ScorersTable scorers={table.scorers} cards={table.cards} />;
  }
  return <p class="s4a-miss">沒有這個 screen：{screenName}</p>;
}

function buttonsNamed(name: string): HTMLButtonElement[] {
  return [...document.querySelectorAll('button')].filter((node) => (node.textContent ?? '').replace(/\s+/g, ' ').trim() === name);
}

function clickButton(name: string, index = 0): void {
  const node = buttonsNamed(name)[index];
  if (!node) throw new Error(`找不到按鈕：${name}`);
  node.click();
}

function clickLabel(part: string): void {
  const node = [...document.querySelectorAll('button')].find((el) => (el.getAttribute('aria-label') || '').includes(part));
  if (!node) throw new Error(`找不到按鈕：${part}`);
  node.click();
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

/** 面板類：點正式按鈕，不靠預覽旗標直接打開。 */
const OPEN: Record<string, () => Promise<void>> = {
  'score-pick-player': async () => {
    clickButton('進球', 0);
    await until('背號選擇', () => hasText('不指定球員') && hasText('一般'));
  },
  'score-card-yellow': async () => {
    clickLabel("12' 黃牌");
    await until('事件面板', () => hasText('看這張牌'));
    clickButton('看這張牌');
    await until('黃牌亮牌', () => hasText('點一下關閉') && !!document.querySelector('.s4-flash--yellow'));
  },
  'score-card-red-auto': async () => {
    clickLabel('第二張黃牌');
    await until('事件面板', () => hasText('看這張牌'));
    clickButton('看這張牌');
    await until('第二張黃牌', () => hasText('第二張黃牌 → 紅牌') && !!document.querySelector('.s4-flash--red'));
  },
  'score-amend': async () => {
    clickLabel("5' 進球");
    await until('改判', () => hasText('會先復原原紀錄，再記新的') && hasText('復原') && hasText('改判'));
  },
  'score-undo-half': async () => {
    clickLabel("12' 黃牌");
    await until('事件面板', () => hasText('會先復原原紀錄，再記新的'));
    clickButton('復原');
    await until('確認', () => hasText('會一併復原第二張黃牌'));
    clickButton('確定復原');
    await until('半成功', () => hasText('第二張黃牌已復原，第一張黃牌仍在'));
  },
  'score-unapplied': async () => {
    clickButton('未套用的動作');
    await until('未套用', () => hasText('另一支裝置可能也在記這場') && hasText('重新套用') && hasText('捨棄'));
  },
  'score-takeover': async () => {
    clickButton('其他裝置記分中');
    await until('接手', () => hasText('這場目前由另一支裝置記分') && hasText('接手記分') && hasText('先不要'));
  },
};

void start();

async function start(): Promise<void> {
  await setLocale('zh-TW');
  const root = document.getElementById('app');
  const win = window as unknown as { __CPS_COPY: unknown[]; __CPS_READY: boolean; __CPS_ERROR?: string };
  win.__CPS_COPY = [];
  if (!root) return;
  try {
    if (!(S4A_SCREENS as readonly string[]).includes(screenName)) {
      throw new Error(`沒有這個 screen：${screenName}`);
    }
    render(<Screen />, root);
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    await OPEN[screenName]?.();
    const anchor = ANCHORS[screenName];
    if (anchor) await until(anchor, () => hasText(anchor));
    win.__CPS_READY = true;
  } catch (err) {
    win.__CPS_ERROR = err instanceof Error ? err.message : String(err);
  }
}
