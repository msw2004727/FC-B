// 賽事第 3 步追加功能畫面預覽（只在本機開 dev-harness/cp-step3-more.html；正式 build 不含）。
// 假資料、不連 Firestore。參數：?screen=<名稱>&theme=light|dark
import { render } from 'preact';
import type { ComponentChildren, JSX } from 'preact';
import { LocationProvider } from 'preact-iso';
import '../styles/legacy-vars.css';
import '../styles/tokens.css';
import '../styles/base.css';
import '@/features/competitions/competitions.css';
import './cp-step3-more-harness.css';
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
const screenName = params.get('screen') || 'cancel-sheet';
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.setAttribute('data-theme', theme);
const noop = (): void => undefined;

interface CopyItem { key: string; where: string; text: string }
const COPY: CopyItem[] = [];
function c(key: string, where: string, text: string): string {
  if (!COPY.some((item) => item.key === key)) COPY.push({ key, where, text });
  return text;
}
(window as unknown as { __CPS_COPY: CopyItem[] }).__CPS_COPY = COPY;

const T = {
  tie: () => c('tie', '積分榜名次下方小標（點了打開比較）', '同分'),
  tbd: () => c('tbd', '整場延期的時間欄，以及改期面板的待定勾選', '待定'),
  reason: () => c('reason', '原因一行的前綴', '原因'),
  cancelMatch: () => c('cancelMatch', '主辦賽程管理：取消單場按鈕與面板標題', '取消這場'),
  cancelOk: () => c('cancelOk', '取消單場面板主按鈕', '確認取消'),
  cancelReason: () => c('cancelReason', '取消單場：原因欄（必填，最多 100 字）', '取消原因'),
  cancelHint: () => c('cancelHint', '取消單場面板提示', '取消的場次不計分，之後可用重置恢復'),
  stCancelled: () => c('stCancelled', '單場或整場取消的狀態', '已取消'),
  endTitle: () => c('endTitle', '主辦結束賽事按鈕與對話框標題', '結束賽事'),
  endHint: () => c('endHint', '結束賽事對話框提示', '結束後不能再改比分；還沒確認的場次不計分'),
  endReason: () => c('endReason', '結束賽事：原因欄（必填，最多 100 字）', '結束原因'),
  unconfirmed: (n: number) => c('unconfirmed', '結束賽事：尚未確認場數（數字隨實際變動）', `未確認 ${n} 場`),
  endedLine: (d: string) => c('endedLine', '手動結束後詳情頂部（日期隨實際變動）', `主辦已於 ${d} 結束賽事`),
  restore: () => c('restore', '管理員恢復按鈕、對話框標題與主按鈕', '恢復賽事'),
  restoreReason: () => c('restoreReason', '恢復賽事：原因欄（必填，最多 100 字）', '恢復原因'),
  hostRuling: () => c('hostRuling', '裁定方式選項，以及儲存後名次下方小標', '主辦裁定'),
  drawLog: () => c('drawLog', '裁定方式選項', '抽籤結果登錄'),
  method: () => c('method', '裁定面板：方式', '方式'),
  rankOrder: () => c('rankOrder', '裁定面板：名次排列（拖曳示意）', '名次排列'),
  ruleReason: () => c('ruleReason', '裁定面板：原因（必填，最多 100 字）', '裁定原因'),
  saveRuling: () => c('saveRuling', '裁定面板主按鈕', '儲存'),
  hit: () => c('hit', '同分比較：這一項分出高下', '在這一項分出高下'),
  allSame: () => c('allSame', '同分比較：條件用盡', '全部相同，待主辦裁定'),
  related: () => c('related', '同分比較：相關場次', '相關場次'),
  critPts: () => c('critPts', '同分比較項目', '積分'),
  critH2hPts: () => c('critH2hPts', '同分比較項目', '直接對戰積分'),
  critH2hGd: () => c('critH2hGd', '同分比較項目', '直接對戰淨勝'),
  critGd: () => c('critGd', '同分比較項目', '全組淨勝'),
  critGf: () => c('critGf', '同分比較項目', '進球'),
  delayHint: (d: string) => c('delayHint', '改期超出原賽期（日期隨實際變動）', `末場日期將延後到 ${d}`),
  cap60: () => c('cap60', '改期可超出原賽期的上限', '上限 60 天'),
  clashArea: () => c('clashArea', '改期撞期：同一分區同時段', '北區同時段已有一場'),
  clashVenue: () => c('clashVenue', '改期撞期：同一場地同時段', '1號場同時段已有比賽'),
  autoPost: () => c('autoPost', '改期儲存後', '已自動發布公告'),
  shiftDay: () => c('shiftDay', '整天順延標題', '整天順延'),
  swapTwo: () => c('swapTwo', '兩場對調標題', '兩場對調'),
  matchDay: () => c('matchDay', '整天順延：比賽日', '比賽日'),
  newDate: () => c('newDate', '整天順延：新日期', '新日期'),
  affected: (n: number) => c('affected', '整天順延預覽（數字隨實際變動）', `受影響 ${n} 場`),
  shiftOk: () => c('shiftOk', '整天順延主按鈕', '確認順延'),
  firstMatch: () => c('firstMatch', '兩場對調：第一場', '第一場'),
  secondMatch: () => c('secondMatch', '兩場對調：第二場', '第二場'),
  swapOk: () => c('swapOk', '兩場對調主按鈕', '確認對調'),
  announce: () => c('announce', '詳情頁公告區標題', '公告'),
  system: () => c('system', '自動公告小標', '系統'),
  more: () => c('more', '公告超過 3 則', '更多'),
  annLabel: () => c('annLabel', '主辦發公告：內文（純文字）', '公告內容'),
  annLimit: () => c('annLimit', '主辦發公告：字數', '最多 300 字'),
  posted: (n: number, max: number) => c('posted', '主辦發公告：則數（數字隨實際變動，上限 20）', `已發 ${n}／${max} 則`),
  publish: () => c('publish', '主辦發公告主按鈕', '發布公告'),
  contact: () => c('contact', '詳情頁聯絡區標題', '聯絡主辦'),
  pmHost: () => c('pmHost', '站內私訊主辦按鈕', '私訊主辦'),
  contactField: () => c('contactField', '主辦編輯的公開聯絡文字', '聯絡文字'),
  publicHint: () => c('publicHint', '聯絡文字欄位下方', '會公開顯示'),
  rulesTitle: () => c('rulesTitle', '積分榜下方', '排序規則'),
  rule1: () => c('rule1', '排序規則第 1 行', '先比積分，高者在前'),
  rule2: () => c('rule2', '排序規則第 2 行', '積分相同，比直接對戰積分'),
  rule3: () => c('rule3', '排序規則第 3 行', '再比直接對戰淨勝'),
  rule4: () => c('rule4', '排序規則第 4 行', '再比全組淨勝'),
  rule5: () => c('rule5', '排序規則第 5 行', '再比進球'),
  rule6: () => c('rule6', '排序規則最後一行', '同分且條件用盡時由主辦裁定'),
  stPostponed: () => c('stPostponed', '整場延期：列表膠囊與詳情頂部', '已延期'),
};

