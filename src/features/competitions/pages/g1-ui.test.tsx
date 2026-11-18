import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import type { ComponentType } from 'preact';
import { LocationProvider } from 'preact-iso';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCurrentLocale } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';
import type { CpActions } from '../actions';
import { CpCallError } from '../data/cp-callables';
import type { MatchDoc, StandingDoc, StandingRow, SummaryEntry } from '../data/types';
import { CpEnvProvider, type CpInjectedEnv } from '../env';
import { taipeiMs } from '../format';
import { loadCompetitionsDict } from '../i18n';
import { createFakeCpRepo } from '../testing/fake-cp-repo';
import {
  adminActor,
  coHostActor,
  competition,
  hostActor,
  idleActions,
  memberActor,
  screenEnv,
} from '../testing/screen-fixtures';
import { InAppCardList } from '../components/InAppCardList';
import { assembleInAppCards } from '../data/list-cards';
import { makeCompetitionsT } from '../i18n';
import CompetitionDetailPage from './CompetitionDetailPage';
import HostMatchesPage from './HostMatchesPage';

beforeAll(async () => {
  await loadCompetitionsDict('zh-TW');
  await loadCompetitionsDict(getCurrentLocale());
});

let toastShow: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  toastShow = vi.spyOn(toast, 'show').mockImplementation(() => 1);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function draw(env: CpInjectedEnv, Page: ComponentType) {
  return render(
    <LocationProvider>
      <CpEnvProvider value={env}>
        <Page />
      </CpEnvProvider>
    </LocationProvider>,
  );
}

function areaOf(label: RegExp): HTMLTextAreaElement {
  const node = screen.getByLabelText(label);
  if (!(node instanceof HTMLTextAreaElement)) throw new Error('找不到文字區');
  return node;
}

function rowOf(name: string): HTMLElement {
  const row = screen.getByText(name).closest('li');
  if (!(row instanceof HTMLElement)) throw new Error(`找不到 ${name}`);
  return row;
}

