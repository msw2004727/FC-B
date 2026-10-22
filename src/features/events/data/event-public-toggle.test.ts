import { beforeEach, expect, it, vi } from 'vitest';
import { saveEventPublic } from './event-public-toggle';

const mocks = vi.hoisted(() => ({
  getFirebase: vi.fn(),
  doc: vi.fn(),
  updateDoc: vi.fn(),
  serverTimestamp: vi.fn(),
}));
vi.mock('@/data/firebase', () => ({ getFirebase: mocks.getFirebase }));
vi.mock('firebase/firestore', () => ({
  doc: mocks.doc, updateDoc: mocks.updateDoc, serverTimestamp: mocks.serverTimestamp,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getFirebase.mockResolvedValue({ db: 'db' });
  mocks.doc.mockReturnValue('ref');
  mocks.serverTimestamp.mockReturnValue('server-time');
  mocks.updateDoc.mockResolvedValue(undefined);
});

it('M-089：只寫文件 ID 下的 isPublic 與 updatedAt', async () => {
  await saveEventPublic('document-id', true);
  expect(mocks.doc).toHaveBeenCalledWith('db', 'events', 'document-id');
  expect(mocks.updateDoc).toHaveBeenCalledWith('ref', {
    isPublic: true, updatedAt: 'server-time',
  });
});

it('空 ID 不寫入；失敗不吞錯，下一次可重試', async () => {
  await expect(saveEventPublic('', true)).rejects.toThrow('EVENT_DOC_NOT_FOUND');
  expect(mocks.updateDoc).not.toHaveBeenCalled();
  mocks.updateDoc.mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce(undefined);
  await expect(saveEventPublic('doc', true)).rejects.toThrow('denied');
  await expect(saveEventPublic('doc', false)).resolves.toBeUndefined();
});
