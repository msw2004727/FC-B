// 賽事 A 組 commit 2：顯示條件對齊後端（按了一定失敗的鈕收起來）。
// 每一段都是「對齊前看得到、後端一定拒絕 → 對齊後看不到」，並留一個仍該看得到的對照。
import { cleanup, render, screen, waitFor } from '@testing-library/preact';
import type { ComponentType } from 'preact';
import { LocationProvider } from 'preact-iso';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { getCurrentLocale } from '@/i18n/i18n';
import { AppConfirmHost, _resetAppConfirmForTest } from '@/ui/AppConfirm';
import { canRegisterClubEntry, ENDED_GRACE_MS, hostEditsOpen } from '../access';
import { canDeleteCompetition } from '../delete-access';
import { scoreEntryOpen } from '../data/host-write';
import type { CompetitionDoc, MatchDoc, StaffDoc } from '../data/types';
import { CpEnvProvider, type CpActor, type CpBundle, type CpInjectedEnv } from '../env';
import { taipeiMs } from '../format';
import { loadCompetitionsDict } from '../i18n';
import { createFakeCpRepo } from '../testing/fake-cp-repo';
import {
  adminActor,
  adultDivision,
  competition,
  hostActor,
  idleActions,
  manageBundle,
  memberActor,
  NOW,
  repActor,
  screenEnv,
} from '../testing/screen-fixtures';
import AddRosterPage from './AddRosterPage';
import CompetitionDetailPage from './CompetitionDetailPage';
import CompetitionManagePage from './CompetitionManagePage';
import HostMatchesPage from './HostMatchesPage';
import HostSchedulePage from './HostSchedulePage';
import ScorerMatchesPage from './ScorerMatchesPage';
import StaffPage from './StaffPage';

beforeAll(async () => {
  await loadCompetitionsDict('zh-TW');
  await loadCompetitionsDict(getCurrentLocale());
});

afterEach(() => {
  cleanup();
  _resetAppConfirmForTest();
});

const HOST_STAFF: StaffDoc = { uid: 'uid_host', roles: ['host'] };
const LIVE_NOW = taipeiMs(2027, 1, 9, 12, 0);

function draw(env: CpInjectedEnv, Page: ComponentType) {
  return render(
    <LocationProvider>
      <CpEnvProvider value={env}>
        <Page />
        <AppConfirmHost />
      </CpEnvProvider>
    </LocationProvider>,
  );
}

function hasButton(name: string): boolean {
  return screen.queryAllByRole('button', { name }).length > 0;
}

function match(partial: Partial<MatchDoc> & Pick<MatchDoc, 'id' | 'status'>): MatchDoc {
  return {
    divisionId: 'dv_adult',
    stageId: 'group',
    groupId: 'A',
    round: 1,
    matchNo: 1,
    label: null,
    matchKey: null,
    kickoffAt: taipeiMs(2027, 1, 9, 9, 0),
    venueIdx: 0,
    venueName: '示範球場',
    home: { teamId: 'en_h', name: '海風隊' },
    away: { teamId: 'en_a', name: '山貓隊' },
    teamIds: ['en_h', 'en_a'],
    score: { home: 0, away: 0 },
    penaltyScore: null,
    rev: 3,
    resetRev: 0,
    lock: { locked: false },
    clockBase: { startedAt: null, pausedSec: 0, running: false, period: 'pre' },
    finishedAt: null,
    confirmedAt: null,
    walkoverSide: null,
    result: null,
    resultSource: null,
    updatedAt: null,
    cancelReason: null,
    cancelledAt: null,
    ...partial,
  };
}

function matchesEnv(actor: CpActor, staff: StaffDoc | null, matches: readonly MatchDoc[], comp: Partial<CompetitionDoc> = {}, now = LIVE_NOW): CpInjectedEnv {
  const bundle: CpBundle = {
    competition: competition(comp),
    divisions: [adultDivision],
    entries: [],
    roster: [],
    privates: [],
    staff,
  };
  return { actor, repo: createFakeCpRepo(), actions: idleActions(), now, route: { cid: 'cup' }, bundle, matches };
}

