// 長賽事名稱／長隊名量測（顧問 §3.460）：正式頁面＋記憶體假資料，不連 Firestore、不呼叫 Functions。
// ?page=list|detail|detail-live|manage|matches|schedule|staff|roster|wizard-3|wizard-done|accept|live
// ?name=short|22|24（賽事名稱）、?team=short|long（隊名）、?theme=light|dark。畫完設 window.__CPS_READY。
import { render } from 'preact';
import type { ComponentChildren, ComponentType } from 'preact';
import { LocationProvider } from 'preact-iso';
import '../styles/legacy-vars.css';
import '../styles/tokens.css';
import '../styles/base.css';
import '@/styles/category-tokens.css';
import '@/ui/app-shell.css';
import '@/features/tournaments/tournaments.css';
import '@/features/tournaments/list-v2.css';
import './cp-step3-real-harness.css';
import { setLocale } from '@/i18n/i18n';
import { AppConfirmHost } from '@/ui/AppConfirm';
import { ToastHost } from '@/ui/ToastHost';
import { InAppSection } from '@/features/competitions/components/InAppSection';
import type { MatchDoc, StaffAssignment } from '@/features/competitions/data/types';
import { CpEnvProvider, type CpInjectedEnv } from '@/features/competitions/env';
import { taipeiMs } from '@/features/competitions/format';
import { loadCompetitionsDict } from '@/features/competitions/i18n';
import { LiveMatchView } from '@/features/competitions/live/LiveMatchView';
import CompetitionDetailPage from '@/features/competitions/pages/CompetitionDetailPage';
import CompetitionManagePage from '@/features/competitions/pages/CompetitionManagePage';
import HostMatchesPage from '@/features/competitions/pages/HostMatchesPage';
import HostSchedulePage from '@/features/competitions/pages/HostSchedulePage';
import InviteAcceptPage from '@/features/competitions/pages/InviteAcceptPage';
import NewCompetitionPage from '@/features/competitions/pages/NewCompetitionPage';
import RosterPage from '@/features/competitions/pages/RosterPage';
import StaffPage from '@/features/competitions/pages/StaffPage';
import { createFakeCpRepo } from '@/features/competitions/testing/fake-cp-repo';
import {
  competition,
  hostActor,
  idleActions,
  listInEnv,
  memberActor,
  screenEnv,
  wizardSeed,
} from '@/features/competitions/testing/screen-fixtures';
import { S4_SCENE_LIVE } from '@/features/competitions/testing/step4-fixtures';

const params = new URLSearchParams(location.search);
const pageName = params.get('page') || 'detail';
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.setAttribute('data-theme', theme);

const COMP_NAMES: Record<string, string | null> = {
  short: null,
  '22': '新北市三重區二〇二七年春季社區五人制足球聯賽',
  '24': '新北市三重區二〇二七年春季社區五人制足球邀請聯賽',
};
const COMP = COMP_NAMES[params.get('name') ?? 'short'] ?? null;
const LONG_TEAM = params.get('team') === 'long';
// 13 字隊名，三個輪流套，主客隊認得出是哪一隊。
const TEAMS = ['新北市三重區社區足球俱樂部', '桃園市中壢區青年足球俱樂部', '高雄市前鎮區海風足球俱樂部'];
const teamMap = new Map<string, string>();
function longTeam(name: string): string {
  let next = teamMap.get(name);
  if (!next) {
    next = TEAMS[teamMap.size % TEAMS.length] ?? TEAMS[0] ?? name;
    teamMap.set(name, next);
  }
  return next;
}
function isTeamName(value: string): boolean {
  return /^(示範隊[A-Z]|[一-鿿]{2}隊|[主客]隊\d+|一二三四五六七八九十示範隊)$/.test(value);
}