const LONG = '示範市立第一高級中學足球隊';
const PUBLIC_LINE = '平日 19:00 前可私訊';

type St = 'sched' | 'done' | 'cancel' | 'tbd';
interface M {
  id: string;
  t: string;
  v: string;
  h: string;
  a: string;
  hs?: number;
  as?: number;
  st: St;
  reason?: string;
  hideTime?: boolean;
}
interface Day { label: string; ms: M[] }
interface Row {
  n: string;
  rank: number;
  p: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  pts: number;
  tie?: boolean;
  ruled?: boolean;
}

const HOST_DAY: Day = {
  label: '1月9日　週六',
  ms: [
    { id: 'h1', t: '14:30', v: '2號場', h: '晨星隊', a: '飛燕隊', st: 'sched' },
    { id: 'h2', t: '09:00', v: '1號場', h: '海風隊', a: '山貓隊', hs: 2, as: 1, st: 'done' },
    { id: 'h3', t: '10:00', v: '1號場', h: '青鳥隊', a: '赤焰隊', st: 'sched' },
  ],
};
const PUBLIC_CANCEL_DAY: Day = {
  label: '1月9日　週六',
  ms: [
    { id: 'c1', t: '09:00', v: '1號場', h: '海風隊', a: '山貓隊', hs: 2, as: 1, st: 'done' },
    { id: 'c2', t: '09:00', v: '2號場', h: '晨星隊', a: '飛燕隊', st: 'cancel', reason: '大雨，場地無法使用' },
    { id: 'c3', t: '10:00', v: '1號場', h: '青鳥隊', a: LONG, st: 'sched' },
  ],
};
const HOST_CANCEL_DAY: Day = {
  label: '1月9日　週六',
  ms: [
    { id: 'c2h', t: '09:00', v: '2號場', h: '晨星隊', a: '飛燕隊', st: 'cancel', reason: '大雨，場地無法使用' },
  ],
};

