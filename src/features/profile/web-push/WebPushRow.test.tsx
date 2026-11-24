import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/preact';

vi.mock('@/ui/Toast', () => ({ toast: { show: vi.fn() } }));
const qaState = vi.hoisted(() => ({ value: { persona: 'memberA', agent: null } as unknown }));
vi.mock('@/features/qa-login/data/qa-session', () => ({
  useQaSession: (uid: string | null) => (uid === null ? null : qaState.value),
}));
vi.mock('@/data/liff-init', () => ({ getReadyLiff: vi.fn(() => null) }));
vi.mock('@/ui/SideDrawer', () => ({
  PwaModals: ({ step }: { step: string }) => <div data-testid="pwa-modal" data-step={step} />,
}));

import { getReadyLiff } from '@/data/liff-init';
import { setLocale } from '@/i18n/i18n';
import { toast } from '@/ui/Toast';
import { WEB_PUSH_VAPID_KEY_ID } from './config';
import { _resetWebPushFlowsForTest, _setWebPushDepsForTest } from './flows';
import { _resetWebPushDictForTest } from './i18n';
import { clearWebPushRecord, hash32, writeWebPushRecord } from './store';
import { fakeWorld, trackedSub, type FakeWorld } from './test-fakes';
import { WebPushRow, withOpenExternalBrowser } from './WebPushRow';
import { WebPushCallError } from './wp-callables';

const EP = 'https://fcm.googleapis.com/fcm/send/a';

function use(world: FakeWorld): FakeWorld {
  _setWebPushDepsForTest(world.deps);
  return world;
}

async function seedOn(world: FakeWorld, uid = 'u1'): Promise<void> {
  trackedSub(world, EP);
  writeWebPushRecord({ v: 1, uidHash: await hash32(uid), endpointHash: await hash32(EP), keyId: WEB_PUSH_VAPID_KEY_ID, reportedAt: world.state.now });
}

function stateOf(c: Element): string | null {
  return c.querySelector('.wp-block')?.getAttribute('data-wp-state') ?? null;
}

function toggleOf(c: Element): HTMLInputElement {
  return c.querySelector('.wp-row input[type="checkbox"]') as HTMLInputElement;
}

beforeEach(async () => {
  clearWebPushRecord();
  _resetWebPushFlowsForTest();
  _resetWebPushDictForTest();
  qaState.value = { persona: 'memberA', agent: null };
  vi.mocked(toast.show).mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  await setLocale('zh-TW');
});

afterEach(() => {
  cleanup();
  _setWebPushDepsForTest(null);
  vi.restoreAllMocks();
});

