import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(async () => ({ db: { __fakeDb: true } })),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, coll: string, id: string) => ({
    kind: 'doc',
    coll,
    id,
  })),
  setDoc: vi.fn(async () => undefined),
  serverTimestamp: vi.fn(() => ({ __serverTimestamp: true })),
}));

import { doc, setDoc, serverTimestamp } from 'firebase/firestore';

import { opLogTimeString, writeOpLog } from './op-log';

const mockSetDoc = vi.mocked(setDoc);
const mockDoc = vi.mocked(doc);
const mockServerTimestamp = vi.mocked(serverTimestamp);

describe('opLogTimeString', () => {
  it('formats MM/DD HH:mm with zero padding', () => {
    expect(opLogTimeString(new Date(2026, 0, 5, 7, 3))).toBe('01/05 07:03');
  });

  it('handles November and hour 15', () => {
    expect(opLogTimeString(new Date(2026, 10, 9, 15, 4))).toBe('11/09 15:04');
  });
});

describe('writeOpLog', () => {
  beforeEach(() => {
    mockSetDoc.mockClear();
    mockDoc.mockClear();
    mockServerTimestamp.mockClear();
  });

  it('writes operationLogs doc with op_<timestamp>_<6 chars> id and A fields', async () => {
    const now = new Date(2026, 4, 9, 15, 30);
    await writeOpLog({
      type: 'event_cancel',
      typeName: '取消活動',
      content: '取消「晨跑」',
      eventId: 'evt-1',
      actorUid: 'uid-1',
      operator: '小明',
      now,
    });

    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    const [ref, payload, options] = mockSetDoc.mock.calls[0]!;
    const refShape = ref as unknown as { coll: string; id: string; kind: string };
    expect(refShape.kind).toBe('doc');
    expect(refShape.coll).toBe('operationLogs');
    expect(refShape.id).toMatch(/^op_\d+_[a-z0-9]{1,6}$/);

    const data = payload as unknown as Record<string, unknown>;
    expect(data.type).toBe('event_cancel');
    expect(data.typeName).toBe('取消活動');
    expect(data.content).toBe('取消「晨跑」');
    expect(data.eventId).toBe('evt-1');
    expect(data.actorUid).toBe('uid-1');
    expect(data.operator).toBe('小明');
    expect(data.time).toBe('05/09 15:30');
    expect(data.createdAt).toEqual({ __serverTimestamp: true });
    expect(options).toEqual({ merge: true });
  });

  it('omits eventId when not provided', async () => {
    await writeOpLog({
      type: 'event_reopen',
      typeName: '重開活動',
      content: '重開「X」',
      actorUid: 'uid-1',
      operator: '小明',
      now: new Date(2026, 4, 9),
    });

    const data = mockSetDoc.mock.calls[0]![1] as unknown as Record<string, unknown>;
    expect('eventId' in data).toBe(false);
    expect(data.type).toBe('event_reopen');
  });

  it('does not throw when setDoc rejects', async () => {
    mockSetDoc.mockRejectedValueOnce(new Error('boom'));
    await expect(
      writeOpLog({
        type: 'event_cancel',
        typeName: '取消活動',
        content: 'x',
        actorUid: 'uid-1',
        operator: 'o',
        now: new Date(),
      }),
    ).resolves.toBeUndefined();
  });
});
