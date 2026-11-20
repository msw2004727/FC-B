// 賽事第 4 步 K11 邀請記分員、K12 管理員下架與檢舉：正式頁面＋記憶體假資料截圖。
// 不連 Firestore、不呼叫 Functions（動作全是假的）。?screen= 與 ?theme=light|dark。畫完設 window.__CPS_READY。
import { render } from 'preact';
import type { ComponentChildren, ComponentType } from 'preact';
import { LocationProvider } from 'preact-iso';
import '../styles/legacy-vars.css';
import '../styles/tokens.css';
import '../styles/base.css';
import '@/styles/category-tokens.css';
import '@/ui/app-shell.css';
import { setLocale } from '@/i18n/i18n';
import { AppConfirmHost } from '@/ui/AppConfirm';
import { ToastHost } from '@/ui/ToastHost';
import type { CpActions } from '@/features/competitions/actions';
import { CpCallError } from '@/features/competitions/data/cp-callables';
import type { InviteDoc, MatchDoc, ReportDoc, StaffAssignment } from '@/features/competitions/data/types';
import { CpEnvProvider, type CpInjectedEnv } from '@/features/competitions/env';
import { taipeiMs } from '@/features/competitions/format';
import { loadCompetitionsDict } from '@/features/competitions/i18n';
import CompetitionDetailPage from '@/features/competitions/pages/CompetitionDetailPage';
import InviteAcceptPage from '@/features/competitions/pages/InviteAcceptPage';
import StaffInvitePage from '@/features/competitions/pages/StaffInvitePage';
import StaffPage from '@/features/competitions/pages/StaffPage';
import { createFakeCpRepo } from '@/features/competitions/testing/fake-cp-repo';
import {
  adminActor,
  clubRepActor,
  competition,
  hostActor,
  idleActions,
  LONG_COMP_NAME,
  memberActor,
  screenEnv,
} from '@/features/competitions/testing/screen-fixtures';

const params = new URLSearchParams(location.search);
const screenName = params.get('screen') || 'staff-list';
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.setAttribute('data-theme', theme);

export const K1112_SCREENS = [
  'staff-list',
  'invite-form',
  'invite-link',
  'accept-guest',
  'accept-signed',
  'accept-error',
  'detail-admin-reports',
  'detail-admin-hide',
  'detail-host-hidden',
  // 開放前提示：讀不到根文件（權限被拒）、檢舉成功、未登入檢舉。
  'detail-hidden',
  'detail-report-done',
  'detail-report-guest',
  // 新外觀第 1b 批卡 1b-7：詳情頁讀取失敗（網路類錯誤，有重試）。
  'detail-load-error',
  // 新外觀第 4 批第 7 節「要補」：代表自己那一列、邀請清單空的／讀取失敗、撤銷確認框、已下架的管理員視角。
  'staff-list-rep',
  'staff-invites-empty',
  'staff-invites-error',
  'staff-revoke-confirm',
  'detail-admin-hidden',
  // 第 3 批留下的：接受邀請・連結無效、找不到邀請資料、連線錯誤可重按、送出中、22 字賽事名。
  'accept-bad-link',
  'accept-no-ticket',
  'accept-net-error',
  'accept-sending',
  'accept-long-name',
] as const;

const CODE = 'AbCdEfGhIjKlMnOpQrStUv';
const IV = 'iv_k1112demo0000000000';
const EXP = taipeiMs(2027, 1, 16, 18, 0);

function match(id: string, day: number, hour: number, venue: string, home: string, away: string): MatchDoc {
  return {
    id, divisionId: 'dv_adult', stageId: 'group', groupId: 'A', round: 1, matchNo: hour, label: null, matchKey: null,
    kickoffAt: taipeiMs(2027, 1, day, hour, 0), venueIdx: 0, venueName: venue,
    home: { teamId: `en_${home}`, name: home }, away: { teamId: `en_${away}`, name: away }, teamIds: [`en_${home}`, `en_${away}`],
    score: { home: 0, away: 0 }, penaltyScore: null, status: 'scheduled', rev: 0, resetRev: 0, lock: { locked: false },
    clockBase: { startedAt: null, pausedSec: 0, running: false, period: 'pre' }, finishedAt: null, confirmedAt: null,
    walkoverSide: null, result: null, resultSource: null, updatedAt: null, cancelReason: null, cancelledAt: null,
  };
}

const MATCHES = [
  match('mt_1', 9, 9, '1號場', '雷霆隊', '海風隊'),
  match('mt_2', 9, 14, '2號場', '山貓隊', '銀河隊'),
  match('mt_3', 10, 10, '1號場', '藍鯨隊', '一二三四五六七八九十示範隊'),
];

