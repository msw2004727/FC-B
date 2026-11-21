// 賽事封面圖預覽 harness（只給本機截圖，不參與正式 build）。用正式元件＋記憶體假資料畫封面的各個畫面：
// 不連 Firestore、不呼叫 Functions、不連 Storage。封面圖是這裡自己畫的 SVG（幾何圖形），不用網路圖片。
// 選圖、裁切走正式流程：在頁面裡用 canvas 產生一張 PNG 當成使用者選的檔，發 change 給正式的選檔欄，再按正式 ImageCropper 的「確認」；
// 上傳換成 env.coverUpload 假的（立刻完成／一直不回／失敗）。
// ?screen=<名稱>&theme=light|dark[&frame=1]（frame=1 包正式 App 的內容容器，1280 寬截圖用）。截圖腳本等 window.__CPS_READY。
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
// 報隊管理空狀態沿用 .s4b-mempty（step4b.css）；同 cp-step2 harness 的載入順序。
import '@/features/competitions/step4b/step4b.css';
import { setLocale } from '@/i18n/i18n';
import { AppConfirmHost } from '@/ui/AppConfirm';
import { ToastHost } from '@/ui/ToastHost';
import { InAppSection } from '@/features/competitions/components/InAppSection';
import { InAppCardList } from '@/features/competitions/components/InAppCardList';
import type { InAppListCard } from '@/features/competitions/data/list-cards';
import './cp-cover-board-harness.css';
import { CpEnvProvider, type CpInjectedEnv } from '@/features/competitions/env';
import { ctOrKey, loadCompetitionsDict, useCompetitionsT } from '@/features/competitions/i18n';
import { CpCallError } from '@/features/competitions/data/cp-callables';
import type { UploadedCover } from '@/features/competitions/data/cover-upload';
import type { CompetitionCover, CompetitionDoc } from '@/features/competitions/data/types';
import { adminActor, competition, hostActor, idleActions, listInEnv, memberActor, screenEnv, wizardSeed } from '@/features/competitions/testing/screen-fixtures';
import { taipeiMs } from '@/features/competitions/format';
import CompetitionDetailPage from '@/features/competitions/pages/CompetitionDetailPage';
import CompetitionManagePage from '@/features/competitions/pages/CompetitionManagePage';
import NewCompetitionPage from '@/features/competitions/pages/NewCompetitionPage';

const params = new URLSearchParams(location.search);
const screenName = params.get('screen') || 'form-empty';
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
const framed = params.get('frame') === '1';
document.documentElement.setAttribute('data-theme', theme);
// 卡板封面預覽：?cv=a|b|c 切三個版本（b 是 competitions.css 的寫法；a、c 由 cp-cover-board-harness.css 覆寫）；?art= 換示範圖
document.documentElement.setAttribute('data-cv', params.get('cv') || 'b');