const ROWS = [
  match({ id: 'mt_fin', status: 'finished', finishedAt: LIVE_NOW - 3_600_000 }),
  match({ id: 'mt_sch', status: 'scheduled', kickoffAt: taipeiMs(2027, 1, 9, 8, 0), home: { teamId: 'en_x', name: '雷霆隊' }, away: { teamId: 'en_y', name: '飛鷹隊' } }),
];

describe('hostEditsOpen 對齊後端 assertNotEnded', () => {
  it('沒結束、管理員、末場確認 3 天內可以；主辦或自動結束、寬限過了不行', () => {
    const ended = 1_000_000;
    expect(hostEditsOpen({ endedAt: null, endedBy: null }, false, ended)).toBe(true);
    expect(hostEditsOpen({ endedAt: ended, endedBy: 'host' }, false, ended + 1)).toBe(false);
    expect(hostEditsOpen({ endedAt: ended, endedBy: 'auto' }, false, ended + 1)).toBe(false);
    expect(hostEditsOpen({ endedAt: ended, endedBy: 'host' }, true, ended + 1)).toBe(true);
    expect(hostEditsOpen({ endedAt: ended, endedBy: 'confirm' }, false, ended + ENDED_GRACE_MS - 1)).toBe(true);
    expect(hostEditsOpen({ endedAt: ended, endedBy: 'confirm' }, false, ended + ENDED_GRACE_MS)).toBe(false);
    expect(ENDED_GRACE_MS).toBe(3 * 86_400_000);
  });
});

describe('#4 賽程管理：結束後的場次按鈕與順延／對調', () => {
  it('主辦手動結束：確認、登錄比分、改期、取消、順延、對調、記分都收起', () => {
    draw(matchesEnv(hostActor, HOST_STAFF, ROWS, { endedAt: LIVE_NOW - 1000, endedBy: 'host' }), HostMatchesPage);
    for (const name of ['確認', '登錄比分', '改期', '取消這場', '整天順延', '兩場對調', '記分', '登錄棄權']) {
      expect(hasButton(name), name).toBe(false);
    }
  });

  it('末場確認結束 3 天內：主辦仍看得到場次按鈕與順延／對調（後端寬限），記分不給', () => {
    draw(matchesEnv(hostActor, HOST_STAFF, ROWS, { endedAt: LIVE_NOW - 1000, endedBy: 'confirm' }), HostMatchesPage);
    expect(hasButton('確認')).toBe(true);
    expect(hasButton('整天順延')).toBe(true);
    expect(hasButton('記分')).toBe(false);
  });

  it('末場確認超過 3 天：收起', () => {
    draw(matchesEnv(hostActor, HOST_STAFF, ROWS, { endedAt: LIVE_NOW - ENDED_GRACE_MS - 1, endedBy: 'confirm' }), HostMatchesPage);
    expect(hasButton('確認')).toBe(false);
    expect(hasButton('整天順延')).toBe(false);
  });

  it('管理員在已結束時照舊看得到', () => {
    draw(matchesEnv(adminActor, null, ROWS, { endedAt: LIVE_NOW - 1000, endedBy: 'host' }), HostMatchesPage);
    expect(hasButton('確認')).toBe(true);
    expect(hasButton('整天順延')).toBe(true);
  });
});

describe('#8 開賽前不給登錄比分，判棄權保留', () => {
  it('scoreEntryOpen：已結束一定可以；排定要有時間而且已過開賽', () => {
    expect(scoreEntryOpen({ status: 'finished', kickoffAt: null }, 0)).toBe(true);
    expect(scoreEntryOpen({ status: 'scheduled', kickoffAt: 100 }, 99)).toBe(false);
    expect(scoreEntryOpen({ status: 'scheduled', kickoffAt: 100 }, 100)).toBe(true);
    expect(scoreEntryOpen({ status: 'scheduled', kickoffAt: null }, 100)).toBe(false);
  });

  it('開賽前的場次只有「登錄棄權」，開賽後才有「登錄比分」', () => {
    const early = match({ id: 'mt_early', status: 'scheduled', kickoffAt: LIVE_NOW + 3_600_000 });
    const view = draw(matchesEnv(hostActor, HOST_STAFF, [early]), HostMatchesPage);
    expect(hasButton('登錄比分')).toBe(false);
    expect(hasButton('登錄棄權')).toBe(true);
    view.unmount();
    const started = match({ id: 'mt_on', status: 'scheduled', kickoffAt: LIVE_NOW - 60_000 });
    draw(matchesEnv(hostActor, HOST_STAFF, [started]), HostMatchesPage);
    expect(hasButton('登錄比分')).toBe(true);
    expect(hasButton('登錄棄權')).toBe(false);
  });
});

