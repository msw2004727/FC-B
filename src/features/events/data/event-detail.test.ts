/**
 * R-ID-010：public eventId 與 Firestore docId 不同時的路徑解析與子集合讀取。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDocMock, getDocsMock, resolveEventDocIdMock } = vi.hoisted(() => ({
  getDocMock: vi.fn(),
  getDocsMock: vi.fn(),
  resolveEventDocIdMock: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...paths: string[]) => ({ path: paths.join('/') }),
  collection: (_db: unknown, ...paths: string[]) => ({ path: paths.join('/') }),
  query: (ref: unknown) => ref,
  orderBy: (ref: unknown) => ref,
  getDoc: getDocMock,
  getDocs: getDocsMock,
}));

vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(async () => ({ db: { __fake: true }, auth: null, functions: null })),
}));

vi.mock('@/data/paths', async () => {
  const actual = await vi.importActual<typeof import('@/data/paths')>('@/data/paths');
  return {
    ...actual,
    resolveEventDocId: resolveEventDocIdMock,
  };
});

import { loadEventDetail, loadEventRegistrations } from './event-detail';
import type { RegistrationDoc } from './types';

beforeEach(() => {
  getDocMock.mockReset();
  getDocsMock.mockReset();
  resolveEventDocIdMock.mockReset();
});

describe('loadEventDetail', () => {
  it('R-ID-010：public id 與 docId 不同時，先 resolve 再讀 events/{docId}', async () => {
    // 舊活動：public `id` = publicEvt，但 Firestore docId = docId123
    resolveEventDocIdMock.mockResolvedValueOnce('docId123');
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      id: 'docId123',
      data: () => ({ id: 'publicEvt', title: 'Old Event' }),
    });

    const result = await loadEventDetail('publicEvt');
    if (result === null) throw new Error('expected event detail');

    expect(result.eventDocId).toBe('docId123');
    expect(result.event.id).toBe('publicEvt');
    expect(result.event.title).toBe('Old Event');
    expect(result.event._docId).toBe('docId123');

    expect(resolveEventDocIdMock).toHaveBeenCalledTimes(1);
    expect(resolveEventDocIdMock).toHaveBeenCalledWith('publicEvt');
    expect(getDocMock).toHaveBeenCalledTimes(1);

    const ref = getDocMock.mock.calls[0]?.[0] as { path?: string } | undefined;
    expect(ref?.path).toBe('events/docId123');
  });

  it('resolve 失敗時回傳 null（不 fallback 直讀 publicId）', async () => {
    resolveEventDocIdMock.mockResolvedValueOnce(null);
    const result = await loadEventDetail('missing');
    expect(result).toBeNull();
    expect(getDocMock).not.toHaveBeenCalled();
  });

  it('docId 對應文件不存在時回傳 null', async () => {
    resolveEventDocIdMock.mockResolvedValueOnce('docId456');
    getDocMock.mockResolvedValueOnce({ exists: () => false, id: 'docId456', data: () => ({}) });

    const result = await loadEventDetail('evt456');
    expect(result).toBeNull();
    const ref = getDocMock.mock.calls[0]?.[0] as { path?: string } | undefined;
    expect(ref?.path).toBe('events/docId456');
  });
});

describe('loadEventRegistrations', () => {
  it('只讀 events/{docId}/registrations 子集合（父路徑用 docId）', async () => {
    getDocsMock.mockResolvedValueOnce({
      forEach: (cb: (doc: { id: string; data: () => RegistrationDoc }) => void) => {
        cb({ id: 'r1', data: () => ({ userId: 'u1', status: 'confirmed' }) });
        cb({ id: 'r2', data: () => ({ userId: 'u2', status: 'waitlisted' }) });
      },
    });

    const regs = await loadEventRegistrations('docId123');

    expect(regs).toEqual([
      { userId: 'u1', status: 'confirmed', _docId: 'r1' },
      { userId: 'u2', status: 'waitlisted', _docId: 'r2' },
    ]);
    expect(getDocsMock).toHaveBeenCalledTimes(1);

    const q = getDocsMock.mock.calls[0]?.[0] as { path?: string } | undefined;
    expect(q?.path).toBe('events/docId123/registrations');
  });
});
