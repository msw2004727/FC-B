import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { openPmDialog } from '@/features/inbox/components/pm-dialog-store';
import { emit } from '@/core/events';
import type { ComponentChildren, ComponentType } from 'preact';
import { LocationProvider } from 'preact-iso';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCurrentLocale } from '@/i18n/i18n';
import { AppConfirmHost, _resetAppConfirmForTest } from '@/ui/AppConfirm';
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
  repActor,
  screenEnv,
  wizardSeed,
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
  _resetAppConfirmForTest();
  vi.restoreAllMocks();
});

function mount(node: ComponentChildren) {
  return render(<LocationProvider>{node}</LocationProvider>);
}

function draw(env: CpInjectedEnv, Page: ComponentType) {
  return mount(
    <CpEnvProvider value={env}>
      <Page />
      <AppConfirmHost />
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
  // 後端 hostAccess：俱樂部賽事的目前代表算主辦（沒有 staff 文件）
  { label: '俱樂部目前代表', actor: clubRepActor, staff: null, allowed: true },
  { label: '主辦俱樂部的一般成員', actor: { ...memberActor, memberClubIds: ['club_host'] }, staff: null, allowed: false },
  { label: '前代表（換人後）', actor: { ...clubRepActor, repClubs: [] }, staff: null, allowed: false },
  { label: '別隊代表', actor: repActor, staff: null, allowed: false },
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
    fireEvent.click(screen.getByRole('button', { name: '移除 第 3 天' }));
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
    { id: 'mt_sched', status: 'scheduled', home: '海風隊', away: '山貓隊', score: [0, 0], kickoff: taipeiMs(2027, 1, 9, 9, 0), buttons: ['登錄比分', '記分', '改期', '取消這場'] },
    { id: 'mt_fin', status: 'finished', home: '銀河隊', away: '晨光隊', score: [2, 1], kickoff: taipeiMs(2027, 1, 9, 11, 0), buttons: ['確認', '登錄比分', '取消這場'] },
    { id: 'mt_ok', status: 'confirmed', home: '青鳥隊', away: '赤羽隊', score: [1, 0], kickoff: taipeiMs(2027, 1, 9, 13, 0), buttons: ['重置'] },
    { id: 'mt_wo', status: 'walkover', home: '白浪隊', away: '黑潮隊', score: [0, 2], kickoff: taipeiMs(2027, 1, 9, 15, 0), buttons: ['重置'] },
    { id: 'mt_live', status: 'live', home: '綠洲隊', away: '黃沙隊', score: [1, 1], kickoff: taipeiMs(2027, 1, 9, 17, 0), buttons: ['記分'] },
    { id: 'mt_half', status: 'halftime', home: '赤陽隊', away: '青石隊', score: [0, 0], kickoff: taipeiMs(2027, 1, 9, 18, 0), buttons: ['記分'] },
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
    expect(within(rowOf('銀河隊')).queryByRole('button', { name: '記分' })).toBeNull();
    // 新外觀卡 1b-4：主辦版比賽列改用 ui/match-row.tsx 共用兩小塊，比賽列隊徽 22→24
    expect(view.container.querySelector('.cp3-crest')?.getAttribute('style')?.replace(/\s/g, '')).toContain('width:24px');
  });

  it('賽程管理矮板：進行中在第一格、待確認一格，整句給報讀；場次讀到上限 100 不放板（第 4 批 3.4）', () => {
    const view = draw(matchesEnv(hostActor, { uid: 'uid_host', roles: ['host'] }, list()), HostMatchesPage);
    const keys = [...view.container.querySelectorAll('.cph-sb .d2-cell__k')].map((el) => el.textContent);
    expect(keys[0]).toBe('進行中');
    expect(keys).toContain('待確認');
    // 今天那一格用字典鍵 lineTodayOnly；鍵名寫錯時 ct() 會回傳鍵名本身，整格變成英文（設計 07:26）
    expect(keys).toContain('今天');
    expect(view.container.querySelector('.cph-sb')?.textContent ?? '').not.toMatch(/[A-Za-z]{4,}/);
    expect(view.container.querySelector('.cph-sb .d2-cells')?.getAttribute('aria-hidden')).toBe('true');
    expect(view.container.querySelector('.cph-sb .cps-vh')?.textContent ?? '').toContain('待確認 1 場');
    view.unmount();
    cleanup();
    const many = Array.from({ length: 100 }, (_, i) => match({ id: `mt_${i}`, status: 'scheduled', matchNo: i + 1 }));
    const capped = draw(matchesEnv(hostActor, { uid: 'uid_host', roles: ['host'] }, many), HostMatchesPage);
    expect(capped.container.querySelector('.cph-sb')).toBeNull();
  });

  it('結束 180 秒內可以記分，超過就不能', () => {
    const now = taipeiMs(2027, 1, 9, 12, 0);
    draw(matchesEnv(hostActor, { uid: 'uid_host', roles: ['host'] }, [
      match({
        id: 'mt_new',
        status: 'finished',
        finishedAt: now - 60_000,
        home: { teamId: 'en_h', name: '近終隊' },
        away: { teamId: 'en_a', name: '山貓隊' },
      }),
      match({
        id: 'mt_old',
        status: 'finished',
        finishedAt: now - 200_000,
        home: { teamId: 'en_h', name: '久終隊' },
        away: { teamId: 'en_a', name: '山貓隊' },
      }),
    ]), HostMatchesPage);
    expect(within(rowOf('近終隊')).getByRole('button', { name: '記分' })).toBeTruthy();
    expect(within(rowOf('久終隊')).queryByRole('button', { name: '記分' })).toBeNull();
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
    // 新外觀卡 4-B：頁首矮板多一格「待確認」，改在場次清單裡找這一場的狀態標籤
    expect(within(document.querySelector('.cp3-ml') as HTMLElement).getByText('待確認')).toBeTruthy();
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
  it('詳情與報隊管理的主辦入口：主辦、管理員、俱樂部目前代表看得到，非代表看不到', () => {
    // 主辦俱樂部的目前代表（沒有 staff 文件）
    const rep = draw({ ...screenEnv('detail-rep'), actor: clubRepActor }, CompetitionDetailPage);
    expect(screen.getByRole('button', { name: '排賽程' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '賽程管理' })).toBeTruthy();
    rep.unmount();
    cleanup();

    // 別隊代表（detail-rep 預設）、前代表、主辦俱樂部的一般成員
    for (const who of [repActor, { ...clubRepActor, repClubs: [] }, { ...memberActor, memberClubIds: ['club_host'] }]) {
      const view = draw({ ...screenEnv('detail-rep'), actor: who }, CompetitionDetailPage);
      expect(view.container.textContent ?? '', who.uid ?? '').not.toContain('排賽程');
      view.unmount();
      cleanup();
    }

    // 個人主辦的賽事：代表身分不算主辦
    const personal = screenEnv('detail-rep');
    const solo = draw({
      ...personal,
      actor: clubRepActor,
      bundle: personal.bundle?.competition
        ? { ...personal.bundle, competition: { ...personal.bundle.competition, hostType: 'personal', hostTeamId: null } }
        : undefined,
    }, CompetitionDetailPage);
    expect(solo.container.textContent ?? '').not.toContain('排賽程');
    solo.unmount();
    cleanup();

    // 下架（hidden）不改變身分判斷，與個人主辦相同；動作由後端回 COMPETITION_HIDDEN
    const hidden = screenEnv('detail-rep');
    draw({
      ...hidden,
      actor: clubRepActor,
      bundle: hidden.bundle?.competition
        ? { ...hidden.bundle, competition: { ...hidden.bundle.competition, hidden: true, hiddenReason: '檢舉處理中' } }
        : undefined,
    }, CompetitionDetailPage);
    expect(screen.getByRole('button', { name: '排賽程' })).toBeTruthy();
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
    expect(screen.getByRole('button', { name: '排賽程' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '指派記分員' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '報隊管理' })).toBeTruthy();
    cleanup();

    draw({ ...screenEnv('host-approved'), actor: { ...clubRepActor, repClubs: [] }, bundle: manageBundle(null) }, CompetitionManagePage);
    expect(screen.queryByRole('button', { name: '排賽程' })).toBeNull();
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
    // 新外觀卡 1b-3：聯絡改成頂部下半的主辦列，小字「主辦」不是標題；沒有任何聯絡時頂部只剩板（d2-hero--bare）
    expect(bare.container.querySelector('.d2-hero--bare')).toBeTruthy();
    expect(bare.container.querySelector('.d2-foot')).toBeNull();
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
    const noted = draw(personal, CompetitionDetailPage);
    const foot = noted.container.querySelector('.d2-foot');
    expect(foot?.querySelector('.cpm-h')?.textContent).toBe('主辦');
    expect(screen.queryByRole('heading', { name: '聯絡主辦' })).toBeNull();
    expect(foot?.querySelector('.cpm-public')?.textContent).toBe('賽前到集合點找王示範');
    // 獨立審 B P2：招募中個人主辦有聯絡文字時，主辦名稱與「個人主辦」標籤要在頂部主辦列（招募卡的主辦列因此藏起來）
    expect(foot?.querySelector('.cpm-contact .cpm-host')?.textContent ?? '').not.toBe('');
    expect(foot?.querySelector('.cpm-contact')?.textContent ?? '').toContain('個人主辦');
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

  it('主辦、共同主辦、管理員、俱樂部目前代表看得到排賽程，前代表被擋下', async () => {
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
    expect(await screen.findByRole('button', { name: '預覽' })).toBeTruthy();
    cleanup();

    // 代表清單還在讀：先轉圈，不先顯示沒有權限
    draw({
      actor: { ...clubRepActor, repClubs: [], repClubsPending: true },
      repo: repo(null),
      actions: idleActions(),
      route: { cid: 'cup' },
    }, HostSchedulePage);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: '預覽' })).toBeNull();
    cleanup();

    draw({
      actor: { ...clubRepActor, repClubs: [] },
      repo: repo(null),
      actions: idleActions(),
      route: { cid: 'cup' },
    }, HostSchedulePage);
    expect((await screen.findByRole('alert')).textContent).toContain('只有主辦可以做這個操作');
    expect(screen.queryByRole('button', { name: '預覽' })).toBeNull();
  });

  it('賽程管理從倉庫讀場次，俱樂部目前代表看得到，前代表直接進入沒有按鈕', async () => {
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

    const repView = draw({
      actor: clubRepActor,
      repo: repo(null, [match({ id: 'mt_1', status: 'scheduled' })]),
      actions: idleActions(),
      now: taipeiMs(2027, 1, 9, 12, 0),
      route: { cid: 'cup' },
    }, HostMatchesPage);
    expect(await screen.findByRole('button', { name: '登錄比分' })).toBeTruthy();
    repView.unmount();
    cleanup();

    // 代表清單還在讀：不發讀取，等清單到了再讀
    const waiting = repo(null, [match({ id: 'mt_1', status: 'scheduled' })]);
    draw({
      actor: { ...clubRepActor, repClubs: [], repClubsPending: true },
      repo: waiting,
      actions: idleActions(),
      route: { cid: 'cup' },
    }, HostMatchesPage);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(waiting.calls()).toEqual([]);
    cleanup();

    const former = repo(null, [match({ id: 'mt_1', status: 'scheduled' })]);
    draw({
      actor: { ...clubRepActor, repClubs: [] },
      repo: former,
      actions: idleActions(),
      route: { cid: 'cup' },
    }, HostMatchesPage);
    expect((await screen.findByRole('alert')).textContent).toContain('只有主辦可以做這個操作');
    expect(screen.queryByText('海風隊')).toBeNull();
    expect(former.calls()).not.toContain('listMatches');
  });
});

