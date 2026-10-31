/**
 * scan-events.ts 測試。
 *
 * 目標：
 *  - 只列出 `canOperateEventSite === true` 的活動（R-IAM-010）。
 *  - 分類／排序照 A `_categorizeScanEvents`。
 *  - 狀態篩選照 A `renderScanPage`：open / full / ended。
 *  - public id ≠ docId 的舊活動：value/eventId = public id，docId 保留。
 */

import { describe, expect, it } from 'vitest';

import {
  SCAN_EVENT_TYPE_CONFIG,
  loadScanEvents,
  pickScanBucket,
  toScanEventEntry,
} from '../scan-events';
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

const NOW = new Date(Date.parse('2026-05-09T10:00:00+08:00')); // 台北時間

// 測試同步更新：照 A（M-104）預設 status: 'open' 以符合狀態篩選。
function event(over: Partial<EventDoc>): EventDoc {
  return { status: 'open', ...over };
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

  it('只收 status open / full / ended（照 A renderScanPage）', () => {
    const missing = event({
      id: 'e_missing',
      _docId: 'e_missing',
      date: '2026/05/09 10:00~12:00',
      creatorUid: 'u1',
    });
    delete (missing as { status?: string }).status;

    const buckets = loadScanEvents({
      context: ownerContext('u1'),
      now: NOW,
      events: [
        event({ id: 'e_open', _docId: 'e_open', status: 'open', date: '2026/05/09 10:00~12:00', creatorUid: 'u1' }),
        event({ id: 'e_full', _docId: 'e_full', status: 'full', date: '2026/05/09 10:00~12:00', creatorUid: 'u1' }),
        event({ id: 'e_ended', _docId: 'e_ended', status: 'ended', date: '2026/05/09 10:00~12:00', creatorUid: 'u1' }),
        event({ id: 'e_cancelled', _docId: 'e_cancelled', status: 'cancelled', date: '2026/05/09 10:00~12:00', creatorUid: 'u1' }),
        event({ id: 'e_upcoming', _docId: 'e_upcoming', status: 'upcoming', date: '2026/05/09 10:00~12:00', creatorUid: 'u1' }),
        missing,
      ],
    });
    const all = [...buckets.today, ...buckets.past, ...buckets.future]
      .map((entry) => entry.eventId)
      .sort();
    expect(all).toEqual(['e_ended', 'e_full', 'e_open']);
  });

  it('SCAN_EVENT_TYPE_CONFIG 對照 A TYPE_CONFIG 前綴', () => {
    expect(SCAN_EVENT_TYPE_CONFIG.play).toEqual({ label: 'PLAY' });

    const buckets = loadScanEvents({
      context: ownerContext('u1'),
      now: NOW,
      typeConfig: SCAN_EVENT_TYPE_CONFIG,
      events: [
        event({
          id: 'e_play',
          _docId: 'e_play',
          type: 'play',
          date: '2026/05/09 10:00~12:00',
          creatorUid: 'u1',
        }),
      ],
    });
    expect(buckets.today[0]!.typeLabel).toBe('[PLAY] ');
  });

  it('toScanEventEntry 匯出並帶類型前綴', () => {
    const entry = toScanEventEntry(
      event({ id: 'evt_public', _docId: 'doc-id', type: 'play' }),
      SCAN_EVENT_TYPE_CONFIG,
    );
    expect(entry).toMatchObject({
      value: 'evt_public',
      eventId: 'evt_public',
      docId: 'doc-id',
      typeLabel: '[PLAY] ',
    });
  });

  it('toScanEventEntry 缺 docId 回 null', () => {
    expect(toScanEventEntry(event({ id: 'evt_public', _docId: undefined, docId: undefined })))
      .toBeNull();
  });
});


describe('T-054c K1–K5：台北日期分桶', () => {
  it.each(['2026-10-19T00:30:00+08:00', '2026-10-19T23:30:00+08:00'])(
    'K1／K2：%s 仍以台北 10/19 為今天', (now) => {
      const buckets = loadScanEvents({
        context: ownerContext('uidA'), now: new Date(Date.parse(now)),
        events: [
          event({ id: 'evtA', _docId: 'evtA', creatorUid: 'uidA', date: '2026/10/19 09:00~10:00' }),
          event({ id: 'targetA', _docId: 'targetA', creatorUid: 'uidA', date: '2026/10/20 09:00~10:00' }),
          event({ id: 'uidB', _docId: 'uidB', creatorUid: 'uidA', date: '2026/10/18 09:00~10:00' }),
        ],
      });
      expect(buckets.today.map((entry) => entry.eventId)).toEqual(['evtA']);
      expect(buckets.future.map((entry) => entry.eventId)).toEqual(['targetA']);
      expect(buckets.past.map((entry) => entry.eventId)).toEqual(['uidB']);
    },
  );

  it('K3：斜線只有日期仍屬今天，時間無效也不改日期分桶', () => {
    for (const date of ['2026/10/19', '2026/10/19 invalid']) {
      const buckets = loadScanEvents({
        context: ownerContext('uidA'), now: new Date(Date.parse('2026-10-19T00:30:00+08:00')),
        events: [event({ id: 'evtA', _docId: 'evtA', creatorUid: 'uidA', date })],
      });
      expect(buckets.today.map((entry) => entry.eventId)).toEqual(['evtA']);
      expect(buckets.past).toEqual([]);
      expect(buckets.future).toEqual([]);
    }
  });

  it.each(['2026-10-19', '2026.10.19', '2026/02/30', 'bad'])(
    '刻意與舊版不同：K3／K4 嚴格日期 %s 進 past', (date) => {
      const buckets = loadScanEvents({
        context: ownerContext('uidA'), now: new Date(Date.parse('2026-10-19T00:30:00+08:00')),
        events: [event({ id: 'evtA', _docId: 'evtA', creatorUid: 'uidA', date })],
      });
      expect(buckets.past.map((entry) => entry.eventId)).toEqual(['evtA']);
      expect(buckets.today).toEqual([]);
      expect(buckets.future).toEqual([]);
    },
  );

  it('刻意與舊版不同：斜線日期接 T 回 null，由今天分桶改入 past', () => {
    const buckets = loadScanEvents({
      context: ownerContext('uidA'), now: new Date(Date.parse('2026-10-19T00:30:00+08:00')),
      events: [event({ id: 'evtA', _docId: 'evtA', creatorUid: 'uidA', date: '2026/10/19T09:00' })],
    });
    expect(buckets.past.map((entry) => entry.eventId)).toEqual(['evtA']);
    expect(buckets.today).toEqual([]);
    expect(buckets.future).toEqual([]);
  });

  it('K5：保留 Date 注入簽名，以注入瞬間所在台北日分桶', () => {
    const parsed: (string | undefined)[] = [];
    const buckets = loadScanEvents({
      context: ownerContext('uidA'), now: new Date(Date.parse('2026-10-19T23:30:00+08:00')),
      events: [event({ id: 'evtA', _docId: 'evtA', creatorUid: 'uidA', date: 'custom' })],
      parseEventDate: (date) => {
        parsed.push(date);
        return new Date(Date.parse('2026-10-19T00:30:00+08:00'));
      },
    });
    expect(parsed).toEqual(['custom']);
    expect(buckets.today.map((entry) => entry.eventId)).toEqual(['evtA']);
    expect(buckets.past).toEqual([]);
    expect(buckets.future).toEqual([]);
  });
});
