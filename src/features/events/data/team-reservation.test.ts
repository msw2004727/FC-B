import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/data/callables', () => ({ callFn: vi.fn(), CallableError: class extends Error {} }));
vi.mock('@/data/firebase', () => ({ getFirebase: vi.fn() }));
vi.mock('firebase/firestore', () => ({ getDoc: vi.fn(), getDocs: vi.fn(), setDoc: vi.fn(), updateDoc: vi.fn() }));

import { applyReservationPromotions } from '../components/legacy/team-reservation-sync';
import { callFn } from '@/data/callables';
import { getFirebase } from '@/data/firebase';
import { getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { buildRegisterPayload } from './signup';
import { buildConfirmedRoster, buildWaitlistRoster, type RosterRegistrationInput } from './attendance-roster-model';
import {
  createTeamReservationController, getTeamReservationAction, getTeamReservationInitialSlots,
  getTeamReservationModalState, getTeamReservationSignupChoices, getTeamReservationStaffTeams,
  isTeamReservationCourseManaged, resolveTeamReservationSignupChoice, teamReservationErrorMessage,
  type TeamReservationEvent, type TeamReservationSnapshot, type TeamReservationViewer,
} from './team-reservation';
import { invalidateViewerRegistrations, readViewerRegistrationsCached } from './viewer-registrations-cache';

const now = Date.parse('2026-11-04T00:00:00Z');
const viewer: TeamReservationViewer = {
  uid: 'u1', teamIds: new Set(['t1', 't2']),
  staffTeams: [{ id: 't1', name: '一隊' }, { id: 't2', name: '二隊' }],
};
const event: TeamReservationEvent = {
  id: 'event-public', _docId: 'event-document', status: 'open', current: 28, max: 30,
  teamReservationSummaries: [
    { teamId: 't1', teamName: '一隊', reservedSlots: 8, usedSlots: 3, remainingSlots: 999 },
    { teamId: 't2', teamName: '二隊', reservedSlots: 2, usedSlots: 2 },
  ],
};
const occupancy = {
  current: 27, realCurrent: 20, waitlist: 1, status: 'open',
  participants: ['測試'], waitlistNames: ['候補'], participantsWithUid: [{ uid: 'test', name: '測試' }],
  waitlistWithUid: [{ uid: 'wait', name: '候補' }],
  teamReservationSummaries: [{ teamId: 't1', reservedSlots: 7, usedSlots: 3, remainingSlots: 4, occupiedSlots: 7 }],
};
const promoted = [{
  id: 'reg-promoted', docId: 'reg-promoted-document', userId: 'test', userName: '測試', teamSeatSource: 'reserved',
}];
function storage() { return { getItem: vi.fn(() => null as string | null), setItem: vi.fn() }; }
function fixture() {
  let snapshot: TeamReservationSnapshot | null = { event, viewer, generation: 1 };
  const local = storage();
  const controller = createTeamReservationController(() => snapshot, { storage: local, now: () => now, randomSuffix: () => 'abc' });
  return { controller, local, setSnapshot: (next: TeamReservationSnapshot | null) => { snapshot = next; } };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(callFn).mockReset();
  vi.mocked(callFn).mockResolvedValue({ success: true, event: occupancy, promoted });
});