function hostDetail(
  notices: CompetitionNotice[],
  actions: CpActions,
  options?: { omitNow?: boolean },
): CpInjectedEnv {
  const detail = screenEnv('detail-rep', actions);
  if (!detail.bundle?.competition) throw new Error('缺賽事');
  const { now, ...rest } = detail;
  const next: CpInjectedEnv = {
    ...rest,
    actor: hostActor,
    bundle: {
      ...detail.bundle,
      staff: { uid: 'uid_host', roles: ['host'] },
      competition: { ...detail.bundle.competition, notices },
    },
  };
  if (!options?.omitNow && now != null) next.now = now;
  return next;
}

function noticeDeleteButton(text: string): HTMLButtonElement {
  const row = screen.getByText(text).closest('li');
  if (!(row instanceof HTMLElement)) throw new Error(`找不到公告 ${text}`);
  const node = within(row).getByRole('button', { name: '刪除' });
  if (!(node instanceof HTMLButtonElement)) throw new Error('找不到刪除');
  return node;
}

function confirmButton(id: 'app-confirm-ok' | 'app-confirm-cancel'): HTMLButtonElement {
  const node = document.getElementById(id);
  if (!(node instanceof HTMLButtonElement)) throw new Error(`找不到 ${id}`);
  return node;
}

