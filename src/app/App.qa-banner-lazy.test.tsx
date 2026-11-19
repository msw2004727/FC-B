// App 層：QA 橫幅只在 QA 身分才載入模組（入口瘦身 C 案）。
// 照 App.qa-switch.test.tsx 的部分 mock 與啟動方式，不另做一套 Auth／Firestore 假實作。
//
// 隔離：vi.mock 工廠只在 QaBanner 第一次被 import 時執行。一般身分與 QA 身分拆成兩個測試檔，
// 各自有乾淨的模組快取，計數不受執行順序影響（Flash 初審 P2、Opus 交叉審 P3-1；取代原本「同檔、一般身分必須先跑」）。
// 本檔只測QA 身分：經 QaBannerGate 延後載入後橫幅顯示、模組已 import。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import type { AuthUser, QaClaims } from '@/data/auth';
import { emit } from '@/core/events';
import { _resetForTest, registerFeatures } from '@/core/feature-registry';
import { _setDictLoaderForTest, setLocale, t } from '@/i18n/i18n';
import { resetViewerCacheForTest } from '@/features/profile/data/viewer';
import { App } from './App';

const LINE_UID = 'U-line-owner';
const LINE_NAME = '小明LINE';
const LINE_PIC = 'https://profile.line-scdn.net/owner-line-pic.jpg';
const QA_UID = 'qa-captain-uid';
const QA_NAME = 'QA測試-隊長';

const qaBannerImported = vi.hoisted(() => ({ count: 0 }));

const state = vi.hoisted(() => ({
  currentAuth: null as { uid: string; displayName: string | null; pictureUrl: string | null } | null,
  users: {} as Record<string, Record<string, unknown>>,
  gates: new Map<string, Promise<void>>(),
}));

const auth = vi.hoisted(() => ({
  signIn: vi.fn<() => Promise<AuthUser>>(),
  getCurrentUser: vi.fn<() => Promise<AuthUser | null>>(),
  onAuthChanged: vi.fn<(callback: (user: AuthUser | null) => void) => () => void>(),
  readQaClaims: vi.fn<(uid?: string) => Promise<QaClaims | null>>(),
  stop: vi.fn(),
}));

// 兩個模組都用「部分 mock」：只覆寫會連到 Firebase 或需要受控的函式，其餘匯出沿用真實實作。
vi.mock('@/data/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/auth')>()),
  signIn: auth.signIn,
  getCurrentUser: auth.getCurrentUser,
  onAuthChanged: auth.onAuthChanged,
  readQaClaims: auth.readQaClaims,
  signOutQa: vi.fn(),
  getLastKnownAuthUid: vi.fn(() => undefined),
}));

vi.mock('@/data/firebase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/firebase')>()),
  getFirebase: vi.fn(async () => ({ db: {}, auth: {} })),
  getFirebaseCore: vi.fn(async () => ({ db: {} })),
  firebaseTargetLabel: () => 'test',
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, name: string) => ({ _collection: name })),
  doc: vi.fn((_db: unknown, ...segments: string[]) => ({
    _collection: segments[0],
    _id: segments[1],
    _length: segments.length,
  })),
  getDoc: vi.fn(async (ref: { _collection: string; _id: string; _length: number }) => {
    if (ref._collection === 'users' && ref._length === 2) {
      const gate = state.gates.get(ref._id);
      if (gate) await gate;
      const data = state.users[ref._id];
      return { exists: () => data !== undefined, data: () => data };
    }
    return { exists: () => false, data: () => undefined };
  }),
  getDocs: vi.fn(async () => ({ docs: [] })),
  onSnapshot: vi.fn((_ref: unknown, onNext: (snap: { exists: () => boolean }) => void) => {
    onNext({ exists: () => false });
    return () => undefined;
  }),
  query: vi.fn((ref: { _collection: string }) => ({ _collection: ref._collection })),
  where: vi.fn(() => ({})),
  orderBy: vi.fn(() => ({})),
  limit: vi.fn(() => ({})),
}));

