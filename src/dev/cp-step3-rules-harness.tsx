// 組別規則（F5）畫面預覽 harness。只在本機開 /dev-harness/cp-step3-rules.html；正式 build 不含。
// 假資料、不連 Firestore。元件用 FC-B 真元件與 tokens。?screen=<名稱>&theme=light|dark
import { render } from 'preact';
import type { ComponentChildren, JSX } from 'preact';
import { LocationProvider } from 'preact-iso';
import '../styles/legacy-vars.css';
import '../styles/tokens.css';
import '../styles/base.css';
import '@/features/competitions/competitions.css';
import './cp-step3-rules-harness.css';
import { setLocale } from '@/i18n/i18n';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { Modal } from '@/ui/Modal';
import { Select } from '@/ui/Select';
import { Stepper } from '@/ui/Stepper';
import { Switch } from '@/ui/Switch';
import { Textarea } from '@/ui/Textarea';

const params = new URLSearchParams(location.search);
const screenName = params.get('screen') || 'template';
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.setAttribute('data-theme', theme);
const noop = (): void => undefined;

// ── 新文案登記（預覽頁逐字列出，待站長確認）──────────────────────────────
interface CopyItem { key: string; where: string; text: string }
const COPY: CopyItem[] = [];
function c(key: string, where: string, text: string): string {
  if (!COPY.some((x) => x.key === key)) COPY.push({ key, where, text });
  return text;
}
(window as unknown as { __CPS_COPY: CopyItem[] }).__CPS_COPY = COPY;

