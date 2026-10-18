import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  collectionGroup,
  getDocs,
  query,
  where,
  type Firestore,
} from 'firebase/firestore';
import { getFirebase } from '@/data/firebase';
import { loadViewerRegistrations } from './viewer-registrations';

vi.mock('firebase/firestore', () => ({
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
const whereToken = { kind: 'where' };
const queryToken = { kind: 'query' };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getFirebase).mockResolvedValue({ db } as never);
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
});