vi.mock('@/features/inbox/components/PmBubbleHost', () => ({ PmBubbleHost: () => null }));
vi.mock('@/features/inbox/components/PmDialogHost', () => ({ PmDialogHost: () => null }));
vi.mock('./LazyUidQrModal', () => ({ LazyUidQrModal: () => null }));

// 工廠只在模組第一次被 import 時執行。一般身分不該走到這行。
vi.mock('@/features/qa-login/components/QaBanner', async (importOriginal) => {
  qaBannerImported.count += 1;
  return importOriginal<typeof import('@/features/qa-login/components/QaBanner')>();
});

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  referrerPolicy = '';
  naturalWidth = 64;
  complete = true;
  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

function avatarEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>('#line-avatar-topbar');
}

function lineAvatarShown(): boolean {
  const img = avatarEl()?.querySelector('img');
  return img instanceof HTMLImageElement && img.getAttribute('src') === LINE_PIC;
}

function qaBanner(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.qa-banner');
}

function expectedBannerLabel(): string {
  return t('qa-login.banner.label', { persona: t('qa-login.persona.captain') });
}

beforeEach(async () => {
  vi.resetAllMocks();
  vi.stubGlobal('Image', FakeImage);
  resetViewerCacheForTest();
  state.currentAuth = null;
  state.gates.clear();
  state.users = {
    [LINE_UID]: { role: 'user', displayName: LINE_NAME, pictureUrl: LINE_PIC },
    [QA_UID]: { role: 'captain', displayName: QA_NAME, pictureUrl: null },
  };
  auth.getCurrentUser.mockImplementation(async () => state.currentAuth);
  auth.onAuthChanged.mockReturnValue(auth.stop);
  auth.readQaClaims.mockImplementation(async (uid?: string) =>
    (uid === undefined || uid === QA_UID) && state.currentAuth?.uid === QA_UID
      ? { persona: 'captain', agent: 'agent-1', exp: Date.now() + 3_600_000 }
      : null,
  );
  auth.signIn.mockImplementation(async () => {
    state.currentAuth = { uid: LINE_UID, displayName: LINE_NAME, pictureUrl: LINE_PIC };
    emit('auth:changed', { uid: LINE_UID });
    return { uid: LINE_UID, displayName: LINE_NAME, pictureUrl: LINE_PIC };
  });
  _resetForTest();
  registerFeatures([{
    id: 'qa-banner-lazy-home',
    status: 'enabled',
    routes: [{ path: '/', titleKey: 'nav.home', load: async () => ({ default: () => null }) }],
    nav: [{ path: '/', labelKey: 'nav.home', icon: 'home', order: 2 }],
  }]);
  history.replaceState(null, '', '/');
  _setDictLoaderForTest(null);
  await setLocale('zh-TW');
});

afterEach(() => {
  cleanup();
  resetViewerCacheForTest();
  vi.unstubAllGlobals();
  _resetForTest();
  _setDictLoaderForTest(null);
});

async function loginAsQa(): Promise<void> {
  auth.signIn.mockImplementation(async () => {
    state.currentAuth = { uid: QA_UID, displayName: QA_NAME, pictureUrl: null };
    emit('auth:changed', { uid: QA_UID });
    return { uid: QA_UID, displayName: QA_NAME, pictureUrl: null };
  });
  render(<App />);
  await waitFor(() => expect(auth.onAuthChanged).toHaveBeenCalled());
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: t('ui.topBar.login') }));
  });
}

describe('App QA 橫幅延後載入', () => {
  it('QA 身分：登入後顯示橫幅，且已載入 QaBanner 模組', async () => {
    await loginAsQa();
    await waitFor(() => {
      const banner = qaBanner();
      expect(banner).not.toBeNull();
      expect(banner?.getAttribute('role')).toBe('status');
      expect(banner?.classList.contains('qa-banner')).toBe(true);
      expect(banner?.querySelector('.qa-banner__label')?.textContent).toBe(expectedBannerLabel());
    });
    expect(screen.getByRole('button', { name: t('qa-login.banner.signOut') })).toBeTruthy();
    expect(qaBannerImported.count).toBeGreaterThanOrEqual(1);
  });
});