const ASSIGN: StaffAssignment[] = [
  // 顧問 11-20：主辦兼記分、共同主辦兼裁判（兩個標籤；共同主辦那列有移除鈕，是最擠的情況）
  { uid: 'uid_host', roles: ['host', 'scorer'], matchIds: ['mt_1', 'mt_2'], expiresAt: EXP, memberNo: 1 },
  { uid: 'uid_co', roles: ['coHost', 'referee'], matchIds: ['mt_3'], expiresAt: EXP, memberNo: 2 },
  { uid: 'uid_a', roles: ['scorer'], matchIds: ['mt_1', 'mt_2'], expiresAt: EXP, memberNo: 3, displayName: '陳小明' },
  { uid: 'uid_long', roles: ['scorer'], matchIds: ['mt_3'], expiresAt: taipeiMs(2027, 1, 17, 18, 0), memberNo: 5, displayName: '一二三四五六七八九十一二三四五' },
  { uid: 'uid_b', roles: ['referee'], matchIds: ['mt_3'], expiresAt: null, memberNo: 4, displayName: null },
];

const INVITES: InviteDoc[] = [
  { id: 'iv_open1', roles: ['scorer'], matchIds: ['mt_1', 'mt_2'], expiresAt: EXP, status: 'open', createdAt: 3, usedAt: null, usedMemberNo: null },
  { id: 'iv_open2', roles: ['referee'], matchIds: ['mt_3'], expiresAt: EXP, status: 'open', createdAt: 2, usedAt: null, usedMemberNo: null },
];

const REPORTS = [
  { id: 'rp_aaaaaaaa', reason: 'impersonation', detail: '冒用我們俱樂部的名字辦比賽，請協助處理。', count: 3, lastAt: taipeiMs(2027, 1, 8, 21, 5), status: 'open', reopened: false, reporterUid: 'uid_never_rendered' },
  { id: 'rp_bbbbbbbb', reason: 'fake', detail: null, count: 1, lastAt: taipeiMs(2027, 1, 7, 9, 0), status: 'resolved', reopened: true },
  { id: 'rp_cccccccc', reason: 'privacy', detail: '名單露出未成年全名', count: 1, lastAt: taipeiMs(2027, 1, 6, 12, 30), status: 'dismissed', reopened: false },
] as unknown as ReportDoc[];

function repo(opts: { name?: string; invites?: InviteDoc[]; clubHost?: boolean } = {}) {
  return createFakeCpRepo({
    // clubHost：俱樂部主辦（hostTeamId＝clubRepActor 代表的 club_host），代表本人沒有主辦 staff 文件。
    competitions: [competition({ id: 'cup', name: opts.name ?? '2027 春季社區足球聯賽', ...(opts.clubHost ? { hostType: 'club', hostTeamId: 'club_host' } : {}) })],
    staff: { cup: opts.clubHost ? [{ uid: 'uid_co', roles: ['coHost'] }] : [{ uid: 'uid_host', roles: ['host'] }, { uid: 'uid_co', roles: ['coHost'] }] },
    assignments: { cup: opts.clubHost ? ASSIGN.filter((row) => row.uid !== 'uid_host') : ASSIGN },
    invites: { cup: opts.invites ?? INVITES },
    matches: { cup: MATCHES },
    reports: { cup: REPORTS },
  });
}

function actions(): CpActions {
  return {
    ...idleActions(),
    createInvite: async () => ({ ivId: IV, code: CODE, expiresAt: EXP }),
    revokeInvite: async () => ({}),
    acceptInvite: async () => { throw new CpCallError('INVITE_REVOKED', {}); },
    moderate: async () => ({}),
    reviewReport: async () => ({}),
  };
}

function staffEnv(screen = 'staff-list'): CpInjectedEnv {
  if (screen === 'staff-list-rep') {
    return { actor: clubRepActor, repo: repo({ clubHost: true }), actions: actions(), route: { cid: 'cup' } };
  }
  if (screen === 'staff-invites-empty') return { actor: hostActor, repo: repo({ invites: [] }), actions: actions(), route: { cid: 'cup' } };
  if (screen === 'staff-invites-error') {
    const base = repo();
    return { actor: hostActor, repo: { ...base, listInvites: async () => { throw new Error('offline'); } }, actions: actions(), route: { cid: 'cup' } };
  }
  return { actor: hostActor, repo: repo(), actions: actions(), route: { cid: 'cup' } };
}

