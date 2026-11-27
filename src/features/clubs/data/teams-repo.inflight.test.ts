import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDocsMock, getDocMock, getFirebaseCoreMock } = vi.hoisted(() => ({
  getDocsMock: vi.fn(),
  getDocMock: vi.fn(),
  getFirebaseCoreMock: vi.fn(async () => ({ db: { kind: 'core' } })),
}));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...paths: string[]) => ({ path: paths.join('/') }),
  doc: (_db: unknown, ...paths: string[]) => ({ path: paths.join('/') }),
  query: (ref: { path: string }, ...constraints: unknown[]) => ({ ...ref, wheres: constraints }),
  where: (field: string, op: string, value: unknown) => ({ type: 'where', field, op, value }),
  limit: (n: number) => ({ type: 'limit', n }),
  documentId: () => '__name__',
  getDocs: getDocsMock,
  getDoc: getDocMock,
}));

vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(async () => ({ db: { kind: 'full' }, auth: null, functions: null })),
  getFirebaseCore: getFirebaseCoreMock,
}));

import { invalidateTeams, loadTeams } from './teams-repo';

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
  getFirebaseCoreMock.mockClear();
  invalidateTeams();
});

describe('loadTeams 進行中合併', () => {
  it('同時兩次呼叫只讀一次，且回傳同一陣列參照', async () => {
    getDocsMock.mockResolvedValueOnce(
      makeSnapshotDocs([{ id: 't1', data: () => ({ name: 'Team 1' }) }]),
    );

    const [first, second] = await Promise.all([loadTeams(), loadTeams()]);

    expect(getDocsMock).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it('讀取中 invalidateTeams：舊讀取不寫回快取，下一次重新讀', async () => {
    let resolveFirst!: (value: unknown) => void;
    const firstRead = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    getDocsMock.mockReturnValueOnce(firstRead);

    const oldRead = loadTeams();
    invalidateTeams();

    resolveFirst(makeSnapshotDocs([{ id: 'old', data: () => ({ name: 'Old' }) }]));
    await oldRead;

    getDocsMock.mockResolvedValueOnce(
      makeSnapshotDocs([{ id: 'new', data: () => ({ name: 'New' }) }]),
    );
    const fresh = await loadTeams();

    expect(getDocsMock).toHaveBeenCalledTimes(2);
    expect(fresh[0]?._docId).toBe('new');
  });

  it('讀取失敗往上丟，且之後再呼叫會重新讀', async () => {
    getDocsMock.mockRejectedValueOnce(new Error('unavailable'));
    await expect(loadTeams()).rejects.toThrow('unavailable');

    getDocsMock.mockResolvedValueOnce(
      makeSnapshotDocs([{ id: 't1', data: () => ({ name: 'Team 1' }) }]),
    );
    const list = await loadTeams();

    expect(list).toHaveLength(1);
    expect(getDocsMock).toHaveBeenCalledTimes(2);
  });
});