function fieldError(label: string): string {
  const box = screen.getByLabelText(label).closest('.ui-input');
  return box?.querySelector('[data-field-error]')?.textContent ?? '';
}

/** 撞期文句用表意空白。findByText 會把空白折成一般空格，比對會落空。 */
async function expectClash(text: string): Promise<void> {
  await waitFor(() => {
    const warnings = [...document.querySelectorAll('.cpm-warn')].map((node) => node.textContent ?? '');
    expect(warnings).toContain(text);
  });
}

function flexMatches(): [MatchDoc, MatchDoc] {
  return [
    match({ id: 'mt_1', status: 'scheduled', rev: 3 }),
    match({
      id: 'mt_2',
      status: 'scheduled',
      rev: 4,
      matchNo: 2,
      kickoffAt: taipeiMs(2027, 1, 10, 11, 0),
      venueIdx: 1,
      venueName: '第二球場',
      home: { teamId: 'en_b', name: '藍鯨隊' },
      away: { teamId: 'en_c', name: '紅狐隊' },
      teamIds: ['en_b', 'en_c'],
    }),
  ];
}

describe('公告時間與連點', () => {
  it('發布公告的時間用成功當下，新公告排在最上面', async () => {
    const renderAt = taipeiMs(2027, 1, 9, 8, 0);
    const successAt = taipeiMs(2027, 1, 9, 12, 0);
    let clock = renderAt;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const postNotice = vi.fn(async () => {
      clock = successAt;
      return { noticeId: 'nt_new' };
    });
    draw(hostDetail([
      { id: 'nt_old', text: '舊公告', kind: 'host', at: taipeiMs(2027, 1, 9, 10, 0), by: null },
    ], { ...idleActions(), postNotice }, { omitNow: true }), CompetitionDetailPage);
    fireEvent.click(buttonOf('發布公告'));
    fireEvent.input(areaOf(/公告內容/), { target: { value: '新公告' } });
    fireEvent.click(buttonOf('發布公告'));
    await waitFor(() => {
      const rows = [...document.querySelectorAll('.cpm-ann li')].map((node) => node.textContent ?? '');
      expect(rows[0]).toContain('新公告');
      expect(rows[0]).toContain('1/9 12:00');
    });
    const rows = [...document.querySelectorAll('.cpm-ann li')].map((node) => node.textContent ?? '');
    expect(rows[0]).not.toContain('08:00');
    expect(rows[1]).toContain('舊公告');
    expect(postNotice).toHaveBeenCalledWith({ cid: 'cup', text: '新公告' });
  });

  it('發布公告連點兩次只呼叫一次', async () => {
    const door = holdOpen();
    const postNotice = vi.fn(async () => {
      await door.promise;
      return { noticeId: 'nt_new' };
    });
    draw(hostDetail([], { ...idleActions(), postNotice }), CompetitionDetailPage);
    fireEvent.click(buttonOf('發布公告'));
    fireEvent.input(areaOf(/公告內容/), { target: { value: '連點公告' } });
    const publish = buttonOf('發布公告');
    publish.click();
    publish.click();
    expect(postNotice).toHaveBeenCalledTimes(1);
    door.release();
    expect(await screen.findByText('連點公告')).toBeTruthy();
    expect(postNotice).toHaveBeenCalledTimes(1);
  });

  it('刪除公告連點兩次只呼叫一次', async () => {
    const door = holdOpen();
    const deleteNotice = vi.fn(async () => {
      await door.promise;
    });
    draw(hostDetail([
      { id: 'nt_host', text: '手動公告', kind: 'host', at: 1, by: null },
    ], { ...idleActions(), deleteNotice }), CompetitionDetailPage);
    const button = noticeDeleteButton('手動公告');
    button.click();
    button.click();
    // 原生 click 不包 act，對話框要等下一輪繪製。
    expect(await screen.findAllByRole('alertdialog')).toHaveLength(1);
    confirmButton('app-confirm-ok').click();
    await waitFor(() => expect(deleteNotice).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(deleteNotice).toHaveBeenCalledWith({ cid: 'cup', noticeId: 'nt_host' });
    button.click();
    expect(deleteNotice).toHaveBeenCalledTimes(1);
    door.release();
    await waitFor(() => expect(screen.queryByText('手動公告')).toBeNull());
  });
});

describe('撞期警示與仍要送出', () => {
  const teamClash = '同一隊同時段已有比賽　1/10 11:00　藍鯨隊對紅狐隊';
  const venueClash = '同一場地同時段已有比賽　1/9 09:00　海風隊對山貓隊　示範球場';

  it('改期撞到同隊時顯示警示，仍要改期帶 force', async () => {
    let times = 0;
    const rescheduleMatch = vi.fn(async () => {
      times += 1;
      if (times === 1) throw new CpCallError('SCHEDULE_CONFLICT', { mtId: 'mt_2', type: 'team' });
      return {};
    });
    const [first, second] = flexMatches();
    draw(matchesEnv(hostActor, { uid: 'uid_host', roles: ['host'] }, [first, second], {
      ...idleActions(), rescheduleMatch,
    }), HostMatchesPage);
    fireEvent.click(buttonOf('改期'));
    fireEvent.input(inputOf('時間'), { target: { value: '15:00' } });
    fireEvent.click(buttonOf('確認改期'));
    await expectClash(teamClash);
    expect(toastShow).not.toHaveBeenCalled();
    expect(screen.queryByText('這個時間與其他場次撞期')).toBeNull();
    expect(document.querySelectorAll('.cpm-warn')).toHaveLength(1);
    fireEvent.click(buttonOf('仍要改期'));
    const payload = {
      cid: 'cup',
      mtId: 'mt_1',
      expectedRev: 3,
      kickoffAt: taipeiMs(2027, 1, 9, 15, 0),
      venueIdx: 0,
    };
    await waitFor(() => expect(rescheduleMatch).toHaveBeenCalledTimes(2));
    expect(rescheduleMatch).toHaveBeenNthCalledWith(1, payload);
    expect(rescheduleMatch).toHaveBeenNthCalledWith(2, { ...payload, force: true });
  });

  it('順延撞到同場地時顯示警示，仍要順延帶 force，欄位符合契約', async () => {
    let times = 0;
    const shiftMatchDay = vi.fn(async () => {
      times += 1;
      if (times === 1) throw new CpCallError('SCHEDULE_CONFLICT', { mtId: 'mt_1', type: 'venue' });
      return {};
    });
    const [first, second] = flexMatches();
    draw(matchesEnv(hostActor, { uid: 'uid_host', roles: ['host'] }, [first, second], {
      ...idleActions(), shiftMatchDay,
    }), HostMatchesPage);
    fireEvent.click(buttonOf('整天順延'));
    fireEvent.input(inputOf('新日期'), { target: { value: '2027-01-12' } });
    fireEvent.input(areaOf(/順延原因/), { target: { value: '雨天' } });
    fireEvent.click(buttonOf('確認順延'));
    await expectClash(venueClash);
    fireEvent.click(buttonOf('仍要順延'));
    const payload = { cid: 'cup', fromDate: '2027-01-09', toDate: '2027-01-12', reason: '雨天' };
    await waitFor(() => expect(shiftMatchDay).toHaveBeenCalledTimes(2));
    expect(shiftMatchDay).toHaveBeenNthCalledWith(1, payload);
    expect(shiftMatchDay).toHaveBeenNthCalledWith(2, { ...payload, force: true });
  });

  it('對調撞到同隊時顯示警示，仍要對調帶 force，欄位符合契約', async () => {
    let times = 0;
    const swapMatches = vi.fn(async () => {
      times += 1;
      if (times === 1) throw new CpCallError('SCHEDULE_CONFLICT', { mtId: 'mt_2', type: 'team' });
      return {};
    });
    const [first, second] = flexMatches();
    draw(matchesEnv(hostActor, { uid: 'uid_host', roles: ['host'] }, [first, second], {
      ...idleActions(), swapMatches,
    }), HostMatchesPage);
    fireEvent.click(buttonOf('兩場對調'));
    fireEvent.input(areaOf(/對調原因/), { target: { value: '場地對調' } });
    fireEvent.click(buttonOf('確認對調'));
    await expectClash(teamClash);
    fireEvent.click(buttonOf('仍要對調'));
    const payload = {
      cid: 'cup',
      mtIdA: 'mt_1',
      mtIdB: 'mt_2',
      expectedRevA: 3,
      expectedRevB: 4,
      reason: '場地對調',
    };
    await waitFor(() => expect(swapMatches).toHaveBeenCalledTimes(2));
    expect(swapMatches).toHaveBeenNthCalledWith(1, payload);
    expect(swapMatches).toHaveBeenNthCalledWith(2, { ...payload, force: true });
  });

  it('整天順延成功後清空表單，再按確認順延不會送出', async () => {
    const shiftMatchDay = vi.fn(async () => ({}));
    const [first, second] = flexMatches();
    draw(matchesEnv(hostActor, { uid: 'uid_host', roles: ['host'] }, [first, second], {
      ...idleActions(), shiftMatchDay,
    }), HostMatchesPage);
    fireEvent.click(buttonOf('整天順延'));
    fireEvent.input(inputOf('新日期'), { target: { value: '2027-01-12' } });
    fireEvent.input(areaOf(/順延原因/), { target: { value: '雨天' } });
    fireEvent.click(buttonOf('確認順延'));
    await waitFor(() => expect(shiftMatchDay).toHaveBeenCalledTimes(1));
    // 成功後表單收回；再展開時欄位已清空。
    await waitFor(() => expect(screen.queryByLabelText('新日期')).toBeNull());
    fireEvent.click(buttonOf('整天順延'));
    await waitFor(() => {
      expect(inputOf('新日期').value).toBe('');
      expect(areaOf(/順延原因/).value).toBe('');
    });
    fireEvent.click(buttonOf('確認順延'));
    expect(shiftMatchDay).toHaveBeenCalledTimes(1);
  });

  it('對調成功後清空理由與選取，再按確認對調不會送出', async () => {
    const swapMatches = vi.fn(async () => ({}));
    const [first, second] = flexMatches();
    const third = match({
      id: 'mt_3',
      status: 'scheduled',
      rev: 5,
      matchNo: 3,
      kickoffAt: taipeiMs(2027, 1, 10, 15, 0),
      venueIdx: 0,
      venueName: '示範球場',
      home: { teamId: 'en_d', name: '北風隊' },
      away: { teamId: 'en_e', name: '南風隊' },
      teamIds: ['en_d', 'en_e'],
    });
    draw(matchesEnv(hostActor, { uid: 'uid_host', roles: ['host'] }, [first, second, third], {
      ...idleActions(), swapMatches,
    }), HostMatchesPage);
    fireEvent.click(buttonOf('兩場對調'));
    const secondPick = selectOf('第二場');
    secondPick.value = 'mt_3';
    secondPick.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => expect(selectOf('第二場').value).toBe('mt_3'));
    fireEvent.input(areaOf(/對調原因/), { target: { value: '場地對調' } });
    fireEvent.click(buttonOf('確認對調'));
    await waitFor(() => expect(swapMatches).toHaveBeenCalledTimes(1));
    expect(swapMatches).toHaveBeenCalledWith({
      cid: 'cup',
      mtIdA: 'mt_1',
      mtIdB: 'mt_3',
      expectedRevA: 3,
      expectedRevB: 5,
      reason: '場地對調',
    });
    // 成功後表單收回；再展開時理由與選取已清空。
    await waitFor(() => expect(screen.queryByLabelText(/對調原因/)).toBeNull());
    fireEvent.click(buttonOf('兩場對調'));
    await waitFor(() => {
      expect(areaOf(/對調原因/).value).toBe('');
      // 選取回到排序後的前兩場，不再停在剛對調的那一場。
      expect(selectOf('第一場').value).not.toBe('mt_1');
      expect(selectOf('第二場').value).not.toBe('mt_3');
    });
    fireEvent.click(buttonOf('確認對調'));
    expect(swapMatches).toHaveBeenCalledTimes(1);
  });

  it('對調遇到 REV_CONFLICT 時重讀場次並更新畫面', async () => {
    const [first, second] = flexMatches();
    const swapMatches = vi.fn(async () => {
      throw new CpCallError('REV_CONFLICT', {});
    });
    const repo = createFakeCpRepo();
    const listMatches = vi.fn(async () => [
      match({
        id: 'mt_1',
        status: 'scheduled',
        rev: 9,
        kickoffAt: taipeiMs(2027, 1, 12, 16, 0),
        venueName: '新球場',
      }),
      match({
        id: 'mt_2',
        status: 'scheduled',
        rev: 8,
        matchNo: 2,
        kickoffAt: taipeiMs(2027, 1, 12, 18, 0),
        home: { teamId: 'en_b', name: '藍鯨隊' },
        away: { teamId: 'en_c', name: '更新隊' },
        teamIds: ['en_b', 'en_c'],
      }),
    ]);
    repo.listMatches = listMatches;
    draw({
      ...matchesEnv(hostActor, { uid: 'uid_host', roles: ['host'] }, [first, second], {
        ...idleActions(), swapMatches,
      }),
      repo,
    }, HostMatchesPage);
    fireEvent.click(buttonOf('兩場對調'));
    fireEvent.input(areaOf(/對調原因/), { target: { value: '場地對調' } });
    fireEvent.click(buttonOf('確認對調'));
    await screen.findByText('更新隊');
    const list = [...document.querySelectorAll('.cp3-ml')].map((node) => node.textContent ?? '').join('');
    expect(list).toContain('16:00');
    expect(list).toContain('新球場');
    expect(list).toContain('更新隊');
    expect(list).toContain('18:00');
    expect(listMatches).toHaveBeenCalledWith('cup');
    expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({
      message: '資料剛被改過，請重整後再試',
      tone: 'error',
    }));
    expect(areaOf(/對調原因/).value).toBe('場地對調');
    expect(swapMatches).toHaveBeenCalledTimes(1);
  });
});

