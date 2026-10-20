import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { useRef, useState } from 'preact/hooks';
import { LocationProvider } from 'preact-iso';
import { SideDrawer, type SideDrawerProps } from './SideDrawer';
import { TopBar } from './TopBar';
import { _resetForTest } from '@/core/feature-registry';
import type { RouteAccessContext } from '@/core/feature-types';
import { getTheme, setTheme } from '@/core/theme';
import { getToasts, toast } from './Toast';

vi.mock('@/i18n/i18n', async (importOriginal) => ({
  ...(await importOriginal()),
  useT: () => (key: string) => key,
}));

function Harness({
  routeAccess = null,
  user = null,
  identity = null,
}: {
  routeAccess?: SideDrawerProps['routeAccess'];
  user?: SideDrawerProps['user'];
  identity?: SideDrawerProps['identity'];
} = {}): preact.JSX.Element {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <LocationProvider>
      <TopBar menuRef={trigger} drawerOpen={open} onMenuClick={() => setOpen(true)} />
      <SideDrawer
        open={open}
        onClose={() => setOpen(false)}
        returnFocusRef={trigger}
        routeAccess={routeAccess}
        user={user}
        identity={identity}
      />
    </LocationProvider>
  );
}

function openDrawer(): HTMLElement {
  const button = screen.getByRole('button', { name: '選單' });
  button.focus();
  fireEvent.click(button);
  return button;
}

beforeEach(() => {
  _resetForTest();
  toast.clear();
  history.replaceState(null, '', '/');
  setTheme('light');
  document.documentElement.style.fontSize = '';
  localStorage.removeItem('sporthub_font_size');
  localStorage.removeItem('admin_stealth');
});

afterEach(() => {
  cleanup();
  toast.clear();
  vi.restoreAllMocks();
  _resetForTest();
  setTheme('light');
  document.documentElement.style.fontSize = '';
  localStorage.removeItem('sporthub_font_size');
  localStorage.removeItem('admin_stealth');
});

