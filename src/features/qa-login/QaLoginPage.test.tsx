import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { emit } from '@/core/events';
import { _setDictLoaderForTest, setLocale } from '@/i18n/i18n';
import { LOCALES } from '@/i18n/locales';
import type { ViewerView } from '@/features/profile/data/viewer';

const SECRET = 'pw-secret-123';

const { signInWithQaMock, inspectQaAccountMock, useViewerMock, routeMock } = vi.hoisted(() => ({
  signInWithQaMock: vi.fn(),
  inspectQaAccountMock: vi.fn(),
  useViewerMock: vi.fn(),
  routeMock: vi.fn(),
}));

vi.mock('@/data/auth', () => ({
  signInWithQa: (...args: unknown[]) => signInWithQaMock(...args),
  inspectQaAccount: (...args: unknown[]) => inspectQaAccountMock(...args),
  readQaClaims: vi.fn(async () => null),
}));

vi.mock('@/features/profile/data/viewer', () => ({
  useViewer: () => useViewerMock(),
}));

vi.mock('preact-iso', async () => {
  const actual = await vi.importActual<typeof import('preact-iso')>('preact-iso');
  return {
    ...actual,
    useLocation: () => ({
      url: '/qa-login',
      path: '/qa-login',
      query: {} as Record<string, string>,
      previous: '/',
      route: (...args: unknown[]) => routeMock(...args),
    }),
  };
});

import QaLoginPage from './pages/QaLoginPage';

const consoleMethods = ['log', 'info', 'warn', 'error', 'debug'] as const;

interface MountedPage {
  input: HTMLInputElement;
  select: HTMLSelectElement;
  form: HTMLFormElement;
  submit: HTMLButtonElement;
  unmount: () => void;
}

interface DomAtSignInCall {
  called: boolean;
  value: string;
  type: string;
  html: string;
}

function stringifyCallArgs(args: unknown[]): string {
  return JSON.stringify(args, (_key, value: unknown) => {
    if (value instanceof Error) {
      return { name: value.name, message: value.message, stack: value.stack };
    }
    return value;
  });
}

function mountPage(): MountedPage {
  const view = render(<QaLoginPage />);
  const input = document.getElementById('qa-password');
  const select = document.getElementById('qa-identity');
  const form = view.container.querySelector('form');
  const submit = view.container.querySelector('button[type="submit"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('找不到密碼欄');
  if (!(select instanceof HTMLSelectElement)) throw new Error('找不到身分下拉');
  if (!(form instanceof HTMLFormElement)) throw new Error('找不到表單');
  if (!(submit instanceof HTMLButtonElement)) throw new Error('找不到送出鈕');
  return { input, select, form, submit, unmount: () => view.unmount() };
}

function textElement(root: Element): Element | null {
  if (root.classList.contains('ui-text')) return root;
  return root.querySelector('.ui-text');
}

/** 在 signInWithQa 替身的同步入口取 DOM，尚未 await。 */
function captureDomAtSignIn(input: HTMLInputElement): DomAtSignInCall {
  const captured: DomAtSignInCall = { called: false, value: 'unset', type: '', html: '' };
  signInWithQaMock.mockImplementation(() => {
    captured.called = true;
    captured.value = input.value;
    captured.type = input.type;
    captured.html = document.body.innerHTML;
    return Promise.resolve({
      uid: 'uid-qa-1',
      displayName: null,
      pictureUrl: null,
    });
  });
  return captured;
}

function watchConsoleAndRejections(): {
  warnings: unknown[][];
  errors: unknown[][];
  rejections: unknown[];
  stop: () => void;
} {
  const warnings: unknown[][] = [];
  const errors: unknown[][] = [];
  const rejections: unknown[] = [];
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args);
  });
  const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args);
  });
  const onRejection = (event: PromiseRejectionEvent): void => {
    rejections.push(event.reason);
    event.preventDefault();
  };
  window.addEventListener('unhandledrejection', onRejection);
  return {
    warnings,
    errors,
    rejections,
    stop: () => {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
      window.removeEventListener('unhandledrejection', onRejection);
    },
  };
}

