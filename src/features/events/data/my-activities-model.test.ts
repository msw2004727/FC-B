import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createMinimalViewer, type ViewerView } from '@/features/profile/data/viewer';
import type { EventDoc } from './types';
import {
  MY_ACTIVITY_DEFAULT_PAGE_SIZE,
  MY_ACTIVITY_TABS,
  filterManageableEvents,
  getMyActivityPagingKey,
  getMyActivityVisibleLimit,
  progressTone,
  sortMyActivitiesByNearestTime,
  effectiveEventStatus,
} from './my-activities-model';

// 測試同步更新（R-QA-005）：列表改用 A 的有效狀態（開始時間已過＝已結束），固定現在時間在測試資料日期之前。
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-05-01T00:00:00+08:00'));
});
afterEach(() => {
  vi.useRealTimers();
});


function makeViewer(overrides: Partial<ViewerView> = {}): ViewerView {
  const base = createMinimalViewer('u-viewer');
  return {
    ...base,
    ...overrides,
  };
}

function makeAdminViewer(uid = 'u-admin', roleLevel = 4): ViewerView {
  return makeViewer({
    uid,
    role: roleLevel >= 4 ? 'admin' : 'coach',
    roleLevel,
    hasPermission: (code) => code === 'event.edit_all',
    permissionSources: {
      rolePermissions: ['event.edit_all'],
      userGrants: [],
      customRoles: [],
    },
  });
}

describe('MY_ACTIVITY_TABS', () => {
  it('matches legacy A tab order and ids', () => {
    expect(MY_ACTIVITY_TABS.map((t) => t.id)).toEqual([
      'all',
      'upcoming',
      'open',
      'full',
      'ended',
      'cancelled',
    ]);
  });
});

describe('filterManageableEvents', () => {
  const sampleEvents = [
    { id: 'e-own-creator', status: 'open', date: '2026/06/01 10:00~12:00', creatorUid: 'u-viewer' },
    { id: 'e-own-owner', status: 'upcoming', date: '2026/06/01 10:00~12:00', regOpenTime: '2026-05-20T10:00', ownerUid: 'u-viewer' },
    { id: 'e-own-captain', status: 'full', date: '2026/06/01 10:00~12:00', current: 10, max: 10, captainUid: 'u-viewer' },
    { id: 'e-delegate', status: 'ended', creatorUid: 'u-other', delegateUids: ['u-viewer'] },
    { id: 'e-other', status: 'open', date: '2026/06/01 10:00~12:00', creatorUid: 'u-other' },
    { id: 'e-private-other', status: 'cancelled', creatorUid: 'u-other', privateEvent: true },
    { id: 'e-private-own', status: 'open', date: '2026/06/01 10:00~12:00', creatorUid: 'u-viewer', privateEvent: true },
  ] as EventDoc[];

  it('allows admin with event.edit_all and roleLevel >= 4 to see all events including private', () => {
    const admin = makeAdminViewer('u-admin', 4);
    const result = filterManageableEvents(sampleEvents, admin, 'all');
    expect(result.map((e) => e.id)).toEqual([
      'e-own-creator',
      'e-own-owner',
      'e-own-captain',
      'e-delegate',
      'e-other',
      'e-private-other',
      'e-private-own',
    ]);
  });

  it('filters out private events of others when viewer has event.edit_all but roleLevel < 4', () => {
    const editorBelowAdmin = makeAdminViewer('u-coach-all', 1);
    const result = filterManageableEvents(sampleEvents, editorBelowAdmin, 'all');
    expect(result.map((e) => e.id)).not.toContain('e-private-other');
    expect(result.map((e) => e.id)).toContain('e-other');
  });

  it('restricts non-admin viewer to own (creatorUid/ownerUid/captainUid) or delegate events', () => {
    const viewer = makeViewer({ uid: 'u-viewer', role: 'coach', roleLevel: 1 });
    const result = filterManageableEvents(sampleEvents, viewer, 'all');
    expect(result.map((e) => e.id)).toEqual([
      'e-own-creator',
      'e-own-owner',
      'e-own-captain',
      'e-delegate',
      'e-private-own',
    ]);
  });

  it('filters by exact status for each non-all tab', () => {
    const admin = makeAdminViewer('u-admin', 4);
    expect(filterManageableEvents(sampleEvents, admin, 'upcoming').map((e) => e.id)).toEqual([
      'e-own-owner',
    ]);
    expect(filterManageableEvents(sampleEvents, admin, 'open').map((e) => e.id)).toEqual([
      'e-own-creator',
      'e-other',
      'e-private-own',
    ]);
    expect(filterManageableEvents(sampleEvents, admin, 'full').map((e) => e.id)).toEqual([
      'e-own-captain',
    ]);
    expect(filterManageableEvents(sampleEvents, admin, 'ended').map((e) => e.id)).toEqual([
      'e-delegate',
    ]);
    expect(filterManageableEvents(sampleEvents, admin, 'cancelled').map((e) => e.id)).toEqual([
      'e-private-other',
    ]);
  });
});