function tieButton(name: string): HTMLElement {
  const row = screen.getByText(name).closest('.cp3-st__r');
  if (!(row instanceof HTMLElement)) throw new Error(`找不到 ${name}`);
  return within(row).getByRole('button', { name: '同分' });
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
    venueName: '1號場',
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

function hostEnv(matches: MatchDoc[], actions: CpActions = idleActions(), actor = hostActor): CpInjectedEnv {
  const staff = actor.uid === 'uid_co'
    ? { uid: 'uid_co', roles: ['coHost' as const] }
    : actor.uid === 'uid_host'
      ? { uid: 'uid_host', roles: ['host' as const] }
      : null;
  return {
    actor,
    repo: createFakeCpRepo(),
    actions,
    now: taipeiMs(2027, 1, 9, 12, 0),
    route: { cid: 'cup' },
    bundle: {
      competition: competition(),
      divisions: [],
      entries: [],
      roster: [],
      privates: [],
      staff,
    },
    matches,
  };
}

function standingRow(partial: Partial<StandingRow> & Pick<StandingRow, 'teamId' | 'name' | 'points' | 'rank'>): StandingRow {
  return {
    played: 4,
    win: 1,
    draw: 1,
    loss: 2,
    goalsFor: 3,
    goalsAgainst: 3,
    goalDiff: 0,
    hasUnresolvedTie: false,
    tiedWith: [],
    decidedBy: null,
    ...partial,
  };
}

function standing(partial: Partial<StandingDoc> = {}): StandingDoc {
  return {
    id: 'dv_adult__group__A',
    divisionId: 'dv_adult',
    groupId: 'A',
    rows: [],
    version: 4,
    hasUnresolvedTie: true,
    manualOverride: null,
    ranking: 'h2hFirst',
    updatedAt: null,
    ...partial,
  };
}

function summary(partial: Partial<SummaryEntry> & Pick<SummaryEntry, 'id'>): SummaryEntry {
  return {
    dv: 'dv_adult',
    r: 1,
    no: 1,
    k: taipeiMs(2027, 1, 9, 9, 0),
    v: '1號場',
    h: { id: 'en_b', n: '銀河隊' },
    a: { id: 'en_c', n: '雷霆隊' },
    s: [1, 1],
    st: 'confirmed',
    wo: null,
    ...partial,
  };
}

const TIE_ROWS = [
  standingRow({ teamId: 'en_b', name: '銀河隊', points: 5, rank: 3, hasUnresolvedTie: true, tiedWith: ['en_c'] }),
  standingRow({ teamId: 'en_c', name: '雷霆隊', points: 5, rank: 4, hasUnresolvedTie: true, tiedWith: ['en_b'] }),
  standingRow({ teamId: 'en_d', name: '青鳥隊', points: 4, rank: 5 }),
  standingRow({ teamId: 'en_e', name: '赤焰隊', points: 4, rank: 6 }),
];

function detailEnv(input: {
  actor?: CpInjectedEnv['actor'];
  staff?: { uid: string; roles: Array<'host' | 'coHost'> } | null;
  actions?: CpActions;
  competitionPatch?: Parameters<typeof competition>[0];
  standings?: StandingDoc[];
  summary?: SummaryEntry[];
  now?: number;
}): CpInjectedEnv {
  const base = screenEnv('detail-rep', input.actions ?? idleActions());
  const bundle = base.bundle;
  if (!bundle?.competition) throw new Error('缺詳情');
  return {
    ...base,
    actor: input.actor ?? base.actor,
    now: input.now ?? taipeiMs(2027, 1, 11, 12, 0),
    bundle: {
      ...bundle,
      staff: input.staff === undefined ? bundle.staff : input.staff,
      competition: competition({ ...bundle.competition, ...input.competitionPatch }),
    },
    schedule: {
      summary: input.summary ?? [],
      standings: input.standings ?? [standing({ rows: TIE_ROWS })],
    },
  };
}

describe('取消單場與結束賽事', () => {
  it('取消送出原因與版次；字數不足用欄位文案；取消後只剩重置', async () => {
    const cancelMatch = vi.fn(async () => ({}));
    const view = draw(hostEnv(
      [match({ id: 'mt_1', status: 'scheduled', home: { teamId: 'en_h', name: '晨星隊' }, away: { teamId: 'en_a', name: '飛燕隊' } })],
      { ...idleActions(), cancelMatch },
    ), HostMatchesPage);
    fireEvent.click(within(rowOf('晨星隊')).getByRole('button', { name: '取消這場' }));
    expect(screen.getByText('取消的場次不計分，之後可用重置恢復')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '確認取消' }));
    expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({ message: '還有必填項目沒填' }));
    expect(cancelMatch).not.toHaveBeenCalled();
    fireEvent.input(areaOf(/取消原因/), { target: { value: '雨' } });
    fireEvent.click(screen.getByRole('button', { name: '確認取消' }));
    expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({ message: '字數須介於 2 與 100 之間' }));
    fireEvent.input(areaOf(/取消原因/), { target: { value: '大雨，場地無法使用' } });
    fireEvent.click(screen.getByRole('button', { name: '確認取消' }));
    expect(cancelMatch).toHaveBeenCalledWith({
      cid: 'cup', mtId: 'mt_1', expectedRev: 3, reason: '大雨，場地無法使用',
    });
    // 本地列更新在 await cancelMatch 之後，click 返回時還沒畫上。
    await waitFor(() => {
      const row = rowOf('晨星隊');
      expect(row.textContent ?? '').toContain('已取消');
      expect(row.textContent ?? '').toContain('原因');
      expect(row.textContent ?? '').toContain('大雨，場地無法使用');
      expect(within(row).queryAllByRole('button').map((node) => node.textContent)).toEqual(['重置']);
    });
    expect(view.container.querySelector('.cpm-reason')).toBeTruthy();
  });

  it('結束賽事列出未確認場數，原因必填，送出只有賽事 id 與原因', async () => {
    const endCompetition = vi.fn(async () => ({}));
    draw(hostEnv([
      match({ id: 'mt_1', status: 'scheduled' }),
      match({ id: 'mt_2', status: 'finished', score: { home: 1, away: 0 }, matchNo: 2 }),
      match({ id: 'mt_3', status: 'confirmed', score: { home: 2, away: 1 }, matchNo: 3 }),
      match({ id: 'mt_4', status: 'cancelled', matchNo: 4 }),
    ], { ...idleActions(), endCompetition }), HostMatchesPage);
    fireEvent.click(screen.getByRole('button', { name: '結束賽事' }));
    expect(screen.getByText('結束後不能再改比分；還沒確認的場次不計分')).toBeTruthy();
    expect(screen.getByText('未確認 2 場')).toBeTruthy();
    const dialog = screen.getByRole('dialog', { name: '結束賽事' });
    fireEvent.click(within(dialog).getByRole('button', { name: '確認結束' }));
    expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({ message: '還有必填項目沒填' }));
    fireEvent.input(areaOf(/結束原因/), { target: { value: '剩餘場次不再進行' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '確認結束' }));
    expect(endCompetition).toHaveBeenCalledWith({ cid: 'cup', reason: '剩餘場次不再進行' });
    await waitFor(() => expect(screen.queryByRole('button', { name: '結束賽事' })).toBeNull());
  });

  it('沒有場次、延期或草稿不顯示結束賽事', () => {
    draw(hostEnv([]), HostMatchesPage);
    expect(screen.queryByRole('button', { name: '結束賽事' })).toBeNull();
    cleanup();

    const postponed = hostEnv([match({ id: 'mt_1', status: 'scheduled' })]);
    if (postponed.bundle) {
      postponed.bundle = {
        ...postponed.bundle,
        competition: competition({ status: 'postponed' }),
      };
    }
    draw(postponed, HostMatchesPage);
    expect(screen.queryByRole('button', { name: '結束賽事' })).toBeNull();
    cleanup();

    const draft = hostEnv([match({ id: 'mt_1', status: 'scheduled' })]);
    if (draft.bundle) {
      draft.bundle = {
        ...draft.bundle,
        competition: competition({ status: 'draft' }),
      };
    }
    draw(draft, HostMatchesPage);
    expect(screen.queryByRole('button', { name: '結束賽事' })).toBeNull();
  });

  it('會員看不到取消；共同主辦與管理員看得到', () => {
    const rows = [match({ id: 'mt_1', status: 'scheduled' })];
    draw(hostEnv(rows, idleActions(), memberActor), HostMatchesPage);
    expect(screen.getByRole('alert').textContent).toContain('只有主辦可以做這個操作');
    expect(screen.queryByRole('button', { name: '取消這場' })).toBeNull();
    cleanup();
    draw(hostEnv(rows, idleActions(), coHostActor), HostMatchesPage);
    expect(screen.getByRole('button', { name: '取消這場' })).toBeTruthy();
    cleanup();
    draw(hostEnv(rows, idleActions(), adminActor), HostMatchesPage);
    expect(screen.getByRole('button', { name: '取消這場' })).toBeTruthy();
  });
});

