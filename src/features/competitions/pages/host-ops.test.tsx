import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { openPmDialog } from '@/features/inbox/components/pm-dialog-store';
import { emit } from '@/core/events';
import type { ComponentChildren, ComponentType } from 'preact';
import { LocationProvider } from 'preact-iso';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCurrentLocale } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';
import type { CpActions } from '../actions';
import { CpCallError, type CpGenerateScheduleInput, type CpGenerateScheduleResult } from '../data/cp-callables';
import type { CompetitionNotice, MatchDoc, MatchStatus, StaffDoc } from '../data/types';
import { CpEnvProvider, type CpActor, type CpBundle, type CpInjectedEnv } from '../env';
import { taipeiMs } from '../format';
import { loadCompetitionsDict } from '../i18n';
import { createFakeCpRepo, type FakeCpRepo } from '../testing/fake-cp-repo';
import {
  adultDivision,
  adminActor,
  clubRepActor,
  coHostActor,
  competition,
  hostActor,
  idleActions,
  manageBundle,
  memberActor,
  screenEnv,
  youthDivision,
} from '../testing/screen-fixtures';
import CompetitionDetailPage from './CompetitionDetailPage';
import CompetitionManagePage from './CompetitionManagePage';
import HostMatchesPage from './HostMatchesPage';
import HostSchedulePage from './HostSchedulePage';
import NewCompetitionPage from './NewCompetitionPage';

vi.mock('@/features/inbox/components/pm-dialog-store', () => ({
  openPmDialog: vi.fn(),
}));

vi.mock('@/core/events', async () => {
  const actual = await vi.importActual<typeof import('@/core/events')>('@/core/events');
  return { ...actual, emit: vi.fn() };
});

beforeAll(async () => {
  await loadCompetitionsDict('zh-TW');
  await loadCompetitionsDict(getCurrentLocale());
});

let toastShow: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  toastShow = vi.spyOn(toast, 'show').mockImplementation(() => 1);
  if (vi.isMockFunction(openPmDialog)) openPmDialog.mockClear();
  if (vi.isMockFunction(emit)) emit.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mount(node: ComponentChildren) {
  return render(<LocationProvider>{node}</LocationProvider>);
}

function draw(env: CpInjectedEnv, Page: ComponentType) {
  return mount(
    <CpEnvProvider value={env}>
      <Page />
    </CpEnvProvider>,
  );
}

function holdOpen(): { promise: Promise<void>; release: () => void } {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  return { promise, release };
}

function buttonOf(name: string, index = 0): HTMLButtonElement {
  const node = screen.getAllByRole('button', { name })[index];
  if (!(node instanceof HTMLButtonElement)) throw new Error(`找不到按鈕 ${name}`);
  return node;
}

function inputOf(label: string | RegExp): HTMLInputElement {
  const node = screen.getByLabelText(label);
  if (!(node instanceof HTMLInputElement)) throw new Error('找不到輸入欄');
  return node;
}

function areaOf(label: RegExp): HTMLTextAreaElement {
  const node = screen.getByLabelText(label);
  if (!(node instanceof HTMLTextAreaElement)) throw new Error('找不到文字區');
  return node;
}

function selectOf(label: string): HTMLSelectElement {
  const node = screen.getByLabelText(label);
  if (!(node instanceof HTMLSelectElement)) throw new Error('找不到選單');
  return node;
}

function scoreText(): [string, string] {
  const nodes = [...document.querySelectorAll('.cp3-score__num')];
  return [nodes[0]?.textContent ?? '', nodes[1]?.textContent ?? ''];
}

function rowOf(name: string): HTMLElement {
  const row = screen.getByText(name).closest('li');
  if (!(row instanceof HTMLElement)) throw new Error(`找不到 ${name}`);
  return row;
}

const PREVIEW_DAYS = [
  { date: '2027-01-09', start: '09:00', end: '18:00' },
  { date: '2027-01-10', start: '09:00', end: '18:00' },
];

function previewResult(dryRun: boolean, unplacedCount = 0): CpGenerateScheduleResult {
  return {
    dvId: 'dv_adult',
    seed: 7,
    matchCount: unplacedCount > 0 ? 2 : 6,
    unplacedCount,
    daysUsed: unplacedCount > 0 ? ['2027-01-09'] : ['2027-01-09', '2027-01-10'],
    perTeam: unplacedCount > 0 ? 1 : 3,
    teamCount: 4,
    dryRun,
  };
}