describe('職員與入口狀態（純資料，不查詢）', () => {
  it.each([
    ['一般成員', {}, false], ['隊長', { captainUid: 'u1' }, true],
    ['舊領隊', { leaderUid: 'u1' }, true], ['領隊', { leaderUids: ['u1'] }, true],
    ['教練', { coachUids: ['u1'] }, true], ['管理員非職員', { ownerUid: 'u1', creatorUid: 'u1' }, false],
    ['空領隊陣列優先', { leaderUids: [], leaderUid: 'u1' }, false],
    ['不同領隊陣列優先', { leaderUids: ['other'], leaderUid: 'u1' }, false],
    ['同名不授權', { captainName: 'u1' }, false],
  ])('%s', (_name, fields, allowed) => {
    const options = getTeamReservationStaffTeams('u1', [{ id: 't1', name: '一隊', ...fields }]);
    expect(options).toEqual(allowed ? [{ id: 't1', name: '一隊' }] : []);
  });

  it('UID 精確比對、去重及名稱保底', () => {
    expect(getTeamReservationStaffTeams('u1', [
      { id: 't1', teamName: '隊名', coachUids: ['u1'] },
      { id: 't1', name: '重複', captainUid: 'u1' },
      { id: 't2', captainUid: 'u1' }, { id: 't3', captainUid: ' u1 ' },
      { id: '', captainUid: 'u1' },
    ])).toEqual([{ id: 't1', name: '隊名' }, { id: 't2', name: 't2' }]);
    expect(getTeamReservationStaffTeams(null, [{ id: 't1', captainUid: 'u1' }])).toEqual([]);
  });

  it('已有名額／已使用顯示調整；新隊顯示團隊報名', () => {
    expect(getTeamReservationAction({ event, viewer, generation: 1 }, now)).toEqual({
      label: '調整名額', busyLabel: '調整團隊名額中', preferredTeamId: 't1',
    });
    expect(getTeamReservationAction({ event: { ...event, teamReservationSummaries: [] }, viewer, generation: 1 }, now))
      .toEqual({ label: '團隊報名', busyLabel: '建立團隊名額中', preferredTeamId: '' });
    expect(getTeamReservationAction({ event: { ...event, teamReservationSummaries: [{ teamId: 't2', usedSlots: 1 }] }, viewer, generation: 1 }, now)?.preferredTeamId).toBe('t2');
  });

  it.each([
    { viewer: { ...viewer, uid: null } }, { viewer: { ...viewer, staffTeams: [] } },
    { viewer: { uid: 'admin', teamIds: new Set(['t1']), role: 'super_admin' } },
    { loading: true }, { event: null }, { event: { ...event, status: 'ended' } },
    { event: { ...event, status: 'cancelled' } }, { event: { ...event, status: 'upcoming' } },
    { event: { ...event, date: '2026/11/04 08:00~10:00' } },
    { event: { ...event, teamOnly: true, creatorTeamId: 'other' } },
    { event: { ...event, courseLinked: true, courseLinkSource: 'eduCourseLesson' } },
    { courseRejected: true },
  ])('不可顯示入口，也不提供提示：%j', override => {
    expect(getTeamReservationAction({ event, viewer, generation: 1, ...override }, now)).toBeNull();
  });

  it('俱樂部限定用既有交集；不過濾已授權職員可選的其他俱樂部', () => {
    const limited = { ...event, teamOnly: true, creatorTeamId: 't1' };
    expect(getTeamReservationAction({ event: limited, viewer, generation: 1 }, now)).not.toBeNull();
    expect(getTeamReservationModalState(limited, viewer, 't2')?.selectedTeam.id).toBe('t2');
  });

  it('課程來源須嚴格符合 A 條件，不把 legacy ID 或字串 true 當課程', () => {
    expect(isTeamReservationCourseManaged({ courseLinked: true, courseLinkSource: ' eduCourseLesson ' })).toBe(true);
    expect(isTeamReservationCourseManaged({ courseLinked: 'true', courseLinkSource: 'eduCourseLesson' })).toBe(false);
    expect(isTeamReservationCourseManaged({ courseLinked: true, courseLinkSource: 'other' })).toBe(false);
  });
});