/** 只換資料（bundle、matches、schedule、wizardSeed），repo／actions 是函式，不碰。 */
function rename<T>(value: T, key = ''): T {
  if (Array.isArray(value)) return value.map((item) => rename(item, key)) as T;
  if (!value || typeof value !== 'object') {
    if (LONG_TEAM && typeof value === 'string' && (key === 'name' || key === 'n') && isTeamName(value)) return longTeam(value) as T;
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'function') { out[k] = v; continue; }
    out[k] = rename(v, k);
  }
  if (COMP && (key === 'competition' || key === 'wizardSeed') && typeof out.name === 'string') out.name = COMP;
  return out as T;
}

function renamed(env: CpInjectedEnv): CpInjectedEnv {
  const { repo, actions, ...rest } = env;
  return { ...rename(rest), repo, actions } as CpInjectedEnv;
}

function wizardEnv(screen: 'wizard-3' | 'wizard-done'): CpInjectedEnv {
  const env = screenEnv(screen);
  return COMP ? { ...env, wizardSeed: wizardSeed(COMP) } : env;
}

// 人員頁：比照 cp-k1112 harness 的資料（主辦兼記分、共同主辦兼裁判、長暱稱）。
const EXP = taipeiMs(2027, 1, 16, 18, 0);
function match(id: string, day: number, hour: number, venue: string, home: string, away: string): MatchDoc {
  const h = LONG_TEAM ? longTeam(home) : home;
  const a = LONG_TEAM ? longTeam(away) : away;
  return {
    id, divisionId: 'dv_adult', stageId: 'group', groupId: 'A', round: 1, matchNo: hour, label: null, matchKey: null,
    kickoffAt: taipeiMs(2027, 1, day, hour, 0), venueIdx: 0, venueName: venue,
    home: { teamId: `en_${id}h`, name: h }, away: { teamId: `en_${id}a`, name: a }, teamIds: [`en_${id}h`, `en_${id}a`],
    score: { home: 0, away: 0 }, penaltyScore: null, status: 'scheduled', rev: 0, resetRev: 0, lock: { locked: false },
    clockBase: { startedAt: null, pausedSec: 0, running: false, period: 'pre' }, finishedAt: null, confirmedAt: null,
    walkoverSide: null, result: null, resultSource: null, updatedAt: null, cancelReason: null, cancelledAt: null,
  };
}
const ASSIGN: StaffAssignment[] = [
  { uid: 'uid_host', roles: ['host', 'scorer'], matchIds: ['mt_1', 'mt_2'], expiresAt: EXP, memberNo: 1 },
  { uid: 'uid_co', roles: ['coHost', 'referee'], matchIds: ['mt_3'], expiresAt: EXP, memberNo: 2 },
  { uid: 'uid_a', roles: ['scorer'], matchIds: ['mt_1', 'mt_2'], expiresAt: EXP, memberNo: 3, displayName: '陳小明' },
];
function staffRepo() {
  return createFakeCpRepo({
    competitions: [competition({ id: 'cup', name: COMP ?? '2027 春季社區足球聯賽' })],
    staff: { cup: [{ uid: 'uid_host', roles: ['host'] }, { uid: 'uid_co', roles: ['coHost'] }] },
    assignments: { cup: ASSIGN },
    invites: { cup: [] },
    matches: { cup: [match('mt_1', 9, 9, '1號場', '雷霆隊', '海風隊'), match('mt_2', 9, 14, '2號場', '山貓隊', '銀河隊'), match('mt_3', 10, 10, '1號場', '藍鯨隊', '紅狐隊')] },
  });
}
const IV = 'iv_k1112demo0000000000';
const CODE = 'AbCdEfGhIjKlMnOpQrStUv';