describe('同分查詢、裁定與恢復', () => {
  const explained = {
    dvId: 'dv_adult',
    groupId: 'A',
    naturalOrder: ['en_b', 'en_c'],
    steps: [
      {
        criterion: 'points',
        teamIds: ['en_b', 'en_c'],
        values: [{ teamId: 'en_b', value: 5 }, { teamId: 'en_c', value: 5 }],
        split: false,
      },
      {
        criterion: 'goalDiff',
        teamIds: ['en_b', 'en_c'],
        values: [{ teamId: 'en_b', value: 2 }, { teamId: 'en_c', value: -1 }],
        split: true,
      },
      {
        criterion: 'goalsFor',
        teamIds: ['en_b', 'en_c'],
        values: [{ teamId: 'en_b', value: 8 }, { teamId: 'en_c', value: 5 }],
        split: false,
      },
    ],
    pending: false,
    matchIds: ['mt_rel'],
  };

  it('非主辦沒有同分入口；主辦連已分出名次的同分也能點，並送出查詢欄位', async () => {
    draw(detailEnv({}), CompetitionDetailPage);
    expect(screen.queryByRole('button', { name: '同分' })).toBeNull();
    expect(screen.getAllByText('同分').length).toBeGreaterThan(0);
    cleanup();

    const explainTie = vi.fn(async () => explained);
    draw(detailEnv({
      actor: hostActor,
      staff: { uid: 'uid_host', roles: ['host'] },
      actions: { ...idleActions(), explainTie },
      summary: [summary({ id: 'mt_rel' })],
    }), CompetitionDetailPage);
    const buttons = screen.getAllByRole('button', { name: '同分' });
    expect(buttons.length).toBe(4);
    fireEvent.click(buttons[0]!);
    expect(explainTie).toHaveBeenCalledWith({
      cid: 'cup', dvId: 'dv_adult', groupId: 'A', teamIds: ['en_b', 'en_c'],
    });
    expect(await screen.findByText('在這一項分出高下')).toBeTruthy();
    expect(screen.getByText('全組淨勝')).toBeTruthy();
    expect(screen.getByText('+2')).toBeTruthy();
    expect(screen.getByText('相關場次')).toBeTruthy();
    expect(screen.getByText('銀河隊 1：1 雷霆隊')).toBeTruthy();
  });

  it('裁定送出名次、方式、原因與版本；已有裁定時改走撤銷', async () => {
    const resolveTie = vi.fn(async () => {
      throw new CpCallError('TIE_DECISION_EXISTS', {});
    });
    const clearTieDecision = vi.fn(async () => ({}));
    const explainTie = vi.fn(async () => ({ ...explained, pending: true, steps: explained.steps.map((step) => ({ ...step, split: false })) }));
    draw(detailEnv({
      actor: hostActor,
      staff: { uid: 'uid_host', roles: ['host'] },
      actions: { ...idleActions(), explainTie, resolveTie, clearTieDecision },
    }), CompetitionDetailPage);
    fireEvent.click(screen.getAllByRole('button', { name: '同分' })[0]!);
    expect(await screen.findByText('全部相同，待主辦裁定')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '上移 雷霆隊' }));
    fireEvent.input(areaOf(/裁定原因/), { target: { value: '依報名先後' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    expect(resolveTie).toHaveBeenCalledWith({
      cid: 'cup',
      dvId: 'dv_adult',
      groupId: 'A',
      order: ['en_c', 'en_b'],
      method: 'host',
      reason: '依報名先後',
      expectedVersion: 4,
    });
    expect((await screen.findAllByText('已有裁定，請先撤銷原本的裁定')).length).toBeGreaterThan(0);
    fireEvent.input(areaOf(/撤銷原因/), { target: { value: '登錯' } });
    fireEvent.click(screen.getByRole('button', { name: '撤銷裁定' }));
    expect(clearTieDecision).toHaveBeenCalledWith({
      cid: 'cup', dvId: 'dv_adult', groupId: 'A', reason: '登錯', expectedVersion: 4,
    });
  });

  it('換查另一群時裁定方式回到主辦裁定', async () => {
    const explainTie = vi.fn(async () => ({
      ...explained,
      pending: true,
      steps: explained.steps.map((step) => ({ ...step, split: false })),
    }));
    const other = standing({
      id: 'dv_youth__group__B',
      divisionId: 'dv_youth',
      groupId: 'B',
      rows: [
        standingRow({ teamId: 'en_f', name: '北風隊', points: 3, rank: 1, hasUnresolvedTie: true, tiedWith: ['en_g'] }),
        standingRow({ teamId: 'en_g', name: '南風隊', points: 3, rank: 2, hasUnresolvedTie: true, tiedWith: ['en_f'] }),
      ],
    });
    draw(detailEnv({
      actor: hostActor,
      staff: { uid: 'uid_host', roles: ['host'] },
      actions: { ...idleActions(), explainTie },
      standings: [standing({ rows: TIE_ROWS }), other],
    }), CompetitionDetailPage);
    fireEvent.click(tieButton('銀河隊'));
    const lots = await screen.findByRole('radio', { name: '抽籤結果登錄' });
    fireEvent.click(lots);
    expect((screen.getByRole('radio', { name: '抽籤結果登錄' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(tieButton('北風隊'));
    expect((screen.getByRole('radio', { name: '主辦裁定' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('radio', { name: '抽籤結果登錄' }) as HTMLInputElement).checked).toBe(false);
    expect(explainTie).toHaveBeenLastCalledWith({
      cid: 'cup', dvId: 'dv_youth', groupId: 'B', teamIds: ['en_f', 'en_g'],
    });
  });

  it('主辦裁定小標可點，顯示方式、原因、時間；觀眾不能撤銷', () => {
    const ruled = standing({
      ranking: 'h2hFirst',
      hasUnresolvedTie: true,
      manualOverride: { method: 'drawLots', reason: '公開抽籤', at: taipeiMs(2027, 1, 10, 15, 0) },
      rows: [
        standingRow({ teamId: 'en_b', name: '青鳥隊', points: 4, rank: 2, decidedBy: 'drawLots', hasUnresolvedTie: true, tiedWith: ['en_c'] }),
        standingRow({ teamId: 'en_c', name: '赤焰隊', points: 4, rank: 3, decidedBy: 'drawLots', hasUnresolvedTie: true, tiedWith: ['en_b'] }),
      ],
    });
    draw(detailEnv({ standings: [ruled] }), CompetitionDetailPage);
    expect(screen.queryByText('同分')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: '主辦裁定' })[0]!);
    expect(screen.getByText('抽籤結果登錄')).toBeTruthy();
    expect(screen.getByText('公開抽籤')).toBeTruthy();
    expect(screen.getByText('2027/01/10 15:00')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '撤銷裁定' })).toBeNull();
  });

  it('排序說明跟 ranking 走，並含主辦裁定那一行', () => {
    draw(detailEnv({
      standings: [standing({ ranking: 'goalDiffFirst', rows: TIE_ROWS, hasUnresolvedTie: false })],
    }), CompetitionDetailPage);
    const rules = screen.getByRole('list');
    expect(rules.textContent ?? '').toContain('先比積分，高者在前');
    expect(rules.textContent ?? '').toContain('積分相同，比全組淨勝');
    expect(rules.textContent ?? '').toContain('再比直接對戰積分');
    expect(rules.textContent ?? '').toContain('同分且條件用盡時由主辦裁定');
    expect(rules.textContent ?? '').not.toContain('再比直接對戰淨勝');
  });

  it('恢復只給管理員，原因必填，確認結束不顯示', () => {
    const restoreCompetition = vi.fn(async () => ({}));
    const ended = { endedAt: taipeiMs(2027, 1, 10, 18, 0), endedBy: 'host' as const, endReason: '剩餘場次不再進行' };
    draw(detailEnv({
      actor: hostActor,
      staff: { uid: 'uid_host', roles: ['host'] },
      competitionPatch: ended,
    }), CompetitionDetailPage);
    expect(screen.getByText('主辦已於 2027/01/10 結束賽事')).toBeTruthy();
    expect(screen.getByText('剩餘場次不再進行')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '恢復賽事' })).toBeNull();
    cleanup();

    draw(detailEnv({
      actor: adminActor,
      staff: null,
      actions: { ...idleActions(), restoreCompetition },
      competitionPatch: { endedAt: taipeiMs(2027, 1, 10, 18, 0), endedBy: 'confirm' },
    }), CompetitionDetailPage);
    expect(screen.queryByRole('button', { name: '恢復賽事' })).toBeNull();
    cleanup();

    draw(detailEnv({
      actor: adminActor,
      staff: null,
      actions: { ...idleActions(), restoreCompetition },
      competitionPatch: ended,
    }), CompetitionDetailPage);
    fireEvent.click(screen.getByRole('button', { name: '恢復賽事' }));
    fireEvent.click(screen.getAllByRole('button', { name: '恢復賽事' })[1]!);
    expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({ message: '還有必填項目沒填' }));
    fireEvent.input(areaOf(/恢復原因/), { target: { value: '誤按結束' } });
    fireEvent.click(screen.getAllByRole('button', { name: '恢復賽事' })[1]!);
    expect(restoreCompetition).toHaveBeenCalledWith({ cid: 'cup', reason: '誤按結束' });
  });
});