describe('U 推播列', () => {
  it('C 讀取中 → O 可開啟（DOM 照預覽：.wp-block > .line-notify-row.wp-row ＋ .wp-sep）', async () => {
    use(fakeWorld());
    const { container } = render(<WebPushRow uid="u1" env="capable" iosStandalone={false} uiPublic={false} />);
    expect(container.querySelector('.wp-spin[role="status"]')).not.toBeNull();
    await waitFor(() => expect(stateOf(container)).toBe('off'));
    const row = container.querySelector('.wp-block > .line-notify-row.wp-row')!;
    expect(row.textContent).toContain('手機／電腦通知');
    expect(row.querySelector('.line-notify-sub')?.textContent).toBe('報名、取消報名、候補遞補');
    expect(toggleOf(container).checked).toBe(false);
    expect(toggleOf(container).getAttribute('aria-label')).toBe('手機／電腦通知');
    expect(container.querySelector('.wp-block + .wp-sep')).not.toBeNull();
  });

  it('按開關：同步詢問權限 → S（目標位置、不可按）→ N＋開啟提示', async () => {
    const w = use(fakeWorld());
    const { container } = render(<WebPushRow uid="u1" env="capable" iosStandalone={false} uiPublic={false} />);
    await waitFor(() => expect(stateOf(container)).toBe('off'));
    let syncCalls: string[] = [];
    act(() => {
      fireEvent.click(toggleOf(container));
      syncCalls = [...w.calls];
    });
    expect(syncCalls).toContain('requestPermission');
    expect(stateOf(container)).toBe('sending');
    expect(toggleOf(container).checked).toBe(true);
    expect(toggleOf(container).disabled).toBe(true);
    await waitFor(() => expect(stateOf(container)).toBe('on'));
    expect(toast.show).toHaveBeenCalledWith({ message: '已開啟手機／電腦通知' });
  });

  it('展開時不詢問權限', async () => {
    const w = use(fakeWorld());
    const { container } = render(<WebPushRow uid="u1" env="capable" iosStandalone={false} uiPublic={false} />);
    await waitFor(() => expect(stateOf(container)).toBe('off'));
    expect(w.calls).not.toContain('requestPermission');
  });

  it('N → 關閉提示 → O；失敗 → O＋失敗提示；封鎖 → B 無提示', async () => {
    const w = use(fakeWorld({ permission: 'granted' }));
    await seedOn(w);
    const { container } = render(<WebPushRow uid="u1" env="capable" iosStandalone={false} uiPublic={false} />);
    await waitFor(() => expect(stateOf(container)).toBe('on'));
    fireEvent.click(toggleOf(container));
    await waitFor(() => expect(stateOf(container)).toBe('off'));
    expect(toast.show).toHaveBeenCalledWith({ message: '已關閉手機／電腦通知' });

    w.state.registerError = new WebPushCallError('internal');
    fireEvent.click(toggleOf(container));
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith({ message: '開啟失敗，請稍後再試', tone: 'error' }));
    expect(stateOf(container)).toBe('off');
    expect(toggleOf(container).checked).toBe(false);

    cleanup();
    vi.mocked(toast.show).mockClear();
    use(fakeWorld({ answer: 'denied' }));
    const r = render(<WebPushRow uid="u1" env="capable" iosStandalone={false} uiPublic={false} />);
    await waitFor(() => expect(stateOf(r.container)).toBe('off'));
    fireEvent.click(toggleOf(r.container));
    await waitFor(() => expect(stateOf(r.container)).toBe('blocked'));
    expect(toast.show).not.toHaveBeenCalled();
  });

  it('B 已封鎖：標籤＋警示步驟（瀏覽器／iPhone）；回前景重查 → O', async () => {
    const w = use(fakeWorld({ permission: 'denied' }));
    const { container } = render(<WebPushRow uid="u1" env="capable" iosStandalone={false} uiPublic={false} />);
    await waitFor(() => expect(stateOf(container)).toBe('blocked'));
    expect(container.querySelector('.wp-row .line-notify-status.unbound')?.textContent).toBe('已封鎖');
    expect(container.querySelector('.line-notify-hint.wp-hint.warn > span')?.textContent).toBe('網址列左側圖示 → 通知 → 允許');
    expect(toggleOf(container)).toBeNull();
    w.state.permission = 'default';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    // effect 在繪製後才掛監聽：每次重試都送一次回前景事件。
    await waitFor(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      expect(stateOf(container)).toBe('off');
    });
    cleanup();
    use(fakeWorld({ permission: 'denied' }));
    const ios = render(<WebPushRow uid="u1" env="capable" iosStandalone uiPublic={false} />);
    await waitFor(() => expect(stateOf(ios.container)).toBe('blocked'));
    expect(ios.container.querySelector('.wp-hint.warn > span')?.textContent).toBe('設定 → 通知 → ToosterX → 允許');
  });

  it('L1／L2：提示＋按鈕，右側空；按鈕同步開外部瀏覽器；Mini App 走 liff.openWindow', () => {
    use(fakeWorld());
    const assign = vi.fn();
    const loc = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...loc, href: 'https://toosterx.com/profile#x', assign } });
    try {
      const a = render(<WebPushRow uid="u1" env="line-android" iosStandalone={false} uiPublic={false} />);
      expect(a.container.querySelector('.wp-hint > span')?.textContent).toBe('LINE 裡收不到通知');
      const btn = a.container.querySelector('.wp-hint .line-notify-friend-btn') as HTMLButtonElement;
      expect(btn.textContent).toBe('用 Chrome 開啟');
      expect(a.container.querySelector('.wp-row')!.children).toHaveLength(1);
      fireEvent.click(btn);
      expect(assign).toHaveBeenCalledWith('https://toosterx.com/profile?openExternalBrowser=1#x');
      cleanup();
      const openWindow = vi.fn();
      vi.mocked(getReadyLiff).mockReturnValue({ isInClient: () => true, openWindow } as never);
      const b = render(<WebPushRow uid="u1" env="line-ios" iosStandalone={false} uiPublic={false} />);
      const ib = b.container.querySelector('.wp-hint .line-notify-friend-btn') as HTMLButtonElement;
      expect(ib.textContent).toBe('用 Safari 開啟');
      fireEvent.click(ib);
      expect(openWindow).toHaveBeenCalledWith({ url: 'https://toosterx.com/profile#x', external: true });
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: loc });
      vi.mocked(getReadyLiff).mockReturnValue(null);
    }
    expect(withOpenExternalBrowser('https://a.com/p?x=1')).toBe('https://a.com/p?x=1&openExternalBrowser=1');
  });

  it('I：「怎麼加入」開既有 iPhone 安裝教學（PwaModals ios）', async () => {
    use(fakeWorld());
    const { container, findByTestId } = render(<WebPushRow uid="u1" env="ios-home" iosStandalone={false} uiPublic={false} />);
    expect(container.querySelector('.wp-hint > span')?.textContent).toBe('加入主畫面後才能收');
    fireEvent.click(container.querySelector('.wp-hint .line-notify-friend-btn')!);
    expect((await findByTestId('pwa-modal')).getAttribute('data-step')).toBe('ios');
  });

  it('H：沒有 SW 註冊 → 不畫（連分隔線也沒有）', async () => {
    use(fakeWorld({ hasRegistration: false }));
    const { container } = render(<WebPushRow uid="u1" env="capable" iosStandalone={false} uiPublic={false} />);
    await waitFor(() => expect(container.querySelector('.wp-spin')).toBeNull());
    expect(container.innerHTML).toBe('');
  });

  it('Q5：不是 QA 帳號 → 不畫；開通前 QA 判斷中 → 也不畫（不放空白，審查 P2-2）；開通後判斷中才放等高空白', () => {
    use(fakeWorld());
    qaState.value = null;
    const a = render(<WebPushRow uid="u1" env="line-android" iosStandalone={false} uiPublic={false} />);
    expect(a.container.innerHTML).toBe('');
    cleanup();
    qaState.value = undefined;
    const b = render(<WebPushRow uid="u1" env="line-android" iosStandalone={false} uiPublic={false} />);
    expect(b.container.innerHTML).toBe('');
    cleanup();
    const c = render(<WebPushRow uid="u1" env="line-android" iosStandalone={false} uiPublic />);
    expect(c.container.querySelector('.wp-row')).not.toBeNull();
  });

  it('L-43：uid 換人 → 重設並重查（舊 uid 的結果丟棄）', async () => {
    const w = use(fakeWorld({ permission: 'granted' }));
    await seedOn(w, 'u1');
    const { container, rerender } = render(<WebPushRow uid="u1" env="capable" iosStandalone={false} uiPublic={false} />);
    await waitFor(() => expect(stateOf(container)).toBe('on'));
    rerender(<WebPushRow uid="u2" env="capable" iosStandalone={false} uiPublic={false} />);
    await waitFor(() => expect(stateOf(container)).toBe('off'));
  });

  it('語系切換只換字（外語按需載入）', async () => {
    use(fakeWorld());
    const { container } = render(<WebPushRow uid="u1" env="ios-home" iosStandalone={false} uiPublic={false} />);
    await act(async () => {
      await setLocale('en');
    });
    await waitFor(() => expect(container.querySelector('.wp-hint > span')?.textContent).toBe('Add to Home Screen first'));
    expect(container.querySelector('.wp-row')?.textContent).toContain('Phone & computer alerts');
    await act(async () => {
      await setLocale('zh-TW');
    });
  });
});
