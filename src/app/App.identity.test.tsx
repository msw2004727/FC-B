import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import type { AuthUser } from '@/data/auth';
import { emit } from '@/core/events';
import { _resetForTest, registerFeatures } from '@/core/feature-registry';
import { _setDictLoaderForTest, setLocale } from '@/i18n/i18n';
import { normalizeIdentitySettings, type IdentitySettings } from '@/data/identity-resolver';
import type { ViewerView } from '@/features/profile/data/viewer';
import { App } from './App';

const auth = vi.hoisted(() => ({
  signIn: vi.fn<() => Promise<AuthUser>>(),
  getCurrentUser: vi.fn<() => Promise<AuthUser | null>>(),
  onAuthChanged: vi.fn<(callback: (user: AuthUser | null) => void) => () => void>(),
  stop: vi.fn(),
}));

vi.mock('@/data/auth', () => ({
  signIn: auth.signIn,
  getCurrentUser: auth.getCurrentUser,
  onAuthChanged: auth.onAuthChanged,
}));

const identityMocks = vi.hoisted(() => ({
  useIdentitySettings: vi.fn<() => IdentitySettings | null>(),
  startIdentitySettings: vi.fn(),
  stopIdentitySettings: vi.fn(),
  getIdentitySettings: vi.fn(() => null as IdentitySettings | null),
}));

vi.mock('@/data/identity-settings', () => ({
  useIdentitySettings: identityMocks.useIdentitySettings,
  startIdentitySettings: identityMocks.startIdentitySettings,
  stopIdentitySettings: identityMocks.stopIdentitySettings,
  getIdentitySettings: identityMocks.getIdentitySettings,
  subscribeIdentitySettings: vi.fn(() => () => {}),
  setIdentitySettingsLocal: vi.fn(),
  _resetIdentitySettingsForTest: vi.fn(),
}));

const viewerMocks = vi.hoisted(() => ({
  useViewer: vi.fn<() => ViewerView>(),
}));

vi.mock('@/features/profile/data/viewer', () => ({
  useViewer: viewerMocks.useViewer,
}));

const topBarProps = vi.hoisted(() => ({
  last: null as Record<string, unknown> | null,
}));

vi.mock('@/ui/TopBar', () => ({
  TopBar: (props: Record<string, unknown>) => {
    topBarProps.last = props;
    // 簡化：未登入顯示按鈕，登入後不渲染（欄位由 topBarProps 檢視）。
    if (!props.user) {
      return (
        <button type="button" onClick={props.onLogin as () => void}>
          login-btn
        </button>
      );
    }
    return null;
  },
}));

const sideDrawerProps = vi.hoisted(() => ({
  last: null as Record<string, unknown> | null,
}));

vi.mock('@/ui/SideDrawer', () => ({
  SideDrawer: (props: Record<string, unknown>) => {
    sideDrawerProps.last = props;
    return null;
  },
}));

function settingsWithSecondary(): IdentitySettings | null {
  return normalizeIdentitySettings({
    profileActiveIdentityId: 'secondary',
    identities: {
      secondary: { enabled: true, displayName: '官方帳號', avatarUrl: 'off.jpg' },
    },
  });
}

function makeViewer(hasSecondaryPermission: boolean): ViewerView {
  return {
    uid: 'u1',
    teamIds: new Set<string>(),
    hasPermission: (code: string) =>
      hasSecondaryPermission && code === 'profile.secondary_identity',
    roleLevel: 3,
    role: 'user',
    displayName: '小明',
    pictureUrl: 'pic.jpg',
    capabilities: [],
  };
}

