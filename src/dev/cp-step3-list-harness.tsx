// 賽事清單頁示範頁（新外觀清-6，第 1a 批第 7 節、第 5 批第 7 節）：畫正式的 TournamentsPage（含動態載入的站內區塊），
// 外部賽事、登入者由 src/dev/cp-list-fakes 的假模組給（dev-harness/vite.cp-list.config.ts 換模組），
// 站內賽事走 CpEnvProvider 注入的記憶體假資料。不連 Firestore、不呼叫 Functions。只在本機截圖用，正式 build 不含。
// 外框照正式 App（.ui-app-shell／.app-main：800px 以下最寬 560、以上 640），1280 寬時是置中的一欄。
// 參數：?screen=<下方 SCREENS 的名稱>&theme=light|dark；站內畫面另帶 &src=in（截圖腳本會帶）。
// （舊版這支是手寫標記的預覽，cp-step3-list-harness.css 的分類色變數 category-tokens.test.ts 還在讀，檔案留著、這裡不再匯入。）
import { render } from 'preact';
import { LocationProvider } from 'preact-iso';
import '../styles/legacy-vars.css';
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/legacy/base.css';
import '../styles/legacy/layout.css';
import '../styles/legacy-body-state.css';
import '../styles/legacy-line-height.css';
import '@/ui/app-shell.css';
import { setLocale } from '@/i18n/i18n';
import { AppConfirmHost } from '@/ui/AppConfirm';
import { ToastHost } from '@/ui/ToastHost';
import type { ViewerView } from '@/features/profile/data/viewer';
import type { TournamentCard } from '@/features/tournaments/data/card-model';
import { CpEnvProvider, type CpInjectedEnv } from '@/features/competitions/env';
import { createFakeCpRepo } from '@/features/competitions/testing/fake-cp-repo';
import {
  LONG_COMP_NAME,
  LONG_VENUE,
  NOW,
  competition,
  idleActions,
  memberActor,
} from '@/features/competitions/testing/screen-fixtures';
import { summaryShardIdOf } from '@/features/competitions/data/schedule-load';
import { taipeiMs } from '@/features/competitions/format';
import type { CompetitionDoc, CpMineItem, SummaryEntry } from '@/features/competitions/data/types';
import { AUTH_HINT_KEY } from '@/data/auth-hint';
import { CP_INAPP_HINT_KEY } from '@/features/tournaments/inapp-hint';
import type { CplState } from './cp-list-fakes/state';
import TournamentsPage from '@/features/tournaments/pages/TournamentsPage';

const params = new URLSearchParams(location.search);
const screenName = params.get('screen') || 'in';
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.setAttribute('data-theme', theme);

