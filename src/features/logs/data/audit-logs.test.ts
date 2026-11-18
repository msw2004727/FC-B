import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AUDIT_MAX_DAYS_PER_FETCH,
  _resetAuditEmptyDaysForTest,
  fetchAuditPage,
  type AuditCursor,
  type AuditDayReader,
} from './audit-logs';

type Doc = { id: string; data: Record<string, unknown>; snap: unknown };

function makeDoc(id: string, snapTag = 1): Doc {
  return { id, data: {}, snap: { __snap: snapTag } };
}

function startCursor(): AuditCursor {
  return { dayIdx: 0, lastDoc: null };
}

beforeEach(() => {
  _resetAuditEmptyDaysForTest();
});

describe('fetchAuditPage - 基本分頁', () => {
  it('湊滿 want 就停並回 cursor，同一天 hasMore 時保留最後一筆 snap', async () => {
    const docs = [makeDoc('a', 1), makeDoc('b', 2)];
    const read = vi.fn().mockResolvedValue({ docs, hasMore: true }) as unknown as AuditDayReader;

    const result = await fetchAuditPage(['20261119', '20261118'], startCursor(), 2, '20261120', read);

    expect(result.entries).toHaveLength(2);
    expect(result.cursor.dayIdx).toBe(0);
    expect(result.cursor.lastDoc).toEqual({ __snap: 2 });
    expect(result.done).toBe(false);
    expect(result.pausedAtDayLimit).toBe(false);
    expect(result.queries).toBe(1);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('跨日接續：無 hasMore 時前進到下一日並重設 lastDoc', async () => {
    const read = vi.fn()
      .mockResolvedValueOnce({ docs: [makeDoc('a')], hasMore: false })
      .mockResolvedValueOnce({ docs: [makeDoc('b'), makeDoc('c')], hasMore: false }) as unknown as AuditDayReader;

    const result = await fetchAuditPage(
      ['20261119', '20261118', '20261117'],
      startCursor(),
      3,
      '20261120',
      read,
    );

    expect(result.entries).toHaveLength(3);
    expect(result.cursor.dayIdx).toBe(2);
    expect(result.cursor.lastDoc).toBeNull();
    expect(result.done).toBe(false);
    expect(result.queries).toBe(2);
    expect(read).toHaveBeenCalledTimes(2);
  });
});

describe('fetchAuditPage - 上限與完成', () => {
  it('一次最多查 7 天，第 8 天不查且回 pausedAtDayLimit', async () => {
    const days = [
      '20261119',
      '20261118',
      '20261117',
      '20261116',
      '20261115',
      '20261114',
      '20261113',
      '20261112',
    ];
    const read = vi.fn().mockResolvedValue({ docs: [], hasMore: false }) as unknown as AuditDayReader;

    const result = await fetchAuditPage(days, startCursor(), 100, '20261120', read);

    expect(read).toHaveBeenCalledTimes(AUDIT_MAX_DAYS_PER_FETCH);
    expect(result.pausedAtDayLimit).toBe(true);
    expect(result.done).toBe(false);
    expect(result.entries).toEqual([]);
    expect(result.queries).toBe(7);
    expect(result.cursor.dayIdx).toBe(7);
  });

  it('全部讀完時 done:true', async () => {
    const read = vi.fn().mockResolvedValue({ docs: [makeDoc('x')], hasMore: false }) as unknown as AuditDayReader;

    const result = await fetchAuditPage(['20261119', '20261118'], startCursor(), 10, '20261120', read);

    expect(result.entries).toHaveLength(2);
    expect(result.done).toBe(true);
    expect(result.pausedAtDayLimit).toBe(false);
    expect(result.queries).toBe(2);
  });
});

describe('fetchAuditPage - 過去空日快取', () => {
  it('過去空日第二次呼叫不再查詢', async () => {
    const read = vi.fn().mockResolvedValue({ docs: [], hasMore: false }) as unknown as AuditDayReader;

    await fetchAuditPage(['20261119'], startCursor(), 1, '20261120', read);
    expect(read).toHaveBeenCalledTimes(1);

    const result = await fetchAuditPage(['20261119'], startCursor(), 1, '20261120', read);

    expect(read).toHaveBeenCalledTimes(1);
    expect(result.queries).toBe(0);
    expect(result.entries).toEqual([]);
    expect(result.cursor.dayIdx).toBe(1);
    expect(result.done).toBe(true);
  });

  it('今天為空時不快取、下次會重查', async () => {
    const read = vi.fn().mockResolvedValue({ docs: [], hasMore: false }) as unknown as AuditDayReader;

    await fetchAuditPage(['20261119'], startCursor(), 1, '20261119', read);
    await fetchAuditPage(['20261119'], startCursor(), 1, '20261119', read);

    expect(read).toHaveBeenCalledTimes(2);
  });

  it('_resetAuditEmptyDaysForTest 清空快取後會重查', async () => {
    const read = vi.fn().mockResolvedValue({ docs: [], hasMore: false }) as unknown as AuditDayReader;

    await fetchAuditPage(['20261119'], startCursor(), 1, '20261120', read);
    expect(read).toHaveBeenCalledTimes(1);

    _resetAuditEmptyDaysForTest();

    await fetchAuditPage(['20261119'], startCursor(), 1, '20261120', read);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