function scheduleEnv(actor: CpActor, staff: StaffDoc | null, actions: CpActions = idleActions()): CpInjectedEnv {
  return {
    ...screenEnv('host-approved'),
    actor,
    actions,
    bundle: manageBundle(staff),
  };
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

function matchesEnv(
  actor: CpActor,
  staff: StaffDoc | null,
  matches: readonly MatchDoc[],
  actions: CpActions = idleActions(),
  bundlePatch?: Partial<CpBundle>,
): CpInjectedEnv {
  const bundle: CpBundle = {
    competition: competition(),
    divisions: [adultDivision],
    entries: [],
    roster: [],
    privates: [],
    staff,
    ...bundlePatch,
  };
  return {
    actor,
    repo: createFakeCpRepo(),
    actions,
    now: taipeiMs(2027, 1, 9, 12, 0),
    route: { cid: 'cup' },
    bundle,
    matches,
  };
}

const PEOPLE: Array<{ label: string; actor: CpActor; staff: StaffDoc | null; allowed: boolean }> = [
  { label: '會員', actor: memberActor, staff: null, allowed: false },
  { label: '主辦', actor: hostActor, staff: { uid: 'uid_host', roles: ['host'] }, allowed: true },
  { label: '共同主辦', actor: coHostActor, staff: { uid: 'uid_co', roles: ['coHost'] }, allowed: true },
  { label: '管理員', actor: adminActor, staff: null, allowed: true },
  { label: '俱樂部代表', actor: clubRepActor, staff: null, allowed: false },
];

describe('排賽程', () => {
  it('預覽帶 dryRun，改欄位後要重看，產生賽程帶回同一個 seed', async () => {
    const generate = vi.fn(async (input: CpGenerateScheduleInput) => previewResult(input.dryRun === true));
    draw(scheduleEnv(hostActor, { uid: 'uid_host', roles: ['host'] }, { ...idleActions(), generateSchedule: generate }), HostSchedulePage);
    const dates = screen.getAllByLabelText('日期') as HTMLInputElement[];
    expect(dates[0]?.value).toBe('2027-01-09');
    expect(dates[1]?.value).toBe('2027-01-10');
    expect(selectOf('組別').value).toBe('dv_adult');
    expect(buttonOf('產生賽程').disabled).toBe(true);

    fireEvent.click(buttonOf('預覽'));
    expect(await screen.findByText('共 6 場、需 2 天、每隊 3 場')).toBeTruthy();
    expect(generate).toHaveBeenNthCalledWith(1, {
      cid: 'cup',
      dvId: 'dv_adult',
      legs: 1,
      matchMinutes: 40,
      bufferMinutes: 10,
      days: PREVIEW_DAYS,
      venueIdx: [0],
      dryRun: true,
    });
    expect(buttonOf('產生賽程').disabled).toBe(false);

    fireEvent.input(inputOf('每場分鐘數'), { target: { value: '45' } });
    expect(buttonOf('產生賽程').disabled).toBe(true);
    expect(screen.queryByText('共 6 場、需 2 天、每隊 3 場')).toBeNull();

    fireEvent.click(buttonOf('預覽'));
    await screen.findByText('共 6 場、需 2 天、每隊 3 場');
    expect(generate).toHaveBeenNthCalledWith(2, {
      cid: 'cup',
      dvId: 'dv_adult',
      legs: 1,
      matchMinutes: 45,
      bufferMinutes: 10,
      days: PREVIEW_DAYS,
      venueIdx: [0],
      dryRun: true,
    });

    fireEvent.click(buttonOf('產生賽程'));
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(3));
    expect(generate).toHaveBeenNthCalledWith(3, {
      cid: 'cup',
      dvId: 'dv_adult',
      legs: 1,
      matchMinutes: 45,
      bufferMinutes: 10,
      days: PREVIEW_DAYS,
      venueIdx: [0],
      seed: 7,
      dryRun: false,
    });
    expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({
      message: '共 6 場、需 2 天、每隊 3 場',
      tone: 'success',
    }));
  });

  it('雙循環、場間緩衝、新增與移除比賽日都進預覽', async () => {
    const generate = vi.fn(async (input: CpGenerateScheduleInput) => previewResult(input.dryRun === true));
    draw(scheduleEnv(hostActor, { uid: 'uid_host', roles: ['host'] }, { ...idleActions(), generateSchedule: generate }), HostSchedulePage);
    fireEvent.click(screen.getByRole('radio', { name: '雙循環' }));
    fireEvent.input(inputOf('場間緩衝（分鐘）'), { target: { value: '15' } });
    fireEvent.click(buttonOf('新增比賽日'));
    const dates = screen.getAllByLabelText('日期') as HTMLInputElement[];
    expect(dates).toHaveLength(3);
    const added = dates[2];
    if (!(added instanceof HTMLInputElement)) throw new Error('找不到新比賽日');
    fireEvent.input(added, { target: { value: '2027-01-11' } });
    fireEvent.click(buttonOf('預覽'));
    await waitFor(() => expect(generate).toHaveBeenCalledWith({
      cid: 'cup',
      dvId: 'dv_adult',
      legs: 2,
      matchMinutes: 40,
      bufferMinutes: 15,
      days: [...PREVIEW_DAYS, { date: '2027-01-11', start: '09:00', end: '18:00' }],
      venueIdx: [0],
      dryRun: true,
    }));
    fireEvent.click(buttonOf('移除', 1));
    expect(screen.getAllByLabelText('日期')).toHaveLength(2);
    fireEvent.click(buttonOf('預覽'));
    await waitFor(() => expect(generate).toHaveBeenLastCalledWith({
      cid: 'cup',
      dvId: 'dv_adult',
      legs: 2,
      matchMinutes: 40,
      bufferMinutes: 15,
      days: PREVIEW_DAYS,
      venueIdx: [0],
      dryRun: true,
    }));
  });

  it('排不下時顯示剩餘場次，產生賽程維持停用', async () => {
    const generate = vi.fn(async () => previewResult(true, 4));
    draw(scheduleEnv(hostActor, { uid: 'uid_host', roles: ['host'] }, { ...idleActions(), generateSchedule: generate }), HostSchedulePage);
    fireEvent.click(buttonOf('預覽'));
    expect(await screen.findByText('還有 4 場排不下，請加比賽日或場地')).toBeTruthy();
    expect(buttonOf('產生賽程').disabled).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('場次太多時提示清除，清除只送 cid 與組別', async () => {
    const generate = vi.fn(async (input: CpGenerateScheduleInput) => {
      if (input.dryRun) return previewResult(true);
      throw new CpCallError('SCHEDULE_REPLACE_TOO_LARGE', {});
    });
    const clearSchedule = vi.fn(async () => ({}));
    draw(scheduleEnv(hostActor, { uid: 'uid_host', roles: ['host'] }, {
      ...idleActions(), generateSchedule: generate, clearSchedule,
    }), HostSchedulePage);
    fireEvent.click(buttonOf('預覽'));
    await screen.findByText('共 6 場、需 2 天、每隊 3 場');
    fireEvent.click(buttonOf('產生賽程'));
    expect(await screen.findByText('場次太多，請先清除賽程再重新排')).toBeTruthy();
    expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({
      message: '場次太多，請先清除賽程再重新排',
      tone: 'error',
    }));
    fireEvent.click(buttonOf('清除賽程'));
    expect(clearSchedule).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: '清除賽程' });
    expect(within(dialog).getByText('清除後這個組別的賽程會刪掉，確定要清除？')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(clearSchedule).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: '清除賽程' })).toBeNull();
    fireEvent.click(buttonOf('清除賽程'));
    fireEvent.click(within(screen.getByRole('dialog', { name: '清除賽程' })).getByRole('button', { name: '清除賽程' }));
    await waitFor(() => expect(clearSchedule).toHaveBeenCalledWith({ cid: 'cup', dvId: 'dv_adult' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '清除賽程' })).toBeNull());
  });

  it('預覽連點只送一次', async () => {
    const door = holdOpen();
    const generate = vi.fn(async () => {
      await door.promise;
      return previewResult(true);
    });
    draw(scheduleEnv(hostActor, { uid: 'uid_host', roles: ['host'] }, { ...idleActions(), generateSchedule: generate }), HostSchedulePage);
    const preview = buttonOf('預覽');
    preview.click();
    preview.click();
    expect(generate).toHaveBeenCalledTimes(1);
    door.release();
    expect(await screen.findByText('共 6 場、需 2 天、每隊 3 場')).toBeTruthy();
  });

  it('場地全拿掉時不呼叫排程', () => {
    const generate = vi.fn();
    draw(scheduleEnv(hostActor, { uid: 'uid_host', roles: ['host'] }, { ...idleActions(), generateSchedule: generate }), HostSchedulePage);
    fireEvent.click(screen.getByRole('checkbox', { name: '示範球場' }));
    fireEvent.click(buttonOf('預覽'));
    expect(generate).not.toHaveBeenCalled();
    expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({ message: '還有必填項目沒填' }));
  });

  it.each(PEOPLE)('注入權限 $label', ({ actor, staff, allowed }) => {
    draw(scheduleEnv(actor, staff), HostSchedulePage);
    if (allowed) {
      expect(screen.getByRole('button', { name: '預覽' })).toBeTruthy();
    } else {
      expect(screen.getByRole('alert').textContent).toContain('只有主辦可以做這個操作');
      expect(screen.queryByRole('button', { name: '預覽' })).toBeNull();
    }
  });
});

