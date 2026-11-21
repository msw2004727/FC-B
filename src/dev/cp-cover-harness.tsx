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
import { CpEnvProvider, type CpInjectedEnv } from '@/features/competitions/env';
import { loadCompetitionsDict } from '@/features/competitions/i18n';
import { CpCallError } from '@/features/competitions/data/cp-callables';
import type { UploadedCover } from '@/features/competitions/data/cover-upload';
import type { CompetitionCover, CompetitionDoc } from '@/features/competitions/data/types';
import { adminActor, competition, hostActor, idleActions, listInEnv, screenEnv, wizardSeed } from '@/features/competitions/testing/screen-fixtures';
import { taipeiMs } from '@/features/competitions/format';
import CompetitionDetailPage from '@/features/competitions/pages/CompetitionDetailPage';
import CompetitionManagePage from '@/features/competitions/pages/CompetitionManagePage';
import NewCompetitionPage from '@/features/competitions/pages/NewCompetitionPage';

const params = new URLSearchParams(location.search);
const screenName = params.get('screen') || 'form-empty';
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
const framed = params.get('frame') === '1';
document.documentElement.setAttribute('data-theme', theme);

// ── 自己畫的示範封面（1200×450；縮圖是正中央 4:3 那一塊，模擬自動裁切） ──
const ART: Record<string, string> = {
  pitch: '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1f7a4d"/><stop offset="1" stop-color="#0f4c3a"/></linearGradient></defs><rect width="1200" height="450" fill="url(#g)"/><g fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="6"><rect x="60" y="40" width="1080" height="370"/><line x1="600" y1="40" x2="600" y2="410"/><circle cx="600" cy="225" r="80"/><rect x="60" y="130" width="150" height="190"/><rect x="990" y="130" width="150" height="190"/></g><g fill="#fff" fill-opacity=".08"><rect x="0" width="150" height="450"/><rect x="300" width="150" height="450"/><rect x="750" width="150" height="450"/><rect x="1050" width="150" height="450"/></g>',
  cup: '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2=".6"><stop offset="0" stop-color="#312e81"/><stop offset="1" stop-color="#0e7490"/></linearGradient></defs><rect width="1200" height="450" fill="url(#g)"/><circle cx="880" cy="230" r="190" fill="#fff" fill-opacity=".1"/><circle cx="880" cy="230" r="120" fill="none" stroke="#fde68a" stroke-opacity=".8" stroke-width="10"/><circle cx="300" cy="90" r="60" fill="#fde68a" fill-opacity=".35"/><path d="M0 380 L1200 260 L1200 450 L0 450Z" fill="#000" fill-opacity=".18"/>',
  dusk: '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#475569"/><stop offset="1" stop-color="#1e293b"/></linearGradient></defs><rect width="1200" height="450" fill="url(#g)"/><path d="M0 450 L260 210 L470 360 L700 160 L960 340 L1200 220 L1200 450Z" fill="#94a3b8" fill-opacity=".35"/><circle cx="930" cy="110" r="46" fill="#e2e8f0" fill-opacity=".6"/>',
};

function svg(art: string, viewBox: string, w: number, h: number): string {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid slice">${ART[art]}</svg>`)}`;
}

function cover(art: string): CompetitionCover {
  return { url: svg(art, '0 0 1200 450', 1200, 450), thumb: svg(art, '300 0 600 450', 224, 168) };
}

const PITCH = cover('pitch');

// ── 上傳：假的（不連 Storage） ──
const instantUpload = async (dataUrl: string): Promise<UploadedCover> => ({ url: dataUrl, thumb: PITCH.thumb, thumbSrc: PITCH.thumb });
const neverUpload = (): Promise<UploadedCover> => new Promise(() => {});
const failUpload = async (): Promise<UploadedCover> => { throw new Error('offline'); };

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
  'form-confirm': {
    env: () => ({ ...wizardEnv(instantUpload), preview: { wizardStep: 3 }, wizardSeed: { ...wizardSeed(), cover: PITCH } }),
    Page: NewCompetitionPage,
  },
  // 報隊管理「編輯賽事資訊」：沒封面、已有封面、換封面（選圖上傳後直接存）、移除、已結束只能移除、下架主辦看不到
  'manage-empty': { env: () => hostManage({ cover: null }, instantUpload), Page: CompetitionManagePage, open: openEdit },
  'manage-ready': { env: () => hostManage({ cover: PITCH }, instantUpload), Page: CompetitionManagePage, open: openEdit },
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