describe('名額與多俱樂部選擇', () => {
  it('照 A 上限公式，重算 remaining，不信任舊摘要的 remainingSlots', () => {
    const state = getTeamReservationModalState(event, viewer, 't1');
    expect(state).toMatchObject({ used: 3, remaining: 5, maxReserved: 10, selectedTeam: { id: 't1' } });
    expect(getTeamReservationModalState(event, viewer, 'missing')?.selectedTeam.id).toBe('t1');
    expect(getTeamReservationModalState(event, { ...viewer, staffTeams: undefined })).toBeNull();
  });

  it.each([
    [40, 30, 3], [0, 30, 33], [28, 0, 3], [-2, -1, 3], [NaN, Infinity, 3],
  ])('current=%s max=%s → maxReserved=%s', (current, max, expected) => {
    expect(getTeamReservationModalState({ ...event, current, max }, viewer)?.maxReserved).toBe(expected);
  });

  it('無摘要新隊有零值保底，課程沒有設定狀態', () => {
    expect(getTeamReservationModalState({ ...event, teamReservationSummaries: [] }, viewer, 't2'))
      .toMatchObject({ summary: { teamId: 't2', reservedSlots: 0 }, used: 0, remaining: 0, maxReserved: 2 });
    expect(getTeamReservationModalState({ ...event, courseLinked: true, courseLinkSource: 'eduCourseLesson' }, viewer)).toBeNull();
  });

  it('多隊保留已用完選項、去重與舊欄位；排除非成員與零名額', () => {
    const choices = getTeamReservationSignupChoices({ ...event, teamReservationSummaries: [
      null, { id: 't1', name: '舊隊名', slots: 3.9, usedSlots: 1 },
      { teamId: 't1', reservedSlots: 99 }, { teamId: 't2', usedSlots: 2 },
      { teamId: 't3', reservedSlots: 10 }, { teamId: 't4', reservedSlots: 0 },
    ] }, { ...viewer, teamIds: new Set(['t1', 't2', 't4']) });
    expect(choices).toEqual([
      { teamId: 't1', teamName: '舊隊名', reservedSlots: 3, usedSlots: 1, remainingSlots: 2 },
      { teamId: 't2', teamName: 't2', reservedSlots: 0, usedSlots: 2, remainingSlots: 0 },
    ]);
  });

  it('零隊、一隊、多隊與合法／非法預選', () => {
    expect(resolveTeamReservationSignupChoice(event, null)).toMatchObject({ teamId: '', requiresSelection: false });
    expect(resolveTeamReservationSignupChoice(event, { ...viewer, uid: null })).toMatchObject({ choices: [] });
    expect(resolveTeamReservationSignupChoice(event, { ...viewer, teamIds: new Set(['t1']) }))
      .toMatchObject({ teamId: 't1', requiresSelection: false });
    expect(resolveTeamReservationSignupChoice(event, viewer)).toMatchObject({ teamId: '', requiresSelection: true });
    expect(resolveTeamReservationSignupChoice(event, viewer, 'other')).toMatchObject({ teamId: '', requiresSelection: true });
    const choice = resolveTeamReservationSignupChoice(event, viewer, ' t2 ');
    expect(choice).toMatchObject({ teamId: 't2', requiresSelection: false });
    expect(buildRegisterPayload({ eventId: event.id!, user: { uid: 'u1' }, preferredTeamReservationTeamId: choice.teamId }))
      .toMatchObject({ preferredTeamReservationTeamId: 't2' });
  });

  it('課程不提供團隊名額選項', () => {
    expect(getTeamReservationSignupChoices({ ...event, courseLinked: true, courseLinkSource: 'eduCourseLesson' }, viewer)).toEqual([]);
  });
});

