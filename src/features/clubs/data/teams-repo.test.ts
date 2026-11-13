/**
 * `teams-repo` Firestore 讀取測試。
 *
 * 覆蓋：
 *   - loadTeams：全集合、_docId、session 內記憶化、invalidateTeams 清除快取
 *   - loadTeam：存在／不存在
 *   - loadTeamMembers：未登入回 null、查詢失敗往外拋、uid 去重、幹部 UID 補齊
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDocsMock, getDocMock, getCurrentUserMock, getFirebaseMock, getFirebaseCoreMock } = vi.hoisted(() => ({
  getDocsMock: vi.fn(),
  getDocMock: vi.fn(),
  getCurrentUserMock: vi.fn(),
  getFirebaseMock: vi.fn(async () => ({ db: { __fake: true, kind: 'full' }, auth: null, functions: null })),
  getFirebaseCoreMock: vi.fn(async () => ({ db: { __fake: true, kind: 'core' } })),
}));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...paths: string[]) => ({ path: paths.join('/') }),
  doc: (_db: unknown, ...paths: string[]) => ({ path: paths.join('/') }),
  query: (ref: { path: string }, ...constraints: unknown[]) => ({
    ...ref,
    wheres: constraints,
  }),
  where: (field: string, op: string, value: unknown) => ({ type: 'where', field, op, value }),
  limit: (n: number) => ({ type: 'limit', n }),
  getDocs: getDocsMock,
  getDoc: getDocMock,
}));

vi.mock('@/data/firebase', () => ({
  getFirebase: getFirebaseMock,
  getFirebaseCore: getFirebaseCoreMock,
}));

vi.mock('@/data/auth', () => ({
  getCurrentUser: getCurrentUserMock,
}));

import { invalidateTeams, loadTeam, loadTeamMembers, loadTeams } from './teams-repo';
import type { TeamDoc, TeamMember } from './types';

interface SnapshotDoc {
  id: string;
  data: () => unknown;
}

function makeSnapshotDocs(docs: SnapshotDoc[]): {
  forEach: (cb: (d: SnapshotDoc) => void) => void;
} {
  return {
    forEach: (cb) => docs.forEach(cb),
  };
}

beforeEach(() => {
  getDocsMock.mockReset();
  getDocMock.mockReset();
  getCurrentUserMock.mockReset();
  getFirebaseMock.mockClear();
  getFirebaseCoreMock.mockClear();
  invalidateTeams();
});

describe('loadTeams', () => {
  it('讀全集合、補 _docId', async () => {
    getDocsMock.mockResolvedValueOnce(
      makeSnapshotDocs([
        { id: 't1', data: () => ({ name: 'Team 1' }) },
        { id: 't2', data: () => ({ name: 'Team 2', sportTag: 'basketball' }) },
      ]),
    );

    const list = await loadTeams();
    expect(list).toHaveLength(2);
    expect(list[0]).toEqual({ name: 'Team 1', _docId: 't1' });
    expect(list[1]).toEqual({ name: 'Team 2', sportTag: 'basketball', _docId: 't2' });
    expect(getDocsMock).toHaveBeenCalledTimes(1);

    const ref = getDocsMock.mock.calls[0]?.[0] as { path?: string } | undefined;
    expect(ref?.path).toBe('teams');
  });

  it('session 內記憶化：後續呼叫不再打 Firestore', async () => {
    getDocsMock.mockResolvedValueOnce(
      makeSnapshotDocs([{ id: 't1', data: () => ({ name: 'Team 1' }) }]),
    );

    const first = await loadTeams();
    const second = await loadTeams();
    expect(second).toBe(first);
    expect(getDocsMock).toHaveBeenCalledTimes(1);
  });

  it('invalidateTeams 清除快取', async () => {
    getDocsMock.mockResolvedValueOnce(
      makeSnapshotDocs([{ id: 't1', data: () => ({ name: 'Team 1' }) }]),
    );
    await loadTeams();

    invalidateTeams();

    getDocsMock.mockResolvedValueOnce(
      makeSnapshotDocs([{ id: 't2', data: () => ({ name: 'Team 2' }) }]),
    );
    const second = await loadTeams();
    expect(second.map((t) => t._docId)).toEqual(['t2']);
    expect(getDocsMock).toHaveBeenCalledTimes(2);
  });
});

describe('loadTeam', () => {
  it('文件存在時回傳含 _docId', async () => {
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      id: 't1',
      data: () => ({ name: 'Team 1', members: 5 }),
    });

    const result = await loadTeam('t1');
    expect(result).toEqual({ name: 'Team 1', members: 5, _docId: 't1' });
    const ref = getDocMock.mock.calls[0]?.[0] as { path?: string } | undefined;
    expect(ref?.path).toBe('teams/t1');
  });

  it('文件 ID 找不到也查不到 id 欄位時回 null', async () => {
    getDocMock.mockResolvedValueOnce({ exists: () => false, id: 't404', data: () => ({}) });
    getDocsMock.mockResolvedValueOnce({ docs: [] });
    expect(await loadTeam('t404')).toBeNull();
  });

  it('public id 與文件 ID 不同的舊資料：以 where id == 補查並回傳實際 _docId', async () => {
    getDocMock.mockResolvedValueOnce({ exists: () => false, id: 'tm_public', data: () => ({}) });
    getDocsMock.mockResolvedValueOnce({
      docs: [{ id: 'legacyDocId', data: () => ({ id: 'tm_public', name: 'Legacy' }) }],
    });
    expect(await loadTeam('tm_public')).toEqual({ id: 'tm_public', name: 'Legacy', _docId: 'legacyDocId' });
    const q = getDocsMock.mock.calls[0]?.[0] as { wheres?: unknown[] } | undefined;
    expect(q?.wheres).toEqual([
      { type: 'where', field: 'id', op: '==', value: 'tm_public' },
      { type: 'limit', n: 1 },
    ]);
  });

  it('空 teamId 直接回 null（不打 Firestore）', async () => {
    expect(await loadTeam('')).toBeNull();
    expect(getDocMock).not.toHaveBeenCalled();
  });
});

describe('loadTeamMembers', () => {
  const baseTeam: TeamDoc = { id: 't1', captainUid: 'cap' };

  function routeGetDocs(handlers: {
    teamIds?: SnapshotDoc[];
    teamId?: SnapshotDoc[];
  }) {
    return getDocsMock.mockImplementation((q: { wheres?: Array<{ field: string }> }) => {
      const fields = (q.wheres ?? []).map((w) => w.field);
      if (fields.includes('teamIds')) {
        return Promise.resolve(makeSnapshotDocs(handlers.teamIds ?? []));
      }
      if (fields.includes('teamId')) {
        return Promise.resolve(makeSnapshotDocs(handlers.teamId ?? []));
      }
      return Promise.resolve(makeSnapshotDocs([]));
    });
  }

  it('未登入回 null（不打查詢）', async () => {
    getCurrentUserMock.mockResolvedValueOnce(null);
    const result = await loadTeamMembers(baseTeam);
    expect(result).toBeNull();
    expect(getDocsMock).not.toHaveBeenCalled();
  });

  it('任一查詢失敗時往外拋（不靜默空陣列）', async () => {
    getCurrentUserMock.mockResolvedValueOnce({ uid: 'me' });
    getDocsMock.mockImplementation((q: { wheres?: Array<{ field: string }> }) => {
      const fields = (q.wheres ?? []).map((w) => w.field);
      if (fields.includes('teamIds')) {
        return Promise.reject(new Error('permission denied'));
      }
      return Promise.resolve(makeSnapshotDocs([]));
    });

    await expect(loadTeamMembers(baseTeam)).rejects.toThrow('permission denied');
  });

  it('合併查詢結果、以 uid 去重', async () => {
    getCurrentUserMock.mockResolvedValueOnce({ uid: 'me' });
    routeGetDocs({
      teamIds: [
        { id: 'u1', data: () => ({ uid: 'u1', name: 'Alice', teamIds: ['t1'] }) },
        { id: 'uNoUid', data: () => ({ name: 'Bob', teamIds: ['t1'] }) },
      ],
      teamId: [
        { id: 'u3', data: () => ({ uid: 'u3', name: 'Carol', teamId: 't1' }) },
        { id: 'u1', data: () => ({ uid: 'u1', name: 'Alice' }) }, // dup
      ],
    });
    // captain 「cap」不在查詢結果 → 走 getDoc 補齊
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      id: 'cap',
      data: () => ({ name: 'Captain', teamIds: ['t1'] }),
    });

    const members = (await loadTeamMembers(baseTeam)) as TeamMember[];
    expect(members).not.toBeNull();
    const uids = members.map((m) => m.uid).sort();
    expect(uids).toEqual(['cap', 'u1', 'u3', 'uNoUid']);
    const u1 = members.find((m) => m.uid === 'u1');
    expect(u1?._docId).toBe('u1');
    const noUid = members.find((m) => m.uid === 'uNoUid');
    expect(noUid?._docId).toBe('uNoUid');
    // captain 補齊時使用 uid 為 key
    const cap = members.find((m) => m.uid === 'cap');
    expect(cap?._docId).toBe('cap');
  });

  it('幹部 UID 在查詢結果中已存在時不再 getDoc', async () => {
    getCurrentUserMock.mockResolvedValueOnce({ uid: 'me' });
    routeGetDocs({
      teamIds: [
        { id: 'cap', data: () => ({ uid: 'cap', name: 'Captain', teamIds: ['t1'] }) },
      ],
      teamId: [],
    });

    const members = await loadTeamMembers(baseTeam);
    expect(members).not.toBeNull();
    expect(getDocMock).not.toHaveBeenCalled();
    expect(members?.map((m) => m.uid)).toEqual(['cap']);
  });

  it('幹部 UID 無 user doc 時仍回 stub（uid 有值、_docId=uid）', async () => {
    getCurrentUserMock.mockResolvedValueOnce({ uid: 'me' });
    routeGetDocs({ teamIds: [], teamId: [] });
    getDocMock.mockResolvedValueOnce({
      exists: () => false,
      id: 'cap',
      data: () => ({}),
    });

    const members = await loadTeamMembers(baseTeam);
    expect(members).not.toBeNull();
    expect(members).toHaveLength(1);
    expect(members?.[0]?.uid).toBe('cap');
    expect(members?.[0]?._docId).toBe('cap');
  });

  it('team 缺 id 時回空陣列（不打查詢）', async () => {
    const result = await loadTeamMembers({} as TeamDoc);
    expect(result).toEqual([]);
    expect(getDocsMock).not.toHaveBeenCalled();
  });

  it('缺席的幹部同時讀取，合併順序仍是隊長、領隊、教練', async () => {
    const team: TeamDoc = {
      id: 't1',
      captainUid: 'cap',
      leaderUids: ['lead'],
      coachUids: ['coach'],
    };
    getCurrentUserMock.mockResolvedValueOnce({ uid: 'me' });
    routeGetDocs({ teamIds: [], teamId: [] });
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    getDocMock.mockImplementation((ref: { path: string }) => gate.then(() => ({
      exists: () => true,
      id: ref.path.split('/').at(-1),
      data: () => ({ name: ref.path }),
    })));

    const pending = loadTeamMembers(team);
    await vi.waitFor(() => expect(getDocMock).toHaveBeenCalledTimes(3));
    expect(getDocMock.mock.calls.map((call) => (call[0] as { path: string }).path)).toEqual([
      'users/cap',
      'users/lead',
      'users/coach',
    ]);
    if (!release) throw new Error('缺少釋放');
    release();

    const members = await pending;
    expect(members?.map((member) => member.uid)).toEqual(['cap', 'lead', 'coach']);
  });

  it('幹部補齊任一 getDoc 失敗時往外拋', async () => {
    const team: TeamDoc = {
      id: 't1',
      captainUid: 'cap',
      leaderUids: ['lead'],
    };
    getCurrentUserMock.mockResolvedValueOnce({ uid: 'me' });
    routeGetDocs({ teamIds: [], teamId: [] });
    getDocMock.mockImplementation((ref: { path: string }) => {
      if (ref.path.endsWith('/lead')) return Promise.reject(new Error('staff-read-failed'));
      return Promise.resolve({
        exists: () => true,
        id: 'cap',
        data: () => ({ name: 'Captain' }),
      });
    });

    await expect(loadTeamMembers(team)).rejects.toThrow('staff-read-failed');
  });

  describe('同一人有舊文件（文件 ID ≠ uid、缺 uid 欄位）＋正本', () => {
    const legacy = (over: Record<string, unknown> = {}) => ({
      id: 'legacyDoc1',
      data: () => ({ lineUserId: 'Ualice', name: '舊名', teamId: 't1', role: 'coach', ...over }),
    });
    const canon = { id: 'Ualice', data: () => ({ uid: 'Ualice', lineUserId: 'Ualice', name: 'Alice', teamIds: ['t1'], role: 'user' }) };

    it('兩份都查到：名單一列，用正本資料（舊文件先到也一樣）', async () => {
      getCurrentUserMock.mockResolvedValueOnce({ uid: 'me' });
      routeGetDocs({ teamIds: [legacy({ teamIds: ['t1'] })], teamId: [canon] });
      getDocMock.mockResolvedValue({ exists: () => false, id: 'cap', data: () => ({}) });

      const members = (await loadTeamMembers({ id: 't1' })) as TeamMember[];
      expect(members).toHaveLength(1);
      expect(members[0]).toMatchObject({ uid: 'Ualice', _docId: 'Ualice', name: 'Alice', role: 'user' });
    });

    it('正本先到時舊文件不覆蓋', async () => {
      getCurrentUserMock.mockResolvedValueOnce({ uid: 'me' });
      routeGetDocs({ teamIds: [canon], teamId: [legacy()] });

      const members = (await loadTeamMembers({ id: 't1' })) as TeamMember[];
      expect(members).toHaveLength(1);
      expect(members[0]).toMatchObject({ _docId: 'Ualice', role: 'user' });
    });

    it('只有正本的一般情況不受影響', async () => {
      getCurrentUserMock.mockResolvedValueOnce({ uid: 'me' });
      routeGetDocs({ teamIds: [canon, { id: 'u2', data: () => ({ uid: 'u2', teamIds: ['t1'] }) }] });

      const members = (await loadTeamMembers({ id: 't1' })) as TeamMember[];
      expect(members.map((m) => [m.uid, m._docId])).toEqual([['Ualice', 'Ualice'], ['u2', 'u2']]);
      expect(getDocMock).not.toHaveBeenCalled();
    });

    it('幹部只由舊文件列出：補讀正本，存在就換成正本；不存在保留舊文件那列', async () => {
      getCurrentUserMock.mockResolvedValueOnce({ uid: 'me' });
      routeGetDocs({ teamId: [legacy()] });
      getDocMock.mockResolvedValueOnce({ exists: () => true, id: 'Ualice', data: () => canon.data() });

      const members = (await loadTeamMembers({ id: 't1', captainUid: 'Ualice' })) as TeamMember[];
      expect(members).toHaveLength(1);
      expect(members[0]).toMatchObject({ _docId: 'Ualice', name: 'Alice' });

      getCurrentUserMock.mockResolvedValueOnce({ uid: 'me' });
      getDocMock.mockResolvedValueOnce({ exists: () => false, id: 'Ualice', data: () => ({}) });
      const again = (await loadTeamMembers({ id: 't1', captainUid: 'Ualice' })) as TeamMember[];
      expect(again).toHaveLength(1);
      expect(again[0]).toMatchObject({ uid: 'Ualice', _docId: 'legacyDoc1', name: '舊名' });
    });
  });
});

describe('公開讀取與成員讀取的 Firebase 入口', () => {
  it('loadTeams／loadTeam 走 getFirebaseCore，不呼叫 getFirebase', async () => {
    getDocsMock.mockResolvedValueOnce(makeSnapshotDocs([]));
    await loadTeams();
    expect(getFirebaseCoreMock).toHaveBeenCalledTimes(1);
    expect(getFirebaseMock).not.toHaveBeenCalled();

    getFirebaseCoreMock.mockClear();
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      id: 't1',
      data: () => ({ name: 'Team 1' }),
    });
    await loadTeam('t1');
    expect(getFirebaseCoreMock).toHaveBeenCalledTimes(1);
    expect(getFirebaseMock).not.toHaveBeenCalled();
  });

  it('loadTeamMembers 仍走 getFirebase（users 要等 auth），不呼叫 getFirebaseCore', async () => {
    getCurrentUserMock.mockResolvedValueOnce(null);
    await loadTeamMembers({ id: 't1', captainUid: 'cap' });
    expect(getFirebaseMock).toHaveBeenCalledTimes(1);
    expect(getFirebaseCoreMock).not.toHaveBeenCalled();
    expect(getDocsMock).not.toHaveBeenCalled();
  });
});
