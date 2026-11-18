// 賽事第 2 步（建賽與名單）畫面預覽 harness（只在本機 vite 開 /dev-harness/cp-step2.html；正式 build 不含）。
// 資料全部是記憶體假資料，不連 Firestore、不呼叫 Functions；元件用 FC-B 真元件與 tokens。
// 參數：?screen=<名稱>&theme=light|dark
import { render } from 'preact';
import type { ComponentChildren, JSX } from 'preact';
import { LocationProvider } from 'preact-iso';
import '../styles/legacy-vars.css';
import '../styles/tokens.css';
import '../styles/base.css';
import './cp-step2-harness.css';
import { setLocale } from '@/i18n/i18n';
import { AppConfirmHost, appConfirm } from '@/ui/AppConfirm';
import { ToastHost } from '@/ui/ToastHost';
import { Badge } from '@/ui/Badge';
import { BottomSheet } from '@/ui/BottomSheet';
import { Button } from '@/ui/Button';
import { Checkbox } from '@/ui/Checkbox';
import { Chip } from '@/ui/Chip';
import { Input } from '@/ui/Input';
import { RadioGroup } from '@/ui/RadioGroup';
import { Select } from '@/ui/Select';
import { Stepper } from '@/ui/Stepper';
import { Switch } from '@/ui/Switch';
import { Tabs } from '@/ui/Tabs';
import { Textarea } from '@/ui/Textarea';

const params = new URLSearchParams(location.search);
const screenName = params.get('screen') || 'wizard-1';
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
  bannedName: () => c('bannedName', '建賽精靈步驟 1：名稱含禁用字', '名稱不能包含「官方」「協會」等字'),
  feeDisclaimer: () => c('feeDisclaimer', '俱樂部主辦的繳費說明下方（建賽精靈、賽事詳情）', '繳費由主辦與參賽隊伍自行處理\n本站不經手款項'),
  draftNote: () => c('draftNote', '建賽精靈步驟 3：確認頁', '建立後是草稿，發布後才會公開招募'),
  minorNotice: () => c('minorNotice', '球員登錄表單、代填表單（未成年時顯示）', '未成年球員只公開姓氏與背號。\n真實姓名僅供主辦核對資格，不會公開。'),
  guardian: () => c('guardian', '球員登錄表單、代填表單（未成年時勾選）', '我已取得監護人同意'),
  ackAdult: () => c('ackAdult', '球員登錄表單、代填表單（成年球員勾選）', '我了解名單會公開顯示暱稱與背號'),
  ackMinor: () => c('ackMinor', '球員登錄表單、代填表單（未成年球員勾選）', '我了解名單會公開顯示姓氏與背號'),
  birthdayHint: () => c('birthdayHint', '代填表單：生日欄下方', '只用來判斷年齡，不會儲存'),
  needMore: (n: number, min: number) => c('needMore', '名單頁：人數不足時（數字隨實際人數變動）', `還需 ${n} 人才能確認（最少 ${min} 人）`),
  lockConfirm: () => c('lockConfirm', '主辦管理：鎖定全部名單的確認對話框', '還有 1 隊尚未確認名單。鎖定後所有隊伍都不能再改名單，確定鎖定？'),
  rosterLocked: () => c('rosterLocked', '名單頁：名單鎖定後的狀態列', '名單已鎖定，不能再修改'),
  hostPersonal: () => c('hostPersonal', '賽事詳情、建賽確認頁、名單頁：個人主辦的標示', '個人主辦'),
};

const POSITION_LABEL: Record<string, string> = { GK: '守門員', DF: '後衛', MF: '中場', FW: '前鋒' };

// ── 共用小元件 ───────────────────────────────────────────────────────────
function BackIcon(): JSX.Element {
  return (<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>);
}
function MoreIcon(): JSX.Element {
  return (<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="12" cy="19" r="1.2" /></svg>);
}
function TrashIcon(): JSX.Element {
  return (<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>);
}

