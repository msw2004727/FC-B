import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(async () => ({ db: {} })),
}));

const updateDocMock = vi.fn(
  async (_ref: unknown, _data: Record<string, unknown>): Promise<void> => undefined,
);
const docMock = vi.fn((_db: unknown, ...segments: unknown[]) => ({
  path: segments.join('/'),
}));
const serverTimestampMock = vi.fn((): string => '__timestamp__');

vi.mock('firebase/firestore', () => ({
  doc: docMock,
  updateDoc: updateDocMock,
  serverTimestamp: serverTimestampMock,
}));

import { saveTitles } from './titles-write';

describe('saveTitles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('只寫 titleBig／titleNormal／updatedAt 三個欄位', async () => {
    await saveTitles('u1', 'Gold', 'Normal');
    expect(updateDocMock).toHaveBeenCalledTimes(1);
    const args = updateDocMock.mock.calls[0];
    expect(args?.[0]).toEqual({ path: 'users/u1' });
    const payload = args?.[1] as Record<string, unknown>;
    expect(payload).toEqual({
      titleBig: 'Gold',
      titleNormal: 'Normal',
      updatedAt: '__timestamp__',
    });
    // 明確斷言只有三個 key，不得夾帶其他欄位。
    expect(Object.keys(payload).sort()).toEqual(['titleBig', 'titleNormal', 'updatedAt']);
  });

  it('空字串轉 null', async () => {
    await saveTitles('u1', '', '');
    const args = updateDocMock.mock.calls[0];
    const payload = args?.[1] as Record<string, unknown>;
    expect(payload['titleBig']).toBeNull();
    expect(payload['titleNormal']).toBeNull();
  });

  it('無 uid 拋錯且不寫入', async () => {
    await expect(saveTitles('', 'a', 'b')).rejects.toThrow();
    expect(updateDocMock).not.toHaveBeenCalled();
  });
});