const T = {
  back: () => c('back', '頁首：返回', '返回'),
  tplTitle: () => c('tplTitle', '範本頁標題', '選擇規則範本'),
  editTitle: () => c('editTitle', '主辦編輯頁標題', '組別規則'),
  pubTitle: () => c('pubTitle', '公開規則頁標題', '比賽規則'),
  sys: () => c('sys', '區塊小標：系統會照這個算', '系統計分'),
  sched: () => c('sched', '區塊小標：只給系統排賽程用，不影響積分', '系統排程'),
  later: () => c('later', '區塊小標：行為分在記牌功能上線前不生效（顧問 §3.277 條件 1）', '記牌上線後生效'),
  host: () => c('host', '區塊小標：由主辦現場執行', '主辦現場執行'),
  note: () => c('note', '各區塊最後一行（選填，最多 200 字）', '補充說明'),
  save: () => c('save', '編輯頁與確認面板：儲存', '儲存'),
  cancel: () => c('cancel', '確認面板：取消', '取消'),
  advanced: () => c('advanced', '進階摺疊區', '進階'),
  tpl5: () => c('tpl5', '範本卡標題', '五人制一般'),
  tpl7: () => c('tpl7', '範本卡標題', '七人制'),
  tpl11: () => c('tpl11', '範本卡標題', '十一人制'),
  tplN5: () => c('tplN5', '範本卡：人數', '人數：5 人'),
  tplN7: () => c('tplN7', '範本卡：人數', '人數：7 人'),
  tplN11: () => c('tplN11', '範本卡：人數', '人數：11 人'),
  tplHalf: () => c('tplHalf', '範本卡：每半場分鐘（新建預填，五人制）', '每半場：20 分鐘'),
  tplHalf7: () => c('tplHalf7', '範本卡：每半場分鐘（七人制）', '每半場：25 分鐘'),
  tplHalf11: () => c('tplHalf11', '範本卡：每半場分鐘（十一人制）', '每半場：40 分鐘'),
  tplPts: () => c('tplPts', '範本卡：勝和負積分（新建預填）', '勝 3、和 1、負 0'),
  useTpl: () => c('useTpl', '範本卡：一鍵填入', '用這個範本'),
  bPlayers: () => c('bPlayers', '區塊標題', '上場人數'),
  bTime: () => c('bTime', '區塊標題', '比賽時間'),
  bSub: () => c('bSub', '區塊標題', '換人'),
  bPts: () => c('bPts', '區塊標題', '勝和負積分'),
  bTie: () => c('bTie', '區塊標題', '同分排序'),
  bDraw: () => c('bDraw', '區塊標題', '平手'),
  bWo: () => c('bWo', '區塊標題', '棄權'),
  bLate: () => c('bLate', '區塊標題', '遲到'),
  bSusp: () => c('bSusp', '區塊標題', '紅黃牌累積停賽'),
  bFair: () => c('bFair', '區塊標題', '公平競賽（行為分）'),
  bMercy: () => c('bMercy', '區塊標題', '仁慈規則'),
  bH2h: () => c('bH2h', '進階區塊標題', '直接對戰'),
  bKit: () => c('bKit', '區塊標題', '裝備'),
  bAppeal: () => c('bAppeal', '區塊標題', '申訴'),
  players: () => c('players', '上場人數：欄位', '每隊上場'),
  p5: () => c('p5', '上場人數選項', '五人制（5 人）'),
  p7: () => c('p7', '上場人數選項', '七人制（7 人）'),
  p8: () => c('p8', '上場人數選項', '八人制（8 人）'),
  p9: () => c('p9', '上場人數選項', '九人制（9 人）'),
  p11: () => c('p11', '上場人數選項', '十一人制（11 人）'),
  timeFmt: () => c('timeFmt', '比賽時間：欄位', '賽制'),
  onePeriod: () => c('onePeriod', '比賽時間選項', '一節制（沒有上下半場）'),
  twoPeriod: () => c('twoPeriod', '比賽時間選項', '上下半場'),
  halfMin: () => c('halfMin', '比賽時間：上下半場時的步進', '每半場（分鐘）'),
  ht: () => c('ht', '比賽時間：中場開關', '中場休息'),
  htMin: () => c('htMin', '比賽時間：中場分鐘', '中場休息（分鐘）'),
  subMode: () => c('subMode', '換人：欄位', '方式'),
  subFree: () => c('subFree', '換人選項', '無限制回場'),
  subLimit: () => c('subLimit', '換人選項', '有限次數'),
  subHint: () => c('subHint', '換人：系統只提醒、不擋', '系統只提醒，不擋上場'),
  win: () => c('win', '積分：勝', '勝一場（分）'),
  draw: () => c('draw', '積分：和', '和局（分）'),
  loss: () => c('loss', '積分：負', '負一場（分）'),
  ptsWarn: () => c('ptsWarn', '積分：勝分低於和分的警示（不擋儲存）', '勝分低於和分，請確認'),
  ptsWoHint: () => c('ptsWoHint', '積分：勝分下方固定提示', '棄權的分數在棄權區塊另計'),
  preset: () => c('preset', '同分排序：捷徑', '捷徑'),
  preH2h: () => c('preH2h', '排序捷徑', '對戰關係優先'),
  preGd: () => c('preGd', '排序捷徑', '得失球差優先'),
  preFeda: () => c('preFeda', '排序捷徑', '飛達盃 2026 規章第十九條'),
  preYouth: () => c('preYouth', '排序捷徑', '兒童組（較早交給主辦裁定）'),
  preFifa: () => c('preFifa', '排序捷徑', 'FIFA 2026 對照'),
  preCustom: () => c('preCustom', '排序捷徑', '自訂順序'),
  drawRr: () => c('drawRr', '平手：循環賽（本週只有這一種）', '循環賽：和局成立，各得和局積分'),
  drawKo: () => c('drawKo', '平手：淘汰賽（本週只顯示、不計算）', '淘汰賽：平手留第 5 步'),
  woFor: () => c('woFor', '棄權：對手進球', '對手進球'),
  woAgainst: () => c('woAgainst', '棄權：棄權方進球', '棄權方進球'),
  woAward: () => c('woAward', '棄權：勝方積分', '勝方得（分）'),
  woPen: () => c('woPen', '棄權：棄權方積分', '棄權方得（分）'),
  woCount: () => c('woCount', '棄權：是否計入得失球', '計入得失球'),
  lockStruct: () => c('lockStruct', '已產生賽程：人數與時間鎖定', '已產生賽程，要改先清除賽程'),
  lockWalk: () => c('lockWalk', '已有棄權場次：棄權區塊鎖定', '已有棄權場次，棄權設定鎖定'),
  late: () => c('late', '遲到：欄位', '寬限'),
  lateOff: () => c('lateOff', '遲到選項：系統不計時', '由主辦登錄棄權，系統不計時'),
  lateSet: () => c('lateSet', '遲到選項：主辦可判，系統不自動棄權', '開賽後指定分鐘，主辦可判棄權'),
  suspOn: () => c('suspOn', '累積停賽開關（關閉時不展開門檻）', '啟用累積停賽'),
  shin: () => c('shin', '裝備：護脛', '護脛'),
  kitColor: () => c('kitColor', '裝備：同色球衣', '同色球衣'),
  number: () => c('number', '裝備：號碼', '號碼'),
  unset: () => c('unset', '裝備與申訴：缺值', '未設定'),
  shinReq: () => c('shinReq', '護脛選項', '必須戴護脛'),
  shinNo: () => c('shinNo', '護脛選項', '不要求護脛'),
  colorReq: () => c('colorReq', '同色球衣選項', '須穿同色球衣'),
  colorNo: () => c('colorNo', '同色球衣選項', '不要求同色球衣'),
  numReq: () => c('numReq', '號碼選項', '球衣須有號碼'),
  numNo: () => c('numNo', '號碼選項', '不要求號碼'),
  window: () => c('window', '申訴：時限', '時限'),
  windowSet: () => c('windowSet', '申訴時限選項', '賽後指定分鐘內提出'),
  deposit: () => c('deposit', '申訴：保證金', '保證金'),
  depositSet: () => c('depositSet', '保證金選項', '設定保證金'),
  fairLater: () => c('fairLater', '行為分：記牌上線前的標示', '記牌功能上線後生效'),
  yellow: () => c('yellow', '行為分權重', '一張黃牌（分）'),
  secondY: () => c('secondY', '行為分權重', '兩黃變紅（分）'),
  directR: () => c('directR', '行為分權重', '直接紅牌（分）'),
  yThenR: () => c('yThenR', '行為分權重', '先黃牌再直接紅牌（分）'),
  mercySwitch: () => c('mercySwitch', '仁慈規則開關', '單場球差上限啟用'),
  mercyCap: () => c('mercyCap', '仁慈規則：上限球數', '單場球差最多計（球）'),
  mercyMsg: () => c('mercyMsg', '仁慈規則開啟時的說明', '積分榜的球差有上限，進球與失球仍是實際比分'),
  algo: () => c('algo', '直接對戰固定說明（沒有開關）', '算法：先比這幾隊彼此的比賽；分出高下後，剩下的隊伍從頭再比'),
  reasonTitle: () => c('reasonTitle', '確認面板標題', '儲存前確認'),
  diffWin: () => c('diffWin', '確認面板：變更項目', '勝一場由 3 分改為 2 分'),
  diffDraw: () => c('diffDraw', '確認面板：變更項目', '和局由 1 分改為 3 分'),
  reason: () => c('reason', '確認面板：原因（必填）', '原因'),
  reasonHint: () => c('reasonHint', '確認面板提示', '儲存後積分榜會重算，並自動發一則公告'),
  modified: () => c('modified', '公開頁：有修改時才出現', '規則於 2027/01/10 修改'),
  pubPlayers: () => c('pubPlayers', '公開頁', '每隊上場：5 人'),
  pubFmt: () => c('pubFmt', '公開頁', '賽制：一節制（沒有上下半場）'),
  pubFull: () => c('pubFull', '公開頁', '全場：20 分鐘'),
  pubHt: () => c('pubHt', '公開頁', '中場休息：沒有'),
  pubSub: () => c('pubSub', '公開頁', '方式：無限制回場'),
  pubWin: () => c('pubWin', '公開頁', '勝一場：3 分'),
  pubDraw: () => c('pubDraw', '公開頁', '和局：1 分'),
  pubLoss: () => c('pubLoss', '公開頁', '負一場：0 分'),
  pubWoScore: () => c('pubWoScore', '公開頁', '比分：棄權方 0，對手 2'),
  pubWoPts: () => c('pubWoPts', '公開頁', '積分：勝方 3 分，棄權方 0 分'),
  pubWoGd: () => c('pubWoGd', '公開頁', '得失球：計入'),
  pubLate: () => c('pubLate', '公開頁', '寬限：由主辦登錄棄權，系統不計時'),
  pubSusp: () => c('pubSusp', '公開頁', '累積停賽：未啟用'),
  pubY: () => c('pubY', '公開頁', '一張黃牌：−1'),
  pubSy: () => c('pubSy', '公開頁', '兩黃變紅：−3'),
  pubDr: () => c('pubDr', '公開頁', '直接紅牌：−4'),
  pubYr: () => c('pubYr', '公開頁', '先黃牌再直接紅牌：−5'),
  pubMercy: () => c('pubMercy', '公開頁', '單場球差上限：不設'),
  pubShin: () => c('pubShin', '公開頁', '護脛：未設定'),
  pubColor: () => c('pubColor', '公開頁', '同色球衣：未設定'),
  pubNum: () => c('pubNum', '公開頁', '號碼：未設定'),
  pubAppeal: () => c('pubAppeal', '公開頁', '時限：未設定'),
};