describe('順延與對調卡片', () => {
  const hostStaff: StaffDoc = { uid: 'uid_host', roles: ['host'] };

  function drawStatus(status: 'draft' | 'published' | 'postponed' | 'cancelled', endedAt: number | null, actor = hostActor, staff: StaffDoc | null = hostStaff): void {
    const [first, second] = flexMatches();
    draw(matchesEnv(actor, staff, [first, second], idleActions(), {
      competition: competition({ status, endedAt }),
    }), HostMatchesPage);
  }

  it('已發布且未結束才顯示；已結束只留管理員；草稿延期取消與沒場次都不顯示', () => {
    drawStatus('published', null);
    expect(screen.getByRole('button', { name: '整天順延' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '兩場對調' })).toBeTruthy();
    cleanup();

    drawStatus('published', 1);
    expect(screen.queryByRole('button', { name: '整天順延' })).toBeNull();
    expect(screen.queryByRole('button', { name: '兩場對調' })).toBeNull();
    cleanup();

    drawStatus('published', 1, adminActor, null);
    expect(screen.getByRole('button', { name: '整天順延' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '兩場對調' })).toBeTruthy();
    cleanup();

    for (const status of ['draft', 'postponed', 'cancelled'] as const) {
      drawStatus(status, null);
      expect(screen.queryByRole('button', { name: '整天順延' }), status).toBeNull();
      cleanup();
    }

    draw(matchesEnv(hostActor, hostStaff, [], idleActions()), HostMatchesPage);
    expect(screen.queryByRole('button', { name: '整天順延' })).toBeNull();
    expect(screen.queryByRole('button', { name: '兩場對調' })).toBeNull();
  });
});