function detailEnv(screen: string): CpInjectedEnv {
  const base = screenEnv('real-recruit');
  const bundle = base.bundle;
  const admin = screen !== 'detail-host-hidden';
  // 已下架：主辦視角（detail-host-hidden）與管理員視角（detail-admin-hidden，管理員區顯示「已下架」）。
  const hidden = screen === 'detail-host-hidden' || screen === 'detail-admin-hidden';
  const comp = bundle?.competition;
  return {
    ...base,
    actor: admin ? adminActor : hostActor,
    repo: repo(),
    actions: actions(),
    preview: {
      ...(screen === 'detail-admin-reports' ? { reportsOpen: true } : {}),
      ...(screen === 'detail-admin-hide' ? { moderateOpen: true } : {}),
    },
    bundle: bundle && comp ? {
      ...bundle,
      staff: admin ? bundle.staff : { uid: 'uid_host', roles: ['host'] },
      competition: hidden ? { ...comp, hidden: true, hiddenReason: '主辦資料與俱樂部登記不符，暫停公開', hiddenAt: comp.regOpenAt } : comp,
    } : bundle,
  };
}

/** 未登入看下架／草稿／內部期賽事：根文件讀取被 Rules 拒絕。 */
function deniedEnv(): CpInjectedEnv {
  const denied = async () => { throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }); };
  return { actor: { ...memberActor, uid: null }, repo: { ...repo(), getCompetition: denied }, actions: actions(), route: { cid: 'cup' } };
}

/** 讀根文件遇到網路類錯誤：讀取失敗＋重試（重試仍失敗）。 */
function loadErrorEnv(): CpInjectedEnv {
  const broken = async () => { throw Object.assign(new Error('network'), { code: 'unavailable' }); };
  return { actor: { ...memberActor, uid: null }, repo: { ...repo(), getCompetition: broken }, actions: actions(), route: { cid: 'cup' } };
}

function reportEnv(guest: boolean): CpInjectedEnv {
  const base = screenEnv('real-recruit');
  return {
    ...base,
    actor: guest ? { ...memberActor, uid: null } : memberActor,
    repo: repo(),
    actions: { ...actions(), report: async () => ({ cid: 'cup', reported: true }) },
    preview: { reportOpen: true },
    signIn: async () => undefined,
  };
}

function envOf(screen: string): { env: CpInjectedEnv; Page: ComponentType } {
  if (screen === 'detail-hidden') return { env: deniedEnv(), Page: CompetitionDetailPage };
  if (screen === 'detail-load-error') return { env: loadErrorEnv(), Page: CompetitionDetailPage };
  if (screen === 'detail-report-done' || screen === 'detail-report-guest') {
    return { env: reportEnv(screen === 'detail-report-guest'), Page: CompetitionDetailPage };
  }
  if (screen === 'staff-list' || screen.startsWith('staff-')) return { env: staffEnv(screen), Page: StaffPage };
  if (screen === 'invite-form' || screen === 'invite-link') return { env: staffEnv(), Page: StaffInvitePage };
  if (screen.startsWith('accept-')) {
    const base = actions();
    const acceptInvite: CpActions['acceptInvite'] = screen === 'accept-net-error'
      // 連線錯誤：沒有 reason（UNKNOWN），邀請留在記憶體，按鈕還在可以再按。
      ? async () => { throw new Error('network'); }
      : screen === 'accept-sending'
        // 送出中：一直不回，截圖停在按鈕轉圈。
        ? () => new Promise<never>(() => undefined)
        : base.acceptInvite;
    return {
      env: {
        actor: screen === 'accept-guest' ? { ...memberActor, uid: null } : memberActor,
        repo: repo(screen === 'accept-long-name' ? { name: LONG_COMP_NAME } : {}),
        actions: { ...base, acceptInvite },
        route: { cid: 'cup' },
        signIn: async () => undefined,
      },
      Page: InviteAcceptPage,
    };
  }
  return { env: detailEnv(screen), Page: CompetitionDetailPage };
}

function Screen(): ComponentChildren {
  const { env, Page } = envOf(screenName);
  return (
    <CpEnvProvider value={env}>
      <Page />
    </CpEnvProvider>
  );
}