function Top({ title, menu }: { title: string; menu?: 'closed' | 'open' }): JSX.Element {
  return (
    <header class="cps-top">
      <button type="button" class="cps-iconbtn" aria-label="返回"><BackIcon /></button>
      <h1>{title}</h1>
      {menu && <button type="button" class="cps-iconbtn" aria-label="更多"><MoreIcon /></button>}
      {menu === 'open' && (
        <div class="cps-menu" role="menu"><button type="button" role="menuitem">檢舉</button></div>
      )}
    </header>
  );
}

function Card({ children, class: cls = '' }: { children: ComponentChildren; class?: string }): JSX.Element {
  return <section class={`cps-card ${cls}`}>{children}</section>;
}

function Frame({ title, menu, children }: { title: string; menu?: 'closed' | 'open'; children: ComponentChildren }): JSX.Element {
  return (
    <div class="cps-root">
      <Top title={title} menu={menu} />
      <div class="cps-stack">{children}</div>
    </div>
  );
}

function Row({ k, children }: { k: string; children: ComponentChildren }): JSX.Element {
  return (<div class="cps-row"><dt>{k}</dt><dd>{children}</dd></div>);
}

function HostBadge({ club }: { club: boolean }): JSX.Element {
  return club ? <Badge tone="info" label="俱樂部主辦" size="sm" /> : <Badge tone="neutral" label={T.hostPersonal()} size="sm" />;
}

// ── 1. 建賽精靈 ─────────────────────────────────────────────────────────
function StepHead({ step }: { step: 1 | 2 | 3 }): JSX.Element {
  const names = ['基本資料', '組別', '確認並建立'];
  return (
    <div>
      <div class="cps-steps" aria-hidden="true">
        {[1, 2, 3].map((n) => <i key={n} class={n <= step ? 'on' : ''} />)}
      </div>
      <div class="cps-stepname"><span>步驟 {step}／3</span><b>{names[step - 1]}</b></div>
    </div>
  );
}

function Wizard1({ club, error }: { club: boolean; error: boolean }): JSX.Element {
  return (
    <Frame title="建立賽事">
      <StepHead step={1} />
      <Card>
        <div class="cps-fields">
          <Input label="賽事名稱" required value={error ? '示範官方盃' : '示範盃五人制足球賽'} error={error ? T.bannedName() : undefined} maxLength={60} />
          <RadioGroup
            label="主辦身分"
            orientation="horizontal"
            value={club ? 'club' : 'personal'}
            onValueChange={noop}
            options={[{ value: 'personal', label: '個人' }, { value: 'club', label: '我管理的俱樂部' }]}
          />
          {club && <Select label="俱樂部" value="t1" onValueChange={noop} options={[{ value: 't1', label: '示範俱樂部' }, { value: 't2', label: '示範俱樂部二隊' }]} />}
          {club && (
            <div>
              <Textarea label="繳費說明" value="每隊報名費 3,000 元，賽前於領隊會議現場繳交。" onValueChange={noop} maxLength={500} />
              <p class="cps-cap cps-pre" style="margin-top:6px">{T.feeDisclaimer()}</p>
            </div>
          )}
        </div>
      </Card>
      <Card>
        <h2 class="cps-h">報名期間</h2>
        <div class="cps-fields">
          <Input label="開始" value="2026/12/01 09:00" />
          <Input label="截止" value="2026/12/20 23:59" />
        </div>
      </Card>
      <Card>
        <h2 class="cps-h">比賽期間</h2>
        <div class="cps-fields">
          <Input label="首場" value="2027/01/09 08:00" />
          <Input label="最後一場" value="2027/01/10 18:00" />
        </div>
      </Card>
      <Card>
        <h2 class="cps-h">場地</h2>
        <div class="cps-fields">
          <Input label="場地名稱" value="示範運動公園 1 號場" maxLength={40} />
          <Input label="地址（選填）" value="示範市示範區示範路 100 號" maxLength={100} />
          <Button variant="secondary" size="md">新增場地</Button>
        </div>
      </Card>
      <div class="cps-actions"><Button variant="primary">下一步</Button></div>
    </Frame>
  );
}