// ── 外部賽事（日期對真實今天 2026-11 下旬：未來有圖、未來沒圖兩張、已結束有圖、已結束沒圖） ──
function thumb(a: string, b: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="60"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="160" height="60" fill="url(#g)"/><circle cx="118" cy="30" r="18" fill="#fff" fill-opacity=".55"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
function ext(id: string, name: string, type: TournamentCard['type'], startDate: string, endDate: string, image = ''): TournamentCard {
  return { id, name, type, startDate, endDate, url: `https://example.com/${id}`, image, imagePath: '' };
}
const EXT_CARDS: TournamentCard[] = [
  ext('tc_a', '2027 全國青年足球公開賽', 'cup', '2027-03-12', '2027-03-14', thumb('#e11d48', '#f59e0b')),
  ext('tc_b', '北區社區足球聯賽', 'league', '2026-12-12', '2027-02-27'),
  ext('tc_c', '週末三對三友誼賽', 'friendly', '2026-12-06', '2026-12-06'),
  ext('tc_d', '2026 秋季邀請賽', 'cup', '2026-10-09', '2026-10-11', thumb('#2563eb', '#22c55e')),
  // 已結束、沒有照片：預設縮圖也要跟著變淡
  ext('tc_e', '夏季五人制聯賽', 'league', '2026-08-01', '2026-08-30'),
];
const EXT_LONG: TournamentCard[] = [
  ext('tc_l1', '二〇二七年新北市三重區春季社區五人制足球邀請賽', 'cup', '2026-12-27', '2027-01-03'),
  ext('tc_l2', 'FEDA CUP 2027 Taiwan International Youth Football Festival', 'league', '2027-04-02', '2027-04-05', thumb('#7c3aed', '#06b6d4')),
  ext('tc_l3', '週末友誼賽', 'friendly', '2026-12-13', '2026-12-13'),
];

function viewer(kind: 'member' | 'manager' | 'guest'): ViewerView {
  return {
    uid: kind === 'guest' ? null : kind === 'manager' ? 'uid_admin' : 'uid_member',
    role: kind === 'manager' ? 'super_admin' : 'user',
    roleLevel: 0,
    teamIds: new Set(),
    capabilities: [],
    displayName: '示範',
    pictureUrl: null,
    hasPermission: (code: string) => kind === 'manager' && code === 'admin.tournaments.manage_all',
  } as ViewerView;
}

// ── 站內賽事（NOW＝2026/12/10 12:00 台北） ──
function entry(id: string, k: number, st: SummaryEntry['st']): SummaryEntry {
  return { id, k, st, dv: 'dv', r: 1, no: 1, v: null, h: { id: 'h', n: '主' }, a: { id: 'a', n: '客' }, s: [0, 0], wo: null } as SummaryEntry;
}
const SHARD = summaryShardIdOf(NOW);
const todayShard = (n = 3) => [{
  id: SHARD,
  entries: [
    entry('m1', taipeiMs(2026, 12, 10, 10, 0), 'finished'),
    entry('m2', taipeiMs(2026, 12, 10, 14, 30), 'scheduled'),
    entry('m3', taipeiMs(2026, 12, 10, 16, 0), 'scheduled'),
  ].slice(0, n),
}];
const P = { hostType: 'personal', hostTeamId: null, feeNote: null } as const;
const live = (id: string, name: string, category: CompetitionDoc['category'], venue: string, hoursAgo = 1) => competition({
  ...P, id, name, category, regCloseAt: taipeiMs(2026, 12, 1, 23, 59),
  firstMatchAt: NOW - hoursAgo * 3_600_000, lastMatchAt: NOW + 2 * 86_400_000, venues: [{ name: venue }],
} as Partial<CompetitionDoc>);
const warm = (id: string, name: string, extra: Partial<CompetitionDoc> = {}) => competition({
  ...P, id, name, category: 'league', regCloseAt: taipeiMs(2026, 12, 9, 23, 59),
  firstMatchAt: taipeiMs(2026, 12, 13, 9, 0), lastMatchAt: taipeiMs(2026, 12, 14, 18, 0), venues: [{ name: '河濱足球場' }], ...extra,
} as Partial<CompetitionDoc>);
const recruit = (id: string, name: string, extra: Partial<CompetitionDoc> = {}) => competition({
  ...P, id, name, category: 'friendly', venues: [{ name: '示範國小' }], ...extra,
} as Partial<CompetitionDoc>);
const done = (id: string, name: string) => competition({
  ...P, id, name, category: 'league', regCloseAt: taipeiMs(2026, 9, 1, 23, 59),
  firstMatchAt: taipeiMs(2026, 10, 3, 8, 0), lastMatchAt: taipeiMs(2026, 11, 21, 18, 0), venues: [{ name: '示範運動公園' }],
} as Partial<CompetitionDoc>);
const BASIC = [live('live_cup', '示範盃五人制足球賽', 'cup', '示範運動公園'), warm('warm_lg', '冬季聯賽'), recruit('rec_fr', '新春迎新友誼賽')];
const NAMED: CpMineItem[] = [
  { id: 'm_a', cid: 'old_a', roles: ['host'], host: true, name: '去年秋季盃', category: 'cup' } as CpMineItem,
  { id: 'm_b', cid: 'old_b', roles: ['host'], host: true, name: '社區友誼賽', category: 'friendly' } as CpMineItem,
];

interface Seed {
  comps?: CompetitionDoc[];
  summary?: Record<string, ReturnType<typeof todayShard>>;
  mine?: CpMineItem[];
  isPublic?: boolean;
  hang?: boolean;
  guest?: boolean;
}
function env(seed: Seed): CpInjectedEnv {
  const repo = createFakeCpRepo({
    launch: { isPublic: seed.isPublic ?? true, bannedWords: [] },
    competitions: seed.comps ?? BASIC,
    summary: seed.summary ?? { live_cup: todayShard() },
    mine: { uid_member: seed.mine ?? [] },
  });
  if (seed.hang) repo.getLaunch = () => new Promise(() => undefined);
  const actor = seed.guest ? { ...memberActor, uid: null } : memberActor;
  return { actor, repo, actions: idleActions(), now: NOW } as CpInjectedEnv;
}

interface Screen { seed: Seed; viewer?: 'member' | 'manager' | 'guest'; cards?: TournamentCard[]; ext?: CplState['ext']; hint?: boolean }
const OFF: Seed = { isPublic: false };
const SCREENS: Record<string, Screen> = {
  // 站內（截圖腳本帶 &src=in）
  in: { seed: {} },
  'in-cup': { seed: {} },
  'in-mine': { seed: { mine: NAMED } },
  'in-done': { seed: { comps: [...BASIC, done('done_a', '秋季聯賽'), done('done_b', '中秋友誼盃')] } },
  'in-nolive': { seed: { comps: [warm('warm_lg', '冬季聯賽'), recruit('rec_fr', '新春迎新友誼賽'), recruit('rec_lg', '春季社區聯賽', { category: 'league' })] } },
  'in-twolive': { seed: { comps: [...BASIC, live('live_lg', '城市五人制聯賽', 'league', '河濱足球場', 2)], summary: { live_cup: todayShard(), live_lg: todayShard(2) } } },
  'in-live-noline': { seed: { comps: BASIC, summary: {} } },
  'in-recruit-board': { seed: { comps: [recruit('rec_fr', '新春迎新友誼賽'), recruit('rec_cup', '春季盃', { category: 'cup' })] } },
  'in-marks': { seed: { comps: [warm('warm_lg', '冬季聯賽'), warm('pp_lg', '延期聯賽', { status: 'postponed' }), recruit('cc_fr', '取消友誼賽', { status: 'cancelled' })] } },
  // 總收尾示範缺口：整場取消的賽事卡（狀態選「已結束」才看得到，紅字「已取消」膠囊）。
  'in-cancelled': { seed: { comps: [...BASIC, done('done_a', '秋季聯賽'), recruit('cc_fr', '取消友誼賽', { status: 'cancelled' })] } },
  'in-noboard': { seed: { comps: [], summary: {}, mine: NAMED } },
  'in-long': { seed: { comps: [live('live_long', LONG_COMP_NAME, 'cup', LONG_VENUE), warm('warm_long', LONG_COMP_NAME, { venues: [{ name: LONG_VENUE }] })], summary: { live_long: todayShard() } } },
  'in-guest': { seed: { guest: true }, viewer: 'guest' },
  'in-menu': { seed: {} },
  'in-menu-empty': { seed: {} },
  'in-menu-two': { seed: { comps: [...BASIC, done('done_a', '秋季聯賽'), done('done_b', '中秋友誼盃')] } },
  'in-loading': { seed: { hang: true }, hint: true },
  // 外部（有切換）
  ext: { seed: {} },
  'ext-admin': { seed: {}, viewer: 'manager' },
  'ext-long': { seed: {}, viewer: 'manager', cards: EXT_LONG },
  'ext-loading': { seed: {}, ext: 'loading' },
  'ext-empty': { seed: {}, cards: [] },
  'ext-error': { seed: {}, ext: 'error' },
  'ext-delete': { seed: {}, viewer: 'manager' },
  // 總收尾示範缺口：編輯已有封面圖的外部卡（表單的封面預覽圖）。圖用本機開發伺服器的 /og.png（表單只收 http(s) 網址）。
  'ext-edit-image': { seed: {}, viewer: 'manager', cards: [ext('tc_img', '2027 全國青年足球公開賽', 'cup', '2027-03-12', '2027-03-14', `${location.origin}/og.png`)] },
  // 沒有切換（閘門沒過；與功能開關關閉、閘門不回應的標記相同，見 TournamentsPage.no-switch-parity.test.tsx）
  'gate-off': { seed: OFF },
  'gate-off-admin': { seed: OFF, viewer: 'manager' },
  'gate-off-long': { seed: OFF, cards: EXT_LONG },
  'gate-off-loading': { seed: OFF, ext: 'loading' },
  'gate-off-empty': { seed: OFF, cards: [] },
  'gate-off-error': { seed: OFF, ext: 'error' },
};
const screen = SCREENS[screenName] ?? SCREENS.in!;

(window as unknown as { __CPL: CplState }).__CPL = {
  viewer: viewer(screen.viewer ?? 'member'),
  cards: screen.cards ?? EXT_CARDS,
  ext: screen.ext ?? 'ready',
};
try {
  localStorage.clear();
  if (screen.hint) {
    localStorage.setItem(AUTH_HINT_KEY, '1');
    localStorage.setItem(CP_INAPP_HINT_KEY, '1');
  }
} catch {
  // 截圖環境一定有 localStorage；拿不到就照沒有線索畫。
}

async function boot(): Promise<void> {
  await setLocale('zh-TW');
  render(
    <LocationProvider>
      <CpEnvProvider value={env(screen.seed)}>
        <div class="ui-app-shell">
          <main class="app-main" style="padding-top:8px;padding-bottom:24px">
            <TournamentsPage />
          </main>
        </div>
        <AppConfirmHost />
        <ToastHost />
      </CpEnvProvider>
    </LocationProvider>,
    document.getElementById('app')!,
  );
  (window as unknown as { __CPL_READY: boolean }).__CPL_READY = true;
}
void boot();