async function choosePersona(select: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function fillPassword(input: HTMLInputElement, value: string): void {
  fireEvent.input(input, { target: { value } });
}

function submitForm(form: HTMLFormElement): void {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

function assertSecretOutsideDom(secret: string): void {
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index) ?? '';
    expect(key).not.toContain(secret);
    expect(localStorage.getItem(key) ?? '').not.toContain(secret);
  }
  for (let index = 0; index < sessionStorage.length; index += 1) {
    const key = sessionStorage.key(index) ?? '';
    expect(key).not.toContain(secret);
    expect(sessionStorage.getItem(key) ?? '').not.toContain(secret);
  }
  expect(location.href).not.toContain(secret);
  expect(location.search).not.toContain(secret);
  expect(location.hash).not.toContain(secret);
  expect(JSON.stringify(history.state)).not.toContain(secret);
}

function viewerOf(uid: string | null, displayName: string | null): ViewerView {
  return {
    uid,
    teamIds: new Set<string>(),
    hasPermission: () => false,
    roleLevel: 0,
    role: uid === null ? 'guest' : 'user',
    displayName,
    pictureUrl: null,
    capabilities: [],
  };
}

/** 「目前已登入…會切換到 QA 帳號」提示（表單上方的 role=status 區域）；沒有時回 null。 */
function switchNotice(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="status"] .qa-login__notice');
}

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  document.head.querySelectorAll('meta[name="robots"]').forEach((node) => node.remove());
  history.replaceState(null, '', '/qa-login');
  signInWithQaMock.mockReset();
  inspectQaAccountMock.mockReset();
  inspectQaAccountMock.mockResolvedValue({ kind: 'regular' });
  useViewerMock.mockReset();
  useViewerMock.mockReturnValue(viewerOf(null, null));
  routeMock.mockReset();
  _setDictLoaderForTest(null);
  await setLocale('zh-TW');
});

afterEach(() => {
  cleanup();
  document.head.querySelectorAll('meta[name="robots"]').forEach((node) => node.remove());
  _setDictLoaderForTest(null);
  vi.restoreAllMocks();
});

