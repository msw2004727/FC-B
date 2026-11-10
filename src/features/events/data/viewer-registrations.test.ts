import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  collection,
  collectionGroup,
  getDocs,
  query,
  where,
  type Firestore,
} from 'firebase/firestore';
import { getFirebase } from '@/data/firebase';
import { loadViewerRegistrations } from './viewer-registrations';

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  collectionGroup: vi.fn(),
  getDocs: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
}));

vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(),
}));

interface DocRefLike {
  parent: { parent: unknown | null };
}

function subcollectionRef(): DocRefLike {
  return { parent: { parent: { id: 'events' } } };
}

function rootRef(): DocRefLike {
  return { parent: { parent: null } };
}

function snapshotDoc(
  id: string,
  data: Record<string, unknown>,
  ref: DocRefLike,
): unknown {
  return {
    id,
    data: () => data,
    ref,
  };
}

const db = { name: 'seed-db' } as unknown as Firestore;
const groupToken = { kind: 'collection-group' };
const collectionToken = { kind: 'collection' };
const whereToken = { kind: 'where' };
const queryToken = { kind: 'query' };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getFirebase).mockResolvedValue({ db } as never);
  vi.mocked(collection).mockReturnValue(collectionToken as never);
  vi.mocked(collectionGroup).mockReturnValue(groupToken as never);
  vi.mocked(where).mockReturnValue(whereToken as never);
  vi.mocked(query).mockReturnValue(queryToken as never);
});

describe('loadViewerRegistrations', () => {
  it('queries collectionGroup registrations by userId and excludes legacy root docs', async () => {
    vi.mocked(getDocs).mockResolvedValue({
      docs: [
        snapshotDoc(
          'reg-cancelled',
          { eventId: 'event-1', userId: 'user-1', status: 'cancelled' },
          subcollectionRef(),
        ),
        snapshotDoc(
          'reg-removed',
          { eventId: 'event-2', userId: 'user-1', status: 'removed' },
          subcollectionRef(),
        ),
        snapshotDoc(
          'legacy-root-reg',
          { eventId: 'event-3', userId: 'user-1', status: 'confirmed' },
          rootRef(),
        ),
      ],
    } as never);

    const result = await loadViewerRegistrations('user-1');

    expect(collection).not.toHaveBeenCalled();
    expect(collectionGroup).toHaveBeenCalledWith(db, 'registrations');
    expect(where).toHaveBeenCalledWith('userId', '==', 'user-1');
    expect(query).toHaveBeenCalledWith(groupToken, whereToken);
    expect(getDocs).toHaveBeenCalledWith(queryToken);
    expect(result).toEqual([
      {
        eventId: 'event-1',
        userId: 'user-1',
        status: 'cancelled',
        _docId: 'reg-cancelled',
      },
      {
        eventId: 'event-2',
        userId: 'user-1',
        status: 'removed',
        _docId: 'reg-removed',
      },
    ]);
  });

  it('propagates query failures to the caller', async () => {
    vi.mocked(getDocs).mockRejectedValue(new Error('query failed'));

    await expect(loadViewerRegistrations('user-1')).rejects.toThrow('query failed');
  });

  it('有 eventDocId 時只查該場子集合，保留取消與移除，不加 status 與 limit', async () => {
    vi.mocked(getDocs).mockResolvedValue({
      docs: [
        snapshotDoc(
          'reg-cancelled',
          { eventId: 'event-1', userId: 'user-1', status: 'cancelled' },
          subcollectionRef(),
        ),
        snapshotDoc(
          'reg-removed',
          { eventId: 'event-1', userId: 'user-1', status: 'removed' },
          subcollectionRef(),
        ),
      ],
    } as never);

    const result = await loadViewerRegistrations('user-1', 'event-1');

    expect(collection).toHaveBeenCalledWith(db, 'events/event-1/registrations');
    expect(collectionGroup).not.toHaveBeenCalled();
    expect(where).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledWith('userId', '==', 'user-1');
    expect(query).toHaveBeenCalledWith(collectionToken, whereToken);
    expect(result).toEqual([
      { eventId: 'event-1', userId: 'user-1', status: 'cancelled', _docId: 'reg-cancelled' },
      { eventId: 'event-1', userId: 'user-1', status: 'removed', _docId: 'reg-removed' },
    ]);
  });

  it('本場查沒有文件時不退回全歷史', async () => {
    vi.mocked(getDocs).mockResolvedValue({ docs: [] } as never);

    await expect(loadViewerRegistrations('user-1', 'event-1')).resolves.toEqual([]);
    expect(collectionGroup).not.toHaveBeenCalled();
  });

  it('空白或含斜線的 eventDocId 走全歷史', async () => {
    vi.mocked(getDocs).mockResolvedValue({ docs: [] } as never);

    await loadViewerRegistrations('user-1', 'events/nested');
    expect(collection).not.toHaveBeenCalled();
    expect(collectionGroup).toHaveBeenCalledWith(db, 'registrations');
  });

  it('failed-precondition 或 permission-denied 才退回全歷史', async () => {
    vi.mocked(getDocs)
      .mockRejectedValueOnce(Object.assign(new Error('index'), { code: 'failed-precondition' }))
      .mockResolvedValueOnce({
        docs: [
          snapshotDoc(
            'reg-ok',
            { eventId: 'event-9', userId: 'user-1', status: 'confirmed' },
            subcollectionRef(),
          ),
        ],
      } as never);

    const first = await loadViewerRegistrations('user-1', 'event-1');
    expect(collectionGroup).toHaveBeenCalledWith(db, 'registrations');
    expect(first).toEqual([
      { eventId: 'event-9', userId: 'user-1', status: 'confirmed', _docId: 'reg-ok' },
    ]);

    vi.mocked(getDocs).mockReset();
    vi.mocked(collectionGroup).mockClear();
    vi.mocked(getDocs)
      .mockRejectedValueOnce(Object.assign(new Error('rules'), { code: 'firestore/permission-denied' }))
      .mockResolvedValueOnce({ docs: [] } as never);
    await expect(loadViewerRegistrations('user-1', 'event-1')).resolves.toEqual([]);
    expect(collectionGroup).toHaveBeenCalledTimes(1);
  });

  it('網路錯誤不退回全歷史', async () => {
    vi.mocked(getDocs).mockRejectedValue(Object.assign(new Error('offline'), { code: 'unavailable' }));

    await expect(loadViewerRegistrations('user-1', 'event-1')).rejects.toThrow('offline');
    expect(collectionGroup).not.toHaveBeenCalled();
  });
});
