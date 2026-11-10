/**
 * T6g／T6h：建立與編輯活動進行中要擋住強制更新，成功與丟錯都要釋放。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { callFnMock, updateDocMock, runTransactionMock } = vi.hoisted(() => ({
  callFnMock: vi.fn(),
  updateDocMock: vi.fn(),
  runTransactionMock: vi.fn(),
}));

vi.mock('@/data/callables', () => ({
  callFn: callFnMock,
  registerMock: vi.fn(),
  clearMocks: vi.fn(),
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, coll: string, id: string) => ({ path: `${coll}/${id}` })),
  updateDoc: updateDocMock,
  runTransaction: runTransactionMock,
  serverTimestamp: vi.fn(() => '__SERVER_TIMESTAMP__'),
}));

vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(async () => ({ db: { kind: 'db' } })),
}));

const coverMocks = vi.hoisted(() => ({
  uploadEventImageVariants: vi.fn(),
  uploadImageDataUrl: vi.fn(),
}));

vi.mock('@/features/events/data/event-cover-upload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./event-cover-upload')>();
  return {
    ...actual,
    uploadEventImageVariants: coverMocks.uploadEventImageVariants,
    uploadImageDataUrl: coverMocks.uploadImageDataUrl,
  };
});

import { _resetSubmitGuardForTest, isSubmitting } from '@/core/submit-guard';
import {
  changeEventCapacity,
  createEvent,
  createEventsBatch,
  EventCreateError,
  updateEventBasics,
  type CreateEventContext,
  type CreateEventForm,
  type EventForEdit,
} from './event-create';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function buildForm(overrides: Partial<CreateEventForm> = {}): CreateEventForm {
  return {
    title: '週末練球',
    type: 'friendly',
    location: '台北市大安運動中心',
    dateVal: '2026-05-15',
    startTime: '15:00',
    endTime: '17:00',
    max: 20,
    minAge: 0,
    notes: '',
    sportTag: 'basketball',
    regOpenTime: null,
    image: 'https://example.com/cover.jpg',
    creatorName: '小明',
    delegates: [],
    regionEnabled: false,
    region: '',
    cities: [],
    feeEnabled: false,
    fee: 0,
    teamOnly: false,
    creatorTeamId: null,
    creatorTeamName: null,
    creatorTeamIds: [],
    creatorTeamNames: [],
    genderRestrictionEnabled: false,
    allowedGender: '',
    privateEvent: false,
    socialLinksEnabled: false,
    socialLinks: [],
    earlyBirdEnabled: false,
    earlyBirdCost: 0,
    earlyBirdPolicyVersion: null,
    teamReservationReleaseHours: 12,
    ...overrides,
  };
}

function buildCtx(): CreateEventContext {
  return {
    uid: 'uid_user_golden',
    role: 'user',
    capabilities: ['user.activity.basic_create', 'user.activity.own_edit_basic'],
    rolePermissions: null,
    userGrants: null,
    customRoles: [],
    now: new Date('2026-05-01T00:00:00.000Z'),
    generateId: () => 'ce_golden_user_basic',
  };
}

const existing: EventForEdit = {
  id: 'ce_public',
  docId: 'legacy-document-id',
  creatorUid: 'uid_user_golden',
  status: 'open',
  current: 0,
  waitlist: 0,
  max: 20,
};

function expectHold(held: boolean): void {
  expect(isSubmitting()).toBe(held);
  if (held) expect(document.documentElement.getAttribute('data-submitting')).toBe('true');
  else expect(document.documentElement.hasAttribute('data-submitting')).toBe(false);
}

beforeEach(() => {
  vi.clearAllMocks();
  coverMocks.uploadEventImageVariants.mockReset();
  coverMocks.uploadEventImageVariants.mockImplementation(
    async (_id: string, variants: CreateEventForm['imageVariants']) => variants,
  );
  coverMocks.uploadImageDataUrl.mockReset();
  coverMocks.uploadImageDataUrl.mockResolvedValue('https://example.com/uploaded.webp');
  updateDocMock.mockReset();
  updateDocMock.mockResolvedValue(undefined);
  runTransactionMock.mockReset();
  runTransactionMock.mockImplementation(async (_db: unknown, fn: (tx: {
    get: () => Promise<{ exists: () => boolean }>;
    set: () => void;
  }) => Promise<unknown>) => fn({
    get: async () => ({ exists: () => false }),
    set: () => undefined,
  }));
  callFnMock.mockReset();
  callFnMock.mockResolvedValue({ success: true, promoted: 0, demoted: 0, current: 0, waitlist: 0 });
  _resetSubmitGuardForTest();
  document.documentElement.removeAttribute('data-submitting');
});

afterEach(() => {
  _resetSubmitGuardForTest();
  document.documentElement.removeAttribute('data-submitting');
});

describe('T6g createEvent／createEventsBatch 送出中', () => {
  it('createEvent 的 transaction 尚未完成時為 true，成功與丟錯後都釋放', async () => {
    const pending = deferred<boolean>();
    runTransactionMock.mockReturnValue(pending.promise);
    const operation = createEvent(buildForm(), buildCtx(), 'ce_public');
    expectHold(true);
    await vi.waitFor(() => expect(runTransactionMock).toHaveBeenCalledTimes(1));
    expectHold(true);
    pending.resolve(false);
    await expect(operation).resolves.toMatchObject({ eventId: 'ce_public', alreadyExisted: false });
    expectHold(false);

    runTransactionMock.mockRejectedValueOnce(new Error('tx 失敗'));
    await expect(createEvent(buildForm(), buildCtx(), 'ce_public')).rejects.toThrow(/tx 失敗/);
    expectHold(false);
  });

  it('createEventsBatch 的 transaction 尚未完成時為 true，丟錯後釋放', async () => {
    const pending = deferred<boolean>();
    runTransactionMock.mockReturnValue(pending.promise);
    const forms = [buildForm(), buildForm({ title: '第二天' })];
    const operation = createEventsBatch(forms, buildCtx(), ['ce_batch_a', 'ce_batch_b'], 'batch_fixed');
    expectHold(true);
    await vi.waitFor(() => expect(runTransactionMock).toHaveBeenCalledTimes(1));
    expectHold(true);
    pending.resolve(false);
    await expect(operation).resolves.toMatchObject({
      eventIds: ['ce_batch_a', 'ce_batch_b'],
      alreadyExisted: false,
    });
    expectHold(false);

    runTransactionMock.mockRejectedValueOnce(new Error('batch 失敗'));
    await expect(createEventsBatch(forms, buildCtx(), ['ce_batch_a', 'ce_batch_b'], 'batch_fixed'))
      .rejects.toThrow(/batch 失敗/);
    expectHold(false);
  });

  it('createEvent 同步驗證失敗也釋放', async () => {
    const operation = createEvent(buildForm(), buildCtx(), 'invalid');
    expectHold(false);
    await expect(operation).rejects.toBeInstanceOf(EventCreateError);
    expectHold(false);
  });
});

describe('T6h updateEventBasics／changeEventCapacity 送出中', () => {
  it('updateDoc 尚未完成時為 true，成功與丟錯後都釋放', async () => {
    const pending = deferred<void>();
    updateDocMock.mockReturnValue(pending.promise);
    const operation = updateEventBasics(existing, buildForm({ title: '已更新' }), buildCtx());
    expectHold(true);
    await vi.waitFor(() => expect(updateDocMock).toHaveBeenCalledTimes(1));
    expectHold(true);
    pending.resolve();
    await expect(operation).resolves.toMatchObject({ updates: expect.objectContaining({ title: '已更新' }) });
    expectHold(false);

    updateDocMock.mockRejectedValueOnce(new Error('更新失敗'));
    await expect(updateEventBasics(existing, buildForm({ title: '又更新' }), buildCtx()))
      .rejects.toThrow(/更新失敗/);
    expectHold(false);
  });

  it('adjustEventCapacity 尚未完成時為 true，成功與丟錯後都釋放', async () => {
    const pending = deferred<{ success: true; promoted: number; demoted: number; current: number; waitlist: number }>();
    callFnMock.mockReturnValue(pending.promise);
    const operation = changeEventCapacity('ce_test_1', 30);
    expectHold(true);
    expect(callFnMock).toHaveBeenCalledWith('adjustEventCapacity', { eventId: 'ce_test_1', newMax: 30 });
    pending.resolve({ success: true, promoted: 0, demoted: 0, current: 1, waitlist: 0 });
    await expect(operation).resolves.toMatchObject({ success: true });
    expectHold(false);

    callFnMock.mockRejectedValueOnce(new Error('boom'));
    await expect(changeEventCapacity('ce_test_1', 30)).rejects.toMatchObject({
      code: 'CAPACITY_ADJUST_FAILED',
    });
    expectHold(false);
  });
});