const H2H = [
  '積分',
  '直接對戰積分',
  '直接對戰得失球差',
  '直接對戰進球',
  '得失球差',
  '進球數',
  '失球少者優先',
  '公平競賽（行為分）',
  '主辦裁定',
] as const;

function rankLine(i: number, name: string): string {
  return c(`rank${i + 1}`, '同分排序清單（第 1 項固定）', `${i + 1}. ${name}`);
}

// ── 共用 ────────────────────────────────────────────────────────────────
function BackIcon(): JSX.Element {
  return (<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>);
}
function Chevron(): JSX.Element {
  return (<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>);
}
function LockIcon(): JSX.Element {
  return (<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>);
}
function GripIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="6" r="1.4" /><circle cx="15" cy="6" r="1.4" />
      <circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" />
      <circle cx="9" cy="18" r="1.4" /><circle cx="15" cy="18" r="1.4" />
    </svg>
  );
}

function Top({ title }: { title: string }): JSX.Element {
  return (
    <header class="cps-top">
      <button type="button" class="cps-iconbtn" aria-label={T.back()}><BackIcon /></button>
      <h1>{title}</h1>
    </header>
  );
}
function Frame({ title, children }: { title: string; children: ComponentChildren }): JSX.Element {
  return (
    <div class="cps-root cpr-root">
      <Top title={title} />
      <div class="cps-stack">{children}</div>
    </div>
  );
}
function Kv({ text }: { text: string }): JSX.Element {
  const i = text.indexOf('：');
  if (i < 0) return <p class="cpr-kv"><span class="cpr-nobr">{text}</span></p>;
  return <p class="cpr-kv"><span class="cpr-nobr">{text.slice(0, i + 1)}</span><span class="cpr-nobr">{text.slice(i + 1)}</span></p>;
}
function Soft({ text, strong = false }: { text: string; strong?: boolean }): JSX.Element {
  const i = text.indexOf('，');
  const cls = strong ? 'cpr-kv cpr-kv--strong' : 'cpr-kv';
  if (i < 0) return <p class={cls}><span class="cpr-nobr">{text}</span></p>;
  return <p class={cls}><span class="cpr-nobr">{text.slice(0, i + 1)}</span><span class="cpr-nobr">{text.slice(i + 1)}</span></p>;
}
function Head({ title, mark, lock = false, as = 'h2' }: { title: string; mark?: 'sys' | 'host' | 'sched' | 'later'; lock?: boolean; as?: 'h2' | 'h3' }): JSX.Element {
  const Tag = as;
  return (
    <div class="cpr-h">
      {lock ? <span class="cpr-lock" aria-hidden="true"><LockIcon /></span> : null}
      <Tag>{title}</Tag>
      {mark === 'sys' ? <Badge tone="info" size="sm" label={T.sys()} /> : null}
      {mark === 'host' ? <Badge tone="warning" size="sm" label={T.host()} /> : null}
      {mark === 'sched' ? <Badge tone="neutral" size="sm" label={T.sched()} /> : null}
      {mark === 'later' ? <Badge tone="neutral" size="sm" label={T.later()} /> : null}
    </div>
  );
}
function Note({ disabled = false }: { disabled?: boolean }): JSX.Element {
  return <Textarea label={T.note()} value="" onValueChange={noop} maxLength={200} rows={2} disabled={disabled} />;
}

