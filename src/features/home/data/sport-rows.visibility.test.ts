import { afterEach, describe, expect, it } from 'vitest';
import type { EventDoc, ViewerContext } from '@/features/events/data/types';
import { getVisibleEvents } from '@/features/events/data/visibility';
import { SPORTS_SNAPSHOT_KEY, _clearHomeSnapshotForTest, writeSportsSnapshot } from './home-snapshot';
import { computeGuestSportRows, computeSportRows } from './sport-rows';

// 用「真實」的可見性規則（不是替身）驗證首屏快照的訪客視角：
// `isPublicActiveHomeEvent` 只排除 privateEvent／teamOnly 嚴格等於 true 的活動；
// 舊資料若把旗標存成真值但不是 true（字串 'true'、數字 1…），只有 `getVisibleEvents` 的權限守門才排除得掉——
// 管理員看得到這些活動（畫面會計入），訪客視角（快照）一定不能計入。

const NOW = Date.UTC(2026, 9, 27, 3, 0, 0);

function ev(id: string, sportTag: string, extra: Record<string, unknown> = {}): EventDoc {
  return { id, status: 'open', date: '2030/10/20 18:00~20:00', sportTag, ...extra } as EventDoc;
}

const ADMIN: ViewerContext = { uid: 'admin1', teamIds: new Set(), roleLevel: 4, hasPermission: () => true };

const EVENTS: EventDoc[] = [
  ev('public-football', 'football'),
  ev('public-basketball', 'basketball'),
  // 只有權限守門才排除得掉（旗標是真值但不是 true）
  ev('private-string', 'tennis', { privateEvent: 'true', creatorUid: 'someone' }),
  ev('private-number', 'tennis', { privateEvent: 1, creatorUid: 'someone' }),
  ev('team-only-number', 'volleyball', { teamOnly: 1, creatorUid: 'someone', creatorTeamId: 't1' }),
  // 兩道規則都會排除
  ev('private-true', 'running', { privateEvent: true, creatorUid: 'someone' }),
  ev('team-only-true', 'cycling', { teamOnly: true, creatorUid: 'someone', creatorTeamId: 't1' }),
];

afterEach(() => {
  _clearHomeSnapshotForTest();
});

describe('首屏快照的訪客視角（真實可見性規則）', () => {
  it('這組活動確實能分出「只有權限守門排除得掉」的案例：管理員的統計會計入，訪客視角不會', () => {
    const adminRows = computeSportRows(getVisibleEvents(EVENTS, ADMIN, []), NOW);
    const adminKeys = adminRows.map((r) => r.key);
    expect(adminKeys).toContain('tennis');
    expect(adminKeys).toContain('volleyball');

    const guestKeys = computeGuestSportRows(EVENTS, NOW).map((r) => r.key);
    expect(guestKeys.sort()).toEqual(['basketball', 'football']);
  });

  it('最後寫進 localStorage 的內容也只有訪客可見的運動與數量', () => {
    writeSportsSnapshot(computeGuestSportRows(EVENTS, NOW), NOW);
    const stored = JSON.parse(localStorage.getItem(SPORTS_SNAPSHOT_KEY) as string) as { items: Array<{ key: string; count: number }> };
    expect(stored.items).toEqual([
      { key: 'football', count: 1 },
      { key: 'basketball', count: 1 },
    ]);
    const raw = localStorage.getItem(SPORTS_SNAPSHOT_KEY) as string;
    for (const leaked of ['tennis', 'volleyball', 'running', 'cycling', 'someone', 'privateEvent', 'teamOnly']) {
      expect(raw).not.toContain(leaked);
    }
  });
});
