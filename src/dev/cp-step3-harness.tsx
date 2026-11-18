// 賽事第 3 步（賽程與比分）畫面預覽 harness（只在本機 vite 開 /dev-harness/cp-step3.html；正式 build 不含）。
// 資料全部是記憶體假資料，不連 Firestore、不呼叫 Functions；元件用 FC-B 真元件與 tokens。
// 參數：?screen=<名稱>&theme=light|dark
import { render } from 'preact';
import type { ComponentChildren, JSX } from 'preact';
import { LocationProvider } from 'preact-iso';
import '../styles/legacy-vars.css';
import '../styles/tokens.css';
import '../styles/base.css';
import '@/features/competitions/competitions.css';
import './cp-step3-harness.css';
import { setLocale } from '@/i18n/i18n';
import { Badge } from '@/ui/Badge';
import { BottomSheet } from '@/ui/BottomSheet';
import { Button } from '@/ui/Button';
import { Checkbox } from '@/ui/Checkbox';
import { Input } from '@/ui/Input';
import { Modal } from '@/ui/Modal';
import { RadioGroup } from '@/ui/RadioGroup';
import { Select } from '@/ui/Select';
import { Tabs } from '@/ui/Tabs';
import { Textarea } from '@/ui/Textarea';

const params = new URLSearchParams(location.search);
const screenName = params.get('screen') || 'list';
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.setAttribute('data-theme', theme);
const noop = (): void => undefined;

// ── 新文案登記（預覽頁旁邊要逐字列出，待站長確認）──────────────────────────
interface CopyItem { key: string; where: string; text: string }
const COPY: CopyItem[] = [];
function c(key: string, where: string, text: string): string {
  if (!COPY.some((x) => x.key === key)) COPY.push({ key, where, text });
  return text;
}
(window as unknown as { __CPS_COPY: CopyItem[] }).__CPS_COPY = COPY;

