import { describe, expect, it } from 'vitest';

import { RANK_LIMIT, rankEvents, rankHosts } from './ops-rank';
import type { TopEvent, TopHost } from './ops-summary-types';

function event(patch: Partial<TopEvent> & Pick<TopEvent, 'docId'>): TopEvent {
  return { title: patch.docId, dateKey: '2026-11-01', occupied: 1, max: 10, ...patch };
}

function host(patch: Partial<TopHost> & Pick<TopHost, 'uid'>): TopHost {
  return { name: '主辦', events: 1, registrations: 1, ...patch };
}

describe('熱門活動', () => {
  it('填滿率、人數、歸屬日排序；max ≤ 0 排除；超過 10 筆只留前 10；同場只留一筆', () => {
    const fillers = Array.from({ length: 8 }, (_, i) => event({ docId: `f${i}`, title: `尾${i}`, occupied: 0, max: 10, dateKey: '' }));
    const rows = rankEvents([
      event({ docId: 'ev-low', title: '低', occupied: 1, max: 10, dateKey: '2026-11-01' }),
      event({ docId: 'ev-hi', title: '高', occupied: 9, max: 10, dateKey: '2026-11-02' }),
      event({ docId: 'ev-mid', title: '中', occupied: 5, max: 10, dateKey: '2026-11-03' }),
      event({ docId: 'ev-tie-old', title: '舊', occupied: 4, max: 8, dateKey: '2026-11-01' }),
      event({ docId: 'ev-tie-new', title: '新', occupied: 4, max: 8, dateKey: '2026-11-08' }),
      event({ docId: 'ev-zero', title: '無上限', occupied: 9, max: 0 }),
      event({ docId: 'ev-hi', title: '重複較差', occupied: 1, max: 10, dateKey: '2026-11-01' }),
      ...fillers,
    ]);
    expect(rows).toHaveLength(RANK_LIMIT);
    expect(rows.map((row) => row.docId)).toEqual([
      'ev-hi', 'ev-mid', 'ev-tie-new', 'ev-tie-old', 'ev-low', 'f0', 'f1', 'f2', 'f3', 'f4',
    ]);
    expect(rows[0]).toMatchObject({ title: '高', occupied: 9, max: 10, href: '/events/ev-hi' });
    expect(rows.some((row) => row.title === '無上限')).toBe(false);
    expect(rows.some((row) => row.docId === 'f5')).toBe(false);
  });

  it('0 筆、缺欄位是空陣列；標題不進網址', () => {
    expect(rankEvents([])).toEqual([]);
    expect(rankEvents([event({ docId: '', title: '無名' })])).toEqual([]);
    const slash = rankEvents([event({ docId: 'a/b', title: '夜足夜足夜足' })]);
    expect(slash[0]?.href).toBe('/events/a%2Fb');
    expect(slash[0]?.href).not.toContain('夜足');
  });
});

describe('熱門主辦', () => {
  it('場數、人次排序；空 uid 排除；超過 10 筆只留前 10；姓名不進網址', () => {
    const small = Array.from({ length: 9 }, (_, i) => host({ uid: `h${i}`, name: `尾${i}`, events: 1, registrations: i }));
    const rows = rankHosts([
      host({ uid: 'U-b', name: '阿花', events: 2, registrations: 50 }),
      host({ uid: 'U-a', name: '阿明', events: 5, registrations: 10 }),
      host({ uid: 'U-c', name: '阿強', events: 5, registrations: 40 }),
      host({ uid: '', name: '空', events: 99, registrations: 99 }),
      host({ uid: 'U-c', name: '重複', events: 1, registrations: 1 }),
      ...small,
    ]);
    expect(rows).toHaveLength(RANK_LIMIT);
    expect(rows.map((row) => row.uid)).toEqual(['U-c', 'U-a', 'U-b', 'h8', 'h7', 'h6', 'h5', 'h4', 'h3', 'h2']);
    expect(rows[0]).toMatchObject({ name: '阿強', events: 5, registrations: 40, href: '/profile/U-c' });
    expect(rows[1]?.href).toBe('/profile/U-a');
    expect(rows.every((row) => !row.href.includes('阿'))).toBe(true);
    expect(rows.some((row) => row.name === '空')).toBe(false);
  });

  it('0 筆是空陣列', () => {
    expect(rankHosts([])).toEqual([]);
  });
});