function DivisionForm({ n, name, field, teams, min, max, age, real }: {
  n: number; name: string; field: number; teams: number; min: number; max: number; age: [number, number] | null; real: boolean;
}): JSX.Element {
  return (
    <Card>
      <div class="cps-hint-line" style="justify-content:space-between;margin-bottom:12px">
        <h2 class="cps-h" style="margin:0">組別 {n}</h2>
        <button type="button" class="cps-iconbtn cps-iconbtn--flat" aria-label="移除組別"><TrashIcon /></button>
      </div>
      <div class="cps-fields">
        <Input label="組別名稱" value={name} maxLength={30} />
        <div>
          <span class="cps-label">場上人數</span>
          <div class="cps-chips">
            {[5, 7, 8, 9, 11].map((p) => <Chip key={p} label={`${p} 人制`} size="sm" selected={p === field} onSelect={noop} />)}
          </div>
        </div>
        <div class="cps-fields">
          <Stepper label="隊數上限" value={teams} onValueChange={noop} min={2} max={64} />
          <Stepper label="名單下限" value={min} onValueChange={noop} min={1} max={max} />
          <Stepper label="名單上限" value={max} onValueChange={noop} min={field} max={40} />
        </div>
        <Switch label="限制年齡" checked={age !== null} onCheckedChange={noop} />
        {age && (
          <div class="cps-fields">
            <Stepper label="最小年齡" value={age[0]} onValueChange={noop} min={3} max={99} />
            <Stepper label="最大年齡" value={age[1]} onValueChange={noop} min={3} max={99} />
          </div>
        )}
        <Switch label="球員必填真名" checked={real} onCheckedChange={noop} />
      </div>
    </Card>
  );
}

function Wizard2(): JSX.Element {
  return (
    <Frame title="建立賽事">
      <StepHead step={2} />
      <DivisionForm n={1} name="成人組" field={5} teams={8} min={7} max={12} age={null} real={false} />
      <DivisionForm n={2} name="U12 少年組" field={7} teams={6} min={9} max={14} age={[8, 12]} real />
      <Button variant="secondary">新增組別</Button>
      <div class="cps-actions"><Button variant="secondary">上一步</Button><Button variant="primary">下一步</Button></div>
    </Frame>
  );
}

function Wizard3(): JSX.Element {
  return (
    <Frame title="建立賽事">
      <StepHead step={3} />
      <Card>
        <div class="cps-badges" style="margin-bottom:8px"><HostBadge club={false} /><Badge tone="warning" label="草稿" size="sm" /></div>
        <h2 class="cps-title" style="margin-bottom:12px">示範盃五人制足球賽</h2>
        <dl class="cps-rows">
          <Row k="主辦">王示範</Row>
          <Row k="報名期間"><span class="cps-line">2026/12/01 09:00</span><span class="cps-line">至 2026/12/20 23:59</span></Row>
          <Row k="比賽期間"><span class="cps-line">2027/01/09 08:00</span><span class="cps-line">至 2027/01/10 18:00</span></Row>
          <Row k="場地"><span class="cps-line">示範運動公園 1 號場</span></Row>
        </dl>
      </Card>
      <Card>
        <h2 class="cps-h">組別</h2>
        <ul class="cps-list">
          <li class="cps-li"><div class="cps-li__main"><span class="cps-li__name">成人組</span><div class="cps-li__meta"><span class="cps-cap cps-nowrap">5 人制　8 隊　名單 7–12 人</span></div></div></li>
          <li class="cps-li"><div class="cps-li__main"><span class="cps-li__name">U12 少年組</span><div class="cps-li__meta"><span class="cps-cap cps-nowrap">7 人制　6 隊　名單 9–14 人　限 8–12 歲</span></div></div></li>
        </ul>
      </Card>
      <p class="cps-note">{T.draftNote()}</p>
      <div class="cps-actions"><Button variant="secondary">上一步</Button><Button variant="primary">建立賽事</Button></div>
    </Frame>
  );
}

function WizardDone(): JSX.Element {
  return (
    <Frame title="建立賽事">
      <Card class="cps-success">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M7.5 12.5l3 3 6-6.5" /></svg>
        <h2 class="cps-title" style="margin:12px 0 4px">已建立草稿</h2>
        <p class="cps-sub">示範盃五人制足球賽</p>
        <div class="cps-actions cps-actions--col">
          <Button variant="primary">發布</Button>
          <Button variant="secondary">稍後再發布</Button>
        </div>
      </Card>
    </Frame>
  );
}