describe('賽程管理按鈕', () => {
  const rows: Array<{ id: string; status: MatchStatus; home: string; away: string; score: [number, number]; kickoff: number | null; buttons: string[] }> = [
    { id: 'mt_sched', status: 'scheduled', home: '海風隊', away: '山貓隊', score: [0, 0], kickoff: taipeiMs(2027, 1, 9, 9, 0), buttons: ['改期', '取消這場', '登錄比分'] },
    { id: 'mt_fin', status: 'finished', home: '銀河隊', away: '晨光隊', score: [2, 1], kickoff: taipeiMs(2027, 1, 9, 11, 0), buttons: ['登錄比分', '確認', '取消這場'] },
    { id: 'mt_ok', status: 'confirmed', home: '青鳥隊', away: '赤羽隊', score: [1, 0], kickoff: taipeiMs(2027, 1, 9, 13, 0), buttons: ['重置'] },
    { id: 'mt_wo', status: 'walkover', home: '白浪隊', away: '黑潮隊', score: [0, 2], kickoff: taipeiMs(2027, 1, 9, 15, 0), buttons: ['重置'] },
    { id: 'mt_live', status: 'live', home: '綠洲隊', away: '黃沙隊', score: [1, 1], kickoff: taipeiMs(2027, 1, 9, 17, 0), buttons: [] },
    { id: 'mt_half', status: 'halftime', home: '赤陽隊', away: '青石隊', score: [0, 0], kickoff: taipeiMs(2027, 1, 9, 18, 0), buttons: [] },
    { id: 'mt_move', status: 'postponed', home: '北風隊', away: '南風隊', score: [0, 0], kickoff: null, buttons: ['改期', '取消這場'] },
  ];

  function list(): MatchDoc[] {
    return rows.map((row, index) => match({
      id: row.id,
      status: row.status,
      matchNo: index + 1,
      kickoffAt: row.kickoff,
      venueIdx: row.kickoff == null ? null : 0,
      venueName: row.kickoff == null ? null : '示範球場',
      home: { teamId: `en_${row.id}_h`, name: row.home },
      away: { teamId: `en_${row.id}_a`, name: row.away },
      teamIds: [`en_${row.id}_h`, `en_${row.id}_a`],
      score: { home: row.score[0], away: row.score[1] },
      walkoverSide: row.status === 'walkover' ? 'home' : null,
    }));
  }

  it('依狀態給按鈕，今天有標記，進行中不能改', () => {
    const view = draw(matchesEnv(hostActor, { uid: 'uid_host', roles: ['host'] }, list()), HostMatchesPage);
    expect(view.container.textContent ?? '').toContain('1月9日　週六（今天）');
    expect(screen.getAllByText('時間待定').length).toBeGreaterThan(0);
    for (const row of rows) {
      const item = rowOf(row.home);
      const names = within(item).queryAllByRole('button').map((node) => node.textContent);
      expect(names, row.status).toEqual(row.buttons);
    }
    expect(within(rowOf('海風隊')).getByText('vs')).toBeTruthy();
    expect(within(rowOf('海風隊')).getByText('未賽')).toBeTruthy();
    expect(within(rowOf('銀河隊')).getByText('2：1')).toBeTruthy();
    expect(within(rowOf('銀河隊')).getByText('待確認')).toBeTruthy();
    expect(within(rowOf('青鳥隊')).getByText('已確認')).toBeTruthy();
    expect(within(rowOf('白浪隊')).getByText('棄權')).toBeTruthy();
    expect(within(rowOf('綠洲隊')).getByText('進行中')).toBeTruthy();
    expect(within(rowOf('北風隊')).getAllByText('改期').length).toBeGreaterThan(0);
    expect(view.container.querySelector('.cp3-crest')?.getAttribute('style')?.replace(/\s/g, '')).toContain('width:22px');
  });

  it('沒有場次時引導去排賽程', () => {
    draw(matchesEnv(hostActor, { uid: 'uid_host', roles: ['host'] }, []), HostMatchesPage);
    expect(screen.getByText('請先排賽程')).toBeTruthy();
    expect(screen.getByRole('button', { name: '排賽程' })).toBeTruthy();
  });

  it.each(PEOPLE)('注入權限 $label', ({ actor, staff, allowed }) => {
    draw(matchesEnv(actor, staff, [match({ id: 'mt_1', status: 'scheduled' })]), HostMatchesPage);
    if (allowed) {
      expect(screen.getByRole('button', { name: '登錄比分' })).toBeTruthy();
    } else {
      expect(screen.getByRole('alert').textContent).toContain('只有主辦可以做這個操作');
      expect(screen.queryByRole('button', { name: '登錄比分' })).toBeNull();
    }
  });
});

