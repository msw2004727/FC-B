import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emit } from '@/core/events';
import { peekViewerTeamScan, resetViewerTeamScanForTest, seedViewerTeamScanForTest } from '@/features/profile/data/viewer-team-scan';
import { collectRepClubs, isClubRepresentative, loadRepClubs, representativeClubs, resetRepClubsCacheForTest } from './rep-clubs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const firebaseBox = vi.hoisted(() => ({
  getFirebase: vi.fn(async () => ({ db: { kind: 'db' } })),
}));

vi.mock('@/data/firebase', () => ({
  getFirebase: () => firebaseBox.getFirebase(),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({ kind: 'teams' })),
  doc: vi.fn((_db: unknown, _col: string, id: string) => ({ id })),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  query: vi.fn((_col: unknown, constraint: { field: string }) => constraint),
  where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
}));

import { getDocs, where } from 'firebase/firestore';

describe('俱樂部代表（對齊 Rules isCurrentUserTeamCaptainOrLeader）', () => {
  it('隊長、建立者、擁有者、領隊算代表；教練不算', () => {
    expect(isClubRepresentative('u1', { captainUid: 'u1' })).toBe(true);
    expect(isClubRepresentative('u1', { creatorUid: 'u1' })).toBe(true);
    expect(isClubRepresentative('u1', { ownerUid: 'u1' })).toBe(true);
    expect(isClubRepresentative('u1', { leaderUid: 'u1' })).toBe(true);
    expect(isClubRepresentative('u1', { leaderUids: ['u2', 'u1'] })).toBe(true);
    expect(isClubRepresentative('u1', { coachUids: ['u1'], leaderUid: 'u2' })).toBe(false);
    expect(isClubRepresentative('u1', { coachUids: ['u1'] })).toBe(false);
    expect(isClubRepresentative('', { captainUid: '' })).toBe(false);
    expect(isClubRepresentative('u1', null)).toBe(false);
  });

  it('合併查詢結果時領隊留下、教練剔除、同文件不重複', () => {
    const clubs = collectRepClubs('u1', [
      { id: 'fs_lead', data: { id: 'club_lead', name: '領隊隊', leaderUids: ['u1'], coachUids: ['u9'] } },
      { id: 'fs_coach', data: { id: 'club_coach', name: '教練隊', coachUids: ['u1'] } },
      { id: 'fs_lead', data: { name: '領隊隊', leaderUid: 'u1', id: 'club_lead' } },
      { id: 'fs_blank', data: { captainUid: 'u1', name: '  ' } },
    ]);
    expect(clubs).toEqual([{ id: 'fs_lead', name: '領隊隊' }]);
  });

  it('欄位 id 與文件 id 不同時用文件 id，名稱仍讀欄位', () => {
    const clubs = collectRepClubs('u1', [
      { id: 'path_id', data: { id: 'field_id', name: '路徑隊', captainUid: 'u1' } },
    ]);
    expect(clubs).toEqual([{ id: 'path_id', name: '路徑隊' }]);
  });

  it('三處讀的是同一份 repClubs，不是另一份清單', () => {
    const clubs = [{ id: 'club_a', name: '示範隊A' }];
    expect(representativeClubs({ repClubs: clubs })).toBe(clubs);
  });
});

// P2-2 跨 repo 向量：cp-rep-vectors.json 是 FC tests/fixtures/cp-rep-vectors.json 的逐位元組複本
// （FC 的 functions/cp-club-mirror.js 與 Rules 模擬器讀同一份）。改向量要兩邊一起改；
// CI 規則測試的「規則副本對正本」步驟會比對 FC main 的正本（scripts/check-rules-sync.mjs）。
// 測試環境是 jsdom（import.meta.url 不是 file:），照 drawer-menu.test.ts 用 repo 根目錄組路徑。
const VECTOR_FILE = join(process.cwd(), 'src/features/competitions/cp-rep-vectors.json');
const VECTOR_SHA256 = '165e4bac60cc12a3dc61f07301cd31e6539dc4844443780fdf0b6f7badcad92d';
describe('俱樂部代表共用向量（cp-rep-vectors.json）', () => {
  const raw = readFileSync(VECTOR_FILE);
  const vectors = (JSON.parse(raw.toString('utf8')) as { vectors: Array<{ name: string; team: Record<string, unknown>; reps: string[]; nonReps: string[] }> }).vectors;
  it('複本雜湊與記錄一致（改向量要同步 FC 正本並更新這個常數）', () => {
    expect(createHash('sha256').update(raw).digest('hex')).toBe(VECTOR_SHA256);
    expect(vectors.length).toBeGreaterThan(0);
  });
  it.each(vectors.map((v) => [v.name, v] as const))('%s', (_name, v) => {
    for (const uid of v.reps) expect(isClubRepresentative(uid, v.team)).toBe(true);
    for (const uid of v.nonReps) expect(isClubRepresentative(uid, v.team)).toBe(false);
  });
});

