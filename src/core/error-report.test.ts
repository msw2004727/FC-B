import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setAppMetaForTest } from './app-meta';

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
  redactHash,
  redactUrl,
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
    sessionStorage.clear();
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
    setAppMetaForTest({ version: 'from-meta' });
  });

  afterEach(() => {
    setAppMetaForTest(null);
    _resetErrorReporterForTest();
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
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
      appVersion: 'from-meta',
      url: location.href,
      hash: '#frag',
      userAgent: navigator.userAgent,
      createdAt: { __serverTimestamp: true },
      source: 'fcb',
    });
    expect(String(payload.errorStack).length).toBeLessThanOrEqual(1500);
    expect(mockServerTimestamp).toHaveBeenCalledTimes(1);
  });

  it('errorMessage 截到 1500 字', async () => {
    currentUser = { uid: 'u1', displayName: '小明' };
    reportClientError('render', new Error('x'.repeat(5000)));
    await waitForWrites(1);
    const payload = mockAddDoc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(String(payload.errorMessage)).toHaveLength(1500);
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

  it('LINE 開頁網址的憑證不寫入（片段全遮值、參數只遮憑證類）', async () => {
    currentUser = { uid: 'u1', displayName: '小明' };
    window.history.replaceState(null, '', '/?code=SECRET_Q1&state=SECRET_Q2&tab=2#access_token=SECRET_H1&context_token=SECRET_H2&client_id=1');
    reportClientError('boot', new Error('boom'));
    await waitForWrites(1);
    const payload = mockAddDoc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.hash).toBe('#access_token=***&context_token=***&client_id=***');
    expect(payload.url).toBe(`${location.origin}/?code=***&state=***&tab=2#access_token=***&context_token=***&client_id=***`);
    expect(JSON.stringify(payload)).not.toContain('SECRET_');
    expect(payload).not.toHaveProperty('diag');
  });

  it('errorMessage／errorStack 夾帶的憑證網址與 JWT 也遮掉', async () => {
    currentUser = { uid: 'u1', displayName: '小明' };
    const err = new Error('failed at https://toosterx.com/?code=SECRET_M1 token eyJhbGciOiJIUzI1NiJ9.SECRET_JWT');
    err.stack = 'global code@https://toosterx.com/?state=SECRET_S1#access_token=SECRET_S2&x=1';
    reportClientError('error', err);
    await waitForWrites(1);
    const payload = mockAddDoc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(JSON.stringify(payload)).not.toContain('SECRET_');
    expect(payload.errorStack).toBe('global code@https://toosterx.com/?state=***#access_token=***&x=1');
  });

  it('非 Error 的 rejection 物件與開頭就是憑證的字串也遮掉', async () => {
    currentUser = { uid: 'u1', displayName: '小明' };
    reportClientError('unhandledrejection', { access_token: 'SECRET_J1', api_key: 'SECRET_J2', ok: 1 });
    reportClientError('unhandledrejection', 'access_token=SECRET_J3 failed');
    await waitForWrites(2);
    expect(JSON.stringify(mockAddDoc.mock.calls)).not.toContain('SECRET_');
  });

  it('從 bfcache 還原後不再標成離開中', async () => {
    currentUser = { uid: 'u1', displayName: '小明' };
    installErrorReporter();
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('pageshow'));
    reportClientError('unhandledrejection', new TypeError('Importing a module script failed.'));
    await waitForWrites(1);
    const payload = mockAddDoc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(JSON.parse(String(payload.diag))).toMatchObject({ leaving: false });
  });

  it('程式檔載入失敗時附上診斷：只列同源 /assets，iOS 沒有 responseStatus 也照寫', async () => {
    currentUser = { uid: 'u1', displayName: '小明' };
    sessionStorage.setItem('fcb:chunk-reload-at', String(NOW - 3000));
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
      { name: `${location.origin}/assets/index-ok.js`, decodedBodySize: 100, transferSize: 120, initiatorType: 'script' },
      { name: 'https://cdn.example.com/assets/other.js', decodedBodySize: 0, transferSize: 0, initiatorType: 'script' },
      { name: `${location.origin}/assets/HomePage-x.js`, decodedBodySize: 0, transferSize: 0, initiatorType: 'other' },
    ] as unknown as PerformanceEntryList);
    // 測試同步更新（R-QA-005）：DIAG-IOS-IMPORT 修法 B 起 pagehide 之後的程式檔載入失敗不上報，這裡改在前景觸發。
    installErrorReporter();
    reportClientError('unhandledrejection', new TypeError('Importing a module script failed.'));
    await waitForWrites(1);
    const payload = mockAddDoc.mock.calls[0]?.[1] as Record<string, unknown>;
    const diag = JSON.parse(String(payload.diag)) as Record<string, unknown>;
    expect(diag).toMatchObject({
      leaving: false,
      vis: 'visible',
      rl: 3000,
      n: 2,
      assets: [
        { f: 'index-ok.js', b: 100, ts: 120, it: 'script' },
        { f: 'HomePage-x.js', b: 0, ts: 0, it: 'other' },
      ],
    });
    expect(diag.sw).toEqual(expect.any(String));
  });

  describe('背景中的程式檔載入失敗（DIAG-IOS-IMPORT 修法 B）', () => {
    let visibility: DocumentVisibilityState = 'visible';

    beforeEach(() => {
      visibility = 'visible';
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    });

    afterEach(() => {
      delete (document as unknown as Record<string, unknown>).visibilityState;
    });

    it('pagehide 之後不上報；bfcache 還原回前景後仍失敗照常上報', async () => {
      currentUser = { uid: 'u1', displayName: '小明' };
      installErrorReporter();
      window.dispatchEvent(new Event('pagehide'));
      reportClientError('unhandledrejection', new TypeError('Importing a module script failed.'));
      await drain();
      expect(mockGetFirebase).not.toHaveBeenCalled();
      expect(mockAddDoc).not.toHaveBeenCalled();

      // 同一則訊息沒有被記進去重：回前景再失敗要寫得進去。
      window.dispatchEvent(new Event('pageshow'));
      reportClientError('unhandledrejection', new TypeError('Importing a module script failed.'));
      await waitForWrites(1);
      const payload = mockAddDoc.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(JSON.parse(String(payload.diag))).toMatchObject({ leaving: false, vis: 'visible' });
    });

    it('頁面隱藏（vis=hidden）時不上報；回前景後仍失敗照常上報', async () => {
      currentUser = { uid: 'u1', displayName: '小明' };
      visibility = 'hidden';
      reportClientError('render', new TypeError('Importing a module script failed.'));
      reportClientError('unhandledrejection', new TypeError('Failed to fetch dynamically imported module: x'));
      await drain();
      expect(mockAddDoc).not.toHaveBeenCalled();

      visibility = 'visible';
      reportClientError('render', new TypeError('Importing a module script failed.'));
      await waitForWrites(1);
      expect(mockAddDoc.mock.calls[0]?.[1]).toMatchObject({ context: 'render' });
    });

    it('隱藏時其他錯誤照常上報（只略過程式檔載入失敗）', async () => {
      currentUser = { uid: 'u1', displayName: '小明' };
      visibility = 'hidden';
      reportClientError('render', new Error('real-bug'));
      await waitForWrites(1);
      expect(mockAddDoc.mock.calls[0]?.[1]).toMatchObject({ errorMessage: 'real-bug' });
    });
  });

  it('Resource Timing 拋錯時仍寫入，診斷只少 assets', async () => {
    currentUser = { uid: 'u1', displayName: '小明' };
    vi.spyOn(performance, 'getEntriesByType').mockImplementation(() => {
      throw new Error('no timing');
    });
    reportClientError('unhandledrejection', new TypeError('Failed to fetch dynamically imported module: x'));
    await waitForWrites(1);
    const payload = mockAddDoc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(JSON.parse(String(payload.diag))).toMatchObject({ assets: [], leaving: false });
  });
});

describe('redactUrl／redactHash', () => {
  it('沒有參數與片段時原樣', () => {
    expect(redactUrl('https://toosterx.com/events/x')).toBe('https://toosterx.com/events/x');
    expect(redactHash('#frag')).toBe('#frag');
    expect(redactHash('')).toBe('');
  });

  it('分號分隔、編碼過的鍵、值裡夾帶的編碼網址都遮', () => {
    expect(redactUrl('https://a.test/?a=1;code=SECRET_1')).toBe('https://a.test/?a=1;code=***');
    expect(redactUrl('https://a.test/?access%5Ftoken=SECRET_2&p=1')).toBe('https://a.test/?access%5Ftoken=***&p=1');
    expect(redactUrl('https://a.test/?next=https%3A%2F%2Fb.test%2F%3Fcode%3DSECRET_3')).toBe('https://a.test/?next=***');
  });

  it('沒有 = 的長片段整段遮掉', () => {
    expect(redactHash('#eyJhbGciOiJIUzI1NiJ9.payload.sig')).toBe('#***');
  });
});