const STAND_TIE: Row[] = [
  { n: '海風隊', rank: 1, p: 4, w: 3, d: 1, l: 0, gf: 10, ga: 3, pts: 10 },
  { n: '山貓隊', rank: 2, p: 4, w: 3, d: 0, l: 1, gf: 8, ga: 4, pts: 9 },
  { n: '銀河隊', rank: 3, p: 4, w: 1, d: 2, l: 1, gf: 8, ga: 6, pts: 5 },
  { n: '雷霆隊', rank: 4, p: 4, w: 1, d: 2, l: 1, gf: 5, ga: 6, pts: 5 },
  { n: '青鳥隊', rank: 5, p: 4, w: 1, d: 1, l: 2, gf: 3, ga: 3, pts: 4, tie: true },
  { n: '赤焰隊', rank: 5, p: 4, w: 1, d: 1, l: 2, gf: 3, ga: 3, pts: 4, tie: true },
  { n: LONG, rank: 7, p: 4, w: 0, d: 1, l: 3, gf: 2, ga: 8, pts: 1 },
  { n: '飛燕隊', rank: 8, p: 4, w: 0, d: 0, l: 4, gf: 1, ga: 9, pts: 0 },
];
const STAND_RULED: Row[] = [
  { n: '海風隊', rank: 1, p: 4, w: 3, d: 1, l: 0, gf: 10, ga: 3, pts: 10 },
  { n: '青鳥隊', rank: 2, p: 4, w: 1, d: 1, l: 2, gf: 3, ga: 3, pts: 4, ruled: true },
  { n: '赤焰隊', rank: 3, p: 4, w: 1, d: 1, l: 2, gf: 3, ga: 3, pts: 4, ruled: true },
  { n: LONG, rank: 4, p: 4, w: 0, d: 1, l: 3, gf: 2, ga: 8, pts: 1 },
];
const STAND_ZERO: Row[] = [
  { n: '海風隊', rank: 1, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 },
  { n: '山貓隊', rank: 2, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 },
  { n: '青鳥隊', rank: 3, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 },
  { n: '飛燕隊', rank: 4, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 },
];

function postponedMatches(): M[] {
  return [
    { id: 'p1', t: '', v: '', h: '海風隊', a: '山貓隊', st: 'tbd' },
    { id: 'p2', t: '', v: '', h: '青鳥隊', a: '赤焰隊', st: 'tbd' },
    { id: 'p3', t: '', v: '', h: '銀河隊', a: '雷霆隊', st: 'tbd' },
    { id: 'p4', t: '', v: '', h: '晨星隊', a: LONG, st: 'tbd' },
  ];
}
function cancelledCompMatches(): M[] {
  return [
    { id: 'k1', t: '', v: '', h: '海風隊', a: '山貓隊', st: 'cancel', hideTime: true },
    { id: 'k2', t: '', v: '', h: '青鳥隊', a: '赤焰隊', st: 'cancel', hideTime: true },
    { id: 'k3', t: '', v: '', h: '銀河隊', a: '雷霆隊', st: 'cancel', hideTime: true },
    { id: 'k4', t: '', v: '', h: '晨星隊', a: LONG, st: 'cancel', hideTime: true },
  ];
}

