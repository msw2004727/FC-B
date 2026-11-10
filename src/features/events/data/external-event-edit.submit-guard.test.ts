/**
 * T6h：外部活動編輯進行中要擋住強制更新，成功與丟錯都要釋放。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetSubmitGuardForTest, isSubmitting } from '@/core/submit-guard';

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  queryRead: vi.fn(),
  update: vi.fn(),
  upload: vi.fn(),
  log: vi.fn(),
}));

vi.mock('@/data/firebase', () => ({ getFirebase: async () => ({ db: 'db' }) }));
vi.mock('./event-cover-upload', () => ({ uploadImageDataUrl: mocks.upload }));
vi.mock('@/data/op-log', () => ({ writeOpLog: mocks.log }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  collection: (_db: unknown, name: string) => name,
  query: (...parts: unknown[]) => parts,
  where: (...parts: unknown[]) => parts,
  limit: (n: number) => ({ limit: n }),
  getDocFromServer: mocks.read,
  getDocsFromServer: mocks.queryRead,
  updateDoc: mocks.update,
  serverTimestamp: () => 'SERVER_TIME',
}));

import {
  buildEventLocationValue,
  resetLocationDraft,
} from '../components/event-form/use-event-location';
import type { OperateContext } from './operate-permissions';
import type { EventDoc } from './types';
import { externalEventEditForm, saveExternalEventEdit } from './external-event-edit';

const event: EventDoc & { sportTag: string } = {
  id: 'public-id',
  _docId: 'legacy-document',
  type: 'external',
  creatorUid: 'owner',
  title: '原活動',
  date: '2026/1/5 09:00~11:00',
  location: '球場',
  externalUrl: 'https://example.test/activity',
  sportTag: 'football',
  image: 'https://example.test/cover',
};

const owner: OperateContext = {
  uid: 'owner',
  role: 'user',
  rolePermissions: [],
  userGrants: null,
  capabilities: ['user.activity.own_edit_basic'],
  customRoles: [],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function expectHold(held: boolean): void {
  expect(isSubmitting()).toBe(held);
  if (held) expect(document.documentElement.getAttribute('data-submitting')).toBe('true');
  else expect(document.documentElement.hasAttribute('data-submitting')).toBe(false);
}

const point = {
  location: '球場',
  lat: 25,
  lng: 121,
  mapAddress: '地址',
  mapPlaceId: 'place',
  mapProvider: 'google' as const,
  mapLocationConfirmed: true,
  mapLocationUpdatedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue({
    id: 'legacy-document',
    exists: () => true,
    data: () => event,
  });
  mocks.queryRead.mockResolvedValue({ docs: [] });
  mocks.update.mockResolvedValue(undefined);
  mocks.upload.mockResolvedValue('https://example.test/uploaded');
  mocks.log.mockResolvedValue(undefined);
  _resetSubmitGuardForTest();
  document.documentElement.removeAttribute('data-submitting');
});

afterEach(() => {
  _resetSubmitGuardForTest();
  document.documentElement.removeAttribute('data-submitting');
});

describe('T6h saveExternalEventEdit 送出中', () => {
  it('updateDoc 尚未完成時為 true，成功與丟錯後都釋放', async () => {
    const form = externalEventEditForm(event);
    const location = buildEventLocationValue(
      resetLocationDraft(point, '球場'),
      '球場',
      true,
      false,
      new Date('2026-11-04T00:00:00Z'),
    );
    const actor = () => ({ context: owner, operator: '主辦人' });
    const pending = deferred<void>();
    mocks.update.mockReturnValue(pending.promise);
    const operation = saveExternalEventEdit(event, { ...form, title: '只改名稱' }, location, actor);
    expectHold(true);
    await vi.waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expectHold(true);
    pending.resolve();
    await expect(operation).resolves.toEqual({ title: '只改名稱' });
    expectHold(false);

    mocks.update.mockRejectedValueOnce(new Error('更新失敗'));
    await expect(saveExternalEventEdit(event, { ...form, title: '再改' }, location, actor))
      .rejects.toThrow(/更新失敗/);
    expectHold(false);
  });

  it('權限不足的同步丟錯也釋放', async () => {
    const form = externalEventEditForm(event);
    const location = buildEventLocationValue(
      resetLocationDraft(point, '球場'),
      '球場',
      true,
      false,
      new Date('2026-11-04T00:00:00Z'),
    );
    const actor = () => ({ context: { ...owner, uid: '' }, operator: '主辦人' });
    const operation = saveExternalEventEdit(event, form, location, actor);
    expectHold(false);
    await expect(operation).rejects.toThrow('權限不足');
    expectHold(false);
  });
});