describe('QaLoginPage', () => {
  it('初始密碼欄有防記入屬性，身分下拉預設隊長且沒有 placeholder，送出鈕可按', () => {
    const { input, select, submit } = mountPage();

    expect(document.querySelector('h1')?.textContent).toBe('QA 測試模式');
    expect(input.type).toBe('password');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('autocapitalize')).toBe('none');
    expect(input.getAttribute('spellcheck')).toBe('false');
    expect(input.hasAttribute('name')).toBe(false);
    expect(input.value).toBe('');

    const options = Array.from(select.options);
    expect(options).toHaveLength(5);
    expect(options.map((option) => option.value)).toEqual([
      'captain',
      'coach',
      'venueOwner',
      'memberA',
      'memberB',
    ]);
    expect(options.map((option) => option.getAttribute('label'))).toEqual([
      'QA測試-隊長',
      'QA測試-教練',
      'QA測試-場主',
      'QA測試-會員甲',
      'QA測試-會員乙',
    ]);
    expect(options.some((option) => option.value === '')).toBe(false);
    expect(select.value).toBe('captain');
    expect(submit.disabled).toBe(false);
  });

  it('選 QA測試-場主 後送出，signInWithQa 以 venueOwner 呼叫', async () => {
    signInWithQaMock.mockResolvedValue({
      uid: 'uid-qa-1',
      displayName: null,
      pictureUrl: null,
    });
    const { input, select, form } = mountPage();
    const venueOwner = Array.from(select.options).find(
      (option) => option.getAttribute('label') === 'QA測試-場主',
    );
    if (!venueOwner) throw new Error('找不到場主選項');
    fillPassword(input, SECRET);
    await choosePersona(select, venueOwner.value);

    await act(async () => {
      submitForm(form);
      await Promise.resolve();
    });

    expect(signInWithQaMock).toHaveBeenCalledTimes(1);
    expect(signInWithQaMock).toHaveBeenCalledWith(SECRET, 'venueOwner');
  });

  it('密碼為空時按送出不呼叫登入、不顯示錯誤，焦點在密碼欄', () => {
    const { input, form, submit } = mountPage();
    expect(submit.disabled).toBe(false);

    submitForm(form);

    expect(signInWithQaMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it('送出後 promise 尚未完成時，密碼欄已清空且 DOM 不含密碼', async () => {
    let resolveLogin: (value: { uid: string; displayName: null; pictureUrl: null }) => void = () => undefined;
    signInWithQaMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLogin = resolve;
        }),
    );

    const { input, select, form } = mountPage();
    fillPassword(input, SECRET);
    await choosePersona(select, 'captain');

    await act(async () => {
      submitForm(form);
    });

    expect(signInWithQaMock).toHaveBeenCalledTimes(1);
    expect(signInWithQaMock).toHaveBeenCalledWith(SECRET, 'captain');
    expect(input.value).toBe('');
    expect(document.body.innerHTML).not.toContain(SECRET);
    expect(document.body.outerHTML).not.toContain(SECRET);

    await act(async () => {
      resolveLogin({ uid: 'uid-qa-1', displayName: null, pictureUrl: null });
      await Promise.resolve();
    });
  });

  it('送出中按鈕停用並顯示進入中，連續兩次 submit 只呼叫一次，結束後解鎖', async () => {
    let resolveLogin: (value: { uid: string; displayName: null; pictureUrl: null }) => void = () => undefined;
    signInWithQaMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLogin = resolve;
        }),
    );

    const { input, select, form } = mountPage();
    fillPassword(input, SECRET);
    await choosePersona(select, 'captain');

    await act(async () => {
      submitForm(form);
      submitForm(form);
    });

    expect(signInWithQaMock).toHaveBeenCalledTimes(1);
    const pendingButton = document.querySelector('button[type="submit"]');
    if (!(pendingButton instanceof HTMLButtonElement)) throw new Error('找不到送出鈕');
    expect(pendingButton.disabled || pendingButton.getAttribute('aria-disabled') === 'true').toBe(true);
    expect(pendingButton.textContent).toContain('進入中…');

    await act(async () => {
      resolveLogin({ uid: 'uid-qa-1', displayName: null, pictureUrl: null });
      await Promise.resolve();
    });

    const settled = document.querySelector('button[type="submit"]');
    if (!(settled instanceof HTMLButtonElement)) throw new Error('找不到送出鈕');
    expect(settled.textContent).toContain('進入測試模式');
    expect(settled.textContent).not.toContain('進入中');
    expect(settled.getAttribute('data-btn-loading')).not.toBe('1');

    fillPassword(input, SECRET);
    expect(settled.disabled).toBe(false);
  });

  it('成功後導向首頁且不顯示錯誤', async () => {
    signInWithQaMock.mockResolvedValue({
      uid: 'uid-qa-1',
      displayName: null,
      pictureUrl: null,
    });
    const { input, select, form } = mountPage();
    fillPassword(input, SECRET);
    await choosePersona(select, 'captain');

    await act(async () => {
      submitForm(form);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(routeMock).toHaveBeenCalledTimes(1);
    });
    expect(routeMock).toHaveBeenCalledWith('/');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('各種失敗都顯示同一個「無法進入測試模式」，清空密碼且不導頁，之後可重試成功', async () => {
    const failures: unknown[] = [
      new Error('[auth] QA login failed'),
      new Error('resource-exhausted'),
      new Error('permission-denied'),
      new TypeError('x'),
      'not-an-error-string',
    ];
    const seenMessages: string[] = [];

    const { input, select, form } = mountPage();
    await choosePersona(select, 'captain');

    for (const failure of failures) {
      signInWithQaMock.mockReset();
      routeMock.mockReset();
      signInWithQaMock.mockImplementation(() => Promise.reject(failure));
      fillPassword(input, SECRET);

      await act(async () => {
        submitForm(form);
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(screen.getAllByRole('alert')).toHaveLength(1);
      });
      const alert = screen.getByRole('alert');
      const message = alert.querySelector('.ui-text')?.textContent ?? '';
      expect(message).toBe('無法進入測試模式');
      seenMessages.push(alert.textContent ?? '');
      expect(input.value).toBe('');
      expect(routeMock).not.toHaveBeenCalled();

      signInWithQaMock.mockReset();
      routeMock.mockReset();
      signInWithQaMock.mockResolvedValue({
        uid: 'uid-qa-1',
        displayName: null,
        pictureUrl: null,
      });
      fillPassword(input, SECRET);
      await act(async () => {
        submitForm(form);
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(screen.queryByRole('alert')).toBeNull();
      });
      expect(routeMock).toHaveBeenCalledTimes(1);
      expect(routeMock).toHaveBeenCalledWith('/');
    }

    expect(new Set(seenMessages).size).toBe(1);
  });

  it('成功與失敗的送出前後，密碼都不進 storage、console、location 或 history', async () => {
    const spies = consoleMethods.map((method) => vi.spyOn(console, method).mockImplementation(() => undefined));
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    signInWithQaMock.mockResolvedValueOnce({
      uid: 'uid-qa-1',
      displayName: null,
      pictureUrl: null,
    });
    const success = mountPage();
    assertSecretOutsideDom(SECRET);
    fillPassword(success.input, SECRET);
    await choosePersona(success.select, 'captain');
    assertSecretOutsideDom(SECRET);

    await act(async () => {
      submitForm(success.form);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(routeMock).toHaveBeenCalledWith('/');
    });
    assertSecretOutsideDom(SECRET);
    cleanup();

    routeMock.mockReset();
    signInWithQaMock.mockRejectedValueOnce(new Error('[auth] QA login failed'));
    const failure = mountPage();
    assertSecretOutsideDom(SECRET);
    fillPassword(failure.input, SECRET);
    await choosePersona(failure.select, 'coach');
    assertSecretOutsideDom(SECRET);

    await act(async () => {
      submitForm(failure.form);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });
    assertSecretOutsideDom(SECRET);

    for (const spy of spies) {
      for (const args of spy.mock.calls) {
        expect(stringifyCallArgs(args)).not.toContain(SECRET);
      }
    }
    for (const args of setItem.mock.calls) {
      expect(JSON.stringify(args)).not.toContain(SECRET);
    }
  });

  it('掛載時加上 noindex，卸載後移除', () => {
    const { unmount } = render(<QaLoginPage />);
    const meta = document.head.querySelector('meta[name="robots"]');
    expect(meta).not.toBeNull();
    expect(meta?.getAttribute('content')).toBe('noindex');

    unmount();
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
  });

  it('已有 robots meta 時改成 noindex，卸載後還原原值', () => {
    const existing = document.createElement('meta');
    existing.setAttribute('name', 'robots');
    existing.setAttribute('content', 'index,follow');
    document.head.appendChild(existing);

    const { unmount } = render(<QaLoginPage />);
    expect(existing.getAttribute('content')).toBe('noindex');
    expect(document.head.querySelectorAll('meta[name="robots"]')).toHaveLength(1);

    unmount();
    expect(existing.getAttribute('content')).toBe('index,follow');
    expect(existing.parentElement).toBe(document.head);
  });

  it('顯示鈕只切換密碼欄 type，不改變欄位值', () => {
    const { input } = mountPage();
    fillPassword(input, SECRET);
    const toggle = document.querySelector('.qa-login__password-toggle');
    if (!(toggle instanceof HTMLButtonElement)) throw new Error('找不到顯示鈕');

    expect(input.type).toBe('password');
    expect(toggle.textContent).toContain('顯示');
    fireEvent.click(toggle);
    expect(input.type).toBe('text');
    expect(input.value).toBe(SECRET);

    fireEvent.click(toggle);
    expect(input.type).toBe('password');
    expect(input.value).toBe(SECRET);
  });

  it('一般模式下，signInWithQa 被呼叫的當下密碼欄已清空且 DOM 不含密碼', async () => {
    const { input, select, form } = mountPage();
    fillPassword(input, SECRET);
    await choosePersona(select, 'captain');
    expect(input.type).toBe('password');
    expect(input.value).toBe(SECRET);

    const captured = captureDomAtSignIn(input);
    await act(async () => {
      submitForm(form);
      await Promise.resolve();
    });

    expect(captured.called).toBe(true);
    expect(signInWithQaMock).toHaveBeenCalledWith(SECRET, 'captain');
    expect(captured.type).toBe('password');
    expect(captured.value).toBe('');
    expect(captured.html).not.toContain(SECRET);
  });

  it('顯示密碼模式下，signInWithQa 被呼叫的當下密碼欄已清空且 DOM 不含密碼', async () => {
    const { input, form } = mountPage();
    fillPassword(input, SECRET);
    const toggle = document.querySelector('.qa-login__password-toggle');
    if (!(toggle instanceof HTMLButtonElement)) throw new Error('找不到顯示鈕');
    fireEvent.click(toggle);
    expect(input.type).toBe('text');
    expect(input.value).toBe(SECRET);

    const captured = captureDomAtSignIn(input);
    await act(async () => {
      submitForm(form);
      await Promise.resolve();
    });

    expect(captured.called).toBe(true);
    expect(signInWithQaMock).toHaveBeenCalledWith(SECRET, 'captain');
    expect(captured.type).toBe('text');
    expect(captured.value).toBe('');
    expect(captured.html).not.toContain(SECRET);
  });

  it('輸入密碼與失敗後再輸入，防記入與錯誤屬性仍在', async () => {
    const { input, form } = mountPage();
    fillPassword(input, SECRET);
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('autocapitalize')).toBe('none');
    expect(input.getAttribute('autocorrect')).toBe('off');
    expect(input.getAttribute('spellcheck')).toBe('false');
    expect(input.hasAttribute('name')).toBe(false);

    signInWithQaMock.mockRejectedValueOnce(new Error('[auth] QA login failed'));
    await act(async () => {
      submitForm(form);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('qa-login-error');

    fillPassword(input, 'next-secret');
    expect(input.value).toBe('next-secret');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('autocapitalize')).toBe('none');
    expect(input.getAttribute('autocorrect')).toBe('off');
    expect(input.getAttribute('spellcheck')).toBe('false');
    expect(input.hasAttribute('name')).toBe(false);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('qa-login-error');
  });

  it('送出後卸載，成功回應不再導頁，也不在卸載後 setState', async () => {
    let resolveLogin: (value: { uid: string; displayName: null; pictureUrl: null }) => void = () => undefined;
    signInWithQaMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLogin = resolve;
        }),
    );

    const { input, form, unmount } = mountPage();
    fillPassword(input, SECRET);
    await act(async () => {
      submitForm(form);
    });
    expect(signInWithQaMock).toHaveBeenCalledTimes(1);
    expect(signInWithQaMock).toHaveBeenCalledWith(SECRET, 'captain');

    const watched = watchConsoleAndRejections();
    try {
      unmount();
      await act(async () => {
        resolveLogin({ uid: 'uid-qa-1', displayName: null, pictureUrl: null });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(routeMock).not.toHaveBeenCalled();
      expect(watched.warnings).toEqual([]);
      expect(watched.errors).toEqual([]);
      expect(watched.rejections).toEqual([]);
    } finally {
      watched.stop();
    }
  });

  it('送出後卸載，失敗回應不拋出、不導頁', async () => {
    let rejectLogin: (reason: unknown) => void = () => undefined;
    signInWithQaMock.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectLogin = reject;
        }),
    );

    const { input, form, unmount } = mountPage();
    fillPassword(input, SECRET);
    await act(async () => {
      submitForm(form);
    });
    expect(signInWithQaMock).toHaveBeenCalledTimes(1);

    const watched = watchConsoleAndRejections();
    try {
      unmount();
      await act(async () => {
        rejectLogin(new Error('[auth] QA login failed'));
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(routeMock).not.toHaveBeenCalled();
      expect(watched.warnings).toEqual([]);
      expect(watched.errors).toEqual([]);
      expect(watched.rejections).toEqual([]);
    } finally {
      watched.stop();
    }
  });

  it('顯示與隱藏文字由 Text 渲染', () => {
    mountPage();
    const showButton = screen.getByRole('button', { name: '顯示臨時密碼' });
    const shown = textElement(showButton);
    expect(shown).not.toBeNull();
    expect(shown?.tagName).toBe('SPAN');
    expect(shown?.textContent).toBe('顯示');

    fireEvent.click(showButton);
    const hideButton = screen.getByRole('button', { name: '隱藏臨時密碼' });
    const hidden = textElement(hideButton);
    expect(hidden).not.toBeNull();
    expect(hidden?.textContent).toBe('隱藏');
  });
});

