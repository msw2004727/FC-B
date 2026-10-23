import type { JSX } from 'preact';
import { act, cleanup, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { emit } from '@/core/events';

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

vi.mock('@/data/auth', () => ({
  readQaClaims: (expectedUid?: string) => readQaClaimsMock(expectedUid),
}));

import { isQaPersonaKey, loadQaSession, useQaSession } from './data/qa-session';

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function sessionLabel(value: { persona: string; agent: string | null } | null | undefined): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  return JSON.stringify(value);
}

function Probe({ uid }: { uid: string | null | undefined }): JSX.Element {
  const session = useQaSession(uid);
  return <div data-testid="session">{sessionLabel(session)}</div>;
}

function labelText(): string {
  return screen.getByTestId('session').textContent ?? '';
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  readQaClaimsMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('loadQaSession', () => {
  it('claims 為 null 時回 null；有 claims 時回 persona 與 agent，persona 缺時為空字串', async () => {
    readQaClaimsMock.mockResolvedValueOnce(null);
    await expect(loadQaSession()).resolves.toBeNull();

    readQaClaimsMock.mockResolvedValueOnce({ persona: 'captain', agent: 'agent-1', exp: 99 });
    await expect(loadQaSession()).resolves.toEqual({ persona: 'captain', agent: 'agent-1' });

    readQaClaimsMock.mockResolvedValueOnce({ persona: null, agent: null, exp: null });
    await expect(loadQaSession()).resolves.toEqual({ persona: '', agent: null });
  });

  it('把 expectedUid 轉傳給 readQaClaims', async () => {
    readQaClaimsMock.mockResolvedValueOnce({ persona: 'captain', agent: 'agent-1', exp: 1 });
    await expect(loadQaSession('A')).resolves.toEqual({ persona: 'captain', agent: 'agent-1' });
    expect(readQaClaimsMock).toHaveBeenCalledTimes(1);
    expect(readQaClaimsMock).toHaveBeenCalledWith('A');
  });
});

describe('useQaSession', () => {
  it('uid 為 null 時回 null，且不讀 claims', async () => {
    render(<Probe uid={null} />);
    await flush();
    expect(labelText()).toBe('null');
    expect(readQaClaimsMock).not.toHaveBeenCalled();
  });

  it('uid 延後出現：先是 null，讀取完成前是 undefined，完成後是 session', async () => {
    const pending = deferred<ParsedClaims>();
    readQaClaimsMock.mockImplementation(() => pending.promise);

    const { rerender } = render(<Probe uid={null} />);
    expect(labelText()).toBe('null');
    expect(readQaClaimsMock).not.toHaveBeenCalled();

    rerender(<Probe uid="uid-1" />);
    expect(labelText()).toBe('undefined');

    await flush();
    expect(labelText()).toBe('undefined');
    expect(readQaClaimsMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve({ persona: 'captain', agent: 'agent-1', exp: 10 });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(labelText()).toBe(JSON.stringify({ persona: 'captain', agent: 'agent-1' }));
    });
  });

  it('uid 有值但 claims 不是 QA 時回 null', async () => {
    readQaClaimsMock.mockResolvedValue(null);
    render(<Probe uid="uid-regular" />);
    await waitFor(() => {
      expect(labelText()).toBe('null');
    });
    expect(readQaClaimsMock).toHaveBeenCalledTimes(1);
  });

  it('非同步回來時 uid 已變就丟棄舊結果', async () => {
    const resolvers: Array<(value: ParsedClaims) => void> = [];
    readQaClaimsMock.mockImplementation(
      () =>
        new Promise<ParsedClaims>((resolve) => {
          resolvers.push(resolve);
        }),
    );

    const { rerender } = render(<Probe uid="uid-A" />);
    await flush();
    expect(resolvers).toHaveLength(1);

    rerender(<Probe uid="uid-B" />);
    await flush();
    expect(resolvers).toHaveLength(2);
    expect(labelText()).toBe('undefined');

    const resolveA = resolvers[0];
    const resolveB = resolvers[1];
    if (!resolveA || !resolveB) throw new Error('兩次 claims 讀取都應該已開始');

    await act(async () => {
      resolveB({ persona: 'coach', agent: 'agent-b', exp: 2 });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(labelText()).toBe(JSON.stringify({ persona: 'coach', agent: 'agent-b' }));
    });

    await act(async () => {
      resolveA({ persona: 'captain', agent: 'slow-a', exp: 1 });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(labelText()).toBe(JSON.stringify({ persona: 'coach', agent: 'agent-b' }));
    expect(labelText()).not.toContain('slow-a');
  });

  it('元件卸載後 resolve 不更新、不警告、也不留下未處理的拒絕', async () => {
    const pending = deferred<ParsedClaims>();
    readQaClaimsMock.mockImplementation(() => pending.promise);

    const updates: string[] = [];
    function RecordingProbe({ uid }: { uid: string | null | undefined }): JSX.Element {
      const session = useQaSession(uid);
      const text = sessionLabel(session);
      updates.push(text);
      return <div data-testid="session">{text}</div>;
    }

    const { unmount } = render(<RecordingProbe uid="uid-1" />);
    await flush();
    const countAtUnmount = updates.length;
    expect(countAtUnmount).toBeGreaterThan(0);

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

    unmount();
    await act(async () => {
      pending.resolve({ persona: 'captain', agent: 'agent-1', exp: 1 });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(updates.length).toBe(countAtUnmount);
    expect(warnings).toEqual([]);
    expect(errors).toEqual([]);
    expect(rejections).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    window.removeEventListener('unhandledrejection', onRejection);
  });

  it('同一個 uid 收到 auth:changed 後重讀，第二次結果覆蓋第一次', async () => {
    readQaClaimsMock
      .mockResolvedValueOnce({ persona: 'captain', agent: 'agent-1', exp: 1 })
      .mockResolvedValueOnce({ persona: 'coach', agent: 'agent-2', exp: 2 });

    render(<Probe uid="uid-same" />);
    await waitFor(() => {
      expect(labelText()).toBe(JSON.stringify({ persona: 'captain', agent: 'agent-1' }));
    });
    expect(readQaClaimsMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      emit('auth:changed', { uid: 'uid-same' });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(labelText()).toBe(JSON.stringify({ persona: 'coach', agent: 'agent-2' }));
    });
    expect(readQaClaimsMock).toHaveBeenCalledTimes(2);
  });

  it('hook 傳 uid A 時 readQaClaims 收到 A', async () => {
    readQaClaimsMock.mockResolvedValue({ persona: 'captain', agent: 'agent-1', exp: 1 });
    render(<Probe uid="A" />);
    await waitFor(() => {
      expect(labelText()).toBe(JSON.stringify({ persona: 'captain', agent: 'agent-1' }));
    });
    expect(readQaClaimsMock).toHaveBeenCalledWith('A');
    expect(readQaClaimsMock.mock.calls.every((call) => call[0] === 'A')).toBe(true);
  });
});

describe('isQaPersonaKey', () => {
  it('五個合法 key 為 true，其他值為 false', () => {
    expect(isQaPersonaKey('captain')).toBe(true);
    expect(isQaPersonaKey('coach')).toBe(true);
    expect(isQaPersonaKey('venueOwner')).toBe(true);
    expect(isQaPersonaKey('memberA')).toBe(true);
    expect(isQaPersonaKey('memberB')).toBe(true);
    expect(isQaPersonaKey('admin')).toBe(false);
    expect(isQaPersonaKey('')).toBe(false);
    expect(isQaPersonaKey(null)).toBe(false);
    expect(isQaPersonaKey(undefined)).toBe(false);
    expect(isQaPersonaKey(1)).toBe(false);
  });
});