// ── 自己畫的示範封面（1200×450；縮圖是正中央 4:3 那一塊，模擬自動裁切） ──
const ART: Record<string, string> = {
  pitch: '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1f7a4d"/><stop offset="1" stop-color="#0f4c3a"/></linearGradient></defs><rect width="1200" height="450" fill="url(#g)"/><g fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="6"><rect x="60" y="40" width="1080" height="370"/><line x1="600" y1="40" x2="600" y2="410"/><circle cx="600" cy="225" r="80"/><rect x="60" y="130" width="150" height="190"/><rect x="990" y="130" width="150" height="190"/></g><g fill="#fff" fill-opacity=".08"><rect x="0" width="150" height="450"/><rect x="300" width="150" height="450"/><rect x="750" width="150" height="450"/><rect x="1050" width="150" height="450"/></g>',
  cup: '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2=".6"><stop offset="0" stop-color="#312e81"/><stop offset="1" stop-color="#0e7490"/></linearGradient></defs><rect width="1200" height="450" fill="url(#g)"/><circle cx="880" cy="230" r="190" fill="#fff" fill-opacity=".1"/><circle cx="880" cy="230" r="120" fill="none" stroke="#fde68a" stroke-opacity=".8" stroke-width="10"/><circle cx="300" cy="90" r="60" fill="#fde68a" fill-opacity=".35"/><path d="M0 380 L1200 260 L1200 450 L0 450Z" fill="#000" fill-opacity=".18"/>',
  // 很亮、很雜的示範圖：白底、黃白斜紋、彩色圓點與黑白格（測字壓在亮圖上還看不看得清）
  busy: '<rect width="1200" height="450" fill="#fff"/><g fill="#fde047">' + Array.from({ length: 16 }, (_, i) => `<path d="M${i * 90 - 200} 450 L${i * 90 + 40} 0 L${i * 90 + 85} 0 L${i * 90 - 155} 450Z"/>`).join('') + '</g><g fill="#111">' + Array.from({ length: 60 }, (_, i) => (i % 2 ? '' : `<rect x="${(i % 12) * 100}" y="${Math.floor(i / 12) * 90}" width="50" height="45"/>`)).join('') + '</g><g fill-opacity=".9">' + Array.from({ length: 40 }, (_, i) => `<circle cx="${(i * 137) % 1200}" cy="${(i * 71) % 450}" r="${18 + (i % 5) * 9}" fill="${['#ef4444', '#22c55e', '#3b82f6', '#f97316', '#ffffff'][i % 5]}"/>`).join('') + '</g>',
  dusk: '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#475569"/><stop offset="1" stop-color="#1e293b"/></linearGradient></defs><rect width="1200" height="450" fill="url(#g)"/><path d="M0 450 L260 210 L470 360 L700 160 L960 340 L1200 220 L1200 450Z" fill="#94a3b8" fill-opacity=".35"/><circle cx="930" cy="110" r="46" fill="#e2e8f0" fill-opacity=".6"/>',
};

function svg(art: string, viewBox: string, w: number, h: number): string {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid slice">${ART[art]}</svg>`)}`;
}

function cover(art: string): CompetitionCover {
  return { url: svg(art, '0 0 1200 450', 1200, 450), thumb: svg(art, '300 0 600 450', 224, 168) };
}

const PITCH = cover('pitch');
// 訪客：同建賽守門的未登入（uid null），不屬於任何俱樂部。
const GUEST = { ...memberActor, uid: null, memberClubIds: [], repClubs: [] };

// ── 上傳：假的（不連 Storage） ──
const instantUpload = async (dataUrl: string): Promise<UploadedCover> => ({ url: dataUrl, thumb: PITCH.thumb, thumbSrc: PITCH.thumb });
const neverUpload = (): Promise<UploadedCover> => new Promise(() => {});
const failUpload = async (): Promise<UploadedCover> => { throw new Error('offline'); };
// 逾時：同 data/cover-upload.ts 的 CoverUploadError('timeout')（這裡不載入那支模組，只給同樣的 name／code）。
const timeoutUpload = async (): Promise<UploadedCover> => {
  throw Object.assign(new Error('cover upload timed out'), { name: 'CoverUploadError', code: 'timeout' });
};

function withCover(env: CpInjectedEnv, patch: Partial<CompetitionDoc>): CpInjectedEnv {
  const comp = env.bundle?.competition;
  if (!comp) return env;
  return { ...env, bundle: { ...env.bundle!, competition: { ...comp, ...patch } } };
}

// ── 清單：正式 listInEnv 的三張（進行中卡板、預熱、招募）再補三張；有圖／沒圖混排 ──
const EXTRA: CompetitionDoc[] = [
  competition({
    id: 'rec_cup2', name: '2027 新北市青年五人制足球邀請錦標賽', category: 'cup', hostType: 'personal', hostTeamId: null, feeNote: null,
    regCloseAt: taipeiMs(2026, 12, 20, 23, 59), firstMatchAt: taipeiMs(2027, 1, 16, 9, 0), lastMatchAt: taipeiMs(2027, 1, 17, 18, 0),
    venues: [{ name: '三重綜合運動場' }], cover: cover('cup'),
  }),
];
const LIST_COVERS: Record<string, CompetitionCover> = { warm_lg: PITCH, live_cup: cover('cup') };

function listEnv(): CpInjectedEnv {
  const env = listInEnv();
  const orig = env.repo.listPublic.bind(env.repo);
  env.repo.listPublic = async (includeInternal?: boolean) => {
    const docs = await orig(includeInternal);
    return [...docs, ...EXTRA].map((d) => (LIST_COVERS[d.id] ? { ...d, cover: LIST_COVERS[d.id] } : d));
  };
  return env;
}