describe('登錄比分、確認、棄權、重置、改期', () => {
  function openScore(): void {
    fireEvent.click(buttonOf('登錄比分'));
  }

  it('登錄並確認送 confirm 與 expectedRev，先登錄則不確認', async () => {
    const recordResult = vi.fn(async () => ({}));
    const actions = { ...idleActions(), recordResult };
    const row = match({ id: 'mt_1', status: 'scheduled', rev: 3 });
    const view = draw(matchesEnv(hostActor, { uid: 'uid_host', roles: ['host'] }, [row], actions), HostMatchesPage);
    openScore();
    expect(screen.getByRole('heading', { name: '登錄比分' })).toBeTruthy();
    expect(buttonOf('減一分').disabled).toBe(true);
    fireEvent.click(buttonOf('加一分'));
    fireEvent.click(buttonOf('加一分'));
    expect(scoreText()).toEqual(['2', '0']);
    fireEvent.click(buttonOf('登錄並確認'));
    await waitFor(() => expect(screen.queryByRole('heading', { name: '登錄比分' })).toBeNull());
    expect(recordResult).toHaveBeenCalledWith({
      cid: 'cup', mtId: 'mt_1', expectedRev: 3, score: { home: 2, away: 0 }, confirm: true,
    });
    expect(screen.getByText('已確認')).toBeTruthy();
    expect(screen.getByText('2：0')).toBeTruthy();
    expect(toastShow).not.toHaveBeenCalled();

    view.unmount();
    cleanup();
    const later = vi.fn(async () => ({}));
    draw(matchesEnv(hostActor, { uid: 'uid_host', roles: ['host'] }, [row], { ...idleActions(), recordResult: later }), HostMatchesPage);
    openScore();
    fireEvent.click(buttonOf('加一分', 1));
    fireEvent.click(buttonOf('先登錄，稍後確認'));
    await waitFor(() => expect(later).toHaveBeenCalledWith({
      cid: 'cup', mtId: 'mt_1', expectedRev: 3, score: { home: 0, away: 1 }, confirm: false,
    }));
    expect(screen.getByText('待確認')).toBeTruthy();
  });

  it('登錄連點只送一次', async () => {
    const door = holdOpen();
    const recordResult = vi.fn(async () => {
      await door.promise;
      return {};
    });
    draw(matchesEnv(hostActor, { uid: 'uid_host', roles: ['host'] }, [match({ id: 'mt_1', status: 'scheduled' })], {
      ...idleActions(), recordResult,
    }), HostMatchesPage);
    openScore();
    const save = buttonOf('登錄並確認');
    save.click();
    save.click();
    expect(recordResult).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(buttonOf('登錄並確認').disabled).toBe(true));
    door.release();
    await waitFor(() => expect(screen.queryByRole('heading', { name: '登錄比分' })).toBeNull());
  });

  it('失敗留著比分，重送沿用同一個 expectedRev；內容相同就當成功', async () => {
    const row = match({ id: 'mt_1', status: 'scheduled', rev: 3 });
    let times = 0;
    const recordResult = vi.fn(async () => {
      times += 1;
      if (times === 1) throw new CpCallError('UNKNOWN', {});
      throw new CpCallError('REV_CONFLICT', {});
    });
    const repo = createFakeCpRepo();
    const saved = match({
      id: 'mt_1', status: 'confirmed', rev: 8, score: { home: 2, away: 0 }, resultSource: 'host',
    });
    repo.listMatches = async () => [saved];
    draw({
      ...matchesEnv(hostActor, { uid: 'uid_host', roles: ['host'] }, [row], { ...idleActions(), recordResult }),
      repo,
    }, HostMatchesPage);
    openScore();
    fireEvent.click(buttonOf('加一分'));
    fireEvent.click(buttonOf('加一分'));
    fireEvent.click(buttonOf('登錄並確認'));
    expect(await screen.findByRole('button', { name: '重新送出' })).toBeTruthy();
    expect(scoreText()).toEqual(['2', '0']);
    expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({
      message: '操作失敗，請稍後再試',
      tone: 'error',
    }));
    fireEvent.click(buttonOf('重新送出'));
    await waitFor(() => expect(screen.queryByRole('heading', { name: '登錄比分' })).toBeNull());
    expect(recordResult).toHaveBeenNthCalledWith(2, {
      cid: 'cup', mtId: 'mt_1', expectedRev: 3, score: { home: 2, away: 0 }, confirm: true,
    });
    expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({
      message: '09:00　示範球場　海風隊 2：0 山貓隊　已確認',
      tone: 'success',
    }));
  });

  it('重送後內容不同就提示這場已被更新，並留著輸入', async () => {
    const row = match({ id: 'mt_1', status: 'scheduled', rev: 3 });
    let times = 0;
    const recordResult = vi.fn(async () => {
      times += 1;
      if (times === 1) throw new CpCallError('UNKNOWN', {});
      if (times === 2) throw new CpCallError('REV_CONFLICT', {});
      return {};
    });
    const repo = createFakeCpRepo();
    repo.listMatches = async () => [match({
      id: 'mt_1', status: 'confirmed', rev: 8, score: { home: 1, away: 0 }, resultSource: 'host',
    })];
    draw({
      ...matchesEnv(hostActor, { uid: 'uid_host', roles: ['host'] }, [row], { ...idleActions(), recordResult }),
      repo,
    }, HostMatchesPage);
    openScore();
    fireEvent.click(buttonOf('加一分'));
    fireEvent.click(buttonOf('加一分'));
    fireEvent.click(buttonOf('登錄並確認'));
    await screen.findByRole('button', { name: '重新送出' });
    fireEvent.click(buttonOf('重新送出'));
    expect(await screen.findByText('這場已被更新，請關閉後重新操作')).toBeTruthy();
    expect(document.body.textContent ?? '').toContain('09:00　示範球場　海風隊 1：0 山貓隊　已確認');
    expect(scoreText()).toEqual(['2', '0']);
    expect(screen.queryByRole('button', { name: '重新送出' })).toBeNull();
    // 內容已被別人改成不同結果：送出鈕鎖住，不能用舊輸入覆蓋（Flash 初審 P2）
    expect((buttonOf('登錄並確認') as HTMLButtonElement).disabled).toBe(true);
    expect((buttonOf('先登錄，稍後確認') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(buttonOf('登錄並確認'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(recordResult).toHaveBeenCalledTimes(2);
  });

  it('契約錯誤只 toast 文案，不提供重新送出', async () => {
    let times = 0;
    const recordResult = vi.fn(async () => {
      times += 1;
      throw new CpCallError(times === 1 ? 'MATCH_STATE' : 'COMPETITION_ENDED', {});
    });
    draw(matchesEnv(hostActor, { uid: 'uid_host', roles: ['host'] }, [match({ id: 'mt_1', status: 'scheduled' })], {
      ...idleActions(), recordResult,
    }), HostMatchesPage);
    openScore();
    fireEvent.click(buttonOf('加一分'));
    fireEvent.click(buttonOf('登錄並確認'));
    await waitFor(() => expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({
      message: '這場比賽目前的狀態不能這樣操作',
    })));
    expect(screen.queryByRole('button', { name: '重新送出' })).toBeNull();
    expect(scoreText()).toEqual(['1', '0']);
    fireEvent.click(buttonOf('登錄並確認'));
    await waitFor(() => expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({
      message: '賽事已結束，不能再改比分',
    })));
    expect(screen.queryByRole('button', { name: '重新送出' })).toBeNull();
  });

  it('確認失敗可重送；內容相同當成功，不同則提示', async () => {
    const row = match({ id: 'mt_ok', status: 'finished', rev: 4, score: { home: 2, away: 1 } });
    let times = 0;
    const confirmMatchResult = vi.fn(async () => {
      times += 1;
      if (times === 1) throw new CpCallError('UNKNOWN', {});
      throw new CpCallError('REV_CONFLICT', {});
    });
    const repo = createFakeCpRepo();
    repo.listMatches = async () => [match({
      id: 'mt_ok', status: 'confirmed', rev: 9, score: { home: 2, away: 1 }, resultSource: 'host',
    })];
    const view = draw({
      ...matchesEnv(hostActor, { uid: 'uid_host', roles: ['host'] }, [row], { ...idleActions(), confirmMatchResult }),
      repo,
    }, HostMatchesPage);
    fireEvent.click(buttonOf('確認'));
    expect(await screen.findByRole('button', { name: '重新送出' })).toBeTruthy();
    expect(screen.getByText('2：1')).toBeTruthy();
    fireEvent.click(buttonOf('重新送出'));
    await waitFor(() => expect(screen.queryByRole('button', { name: '重新送出' })).toBeNull());
    expect(confirmMatchResult).toHaveBeenNthCalledWith(1, { cid: 'cup', mtId: 'mt_ok', expectedRev: 4 });
    expect(confirmMatchResult).toHaveBeenNthCalledWith(2, { cid: 'cup', mtId: 'mt_ok', expectedRev: 4 });
    expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({
      message: '09:00　示範球場　海風隊 2：1 山貓隊　已確認',
      tone: 'success',
    }));
    view.unmount();
    cleanup();

    const again = vi.fn(async () => {
      throw new CpCallError('REV_CONFLICT', {});
    });
    const other = createFakeCpRepo();
    other.listMatches = async () => [match({
      id: 'mt_ok', status: 'confirmed', rev: 9, score: { home: 9, away: 9 },
    })];
    draw({
      ...matchesEnv(hostActor, { uid: 'uid_host', roles: ['host'] }, [row], { ...idleActions(), confirmMatchResult: again }),
      repo: other,
    }, HostMatchesPage);
    fireEvent.click(buttonOf('確認'));
    expect(await screen.findByText('這場已被更新')).toBeTruthy();
    expect(screen.queryByText('這場已被更新，請關閉後重新操作')).toBeNull();
    expect(screen.getByText('9：9')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '重新送出' })).toBeNull();
    expect(again).toHaveBeenCalledWith({ cid: 'cup', mtId: 'mt_ok', expectedRev: 4 });
  });

  it('確認連點只送一次', async () => {
    const door = holdOpen();
    const confirmMatchResult = vi.fn(async () => {
      await door.promise;
      return {};
    });
    draw(matchesEnv(hostActor, { uid: 'uid_host', roles: ['host'] }, [
      match({ id: 'mt_ok', status: 'finished', score: { home: 1, away: 0 } }),
    ], { ...idleActions(), confirmMatchResult }), HostMatchesPage);
    const confirm = buttonOf('確認');
    confirm.click();
    confirm.click();
    expect(confirmMatchResult).toHaveBeenCalledTimes(1);
    door.release();
    await waitFor(() => expect(screen.getByText('已確認')).toBeTruthy());
  });

  it('棄權要原因與隊伍，失敗後重送同一原因與 expectedRev', async () => {
    const row = match({ id: 'mt_1', status: 'scheduled', rev: 3 });
    let times = 0;
    const setWalkover = vi.fn(async () => {
      times += 1;
      if (times === 1) throw new CpCallError('UNKNOWN', {});
      throw new CpCallError('REV_CONFLICT', {});
    });
    const repo = createFakeCpRepo();
    repo.listMatches = async () => [match({
      id: 'mt_1', status: 'walkover', rev: 6, walkoverSide: 'away', score: { home: 2, away: 0 }, resultSource: 'host',
    })];
    draw({
      ...matchesEnv(hostActor, { uid: 'uid_host', roles: ['host'] }, [row], { ...idleActions(), setWalkover }),
      repo,
    }, HostMatchesPage);
    openScore();
    fireEvent.click(buttonOf('改登錄棄權'));
    expect(screen.getByRole('heading', { name: '登錄棄權' })).toBeTruthy();
    expect(screen.getByText('棄權方判 0：2')).toBeTruthy();
    fireEvent.click(buttonOf('確認棄權'));
    await waitFor(() => expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({ message: '還有必填項目沒填' })));
    expect(setWalkover).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: '山貓隊' }));
    fireEvent.input(areaOf(/棄權原因/), { target: { value: '未到場' } });
    fireEvent.click(buttonOf('確認棄權'));
    expect(await screen.findByRole('button', { name: '重新送出' })).toBeTruthy();
    expect(areaOf(/棄權原因/).value).toBe('未到場');
    fireEvent.click(buttonOf('重新送出'));
    await waitFor(() => expect(screen.queryByRole('heading', { name: '登錄棄權' })).toBeNull());
    const payload = {
      cid: 'cup', mtId: 'mt_1', expectedRev: 3, forfeitSide: 'away', reason: '未到場',
    };
    expect(setWalkover).toHaveBeenNthCalledWith(1, payload);
    expect(setWalkover).toHaveBeenNthCalledWith(2, payload);
  });

  it('重置要原因，失敗後重送同一個 expectedRev', async () => {
    const row = match({ id: 'mt_ok', status: 'confirmed', rev: 5, score: { home: 3, away: 1 } });
    let times = 0;
    const resetMatch = vi.fn(async () => {
      times += 1;
      if (times === 1) throw new CpCallError('UNKNOWN', {});
      throw new CpCallError('REV_CONFLICT', {});
    });
    const repo = createFakeCpRepo();
    repo.listMatches = async () => [match({
      id: 'mt_ok', status: 'scheduled', rev: 6, score: { home: 0, away: 0 },
      walkoverSide: null, result: null, resultSource: null,
    })];
    draw({
      ...matchesEnv(hostActor, { uid: 'uid_host', roles: ['host'] }, [row], { ...idleActions(), resetMatch }),
      repo,
    }, HostMatchesPage);
    fireEvent.click(buttonOf('重置'));
    const dialog = screen.getByRole('dialog', { name: '重置比分' });
    expect(within(dialog).getByText('重置後比分歸零，積分榜會重算')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '重置' }));
    await waitFor(() => expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({ message: '還有必填項目沒填' })));
    expect(resetMatch).not.toHaveBeenCalled();
    fireEvent.input(areaOf(/重置原因/), { target: { value: '登錯比分' } });
    fireEvent.click(within(screen.getByRole('dialog', { name: '重置比分' })).getByRole('button', { name: '重置' }));
    expect(await screen.findByRole('button', { name: '重新送出' })).toBeTruthy();
    expect(areaOf(/重置原因/).value).toBe('登錯比分');
    fireEvent.click(buttonOf('重新送出'));
    await waitFor(() => expect(screen.queryByRole('heading', { name: '重置比分' })).toBeNull());
    const payload = { cid: 'cup', mtId: 'mt_ok', expectedRev: 5, reason: '登錯比分' };
    expect(resetMatch).toHaveBeenNthCalledWith(1, payload);
    expect(resetMatch).toHaveBeenNthCalledWith(2, payload);
    expect(screen.getByText('未賽')).toBeTruthy();
  });

  it('改期送日期場地；勾待定就送 null', async () => {
    const baseVenue = competition().venues[0] ?? { name: '示範球場' };
    const comp = competition({ venues: [baseVenue, { name: '第二球場' }] });
    const row = match({ id: 'mt_1', status: 'scheduled', rev: 3 });
    const rescheduleMatch = vi.fn(async () => ({}));
    const view = draw(matchesEnv(
      hostActor,
      { uid: 'uid_host', roles: ['host'] },
      [row],
      { ...idleActions(), rescheduleMatch },
      { competition: comp },
    ), HostMatchesPage);
    fireEvent.click(buttonOf('改期'));
    expect(screen.getByRole('heading', { name: '改期' })).toBeTruthy();
    fireEvent.input(inputOf('日期'), { target: { value: '2027-01-11' } });
    fireEvent.input(inputOf('時間'), { target: { value: '14:30' } });
    // 等前面輸入造成的重繪完成，再取最新的選單元素（避免對已被替換的舊節點發事件）
    await new Promise((resolve) => setTimeout(resolve, 0));
    const venue = selectOf('場地');
    // 面板在 preact/compat 的 portal 裡，@testing-library/preact 會把 fireEvent.change 改送成 input，
    // 但 compat 不會把 <select> 的 onChange 改接 input。真實瀏覽器選下拉一定發 change，這裡直接發原生 change。
    venue.value = '1';
    venue.dispatchEvent(new Event('change', { bubbles: true }));
    // Select 是受控元件：先退回舊值，父層重繪後才顯示新值；等重繪後再檢查與送出
    await waitFor(() => expect({
      value: selectOf('場地').value,
      options: [...selectOf('場地').options].map((option) => `${option.value}:${option.label}`),
    }).toEqual({ value: '1', options: ['0:示範球場', '1:第二球場'] }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.click(buttonOf('確認改期'));
    await waitFor(() => expect(rescheduleMatch).toHaveBeenCalledWith({
      cid: 'cup',
      mtId: 'mt_1',
      expectedRev: 3,
      kickoffAt: taipeiMs(2027, 1, 11, 14, 30),
      venueIdx: 1,
    }));
    expect(await screen.findByText('14:30')).toBeTruthy();
    expect(screen.getByText(/第二球場/)).toBeTruthy();
    view.unmount();
    cleanup();

    const tbd = vi.fn(async () => ({}));
    draw(matchesEnv(hostActor, { uid: 'uid_host', roles: ['host'] }, [row], { ...idleActions(), rescheduleMatch: tbd }), HostMatchesPage);
    fireEvent.click(buttonOf('改期'));
    fireEvent.click(screen.getByRole('checkbox', { name: '待定' }));
    expect(inputOf('日期').disabled).toBe(true);
    expect(inputOf('時間').disabled).toBe(true);
    expect(selectOf('場地').disabled).toBe(true);
    fireEvent.click(buttonOf('確認改期'));
    await waitFor(() => expect(tbd).toHaveBeenCalledWith({
      cid: 'cup', mtId: 'mt_1', expectedRev: 3, kickoffAt: null, venueIdx: null,
    }));
  });

  it('改期失敗留著時間，重送用同一個 expectedRev', async () => {
    const row = match({ id: 'mt_1', status: 'scheduled', rev: 3 });
    let times = 0;
    const rescheduleMatch = vi.fn(async () => {
      times += 1;
      if (times === 1) throw new CpCallError('UNKNOWN', {});
      throw new CpCallError('REV_CONFLICT', {});
    });
    const kickoffAt = taipeiMs(2027, 1, 9, 15, 0);
    const repo = createFakeCpRepo();
    repo.listMatches = async () => [match({
      id: 'mt_1', status: 'scheduled', rev: 4, kickoffAt, venueIdx: 0,
    })];
    draw({
      ...matchesEnv(hostActor, { uid: 'uid_host', roles: ['host'] }, [row], { ...idleActions(), rescheduleMatch }),
      repo,
    }, HostMatchesPage);
    fireEvent.click(buttonOf('改期'));
    fireEvent.input(inputOf('時間'), { target: { value: '15:00' } });
    fireEvent.click(buttonOf('確認改期'));
    expect(await screen.findByRole('button', { name: '重新送出' })).toBeTruthy();
    expect(inputOf('時間').value).toBe('15:00');
    fireEvent.click(buttonOf('重新送出'));
    await waitFor(() => expect(screen.queryByRole('heading', { name: '改期' })).toBeNull());
    const payload = { cid: 'cup', mtId: 'mt_1', expectedRev: 3, kickoffAt, venueIdx: 0 };
    expect(rescheduleMatch).toHaveBeenNthCalledWith(1, payload);
    expect(rescheduleMatch).toHaveBeenNthCalledWith(2, payload);
  });
});