describe('#14 下架：主辦操作收起，管理員保留', () => {
  it('賽程管理：主辦看不到場次按鈕、順延與結束；管理員看得到', () => {
    const view = draw(matchesEnv(hostActor, HOST_STAFF, ROWS, { hidden: true }), HostMatchesPage);
    for (const name of ['確認', '整天順延', '結束賽事', '記分']) expect(hasButton(name), name).toBe(false);
    view.unmount();
    draw(matchesEnv(adminActor, null, ROWS, { hidden: true }), HostMatchesPage);
    expect(hasButton('確認')).toBe(true);
    expect(hasButton('結束賽事')).toBe(true);
  });

  it('報隊管理：下架時沒有核准／拒絕（連管理員）、主辦沒有鎖定', () => {
    const base = manageBundle(HOST_STAFF);
    const hidden = { ...base, competition: { ...base.competition!, hidden: true } };
    // 待審分頁：沒下架有核准／拒絕（對照），下架後主辦與管理員都沒有
    const open = draw({ ...screenEnv('host-pending'), actor: hostActor, bundle: base }, CompetitionManagePage);
    expect(hasButton('核准')).toBe(true);
    open.unmount();
    for (const who of [hostActor, adminActor]) {
      const view = draw({ ...screenEnv('host-pending'), actor: who, bundle: hidden }, CompetitionManagePage);
      expect(hasButton('核准'), who.uid ?? '').toBe(false);
      expect(hasButton('拒絕'), who.uid ?? '').toBe(false);
      view.unmount();
    }
    const view = draw({ ...screenEnv('host-approved'), actor: hostActor, bundle: hidden }, CompetitionManagePage);
    expect(hasButton('鎖定全部名單')).toBe(false);
    view.unmount();
    draw({ ...screenEnv('host-approved'), actor: adminActor, bundle: hidden }, CompetitionManagePage);
    expect(hasButton('鎖定全部名單')).toBe(true);
  });
});

describe('#14 下架：排賽程、標示繳費、發布', () => {
  it('排賽程頁：主辦看到「不公開」，管理員照舊有表單', () => {
    const base = manageBundle(HOST_STAFF);
    const hidden = { ...base, competition: { ...base.competition!, hidden: true } };
    const view = draw({ ...screenEnv('host-approved'), actor: hostActor, bundle: hidden }, HostSchedulePage);
    expect(screen.getByText('這場賽事目前不公開')).toBeTruthy();
    view.unmount();
    draw({ ...screenEnv('host-approved'), actor: adminActor, bundle: hidden }, HostSchedulePage);
    expect(screen.queryByText('這場賽事目前不公開')).toBeNull();
  });

  it('標示已繳費：下架時主辦沒有，管理員有', () => {
    const base = manageBundle(HOST_STAFF);
    const hidden = { ...base, competition: { ...base.competition!, hidden: true } };
    const view = draw({ ...screenEnv('host-approved'), actor: hostActor, bundle: hidden }, CompetitionManagePage);
    expect(screen.queryAllByLabelText('標示已繳費')).toHaveLength(0);
    view.unmount();
    draw({ ...screenEnv('host-approved'), actor: adminActor, bundle: hidden }, CompetitionManagePage);
    expect(screen.queryAllByLabelText('標示已繳費').length).toBeGreaterThan(0);
  });

  it('詳情頁：草稿被下架時不給「發布」（後端 publish 連管理員都擋）', () => {
    const base = screenEnv('real-recruit');
    const env = (comp: Partial<CompetitionDoc>): CpInjectedEnv => ({
      ...base,
      actor: adminActor,
      now: NOW,
      bundle: { ...base.bundle!, competition: competition({ status: 'draft', ...comp }) },
    });
    const view = draw(env({}), CompetitionDetailPage);
    expect(hasButton('發布')).toBe(true);
    view.unmount();
    draw(env({ hidden: true }), CompetitionDetailPage);
    expect(hasButton('發布')).toBe(false);
  });
});