describe('localStorage 與錯誤保底', () => {
  it('現有名額優先，其次上次輸入，再其次已用名額', () => {
    const local = storage();
    local.getItem.mockReturnValue('12');
    const state = getTeamReservationModalState(event, viewer)!;
    expect(getTeamReservationInitialSlots(state, local)).toBe(8);
    expect(local.getItem).not.toHaveBeenCalled();
    const usedOnly = { ...state, summary: { ...state.summary, reservedSlots: 0 } };
    expect(getTeamReservationInitialSlots(usedOnly, local)).toBe(12);
    expect(local.getItem).toHaveBeenCalledWith('teamReservationSlots:t1');
    for (const value of [null, '', '0', '-1', 'bad', 'Infinity']) {
      local.getItem.mockReturnValue(value);
      expect(getTeamReservationInitialSlots(usedOnly, local)).toBe(3);
    }
    local.getItem.mockImplementation(() => { throw new Error('private storage error'); });
    expect(getTeamReservationInitialSlots(usedOnly, local)).toBe(3);
  });

  it.each([
    [{ code: 'functions/failed-precondition', message: 'RESERVED_BELOW_USED' }, '團隊名額不能低於已使用人數'],
    [{ details: { code: 'RESERVED_OVER_CAPACITY' } }, '團隊名額超過目前活動可用名額'],
    [{ code: 'functions/reserved-below-used' }, '團隊名額不能低於已使用人數'],
    ['RESERVED_OVER_CAPACITY', '團隊名額超過目前活動可用名額'],
    [new Error('secret/raw stack'), '團隊名額調整失敗，請稍後重試'],
    [{ code: 'functions/permission-denied', message: 'PERMISSION_DENIED' }, '團隊名額調整失敗，請稍後重試'],
  ])('只回安全中文：%j', (error, expected) => expect(teamReservationErrorMessage(error)).toBe(expected));
});