describe('從賽事頁進入', () => {
  it('詳情與報隊管理只給主辦方，俱樂部代表沒有這兩個入口', () => {
    const rep = draw(screenEnv('detail-rep'), CompetitionDetailPage);
    expect(rep.container.textContent ?? '').not.toContain('排賽程');
    rep.unmount();
    cleanup();

    const detail = screenEnv('detail-rep');
    draw({ ...detail, actor: hostActor, bundle: detail.bundle ? { ...detail.bundle, staff: { uid: 'uid_host', roles: ['host'] } } : undefined }, CompetitionDetailPage);
    expect(screen.getByRole('button', { name: '排賽程' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '賽程管理' })).toBeTruthy();
    cleanup();

    const admin = screenEnv('detail-rep');
    draw({ ...admin, actor: adminActor }, CompetitionDetailPage);
    expect(screen.getByRole('button', { name: '排賽程' })).toBeTruthy();
    cleanup();

    draw(screenEnv('host-approved'), CompetitionManagePage);
    expect(screen.getByRole('button', { name: '排賽程' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '賽程管理' })).toBeTruthy();
    cleanup();

    draw({ ...screenEnv('host-approved'), actor: clubRepActor, bundle: manageBundle(null) }, CompetitionManagePage);
    expect(screen.queryByRole('button', { name: '排賽程' })).toBeNull();
    expect(screen.getByRole('heading', { name: '報隊管理' })).toBeTruthy();
  });
});