describe('sortMyActivitiesByNearestTime (golden against A _sortMyActivitiesByNearestTime)', () => {
  const now = Date.parse('2026-05-10T12:00:00+08:00'); // 2026/05/10 12:00

  it('orders active events before terminal, nearer start time first, earlier start tie-breaker, then id localeCompare', () => {
    const input: EventDoc[] = [
      { id: 'e-ended-near', status: 'ended', date: '2026/05/10 11:00~13:00' },
      { id: 'e-open-far', status: 'open', date: '2026/05/15 12:00~14:00' },
      { id: 'e-open-after-2h', status: 'open', date: '2026/05/10 14:00~16:00' },
      { id: 'e-upcoming-before-2h', status: 'upcoming', date: '2026/05/10 10:00~12:00' },
      { id: 'e-full-tie-b', status: 'full', date: '2026/05/10 13:00~15:00' },
      { id: 'e-full-tie-a', status: 'full', date: '2026/05/10 13:00~15:00' },
      { id: 'e-cancelled-far', status: 'cancelled', date: '2026/05/01 12:00~14:00' },
      { id: 'e-no-date', status: 'open' },
    ];

    const sorted = sortMyActivitiesByNearestTime(input, now);
    expect(sorted.map((e) => e.id)).toEqual([
      // 距離 1h，同時間依 id 排：a 在 b 前
      'e-full-tie-a',
      'e-full-tie-b',
      // 距離皆 2h（10:00 vs 14:00），較早開始的 10:00 在前
      'e-upcoming-before-2h',
      'e-open-after-2h',
      // 距離 5 天
      'e-open-far',
      // 無日期（MAX_SAFE_INTEGER），但仍是 active 所以在 terminal 之前
      'e-no-date',
      // terminal（ended/cancelled）排最後，內部同樣依距離現在遠近排序
      'e-ended-near',
      'e-cancelled-far',
    ]);
  });

  it('places pinned events first and orders multiple pinned events by pinOrder', () => {
    const input: Array<EventDoc & { pinned?: boolean; pinOrder?: number }> = [
      { id: 'e-normal', status: 'open', date: '2026/05/10 12:30~14:00' },
      { id: 'e-pin-2', status: 'open', date: '2026/05/20 12:00~14:00', pinned: true, pinOrder: 2 },
      { id: 'e-pin-1', status: 'ended', date: '2026/05/01 12:00~14:00', pinned: true, pinOrder: 1 },
    ];
    const sorted = sortMyActivitiesByNearestTime(input, now);
    expect(sorted.map((e) => e.id)).toEqual(['e-pin-1', 'e-pin-2', 'e-normal']);
  });
});