function SortList(): JSX.Element {
  return (
    <ol class="cpr-sort">
      {H2H.map((name, i) => (
        <li key={name} class={i === 0 ? 'cpr-sort__li cpr-sort__li--lock' : 'cpr-sort__li'}>
          {i === 0
            ? <span class="cpr-lock" aria-hidden="true"><LockIcon /></span>
            : <span class="cpr-grip" aria-hidden="true"><GripIcon /></span>}
          <span class="cpr-sort__tx">{rankLine(i, name)}</span>
        </li>
      ))}
    </ol>
  );
}

// ── 範本 ────────────────────────────────────────────────────────────────
function TemplateCard({ title, lines }: { title: string; lines: readonly string[] }): JSX.Element {
  return (
    <section class="cps-card cpr-tpl">
      <h2 class="cpr-tpl__t">{title}</h2>
      {lines.map((text) => <Kv key={text} text={text} />)}
      <Button variant="primary">{T.useTpl()}</Button>
    </section>
  );
}
function TemplateScreen(): JSX.Element {
  return (
    <Frame title={T.tplTitle()}>
      <TemplateCard title={T.tpl5()} lines={[T.tplN5(), T.tplHalf(), T.tplPts()]} />
      <TemplateCard title={T.tpl7()} lines={[T.tplN7(), T.tplHalf7(), T.tplPts()]} />
      <TemplateCard title={T.tpl11()} lines={[T.tplN11(), T.tplHalf11(), T.tplPts()]} />
    </Frame>
  );
}