function buttonsNamed(name: string): HTMLButtonElement[] {
  return [...document.querySelectorAll('button')].filter((node) => (node.textContent ?? '').replace(/\s+/g, ' ').trim() === name);
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

const OPEN: Record<string, () => Promise<void>> = {
  'staff-list': () => until('人員清單', () => hasText('陳小明') && hasText('尚未使用的邀請')),
  'invite-form': async () => {
    await until('邀請表單', () => hasText('產生邀請連結'));
    const box = document.querySelector<HTMLInputElement>('input[type="checkbox"]');
    box?.click();
  },
  'invite-link': async () => {
    await until('邀請表單', () => buttonsNamed('產生邀請連結').length > 0);
    document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    buttonsNamed('產生邀請連結')[0]?.click();
    await until('邀請連結', () => hasText('連結只顯示這一次'));
  },
  'accept-guest': () => until('登入提示', () => hasText('登入後才能接受邀請')),
  'accept-signed': () => until('接受頁', () => hasText('2027 春季社區足球聯賽')),
  'accept-error': async () => {
    await until('接受頁', () => buttonsNamed('接受邀請').length > 0);
    buttonsNamed('接受邀請')[0]?.click();
    await until('錯誤', () => hasText('主辦已撤銷這個邀請'));
  },
  'detail-admin-reports': () => until('檢舉紀錄', () => hasText('冒用我們俱樂部的名字')),
  'detail-admin-hide': () => until('下架對話框', () => hasText('下架原因')),
  'detail-host-hidden': () => until('下架提示', () => hasText('此賽事已被管理員下架')),
  'detail-hidden': () => until('不公開', () => hasText('這場賽事目前不公開')),
  'detail-load-error': () => until('讀取失敗', () => hasText('讀取失敗') && buttonsNamed('重試').length > 0),
  'detail-report-done': async () => {
    await until('檢舉面板', () => buttonsNamed('送出檢舉').length > 0);
    buttonsNamed('送出檢舉')[0]?.click();
    await until('檢舉成功提示', () => hasText('已收到檢舉'));
  },
  'detail-report-guest': () => until('先登入提示', () => hasText('請先登入再檢舉')),
  'staff-list-rep': () => until('代表看人員清單', () => hasText('陳小明') && hasText('尚未使用的邀請')),
  'staff-invites-empty': () => until('邀請清單空的', () => hasText('目前沒有尚未使用的邀請')),
  'staff-invites-error': () => until('邀請清單讀取失敗', () => hasText('陳小明') && hasText('讀取失敗') && buttonsNamed('重試').length > 0),
  'staff-revoke-confirm': async () => {
    await until('撤銷鈕', () => buttonsNamed('撤銷').length > 0);
    buttonsNamed('撤銷')[0]?.click();
    await until('撤銷確認框', () => hasText('撤銷邀請？') && hasText('撤銷後這個連結就不能使用'));
  },
  'detail-admin-hidden': () => until('管理員看已下架', () => hasText('此賽事已被管理員下架')),
  'accept-bad-link': () => until('連結無效', () => hasText('邀請連結無效')),
  'accept-no-ticket': () => until('找不到邀請資料', () => hasText('找不到邀請資料')),
  'accept-net-error': async () => {
    await until('接受頁', () => buttonsNamed('接受邀請').length > 0);
    buttonsNamed('接受邀請')[0]?.click();
    await until('連線錯誤', () => hasText('操作失敗，請稍後再試') && buttonsNamed('接受邀請').length > 0);
  },
  'accept-sending': async () => {
    await until('接受頁', () => buttonsNamed('接受邀請').length > 0);
    buttonsNamed('接受邀請')[0]?.click();
    await until('送出中', () => [...document.querySelectorAll('button')].some((node) => node.getAttribute('aria-busy') === 'true' || node.disabled));
  },
  'accept-long-name': () => until('長賽事名', () => hasText(LONG_COMP_NAME)),
};

void start();

async function start(): Promise<void> {
  const win = window as unknown as { __CPS_READY?: boolean; __CPS_ERROR?: string };
  try {
    if (!(K1112_SCREENS as readonly string[]).includes(screenName)) throw new Error(`沒有這個 screen：${screenName}`);
    // 接受頁：網址帶 #i=&c=（頁面會立刻拿掉 #）。連結無效＝# 格式不對；找不到邀請資料＝沒有 # 也沒有暫存。
    if (screenName === 'accept-bad-link') {
      history.replaceState(null, '', `${location.pathname}${location.search}#i=bad`);
    } else if (screenName === 'accept-no-ticket') {
      history.replaceState(null, '', `${location.pathname}${location.search}`);
    } else if (screenName.startsWith('accept-')) {
      history.replaceState(null, '', `${location.pathname}${location.search}#i=${IV}&c=${CODE}`);
    }
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
    await OPEN[screenName]?.();
    win.__CPS_READY = true;
  } catch (err) {
    win.__CPS_ERROR = err instanceof Error ? err.message : String(err);
  }
}