const PAGES: Record<string, { env: () => CpInjectedEnv; Page: ComponentType; anchor: () => boolean }> = {
  detail: { env: () => renamed(screenEnv('real-recruit')), Page: CompetitionDetailPage, anchor: () => !!document.querySelector('.cps-title') },
  'detail-live': { env: () => renamed(screenEnv('real-live')), Page: CompetitionDetailPage, anchor: () => !!document.querySelector('.cps-top h1') && hasText('進行中') },
  manage: { env: () => renamed(screenEnv('host-approved')), Page: CompetitionManagePage, anchor: () => !!document.querySelector('.cps-h') },
  matches: { env: () => renamed(screenEnv('real-host-matches')), Page: HostMatchesPage, anchor: () => !!document.querySelector('.cp3-m') },
  schedule: { env: () => renamed(screenEnv('real-host-schedule')), Page: HostSchedulePage, anchor: () => !!document.querySelector('.cps-sub') },
  staff: { env: () => ({ actor: hostActor, repo: staffRepo(), actions: idleActions(), route: { cid: 'cup' } }), Page: StaffPage, anchor: () => hasText('陳小明') },
  roster: { env: () => renamed(screenEnv('roster')), Page: RosterPage, anchor: () => !!document.querySelector('.cps-title') },
  'wizard-3': { env: () => wizardEnv('wizard-3'), Page: NewCompetitionPage, anchor: () => !!document.querySelector('.cps-title') },
  'wizard-done': { env: () => wizardEnv('wizard-done'), Page: NewCompetitionPage, anchor: () => !!document.querySelector('.cps-title') },
  accept: {
    env: () => ({ actor: memberActor, repo: staffRepo(), actions: idleActions(), route: { cid: 'cup' }, signIn: async () => undefined }),
    Page: InviteAcceptPage,
    anchor: () => !!document.querySelector('.s4b-accept__name'),
  },
};

function ListIn(): ComponentChildren {
  return (
    <div class="legacy-ui tournaments-root" data-v2="1">
      <section class="page active tc-page" id="page-tournaments">
        <InAppSection tab="all" active />
      </section>
    </div>
  );
}

function LiveScreen(): ComponentChildren {
  const scene = S4_SCENE_LIVE;
  const m = LONG_TEAM
    ? { ...scene.match, home: { ...scene.match.home, name: longTeam(scene.match.home.name) }, away: { ...scene.match.away, name: longTeam(scene.match.away.name) } }
    : scene.match;
  const crests = LONG_TEAM ? scene.crests.map((row) => ({ ...row, name: longTeam(row.name), teamLogo: null })) : scene.crests.map((row) => ({ ...row, teamLogo: null }));
  return (
    <LiveMatchView match={m} clock={scene.clock} events={scene.events} voids={scene.voids} homeRoster={scene.homeRoster} awayRoster={scene.awayRoster} crests={crests} />
  );
}

function Screen(): ComponentChildren {
  if (pageName === 'list') {
    return (
      <CpEnvProvider value={listInEnv(idleActions(), COMP ?? undefined)}>
        <ListIn />
      </CpEnvProvider>
    );
  }
  if (pageName === 'live') return <LiveScreen />;
  const spec = PAGES[pageName];
  if (!spec) return <p class="cpr-cap">沒有這個 page：{pageName}</p>;
  const { Page } = spec;
  return (
    <CpEnvProvider value={spec.env()}>
      <Page />
    </CpEnvProvider>
  );
}

function hasText(text: string): boolean {
  return (document.body.textContent ?? '').includes(text);
}

async function until(label: string, ready: () => boolean): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < 6000) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`畫面未出現：${label}`);
}

void start();

async function start(): Promise<void> {
  const win = window as unknown as { __CPS_READY?: boolean; __CPS_ERROR?: string };
  try {
    if (pageName === 'accept') history.replaceState(null, '', `${location.pathname}${location.search}#i=${IV}&c=${CODE}`);
    await setLocale('zh-TW');
    await loadCompetitionsDict('zh-TW');
    const root = document.getElementById('app');
    if (!root) return;
    render(
      <LocationProvider>
        <div class="app-shell ui-app-shell">
          <main class="app-main">
            <Screen />
          </main>
        </div>
        <ToastHost />
        <AppConfirmHost />
      </LocationProvider>,
      root,
    );
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    if (pageName === 'list') await until('站內清單', () => !!document.querySelector('.tc-card-name'));
    else if (pageName === 'live') await until('即時頁', () => hasText('比賽紀錄'));
    else await until(pageName, PAGES[pageName]?.anchor ?? (() => true));
    win.__CPS_READY = true;
  } catch (err) {
    win.__CPS_ERROR = err instanceof Error ? err.message : String(err);
  }
}