// ── 編輯 ────────────────────────────────────────────────────────────────
interface EditProps {
  advanced: boolean;
  lockStructure: boolean;
  lockWalkover: boolean;
  warnPoints: boolean;
  mercyOn: boolean;
}

function Advanced({ open, mercyOn }: { open: boolean; mercyOn: boolean }): JSX.Element {
  return (
    <section class="cps-card">
      <button type="button" class={open ? 'cpr-fold cpr-fold--open' : 'cpr-fold'} aria-expanded={open}>
        <span>{T.advanced()}</span>
        <Chevron />
      </button>
      {open ? (
        <>
          <div class="cpr-sub">
            <Head as="h3" title={T.bFair()} mark="later" />
            <div class="cpr-fields">
              <p class="cpr-status">{T.fairLater()}</p>
              <Stepper label={T.yellow()} value={-1} min={-20} max={0} onValueChange={noop} />
              <Stepper label={T.secondY()} value={-3} min={-20} max={0} onValueChange={noop} />
              <Stepper label={T.directR()} value={-4} min={-20} max={0} onValueChange={noop} />
              <Stepper label={T.yThenR()} value={-5} min={-20} max={0} onValueChange={noop} />
              <Note />
            </div>
          </div>
          <div class="cpr-sub">
            <Head as="h3" title={T.bMercy()} mark="sys" />
            <div class="cpr-fields">
              <Switch label={T.mercySwitch()} checked={mercyOn} onCheckedChange={noop} />
              {mercyOn ? <Stepper label={T.mercyCap()} value={7} min={1} max={30} onValueChange={noop} /> : null}
              {mercyOn ? <Soft text={T.mercyMsg()} /> : null}
              <Note />
            </div>
          </div>
          <div class="cpr-sub">
            <Head as="h3" title={T.bH2h()} mark="sys" />
            <p class="cpr-wrap">{T.algo()}</p>
          </div>
        </>
      ) : null}
    </section>
  );
}

