/** 取消／重新開放活動的狀態寫入進行中要擋住強制更新，成功與失敗都釋放。 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, coll: string, id: string) => ({ coll, id })),
  updateDoc: vi.fn(async () => undefined),
  setDoc: vi.fn(async () => undefined),
  serverTimestamp: vi.fn(() => ({ __serverTimestamp: true })),
}));
vi.mock('@/data/firebase', () => ({ getFirebase: vi.fn(async () => ({ db: {} })) }));
vi.mock('@/data/notify', () => ({
  sendTemplateNotification: vi.fn(async () => ({ delivered: true, linePushed: false })),
}));
vi.mock('./event-change-notify', () => ({ loadEventNotifyRecipientUids: vi.fn(async () => []) }));
vi.mock('./event-detail', () => ({ loadEventRegistrations: vi.fn(async () => []) }));

import { updateDoc } from 'firebase/firestore';
import { _resetSubmitGuardForTest, isSubmitting } from '@/core/submit-guard';
import type { ViewerView } from '@/features/profile/data/viewer';
import { cancelEvent } from './event-lifecycle';
import type { EventDoc } from './types';

const viewer: ViewerView = {
  uid: 'u1', teamIds: new Set<string>(), hasPermission: () => true, roleLevel: 4, role: 'admin',
  displayName: '管理員甲', pictureUrl: null, capabilities: [],
  permissionSources: { rolePermissions: null, userGrants: [], customRoles: [] },
};
const input = () => ({
  event: { id: 'evt-1', title: 'X', status: 'open', creatorUid: 'u1', date: '2099/06/01 07:00~09:00' } as unknown as EventDoc,
  eventDocId: 'doc-1',
  viewer,
  now: new Date(Date.parse('2026-05-09T10:00:00+08:00')),
});

beforeEach(() => {
  vi.mocked(updateDoc).mockReset();
  vi.mocked(updateDoc).mockResolvedValue(undefined);
  _resetSubmitGuardForTest();
});

describe('cancelEvent 狀態寫入送出中', () => {
  it('updateDoc 進行中為 true，成功後釋放', async () => {
    let resolve!: () => void;
    vi.mocked(updateDoc).mockReturnValue(new Promise<void>((r) => { resolve = r; }));
    const operation = cancelEvent(input());
    await vi.waitFor(() => expect(updateDoc).toHaveBeenCalledTimes(1));
    expect(isSubmitting()).toBe(true);
    resolve();
    await expect(operation).resolves.toBeUndefined();
    expect(isSubmitting()).toBe(false);
  });

  it('updateDoc 丟錯後也釋放', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(updateDoc).mockRejectedValue(new Error('boom'));
    await expect(cancelEvent(input())).rejects.toMatchObject({ code: 'WRITE_FAILED' });
    expect(isSubmitting()).toBe(false);
  });
});
