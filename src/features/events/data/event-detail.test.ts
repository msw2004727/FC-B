/**
 * R-ID-010：public eventId 與 Firestore docId 不同時的路徑解析與子集合讀取。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDocMock, getDocsMock, whereMock, limitMock } = vi.hoisted(() => ({
  getDocMock: vi.fn(),
  getDocsMock: vi.fn(),
  whereMock: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
  limitMock: vi.fn((n: number) => ({ limit: n })),
}));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...paths: string[]) => ({ path: paths.join('/') }),
  collection: (_db: unknown, ...paths: string[]) => ({ path: paths.join('/') }),
  query: (ref: unknown) => ref,
  where: whereMock,
  limit: limitMock,
  orderBy: (ref: unknown) => ref,
  getDoc: getDocMock,
  getDocs: getDocsMock,
}));

vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(async () => ({ db: { __fake: true }, auth: null, functions: null })),
}));

import { resolveEventDocId } from '@/data/paths';
import { loadEventDetail, loadEventRegistrations } from './event-detail';
import type { RegistrationDoc } from './types';

beforeEach(() => {
  getDocMock.mockReset();
  getDocsMock.mockReset();
  whereMock.mockClear();
  limitMock.mockClear();
});

describe('resolveEventDocId', () => {
  it('R-ID-010：events/{id} 存在就回傳該 id，不再 where', async () => {
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      id: 'evtA',
      data: () => ({ id: 'evtA', title: '直接' }),
    });

    await expect(resolveEventDocId('evtA')).resolves.toBe('evtA');
    expect(getDocMock).toHaveBeenCalledTimes(1);
    const ref = getDocMock.mock.calls[0]?.[0] as { path?: string } | undefined;
    expect(ref?.path).toBe('events/evtA');
    expect(getDocsMock).not.toHaveBeenCalled();
    expect(whereMock).not.toHaveBeenCalled();
  });

  it('R-ID-010：直接文件沒有時才 where(\'id\',\'==\',id) limit 1，回傳文件 id', async () => {
    getDocMock.mockResolvedValueOnce({ exists: () => false, id: 'publicEvt', data: () => undefined });
    getDocsMock.mockResolvedValueOnce({
      docs: [{ id: 'docId123', data: () => ({ id: 'publicEvt' }) }],
    });

    await expect(resolveEventDocId('publicEvt')).resolves.toBe('docId123');
    expect(getDocMock).toHaveBeenCalledTimes(1);
    expect(getDocsMock).toHaveBeenCalledTimes(1);
    expect(getDocMock.mock.invocationCallOrder[0]).toBeLessThan(getDocsMock.mock.invocationCallOrder[0] ?? 0);
    const direct = getDocMock.mock.calls[0]?.[0] as { path?: string } | undefined;
    const queried = getDocsMock.mock.calls[0]?.[0] as { path?: string } | undefined;
    expect(direct?.path).toBe('events/publicEvt');
    expect(queried?.path).toBe('events');
    expect(whereMock).toHaveBeenCalledWith('id', '==', 'publicEvt');
    expect(limitMock).toHaveBeenCalledWith(1);
  });

  it('兩段都沒有時回傳 null', async () => {
    getDocMock.mockResolvedValueOnce({ exists: () => false, data: () => undefined });
    getDocsMock.mockResolvedValueOnce({ docs: [] });

    await expect(resolveEventDocId('missing')).resolves.toBeNull();
    expect(getDocMock).toHaveBeenCalledTimes(1);
    expect(getDocsMock).toHaveBeenCalledTimes(1);
  });
});

describe('loadEventDetail', () => {
  it('直接命中時沿用 getDoc 內容，活動文件 getDoc 前 2 後 1', async () => {
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      id: 'evtA',
      data: () => ({ id: 'evtA', title: '直接' }),
    });

    const result = await loadEventDetail('evtA');
    if (result === null) throw new Error('expected event detail');

    expect(result.eventDocId).toBe('evtA');
    expect(result.event.id).toBe('evtA');
    expect(result.event.title).toBe('直接');
    expect(result.event._docId).toBe('evtA');
    expect(getDocMock).toHaveBeenCalledTimes(1);
    expect(getDocsMock).not.toHaveBeenCalled();
    const ref = getDocMock.mock.calls[0]?.[0] as { path?: string } | undefined;
    expect(ref?.path).toBe('events/evtA');
  });

  it('R-ID-010：public id 與 docId 不同時沿用 where 讀到的文件，getDoc 前 2 後 1', async () => {
    // 舊活動：public `id` = publicEvt，但 Firestore docId = docId123
    getDocMock.mockResolvedValueOnce({
      exists: () => false,
      id: 'publicEvt',
      data: () => undefined,
    });
    getDocsMock.mockResolvedValueOnce({
      docs: [{
        id: 'docId123',
        data: () => ({ id: 'publicEvt', title: 'Old Event' }),
      }],
    });

    const result = await loadEventDetail('publicEvt');
    if (result === null) throw new Error('expected event detail');

    expect(result.eventDocId).toBe('docId123');
    expect(result.event.id).toBe('publicEvt');
    expect(result.event.title).toBe('Old Event');
    expect(result.event._docId).toBe('docId123');

    expect(getDocMock).toHaveBeenCalledTimes(1);
    expect(getDocsMock).toHaveBeenCalledTimes(1);
    const ref = getDocMock.mock.calls[0]?.[0] as { path?: string } | undefined;
    expect(ref?.path).toBe('events/publicEvt');
    expect(whereMock).toHaveBeenCalledWith('id', '==', 'publicEvt');
    expect(limitMock).toHaveBeenCalledWith(1);
  });

  it('兩段都找不到時回傳 null，且不再對 publicId 多讀一次', async () => {
    getDocMock.mockResolvedValueOnce({ exists: () => false, id: 'missing', data: () => undefined });
    getDocsMock.mockResolvedValueOnce({ docs: [] });

    const result = await loadEventDetail('missing');
    expect(result).toBeNull();
    expect(getDocMock).toHaveBeenCalledTimes(1);
    expect(getDocsMock).toHaveBeenCalledTimes(1);
    const ref = getDocMock.mock.calls[0]?.[0] as { path?: string } | undefined;
    expect(ref?.path).toBe('events/missing');
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