describe('QaLoginPage 已用一般帳號登入時的切換提示（T-047）', () => {
  const REGULAR_UID = 'U-regular-secret-uid-0001';
  const QA_STATUS = {
    kind: 'qa',
    claims: { persona: 'captain', agent: 'agent-1', exp: 1 },
  } as const;

  it('一般登入者（uid 有值、確認不是 QA）→ 顯示含名稱的提示，沿用既有 notice 樣式，不含 uid', async () => {
    useViewerMock.mockReturnValue(viewerOf(REGULAR_UID, '小明'));
    inspectQaAccountMock.mockResolvedValue({ kind: 'regular' });
    mountPage();

    await waitFor(() => {
      expect(switchNotice()).not.toBeNull();
    });
    const notice = switchNotice();
    expect(notice?.tagName).toBe('P');
    expect(notice?.classList.contains('qa-login__notice')).toBe(true);
    expect(notice?.textContent).toBe('目前已登入為「小明」。登入 QA 會切換到 QA 帳號，原帳號會登出。');
    expect(inspectQaAccountMock).toHaveBeenCalledWith(REGULAR_UID);
    expect(notice?.outerHTML).not.toContain(REGULAR_UID);
    expect(document.body.innerHTML).not.toContain(REGULAR_UID);
  });

  it('名稱是空字串或全空白 → 改用不帶名稱的句子', async () => {
    for (const name of [null, '', '   ']) {
      cleanup();
      useViewerMock.mockReturnValue(viewerOf(REGULAR_UID, name));
      mountPage();
      await waitFor(() => {
        expect(switchNotice()).not.toBeNull();
      });
      expect(switchNotice()?.textContent).toBe(
        '目前已登入一般帳號。登入 QA 會切換到 QA 帳號，原帳號會登出。',
      );
    }
  });

  it('名稱含角括號等字元時以純文字呈現，不產生 HTML 節點', async () => {
    useViewerMock.mockReturnValue(viewerOf(REGULAR_UID, '<img src=x onerror=alert(1)>'));
    mountPage();
    await waitFor(() => {
      expect(switchNotice()).not.toBeNull();
    });
    expect(switchNotice()?.querySelector('img')).toBeNull();
    expect(switchNotice()?.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('未登入（uid 為 null）→ 不顯示，也不去讀 QA 狀態', async () => {
    useViewerMock.mockReturnValue(viewerOf(null, null));
    mountPage();
    await act(async () => {
      await Promise.resolve();
    });
    expect(switchNotice()).toBeNull();
    expect(inspectQaAccountMock).not.toHaveBeenCalled();
  });

  it('已經是 QA 登入者（claims.qa）→ 不顯示', async () => {
    useViewerMock.mockReturnValue(viewerOf('uid-qa-1', 'QA測試-隊長'));
    inspectQaAccountMock.mockResolvedValue(QA_STATUS);
    mountPage();
    await waitFor(() => {
      expect(inspectQaAccountMock).toHaveBeenCalledWith('uid-qa-1');
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(switchNotice()).toBeNull();
  });

  it('讀不到 QA 狀態（unknown：讀取失敗、uid 不符、讀取途中換人）或沒有登入者（none）→ 不顯示，不宣稱他是一般帳號', async () => {
    for (const status of [{ kind: 'unknown' }, { kind: 'none' }]) {
      cleanup();
      inspectQaAccountMock.mockReset();
      inspectQaAccountMock.mockResolvedValue(status);
      useViewerMock.mockReturnValue(viewerOf(REGULAR_UID, '小明'));
      mountPage();
      await waitFor(() => {
        expect(inspectQaAccountMock).toHaveBeenCalledWith(REGULAR_UID);
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(switchNotice()).toBeNull();
    }

    cleanup();
    inspectQaAccountMock.mockReset();
    inspectQaAccountMock.mockRejectedValue(new Error('unexpected'));
    useViewerMock.mockReturnValue(viewerOf(REGULAR_UID, '小明'));
    mountPage();
    await waitFor(() => {
      expect(inspectQaAccountMock).toHaveBeenCalledWith(REGULAR_UID);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(switchNotice()).toBeNull();
  });

  it('QA 狀態還在讀取時先不顯示（避免 QA 登入者看到一閃而過的提示），讀完確認不是 QA 才出現', async () => {
    useViewerMock.mockReturnValue(viewerOf(REGULAR_UID, '小明'));
    let resolveStatus: (value: { kind: 'regular' }) => void = () => undefined;
    inspectQaAccountMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStatus = resolve;
        }),
    );
    mountPage();
    await waitFor(() => {
      expect(inspectQaAccountMock).toHaveBeenCalled();
    });
    expect(switchNotice()).toBeNull();

    await act(async () => {
      resolveStatus({ kind: 'regular' });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(switchNotice()).not.toBeNull();
    });
  });

  it('登入狀態改變：一般帳號登出後提示消失；QA 登入後提示消失', async () => {
    useViewerMock.mockReturnValue(viewerOf(REGULAR_UID, '小明'));
    const view = render(<QaLoginPage />);
    await waitFor(() => {
      expect(switchNotice()).not.toBeNull();
    });

    useViewerMock.mockReturnValue(viewerOf(null, null));
    await act(async () => {
      emit('auth:changed', { uid: null });
      view.rerender(<QaLoginPage />);
    });
    await waitFor(() => {
      expect(switchNotice()).toBeNull();
    });

    useViewerMock.mockReturnValue(viewerOf('uid-qa-1', 'QA測試-隊長'));
    inspectQaAccountMock.mockResolvedValue(QA_STATUS);
    await act(async () => {
      emit('auth:changed', { uid: 'uid-qa-1' });
      view.rerender(<QaLoginPage />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(switchNotice()).toBeNull();
  });

  for (const withEvent of [true, false]) {
    it(`一般帳號直接切成 QA 帳號（中間沒有經過未登入；${withEvent ? '有' : '沒有'} auth:changed 事件）→ 提示消失，QA 狀態還沒查完也不沿用舊結果`, async () => {
      useViewerMock.mockReturnValue(viewerOf(REGULAR_UID, '小明'));
      const view = render(<QaLoginPage />);
      await waitFor(() => {
        expect(switchNotice()).not.toBeNull();
      });

      // QA 帳號的狀態還沒查完：舊帳號的「是一般帳號」結果不能沿用到新的 uid 上。
      let resolveQa: (value: typeof QA_STATUS) => void = () => undefined;
      inspectQaAccountMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveQa = resolve;
          }),
      );
      useViewerMock.mockReturnValue(viewerOf('uid-qa-1', 'QA測試-隊長'));
      await act(async () => {
        if (withEvent) emit('auth:changed', { uid: 'uid-qa-1' });
        view.rerender(<QaLoginPage />);
      });
      await waitFor(() => {
        expect(inspectQaAccountMock).toHaveBeenCalledWith('uid-qa-1');
      });
      expect(switchNotice()).toBeNull();

      await act(async () => {
        resolveQa(QA_STATUS);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(switchNotice()).toBeNull();
    });
  }

  it('舊帳號的 QA 狀態晚到，且 uid 已直接換成 QA 帳號 → 舊結果不採用，提示不會殘留', async () => {
    useViewerMock.mockReturnValue(viewerOf(REGULAR_UID, '小明'));
    let resolveOld: (value: { kind: 'regular' }) => void = () => undefined;
    inspectQaAccountMock.mockImplementation((uid?: string) =>
      uid === REGULAR_UID
        ? new Promise((resolve) => {
            resolveOld = resolve;
          })
        : Promise.resolve(QA_STATUS),
    );
    const view = render(<QaLoginPage />);
    await waitFor(() => {
      expect(inspectQaAccountMock).toHaveBeenCalledWith(REGULAR_UID);
    });
    expect(switchNotice()).toBeNull();

    useViewerMock.mockReturnValue(viewerOf('uid-qa-1', 'QA測試-隊長'));
    await act(async () => {
      emit('auth:changed', { uid: 'uid-qa-1' });
      view.rerender(<QaLoginPage />);
    });
    await waitFor(() => {
      expect(inspectQaAccountMock).toHaveBeenCalledWith('uid-qa-1');
    });

    await act(async () => {
      resolveOld({ kind: 'regular' });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(switchNotice()).toBeNull();
  });

  it('提示是 role=status 的即時區域內容；沒有提示時區域仍在但是空的', async () => {
    const view = render(<QaLoginPage />);
    const region = document.querySelector('[role="status"]');
    expect(region).not.toBeNull();
    expect(region?.getAttribute('aria-live')).toBe('polite');
    expect(region?.childElementCount).toBe(0);

    useViewerMock.mockReturnValue(viewerOf(REGULAR_UID, '小明'));
    await act(async () => {
      view.rerender(<QaLoginPage />);
    });
    await waitFor(() => {
      expect(region?.querySelector('.qa-login__notice')).not.toBeNull();
    });
  });

  it('QA 登入失敗時提示仍在、不導頁；登入成功時照舊導向首頁', async () => {
    useViewerMock.mockReturnValue(viewerOf(REGULAR_UID, '小明'));
    const { input, form } = mountPage();
    await waitFor(() => {
      expect(switchNotice()).not.toBeNull();
    });

    signInWithQaMock.mockRejectedValueOnce(new Error('[auth] QA login failed'));
    fillPassword(input, SECRET);
    await act(async () => {
      submitForm(form);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });
    expect(routeMock).not.toHaveBeenCalled();
    expect(switchNotice()).not.toBeNull();

    signInWithQaMock.mockResolvedValueOnce({ uid: 'uid-qa-1', displayName: null, pictureUrl: null });
    fillPassword(input, SECRET);
    await act(async () => {
      submitForm(form);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(routeMock).toHaveBeenCalledWith('/');
    });
  });

  it('七份 locales/*.json 都有 switchNotice（含 {name}）與 switchNoticeNoName（不含 {name}），且都非空', () => {
    const dictionaries = import.meta.glob<Record<string, unknown>>('./locales/*.json', {
      eager: true,
      import: 'default',
    });
    const byLocale = new Map<string, Record<string, unknown>>();
    for (const [path, dict] of Object.entries(dictionaries)) {
      const locale = path.replace('./locales/', '').replace('.json', '');
      byLocale.set(locale, dict);
    }
    expect([...byLocale.keys()].sort()).toEqual([...LOCALES].sort());

    for (const locale of LOCALES) {
      const dict = byLocale.get(locale);
      const withName = dict?.switchNotice;
      const noName = dict?.switchNoticeNoName;
      expect(typeof withName, `${locale} switchNotice`).toBe('string');
      expect(typeof noName, `${locale} switchNoticeNoName`).toBe('string');
      expect((withName as string).trim().length, `${locale} switchNotice 非空`).toBeGreaterThan(0);
      expect((noName as string).trim().length, `${locale} switchNoticeNoName 非空`).toBeGreaterThan(0);
      expect(withName as string, `${locale} switchNotice 含 {name}`).toContain('{name}');
      expect(noName as string, `${locale} switchNoticeNoName 不含 {name}`).not.toContain('{name}');
      expect(noName as string, `${locale} switchNoticeNoName 不含大括號`).not.toMatch(/[{}]/);
      expect((withName as string).match(/\{[^}]*\}/g), `${locale} 只有 {name} 一個參數`).toEqual(['{name}']);
    }
  });

  it('七個語系都能渲染含名稱與不含名稱兩種提示，且渲染結果等於各語系 JSON 的文案', async () => {
    const dictionaries = import.meta.glob<Record<string, string>>('./locales/*.json', {
      eager: true,
      import: 'default',
    });
    for (const locale of LOCALES) {
      const dict = dictionaries[`./locales/${locale}.json`];
      if (dict === undefined) throw new Error(`缺少 ${locale}.json`);
      cleanup();
      await setLocale(locale);

      useViewerMock.mockReturnValue(viewerOf(REGULAR_UID, 'Alex'));
      mountPage();
      await waitFor(() => {
        expect(switchNotice()).not.toBeNull();
      });
      expect(switchNotice()?.textContent).toBe(dict.switchNotice?.replace('{name}', 'Alex'));
      cleanup();

      useViewerMock.mockReturnValue(viewerOf(REGULAR_UID, null));
      mountPage();
      await waitFor(() => {
        expect(switchNotice()).not.toBeNull();
      });
      expect(switchNotice()?.textContent).toBe(dict.switchNoticeNoName);
    }
  }, 60_000);
});
