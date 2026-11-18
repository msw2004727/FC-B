// 賽事第 3 步「賽事列表 v2」預覽 harness（只在本機打包截圖；正式 build 不含）。
// 站長 2026-11-18：列表對應現行「賽事」頁籤分類、站內與外部賽事各自分頁與篩選、每場比賽有封面、分類固定專屬色。
// 版面直接用正式賽事頁的 class（tournaments.css＋液態玻璃），新增的部分以 cpl- 前綴另寫。
// 參數：?screen=in|in-cup|in-mine|ext|gate-off&theme=light|dark
import { render } from 'preact';
import type { JSX } from 'preact';
import '../styles/legacy-vars.css';
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/legacy/base.css';
import '../styles/legacy/layout.css';
import '../styles/legacy-line-height.css';
import '@/features/tournaments/tournaments.css';
import '@/features/tournaments/legacy/tournaments-glass.css';
import './cp-step3-list-harness.css';
import { setLocale } from '@/i18n/i18n';

const params = new URLSearchParams(location.search);
const screenName = params.get('screen') || 'in';
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.setAttribute('data-theme', theme);

interface CopyItem { key: string; where: string; text: string }
const COPY: CopyItem[] = [];
function c(key: string, where: string, text: string): string {
  if (!COPY.some((x) => x.key === key)) COPY.push({ key, where, text });
  return text;
}
(window as unknown as { __CPS_COPY: CopyItem[] }).__CPS_COPY = COPY;

type Cat = 'league' | 'cup' | 'friendly';
const CAT_LABEL: Record<Cat, string> = { league: '聯賽', cup: '盃賽', friendly: '友誼賽' };
type St = 'recruit' | 'warm' | 'live' | 'done';
const ST_LABEL: Record<St, string> = { recruit: '招募中', warm: '預熱中', live: '進行中', done: '已結束' };

const T = {
  srcIn: () => c('srcIn', '賽事頁最上方切換：站內賽事', '站內賽事'),
  srcOut: () => c('srcOut', '賽事頁最上方切換：外部賽事', '外部賽事'),
  statusAll: () => c('statusAll', '站內賽事篩選：狀態預設值', '未結束'),
  mine: () => c('mine', '站內賽事篩選：只看自己主辦或參賽的', '只看我的'),
  showEnded: () => c('showEnded', '外部賽事篩選（沿用現行）', '顯示已結束'),
};