const T = {
  tagIn: () => c('tagIn', '賽事列表：站內賽事卡的小標籤', '站內賽事'),
  tagOut: () => c('tagOut', '賽事列表：外部賽事卡的小標籤', '外部賽事'),
  stRecruit: () => c('stRecruit', '賽事狀態徽章', '招募中'),
  stWarm: () => c('stWarm', '賽事狀態徽章', '預熱中'),
  stLive: () => c('stLive', '賽事狀態徽章', '進行中'),
  stDone: () => c('stDone', '賽事狀態徽章', '已結束'),
  today: (n: number, t: string) => c('today', '列表進行中卡：今日場數與下一場（數字與時間隨實際變動）', `今天 ${n} 場・下一場 ${t}`),
  champLine: (n: string) => c('champLine', '列表已結束卡：冠軍隊名', `冠軍　${n}`),
  deadline: (d: string) => c('deadline', '招募中：報名截止', `報名截止　${d}`),
  countdown: (n: number) => c('countdown', '預熱中：距開賽天數（數字隨實際變動）', `距開賽 ${n} 天`),
  tabSched: () => c('tabSched', '賽事詳情分頁', '賽程'),
  tabStand: () => c('tabStand', '賽事詳情分頁', '積分'),
  pending: () => c('pending', '場次狀態小標（公開與主辦）', '待確認'),
  forfeit: () => c('forfeit', '場次狀態小標（公開與主辦）', '棄權'),
  tie: () => c('tie', '積分榜：同分且未裁定時，名次下方的小標', '同分'),
  champ: () => c('champ', '已結束頂部：冠軍', '冠軍'),
  foldSched: (n: number) => c('foldSched', '已結束：賽程展開列（場數隨實際變動）', `賽程（${n} 場）`),
  tbd: () => c('tbd', '場次時間尚未定：時間欄', '時間待定'),
  hostSchedTitle: () => c('hostSchedTitle', '主辦：排賽程頁標題', '排賽程'),
  format: () => c('format', '排賽程：賽制欄', '賽制'),
  single: () => c('single', '排賽程：賽制選項', '單循環'),
  double: () => c('double', '排賽程：賽制選項', '雙循環'),
  minutes: () => c('minutes', '排賽程：每場分鐘數', '每場分鐘數'),
  buffer: () => c('buffer', '排賽程：場間緩衝', '場間緩衝（分鐘）'),
  matchDay: () => c('matchDay', '排賽程：比賽日', '比賽日'),
  addDay: () => c('addDay', '排賽程：新增比賽日按鈕', '新增比賽日'),
  removeDay: () => c('removeDay', '排賽程：移除比賽日', '移除'),
  venues: () => c('venues', '排賽程：使用場地', '使用場地'),
  preview: () => c('preview', '排賽程：預覽按鈕', '預覽'),
  previewOk: (m: number, d: number, p: number) => c('previewOk', '排賽程：預覽結果（數字隨實際變動）', `共 ${m} 場、需 ${d} 天、每隊 ${p} 場`),
  previewBad: (n: number) => c('previewBad', '排賽程：排不下的錯誤（數字隨實際變動）', `還有 ${n} 場排不下，請加比賽日或場地`),
  generate: () => c('generate', '排賽程：產生賽程按鈕', '產生賽程'),
  hostListTitle: () => c('hostListTitle', '主辦：賽程管理頁標題', '賽程管理'),
  stSched: () => c('stSched', '主辦賽程管理：場次狀態', '未賽'),
  stConfirmed: () => c('stConfirmed', '主辦賽程管理：場次狀態', '已確認'),
  stMoved: () => c('stMoved', '主辦賽程管理：場次狀態', '改期'),
  enterScore: () => c('enterScore', '主辦賽程管理：登錄比分按鈕', '登錄比分'),
  confirm: () => c('confirm', '主辦賽程管理：確認按鈕', '確認'),
  reschedule: () => c('reschedule', '主辦賽程管理：改期按鈕', '改期'),
  resetBtn: () => c('resetBtn', '主辦賽程管理：已確認或棄權場次的重置按鈕', '重置'),
  sheetTitle: () => c('sheetTitle', '登錄比分面板標題', '登錄比分'),
  saveConfirm: () => c('saveConfirm', '登錄比分面板：主按鈕', '登錄並確認'),
  saveLater: () => c('saveLater', '登錄比分面板：次按鈕', '先登錄，稍後確認'),
  toForfeit: () => c('toForfeit', '登錄比分面板：切到棄權的文字連結', '改登錄棄權'),
  forfeitTitle: () => c('forfeitTitle', '棄權面板標題', '登錄棄權'),
  forfeitWho: () => c('forfeitWho', '棄權面板：選哪一隊', '棄權隊伍'),
  forfeitReason: () => c('forfeitReason', '棄權面板：原因（必填）', '棄權原因'),
  forfeitHint: () => c('forfeitHint', '棄權面板：判定比分提示', '棄權方判 0：2'),
  forfeitOk: () => c('forfeitOk', '棄權面板：送出按鈕', '確認棄權'),
  resetTitle: () => c('resetTitle', '重置對話框標題', '重置比分'),
  resetBody: () => c('resetBody', '重置對話框內文', '重置後比分歸零，積分榜會重算'),
  resetReason: () => c('resetReason', '重置對話框：原因（必填）', '重置原因'),
  reschedTitle: () => c('reschedTitle', '改期面板標題', '改期'),
  reschedTbd: () => c('reschedTbd', '改期面板：待定勾選', '待定'),
  reschedOk: () => c('reschedOk', '改期面板：送出按鈕', '確認改期'),
  cancel: () => c('cancel', '各面板：取消按鈕', '取消'),
};

// ── 假資料 ──────────────────────────────────────────────────────────────
type MatchState = 'sched' | 'pending' | 'done' | 'forfeit' | 'moved';
interface M { t: string; v: string; h: string; a: string; hs?: number; as?: number; st: MatchState; tbd?: boolean }
interface Day { label: string; ms: M[] }

const DAYS_WARM: Day[] = [
  { label: '1月9日　週六', ms: [
    { t: '09:00', v: '1號場', h: '海風隊', a: '山貓隊', st: 'sched' },
    { t: '09:00', v: '2號場', h: '青鳥隊', a: '赤焰隊', st: 'sched' },
    { t: '10:00', v: '1號場', h: '銀河隊', a: '雷霆隊', st: 'sched' },
    { t: '10:00', v: '2號場', h: '晨星隊', a: '飛燕隊', st: 'sched' },
  ] },
  { label: '1月10日　週日', ms: [
    { t: '09:00', v: '1號場', h: '海風隊', a: '青鳥隊', st: 'sched' },
    { t: '09:00', v: '2號場', h: '山貓隊', a: '銀河隊', st: 'sched' },
  ] },
];
const DAYS_LIVE: Day[] = [
  { label: '1月9日　週六（今天）', ms: [
    { t: '09:00', v: '1號場', h: '海風隊', a: '山貓隊', hs: 2, as: 1, st: 'done' },
    { t: '09:00', v: '2號場', h: '青鳥隊', a: '赤焰隊', hs: 3, as: 3, st: 'pending' },
    { t: '10:00', v: '1號場', h: '銀河隊', a: '雷霆隊', hs: 0, as: 2, st: 'forfeit' },
    { t: '14:30', v: '2號場', h: '晨星隊', a: '飛燕隊', st: 'sched' },
    { t: '15:30', v: '1號場', h: '海風隊', a: '赤焰隊', st: 'sched' },
  ] },
  { label: '1月10日　週日', ms: [
    { t: '09:00', v: '1號場', h: '山貓隊', a: '銀河隊', st: 'sched' },
    { t: '09:00', v: '2號場', h: '青鳥隊', a: '飛燕隊', st: 'sched' },
  ] },
];
const DAYS_HOST: Day[] = [
  { label: '1月9日　週六', ms: [
    { t: '09:00', v: '1號場', h: '海風隊', a: '山貓隊', hs: 2, as: 1, st: 'done' },
    { t: '09:00', v: '2號場', h: '青鳥隊', a: '赤焰隊', hs: 3, as: 3, st: 'pending' },
    { t: '10:00', v: '1號場', h: '銀河隊', a: '雷霆隊', hs: 0, as: 2, st: 'forfeit' },
    { t: '14:30', v: '2號場', h: '晨星隊', a: '飛燕隊', st: 'sched' },
    { t: '', v: '', h: '海風隊', a: '赤焰隊', st: 'moved', tbd: true },
  ] },
  { label: '1月10日　週日', ms: [
    { t: '09:00', v: '1號場', h: '山貓隊', a: '銀河隊', st: 'sched' },
  ] },
];