function BackIcon(): JSX.Element {
  return (<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>);
}
function Chevron(): JSX.Element {
  return (<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>);
}
function MsgIcon(): JSX.Element {
  return (<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z" /></svg>);
}
function Grip(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="5" cy="3" r="1.3" /><circle cx="11" cy="3" r="1.3" />
      <circle cx="5" cy="8" r="1.3" /><circle cx="11" cy="8" r="1.3" />
      <circle cx="5" cy="13" r="1.3" /><circle cx="11" cy="13" r="1.3" />
    </svg>
  );
}

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
function diffText(gf: number, ga: number): string {
  const diff = gf - ga;
  return diff > 0 ? `+${diff}` : String(diff);
}

function whenOf(m: M): JSX.Element {
  if (m.st === 'tbd') return <span class="cp3-m__when"><b>{T.tbd()}</b></span>;
  if (m.st === 'cancel' && m.hideTime) return <span class="cp3-m__when"><b>{T.stCancelled()}</b></span>;
  return <span class="cp3-m__when"><b>{m.t}</b>{m.v ? `　${m.v}` : ''}</span>;
}
function MatchRow({ m, host }: { m: M; host?: boolean }): JSX.Element {
  const hasScore = m.hs !== undefined && m.as !== undefined;
  const badge = m.st === 'cancel' && !m.hideTime
    ? <Badge tone="danger" label={T.stCancelled()} size="sm" />
    : m.st === 'done' && host
      ? <Badge tone="success" label="已確認" size="sm" />
      : m.st === 'sched' && host
        ? <Badge tone="neutral" label="未賽" size="sm" />
        : null;
  const reset = host && (m.st === 'done' || m.st === 'cancel');
  return (
    <li class="cp3-m">
      <div class="cp3-m__top">
        {whenOf(m)}
        {(badge || reset) && (
          <span class="cp3-tags">
            {badge}
            {reset && <Button variant="ghost" size="sm">重置</Button>}
          </span>
        )}
      </div>
      <div class="cp3-m__vs">
        <span class="h">{m.h}</span>
        {hasScore ? <span class="s">{m.hs}：{m.as}</span> : <span class="s vs">vs</span>}
        <span class="a">{m.a}</span>
      </div>
      {m.reason && <p class="cpm-reason"><b>{T.reason()}</b>　{m.reason}</p>}
      {host && m.st === 'sched' && (
        <div class="cp3-m__act">
          <Button variant="ghost" size="sm">改期</Button>
          <Button variant="danger" size="sm">{T.cancelMatch()}</Button>
          <Button variant="secondary" size="sm">登錄比分</Button>
        </div>
      )}
    </li>
  );
}
function Schedule({ days, host }: { days: Day[]; host?: boolean }): JSX.Element {
  return (
    <div>
      {days.map((day) => (
        <div key={day.label}>
          <h4 class="cp3-day">{day.label}</h4>
          <Card><ul class="cp3-ml">{day.ms.map((m) => <MatchRow key={m.id} m={m} host={host} />)}</ul></Card>
        </div>
      ))}
    </div>
  );
}
function FlatList({ ms }: { ms: M[] }): JSX.Element {
  return <Card><ul class="cp3-ml">{ms.map((m) => <MatchRow key={m.id} m={m} />)}</ul></Card>;
}

function Standings({ rows, ruled, tieClick }: { rows: Row[]; ruled?: boolean; tieClick?: boolean }): JSX.Element {
  return (
    <Card class={`cp3-st${ruled ? ' cpm-ruled' : ''}`}>
      <div class="cp3-st__r cp3-st__r--h">
        <span>名次</span><span class="t">隊名</span><span>賽</span><span>勝</span><span>和</span><span>負</span><span>進/失</span><span>淨勝</span><span>積分</span>
      </div>
      {rows.map((row) => (
        <div key={row.n} class={`cp3-st__r${row.rank === 1 ? ' cp3-st__r--top' : ''}`}>
          <span class="rk">
            {row.rank}
            {row.tie && (tieClick
              ? <button type="button" class="cpm-tiebtn">{T.tie()}</button>
              : <small>{T.tie()}</small>)}
            {row.ruled && <small>{T.hostRuling()}</small>}
          </span>
          <span class="t">{row.n}</span>
          <span>{row.p}</span><span>{row.w}</span><span>{row.d}</span><span>{row.l}</span>
          <span>{row.gf}/{row.ga}</span>
          <span>{diffText(row.gf, row.ga)}</span>
          <span class="pt">{row.pts}</span>
        </div>
      ))}
    </Card>
  );
}