describe('#6 鎖定只在已發布', () => {
  it('草稿看不到「鎖定全部名單」，已發布看得到', () => {
    const base = manageBundle(HOST_STAFF);
    const draft = { ...base, competition: { ...base.competition!, status: 'draft' as const } };
    const view = draw({ ...screenEnv('host-approved'), actor: hostActor, bundle: draft }, CompetitionManagePage);
    expect(hasButton('鎖定全部名單')).toBe(false);
    view.unmount();
    draw({ ...screenEnv('host-approved'), actor: hostActor, bundle: base }, CompetitionManagePage);
    expect(hasButton('鎖定全部名單')).toBe(true);
  });
});

describe('#17 已結束不給改分類與聯絡文字', () => {
  it('已結束沒封面：沒有編輯入口；沒結束有', () => {
    const base = manageBundle(HOST_STAFF);
    const ended = { ...base, competition: { ...base.competition!, endedAt: NOW - 1000, endedBy: 'host' as const } };
    const view = draw({ ...screenEnv('host-approved'), actor: hostActor, bundle: ended }, CompetitionManagePage);
    expect(hasButton('編輯賽事資訊')).toBe(false);
    expect(screen.queryByLabelText(/聯絡文字/)).toBeNull();
    view.unmount();
    draw({ ...screenEnv('host-approved'), actor: hostActor, bundle: base }, CompetitionManagePage);
    expect(hasButton('編輯賽事資訊')).toBe(true);
  });
});

describe('#10 #13 以俱樂部報隊', () => {
  const window = { repClubIds: ['club_a'], status: 'published' as const, hidden: false, rostersLockedAt: null, endedAt: null, regOpenAt: 10, regCloseAt: 20, now: 15 };
  it('鎖名單、已結束不給；截止那一毫秒起不給（後端 now >= regCloseAt）', () => {
    expect(canRegisterClubEntry(window)).toBe(true);
    expect(canRegisterClubEntry({ ...window, rostersLockedAt: 12 })).toBe(false);
    expect(canRegisterClubEntry({ ...window, endedAt: 12 })).toBe(false);
    expect(canRegisterClubEntry({ ...window, now: 19 })).toBe(true);
    expect(canRegisterClubEntry({ ...window, now: 20 })).toBe(false);
  });

  it('詳情頁：名單已鎖定時代表看不到報隊鈕', () => {
    const base = screenEnv('real-recruit');
    const env = (comp: Partial<CompetitionDoc>): CpInjectedEnv => ({
      ...base,
      actor: repActor,
      now: NOW,
      bundle: { ...base.bundle!, competition: competition(comp) },
    });
    const view = draw(env({}), CompetitionDetailPage);
    expect(hasButton('以俱樂部報隊')).toBe(true);
    view.unmount();
    draw(env({ rostersLockedAt: NOW - 1000 }), CompetitionDetailPage);
    expect(hasButton('以俱樂部報隊')).toBe(false);
  });
});

describe('#5 已結束不給刪除', () => {
  it('首場前就結束的賽事：主辦看不到刪除；管理員照舊', () => {
    const input = {
      uid: 'uid_host', role: 'user', hostType: 'personal' as const, hostTeamId: null, staffRoles: ['host' as const],
      repClubIds: [], hidden: false, deletingAt: null, endedAt: null, firstMatchAt: 100, now: 50,
    };
    expect(canDeleteCompetition(input)).toBe(true);
    expect(canDeleteCompetition({ ...input, endedAt: 40 })).toBe(false);
    expect(canDeleteCompetition({ ...input, endedAt: 40, role: 'admin' })).toBe(true);
  });
});