describe('聯絡主辦', () => {
  it('俱樂部主辦連到俱樂部頁，並顯示公開聯絡文字', () => {
    const club = screenEnv('detail-rep');
    if (club.bundle?.competition) {
      club.bundle = {
        ...club.bundle,
        competition: { ...club.bundle.competition, contactNote: '賽前群組' },
      };
    }
    draw(club, CompetitionDetailPage);
    const link = screen.getByRole('link', { name: '聯絡主辦' });
    expect(link.getAttribute('href')).toBe('/teams/club_host');
    expect(screen.getAllByText('示範俱樂部').length).toBeGreaterThan(0);
    expect(screen.getByText('賽前群組')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '私訊主辦' })).toBeNull();
    expect((club.repo as FakeCpRepo).calls()).not.toContain('findHostUid');
    const previous = `${window.location.pathname}${window.location.search}`;
    fireEvent.click(link);
    expect(window.location.pathname).toBe('/teams/club_host');
    window.history.pushState(null, '', previous || '/');
  });

  it('個人主辦沒有聯絡文字就不顯示整區，有文字只顯示那一行', () => {
    const personal = screenEnv('detail-personal');
    const bare = draw(personal, CompetitionDetailPage);
    expect(screen.queryByRole('heading', { name: '聯絡主辦' })).toBeNull();
    expect(screen.queryByRole('link', { name: '聯絡主辦' })).toBeNull();
    expect(screen.queryByRole('button', { name: '私訊主辦' })).toBeNull();
    expect((personal.repo as FakeCpRepo).calls()).not.toContain('findHostUid');
    bare.unmount();
    cleanup();

    if (personal.bundle?.competition) {
      personal.bundle = {
        ...personal.bundle,
        competition: { ...personal.bundle.competition, contactNote: '賽前到集合點找王示範' },
      };
    }
    draw(personal, CompetitionDetailPage);
    expect(screen.getByRole('heading', { name: '聯絡主辦' })).toBeTruthy();
    expect(screen.getByText('賽前到集合點找王示範')).toBeTruthy();
    expect(screen.queryByRole('link', { name: '聯絡主辦' })).toBeNull();
    expect(screen.queryByRole('button', { name: '私訊主辦' })).toBeNull();
  });
});

