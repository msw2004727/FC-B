import { act, cleanup, render, waitFor } from '@testing-library/preact';
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

/** 記下每次 render 收到的 open，確認「先關後開」的順序。 */
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

beforeEach(() => {
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
    const view = render(<LazySideDrawer open={false} onClose={() => undefined} />);

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

  it('下載完之前就按了選單：先以關閉狀態畫一次，再打開（保留滑入動畫）', async () => {
    const d = deferred();
    _resetSideDrawerLoaderForTest(() => d.promise);
    render(<LazySideDrawer open onClose={() => undefined} />);

    await act(async () => {
      d.resolve();
    });
    await waitFor(() => expect(document.getElementById('side-drawer')?.className).toBe('open'));
    expect(renders[0]).toBe(false);
    expect(renders[renders.length - 1]).toBe(true);
  });

  it('已下載過：再次掛上直接用快取，不重新下載、不經過關閉狀態', async () => {
    const importer = vi.fn(async () => ({ SideDrawer: FakeDrawer }));
    _resetSideDrawerLoaderForTest(importer);
    await loadSideDrawer();
    render(<LazySideDrawer open onClose={() => undefined} />);

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
    const view = render(<LazySideDrawer open onClose={onClose} />);

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
    const view = render(<LazySideDrawer open={false} onClose={onClose} />);

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