describe('已自動發布公告', () => {
  it('打開改期、順延或對調時清掉已自動發布公告', async () => {
    const rescheduleMatch = vi.fn(async () => ({}));
    const shiftMatchDay = vi.fn(async () => ({}));
    const swapMatches = vi.fn(async () => ({}));
    const [first, second] = flexMatches();
    draw(matchesEnv(hostActor, { uid: 'uid_host', roles: ['host'] }, [first, second], {
      ...idleActions(), rescheduleMatch, shiftMatchDay, swapMatches,
    }), HostMatchesPage);
    fireEvent.click(buttonOf('改期'));
    fireEvent.input(inputOf('時間'), { target: { value: '15:00' } });
    fireEvent.click(buttonOf('確認改期'));
    expect(await screen.findByText('已自動發布公告')).toBeTruthy();
    fireEvent.click(buttonOf('改期'));
    expect(screen.queryByText('已自動發布公告')).toBeNull();
    fireEvent.click(buttonOf('取消'));

    fireEvent.click(buttonOf('整天順延'));
    fireEvent.input(inputOf('新日期'), { target: { value: '2027-01-12' } });
    fireEvent.input(areaOf(/順延原因/), { target: { value: '雨天' } });
    fireEvent.click(buttonOf('確認順延'));
    expect(await screen.findByText('已自動發布公告')).toBeTruthy();
    fireEvent.click(buttonOf('整天順延'));
    expect(screen.queryByText('已自動發布公告')).toBeNull();

    fireEvent.click(buttonOf('兩場對調'));
    fireEvent.input(areaOf(/對調原因/), { target: { value: '場地對調' } });
    fireEvent.click(buttonOf('確認對調'));
    expect(await screen.findByText('已自動發布公告')).toBeTruthy();
    fireEvent.click(buttonOf('兩場對調'));
    expect(screen.queryByText('已自動發布公告')).toBeNull();
  });
});