function DetailTabs({ value, sched, stand }: { value: 'sched' | 'stand'; sched: ComponentChildren; stand: ComponentChildren }): JSX.Element {
  return (
    <Tabs
      label="賽事內容"
      variant="underline"
      value={value}
      onValueChange={noop}
      items={[
        { id: 'sched', label: '賽程', panel: sched },
        { id: 'stand', label: '積分', panel: stand },
      ]}
    />
  );
}

function ListCard({ label, tone }: { label: string; tone: 'warning' | 'danger' }): JSX.Element {
  return (
    <Card>
      <div class="cp3-row">
        <h3 class="cpm-name">示範盃五人制足球賽</h3>
        <Badge tone={tone} label={label} size="sm" />
      </div>
      <p class="cpm-meta">2027/01/09 – 01/10　示範運動公園</p>
    </Card>
  );
}
function StatusLine({ label, tone, reason }: { label: string; tone: 'warning' | 'danger'; reason: string }): JSX.Element {
  return (
    <Card>
      <div class="cp3-row">
        <p class="cpm-reason"><b>{T.reason()}</b>　{reason}</p>
        <Badge tone={tone} label={label} size="sm" />
      </div>
    </Card>
  );
}

function CancelSheet(): JSX.Element {
  return (
    <>
      <Frame title="賽程管理">
        <p class="cps-sub">示範盃五人制足球賽</p>
        <Schedule days={[HOST_DAY]} host />
      </Frame>
      <BottomSheet
        open
        title={T.cancelMatch()}
        onClose={noop}
        footer={<div class="cps-footer"><Button variant="secondary">取消</Button><Button variant="danger">{T.cancelOk()}</Button></div>}
      >
        <div class="cps-sheet-body">
          <p class="cp3-ctx">14:30　2號場</p>
          <p class="cp3-ctx">晨星隊　vs　飛燕隊</p>
          <Textarea label={T.cancelReason()} required value="場地積水" onValueChange={noop} maxLength={100} rows={2} variant="fixed" />
          <p class="cpm-hint">{T.cancelHint()}</p>
        </div>
      </BottomSheet>
    </>
  );
}

function CancelledRow(): JSX.Element {
  return (
    <div class="cpm-pair">
      <Frame title="示範盃五人制足球賽">
        <DetailTabs value="sched" sched={<Schedule days={[PUBLIC_CANCEL_DAY]} />} stand={<Standings rows={STAND_TIE.map((row) => ({ ...row, tie: false }))} />} />
      </Frame>
      <Frame title="賽程管理">
        <Schedule days={[HOST_CANCEL_DAY]} host />
      </Frame>
    </div>
  );
}

function EndDialog(): JSX.Element {
  return (
    <>
      <Frame title="賽程管理">
        <p class="cps-sub">示範盃五人制足球賽</p>
        <div class="cps-actions" style="margin-top:0"><Button variant="danger">{T.endTitle()}</Button></div>
      </Frame>
      <Modal
        open
        title={T.endTitle()}
        onClose={noop}
        footer={<div class="cps-footer"><Button variant="secondary">取消</Button><Button variant="danger">{T.endTitle()}</Button></div>}
      >
        <div class="cps-sheet-body">
          <p class="cpm-hint">{T.endHint()}</p>
          <p class="cpm-preview">{T.unconfirmed(4)}</p>
          <Textarea label={T.endReason()} required value="剩餘場次不再進行" onValueChange={noop} maxLength={100} rows={2} variant="fixed" />
        </div>
      </Modal>
    </>
  );
}

function EndedBanner(): JSX.Element {
  return (
    <Frame title="示範盃五人制足球賽">
      <Card>
        <p class="cpm-ended">{T.endedLine('2027/01/10')}</p>
        <p class="cpm-reason"><b>{T.reason()}</b>　剩餘場次不再進行</p>
        <div class="cpm-endact"><Button variant="secondary">{T.restore()}</Button></div>
      </Card>
      <Card>
        <h2 class="cpm-h">{T.restore()}</h2>
        <div class="cps-sheet-body">
          <Textarea label={T.restoreReason()} required value="誤按結束" onValueChange={noop} maxLength={100} rows={2} variant="fixed" />
          <div class="cps-footer">
            <Button variant="secondary">取消</Button>
            <Button variant="primary">{T.restore()}</Button>
          </div>
        </div>
      </Card>
    </Frame>
  );
}