function ListIn(): ComponentChildren {
  return (
    <div class="legacy-ui tournaments-root" data-d2="1">
      <section class="page active tc-page" id="page-tournaments">
        <InAppSection tab="all" active />
      </section>
    </div>
  );
}

// ── 卡板封面（站長 11-21）：直接畫正式 InAppCardList 兩段——有封面卡板＋沒封面卡、沒封面卡板＋有縮圖卡 ──
function boardCard(cid: string, patch: Partial<InAppListCard>): InAppListCard {
  return {
    cid, name: '同榮盃', category: 'cup', phase: 'recruit', date: '12/06–12/07', venue: '新莊運動公園',
    firstMatchAt: 1, line: { kind: 'deadline', date: '11/21 23:59' }, mine: false, ended: false, statusMark: null,
    thumb: '', cover: '', ...patch,
  };
}

function BoardList({ lists }: { lists: InAppListCard[][] }): ComponentChildren {
  const ct = ctOrKey(useCompetitionsT());
  const noop = (): void => {};
  return (
    <div class="legacy-ui tournaments-root" data-d2="1">
      <section class="page active tc-page" id="page-tournaments">
        {lists.map((cards, i) => (
          <div class={i === 0 ? 'cvb-1' : 'cvb-2'} key={cards[0]!.cid}>
            <InAppCardList cards={cards} ct={ct} status="open" onlyMine={false} showCreate={i === 0} boardCid={cards[0]!.cid}
              onStatus={noop} onOnlyMine={noop} onCreate={noop} onOpen={(_cid, e) => e.preventDefault()} />
          </div>
        ))}
      </section>
    </div>
  );
}

// 示範封面預設用 repo 內的照片（public/assets/og/sports/football.jpg，不連網），照正式裁切流程：中央 8:3 → 1200×450、WebP 0.72
let photoCover: CompetitionCover | null = null;
async function loadPhoto(): Promise<void> {
  const img = new Image();
  img.src = '/assets/og/sports/football.jpg';
  await img.decode();
  const sh = Math.round((img.naturalWidth * 3) / 8);
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 450;
  canvas.getContext('2d')?.drawImage(img, 0, (img.naturalHeight - sh) / 2, img.naturalWidth, sh, 0, 0, 1200, 450);
  const url = canvas.toDataURL('image/webp', 0.72);
  const t = document.createElement('canvas');
  t.width = 224;
  t.height = 168;
  t.getContext('2d')?.drawImage(canvas, 300, 0, 600, 450, 0, 0, 224, 168);
  photoCover = { url, thumb: t.toDataURL('image/webp', 0.72) };
}
const artName = params.get('art') || 'photo';
const artCover = (): CompetitionCover => (artName === 'photo' && photoCover ? photoCover : cover(artName === 'photo' ? 'pitch' : artName));

function BoardScreen(): ComponentChildren {
  const c = artCover();
  const first = [
    boardCard('b_cover', { cover: c.url, thumb: c.thumb }),
    boardCard('n_plain', { name: '2027 新北市青年五人制足球邀請錦標賽', category: 'league', phase: 'warm', line: { kind: 'warm', days: 3 }, date: '01/16–01/17', venue: '三重綜合運動場' }),
  ];
  const second = [
    boardCard('b_plain', { name: '冬季友誼聯賽', category: 'league', phase: 'live', line: { kind: 'live', count: 4, time: '14:30' }, date: '11/21', venue: '迎風河濱球場' }),
    boardCard('n_thumb', { name: '社區親子足球日', category: 'friendly', line: { kind: 'deadline', date: '12/01 23:59' }, date: '12/14', venue: '大佳河濱公園', thumb: cover('cup').thumb }),
  ];
  return <BoardList lists={[first, second]} />;
}

// 進行中卡板（兩格）＋長名稱，都有封面：看名稱壓到圖上、兩格落在圖上的樣子
function BoardLiveScreen(): ComponentChildren {
  const first = [boardCard('b_live', { name: '2027 新北市青年五人制足球邀請錦標賽', phase: 'live', line: { kind: 'live', count: 4, time: '14:30' }, cover: artCover().url })];
  const second = [boardCard('b_warm', { phase: 'warm', line: { kind: 'warm', days: 3 }, cover: cover('cup').url })];
  return <BoardList lists={[first, second]} />;
}