describe('代表俱樂部清單的讀取量', () => {
  beforeEach(() => {
    resetRepClubsCacheForTest();
    resetViewerTeamScanForTest();
    vi.mocked(getDocs).mockReset();
    vi.mocked(where).mockClear();
    firebaseBox.getFirebase.mockClear();
  });

  it('同一 uid 第二次讀不再查 teams；登出後才重查', async () => {
    vi.mocked(getDocs).mockResolvedValue({ docs: [] } as never);
    await loadRepClubs('u1');
    expect(getDocs).toHaveBeenCalledTimes(5);
    await loadRepClubs('u1');
    expect(getDocs).toHaveBeenCalledTimes(5);

    emit('auth:changed', { uid: 'u1' });
    await loadRepClubs('u1');
    expect(getDocs).toHaveBeenCalledTimes(5);

    emit('auth:changed', { uid: null });
    await loadRepClubs('u1');
    expect(getDocs).toHaveBeenCalledTimes(10);
  });

  it('viewer 已查過的欄位沿用，只補查 creatorUid 與 ownerUid，而且用文件 id', async () => {
    const queried: string[] = [];
    vi.mocked(getDocs).mockImplementation(async (constraint) => {
      const field = (constraint as unknown as { field: string }).field;
      queried.push(field);
      if (field === 'creatorUid') {
        return {
          docs: [{
            id: 'path_creator',
            data: () => ({ id: 'field_creator', name: '建立隊', creatorUid: 'u1' }),
          }],
        } as never;
      }
      return { docs: [] } as never;
    });
    seedViewerTeamScanForTest('u1', {
      fields: new Set(['captainUid', 'leaderUid', 'leaderUids', 'coachUids']),
      docs: [{ docId: 'path_cap', data: { id: 'field_cap', name: '隊長隊', captainUid: 'u1' } }],
    });

    const clubs = await loadRepClubs('u1');
    expect(queried).toEqual(['creatorUid', 'ownerUid']);
    expect(clubs).toEqual([
      { id: 'path_cap', name: '隊長隊' },
      { id: 'path_creator', name: '建立隊' },
    ]);

    queried.length = 0;
    await loadRepClubs('u1');
    expect(queried).toEqual([]);
    expect(getDocs).toHaveBeenCalledTimes(2);
  });

  // viewer team scan 換人時由 viewer.ts 的訂閱清掉（viewer-cache.test.tsx 驗證）；這裡只測代表清單快取。
  it('換 uid 時代表清單快取清掉；（模擬 viewer 已清 scan）五個代表欄位全部重查', async () => {
    vi.mocked(getDocs).mockResolvedValue({ docs: [] } as never);
    seedViewerTeamScanForTest('u1', {
      fields: new Set(['captainUid', 'leaderUid', 'leaderUids', 'coachUids']),
      docs: [],
    });
    await loadRepClubs('u1');
    expect(peekViewerTeamScan('u1')).not.toBeNull();
    expect(getDocs).toHaveBeenCalledTimes(2);

    emit('auth:changed', { uid: 'u2' });
    resetViewerTeamScanForTest();
    await loadRepClubs('u1');
    // scan 與快取都清掉後，五個代表欄位要全部重查。
    expect(getDocs).toHaveBeenCalledTimes(7);
  });

  it('晚到的上一個 uid 查詢結果不寫入快取', async () => {
    let resolveDocs: (value: { docs: unknown[] }) => void = () => {};
    const pending = new Promise<{ docs: unknown[] }>((resolve) => {
      resolveDocs = resolve;
    });
    vi.mocked(getDocs).mockImplementation(() => pending as never);
    const first = loadRepClubs('u1');
    await vi.waitFor(() => expect(getDocs).toHaveBeenCalled());
    emit('auth:changed', { uid: 'u2' });
    resolveDocs({
      docs: [{ id: 'path_a', data: () => ({ name: '甲隊', captainUid: 'u1' }) }],
    });
    await expect(first).resolves.toEqual([{ id: 'path_a', name: '甲隊' }]);

    vi.mocked(getDocs).mockReset();
    vi.mocked(getDocs).mockResolvedValue({ docs: [] } as never);
    await loadRepClubs('u1');
    expect(getDocs).toHaveBeenCalled();
  });

  it('任一欄位查詢失敗不寫快取，下次重查', async () => {
    vi.mocked(getDocs).mockImplementation(async (constraint) => {
      const field = (constraint as unknown as { field: string }).field;
      if (field === 'captainUid') {
        return {
          docs: [{ id: 'path_a', data: () => ({ name: '甲隊', captainUid: 'u1' }) }],
        } as never;
      }
      if (field === 'ownerUid') throw new Error('boom');
      return { docs: [] } as never;
    });
    await expect(loadRepClubs('u1')).resolves.toEqual([{ id: 'path_a', name: '甲隊' }]);
    const calls = vi.mocked(getDocs).mock.calls.length;
    expect(calls).toBe(5);
    await loadRepClubs('u1');
    expect(vi.mocked(getDocs).mock.calls.length).toBe(calls + 5);
  });

  it('viewer:refresh 清掉代表清單快取', async () => {
    vi.mocked(getDocs).mockResolvedValue({ docs: [] } as never);
    await loadRepClubs('u1');
    expect(getDocs).toHaveBeenCalledTimes(5);
    emit('viewer:refresh', {});
    await loadRepClubs('u1');
    expect(getDocs).toHaveBeenCalledTimes(10);
  });
});