describe('Callable 送出與生命週期', () => {
  it.each([[2, '團隊名額不能低於已使用人數'], [11, '團隊名額超過目前活動可用名額'], [Infinity, '團隊名額調整失敗，請稍後重試']])(
    '不合法值 %s 不送出', async (slots, message) => {
      const { controller, local } = fixture();
      expect(await controller.submit('t1', slots)).toEqual({ status: 'error', message });
      expect(callFn).not.toHaveBeenCalled();
      expect(local.setItem).not.toHaveBeenCalled();
    },
  );

  it('合法值只送一次、整數化、public ID、截斷安全 requestId；只回傳允許的 patch，零直接讀寫', async () => {
    vi.mocked(callFn).mockResolvedValue({
      success: true, event: { ...occupancy, id: 'wrong', title: 'wrong' },
      promoted: promoted.map(item => ({ ...item, status: 'cancelled', eventId: 'wrong', extra: 'private' })),
    });
    const { controller, local } = fixture();
    expect(await controller.submit('t1', '7.9')).toEqual({ status: 'success', deduplicated: false, eventPatch: occupancy, promoted, message: '已更新團隊名額' });
    expect(callFn).toHaveBeenCalledExactlyOnceWith('adjustTeamReservation', {
      eventId: 'event-public', teamId: 't1', reservedSlots: 7, requestId: 'team_res_' + now + '_abc_u1_event-public_t1',
    });
    expect(local.setItem).toHaveBeenCalledExactlyOnceWith('teamReservationSlots:t1', '7');
    for (const io of [getFirebase, getDoc, getDocs, setDoc, updateDoc]) expect(io).not.toHaveBeenCalled();
    expect(event.current).toBe(28);
  });

  it.each([[33, 23], [128, 128]])('長 UID（%s）與 ID（%s）：後端截 100 字後時間與亂數仍可區分操作', async (uidLength, idLength) => {
    const uid = 'U' + 'a'.repeat(uidLength - 1);
    const eventId = 'evt_' + 'e'.repeat(idLength - 4);
    const teamId = 'team_' + 't'.repeat(idLength - 5);
    let clock = now;
    let suffix = 'abc';
    const controller = createTeamReservationController(() => ({
      event: { ...event, id: eventId, current: 0, teamReservationSummaries: [] },
      viewer: { uid, teamIds: new Set([teamId]), staffTeams: [{ id: teamId, name: '長 ID 隊' }] },
      generation: 1,
    }), { storage: storage(), now: () => clock, randomSuffix: () => suffix });
    const seen = new Set<string>();
    vi.mocked(callFn).mockImplementation(async (_name, payload) => {
      const key = String((payload as { requestId: string }).requestId).slice(0, 100);
      if (seen.has(key)) return { success: true, deduplicated: true };
      seen.add(key);
      return { success: true, event: occupancy, promoted: [] };
    });
    expect(await controller.submit(teamId, 1)).toMatchObject({ status: 'success', deduplicated: false });
    suffix = 'xyz'; // 同毫秒的第二次操作：只改亂數也不能被去重。
    expect(await controller.submit(teamId, 2)).toMatchObject({ status: 'success', deduplicated: false });
    clock += 2000; // 同亂數的下一次操作：只改時間也不能被去重。
    expect(await controller.submit(teamId, 3)).toMatchObject({ status: 'success', deduplicated: false });
    const ids = vi.mocked(callFn).mock.calls.map(([, payload]) => (payload as { requestId: string }).requestId);
    expect(new Set(ids.map(id => id.slice(0, 100))).size).toBe(3);
    for (const id of ids) expect(id.length).toBeLessThanOrEqual(100);
    expect(ids[0]!.slice(0, 100)).toContain(String(now));
    expect(ids[1]!.slice(0, 100)).toContain('xyz');
    expect(ids[2]!.slice(0, 100)).toContain(String(now + 2000));
    expect(callFn).toHaveBeenCalledTimes(3);
    for (const io of [getFirebase, getDoc, getDocs, setDoc, updateDoc]) expect(io).not.toHaveBeenCalled();
  });

  it.each([undefined, null, 7, 'private/raw', {}, []].map(value => ({ value })))(
    '缺少、非陣列或空 promoted 不改變成功結果：$value', async ({ value }) => {
      vi.mocked(callFn).mockResolvedValue({ success: true, event: occupancy, promoted: value });
      const { controller } = fixture();
      expect(await controller.submit('t1', 7)).toEqual({
        status: 'success', deduplicated: false, eventPatch: occupancy, promoted: [], message: '已更新團隊名額',
      });
      expect(callFn).toHaveBeenCalledTimes(1);
    },
  );

  it('逐筆丟棄缺少報名 ID、錯誤型別或非法席位的 promoted，不影響合法項目與成功訊息', async () => {
    const valid = promoted[0]!;
    vi.mocked(callFn).mockResolvedValue({ success: true, event: occupancy, promoted: [
      null, [], 'private/raw', 1, {},
      { userId: valid.userId, userName: valid.userName },
      { ...valid, id: ' ', docId: '' },
      { ...valid, id: 123 }, { ...valid, docId: {} },
      { ...valid, userId: {} }, { ...valid, userName: ['private/raw'] },
      { ...valid, teamSeatSource: 'private/raw' }, { ...valid, teamSeatSource: 'waitlist' },
      { ...valid, teamSeatSource: 1 },
      valid,
      { id: 'id-only', userId: valid.userId, userName: valid.userName, teamSeatSource: 'overflow' },
      { docId: 'doc-only', teamSeatSource: null },
      { id: 'no-seat-source' },
    ] });
    const { controller } = fixture();
    expect(await controller.submit('t1', 7)).toEqual({
      status: 'success', deduplicated: false, eventPatch: occupancy, message: '已更新團隊名額',
      promoted: [
        valid,
        { id: 'id-only', docId: '', userId: valid.userId, userName: valid.userName, teamSeatSource: 'overflow' },
        { id: '', docId: 'doc-only', userId: '', userName: '', teamSeatSource: null },
        { id: 'no-seat-source', docId: '', userId: '', userName: '', teamSeatSource: null },
      ],
    });
    expect(controller.isPending(event.id!, 't1')).toBe(false);
    expect(callFn).toHaveBeenCalledTimes(1);
    for (const io of [getFirebase, getDoc, getDocs, setDoc, updateDoc]) expect(io).not.toHaveBeenCalled();
  });

  it.each([['docId', true], ['id', true], ['docId', false], ['id', false]] as const)(
    '已有正取＋候補遞補＋名額立即用完：依 %s、原有團隊標記 %s 同步名單與標頭', async (matchBy, tagged) => {
    const initialEvent = {
      ...event, current: 1, realCurrent: 1, waitlist: 1, max: 2, teamReservationSummaries: [],
      participants: ['原正取'], participantsWithUid: [{ uid: 'confirmed', name: '原正取' }],
      waitlistNames: ['遞補者'], waitlistWithUid: [{ uid: 'waiting', name: '遞補者' }],
    };
    const registrations = [
      { id: 'reg-confirmed', _docId: 'confirmed-doc', userId: 'confirmed', userName: '原正取', status: 'confirmed', participantType: 'self' },
      {
        id: 'reg-wait', _docId: 'wait-doc', userId: 'waiting', userName: '遞補者', status: 'waitlisted', participantType: 'self',
        ...(tagged ? { teamReservationTeamId: 't1', teamReservationTeamName: '一隊' } : {}),
        teamSeatSource: 'waitlist',
      },
    ] satisfies RosterRegistrationInput[];
    const fullOccupancy = {
      current: 2, realCurrent: 2, waitlist: 0, status: 'full',
      participants: ['原正取', '遞補者'], waitlistNames: [], waitlistWithUid: [],
      participantsWithUid: [
        { uid: 'confirmed', name: '原正取' },
        { uid: 'waiting', name: '遞補者', teamReservationTeamId: 't1', teamReservationTeamName: '一隊', teamSeatSource: 'reserved' },
      ],
      teamReservationSummaries: [{ teamId: 't1', teamName: '一隊', reservedSlots: 1, usedSlots: 1, remainingSlots: 0, occupiedSlots: 1 }],
    };
    vi.mocked(callFn).mockResolvedValue({ success: true, event: fullOccupancy, promoted: [{
      id: matchBy === 'id' ? 'reg-wait' : null, docId: matchBy === 'docId' ? 'wait-doc' : '',
      userId: 'waiting', userName: '遞補者', teamSeatSource: 'reserved',
    }] });
    const { controller, setSnapshot } = fixture();
    setSnapshot({ event: initialEvent, viewer, generation: 1 });
    const result = await controller.submit('t1', 1);
    expect(result).toMatchObject({ status: 'success', deduplicated: false, eventPatch: fullOccupancy });
    if (result.status !== 'success' || result.deduplicated) throw new Error('expected a fresh success');
    const nextEvent = { ...initialEvent, ...result.eventPatch };

    // 舊行為只套活動摘要：正取仍缺人、候補殘留，而且用完名額的俱樂部標頭消失。
    const staleRoster = buildConfirmedRoster(nextEvent, registrations);
    expect(staleRoster.realCount).toBe(1);
    expect(staleRoster.people.some(person => person.isTeamHeader)).toBe(false);
    expect(buildWaitlistRoster(nextEvent, registrations).totalCount).toBe(1);

    // 使用頁面真正的同步函式；歸屬只來自本次回傳，不另讀 Firestore。
    const nextRegistrations = applyReservationPromotions(
      registrations, result.promoted, initialEvent.id!, result.eventPatch.participantsWithUid,
    );
    expect(nextRegistrations[0]).toBe(registrations[0]);
    expect(nextRegistrations[1]).toMatchObject({
      status: 'confirmed', teamSeatSource: 'reserved', teamReservationTeamId: 't1', teamReservationTeamName: '一隊',
    });
    expect(registrations[1]).toMatchObject({ status: 'waitlisted', teamSeatSource: 'waitlist' });
    const roster = buildConfirmedRoster(nextEvent, nextRegistrations);
    expect(roster.realCount).toBe(nextEvent.realCurrent);
    expect(roster.count).toBe(nextEvent.current);
    expect(roster.people.filter(person => person.hasSelfReg).map(person => person.uid).sort()).toEqual(['confirmed', 'waiting']);
    expect(roster.people.find(person => person.isTeamHeader)).toMatchObject({
      teamReservationTeamId: 't1', reservedSlots: 1, usedSlots: 1, remainingSlots: 0,
    });
    expect(roster.people.find(person => person.uid === 'waiting')).toMatchObject({ teamSeatSource: 'reserved' });
    expect(roster.people.some(person => person.isTeamPlaceholder)).toBe(false);
    expect(buildWaitlistRoster(nextEvent, nextRegistrations)).toEqual({ items: [], totalCount: 0 });
    expect(getTeamReservationModalState(nextEvent, viewer, 't1')).toMatchObject({ used: 1, remaining: 0, maxReserved: 1 });
    expect(callFn).toHaveBeenCalledTimes(1);
    for (const io of [getFirebase, getDoc, getDocs, setDoc, updateDoc]) expect(io).not.toHaveBeenCalled();
  });

  it('零名額取消與 storage 寫入失敗皆可送出', async () => {
    const { controller, local, setSnapshot } = fixture();
    local.setItem.mockImplementation(() => { throw new Error('private storage error'); });
    setSnapshot({ event: { ...event, teamReservationSummaries: [] }, viewer, generation: 1 });
    expect(await controller.submit('t1', 0)).toMatchObject({ status: 'success', message: '已取消團隊名額' });
    expect(callFn).toHaveBeenCalledTimes(1);
  });

  it('非法俱樂部、非職員或載入中不送出', async () => {
    const { controller, setSnapshot } = fixture();
    expect(await controller.submit('other', 3)).toMatchObject({ status: 'error' });
    setSnapshot({ event, viewer: { ...viewer, staffTeams: [] }, generation: 1 });
    expect(await controller.submit('t1', 3)).toMatchObject({ status: 'error' });
    setSnapshot({ event, viewer, loading: true, generation: 1 });
    expect(await controller.submit('t1', 3)).toMatchObject({ status: 'error' });
    expect(callFn).not.toHaveBeenCalled();
  });

  it('連點同一活動俱樂部只有一個 Callable；完成解除 busy', async () => {
    let finish!: (value: { success: boolean; event: typeof occupancy; promoted: typeof promoted }) => void;
    vi.mocked(callFn).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { controller } = fixture();
    const first = controller.submit('t1', 7);
    expect(controller.isPending(event.id!, 't1')).toBe(true);
    expect(await controller.submit('t1', 7)).toEqual({ status: 'busy', message: '團隊名額處理中，請稍候' });
    expect(callFn).toHaveBeenCalledTimes(1);
    finish({ success: true, event: occupancy, promoted });
    await first;
    expect(controller.isPending(event.id!, 't1')).toBe(false);
  });

  it.each([
    null,
    { event: { ...event, id: 'other' }, viewer, generation: 1 },
    { event, viewer: { ...viewer, uid: 'other' }, generation: 1 },
    { event, viewer, generation: 3 },
  ])('離頁／換活動／換帳號／世代往返後丟棄回應：%j', async next => {
    let finish!: (value: { success: boolean; event: typeof occupancy; promoted: typeof promoted }) => void;
    vi.mocked(callFn).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { controller, setSnapshot } = fixture();
    const pending = controller.submit('t1', 7);
    setSnapshot(next);
    finish({ success: true, event: occupancy, promoted });
    expect(await pending).toEqual({ status: 'ignored', message: '' });
    expect(controller.isPending(event.id!, 't1')).toBe(false);
  });

  it('過期的失敗也不提示，鎖仍釋放', async () => {
    let fail!: (reason: unknown) => void;
    vi.mocked(callFn).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    const { controller, setSnapshot } = fixture();
    const pending = controller.submit('t1', 7);
    setSnapshot(null);
    fail(new Error('private/raw'));
    expect(await pending).toEqual({ status: 'ignored', message: '' });
    expect(controller.isPending(event.id!, 't1')).toBe(false);
  });

  it('deduplicated 是成功但無 patch，不覆寫也不重讀', async () => {
    vi.mocked(callFn).mockResolvedValue({ success: true, deduplicated: true, event: occupancy, promoted });
    const { controller } = fixture();
    expect(await controller.submit('t1', 7)).toEqual({ status: 'success', deduplicated: true, message: '團隊名額處理中，請稍候' });
    expect(getDoc).not.toHaveBeenCalled();
    expect(getDocs).not.toHaveBeenCalled();
  });

  it.each([
    ['RESERVED_BELOW_USED', '團隊名額不能低於已使用人數'],
    ['RESERVED_OVER_CAPACITY', '團隊名額超過目前活動可用名額'],
    ['raw private error', '團隊名額調整失敗，請稍後重試'],
  ])('伺服器錯誤安全回傳並解鎖：%s', async (code, message) => {
    vi.mocked(callFn).mockRejectedValueOnce(new Error(code));
    const { controller } = fixture();
    expect(await controller.submit('t1', 7)).toEqual({ status: 'error', message });
    expect(controller.isPending(event.id!, 't1')).toBe(false);
    expect(callFn).toHaveBeenCalledTimes(1);
    expect(getDoc).not.toHaveBeenCalled();
  });

  it.each([{}, { success: false }, { success: true }, { success: true, event: { current: 2 } },
    { success: true, event: { ...occupancy, current: NaN } }])('損壞回應不覆寫、不重送或重讀：%j', async response => {
    vi.mocked(callFn).mockResolvedValue(response);
    const { controller } = fixture();
    expect(await controller.submit('t1', 7)).toEqual({ status: 'error', message: '團隊名額調整失敗，請稍後重試' });
    expect(callFn).toHaveBeenCalledTimes(1);
    expect(getDoc).not.toHaveBeenCalled();
    expect(getDocs).not.toHaveBeenCalled();
  });

  it('課程活動零呼叫、無提示；伺服器課程拒絕也不重送', async () => {
    const { controller, setSnapshot } = fixture();
    setSnapshot({ event: { ...event, courseLinked: true, courseLinkSource: 'eduCourseLesson' }, viewer, generation: 1 });
    expect(await controller.submit('t1', 7)).toEqual({ status: 'course-managed', message: '' });
    expect(callFn).not.toHaveBeenCalled();
    setSnapshot({ event, viewer, generation: 1 });
    vi.mocked(callFn).mockRejectedValueOnce(new Error('COURSE_LINKED_EVENT_MANAGED_BY_COURSE'));
    expect(await controller.submit('t1', 7)).toEqual({ status: 'course-managed', message: '' });
    expect(await controller.submit('t1', 7)).toEqual({ status: 'course-managed', message: '' });
    expect(callFn).toHaveBeenCalledTimes(1);
  });
});

