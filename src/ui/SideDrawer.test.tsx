import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { useRef, useState } from 'preact/hooks';
import { LocationProvider } from 'preact-iso';
import { SideDrawer, type SideDrawerProps } from './SideDrawer';
import { TopBar } from './TopBar';
import { _resetForTest } from '@/core/feature-registry';
import { _resetOpenExternalForTest, _setLocationAssignForTest } from '@/core/open-external';
import type { RouteAccessContext } from '@/core/feature-types';
import { getTheme, setTheme } from '@/core/theme';
import { setLocale } from '@/i18n/i18n';
import { getToasts, toast } from './Toast';
import * as authMod from '@/data/auth';

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
  _resetOpenExternalForTest();
  Reflect.deleteProperty(window, 'matchMedia');
  _resetForTest();
  setTheme('light');
  document.documentElement.style.fontSize = '';
  localStorage.removeItem('sporthub_font_size');
  localStorage.removeItem('admin_stealth');
});

describe('SideDrawer 內測站功能進度圖示', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('內測站：每個入口文字右側有狀態圖示，鎖定入口為 closed、分享動作入口為 done', () => {
    vi.stubEnv('VITE_INTERNAL_TEST', '1');
    render(<Harness />);
    openDrawer();
    const items = Array.from(document.querySelectorAll('#drawer-menu .drawer-item'));
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item.querySelector('svg.drawer-status')).not.toBeNull();
    const manual = document.querySelector('#drawer-menu [data-action="share"] svg.drawer-status');
    const locked = document.querySelector('#drawer-menu [data-page="page-personal-dashboard"] svg.drawer-status');
    expect(manual?.getAttribute('data-status')).toBe('done');
    expect(locked?.getAttribute('data-status')).toBe('closed');
  });

  it('非內測站：完全不畫狀態圖示', () => {
    vi.stubEnv('VITE_INTERNAL_TEST', '0');
    render(<Harness />);
    openDrawer();
    expect(document.querySelector('#drawer-menu svg.drawer-status')).toBeNull();
  });
});

const CHROME_UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36';
const MINI_APP_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari Line/14.18.0 LIFF';

function spyAssign(): ReturnType<typeof vi.fn> {
  const assign = vi.fn();
  _setLocationAssignForTest(assign);
  return assign;
}

function installStaticEnv(kind: 'browser' | 'mini' | 'pwa'): void {
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(kind === 'mini' ? MINI_APP_UA : CHROME_UA);
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: kind === 'pwa' && query === '(display-mode: standalone)',
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

describe('SideDrawer 靜態頁（說明書、角色說明、隱私、條款）', () => {
  it.each([
    ['一般瀏覽器', 'browser'],
    ['Mini App', 'mini'],
    ['PWA 全螢幕', 'pwa'],
  ] as const)('LocationProvider 內 %s：不走 SPA，走整頁或另開', (_label, kind) => {
    history.replaceState(null, '', '/events/ce_1');
    installStaticEnv(kind);
    const assign = spyAssign();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<Harness />);
    openDrawer();
    fireEvent.click(document.querySelector('[data-action="manual"]') as HTMLElement);
    // 說明書與角色說明成功後會關抽屜；法律連結只在打開時可點。
    openDrawer();
    fireEvent.click(document.querySelector('[data-action="apply-role"]') as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: '了解，前往聯繫' }));
    openDrawer();
    fireEvent.click(screen.getByRole('link', { name: 'ui.sideDrawer.privacyShort' }));
    fireEvent.click(screen.getByRole('link', { name: 'ui.sideDrawer.termsShort' }));
    expect(location.pathname).toBe('/events/ce_1');
    const paths = ['/manual.html', '/roles/', '/privacy', '/terms'];
    if (kind === 'browser') {
      expect(open).not.toHaveBeenCalled();
      expect(assign.mock.calls.map((call) => call[0])).toEqual(paths);
    } else {
      expect(assign).not.toHaveBeenCalled();
      expect(open.mock.calls).toEqual(paths.map((path) => [path, '_blank', 'noopener,noreferrer']));
    }
  });
});

