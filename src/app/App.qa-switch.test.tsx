// T-047：已用一般（LINE）帳號登入後再 QA 登入，右上角、抽屜與橫幅是否沿用上一位的資料。
// 用真實的 App、TopBar、SideDrawer、useViewer、identity-settings，只模擬 Auth 與 Firestore 讀取，
// 重現站長 2026-10-26 在內測站遇到的「QA 登入後右上角仍是自己的 LINE 頭像」。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import type { AuthUser, QaClaims } from '@/data/auth';
import { emit } from '@/core/events';
import { _resetForTest, registerFeatures } from '@/core/feature-registry';
import { _setDictLoaderForTest, setLocale, t } from '@/i18n/i18n';
import { App } from './App';

const LINE_UID = 'U-line-owner';
const LINE_NAME = '小明LINE';
const LINE_PIC = 'https://profile.line-scdn.net/owner-line-pic.jpg';
const QA_UID = 'qa-captain-uid';
const QA_NAME = 'QA測試-隊長';

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

vi.mock('@/data/auth', () => ({
  signIn: auth.signIn,
  getCurrentUser: auth.getCurrentUser,
  onAuthChanged: auth.onAuthChanged,
  readQaClaims: auth.readQaClaims,
  signOutQa: vi.fn(),
  getLastKnownAuthUid: vi.fn(() => undefined),
}));

vi.mock('@/data/firebase', () => ({
  getFirebase: vi.fn(async () => ({ db: {}, auth: {} })),
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
}));

vi.mock('@/features/inbox/components/PmBubbleHost', () => ({ PmBubbleHost: () => null }));
vi.mock('@/features/inbox/components/PmDialogHost', () => ({ PmDialogHost: () => null }));
vi.mock('./LazyUidQrModal', () => ({ LazyUidQrModal: () => null }));

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
  const el = avatarEl();
  return el instanceof HTMLImageElement && el.getAttribute('src') === LINE_PIC;
}

beforeEach(async () => {
  vi.resetAllMocks();
  vi.stubGlobal('Image', FakeImage);
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
    return { ...state.currentAuth };
  });
  _resetForTest();
  registerFeatures([{
    id: 'qa-switch-home',
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
  vi.unstubAllGlobals();
  _resetForTest();
  _setDictLoaderForTest(null);
});

async function loginAsLine(): Promise<void> {
  render(<App />);
  await waitFor(() => expect(auth.onAuthChanged).toHaveBeenCalled());
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: t('ui.topBar.login') }));
  });
  await waitFor(() => expect(lineAvatarShown()).toBe(true));
  expect(document.querySelector('.user-menu-name')?.textContent).toBe(LINE_NAME);
}

describe('T-047 已用 LINE 登入後再切到 QA 帳號', () => {
  it('QA 資料還在載入的瞬間與載完之後，右上角、選單名稱、整頁都不再出現上一位 LINE 使用者的頭像與名稱', async () => {
    await loginAsLine();

    let releaseQaProfile: () => void = () => undefined;
    state.gates.set(QA_UID, new Promise<void>((resolve) => {
      releaseQaProfile = resolve;
    }));
    state.currentAuth = { uid: QA_UID, displayName: null, pictureUrl: null };
    await act(async () => {
      emit('auth:changed', { uid: QA_UID });
    });

    // QA 的 users 文件還沒回來：不能繼續顯示 LINE 頭像或名稱。
    await waitFor(() => expect(lineAvatarShown()).toBe(false));
    expect(document.querySelector('.user-menu-name')?.textContent).not.toBe(LINE_NAME);
    expect(document.body.innerHTML).not.toContain(LINE_PIC);

    await act(async () => {
      releaseQaProfile();
    });
    await waitFor(() => {
      expect(document.querySelector('.user-menu-name')?.textContent).toBe(QA_NAME);
    });
    const avatar = avatarEl();
    expect(avatar?.tagName).toBe('DIV');
    expect(avatar?.textContent).toBe('Q');
    expect(document.body.innerHTML).not.toContain(LINE_PIC);
    expect(document.body.textContent).not.toContain(LINE_NAME);
    await waitFor(() => {
      expect(document.querySelector('.qa-banner')?.textContent).toContain(QA_NAME);
    });
  });

  it('QA 的 Auth 資料先回、users 文件很晚才回，期間不顯示 LINE 頭像', async () => {
    await loginAsLine();

    state.gates.set(QA_UID, new Promise<void>(() => undefined));
    state.currentAuth = { uid: QA_UID, displayName: QA_NAME, pictureUrl: null };
    await act(async () => {
      emit('auth:changed', { uid: QA_UID });
    });

    await waitFor(() => {
      expect(document.querySelector('.user-menu-name')?.textContent).toBe(QA_NAME);
    });
    expect(lineAvatarShown()).toBe(false);
    expect(document.body.innerHTML).not.toContain(LINE_PIC);
  });
});
