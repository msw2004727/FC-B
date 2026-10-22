import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import type { AuthUser } from '@/data/auth';
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
