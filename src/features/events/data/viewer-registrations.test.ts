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
import { emit } from '@/core/events';
import { loadViewerRegistrations, loadViewerRegistrationsFresh } from './viewer-registrations';
import {
  invalidateViewerRegistrations,
  VIEWER_REGISTRATIONS_TTL_MS,
} from './viewer-registrations-cache';

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
  vi.useRealTimers();
  invalidateViewerRegistrations();
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

describe('O5 全歷史共用快取', () => {
  function snap(uid: string, eventId: string): unknown {
    return {
      docs: [snapshotDoc(`reg-${uid}-${eventId}`, { eventId, userId: uid, status: 'confirmed' }, subcollectionRef())],
    };
  }

  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it('30 秒內同 uid 命中快取，只讀一次；回傳的陣列改了不影響快取', async () => {
    vi.mocked(getDocs).mockResolvedValue(snap('user-1', 'e1') as never);

    const first = await loadViewerRegistrations('user-1');
    first.push({ eventId: 'mutated' } as never);
    const second = await loadViewerRegistrations('user-1');

    expect(getDocs).toHaveBeenCalledTimes(1);
    expect(second).toEqual([
      { eventId: 'e1', userId: 'user-1', status: 'confirmed', _docId: 'reg-user-1-e1' },
    ]);
  });

  it('TTL 到期後重讀', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000);
    vi.mocked(getDocs)
      .mockResolvedValueOnce(snap('user-1', 'old') as never)
      .mockResolvedValueOnce(snap('user-1', 'new') as never);

    await loadViewerRegistrations('user-1');
    vi.setSystemTime(1_000_000 + VIEWER_REGISTRATIONS_TTL_MS - 1);
    expect((await loadViewerRegistrations('user-1'))[0]?.eventId).toBe('old');
    expect(getDocs).toHaveBeenCalledTimes(1);

    vi.setSystemTime(1_000_000 + VIEWER_REGISTRATIONS_TTL_MS);
    expect((await loadViewerRegistrations('user-1'))[0]?.eventId).toBe('new');
    expect(getDocs).toHaveBeenCalledTimes(2);
  });

  it('進行中的請求合併：同時兩次只讀一次，兩邊拿到同樣資料', async () => {
    const pending = deferred<unknown>();
    vi.mocked(getDocs).mockReturnValueOnce(pending.promise as never);

    const a = loadViewerRegistrations('user-1');
    const b = loadViewerRegistrations('user-1');
    await vi.waitFor(() => expect(getDocs).toHaveBeenCalledTimes(1));
    pending.resolve(snap('user-1', 'e1'));

    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toEqual(rb);
    expect(ra).not.toBe(rb);
    expect(getDocs).toHaveBeenCalledTimes(1);
  });

  it('第一次失敗不留快取也不留進行中請求，第二次重新呼叫並成功（L-08、L-30）', async () => {
    vi.mocked(getDocs)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(snap('user-1', 'e1') as never);

    await expect(loadViewerRegistrations('user-1')).rejects.toThrow('offline');
    await expect(loadViewerRegistrations('user-1')).resolves.toHaveLength(1);
    expect(getDocs).toHaveBeenCalledTimes(2);
    // 成功後才進快取
    await loadViewerRegistrations('user-1');
    expect(getDocs).toHaveBeenCalledTimes(2);
  });

  it('uid 切換不串資料：各自讀各自的', async () => {
    vi.mocked(getDocs)
      .mockResolvedValueOnce(snap('user-1', 'e1') as never)
      .mockResolvedValueOnce(snap('user-2', 'e2') as never);

    const one = await loadViewerRegistrations('user-1');
    const two = await loadViewerRegistrations('user-2');

    expect(one.map((r) => r.userId)).toEqual(['user-1']);
    expect(two.map((r) => r.userId)).toEqual(['user-2']);
    expect(where).toHaveBeenNthCalledWith(2, 'userId', '==', 'user-2');
  });

  it('登出（auth:changed uid=null）立即清除，下次重讀', async () => {
    vi.mocked(getDocs).mockResolvedValue(snap('user-1', 'e1') as never);
    await loadViewerRegistrations('user-1');
    emit('auth:changed', { uid: null });
    await loadViewerRegistrations('user-1');
    expect(getDocs).toHaveBeenCalledTimes(2);
  });

  it('同一 uid 再次通知登入不清快取；換成別的 uid 則清除', async () => {
    vi.mocked(getDocs).mockResolvedValue(snap('user-1', 'e1') as never);
    await loadViewerRegistrations('user-1');
    emit('auth:changed', { uid: 'user-1' });
    await loadViewerRegistrations('user-1');
    expect(getDocs).toHaveBeenCalledTimes(1);

    emit('auth:changed', { uid: 'user-2' });
    await loadViewerRegistrations('user-1');
    expect(getDocs).toHaveBeenCalledTimes(2);
  });

  it('非同步回來時 uid 已變：結果照交原呼叫端，但不寫入快取；之後的請求不接舊請求', async () => {
    const pending = deferred<unknown>();
    vi.mocked(getDocs)
      .mockReturnValueOnce(pending.promise as never)
      .mockResolvedValue(snap('user-1', 'fresh') as never);

    const stale = loadViewerRegistrations('user-1');
    await vi.waitFor(() => expect(getDocs).toHaveBeenCalledTimes(1));
    emit('auth:changed', { uid: 'user-2' });
    emit('auth:changed', { uid: 'user-1' });
    // 換帳號後的新請求不會接上換帳號前的進行中請求
    const next = loadViewerRegistrations('user-1');
    await vi.waitFor(() => expect(getDocs).toHaveBeenCalledTimes(2));
    pending.resolve(snap('user-1', 'stale'));

    expect((await stale)[0]?.eventId).toBe('stale');
    expect((await next)[0]?.eventId).toBe('fresh');
    expect((await loadViewerRegistrations('user-1'))[0]?.eventId).toBe('fresh');
    expect(getDocs).toHaveBeenCalledTimes(2);
  });

  it('寫入後失效：進行中的舊讀取晚回來也不寫回快取', async () => {
    const pending = deferred<unknown>();
    vi.mocked(getDocs)
      .mockReturnValueOnce(pending.promise as never)
      .mockResolvedValue(snap('user-1', 'after-write') as never);

    const beforeWrite = loadViewerRegistrations('user-1');
    await vi.waitFor(() => expect(getDocs).toHaveBeenCalledTimes(1));
    invalidateViewerRegistrations();
    pending.resolve(snap('user-1', 'before-write'));
    await beforeWrite;

    expect((await loadViewerRegistrations('user-1'))[0]?.eventId).toBe('after-write');
    expect(getDocs).toHaveBeenCalledTimes(2);
  });

  it('本場查詢與即時讀不經快取', async () => {
    vi.mocked(getDocs).mockResolvedValue(snap('user-1', 'e1') as never);
    await loadViewerRegistrations('user-1');
    await loadViewerRegistrations('user-1', 'event-1');
    await loadViewerRegistrations('user-1', 'event-1');
    await loadViewerRegistrationsFresh('user-1');
    await loadViewerRegistrationsFresh('user-1');
    expect(getDocs).toHaveBeenCalledTimes(5);
    // 即時讀不寫入、不清除快取
    await loadViewerRegistrations('user-1');
    expect(getDocs).toHaveBeenCalledTimes(5);
  });
});