const LONG = '2027 新北市青年五人制足球邀請錦標賽';
// 送審總覽（顧問 §3.548）：每段一張卡板——有封面、有封面＋長名稱（進行中兩格）、封面載不到（onError 退回）、沒封面；
// 一般卡含已結束（有縮圖）、長名稱
function BoardAllScreen(): ComponentChildren {
  const c = artCover();
  const lists = [
    [
      boardCard('b_cover', { cover: c.url, thumb: c.thumb }),
      boardCard('n_done', { name: '秋季盃（已結束）', category: 'cup', phase: 'done', ended: true, line: null, date: '10/18–10/19', venue: '新莊運動公園', thumb: cover('dusk').thumb }),
    ],
    [
      boardCard('b_long', { name: LONG, phase: 'live', line: { kind: 'live', count: 4, time: '14:30' }, cover: c.url }),
      boardCard('n_long', { name: LONG, category: 'league', phase: 'warm', line: { kind: 'warm', days: 3 }, date: '01/16–01/17', venue: '三重綜合運動場' }),
    ],
    [boardCard('b_broken', { name: '封面載不到的盃賽', phase: 'warm', line: { kind: 'warm', days: 5 }, cover: 'data:image/webp;base64,AAAA' })],
    [boardCard('b_plain', { name: '冬季友誼聯賽', category: 'league', phase: 'recruit', date: '12/20', venue: '迎風河濱球場' })],
  ];
  return <BoardList lists={lists} />;
}

// 下架：管理員看清單，下架那場（正式查詢不會帶出；這裡故意混進來）卡板與一般卡都不畫封面；沒下架的照常有縮圖
function hiddenAdminEnv(): CpInjectedEnv {
  const env = { ...listInEnv(), actor: adminActor };
  const orig = env.repo.listPublic.bind(env.repo);
  env.repo.listPublic = async (includeInternal?: boolean) => (await orig(includeInternal)).map((d) => (
    d.id === 'live_cup' ? { ...d, name: '示範盃（已下架）', hidden: true, hiddenReason: '示範下架', cover: PITCH }
      : d.id === 'warm_lg' ? { ...d, cover: cover('cup') } : d));
  return env;
}

// ── 互動：照使用者操作點正式元件 ──
function buttonsNamed(name: string): HTMLButtonElement[] {
  return [...document.querySelectorAll('button')].filter((node) => (node.textContent ?? '').replace(/\s+/g, ' ').trim() === name);
}

async function until(label: string, ready: () => boolean, ms = 6000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`畫面未出現：${label}`);
}

function click(name: string): void {
  const node = buttonsNamed(name)[0];
  if (!node) throw new Error(`找不到按鈕：${name}`);
  node.click();
}

/** 在頁面裡畫一張 PNG 當成使用者選的照片，交給正式的選檔欄，再按正式裁圖的「確認」。 */
async function pickPhoto(): Promise<void> {
  const img = new Image();
  img.src = svg('pitch', '0 0 1200 450', 1600, 900);
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = 1600;
  canvas.height = 900;
  canvas.getContext('2d')?.drawImage(img, 0, 0, 1600, 900);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('產生示範照片失敗');
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('找不到選檔欄');
  const dt = new DataTransfer();
  dt.items.add(new File([blob], 'pitch.png', { type: 'image/png' }));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await until('裁圖確認鈕', () => buttonsNamed('確認').length > 0);
  // 等裁圖元件把圖片載入完成（確認鈕可按）
  await new Promise((resolve) => setTimeout(resolve, 400));
  click('確認');
}

async function openEdit(): Promise<void> {
  await until('編輯賽事資訊鈕', () => buttonsNamed('編輯賽事資訊').length > 0);
  click('編輯賽事資訊');
  await until('編輯展開', () => buttonsNamed('編輯賽事資訊')[0]?.getAttribute('aria-expanded') === 'true');
}