/** O5：先讓登入者全歷史快取命中一次，回傳「再讀一次後 loader 共被呼叫幾次」。 */
async function primeViewerCache(): Promise<() => Promise<number>> {
  invalidateViewerRegistrations();
  const loader = vi.fn(async () => []);
  await readViewerRegistrationsCached('viewer-o5', loader);
  await readViewerRegistrationsCached('viewer-o5', loader);
  expect(loader).toHaveBeenCalledTimes(1);
  return async () => {
    await readViewerRegistrationsCached('viewer-o5', loader);
    return loader.mock.calls.length;
  };
}

describe('O5：團隊名額送出後失效登入者全歷史快取', () => {
  it('成功後失效', async () => {
    const { controller } = fixture();
    const readAgain = await primeViewerCache();
    expect(await controller.submit('t1', 7)).toMatchObject({ status: 'success' });
    expect(await readAgain()).toBe(2);
  });

  it('失敗後也失效（伺服器可能已寫入）', async () => {
    vi.mocked(callFn).mockRejectedValueOnce(new Error('raw private error'));
    const { controller } = fixture();
    const readAgain = await primeViewerCache();
    expect(await controller.submit('t1', 7)).toMatchObject({ status: 'error' });
    expect(await readAgain()).toBe(2);
  });

  it('沒送出（前端預檢擋下）不失效', async () => {
    const { controller } = fixture();
    const readAgain = await primeViewerCache();
    expect(await controller.submit('t1', 2)).toMatchObject({ status: 'error' });
    expect(callFn).not.toHaveBeenCalled();
    expect(await readAgain()).toBe(1);
  });
});