// ── 2. 賽事詳情 ─────────────────────────────────────────────────────────
function DivisionInfo({ name, meta, teams, max, list }: { name: string; meta: string; teams: number; max: number; list: string[] }): JSX.Element {
  return (
    <Card>
      <div class="cps-hint-line" style="justify-content:space-between"><h3 class="cps-h" style="margin:0">{name}</h3><Badge tone="success" label="招募中" size="sm" /></div>
      <p class="cps-sub cps-nowrap" style="margin-top:4px">{meta}</p>
      <div class="cps-bar" aria-hidden="true"><i style={`width:${(teams / max) * 100}%`} /></div>
      <p class="cps-cap" style="margin-bottom:8px">已核准 {teams}／{max} 隊</p>
      <ul class="cps-list">
        {list.map((t) => (
          <li class="cps-li" key={t}><div class="cps-li__main"><span class="cps-li__name">{t}</span></div><Badge tone="success" label="已核准" size="sm" /></li>
        ))}
      </ul>
    </Card>
  );
}

function Detail({ viewer, menu, sheet }: { viewer: 'rep' | 'member'; menu?: boolean; sheet?: boolean }): JSX.Element {
  const club = viewer === 'rep';
  return (
    <Frame title="賽事詳情" menu={menu ? 'open' : 'closed'}>
      <Card>
        <div class="cps-badges" style="margin-bottom:8px"><Badge tone="success" label="招募中" size="sm" /><HostBadge club={club} /></div>
        <h2 class="cps-title" style="margin-bottom:12px">示範盃五人制足球賽</h2>
        <dl class="cps-rows">
          <Row k="主辦">{club ? '示範俱樂部' : '王示範'}</Row>
          <Row k="報名期間"><span class="cps-line">12/01 09:00 至 12/20 23:59</span></Row>
          <Row k="比賽期間"><span class="cps-line">2027/01/09 至 2027/01/10</span></Row>
          <Row k="場地"><span class="cps-line">示範運動公園 1 號場</span></Row>
          {club && (
            <Row k="繳費說明">
              <span class="cps-pre">{'每隊報名費 3,000 元\n賽前於領隊會議現場繳交'}</span>
              <span class="cps-cap cps-pre" style="display:block;margin-top:4px">{T.feeDisclaimer()}</span>
            </Row>
          )}
        </dl>
        {club && <div class="cps-actions"><Button variant="primary">以俱樂部報隊</Button></div>}
      </Card>
      <DivisionInfo name="成人組" meta="5 人制　名單 7–12 人" teams={3} max={8} list={['示範隊A', '示範隊D', '示範隊G']} />
      <DivisionInfo name="U12 少年組" meta="7 人制　名單 9–14 人　限 8–12 歲" teams={2} max={6} list={['示範隊E', '示範隊H']} />
      <ReportSheet open={!!sheet} />
    </Frame>
  );
}

function ReportSheet({ open }: { open: boolean }): JSX.Element | null {
  if (!open) return null;
  return (
    <BottomSheet
      open
      title="檢舉賽事"
      onClose={noop}
      footer={<div class="cps-footer"><Button variant="secondary">取消</Button><Button variant="primary">送出檢舉</Button></div>}
    >
      <div class="cps-sheet-body">
        <RadioGroup
          label="原因"
          value="fake"
          onValueChange={noop}
          options={[
            { value: 'impersonation', label: '冒用單位或個人名義' },
            { value: 'fake', label: '內容不實' },
            { value: 'inappropriate', label: '不當內容' },
            { value: 'privacy', label: '侵犯隱私' },
            { value: 'other', label: '其他' },
          ]}
        />
        <Textarea label="說明" value="" onValueChange={noop} maxLength={300} placeholder="補充你看到的情況" />
      </div>
    </BottomSheet>
  );
}

