import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMinimalViewer } from '@/features/profile/data/viewer';

type Constraint = { kind: string; field?: string; op?: string; value?: unknown; dir?: string };
type Req = { path: string; constraints: Constraint[] };
const fs = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  sub: new Map<string, Record<string, unknown>[]>(),
  failPaths: new Set<string>(),
  calls: [] as Req[],
}));

vi.mock('@/data/firebase', () => ({ getFirebase: async () => ({ db: 'mem' }) }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, path: string): Req => ({ path, constraints: [] }),
  query: (base: Req, ...constraints: Constraint[]): Req => ({ path: base.path, constraints }),
  where: (field: string, op: string, value: unknown): Constraint => ({ kind: 'where', field, op, value }),
  orderBy: (field: string, dir: string): Constraint => ({ kind: 'order', field, dir }),
  getDocs: async (req: Req) => {
    fs.calls.push(req);
    if (fs.failPaths.has(req.path)) throw new Error('denied');
    if (req.path !== 'events') {
      return { docs: (fs.sub.get(req.path) ?? []).map((data, i) => ({ id: `s${i}`, data: () => data })) };
    }
    let list = [...fs.rows.entries()];
    for (const c of req.constraints) {
      if (c.kind !== 'where') continue;
      list = list.filter(([, row]) => {
        const v = row[c.field!];
        if (c.op === '==') return v === c.value;
        if (c.op === '>=') return String(v) >= String(c.value);
        if (c.op === '<') return String(v) < String(c.value);
        if (c.op === 'array-contains') return Array.isArray(v) && v.includes(c.value);
        throw new Error(`unexpected op ${c.op}`);
      });
    }
    return { docs: list.map(([id, data]) => ({ id, data: () => data })) };
  },
}));

import { loadRangeEvents, loadRangeRosters } from './range-stats';
import { periodRange } from './range-stats-model';
import type { EventDoc } from './types';

const NOW = Date.UTC(2026, 10, 23, 4);
const NOV = periodRange('month', NOW);

beforeEach(() => {
  fs.rows.clear();
  fs.sub.clear();
  fs.failPaths.clear();
  fs.calls.length = 0;
  const base = { status: 'ended', title: 't' };
  fs.rows.set('d1', { ...base, id: 'p1', date: '2026/11/05 10:00', creatorUid: 'me' });
  fs.rows.set('d2', { ...base, id: 'p2', date: '2026/11/06 10:00', creatorUid: 'other', delegateUids: ['me'] });
  fs.rows.set('d3', { ...base, id: 'p3', date: '2026/10/30 10:00', creatorUid: 'me' });
  fs.rows.set('d4', { ...base, id: 'p4', date: '2026/11/07 10:00', creatorUid: 'other' });
  fs.rows.set('d5', { ...base, id: 'p5', date: '2026/11/08 10:00', ownerUid: 'me', creatorUid: 'me' });
});

describe('loadRangeEvents', () => {
  it('全部管理權：只用 date 單欄位範圍查詢（不需複合索引）', async () => {
    const viewer = { ...createMinimalViewer('admin'), permissions: ['event.edit_all'] };
    const viewerWithPerm = { ...viewer, hasPermission: (c: string) => c === 'event.edit_all' };
    const list = await loadRangeEvents(NOV, viewerWithPerm as never, true);
    expect(list.map((e) => e._docId).sort()).toEqual(['d1', 'd2', 'd4', 'd5']);
    expect(fs.calls).toHaveLength(1);
    const fields = fs.calls[0]!.constraints.map((c) => `${c.kind}:${c.field}`);
    expect(new Set(fields)).toEqual(new Set(['where:date', 'order:date']));
  });

  it('一般管理者：四個單欄位查詢合併去重、前端篩日期、只留自己可管理的', async () => {
    const viewer = createMinimalViewer('me');
    const list = await loadRangeEvents(NOV, viewer, false);
    expect(list.map((e) => e._docId).sort()).toEqual(['d1', 'd2', 'd5']);
    expect(fs.calls).toHaveLength(4);
    for (const call of fs.calls) {
      expect(call.constraints).toHaveLength(1);
      expect(call.constraints[0]!.value).toBe('me');
    }
  });

  it('沒有 uid 時不查詢', async () => {
    const viewer = createMinimalViewer('');
    expect(await loadRangeEvents(NOV, { ...viewer, uid: '' } as never, false)).toEqual([]);
    expect(fs.calls).toHaveLength(0);
  });
});

describe('loadRangeRosters', () => {
  it('子集合路徑用 _docId（R-ID-010）；單場失敗列入 failed，不當成 0 筆', async () => {
    fs.sub.set('events/rand-1/registrations', [{ userId: 'u1', status: 'confirmed' }]);
    fs.sub.set('events/rand-1/attendanceRecords', [{ uid: 'u1', type: 'checkin' }]);
    fs.failPaths.add('events/rand-2/attendanceRecords');
    const events = [
      { id: 'public-1', _docId: 'rand-1' },
      { id: 'public-2', _docId: 'rand-2' },
    ] as EventDoc[];
    const progress: number[] = [];
    const { rosters, failed } = await loadRangeRosters(events, (done) => progress.push(done));
    expect(rosters).toHaveLength(1);
    expect(rosters[0]!.registrations).toEqual([{ userId: 'u1', status: 'confirmed' }]);
    expect(rosters[0]!.attendance).toHaveLength(1);
    expect(failed.map((e) => e._docId)).toEqual(['rand-2']);
    expect(progress.sort()).toEqual([1, 2]);
    expect(fs.calls.some((c) => c.path.includes('public-1'))).toBe(false);
  });

  it('空清單不查詢', async () => {
    expect(await loadRangeRosters([])).toEqual({ rosters: [], failed: [] });
    expect(fs.calls).toHaveLength(0);
  });
});