beforeEach(async () => {
  vi.resetAllMocks();
  auth.getCurrentUser.mockResolvedValue(null);
  auth.onAuthChanged.mockReturnValue(auth.stop);
  identityMocks.useIdentitySettings.mockReturnValue(null);
  topBarProps.last = null;
  sideDrawerProps.last = null;
  _resetForTest();
  registerFeatures([{
    id: 'identity-test-home',
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
  _resetForTest();
  _setDictLoaderForTest(null);
});

describe('M-123 App 身份外框（surface chrome）', () => {
  it('第二身份啟用＋有權限 → TopBar 收到 crown 與第二身份名稱/頭像', async () => {
    viewerMocks.useViewer.mockReturnValue(makeViewer(true));
    identityMocks.useIdentitySettings.mockReturnValue(settingsWithSecondary());
    auth.signIn.mockResolvedValue({
      uid: 'u1', displayName: '小明', pictureUrl: 'pic.jpg',
    } as AuthUser);

    render(<App />);
    await waitFor(() => expect(auth.onAuthChanged).toHaveBeenCalled());

    const btn = screen.getByRole('button', { name: 'login-btn' });
    await act(async () => {
      fireEvent.click(btn);
    });

    await waitFor(() => {
      expect(topBarProps.last?.crown).toBe(true);
      const topUser = topBarProps.last?.user as
        | { displayName?: string; pictureUrl?: string }
        | null
        | undefined;
      expect(topUser?.displayName).toBe('官方帳號');
      expect(topUser?.pictureUrl).toBe('off.jpg');
    });

    const identity = sideDrawerProps.last?.identity as
      | { identityId?: string; displayName?: string; avatarCandidates?: string[] }
      | null
      | undefined;
    expect(identity?.identityId).toBe('secondary');
    expect(identity?.displayName).toBe('官方帳號');
    expect(identity?.avatarCandidates).toEqual(['off.jpg']);
  });

  it('第二身份啟用但無權限 → 主身份（crown=false、名稱照 LINE）', async () => {
    viewerMocks.useViewer.mockReturnValue(makeViewer(false));
    identityMocks.useIdentitySettings.mockReturnValue(settingsWithSecondary());
    auth.signIn.mockResolvedValue({
      uid: 'u1', displayName: '小明', pictureUrl: 'pic.jpg',
    } as AuthUser);

    render(<App />);
    await waitFor(() => expect(auth.onAuthChanged).toHaveBeenCalled());

    const btn = screen.getByRole('button', { name: 'login-btn' });
    await act(async () => {
      fireEvent.click(btn);
    });

    await waitFor(() => {
      expect(topBarProps.last?.user).toBeTruthy();
      expect(topBarProps.last?.crown).toBe(false);
    });
    const topUser = topBarProps.last?.user as { displayName?: string } | null | undefined;
    expect(topUser?.displayName).toBe('小明');

    const identity = sideDrawerProps.last?.identity as
      | { identityId?: string; displayName?: string }
      | null
      | undefined;
    expect(identity?.identityId).toBe('main');
    expect(identity?.displayName).toBe('小明');
  });
});

type TopBarUserProp = { uid?: string; displayName?: string | null; pictureUrl?: string | null } | null | undefined;

function viewerWith(overrides: Partial<ViewerView>): ViewerView {
  return { ...makeViewer(false), ...overrides };
}

async function signInAs(user: AuthUser): Promise<ReturnType<typeof render>> {
  auth.signIn.mockResolvedValue(user);
  const view = render(<App />);
  await waitFor(() => expect(auth.onAuthChanged).toHaveBeenCalled());
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'login-btn' }));
  });
  await waitFor(() => expect(topBarProps.last?.user).toBeTruthy());
  return view;
}