describe('#11 人員頁：結束後收起指派、邀請、移除、撤銷', () => {
  function staffRepo(comp: Partial<CompetitionDoc>) {
    return createFakeCpRepo({
      competitions: [competition({ id: 'cup', ...comp })],
      staff: { cup: [{ uid: 'uid_host', roles: ['host'] }] },
      assignments: {
        cup: [
          { uid: 'uid_host', roles: ['host'], matchIds: [], expiresAt: null, memberNo: 1 },
          { uid: 'uid_sc', roles: ['scorer'], matchIds: [], expiresAt: null, memberNo: 2 },
        ],
      },
      invites: { cup: [{ id: 'iv_' + 'a'.repeat(20), status: 'open', roles: ['scorer'], matchIds: [], expiresAt: null }] as never },
    });
  }
  it('主辦手動結束：沒有指派、邀請、垃圾桶、撤銷；沒結束都有', async () => {
    const view = draw({ actor: hostActor, repo: staffRepo({ endedAt: NOW - 1000, endedBy: 'host' }), actions: idleActions(), now: NOW, route: { cid: 'cup' } }, StaffPage);
    expect(await screen.findByText('我自己')).toBeTruthy();
    await waitFor(() => expect(hasButton('指派記分員')).toBe(false));
    expect(hasButton('邀請記分員')).toBe(false);
    expect(hasButton('撤銷')).toBe(false);
    expect(document.querySelectorAll('.s4b-mini .cps-iconbtn')).toHaveLength(0);
    view.unmount();
    draw({ actor: hostActor, repo: staffRepo({}), actions: idleActions(), now: NOW, route: { cid: 'cup' } }, StaffPage);
    expect(await screen.findByText('我自己')).toBeTruthy();
    expect(hasButton('指派記分員')).toBe(true);
    expect(hasButton('邀請記分員')).toBe(true);
    expect(document.querySelectorAll('.s4b-mini .cps-iconbtn').length).toBeGreaterThan(0);
  });

  it('末場確認 3 天內：指派仍可，邀請不行（後端 createInvite 擋任何已結束）', async () => {
    draw({ actor: hostActor, repo: staffRepo({ endedAt: NOW - 1000, endedBy: 'confirm' }), actions: idleActions(), now: NOW, route: { cid: 'cup' } }, StaffPage);
    expect(await screen.findByText('我自己')).toBeTruthy();
    await waitFor(() => expect(hasButton('邀請記分員')).toBe(false));
    expect(hasButton('指派記分員')).toBe(true);
  });
});

describe('S1 我的場次：賽事已結束不給進入記分', () => {
  function scorerRepo(comp: Partial<CompetitionDoc>) {
    return createFakeCpRepo({
      competitions: [competition({ id: 'cup', ...comp })],
      assignments: { cup: [{ uid: 'uid_member', roles: ['scorer'], matchIds: ['mt_live'], expiresAt: null }] },
      matches: { cup: [match({ id: 'mt_live', status: 'live', kickoffAt: taipeiMs(2027, 1, 9, 9, 0) })] },
    });
  }
  it('已結束沒有「進入記分」；沒結束有', async () => {
    const view = draw({ actor: memberActor, repo: scorerRepo({ endedAt: LIVE_NOW - 1000, endedBy: 'host' }), actions: idleActions(), now: LIVE_NOW, route: { cid: 'cup' } }, ScorerMatchesPage);
    expect(await screen.findByRole('heading', { name: '我的場次' })).toBeTruthy();
    expect(await screen.findByText('海風隊')).toBeTruthy();
    expect(hasButton('進入記分')).toBe(false);
    view.unmount();
    draw({ actor: memberActor, repo: scorerRepo({}), actions: idleActions(), now: LIVE_NOW, route: { cid: 'cup' } }, ScorerMatchesPage);
    expect(await screen.findByRole('button', { name: '進入記分' })).toBeTruthy();
  });
});

describe('#21 代填頁等代表清單讀完', () => {
  it('代表清單還在讀：轉圈，不先說「只有俱樂部代表可以做這個操作」', () => {
    const env = screenEnv('form-rep');
    draw({ ...env, actor: { ...env.actor, repClubs: [], repClubsPending: true } }, AddRosterPage);
    expect(screen.queryByText('只有俱樂部代表可以做這個操作')).toBeNull();
    expect(document.querySelector('.cps-root')).toBeTruthy();
  });
});