describe('刪除公告確認', () => {
  it('刪除公告要確認，系統公告的確認文字會說明是系統公告', async () => {
    const deleteNotice = vi.fn(async () => ({}));
    draw(hostDetail([
      { id: 'nt_sys', text: '系統已改期', kind: 'system', at: 2, by: null },
      { id: 'nt_host', text: '手動公告', kind: 'host', at: 1, by: null },
    ], { ...idleActions(), deleteNotice }), CompetitionDetailPage);

    noticeDeleteButton('手動公告').click();
    const hostDialog = await screen.findByRole('alertdialog');
    expect(hostDialog.textContent ?? '').toContain('確定要刪除這則公告？');
    expect(hostDialog.textContent ?? '').not.toContain('這是系統公告');
    confirmButton('app-confirm-cancel').click();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(deleteNotice).not.toHaveBeenCalled();

    noticeDeleteButton('手動公告').click();
    await screen.findByRole('alertdialog');
    confirmButton('app-confirm-ok').click();
    await waitFor(() => expect(deleteNotice).toHaveBeenCalledWith({ cid: 'cup', noticeId: 'nt_host' }));
    expect(screen.queryByText('手動公告')).toBeNull();

    noticeDeleteButton('系統已改期').click();
    const systemDialog = await screen.findByRole('alertdialog');
    expect(systemDialog.textContent ?? '').toContain('這是系統公告，確定要刪除？');
    confirmButton('app-confirm-ok').click();
    await waitFor(() => expect(deleteNotice).toHaveBeenCalledWith({ cid: 'cup', noticeId: 'nt_sys' }));
    expect(screen.queryByText('系統已改期')).toBeNull();
  });

  it('刪除公告走危險確認框：開著時 <html> 帶 cp-danger-confirm，取消後拿掉且不刪除', async () => {
    const deleteNotice = vi.fn(async () => ({}));
    draw(hostDetail([
      { id: 'nt_host', text: '手動公告', kind: 'host', at: 1, by: null },
    ], { ...idleActions(), deleteNotice }), CompetitionDetailPage);
    const root = document.documentElement;
    expect(root.classList.contains('cp-danger-confirm')).toBe(false);

    noticeDeleteButton('手動公告').click();
    await screen.findByRole('alertdialog');
    expect(root.classList.contains('cp-danger-confirm')).toBe(true);
    expect(root.getAttribute('data-cp-danger-confirm')).toBe('1');
    confirmButton('app-confirm-cancel').click();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() => expect(root.classList.contains('cp-danger-confirm')).toBe(false));
    expect(root.hasAttribute('data-cp-danger-confirm')).toBe(false);
    expect(deleteNotice).not.toHaveBeenCalled();
    expect(screen.getByText('手動公告')).toBeTruthy();
  });
});