interface Row { n: string; p: number; w: number; d: number; l: number; gf: number; ga: number; pts: number; tie?: boolean }
const STAND_LIVE: Row[] = [
  { n: '海風隊', p: 4, w: 3, d: 1, l: 0, gf: 10, ga: 3, pts: 10 },
  { n: '山貓隊', p: 4, w: 3, d: 0, l: 1, gf: 8, ga: 4, pts: 9 },
  { n: '青鳥隊', p: 4, w: 2, d: 2, l: 0, gf: 7, ga: 3, pts: 8 },
  { n: '赤焰隊', p: 4, w: 2, d: 0, l: 2, gf: 8, ga: 7, pts: 6 },
  { n: '銀河隊', p: 4, w: 1, d: 2, l: 1, gf: 5, ga: 5, pts: 5, tie: true },
  { n: '雷霆隊', p: 4, w: 1, d: 2, l: 1, gf: 5, ga: 5, pts: 5, tie: true },
  { n: '示範市立第一高級中學足球隊', p: 4, w: 0, d: 1, l: 3, gf: 3, ga: 9, pts: 1 },
  { n: '飛燕隊', p: 4, w: 0, d: 0, l: 4, gf: 2, ga: 12, pts: 0 },
];
const STAND_DONE: Row[] = [
  { n: '海風隊', p: 7, w: 6, d: 1, l: 0, gf: 18, ga: 5, pts: 19 },
  { n: '山貓隊', p: 7, w: 5, d: 1, l: 1, gf: 15, ga: 8, pts: 16 },
  { n: '青鳥隊', p: 7, w: 4, d: 2, l: 1, gf: 13, ga: 7, pts: 14 },
  { n: '赤焰隊', p: 7, w: 3, d: 1, l: 3, gf: 11, ga: 11, pts: 10 },
  { n: '銀河隊', p: 7, w: 3, d: 0, l: 4, gf: 9, ga: 12, pts: 9 },
  { n: '雷霆隊', p: 7, w: 2, d: 1, l: 4, gf: 8, ga: 11, pts: 7 },
  { n: '晨星隊', p: 7, w: 1, d: 2, l: 4, gf: 6, ga: 15, pts: 5 },
  { n: '飛燕隊', p: 7, w: 0, d: 0, l: 7, gf: 3, ga: 14, pts: 0 },
];

