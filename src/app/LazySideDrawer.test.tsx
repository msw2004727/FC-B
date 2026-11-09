import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { LocationProvider, useLocation } from 'preact-iso';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROUTE_LOAD_FAILED_MSG } from '@/core/unavailable';
import type { SideDrawerProps } from '@/ui/SideDrawer';
import {
  LazySideDrawer,
  _resetSideDrawerLoaderForTest,
  loadSideDrawer,
  type SideDrawerComponent,
} from './LazySideDrawer';

const toastShow = vi.hoisted(() => vi.fn());
vi.mock('@/ui/Toast', () => ({ toast: { show: toastShow } }));

/** 記下每次 render 收到的 open。 */
const renders: boolean[] = [];
const FakeDrawer = ((props: SideDrawerProps) => {
  renders.push(props.open);
  return <nav id="side-drawer" class={props.open ? 'open' : ''} data-testid="drawer" />;
}) as unknown as SideDrawerComponent;

function deferred(): {
  promise: Promise<{ SideDrawer: SideDrawerComponent }>;
  resolve: () => void;
  reject: (err: Error) => void;
} {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<{ SideDrawer: SideDrawerComponent }>((res, rej) => {
    resolve = () => res({ SideDrawer: FakeDrawer });
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** LazySideDrawer 用 useLocation 判斷換頁，和 App 一樣放在 LocationProvider 裡。 */
function wrapper({ children }: { children?: ComponentChildren }) {
  return <LocationProvider>{children}</LocationProvider>;
}

function overlay(): HTMLElement | null {
  return document.getElementById('drawer-overlay');
}

/** 模擬 App：open 由狀態控制、onClose 會真的關；另有一顆換頁按鈕（像點底部分頁）。 */
function Harness({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  const { route } = useLocation();
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>選單</button>
      <button type="button" onClick={() => route('/teams')}>換頁</button>
      <LazySideDrawer
        open={open}
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
      />
    </>
  );
}

beforeEach(() => {
  history.replaceState(null, '', '/');
  renders.length = 0;
  toastShow.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  _resetSideDrawerLoaderForTest();
});

describe('LazySideDrawer（首頁瘦身：側邊選單不放進首頁主程式）', () => {
  it('掛上就開始下載；下載完以關閉狀態掛上，之後開關照 props', async () => {
    const d = deferred();
    const importer = vi.fn(() => d.promise);
    _resetSideDrawerLoaderForTest(importer);
    const view = render(<LazySideDrawer open={false} onClose={() => undefined} />, { wrapper });

    expect(importer).toHaveBeenCalledTimes(1);
    expect(view.container.ownerDocument.getElementById('side-drawer')).toBeNull();

    await act(async () => {
      d.resolve();
    });
    await waitFor(() => expect(document.getElementById('side-drawer')).not.toBeNull());
    expect(document.getElementById('side-drawer')?.className).toBe('');

    view.rerender(<LazySideDrawer open onClose={() => undefined} />);
    await waitFor(() => expect(document.getElementById('side-drawer')?.className).toBe('open'));
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it('下載完之前就按了選單：先蓋上遮罩；下載完選單直接以開啟狀態掛上，遮罩換成選單自己的', async () => {
    const d = deferred();
    _resetSideDrawerLoaderForTest(() => d.promise);
    render(<Harness />, { wrapper });
    expect(overlay()).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '選單' }));
    await waitFor(() => expect(overlay()?.className).toBe('open'));
    // 和選單同一個遮罩：放在 .legacy-ui 裡才吃得到首屏 layout.css 的樣式
    expect(overlay()?.closest('.legacy-ui.legacy-chrome')).not.toBeNull();
    expect(document.getElementById('side-drawer')).toBeNull();

    await act(async () => {
      d.resolve();
    });
    await waitFor(() => expect(document.getElementById('side-drawer')?.className).toBe('open'));
    expect(renders).toEqual([true]);
    expect(overlay()).toBeNull(); // 假選單沒有遮罩：佔位遮罩已拿掉，不會疊兩層
  });

  it('下載中點遮罩：關閉（呼叫 onClose），遮罩消失；下載完以關閉狀態掛上', async () => {
    const d = deferred();
    _resetSideDrawerLoaderForTest(() => d.promise);
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: '選單' }));
    await waitFor(() => expect(overlay()).not.toBeNull());

    fireEvent.click(overlay()!);
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(overlay()).toBeNull());

    await act(async () => {
      d.resolve();
    });
    await waitFor(() => expect(document.getElementById('side-drawer')).not.toBeNull());
    expect(document.getElementById('side-drawer')?.className).toBe('');
  });

  it('下載中換頁：選單收回；下載完不會在新頁面打開', async () => {
    const d = deferred();
    _resetSideDrawerLoaderForTest(() => d.promise);
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: '選單' }));
    await waitFor(() => expect(overlay()).not.toBeNull());

    // 遮罩擋住畫面時理論上點不到底下的分頁；這裡直接換頁，模擬返回鍵等其他換頁途徑
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '換頁' }));
    });
    await waitFor(() => expect(location.pathname).toBe('/teams'));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(overlay()).toBeNull());

    await act(async () => {
      d.resolve();
    });
    await waitFor(() => expect(document.getElementById('side-drawer')).not.toBeNull());
    expect(document.getElementById('side-drawer')?.className).toBe('');
    expect(renders.every((open) => open === false)).toBe(true);
  });

  it('選單關著時換頁：不呼叫 onClose', async () => {
    _resetSideDrawerLoaderForTest(() => new Promise(() => undefined));
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />, { wrapper });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '換頁' }));
    });
    await waitFor(() => expect(location.pathname).toBe('/teams'));
    expect(onClose).not.toHaveBeenCalled();
    expect(overlay()).toBeNull();
  });

  it('已下載過：再次掛上直接用快取，不重新下載、不顯示佔位遮罩', async () => {
    const importer = vi.fn(async () => ({ SideDrawer: FakeDrawer }));
    _resetSideDrawerLoaderForTest(importer);
    await loadSideDrawer();
    render(<LazySideDrawer open onClose={() => undefined} />, { wrapper });

    expect(document.getElementById('side-drawer')?.className).toBe('open');
    expect(renders).toEqual([true]);
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it('選單開著等下載卻失敗：提示「頁面載入失敗」並收回選單；再點一次會重新下載並打開', async () => {
    const first = deferred();
    const second = deferred();
    const importer = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    _resetSideDrawerLoaderForTest(importer);
    const onClose = vi.fn();
    const view = render(<LazySideDrawer open onClose={onClose} />, { wrapper });

    await act(async () => {
      first.reject(new Error('chunk 下載失敗'));
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(toastShow).toHaveBeenCalledWith({ message: ROUTE_LOAD_FAILED_MSG, tone: 'error' });
    expect(document.getElementById('side-drawer')).toBeNull();

    view.rerender(<LazySideDrawer open={false} onClose={onClose} />);
    view.rerender(<LazySideDrawer open onClose={onClose} />);
    await waitFor(() => expect(importer).toHaveBeenCalledTimes(2));
    await act(async () => {
      second.resolve();
    });
    await waitFor(() => expect(document.getElementById('side-drawer')?.className).toBe('open'));
    expect(toastShow).toHaveBeenCalledTimes(1);
  });

  it('選單關著時下載失敗：不打擾使用者（不提示、不呼叫 onClose），之後打開才重試', async () => {
    const first = deferred();
    const importer = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(async () => ({ SideDrawer: FakeDrawer }));
    _resetSideDrawerLoaderForTest(importer);
    const onClose = vi.fn();
    const view = render(<LazySideDrawer open={false} onClose={onClose} />, { wrapper });

    await act(async () => {
      first.reject(new Error('chunk 下載失敗'));
    });
    await waitFor(() => expect(console.error).toHaveBeenCalled());
    expect(toastShow).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(importer).toHaveBeenCalledTimes(1);

    view.rerender(<LazySideDrawer open onClose={onClose} />);
    await waitFor(() => expect(document.getElementById('side-drawer')?.className).toBe('open'));
    expect(importer).toHaveBeenCalledTimes(2);
  });

  it('props 原樣傳給選單（user、routeAccess、identity…）', async () => {
    const seen: SideDrawerProps[] = [];
    const Probe = ((props: SideDrawerProps) => {
      seen.push(props);
      return null;
    }) as unknown as SideDrawerComponent;
    _resetSideDrawerLoaderForTest(async () => ({ SideDrawer: Probe }));
    const onClose = vi.fn();
    const identity = { identityId: 'secondary', displayName: '官方帳號', avatarCandidates: ['a.jpg'] };
    render(
      <LazySideDrawer
        open={false}
        onClose={onClose}
        user={{ uid: 'u1', displayName: '小明', pictureUrl: null }}
        loginPending
        loginError
        identity={identity}
      />,
      { wrapper },
    );
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    const last = seen[seen.length - 1]!;
    expect(last.onClose).toBe(onClose);
    expect(last.user?.uid).toBe('u1');
    expect(last.loginPending).toBe(true);
    expect(last.loginError).toBe(true);
    expect(last.identity).toBe(identity);
  });
});