function hostManage(patch: Partial<CompetitionDoc>, upload?: CpInjectedEnv['coverUpload'], admin = false): CpInjectedEnv {
  const env = withCover(screenEnv('host-pending'), patch);
  return { ...env, actor: admin ? adminActor : hostActor, coverUpload: upload };
}

function wizardEnv(upload?: CpInjectedEnv['coverUpload'], create?: CpInjectedEnv['actions']['create']): CpInjectedEnv {
  const env = screenEnv('real-wizard-personal', create ? { ...idleActions(), create } : idleActions());
  return { ...env, coverUpload: upload };
}

interface Screen { env: () => CpInjectedEnv; Page: ComponentType; open?: () => Promise<void> }

const SCREENS: Record<string, Screen> = {
  // 建賽表單第 1 步封面欄
  'form-empty': { env: () => wizardEnv(instantUpload), Page: NewCompetitionPage },
  'form-uploading': {
    env: () => wizardEnv(neverUpload), Page: NewCompetitionPage,
    open: async () => { await pickPhoto(); await until('上傳中', () => !!document.querySelector('.cpc-busy')); },
  },
  'form-ready': {
    env: () => wizardEnv(instantUpload), Page: NewCompetitionPage,
    open: async () => { await pickPhoto(); await until('更換鈕', () => buttonsNamed('更換').length > 0); },
  },
  'form-error': {
    env: () => wizardEnv(failUpload), Page: NewCompetitionPage,
    open: async () => { await pickPhoto(); await until('上傳失敗', () => !!document.getElementById('cpf-cover-error')); },
  },
  // 後端還沒部署封面欄（舊 cpHost 回 UNKNOWN_FIELD）：建立後跳回第 1 步，錯誤畫在封面欄
  'form-timeout': {
    env: () => wizardEnv(timeoutUpload), Page: NewCompetitionPage,
    open: async () => { await pickPhoto(); await until('上傳逾時', () => !!document.getElementById('cpf-cover-error')); },
  },
  'form-server-error': {
    env: () => ({
      ...wizardEnv(instantUpload, async () => { throw new CpCallError('UNKNOWN_FIELD', { field: 'cover' }); }),
      preview: { wizardStep: 3 },
      wizardSeed: { ...wizardSeed(), cover: PITCH },
    }),
    Page: NewCompetitionPage,
    open: async () => {
      await until('建立賽事鈕', () => buttonsNamed('建立賽事').length > 0);
      click('建立賽事');
      await until('封面欄錯誤', () => !!document.getElementById('cpf-cover-error'));
      window.scrollTo(0, 0);
    },
  },
  // 第 2 步（組別）：底部「上一步｜下一步」＋下方「取消建立」（cp-create-cancel），帶已選封面進來
  'form-step2': {
    env: () => ({ ...wizardEnv(instantUpload), preview: { wizardStep: 2 }, wizardSeed: { ...wizardSeed(), cover: PITCH } }),
    Page: NewCompetitionPage,
  },
  'form-confirm': {
    env: () => ({ ...wizardEnv(instantUpload), preview: { wizardStep: 3 }, wizardSeed: { ...wizardSeed(), cover: PITCH } }),
    Page: NewCompetitionPage,
  },
  // 報隊管理「編輯賽事資訊」：沒封面、已有封面、換封面（選圖上傳後直接存）、移除、已結束只能移除、下架主辦看不到
  'manage-empty': { env: () => hostManage({ cover: null }, instantUpload), Page: CompetitionManagePage, open: openEdit },
  'manage-ready': { env: () => hostManage({ cover: PITCH }, instantUpload), Page: CompetitionManagePage, open: openEdit },
  // 上傳中：「編輯賽事資訊」與「完成」暫時不能按（收起來封面欄會卸載、上傳完就不會存）
  'manage-uploading': {
    env: () => hostManage({ cover: null }, neverUpload), Page: CompetitionManagePage,
    open: async () => { await openEdit(); await pickPhoto(); await until('上傳中', () => !!document.querySelector('.cpc-busy')); },
  },
  'manage-timeout': {
    env: () => hostManage({ cover: PITCH }, timeoutUpload), Page: CompetitionManagePage,
    open: async () => { await openEdit(); await pickPhoto(); await until('上傳逾時', () => !!document.getElementById('cpf-cover-error')); },
  },
  'manage-changed': {
    env: () => hostManage({ cover: cover('cup') }, instantUpload), Page: CompetitionManagePage,
    open: async () => { await openEdit(); await pickPhoto(); await until('已更新封面', () => (document.body.textContent ?? '').includes('已更新封面')); },
  },
  'manage-removed': {
    env: () => hostManage({ cover: PITCH }, instantUpload), Page: CompetitionManagePage,
    open: async () => {
      await openEdit();
      click('移除');
      await until('已移除封面', () => (document.body.textContent ?? '').includes('已移除封面') && !!document.querySelector('.cpc-drop'));
    },
  },
  'manage-ended': { env: () => hostManage({ cover: PITCH, endedAt: taipeiMs(2026, 12, 9, 18, 0), endedBy: 'host', endReason: '示範' }), Page: CompetitionManagePage, open: openEdit },
  'manage-hidden-host': { env: () => hostManage({ cover: PITCH, hidden: true, hiddenReason: '示範下架' }), Page: CompetitionManagePage, open: openEdit },
  // 詳情頂部
  'detail-cover': { env: () => withCover(screenEnv('real-live'), { cover: PITCH }), Page: CompetitionDetailPage },
  'detail-recruit-cover': { env: () => withCover(screenEnv('real-recruit'), { cover: cover('cup') }), Page: CompetitionDetailPage },
  'detail-done-cover': { env: () => withCover(screenEnv('real-done'), { cover: cover('dusk') }), Page: CompetitionDetailPage },
  'detail-none': { env: () => withCover(screenEnv('real-live'), { cover: null }), Page: CompetitionDetailPage },
  'detail-hidden-host': {
    env: () => ({ ...withCover(screenEnv('real-live'), { cover: PITCH, hidden: true, hiddenReason: '示範下架' }), actor: hostActor }),
    Page: CompetitionDetailPage,
  },
  'detail-hidden-admin': {
    env: () => ({ ...withCover(screenEnv('real-live'), { cover: PITCH, hidden: true, hiddenReason: '示範下架' }), actor: adminActor }),
    Page: CompetitionDetailPage,
  },
  // 清單：有封面卡（縮圖）與沒封面卡並列
  'list-mixed': { env: listEnv, Page: ListIn },
  // 訪客（未登入）：清單有圖／沒圖混排、詳情有封面
  'guest-list': { env: () => ({ ...listEnv(), actor: GUEST }), Page: ListIn },
  'list-board': { env: listInEnv, Page: BoardScreen },
  'list-board-live': { env: listInEnv, Page: BoardLiveScreen },
  'list-board-all': { env: listInEnv, Page: BoardAllScreen },
  'list-hidden-admin': { env: hiddenAdminEnv, Page: ListIn },
  'guest-detail': { env: () => ({ ...withCover(screenEnv('real-live'), { cover: PITCH }), actor: GUEST }), Page: CompetitionDetailPage },
};