function EditScreen(props: EditProps): JSX.Element {
  const { advanced, lockStructure, lockWalkover, warnPoints, mercyOn } = props;
  const win = warnPoints ? 2 : 3;
  const draw = warnPoints ? 3 : 1;
  return (
    <Frame title={T.editTitle()}>
      {lockStructure ? <p class="cpr-banner">{T.lockStruct()}</p> : null}
      <section class="cps-card">
        <Head title={T.bPlayers()} mark="sched" lock={lockStructure} />
        <div class="cpr-fields">
          <Select
            label={T.players()}
            value="5"
            disabled={lockStructure}
            onValueChange={noop}
            options={[
              { value: '5', label: T.p5() },
              { value: '7', label: T.p7() },
              { value: '8', label: T.p8() },
              { value: '9', label: T.p9() },
              { value: '11', label: T.p11() },
            ]}
          />
          <Note />
        </div>
      </section>
      <section class="cps-card">
        <Head title={T.bTime()} mark="sched" lock={lockStructure} />
        <div class="cpr-fields">
          <Select
            label={T.timeFmt()}
            value="2"
            disabled={lockStructure}
            onValueChange={noop}
            options={[{ value: '1', label: T.onePeriod() }, { value: '2', label: T.twoPeriod() }]}
          />
          <Stepper label={T.halfMin()} value={20} min={5} max={90} disabled={lockStructure} onValueChange={noop} />
          <Switch label={T.ht()} checked disabled={lockStructure} onCheckedChange={noop} />
          <Stepper label={T.htMin()} value={5} min={0} max={30} disabled={lockStructure} onValueChange={noop} />
          <Note />
        </div>
      </section>
      <section class="cps-card">
        <Head title={T.bSub()} mark="host" />
        <div class="cpr-fields">
          <Select
            label={T.subMode()}
            value="free"
            onValueChange={noop}
            options={[{ value: 'free', label: T.subFree() }, { value: 'limit', label: T.subLimit() }]}
          />
          <p class="cpr-hint">{T.subHint()}</p>
          <Note />
        </div>
      </section>
      <section class="cps-card">
        <Head title={T.bPts()} mark="sys" />
        <div class="cpr-fields">
          <Stepper label={T.win()} value={win} min={0} max={20} onValueChange={noop} />
          {warnPoints ? <p class="cpr-warn">{T.ptsWarn()}</p> : null}
          <p class="cpr-hint">{T.ptsWoHint()}</p>
          <Stepper label={T.draw()} value={draw} min={0} max={20} onValueChange={noop} />
          <Stepper label={T.loss()} value={0} min={-20} max={20} onValueChange={noop} />
          <Note />
        </div>
      </section>
      <section class="cps-card">
        <Head title={T.bTie()} mark="sys" />
        <div class="cpr-fields">
          <Select
            label={T.preset()}
            value="h2hFirst"
            onValueChange={noop}
            options={[
              { value: 'h2hFirst', label: T.preH2h() },
              { value: 'goalDiffFirst', label: T.preGd() },
              { value: 'feda2026', label: T.preFeda() },
              { value: 'youth', label: T.preYouth() },
              { value: 'fifa2026', label: T.preFifa() },
              { value: 'custom', label: T.preCustom() },
            ]}
          />
          <SortList />
          <Note />
        </div>
      </section>
      <section class="cps-card">
        <Head title={T.bDraw()} mark="sys" />
        <div class="cpr-fields">
          <Kv text={T.drawRr()} />
          <Kv text={T.drawKo()} />
          <Note />
        </div>
      </section>
      <section class="cps-card">
        <Head title={T.bWo()} mark="sys" lock={lockWalkover} />
        <div class="cpr-fields">
          {lockWalkover ? <p class="cpr-banner">{T.lockWalk()}</p> : null}
          <Stepper label={T.woFor()} value={2} min={0} max={99} disabled={lockWalkover} onValueChange={noop} />
          <Stepper label={T.woAgainst()} value={0} min={0} max={99} disabled={lockWalkover} onValueChange={noop} />
          <Stepper label={T.woAward()} value={3} min={-20} max={20} disabled={lockWalkover} onValueChange={noop} />
          <Stepper label={T.woPen()} value={0} min={-20} max={20} disabled={lockWalkover} onValueChange={noop} />
          <Switch label={T.woCount()} checked disabled={lockWalkover} onCheckedChange={noop} />
          <Note disabled={lockWalkover} />
        </div>
      </section>
      <section class="cps-card">
        <Head title={T.bLate()} mark="host" />
        <div class="cpr-fields">
          <Select
            label={T.late()}
            value="off"
            onValueChange={noop}
            options={[{ value: 'off', label: T.lateOff() }, { value: 'set', label: T.lateSet() }]}
          />
          <Note />
        </div>
      </section>
      <section class="cps-card">
        <Head title={T.bSusp()} mark="host" />
        <div class="cpr-fields">
          <Switch label={T.suspOn()} checked={false} onCheckedChange={noop} />
          <Note />
        </div>
      </section>
      <Advanced open={advanced} mercyOn={mercyOn} />
      <section class="cps-card">
        <Head title={T.bKit()} mark="host" />
        <div class="cpr-fields">
          <Select
            label={T.shin()}
            value="unset"
            onValueChange={noop}
            options={[
              { value: 'unset', label: T.unset() },
              { value: 'required', label: T.shinReq() },
              { value: 'notRequired', label: T.shinNo() },
            ]}
          />
          <Select
            label={T.kitColor()}
            value="unset"
            onValueChange={noop}
            options={[
              { value: 'unset', label: T.unset() },
              { value: 'required', label: T.colorReq() },
              { value: 'notRequired', label: T.colorNo() },
            ]}
          />
          <Select
            label={T.number()}
            value="unset"
            onValueChange={noop}
            options={[
              { value: 'unset', label: T.unset() },
              { value: 'required', label: T.numReq() },
              { value: 'notRequired', label: T.numNo() },
            ]}
          />
          <Note />
        </div>
      </section>
      <section class="cps-card">
        <Head title={T.bAppeal()} mark="host" />
        <div class="cpr-fields">
          <Select
            label={T.window()}
            value="unset"
            onValueChange={noop}
            options={[{ value: 'unset', label: T.unset() }, { value: 'set', label: T.windowSet() }]}
          />
          <Select
            label={T.deposit()}
            value="unset"
            onValueChange={noop}
            options={[{ value: 'unset', label: T.unset() }, { value: 'set', label: T.depositSet() }]}
          />
          <Note />
        </div>
      </section>
      <div class="cpr-save"><Button variant="primary">{T.save()}</Button></div>
    </Frame>
  );
}