describe('聯絡文字', () => {
  it('儲存聯絡文字連點兩次只送出一次', async () => {
    const door = holdOpen();
    const update = vi.fn(async () => {
      await door.promise;
      return { cid: 'cup' };
    });
    draw({ ...screenEnv('host-pending'), actions: { ...idleActions(), update } }, CompetitionManagePage);
    fireEvent.click(buttonOf('編輯賽事資訊'));
    fireEvent.input(inputOf('聯絡文字'), { target: { value: '賽前群組' } });
    const save = buttonOf('儲存');
    save.click();
    save.click();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ cid: 'cup', contactNote: '賽前群組' });
    door.release();
    // 儲存成功後收回；再展開時儲存鈕已解鎖。
    await waitFor(() => expect(screen.queryByRole('button', { name: '儲存' })).toBeNull());
    fireEvent.click(buttonOf('編輯賽事資訊'));
    expect(buttonOf('儲存').disabled).toBe(false);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('送出前聯絡文字有換行或超長就擋下並顯示欄位錯誤', () => {
    const create = vi.fn(async () => ({ cid: 'cup', dvIds: ['dv_adult'] }));
    const newline = draw({
      ...screenEnv('wizard-3'),
      actions: { ...idleActions(), create },
      wizardSeed: { ...wizardSeed(), contactNote: '賽前集合\n找王示範' },
    }, NewCompetitionPage);
    fireEvent.click(screen.getByRole('button', { name: '建立賽事' }));
    expect(create).not.toHaveBeenCalled();
    expect(fieldError('聯絡文字')).toBe('格式不正確');
    expect(screen.queryByRole('alert')).toBeNull();
    newline.unmount();
    cleanup();

    draw({
      ...screenEnv('wizard-3'),
      actions: { ...idleActions(), create },
      wizardSeed: { ...wizardSeed(), contactNote: '好'.repeat(61) },
    }, NewCompetitionPage);
    fireEvent.click(screen.getByRole('button', { name: '建立賽事' }));
    expect(create).not.toHaveBeenCalled();
    expect(fieldError('聯絡文字')).toBe('字數須介於 1 與 60 之間');
    expect(document.querySelectorAll('[data-field-error]')).toHaveLength(1);
  });

  it('建立失敗且後端指出聯絡文字時，跳回第 1 步並標在聯絡欄', async () => {
    const create = vi.fn(async () => {
      throw new CpCallError('BANNED_WORD', { field: 'contactNote' });
    });
    const view = draw({
      ...screenEnv('wizard-3'),
      actions: { ...idleActions(), create },
      wizardSeed: { ...wizardSeed(), contactNote: '加賴報名' },
    }, NewCompetitionPage);
    expect(screen.getByText('步驟 3／3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '建立賽事' }));
    await waitFor(() => expect(screen.getByText('步驟 1／3')).toBeTruthy());
    expect(screen.getByText('基本資料')).toBeTruthy();
    expect(fieldError('聯絡文字')).toBe('名稱包含不允許的字詞');
    expect(document.querySelectorAll('[data-field-error]')).toHaveLength(1);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(create).toHaveBeenCalledTimes(1);
    view.unmount();
    cleanup();

    const other = vi.fn(async () => {
      throw new CpCallError('BANNED_WORD', { field: 'name' });
    });
    draw({
      ...screenEnv('wizard-3'),
      actions: { ...idleActions(), create: other },
      wizardSeed: { ...wizardSeed(), contactNote: '賽前群組' },
    }, NewCompetitionPage);
    fireEvent.click(screen.getByRole('button', { name: '建立賽事' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('步驟 3／3')).toBeTruthy();
    expect(screen.getByRole('alert').textContent ?? '').toContain('名稱包含不允許的字詞');
  });
});

describe('主辦表單預設收合', () => {
  it('詳情頁公告輸入框預設收成按鈕，點了展開，取消或發布成功後收回', async () => {
    const postNotice = vi.fn(async () => ({ noticeId: 'nt_new' }));
    draw(hostDetail([], { ...idleActions(), postNotice }), CompetitionDetailPage);
    expect(screen.queryByLabelText(/公告內容/)).toBeNull();
    const toggle = buttonOf('發布公告');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe('cp-notice-compose');

    fireEvent.click(toggle);
    expect(document.getElementById('cp-notice-compose')).not.toBeNull();
    expect(areaOf(/公告內容/)).toBeTruthy();
    fireEvent.click(buttonOf('取消'));
    expect(screen.queryByLabelText(/公告內容/)).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(buttonOf('發布公告')));

    fireEvent.click(buttonOf('發布公告'));
    fireEvent.input(areaOf(/公告內容/), { target: { value: '收合公告' } });
    fireEvent.click(buttonOf('發布公告'));
    expect(await screen.findByText('收合公告')).toBeTruthy();
    await waitFor(() => expect(screen.queryByLabelText(/公告內容/)).toBeNull());
    expect(buttonOf('發布公告').getAttribute('aria-expanded')).toBe('false');
    expect(postNotice).toHaveBeenCalledTimes(1);
  });

  it('賽程管理的順延與對調預設收合，一次只開一張，取消會清空並收回', () => {
    const [first, second] = flexMatches();
    draw(matchesEnv(hostActor, { uid: 'uid_host', roles: ['host'] }, [first, second], idleActions()), HostMatchesPage);
    expect(screen.queryByLabelText('新日期')).toBeNull();
    expect(screen.queryByLabelText(/對調原因/)).toBeNull();
    const shift = buttonOf('整天順延');
    const swap = buttonOf('兩場對調');
    expect(shift.getAttribute('aria-expanded')).toBe('false');
    expect(swap.getAttribute('aria-expanded')).toBe('false');
    expect(shift.getAttribute('aria-controls')).toBe('cp-flex-shift');
    expect(swap.getAttribute('aria-controls')).toBe('cp-flex-swap');

    fireEvent.click(shift);
    expect(buttonOf('整天順延').getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById('cp-flex-shift')).not.toBeNull();
    expect(screen.getByRole('heading', { name: '整天順延' })).toBeTruthy();
    expect(inputOf('新日期')).toBeTruthy();
    expect(areaOf(/順延原因/)).toBeTruthy();

    fireEvent.click(buttonOf('兩場對調'));
    expect(screen.queryByLabelText('新日期')).toBeNull();
    expect(buttonOf('兩場對調').getAttribute('aria-expanded')).toBe('true');
    expect(selectOf('第一場')).toBeTruthy();
    fireEvent.input(areaOf(/對調原因/), { target: { value: '場地對調' } });
    fireEvent.click(buttonOf('取消'));
    expect(screen.queryByLabelText(/對調原因/)).toBeNull();
    expect(buttonOf('兩場對調').getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(buttonOf('兩場對調'));
    expect(areaOf(/對調原因/).value).toBe('');
    fireEvent.click(buttonOf('兩場對調'));
    expect(screen.queryByLabelText(/對調原因/)).toBeNull();
  });

  it('報隊管理的分類與聯絡文字預設收成按鈕，點了展開，儲存成功後收回', async () => {
    const update = vi.fn(async () => ({ cid: 'cup' }));
    draw({ ...screenEnv('host-pending'), actions: { ...idleActions(), update } }, CompetitionManagePage);
    expect(screen.queryByRole('radio', { name: '聯賽' })).toBeNull();
    expect(screen.queryByLabelText('聯絡文字')).toBeNull();
    const toggle = buttonOf('編輯賽事資訊');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe('cp-comp-info');

    fireEvent.click(toggle);
    expect(buttonOf('編輯賽事資訊').getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById('cp-comp-info')).not.toBeNull();
    expect(screen.getByRole('radio', { name: '聯賽' })).toBeTruthy();
    fireEvent.input(inputOf('聯絡文字'), { target: { value: '賽前群組' } });
    fireEvent.click(buttonOf('儲存'));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ cid: 'cup', contactNote: '賽前群組' }));
    await waitFor(() => expect(screen.queryByLabelText('聯絡文字')).toBeNull());
    expect(buttonOf('編輯賽事資訊').getAttribute('aria-expanded')).toBe('false');
  });
});

describe('顧問 R2 版面', () => {
  it('結束賽事在場次清單之後，第一屏只有順延與對調兩顆', () => {
    const [first, second] = flexMatches();
    draw(matchesEnv(hostActor, { uid: 'uid_host', roles: ['host'] }, [first, second], idleActions()), HostMatchesPage);
    const end = buttonOf('結束賽事');
    const lists = [...document.querySelectorAll('.cp3-ml')];
    expect(lists.length).toBeGreaterThan(0);
    const firstList = lists[0];
    const lastList = lists[lists.length - 1];
    if (!firstList || !lastList) throw new Error('找不到場次清單');
    // 結束賽事排在最後一張場次清單之後；順延、對調在清單之前。
    expect(lastList.compareDocumentPosition(end) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(firstList.compareDocumentPosition(buttonOf('整天順延')) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(firstList.compareDocumentPosition(buttonOf('兩場對調')) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(end.className).toContain('danger');
    fireEvent.click(end);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('報隊管理展開後按「完成」收回，再點「編輯賽事資訊」也能收回', async () => {
    draw({ ...screenEnv('host-pending'), actions: idleActions() }, CompetitionManagePage);
    fireEvent.click(buttonOf('編輯賽事資訊'));
    const done = buttonOf('完成');
    expect(document.getElementById('cp-comp-info')?.contains(done)).toBe(true);
    expect(screen.queryByRole('button', { name: '取消' })).toBeNull();
    fireEvent.click(done);
    expect(screen.queryByLabelText('聯絡文字')).toBeNull();
    expect(buttonOf('編輯賽事資訊').getAttribute('aria-expanded')).toBe('false');
    await waitFor(() => expect(document.activeElement).toBe(buttonOf('編輯賽事資訊')));

    fireEvent.click(buttonOf('編輯賽事資訊'));
    expect(screen.getByRole('radio', { name: '聯賽' })).toBeTruthy();
    fireEvent.click(buttonOf('編輯賽事資訊'));
    expect(screen.queryByRole('radio', { name: '聯賽' })).toBeNull();
    expect(screen.queryByRole('button', { name: '完成' })).toBeNull();
  });

  // 新外觀卡 1b-5（顧問 §3.465 同意兩種視角統一）：非主辦也是內文佔滿整列、「系統」標籤與時間在下一行；
  // 刪除鈕換成垃圾桶圖示鈕，名稱（aria-label）仍是「刪除」。
  it('主辦與非主辦的公告都是文字佔滿整列、標籤與時間在下一行；主辦的刪除在那一行最右邊', () => {
    draw(hostDetail([
      { id: 'nt_sys', text: '因雨延後一小時，請各隊留意集合時間', kind: 'system', at: 2, by: null },
      { id: 'nt_host', text: '領隊會議改在示範球場門口', kind: 'host', at: 1, by: null },
    ], idleActions()), CompetitionDetailPage);
    const items = [...document.querySelectorAll('.cpm-ann li')];
    expect(items).toHaveLength(2);
    for (const item of items) {
      const row = item.querySelector('.cpm-ann__row');
      const meta = item.querySelector('.cpm-ann__meta');
      expect(row?.querySelector('button')).toBeNull();
      // 主辦視角的文字列只剩公告文字（系統標籤移到日期那一行）。
      expect(row?.children).toHaveLength(1);
      expect(meta?.querySelector('.cpm-ann__time')).not.toBeNull();
      const del = meta?.querySelector('button');
      expect(del?.getAttribute('aria-label')).toBe('刪除');
      // 日期在前（靠左）、刪除在後（靠右）。
      expect(meta?.lastElementChild?.contains(del ?? null)).toBe(true);
    }
    expect(items[0]?.querySelector('.cpm-ann__meta .ui-badge')?.textContent).toContain('系統');
    cleanup();

    draw(screenEnv('real-notices'), CompetitionDetailPage);
    const memberItems = [...document.querySelectorAll('.cpm-ann li')];
    expect(memberItems.length).toBeGreaterThan(0);
    for (const item of memberItems) {
      expect(item.querySelector('.cpm-ann__meta > .cpm-ann__when > .cpm-ann__time')).not.toBeNull();
      expect(item.querySelector('.cpm-ann__row')?.children).toHaveLength(1);
      expect(item.querySelector('button')).toBeNull();
    }
    // 非主辦的系統標籤也在時間那一行。
    expect(memberItems[0]?.querySelector('.cpm-ann__when > .ui-badge')?.textContent).toContain('系統');
  });
});