describe('SideDrawer (legacy A DOM & CSS)', () => {
  it('M-001：#drawer-overlay 與 #side-drawer 常駐 DOM，開關靠 .open class 切換', () => {
    render(<Harness />);
    const overlay = document.getElementById('drawer-overlay');
    const drawer = document.getElementById('side-drawer');
    expect(overlay).not.toBeNull();
    expect(drawer).not.toBeNull();
    expect(overlay?.classList.contains('open')).toBe(false);
    expect(drawer?.classList.contains('open')).toBe(false);
    expect(drawer?.closest('.legacy-ui.legacy-chrome')).not.toBeNull();

    openDrawer();
    expect(overlay?.classList.contains('open')).toBe(true);
    expect(drawer?.classList.contains('open')).toBe(true);
  });

  it('U-002：點遮罩或按 Escape 關閉抽屜（移除 .open）並將焦點還回選單按鈕', () => {
    render(<Harness />);
    const btn = openDrawer();
    const overlay = document.getElementById('drawer-overlay')!;
    const drawer = document.getElementById('side-drawer')!;
    fireEvent.click(overlay);
    expect(drawer.classList.contains('open')).toBe(false);
    expect(document.activeElement).toBe(btn);

    openDrawer();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(drawer.classList.contains('open')).toBe(false);
  });

  it('U-001：支援左滑超過寬度 1/3 關閉手勢，位移不足則彈回不關閉', () => {
    render(<Harness />);
    openDrawer();
    const drawer = document.getElementById('side-drawer')!;
    Object.defineProperty(drawer, 'offsetWidth', { value: 270, configurable: true });

    // 位移不足（-40px < 90px）不關閉
    fireEvent.touchStart(drawer, { touches: [{ clientX: 200, clientY: 100 }] });
    fireEvent.touchMove(drawer, { touches: [{ clientX: 160, clientY: 102 }] });
    fireEvent.touchEnd(drawer);
    expect(drawer.classList.contains('open')).toBe(true);

    // 左滑超過 1/3（-120px > 90px）關閉
    fireEvent.touchStart(drawer, { touches: [{ clientX: 200, clientY: 100 }] });
    fireEvent.touchMove(drawer, { touches: [{ clientX: 80, clientY: 102 }] });
    fireEvent.touchEnd(drawer);
    expect(drawer.classList.contains('open')).toBe(false);
  });

  it('M-008：有權限條件的入口（日誌中心）依登入者權限顯示或隱藏', () => {
    const base: RouteAccessContext = {
      uid: 'U_x',
      role: 'admin',
      roleLevel: 4,
      capabilities: [],
      hasPermission: () => false,
    };
    const view = render(<Harness routeAccess={base} />);
    openDrawer();
    expect(document.querySelector('[data-page="page-admin-logs"]')).toBeNull();
    view.unmount();

    render(
      <Harness
        routeAccess={{
          ...base,
          hasPermission: (c) => c === 'admin.logs.entry',
        }}
      />,
    );
    openDrawer();
    expect(document.querySelector('[data-page="page-admin-logs"]')).not.toBeNull();
  });

  it('M-004 & M-005：上鎖入口點擊提示「功能尚未開放」並關閉抽屜；申請入口打開說明彈窗', () => {
    render(<Harness />);
    openDrawer();
    const drawer = document.getElementById('side-drawer')!;
    const personalItem = drawer.querySelector('[data-page="page-personal-dashboard"]') as HTMLElement;
    expect(personalItem).not.toBeNull();
    expect(personalItem.textContent).toContain('🔒');

    fireEvent.click(personalItem);
    expect(getToasts().some((t) => t.message === '功能尚未開放')).toBe(true);
    expect(drawer.classList.contains('open')).toBe(false);

    openDrawer();
    const applyItem = drawer.querySelector('[data-action="apply-role"]') as HTMLElement;
    fireEvent.click(applyItem);
    expect(document.getElementById('role-application-notice-overlay')).not.toBeNull();
  });

  it('M-009 & M-010 & M-014 & M-015 & M-016：訪客顯示「? / 未登入 / 未登入」且無 LINE 登入鈕；管理員可點角色標籤切換隱身', () => {
    const guestView = render(<Harness />);
    openDrawer();
    expect(document.getElementById('drawer-avatar')?.textContent).toBe('?');
    expect(document.getElementById('drawer-name')?.textContent).toBe('未登入');
    expect(document.getElementById('drawer-role-tag')?.textContent).toBe('未登入');
    expect(document.querySelector('#side-drawer .line-login-btn')).toBeNull();
    guestView.unmount();

    const adminAccess: SideDrawerProps['routeAccess'] = {
      uid: 'u1',
      role: 'admin',
      roleLevel: 4,
      displayName: 'Firestore Admin',
      pictureUrl: null,
      capabilities: [],
      hasPermission: () => true,
    };
    render(
      <Harness
        user={{ uid: 'u1', displayName: 'Auth Fallback', pictureUrl: null }}
        routeAccess={adminAccess}
        identity={{ identityId: 'secondary', displayName: '第二暱稱', avatarCandidates: [] }}
      />,
    );
    openDrawer();
    expect(document.getElementById('drawer-name')?.textContent).toBe('第二暱稱');
    expect(document.getElementById('drawer-avatar')?.classList.contains('avatar-identity-crown')).toBe(true);

    const roleTag = document.getElementById('drawer-role-tag')!;
    expect(roleTag.textContent).toBe('管理員');
    fireEvent.click(roleTag);
    expect(getToasts().some((t) => t.message === '已開啟隱身模式')).toBe(true);
    expect(roleTag.style.opacity).toBe('0.45');
  });

  it('M-012：語言選單顯示 6 種語言（含國旗，不含简体中文）', () => {
    render(<Harness />);
    openDrawer();
    const select = document.getElementById('lang-select') as HTMLSelectElement;
    const options = Array.from(select.querySelectorAll('option')).map((o) => ({
      value: o.value,
      text: o.textContent,
    }));
    expect(options).toEqual([
      { value: 'zh-TW', text: '🇹🇼 繁中' },
      { value: 'en', text: '🇺🇸 EN' },
      { value: 'ja', text: '🇯🇵 日本語' },
      { value: 'ko', text: '🇰🇷 한국어' },
      { value: 'th', text: '🇹🇭 ไทย' },
      { value: 'vi', text: '🇻🇳 Tiếng Việt' },
    ]);
  });

  it('M-011：點擊清除快取跳出紅字 Warning 確認框', () => {
    render(<Harness />);
    openDrawer();
    const clearBtn = document.querySelector('.drawer-clear-btn') as HTMLButtonElement;
    fireEvent.click(clearBtn);
    const modal = document.getElementById('app-confirm-modal');
    expect(modal).not.toBeNull();
    expect(modal?.querySelector('.app-confirm-warning')?.textContent).toBe('⚠ Warning');
    fireEvent.click(document.getElementById('app-confirm-cancel')!);
    expect(document.getElementById('app-confirm-modal')).toBeNull();
  });

  it('cycles font size 15px -> 16.5px -> 18px on html style and localStorage sporthub_font_size', () => {
    render(<Harness />);
    openDrawer();
    const btn = document.getElementById('drawer-font-btn') as HTMLButtonElement;
    expect(btn).not.toBeNull();

    fireEvent.click(btn);
    expect(document.documentElement.style.fontSize).toBe('16.5px');
    expect(localStorage.getItem('sporthub_font_size')).toBe('16.5px');
    expect(btn.classList.contains('font-m')).toBe(true);

    fireEvent.click(btn);
    expect(document.documentElement.style.fontSize).toBe('18px');
    expect(localStorage.getItem('sporthub_font_size')).toBe('18px');
    expect(btn.classList.contains('font-l')).toBe(true);

    fireEvent.click(btn);
    expect(document.documentElement.style.fontSize).toBe('15px');
    expect(localStorage.getItem('sporthub_font_size')).toBe('15px');
  });

  it('toggles theme via #theme-toggle', () => {
    setTheme('light');
    render(<Harness />);
    openDrawer();
    const toggle = document.getElementById('theme-toggle')!;
    act(() => {
      fireEvent.click(toggle);
    });
    expect(getTheme()).toBe('dark');
    act(() => {
      fireEvent.click(toggle);
    });
    expect(getTheme()).toBe('light');
  });
});