// 測試同步更新（站長 2026-11-13 方案一）：聲明改小字連結，顯示文字用 ui.sideDrawer.privacyShort／termsShort（外語用短名，泰、越不撐出抽屜）。
describe('SideDrawer 隱私權政策與服務條款連結', () => {
  it('用根目錄絕對路徑：在 /events/xxx 這種兩層路徑點開不會變成 /events/privacy.html（Opus 終審 P2）', () => {
    history.replaceState(null, '', '/events/ce_1');
    render(<Harness />);
    openDrawer();
    expect(screen.getByRole('link', { name: 'ui.sideDrawer.privacyShort' }).getAttribute('href')).toBe('/privacy');
    expect(screen.getByRole('link', { name: 'ui.sideDrawer.termsShort' }).getAttribute('href')).toBe('/terms');
  });
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
    // 測試同步更新：照 A（M-168）訪客頭像改為 guest-avatar-icon，不再顯示「?」。
    const guestAvatar = document.getElementById('drawer-avatar');
    expect(guestAvatar?.querySelector('svg.guest-avatar-icon')).not.toBeNull();
    expect(guestAvatar?.textContent).not.toBe('?');
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
    // 測試同步更新：抽屜皇冠改用 A 的 has-identity-crown＋SVG（原本只加 class、畫面上沒有皇冠）
    expect(document.getElementById('drawer-avatar')?.classList.contains('has-identity-crown')).toBe(true);
    expect(document.querySelector('#drawer-avatar svg.identity-crown')).toBeTruthy();

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

  // 測試同步更新（站長 2026-11-13 方案一）：清除快取改名「遇到問題？重設並重新登入」小字鈕，確認框說清楚會登出、會重新載入。
  it('M-011：點「重設並重新登入」先跳確認框（標題、說明、取消／重設），取消不執行', () => {
    const gateSpy = vi.spyOn(authMod, 'signOutForCacheClear').mockResolvedValue(true);
    try {
      render(<Harness />);
      openDrawer();
      const resetBtn = document.querySelector('.drawer-reset-btn') as HTMLButtonElement;
      expect(resetBtn.textContent).toBe('ui.sideDrawer.reset');
      expect(document.querySelector('.drawer-clear-btn')).toBeNull();
      fireEvent.click(resetBtn);
      const modal = document.getElementById('app-confirm-modal')!;
      expect(modal).not.toBeNull();
      const box = modal.querySelector('[role="alertdialog"]')!;
      expect(box.getAttribute('aria-labelledby')).toBe('drawer-reset-title');
      expect(document.getElementById('drawer-reset-title')?.textContent).toBe('ui.sideDrawer.resetTitle');
      expect(document.getElementById('app-confirm-msg')?.textContent).toBe('ui.sideDrawer.resetBody');
      expect(document.getElementById('app-confirm-ok')?.textContent).toBe('ui.sideDrawer.resetConfirm');
      expect(document.getElementById('app-confirm-ok')?.classList.contains('drawer-reset-confirm-ok')).toBe(true);
      fireEvent.click(document.getElementById('app-confirm-cancel')!);
      expect(document.getElementById('app-confirm-modal')).toBeNull();
      expect(gateSpy).not.toHaveBeenCalled();
    } finally {
      gateSpy.mockRestore();
    }
  });

  // 測試同步更新（Grok 第三輪 P2）：登出段改走 signOutForCacheClear（同一道閘、失敗就停），
  // 其內部順序（Firebase → LINE 登出 → 旗標、閘門）由 auth.login-resume.test.ts 驗。
  it('清除快取：先走 signOutForCacheClear（當時 LIFF* 還在），之後才刪 LIFF*', async () => {
    const order: string[] = [];
    localStorage.setItem('LIFF_STORE:test:accessToken', 'token');
    const gateSpy = vi.spyOn(authMod, 'signOutForCacheClear').mockImplementation(async () => {
      order.push(localStorage.getItem('LIFF_STORE:test:accessToken') ? 'signOut(LIFF 還在)' : 'signOut(LIFF 已刪)');
      return true;
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      render(<Harness />);
      openDrawer();
      fireEvent.click(document.querySelector('.drawer-reset-btn') as HTMLButtonElement);
      await act(async () => {
        fireEvent.click(document.getElementById('app-confirm-ok')!);
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      expect(order).toEqual(['signOut(LIFF 還在)']);
      expect(localStorage.getItem('LIFF_STORE:test:accessToken')).toBeNull();
    } finally {
      gateSpy.mockRestore();
      error.mockRestore();
      localStorage.removeItem('LIFF_STORE:test:accessToken');
    }
  });

  it('清除快取與登出清同一份帳號資料清單（B1-05）：含活動快照、本人 QR、隱身開關與重試計數，主題不動', async () => {
    const seeded = ['fcb:events-snapshot:u1', 'shub_qr_uid', 'shub_qr_data', 'admin_stealth', 'shub_c_users'];
    for (const key of seeded) localStorage.setItem(key, 'x');
    localStorage.setItem('fcb-test-keep', 'keep');
    sessionStorage.setItem('_lineLoginRetryCount', '1');
    const gateSpy = vi.spyOn(authMod, 'signOutForCacheClear').mockResolvedValue(true);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      render(<Harness />);
      openDrawer();
      fireEvent.click(document.querySelector('.drawer-reset-btn') as HTMLButtonElement);
      await act(async () => {
        fireEvent.click(document.getElementById('app-confirm-ok')!);
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      for (const key of seeded) expect(localStorage.getItem(key)).toBeNull();
      expect(localStorage.getItem('fcb-test-keep')).toBe('keep');
      expect(sessionStorage.getItem('_lineLoginRetryCount')).toBeNull();
    } finally {
      gateSpy.mockRestore();
      error.mockRestore();
      for (const key of seeded) localStorage.removeItem(key);
      localStorage.removeItem('fcb-test-keep');
      sessionStorage.removeItem('_lineLoginRetryCount');
    }
  });

  it('清除快取時 Firebase 登出失敗：不刪 LIFF*、不清快取（Grok 第三輪 P2）', async () => {
    localStorage.setItem('LIFF_STORE:test:accessToken', 'token');
    localStorage.setItem('shub_c_users', '[]');
    const gateSpy = vi.spyOn(authMod, 'signOutForCacheClear').mockResolvedValue(false);
    try {
      render(<Harness />);
      openDrawer();
      fireEvent.click(document.querySelector('.drawer-reset-btn') as HTMLButtonElement);
      await act(async () => {
        fireEvent.click(document.getElementById('app-confirm-ok')!);
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      expect(gateSpy).toHaveBeenCalledOnce();
      expect(localStorage.getItem('LIFF_STORE:test:accessToken')).toBe('token');
      expect(localStorage.getItem('shub_c_users')).toBe('[]');
    } finally {
      gateSpy.mockRestore();
      localStorage.removeItem('LIFF_STORE:test:accessToken');
      localStorage.removeItem('shub_c_users');
    }
  });

  // 測試同步更新：照 A（M-055）sporthub_font_size 只存數字 16.5／18，最小級 15 時移除，開站腳本才能補上 px。
  it('cycles font size 15px -> 16.5px -> 18px on html style and localStorage sporthub_font_size', () => {
    render(<Harness />);
    openDrawer();
    const btn = document.getElementById('drawer-font-btn') as HTMLButtonElement;
    expect(btn).not.toBeNull();

    act(() => {
      fireEvent.click(btn);
    });
    expect(document.documentElement.style.fontSize).toBe('16.5px');
    expect(localStorage.getItem('sporthub_font_size')).toBe('16.5');
    expect(btn.classList.contains('font-m')).toBe(true);

    act(() => {
      fireEvent.click(btn);
    });
    expect(document.documentElement.style.fontSize).toBe('18px');
    expect(localStorage.getItem('sporthub_font_size')).toBe('18');
    expect(btn.classList.contains('font-l')).toBe(true);

    act(() => {
      fireEvent.click(btn);
    });
    expect(document.documentElement.style.fontSize).toBe('15px');
    expect(localStorage.getItem('sporthub_font_size')).toBeNull();
  });

  // 測試同步更新（站長 2026-11-13 方案一）：深色模式開關改成三段（淺色／深色／跟隨系統），只用圖示、以 aria-label／title 說明。
  it('主題三段：淺色／深色／跟隨系統，圖示鈕帶 aria-label 與 title，選中以 aria-checked 表示', () => {
    setTheme('light');
    render(<Harness />);
    openDrawer();
    const group = screen.getByRole('radiogroup', { name: 'ui.sideDrawer.theme' });
    const radios = Array.from(group.querySelectorAll('[role="radio"]')) as HTMLButtonElement[];
    expect(radios.map((r) => r.getAttribute('data-theme-choice'))).toEqual(['light', 'dark', 'system']);
    for (const r of radios) {
      const mode = r.getAttribute('data-theme-choice');
      expect(r.getAttribute('aria-label')).toBe(`ui.sideDrawer.theme_${mode}`);
      expect(r.getAttribute('title')).toBe(`ui.sideDrawer.theme_${mode}`);
      expect(r.querySelector('svg')).not.toBeNull();
    }
    const checked = (): string[] => radios.filter((r) => r.getAttribute('aria-checked') === 'true').map((r) => r.getAttribute('data-theme-choice')!);
    expect(checked()).toEqual(['light']);

    act(() => { fireEvent.click(screen.getByRole('radio', { name: 'ui.sideDrawer.theme_dark' })); });
    expect(getTheme()).toBe('dark');
    expect(localStorage.getItem('sporthub_theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(checked()).toEqual(['dark']);

    act(() => { fireEvent.click(screen.getByRole('radio', { name: 'ui.sideDrawer.theme_system' })); });
    expect(getTheme()).toBe('system');
    expect(localStorage.getItem('sporthub_theme')).toBeNull();
    expect(checked()).toEqual(['system']);

    act(() => { fireEvent.click(screen.getByRole('radio', { name: 'ui.sideDrawer.theme_light' })); });
    expect(getTheme()).toBe('light');
    expect(checked()).toEqual(['light']);
    expect(document.getElementById('theme-toggle')).toBeNull();
  });

  it('語言鈕：地球＋目前語言縮寫，原生下拉蓋在同一顆上；切成英文後縮寫變 EN', async () => {
    render(<Harness />);
    openDrawer();
    const select = document.getElementById('lang-select') as HTMLSelectElement;
    const pick = select.closest('label.drawer-lang')!;
    expect(pick.closest('.drawer-foot-slab')).not.toBeNull();
    expect(pick.querySelector('.drawer-lang-globe')).not.toBeNull();
    expect(pick.querySelector('.drawer-lang-code')?.textContent).toBe('繁中');
    expect(select.getAttribute('aria-label')).toBe('ui.sideDrawer.language');
    try {
      await act(async () => {
        select.value = 'en';
        // @testing-library/preact 的 fireEvent.change 實際送 input 事件；下拉的 onChange 要真的 change 事件
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await waitFor(() => expect(pick.querySelector('.drawer-lang-code')?.textContent).toBe('EN'), { timeout: 3000 });
    } finally {
      await act(async () => { await setLocale('zh-TW'); });
    }
  });

  it('聲明與重設在玻璃片下方兩行小字；舊的深色開關、粉紅膠囊、清除快取鈕都拿掉', () => {
    render(<Harness />);
    openDrawer();
    const footer = document.querySelector('#side-drawer .drawer-foot')!;
    const rows = Array.from(footer.children).map((el) => el.className);
    expect(rows.slice(0, 3)).toEqual(['drawer-foot-slab', 'drawer-foot-fine drawer-foot-legal', 'drawer-foot-fine']);
    const privacy = screen.getByRole('link', { name: 'ui.sideDrawer.privacyShort' });
    expect(privacy.classList.contains('drawer-foot-link')).toBe(true);
    expect(privacy.closest('.drawer-foot-legal')).not.toBeNull();
    expect(privacy.getAttribute('title')).toBe('隱私權政策');
    expect(footer.querySelector('.drawer-foot-fine:not(.drawer-foot-legal) .drawer-reset-btn')).not.toBeNull();
    expect(document.querySelector('.drawer-legal-btn, .drawer-clear-btn, #theme-toggle, .toggle-switch')).toBeNull();
  });
});