describe('getMyActivityVisibleLimit & progressTone', () => {
  it('returns default page size when no custom count is recorded and respects recorded count', () => {
    expect(getMyActivityVisibleLimit('all')).toBe(MY_ACTIVITY_DEFAULT_PAGE_SIZE);
    const key = getMyActivityPagingKey('ended', '');
    expect(getMyActivityVisibleLimit('ended', { [key]: 25 }, 10)).toBe(25);
    expect(getMyActivityVisibleLimit('ended', { [key]: 5 }, 10)).toBe(10);
  });

  it('computes progressTone thresholds matching legacy A (>=100 danger, >=70 warning, else success)', () => {
    expect(progressTone(0)).toBe('success');
    expect(progressTone(69)).toBe('success');
    expect(progressTone(70)).toBe('warning');
    expect(progressTone(99)).toBe('warning');
    expect(progressTone(100)).toBe('danger');
    expect(progressTone(120)).toBe('danger');
  });
});

describe('有效狀態（照 A _getEventEffectiveStatus／_autoEndExpiredEvents，只算不寫）', () => {
  const now = Date.parse('2026-06-01T12:00:00+08:00');
  it('已取消／已結束照舊；開始時間已過算已結束；報名開放在未來算即將開放；額滿算已額滿', () => {
    expect(effectiveEventStatus({ id: 'a', status: 'cancelled', date: '2026/07/01 10:00~12:00' } as EventDoc, now)).toBe('cancelled');
    expect(effectiveEventStatus({ id: 'b', status: 'open', date: '2026/05/01 10:00~12:00' } as EventDoc, now)).toBe('ended');
    expect(effectiveEventStatus({ id: 'c', status: 'open', date: '2026/07/01 10:00~12:00', regOpenTime: '2026-06-10T10:00' } as EventDoc, now)).toBe('upcoming');
    expect(effectiveEventStatus({ id: 'd', status: 'open', date: '2026/07/01 10:00~12:00', current: 20, max: 20 } as EventDoc, now)).toBe('full');
    expect(effectiveEventStatus({ id: 'e', status: 'upcoming', date: '2026/07/01 10:00~12:00', current: 3, max: 20 } as EventDoc, now)).toBe('open');
  });

  it('regOpenTime 2026-10-19T09:00：遠未來活動在 08:59+08 為 upcoming，09:00+08 起為 open', () => {
    const event = {
      id: 'far',
      status: 'open',
      date: '2099/01/01 10:00~12:00',
      regOpenTime: '2026-10-19T09:00',
    } as EventDoc;
    expect(effectiveEventStatus(event, Date.parse('2026-10-19T08:59:00+08:00'))).toBe('upcoming');
    expect(effectiveEventStatus(event, Date.parse('2026-10-19T09:00:00+08:00'))).toBe('open');
  });

  it('無效 regOpenTime 不判 upcoming', () => {
    const event = {
      id: 'bad',
      status: 'open',
      date: '2099/01/01 10:00~12:00',
      regOpenTime: 'nope',
    } as EventDoc;
    expect(effectiveEventStatus(event, Date.parse('2026-10-19T08:59:00+08:00'))).toBe('open');
  });
});


describe('T-054c M1 狀態邊界', () => {
  it('起點當下轉 ended，regOpen 當下不再 upcoming', () => {
    const event = { id: 'evtA', status: 'open', date: '2026/10/19 11:00~13:00', regOpenTime: '2026-10-19T09:00' } as EventDoc;
    expect(effectiveEventStatus(event, Date.parse('2026-10-19T08:59:59.999+08:00'))).toBe('upcoming');
    expect(effectiveEventStatus(event, Date.parse('2026-10-19T09:00:00+08:00'))).toBe('open');
    expect(effectiveEventStatus(event, Date.parse('2026-10-19T10:59:59.999+08:00'))).toBe('open');
    expect(effectiveEventStatus(event, Date.parse('2026-10-19T11:00:00+08:00'))).toBe('ended');
  });

  it('G4 對照：非字串 regOpenTime 不判 upcoming', () => {
    for (const regOpenTime of [Date.parse('2026-10-20T09:00:00+08:00'), { toMillis: () => Date.parse('2026-10-20T09:00:00+08:00') }]) {
      const event = { id: 'evtA', status: 'open', date: '2026/10/19 11:00~13:00', regOpenTime } as unknown as EventDoc;
      expect(effectiveEventStatus(event, Date.parse('2026-10-19T09:00:00+08:00'))).toBe('open');
    }
  });
});