// ── 3. 名單頁 ───────────────────────────────────────────────────────────
interface Player { no: number; name: string; pos: string; minor?: boolean }
const ROSTER5: Player[] = [
  { no: 1, name: '小示', pos: 'GK' }, { no: 5, name: '阿範', pos: 'DF' }, { no: 8, name: '示範哥', pos: 'MF' },
  { no: 10, name: '阿宏', pos: 'MF' }, { no: 14, name: '陳', pos: 'FW', minor: true },
];
const ROSTER7: Player[] = [...ROSTER5, { no: 9, name: '小米', pos: 'FW' }, { no: 3, name: '大風', pos: 'DF' }];

function PlayerRow({ p, canEdit }: { p: Player; canEdit: boolean }): JSX.Element {
  return (
    <li class="cps-li">
      <span class="cps-num">{p.no}</span>
      <div class="cps-li__main">
        <span class="cps-li__name">{p.name}</span>
        <div class="cps-li__meta"><Badge tone="neutral" label={POSITION_LABEL[p.pos]} size="sm" />{p.minor && <Badge tone="warning" label="未成年" size="sm" />}</div>
      </div>
      {canEdit && <button type="button" class="cps-iconbtn cps-iconbtn--flat" aria-label={`移除 ${p.name}`}><TrashIcon /></button>}
    </li>
  );
}

function Roster({ players, locked }: { players: Player[]; locked?: boolean }): JSX.Element {
  const min = 7, max = 12;
  const n = players.length;
  const short = n < min;
  return (
    <Frame title="本隊名單">
      <Card>
        <div class="cps-badges" style="margin-bottom:6px">
          <Badge tone="success" label="已核准" size="sm" />
          {locked ? <Badge tone="success" label="名單已確認" size="sm" /> : <Badge tone="warning" label="名單未確認" size="sm" />}
        </div>
        <h2 class="cps-title">示範隊A</h2>
        <p class="cps-sub">成人組　5 人制</p>
        <div class="cps-bar" aria-hidden="true"><i class={short ? 'low' : ''} style={`width:${Math.min(100, (n / max) * 100)}%`} /></div>
        <div class="cps-kv"><span>目前人數</span><span>{n}／{max} 人（最少 {min} 人）</span></div>
        {!locked && short && <p class="cps-note cps-warn" style="margin-top:8px">{T.needMore(min - n, min)}</p>}
        {locked && <p class="cps-note" style="margin-top:8px">{T.rosterLocked()}</p>}
      </Card>
      <Card>
        <h2 class="cps-h">球員</h2>
        <ul class="cps-list">{players.map((p) => <PlayerRow key={p.no} p={p} canEdit={!locked} />)}</ul>
      </Card>
      {!locked && (
        <div class="cps-actions cps-actions--col" style="margin-top:0">
          <Button variant="secondary">代為新增球員</Button>
          <Button variant="primary" disabled={short}>確認名單</Button>
        </div>
      )}
    </Frame>
  );
}

// ── 4. 登錄表單 ─────────────────────────────────────────────────────────
function PositionPick({ value }: { value: string }): JSX.Element {
  return (
    <div>
      <span class="cps-label">位置</span>
      <div class="cps-chips">
        {Object.keys(POSITION_LABEL).map((k) => <Chip key={k} label={POSITION_LABEL[k]} selected={k === value} onSelect={noop} />)}
      </div>
    </div>
  );
}

function TeamHead(): JSX.Element {
  return (
    <Card>
      <h2 class="cps-title">示範隊A</h2>
      <p class="cps-sub">成人組　5 人制</p>
    </Card>
  );
}

