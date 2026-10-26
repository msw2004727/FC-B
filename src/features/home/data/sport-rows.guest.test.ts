import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventDoc, ViewerContext } from '@/features/events/data/types';

// 首屏快照的運動統計一定要經過 getVisibleEvents 的權限守門，而且用的是「訪客」視角（沒有帳號、沒有權限、沒有俱樂部）。
// 對訪客來說，getVisibleEvents 排除的活動（私密、俱樂部限定）本來就被 isPublicActiveHomeEvent 排除，所以用真實函式分不出守門有沒有接上；
// 這裡把 getVisibleEvents 換成「只有權限守門才會排除」的替身，直接證明：①它被呼叫了 ②傳進去的是訪客視角 ③它排除的活動不進統計。
const getVisibleEvents = vi.fn<(events: readonly EventDoc[], viewer: ViewerContext, regs: readonly unknown[]) => EventDoc[]>();
vi.mock('@/features/events/data/visibility', () => ({
  getVisibleEvents: (events: readonly EventDoc[], viewer: ViewerContext, regs: readonly unknown[]) =>
    getVisibleEvents(events, viewer, regs),
}));

const { computeGuestSportRows, GUEST_VIEWER } = await import('./sport-rows');

const NOW = Date.UTC(2026, 9, 27, 3, 0, 0);

function ev(id: string, extra: Record<string, unknown> = {}): EventDoc {
  return { id, status: 'open', date: '2030/10/20 18:00~20:00', sportTag: 'football', ...extra } as EventDoc;
}

beforeEach(() => {
  getVisibleEvents.mockReset();
});

describe('computeGuestSportRows 的權限守門', () => {
  it('以訪客視角呼叫 getVisibleEvents，被它排除的活動不進統計', () => {
    getVisibleEvents.mockImplementation((events) => events.filter((e) => e.id !== 'admin-only'));

    const rows = computeGuestSportRows([ev('a'), ev('admin-only'), ev('b')], NOW);

    expect(rows.map((r) => [r.key, r.count])).toEqual([['football', 2]]);
    expect(getVisibleEvents).toHaveBeenCalledTimes(1);
    const [, viewer, registrations] = getVisibleEvents.mock.calls[0] ?? [];
    expect(viewer).toBe(GUEST_VIEWER);
    expect(viewer?.uid).toBeNull();
    expect(viewer?.roleLevel).toBe(0);
    expect(viewer?.teamIds.size).toBe(0);
    expect(viewer?.hasPermission('event.edit_all')).toBe(false);
    expect(registrations).toEqual([]);
  });
});
