import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/firestore', async () => (await import('../ops-test-utils')).sdk);
vi.mock('@/data/firebase', () => ({ getFirebase: async () => ({ db: {} }) }));

import { addTaipeiDays, formatTaipei, parseTaipei } from '@/core/taipei-time';
import { calls, documentIdInBatches, failures, FORBIDDEN_APIS, resetStore, sdk, store, totalReads } from '../ops-test-utils';
import {
  MAX_MATCHED_EVENTS,
  PARTICIPANT_PAGE_SIZE,
  defaultQueryRange,
  fetchUserNames,
  participantsAsOf,
  participantsPath,
  queryParticipants,
  summarizeParticipants,
  validateQuery,
} from './participants-data';

const ASOF = '2026-11-08';

function dayDoc(ymd: string, events: { docId: string; title: string; uids: string[] }[]) {
  return { id: ymd.replace(/-/g, ''), data: { schemaVersion: 1, dateKey: ymd, events: events.map((e) => ({ docId: e.docId, id: e.docId, title: e.title, checkedInUids: e.uids })) } };
}

/** asOf 往前 365 天每天一份索引；每天 1 場「羽球」＋1 場「籃球」。 */
function seedYear(): void {
  const asOfMs = parseTaipei(ASOF)!;
  const days = Array.from({ length: 365 }, (_, i) => {
    const ymd = formatTaipei(addTaipeiDays(asOfMs, -i), 'YYYY-MM-DD');
    return dayDoc(ymd, [
      { docId: `b${i}`, title: '週三羽球雙打', uids: [`U${i % 80}`, `U${(i + 1) % 80}`] },
      { docId: `k${i}`, title: '籃球鬥牛', uids: [`U${i % 7}`] },
    ]);
  });
  resetStore({
    opsParticipantDays: days,
    users: Array.from({ length: 80 }, (_, i) => ({ id: `U${i}`, data: { displayName: `用戶${i}` } })),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  seedYear();
});

describe('日期與驗證（台北，不用 new Date(字串)）', () => {
  it('asOf＝昨天（台北日界）；預設區間＝asOf 當月 1 日～asOf', () => {
    // 台北 11-09 00:30（UTC 11-08 16:30）→ asOf 11-08
    const now = Date.UTC(2026, 10, 8, 16, 30);
    expect(participantsAsOf(now)).toBe('2026-11-08');
    expect(defaultQueryRange(now)).toEqual({ from: '2026-11-01', to: '2026-11-08' });
    // 台北 11-08 23:59 → asOf 11-07
    expect(participantsAsOf(Date.UTC(2026, 10, 8, 15, 59))).toBe('2026-11-07');
  });

  it('關鍵字必填、日期格式、先後、迄日不超過 asOf、區間 ≤ 365 天', () => {
    const ok = { keyword: '羽球', from: '2025-11-09', to: ASOF };
    expect(validateQuery(ok, ASOF)).toBeNull();
    expect(validateQuery({ ...ok, keyword: '  ' }, ASOF)).toBe('err.keyword');
    expect(validateQuery({ ...ok, from: '2025/11/09' }, ASOF)).toBe('err.dates');
    expect(validateQuery({ ...ok, from: '2026-02-30' }, ASOF)).toBe('err.dates');
    expect(validateQuery({ ...ok, from: '2026-11-08', to: '2026-11-07' }, ASOF)).toBe('err.order');
    expect(validateQuery({ ...ok, to: '2026-11-09' }, ASOF)).toBe('err.future');
    expect(validateQuery({ ...ok, from: '2025-11-08' }, ASOF)).toBe('err.range');
  });

  it('分享網址只含關鍵字與日期', () => {
    const path = participantsPath({ keyword: ' 羽球 ', from: '2026-11-01', to: ASOF });
    expect(path).toBe('/admin/ops/participants?q=%E7%BE%BD%E7%90%83&from=2026-11-01&to=2026-11-08');
    expect(path).not.toMatch(/U\d|uid/i);
  });
});

describe('彙總（Q1～Q3）', () => {
  it('標題不分大小寫比對；同場跨日只算一次；人數＝聯集、次數＝各場加總；排序次數多→最近→UID', () => {
    const days = [
      dayDoc('2026-11-01', [{ docId: 'e1', title: 'Badminton 週六', uids: ['A', 'B', 'B'] }, { docId: 'e2', title: '足球', uids: ['C'] }]),
      dayDoc('2026-11-02', [{ docId: 'e3', title: 'BADMINTON 進階', uids: ['B', 'D'] }]),
      dayDoc('2026-11-03', [{ docId: 'e1', title: 'Badminton 週六', uids: ['A'] }]),
    ];
    const out = summarizeParticipants(days, ' badminton ');
    expect(out).toEqual({
      kind: 'ok',
      matchedEvents: 2,
      participations: 4,
      rows: [
        { uid: 'B', count: 2, lastDay: '20261102' },
        { uid: 'D', count: 1, lastDay: '20261102' },
        { uid: 'A', count: 1, lastDay: '20261101' },
      ],
    });
  });

  it('區間內沒有任何索引 → noData；有索引但沒符合 → 0', () => {
    expect(summarizeParticipants([], 'x')).toEqual({ kind: 'noData' });
    expect(summarizeParticipants([dayDoc('2026-11-01', [{ docId: 'e', title: '足球', uids: ['A'] }])], '羽球'))
      .toEqual({ kind: 'ok', matchedEvents: 0, participations: 0, rows: [] });
  });
});

describe('讀取預算（字典 §5：參與查詢 ≤ 415）', () => {
  it('365 天區間：索引一次 documentId 範圍查詢（≤ 365 份）＋當頁名稱 ≤ 50 份；不讀 attendanceRecords', async () => {
    const q = { keyword: '羽球', from: '2025-11-09', to: ASOF };
    expect(validateQuery(q, ASOF)).toBeNull();
    const out = await queryParticipants(q);
    // 符合 365 場 > 50 → 拒絕
    expect(out).toEqual({ kind: 'tooMany', matched: 365 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe('opsParticipantDays');
    expect(totalReads()).toBe(365);
    expect(sdk.where).toHaveBeenCalledWith('__name__', '>=', '20251109');
    expect(sdk.where).toHaveBeenCalledWith('__name__', '<=', '20261108');
    // 符合 > 50 場：不讀 users
    expect(calls.some((c) => c.name === 'users')).toBe(false);
  });

  it('365 天區間符合 ≤ 50 場時讀完名稱，總讀取 ≤ 415；名稱每批 ≤ 30', async () => {
    // 把羽球改成只有最近 50 天有
    for (const d of store['opsParticipantDays']!) {
      const events = d.data['events'] as { title: string }[];
      if (d.id < '20260920') events[0]!.title = '其他';
    }
    const out = await queryParticipants({ keyword: '羽球', from: '2025-11-09', to: ASOF });
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    expect(out.matchedEvents).toBe(50);
    const names = await fetchUserNames(out.rows.slice(0, PARTICIPANT_PAGE_SIZE).map((r) => r.uid));
    expect(Object.keys(names).length).toBe(Math.min(out.rows.length, PARTICIPANT_PAGE_SIZE));
    expect(totalReads()).toBeLessThanOrEqual(415);
    expect(documentIdInBatches().every((b) => b.length <= 30)).toBe(true);
    expect(calls.some((c) => /attendance/i.test(c.name))).toBe(false);
    expect(sdk.collectionGroup).not.toHaveBeenCalled();
    for (const name of FORBIDDEN_APIS) expect(sdk[name]).not.toHaveBeenCalled();
  });

  it('剛好 50 場可查、51 場拒絕', () => {
    const mk = (n: number) => [dayDoc('2026-11-01', Array.from({ length: n }, (_, i) => ({ docId: `e${i}`, title: '羽球', uids: ['A'] })))];
    expect(summarizeParticipants(mk(MAX_MATCHED_EVENTS), '羽球').kind).toBe('ok');
    expect(summarizeParticipants(mk(MAX_MATCHED_EVENTS + 1), '羽球')).toEqual({ kind: 'tooMany', matched: 51 });
  });

  it('名稱只讀傳入的當頁 UID（最多 50），查不到的不放進結果', async () => {
    const uids = [...Array.from({ length: 60 }, (_, i) => `U${i}`), 'ghost'];
    const names = await fetchUserNames(uids);
    expect(Object.keys(names)).toHaveLength(50);
    expect(totalReads()).toBe(50);
    expect(documentIdInBatches().map((b) => b.length)).toEqual([30, 20]);
  });

  it('索引讀取被 Rules 擋（permission-denied）→ 丟錯，不回空結果', async () => {
    failures['opsParticipantDays'] = 'permission-denied';
    await expect(queryParticipants({ keyword: '羽球', from: '2026-11-01', to: ASOF })).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('文件不存在（not-found）是 noData，不是丟錯', async () => {
    failures['opsParticipantDays'] = 'not-found';
    await expect(queryParticipants({ keyword: '羽球', from: '2026-11-01', to: ASOF })).resolves.toEqual({ kind: 'noData' });
  });

  it('區間中間缺日：只讀存在的文件，缺日略過；0 份文件是 noData 且仍算 1 次讀取', async () => {
    resetStore({
      opsParticipantDays: [
        dayDoc('2026-11-01', [{ docId: 'e1', title: '羽球', uids: ['A'] }]),
        dayDoc('2026-11-03', [{ docId: 'e2', title: '羽球', uids: ['B'] }]),
      ],
    });
    const out = await queryParticipants({ keyword: '羽球', from: '2026-11-01', to: '2026-11-03' });
    expect(out).toMatchObject({ kind: 'ok', matchedEvents: 2, participations: 2 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe('opsParticipantDays');
    expect(totalReads()).toBe(2);
    expect(sdk.where).toHaveBeenCalledWith('__name__', '>=', '20261101');
    expect(sdk.where).toHaveBeenCalledWith('__name__', '<=', '20261103');
    resetStore({ opsParticipantDays: [] });
    await expect(queryParticipants({ keyword: '羽球', from: '2026-11-01', to: '2026-11-03' })).resolves.toEqual({ kind: 'noData' });
    expect(totalReads()).toBe(1);
  });

  it('一場 checkedInUids 很多：人數是聯集、次數是去重後長度，不在這裡截斷', () => {
    const uids = Array.from({ length: 120 }, (_, i) => `secret${i}`);
    const out = summarizeParticipants([
      dayDoc('2026-11-01', [{ docId: 'e', title: '羽球', uids: [...uids, uids[0]!] }]),
    ], '羽球');
    expect(out).toMatchObject({ kind: 'ok', matchedEvents: 1, participations: 120 });
    if (out.kind !== 'ok') return;
    expect(out.rows).toHaveLength(120);
    expect(out.rows.every((row) => row.uid.startsWith('secret'))).toBe(true);
  });
});

