import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeOpLog } from './op-log';
const mocks = vi.hoisted(() => ({ set: vi.fn() }));
vi.mock('@/data/firebase', () => ({ getFirebase: async () => ({ db: {} }) }));
vi.mock('firebase/firestore', () => ({
  doc: () => ({}), serverTimestamp: () => ({}), setDoc: mocks.set,
}));
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });
describe('黑名單管理', () => {
  it('紀錄失敗回報', async () => {
    mocks.set.mockRejectedValue(new Error('targetA'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.fn();
    await expect(writeOpLog({ type: 'event_blocklist_add', typeName: '加入活動黑名單',
      content: '活動「活動」加入黑名單：小明', actorUid: 'uidA', operator: '管理員' }, warn)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledExactlyOnceWith();
    expect(error).not.toHaveBeenCalled();
  });
  it('既有呼叫維持原處理', async () => {
    mocks.set.mockRejectedValue(new Error('測試'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(writeOpLog({ type: 'event_blocklist_add', typeName: '加入活動黑名單',
      content: '活動「活動」加入黑名單：小明', actorUid: 'uidA', operator: '管理員' })).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
  });
});