function FormSelf({ minor }: { minor: boolean }): JSX.Element {
  return (
    <Frame title="登錄名單">
      <TeamHead />
      <Card>
        <div class="cps-fields">
          <div class="cps-grid2"><Input label="背號" type="number" value="14" min={0} max={99} /><div /></div>
          <PositionPick value="FW" />
          {minor ? (
            <>
              <Input label="真實姓名" required value="歐陽示範" maxLength={40} />
              <RadioGroup
                label="公開顯示的姓氏"
                value="歐陽"
                onValueChange={noop}
                orientation="horizontal"
                options={[{ value: '歐陽', label: '歐陽' }, { value: '歐', label: '歐' }]}
              />
              <p class="cps-privacy cps-pre">{T.minorNotice()}</p>
              <Checkbox label={T.guardian()} checked onCheckedChange={noop} />
            </>
          ) : (
            <Input label="暱稱" value="阿範" maxLength={20} />
          )}
          <Checkbox label={minor ? T.ackMinor() : T.ackAdult()} checked={minor} onCheckedChange={noop} />
        </div>
      </Card>
      <div class="cps-actions"><Button variant="secondary">取消</Button><Button variant="primary">送出</Button></div>
    </Frame>
  );
}

function FormRep(): JSX.Element {
  return (
    <Frame title="代為新增球員">
      <TeamHead />
      <Card>
        <div class="cps-fields">
          <Input label="真實姓名" required value="歐陽示範" maxLength={40} />
          <div>
            <Input label="生日" required value="2016/05/20" />
            <p class="cps-cap" style="margin-top:6px">{T.birthdayHint()}</p>
          </div>
          <div class="cps-hint-line"><Badge tone="warning" label="未成年" size="sm" /></div>
          <div class="cps-grid2"><Input label="背號" type="number" value="14" min={0} max={99} /><div /></div>
          <PositionPick value="FW" />
          <RadioGroup
            label="公開顯示的姓氏"
            value="歐陽"
            onValueChange={noop}
            orientation="horizontal"
            options={[{ value: '歐陽', label: '歐陽' }, { value: '歐', label: '歐' }]}
          />
          <p class="cps-privacy cps-pre">{T.minorNotice()}</p>
          <Checkbox label={T.guardian()} checked onCheckedChange={noop} />
          <Checkbox label={T.ackMinor()} checked onCheckedChange={noop} />
        </div>
      </Card>
      <div class="cps-actions"><Button variant="secondary">取消</Button><Button variant="primary">新增</Button></div>
    </Frame>
  );
}

// ── 5. 主辦管理（檢錄）──────────────────────────────────────────────────
function PendingCard({ name, dv, contact }: { name: string; dv: string; contact: string }): JSX.Element {
  return (
    <Card>
      <div class="cps-hint-line" style="justify-content:space-between"><h3 class="cps-h" style="margin:0">{name}</h3><Badge tone="warning" label="待審" size="sm" /></div>
      <p class="cps-sub" style="margin:4px 0 8px">{dv}</p>
      <div class="cps-kv"><span>聯絡人</span><span>{contact}</span></div>
      <div class="cps-actions"><Button variant="secondary">拒絕</Button><Button variant="primary">核准</Button></div>
    </Card>
  );
}

function ApprovedCard({ name, dv, n, min, max, confirmed, paid }: {
  name: string; dv: string; n: number; min: number; max: number; confirmed: boolean; paid: boolean;
}): JSX.Element {
  return (
    <Card>
      <div class="cps-hint-line" style="justify-content:space-between"><h3 class="cps-h" style="margin:0">{name}</h3>
        {confirmed ? <Badge tone="success" label="名單已確認" size="sm" /> : <Badge tone="warning" label="名單未確認" size="sm" />}
      </div>
      <p class="cps-sub" style="margin:4px 0 8px">{dv}</p>
      <div class="cps-kv"><span>名單人數</span><span>{n}／{max} 人（最少 {min} 人）</span></div>
      <div class="cps-pay">
        <Badge tone={paid ? 'success' : 'neutral'} label={paid ? '已繳費' : '未繳費'} size="sm" />
        <Switch label="標示已繳費" checked={paid} onCheckedChange={noop} />
      </div>
    </Card>
  );
}

