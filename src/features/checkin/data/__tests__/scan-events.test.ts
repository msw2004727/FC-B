/**
 * scan-events.ts 測試。
 *
 * 目標：
 *  - 只列出 `canOperateEventSite === true` 的活動（R-IAM-010）。
 *  - 分類／排序照 A `_categorizeScanEvents`。
 *  - public id ≠ docId 的舊活動：value/eventId = public id，docId 保留。
 */

import { describe, expect, it } from 'vitest';

import { loadScanEvents, pickScanBucket } from '../scan-events';
import type { EventDoc } from '@/features/events/data/types';
import type { OperateContext } from '@/features/events/data/operate-permissions';

/** owner + site_operate：canOperateEventSite 會回 true。 */
function ownerContext(uid: string): OperateContext {
  return {
    uid,
    role: 'user',
    rolePermissions: [],
    userGrants: null,
    capabilities: ['user.activity.site_operate'],
    customRoles: [],
  };
}

/** 非 owner、非 delegate、無 site 權限：canOperateEventSite 應為 false。 */
function visitorContext(uid: string): OperateContext {
  return {
    uid,
    role: 'user',
    rolePermissions: [],
    userGrants: null,
    capabilities: [],
    customRoles: [],
  };
}

const NOW = new Date(2026, 4, 9, 10, 0, 0); // 2026-05-09 10:00 本地時間

function event(over: Partial<EventDoc>): EventDoc {
  return { ...over };
}

describe('loadScanEvents', () => {
  it('只列出 canOperateEventSite 為 true 的活動', () => {
    const buckets = loadScanEvents({
      context: ownerContext('u1'),
      now: NOW,
      events: [
        event({ id: 'evt_mine', _docId: 'evt_mine', title: 'Mine', date: '2026/05/09 10:00~12:00', creatorUid: 'u1' }),
        event({ id: 'evt_other', _docId: 'evt_other', title: 'Other', date: '2026/05/09 10:00~12:00', creatorUid: 'u2' }),
      ],
    });
    const all = [...buckets.today, ...buckets.past, ...buckets.future];
    expect(all.map((e) => e.eventId)).toEqual(['evt_mine']);
  });

  it('非 owner 且無權限的 activity 不會出現', () => {
    const buckets = loadScanEvents({
      context: visitorContext('u3'),
      now: NOW,
      events: [
        event({ id: 'evt_other', _docId: 'evt_other', date: '2026/05/09 10:00~12:00', creatorUid: 'u2' }),
      ],
    });
    expect([...buckets.today, ...buckets.past, ...buckets.future]).toHaveLength(0);
  });

  it('today / past / future 分類與排序照 A', () => {
    const buckets = loadScanEvents({
      context: ownerContext('u1'),
      now: NOW,
      events: [
        event({ id: 'e_past_1', _docId: 'e_past_1', date: '2026/05/01 10:00~12:00', creatorUid: 'u1' }),
        event({ id: 'e_past_2', _docId: 'e_past_2', date: '2026/05/05 10:00~12:00', creatorUid: 'u1' }),
        event({ id: 'e_today_1', _docId: 'e_today_1', date: '2026/05/09 10:00~12:00', creatorUid: 'u1' }),
        event({ id: 'e_today_2', _docId: 'e_today_2', date: '2026/05/09 14:00~16:00', creatorUid: 'u1' }),
        event({ id: 'e_future_1', _docId: 'e_future_1', date: '2026/05/20 10:00~12:00', creatorUid: 'u1' }),
        event({ id: 'e_future_2', _docId: 'e_future_2', date: '2026/06/01 10:00~12:00', creatorUid: 'u1' }),
      ],
    });
    expect(buckets.today.map((e) => e.eventId)).toEqual(['e_today_1', 'e_today_2']);
    expect(buckets.past.map((e) => e.eventId)).toEqual(['e_past_2', 'e_past_1']); // desc
    expect(buckets.future.map((e) => e.eventId)).toEqual(['e_future_1', 'e_future_2']); // asc
  });

  it('public id ≠ docId：value/eventId = public id，docId = Firestore doc id', () => {
    const buckets = loadScanEvents({
      context: ownerContext('u1'),
      now: NOW,
      events: [
        event({
          id: 'evt_public_009',
          _docId: 'firestoreDocXYZ',
          date: '2026/05/09 10:00~12:00',
          creatorUid: 'u1',
        }),
      ],
    });
    expect(buckets.today).toHaveLength(1);
    const entry = buckets.today[0]!;
    expect(entry.value).toBe('evt_public_009'); // R-ID-009
    expect(entry.eventId).toBe('evt_public_009'); // R-ID-009
    expect(entry.docId).toBe('firestoreDocXYZ'); // R-REG-014
  });

  it('public id ≠ docId 且缺 _docId 但有 docId 也能解析', () => {
    const buckets = loadScanEvents({
      context: ownerContext('u1'),
      now: NOW,
      events: [
        event({
          id: 'evt_public_010',
          docId: 'legacyDocId',
          date: '2026/05/09 10:00~12:00',
          creatorUid: 'u1',
        }),
      ],
    });
    const entry = buckets.today[0]!;
    expect(entry.eventId).toBe('evt_public_010');
    expect(entry.docId).toBe('legacyDocId');
  });

  it('無法解析日期字串 → 歸入 past（照 A）', () => {
    const buckets = loadScanEvents({
      context: ownerContext('u1'),
      now: NOW,
      events: [
        event({ id: 'e_bad', _docId: 'e_bad', date: 'not-a-date', creatorUid: 'u1' }),
      ],
    });
    expect(buckets.past.map((e) => e.eventId)).toEqual(['e_bad']);
  });

  it('typeLabel 由 typeConfig 注入（對照 A TYPE_CONFIG）', () => {
    const buckets = loadScanEvents({
      context: ownerContext('u1'),
      now: NOW,
      typeConfig: { tournament: { label: '賽事' } },
      events: [
        event({
          id: 'e1', _docId: 'e1', date: '2026/05/09 10:00~12:00',
          type: 'tournament', creatorUid: 'u1',
        }),
      ],
    });
    const entry = buckets.today[0]!;
    expect(entry.type).toBe('tournament');
    expect(entry.typeLabel).toBe('[賽事] ');
  });

  it('pickScanBucket 對應 A 的 _scanDateFilter 使用方式', () => {
    const buckets = loadScanEvents({
      context: ownerContext('u1'),
      now: NOW,
      events: [event({ id: 'e_today', _docId: 'e_today', date: '2026/05/09 10:00~12:00', creatorUid: 'u1' })],
    });
    expect(pickScanBucket(buckets, 'today')).toHaveLength(1);
    expect(pickScanBucket(buckets, 'past')).toHaveLength(0);
    expect(pickScanBucket(buckets, 'future')).toHaveLength(0);
  });
});