describe('假資料載入', () => {
  function repo(staff: StaffDoc | null, matches: MatchDoc[] = []) {
    return createFakeCpRepo({
      competitions: [competition()],
      divisions: { cup: staff ? [adultDivision, youthDivision] : [adultDivision] },
      staff: staff ? { cup: [staff] } : {},
      matches: { cup: matches },
    });
  }

  it('主辦、共同主辦、管理員看得到排賽程，俱樂部代表被擋下', async () => {
    const generate = vi.fn(async () => previewResult(true));
    const host = draw({
      actor: hostActor,
      repo: repo({ uid: 'uid_host', roles: ['host'] }),
      actions: { ...idleActions(), generateSchedule: generate },
      now: taipeiMs(2027, 1, 9, 12, 0),
      route: { cid: 'cup' },
    }, HostSchedulePage);
    expect(await screen.findByDisplayValue('2027-01-09')).toBeTruthy();
    fireEvent.click(buttonOf('預覽'));
    await waitFor(() => expect(generate).toHaveBeenCalledWith({
      cid: 'cup',
      dvId: 'dv_adult',
      legs: 1,
      matchMinutes: 40,
      bufferMinutes: 10,
      days: PREVIEW_DAYS,
      venueIdx: [0],
      dryRun: true,
    }));
    host.unmount();
    cleanup();

    draw({
      actor: coHostActor,
      repo: repo({ uid: 'uid_co', roles: ['coHost'] }),
      actions: idleActions(),
      route: { cid: 'cup' },
    }, HostSchedulePage);
    expect(await screen.findByRole('button', { name: '預覽' })).toBeTruthy();
    cleanup();

    draw({
      actor: adminActor,
      repo: repo(null),
      actions: idleActions(),
      route: { cid: 'cup' },
    }, HostSchedulePage);
    expect(await screen.findByRole('button', { name: '預覽' })).toBeTruthy();
    cleanup();

    draw({
      actor: clubRepActor,
      repo: repo(null),
      actions: idleActions(),
      route: { cid: 'cup' },
    }, HostSchedulePage);
    expect((await screen.findByRole('alert')).textContent).toContain('只有主辦可以做這個操作');
    expect(screen.queryByRole('button', { name: '預覽' })).toBeNull();
  });

  it('賽程管理從倉庫讀場次，俱樂部代表直接進入沒有按鈕', async () => {
    const host = draw({
      actor: hostActor,
      repo: repo({ uid: 'uid_host', roles: ['host'] }, [match({ id: 'mt_1', status: 'scheduled' })]),
      actions: idleActions(),
      now: taipeiMs(2027, 1, 9, 12, 0),
      route: { cid: 'cup' },
    }, HostMatchesPage);
    expect(await screen.findByRole('button', { name: '登錄比分' })).toBeTruthy();
    host.unmount();
    cleanup();

    draw({
      actor: clubRepActor,
      repo: repo(null, [match({ id: 'mt_1', status: 'scheduled' })]),
      actions: idleActions(),
      route: { cid: 'cup' },
    }, HostMatchesPage);
    expect((await screen.findByRole('alert')).textContent).toContain('只有主辦可以做這個操作');
    expect(screen.queryByText('海風隊')).toBeNull();
  });
});