describe('T-033 頂部頭像主身份與抽屜用同一份姓名／頭像', () => {
  const noProfile: AuthUser = { uid: 'u1', displayName: null, pictureUrl: null };

  it('Auth 沒有名稱頭像（LINE 使用者的 Auth 帳號只有 uid）、Firestore 有 → TopBar 用 Firestore 的', async () => {
    viewerMocks.useViewer.mockReturnValue(viewerWith({ displayName: '小明', pictureUrl: 'fs.jpg' }));
    await signInAs(noProfile);

    await waitFor(() => {
      const topUser = topBarProps.last?.user as TopBarUserProp;
      expect(topUser?.displayName).toBe('小明');
      expect(topUser?.pictureUrl).toBe('fs.jpg');
    });
    expect(topBarProps.last?.crown).toBe(false);
    const drawerIdentity = sideDrawerProps.last?.identity as { displayName?: string } | null | undefined;
    expect(drawerIdentity?.displayName).toBe('小明');
  });

  it('兩邊都有 → Firestore 優先；Firestore 欄位為 null → 退回 Auth', async () => {
    viewerMocks.useViewer.mockReturnValue(viewerWith({ displayName: 'Firestore名', pictureUrl: null }));
    await signInAs({ uid: 'u1', displayName: 'Auth名', pictureUrl: 'auth.jpg' });

    await waitFor(() => {
      const topUser = topBarProps.last?.user as TopBarUserProp;
      expect(topUser?.displayName).toBe('Firestore名');
      expect(topUser?.pictureUrl).toBe('auth.jpg');
    });
  });

  it('兩邊都沒有名稱頭像 → 維持 null（TopBar 顯示「?」），不退回 uid 或「用戶」', async () => {
    viewerMocks.useViewer.mockReturnValue(viewerWith({ displayName: null, pictureUrl: null }));
    await signInAs(noProfile);

    await waitFor(() => expect(topBarProps.last?.isSyncing).toBe(false));
    const topUser = topBarProps.last?.user as TopBarUserProp;
    expect(topUser?.displayName).toBeNull();
    expect(topUser?.pictureUrl).toBeNull();
    expect(topUser?.uid).toBe('u1');
  });

  it('已登入但 viewer 資料尚未到（訪客快照）→ isSyncing，資料到了才取消並換成 Firestore 名稱', async () => {
    viewerMocks.useViewer.mockReturnValue(viewerWith({ uid: null, displayName: null, pictureUrl: null }));
    const view = await signInAs(noProfile);
    expect(topBarProps.last?.isSyncing).toBe(true);
    expect((topBarProps.last?.user as TopBarUserProp)?.displayName).toBeNull();

    viewerMocks.useViewer.mockReturnValue(viewerWith({ displayName: '小明', pictureUrl: null }));
    // useViewer 是模擬的：外層重繪一次，讓 ViewerAccessBridge 讀到新快照。
    await act(async () => {
      view.rerender(<App />);
    });
    await waitFor(() => {
      expect(topBarProps.last?.isSyncing).toBe(false);
      expect((topBarProps.last?.user as TopBarUserProp)?.displayName).toBe('小明');
    });
  });

  it('viewer 快照是別的 uid（切換帳號的瞬間）→ 不套用別人的名稱，視為尚未同步', async () => {
    viewerMocks.useViewer.mockReturnValue(viewerWith({ uid: 'u-other', displayName: '別人', pictureUrl: 'other.jpg' }));
    await signInAs(noProfile);

    const topUser = topBarProps.last?.user as TopBarUserProp;
    expect(topUser?.displayName).toBeNull();
    expect(topUser?.pictureUrl).toBeNull();
    expect(topBarProps.last?.isSyncing).toBe(true);
  });

  it('Firestore 名稱是空白（\'\'、\'   \'）而 Auth 有名稱 → 退回 Auth 名稱，不被空白擋住', async () => {
    viewerMocks.useViewer.mockReturnValue(viewerWith({ displayName: '   ', pictureUrl: '' }));
    await signInAs({ uid: 'u1', displayName: 'Auth名', pictureUrl: 'auth.jpg' });

    await waitFor(() => {
      const topUser = topBarProps.last?.user as TopBarUserProp;
      expect(topUser?.displayName).toBe('Auth名');
      expect(topUser?.pictureUrl).toBe('auth.jpg');
    });
  });

  it('兩邊名稱頭像都是空白或空字串 → 視為沒有資料（null，TopBar 顯示「?」），空白頭像網址不算有頭像', async () => {
    viewerMocks.useViewer.mockReturnValue(viewerWith({ displayName: '   ', pictureUrl: '  ' }));
    await signInAs({ uid: 'u1', displayName: '', pictureUrl: '\t' });

    await waitFor(() => expect(topBarProps.last?.isSyncing).toBe(false));
    const topUser = topBarProps.last?.user as TopBarUserProp;
    expect(topUser?.displayName).toBeNull();
    expect(topUser?.pictureUrl).toBeNull();
  });

  it('A 登入 → 登出 → B 登入，而 routeAccess 仍是 A 的快照 → B 不套用 A 的姓名／頭像；快照換成 B 後才套用', async () => {
    viewerMocks.useViewer.mockReturnValue(viewerWith({ uid: 'u1', displayName: 'A的名字', pictureUrl: 'a.jpg' }));
    const view = await signInAs({ uid: 'u1', displayName: null, pictureUrl: null });
    await waitFor(() => expect((topBarProps.last?.user as TopBarUserProp)?.displayName).toBe('A的名字'));

    // 登出：user 清空，TopBar 不再收到使用者。
    await act(async () => {
      emit('auth:changed', { uid: null });
    });
    await waitFor(() => expect(topBarProps.last?.user ?? null).toBeNull());
    expect(topBarProps.last?.isSyncing).toBe(false);

    // B 登入：viewer 快照仍是 A 的（useViewer 的 mock 沒變）。
    auth.getCurrentUser.mockResolvedValue({ uid: 'u2', displayName: null, pictureUrl: null });
    await act(async () => {
      emit('auth:changed', { uid: 'u2' });
    });
    await waitFor(() => expect((topBarProps.last?.user as TopBarUserProp)?.uid).toBe('u2'));
    let topUser = topBarProps.last?.user as TopBarUserProp;
    expect(topUser?.displayName).toBeNull();
    expect(topUser?.pictureUrl).toBeNull();
    expect(topBarProps.last?.isSyncing).toBe(true);

    // viewer 快照換成 B 的之後才套用 B 自己的資料。
    viewerMocks.useViewer.mockReturnValue(viewerWith({ uid: 'u2', displayName: 'B的名字', pictureUrl: 'b.jpg' }));
    await act(async () => {
      view.rerender(<App />);
    });
    await waitFor(() => {
      topUser = topBarProps.last?.user as TopBarUserProp;
      expect(topUser?.displayName).toBe('B的名字');
      expect(topUser?.pictureUrl).toBe('b.jpg');
    });
    expect(topBarProps.last?.isSyncing).toBe(false);
  });

  it('未登入 → TopBar 不收到 user，也不顯示同步中', async () => {
    viewerMocks.useViewer.mockReturnValue(viewerWith({ uid: null }));
    render(<App />);
    await waitFor(() => expect(auth.onAuthChanged).toHaveBeenCalled());

    expect(topBarProps.last?.user ?? null).toBeNull();
    expect(topBarProps.last?.isSyncing).toBe(false);
  });
});