// ── 共用小元件 ───────────────────────────────────────────────────────────
function BackIcon(): JSX.Element {
  return (<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>);
}
function ChevronIcon(): JSX.Element {
  return (<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>);
}
function TrophyIcon(): JSX.Element {
  return (<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4h8v5a4 4 0 0 1-8 0V4zM8 6H5v1a3 3 0 0 0 3 3M16 6h3v1a3 3 0 0 1-3 3M12 13v4M8 20h8M9 17h6" /></svg>);
}

// ── 隊徽：圓形；沒上傳時用隊名第一個字＋固定色（依隊伍 id 雜湊，同隊永遠同色）──
const CREST_COLORS = ['#0f766e', '#0e7490', '#7c2d12', '#9f1239', '#475569', '#3f6212', '#57534e', '#334155'];
const HAS_LOGO = new Set(['海風隊', '山貓隊']);
function crestColor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return CREST_COLORS[h % CREST_COLORS.length] ?? '#475569';
}
function logoUrl(name: string): string {
  const hue = name === '海風隊' ? 200 : 30;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="hsl(${hue},60%,40%)"/><path d="M32 10l18 8v14c0 11-8 18-18 22-10-4-18-11-18-22V18z" fill="#fff" opacity=".9"/><path d="M32 18l10 4v9c0 6-4 10-10 13-6-3-10-7-10-13v-9z" fill="hsl(${hue},60%,40%)"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
function Crest({ name, size = 24 }: { name: string; size?: number }): JSX.Element {
  const style = `width:${size}px;height:${size}px`;
  if (HAS_LOGO.has(name)) return <img class="cp3-crest" src={logoUrl(name)} alt="" style={style} />;
  const ch = [...name][0] ?? '?';
  return <span class="cp3-crest cp3-crest--txt" aria-hidden="true" style={`${style};background:${crestColor(name)};font-size:${Math.round(size * 0.48)}px`}>{ch}</span>;
}
let SHOW_CREST = false;

function Top({ title }: { title: string }): JSX.Element {
  return (
    <header class="cps-top">
      <button type="button" class="cps-iconbtn" aria-label="返回"><BackIcon /></button>
      <h1>{title}</h1>
    </header>
  );
}
function Card({ children, class: cls = '' }: { children: ComponentChildren; class?: string }): JSX.Element {
  return <section class={`cps-card ${cls}`}>{children}</section>;
}
function Frame({ title, children }: { title: string; children: ComponentChildren }): JSX.Element {
  return (
    <div class="cps-root">
      <Top title={title} />
      <div class="cps-stack">{children}</div>
    </div>
  );
}

type StatusKey = 'recruit' | 'warm' | 'live' | 'done';
function StatusBadge({ s }: { s: StatusKey }): JSX.Element {
  if (s === 'recruit') return <Badge tone="success" label={T.stRecruit()} size="sm" />;
  if (s === 'warm') return <Badge tone="info" label={T.stWarm()} size="sm" />;
  if (s === 'live') return <Badge tone="warning" label={T.stLive()} size="sm" />;
  return <Badge tone="neutral" label={T.stDone()} size="sm" />;
}

// ── 場次 ─────────────────────────────────────────────────────────────────
function whenText(m: M): JSX.Element {
  if (m.tbd) return <span class="cp3-m__when"><b>{T.tbd()}</b></span>;
  return <span class="cp3-m__when"><b>{m.t}</b>　{m.v}</span>;
}

function publicBadge(m: M): JSX.Element | null {
  if (m.st === 'pending') return <Badge tone="warning" label={T.pending()} size="sm" />;
  if (m.st === 'forfeit') return <Badge tone="danger" label={T.forfeit()} size="sm" />;
  if (m.st === 'moved') return <Badge tone="info" label={T.stMoved()} size="sm" />;
  return null;
}
function hostBadge(m: M): JSX.Element {
  if (m.st === 'sched') return <Badge tone="neutral" label={T.stSched()} size="sm" />;
  if (m.st === 'pending') return <Badge tone="warning" label={T.pending()} size="sm" />;
  if (m.st === 'done') return <Badge tone="success" label={T.stConfirmed()} size="sm" />;
  if (m.st === 'forfeit') return <Badge tone="danger" label={T.forfeit()} size="sm" />;
  return <Badge tone="info" label={T.stMoved()} size="sm" />;
}

function MatchRow({ m, host }: { m: M; host?: boolean }): JSX.Element {
  const hasScore = m.hs !== undefined && m.as !== undefined;
  return (
    <li class="cp3-m">
      <div class="cp3-m__top">
        {whenText(m)}
        {host && (m.st === 'done' || m.st === 'forfeit')
          ? <span class="cp3-tags">{hostBadge(m)}<Button variant="ghost" size="sm">{T.resetBtn()}</Button></span>
          : (host ? hostBadge(m) : publicBadge(m))}
      </div>
      <div class="cp3-m__vs">
        <span class="h">{SHOW_CREST ? <span class="cp3-tn cp3-tn--h"><em>{m.h}</em><Crest name={m.h} size={22} /></span> : m.h}</span>
        {hasScore ? <span class="s">{m.hs}：{m.as}</span> : <span class="s vs">vs</span>}
        <span class="a">{SHOW_CREST ? <span class="cp3-tn"><Crest name={m.a} size={22} /><em>{m.a}</em></span> : m.a}</span>
      </div>
      {host && (m.st === 'sched' || m.st === 'moved') && (
        <div class="cp3-m__act">
          <Button variant="ghost" size="sm">{T.reschedule()}</Button>
          {m.st === 'sched' && <Button variant="secondary" size="sm">{T.enterScore()}</Button>}
        </div>
      )}
      {host && m.st === 'pending' && (
        <div class="cp3-m__act">
          <Button variant="secondary" size="sm">{T.enterScore()}</Button>
          <Button variant="primary" size="sm">{T.confirm()}</Button>
        </div>
      )}
    </li>
  );
}

function Schedule({ days, host }: { days: Day[]; host?: boolean }): JSX.Element {
  return (
    <div>
      {days.map((d) => (
        <div key={d.label}>
          <h4 class="cp3-day">{d.label}</h4>
          <Card><ul class="cp3-ml">{d.ms.map((m, i) => <MatchRow key={i} m={m} host={host} />)}</ul></Card>
          <div style="height:12px" />
        </div>
      ))}
    </div>
  );
}

// ── 積分榜 ───────────────────────────────────────────────────────────────
function Standings({ rows }: { rows: Row[] }): JSX.Element {
  const rank = (i: number): number => {
    let r = i;
    while (r > 0 && rows[r - 1].pts === rows[i].pts && rows[r - 1].tie && rows[i].tie) r -= 1;
    return r + 1;
  };
  return (
    <Card class="cp3-st">
      <div class="cp3-st__r cp3-st__r--h">
        <span>名次</span><span class="t">隊名</span><span>賽</span><span>勝</span><span>和</span><span>負</span><span>進/失</span><span>淨勝</span><span>積分</span>
      </div>
      {rows.map((r, i) => {
        const diff = r.gf - r.ga;
        return (
          <div key={r.n} class={`cp3-st__r${i === 0 ? ' cp3-st__r--top' : ''}`}>
            <span class="rk">{rank(i)}{r.tie && <small>{T.tie()}</small>}</span>
            <span class="t">{SHOW_CREST ? <span class="cp3-tn"><Crest name={r.n} size={20} /><em>{r.n}</em></span> : r.n}</span>
            <span>{r.p}</span><span>{r.w}</span><span>{r.d}</span><span>{r.l}</span>
            <span>{r.gf}/{r.ga}</span>
            <span>{diff > 0 ? `+${diff}` : diff}</span>
            <span class="pt">{r.pts}</span>
          </div>
        );
      })}
    </Card>
  );
}

// ── 1. 賽事列表 ──────────────────────────────────────────────────────────
function InAppCard({ name, s, line, hl }: { name: string; s: StatusKey; line: string; hl?: boolean }): JSX.Element {
  return (
    <Card>
      <div class="cp3-row">
        <Badge tone="brand" variant="outline" label={T.tagIn()} size="sm" />
        <StatusBadge s={s} />
      </div>
      <h3 class="cp3-name" style="margin-top:8px">{name}</h3>
      <p class="cp3-meta">2027/01/09 – 01/10　示範運動公園</p>
      <p class={`cp3-meta${hl ? ' cp3-meta--hl' : ''}`}>{line}</p>
    </Card>
  );
}
function OutCard({ name, meta }: { name: string; meta: string }): JSX.Element {
  return (
    <Card>
      <div class="cp3-row"><Badge tone="neutral" variant="outline" label={T.tagOut()} size="sm" /></div>
      <h3 class="cp3-name" style="margin-top:8px">{name}</h3>
      <p class="cp3-meta">{meta}</p>
    </Card>
  );
}
function ListScreen(): JSX.Element {
  return (
    <Frame title="賽事">
      <InAppCard name="示範盃五人制足球賽" s="live" line={T.today(3, '14:30')} hl />
      <InAppCard name="冬季友誼盃" s="warm" line={T.countdown(3)} hl />
      <InAppCard name="新春迎新賽" s="recruit" line={T.deadline('12/20 23:59')} />
      <InAppCard name="秋季聯賽" s="done" line={T.champLine('海風隊')} hl />
      <OutCard name="全國青年足球公開賽" meta="2027/03/12 – 03/14　示範市" />
      <OutCard name="北區社區籃球邀請賽" meta="2027/02/20　示範縣" />
    </Frame>
  );
}

// ── 2. 賽事詳情四狀態 ────────────────────────────────────────────────────
function DetailTabs({ days, value }: { days: Day[]; value: 'sched' | 'stand' }): JSX.Element {
  return (
    <Tabs
      label="賽事內容"
      variant="underline"
      value={value}
      onValueChange={noop}
      items={[
        { id: 'sched', label: T.tabSched(), panel: <div style="margin-top:12px"><Schedule days={days} /></div> },
        { id: 'stand', label: T.tabStand(), panel: <div style="margin-top:12px"><Standings rows={STAND_LIVE} /></div> },
      ]}
    />
  );
}

function DetailRecruit(): JSX.Element {
  return (
    <Frame title="示範盃五人制足球賽">
      <Card>
        <div class="cp3-strip">
          <span class="cp3-strip__txt">{T.deadline('12/20 23:59')}</span>
          <StatusBadge s="recruit" />
        </div>
      </Card>
      <Card>
        <dl class="cps-rows">
          <div class="cps-row"><dt>日期</dt><dd>2027/01/09 – 01/10</dd></div>
          <div class="cps-row"><dt>地點</dt><dd>示範運動公園</dd></div>
          <div class="cps-row"><dt>已報名</dt><dd>5／8 隊</dd></div>
        </dl>
      </Card>
      <div class="cps-actions"><Button variant="primary">報名參賽</Button></div>
    </Frame>
  );
}

function DetailWarm(): JSX.Element {
  return (
    <Frame title="示範盃五人制足球賽">
      <Card>
        <div class="cp3-strip">
          <span class="cp3-strip__txt">{T.countdown(3)}</span>
          <StatusBadge s="warm" />
        </div>
      </Card>
      <DetailTabs days={DAYS_WARM} value="sched" />
    </Frame>
  );
}

function DetailLive({ tab }: { tab: 'sched' | 'stand' }): JSX.Element {
  return (
    <Frame title="示範盃五人制足球賽">
      <Card>
        <div class="cp3-strip">
          <span class="cp3-strip__txt">{T.today(3, '14:30')}</span>
          <StatusBadge s="live" />
        </div>
      </Card>
      <DetailTabs days={DAYS_LIVE} value={tab} />
    </Frame>
  );
}

function DetailDone({ open }: { open: boolean }): JSX.Element {
  return (
    <Frame title="秋季聯賽">
      <Card class="cps-card--ok">
        <div class="cp3-row">
          <div class="cp3-champ">
            <TrophyIcon />
            <div class="cp3-champ__t">
              <span class="cp3-champ__k">{T.champ()}</span>
              <span class="cp3-champ__v">海風隊</span>
            </div>
          </div>
          <StatusBadge s="done" />
        </div>
      </Card>
      <Standings rows={STAND_DONE} />
      <Card>
        <button type="button" class={`cp3-fold${open ? ' cp3-fold--open' : ''}`} aria-expanded={open}>
          <span>{T.foldSched(28)}</span><ChevronIcon />
        </button>
        {open && <div style="margin-top:12px"><Schedule days={DAYS_DONE} /></div>}
      </Card>
    </Frame>
  );
}
const DAYS_DONE: Day[] = [
  { label: '1月9日　週六', ms: [
    { t: '09:00', v: '1號場', h: '海風隊', a: '山貓隊', hs: 2, as: 1, st: 'done' },
    { t: '09:00', v: '2號場', h: '青鳥隊', a: '赤焰隊', hs: 3, as: 3, st: 'done' },
    { t: '10:00', v: '1號場', h: '銀河隊', a: '雷霆隊', hs: 0, as: 2, st: 'forfeit' },
  ] },
];

// ── 4. 排賽程 ────────────────────────────────────────────────────────────
function DayForm({ n, date }: { n: number; date: string }): JSX.Element {
  return (
    <div class="cp3-dayform">
      <div class="cp3-dayform__h"><span>第 {n} 天</span>{n > 1 && <Button variant="ghost" size="sm">{T.removeDay()}</Button>}</div>
      <div class="cps-fields">
        <Input label="日期" value={date} />
        <div class="cps-grid2"><Input label="開始" value="09:00" /><Input label="結束" value="18:00" /></div>
      </div>
    </div>
  );
}

function HostSchedule({ result }: { result: 'none' | 'ok' | 'bad' }): JSX.Element {
  return (
    <Frame title={T.hostSchedTitle()}>
      <p class="cps-sub" style="margin:0">示範盃五人制足球賽</p>
      <Card>
        <div class="cps-fields">
          <RadioGroup
            label={T.format()}
            value="single"
            onValueChange={noop}
            orientation="horizontal"
            options={[{ value: 'single', label: T.single() }, { value: 'double', label: T.double() }]}
          />
          <div class="cps-grid2">
            <Input label={T.minutes()} type="number" value="40" />
            <Input label={T.buffer()} type="number" value="10" />
          </div>
        </div>
      </Card>
      <Card>
        <h3 class="cp3-sec-h">{T.matchDay()}</h3>
        <DayForm n={1} date="2027/01/09" />
        <DayForm n={2} date="2027/01/10" />
        <div class="cps-actions"><Button variant="secondary">{T.addDay()}</Button></div>
      </Card>
      <Card>
        <h3 class="cp3-sec-h">{T.venues()}</h3>
        <div class="cp3-checks">
          <Checkbox label="1號場" checked onCheckedChange={noop} />
          <Checkbox label="2號場" checked onCheckedChange={noop} />
          <Checkbox label="3號場" checked={false} onCheckedChange={noop} />
        </div>
      </Card>
      <div class="cps-actions" style="margin-top:0"><Button variant="secondary">{T.preview()}</Button></div>
      {result === 'ok' && <Card class="cps-card--ok"><p class="cp3-result">{T.previewOk(28, 2, 7)}</p></Card>}
      {result === 'bad' && <Card class="cps-card--warn"><p class="cp3-result--bad">{T.previewBad(5)}</p></Card>}
      <div class="cps-actions" style="margin-top:0"><Button variant="primary" disabled={result !== 'ok'}>{T.generate()}</Button></div>
    </Frame>
  );
}

// ── 5. 賽程管理 ──────────────────────────────────────────────────────────
function HostMatches(): JSX.Element {
  return (
    <Frame title={T.hostListTitle()}>
      <p class="cps-sub" style="margin:0">示範盃五人制足球賽</p>
      <Schedule days={DAYS_HOST} host />
    </Frame>
  );
}

// ── 6～8. 面板 ───────────────────────────────────────────────────────────
function Stepper2({ name, n }: { name: string; n: number }): JSX.Element {
  return (
    <div class="cp3-score__team">
      <span class="cp3-score__name">{name}</span>
      <div class="cp3-score__num">{n}</div>
      <div class="cp3-score__btns">
        <button type="button" class="cp3-stepbtn" aria-label="減一分">−</button>
        <button type="button" class="cp3-stepbtn" aria-label="加一分">＋</button>
      </div>
    </div>
  );
}

function ScoreSheet(): JSX.Element {
  return (
    <>
      <HostMatches />
      <BottomSheet open title={T.sheetTitle()} onClose={noop}>
        <div class="cps-sheet-body">
          <p class="cp3-ctx">09:00　2號場</p>
          <div class="cp3-score">
            <Stepper2 name="青鳥隊" n={3} />
            <span class="cp3-score__colon">：</span>
            <Stepper2 name="赤焰隊" n={3} />
          </div>
          <div class="cp3-stack-btns">
            <Button variant="primary">{T.saveConfirm()}</Button>
            <Button variant="secondary">{T.saveLater()}</Button>
          </div>
          <button type="button" class="cp3-textlink">{T.toForfeit()}</button>
        </div>
      </BottomSheet>
    </>
  );
}

function ForfeitSheet(): JSX.Element {
  return (
    <>
      <HostMatches />
      <BottomSheet
        open
        title={T.forfeitTitle()}
        onClose={noop}
        footer={<div class="cps-footer"><Button variant="secondary">{T.cancel()}</Button><Button variant="danger">{T.forfeitOk()}</Button></div>}
      >
        <div class="cps-sheet-body">
          <RadioGroup
            label={T.forfeitWho()}
            value="a"
            onValueChange={noop}
            options={[{ value: 'h', label: '青鳥隊' }, { value: 'a', label: '赤焰隊' }]}
          />
          <Textarea label={T.forfeitReason()} required value="" onValueChange={noop} maxLength={200} />
          <p class="cp3-judge">{T.forfeitHint()}</p>
        </div>
      </BottomSheet>
    </>
  );
}

function ResetDialog(): JSX.Element {
  return (
    <>
      <HostMatches />
      <Modal
        open
        title={T.resetTitle()}
        onClose={noop}
        footer={<div class="cps-footer"><Button variant="secondary">{T.cancel()}</Button><Button variant="danger">{T.resetBtn()}</Button></div>}
      >
        <div class="cps-sheet-body">
          <p class="cp3-modal-p">{T.resetBody()}</p>
          <Textarea label={T.resetReason()} required value="" onValueChange={noop} maxLength={200} />
        </div>
      </Modal>
    </>
  );
}

function RescheduleSheet({ tbd }: { tbd: boolean }): JSX.Element {
  return (
    <>
      <HostMatches />
      <BottomSheet
        open
        title={T.reschedTitle()}
        onClose={noop}
        footer={<div class="cps-footer"><Button variant="secondary">{T.cancel()}</Button><Button variant="primary">{T.reschedOk()}</Button></div>}
      >
        <div class="cps-sheet-body">
          <p class="cp3-ctx">晨星隊　vs　飛燕隊</p>
          <Checkbox label={T.reschedTbd()} checked={tbd} onCheckedChange={noop} />
          <div class="cps-grid2">
            <Input label="日期" value={tbd ? '' : '2027/01/10'} disabled={tbd} />
            <Input label="時間" value={tbd ? '' : '10:00'} disabled={tbd} />
          </div>
          <Select
            label="場地"
            value="v1"
            disabled={tbd}
            onValueChange={noop}
            options={[{ value: 'v1', label: '1號場' }, { value: 'v2', label: '2號場' }, { value: 'v3', label: '3號場' }]}
          />
        </div>
      </BottomSheet>
    </>
  );
}


// ── 封面＋隊徽（站長 2026-11-18 追加）─────────────────────────────────────
function coverPhoto(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 300"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(150,45%,62%)"/><stop offset="1" stop-color="hsl(150,55%,30%)"/></linearGradient></defs><rect width="800" height="300" fill="url(#g)"/><g fill="none" stroke="rgba(255,255,255,.55)" stroke-width="4"><rect x="40" y="150" width="720" height="140"/><line x1="400" y1="150" x2="400" y2="290"/><circle cx="400" cy="220" r="40"/></g><circle cx="640" cy="80" r="34" fill="rgba(255,255,255,.75)"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
function DetailCover({ custom, tab }: { custom?: boolean; tab: 'sched' | 'stand' }): JSX.Element {
  return (
    <Frame title="示範盃五人制足球賽">
      <div class="cp3-cover">
        {custom ? <img src={coverPhoto()} alt="" /> : <div class="cp3-cover__def cp3-cover__def--league" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7l4 3-1.5 4.5h-5L8 10z" /><path d="M12 3v4M21 10l-5 0M3 10l5 0M7 20l2.5-5.5M17 20l-2.5-5.5" /></svg></div>}
        <span class="cp3-cover__cat">聯賽</span>
      </div>
      <Card>
        <div class="cp3-strip">
          <span class="cp3-strip__txt">{T.today(3, '14:30')}</span>
          <StatusBadge s="live" />
        </div>
      </Card>
      <DetailTabs days={DAYS_LIVE} value={tab} />
    </Frame>
  );
}
function CrestSheet(): JSX.Element {
  const names = ['海風隊', '山貓隊', '青鳥隊', '赤焰隊', '銀河隊', '雷霆隊', '晨星隊', '飛燕隊', '示範市立第一高級中學足球隊'];
  return (
    <Frame title="隊徽與沒有隊徽時">
      <Card>
        <p class="cp3-sec-h">有上傳隊徽（圓形裁切）</p>
        <div class="cp3-crest-row">{names.slice(0, 2).map((n) => <span key={n} class="cp3-crest-cell"><Crest name={n} size={48} /><small>{n}</small></span>)}</div>
      </Card>
      <Card>
        <p class="cp3-sec-h">沒有隊徽：隊名第一個字＋固定底色</p>
        <div class="cp3-crest-row">{names.slice(2).map((n) => <span key={n} class="cp3-crest-cell"><Crest name={n} size={48} /><small>{n}</small></span>)}</div>
      </Card>
      <Card>
        <p class="cp3-sec-h">各處尺寸</p>
        <div class="cp3-crest-row">
          {[64, 48, 32, 22, 20].map((z) => <span key={z} class="cp3-crest-cell"><Crest name="青鳥隊" size={z} /><small>{z}px</small></span>)}
        </div>
      </Card>
    </Frame>
  );
}

// ── 畫面路由 ────────────────────────────────────────────────────────────
function Screen(): JSX.Element {
  switch (screenName) {
    case 'list': return <ListScreen />;
    case 'detail-recruit': return <DetailRecruit />;
    case 'detail-warm': return <DetailWarm />;
    case 'detail-live': return <DetailLive tab="sched" />;
    case 'standings': return <DetailLive tab="stand" />;
    case 'detail-done': return <DetailDone open={false} />;
    case 'detail-done-open': return <DetailDone open />;
    case 'host-schedule': return <HostSchedule result="ok" />;
    case 'host-schedule-bad': return <HostSchedule result="bad" />;
    case 'host-matches': return <HostMatches />;
    case 'score-sheet': return <ScoreSheet />;
    case 'forfeit-sheet': return <ForfeitSheet />;
    case 'reset-dialog': return <ResetDialog />;
    case 'reschedule': return <RescheduleSheet tbd={false} />;
    case 'reschedule-tbd': return <RescheduleSheet tbd />;
    case 'cover-live': SHOW_CREST = true; return <DetailCover custom tab="sched" />;
    case 'cover-default': SHOW_CREST = true; return <DetailCover tab="stand" />;
    case 'crest-sheet': return <CrestSheet />;
    default: return <ListScreen />;
  }
}

void setLocale('zh-TW').then(() => {
  render(
    <LocationProvider>
      <Screen />
    </LocationProvider>,
    document.getElementById('app')!,
  );
  (window as unknown as { __CPS_READY: boolean }).__CPS_READY = true;
});
