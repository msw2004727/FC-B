import { readFileSync } from 'node:fs';

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { emit } from '@/core/events';
import { isInternalTestMode } from '@/data/internal-test';
import { _setDictLoaderForTest, setLocale } from '@/i18n/i18n';

interface ParsedClaims {
  persona: string | null;
  agent: string | null;
  exp: number | null;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

const readQaClaimsMock = vi.hoisted(() => vi.fn<(expectedUid?: string) => Promise<ParsedClaims | null>>());
const signOutQaMock = vi.hoisted(() => vi.fn<(expectedUid: string) => Promise<boolean>>());
const routeMock = vi.hoisted(() => vi.fn());
const toastShowMock = vi.hoisted(() => vi.fn());

vi.mock('@/data/auth', () => ({
  readQaClaims: (expectedUid?: string) => readQaClaimsMock(expectedUid),
  signOutQa: (expectedUid: string) => signOutQaMock(expectedUid),
}));

vi.mock('preact-iso', async () => {
  const actual = await vi.importActual<typeof import('preact-iso')>('preact-iso');
  return {
    ...actual,
    useLocation: () => ({
      url: '/',
      path: '/',
      query: {} as Record<string, string>,
      previous: '/',
      route: (...args: unknown[]) => routeMock(...args),
    }),
  };
});

vi.mock('@/ui/Toast', () => ({
  toast: {
    show: (options: unknown) => toastShowMock(options),
  },
}));

import { QaBanner } from './components/QaBanner';

const LINE_ZERO_UID = `U${'0'.repeat(30)}01`;
const LINE_UID = 'Ued1234567890abcdef1234567890abcd';

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function bannerLabel(): string {
  return document.querySelector('.qa-banner__label')?.textContent ?? '';
}

function textElement(root: Element | null): Element | null {
  if (!root) return null;
  if (root.classList.contains('ui-text')) return root;
  return root.querySelector('.ui-text');
}

function clearBannerVar(): void {
  document.documentElement.style.removeProperty('--qa-banner-h');
  document.documentElement.style.removeProperty('--qa-topbar-safe');
}

beforeEach(async () => {
  readQaClaimsMock.mockReset();
  signOutQaMock.mockReset();
  routeMock.mockReset();
  toastShowMock.mockReset();
  clearBannerVar();
  vi.unstubAllEnvs();
  _setDictLoaderForTest(null);
  await setLocale('zh-TW');
});

afterEach(() => {
  cleanup();
  clearBannerVar();
  vi.unstubAllEnvs();
  _setDictLoaderForTest(null);
  vi.restoreAllMocks();
});

describe('QaBanner', () => {
  it('訪客不渲染橫幅', async () => {
    const { container } = render(<QaBanner uid={null} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.innerHTML).toBe('');
    expect(screen.queryByRole('status')).toBeNull();
    expect(readQaClaimsMock).not.toHaveBeenCalled();
  });

  it('uid 為 undefined 或 null 時不渲染，且不讀 claims', async () => {
    const missing = render(<QaBanner uid={undefined} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(missing.container.querySelector('.qa-banner')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(readQaClaimsMock).not.toHaveBeenCalled();
    missing.unmount();

    const absent = render(<QaBanner uid={null} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(absent.container.querySelector('.qa-banner')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(readQaClaimsMock).not.toHaveBeenCalled();
  });

  it('讀取中與非 QA claims 都不顯示橫幅', async () => {
    const pending = deferred<ParsedClaims | null>();
    readQaClaimsMock.mockImplementation(() => pending.promise);

    const { container } = render(<QaBanner uid="uid-regular" />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(readQaClaimsMock).toHaveBeenCalledTimes(1);
    expect(container.innerHTML).toBe('');
    expect(screen.queryByRole('status')).toBeNull();

    await act(async () => {
      pending.resolve(null);
      await Promise.resolve();
    });
    expect(container.innerHTML).toBe('');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('QA 隊長顯示測試模式文案與登出按鈕', async () => {
    readQaClaimsMock.mockResolvedValue({ persona: 'captain', agent: 'agent-1', exp: 1 });
    render(<QaBanner uid="uid-qa" />);

    const status = await screen.findByRole('status');
    expect(status.getAttribute('role')).toBe('status');
    expect(bannerLabel()).toBe('QA 測試模式：QA測試-隊長');
    expect(screen.getByRole('button', { name: '登出 QA' })).toBeTruthy();
  });

  it('QA 場主顯示 QA測試-場主', async () => {
    readQaClaimsMock.mockResolvedValue({ persona: 'venueOwner', agent: 'agent-1', exp: 1 });
    render(<QaBanner uid="uid-qa" />);

    const status = await screen.findByRole('status');
    expect(status.getAttribute('role')).toBe('status');
    expect(bannerLabel()).toBe('QA 測試模式：QA測試-場主');
    expect(screen.getByRole('button', { name: '登出 QA' })).toBeTruthy();
  });

  it('不在清單的 persona 顯示原字串，空字串只顯示 QA 測試模式', async () => {
    readQaClaimsMock.mockResolvedValueOnce({ persona: 'field-crew', agent: null, exp: null });
    const unknown = render(<QaBanner uid="uid-qa" />);
    await screen.findByRole('status');
    expect(bannerLabel()).toBe('QA 測試模式：field-crew');
    unknown.unmount();

    readQaClaimsMock.mockResolvedValueOnce({ persona: '', agent: null, exp: null });
    render(<QaBanner uid="uid-qa" />);
    await screen.findByRole('status');
    expect(bannerLabel()).toBe('QA 測試模式');
    expect(bannerLabel()).not.toContain('：');
  });

  it('橫幅只看 claims，不看內測旗標', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_PUBLIC_LAUNCH', '');
    expect(isInternalTestMode()).toBe(true);
    readQaClaimsMock.mockResolvedValue({ persona: 'captain', agent: 'agent-1', exp: 1 });
    const internalOn = render(<QaBanner uid="uid-qa" />);
    expect((await screen.findByRole('status')).textContent).toContain('QA 測試模式：QA測試-隊長');
    internalOn.unmount();

    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_PUBLIC_LAUNCH', '1');
    expect(isInternalTestMode()).toBe(false);
    const internalOff = render(<QaBanner uid="uid-qa" />);
    expect((await screen.findByRole('status')).textContent).toContain('QA 測試模式：QA測試-隊長');
    internalOff.unmount();

    readQaClaimsMock.mockResolvedValue(null);
    vi.stubEnv('VITE_PUBLIC_LAUNCH', '');
    expect(isInternalTestMode()).toBe(true);
    const hiddenOn = render(<QaBanner uid="uid-qa" />);
    await waitFor(() => {
      expect(readQaClaimsMock.mock.calls.length).toBeGreaterThan(0);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(hiddenOn.container.querySelector('.qa-banner')).toBeNull();
    hiddenOn.unmount();

    const callsBeforeOff = readQaClaimsMock.mock.calls.length;
    vi.stubEnv('VITE_PUBLIC_LAUNCH', '1');
    expect(isInternalTestMode()).toBe(false);
    const hiddenOff = render(<QaBanner uid="uid-qa" />);
    await waitFor(() => {
      expect(readQaClaimsMock.mock.calls.length).toBeGreaterThan(callsBeforeOff);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(hiddenOff.container.querySelector('.qa-banner')).toBeNull();
  });

  it('橫幅只看 claims，不看 uid 是測試號還是一般 LINE uid', async () => {
    readQaClaimsMock.mockResolvedValue({ persona: 'coach', agent: 'agent-2', exp: 2 });

    for (const uid of [LINE_ZERO_UID, LINE_UID]) {
      const shown = render(<QaBanner uid={uid} />);
      await screen.findByRole('status');
      expect(bannerLabel()).toBe('QA 測試模式：QA測試-教練');
      shown.unmount();
    }

    readQaClaimsMock.mockResolvedValue(null);
    for (const uid of [LINE_ZERO_UID, LINE_UID]) {
      const callsBefore = readQaClaimsMock.mock.calls.length;
      const hidden = render(<QaBanner uid={uid} />);
      await waitFor(() => {
        expect(readQaClaimsMock.mock.calls.length).toBeGreaterThan(callsBefore);
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(hidden.container.querySelector('.qa-banner')).toBeNull();
      hidden.unmount();
    }
  });

  it('登出 QA 成功後回首頁，連按不重複，登出狀態變更後橫幅消失', async () => {
    readQaClaimsMock.mockResolvedValue({ persona: 'captain', agent: 'agent-1', exp: 1 });
    const pending = deferred<boolean>();
    signOutQaMock.mockImplementation(() => pending.promise);

    render(<QaBanner uid="uid-qa" />);
    const button = await screen.findByRole('button', { name: '登出 QA' });

    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(signOutQaMock).toHaveBeenCalledTimes(1);
    expect(signOutQaMock).toHaveBeenCalledWith('uid-qa');
    const pendingButton = screen.getByRole('button', { name: '登出 QA' });
    if (!(pendingButton instanceof HTMLButtonElement)) throw new Error('登出按鈕不是 button');
    expect(pendingButton.disabled || pendingButton.getAttribute('aria-disabled') === 'true').toBe(true);

    await act(async () => {
      pending.resolve(true);
      await Promise.resolve();
    });
    expect(routeMock).toHaveBeenCalledTimes(1);
    expect(routeMock).toHaveBeenCalledWith('/');

    readQaClaimsMock.mockResolvedValue(null);
    await act(async () => {
      emit('auth:changed', { uid: 'uid-qa' });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.queryByRole('status')).toBeNull();
    });
    expect(document.documentElement.style.getPropertyValue('--qa-banner-h')).toBe('');
  });

  it('登出失敗時顯示登出失敗文案、不導頁，按鈕恢復可按', async () => {
    readQaClaimsMock.mockResolvedValue({ persona: 'captain', agent: 'agent-1', exp: 1 });
    signOutQaMock.mockRejectedValue(new Error('sign-out-failed'));

    render(<QaBanner uid="uid-qa" />);
    const button = await screen.findByRole('button', { name: '登出 QA' });
    fireEvent.click(button);

    await waitFor(() => {
      expect(toastShowMock).toHaveBeenCalledWith({ message: '登出失敗，請再試一次' });
    });
    expect(routeMock).not.toHaveBeenCalled();
    const retryButton = screen.getByRole('button', { name: '登出 QA' });
    if (!(retryButton instanceof HTMLButtonElement)) throw new Error('登出按鈕不是 button');
    expect(retryButton.disabled).toBe(false);
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('signOutQa 回 false 時不導頁、不顯示 toast，按鈕恢復可按', async () => {
    readQaClaimsMock.mockResolvedValue({ persona: 'captain', agent: 'agent-1', exp: 1 });
    const pending = deferred<boolean>();
    signOutQaMock.mockImplementation(() => pending.promise);

    render(<QaBanner uid="uid-qa" />);
    const button = await screen.findByRole('button', { name: '登出 QA' });

    await act(async () => {
      fireEvent.click(button);
    });
    const pendingButton = screen.getByRole('button', { name: '登出 QA' });
    if (!(pendingButton instanceof HTMLButtonElement)) throw new Error('登出按鈕不是 button');
    expect(pendingButton.disabled || pendingButton.getAttribute('aria-disabled') === 'true').toBe(true);

    await act(async () => {
      pending.resolve(false);
      await Promise.resolve();
    });
    expect(routeMock).not.toHaveBeenCalled();
    expect(toastShowMock).not.toHaveBeenCalled();
    const retryButton = screen.getByRole('button', { name: '登出 QA' });
    if (!(retryButton instanceof HTMLButtonElement)) throw new Error('登出按鈕不是 button');
    expect(retryButton.disabled).toBe(false);
  });

  it('橫幅顯示時寫入 --qa-banner-h，消失或卸載後移除', async () => {
    readQaClaimsMock.mockResolvedValue({ persona: 'captain', agent: 'agent-1', exp: 1 });
    const shown = render(<QaBanner uid="uid-qa" />);
    await screen.findByRole('status');

    const height = document.documentElement.style.getPropertyValue('--qa-banner-h');
    expect(height).not.toBe('');
    expect(height.trim()).toMatch(/px$/);

    shown.unmount();
    expect(document.documentElement.style.getPropertyValue('--qa-banner-h')).toBe('');

    readQaClaimsMock.mockResolvedValue({ persona: 'captain', agent: 'agent-1', exp: 1 });
    const again = render(<QaBanner uid="uid-qa" />);
    await screen.findByRole('status');
    expect(document.documentElement.style.getPropertyValue('--qa-banner-h').trim()).toMatch(/px$/);

    readQaClaimsMock.mockResolvedValue(null);
    await act(async () => {
      emit('auth:changed', { uid: 'uid-qa' });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(again.container.querySelector('.qa-banner')).toBeNull();
    });
    expect(document.documentElement.style.getPropertyValue('--qa-banner-h')).toBe('');
  });

  it('登出按鈕熱區至少 44px，樣式表沒有色碼字面值', () => {
    // 相對路徑放變數：Vite 會把 new URL('./qa-login.css', import.meta.url) 改寫成開發資源網址。
    const relativeCss = './qa-login.css';
    const css = readFileSync(new URL(relativeCss, import.meta.url), 'utf8');
    const block = css.match(/\.qa-banner__logout\s*\{[^}]*\}/);
    expect(block?.[0] ?? '').toMatch(/min-height:\s*44px/);

    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(withoutComments).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
  });

  it('登出 QA 時以橫幅的 uid 呼叫 signOutQa', async () => {
    readQaClaimsMock.mockResolvedValue({ persona: 'captain', agent: 'agent-1', exp: 1 });
    signOutQaMock.mockResolvedValue(true);
    render(<QaBanner uid="uid-from-banner" />);
    const button = await screen.findByRole('button', { name: '登出 QA' });
    fireEvent.click(button);
    await waitFor(() => {
      expect(signOutQaMock).toHaveBeenCalledTimes(1);
    });
    expect(signOutQaMock).toHaveBeenCalledWith('uid-from-banner');
  });

  it('橫幅文字與登出鈕文字由 Text 渲染', async () => {
    readQaClaimsMock.mockResolvedValue({ persona: 'captain', agent: 'agent-1', exp: 1 });
    render(<QaBanner uid="uid-qa" />);
    await screen.findByRole('status');

    const label = document.querySelector('.qa-banner__label');
    expect(label?.tagName).toBe('P');
    expect(label?.classList.contains('qa-banner__label')).toBe(true);
    const labelText = textElement(label);
    expect(labelText).not.toBeNull();
    expect(labelText?.classList.contains('ui-text')).toBe(true);
    expect(labelText?.textContent).toBe('QA 測試模式：QA測試-隊長');

    const button = screen.getByRole('button', { name: '登出 QA' });
    const buttonText = textElement(button);
    expect(buttonText).not.toBeNull();
    expect(buttonText?.classList.contains('ui-text')).toBe(true);
    expect(buttonText?.textContent).toBe('登出 QA');
    expect(button.classList.contains('qa-banner__logout')).toBe(true);
  });
});