const cfg = SCREENS[screenName];

function Screen(): ComponentChildren {
  if (!cfg) return <p class="cpr-cap">沒有這個 screen：{screenName}</p>;
  const Page = cfg.Page;
  return (
    <CpEnvProvider value={cfg.env()}>
      <Page />
    </CpEnvProvider>
  );
}

void start();

async function start(): Promise<void> {
  await setLocale('zh-TW');
  await loadCompetitionsDict('zh-TW');
  if (framed) await import('@/ui/app-shell.css');
  if (screenName.startsWith('list-board') && artName === 'photo') await loadPhoto();
  const root = document.getElementById('app');
  if (!root) return;
  render(
    <LocationProvider>
      {framed ? (
        <div class="app-shell ui-app-shell">
          <main class="app-main"><Screen /></main>
        </div>
      ) : <Screen />}
      <ToastHost />
      <AppConfirmHost />
    </LocationProvider>,
    root,
  );
  const win = window as unknown as { __CPS_READY?: boolean; __CPS_ERROR?: string };
  try {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await cfg?.open?.();
    await new Promise((resolve) => setTimeout(resolve, 200));
    win.__CPS_READY = true;
  } catch (err) {
    win.__CPS_ERROR = err instanceof Error ? err.message : String(err);
  }
}