function ReasonScreen(): JSX.Element {
  return (
    <>
      <EditScreen advanced={false} lockStructure lockWalkover={false} warnPoints mercyOn={false} />
      <Modal
        open
        class="cpr-modal"
        title={T.reasonTitle()}
        onClose={noop}
        footer={(
          <div class="cps-footer">
            <Button variant="secondary">{T.cancel()}</Button>
            <Button variant="primary">{T.save()}</Button>
          </div>
        )}
      >
        <div class="cpr-sheet">
          <ul class="cpr-diff">
            <li>{T.diffWin()}</li>
            <li>{T.diffDraw()}</li>
          </ul>
          <Soft text={T.reasonHint()} strong />
          <Textarea label={T.reason()} required value="" onValueChange={noop} rows={3} />
        </div>
      </Modal>
    </>
  );
}

// ── 公開 ────────────────────────────────────────────────────────────────
function PubCard({ title, host = false, lines, wrap }: { title: string; host?: boolean; lines: readonly string[]; wrap?: string }): JSX.Element {
  return (
    <section class="cps-card">
      <Head title={title} mark={host ? 'host' : undefined} />
      <div class="cpr-lines">
        {wrap ? <p class="cpr-wrap">{wrap}</p> : null}
        {lines.map((text) => <Kv key={text} text={text} />)}
      </div>
    </section>
  );
}
function PublicScreen({ modified }: { modified: boolean }): JSX.Element {
  return (
    <Frame title={T.pubTitle()}>
      {modified ? <p class="cpr-date">{T.modified()}</p> : null}
      <PubCard title={T.bPlayers()} lines={[T.pubPlayers()]} />
      <PubCard title={T.bTime()} lines={[T.pubFmt(), T.pubFull(), T.pubHt()]} />
      <PubCard title={T.bSub()} host lines={[T.pubSub()]} />
      <PubCard title={T.bPts()} lines={[T.pubWin(), T.pubDraw(), T.pubLoss()]} />
      <PubCard title={T.bTie()} wrap={T.algo()} lines={H2H.map((name, i) => rankLine(i, name))} />
      <PubCard title={T.bDraw()} lines={[T.drawRr(), T.drawKo()]} />
      <PubCard title={T.bWo()} lines={[T.pubWoScore(), T.pubWoPts(), T.pubWoGd()]} />
      <PubCard title={T.bLate()} host lines={[T.pubLate()]} />
      <PubCard title={T.bSusp()} host lines={[T.pubSusp()]} />
      <PubCard title={T.bFair()} lines={[T.fairLater(), T.pubY(), T.pubSy(), T.pubDr(), T.pubYr()]} />
      <PubCard title={T.bMercy()} lines={[T.pubMercy()]} />
      <PubCard title={T.bKit()} host lines={[T.pubShin(), T.pubColor(), T.pubNum()]} />
      <PubCard title={T.bAppeal()} host lines={[T.pubAppeal()]} />
    </Frame>
  );
}

// ── 畫面路由 ────────────────────────────────────────────────────────────
function Screen(): JSX.Element {
  switch (screenName) {
    case 'template': return <TemplateScreen />;
    case 'edit': return <EditScreen advanced={false} lockStructure={false} lockWalkover={false} warnPoints mercyOn={false} />;
    case 'edit-advanced': return <EditScreen advanced lockStructure={false} lockWalkover={false} warnPoints mercyOn />;
    case 'locked': return <EditScreen advanced={false} lockStructure lockWalkover warnPoints={false} mercyOn={false} />;
    case 'reason': return <ReasonScreen />;
    case 'public': return <PublicScreen modified />;
    case 'public-default': return <PublicScreen modified={false} />;
    default: return <TemplateScreen />;
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
