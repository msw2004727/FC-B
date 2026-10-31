/**
 * commitAttendanceBatch：同一次掃碼的多筆記錄只開一個 writeBatch。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const set = vi.fn();
  const commit = vi.fn(() => Promise.resolve());
  const state = { seq: 0 };
  return {
    set,
    commit,
    state,
    writeBatch: vi.fn(() => ({ set, commit })),
    collection: vi.fn((_db: unknown, path: string) => ({ path })),
    doc: vi.fn((first: unknown) => {
      state.seq += 1;
      const coll = first as { path: string };
      return { id: `auto_${state.seq}`, path: `${coll.path}/auto_${state.seq}` };
    }),
    serverTimestamp: vi.fn(() => ({ __serverTimestamp: true })),
  };
});

vi.mock('firebase/firestore', () => ({
  writeBatch: mocks.writeBatch,
  collection: mocks.collection,
  doc: mocks.doc,
  serverTimestamp: mocks.serverTimestamp,
}));

vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(async () => ({ db: { __mockDb: true } })),
}));

import { commitAttendanceBatch, type AttendanceWritePayload } from '../attendance';

function record(
  type: AttendanceWritePayload['type'],
  id: string,
  uid = 'uidA',
): AttendanceWritePayload {
  return {
    id,
    eventId: 'evtA',
    uid,
    userName: uid === 'uidA' ? 'targetA' : uid,
    type,
    time: '2026/10/31 10:00',
  };
}

describe('commitAttendanceBatch', () => {
  beforeEach(() => {
    mocks.state.seq = 0;
    vi.clearAllMocks();
  });

  it('commits an unregistered mark and a check-in in one batch', async () => {
    const ids = await commitAttendanceBatch('evtA', [
      record('unreg', 'att_unreg'),
      record('checkin', 'att_in'),
    ]);

    expect(mocks.writeBatch).toHaveBeenCalledTimes(1);
    expect(mocks.commit).toHaveBeenCalledTimes(1);
    expect(mocks.set).toHaveBeenCalledTimes(2);
    expect(ids).toEqual(['auto_1', 'auto_2']);
    expect(mocks.collection).toHaveBeenCalledWith(
      { __mockDb: true },
      'events/evtA/attendanceRecords',
    );
    expect(mocks.set.mock.calls[0]?.[1]).toMatchObject({
      id: 'att_unreg',
      eventId: 'evtA',
      uid: 'uidA',
      userName: 'targetA',
      type: 'unreg',
      status: 'active',
      createdAt: { __serverTimestamp: true },
    });
    expect(mocks.set.mock.calls[1]?.[1]).toMatchObject({
      type: 'checkin',
      uid: 'uidA',
      eventId: 'evtA',
    });
    expect(mocks.set.mock.calls[0]?.[1]).not.toHaveProperty('operatorUid');
  });

  it('does not open a batch when nothing needs writing', async () => {
    await expect(commitAttendanceBatch('evtA', [])).resolves.toEqual([]);
    expect(mocks.writeBatch).not.toHaveBeenCalled();
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it('rejects a missing event document id before writing', async () => {
    await expect(commitAttendanceBatch('', [record('checkin', 'att_in')])).rejects.toThrow(/eventDocId/);
    expect(mocks.writeBatch).not.toHaveBeenCalled();
  });

  it('rejects operator fields before committing', async () => {
    const bad = {
      ...record('checkin', 'att_in'),
      operatorUid: 'uidB',
    } as AttendanceWritePayload;

    await expect(commitAttendanceBatch('evtA', [bad])).rejects.toThrow(/operatorUid/);
    expect(mocks.writeBatch).not.toHaveBeenCalled();
    expect(mocks.commit).not.toHaveBeenCalled();
  });
});