function HostPanel({ tab, sheet }: { tab: 'pending' | 'approved' | 'rejected'; sheet?: boolean }): JSX.Element {
  const items = [
    {
      id: 'pending', label: '待審 2',
      panel: (<div class="cps-stack" style="margin-top:12px">
        <PendingCard name="示範隊B" dv="成人組" contact="林示範" />
        <PendingCard name="示範隊C" dv="U12 少年組" contact="黃示範" />
      </div>),
    },
    {
      id: 'approved', label: '已核准 3',
      panel: (<div class="cps-stack" style="margin-top:12px">
        <ApprovedCard name="示範隊A" dv="成人組" n={9} min={7} max={12} confirmed paid />
        <ApprovedCard name="示範隊D" dv="成人組" n={7} min={7} max={12} confirmed={false} paid={false} />
        <ApprovedCard name="示範隊E" dv="U12 少年組" n={10} min={9} max={14} confirmed paid={false} />
        <div class="cps-actions cps-actions--col" style="margin-top:0">
          <Button variant="danger">鎖定全部名單</Button>
        </div>
      </div>),
    },
    {
      id: 'rejected', label: '已拒絕 1',
      panel: (<div class="cps-stack" style="margin-top:12px">
        <Card>
          <div class="cps-hint-line" style="justify-content:space-between"><h3 class="cps-h" style="margin:0">示範隊F</h3><Badge tone="danger" label="已拒絕" size="sm" /></div>
          <p class="cps-sub" style="margin:4px 0 8px">成人組</p>
          <div class="cps-kv"><span>拒絕原因</span><span>報名資料不齊全</span></div>
        </Card>
      </div>),
    },
  ];
  return (
    <Frame title="報隊管理">
      <div>
        <p class="cps-sub" style="margin-bottom:8px">示範盃五人制足球賽</p>
        <Tabs label="報隊狀態" items={items} value={tab} onValueChange={noop} variant="segmented" />
      </div>
      {sheet && (
        <BottomSheet
          open
          title="拒絕報隊"
          onClose={noop}
          footer={<div class="cps-footer"><Button variant="secondary">取消</Button><Button variant="danger">確認拒絕</Button></div>}
        >
          <div class="cps-sheet-body">
            <p class="cps-note">示範隊B　成人組</p>
            <Textarea label="拒絕原因" required value="" onValueChange={noop} maxLength={200} placeholder="寫給領隊看的原因" />
          </div>
        </BottomSheet>
      )}
    </Frame>
  );
}

function HostLock(): JSX.Element {
  // 對話框在掛載後開啟；截圖前需等它出現。
  setTimeout(() => { void appConfirm(T.lockConfirm(), { okText: '鎖定', danger: false }); }, 50);
  return <HostPanel tab="approved" />;
}

// ── 畫面路由 ────────────────────────────────────────────────────────────
function Screen(): JSX.Element {
  switch (screenName) {
    case 'wizard-1': return <Wizard1 club={false} error={false} />;
    case 'wizard-1-club': return <Wizard1 club error={false} />;
    case 'wizard-1-error': return <Wizard1 club={false} error />;
    case 'wizard-2': return <Wizard2 />;
    case 'wizard-3': return <Wizard3 />;
    case 'wizard-done': return <WizardDone />;
    case 'detail-rep': return <Detail viewer="rep" />;
    case 'detail-member': return <Detail viewer="member" menu />;
    case 'detail-report': return <Detail viewer="member" sheet />;
    case 'roster': return <Roster players={ROSTER5} />;
    case 'roster-ready': return <Roster players={ROSTER7} />;
    case 'roster-locked': return <Roster players={ROSTER7} locked />;
    case 'form-self-minor': return <FormSelf minor />;
    case 'form-self-adult': return <FormSelf minor={false} />;
    case 'form-rep': return <FormRep />;
    case 'host-pending': return <HostPanel tab="pending" />;
    case 'host-reject': return <HostPanel tab="pending" sheet />;
    case 'host-approved': return <HostPanel tab="approved" />;
    case 'host-lock': return <HostLock />;
    case 'host-rejected': return <HostPanel tab="rejected" />;
    default: return <Wizard1 club={false} error={false} />;
  }
}

void setLocale('zh-TW').then(() => {
  render(
    <LocationProvider>
      <Screen />
      <ToastHost />
      <AppConfirmHost />
    </LocationProvider>,
    document.getElementById('app')!,
  );
  (window as unknown as { __CPS_READY: boolean }).__CPS_READY = true;
});
