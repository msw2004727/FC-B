import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_VERSION } from '@/version';

interface FakeUser {
  uid: string;
  displayName: string | null;
}

const fakeDb = { kind: 'db' };
let currentUser: FakeUser | null = null;

vi.mock('firebase/firestore', () => ({
  addDoc: vi.fn(async () => ({ id: 'err-1' })),
  collection: vi.fn((db: unknown, name: string) => ({ db, name })),
  serverTimestamp: vi.fn(() => ({ __serverTimestamp: true })),
}));

vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(async () => ({
    auth: { currentUser },
    db: fakeDb,
  })),
}));

import { getFirebase } from '@/data/firebase';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';

import {
  _resetErrorReporterForTest,
  installErrorReporter,
  reportClientError,
} from './error-report';

const mockAddDoc = vi.mocked(addDoc);
const mockCollection = vi.mocked(collection);
const mockServerTimestamp = vi.mocked(serverTimestamp);
const mockGetFirebase = vi.mocked(getFirebase);

const NOW = Date.parse('2026-11-07T16:05:00+08:00');

async function waitForWrites(count: number): Promise<void> {
  await vi.waitFor(() => expect(mockAddDoc).toHaveBeenCalledTimes(count));
}

async function drain(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('error-report', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _resetErrorReporterForTest();
    localStorage.clear();
    currentUser = null;
    window.history.replaceState(null, '', '/');
    mockAddDoc.mockReset();
    mockAddDoc.mockResolvedValue({ id: 'err-1' } as never);
    mockCollection.mockClear();
    mockServerTimestamp.mockClear();
    mockGetFirebase.mockReset();
    mockGetFirebase.mockImplementation(async () => ({
      auth: { currentUser },
      db: fakeDb,
    }) as never);
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    _resetErrorReporterForTest();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('未登入不寫', async () => {
    currentUser = null;
    reportClientError('boot', new Error('guest-boom'));
    await vi.waitFor(() => expect(mockGetFirebase).toHaveBeenCalled());
    await drain();
    expect(mockAddDoc).not.toHaveBeenCalled();
    expect(localStorage.getItem('fcb:errlog-budget')).toBeNull();
  });

  it('登入寫一次且欄位齊全', async () => {
    currentUser = { uid: 'u1', displayName: '小明' };
    window.history.replaceState(null, '', '/activities#frag');
    const err = new Error('boom');
    err.stack = `stack-${'S'.repeat(2000)}`;
    (err as Error & { code: string }).code = 'permission-denied';

    reportClientError('render', err);
    await waitForWrites(1);

    expect(mockCollection).toHaveBeenCalledWith(fakeDb, 'errorLogs');
    const payload = mockAddDoc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload).toEqual({
      time: '2026/11/07 16:05',
      clientTimeIso: '2026-11-07T08:05:00.000Z',
      uid: 'u1',
      userName: '小明',
      role: '',
      context: 'render',
      errorCode: 'permission-denied',
      errorMessage: 'boom',
      errorStack: err.stack.slice(0, 1500),
      errorCategory: '',
      severityHint: '',
      noise: false,
      page: '/activities',
      appVersion: APP_VERSION,
      url: location.href,
      hash: '#frag',
      userAgent: navigator.userAgent,
      createdAt: { __serverTimestamp: true },
      source: 'fcb',
    });
    expect(String(payload.errorStack).length).toBeLessThanOrEqual(1500);
    expect(mockServerTimestamp).toHaveBeenCalledTimes(1);
  });

  it('沒有 displayName 時 userName 用 uid', async () => {
    currentUser = { uid: 'u-only', displayName: null };
    reportClientError('boot', new Error('no-name'));
    await waitForWrites(1);
    expect(mockAddDoc.mock.calls[0]?.[1]).toMatchObject({ userName: 'u-only', uid: 'u-only' });
  });

  it('同訊息去重', async () => {
    currentUser = { uid: 'u1', displayName: '小明' };
    const same = new Error('same-message');
    reportClientError('render', same);
    reportClientError('render', new Error('same-message'));
    reportClientError('boot', new Error('same-message'));
    await waitForWrites(2);
    await drain();
    expect(mockAddDoc).toHaveBeenCalledTimes(2);
    const contexts = mockAddDoc.mock.calls.map((call) => (call[1] as { context: string }).context);
    expect(contexts).toEqual(['render', 'boot']);
  });

  it('每小時上限 5', async () => {
    currentUser = { uid: 'u1', displayName: '小明' };
    for (let i = 0; i < 5; i += 1) reportClientError('render', new Error(`budget-${i}`));
    await waitForWrites(5);
    reportClientError('render', new Error('budget-extra'));
    await drain();
    expect(mockAddDoc).toHaveBeenCalledTimes(5);
    expect(JSON.parse(localStorage.getItem('fcb:errlog-budget') || '[]')).toHaveLength(5);

    vi.spyOn(Date, 'now').mockReturnValue(NOW + 60 * 60 * 1000 + 1);
    reportClientError('render', new Error('budget-next-hour'));
    await waitForWrites(6);
    expect(JSON.parse(localStorage.getItem('fcb:errlog-budget') || '[]')).toEqual([NOW + 60 * 60 * 1000 + 1]);
  });

  it('雜訊略過', async () => {
    currentUser = { uid: 'u1', displayName: '小明' };
    installErrorReporter();
    reportClientError('error', new Error('ResizeObserver loop limit exceeded'));
    reportClientError('error', 'ResizeObserver loop completed with undelivered notifications.');
    reportClientError('error', 'Script error.');
    reportClientError('error', new Error('Script error.'));
    window.dispatchEvent(new ErrorEvent('error', { message: 'Script error.' }));
    window.dispatchEvent(new Event('error'));
    await drain();
    expect(mockGetFirebase).not.toHaveBeenCalled();
    expect(mockAddDoc).not.toHaveBeenCalled();

    reportClientError('error', new Error('real-failure'));
    await waitForWrites(1);
  });

  it('寫入失敗不拋錯', async () => {
    currentUser = { uid: 'u1', displayName: '小明' };
    mockAddDoc.mockImplementation(async () => {
      reportClientError('render', new Error('nested-from-write'));
      throw new Error('permission-denied');
    });
    expect(() => reportClientError('render', new Error('cannot-write'))).not.toThrow();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    await drain();
    expect(mockAddDoc).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[error-report] 寫入失敗', expect.any(Error));
  });

  it('localStorage 壞掉時不拋錯也不寫', async () => {
    currentUser = { uid: 'u1', displayName: '小明' };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => reportClientError('render', new Error('storage-down'))).not.toThrow();
    await drain();
    expect(mockAddDoc).not.toHaveBeenCalled();
    expect(mockGetFirebase).not.toHaveBeenCalled();
  });

  it('等 Auth 還原出 currentUser 才寫', async () => {
    let user: FakeUser | null = null;
    mockGetFirebase.mockImplementation(async () => ({
      auth: {
        get currentUser() {
          return user;
        },
        authStateReady: () => {
          user = { uid: 'late', displayName: '' };
          return Promise.resolve();
        },
      },
      db: fakeDb,
    }) as never);
    reportClientError('boot', new Error('late-user'));
    await waitForWrites(1);
    expect(mockAddDoc.mock.calls[0]?.[1]).toMatchObject({
      context: 'boot',
      uid: 'late',
      userName: 'late',
      source: 'fcb',
    });
  });

  it('installErrorReporter 只註冊一次，並接上 error 與 unhandledrejection', async () => {
    currentUser = { uid: 'u1', displayName: '小明' };
    const listen = vi.spyOn(window, 'addEventListener');
    installErrorReporter();
    installErrorReporter();
    expect(listen.mock.calls.filter((call) => call[0] === 'error')).toHaveLength(1);
    expect(listen.mock.calls.filter((call) => call[0] === 'unhandledrejection')).toHaveLength(1);

    window.dispatchEvent(new ErrorEvent('error', {
      message: 'from-window',
      error: new Error('from-window'),
    }));
    await waitForWrites(1);
    expect(mockAddDoc.mock.calls[0]?.[1]).toMatchObject({ context: 'error', errorMessage: 'from-window' });

    const rejected = Promise.reject(new Error('ignored'));
    rejected.catch(() => {});
    window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', {
      promise: rejected,
      reason: new Error('from-rejection'),
    }));
    await waitForWrites(2);
    expect(mockAddDoc.mock.calls[1]?.[1]).toMatchObject({
      context: 'unhandledrejection',
      errorMessage: 'from-rejection',
    });
  });
});