// 假封面：代表主辦上傳的照片（預覽用向量圖，正式為上傳圖片）。
function photo(hue: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 300"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue},45%,62%)"/><stop offset="1" stop-color="hsl(${hue},55%,30%)"/></linearGradient></defs><rect width="800" height="300" fill="url(#g)"/><g fill="none" stroke="rgba(255,255,255,.55)" stroke-width="4"><rect x="40" y="150" width="720" height="140"/><line x1="400" y1="150" x2="400" y2="290"/><circle cx="400" cy="220" r="40"/></g><circle cx="640" cy="80" r="34" fill="rgba(255,255,255,.75)"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function TrophyGlyph(): JSX.Element {
  return (<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4h8v5a4 4 0 0 1-8 0V4zM8 6H5v1a3 3 0 0 0 3 3M16 6h3v1a3 3 0 0 1-3 3M12 13v4M8 20h8M9 17h6" /></svg>);
}
function BallGlyph(): JSX.Element {
  return (<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7l4 3-1.5 4.5h-5L8 10z" /><path d="M12 3v4M21 10l-5 0M3 10l5 0M7 20l2.5-5.5M17 20l-2.5-5.5" /></svg>);
}
function HandGlyph(): JSX.Element {
  return (<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" /></svg>);
}

/** 沒上傳封面時的預設封面：分類色漸層＋分類圖示（只吃 CSS，不另讀圖）。 */
function DefaultCover({ cat }: { cat: Cat }): JSX.Element {
  return (
    <div class={`tc-card-img cpl-cover cpl-cover--${cat}`} aria-hidden="true">
      <span class="cpl-cover__glyph">{cat === 'cup' ? <TrophyGlyph /> : cat === 'league' ? <BallGlyph /> : <HandGlyph />}</span>
    </div>
  );
}

function CatChip({ cat }: { cat: Cat }): JSX.Element {
  return <span class={`tc-chip cpl-chip cpl-chip--${cat}`}>{CAT_LABEL[cat]}</span>;
}

interface InComp { name: string; cat: Cat; st: St; dates: string; line: string; cover?: number }
const IN: InComp[] = [
  { name: '示範盃五人制足球賽', cat: 'league', st: 'live', dates: '2027/01/09 – 01/10　示範運動公園', line: '今天 3 場・下一場 14:30' },
  { name: '冬季友誼盃', cat: 'cup', st: 'warm', dates: '2027/01/16 – 01/17　河濱足球場', line: '距開賽 3 天' },
  { name: '新春迎新友誼賽', cat: 'friendly', st: 'recruit', dates: '2027/02/06　示範國小', line: '報名截止　12/20 23:59' },
  { name: '春季社區聯賽', cat: 'league', st: 'recruit', dates: '2027/03/06 – 04/24　示範運動公園', line: '報名截止　01/31 23:59' },
];
const IN_DONE: InComp = { name: '秋季聯賽', cat: 'league', st: 'done', dates: '2026/10/03 – 11/21', line: '冠軍　海風隊' };

function InCard({ x }: { x: InComp }): JSX.Element {
  return (
    <div class={`tc-card cpl-card${x.st === 'done' ? ' ended' : ''}`}>
      <a class="tc-card-link" href="#" onClick={(e) => e.preventDefault()}>
        <div class="cpl-cover-wrap">
          {x.cover !== undefined ? <img class="tc-card-img img-preloaded" src={photo(x.cover)} alt="" /> : <DefaultCover cat={x.cat} />}
          <span class={`cpl-st cpl-st--${x.st}`}><i />{ST_LABEL[x.st]}</span>
        </div>
        <div class="tc-card-body">
          <div class="tc-card-text">
            <div class="tc-card-name">{x.name}</div>
            <div class="tc-card-dates">{x.dates}</div>
            <div class={`cpl-line${x.st === 'recruit' ? '' : ' cpl-line--hl'}`}>{x.line}</div>
          </div>
          <CatChip cat={x.cat} />
        </div>
      </a>
    </div>
  );
}

interface OutComp { name: string; cat: Cat; dates: string; hue: number; ended?: boolean }
const OUT: OutComp[] = [
  { name: '全國青年足球公開賽', cat: 'cup', dates: '2027/03/12 – 2027/03/14', hue: 120 },
  { name: '北區社區足球聯賽', cat: 'league', dates: '2027/02/20 – 2027/05/29', hue: 190 },
  { name: '春節三對三友誼賽', cat: 'friendly', dates: '2027/02/13', hue: 30 },
];

function OutCard({ x }: { x: OutComp }): JSX.Element {
  return (
    <div class={`tc-card${x.ended ? ' ended' : ''}`}>
      <a class="tc-card-link" href="#" onClick={(e) => e.preventDefault()}>
        <img class="tc-card-img img-preloaded" src={photo(x.hue)} alt="" />
        <div class="tc-card-body">
          <div class="tc-card-text">
            <div class="tc-card-name">{x.name}</div>
            <div class="tc-card-dates">{x.dates}</div>
          </div>
          <CatChip cat={x.cat} />
        </div>
      </a>
    </div>
  );
}

function Toggle({ label, on }: { label: string; on: boolean }): JSX.Element {
  return (
    <label>
      <span>{label}</span>
      <span class="toggle-switch"><input type="checkbox" checked={on} /><span class="toggle-slider" /></span>
    </label>
  );
}

const TABS = ['all', 'league', 'cup', 'friendly'] as const;
const TAB_LABEL: Record<(typeof TABS)[number], string> = { all: '全部', ...CAT_LABEL };

function Page({ src, tab, mine, gate }: { src: 'in' | 'out'; tab: (typeof TABS)[number]; mine?: boolean; gate: boolean }): JSX.Element {
  const inList = IN.filter((x) => tab === 'all' || x.cat === tab);
  const outList = OUT.filter((x) => tab === 'all' || x.cat === tab);
  return (
    <div class="legacy-ui tournaments-root">
      <section class="page active tc-page" id="page-tournaments">
        <div class="page-header">
          <button class="back-btn" type="button" aria-label="返回">
            <svg class="back-btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
          <h2 class="page-header-title">賽事</h2>
        </div>

        {gate && (
          <div class="cpl-src" role="tablist" aria-label="賽事來源">
            <button type="button" role="tab" aria-selected={src === 'in'} class={src === 'in' ? 'on' : ''}>{T.srcIn()}</button>
            <button type="button" role="tab" aria-selected={src === 'out'} class={src === 'out' ? 'on' : ''}>{T.srcOut()}</button>
          </div>
        )}

        <div class="tc-tabs" role="tablist">
          {TABS.map((v) => (
            <button key={v} type="button" role="tab" class={`tc-tab${tab === v ? ' active' : ''}`} aria-selected={tab === v}>{TAB_LABEL[v]}</button>
          ))}
        </div>
        <div class="tc-panel" role="tabpanel">
          {src === 'in' ? (
            <div class="tc-toolbar cpl-toolbar">
              <span class="cpl-select" role="button" aria-haspopup="listbox">{T.statusAll()}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg></span>
              <Toggle label={T.mine()} on={!!mine} />
            </div>
          ) : (
            <div class="tc-toolbar"><Toggle label={T.showEnded()} on /></div>
          )}
          {src === 'in'
            ? (mine ? [IN[0]!, IN[2]!] : inList).map((x) => <InCard key={x.name} x={x} />)
            : outList.map((x) => <OutCard key={x.name} x={x} />)}
          {src === 'out' && tab === 'all' && <OutCard x={{ name: '2026 秋季邀請賽', cat: 'cup', dates: '2026/10/10 – 2026/10/11', hue: 260, ended: true }} />}
        </div>
      </section>
    </div>
  );
}

function DoneDemo(): JSX.Element {
  return (
    <div class="legacy-ui tournaments-root">
      <section class="page active tc-page" id="page-tournaments">
        <div class="tc-panel" role="tabpanel" style="margin-top:12px">
          <InCard x={IN_DONE} />
        </div>
      </section>
    </div>
  );
}

function Screen(): JSX.Element {
  switch (screenName) {
    case 'in-cup': return <Page src="in" tab="cup" gate />;
    case 'in-mine': return <Page src="in" tab="all" mine gate />;
    case 'ext': return <Page src="out" tab="all" gate />;
    case 'gate-off': return <Page src="out" tab="all" gate={false} />;
    case 'in-done': return <DoneDemo />;
    default: return <Page src="in" tab="all" gate />;
  }
}

void setLocale('zh-TW').then(() => {
  render(<Screen />, document.getElementById('app')!);
  (window as unknown as { __CPS_READY: boolean }).__CPS_READY = true;
});