describe('整場延期與取消', () => {
  it('詳情頂部寫原因，賽程改成待定或已取消', () => {
    const rows = [summary({ id: 'mt_1', h: { id: 'en_h', n: '海風隊' }, a: { id: 'en_a', n: '山貓隊' }, st: 'scheduled', k: taipeiMs(2027, 1, 9, 9, 0) })];
    draw(detailEnv({
      now: taipeiMs(2027, 1, 9, 12, 0),
      competitionPatch: { status: 'postponed', statusReason: '場地整修，日期另行通知' },
      summary: rows,
      standings: [],
    }), CompetitionDetailPage);
    expect(screen.getAllByText('已延期').length).toBeGreaterThan(0);
    expect(screen.getByText('場地整修，日期另行通知')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '賽程' }));
    expect(screen.getAllByText('待定').length).toBeGreaterThan(0);
    expect(screen.queryByText('09:00')).toBeNull();
    cleanup();

    draw(detailEnv({
      competitionPatch: { status: 'cancelled', statusReason: '報名隊伍不足' },
      summary: rows,
      standings: [],
      now: taipeiMs(2027, 1, 11, 12, 0),
    }), CompetitionDetailPage);
    expect(screen.getByText('報名隊伍不足')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '賽程' }));
    expect(screen.getAllByText('已取消').length).toBeGreaterThan(0);
    expect(screen.queryByText('09:00')).toBeNull();
  });

  it('列表膠囊改成已延期、已取消', async () => {
    const ct = makeCompetitionsT(await loadCompetitionsDict('zh-TW'));
    const cards = assembleInAppCards({
      publicDocs: [
        competition({ id: 'p', name: '延期盃', status: 'postponed' }),
        competition({ id: 'c', name: '取消盃', status: 'cancelled' }),
      ],
      hosted: [],
      mine: [],
      now: taipeiMs(2027, 1, 9, 12, 0),
    });
    render(
      <InAppCardList
        cards={cards}
        ct={ct}
        status="all"
        onlyMine={false}
        showCreate={false}
        onStatus={() => undefined}
        onOnlyMine={() => undefined}
        onCreate={() => undefined}
        onOpen={() => undefined}
      />,
    );
    expect(document.querySelector('.cpl-st--postponed')?.textContent).toContain('已延期');
    expect(document.querySelector('.cpl-st--cancelled')?.textContent).toContain('已取消');
  });
});