interface CmpLine { k: string; a: string; b: string; hit?: boolean; skip?: boolean }
interface Rel { t: string; line: string }
function CmpCard({ left, right, lines, same, rels }: { left: string; right: string; lines: CmpLine[]; same?: boolean; rels: Rel[] }): JSX.Element {
  return (
    <Card>
      <h3 class="cpm-h">{left}、{right}</h3>
      <div class="cpm-cmp">
        <div class="cpm-cmp__r cpm-cmp__r--h"><span /><span>{left}</span><span>{right}</span></div>
        {lines.map((line) => (
          <div key={line.k} class={`cpm-cmp__r${line.hit ? ' cpm-cmp__r--hit' : ''}${line.skip ? ' cpm-cmp__r--skip' : ''}`}>
            <span class="cpm-cmp__k">{line.k}</span>
            <span>{line.a}</span>
            <span>{line.b}</span>
          </div>
        ))}
      </div>
      {lines.some((line) => line.hit) && <p class="cpm-mark">{T.hit()}</p>}
      {same && <p class="cpm-mark cpm-mark--wait">{T.allSame()}</p>}
      <h4 class="cpm-sec">{T.related()}</h4>
      <ul class="cpm-rels">
        {rels.map((rel) => (
          <li key={rel.t}>
            <button type="button" class="cpm-rel">
              <span class="cpm-rel__t">{rel.t}</span>
              <span class="cpm-rel__n">{rel.line}</span>
              <Chevron />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function TieQuery(): JSX.Element {
  const linesA: CmpLine[] = [
    { k: T.critPts(), a: '5', b: '5' },
    { k: T.critH2hPts(), a: '3', b: '3' },
    { k: T.critH2hGd(), a: '0', b: '0' },
    { k: T.critGd(), a: '+2', b: '-1', hit: true },
    { k: T.critGf(), a: '8', b: '5', skip: true },
  ];
  const linesB: CmpLine[] = [
    { k: T.critPts(), a: '4', b: '4' },
    { k: T.critH2hPts(), a: '1', b: '1' },
    { k: T.critH2hGd(), a: '0', b: '0' },
    { k: T.critGd(), a: '0', b: '0' },
    { k: T.critGf(), a: '3', b: '3' },
  ];
  return (
    <Frame title="示範盃五人制足球賽">
      <DetailTabs
        value="stand"
        sched={<Schedule days={[PUBLIC_CANCEL_DAY]} />}
        stand={(
          <div class="cps-stack">
            <Standings rows={STAND_TIE} tieClick />
            <CmpCard
              left="銀河隊"
              right="雷霆隊"
              lines={linesA}
              rels={[
                { t: '1/9 09:00', line: '銀河隊 1：1 雷霆隊' },
                { t: '1/10 14:00', line: '雷霆隊 1：1 銀河隊' },
              ]}
            />
            <CmpCard
              left="青鳥隊"
              right="赤焰隊"
              lines={linesB}
              same
              rels={[
                { t: '1/9 10:00', line: '青鳥隊 0：0 赤焰隊' },
                { t: '1/10 09:00', line: '赤焰隊 1：1 青鳥隊' },
              ]}
            />
          </div>
        )}
      />
    </Frame>
  );
}

function TieResolve(): JSX.Element {
  return (
    <Frame title="積分">
      <Standings rows={STAND_RULED} ruled />
      <Card>
        <div class="cps-sheet-body">
          <div class="cpm-method">
            <RadioGroup
              label={T.method()}
              value="host"
              onValueChange={noop}
              orientation="horizontal"
              options={[
                { value: 'host', label: T.hostRuling() },
                { value: 'draw', label: T.drawLog() },
              ]}
            />
          </div>
          <div>
            <h3 class="cpm-sec cpm-sec--first">{T.rankOrder()}</h3>
            <ol class="cpm-drag">
              {['青鳥隊', '赤焰隊'].map((name, index) => (
                <li key={name} class="cpm-drag__li">
                  <span class="cpm-grip"><Grip /></span>
                  <span class="cpm-drag__i">{index + 1}</span>
                  <span class="cpm-drag__n">{name}</span>
                </li>
              ))}
            </ol>
          </div>
          <Textarea label={T.ruleReason()} required value="依報名先後" onValueChange={noop} maxLength={200} rows={2} variant="fixed" />
          <Button variant="primary">{T.saveRuling()}</Button>
        </div>
      </Card>
    </Frame>
  );
}

function RescheduleFlex(): JSX.Element {
  return (
    <>
      <Frame title="賽程管理">
        <p class="cps-sub">示範盃五人制足球賽</p>
        <Schedule days={[HOST_DAY]} host />
      </Frame>
      <BottomSheet
        open
        title="改期"
        onClose={noop}
        footer={<div class="cps-footer"><Button variant="secondary">取消</Button><Button variant="primary">確認改期</Button></div>}
      >
        <div class="cps-sheet-body">
          <p class="cp3-ctx">晨星隊　vs　飛燕隊</p>
          <p class="cp3-ctx">14:30　2號場</p>
          <Checkbox label={T.tbd()} checked={false} onCheckedChange={noop} />
          <div class="cps-grid2">
            <Input label="日期" value="2027/01/24" />
            <Input label="時間" value="09:00" />
          </div>
          <p class="cpm-hint">{T.delayHint('2027/01/24')}</p>
          <p class="cpm-cap">{T.cap60()}</p>
          <Select
            label="場地"
            value="v1"
            onValueChange={noop}
            options={[
              { value: 'v1', label: '1號場' },
              { value: 'v2', label: '2號場' },
              { value: 'v3', label: '3號場' },
            ]}
          />
          <p class="cpm-warn">{T.clashArea()}</p>
          <p class="cpm-warn">{T.clashVenue()}</p>
          <p class="cpm-ok" role="status">{T.autoPost()}</p>
        </div>
      </BottomSheet>
    </>
  );
}

function ShiftDay(): JSX.Element {
  return (
    <Frame title="賽程管理">
      <p class="cps-sub">示範盃五人制足球賽</p>
      <Card>
        <h2 class="cpm-h">{T.shiftDay()}</h2>
        <div class="cps-sheet-body">
          <Select
            label={T.matchDay()}
            value="d1"
            onValueChange={noop}
            options={[
              { value: 'd1', label: '1/9 週六　6 場' },
              { value: 'd2', label: '1/10 週日　4 場' },
            ]}
          />
          <Input label={T.newDate()} value="2027/01/17" />
          <p class="cpm-preview">{T.affected(6)}</p>
          <Button variant="primary">{T.shiftOk()}</Button>
        </div>
      </Card>
      <Card>
        <h2 class="cpm-h">{T.swapTwo()}</h2>
        <div class="cps-sheet-body">
          <Select
            label={T.firstMatch()}
            value="m1"
            onValueChange={noop}
            options={[
              { value: 'm1', label: '1/9 09:00 海風對山貓' },
              { value: 'm2', label: '1/10 09:00 山貓對銀河' },
            ]}
          />
          <Select
            label={T.secondMatch()}
            value="m2"
            onValueChange={noop}
            options={[
              { value: 'm1', label: '1/9 09:00 海風對山貓' },
              { value: 'm2', label: '1/10 09:00 山貓對銀河' },
            ]}
          />
          <p class="cpm-swap">海風對山貓 → 1/10 09:00、2號場</p>
          <p class="cpm-swap">山貓對銀河 → 1/9 09:00、1號場</p>
          <Button variant="primary">{T.swapOk()}</Button>
        </div>
      </Card>
    </Frame>
  );
}

function Announce(): JSX.Element {
  return (
    <Frame title="示範盃五人制足球賽">
      <Card>
        <h2 class="cpm-h">{T.announce()}</h2>
        <ul class="cpm-ann">
          <li>
            <div class="cpm-ann__row">
              <Badge tone="info" label={T.system()} size="sm" />
              <span class="cpm-ann__txt">1/10 山貓對銀河改至 1/24</span>
            </div>
            <span class="cpm-ann__time">1/11 09:12</span>
          </li>
          <li>
            <div class="cpm-ann__row">
              <Badge tone="info" label={T.system()} size="sm" />
              <span class="cpm-ann__txt">1/9 晨星對飛燕已取消</span>
            </div>
            <span class="cpm-ann__time">1/10 18:20</span>
          </li>
          <li>
            <div class="cpm-ann__row"><span class="cpm-ann__txt">週末請提前 15 分鐘到場</span></div>
            <span class="cpm-ann__time">1/8 12:00</span>
          </li>
        </ul>
        <div class="cps-actions"><Button variant="secondary">{T.more()}</Button></div>
      </Card>
      <Card>
        <Textarea label={T.annLabel()} value="" onValueChange={noop} hint={T.annLimit()} maxLength={300} rows={3} variant="fixed" />
        <div class="cpm-ann__foot">
          <span class="cpm-meta">{T.posted(3, 20)}</span>
          <Button variant="primary">{T.publish()}</Button>
        </div>
      </Card>
    </Frame>
  );
}

function Contact(): JSX.Element {
  return (
    <Frame title="示範盃五人制足球賽">
      <Card>
        <h2 class="cpm-h">{T.contact()}</h2>
        <div class="cpm-contact">
          <span class="cpm-host">林主辦</span>
          <button type="button" class="cpm-pm"><MsgIcon />{T.pmHost()}</button>
        </div>
        <p class="cpm-public">{PUBLIC_LINE}</p>
      </Card>
      <Card>
        <Input label={T.contactField()} value={PUBLIC_LINE} hint={T.publicHint()} />
      </Card>
    </Frame>
  );
}

function Rules(): JSX.Element {
  const lines = [T.rule1(), T.rule2(), T.rule3(), T.rule4(), T.rule5(), T.rule6()];
  return (
    <Card>
      <h3 class="cpm-sec cpm-sec--first">{T.rulesTitle()}</h3>
      <ol class="cpm-rules">{lines.map((line) => <li key={line}>{line}</li>)}</ol>
    </Card>
  );
}

function RankingRule(): JSX.Element {
  return (
    <Frame title="示範盃五人制足球賽">
      <DetailTabs
        value="stand"
        sched={<Schedule days={[PUBLIC_CANCEL_DAY]} />}
        stand={<div class="cps-stack"><Standings rows={STAND_TIE} /><Rules /></div>}
      />
    </Frame>
  );
}

function Postponed(): JSX.Element {
  return (
    <Frame title="示範盃五人制足球賽">
      <ListCard label={T.stPostponed()} tone="warning" />
      <StatusLine label={T.stPostponed()} tone="warning" reason="場地整修，日期另行通知" />
      <DetailTabs value="sched" sched={<FlatList ms={postponedMatches()} />} stand={<Standings rows={STAND_ZERO} />} />
    </Frame>
  );
}

function CancelledComp(): JSX.Element {
  return (
    <Frame title="示範盃五人制足球賽">
      <ListCard label={T.stCancelled()} tone="danger" />
      <StatusLine label={T.stCancelled()} tone="danger" reason="報名隊伍不足" />
      <DetailTabs value="sched" sched={<FlatList ms={cancelledCompMatches()} />} stand={<Standings rows={STAND_ZERO} />} />
    </Frame>
  );
}

function Screen(): JSX.Element {
  switch (screenName) {
    case 'cancel-sheet': return <CancelSheet />;
    case 'cancelled-row': return <CancelledRow />;
    case 'end-dialog': return <EndDialog />;
    case 'ended-banner': return <EndedBanner />;
    case 'tie-query': return <TieQuery />;
    case 'tie-resolve': return <TieResolve />;
    case 'reschedule-flex': return <RescheduleFlex />;
    case 'shift-day': return <ShiftDay />;
    case 'announce': return <Announce />;
    case 'contact': return <Contact />;
    case 'ranking-rule': return <RankingRule />;
    case 'postponed': return <Postponed />;
    case 'cancelled-comp': return <CancelledComp />;
    default: return <CancelSheet />;
  }
}

void setLocale('zh-TW').then(() => {
  render(
    <LocationProvider>
      <div class="cpm-app" data-screen={screenName}><Screen /></div>
    </LocationProvider>,
    document.getElementById('app')!,
  );
  (window as unknown as { __CPS_READY: boolean }).__CPS_READY = true;
});
